// src-tauri/src/game/unlock.rs
use crate::game::schema::{Combinator, InterrogationUnlockExpr, StoryUnlockExpr, UnlockExpr};

pub trait UnlockContext {
    fn evidence_collected(&self, id: &str) -> bool;
    fn statement_acquired(&self, id: &str) -> bool;
    fn topic_discussed(&self, character_id: &str, topic_id: &str) -> bool;
    fn hotspot_investigated(&self, id: &str) -> bool;
}

pub trait StoryUnlockContext {
    fn fact_asserted(&self, id: &str) -> bool;
    fn question_resolved(&self, id: &str) -> bool;
    fn objective_completed(&self, id: &str) -> bool;
    fn analysis_scene_completed(&self, chapter_id: &str, scene_id: &str) -> bool;
    fn analysis_board_completed(&self, chapter_id: &str, scene_id: &str, board_id: &str) -> bool;
    fn authorization_granted(&self, id: &str) -> bool;
}

pub fn evaluate(
    expr: &UnlockExpr,
    local: &dyn UnlockContext,
    story: &dyn StoryUnlockContext,
) -> bool {
    match expr {
        UnlockExpr::Combinator { op, left, right } => match op {
            Combinator::And => evaluate(left, local, story) && evaluate(right, local, story),
            Combinator::Or => evaluate(left, local, story) || evaluate(right, local, story),
        },
        UnlockExpr::AtLeast {
            count, conditions, ..
        } => evaluate_at_least(conditions, *count, |condition| {
            evaluate(condition, local, story)
        }),
        UnlockExpr::EvidenceCollected { id, .. } => local.evidence_collected(id),
        UnlockExpr::StatementAcquired { id, .. } => local.statement_acquired(id),
        UnlockExpr::TopicDiscussed {
            character_id,
            topic_id,
            ..
        } => local.topic_discussed(character_id, topic_id),
        UnlockExpr::HotspotInvestigated { id, .. } => local.hotspot_investigated(id),
        UnlockExpr::FactAsserted { id, .. } => story.fact_asserted(id),
        UnlockExpr::QuestionResolved { id, .. } => story.question_resolved(id),
        UnlockExpr::ObjectiveCompleted { id, .. } => story.objective_completed(id),
        UnlockExpr::AuthorizationGranted { id, .. } => story.authorization_granted(id),
        UnlockExpr::AnalysisSceneCompleted {
            chapter_id,
            scene_id,
            ..
        } => story.analysis_scene_completed(chapter_id, scene_id),
        UnlockExpr::AnalysisBoardCompleted {
            chapter_id,
            scene_id,
            board_id,
            ..
        } => story.analysis_board_completed(chapter_id, scene_id, board_id),
    }
}

/// Evaluates the deliberately story-only expression used by compiled analysis
/// boards. Keeping this separate from investigation/interrogation evaluation
/// makes it impossible for analysis resources to depend on local scene state.
pub fn evaluate_story(expr: &StoryUnlockExpr, story: &dyn StoryUnlockContext) -> bool {
    match expr {
        StoryUnlockExpr::Combinator { op, left, right } => match op {
            Combinator::And => evaluate_story(left, story) && evaluate_story(right, story),
            Combinator::Or => evaluate_story(left, story) || evaluate_story(right, story),
        },
        StoryUnlockExpr::AtLeast {
            count, conditions, ..
        } => evaluate_at_least(conditions, *count, |condition| {
            evaluate_story(condition, story)
        }),
        StoryUnlockExpr::FactAsserted { id, .. } => story.fact_asserted(id),
        StoryUnlockExpr::QuestionResolved { id, .. } => story.question_resolved(id),
        StoryUnlockExpr::ObjectiveCompleted { id, .. } => story.objective_completed(id),
        StoryUnlockExpr::AuthorizationGranted { id, .. } => story.authorization_granted(id),
        StoryUnlockExpr::AnalysisSceneCompleted {
            chapter_id,
            scene_id,
            ..
        } => story.analysis_scene_completed(chapter_id, scene_id),
        StoryUnlockExpr::AnalysisBoardCompleted {
            chapter_id,
            scene_id,
            board_id,
            ..
        } => story.analysis_board_completed(chapter_id, scene_id, board_id),
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
    local: &dyn InterrogationUnlockContext,
    story: &dyn StoryUnlockContext,
) -> bool {
    match expr {
        InterrogationUnlockExpr::Combinator { op, left, right } => match op {
            Combinator::And => {
                evaluate_interrogation(left, local, story)
                    && evaluate_interrogation(right, local, story)
            }
            Combinator::Or => {
                evaluate_interrogation(left, local, story)
                    || evaluate_interrogation(right, local, story)
            }
        },
        InterrogationUnlockExpr::AtLeast {
            count, conditions, ..
        } => evaluate_at_least(conditions, *count, |condition| {
            evaluate_interrogation(condition, local, story)
        }),
        InterrogationUnlockExpr::EvidenceCollected { id, .. } => local.evidence_collected(id),
        InterrogationUnlockExpr::StatementAcquired { id, .. } => local.statement_acquired(id),
        InterrogationUnlockExpr::QuestionAnswered { id, .. } => local.question_answered(id),
        InterrogationUnlockExpr::PhaseCompleted { id, .. } => local.phase_completed(id),
        InterrogationUnlockExpr::FactAsserted { id, .. } => story.fact_asserted(id),
        InterrogationUnlockExpr::QuestionResolved { id, .. } => story.question_resolved(id),
        InterrogationUnlockExpr::ObjectiveCompleted { id, .. } => story.objective_completed(id),
        InterrogationUnlockExpr::AuthorizationGranted { id, .. } => story.authorization_granted(id),
        InterrogationUnlockExpr::AnalysisSceneCompleted {
            chapter_id,
            scene_id,
            ..
        } => story.analysis_scene_completed(chapter_id, scene_id),
        InterrogationUnlockExpr::AnalysisBoardCompleted {
            chapter_id,
            scene_id,
            board_id,
            ..
        } => story.analysis_board_completed(chapter_id, scene_id, board_id),
    }
}

fn evaluate_at_least<T>(
    conditions: &[T],
    count: usize,
    evaluate_condition: impl Fn(&T) -> bool,
) -> bool {
    if count == 0 {
        return false;
    }

    let mut true_count = 0;
    for condition in conditions {
        if !evaluate_condition(condition) {
            continue;
        }
        true_count += 1;
        if true_count >= count {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{
        AtLeastOperator, PredicateAnalysisBoardCompleted, PredicateAnalysisSceneCompleted,
        PredicateEvidenceCollected, PredicateHotspotInvestigated, PredicatePhaseCompleted,
        PredicateQuestionAnswered, PredicateStatementAcquired,
    };
    use crate::game::story::StoryState;
    use serde::Deserialize;
    use std::collections::BTreeMap;

    const CASES: &str =
        include_str!("../../../../../packages/shared/fixtures/unlock-expression-semantics.json");

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct UnlockExpressionSemanticsFixture {
        schema_version: u32,
        cases: Vec<UnlockExpressionSemanticsCase>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct UnlockExpressionSemanticsCase {
        name: String,
        family: UnlockExpressionFamily,
        expression: serde_json::Value,
        truth: BTreeMap<String, bool>,
        expected: bool,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "lowercase")]
    enum UnlockExpressionFamily {
        Investigation,
        Interrogation,
    }

    struct FixtureContext {
        truth: BTreeMap<String, bool>,
    }

    impl FixtureContext {
        fn matches(&self, key: String) -> bool {
            self.truth.get(&key).copied().unwrap_or(false)
        }
    }

    impl UnlockContext for FixtureContext {
        fn evidence_collected(&self, id: &str) -> bool {
            self.matches(format!("evidence_collected:{id}"))
        }

        fn statement_acquired(&self, id: &str) -> bool {
            self.matches(format!("statement_acquired:{id}"))
        }

        fn topic_discussed(&self, character_id: &str, topic_id: &str) -> bool {
            self.matches(format!("topic_discussed:{character_id}@{topic_id}"))
        }

        fn hotspot_investigated(&self, id: &str) -> bool {
            self.matches(format!("hotspot_investigated:{id}"))
        }
    }

    impl InterrogationUnlockContext for FixtureContext {
        fn evidence_collected(&self, id: &str) -> bool {
            self.matches(format!("evidence_collected:{id}"))
        }

        fn statement_acquired(&self, id: &str) -> bool {
            self.matches(format!("statement_acquired:{id}"))
        }

        fn question_answered(&self, id: &str) -> bool {
            self.matches(format!("question_answered:{id}"))
        }

        fn phase_completed(&self, id: &str) -> bool {
            self.matches(format!("phase_completed:{id}"))
        }
    }

    impl StoryUnlockContext for FixtureContext {
        fn fact_asserted(&self, id: &str) -> bool {
            self.matches(format!("fact_asserted:{id}"))
        }

        fn question_resolved(&self, id: &str) -> bool {
            self.matches(format!("question_resolved:{id}"))
        }

        fn objective_completed(&self, id: &str) -> bool {
            self.matches(format!("objective_completed:{id}"))
        }

        fn analysis_scene_completed(&self, chapter_id: &str, scene_id: &str) -> bool {
            self.matches(format!("analysis_scene_completed:{chapter_id}@{scene_id}"))
        }

        fn analysis_board_completed(
            &self,
            chapter_id: &str,
            scene_id: &str,
            board_id: &str,
        ) -> bool {
            self.matches(format!(
                "analysis_board_completed:{chapter_id}@{scene_id}@{board_id}"
            ))
        }

        fn authorization_granted(&self, id: &str) -> bool {
            self.matches(format!("authorization_granted:{id}"))
        }
    }

    struct StopAfterFirstTrueContext;

    impl UnlockContext for StopAfterFirstTrueContext {
        fn evidence_collected(&self, id: &str) -> bool {
            match id {
                "present" => true,
                "must_not_evaluate" => panic!("threshold did not short-circuit"),
                _ => false,
            }
        }

        fn statement_acquired(&self, _id: &str) -> bool {
            false
        }

        fn topic_discussed(&self, _character_id: &str, _topic_id: &str) -> bool {
            false
        }

        fn hotspot_investigated(&self, _id: &str) -> bool {
            false
        }
    }

    impl InterrogationUnlockContext for StopAfterFirstTrueContext {
        fn evidence_collected(&self, id: &str) -> bool {
            UnlockContext::evidence_collected(self, id)
        }

        fn statement_acquired(&self, _id: &str) -> bool {
            false
        }

        fn question_answered(&self, _id: &str) -> bool {
            false
        }

        fn phase_completed(&self, _id: &str) -> bool {
            false
        }
    }

    impl StoryUnlockContext for StopAfterFirstTrueContext {
        fn fact_asserted(&self, _id: &str) -> bool {
            false
        }

        fn question_resolved(&self, _id: &str) -> bool {
            false
        }

        fn objective_completed(&self, _id: &str) -> bool {
            false
        }

        fn analysis_scene_completed(&self, _chapter_id: &str, _scene_id: &str) -> bool {
            false
        }

        fn analysis_board_completed(
            &self,
            _chapter_id: &str,
            _scene_id: &str,
            _board_id: &str,
        ) -> bool {
            false
        }

        fn authorization_granted(&self, _id: &str) -> bool {
            false
        }
    }

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
    fn unlock_expression_semantics_match_shared_v1_fixture() {
        let fixture: UnlockExpressionSemanticsFixture = serde_json::from_str(CASES).unwrap();
        assert_eq!(fixture.schema_version, 1);

        for case in fixture.cases {
            let UnlockExpressionSemanticsCase {
                name,
                family,
                expression,
                truth,
                expected,
            } = case;
            let ctx = FixtureContext { truth };
            let actual = match family {
                UnlockExpressionFamily::Investigation => {
                    let expression: UnlockExpr = serde_json::from_value(expression).unwrap();
                    evaluate(&expression, &ctx, &ctx)
                }
                UnlockExpressionFamily::Interrogation => {
                    let expression: InterrogationUnlockExpr =
                        serde_json::from_value(expression).unwrap();
                    evaluate_interrogation(&expression, &ctx, &ctx)
                }
            };
            assert_eq!(actual, expected, "fixture case {name}");
        }
    }

    // Break caught: evaluating every threshold child after the required true
    // count has already been reached can trigger a forbidden downstream read.
    #[test]
    fn at_least_short_circuits_after_reaching_its_true_count() {
        let investigation = UnlockExpr::AtLeast {
            _op: AtLeastOperator::AtLeast,
            count: 1,
            conditions: vec![evidence("present"), evidence("must_not_evaluate")],
        };
        let interrogation = InterrogationUnlockExpr::AtLeast {
            _op: AtLeastOperator::AtLeast,
            count: 1,
            conditions: vec![
                interrogation_evidence("present"),
                interrogation_evidence("must_not_evaluate"),
            ],
        };
        let ctx = StopAfterFirstTrueContext;

        assert!(evaluate(&investigation, &ctx, &ctx));
        assert!(evaluate_interrogation(&interrogation, &ctx, &ctx));
    }

    #[test]
    fn evidence_collected_predicate_is_true_when_in_inventory() {
        let ctx = TestState {
            evidence: vec!["foo".into()],
            hotspots: vec![],
        };
        let story = StoryState::default();
        assert!(evaluate(&evidence("foo"), &ctx, &story));
        assert!(!evaluate(&evidence("bar"), &ctx, &story));
    }

    #[test]
    fn and_combinator_requires_both_branches() {
        let expr = UnlockExpr::Combinator {
            op: Combinator::And,
            left: Box::new(evidence("foo")),
            right: Box::new(hotspot("x")),
        };
        let story = StoryState::default();
        assert!(evaluate(
            &expr,
            &TestState {
                evidence: vec!["foo".into()],
                hotspots: vec!["x".into()]
            },
            &story,
        ));
        assert!(!evaluate(
            &expr,
            &TestState {
                evidence: vec!["foo".into()],
                hotspots: vec![]
            },
            &story,
        ));
    }

    #[test]
    fn or_combinator_requires_either_branch() {
        let expr = UnlockExpr::Combinator {
            op: Combinator::Or,
            left: Box::new(evidence("foo")),
            right: Box::new(hotspot("x")),
        };
        let story = StoryState::default();
        assert!(evaluate(
            &expr,
            &TestState {
                evidence: vec!["foo".into()],
                hotspots: vec![]
            },
            &story,
        ));
        assert!(evaluate(
            &expr,
            &TestState {
                evidence: vec![],
                hotspots: vec!["x".into()]
            },
            &story,
        ));
        assert!(!evaluate(
            &expr,
            &TestState {
                evidence: vec![],
                hotspots: vec![]
            },
            &story,
        ));
    }

    // Break caught: HPA-259/HPA-260 have not supplied production analysis
    // completion state yet, so these predicates must remain unavailable even
    // though synthetic semantic-fixture contexts can exercise the wire shape.
    #[test]
    fn story_state_defers_analysis_predicates_until_analysis_runtime_exists() {
        let local_ctx = TestState {
            evidence: vec!["note".into()],
            hotspots: vec![],
        };
        let interrogation_ctx = interrogation_ctx(&["note"], &[], &[], &[]);
        let story = StoryState::default();
        let investigation_scene = UnlockExpr::AnalysisSceneCompleted {
            _predicate: PredicateAnalysisSceneCompleted::X,
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
        };
        let investigation_board = UnlockExpr::AnalysisBoardCompleted {
            _predicate: PredicateAnalysisBoardCompleted::X,
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
            board_id: "board_1".into(),
        };
        let interrogation_scene = InterrogationUnlockExpr::AnalysisSceneCompleted {
            _predicate: PredicateAnalysisSceneCompleted::X,
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
        };
        let interrogation_board = InterrogationUnlockExpr::AnalysisBoardCompleted {
            _predicate: PredicateAnalysisBoardCompleted::X,
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
            board_id: "board_1".into(),
        };

        assert!(!evaluate(&investigation_scene, &local_ctx, &story));
        assert!(!evaluate(&investigation_board, &local_ctx, &story));
        assert!(!evaluate_interrogation(
            &interrogation_scene,
            &interrogation_ctx,
            &story,
        ));
        assert!(!evaluate_interrogation(
            &interrogation_board,
            &interrogation_ctx,
            &story,
        ));
    }

    #[test]
    fn legacy_unlock_json_round_trips_without_shape_change() {
        let raw = r#"{"op":"and","left":{"predicate":"evidence_collected","id":"receipt"},"right":{"predicate":"hotspot_investigated","id":"desk"}}"#;
        let parsed: UnlockExpr = serde_json::from_str(raw).unwrap();
        assert_eq!(serde_json::to_string(&parsed).unwrap(), raw);
    }

    #[test]
    fn interrogation_question_and_phase_predicates_match_scene_state() {
        let expr = InterrogationUnlockExpr::Combinator {
            op: Combinator::And,
            left: Box::new(question("hidden_discarded_beans")),
            right: Box::new(phase("wakatsuki_inquiry")),
        };
        let story = StoryState::default();
        assert!(evaluate_interrogation(
            &expr,
            &interrogation_ctx(
                &[],
                &[],
                &["hidden_discarded_beans"],
                &["wakatsuki_inquiry"]
            ),
            &story,
        ));
        assert!(!evaluate_interrogation(
            &expr,
            &interrogation_ctx(&[], &[], &["hidden_discarded_beans"], &[]),
            &story,
        ));
    }

    #[test]
    fn interrogation_inventory_predicates_use_evidence_and_statement_only() {
        let expr = InterrogationUnlockExpr::Combinator {
            op: Combinator::Or,
            left: Box::new(interrogation_evidence("receipt")),
            right: Box::new(interrogation_statement("alibi")),
        };
        let story = StoryState::default();
        assert!(evaluate_interrogation(
            &expr,
            &interrogation_ctx(&["receipt"], &[], &[], &[]),
            &story,
        ));
        assert!(evaluate_interrogation(
            &expr,
            &interrogation_ctx(&[], &["alibi"], &[], &[]),
            &story,
        ));
        assert!(!evaluate_interrogation(
            &expr,
            &interrogation_ctx(&[], &[], &[], &[]),
            &story,
        ));
    }
}
