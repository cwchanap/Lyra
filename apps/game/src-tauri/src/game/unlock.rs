// src-tauri/src/game/unlock.rs
use crate::game::schema::{Combinator, InterrogationUnlockExpr, UnlockExpr};

pub trait UnlockContext {
    fn evidence_collected(&self, id: &str) -> bool;
    fn statement_acquired(&self, id: &str) -> bool;
    fn topic_discussed(&self, character_id: &str, topic_id: &str) -> bool;
    fn hotspot_investigated(&self, id: &str) -> bool;
}

pub fn evaluate(expr: &UnlockExpr, ctx: &dyn UnlockContext) -> bool {
    match expr {
        UnlockExpr::Combinator { op, left, right } => match op {
            Combinator::And => evaluate(left, ctx) && evaluate(right, ctx),
            Combinator::Or => evaluate(left, ctx) || evaluate(right, ctx),
        },
        UnlockExpr::EvidenceCollected { id, .. } => ctx.evidence_collected(id),
        UnlockExpr::StatementAcquired { id, .. } => ctx.statement_acquired(id),
        UnlockExpr::TopicDiscussed {
            character_id,
            topic_id,
            ..
        } => ctx.topic_discussed(character_id, topic_id),
        UnlockExpr::HotspotInvestigated { id, .. } => ctx.hotspot_investigated(id),
    }
}

pub trait InterrogationUnlockContext {
    fn evidence_collected(&self, id: &str) -> bool;
    fn statement_acquired(&self, id: &str) -> bool;
    fn question_answered(&self, id: &str) -> bool;
    fn phase_completed(&self, id: &str) -> bool;
}

pub fn evaluate_interrogation(
    expr: &InterrogationUnlockExpr,
    ctx: &dyn InterrogationUnlockContext,
) -> bool {
    match expr {
        InterrogationUnlockExpr::Combinator { op, left, right } => match op {
            Combinator::And => {
                evaluate_interrogation(left, ctx) && evaluate_interrogation(right, ctx)
            }
            Combinator::Or => {
                evaluate_interrogation(left, ctx) || evaluate_interrogation(right, ctx)
            }
        },
        InterrogationUnlockExpr::EvidenceCollected { id, .. } => ctx.evidence_collected(id),
        InterrogationUnlockExpr::StatementAcquired { id, .. } => ctx.statement_acquired(id),
        InterrogationUnlockExpr::QuestionAnswered { id, .. } => ctx.question_answered(id),
        InterrogationUnlockExpr::PhaseCompleted { id, .. } => ctx.phase_completed(id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{
        PredicateEvidenceCollected, PredicateHotspotInvestigated, PredicatePhaseCompleted,
        PredicateQuestionAnswered, PredicateStatementAcquired,
    };

    struct TestState {
        evidence: Vec<String>,
        hotspots: Vec<String>,
    }
    impl UnlockContext for TestState {
        fn evidence_collected(&self, id: &str) -> bool {
            self.evidence.iter().any(|e| e == id)
        }
        fn statement_acquired(&self, _id: &str) -> bool {
            false
        }
        fn topic_discussed(&self, _c: &str, _t: &str) -> bool {
            false
        }
        fn hotspot_investigated(&self, id: &str) -> bool {
            self.hotspots.iter().any(|h| h == id)
        }
    }

    fn evidence(id: &str) -> UnlockExpr {
        UnlockExpr::EvidenceCollected {
            _predicate: PredicateEvidenceCollected::X,
            id: id.into(),
        }
    }
    fn hotspot(id: &str) -> UnlockExpr {
        UnlockExpr::HotspotInvestigated {
            _predicate: PredicateHotspotInvestigated::X,
            id: id.into(),
        }
    }

    struct InterrogationTestState {
        evidence: Vec<String>,
        statements: Vec<String>,
        questions: Vec<String>,
        phases: Vec<String>,
    }

    impl InterrogationUnlockContext for InterrogationTestState {
        fn evidence_collected(&self, id: &str) -> bool {
            self.evidence.iter().any(|e| e == id)
        }
        fn statement_acquired(&self, id: &str) -> bool {
            self.statements.iter().any(|s| s == id)
        }
        fn question_answered(&self, id: &str) -> bool {
            self.questions.iter().any(|q| q == id)
        }
        fn phase_completed(&self, id: &str) -> bool {
            self.phases.iter().any(|p| p == id)
        }
    }

    fn interrogation_evidence(id: &str) -> InterrogationUnlockExpr {
        InterrogationUnlockExpr::EvidenceCollected {
            _predicate: PredicateEvidenceCollected::X,
            id: id.into(),
        }
    }

    fn interrogation_statement(id: &str) -> InterrogationUnlockExpr {
        InterrogationUnlockExpr::StatementAcquired {
            _predicate: PredicateStatementAcquired::X,
            id: id.into(),
        }
    }

    fn question(id: &str) -> InterrogationUnlockExpr {
        InterrogationUnlockExpr::QuestionAnswered {
            _predicate: PredicateQuestionAnswered::X,
            id: id.into(),
        }
    }

    fn phase(id: &str) -> InterrogationUnlockExpr {
        InterrogationUnlockExpr::PhaseCompleted {
            _predicate: PredicatePhaseCompleted::X,
            id: id.into(),
        }
    }

    fn interrogation_ctx(
        evidence: &[&str],
        statements: &[&str],
        questions: &[&str],
        phases: &[&str],
    ) -> InterrogationTestState {
        InterrogationTestState {
            evidence: evidence.iter().map(|s| s.to_string()).collect(),
            statements: statements.iter().map(|s| s.to_string()).collect(),
            questions: questions.iter().map(|s| s.to_string()).collect(),
            phases: phases.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn evidence_collected_predicate_is_true_when_in_inventory() {
        let ctx = TestState {
            evidence: vec!["foo".into()],
            hotspots: vec![],
        };
        assert!(evaluate(&evidence("foo"), &ctx));
        assert!(!evaluate(&evidence("bar"), &ctx));
    }

    #[test]
    fn and_combinator_requires_both_branches() {
        let expr = UnlockExpr::Combinator {
            op: Combinator::And,
            left: Box::new(evidence("foo")),
            right: Box::new(hotspot("x")),
        };
        assert!(evaluate(
            &expr,
            &TestState {
                evidence: vec!["foo".into()],
                hotspots: vec!["x".into()]
            }
        ));
        assert!(!evaluate(
            &expr,
            &TestState {
                evidence: vec!["foo".into()],
                hotspots: vec![]
            }
        ));
    }

    #[test]
    fn or_combinator_requires_either_branch() {
        let expr = UnlockExpr::Combinator {
            op: Combinator::Or,
            left: Box::new(evidence("foo")),
            right: Box::new(hotspot("x")),
        };
        assert!(evaluate(
            &expr,
            &TestState {
                evidence: vec!["foo".into()],
                hotspots: vec![]
            }
        ));
        assert!(evaluate(
            &expr,
            &TestState {
                evidence: vec![],
                hotspots: vec!["x".into()]
            }
        ));
        assert!(!evaluate(
            &expr,
            &TestState {
                evidence: vec![],
                hotspots: vec![]
            }
        ));
    }

    #[test]
    fn interrogation_question_and_phase_predicates_match_scene_state() {
        let expr = InterrogationUnlockExpr::Combinator {
            op: Combinator::And,
            left: Box::new(question("hidden_discarded_beans")),
            right: Box::new(phase("wakatsuki_inquiry")),
        };
        assert!(evaluate_interrogation(
            &expr,
            &interrogation_ctx(
                &[],
                &[],
                &["hidden_discarded_beans"],
                &["wakatsuki_inquiry"]
            ),
        ));
        assert!(!evaluate_interrogation(
            &expr,
            &interrogation_ctx(&[], &[], &["hidden_discarded_beans"], &[]),
        ));
    }

    #[test]
    fn interrogation_inventory_predicates_use_evidence_and_statement_only() {
        let expr = InterrogationUnlockExpr::Combinator {
            op: Combinator::Or,
            left: Box::new(interrogation_evidence("receipt")),
            right: Box::new(interrogation_statement("alibi")),
        };
        assert!(evaluate_interrogation(
            &expr,
            &interrogation_ctx(&["receipt"], &[], &[], &[]),
        ));
        assert!(evaluate_interrogation(
            &expr,
            &interrogation_ctx(&[], &["alibi"], &[], &[]),
        ));
        assert!(!evaluate_interrogation(
            &expr,
            &interrogation_ctx(&[], &[], &[], &[]),
        ));
    }
}
