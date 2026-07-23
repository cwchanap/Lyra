// src-tauri/src/game/mod.rs
//
// GameEngine — the single owner of mutable game state.

pub mod acquisition;
pub mod command_tx;
pub mod dialogue;
pub mod error;
pub mod loader;
pub mod navigation;
pub mod reveals;
pub mod scenes;
pub mod schema;
pub mod state;
pub mod unlock;
pub mod view;

pub use error::GameError;
pub use view::{DialogueHistoryEntry, GameStateView, ModeView, QueueToken, SceneNavigationIndex};

use acquisition::AcquisitionCtx;
use navigation::{
    load_chapter_manifests, load_scene_runtime, scene_navigation_index_from_chapters,
};
use scenes::interrogation::{
    phase_id, phase_required, CrossExam, InterrogationSceneAndInventoryCtx,
};
use scenes::investigation::InvestigationSceneState;
use scenes::SceneRuntime;
use schema::{DialogueItem, InterrogationPhaseJson, InventoryTarget, LockStatus};
use state::{ChapterManifest, Inventory};
use std::path::PathBuf;
use view::{
    AudioCueView, ChapterView, CharacterView, CrossExamView, HotspotView, InquiryQuestionView,
    InterrogationPhaseView, SceneView, SubjectView, SublocationView, TopicView,
};

pub struct GameEngine {
    resources_dir: PathBuf,
    chapters: Vec<ChapterManifest>,
    current_chapter_idx: usize,
    current_scene_idx: usize,
    scene: SceneRuntime,
    last_visual_cue: LastVisualCue,
    inventory: Inventory,
    next_queue_gen: u64,
    history: dialogue::DialogueHistory,
}

#[derive(Debug, Clone, Default)]
struct LastVisualCue {
    scene_tag: Option<String>,
    background_asset_id: Option<String>,
    bgm: Option<schema::AudioCueJson>,
    bgs: Option<schema::AudioCueJson>,
}

const REEXAMINE_FALLBACK_TEXT: &str = "（沒有新發現。）";

impl LastVisualCue {
    fn set_scene_tag(&mut self, text: String, asset_cue: Option<schema::VisualAssetCueJson>) {
        self.scene_tag = Some(text);
        self.apply_asset_cue(asset_cue);
    }

    /// Reset scene-specific visual fields for a scene boundary while
    /// preserving BGM/BGS so that audio continuity is maintained when
    /// the next scene omits audio fields (meaning "keep previous").
    fn reset_for_new_scene(&mut self) {
        self.scene_tag = None;
        self.background_asset_id = None;
    }

    fn apply_asset_cue(&mut self, asset_cue: Option<schema::VisualAssetCueJson>) {
        let Some(cue) = asset_cue else {
            return;
        };
        if cue.background_asset_id.is_some() {
            self.background_asset_id = cue.background_asset_id;
        }
        if let Some(bgm) = cue.bgm {
            self.bgm = Some(bgm);
        }
        if let Some(bgs) = cue.bgs {
            self.bgs = Some(bgs);
        }
    }
}

fn audio_cue_view(cue: &schema::AudioCueJson) -> AudioCueView {
    AudioCueView {
        channel: cue.channel,
        asset_id: cue.asset_id.clone(),
    }
}

impl GameEngine {
    pub fn new_started(resources_dir: PathBuf) -> Result<Self, GameError> {
        let chapters = load_chapter_manifests(&resources_dir)?;

        let first_scene_ref = chapters[0]
            .scenes
            .first()
            .ok_or_else(|| GameError::chapter_load_failed("chapter 1 has no scenes.".into()))?
            .clone();
        let initial_scene = load_scene_runtime(&resources_dir, &first_scene_ref, 1)?;
        let mut engine = Self {
            resources_dir,
            chapters,
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: initial_scene,
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            history: dialogue::DialogueHistory::default(),
        };
        engine.prime_initial_queue()?;
        engine.record_current_dialogue_history();
        Ok(engine)
    }

    pub fn scene_navigation_index(
        resources_dir: PathBuf,
    ) -> Result<SceneNavigationIndex, GameError> {
        let chapters = load_chapter_manifests(&resources_dir)?;
        scene_navigation_index_from_chapters(&resources_dir, &chapters)
    }

    pub fn view(&self) -> GameStateView {
        GameStateView {
            mode: self.mode_view(),
            chapter: self.chapter_view(),
            scene: self.scene_view(),
            inventory: self.inventory.clone(),
            dialogue_history: self.history.entries().to_vec(),
        }
    }

    pub fn advance_dialogue(&mut self, expected: QueueToken) -> Result<GameStateView, GameError> {
        let current_token = match self.current_queue_token() {
            Some(t) => t,
            None => return Err(GameError::no_active_dialogue()),
        };
        // Stale token: the frontend acted on a view we have already replaced.
        // Not a transaction, and deliberately records no history.
        if current_token != expected {
            return Ok(self.view());
        }

        self.command_tx(|engine| {
            let _ = match &mut engine.scene {
                SceneRuntime::Linear(s) => s.advance(),
                SceneRuntime::Investigation(inv) => {
                    let q = inv
                        .pending_queue
                        .as_mut()
                        .ok_or_else(GameError::no_active_dialogue)?;
                    q.cursor += 1;
                    q.cursor >= q.items.len()
                }
                SceneRuntime::Interrogation(scene) => {
                    let q = scene
                        .pending_queue
                        .as_mut()
                        .ok_or_else(GameError::no_active_dialogue)?;
                    q.cursor += 1;
                    q.cursor >= q.items.len()
                }
            };
            // Capture the just-consumed item as a scene tag if applicable.
            if let Some(DialogueItem::SceneTag { text, asset_cue }) = engine.peek_just_consumed() {
                engine.last_visual_cue.set_scene_tag(text, asset_cue);
            }
            // Skip over any consecutive SceneTag items so the next visible frame
            // is a real dialogue/action line. This mirrors the leading-tag skip
            // in prime_initial_queue.
            engine.consume_scene_tags_at_cursor();
            let exhausted = match &engine.scene {
                SceneRuntime::Linear(s) => s.cursor >= s.queue.len(),
                SceneRuntime::Investigation(inv) => inv
                    .pending_queue
                    .as_ref()
                    .is_none_or(|q| q.cursor >= q.items.len()),
                SceneRuntime::Interrogation(scene) => scene
                    .pending_queue
                    .as_ref()
                    .is_none_or(|q| q.cursor >= q.items.len()),
            };
            if exhausted {
                engine.on_queue_exhausted()?;
            }
            Ok(())
        })
    }

    fn try_advance_investigation(&mut self) -> Result<bool, GameError> {
        // Phase 1 — read: extract everything we need from the scene + inventory.
        let (outro_satisfied, outro_already_played, outro_dialogue, no_current_sublocation) = {
            let inv = match &mut self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => return Ok(false),
            };
            inv.pending_queue = None;
            let ctx = SceneAndInventoryCtx {
                scene: inv,
                inventory: &self.inventory,
            };
            let sat = inv.outro_satisfied(&ctx);
            (
                sat,
                inv.outro_played,
                inv.def.outro.dialogue.clone(),
                inv.current_sublocation_id.is_none(),
            )
        };

        if no_current_sublocation {
            self.advance_into_first_sublocation()?;
            return Ok(false);
        }

        if !outro_already_played && outro_satisfied {
            if outro_dialogue.is_empty() {
                // Empty outro: mark played and advance immediately rather than
                // creating an empty queue that would leave the scene in Explore
                // with no way to reach the outro_already_played branch.
                if let SceneRuntime::Investigation(inv) = &mut self.scene {
                    inv.outro_played = true;
                }
                return Ok(true);
            }
            let queue_gen = self.alloc_queue_gen();
            if let SceneRuntime::Investigation(inv) = &mut self.scene {
                inv.outro_played = true;
            }
            self.install_scene_queue(outro_dialogue, queue_gen)?;
            return Ok(false);
        }

        if outro_already_played {
            return Ok(true);
        }
        Ok(false)
    }

    fn try_advance_interrogation(&mut self) -> Result<bool, GameError> {
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        {
            let scene = match &mut self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => return Ok(false),
            };
            scene.pending_queue = None;
            if scene.outro_played {
                return Ok(true);
            }
            scene.refresh_current_phase(&self.inventory);
        }

        if self.should_enter_current_interrogation_phase()
            && self.try_enter_current_interrogation_phase(&chapter_id)?
        {
            return Ok(false);
        }

        {
            let scene = match &mut self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => return Ok(false),
            };
            scene.refresh_phase_completion(&self.inventory);
        }

        if self.should_enter_current_interrogation_phase()
            && self.try_enter_current_interrogation_phase(&chapter_id)?
        {
            return Ok(false);
        }

        let (outro_satisfied, outro_dialogue) = {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => return Ok(false),
            };
            let ctx = InterrogationSceneAndInventoryCtx {
                scene,
                inventory: &self.inventory,
            };
            (
                scene.outro_satisfied(&ctx),
                scene.def.outro.dialogue.clone(),
            )
        };

        if !outro_satisfied {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => return Ok(false),
            };
            if scene.current_phase_id.is_none() {
                return Err(GameError::scene_validation_failed(format!(
                    "{} has no available interrogation phase and its outro is not satisfied.",
                    scene.def.id
                )));
            }
        }

        if outro_satisfied {
            if let SceneRuntime::Interrogation(scene) = &mut self.scene {
                scene.outro_played = true;
            }
            if outro_dialogue.is_empty() {
                return Ok(true);
            }
            let queue_gen = self.alloc_queue_gen();
            self.install_scene_queue(outro_dialogue, queue_gen)?;
        }
        Ok(false)
    }

    fn should_enter_current_interrogation_phase(&self) -> bool {
        let scene = match &self.scene {
            SceneRuntime::Interrogation(scene) => scene,
            _ => return false,
        };
        let Some(current_phase_id) = scene.current_phase_id.as_deref() else {
            return false;
        };
        let Some(current_phase) = scene
            .def
            .phases
            .iter()
            .find(|phase| phase_id(phase) == current_phase_id)
        else {
            return false;
        };
        if phase_required(current_phase) {
            return true;
        }
        let ctx = InterrogationSceneAndInventoryCtx {
            scene,
            inventory: &self.inventory,
        };
        !scene.outro_satisfied(&ctx)
    }

    fn try_enter_current_interrogation_phase(
        &mut self,
        chapter_id: &str,
    ) -> Result<bool, GameError> {
        let phase_to_enter = {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => return Ok(false),
            };
            scene
                .current_phase_id
                .as_deref()
                .filter(|id| !scene.phase_entered(id))
                .and_then(|id| {
                    scene
                        .def
                        .phases
                        .iter()
                        .find(|phase| phase_id(phase) == id)
                        .cloned()
                })
        };

        let Some(phase) = phase_to_enter else {
            return Ok(false);
        };

        let (phase_id, scene_tag, asset_cue, entry_dialogue, reveals) = {
            let InterrogationPhaseJson::Inquiry {
                id,
                scene_tag,
                entry_dialogue,
                reveals,
                ..
            } = &phase;
            (
                id.clone(),
                scene_tag.clone(),
                phase.visual_asset_cue(),
                entry_dialogue.clone(),
                reveals.clone(),
            )
        };
        let queue_items = {
            let scene = match &mut self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => return Ok(false),
            };
            scene.mark_phase_entered(&phase_id);
            reveals::apply_interrogation_reveals_and_build_queue(
                scene,
                &mut AcquisitionCtx {
                    inventory: &mut self.inventory,
                },
                entry_dialogue,
                &reveals,
                chapter_id,
            )
        };
        self.last_visual_cue.set_scene_tag(scene_tag, asset_cue);
        self.install_or_exhaust(queue_items)?;
        Ok(true)
    }

    fn advance_into_first_sublocation(&mut self) -> Result<(), GameError> {
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        // Phase 1 — read out the data we need without holding a mutable borrow into self.scene.
        let chosen = match &self.scene {
            SceneRuntime::Investigation(inv) => inv
                .def
                .sublocations
                .iter()
                .find(|s| s.status == LockStatus::Unlocked)
                .map(|s| {
                    (
                        s.id.clone(),
                        s.scene_tag.clone(),
                        s.visual_asset_cue(),
                        s.transition_dialogue.clone(),
                        s.reveals.clone(),
                    )
                }),
            _ => None,
        };
        let Some((id, scene_tag, asset_cue, transition, sub_reveals)) = chosen else {
            return Ok(());
        };

        // Phase 2 — write: mutate scene + inventory; reveals fire on first entry.
        let queue_items = {
            let inv = match &mut self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => return Ok(()),
            };
            let first_entry = !inv.entered_sublocations.contains(&id);
            inv.current_sublocation_id = Some(id.clone());
            inv.record_sublocation_entered(&id);
            if first_entry {
                reveals::apply_reveals_and_build_queue(
                    inv,
                    &mut AcquisitionCtx {
                        inventory: &mut self.inventory,
                    },
                    transition,
                    &sub_reveals,
                    &chapter_id,
                )
            } else {
                Vec::new()
            }
        };

        self.last_visual_cue.set_scene_tag(scene_tag, asset_cue);
        self.install_or_exhaust(queue_items)?;
        Ok(())
    }

    pub fn inspect_hotspot(&mut self, hotspot_id: &str) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        // Phase 1 — read: clone defs and check locks without holding self.scene mutably.
        let (hot_def, first_time) = {
            let inv = match &self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => return Err(GameError::wrong_mode("inspect_hotspot", "linear")),
            };
            if inv
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("inspect_hotspot"));
            }
            let sublocation_id = inv.current_sublocation_id.clone().ok_or_else(|| {
                GameError::wrong_mode("inspect_hotspot", "no sublocation entered")
            })?;
            let sub_def = inv
                .def
                .sublocations
                .iter()
                .find(|s| s.id == sublocation_id)
                .ok_or_else(|| GameError::unknown_sublocation(&sublocation_id))?;
            let hot_def = sub_def
                .hotspots
                .iter()
                .find(|h| h.id == hotspot_id)
                .ok_or_else(|| GameError::unknown_hotspot(hotspot_id))?
                .clone();
            let ctx = SceneAndInventoryCtx {
                scene: inv,
                inventory: &self.inventory,
            };
            if !inv.is_block_unlocked(
                &format!("hotspot:{}", hotspot_id),
                hot_def.status,
                hot_def.unlock.as_ref(),
                &ctx,
            ) {
                return Err(GameError::locked_hotspot(hotspot_id));
            }
            let first_time = !inv.inspected_hotspots.contains(hotspot_id);
            (hot_def, first_time)
        };

        self.command_tx(|engine| {
            // Phase 2 — compute: build queue (mutates scene + inventory together).
            let queue_items = if first_time {
                let inv = match &mut engine.scene {
                    SceneRuntime::Investigation(i) => i,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during inspect_hotspot".into(),
                        ))
                    }
                };
                inv.record_inspect(hotspot_id);
                let body = hot_def.inspect_dialogue.clone();
                reveals::apply_reveals_and_build_queue(
                    inv,
                    &mut AcquisitionCtx {
                        inventory: &mut engine.inventory,
                    },
                    body,
                    &hot_def.reveals,
                    &chapter_id,
                )
            } else {
                match hot_def.on_reexamine.clone() {
                    Some(q) if !q.is_empty() => q,
                    _ => vec![DialogueItem::Action {
                        text: REEXAMINE_FALLBACK_TEXT.into(),
                    }],
                }
            };

            // Phase 3 — write: attach the queue.
            engine.install_or_exhaust(queue_items)?;
            Ok(())
        })
    }

    pub fn interview_topic(
        &mut self,
        character_id: &str,
        topic_id: &str,
    ) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        let (topic, first_time) = {
            let inv = match &self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => return Err(GameError::wrong_mode("interview_topic", "linear")),
            };
            if inv
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("interview_topic"));
            }
            let sub_id = inv.current_sublocation_id.clone().ok_or_else(|| {
                GameError::wrong_mode("interview_topic", "no sublocation entered")
            })?;
            let sub_def = inv
                .def
                .sublocations
                .iter()
                .find(|s| s.id == sub_id)
                .ok_or_else(|| GameError::unknown_sublocation(&sub_id))?;
            let character = sub_def
                .characters
                .iter()
                .find(|c| c.id == character_id)
                .ok_or_else(|| GameError::unknown_character(character_id))?;
            let topic = character
                .topics
                .iter()
                .find(|t| t.id == topic_id)
                .ok_or_else(|| GameError::unknown_topic(character_id, topic_id))?
                .clone();
            let key = format!("topic:{character_id}@{topic_id}");
            let ctx = SceneAndInventoryCtx {
                scene: inv,
                inventory: &self.inventory,
            };
            if !inv.is_block_unlocked(&key, topic.status, topic.unlock.as_ref(), &ctx) {
                return Err(GameError::locked_topic(character_id, topic_id));
            }
            let first_time = !inv
                .discussed_topics
                .contains(&(character_id.into(), topic_id.into()));
            (topic, first_time)
        };

        self.command_tx(|engine| {
            let queue_items = if first_time {
                let inv = match &mut engine.scene {
                    SceneRuntime::Investigation(i) => i,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during interview_topic".into(),
                        ))
                    }
                };
                inv.record_topic_discussed(character_id, topic_id);
                let body = topic.topic_dialogue.clone();
                reveals::apply_reveals_and_build_queue(
                    inv,
                    &mut AcquisitionCtx {
                        inventory: &mut engine.inventory,
                    },
                    body,
                    &topic.reveals,
                    &chapter_id,
                )
            } else {
                match topic.on_reexamine.clone() {
                    Some(q) if !q.is_empty() => q,
                    _ => vec![DialogueItem::Action {
                        text: REEXAMINE_FALLBACK_TEXT.into(),
                    }],
                }
            };

            engine.install_or_exhaust(queue_items)?;
            Ok(())
        })
    }

    pub fn enter_sublocation(&mut self, sublocation_id: &str) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        let (scene_tag, asset_cue, transition_dialogue, sub_reveals, first_entry) = {
            let inv = match &self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => return Err(GameError::wrong_mode("enter_sublocation", "linear")),
            };
            if inv
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("enter_sublocation"));
            }
            let def = inv
                .def
                .sublocations
                .iter()
                .find(|s| s.id == sublocation_id)
                .ok_or_else(|| GameError::unknown_sublocation(sublocation_id))?
                .clone();
            let ctx = SceneAndInventoryCtx {
                scene: inv,
                inventory: &self.inventory,
            };
            if !inv.is_block_unlocked(
                &format!("sublocation:{}", sublocation_id),
                def.status,
                def.unlock.as_ref(),
                &ctx,
            ) {
                return Err(GameError::locked_sublocation(sublocation_id));
            }
            let first_entry = !inv.entered_sublocations.contains(sublocation_id);
            (
                def.scene_tag.clone(),
                def.visual_asset_cue(),
                def.transition_dialogue,
                def.reveals,
                first_entry,
            )
        };

        self.command_tx(|engine| {
            let queue_items: Vec<DialogueItem> = if first_entry {
                let inv = match &mut engine.scene {
                    SceneRuntime::Investigation(i) => i,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during enter_sublocation".into(),
                        ))
                    }
                };
                inv.current_sublocation_id = Some(sublocation_id.into());
                inv.record_sublocation_entered(sublocation_id);
                reveals::apply_reveals_and_build_queue(
                    inv,
                    &mut AcquisitionCtx {
                        inventory: &mut engine.inventory,
                    },
                    transition_dialogue,
                    &sub_reveals,
                    &chapter_id,
                )
            } else {
                if let SceneRuntime::Investigation(inv) = &mut engine.scene {
                    inv.current_sublocation_id = Some(sublocation_id.into());
                }
                Vec::new()
            };

            engine.last_visual_cue.set_scene_tag(scene_tag, asset_cue);
            engine.install_or_exhaust(queue_items)?;
            Ok(())
        })
    }

    pub fn reexamine_evidence(&mut self, id: &str) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        match &self.scene {
            SceneRuntime::Investigation(inv) => {
                if inv
                    .pending_queue
                    .as_ref()
                    .is_some_and(|q| q.cursor < q.items.len())
                {
                    return Err(GameError::dialogue_active("reexamine_evidence"));
                }
            }
            SceneRuntime::Interrogation(scene) => {
                if scene
                    .pending_queue
                    .as_ref()
                    .is_some_and(|q| q.cursor < q.items.len())
                {
                    return Err(GameError::dialogue_active("reexamine_evidence"));
                }
            }
            SceneRuntime::Linear(_) => {
                return Err(GameError::wrong_mode("reexamine_evidence", "linear"));
            }
        }
        let rec = self
            .inventory
            .evidence
            .iter()
            .find(|e| e.id == id)
            .cloned()
            .ok_or_else(|| GameError::unknown_evidence(id))?;
        let queue_items = match rec.on_reexamine.clone() {
            Some(q) if !q.is_empty() => q,
            _ => vec![DialogueItem::Action {
                text: REEXAMINE_FALLBACK_TEXT.into(),
            }],
        };
        self.command_tx(|engine| {
            let queue_gen = engine.alloc_queue_gen();
            engine.install_scene_queue(queue_items, queue_gen)?;
            Ok(())
        })
    }

    pub fn reexamine_statement(&mut self, id: &str) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        match &self.scene {
            SceneRuntime::Investigation(inv) => {
                if inv
                    .pending_queue
                    .as_ref()
                    .is_some_and(|q| q.cursor < q.items.len())
                {
                    return Err(GameError::dialogue_active("reexamine_statement"));
                }
            }
            SceneRuntime::Interrogation(scene) => {
                if scene
                    .pending_queue
                    .as_ref()
                    .is_some_and(|q| q.cursor < q.items.len())
                {
                    return Err(GameError::dialogue_active("reexamine_statement"));
                }
            }
            SceneRuntime::Linear(_) => {
                return Err(GameError::wrong_mode("reexamine_statement", "linear"));
            }
        }
        let rec = self
            .inventory
            .statements
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| GameError::unknown_statement(id))?;
        let queue_items = match rec.on_reexamine.clone() {
            Some(q) if !q.is_empty() => q,
            _ => vec![DialogueItem::Action {
                text: REEXAMINE_FALLBACK_TEXT.into(),
            }],
        };
        self.command_tx(|engine| {
            let queue_gen = engine.alloc_queue_gen();
            engine.install_scene_queue(queue_items, queue_gen)?;
            Ok(())
        })
    }

    /// `ask_interrogation_question` — enters cross-examination on `question_id`,
    /// installing its testimony's first line as a dialogue queue.
    pub fn ask_interrogation_question(
        &mut self,
        question_id: &str,
    ) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => {
                    return Err(GameError::wrong_mode(
                        "ask_interrogation_question",
                        "not interrogation",
                    ))
                }
            };
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("ask_interrogation_question"));
            }
            // Restrict the lookup to the current phase. `question()` is a
            // global lookup across all phases; using it here would let a
            // caller ask a question whose own unlock is satisfied but whose
            // owning phase has not been entered yet, firing its reveals
            // before the phase's entry dialogue and completion accounting.
            let question = scene.current_phase_question(question_id).ok_or_else(|| {
                if scene.question(question_id).is_some() {
                    // Exists, but belongs to a different phase.
                    GameError::locked_interrogation_question(question_id)
                } else {
                    GameError::unknown_interrogation_question(question_id)
                }
            })?;
            let ctx = InterrogationSceneAndInventoryCtx {
                scene,
                inventory: &self.inventory,
            };
            if !scene.is_question_unlocked(question, &ctx) {
                return Err(GameError::locked_interrogation_question(question_id));
            }
        }

        self.command_tx(|engine| {
            let (queue_items, line_content_start) = {
                let scene = match &mut engine.scene {
                    SceneRuntime::Interrogation(scene) => scene,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during ask_interrogation_question".into(),
                        ))
                    }
                };
                scene.begin_question(question_id);
                let line_content = scene
                    .question(question_id)
                    .and_then(|question| question.testimony.lines.first())
                    .map(|line| line.content.clone())
                    .unwrap_or_default();
                // A no-contradiction (honest) question auto-breaks the moment
                // it is asked. There is no `On Correct` line to carry its
                // reveals, so fire the question-level reveals here.
                if scene.is_question_broken(question_id) {
                    let reveals = scene
                        .question(question_id)
                        .map(|question| question.reveals.clone())
                        .unwrap_or_default();
                    let queue = reveals::apply_interrogation_reveals_and_build_queue(
                        scene,
                        &mut AcquisitionCtx {
                            inventory: &mut engine.inventory,
                        },
                        line_content,
                        &reveals,
                        &chapter_id,
                    );
                    // A broken question exposes no challenge target. The broken
                    // guard in `playing_unbroken_line_id` already returns None,
                    // but set `line_content_start` past the queue as
                    // defense-in-depth so the cursor check would also suppress.
                    let start = queue.len();
                    (queue, start)
                } else {
                    // Pure testimony line content — challengeable from item 0.
                    (line_content, 0)
                }
            };

            engine.install_or_exhaust_line_content(queue_items, line_content_start)?;
            if let SceneRuntime::Interrogation(scene) = &mut engine.scene {
                scene.refresh_phase_completion(&engine.inventory);
            }
            Ok(())
        })
    }

    /// `challenge_interrogation_line` — opens the evidence tray against
    /// `line_id`, installing its challenge lead-in dialogue. The inline 反駁
    /// button currently sends the currently-playing line id (the line at
    /// `Playing.line_index`, surfaced as `cross_exam_line_id` in the dialogue
    /// view), but `line_id` is treated as untrusted player input and
    /// validated to belong to the current question before use.
    pub fn challenge_interrogation_line(
        &mut self,
        line_id: &str,
    ) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }

        {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => {
                    return Err(GameError::wrong_mode(
                        "challenge_interrogation_line",
                        "not interrogation",
                    ))
                }
            };
            // The inline `反駁` button fires while the testimony line is still
            // on screen (its content queue active), so no `dialogue_active`
            // guard here — the `Playing` state is the sole gate. Every other
            // active dialogue (intro, challenge lead-in, on-correct reveal)
            // leaves `cross_exam` non-`Playing`, so this still rejects them.
            if !matches!(scene.cross_exam(), CrossExam::Playing { .. }) {
                return Err(GameError::not_in_cross_examination(
                    "challenge_interrogation_line",
                ));
            }
        }

        self.command_tx(|engine| {
            let queue_items = {
                let scene = match &mut engine.scene {
                    SceneRuntime::Interrogation(scene) => scene,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during challenge_interrogation_line".into(),
                        ))
                    }
                };
                let CrossExam::Playing { question_id, .. } = scene.cross_exam().clone() else {
                    return Err(GameError::internal(
                        "cross_exam changed during challenge_interrogation_line".into(),
                    ));
                };
                // Defense-in-depth: `line_id` is a player choice (any line of
                // the current question may be challenged), so it cannot be
                // derived from `Playing.line_index`. But it MUST belong to the
                // current question — reject a crafted IPC call that names a
                // line from another question, which would otherwise pollute
                // the `Presenting` state with a foreign line id.
                let challenge = match scene.line(&question_id, line_id) {
                    Some(line) => {
                        if line.challenge.is_empty() {
                            scene
                                .question(&question_id)
                                .map(|question| question.testimony.default_challenge.clone())
                                .unwrap_or_default()
                        } else {
                            line.challenge.clone()
                        }
                    }
                    None => {
                        return Err(GameError::internal(format!(
                            "challenge_interrogation_line: line '{line_id}' is not a testimony line of question '{question_id}'"
                        )));
                    }
                };
                scene.begin_present(line_id);
                challenge
            };

            engine.install_or_exhaust(queue_items)?;
            Ok(())
        })
    }

    /// `present_interrogation_evidence` — presents `item_kind:item_id` against
    /// the line recorded in the `Presenting` cross-exam state (derived from the
    /// engine's own state, not the frontend-supplied `line_id`). On a correct
    /// contradiction match, plays `on_correct`,
    /// applies the line's reveals, and marks the question broken (returning to
    /// the question menu). Otherwise plays `on_wrong_evidence` (or the
    /// testimony's `default_wrong` fallback) and returns to the same line.
    pub fn present_interrogation_evidence(
        &mut self,
        _line_id: &str,
        item_kind: &str,
        item_id: &str,
    ) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        let (question_id, active_line_id) = {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => {
                    return Err(GameError::wrong_mode(
                        "present_interrogation_evidence",
                        "not interrogation",
                    ))
                }
            };
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("present_interrogation_evidence"));
            }
            // Defense-in-depth: take the line being challenged from the
            // engine's own `Presenting` state rather than trusting the
            // frontend-supplied `line_id` — the tray was opened against this
            // exact line by `challenge_interrogation_line`, and a crafted IPC
            // call must not be able to present evidence against a different
            // line than the one the tray is open for.
            let CrossExam::Presenting {
                question_id,
                line_id,
            } = scene.cross_exam()
            else {
                return Err(GameError::not_in_cross_examination(
                    "present_interrogation_evidence",
                ));
            };
            if !self.inventory_target_exists(item_kind, item_id) {
                return Err(GameError::unknown_inventory_target(item_kind, item_id));
            }
            (question_id.clone(), line_id.clone())
        };

        self.command_tx(|engine| {
            let queue_items = {
                let scene = match &mut engine.scene {
                    SceneRuntime::Interrogation(scene) => scene,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during present_interrogation_evidence".into(),
                        ))
                    }
                };
                let line = scene.line(&question_id, &active_line_id).cloned();
                let correct = line
                    .as_ref()
                    .and_then(|line| line.contradiction.as_ref())
                    .is_some_and(|target| inventory_target_matches(target, item_kind, item_id));

                if correct {
                    let on_correct = line
                        .as_ref()
                        .map(|line| line.on_correct.clone())
                        .unwrap_or_default();
                    let mut reveals = line
                        .as_ref()
                        .map(|line| line.reveals.clone())
                        .unwrap_or_default();
                    // Breaking the question also fires its question-level
                    // reveals (the runtime otherwise only applies phase-entry
                    // and line-level `On Correct` reveals).
                    if let Some(question) = scene.question(&question_id) {
                        reveals.extend(question.reveals.iter().cloned());
                    }
                    let queue = reveals::apply_interrogation_reveals_and_build_queue(
                        scene,
                        &mut AcquisitionCtx {
                            inventory: &mut engine.inventory,
                        },
                        on_correct,
                        &reveals,
                        &chapter_id,
                    );
                    scene.record_break(&question_id);
                    queue
                } else {
                    let default_wrong = scene
                        .question(&question_id)
                        .map(|question| question.testimony.default_wrong.clone())
                        .unwrap_or_default();
                    let mut on_wrong = line
                        .as_ref()
                        .map(|line| line.on_wrong_evidence.clone())
                        .filter(|dialogue| !dialogue.is_empty())
                        .unwrap_or(default_wrong);
                    // Append the required detective reaction after the suspect's rebuff.
                    if let Some(question) = scene.question(&question_id) {
                        on_wrong.extend(question.testimony.wrong_reply.iter().cloned());
                    }
                    // `return_to_line` resets cross_exam to the challenged line's
                    // index, but once `on_wrong` drains, `on_queue_exhausted` →
                    // `advance_playing_testimony` calls `advance_line()`, moving
                    // to N+1. So a wrong present does NOT re-show the challenged
                    // line — it advances past it, acting like 繼續. This is
                    // intended: the spec's "return to the loop" wording is
                    // ambiguous, and we chose "resume the looping playback"
                    // (advance) over "re-show the same line." Re-challenging the
                    // same line is still possible on the next loop pass.
                    scene.return_to_line();
                    on_wrong
                }
            };

            engine.install_or_exhaust(queue_items)?;
            if let SceneRuntime::Interrogation(scene) = &mut engine.scene {
                scene.refresh_phase_completion(&engine.inventory);
            }
            Ok(())
        })
    }

    /// `withdraw_interrogation` — abandons the current cross-examination and
    /// returns to the question menu.
    pub fn withdraw_interrogation(&mut self) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }

        {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => {
                    return Err(GameError::wrong_mode(
                        "withdraw_interrogation",
                        "not interrogation",
                    ))
                }
            };
            // The inline `退下` button fires while the testimony line is still
            // on screen, so no `dialogue_active` guard — the cross-exam state
            // is the sole gate. Other active dialogue leaves `cross_exam`
            // non-`Playing`/`Presenting`, so this still rejects it.
            if !matches!(
                scene.cross_exam(),
                CrossExam::Playing { .. } | CrossExam::Presenting { .. }
            ) {
                return Err(GameError::not_in_cross_examination(
                    "withdraw_interrogation",
                ));
            }
        }

        self.command_tx(|engine| {
            if let SceneRuntime::Interrogation(scene) = &mut engine.scene {
                scene.withdraw();
                // A testimony content queue may still be active (withdrawing
                // mid-line); drop it so the scene machinery below runs as if
                // the queue had just drained.
                scene.pending_queue = None;
            }
            engine.on_queue_exhausted()?;
            Ok(())
        })
    }

    /// `resume_interrogation_testimony` — backs out of the evidence tray (收回)
    /// to keep listening: returns from `Presenting` to *playing* the same
    /// testimony line in the dialogue box, rather than abandoning the
    /// cross-examination back to the question menu (which `withdraw` does).
    pub fn resume_interrogation_testimony(&mut self) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }

        {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => {
                    return Err(GameError::wrong_mode(
                        "resume_interrogation_testimony",
                        "not interrogation",
                    ))
                }
            };
            if !matches!(scene.cross_exam(), CrossExam::Presenting { .. }) {
                return Err(GameError::not_in_cross_examination(
                    "resume_interrogation_testimony",
                ));
            }
        }

        self.command_tx(|engine| {
            let queue_items = {
                let scene = match &mut engine.scene {
                    SceneRuntime::Interrogation(scene) => scene,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during resume_interrogation_testimony".into(),
                        ))
                    }
                };
                scene.return_to_line();
                let CrossExam::Playing {
                    question_id,
                    line_index,
                } = scene.cross_exam().clone()
                else {
                    return Err(GameError::internal(
                        "cross_exam not Playing after return_to_line".into(),
                    ));
                };
                scene
                    .question(&question_id)
                    .and_then(|question| question.testimony.lines.get(line_index))
                    .map(|line| line.content.clone())
                    .unwrap_or_default()
            };

            // Resuming installs the challenged line's pure content —
            // challengeable from the first item.
            engine.install_or_exhaust_line_content(queue_items, 0)?;
            Ok(())
        })
    }

    /// `complete_interrogation_phase` — the player manually concludes the
    /// current `Auto` inquiry phase from the question menu. Gated on every
    /// required question being broken (see
    /// [`scenes::interrogation::InterrogationSceneState::current_phase_can_complete`]);
    /// the phase then advances (or fires the outro) via the same machinery a
    /// drained dialogue queue drives.
    pub fn complete_interrogation_phase(&mut self) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }

        {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => {
                    return Err(GameError::wrong_mode(
                        "complete_interrogation_phase",
                        "not interrogation",
                    ))
                }
            };
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("complete_interrogation_phase"));
            }
            if !scene.current_phase_can_complete() {
                return Err(GameError::interrogation_phase_not_completable());
            }
        }

        self.command_tx(|engine| {
            if let SceneRuntime::Interrogation(scene) = &mut engine.scene {
                scene.complete_current_phase();
            }
            // The guard ensured no dialogue queue is active; drive the scene
            // machinery (phase-advance / outro) as if a queue had just drained.
            engine.on_queue_exhausted()?;
            Ok(())
        })
    }

    fn inventory_target_exists(&self, item_kind: &str, item_id: &str) -> bool {
        match item_kind {
            "evidence" => self.inventory.has_evidence(item_id),
            "statement" => self.inventory.has_statement(item_id),
            _ => false,
        }
    }

    fn mode_view(&self) -> ModeView {
        if self.current_chapter_idx >= self.chapters.len() {
            return ModeView::GameComplete;
        }
        let token = self.current_queue_token();
        let current_item: Option<DialogueItem> = match &self.scene {
            SceneRuntime::Linear(s) => s.current().cloned(),
            SceneRuntime::Investigation(inv) => inv
                .pending_queue
                .as_ref()
                .and_then(|q| q.items.get(q.cursor).cloned()),
            SceneRuntime::Interrogation(scene) => scene
                .pending_queue
                .as_ref()
                .and_then(|q| q.items.get(q.cursor).cloned()),
        };
        match (current_item, token) {
            (Some(item), Some(t)) => ModeView::Dialogue {
                current: item,
                queue_remaining: match &self.scene {
                    SceneRuntime::Linear(s) => s.queue_remaining(),
                    SceneRuntime::Investigation(inv) => inv
                        .pending_queue
                        .as_ref()
                        .map(|q| q.items.len().saturating_sub(q.cursor + 1))
                        .unwrap_or(0),
                    SceneRuntime::Interrogation(scene) => scene
                        .pending_queue
                        .as_ref()
                        .map(|q| q.items.len().saturating_sub(q.cursor + 1))
                        .unwrap_or(0),
                },
                scene_tag: self.last_visual_cue.scene_tag.clone(),
                background_asset_id: self.last_visual_cue.background_asset_id.clone(),
                bgm: self.last_visual_cue.bgm.as_ref().map(audio_cue_view),
                bgs: self.last_visual_cue.bgs.as_ref().map(audio_cue_view),
                queue_token: t,
                cross_exam_line_id: match &self.scene {
                    SceneRuntime::Interrogation(scene) => scene.playing_unbroken_line_id(),
                    _ => None,
                },
            },
            _ => match &self.scene {
                SceneRuntime::Investigation(inv) => match &inv.current_sublocation_id {
                    Some(sub_id) => ModeView::Explore {
                        sublocation_id: sub_id.clone(),
                        background_asset_id: self.last_visual_cue.background_asset_id.clone(),
                        bgm: self.last_visual_cue.bgm.as_ref().map(audio_cue_view),
                        bgs: self.last_visual_cue.bgs.as_ref().map(audio_cue_view),
                    },
                    None => ModeView::GameComplete,
                },
                SceneRuntime::Linear(_) => ModeView::GameComplete,
                SceneRuntime::Interrogation(scene) => match &scene.current_phase_id {
                    Some(phase_id) => ModeView::Interrogation {
                        phase_id: phase_id.clone(),
                        background_asset_id: self.last_visual_cue.background_asset_id.clone(),
                        bgm: self.last_visual_cue.bgm.as_ref().map(audio_cue_view),
                        bgs: self.last_visual_cue.bgs.as_ref().map(audio_cue_view),
                    },
                    None => ModeView::GameComplete,
                },
            },
        }
    }

    fn chapter_view(&self) -> ChapterView {
        let clamped = self.current_chapter_idx.min(self.chapters.len() - 1);
        let c = &self.chapters[clamped];
        ChapterView {
            id: c.id.clone(),
            title: c.title.clone(),
            summary: c.summary.clone(),
            index: clamped,
            total: self.chapters.len(),
        }
    }

    fn scene_view(&self) -> SceneView {
        let total = self.chapters[self.current_chapter_idx.min(self.chapters.len() - 1)]
            .scenes
            .len();
        match &self.scene {
            SceneRuntime::Linear(s) => SceneView::Linear {
                id: s.id.clone(),
                title: s.title.clone(),
                index: self.current_scene_idx,
                total,
            },
            SceneRuntime::Investigation(inv) => {
                let ctx = SceneAndInventoryCtx {
                    scene: inv,
                    inventory: &self.inventory,
                };
                let visible_sublocations: Vec<SublocationView> = inv
                    .def
                    .sublocations
                    .iter()
                    .filter(|s| {
                        inv.is_block_unlocked(
                            &format!("sublocation:{}", s.id),
                            s.status,
                            s.unlock.as_ref(),
                            &ctx,
                        )
                    })
                    .map(|s| SublocationView {
                        id: s.id.clone(),
                        label: s.label.clone(),
                        scene_tag: s.scene_tag.clone(),
                        hotspots: s
                            .hotspots
                            .iter()
                            .filter(|h| {
                                inv.is_block_unlocked(
                                    &format!("hotspot:{}", h.id),
                                    h.status,
                                    h.unlock.as_ref(),
                                    &ctx,
                                )
                            })
                            .map(|h| HotspotView {
                                id: h.id.clone(),
                                label: h.label.clone(),
                                description: h.description.clone(),
                                inspected: inv.inspected_hotspots.contains(&h.id),
                                layout: h.layout.clone(),
                            })
                            .collect(),
                        characters: s
                            .characters
                            .iter()
                            .map(|c| CharacterView {
                                id: c.id.clone(),
                                name: c.name.clone(),
                                role: c.role.clone(),
                                bio: c.bio.clone(),
                                layout: c.layout.clone(),
                                topics: c
                                    .topics
                                    .iter()
                                    .filter(|t| {
                                        inv.is_block_unlocked(
                                            &format!("topic:{}@{}", c.id, t.id),
                                            t.status,
                                            t.unlock.as_ref(),
                                            &ctx,
                                        )
                                    })
                                    .map(|t| TopicView {
                                        id: t.id.clone(),
                                        label: t.label.clone(),
                                        discussed: inv
                                            .discussed_topics
                                            .contains(&(c.id.clone(), t.id.clone())),
                                    })
                                    .collect(),
                            })
                            .collect(),
                    })
                    .collect();

                SceneView::Investigation {
                    id: inv.def.id.clone(),
                    title: inv.def.title.clone(),
                    index: self.current_scene_idx,
                    total,
                    current_sublocation_id: inv.current_sublocation_id.clone(),
                    visible_sublocations,
                }
            }
            SceneRuntime::Interrogation(scene) => {
                let ctx = InterrogationSceneAndInventoryCtx {
                    scene,
                    inventory: &self.inventory,
                };
                // The active cross-examination (if any) belongs to exactly one
                // question, and therefore to exactly one phase. Build it once
                // and attach it to whichever phase owns that question below.
                let cross_exam_view: Option<CrossExamView> = match scene.cross_exam() {
                    CrossExam::Idle => None,
                    CrossExam::Playing {
                        question_id,
                        line_index,
                    } => scene.question(question_id).and_then(|question| {
                        let line = question.testimony.lines.get(*line_index)?;
                        Some(CrossExamView {
                            question_id: question_id.clone(),
                            line_id: line.id.clone(),
                            line_label: line.label.clone(),
                            line_content: line.content.clone(),
                            line_index: *line_index,
                            line_total: question.testimony.lines.len(),
                            presenting: false,
                        })
                    }),
                    CrossExam::Presenting {
                        question_id,
                        line_id,
                    } => scene.question(question_id).and_then(|question| {
                        let line_index = question
                            .testimony
                            .lines
                            .iter()
                            .position(|line| &line.id == line_id)?;
                        let line = &question.testimony.lines[line_index];
                        Some(CrossExamView {
                            question_id: question_id.clone(),
                            line_id: line.id.clone(),
                            line_label: line.label.clone(),
                            line_content: line.content.clone(),
                            line_index,
                            line_total: question.testimony.lines.len(),
                            presenting: true,
                        })
                    }),
                };

                let visible_phases = scene
                    .def
                    .phases
                    .iter()
                    .filter(|phase| scene.is_phase_unlocked(phase, &ctx))
                    .map(|phase| {
                        let InterrogationPhaseJson::Inquiry {
                            id,
                            label,
                            subject,
                            questions,
                            ..
                        } = phase;
                        let cross_exam = cross_exam_view
                            .as_ref()
                            .filter(|cev| questions.iter().any(|q| q.id == cev.question_id))
                            .cloned();
                        InterrogationPhaseView {
                            id: id.clone(),
                            label: label.clone(),
                            subject: SubjectView {
                                id: subject.id.clone(),
                                name: subject.name.clone(),
                                role: subject.role.clone(),
                                bio: subject.bio.clone(),
                            },
                            questions: questions
                                .iter()
                                .filter(|question| scene.is_question_unlocked(question, &ctx))
                                .map(|question| InquiryQuestionView {
                                    id: question.id.clone(),
                                    label: question.label.clone(),
                                    broken: scene.is_question_broken(&question.id),
                                })
                                .collect(),
                            cross_exam,
                            can_complete: scene.current_phase_id.as_deref() == Some(id.as_str())
                                && scene.current_phase_can_complete(),
                        }
                    })
                    .collect();

                SceneView::Interrogation {
                    id: scene.def.id.clone(),
                    title: scene.def.title.clone(),
                    index: self.current_scene_idx,
                    total,
                    current_phase_id: scene.current_phase_id.clone(),
                    visible_phases,
                }
            }
        }
    }
}

fn inventory_target_matches(target: &InventoryTarget, item_kind: &str, item_id: &str) -> bool {
    match target {
        InventoryTarget::Evidence { id } => item_kind == "evidence" && id == item_id,
        InventoryTarget::Statement { id } => item_kind == "statement" && id == item_id,
    }
}

struct SceneAndInventoryCtx<'a> {
    scene: &'a InvestigationSceneState,
    inventory: &'a Inventory,
}
impl<'a> unlock::UnlockContext for SceneAndInventoryCtx<'a> {
    fn evidence_collected(&self, id: &str) -> bool {
        self.inventory.has_evidence(id)
    }
    fn statement_acquired(&self, id: &str) -> bool {
        self.inventory.has_statement(id)
    }
    fn topic_discussed(&self, c: &str, t: &str) -> bool {
        self.scene.topic_discussed(c, t)
    }
    fn hotspot_investigated(&self, id: &str) -> bool {
        self.scene.hotspot_investigated(id)
    }
}

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::scenes::interrogation::InterrogationSceneState;
    use crate::game::scenes::investigation::DialogueQueue;
    use crate::game::schema::{
        AudioChannelJson, AudioCueJson, AutoMarker, CharacterJson, EvidenceJson, HotspotJson,
        InquiryQuestionJson, InterrogationOutroJson, InterrogationOutroUnlock,
        InterrogationPhaseJson, InterrogationRevealTarget, InterrogationSceneJson, InventoryTarget,
        InvestigationSceneJson, LockStatus, OutroJson, OutroUnlock, RevealTarget, SceneJson,
        SceneType, SublocationJson, TestimonyJson, TestimonyLineJson, TopicJson, UnlockExpr,
        VisualAssetCueJson,
    };
    use crate::game::state::{EvidenceRecord, SceneRef, StatementRecord};

    use crate::game::test_support::*;
    #[test]
    fn new_focused_token_records_exactly_one_history_entry() {
        let d = dialogue_history_fixture_resources(3);
        let mut engine = GameEngine::new_started(d).unwrap();
        let before = engine.view().dialogue_history.len();

        let view = engine.advance_dialogue(token_from(&engine.view())).unwrap();

        assert_eq!(
            view.dialogue_history.len(),
            before + 1,
            "a new focused token must append exactly one entry"
        );
    }

    #[test]
    fn unchanged_focused_token_records_nothing() {
        let d = dialogue_history_fixture_resources(3);
        let mut engine = GameEngine::new_started(d).unwrap();
        let token = token_from(&engine.view());
        let after_first = engine.advance_dialogue(token.clone()).unwrap();
        let count = after_first.dialogue_history.len();

        // Replaying the now-stale token does not advance, so the focused token
        // is unchanged and nothing is recorded.
        let view = engine.advance_dialogue(token).unwrap();

        assert_eq!(view.dialogue_history.len(), count);
    }

    #[test]
    fn installing_command_records_despite_advancing_nothing() {
        // inspect_hotspot installs a fresh queue at cursor 0. It advances no
        // existing dialogue, but it does produce a new focused token, so its
        // first item must be logged. Phrasing this contract as "advances" would
        // leave this path — most of the commands — untested.
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Room".into(),
            asset_refs: vec![],
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: VisualAssetCueJson::default(),
                transition_dialogue: vec![],
                hotspots: vec![HotspotJson {
                    id: "desk".into(),
                    label: "Desk".into(),
                    description: "A desk.".into(),
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![],
                    layout: None,
                    inspect_dialogue: vec![DialogueItem::Line {
                        speaker: "A".into(),
                        text: "a drawer is ajar".into(),
                        portrait: None,
                    }],
                    on_reexamine: None,
                }],
                characters: vec![],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: OutroJson {
                // Never satisfied, so inspecting cannot end the scene and the
                // installed queue stays the focused dialogue.
                unlock: OutroUnlock::Expr(UnlockExpr::HotspotInvestigated {
                    _predicate: crate::game::schema::PredicateHotspotInvestigated::X,
                    id: "absent".into(),
                }),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.prime_initial_queue().unwrap();
        let before = engine.view().dialogue_history.len();

        let view = engine.inspect_hotspot("desk").unwrap();

        assert_eq!(
            view.dialogue_history.len(),
            before + 1,
            "an installing command must log its first item"
        );
    }

    /// Source-contract guard. `command_tx` guarantees history finalization only
    /// for commands that use it, and `GameEngine::view` must stay `pub` for
    /// lib.rs, so nothing structurally prevents a new command from returning
    /// `Ok(self.view())` and skipping the log. This scans the engine modules
    /// for that mistake.
    ///
    /// The scan enforces two invariants per tracked function:
    /// 1. Invariant A — the body contains `command_tx(` at least once. Checked
    ///    for every tracked command; `command_tx` is the only mechanism that
    ///    finalizes dialogue history, so there are no exemptions.
    /// 2. Invariant B — the body contains no bare `Ok(self.view())`. A command
    ///    whose advancing branch returns `Ok(self.view())` would silently drop
    ///    dialogue history even if `command_tx(` happens to appear on a side
    ///    branch or in a comment. Checked for every tracked command except
    ///    those listed in `allowed_bare_view` below.
    ///
    /// Weaker than a type guarantee, and deliberately kept until one exists.
    #[test]
    fn every_view_returning_command_routes_through_command_tx() {
        let sources: &[(&str, &str)] = &[
            ("mod.rs", include_str!("mod.rs")),
            ("command_tx.rs", include_str!("command_tx.rs")),
            ("dialogue.rs", include_str!("dialogue.rs")),
            ("navigation.rs", include_str!("navigation.rs")),
        ];
        // Functions allow-listed for invariant B (a bare `Ok(self.view())`
        // return). Each entry must have a documented reason here. Invariant A
        // (calling `command_tx(`) has no exemptions — every tracked command
        // must call it.
        //   advance_dialogue — stale-token early return is not a transaction
        //                      and deliberately records no history.
        let allowed_bare_view: &[&str] = &["advance_dialogue"];

        let mut seen: Vec<String> = Vec::new();
        let mut missing_tx: Vec<String> = Vec::new();
        let mut bare_view: Vec<String> = Vec::new();

        for (file, source) in sources {
            let mut current: Option<String> = None;
            let mut body_has_tx = false;
            let mut body_has_bare_view = false;
            let mut signature = String::new();
            let mut in_signature = false;

            for line in source.lines() {
                let trimmed = line.trim_start();
                if trimmed.starts_with("mod tests {") || trimmed.starts_with("#[cfg(test)]") {
                    break;
                }
                if trimmed.starts_with("pub fn ") {
                    if let Some(name) = current.take() {
                        if !body_has_tx {
                            missing_tx.push(format!("{file}::{name}"));
                        }
                        if body_has_bare_view && !allowed_bare_view.contains(&name.as_str()) {
                            bare_view.push(format!("{file}::{name}"));
                        }
                        body_has_tx = false;
                        body_has_bare_view = false;
                    }
                    signature.clear();
                    signature.push_str(trimmed);
                    in_signature = !trimmed.contains('{');
                    if !in_signature {
                        if let Some(name) = tracked_command_name(&signature) {
                            seen.push(format!("{file}::{name}"));
                            current = Some(name);
                        }
                    }
                    continue;
                }
                if in_signature {
                    signature.push(' ');
                    signature.push_str(trimmed);
                    if trimmed.contains('{') {
                        in_signature = false;
                        if let Some(name) = tracked_command_name(&signature) {
                            seen.push(format!("{file}::{name}"));
                            current = Some(name);
                        }
                    }
                    continue;
                }
                if current.is_some() {
                    if trimmed.contains("command_tx(") {
                        body_has_tx = true;
                    }
                    if trimmed.contains("Ok(self.view())") {
                        body_has_bare_view = true;
                    }
                }
            }
            if let Some(name) = current.take() {
                if !body_has_tx {
                    missing_tx.push(format!("{file}::{name}"));
                }
                if body_has_bare_view && !allowed_bare_view.contains(&name.as_str()) {
                    bare_view.push(format!("{file}::{name}"));
                }
            }
        }

        // A floor, not an emptiness check: a single tracked command would
        // satisfy `!seen.is_empty()` while thirteen others silently dropped
        // out of `seen` (a command deleted, or a module moved out of
        // `sources` above without being re-added — see Task 6, which moves
        // `jump_to_scene` into `navigation.rs`). In that failure mode
        // `missing_tx`/`bare_view` both stay empty because the dropped
        // command is never scanned at all, so only this count catches it.
        // Update the constant — with a comment explaining why — if the true
        // number of tracked commands changes.
        const EXPECTED_TRACKED_COMMAND_COUNT: usize = 13;
        assert!(
            seen.len() >= EXPECTED_TRACKED_COMMAND_COUNT,
            "scanner tracked only {} Result<GameStateView, GameError> command(s), expected at \
             least {EXPECTED_TRACKED_COMMAND_COUNT}; a command was deleted, or a module was \
             moved out of `sources` above without being re-added, and silently stopped being \
             checked: {seen:?}. If a command was legitimately removed, lower this constant in \
             the same commit that removes it — never to silence this failure.",
            seen.len()
        );
        assert!(
            missing_tx.is_empty(),
            "these commands return Result<GameStateView, GameError> but never call \
             command_tx(), so they can silently skip dialogue history (invariant A): \
             {missing_tx:?} (tracked: {seen:?})"
        );
        assert!(
            bare_view.is_empty(),
            "these commands return Result<GameStateView, GameError> and contain a bare \
             `Ok(self.view())` — an advancing path returning this silently drops dialogue \
             history, even if command_tx() also appears elsewhere in the body (invariant B). \
             If this is a documented non-advancing early return (e.g. a stale-token guard), \
             add the function name to `allowed_bare_view` above with a justification: \
             {bare_view:?} (tracked: {seen:?})"
        );
    }

    /// Extracts the fn name from an accumulated signature if it returns a view.
    fn tracked_command_name(signature: &str) -> Option<String> {
        if !signature.contains("-> Result<GameStateView, GameError>") {
            return None;
        }
        let after = signature.strip_prefix("pub fn ")?;
        Some(
            after
                .split(|c: char| c == '(' || c.is_whitespace())
                .next()?
                .to_string(),
        )
    }

    #[test]
    fn flattened_sublocation_asset_fields_reach_explore_view() {
        let json = r#"{
            "type": "investigation",
            "id": "investigation_scene_1",
            "title": "Investigation",
            "intro": [],
            "sublocations": [{
                "id": "cafe",
                "label": "Cafe",
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "咖啡館",
                "backgroundAssetId": "background.chapter_1.cafe",
                "bgm": { "channel": "bgm", "assetId": "audio.bgm.cafe" },
                "bgs": { "channel": "bgs", "assetId": "audio.bgs.rain" },
                "transitionDialogue": [],
                "hotspots": [],
                "characters": []
            }],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": { "predicate": "hotspot_investigated", "id": "never" }, "dialogue": [] }
        }"#;
        let scene = match serde_json::from_str(json).unwrap() {
            SceneJson::Investigation(scene) => scene,
            other => panic!("expected investigation scene, got {other:?}"),
        };
        let mut engine = empty_engine_with_scene(scene, 1);

        engine.prime_initial_queue().unwrap();

        match engine.view().mode {
            ModeView::Explore {
                sublocation_id,
                background_asset_id,
                bgm,
                bgs,
            } => {
                assert_eq!(sublocation_id, "cafe");
                assert_eq!(
                    background_asset_id.as_deref(),
                    Some("background.chapter_1.cafe")
                );
                let bgm = bgm.unwrap();
                assert_eq!(bgm.channel, AudioChannelJson::Bgm);
                assert_eq!(bgm.asset_id.as_deref(), Some("audio.bgm.cafe"));
                let bgs = bgs.unwrap();
                assert_eq!(bgs.channel, AudioChannelJson::Bgs);
                assert_eq!(bgs.asset_id.as_deref(), Some("audio.bgs.rain"));
            }
            other => panic!("expected explore mode, got {other:?}"),
        }
    }

    #[test]
    fn flattened_interrogation_phase_asset_fields_reach_interrogation_view() {
        let json = r#"{
            "type": "interrogation",
            "id": "interrogation_scene_1",
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
                "sceneTag": "詢問室",
                "backgroundAssetId": "background.chapter_1.interrogation",
                "bgm": { "channel": "bgm", "assetId": "audio.bgm.tension" },
                "bgs": { "channel": "bgs", "assetId": "audio.bgs.roomtone" },
                "entryDialogue": [],
                "complete": "auto",
                "questions": [{
                    "id": "q1",
                    "label": "問題一",
                    "status": "unlocked",
                    "required": true,
                    "unlock": null,
                    "reveals": [],
                    "testimony": {
                        "onLoop": [{ "kind": "line", "speaker": "witness", "text": "沒有別的了。" }],
                        "lines": [{
                            "id": "l1",
                            "label": "行1",
                            "content": [{ "kind": "line", "speaker": "witness", "text": "我在店裡。" }],
                            "contradiction": null
                        }]
                    }
                }]
            }],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": { "predicate": "phase_completed", "id": "phase_1" }, "dialogue": [] }
        }"#;
        let scene = match serde_json::from_str(json).unwrap() {
            SceneJson::Interrogation(scene) => scene,
            other => panic!("expected interrogation scene, got {other:?}"),
        };
        let mut engine = GameEngine {
            resources_dir: PathBuf::new(),
            chapters: vec![ChapterManifest {
                id: "chapter_1".into(),
                title: "Chapter 1".into(),
                summary: "summary".into(),
                scenes: vec![SceneRef {
                    scene_type: SceneType::Interrogation,
                    file: "chapter_1/interrogation_scene_1.json".into(),
                }],
            }],
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: SceneRuntime::Interrogation(Box::new(InterrogationSceneState::from_json(
                scene, 1,
            ))),
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            history: dialogue::DialogueHistory::default(),
        };

        engine.prime_initial_queue().unwrap();

        match engine.view().mode {
            ModeView::Interrogation {
                phase_id,
                background_asset_id,
                bgm,
                bgs,
            } => {
                assert_eq!(phase_id, "phase_1");
                assert_eq!(
                    background_asset_id.as_deref(),
                    Some("background.chapter_1.interrogation")
                );
                let bgm = bgm.unwrap();
                assert_eq!(bgm.channel, AudioChannelJson::Bgm);
                assert_eq!(bgm.asset_id.as_deref(), Some("audio.bgm.tension"));
                let bgs = bgs.unwrap();
                assert_eq!(bgs.channel, AudioChannelJson::Bgs);
                assert_eq!(bgs.asset_id.as_deref(), Some("audio.bgs.roomtone"));
            }
            other => panic!("expected interrogation mode, got {other:?}"),
        }
    }

    #[test]
    fn visual_cue_preserves_omitted_audio_channels_and_applies_explicit_stops() {
        let mut cue = LastVisualCue {
            scene_tag: Some("old".into()),
            background_asset_id: Some("background.old".into()),
            bgm: Some(AudioCueJson {
                channel: AudioChannelJson::Bgm,
                asset_id: Some("audio.bgm.old".into()),
            }),
            bgs: Some(AudioCueJson {
                channel: AudioChannelJson::Bgs,
                asset_id: Some("audio.bgs.old".into()),
            }),
        };

        cue.set_scene_tag(
            "new".into(),
            Some(VisualAssetCueJson {
                background_asset_id: Some("background.new".into()),
                bgm: None,
                bgs: Some(AudioCueJson {
                    channel: AudioChannelJson::Bgs,
                    asset_id: None,
                }),
            }),
        );

        assert_eq!(cue.scene_tag.as_deref(), Some("new"));
        assert_eq!(cue.background_asset_id.as_deref(), Some("background.new"));
        assert_eq!(cue.bgm.unwrap().asset_id.as_deref(), Some("audio.bgm.old"));
        assert_eq!(cue.bgs.unwrap().asset_id, None);
    }

    #[test]
    fn interrogation_view_reflects_active_cross_exam() {
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        match &mut engine.scene {
            SceneRuntime::Interrogation(scene) => scene.begin_question("alibi"),
            _ => panic!("expected interrogation scene"),
        }

        match engine.view().scene {
            SceneView::Interrogation { visible_phases, .. } => {
                let phase = visible_phases
                    .iter()
                    .find(|phase| phase.id == "press")
                    .expect("press phase should be visible");
                let question = phase
                    .questions
                    .iter()
                    .find(|question| question.id == "alibi")
                    .expect("alibi question should be visible");
                assert!(!question.broken);

                let cross_exam = phase
                    .cross_exam
                    .as_ref()
                    .expect("cross_exam should be Some while playing a testimony line");
                assert_eq!(cross_exam.question_id, "alibi");
                assert_eq!(cross_exam.line_id, "l_off");
                assert_eq!(cross_exam.line_index, 0);
                assert_eq!(cross_exam.line_total, 2);
                assert!(!cross_exam.presenting);
            }
            other => panic!("expected interrogation scene view, got {other:?}"),
        }
    }

    #[test]
    fn interrogation_enters_empty_inquiry_before_auto_completion() {
        let mut engine =
            empty_engine_with_interrogation_scene(empty_inquiry_interrogation_scene(), 1);

        engine.prime_initial_queue().unwrap();

        assert!(engine.inventory.has_evidence("note"));
        assert_eq!(
            engine.last_visual_cue.scene_tag.as_deref(),
            Some("interrogation_room")
        );
        let view = engine.view();
        match view.mode {
            ModeView::Dialogue {
                current, scene_tag, ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "A" && text == "entry")
                );
                assert_eq!(scene_tag.as_deref(), Some("interrogation_room"));
            }
            other => panic!("expected entry dialogue before auto-completion, got {other:?}"),
        }
    }

    #[test]
    fn interrogation_without_available_phase_and_unsatisfied_outro_errors_instead_of_completing() {
        let mut engine =
            empty_engine_with_interrogation_scene(locked_unsatisfied_interrogation_scene(), 1);

        let err = engine.prime_initial_queue().unwrap_err();

        assert_eq!(err.code, "sceneValidationFailed");
    }

    #[test]
    fn interrogation_enters_inventory_unlocked_phase_after_refresh() {
        let mut engine = empty_engine_with_interrogation_scene(
            locked_inventory_unlocked_interrogation_scene(),
            1,
        );
        engine.inventory.evidence.push(EvidenceRecord {
            id: "key".into(),
            name: "Key".into(),
            description: "Key".into(),
            details: "Key".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "previous_scene".into(),
        });

        engine.prime_initial_queue().unwrap();

        assert!(engine.inventory.has_evidence("note"));
        assert_eq!(
            engine.last_visual_cue.scene_tag.as_deref(),
            Some("interrogation_room")
        );
        let token = token_from(&engine.view());
        let view = engine.advance_dialogue(token).unwrap();
        match view.mode {
            ModeView::Interrogation { phase_id, .. } => {
                assert_eq!(phase_id, "inventory_unlocked_inquiry");
            }
            other => panic!("expected interrogation mode after phase entry, got {other:?}"),
        }
    }

    #[test]
    fn interrogation_enters_earlier_inventory_unlocked_phase_before_later_static_phase() {
        let mut engine = empty_engine_with_interrogation_scene(
            source_order_inventory_unlocked_interrogation_scene(),
            1,
        );
        engine.inventory.evidence.push(EvidenceRecord {
            id: "key".into(),
            name: "Key".into(),
            description: "Key".into(),
            details: "Key".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "previous_scene".into(),
        });

        engine.prime_initial_queue().unwrap();

        assert!(engine.inventory.has_evidence("early_note"));
        assert!(!engine.inventory.has_evidence("late_note"));
        assert_eq!(
            engine.last_visual_cue.scene_tag.as_deref(),
            Some("early_room")
        );
        let view = engine.view();
        match view.mode {
            ModeView::Dialogue {
                current, scene_tag, ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "A" && text == "early entry")
                );
                assert_eq!(scene_tag.as_deref(), Some("early_room"));
            }
            other => panic!("expected early phase entry dialogue, got {other:?}"),
        }
    }

    #[test]
    fn outro_skips_optional_phase_after_required_completion() {
        let inquiry_phase = |id: &str,
                             required: bool,
                             question_id: &str,
                             reveals: Vec<InterrogationRevealTarget>,
                             entry_dialogue: Vec<DialogueItem>| {
            InterrogationPhaseJson::Inquiry {
                id: id.into(),
                label: id.into(),
                subject: subject(),
                required,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals,
                scene_tag: "interrogation_room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue,
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![crate::game::schema::InquiryQuestionJson {
                    id: question_id.into(),
                    label: question_id.into(),
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![],
                    testimony: empty_testimony(),
                }],
            }
        };
        let scene = InterrogationSceneJson {
            id: "interrogation_scene_1".into(),
            title: "Interrogation".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![
                inquiry_phase("required_inquiry", true, "required_q", vec![], vec![]),
                inquiry_phase(
                    "optional_inquiry",
                    false,
                    "optional_q",
                    vec![InterrogationRevealTarget::Evidence {
                        id: "optional_leak".into(),
                    }],
                    vec![DialogueItem::Line {
                        speaker: "A".into(),
                        text: "optional entry".into(),
                        portrait: None,
                    }],
                ),
            ],
            evidence_manifest: vec![EvidenceJson {
                id: "optional_leak".into(),
                name: "Optional Leak".into(),
                description: "Optional Leak".into(),
                details: "Optional Leak".into(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            }],
            statement_manifest: vec![],
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                dialogue: vec![DialogueItem::Line {
                    speaker: "A".into(),
                    text: "outro".into(),
                    portrait: None,
                }],
            },
        };
        let mut engine = empty_engine_with_interrogation_scene(scene, 1);

        engine.prime_initial_queue().unwrap();
        assert!(matches!(
            engine.view().mode,
            ModeView::Interrogation { ref phase_id, .. } if phase_id == "required_inquiry"
        ));

        // Ask the required question: its empty (contradiction-free) testimony
        // auto-breaks and returns to the menu on its own. Manually complete the
        // phase — the outro fires and skips the optional phase.
        engine.ask_interrogation_question("required_q").unwrap();
        let view = engine.complete_interrogation_phase().unwrap();

        assert!(!engine.inventory.has_evidence("optional_leak"));
        if let SceneRuntime::Interrogation(scene) = &engine.scene {
            assert!(!scene.phase_entered("optional_inquiry"));
        } else {
            panic!("expected interrogation scene");
        }
        match view.mode {
            ModeView::Dialogue { current, .. } => {
                assert!(
                    matches!(&current, DialogueItem::Line { speaker, text, .. } if speaker == "A" && text == "outro"),
                    "expected outro dialogue, got {current:?}"
                );
            }
            other => panic!("expected outro dialogue after required completion, got {other:?}"),
        }
    }

    #[test]
    fn ask_interrogation_question_rejects_question_from_non_current_phase() {
        // Two unlocked phases. The required phase is current; the optional
        // phase is unlocked (so its question's own unlock is satisfied) but
        // has not been entered. Asking the optional phase's question must be
        // rejected — otherwise its reveals would fire before the phase's
        // entry dialogue and before the engine accounts for it as a
        // cross-exam in the current phase.
        let inquiry_phase = |id: &str,
                             required: bool,
                             question_id: &str,
                             reveals: Vec<InterrogationRevealTarget>| {
            InterrogationPhaseJson::Inquiry {
                id: id.into(),
                label: id.into(),
                subject: subject(),
                required,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals,
                scene_tag: "interrogation_room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![crate::game::schema::InquiryQuestionJson {
                    id: question_id.into(),
                    label: question_id.into(),
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![],
                    testimony: empty_testimony(),
                }],
            }
        };
        let scene = InterrogationSceneJson {
            id: "interrogation_scene_1".into(),
            title: "Interrogation".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![
                inquiry_phase("required_inquiry", true, "required_q", vec![]),
                inquiry_phase(
                    "optional_inquiry",
                    false,
                    "optional_q",
                    vec![InterrogationRevealTarget::Evidence {
                        id: "optional_leak".into(),
                    }],
                ),
            ],
            evidence_manifest: vec![EvidenceJson {
                id: "optional_leak".into(),
                name: "Optional Leak".into(),
                description: "Optional Leak".into(),
                details: "Optional Leak".into(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            }],
            statement_manifest: vec![],
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                dialogue: vec![DialogueItem::Line {
                    speaker: "A".into(),
                    text: "outro".into(),
                    portrait: None,
                }],
            },
        };
        let mut engine = empty_engine_with_interrogation_scene(scene, 1);
        engine.prime_initial_queue().unwrap();
        assert!(matches!(
            engine.view().mode,
            ModeView::Interrogation { ref phase_id, .. } if phase_id == "required_inquiry"
        ));

        // Asking the optional phase's question while the required phase is
        // current must be rejected as locked, and must not grant the reveal.
        let err = engine.ask_interrogation_question("optional_q").unwrap_err();
        assert_eq!(err.code, "lockedInterrogationQuestion");
        assert!(!engine.inventory.has_evidence("optional_leak"));
        if let SceneRuntime::Interrogation(scene) = &engine.scene {
            assert!(!scene.is_question_broken("optional_q"));
            assert_eq!(
                scene.current_phase_id().as_deref(),
                Some("required_inquiry")
            );
        } else {
            panic!("expected interrogation scene");
        }

        // A genuinely unknown question still surfaces the distinct error.
        let err = engine
            .ask_interrogation_question("no_such_question")
            .unwrap_err();
        assert_eq!(err.code, "unknownInterrogationQuestion");
    }

    #[test]
    fn reexamine_evidence_records_reexamine_dialogue_in_history() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-reexamine-evidence-history-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        // The reexamine queue does not exhaust (it holds a real Line), so the
        // next scene is never loaded and a valid file is not required.
        fs::write(
            chapter_dir.join("interrogation_scene_2.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_2",
                "title": "Next",
                "queue": [{ "kind": "line", "speaker": "Z", "text": "next" }]
            }"#,
        )
        .unwrap();

        let inventory = Inventory {
            evidence: vec![EvidenceRecord {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
                image_asset_id: None,
                on_reexamine: Some(vec![DialogueItem::Line {
                    speaker: "Detective".into(),
                    text: "reexamining note".into(),
                    portrait: None,
                }]),
                collected_in_chapter_id: "chapter_1".into(),
                collected_in_scene_id: "interrogation_scene_1".into(),
            }],
            statements: vec![],
        };
        let mut engine = completed_interrogation_engine_with_bad_next_scene(d.clone(), inventory);

        let view = engine.reexamine_evidence("note").unwrap();

        assert_eq!(history_labels(&view), vec!["Detective: reexamining note"]);

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn reexamine_statement_records_reexamine_dialogue_in_history() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-reexamine-statement-history-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_2.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_2",
                "title": "Next",
                "queue": [{ "kind": "line", "speaker": "Z", "text": "next" }]
            }"#,
        )
        .unwrap();

        let inventory = Inventory {
            evidence: vec![],
            statements: vec![StatementRecord {
                id: "alibi".into(),
                speaker: "Witness".into(),
                content: "Alibi".into(),
                on_reexamine: Some(vec![DialogueItem::Line {
                    speaker: "Detective".into(),
                    text: "reexamining alibi".into(),
                    portrait: None,
                }]),
                acquired_in_chapter_id: "chapter_1".into(),
                acquired_in_scene_id: "interrogation_scene_1".into(),
            }],
        };
        let mut engine = completed_interrogation_engine_with_bad_next_scene(d.clone(), inventory);

        let view = engine.reexamine_statement("alibi").unwrap();

        assert_eq!(history_labels(&view), vec!["Detective: reexamining alibi"]);

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn present_interrogation_evidence_rejects_non_interrogation_before_missing_inventory() {
        let scene = investigation_scene_with_intro("investigation_scene_1", vec![]);
        let mut engine = empty_engine_with_scene(scene, 1);

        let err = engine
            .present_interrogation_evidence("l_off", "evidence", "missing")
            .unwrap_err();

        assert_eq!(err.code, "wrongMode");
    }

    #[test]
    fn present_interrogation_evidence_rejects_active_dialogue_before_not_presenting() {
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!("expected interrogation scene");
        };
        scene.pending_queue = Some(DialogueQueue {
            items: vec![DialogueItem::Action {
                text: "dialogue".into(),
            }],
            cursor: 0,
            queue_gen: 2,
        });

        let err = engine
            .present_interrogation_evidence("l_deny", "evidence", "missing")
            .unwrap_err();

        assert_eq!(err.code, "dialogueActive");
    }

    #[test]
    fn present_interrogation_evidence_rejects_when_not_presenting_before_missing_inventory() {
        // cross_exam is Idle (no ask/challenge yet) — the "must be
        // Presenting" guard should fire before the inventory-target lookup,
        // mirroring the old model's "unknown statement resolved before
        // missing inventory" ordering guarantee.
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);

        let err = engine
            .present_interrogation_evidence("l_deny", "evidence", "missing_item")
            .unwrap_err();

        assert_eq!(err.code, "notInCrossExamination");
    }

    #[test]
    fn silent_first_hotspot_action_can_complete_scene() {
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            asset_refs: vec![],
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                transition_dialogue: vec![],
                hotspots: vec![HotspotJson {
                    id: "desk".into(),
                    label: "Desk".into(),
                    description: "Desk".into(),
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![RevealTarget::Evidence { id: "note".into() }],
                    layout: None,
                    inspect_dialogue: vec![],
                    on_reexamine: None,
                }],
                characters: vec![],
            }],
            evidence_manifest: vec![EvidenceJson {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            }],
            statement_manifest: vec![],
            outro: OutroJson {
                unlock: OutroUnlock::Expr(UnlockExpr::EvidenceCollected {
                    _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                    id: "note".into(),
                }),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.prime_initial_queue().unwrap();

        let view = engine.inspect_hotspot("desk").unwrap();
        assert!(matches!(view.mode, ModeView::GameComplete));
    }

    #[test]
    fn silent_first_topic_action_can_complete_scene() {
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            asset_refs: vec![],
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                transition_dialogue: vec![],
                hotspots: vec![],
                characters: vec![CharacterJson {
                    id: "witness".into(),
                    name: "Witness".into(),
                    role: "Witness".into(),
                    bio: "Witness".into(),
                    layout: None,
                    topics: vec![TopicJson {
                        id: "alibi".into(),
                        label: "Alibi".into(),
                        status: LockStatus::Unlocked,
                        unlock: None,
                        reveals: vec![RevealTarget::Statement {
                            id: "alibi_statement".into(),
                        }],
                        topic_dialogue: vec![],
                        on_reexamine: None,
                    }],
                }],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![crate::game::schema::StatementJson {
                id: "alibi_statement".into(),
                speaker: "Witness".into(),
                content: "I was elsewhere".into(),
                on_acquire: vec![],
                on_reexamine: None,
            }],
            outro: OutroJson {
                unlock: OutroUnlock::Expr(UnlockExpr::StatementAcquired {
                    _predicate: crate::game::schema::PredicateStatementAcquired::X,
                    id: "alibi_statement".into(),
                }),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.prime_initial_queue().unwrap();

        let view = engine.interview_topic("witness", "alibi").unwrap();
        assert!(matches!(view.mode, ModeView::GameComplete));
    }

    #[test]
    fn inventory_reexamine_returns_game_complete_after_completion() {
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            asset_refs: vec![],
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                transition_dialogue: vec![],
                hotspots: vec![],
                characters: vec![],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: OutroJson {
                unlock: OutroUnlock::Auto(crate::game::schema::AutoMarker::Auto),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_scene(scene, 1);
        engine
            .inventory
            .evidence
            .push(crate::game::state::EvidenceRecord {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
                image_asset_id: None,
                on_reexamine: Some(vec![DialogueItem::Line {
                    speaker: "A".into(),
                    text: "look".into(),
                    portrait: None,
                }]),
                collected_in_chapter_id: "chapter_1".into(),
                collected_in_scene_id: "investigation_scene_1".into(),
            });
        engine
            .inventory
            .statements
            .push(crate::game::state::StatementRecord {
                id: "alibi".into(),
                speaker: "Witness".into(),
                content: "I was elsewhere".into(),
                on_reexamine: Some(vec![DialogueItem::Line {
                    speaker: "Witness".into(),
                    text: "again".into(),
                    portrait: None,
                }]),
                acquired_in_chapter_id: "chapter_1".into(),
                acquired_in_scene_id: "investigation_scene_1".into(),
            });
        engine.current_chapter_idx = engine.chapters.len();

        let evidence_err = engine.reexamine_evidence("note").unwrap_err();
        assert_eq!(evidence_err.code, "gameComplete");

        let statement_err = engine.reexamine_statement("alibi").unwrap_err();
        assert_eq!(statement_err.code, "gameComplete");
    }

    #[test]
    fn action_commands_return_game_complete_after_completion() {
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            asset_refs: vec![],
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                transition_dialogue: vec![],
                hotspots: vec![],
                characters: vec![],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: OutroJson {
                unlock: OutroUnlock::Auto(crate::game::schema::AutoMarker::Auto),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.current_chapter_idx = engine.chapters.len();

        let inspect_err = engine.inspect_hotspot("any_hotspot").unwrap_err();
        assert_eq!(inspect_err.code, "gameComplete");

        let interview_err = engine.interview_topic("any_char", "any_topic").unwrap_err();
        assert_eq!(interview_err.code, "gameComplete");

        let enter_err = engine.enter_sublocation("any_sub").unwrap_err();
        assert_eq!(enter_err.code, "gameComplete");
    }

    #[test]
    fn silent_sublocation_entry_can_complete_scene() {
        // Scene with two unlocked sublocations. Room A is the first.
        // Entering room B on first visit reveals evidence that satisfies the Outro.
        // The transition dialogue is empty, so the queue is empty after entry.
        // The engine should detect the satisfied Outro and advance to GameComplete.
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            asset_refs: vec![],
            intro: vec![],
            sublocations: vec![
                SublocationJson {
                    id: "room_a".into(),
                    label: "Room A".into(),
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![],
                    scene_tag: "room_a".into(),
                    flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                    transition_dialogue: vec![],
                    hotspots: vec![],
                    characters: vec![],
                },
                SublocationJson {
                    id: "room_b".into(),
                    label: "Room B".into(),
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![RevealTarget::Evidence { id: "note".into() }],
                    scene_tag: "room_b".into(),
                    flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                    transition_dialogue: vec![],
                    hotspots: vec![],
                    characters: vec![],
                },
            ],
            evidence_manifest: vec![EvidenceJson {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            }],
            statement_manifest: vec![],
            outro: OutroJson {
                unlock: OutroUnlock::Expr(UnlockExpr::EvidenceCollected {
                    _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                    id: "note".into(),
                }),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.prime_initial_queue().unwrap();

        // Player is in room_a (first unlocked sublocation). Enter room_b.
        let view = engine.enter_sublocation("room_b").unwrap();
        assert!(matches!(view.mode, ModeView::GameComplete));
    }

    #[test]
    fn silent_initial_sublocation_entry_runs_outro_check() {
        // First sublocation's reveals satisfy the outro on initial entry.
        // With the fix, prime_initial_queue triggers on_queue_exhausted which
        // detects the satisfied outro and advances to GameComplete.
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            asset_refs: vec![],
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![RevealTarget::Evidence { id: "note".into() }],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                transition_dialogue: vec![],
                hotspots: vec![],
                characters: vec![],
            }],
            evidence_manifest: vec![EvidenceJson {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            }],
            statement_manifest: vec![],
            outro: OutroJson {
                unlock: OutroUnlock::Expr(UnlockExpr::EvidenceCollected {
                    _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                    id: "note".into(),
                }),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.prime_initial_queue().unwrap();

        // The initial entry reveal collected "note" which satisfies the outro.
        // on_queue_exhausted should fire, advancing to GameComplete.
        assert!(matches!(engine.view().mode, ModeView::GameComplete));
    }

    #[test]
    fn correct_present_dialogue_plays_before_reveal_on_collect() {
        use crate::game::schema::{
            InterrogationOutroJson, InterrogationOutroUnlock, InterrogationPhaseJson,
            InterrogationRevealTarget, InterrogationSceneJson, StatementJson,
        };

        // Build an inquiry question whose correct-present testimony line has
        // both dialogue and a reveal of a statement whose on_acquire text
        // should appear AFTER the on_correct dialogue.
        let scene = InterrogationSceneJson {
            id: "ordering_test".into(),
            title: "Ordering Test".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![InterrogationPhaseJson::Inquiry {
                id: "testimony".into(),
                label: "Testimony".into(),
                subject: subject(),
                required: true,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![InquiryQuestionJson {
                    id: "q1".into(),
                    label: "Q1".into(),
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![],
                    testimony: TestimonyJson {
                        on_loop: vec![],
                        loop_prompt: vec![],
                        default_challenge: vec![],
                        default_wrong: vec![],
                        wrong_reply: vec![],
                        lines: vec![TestimonyLineJson {
                            id: "l1".into(),
                            label: "L1".into(),
                            content: vec![DialogueItem::Line {
                                speaker: "suspect".into(),
                                text: "I am innocent.".into(),
                                portrait: None,
                            }],
                            contradiction: Some(InventoryTarget::Evidence {
                                id: "contradiction_ev".into(),
                            }),
                            challenge: vec![DialogueItem::Action {
                                text: "challenge".into(),
                            }],
                            on_correct: vec![DialogueItem::Line {
                                speaker: "Detective".into(),
                                text: "Contradiction explained!".into(),
                                portrait: None,
                            }],
                            on_wrong_evidence: vec![],
                            reveals: vec![InterrogationRevealTarget::Statement {
                                id: "acquired_stmt".into(),
                            }],
                        }],
                    },
                }],
            }],
            evidence_manifest: vec![EvidenceJson {
                id: "contradiction_ev".into(),
                name: "Contradiction".into(),
                description: "d".into(),
                details: "d".into(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            }],
            statement_manifest: vec![StatementJson {
                id: "acquired_stmt".into(),
                speaker: "Witness".into(),
                content: "The truth".into(),
                on_acquire: vec![DialogueItem::Line {
                    speaker: "Narrator".into(),
                    text: "Statement acquired: the truth".into(),
                    portrait: None,
                }],
                on_reexamine: None,
            }],
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_interrogation_scene(scene, 1);

        // Pre-load the contradiction evidence so present succeeds.
        engine.inventory.evidence.push(EvidenceRecord {
            id: "contradiction_ev".into(),
            name: "Contradiction".into(),
            description: "d".into(),
            details: "d".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "previous_scene".into(),
        });

        engine.prime_initial_queue().unwrap();
        assert!(matches!(engine.view().mode, ModeView::Interrogation { .. }));

        // Ask the question, drain its testimony-line content, then challenge
        // to reach Presenting.
        let ask_view = engine.ask_interrogation_question("q1").unwrap();
        engine.advance_dialogue(token_from(&ask_view)).unwrap();

        let challenge_view = engine.challenge_interrogation_line("l1").unwrap();
        engine
            .advance_dialogue(token_from(&challenge_view))
            .unwrap();

        // Present the correct evidence.
        let view = engine
            .present_interrogation_evidence("l1", "evidence", "contradiction_ev")
            .unwrap();

        // We should be in Dialogue mode with on_correct dialogue first, then
        // on_acquire text.  Advance and verify ordering.
        match &view.mode {
            ModeView::Dialogue {
                current,
                queue_remaining,
                ..
            } => {
                // First item: the on_correct dialogue (narrative explanation).
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "Detective" && text == "Contradiction explained!"),
                    "Expected on_correct dialogue first, got {:?}",
                    current
                );
                assert_eq!(
                    *queue_remaining, 1,
                    "Expected 1 remaining item (on_acquire text)"
                );

                // Advance to the next item: on_acquire text from the reveal.
                let tok = token_from(&view);
                let view2 = engine.advance_dialogue(tok).unwrap();
                match &view2.mode {
                    ModeView::Dialogue { current, .. } => {
                        assert!(
                            matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "Narrator" && text == "Statement acquired: the truth"),
                            "Expected on_acquire text second, got {:?}",
                            current
                        );
                    }
                    other => panic!(
                        "Expected Dialogue mode for on_acquire text, got {:?}",
                        other
                    ),
                }
            }
            other => panic!(
                "Expected Dialogue mode after correct present, got {:?}",
                other
            ),
        }

        // The question should now be broken and the phase completed.
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        assert!(scene.is_question_broken("q1"));
    }

    #[test]
    fn present_correct_applies_question_level_reveals() {
        use crate::game::schema::{
            InterrogationOutroJson, InterrogationOutroUnlock, InterrogationPhaseJson,
            InterrogationRevealTarget, InterrogationSceneJson, StatementJson,
        };

        // The reveal lives at the QUESTION level (question.reveals) while the
        // contradiction line carries NO line-level reveals. Breaking the
        // question by presenting correct evidence must still collect the
        // question-level revealed statement.
        let scene = InterrogationSceneJson {
            id: "q_reveal_present".into(),
            title: "Q Reveal Present".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![InterrogationPhaseJson::Inquiry {
                id: "phase".into(),
                label: "Phase".into(),
                subject: subject(),
                required: true,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![InquiryQuestionJson {
                    id: "q1".into(),
                    label: "Q1".into(),
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![InterrogationRevealTarget::Statement {
                        id: "revealed_stmt".into(),
                    }],
                    testimony: TestimonyJson {
                        on_loop: vec![],
                        loop_prompt: vec![],
                        default_challenge: vec![],
                        default_wrong: vec![],
                        wrong_reply: vec![],
                        lines: vec![TestimonyLineJson {
                            id: "l1".into(),
                            label: "L1".into(),
                            content: vec![DialogueItem::Line {
                                speaker: "suspect".into(),
                                text: "I am innocent.".into(),
                                portrait: None,
                            }],
                            contradiction: Some(InventoryTarget::Evidence {
                                id: "contradiction_ev".into(),
                            }),
                            challenge: vec![DialogueItem::Action {
                                text: "challenge".into(),
                            }],
                            on_correct: vec![DialogueItem::Line {
                                speaker: "Detective".into(),
                                text: "Broken!".into(),
                                portrait: None,
                            }],
                            on_wrong_evidence: vec![],
                            reveals: vec![], // NO line-level reveals
                        }],
                    },
                }],
            }],
            evidence_manifest: vec![EvidenceJson {
                id: "contradiction_ev".into(),
                name: "Contradiction".into(),
                description: "d".into(),
                details: "d".into(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            }],
            statement_manifest: vec![StatementJson {
                id: "revealed_stmt".into(),
                speaker: "Witness".into(),
                content: "The truth".into(),
                on_acquire: vec![],
                on_reexamine: None,
            }],
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_interrogation_scene(scene, 1);
        engine.inventory.evidence.push(EvidenceRecord {
            id: "contradiction_ev".into(),
            name: "Contradiction".into(),
            description: "d".into(),
            details: "d".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "previous_scene".into(),
        });
        engine.prime_initial_queue().unwrap();

        let ask_view = engine.ask_interrogation_question("q1").unwrap();
        engine.advance_dialogue(token_from(&ask_view)).unwrap();
        let challenge_view = engine.challenge_interrogation_line("l1").unwrap();
        engine
            .advance_dialogue(token_from(&challenge_view))
            .unwrap();
        engine
            .present_interrogation_evidence("l1", "evidence", "contradiction_ev")
            .unwrap();

        assert!(
            engine.inventory.has_statement("revealed_stmt"),
            "question-level reveal should collect the statement on break"
        );
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        assert!(scene.is_question_broken("q1"));
    }

    #[test]
    fn honest_question_auto_break_applies_question_level_reveals() {
        use crate::game::schema::{
            InterrogationOutroJson, InterrogationOutroUnlock, InterrogationPhaseJson,
            InterrogationRevealTarget, InterrogationSceneJson, StatementJson,
        };

        // An honest question (no contradiction line) auto-breaks the moment
        // it is asked. Its question-level reveal must fire even though there
        // is no On Correct line to carry it. A second REQUIRED question keeps
        // the phase from vacuously completing and ending the game.
        let scene = InterrogationSceneJson {
            id: "q_reveal_ask".into(),
            title: "Q Reveal Ask".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![InterrogationPhaseJson::Inquiry {
                id: "phase".into(),
                label: "Phase".into(),
                subject: subject(),
                required: true,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![
                    InquiryQuestionJson {
                        id: "honest_q".into(),
                        label: "Honest".into(),
                        status: LockStatus::Unlocked,
                        required: false,
                        unlock: None,
                        reveals: vec![InterrogationRevealTarget::Statement {
                            id: "revealed_stmt".into(),
                        }],
                        testimony: TestimonyJson {
                            on_loop: vec![],
                            loop_prompt: vec![],
                            default_challenge: vec![],
                            default_wrong: vec![],
                            wrong_reply: vec![],
                            lines: vec![TestimonyLineJson {
                                id: "h1".into(),
                                label: "H1".into(),
                                content: vec![DialogueItem::Line {
                                    speaker: "suspect".into(),
                                    text: "Nothing to hide.".into(),
                                    portrait: None,
                                }],
                                contradiction: None, // honest -> auto-break on ask
                                challenge: vec![],
                                on_correct: vec![],
                                on_wrong_evidence: vec![],
                                reveals: vec![],
                            }],
                        },
                    },
                    // Keeps the phase incomplete so asking only the honest
                    // question does not complete the game.
                    InquiryQuestionJson {
                        id: "required_q".into(),
                        label: "Required".into(),
                        status: LockStatus::Unlocked,
                        required: true,
                        unlock: None,
                        reveals: vec![],
                        testimony: TestimonyJson {
                            on_loop: vec![],
                            loop_prompt: vec![],
                            default_challenge: vec![],
                            default_wrong: vec![],
                            wrong_reply: vec![],
                            lines: vec![],
                        },
                    },
                ],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![StatementJson {
                id: "revealed_stmt".into(),
                speaker: "Witness".into(),
                content: "The truth".into(),
                on_acquire: vec![],
                on_reexamine: None,
            }],
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_interrogation_scene(scene, 1);
        engine.prime_initial_queue().unwrap();

        engine.ask_interrogation_question("honest_q").unwrap();

        assert!(
            engine.inventory.has_statement("revealed_stmt"),
            "honest-question auto-break should fire its question-level reveal"
        );
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        assert!(scene.is_question_broken("honest_q"));
    }

    #[test]
    fn complete_interrogation_phase_errors_when_required_unbroken() {
        let mut engine = empty_engine_with_interrogation_scene(single_required_question_scene(), 1);
        engine.prime_initial_queue().unwrap();

        // At the menu with the required question still unbroken.
        let err = engine.complete_interrogation_phase().unwrap_err();
        assert_eq!(err.code, "interrogationPhaseNotCompletable");

        // The phase must not have been completed.
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        assert!(!scene.completed_phases.contains("phase"));
    }

    #[test]
    fn auto_phase_does_not_complete_without_manual_trigger() {
        let mut engine = empty_engine_with_interrogation_scene(single_required_question_scene(), 1);
        engine.inventory.evidence.push(EvidenceRecord {
            id: "ev".into(),
            name: "Ev".into(),
            description: "d".into(),
            details: "d".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "previous_scene".into(),
        });
        engine.prime_initial_queue().unwrap();
        break_q1(&mut engine);

        // Breaking every required question must NOT auto-complete the phase.
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        assert!(scene.is_question_broken("q1"));
        assert!(
            !scene.completed_phases.contains("phase"),
            "Auto phase must not complete without a manual trigger"
        );
        assert!(
            scene.current_phase_can_complete(),
            "phase should be manually completable once required questions are broken"
        );
    }

    #[test]
    fn complete_interrogation_phase_completes_and_fires_outro() {
        let mut engine = empty_engine_with_interrogation_scene(single_required_question_scene(), 1);
        engine.inventory.evidence.push(EvidenceRecord {
            id: "ev".into(),
            name: "Ev".into(),
            description: "d".into(),
            details: "d".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "previous_scene".into(),
        });
        engine.prime_initial_queue().unwrap();
        break_q1(&mut engine);

        // Manually complete the phase — the outro dialogue should now play.
        let view = engine.complete_interrogation_phase().unwrap();
        assert!(
            matches!(view.mode, ModeView::Dialogue { .. }),
            "expected the outro dialogue to play after manual completion, got {:?}",
            view.mode
        );

        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        assert!(scene.completed_phases.contains("phase"));
        assert!(scene.outro_played);
    }

    #[test]
    fn ask_playing_testimony_exposes_cross_exam_line_id() {
        // Asking a not-yet-broken question plays its first testimony line in
        // the dialogue box, exposing the line id the inline 反駁 targets.
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.prime_initial_queue().unwrap();

        let view = engine.ask_interrogation_question("alibi").unwrap();
        match &view.mode {
            ModeView::Dialogue {
                cross_exam_line_id, ..
            } => assert_eq!(cross_exam_line_id.as_deref(), Some("l_off")),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn draining_unbroken_testimony_loops_in_dialogue() {
        // Draining line 0's content auto-advances to line 1 and stays in the
        // dialogue box (the testimony loops) rather than dropping to the menu.
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.prime_initial_queue().unwrap();

        let view = engine.ask_interrogation_question("alibi").unwrap();
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        match &view.mode {
            ModeView::Dialogue {
                current,
                cross_exam_line_id,
                ..
            } => {
                assert_eq!(cross_exam_line_id.as_deref(), Some("l_deny"));
                assert!(
                    matches!(current, DialogueItem::Line { text, .. } if text == "我從沒打掃過那裡。"),
                    "expected to advance to line 1, got {current:?}"
                );
            }
            other => panic!("expected looping Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn loop_plays_detective_prompt_after_on_loop() {
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.prime_initial_queue().unwrap();
        engine.ask_interrogation_question("alibi").unwrap();
        // Drain line 0 -> line 1, drain line 1 -> loop installs
        // on_loop ++ loop_prompt ++ line0.
        let view = engine.advance_dialogue(token_from(&engine.view())).unwrap();
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        // The suspect's On Loop ("loop") plays first...
        match &view.mode {
            ModeView::Dialogue { current, .. } => assert!(
                matches!(current, DialogueItem::Action { text } if text == "loop"),
                "expected the suspect On Loop first, got {current:?}"
            ),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
        // ...then the detective's Loop Prompt.
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        match &view.mode {
            ModeView::Dialogue { current, .. } => assert!(
                matches!(current, DialogueItem::Action { text } if text == "detective-loop"),
                "expected the detective loop prompt after On Loop, got {current:?}"
            ),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn wrong_present_plays_detective_reply_after_rebuff() {
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.inventory.evidence.push(EvidenceRecord {
            id: "unrelated".into(),
            name: "Unrelated".into(),
            description: "d".into(),
            details: "d".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "prev".into(),
        });
        engine.prime_initial_queue().unwrap();
        engine.ask_interrogation_question("alibi").unwrap();
        let view = engine.challenge_interrogation_line("l_deny").unwrap();
        engine.advance_dialogue(token_from(&view)).unwrap();
        // Present the wrong evidence against the contradiction line.
        let view = engine
            .present_interrogation_evidence("l_deny", "evidence", "unrelated")
            .unwrap();
        // The suspect's On Wrong Evidence ("wrong") plays first...
        match &view.mode {
            ModeView::Dialogue { current, .. } => assert!(
                matches!(current, DialogueItem::Action { text } if text == "wrong"),
                "expected the suspect rebuff first, got {current:?}"
            ),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
        // ...then the detective's Wrong Reply.
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        match &view.mode {
            ModeView::Dialogue { current, .. } => assert!(
                matches!(current, DialogueItem::Action { text } if text == "detective-wrong"),
                "expected the detective wrong reply second, got {current:?}"
            ),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn loop_bridge_hides_cross_exam_line_id_until_line_content() {
        // While the on_loop + loop_prompt bridge plays, the active dialogue is
        // not a testimony line, so `cross_exam_line_id` must be None — the
        // inline 反駁 control must not surface a challenge target for a line
        // that is not on screen. It reappears once the cursor reaches line 0.
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.prime_initial_queue().unwrap();
        engine.ask_interrogation_question("alibi").unwrap();
        // Drain line 0 -> line 1, drain line 1 -> loop installs
        // on_loop ++ loop_prompt ++ line0.
        let view = engine.advance_dialogue(token_from(&engine.view())).unwrap();
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        // Cursor on the On Loop bridge item — no challenge target.
        match &view.mode {
            ModeView::Dialogue {
                current,
                cross_exam_line_id,
                ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Action { text } if text == "loop"),
                    "expected the On Loop bridge, got {current:?}"
                );
                assert_eq!(
                    cross_exam_line_id.as_deref(),
                    None,
                    "反駁 must stay hidden during the on_loop bridge"
                );
            }
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
        // Cursor on the Loop Prompt bridge item — still no challenge target.
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        match &view.mode {
            ModeView::Dialogue {
                current,
                cross_exam_line_id,
                ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Action { text } if text == "detective-loop"),
                    "expected the Loop Prompt bridge, got {current:?}"
                );
                assert_eq!(
                    cross_exam_line_id.as_deref(),
                    None,
                    "反駁 must stay hidden during the loop_prompt bridge"
                );
            }
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
        // Cursor reaches line 0 content — challenge target reappears.
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        match &view.mode {
            ModeView::Dialogue {
                current,
                cross_exam_line_id,
                ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Line { text, .. } if text == "我那天沒去。"),
                    "expected line 0 content after the bridge, got {current:?}"
                );
                assert_eq!(
                    cross_exam_line_id.as_deref(),
                    Some("l_off"),
                    "反駁 must target line 0 once its content is showing"
                );
            }
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn wrong_evidence_feedback_hides_cross_exam_line_id() {
        // After a wrong present, `return_to_line` resets cross_exam to Playing
        // while the on_wrong_evidence + wrong_reply feedback queue plays. The
        // inline 反駁 control must not surface a challenge target during that
        // feedback — the player is seeing the rebuff, not the testimony line.
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.inventory.evidence.push(EvidenceRecord {
            id: "unrelated".into(),
            name: "Unrelated".into(),
            description: "d".into(),
            details: "d".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "prev".into(),
        });
        engine.prime_initial_queue().unwrap();
        engine.ask_interrogation_question("alibi").unwrap();
        let view = engine.challenge_interrogation_line("l_deny").unwrap();
        engine.advance_dialogue(token_from(&view)).unwrap();
        // Present wrong evidence; the feedback queue plays with cross_exam back
        // to Playing (return_to_line), but no challenge target must surface.
        let view = engine
            .present_interrogation_evidence("l_deny", "evidence", "unrelated")
            .unwrap();
        match &view.mode {
            ModeView::Dialogue {
                current,
                cross_exam_line_id,
                ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Action { text } if text == "wrong"),
                    "expected the On Wrong Evidence rebuff, got {current:?}"
                );
                assert_eq!(
                    cross_exam_line_id.as_deref(),
                    None,
                    "反駁 must stay hidden during wrong-evidence feedback"
                );
            }
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        match &view.mode {
            ModeView::Dialogue {
                current,
                cross_exam_line_id,
                ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Action { text } if text == "detective-wrong"),
                    "expected the Wrong Reply, got {current:?}"
                );
                assert_eq!(
                    cross_exam_line_id.as_deref(),
                    None,
                    "反駁 must stay hidden during the wrong_reply feedback"
                );
            }
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn challenge_lead_in_hides_cross_exam_line_id() {
        // The challenge lead-in dialogue plays with cross_exam already moved to
        // Presenting, so `playing_unbroken_line_id` returns None via the
        // CrossExam::Playing match. This test pins that behavior so a future
        // regression that re-introduces a Playing state during the lead-in is
        // caught by the cursor guard as well.
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.prime_initial_queue().unwrap();
        engine.ask_interrogation_question("alibi").unwrap();
        let view = engine.challenge_interrogation_line("l_deny").unwrap();
        match &view.mode {
            ModeView::Dialogue {
                cross_exam_line_id, ..
            } => assert_eq!(
                cross_exam_line_id.as_deref(),
                None,
                "反駁 must stay hidden during the challenge lead-in"
            ),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn present_interrogation_evidence_uses_state_line_not_frontend_param() {
        // Defense-in-depth: the line evaluated for a contradiction match is the
        // one recorded in the `Presenting` cross-exam state, not the
        // frontend-supplied `line_id`. Challenge `l_deny` (contradiction
        // evidence:cleaning_log), then present the correct evidence while
        // passing `l_off` (an honest line with no contradiction) as the param.
        // The engine must still resolve against `l_deny` and break the question.
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.inventory.evidence.push(EvidenceRecord {
            id: "cleaning_log".into(),
            name: "Cleaning Log".into(),
            description: "d".into(),
            details: "d".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "prev".into(),
        });
        engine.prime_initial_queue().unwrap();
        engine.ask_interrogation_question("alibi").unwrap();
        let view = engine.challenge_interrogation_line("l_deny").unwrap();
        engine.advance_dialogue(token_from(&view)).unwrap();
        // Pass `l_off` (wrong) as the line param; the correct evidence for
        // `l_deny` is `cleaning_log`. The engine should break the question
        // because it evaluates `Presenting.line_id == "l_deny"`.
        engine
            .present_interrogation_evidence("l_off", "evidence", "cleaning_log")
            .unwrap();
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        assert!(
            scene.is_question_broken("alibi"),
            "present should evaluate the state's line (l_deny), not the param (l_off)"
        );
    }

    #[test]
    fn challenge_interrogation_line_rejects_foreign_line_id() {
        // Defense-in-depth: `line_id` is a player choice but must belong to the
        // current question. A crafted IPC call naming a non-existent line must
        // be rejected rather than polluting the `Presenting` state.
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.prime_initial_queue().unwrap();
        engine.ask_interrogation_question("alibi").unwrap();
        let err = engine
            .challenge_interrogation_line("line_from_another_question")
            .unwrap_err();
        assert_eq!(err.code, "internalError");
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        // The bogus challenge must not have opened the tray.
        assert!(
            matches!(scene.cross_exam(), CrossExam::Playing { .. }),
            "foreign line_id must not transition to Presenting, got {:?}",
            scene.cross_exam()
        );
    }

    #[test]
    fn challenge_fires_during_active_testimony_dialogue() {
        // The inline 反駁 fires while the testimony content queue is still
        // active — no `dialogue_active` rejection (relaxed guard).
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.prime_initial_queue().unwrap();

        let view = engine.ask_interrogation_question("alibi").unwrap();
        assert!(matches!(view.mode, ModeView::Dialogue { .. }));

        // Challenge mid-dialogue; l_off's empty challenge lead-in opens the
        // tray immediately.
        engine.challenge_interrogation_line("l_off").unwrap();
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        assert!(
            matches!(scene.cross_exam(), CrossExam::Presenting { line_id, .. } if line_id == "l_off"),
            "challenge mid-dialogue should reach Presenting, got {:?}",
            scene.cross_exam()
        );
    }

    #[test]
    fn honest_question_returns_to_menu_after_draining() {
        // An honest (auto-broken) question exposes no inline challenge line and
        // returns to the question menu once its testimony drains — it does not
        // loop like an unbroken testimony.
        let mut engine = empty_engine_with_interrogation_scene(single_honest_question_scene(), 1);
        engine.prime_initial_queue().unwrap();

        let view = engine.ask_interrogation_question("q1").unwrap();
        match &view.mode {
            ModeView::Dialogue {
                cross_exam_line_id, ..
            } => assert_eq!(
                *cross_exam_line_id, None,
                "a broken question exposes no challenge line"
            ),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }

        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        assert!(
            matches!(view.mode, ModeView::Interrogation { .. }),
            "honest testimony should return to the menu, got {:?}",
            view.mode
        );
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        assert!(matches!(scene.cross_exam(), CrossExam::Idle));
        assert!(scene.is_question_broken("q1"));
    }

    #[test]
    fn degenerate_testimony_returns_to_menu_without_recursing() {
        // An UNBROKEN question whose only testimony line has empty content and
        // whose testimony has no on_loop / loop_prompt bridge. Asking it
        // installs nothing, so advance_playing_testimony reaches its degenerate
        // branch. That branch must withdraw first and then run the phase/outro
        // checks. It must NOT call on_queue_exhausted: that function's
        // interrogation arm dispatches straight back into
        // advance_playing_testimony while is_playing_unbroken() holds, which
        // recurses without bound.
        let scene = InterrogationSceneJson {
            id: "interrogation_scene_1".into(),
            title: "Interrogation".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![InterrogationPhaseJson::Inquiry {
                id: "inquiry".into(),
                label: "Inquiry".into(),
                subject: subject(),
                required: false,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![InquiryQuestionJson {
                    id: "q_degenerate".into(),
                    label: "Degenerate".into(),
                    status: LockStatus::Unlocked,
                    required: false,
                    unlock: None,
                    reveals: vec![],
                    testimony: TestimonyJson {
                        on_loop: vec![],
                        loop_prompt: vec![],
                        default_challenge: vec![],
                        default_wrong: vec![],
                        wrong_reply: vec![],
                        lines: vec![TestimonyLineJson {
                            id: "l_empty".into(),
                            label: "Empty".into(),
                            // Empty content plus an empty loop bridge is what
                            // makes the queue degenerate.
                            content: vec![],
                            // A contradiction keeps the question unbroken, so
                            // the engine enters the Playing loop rather than
                            // the honest-question path.
                            contradiction: Some(InventoryTarget::Evidence {
                                id: "never_held".into(),
                            }),
                            challenge: vec![],
                            on_correct: vec![],
                            on_wrong_evidence: vec![],
                            reveals: vec![],
                        }],
                    },
                }],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_interrogation_scene(scene, 1);

        let view = engine.ask_interrogation_question("q_degenerate").unwrap();

        assert!(
            !matches!(view.mode, ModeView::Dialogue { .. }),
            "degenerate testimony left the engine in dialogue mode: {:?}",
            view.mode
        );
    }

    #[test]
    fn resume_interrogation_testimony_returns_to_the_challenged_line() {
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.prime_initial_queue().unwrap();
        engine.ask_interrogation_question("alibi").unwrap();

        // Challenge the contradiction line and drain the lead-in to open the tray.
        let view = engine.challenge_interrogation_line("l_deny").unwrap();
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        assert!(matches!(view.mode, ModeView::Interrogation { .. }));

        // Backing out of the tray resumes playing that same line in the dialogue
        // box — it does NOT drop back to the question menu.
        let view = engine.resume_interrogation_testimony().unwrap();
        match &view.mode {
            ModeView::Dialogue {
                cross_exam_line_id, ..
            } => assert_eq!(cross_exam_line_id.as_deref(), Some("l_deny")),
            other => panic!("expected the testimony to resume, got {other:?}"),
        }
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene");
        };
        assert!(matches!(scene.cross_exam(), CrossExam::Playing { .. }));
    }

    #[test]
    fn resume_interrogation_testimony_rejects_outside_presenting() {
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.prime_initial_queue().unwrap();
        // At the question menu (Idle), not presenting.
        let err = engine.resume_interrogation_testimony().unwrap_err();
        assert_eq!(err.code, "notInCrossExamination");
    }

    #[test]
    fn reset_for_new_scene_preserves_audio_state() {
        // reset_for_new_scene should clear scene_tag and background but
        // preserve bgm/bgs so audio continuity is maintained across
        // scene boundaries when the next scene omits audio fields.
        use crate::game::schema::{AudioChannelJson, AudioCueJson};

        let mut cue = LastVisualCue {
            scene_tag: Some("old_scene_tag".into()),
            background_asset_id: Some("background.old".into()),
            bgm: Some(AudioCueJson {
                channel: AudioChannelJson::Bgm,
                asset_id: Some("rain_mystery_low".into()),
            }),
            bgs: Some(AudioCueJson {
                channel: AudioChannelJson::Bgs,
                asset_id: Some("indoor_rain".into()),
            }),
        };

        cue.reset_for_new_scene();

        // Scene-specific fields are cleared
        assert_eq!(cue.scene_tag, None);
        assert_eq!(cue.background_asset_id, None);

        // Audio state is preserved
        assert!(cue.bgm.is_some());
        assert_eq!(
            cue.bgm.as_ref().unwrap().asset_id.as_deref(),
            Some("rain_mystery_low")
        );
        assert!(cue.bgs.is_some());
        assert_eq!(
            cue.bgs.as_ref().unwrap().asset_id.as_deref(),
            Some("indoor_rain")
        );
    }

    #[test]
    fn apply_asset_cue_overwrites_audio_when_present() {
        // When a new visual cue provides audio, apply_asset_cue should
        // overwrite the carried-forward value. When it's None, the
        // previous value should be preserved.
        use crate::game::schema::{AudioChannelJson, AudioCueJson, VisualAssetCueJson};

        let mut cue = LastVisualCue {
            scene_tag: Some("scene_tag".into()),
            background_asset_id: Some("bg_old".into()),
            bgm: Some(AudioCueJson {
                channel: AudioChannelJson::Bgm,
                asset_id: Some("old_bgm".into()),
            }),
            bgs: Some(AudioCueJson {
                channel: AudioChannelJson::Bgs,
                asset_id: Some("old_bgs".into()),
            }),
        };

        // Apply a cue that omits BGM (None) and provides new BGS
        let new_cue = VisualAssetCueJson {
            background_asset_id: Some("bg_new".into()),
            bgm: None,
            bgs: Some(AudioCueJson {
                channel: AudioChannelJson::Bgs,
                asset_id: Some("new_bgs".into()),
            }),
        };

        cue.apply_asset_cue(Some(new_cue));

        // BGM was omitted → previous value preserved
        assert_eq!(
            cue.bgm.as_ref().unwrap().asset_id.as_deref(),
            Some("old_bgm")
        );
        // BGS was provided → overwritten
        assert_eq!(
            cue.bgs.as_ref().unwrap().asset_id.as_deref(),
            Some("new_bgs")
        );
        // Background was provided → overwritten
        assert_eq!(cue.background_asset_id.as_deref(), Some("bg_new"));
    }
}
