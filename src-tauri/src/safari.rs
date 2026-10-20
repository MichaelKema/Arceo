//! User-session Safari enforcement. No browsing URLs are persisted or sent over a network.
#[cfg(any(target_os = "macos", test))]
use crate::model::effective_groups;
use crate::model::Config;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default, serde::Serialize)]
pub struct Status {
    pub error: Option<String>,
}

#[derive(Clone, Default)]
pub struct Guard(Arc<Mutex<Status>>);
impl Guard {
    pub fn status(&self) -> Status {
        self.0.lock().unwrap().clone()
    }
    pub fn clear(&self) {
        *self.0.lock().unwrap() = Status::default();
    }
    pub fn start(&self, config: Arc<Mutex<Config>>) {
        #[cfg(target_os = "macos")]
        {
            let guard = self.clone();
            std::thread::spawn(move || loop {
                let domains = {
                    let config = config.lock().unwrap();
                    active_domains(&config)
                };
                if !domains.is_empty() && guard.status().error.is_none() {
                    if let Err(error) = enforce(&config) {
                        guard.0.lock().unwrap().error = Some(error);
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(750));
            });
        }
        #[cfg(not(target_os = "macos"))]
        let _ = config;
    }
}

#[cfg(any(target_os = "macos", test))]
fn active_domains(config: &Config) -> Vec<String> {
    if !config.safari_protection {
        return Vec::new();
    }
    let ids = effective_groups(config, chrono::Local::now());
    config
        .groups
        .iter()
        .filter(|g| ids.contains(&g.id))
        .flat_map(|g| g.domains.clone())
        .collect()
}

#[cfg(any(target_os = "macos", test))]
fn blocked_host(address: &str, domains: &[String]) -> Option<String> {
    let url = url::Url::parse(address).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?.trim_end_matches('.').to_lowercase();
    domains
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
        .then_some(host)
}

#[cfg(any(target_os = "macos", test))]
fn block_page(host: &str) -> String {
    // host comes only from Url::host_str, never raw page content or a title.
    let html = format!(
        r##"<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Time to focus · Arceo</title><style>body{{background:#000;color:#eee;font:18px system-ui;display:grid;place-content:center;min-height:95vh;margin:0;padding:0 24px}}main{{max-width:520px}}small,a{{color:#bda0f5}}h1{{font-size:40px}}p{{color:#aaa;line-height:1.6}}a{{display:inline-block;padding:14px 22px;border:1px solid #49375e;border-radius:12px;text-decoration:none}}</style><main><small>ARCEO · YOUR TIME, ON PURPOSE</small><h1>A little room to focus.</h1><p>{host} is in an active block list. Come back when your focus timer or schedule ends.</p><a href="https://{host}/">Try again</a><p>This page works completely offline.</p></main>"##
    );
    format!(
        "data:text/html;charset=utf-8,{}",
        url::form_urlencoded::byte_serialize(html.as_bytes())
            .collect::<String>()
            .replace('+', "%20")
    )
}

#[cfg(any(target_os = "macos", test))]
fn quoted(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\r', "\\r")
            .replace('\n', "\\n")
    )
}

#[cfg(target_os = "macos")]
const TABS: &str = r#"
if application id "com.apple.Safari" is not running then return ""
set rows to ""
tell application id "com.apple.Safari"
    repeat with w in windows
        set windowID to id of w
        repeat with i from 1 to count of tabs of w
            try
                set address to URL of tab i of w
                if address is not missing value then set rows to rows & (windowID as text) & tab & (i as text) & tab & address & linefeed
            end try
        end repeat
    end repeat
end tell
return rows
"#;

#[cfg(target_os = "macos")]
fn script(source: &str) -> Result<String, String> {
    let output = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", source])
        .output()
        .map_err(|_| "Safari protection could not run.".to_string())?;
    if !output.status.success() {
        // Do not expose raw scripting errors, which can contain browsing URLs.
        return Err("Safari protection needs permission. Allow Arceo → Safari in System Settings → Privacy & Security → Automation, then retry Enable Safari protection.".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn authorize() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Request consent without collecting browsing URLs or launching Safari.
        let result = script(
            r#"if application id "com.apple.Safari" is not running then return "closed"
tell application id "com.apple.Safari" to count windows"#,
        )?;
        if result.trim() == "closed" {
            return Err("Open Safari, then retry Enable Safari protection.".into());
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    Err("Safari protection is available on macOS.".into())
}

pub fn check_permission() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        script(
            r#"if application id "com.apple.Safari" is running then
        tell application id "com.apple.Safari" to count windows
    end if"#,
        )
        .map(|_| ())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn enforce(config: &Mutex<Config>) -> Result<(), String> {
    let rows = script(TABS)?;
    for row in rows.lines() {
        let mut parts = row.splitn(3, '\t');
        let (Some(w), Some(i), Some(address)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let (Ok(w), Ok(i)) = (w.parse::<u64>(), i.parse::<usize>()) else {
            continue;
        };
        // Safari can be busy; a timer might have expired or been stopped while
        // the tab query was pending. Re-evaluate before each replacement.
        let domains = active_domains(&config.lock().unwrap());
        if let Some(host) = blocked_host(address, &domains) {
            // Re-check the URL in the same Apple event before replacing it: a reordered or
            // navigated tab must never have its unrelated page overwritten.
            script(&redirect_script(w, i, address, &host))?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn redirect_script(window: u64, index: usize, address: &str, host: &str) -> String {
    format!(
        r#"tell application id "com.apple.Safari"
try
    set t to tab {index} of window id {window}
    if URL of t is {original} then set URL of t to {destination}
end try
end tell"#,
        original = quoted(address),
        destination = quoted(&block_page(host))
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn safari_scripts_compile_without_executing_browser_actions() {
        let dir = tempfile::tempdir().unwrap();
        for (i, source) in [
            TABS.to_string(),
            redirect_script(1, 1, "https://www.reddit.com/", "www.reddit.com"),
        ]
        .iter()
        .enumerate()
        {
            let path = dir.path().join(format!("script{i}.applescript"));
            std::fs::write(&path, source).unwrap();
            let output = std::process::Command::new("/usr/bin/osacompile")
                .arg("-o")
                .arg(dir.path().join(format!("script{i}.scpt")))
                .arg(path)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
    #[test]
    fn reddit_policy_covers_cached_urls_and_subdomains_with_label_boundaries() {
        let domains = vec!["reddit.com".into()];
        for url in [
            "https://www.reddit.com/r/rust",
            "https://old.reddit.com",
            "https://REDDIT.com./",
            "http://foo.reddit.com:8080/",
        ] {
            assert!(blocked_host(url, &domains).is_some(), "{url}");
        }
        for url in [
            "https://reddit.com.example.org",
            "https://notreddit.com",
            "https://reddit.com@safe.example",
            "data:text/html,reddit.com",
            "file:///reddit.com",
        ] {
            assert!(blocked_host(url, &domains).is_none(), "{url}");
        }
    }
    #[test]
    fn local_page_has_no_network_dependencies_and_rules_stop_at_expiry() {
        let page = block_page("www.reddit.com");
        let encoded = page.strip_prefix("data:text/html;charset=utf-8,").unwrap();
        let html = url::form_urlencoded::parse(format!("x={encoded}").as_bytes())
            .next()
            .unwrap()
            .1
            .into_owned();
        assert!(html.contains("www.reddit.com is in an active block list"));
        assert!(!html.contains("<script"));
        assert!(!html.contains("src="));
        assert_eq!(quoted("a\"\\b\n"), "\"a\\\"\\\\b\\n\"");
        let mut config = Config {
            engine_enabled: true,
            safari_protection: true,
            ..Config::default()
        };
        let now = chrono::Utc::now().timestamp();
        config.active_session = Some(crate::model::Session {
            id: "test".into(),
            name: "test".into(),
            group_ids: vec!["social".into()],
            started_at: now - 10,
            ends_at: now + 100,
            ended_at: None,
        });
        assert!(active_domains(&config).contains(&"reddit.com".into()));
        config.active_session.as_mut().unwrap().ends_at = now;
        assert!(active_domains(&config).is_empty());
        config.active_session.as_mut().unwrap().ends_at = now + 100;
        config.engine_enabled = false;
        assert!(active_domains(&config).is_empty());
    }
}
