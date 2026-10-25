// Showing a record to a character: a Present topic opens only through
// present_to_character, and a record it does not accept shows the character's
// Wrong Present reply without changing game state.

use super::schema::{DialogueItem, FeedbackLineJson};
use super::test_support::{
    token_from, write_empty_story_catalog_and_content_manifest, write_neutral_story_catalog,
};
use super::view::{CharacterView, GameStateView, ModeView, PresentFeedbackView, SceneView};
use super::GameEngine;
use std::path::Path;

fn present_fixture(dir: &Path) {
    let chapter_dir = dir.join("chapter_1");
    std::fs::create_dir_all(&chapter_dir).unwrap();
    write_empty_story_catalog_and_content_manifest(dir);
    write_neutral_story_catalog(
        dir,
        &[
            ("receipt", "chapter_1", "investigation_scene_1"),
            ("note", "chapter_1", "investigation_scene_1"),
        ],
        &[("shift_alibi", "chapter_1", "investigation_scene_1")],
    );
    std::fs::write(
        dir.join("chapters.json"),
        r#"{
            "chapters": [{
                "id": "chapter_1",
                "title": "Chapter One",
                "summary": "First",
                "scenes": [{
                    "type": "investigation",
                    "file": "chapter_1/investigation_scene_1.json"
                }]
            }]
        }"#,
    )
    .unwrap();
    std::fs::write(
        chapter_dir.join("investigation_scene_1.json"),
        r#"{
            "type": "investigation",
            "id": "investigation_scene_1",
            "title": "Shop",
            "summary": "Fixture scene summary.",
            "intro": [{ "kind": "action", "text": "intro" }],
            "sublocations": [{
                "id": "shop",
                "label": "Shop",
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "shop",
                "transitionDialogue": [],
                "hotspots": [
                    {
                        "id": "counter",
                        "label": "Counter",
                        "description": "Counter",
                        "status": "unlocked",
                        "unlock": null,
                        "reveals": [{ "kind": "evidence", "id": "receipt" }],
                        "inspectDialogue": [],
                        "onReexamine": null
                    },
                    {
                        "id": "shelf",
                        "label": "Shelf",
                        "description": "Shelf",
                        "status": "unlocked",
                        "unlock": null,
                        "reveals": [{ "kind": "evidence", "id": "note" }],
                        "inspectDialogue": [],
                        "onReexamine": null
                    },
                    {
                        "id": "never",
                        "label": "Never",
                        "description": "Never",
                        "status": "locked",
                        "unlock": { "predicate": "hotspot_investigated", "id": "never" },
                        "reveals": [],
                        "inspectDialogue": [],
                        "onReexamine": null
                    }
                ],
                "characters": [
                    {
                        "id": "clerk",
                        "name": "店員",
                        "role": "Clerk",
                        "bio": "On shift.",
                        "layout": null,
                        "topics": [
                            {
                                "id": "shift",
                                "label": "Shift",
                                "status": "unlocked",
                                "unlock": null,
                                "reveals": [],
                                "topicDialogue": [
                                    { "kind": "line", "speaker": "店員", "text": "我十點上班。" }
                                ],
                                "onReexamine": null
                            },
                            {
                                "id": "receipt_reaction",
                                "label": "Receipt",
                                "status": "locked",
                                "unlock": { "predicate": "evidence_collected", "id": "receipt" },
                                "reveals": [{ "kind": "statement", "id": "shift_alibi" }],
                                "present": [{ "kind": "evidence", "id": "receipt" }],
                                "topicDialogue": [
                                    { "kind": "line", "speaker": "店員", "text": "這是重印的。" }
                                ],
                                "onReexamine": [
                                    { "kind": "line", "speaker": "店員", "text": "說過了，是重印的。" }
                                ]
                            }
                        ],
                        "wrongPresent": { "speaker": "店員", "text": "這跟我無關吧。" }
                    },
                    {
                        "id": "guard",
                        "name": "警衛",
                        "role": "Guard",
                        "bio": "At the door.",
                        "layout": null,
                        "topics": []
                    }
                ]
            }],
            "evidenceManifest": [
                {
                    "id": "receipt",
                    "name": "Receipt",
                    "description": "Receipt",
                    "details": "REPRINT",
                    "imageAssetId": null,
                    "onCollect": [],
                    "onReexamine": null
                },
                {
                    "id": "note",
                    "name": "Note",
                    "description": "Note",
                    "details": "Note",
                    "imageAssetId": null,
                    "onCollect": [],
                    "onReexamine": null
                }
            ],
            "statementManifest": [{
                "id": "shift_alibi",
                "speaker": "店員",
                "content": "Reprinted.",
                "onAcquire": [],
                "onReexamine": null
            }],
            "outro": {
                "unlock": { "predicate": "hotspot_investigated", "id": "never" },
                "dialogue": []
            }
        }"#,
    )
    .unwrap();
}

/// Advances through any dialogue and returns the next non-dialogue view.
fn drain(engine: &mut GameEngine, mut view: GameStateView) -> GameStateView {
    while matches!(view.mode, ModeView::Dialogue { .. }) {
        view = engine.advance_dialogue(token_from(&view)).unwrap();
    }
    view
}

/// Started engine standing in the shop, holding the receipt and the note.
fn engine_in_shop() -> (tempfile::TempDir, GameEngine, GameStateView) {
    let dir = tempfile::tempdir().unwrap();
    present_fixture(dir.path());
    let mut engine = GameEngine::new_started(dir.path().to_path_buf()).unwrap();
    let first = engine.view().unwrap();
    drain(&mut engine, first);
    for hotspot in ["counter", "shelf"] {
        let view = engine.inspect_hotspot(hotspot).unwrap();
        drain(&mut engine, view);
    }
    let view = engine.view().unwrap();
    (dir, engine, view)
}

fn character<'a>(view: &'a GameStateView, id: &str) -> &'a CharacterView {
    let SceneView::Investigation {
        visible_sublocations,
        ..
    } = &view.scene
    else {
        panic!("expected an investigation scene, got {:?}", view.scene)
    };
    visible_sublocations
        .iter()
        .flat_map(|sub| sub.characters.iter())
        .find(|c| c.id == id)
        .unwrap_or_else(|| panic!("missing character {id}"))
}

fn present_feedback(view: &GameStateView) -> Option<PresentFeedbackView> {
    match &view.mode {
        ModeView::Explore {
            present_feedback, ..
        } => present_feedback.clone(),
        other => panic!("expected explore mode, got {other:?}"),
    }
}

fn current_text(view: &GameStateView) -> String {
    match &view.mode {
        ModeView::Dialogue {
            current: DialogueItem::Line { text, .. },
            ..
        } => text.clone(),
        other => panic!("expected a dialogue line, got {other:?}"),
    }
}

#[test]
fn the_view_flags_present_topics_without_naming_their_records() {
    let (_dir, _engine, view) = engine_in_shop();
    let clerk = character(&view, "clerk");
    assert!(clerk.accepts_present);
    assert!(!character(&view, "guard").accepts_present);
    let receipt = clerk
        .topics
        .iter()
        .find(|t| t.id == "receipt_reaction")
        .expect("held record unlocks the Present topic");
    assert!(receipt.requires_present && !receipt.discussed);
    let json = serde_json::to_string(&view.scene).unwrap();
    assert!(
        !json.contains("\"present\""),
        "the accepted records stay hidden"
    );
}

#[test]
fn a_present_topic_cannot_be_picked_from_the_topic_list() {
    let (_dir, mut engine, _view) = engine_in_shop();
    let error = engine
        .interview_topic("clerk", "receipt_reaction")
        .unwrap_err();
    assert_eq!(error.code, "topicRequiresPresent");
}

#[test]
fn a_record_the_character_does_not_accept_shows_the_wrong_present_reply() {
    let (_dir, mut engine, _view) = engine_in_shop();
    let revision = engine.durable_revision;

    let view = engine
        .present_to_character("clerk", "evidence", "note")
        .unwrap();

    assert_eq!(engine.durable_revision, revision);
    assert_eq!(
        present_feedback(&view),
        Some(PresentFeedbackView {
            character_id: "clerk".into(),
            line: FeedbackLineJson {
                speaker: Some("店員".into()),
                text: "這跟我無關吧。".into(),
            },
        })
    );
    assert!(!character(&view, "clerk").topics[1].discussed);
}

#[test]
fn the_accepted_record_plays_the_topic_and_then_its_reexamination() {
    let (_dir, mut engine, _view) = engine_in_shop();
    engine
        .present_to_character("clerk", "evidence", "note")
        .unwrap();

    let opened = engine
        .present_to_character("clerk", "evidence", "receipt")
        .unwrap();
    assert_eq!(current_text(&opened), "這是重印的。");
    let explore = drain(&mut engine, opened);
    assert_eq!(
        present_feedback(&explore),
        None,
        "a state change clears the reply"
    );
    assert!(engine.inventory.has_statement("shift_alibi"));
    assert!(character(&explore, "clerk").topics[1].discussed);

    let again = engine
        .present_to_character("clerk", "evidence", "receipt")
        .unwrap();
    assert_eq!(current_text(&again), "說過了，是重印的。");
    drain(&mut engine, again);
    let reexamined = engine.interview_topic("clerk", "receipt_reaction").unwrap();
    assert_eq!(current_text(&reexamined), "說過了，是重印的。");
}

#[test]
fn present_refuses_unheld_records_and_characters_with_no_present_topic() {
    let (_dir, mut engine, _view) = engine_in_shop();
    let error = engine
        .present_to_character("clerk", "statement", "shift_alibi")
        .unwrap_err();
    assert_eq!(error.code, "unknownInventoryTarget");
    let error = engine
        .present_to_character("guard", "evidence", "receipt")
        .unwrap_err();
    assert_eq!(error.code, "nothingToPresent");
}
