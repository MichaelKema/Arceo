use serde::Serialize;
use std::{fs, io::Write, path::Path};
pub fn atomic_write(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing data directory")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(fs::Permissions::from_mode(0o644))
            .map_err(|e| e.to_string())?;
    }
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn read_config(dir: &Path) -> Result<crate::model::Config, String> {
    serde_json::from_str(&fs::read_to_string(dir.join("config.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
pub fn read_runtime(dir: &Path) -> crate::model::Runtime {
    let mut runtime: crate::model::Runtime = fs::read_to_string(dir.join("runtime.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    runtime.online = runtime.online && chrono::Utc::now().timestamp() - runtime.heartbeat < 10;
    runtime
}
