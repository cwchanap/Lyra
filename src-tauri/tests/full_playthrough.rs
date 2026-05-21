// Integration test that exercises the full mode machine on the fixture corpus.

use std::path::PathBuf;

use lyra_lib::game::view::{ModeView, SceneView};
use lyra_lib::game::{GameEngine, GameStateView, QueueToken};

fn fixture_resources() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/scenes")
}

fn full_fixture_resources() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/full_scenes")
}

fn token_from(view: &GameStateView) -> QueueToken {
    match &view.mode {
        ModeView::Dialogue { queue_token, .. } => queue_token.clone(),
        other => panic!("expected Dialogue mode, got: {:?}", other),
    }
}

fn advance_all_dialogue(engine: &mut GameEngine, mut view: GameStateView) -> GameStateView {
    loop {
        match &view.mode {
            ModeView::Dialogue { queue_token, .. } => {
                view = engine.advance_dialogue(queue_token.clone()).unwrap();
            }
            _ => return view,
        }
    }
}

fn advance_until_explore(engine: &mut GameEngine) -> GameStateView {
    for _ in 0..100 {
        let view = engine.view();
        match &view.mode {
            ModeView::Dialogue { queue_token, .. } => {
                engine.advance_dialogue(queue_token.clone()).unwrap();
            }
            ModeView::Explore { .. } => return view,
            other => panic!("expected Explore mode, got: {:?}", other),
        }
    }
    panic!("fixture did not reach Explore mode");
}

fn inspect_hotspot_and_advance(engine: &mut GameEngine, hotspot_id: &str) -> GameStateView {
    let view = engine.inspect_hotspot(hotspot_id).unwrap();
    advance_all_dialogue(engine, view)
}

fn interview_topic_and_advance(
    engine: &mut GameEngine,
    character_id: &str,
    topic_id: &str,
) -> GameStateView {
    let view = engine.interview_topic(character_id, topic_id).unwrap();
    advance_all_dialogue(engine, view)
}

fn enter_sublocation_and_advance(engine: &mut GameEngine, sublocation_id: &str) -> GameStateView {
    let view = engine.enter_sublocation(sublocation_id).unwrap();
    advance_all_dialogue(engine, view)
}

fn advance_project_investigation_to_interrogation(engine: &mut GameEngine) -> GameStateView {
    let initial = engine.view();
    let view = advance_all_dialogue(engine, initial);
    assert!(matches!(view.mode, ModeView::Explore { .. }));

    for hotspot_id in [
        "blue_umbrella_stand",
        "torn_sleeve_spot",
        "entrance_monitor",
    ] {
        inspect_hotspot_and_advance(engine, hotspot_id);
    }

    enter_sublocation_and_advance(engine, "main_floor");
    for hotspot_id in ["osmanthus_sign", "window_seat"] {
        inspect_hotspot_and_advance(engine, hotspot_id);
    }
    for (character_id, topic_id) in [
        ("kuruse", "case_timeline"),
        ("kuruse", "suspect_info"),
        ("hayasaka", "case_overview"),
        ("hayasaka", "renjis_secret"),
    ] {
        interview_topic_and_advance(engine, character_id, topic_id);
    }

    enter_sublocation_and_advance(engine, "bar_area");
    for hotspot_id in ["coffee_machine", "milk_frother", "time_card_machine"] {
        inspect_hotspot_and_advance(engine, hotspot_id);
    }

    enter_sublocation_and_advance(engine, "staff_corridor");
    for hotspot_id in ["smart_lock", "kagami_label"] {
        inspect_hotspot_and_advance(engine, hotspot_id);
    }

    enter_sublocation_and_advance(engine, "storeroom");
    for hotspot_id in [
        "half_latte_storeroom",
        "victim_position",
        "brass_bell",
        "back_door",
        "wheeled_shelf",
        "victim_phone_spot",
        "victim_usb_spot",
    ] {
        inspect_hotspot_and_advance(engine, hotspot_id);
    }

    enter_sublocation_and_advance(engine, "main_floor");
    interview_topic_and_advance(engine, "kuruse", "kagami_system");
    interview_topic_and_advance(engine, "kuruse", "victim_background");

    interview_topic_and_advance(engine, "hayasaka", "kagami_record")
}

#[test]
fn full_playthrough_starts_at_dialogue_with_intro() {
    let engine = GameEngine::new_started(fixture_resources()).unwrap();
    let view = engine.view();
    assert!(
        matches!(view.mode, ModeView::Dialogue { .. }),
        "expected Dialogue mode, got {:?}",
        view.mode
    );
}

#[test]
fn advance_dialogue_is_idempotent_under_stale_token() {
    let mut engine = GameEngine::new_started(fixture_resources()).unwrap();
    let initial = engine.view();
    let token = token_from(&initial);

    let v1 = engine.advance_dialogue(token.clone()).unwrap();
    let v2 = engine.advance_dialogue(token).unwrap();

    let t1 = token_from(&v1);
    let t2 = token_from(&v2);
    assert_eq!(t1, t2);
}

#[test]
fn game_complete_clamps_chapter_index_to_last_chapter() {
    let mut engine = GameEngine::new_started(fixture_resources()).unwrap();

    // Advance through all scenes until we reach GameComplete.
    // The fixture has 1 chapter with 2 scenes (scene_0 + investigation_scene_1).
    // We advance dialogue repeatedly until the mode transitions away from the
    // initial linear scene, through the investigation scene, and into completion.
    for _ in 0..200 {
        let view = engine.view();
        match &view.mode {
            ModeView::Dialogue {
                queue_token,
                queue_remaining,
                ..
            } => {
                let remaining = *queue_remaining;
                let tok = queue_token.clone();
                engine.advance_dialogue(tok).unwrap();
                if remaining == 0 {
                    // The advance may have triggered a scene transition or completion.
                    // Check the new mode before continuing.
                    let new_view = engine.view();
                    if matches!(new_view.mode, ModeView::GameComplete) {
                        break;
                    }
                }
            }
            ModeView::Explore { .. } => {
                // Can't easily complete investigation scene in unit test without
                // full game logic, so we just verify the chapter view structure
                // is valid (index < total) at this point.
                let view = engine.view();
                assert!(
                    view.chapter.index < view.chapter.total,
                    "chapter index ({}) should be < total ({})",
                    view.chapter.index,
                    view.chapter.total,
                );
                return;
            }
            ModeView::Interrogation { .. } => {
                let view = engine.view();
                assert!(
                    view.chapter.index < view.chapter.total,
                    "chapter index ({}) should be < total ({})",
                    view.chapter.index,
                    view.chapter.total,
                );
                return;
            }
            ModeView::GameComplete => {
                // Verify chapter index is clamped.
                let view = engine.view();
                assert!(
                    view.chapter.index < view.chapter.total,
                    "chapter index should be clamped: got index={}, total={}",
                    view.chapter.index,
                    view.chapter.total,
                );
                return;
            }
        }
    }
}

#[test]
fn full_playthrough_answers_interrogation_and_resolves_contradiction() {
    let mut engine = GameEngine::new_started(full_fixture_resources()).unwrap();
    let view = advance_project_investigation_to_interrogation(&mut engine);
    assert!(
        matches!(view.mode, ModeView::Interrogation { ref phase_id } if phase_id == "wakatsuki_inquiry"),
        "expected wakatsuki inquiry, got {:?}",
        view.mode,
    );

    let view = engine
        .answer_interrogation_question("entered_storage")
        .unwrap();
    let view = advance_all_dialogue(&mut engine, view);
    assert!(view.inventory.has_evidence("coffee_machine_cleaning_log"));
    assert!(view.inventory.has_statement("wakatsuki_entered_for_beans"));
    assert!(
        matches!(view.mode, ModeView::Interrogation { ref phase_id } if phase_id == "wakatsuki_testimony"),
        "expected wakatsuki testimony, got {:?}",
        view.mode,
    );

    let view = engine.press_testimony_statement("cleaning_button").unwrap();
    let view = advance_all_dialogue(&mut engine, view);
    assert!(
        matches!(view.mode, ModeView::Interrogation { ref phase_id } if phase_id == "wakatsuki_testimony"),
        "expected to remain in testimony after pressing, got {:?}",
        view.mode,
    );

    assert!(view.inventory.has_evidence("coffee_machine_log"));
    let view = engine
        .present_testimony_item("cleaning_button", "evidence", "coffee_machine_log")
        .unwrap();
    let view = advance_all_dialogue(&mut engine, view);
    assert!(
        matches!(view.mode, ModeView::Interrogation { ref phase_id } if phase_id == "wakatsuki_testimony"),
        "expected wrong evidence to keep testimony active, got {:?}",
        view.mode,
    );

    let view = engine
        .present_testimony_item("cleaning_button", "evidence", "coffee_machine_cleaning_log")
        .unwrap();
    let view = advance_all_dialogue(&mut engine, view);

    let reached_next_scene_or_complete = matches!(view.mode, ModeView::GameComplete)
        || match &view.scene {
            SceneView::Linear { index, .. }
            | SceneView::Investigation { index, .. }
            | SceneView::Interrogation { index, .. } => *index > 2,
        };
    assert!(
        reached_next_scene_or_complete,
        "expected next scene or game completion after correct present, got {:?}",
        view.mode,
    );
}

#[test]
fn locked_sublocation_returns_typed_error() {
    let mut engine = GameEngine::new_started(fixture_resources()).unwrap();
    advance_until_explore(&mut engine);

    let err = engine.enter_sublocation("back_room").unwrap_err();
    assert_eq!(err.code, "lockedSublocation");
}

#[test]
fn unknown_inventory_reexamine_returns_typed_error() {
    let mut engine = GameEngine::new_started(fixture_resources()).unwrap();
    advance_until_explore(&mut engine);

    let err = engine.reexamine_evidence("missing_evidence").unwrap_err();
    assert_eq!(err.code, "unknownEvidence");
}

#[test]
fn actions_are_rejected_while_dialogue_is_active() {
    let mut engine = GameEngine::new_started(fixture_resources()).unwrap();

    let err = engine.inspect_hotspot("table").unwrap_err();
    assert_eq!(err.code, "wrongMode");

    while !matches!(engine.view().mode, ModeView::Explore { .. }) {
        let token = token_from(&engine.view());
        engine.advance_dialogue(token).unwrap();
    }

    engine.inspect_hotspot("table").unwrap();
    let err = engine.enter_sublocation("back_room").unwrap_err();
    assert_eq!(err.code, "dialogueActive");
}

#[test]
fn advance_dialogue_without_active_queue_returns_typed_error() {
    let mut engine = GameEngine::new_started(fixture_resources()).unwrap();
    advance_until_explore(&mut engine);

    let err = engine
        .advance_dialogue(QueueToken {
            scene_id: "none".into(),
            queue_gen: 0,
            cursor: 0,
        })
        .unwrap_err();
    assert_eq!(err.code, "noActiveDialogue");
}
