use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let cap_path = manifest_dir.join("capabilities/wdio-e2e.json");

    if env::var_os("CARGO_FEATURE_E2E").is_some() {
        let body = r#"{
  "identifier": "wdio-e2e",
  "description": "E2E-only WebDriver capability (feature e2e)",
  "windows": ["main"],
  "permissions": ["wdio-webdriver:default"]
}
"#;
        fs::write(&cap_path, body).expect("write capabilities/wdio-e2e.json");
        println!("cargo:rerun-if-changed=capabilities");
    } else if cap_path.exists() {
        let _ = fs::remove_file(&cap_path);
    }

    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_E2E");
    tauri_build::build();
}
