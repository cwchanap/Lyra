// src-tauri/src/game/reveals.rs
use crate::game::acquisition::AcquisitionCtx;
use crate::game::dialogue_queue::{DialogueSegment, DialogueSegmentOriginV1};
use crate::game::scenes::interrogation::InterrogationSceneState;
use crate::game::scenes::investigation::InvestigationSceneState;
use crate::game::schema::{
    CombinedInterrogationRevealTarget, InterrogationRevealTarget, InventoryTarget,
    InvestigationRevealTarget, RevealTarget, StoryRevealTarget,
};
use crate::game::story::{
    AssertionOrigin, MutationOutcome, ObjectiveKind, StoryCatalog, StoryState,
};
use crate::game::GameError;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct FactSupport {
    pub supporting_records: Vec<InventoryTarget>,
    pub supporting_fact_ids: Vec<String>,
}

pub(super) struct StoryRevealMaterializationContext<'a> {
    pub origin: AssertionOrigin,
    pub fact_support_by_id: &'a BTreeMap<String, FactSupport>,
    pub represented_authority: Option<&'a str>,
}

pub(super) fn apply_story_reveal(
    catalog: &StoryCatalog,
    story_state: &mut StoryState,
    target: &StoryRevealTarget,
    context: &StoryRevealMaterializationContext<'_>,
) -> Result<MutationOutcome, GameError> {
    match target {
        StoryRevealTarget::AssertFact { fact_id } => {
            let support = context
                .fact_support_by_id
                .get(fact_id)
                .cloned()
                .unwrap_or_default();
            story_state.assert_fact(
                catalog,
                fact_id,
                context.origin.clone(),
                &support.supporting_records,
                &support.supporting_fact_ids,
            )
        }
        StoryRevealTarget::RevealQuestion { question_id } => {
            story_state.reveal_question(catalog, question_id)
        }
        StoryRevealTarget::ResolveQuestion {
            question_id,
            fact_id,
        } => story_state.resolve_question(catalog, question_id, fact_id),
        StoryRevealTarget::RevealObjective { objective_id } => {
            story_state.reveal_objective(catalog, objective_id)
        }
        StoryRevealTarget::CompleteObjective { objective_id } => {
            if catalog
                .objective(objective_id)
                .is_some_and(|definition| definition.kind == ObjectiveKind::Primary)
            {
                return Err(GameError::invalid_primary_objective_transition(format!(
                    "completeObjective only accepts secondary objectives; '{objective_id}' is primary"
                )));
            }
            story_state.complete_objective(catalog, objective_id)
        }
        StoryRevealTarget::SetPrimaryObjective {
            complete_current,
            next_objective_id,
        } => story_state.set_primary_objective(
            catalog,
            *complete_current,
            next_objective_id.as_deref(),
        ),
        StoryRevealTarget::GrantAuthorization { authorization_id } => {
            let Some(definition) = catalog.authorization(authorization_id) else {
                return story_state.grant_authorization(
                    catalog,
                    authorization_id,
                    context.origin.clone(),
                );
            };
            let Some(represented_authority) = context.represented_authority else {
                return Err(GameError::scene_validation_failed(format!(
                    "grantAuthorization for '{authorization_id}' requires a represented authority"
                )));
            };
            if represented_authority != definition.granting_authority {
                return Err(GameError::scene_validation_failed(format!(
                    "grantAuthorization for '{authorization_id}' represents '{represented_authority}', expected '{}'",
                    definition.granting_authority
                )));
            }
            story_state.grant_authorization(catalog, authorization_id, context.origin.clone())
        }
    }
}

#[allow(dead_code)] // Kept as the focused batch API for future non-scene adapters.
pub(super) fn apply_story_reveals(
    catalog: &StoryCatalog,
    story_state: &mut StoryState,
    targets: &[StoryRevealTarget],
    context: &StoryRevealMaterializationContext<'_>,
) -> Result<MutationOutcome, GameError> {
    let mut outcome = MutationOutcome::Unchanged;
    for target in targets {
        if apply_story_reveal(catalog, story_state, target, context)? == MutationOutcome::Changed {
            outcome = MutationOutcome::Changed;
        }
    }
    Ok(outcome)
}

pub(super) trait InvestigationRevealItem {
    fn local_target(&self) -> Option<&RevealTarget>;
    fn story_target(&self) -> Option<&StoryRevealTarget>;
}

impl InvestigationRevealItem for RevealTarget {
    fn local_target(&self) -> Option<&RevealTarget> {
        Some(self)
    }

    fn story_target(&self) -> Option<&StoryRevealTarget> {
        None
    }
}

impl InvestigationRevealItem for InvestigationRevealTarget {
    fn local_target(&self) -> Option<&RevealTarget> {
        match self {
            Self::Local(target) => Some(target),
            Self::Story(_) => None,
        }
    }

    fn story_target(&self) -> Option<&StoryRevealTarget> {
        match self {
            Self::Local(_) => None,
            Self::Story(target) => Some(target),
        }
    }
}

pub(super) trait InterrogationRevealItem {
    fn local_target(&self) -> Option<&InterrogationRevealTarget>;
    fn story_target(&self) -> Option<&StoryRevealTarget>;
}

impl InterrogationRevealItem for InterrogationRevealTarget {
    fn local_target(&self) -> Option<&InterrogationRevealTarget> {
        Some(self)
    }

    fn story_target(&self) -> Option<&StoryRevealTarget> {
        None
    }
}

impl InterrogationRevealItem for CombinedInterrogationRevealTarget {
    fn local_target(&self) -> Option<&InterrogationRevealTarget> {
        match self {
            Self::Local(target) => Some(target),
            Self::Story(_) => None,
        }
    }

    fn story_target(&self) -> Option<&StoryRevealTarget> {
        match self {
            Self::Local(_) => None,
            Self::Story(target) => Some(target),
        }
    }
}

pub(super) fn apply_reveals_and_build_queue<T: InvestigationRevealItem>(
    scene: &mut InvestigationSceneState,
    acq: &mut AcquisitionCtx,
    story_state: &mut StoryState,
    story_context: &StoryRevealMaterializationContext<'_>,
    trigger_segment: Option<DialogueSegment>,
    reveals: &[T],
    chapter_id: &str,
) -> Result<Vec<DialogueSegment>, GameError> {
    let mut segments: Vec<DialogueSegment> = trigger_segment.into_iter().collect();
    for r in reveals {
        let Some(local_target) = r.local_target() else {
            let story_target = r.story_target().ok_or_else(|| {
                GameError::internal("reveal target is neither local nor story".into())
            })?;
            apply_story_reveal(acq.catalog, story_state, story_target, story_context)?;
            continue;
        };
        match local_target {
            RevealTarget::Evidence { id } => {
                if let Some(def) = scene.def.evidence_manifest.iter().find(|e| e.id == *id) {
                    let newly_added = acq.evidence(def, chapter_id, &scene.def.id)?;
                    if newly_added {
                        segments.extend(DialogueSegment::new(
                            DialogueSegmentOriginV1::InvestigationInteraction {
                                chapter_id: chapter_id.into(),
                                scene_id: scene.def.id.clone(),
                                segment_id: format!("evidence:{id}:onCollect"),
                            },
                            def.on_collect.clone(),
                        ));
                    }
                }
            }
            RevealTarget::Statement { id } => {
                if let Some(def) = scene.def.statement_manifest.iter().find(|s| s.id == *id) {
                    let newly_added = acq.statement(def, chapter_id, &scene.def.id)?;
                    if newly_added {
                        segments.extend(DialogueSegment::new(
                            DialogueSegmentOriginV1::InvestigationInteraction {
                                chapter_id: chapter_id.into(),
                                scene_id: scene.def.id.clone(),
                                segment_id: format!("statement:{id}:onAcquire"),
                            },
                            def.on_acquire.clone(),
                        ));
                    }
                }
            }
            RevealTarget::Practice { id } => {
                // Practice cards are scoped to this investigation's local
                // notebook. Do not route them through AcquisitionCtx: that
                // would publish tutorial material into the global Case File.
                scene.record_practice_card(id);
            }
            RevealTarget::Topic {
                character_id,
                topic_id,
            } => {
                scene.unlock_override(&format!("topic:{character_id}@{topic_id}"));
            }
            RevealTarget::Hotspot { id } => {
                scene.unlock_override(&format!("hotspot:{id}"));
            }
            RevealTarget::Sublocation { id } => {
                scene.unlock_override(&format!("sublocation:{id}"));
            }
        }
    }
    Ok(segments)
}

pub(super) fn apply_interrogation_reveals_and_build_queue<T: InterrogationRevealItem>(
    scene: &mut InterrogationSceneState,
    acq: &mut AcquisitionCtx,
    story_state: &mut StoryState,
    story_context: &StoryRevealMaterializationContext<'_>,
    trigger_segment: Option<DialogueSegment>,
    reveals: &[T],
    chapter_id: &str,
) -> Result<Vec<DialogueSegment>, GameError> {
    let mut segments: Vec<DialogueSegment> = trigger_segment.into_iter().collect();
    for r in reveals {
        let Some(local_target) = r.local_target() else {
            let story_target = r.story_target().ok_or_else(|| {
                GameError::internal("reveal target is neither local nor story".into())
            })?;
            apply_story_reveal(acq.catalog, story_state, story_target, story_context)?;
            continue;
        };
        match local_target {
            InterrogationRevealTarget::Evidence { id } => {
                if let Some(def) = scene.def.evidence_manifest.iter().find(|e| e.id == *id) {
                    let newly_added = acq.evidence(def, chapter_id, &scene.def.id)?;
                    if newly_added {
                        segments.extend(DialogueSegment::new(
                            DialogueSegmentOriginV1::InterrogationPhase {
                                chapter_id: chapter_id.into(),
                                scene_id: scene.def.id.clone(),
                                phase_id: "inventory".into(),
                                segment_id: format!("evidence:{id}:onCollect"),
                            },
                            def.on_collect.clone(),
                        ));
                    }
                }
            }
            InterrogationRevealTarget::Statement { id } => {
                if let Some(def) = scene.def.statement_manifest.iter().find(|s| s.id == *id) {
                    let newly_added = acq.statement(def, chapter_id, &scene.def.id)?;
                    if newly_added {
                        segments.extend(DialogueSegment::new(
                            DialogueSegmentOriginV1::InterrogationPhase {
                                chapter_id: chapter_id.into(),
                                scene_id: scene.def.id.clone(),
                                phase_id: "inventory".into(),
                                segment_id: format!("statement:{id}:onAcquire"),
                            },
                            def.on_acquire.clone(),
                        ));
                    }
                }
            }
            InterrogationRevealTarget::Question { id } => {
                scene.unlock_override(&format!("question:{id}"));
            }
            InterrogationRevealTarget::Phase { id } => {
                scene.unlock_override(&format!("phase:{id}"));
            }
        }
    }
    Ok(segments)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{
        AutoMarker, CombinedInterrogationRevealTarget, DialogueItem, EvidenceJson,
        InterrogationOutroJson, InterrogationOutroUnlock, InterrogationSceneJson,
        InvestigationRevealTarget, InvestigationSceneJson, OutroJson, OutroUnlock,
        StoryRevealTarget,
    };
    use crate::game::state::Inventory;
    use crate::game::story::{AssertionOrigin, StoryEventBlockKind, StoryState};
    use crate::game::test_support::{
        catalog_with_case_records, catalog_with_story_definitions_and_case_records,
    };
    use std::collections::BTreeMap;

    fn evidence_def(id: &str) -> EvidenceJson {
        EvidenceJson {
            id: id.into(),
            name: id.into(),
            description: id.into(),
            details: id.into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: None,
            on_collect: vec![DialogueItem::Line {
                speaker: "A".into(),
                text: format!("collected {id}"),
                portrait: None,
            }],
            on_reexamine: None,
        }
    }

    fn evidence_catalog(scene_id: &str, ids: &[&str]) -> crate::game::story::StoryCatalog {
        catalog_with_case_records(
            ids.iter()
                .map(|id| {
                    (
                        *id,
                        "chapter_1",
                        scene_id,
                        crate::game::provenance::CaseRecordProvenance::default(),
                    )
                })
                .collect(),
            vec![],
        )
    }

    fn empty_scene_with_evidence(defs: Vec<EvidenceJson>) -> InvestigationSceneState {
        InvestigationSceneState::from_json(
            InvestigationSceneJson {
                id: "i".into(),
                title: "i".into(),
                summary: "Summary".into(),
                asset_refs: vec![],
                intro: vec![],
                sublocations: vec![],
                evidence_manifest: defs,
                statement_manifest: vec![],
                outro: OutroJson {
                    unlock: OutroUnlock::Auto(AutoMarker::Auto),
                    dialogue: vec![],
                },
            },
            1,
        )
    }

    fn empty_interrogation_scene_with_evidence(defs: Vec<EvidenceJson>) -> InterrogationSceneState {
        InterrogationSceneState::from_json(
            InterrogationSceneJson {
                id: "interrogation".into(),
                title: "interrogation".into(),
                summary: "Summary".into(),
                asset_refs: vec![],
                intro: vec![],
                phases: vec![],
                evidence_manifest: defs,
                statement_manifest: vec![],
                outro: InterrogationOutroJson {
                    unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                    dialogue: vec![],
                },
            },
            1,
        )
    }

    fn investigation_trigger(items: Vec<DialogueItem>) -> Option<DialogueSegment> {
        DialogueSegment::new(
            DialogueSegmentOriginV1::InvestigationInteraction {
                chapter_id: "chapter_1".into(),
                scene_id: "i".into(),
                segment_id: "hotspot:desk:inspect".into(),
            },
            items,
        )
    }

    fn interrogation_trigger(items: Vec<DialogueItem>) -> Option<DialogueSegment> {
        DialogueSegment::new(
            DialogueSegmentOriginV1::InterrogationPhase {
                chapter_id: "chapter_1".into(),
                scene_id: "interrogation".into(),
                phase_id: "phase".into(),
                segment_id: "phase:phase:entry".into(),
            },
            items,
        )
    }

    fn apply_investigation_reveals_for_test<T: InvestigationRevealItem>(
        scene: &mut InvestigationSceneState,
        acq: &mut AcquisitionCtx,
        trigger_segment: Option<DialogueSegment>,
        reveals: &[T],
        chapter_id: &str,
    ) -> Result<Vec<DialogueSegment>, GameError> {
        let mut story_state = StoryState::default();
        let fact_support_by_id = BTreeMap::new();
        let context = StoryRevealMaterializationContext {
            origin: story_origin("legacy"),
            fact_support_by_id: &fact_support_by_id,
            represented_authority: None,
        };
        apply_reveals_and_build_queue(
            scene,
            acq,
            &mut story_state,
            &context,
            trigger_segment,
            reveals,
            chapter_id,
        )
    }

    fn apply_interrogation_reveals_for_test<T: InterrogationRevealItem>(
        scene: &mut InterrogationSceneState,
        acq: &mut AcquisitionCtx,
        trigger_segment: Option<DialogueSegment>,
        reveals: &[T],
        chapter_id: &str,
    ) -> Result<Vec<DialogueSegment>, GameError> {
        let mut story_state = StoryState::default();
        let fact_support_by_id = BTreeMap::new();
        let context = StoryRevealMaterializationContext {
            origin: story_origin("legacy"),
            fact_support_by_id: &fact_support_by_id,
            represented_authority: None,
        };
        apply_interrogation_reveals_and_build_queue(
            scene,
            acq,
            &mut story_state,
            &context,
            trigger_segment,
            reveals,
            chapter_id,
        )
    }

    fn story_catalog() -> crate::game::story::StoryCatalog {
        catalog_with_story_definitions_and_case_records(
            vec![
                serde_json::json!({
                    "id": "fact_support",
                    "label": "Support",
                    "summary": "Support",
                    "details": "Support",
                    "category": "test"
                }),
                serde_json::json!({
                    "id": "fact_main",
                    "label": "Main",
                    "summary": "Main",
                    "details": "Main",
                    "category": "test"
                }),
            ],
            vec![serde_json::json!({
                "id": "question_a",
                "label": "Question",
                "summary": "Question",
                "resolvedByFactIds": ["fact_main"]
            })],
            vec![
                serde_json::json!({
                    "id": "primary_a",
                    "label": "Primary A",
                    "summary": "Primary A",
                    "kind": "primary",
                    "sortOrder": 0
                }),
                serde_json::json!({
                    "id": "primary_b",
                    "label": "Primary B",
                    "summary": "Primary B",
                    "kind": "primary",
                    "sortOrder": 1
                }),
                serde_json::json!({
                    "id": "secondary_a",
                    "label": "Secondary",
                    "summary": "Secondary",
                    "kind": "secondary",
                    "sortOrder": 2
                }),
            ],
            vec![serde_json::json!({
                "id": "authorization_a",
                "label": "Authorization",
                "summary": "Authorization",
                "grantingAuthority": "Police"
            })],
            vec![
                (
                    "record_a",
                    "chapter_1",
                    "investigation_scene_1",
                    crate::game::provenance::CaseRecordProvenance::default(),
                ),
                (
                    "record_b",
                    "chapter_1",
                    "investigation_scene_1",
                    crate::game::provenance::CaseRecordProvenance::default(),
                ),
            ],
            vec![],
        )
    }

    fn story_origin(block_id: &str) -> AssertionOrigin {
        AssertionOrigin::SceneEvent {
            chapter_id: "chapter_1".into(),
            scene_id: "investigation_scene_1".into(),
            block_kind: StoryEventBlockKind::Hotspot,
            block_id: block_id.into(),
        }
    }

    // Break caught: dispatcher reorders a resolver ahead of its authored fact
    // assertion, or omits one of the HPA-257 target-to-mutation mappings.
    #[test]
    fn story_reveals_dispatch_every_target_in_author_order() {
        let catalog = story_catalog();
        let mut state = StoryState::default();
        let support = BTreeMap::from([(
            "fact_main".into(),
            FactSupport {
                supporting_records: vec![],
                supporting_fact_ids: vec!["fact_support".into()],
            },
        )]);
        let seed_context = StoryRevealMaterializationContext {
            origin: story_origin("seed"),
            fact_support_by_id: &BTreeMap::new(),
            represented_authority: None,
        };
        apply_story_reveal(
            &catalog,
            &mut state,
            &StoryRevealTarget::AssertFact {
                fact_id: "fact_support".into(),
            },
            &seed_context,
        )
        .unwrap();
        let context = StoryRevealMaterializationContext {
            origin: story_origin("ordered"),
            fact_support_by_id: &support,
            represented_authority: Some("Police"),
        };

        apply_story_reveals(
            &catalog,
            &mut state,
            &[
                StoryRevealTarget::AssertFact {
                    fact_id: "fact_main".into(),
                },
                StoryRevealTarget::RevealQuestion {
                    question_id: "question_a".into(),
                },
                StoryRevealTarget::ResolveQuestion {
                    question_id: "question_a".into(),
                    fact_id: "fact_main".into(),
                },
                StoryRevealTarget::RevealObjective {
                    objective_id: "secondary_a".into(),
                },
                StoryRevealTarget::CompleteObjective {
                    objective_id: "secondary_a".into(),
                },
                StoryRevealTarget::GrantAuthorization {
                    authorization_id: "authorization_a".into(),
                },
            ],
            &context,
        )
        .unwrap();

        let snapshot = state.snapshot();
        assert_eq!(
            snapshot.questions["question_a"]
                .resolved_by_fact_id
                .as_deref(),
            Some("fact_main")
        );
        assert!(snapshot.objectives["secondary_a"].completed);
        assert!(snapshot.authorizations.contains_key("authorization_a"));
        assert_eq!(
            snapshot.facts["fact_main"].supporting_fact_ids,
            std::collections::BTreeSet::from(["fact_support".into()])
        );
    }

    // Break caught: HPA-257 bypasses HPA-255's set-primary transition method
    // or loses complete-current/null-next semantics.
    #[test]
    fn story_reveal_set_primary_uses_hpa_255_transition_semantics() {
        let catalog = story_catalog();
        let mut state = StoryState::default();
        let empty_support = BTreeMap::new();
        let context = StoryRevealMaterializationContext {
            origin: story_origin("primary"),
            fact_support_by_id: &empty_support,
            represented_authority: None,
        };

        apply_story_reveal(
            &catalog,
            &mut state,
            &StoryRevealTarget::SetPrimaryObjective {
                complete_current: false,
                next_objective_id: Some("primary_a".into()),
            },
            &context,
        )
        .unwrap();
        apply_story_reveal(
            &catalog,
            &mut state,
            &StoryRevealTarget::SetPrimaryObjective {
                complete_current: true,
                next_objective_id: Some("primary_b".into()),
            },
            &context,
        )
        .unwrap();
        apply_story_reveal(
            &catalog,
            &mut state,
            &StoryRevealTarget::SetPrimaryObjective {
                complete_current: true,
                next_objective_id: None,
            },
            &context,
        )
        .unwrap();

        let snapshot = state.snapshot();
        assert!(snapshot.objectives["primary_a"].completed);
        assert!(snapshot.objectives["primary_b"].completed);
        assert_eq!(snapshot.active_primary_objective_id, None);
    }

    // Break caught: resolveQuestion bypasses HPA-255's asserted-resolver
    // prerequisite when reached through the authored dispatcher.
    #[test]
    fn story_reveal_question_resolution_requires_an_asserted_resolver() {
        let catalog = story_catalog();
        let mut state = StoryState::default();
        let empty_support = BTreeMap::new();
        let context = StoryRevealMaterializationContext {
            origin: story_origin("resolver"),
            fact_support_by_id: &empty_support,
            represented_authority: None,
        };

        let error = apply_story_reveal(
            &catalog,
            &mut state,
            &StoryRevealTarget::ResolveQuestion {
                question_id: "question_a".into(),
                fact_id: "fact_main".into(),
            },
            &context,
        )
        .unwrap_err();

        assert_eq!(error.code, "invalidQuestionResolutionFact");
        assert_eq!(state, StoryState::default());
    }

    // Break caught: direct completeObjective broadens HPA-255's internal API
    // and completes a primary objective from authored reveal syntax.
    #[test]
    fn story_reveal_direct_completion_rejects_primary_objectives() {
        let catalog = story_catalog();
        let mut state = StoryState::default();
        let empty_support = BTreeMap::new();
        let context = StoryRevealMaterializationContext {
            origin: story_origin("complete"),
            fact_support_by_id: &empty_support,
            represented_authority: None,
        };

        let error = apply_story_reveal(
            &catalog,
            &mut state,
            &StoryRevealTarget::CompleteObjective {
                objective_id: "primary_a".into(),
            },
            &context,
        )
        .unwrap_err();

        assert_eq!(error.code, "invalidPrimaryObjectiveTransition");
        assert_eq!(state, StoryState::default());
    }

    // Break caught: grantAuthorization ignores the adapter's represented
    // authority, allowing ordinary scene triggers to mint authority progress.
    #[test]
    fn story_reveal_authorization_requires_matching_represented_authority() {
        let catalog = story_catalog();
        for represented_authority in [None, Some("Court")] {
            let mut state = StoryState::default();
            let empty_support = BTreeMap::new();
            let context = StoryRevealMaterializationContext {
                origin: story_origin("grant"),
                fact_support_by_id: &empty_support,
                represented_authority,
            };
            let error = apply_story_reveal(
                &catalog,
                &mut state,
                &StoryRevealTarget::GrantAuthorization {
                    authorization_id: "authorization_a".into(),
                },
                &context,
            )
            .unwrap_err();
            assert_eq!(error.code, "sceneValidationFailed");
            assert_eq!(state, StoryState::default());
        }
    }

    // Break caught: repeated valid fact events replace provenance/support
    // instead of preserving the first origin and unioning direct support.
    #[test]
    fn story_reveal_fact_materialization_preserves_origin_and_unions_support() {
        let catalog = story_catalog();
        let mut state = StoryState::default();
        let empty_support = BTreeMap::new();
        let seed_context = StoryRevealMaterializationContext {
            origin: story_origin("seed"),
            fact_support_by_id: &empty_support,
            represented_authority: None,
        };
        apply_story_reveal(
            &catalog,
            &mut state,
            &StoryRevealTarget::AssertFact {
                fact_id: "fact_support".into(),
            },
            &seed_context,
        )
        .unwrap();

        let first_support = BTreeMap::from([(
            "fact_main".into(),
            FactSupport {
                supporting_records: vec![InventoryTarget::Evidence {
                    id: "record_a".into(),
                }],
                supporting_fact_ids: vec![],
            },
        )]);
        let first_origin = story_origin("first");
        apply_story_reveal(
            &catalog,
            &mut state,
            &StoryRevealTarget::AssertFact {
                fact_id: "fact_main".into(),
            },
            &StoryRevealMaterializationContext {
                origin: first_origin.clone(),
                fact_support_by_id: &first_support,
                represented_authority: None,
            },
        )
        .unwrap();
        let second_support = BTreeMap::from([(
            "fact_main".into(),
            FactSupport {
                supporting_records: vec![InventoryTarget::Evidence {
                    id: "record_b".into(),
                }],
                supporting_fact_ids: vec!["fact_support".into()],
            },
        )]);
        apply_story_reveal(
            &catalog,
            &mut state,
            &StoryRevealTarget::AssertFact {
                fact_id: "fact_main".into(),
            },
            &StoryRevealMaterializationContext {
                origin: story_origin("second"),
                fact_support_by_id: &second_support,
                represented_authority: None,
            },
        )
        .unwrap();

        let fact = &state.snapshot().facts["fact_main"];
        assert_eq!(fact.first_origin, first_origin);
        assert_eq!(
            fact.supporting_records,
            std::collections::BTreeSet::from([
                InventoryTarget::Evidence {
                    id: "record_a".into(),
                },
                InventoryTarget::Evidence {
                    id: "record_b".into(),
                },
            ])
        );
        assert_eq!(
            fact.supporting_fact_ids,
            std::collections::BTreeSet::from(["fact_support".into()])
        );
    }

    #[test]
    fn reveal_dispatcher_delegates_primary_mutation() {
        let source = include_str!("reveals.rs");
        let production_source = source
            .split("#[cfg(test)]")
            .next()
            .expect("reveals source has a production section");
        let direct_active_primary_assignment = ["active_primary", "_objective_id ="].concat();
        let direct_objective_insert = ["objectives", ".insert("].concat();
        assert!(production_source.contains(".set_primary_objective("));
        assert!(!production_source.contains(&direct_active_primary_assignment));
        assert!(!production_source.contains(&direct_objective_insert));
    }

    // Break caught: the investigation wrapper handles only one half of a
    // mixed local/story batch instead of preserving authored order.
    #[test]
    fn investigation_mixed_batch_dispatches_local_and_story_targets() {
        let catalog = catalog_with_story_definitions_and_case_records(
            vec![serde_json::json!({
                "id": "fact_a", "label": "Fact", "summary": "Fact",
                "details": "Fact", "category": "test"
            })],
            vec![],
            vec![],
            vec![],
            vec![(
                "coffee",
                "chapter_1",
                "i",
                crate::game::provenance::CaseRecordProvenance::default(),
            )],
            vec![],
        );
        let mut scene = empty_scene_with_evidence(vec![evidence_def("coffee")]);
        let mut inventory = Inventory::default();
        let mut story_state = StoryState::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acquisition = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inventory,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        let reveals = [
            InvestigationRevealTarget::Local(RevealTarget::Evidence {
                id: "coffee".into(),
            }),
            InvestigationRevealTarget::Story(StoryRevealTarget::AssertFact {
                fact_id: "fact_a".into(),
            }),
        ];
        let fact_support_by_id = BTreeMap::new();
        let context = StoryRevealMaterializationContext {
            origin: story_origin("desk"),
            fact_support_by_id: &fact_support_by_id,
            represented_authority: None,
        };

        apply_reveals_and_build_queue(
            &mut scene,
            &mut acquisition,
            &mut story_state,
            &context,
            None,
            &reveals,
            "chapter_1",
        )
        .unwrap();

        assert!(inventory.has_evidence("coffee"));
        assert!(story_state.snapshot().facts.contains_key("fact_a"));
        assert_eq!(events.len(), 1);
        assert_eq!(next_ordinal, 1);
    }

    // Break caught: the interrogation wrapper drops story variants after
    // applying its local inventory reveal.
    #[test]
    fn interrogation_mixed_batch_dispatches_local_and_story_targets() {
        let catalog = catalog_with_story_definitions_and_case_records(
            vec![serde_json::json!({
                "id": "fact_a", "label": "Fact", "summary": "Fact",
                "details": "Fact", "category": "test"
            })],
            vec![],
            vec![],
            vec![],
            vec![(
                "coffee",
                "chapter_1",
                "interrogation",
                crate::game::provenance::CaseRecordProvenance::default(),
            )],
            vec![],
        );
        let mut scene = empty_interrogation_scene_with_evidence(vec![evidence_def("coffee")]);
        let mut inventory = Inventory::default();
        let mut story_state = StoryState::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acquisition = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inventory,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        let reveals = [
            CombinedInterrogationRevealTarget::Local(InterrogationRevealTarget::Evidence {
                id: "coffee".into(),
            }),
            CombinedInterrogationRevealTarget::Story(StoryRevealTarget::AssertFact {
                fact_id: "fact_a".into(),
            }),
        ];
        let fact_support_by_id = BTreeMap::new();
        let context = StoryRevealMaterializationContext {
            origin: AssertionOrigin::SceneEvent {
                chapter_id: "chapter_1".into(),
                scene_id: "interrogation".into(),
                block_kind: StoryEventBlockKind::InquiryQuestion,
                block_id: "question".into(),
            },
            fact_support_by_id: &fact_support_by_id,
            represented_authority: None,
        };

        apply_interrogation_reveals_and_build_queue(
            &mut scene,
            &mut acquisition,
            &mut story_state,
            &context,
            None,
            &reveals,
            "chapter_1",
        )
        .unwrap();

        assert!(inventory.has_evidence("coffee"));
        assert!(story_state.snapshot().facts.contains_key("fact_a"));
        assert_eq!(events.len(), 1);
        assert_eq!(next_ordinal, 1);
    }

    // Break caught: a reveal swallows the catalog mismatch and commits an
    // inventory record/event instead of propagating the typed error.
    #[test]
    fn reveal_propagates_acquisition_definition_mismatch_without_mutation() {
        let catalog = catalog_with_case_records(
            vec![(
                "coffee",
                "chapter_1",
                "i",
                crate::game::provenance::CaseRecordProvenance::default(),
            )],
            vec![],
        );
        let mut definition = evidence_def("coffee");
        definition.provenance.source_label = Some("mismatch".into());
        let mut scene = empty_scene_with_evidence(vec![definition]);
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };

        let error = apply_investigation_reveals_for_test(
            &mut scene,
            &mut acq,
            None,
            &[RevealTarget::Evidence {
                id: "coffee".into(),
            }],
            "chapter_1",
        )
        .unwrap_err();

        assert_eq!(error.code, "caseRecordDefinitionMismatch");
        assert!(inv.evidence.is_empty());
        assert!(events.is_empty());
        assert_eq!(next_ordinal, 0);
    }

    #[test]
    fn reveals_evidence_appends_on_collect_to_queue() {
        let catalog = evidence_catalog("i", &["coffee"]);
        let mut scene = empty_scene_with_evidence(vec![evidence_def("coffee")]);
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        let queue = apply_investigation_reveals_for_test(
            &mut scene,
            &mut acq,
            investigation_trigger(vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "trigger".into(),
                portrait: None,
            }]),
            &[RevealTarget::Evidence {
                id: "coffee".into(),
            }],
            "chapter_1",
        )
        .unwrap();
        assert_eq!(queue.len(), 2);
        assert!(inv.has_evidence("coffee"));
    }

    #[test]
    fn reveals_multiple_evidence_items_from_one_trigger() {
        let catalog = evidence_catalog("i", &["receipt", "cctv"]);
        let mut scene =
            empty_scene_with_evidence(vec![evidence_def("receipt"), evidence_def("cctv")]);
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        let queue = apply_investigation_reveals_for_test(
            &mut scene,
            &mut acq,
            investigation_trigger(vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "trigger".into(),
                portrait: None,
            }]),
            &[
                RevealTarget::Evidence {
                    id: "receipt".into(),
                },
                RevealTarget::Evidence { id: "cctv".into() },
            ],
            "chapter_1",
        )
        .unwrap();

        assert!(inv.has_evidence("receipt"));
        assert!(inv.has_evidence("cctv"));
        assert_eq!(
            queue
                .iter()
                .flat_map(|segment| &segment.items)
                .filter_map(|item| match item {
                    DialogueItem::Line { text, .. } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            vec!["trigger", "collected receipt", "collected cctv"]
        );
    }

    #[test]
    fn double_reveal_of_same_evidence_does_not_double_append() {
        let catalog = evidence_catalog("i", &["coffee"]);
        let mut scene = empty_scene_with_evidence(vec![evidence_def("coffee")]);
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        let _ = apply_investigation_reveals_for_test(
            &mut scene,
            &mut acq,
            None,
            &[RevealTarget::Evidence {
                id: "coffee".into(),
            }],
            "chapter_1",
        )
        .unwrap();
        let queue2 = apply_investigation_reveals_for_test(
            &mut scene,
            &mut acq,
            None,
            &[RevealTarget::Evidence {
                id: "coffee".into(),
            }],
            "chapter_1",
        )
        .unwrap();
        assert!(queue2.is_empty());
    }

    #[test]
    fn reveals_sublocation_silently_unlocks_it() {
        let catalog = evidence_catalog("i", &[]);
        let mut scene = empty_scene_with_evidence(vec![]);
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        let queue = apply_investigation_reveals_for_test(
            &mut scene,
            &mut acq,
            None,
            &[RevealTarget::Sublocation {
                id: "back_room".into(),
            }],
            "chapter_1",
        )
        .unwrap();
        assert!(queue.is_empty());
        assert!(scene.unlocked_overrides.contains("sublocation:back_room"));
    }

    #[test]
    fn interrogation_reveals_evidence_appends_on_collect_to_queue() {
        let catalog = evidence_catalog("interrogation", &["receipt"]);
        let mut scene = empty_interrogation_scene_with_evidence(vec![evidence_def("receipt")]);
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        let queue = apply_interrogation_reveals_for_test(
            &mut scene,
            &mut acq,
            interrogation_trigger(vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "trigger".into(),
                portrait: None,
            }]),
            &[InterrogationRevealTarget::Evidence {
                id: "receipt".into(),
            }],
            "chapter_1",
        )
        .unwrap();
        assert_eq!(queue.len(), 2);
        assert!(inv.has_evidence("receipt"));
    }

    #[test]
    fn interrogation_reveals_question_and_phase_unlock_overrides() {
        let catalog = evidence_catalog("interrogation", &[]);
        let mut scene = empty_interrogation_scene_with_evidence(vec![]);
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        let queue = apply_interrogation_reveals_for_test(
            &mut scene,
            &mut acq,
            None,
            &[
                InterrogationRevealTarget::Question {
                    id: "hidden".into(),
                },
                InterrogationRevealTarget::Phase {
                    id: "testimony".into(),
                },
            ],
            "chapter_1",
        )
        .unwrap();
        assert!(queue.is_empty());
        assert!(scene.unlocked_overrides.contains("question:hidden"));
        assert!(scene.unlocked_overrides.contains("phase:testimony"));
    }

    // HPA-257 regression: a local reveal of a hotspot/topic/question/phase
    // target only unlocks the block at runtime; it must NOT investigate,
    // discuss, answer, or complete it. The revealed target's own execution
    // path remains the sole producer of the corresponding completion state.
    // This locks in the runtime half of the contract that the compiler
    // reachability adapter now relies on (see reachability.ts: a local reveal
    // no longer publishes the completion atom).
    fn investigation_scene_with_locked_blocks() -> InvestigationSceneState {
        let json = serde_json::json!({
            "id": "i",
            "title": "i",
            "summary": "Summary",
            "intro": [],
            "sublocations": [{
                "id": "main",
                "label": "Main",
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "main",
                "transitionDialogue": [],
                "hotspots": [{
                    "id": "h_locked",
                    "label": "Locked",
                    "description": "desc",
                    "status": "locked",
                    "unlock": null,
                    "reveals": [],
                    "inspectDialogue": [],
                    "onReexamine": null
                }],
                "characters": [{
                    "id": "c",
                    "name": "C",
                    "role": "Witness",
                    "bio": "bio",
                    "topics": [{
                        "id": "t_locked",
                        "label": "Locked",
                        "status": "locked",
                        "unlock": null,
                        "reveals": [],
                        "topicDialogue": [],
                        "onReexamine": null
                    }]
                }]
            }],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": "auto", "dialogue": [] }
        });
        InvestigationSceneState::from_json(serde_json::from_value(json).unwrap(), 1)
    }

    fn interrogation_scene_with_locked_blocks() -> InterrogationSceneState {
        let json = serde_json::json!({
            "id": "interrogation",
            "title": "Interrogation",
            "summary": "Summary",
            "intro": [],
            "phases": [
                {
                    "kind": "inquiry",
                    "id": "p1",
                    "label": "P1",
                    "subject": { "id": "suspect", "name": "Suspect", "role": "Witness", "bio": "bio" },
                    "required": true,
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [],
                    "sceneTag": "p1",
                    "entryDialogue": [],
                    "complete": "auto",
                    "questions": [{
                        "id": "q1",
                        "label": "Q1",
                        "status": "unlocked",
                        "required": false,
                        "unlock": null,
                        "reveals": [],
                        "testimony": {
                            "onLoop": [],
                            "lines": [{ "id": "l", "label": "L", "content": [], "contradiction": null }]
                        }
                    }]
                },
                {
                    "kind": "inquiry",
                    "id": "p2",
                    "label": "P2",
                    "subject": { "id": "suspect2", "name": "Suspect2", "role": "Witness", "bio": "bio" },
                    "required": false,
                    "status": "locked",
                    "unlock": null,
                    "reveals": [],
                    "sceneTag": "p2",
                    "entryDialogue": [],
                    "complete": "auto",
                    "questions": [{
                        "id": "q2",
                        "label": "Q2",
                        "status": "locked",
                        "required": false,
                        "unlock": null,
                        "reveals": [],
                        "testimony": {
                            "onLoop": [],
                            "lines": [{ "id": "l2", "label": "L2", "content": [], "contradiction": null }]
                        }
                    }]
                }
            ],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": "auto", "dialogue": [] }
        });
        InterrogationSceneState::from_json(serde_json::from_value(json).unwrap(), 1)
    }

    #[test]
    fn investigation_hotspot_reveal_unlocks_without_investigating() {
        let catalog = evidence_catalog("i", &[]);
        let mut scene = investigation_scene_with_locked_blocks();
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        apply_investigation_reveals_for_test(
            &mut scene,
            &mut acq,
            None,
            &[RevealTarget::Hotspot {
                id: "h_locked".into(),
            }],
            "chapter_1",
        )
        .unwrap();

        assert!(scene.unlocked_overrides.contains("hotspot:h_locked"));
        assert!(!scene.inspected_hotspots.contains("h_locked"));
    }

    #[test]
    fn investigation_topic_reveal_unlocks_without_discussing() {
        let catalog = evidence_catalog("i", &[]);
        let mut scene = investigation_scene_with_locked_blocks();
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        apply_investigation_reveals_for_test(
            &mut scene,
            &mut acq,
            None,
            &[RevealTarget::Topic {
                character_id: "c".into(),
                topic_id: "t_locked".into(),
            }],
            "chapter_1",
        )
        .unwrap();

        assert!(scene.unlocked_overrides.contains("topic:c@t_locked"));
        assert!(!scene
            .discussed_topics
            .contains(&("c".into(), "t_locked".into())));
    }

    #[test]
    fn interrogation_question_reveal_unlocks_without_answering() {
        let catalog = evidence_catalog("interrogation", &[]);
        let mut scene = interrogation_scene_with_locked_blocks();
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        apply_interrogation_reveals_for_test(
            &mut scene,
            &mut acq,
            None,
            &[InterrogationRevealTarget::Question { id: "q2".into() }],
            "chapter_1",
        )
        .unwrap();

        assert!(scene.unlocked_overrides.contains("question:q2"));
        assert!(!scene.broken_questions.contains("q2"));
    }

    #[test]
    fn interrogation_phase_reveal_unlocks_without_completing() {
        let catalog = evidence_catalog("interrogation", &[]);
        let mut scene = interrogation_scene_with_locked_blocks();
        let mut inv = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut acq = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inv,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        apply_interrogation_reveals_for_test(
            &mut scene,
            &mut acq,
            None,
            &[InterrogationRevealTarget::Phase { id: "p2".into() }],
            "chapter_1",
        )
        .unwrap();

        assert!(scene.unlocked_overrides.contains("phase:p2"));
        assert!(!scene.completed_phases.contains("p2"));
    }
}
