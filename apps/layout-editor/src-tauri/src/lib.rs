use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

/// Monotonic counter for unique atomic-write temp-file names so concurrent or
/// rapid saves never collide on the temp path (see
/// `write_text_atomic_no_follow`).
static ATOMIC_WRITE_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

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

const CHAPTERS_INDEX_RELATIVE_PATH: &str = "apps/game/src-tauri/resources/scenes/chapters.json";
const COMPILED_SCENES_RELATIVE_ROOT: &str = "apps/game/src-tauri/resources/scenes";
const STORY_SOURCE_RELATIVE_ROOT: &str = "docs/stories_plan";
const PLAN_STORY_BIBLE_RELATIVE_PATH: &str = "docs/stories_plan/final_story_bible.md";

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
        matches!(self, SceneType::Investigation)
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
    /// Repo-relative authored source path (`docs/stories_plan/…`) as spelled
    /// by the compiler manifest, for wire payloads.
    source_relative: String,
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
        source_relative: scene.source_path,
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
    load_compiled_scene_bundle(
        &resolved.compiled_path,
        &resolved.scene_id,
        resolved.scene_type,
    )
}

/// Reads and validates the compiled scene JSON for an already-resolved manifest
/// scene. The caller supplies the compiled path, scene id, and type, so this
/// performs no manifest re-resolution or root re-canonicalization — the asset
/// workspace snapshot loop reuses already-resolved `ManifestScene` entries and
/// calls this directly, avoiding a full `load_manifest_chapters` reload per
/// scene.
fn load_compiled_scene_bundle(
    compiled_path: &Path,
    scene_id: &str,
    scene_type: SceneType,
) -> Result<WorkbenchSceneBundle, EditorError> {
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

    let expected_type = manifest_scene_type_tag(scene_type);
    let compiled_id = value.get("id").and_then(|id| id.as_str());
    let compiled_type = value.get("type").and_then(|scene_type| scene_type.as_str());
    if compiled_id != Some(scene_id) || compiled_type != Some(expected_type) {
        return Err(EditorError::new(
            "sceneManifestMismatch",
            format!(
                "compiled scene {} does not match the manifest: expected id \"{}\" type \"{expected_type}\", found id {compiled_id:?} type {compiled_type:?}",
                compiled_path.display(),
                scene_id,
            ),
        ));
    }

    let scene = if scene_type == SceneType::Analysis {
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
    // The sidecar is resolved by (chapter_id, scene_id), so a copied/stale
    // sidecar claiming a different scene id must be rejected at the domain
    // boundary; otherwise it can be loaded as scene B and later written back
    // to B's file while still claiming sceneId: A.
    if layout.scene_id != scene_id {
        return Err(EditorError::new(
            "layoutSceneIdMismatch",
            format!(
                "layout sidecar at {} claims sceneId \"{}\" but was requested as scene \"{}\"",
                layout_path.display(),
                layout.scene_id,
                scene_id
            ),
        ));
    }
    Ok(Some(layout))
}

fn save_investigation_layout_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
    layout: &InvestigationLayoutSidecar,
) -> Result<(), EditorError> {
    let layout_path = investigation_layout_path_at_root(root, chapter_id, scene_id)?;
    // Mirror the load-side check: refuse to write a sidecar whose embedded
    // scene id does not match the domain id it is being saved under, so a
    // stale/mismatched layout cannot propagate into later compiler/editor runs.
    if layout.scene_id != scene_id {
        return Err(EditorError::new(
            "layoutSceneIdMismatch",
            format!(
                "layout claims sceneId \"{}\" but is being saved as scene \"{}\" at {}",
                layout.scene_id,
                scene_id,
                layout_path.display()
            ),
        ));
    }
    let serialized = serde_json::to_string_pretty(layout).map_err(|error| {
        EditorError::new(
            "layoutInvalid",
            format!(
                "failed to serialize layout for {}: {error}",
                layout_path.display()
            ),
        )
    })?;
    write_text_atomic_no_follow(&layout_path, &format!("{serialized}\n"), "writeFailed")
}

/// Writes an already-resolved text file without following an existing symlink
/// at the target path. `fs::write` opens with `O_CREAT|O_TRUNC` which follows
/// symlinks, so a planted file symlink could redirect the write outside the
/// containment root even though the path itself was validated. Instead, write
/// into a uniquely-named temp file in the same directory (so `rename` is
/// atomic on a single filesystem) and rename it over the target: `rename`
/// replaces the directory entry itself rather than writing through a symlink.
/// The temp file lives next to the validated path, so it stays within the
/// containment root. Shared by layout sidecars and Workbench source edits;
/// `error_code` keeps each domain's wire error stable.
fn write_text_atomic_no_follow(
    path: &Path,
    contents: &str,
    error_code: &'static str,
) -> Result<(), EditorError> {
    let parent = path.parent().ok_or_else(|| {
        EditorError::new(
            error_code,
            format!("path has no parent: {}", path.display()),
        )
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let unique = ATOMIC_WRITE_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_path = parent.join(format!(".{file_name}.{}.{unique}.tmp", std::process::id()));

    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| {
                EditorError::new(
                    error_code,
                    format!("failed to open temp {}: {error}", temp_path.display()),
                )
            })?;
        file.write_all(contents.as_bytes()).map_err(|error| {
            EditorError::new(
                error_code,
                format!("failed to write temp {}: {error}", temp_path.display()),
            )
        })?;
        file.sync_all().map_err(|error| {
            EditorError::new(
                error_code,
                format!("failed to sync temp {}: {error}", temp_path.display()),
            )
        })?;
    }

    fs::rename(&temp_path, path).map_err(|error| {
        // Best-effort cleanup so a failed rename does not leave a stale temp.
        let _ = fs::remove_file(&temp_path);
        EditorError::new(
            error_code,
            format!("failed to rename temp to {}: {error}", path.display()),
        )
    })
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

// === HPA-135 focused source edit: closed scene-document read/write ==========

/// Wire view of one authored scene Markdown document. `hash` is the lowercase
/// SHA-256 of the exact UTF-8 bytes and doubles as the stale-write token on
/// apply.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchSourceDocument {
    id: String,
    path: String,
    content: String,
    hash: String,
}

/// HPA-135 v1 identity: `scene:<chapterId>:<sceneId>` with non-empty parts.
/// Anything else (plan/asset documents, traversal, blank parts) is unsupported.
fn parse_source_document_id(source_document_id: &str) -> Option<(String, String)> {
    let rest = source_document_id.strip_prefix("scene:")?;
    let (chapter_id, scene_id) = rest.split_once(':')?;
    if chapter_id.is_empty() || scene_id.is_empty() {
        return None;
    }
    Some((chapter_id.to_string(), scene_id.to_string()))
}

fn source_document_unsupported(detail: impl std::fmt::Display) -> EditorError {
    EditorError::new(
        "sourceDocumentUnsupported",
        format!("source document is not supported: {detail}"),
    )
}

/// Resolves a closed source-document id through the existing manifest +
/// canonical-source containment helpers. No caller-supplied path ever reaches
/// the filesystem.
fn resolve_workbench_source_document(
    root: &Path,
    source_document_id: &str,
) -> Result<ResolvedScene, EditorError> {
    let (chapter_id, scene_id) = parse_source_document_id(source_document_id).ok_or_else(|| {
        source_document_unsupported("id must look like scene:<chapterId>:<sceneId>")
    })?;
    resolve_manifest_scene_at_root(root, &chapter_id, &scene_id)
        .map_err(|error| source_document_unsupported(error.message))
}

fn read_source_text(path: &Path) -> Result<String, EditorError> {
    fs::read_to_string(path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            EditorError::not_found(path)
        } else {
            EditorError::new(
                "readFailed",
                format!("failed to read {}: {error}", path.display()),
            )
        }
    })
}

/// Lowercase hex SHA-256 of the exact UTF-8 bytes.
fn sha256_hex(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

#[tauri::command]
fn load_workbench_source_document(
    source_document_id: String,
) -> Result<WorkbenchSourceDocument, EditorError> {
    let root = workspace_root()?;
    load_workbench_source_document_at_root(&root, &source_document_id)
}

fn load_workbench_source_document_at_root(
    root: &Path,
    source_document_id: &str,
) -> Result<WorkbenchSourceDocument, EditorError> {
    let resolved = resolve_workbench_source_document(root, source_document_id)?;
    let content = read_source_text(&resolved.source_path)?;
    Ok(WorkbenchSourceDocument {
        id: source_document_id.to_string(),
        path: resolved.source_relative,
        hash: sha256_hex(&content),
        content,
    })
}

/// Apply request for `apply_workbench_source_edit`. `kind` stays a raw string
/// so unsupported values come back as the typed `sourceEditKindUnsupported`
/// error instead of failing IPC argument deserialization.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyWorkbenchSourceEditRequest {
    source_document_id: String,
    expected_hash: String,
    semantic_ref: String,
    kind: String,
    expected_line: usize,
    next_content: String,
}

/// The four supported one-line edit targets; serde spellings match the TS
/// `WorkbenchSourceTargetKind` union verbatim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum WorkbenchSourceTargetKind {
    ReaderDialogue,
    ReaderAction,
    BackgroundPrompt,
    EvidenceImagePrompt,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchValidationDiagnostic {
    code: String,
    message: String,
}

/// Post-apply compile outcome. `ok` stays false on compiler failure/timeout
/// while the written source intentionally remains written (no rollback).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchValidationReport {
    ok: bool,
    diagnostics: Vec<WorkbenchValidationDiagnostic>,
}

impl WorkbenchValidationReport {
    fn ok() -> Self {
        Self {
            ok: true,
            diagnostics: Vec::new(),
        }
    }

    fn failed(code: &str, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            diagnostics: vec![WorkbenchValidationDiagnostic {
                code: code.to_string(),
                message: message.into(),
            }],
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyWorkbenchSourceEditResult {
    validation: WorkbenchValidationReport,
}

fn parse_workbench_source_target_kind(raw: &str) -> Result<WorkbenchSourceTargetKind, EditorError> {
    serde_json::from_value(serde_json::Value::from(raw)).map_err(|_| {
        EditorError::new(
            "sourceEditKindUnsupported",
            format!("unsupported workbench source edit kind: \"{raw}\""),
        )
    })
}

/// Closed `semanticRef` shape per kind. The backend cannot (and must not)
/// re-derive compiler carriers; it only enforces the identity format so a
/// malformed ref never reaches the write path.
fn validate_workbench_semantic_ref(
    kind: WorkbenchSourceTargetKind,
    semantic_ref: &str,
) -> Result<(), EditorError> {
    let invalid = |detail: String| {
        EditorError::new(
            "sourceEditSemanticRefInvalid",
            format!("semantic ref \"{semantic_ref}\" is invalid: {detail}"),
        )
    };
    match kind {
        WorkbenchSourceTargetKind::ReaderDialogue | WorkbenchSourceTargetKind::ReaderAction => {
            let prefix = match kind {
                WorkbenchSourceTargetKind::ReaderDialogue => "reader:dialogue:",
                _ => "reader:action:",
            };
            let tail = semantic_ref
                .strip_prefix(prefix)
                .ok_or_else(|| invalid(format!("must start with {prefix}")))?;
            // Carrier ids may themselves contain ':', so the item index is
            // everything after the LAST colon.
            let (carrier, item_index) = tail
                .rsplit_once(':')
                .ok_or_else(|| invalid("missing :<itemIndex> suffix".to_string()))?;
            if carrier.is_empty() || item_index.parse::<usize>().is_err() {
                return Err(invalid(format!("must be {prefix}<carrierId>:<itemIndex>")));
            }
        }
        WorkbenchSourceTargetKind::BackgroundPrompt => {
            let unit_id = semantic_ref
                .strip_prefix("asset:background:")
                .ok_or_else(|| invalid("must start with asset:background:".to_string()))?;
            if unit_id.is_empty() {
                return Err(invalid("unit id must not be empty".to_string()));
            }
        }
        WorkbenchSourceTargetKind::EvidenceImagePrompt => {
            let rest = semantic_ref
                .strip_prefix("asset:evidence:")
                .ok_or_else(|| invalid("must start with asset:evidence:".to_string()))?;
            let evidence_id = rest
                .strip_suffix(":imagePrompt")
                .ok_or_else(|| invalid("must end with :imagePrompt".to_string()))?;
            if evidence_id.is_empty() {
                return Err(invalid("evidence id must not be empty".to_string()));
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn apply_workbench_source_edit(
    request: ApplyWorkbenchSourceEditRequest,
) -> Result<ApplyWorkbenchSourceEditResult, EditorError> {
    let root = workspace_root()?;
    apply_workbench_source_edit_with_validation(&root, &request, &|command| {
        run_bounded_validation(command, WORKBENCH_VALIDATION_TIMEOUT)
    })
}

/// Apply pipeline: resolve → read → hash → ref/kind validation →
/// one-expected-line document check → atomic write → validation. `validate`
/// is injected so tests can assert the exact compile command and stub
/// compiler outcomes without spawning Bun.
fn apply_workbench_source_edit_with_validation(
    root: &Path,
    request: &ApplyWorkbenchSourceEditRequest,
    validate: &dyn Fn(&WorkbenchValidationCommand) -> WorkbenchValidationReport,
) -> Result<ApplyWorkbenchSourceEditResult, EditorError> {
    let resolved = resolve_workbench_source_document(root, &request.source_document_id)?;
    let content = read_source_text(&resolved.source_path)?;

    if sha256_hex(&content) != request.expected_hash {
        return Err(EditorError::new(
            "sourceEditStale",
            format!(
                "source {} changed since it was loaded; refresh and retry",
                resolved.source_relative
            ),
        ));
    }

    let kind = parse_workbench_source_target_kind(&request.kind)?;
    validate_workbench_semantic_ref(kind, &request.semantic_ref)?;

    if request.next_content == content {
        return Err(EditorError::new(
            "sourceEditNoChange",
            format!(
                "replacement for \"{}\" equals the current document",
                request.semantic_ref
            ),
        ));
    }
    let before: Vec<&str> = content.split('\n').collect();
    let after: Vec<&str> = request.next_content.split('\n').collect();
    let not_focused = |reason: String| {
        EditorError::new(
            "sourceEditNotFocused",
            format!(
                "edit for \"{}\" must change exactly the expected line: {reason}",
                request.semantic_ref
            ),
        )
    };
    if before.len() != after.len() {
        return Err(not_focused(format!(
            "physical line count changed from {} to {}",
            before.len(),
            after.len()
        )));
    }
    let changed: Vec<usize> = before
        .iter()
        .zip(after.iter())
        .enumerate()
        .filter_map(|(index, (old, new))| (old != new).then_some(index))
        .collect();
    match changed.as_slice() {
        [index] if *index + 1 == request.expected_line => {}
        [index] => {
            return Err(EditorError::new(
                "sourceEditLineMismatch",
                format!(
                    "edit for \"{}\" changed line {} but expected line {}",
                    request.semantic_ref,
                    *index + 1,
                    request.expected_line
                ),
            ));
        }
        _ => {
            return Err(not_focused(format!(
                "{} physical lines changed",
                changed.len()
            )));
        }
    }

    write_text_atomic_no_follow(
        &resolved.source_path,
        &request.next_content,
        "sourceEditWriteFailed",
    )?;

    // Committed whether or not validation passes: applied + failed/timeout
    // validation is a distinct, explicit outcome with no automatic rollback.
    let validation = validate(&scenes_compile_validation_command(root));
    Ok(ApplyWorkbenchSourceEditResult { validation })
}

/// Post-apply compile validation target timeout.
const WORKBENCH_VALIDATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
const WORKBENCH_VALIDATION_POLL_INTERVAL: std::time::Duration =
    std::time::Duration::from_millis(100);
/// Drain budget reserved *within* the timeout deadline so the TimedOut path
/// can still collect stdout/stderr tails after the kill. The process is killed
/// at `deadline - DRAIN_FLOOR`; the remaining `DRAIN_FLOOR` is spent draining.
/// This keeps total validation within `WORKBENCH_VALIDATION_TIMEOUT` while
/// ensuring the timeout diagnostic is not silently empty.
const WORKBENCH_VALIDATION_DRAIN_FLOOR: std::time::Duration = std::time::Duration::from_secs(2);
/// Per-stream cap on compile output kept for failure diagnostics; the full
/// stream is still drained concurrently so the child never blocks on full
/// pipes.
const WORKBENCH_VALIDATION_OUTPUT_LIMIT: usize = 8 * 1024;

/// Exact `bun run scenes:compile` invocation for post-apply validation.
#[derive(Debug, Clone, PartialEq)]
struct WorkbenchValidationCommand {
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
}

fn scenes_compile_validation_command(cwd: &Path) -> WorkbenchValidationCommand {
    WorkbenchValidationCommand {
        program: "bun".to_string(),
        args: vec!["run".to_string(), "scenes:compile".to_string()],
        cwd: cwd.to_path_buf(),
    }
}

enum ValidationOutcome {
    Exited(std::process::ExitStatus),
    TimedOut,
    Lost(String),
}

/// Spawns the validation command in its own process group, drains
/// stdout/stderr on separate threads (keeping only the tail within the output
/// limit), polls for completion, and kills the whole group at the deadline.
/// Drain tails are collected within the remaining budget, so a descendant
/// that somehow survives the group kill cannot extend validation past the
/// bound either.
fn run_bounded_validation(
    command: &WorkbenchValidationCommand,
    timeout: std::time::Duration,
) -> WorkbenchValidationReport {
    use std::process::{Command, Stdio};

    let mut spawn = Command::new(&command.program);
    spawn
        .args(&command.args)
        .current_dir(&command.cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        // Own process group: the deadline kill must reach nested `bun run`
        // descendants too, or their inherited pipes extend the drain joins
        // past the mandatory bound.
        use std::os::unix::process::CommandExt;
        spawn.process_group(0);
    }
    let mut child = match spawn.spawn() {
        Ok(child) => child,
        Err(error) => {
            return WorkbenchValidationReport::failed(
                "sourceEditValidationFailed",
                format!("failed to spawn {}: {error}", command.program),
            );
        }
    };
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");
    let (stdout_sender, stdout_receiver) = std::sync::mpsc::channel();
    let (stderr_sender, stderr_receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = stdout_sender.send(drain_bounded_tail(
            stdout,
            WORKBENCH_VALIDATION_OUTPUT_LIMIT,
        ));
    });
    std::thread::spawn(move || {
        let _ = stderr_sender.send(drain_bounded_tail(
            stderr,
            WORKBENCH_VALIDATION_OUTPUT_LIMIT,
        ));
    });

    let deadline = std::time::Instant::now() + timeout;
    // Kill at `kill_deadline` so the remaining budget up to `deadline` is
    // available for draining stdout/stderr tails after the kill. If the
    // timeout is shorter than the drain floor, kill immediately and use the
    // full timeout for draining.
    let kill_deadline = deadline
        .checked_sub(WORKBENCH_VALIDATION_DRAIN_FLOOR)
        .unwrap_or_else(std::time::Instant::now);
    let outcome = loop {
        match child.try_wait() {
            Ok(Some(status)) => break ValidationOutcome::Exited(status),
            Ok(None) => {
                if std::time::Instant::now() >= kill_deadline {
                    kill_validation_process(&mut child);
                    break ValidationOutcome::TimedOut;
                }
                std::thread::sleep(WORKBENCH_VALIDATION_POLL_INTERVAL);
            }
            Err(error) => {
                kill_validation_process(&mut child);
                break ValidationOutcome::Lost(error.to_string());
            }
        }
    };

    // A pipe held open by a descendant that escaped the kill (e.g. a
    // double-forked grandchild, or a non-unix platform where only the direct
    // child died) must not extend validation past the deadline: collect the
    // tails within the remaining budget and give up beyond it. On the TimedOut
    // path the remaining budget is ~DRAIN_FLOOR (reserved above); on the
    // Exited path the process already closed the pipes so the drain threads
    // finish immediately regardless of the budget.
    //
    // The budget is recomputed before each receive against the same absolute
    // deadline, so a stdout drain that blocks for the full remaining budget
    // leaves stderr nothing — the two sequential waits cannot each consume
    // the full budget and extend validation past the bound.
    let stdout_tail = {
        let budget = deadline.saturating_duration_since(std::time::Instant::now());
        String::from_utf8_lossy(&drain_tail_within(stdout_receiver, budget)).into_owned()
    };
    let stderr_tail = {
        let budget = deadline.saturating_duration_since(std::time::Instant::now());
        String::from_utf8_lossy(&drain_tail_within(stderr_receiver, budget)).into_owned()
    };
    match outcome {
        ValidationOutcome::Exited(status) if status.success() => WorkbenchValidationReport::ok(),
        ValidationOutcome::Exited(status) => WorkbenchValidationReport::failed(
            "sourceEditValidationFailed",
            format!(
                "`bun run scenes:compile` failed with {status}\n\
                 --- stdout (tail) ---\n{stdout_tail}\n\
                 --- stderr (tail) ---\n{stderr_tail}"
            ),
        ),
        ValidationOutcome::TimedOut => WorkbenchValidationReport::failed(
            "sourceEditValidationTimeout",
            format!(
                "`bun run scenes:compile` exceeded {}s and was killed\n\
                 --- stdout (tail) ---\n{stdout_tail}\n\
                 --- stderr (tail) ---\n{stderr_tail}",
                timeout.as_secs()
            ),
        ),
        ValidationOutcome::Lost(error) => WorkbenchValidationReport::failed(
            "sourceEditValidationFailed",
            format!("failed to wait for the compile process: {error}"),
        ),
    }
}

fn drain_bounded_tail<R: std::io::Read>(mut reader: R, limit: usize) -> Vec<u8> {
    let mut tail = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                tail.extend_from_slice(&chunk[..read]);
                if tail.len() > limit {
                    let excess = tail.len() - limit;
                    tail.drain(..excess);
                }
            }
        }
    }
    tail
}

/// Kills the validation child. On unix the child leads its own process group
/// (`process_group(0)` at spawn), so the kill reaches descendants that
/// inherited the pipes; elsewhere only the direct child can be killed and the
/// bounded drain wait covers any survivor.
fn kill_validation_process(child: &mut std::process::Child) {
    #[cfg(unix)]
    unsafe {
        let _ = libc::killpg(child.id() as libc::pid_t, libc::SIGKILL);
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

/// Collects a drain thread's tail, giving up at `budget` (empty tail) so a
/// pipe held open past the deadline cannot extend validation beyond the bound.
fn drain_tail_within(
    receiver: std::sync::mpsc::Receiver<Vec<u8>>,
    budget: std::time::Duration,
) -> Vec<u8> {
    receiver.recv_timeout(budget).unwrap_or_default()
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

const ASSET_MANIFEST_RELATIVE_PATH: &str = "apps/game/src-tauri/resources/assets/manifest.json";
const ASSET_REPORT_RELATIVE_PATH: &str = "apps/game/src-tauri/resources/assets/report.json";
const ASSET_CONFIG_CHARACTERS_RELATIVE_PATH: &str = "static/assets/config/characters.yaml";
const ASSET_CONFIG_AUDIO_RELATIVE_PATH: &str = "static/assets/config/audio.yaml";
const STATIC_ASSETS_RELATIVE_ROOT: &str = "static/assets";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetWorkspaceTextSource {
    path: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetWorkspaceConfigSources {
    characters: AssetWorkspaceTextSource,
    audio: AssetWorkspaceTextSource,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetWorkspaceScene {
    chapter_id: String,
    scene_id: String,
    source_path: String,
    scene: serde_json::Value,
}

/// Fixed-domain snapshot of everything the Assets workbench mode edits:
/// compiler-generated manifest/report, authored config text, every manifest
/// scene through the public bundle path, and present asset files. Takes no
/// caller-supplied paths or asset ids — every file and root below is fixed.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetWorkspace {
    manifest: serde_json::Value,
    report: serde_json::Value,
    config_sources: AssetWorkspaceConfigSources,
    scenes: Vec<AssetWorkspaceScene>,
    existing_asset_paths: Vec<String>,
}

#[tauri::command]
fn load_asset_workspace() -> Result<AssetWorkspace, EditorError> {
    let root = workspace_root()?;
    load_asset_workspace_at_root(&root)
}

fn load_asset_workspace_at_root(root: &Path) -> Result<AssetWorkspace, EditorError> {
    let canonical_root = normalize_existing_root(root)?;
    let manifest = read_generated_asset_json(
        &canonical_root,
        ASSET_MANIFEST_RELATIVE_PATH,
        "assetManifestNotFound",
        "assetManifestInvalid",
        "generated asset manifest",
    )?;
    let report = read_generated_asset_json(
        &canonical_root,
        ASSET_REPORT_RELATIVE_PATH,
        "assetReportNotFound",
        "assetReportInvalid",
        "generated asset report",
    )?;
    let chapters = load_manifest_chapters(root)?;
    let mut scenes = Vec::new();
    for chapter in &chapters {
        for scene in &chapter.scenes {
            // Reuse the already-resolved manifest entry instead of calling
            // `load_scene_bundle_at_root`, which would re-resolve (and
            // re-read/re-parse) the whole chapter manifest per scene.
            let compiled_path = canonical_root
                .join(COMPILED_SCENES_RELATIVE_ROOT)
                .join(&scene.file);
            let bundle = load_compiled_scene_bundle(&compiled_path, &scene.id, scene.scene_type)?;
            scenes.push(AssetWorkspaceScene {
                chapter_id: chapter.id.clone(),
                scene_id: scene.id.clone(),
                source_path: scene.source_path.clone(),
                scene: bundle.scene,
            });
        }
    }
    Ok(AssetWorkspace {
        manifest,
        report,
        config_sources: AssetWorkspaceConfigSources {
            characters: read_text_source(&canonical_root, ASSET_CONFIG_CHARACTERS_RELATIVE_PATH)?,
            audio: read_text_source(&canonical_root, ASSET_CONFIG_AUDIO_RELATIVE_PATH)?,
        },
        existing_asset_paths: list_static_asset_files(&canonical_root)?,
        scenes,
    })
}

/// Reads a compiler-generated asset JSON file. These files exist only after
/// `bun run scenes:compile`, so a missing file is a loud, stable domain error
/// telling the developer to compile — never a loose-file fallback.
fn read_generated_asset_json(
    canonical_root: &Path,
    relative_path: &str,
    not_found_code: &'static str,
    invalid_code: &'static str,
    label: &str,
) -> Result<serde_json::Value, EditorError> {
    let path = canonical_root.join(relative_path);
    let text = fs::read_to_string(&path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            EditorError::new(
                not_found_code,
                format!(
                    "{label} not found at {}: run `bun run scenes:compile` to generate it",
                    path.display()
                ),
            )
        } else {
            EditorError::new(
                "readFailed",
                format!("failed to read {}: {error}", path.display()),
            )
        }
    })?;
    serde_json::from_str(&text).map_err(|error| {
        EditorError::new(
            invalid_code,
            format!("failed to parse {label} {}: {error}", path.display()),
        )
    })
}

fn read_text_source(
    canonical_root: &Path,
    relative_path: &str,
) -> Result<AssetWorkspaceTextSource, EditorError> {
    let path = canonical_root.join(relative_path);
    let content = fs::read_to_string(&path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            EditorError::not_found(&path)
        } else {
            EditorError::new(
                "readFailed",
                format!("failed to read {}: {error}", path.display()),
            )
        }
    })?;
    Ok(AssetWorkspaceTextSource {
        path: relative_path.to_string(),
        content,
    })
}

/// Read-only snapshot of the fixed planning documents: the story bible plus
/// every root-level `chapter_<N>_plan.md`, sorted numerically, bible first.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchPlanWorkspace {
    documents: Vec<WorkbenchPlanDocument>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchPlanDocument {
    id: String,
    kind: PlanDocumentKind,
    chapter_number: Option<u32>,
    #[serde(flatten)]
    source: AssetWorkspaceTextSource,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum PlanDocumentKind {
    StoryBible,
    ChapterPlan,
}

/// Single source of the `id`/`kind`/`chapterNumber` identity triple so it is
/// never re-derived at other call sites.
impl WorkbenchPlanDocument {
    fn story_bible(source: AssetWorkspaceTextSource) -> Self {
        Self {
            id: "story-bible".to_string(),
            kind: PlanDocumentKind::StoryBible,
            chapter_number: None,
            source,
        }
    }

    fn chapter_plan(source: AssetWorkspaceTextSource, chapter_number: u32) -> Self {
        Self {
            id: format!("chapter-{chapter_number}-plan"),
            kind: PlanDocumentKind::ChapterPlan,
            chapter_number: Some(chapter_number),
            source,
        }
    }
}

/// Accepts only root-level `chapter_<N>_plan.md` with a positive numeric N.
/// Rejects non-canonical numeric forms (e.g. leading zeros like
/// `chapter_01_plan.md`) so they cannot collide with `chapter_1_plan.md` and
/// produce a duplicate `chapter-1-plan` document identity.
fn chapter_plan_number(name: &str) -> Option<u32> {
    let raw = name.strip_prefix("chapter_")?.strip_suffix("_plan.md")?;
    let number = raw.parse::<u32>().ok()?;
    if number == 0 || raw != number.to_string().as_str() {
        return None;
    }
    Some(number)
}

#[tauri::command]
fn load_plan_workspace() -> Result<WorkbenchPlanWorkspace, EditorError> {
    let root = workspace_root()?;
    load_plan_workspace_at_root(&root)
}

fn load_plan_workspace_at_root(root: &Path) -> Result<WorkbenchPlanWorkspace, EditorError> {
    let bible = read_text_source(root, PLAN_STORY_BIBLE_RELATIVE_PATH).map_err(|error| {
        if error.code == "notFound" {
            EditorError::new(
                "planStoryBibleNotFound",
                format!(
                    "story bible not found: {}",
                    root.join(PLAN_STORY_BIBLE_RELATIVE_PATH).display()
                ),
            )
        } else {
            error
        }
    })?;

    let plans_dir = root.join(STORY_SOURCE_RELATIVE_ROOT);
    let mut chapter_plans = Vec::new();
    for entry in fs::read_dir(&plans_dir).map_err(|error| {
        EditorError::new(
            "readFailed",
            format!("failed to read {}: {error}", plans_dir.display()),
        )
    })? {
        let entry = entry.map_err(|error| {
            EditorError::new(
                "readFailed",
                format!("failed to read {}: {error}", plans_dir.display()),
            )
        })?;
        // DirEntry::file_type does not follow symlinks; only regular root
        // files whose name the parser accepts are chapter plans.
        if !entry
            .file_type()
            .map_err(|error| {
                EditorError::new(
                    "readFailed",
                    format!("failed to stat {}: {error}", entry.path().display()),
                )
            })?
            .is_file()
        {
            continue;
        }
        let name = entry.file_name();
        if let Some(chapter_number) = name.to_str().and_then(chapter_plan_number) {
            chapter_plans.push((chapter_number, name.to_string_lossy().into_owned()));
        }
    }
    chapter_plans.sort_by_key(|(chapter_number, _)| *chapter_number);

    let mut documents = vec![WorkbenchPlanDocument::story_bible(bible)];
    for (chapter_number, name) in chapter_plans {
        let relative_path = format!("{STORY_SOURCE_RELATIVE_ROOT}/{name}");
        let source = read_text_source(root, &relative_path)?;
        documents.push(WorkbenchPlanDocument::chapter_plan(source, chapter_number));
    }
    Ok(WorkbenchPlanWorkspace { documents })
}

/// Recursively enumerates regular files beneath the fixed `static/assets`
/// root as repo-relative forward-slash paths, sorted. Symlinks (even to
/// regular files) and directories are never listed.
fn list_static_asset_files(canonical_root: &Path) -> Result<Vec<String>, EditorError> {
    let assets_root = canonical_root.join(STATIC_ASSETS_RELATIVE_ROOT);
    let mut paths = Vec::new();
    collect_regular_files(&assets_root, canonical_root, &mut paths)?;
    paths.sort();
    Ok(paths)
}

fn collect_regular_files(
    dir: &Path,
    canonical_root: &Path,
    out: &mut Vec<String>,
) -> Result<(), EditorError> {
    let entries = fs::read_dir(dir).map_err(|error| {
        EditorError::new(
            "readFailed",
            format!("failed to read {}: {error}", dir.display()),
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            EditorError::new(
                "readFailed",
                format!("failed to read {}: {error}", dir.display()),
            )
        })?;
        // DirEntry::file_type does not follow symlinks, so a symlink is
        // neither listed as a file nor descended into as a directory.
        let file_type = entry.file_type().map_err(|error| {
            EditorError::new(
                "readFailed",
                format!("failed to stat {}: {error}", entry.path().display()),
            )
        })?;
        if file_type.is_dir() {
            collect_regular_files(&entry.path(), canonical_root, out)?;
        } else if file_type.is_file() {
            let entry_path = entry.path();
            let relative = entry_path.strip_prefix(canonical_root).unwrap();
            out.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_workbench_index,
            load_scene_bundle,
            load_investigation_layout,
            save_investigation_layout,
            load_asset_workspace,
            load_plan_workspace,
            load_workbench_source_document,
            apply_workbench_source_edit
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
        assert!(!scenes[2].stage_capable);
        assert!(!scenes[3].stage_capable);
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

    #[test]
    fn save_investigation_layout_rejects_mismatched_scene_id() {
        let root = temp_workbench_root();
        let mut layout = fixture_layout();
        layout.scene_id = "investigation_scene_a".to_string();
        assert_eq!(
            save_investigation_layout_at_root(&root, "chapter_1", "investigation_scene_b", &layout)
                .unwrap_err()
                .code,
            "layoutSceneIdMismatch"
        );
    }

    #[test]
    fn load_investigation_layout_rejects_mismatched_embedded_scene_id() {
        let root = temp_workbench_root();
        // Plant a sidecar at scene B's path that claims a different scene id,
        // simulating a copied/stale sidecar. The domain boundary must reject it
        // rather than load it as scene B.
        let sidecar_path = root
            .join(STORY_SOURCE_RELATIVE_ROOT)
            .join("chapter_1")
            .join("investigation_scene_b.layout.json");
        fs::write(
            &sidecar_path,
            r#"{"version":1,"sceneId":"investigation_scene_a","sublocations":{}}"#,
        )
        .unwrap();
        assert_eq!(
            load_investigation_layout_at_root(&root, "chapter_1", "investigation_scene_b")
                .unwrap_err()
                .code,
            "layoutSceneIdMismatch"
        );
    }

    #[test]
    fn asset_workspace_snapshot_preserves_manifest_order_and_sources() {
        let root = temp_asset_workspace_root();
        let snapshot = load_asset_workspace_at_root(&root).unwrap();

        assert_eq!(snapshot.manifest["enabled"], true);
        assert_eq!(
            snapshot.manifest["entries"]
                .as_array()
                .unwrap()
                .iter()
                .map(|entry| entry["assetId"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec![
                "background.fixture_rain_street",
                "portrait.fixture_akane.concerned"
            ]
        );
        assert_eq!(snapshot.report["requested"]["background"], 1);
        assert_eq!(snapshot.report["requested"]["audio"], 0);
        assert_eq!(snapshot.report["warnings"].as_array().unwrap().len(), 0);

        let scenes = &snapshot.scenes;
        assert_eq!(scenes.len(), 4);
        assert_eq!(
            scenes
                .iter()
                .map(|scene| scene.scene_id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "scene_a",
                "investigation_scene_b",
                "interrogation_scene_c",
                "analysis_scene_d"
            ]
        );
        assert_eq!(scenes[0].chapter_id, "chapter_1");
        assert_eq!(
            scenes[0].source_path,
            "docs/stories_plan/chapter_1/scene_a.md"
        );
        assert_eq!(scenes[0].scene["id"], "scene_a");

        assert_eq!(
            snapshot.config_sources.characters.path,
            "static/assets/config/characters.yaml"
        );
        assert_eq!(
            snapshot.config_sources.characters.content,
            "characters: []\n"
        );
        assert_eq!(
            snapshot.config_sources.audio.path,
            "static/assets/config/audio.yaml"
        );
        assert_eq!(snapshot.config_sources.audio.content, "audio: {}\n");

        assert_eq!(
            snapshot.existing_asset_paths,
            vec![
                "static/assets/backgrounds/fixture_rain_street.png",
                "static/assets/config/audio.yaml",
                "static/assets/config/characters.yaml",
            ]
        );
    }

    #[test]
    fn asset_workspace_reuses_public_analysis_sanitizer() {
        let root = temp_asset_workspace_root();
        let snapshot = load_asset_workspace_at_root(&root).unwrap();

        let analysis = snapshot
            .scenes
            .iter()
            .find(|scene| scene.scene_id == "analysis_scene_d")
            .unwrap();
        // The snapshot scene must exactly match what load_scene_bundle_at_root
        // returns for the same scene — the sanitizer is shared, not re-derived.
        let direct = load_scene_bundle_at_root(&root, "chapter_1", "analysis_scene_d").unwrap();
        assert_eq!(analysis.scene, direct.scene);
        assert_eq!(
            analysis.scene["boards"][0]["common"]["prompt"],
            "public prompt"
        );

        let serialized = serde_json::to_string(&snapshot).unwrap();
        for forbidden in [
            "acceptedGroupByCard",
            "secret_progression",
            "minimumSelected",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "leaked forbidden field/value {forbidden}"
            );
        }
    }

    #[test]
    fn asset_workspace_requires_generated_manifest_and_report() {
        let root = temp_asset_workspace_root();
        fs::remove_file(root.join(ASSET_MANIFEST_RELATIVE_PATH)).unwrap();
        let manifest_error = load_asset_workspace_at_root(&root).unwrap_err();
        assert_eq!(manifest_error.code, "assetManifestNotFound");
        assert!(manifest_error.message.contains("bun run scenes:compile"));

        fs::write(
            root.join(ASSET_MANIFEST_RELATIVE_PATH),
            r#"{"enabled":true,"entries":[]}"#,
        )
        .unwrap();
        fs::remove_file(root.join(ASSET_REPORT_RELATIVE_PATH)).unwrap();
        let report_error = load_asset_workspace_at_root(&root).unwrap_err();
        assert_eq!(report_error.code, "assetReportNotFound");
        assert!(report_error.message.contains("bun run scenes:compile"));
    }

    #[test]
    fn asset_workspace_file_presence_stays_under_static_assets() {
        let root = temp_asset_workspace_root();
        fs::create_dir_all(root.join("static/assets/evidence/nested")).unwrap();
        fs::write(root.join("static/assets/evidence/top.png"), "png").unwrap();
        fs::write(root.join("static/assets/evidence/nested/letter.png"), "png").unwrap();
        // Symlinks (even to regular files) and the static/ sibling tree are
        // never listed.
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            root.join("static/assets/evidence/top.png"),
            root.join("static/assets/evidence/link.png"),
        )
        .unwrap();
        fs::write(root.join("static/outside.txt"), "nope").unwrap();

        let snapshot = load_asset_workspace_at_root(&root).unwrap();
        assert_eq!(
            snapshot.existing_asset_paths,
            vec![
                "static/assets/backgrounds/fixture_rain_street.png",
                "static/assets/config/audio.yaml",
                "static/assets/config/characters.yaml",
                "static/assets/evidence/nested/letter.png",
                "static/assets/evidence/top.png",
            ]
        );
    }

    #[test]
    fn plan_workspace_reads_bible_then_numeric_chapter_plans() {
        let root = temp_workbench_root();
        fs::write(
            root.join("docs/stories_plan/final_story_bible.md"),
            "# Bible\n",
        )
        .unwrap();
        fs::write(root.join("docs/stories_plan/chapter_10_plan.md"), "# Ten\n").unwrap();
        fs::write(root.join("docs/stories_plan/chapter_2_plan.md"), "# Two\n").unwrap();

        let snapshot = load_plan_workspace_at_root(&root).unwrap();
        assert_eq!(
            snapshot
                .documents
                .iter()
                .map(|document| document.id.as_str())
                .collect::<Vec<_>>(),
            vec!["story-bible", "chapter-2-plan", "chapter-10-plan"]
        );
    }

    #[test]
    fn plan_workspace_ignores_nested_and_invalid_chapter_plan_names() {
        let root = temp_workbench_root();
        fs::write(
            root.join("docs/stories_plan/final_story_bible.md"),
            "# Bible\n",
        )
        .unwrap();
        fs::write(root.join("docs/stories_plan/chapter_0_plan.md"), "# Zero\n").unwrap();
        fs::write(root.join("docs/stories_plan/chapter_x_plan.md"), "# X\n").unwrap();
        fs::write(
            root.join("docs/stories_plan/chapter_1/scene_a.md"),
            "# Scene\n",
        )
        .unwrap();

        assert_eq!(
            load_plan_workspace_at_root(&root).unwrap().documents.len(),
            1
        );
    }

    #[test]
    fn plan_workspace_rejects_leading_zero_chapter_plan_names() {
        // `chapter_01_plan.md` must not be accepted: it would parse to 1 and
        // collide with `chapter_1_plan.md`'s `chapter-1-plan` identity.
        let root = temp_workbench_root();
        fs::write(
            root.join("docs/stories_plan/final_story_bible.md"),
            "# Bible\n",
        )
        .unwrap();
        fs::write(root.join("docs/stories_plan/chapter_1_plan.md"), "# One\n").unwrap();
        fs::write(
            root.join("docs/stories_plan/chapter_01_plan.md"),
            "# Leading zero\n",
        )
        .unwrap();

        let snapshot = load_plan_workspace_at_root(&root).unwrap();
        let ids: Vec<&str> = snapshot
            .documents
            .iter()
            .map(|document| document.id.as_str())
            .collect();
        assert_eq!(ids, vec!["story-bible", "chapter-1-plan"]);
        // No duplicate identity from the leading-zero filename.
        assert_eq!(ids.iter().filter(|id| **id == "chapter-1-plan").count(), 1);
    }

    #[test]
    fn plan_workspace_requires_only_the_story_bible() {
        let root = temp_workbench_root();
        assert_eq!(
            load_plan_workspace_at_root(&root).unwrap_err().code,
            "planStoryBibleNotFound"
        );

        fs::write(
            root.join("docs/stories_plan/final_story_bible.md"),
            "# Bible\n",
        )
        .unwrap();
        assert_eq!(
            load_plan_workspace_at_root(&root).unwrap().documents.len(),
            1
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

    /// Extends `temp_workbench_root` with the fixed asset-workspace files:
    /// compiler-generated manifest/report, authored config text, and one
    /// present static asset file.
    fn temp_asset_workspace_root() -> PathBuf {
        let root = temp_workbench_root();
        fs::create_dir_all(root.join("apps/game/src-tauri/resources/assets")).unwrap();
        fs::write(
            root.join("apps/game/src-tauri/resources/assets/manifest.json"),
            r#"{"enabled":true,"entries":[
{"assetId":"background.fixture_rain_street","type":"background","source":{},"expectedPath":"static/assets/backgrounds/fixture_rain_street.png","publicPath":"/backgrounds/fixture_rain_street.png","promptParts":{"globalStyle":"g","typePrompt":"t","subjectPrompt":"s","entryPrompt":"e"},"finalPrompt":"g"},
{"assetId":"portrait.fixture_akane.concerned","type":"portrait","source":{},"expectedPath":"static/assets/portraits/fixture_akane_concerned.png","publicPath":"/portraits/fixture_akane_concerned.png","promptParts":{"globalStyle":"g","typePrompt":"t","subjectPrompt":"s","entryPrompt":"e"},"finalPrompt":"g"}
]}"#,
        )
        .unwrap();
        fs::write(
            root.join("apps/game/src-tauri/resources/assets/report.json"),
            r#"{"enabled":true,"requested":{"background":1,"portrait":1,"standee":0,"evidence":0,"audio":0},"warnings":[]}"#,
        )
        .unwrap();
        fs::create_dir_all(root.join("static/assets/config")).unwrap();
        fs::create_dir_all(root.join("static/assets/backgrounds")).unwrap();
        fs::write(
            root.join("static/assets/config/characters.yaml"),
            "characters: []\n",
        )
        .unwrap();
        fs::write(root.join("static/assets/config/audio.yaml"), "audio: {}\n").unwrap();
        fs::write(
            root.join("static/assets/backgrounds/fixture_rain_street.png"),
            "png",
        )
        .unwrap();
        root
    }

    // == HPA-135 Task 3: closed SHA-guarded one-line source write ============
    mod focused_source {
        use super::*;

        fn write_scene_source(root: &Path, content: &str) {
            fs::write(root.join("docs/stories_plan/chapter_1/scene_a.md"), content).unwrap();
        }

        fn load_document(root: &Path) -> WorkbenchSourceDocument {
            load_workbench_source_document_at_root(root, "scene:chapter_1:scene_a").unwrap()
        }

        #[test]
        fn focused_source_load_resolves_known_manifest_scene_to_canonical_markdown() {
            let root = temp_workbench_root();
            write_scene_source(&root, "Hello workbench source.\nSecond line.\n");

            let document = load_document(&root);

            assert_eq!(document.id, "scene:chapter_1:scene_a");
            assert_eq!(document.path, "docs/stories_plan/chapter_1/scene_a.md");
            assert_eq!(document.content, "Hello workbench source.\nSecond line.\n");
            // Independent SHA-256 vector proves the hash is really lowercase
            // SHA-256 of the exact UTF-8 bytes.
            assert_eq!(
                document.hash,
                "eef7aba77a63f7c498f9d5006266cca16a9c3fe6438a77bcc84a6ff6c5fa5b49"
            );
        }

        #[test]
        fn focused_source_load_rejects_malformed_traversal_and_unknown_ids() {
            let root = temp_workbench_root();
            for id in [
                "plan:story-bible",
                "asset:background:unit_a",
                "scene:chapter_1",
                "scene:",
                "scene::scene_a",
                "scene:chapter_1:",
                "scene:missing_chapter:scene_a",
                "scene:chapter_1:missing_scene",
                "scene:../../etc:passwd",
            ] {
                let error = load_workbench_source_document_at_root(&root, id).unwrap_err();
                assert_eq!(error.code, "sourceDocumentUnsupported", "id: {id}");
            }
        }

        #[test]
        fn focused_source_document_hash_tracks_exact_source_bytes() {
            let root = temp_workbench_root();
            write_scene_source(&root, "alpha\n");
            let first = load_document(&root).hash;

            // Same visible text, different exact bytes → different hash.
            write_scene_source(&root, "alpha\r\n");
            let crlf = load_document(&root).hash;

            write_scene_source(&root, "alpha\n");
            assert_eq!(first.len(), 64);
            assert_ne!(first, crlf);
            assert_eq!(load_document(&root).hash, first);
        }

        fn scene_a_path(root: &Path) -> PathBuf {
            root.join("docs/stories_plan/chapter_1/scene_a.md")
        }

        fn source_edit_request(
            document: &WorkbenchSourceDocument,
            kind: &str,
            semantic_ref: &str,
            expected_line: usize,
            next_content: &str,
        ) -> ApplyWorkbenchSourceEditRequest {
            ApplyWorkbenchSourceEditRequest {
                source_document_id: document.id.clone(),
                expected_hash: document.hash.clone(),
                semantic_ref: semantic_ref.to_string(),
                kind: kind.to_string(),
                expected_line,
                next_content: next_content.to_string(),
            }
        }

        fn never_validate(_: &WorkbenchValidationCommand) -> WorkbenchValidationReport {
            panic!("validation must not run before the write")
        }

        fn apply_error(root: &Path, request: &ApplyWorkbenchSourceEditRequest) -> EditorError {
            apply_workbench_source_edit_with_validation(root, request, &never_validate).unwrap_err()
        }

        const INVALID_SEMANTIC_REFS: &[(&str, &str)] = &[
            ("readerDialogue", "reader:action:main:0"), // kind/ref mismatch
            ("readerDialogue", "reader:dialogue:main"), // missing :<itemIndex>
            ("readerDialogue", "reader:dialogue:main:zero"), // non-numeric index
            ("readerDialogue", "reader:dialogue::0"),   // empty carrier
            ("readerDialogue", "asset:background:unit"), // wrong prefix
            ("readerAction", "reader:dialogue:main:0"), // kind/ref mismatch
            ("readerAction", "reader:action:main"),     // missing :<itemIndex>
            ("backgroundPrompt", "asset:background:"),  // empty unit id
            ("backgroundPrompt", "reader:dialogue:main:0"), // wrong prefix
            ("evidenceImagePrompt", "asset:evidence:evidence_a"), // missing :imagePrompt
            ("evidenceImagePrompt", "asset:evidence::imagePrompt"), // empty evidence id
            ("evidenceImagePrompt", "asset:background:unit"), // wrong prefix
        ];

        #[test]
        fn focused_source_apply_rejects_stale_expected_hash_without_writing() {
            let root = temp_workbench_root();
            write_scene_source(&root, "one\n");
            let mut request = source_edit_request(
                &load_document(&root),
                "readerDialogue",
                "reader:dialogue:main:0",
                1,
                "ONE\n",
            );
            request.expected_hash = "0".repeat(64);

            let error = apply_error(&root, &request);

            assert_eq!(error.code, "sourceEditStale");
            assert_eq!(fs::read_to_string(scene_a_path(&root)).unwrap(), "one\n");
        }

        #[test]
        fn focused_source_apply_rejects_unsupported_kind() {
            let root = temp_workbench_root();
            write_scene_source(&root, "one\n");
            for kind in ["characterPrompt", "readerdialogue", "", "reader_dialogue"] {
                let request = source_edit_request(
                    &load_document(&root),
                    kind,
                    "reader:dialogue:main:0",
                    1,
                    "ONE\n",
                );
                let error = apply_error(&root, &request);
                assert_eq!(error.code, "sourceEditKindUnsupported", "kind: {kind}");
            }
        }

        #[test]
        fn focused_source_apply_rejects_invalid_semantic_refs() {
            let root = temp_workbench_root();
            write_scene_source(&root, "one\n");
            for (kind, reference) in INVALID_SEMANTIC_REFS {
                let request =
                    source_edit_request(&load_document(&root), kind, reference, 1, "ONE\n");
                let error = apply_error(&root, &request);
                assert_eq!(
                    error.code, "sourceEditSemanticRefInvalid",
                    "kind {kind} ref {reference}"
                );
            }
        }

        #[test]
        fn focused_source_apply_rejects_no_change() {
            let root = temp_workbench_root();
            write_scene_source(&root, "one\ntwo\n");
            let request = source_edit_request(
                &load_document(&root),
                "readerDialogue",
                "reader:dialogue:main:0",
                1,
                "one\ntwo\n",
            );
            assert_eq!(apply_error(&root, &request).code, "sourceEditNoChange");
        }

        #[test]
        fn focused_source_apply_rejects_line_count_change() {
            let root = temp_workbench_root();
            write_scene_source(&root, "one\ntwo\nthree\n");
            // Dropping the trailing newline removes one physical line.
            let request = source_edit_request(
                &load_document(&root),
                "readerDialogue",
                "reader:dialogue:main:1",
                2,
                "one\ntwo",
            );
            assert_eq!(apply_error(&root, &request).code, "sourceEditNotFocused");
        }

        #[test]
        fn focused_source_apply_rejects_multiple_changed_lines() {
            let root = temp_workbench_root();
            write_scene_source(&root, "one\ntwo\nthree\n");
            let request = source_edit_request(
                &load_document(&root),
                "readerDialogue",
                "reader:dialogue:main:1",
                2,
                "ONE\nTWO\nthree\n",
            );
            assert_eq!(apply_error(&root, &request).code, "sourceEditNotFocused");
        }

        #[test]
        fn focused_source_apply_rejects_changed_line_other_than_expected() {
            let root = temp_workbench_root();
            write_scene_source(&root, "one\ntwo\nthree\n");
            let request = source_edit_request(
                &load_document(&root),
                "readerDialogue",
                "reader:dialogue:main:2",
                3,
                "one\nTWO\nthree\n",
            );
            assert_eq!(apply_error(&root, &request).code, "sourceEditLineMismatch");
        }

        #[test]
        fn focused_source_apply_writes_expected_line_and_runs_scenes_compile_in_workspace() {
            let root = temp_workbench_root();
            write_scene_source(&root, "one\ntwo\nthree\n");
            let request = source_edit_request(
                &load_document(&root),
                "readerDialogue",
                "reader:dialogue:main:1",
                2,
                "one\nTWO-edited\nthree\n",
            );
            // The command wrapper passes workspace_root() (already
            // canonicalized); mirror that here so the validation cwd
            // assertion matches production.
            let root = root.canonicalize().unwrap();

            let recorded = std::cell::RefCell::new(None);
            let result = apply_workbench_source_edit_with_validation(&root, &request, &|command| {
                *recorded.borrow_mut() = Some(command.clone());
                WorkbenchValidationReport::ok()
            })
            .unwrap();

            // Injected runner saw the exact executable/argv/cwd.
            let command = recorded.into_inner().unwrap();
            assert_eq!(command.program, "bun");
            assert_eq!(command.args, vec!["run", "scenes:compile"]);
            assert_eq!(command.cwd, root.canonicalize().unwrap());
            assert_eq!(
                WORKBENCH_VALIDATION_TIMEOUT,
                std::time::Duration::from_secs(120)
            );
            assert!(result.validation.ok);

            // The write is byte-for-byte the reviewed nextContent.
            assert_eq!(
                fs::read_to_string(scene_a_path(&root)).unwrap(),
                "one\nTWO-edited\nthree\n"
            );
            // Atomic temp files never leak next to the source.
            for entry in fs::read_dir(root.join("docs/stories_plan/chapter_1")).unwrap() {
                let name = entry.unwrap().file_name();
                assert!(
                    !name.to_string_lossy().starts_with('.'),
                    "leftover temp file: {name:?}"
                );
            }
        }

        #[test]
        fn focused_source_apply_keeps_written_source_when_validation_fails() {
            let root = temp_workbench_root();
            write_scene_source(&root, "one\ntwo\n");
            let request = source_edit_request(
                &load_document(&root),
                "readerDialogue",
                "reader:dialogue:main:1",
                2,
                "one\nTWO\n",
            );

            let result = apply_workbench_source_edit_with_validation(&root, &request, &|_| {
                WorkbenchValidationReport::failed("sourceEditValidationFailed", "boom")
            })
            .unwrap();

            // Applied + failed validation: written stays written, no rollback.
            assert!(!result.validation.ok);
            assert_eq!(
                result.validation.diagnostics[0].code,
                "sourceEditValidationFailed"
            );
            assert_eq!(
                fs::read_to_string(scene_a_path(&root)).unwrap(),
                "one\nTWO\n"
            );
        }

        fn sh_command(script: &str, cwd: &Path) -> WorkbenchValidationCommand {
            WorkbenchValidationCommand {
                program: "sh".to_string(),
                args: vec!["-c".to_string(), script.to_string()],
                cwd: cwd.to_path_buf(),
            }
        }

        #[test]
        fn focused_source_validation_reports_first_non_zero_exit_with_diagnostics() {
            let report = run_bounded_validation(
                &sh_command(
                    "echo out-marker; echo err-marker >&2; exit 3",
                    &std::env::temp_dir(),
                ),
                std::time::Duration::from_secs(30),
            );

            assert!(!report.ok);
            assert_eq!(report.diagnostics.len(), 1);
            assert_eq!(report.diagnostics[0].code, "sourceEditValidationFailed");
            let message = &report.diagnostics[0].message;
            assert!(message.contains("out-marker"), "missing stdout: {message}");
            assert!(message.contains("err-marker"), "missing stderr: {message}");
            assert!(
                message.contains("exit status: 3"),
                "missing status: {message}"
            );
        }

        #[test]
        fn focused_source_validation_bounds_captured_output_to_the_tail() {
            let report = run_bounded_validation(
                &sh_command(
                    "printf head-marker-stdout; \
                     head -c 9000000 /dev/zero | tr '\\0' 'o'; \
                     printf tail-marker-stdout; \
                     printf head-marker-stderr >&2; \
                     head -c 9000000 /dev/zero | tr '\\0' 'e' >&2; \
                     printf tail-marker-stderr >&2; exit 9",
                    &std::env::temp_dir(),
                ),
                std::time::Duration::from_secs(60),
            );

            assert!(!report.ok);
            let message = &report.diagnostics[0].message;
            // Only the bounded tail of each stream survives.
            assert!(message.contains("tail-marker-stdout"), "{message}");
            assert!(message.contains("tail-marker-stderr"), "{message}");
            assert!(!message.contains("head-marker-stdout"));
            assert!(!message.contains("head-marker-stderr"));
            assert!(
                message.len() < 2 * WORKBENCH_VALIDATION_OUTPUT_LIMIT + 4096,
                "unbounded diagnostics: {} bytes",
                message.len()
            );
        }

        #[test]
        fn focused_source_validation_kills_child_on_deadline_and_reports_timeout() {
            let started = std::time::Instant::now();
            let report = run_bounded_validation(
                &sh_command("exec sleep 30", &std::env::temp_dir()),
                std::time::Duration::from_millis(300),
            );
            let elapsed = started.elapsed();

            assert!(!report.ok);
            assert_eq!(report.diagnostics[0].code, "sourceEditValidationTimeout");
            assert!(
                elapsed < std::time::Duration::from_secs(10),
                "kill on deadline failed after {elapsed:?}"
            );
        }

        #[test]
        fn focused_source_validation_captures_tails_on_timeout() {
            // The process emits markers immediately, then holds the pipes open
            // past the kill deadline. The reserved drain floor must collect
            // both tails so the timeout diagnostic is not silently empty.
            let started = std::time::Instant::now();
            let report = run_bounded_validation(
                &sh_command(
                    "echo timeout-stdout-marker; echo timeout-stderr-marker >&2; exec sleep 30",
                    &std::env::temp_dir(),
                ),
                std::time::Duration::from_secs(3),
            );
            let elapsed = started.elapsed();

            assert!(!report.ok);
            assert_eq!(report.diagnostics[0].code, "sourceEditValidationTimeout");
            let message = &report.diagnostics[0].message;
            assert!(
                message.contains("timeout-stdout-marker"),
                "missing stdout tail on timeout: {message}"
            );
            assert!(
                message.contains("timeout-stderr-marker"),
                "missing stderr tail on timeout: {message}"
            );
            assert!(
                elapsed < std::time::Duration::from_secs(10),
                "timeout path extended past the deadline: {elapsed:?}"
            );
        }

        #[test]
        #[cfg(unix)]
        fn focused_source_validation_group_kills_descendants_holding_pipes() {
            let started = std::time::Instant::now();
            // `sh` execs `sleep 30` (same pid, past the 300 ms deadline) while
            // a same-group descendant `sleep 10` keeps stdout/stderr open for
            // 10 s after the deadline. Killing only the direct child would
            // hang the drain collection until the descendant exits; the
            // process-group kill must end the whole group at the deadline.
            let report = run_bounded_validation(
                &sh_command("sleep 10 & exec sleep 30", &std::env::temp_dir()),
                std::time::Duration::from_millis(300),
            );
            let elapsed = started.elapsed();

            assert!(!report.ok);
            assert_eq!(report.diagnostics[0].code, "sourceEditValidationTimeout");
            assert!(
                elapsed < std::time::Duration::from_secs(5),
                "a descendant holding the pipes extended validation past the deadline: {elapsed:?}"
            );
        }

        #[test]
        #[cfg(unix)]
        fn focused_source_validation_bounds_sequential_drain_against_one_deadline() {
            // Both pipes stay open past the kill via a double-forked descendant
            // that escapes the process-group kill (setsid). The two sequential
            // drain waits must share one absolute deadline: if stdout consumes
            // the full remaining budget, stderr gets nothing, so total drain
            // stays within the deadline instead of doubling it.
            if std::process::Command::new("perl")
                .arg("-e")
                .arg("1")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_err()
            {
                eprintln!("skipping: perl is not on PATH");
                return;
            }
            let started = std::time::Instant::now();
            let report = run_bounded_validation(
                &sh_command(
                    "perl -e 'use POSIX; fork and exit; POSIX::setsid(); sleep 10' & exec sleep 30",
                    &std::env::temp_dir(),
                ),
                std::time::Duration::from_secs(4),
            );
            let elapsed = started.elapsed();

            assert!(!report.ok);
            assert_eq!(report.diagnostics[0].code, "sourceEditValidationTimeout");
            // With the fix, total elapsed is bounded by the timeout (4 s) plus
            // a small polling tolerance: the kill happens at ~2 s (deadline minus
            // the 2 s drain floor), then the single shared deadline bounds both
            // drains to ~2 s total. The old code gave each drain the full 2 s
            // budget, so elapsed approached 6 s.
            assert!(
                elapsed < std::time::Duration::from_secs(5),
                "sequential drain extended past the single deadline: {elapsed:?}"
            );
        }

        fn bun_on_path() -> bool {
            let exe = if cfg!(windows) { "bun.exe" } else { "bun" };
            std::env::var_os("PATH")
                .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(exe).is_file()))
                .unwrap_or(false)
        }

        fn temp_validation_workspace() -> PathBuf {
            let mut dir = std::env::temp_dir();
            dir.push(format!(
                "lyra-focused-source-validation-{}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                ATOMIC_WRITE_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&dir).unwrap();
            dir
        }

        #[test]
        fn focused_source_validation_runs_real_bun_scenes_compile_in_workspace_cwd() {
            if !bun_on_path() {
                eprintln!("skipping: bun is not on PATH in this environment");
                return;
            }
            let workspace = temp_validation_workspace();
            fs::write(
                workspace.join("package.json"),
                r#"{"name":"lyra-focused-source-validation-test","private":true,"scripts":{"scenes:compile":"echo compiled > validation-cwd-marker.txt"}}"#,
            )
            .unwrap();

            let report = run_bounded_validation(
                &scenes_compile_validation_command(&workspace),
                std::time::Duration::from_secs(60),
            );

            assert!(report.ok, "real bun run failed: {:?}", report.diagnostics);
            assert!(
                workspace.join("validation-cwd-marker.txt").exists(),
                "bun did not run with the workspace as cwd"
            );
        }
    }

    fn temp_workbench_root() -> PathBuf {
        let mut root = std::env::temp_dir();
        // Counter suffix: parallel tests can land on the same nanosecond and
        // would otherwise share (and mutate) one fixture root.
        root.push(format!(
            "lyra-layout-editor-workbench-test-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            ATOMIC_WRITE_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
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
}
