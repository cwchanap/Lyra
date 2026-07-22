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
            self.install_scene_queue(items, queue_gen)?;
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

    Ok(chapters)
}

pub(super) fn scene_navigation_index_from_chapters(
    resources_dir: &std::path::Path,
    chapters: &[ChapterManifest],
) -> Result<SceneNavigationIndex, GameError> {
    let mut chapter_views = Vec::with_capacity(chapters.len());
    let mut seen_chapter_ids = std::collections::HashSet::new();

    for (chapter_index, chapter) in chapters.iter().enumerate() {
        // jump_to_scene resolves chapters/scenes by id (first match wins),
        // so duplicate ids would silently target the wrong entry. Reject
        // ambiguous ids here — the free-navigation menu cannot render until
        // the index builds cleanly, which gates every jump_to_scene call.
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

pub(super) fn find_scene_runtime_by_id(
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
