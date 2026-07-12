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
        if let Err(err) = fs::remove_file(&cap_path) {
            // NotFound is benign (TOCTOU: removed between exists() and here);
            // any other failure means a stale e2e capability could leak into a
            // non-e2e build, so surface it loudly.
            if err.kind() != std::io::ErrorKind::NotFound {
                panic!("remove capabilities/wdio-e2e.json: {err}");
            }
        }
    }

    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_E2E");
    tauri_build::build();
}
