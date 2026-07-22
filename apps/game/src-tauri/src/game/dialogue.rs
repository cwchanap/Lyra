// src-tauri/src/game/dialogue.rs
//
// Dialogue history and queue lifecycle.

use super::scenes::interrogation::{AdvanceOutcome, CrossExam};
use super::scenes::investigation::DialogueQueue;
use super::scenes::SceneRuntime;
use super::schema::DialogueItem;
use super::view::{DialogueHistoryEntry, QueueToken};
use super::{GameEngine, GameError};

const DIALOGUE_HISTORY_LIMIT: usize = 50;

/// The engine's rolling dialogue log. Owns dedup-by-token, the entry cap, and
/// the rule that scene tags are not logged.
#[derive(Clone)]
pub(super) struct DialogueHistory {
    entries: Vec<DialogueHistoryEntry>,
    next_id: u64,
    last_token: Option<QueueToken>,
}

impl Default for DialogueHistory {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            next_id: 1,
            last_token: None,
        }
    }
}

impl DialogueHistory {
    pub(super) fn entries(&self) -> &[DialogueHistoryEntry] {
        &self.entries
    }

    pub(super) fn reset(&mut self) {
        *self = Self::default();
    }

    pub(super) fn is_last_token(&self, token: &QueueToken) -> bool {
        self.last_token.as_ref() == Some(token)
    }

    pub(super) fn record(
        &mut self,
        token: QueueToken,
        item: DialogueItem,
        chapter_title: String,
        scene_title: String,
    ) {
        if self.is_last_token(&token) {
            return;
        }
        let id = self.next_id;
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
            // Scene tags are not logged, and must not consume the token —
            // matching the pre-extraction early return.
            DialogueItem::SceneTag { .. } => return,
        };

        self.next_id += 1;
        self.last_token = Some(token);
        self.entries.push(entry);
        let overflow = self.entries.len().saturating_sub(DIALOGUE_HISTORY_LIMIT);
        if overflow > 0 {
            self.entries.drain(0..overflow);
        }
    }
}

impl GameEngine {
    pub(super) fn record_current_dialogue_history(&mut self) {
        let Some(token) = self.current_queue_token() else {
            return;
        };
        if self.history.is_last_token(&token) {
            return;
        }
        let Some(item) = self.current_dialogue_item() else {
            return;
        };
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
        self.history.record(token, item, chapter_title, scene_title);
    }

    pub(super) fn current_dialogue_item(&self) -> Option<DialogueItem> {
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

    pub(super) fn current_scene_title(&self) -> String {
        match &self.scene {
            SceneRuntime::Linear(s) => s.title.clone(),
            SceneRuntime::Investigation(inv) => inv.title().to_string(),
            SceneRuntime::Interrogation(scene) => scene.title().to_string(),
        }
    }

    pub(super) fn peek_just_consumed(&self) -> Option<DialogueItem> {
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
    pub(super) fn consume_scene_tags_at_cursor(&mut self) {
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

    /// Install `items` as the active dialogue queue, or run the exhausted-queue
    /// machinery when there is nothing to play.
    pub(super) fn install_or_exhaust(&mut self, items: Vec<DialogueItem>) -> Result<(), GameError> {
        if items.is_empty() {
            return self.on_queue_exhausted();
        }
        let queue_gen = self.alloc_queue_gen();
        self.install_scene_queue(items, queue_gen)
    }

    /// As `install_or_exhaust`, then mark where challengeable testimony line
    /// content begins in the installed queue.
    ///
    /// Order matters: `install_scene_queue` sets `line_content_start` to
    /// `items.len()` (the "nothing here is challengeable" default), so the
    /// override must come after the install or it is silently discarded and the
    /// inline 反駁 control never appears. The variant guard is retained rather
    /// than assumed, because installation can drain to empty and reach
    /// `on_queue_exhausted`, which may transition the scene.
    pub(super) fn install_or_exhaust_line_content(
        &mut self,
        items: Vec<DialogueItem>,
        line_content_start: usize,
    ) -> Result<(), GameError> {
        if items.is_empty() {
            return self.on_queue_exhausted();
        }
        let queue_gen = self.alloc_queue_gen();
        self.install_scene_queue(items, queue_gen)?;
        if let SceneRuntime::Interrogation(scene) = &mut self.scene {
            scene.line_content_start = line_content_start;
        }
        Ok(())
    }

    /// Scene-entry sequencing lives in `navigation.rs` (`prime_initial_queue`),
    /// which calls into these primitives.
    pub(super) fn install_scene_queue(
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
                // Default: nothing in this queue is challengeable testimony
                // line content. Testimony-line installers override this after
                // the call so the inline 反駁 control only surfaces when the
                // cursor is on actual line content.
                scene.line_content_start = items.len();
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

    pub(super) fn on_queue_exhausted(&mut self) -> Result<(), GameError> {
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
                if self.interrogation_playing_unbroken() {
                    // A not-yet-broken testimony loops in the dialogue box: when
                    // one line's content drains, auto-advance to the next line
                    // instead of ending the phase. The player leaves this loop
                    // only by challenging (反駁) or withdrawing (退下).
                    self.advance_playing_testimony()?;
                } else {
                    // An honest (auto-broken) question has nothing left to
                    // challenge; drop back to the question menu before running
                    // the phase/outro checks so the menu (not an empty Playing
                    // state) is shown.
                    self.finish_broken_playing();
                    if self.try_advance_interrogation()? {
                        self.advance_scene()?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Whether the current interrogation scene is playing a not-yet-broken
    /// testimony (see [`InterrogationSceneState::is_playing_unbroken`]).
    pub(super) fn interrogation_playing_unbroken(&self) -> bool {
        matches!(&self.scene, SceneRuntime::Interrogation(scene) if scene.is_playing_unbroken())
    }

    /// Returns a still-`Playing` (broken) cross-examination to the question
    /// menu. No-op unless a testimony line is being played.
    pub(super) fn finish_broken_playing(&mut self) {
        if let SceneRuntime::Interrogation(scene) = &mut self.scene {
            if scene.is_playing() {
                scene.withdraw();
            }
        }
    }

    /// Auto-advances a looping testimony to its next line while it plays in the
    /// dialogue box, installing that line's content as the next dialogue queue.
    /// Past the last line the testimony loops: the `on_loop` bridge plays and
    /// then line 0 is re-shown, so the whole statement repeats without ever
    /// skipping line 0. Only called while `is_playing_unbroken()`.
    pub(super) fn advance_playing_testimony(&mut self) -> Result<(), GameError> {
        let (queue_items, line_content_start) = {
            let scene = match &mut self.scene {
                SceneRuntime::Interrogation(scene) => scene,
                _ => return Ok(()),
            };
            let CrossExam::Playing { question_id, .. } = scene.cross_exam().clone() else {
                return Ok(());
            };
            match scene.advance_line() {
                AdvanceOutcome::NextLine(index) => (
                    scene
                        .question(&question_id)
                        .and_then(|question| question.testimony.lines.get(index))
                        .map(|line| line.content.clone())
                        .unwrap_or_default(),
                    // Pure line content — challengeable from the first item.
                    0,
                ),
                AdvanceOutcome::Loop => {
                    scene
                        .question(&question_id)
                        .map_or((Vec::new(), 0), |question| {
                            let on_loop_len = question.testimony.on_loop.len();
                            let loop_prompt_len = question.testimony.loop_prompt.len();
                            let mut items = question.testimony.on_loop.clone();
                            items.extend(question.testimony.loop_prompt.iter().cloned());
                            if let Some(first) = question.testimony.lines.first() {
                                items.extend(first.content.iter().cloned());
                            }
                            // The on_loop + loop_prompt bridge plays first; line 0
                            // content follows, so the challenge target only surfaces
                            // once the cursor reaches the line content.
                            (items, on_loop_len + loop_prompt_len)
                        })
                }
            }
        };

        if queue_items.is_empty() {
            // Degenerate testimony (no line content and no loop bridge): return
            // to the menu rather than leaving the player stuck on an empty
            // Playing state.
            // Must not use install_or_exhaust_line_content: on_queue_exhausted
            // dispatches back here while is_playing_unbroken() holds.
            if let SceneRuntime::Interrogation(scene) = &mut self.scene {
                scene.withdraw();
            }
            if self.try_advance_interrogation()? {
                self.advance_scene()?;
            }
        } else {
            self.install_or_exhaust_line_content(queue_items, line_content_start)?;
        }
        Ok(())
    }

    pub(super) fn alloc_queue_gen(&mut self) -> u64 {
        let g = self.next_queue_gen;
        self.next_queue_gen += 1;
        g
    }

    pub(super) fn current_queue_token(&self) -> Option<QueueToken> {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::DialogueItem;
    use crate::game::view::{DialogueHistoryEntry, QueueToken};

    fn token(cursor: usize) -> QueueToken {
        QueueToken {
            scene_id: "s".into(),
            queue_gen: 1,
            cursor,
        }
    }

    fn line(text: &str) -> DialogueItem {
        DialogueItem::Line {
            speaker: "A".into(),
            text: text.into(),
            portrait: None,
        }
    }

    #[test]
    fn record_dedups_on_repeated_token() {
        let mut h = DialogueHistory::default();
        h.record(token(0), line("a"), "ch".into(), "sc".into());
        h.record(token(0), line("a"), "ch".into(), "sc".into());
        assert_eq!(h.entries().len(), 1);
    }

    #[test]
    fn record_keeps_newest_fifty() {
        let mut h = DialogueHistory::default();
        for i in 0..55 {
            h.record(
                token(i),
                line(&format!("line {i}")),
                "ch".into(),
                "sc".into(),
            );
        }
        assert_eq!(h.entries().len(), 50);
        match &h.entries()[0] {
            DialogueHistoryEntry::Line { text, .. } => assert_eq!(text, "line 5"),
            other => panic!("expected line, got {other:?}"),
        }
    }

    #[test]
    fn record_ignores_scene_tags_without_consuming_the_token() {
        let mut h = DialogueHistory::default();
        h.record(
            token(0),
            DialogueItem::SceneTag {
                text: "tag".into(),
                asset_cue: None,
            },
            "ch".into(),
            "sc".into(),
        );
        assert!(h.entries().is_empty());
        // A SceneTag must not mark the token as recorded, or the real item at
        // that cursor would be deduped away.
        assert!(!h.is_last_token(&token(0)));
    }

    #[test]
    fn reset_clears_entries_and_restarts_ids() {
        let mut h = DialogueHistory::default();
        h.record(token(0), line("a"), "ch".into(), "sc".into());
        h.reset();
        assert!(h.entries().is_empty());
        h.record(token(1), line("b"), "ch".into(), "sc".into());
        match &h.entries()[0] {
            DialogueHistoryEntry::Line { id, .. } => assert_eq!(*id, 1),
            other => panic!("expected line, got {other:?}"),
        }
    }
}
