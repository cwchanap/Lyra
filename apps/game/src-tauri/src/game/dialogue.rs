// src-tauri/src/game/dialogue.rs
//
// Dialogue history and queue lifecycle, plus interrogation testimony
// playback (advance_playing_testimony / finish_broken_playing /
// interrogation_playing_unbroken over CrossExam / AdvanceOutcome / testimony
// fields). The cut from mod.rs's phase machine (try_advance_interrogation,
// try_enter_current_interrogation_phase) is queue-driven vs menu-driven: this
// module drives the dialogue queue, mod.rs drives the question menu.

use super::scenes::interrogation::{AdvanceOutcome, CrossExam};
use super::scenes::SceneRuntime;
use super::schema::DialogueItem;
use super::view::{DialogueHistoryEntry, QueueToken};
use super::{interrogation_segment, GameEngine, GameError};
use crate::game::dialogue_queue::{ActiveDialogueQueue, DialogueSegment};

const DIALOGUE_HISTORY_LIMIT: usize = 50;

/// The engine's rolling dialogue log. Owns dedup-by-token, the entry cap, and
/// the rule that scene tags are not logged.
#[derive(Debug, Clone)]
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
        // Checked here as well as inside DialogueHistory::record: this
        // short-circuit must precede the chapter .expect() below, or a repeated
        // token would panic instead of returning quietly.
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
                .and_then(|queue| queue.current().cloned()),
            SceneRuntime::Interrogation(scene) => scene
                .pending_queue
                .as_ref()
                .and_then(|queue| queue.current().cloned()),
        }
    }

    pub(super) fn current_scene_title(&self) -> String {
        match &self.scene {
            SceneRuntime::Linear(s) => s.title.clone(),
            SceneRuntime::Investigation(inv) => inv.title().to_string(),
            SceneRuntime::Interrogation(scene) => scene.title().to_string(),
        }
    }

    /// Advance past any consecutive SceneTag items at the current cursor,
    /// updating `last_visual_cue` for each. Leaves the cursor positioned on
    /// the first non-SceneTag item (or at the end of the queue).
    /// Returns true when consuming tags exhausts the active queue.
    pub(super) fn consume_scene_tags_at_cursor(&mut self) -> bool {
        loop {
            let tag = match &self.scene {
                SceneRuntime::Linear(scene) => scene
                    .queue
                    .as_ref()
                    .and_then(|queue| queue.current().cloned()),
                SceneRuntime::Investigation(inv) => inv
                    .pending_queue
                    .as_ref()
                    .and_then(|queue| queue.current().cloned()),
                SceneRuntime::Interrogation(scene) => scene
                    .pending_queue
                    .as_ref()
                    .and_then(|queue| queue.current().cloned()),
            };
            match tag {
                Some(DialogueItem::SceneTag { text, asset_cue }) => {
                    self.last_visual_cue.set_scene_tag(text, asset_cue);
                    let exhausted = match &mut self.scene {
                        SceneRuntime::Linear(scene) => scene
                            .queue
                            .as_mut()
                            .is_none_or(ActiveDialogueQueue::advance),
                        SceneRuntime::Investigation(inv) => inv
                            .pending_queue
                            .as_mut()
                            .is_none_or(|queue| queue.advance()),
                        SceneRuntime::Interrogation(scene) => scene
                            .pending_queue
                            .as_mut()
                            .is_none_or(|queue| queue.advance()),
                    };
                    if exhausted {
                        return true;
                    }
                }
                _ => return false,
            }
        }
    }

    /// Install `segments` as the active dialogue queue, or run the
    /// exhausted-queue machinery when there is nothing to play.
    pub(super) fn install_or_exhaust(
        &mut self,
        segments: Vec<DialogueSegment>,
    ) -> Result<(), GameError> {
        if segments.is_empty() {
            return self.on_queue_exhausted();
        }
        let queue_gen = self.alloc_queue_gen();
        self.install_scene_queue(segments, queue_gen, None)
    }

    /// As `install_or_exhaust`, then mark where challengeable testimony line
    /// content begins in the installed queue.
    ///
    /// The `line_content_start` override is passed into `install_scene_queue`
    /// so it is applied **before** `consume_scene_tags_at_cursor` runs. If the
    /// queue drains to empty (all items were `SceneTag`), `on_queue_exhausted`
    /// may install a new queue with its own boundary — applying the override
    /// after the install (as the previous code did) would clobber that new
    /// queue's boundary with the stale value from the drained one.
    pub(super) fn install_or_exhaust_line_content(
        &mut self,
        segments: Vec<DialogueSegment>,
        line_content_start: usize,
    ) -> Result<(), GameError> {
        if segments.is_empty() {
            return self.on_queue_exhausted();
        }
        let queue_gen = self.alloc_queue_gen();
        self.install_scene_queue(segments, queue_gen, Some(line_content_start))
    }

    /// Scene-entry sequencing lives in `navigation.rs` (`prime_initial_queue`),
    /// which calls into these primitives.
    ///
    /// `line_content_start_override` is applied to the interrogation scene's
    /// `line_content_start` **before** `consume_scene_tags_at_cursor` runs, so
    /// the correct challenge boundary is in place even if the queue immediately
    /// exhausts and `on_queue_exhausted` installs a successor queue. `None`
    /// uses the safe default (`items.len()` — nothing challengeable).
    pub(super) fn install_scene_queue(
        &mut self,
        segments: Vec<DialogueSegment>,
        queue_gen: u64,
        line_content_start_override: Option<usize>,
    ) -> Result<(), GameError> {
        let queue = ActiveDialogueQueue::new(segments, queue_gen)
            .ok_or_else(|| GameError::internal("empty dialogue queue installation".into()))?;
        match &mut self.scene {
            SceneRuntime::Investigation(inv) => {
                inv.pending_queue = Some(queue);
            }
            SceneRuntime::Linear(_) => {
                return Err(GameError::internal(
                    "dialogue queue installed outside queued scene".into(),
                ));
            }
            SceneRuntime::Interrogation(scene) => {
                // Default: nothing in this queue is challengeable testimony
                // line content. Testimony-line installers pass an override so
                // the inline 反駁 control only surfaces when the cursor is on
                // actual line content. Applied before tag consumption so a
                // draining queue does not leave a stale boundary for a
                // successor queue installed by `on_queue_exhausted`.
                scene.line_content_start =
                    line_content_start_override.unwrap_or_else(|| queue.queue_remaining() + 1);
                scene.pending_queue = Some(queue);
            }
        }
        let exhausted = self.consume_scene_tags_at_cursor();
        if exhausted {
            self.on_queue_exhausted()?;
        }
        Ok(())
    }

    pub(super) fn on_queue_exhausted(&mut self) -> Result<(), GameError> {
        if let SceneRuntime::Linear(scene) = &mut self.scene {
            scene.queue = None;
            self.advance_scene()?;
            return Ok(());
        }
        match &self.scene {
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
            SceneRuntime::Linear(_) => unreachable!("linear exhaustion returned above"),
        }
        Ok(())
    }

    /// Whether the current interrogation scene is playing a not-yet-broken
    /// testimony (see [`super::scenes::interrogation::InterrogationSceneState::is_playing_unbroken`]).
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
    ///
    /// A testimony line whose content is entirely `SceneTag` items carries no
    /// visible dialogue. Rather than withdrawing on the first such line (which
    /// would skip any visible lines that follow it), the tags are applied for
    /// visual continuity and the next line is advanced to in-place. Only when a
    /// complete testimony cycle (ending in `AdvanceOutcome::Loop`) contains no
    /// visible dialogue in its **lines** is the testimony degenerate and
    /// withdrawing appropriate.
    ///
    /// Degeneracy is determined from the testimony lines themselves, not from
    /// the composite `on_loop + loop_prompt + first line` bridge queue. A
    /// testimony whose lines are all `SceneTag` but whose bridge carries
    /// visible dialogue is still degenerate: the bridge drains, the tag-only
    /// line content is consumed silently, and `on_queue_exhausted` re-enters
    /// this function at the `Loop` path, which would re-install the same
    /// bridge indefinitely. Because `playing_unbroken_line_id` returns `None`
    /// while the bridge plays (the cursor sits before `line_content_start`),
    /// the UI exposes no challenge or withdraw control during the bridge, so
    /// the player cannot escape — a soft lock. Withdrawing instead of
    /// installing the bridge breaks the cycle.
    ///
    /// Iterating here — instead of recursing through `on_queue_exhausted` →
    /// `install_or_exhaust_line_content` → `install_scene_queue` — avoids the
    /// stack overflow an all-`SceneTag` testimony would otherwise cause,
    /// because `consume_scene_tags_at_cursor` eats every tag and re-enters
    /// `on_queue_exhausted` immediately.
    pub(super) fn advance_playing_testimony(&mut self) -> Result<(), GameError> {
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();
        loop {
            let (segments, line_content_start, is_loop, has_dialogue) = {
                let scene = match &mut self.scene {
                    SceneRuntime::Interrogation(scene) => scene,
                    _ => return Ok(()),
                };
                let CrossExam::Playing { question_id, .. } = scene.cross_exam().clone() else {
                    return Ok(());
                };
                let phase_id = scene.current_phase_id.clone().ok_or_else(|| {
                    GameError::internal("testimony advanced without a current phase".into())
                })?;
                let scene_id = scene.def.id.clone();
                match scene.advance_line() {
                    AdvanceOutcome::NextLine(index) => {
                        let line = scene
                            .question(&question_id)
                            .and_then(|question| question.testimony.lines.get(index))
                            .cloned();
                        let content = line
                            .as_ref()
                            .map(|line| line.content.clone())
                            .unwrap_or_default();
                        // Pure line content — challengeable from the first
                        // item. Degeneracy is per-line here: a tag-only
                        // intermediate line is skipped, not withdrawn from.
                        let has_dialogue = content
                            .iter()
                            .any(|item| !matches!(item, DialogueItem::SceneTag { .. }));
                        let segments = line
                            .and_then(|line| {
                                interrogation_segment(
                                    &chapter_id,
                                    &scene_id,
                                    &phase_id,
                                    format!("question:{question_id}:line:{}:content", line.id),
                                    line.content,
                                )
                            })
                            .into_iter()
                            .collect();
                        (segments, 0, false, has_dialogue)
                    }
                    AdvanceOutcome::Loop => {
                        let (segments, start, lines_have_dialogue) = scene
                            .question(&question_id)
                            .map_or(
                            Ok((Vec::new(), 0, false)),
                            |question| {
                                let mut segments = Vec::new();
                                segments.extend(interrogation_segment(
                                    &chapter_id,
                                    &scene_id,
                                    &phase_id,
                                    format!("question:{question_id}:onLoop"),
                                    question.testimony.on_loop.clone(),
                                ));
                                segments.extend(interrogation_segment(
                                    &chapter_id,
                                    &scene_id,
                                    &phase_id,
                                    format!("question:{question_id}:loopPrompt"),
                                    question.testimony.loop_prompt.clone(),
                                ));
                                let line_segment_index = segments.len();
                                if let Some(first) = question.testimony.lines.first() {
                                    segments.extend(interrogation_segment(
                                        &chapter_id,
                                        &scene_id,
                                        &phase_id,
                                        format!("question:{question_id}:line:{}:content", first.id),
                                        first.content.clone(),
                                    ));
                                }
                                // The on_loop + loop_prompt bridge plays first;
                                // line 0 content follows, so the challenge
                                // target only surfaces once the cursor reaches
                                // the line content.
                                //
                                // Degeneracy is decided by whether the testimony
                                // **lines** carry any visible dialogue — not by
                                // the composite bridge queue. A visible bridge
                                // with all-tag lines must still withdraw; see
                                // the doc comment above.
                                let lines_have_dialogue =
                                    question.testimony.lines.iter().any(|line| {
                                        line.content.iter().any(|item| {
                                            !matches!(item, DialogueItem::SceneTag { .. })
                                        })
                                    });
                                let start = ActiveDialogueQueue::flattened_segment_start(
                                    &segments,
                                    line_segment_index,
                                )?;
                                Ok((segments, start, lines_have_dialogue))
                            },
                        )?;
                        (segments, start, true, lines_have_dialogue)
                    }
                }
            };

            if has_dialogue {
                self.install_or_exhaust_line_content(segments, line_content_start)?;
                return Ok(());
            }

            // Tag-only (or empty) queue: apply its visual cues for continuity.
            // On the Loop path this includes any SceneTag items from the
            // bridge; visible bridge dialogue is intentionally not played
            // because the testimony is degenerate (no visible lines to loop
            // back to).
            for segment in &segments {
                for item in &segment.items {
                    if let DialogueItem::SceneTag { text, asset_cue } = item {
                        self.last_visual_cue
                            .set_scene_tag(text.clone(), asset_cue.clone());
                    }
                }
            }

            if is_loop {
                // A complete testimony cycle contained no visible dialogue in
                // its lines — the testimony is degenerate. Withdraw to the
                // menu rather than installing another loop bridge. Must not
                // use install_or_exhaust_line_content: on_queue_exhausted
                // dispatches back here while is_playing_unbroken() holds, and
                // an all-SceneTag queue would drain immediately inside
                // install_scene_queue (consume_scene_tags_at_cursor eats every
                // item), recurse, and eventually overflow the stack.
                if let SceneRuntime::Interrogation(scene) = &mut self.scene {
                    scene.withdraw();
                }
                if self.try_advance_interrogation()? {
                    self.advance_scene()?;
                }
                return Ok(());
            }

            // Tag-only intermediate line: advance to the next line and look for
            // visible dialogue there. The loop continues — advance_line will be
            // called again at the top.
        }
    }

    pub(super) fn alloc_queue_gen(&mut self) -> u64 {
        let g = self.next_queue_gen;
        self.next_queue_gen += 1;
        g
    }

    pub(super) fn current_queue_token(&self) -> Option<QueueToken> {
        match &self.scene {
            SceneRuntime::Linear(scene) => scene.queue.as_ref().and_then(|queue| {
                Some(QueueToken {
                    scene_id: scene.id.clone(),
                    queue_gen: queue.queue_gen(),
                    cursor: queue.flattened_cursor().ok()?,
                })
            }),
            SceneRuntime::Investigation(inv) => inv.pending_queue.as_ref().and_then(|queue| {
                Some(QueueToken {
                    scene_id: inv.def.id.clone(),
                    queue_gen: queue.queue_gen(),
                    cursor: queue.flattened_cursor().ok()?,
                })
            }),
            SceneRuntime::Interrogation(scene) => scene.pending_queue.as_ref().and_then(|queue| {
                Some(QueueToken {
                    scene_id: scene.def.id.clone(),
                    queue_gen: queue.queue_gen(),
                    cursor: queue.flattened_cursor().ok()?,
                })
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::dialogue;
    use crate::game::scenes::investigation::InvestigationSceneState;
    use crate::game::scenes::linear::LinearSceneState;
    use crate::game::schema::{
        DialogueItem, HotspotJson, InvestigationSceneJson, LockStatus, OutroJson, OutroUnlock,
        SceneType, SublocationJson,
    };
    use crate::game::state::{ChapterManifest, SceneRef};
    use crate::game::test_support::*;
    use crate::game::view::{DialogueHistoryEntry, ModeView, QueueToken};
    use crate::game::{GameEngine, Inventory, LastVisualCue, StoryCatalog};
    use std::path::PathBuf;

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

    fn assert_dialogue_frame(
        view: &crate::game::view::GameStateView,
        expected_text: &str,
        expected_token: QueueToken,
        expected_remaining: usize,
        expected_cross_exam_line_id: Option<&str>,
    ) {
        match &view.mode {
            ModeView::Dialogue {
                current,
                queue_remaining,
                queue_token,
                cross_exam_line_id,
                ..
            } => {
                let text = match current {
                    DialogueItem::Line { text, .. } | DialogueItem::Action { text } => text,
                    other => panic!("expected a visible dialogue item, got {other:?}"),
                };
                assert_eq!(text, expected_text);
                assert_eq!(queue_token, &expected_token);
                assert_eq!(*queue_remaining, expected_remaining);
                assert_eq!(cross_exam_line_id.as_deref(), expected_cross_exam_line_id);
            }
            other => panic!("expected dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn linear_public_dialogue_frames_keep_raw_flattened_cursor_and_history() {
        let resources = dialogue_history_fixture_resources(2);
        write_content_manifest(&resources);
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();

        assert_dialogue_frame(
            &engine.view(),
            "line 0",
            QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 1,
            },
            1,
            None,
        );
        assert_eq!(history_labels(&engine.view()), vec!["A: line 0"]);

        let next = engine.advance_dialogue(token_from(&engine.view())).unwrap();
        assert_dialogue_frame(
            &next,
            "action 1",
            QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 2,
            },
            0,
            None,
        );
        assert_eq!(
            history_labels(&next),
            vec!["A: line 0", "narration: action 1"]
        );

        let _ = std::fs::remove_dir_all(resources);
    }

    #[test]
    fn investigation_public_dialogue_frames_keep_raw_flattened_cursor_and_history() {
        let scene = investigation_scene_with_intro(
            "investigation_scene_1",
            vec![
                DialogueItem::SceneTag {
                    text: "rain".into(),
                    asset_cue: None,
                },
                line("intro"),
                DialogueItem::Action {
                    text: "follow-up".into(),
                },
            ],
        );
        let mut engine = empty_engine_with_scene(scene, 7);
        engine.prime_initial_queue().unwrap();
        engine.record_current_dialogue_history();

        assert_dialogue_frame(
            &engine.view(),
            "intro",
            QueueToken {
                scene_id: "investigation_scene_1".into(),
                queue_gen: 7,
                cursor: 1,
            },
            1,
            None,
        );
        assert_eq!(history_labels(&engine.view()), vec!["A: intro"]);

        let next = engine.advance_dialogue(token_from(&engine.view())).unwrap();
        assert_dialogue_frame(
            &next,
            "follow-up",
            QueueToken {
                scene_id: "investigation_scene_1".into(),
                queue_gen: 7,
                cursor: 2,
            },
            0,
            None,
        );
        assert_eq!(
            history_labels(&next),
            vec!["A: intro", "narration: follow-up"]
        );
    }

    #[test]
    fn interrogation_public_dialogue_frames_keep_generation_boundary_and_history() {
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 11);
        engine.prime_initial_queue().unwrap();

        let first = engine.ask_interrogation_question("alibi").unwrap();
        assert_dialogue_frame(
            &first,
            "我那天沒去。",
            QueueToken {
                scene_id: "interrogation_scene_1".into(),
                queue_gen: 12,
                cursor: 0,
            },
            0,
            Some("l_off"),
        );
        assert_eq!(history_labels(&first), vec!["suspect: 我那天沒去。"]);

        let second = engine.advance_dialogue(token_from(&first)).unwrap();
        assert_dialogue_frame(
            &second,
            "我從沒打掃過那裡。",
            QueueToken {
                scene_id: "interrogation_scene_1".into(),
                queue_gen: 13,
                cursor: 0,
            },
            0,
            Some("l_deny"),
        );
        assert_eq!(
            history_labels(&second),
            vec!["suspect: 我那天沒去。", "suspect: 我從沒打掃過那裡。"]
        );
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
    fn duplicate_final_linear_token_is_rejected_after_game_complete() {
        let d = dialogue_history_fixture_resources(1);
        let mut engine = GameEngine::new_started(d.clone()).unwrap();

        let first_scene_token = token_from(&engine.view());
        let second_scene = engine.advance_dialogue(first_scene_token).unwrap();
        let final_token = token_from(&second_scene);

        let completed = engine.advance_dialogue(final_token.clone()).unwrap();
        assert!(matches!(completed.mode, ModeView::GameComplete));
        let completed_chapter_idx = engine.current_chapter_idx;
        let completed_scene_idx = engine.current_scene_idx;
        let completed_history = history_labels(&completed);

        let error = engine
            .advance_dialogue(final_token)
            .expect_err("the exhausted final queue must not accept its former token");

        assert_eq!(error.code, "noActiveDialogue");
        assert_eq!(engine.current_chapter_idx, completed_chapter_idx);
        assert_eq!(engine.current_scene_idx, completed_scene_idx);
        let after_replay = engine.view();
        assert!(matches!(after_replay.mode, ModeView::GameComplete));
        assert_eq!(history_labels(&after_replay), completed_history);

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
            content_manifest: test_content_manifest(),
            story_catalog: StoryCatalog::empty(),
            story_state: crate::game::story::StoryState::default(),
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
            scene: SceneRuntime::Linear(LinearSceneState::from_json(scene_json, "chapter_1", 1)),
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            history: dialogue::DialogueHistory::default(),
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
            content_manifest: test_content_manifest(),
            story_catalog: StoryCatalog::empty(),
            story_state: crate::game::story::StoryState::default(),
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
            scene: SceneRuntime::Linear(LinearSceneState::from_json(scene_json, "chapter_1", 1)),
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            history: dialogue::DialogueHistory::default(),
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
    fn nonterminal_tag_only_linear_scene_primes_the_next_scene() {
        let d = dialogue_history_fixture_resources(0);
        let engine = GameEngine::new_started(d.clone()).unwrap();

        assert_eq!(engine.current_chapter_idx, 0);
        assert_eq!(engine.current_scene_idx, 1);
        let view = engine.view();
        assert!(matches!(
            view.mode,
            ModeView::Dialogue {
                current: DialogueItem::Line {
                    ref speaker,
                    ref text,
                    ..
                },
                ..
            } if speaker == "B" && text == "next scene"
        ));
        assert_eq!(
            engine
                .current_queue_token()
                .expect("the next scene must have an active queue")
                .scene_id,
            "scene_1"
        );

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn terminal_tag_only_linear_scene_has_no_replayable_queue() {
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
            content_manifest: test_content_manifest(),
            story_catalog: StoryCatalog::empty(),
            story_state: crate::game::story::StoryState::default(),
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
            scene: SceneRuntime::Linear(LinearSceneState::from_json(tag_only_json, "chapter_1", 1)),
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            history: dialogue::DialogueHistory::default(),
        };
        engine.prime_initial_queue().unwrap();

        // Scene was tag-only → advance_scene ran → past last chapter → GameComplete.
        assert!(matches!(engine.view().mode, ModeView::GameComplete));
        assert_eq!(engine.last_visual_cue.scene_tag, Some("吉祥寺街道".into()));
        assert!(
            engine.current_queue_token().is_none(),
            "priming must invalidate the exhausted terminal queue"
        );

        let completed_chapter_idx = engine.current_chapter_idx;
        let completed_scene_idx = engine.current_scene_idx;
        let error = engine
            .advance_dialogue(QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 0,
            })
            .expect_err("an exhausted tag-only queue must not accept a former token");
        assert_eq!(error.code, "noActiveDialogue");
        assert_eq!(engine.current_chapter_idx, completed_chapter_idx);
        assert_eq!(engine.current_scene_idx, completed_scene_idx);
        assert!(matches!(engine.view().mode, ModeView::GameComplete));
    }
}
