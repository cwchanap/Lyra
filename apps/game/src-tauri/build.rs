fn main() {
    // The e2e WebDriver capability is inlined in `tauri.e2e.conf.json` (not a
    // separate file in `capabilities/`), so Tauri only sees the
    // `wdio-webdriver:default` permission when building with the e2e config.
    // The base `tauri.conf.json` sets `security.capabilities: ["default"]`,
    // so non-e2e builds never reference the wdio-webdriver plugin. This
    // avoids the race where concurrent e2e and non-e2e builds both wrote/
    // removed the same `capabilities/wdio-e2e.json` source-tree file.
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_E2E");
    tauri_build::build();
}
