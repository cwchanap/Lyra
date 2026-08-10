use super::catalog::{AnalysisBoardRef, AnalysisSceneRef, ObjectiveKind, StoryCatalog};
use super::state::{
    inventory_target_id, inventory_target_kind, AssertionOrigin, AuthorizationProgress,
    FactProgress, ObjectiveProgress, QuestionProgress, StoryState,
};
use crate::game::schema::InventoryTarget;
use crate::game::GameError;
use std::collections::BTreeSet;

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::game) enum MutationOutcome {
    Changed,
    Unchanged,
}

#[allow(dead_code)]
impl StoryState {
    pub(in crate::game) fn complete_analysis_board(
        &mut self,
        catalog: &StoryCatalog,
        chapter_id: &str,
        scene_id: &str,
        board_id: &str,
    ) -> Result<MutationOutcome, GameError> {
        if !catalog.has_analysis_board(chapter_id, scene_id, board_id) {
            return Err(GameError::unknown_analysis_board(board_id));
        }
        let changed = self.completed_analysis_boards.insert(AnalysisBoardRef {
            chapter_id: chapter_id.into(),
            scene_id: scene_id.into(),
            board_id: board_id.into(),
        });
        Ok(if changed {
            MutationOutcome::Changed
        } else {
            MutationOutcome::Unchanged
        })
    }

    pub(in crate::game) fn complete_analysis_scene(
        &mut self,
        catalog: &StoryCatalog,
        chapter_id: &str,
        scene_id: &str,
    ) -> Result<MutationOutcome, GameError> {
        if !catalog.has_analysis_scene(chapter_id, scene_id) {
            return Err(GameError::unknown_analysis_scene(chapter_id, scene_id));
        }
        let changed = self.completed_analysis_scenes.insert(AnalysisSceneRef {
            chapter_id: chapter_id.into(),
            scene_id: scene_id.into(),
        });
        Ok(if changed {
            MutationOutcome::Changed
        } else {
            MutationOutcome::Unchanged
        })
    }

    pub(in crate::game) fn assert_fact(
        &mut self,
        catalog: &StoryCatalog,
        fact_id: &str,
        origin: AssertionOrigin,
        supporting_records: &[InventoryTarget],
        supporting_fact_ids: &[String],
    ) -> Result<MutationOutcome, GameError> {
        if catalog.fact(fact_id).is_none() {
            return Err(GameError::unknown_story_fact(fact_id));
        }
        origin
            .derived_location()
            .map_err(GameError::invalid_assertion_origin)?;
        origin
            .ensure_origin_kind_is_persistable(catalog)
            .map_err(GameError::invalid_assertion_origin)?;

        let supporting_records = supporting_records.iter().cloned().collect::<BTreeSet<_>>();
        for target in &supporting_records {
            if !catalog.contains_inventory_target(target) {
                return Err(GameError::unknown_supporting_case_record(
                    inventory_target_kind(target),
                    inventory_target_id(target),
                ));
            }
        }

        let supporting_fact_ids = supporting_fact_ids.iter().cloned().collect::<BTreeSet<_>>();
        for supporting_fact_id in &supporting_fact_ids {
            if catalog.fact(supporting_fact_id).is_none() {
                return Err(GameError::invalid_supporting_fact(
                    supporting_fact_id,
                    "the definition does not exist",
                ));
            }
            if !self.facts.contains_key(supporting_fact_id) {
                return Err(GameError::invalid_supporting_fact(
                    supporting_fact_id,
                    "the fact has not been asserted",
                ));
            }
            if supporting_fact_id == fact_id {
                return Err(GameError::invalid_supporting_fact(
                    supporting_fact_id,
                    "a fact cannot support itself",
                ));
            }
            if super::state::support_chain_reaches(supporting_fact_id, fact_id, &self.facts) {
                return Err(GameError::invalid_supporting_fact(
                    supporting_fact_id,
                    "the supporting fact transitively depends on this fact",
                ));
            }
        }

        let mut candidate = self.facts.clone();
        match candidate.get_mut(fact_id) {
            Some(progress) => {
                progress.supporting_records.extend(supporting_records);
                progress.supporting_fact_ids.extend(supporting_fact_ids);
            }
            None => {
                candidate.insert(
                    fact_id.to_owned(),
                    FactProgress {
                        first_origin: origin,
                        supporting_records,
                        supporting_fact_ids,
                    },
                );
            }
        }

        if candidate == self.facts {
            Ok(MutationOutcome::Unchanged)
        } else {
            self.facts = candidate;
            Ok(MutationOutcome::Changed)
        }
    }

    pub(in crate::game) fn reveal_question(
        &mut self,
        catalog: &StoryCatalog,
        question_id: &str,
    ) -> Result<MutationOutcome, GameError> {
        if catalog.question(question_id).is_none() {
            return Err(GameError::unknown_story_question(question_id));
        }

        let mut candidate = self.questions.clone();
        candidate
            .entry(question_id.to_owned())
            .or_insert(QuestionProgress {
                resolved_by_fact_id: None,
            });
        if candidate == self.questions {
            Ok(MutationOutcome::Unchanged)
        } else {
            self.questions = candidate;
            Ok(MutationOutcome::Changed)
        }
    }

    pub(in crate::game) fn resolve_question(
        &mut self,
        catalog: &StoryCatalog,
        question_id: &str,
        fact_id: &str,
    ) -> Result<MutationOutcome, GameError> {
        let Some(definition) = catalog.question(question_id) else {
            return Err(GameError::unknown_story_question(question_id));
        };
        if catalog.fact(fact_id).is_none() {
            return Err(GameError::invalid_question_resolution_fact(
                fact_id,
                "the definition does not exist",
            ));
        }
        if !self.facts.contains_key(fact_id) {
            return Err(GameError::invalid_question_resolution_fact(
                fact_id,
                "the fact has not been asserted",
            ));
        }
        if !definition
            .resolved_by_fact_ids
            .iter()
            .any(|candidate| candidate == fact_id)
        {
            return Err(GameError::invalid_question_resolution_fact(
                fact_id,
                "the fact is not a resolver candidate for this question",
            ));
        }
        if let Some(current_fact_id) = self
            .questions
            .get(question_id)
            .and_then(|progress| progress.resolved_by_fact_id.as_deref())
        {
            if current_fact_id == fact_id {
                return Ok(MutationOutcome::Unchanged);
            }
            return Err(GameError::invalid_question_resolver_replacement(
                question_id,
                current_fact_id,
                fact_id,
            ));
        }

        let mut candidate = self.questions.clone();
        candidate.insert(
            question_id.to_owned(),
            QuestionProgress {
                resolved_by_fact_id: Some(fact_id.to_owned()),
            },
        );
        self.questions = candidate;
        Ok(MutationOutcome::Changed)
    }

    pub(in crate::game) fn reveal_objective(
        &mut self,
        catalog: &StoryCatalog,
        objective_id: &str,
    ) -> Result<MutationOutcome, GameError> {
        if catalog.objective(objective_id).is_none() {
            return Err(GameError::unknown_story_objective(objective_id));
        }

        let mut candidate = self.objectives.clone();
        candidate
            .entry(objective_id.to_owned())
            .or_insert(ObjectiveProgress { completed: false });
        if candidate == self.objectives {
            Ok(MutationOutcome::Unchanged)
        } else {
            self.objectives = candidate;
            Ok(MutationOutcome::Changed)
        }
    }

    pub(in crate::game) fn complete_objective(
        &mut self,
        catalog: &StoryCatalog,
        objective_id: &str,
    ) -> Result<MutationOutcome, GameError> {
        if catalog.objective(objective_id).is_none() {
            return Err(GameError::unknown_story_objective(objective_id));
        }

        let mut candidate_objectives = self.objectives.clone();
        candidate_objectives.insert(
            objective_id.to_owned(),
            ObjectiveProgress { completed: true },
        );
        let candidate_active = if self.active_primary_objective_id.as_deref() == Some(objective_id)
        {
            None
        } else {
            self.active_primary_objective_id.clone()
        };

        if candidate_objectives == self.objectives
            && candidate_active == self.active_primary_objective_id
        {
            Ok(MutationOutcome::Unchanged)
        } else {
            self.objectives = candidate_objectives;
            self.active_primary_objective_id = candidate_active;
            Ok(MutationOutcome::Changed)
        }
    }

    pub(in crate::game) fn set_primary_objective(
        &mut self,
        catalog: &StoryCatalog,
        complete_current: bool,
        next_objective_id: Option<&str>,
    ) -> Result<MutationOutcome, GameError> {
        if let Some(next_id) = next_objective_id {
            let Some(definition) = catalog.objective(next_id) else {
                return Err(GameError::unknown_story_objective(next_id));
            };
            if definition.kind != ObjectiveKind::Primary {
                return Err(GameError::invalid_primary_objective_transition(format!(
                    "objective '{next_id}' is secondary"
                )));
            }
            if self
                .objectives
                .get(next_id)
                .is_some_and(|progress| progress.completed)
            {
                return Err(GameError::invalid_primary_objective_transition(format!(
                    "objective '{next_id}' is already completed"
                )));
            }
        }

        let current_id = self.active_primary_objective_id.as_deref();
        if complete_current && current_id.is_some() && current_id == next_objective_id {
            return Err(GameError::invalid_primary_objective_transition(
                "the current objective cannot be completed and remain active",
            ));
        }

        let mut candidate_objectives = self.objectives.clone();
        if complete_current {
            if let Some(current_id) = current_id {
                let Some(current) = candidate_objectives.get_mut(current_id) else {
                    return Err(GameError::invalid_primary_objective_transition(format!(
                        "active objective '{current_id}' has not been revealed"
                    )));
                };
                current.completed = true;
            }
        }
        if let Some(next_id) = next_objective_id {
            candidate_objectives
                .entry(next_id.to_owned())
                .or_insert(ObjectiveProgress { completed: false });
        }
        let candidate_active = next_objective_id.map(str::to_owned);

        if candidate_objectives == self.objectives
            && candidate_active == self.active_primary_objective_id
        {
            Ok(MutationOutcome::Unchanged)
        } else {
            self.objectives = candidate_objectives;
            self.active_primary_objective_id = candidate_active;
            Ok(MutationOutcome::Changed)
        }
    }

    pub(in crate::game) fn grant_authorization(
        &mut self,
        catalog: &StoryCatalog,
        authorization_id: &str,
        origin: AssertionOrigin,
    ) -> Result<MutationOutcome, GameError> {
        if catalog.authorization(authorization_id).is_none() {
            return Err(GameError::unknown_story_authorization(authorization_id));
        }
        origin
            .derived_location()
            .map_err(GameError::invalid_assertion_origin)?;
        origin
            .ensure_origin_kind_is_persistable(catalog)
            .map_err(GameError::invalid_assertion_origin)?;

        let mut candidate = self.authorizations.clone();
        candidate
            .entry(authorization_id.to_owned())
            .or_insert(AuthorizationProgress {
                first_origin: origin,
            });
        if candidate == self.authorizations {
            Ok(MutationOutcome::Unchanged)
        } else {
            self.authorizations = candidate;
            Ok(MutationOutcome::Changed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::InventoryTarget;
    use crate::game::story::StoryEventBlockKind;
    fn catalog() -> StoryCatalog {
        crate::game::test_support::catalog_with_story_definitions_and_case_records_and_analysis(
            vec![
                serde_json::json!({"id":"fact_alpha","label":"Alpha","summary":"Alpha","details":"Alpha details","category":"timeline"}),
                serde_json::json!({"id":"fact_beta","label":"Beta","summary":"Beta","details":"Beta details","category":"motive"}),
                serde_json::json!({"id":"fact_gamma","label":"Gamma","summary":"Gamma","details":"Gamma details","category":"identity"}),
            ],
            vec![serde_json::json!({
                "id":"question_main",
                "label":"Main",
                "summary":"Main",
                "resolvedByFactIds":["fact_alpha","fact_beta"],
            })],
            vec![
                serde_json::json!({"id":"primary_a","label":"Primary A","summary":"A","kind":"primary","sortOrder":1}),
                serde_json::json!({"id":"primary_b","label":"Primary B","summary":"B","kind":"primary","sortOrder":2}),
                serde_json::json!({"id":"secondary_a","label":"Secondary A","summary":"S","kind":"secondary","sortOrder":3}),
            ],
            vec![serde_json::json!({
                "id":"authorization_a",
                "label":"Authorization A",
                "summary":"A",
                "grantingAuthority":"Police",
            })],
            vec![(
                "evidence_a",
                "chapter_1",
                "scene_1",
                crate::game::provenance::CaseRecordProvenance::default(),
            )],
            vec![(
                "statement_a",
                "chapter_1",
                "scene_1",
                crate::game::provenance::CaseRecordProvenance::default(),
            )],
            vec![("chapter_1", "analysis_scene_1")],
            vec![("chapter_1", "analysis_scene_1", "board_1")],
        )
    }

    fn analysis_catalog() -> StoryCatalog {
        crate::game::test_support::catalog_with_case_records_and_analysis(
            vec![],
            vec![],
            vec![("chapter_1", "analysis_scene_1")],
            vec![("chapter_1", "analysis_scene_1", "board_1")],
        )
    }

    fn scene_origin(chapter_id: &str, scene_id: &str, block_id: &str) -> AssertionOrigin {
        AssertionOrigin::SceneEvent {
            chapter_id: chapter_id.into(),
            scene_id: scene_id.into(),
            block_kind: StoryEventBlockKind::Hotspot,
            block_id: block_id.into(),
        }
    }

    #[test]
    fn fact_assertion_unions_direct_support_and_preserves_first_origin() {
        let catalog = catalog();
        let mut state = StoryState::default();
        let first_origin = scene_origin("chapter_1", "scene_1", "event_1");

        assert_eq!(
            state
                .assert_fact(
                    &catalog,
                    "fact_beta",
                    scene_origin("chapter_1", "scene_1", "event_beta"),
                    &[],
                    &[],
                )
                .unwrap(),
            MutationOutcome::Changed
        );
        assert_eq!(
            state
                .assert_fact(
                    &catalog,
                    "fact_alpha",
                    first_origin.clone(),
                    &[InventoryTarget::Evidence {
                        id: "evidence_a".into(),
                    }],
                    &["fact_beta".into()],
                )
                .unwrap(),
            MutationOutcome::Changed
        );
        assert_eq!(
            state
                .assert_fact(
                    &catalog,
                    "fact_alpha",
                    scene_origin("chapter_2", "scene_2", "board_1"),
                    &[InventoryTarget::Statement {
                        id: "statement_a".into(),
                    }],
                    &["fact_beta".into()],
                )
                .unwrap(),
            MutationOutcome::Changed
        );

        let progress = &state.snapshot().facts["fact_alpha"];
        assert_eq!(progress.first_origin, first_origin);
        assert_eq!(
            progress.supporting_records,
            [
                InventoryTarget::Evidence {
                    id: "evidence_a".into()
                },
                InventoryTarget::Statement {
                    id: "statement_a".into()
                }
            ]
            .into_iter()
            .collect()
        );
        assert_eq!(
            progress.supporting_fact_ids,
            ["fact_beta".into()].into_iter().collect()
        );

        let before = state.snapshot();
        assert_eq!(
            state
                .assert_fact(
                    &catalog,
                    "fact_alpha",
                    scene_origin("chapter_9", "scene_9", "event_9"),
                    &[InventoryTarget::Evidence {
                        id: "evidence_a".into(),
                    }],
                    &["fact_beta".into()],
                )
                .unwrap(),
            MutationOutcome::Unchanged
        );
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn fact_assertion_validates_every_definition_support_and_origin_before_write() {
        let catalog = catalog();
        let mut state = StoryState::default();

        let before = state.snapshot();
        let error = state
            .assert_fact(
                &catalog,
                "missing",
                scene_origin("chapter_1", "scene_1", "event_1"),
                &[],
                &[],
            )
            .unwrap_err();
        assert_eq!(error.code, "unknownStoryFact");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .assert_fact(
                &catalog,
                "fact_alpha",
                scene_origin("chapter_1", "scene_1", "event_1"),
                &[
                    InventoryTarget::Evidence {
                        id: "evidence_a".into(),
                    },
                    InventoryTarget::Evidence {
                        id: "missing".into(),
                    },
                ],
                &[],
            )
            .unwrap_err();
        assert_eq!(error.code, "unknownSupportingCaseRecord");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .assert_fact(
                &catalog,
                "fact_alpha",
                scene_origin("chapter_1", "scene_1", "event_1"),
                &[InventoryTarget::Evidence {
                    id: "statement_a".into(),
                }],
                &[],
            )
            .unwrap_err();
        assert_eq!(error.code, "unknownSupportingCaseRecord");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .assert_fact(
                &catalog,
                "fact_alpha",
                scene_origin("chapter_1", "scene_1", "event_1"),
                &[],
                &["missing".into()],
            )
            .unwrap_err();
        assert_eq!(error.code, "invalidSupportingFact");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .assert_fact(
                &catalog,
                "fact_alpha",
                scene_origin("chapter_1", "scene_1", "event_1"),
                &[],
                &["fact_beta".into()],
            )
            .unwrap_err();
        assert_eq!(error.code, "invalidSupportingFact");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .assert_fact(
                &catalog,
                "fact_alpha",
                scene_origin("bad-chapter", "scene_1", "event_1"),
                &[],
                &[],
            )
            .unwrap_err();
        assert_eq!(error.code, "invalidAssertionOrigin");
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn fact_assertion_rejects_self_support_and_transitive_support_cycles() {
        let catalog = catalog();
        let mut state = StoryState::default();

        // fact_alpha is asserted on its own, then fact_beta is asserted with
        // fact_alpha as a supporter, so the live graph is fact_beta -> fact_alpha.
        state
            .assert_fact(
                &catalog,
                "fact_alpha",
                scene_origin("chapter_1", "scene_1", "event_1"),
                &[],
                &[],
            )
            .unwrap();
        state
            .assert_fact(
                &catalog,
                "fact_beta",
                scene_origin("chapter_1", "scene_1", "event_2"),
                &[],
                &["fact_alpha".into()],
            )
            .unwrap();

        // Self-support on re-assertion: fact_alpha is already asserted, so the
        // "has not been asserted" guard would otherwise let it support itself.
        let before = state.snapshot();
        let error = state
            .assert_fact(
                &catalog,
                "fact_alpha",
                scene_origin("chapter_1", "scene_1", "event_3"),
                &[],
                &["fact_alpha".into()],
            )
            .unwrap_err();
        assert_eq!(error.code, "invalidSupportingFact");
        assert_eq!(state.snapshot(), before);

        // Transitive cycle: fact_alpha -> fact_beta -> fact_alpha. Adding
        // fact_beta as a supporter of fact_alpha must be rejected because
        // fact_beta already depends on fact_alpha.
        let before = state.snapshot();
        let error = state
            .assert_fact(
                &catalog,
                "fact_alpha",
                scene_origin("chapter_1", "scene_1", "event_4"),
                &[],
                &["fact_beta".into()],
            )
            .unwrap_err();
        assert_eq!(error.code, "invalidSupportingFact");
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn question_reveal_resolution_and_monotonic_repeats() {
        let catalog = catalog();
        let mut state = StoryState::default();

        assert_eq!(
            state.reveal_question(&catalog, "question_main").unwrap(),
            MutationOutcome::Changed
        );
        assert_eq!(
            state.reveal_question(&catalog, "question_main").unwrap(),
            MutationOutcome::Unchanged
        );
        assert_eq!(
            state.snapshot().questions["question_main"].resolved_by_fact_id,
            None
        );

        state
            .assert_fact(
                &catalog,
                "fact_alpha",
                scene_origin("chapter_1", "scene_1", "event_1"),
                &[],
                &[],
            )
            .unwrap();
        assert_eq!(
            state
                .resolve_question(&catalog, "question_main", "fact_alpha")
                .unwrap(),
            MutationOutcome::Changed
        );
        let before = state.snapshot();
        assert_eq!(
            state
                .resolve_question(&catalog, "question_main", "fact_alpha")
                .unwrap(),
            MutationOutcome::Unchanged
        );
        assert_eq!(state.snapshot(), before);

        state
            .assert_fact(
                &catalog,
                "fact_beta",
                scene_origin("chapter_1", "scene_1", "event_2"),
                &[],
                &[],
            )
            .unwrap();
        let before = state.snapshot();
        let error = state
            .resolve_question(&catalog, "question_main", "fact_beta")
            .unwrap_err();
        assert_eq!(error.code, "invalidQuestionResolverReplacement");
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn resolve_question_reveals_question_without_prior_reveal_question() {
        // Design §8.2: "Resolution also reveals the question." resolve_question
        // must insert the question progress entry on a fresh state without a
        // prior reveal_question call.
        let catalog = catalog();
        let mut state = StoryState::default();

        state
            .assert_fact(
                &catalog,
                "fact_alpha",
                scene_origin("chapter_1", "scene_1", "event_1"),
                &[],
                &[],
            )
            .unwrap();

        let before = state.snapshot();
        assert_eq!(
            state
                .resolve_question(&catalog, "question_main", "fact_alpha")
                .unwrap(),
            MutationOutcome::Changed
        );
        let snapshot = state.snapshot();
        assert!(snapshot.questions.contains_key("question_main"));
        assert_eq!(
            snapshot.questions["question_main"]
                .resolved_by_fact_id
                .as_deref(),
            Some("fact_alpha")
        );

        // Repeating resolve_question with the same fact is Unchanged, matching
        // the monotonic behavior exercised by the combined reveal-then-resolve
        // test.
        let before_repeat = state.snapshot();
        assert_eq!(
            state
                .resolve_question(&catalog, "question_main", "fact_alpha")
                .unwrap(),
            MutationOutcome::Unchanged
        );
        assert_eq!(state.snapshot(), before_repeat);

        // Guard: ensure the test actually mutated state from `before`.
        assert_ne!(before.questions, snapshot.questions);
    }

    #[test]
    fn question_mutations_validate_all_definition_and_resolver_inputs_before_write() {
        let catalog = catalog();
        let mut state = StoryState::default();

        let before = state.snapshot();
        let error = state.reveal_question(&catalog, "missing").unwrap_err();
        assert_eq!(error.code, "unknownStoryQuestion");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .resolve_question(&catalog, "missing", "fact_alpha")
            .unwrap_err();
        assert_eq!(error.code, "unknownStoryQuestion");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .resolve_question(&catalog, "question_main", "missing")
            .unwrap_err();
        assert_eq!(error.code, "invalidQuestionResolutionFact");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .resolve_question(&catalog, "question_main", "fact_alpha")
            .unwrap_err();
        assert_eq!(error.code, "invalidQuestionResolutionFact");
        assert_eq!(state.snapshot(), before);

        state
            .assert_fact(
                &catalog,
                "fact_gamma",
                scene_origin("chapter_1", "scene_1", "event_3"),
                &[],
                &[],
            )
            .unwrap();
        let before = state.snapshot();
        let error = state
            .resolve_question(&catalog, "question_main", "fact_gamma")
            .unwrap_err();
        assert_eq!(error.code, "invalidQuestionResolutionFact");
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn objective_reveal_and_completion_are_monotonic_and_completion_clears_active() {
        let catalog = catalog();
        let mut state = StoryState::default();

        assert_eq!(
            state.reveal_objective(&catalog, "secondary_a").unwrap(),
            MutationOutcome::Changed
        );
        assert_eq!(
            state.reveal_objective(&catalog, "secondary_a").unwrap(),
            MutationOutcome::Unchanged
        );
        assert_eq!(
            state.complete_objective(&catalog, "secondary_a").unwrap(),
            MutationOutcome::Changed
        );
        assert_eq!(
            state.complete_objective(&catalog, "secondary_a").unwrap(),
            MutationOutcome::Unchanged
        );

        state
            .set_primary_objective(&catalog, false, Some("primary_a"))
            .unwrap();
        assert_eq!(
            state.complete_objective(&catalog, "primary_a").unwrap(),
            MutationOutcome::Changed
        );
        let snapshot = state.snapshot();
        assert!(snapshot.objectives["primary_a"].completed);
        assert_eq!(snapshot.active_primary_objective_id, None);

        let before = state.snapshot();
        let error = state.reveal_objective(&catalog, "missing").unwrap_err();
        assert_eq!(error.code, "unknownStoryObjective");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state.complete_objective(&catalog, "missing").unwrap_err();
        assert_eq!(error.code, "unknownStoryObjective");
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn primary_objective_transition_table_is_exact() {
        let catalog = catalog();

        for complete_current in [false, true] {
            let mut state = StoryState::default();
            assert_eq!(
                state
                    .set_primary_objective(&catalog, complete_current, None)
                    .unwrap(),
                MutationOutcome::Unchanged
            );
            assert_eq!(state.snapshot(), StoryState::default().snapshot());
        }

        for complete_current in [false, true] {
            let mut state = StoryState::default();
            assert_eq!(
                state
                    .set_primary_objective(&catalog, complete_current, Some("primary_b"))
                    .unwrap(),
                MutationOutcome::Changed
            );
            let snapshot = state.snapshot();
            assert_eq!(
                snapshot.active_primary_objective_id.as_deref(),
                Some("primary_b")
            );
            assert!(!snapshot.objectives["primary_b"].completed);
        }

        let mut state = StoryState::default();
        state
            .set_primary_objective(&catalog, false, Some("primary_a"))
            .unwrap();
        assert_eq!(
            state.set_primary_objective(&catalog, false, None).unwrap(),
            MutationOutcome::Changed
        );
        let snapshot = state.snapshot();
        assert_eq!(snapshot.active_primary_objective_id, None);
        assert!(!snapshot.objectives["primary_a"].completed);

        let mut state = StoryState::default();
        state
            .set_primary_objective(&catalog, false, Some("primary_a"))
            .unwrap();
        assert_eq!(
            state.set_primary_objective(&catalog, true, None).unwrap(),
            MutationOutcome::Changed
        );
        let snapshot = state.snapshot();
        assert_eq!(snapshot.active_primary_objective_id, None);
        assert!(snapshot.objectives["primary_a"].completed);

        let mut state = StoryState::default();
        state
            .set_primary_objective(&catalog, false, Some("primary_a"))
            .unwrap();
        let before = state.snapshot();
        assert_eq!(
            state
                .set_primary_objective(&catalog, false, Some("primary_a"))
                .unwrap(),
            MutationOutcome::Unchanged
        );
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .set_primary_objective(&catalog, true, Some("primary_a"))
            .unwrap_err();
        assert_eq!(error.code, "invalidPrimaryObjectiveTransition");
        assert_eq!(state.snapshot(), before);

        let mut state = StoryState::default();
        state
            .set_primary_objective(&catalog, false, Some("primary_a"))
            .unwrap();
        assert_eq!(
            state
                .set_primary_objective(&catalog, false, Some("primary_b"))
                .unwrap(),
            MutationOutcome::Changed
        );
        let snapshot = state.snapshot();
        assert_eq!(
            snapshot.active_primary_objective_id.as_deref(),
            Some("primary_b")
        );
        assert!(!snapshot.objectives["primary_a"].completed);
        assert!(!snapshot.objectives["primary_b"].completed);

        let mut state = StoryState::default();
        state
            .set_primary_objective(&catalog, false, Some("primary_a"))
            .unwrap();
        assert_eq!(
            state
                .set_primary_objective(&catalog, true, Some("primary_b"))
                .unwrap(),
            MutationOutcome::Changed
        );
        let snapshot = state.snapshot();
        assert_eq!(
            snapshot.active_primary_objective_id.as_deref(),
            Some("primary_b")
        );
        assert!(snapshot.objectives["primary_a"].completed);
        assert!(!snapshot.objectives["primary_b"].completed);
    }

    #[test]
    fn primary_selection_validates_unknown_secondary_and_completed_next_before_write() {
        let catalog = catalog();
        let mut state = StoryState::default();
        state
            .set_primary_objective(&catalog, false, Some("primary_a"))
            .unwrap();

        let before = state.snapshot();
        let error = state
            .set_primary_objective(&catalog, true, Some("missing"))
            .unwrap_err();
        assert_eq!(error.code, "unknownStoryObjective");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .set_primary_objective(&catalog, true, Some("secondary_a"))
            .unwrap_err();
        assert_eq!(error.code, "invalidPrimaryObjectiveTransition");
        assert_eq!(state.snapshot(), before);

        state.complete_objective(&catalog, "primary_b").unwrap();
        let before = state.snapshot();
        let error = state
            .set_primary_objective(&catalog, true, Some("primary_b"))
            .unwrap_err();
        assert_eq!(error.code, "invalidPrimaryObjectiveTransition");
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn authorization_grant_is_idempotent_and_preserves_first_origin() {
        let catalog = catalog();
        let mut state = StoryState::default();
        let first_origin = scene_origin("chapter_1", "scene_1", "event_1");

        assert_eq!(
            state
                .grant_authorization(&catalog, "authorization_a", first_origin.clone())
                .unwrap(),
            MutationOutcome::Changed
        );
        let snapshot = state.snapshot();
        let progress = &snapshot.authorizations["authorization_a"];
        assert_eq!(progress.first_origin, first_origin.clone());

        let before = state.snapshot();
        assert_eq!(
            state
                .grant_authorization(&catalog, "authorization_a", first_origin)
                .unwrap(),
            MutationOutcome::Unchanged
        );
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        assert_eq!(
            state
                .grant_authorization(
                    &catalog,
                    "authorization_a",
                    scene_origin("chapter_2", "scene_2", "board_2"),
                )
                .unwrap(),
            MutationOutcome::Unchanged
        );
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn authorization_invalid_origin_failures_preserve_state() {
        let catalog = catalog();
        let mut state = StoryState::default();

        let before = state.snapshot();
        let error = state
            .grant_authorization(
                &catalog,
                "missing",
                scene_origin("chapter_1", "scene_1", "event_1"),
            )
            .unwrap_err();
        assert_eq!(error.code, "unknownStoryAuthorization");
        assert_eq!(state.snapshot(), before);

        let before = state.snapshot();
        let error = state
            .grant_authorization(
                &catalog,
                "authorization_a",
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "scene_1".into(),
                    block_kind: StoryEventBlockKind::Hotspot,
                    block_id: "Bad Event".into(),
                },
            )
            .unwrap_err();
        assert_eq!(error.code, "invalidAssertionOrigin");
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn fact_and_authorization_reject_unresolvable_origin_kinds() {
        let catalog = catalog();
        let unresolvable_origins = [AssertionOrigin::SceneEvent {
            chapter_id: "chapter_1".into(),
            scene_id: "scene_1".into(),
            block_kind: StoryEventBlockKind::StoryEvent,
            block_id: "block_1".into(),
        }];

        for origin in unresolvable_origins {
            let mut state = StoryState::default();
            let before = state.snapshot();

            let fact_error = state
                .assert_fact(&catalog, "fact_alpha", origin.clone(), &[], &[])
                .unwrap_err();
            assert_eq!(
                fact_error.code, "invalidAssertionOrigin",
                "assert_fact must reject unresolvable origin kind: {origin:?}"
            );
            assert_eq!(state.snapshot(), before);

            let auth_error = state
                .grant_authorization(&catalog, "authorization_a", origin)
                .unwrap_err();
            assert_eq!(
                auth_error.code, "invalidAssertionOrigin",
                "grant_authorization must reject unresolvable origin kind"
            );
            assert_eq!(state.snapshot(), before);
        }
    }

    #[test]
    fn fact_and_authorization_accept_registered_analysis_board_origins() {
        let catalog = catalog();
        let origin = AssertionOrigin::AnalysisBoard {
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
            board_id: "board_1".into(),
        };
        let mut state = StoryState::default();

        assert_eq!(
            state
                .assert_fact(&catalog, "fact_alpha", origin.clone(), &[], &[])
                .unwrap(),
            MutationOutcome::Changed
        );
        assert_eq!(
            state
                .grant_authorization(&catalog, "authorization_a", origin)
                .unwrap(),
            MutationOutcome::Changed
        );
    }

    #[test]
    fn fact_and_authorization_reject_unknown_analysis_board_origins_without_mutation() {
        let catalog = catalog();
        let origin = AssertionOrigin::AnalysisBoard {
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
            board_id: "nonexistent".into(),
        };
        let mut state = StoryState::default();
        let before = state.snapshot();

        let fact_error = state
            .assert_fact(&catalog, "fact_alpha", origin.clone(), &[], &[])
            .expect_err("unknown analysis board origin must be rejected");
        assert_eq!(fact_error.code, "invalidAssertionOrigin");
        assert_eq!(state.snapshot(), before);

        let authorization_error = state
            .grant_authorization(&catalog, "authorization_a", origin)
            .expect_err("unknown analysis board origin must be rejected");
        assert_eq!(authorization_error.code, "invalidAssertionOrigin");
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn complete_analysis_board_records_progress_and_reports_changed() {
        let catalog = analysis_catalog();
        let mut state = StoryState::default();

        assert_eq!(
            state
                .complete_analysis_board(&catalog, "chapter_1", "analysis_scene_1", "board_1")
                .unwrap(),
            MutationOutcome::Changed
        );
        // Second call is idempotent — already completed.
        assert_eq!(
            state
                .complete_analysis_board(&catalog, "chapter_1", "analysis_scene_1", "board_1")
                .unwrap(),
            MutationOutcome::Unchanged
        );
    }

    #[test]
    fn complete_analysis_board_rejects_unknown_board() {
        let catalog = analysis_catalog();
        let mut state = StoryState::default();
        let before = state.snapshot();
        let error = state
            .complete_analysis_board(&catalog, "chapter_1", "analysis_scene_1", "nonexistent")
            .expect_err("unknown board must be rejected");
        assert_eq!(error.code, "unknownAnalysisBoard");
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn complete_analysis_scene_records_progress_and_reports_changed() {
        let catalog = analysis_catalog();
        let mut state = StoryState::default();

        assert_eq!(
            state
                .complete_analysis_scene(&catalog, "chapter_1", "analysis_scene_1")
                .unwrap(),
            MutationOutcome::Changed
        );
        // Second call is idempotent.
        assert_eq!(
            state
                .complete_analysis_scene(&catalog, "chapter_1", "analysis_scene_1")
                .unwrap(),
            MutationOutcome::Unchanged
        );
    }

    #[test]
    fn complete_analysis_scene_rejects_unknown_scene() {
        let catalog = analysis_catalog();
        let mut state = StoryState::default();
        let before = state.snapshot();
        let error = state
            .complete_analysis_scene(&catalog, "chapter_1", "nonexistent")
            .expect_err("unknown analysis scene must be rejected");
        assert_eq!(error.code, "unknownAnalysisScene");
        assert_eq!(state.snapshot(), before);
    }
}
