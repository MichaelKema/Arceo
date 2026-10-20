#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--prepare-browser-protection") {
        let result = args
            .get(2)
            .map(std::path::PathBuf::from)
            .ok_or("Missing Arceo data folder".to_string())
            .and_then(|dir| arceo_lib::browser::prepare(&dir));
        match result {
            Ok(status) => println!("{}", serde_json::to_string(&status).unwrap()),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if args
        .get(1)
        .is_some_and(|a| arceo_lib::browser::is_origin(a))
        || args.get(1).map(String::as_str) == Some("--browser-native-host")
    {
        let dir = if args.get(1).map(String::as_str) == Some("--browser-native-host") {
            args.get(2)
                .map(std::path::PathBuf::from)
                .ok_or("Missing local browser data folder".to_string())
        } else {
            arceo_lib::browser::default_dir()
        };
        if let Err(error) = dir.and_then(arceo_lib::browser::run_native) {
            eprintln!("Arceo browser connection: {error}");
            std::process::exit(1);
        }
        return;
    }
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
