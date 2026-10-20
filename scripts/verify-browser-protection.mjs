// Product integration test on a disposable Windows runner. All page traffic is local.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

assert.equal(process.platform, "win32");
assert.equal(
  process.env.CI,
  "true",
  "Use only the disposable Windows CI runner",
);
const binary = resolve(process.argv[2] || "src-tauri/target/release/arceo.exe");
const temp = await mkdtemp(join(tmpdir(), "arceo-browser-test-"));
const appData = join(temp, "appdata");
const dir = join(appData, "app.arceo.desktop");
await mkdir(dir, { recursive: true });
const config = JSON.parse(
  await readFile(new URL("../src/defaults.json", import.meta.url), "utf8"),
);
config.groups = [
  { ...config.groups[0], domains: ["blocked.test", "x.com"], apps: [] },
];
config.engine_enabled = true;
async function save() {
  await writeFile(join(dir, "next.json"), JSON.stringify(config));
  await rename(join(dir, "next.json"), join(dir, "config.json"));
}
await save();
const setup = JSON.parse(
  execFileSync(binary, ["--prepare-browser-protection", dir], {
    encoding: "utf8",
    windowsHide: true,
  }),
);
const fixture = createServer((_request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html",
    "Cache-Control": "no-store",
  });
  response.end(
    "<!doctype html><title>Local fixture</title><p>ARCEO_FIXTURE_READY</p>",
  );
});
await new Promise((yes) => fixture.listen(0, "127.0.0.1", yes));
const port = fixture.address().port;
let context;
async function until(check, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}
try {
  context = await chromium.launchPersistentContext(join(temp, "profile"), {
    headless: true,
    channel: "chromium",
    env: { ...process.env, APPDATA: appData },
    args: [
      `--disable-extensions-except=${setup.extension_path}`,
      `--load-extension=${setup.extension_path}`,
      "--no-proxy-server",
      "--host-resolver-rules=MAP blocked.test 127.0.0.1,MAP foo.blocked.test 127.0.0.1,MAP allowed.test 127.0.0.1,MAP x.com 127.0.0.1",
    ],
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const rules = () =>
    worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  await until(async () => {
    try {
      return (
        JSON.parse(await readFile(join(dir, "browser-runtime.json"), "utf8"))
          .heartbeat >
        Date.now() / 1000 - 5
      );
    } catch {
      return false;
    }
  }, "Chrome did not connect to the real native messaging host");
  const page = await context.newPage();
  await page.goto(`http://blocked.test:${port}/before`);
  assert((await page.textContent("body")).includes("ARCEO_FIXTURE_READY"));
  const now = Math.floor(Date.now() / 1000);
  config.active_session = {
    id: "browser-regression",
    name: "Fixture",
    group_ids: ["social"],
    started_at: now,
    ends_at: now + 120,
    ended_at: null,
  };
  await save();
  await until(
    async () => (await rules()).length > 0,
    "Timed rules did not arrive inside Chrome",
  );
  await until(
    () => page.url().includes("/blocked.html?host=blocked.test"),
    "Already-open cached tab was not replaced",
  );
  console.log(
    "PASS: real native messaging applies timed rules and replaces an already-open blocked tab",
  );
  for (const host of ["blocked.test", "foo.blocked.test", "x.com"]) {
    const tab = await context.newPage();
    let failure = "";
    await tab
      .goto(`http://${host}:${port}/new`, { timeout: 15_000 })
      .catch((error) => {
        failure = error.message;
      });
    assert(
      failure.includes("ERR_BLOCKED_BY_CLIENT") ||
        failure.includes("ERR_ABORTED") ||
        tab.url().includes("/blocked.html"),
      `${host} bypassed request blocking: ${failure}`,
    );
    await tab.close();
  }
  const allowed = await context.newPage();
  await allowed.goto(`http://allowed.test:${port}/allowed`);
  assert((await allowed.textContent("body")).includes("ARCEO_FIXTURE_READY"));
  console.log(
    "PASS: X, selected domains and subdomains are blocked independently of DNS; unrelated websites still load",
  );
  config.active_session.ends_at = Math.floor(Date.now() / 1000) - 1;
  await save();
  await until(
    async () => (await rules()).length === 0,
    "Expired timer left browser rules behind",
  );
  await page.goto(`http://blocked.test:${port}/after`);
  assert((await page.textContent("body")).includes("ARCEO_FIXTURE_READY"));
  console.log("PASS: timer expiry releases browser rules");
  const minutes = new Date().getHours() * 60 + new Date().getMinutes();
  const clock = (m) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  config.active_session = null;
  config.schedules = [
    {
      id: "schedule",
      name: "Fixture",
      group_ids: ["social"],
      days: [0, 1, 2, 3, 4, 5, 6],
      start: clock((minutes + 1439) % 1440),
      end: clock((minutes + 1) % 1440),
      enabled: true,
    },
  ];
  await save();
  await until(
    async () => (await rules()).length > 0,
    "Scheduled browser block did not activate",
  );
  config.engine_enabled = false;
  await save();
  await until(
    async () => (await rules()).length === 0,
    "Disabling the engine left browser rules behind",
  );
  console.log(
    "PASS: local schedules and disabling enforcement synchronize with the browser",
  );
  // The profile uses only bundled scripts and native IPC. Native status contains
  // counts and errors, never browsing URLs or page contents.
  const status = JSON.parse(
    await readFile(join(dir, "browser-runtime.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(status).sort(), ["count", "error", "heartbeat"]);
} finally {
  await context?.close();
  await new Promise((yes) => fixture.close(yes));
  const registry = join(process.env.SystemRoot, "System32/reg.exe");
  for (const browser of ["Google\\Chrome", "Microsoft\\Edge", "Chromium"]) {
    for (const view of ["/reg:32", "/reg:64"]) {
      try {
        execFileSync(
          registry,
          [
            "DELETE",
            `HKCU\\Software\\${browser}\\NativeMessagingHosts\\app.arceo.browser`,
            "/f",
            view,
          ],
          { stdio: "ignore", windowsHide: true },
        );
      } catch {
        /* absent */
      }
    }
  }
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}
