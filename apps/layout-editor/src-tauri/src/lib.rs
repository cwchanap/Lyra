use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

/// Monotonic counter for unique layout sidecar temp-file names so concurrent
/// or rapid saves never collide on the temp path (see
/// `write_layout_sidecar_no_follow`).
static LAYOUT_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

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
    write_layout_sidecar_no_follow(&layout_path, &format!("{serialized}\n"))
}

/// Writes the layout sidecar without following an existing symlink at the
/// target path. `fs::write` opens with `O_CREAT|O_TRUNC` which follows
/// symlinks, so a planted `*.layout.json` symlink could redirect the write
/// outside the containment root even though the sidecar path itself was
/// validated. Instead, serialize into a uniquely-named temp file in the same
/// directory (so `rename` is atomic on a single filesystem) and rename it
/// over the target: `rename` replaces the directory entry itself rather than
/// writing through a symlink. The temp file lives next to the validated
/// sidecar path, so it stays within the containment root.
fn write_layout_sidecar_no_follow(layout_path: &Path, contents: &str) -> Result<(), EditorError> {
    let parent = layout_path.parent().ok_or_else(|| {
        EditorError::new(
            "writeFailed",
            format!("layout path has no parent: {}", layout_path.display()),
        )
    })?;
    let file_name = layout_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("layout.json");
    let unique = LAYOUT_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_path = parent.join(format!(".{file_name}.{}.{unique}.tmp", std::process::id()));

    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| {
                EditorError::new(
                    "writeFailed",
                    format!("failed to open temp {}: {error}", temp_path.display()),
                )
            })?;
        file.write_all(contents.as_bytes()).map_err(|error| {
            EditorError::new(
                "writeFailed",
                format!("failed to write temp {}: {error}", temp_path.display()),
            )
        })?;
        file.sync_all().map_err(|error| {
            EditorError::new(
                "writeFailed",
                format!("failed to sync temp {}: {error}", temp_path.display()),
            )
        })?;
    }

    fs::rename(&temp_path, layout_path).map_err(|error| {
        // Best-effort cleanup so a failed rename does not leave a stale temp.
        let _ = fs::remove_file(&temp_path);
        EditorError::new(
            "writeFailed",
            format!(
                "failed to rename temp to {}: {error}",
                layout_path.display()
            ),
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
            let bundle = load_scene_bundle_at_root(root, &chapter.id, &scene.id)?;
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
            load_asset_workspace
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
}
