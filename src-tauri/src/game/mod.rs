// src-tauri/src/game/mod.rs
//
// GameEngine — the single owner of mutable game state.

pub mod error;
pub mod loader;
pub mod reveals;
pub mod scenes;
pub mod schema;
pub mod state;
pub mod unlock;
pub mod view;

pub use error::GameError;
pub use view::{GameStateView, ModeView, QueueToken};

use scenes::interrogation::{phase_id, InterrogationSceneAndInventoryCtx, InterrogationSceneState};
use scenes::investigation::{DialogueQueue, InvestigationSceneState};
use scenes::linear::LinearSceneState;
use scenes::SceneRuntime;
use schema::{
    DialogueItem, InterrogationPhaseJson, InventoryTarget, LockStatus, SceneJson, SceneType,
};
use state::{ChapterManifest, Inventory, SceneRef};
use std::path::PathBuf;
use view::{
    ChapterView, CharacterView, HotspotView, InquiryQuestionView, InterrogationPhaseView,
    SceneView, SubjectView, SublocationView, TestimonyStatementView, TopicView,
};

pub struct GameEngine {
    resources_dir: PathBuf,
    chapters: Vec<ChapterManifest>,
    current_chapter_idx: usize,
    current_scene_idx: usize,
    scene: SceneRuntime,
    last_scene_tag: Option<String>,
    inventory: Inventory,
    next_queue_gen: u64,
}

struct GameSnapshot {
    current_chapter_idx: usize,
    current_scene_idx: usize,
    scene: SceneRuntime,
    last_scene_tag: Option<String>,
    inventory: Inventory,
    next_queue_gen: u64,
}

const REEXAMINE_FALLBACK_TEXT: &str = "（沒有新發現。）";
const WRONG_PRESENT_FALLBACK_TEXT: &str = "（這個提示還不足以推翻證詞。）";

impl GameEngine {
    pub fn new_started(resources_dir: PathBuf) -> Result<Self, GameError> {
        let index = loader::load_chapters_index(&resources_dir)?;

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
            last_scene_tag: None,
            inventory: Inventory::default(),
            next_queue_gen: 2,
        };
        engine.prime_initial_queue()?;
        Ok(engine)
    }

    fn prime_initial_queue(&mut self) -> Result<(), GameError> {
        let mut intro_queue = None;
        let mut needs_interrogation_advance = false;
        let needs_initial_sub = match &mut self.scene {
            SceneRuntime::Linear(s) => {
                // Consume leading SceneTag items so the first visible frame
                // has the correct backdrop tag.
                while let Some(DialogueItem::SceneTag { text }) = s.queue.get(s.cursor).cloned() {
                    self.last_scene_tag = Some(text);
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

    pub fn view(&self) -> GameStateView {
        GameStateView {
            mode: self.mode_view(),
            chapter: self.chapter_view(),
            scene: self.scene_view(),
            inventory: self.inventory.clone(),
        }
    }

    pub fn advance_dialogue(&mut self, expected: QueueToken) -> Result<GameStateView, GameError> {
        let current_token = match self.current_queue_token() {
            Some(t) => t,
            None => return Err(GameError::no_active_dialogue()),
        };
        if current_token != expected {
            return Ok(self.view());
        }

        let snapshot = self.snapshot();

        let result = (|| -> Result<(), GameError> {
            let _ = match &mut self.scene {
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
            if let Some(DialogueItem::SceneTag { text }) = self.peek_just_consumed() {
                self.last_scene_tag = Some(text);
            }
            // Skip over any consecutive SceneTag items so the next visible frame
            // is a real dialogue/action line. This mirrors the leading-tag skip
            // in prime_initial_queue.
            self.consume_scene_tags_at_cursor();
            let exhausted = match &self.scene {
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
                self.on_queue_exhausted()?;
            }
            Ok(())
        })();

        if let Err(err) = result {
            self.restore_snapshot(snapshot);
            return Err(err);
        }
        Ok(self.view())
    }

    fn peek_just_consumed(&self) -> Option<DialogueItem> {
        match &self.scene {
            SceneRuntime::Linear(s) => s.queue.get(s.cursor.saturating_sub(1)).cloned(),
            SceneRuntime::Investigation(inv) => inv
                .pending_queue
                .as_ref()
                .and_then(|q| q.items.get(q.cursor.saturating_sub(1)).cloned()),
            SceneRuntime::Interrogation(scene) => scene
                .pending_queue
                .as_ref()
                .and_then(|q| q.items.get(q.cursor.saturating_sub(1)).cloned()),
        }
    }

    /// Advance past any consecutive SceneTag items at the current cursor,
    /// updating `last_scene_tag` for each. Leaves the cursor positioned on
    /// the first non-SceneTag item (or at the end of the queue).
    fn consume_scene_tags_at_cursor(&mut self) {
        loop {
            let tag = match &mut self.scene {
                SceneRuntime::Linear(s) => s.queue.get(s.cursor).cloned(),
                SceneRuntime::Investigation(inv) => inv
                    .pending_queue
                    .as_ref()
                    .and_then(|q| q.items.get(q.cursor).cloned()),
                SceneRuntime::Interrogation(scene) => scene
                    .pending_queue
                    .as_ref()
                    .and_then(|q| q.items.get(q.cursor).cloned()),
            };
            match tag {
                Some(DialogueItem::SceneTag { text }) => {
                    self.last_scene_tag = Some(text);
                    match &mut self.scene {
                        SceneRuntime::Linear(s) => s.cursor += 1,
                        SceneRuntime::Investigation(inv) => {
                            if let Some(q) = inv.pending_queue.as_mut() {
                                q.cursor += 1;
                            }
                        }
                        SceneRuntime::Interrogation(scene) => {
                            if let Some(q) = scene.pending_queue.as_mut() {
                                q.cursor += 1;
                            }
                        }
                    }
                }
                _ => break,
            }
        }
    }

    fn install_investigation_queue(
        &mut self,
        items: Vec<DialogueItem>,
        queue_gen: u64,
    ) -> Result<(), GameError> {
        self.install_scene_queue(items, queue_gen)
    }

    fn install_scene_queue(
        &mut self,
        items: Vec<DialogueItem>,
        queue_gen: u64,
    ) -> Result<(), GameError> {
        match &mut self.scene {
            SceneRuntime::Investigation(inv) => {
                inv.pending_queue = Some(DialogueQueue {
                    items,
                    cursor: 0,
                    queue_gen,
                });
            }
            SceneRuntime::Linear(_) => {
                return Err(GameError::internal(
                    "dialogue queue installed outside queued scene".into(),
                ));
            }
            SceneRuntime::Interrogation(scene) => {
                scene.pending_queue = Some(DialogueQueue {
                    items,
                    cursor: 0,
                    queue_gen,
                });
            }
        }
        self.consume_scene_tags_at_cursor();
        let exhausted = match &self.scene {
            SceneRuntime::Investigation(inv) => inv
                .pending_queue
                .as_ref()
                .is_none_or(|q| q.cursor >= q.items.len()),
            SceneRuntime::Linear(_) => {
                return Err(GameError::internal(
                    "dialogue queue installed outside queued scene".into(),
                ));
            }
            SceneRuntime::Interrogation(scene) => scene
                .pending_queue
                .as_ref()
                .is_none_or(|q| q.cursor >= q.items.len()),
        };
        if exhausted {
            self.on_queue_exhausted()?;
        }
        Ok(())
    }

    fn on_queue_exhausted(&mut self) -> Result<(), GameError> {
        match &self.scene {
            SceneRuntime::Linear(_) => {
                self.advance_scene()?;
            }
            SceneRuntime::Investigation(_) => {
                if self.try_advance_investigation()? {
                    self.advance_scene()?;
                }
            }
            SceneRuntime::Interrogation(_) => {
                if self.try_advance_interrogation()? {
                    self.advance_scene()?;
                }
            }
        }
        Ok(())
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
            self.install_investigation_queue(outro_dialogue, queue_gen)?;
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
            scene.refresh_phase_completion(&self.inventory);
        }

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

        if let Some(phase) = phase_to_enter {
            let (phase_id, scene_tag, entry_dialogue, reveals) = match &phase {
                InterrogationPhaseJson::Inquiry {
                    id,
                    scene_tag,
                    entry_dialogue,
                    reveals,
                    ..
                }
                | InterrogationPhaseJson::Testimony {
                    id,
                    scene_tag,
                    entry_dialogue,
                    reveals,
                    ..
                } => (
                    id.clone(),
                    scene_tag.clone(),
                    entry_dialogue.clone(),
                    reveals.clone(),
                ),
            };
            let queue_items = {
                let scene = match &mut self.scene {
                    SceneRuntime::Interrogation(scene) => scene,
                    _ => return Ok(false),
                };
                scene.mark_phase_entered(&phase_id);
                reveals::apply_interrogation_reveals_and_build_queue(
                    scene,
                    &mut self.inventory,
                    entry_dialogue,
                    &reveals,
                    &chapter_id,
                )
            };
            self.last_scene_tag = Some(scene_tag);
            if queue_items.is_empty() {
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.install_scene_queue(queue_items, queue_gen)?;
            }
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
                        s.transition_dialogue.clone(),
                        s.reveals.clone(),
                    )
                }),
            _ => None,
        };
        let Some((id, scene_tag, transition, sub_reveals)) = chosen else {
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
                    &mut self.inventory,
                    transition,
                    &sub_reveals,
                    &chapter_id,
                )
            } else {
                Vec::new()
            }
        };

        if queue_items.is_empty() {
            self.last_scene_tag = Some(scene_tag);
            self.on_queue_exhausted()?;
        } else {
            let queue_gen = self.alloc_queue_gen();
            self.last_scene_tag = Some(scene_tag);
            self.install_investigation_queue(queue_items, queue_gen)?;
        }
        Ok(())
    }

    fn alloc_queue_gen(&mut self) -> u64 {
        let g = self.next_queue_gen;
        self.next_queue_gen += 1;
        g
    }

    fn snapshot(&self) -> GameSnapshot {
        GameSnapshot {
            current_chapter_idx: self.current_chapter_idx,
            current_scene_idx: self.current_scene_idx,
            scene: self.scene.clone(),
            last_scene_tag: self.last_scene_tag.clone(),
            inventory: self.inventory.clone(),
            next_queue_gen: self.next_queue_gen,
        }
    }

    fn restore_snapshot(&mut self, snapshot: GameSnapshot) {
        self.current_chapter_idx = snapshot.current_chapter_idx;
        self.current_scene_idx = snapshot.current_scene_idx;
        self.scene = snapshot.scene;
        self.last_scene_tag = snapshot.last_scene_tag;
        self.inventory = snapshot.inventory;
        self.next_queue_gen = snapshot.next_queue_gen;
    }

    fn restore_on_error<T>(
        &mut self,
        snapshot: GameSnapshot,
        result: Result<T, GameError>,
    ) -> Result<T, GameError> {
        match result {
            Ok(value) => Ok(value),
            Err(err) => {
                self.restore_snapshot(snapshot);
                Err(err)
            }
        }
    }

    fn advance_scene(&mut self) -> Result<(), GameError> {
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

        let snapshot = self.snapshot();

        self.current_chapter_idx = next_chapter_idx;
        self.current_scene_idx = next_scene_idx;
        self.scene = new_scene;
        self.last_scene_tag = None;
        self.next_queue_gen += 1;
        if let Err(err) = self.prime_initial_queue() {
            self.restore_snapshot(snapshot);
            return Err(err);
        }
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

        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            // Phase 2 — compute: build queue (mutates scene + inventory together).
            let queue_items = if first_time {
                let inv = match &mut self.scene {
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
                    &mut self.inventory,
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
            if queue_items.is_empty() {
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.install_investigation_queue(queue_items, queue_gen)?;
            }
            Ok(self.view())
        })();
        self.restore_on_error(snapshot, result)
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

        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            let queue_items = if first_time {
                let inv = match &mut self.scene {
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
                    &mut self.inventory,
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

            if queue_items.is_empty() {
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.install_investigation_queue(queue_items, queue_gen)?;
            }
            Ok(self.view())
        })();
        self.restore_on_error(snapshot, result)
    }

    pub fn enter_sublocation(&mut self, sublocation_id: &str) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        let (scene_tag, transition_dialogue, sub_reveals, first_entry) = {
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
                def.scene_tag,
                def.transition_dialogue,
                def.reveals,
                first_entry,
            )
        };

        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            let queue_items: Vec<DialogueItem> = if first_entry {
                let inv = match &mut self.scene {
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
                    &mut self.inventory,
                    transition_dialogue,
                    &sub_reveals,
                    &chapter_id,
                )
            } else {
                if let SceneRuntime::Investigation(inv) = &mut self.scene {
                    inv.current_sublocation_id = Some(sublocation_id.into());
                }
                Vec::new()
            };

            if queue_items.is_empty() {
                self.last_scene_tag = Some(scene_tag);
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.last_scene_tag = Some(scene_tag);
                self.install_investigation_queue(queue_items, queue_gen)?;
            }
            Ok(self.view())
        })();
        self.restore_on_error(snapshot, result)
    }

    pub fn reexamine_evidence(&mut self, id: &str) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        if let SceneRuntime::Investigation(inv) = &self.scene {
            if inv
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("reexamine_evidence"));
            }
        }
        if let SceneRuntime::Interrogation(scene) = &self.scene {
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("reexamine_evidence"));
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
        let queue_gen = self.alloc_queue_gen();
        match &mut self.scene {
            SceneRuntime::Investigation(_) | SceneRuntime::Interrogation(_) => {}
            SceneRuntime::Linear(_) => {
                return Err(GameError::wrong_mode("reexamine_evidence", "linear"));
            }
        }
        self.install_scene_queue(queue_items, queue_gen)?;
        Ok(self.view())
    }

    pub fn reexamine_statement(&mut self, id: &str) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        if let SceneRuntime::Investigation(inv) = &self.scene {
            if inv
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("reexamine_statement"));
            }
        }
        if let SceneRuntime::Interrogation(scene) = &self.scene {
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("reexamine_statement"));
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
        let queue_gen = self.alloc_queue_gen();
        match &mut self.scene {
            SceneRuntime::Investigation(_) | SceneRuntime::Interrogation(_) => {}
            SceneRuntime::Linear(_) => {
                return Err(GameError::wrong_mode("reexamine_statement", "linear"));
            }
        }
        self.install_scene_queue(queue_items, queue_gen)?;
        Ok(self.view())
    }

    pub fn answer_interrogation_question(
        &mut self,
        question_id: &str,
    ) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        let (question, first_time) = {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => {
                    return Err(GameError::wrong_mode(
                        "answer_interrogation_question",
                        "not interrogation",
                    ))
                }
            };
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("answer_interrogation_question"));
            }
            let phase_id = scene
                .current_phase_id
                .as_deref()
                .ok_or_else(|| GameError::locked_interrogation_question(question_id))?;
            let Some(InterrogationPhaseJson::Inquiry { questions, .. }) = scene
                .def
                .phases
                .iter()
                .find(|phase| phase_id == crate::game::scenes::interrogation::phase_id(phase))
            else {
                return Err(GameError::locked_interrogation_question(question_id));
            };
            let question = questions
                .iter()
                .find(|question| question.id == question_id)
                .cloned()
                .ok_or_else(|| {
                    if scene.def.phases.iter().any(|phase| match phase {
                        InterrogationPhaseJson::Inquiry { questions, .. } => {
                            questions.iter().any(|q| q.id == question_id)
                        }
                        InterrogationPhaseJson::Testimony { .. } => false,
                    }) {
                        GameError::locked_interrogation_question(question_id)
                    } else {
                        GameError::unknown_interrogation_question(question_id)
                    }
                })?;
            let ctx = InterrogationSceneAndInventoryCtx {
                scene,
                inventory: &self.inventory,
            };
            if !scene.is_question_unlocked(&question, &ctx) {
                return Err(GameError::locked_interrogation_question(question_id));
            }
            let first_time = !scene.answered_questions.contains(question_id);
            (question, first_time)
        };

        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            let queue_items = {
                let scene = match &mut self.scene {
                    SceneRuntime::Interrogation(scene) => scene,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during answer_interrogation_question".into(),
                        ))
                    }
                };
                if first_time {
                    scene.record_question_answered(question_id);
                    reveals::apply_interrogation_reveals_and_build_queue(
                        scene,
                        &mut self.inventory,
                        question.answer_dialogue.clone(),
                        &question.reveals,
                        &chapter_id,
                    )
                } else {
                    question
                        .on_reask
                        .clone()
                        .unwrap_or(question.answer_dialogue.clone())
                }
            };

            if let SceneRuntime::Interrogation(scene) = &mut self.scene {
                scene.refresh_phase_completion(&self.inventory);
            }
            if queue_items.is_empty() {
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.install_scene_queue(queue_items, queue_gen)?;
            }
            Ok(self.view())
        })();
        self.restore_on_error(snapshot, result)
    }

    pub fn press_testimony_statement(
        &mut self,
        statement_id: &str,
    ) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        let (statement, first_time) = {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => {
                    return Err(GameError::wrong_mode(
                        "press_testimony_statement",
                        "not interrogation",
                    ))
                }
            };
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("press_testimony_statement"));
            }
            let phase_id = scene
                .current_phase_id
                .as_deref()
                .ok_or_else(|| GameError::unknown_testimony_statement(statement_id))?;
            let Some(InterrogationPhaseJson::Testimony { statements, .. }) = scene
                .def
                .phases
                .iter()
                .find(|phase| phase_id == crate::game::scenes::interrogation::phase_id(phase))
            else {
                return Err(GameError::unknown_testimony_statement(statement_id));
            };
            let statement = statements
                .iter()
                .find(|statement| statement.id == statement_id)
                .cloned()
                .ok_or_else(|| GameError::unknown_testimony_statement(statement_id))?;
            let first_time = !scene.pressed_statements.contains(statement_id);
            (statement, first_time)
        };

        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            let queue_items = {
                let scene = match &mut self.scene {
                    SceneRuntime::Interrogation(scene) => scene,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during press_testimony_statement".into(),
                        ))
                    }
                };
                scene.record_statement_pressed(statement_id);
                if first_time {
                    reveals::apply_interrogation_reveals_and_build_queue(
                        scene,
                        &mut self.inventory,
                        statement.on_press.clone().unwrap_or_default(),
                        &statement.reveals,
                        &chapter_id,
                    )
                } else {
                    statement.on_press.clone().unwrap_or_default()
                }
            };
            if queue_items.is_empty() {
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.install_scene_queue(queue_items, queue_gen)?;
            }
            Ok(self.view())
        })();
        self.restore_on_error(snapshot, result)
    }

    pub fn present_testimony_item(
        &mut self,
        statement_id: &str,
        item_kind: &str,
        item_id: &str,
    ) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        let (phase_id_value, statement, result, correct) = {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => {
                    return Err(GameError::wrong_mode(
                        "present_testimony_item",
                        "not interrogation",
                    ))
                }
            };
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("present_testimony_item"));
            }
            if !self.inventory_target_exists(item_kind, item_id) {
                return Err(GameError::unknown_inventory_target(item_kind, item_id));
            }
            let phase_id_value = scene
                .current_phase_id
                .clone()
                .ok_or_else(|| GameError::unknown_testimony_statement(statement_id))?;
            let Some(InterrogationPhaseJson::Testimony {
                statements,
                results,
                ..
            }) = scene.def.phases.iter().find(|phase| {
                phase_id_value == crate::game::scenes::interrogation::phase_id(phase)
            })
            else {
                return Err(GameError::unknown_testimony_statement(statement_id));
            };
            let statement = statements
                .iter()
                .find(|statement| statement.id == statement_id)
                .cloned()
                .ok_or_else(|| GameError::unknown_testimony_statement(statement_id))?;
            let correct = statement
                .contradiction
                .as_ref()
                .is_some_and(|target| inventory_target_matches(target, item_kind, item_id));
            let result_id = if correct {
                statement.on_correct.as_deref()
            } else {
                statement.on_wrong.as_deref()
            };
            let result = match result_id {
                Some(id) => Some(
                    results
                        .iter()
                        .find(|result| result.id == id)
                        .cloned()
                        .ok_or_else(|| GameError::unknown_testimony_result(id))?,
                ),
                None => None,
            };
            (phase_id_value, statement, result, correct)
        };

        let snapshot = self.snapshot();
        let result_view = (|| -> Result<GameStateView, GameError> {
            let mut queue_items = if correct {
                statement.on_present.clone().unwrap_or_default()
            } else {
                statement.on_wrong_present.clone().unwrap_or_else(|| {
                    vec![DialogueItem::Action {
                        text: WRONG_PRESENT_FALLBACK_TEXT.into(),
                    }]
                })
            };

            if correct {
                if let Some(result) = result {
                    let scene = match &mut self.scene {
                        SceneRuntime::Interrogation(scene) => scene,
                        _ => {
                            return Err(GameError::internal(
                                "scene changed during present_testimony_item".into(),
                            ))
                        }
                    };
                    queue_items = reveals::apply_interrogation_reveals_and_build_queue(
                        scene,
                        &mut self.inventory,
                        queue_items,
                        &result.reveals,
                        &chapter_id,
                    );
                    queue_items.extend(result.dialogue);
                }
                if let SceneRuntime::Interrogation(scene) = &mut self.scene {
                    scene.record_correct_present(&phase_id_value);
                    scene.refresh_phase_completion(&self.inventory);
                }
            } else {
                if let Some(result) = result {
                    queue_items.extend(result.dialogue);
                }
                if let SceneRuntime::Interrogation(scene) = &mut self.scene {
                    scene.record_wrong_present(statement_id);
                }
            }

            if queue_items.is_empty() {
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.install_scene_queue(queue_items, queue_gen)?;
            }
            Ok(self.view())
        })();
        self.restore_on_error(snapshot, result_view)
    }

    fn inventory_target_exists(&self, item_kind: &str, item_id: &str) -> bool {
        match item_kind {
            "evidence" => self.inventory.has_evidence(item_id),
            "statement" => self.inventory.has_statement(item_id),
            _ => false,
        }
    }

    fn current_queue_token(&self) -> Option<QueueToken> {
        match &self.scene {
            SceneRuntime::Linear(s) => {
                if s.cursor < s.queue.len() {
                    Some(QueueToken {
                        scene_id: s.id.clone(),
                        queue_gen: s.queue_gen,
                        cursor: s.cursor,
                    })
                } else {
                    None
                }
            }
            SceneRuntime::Investigation(inv) => match &inv.pending_queue {
                Some(q) if q.cursor < q.items.len() => Some(QueueToken {
                    scene_id: inv.def.id.clone(),
                    queue_gen: q.queue_gen,
                    cursor: q.cursor,
                }),
                _ => None,
            },
            SceneRuntime::Interrogation(scene) => match &scene.pending_queue {
                Some(q) if q.cursor < q.items.len() => Some(QueueToken {
                    scene_id: scene.def.id.clone(),
                    queue_gen: q.queue_gen,
                    cursor: q.cursor,
                }),
                _ => None,
            },
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
                scene_tag: self.last_scene_tag.clone(),
                queue_token: t,
            },
            _ => match &self.scene {
                SceneRuntime::Investigation(inv) => match &inv.current_sublocation_id {
                    Some(sub_id) => ModeView::Explore {
                        sublocation_id: sub_id.clone(),
                    },
                    None => ModeView::GameComplete,
                },
                SceneRuntime::Linear(_) => ModeView::GameComplete,
                SceneRuntime::Interrogation(scene) => match &scene.current_phase_id {
                    Some(phase_id) => ModeView::Interrogation {
                        phase_id: phase_id.clone(),
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
                let visible_phases = scene
                    .def
                    .phases
                    .iter()
                    .filter(|phase| scene.is_phase_unlocked(phase, &ctx))
                    .map(|phase| match phase {
                        InterrogationPhaseJson::Inquiry {
                            id,
                            label,
                            subject,
                            questions,
                            ..
                        } => InterrogationPhaseView {
                            id: id.clone(),
                            label: label.clone(),
                            kind: "inquiry".into(),
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
                                    answered: scene.answered_questions.contains(&question.id),
                                })
                                .collect(),
                            testimony: vec![],
                        },
                        InterrogationPhaseJson::Testimony {
                            id,
                            label,
                            subject,
                            statements,
                            ..
                        } => InterrogationPhaseView {
                            id: id.clone(),
                            label: label.clone(),
                            kind: "testimony".into(),
                            subject: SubjectView {
                                id: subject.id.clone(),
                                name: subject.name.clone(),
                                role: subject.role.clone(),
                                bio: subject.bio.clone(),
                            },
                            questions: vec![],
                            testimony: statements
                                .iter()
                                .map(|statement| TestimonyStatementView {
                                    id: statement.id.clone(),
                                    label: statement.label.clone(),
                                    content: statement.content.clone(),
                                    pressed: scene.pressed_statements.contains(&statement.id),
                                })
                                .collect(),
                        },
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

fn load_scene_runtime(
    resources_dir: &std::path::Path,
    scene_ref: &SceneRef,
    queue_gen: u64,
) -> Result<SceneRuntime, GameError> {
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
    Ok(match json {
        SceneJson::Linear(j) => SceneRuntime::Linear(LinearSceneState::from_json(j, queue_gen)),
        SceneJson::Investigation(j) => {
            SceneRuntime::Investigation(Box::new(InvestigationSceneState::from_json(j, queue_gen)))
        }
        SceneJson::Interrogation(j) => {
            SceneRuntime::Interrogation(Box::new(InterrogationSceneState::from_json(j, queue_gen)))
        }
    })
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
mod tests {
    use super::*;
    use crate::game::schema::{
        AutoMarker, CharacterJson, EvidenceJson, HotspotJson, InterrogationOutroJson,
        InterrogationOutroUnlock, InterrogationPhaseJson, InterrogationSceneJson, InventoryTarget,
        InvestigationSceneJson, LockStatus, OutroJson, OutroUnlock, RevealTarget, SceneType,
        SubjectJson, SublocationJson, TestimonyResultJson, TestimonyStatementJson, TopicJson,
        UnlockExpr,
    };

    fn investigation_scene_with_intro(
        id: &str,
        intro: Vec<DialogueItem>,
    ) -> InvestigationSceneJson {
        InvestigationSceneJson {
            id: id.into(),
            title: id.into(),
            intro,
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
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
        }
    }

    fn empty_engine_with_scene(scene: InvestigationSceneJson, intro_queue_gen: u64) -> GameEngine {
        GameEngine {
            resources_dir: PathBuf::new(),
            chapters: vec![ChapterManifest {
                id: "chapter_1".into(),
                title: "Chapter 1".into(),
                summary: "summary".into(),
                scenes: vec![SceneRef {
                    scene_type: SceneType::Investigation,
                    file: "chapter_1/investigation_scene_1.json".into(),
                }],
            }],
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: SceneRuntime::Investigation(Box::new(InvestigationSceneState::from_json(
                scene,
                intro_queue_gen,
            ))),
            last_scene_tag: None,
            inventory: Inventory::default(),
            next_queue_gen: intro_queue_gen + 1,
        }
    }

    fn token_from(view: &GameStateView) -> QueueToken {
        match &view.mode {
            ModeView::Dialogue { queue_token, .. } => queue_token.clone(),
            other => panic!("expected dialogue mode, got {other:?}"),
        }
    }

    fn subject() -> SubjectJson {
        SubjectJson {
            id: "suspect".into(),
            name: "Suspect".into(),
            role: "Witness".into(),
            bio: "Quiet.".into(),
        }
    }

    fn testimony_interrogation_scene() -> InterrogationSceneJson {
        InterrogationSceneJson {
            id: "interrogation_scene_1".into(),
            title: "Interrogation".into(),
            intro: vec![],
            phases: vec![InterrogationPhaseJson::Testimony {
                id: "testimony".into(),
                label: "Testimony".into(),
                subject: subject(),
                required: true,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                entry_dialogue: vec![],
                statements: vec![TestimonyStatementJson {
                    id: "statement".into(),
                    label: "Statement".into(),
                    content: "I did nothing.".into(),
                    contradiction: Some(InventoryTarget::Evidence { id: "log".into() }),
                    on_correct: Some("correct".into()),
                    on_wrong: None,
                    on_press: None,
                    on_present: None,
                    on_wrong_present: None,
                    reveals: vec![],
                }],
                results: vec![TestimonyResultJson {
                    id: "correct".into(),
                    label: "Correct".into(),
                    reveals: vec![],
                    dialogue: vec![],
                }],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                dialogue: vec![],
            },
        }
    }

    fn empty_engine_with_interrogation_scene(
        scene: InterrogationSceneJson,
        intro_queue_gen: u64,
    ) -> GameEngine {
        GameEngine {
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
                scene,
                intro_queue_gen,
            ))),
            last_scene_tag: None,
            inventory: Inventory::default(),
            next_queue_gen: intro_queue_gen + 1,
        }
    }

    #[test]
    fn present_testimony_item_rejects_non_interrogation_before_missing_inventory() {
        let scene = investigation_scene_with_intro("investigation_scene_1", vec![]);
        let mut engine = empty_engine_with_scene(scene, 1);

        let err = engine
            .present_testimony_item("statement", "evidence", "missing")
            .unwrap_err();

        assert_eq!(err.code, "wrongMode");
    }

    #[test]
    fn present_testimony_item_rejects_active_interrogation_dialogue_before_missing_inventory() {
        let mut engine = empty_engine_with_interrogation_scene(testimony_interrogation_scene(), 1);
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
            .present_testimony_item("statement", "evidence", "missing")
            .unwrap_err();

        assert_eq!(err.code, "dialogueActive");
    }

    #[test]
    fn stale_intro_token_does_not_advance_later_scene_with_same_id() {
        let first_scene = investigation_scene_with_intro(
            "investigation_scene_1",
            vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "first".into(),
            }],
        );
        let mut engine = empty_engine_with_scene(first_scene, 3);
        engine.prime_initial_queue().unwrap();
        let stale_token = token_from(&engine.view());

        let next_scene = investigation_scene_with_intro(
            "investigation_scene_1",
            vec![DialogueItem::Line {
                speaker: "B".into(),
                text: "second".into(),
            }],
        );
        engine.scene = SceneRuntime::Investigation(Box::new(InvestigationSceneState::from_json(
            next_scene, 7,
        )));
        engine.last_scene_tag = None;
        engine.prime_initial_queue().unwrap();

        let before = token_from(&engine.view());
        assert_ne!(stale_token, before);

        let after = token_from(&engine.advance_dialogue(stale_token).unwrap());
        assert_eq!(before, after);
    }

    #[test]
    fn prime_initial_queue_consumes_leading_scene_tags_in_investigation_intro() {
        let scene = investigation_scene_with_intro(
            "investigation_scene_1",
            vec![
                DialogueItem::SceneTag {
                    text: "吉祥寺街道".into(),
                },
                DialogueItem::SceneTag {
                    text: "雨中".into(),
                },
                DialogueItem::Line {
                    speaker: "A".into(),
                    text: "hello".into(),
                },
            ],
        );
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.prime_initial_queue().unwrap();

        assert_eq!(engine.last_scene_tag, Some("雨中".into()));
        let view = engine.view();
        match &view.mode {
            ModeView::Dialogue {
                current, scene_tag, ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text } if speaker == "A" && text == "hello")
                );
                assert_eq!(scene_tag.as_deref(), Some("雨中"));
            }
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn inspect_hotspot_consumes_leading_scene_tags_in_investigation_queue() {
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                transition_dialogue: vec![],
                hotspots: vec![HotspotJson {
                    id: "desk".into(),
                    label: "Desk".into(),
                    description: "Desk".into(),
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![],
                    inspect_dialogue: vec![
                        DialogueItem::SceneTag {
                            text: "desk_closeup".into(),
                        },
                        DialogueItem::Line {
                            speaker: "A".into(),
                            text: "found it".into(),
                        },
                    ],
                    on_reexamine: None,
                }],
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
        engine.prime_initial_queue().unwrap();

        let view = engine.inspect_hotspot("desk").unwrap();
        match &view.mode {
            ModeView::Dialogue {
                current, scene_tag, ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text } if speaker == "A" && text == "found it")
                );
                assert_eq!(scene_tag.as_deref(), Some("desk_closeup"));
            }
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn silent_first_hotspot_action_can_complete_scene() {
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                transition_dialogue: vec![],
                hotspots: vec![HotspotJson {
                    id: "desk".into(),
                    label: "Desk".into(),
                    description: "Desk".into(),
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![RevealTarget::Evidence { id: "note".into() }],
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
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                transition_dialogue: vec![],
                hotspots: vec![],
                characters: vec![CharacterJson {
                    id: "witness".into(),
                    name: "Witness".into(),
                    role: "Witness".into(),
                    bio: "Witness".into(),
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
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
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
                on_reexamine: Some(vec![DialogueItem::Line {
                    speaker: "A".into(),
                    text: "look".into(),
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
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
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
    fn prime_initial_queue_consumes_leading_scene_tags_in_linear_scene() {
        use crate::game::schema::LinearSceneJson;
        let scene_json = LinearSceneJson {
            id: "scene_0".into(),
            title: "Test".into(),
            queue: vec![
                DialogueItem::SceneTag {
                    text: "吉祥寺街道".into(),
                },
                DialogueItem::SceneTag {
                    text: "雨中".into(),
                },
                DialogueItem::Line {
                    speaker: "A".into(),
                    text: "hello".into(),
                },
            ],
        };
        let mut engine = GameEngine {
            resources_dir: PathBuf::new(),
            chapters: vec![ChapterManifest {
                id: "chapter_1".into(),
                title: "Chapter 1".into(),
                summary: "summary".into(),
                scenes: vec![SceneRef {
                    scene_type: SceneType::Linear,
                    file: "chapter_1/scene_0.json".into(),
                }],
            }],
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: SceneRuntime::Linear(LinearSceneState::from_json(scene_json, 1)),
            last_scene_tag: None,
            inventory: Inventory::default(),
            next_queue_gen: 2,
        };
        engine.prime_initial_queue().unwrap();

        // Both leading SceneTags should be consumed; last_scene_tag holds the
        // most recent tag text and the cursor points at the first real item.
        assert_eq!(engine.last_scene_tag, Some("雨中".into()));
        let view = engine.view();
        match &view.mode {
            ModeView::Dialogue {
                current, scene_tag, ..
            } => {
                assert!(matches!(current, DialogueItem::Line { .. }));
                assert_eq!(scene_tag.as_deref(), Some("雨中"));
            }
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn advance_dialogue_skips_mid_scene_tags_in_linear_scene() {
        // Queue: Line → SceneTag → SceneTag → Line
        // Advancing past the first Line should skip both SceneTags and land
        // directly on the second Line, with last_scene_tag holding the final tag.
        use crate::game::schema::LinearSceneJson;
        let scene_json = LinearSceneJson {
            id: "scene_0".into(),
            title: "Test".into(),
            queue: vec![
                DialogueItem::Line {
                    speaker: "A".into(),
                    text: "first".into(),
                },
                DialogueItem::SceneTag {
                    text: "mid_scene_1".into(),
                },
                DialogueItem::SceneTag {
                    text: "mid_scene_2".into(),
                },
                DialogueItem::Line {
                    speaker: "B".into(),
                    text: "second".into(),
                },
            ],
        };
        let mut engine = GameEngine {
            resources_dir: PathBuf::new(),
            chapters: vec![ChapterManifest {
                id: "chapter_1".into(),
                title: "Chapter 1".into(),
                summary: "summary".into(),
                scenes: vec![SceneRef {
                    scene_type: SceneType::Linear,
                    file: "chapter_1/scene_0.json".into(),
                }],
            }],
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: SceneRuntime::Linear(LinearSceneState::from_json(scene_json, 1)),
            last_scene_tag: None,
            inventory: Inventory::default(),
            next_queue_gen: 2,
        };
        // prime_initial_queue: no leading tags, cursor at 0 (first Line)
        engine.prime_initial_queue().unwrap();
        assert_eq!(engine.last_scene_tag, None);

        let view = engine.view();
        let token = match &view.mode {
            ModeView::Dialogue { queue_token, .. } => queue_token.clone(),
            other => panic!("expected Dialogue, got {other:?}"),
        };

        // Advance past "first" — should skip both SceneTags, land on "second"
        let view = engine.advance_dialogue(token).unwrap();
        assert_eq!(engine.last_scene_tag, Some("mid_scene_2".into()));
        match &view.mode {
            ModeView::Dialogue {
                current, scene_tag, ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text } if speaker == "B" && text == "second")
                );
                assert_eq!(scene_tag.as_deref(), Some("mid_scene_2"));
            }
            other => panic!("expected Dialogue after mid-scene tag skip, got {other:?}"),
        }
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
    fn failed_scene_advance_keeps_previous_dialogue_view() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d =
            std::env::temp_dir().join(format!("lyra-advance-test-{}-{}", std::process::id(), n));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            d.join("chapters.json"),
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter 1",
                    "summary": "Summary",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" },
                        { "type": "interrogation", "file": "chapter_1/interrogation_scene_1.json" }
                    ]
                }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("scene_0.json"),
            r#"{
                "type": "linear",
                "id": "scene_0",
                "title": "Opening",
                "queue": [{ "kind": "line", "speaker": "A", "text": "before" }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_1",
                "title": "Wrong Type",
                "queue": []
            }"#,
        )
        .unwrap();

        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let before = engine.view();
        let token = token_from(&before);
        let err = engine.advance_dialogue(token).unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        let after = engine.view();
        match after.mode {
            ModeView::Dialogue { current, .. } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text } if speaker == "A" && text == "before")
                );
            }
            other => panic!("expected previous dialogue mode after failed advance, got {other:?}"),
        }
        match after.scene {
            SceneView::Linear {
                id, index, total, ..
            } => {
                assert_eq!(id, "scene_0");
                assert_eq!(index, 0);
                assert_eq!(total, 2);
            }
            other => panic!("expected previous linear scene after failed advance, got {other:?}"),
        }
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn failed_initial_silent_investigation_transition_rolls_back_inventory() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-initial-transition-rollback-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            d.join("chapters.json"),
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter 1",
                    "summary": "Summary",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" },
                        { "type": "investigation", "file": "chapter_1/investigation_scene_1.json" },
                        { "type": "interrogation", "file": "chapter_1/interrogation_scene_1.json" }
                    ]
                }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("scene_0.json"),
            r#"{
                "type": "linear",
                "id": "scene_0",
                "title": "Opening",
                "queue": [{ "kind": "line", "speaker": "A", "text": "before" }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("investigation_scene_1.json"),
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
                    "reveals": [{ "kind": "evidence", "id": "note" }],
                    "sceneTag": "room",
                    "transitionDialogue": [],
                    "hotspots": [],
                    "characters": []
                }],
                "evidenceManifest": [{
                    "id": "note",
                    "name": "Note",
                    "description": "Note",
                    "details": "Note",
                    "onCollect": [],
                    "onReexamine": null
                }],
                "statementManifest": [],
                "outro": {
                    "unlock": { "predicate": "evidence_collected", "id": "note" },
                    "dialogue": []
                }
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_1",
                "title": "Wrong Type",
                "queue": []
            }"#,
        )
        .unwrap();

        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let token = token_from(&engine.view());

        let err = engine.advance_dialogue(token).unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        assert!(engine.inventory.evidence.is_empty());
        assert_eq!(engine.current_chapter_idx, 0);
        assert_eq!(engine.current_scene_idx, 0);
        match engine.view().scene {
            SceneView::Linear {
                id, index, total, ..
            } => {
                assert_eq!(id, "scene_0");
                assert_eq!(index, 0);
                assert_eq!(total, 3);
            }
            other => panic!("expected previous linear scene after failed advance, got {other:?}"),
        }

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn failed_investigation_intro_completion_rolls_back_inventory() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-intro-rollback-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_1",
                "title": "Wrong Type",
                "queue": []
            }"#,
        )
        .unwrap();

        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            intro: vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "intro".into(),
            }],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![RevealTarget::Evidence { id: "note".into() }],
                scene_tag: "room".into(),
                transition_dialogue: vec![],
                hotspots: vec![],
                characters: vec![],
            }],
            evidence_manifest: vec![EvidenceJson {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
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
        let mut engine = GameEngine {
            resources_dir: d.clone(),
            chapters: vec![ChapterManifest {
                id: "chapter_1".into(),
                title: "Chapter 1".into(),
                summary: "summary".into(),
                scenes: vec![
                    SceneRef {
                        scene_type: SceneType::Investigation,
                        file: "chapter_1/investigation_scene_1.json".into(),
                    },
                    SceneRef {
                        scene_type: SceneType::Interrogation,
                        file: "chapter_1/interrogation_scene_1.json".into(),
                    },
                ],
            }],
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: SceneRuntime::Investigation(Box::new(InvestigationSceneState::from_json(
                scene, 1,
            ))),
            last_scene_tag: None,
            inventory: Inventory::default(),
            next_queue_gen: 2,
        };
        engine.prime_initial_queue().unwrap();
        let token = token_from(&engine.view());

        let err = engine.advance_dialogue(token).unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        assert!(engine.inventory.evidence.is_empty());
        assert_eq!(engine.current_chapter_idx, 0);
        assert_eq!(engine.current_scene_idx, 0);
        let view = engine.view();
        match view.mode {
            ModeView::Dialogue { current, .. } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text } if speaker == "A" && text == "intro")
                );
            }
            other => panic!("expected previous intro dialogue after failed advance, got {other:?}"),
        }
        match view.scene {
            SceneView::Investigation {
                id, index, total, ..
            } => {
                assert_eq!(id, "investigation_scene_1");
                assert_eq!(index, 0);
                assert_eq!(total, 2);
            }
            other => {
                panic!("expected previous investigation scene after failed advance, got {other:?}")
            }
        }

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn failed_silent_investigation_completion_rolls_back_action_state() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-silent-action-rollback-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_1",
                "title": "Wrong Type",
                "queue": []
            }"#,
        )
        .unwrap();

        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                transition_dialogue: vec![],
                hotspots: vec![HotspotJson {
                    id: "desk".into(),
                    label: "Desk".into(),
                    description: "Desk".into(),
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![RevealTarget::Evidence { id: "note".into() }],
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
        let mut engine = GameEngine {
            resources_dir: d.clone(),
            chapters: vec![ChapterManifest {
                id: "chapter_1".into(),
                title: "Chapter 1".into(),
                summary: "summary".into(),
                scenes: vec![
                    SceneRef {
                        scene_type: SceneType::Investigation,
                        file: "chapter_1/investigation_scene_1.json".into(),
                    },
                    SceneRef {
                        scene_type: SceneType::Interrogation,
                        file: "chapter_1/interrogation_scene_1.json".into(),
                    },
                ],
            }],
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: SceneRuntime::Investigation(Box::new(InvestigationSceneState::from_json(
                scene, 1,
            ))),
            last_scene_tag: None,
            inventory: Inventory::default(),
            next_queue_gen: 2,
        };
        engine.prime_initial_queue().unwrap();
        let previous_last_scene_tag = engine.last_scene_tag.clone();
        let previous_next_queue_gen = engine.next_queue_gen;

        let err = engine.inspect_hotspot("desk").unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        assert_eq!(engine.current_chapter_idx, 0);
        assert_eq!(engine.current_scene_idx, 0);
        assert_eq!(engine.last_scene_tag, previous_last_scene_tag);
        assert_eq!(engine.next_queue_gen, previous_next_queue_gen);
        assert!(engine.inventory.evidence.is_empty());

        let SceneRuntime::Investigation(inv) = &engine.scene else {
            panic!("expected investigation scene after failed silent completion");
        };
        assert_eq!(inv.current_sublocation_id.as_deref(), Some("room"));
        assert!(inv.inspected_hotspots.is_empty());
        assert!(!inv.outro_played);

        let view = engine.view();
        assert!(
            matches!(view.mode, ModeView::Explore { sublocation_id } if sublocation_id == "room")
        );
        match view.scene {
            SceneView::Investigation {
                id, index, total, ..
            } => {
                assert_eq!(id, "investigation_scene_1");
                assert_eq!(index, 0);
                assert_eq!(total, 2);
            }
            other => {
                panic!("expected previous investigation scene after failed advance, got {other:?}")
            }
        }

        let _ = fs::remove_dir_all(d);
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
            intro: vec![],
            sublocations: vec![
                SublocationJson {
                    id: "room_a".into(),
                    label: "Room A".into(),
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![],
                    scene_tag: "room_a".into(),
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
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![RevealTarget::Evidence { id: "note".into() }],
                scene_tag: "room".into(),
                transition_dialogue: vec![],
                hotspots: vec![],
                characters: vec![],
            }],
            evidence_manifest: vec![EvidenceJson {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
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
    fn tag_only_linear_scene_advances_to_game_complete() {
        use crate::game::schema::LinearSceneJson;
        // A chapter with a single tag-only scene should advance to GameComplete
        // instead of stalling with the cursor at the end of the queue.
        let tag_only_json = LinearSceneJson {
            id: "scene_0".into(),
            title: "Tag Only".into(),
            queue: vec![DialogueItem::SceneTag {
                text: "吉祥寺街道".into(),
            }],
        };
        let mut engine = GameEngine {
            resources_dir: PathBuf::new(),
            chapters: vec![ChapterManifest {
                id: "chapter_1".into(),
                title: "Chapter 1".into(),
                summary: "summary".into(),
                scenes: vec![SceneRef {
                    scene_type: SceneType::Linear,
                    file: "chapter_1/scene_0.json".into(),
                }],
            }],
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: SceneRuntime::Linear(LinearSceneState::from_json(tag_only_json, 1)),
            last_scene_tag: None,
            inventory: Inventory::default(),
            next_queue_gen: 2,
        };
        engine.prime_initial_queue().unwrap();

        // Scene was tag-only → advance_scene ran → past last chapter → GameComplete.
        assert!(matches!(engine.view().mode, ModeView::GameComplete));
        assert_eq!(engine.last_scene_tag, Some("吉祥寺街道".into()));
    }
}
