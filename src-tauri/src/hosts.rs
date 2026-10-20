use std::sync::atomic::{AtomicBool, Ordering};
use std::{collections::BTreeSet, fs, io::Write, path::Path};
static DNS_FLUSH_PENDING: AtomicBool = AtomicBool::new(false);
pub const BEGIN: &str = "# BEGIN ARCEO MANAGED BLOCK";
pub const END: &str = "# END ARCEO MANAGED BLOCK";
pub fn render(original: &str, domains: &BTreeSet<String>) -> Result<String, String> {
    if domains.is_empty()
        && !original
            .lines()
            .any(|line| line.trim() == BEGIN || line.trim() == END)
    {
        return Ok(original.to_owned());
    }
    let mut kept = Vec::new();
    let mut in_block = false;
    for line in original.lines() {
        if line.trim() == BEGIN {
            if in_block {
                return Err("Hosts file has duplicate Arceo markers".into());
            }
            in_block = true;
            continue;
        }
        if line.trim() == END {
            if !in_block {
                return Err("Hosts file has an unmatched Arceo marker".into());
            }
            in_block = false;
            continue;
        }
        if !in_block {
            kept.push(line);
        }
    }
    if in_block {
        return Err(
            "Hosts file has an unfinished Arceo block. Restore it before continuing.".into(),
        );
    }
    let mut blocked_hosts = BTreeSet::new();
    for domain in domains {
        let normalized = crate::model::normalize_domain(domain)?;
        blocked_hosts.insert(normalized.clone());
        blocked_hosts.insert(format!("www.{normalized}"));
    }
    // Duplicate mappings outside our section can let Windows resolve a blocked
    // name to an additional, reachable address. Preserve the user's entries and
    // report the conflict instead of claiming that blocking succeeded.
    for line in &kept {
        let mut fields = line.split('#').next().unwrap_or("").split_whitespace();
        if let Some(ip) = fields
            .next()
            .and_then(|v| v.parse::<std::net::IpAddr>().ok())
        {
            if !ip.is_unspecified() {
                for host in fields {
                    let host = host.trim_end_matches('.').to_lowercase();
                    if blocked_hosts.contains(&host) {
                        return Err(format!("A conflicting hosts entry for {host} prevents website blocking. Remove that mapping or choose a different block list, then retry."));
                    }
                }
            }
        }
    }
    let newline = if original.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    while kept.last() == Some(&"") {
        kept.pop();
    }
    let mut result = kept.join(newline);
    result.push_str(newline);
    if !domains.is_empty() {
        result.push_str(newline);
        result.push_str(BEGIN);
        result.push_str(newline);
        for host in blocked_hosts {
            result.push_str(&format!("0.0.0.0 {host}{newline}:: {host}{newline}"));
        }
        result.push_str(END);
        result.push_str(newline);
    }
    Ok(result)
}
pub fn apply(path: &Path, domains: &BTreeSet<String>) -> Result<(), String> {
    let original = fs::read_to_string(path).map_err(|e| format!("Cannot read hosts file: {e}"))?;
    let updated = render(&original, domains)?;
    if updated == original {
        if DNS_FLUSH_PENDING.load(Ordering::Relaxed) {
            flush_dns()?;
            DNS_FLUSH_PENDING.store(false, Ordering::Relaxed);
        }
        return Ok(());
    }
    // Preserve inode, permissions and ACLs; serialize Arceo writers with the daemon lock.
    // Never replace unrelated host entries or follow user-supplied output paths.
    let mut file = fs::OpenOptions::new().write(true).open(path).map_err(|e| {
        format!("Administrator permission is needed to update website blocking: {e}")
    })?;
    file.write_all(updated.as_bytes())
        .map_err(|e| e.to_string())?;
    file.set_len(updated.len() as u64)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    DNS_FLUSH_PENDING.store(true, Ordering::Relaxed);
    flush_dns()?;
    DNS_FLUSH_PENDING.store(false, Ordering::Relaxed);
    let actual =
        fs::read_to_string(path).map_err(|e| format!("Cannot verify website rules: {e}"))?;
    if actual != updated {
        return Err(
            "Another program changed the hosts file before website blocking could be verified."
                .into(),
        );
    }
    Ok(())
}
fn flush_dns() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("/usr/bin/dscacheutil")
            .arg("-flushcache")
            .status();
        let _ = std::process::Command::new("/usr/bin/killall")
            .args(["-HUP", "mDNSResponder"])
            .status();
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let program = std::path::PathBuf::from(
            std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
        )
        .join("System32")
        .join("ipconfig.exe");
        let status = std::process::Command::new(program)
            .arg("/flushdns")
            .creation_flags(0x08000000)
            .status().map_err(|e| format!("Website rules were written, but the Windows DNS cache could not be flushed: {e}"))?;
        if !status.success() {
            return Err("Website rules were written, but Windows could not flush its DNS cache. Retry enabling the blocking engine with administrator approval.".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_other_entries_and_restores_after_stop() {
        let base = "127.0.0.1 localhost\n192.168.1.2 internal.test\n";
        let blocked = render(base, &BTreeSet::from(["reddit.com".into()])).unwrap();
        assert!(blocked.contains(":: www.reddit.com"));
        assert_eq!(render(&blocked, &BTreeSet::new()).unwrap(), base);
        assert_eq!(
            render(&blocked, &BTreeSet::from(["reddit.com".into()])).unwrap(),
            blocked
        );
    }
    #[test]
    fn malformed_markers_do_not_destroy_data() {
        assert!(render(
            &format!("127.0.0.1 localhost\n{BEGIN}\nimportant"),
            &BTreeSet::new()
        )
        .is_err());
    }
    #[test]
    fn crlf_is_preserved() {
        assert_eq!(
            render("127.0.0.1 localhost\r\n", &BTreeSet::new()).unwrap(),
            "127.0.0.1 localhost\r\n"
        );
    }
    #[test]
    fn x_rules_cover_both_address_families_and_repair_external_removal() {
        let domains = BTreeSet::from(["x.com".into(), "twitter.com".into()]);
        let base = "127.0.0.1 localhost\r\n";
        let blocked = render(base, &domains).unwrap();
        for host in ["x.com", "www.x.com", "twitter.com", "www.twitter.com"] {
            assert!(blocked.contains(&format!("0.0.0.0 {host}\r\n:: {host}\r\n")));
        }
        let externally_changed = blocked.replace("0.0.0.0 x.com\r\n:: x.com\r\n", "");
        assert_eq!(render(&externally_changed, &domains).unwrap(), blocked);
        assert_eq!(render(&blocked, &BTreeSet::new()).unwrap(), base);
    }
    #[test]
    fn conflicting_user_mappings_are_reported_and_preserved() {
        let domains = BTreeSet::from(["x.com".into()]);
        assert!(
            render("192.0.2.1 custom.test X.COM # custom mapping\n", &domains)
                .unwrap_err()
                .contains("conflicting hosts entry for x.com")
        );
        let unrelated = "192.0.2.1 custom.test\n";
        let blocked = render(unrelated, &domains).unwrap();
        assert_eq!(render(&blocked, &BTreeSet::new()).unwrap(), unrelated);
    }
}
