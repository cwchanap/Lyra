use super::analysis::AnalysisDraft;
use super::schema::DialogueItem;
use super::{GameEngine, GameError, ModeView, SceneView};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const MAX_REPLAY_OPERATIONS: usize = 640;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub(crate) enum CheckpointId {
    #[serde(rename = "chapter-1-right-portrait-dialogue")]
    RightPortraitDialogue,
    #[serde(rename = "chapter-1-investigation-explore")]
    InvestigationExplore,
    #[serde(rename = "chapter-1-investigation-with-kagami-summary")]
    InvestigationWithKagamiSummary,
    #[serde(rename = "chapter-1-scene-navigation-locked")]
    SceneNavigationLocked,
    #[serde(rename = "chapter-1-scene-navigation-eligible")]
    SceneNavigationEligible,
    #[serde(rename = "chapter-1-analysis-beat-85-ready")]
    Chapter1AnalysisBeat85Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CheckpointMode {
    Dialogue,
    Explore,
    Interrogation,
    Analysis,
    GameComplete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DialogueKind {
    SceneTag,
    Action,
    Line,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DialogueIdentity {
    pub(crate) kind: DialogueKind,
    pub(crate) speaker: Option<String>,
    pub(crate) text: String,
    pub(crate) portrait_character_id: Option<String>,
    pub(crate) portrait_expression: Option<String>,
    pub(crate) portrait_asset_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObjectiveIdentity {
    pub(crate) id: String,
    pub(crate) completed: bool,
    pub(crate) active_primary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PendingRecordKind {
    Evidence,
    Statement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingAcquisitionIdentity {
    pub(crate) record_kind: PendingRecordKind,
    pub(crate) record_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckpointProjection {
    pub(crate) chapter_id: String,
    pub(crate) scene_id: String,
    pub(crate) mode: CheckpointMode,
    pub(crate) dialogue: Option<DialogueIdentity>,
    pub(crate) sublocation_id: Option<String>,
    pub(crate) evidence_ids: Vec<String>,
    pub(crate) statement_ids: Vec<String>,
    pub(crate) objectives: Vec<ObjectiveIdentity>,
    pub(crate) authorization_ids: Vec<String>,
    pub(crate) pending_acquisition: Option<PendingAcquisitionIdentity>,
    pub(crate) scene_navigation_eligible: bool,
    pub(crate) durable_revision: u64,
}

pub(crate) struct BuiltCheckpoint {
    pub(crate) engine: GameEngine,
    pub(crate) projection: CheckpointProjection,
}

pub(crate) fn build_checkpoint(
    resources_dir: PathBuf,
    id: CheckpointId,
) -> Result<BuiltCheckpoint, GameError> {
    build_checkpoint_with_limit(resources_dir, id, MAX_REPLAY_OPERATIONS)
}

fn build_checkpoint_with_limit(
    resources_dir: PathBuf,
    id: CheckpointId,
    replay_limit: usize,
) -> Result<BuiltCheckpoint, GameError> {
    let mut engine = GameEngine::new_started(resources_dir)?;
    match id {
        CheckpointId::RightPortraitDialogue => {
            let mut operations = 0;
            loop {
                let view = engine.view()?;
                let found = matches!(
                    &view.mode,
                    ModeView::Dialogue {
                        current: DialogueItem::Line {
                            portrait: Some(portrait),
                            ..
                        },
                        ..
                    } if portrait.character_id == "soma_ritsu"
                );
                if found {
                    return Ok(BuiltCheckpoint {
                        projection: project(&engine, &view, false),
                        engine,
                    });
                }
                advance_dialogue_bounded(&mut engine, view, &mut operations, replay_limit)?;
            }
        }
        CheckpointId::InvestigationExplore
        | CheckpointId::SceneNavigationLocked
        | CheckpointId::SceneNavigationEligible => {
            let mut operations = 0;
            let view = replay_to_investigation_explore(&mut engine, &mut operations, replay_limit)?;
            let eligible = id == CheckpointId::SceneNavigationEligible;
            Ok(BuiltCheckpoint {
                projection: project(&engine, &view, eligible),
                engine,
            })
        }
        CheckpointId::InvestigationWithKagamiSummary => {
            let mut operations = 0;
            replay_to_investigation_explore(&mut engine, &mut operations, replay_limit)?;
            ensure_operation_available(operations, replay_limit)?;
            let view = engine.view()?;
            let has_anchor = matches!(
                &view.scene,
                SceneView::Investigation {
                    visible_sublocations,
                    ..
                } if visible_sublocations.iter().any(|sublocation| {
                    sublocation.hotspots.iter().any(|hotspot| {
                        hotspot.id == "kagami_summary_hotspot"
                    })
                })
            );
            if !has_anchor {
                return Err(GameError::e2e_checkpoint_anchor_missing());
            }
            engine.inspect_hotspot("kagami_summary_hotspot")?;
            operations += 1;
            loop {
                let view = engine.view()?;
                if matches!(view.mode, ModeView::Explore { .. })
                    && view
                        .pending_acquisition
                        .as_ref()
                        .is_some_and(|pending| pending.record_id == "kagami_summary")
                {
                    return Ok(BuiltCheckpoint {
                        projection: project(&engine, &view, false),
                        engine,
                    });
                }
                advance_dialogue_bounded(&mut engine, view, &mut operations, replay_limit)?;
            }
        }
        CheckpointId::Chapter1AnalysisBeat85Ready => {
            let mut operations = 0;
            engine.jump_to_scene("chapter_1", "analysis_scene_8_5")?;

            // The ready state is intentionally assembled through the same
            // packaged scene/navigation and AcquisitionCtx path used by
            // debug scene jumps. It does not add a production seed API or
            // mutate authored story definitions.
            let acquisition_event_baseline = engine.pending_acquisition_events.len();
            let mut next_ordinal = 0;
            let command_id = engine.durable_revision();
            engine.grant_beat85_pre_hearing_evidence_for_testing(command_id, &mut next_ordinal);
            engine
                .pending_acquisition_events
                .truncate(acquisition_event_baseline);

            let view = replay_to_analysis_ready(&mut engine, &mut operations, replay_limit)?;
            Ok(BuiltCheckpoint {
                projection: project(&engine, &view, true),
                engine,
            })
        }
    }
}

fn replay_to_investigation_explore(
    engine: &mut GameEngine,
    operations: &mut usize,
    replay_limit: usize,
) -> Result<super::GameStateView, GameError> {
    loop {
        let view = engine.view()?;
        let at_target = matches!(
            (&view.scene, &view.mode),
            (
                SceneView::Investigation { id, .. },
                ModeView::Explore { sublocation_id, .. }
            ) if id == "investigation_scene_1" && sublocation_id.as_deref() == Some("office")
        );
        if at_target {
            return Ok(view);
        }
        advance_dialogue_bounded(engine, view, operations, replay_limit)?;
    }
}

fn replay_to_analysis_ready(
    engine: &mut GameEngine,
    operations: &mut usize,
    replay_limit: usize,
) -> Result<super::GameStateView, GameError> {
    loop {
        let view = engine.view()?;
        let at_target = matches!(
            (&view.scene, &view.mode),
            (
                SceneView::Analysis { id, .. },
                ModeView::Analysis { board_id, .. }
            ) if id == "analysis_scene_8_5" && board_id == "evidence_packages"
        );
        if at_target {
            return Ok(view);
        }
        advance_dialogue_bounded(engine, view, operations, replay_limit)?;
    }
}

fn advance_dialogue_bounded(
    engine: &mut GameEngine,
    view: super::GameStateView,
    operations: &mut usize,
    replay_limit: usize,
) -> Result<(), GameError> {
    match view.mode {
        ModeView::Dialogue { queue_token, .. } => {
            ensure_operation_available(*operations, replay_limit)?;
            engine.advance_dialogue(queue_token)?;
            *operations += 1;
            Ok(())
        }
        ModeView::Explore { sublocation_id, .. } => {
            let SceneView::Investigation {
                visible_sublocations,
                ..
            } = &view.scene
            else {
                return Err(GameError::e2e_checkpoint_unreachable());
            };
            let Some(sublocation_id) = sublocation_id.as_deref() else {
                // Only a mapped pending state has no current sublocation; the
                // checkpoint driver has no destination to act on there.
                return Err(GameError::e2e_checkpoint_unreachable());
            };
            let hotspot_id = visible_sublocations
                .iter()
                .find(|sublocation| sublocation.id == sublocation_id)
                .and_then(|sublocation| {
                    sublocation
                        .hotspots
                        .iter()
                        .find(|hotspot| !hotspot.inspected)
                })
                .map(|hotspot| hotspot.id.clone())
                .ok_or_else(GameError::e2e_checkpoint_unreachable)?;
            ensure_operation_available(*operations, replay_limit)?;
            engine.inspect_hotspot(&hotspot_id)?;
            *operations += 1;
            Ok(())
        }
        ModeView::Analysis { board_id, .. } if board_id == "p1_reprint_time_board" => {
            ensure_operation_available(*operations, replay_limit)?;
            engine.update_analysis_draft(
                engine.analysis_action_token()?,
                AnalysisDraft::Threshold {
                    selected_card_ids: [
                        "receipt_reprint".to_owned(),
                        "register_paper_jam".to_owned(),
                        "handwritten_ledger".to_owned(),
                    ]
                    .into_iter()
                    .collect(),
                },
            )?;
            *operations += 1;
            ensure_operation_available(*operations, replay_limit)?;
            engine.submit_analysis_board(engine.analysis_action_token()?)?;
            *operations += 1;
            Ok(())
        }
        ModeView::Analysis { .. } | ModeView::Interrogation { .. } | ModeView::GameComplete => {
            Err(GameError::e2e_checkpoint_unreachable())
        }
    }
}

fn ensure_operation_available(operations: usize, replay_limit: usize) -> Result<(), GameError> {
    if operations >= replay_limit {
        Err(GameError::e2e_checkpoint_replay_limit_exceeded())
    } else {
        Ok(())
    }
}

fn project(
    engine: &GameEngine,
    view: &super::GameStateView,
    scene_navigation_eligible: bool,
) -> CheckpointProjection {
    let scene_id = match &view.scene {
        SceneView::Linear { id, .. }
        | SceneView::Investigation { id, .. }
        | SceneView::Interrogation { id, .. }
        | SceneView::Analysis { id, .. } => id.clone(),
    };
    let (mode, dialogue, sublocation_id) = match &view.mode {
        ModeView::Dialogue { current, .. } => {
            let identity = match current {
                DialogueItem::SceneTag { text, .. } => DialogueIdentity {
                    kind: DialogueKind::SceneTag,
                    speaker: None,
                    text: text.clone(),
                    portrait_character_id: None,
                    portrait_expression: None,
                    portrait_asset_id: None,
                },
                DialogueItem::Action { text } => DialogueIdentity {
                    kind: DialogueKind::Action,
                    speaker: None,
                    text: text.clone(),
                    portrait_character_id: None,
                    portrait_expression: None,
                    portrait_asset_id: None,
                },
                DialogueItem::Line {
                    speaker,
                    text,
                    portrait,
                } => DialogueIdentity {
                    kind: DialogueKind::Line,
                    speaker: Some(speaker.clone()),
                    text: text.clone(),
                    portrait_character_id: portrait
                        .as_ref()
                        .map(|portrait| portrait.character_id.clone()),
                    portrait_expression: portrait
                        .as_ref()
                        .map(|portrait| portrait.expression.clone()),
                    portrait_asset_id: portrait.as_ref().map(|portrait| portrait.asset_id.clone()),
                },
            };
            (CheckpointMode::Dialogue, Some(identity), None)
        }
        ModeView::Explore { sublocation_id, .. } => {
            (CheckpointMode::Explore, None, sublocation_id.clone())
        }
        ModeView::Interrogation { .. } => (CheckpointMode::Interrogation, None, None),
        ModeView::Analysis { .. } => (CheckpointMode::Analysis, None, None),
        ModeView::GameComplete => (CheckpointMode::GameComplete, None, None),
    };
    let mut evidence_ids = view
        .inventory
        .evidence
        .iter()
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    evidence_ids.sort();
    let mut statement_ids = view
        .inventory
        .statements
        .iter()
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    statement_ids.sort();
    let mut objectives = view
        .story
        .objectives
        .iter()
        .map(|objective| ObjectiveIdentity {
            id: objective.id.clone(),
            completed: objective.completed,
            active_primary: objective.active_primary,
        })
        .collect::<Vec<_>>();
    objectives.sort_by(|left, right| left.id.cmp(&right.id));
    let mut authorization_ids = view
        .story
        .authorizations
        .iter()
        .map(|authorization| authorization.id.clone())
        .collect::<Vec<_>>();
    authorization_ids.sort();
    let pending_acquisition =
        view.pending_acquisition
            .as_ref()
            .map(|pending| PendingAcquisitionIdentity {
                record_kind: match pending.record_kind {
                    super::save::schema::RecordKind::Evidence => PendingRecordKind::Evidence,
                    super::save::schema::RecordKind::Statement => PendingRecordKind::Statement,
                },
                record_id: pending.record_id.clone(),
            });
    CheckpointProjection {
        chapter_id: view.chapter.id.clone(),
        scene_id,
        mode,
        dialogue,
        sublocation_id,
        evidence_ids,
        statement_ids,
        objectives,
        authorization_ids,
        pending_acquisition,
        scene_navigation_eligible,
        durable_revision: engine.durable_revision(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    fn production_resources() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/scenes")
    }

    fn copied_production_resources() -> tempfile::TempDir {
        fn copy_tree(source: &std::path::Path, destination: &std::path::Path) {
            std::fs::create_dir_all(destination).unwrap();
            for entry in std::fs::read_dir(source).unwrap() {
                let entry = entry.unwrap();
                let target = destination.join(entry.file_name());
                if entry.file_type().unwrap().is_dir() {
                    copy_tree(&entry.path(), &target);
                } else {
                    std::fs::copy(entry.path(), target).unwrap();
                }
            }
        }

        let copy = tempfile::tempdir().unwrap();
        copy_tree(&production_resources(), copy.path());
        copy
    }

    fn checkpoint_error(result: Result<BuiltCheckpoint, GameError>) -> GameError {
        match result {
            Ok(_) => panic!("checkpoint unexpectedly succeeded"),
            Err(error) => error,
        }
    }

    #[test]
    fn checkpoint_ids_have_exact_explicit_wire_names_and_reject_unknown_ids() {
        let cases = [
            (
                CheckpointId::RightPortraitDialogue,
                "chapter-1-right-portrait-dialogue",
            ),
            (
                CheckpointId::InvestigationExplore,
                "chapter-1-investigation-explore",
            ),
            (
                CheckpointId::InvestigationWithKagamiSummary,
                "chapter-1-investigation-with-kagami-summary",
            ),
            (
                CheckpointId::SceneNavigationLocked,
                "chapter-1-scene-navigation-locked",
            ),
            (
                CheckpointId::SceneNavigationEligible,
                "chapter-1-scene-navigation-eligible",
            ),
            (
                CheckpointId::Chapter1AnalysisBeat85Ready,
                "chapter-1-analysis-beat-85-ready",
            ),
        ];

        for (id, wire) in cases {
            assert_eq!(serde_json::to_value(id).unwrap(), json!(wire));
            assert_eq!(
                serde_json::from_value::<CheckpointId>(json!(wire)).unwrap(),
                id
            );
        }

        assert!(serde_json::from_value::<CheckpointId>(json!("chapter-1-unknown")).is_err());
    }

    #[test]
    fn analysis_beat85_ready_checkpoint_seeds_the_packaged_analysis_board() {
        let checkpoint = build_checkpoint_with_limit(
            production_resources(),
            CheckpointId::Chapter1AnalysisBeat85Ready,
            MAX_REPLAY_OPERATIONS,
        )
        .unwrap();

        assert_eq!(checkpoint.projection.chapter_id, "chapter_1");
        assert_eq!(checkpoint.projection.scene_id, "analysis_scene_8_5");
        assert_eq!(checkpoint.projection.mode, CheckpointMode::Analysis);
        assert_eq!(checkpoint.projection.pending_acquisition, None);
        assert!(checkpoint.projection.scene_navigation_eligible);
        let expected_pre_hearing_evidence = vec![
            "closing_routine".to_owned(),
            "doorlock_summary_timetable".to_owned(),
            "external_maintenance_credential".to_owned(),
            "local_sequence_record".to_owned(),
            "miyake_mother_call_confirmation".to_owned(),
            "miyake_pov_replay".to_owned(),
            "victim_phone_notification".to_owned(),
        ];
        assert_eq!(
            checkpoint.projection.evidence_ids,
            expected_pre_hearing_evidence
        );
        assert!(!checkpoint
            .projection
            .evidence_ids
            .contains(&"approved_clip".to_owned()));
        assert!(checkpoint.projection.statement_ids.is_empty());

        let view = checkpoint.engine.view().unwrap();
        let ModeView::Analysis { board_id, .. } = view.mode else {
            panic!("analysis beat 8.5 checkpoint must open the analysis workbench");
        };
        assert_eq!(board_id, "evidence_packages");
    }

    #[test]
    fn analysis_beat85_hearing_jump_does_not_seed_approved_clip() {
        let mut checkpoint = build_checkpoint_with_limit(
            production_resources(),
            CheckpointId::Chapter1AnalysisBeat85Ready,
            MAX_REPLAY_OPERATIONS,
        )
        .unwrap();

        let view = checkpoint
            .engine
            .jump_to_scene("chapter_1", "interrogation_scene_10")
            .unwrap();
        assert!(matches!(view.scene, SceneView::Interrogation { .. }));
        let mut evidence_ids = view
            .inventory
            .evidence
            .iter()
            .map(|record| record.id.clone())
            .collect::<Vec<_>>();
        evidence_ids.sort();
        assert_eq!(
            evidence_ids,
            vec![
                "closing_routine",
                "doorlock_summary_timetable",
                "external_maintenance_credential",
                "local_sequence_record",
                "miyake_mother_call_confirmation",
                "miyake_pov_replay",
                "victim_phone_notification",
            ]
        );
        assert!(!view
            .inventory
            .evidence
            .iter()
            .any(|record| record.id == "approved_clip"));
        assert!(view.inventory.statements.is_empty());
        assert!(view
            .story
            .authorizations
            .iter()
            .all(|authorization| authorization.id != "narrow_lock_export"));
    }

    #[test]
    fn right_portrait_checkpoint_replays_to_the_real_soma_dialogue_anchor() {
        let checkpoint = build_checkpoint_with_limit(
            production_resources(),
            CheckpointId::RightPortraitDialogue,
            MAX_REPLAY_OPERATIONS,
        )
        .unwrap();

        assert_eq!(checkpoint.projection.chapter_id, "chapter_1");
        assert_eq!(checkpoint.projection.scene_id, "investigation_scene_p1");
        assert_eq!(checkpoint.projection.mode, CheckpointMode::Dialogue);
        assert_eq!(
            checkpoint.projection.dialogue,
            Some(DialogueIdentity {
                kind: DialogueKind::Line,
                speaker: Some("相馬律".into()),
                text: "……就是這家。".into(),
                portrait_character_id: Some("soma_ritsu".into()),
                portrait_expression: Some("standard".into()),
                portrait_asset_id: Some("portrait.soma_ritsu.standard".into()),
            })
        );
        assert!(!checkpoint.projection.scene_navigation_eligible);
        assert_eq!(
            checkpoint.projection.durable_revision,
            checkpoint.engine.durable_revision()
        );
    }

    #[test]
    fn investigation_and_navigation_targets_replay_real_semantics_and_normalize_projection() {
        let explore = build_checkpoint_with_limit(
            production_resources(),
            CheckpointId::InvestigationExplore,
            MAX_REPLAY_OPERATIONS,
        )
        .unwrap();
        assert_eq!(explore.projection.chapter_id, "chapter_1");
        assert_eq!(explore.projection.scene_id, "investigation_scene_1");
        assert_eq!(explore.projection.mode, CheckpointMode::Explore);
        assert_eq!(explore.projection.sublocation_id.as_deref(), Some("office"));
        assert_eq!(explore.projection.evidence_ids, Vec::<String>::new());
        assert_eq!(explore.projection.statement_ids, Vec::<String>::new());
        assert_eq!(
            explore.projection.objectives,
            Vec::<ObjectiveIdentity>::new()
        );
        assert_eq!(explore.projection.authorization_ids, Vec::<String>::new());
        assert_eq!(explore.projection.pending_acquisition, None);

        let with_summary = build_checkpoint_with_limit(
            production_resources(),
            CheckpointId::InvestigationWithKagamiSummary,
            MAX_REPLAY_OPERATIONS,
        )
        .unwrap();
        assert_eq!(with_summary.projection.mode, CheckpointMode::Explore);
        assert_eq!(with_summary.projection.evidence_ids, ["kagami_summary"]);
        assert_eq!(
            with_summary.projection.pending_acquisition,
            Some(PendingAcquisitionIdentity {
                record_kind: PendingRecordKind::Evidence,
                record_id: "kagami_summary".into(),
            })
        );
        assert!(
            with_summary.projection.durable_revision > explore.projection.durable_revision,
            "real hotspot inspection and dialogue drains must advance durable state"
        );
        let summary_view = with_summary.engine.view().unwrap();
        let SceneView::Investigation {
            visible_sublocations,
            ..
        } = summary_view.scene
        else {
            panic!("summary checkpoint must remain in investigation");
        };
        assert!(visible_sublocations.iter().any(|sublocation| {
            sublocation.characters.iter().any(|character| {
                character.id == "hayasaka"
                    && character
                        .topics
                        .iter()
                        .any(|topic| topic.id == "commission")
            })
        }));

        let locked = build_checkpoint_with_limit(
            production_resources(),
            CheckpointId::SceneNavigationLocked,
            MAX_REPLAY_OPERATIONS,
        )
        .unwrap();
        let eligible = build_checkpoint_with_limit(
            production_resources(),
            CheckpointId::SceneNavigationEligible,
            MAX_REPLAY_OPERATIONS,
        )
        .unwrap();
        assert!(!locked.projection.scene_navigation_eligible);
        assert!(eligible.projection.scene_navigation_eligible);
        assert_eq!(locked.projection.chapter_id, eligible.projection.chapter_id);
        assert_eq!(locked.projection.scene_id, eligible.projection.scene_id);
        assert_eq!(locked.projection.mode, eligible.projection.mode);
        assert_eq!(
            locked.projection.durable_revision,
            eligible.projection.durable_revision
        );
    }

    #[test]
    fn projection_has_the_exact_stable_normalized_wire_shape() {
        let checkpoint = build_checkpoint_with_limit(
            production_resources(),
            CheckpointId::RightPortraitDialogue,
            MAX_REPLAY_OPERATIONS,
        )
        .unwrap();
        let durable_revision = checkpoint.engine.durable_revision();

        assert_eq!(
            serde_json::to_value(checkpoint.projection).unwrap(),
            json!({
                "chapterId": "chapter_1",
                "sceneId": "investigation_scene_p1",
                "mode": "dialogue",
                "dialogue": {
                    "kind": "line",
                    "speaker": "相馬律",
                    "text": "……就是這家。",
                    "portraitCharacterId": "soma_ritsu",
                    "portraitExpression": "standard",
                    "portraitAssetId": "portrait.soma_ritsu.standard"
                },
                "sublocationId": null,
                "evidenceIds": [],
                "statementIds": [],
                "objectives": [],
                "authorizationIds": [],
                "pendingAcquisition": null,
                "sceneNavigationEligible": false,
                "durableRevision": durable_revision
            })
        );
    }

    #[test]
    fn replay_limit_missing_anchor_and_unreachable_target_fail_with_distinct_diagnostics() {
        let cap = checkpoint_error(build_checkpoint_with_limit(
            production_resources(),
            CheckpointId::InvestigationExplore,
            2,
        ));
        assert_eq!(cap.code, "e2eCheckpointReplayLimitExceeded");

        let missing = copied_production_resources();
        let scene_path = missing.path().join("chapter_1/investigation_scene_1.json");
        let mut scene: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&scene_path).unwrap()).unwrap();
        scene["sublocations"][0]["hotspots"]
            .as_array_mut()
            .unwrap()
            .retain(|hotspot| hotspot["id"] != "kagami_summary_hotspot");
        std::fs::write(&scene_path, serde_json::to_vec_pretty(&scene).unwrap()).unwrap();
        let missing_anchor = checkpoint_error(build_checkpoint_with_limit(
            missing.path().to_path_buf(),
            CheckpointId::InvestigationWithKagamiSummary,
            MAX_REPLAY_OPERATIONS,
        ));
        assert_eq!(missing_anchor.code, "e2eCheckpointAnchorMissing");

        fn remove_soma_portraits(value: &mut serde_json::Value) {
            match value {
                serde_json::Value::Array(items) => {
                    for item in items {
                        remove_soma_portraits(item);
                    }
                }
                serde_json::Value::Object(object) => {
                    let remove = object
                        .get("portrait")
                        .is_some_and(|portrait| portrait["characterId"] == json!("soma_ritsu"));
                    if remove {
                        object.remove("portrait");
                    }
                    for nested in object.values_mut() {
                        remove_soma_portraits(nested);
                    }
                }
                _ => {}
            }
        }
        let unreachable = copied_production_resources();
        let chapter_dir = unreachable.path().join("chapter_1");
        for entry in std::fs::read_dir(chapter_dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                continue;
            }
            let mut scene: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            remove_soma_portraits(&mut scene);
            std::fs::write(path, serde_json::to_vec_pretty(&scene).unwrap()).unwrap();
        }
        let unreachable = checkpoint_error(build_checkpoint_with_limit(
            unreachable.path().to_path_buf(),
            CheckpointId::RightPortraitDialogue,
            MAX_REPLAY_OPERATIONS,
        ));
        assert_eq!(unreachable.code, "e2eCheckpointUnreachable");
    }
}
