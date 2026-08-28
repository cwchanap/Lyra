use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
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

/// A compiled scene handed to the workbench frontend. Analysis scenes carry
/// only the public writer view (see `public_analysis_value`); every other
/// scene type is passed through as the compiler emitted it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchSceneBundle {
    scene: serde_json::Value,
}

/// Author-checked-in layout sidecar for an investigation scene, mirroring the
/// `InvestigationLayoutSidecar` wire shape from `@lyra/scene-types`.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct InvestigationLayoutSidecar {
    version: u32,
    scene_id: String,
    sublocations: HashMap<String, SublocationLayout>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SublocationLayout {
    hotspots: HashMap<String, SceneLayout>,
    characters: HashMap<String, SceneLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    intentional_overlaps: Option<Vec<IntentionalHotspotOverlap>>,
}

/// Axis-aligned hotspot rect or character sprite/baked layout, in scene
/// coordinates (the `kind`-tagged `RectLayout`/`CharacterLayout` wire union).
#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum SceneLayout {
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    },
    Sprite {
        #[serde(rename = "assetId")]
        asset_id: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        anchor: LayoutAnchor,
    },
    Baked {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    },
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
enum LayoutAnchor {
    #[serde(rename = "bottomCenter")]
    BottomCenter,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct IntentionalHotspotOverlap {
    hotspots: (String, String),
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
struct ResolvedScene {
    // ponytail: not read until Task 4 wires save/next-scene commands by ids.
    #[allow(dead_code)]
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

#[tauri::command]
fn load_scene_bundle(
    chapter_id: String,
    scene_id: String,
) -> Result<WorkbenchSceneBundle, EditorError> {
    let root = workspace_root()?;
    load_scene_bundle_at_root(&root, &chapter_id, &scene_id)
}

#[tauri::command]
fn load_investigation_layout(
    chapter_id: String,
    scene_id: String,
) -> Result<Option<InvestigationLayoutSidecar>, EditorError> {
    let root = workspace_root()?;
    load_investigation_layout_at_root(&root, &chapter_id, &scene_id)
}

#[tauri::command]
fn save_investigation_layout(
    chapter_id: String,
    scene_id: String,
    layout: InvestigationLayoutSidecar,
) -> Result<(), EditorError> {
    let root = workspace_root()?;
    save_investigation_layout_at_root(&root, &chapter_id, &scene_id, &layout)
}

fn load_scene_bundle_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<WorkbenchSceneBundle, EditorError> {
    let resolved = resolve_manifest_scene_at_root(root, chapter_id, scene_id)?;
    let compiled_path = &resolved.compiled_path;
    let text = fs::read_to_string(compiled_path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            EditorError::not_found(compiled_path)
        } else {
            EditorError::new(
                "readFailed",
                format!("failed to read {}: {error}", compiled_path.display()),
            )
        }
    })?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|error| {
        EditorError::new(
            "sceneInvalid",
            format!("failed to parse {}: {error}", compiled_path.display()),
        )
    })?;

    let expected_type = manifest_scene_type_tag(resolved.scene_type);
    let compiled_id = value.get("id").and_then(|id| id.as_str());
    let compiled_type = value.get("type").and_then(|scene_type| scene_type.as_str());
    if compiled_id != Some(resolved.scene_id.as_str()) || compiled_type != Some(expected_type) {
        return Err(EditorError::new(
            "sceneManifestMismatch",
            format!(
                "compiled scene {} does not match the manifest: expected id \"{}\" type \"{expected_type}\", found id {compiled_id:?} type {compiled_type:?}",
                compiled_path.display(),
                resolved.scene_id,
            ),
        ));
    }

    let scene = if resolved.scene_type == SceneType::Analysis {
        public_analysis_value(&value)?
    } else {
        value
    };
    Ok(WorkbenchSceneBundle { scene })
}

fn manifest_scene_type_tag(scene_type: SceneType) -> &'static str {
    match scene_type {
        SceneType::Linear => "linear",
        SceneType::Investigation => "investigation",
        SceneType::Interrogation => "interrogation",
        SceneType::Analysis => "analysis",
    }
}

/// Builds the public editor view of a compiled Analysis scene by copying a
/// whitelist of writer-facing fields into a fresh value. Answer keys
/// (`acceptedGroupByCard`/`acceptedOrder`/`acceptedSelections`), progression
/// gates (`unlock`/`reveals`), per-selection feedback, and runtime state are
/// never copied — this is a copy-list, never a recursive delete.
fn public_analysis_value(scene: &serde_json::Value) -> Result<serde_json::Value, EditorError> {
    let mut public =
        whitelisted_map_of(scene, &["type", "id", "title", "summary", "intro", "outro"]);
    let empty = Vec::new();
    let boards = array_field(scene, "boards").unwrap_or(&empty);
    let public_boards = boards
        .iter()
        .map(public_analysis_board)
        .collect::<Result<Vec<_>, _>>()?;
    public.insert(
        "boards".to_string(),
        serde_json::Value::Array(public_boards),
    );
    Ok(serde_json::Value::Object(public))
}

fn public_analysis_board(board: &serde_json::Value) -> Result<serde_json::Value, EditorError> {
    let Some(kind) = board.get("kind").and_then(|kind| kind.as_str()) else {
        return Err(EditorError::new(
            "unsupportedAnalysisBoardKind",
            "unsupported analysis board kind: <missing>",
        ));
    };
    if !matches!(kind, "classify" | "order" | "threshold") {
        return Err(EditorError::new(
            "unsupportedAnalysisBoardKind",
            format!("unsupported analysis board kind: {kind}"),
        ));
    }

    let mut public = serde_json::Map::new();
    public.insert("kind".to_string(), serde_json::Value::from(kind));
    if let Some(common) = board.get("common") {
        let mut public_common = whitelisted_map_of(common, &["id", "label", "prompt"]);
        if let Some(cards) = array_field(common, "cards") {
            let public_cards = cards
                .iter()
                .map(|card| {
                    serde_json::Value::Object(whitelisted_map_of(
                        card,
                        &["id", "label", "source", "summary"],
                    ))
                })
                .collect();
            public_common.insert("cards".to_string(), serde_json::Value::Array(public_cards));
        }
        if let Some(feedback) = common.get("feedback") {
            let public_feedback =
                whitelisted_map_of(feedback, &["incomplete", "incorrect", "hint"]);
            public_common.insert(
                "feedback".to_string(),
                serde_json::Value::Object(public_feedback),
            );
        }
        if let Some(result_dialogue) = common.get("resultDialogue") {
            public_common.insert("resultDialogue".to_string(), result_dialogue.clone());
        }
        public.insert(
            "common".to_string(),
            serde_json::Value::Object(public_common),
        );
    }
    if kind == "classify" {
        if let Some(groups) = array_field(board, "groups") {
            let public_groups = groups
                .iter()
                .map(|group| {
                    serde_json::Value::Object(whitelisted_map_of(
                        group,
                        &["id", "label", "description"],
                    ))
                })
                .collect();
            public.insert(
                "groups".to_string(),
                serde_json::Value::Array(public_groups),
            );
        }
    }
    if kind == "order" {
        if let Some(anchors) = array_field(board, "fixedAnchors") {
            let public_anchors = anchors
                .iter()
                .map(|anchor| {
                    serde_json::Value::Object(whitelisted_map_of(anchor, &["cardId", "position"]))
                })
                .collect();
            public.insert(
                "fixedAnchors".to_string(),
                serde_json::Value::Array(public_anchors),
            );
        }
    }
    Ok(serde_json::Value::Object(public))
}

fn whitelisted_map_of(
    source: &serde_json::Value,
    fields: &[&str],
) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    for field in fields {
        if let Some(copied) = source.get(*field) {
            out.insert(field.to_string(), copied.clone());
        }
    }
    out
}

fn array_field<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a Vec<serde_json::Value>> {
    value.get(key).and_then(|field| field.as_array())
}

fn load_investigation_layout_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<Option<InvestigationLayoutSidecar>, EditorError> {
    let layout_path = investigation_layout_path_at_root(root, chapter_id, scene_id)?;
    let text = match fs::read_to_string(&layout_path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(EditorError::new(
                "readFailed",
                format!("failed to read {}: {error}", layout_path.display()),
            ))
        }
    };
    let layout: InvestigationLayoutSidecar = serde_json::from_str(&text).map_err(|error| {
        EditorError::new(
            "layoutInvalid",
            format!("failed to parse {}: {error}", layout_path.display()),
        )
    })?;
    Ok(Some(layout))
}

fn save_investigation_layout_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
    layout: &InvestigationLayoutSidecar,
) -> Result<(), EditorError> {
    let layout_path = investigation_layout_path_at_root(root, chapter_id, scene_id)?;
    let serialized = serde_json::to_string_pretty(layout).map_err(|error| {
        EditorError::new(
            "layoutInvalid",
            format!(
                "failed to serialize layout for {}: {error}",
                layout_path.display()
            ),
        )
    })?;
    write_regular_file(&layout_path, format!("{serialized}\n"))
}

/// Resolves the `*.layout.json` sidecar path for an investigation scene from
/// its backend-resolved canonical authored `.md` path, per the existing
/// sidecar naming convention. Never accepts a caller-supplied path.
fn investigation_layout_path_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<PathBuf, EditorError> {
    let resolved = resolve_manifest_scene_at_root(root, chapter_id, scene_id)?;
    if resolved.scene_type != SceneType::Investigation {
        return Err(EditorError::new(
            "stageUnsupportedSceneType",
            format!(
                "scene \"{scene_id}\" has type \"{}\" but layout editing requires an investigation scene",
                manifest_scene_type_tag(resolved.scene_type)
            ),
        ));
    }

    let mut layout_path = resolved.source_path.clone();
    layout_path.set_extension("layout.json");
    // The sidecar is backend-constructed from the canonical authored path, but
    // assert the containment invariant before trusting it for I/O.
    let canonical_root = normalize_existing_root(root)?;
    if !layout_path.starts_with(canonical_root.join(STORY_SOURCE_RELATIVE_ROOT)) {
        return Err(EditorError::new(
            "pathEscape",
            format!(
                "layout sidecar escapes {STORY_SOURCE_RELATIVE_ROOT}: {}",
                layout_path.display()
            ),
        ));
    }
    Ok(layout_path)
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
            load_workbench_index,
            load_scene_bundle,
            load_investigation_layout,
            save_investigation_layout
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

    #[test]
    fn non_analysis_bundle_preserves_compiler_payload() {
        let root = temp_workbench_root();
        let bundle =
            load_scene_bundle_at_root(&root, "chapter_1", "investigation_scene_b").unwrap();
        assert_eq!(bundle.scene["type"], "investigation");
        assert_eq!(bundle.scene["id"], "investigation_scene_b");
    }

    #[test]
    fn analysis_bundle_keeps_public_writer_fields_and_strips_forbidden_semantics() {
        let root = temp_workbench_root();
        let bundle = load_scene_bundle_at_root(&root, "chapter_1", "analysis_scene_d").unwrap();
        let serialized = serde_json::to_string(&bundle).unwrap();

        for required in [
            "public prompt",
            "public incomplete",
            "public incorrect",
            "public hint",
            "public card summary",
            "public group description",
            "public result",
            "fixedAnchors",
            "anchor_card",
        ] {
            assert!(
                serialized.contains(required),
                "missing public field/value {required}"
            );
        }

        for forbidden in [
            "acceptedGroupByCard",
            "secret_group",
            "acceptedOrder",
            "secret_order",
            "minimumSelected",
            "acceptedSelections",
            "secret_selection",
            "incorrectSelections",
            "secret mapped feedback",
            "secret_progression",
            "secret_reveal",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "leaked forbidden field/value {forbidden}"
            );
        }
    }

    #[test]
    fn scene_bundle_rejects_compiled_id_or_type_mismatch() {
        let root = temp_workbench_root();
        overwrite_compiled_scene_field(&root, "scene_a", "id", "wrong_id");
        assert_eq!(
            load_scene_bundle_at_root(&root, "chapter_1", "scene_a")
                .unwrap_err()
                .code,
            "sceneManifestMismatch"
        );
    }

    #[test]
    fn investigation_layout_round_trips_by_ids() {
        let root = temp_workbench_root();
        let layout = fixture_layout();
        save_investigation_layout_at_root(&root, "chapter_1", "investigation_scene_b", &layout)
            .unwrap();

        assert_eq!(
            load_investigation_layout_at_root(&root, "chapter_1", "investigation_scene_b").unwrap(),
            Some(layout)
        );
    }

    #[test]
    fn layout_commands_reject_non_investigation_scene() {
        let root = temp_workbench_root();
        assert_eq!(
            load_investigation_layout_at_root(&root, "chapter_1", "scene_a")
                .unwrap_err()
                .code,
            "stageUnsupportedSceneType"
        );
    }

    fn overwrite_compiled_scene_field(root: &Path, scene: &str, field: &str, value: &str) {
        let path = root
            .join(COMPILED_SCENES_RELATIVE_ROOT)
            .join("chapter_1")
            .join(format!("{scene}.json"));
        let mut parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        parsed[field] = serde_json::Value::from(value);
        fs::write(&path, serde_json::to_string_pretty(&parsed).unwrap()).unwrap();
    }

    fn fixture_layout() -> InvestigationLayoutSidecar {
        InvestigationLayoutSidecar {
            version: 1,
            scene_id: "investigation_scene_b".to_string(),
            sublocations: HashMap::from([(
                "sublocation_a".to_string(),
                SublocationLayout {
                    hotspots: HashMap::from([(
                        "hotspot_a".to_string(),
                        SceneLayout::Rect {
                            x: 1.0,
                            y: 2.0,
                            w: 30.0,
                            h: 40.0,
                        },
                    )]),
                    characters: HashMap::from([(
                        "character_a".to_string(),
                        SceneLayout::Sprite {
                            asset_id: "standee.fixture_a".to_string(),
                            x: 3.0,
                            y: 4.0,
                            w: 50.0,
                            h: 60.0,
                            anchor: LayoutAnchor::BottomCenter,
                        },
                    )]),
                    intentional_overlaps: Some(vec![IntentionalHotspotOverlap {
                        hotspots: ("hotspot_a".to_string(), "hotspot_b".to_string()),
                    }]),
                },
            )]),
        }
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
        let compiled = root.join("apps/game/src-tauri/resources/scenes/chapter_1");
        fs::create_dir_all(&compiled).unwrap();
        for (file, contents) in [
            ("scene_a.json", r#"{"type":"linear","id":"scene_a"}"#),
            (
                "investigation_scene_b.json",
                r#"{"type":"investigation","id":"investigation_scene_b"}"#,
            ),
            (
                "interrogation_scene_c.json",
                r#"{"type":"interrogation","id":"interrogation_scene_c"}"#,
            ),
        ] {
            fs::write(compiled.join(file), contents).unwrap();
        }
        // Analysis fixture: public writer fields plus forbidden sentinel
        // data (answer keys, progression gates, per-selection feedback) the
        // bundle loader must strip at the wire.
        fs::write(
            compiled.join("analysis_scene_d.json"),
            r#"{"type":"analysis","id":"analysis_scene_d","title":"Analysis Scene D","summary":"public analysis summary","intro":[],"outro":[],"boards":[
{"kind":"classify","common":{"id":"board_a","label":"Board A","prompt":"public prompt","unlock":{"predicate":"fact_asserted","id":"secret_progression"},"reveals":[{"kind":"assertFact","factId":"secret_reveal"}],"feedback":{"incomplete":"public incomplete","incorrect":"public incorrect","hint":"public hint","incorrectSelections":[{"cards":["card_a"],"feedback":"secret mapped feedback"}]},"cards":[{"id":"card_a","label":"Card A","source":{"kind":"evidence","id":"evidence_a"},"summary":"public card summary"}],"resultDialogue":[{"kind":"line","speaker":"相馬律","text":"public result","portrait":null}]},"groups":[{"id":"group_a","label":"Group A","description":"public group description"}],"acceptedGroupByCard":{"card_a":"secret_group"}},
{"kind":"order","common":{"id":"board_b","label":"Board B","prompt":"order prompt","unlock":null,"reveals":[],"feedback":{"incomplete":"order incomplete","incorrect":"order incorrect","hint":null,"incorrectSelections":[]},"cards":[{"id":"anchor_card","label":"Anchor Card","source":{"kind":"evidence","id":"evidence_b"},"summary":"anchor summary"}],"resultDialogue":[]},"acceptedOrder":["secret_order"],"fixedAnchors":[{"cardId":"anchor_card","position":1}]},
{"kind":"threshold","common":{"id":"board_c","label":"Board C","prompt":"threshold prompt","unlock":null,"reveals":[],"feedback":{"incomplete":"threshold incomplete","incorrect":"threshold incorrect","hint":null,"incorrectSelections":[]},"cards":[],"resultDialogue":[]},"minimumSelected":7,"acceptedSelections":[["secret_selection"]]}
]}"#,
        )
        .unwrap();
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
