// src-tauri/src/game/navigation.rs
//
// Chapter/scene loading and the navigation paths that move between scenes.

use super::acquisition::AcquisitionCtx;
use super::loader;
use super::scenes::interrogation::InterrogationSceneState;
use super::scenes::investigation::InvestigationSceneState;
use super::scenes::linear::LinearSceneState;
use super::scenes::SceneRuntime;
use super::schema::{DialogueItem, SceneJson, SceneType};
use super::state::{ChapterManifest, Inventory, SceneRef};
use super::view::{
    GameStateView, SceneNavigationChapter, SceneNavigationIndex, SceneNavigationScene,
};
use super::{GameEngine, GameError, LastVisualCue};

impl GameEngine {
    pub(super) fn jump_to_scene_inner(
        &mut self,
        chapter_id: &str,
        scene_id: &str,
    ) -> Result<GameStateView, GameError> {
        // Defense-in-depth: load_chapter_manifests rejects duplicate chapter
        // ids at load time, but resolve the jump target unambiguously here too
        // so a jump never silently lands on the "first" of two same-id
        // chapters (e.g. if chapters are injected directly in tests or this
        // helper is reused outside the gated load flow). Scan the whole list;
        // if more than one chapter carries the requested id, surface a typed
        // error rather than picking one arbitrarily. Mirrors the duplicate-scene
        // guard in find_scene_runtime_by_id.
        let mut chapter_idx: Option<usize> = None;
        for (idx, chapter) in self.chapters.iter().enumerate() {
            if chapter.id == chapter_id {
                if chapter_idx.is_some() {
                    return Err(GameError::duplicate_chapter_target(chapter_id));
                }
                chapter_idx = Some(idx);
            }
        }
        let chapter_idx = chapter_idx.ok_or_else(|| GameError::unknown_chapter(chapter_id))?;
        let queue_gen = self.next_queue_gen;
        let (scene_idx, new_scene) = find_scene_runtime_by_id(
            &self.resources_dir,
            &self.chapters[chapter_idx],
            scene_id,
            queue_gen,
        )?
        .ok_or_else(|| GameError::unknown_scene(chapter_id, scene_id))?;

        self.command_tx(move |engine| {
            engine.current_chapter_idx = chapter_idx;
            engine.current_scene_idx = scene_idx;
            engine.scene = new_scene;
            engine.last_visual_cue = LastVisualCue::default();
            engine.inventory = Inventory::default();
            engine.next_queue_gen = queue_gen + 1;
            engine.history.reset();

            engine.prime_initial_queue()?;
            // Developer convenience: jumping straight into an interrogation via
            // scene-navigation skips the investigation where its contradiction
            // evidence is normally collected. Grant everything so every
            // testimony is presentable for testing. Gated to debug builds
            // (`cfg!(debug_assertions)`) because Scene Select is also exposed
            // in production replay after `storyClearedOnce`; releasing the full
            // inventory there would spoil every scene's evidence and bypass
            // the intended inventory gating.
            if cfg!(debug_assertions) && matches!(engine.scene, SceneRuntime::Interrogation(_)) {
                engine.grant_all_evidence_for_testing();
            }
            Ok(())
        })
    }

    /// Grants every evidence and statement defined across all scenes so that
    /// any interrogation contradiction can be presented. Testing-only, reached
    /// solely from [`Self::jump_to_scene`] into an interrogation scene and only
    /// in debug builds (`cfg!(debug_assertions)`). Scenes that fail to load are
    /// skipped — this is a best-effort convenience, not a correctness path, so
    /// a single bad scene must not abort the grant.
    pub(super) fn grant_all_evidence_for_testing(&mut self) {
        let chapters = self.chapters.clone();
        for chapter in &chapters {
            for scene_ref in &chapter.scenes {
                let Ok(scene) = loader::load_scene(&self.resources_dir, &scene_ref.file) else {
                    continue;
                };
                let (scene_id, _) = scene_json_identity(&scene);
                let scene_id = scene_id.to_string();
                let (evidence, statements) = match &scene {
                    SceneJson::Investigation(inv) => {
                        (&inv.evidence_manifest, &inv.statement_manifest)
                    }
                    SceneJson::Interrogation(intr) => {
                        (&intr.evidence_manifest, &intr.statement_manifest)
                    }
                    SceneJson::Linear(_) => continue,
                };
                let mut acq = AcquisitionCtx {
                    inventory: &mut self.inventory,
                };
                for def in evidence {
                    acq.evidence(def, &chapter.id, &scene_id);
                }
                for def in statements {
                    acq.statement(def, &chapter.id, &scene_id);
                }
            }
        }
    }

    /// Scene-entry sequencing. Installs the new scene's opening queue via the
    /// primitives in `dialogue.rs`; it lives here because its three callers
    /// (`new_started`, `jump_to_scene`, `advance_scene`) are all navigation
    /// paths.
    pub(super) fn prime_initial_queue(&mut self) -> Result<(), GameError> {
        let mut intro_queue = None;
        let mut needs_interrogation_advance = false;
        let needs_initial_sub = match &mut self.scene {
            SceneRuntime::Linear(s) => {
                // Consume leading SceneTag items so the first visible frame
                // has the correct backdrop tag.
                while let Some(DialogueItem::SceneTag { text, asset_cue }) =
                    s.queue.get(s.cursor).cloned()
                {
                    self.last_visual_cue.set_scene_tag(text, asset_cue);
                    s.cursor += 1;
                }
                // If the entire scene is tag-only (or empty), advance to the
                // next scene so we don't stall on GameComplete.
                if s.cursor >= s.queue.len() {
                    self.advance_scene()?;
                    return Ok(());
                }
                false
            }
            SceneRuntime::Investigation(inv) => {
                if !inv.intro_played && !inv.def.intro.is_empty() {
                    intro_queue = Some((inv.def.intro.clone(), inv.intro_queue_gen));
                    inv.intro_played = true;
                    false
                } else {
                    true
                }
            }
            SceneRuntime::Interrogation(scene) => {
                if !scene.intro_played && !scene.def.intro.is_empty() {
                    intro_queue = Some((scene.def.intro.clone(), scene.intro_queue_gen));
                    scene.intro_played = true;
                    false
                } else {
                    // Empty or already-played intros are considered consumed;
                    // the phase machine can advance immediately.
                    scene.intro_played = true;
                    needs_interrogation_advance = true;
                    false
                }
            }
        };
        if let Some((items, queue_gen)) = intro_queue {
            self.install_scene_queue(items, queue_gen, None)?;
        }
        if needs_initial_sub {
            self.advance_into_first_sublocation()?;
        }
        if needs_interrogation_advance && self.try_advance_interrogation()? {
            self.advance_scene()?;
        }
        Ok(())
    }

    pub(super) fn advance_scene(&mut self) -> Result<(), GameError> {
        let mut next_chapter_idx = self.current_chapter_idx;
        let mut next_scene_idx = self.current_scene_idx + 1;
        let chapter = &self.chapters[next_chapter_idx];
        if next_scene_idx >= chapter.scenes.len() {
            next_chapter_idx += 1;
            next_scene_idx = 0;
            if next_chapter_idx >= self.chapters.len() {
                self.current_chapter_idx = next_chapter_idx;
                self.current_scene_idx = next_scene_idx;
                return Ok(());
            }
        }
        let queue_gen = self.next_queue_gen;
        let scene_ref = self.chapters[next_chapter_idx]
            .scenes
            .get(next_scene_idx)
            .ok_or_else(|| GameError::chapter_load_failed("scene index out of bounds".into()))?
            .clone();
        let new_scene = load_scene_runtime(&self.resources_dir, &scene_ref, queue_gen)?;

        self.rollback_scope(|engine| {
            engine.current_chapter_idx = next_chapter_idx;
            engine.current_scene_idx = next_scene_idx;
            engine.scene = new_scene;
            engine.last_visual_cue.reset_for_new_scene();
            engine.next_queue_gen += 1;
            engine.prime_initial_queue()
        })
    }
}

pub(super) fn load_chapter_manifests(
    resources_dir: &std::path::Path,
) -> Result<Vec<ChapterManifest>, GameError> {
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

    // Enforce chapter-ID uniqueness at load time. jump_to_scene resolves
    // chapters by id (first match wins via `position`), so duplicate ids would
    // silently target the wrong chapter. The navigation-index build also
    // rejects duplicates, but that is a separate command (list_scenes) and
    // does not gate jump_to_scene — rejecting here ensures the engine never
    // holds duplicate chapters regardless of which command the frontend calls.
    let mut seen_chapter_ids = std::collections::HashSet::new();
    for chapter in &chapters {
        if !seen_chapter_ids.insert(chapter.id.as_str()) {
            return Err(GameError::chapter_load_failed(format!(
                "duplicate chapter id \"{}\" — chapter ids must be unique for scene navigation.",
                chapter.id
            )));
        }
    }

    Ok(chapters)
}

pub(super) fn scene_navigation_index_from_chapters(
    resources_dir: &std::path::Path,
    chapters: &[ChapterManifest],
) -> Result<SceneNavigationIndex, GameError> {
    let mut chapter_views = Vec::with_capacity(chapters.len());
    let mut seen_chapter_ids = std::collections::HashSet::new();

    for (chapter_index, chapter) in chapters.iter().enumerate() {
        // jump_to_scene resolves chapters/scenes by id, so duplicate ids would
        // target the wrong entry. load_chapter_manifests already rejects
        // duplicates at load time and jump_to_scene_inner scans for multiple
        // matches as defense-in-depth; this check keeps the navigation menu
        // itself unambiguous as a third layer.
        if !seen_chapter_ids.insert(chapter.id.as_str()) {
            return Err(GameError::chapter_load_failed(format!(
                "duplicate chapter id \"{}\" — chapter ids must be unique for scene navigation.",
                chapter.id
            )));
        }

        let mut scenes = Vec::with_capacity(chapter.scenes.len());
        let mut seen_scene_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        for (scene_index, scene_ref) in chapter.scenes.iter().enumerate() {
            let json = load_scene_json_for_ref(resources_dir, scene_ref)?;
            let actual_type = scene_json_type(&json);
            let (id, title) = scene_json_identity(&json);
            let id = id.to_string();
            if !seen_scene_ids.insert(id.clone()) {
                return Err(GameError::chapter_load_failed(format!(
                    "duplicate scene id \"{}\" in chapter \"{}\" — scene ids must be unique within a chapter for scene navigation.",
                    id, chapter.id
                )));
            }
            scenes.push(SceneNavigationScene {
                id,
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

fn find_scene_runtime_by_id(
    resources_dir: &std::path::Path,
    chapter: &ChapterManifest,
    scene_id: &str,
    queue_gen: u64,
) -> Result<Option<(usize, SceneRuntime)>, GameError> {
    // Defense-in-depth: the navigation index build rejects duplicate scene
    // ids per chapter, but resolve the jump target unambiguously here too so a
    // jump never silently lands on the "first" of two same-id scenes (e.g. if
    // resource files drift after the index was built, or this helper is reused
    // outside the gated navigation flow). Scan the whole chapter; if more than
    // one scene file carries the requested id, surface a typed error rather
    // than picking one arbitrarily. The extra JSON loads are negligible for an
    // infrequent, user-driven jump.
    let mut found: Option<(usize, SceneJson)> = None;
    for (idx, scene_ref) in chapter.scenes.iter().enumerate() {
        let json = load_scene_json_for_ref(resources_dir, scene_ref)?;
        if scene_json_identity(&json).0 == scene_id {
            if found.is_some() {
                return Err(GameError::duplicate_scene_target(&chapter.id, scene_id));
            }
            found = Some((idx, json));
        }
    }
    Ok(found.map(|(idx, json)| (idx, scene_runtime_from_json(json, queue_gen))))
}

pub(super) fn load_scene_runtime(
    resources_dir: &std::path::Path,
    scene_ref: &SceneRef,
    queue_gen: u64,
) -> Result<SceneRuntime, GameError> {
    let json = load_scene_json_for_ref(resources_dir, scene_ref)?;
    Ok(scene_runtime_from_json(json, queue_gen))
}

fn load_scene_json_for_ref(
    resources_dir: &std::path::Path,
    scene_ref: &SceneRef,
) -> Result<SceneJson, GameError> {
    let json = loader::load_scene(resources_dir, &scene_ref.file)?;
    let actual_type = scene_json_type(&json);
    validate_manifest_scene_type(&scene_ref.file, scene_ref.scene_type, actual_type)?;
    Ok(json)
}

fn scene_runtime_from_json(json: SceneJson, queue_gen: u64) -> SceneRuntime {
    match json {
        SceneJson::Linear(j) => SceneRuntime::Linear(LinearSceneState::from_json(j, queue_gen)),
        SceneJson::Investigation(j) => {
            SceneRuntime::Investigation(Box::new(InvestigationSceneState::from_json(j, queue_gen)))
        }
        SceneJson::Interrogation(j) => {
            SceneRuntime::Interrogation(Box::new(InterrogationSceneState::from_json(j, queue_gen)))
        }
    }
}

fn validate_manifest_scene_type(
    scene_file: &str,
    declared_type: SceneType,
    actual_type: SceneType,
) -> Result<(), GameError> {
    if declared_type != actual_type {
        return Err(GameError::scene_validation_failed(format!(
            "{}: chapter manifest declares {} but scene JSON contains {}",
            scene_file,
            scene_type_label(declared_type),
            scene_type_label(actual_type),
        )));
    }
    Ok(())
}

fn scene_json_identity(json: &SceneJson) -> (&str, &str) {
    match json {
        SceneJson::Linear(scene) => (&scene.id, &scene.title),
        SceneJson::Investigation(scene) => (&scene.id, &scene.title),
        SceneJson::Interrogation(scene) => (&scene.id, &scene.title),
    }
}

fn scene_json_type(json: &SceneJson) -> SceneType {
    match json {
        SceneJson::Linear(_) => SceneType::Linear,
        SceneJson::Investigation(_) => SceneType::Investigation,
        SceneJson::Interrogation(_) => SceneType::Interrogation,
    }
}

fn scene_type_label(scene_type: SceneType) -> &'static str {
    match scene_type {
        SceneType::Linear => "linear",
        SceneType::Investigation => "investigation",
        SceneType::Interrogation => "interrogation",
    }
}

// Must stay below all production `pub fn`s in this file: the
// every_view_returning_command_routes_through_command_tx scanner stops at the
// first #[cfg(test)] line.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::state::{EvidenceRecord, SceneRef};
    use crate::game::test_support::*;
    use crate::game::*;

    #[test]
    fn jump_to_scene_starts_linear_scene_fresh() {
        let d = scene_jump_fixture_resources();
        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let view = engine
            .jump_to_scene("chapter_1", "scene_0")
            .expect("jump to linear scene");

        assert_eq!(view.chapter.id, "chapter_1");
        match view.scene {
            SceneView::Linear {
                id, index, total, ..
            } => {
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
            SceneView::Investigation {
                id, index, total, ..
            } => {
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
    fn story_state_persists_across_scene_and_chapter_navigation() {
        use crate::game::story::AssertionOrigin;

        let d = story_navigation_fixture_resources();
        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        engine
            .story_state
            .assert_fact(
                &engine.story_catalog,
                "persistent_fact",
                AssertionOrigin::Migration {
                    migration_id: "legacy_case".into(),
                },
                &[],
                &[],
            )
            .unwrap();
        let expected = engine.story_state.snapshot();

        let same_chapter = engine
            .jump_to_scene("chapter_1", "scene_1")
            .expect("jump within chapter");
        assert_eq!(engine.story_state.snapshot(), expected);
        assert_eq!(same_chapter.story.facts[0].id, "persistent_fact");

        let next_chapter = engine
            .jump_to_scene("chapter_2", "scene_0")
            .expect("jump across chapters");
        assert_eq!(engine.story_state.snapshot(), expected);
        assert_eq!(next_chapter.story.facts[0].id, "persistent_fact");

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn jump_to_scene_returns_typed_errors_for_unknown_ids() {
        let d = scene_jump_fixture_resources();
        let mut engine = GameEngine::new_started(d.clone()).unwrap();

        let err = engine
            .jump_to_scene("chapter_missing", "scene_0")
            .unwrap_err();
        assert_eq!(err.code, "unknownChapter");

        let err = engine
            .jump_to_scene("chapter_1", "scene_missing")
            .unwrap_err();
        assert_eq!(err.code, "unknownScene");

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn jump_to_scene_restores_previous_state_when_priming_fails() {
        // Covers the `if let Err(err) = self.prime_initial_queue()` restore
        // branch in jump_to_scene. The jump target (scene_1) has an empty
        // linear queue, so prime_initial_queue calls advance_scene to load
        // scene_2. scene_2's manifest declares "linear" but its file is
        // investigation-typed, so load_scene_runtime rejects with
        // sceneValidationFailed. jump_to_scene must restore the snapshot
        // (still on scene_0) and propagate the error.
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-scene-jump-restore-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_1 = d.join("chapter_1");
        fs::create_dir_all(&chapter_1).unwrap();
        write_empty_story_catalog(&d);
        fs::write(
            d.join("chapters.json"),
            r#"{
            "chapters": [{
                "id": "chapter_1",
                "title": "Chapter One",
                "summary": "First",
                "scenes": [
                    { "type": "linear", "file": "chapter_1/scene_0.json" },
                    { "type": "linear", "file": "chapter_1/scene_1.json" },
                    { "type": "linear", "file": "chapter_1/scene_2.json" }
                ]
            }]
        }"#,
        )
        .unwrap();
        // Startup scene: non-empty queue so new_started primes successfully.
        // Two lines so a single advance_dialogue stays within scene_0 (and
        // does not cascade into advance_scene → scene_1 → scene_2).
        fs::write(
            chapter_1.join("scene_0.json"),
            r#"{
            "type": "linear",
            "id": "scene_0",
            "title": "Opening",
            "queue": [
                { "kind": "line", "speaker": "A", "text": "start" },
                { "kind": "line", "speaker": "A", "text": "second" }
            ]
        }"#,
        )
        .unwrap();
        // Jump target: empty queue → prime_initial_queue calls advance_scene.
        fs::write(
            chapter_1.join("scene_1.json"),
            r#"{
            "type": "linear",
            "id": "scene_1",
            "title": "Empty",
            "queue": []
        }"#,
        )
        .unwrap();
        // Next scene after the jump target: declared linear but file is
        // investigation-typed → load_scene_runtime rejects with
        // sceneValidationFailed during advance_scene.
        fs::write(
            chapter_1.join("scene_2.json"),
            r#"{
            "type": "investigation",
            "id": "scene_2",
            "title": "Mismatched",
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

        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        // Sanity: engine started on scene_0.
        let before = engine.view();
        let before_scene_id = match &before.scene {
            SceneView::Linear { id, .. } => id.clone(),
            other => panic!("expected linear scene at startup, got {other:?}"),
        };
        assert_eq!(before_scene_id, "scene_0");

        let err = engine
            .jump_to_scene("chapter_1", "scene_1")
            .expect_err("jump should fail during priming");
        assert_eq!(err.code, "sceneValidationFailed");

        // Snapshot restored: the engine is still on scene_0 with the
        // original queue generation sequence intact.
        let after = engine.view();
        let after_scene_id = match &after.scene {
            SceneView::Linear { id, .. } => id.clone(),
            other => panic!("expected linear scene after restore, got {other:?}"),
        };
        assert_eq!(after_scene_id, "scene_0");
        assert_eq!(after.chapter.id, "chapter_1");

        // The engine remains usable: advancing dialogue on the restored
        // scene still works.
        let token = match &after.mode {
            ModeView::Dialogue { queue_token, .. } => queue_token.clone(),
            other => panic!("expected Dialogue mode after restore, got {other:?}"),
        };
        let advanced = engine.advance_dialogue(token).unwrap();
        match advanced.mode {
            ModeView::Dialogue { current, .. } => {
                // Advancing past the first line ("start") lands on the
                // second line ("second") — proving the restored queue cursor
                // and queue generation are intact and the engine is usable.
                assert!(
                    matches!(&current, DialogueItem::Line { text, .. } if text == "second"),
                    "expected second line after advance, got {current:?}"
                );
            }
            other => panic!("expected Dialogue mode after advance, got {other:?}"),
        }

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn jump_to_scene_restores_non_empty_dialogue_history_when_priming_fails() {
        // Companion to jump_to_scene_restores_previous_state_when_priming_fails.
        // That test starts with empty dialogue_history, so it cannot
        // distinguish "rollback restored empty" from "nothing to restore."
        // This test populates history by advancing dialogue on scene_0 before
        // the failing jump, then asserts EngineRollbackSnapshot::restore put
        // the non-empty history back exactly as it was.
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-scene-jump-restore-history-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_1 = d.join("chapter_1");
        fs::create_dir_all(&chapter_1).unwrap();
        write_empty_story_catalog(&d);
        fs::write(
            d.join("chapters.json"),
            r#"{
            "chapters": [{
                "id": "chapter_1",
                "title": "Chapter One",
                "summary": "First",
                "scenes": [
                    { "type": "linear", "file": "chapter_1/scene_0.json" },
                    { "type": "linear", "file": "chapter_1/scene_1.json" },
                    { "type": "linear", "file": "chapter_1/scene_2.json" }
                ]
            }]
        }"#,
        )
        .unwrap();
        // Startup scene: three lines so we can advance once and still have
        // remaining lines (staying within scene_0, no cascade into scene_1).
        fs::write(
            chapter_1.join("scene_0.json"),
            r#"{
            "type": "linear",
            "id": "scene_0",
            "title": "Opening",
            "queue": [
                { "kind": "line", "speaker": "A", "text": "start" },
                { "kind": "line", "speaker": "A", "text": "second" },
                { "kind": "line", "speaker": "A", "text": "third" }
            ]
        }"#,
        )
        .unwrap();
        // Jump target: empty queue → prime_initial_queue calls advance_scene.
        fs::write(
            chapter_1.join("scene_1.json"),
            r#"{
            "type": "linear",
            "id": "scene_1",
            "title": "Empty",
            "queue": []
        }"#,
        )
        .unwrap();
        // Next scene after the jump target: declared linear but file is
        // investigation-typed → load_scene_runtime rejects with
        // sceneValidationFailed during advance_scene.
        fs::write(
            chapter_1.join("scene_2.json"),
            r#"{
            "type": "investigation",
            "id": "scene_2",
            "title": "Mismatched",
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

        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        // Startup records the first visible line ("start") into history.
        let started = engine.view();
        assert_eq!(
            history_labels(&started),
            vec!["A: start".to_string()],
            "startup should record the first visible line"
        );

        // Advance once to focus "second"; this records "second" into history,
        // giving us a non-empty, multi-entry history to verify rollback against.
        let advanced = engine.advance_dialogue(token_from(&started)).unwrap();
        let pre_jump_history = history_labels(&advanced);
        assert_eq!(
            pre_jump_history,
            vec!["A: start".to_string(), "A: second".to_string()],
            "advance should record the newly focused line"
        );
        let pre_jump_token = token_from(&advanced);

        // Failing jump: scene_1 is empty so priming cascades into scene_2,
        // which fails validation. jump_to_scene must restore the snapshot
        // taken before mutating state — including the non-empty history.
        let err = engine
            .jump_to_scene("chapter_1", "scene_1")
            .expect_err("jump should fail during priming");
        assert_eq!(err.code, "sceneValidationFailed");

        // Scene identity restored.
        let after = engine.view();
        let after_scene_id = match &after.scene {
            SceneView::Linear { id, .. } => id.clone(),
            other => panic!("expected linear scene after restore, got {other:?}"),
        };
        assert_eq!(after_scene_id, "scene_0");

        // The non-empty dialogue history must be restored verbatim, proving
        // EngineRollbackSnapshot::restore copied the history fields (not just
        // left them empty).
        assert_eq!(
            history_labels(&after),
            pre_jump_history,
            "rollback must restore the pre-jump non-empty dialogue history"
        );

        // The restored queue token must match the pre-jump token, proving
        // next_queue_gen was restored (not incremented by the failed jump).
        assert_eq!(
            token_from(&after),
            pre_jump_token,
            "rollback must restore the queue generation"
        );

        // The engine remains usable: advancing from the restored cursor
        // focuses "third", and records it into history on top of the restored
        // entries — proving both the cursor and the history log are live.
        let next = engine.advance_dialogue(token_from(&after)).unwrap();
        assert_eq!(
            history_labels(&next),
            vec![
                "A: start".to_string(),
                "A: second".to_string(),
                "A: third".to_string(),
            ],
            "post-rollback advance must append to the restored history"
        );

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn scene_lookup_returns_loaded_runtime_for_matching_scene() {
        let d = scene_jump_fixture_resources();
        let chapters = load_chapter_manifests(&d).unwrap();

        let (index, runtime) =
            find_scene_runtime_by_id(&d, &chapters[0], "investigation_scene_1", 42)
                .expect("scene lookup succeeds")
                .expect("matching scene exists");

        assert_eq!(index, 1);
        match runtime {
            SceneRuntime::Investigation(scene) => {
                assert_eq!(scene.def.id, "investigation_scene_1");
                assert_eq!(scene.intro_queue_gen, 42);
            }
            other => panic!("expected investigation runtime, got {other:?}"),
        }

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn scene_lookup_rejects_duplicate_scene_ids_as_ambiguous() {
        // Defense-in-depth for review comment #7: the navigation index build
        // rejects duplicate scene ids per chapter, but find_scene_runtime_by_id
        // must also resolve targets unambiguously so a jump never silently
        // lands on the "first" of two same-id scenes. Build a chapter with two
        // files carrying the same id and assert both the helper and
        // jump_to_scene surface a typed duplicateSceneTarget error.
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-scene-jump-dup-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_1 = d.join("chapter_1");
        fs::create_dir_all(&chapter_1).unwrap();
        write_empty_story_catalog(&d);
        fs::write(
            d.join("chapters.json"),
            r#"{
            "chapters": [{
                "id": "chapter_1",
                "title": "Chapter One",
                "summary": "First",
                "scenes": [
                    { "type": "linear", "file": "chapter_1/scene_0.json" },
                    { "type": "linear", "file": "chapter_1/dup_a.json" },
                    { "type": "linear", "file": "chapter_1/dup_b.json" }
                ]
            }]
        }"#,
        )
        .unwrap();
        // Startup scene: non-empty queue so new_started primes successfully.
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
        // Two scenes sharing id "dup_scene" — the ambiguity this test guards.
        fs::write(
            chapter_1.join("dup_a.json"),
            r#"{
            "type": "linear",
            "id": "dup_scene",
            "title": "First dup",
            "queue": [{ "kind": "line", "speaker": "A", "text": "a" }]
        }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("dup_b.json"),
            r#"{
            "type": "linear",
            "id": "dup_scene",
            "title": "Second dup",
            "queue": [{ "kind": "line", "speaker": "A", "text": "b" }]
        }"#,
        )
        .unwrap();

        let chapters = load_chapter_manifests(&d).unwrap();

        // The helper itself rejects the ambiguous target.
        let err = find_scene_runtime_by_id(&d, &chapters[0], "dup_scene", 1)
            .expect_err("duplicate ids must be rejected");
        assert_eq!(err.code, "duplicateSceneTarget");

        // And jump_to_scene propagates the same typed error.
        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let err = engine
            .jump_to_scene("chapter_1", "dup_scene")
            .expect_err("jump to ambiguous scene must fail");
        assert_eq!(err.code, "duplicateSceneTarget");
        // The engine is untouched (no snapshot/restore needed since the
        // ambiguity is detected before any state mutation).
        let after_scene_id = match &engine.view().scene {
            SceneView::Linear { id, .. } => id.clone(),
            other => panic!("expected linear scene, got {other:?}"),
        };
        assert_eq!(after_scene_id, "scene_0");

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn load_scene_runtime_accepts_interrogation_scene() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-runtime-unsupported-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "interrogation",
                "id": "interrogation_scene_1",
                "title": "Interrogation",
                "intro": [],
                "phases": [],
                "evidenceManifest": [],
                "statementManifest": [],
                "outro": { "unlock": "auto", "dialogue": [] }
            }"#,
        )
        .unwrap();

        let runtime = load_scene_runtime(
            &d,
            &SceneRef {
                scene_type: SceneType::Interrogation,
                file: "chapter_1/interrogation_scene_1.json".into(),
            },
            1,
        )
        .unwrap();

        assert!(matches!(runtime, SceneRuntime::Interrogation(_)));
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn load_scene_runtime_rejects_manifest_scene_type_mismatch() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-runtime-mismatch-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "linear",
                "id": "scene_0",
                "title": "Wrong Kind",
                "queue": []
            }"#,
        )
        .unwrap();

        let err = load_scene_runtime(
            &d,
            &SceneRef {
                scene_type: SceneType::Interrogation,
                file: "chapter_1/interrogation_scene_1.json".into(),
            },
            1,
        )
        .unwrap_err();

        assert_eq!(err.code, "sceneValidationFailed");
        assert!(err.message.contains("declares interrogation"));
        assert!(err.message.contains("contains linear"));
        let _ = fs::remove_dir_all(d);
    }

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
                    "kind": "inquiry",
                    "id": "phase_1",
                    "label": "證言",
                    "subject": { "id": "witness", "name": "Witness", "role": "Witness", "bio": "Quiet." },
                    "required": true,
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [],
                    "sceneTag": "room",
                    "entryDialogue": [],
                    "complete": "auto",
                    "questions": []
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
        assert_eq!(index.chapters[0].scenes[1].title, "Investigation");
        assert_eq!(
            index.chapters[0].scenes[1].scene_type,
            SceneType::Investigation
        );
        assert_eq!(index.chapters[0].scenes[1].index, 1);
        assert_eq!(index.chapters[1].id, "chapter_2");
        assert_eq!(index.chapters[1].title, "Chapter Two");
        assert_eq!(index.chapters[1].index, 1);
        assert_eq!(index.chapters[1].scenes.len(), 1);
        assert_eq!(index.chapters[1].scenes[0].id, "interrogation_scene_0");
        assert_eq!(index.chapters[1].scenes[0].title, "Interrogation");
        assert_eq!(
            index.chapters[1].scenes[0].scene_type,
            SceneType::Interrogation
        );
        assert_eq!(index.chapters[1].scenes[0].index, 0);

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

    #[test]
    fn scene_navigation_index_rejects_duplicate_scene_id_within_chapter() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-scene-index-dup-scene-{}-{}",
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
                        { "type": "linear", "file": "chapter_1/scene_a.json" },
                        { "type": "linear", "file": "chapter_1/scene_b.json" }
                    ]
                }]
            }"#,
        )
        .unwrap();
        // Both scenes share the same id — jump_to_scene resolves by first
        // match, so this would silently target the wrong scene. The index
        // build must reject it before navigation is possible.
        fs::write(
            chapter_1.join("scene_a.json"),
            r#"{ "type": "linear", "id": "dup", "title": "A", "queue": [] }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("scene_b.json"),
            r#"{ "type": "linear", "id": "dup", "title": "B", "queue": [] }"#,
        )
        .unwrap();

        let err = GameEngine::scene_navigation_index(d.clone()).unwrap_err();
        assert_eq!(err.code, "chapterLoadFailed");
        assert!(err.message.contains("duplicate scene id \"dup\""));

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn scene_navigation_index_rejects_duplicate_chapter_id() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-scene-index-dup-chapter-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dup = d.join("chapter_1");
        fs::create_dir_all(&chapter_dup).unwrap();
        fs::write(
            d.join("chapters.json"),
            r#"{
                "chapters": [
                    {
                        "id": "chapter_1",
                        "title": "First",
                        "summary": "First",
                        "scenes": [{ "type": "linear", "file": "chapter_1/scene_0.json" }]
                    },
                    {
                        "id": "chapter_1",
                        "title": "Second",
                        "summary": "Second",
                        "scenes": [{ "type": "linear", "file": "chapter_1/scene_0.json" }]
                    }
                ]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dup.join("scene_0.json"),
            r#"{ "type": "linear", "id": "scene_0", "title": "S", "queue": [] }"#,
        )
        .unwrap();

        let err = GameEngine::scene_navigation_index(d.clone()).unwrap_err();
        assert_eq!(err.code, "chapterLoadFailed");
        assert!(err.message.contains("duplicate chapter id \"chapter_1\""));

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn jump_to_interrogation_grants_all_evidence_for_testing() {
        let d = scene_jump_fixture_resources();
        let mut engine = GameEngine::new_started(d.clone()).unwrap();

        let view = engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .expect("jump to interrogation scene");

        // Cross-scene evidence (defined in the investigation scene's manifest)
        // is granted so interrogation contradictions are presentable in testing.
        assert!(view.inventory.has_evidence("test_evidence"));

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn load_chapter_manifests_rejects_duplicate_chapter_id() {
        // load_chapter_manifests is the root gate: if it allows duplicates,
        // jump_to_scene_inner would silently target the first match. The
        // navigation-index build (list_scenes) also rejects duplicates, but
        // that is a separate command and does not gate jump_to_scene. This
        // test verifies the load-time gate fires before the engine starts.
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-load-dup-chapter-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dup = d.join("chapter_1");
        fs::create_dir_all(&chapter_dup).unwrap();
        fs::write(
            d.join("chapters.json"),
            r#"{
                "chapters": [
                    {
                        "id": "chapter_1",
                        "title": "First",
                        "summary": "First",
                        "scenes": [{ "type": "linear", "file": "chapter_1/scene_0.json" }]
                    },
                    {
                        "id": "chapter_1",
                        "title": "Second",
                        "summary": "Second",
                        "scenes": [{ "type": "linear", "file": "chapter_1/scene_0.json" }]
                    }
                ]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dup.join("scene_0.json"),
            r#"{ "type": "linear", "id": "scene_0", "title": "S", "queue": [] }"#,
        )
        .unwrap();

        let err = match GameEngine::new_started(d.clone()) {
            Ok(_) => panic!("expected duplicate chapter id rejection, but engine started"),
            Err(e) => e,
        };
        assert_eq!(err.code, "chapterLoadFailed");
        assert!(err.message.contains("duplicate chapter id \"chapter_1\""));

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn jump_to_scene_rejects_duplicate_chapter_id_defense_in_depth() {
        // Even if duplicate chapters somehow reach the engine's `chapters` vec
        // (bypassing load_chapter_manifests — e.g. a test injects them
        // directly), jump_to_scene_inner must not silently pick the first
        // match. It scans for multiple matches and surfaces a typed error,
        // mirroring the duplicate-scene guard in find_scene_runtime_by_id.
        let mut engine = empty_engine_with_interrogation_scene(
            crate::game::test_support::empty_inquiry_interrogation_scene(),
            1,
        );
        // Inject a second chapter with the same id as the first.
        engine.chapters.push(ChapterManifest {
            id: "chapter_1".into(),
            title: "Duplicate".into(),
            summary: "Duplicate".into(),
            scenes: vec![SceneRef {
                scene_type: SceneType::Interrogation,
                file: "chapter_1/interrogation_scene_1.json".into(),
            }],
        });

        let err = engine
            .jump_to_scene("chapter_1", "interrogation_scene_1")
            .unwrap_err();
        assert_eq!(err.code, "duplicateChapterTarget");
        assert!(err.message.contains("chapter_1"));
    }
}
