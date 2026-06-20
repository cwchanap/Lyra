use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Component, Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFile {
    path: String,
    contents: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorError {
    code: &'static str,
    message: String,
}

impl EditorError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn not_found(path: impl AsRef<Path>) -> Self {
        Self::new(
            "notFound",
            format!("file not found: {}", path.as_ref().display()),
        )
    }
}

#[tauri::command]
fn read_project_file(path: String) -> Result<ProjectFile, EditorError> {
    let path_buf = checked_existing_project_path(&path)?;
    let contents = fs::read_to_string(&path_buf).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            EditorError::not_found(&path_buf)
        } else {
            EditorError::new(
                "readFailed",
                format!("failed to read {}: {error}", path_buf.display()),
            )
        }
    })?;
    Ok(ProjectFile { path, contents })
}

#[tauri::command]
fn write_project_file(path: String, contents: String) -> Result<(), EditorError> {
    let root = workspace_root()?;
    write_project_file_at_root(&root, &path, contents)
}

#[tauri::command]
fn resolve_layout_path(scene_path: String) -> Result<String, EditorError> {
    let root = workspace_root()?;
    resolve_layout_path_at_root(&root, &scene_path)
}

fn write_project_file_at_root(
    root: &Path,
    path: &str,
    contents: String,
) -> Result<(), EditorError> {
    ensure_layout_sidecar_write_path(path)?;
    let path_buf = checked_project_path_from_root(root, path)?;
    ensure_parent_dirs(root, &path_buf)?;
    reject_symlink(&path_buf)?;
    write_regular_file(&path_buf, contents)
}

fn checked_existing_project_path(path: &str) -> Result<PathBuf, EditorError> {
    let root = workspace_root()?;
    let path_buf = checked_project_path_from_root(&root, path)?;
    ensure_path_stays_in_root(&root, &path_buf)
}

fn checked_project_path_from_root(root: &Path, path: &str) -> Result<PathBuf, EditorError> {
    let root = normalize_existing_root(root)?;
    let requested = Path::new(path);
    if requested.is_absolute() {
        return Err(EditorError::new("pathEscape", "path escapes project root"));
    }

    let mut resolved = root.clone();
    for component in requested.components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if resolved == root {
                    return Err(EditorError::new("pathEscape", "path escapes project root"));
                }
                resolved.pop();
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(EditorError::new("pathEscape", "path escapes project root"));
            }
        }
    }

    if !resolved.starts_with(&root) {
        return Err(EditorError::new("pathEscape", "path escapes project root"));
    }

    Ok(resolved)
}

fn ensure_layout_sidecar_write_path(path: &str) -> Result<(), EditorError> {
    let requested = Path::new(path);
    if requested
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(EditorError::new("pathEscape", "path escapes project root"));
    }

    let in_story_root =
        requested.starts_with("docs/stories_plan") || requested.starts_with("static/stories_plan");
    let is_layout_sidecar = requested
        .file_stem()
        .and_then(|s| s.to_str())
        .is_some_and(|stem| stem.ends_with(".layout"))
        && requested.extension().and_then(|e| e.to_str()) == Some("json");

    if in_story_root && is_layout_sidecar {
        Ok(())
    } else {
        Err(EditorError::new(
            "writePathNotAllowed",
            "layout editor can only write *.layout.json files under authored story roots",
        ))
    }
}

fn ensure_path_stays_in_root(root: &Path, path: &Path) -> Result<PathBuf, EditorError> {
    let root = normalize_existing_root(root)?;
    let normalized = path.canonicalize().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            EditorError::not_found(path)
        } else {
            EditorError::new(
                "pathResolveFailed",
                format!("failed to resolve project path {}: {error}", path.display()),
            )
        }
    })?;
    if !normalized.starts_with(root) {
        return Err(EditorError::new("pathEscape", "path escapes project root"));
    }
    Ok(normalized)
}

fn workspace_root() -> Result<PathBuf, EditorError> {
    let mut dir = std::env::current_dir().map_err(|error| {
        EditorError::new(
            "cwdFailed",
            format!("failed to resolve current dir: {error}"),
        )
    })?;
    loop {
        if dir.join("docs/stories_plan").is_dir()
            && dir.join("apps/game/src-tauri/resources/scenes").is_dir()
        {
            return normalize_existing_root(&dir);
        }
        if !dir.pop() {
            return Err(EditorError::new(
                "workspaceRootNotFound",
                "failed to locate Lyra workspace root",
            ));
        }
    }
}

fn normalize_existing_root(root: &Path) -> Result<PathBuf, EditorError> {
    root.canonicalize().map_err(|error| {
        EditorError::new(
            "workspaceRootInvalid",
            format!(
                "failed to resolve workspace root {}: {error}",
                root.display()
            ),
        )
    })
}

fn ensure_parent_dirs(root: &Path, path: &Path) -> Result<(), EditorError> {
    let root = normalize_existing_root(root)?;
    let parent = path
        .parent()
        .ok_or_else(|| EditorError::new("pathInvalid", "project path has no parent"))?;
    let relative_parent = parent
        .strip_prefix(&root)
        .map_err(|_| EditorError::new("pathEscape", "path escapes project root"))?;

    let mut current = root.clone();
    for component in relative_parent.components() {
        let Component::Normal(part) = component else {
            return Err(EditorError::new("pathEscape", "path escapes project root"));
        };
        current.push(part);
        if current.exists() {
            reject_symlink(&current)?;
            if !current.is_dir() {
                return Err(EditorError::new(
                    "pathInvalid",
                    format!("path component is not a directory: {}", current.display()),
                ));
            }
        } else {
            fs::create_dir(&current).map_err(|error| {
                EditorError::new(
                    "writeFailed",
                    format!("failed to create directory {}: {error}", current.display()),
                )
            })?;
        }
        ensure_path_stays_in_root(&root, &current)?;
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), EditorError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(EditorError::new(
            "pathSymlink",
            format!("symlink paths are not supported: {}", path.display()),
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(EditorError::new(
            "pathResolveFailed",
            format!("failed to inspect {}: {error}", path.display()),
        )),
    }
}

fn write_regular_file(path: &Path, contents: String) -> Result<(), EditorError> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(|error| {
        EditorError::new(
            "writeFailed",
            format!("failed to open {} for writing: {error}", path.display()),
        )
    })?;
    file.write_all(contents.as_bytes()).map_err(|error| {
        EditorError::new(
            "writeFailed",
            format!("failed to write {}: {error}", path.display()),
        )
    })
}

fn resolve_layout_path_at_root(root: &Path, scene_path: &str) -> Result<String, EditorError> {
    let source_path = resolve_story_scene_path_at_root(root, scene_path)?;

    let mut layout_path = PathBuf::from(source_path);
    layout_path.set_extension("layout.json");
    layout_path
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| EditorError::new("pathInvalid", "layout path is not valid UTF-8"))
}

fn resolve_story_scene_path_at_root(root: &Path, scene_path: &str) -> Result<String, EditorError> {
    let source_path = find_source_scene_path_at_root(root, scene_path)?;
    source_path
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| EditorError::new("pathInvalid", "source scene path is not valid UTF-8"))
}

fn find_source_scene_path_at_root(root: &Path, scene_path: &str) -> Result<PathBuf, EditorError> {
    // Defense-in-depth: legitimate scene resource paths are flat
    // `chapter_<N>/<scene>.json` paths under the resources root, so they never
    // need `..` or absolute components. Reject any such component up front so a
    // crafted scene_path cannot traverse out of the authored source roots after
    // the strip_prefix + join below (e.g. reach a markdown file outside
    // docs/static stories_plan). The write side is already guarded by
    // checked_project_path_from_root; mirror that protection on the read side.
    for component in Path::new(scene_path).components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(EditorError::new(
                    "scenePathInvalid",
                    "scene path must not contain parent-directory or absolute components",
                ));
            }
            _ => {}
        }
    }

    let scene_path = Path::new(scene_path);
    let relative_scene = scene_path
        .strip_prefix("apps/game/src-tauri/resources/scenes")
        .map_err(|_| {
            EditorError::new(
                "scenePathInvalid",
                "scene path must be under apps/game/src-tauri/resources/scenes",
            )
        })?;
    let mut source_scene = relative_scene.to_path_buf();
    source_scene.set_extension("md");

    let matches = ["docs/stories_plan", "static/stories_plan"]
        .into_iter()
        .map(Path::new)
        .map(|source_root| source_root.join(&source_scene))
        .filter(|candidate| root.join(candidate).is_file())
        .collect::<Vec<_>>();

    let source_path = match matches.as_slice() {
        [path] => path,
        [] => {
            return Err(EditorError::new(
                "sourceSceneNotFound",
                format!(
                    "failed to find authored source for {}",
                    scene_path.display()
                ),
            ));
        }
        _ => {
            return Err(EditorError::new(
                "sourceSceneAmbiguous",
                format!("multiple authored sources match {}", scene_path.display()),
            ));
        }
    };

    Ok(source_path.clone())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            resolve_layout_path,
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

    #[cfg(unix)]
    use std::os::unix::fs::symlink;

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

    #[test]
    fn write_project_file_rejects_non_layout_paths() {
        let root = temp_workspace_root();

        let result = write_project_file_at_root(
            &root,
            "apps/game/src-tauri/resources/scenes/chapters.json",
            "{}\n".to_string(),
        );

        assert_eq!(result.unwrap_err().code, "writePathNotAllowed");
    }

    #[test]
    fn write_project_file_rejects_parent_escape_after_story_root() {
        let root = temp_workspace_root();

        let result = write_project_file_at_root(
            &root,
            "docs/stories_plan/../../outside.layout.json",
            "{}\n".to_string(),
        );

        assert_eq!(result.unwrap_err().code, "pathEscape");
        assert!(!root.join("outside.layout.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn write_project_file_rejects_dangling_final_symlink() {
        let root = temp_workspace_root();
        let target = root.with_extension("outside-layout.json");
        let link = root.join("docs/stories_plan/chapter_1/bad.layout.json");
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        symlink(&target, &link).unwrap();

        let result = write_project_file_at_root(
            &root,
            "docs/stories_plan/chapter_1/bad.layout.json",
            "{}\n".to_string(),
        );

        assert_eq!(result.unwrap_err().code, "pathSymlink");
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn write_project_file_rejects_symlink_parent() {
        let root = temp_workspace_root();
        let outside = root.with_extension("outside-dir");
        fs::create_dir_all(&outside).unwrap();
        let link = root.join("docs/stories_plan/linked_chapter");
        symlink(&outside, &link).unwrap();

        let result = write_project_file_at_root(
            &root,
            "docs/stories_plan/linked_chapter/bad.layout.json",
            "{}\n".to_string(),
        );

        assert_eq!(result.unwrap_err().code, "pathSymlink");
        assert!(!outside.join("bad.layout.json").exists());
    }

    #[test]
    fn resolve_layout_path_uses_docs_source_owner() {
        let root = temp_workspace_root();
        fs::create_dir_all(root.join("docs/stories_plan/chapter_1")).unwrap();
        fs::write(
            root.join("docs/stories_plan/chapter_1/investigation_scene_1.md"),
            "",
        )
        .unwrap();

        let result = resolve_layout_path_at_root(
            &root,
            "apps/game/src-tauri/resources/scenes/chapter_1/investigation_scene_1.json",
        )
        .unwrap();

        assert_eq!(
            result,
            "docs/stories_plan/chapter_1/investigation_scene_1.layout.json"
        );
    }

    #[test]
    fn resolve_story_scene_path_uses_docs_source_owner() {
        let root = temp_workspace_root();
        fs::create_dir_all(root.join("docs/stories_plan/chapter_1")).unwrap();
        fs::write(
            root.join("docs/stories_plan/chapter_1/investigation_scene_1.md"),
            "",
        )
        .unwrap();

        let result = resolve_story_scene_path_at_root(
            &root,
            "apps/game/src-tauri/resources/scenes/chapter_1/investigation_scene_1.json",
        )
        .unwrap();

        assert_eq!(
            result,
            "docs/stories_plan/chapter_1/investigation_scene_1.md"
        );
    }

    #[test]
    fn resolve_layout_path_uses_static_source_owner() {
        let root = temp_workspace_root();
        fs::create_dir_all(root.join("static/stories_plan/chapter_2")).unwrap();
        fs::write(
            root.join("static/stories_plan/chapter_2/investigation_scene_1.md"),
            "",
        )
        .unwrap();

        let result = resolve_layout_path_at_root(
            &root,
            "apps/game/src-tauri/resources/scenes/chapter_2/investigation_scene_1.json",
        )
        .unwrap();

        assert_eq!(
            result,
            "static/stories_plan/chapter_2/investigation_scene_1.layout.json"
        );
    }

    #[test]
    fn resolve_story_scene_path_uses_static_source_owner() {
        let root = temp_workspace_root();
        fs::create_dir_all(root.join("static/stories_plan/chapter_2")).unwrap();
        fs::write(
            root.join("static/stories_plan/chapter_2/investigation_scene_1.md"),
            "",
        )
        .unwrap();

        let result = resolve_story_scene_path_at_root(
            &root,
            "apps/game/src-tauri/resources/scenes/chapter_2/investigation_scene_1.json",
        )
        .unwrap();

        assert_eq!(
            result,
            "static/stories_plan/chapter_2/investigation_scene_1.md"
        );
    }

    #[test]
    fn resolve_story_scene_path_rejects_parent_escape() {
        let root = temp_workspace_root();
        // Plant a markdown file outside the authored source roots that a
        // naive strip_prefix + join would reach via `..` traversal.
        fs::create_dir_all(root.join("outside")).unwrap();
        fs::write(root.join("outside/investigation_scene_1.md"), "").unwrap();

        let result = resolve_story_scene_path_at_root(
            &root,
            "apps/game/src-tauri/resources/scenes/../../../../../../outside/investigation_scene_1.json",
        );

        let err = result.unwrap_err();
        assert_eq!(err.code, "scenePathInvalid");
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
        fs::create_dir_all(root.join("apps/game/src-tauri/resources/scenes")).unwrap();
        root
    }
}
