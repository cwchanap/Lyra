// Integration test: engine startup requires the story catalog resource before
// it attempts to load the initial scene. Moved out of the catalog unit-test
// module because it exercises `GameEngine::new_started`, not `StoryCatalog`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use lyra_lib::game::GameEngine;

struct TestDir(PathBuf);

impl TestDir {
    fn new(label: &str) -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "lyra-story-catalog-startup-{}-{label}-{n}",
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

#[test]
fn engine_startup_requires_catalog_before_loading_initial_scene() {
    let dir = TestDir::new("startup");
    std::fs::write(
        dir.path().join("chapters.json"),
        r#"{
  "chapters": [{
    "id": "chapter_1",
    "title": "Chapter 1",
    "summary": "Summary",
    "scenes": [{"type":"linear","file":"chapter_1/missing_scene.json"}]
  }]
}"#,
    )
    .unwrap();

    let error = match GameEngine::new_started(dir.path().to_path_buf()) {
        Ok(_) => panic!("engine startup unexpectedly succeeded without a story catalog"),
        Err(error) => error,
    };

    assert_eq!(error.code, "storyCatalogLoadFailed");
}
