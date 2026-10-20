#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--restore-hosts") {
        if let Err(error) = arceo_lib::daemon::restore_hosts() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("--blocker-daemon") {
        if let Some(dir) = args.get(2) {
            if let Err(error) = arceo_lib::daemon::run(std::path::PathBuf::from(dir)) {
                eprintln!("Arceo engine: {error}");
                std::process::exit(1);
            }
        }
        return;
    }
    arceo_lib::run();
}
