use super::analysis::AnalysisDraft;
use super::save::capture::{capture_checkpoint, CapturedCheckpoint};
use super::save::restore::{build_restore_candidate, load_current_definitions};
use super::save::schema::{SaveEnvelope, SaveType, ThumbnailDescriptorV1, SAVE_SCHEMA_VERSION};
use super::test_support::analysis_fixture_resources;
use super::view::{AnalysisBoardView, GameStateView, ModeView, SceneView};
use super::{GameEngine, QueueToken};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

fn queue_token(view: &GameStateView) -> QueueToken {
    match view.mode {
        ModeView::Dialogue {
            ref queue_token, ..
        } => queue_token.clone(),
        ref mode => panic!("expected dialogue mode, got {mode:?}"),
    }
}

fn analysis_token(view: &GameStateView) -> super::analysis::AnalysisActionToken {
    match view.scene {
        SceneView::Analysis {
            ref action_token, ..
        } => action_token.clone(),
        ref scene => panic!("expected Analysis scene, got {scene:?}"),
    }
}

fn drain_dialogue(engine: &mut GameEngine) -> Vec<String> {
    let mut lines = Vec::new();
    loop {
        let view = engine.view().unwrap();
        let ModeView::Dialogue { ref current, .. } = view.mode else {
            return lines;
        };
        match current {
            super::schema::DialogueItem::Line { text, .. }
            | super::schema::DialogueItem::Action { text } => lines.push(text.clone()),
            super::schema::DialogueItem::SceneTag { .. } => {}
        }
        engine.advance_dialogue(queue_token(&view)).unwrap();
    }
}

/// Drain exactly one queue generation.  Exhausting an Analysis result queues
/// the authored outro as a fresh generation; stopping at that boundary lets
/// the acceptance flow prove the final outro is consumed by one explicit
/// advance without accidentally replaying the successor scene.
fn drain_dialogue_queue_once(engine: &mut GameEngine) -> Vec<String> {
    let initial = engine.view().unwrap();
    let initial_token = queue_token(&initial);
    let mut lines = Vec::new();
    loop {
        let view = engine.view().unwrap();
        let ModeView::Dialogue { ref current, .. } = view.mode else {
            return lines;
        };
        let token = queue_token(&view);
        if token.queue_gen != initial_token.queue_gen {
            return lines;
        }
        match current {
            super::schema::DialogueItem::Line { text, .. }
            | super::schema::DialogueItem::Action { text } => lines.push(text.clone()),
            super::schema::DialogueItem::SceneTag { .. } => {}
        }
        engine.advance_dialogue(token).unwrap();
    }
}

fn save_envelope(engine: &GameEngine, checkpoint: CapturedCheckpoint) -> SaveEnvelope {
    SaveEnvelope {
        schema_version: SAVE_SCHEMA_VERSION,
        content_revision: engine.content_manifest.content_revision().into(),
        save_id: "550e8400-e29b-41d4-a716-446655440260".into(),
        save_type: SaveType::Manual,
        slot: 1,
        saved_at: "2026-08-10T12:34:56Z".into(),
        display_name: "Analysis acceptance".into(),
        thumbnail: ThumbnailDescriptorV1::Unavailable,
        summary: checkpoint.summary,
        snapshot: checkpoint.snapshot,
    }
}

fn detached_restore(engine: &GameEngine, resources: &Path) -> GameEngine {
    let checkpoint = capture_checkpoint(engine).unwrap();
    let expected_snapshot = checkpoint.snapshot.clone();
    let envelope = save_envelope(engine, checkpoint);
    let save_json = serde_json::to_value(&envelope).unwrap();
    assert_no_answer_keys(&save_json);
    assert!(
        !save_json.to_string().contains("provenance"),
        "save JSON must not carry mutable case-record provenance"
    );
    let definitions = load_current_definitions(resources).unwrap();
    let restored = build_restore_candidate(resources.to_path_buf(), &definitions, envelope)
        .unwrap()
        .engine;
    assert_eq!(
        capture_checkpoint(&restored).unwrap().snapshot,
        expected_snapshot,
        "detached restore must recapture the exact current-format snapshot"
    );
    restored
}

fn board<'a>(view: &'a GameStateView, id: &str) -> &'a AnalysisBoardView {
    let SceneView::Analysis { visible_boards, .. } = &view.scene else {
        panic!("expected Analysis scene")
    };
    visible_boards
        .iter()
        .find(|board| match board {
            AnalysisBoardView::Classify { id: board_id, .. }
            | AnalysisBoardView::Order { id: board_id, .. }
            | AnalysisBoardView::Threshold { id: board_id, .. } => board_id == id,
        })
        .unwrap_or_else(|| panic!("missing board {id}"))
}

fn assert_no_answer_keys(value: &Value) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                assert!(
                    !matches!(
                        key.as_str(),
                        "acceptedGroupByCard" | "acceptedOrder" | "acceptedSelections"
                    ),
                    "answer key leaked in JSON at {key}"
                );
                assert_no_answer_keys(value);
            }
        }
        Value::Array(values) => values.iter().for_each(assert_no_answer_keys),
        _ => {}
    }
}

#[test]
fn analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage() {
    let (_guard, resources) = analysis_fixture_resources();
    let mut engine = GameEngine::new_started(resources.clone()).unwrap();

    assert!(matches!(
        engine.enter_sublocation("room").unwrap().mode,
        ModeView::Explore { .. }
    ));
    let entered_analysis = engine.inspect_hotspot("collect_sources").unwrap();
    assert!(matches!(
        entered_analysis.mode,
        ModeView::Dialogue {
            scene_tag: Some(ref tag),
            ..
        } if tag == "雨鐘後場，相馬臨時整理板前。"
    ));
    let intro = drain_dialogue(&mut engine);
    assert_eq!(intro, vec!["先把我們能證明的東西分開。"]);
    let mut view = engine.view().unwrap();
    assert!(matches!(view.mode, ModeView::Analysis { .. }));
    assert_eq!(
        match &view.scene {
            SceneView::Analysis {
                available_board_ids,
                ..
            } => available_board_ids,
            _ => unreachable!(),
        },
        &vec!["evidence_packages".to_owned()]
    );

    let partial_classify = AnalysisDraft::Classify {
        group_by_card: BTreeMap::from([("miyake_call".into(), "miyake_small_lies".into())]),
    };
    view = engine
        .update_analysis_draft(analysis_token(&view), partial_classify.clone())
        .unwrap();
    assert!(matches!(
        board(&view, "evidence_packages"),
        AnalysisBoardView::Classify { draft, .. } if draft == &partial_classify
    ));

    let before_restore_revision = engine.durable_revision;
    let mut restored = detached_restore(&engine, &resources);
    assert_eq!(restored.durable_revision, before_restore_revision);
    let restored_view = restored.view().unwrap();
    assert!(matches!(
        board(&restored_view, "evidence_packages"),
        AnalysisBoardView::Classify { draft, .. } if draft == &partial_classify
    ));
    assert_no_answer_keys(&serde_json::to_value(&restored_view).unwrap());

    let complete_classify = AnalysisDraft::Classify {
        group_by_card: BTreeMap::from([
            ("miyake_call".into(), "miyake_small_lies".into()),
            ("l_corridor_replay".into(), "earlier_third_party".into()),
            (
                "external_credential_event".into(),
                "earlier_third_party".into(),
            ),
        ]),
    };
    view = restored
        .update_analysis_draft(analysis_token(&restored_view), complete_classify)
        .unwrap();
    assert_eq!(restored.durable_revision, before_restore_revision + 1);
    let classify_submit_revision = restored.durable_revision;
    view = restored
        .submit_analysis_board(analysis_token(&view))
        .unwrap();
    assert_eq!(restored.durable_revision, classify_submit_revision + 1);
    assert!(matches!(view.mode, ModeView::Dialogue { .. }));
    assert!(view
        .story
        .facts
        .iter()
        .any(|fact| fact.id == "miyake_known_lies_are_unrelated_to_murder"));
    assert!(view
        .story
        .facts
        .iter()
        .any(|fact| fact.id == "earlier_external_entry_exists"));
    assert!(matches!(
        board(&view, "evidence_packages"),
        AnalysisBoardView::Classify {
            completed: true,
            read_only: true,
            ..
        }
    ));
    assert_no_answer_keys(&serde_json::to_value(&view).unwrap());
    let classify_result = drain_dialogue(&mut restored);
    assert_eq!(
        classify_result,
        vec![
            "我們洗掉的是三宅那段錯誤故事。",
            "但還沒證明誰該被放回時間線。"
        ]
    );

    view = restored.view().unwrap();
    assert_eq!(
        match &view.scene {
            SceneView::Analysis {
                available_board_ids,
                ..
            } => available_board_ids,
            _ => unreachable!(),
        },
        &vec![
            "evidence_packages".to_owned(),
            "local_event_sequence".to_owned()
        ]
    );

    // A completed board remains selectable for read-only review, while its
    // draft cannot be mutated or submitted again.
    view = restored
        .select_analysis_board(analysis_token(&view), "evidence_packages".into())
        .unwrap();
    assert!(matches!(
        board(&view, "evidence_packages"),
        AnalysisBoardView::Classify {
            completed: true,
            read_only: true,
            ..
        }
    ));
    let read_only_error = restored
        .update_analysis_draft(
            analysis_token(&view),
            AnalysisDraft::Classify {
                group_by_card: BTreeMap::new(),
            },
        )
        .unwrap_err();
    assert_eq!(read_only_error.code, "analysisBoardCompleted");
    let read_only_revision = restored.durable_revision;
    let replay_error = restored
        .submit_analysis_board(analysis_token(&view))
        .unwrap_err();
    assert_eq!(replay_error.code, "analysisBoardCompleted");
    assert_eq!(restored.durable_revision, read_only_revision);
    view = restored
        .select_analysis_board(
            analysis_token(&restored.view().unwrap()),
            "local_event_sequence".into(),
        )
        .unwrap();
    let order_selection_revision = restored.durable_revision;

    let order = AnalysisDraft::Order {
        card_ids: vec![
            "event_1841".into(),
            "event_1842".into(),
            "event_1843".into(),
            "event_1844".into(),
        ],
    };
    view = restored
        .update_analysis_draft(analysis_token(&view), order)
        .unwrap();
    assert_eq!(restored.durable_revision, order_selection_revision + 1);
    let order_submit_revision = restored.durable_revision;
    view = restored
        .submit_analysis_board(analysis_token(&view))
        .unwrap();
    assert_eq!(restored.durable_revision, order_submit_revision + 1);
    assert!(view
        .story
        .facts
        .iter()
        .any(|fact| fact.id == "merge_time_is_not_event_time"));
    let order_result = drain_dialogue(&mut restored);
    assert_eq!(
        order_result,
        vec!["本機只告訴我們先後，沒有告訴我們精確秒數。"]
    );

    view = restored.view().unwrap();
    assert_eq!(
        match &view.scene {
            SceneView::Analysis {
                available_board_ids,
                ..
            } => available_board_ids,
            _ => unreachable!(),
        },
        &vec![
            "evidence_packages".to_owned(),
            "local_event_sequence".to_owned(),
            "narrow_request_basis".to_owned()
        ]
    );
    view = restored
        .select_analysis_board(analysis_token(&view), "narrow_request_basis".into())
        .unwrap();
    let wrong = AnalysisDraft::Threshold {
        selected_card_ids: BTreeSet::from(["phone_notification".into(), "manager_timing".into()]),
    };
    view = restored
        .update_analysis_draft(analysis_token(&view), wrong.clone())
        .unwrap();
    let wrong_submit_revision = restored.durable_revision;
    view = restored
        .submit_analysis_board(analysis_token(&view))
        .unwrap();
    assert_eq!(restored.durable_revision, wrong_submit_revision + 1);
    assert!(
        matches!(board(&view, "narrow_request_basis"), AnalysisBoardView::Threshold { feedback: Some(feedback), .. } if feedback.state == super::analysis::AnalysisFeedbackState::Incorrect)
    );
    assert!(matches!(
        board(&view, "narrow_request_basis"),
        AnalysisBoardView::Threshold { draft, .. } if draft == &wrong
    ));
    assert!(!view
        .story
        .facts
        .iter()
        .any(|fact| fact.id == "two_independent_lock_contradictions_identified"));
    assert!(!view
        .story
        .objectives
        .iter()
        .any(|objective| objective.id == "prepare_narrow_lock_request"));
    let wrong_revision = restored.durable_revision;
    let correct = AnalysisDraft::Threshold {
        selected_card_ids: BTreeSet::from(["lock_sequence".into(), "manager_timing".into()]),
    };
    view = restored
        .update_analysis_draft(analysis_token(&view), correct)
        .unwrap();
    assert_eq!(restored.durable_revision, wrong_revision + 1);
    let correct_submit_revision = restored.durable_revision;
    view = restored
        .submit_analysis_board(analysis_token(&view))
        .unwrap();
    assert_eq!(restored.durable_revision, correct_submit_revision + 1);
    assert!(matches!(view.mode, ModeView::Dialogue { .. }));
    assert!(view
        .story
        .facts
        .iter()
        .any(|fact| fact.id == "two_independent_lock_contradictions_identified"));
    assert!(view
        .story
        .objectives
        .iter()
        .any(|objective| objective.id == "prepare_narrow_lock_request" && objective.completed));
    assert!(matches!(
        board(&view, "narrow_request_basis"),
        AnalysisBoardView::Threshold {
            completed: true,
            read_only: true,
            ..
        }
    ));
    assert_eq!(
        match &view.scene {
            SceneView::Analysis {
                available_board_ids,
                ..
            } => available_board_ids,
            _ => unreachable!(),
        },
        &vec![
            "evidence_packages".to_owned(),
            "local_event_sequence".to_owned(),
            "narrow_request_basis".to_owned()
        ]
    );

    let mid_result_revision = restored.durable_revision;
    let mut restored_mid_result = detached_restore(&restored, &resources);
    assert_eq!(restored_mid_result.durable_revision, mid_result_revision);
    let mid_view = restored_mid_result.view().unwrap();
    assert!(matches!(mid_view.mode, ModeView::Dialogue { .. }));
    let result_lines = drain_dialogue_queue_once(&mut restored_mid_result);
    assert_eq!(
        result_lines,
        vec!["現在有兩條獨立矛盾，可以把申請送進審查。"]
    );
    let outro_lines = drain_dialogue_queue_once(&mut restored_mid_result);
    assert_eq!(
        outro_lines,
        vec!["我們只證明了第三者存在。下一步才是把那個空位填上。"]
    );
    let successor = restored_mid_result.view().unwrap();
    assert!(matches!(
        successor.scene,
        SceneView::Linear { ref id, .. } if id == "analysis_after"
    ));
    let final_checkpoint = capture_checkpoint(&restored_mid_result).unwrap();
    let final_story = serde_json::to_value(final_checkpoint.snapshot.story_state).unwrap();
    assert_eq!(
        final_story["completedAnalysisBoards"],
        serde_json::json!([
            {
                "chapterId": "chapter_1",
                "sceneId": "analysis_scene_8_5",
                "boardId": "evidence_packages"
            },
            {
                "chapterId": "chapter_1",
                "sceneId": "analysis_scene_8_5",
                "boardId": "local_event_sequence"
            },
            {
                "chapterId": "chapter_1",
                "sceneId": "analysis_scene_8_5",
                "boardId": "narrow_request_basis"
            }
        ])
    );
    assert_eq!(
        final_story["completedAnalysisScenes"],
        serde_json::json!([{"chapterId":"chapter_1","sceneId":"analysis_scene_8_5"}])
    );
    assert!(matches!(
        successor.mode,
        ModeView::Dialogue { ref current, .. }
            if matches!(current, super::schema::DialogueItem::Action { text } if text == "analysis complete")
    ));
    assert_no_answer_keys(&serde_json::to_value(&successor).unwrap());
}
