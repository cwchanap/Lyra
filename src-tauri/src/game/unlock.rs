// src-tauri/src/game/unlock.rs
use crate::game::schema::{Combinator, UnlockExpr};

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
        UnlockExpr::TopicDiscussed { character_id, topic_id, .. } => {
            ctx.topic_discussed(character_id, topic_id)
        }
        UnlockExpr::HotspotInvestigated { id, .. } => ctx.hotspot_investigated(id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{PredicateEvidenceCollected, PredicateHotspotInvestigated};

    struct TestState {
        evidence: Vec<String>,
        hotspots: Vec<String>,
    }
    impl UnlockContext for TestState {
        fn evidence_collected(&self, id: &str) -> bool { self.evidence.iter().any(|e| e == id) }
        fn statement_acquired(&self, _id: &str) -> bool { false }
        fn topic_discussed(&self, _c: &str, _t: &str) -> bool { false }
        fn hotspot_investigated(&self, id: &str) -> bool { self.hotspots.iter().any(|h| h == id) }
    }

    fn evidence(id: &str) -> UnlockExpr {
        UnlockExpr::EvidenceCollected { _predicate: PredicateEvidenceCollected::X, id: id.into() }
    }
    fn hotspot(id: &str) -> UnlockExpr {
        UnlockExpr::HotspotInvestigated { _predicate: PredicateHotspotInvestigated::X, id: id.into() }
    }

    #[test]
    fn evidence_collected_predicate_is_true_when_in_inventory() {
        let ctx = TestState { evidence: vec!["foo".into()], hotspots: vec![] };
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
        assert!(evaluate(&expr, &TestState { evidence: vec!["foo".into()], hotspots: vec!["x".into()] }));
        assert!(!evaluate(&expr, &TestState { evidence: vec!["foo".into()], hotspots: vec![] }));
    }

    #[test]
    fn or_combinator_requires_either_branch() {
        let expr = UnlockExpr::Combinator {
            op: Combinator::Or,
            left: Box::new(evidence("foo")),
            right: Box::new(hotspot("x")),
        };
        assert!(evaluate(&expr, &TestState { evidence: vec!["foo".into()], hotspots: vec![] }));
        assert!(evaluate(&expr, &TestState { evidence: vec![], hotspots: vec!["x".into()] }));
        assert!(!evaluate(&expr, &TestState { evidence: vec![], hotspots: vec![] }));
    }
}
