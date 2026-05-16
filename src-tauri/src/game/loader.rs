// src-tauri/src/game/loader.rs
use std::fs;
use std::path::Path;
use crate::game::error::GameError;
use crate::game::schema::{ChaptersIndexJson, SceneJson};

pub fn load_chapters_index(resources_dir: &Path) -> Result<ChaptersIndexJson, GameError> {
    let path = resources_dir.join("chapters.json");
    let raw = fs::read_to_string(&path).map_err(|e| {
        GameError::scene_load_failed(format!("failed to read {}: {}", path.display(), e))
    })?;
    serde_json::from_str(&raw).map_err(|e| {
        GameError::parse_failure(format!("invalid chapters.json: {e}"))
    })
}

pub fn load_scene(resources_dir: &Path, file_rel: &str) -> Result<SceneJson, GameError> {
    let path = resources_dir.join(file_rel);
    let raw = fs::read_to_string(&path).map_err(|e| {
        GameError::scene_load_failed(format!("failed to read {}: {}", path.display(), e))
    })?;
    serde_json::from_str(&raw).map_err(|e| {
        GameError::parse_failure(format!("invalid scene JSON {}: {}", path.display(), e))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn unique_temp_dir() -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!("lyra-loader-test-{}-{}", std::process::id(), n));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn loads_a_valid_chapters_index() {
        let d = unique_temp_dir();
        let p = d.join("chapters.json");
        let mut f = fs::File::create(&p).unwrap();
        writeln!(f, r#"{{"chapters":[]}}"#).unwrap();
        let idx = load_chapters_index(&d).unwrap();
        assert!(idx.chapters.is_empty());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn surfaces_a_typed_error_for_missing_file() {
        let d = unique_temp_dir();
        let err = load_chapters_index(&d).unwrap_err();
        assert_eq!(err.code, "sceneLoadFailed");
        let _ = fs::remove_dir_all(d);
    }
}
