// Integration tests: the immutable compiler-generated content manifest is a
// required packaged startup resource, loaded after the authoritative catalog.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use lyra_lib::game::GameEngine;

struct TestDir(PathBuf);

impl TestDir {
    fn new(label: &str) -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "lyra-content-manifest-startup-{}-{label}-{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn write_startup_resources(dir: &Path) {
    std::fs::create_dir_all(dir.join("chapter_1")).unwrap();
    std::fs::write(
        dir.join("chapters.json"),
        r#"{
  "chapters": [{
    "id": "chapter_1",
    "title": "Chapter 1",
    "summary": "Summary",
    "scenes": [{"type":"linear","file":"chapter_1/scene_1.json"}]
  }]
}"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("story_catalog.json"),
        r#"{
  "schemaVersion": 2,
  "facts": [],
  "questions": [],
  "objectives": [],
  "authorizations": [],
  "sourceGroups": [],
  "evidenceIndex": [],
  "statementsIndex": []
}"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("chapter_1/scene_1.json"),
        r#"{"type":"linear","id":"scene_1","title":"Scene 1","summary":"Scene 1","queue":[]}"#,
    )
    .unwrap();
}

fn write_manifest(dir: &Path, json: &str) {
    std::fs::write(dir.join("save_content_manifest.json"), json).unwrap();
}

fn startup_error(dir: &TestDir) -> lyra_lib::game::GameError {
    match GameEngine::new_started(dir.path().to_path_buf()) {
        Ok(_) => panic!("engine startup unexpectedly succeeded"),
        Err(error) => error,
    }
}

#[test]
fn engine_startup_accepts_a_valid_minimal_content_manifest() {
    let dir = TestDir::new("valid");
    write_startup_resources(dir.path());
    write_manifest(
        dir.path(),
        r#"{"manifestVersion":1,"contentRevision":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}"#,
    );

    assert!(GameEngine::new_started(dir.path().to_path_buf()).is_ok());
}

#[test]
fn engine_startup_rejects_a_missing_content_manifest() {
    let dir = TestDir::new("missing");
    write_startup_resources(dir.path());

    let error = startup_error(&dir);

    assert_eq!(error.code, "contentManifestLoadFailed");
    assert!(error.message.contains("save_content_manifest.json"));
}

#[test]
fn engine_startup_rejects_malformed_content_manifest_json() {
    let dir = TestDir::new("malformed");
    write_startup_resources(dir.path());
    write_manifest(dir.path(), "{ not JSON");

    let error = startup_error(&dir);

    assert_eq!(error.code, "contentManifestLoadFailed");
    assert!(error.message.contains("save_content_manifest.json"));
}

#[test]
fn engine_startup_rejects_a_content_manifest_with_missing_required_fields() {
    let dir = TestDir::new("missing-fields");
    write_startup_resources(dir.path());
    write_manifest(dir.path(), r#"{"manifestVersion":1}"#);

    let error = startup_error(&dir);

    assert_eq!(error.code, "contentManifestLoadFailed");
    assert!(error.message.contains("save_content_manifest.json"));
}

#[test]
fn engine_startup_rejects_a_content_manifest_with_unknown_fields() {
    let dir = TestDir::new("unknown-fields");
    write_startup_resources(dir.path());
    write_manifest(
        dir.path(),
        r#"{"manifestVersion":1,"contentRevision":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","futureField":"oops"}"#,
    );

    let error = startup_error(&dir);

    assert_eq!(error.code, "contentManifestLoadFailed");
    assert!(error.message.contains("save_content_manifest.json"));
}

#[test]
fn engine_startup_rejects_an_unsupported_content_manifest_version() {
    let dir = TestDir::new("unsupported-version");
    write_startup_resources(dir.path());
    write_manifest(dir.path(), r#"{"manifestVersion":2}"#);

    let error = startup_error(&dir);

    assert_eq!(error.code, "unsupportedContentManifestVersion");
    assert!(error.message.contains("save_content_manifest.json"));
    assert!(error.message.contains('2'));
}

#[test]
fn engine_startup_rejects_a_content_revision_with_an_invalid_prefix() {
    let dir = TestDir::new("invalid-prefix");
    write_startup_resources(dir.path());
    write_manifest(
        dir.path(),
        r#"{"manifestVersion":1,"contentRevision":"sha512:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}"#,
    );

    let error = startup_error(&dir);

    assert_eq!(error.code, "contentManifestValidationFailed");
}

#[test]
fn engine_startup_rejects_a_content_revision_with_an_invalid_digest_length() {
    let dir = TestDir::new("invalid-length");
    write_startup_resources(dir.path());
    write_manifest(
        dir.path(),
        &format!(
            r#"{{"manifestVersion":1,"contentRevision":"sha256:{}"}}"#,
            "0".repeat(63)
        ),
    );

    let error = startup_error(&dir);

    assert_eq!(error.code, "contentManifestValidationFailed");
}

#[test]
fn engine_startup_rejects_a_content_revision_with_uppercase_hex() {
    let dir = TestDir::new("uppercase");
    write_startup_resources(dir.path());
    write_manifest(
        dir.path(),
        r#"{"manifestVersion":1,"contentRevision":"sha256:ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD"}"#,
    );

    let error = startup_error(&dir);

    assert_eq!(error.code, "contentManifestValidationFailed");
}

#[test]
fn engine_startup_rejects_a_content_revision_with_non_hex_characters() {
    let dir = TestDir::new("non-hex");
    write_startup_resources(dir.path());
    write_manifest(
        dir.path(),
        r#"{"manifestVersion":1,"contentRevision":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaag"}"#,
    );

    let error = startup_error(&dir);

    assert_eq!(error.code, "contentManifestValidationFailed");
}
