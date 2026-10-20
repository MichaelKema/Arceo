use chrono::{DateTime, Datelike, Local, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppTarget {
    pub id: String,
    pub name: String,
    pub path: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: String,
    pub icon: String,
    pub domains: Vec<String>,
    pub apps: Vec<AppTarget>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub group_ids: Vec<String>,
    pub days: Vec<u32>,
    pub start: String,
    pub end: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub group_ids: Vec<String>,
    pub started_at: i64,
    pub ends_at: i64,
    pub ended_at: Option<i64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    pub groups: Vec<Group>,
    pub schedules: Vec<Schedule>,
    pub sessions: Vec<Session>,
    pub active_session: Option<Session>,
    pub engine_enabled: bool,
    #[serde(default)]
    pub safari_protection: bool,
    pub daily_goal: u32,
    pub user_name: String,
}
impl Default for Config {
    fn default() -> Self {
        serde_json::from_str(include_str!("../../src/defaults.json"))
            .expect("valid bundled defaults")
    }
}
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct Runtime {
    pub online: bool,
    pub heartbeat: i64,
    pub blocked_domains: usize,
    pub blocked_apps: usize,
    pub active_schedule_ids: Vec<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub engine_version: String,
    #[serde(default)]
    pub applied_session_id: Option<String>,
}

pub fn normalize_domain(input: &str) -> Result<String, String> {
    let trimmed = input.trim().trim_start_matches("*.");
    let input = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = url::Url::parse(&input)
        .map_err(|_| "Enter a valid website, like reddit.com".to_string())?;
    let host = url
        .host_str()
        .ok_or("A website must have a domain")?
        .trim_end_matches('.')
        .to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    if !matches!(url.scheme(), "https" | "http")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || !host.contains('.')
        || host.parse::<std::net::IpAddr>().is_ok()
        || host.len() > 253
        || host.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
    {
        return Err("Use a domain name, without a port or IP address".into());
    }
    Ok(host)
}
pub fn minutes(time: &str) -> Option<u32> {
    let (h, m) = time.split_once(':')?;
    let (h, m) = (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}
pub fn schedule_active(schedule: &Schedule, now: DateTime<Local>) -> bool {
    if !schedule.enabled {
        return false;
    }
    let (Some(start), Some(end)) = (minutes(&schedule.start), minutes(&schedule.end)) else {
        return false;
    };
    let current = now.hour() * 60 + now.minute();
    let day = now.weekday().num_days_from_monday();
    if start < end {
        schedule.days.contains(&day) && current >= start && current < end
    } else if start > end {
        (current >= start && schedule.days.contains(&day))
            || (current < end && schedule.days.contains(&((day + 6) % 7)))
    } else {
        false
    }
}
pub fn effective_groups(config: &Config, now: DateTime<Local>) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    if !config.engine_enabled {
        return ids;
    }
    if let Some(session) = &config.active_session {
        if session.started_at <= now.timestamp()
            && session.ends_at > now.timestamp()
            && session.ended_at.is_none()
        {
            ids.extend(session.group_ids.clone());
        }
    }
    for schedule in &config.schedules {
        if schedule_active(schedule, now) {
            ids.extend(schedule.group_ids.clone());
        }
    }
    ids
}
pub fn allowed_app_path(path: &Path) -> bool {
    if !path.is_absolute() || !path.is_file() {
        return false;
    }
    let path = path.to_string_lossy().to_lowercase();
    let path = path.strip_prefix("\\\\?\\").unwrap_or(&path);
    if cfg!(target_os = "windows") {
        let system = std::env::var("SystemRoot")
            .unwrap_or_else(|_| "C:\\Windows".into())
            .to_lowercase();
        path.ends_with(".exe") && !path.starts_with(&system) && !path.ends_with("\\arceo.exe")
    } else {
        path.contains(".app/contents/macos/")
            && !path.starts_with("/system/")
            && !path.starts_with("/usr/")
            && !path.contains("/arceo.app/")
            && !path.ends_with("/arceo")
    }
}
impl Config {
    pub fn validate(&mut self) -> Result<(), String> {
        if self.groups.len() > 100 || self.schedules.len() > 100 {
            return Err("Up to 100 lists and schedules are supported".into());
        }
        let ids: BTreeSet<_> = self.groups.iter().map(|g| &g.id).collect();
        if ids.len() != self.groups.len() {
            return Err("Block list IDs must be unique".into());
        }
        if !(15..=1440).contains(&self.daily_goal) {
            return Err("Daily goal must be between 15 and 1440 minutes".into());
        }
        for schedule in &self.schedules {
            if schedule.name.trim().is_empty()
                || schedule.days.is_empty()
                || schedule.days.iter().any(|d| *d > 6)
                || minutes(&schedule.start).is_none()
                || minutes(&schedule.end).is_none()
                || schedule.start == schedule.end
                || schedule.group_ids.is_empty()
                || schedule.group_ids.iter().any(|id| !ids.contains(id))
            {
                return Err(
                    "Schedules need a name, days, distinct times, and an existing block list"
                        .into(),
                );
            }
        }
        if let Some(session) = &self.active_session {
            if session.group_ids.is_empty()
                || session.group_ids.iter().any(|id| !ids.contains(id))
                || session.ends_at <= session.started_at
                || session.ends_at - session.started_at > 24 * 60 * 60
            {
                return Err("Invalid focus session".into());
            }
        }
        for group in &mut self.groups {
            if group.name.trim().is_empty() || group.domains.len() > 500 || group.apps.len() > 100 {
                return Err("A list needs a name and at most 500 websites / 100 apps".into());
            }
            group.domains = group
                .domains
                .iter()
                .map(|d| normalize_domain(d))
                .collect::<Result<BTreeSet<_>, _>>()?
                .into_iter()
                .collect();
            for app in &group.apps {
                let canonical = std::fs::canonicalize(&app.path).map_err(|_| {
                    format!("{} is no longer installed at the selected path", app.name)
                })?;
                if !allowed_app_path(&canonical) {
                    return Err(
                        "Select a desktop application. System processes and Arceo are protected."
                            .into(),
                    );
                }
            }
        }
        self.sessions.truncate(1000);
        Ok(())
    }
    pub fn archive_expired(&mut self) {
        if self
            .active_session
            .as_ref()
            .is_some_and(|s| s.ends_at <= Utc::now().timestamp())
        {
            if let Some(session) = self.active_session.take() {
                self.sessions.insert(0, session);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    fn schedule() -> Schedule {
        Schedule {
            id: "s".into(),
            name: "Night".into(),
            group_ids: vec!["social".into()],
            days: vec![0],
            start: "22:00".into(),
            end: "02:00".into(),
            enabled: true,
        }
    }
    #[test]
    fn overnight_belongs_to_start_day() {
        let s = schedule();
        assert!(schedule_active(
            &s,
            Local.with_ymd_and_hms(2026, 10, 19, 23, 0, 0).unwrap()
        ));
        assert!(schedule_active(
            &s,
            Local.with_ymd_and_hms(2026, 10, 20, 1, 59, 0).unwrap()
        ));
        assert!(!schedule_active(
            &s,
            Local.with_ymd_and_hms(2026, 10, 20, 2, 0, 0).unwrap()
        ));
        assert!(!schedule_active(
            &s,
            Local.with_ymd_and_hms(2026, 10, 20, 23, 0, 0).unwrap()
        ));
    }
    #[test]
    fn domains_are_sanitized() {
        assert_eq!(
            normalize_domain("https://www.Reddit.com/r/rust").unwrap(),
            "reddit.com"
        );
        for bad in [
            "localhost",
            "127.0.0.1",
            "x.com:123",
            "x.com\n0.0.0.0 y.com",
            "file:///etc/hosts",
            "foo..com",
            "https://user:pass@reddit.com",
        ] {
            assert!(normalize_domain(bad).is_err(), "{bad}");
        }
    }
    #[test]
    fn overlapping_sources_are_unioned_and_expired_sessions_drop_out() {
        let mut c = Config {
            engine_enabled: true,
            ..Config::default()
        };
        c.schedules.push(Schedule {
            start: "09:00".into(),
            end: "17:00".into(),
            ..schedule()
        });
        let now = Local.with_ymd_and_hms(2026, 10, 19, 10, 0, 0).unwrap();
        c.active_session = Some(Session {
            id: "x".into(),
            name: "Focus".into(),
            group_ids: vec!["games".into(), "social".into()],
            started_at: now.timestamp() - 10,
            ends_at: now.timestamp() + 10,
            ended_at: None,
        });
        assert_eq!(effective_groups(&c, now).len(), 2);
        c.active_session.as_mut().unwrap().ends_at = now.timestamp();
        assert_eq!(effective_groups(&c, now), BTreeSet::from(["social".into()]));
        c.engine_enabled = false;
        assert!(effective_groups(&c, now).is_empty());
    }
}
