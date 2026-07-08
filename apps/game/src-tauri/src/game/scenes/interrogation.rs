use std::collections::HashSet;

use crate::game::scenes::investigation::DialogueQueue;
use crate::game::schema::{
    InquiryQuestionJson, InterrogationOutroUnlock, InterrogationPhaseJson, InterrogationSceneJson,
    InterrogationUnlockExpr, LockStatus, TestimonyLineJson,
};
use crate::game::state::Inventory;
use crate::game::unlock::{self, InterrogationUnlockContext};

/// Cross-examination sub-state for the currently active inquiry question.
///
/// This is deliberately separate from `current_phase_id`/`completed_phases`:
/// a phase can have many questions, and each question's testimony can be
/// stepped through, challenged, and either broken (via a correct evidence
/// present) or looped back to the top.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CrossExam {
    /// No question is being cross-examined; the player sees the question menu.
    Idle,
    /// Showing testimony line `line_index` of `question_id`, with press/present
    /// controls available.
    Playing {
        question_id: String,
        line_index: usize,
    },
    /// The evidence tray is open so the player can present evidence against
    /// `line_id` of `question_id`.
    Presenting {
        question_id: String,
        line_id: String,
    },
}

/// Result of advancing to the next testimony line via [`InterrogationSceneState::advance_line`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdvanceOutcome {
    /// Moved forward to the line at this index.
    NextLine(usize),
    /// Advanced past the last line; testimony looped back to line 0.
    Loop,
}

#[derive(Debug, Clone)]
pub struct InterrogationSceneState {
    pub def: InterrogationSceneJson,
    pub intro_played: bool,
    pub outro_played: bool,
    pub current_phase_id: Option<String>,
    pub pending_queue: Option<DialogueQueue>,
    pub intro_queue_gen: u64,
    pub cross_exam: CrossExam,
    pub broken_questions: HashSet<String>,
    pub completed_phases: HashSet<String>,
    pub unlocked_overrides: HashSet<String>,
    entered_phases: HashSet<String>,
    /// The queue cursor index from which the current `pending_queue` items are
    /// actual testimony line content (challengeable via the inline 反駁
    /// control). Items before this index are bridge/feedback dialogue
    /// (`on_loop`, `loop_prompt`, `on_wrong_evidence`, `wrong_reply`,
    /// challenge lead-in, etc.) that must not expose a challenge target.
    /// `install_scene_queue` resets this to `items.len()` (nothing
    /// challengeable) as a safe default; testimony-line installers override
    /// it to the correct start. `0` means every queue item is line content.
    pub line_content_start: usize,
}

impl InterrogationSceneState {
    pub fn from_json(def: InterrogationSceneJson, intro_queue_gen: u64) -> Self {
        let current_phase_id = def
            .phases
            .iter()
            .find(|phase| phase_required(phase) && phase_status(phase) == LockStatus::Unlocked)
            .or_else(|| {
                def.phases
                    .iter()
                    .find(|phase| phase_status(phase) == LockStatus::Unlocked)
            })
            .map(|phase| phase_id(phase).to_string());
        Self {
            def,
            intro_played: false,
            outro_played: false,
            current_phase_id,
            pending_queue: None,
            intro_queue_gen,
            cross_exam: CrossExam::Idle,
            broken_questions: HashSet::new(),
            completed_phases: HashSet::new(),
            unlocked_overrides: HashSet::new(),
            entered_phases: HashSet::new(),
            line_content_start: 0,
        }
    }

    pub fn id(&self) -> &str {
        &self.def.id
    }
    pub fn title(&self) -> &str {
        &self.def.title
    }

    pub fn current_phase_id(&self) -> Option<String> {
        self.current_phase_id.clone()
    }

    pub fn cross_exam(&self) -> &CrossExam {
        &self.cross_exam
    }

    /// True while any testimony line is being played (broken or not).
    pub fn is_playing(&self) -> bool {
        matches!(self.cross_exam, CrossExam::Playing { .. })
    }

    /// True while a not-yet-broken question is playing its testimony — the
    /// looping cross-examination that should keep flowing in the dialogue box.
    /// A broken (e.g. honest, auto-broken) question is excluded: its testimony
    /// has nothing left to challenge, so it must not loop forever.
    pub fn is_playing_unbroken(&self) -> bool {
        matches!(&self.cross_exam, CrossExam::Playing { question_id, .. }
            if !self.broken_questions.contains(question_id))
    }

    /// The id of the testimony line currently playing in a not-yet-broken
    /// cross-examination — the line the inline challenge button targets while
    /// the testimony plays in the dialogue box. `None` when idle, presenting,
    /// the question is already broken, or the active queue item is bridge/
    /// feedback dialogue rather than the testimony line itself (e.g.
    /// `on_loop`, `loop_prompt`, `on_wrong_evidence`, `wrong_reply`, or the
    /// challenge lead-in). The latter guard prevents the player from
    /// challenging a line that is not actually on screen.
    pub fn playing_unbroken_line_id(&self) -> Option<String> {
        let CrossExam::Playing {
            question_id,
            line_index,
        } = &self.cross_exam
        else {
            return None;
        };
        if self.broken_questions.contains(question_id) {
            return None;
        }
        // Only surface a challenge target when the active queue item is actual
        // testimony line content. `line_content_start` marks the first
        // challengeable index; a cursor before it means bridge/feedback
        // dialogue is still playing and the inline 反駁 control must stay
        // hidden so the player cannot challenge a line that isn't shown.
        let cursor = self.pending_queue.as_ref().map(|q| q.cursor).unwrap_or(0);
        if cursor < self.line_content_start {
            return None;
        }
        self.question(question_id)?
            .testimony
            .lines
            .get(*line_index)
            .map(|line| line.id.clone())
    }

    /// Looks up a question by id across all phases.
    pub fn question<'a>(&'a self, id: &str) -> Option<&'a InquiryQuestionJson> {
        self.def.phases.iter().find_map(|phase| {
            let InterrogationPhaseJson::Inquiry { questions, .. } = phase;
            questions.iter().find(|question| question.id == id)
        })
    }

    /// Looks up a question by id, but only within the current phase.
    /// Returns `None` if there is no current phase or the question belongs
    /// to a different (future or locked) phase. This is the lookup
    /// `ask_interrogation_question` must use: a question whose own unlock
    /// expression is satisfied but whose owning phase has not been entered
    /// must not be askable, or its reveals would fire before the phase's
    /// entry dialogue and the phase-completion accounting for it.
    pub fn current_phase_question<'a>(&'a self, id: &str) -> Option<&'a InquiryQuestionJson> {
        let current_id = self.current_phase_id.as_deref()?;
        let phase = self
            .def
            .phases
            .iter()
            .find(|phase| phase_id(phase) == current_id)?;
        let InterrogationPhaseJson::Inquiry { questions, .. } = phase;
        questions.iter().find(|question| question.id == id)
    }

    /// Looks up a testimony line by (question id, line id).
    pub fn line<'a>(&'a self, question_id: &str, line_id: &str) -> Option<&'a TestimonyLineJson> {
        self.question(question_id)?
            .testimony
            .lines
            .iter()
            .find(|line| line.id == line_id)
    }

    pub fn is_question_broken(&self, id: &str) -> bool {
        self.broken_questions.contains(id)
    }

    /// Begins cross-examining `question_id`, entering `Playing` at line 0.
    ///
    /// A question whose testimony has no line carrying a `contradiction`
    /// target can never be "broken" via an evidence present — there is
    /// nothing for the player to press. Rather than leaving such a question
    /// permanently unresolvable, it is treated as auto-broken the moment its
    /// cross-examination begins: this is the simplest rule consistent with
    /// `broken_questions` being the single source of truth `phase_complete`
    /// consults for "has this question been dealt with".
    pub fn begin_question(&mut self, question_id: &str) {
        self.cross_exam = CrossExam::Playing {
            question_id: question_id.to_string(),
            line_index: 0,
        };
        let has_contradiction = self.question(question_id).is_some_and(|question| {
            question
                .testimony
                .lines
                .iter()
                .any(|line| line.contradiction.is_some())
        });
        if !has_contradiction {
            self.broken_questions.insert(question_id.to_string());
        }
    }

    /// Advances to the next testimony line of the question currently being
    /// played. If already on the last line, loops back to line 0.
    ///
    /// No-op (returns `Loop` without changing state) if `cross_exam` is not
    /// `Playing`; callers are expected to only invoke this while playing.
    pub fn advance_line(&mut self) -> AdvanceOutcome {
        let CrossExam::Playing {
            question_id,
            line_index,
        } = &self.cross_exam
        else {
            return AdvanceOutcome::Loop;
        };
        let question_id = question_id.clone();
        let line_count = self
            .question(&question_id)
            .map(|question| question.testimony.lines.len())
            .unwrap_or(0);
        let next_index = line_index + 1;
        if next_index >= line_count {
            self.cross_exam = CrossExam::Playing {
                question_id,
                line_index: 0,
            };
            AdvanceOutcome::Loop
        } else {
            self.cross_exam = CrossExam::Playing {
                question_id,
                line_index: next_index,
            };
            AdvanceOutcome::NextLine(next_index)
        }
    }

    /// Opens the evidence tray against `line_id` of the question currently
    /// being played. No-op if `cross_exam` is not `Playing`.
    pub fn begin_present(&mut self, line_id: &str) {
        if let CrossExam::Playing { question_id, .. } = &self.cross_exam {
            self.cross_exam = CrossExam::Presenting {
                question_id: question_id.clone(),
                line_id: line_id.to_string(),
            };
        }
    }

    /// Marks `question_id` as broken (its contradiction has been proven) and
    /// returns to the question menu.
    pub fn record_break(&mut self, question_id: &str) {
        self.broken_questions.insert(question_id.to_string());
        self.cross_exam = CrossExam::Idle;
    }

    /// Returns from presenting evidence back to playing the same testimony
    /// line (used after a wrong present). No-op if `cross_exam` is not
    /// `Presenting`.
    pub fn return_to_line(&mut self) {
        if let CrossExam::Presenting {
            question_id,
            line_id,
        } = &self.cross_exam
        {
            let question_id = question_id.clone();
            let line_index = self
                .question(&question_id)
                .and_then(|question| {
                    question
                        .testimony
                        .lines
                        .iter()
                        .position(|line| &line.id == line_id)
                })
                .unwrap_or(0);
            self.cross_exam = CrossExam::Playing {
                question_id,
                line_index,
            };
        }
    }

    /// Abandons the current cross-examination and returns to the question menu.
    pub fn withdraw(&mut self) {
        self.cross_exam = CrossExam::Idle;
    }

    pub fn unlock_override(&mut self, key: &str) {
        self.unlocked_overrides.insert(key.into());
    }

    pub fn mark_phase_entered(&mut self, phase_id: &str) {
        self.entered_phases.insert(phase_id.into());
    }

    pub fn phase_entered(&self, phase_id: &str) -> bool {
        self.entered_phases.contains(phase_id)
    }

    pub fn refresh_phase_completion(&mut self, inventory: &Inventory) {
        let completed: Vec<String> = {
            let ctx = InterrogationSceneAndInventoryCtx {
                scene: self,
                inventory,
            };
            self.def
                .phases
                .iter()
                .filter(|phase| self.phase_complete(phase, &ctx))
                .map(|phase| phase_id(phase).to_string())
                .collect()
        };
        for id in completed {
            self.completed_phases.insert(id);
        }
        self.refresh_current_phase(inventory);
    }

    pub fn refresh_current_phase(&mut self, inventory: &Inventory) {
        let next = {
            let ctx = InterrogationSceneAndInventoryCtx {
                scene: self,
                inventory,
            };
            self.def
                .phases
                .iter()
                .find(|phase| {
                    phase_required(phase)
                        && self.is_phase_unlocked(phase, &ctx)
                        && !self.completed_phases.contains(phase_id(phase))
                })
                .or_else(|| {
                    self.def.phases.iter().find(|phase| {
                        self.is_phase_unlocked(phase, &ctx)
                            && !self.completed_phases.contains(phase_id(phase))
                    })
                })
                .map(|phase| phase_id(phase).to_string())
        };
        self.current_phase_id = next;
    }

    pub fn is_phase_unlocked(
        &self,
        phase: &InterrogationPhaseJson,
        ctx: &impl InterrogationUnlockContext,
    ) -> bool {
        self.is_block_unlocked(
            &format!("phase:{}", phase_id(phase)),
            phase_status(phase),
            phase_unlock(phase),
            ctx,
        )
    }

    pub fn is_question_unlocked(
        &self,
        question: &InquiryQuestionJson,
        ctx: &impl InterrogationUnlockContext,
    ) -> bool {
        self.is_block_unlocked(
            &format!("question:{}", question.id),
            question.status,
            question.unlock.as_ref(),
            ctx,
        )
    }

    pub fn phase_complete(
        &self,
        phase: &InterrogationPhaseJson,
        ctx: &impl InterrogationUnlockContext,
    ) -> bool {
        let id = phase_id(phase);
        if self.completed_phases.contains(id) {
            return true;
        }
        let InterrogationPhaseJson::Inquiry { complete, .. } = phase;
        match complete {
            // `Auto` phases never complete on their own — the player ends the
            // inquiry explicitly via `complete_current_phase` (gated on
            // `current_phase_can_complete`). Only an explicit `Complete:`
            // expression completes without a manual trigger.
            InterrogationOutroUnlock::Auto(_) => false,
            InterrogationOutroUnlock::Expr(expr) => unlock::evaluate_interrogation(expr, ctx),
        }
    }

    /// Whether the current phase can be manually completed: it exists, uses
    /// `Auto` completion, the player is at the question menu (`CrossExam::Idle`
    /// — not mid-cross-examination), and every REQUIRED question in the phase
    /// is broken. Optional questions never gate completion.
    pub fn current_phase_can_complete(&self) -> bool {
        if !matches!(self.cross_exam, CrossExam::Idle) {
            return false;
        }
        let Some(current_id) = self.current_phase_id.as_deref() else {
            return false;
        };
        let Some(phase) = self
            .def
            .phases
            .iter()
            .find(|phase| phase_id(phase) == current_id)
        else {
            return false;
        };
        let InterrogationPhaseJson::Inquiry {
            complete,
            questions,
            ..
        } = phase;
        if !matches!(complete, InterrogationOutroUnlock::Auto(_)) {
            return false;
        }
        questions
            .iter()
            .filter(|question| question.required)
            .all(|question| self.broken_questions.contains(&question.id))
    }

    /// Marks the current phase completed (manual completion). Returns the
    /// completed phase id, or `None` if there is no current phase. Callers are
    /// expected to gate on [`Self::current_phase_can_complete`] first.
    pub fn complete_current_phase(&mut self) -> Option<String> {
        let current_id = self.current_phase_id.clone()?;
        self.completed_phases.insert(current_id.clone());
        Some(current_id)
    }

    pub fn outro_satisfied(&self, ctx: &impl InterrogationUnlockContext) -> bool {
        match &self.def.outro.unlock {
            InterrogationOutroUnlock::Auto(_) => self
                .def
                .phases
                .iter()
                .filter(|phase| phase_required(phase))
                .all(|phase| self.completed_phases.contains(phase_id(phase))),
            InterrogationOutroUnlock::Expr(expr) => unlock::evaluate_interrogation(expr, ctx),
        }
    }

    fn is_block_unlocked(
        &self,
        key: &str,
        status: LockStatus,
        unlock: Option<&InterrogationUnlockExpr>,
        ctx: &impl InterrogationUnlockContext,
    ) -> bool {
        match status {
            LockStatus::Unlocked => true,
            LockStatus::Locked => {
                if self.unlocked_overrides.contains(key) {
                    return true;
                }
                unlock.is_some_and(|expr| unlock::evaluate_interrogation(expr, ctx))
            }
        }
    }
}

pub struct InterrogationSceneAndInventoryCtx<'a> {
    pub scene: &'a InterrogationSceneState,
    pub inventory: &'a Inventory,
}

impl InterrogationUnlockContext for InterrogationSceneAndInventoryCtx<'_> {
    fn evidence_collected(&self, id: &str) -> bool {
        self.inventory.has_evidence(id)
    }

    fn statement_acquired(&self, id: &str) -> bool {
        self.inventory.has_statement(id)
    }

    fn question_answered(&self, id: &str) -> bool {
        self.scene.is_question_broken(id)
    }

    fn phase_completed(&self, id: &str) -> bool {
        self.scene.completed_phases.contains(id)
    }
}

pub fn phase_id(phase: &InterrogationPhaseJson) -> &str {
    let InterrogationPhaseJson::Inquiry { id, .. } = phase;
    id
}

pub fn phase_label(phase: &InterrogationPhaseJson) -> &str {
    let InterrogationPhaseJson::Inquiry { label, .. } = phase;
    label
}

pub fn phase_required(phase: &InterrogationPhaseJson) -> bool {
    let InterrogationPhaseJson::Inquiry { required, .. } = phase;
    *required
}

pub fn phase_status(phase: &InterrogationPhaseJson) -> LockStatus {
    let InterrogationPhaseJson::Inquiry { status, .. } = phase;
    *status
}

pub fn phase_unlock(phase: &InterrogationPhaseJson) -> Option<&InterrogationUnlockExpr> {
    let InterrogationPhaseJson::Inquiry { unlock, .. } = phase;
    unlock.as_ref()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{
        AutoMarker, DialogueItem, InquiryQuestionJson, InterrogationOutroJson,
        InterrogationOutroUnlock, InterrogationPhaseJson, InterrogationSceneJson, InventoryTarget,
        LockStatus, SubjectJson, TestimonyJson, TestimonyLineJson,
    };
    use crate::game::state::Inventory;

    fn subject() -> SubjectJson {
        SubjectJson {
            id: "suspect".into(),
            name: "Suspect".into(),
            role: "Witness".into(),
            bio: "Quiet.".into(),
        }
    }

    fn outro() -> InterrogationOutroJson {
        InterrogationOutroJson {
            unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            dialogue: vec![],
        }
    }

    fn empty_testimony() -> TestimonyJson {
        TestimonyJson {
            on_loop: vec![],
            loop_prompt: vec![],
            default_challenge: vec![],
            default_wrong: vec![],
            wrong_reply: vec![],
            lines: vec![],
        }
    }

    fn one_question_inquiry_scene() -> InterrogationSceneJson {
        InterrogationSceneJson {
            id: "interrogation".into(),
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
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![InquiryQuestionJson {
                    id: "reason".into(),
                    label: "Reason".into(),
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![],
                    testimony: empty_testimony(),
                }],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: outro(),
        }
    }

    /// A single required phase (`press`) with one question (`alibi`) that has
    /// two testimony lines: `l_off` (no contradiction) and `l_deny`
    /// (contradiction `evidence:cleaning_log`, with non-empty
    /// challenge/on_correct/on_wrong_evidence dialogue).
    fn two_line_question_scene() -> InterrogationSceneJson {
        InterrogationSceneJson {
            id: "interrogation".into(),
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
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
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
                        loop_prompt: vec![],
                        default_challenge: vec![],
                        default_wrong: vec![],
                        wrong_reply: vec![],
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
            outro: outro(),
        }
    }

    fn inquiry_phase_with_status(id: &str, status: LockStatus) -> InterrogationPhaseJson {
        let mut scene = one_question_inquiry_scene();
        let InterrogationPhaseJson::Inquiry {
            label,
            subject,
            required,
            unlock,
            reveals,
            scene_tag,
            entry_dialogue,
            complete,
            questions,
            ..
        } = scene.phases.remove(0);
        InterrogationPhaseJson::Inquiry {
            id: id.into(),
            label,
            subject,
            required,
            status,
            unlock,
            reveals,
            scene_tag,
            flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
            entry_dialogue,
            complete,
            questions,
        }
    }

    fn optional_inquiry_phase(id: &str, status: LockStatus) -> InterrogationPhaseJson {
        let mut scene = one_question_inquiry_scene();
        let InterrogationPhaseJson::Inquiry {
            label,
            subject,
            unlock,
            reveals,
            scene_tag,
            entry_dialogue,
            complete,
            questions,
            ..
        } = scene.phases.remove(0);
        InterrogationPhaseJson::Inquiry {
            id: id.into(),
            label,
            subject,
            required: false,
            status,
            unlock,
            reveals,
            scene_tag,
            flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
            entry_dialogue,
            complete,
            questions,
        }
    }

    #[test]
    fn advance_past_last_line_loops() {
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
        scene.begin_question("alibi");
        assert_eq!(
            *scene.cross_exam(),
            CrossExam::Playing {
                question_id: "alibi".into(),
                line_index: 0
            }
        );
        assert!(matches!(scene.advance_line(), AdvanceOutcome::NextLine(1)));
        assert!(matches!(scene.advance_line(), AdvanceOutcome::Loop));
        assert_eq!(
            *scene.cross_exam(),
            CrossExam::Playing {
                question_id: "alibi".into(),
                line_index: 0
            }
        );
    }

    #[test]
    fn recording_break_marks_question_and_returns_to_menu() {
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
        scene.begin_question("alibi");
        scene.begin_present("l_deny");
        scene.record_break("alibi");
        assert!(scene.is_question_broken("alibi"));
        assert_eq!(*scene.cross_exam(), CrossExam::Idle);
    }

    #[test]
    fn wrong_present_returns_to_same_line() {
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
        scene.begin_question("alibi");
        scene.advance_line(); // now at line 1 (l_deny)
        scene.begin_present("l_deny");
        scene.return_to_line();
        assert_eq!(
            *scene.cross_exam(),
            CrossExam::Playing {
                question_id: "alibi".into(),
                line_index: 1
            }
        );
    }

    #[test]
    fn phase_completes_after_manual_completion() {
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
        scene.record_break("alibi");
        scene.refresh_phase_completion(&Inventory::default());
        // Auto phases do not complete on their own; only manual completion does.
        assert!(!scene.completed_phases.contains("press"));
        assert!(scene.current_phase_can_complete());
        scene.complete_current_phase();
        scene.refresh_phase_completion(&Inventory::default());
        assert!(scene.completed_phases.contains("press"));
    }

    #[test]
    fn inquiry_phase_completes_after_manual_completion() {
        let mut scene = InterrogationSceneState::from_json(one_question_inquiry_scene(), 1);
        assert_eq!(scene.current_phase_id().as_deref(), Some("inquiry"));
        scene.record_break("reason");
        scene.refresh_phase_completion(&Inventory::default());
        assert!(!scene.completed_phases.contains("inquiry"));
        assert!(scene.current_phase_can_complete());
        scene.complete_current_phase();
        scene.refresh_phase_completion(&Inventory::default());
        assert!(scene.completed_phases.contains("inquiry"));
    }

    #[test]
    fn interrogation_initial_phase_skips_locked_required_phase() {
        let mut def = one_question_inquiry_scene();
        def.phases = vec![
            inquiry_phase_with_status("locked_inquiry", LockStatus::Locked),
            inquiry_phase_with_status("unlocked_inquiry", LockStatus::Unlocked),
        ];

        let scene = InterrogationSceneState::from_json(def, 1);

        assert_eq!(
            scene.current_phase_id().as_deref(),
            Some("unlocked_inquiry")
        );
    }

    #[test]
    fn interrogation_initial_phase_is_none_when_all_required_phases_locked() {
        let mut def = one_question_inquiry_scene();
        def.phases = vec![
            inquiry_phase_with_status("first_locked_inquiry", LockStatus::Locked),
            inquiry_phase_with_status("second_locked_inquiry", LockStatus::Locked),
        ];

        let scene = InterrogationSceneState::from_json(def, 1);

        assert_eq!(scene.current_phase_id(), None);
    }

    #[test]
    fn inquiry_phase_does_not_auto_complete_when_required_question_is_locked() {
        // Phase has two required questions: one unlocked, one locked.
        // Breaking only the unlocked one should NOT complete the phase,
        // because the locked required question still needs to be dealt with.
        let def = InterrogationSceneJson {
            id: "interrogation".into(),
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
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![
                    InquiryQuestionJson {
                        id: "unlocked_q".into(),
                        label: "Unlocked".into(),
                        status: LockStatus::Unlocked,
                        required: true,
                        unlock: None,
                        reveals: vec![],
                        testimony: empty_testimony(),
                    },
                    InquiryQuestionJson {
                        id: "locked_q".into(),
                        label: "Locked".into(),
                        status: LockStatus::Locked,
                        required: true,
                        unlock: None,
                        reveals: vec![],
                        testimony: empty_testimony(),
                    },
                ],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: outro(),
        };
        let mut scene = InterrogationSceneState::from_json(def, 1);
        let inventory = Inventory::default();

        // Break only the unlocked question — phase should NOT complete.
        scene.record_break("unlocked_q");
        scene.refresh_phase_completion(&inventory);

        let ctx = InterrogationSceneAndInventoryCtx {
            scene: &scene,
            inventory: &inventory,
        };
        assert!(!scene.completed_phases.contains("inquiry"));
        assert!(!scene.phase_complete(&scene.def.phases[0], &ctx));
    }

    #[test]
    fn outro_not_satisfied_when_locked_required_phase_is_incomplete() {
        // Two required phases: one unlocked (completable), one locked.
        // Completing the unlocked phase should NOT satisfy the outro
        // because the locked required phase is still incomplete.
        let def = InterrogationSceneJson {
            id: "interrogation".into(),
            title: "Interrogation".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![
                InterrogationPhaseJson::Inquiry {
                    id: "unlocked_inquiry".into(),
                    label: "Unlocked Inquiry".into(),
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
                        testimony: empty_testimony(),
                    }],
                },
                inquiry_phase_with_status("locked_inquiry", LockStatus::Locked),
            ],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: outro(),
        };
        let mut scene = InterrogationSceneState::from_json(def, 1);
        let inventory = Inventory::default();

        // Break the unlocked phase's question and manually complete it.
        scene.record_break("q1");
        scene.refresh_phase_completion(&inventory);
        assert!(scene.current_phase_can_complete());
        scene.complete_current_phase();
        scene.refresh_phase_completion(&inventory);

        assert!(scene.completed_phases.contains("unlocked_inquiry"));

        let ctx = InterrogationSceneAndInventoryCtx {
            scene: &scene,
            inventory: &inventory,
        };
        // Outro should NOT be satisfied — locked required phase is still incomplete.
        assert!(!scene.outro_satisfied(&ctx));
    }

    #[test]
    fn optional_phase_becomes_current_when_no_required_phase_unlocked() {
        // One required (locked), one optional (unlocked).
        // The optional phase should become current since no required phase is available.
        let mut def = one_question_inquiry_scene();
        def.phases = vec![
            inquiry_phase_with_status("locked_required", LockStatus::Locked),
            optional_inquiry_phase("optional_unlocked", LockStatus::Unlocked),
        ];

        let scene = InterrogationSceneState::from_json(def, 1);

        assert_eq!(
            scene.current_phase_id().as_deref(),
            Some("optional_unlocked")
        );
    }

    #[test]
    fn optional_phase_does_not_take_priority_over_required() {
        // One required (unlocked), one optional (unlocked).
        // The required phase should be current, not the optional one.
        let mut def = one_question_inquiry_scene();
        def.phases = vec![
            optional_inquiry_phase("optional_first", LockStatus::Unlocked),
            inquiry_phase_with_status("required_second", LockStatus::Unlocked),
        ];

        let scene = InterrogationSceneState::from_json(def, 1);

        assert_eq!(scene.current_phase_id().as_deref(), Some("required_second"));
    }

    #[test]
    fn optional_phase_becomes_current_after_required_completed() {
        // One required (unlocked), one optional (unlocked, with a different question id).
        // After completing the required phase, the optional one should become current.
        let mut def = one_question_inquiry_scene();
        def.phases = vec![
            inquiry_phase_with_status("required_phase", LockStatus::Unlocked),
            InterrogationPhaseJson::Inquiry {
                id: "optional_phase".into(),
                label: "Optional".into(),
                subject: subject(),
                required: false,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![InquiryQuestionJson {
                    id: "opt_question".into(),
                    label: "Opt Q".into(),
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![],
                    testimony: empty_testimony(),
                }],
            },
        ];

        let mut scene = InterrogationSceneState::from_json(def, 1);
        let inventory = Inventory::default();

        // Initially the required phase is current.
        assert_eq!(scene.current_phase_id().as_deref(), Some("required_phase"));

        // Break then manually complete the required phase.
        scene.record_break("reason");
        scene.refresh_phase_completion(&inventory);
        assert!(scene.current_phase_can_complete());
        scene.complete_current_phase();
        scene.refresh_phase_completion(&inventory);
        assert!(scene.completed_phases.contains("required_phase"));

        // After completing required, the optional phase becomes current.
        assert_eq!(scene.current_phase_id().as_deref(), Some("optional_phase"));
    }

    #[test]
    fn scene_with_only_optional_phases_sets_current() {
        // All phases are optional and unlocked — one should still become current.
        let mut def = one_question_inquiry_scene();
        def.phases = vec![
            optional_inquiry_phase("opt_a", LockStatus::Unlocked),
            optional_inquiry_phase("opt_b", LockStatus::Unlocked),
        ];

        let scene = InterrogationSceneState::from_json(def, 1);

        assert_eq!(scene.current_phase_id().as_deref(), Some("opt_a"));
    }

    #[test]
    fn optional_phase_not_blocking_outro() {
        // One optional (unlocked), no required phases.
        // Outro should be satisfied immediately since no required phases exist.
        let mut def = one_question_inquiry_scene();
        def.phases = vec![optional_inquiry_phase("optional", LockStatus::Unlocked)];

        let scene = InterrogationSceneState::from_json(def, 1);
        let inventory = Inventory::default();
        let ctx = InterrogationSceneAndInventoryCtx {
            scene: &scene,
            inventory: &inventory,
        };

        assert!(scene.outro_satisfied(&ctx));
    }

    #[test]
    fn manual_complete_available_despite_unlocked_optional_follow_up() {
        // An inquiry with one required question whose answer unlocks an optional
        // follow-up. Breaking the required question makes the phase manually
        // completable — the unlocked optional follow-up does NOT block
        // completion — so the player may complete the phase without ever
        // engaging the follow-up.
        use crate::game::schema::{InterrogationUnlockExpr, PredicateQuestionAnswered};

        let def = InterrogationSceneJson {
            id: "interrogation".into(),
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
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![
                    InquiryQuestionJson {
                        id: "required_q".into(),
                        label: "Required".into(),
                        status: LockStatus::Unlocked,
                        required: true,
                        unlock: None,
                        reveals: vec![],
                        testimony: empty_testimony(),
                    },
                    InquiryQuestionJson {
                        id: "optional_followup".into(),
                        label: "Follow Up".into(),
                        status: LockStatus::Locked,
                        required: false,
                        // Unlocked once required_q is broken.
                        unlock: Some(InterrogationUnlockExpr::QuestionAnswered {
                            _predicate: PredicateQuestionAnswered::X,
                            id: "required_q".into(),
                        }),
                        reveals: vec![],
                        testimony: empty_testimony(),
                    },
                ],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: outro(),
        };

        let mut scene = InterrogationSceneState::from_json(def, 1);
        let inventory = Inventory::default();

        // Break the required question — this unlocks the optional follow-up.
        scene.record_break("required_q");
        scene.refresh_phase_completion(&inventory);

        // Auto phases never complete on their own.
        assert!(
            !scene.completed_phases.contains("inquiry"),
            "Auto phase must not complete without a manual trigger"
        );
        // ...but the phase is manually completable, even though the optional
        // follow-up is unlocked and unbroken — optional questions never gate.
        assert!(
            scene.current_phase_can_complete(),
            "unlocked optional follow-up must not block manual completion"
        );

        // Completing the phase works without ever breaking the follow-up.
        scene.complete_current_phase();
        scene.refresh_phase_completion(&inventory);
        assert!(scene.completed_phases.contains("inquiry"));
    }

    #[test]
    fn is_playing_reflects_cross_exam_state() {
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
        assert!(!scene.is_playing());
        scene.begin_question("alibi");
        assert!(scene.is_playing());
        scene.begin_present("l_deny");
        assert!(!scene.is_playing()); // Presenting is not "playing".
        scene.return_to_line();
        assert!(scene.is_playing());
        scene.withdraw();
        assert!(!scene.is_playing());
    }

    #[test]
    fn is_playing_unbroken_excludes_broken_questions() {
        // A question whose testimony has no contradiction is auto-broken on
        // begin_question, so is_playing_unbroken must be false even though
        // cross_exam is Playing.
        let mut scene = InterrogationSceneState::from_json(one_question_inquiry_scene(), 1);
        scene.begin_question("reason"); // empty testimony -> auto-broken
        assert!(scene.is_playing());
        assert!(!scene.is_playing_unbroken());

        // A question with a contradiction is not auto-broken.
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
        scene.begin_question("alibi");
        assert!(scene.is_playing_unbroken());
        scene.record_break("alibi");
        // record_break returns to Idle, so neither flag is true afterwards.
        assert!(!scene.is_playing());
        assert!(!scene.is_playing_unbroken());
    }

    #[test]
    fn playing_unbroken_line_id_tracks_current_line_and_clears_when_broken() {
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);

        // Idle -> None.
        assert!(scene.playing_unbroken_line_id().is_none());

        scene.begin_question("alibi");
        assert_eq!(scene.playing_unbroken_line_id().as_deref(), Some("l_off"));
        scene.advance_line(); // -> l_deny
        assert_eq!(scene.playing_unbroken_line_id().as_deref(), Some("l_deny"));

        // Presenting -> None (the line card is open, not playing).
        scene.begin_present("l_deny");
        assert!(scene.playing_unbroken_line_id().is_none());

        // After returning to the line, the id resolves again.
        scene.return_to_line();
        assert_eq!(scene.playing_unbroken_line_id().as_deref(), Some("l_deny"));

        // Breaking the question -> None even if cross_exam were Playing again,
        // because a broken question has nothing left to challenge.
        scene.record_break("alibi");
        assert!(scene.playing_unbroken_line_id().is_none());
    }

    #[test]
    fn playing_unbroken_line_id_is_none_for_auto_broken_question() {
        // begin_question on a no-contradiction question auto-breaks it, so
        // playing_unbroken_line_id must be None even though cross_exam is
        // Playing (the broken guard fires before the line lookup).
        let mut scene = InterrogationSceneState::from_json(one_question_inquiry_scene(), 1);
        scene.begin_question("reason");
        assert!(matches!(
            scene.cross_exam(),
            CrossExam::Playing { question_id, .. } if question_id == "reason"
        ));
        assert!(scene.playing_unbroken_line_id().is_none());
    }

    #[test]
    fn line_lookup_finds_existing_and_rejects_missing() {
        let scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
        assert!(scene.line("alibi", "l_deny").is_some());
        assert!(scene.line("alibi", "missing_line").is_none());
        assert!(scene.line("missing_question", "l_deny").is_none());
    }

    #[test]
    fn withdraw_returns_to_idle_from_playing_and_presenting() {
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);

        scene.begin_question("alibi");
        assert!(scene.is_playing());
        scene.withdraw();
        assert_eq!(*scene.cross_exam(), CrossExam::Idle);

        // Withdraw from the presenting arm also returns to Idle (it does not
        // resume the testimony — that is return_to_line's job).
        scene.begin_question("alibi");
        scene.begin_present("l_deny");
        assert!(matches!(scene.cross_exam(), CrossExam::Presenting { .. }));
        scene.withdraw();
        assert_eq!(*scene.cross_exam(), CrossExam::Idle);
    }

    #[test]
    fn advance_line_is_a_no_op_when_not_playing() {
        // advance_line documents a no-op (returns Loop without mutating state)
        // when cross_exam is not Playing. Callers gate on is_playing_unbroken,
        // but the method itself must remain safe to call from any state.
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
        assert_eq!(scene.advance_line(), AdvanceOutcome::Loop);
        assert_eq!(*scene.cross_exam(), CrossExam::Idle);

        // Also a no-op while Presenting (only Playing advances).
        scene.begin_question("alibi");
        scene.begin_present("l_deny");
        assert_eq!(scene.advance_line(), AdvanceOutcome::Loop);
        assert!(matches!(scene.cross_exam(), CrossExam::Presenting { .. }));
    }

    #[test]
    fn begin_present_is_a_no_op_when_not_playing() {
        // begin_present documents a no-op when cross_exam is not Playing.
        let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
        scene.begin_present("l_deny");
        assert_eq!(*scene.cross_exam(), CrossExam::Idle);

        // Also a no-op while already Presenting (only Playing transitions into
        // Presenting).
        scene.begin_question("alibi");
        scene.begin_present("l_deny");
        let first = scene.cross_exam().clone();
        scene.begin_present("l_off");
        assert_eq!(*scene.cross_exam(), first);
    }
}
