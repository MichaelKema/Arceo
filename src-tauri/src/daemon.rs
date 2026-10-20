use crate::{
    hosts,
    model::{self, Config, Runtime},
    storage,
};
use chrono::{Local, Utc};
use fs2::FileExt;
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
pub fn hosts_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()))
            .join("System32\\drivers\\etc\\hosts")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/etc/hosts")
    }
}
pub fn run(dir: PathBuf) -> Result<(), String> {
    if !dir.is_absolute() || !dir.join("config.json").is_file() {
        return Err("Invalid Arceo data directory".into());
    }
    // Detach from the authorization shell before installing signal handlers.
    // The engine manages its own session and does not need a launch console.
    // EPERM simply means we're already a process-group leader.
    #[cfg(unix)]
    unsafe {
        libc::setsid();
    }
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("engine.lock"))
        .map_err(|e| e.to_string())?;
    if lock.try_lock_exclusive().is_err() {
        return Ok(());
    }
    struct RestoreOnExit;
    impl Drop for RestoreOnExit {
        fn drop(&mut self) {
            let _ = hosts::apply(&hosts_path(), &BTreeSet::new());
        }
    }
    let _cleanup = RestoreOnExit;
    let stopping = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_signal = stopping.clone();
    ctrlc::set_handler(move || {
        stop_signal.store(true, std::sync::atomic::Ordering::SeqCst);
    })
    .map_err(|e| e.to_string())?;
    let mut system = System::new();
    let mut last_domains: Option<BTreeSet<String>> = None;
    let mut failures = 0;
    while !stopping.load(std::sync::atomic::Ordering::SeqCst) {
        let mut runtime = Runtime {
            online: true,
            heartbeat: Utc::now().timestamp(),
            ..Runtime::default()
        };
        let config: Config = match storage::read_config(&dir) {
            Ok(config) => {
                if failures >= 5 {
                    last_domains = None;
                }
                failures = 0;
                config
            }
            Err(error) => {
                failures += 1;
                runtime.error = Some(format!("Cannot read settings: {error}"));
                // A transient atomic replacement should not interrupt a session; repeated failures release blocks.
                if failures >= 5 {
                    runtime.error = hosts::apply(&hosts_path(), &BTreeSet::new())
                        .err()
                        .or(runtime.error);
                }
                let _ = storage::atomic_write(&dir.join("runtime.json"), &runtime);
                thread::sleep(Duration::from_secs(1));
                continue;
            }
        };
        let now = Local::now();
        let ids = model::effective_groups(&config, now);
        let mut domains = BTreeSet::new();
        let mut apps = Vec::new();
        for group in &config.groups {
            if ids.contains(&group.id) {
                for domain in &group.domains {
                    if let Ok(domain) = model::normalize_domain(domain) {
                        domains.insert(domain);
                    }
                }
                apps.extend(
                    group
                        .apps
                        .iter()
                        .filter_map(|app| fs::canonicalize(&app.path).ok())
                        .filter(|path| model::allowed_app_path(path)),
                );
            }
        }
        if last_domains.as_ref() != Some(&domains) {
            match hosts::apply(&hosts_path(), &domains) {
                Ok(()) => last_domains = Some(domains.clone()),
                Err(error) => runtime.error = Some(error),
            }
        }
        // Exact executable / application bundle matching. Never kill by a substring or a display name.
        if !apps.is_empty() {
            system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing()
                    .with_exe(UpdateKind::Always)
                    .with_user(UpdateKind::Always),
            );
            #[cfg(unix)]
            let owner_uid = {
                use std::os::unix::fs::MetadataExt;
                fs::metadata(&dir).map_err(|e| e.to_string())?.uid()
            };
            for process in system.processes().values() {
                if process.pid().as_u32() == std::process::id() {
                    continue;
                }
                #[cfg(unix)]
                if process.user_id().is_none_or(|id| **id != owner_uid) {
                    continue;
                }
                if let Some(exe) = process.exe() {
                    // Selected paths are canonicalized when saved. Process
                    // paths can retain aliases such as /var vs /private/var;
                    // compare both sides using the same filesystem identity.
                    let canonical_exe = fs::canonicalize(exe).unwrap_or_else(|_| exe.to_owned());
                    if apps
                        .iter()
                        .any(|target| matches_app(&canonical_exe, target))
                        && !process.kill()
                    {
                        runtime.error = Some(
                            "An application could not be closed. Check its permissions.".into(),
                        );
                    }
                }
            }
        }
        runtime.blocked_domains = if runtime.error.is_none() {
            domains.len()
        } else {
            0
        };
        runtime.blocked_apps = apps.len();
        runtime.active_schedule_ids = config
            .schedules
            .iter()
            .filter(|s| model::schedule_active(s, now))
            .map(|s| s.id.clone())
            .collect();
        if !config.engine_enabled && runtime.error.is_none() {
            runtime.online = false;
            storage::atomic_write(&dir.join("runtime.json"), &runtime)?;
            break;
        }
        storage::atomic_write(&dir.join("runtime.json"), &runtime)?;
        thread::sleep(Duration::from_secs(1));
    }
    let runtime = Runtime {
        online: false,
        heartbeat: Utc::now().timestamp(),
        ..Runtime::default()
    };
    let _ = storage::atomic_write(&dir.join("runtime.json"), &runtime);
    Ok(())
}
pub fn restore_hosts() -> Result<(), String> {
    hosts::apply(&hosts_path(), &BTreeSet::new())
}
fn matches_app(exe: &Path, target: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        let bundle = target
            .ancestors()
            .find(|p| p.extension().is_some_and(|ext| ext == "app"));
        exe == target || bundle.is_some_and(|bundle| exe.starts_with(bundle))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let exe = exe.to_string_lossy();
        let target = target.to_string_lossy();
        exe.strip_prefix(r"\\?\")
            .unwrap_or(&exe)
            .eq_ignore_ascii_case(target.strip_prefix(r"\\?\").unwrap_or(&target))
    }
}

#[cfg(target_os = "macos")]
fn prepare_helper(source: &Path, dir: &Path) -> Result<PathBuf, String> {
    use std::{io, os::unix::fs::PermissionsExt};
    // Authorization runs outside the app's privacy context. Launching directly
    // from Documents/Downloads can fail even after administrator approval.
    let helper_dir = dir.join("engine");
    fs::create_dir_all(&helper_dir)
        .map_err(|e| format!("Cannot prepare the blocking engine: {e}"))?;
    let mut staged = tempfile::NamedTempFile::new_in(&helper_dir).map_err(|e| e.to_string())?;
    io::copy(
        &mut fs::File::open(source).map_err(|e| e.to_string())?,
        staged.as_file_mut(),
    )
    .map_err(|e| format!("Cannot copy the blocking engine: {e}"))?;
    staged
        .as_file()
        .set_permissions(fs::Permissions::from_mode(0o755))
        .map_err(|e| e.to_string())?;
    staged.as_file().sync_all().map_err(|e| e.to_string())?;
    let target = helper_dir.join("arceo-engine");
    staged.persist(&target).map_err(|e| e.to_string())?;
    Ok(target)
}

#[cfg(target_os = "macos")]
fn mac_launch_command(exe: &Path, dir: &Path) -> String {
    fn quote(s: &str) -> String {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
    // Do not use macOS nohup here: its console ioctls fail when launched by
    // authorization services. The Rust engine detaches itself with setsid.
    // mktemp creates a root-owned log. Never redirect privileged output to a
    // user-writable filename, which could be replaced with a symlink.
    format!(
        "engine_log=$(/usr/bin/mktemp /var/tmp/arceo-engine.XXXXXX) || exit 1; \
         {} --blocker-daemon {} </dev/null >\"$engine_log\" 2>&1 & \
         engine_pid=$!; /bin/sleep 0.3; \
         if /bin/kill -0 \"$engine_pid\" 2>/dev/null; then \
         /bin/rm -f \"$engine_log\"; else \
         /bin/cat \"$engine_log\"; /bin/rm -f \"$engine_log\"; exit 1; fi",
        quote(&exe.to_string_lossy()),
        quote(&dir.to_string_lossy())
    )
}

pub fn launch(dir: &Path) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let helper = prepare_helper(&exe, dir)?;
        let command = mac_launch_command(&helper, dir);
        let script = format!(
            "do shell script \"{}\" with administrator privileges",
            command.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let output = std::process::Command::new("/usr/bin/osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            let details = String::from_utf8_lossy(&output.stdout);
            if error.contains("(-128)") || error.contains("User canceled") {
                return Err(
                    "Administrator approval was canceled. Click Start focus session to try again."
                        .into(),
                );
            }
            return Err(format!(
                "The blocking engine could not start. {} {}",
                details.trim(),
                error.trim()
            )
            .trim()
            .to_owned());
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_HIDE};
        let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(Some(0)).collect::<Vec<u16>>();
        let verb = wide(std::ffi::OsStr::new("runas"));
        let file = wide(exe.as_os_str());
        // Windows filenames cannot contain quotes; trailing separators are stripped before argument quoting.
        let args = wide(std::ffi::OsStr::new(&format!(
            "--blocker-daemon \"{}\"",
            dir.to_string_lossy().trim_end_matches('\\')
        )));
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                file.as_ptr(),
                args.as_ptr(),
                std::ptr::null(),
                SW_HIDE,
            )
        };
        if result as isize <= 32 {
            return Err("Administrator permission was not granted".into());
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (exe, dir);
        Err("Arceo supports macOS and Windows".into())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod launch_tests {
    use super::*;
    #[test]
    fn background_launch_works_through_applescript_without_a_terminal() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("test executable");
        fs::write(
            &source,
            concat!(
                "#!/bin/sh\n",
                "if [ -t 0 ]; then echo 'unexpected terminal'; exit 1; fi\n",
                "if read value; then echo 'stdin was not disconnected'; exit 1; fi\n",
                "trap '' HUP\n",
                "printf '%s' \"$$\" > \"$2/started.pid\"\n",
                "exec /bin/sleep 5\n"
            ),
        )
        .unwrap();
        let dir = temp.path().join("user's application data");
        fs::create_dir(&dir).unwrap();
        let helper = prepare_helper(&source, &dir).unwrap();
        let command = mac_launch_command(&helper, &dir);
        let script = format!(
            "do shell script \"{}\"",
            command.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let output = std::process::Command::new("/usr/bin/osascript")
            .args(["-e", &script])
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let pid: i32 = fs::read_to_string(dir.join("started.pid"))
            .unwrap()
            .parse()
            .unwrap();
        let alive = unsafe { libc::kill(pid, 0) } == 0;
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
        assert!(
            alive,
            "Background process must survive the AppleScript launcher exiting"
        );
    }
    #[test]
    fn staged_helper_handles_spaces_and_reports_startup_failure() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("test executable");
        fs::write(
            &source,
            "#!/bin/sh\necho 'simulated startup failure' >&2\nexit 1\n",
        )
        .unwrap();
        let dir = temp.path().join("user's application data");
        fs::create_dir(&dir).unwrap();
        let helper = prepare_helper(&source, &dir).unwrap();
        assert!(helper.starts_with(dir.join("engine")));
        let output = std::process::Command::new("/bin/sh")
            .args(["-c", &mac_launch_command(&helper, &dir)])
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("simulated startup failure"));
    }
}
