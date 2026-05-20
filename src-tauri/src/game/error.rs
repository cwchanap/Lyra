// src-tauri/src/game/error.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameError {
    pub code: String,
    pub message: String,
}

impl GameError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

impl GameError {
    pub fn unavailable() -> Self { Self::new("stateUnavailable", "The game engine is unavailable.") }
    pub fn game_not_started() -> Self { Self::new("gameNotStarted", "Call start_game first.") }
    pub fn wrong_mode(action: &str, mode: &str) -> Self {
        Self::new("wrongMode", format!("Action '{action}' is not valid while in mode '{mode}'."))
    }
    pub fn no_active_dialogue() -> Self { Self::new("noActiveDialogue", "No dialogue queue is currently active.") }
    pub fn dialogue_active(action: &str) -> Self {
        Self::new("dialogueActive", format!("Action '{action}' is not allowed while a dialogue is playing."))
    }
    pub fn unknown_hotspot(id: &str) -> Self { Self::new("unknownHotspot", format!("Hotspot '{id}' does not exist in the current scene.")) }
    pub fn locked_hotspot(id: &str) -> Self { Self::new("lockedHotspot", format!("Hotspot '{id}' is locked.")) }
    pub fn unknown_character(id: &str) -> Self { Self::new("unknownCharacter", format!("Character '{id}' does not exist.")) }
    pub fn unknown_topic(c: &str, t: &str) -> Self { Self::new("unknownTopic", format!("Topic '{c}@{t}' does not exist.")) }
    pub fn locked_topic(c: &str, t: &str) -> Self { Self::new("lockedTopic", format!("Topic '{c}@{t}' is locked.")) }
    pub fn unknown_sublocation(id: &str) -> Self { Self::new("unknownSublocation", format!("Sub-location '{id}' does not exist.")) }
    pub fn locked_sublocation(id: &str) -> Self { Self::new("lockedSublocation", format!("Sub-location '{id}' is locked.")) }
    pub fn unknown_evidence(id: &str) -> Self { Self::new("unknownEvidence", format!("Evidence '{id}' is not in the inventory.")) }
    pub fn unknown_statement(id: &str) -> Self { Self::new("unknownStatement", format!("Statement '{id}' is not in the inventory.")) }
    pub fn scene_load_failed(detail: String) -> Self { Self::new("sceneLoadFailed", detail) }
    pub fn scene_validation_failed(detail: String) -> Self { Self::new("sceneValidationFailed", detail) }
    pub fn unsupported_scene_type(scene_type: &str) -> Self { Self::new("unsupportedSceneType", format!("Scene type '{scene_type}' is not supported by the runtime yet.")) }
    pub fn chapter_load_failed(detail: String) -> Self { Self::new("chapterLoadFailed", detail) }
    pub fn parse_failure(detail: String) -> Self { Self::new("parseFailure", detail) }
    pub fn game_complete() -> Self { Self::new("gameComplete", "The game has been completed; reset to play again.") }
    pub fn internal(detail: String) -> Self { Self::new("internalError", detail) }
}
