use std::{collections::BTreeSet, fs, io::Write, path::Path};
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
        let mut hosts = BTreeSet::new();
        for domain in domains {
            let normalized = crate::model::normalize_domain(domain)?;
            hosts.insert(normalized.clone());
            hosts.insert(format!("www.{normalized}"));
        }
        for host in hosts {
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
    flush_dns();
    Ok(())
}
fn flush_dns() {
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
        let _ = std::process::Command::new("ipconfig")
            .arg("/flushdns")
            .creation_flags(0x08000000)
            .status();
    }
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
}
