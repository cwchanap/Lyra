use std::collections::HashSet;

use crate::game::scenes::investigation::DialogueQueue;
use crate::game::schema::{
    InquiryQuestionJson, InterrogationOutroUnlock, InterrogationPhaseJson, InterrogationSceneJson,
    InterrogationUnlockExpr, LockStatus,
};
use crate::game::state::Inventory;
use crate::game::unlock::{self, InterrogationUnlockContext};

#[derive(Debug, Clone)]
pub struct InterrogationSceneState {
    pub def: InterrogationSceneJson,
    pub intro_played: bool,
    pub outro_played: bool,
    pub current_phase_id: Option<String>,
    pub pending_queue: Option<DialogueQueue>,
    pub intro_queue_gen: u64,
    pub answered_questions: HashSet<String>,
    pub pressed_statements: HashSet<String>,
    pub completed_phases: HashSet<String>,
    pub unlocked_overrides: HashSet<String>,
    entered_phases: HashSet<String>,
}

impl InterrogationSceneState {
    pub fn from_json(def: InterrogationSceneJson, intro_queue_gen: u64) -> Self {
        let current_phase_id = def
            .phases
            .iter()
            .find(|phase| phase_required(phase) && phase_status(phase) == LockStatus::Unlocked)
            .map(|phase| phase_id(phase).to_string());
        Self {
            def,
            intro_played: false,
            outro_played: false,
            current_phase_id,
            pending_queue: None,
            intro_queue_gen,
            answered_questions: HashSet::new(),
            pressed_statements: HashSet::new(),
            completed_phases: HashSet::new(),
            unlocked_overrides: HashSet::new(),
            entered_phases: HashSet::new(),
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

    pub fn record_question_answered(&mut self, id: &str) {
        self.answered_questions.insert(id.into());
    }

    pub fn record_statement_pressed(&mut self, id: &str) {
        self.pressed_statements.insert(id.into());
    }

    pub fn record_wrong_present(&mut self, _statement_id: &str) {}

    pub fn record_correct_present(&mut self, phase_id: &str) {
        self.completed_phases.insert(phase_id.into());
        if self.current_phase_id.as_deref() == Some(phase_id) {
            self.current_phase_id = None;
        }
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
        match phase {
            InterrogationPhaseJson::Inquiry {
                complete,
                questions,
                ..
            } => match complete {
                InterrogationOutroUnlock::Auto(_) => questions
                    .iter()
                    .filter(|question| question.required)
                    .all(|question| self.answered_questions.contains(&question.id)),
                InterrogationOutroUnlock::Expr(expr) => unlock::evaluate_interrogation(expr, ctx),
            },
            InterrogationPhaseJson::Testimony { .. } => false,
        }
    }

    pub fn outro_satisfied(&self, ctx: &impl InterrogationUnlockContext) -> bool {
        match &self.def.outro.unlock {
            InterrogationOutroUnlock::Auto(_) => self
                .def
                .phases
                .iter()
                .filter(|phase| phase_required(phase) && self.is_phase_unlocked(phase, ctx))
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
        self.scene.answered_questions.contains(id)
    }

    fn phase_completed(&self, id: &str) -> bool {
        self.scene.completed_phases.contains(id)
    }
}

pub fn phase_id(phase: &InterrogationPhaseJson) -> &str {
    match phase {
        InterrogationPhaseJson::Inquiry { id, .. }
        | InterrogationPhaseJson::Testimony { id, .. } => id,
    }
}

pub fn phase_label(phase: &InterrogationPhaseJson) -> &str {
    match phase {
        InterrogationPhaseJson::Inquiry { label, .. }
        | InterrogationPhaseJson::Testimony { label, .. } => label,
    }
}

pub fn phase_required(phase: &InterrogationPhaseJson) -> bool {
    match phase {
        InterrogationPhaseJson::Inquiry { required, .. }
        | InterrogationPhaseJson::Testimony { required, .. } => *required,
    }
}

pub fn phase_status(phase: &InterrogationPhaseJson) -> LockStatus {
    match phase {
        InterrogationPhaseJson::Inquiry { status, .. }
        | InterrogationPhaseJson::Testimony { status, .. } => *status,
    }
}

pub fn phase_unlock(phase: &InterrogationPhaseJson) -> Option<&InterrogationUnlockExpr> {
    match phase {
        InterrogationPhaseJson::Inquiry { unlock, .. }
        | InterrogationPhaseJson::Testimony { unlock, .. } => unlock.as_ref(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{
        AutoMarker, DialogueItem, InterrogationOutroJson, InterrogationOutroUnlock,
        InterrogationPhaseJson, InterrogationSceneJson, InventoryTarget, LockStatus, SubjectJson,
        TestimonyResultJson, TestimonyStatementJson,
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

    fn one_question_inquiry_scene() -> InterrogationSceneJson {
        InterrogationSceneJson {
            id: "interrogation".into(),
            title: "Interrogation".into(),
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
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![crate::game::schema::InquiryQuestionJson {
                    id: "reason".into(),
                    label: "Reason".into(),
                    kind: crate::game::schema::InquiryQuestionKind::Question,
                    parent_question_id: None,
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![],
                    answer_dialogue: vec![DialogueItem::Action {
                        text: "asked".into(),
                    }],
                    on_reask: None,
                }],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: outro(),
        }
    }

    fn one_testimony_scene() -> InterrogationSceneJson {
        InterrogationSceneJson {
            id: "interrogation".into(),
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
                    id: "cleaning_button".into(),
                    label: "Cleaning button".into(),
                    content: "I never touched the machine.".into(),
                    contradiction: Some(InventoryTarget::Evidence {
                        id: "cleaning_log".into(),
                    }),
                    on_correct: Some("contradiction".into()),
                    on_wrong: Some("wrong".into()),
                    on_press: None,
                    on_present: None,
                    on_wrong_present: None,
                    reveals: vec![],
                }],
                results: vec![
                    TestimonyResultJson {
                        id: "contradiction".into(),
                        label: "Contradiction".into(),
                        reveals: vec![],
                        dialogue: vec![],
                    },
                    TestimonyResultJson {
                        id: "wrong".into(),
                        label: "Wrong".into(),
                        reveals: vec![],
                        dialogue: vec![],
                    },
                ],
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
        } = scene.phases.remove(0)
        else {
            panic!("expected inquiry phase");
        };
        InterrogationPhaseJson::Inquiry {
            id: id.into(),
            label,
            subject,
            required,
            status,
            unlock,
            reveals,
            scene_tag,
            entry_dialogue,
            complete,
            questions,
        }
    }

    #[test]
    fn inquiry_phase_completes_after_required_question_answered() {
        let mut scene = InterrogationSceneState::from_json(one_question_inquiry_scene(), 1);
        assert_eq!(scene.current_phase_id().as_deref(), Some("inquiry"));
        scene.record_question_answered("reason");
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
    fn testimony_wrong_present_does_not_complete_phase() {
        let mut scene = InterrogationSceneState::from_json(one_testimony_scene(), 1);
        scene.record_wrong_present("cleaning_button");
        assert!(!scene.completed_phases.contains("testimony"));
    }

    #[test]
    fn testimony_correct_present_completes_phase() {
        let mut scene = InterrogationSceneState::from_json(one_testimony_scene(), 1);
        scene.record_correct_present("testimony");
        assert!(scene.completed_phases.contains("testimony"));
    }

    #[test]
    fn inquiry_phase_does_not_auto_complete_when_required_question_is_locked() {
        // Phase has two required questions: one unlocked, one locked.
        // Answering only the unlocked one should NOT complete the phase,
        // because the locked required question still needs to be answered.
        let def = InterrogationSceneJson {
            id: "interrogation".into(),
            title: "Interrogation".into(),
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
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![
                    crate::game::schema::InquiryQuestionJson {
                        id: "unlocked_q".into(),
                        label: "Unlocked".into(),
                        kind: crate::game::schema::InquiryQuestionKind::Question,
                        parent_question_id: None,
                        status: LockStatus::Unlocked,
                        required: true,
                        unlock: None,
                        reveals: vec![],
                        answer_dialogue: vec![DialogueItem::Action {
                            text: "asked".into(),
                        }],
                        on_reask: None,
                    },
                    crate::game::schema::InquiryQuestionJson {
                        id: "locked_q".into(),
                        label: "Locked".into(),
                        kind: crate::game::schema::InquiryQuestionKind::Question,
                        parent_question_id: None,
                        status: LockStatus::Locked,
                        required: true,
                        unlock: None,
                        reveals: vec![],
                        answer_dialogue: vec![DialogueItem::Action {
                            text: "secret".into(),
                        }],
                        on_reask: None,
                    },
                ],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: outro(),
        };
        let mut scene = InterrogationSceneState::from_json(def, 1);
        let inventory = Inventory::default();

        // Answer only the unlocked question — phase should NOT complete.
        scene.record_question_answered("unlocked_q");
        scene.refresh_phase_completion(&inventory);

        let ctx = InterrogationSceneAndInventoryCtx {
            scene: &scene,
            inventory: &inventory,
        };
        assert!(!scene.completed_phases.contains("inquiry"));
        assert!(!scene.phase_complete(&scene.def.phases[0], &ctx));
    }
}
