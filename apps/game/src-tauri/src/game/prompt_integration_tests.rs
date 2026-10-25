// 推理 prompts: the cursor stops on the prompt, a wrong option only shows its
// reply, the correct option moves the dialogue on, and saves taken on a prompt
// restore it unanswered.

use super::save::capture::{capture_checkpoint, CapturedCheckpoint};
use super::save::restore::{build_restore_candidate, load_current_definitions};
use super::save::schema::{SaveEnvelope, SaveType, ThumbnailDescriptorV1, SAVE_SCHEMA_VERSION};
use super::schema::{DialogueItem, FeedbackLineJson};
use super::test_support::{token_from, write_empty_story_catalog_and_content_manifest};
use super::view::{GameStateView, ModeView};
use super::GameEngine;
use std::path::Path;

fn prompt_fixture(dir: &Path) {
    let chapter_dir = dir.join("chapter_1");
    std::fs::create_dir_all(&chapter_dir).unwrap();
    write_empty_story_catalog_and_content_manifest(dir);
    std::fs::write(
        dir.join("chapters.json"),
        r#"{
            "chapters": [{
                "id": "chapter_1",
                "title": "Chapter One",
                "summary": "First",
                "scenes": [
                    { "type": "linear", "file": "chapter_1/scene_0.json" },
                    { "type": "linear", "file": "chapter_1/scene_1.json" }
                ]
            }]
        }"#,
    )
    .unwrap();
    std::fs::write(
        chapter_dir.join("scene_0.json"),
        r#"{
            "type": "linear",
            "id": "scene_0",
            "title": "Opening",
            "summary": "Fixture scene summary.",
            "queue": [
                { "kind": "line", "speaker": "相馬律", "text": "先看時間。" },
                {
                    "kind": "prompt",
                    "question": "那 89.7 秒說明了什麼？",
                    "options": [
                        { "label": "摘要合併了時間", "correct": true, "reply": null },
                        {
                            "label": "三宅說了謊",
                            "correct": false,
                            "reply": { "speaker": "早坂茜", "text": "他的小謊和這段時間無關。" }
                        }
                    ]
                },
                { "kind": "line", "speaker": "早坂茜", "text": "對。" }
            ]
        }"#,
    )
    .unwrap();
    std::fs::write(
        chapter_dir.join("scene_1.json"),
        r#"{
            "type": "linear",
            "id": "scene_1",
            "title": "Next",
            "summary": "Fixture scene summary.",
            "queue": [{ "kind": "line", "speaker": "B", "text": "next scene" }]
        }"#,
    )
    .unwrap();
}

/// Started engine with the cursor on the prompt.
fn engine_on_prompt() -> (tempfile::TempDir, GameEngine, GameStateView) {
    let dir = tempfile::tempdir().unwrap();
    prompt_fixture(dir.path());
    let mut engine = GameEngine::new_started(dir.path().to_path_buf()).unwrap();
    let first = engine.view().unwrap();
    let view = engine.advance_dialogue(token_from(&first)).unwrap();
    assert!(matches!(
        &view.mode,
        ModeView::Dialogue {
            current: DialogueItem::Prompt { .. },
            ..
        }
    ));
    (dir, engine, view)
}

fn prompt_feedback(view: &GameStateView) -> Option<FeedbackLineJson> {
    match &view.mode {
        ModeView::Dialogue {
            prompt_feedback, ..
        } => prompt_feedback.clone(),
        other => panic!("expected dialogue mode, got {other:?}"),
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
fn prompt_view_shows_only_the_option_labels() {
    let (_dir, _engine, view) = engine_on_prompt();
    let json = serde_json::to_value(&view.mode).unwrap();
    assert_eq!(
        json["current"],
        serde_json::json!({
            "kind": "prompt",
            "question": "那 89.7 秒說明了什麼？",
            "options": [{ "label": "摘要合併了時間" }, { "label": "三宅說了謊" }]
        })
    );
    assert_eq!(json["promptFeedback"], serde_json::Value::Null);
}

#[test]
fn advance_dialogue_refuses_to_skip_an_unanswered_prompt() {
    let (_dir, mut engine, view) = engine_on_prompt();
    let revision = engine.durable_revision;
    let error = engine.advance_dialogue(token_from(&view)).unwrap_err();
    assert_eq!(error.code, "dialoguePromptUnanswered");
    assert_eq!(engine.durable_revision, revision);
}

#[test]
fn wrong_option_shows_its_reply_and_changes_nothing() {
    let (_dir, mut engine, view) = engine_on_prompt();
    let token = token_from(&view);
    let revision = engine.durable_revision;
    let history = serde_json::to_vec(engine.history.entries()).unwrap();

    let wrong = engine.answer_dialogue_prompt(token.clone(), 1).unwrap();

    assert_eq!(engine.durable_revision, revision);
    assert_eq!(
        serde_json::to_vec(engine.history.entries()).unwrap(),
        history
    );
    assert_eq!(token_from(&wrong), token);
    assert_eq!(
        prompt_feedback(&wrong),
        Some(FeedbackLineJson {
            speaker: Some("早坂茜".into()),
            text: "他的小謊和這段時間無關。".into(),
        })
    );
}

#[test]
fn correct_option_moves_on_and_clears_the_reply() {
    let (_dir, mut engine, view) = engine_on_prompt();
    let token = token_from(&view);
    engine.answer_dialogue_prompt(token.clone(), 1).unwrap();
    let revision = engine.durable_revision;

    let next = engine.answer_dialogue_prompt(token, 0).unwrap();

    assert_eq!(engine.durable_revision, revision + 1);
    assert_eq!(current_text(&next), "對。");
    assert_eq!(prompt_feedback(&next), None);
}

#[test]
fn stale_or_invalid_answers_are_rejected_without_changes() {
    let (_dir, mut engine, view) = engine_on_prompt();
    let token = token_from(&view);
    let revision = engine.durable_revision;

    let mut stale = token.clone();
    stale.cursor -= 1;
    let unchanged = engine.answer_dialogue_prompt(stale, 0).unwrap();
    assert_eq!(token_from(&unchanged), token);
    assert_eq!(prompt_feedback(&unchanged), None);

    let error = engine.answer_dialogue_prompt(token.clone(), 2).unwrap_err();
    assert_eq!(error.code, "unknownPromptOption");
    assert_eq!(engine.durable_revision, revision);

    let next = engine.answer_dialogue_prompt(token, 0).unwrap();
    let error = engine
        .answer_dialogue_prompt(token_from(&next), 0)
        .unwrap_err();
    assert_eq!(error.code, "noDialoguePrompt");
}

fn save_envelope(engine: &GameEngine, checkpoint: CapturedCheckpoint) -> SaveEnvelope {
    SaveEnvelope {
        schema_version: SAVE_SCHEMA_VERSION,
        content_revision: engine.content_manifest.content_revision().into(),
        save_id: "550e8400-e29b-41d4-a716-446655440261".into(),
        save_type: SaveType::Manual,
        slot: 1,
        saved_at: "2026-10-25T12:00:00Z".into(),
        display_name: "Prompt".into(),
        thumbnail: ThumbnailDescriptorV1::Unavailable,
        summary: checkpoint.summary,
        snapshot: checkpoint.snapshot,
    }
}

#[test]
fn a_save_on_a_prompt_restores_it_unanswered() {
    let (dir, mut engine, view) = engine_on_prompt();
    let token = token_from(&view);
    engine.answer_dialogue_prompt(token.clone(), 1).unwrap();

    let envelope = save_envelope(&engine, capture_checkpoint(&engine).unwrap());
    let save_json = serde_json::to_string(&envelope).unwrap();
    assert!(
        !save_json.contains("他的小謊"),
        "a wrong-pick reply is never saved"
    );
    let definitions = load_current_definitions(dir.path()).unwrap();
    let mut restored = build_restore_candidate(dir.path().to_path_buf(), &definitions, envelope)
        .unwrap()
        .engine;

    let restored_view = restored.view().unwrap();
    assert_eq!(token_from(&restored_view), token);
    assert_eq!(prompt_feedback(&restored_view), None);
    let next = restored.answer_dialogue_prompt(token, 0).unwrap();
    assert_eq!(current_text(&next), "對。");
}
