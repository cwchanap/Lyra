// src-tauri/src/game/error.rs
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_token: Option<String>,
}

impl GameError {
    pub fn unsafe_e2e_app_data_root() -> Self {
        Self::new(
            "unsafeE2eAppDataRoot",
            "The E2E app-data override is missing or unsafe.",
        )
    }
    pub fn save_directory_unavailable() -> Self {
        Self::new("saveDirectoryUnavailable", "Save directory is unavailable.")
    }
    pub fn save_read_failed() -> Self {
        Self::new("saveReadFailed", "Save could not be read.")
    }
    pub fn save_write_failed() -> Self {
        Self::new("saveWriteFailed", "Save could not be written.")
    }
    pub fn save_sync_failed() -> Self {
        Self::new("saveSyncFailed", "Save could not be synchronized.")
    }
    pub fn save_replace_failed() -> Self {
        Self::new(
            "saveReplaceFailed",
            "Save could not replace its previous checkpoint.",
        )
    }
    pub fn save_discovery_unavailable() -> Self {
        Self::new("saveDiscoveryUnavailable", "Save discovery is unavailable.")
    }
    pub fn malformed_save_json() -> Self {
        Self::new("malformedSaveJson", "Save JSON is malformed.")
    }
    pub fn save_slot_mismatch() -> Self {
        Self::new(
            "saveSlotMismatch",
            "Save slot does not match its storage target.",
        )
    }
    pub fn unsupported_save_schema_version() -> Self {
        Self::new(
            "unsupportedSaveSchemaVersion",
            "Save schema version is unsupported.",
        )
    }
    pub fn missing_save_schema_migration() -> Self {
        Self::new(
            "missingSaveSchemaMigration",
            "Save schema migration is missing.",
        )
    }
    pub fn missing_save_definition() -> Self {
        Self::new(
            "missingSaveDefinition",
            "A saved definition is missing from packaged content.",
        )
    }
    pub fn invalid_save_progress() -> Self {
        Self::new("invalidSaveProgress", "Save progress is invalid.")
    }
    pub fn invalid_save_cursor() -> Self {
        Self::new("invalidSaveCursor", "Save dialogue cursor is invalid.")
    }
    pub fn invalid_save_checkpoint_id() -> Self {
        Self::new("invalidSaveCheckpointId", "Save checkpoint ID is invalid.")
    }
    pub fn manual_save_name_empty() -> Self {
        Self::new("manualSaveNameEmpty", "Save name cannot be empty.")
    }
    pub fn manual_save_name_too_long() -> Self {
        Self::new(
            "manualSaveNameTooLong",
            "Save name cannot exceed 40 grapheme clusters.",
        )
    }
    pub fn manual_save_name_forbidden() -> Self {
        Self::new(
            "manualSaveNameForbidden",
            "Save name contains a forbidden character.",
        )
    }
    pub fn thumbnail_png_malformed() -> Self {
        Self::new("thumbnailPngMalformed", "Thumbnail PNG is malformed.")
    }
    pub fn thumbnail_png_too_large() -> Self {
        Self::new("thumbnailPngTooLarge", "Thumbnail PNG is too large.")
    }
    pub fn thumbnail_dimensions_out_of_bounds() -> Self {
        Self::new(
            "thumbnailDimensionsOutOfBounds",
            "Thumbnail dimensions are outside the allowed range.",
        )
    }
    pub fn thumbnail_missing() -> Self {
        Self::new("thumbnailMissing", "Thumbnail is missing.")
    }
    pub fn thumbnail_corrupt() -> Self {
        Self::new("thumbnailCorrupt", "Thumbnail is corrupt.")
    }
    pub fn thumbnail_read_failed() -> Self {
        Self::new("thumbnailReadFailed", "Thumbnail could not be read.")
    }
    pub fn stale_thumbnail_ticket() -> Self {
        Self::new("staleThumbnailTicket", "Thumbnail ticket is stale.")
    }
    pub fn thumbnail_ticket_purpose_mismatch() -> Self {
        Self::new(
            "thumbnailTicketPurposeMismatch",
            "Thumbnail ticket purpose does not match.",
        )
    }
    pub fn acquisition_thumbnail_ticket_mismatch() -> Self {
        Self::new(
            "acquisitionThumbnailTicketMismatch",
            "Acquisition thumbnail ticket does not match.",
        )
    }
    pub fn persistence_operation_in_progress() -> Self {
        Self::new(
            "persistenceOperationInProgress",
            "A persistence operation is already in progress.",
        )
    }
    pub fn is_persistence_operation_in_progress(&self) -> bool {
        self.code == "persistenceOperationInProgress"
    }
    pub fn stale_manual_overwrite_confirmation() -> Self {
        Self::new(
            "staleManualOverwriteConfirmation",
            "Manual overwrite confirmation is stale.",
        )
    }
    pub fn stale_save_selection() -> Self {
        Self::new("staleSaveSelection", "Save selection is stale.")
    }
    pub fn stale_session_generation() -> Self {
        Self::new("staleSessionGeneration", "Session generation is stale.")
    }
    pub fn persistence_bypass_unavailable() -> Self {
        Self::new(
            "persistenceBypassUnavailable",
            "Persistence bypass is unavailable.",
        )
    }
    pub fn stale_persistence_failure_token() -> Self {
        Self::new(
            "stalePersistenceFailureToken",
            "Persistence failure token is stale.",
        )
    }
    pub fn unknown_acquisition_event() -> Self {
        Self::new("unknownAcquisitionEvent", "Acquisition event is unknown.")
    }
    pub fn missing_acquisition_definition() -> Self {
        Self::new(
            "missingAcquisitionDefinition",
            "Acquisition definition is missing from packaged content.",
        )
    }
    pub fn acquisition_definition_mismatch() -> Self {
        Self::new(
            "acquisitionDefinitionMismatch",
            "Acquisition definition does not match the stored record kind or provenance.",
        )
    }
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            failure_token: None,
        }
    }

    pub(crate) fn with_failure_token(mut self, failure_token: String) -> Self {
        self.failure_token = Some(failure_token);
        self
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
    pub fn content_manifest_load_failed(path: &Path, detail: String) -> Self {
        Self::new(
            "contentManifestLoadFailed",
            format!(
                "Failed to load content manifest '{}': {detail}",
                path.display()
            ),
        )
    }
    pub fn unsupported_content_manifest_version(path: &Path, version: u32) -> Self {
        Self::new(
            "unsupportedContentManifestVersion",
            format!(
                "Content manifest '{}' uses unsupported manifest version {version}; expected version 1.",
                path.display()
            ),
        )
    }
    pub fn content_manifest_validation_failed(path: &Path, detail: String) -> Self {
        Self::new(
            "contentManifestValidationFailed",
            format!(
                "Content manifest '{}' failed runtime validation: {detail}",
                path.display()
            ),
        )
    }
    pub fn incompatible_content_revision(saved: &str, packaged: &str) -> Self {
        Self::new(
            "incompatibleContentRevision",
            format!(
                "Saved content revision '{saved}' does not match packaged revision '{packaged}'."
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
    pub fn request_origin_forbidden(origin: &str) -> Self {
        Self::new(
            "requestOriginForbidden",
            format!("Request origin '{origin}' is not allowed by CORS policy."),
        )
    }
}
