// src-tauri/src/game/error.rs
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameError {
    pub code: String,
    pub message: String,
}

impl GameError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl GameError {
    pub fn unavailable() -> Self {
        Self::new("stateUnavailable", "The game engine is unavailable.")
    }
    pub fn game_not_started() -> Self {
        Self::new("gameNotStarted", "Call start_game first.")
    }
    pub fn wrong_mode(action: &str, mode: &str) -> Self {
        Self::new(
            "wrongMode",
            format!("Action '{action}' is not valid while in mode '{mode}'."),
        )
    }
    pub fn no_active_dialogue() -> Self {
        Self::new("noActiveDialogue", "No dialogue queue is currently active.")
    }
    pub fn dialogue_active(action: &str) -> Self {
        Self::new(
            "dialogueActive",
            format!("Action '{action}' is not allowed while a dialogue is playing."),
        )
    }
    pub fn unknown_hotspot(id: &str) -> Self {
        Self::new(
            "unknownHotspot",
            format!("Hotspot '{id}' does not exist in the current scene."),
        )
    }
    pub fn locked_hotspot(id: &str) -> Self {
        Self::new("lockedHotspot", format!("Hotspot '{id}' is locked."))
    }
    pub fn unknown_character(id: &str) -> Self {
        Self::new(
            "unknownCharacter",
            format!("Character '{id}' does not exist."),
        )
    }
    pub fn unknown_chapter(id: &str) -> Self {
        Self::new("unknownChapter", format!("Chapter '{id}' does not exist."))
    }
    pub fn unknown_scene(chapter_id: &str, scene_id: &str) -> Self {
        Self::new(
            "unknownScene",
            format!("Scene '{scene_id}' does not exist in chapter '{chapter_id}'."),
        )
    }
    pub fn duplicate_scene_target(chapter_id: &str, scene_id: &str) -> Self {
        Self::new(
            "duplicateSceneTarget",
            format!(
                "Scene '{scene_id}' appears more than once in chapter '{chapter_id}' — navigation targets must be unambiguous."
            ),
        )
    }
    pub fn duplicate_chapter_target(chapter_id: &str) -> Self {
        Self::new(
            "duplicateChapterTarget",
            format!(
                "Chapter '{chapter_id}' appears more than once — navigation targets must be unambiguous."
            ),
        )
    }
    pub fn unknown_topic(c: &str, t: &str) -> Self {
        Self::new("unknownTopic", format!("Topic '{c}@{t}' does not exist."))
    }
    pub fn locked_topic(c: &str, t: &str) -> Self {
        Self::new("lockedTopic", format!("Topic '{c}@{t}' is locked."))
    }
    pub fn unknown_sublocation(id: &str) -> Self {
        Self::new(
            "unknownSublocation",
            format!("Sub-location '{id}' does not exist."),
        )
    }
    pub fn locked_sublocation(id: &str) -> Self {
        Self::new(
            "lockedSublocation",
            format!("Sub-location '{id}' is locked."),
        )
    }
    pub fn unknown_evidence(id: &str) -> Self {
        Self::new(
            "unknownEvidence",
            format!("Evidence '{id}' is not in the inventory."),
        )
    }
    pub fn unknown_statement(id: &str) -> Self {
        Self::new(
            "unknownStatement",
            format!("Statement '{id}' is not in the inventory."),
        )
    }
    pub fn unknown_interrogation_question(id: &str) -> Self {
        Self::new(
            "unknownInterrogationQuestion",
            format!("Interrogation question '{id}' does not exist."),
        )
    }
    pub fn locked_interrogation_question(id: &str) -> Self {
        Self::new(
            "lockedInterrogationQuestion",
            format!("Interrogation question '{id}' is locked."),
        )
    }
    pub fn not_in_cross_examination(action: &str) -> Self {
        Self::new(
            "notInCrossExamination",
            format!("Action '{action}' requires an active cross-examination."),
        )
    }
    pub fn interrogation_phase_not_completable() -> Self {
        Self::new(
            "interrogationPhaseNotCompletable",
            "The current interrogation phase cannot be completed yet: it is not an auto phase, a cross-examination is in progress, or a required question is unbroken.".to_string(),
        )
    }
    pub fn unknown_inventory_target(kind: &str, id: &str) -> Self {
        Self::new(
            "unknownInventoryTarget",
            format!("Inventory target '{kind}:{id}' is not available."),
        )
    }
    pub fn scene_load_failed(detail: String) -> Self {
        Self::new("sceneLoadFailed", detail)
    }
    pub fn scene_validation_failed(detail: String) -> Self {
        Self::new("sceneValidationFailed", detail)
    }
    pub fn unsupported_scene_type(scene_type: &str) -> Self {
        Self::new(
            "unsupportedSceneType",
            format!("Scene type '{scene_type}' is not supported by the runtime yet."),
        )
    }
    pub fn chapter_load_failed(detail: String) -> Self {
        Self::new("chapterLoadFailed", detail)
    }
    pub fn story_catalog_load_failed(path: &Path, detail: String) -> Self {
        Self::new(
            "storyCatalogLoadFailed",
            format!(
                "Failed to load story catalog '{}': {detail}",
                path.display()
            ),
        )
    }
    pub fn unsupported_story_catalog_version(path: &Path, version: i64) -> Self {
        Self::new(
            "unsupportedStoryCatalogVersion",
            format!(
                "Story catalog '{}' uses unsupported schema version {version}; expected version 1.",
                path.display()
            ),
        )
    }
    pub fn story_catalog_validation_failed(path: &Path, detail: String) -> Self {
        Self::new(
            "storyCatalogValidationFailed",
            format!(
                "Story catalog '{}' failed runtime validation: {detail}",
                path.display()
            ),
        )
    }
    pub fn invalid_story_state_snapshot(detail: impl Into<String>) -> Self {
        Self::new(
            "invalidStoryStateSnapshot",
            format!("Story state snapshot is invalid: {}", detail.into()),
        )
    }
    pub fn unknown_story_fact(id: &str) -> Self {
        Self::new(
            "unknownStoryFact",
            format!("Story fact '{id}' does not exist."),
        )
    }
    pub fn unknown_supporting_case_record(kind: &str, id: &str) -> Self {
        Self::new(
            "unknownSupportingCaseRecord",
            format!("Supporting case record '{kind}:{id}' does not exist."),
        )
    }
    pub fn invalid_supporting_fact(id: &str, detail: &str) -> Self {
        Self::new(
            "invalidSupportingFact",
            format!("Supporting fact '{id}' is invalid: {detail}"),
        )
    }
    pub fn invalid_assertion_origin(detail: impl Into<String>) -> Self {
        Self::new(
            "invalidAssertionOrigin",
            format!("Assertion origin is invalid: {}", detail.into()),
        )
    }
    pub fn unknown_story_question(id: &str) -> Self {
        Self::new(
            "unknownStoryQuestion",
            format!("Story question '{id}' does not exist."),
        )
    }
    pub fn invalid_question_resolution_fact(id: &str, detail: &str) -> Self {
        Self::new(
            "invalidQuestionResolutionFact",
            format!("Question resolution fact '{id}' is invalid: {detail}"),
        )
    }
    pub fn invalid_question_resolver_replacement(
        question_id: &str,
        current_fact_id: &str,
        requested_fact_id: &str,
    ) -> Self {
        Self::new(
            "invalidQuestionResolverReplacement",
            format!(
                "Question '{question_id}' is already resolved by '{current_fact_id}' and cannot be replaced by '{requested_fact_id}'."
            ),
        )
    }
    pub fn unknown_story_objective(id: &str) -> Self {
        Self::new(
            "unknownStoryObjective",
            format!("Story objective '{id}' does not exist."),
        )
    }
    pub fn invalid_primary_objective_transition(detail: impl Into<String>) -> Self {
        Self::new(
            "invalidPrimaryObjectiveTransition",
            format!("Primary objective transition is invalid: {}", detail.into()),
        )
    }
    pub fn unknown_story_authorization(id: &str) -> Self {
        Self::new(
            "unknownStoryAuthorization",
            format!("Story authorization '{id}' does not exist."),
        )
    }
    pub fn parse_failure(detail: String) -> Self {
        Self::new("parseFailure", detail)
    }
    pub fn game_complete() -> Self {
        Self::new(
            "gameComplete",
            "The game has been completed; reset to play again.",
        )
    }
    pub fn internal(detail: String) -> Self {
        Self::new("internalError", detail)
    }
}
