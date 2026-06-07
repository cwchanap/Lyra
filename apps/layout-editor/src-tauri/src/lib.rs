use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFile {
    path: String,
    contents: String,
}

#[tauri::command]
fn read_project_file(path: String) -> Result<ProjectFile, String> {
    let path_buf = checked_existing_project_path(&path)?;
    let contents = fs::read_to_string(&path_buf)
        .map_err(|error| format!("failed to read {}: {error}", path_buf.display()))?;
    Ok(ProjectFile { path, contents })
}

#[tauri::command]
fn write_project_file(path: String, contents: String) -> Result<(), String> {
    let root = workspace_root()?;
    write_project_file_at_root(&root, &path, contents)
}

fn write_project_file_at_root(root: &Path, path: &str, contents: String) -> Result<(), String> {
    let path_buf = checked_project_path_from_root(root, path)?;
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create parent directory {}: {error}",
                parent.display()
            )
        })?;
        ensure_path_stays_in_root(root, parent)?;
    }
    if path_buf.exists() {
        ensure_path_stays_in_root(root, &path_buf)?;
    }
    fs::write(&path_buf, contents)
        .map_err(|error| format!("failed to write {}: {error}", path_buf.display()))
}

fn checked_existing_project_path(path: &str) -> Result<PathBuf, String> {
    let root = workspace_root()?;
    let path_buf = checked_project_path_from_root(&root, path)?;
    ensure_path_stays_in_root(&root, &path_buf)
}

fn checked_project_path_from_root(root: &Path, path: &str) -> Result<PathBuf, String> {
    let root = normalize_existing_root(root)?;
    let requested = Path::new(path);
    if requested.is_absolute() {
        return Err("path escapes project root".into());
    }

    let mut resolved = root.clone();
    for component in requested.components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if resolved == root {
                    return Err("path escapes project root".into());
                }
                resolved.pop();
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("path escapes project root".into());
            }
        }
    }

    if !resolved.starts_with(&root) {
        return Err("path escapes project root".into());
    }

    Ok(resolved)
}

fn ensure_path_stays_in_root(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = normalize_existing_root(root)?;
    let normalized = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve project path {}: {error}", path.display()))?;
    if !normalized.starts_with(root) {
        return Err("path escapes project root".into());
    }
    Ok(normalized)
}

fn workspace_root() -> Result<PathBuf, String> {
    let mut dir = std::env::current_dir()
        .map_err(|error| format!("failed to resolve current dir: {error}"))?;
    loop {
        if dir.join("docs/stories_plan").is_dir() && dir.join("src-tauri/resources/scenes").is_dir()
        {
            return normalize_existing_root(&dir);
        }
        if !dir.pop() {
            return Err("failed to locate Lyra workspace root".into());
        }
    }
}

fn normalize_existing_root(root: &Path) -> Result<PathBuf, String> {
    root.canonicalize().map_err(|error| {
        format!(
            "failed to resolve workspace root {}: {error}",
            root.display()
        )
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_project_file,
            write_project_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lyra Layout Editor");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn checked_project_path_rejects_parent_escape() {
        let root = temp_workspace_root();

        let result = checked_project_path_from_root(&root, "../outside.json");

        assert!(result.is_err());
    }

    #[test]
    fn write_project_file_creates_parent_directories() {
        let root = temp_workspace_root();
        let path = "docs/stories_plan/chapter_1/new_scene.layout.json";

        write_project_file_at_root(&root, path, "{}\n".to_string()).unwrap();

        assert_eq!(fs::read_to_string(root.join(path)).unwrap(), "{}\n");
    }

    fn temp_workspace_root() -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!(
            "lyra-layout-editor-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("docs/stories_plan")).unwrap();
        fs::create_dir_all(root.join("src-tauri/resources/scenes")).unwrap();
        root
    }
}
