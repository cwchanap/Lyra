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
pub use view::{DialogueHistoryEntry, GameStateView, ModeView, QueueToken, SceneNavigationIndex};

use scenes::interrogation::{
    phase_id, phase_required, AdvanceOutcome, CrossExam, InterrogationSceneAndInventoryCtx,
    InterrogationSceneState,
};
use scenes::investigation::{DialogueQueue, InvestigationSceneState};
use scenes::linear::LinearSceneState;
use scenes::SceneRuntime;
use schema::{
    DialogueItem, InterrogationPhaseJson, InventoryTarget, LockStatus, SceneJson, SceneType,
};
use state::{ChapterManifest, Inventory, SceneRef};
use std::path::PathBuf;
use view::{
    AudioCueView, ChapterView, CharacterView, CrossExamView, HotspotView, InquiryQuestionView,
    InterrogationPhaseView, SceneNavigationChapter, SceneNavigationScene, SceneView, SubjectView,
    SublocationView, TopicView,
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
    dialogue_history: Vec<DialogueHistoryEntry>,
    next_dialogue_history_id: u64,
    last_recorded_dialogue_token: Option<QueueToken>,
}

#[derive(Debug, Clone, Default)]
struct LastVisualCue {
    scene_tag: Option<String>,
    background_asset_id: Option<String>,
    bgm: Option<schema::AudioCueJson>,
    bgs: Option<schema::AudioCueJson>,
}

struct GameSnapshot {
    current_chapter_idx: usize,
    current_scene_idx: usize,
    scene: SceneRuntime,
    last_visual_cue: LastVisualCue,
    inventory: Inventory,
    next_queue_gen: u64,
    dialogue_history: Vec<DialogueHistoryEntry>,
    next_dialogue_history_id: u64,
    last_recorded_dialogue_token: Option<QueueToken>,
}

const REEXAMINE_FALLBACK_TEXT: &str = "（沒有新發現。）";
const DIALOGUE_HISTORY_LIMIT: usize = 50;

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
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
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
        let snapshot = self.snapshot();

        self.current_chapter_idx = chapter_idx;
        self.current_scene_idx = scene_idx;
        self.scene = new_scene;
        self.last_visual_cue = LastVisualCue::default();
        self.inventory = Inventory::default();
        self.next_queue_gen = queue_gen + 1;
        self.dialogue_history = vec![];
        self.next_dialogue_history_id = 1;
        self.last_recorded_dialogue_token = None;

        let result = (|| -> Result<GameStateView, GameError> {
            self.prime_initial_queue()?;
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
    }

    fn prime_initial_queue(&mut self) -> Result<(), GameError> {
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

    pub fn view(&self) -> GameStateView {
        GameStateView {
            mode: self.mode_view(),
            chapter: self.chapter_view(),
            scene: self.scene_view(),
            inventory: self.inventory.clone(),
            dialogue_history: self.dialogue_history.clone(),
        }
    }

    /// Build the post-command view while recording the currently focused
    /// dialogue item into `dialogue_history`.
    ///
    /// Dialogue history is captured opportunistically: there is no single
    /// recording hook, so every `#[tauri::command]` path that advances or
    /// changes the focused dialogue item MUST return `Ok(self.view_with_history())`
    /// rather than `Ok(self.view())`. `record_current_dialogue_history` is
    /// idempotent (it dedups by queue token), so calling this on a path that
    /// does not advance is harmless — but skipping it on a path that *does*
    /// advance silently drops the line from the history log. When adding a
    /// new command that can change `current_dialogue_item`, route its return
    /// through this method and add coverage in the dialogue-history tests.
    fn view_with_history(&mut self) -> GameStateView {
        self.record_current_dialogue_history();
        self.view()
    }

    fn record_current_dialogue_history(&mut self) {
        let Some(token) = self.current_queue_token() else {
            return;
        };
        if self.last_recorded_dialogue_token.as_ref() == Some(&token) {
            return;
        }
        let Some(item) = self.current_dialogue_item() else {
            return;
        };

        let id = self.next_dialogue_history_id;
        // Indexing with a clamp silently masks an out-of-range chapter index
        // and panics (usize underflow) when `chapters` is empty. Both states
        // are engine invariants — surface them with a clear expect instead.
        let chapter_title = self
            .chapters
            .get(self.current_chapter_idx)
            .expect("current_chapter_idx must reference a loaded chapter when recording dialogue history")
            .title
            .clone();
        let scene_title = self.current_scene_title();
        let entry = match item {
            DialogueItem::Line {
                speaker,
                text,
                portrait: _,
            } => DialogueHistoryEntry::Line {
                id,
                speaker,
                text,
                chapter_title,
                scene_title,
            },
            DialogueItem::Action { text } => DialogueHistoryEntry::Action {
                id,
                text,
                chapter_title,
                scene_title,
            },
            DialogueItem::SceneTag { .. } => return,
        };

        self.next_dialogue_history_id += 1;
        self.last_recorded_dialogue_token = Some(token);
        self.dialogue_history.push(entry);
        let overflow = self
            .dialogue_history
            .len()
            .saturating_sub(DIALOGUE_HISTORY_LIMIT);
        if overflow > 0 {
            self.dialogue_history.drain(0..overflow);
        }
    }

    fn current_dialogue_item(&self) -> Option<DialogueItem> {
        match &self.scene {
            SceneRuntime::Linear(s) => s.current().cloned(),
            SceneRuntime::Investigation(inv) => inv
                .pending_queue
                .as_ref()
                .and_then(|q| q.items.get(q.cursor).cloned()),
            SceneRuntime::Interrogation(scene) => scene
                .pending_queue
                .as_ref()
                .and_then(|q| q.items.get(q.cursor).cloned()),
        }
    }

    fn current_scene_title(&self) -> String {
        match &self.scene {
            SceneRuntime::Linear(s) => s.title.clone(),
            SceneRuntime::Investigation(inv) => inv.title().to_string(),
            SceneRuntime::Interrogation(scene) => scene.title().to_string(),
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
            if let Some(DialogueItem::SceneTag { text, asset_cue }) = self.peek_just_consumed() {
                self.last_visual_cue.set_scene_tag(text, asset_cue);
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
        Ok(self.view_with_history())
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
    /// updating `last_visual_cue` for each. Leaves the cursor positioned on
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
                Some(DialogueItem::SceneTag { text, asset_cue }) => {
                    self.last_visual_cue.set_scene_tag(text, asset_cue);
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
                &mut self.inventory,
                entry_dialogue,
                &reveals,
                chapter_id,
            )
        };
        self.last_visual_cue.set_scene_tag(scene_tag, asset_cue);
        if queue_items.is_empty() {
            self.on_queue_exhausted()?;
        } else {
            let queue_gen = self.alloc_queue_gen();
            self.install_scene_queue(queue_items, queue_gen)?;
        }
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
            self.last_visual_cue.set_scene_tag(scene_tag, asset_cue);
            self.on_queue_exhausted()?;
        } else {
            let queue_gen = self.alloc_queue_gen();
            self.last_visual_cue.set_scene_tag(scene_tag, asset_cue);
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
            last_visual_cue: self.last_visual_cue.clone(),
            inventory: self.inventory.clone(),
            next_queue_gen: self.next_queue_gen,
            dialogue_history: self.dialogue_history.clone(),
            next_dialogue_history_id: self.next_dialogue_history_id,
            last_recorded_dialogue_token: self.last_recorded_dialogue_token.clone(),
        }
    }

    fn restore_snapshot(&mut self, snapshot: GameSnapshot) {
        self.current_chapter_idx = snapshot.current_chapter_idx;
        self.current_scene_idx = snapshot.current_scene_idx;
        self.scene = snapshot.scene;
        self.last_visual_cue = snapshot.last_visual_cue;
        self.inventory = snapshot.inventory;
        self.next_queue_gen = snapshot.next_queue_gen;
        self.dialogue_history = snapshot.dialogue_history;
        self.next_dialogue_history_id = snapshot.next_dialogue_history_id;
        self.last_recorded_dialogue_token = snapshot.last_recorded_dialogue_token;
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
        self.last_visual_cue.reset_for_new_scene();
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
            Ok(self.view_with_history())
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
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
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
                self.last_visual_cue
                    .set_scene_tag(scene_tag.clone(), asset_cue.clone());
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.last_visual_cue.set_scene_tag(scene_tag, asset_cue);
                self.install_investigation_queue(queue_items, queue_gen)?;
            }
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
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
        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            let queue_gen = self.alloc_queue_gen();
            self.install_scene_queue(queue_items, queue_gen)?;
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
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
        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            let queue_gen = self.alloc_queue_gen();
            self.install_scene_queue(queue_items, queue_gen)?;
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
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
            let question = scene
                .question(question_id)
                .ok_or_else(|| GameError::unknown_interrogation_question(question_id))?;
            let ctx = InterrogationSceneAndInventoryCtx {
                scene,
                inventory: &self.inventory,
            };
            if !scene.is_question_unlocked(question, &ctx) {
                return Err(GameError::locked_interrogation_question(question_id));
            }
        }

        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            let queue_items = {
                let scene = match &mut self.scene {
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
                    reveals::apply_interrogation_reveals_and_build_queue(
                        scene,
                        &mut self.inventory,
                        line_content,
                        &reveals,
                        &chapter_id,
                    )
                } else {
                    line_content
                }
            };

            if queue_items.is_empty() {
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.install_scene_queue(queue_items, queue_gen)?;
            }
            if let SceneRuntime::Interrogation(scene) = &mut self.scene {
                scene.refresh_phase_completion(&self.inventory);
            }
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
    }

    /// `proceed_interrogation_line` — advances the currently-playing testimony
    /// to its next line, or (past the last line) loops back to line 0.
    pub fn proceed_interrogation_line(&mut self) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }

        {
            let scene = match &self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => {
                    return Err(GameError::wrong_mode(
                        "proceed_interrogation_line",
                        "not interrogation",
                    ))
                }
            };
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("proceed_interrogation_line"));
            }
            if !matches!(scene.cross_exam(), CrossExam::Playing { .. }) {
                return Err(GameError::not_in_cross_examination(
                    "proceed_interrogation_line",
                ));
            }
        }

        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            let queue_items = {
                let scene = match &mut self.scene {
                    SceneRuntime::Interrogation(scene) => scene,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during proceed_interrogation_line".into(),
                        ))
                    }
                };
                let CrossExam::Playing { question_id, .. } = scene.cross_exam().clone() else {
                    return Err(GameError::internal(
                        "cross_exam changed during proceed_interrogation_line".into(),
                    ));
                };
                match scene.advance_line() {
                    AdvanceOutcome::NextLine(index) => scene
                        .question(&question_id)
                        .and_then(|question| question.testimony.lines.get(index))
                        .map(|line| line.content.clone())
                        .unwrap_or_default(),
                    AdvanceOutcome::Loop => scene
                        .question(&question_id)
                        .map(|question| question.testimony.on_loop.clone())
                        .unwrap_or_default(),
                }
            };

            if queue_items.is_empty() {
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.install_scene_queue(queue_items, queue_gen)?;
            }
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
    }

    /// `challenge_interrogation_line` — opens the evidence tray against
    /// `line_id`, installing its challenge lead-in dialogue.
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
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("challenge_interrogation_line"));
            }
            if !matches!(scene.cross_exam(), CrossExam::Playing { .. }) {
                return Err(GameError::not_in_cross_examination(
                    "challenge_interrogation_line",
                ));
            }
        }

        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            let queue_items = {
                let scene = match &mut self.scene {
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
                let challenge = scene.line(&question_id, line_id).map(|line| {
                    if line.challenge.is_empty() {
                        scene
                            .question(&question_id)
                            .map(|question| question.testimony.default_challenge.clone())
                            .unwrap_or_default()
                    } else {
                        line.challenge.clone()
                    }
                });
                let challenge = match challenge {
                    Some(challenge) => challenge,
                    None => scene
                        .question(&question_id)
                        .map(|question| question.testimony.default_challenge.clone())
                        .unwrap_or_default(),
                };
                scene.begin_present(line_id);
                challenge
            };

            if queue_items.is_empty() {
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.install_scene_queue(queue_items, queue_gen)?;
            }
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
    }

    /// `present_interrogation_evidence` — presents `item_kind:item_id` against
    /// `line_id`. On a correct contradiction match, plays `on_correct`,
    /// applies the line's reveals, and marks the question broken (returning to
    /// the question menu). Otherwise plays `on_wrong_evidence` (or the
    /// testimony's `default_wrong` fallback) and returns to the same line.
    pub fn present_interrogation_evidence(
        &mut self,
        line_id: &str,
        item_kind: &str,
        item_id: &str,
    ) -> Result<GameStateView, GameError> {
        if self.current_chapter_idx >= self.chapters.len() {
            return Err(GameError::game_complete());
        }
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        let question_id = {
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
            let CrossExam::Presenting { question_id, .. } = scene.cross_exam() else {
                return Err(GameError::not_in_cross_examination(
                    "present_interrogation_evidence",
                ));
            };
            if !self.inventory_target_exists(item_kind, item_id) {
                return Err(GameError::unknown_inventory_target(item_kind, item_id));
            }
            question_id.clone()
        };

        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            let queue_items = {
                let scene = match &mut self.scene {
                    SceneRuntime::Interrogation(scene) => scene,
                    _ => {
                        return Err(GameError::internal(
                            "scene changed during present_interrogation_evidence".into(),
                        ))
                    }
                };
                let line = scene.line(&question_id, line_id).cloned();
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
                        &mut self.inventory,
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
                    let on_wrong = line
                        .as_ref()
                        .map(|line| line.on_wrong_evidence.clone())
                        .filter(|dialogue| !dialogue.is_empty())
                        .unwrap_or(default_wrong);
                    scene.return_to_line();
                    on_wrong
                }
            };

            if queue_items.is_empty() {
                self.on_queue_exhausted()?;
            } else {
                let queue_gen = self.alloc_queue_gen();
                self.install_scene_queue(queue_items, queue_gen)?;
            }
            if let SceneRuntime::Interrogation(scene) = &mut self.scene {
                scene.refresh_phase_completion(&self.inventory);
            }
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
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
            if scene
                .pending_queue
                .as_ref()
                .is_some_and(|q| q.cursor < q.items.len())
            {
                return Err(GameError::dialogue_active("withdraw_interrogation"));
            }
            if !matches!(
                scene.cross_exam(),
                CrossExam::Playing { .. } | CrossExam::Presenting { .. }
            ) {
                return Err(GameError::not_in_cross_examination(
                    "withdraw_interrogation",
                ));
            }
        }

        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            if let SceneRuntime::Interrogation(scene) = &mut self.scene {
                scene.withdraw();
            }
            // The guard above already ensured no dialogue queue is active, so
            // there is nothing to install here — always drive the scene
            // machinery forward (phase/outro checks) as if the queue had just
            // been exhausted.
            self.on_queue_exhausted()?;
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
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
                scene_tag: self.last_visual_cue.scene_tag.clone(),
                background_asset_id: self.last_visual_cue.background_asset_id.clone(),
                bgm: self.last_visual_cue.bgm.as_ref().map(audio_cue_view),
                bgs: self.last_visual_cue.bgs.as_ref().map(audio_cue_view),
                queue_token: t,
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

fn load_chapter_manifests(
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

fn scene_navigation_index_from_chapters(
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

fn load_scene_runtime(
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
        AudioChannelJson, AudioCueJson, AutoMarker, CharacterJson, EvidenceJson, HotspotJson,
        InquiryQuestionJson, InterrogationOutroJson, InterrogationOutroUnlock,
        InterrogationPhaseJson, InterrogationRevealTarget, InterrogationSceneJson,
        InterrogationUnlockExpr, InventoryTarget, InvestigationSceneJson, LockStatus, OutroJson,
        OutroUnlock, RevealTarget, SceneType, SubjectJson, SublocationJson, TestimonyJson,
        TestimonyLineJson, TopicJson, UnlockExpr, VisualAssetCueJson,
    };
    use crate::game::state::{EvidenceRecord, StatementRecord};
    use crate::game::view::DialogueHistoryEntry;

    fn investigation_scene_with_intro(
        id: &str,
        intro: Vec<DialogueItem>,
    ) -> InvestigationSceneJson {
        InvestigationSceneJson {
            id: id.into(),
            title: id.into(),
            asset_refs: vec![],
            intro,
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
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: intro_queue_gen + 1,
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
        }
    }

    fn token_from(view: &GameStateView) -> QueueToken {
        match &view.mode {
            ModeView::Dialogue { queue_token, .. } => queue_token.clone(),
            other => panic!("expected dialogue mode, got {other:?}"),
        }
    }

    fn history_labels(view: &GameStateView) -> Vec<String> {
        view.dialogue_history
            .iter()
            .map(|entry| match entry {
                DialogueHistoryEntry::Line { speaker, text, .. } => {
                    format!("{speaker}: {text}")
                }
                DialogueHistoryEntry::Action { text, .. } => format!("narration: {text}"),
            })
            .collect()
    }

    fn dialogue_history_fixture_resources(line_count: usize) -> PathBuf {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-dialogue-history-test-{}-{}",
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
                    "title": "Chapter One",
                    "summary": "First",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" },
                        { "type": "linear", "file": "chapter_1/scene_1.json" }
                    ]
                }]
            }"#,
        )
        .unwrap();

        let mut queue_items = Vec::new();
        queue_items.push(
            r#"{ "kind": "sceneTag", "text": "opening", "assetCue": { "backgroundAssetId": "background.opening" } }"#.to_string(),
        );
        for i in 0..line_count {
            if i % 2 == 0 {
                queue_items.push(format!(
                    r#"{{ "kind": "line", "speaker": "A", "text": "line {i}" }}"#
                ));
            } else {
                queue_items.push(format!(r#"{{ "kind": "action", "text": "action {i}" }}"#));
            }
        }
        fs::write(
            chapter_dir.join("scene_0.json"),
            format!(
                r#"{{
                    "type": "linear",
                    "id": "scene_0",
                    "title": "Opening",
                    "queue": [{}]
                }}"#,
                queue_items.join(",")
            ),
        )
        .unwrap();
        fs::write(
            chapter_dir.join("scene_1.json"),
            r#"{
                "type": "linear",
                "id": "scene_1",
                "title": "Next",
                "queue": [{ "kind": "line", "speaker": "B", "text": "next scene" }]
            }"#,
        )
        .unwrap();
        d
    }

    fn scene_jump_fixture_resources() -> PathBuf {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d =
            std::env::temp_dir().join(format!("lyra-scene-jump-test-{}-{}", std::process::id(), n));
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
                "hotspots": [{
                    "id": "never",
                    "label": "Never",
                    "description": "Never",
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [],
                    "inspectDialogue": [],
                    "onReexamine": null
                }],
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
                "kind": "inquiry",
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
            "outro": { "unlock": "auto", "dialogue": [] }
        }"#,
        )
        .unwrap();
        d
    }

    #[test]
    fn dialogue_history_records_initial_visible_item_and_skips_scene_tags() {
        let d = dialogue_history_fixture_resources(2);
        let engine = GameEngine::new_started(d.clone()).unwrap();
        let view = engine.view();

        assert_eq!(history_labels(&view), vec!["A: line 0"]);
        assert_eq!(view.dialogue_history.len(), 1);
        match &view.dialogue_history[0] {
            DialogueHistoryEntry::Line {
                id,
                speaker,
                text,
                chapter_title,
                scene_title,
            } => {
                assert_eq!(*id, 1);
                assert_eq!(speaker, "A");
                assert_eq!(text, "line 0");
                assert_eq!(chapter_title, "Chapter One");
                assert_eq!(scene_title, "Opening");
            }
            other => panic!("expected line history entry, got {other:?}"),
        }

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn dialogue_history_records_action_and_line_items_and_keeps_newest_fifty() {
        let d = dialogue_history_fixture_resources(55);
        let mut engine = GameEngine::new_started(d.clone()).unwrap();

        while matches!(engine.view().mode, ModeView::Dialogue { .. }) {
            let token = token_from(&engine.view());
            engine.advance_dialogue(token).unwrap();
            if matches!(engine.view().mode, ModeView::GameComplete) {
                break;
            }
        }

        let view = engine.view();
        assert_eq!(view.dialogue_history.len(), 50);
        assert_eq!(history_labels(&view).first().unwrap(), "A: line 6");
        assert_eq!(history_labels(&view).last().unwrap(), "B: next scene");

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn dialogue_history_ignores_stale_queue_tokens() {
        let d = dialogue_history_fixture_resources(3);
        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let stale = token_from(&engine.view());

        let after_first = engine.advance_dialogue(stale.clone()).unwrap();
        assert_eq!(
            history_labels(&after_first),
            vec!["A: line 0", "narration: action 1"]
        );

        let after_stale = engine.advance_dialogue(stale).unwrap();
        assert_eq!(
            history_labels(&after_stale),
            vec!["A: line 0", "narration: action 1"]
        );

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn dialogue_history_resets_on_scene_jump() {
        let d = scene_jump_fixture_resources();
        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        assert_eq!(history_labels(&engine.view()), vec!["A: linear start"]);

        let view = engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();

        assert_eq!(history_labels(&view), vec!["B: investigation intro"]);

        let _ = std::fs::remove_dir_all(d);
    }

    /// Source-contract test: every `pub fn` on `GameEngine` that returns
    /// `Result<GameStateView, GameError>` MUST route its success path through
    /// `view_with_history()`. This is the only way to catch a new advancing
    /// command that forgets to record dialogue history — the bug class the
    /// `view_with_history()` contract exists to prevent (see the doc comment
    /// on `view_with_history`). `view()` itself returns `GameStateView`
    /// directly (not a `Result`), so it is naturally excluded.
    ///
    /// The scan enforces two invariants per tracked function:
    /// 1. `view_with_history()` appears at least once in the body, AND
    /// 2. no `Ok(self.view())` appears in the body — because a command whose
    ///    main advancing branch returns `Ok(self.view())` would silently drop
    ///    dialogue history even if `view_with_history()` happens to appear on
    ///    a side branch or in a comment. The single tolerated `Ok(self.view())`
    ///    is the stale-token early return in `advance_dialogue`, which
    ///    intentionally does not advance the focused item — so `view()` there
    ///    is correct and `view_with_history()` is still present elsewhere in
    ///    the same function for the advancing path. That exception is
    ///    allow-listed by function name below; new exceptions require explicit
    ///    review and a matching entry.
    #[test]
    fn every_view_returning_command_routes_through_view_with_history() {
        let source = include_str!("mod.rs");
        // Functions allow-listed for an `Ok(self.view())` return. Each entry
        // must have a documented reason in the doc comment above.
        let allowed_bare_view: &[&str] = &["advance_dialogue"];

        let mut seen_commands: Vec<String> = Vec::new();
        let mut missing: Vec<String> = Vec::new();
        let mut bare_view: Vec<String> = Vec::new();

        // Walk the source line by line. When a `pub fn` is encountered, start
        // accumulating its signature (which may span multiple lines until the
        // opening `{`). If the signature contains `-> Result<GameStateView,
        // GameError>`, track the function body for `view_with_history()` and
        // `Ok(self.view())`. When the next `pub fn` starts (or we hit the test
        // module), close out the current function and assert it called
        // `view_with_history()` and did not return `Ok(self.view())`.
        let mut current_fn: Option<String> = None;
        let mut current_body_has_history = false;
        let mut current_body_has_bare_view = false;
        // Accumulates signature lines for multi-line `pub fn` declarations.
        let mut signature_buf: String = String::new();
        let mut in_signature = false;

        for line in source.lines() {
            let trimmed = line.trim_start();

            // Stop scanning at the test module boundary — test code (including
            // this very test) mentions `view_with_history()` and
            // `Ok(self.view())` in string literals and would create false
            // positives.
            if trimmed.starts_with("mod tests {") || trimmed.starts_with("#[cfg(test)]") {
                break;
            }

            // A new `pub fn` starts. Close out the previous tracked function.
            if trimmed.starts_with("pub fn ") {
                if let Some(name) = current_fn.take() {
                    if !current_body_has_history {
                        missing.push(name.clone());
                    }
                    if current_body_has_bare_view && !allowed_bare_view.contains(&name.as_str()) {
                        bare_view.push(name);
                    }
                    current_body_has_history = false;
                    current_body_has_bare_view = false;
                }

                // Extract the function name and begin accumulating the
                // signature (may span multiple lines until `{`).
                let after_fn = trimmed.strip_prefix("pub fn ").unwrap_or(trimmed);
                let name = after_fn
                    .split(|c: char| c == '(' || c.is_whitespace())
                    .next()
                    .unwrap_or("<unknown>")
                    .to_string();
                signature_buf.clear();
                signature_buf.push_str(trimmed);
                in_signature = true;

                // Single-line signature: `pub fn foo(...) -> Type {`
                if trimmed.contains('{') {
                    in_signature = false;
                    if signature_buf.contains("-> Result<GameStateView, GameError>") {
                        current_fn = Some(name.clone());
                        seen_commands.push(name);
                    }
                }
                continue;
            }

            // Continuation of a multi-line signature.
            if in_signature {
                signature_buf.push(' ');
                signature_buf.push_str(trimmed);
                if trimmed.contains('{') {
                    in_signature = false;
                    if signature_buf.contains("-> Result<GameStateView, GameError>") {
                        // Re-extract the name from the buffer.
                        let after_fn = signature_buf
                            .strip_prefix("pub fn ")
                            .unwrap_or(&signature_buf);
                        let name = after_fn
                            .split(|c: char| c == '(' || c.is_whitespace())
                            .next()
                            .unwrap_or("<unknown>")
                            .to_string();
                        current_fn = Some(name.clone());
                        seen_commands.push(name);
                    }
                }
                continue;
            }

            if current_fn.is_some() {
                if trimmed.contains("view_with_history()") {
                    current_body_has_history = true;
                }
                if trimmed.contains("Ok(self.view())") {
                    current_body_has_bare_view = true;
                }
            }
        }

        // Close out the last tracked function.
        if let Some(name) = current_fn.take() {
            if !current_body_has_history {
                missing.push(name.clone());
            }
            if current_body_has_bare_view && !allowed_bare_view.contains(&name.as_str()) {
                bare_view.push(name);
            }
        }

        assert!(
            !seen_commands.is_empty(),
            "source-contract test found no Result<GameStateView, GameError> commands; \
             the scanner is likely broken"
        );
        assert!(
            missing.is_empty(),
            "these GameEngine commands return Result<GameStateView, GameError> but never \
             call view_with_history() — they will silently drop dialogue history \
             when they advance the focused item: {missing:?} \
             (tracked commands: {seen_commands:?})"
        );
        assert!(
            bare_view.is_empty(),
            "these GameEngine commands return Result<GameStateView, GameError> and contain \
             `Ok(self.view())` — a bare view return on an advancing path silently drops \
             dialogue history. Route the success path through `view_with_history()` instead. \
             If this is a documented non-advancing early return (e.g. a stale-token guard), \
             add the function name to `allowed_bare_view` in this test with a justification \
             in the doc comment. Offending functions: {bare_view:?} \
             (tracked commands: {seen_commands:?})"
        );
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
        // the failing jump, then asserts restore_snapshot put the non-empty
        // history back exactly as it was.
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
        // restore_snapshot copied the history fields (not just left them empty).
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
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
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

    fn subject() -> SubjectJson {
        SubjectJson {
            id: "suspect".into(),
            name: "Suspect".into(),
            role: "Witness".into(),
            bio: "Quiet.".into(),
        }
    }

    /// A testimony with no lines — used for questions whose testimony content
    /// is irrelevant to the test at hand. Note that `begin_question` treats a
    /// testimony with no contradiction-bearing line as auto-broken.
    fn empty_testimony() -> TestimonyJson {
        TestimonyJson {
            on_loop: vec![],
            default_challenge: vec![],
            default_wrong: vec![],
            lines: vec![],
        }
    }

    /// A single required phase (`press`) with one question (`alibi`) that has
    /// two testimony lines: `l_off` (no contradiction) and `l_deny`
    /// (contradiction `evidence:cleaning_log`). Mirrors
    /// `scenes::interrogation::tests::two_line_question_scene` so the
    /// view-builder test below exercises the same cross-exam shape Task 7's
    /// state-machine tests cover.
    fn two_line_question_scene() -> InterrogationSceneJson {
        InterrogationSceneJson {
            id: "interrogation_scene_1".into(),
            title: "Interrogation".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![InterrogationPhaseJson::Inquiry {
                id: "press".into(),
                label: "Press".into(),
                subject: subject(),
                required: true,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![InquiryQuestionJson {
                    id: "alibi".into(),
                    label: "Alibi".into(),
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![],
                    testimony: TestimonyJson {
                        on_loop: vec![DialogueItem::Action {
                            text: "loop".into(),
                        }],
                        default_challenge: vec![],
                        default_wrong: vec![],
                        lines: vec![
                            TestimonyLineJson {
                                id: "l_off".into(),
                                label: "Off".into(),
                                content: vec![DialogueItem::Line {
                                    speaker: "suspect".into(),
                                    text: "我那天沒去。".into(),
                                    portrait: None,
                                }],
                                contradiction: None,
                                challenge: vec![],
                                on_correct: vec![],
                                on_wrong_evidence: vec![],
                                reveals: vec![],
                            },
                            TestimonyLineJson {
                                id: "l_deny".into(),
                                label: "Deny".into(),
                                content: vec![DialogueItem::Line {
                                    speaker: "suspect".into(),
                                    text: "我從沒打掃過那裡。".into(),
                                    portrait: None,
                                }],
                                contradiction: Some(InventoryTarget::Evidence {
                                    id: "cleaning_log".into(),
                                }),
                                challenge: vec![DialogueItem::Action {
                                    text: "challenge".into(),
                                }],
                                on_correct: vec![DialogueItem::Action {
                                    text: "correct".into(),
                                }],
                                on_wrong_evidence: vec![DialogueItem::Action {
                                    text: "wrong".into(),
                                }],
                                reveals: vec![],
                            },
                        ],
                    },
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

    fn empty_inquiry_interrogation_scene() -> InterrogationSceneJson {
        InterrogationSceneJson {
            id: "interrogation_scene_1".into(),
            title: "Interrogation".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![InterrogationPhaseJson::Inquiry {
                id: "inquiry".into(),
                label: "Inquiry".into(),
                subject: subject(),
                required: true,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![crate::game::schema::InterrogationRevealTarget::Evidence {
                    id: "note".into(),
                }],
                scene_tag: "interrogation_room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![DialogueItem::Line {
                    speaker: "A".into(),
                    text: "entry".into(),
                    portrait: None,
                }],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![],
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
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                dialogue: vec![],
            },
        }
    }

    fn locked_unsatisfied_interrogation_scene() -> InterrogationSceneJson {
        InterrogationSceneJson {
            id: "interrogation_scene_1".into(),
            title: "Interrogation".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![InterrogationPhaseJson::Inquiry {
                id: "locked_inquiry".into(),
                label: "Locked Inquiry".into(),
                subject: subject(),
                required: true,
                status: LockStatus::Locked,
                unlock: None,
                reveals: vec![],
                scene_tag: "interrogation_room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Expr(
                    InterrogationUnlockExpr::EvidenceCollected {
                        _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                        id: "missing".into(),
                    },
                ),
                dialogue: vec![],
            },
        }
    }

    fn locked_inventory_unlocked_interrogation_scene() -> InterrogationSceneJson {
        InterrogationSceneJson {
            id: "interrogation_scene_1".into(),
            title: "Interrogation".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![InterrogationPhaseJson::Inquiry {
                id: "inventory_unlocked_inquiry".into(),
                label: "Inventory Unlocked Inquiry".into(),
                subject: subject(),
                required: true,
                status: LockStatus::Locked,
                unlock: Some(InterrogationUnlockExpr::EvidenceCollected {
                    _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                    id: "key".into(),
                }),
                reveals: vec![crate::game::schema::InterrogationRevealTarget::Evidence {
                    id: "note".into(),
                }],
                scene_tag: "interrogation_room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![DialogueItem::Line {
                    speaker: "A".into(),
                    text: "entry".into(),
                    portrait: None,
                }],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![crate::game::schema::InquiryQuestionJson {
                    id: "required_question".into(),
                    label: "Required Question".into(),
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![],
                    testimony: empty_testimony(),
                }],
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
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                dialogue: vec![],
            },
        }
    }

    fn source_order_inventory_unlocked_interrogation_scene() -> InterrogationSceneJson {
        InterrogationSceneJson {
            id: "interrogation_scene_1".into(),
            title: "Interrogation".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![
                InterrogationPhaseJson::Inquiry {
                    id: "early_inventory_inquiry".into(),
                    label: "Early Inventory Inquiry".into(),
                    subject: subject(),
                    required: true,
                    status: LockStatus::Locked,
                    unlock: Some(InterrogationUnlockExpr::EvidenceCollected {
                        _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                        id: "key".into(),
                    }),
                    reveals: vec![crate::game::schema::InterrogationRevealTarget::Evidence {
                        id: "early_note".into(),
                    }],
                    scene_tag: "early_room".into(),
                    flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                    entry_dialogue: vec![DialogueItem::Line {
                        speaker: "A".into(),
                        text: "early entry".into(),
                        portrait: None,
                    }],
                    complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                    questions: vec![crate::game::schema::InquiryQuestionJson {
                        id: "early_question".into(),
                        label: "Early Question".into(),
                        status: LockStatus::Unlocked,
                        required: true,
                        unlock: None,
                        reveals: vec![],
                        testimony: empty_testimony(),
                    }],
                },
                InterrogationPhaseJson::Inquiry {
                    id: "late_static_inquiry".into(),
                    label: "Late Static Inquiry".into(),
                    subject: subject(),
                    required: true,
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![crate::game::schema::InterrogationRevealTarget::Evidence {
                        id: "late_note".into(),
                    }],
                    scene_tag: "late_room".into(),
                    flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                    entry_dialogue: vec![DialogueItem::Line {
                        speaker: "A".into(),
                        text: "late entry".into(),
                        portrait: None,
                    }],
                    complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                    questions: vec![crate::game::schema::InquiryQuestionJson {
                        id: "late_question".into(),
                        label: "Late Question".into(),
                        status: LockStatus::Unlocked,
                        required: true,
                        unlock: None,
                        reveals: vec![],
                        testimony: empty_testimony(),
                    }],
                },
            ],
            evidence_manifest: vec![
                EvidenceJson {
                    id: "early_note".into(),
                    name: "Early Note".into(),
                    description: "Early Note".into(),
                    details: "Early Note".into(),
                    image_asset_id: None,
                    on_collect: vec![],
                    on_reexamine: None,
                },
                EvidenceJson {
                    id: "late_note".into(),
                    name: "Late Note".into(),
                    description: "Late Note".into(),
                    details: "Late Note".into(),
                    image_asset_id: None,
                    on_collect: vec![],
                    on_reexamine: None,
                },
            ],
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
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: intro_queue_gen + 1,
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
        }
    }

    fn completed_interrogation_engine_with_bad_next_scene(
        resources_dir: PathBuf,
        inventory: Inventory,
    ) -> GameEngine {
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
        scene.current_phase_id = None;
        scene.outro_played = true;
        GameEngine {
            resources_dir,
            chapters: vec![ChapterManifest {
                id: "chapter_1".into(),
                title: "Chapter 1".into(),
                summary: "summary".into(),
                scenes: vec![
                    SceneRef {
                        scene_type: SceneType::Interrogation,
                        file: "chapter_1/interrogation_scene_1.json".into(),
                    },
                    SceneRef {
                        scene_type: SceneType::Interrogation,
                        file: "chapter_1/interrogation_scene_2.json".into(),
                    },
                ],
            }],
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: SceneRuntime::Interrogation(Box::new(scene)),
            last_visual_cue: LastVisualCue {
                scene_tag: Some("before".into()),
                ..Default::default()
            },
            inventory,
            next_queue_gen: 7,
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
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
    fn interrogation_auto_outro_skips_optional_phase_after_required_completion() {
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

        let view = engine.ask_interrogation_question("required_q").unwrap();

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
    fn reexamine_evidence_rolls_back_tag_only_queue_when_scene_advance_fails() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-reexamine-evidence-rollback-test-{}-{}",
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
                "title": "Wrong Type",
                "queue": []
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
                on_reexamine: Some(vec![DialogueItem::SceneTag {
                    text: "tag_only".into(),
                    asset_cue: None,
                }]),
                collected_in_chapter_id: "chapter_1".into(),
                collected_in_scene_id: "interrogation_scene_1".into(),
            }],
            statements: vec![],
        };
        let mut engine = completed_interrogation_engine_with_bad_next_scene(d.clone(), inventory);
        let previous_scene_tag = engine.last_visual_cue.scene_tag.clone();
        let previous_next_queue_gen = engine.next_queue_gen;

        let err = engine.reexamine_evidence("note").unwrap_err();

        assert_eq!(err.code, "sceneValidationFailed");
        assert_eq!(engine.current_scene_idx, 0);
        assert_eq!(engine.last_visual_cue.scene_tag, previous_scene_tag);
        assert_eq!(engine.next_queue_gen, previous_next_queue_gen);
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene after rollback");
        };
        assert!(scene.pending_queue.is_none());
        // Snapshot rollback must restore dialogue history after a failed
        // advance path (design spec: dialogue-history-design.md "Testing").
        // The fixture starts with empty history; the failed reexamine records
        // nothing on the success path, so rollback should leave it empty.
        assert!(
            engine.dialogue_history.is_empty(),
            "dialogue history must be restored to its pre-command state after rollback, got {:?}",
            engine.dialogue_history
        );
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn reexamine_statement_rolls_back_tag_only_queue_when_scene_advance_fails() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-reexamine-statement-rollback-test-{}-{}",
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
                "title": "Wrong Type",
                "queue": []
            }"#,
        )
        .unwrap();

        let inventory = Inventory {
            evidence: vec![],
            statements: vec![StatementRecord {
                id: "alibi".into(),
                speaker: "Witness".into(),
                content: "Alibi".into(),
                on_reexamine: Some(vec![DialogueItem::SceneTag {
                    text: "tag_only".into(),
                    asset_cue: None,
                }]),
                acquired_in_chapter_id: "chapter_1".into(),
                acquired_in_scene_id: "interrogation_scene_1".into(),
            }],
        };
        let mut engine = completed_interrogation_engine_with_bad_next_scene(d.clone(), inventory);
        let previous_scene_tag = engine.last_visual_cue.scene_tag.clone();
        let previous_next_queue_gen = engine.next_queue_gen;

        let err = engine.reexamine_statement("alibi").unwrap_err();

        assert_eq!(err.code, "sceneValidationFailed");
        assert_eq!(engine.current_scene_idx, 0);
        assert_eq!(engine.last_visual_cue.scene_tag, previous_scene_tag);
        assert_eq!(engine.next_queue_gen, previous_next_queue_gen);
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene after rollback");
        };
        assert!(scene.pending_queue.is_none());
        let _ = fs::remove_dir_all(d);
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
    fn stale_intro_token_does_not_advance_later_scene_with_same_id() {
        let first_scene = investigation_scene_with_intro(
            "investigation_scene_1",
            vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "first".into(),
                portrait: None,
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
                portrait: None,
            }],
        );
        engine.scene = SceneRuntime::Investigation(Box::new(InvestigationSceneState::from_json(
            next_scene, 7,
        )));
        engine.last_visual_cue.scene_tag = None;
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
                    asset_cue: None,
                },
                DialogueItem::SceneTag {
                    text: "雨中".into(),
                    asset_cue: None,
                },
                DialogueItem::Line {
                    speaker: "A".into(),
                    text: "hello".into(),
                    portrait: None,
                },
            ],
        );
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.prime_initial_queue().unwrap();

        assert_eq!(engine.last_visual_cue.scene_tag, Some("雨中".into()));
        let view = engine.view();
        match &view.mode {
            ModeView::Dialogue {
                current, scene_tag, ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "A" && text == "hello")
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
                    reveals: vec![],
                    layout: None,
                    inspect_dialogue: vec![
                        DialogueItem::SceneTag {
                            text: "desk_closeup".into(),
                            asset_cue: None,
                        },
                        DialogueItem::Line {
                            speaker: "A".into(),
                            text: "found it".into(),
                            portrait: None,
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
                    matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "A" && text == "found it")
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
    fn prime_initial_queue_consumes_leading_scene_tags_in_linear_scene() {
        use crate::game::schema::LinearSceneJson;
        let scene_json = LinearSceneJson {
            id: "scene_0".into(),
            title: "Test".into(),
            asset_refs: vec![],
            queue: vec![
                DialogueItem::SceneTag {
                    text: "吉祥寺街道".into(),
                    asset_cue: None,
                },
                DialogueItem::SceneTag {
                    text: "雨中".into(),
                    asset_cue: None,
                },
                DialogueItem::Line {
                    speaker: "A".into(),
                    text: "hello".into(),
                    portrait: None,
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
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
        };
        engine.prime_initial_queue().unwrap();

        // Both leading SceneTags should be consumed; last_visual_cue.scene_tag holds the
        // most recent tag text and the cursor points at the first real item.
        assert_eq!(engine.last_visual_cue.scene_tag, Some("雨中".into()));
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
        // directly on the second Line, with last_visual_cue.scene_tag holding the final tag.
        use crate::game::schema::LinearSceneJson;
        let scene_json = LinearSceneJson {
            id: "scene_0".into(),
            title: "Test".into(),
            asset_refs: vec![],
            queue: vec![
                DialogueItem::Line {
                    speaker: "A".into(),
                    text: "first".into(),
                    portrait: None,
                },
                DialogueItem::SceneTag {
                    text: "mid_scene_1".into(),
                    asset_cue: None,
                },
                DialogueItem::SceneTag {
                    text: "mid_scene_2".into(),
                    asset_cue: None,
                },
                DialogueItem::Line {
                    speaker: "B".into(),
                    text: "second".into(),
                    portrait: None,
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
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
        };
        // prime_initial_queue: no leading tags, cursor at 0 (first Line)
        engine.prime_initial_queue().unwrap();
        assert_eq!(engine.last_visual_cue.scene_tag, None);

        let view = engine.view();
        let token = match &view.mode {
            ModeView::Dialogue { queue_token, .. } => queue_token.clone(),
            other => panic!("expected Dialogue, got {other:?}"),
        };

        // Advance past "first" — should skip both SceneTags, land on "second"
        let view = engine.advance_dialogue(token).unwrap();
        assert_eq!(engine.last_visual_cue.scene_tag, Some("mid_scene_2".into()));
        match &view.mode {
            ModeView::Dialogue {
                current, scene_tag, ..
            } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "B" && text == "second")
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
        assert_eq!(history_labels(&before), vec!["A: before"]);
        let token = token_from(&before);
        let err = engine.advance_dialogue(token).unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        let after = engine.view();
        assert_eq!(history_labels(&after), vec!["A: before"]);
        match after.mode {
            ModeView::Dialogue { current, .. } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "A" && text == "before")
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
            asset_refs: vec![],
            intro: vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "intro".into(),
                portrait: None,
            }],
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
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
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
                    matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "A" && text == "intro")
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
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
        };
        engine.prime_initial_queue().unwrap();
        let previous_scene_tag = engine.last_visual_cue.scene_tag.clone();
        let previous_next_queue_gen = engine.next_queue_gen;

        let err = engine.inspect_hotspot("desk").unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        assert_eq!(engine.current_chapter_idx, 0);
        assert_eq!(engine.current_scene_idx, 0);
        assert_eq!(engine.last_visual_cue.scene_tag, previous_scene_tag);
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
            matches!(view.mode, ModeView::Explore { sublocation_id, .. } if sublocation_id == "room")
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
    fn tag_only_linear_scene_advances_to_game_complete() {
        use crate::game::schema::LinearSceneJson;
        // A chapter with a single tag-only scene should advance to GameComplete
        // instead of stalling with the cursor at the end of the queue.
        let tag_only_json = LinearSceneJson {
            id: "scene_0".into(),
            title: "Tag Only".into(),
            asset_refs: vec![],
            queue: vec![DialogueItem::SceneTag {
                text: "吉祥寺街道".into(),
                asset_cue: None,
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
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
        };
        engine.prime_initial_queue().unwrap();

        // Scene was tag-only → advance_scene ran → past last chapter → GameComplete.
        assert!(matches!(engine.view().mode, ModeView::GameComplete));
        assert_eq!(engine.last_visual_cue.scene_tag, Some("吉祥寺街道".into()));
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
                        default_challenge: vec![],
                        default_wrong: vec![],
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
                        default_challenge: vec![],
                        default_wrong: vec![],
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
                            default_challenge: vec![],
                            default_wrong: vec![],
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
                            default_challenge: vec![],
                            default_wrong: vec![],
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
