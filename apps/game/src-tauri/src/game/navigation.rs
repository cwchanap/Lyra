// src-tauri/src/game/navigation.rs
//
// Chapter/scene loading and the navigation paths that move between scenes.

use super::acquisition::AcquisitionCtx;
use super::command_tx::CommandMutation;
use super::dialogue_queue::{DialogueSegment, DialogueSegmentOriginV1};
use super::loader;
use super::provenance::validate_catalog_record_origin_coverage;
use super::scenes::analysis::AnalysisSceneState;
use super::scenes::interrogation::InterrogationSceneState;
use super::scenes::investigation::InvestigationSceneState;
use super::scenes::linear::LinearSceneState;
use super::scenes::SceneRuntime;
use super::schema::{SceneJson, SceneType};
use super::state::{ChapterManifest, Inventory, SceneRef};
use super::story::StoryCatalog;
use super::view::{
    GameStateView, SceneNavigationChapter, SceneNavigationIndex, SceneNavigationScene,
};
use super::{GameEngine, GameError, LastVisualCue};
#[cfg(test)]
use std::cell::Cell;

#[cfg(test)]
thread_local! {
    static CHAPTER_SCENE_LOAD_COUNT: Cell<usize> = const { Cell::new(0) };
}

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
            &self.story_catalog,
            &self.chapters[chapter_idx],
            scene_id,
            queue_gen,
        )?
        .ok_or_else(|| GameError::unknown_scene(chapter_id, scene_id))?;

        self.command_tx(move |engine, command_id, next_ordinal| {
            engine.current_chapter_idx = chapter_idx;
            engine.current_scene_idx = scene_idx;
            engine.scene = new_scene;
            if let SceneRuntime::Analysis(scene) = &mut engine.scene {
                scene.recompute_available_board_ids(&engine.story_state);
            }
            engine.last_visual_cue = LastVisualCue::default();
            engine.inventory = Inventory::default();
            engine.pending_acquisition_events.clear();
            engine.next_queue_gen = queue_gen + 1;
            engine.history.reset();

            engine.prime_initial_queue_for_command(command_id, next_ordinal)?;
            // Developer convenience: jumping straight into an interrogation via
            // scene-navigation skips the investigation where its contradiction
            // evidence is normally collected. Grant everything so every
            // testimony is presentable for testing. Gated to debug builds
            // (`cfg!(debug_assertions)`) because Scene Select is also exposed
            // in production replay after `storyClearedOnce`; releasing the full
            // inventory there would spoil every scene's evidence and bypass
            // the intended inventory gating.
            if cfg!(debug_assertions) && matches!(engine.scene, SceneRuntime::Interrogation(_)) {
                // `grant_all_evidence_for_testing` seeds the inventory so every
                // contradiction is presentable, but it also queues an
                // acquisition event per evidence/statement, which would surface
                // a flurry of "evidence acquired" popups for items the player
                // never actually collected. Capture the pending-event baseline
                // before the grant and restore it afterward, mirroring
                // `prime_initial_queue`'s discard-baseline-events pattern. The
                // inventory seeding itself is preserved because only the event
                // queue is truncated, not `engine.inventory`.
                let acquisition_event_baseline = engine.pending_acquisition_events.len();
                engine.grant_all_evidence_for_testing(command_id, next_ordinal);
                engine
                    .pending_acquisition_events
                    .truncate(acquisition_event_baseline);
            }
            Ok(CommandMutation::Changed)
        })
    }

    /// Grants every evidence and statement defined across all scenes so that
    /// any interrogation contradiction can be presented. Testing-only, reached
    /// solely from [`Self::jump_to_scene`] into an interrogation scene and only
    /// in debug builds (`cfg!(debug_assertions)`). Scenes that fail to load are
    /// skipped — this is a best-effort convenience, not a correctness path, so
    /// a single bad scene must not abort the grant.
    pub(super) fn grant_all_evidence_for_testing(
        &mut self,
        command_id: u64,
        next_ordinal: &mut u32,
    ) {
        let chapters = self.chapters.clone();
        for chapter in &chapters {
            for scene_ref in &chapter.scenes {
                let Ok(scene) = loader::load_scene_with_catalog(
                    &self.resources_dir,
                    &self.story_catalog,
                    &chapter.id,
                    &scene_ref.file,
                ) else {
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
                    SceneJson::Linear(_) | SceneJson::Analysis(_) => continue,
                };
                let mut acq = AcquisitionCtx {
                    catalog: &self.story_catalog,
                    inventory: &mut self.inventory,
                    pending_events: &mut self.pending_acquisition_events,
                    command_id,
                    next_ordinal,
                };
                for def in evidence {
                    let _ = acq.evidence(def, &chapter.id, &scene_id);
                }
                for def in statements {
                    let _ = acq.statement(def, &chapter.id, &scene_id);
                }
            }
        }
    }

    /// Scene-entry sequencing. Installs the new scene's opening queue via the
    /// primitives in `dialogue.rs`; it lives here because its three callers
    /// (`new_started`, `jump_to_scene`, `advance_scene`) are all navigation
    /// paths.
    pub(super) fn prime_initial_queue(&mut self) -> Result<(), GameError> {
        // Startup and in-memory fixture construction establish baseline state,
        // not a durable player command. Run the same reveal pipeline against
        // the current committed revision, then discard only events created
        // while constructing that baseline. Command-driven navigation uses
        // `prime_initial_queue_for_command` with `command_tx`'s checked ID.
        let event_count = self.pending_acquisition_events.len();
        let mut next_ordinal = 0;
        let result = self.prime_initial_queue_for_command(self.durable_revision, &mut next_ordinal);
        self.pending_acquisition_events.truncate(event_count);
        result
    }

    pub(super) fn prime_initial_queue_for_command(
        &mut self,
        command_id: u64,
        next_ordinal: &mut u32,
    ) -> Result<(), GameError> {
        if let SceneRuntime::Analysis(scene) = &mut self.scene {
            // Availability is derived from the packaged unlock expressions
            // and the current persistent StoryState on every scene entry.
            scene.recompute_available_board_ids(&self.story_state);
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();
        let mut intro_queue = None;
        let mut needs_linear_prime = false;
        let mut needs_interrogation_advance = false;
        let mut needs_analysis_advance = false;
        let needs_initial_sub = match &mut self.scene {
            SceneRuntime::Linear(_) => {
                needs_linear_prime = true;
                false
            }
            SceneRuntime::Investigation(inv) => {
                if !inv.intro_played && !inv.def.intro.is_empty() {
                    intro_queue = DialogueSegment::new(
                        DialogueSegmentOriginV1::InvestigationIntro {
                            chapter_id: chapter_id.clone(),
                            scene_id: inv.def.id.clone(),
                        },
                        inv.def.intro.clone(),
                    )
                    .map(|segment| (vec![segment], inv.intro_queue_gen));
                    inv.intro_played = true;
                    false
                } else {
                    true
                }
            }
            SceneRuntime::Interrogation(scene) => {
                if !scene.intro_played && !scene.def.intro.is_empty() {
                    intro_queue = DialogueSegment::new(
                        DialogueSegmentOriginV1::InterrogationIntro {
                            chapter_id: chapter_id.clone(),
                            scene_id: scene.def.id.clone(),
                        },
                        scene.def.intro.clone(),
                    )
                    .map(|segment| (vec![segment], scene.intro_queue_gen));
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
            SceneRuntime::Analysis(scene) => {
                if !scene.intro_played && !scene.def.intro.is_empty() {
                    intro_queue = DialogueSegment::new(
                        DialogueSegmentOriginV1::AnalysisIntro {
                            chapter_id: chapter_id.clone(),
                            scene_id: scene.def.id.clone(),
                        },
                        scene.def.intro.clone(),
                    )
                    .map(|segment| (vec![segment], scene.intro_queue_gen));
                    scene.intro_played = true;
                    false
                } else {
                    scene.intro_played = true;
                    needs_analysis_advance = true;
                    false
                }
            }
        };
        if needs_linear_prime {
            let exhausted = matches!(
                &self.scene,
                SceneRuntime::Linear(scene) if scene.queue.is_none()
            ) || self.consume_scene_tags_at_cursor();
            if exhausted {
                self.on_queue_exhausted(command_id, next_ordinal)?;
            }
            return Ok(());
        }
        if let Some((segments, queue_gen)) = intro_queue {
            self.install_scene_queue(segments, queue_gen, None, command_id, next_ordinal)?;
        }
        if needs_initial_sub {
            self.advance_into_first_sublocation(command_id, next_ordinal)?;
        }
        if needs_interrogation_advance
            && self.try_advance_interrogation(command_id, next_ordinal)?
        {
            self.advance_scene(command_id, next_ordinal)?;
        }
        if needs_analysis_advance && self.try_advance_analysis(command_id, next_ordinal)? {
            self.advance_scene(command_id, next_ordinal)?;
        }
        Ok(())
    }

    pub(super) fn advance_scene(
        &mut self,
        command_id: u64,
        next_ordinal: &mut u32,
    ) -> Result<(), GameError> {
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
        let chapter_id = self.chapters[next_chapter_idx].id.clone();
        let new_scene = load_scene_runtime(
            &self.resources_dir,
            &self.story_catalog,
            &chapter_id,
            &scene_ref,
            queue_gen,
        )?;
        self.rollback_scope(|engine| {
            engine.current_chapter_idx = next_chapter_idx;
            engine.current_scene_idx = next_scene_idx;
            engine.scene = new_scene;
            if let SceneRuntime::Analysis(scene) = &mut engine.scene {
                scene.recompute_available_board_ids(&engine.story_state);
            }
            engine.last_visual_cue.reset_for_new_scene();
            engine.next_queue_gen += 1;
            engine.prime_initial_queue_for_command(command_id, next_ordinal)
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

/// Practice cards are a tutorial handoff from the immediately preceding
/// investigation scene. Analysis scenes without practice cards are ordinary
/// scene nodes and may follow any scene type. Keep this graph invariant at a
/// boundary that can see the ordered scenes within each chapter;
/// `load_scene_runtime` only receives one scene and cannot prove the
/// predecessor relationship.
pub(super) fn validate_analysis_scene_adjacency(
    resources_dir: &std::path::Path,
    catalog: &StoryCatalog,
    chapters: &[ChapterManifest],
) -> Result<(), GameError> {
    for chapter in chapters {
        let mut previous_scene: Option<SceneJson> = None;
        for scene_ref in &chapter.scenes {
            let current_scene =
                load_scene_json_for_ref(resources_dir, catalog, &chapter.id, scene_ref)?;

            if let SceneJson::Analysis(definition) = &current_scene {
                let uses_practice_cards = definition.boards.iter().any(|board| {
                    board.common().cards.iter().any(|card| {
                        matches!(
                            &card.source,
                            super::schema::AnalysisCardSource::Practice { .. }
                        )
                    })
                });
                if uses_practice_cards
                    && !matches!(previous_scene.as_ref(), Some(SceneJson::Investigation(_)))
                {
                    let previous = previous_scene
                        .as_ref()
                        .map(scene_json_type)
                        .map(scene_type_label)
                        .unwrap_or("the start of this chapter");
                    return Err(GameError::scene_validation_failed(format!(
                        "{}: analysis scene '{}' uses practice cards and must be immediately preceded by an investigation scene in chapter '{}', but the previous scene is {previous}; direct investigation-to-analysis adjacency is required.",
                        scene_ref.file, definition.id, chapter.id
                    )));
                }
            }
            previous_scene = Some(current_scene);
        }
    }
    Ok(())
}

pub(super) fn scene_navigation_index_from_chapters(
    resources_dir: &std::path::Path,
    catalog: &StoryCatalog,
    chapters: &[ChapterManifest],
) -> Result<SceneNavigationIndex, GameError> {
    validate_analysis_scene_adjacency(resources_dir, catalog, chapters)?;
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
            let json = load_scene_json_for_ref(resources_dir, catalog, &chapter.id, scene_ref)?;
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

    validate_catalog_record_origin_coverage(
        catalog,
        chapter_views.iter().flat_map(|chapter| {
            chapter
                .scenes
                .iter()
                .map(|scene| (chapter.id.clone(), scene.id.clone()))
        }),
    )?;

    Ok(SceneNavigationIndex {
        chapters: chapter_views,
    })
}

fn find_scene_runtime_by_id(
    resources_dir: &std::path::Path,
    catalog: &StoryCatalog,
    chapter: &ChapterManifest,
    scene_id: &str,
    queue_gen: u64,
) -> Result<Option<(usize, SceneRuntime)>, GameError> {
    let Some((idx, json)) = find_scene_json_by_id(resources_dir, catalog, chapter, scene_id)?
    else {
        return Ok(None);
    };
    Ok(Some((
        idx,
        scene_runtime_from_json(json, &chapter.id, queue_gen)?,
    )))
}

pub(super) fn find_scene_json_by_id(
    resources_dir: &std::path::Path,
    catalog: &StoryCatalog,
    chapter: &ChapterManifest,
    scene_id: &str,
) -> Result<Option<(usize, SceneJson)>, GameError> {
    // Defense-in-depth: the navigation index build rejects duplicate scene
    // ids per chapter, but resolve the jump target unambiguously here too so a
    // jump never silently lands on the "first" of two same-id scenes (e.g. if
    // resource files drift after the index was built, or this helper is reused
    // outside the gated navigation flow). Scan the whole chapter; if more than
    // one scene file carries the requested id, surface a typed error rather
    // than picking one arbitrarily. The extra JSON loads are negligible for an
    // infrequent, user-driven jump.
    let mut found: Option<(usize, SceneJson)> = None;
    for (idx, json) in load_chapter_scene_jsons(resources_dir, catalog, chapter)?
        .into_iter()
        .enumerate()
    {
        if scene_json_identity(&json).0 == scene_id {
            if found.is_some() {
                return Err(GameError::duplicate_scene_target(&chapter.id, scene_id));
            }
            found = Some((idx, json));
        }
    }
    Ok(found)
}

pub(super) fn load_chapter_scene_jsons(
    resources_dir: &std::path::Path,
    catalog: &StoryCatalog,
    chapter: &ChapterManifest,
) -> Result<Vec<SceneJson>, GameError> {
    #[cfg(test)]
    CHAPTER_SCENE_LOAD_COUNT.with(|count| count.set(count.get() + 1));
    chapter
        .scenes
        .iter()
        .map(|scene_ref| load_scene_json_for_ref(resources_dir, catalog, &chapter.id, scene_ref))
        .collect()
}

#[cfg(test)]
pub(in crate::game) fn reset_chapter_scene_load_count_for_test() {
    CHAPTER_SCENE_LOAD_COUNT.with(|count| count.set(0));
}

#[cfg(test)]
pub(in crate::game) fn chapter_scene_load_count_for_test() -> usize {
    CHAPTER_SCENE_LOAD_COUNT.with(Cell::get)
}

pub(super) fn load_scene_runtime(
    resources_dir: &std::path::Path,
    catalog: &StoryCatalog,
    chapter_id: &str,
    scene_ref: &SceneRef,
    queue_gen: u64,
) -> Result<SceneRuntime, GameError> {
    let json = load_scene_json_for_ref(resources_dir, catalog, chapter_id, scene_ref)?;
    scene_runtime_from_json(json, chapter_id, queue_gen)
}

fn load_scene_json_for_ref(
    resources_dir: &std::path::Path,
    catalog: &StoryCatalog,
    chapter_id: &str,
    scene_ref: &SceneRef,
) -> Result<SceneJson, GameError> {
    let json =
        loader::load_scene_with_catalog(resources_dir, catalog, chapter_id, &scene_ref.file)?;
    let actual_type = scene_json_type(&json);
    validate_manifest_scene_type(&scene_ref.file, scene_ref.scene_type, actual_type)?;
    Ok(json)
}

fn scene_runtime_from_json(
    json: SceneJson,
    chapter_id: &str,
    queue_gen: u64,
) -> Result<SceneRuntime, GameError> {
    match json {
        SceneJson::Linear(j) => Ok(SceneRuntime::Linear(LinearSceneState::from_json(
            j, chapter_id, queue_gen,
        ))),
        SceneJson::Investigation(j) => Ok(SceneRuntime::Investigation(Box::new(
            InvestigationSceneState::from_json(j, queue_gen),
        ))),
        SceneJson::Interrogation(j) => Ok(SceneRuntime::Interrogation(Box::new(
            InterrogationSceneState::from_json(j, queue_gen),
        ))),
        SceneJson::Analysis(j) => Ok(SceneRuntime::Analysis(Box::new(
            AnalysisSceneState::from_json(j, queue_gen),
        ))),
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

pub(super) fn scene_json_identity(json: &SceneJson) -> (&str, &str) {
    match json {
        SceneJson::Linear(scene) => (&scene.id, &scene.title),
        SceneJson::Investigation(scene) => (&scene.id, &scene.title),
        SceneJson::Interrogation(scene) => (&scene.id, &scene.title),
        SceneJson::Analysis(scene) => (&scene.id, &scene.title),
    }
}

pub(super) fn scene_json_summary(json: &SceneJson) -> &str {
    match json {
        SceneJson::Linear(scene) => &scene.summary,
        SceneJson::Investigation(scene) => &scene.summary,
        SceneJson::Interrogation(scene) => &scene.summary,
        SceneJson::Analysis(scene) => &scene.summary,
    }
}

fn scene_json_type(json: &SceneJson) -> SceneType {
    match json {
        SceneJson::Linear(_) => SceneType::Linear,
        SceneJson::Investigation(_) => SceneType::Investigation,
        SceneJson::Interrogation(_) => SceneType::Interrogation,
        SceneJson::Analysis(_) => SceneType::Analysis,
    }
}

fn scene_type_label(scene_type: SceneType) -> &'static str {
    match scene_type {
        SceneType::Linear => "linear",
        SceneType::Investigation => "investigation",
        SceneType::Interrogation => "interrogation",
        SceneType::Analysis => "analysis",
    }
}

// Must stay below all production `pub fn`s in this file: the
// every_view_returning_command_routes_through_command_tx scanner stops at the
// first #[cfg(test)] line.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::analysis::{AnalysisDraft, AnalysisFeedbackState};
    use crate::game::state::{EvidenceRecord, SceneRef};
    use crate::game::test_support::*;
    use crate::game::unlock::StoryUnlockContext;
    use crate::game::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn write_mismatched_investigation_scene(path: &std::path::Path) {
        std::fs::write(
            path,
            r#"{
                "type": "investigation",
                "id": "scene_2",
                "title": "Mismatched",
                "summary": "Fixture scene summary.",
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
    }

    fn acquisition_navigation_resources(
        label: &str,
        chapters: &str,
        scenes: &[(&str, String)],
    ) -> std::path::PathBuf {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let resources =
            std::env::temp_dir().join(format!("lyra-{label}-{}-{n}", std::process::id()));
        let chapter_dir = resources.join("chapter_1");
        std::fs::create_dir_all(&chapter_dir).unwrap();
        write_empty_story_catalog_and_content_manifest(&resources);
        std::fs::write(resources.join("chapters.json"), chapters).unwrap();
        let mut evidence_index = Vec::new();
        for (file, body) in scenes {
            std::fs::write(chapter_dir.join(file), body).unwrap();
            let scene: serde_json::Value = serde_json::from_str(body).unwrap();
            let Some(scene_id) = scene.get("id").and_then(serde_json::Value::as_str) else {
                continue;
            };
            for record in scene
                .get("evidenceManifest")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
            {
                evidence_index.push(serde_json::json!({
                    "id": record["id"],
                    "chapterId": "chapter_1",
                    "sceneId": scene_id,
                    "provenance": neutral_provenance_json()
                }));
            }
        }
        std::fs::write(
            resources.join("story_catalog.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "schemaVersion": 2,
                "facts": [],
                "questions": [],
                "objectives": [],
                "authorizations": [],
                "sourceGroups": [],
                "evidenceIndex": evidence_index,
                "statementsIndex": [],
            }))
            .unwrap(),
        )
        .unwrap();
        resources
    }

    fn analysis_scene_json(id: &str) -> String {
        format!(
            r#"{{
                "type": "analysis",
                "id": "{id}",
                "title": "Analysis",
                "summary": "Immutable analysis fixture.",
                "assetRefs": [],
                "intro": [],
                "boards": [{{
                    "kind": "threshold",
                    "common": {{
                        "id": "board_1",
                        "label": "Board",
                        "prompt": "Select.",
                        "unlock": null,
                        "reveals": [],
                        "feedback": {{"incomplete": "Incomplete.", "incorrect": "Incorrect.", "hint": null}},
                        "cards": [],
                        "resultDialogue": []
                    }},
                    "minimumSelected": 0,
                    "acceptedSelections": [[]]
                }}],
                "outro": []
            }}"#
        )
    }

    fn analysis_scene_with_practice_json(id: &str, practice_id: &str) -> String {
        let mut scene: serde_json::Value = serde_json::from_str(&analysis_scene_json(id))
            .expect("practice analysis fixture must be valid JSON");
        scene["boards"][0]["common"]["cards"] = serde_json::json!([
            {
                "id": "practice_card",
                "label": "Practice",
                "source": { "kind": "practice", "id": practice_id },
                "summary": "Practice"
            }
        ]);
        scene["boards"][0]["minimumSelected"] = serde_json::json!(1);
        scene["boards"][0]["acceptedSelections"] = serde_json::json!([["practice_card"]]);
        scene.to_string()
    }

    #[test]
    fn chapter_loading_allows_non_practice_analysis_after_linear_scene() {
        let resources = acquisition_navigation_resources(
            "analysis-adjacency-validation",
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "Fixture chapter.",
                    "scenes": [
                        {"type": "linear", "file": "chapter_1/scene_0.json"},
                        {"type": "analysis", "file": "chapter_1/analysis_scene_2.json"}
                    ]
                }]
            }"#,
            &[
                ("scene_0.json", linear_scene_json("scene_0", "opening beat")),
                (
                    "analysis_scene_2.json",
                    analysis_scene_json("analysis_scene_2"),
                ),
            ],
        );

        GameEngine::new_started(resources.clone())
            .expect("analysis without practice cards may follow a linear scene");
        GameEngine::scene_navigation_index(resources.clone())
            .expect("navigation index should allow non-practice analysis after linear scene");
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn chapter_loading_rejects_practice_analysis_after_linear_scene() {
        let resources = acquisition_navigation_resources(
            "practice-analysis-adjacency-validation",
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "Fixture chapter.",
                    "scenes": [
                        {"type": "linear", "file": "chapter_1/scene_0.json"},
                        {"type": "analysis", "file": "chapter_1/analysis_scene_1.json"}
                    ]
                }]
            }"#,
            &[
                ("scene_0.json", linear_scene_json("scene_0", "opening beat")),
                (
                    "analysis_scene_1.json",
                    analysis_scene_with_practice_json("analysis_scene_1", "prac_1"),
                ),
            ],
        );

        let error = match GameEngine::new_started(resources.clone()) {
            Ok(_) => panic!("practice analysis must be preceded by an investigation"),
            Err(error) => error,
        };
        assert_eq!(error.code, "sceneValidationFailed");
        assert!(error.message.contains("practice"));
        assert!(error.message.contains("investigation"));
        assert!(error.message.contains("immediately"));
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn chapter_loading_rejects_practice_analysis_at_chapter_boundary() {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let resources = std::env::temp_dir().join(format!(
            "lyra-practice-analysis-chapter-boundary-{}-{}",
            std::process::id(),
            n,
        ));
        std::fs::create_dir_all(resources.join("chapter_1")).unwrap();
        std::fs::create_dir_all(resources.join("chapter_2")).unwrap();
        write_empty_story_catalog_and_content_manifest(&resources);
        std::fs::write(
            resources.join("chapters.json"),
            r#"{
                "chapters": [
                    {
                        "id": "chapter_1",
                        "title": "Chapter One",
                        "summary": "Chapter One",
                        "scenes": [{"type": "investigation", "file": "chapter_1/investigation_scene_0.json"}]
                    },
                    {
                        "id": "chapter_2",
                        "title": "Chapter Two",
                        "summary": "Chapter Two",
                        "scenes": [{"type": "analysis", "file": "chapter_2/analysis_scene_1.json"}]
                    }
                ]
            }"#,
        )
        .unwrap();
        std::fs::write(
            resources.join("chapter_1/investigation_scene_0.json"),
            investigation_scene_json(
                "investigation_scene_0",
                None,
                None,
                serde_json::json!("auto"),
            ),
        )
        .unwrap();
        std::fs::write(
            resources.join("chapter_2/analysis_scene_1.json"),
            analysis_scene_with_practice_json("analysis_scene_1", "prac_1"),
        )
        .unwrap();

        let error = match GameEngine::new_started(resources.clone()) {
            Ok(_) => panic!("practice analysis must not inherit an investigation across chapters"),
            Err(error) => error,
        };
        assert_eq!(error.code, "sceneValidationFailed");
        assert!(error.message.contains("start of this chapter"));
        let _ = std::fs::remove_dir_all(resources);
    }

    fn linear_scene_json(id: &str, text: &str) -> String {
        serde_json::json!({
            "type": "linear",
            "id": id,
            "title": id,
            "summary": id,
            "queue": [{ "kind": "line", "speaker": "A", "text": text }]
        })
        .to_string()
    }

    fn investigation_scene_json(
        id: &str,
        entry_evidence: Option<&str>,
        hotspot_evidence: Option<(&str, &str)>,
        outro_unlock: serde_json::Value,
    ) -> String {
        let entry_reveals = entry_evidence
            .into_iter()
            .map(|id| serde_json::json!({ "kind": "evidence", "id": id }))
            .collect::<Vec<_>>();
        let mut evidence_ids = entry_evidence.into_iter().collect::<Vec<_>>();
        let mut hotspots = vec![serde_json::json!({
            "id": "never",
            "label": "Never",
            "description": "Never",
            "status": "unlocked",
            "unlock": null,
            "reveals": [],
            "inspectDialogue": [],
            "onReexamine": null
        })];
        if let Some((hotspot_id, evidence_id)) = hotspot_evidence {
            evidence_ids.push(evidence_id);
            hotspots.push(serde_json::json!({
                "id": hotspot_id,
                "label": hotspot_id,
                "description": hotspot_id,
                "status": "unlocked",
                "unlock": null,
                "reveals": [{ "kind": "evidence", "id": evidence_id }],
                "inspectDialogue": [],
                "onReexamine": null
            }));
        }
        let evidence_manifest = evidence_ids
            .into_iter()
            .map(|id| {
                serde_json::json!({
                    "id": id,
                    "name": id,
                    "description": id,
                    "details": id,
                    "imageAssetId": null,
                    "onCollect": [],
                    "onReexamine": null
                })
            })
            .collect::<Vec<_>>();

        serde_json::json!({
            "type": "investigation",
            "id": id,
            "title": id,
            "summary": id,
            "intro": [],
            "sublocations": [{
                "id": "room",
                "label": "Room",
                "status": "unlocked",
                "unlock": null,
                "reveals": entry_reveals,
                "sceneTag": "room",
                "transitionDialogue": [],
                "hotspots": hotspots,
                "characters": []
            }],
            "evidenceManifest": evidence_manifest,
            "statementManifest": [],
            "outro": { "unlock": outro_unlock, "dialogue": [] }
        })
        .to_string()
    }

    fn investigation_scene_with_practice_json(id: &str, practice_id: &str) -> String {
        let mut scene: serde_json::Value = serde_json::from_str(&investigation_scene_json(
            id,
            None,
            None,
            serde_json::json!({
                "predicate": "hotspot_investigated",
                "id": "never"
            }),
        ))
        .expect("practice investigation fixture must be valid JSON");
        scene["sublocations"][0]["reveals"] = serde_json::json!([
            { "kind": "practice", "id": practice_id }
        ]);
        scene.to_string()
    }

    // Break caught: startup priming treats baseline inventory as command 1
    // even though no durable command has committed revision 1.
    #[test]
    fn startup_baseline_acquisition_keeps_revision_zero_and_events_empty() {
        let resources = acquisition_navigation_resources(
            "startup-baseline-acquisition",
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "First",
                    "scenes": [{
                        "type": "investigation",
                        "file": "chapter_1/investigation_scene_0.json"
                    }]
                }]
            }"#,
            &[(
                "investigation_scene_0.json",
                investigation_scene_json(
                    "investigation_scene_0",
                    Some("baseline_note"),
                    None,
                    serde_json::json!({
                        "predicate": "hotspot_investigated",
                        "id": "never"
                    }),
                ),
            )],
        );

        let engine = GameEngine::new_started(resources.clone()).unwrap();

        assert_eq!(engine.durable_revision, 0);
        assert!(engine.pending_acquisition_events.is_empty());
        assert_eq!(engine.inventory.evidence[0].id, "baseline_note");

        let _ = std::fs::remove_dir_all(resources);
    }

    // Break caught: nested queue exhaustion/navigation creates a fresh local
    // ordinal for each reveal-bearing scene instead of sharing the ordinal
    // owned by the outer checked command transaction.
    #[test]
    fn nested_navigation_acquisitions_share_checked_command_id_and_local_ordinal() {
        let resources = acquisition_navigation_resources(
            "nested-navigation-acquisition",
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "First",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" },
                        {
                            "type": "investigation",
                            "file": "chapter_1/investigation_scene_1.json"
                        },
                        {
                            "type": "investigation",
                            "file": "chapter_1/investigation_scene_2.json"
                        }
                    ]
                }]
            }"#,
            &[
                ("scene_0.json", linear_scene_json("scene_0", "advance")),
                (
                    "investigation_scene_1.json",
                    investigation_scene_json(
                        "investigation_scene_1",
                        Some("first_note"),
                        None,
                        serde_json::json!({
                            "predicate": "evidence_collected",
                            "id": "first_note"
                        }),
                    ),
                ),
                (
                    "investigation_scene_2.json",
                    investigation_scene_json(
                        "investigation_scene_2",
                        Some("second_note"),
                        None,
                        serde_json::json!({
                            "predicate": "hotspot_investigated",
                            "id": "never"
                        }),
                    ),
                ),
            ],
        );
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();

        let advanced = engine
            .advance_dialogue(token_from(&engine.view().unwrap()))
            .expect("one durable command should traverse both reveal scenes");

        assert_eq!(engine.durable_revision, 1);
        assert!(
            matches!(&advanced.scene, SceneView::Investigation { id, .. } if id == "investigation_scene_2"),
            "expected the command to land in the second investigation, got {:?}",
            advanced.scene
        );
        assert_eq!(
            engine
                .pending_acquisition_events
                .iter()
                .map(|event| {
                    (
                        event.id.as_str(),
                        event.record_id.as_str(),
                        event.created_by_command_id,
                        event.ordinal,
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                ("acq:1:0", "first_note", 1, 0),
                ("acq:1:1", "second_note", 1, 1),
            ]
        );

        let _ = std::fs::remove_dir_all(resources);
    }

    // Break caught: a scene jump resets inventory but leaves an event that
    // points at the removed record, causing commit-time presentation to fail
    // and roll back the entire jump.
    #[test]
    fn jump_clears_pending_acquisitions_with_inventory_in_one_transaction() {
        let resources = acquisition_navigation_resources(
            "jump-clears-acquisition",
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "First",
                    "scenes": [
                        {
                            "type": "investigation",
                            "file": "chapter_1/investigation_scene_0.json"
                        },
                        { "type": "linear", "file": "chapter_1/scene_1.json" }
                    ]
                }]
            }"#,
            &[
                (
                    "investigation_scene_0.json",
                    investigation_scene_json(
                        "investigation_scene_0",
                        None,
                        Some(("desk", "receipt")),
                        serde_json::json!({
                            "predicate": "hotspot_investigated",
                            "id": "never"
                        }),
                    ),
                ),
                ("scene_1.json", linear_scene_json("scene_1", "arrived")),
            ],
        );
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine.inspect_hotspot("desk").unwrap();
        assert_eq!(engine.pending_acquisition_events.len(), 1);

        let jumped = engine
            .jump_to_scene("chapter_1", "scene_1")
            .expect("jump should atomically reset acquisition state");

        assert!(jumped.inventory.evidence.is_empty());
        assert!(engine.pending_acquisition_events.is_empty());
        assert_eq!(engine.durable_revision, 2);

        let _ = std::fs::remove_dir_all(resources);
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
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
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

        // Debug-only grant seeds the inventory for testing every contradiction
        // but must not leave acquisition events queued (no spurious "evidence
        // acquired" popups for items the player never collected).
        assert!(
            engine.pending_acquisition_events.is_empty(),
            "debug grant must not leave acquisition events queued"
        );
        assert!(
            !engine.inventory.evidence.is_empty(),
            "debug grant must seed inventory evidence"
        );

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn story_state_persists_across_scene_and_chapter_navigation() {
        use crate::game::story::{AssertionOrigin, StoryEventBlockKind};

        let d = story_navigation_fixture_resources();
        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        engine
            .story_state
            .assert_fact(
                &engine.story_catalog,
                "persistent_fact",
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "scene_0".into(),
                    block_kind: StoryEventBlockKind::Hotspot,
                    block_id: "persistent_fact".into(),
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
        write_empty_story_catalog_and_content_manifest(&d);
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
            "summary": "Fixture scene summary.",
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
            "summary": "Fixture scene summary.",
            "queue": []
        }"#,
        )
        .unwrap();
        // Start with a valid packaged scene so new-game indexing succeeds.
        fs::write(
            chapter_1.join("scene_2.json"),
            r#"{
            "type": "linear",
            "id": "scene_2",
            "title": "Next",
            "summary": "Fixture scene summary.",
            "queue": []
        }"#,
        )
        .unwrap();

        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        write_mismatched_investigation_scene(&chapter_1.join("scene_2.json"));
        // Sanity: engine started on scene_0.
        let before = engine.view().unwrap();
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
        let after = engine.view().unwrap();
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
        write_empty_story_catalog_and_content_manifest(&d);
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
            "summary": "Fixture scene summary.",
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
            "summary": "Fixture scene summary.",
            "queue": []
        }"#,
        )
        .unwrap();
        // Start with a valid packaged scene so new-game indexing succeeds.
        fs::write(
            chapter_1.join("scene_2.json"),
            r#"{
            "type": "linear",
            "id": "scene_2",
            "title": "Next",
            "summary": "Fixture scene summary.",
            "queue": []
        }"#,
        )
        .unwrap();

        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        write_mismatched_investigation_scene(&chapter_1.join("scene_2.json"));
        // Startup records the first visible line ("start") into history.
        let started = engine.view().unwrap();
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
        let after = engine.view().unwrap();
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
        let catalog = StoryCatalog::load(&d).unwrap();

        let (index, runtime) =
            find_scene_runtime_by_id(&d, &catalog, &chapters[0], "investigation_scene_1", 42)
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
    fn duplicate_scene_ids_are_rejected_by_lookup_and_startup() {
        // Defense-in-depth: the navigation index build rejects duplicate scene
        // ids per chapter, but find_scene_runtime_by_id must also resolve
        // targets unambiguously so a lookup never silently lands on the
        // "first" of two same-id scenes. Build a chapter with two files
        // carrying the same id and assert both find_scene_runtime_by_id and
        // GameEngine::new_started surface a typed duplicateSceneTarget error.
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
        write_empty_story_catalog_and_content_manifest(&d);
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
            "summary": "Fixture scene summary.",
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
            "summary": "Fixture scene summary.",
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
            "summary": "Fixture scene summary.",
            "queue": [{ "kind": "line", "speaker": "A", "text": "b" }]
        }"#,
        )
        .unwrap();

        let chapters = load_chapter_manifests(&d).unwrap();
        let catalog = StoryCatalog::load(&d).unwrap();

        // The helper itself rejects the ambiguous target.
        let err = find_scene_runtime_by_id(&d, &catalog, &chapters[0], "dup_scene", 1)
            .expect_err("duplicate ids must be rejected");
        assert_eq!(err.code, "duplicateSceneTarget");

        // Startup indexes the complete package, so no engine can be created
        // with an ambiguous future navigation target.
        let err = GameEngine::new_started(d.clone())
            .err()
            .expect("startup must reject duplicate scene ids");
        assert_eq!(err.code, "duplicateSceneTarget");

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
                "summary": "Fixture scene summary.",
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
            &StoryCatalog::empty(),
            "chapter_1",
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

    // Break caught: analysis definitions must receive mutable runtime state
    // when normal navigation enters the compiled analysis pathway.
    #[test]
    fn load_scene_runtime_accepts_analysis_scene() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let resources = std::env::temp_dir().join(format!(
            "lyra-analysis-runtime-unsupported-test-{}-{n}",
            std::process::id(),
        ));
        let chapter_dir = resources.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("analysis_scene_1.json"),
            analysis_scene_json("analysis_scene_1"),
        )
        .unwrap();

        let runtime = load_scene_runtime(
            &resources,
            &StoryCatalog::empty(),
            "chapter_1",
            &SceneRef {
                scene_type: SceneType::Analysis,
                file: "chapter_1/analysis_scene_1.json".into(),
            },
            1,
        )
        .expect("analysis scenes should have mutable runtime state");

        assert!(matches!(runtime, SceneRuntime::Analysis(_)));
        let _ = fs::remove_dir_all(resources);
    }

    // Break caught: a normal navigation jump must activate the compiled
    // analysis runtime rather than retaining the legacy unsupported-scene
    // behavior.
    #[test]
    fn jump_to_analysis_activates_the_compiled_analysis_runtime() {
        let resources = acquisition_navigation_resources(
            "analysis-jump-transaction",
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "Fixture chapter.",
                    "scenes": [
                        {"type": "investigation", "file": "chapter_1/investigation_scene_0.json"},
                        {"type": "analysis", "file": "chapter_1/analysis_scene_1.json"}
                    ]
                }]
            }"#,
            &[
                (
                    "investigation_scene_0.json",
                    investigation_scene_json(
                        "investigation_scene_0",
                        Some("evidence_a"),
                        None,
                        serde_json::json!("auto"),
                    ),
                ),
                (
                    "analysis_scene_1.json",
                    analysis_scene_json("analysis_scene_1"),
                ),
            ],
        );
        let index = GameEngine::scene_navigation_index(resources.clone())
            .expect("analysis metadata should remain discoverable");
        assert_eq!(index.chapters[0].scenes[1].scene_type, SceneType::Analysis);
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        let view = engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should activate the compiled runtime");

        assert!(matches!(
            view.scene,
            SceneView::Analysis { ref id, .. } if id == "analysis_scene_1"
        ));
        assert!(matches!(
            view.mode,
            ModeView::Analysis { ref board_id, .. } if board_id == "board_1"
        ));
        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("analysis navigation must install AnalysisSceneState");
        };
        assert_eq!(scene.id(), "analysis_scene_1");
        assert_eq!(scene.title(), "Analysis");
        assert_eq!(
            scene.available_board_ids,
            ["board_1".to_owned()].into_iter().collect()
        );
        assert_eq!(scene.active_board_id.as_deref(), Some("board_1"));
        let SceneView::Analysis { visible_boards, .. } = view.scene else {
            panic!("analysis navigation must expose its threshold board");
        };
        assert!(matches!(
            visible_boards.as_slice(),
            [AnalysisBoardView::Threshold {
                id,
                minimum_selected: 0,
                ..
            }] if id == "board_1"
        ));
        let _ = std::fs::remove_dir_all(resources);
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
                "summary": "Fixture scene summary.",
                "queue": []
            }"#,
        )
        .unwrap();

        let err = load_scene_runtime(
            &d,
            &StoryCatalog::empty(),
            "chapter_1",
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

    // Break caught: scene_type_label could miss the Analysis arm and panic
    // when a manifest declares an analysis scene whose JSON is a different
    // kind (or vice versa).
    #[test]
    fn validate_manifest_scene_type_labels_analysis_in_a_type_mismatch() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-analysis-mismatch-test-{}-{n}",
            std::process::id()
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        // Manifest declares analysis, but the JSON is linear.
        fs::write(
            chapter_dir.join("analysis_scene_1.json"),
            r#"{
                "type": "linear",
                "id": "scene_0",
                "title": "Wrong Kind",
                "summary": "Fixture scene summary.",
                "queue": []
            }"#,
        )
        .unwrap();

        let err = load_scene_runtime(
            &d,
            &StoryCatalog::empty(),
            "chapter_1",
            &SceneRef {
                scene_type: SceneType::Analysis,
                file: "chapter_1/analysis_scene_1.json".into(),
            },
            1,
        )
        .unwrap_err();

        assert_eq!(err.code, "sceneValidationFailed");
        assert!(err.message.contains("declares analysis"));
        assert!(err.message.contains("contains linear"));
        let _ = fs::remove_dir_all(d);
    }

    // Break caught: scene_json_summary could miss the Analysis arm and panic
    // when capture/restore helpers project an analysis scene's summary.
    #[test]
    fn scene_json_summary_projects_the_analysis_scene_summary() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-analysis-summary-test-{}-{n}",
            std::process::id()
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("analysis_scene_1.json"),
            analysis_scene_json("analysis_scene_1"),
        )
        .unwrap();

        let json = load_scene_json_for_ref(
            &d,
            &StoryCatalog::empty(),
            "chapter_1",
            &SceneRef {
                scene_type: SceneType::Analysis,
                file: "chapter_1/analysis_scene_1.json".into(),
            },
        )
        .unwrap();

        assert_eq!(scene_json_summary(&json), "Immutable analysis fixture.");
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
        write_empty_story_catalog_and_content_manifest(&d);
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
                "summary": "Fixture scene summary.",
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
                "summary": "Fixture scene summary.",
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
                "summary": "Fixture scene summary.",
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
    fn scene_navigation_index_rejects_catalog_record_with_unmanifested_origin() {
        let resources = acquisition_navigation_resources(
            "scene-index-orphaned-catalog-origin",
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "First",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" }
                    ]
                }]
            }"#,
            &[("scene_0.json", linear_scene_json("scene_0", "start"))],
        );
        let catalog_path = resources.join("story_catalog.json");
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&catalog_path).unwrap()).unwrap();
        catalog["evidenceIndex"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "orphaned_record",
                "chapterId": "chapter_1",
                "sceneId": "missing_scene",
                "provenance": neutral_provenance_json()
            }));
        std::fs::write(&catalog_path, serde_json::to_vec_pretty(&catalog).unwrap()).unwrap();

        let error = GameEngine::scene_navigation_index(resources.clone()).unwrap_err();

        assert_eq!(error.code, "caseRecordDefinitionMismatch");
        let _ = std::fs::remove_dir_all(resources);
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
        write_empty_story_catalog_and_content_manifest(&d);
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
                "summary": "Fixture scene summary.",
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
        write_empty_story_catalog_and_content_manifest(&d);
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
            r#"{ "type": "linear", "id": "dup", "title": "A", "summary": "Fixture scene summary.", "queue": [] }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("scene_b.json"),
            r#"{ "type": "linear", "id": "dup", "title": "B", "summary": "Fixture scene summary.", "queue": [] }"#,
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
            r#"{ "type": "linear", "id": "scene_0", "title": "S", "summary": "Fixture scene summary.", "queue": [] }"#,
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
            r#"{ "type": "linear", "id": "scene_0", "title": "S", "summary": "Fixture scene summary.", "queue": [] }"#,
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

    // Break caught: grant_all_evidence_for_testing could panic on an analysis
    // scene instead of skipping it like a linear scene.
    #[test]
    fn grant_all_evidence_skips_analysis_scenes_without_panicking() {
        let resources = acquisition_navigation_resources(
            "analysis-grant-skip",
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "Fixture chapter.",
                    "scenes": [
                        {"type": "linear", "file": "chapter_1/scene_0.json"},
                        {"type": "investigation", "file": "chapter_1/investigation_scene_0.json"},
                        {"type": "analysis", "file": "chapter_1/analysis_scene_1.json"},
                        {"type": "interrogation", "file": "chapter_1/interrogation_scene_1.json"}
                    ]
                }]
            }"#,
            &[
                (
                    "scene_0.json",
                    r#"{
                        "type": "linear",
                        "id": "scene_0",
                        "title": "Opening",
                        "summary": "Opening fixture.",
                        "queue": [{"kind": "line", "speaker": "A", "text": "Opening."}]
                    }"#
                    .to_string(),
                ),
                (
                    "investigation_scene_0.json",
                    investigation_scene_json(
                        "investigation_scene_0",
                        None,
                        None,
                        serde_json::json!("auto"),
                    ),
                ),
                (
                    "analysis_scene_1.json",
                    analysis_scene_json("analysis_scene_1"),
                ),
                (
                    "interrogation_scene_1.json",
                    r#"{
                        "type": "interrogation",
                        "id": "interrogation_scene_1",
                        "title": "Interrogation",
                        "summary": "Interrogation fixture.",
                        "intro": [],
                        "phases": [{
                            "kind": "inquiry",
                            "id": "inquiry",
                            "label": "Inquiry",
                            "subject": {"id": "suspect", "name": "Suspect", "role": "Suspect", "bio": "Bio"},
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
                        "outro": {"unlock": "auto", "dialogue": []}
                    }"#
                    .to_string(),
                ),
            ],
        );
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();

        // Jumping to the interrogation scene triggers
        // grant_all_evidence_for_testing in debug builds, which iterates over
        // all scenes including the analysis scene. The analysis scene must be
        // skipped (continue) without panicking.
        let view = engine
            .jump_to_scene("chapter_1", "interrogation_scene_1")
            .expect("jump to interrogation should succeed with analysis scene in chapter");

        assert!(matches!(
            view.scene,
            SceneView::Interrogation { ref id, .. } if id == "interrogation_scene_1"
        ));
        let _ = std::fs::remove_dir_all(resources);
    }

    // --- Analysis command error path tests ---

    fn analysis_scene_with_cards_json(id: &str) -> String {
        format!(
            r#"{{
                "type": "analysis",
                "id": "{id}",
                "title": "Analysis",
                "summary": "Analysis with cards.",
                "assetRefs": [],
                "intro": [],
                "boards": [{{
                    "kind": "threshold",
                    "common": {{
                        "id": "board_1",
                        "label": "Board",
                        "prompt": "Select.",
                        "unlock": null,
                        "reveals": [],
                        "feedback": {{"incomplete": "Incomplete.", "incorrect": "Incorrect.", "hint": null}},
                        "cards": [
                            {{"id": "card_a", "label": "A", "source": {{"kind": "evidence", "id": "evidence_a"}}, "summary": "A"}},
                            {{"id": "card_b", "label": "B", "source": {{"kind": "practice", "id": "prac_b"}}, "summary": "B"}}
                        ],
                        "resultDialogue": [{{"kind": "action", "text": "Result"}}]
                    }},
                    "minimumSelected": 1,
                    "acceptedSelections": [["card_b"]]
                }}],
                "outro": []
            }}"#
        )
    }

    fn analysis_resources_with_cards(label: &str) -> std::path::PathBuf {
        let resources = acquisition_navigation_resources(
            label,
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "Fixture chapter.",
                    "scenes": [
                        {"type": "investigation", "file": "chapter_1/investigation_scene_0.json"},
                        {"type": "analysis", "file": "chapter_1/analysis_scene_1.json"}
                    ]
                }]
            }"#,
            &[
                (
                    "investigation_scene_0.json",
                    investigation_scene_with_practice_json("investigation_scene_0", "prac_b"),
                ),
                (
                    "analysis_scene_1.json",
                    analysis_scene_with_cards_json("analysis_scene_1"),
                ),
            ],
        );
        // Update story catalog with analysis scene/board entries
        let catalog_path = resources.join("story_catalog.json");
        let mut catalog: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&catalog_path).expect("catalog must be readable"),
        )
        .expect("catalog must be valid JSON");
        catalog["analysisScenes"] = serde_json::json!([
            {"chapterId": "chapter_1", "sceneId": "analysis_scene_1"}
        ]);
        catalog["analysisBoards"] = serde_json::json!([
            {"chapterId": "chapter_1", "sceneId": "analysis_scene_1", "boardId": "board_1"}
        ]);
        std::fs::write(&catalog_path, serde_json::to_vec_pretty(&catalog).unwrap()).unwrap();
        resources
    }

    #[test]
    fn direct_investigation_to_analysis_transfers_revealed_card_and_accepts_submission() {
        let resources = analysis_resources_with_cards("analysis-direct-practice-transfer");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();

        let view = engine
            .inspect_hotspot("never")
            .expect("normal hotspot progression should enter analysis");
        assert!(matches!(view.scene, SceneView::Analysis { .. }));
        assert!(
            matches!(view.mode, ModeView::Analysis { ref board_id, .. } if board_id == "board_1")
        );
        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("direct navigation should land in analysis");
        };
        assert!(scene.drafts.contains_key("board_1"));

        engine
            .update_analysis_draft(
                engine.analysis_action_token().unwrap(),
                crate::game::analysis::AnalysisDraft::Threshold {
                    selected_card_ids: ["card_b".to_owned()].into_iter().collect(),
                },
            )
            .expect("the transferred practice card should be selectable");
        let submitted = engine
            .submit_analysis_board(engine.analysis_action_token().unwrap())
            .expect("the transferred practice card should be accepted");
        let ModeView::Dialogue { current, .. } = &submitted.mode else {
            panic!("accepted submission should open result dialogue");
        };
        assert!(matches!(
            current,
            DialogueItem::Action { text } if text == "Result"
        ));
        let SceneRuntime::Analysis(_scene) = &engine.scene else {
            panic!("submission should remain in analysis while result dialogue plays");
        };
        assert!(engine.story_state.analysis_board_completed(
            "chapter_1",
            "analysis_scene_1",
            "board_1"
        ));
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn select_analysis_board_accepts_any_available_target() {
        let resources = analysis_resources_with_two_unlocked_boards("analysis-select-any-board");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        let token = crate::game::analysis::AnalysisActionToken {
            scene_id: "analysis_scene_1".into(),
            active_board_id: Some("board_1".into()),
            durable_revision: engine.durable_revision(),
        };

        engine
            .select_analysis_board(token, "board_2".into())
            .expect("every available board should be selectable");

        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("expected analysis scene");
        };
        assert_eq!(scene.active_board_id.as_deref(), Some("board_2"));
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn selecting_current_analysis_board_is_unchanged_without_revision_or_history() {
        let resources = analysis_resources_with_two_unlocked_boards("analysis-select-current");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        let before_scene = format!("{:?}", engine.scene);
        let before_history = engine.history.entries().to_vec();
        let before_revision = engine.durable_revision();

        let view = engine
            .select_analysis_board(engine.analysis_action_token().unwrap(), "board_1".into())
            .expect("selecting the current board should succeed");

        assert!(matches!(
            view.mode,
            ModeView::Analysis { ref board_id, .. } if board_id == "board_1"
        ));
        assert_eq!(engine.durable_revision(), before_revision);
        assert_eq!(format!("{:?}", engine.scene), before_scene);
        assert_eq!(engine.history.entries(), before_history.as_slice());
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn stale_analysis_tokens_fail_without_revision_or_state_side_effects() {
        let resources = analysis_resources_with_cards("analysis-stale-token");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        let baseline_scene = format!("{:?}", engine.scene);
        let baseline_history = engine.history.entries().to_vec();
        let baseline_events = engine.pending_acquisition_events.clone();
        let baseline_revision = engine.durable_revision();

        let mut stale_scene = engine.analysis_action_token().unwrap();
        stale_scene.scene_id = "other_scene".into();
        let error = engine
            .select_analysis_board(stale_scene, "board_1".into())
            .expect_err("stale scene token must be rejected");
        assert_eq!(error.code, "staleAnalysisAction");

        let mut stale_active = engine.analysis_action_token().unwrap();
        stale_active.active_board_id = Some("other_board".into());
        let error = engine
            .update_analysis_draft(
                stale_active,
                AnalysisDraft::Threshold {
                    selected_card_ids: ["card_b".to_owned()].into_iter().collect(),
                },
            )
            .expect_err("stale active-board token must be rejected");
        assert_eq!(error.code, "staleAnalysisAction");

        let mut stale_revision = engine.analysis_action_token().unwrap();
        stale_revision.durable_revision += 1;
        let error = engine
            .submit_analysis_board(stale_revision)
            .expect_err("stale revision token must be rejected");
        assert_eq!(error.code, "staleAnalysisAction");

        assert_eq!(engine.durable_revision(), baseline_revision);
        assert_eq!(format!("{:?}", engine.scene), baseline_scene);
        assert_eq!(engine.history.entries(), baseline_history.as_slice());
        assert_eq!(engine.pending_acquisition_events, baseline_events);
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn incomplete_and_wrong_analysis_submit_only_replace_failure_feedback() {
        let resources = analysis_resources_with_cards("analysis-submit-feedback");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        let empty_draft = match &engine.scene {
            SceneRuntime::Analysis(scene) => scene.drafts["board_1"].clone(),
            other => panic!("expected analysis scene, got {other:?}"),
        };

        let first_revision = engine.durable_revision();
        engine
            .submit_analysis_board(engine.analysis_action_token().unwrap())
            .expect("incomplete submit should return feedback");
        assert_eq!(engine.durable_revision(), first_revision + 1);
        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("expected analysis scene");
        };
        assert_eq!(scene.drafts["board_1"], empty_draft);
        assert_eq!(
            scene.feedback_by_board_id.get("board_1"),
            Some(&crate::game::analysis::AnalysisFeedbackState::Incomplete)
        );
        assert!(scene.pending_queue.is_none());
        assert!(!engine.story_state.analysis_board_completed(
            "chapter_1",
            "analysis_scene_1",
            "board_1"
        ));

        engine
            .update_analysis_draft(
                engine.analysis_action_token().unwrap(),
                AnalysisDraft::Threshold {
                    selected_card_ids: ["card_a".to_owned()].into_iter().collect(),
                },
            )
            .expect("wrong draft should be accepted for evaluation");
        engine
            .submit_analysis_board(engine.analysis_action_token().unwrap())
            .expect("wrong complete submit should return feedback");
        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("expected analysis scene");
        };
        assert_eq!(
            scene.drafts["board_1"],
            AnalysisDraft::Threshold {
                selected_card_ids: ["card_a".to_owned()].into_iter().collect()
            }
        );
        assert_eq!(
            scene.feedback_by_board_id.get("board_1"),
            Some(&crate::game::analysis::AnalysisFeedbackState::Incorrect)
        );
        assert!(scene.pending_queue.is_none());
        assert!(!engine.story_state.analysis_board_completed(
            "chapter_1",
            "analysis_scene_1",
            "board_1"
        ));
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn accepted_analysis_board_can_reopen_read_only_without_replaying_effects() {
        let resources = analysis_resources_with_two_unlocked_boards("analysis-read-only-reopen");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        engine
            .update_analysis_draft(
                engine.analysis_action_token().unwrap(),
                AnalysisDraft::Threshold {
                    selected_card_ids: ["card_b".to_owned()].into_iter().collect(),
                },
            )
            .expect("board one draft should update");
        let result = engine
            .submit_analysis_board(engine.analysis_action_token().unwrap())
            .expect("board one should complete");
        let ModeView::Dialogue { queue_token, .. } = result.mode else {
            panic!("board one should install result dialogue");
        };
        engine
            .advance_dialogue(queue_token)
            .expect("board one result should advance to board two");
        let token = engine.analysis_action_token().unwrap();
        engine
            .select_analysis_board(token, "board_1".into())
            .expect("completed board should be selectable for read-only review");
        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("expected analysis scene");
        };
        assert_eq!(scene.active_board_id.as_deref(), Some("board_1"));
        let error = engine
            .submit_analysis_board(engine.analysis_action_token().unwrap())
            .expect_err("completed board must remain read-only");
        assert_eq!(error.code, "analysisBoardCompleted");
        assert!(engine.story_state.analysis_board_completed(
            "chapter_1",
            "analysis_scene_1",
            "board_1"
        ));
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn accepted_analysis_submit_recomputes_availability_from_story_reveal() {
        let resources = analysis_resources_with_reveal_unlock("analysis-submit-unlock-refresh");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("expected analysis scene");
        };
        assert!(scene.available_board_ids.contains("board_1"));
        assert!(!scene.available_board_ids.contains("board_2"));

        engine
            .update_analysis_draft(
                engine.analysis_action_token().unwrap(),
                AnalysisDraft::Threshold {
                    selected_card_ids: ["card_b".to_owned()].into_iter().collect(),
                },
            )
            .expect("board one draft should update");
        engine
            .submit_analysis_board(engine.analysis_action_token().unwrap())
            .expect("board one should reveal board two");

        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("expected analysis scene");
        };
        assert!(scene.available_board_ids.contains("board_1"));
        assert!(scene.available_board_ids.contains("board_2"));
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn invalid_analysis_reveal_rolls_back_completion_draft_feedback_and_dialogue() {
        let resources = analysis_resources_with_cards("analysis-invalid-reveal-rollback");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        let SceneRuntime::Analysis(scene) = &mut engine.scene else {
            panic!("expected analysis scene");
        };
        let Some(crate::game::schema::AnalysisBoardJson::Threshold { common, .. }) =
            scene.def.boards.first_mut()
        else {
            panic!("expected threshold board");
        };
        common
            .reveals
            .push(crate::game::schema::StoryRevealTarget::AssertFact {
                fact_id: "missing_fact".into(),
            });

        engine
            .update_analysis_draft(
                engine.analysis_action_token().unwrap(),
                AnalysisDraft::Threshold {
                    selected_card_ids: ["card_b".to_owned()].into_iter().collect(),
                },
            )
            .expect("correct draft should update before reveal failure");
        let before_scene = format!("{:?}", engine.scene);
        let before_story = engine.story_state.clone();
        let before_revision = engine.durable_revision();
        let before_history = engine.history.entries().to_vec();

        let error = engine
            .submit_analysis_board(engine.analysis_action_token().unwrap())
            .expect_err("invalid reveal must fail atomically");
        assert_eq!(error.code, "unknownStoryFact");
        assert_eq!(format!("{:?}", engine.scene), before_scene);
        assert_eq!(engine.story_state, before_story);
        assert_eq!(engine.durable_revision(), before_revision);
        assert_eq!(engine.history.entries(), before_history.as_slice());
        assert!(!engine.story_state.analysis_board_completed(
            "chapter_1",
            "analysis_scene_1",
            "board_1"
        ));
        assert!(engine.current_queue_token().is_none());
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn update_analysis_classify_replaces_partial_draft_and_clears_feedback() {
        let resources = analysis_resources_with_cards("analysis-update-classify");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        replace_active_analysis_board_for_command_test(
            &mut engine,
            serde_json::from_value(serde_json::json!({
                "kind": "classify",
                "common": {
                    "id": "board_classify",
                    "label": "Classify",
                    "prompt": "Classify cards.",
                    "unlock": null,
                    "reveals": [],
                    "feedback": {"incomplete": "Incomplete.", "incorrect": "Incorrect.", "hint": null},
                    "cards": [
                        {"id": "card_a", "label": "A", "source": {"kind": "practice", "id": "practice_a"}, "summary": "A"},
                        {"id": "card_b", "label": "B", "source": {"kind": "practice", "id": "practice_b"}, "summary": "B"}
                    ],
                    "resultDialogue": []
                },
                "groups": [
                    {"id": "group_a", "label": "Group A", "description": "A"},
                    {"id": "group_b", "label": "Group B", "description": "B"}
                ],
                "acceptedGroupByCard": {"card_a": "group_a", "card_b": "group_b"}
            }))
            .unwrap(),
        );

        let first_draft: std::collections::BTreeMap<String, String> =
            [("card_a".to_owned(), "group_a".to_owned())]
                .into_iter()
                .collect();
        engine
            .update_analysis_draft(
                engine.analysis_action_token().unwrap(),
                AnalysisDraft::Classify {
                    group_by_card: first_draft.clone(),
                },
            )
            .expect("partial classify draft should replace the empty draft");
        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("expected analysis scene");
        };
        assert_eq!(
            scene.drafts["board_classify"],
            AnalysisDraft::Classify {
                group_by_card: first_draft,
            }
        );
        assert!(scene.feedback_by_board_id.is_empty());

        let replacement_draft: std::collections::BTreeMap<String, String> =
            [("card_b".to_owned(), "group_b".to_owned())]
                .into_iter()
                .collect();
        engine
            .update_analysis_draft(
                engine.analysis_action_token().unwrap(),
                AnalysisDraft::Classify {
                    group_by_card: replacement_draft.clone(),
                },
            )
            .expect("a later classify update should replace the whole draft");
        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("expected analysis scene");
        };
        assert_eq!(
            scene.drafts["board_classify"],
            AnalysisDraft::Classify {
                group_by_card: replacement_draft,
            }
        );
        assert!(scene.feedback_by_board_id.is_empty());
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn update_analysis_order_replaces_partial_draft_and_clears_feedback() {
        let resources = analysis_resources_with_cards("analysis-update-order");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        replace_active_analysis_board_for_command_test(
            &mut engine,
            serde_json::from_value(serde_json::json!({
                "kind": "order",
                "common": {
                    "id": "board_order",
                    "label": "Order",
                    "prompt": "Order cards.",
                    "unlock": null,
                    "reveals": [],
                    "feedback": {"incomplete": "Incomplete.", "incorrect": "Incorrect.", "hint": null},
                    "cards": [
                        {"id": "card_a", "label": "A", "source": {"kind": "practice", "id": "practice_a"}, "summary": "A"},
                        {"id": "card_b", "label": "B", "source": {"kind": "practice", "id": "practice_b"}, "summary": "B"}
                    ],
                    "resultDialogue": []
                },
                "acceptedOrder": ["card_a", "card_b"],
                "fixedAnchors": [{"cardId": "card_a", "position": 1}]
            }))
            .unwrap(),
        );

        engine
            .update_analysis_draft(
                engine.analysis_action_token().unwrap(),
                AnalysisDraft::Order {
                    card_ids: vec!["card_a".into()],
                },
            )
            .expect("partial order draft should replace the empty draft");
        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("expected analysis scene");
        };
        assert_eq!(
            scene.drafts["board_order"],
            AnalysisDraft::Order {
                card_ids: vec!["card_a".into()],
            }
        );
        assert!(scene.feedback_by_board_id.is_empty());

        engine
            .update_analysis_draft(
                engine.analysis_action_token().unwrap(),
                AnalysisDraft::Order {
                    card_ids: vec!["card_a".into(), "card_b".into()],
                },
            )
            .expect("a later order update should replace the whole draft");
        let SceneRuntime::Analysis(scene) = &engine.scene else {
            panic!("expected analysis scene");
        };
        assert_eq!(
            scene.drafts["board_order"],
            AnalysisDraft::Order {
                card_ids: vec!["card_a".into(), "card_b".into()],
            }
        );
        assert!(scene.feedback_by_board_id.is_empty());
        let _ = std::fs::remove_dir_all(resources);
    }

    fn add_evidence_to_inventory(engine: &mut GameEngine, id: &str) {
        use crate::game::provenance::CaseRecordProvenance;
        use crate::game::state::EvidenceRecord;
        engine.inventory.evidence.push(EvidenceRecord {
            id: id.into(),
            name: id.into(),
            description: "".into(),
            details: "".into(),
            provenance: CaseRecordProvenance::default(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "scene_0".into(),
        });
    }

    fn analysis_scene_with_two_unlocked_boards_json(id: &str) -> String {
        // Both boards have null unlock, so both are unlocked. board_1 is the
        // initial authored-order focus; board_2 is also available and can be
        // selected directly. Both use practice cards so availability can be
        // seeded directly on the analysis scene state without going through
        // inventory catalog validation.
        format!(
            r#"{{
                "type": "analysis",
                "id": "{id}",
                "title": "Analysis",
                "summary": "Two unlocked boards.",
                "assetRefs": [],
                "intro": [],
                "boards": [
                    {{
                        "kind": "threshold",
                        "common": {{
                            "id": "board_1",
                            "label": "Board One",
                            "prompt": "Select.",
                            "unlock": null,
                            "reveals": [],
                            "feedback": {{"incomplete": "Incomplete.", "incorrect": "Incorrect.", "hint": null}},
                            "cards": [
                                {{"id": "card_b", "label": "B", "source": {{"kind": "practice", "id": "prac_b"}}, "summary": "B"}}
                            ],
                            "resultDialogue": [{{"kind": "action", "text": "Result One"}}]
                        }},
                        "minimumSelected": 1,
                        "acceptedSelections": [["card_b"]]
                    }},
                    {{
                        "kind": "threshold",
                        "common": {{
                            "id": "board_2",
                            "label": "Board Two",
                            "prompt": "Select.",
                            "unlock": null,
                            "reveals": [],
                            "feedback": {{"incomplete": "Incomplete.", "incorrect": "Incorrect.", "hint": null}},
                            "cards": [
                                {{"id": "card_b2", "label": "B2", "source": {{"kind": "practice", "id": "prac_b2"}}, "summary": "B2"}}
                            ],
                            "resultDialogue": [{{"kind": "action", "text": "Result Two"}}]
                        }},
                        "minimumSelected": 1,
                        "acceptedSelections": [["card_b2"]]
                    }}
                ],
                "outro": []
            }}"#
        )
    }

    fn analysis_resources_with_two_unlocked_boards(label: &str) -> std::path::PathBuf {
        let resources = acquisition_navigation_resources(
            label,
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "Fixture chapter.",
                    "scenes": [
                        {"type": "investigation", "file": "chapter_1/investigation_scene_0.json"},
                        {"type": "analysis", "file": "chapter_1/analysis_scene_1.json"}
                    ]
                }]
            }"#,
            &[
                (
                    "investigation_scene_0.json",
                    investigation_scene_with_practice_json("investigation_scene_0", "prac_b"),
                ),
                (
                    "analysis_scene_1.json",
                    analysis_scene_with_two_unlocked_boards_json("analysis_scene_1"),
                ),
            ],
        );
        // Register both analysis boards in the catalog so the engine accepts
        // the scene adjacency/catalog validation.
        let catalog_path = resources.join("story_catalog.json");
        let mut catalog: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&catalog_path).expect("catalog must be readable"),
        )
        .expect("catalog must be valid JSON");
        catalog["analysisScenes"] = serde_json::json!([
            {"chapterId": "chapter_1", "sceneId": "analysis_scene_1"}
        ]);
        catalog["analysisBoards"] = serde_json::json!([
            {"chapterId": "chapter_1", "sceneId": "analysis_scene_1", "boardId": "board_1"},
            {"chapterId": "chapter_1", "sceneId": "analysis_scene_1", "boardId": "board_2"}
        ]);
        std::fs::write(&catalog_path, serde_json::to_vec_pretty(&catalog).unwrap()).unwrap();
        resources
    }

    fn analysis_resources_with_reveal_unlock(label: &str) -> std::path::PathBuf {
        let resources = analysis_resources_with_two_unlocked_boards(label);
        let scene_path = resources.join("chapter_1/analysis_scene_1.json");
        let mut scene: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&scene_path).expect("analysis scene must be readable"),
        )
        .expect("analysis scene must be valid JSON");
        scene["boards"][0]["common"]["reveals"] = serde_json::json!([{
            "kind": "assertFact",
            "factId": "board_two_unlocked"
        }]);
        scene["boards"][1]["common"]["unlock"] = serde_json::json!({
            "predicate": "fact_asserted",
            "id": "board_two_unlocked"
        });
        std::fs::write(&scene_path, serde_json::to_vec_pretty(&scene).unwrap()).unwrap();

        let catalog_path = resources.join("story_catalog.json");
        let mut catalog: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&catalog_path).expect("catalog must be readable"),
        )
        .expect("catalog must be valid JSON");
        catalog["facts"] = serde_json::json!([{
            "id": "board_two_unlocked",
            "label": "Board two unlocked",
            "summary": "The first board unlocks the second board.",
            "details": "Analysis command fixture.",
            "category": "procedure"
        }]);
        std::fs::write(&catalog_path, serde_json::to_vec_pretty(&catalog).unwrap()).unwrap();
        resources
    }

    fn replace_active_analysis_board_for_command_test(
        engine: &mut GameEngine,
        board: crate::game::schema::AnalysisBoardJson,
    ) {
        let board_id = board.common().id.clone();
        let empty_draft =
            crate::game::scenes::analysis::AnalysisSceneState::empty_draft_for_board(&board);
        let SceneRuntime::Analysis(scene) = &mut engine.scene else {
            panic!("expected analysis scene");
        };
        scene.def.boards = vec![board];
        scene.available_board_ids = [board_id.clone()].into_iter().collect();
        scene.active_board_id = Some(board_id.clone());
        scene.drafts = [(board_id.clone(), empty_draft)].into_iter().collect();
        scene
            .feedback_by_board_id
            .insert(board_id, AnalysisFeedbackState::Incorrect);
    }

    #[test]
    fn analysis_mode_view_shows_board_when_unlocked() {
        let resources = analysis_resources_with_cards("analysis-mode-view");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        add_evidence_to_inventory(&mut engine, "evidence_a");
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        let view = engine.view().expect("view should succeed");
        assert!(matches!(
            view.mode,
            ModeView::Analysis { ref board_id, .. } if board_id == "board_1"
        ));
        assert!(matches!(
            view.scene,
            SceneView::Analysis { ref id, .. } if id == "analysis_scene_1"
        ));
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn analysis_public_view_projects_all_board_kinds_without_answer_keys() {
        let resources = analysis_resources_with_cards("analysis-public-view");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");

        let mut definition_value: serde_json::Value =
            serde_json::from_str(include_str!("test_fixtures/analysis_scene_8_5.json"))
                .expect("analysis fixture should deserialize");
        definition_value
            .as_object_mut()
            .expect("analysis fixture should be an object")
            .remove("type");
        let definition: crate::game::schema::AnalysisSceneJson =
            serde_json::from_value(definition_value).expect("analysis fixture should deserialize");
        let SceneRuntime::Analysis(scene) = &mut engine.scene else {
            panic!("expected analysis scene");
        };
        scene.def = definition;
        scene.available_board_ids = scene
            .def
            .boards
            .iter()
            .map(|board| board.common().id.clone())
            .collect();
        scene.active_board_id = Some("evidence_packages".into());
        scene.drafts = scene
            .def
            .boards
            .iter()
            .map(|board| {
                (
                    board.common().id.clone(),
                    crate::game::scenes::analysis::AnalysisSceneState::empty_draft_for_board(board),
                )
            })
            .collect();
        scene
            .feedback_by_board_id
            .insert("evidence_packages".into(), AnalysisFeedbackState::Incorrect);

        let view = engine.view().expect("analysis view should serialize");
        let SceneView::Analysis {
            action_token,
            active_board_id,
            visible_boards,
            ..
        } = &view.scene
        else {
            panic!("expected analysis scene view");
        };
        assert_eq!(active_board_id.as_deref(), Some("evidence_packages"));
        assert_eq!(
            action_token.active_board_id.as_deref(),
            Some("evidence_packages")
        );
        assert!(matches!(
            visible_boards.as_slice(),
            [
                AnalysisBoardView::Classify { groups, feedback: Some(feedback), .. },
                AnalysisBoardView::Order { fixed_anchors, .. },
                AnalysisBoardView::Threshold { minimum_selected: 2, .. }
            ] if groups.len() == 2
                && fixed_anchors.len() == 1
                && feedback.state == AnalysisFeedbackState::Incorrect
                && feedback.message == "至少有一張卡被放進錯誤命題。"
        ));

        let serialized = serde_json::to_string(&view).expect("view should serialize");
        assert!(!serialized.contains("acceptedGroupByCard"));
        assert!(!serialized.contains("acceptedOrder"));
        assert!(!serialized.contains("acceptedSelections"));
        assert!(serialized.contains("actionToken"));
        assert!(serialized.contains("fixedAnchors"));
        assert!(serialized.contains("minimumSelected"));
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn reexamine_evidence_rejects_analysis_mode() {
        let resources = analysis_resources_with_cards("analysis-reexamine-evidence");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        add_evidence_to_inventory(&mut engine, "evidence_a");
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        let error = engine
            .reexamine_evidence("evidence_a")
            .expect_err("reexamine_evidence must reject analysis mode");
        assert_eq!(error.code, "wrongMode");
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn reexamine_statement_rejects_analysis_mode() {
        let resources = analysis_resources_with_cards("analysis-reexamine-statement");
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        add_evidence_to_inventory(&mut engine, "evidence_a");
        engine
            .jump_to_scene("chapter_1", "analysis_scene_1")
            .expect("analysis jump should succeed");
        let error = engine
            .reexamine_statement("stmt_a")
            .expect_err("reexamine_statement must reject analysis mode");
        assert_eq!(error.code, "wrongMode");
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn load_chapter_manifests_rejects_empty_chapters() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-empty-chapters-test-{}-{}",
            std::process::id(),
            n
        ));
        fs::create_dir_all(&d).unwrap();
        write_empty_story_catalog_and_content_manifest(&d);
        fs::write(d.join("chapters.json"), r#"{"chapters": []}"#).unwrap();

        let err = load_chapter_manifests(&d).expect_err("empty chapters should be rejected");
        assert_eq!(err.code, "chapterLoadFailed");
        assert!(err.message.contains("no chapters"));

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn scene_navigation_index_from_chapters_rejects_duplicate_chapter_id_directly() {
        // load_chapter_manifests rejects duplicate chapter ids at load time,
        // so GameEngine::scene_navigation_index never reaches the duplicate
        // check inside scene_navigation_index_from_chapters. Call the inner
        // function directly with hand-built ChapterManifests to exercise that
        // defense-in-depth layer.
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-nav-index-dup-direct-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        write_empty_story_catalog_and_content_manifest(&d);
        fs::write(
            chapter_dir.join("scene_0.json"),
            r#"{ "type": "linear", "id": "scene_0", "title": "S", "summary": "Fixture scene summary.", "queue": [] }"#,
        )
        .unwrap();

        let catalog = StoryCatalog::load(&d).unwrap();
        let chapters = vec![
            ChapterManifest {
                id: "chapter_1".into(),
                title: "First".into(),
                summary: "First".into(),
                scenes: vec![SceneRef {
                    scene_type: SceneType::Linear,
                    file: "chapter_1/scene_0.json".into(),
                }],
            },
            ChapterManifest {
                id: "chapter_1".into(),
                title: "Second".into(),
                summary: "Second".into(),
                scenes: vec![SceneRef {
                    scene_type: SceneType::Linear,
                    file: "chapter_1/scene_0.json".into(),
                }],
            },
        ];

        let err = scene_navigation_index_from_chapters(&d, &catalog, &chapters)
            .expect_err("duplicate chapter id should be rejected");
        assert_eq!(err.code, "chapterLoadFailed");
        assert!(err.message.contains("duplicate chapter id \"chapter_1\""));

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn acquisition_navigation_resources_skips_scenes_without_id() {
        // The helper builds an evidence index from scene JSON "id" fields.
        // Scenes without an "id" are skipped (continue) rather than panicking.
        let resources = acquisition_navigation_resources(
            "skip-no-id",
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "Fixture chapter.",
                    "scenes": [
                        {"type": "linear", "file": "chapter_1/scene_0.json"}
                    ]
                }]
            }"#,
            &[
                (
                    "scene_0.json",
                    r#"{ "type": "linear", "id": "scene_0", "title": "S", "summary": "Fixture scene summary.", "queue": [] }"#.to_string(),
                ),
                (
                    "no_id.json",
                    r#"{ "type": "linear", "title": "No ID", "summary": "Fixture scene summary.", "queue": [] }"#.to_string(),
                ),
            ],
        );
        // Helper succeeded despite the scene without "id".
        assert!(resources.join("chapters.json").exists());
        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn grant_all_evidence_for_testing_skips_unloadable_scenes() {
        // grant_all_evidence_for_testing iterates all chapters and scenes when
        // jumping to an interrogation scene in debug builds. Scenes that fail
        // to load are silently skipped (continue). find_scene_runtime_by_id
        // only loads scenes from the target chapter, so a missing file in a
        // *different* chapter does not block the jump but does exercise the
        // grant's defensive continue path.
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-grant-skip-unloadable-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_1 = d.join("chapter_1");
        let chapter_2 = d.join("chapter_2");
        fs::create_dir_all(&chapter_1).unwrap();
        fs::create_dir_all(&chapter_2).unwrap();
        write_empty_story_catalog_and_content_manifest(&d);
        fs::write(
            d.join("story_catalog.json"),
            r#"{
  "schemaVersion": 2,
  "facts": [],
  "questions": [],
  "objectives": [],
  "authorizations": [],
  "sourceGroups": [],
  "evidenceIndex": [{
    "id": "ch2_evidence",
    "chapterId": "chapter_2",
    "sceneId": "investigation_ch2",
    "provenance": {
      "sourceKind": "unspecified",
      "representationLayer": "none",
      "proceduralStatus": "unspecified",
      "completeness": "unspecified",
      "confidence": "unspecified",
      "sourceGroupId": null,
      "sourceLabel": null,
      "proofCapabilities": [],
      "supersedesRecordId": null
    }
  }],
  "statementsIndex": []
}"#,
        )
        .unwrap();
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
                        { "type": "interrogation", "file": "chapter_1/interrogation_1.json" }
                    ]
                },
                {
                    "id": "chapter_2",
                    "title": "Chapter Two",
                    "summary": "Second",
                    "scenes": [
                        { "type": "investigation", "file": "chapter_2/investigation_ch2.json" }
                    ]
                }
            ]
        }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("scene_0.json"),
            r#"{ "type": "linear", "id": "scene_0", "title": "Opening", "summary": "Fixture scene summary.", "queue": [{ "kind": "line", "speaker": "A", "text": "start" }] }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("interrogation_1.json"),
            r#"{
                "type": "interrogation",
                "id": "interrogation_1",
                "title": "Interrogation",
                "summary": "Fixture scene summary.",
                "intro": [],
                "phases": [{
                    "kind": "inquiry",
                    "id": "phase_1",
                    "label": "Phase 1",
                    "subject": { "id": "witness", "name": "Witness", "role": "Witness", "bio": "Quiet." },
                    "required": true,
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [],
                    "sceneTag": "interrogation room",
                    "backgroundAssetId": "background.interrogation",
                    "entryDialogue": [],
                    "complete": "auto",
                    "questions": [{
                        "id": "q1",
                        "label": "Q1",
                        "status": "unlocked",
                        "required": true,
                        "unlock": null,
                        "reveals": [],
                        "testimony": {
                            "onLoop": [{ "kind": "line", "speaker": "witness", "text": "loop" }],
                            "lines": [{
                                "id": "l1",
                                "label": "Line 1",
                                "content": [{ "kind": "line", "speaker": "witness", "text": "testimony" }],
                                "contradiction": null
                            }]
                        }
                    }]
                }],
                "evidenceManifest": [],
                "statementManifest": [],
                "outro": { "unlock": "auto", "dialogue": [] }
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_2.join("investigation_ch2.json"),
            r#"{
                "type": "investigation",
                "id": "investigation_ch2",
                "title": "Chapter 2 Investigation",
                "summary": "Fixture scene summary.",
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
                "evidenceManifest": [{
                    "id": "ch2_evidence",
                    "name": "Ch2 Evidence",
                    "description": "d",
                    "details": "d",
                    "imageAssetId": null,
                    "onCollect": [],
                    "onReexamine": null
                }],
                "statementManifest": [],
                "outro": { "unlock": "auto", "dialogue": [] }
            }"#,
        )
        .unwrap();

        let mut engine = GameEngine::new_started(d.clone()).unwrap();

        // Delete the chapter 2 investigation scene so grant_all_evidence_for_testing
        // cannot load it. The engine already started successfully; the file
        // is only needed again during the grant loop. find_scene_runtime_by_id
        // only loads chapter 1 scenes, so the jump is unaffected.
        std::fs::remove_file(d.join("chapter_2/investigation_ch2.json")).unwrap();

        // Jump to the interrogation scene. In debug builds this triggers
        // grant_all_evidence_for_testing, which iterates all chapters and
        // skips the missing chapter 2 scene without panicking.
        let view = engine
            .jump_to_scene("chapter_1", "interrogation_1")
            .expect("jump to interrogation should succeed despite missing chapter 2 scene");

        // The interrogation scene has an empty intro and one phase, so the
        // engine stays in the interrogation scene.
        assert!(matches!(view.scene, SceneView::Interrogation { .. }));

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn jump_to_interrogation_with_empty_intro_advances_when_outro_satisfied() {
        // An interrogation scene with an empty intro, no phases, and an auto
        // outro with empty dialogue immediately satisfies its outro on entry.
        // prime_initial_queue_for_command sets needs_interrogation_advance =
        // true (empty intro), try_advance_interrogation returns Ok(true)
        // (outro satisfied, empty dialogue), and advance_scene moves to the
        // next scene.
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-interrogation-auto-advance-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_1 = d.join("chapter_1");
        fs::create_dir_all(&chapter_1).unwrap();
        write_empty_story_catalog_and_content_manifest(&d);
        fs::write(
            d.join("chapters.json"),
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "First",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" },
                        { "type": "interrogation", "file": "chapter_1/interrogation_auto.json" },
                        { "type": "linear", "file": "chapter_1/scene_2.json" }
                    ]
                }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("scene_0.json"),
            r#"{ "type": "linear", "id": "scene_0", "title": "Opening", "summary": "Fixture scene summary.", "queue": [{ "kind": "line", "speaker": "A", "text": "start" }] }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("interrogation_auto.json"),
            r#"{
                "type": "interrogation",
                "id": "interrogation_auto",
                "title": "Auto Advance",
                "summary": "Fixture scene summary.",
                "intro": [],
                "phases": [],
                "evidenceManifest": [],
                "statementManifest": [],
                "outro": { "unlock": "auto", "dialogue": [] }
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("scene_2.json"),
            r#"{ "type": "linear", "id": "scene_2", "title": "After", "summary": "Fixture scene summary.", "queue": [{ "kind": "line", "speaker": "B", "text": "after" }] }"#,
        )
        .unwrap();

        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let view = engine
            .jump_to_scene("chapter_1", "interrogation_auto")
            .expect("jump should advance past the empty interrogation to scene_2");

        // The interrogation scene immediately advanced to scene_2.
        assert!(matches!(view.scene, SceneView::Linear { id, .. } if id == "scene_2"));

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn jump_to_analysis_with_empty_intro_advances_when_all_boards_completed() {
        // An analysis scene with an empty intro, no boards, and an empty outro
        // has all_boards_completed_qualified return true vacuously. On entry,
        // prime_initial_queue_for_command sets needs_analysis_advance = true
        // (empty intro), try_advance_analysis returns Ok(true) (all boards
        // completed, empty outro), and advance_scene moves to the next scene.
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-analysis-auto-advance-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_1 = d.join("chapter_1");
        fs::create_dir_all(&chapter_1).unwrap();
        // Write story catalog with the analysis scene registered so
        // complete_analysis_scene succeeds during try_advance_analysis.
        fs::write(
            d.join("story_catalog.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "schemaVersion": 2,
                "facts": [],
                "questions": [],
                "objectives": [],
                "authorizations": [],
                "sourceGroups": [],
                "evidenceIndex": [],
                "statementsIndex": [],
                "analysisScenes": [
                    {"chapterId": "chapter_1", "sceneId": "analysis_auto"}
                ],
                "analysisBoards": []
            }))
            .unwrap(),
        )
        .unwrap();
        write_content_manifest(&d);
        fs::write(
            d.join("chapters.json"),
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "First",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" },
                        { "type": "analysis", "file": "chapter_1/analysis_auto.json" },
                        { "type": "linear", "file": "chapter_1/scene_2.json" }
                    ]
                }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("scene_0.json"),
            r#"{ "type": "linear", "id": "scene_0", "title": "Opening", "summary": "Fixture scene summary.", "queue": [{ "kind": "line", "speaker": "A", "text": "start" }] }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("analysis_auto.json"),
            r#"{
                "type": "analysis",
                "id": "analysis_auto",
                "title": "Auto Advance",
                "summary": "Fixture scene summary.",
                "assetRefs": [],
                "intro": [],
                "boards": [],
                "outro": []
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_1.join("scene_2.json"),
            r#"{ "type": "linear", "id": "scene_2", "title": "After", "summary": "Fixture scene summary.", "queue": [{ "kind": "line", "speaker": "B", "text": "after" }] }"#,
        )
        .unwrap();

        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let view = engine
            .jump_to_scene("chapter_1", "analysis_auto")
            .expect("jump should advance past the empty analysis to scene_2");

        // The analysis scene immediately advanced to scene_2.
        assert!(matches!(view.scene, SceneView::Linear { id, .. } if id == "scene_2"));

        let _ = fs::remove_dir_all(d);
    }
}
