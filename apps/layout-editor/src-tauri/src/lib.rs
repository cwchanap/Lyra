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

    // Probe both authored source roots. Keep the full candidate list (for the
    // not-found diagnostic) separate from the subset that exists on disk (for
    // the ambiguous diagnostic) so each error names exactly what was tried.
    let candidates: Vec<PathBuf> = ["docs/stories_plan", "static/stories_plan"]
        .into_iter()
        .map(Path::new)
        .map(|source_root| source_root.join(&source_scene))
        .collect();
    let matches: Vec<PathBuf> = candidates
        .iter()
        .filter(|candidate| root.join(candidate).is_file())
        .cloned()
        .collect();

    let source_path = match matches.len() {
        1 => &matches[0],
        0 => {
            let probed = candidates
                .iter()
                .map(|candidate| candidate.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(EditorError::new(
                "sourceSceneNotFound",
                format!(
                    "failed to find authored source for {}; probed: {}",
                    scene_path.display(),
                    probed
                ),
            ));
        }
        _ => {
            let found = matches
                .iter()
                .map(|candidate| candidate.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(EditorError::new(
                "sourceSceneAmbiguous",
                format!(
                    "multiple authored sources match {}: {}",
                    scene_path.display(),
                    found
                ),
            ));
        }
    };

    Ok(source_path.clone())
}

const CHAPTERS_INDEX_RELATIVE_PATH: &str = "apps/game/src-tauri/resources/scenes/chapters.json";
const COMPILED_SCENES_RELATIVE_ROOT: &str = "apps/game/src-tauri/resources/scenes";
const STORY_SOURCE_RELATIVE_ROOT: &str = "docs/stories_plan";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SceneType {
    Linear,
    Investigation,
    Interrogation,
    Analysis,
}

impl SceneType {
    fn stage_capable(self) -> bool {
        !matches!(self, SceneType::Linear)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchIndex {
    chapters: Vec<WorkbenchChapterEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchChapterEntry {
    id: String,
    title: String,
    summary: String,
    scenes: Vec<WorkbenchSceneEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchSceneEntry {
    id: String,
    #[serde(rename = "type")]
    scene_type: SceneType,
    source_path: String,
    stage_capable: bool,
}

#[derive(Debug)]
// ponytail: unused in non-test builds until Task 4 registers a command that
// reads it; keep the resolved shape wired now so the cutover is registration-only.
#[allow(dead_code)]
struct ResolvedScene {
    chapter_id: String,
    scene_id: String,
    scene_type: SceneType,
    compiled_path: PathBuf,
    source_path: PathBuf,
}

// Private mirror of the compiler-emitted chapters.json (the @lyra/scene-types
// ChaptersIndex shape) restricted to the fields the workbench consumes.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChaptersIndexFile {
    chapters: Vec<ChaptersIndexChapter>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChaptersIndexChapter {
    id: String,
    title: String,
    summary: String,
    scenes: Vec<ChaptersIndexScene>,
}

#[derive(Debug, Deserialize)]
struct ChaptersIndexScene {
    #[serde(rename = "type")]
    scene_type: SceneType,
    file: String,
}

/// One manifest scene with its backend-validated authored source resolved.
#[derive(Debug)]
struct ManifestScene {
    id: String,
    scene_type: SceneType,
    file: String,
    source_path: String,
    canonical_source: PathBuf,
}

#[tauri::command]
fn load_workbench_index() -> Result<WorkbenchIndex, EditorError> {
    let root = workspace_root()?;
    load_workbench_index_at_root(&root)
}

fn load_workbench_index_at_root(root: &Path) -> Result<WorkbenchIndex, EditorError> {
    let chapters = load_manifest_chapters(root)?;
    Ok(WorkbenchIndex {
        chapters: chapters
            .into_iter()
            .map(|chapter| WorkbenchChapterEntry {
                id: chapter.id,
                title: chapter.title,
                summary: chapter.summary,
                scenes: chapter
                    .scenes
                    .into_iter()
                    .map(|scene| WorkbenchSceneEntry {
                        id: scene.id,
                        scene_type: scene.scene_type,
                        source_path: scene.source_path,
                        stage_capable: scene.scene_type.stage_capable(),
                    })
                    .collect(),
            })
            .collect(),
    })
}

// ponytail: unused in non-test builds until Task 4 registers a command that
// resolves scenes through the manifest; tests pin its contract now.
#[allow(dead_code)]
fn resolve_manifest_scene_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<ResolvedScene, EditorError> {
    let canonical_root = normalize_existing_root(root)?;
    let chapters = load_manifest_chapters(root)?;
    let chapter = chapters
        .into_iter()
        .find(|chapter| chapter.id == chapter_id)
        .ok_or_else(|| {
            EditorError::new(
                "chapterNotFound",
                format!("chapter \"{chapter_id}\" is not in the workbench index"),
            )
        })?;
    let scene = chapter
        .scenes
        .into_iter()
        .find(|scene| scene.id == scene_id)
        .ok_or_else(|| {
            EditorError::new(
                "sceneNotFound",
                format!("scene \"{scene_id}\" is not in chapter \"{chapter_id}\""),
            )
        })?;
    Ok(ResolvedScene {
        chapter_id: chapter.id,
        scene_id: scene.id,
        scene_type: scene.scene_type,
        compiled_path: canonical_root
            .join(COMPILED_SCENES_RELATIVE_ROOT)
            .join(&scene.file),
        source_path: scene.canonical_source,
    })
}

struct ManifestChapter {
    id: String,
    title: String,
    summary: String,
    scenes: Vec<ManifestScene>,
}

fn load_manifest_chapters(root: &Path) -> Result<Vec<ManifestChapter>, EditorError> {
    let canonical_root = normalize_existing_root(root)?;
    let index_path = canonical_root.join(CHAPTERS_INDEX_RELATIVE_PATH);
    let text = fs::read_to_string(&index_path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            EditorError::not_found(&index_path)
        } else {
            EditorError::new(
                "indexReadFailed",
                format!("failed to read {}: {error}", index_path.display()),
            )
        }
    })?;
    let parsed: ChaptersIndexFile = serde_json::from_str(&text).map_err(|error| {
        EditorError::new(
            "indexInvalid",
            format!("failed to parse {}: {error}", index_path.display()),
        )
    })?;

    parsed
        .chapters
        .into_iter()
        .map(|chapter| {
            let scenes = chapter
                .scenes
                .iter()
                .map(|scene| manifest_scene(&canonical_root, scene))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(ManifestChapter {
                id: chapter.id,
                title: chapter.title,
                summary: chapter.summary,
                scenes,
            })
        })
        .collect()
}

/// Derives the scene id from the manifest filename stem and resolves the
/// authored markdown under exactly docs/stories_plan. Does not scan authored
/// directories; the manifest owns the order and membership.
fn manifest_scene(
    canonical_root: &Path,
    scene: &ChaptersIndexScene,
) -> Result<ManifestScene, EditorError> {
    // The manifest is compiler-generated (`chapter_<N>/<scene>.json`), but its
    // `file` string is concatenated into backend-constructed paths below, so
    // reject traversal/absolute components before any filesystem access.
    for component in Path::new(&scene.file).components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(EditorError::new(
                    "scenePathInvalid",
                    "manifest scene file must be a relative path under the compiled scenes root",
                ));
            }
        }
    }

    let id = Path::new(&scene.file)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_owned)
        .ok_or_else(|| {
            EditorError::new(
                "scenePathInvalid",
                format!("manifest scene file has no stem: {}", scene.file),
            )
        })?;

    let source_file = scene.file.replace('\\', "/");
    let json_suffix = source_file.strip_suffix(".json").ok_or_else(|| {
        EditorError::new(
            "scenePathInvalid",
            format!("manifest scene file must end in .json: {}", scene.file),
        )
    })?;
    let source_path = format!("{STORY_SOURCE_RELATIVE_ROOT}/{json_suffix}.md");
    let canonical_source = canonicalize_source_under_story_root(canonical_root, &source_path)?;

    Ok(ManifestScene {
        id,
        scene_type: scene.scene_type,
        file: scene.file.clone(),
        source_path,
        canonical_source,
    })
}

/// Canonicalizes the backend-constructed source path and asserts it stays
/// under the canonical workspace/story root before it is trusted.
fn canonicalize_source_under_story_root(
    canonical_root: &Path,
    source_relative: &str,
) -> Result<PathBuf, EditorError> {
    let candidate = canonical_root.join(source_relative);
    let canonical = candidate.canonicalize().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            EditorError::new(
                "sourceNotFound",
                format!("authored source not found: {source_relative}"),
            )
        } else {
            EditorError::new(
                "pathResolveFailed",
                format!("failed to resolve authored source {source_relative}: {error}"),
            )
        }
    })?;
    let story_root = canonical_root.join(STORY_SOURCE_RELATIVE_ROOT);
    if !canonical.starts_with(&story_root) {
        return Err(EditorError::new(
            "pathEscape",
            format!("authored source escapes {STORY_SOURCE_RELATIVE_ROOT}: {source_relative}"),
        ));
    }
    Ok(canonical)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            resolve_layout_path,
            read_project_file,
            write_project_file,
            load_workbench_index
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

    #[test]
    fn resolve_story_scene_path_not_found_lists_probed_candidates() {
        let root = temp_workspace_root();
        // No markdown planted in either source root.

        let err = resolve_story_scene_path_at_root(
            &root,
            "apps/game/src-tauri/resources/scenes/chapter_1/investigation_scene_1.json",
        )
        .unwrap_err();

        assert_eq!(err.code, "sourceSceneNotFound");
        // The diagnostic names both probed roots so the author sees where it
        // looked, not just the resource path it started from.
        assert!(err
            .message
            .contains("docs/stories_plan/chapter_1/investigation_scene_1.md"));
        assert!(err
            .message
            .contains("static/stories_plan/chapter_1/investigation_scene_1.md"));
    }

    #[test]
    fn resolve_story_scene_path_ambiguous_lists_matched_sources() {
        let root = temp_workspace_root();
        // temp_workspace_root pre-creates docs/stories_plan; create the chapter
        // subdirs (and the static root) before writing the scene files.
        fs::create_dir_all(root.join("docs/stories_plan/chapter_1")).unwrap();
        fs::create_dir_all(root.join("static/stories_plan/chapter_1")).unwrap();
        // Plant the same scene under both source roots.
        fs::write(
            root.join("docs/stories_plan/chapter_1/investigation_scene_1.md"),
            "",
        )
        .unwrap();
        fs::write(
            root.join("static/stories_plan/chapter_1/investigation_scene_1.md"),
            "",
        )
        .unwrap();

        let err = resolve_story_scene_path_at_root(
            &root,
            "apps/game/src-tauri/resources/scenes/chapter_1/investigation_scene_1.json",
        )
        .unwrap_err();

        assert_eq!(err.code, "sourceSceneAmbiguous");
        assert!(err
            .message
            .contains("docs/stories_plan/chapter_1/investigation_scene_1.md"));
        assert!(err
            .message
            .contains("static/stories_plan/chapter_1/investigation_scene_1.md"));
    }

    #[test]
    fn workbench_index_preserves_manifest_order_and_docs_source_paths() {
        let root = temp_workbench_root();
        let index = load_workbench_index_at_root(&root).unwrap();
        let scenes = &index.chapters[0].scenes;

        assert_eq!(
            scenes
                .iter()
                .map(|scene| scene.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "scene_a",
                "investigation_scene_b",
                "interrogation_scene_c",
                "analysis_scene_d"
            ]
        );
        assert_eq!(scenes[0].scene_type, SceneType::Linear);
        assert_eq!(
            scenes[0].source_path,
            "docs/stories_plan/chapter_1/scene_a.md"
        );
        assert!(!scenes[0].stage_capable);
        assert!(scenes[1].stage_capable);
    }

    #[test]
    fn manifest_scene_resolver_rejects_unknown_chapter_and_scene() {
        let root = temp_workbench_root();
        assert_eq!(
            resolve_manifest_scene_at_root(&root, "missing", "scene_a")
                .unwrap_err()
                .code,
            "chapterNotFound"
        );
        assert_eq!(
            resolve_manifest_scene_at_root(&root, "chapter_1", "missing")
                .unwrap_err()
                .code,
            "sceneNotFound"
        );
    }

    #[test]
    fn workbench_index_fails_when_canonical_source_is_missing() {
        let root = temp_workbench_root();
        std::fs::remove_file(root.join("docs/stories_plan/chapter_1/scene_a.md")).unwrap();
        assert_eq!(
            load_workbench_index_at_root(&root).unwrap_err().code,
            "sourceNotFound"
        );
    }

    fn temp_workbench_root() -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!(
            "lyra-layout-editor-workbench-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("apps/game/src-tauri/resources/scenes")).unwrap();
        fs::create_dir_all(root.join("docs/stories_plan/chapter_1")).unwrap();
        fs::write(
            root.join("apps/game/src-tauri/resources/scenes/chapters.json"),
            r#"{
  "chapters": [
    {
      "id": "chapter_1",
      "title": "Chapter One",
      "summary": "Fixture chapter",
      "scenes": [
        {"type":"linear","file":"chapter_1/scene_a.json"},
        {"type":"investigation","file":"chapter_1/investigation_scene_b.json"},
        {"type":"interrogation","file":"chapter_1/interrogation_scene_c.json"},
        {"type":"analysis","file":"chapter_1/analysis_scene_d.json"}
      ]
    }
  ]
}"#,
        )
        .unwrap();
        for scene in [
            "scene_a.md",
            "investigation_scene_b.md",
            "interrogation_scene_c.md",
            "analysis_scene_d.md",
        ] {
            fs::write(root.join("docs/stories_plan/chapter_1").join(scene), "").unwrap();
        }
        root
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
