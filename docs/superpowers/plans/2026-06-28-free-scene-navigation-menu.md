# Free Scene Navigation Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an eligible-user free scene navigator to the in-game Escape menu and move evidence and sound controls behind separate menu submenus.

**Architecture:** The Rust runtime remains the source of truth for compiled chapters and scene loading. The frontend owns the product entitlement gate (`dev || clearedOnce`) and renders scene navigation, evidence, and sound as separate `GameShell` submenus. Scene jumps reset gameplay state and prime the selected scene through the same runtime path as normal startup.

**Tech Stack:** Tauri 2 commands, Rust game runtime, Svelte 5 runes, Vitest, Svelte Testing Library, Bun, localStorage.

**Source spec:** `docs/superpowers/specs/2026-06-28-free-scene-navigation-menu-design.md`

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `apps/game/src-tauri/src/game/view.rs` | Add serializable scene-navigation index view structs. | Modify |
| `apps/game/src-tauri/src/game/schema.rs` | Let `SceneType` serialize into frontend navigation JSON. | Modify |
| `apps/game/src-tauri/src/game/error.rs` | Add typed unknown chapter/scene errors. | Modify |
| `apps/game/src-tauri/src/game/mod.rs` | Build scene index, jump to a requested scene, and test runtime behavior. | Modify |
| `apps/game/src-tauri/src/lib.rs` | Register Tauri commands for `list_scenes` and `jump_to_scene`. | Modify |
| `apps/game/src-tauri/examples/dev_engine_server.rs` | Mirror new commands in browser dev HTTP fallback. | Modify |
| `apps/game/src/lib/state/types.ts` | Mirror `SceneNavigationIndex` frontend type. | Modify |
| `apps/game/src/lib/state/story-clearance.ts` | Persist and load the local cleared-once entitlement. | Create |
| `apps/game/src/lib/state/story-clearance.test.ts` | Cover entitlement storage, warnings, and fallback behavior. | Create |
| `apps/game/src/lib/state/game-client.svelte.ts` | Add `listScenes`, `jumpToScene`, and no-SFX command dispatch for scene jumps. | Modify |
| `apps/game/src/lib/state/game-client-source.test.ts` | Cover client command args and jump failure behavior. | Modify |
| `apps/game/src/lib/components/SceneNavigationPanel.svelte` | Render chapter/scene selector and emit selected scene IDs. | Create |
| `apps/game/src/lib/components/SceneNavigationPanel.test.ts` | Cover scene-list rendering and selection behavior. | Create |
| `apps/game/src/lib/components/GameShell.svelte` | Add submenu state and move evidence/sound/scene content behind buttons. | Modify |
| `apps/game/src/lib/components/GameShellHarness.svelte` | Let tests inject scene-menu content through `GameShell`. | Modify |
| `apps/game/src/lib/components/GameShell.test.ts` | Cover submenu behavior and focus trapping. | Modify |
| `apps/game/src/routes/+page.svelte` | Wire eligibility, scene index loading, scene jump, and menu close behavior. | Modify |
| `apps/game/src/routes/page-source.test.ts` | Pin page-level wiring that is awkward to exercise in component tests. | Modify |

---

### Task 1: Add Rust Scene Navigation Index

**Files:**
- Modify: `apps/game/src-tauri/src/game/view.rs`
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`

- [ ] **Step 1: Add failing Rust tests for scene index output**

Append these tests inside `#[cfg(test)] mod tests` in `apps/game/src-tauri/src/game/mod.rs`:

```rust
#[test]
fn scene_navigation_index_lists_compiled_chapters_and_scenes() {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!(
        "lyra-scene-index-test-{}-{}",
        std::process::id(),
        n
    ));
    let chapter_1 = d.join("chapter_1");
    let chapter_2 = d.join("chapter_2");
    fs::create_dir_all(&chapter_1).unwrap();
    fs::create_dir_all(&chapter_2).unwrap();
    fs::write(
        d.join("chapters.json"),
        r#"{
            "chapters": [
                {
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "First",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" },
                        { "type": "investigation", "file": "chapter_1/investigation_scene_1.json" }
                    ]
                },
                {
                    "id": "chapter_2",
                    "title": "Chapter Two",
                    "summary": "Second",
                    "scenes": [
                        { "type": "interrogation", "file": "chapter_2/interrogation_scene_0.json" }
                    ]
                }
            ]
        }"#,
    )
    .unwrap();
    fs::write(
        chapter_1.join("scene_0.json"),
        r#"{
            "type": "linear",
            "id": "scene_0",
            "title": "Opening",
            "queue": [{ "kind": "line", "speaker": "A", "text": "start" }]
        }"#,
    )
    .unwrap();
    fs::write(
        chapter_1.join("investigation_scene_1.json"),
        r#"{
            "type": "investigation",
            "id": "investigation_scene_1",
            "title": "Investigation",
            "intro": [],
            "sublocations": [{
                "id": "room",
                "label": "Room",
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "room",
                "transitionDialogue": [],
                "hotspots": [],
                "characters": []
            }],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": "auto", "dialogue": [] }
        }"#,
    )
    .unwrap();
    fs::write(
        chapter_2.join("interrogation_scene_0.json"),
        r#"{
            "type": "interrogation",
            "id": "interrogation_scene_0",
            "title": "Interrogation",
            "intro": [],
            "phases": [{
                "kind": "testimony",
                "id": "phase_1",
                "label": "證言",
                "subject": { "id": "witness", "name": "Witness", "role": "Witness", "bio": "Quiet." },
                "required": true,
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "room",
                "entryDialogue": [],
                "statements": [],
                "results": []
            }],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": "auto", "dialogue": [] }
        }"#,
    )
    .unwrap();

    let index = GameEngine::scene_navigation_index(d.clone()).unwrap();

    assert_eq!(index.chapters.len(), 2);
    assert_eq!(index.chapters[0].id, "chapter_1");
    assert_eq!(index.chapters[0].title, "Chapter One");
    assert_eq!(index.chapters[0].index, 0);
    assert_eq!(index.chapters[0].scenes.len(), 2);
    assert_eq!(index.chapters[0].scenes[0].id, "scene_0");
    assert_eq!(index.chapters[0].scenes[0].title, "Opening");
    assert_eq!(index.chapters[0].scenes[0].scene_type, SceneType::Linear);
    assert_eq!(index.chapters[0].scenes[0].index, 0);
    assert_eq!(index.chapters[0].scenes[1].id, "investigation_scene_1");
    assert_eq!(
        index.chapters[0].scenes[1].scene_type,
        SceneType::Investigation
    );
    assert_eq!(index.chapters[1].id, "chapter_2");
    assert_eq!(index.chapters[1].scenes[0].id, "interrogation_scene_0");
    assert_eq!(
        index.chapters[1].scenes[0].scene_type,
        SceneType::Interrogation
    );

    let _ = fs::remove_dir_all(d);
}

#[test]
fn scene_navigation_index_rejects_manifest_type_mismatch() {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!(
        "lyra-scene-index-mismatch-test-{}-{}",
        std::process::id(),
        n
    ));
    let chapter_1 = d.join("chapter_1");
    fs::create_dir_all(&chapter_1).unwrap();
    fs::write(
        d.join("chapters.json"),
        r#"{
            "chapters": [{
                "id": "chapter_1",
                "title": "Chapter One",
                "summary": "First",
                "scenes": [{ "type": "interrogation", "file": "chapter_1/scene_0.json" }]
            }]
        }"#,
    )
    .unwrap();
    fs::write(
        chapter_1.join("scene_0.json"),
        r#"{
            "type": "linear",
            "id": "scene_0",
            "title": "Opening",
            "queue": []
        }"#,
    )
    .unwrap();

    let err = GameEngine::scene_navigation_index(d.clone()).unwrap_err();
    assert_eq!(err.code, "sceneValidationFailed");
    assert!(err.message.contains("declares interrogation"));
    assert!(err.message.contains("contains linear"));

    let _ = fs::remove_dir_all(d);
}
```

- [ ] **Step 2: Run the new focused test and verify it fails**

Run: `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml scene_navigation_index --lib`

Expected: FAIL with errors like `no function or associated item named 'scene_navigation_index' found for struct 'GameEngine'` and missing `SceneType` equality if not already imported.

- [ ] **Step 3: Make `SceneType` serializable**

In `apps/game/src-tauri/src/game/schema.rs`, update `SceneType` to derive `Serialize`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SceneType {
    Linear,
    Investigation,
    Interrogation,
}
```

- [ ] **Step 4: Add scene-navigation view structs**

In `apps/game/src-tauri/src/game/view.rs`, extend the schema imports and add these structs after `SceneView`:

```rust
use crate::game::schema::{AudioChannelJson, CharacterLayoutJson, DialogueItem, HotspotLayoutJson, SceneType};
```

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneNavigationIndex {
    pub chapters: Vec<SceneNavigationChapter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneNavigationChapter {
    pub id: String,
    pub title: String,
    pub index: usize,
    pub scenes: Vec<SceneNavigationScene>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneNavigationScene {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub scene_type: SceneType,
    pub index: usize,
}
```

- [ ] **Step 5: Add typed navigation errors**

In `apps/game/src-tauri/src/game/error.rs`, add these methods inside the existing `impl GameError` block:

```rust
pub fn unknown_chapter(id: &str) -> Self {
    Self::new("unknownChapter", format!("Chapter '{id}' does not exist."))
}

pub fn unknown_scene(chapter_id: &str, scene_id: &str) -> Self {
    Self::new(
        "unknownScene",
        format!("Scene '{scene_id}' does not exist in chapter '{chapter_id}'."),
    )
}
```

- [ ] **Step 6: Add the scene index implementation**

In `apps/game/src-tauri/src/game/mod.rs`, extend the `view` import:

```rust
use view::{
    AudioCueView, ChapterView, CharacterView, HotspotView, InquiryQuestionView,
    InterrogationPhaseKindView, InterrogationPhaseView, SceneNavigationChapter,
    SceneNavigationIndex, SceneNavigationScene, SceneView, SubjectView, SublocationView,
    TestimonyStatementView, TopicView,
};
```

Add this public associated function inside `impl GameEngine`:

```rust
pub fn scene_navigation_index(resources_dir: PathBuf) -> Result<SceneNavigationIndex, GameError> {
    let chapters = load_chapter_manifests(&resources_dir)?;
    scene_navigation_index_from_chapters(&resources_dir, &chapters)
}
```

Add these helpers near `load_scene_runtime`:

```rust
fn load_chapter_manifests(resources_dir: &std::path::Path) -> Result<Vec<ChapterManifest>, GameError> {
    let index = loader::load_chapters_index(resources_dir)?;
    let chapters: Vec<ChapterManifest> = index
        .chapters
        .into_iter()
        .map(|c| ChapterManifest {
            id: c.id,
            title: c.title,
            summary: c.summary,
            scenes: c
                .scenes
                .into_iter()
                .map(|s| SceneRef {
                    scene_type: s.scene_type,
                    file: s.file,
                })
                .collect(),
        })
        .collect();

    if chapters.is_empty() {
        return Err(GameError::chapter_load_failed(
            "chapters.json has no chapters.".into(),
        ));
    }

    Ok(chapters)
}

fn scene_navigation_index_from_chapters(
    resources_dir: &std::path::Path,
    chapters: &[ChapterManifest],
) -> Result<SceneNavigationIndex, GameError> {
    let mut chapter_views = Vec::with_capacity(chapters.len());

    for (chapter_index, chapter) in chapters.iter().enumerate() {
        let mut scenes = Vec::with_capacity(chapter.scenes.len());
        for (scene_index, scene_ref) in chapter.scenes.iter().enumerate() {
            let json = loader::load_scene(resources_dir, &scene_ref.file)?;
            let actual_type = scene_json_type(&json);
            if scene_ref.scene_type != actual_type {
                return Err(GameError::scene_validation_failed(format!(
                    "{}: chapter manifest declares {} but scene JSON contains {}",
                    scene_ref.file,
                    scene_type_label(scene_ref.scene_type),
                    scene_type_label(actual_type),
                )));
            }
            let (id, title) = scene_json_identity(&json);
            scenes.push(SceneNavigationScene {
                id: id.to_string(),
                title: title.to_string(),
                scene_type: actual_type,
                index: scene_index,
            });
        }

        chapter_views.push(SceneNavigationChapter {
            id: chapter.id.clone(),
            title: chapter.title.clone(),
            index: chapter_index,
            scenes,
        });
    }

    Ok(SceneNavigationIndex {
        chapters: chapter_views,
    })
}

fn scene_json_identity(json: &SceneJson) -> (&str, &str) {
    match json {
        SceneJson::Linear(scene) => (&scene.id, &scene.title),
        SceneJson::Investigation(scene) => (&scene.id, &scene.title),
        SceneJson::Interrogation(scene) => (&scene.id, &scene.title),
    }
}
```

Then simplify `GameEngine::new_started` to call `load_chapter_manifests(&resources_dir)?` instead of duplicating chapter-index conversion. Keep the existing empty-chapter behavior intact through the helper.

- [ ] **Step 7: Run the focused test and verify it passes**

Run: `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml scene_navigation_index --lib`

Expected: PASS for both scene-navigation index tests.

- [ ] **Step 8: Commit backend index work**

Run:

```bash
rtk git add apps/game/src-tauri/src/game/view.rs apps/game/src-tauri/src/game/schema.rs apps/game/src-tauri/src/game/error.rs apps/game/src-tauri/src/game/mod.rs
rtk git commit -m "feat: add scene navigation index"
```

Expected: commit succeeds with only those files staged.

---

### Task 2: Add Fresh Runtime Scene Jumping

**Files:**
- Modify: `apps/game/src-tauri/src/game/mod.rs`

- [ ] **Step 1: Add failing tests for jumping to linear, investigation, and interrogation scenes**

Append these tests inside `#[cfg(test)] mod tests` in `apps/game/src-tauri/src/game/mod.rs`:

```rust
fn scene_jump_fixture_resources() -> PathBuf {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!(
        "lyra-scene-jump-test-{}-{}",
        std::process::id(),
        n
    ));
    let chapter_1 = d.join("chapter_1");
    fs::create_dir_all(&chapter_1).unwrap();
    fs::write(
        d.join("chapters.json"),
        r#"{
            "chapters": [{
                "id": "chapter_1",
                "title": "Chapter One",
                "summary": "First",
                "scenes": [
                    { "type": "linear", "file": "chapter_1/scene_0.json" },
                    { "type": "investigation", "file": "chapter_1/investigation_scene_1.json" },
                    { "type": "interrogation", "file": "chapter_1/interrogation_scene_2.json" }
                ]
            }]
        }"#,
    )
    .unwrap();
    fs::write(
        chapter_1.join("scene_0.json"),
        r#"{
            "type": "linear",
            "id": "scene_0",
            "title": "Opening",
            "queue": [
                { "kind": "sceneTag", "text": "opening", "assetCue": { "backgroundAssetId": "background.opening" } },
                { "kind": "line", "speaker": "A", "text": "linear start" }
            ]
        }"#,
    )
    .unwrap();
    fs::write(
        chapter_1.join("investigation_scene_1.json"),
        r#"{
            "type": "investigation",
            "id": "investigation_scene_1",
            "title": "Investigation",
            "intro": [{ "kind": "line", "speaker": "B", "text": "investigation intro" }],
            "sublocations": [{
                "id": "room",
                "label": "Room",
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "room",
                "backgroundAssetId": "background.room",
                "transitionDialogue": [],
                "hotspots": [],
                "characters": []
            }],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": { "predicate": "hotspot_investigated", "id": "never" }, "dialogue": [] }
        }"#,
    )
    .unwrap();
    fs::write(
        chapter_1.join("interrogation_scene_2.json"),
        r#"{
            "type": "interrogation",
            "id": "interrogation_scene_2",
            "title": "Interrogation",
            "intro": [],
            "phases": [{
                "kind": "testimony",
                "id": "phase_1",
                "label": "證言",
                "subject": { "id": "witness", "name": "Witness", "role": "Witness", "bio": "Quiet." },
                "required": true,
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "interrogation room",
                "backgroundAssetId": "background.interrogation",
                "entryDialogue": [],
                "statements": [],
                "results": []
            }],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": "auto", "dialogue": [] }
        }"#,
    )
    .unwrap();
    d
}

#[test]
fn jump_to_scene_starts_linear_scene_fresh() {
    let d = scene_jump_fixture_resources();
    let mut engine = GameEngine::new_started(d.clone()).unwrap();
    let view = engine
        .jump_to_scene("chapter_1", "scene_0")
        .expect("jump to linear scene");

    assert_eq!(view.chapter.id, "chapter_1");
    match view.scene {
        SceneView::Linear { id, index, total, .. } => {
            assert_eq!(id, "scene_0");
            assert_eq!(index, 0);
            assert_eq!(total, 3);
        }
        other => panic!("expected linear scene, got {other:?}"),
    }
    match view.mode {
        ModeView::Dialogue {
            current,
            scene_tag,
            background_asset_id,
            ..
        } => {
            assert_eq!(scene_tag.as_deref(), Some("opening"));
            assert_eq!(background_asset_id.as_deref(), Some("background.opening"));
            assert!(
                matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "A" && text == "linear start")
            );
        }
        other => panic!("expected dialogue mode, got {other:?}"),
    }

    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn jump_to_scene_starts_investigation_scene_fresh_and_resets_inventory() {
    let d = scene_jump_fixture_resources();
    let mut engine = GameEngine::new_started(d.clone()).unwrap();
    engine.inventory.evidence.push(EvidenceRecord {
        id: "old".into(),
        name: "Old".into(),
        description: "Old".into(),
        details: "Old".into(),
        image_asset_id: None,
        on_reexamine: None,
        collected_in_chapter_id: "chapter_1".into(),
        collected_in_scene_id: "scene_0".into(),
    });

    let view = engine
        .jump_to_scene("chapter_1", "investigation_scene_1")
        .expect("jump to investigation scene");

    assert!(view.inventory.evidence.is_empty());
    match view.scene {
        SceneView::Investigation { id, index, total, .. } => {
            assert_eq!(id, "investigation_scene_1");
            assert_eq!(index, 1);
            assert_eq!(total, 3);
        }
        other => panic!("expected investigation scene, got {other:?}"),
    }
    match view.mode {
        ModeView::Dialogue { current, .. } => {
            assert!(
                matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "B" && text == "investigation intro")
            );
        }
        other => panic!("expected investigation intro dialogue, got {other:?}"),
    }

    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn jump_to_scene_starts_interrogation_scene_fresh() {
    let d = scene_jump_fixture_resources();
    let mut engine = GameEngine::new_started(d.clone()).unwrap();

    let view = engine
        .jump_to_scene("chapter_1", "interrogation_scene_2")
        .expect("jump to interrogation scene");

    match view.scene {
        SceneView::Interrogation {
            id,
            index,
            total,
            current_phase_id,
            ..
        } => {
            assert_eq!(id, "interrogation_scene_2");
            assert_eq!(index, 2);
            assert_eq!(total, 3);
            assert_eq!(current_phase_id.as_deref(), Some("phase_1"));
        }
        other => panic!("expected interrogation scene, got {other:?}"),
    }
    match view.mode {
        ModeView::Interrogation {
            phase_id,
            background_asset_id,
            ..
        } => {
            assert_eq!(phase_id, "phase_1");
            assert_eq!(
                background_asset_id.as_deref(),
                Some("background.interrogation")
            );
        }
        other => panic!("expected interrogation mode, got {other:?}"),
    }

    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn jump_to_scene_returns_typed_errors_for_unknown_ids() {
    let d = scene_jump_fixture_resources();
    let mut engine = GameEngine::new_started(d.clone()).unwrap();

    let err = engine.jump_to_scene("chapter_missing", "scene_0").unwrap_err();
    assert_eq!(err.code, "unknownChapter");

    let err = engine
        .jump_to_scene("chapter_1", "scene_missing")
        .unwrap_err();
    assert_eq!(err.code, "unknownScene");

    let _ = std::fs::remove_dir_all(d);
}
```

- [ ] **Step 2: Run focused scene-jump tests and verify they fail**

Run: `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml jump_to_scene --lib`

Expected: FAIL with `no method named 'jump_to_scene' found for struct 'GameEngine'`.

- [ ] **Step 3: Implement `jump_to_scene`**

Add this method inside `impl GameEngine`:

```rust
pub fn jump_to_scene(
    &mut self,
    chapter_id: &str,
    scene_id: &str,
) -> Result<GameStateView, GameError> {
    let chapter_idx = self
        .chapters
        .iter()
        .position(|chapter| chapter.id == chapter_id)
        .ok_or_else(|| GameError::unknown_chapter(chapter_id))?;
    let scene_idx = self.chapters[chapter_idx]
        .scenes
        .iter()
        .position(|scene_ref| {
            loader::load_scene(&self.resources_dir, &scene_ref.file)
                .map(|scene| scene_json_identity(&scene).0 == scene_id)
                .unwrap_or(false)
        })
        .ok_or_else(|| GameError::unknown_scene(chapter_id, scene_id))?;

    let scene_ref = self.chapters[chapter_idx]
        .scenes
        .get(scene_idx)
        .ok_or_else(|| GameError::unknown_scene(chapter_id, scene_id))?
        .clone();
    let queue_gen = self.next_queue_gen;
    let new_scene = load_scene_runtime(&self.resources_dir, &scene_ref, queue_gen)?;
    let snapshot = self.snapshot();

    self.current_chapter_idx = chapter_idx;
    self.current_scene_idx = scene_idx;
    self.scene = new_scene;
    self.last_visual_cue = LastVisualCue::default();
    self.inventory = Inventory::default();
    self.next_queue_gen = queue_gen + 1;

    if let Err(err) = self.prime_initial_queue() {
        self.restore_snapshot(snapshot);
        return Err(err);
    }

    Ok(self.view())
}
```

Then refactor the scene lookup into a helper to avoid loading each candidate twice and to preserve load errors for matching files:

```rust
fn find_scene_index_by_id(
    resources_dir: &std::path::Path,
    chapter: &ChapterManifest,
    scene_id: &str,
) -> Result<Option<usize>, GameError> {
    for (idx, scene_ref) in chapter.scenes.iter().enumerate() {
        let json = loader::load_scene(resources_dir, &scene_ref.file)?;
        let actual_type = scene_json_type(&json);
        if scene_ref.scene_type != actual_type {
            return Err(GameError::scene_validation_failed(format!(
                "{}: chapter manifest declares {} but scene JSON contains {}",
                scene_ref.file,
                scene_type_label(scene_ref.scene_type),
                scene_type_label(actual_type),
            )));
        }
        if scene_json_identity(&json).0 == scene_id {
            return Ok(Some(idx));
        }
    }
    Ok(None)
}
```

Use the helper in `jump_to_scene`:

```rust
let scene_idx = find_scene_index_by_id(
    &self.resources_dir,
    &self.chapters[chapter_idx],
    scene_id,
)?
.ok_or_else(|| GameError::unknown_scene(chapter_id, scene_id))?;
```

- [ ] **Step 4: Run focused scene-jump tests and verify they pass**

Run: `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml jump_to_scene --lib`

Expected: PASS for the four scene-jump tests.

- [ ] **Step 5: Run all Rust game unit tests**

Run: `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml game:: --lib`

Expected: PASS.

- [ ] **Step 6: Commit runtime jump work**

Run:

```bash
rtk git add apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/error.rs
rtk git commit -m "feat: jump to scenes from runtime"
```

Expected: commit succeeds with only runtime files staged.

---

### Task 3: Wire Tauri And Dev HTTP Commands

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/examples/dev_engine_server.rs`

- [ ] **Step 1: Add failing dev HTTP tests**

In `apps/game/src-tauri/examples/dev_engine_server.rs`, add this test inside `#[cfg(test)] mod tests`:

```rust
#[test]
fn scene_navigation_commands_dispatch_camel_case_args() {
    let state = empty_state();

    let err = dispatch(&state, "list_scenes", b"{}").unwrap_err();
    assert_ne!(err.code, "unknownCommand");

    let err = dispatch(
        &state,
        "jump_to_scene",
        br#"{"chapterId":"chapter_1","sceneId":"scene_0"}"#,
    )
    .unwrap_err();
    assert_eq!(err.code, "gameNotStarted");
}
```

- [ ] **Step 2: Run focused dev HTTP test and verify it fails**

Run: `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml --example dev_engine_server scene_navigation_commands_dispatch_camel_case_args`

Expected: FAIL because `list_scenes` returns `unknownCommand`.

- [ ] **Step 3: Register Tauri commands**

In `apps/game/src-tauri/src/lib.rs`, update the game imports:

```rust
use game::{GameEngine, GameError, GameStateView, QueueToken, SceneNavigationIndex};
```

Add the commands after `get_state`:

```rust
#[tauri::command]
fn list_scenes(app: tauri::AppHandle) -> Result<SceneNavigationIndex, GameError> {
    let resources_dir = app
        .path()
        .resolve("resources/scenes", BaseDirectory::Resource)
        .map_err(|e| GameError::scene_load_failed(format!("cannot resolve resources dir: {e}")))?;
    GameEngine::scene_navigation_index(resources_dir)
}

#[tauri::command]
fn jump_to_scene(
    state: tauri::State<'_, AppState>,
    chapter_id: String,
    scene_id: String,
) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.jump_to_scene(&chapter_id, &scene_id)
}
```

Add both commands to `tauri::generate_handler!`:

```rust
list_scenes,
jump_to_scene,
```

- [ ] **Step 4: Re-export scene navigation type**

In `apps/game/src-tauri/src/game/mod.rs`, update the public `view` re-export:

```rust
pub use view::{GameStateView, ModeView, QueueToken, SceneNavigationIndex};
```

- [ ] **Step 5: Wire dev HTTP fallback**

In `apps/game/src-tauri/examples/dev_engine_server.rs`, update imports:

```rust
use lyra_lib::game::{GameEngine, GameError, GameStateView, QueueToken, SceneNavigationIndex};
```

Add this helper after `with_engine`:

```rust
fn serialize_value<T: serde::Serialize>(v: T) -> Result<String, GameError> {
    serde_json::to_string(&v).map_err(|e| GameError::parse_failure(format!("serialize view: {e}")))
}
```

Change `serialize` to delegate:

```rust
fn serialize(v: GameStateView) -> Result<String, GameError> {
    serialize_value(v)
}
```

Add these dispatch arms before `advance_dialogue`:

```rust
"list_scenes" => {
    let index: SceneNavigationIndex = GameEngine::scene_navigation_index(resources_dir())?;
    serialize_value(index)
}
"jump_to_scene" => {
    #[derive(Deserialize)]
    struct Args {
        #[serde(rename = "chapterId")]
        chapter_id: String,
        #[serde(rename = "sceneId")]
        scene_id: String,
    }
    let args: Args = parse_body(body)?;
    with_engine(state, |e| e.jump_to_scene(&args.chapter_id, &args.scene_id))
}
```

Keep `list_scenes` independent of started game state. Keep `jump_to_scene` routed through `with_engine` so direct calls before `start_game` return the existing `gameNotStarted` error.

- [ ] **Step 6: Run command wiring tests**

Run: `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml --example dev_engine_server scene_navigation_commands_dispatch_camel_case_args`

Expected: PASS.

Run: `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib`

Expected: PASS.

- [ ] **Step 7: Commit command wiring**

Run:

```bash
rtk git add apps/game/src-tauri/src/lib.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/examples/dev_engine_server.rs
rtk git commit -m "feat: expose scene navigation commands"
```

Expected: commit succeeds with command wiring only.

---

### Task 4: Add Frontend Scene Types, Cleared Entitlement, And Client Commands

**Files:**
- Modify: `apps/game/src/lib/state/types.ts`
- Create: `apps/game/src/lib/state/story-clearance.ts`
- Create: `apps/game/src/lib/state/story-clearance.test.ts`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`

- [ ] **Step 1: Add frontend type contract**

In `apps/game/src/lib/state/types.ts`, add this after `SceneView`:

```ts
export type SceneNavigationIndex = {
  chapters: Array<{
    id: string;
    title: string;
    index: number;
    scenes: Array<{
      id: string;
      title: string;
      type: "linear" | "investigation" | "interrogation";
      index: number;
    }>;
  }>;
};
```

- [ ] **Step 2: Add failing cleared-entitlement tests**

Create `apps/game/src/lib/state/story-clearance.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STORY_CLEARED_STORAGE_KEY,
  browserStoryClearanceStorage,
  loadStoryClearedOnce,
  saveStoryClearedOnce,
} from "./story-clearance";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("story clearance entitlement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("defaults to false when storage is unavailable or empty", () => {
    expect(loadStoryClearedOnce(null)).toBe(false);
    expect(loadStoryClearedOnce(new MemoryStorage())).toBe(false);
  });

  it("loads only an explicit true value as cleared", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORY_CLEARED_STORAGE_KEY, "true");
    expect(loadStoryClearedOnce(storage)).toBe(true);

    storage.setItem(STORY_CLEARED_STORAGE_KEY, "false");
    expect(loadStoryClearedOnce(storage)).toBe(false);

    storage.setItem(STORY_CLEARED_STORAGE_KEY, "yes");
    expect(loadStoryClearedOnce(storage)).toBe(false);
  });

  it("persists the cleared flag", () => {
    const storage = new MemoryStorage();
    expect(saveStoryClearedOnce(storage)).toBe(true);
    expect(storage.getItem(STORY_CLEARED_STORAGE_KEY)).toBe("true");
  });

  it("warns and returns false when saving fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota denied");
      },
    };

    expect(saveStoryClearedOnce(failing)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[StoryClearance]"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be saved"),
    );
  });

  it("returns null when localStorage access throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });

    try {
      expect(browserStoryClearanceStorage()).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("[StoryClearance]"),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("localStorage unavailable"),
      );
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "localStorage", descriptor);
      }
    }
  });
});
```

- [ ] **Step 3: Run cleared-entitlement test and verify it fails**

Run: `rtk bun run --cwd apps/game test src/lib/state/story-clearance.test.ts`

Expected: FAIL because `./story-clearance` does not exist.

- [ ] **Step 4: Implement cleared-entitlement helper**

Create `apps/game/src/lib/state/story-clearance.ts`:

```ts
export const STORY_CLEARED_STORAGE_KEY = "lyra.storyClearedOnce.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

let storageUnavailableWarned = false;
let saveFailureWarned = false;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.name || error.message;
  return String(error);
}

export function browserStoryClearanceStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (error) {
    if (!storageUnavailableWarned) {
      storageUnavailableWarned = true;
      console.warn(
        `[StoryClearance] localStorage unavailable (${describeError(error)}); scene navigation unlock will not persist across relaunch`,
      );
    }
    return null;
  }
}

export function loadStoryClearedOnce(
  storage: StorageLike | null = browserStoryClearanceStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(STORY_CLEARED_STORAGE_KEY) === "true";
  } catch (error) {
    console.warn(
      `[StoryClearance] stored story-clearance flag could not be read (${describeError(error)}); scene navigation remains locked`,
    );
    return false;
  }
}

export function saveStoryClearedOnce(
  storage: StorageLike | null = browserStoryClearanceStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORY_CLEARED_STORAGE_KEY, "true");
    return true;
  } catch (error) {
    if (!saveFailureWarned) {
      saveFailureWarned = true;
      console.warn(
        `[StoryClearance] story-clearance flag could not be saved (${describeError(error)}); scene navigation unlock will not persist across relaunch`,
      );
    }
    return false;
  }
}
```

- [ ] **Step 5: Run cleared-entitlement tests**

Run: `rtk bun run --cwd apps/game test src/lib/state/story-clearance.test.ts`

Expected: PASS.

- [ ] **Step 6: Add failing game-client command tests**

Append these tests to `apps/game/src/lib/state/game-client-source.test.ts`:

```ts
describe("game client scene navigation commands", () => {
  it("requests the scene navigation index without SFX inference", async () => {
    const client = await loadGameClient(state("previous"));
    const index = {
      chapters: [
        {
          id: "chapter_1",
          title: "Chapter 1",
          index: 0,
          scenes: [
            {
              id: "scene_0",
              title: "Opening",
              type: "linear" as const,
              index: 0,
            },
          ],
        },
      ],
    };
    mocks.invoke.mockResolvedValueOnce(index);

    await expect(client.listScenes()).resolves.toEqual(index);

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("list_scenes", undefined);
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();
  });

  it("jumps to a scene without SFX inference", async () => {
    const previous = state("previous");
    const next = state("jumped");
    const client = await loadGameClient(previous);
    mocks.invoke.mockResolvedValueOnce(next);

    await client.jumpToScene("chapter_1", "scene_0");

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("jump_to_scene", {
      chapterId: "chapter_1",
      sceneId: "scene_0",
    });
    expect(client.gameState.value).toBe(next);
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();
  });

  it("does not mutate state when scene jump fails", async () => {
    const previous = state("previous");
    const client = await loadGameClient(previous);
    mocks.invoke.mockRejectedValueOnce({
      code: "unknownScene",
      message: "Scene missing.",
    });

    await client.jumpToScene("chapter_1", "missing");

    expect(client.gameState.value).toBe(previous);
    expect(client.gameState.error).toBe("Scene missing.");
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run focused game-client tests and verify they fail**

Run: `rtk bun run --cwd apps/game test src/lib/state/game-client-source.test.ts -t "scene navigation commands"`

Expected: FAIL because `listScenes` and `jumpToScene` are not exported.

- [ ] **Step 8: Implement frontend client wrappers**

In `apps/game/src/lib/state/game-client.svelte.ts`, update the types import:

```ts
import type {
  GameError,
  GameStateView,
  QueueToken,
  SceneNavigationIndex,
} from "./types";
```

Add a non-SFX state command helper after `dispatchGameCommand`:

```ts
async function dispatchStateCommand(
  command: string,
  args?: Record<string, unknown>,
  loading = false,
) {
  if (gameState.inFlight) return null;
  gameState.inFlight = true;
  if (loading) gameState.loading = true;
  try {
    const v = await runCommand<GameStateView>(command, args);
    if (v) {
      gameState.value = v;
    }
    return v;
  } finally {
    if (loading) gameState.loading = false;
    gameState.inFlight = false;
  }
}
```

Add exported wrappers:

```ts
export async function listScenes(): Promise<SceneNavigationIndex | null> {
  return await runCommand<SceneNavigationIndex>("list_scenes");
}

export async function jumpToScene(chapterId: string, sceneId: string) {
  await dispatchStateCommand("jump_to_scene", { chapterId, sceneId }, true);
}
```

- [ ] **Step 9: Run frontend state tests**

Run: `rtk bun run --cwd apps/game test src/lib/state/story-clearance.test.ts src/lib/state/game-client-source.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit frontend state/client work**

Run:

```bash
rtk git add apps/game/src/lib/state/types.ts apps/game/src/lib/state/story-clearance.ts apps/game/src/lib/state/story-clearance.test.ts apps/game/src/lib/state/game-client.svelte.ts apps/game/src/lib/state/game-client-source.test.ts
rtk git commit -m "feat: add scene navigation client state"
```

Expected: commit succeeds with state/client files only.

---

### Task 5: Add Scene Navigation Panel Component

**Files:**
- Create: `apps/game/src/lib/components/SceneNavigationPanel.svelte`
- Create: `apps/game/src/lib/components/SceneNavigationPanel.test.ts`

- [ ] **Step 1: Add failing component tests**

Create `apps/game/src/lib/components/SceneNavigationPanel.test.ts`:

```ts
import { cleanup, render, screen, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameStateView, SceneNavigationIndex } from "$lib/state/types";
import SceneNavigationPanel from "./SceneNavigationPanel.svelte";

const index: SceneNavigationIndex = {
  chapters: [
    {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      index: 0,
      scenes: [
        { id: "scene_0", title: "序章", type: "linear", index: 0 },
        {
          id: "investigation_scene_1",
          title: "咖啡館調查",
          type: "investigation",
          index: 1,
        },
      ],
    },
    {
      id: "chapter_2",
      title: "第二份證詞",
      index: 1,
      scenes: [
        {
          id: "interrogation_scene_0",
          title: "詢問",
          type: "interrogation",
          index: 0,
        },
      ],
    },
  ],
};

function currentState(): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      summary: "案件摘要",
      index: 0,
      total: 2,
    },
    scene: {
      kind: "investigation",
      id: "investigation_scene_1",
      title: "咖啡館調查",
      index: 1,
      total: 2,
      currentSublocationId: "main",
      visibleSublocations: [],
    },
    mode: {
      type: "explore",
      sublocationId: "main",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
  };
}

describe("SceneNavigationPanel", () => {
  afterEach(cleanup);

  it("lists scenes for the current chapter and marks the current scene", () => {
    render(SceneNavigationPanel, {
      index,
      current: currentState(),
      disabled: false,
      onSelect: vi.fn(),
    });

    expect(screen.getByRole("button", { name: /雨夜的第一份證詞/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /序章/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /咖啡館調查/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("switches chapters and emits selected chapter and scene ids", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(SceneNavigationPanel, {
      index,
      current: currentState(),
      disabled: false,
      onSelect,
    });

    await user.click(screen.getByRole("button", { name: /第二份證詞/ }));
    const sceneList = screen.getByRole("list", { name: "場景列表" });
    await user.click(within(sceneList).getByRole("button", { name: /詢問/ }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(
      "chapter_2",
      "interrogation_scene_0",
    );
  });

  it("shows loading and empty states", () => {
    const { rerender } = render(SceneNavigationPanel, {
      index: null,
      current: currentState(),
      loading: true,
      disabled: false,
      onSelect: vi.fn(),
    });
    expect(screen.getByText("場景索引載入中...")).toBeInTheDocument();

    rerender({
      index: { chapters: [] },
      current: currentState(),
      loading: false,
      disabled: false,
      onSelect: vi.fn(),
    });
    expect(screen.getByText("沒有可用場景。")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run component test and verify it fails**

Run: `rtk bun run --cwd apps/game test src/lib/components/SceneNavigationPanel.test.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `SceneNavigationPanel.svelte`**

Create `apps/game/src/lib/components/SceneNavigationPanel.svelte`:

```svelte
<script lang="ts">
  import type { GameStateView, SceneNavigationIndex } from "$lib/state/types";

  let {
    index,
    current,
    loading = false,
    disabled = false,
    onSelect,
  }: {
    index: SceneNavigationIndex | null;
    current: GameStateView;
    loading?: boolean;
    disabled?: boolean;
    onSelect: (chapterId: string, sceneId: string) => void;
  } = $props();

  let selectedChapterId = $state<string | null>(current.chapter.id);

  let selectedChapter = $derived(
    index?.chapters.find((chapter) => chapter.id === selectedChapterId) ??
      index?.chapters.find((chapter) => chapter.id === current.chapter.id) ??
      index?.chapters[0] ??
      null,
  );

  $effect(() => {
    if (!selectedChapterId && current.mode.type !== "gameComplete") {
      selectedChapterId = current.chapter.id;
    }
    if (
      index &&
      selectedChapterId &&
      !index.chapters.some((chapter) => chapter.id === selectedChapterId)
    ) {
      selectedChapterId = index.chapters[0]?.id ?? null;
    }
  });

  function sceneTypeLabel(type: "linear" | "investigation" | "interrogation") {
    if (type === "investigation") return "調查";
    if (type === "interrogation") return "詰問";
    return "對話";
  }
</script>

<section class="scene-navigation-panel" aria-label="場景跳轉">
  {#if loading}
    <p class="empty">場景索引載入中...</p>
  {:else if !index || index.chapters.length === 0}
    <p class="empty">沒有可用場景。</p>
  {:else}
    <div class="chapter-tabs" role="list" aria-label="章節列表">
      {#each index.chapters as chapter (chapter.id)}
        <button
          type="button"
          class:selected={selectedChapter?.id === chapter.id}
          aria-pressed={selectedChapter?.id === chapter.id}
          onclick={() => (selectedChapterId = chapter.id)}
        >
          <span>{String(chapter.index + 1).padStart(2, "0")}</span>
          <strong>{chapter.title}</strong>
        </button>
      {/each}
    </div>

    {#if selectedChapter}
      <ul class="scene-list" aria-label="場景列表">
        {#each selectedChapter.scenes as scene (scene.id)}
          {@const isCurrent =
            selectedChapter.id === current.chapter.id && scene.id === current.scene.id}
          <li>
            <button
              type="button"
              disabled={disabled}
              aria-current={isCurrent ? "true" : undefined}
              onclick={() => onSelect(selectedChapter.id, scene.id)}
            >
              <span class="num">{String(scene.index + 1).padStart(2, "0")}</span>
              <span class="copy">
                <strong>{scene.title}</strong>
                <small>{sceneTypeLabel(scene.type)} · {scene.id}</small>
              </span>
              {#if isCurrent}
                <span class="current">目前</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .scene-navigation-panel {
    display: grid;
    gap: 12px;
  }

  .chapter-tabs {
    display: grid;
    gap: 8px;
  }

  .chapter-tabs button,
  .scene-list button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid var(--rule-strong);
    background: rgba(236, 228, 207, 0.04);
    color: var(--bone);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .chapter-tabs button.selected,
  .chapter-tabs button:hover,
  .scene-list button:hover:not(:disabled),
  .scene-list button[aria-current="true"] {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .chapter-tabs span,
  .num,
  .current {
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--cyan);
  }

  .chapter-tabs strong,
  .copy strong {
    overflow-wrap: anywhere;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.06em;
  }

  .scene-list {
    display: grid;
    gap: 8px;
    max-height: min(38vh, 320px);
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .copy {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .copy small,
  .empty {
    color: var(--bone-dim);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.12em;
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
</style>
```

- [ ] **Step 4: Run component test**

Run: `rtk bun run --cwd apps/game test src/lib/components/SceneNavigationPanel.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit scene navigation panel**

Run:

```bash
rtk git add apps/game/src/lib/components/SceneNavigationPanel.svelte apps/game/src/lib/components/SceneNavigationPanel.test.ts
rtk git commit -m "feat: add scene navigation panel"
```

Expected: commit succeeds with the new component and tests.

---

### Task 6: Restructure GameShell Into Separate Submenus

**Files:**
- Modify: `apps/game/src/lib/components/GameShell.svelte`
- Modify: `apps/game/src/lib/components/GameShellHarness.svelte`
- Modify: `apps/game/src/lib/components/GameShell.test.ts`

- [ ] **Step 1: Update harness to pass scene-menu content**

In `apps/game/src/lib/components/GameShellHarness.svelte`, add `sceneMenuEnabled` and `sceneMenuContent` props:

```ts
sceneMenuEnabled = false,
sceneMenuContent = null,
```

Add them to the prop type:

```ts
sceneMenuEnabled?: boolean;
sceneMenuContent?: string | null;
```

Pass a new snippet to `GameShell`:

```svelte
  {#snippet sceneMenu()}
    {#if sceneMenuContent}
      <button type="button" class="harness-scene-menu-button">
        {sceneMenuContent}
      </button>
    {/if}
  {/snippet}
```

The `GameShell` invocation should become:

```svelte
<GameShell {gameState} {onReset} {disabled} {sceneMenuEnabled} bind:open>
  {#snippet sceneMenu()}
    {#if sceneMenuContent}
      <button type="button" class="harness-scene-menu-button">
        {sceneMenuContent}
      </button>
    {/if}
  {/snippet}

  {#snippet menu()}
    {#if menuContent}
      <p>{menuContent}</p>
    {/if}
    {#if menuExtraButtonLabel}
      <button type="button" class="harness-extra-menu-button">
        {menuExtraButtonLabel}
      </button>
    {/if}
  {/snippet}

  <p class="shell-content">scoped child</p>
</GameShell>
```

- [ ] **Step 2: Replace old menu/audio test with failing submenu tests**

In `apps/game/src/lib/components/GameShell.test.ts`, replace the test named `"renders close-case and audio controls inside the game menu"` with:

```ts
it("renders evidence and sound behind separate menu buttons", async () => {
  const testName = "renders evidence and sound behind separate menu buttons";

  try {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(GameShellHarness, {
      gameState: state(),
      onReset,
      menuContent: "menu inventory slot",
    });

    await user.keyboard("{Escape}");
    const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });

    expect(
      within(dialog).getByRole("button", { name: /物證檔案/ }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /音訊設定/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "音訊設定" })).toBeNull();
    expect(screen.queryByText("menu inventory slot")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: /物證檔案/ }));
    expect(within(dialog).getByText("menu inventory slot")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "音訊設定" })).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: /音訊設定/ }));
    expect(within(dialog).getByRole("region", { name: "音訊設定" })).toBeInTheDocument();
    expect(screen.queryByText("menu inventory slot")).toBeNull();

    await user.click(
      within(dialog).getByRole("button", { name: /結束案件/ }),
    );
    expect(onReset).toHaveBeenCalledTimes(1);
  } catch (error) {
    reportAsyncTestFailure(testName, error);
  }
});

it("renders scene select only when scene menu content is provided", async () => {
  const testName = "renders scene select only when scene menu content is provided";

  try {
    const user = userEvent.setup();
    const { rerender } = render(GameShellHarness, {
      gameState: state(),
      onReset: vi.fn(),
    });

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: /場景跳轉/ })).toBeNull();

    await user.keyboard("{Escape}");
    rerender({
      gameState: state(),
      onReset: vi.fn(),
      sceneMenuEnabled: true,
      sceneMenuContent: "scene selector slot",
    });
    await user.keyboard("{Escape}");
    const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(within(dialog).getByRole("button", { name: /場景跳轉/ }));

    expect(within(dialog).getByText("scene selector slot")).toBeInTheDocument();
  } catch (error) {
    reportAsyncTestFailure(testName, error);
  }
});
```

Update the focus-trap test setup to include a scene submenu focusable and open the evidence submenu before tab traversal:

```ts
render(GameShellHarness, {
  gameState: state(),
  onReset: vi.fn(),
  menuExtraButtonLabel: "extra slot focusable",
  sceneMenuEnabled: true,
  sceneMenuContent: "scene slot focusable",
});
```

Then, after finding the dialog, click the Evidence button before querying the extra focusable:

```ts
await user.click(within(dialog).getByRole("button", { name: /物證檔案/ }));
```

Change `const sfx = screen.getByLabelText("SFX");` to open the sound submenu before checking reverse focus boundary:

```ts
await user.click(within(dialog).getByRole("button", { name: /音訊設定/ }));
const sfx = within(dialog).getByLabelText("SFX");
```

- [ ] **Step 3: Run GameShell tests and verify they fail**

Run: `rtk bun run --cwd apps/game test src/lib/components/GameShell.test.ts`

Expected: FAIL because `sceneMenu` prop and submenu buttons are not implemented.

- [ ] **Step 4: Implement submenu props and state in GameShell**

In `apps/game/src/lib/components/GameShell.svelte`, add `sceneMenuEnabled` and `sceneMenu` to destructured props:

```ts
sceneMenuEnabled = false,
sceneMenu,
```

Add the types:

```ts
sceneMenuEnabled?: boolean;
sceneMenu?: Snippet;
```

Add submenu state:

```ts
type MenuPanel = "scene" | "evidence" | "sound" | null;
let activeMenuPanel = $state<MenuPanel>(null);
```

Reset submenu state when opening/closing/resetting:

```ts
async function openGameMenu() {
  if (!open) {
    const activeElement = document.activeElement;
    previouslyFocusedElement =
      activeElement instanceof HTMLElement ? activeElement : null;
    activeMenuPanel = null;
    open = true;
    await tick();
    resumeButton?.focus();
  }
}

function closeGameMenu() {
  if (!open) {
    return;
  }

  activeMenuPanel = null;
  open = false;
  const elementToRestore = previouslyFocusedElement;
  previouslyFocusedElement = null;

  void tick().then(() => {
    if (elementToRestore?.isConnected) {
      elementToRestore.focus();
    }
  });
}
```

Add a helper:

```ts
function toggleMenuPanel(panel: Exclude<MenuPanel, null>) {
  activeMenuPanel = activeMenuPanel === panel ? null : panel;
}
```

- [ ] **Step 5: Replace menu body markup**

Replace the current menu actions / menu extra / `AudioSettings` block with:

```svelte
<div class="game-menu-actions">
  <button
    bind:this={resumeButton}
    type="button"
    class="primary"
    onclick={closeGameMenu}
  >
    <span>繼續調查</span>
    <span class="en">RESUME</span>
  </button>

  {#if sceneMenuEnabled && sceneMenu}
    <button
      type="button"
      class:active={activeMenuPanel === "scene"}
      aria-expanded={activeMenuPanel === "scene"}
      onclick={() => toggleMenuPanel("scene")}
    >
      <span>場景跳轉</span>
      <span class="en">SCENE&nbsp;SELECT</span>
    </button>
  {/if}

  {#if menu}
    <button
      type="button"
      class:active={activeMenuPanel === "evidence"}
      aria-expanded={activeMenuPanel === "evidence"}
      onclick={() => toggleMenuPanel("evidence")}
    >
      <span>物證檔案</span>
      <span class="en">EVIDENCE</span>
    </button>
  {/if}

  <button
    type="button"
    class:active={activeMenuPanel === "sound"}
    aria-expanded={activeMenuPanel === "sound"}
    onclick={() => toggleMenuPanel("sound")}
  >
    <span>音訊設定</span>
    <span class="en">SOUND</span>
  </button>

  <button type="button" onclick={handleMenuReset} {disabled}>
    <span>結束案件</span>
    <span class="en">CLOSE&nbsp;CASE</span>
  </button>
</div>

{#if activeMenuPanel}
  <div class="game-menu-extra">
    {#if activeMenuPanel === "scene" && sceneMenuEnabled && sceneMenu}
      {@render sceneMenu()}
    {:else if activeMenuPanel === "evidence" && menu}
      {@render menu()}
    {:else if activeMenuPanel === "sound"}
      <AudioSettings
        preferences={audioPreferences}
        onUpdate={updateAudioPreferences}
      />
    {/if}
  </div>
{/if}
```

Update CSS so active submenu buttons style like focused buttons:

```css
.game-menu-actions button.primary,
.game-menu-actions button.active,
.game-menu-actions button:hover:not(:disabled),
.game-menu-actions button:focus-visible {
  border-color: var(--crimson);
  background: var(--crimson-soft);
  color: var(--bone);
}
```

- [ ] **Step 6: Run GameShell tests**

Run: `rtk bun run --cwd apps/game test src/lib/components/GameShell.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit GameShell submenu work**

Run:

```bash
rtk git add apps/game/src/lib/components/GameShell.svelte apps/game/src/lib/components/GameShellHarness.svelte apps/game/src/lib/components/GameShell.test.ts
rtk git commit -m "feat: split game menu submenus"
```

Expected: commit succeeds with GameShell-related files only.

---

### Task 7: Wire Scene Navigation Into The Page

**Files:**
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/routes/page-source.test.ts`

- [ ] **Step 1: Add failing source-level wiring tests**

Append these tests to `apps/game/src/routes/page-source.test.ts`:

```ts
describe("+page scene navigation wiring", () => {
  it("passes scene navigation through the GameShell sceneMenu snippet", () => {
    const source = pageSource();

    expect(source).toContain("{#snippet sceneMenu()}");
    expect(source).toContain("<SceneNavigationPanel");
    expect(source).toContain("sceneMenuEnabled={sceneNavigationEnabled}");
    expect(source).toContain("sceneNavigationEnabled");
    expect(source).toContain("handleJumpToScene");
  });

  it("marks story cleared when gameComplete is observed", () => {
    const source = pageSource();

    expect(source).toContain("saveStoryClearedOnce()");
    expect(source).toContain('gameState.value?.mode.type === "gameComplete"');
  });

  it("closes the menu after scene jump resolves", () => {
    const source = pageSource();

    expect(source).toContain("await jumpToScene(chapterId, sceneId)");
    expect(source).toContain("gameMenuOpen = false");
  });
});
```

- [ ] **Step 2: Run page source tests and verify they fail**

Run: `rtk bun run --cwd apps/game test src/routes/page-source.test.ts -t "scene navigation wiring"`

Expected: FAIL because the page has no scene-navigation wiring.

- [ ] **Step 3: Add imports and page state**

In `apps/game/src/routes/+page.svelte`, extend the game-client import:

```ts
jumpToScene,
listScenes,
```

Add imports:

```ts
import SceneNavigationPanel from "$lib/components/SceneNavigationPanel.svelte";
import type { SceneNavigationIndex } from "$lib/state/types";
import {
  loadStoryClearedOnce,
  saveStoryClearedOnce,
} from "$lib/state/story-clearance";
```

Add state after `gameMenuOpen`:

```ts
let storyClearedOnce = $state(loadStoryClearedOnce());
let sceneNavigationIndex = $state<SceneNavigationIndex | null>(null);
let sceneNavigationLoading = $state(false);
let sceneNavigationRequested = $state(false);
let sceneNavigationEnabled = $derived(
  import.meta.env.DEV || storyClearedOnce,
);
```

- [ ] **Step 4: Add effects and handlers**

Add these functions/effects before `handleReset`:

```ts
$effect(() => {
  if (gameState.value?.mode.type === "gameComplete" && !storyClearedOnce) {
    storyClearedOnce = true;
    saveStoryClearedOnce();
  }
});

$effect(() => {
  if (
    sceneNavigationEnabled &&
    gameState.value &&
    !sceneNavigationIndex &&
    !sceneNavigationLoading &&
    !sceneNavigationRequested
  ) {
    sceneNavigationRequested = true;
    void loadSceneNavigationIndex();
  }
});

async function loadSceneNavigationIndex() {
  sceneNavigationLoading = true;
  const index = await listScenes();
  if (index) {
    sceneNavigationIndex = index;
  }
  sceneNavigationLoading = false;
}
```

Add this handler after dossier reexamine handlers:

```ts
async function handleJumpToScene(chapterId: string, sceneId: string) {
  await jumpToScene(chapterId, sceneId);
  gameMenuOpen = false;
}
```

- [ ] **Step 5: Pass scene menu snippet to GameShell**

Add the `sceneMenuEnabled` prop to the existing `GameShell` invocation:

```svelte
<GameShell
  gameState={gameState.value}
  onReset={handleReset}
  disabled={gameState.inFlight}
  sceneMenuEnabled={sceneNavigationEnabled}
  bind:open={gameMenuOpen}
>
```

Inside `<GameShell ...>`, add this snippet before the existing `{#snippet menu()}`:

```svelte
{#snippet sceneMenu()}
  <SceneNavigationPanel
    index={sceneNavigationIndex}
    current={gameState.value!}
    loading={sceneNavigationLoading}
    disabled={gameState.inFlight}
    onSelect={handleJumpToScene}
  />
{/snippet}
```

- [ ] **Step 6: Run page source tests**

Run: `rtk bun run --cwd apps/game test src/routes/page-source.test.ts -t "scene navigation wiring"`

Expected: PASS.

- [ ] **Step 7: Run focused page/component tests**

Run:

```bash
rtk bun run --cwd apps/game test src/routes/page-source.test.ts src/lib/components/GameShell.test.ts src/lib/components/SceneNavigationPanel.test.ts src/lib/state/game-client-source.test.ts src/lib/state/story-clearance.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit page wiring**

Run:

```bash
rtk git add apps/game/src/routes/+page.svelte apps/game/src/routes/page-source.test.ts
rtk git commit -m "feat: wire scene navigation menu"
```

Expected: commit succeeds with page wiring files only.

---

### Task 8: Final Verification And Cleanup

**Files:**
- No planned source changes unless verification reveals a defect.

- [ ] **Step 1: Run frontend test suite**

Run: `rtk bun run --cwd apps/game test`

Expected: PASS.

- [ ] **Step 2: Run frontend type check**

Run: `rtk bun run --cwd apps/game check`

Expected: PASS.

- [ ] **Step 3: Run Rust tests**

Run: `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 4: Run repo frontend check if app check changed shared types**

Run: `rtk bun run check`

Expected: PASS.

- [ ] **Step 5: Inspect worktree**

Run: `rtk git status --short`

Expected: clean worktree after the task commits, or only intentional uncommitted verification artifacts. Generated resources, coverage, Playwright reports, and local settings should not be staged.

- [ ] **Step 6: Commit verification fixes when verification changed files**

When Steps 1-4 required a source or test fix, run `rtk git status --short`,
stage the exact files shown as modified for that fix, and commit them with:

```bash
rtk git commit -m "fix: complete scene navigation verification"
```

Expected: commit succeeds only when verification produced concrete source or
test changes. When Steps 1-4 pass without new changes, leave this step checked
with the note "no verification fixes needed."

---

## Implementation Notes

- Keep `jump_to_scene` a clean fresh-start operation. Do not preserve inventory, inspected hotspots, discussed topics, answered questions, completed phases, or carried audio cue state.
- Keep the product entitlement in Svelte. The Rust command is a neutral runtime capability.
- Do not add title-screen scene navigation in this plan.
- Do not edit generated resources under `apps/game/src-tauri/resources/scenes/`.
- If `scene_navigation_index_from_chapters` and `load_scene_runtime` share manifest type validation, prefer one helper so future scene-type additions do not drift.
- If `GameShell.svelte` grows awkward after submenu work, create a local helper component only for menu action rows. Do not refactor unrelated shell behavior.
