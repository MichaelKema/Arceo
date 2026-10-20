"""Exercise the real macOS engine without network access or real app/hosts changes."""
import datetime
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

if sys.platform != "darwin":
    raise SystemExit("This verification uses the macOS sandbox; run it on macOS.")

root = Path(__file__).resolve().parent.parent
binary = root / "src-tauri/target/release/bundle/macos/Arceo.app/Contents/MacOS/arceo"
profile = "(version 1) (allow default) (deny network*)"
assert binary.is_file(), "Build the desktop .app first."
assert "# BEGIN ARCEO MANAGED BLOCK" not in Path("/etc/hosts").read_text(), (
    "Stop existing Arceo blocks before this isolated test; it never edits the hosts file."
)

# Prove the sandbox denies socket access, rather than relying on an unplugged network.
probe = subprocess.run(
    ["/usr/bin/sandbox-exec", "-p", profile, sys.executable, "-c",
     "import socket,errno\n"
     "try: socket.create_connection(('127.0.0.1', 9), 1)\n"
     "except OSError as e: raise SystemExit(0 if e.errno in (errno.EPERM,errno.EACCES) else 1)\n"
     "raise SystemExit(1)"],
    capture_output=True, text=True, timeout=5,
)
assert probe.returncode == 0, f"Network-denial probe failed: {probe.stderr}"


def wait_until(predicate, message):
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    raise AssertionError(message)


with tempfile.TemporaryDirectory(prefix="arceo-offline-") as temporary:
    directory = Path(temporary)
    helper = directory / "arceo-engine"
    shutil.copyfile(binary, helper)
    helper.chmod(0o755)
    target = directory / "Offline Test.app/Contents/MacOS/offline-test"
    target.parent.mkdir(parents=True)
    # Build our own disposable process. Copying an Apple platform binary into
    # a fake app bundle can be killed by macOS code-signing checks before the
    # blocker touches it, producing a false-positive blocking result.
    subprocess.run(["/usr/bin/cc", "-x", "c", "-o", str(target), "-"],
                   input="#include <unistd.h>\nint main(void) { sleep(120); return 0; }\n",
                   text=True, capture_output=True, check=True, timeout=30)
    config = json.loads((root / "src/defaults.json").read_text())
    config.update(engine_enabled=True, active_session=None, schedules=[])
    # No domains: hosts reconciliation is a no-op. The only selected process is
    # a disposable test process inside this temporary application bundle.
    config["groups"] = [{
        "id": "offline-test", "name": "Offline test", "description": "Test fixture",
        "color": "mint", "icon": "custom", "domains": [], "apps": [{
            "id": "fixture", "name": "Offline Test", "path": str(target.resolve()),
        }],
    }]

    def write_config():
        temporary_config = directory / "next.json"
        temporary_config.write_text(json.dumps(config))
        temporary_config.replace(directory / "config.json")

    def runtime():
        try:
            return json.loads((directory / "runtime.json").read_text())
        except FileNotFoundError:
            return {}

    write_config()
    children = []
    with (directory / "engine.log").open("w") as log:
        engine = subprocess.Popen(
            ["/usr/bin/sandbox-exec", "-p", profile, str(helper),
             "--blocker-daemon", str(directory)], stdout=log, stderr=log,
        )
        try:
            wait_until(lambda: runtime().get("online"), "Engine did not start offline")
            children.append(subprocess.Popen([str(target)]))
            time.sleep(0.3)
            assert children[0].poll() is None, "Fixture must stay alive before blocking begins"
            now = int(time.time())
            config["active_session"] = {
                "id": "offline-session", "name": "Offline focus", "group_ids": ["offline-test"],
                "started_at": now, "ends_at": now + 120, "ended_at": None,
            }
            write_config()
            wait_until(lambda: children[0].poll() is not None, "Timed app blocking failed offline")
            wait_until(lambda: runtime().get("blocked_apps") == 1, "Engine did not acknowledge the active session")
            print("PASS: native focus session blocks the fixture app without network access")
            config["active_session"] = None
            write_config()
            wait_until(lambda: runtime().get("blocked_apps") == 0, "Session did not release app block")
            children.append(subprocess.Popen([str(target)]))
            time.sleep(1.2)
            assert children[1].poll() is None, "App stayed blocked after the session stopped"
            local_now = datetime.datetime.now().astimezone()
            config["schedules"] = [{
                "id": "offline-schedule", "name": "Offline routine", "group_ids": ["offline-test"],
                "days": list(range(7)), "enabled": True,
                "start": (local_now-datetime.timedelta(minutes=1)).strftime("%H:%M"),
                "end": (local_now+datetime.timedelta(minutes=2)).strftime("%H:%M"),
            }]
            write_config()
            wait_until(lambda: children[1].poll() is not None, "Scheduled app blocking failed offline")
            print("PASS: local schedules automatically block the fixture app without network access")
            config["engine_enabled"] = False
            write_config()
            engine.wait(timeout=6)
            assert engine.returncode == 0 and runtime().get("online") is False
            assert not runtime().get("error"), runtime()
            print("PASS: engine shutdown and state persistence work offline")
        except BaseException:
            print("Engine verification details:", runtime(), "engine exit:", engine.poll(), "fixture exits:", [child.poll() for child in children], flush=True)
            print((directory / "engine.log").read_text(), flush=True)
            raise
        finally:
            if engine.poll() is None:
                engine.terminate()
                engine.wait(timeout=6)
            for child in children:
                if child.poll() is None:
                    child.kill()
                child.wait()
