pub mod daemon;
mod hosts;
mod model;
mod safari;
mod storage;
use model::{AppTarget, Config, Runtime, Session};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
struct Store {
    dir: PathBuf,
    config: Arc<Mutex<Config>>,
    safari: safari::Guard,
}
#[derive(serde::Serialize)]
struct Snapshot {
    config: Config,
    runtime: Runtime,
    platform: String,
    safari: safari::Status,
}
#[tauri::command]
fn get_snapshot(store: State<Store>) -> Result<Snapshot, String> {
    let mut config = store.config.lock().map_err(|e| e.to_string())?;
    let was_active = config.active_session.is_some();
    config.archive_expired();
    if was_active && config.active_session.is_none() {
        storage::atomic_write(&store.dir.join("config.json"), &*config)?;
    }
    Ok(Snapshot {
        config: config.clone(),
        runtime: storage::read_runtime(&store.dir),
        platform: std::env::consts::OS.into(),
        safari: store.safari.status(),
    })
}
#[tauri::command]
fn save_config(mut config: Config, store: State<Store>) -> Result<Config, String> {
    let mut current = store.config.lock().map_err(|e| e.to_string())?;
    config.engine_enabled = current.engine_enabled;
    config.safari_protection = current.safari_protection;
    config.active_session = current.active_session.clone();
    config.sessions = current.sessions.clone();
    config.validate()?;
    storage::atomic_write(&store.dir.join("config.json"), &config)?;
    *current = config.clone();
    Ok(config)
}
#[tauri::command]
async fn enable_engine(store: State<'_, Store>) -> Result<(), String> {
    let dir = store.dir.clone();
    {
        let mut config = store.config.lock().map_err(|e| e.to_string())?;
        config.engine_enabled = true;
        storage::atomic_write(&dir.join("config.json"), &*config)?;
    }
    let runtime = storage::read_runtime(&dir);
    if runtime.online {
        return runtime.error.map_or(Ok(()), Err);
    }
    let launch_dir = dir.clone();
    let result = async {
        tauri::async_runtime::spawn_blocking(move || daemon::launch(&launch_dir))
            .await
            .map_err(|e| e.to_string())??;
        let wait_dir = dir.clone();
        tauri::async_runtime::spawn_blocking(move || {
            wait_for_engine(&wait_dir, std::time::Duration::from_secs(15))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    .await;
    if result.is_err() {
        let mut config = store.config.lock().map_err(|e| e.to_string())?;
        config.engine_enabled = false;
        storage::atomic_write(&dir.join("config.json"), &*config)?;
    }
    result
}
fn wait_for_engine(dir: &Path, timeout: std::time::Duration) -> Result<(), String> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let runtime = storage::read_runtime(dir);
        if runtime.online {
            return runtime.error.map_or(Ok(()), Err);
        }
        if std::time::Instant::now() >= deadline {
            return Err("The local blocking engine did not start. No session was started. Retry Start focus session and complete the administrator prompt.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}
#[tauri::command]
async fn disable_engine(store: State<'_, Store>) -> Result<(), String> {
    let dir = store.dir.clone();
    {
        let mut config = store.config.lock().map_err(|e| e.to_string())?;
        config.engine_enabled = false;
        if let Some(mut session) = config.active_session.take() {
            session.ended_at = Some(chrono::Utc::now().timestamp());
            config.sessions.insert(0, session);
        }
        storage::atomic_write(&dir.join("config.json"), &*config)?;
    }
    if !storage::read_runtime(&dir).online {
        let has_blocks = std::fs::read_to_string(daemon::hosts_path())
            .map(|s| s.contains("# BEGIN ARCEO MANAGED BLOCK"))
            .unwrap_or(false);
        if has_blocks {
            tauri::async_runtime::spawn_blocking(move || daemon::launch(&dir))
                .await
                .map_err(|e| e.to_string())??;
        }
    }
    Ok(())
}
#[tauri::command]
async fn set_safari_protection(enabled: bool, store: State<'_, Store>) -> Result<(), String> {
    if enabled {
        tauri::async_runtime::spawn_blocking(safari::authorize)
            .await
            .map_err(|e| e.to_string())??;
    }
    let mut config = store.config.lock().map_err(|e| e.to_string())?;
    let mut updated = config.clone();
    updated.safari_protection = enabled;
    storage::atomic_write(&store.dir.join("config.json"), &updated)?;
    *config = updated;
    store.safari.clear();
    Ok(())
}
#[tauri::command]
async fn start_session(
    duration: u32,
    group_ids: Vec<String>,
    name: String,
    store: State<'_, Store>,
) -> Result<Config, String> {
    let safari_enabled = store
        .config
        .lock()
        .map_err(|e| e.to_string())?
        .safari_protection;
    if safari_enabled {
        tauri::async_runtime::spawn_blocking(safari::check_permission)
            .await
            .map_err(|e| e.to_string())??;
        store.safari.clear();
    }
    begin_focus_session(duration, group_ids, name, &store)
}
fn begin_focus_session(
    duration: u32,
    group_ids: Vec<String>,
    name: String,
    store: &Store,
) -> Result<Config, String> {
    let runtime = storage::read_runtime(&store.dir);
    if !runtime.online {
        return Err("Enable the blocking engine before starting a session".into());
    }
    if let Some(error) = runtime.error {
        return Err(error);
    }
    if !(1..=1440).contains(&duration) {
        return Err("Choose between 1 and 1440 minutes".into());
    }
    let mut config = store.config.lock().map_err(|e| e.to_string())?;
    config.archive_expired();
    if config.active_session.is_some() {
        return Err("A session is already running".into());
    }
    let now = chrono::Utc::now().timestamp();
    let mut updated = config.clone();
    updated.active_session = Some(Session {
        id: format!("session-{now}"),
        name,
        group_ids,
        started_at: now,
        ends_at: now + i64::from(duration) * 60,
        ended_at: None,
    });
    updated.validate()?;
    storage::atomic_write(&store.dir.join("config.json"), &updated)?;
    *config = updated.clone();
    Ok(updated)
}
#[tauri::command]
fn stop_session(store: State<Store>) -> Result<Config, String> {
    let mut config = store.config.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = config.active_session.take() {
        session.ended_at = Some(chrono::Utc::now().timestamp());
        config.sessions.insert(0, session);
    }
    storage::atomic_write(&store.dir.join("config.json"), &*config)?;
    Ok(config.clone())
}
fn app_from_path(path: &Path) -> Result<AppTarget, String> {
    let executable = if path.extension().is_some_and(|e| e == "app") {
        let plist = plist::Value::from_file(path.join("Contents/Info.plist"))
            .map_err(|_| "Cannot read this app's Info.plist")?;
        let binary = plist
            .as_dictionary()
            .and_then(|d| d.get("CFBundleExecutable"))
            .and_then(|v| v.as_string())
            .ok_or("Cannot find this app's executable")?;
        path.join("Contents/MacOS").join(binary)
    } else {
        path.to_path_buf()
    };
    let canonical = std::fs::canonicalize(executable).map_err(|_| "Application not found")?;
    if !model::allowed_app_path(&canonical) {
        return Err(
            "Choose an installed .app or .exe. System apps and Arceo are protected.".into(),
        );
    }
    let name = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let path = canonical.to_string_lossy().to_string();
    Ok(AppTarget {
        id: path.clone(),
        name,
        path,
    })
}
#[tauri::command]
fn resolve_app(path: String) -> Result<AppTarget, String> {
    app_from_path(Path::new(&path))
}
#[tauri::command]
async fn list_apps() -> Result<Vec<AppTarget>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut apps = std::collections::BTreeMap::new();
        #[cfg(target_os = "macos")]
        {
            let mut dirs = vec![PathBuf::from("/Applications")];
            if let Some(home) = std::env::var_os("HOME") {
                dirs.push(PathBuf::from(home).join("Applications"));
            }
            for dir in dirs {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        if let Ok(app) = app_from_path(&entry.path()) {
                            apps.insert(app.path.clone(), app);
                        }
                    }
                }
            }
        }
        let system = sysinfo::System::new_all();
        for process in system.processes().values() {
            if let Some(path) = process.exe() {
                #[cfg(target_os = "macos")]
                let path = path
                    .ancestors()
                    .find(|p| p.extension().is_some_and(|ext| ext == "app"))
                    .unwrap_or(path);
                if let Ok(app) = app_from_path(path) {
                    apps.insert(app.path.clone(), app);
                }
            }
        }
        let mut apps: Vec<_> = apps.into_values().collect();
        apps.sort_by_key(|a| a.name.to_lowercase());
        apps
    })
    .await
    .map_err(|e| e.to_string())
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let config = if dir.join("config.json").exists() {
                storage::read_config(&dir).map_err(std::io::Error::other)?
            } else {
                let config = Config::default();
                storage::atomic_write(&dir.join("config.json"), &config)
                    .map_err(std::io::Error::other)?;
                config
            };
            // Create as the signed-in user before a privileged helper opens the lock.
            std::fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .open(dir.join("engine.lock"))?;
            let config = Arc::new(Mutex::new(config));
            let safari = safari::Guard::default();
            safari.start(config.clone());
            app.manage(Store {
                dir,
                config,
                safari,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .state::<Store>()
                    .config
                    .lock()
                    .unwrap()
                    .safari_protection
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            set_safari_protection,
            save_config,
            enable_engine,
            disable_engine,
            start_session,
            stop_session,
            resolve_app,
            list_apps
        ])
        .build(tauri::generate_context!())
        .expect("could not launch Arceo")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            match event {
                tauri::RunEvent::Reopen { .. } => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                tauri::RunEvent::ExitRequested { .. } => {
                    let store = app.state::<Store>();
                    let mut config = store.config.lock().unwrap();
                    if config.safari_protection {
                        // Explicit Quit ends enforcement because the Safari watcher exits too.
                        config.engine_enabled = false;
                        if let Some(mut session) = config.active_session.take() {
                            session.ended_at = Some(chrono::Utc::now().timestamp());
                            config.sessions.insert(0, session);
                        }
                        let _ = storage::atomic_write(&store.dir.join("config.json"), &*config);
                    }
                }
                _ => {}
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod startup_tests {
    use super::*;
    #[test]
    fn native_session_starts_only_after_engine_heartbeat() {
        let dir = tempfile::tempdir().unwrap();
        let config = Config {
            engine_enabled: true,
            ..Config::default()
        };
        let store = Store {
            dir: dir.path().to_owned(),
            config: Arc::new(Mutex::new(config)),
            safari: safari::Guard::default(),
        };
        assert!(begin_focus_session(25, vec!["social".into()], "Focus".into(), &store).is_err());
        assert!(store.config.lock().unwrap().active_session.is_none());
        let runtime = Runtime {
            online: true,
            heartbeat: chrono::Utc::now().timestamp(),
            ..Runtime::default()
        };
        storage::atomic_write(&store.dir.join("runtime.json"), &runtime).unwrap();
        wait_for_engine(&store.dir, std::time::Duration::ZERO).unwrap();
        let saved = begin_focus_session(25, vec!["social".into()], "Focus".into(), &store).unwrap();
        let session = saved.active_session.unwrap();
        assert_eq!(session.ends_at - session.started_at, 25 * 60);
        assert!(storage::read_config(&store.dir)
            .unwrap()
            .active_session
            .is_some());
    }
    #[test]
    fn startup_errors_and_timeouts_do_not_pass_as_ready() {
        let dir = tempfile::tempdir().unwrap();
        assert!(wait_for_engine(dir.path(), std::time::Duration::ZERO)
            .unwrap_err()
            .contains("No session was started"));
        let runtime = Runtime {
            online: true,
            heartbeat: chrono::Utc::now().timestamp(),
            error: Some("Cannot access hosts".into()),
            ..Runtime::default()
        };
        storage::atomic_write(&dir.path().join("runtime.json"), &runtime).unwrap();
        assert_eq!(
            wait_for_engine(dir.path(), std::time::Duration::ZERO).unwrap_err(),
            "Cannot access hosts"
        );
    }
}
