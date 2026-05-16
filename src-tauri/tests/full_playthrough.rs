// Integration test that exercises the full mode machine on the fixture corpus.

use std::path::PathBuf;

use lyra_lib::game::{GameEngine, GameStateView, QueueToken};
use lyra_lib::game::view::ModeView;

fn fixture_resources() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/scenes")
}

fn token_from(view: &GameStateView) -> QueueToken {
    match &view.mode {
        ModeView::Dialogue { queue_token, .. } => queue_token.clone(),
        other => panic!("expected Dialogue mode, got: {:?}", other),
    }
}

#[test]
fn full_playthrough_starts_at_dialogue_with_intro() {
    let engine = GameEngine::new_started(fixture_resources()).unwrap();
    let view = engine.view();
    assert!(matches!(view.mode, ModeView::Dialogue { .. }), "expected Dialogue mode, got {:?}", view.mode);
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
