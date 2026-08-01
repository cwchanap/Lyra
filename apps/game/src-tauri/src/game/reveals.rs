// src-tauri/src/game/reveals.rs
use crate::game::acquisition::AcquisitionCtx;
use crate::game::dialogue_queue::{DialogueSegment, DialogueSegmentOriginV1};
use crate::game::scenes::interrogation::InterrogationSceneState;
use crate::game::scenes::investigation::InvestigationSceneState;
use crate::game::schema::{InterrogationRevealTarget, RevealTarget};
use crate::game::GameError;

pub(super) fn apply_reveals_and_build_queue(
    scene: &mut InvestigationSceneState,
    acq: &mut AcquisitionCtx,
    trigger_segment: Option<DialogueSegment>,
    reveals: &[RevealTarget],
    chapter_id: &str,
) -> Result<Vec<DialogueSegment>, GameError> {
    let mut segments: Vec<DialogueSegment> = trigger_segment.into_iter().collect();
    for r in reveals {
        match r {
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

pub(super) fn apply_interrogation_reveals_and_build_queue(
    scene: &mut InterrogationSceneState,
    acq: &mut AcquisitionCtx,
    trigger_segment: Option<DialogueSegment>,
    reveals: &[InterrogationRevealTarget],
    chapter_id: &str,
) -> Result<Vec<DialogueSegment>, GameError> {
    let mut segments: Vec<DialogueSegment> = trigger_segment.into_iter().collect();
    for r in reveals {
        match r {
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
        AutoMarker, DialogueItem, EvidenceJson, InterrogationOutroJson, InterrogationOutroUnlock,
        InterrogationSceneJson, InvestigationSceneJson, OutroJson, OutroUnlock,
    };
    use crate::game::state::Inventory;
    use crate::game::test_support::catalog_with_case_records;

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

        let error = apply_reveals_and_build_queue(
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
        let queue = apply_reveals_and_build_queue(
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
        let queue = apply_reveals_and_build_queue(
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
        let _ = apply_reveals_and_build_queue(
            &mut scene,
            &mut acq,
            None,
            &[RevealTarget::Evidence {
                id: "coffee".into(),
            }],
            "chapter_1",
        )
        .unwrap();
        let queue2 = apply_reveals_and_build_queue(
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
        let queue = apply_reveals_and_build_queue(
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
        let queue = apply_interrogation_reveals_and_build_queue(
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
        let queue = apply_interrogation_reveals_and_build_queue(
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
}
