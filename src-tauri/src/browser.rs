//! Local native-messaging bridge. Only configured block rules leave this process;
//! the extension never sends browsing addresses, page contents, or history here.
use crate::{model, storage};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
pub const HOST: &str = "app.arceo.browser";
pub fn extension_id() -> &'static str {
    include_str!("../../browser-extension/extension-id.txt").trim()
}
pub fn is_origin(value: &str) -> bool {
    value == format!("chrome-extension://{}/", extension_id())
}
pub fn default_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let dir = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let dir =
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let dir: Option<PathBuf> = None;
    dir.map(|d| d.join("app.arceo.desktop"))
        .ok_or("Cannot find the Arceo data folder".into())
}
#[derive(Default, Serialize, Deserialize)]
pub struct BrowserRuntime {
    pub heartbeat: i64,
    pub count: usize,
    pub error: Option<String>,
}
#[derive(Serialize)]
pub struct Status {
    pub prepared: bool,
    pub connected: bool,
    pub count: usize,
    pub error: Option<String>,
    pub extension_path: String,
}
pub fn status(dir: &Path) -> Status {
    let runtime: BrowserRuntime = std::fs::read(dir.join("browser-runtime.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let age = chrono::Utc::now().timestamp() - runtime.heartbeat;
    Status {
        prepared: dir.join("browser-extension/manifest.json").is_file(),
        connected: (0..5).contains(&age),
        count: runtime.count,
        error: runtime.error,
        extension_path: dir.join("browser-extension").to_string_lossy().into_owned(),
    }
}
#[derive(Serialize)]
struct Policy {
    r#type: &'static str,
    domains: Vec<String>,
    expires_at: i64,
    error: Option<String>,
}
fn policy(dir: &Path) -> Policy {
    let mut result = Policy {
        r#type: "policy",
        domains: Vec::new(),
        expires_at: chrono::Utc::now().timestamp_millis() + 5000,
        error: None,
    };
    match storage::read_config(dir) {
        Ok(config) => {
            let ids = model::effective_groups(&config, chrono::Local::now());
            result.domains = config
                .groups
                .iter()
                .filter(|g| ids.contains(&g.id))
                .flat_map(|g| &g.domains)
                .filter_map(|d| model::normalize_domain(d).ok())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            if serde_json::to_vec(&result).map_or(true, |data| data.len() > 900_000) {
                result.domains.clear();
                result.error = Some("Too many website rules for browser protection. Use a smaller set of active block lists.".into());
            }
        }
        Err(_) => result.error = Some("Open Arceo to load your local block lists.".into()),
    }
    result
}
fn read_frame(reader: &mut impl Read) -> Result<Option<serde_json::Value>, String> {
    let mut length = [0u8; 4];
    if reader.read(&mut length[..1]).map_err(|e| e.to_string())? == 0 {
        return Ok(None);
    }
    reader
        .read_exact(&mut length[1..])
        .map_err(|e| e.to_string())?;
    let length = u32::from_ne_bytes(length) as usize;
    if length == 0 || length > 4096 {
        return Err("Invalid browser message length".into());
    }
    let mut data = vec![0u8; length];
    reader.read_exact(&mut data).map_err(|e| e.to_string())?;
    serde_json::from_slice(&data)
        .map(Some)
        .map_err(|_| "Invalid browser message".into())
}
fn write_frame(writer: &mut impl Write, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() > 1_000_000 {
        return Err("Browser message is too large".into());
    }
    writer
        .write_all(&(bytes.len() as u32).to_ne_bytes())
        .and_then(|_| writer.write_all(&bytes))
        .and_then(|_| writer.flush())
        .map_err(|e| e.to_string())
}
pub fn run_native(dir: PathBuf) -> Result<(), String> {
    let alive = Arc::new(AtomicBool::new(true));
    let reading = alive.clone();
    let status_dir = dir.clone();
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        while let Ok(Some(message)) = read_frame(&mut input) {
            match message.get("op").and_then(|v| v.as_str()) {
                Some("hello") => {}
                Some("applied") => {
                    let runtime = BrowserRuntime {
                        heartbeat: chrono::Utc::now().timestamp(),
                        count: message
                            .get("count")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0)
                            .min(50_000) as usize,
                        error: message
                            .get("error")
                            .and_then(|v| v.as_str())
                            .map(|s| s.chars().take(250).collect()),
                    };
                    let _ =
                        storage::atomic_write(&status_dir.join("browser-runtime.json"), &runtime);
                }
                _ => break,
            }
        }
        reading.store(false, Ordering::Relaxed);
    });
    let mut output = std::io::stdout().lock();
    while alive.load(Ordering::Relaxed) {
        write_frame(&mut output, &policy(&dir))?;
        std::thread::sleep(std::time::Duration::from_millis(750));
    }
    Ok(())
}

pub fn prepare(dir: &Path) -> Result<Status, String> {
    let folder = dir.join("browser-extension");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let files: &[(&str, &[u8])] = &[
        (
            "manifest.json",
            include_bytes!("../../browser-extension/manifest.json"),
        ),
        (
            "background.js",
            include_bytes!("../../browser-extension/background.js"),
        ),
        (
            "policy.js",
            include_bytes!("../../browser-extension/policy.js"),
        ),
        (
            "blocked.html",
            include_bytes!("../../browser-extension/blocked.html"),
        ),
        (
            "blocked.js",
            include_bytes!("../../browser-extension/blocked.js"),
        ),
        (
            "style.css",
            include_bytes!("../../browser-extension/style.css"),
        ),
        (
            "popup.html",
            include_bytes!("../../browser-extension/popup.html"),
        ),
        (
            "popup.js",
            include_bytes!("../../browser-extension/popup.js"),
        ),
    ];
    for (name, data) in files {
        std::fs::write(folder.join(name), data).map_err(|e| e.to_string())?;
    }
    let manifest = serde_json::json!({ "name": HOST, "description": "Arceo offline focus rules", "path": std::env::current_exe().map_err(|e| e.to_string())?, "type": "stdio", "allowed_origins": [format!("chrome-extension://{}/", extension_id())] });
    let manifest_path = dir.join("browser-host.json");
    storage::atomic_write(&manifest_path, &manifest)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let registry =
            PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
                .join("System32/reg.exe");
        for browser in ["Google\\Chrome", "Microsoft\\Edge", "Chromium"] {
            let key = format!("HKCU\\Software\\{browser}\\NativeMessagingHosts\\{HOST}");
            for view in ["/reg:32", "/reg:64"] {
                let output = std::process::Command::new(&registry)
                    .args(["ADD", &key, "/ve", "/t", "REG_SZ", "/d"])
                    .arg(&manifest_path)
                    .args(["/f", view])
                    .creation_flags(0x08000000)
                    .output()
                    .map_err(|e| e.to_string())?;
                if !output.status.success() {
                    return Err("Could not register Arceo's local browser connection.".into());
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").ok_or("Cannot find your home folder")?;
        for browser in ["Google/Chrome", "Microsoft Edge", "Chromium"] {
            let location = PathBuf::from(&home)
                .join("Library/Application Support")
                .join(browser)
                .join("NativeMessagingHosts");
            std::fs::create_dir_all(&location).map_err(|e| e.to_string())?;
            storage::atomic_write(&location.join(format!("{HOST}.json")), &manifest)?;
        }
    }
    Ok(status(dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_protocol_frames_and_bounds_input() {
        let message = serde_json::json!({"op":"applied","count":2});
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &message).unwrap();
        let mut input = std::io::Cursor::new(bytes);
        assert_eq!(read_frame(&mut input).unwrap(), Some(message));
        assert!(read_frame(&mut input).unwrap().is_none());
        assert!(read_frame(&mut std::io::Cursor::new(5000u32.to_ne_bytes())).is_err());
        assert!(!is_origin("chrome-extension://untrusted/"));
        assert!(is_origin(&format!(
            "chrome-extension://{}/",
            extension_id()
        )));
    }
    #[test]
    fn browser_policy_is_local_and_expires_with_the_timer() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = model::Config {
            engine_enabled: true,
            ..model::Config::default()
        };
        let now = chrono::Utc::now().timestamp();
        config.active_session = Some(model::Session {
            id: "test".into(),
            name: "test".into(),
            group_ids: vec!["social".into()],
            started_at: now - 5,
            ends_at: now + 60,
            ended_at: None,
        });
        storage::atomic_write(&dir.path().join("config.json"), &config).unwrap();
        let active = policy(dir.path());
        assert!(active.domains.contains(&"x.com".into()));
        assert!(active.domains.contains(&"twitter.com".into()));
        assert!(active.expires_at - chrono::Utc::now().timestamp_millis() <= 5000);
        config.active_session.as_mut().unwrap().ends_at = now - 1;
        storage::atomic_write(&dir.path().join("config.json"), &config).unwrap();
        assert!(policy(dir.path()).domains.is_empty());
    }
}
