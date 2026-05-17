// src-tauri/src/game/mod.rs
//
// GameEngine — the single owner of mutable game state.

pub mod error;
pub mod schema;
pub mod state;
pub mod unlock;
pub mod reveals;
pub mod scenes;
pub mod loader;
pub mod view;

pub use error::GameError;
pub use view::{GameStateView, ModeView, QueueToken};

use std::path::PathBuf;
use scenes::SceneRuntime;
use scenes::investigation::{DialogueQueue, InvestigationSceneState};
use scenes::linear::LinearSceneState;
use schema::{
    DialogueItem, LockStatus, SceneJson,
};
use state::{ChapterManifest, Inventory, SceneRef};
use view::{
    CharacterView, ChapterView, HotspotView, SceneView, SublocationView, TopicView,
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

const REEXAMINE_FALLBACK_TEXT: &str = "（沒有新發現。）";

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
                    .map(|s| SceneRef { scene_type: s.scene_type, file: s.file })
                    .collect(),
            })
            .collect();

        if chapters.is_empty() {
            return Err(GameError::chapter_load_failed("chapters.json has no chapters.".into()));
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
        engine.prime_initial_queue();
        Ok(engine)
    }

    fn prime_initial_queue(&mut self) {
        let needs_initial_sub = match &mut self.scene {
            SceneRuntime::Linear(s) => {
                // Consume leading SceneTag items so the first visible frame
                // has the correct backdrop tag.
                while let Some(DialogueItem::SceneTag { text }) = s.queue.get(s.cursor).cloned() {
                    self.last_scene_tag = Some(text);
                    s.cursor += 1;
                }
                false
            }
            SceneRuntime::Investigation(inv) => {
                if !inv.intro_played && !inv.def.intro.is_empty() {
                    inv.pending_queue = Some(DialogueQueue {
                        items: inv.def.intro.clone(),
                        cursor: 0,
                        queue_gen: inv.intro_queue_gen,
                    });
                    inv.intro_played = true;
                    false
                } else {
                    true
                }
            }
        };
        if needs_initial_sub {
            self.advance_into_first_sublocation();
        }
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
        let exhausted = match &mut self.scene {
            SceneRuntime::Linear(s) => s.advance(),
            SceneRuntime::Investigation(inv) => {
                let q = inv.pending_queue.as_mut().ok_or_else(GameError::no_active_dialogue)?;
                q.cursor += 1;
                q.cursor >= q.items.len()
            }
        };
        if let Some(DialogueItem::SceneTag { text }) = self.peek_just_consumed() {
            self.last_scene_tag = Some(text);
        }
        if exhausted {
            self.on_queue_exhausted()?;
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
        }
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
            let ctx = SceneAndInventoryCtx { scene: inv, inventory: &self.inventory };
            let sat = inv.outro_satisfied(&ctx);
            (sat, inv.outro_played, inv.def.outro.dialogue.clone(), inv.current_sublocation_id.is_none())
        };

        if no_current_sublocation {
            self.advance_into_first_sublocation();
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
                inv.pending_queue = Some(DialogueQueue {
                    items: outro_dialogue,
                    cursor: 0,
                    queue_gen,
                });
                inv.outro_played = true;
            }
            return Ok(false);
        }

        if outro_already_played {
            return Ok(true);
        }
        Ok(false)
    }

    fn advance_into_first_sublocation(&mut self) {
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        // Phase 1 — read out the data we need without holding a mutable borrow into self.scene.
        let chosen = match &self.scene {
            SceneRuntime::Investigation(inv) => inv
                .def
                .sublocations
                .iter()
                .find(|s| s.status == LockStatus::Unlocked)
                .map(|s| (s.id.clone(), s.scene_tag.clone(), s.transition_dialogue.clone(), s.reveals.clone())),
            _ => None,
        };
        let Some((id, scene_tag, transition, sub_reveals)) = chosen else { return; };

        // Phase 2 — write: mutate scene + inventory; reveals fire on first entry.
        let queue_items = {
            let inv = match &mut self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => return,
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

        if !queue_items.is_empty() {
            let queue_gen = self.alloc_queue_gen();
            if let SceneRuntime::Investigation(inv) = &mut self.scene {
                inv.pending_queue = Some(DialogueQueue { items: queue_items, cursor: 0, queue_gen });
            }
        }
        self.last_scene_tag = Some(scene_tag);
    }

    fn alloc_queue_gen(&mut self) -> u64 {
        let g = self.next_queue_gen;
        self.next_queue_gen += 1;
        g
    }

    fn advance_scene(&mut self) -> Result<(), GameError> {
        self.current_scene_idx += 1;
        let chapter = &self.chapters[self.current_chapter_idx];
        if self.current_scene_idx >= chapter.scenes.len() {
            self.current_chapter_idx += 1;
            self.current_scene_idx = 0;
            if self.current_chapter_idx >= self.chapters.len() {
                return Ok(());
            }
        }
        let queue_gen = self.alloc_queue_gen();
        let scene_ref = self.chapters[self.current_chapter_idx]
            .scenes
            .get(self.current_scene_idx)
            .ok_or_else(|| GameError::chapter_load_failed("scene index out of bounds".into()))?
            .clone();
        let new_scene = load_scene_runtime(&self.resources_dir, &scene_ref, queue_gen)?;
        self.scene = new_scene;
        self.last_scene_tag = None;
        self.prime_initial_queue();
        Ok(())
    }

    pub fn inspect_hotspot(&mut self, hotspot_id: &str) -> Result<GameStateView, GameError> {
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        // Phase 1 — read: clone defs and check locks without holding self.scene mutably.
        let (hot_def, first_time) = {
            let inv = match &self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => return Err(GameError::wrong_mode("inspect_hotspot", "linear")),
            };
            if inv.pending_queue.as_ref().is_some_and(|q| q.cursor < q.items.len()) {
                return Err(GameError::dialogue_active("inspect_hotspot"));
            }
            let sublocation_id = inv
                .current_sublocation_id
                .clone()
                .ok_or_else(|| GameError::wrong_mode("inspect_hotspot", "no sublocation entered"))?;
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
            let ctx = SceneAndInventoryCtx { scene: inv, inventory: &self.inventory };
            if !inv.is_block_unlocked(&format!("hotspot:{}", hotspot_id), hot_def.status, hot_def.unlock.as_ref(), &ctx) {
                return Err(GameError::locked_hotspot(hotspot_id));
            }
            let first_time = !inv.inspected_hotspots.contains(hotspot_id);
            (hot_def, first_time)
        };

        // Phase 2 — compute: build queue (mutates scene + inventory together).
        let queue_items = if first_time {
            let inv = match &mut self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => unreachable!("checked above"),
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
                _ => vec![DialogueItem::Action { text: REEXAMINE_FALLBACK_TEXT.into() }],
            }
        };

        // Phase 3 — write: attach the queue.
        if queue_items.is_empty() {
            self.on_queue_exhausted()?;
        } else {
            let queue_gen = self.alloc_queue_gen();
            if let SceneRuntime::Investigation(inv) = &mut self.scene {
                inv.pending_queue = Some(DialogueQueue { items: queue_items, cursor: 0, queue_gen });
            }
        }
        Ok(self.view())
    }

    pub fn interview_topic(&mut self, character_id: &str, topic_id: &str) -> Result<GameStateView, GameError> {
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        let (topic, first_time) = {
            let inv = match &self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => return Err(GameError::wrong_mode("interview_topic", "linear")),
            };
            if inv.pending_queue.as_ref().is_some_and(|q| q.cursor < q.items.len()) {
                return Err(GameError::dialogue_active("interview_topic"));
            }
            let sub_id = inv
                .current_sublocation_id
                .clone()
                .ok_or_else(|| GameError::wrong_mode("interview_topic", "no sublocation entered"))?;
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
            let ctx = SceneAndInventoryCtx { scene: inv, inventory: &self.inventory };
            if !inv.is_block_unlocked(&key, topic.status, topic.unlock.as_ref(), &ctx) {
                return Err(GameError::locked_topic(character_id, topic_id));
            }
            let first_time = !inv.discussed_topics.contains(&(character_id.into(), topic_id.into()));
            (topic, first_time)
        };

        let queue_items = if first_time {
            let inv = match &mut self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => unreachable!("checked above"),
            };
            inv.record_topic_discussed(character_id, topic_id);
            let body = topic.topic_dialogue.clone();
            reveals::apply_reveals_and_build_queue(inv, &mut self.inventory, body, &topic.reveals, &chapter_id)
        } else {
            match topic.on_reexamine.clone() {
                Some(q) if !q.is_empty() => q,
                _ => vec![DialogueItem::Action { text: REEXAMINE_FALLBACK_TEXT.into() }],
            }
        };

        if queue_items.is_empty() {
            self.on_queue_exhausted()?;
        } else {
            let queue_gen = self.alloc_queue_gen();
            if let SceneRuntime::Investigation(inv) = &mut self.scene {
                inv.pending_queue = Some(DialogueQueue { items: queue_items, cursor: 0, queue_gen });
            }
        }
        Ok(self.view())
    }

    pub fn enter_sublocation(&mut self, sublocation_id: &str) -> Result<GameStateView, GameError> {
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();

        let (scene_tag, transition_dialogue, sub_reveals, first_entry) = {
            let inv = match &self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => return Err(GameError::wrong_mode("enter_sublocation", "linear")),
            };
            if inv.pending_queue.as_ref().is_some_and(|q| q.cursor < q.items.len()) {
                return Err(GameError::dialogue_active("enter_sublocation"));
            }
            let def = inv
                .def
                .sublocations
                .iter()
                .find(|s| s.id == sublocation_id)
                .ok_or_else(|| GameError::unknown_sublocation(sublocation_id))?
                .clone();
            let ctx = SceneAndInventoryCtx { scene: inv, inventory: &self.inventory };
            if !inv.is_block_unlocked(&format!("sublocation:{}", sublocation_id), def.status, def.unlock.as_ref(), &ctx) {
                return Err(GameError::locked_sublocation(sublocation_id));
            }
            let first_entry = !inv.entered_sublocations.contains(sublocation_id);
            (def.scene_tag, def.transition_dialogue, def.reveals, first_entry)
        };

        let queue_items: Vec<DialogueItem> = if first_entry {
            let inv = match &mut self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => unreachable!("checked above"),
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
            if let SceneRuntime::Investigation(inv) = &mut self.scene {
                inv.pending_queue = Some(DialogueQueue { items: queue_items, cursor: 0, queue_gen });
            }
            self.last_scene_tag = Some(scene_tag);
        }
        Ok(self.view())
    }

    pub fn reexamine_evidence(&mut self, id: &str) -> Result<GameStateView, GameError> {
        if let SceneRuntime::Investigation(inv) = &self.scene {
            if inv.pending_queue.as_ref().is_some_and(|q| q.cursor < q.items.len()) {
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
            _ => vec![DialogueItem::Action { text: REEXAMINE_FALLBACK_TEXT.into() }],
        };
        let queue_gen = self.alloc_queue_gen();
        match &mut self.scene {
            SceneRuntime::Investigation(inv) => {
                inv.pending_queue = Some(DialogueQueue { items: queue_items, cursor: 0, queue_gen });
            }
            SceneRuntime::Linear(_) => {
                return Err(GameError::wrong_mode("reexamine_evidence", "linear"));
            }
        }
        Ok(self.view())
    }

    pub fn reexamine_statement(&mut self, id: &str) -> Result<GameStateView, GameError> {
        if let SceneRuntime::Investigation(inv) = &self.scene {
            if inv.pending_queue.as_ref().is_some_and(|q| q.cursor < q.items.len()) {
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
            _ => vec![DialogueItem::Action { text: REEXAMINE_FALLBACK_TEXT.into() }],
        };
        let queue_gen = self.alloc_queue_gen();
        match &mut self.scene {
            SceneRuntime::Investigation(inv) => {
                inv.pending_queue = Some(DialogueQueue { items: queue_items, cursor: 0, queue_gen });
            }
            SceneRuntime::Linear(_) => {
                return Err(GameError::wrong_mode("reexamine_statement", "linear"));
            }
        }
        Ok(self.view())
    }

    fn current_queue_token(&self) -> Option<QueueToken> {
        match &self.scene {
            SceneRuntime::Linear(s) => {
                if s.cursor < s.queue.len() {
                    Some(QueueToken { scene_id: s.id.clone(), queue_gen: s.queue_gen, cursor: s.cursor })
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
                },
                scene_tag: self.last_scene_tag.clone(),
                queue_token: t,
            },
            _ => match &self.scene {
                SceneRuntime::Investigation(inv) => match &inv.current_sublocation_id {
                    Some(sub_id) => ModeView::Explore { sublocation_id: sub_id.clone() },
                    None => ModeView::GameComplete,
                },
                SceneRuntime::Linear(_) => ModeView::GameComplete,
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
        let total = self.chapters[self.current_chapter_idx.min(self.chapters.len() - 1)].scenes.len();
        match &self.scene {
            SceneRuntime::Linear(s) => SceneView::Linear {
                id: s.id.clone(),
                title: s.title.clone(),
                index: self.current_scene_idx,
                total,
            },
            SceneRuntime::Investigation(inv) => {
                let ctx = SceneAndInventoryCtx { scene: inv, inventory: &self.inventory };
                let visible_sublocations: Vec<SublocationView> = inv
                    .def
                    .sublocations
                    .iter()
                    .filter(|s| inv.is_block_unlocked(&format!("sublocation:{}", s.id), s.status, s.unlock.as_ref(), &ctx))
                    .map(|s| SublocationView {
                        id: s.id.clone(),
                        scene_tag: s.scene_tag.clone(),
                        hotspots: s
                            .hotspots
                            .iter()
                            .filter(|h| inv.is_block_unlocked(&format!("hotspot:{}", h.id), h.status, h.unlock.as_ref(), &ctx))
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
                                    .filter(|t| inv.is_block_unlocked(&format!("topic:{}@{}", c.id, t.id), t.status, t.unlock.as_ref(), &ctx))
                                    .map(|t| TopicView {
                                        id: t.id.clone(),
                                        label: t.label.clone(),
                                        discussed: inv.discussed_topics.contains(&(c.id.clone(), t.id.clone())),
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
        }
    }
}

fn load_scene_runtime(
    resources_dir: &std::path::Path,
    scene_ref: &SceneRef,
    queue_gen: u64,
) -> Result<SceneRuntime, GameError> {
    let json = loader::load_scene(resources_dir, &scene_ref.file)?;
    Ok(match json {
        SceneJson::Linear(j) => SceneRuntime::Linear(LinearSceneState::from_json(j, queue_gen)),
        SceneJson::Investigation(j) => SceneRuntime::Investigation(InvestigationSceneState::from_json(j, queue_gen)),
    })
}

struct SceneAndInventoryCtx<'a> {
    scene: &'a InvestigationSceneState,
    inventory: &'a Inventory,
}
impl<'a> unlock::UnlockContext for SceneAndInventoryCtx<'a> {
    fn evidence_collected(&self, id: &str) -> bool { self.inventory.has_evidence(id) }
    fn statement_acquired(&self, id: &str) -> bool { self.inventory.has_statement(id) }
    fn topic_discussed(&self, c: &str, t: &str) -> bool { self.scene.topic_discussed(c, t) }
    fn hotspot_investigated(&self, id: &str) -> bool { self.scene.hotspot_investigated(id) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{
        CharacterJson, EvidenceJson, HotspotJson, InvestigationSceneJson, LockStatus,
        OutroJson, OutroUnlock, RevealTarget, SceneType, SublocationJson, TopicJson,
        UnlockExpr,
    };

    fn investigation_scene_with_intro(id: &str, intro: Vec<DialogueItem>) -> InvestigationSceneJson {
        InvestigationSceneJson {
            id: id.into(),
            title: id.into(),
            intro,
            sublocations: vec![SublocationJson {
                id: "room".into(),
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
            scene: SceneRuntime::Investigation(InvestigationSceneState::from_json(scene, intro_queue_gen)),
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

    #[test]
    fn stale_intro_token_does_not_advance_later_scene_with_same_id() {
        let first_scene = investigation_scene_with_intro(
            "investigation_scene_1",
            vec![DialogueItem::Line { speaker: "A".into(), text: "first".into() }],
        );
        let mut engine = empty_engine_with_scene(first_scene, 3);
        engine.prime_initial_queue();
        let stale_token = token_from(&engine.view());

        let next_scene = investigation_scene_with_intro(
            "investigation_scene_1",
            vec![DialogueItem::Line { speaker: "B".into(), text: "second".into() }],
        );
        engine.scene = SceneRuntime::Investigation(InvestigationSceneState::from_json(next_scene, 7));
        engine.last_scene_tag = None;
        engine.prime_initial_queue();

        let before = token_from(&engine.view());
        assert_ne!(stale_token, before);

        let after = token_from(&engine.advance_dialogue(stale_token).unwrap());
        assert_eq!(before, after);
    }

    #[test]
    fn silent_first_hotspot_action_can_complete_scene() {
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
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
        engine.prime_initial_queue();

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
                        reveals: vec![RevealTarget::Statement { id: "alibi_statement".into() }],
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
        engine.prime_initial_queue();

        let view = engine.interview_topic("witness", "alibi").unwrap();
        assert!(matches!(view.mode, ModeView::GameComplete));
    }

    #[test]
    fn prime_initial_queue_consumes_leading_scene_tags_in_linear_scene() {
        use crate::game::schema::LinearSceneJson;
        let scene_json = LinearSceneJson {
            id: "scene_0".into(),
            title: "Test".into(),
            queue: vec![
                DialogueItem::SceneTag { text: "吉祥寺街道".into() },
                DialogueItem::SceneTag { text: "雨中".into() },
                DialogueItem::Line { speaker: "A".into(), text: "hello".into() },
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
        engine.prime_initial_queue();

        // Both leading SceneTags should be consumed; last_scene_tag holds the
        // most recent tag text and the cursor points at the first real item.
        assert_eq!(engine.last_scene_tag, Some("雨中".into()));
        let view = engine.view();
        match &view.mode {
            ModeView::Dialogue { current, scene_tag, .. } => {
                assert!(matches!(current, DialogueItem::Line { .. }));
                assert_eq!(scene_tag.as_deref(), Some("雨中"));
            }
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
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
        engine.prime_initial_queue();

        // Player is in room_a (first unlocked sublocation). Enter room_b.
        let view = engine.enter_sublocation("room_b").unwrap();
        assert!(matches!(view.mode, ModeView::GameComplete));
    }
}
