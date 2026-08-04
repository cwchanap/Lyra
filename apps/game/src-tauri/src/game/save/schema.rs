use crate::game::dialogue_queue::ActiveDialogueStateV1;
use crate::game::schema::AudioChannelJson;
use crate::game::story::StoryStateSnapshot;
use crate::game::{GameError, QueueToken};
use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use std::time::SystemTime;
use unicode_segmentation::UnicodeSegmentation;

pub(crate) const SAVE_SCHEMA_VERSION: u32 = 2;
pub(crate) const MAX_THUMBNAIL_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_THUMBNAIL_WIDTH: u32 = 480;
pub(crate) const MAX_THUMBNAIL_HEIGHT: u32 = 360;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum SaveSlotRef {
    Auto { slot: u8 },
    Manual { slot: u8 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SaveType {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ThumbnailFormat {
    Png,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum ThumbnailDescriptorV1 {
    Available {
        object_id: String,
        format: ThumbnailFormat,
        width: u32,
        height: u32,
        byte_length: u32,
        sha256: String,
    },
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveBrowserView {
    pub(crate) discovery: SaveDiscoveryStatusView,
    pub(crate) slots: Vec<SaveSlotView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SaveDiscoveryStatusView {
    Loading,
    Available,
    Unavailable { diagnostic: GameError },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveSlotView {
    pub(crate) reference: SaveSlotRef,
    pub(crate) modified_at: Option<String>,
    pub(crate) status: SaveSlotStatusView,
    #[serde(skip)]
    pub(crate) observed_modified_at: Option<SystemTime>,
    #[serde(skip)]
    pub(crate) observed_saved_at: Option<DateTime<FixedOffset>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SaveSlotStatusView {
    Empty,
    Valid {
        metadata: SaveMetadataView,
    },
    Invalid {
        metadata: Option<ReadableSaveMetadataView>,
        diagnostic: GameError,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveMetadataView {
    pub(crate) save_id: String,
    pub(crate) save_type: SaveType,
    pub(crate) schema_version: u32,
    pub(crate) content_revision: String,
    pub(crate) saved_at: String,
    pub(crate) display_name: String,
    pub(crate) thumbnail: ThumbnailAvailabilityView,
    pub(crate) summary: SaveSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadableSaveMetadataView {
    pub(crate) save_id: Option<String>,
    pub(crate) saved_at: Option<String>,
    pub(crate) display_name: Option<String>,
    pub(crate) thumbnail: ThumbnailAvailabilityView,
    pub(crate) summary: Option<SaveSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ThumbnailAvailabilityView {
    Available { width: u32, height: u32 },
    Unavailable { reason: ThumbnailUnavailableReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ThumbnailUnavailableReason {
    CaptureUnavailable,
    Missing,
    Corrupt,
    ReadFailed,
}

pub(crate) type SaveDiagnosticView = GameError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThumbnailDiagnosticView {
    pub(crate) reason: ThumbnailUnavailableReason,
    pub(crate) message: String,
    pub(crate) retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveSummary {
    pub(crate) chapter_id: String,
    pub(crate) chapter_title: String,
    pub(crate) chapter_summary: Option<String>,
    pub(crate) scene_id: String,
    pub(crate) scene_title: String,
    pub(crate) scene_summary: Option<String>,
    pub(crate) active_primary_objective_id: Option<String>,
    pub(crate) active_primary_objective_label: Option<String>,
    pub(crate) active_primary_objective_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveEnvelope {
    pub(crate) schema_version: u32,
    pub(crate) content_revision: String,
    pub(crate) save_id: String,
    pub(crate) save_type: SaveType,
    pub(crate) slot: u8,
    pub(crate) saved_at: String,
    pub(crate) display_name: String,
    pub(crate) thumbnail: ThumbnailDescriptorV1,
    pub(crate) summary: SaveSummary,
    pub(crate) snapshot: SaveSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveSnapshot {
    pub(crate) chapter_id: String,
    pub(crate) scene_id: String,
    pub(crate) scene: SceneProgressSnapshot,
    pub(crate) active_dialogue: Option<ActiveDialogueStateV1>,
    pub(crate) last_visual_cue: LastVisualCueSnapshotV1,
    pub(crate) inventory: InventorySnapshotV1,
    pub(crate) pending_acquisition_events: Vec<AcquisitionEventStateV1>,
    pub(crate) story_state: StoryStateSnapshot,
    pub(crate) dialogue_history: DialogueHistorySnapshotV1,
    pub(crate) next_queue_gen: u64,
    pub(crate) durable_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum SceneProgressSnapshot {
    Linear,
    GameComplete,
    Investigation {
        intro_played: bool,
        outro_played: bool,
        current_sublocation_id: Option<String>,
        inspected_hotspot_ids: Vec<String>,
        discussed_topic_ids: Vec<CharacterTopicRefV1>,
        entered_sublocation_ids: Vec<String>,
        unlocked_overrides: Vec<InvestigationOverrideRefV1>,
    },
    Interrogation {
        intro_played: bool,
        outro_played: bool,
        current_phase_id: Option<String>,
        cross_exam: CrossExamSnapshotV1,
        broken_question_ids: Vec<String>,
        completed_phase_ids: Vec<String>,
        unlocked_overrides: Vec<InterrogationOverrideRefV1>,
        entered_phase_ids: Vec<String>,
        line_content_segment_index: Option<usize>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CharacterTopicRefV1 {
    pub(crate) character_id: String,
    pub(crate) topic_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum InvestigationOverrideRefV1 {
    Hotspot {
        id: String,
    },
    Sublocation {
        id: String,
    },
    Topic {
        character_id: String,
        topic_id: String,
    },
}

impl InvestigationOverrideRefV1 {
    pub(crate) fn parse_runtime_key(runtime_key: &str) -> Result<Self, String> {
        if let Some(id) = runtime_key.strip_prefix("hotspot:") {
            validate_override_component(id, runtime_key)?;
            return Ok(Self::Hotspot { id: id.into() });
        }
        if let Some(id) = runtime_key.strip_prefix("sublocation:") {
            validate_override_component(id, runtime_key)?;
            return Ok(Self::Sublocation { id: id.into() });
        }
        if let Some(pair) = runtime_key.strip_prefix("topic:") {
            let (character_id, topic_id) = pair
                .split_once('@')
                .ok_or_else(|| format!("Malformed override key '{runtime_key}'."))?;
            validate_override_component(character_id, runtime_key)?;
            validate_override_component(topic_id, runtime_key)?;
            return Ok(Self::Topic {
                character_id: character_id.into(),
                topic_id: topic_id.into(),
            });
        }
        Err(format!(
            "Unknown investigation override key '{runtime_key}'."
        ))
    }

    pub(crate) fn runtime_key(&self) -> String {
        match self {
            Self::Hotspot { id } => format!("hotspot:{id}"),
            Self::Sublocation { id } => format!("sublocation:{id}"),
            Self::Topic {
                character_id,
                topic_id,
            } => format!("topic:{character_id}@{topic_id}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum InterrogationOverrideRefV1 {
    Question { id: String },
    Phase { id: String },
}

impl InterrogationOverrideRefV1 {
    pub(crate) fn parse_runtime_key(runtime_key: &str) -> Result<Self, String> {
        if let Some(id) = runtime_key.strip_prefix("question:") {
            validate_override_component(id, runtime_key)?;
            return Ok(Self::Question { id: id.into() });
        }
        if let Some(id) = runtime_key.strip_prefix("phase:") {
            validate_override_component(id, runtime_key)?;
            return Ok(Self::Phase { id: id.into() });
        }
        Err(format!(
            "Unknown interrogation override key '{runtime_key}'."
        ))
    }

    pub(crate) fn runtime_key(&self) -> String {
        match self {
            Self::Question { id } => format!("question:{id}"),
            Self::Phase { id } => format!("phase:{id}"),
        }
    }
}

fn validate_override_component(component: &str, runtime_key: &str) -> Result<(), String> {
    if component.is_empty() || component.contains(':') || component.contains('@') {
        return Err(format!("Malformed override key '{runtime_key}'."));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum CrossExamSnapshotV1 {
    Idle,
    Playing {
        question_id: String,
        line_id: String,
    },
    Presenting {
        question_id: String,
        line_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InventorySnapshotV1 {
    pub(crate) evidence: Vec<EvidenceInventoryEntryV1>,
    pub(crate) statements: Vec<StatementInventoryEntryV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EvidenceInventoryEntryV1 {
    pub(crate) record_id: String,
    pub(crate) collected_in_chapter_id: String,
    pub(crate) collected_in_scene_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StatementInventoryEntryV1 {
    pub(crate) record_id: String,
    pub(crate) acquired_in_chapter_id: String,
    pub(crate) acquired_in_scene_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordKind {
    Evidence,
    Statement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AcquisitionEventStateV1 {
    pub(crate) id: String,
    pub(crate) record_kind: RecordKind,
    pub(crate) record_id: String,
    pub(crate) created_by_command_id: u64,
    pub(crate) ordinal: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LastVisualCueSnapshotV1 {
    pub(crate) scene_tag: Option<String>,
    pub(crate) background_asset_id: Option<String>,
    pub(crate) bgm: Option<AudioCueSnapshotV1>,
    pub(crate) bgs: Option<AudioCueSnapshotV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AudioCueSnapshotV1 {
    pub(crate) channel: AudioChannelJson,
    pub(crate) asset_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DialogueHistorySnapshotV1 {
    pub(crate) entries: Vec<DialogueHistoryEntryV1>,
    pub(crate) next_id: u64,
    pub(crate) last_token: Option<QueueToken>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum DialogueHistoryEntryV1 {
    Line {
        id: u64,
        speaker: String,
        text: String,
        chapter_title: String,
        scene_title: String,
    },
    Action {
        id: u64,
        text: String,
        chapter_title: String,
        scene_title: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionOnly {
    schema_version: u32,
}

pub(super) fn parse_schema_version(bytes: &[u8]) -> Result<u32, GameError> {
    serde_json::from_slice::<VersionOnly>(bytes)
        .map(|version| version.schema_version)
        .map_err(|error| GameError::new("malformedSaveJson", error.to_string()))
}

pub(crate) fn parse_current_envelope(bytes: &[u8]) -> Result<SaveEnvelope, GameError> {
    let version = parse_schema_version(bytes)?;
    if version != SAVE_SCHEMA_VERSION {
        return Err(GameError::unsupported_save_schema_version());
    }
    let envelope = serde_json::from_slice::<SaveEnvelope>(bytes)
        .map_err(|error| GameError::new("malformedSaveJson", error.to_string()))?;
    validate_envelope(&envelope)?;
    Ok(envelope)
}

pub(crate) fn encode_current_envelope(envelope: &SaveEnvelope) -> Result<Vec<u8>, GameError> {
    let mut bytes = serde_json::to_vec(envelope).map_err(|_| GameError::save_write_failed())?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub(crate) fn validate_envelope(envelope: &SaveEnvelope) -> Result<(), GameError> {
    if envelope.schema_version != SAVE_SCHEMA_VERSION {
        return Err(GameError::new(
            "unsupportedSaveSchemaVersion",
            "Save schema version is unsupported.",
        ));
    }
    canonical_uuid_v4(&envelope.save_id)?;
    match envelope.save_type {
        SaveType::Auto if !(1..=5).contains(&envelope.slot) => {
            return Err(GameError::new(
                "saveSlotMismatch",
                "Autosave slot is outside the allowed range.",
            ))
        }
        SaveType::Manual if !(1..=3).contains(&envelope.slot) => {
            return Err(GameError::new(
                "saveSlotMismatch",
                "Manual save slot is outside the allowed range.",
            ))
        }
        _ => {}
    }
    parse_saved_at_utc(&envelope.saved_at)?;
    validate_manual_display_name(&envelope.display_name)?;
    super::thumbnail::validate_descriptor(&envelope.save_id, &envelope.thumbnail)?;
    Ok(())
}

pub(crate) fn parse_saved_at_utc(input: &str) -> Result<DateTime<FixedOffset>, GameError> {
    let parsed = DateTime::parse_from_rfc3339(input)
        .map_err(|_| GameError::new("malformedSaveJson", "Save timestamp is not RFC 3339."))?;
    if parsed.offset().local_minus_utc() != 0 {
        return Err(GameError::new(
            "malformedSaveJson",
            "Save timestamp must be UTC.",
        ));
    }
    Ok(parsed)
}

pub(crate) fn canonical_uuid_v4(input: &str) -> Result<uuid::Uuid, GameError> {
    let parsed =
        uuid::Uuid::parse_str(input).map_err(|_| GameError::invalid_save_checkpoint_id())?;
    if parsed.get_version_num() != 4 || parsed.hyphenated().to_string() != input {
        return Err(GameError::invalid_save_checkpoint_id());
    }
    Ok(parsed)
}

pub(crate) fn validate_manual_display_name(input: &str) -> Result<String, GameError> {
    if input
        .chars()
        .any(|character| character.is_control() || matches!(character, '\u{2028}' | '\u{2029}'))
    {
        return Err(GameError::new(
            "manualSaveNameForbidden",
            "Save name contains a forbidden character.",
        ));
    }
    let trimmed = input.trim();
    let grapheme_count = trimmed.graphemes(true).count();
    if grapheme_count == 0 {
        return Err(GameError::new(
            "manualSaveNameEmpty",
            "Save name cannot be empty.",
        ));
    }
    if grapheme_count > 40 {
        return Err(GameError::new(
            "manualSaveNameTooLong",
            "Save name cannot exceed 40 grapheme clusters.",
        ));
    }
    Ok(trimmed.to_owned())
}

pub(crate) fn suggested_display_name(chapter_title: &str, scene_title: &str) -> String {
    let combined = format!("{chapter_title} · {scene_title}");
    let graphemes = combined.graphemes(true).collect::<Vec<_>>();
    if graphemes.len() <= 40 {
        combined
    } else {
        format!("{}…", graphemes[..39].concat())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn current_representative() -> Vec<u8> {
        crate::game::test_support::representative_save_bytes()
    }

    #[test]
    fn representative_current_save_round_trips_typed_semantics_through_the_current_encoder() {
        let save = parse_current_envelope(&crate::game::test_support::representative_save_bytes())
            .unwrap();

        assert_eq!(save.schema_version, SAVE_SCHEMA_VERSION);
        assert_eq!(save.save_type, SaveType::Manual);
        assert_eq!(save.slot, 1);
        assert_eq!(save.save_id, "550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(save.saved_at, "2026-07-26T12:34:56Z");
        assert_eq!(save.display_name, "Representative save");
        assert_eq!(save.thumbnail, ThumbnailDescriptorV1::Unavailable);
        assert_eq!(
            save.summary,
            SaveSummary {
                chapter_id: "chapter_1".into(),
                chapter_title: "Chapter One".into(),
                chapter_summary: Some("First".into()),
                scene_id: "scene_0".into(),
                scene_title: "Opening".into(),
                scene_summary: None,
                active_primary_objective_id: None,
                active_primary_objective_label: None,
                active_primary_objective_summary: None,
            }
        );
        assert_eq!(save.snapshot.chapter_id, "chapter_1");
        assert_eq!(save.snapshot.scene_id, "scene_0");
        assert_eq!(save.snapshot.scene, SceneProgressSnapshot::Linear);
    }

    #[test]
    fn save_inventory_keeps_immutable_record_definitions_out_of_the_save() {
        let mut save = crate::game::test_support::representative_save_envelope();
        save.snapshot.inventory = InventorySnapshotV1 {
            evidence: vec![
                EvidenceInventoryEntryV1 {
                    record_id: "chain_lead".into(),
                    collected_in_chapter_id: "chapter_1".into(),
                    collected_in_scene_id: "investigation_scene_1".into(),
                },
                EvidenceInventoryEntryV1 {
                    record_id: "chain_reacquired".into(),
                    collected_in_chapter_id: "chapter_1".into(),
                    collected_in_scene_id: "investigation_scene_1".into(),
                },
                EvidenceInventoryEntryV1 {
                    record_id: "chain_exhibit".into(),
                    collected_in_chapter_id: "chapter_1".into(),
                    collected_in_scene_id: "investigation_scene_1".into(),
                },
            ],
            statements: vec![StatementInventoryEntryV1 {
                record_id: "witness_support".into(),
                acquired_in_chapter_id: "chapter_1".into(),
                acquired_in_scene_id: "investigation_scene_1".into(),
            }],
        };

        let inventory = serde_json::to_value(&save).unwrap()["snapshot"]["inventory"].clone();
        assert_eq!(save.schema_version, SAVE_SCHEMA_VERSION);
        assert_eq!(
            inventory,
            serde_json::json!({
                "evidence": [
                    {
                        "recordId": "chain_lead",
                        "collectedInChapterId": "chapter_1",
                        "collectedInSceneId": "investigation_scene_1"
                    },
                    {
                        "recordId": "chain_reacquired",
                        "collectedInChapterId": "chapter_1",
                        "collectedInSceneId": "investigation_scene_1"
                    },
                    {
                        "recordId": "chain_exhibit",
                        "collectedInChapterId": "chapter_1",
                        "collectedInSceneId": "investigation_scene_1"
                    }
                ],
                "statements": [{
                    "recordId": "witness_support",
                    "acquiredInChapterId": "chapter_1",
                    "acquiredInSceneId": "investigation_scene_1"
                }]
            })
        );
        let encoded = inventory.to_string();
        for forbidden in [
            "provenance",
            "sourceGroup",
            "sourceLabel",
            "proofCapabilities",
            "supersedes",
            "members",
        ] {
            assert!(
                !encoded.contains(forbidden),
                "save inventory leaked immutable key fragment '{forbidden}'"
            );
        }
    }

    #[test]
    fn current_parser_rejects_unknown_noncurrent_and_wrong_dialect_fields() {
        let representative = current_representative();
        let mut unknown_top_level: serde_json::Value =
            serde_json::from_slice(&representative).unwrap();
        unknown_top_level["unexpected"] = serde_json::json!(true);
        assert_eq!(
            parse_current_envelope(unknown_top_level.to_string().as_bytes())
                .unwrap_err()
                .code,
            "malformedSaveJson"
        );

        let snake_case = String::from_utf8(representative.clone())
            .unwrap()
            .replace("\"schemaVersion\"", "\"schema_version\"");
        assert_eq!(
            parse_current_envelope(snake_case.as_bytes())
                .unwrap_err()
                .code,
            "malformedSaveJson"
        );

        for version in [1, 99] {
            let mut noncurrent: serde_json::Value =
                serde_json::from_slice(&representative).unwrap();
            noncurrent["schemaVersion"] = serde_json::json!(version);
            assert_eq!(
                parse_current_envelope(noncurrent.to_string().as_bytes())
                    .unwrap_err()
                    .code,
                "unsupportedSaveSchemaVersion"
            );
        }
        assert_eq!(
            parse_current_envelope(br#"{}"#).unwrap_err().code,
            "malformedSaveJson"
        );
    }

    #[test]
    fn closed_envelope_rejects_nested_unknown_fields_and_wrong_enum_dialect() {
        let representative = current_representative();
        let mut nested: serde_json::Value = serde_json::from_slice(&representative).unwrap();
        nested["snapshot"]["inventory"]["unknown"] = serde_json::json!(true);
        assert_eq!(
            parse_current_envelope(nested.to_string().as_bytes())
                .unwrap_err()
                .code,
            "malformedSaveJson"
        );

        let mut wrong_enum: serde_json::Value = serde_json::from_slice(&representative).unwrap();
        wrong_enum["saveType"] = serde_json::json!("Manual");
        assert_eq!(
            parse_current_envelope(wrong_enum.to_string().as_bytes())
                .unwrap_err()
                .code,
            "malformedSaveJson"
        );
    }

    #[test]
    fn validates_canonical_v4_uuid_only() {
        assert_eq!(
            canonical_uuid_v4("550e8400-e29b-41d4-a716-446655440000")
                .unwrap()
                .to_string(),
            "550e8400-e29b-41d4-a716-446655440000"
        );
        for invalid in [
            "550E8400-E29B-41D4-A716-446655440000",
            "{550e8400-e29b-41d4-a716-446655440000}",
            "550e8400e29b41d4a716446655440000",
            "550e8400-e29b-11d4-a716-446655440000",
            "not-a-uuid",
        ] {
            assert_eq!(
                canonical_uuid_v4(invalid).unwrap_err().code,
                "invalidSaveCheckpointId",
                "{invalid}"
            );
        }
    }

    #[test]
    fn validates_unicode_save_names_without_normalizing_internal_content() {
        assert_eq!(
            validate_manual_display_name("  雨  夜  ").unwrap(),
            "雨  夜"
        );
        assert_eq!(
            validate_manual_display_name(&"e\u{301}".repeat(40))
                .unwrap()
                .graphemes(true)
                .count(),
            40
        );
        assert_eq!(
            validate_manual_display_name(&"👩🏽‍💻".repeat(41))
                .unwrap_err()
                .code,
            "manualSaveNameTooLong"
        );
        for invalid in [
            "",
            " \t",
            "a\u{0000}",
            "a\u{0085}",
            "a\u{2028}",
            "a\u{2029}",
        ] {
            assert!(
                validate_manual_display_name(invalid).is_err(),
                "{invalid:?}"
            );
        }
    }

    #[test]
    fn shortens_suggestions_on_complete_grapheme_boundaries() {
        assert_eq!(suggested_display_name("章", "景"), "章 · 景");
        let suggestion = suggested_display_name(&"👩🏽‍💻".repeat(30), &"雨".repeat(30));
        assert_eq!(suggestion.graphemes(true).count(), 40);
        assert!(suggestion.ends_with('…'));
    }

    // Shared grapheme-parity fixture: the same JSON file is loaded by the
    // TypeScript test in apps/game/src/lib/persistence/manual-name.test.ts.
    // If either side's grapheme segmentation drifts (e.g. from a Unicode
    // version mismatch between V8/ICU and unicode-segmentation), the test on
    // the drifting side fails. Rust is the persistence-layer authority.
    const GRAPHEME_PARITY: &str =
        include_str!("../../../tests/fixtures/save-name-grapheme-parity.json");

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ParityFixture {
        validation_cases: Vec<ParityValidationCase>,
        suggestion_cases: Vec<ParitySuggestionCase>,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ParityValidationCase {
        id: String,
        input: String,
        expected: ParityExpected,
    }

    #[derive(serde::Deserialize)]
    struct ParityExpected {
        ok: bool,
        value: Option<String>,
        reason: Option<String>,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ParitySuggestionCase {
        id: String,
        chapter_title: String,
        scene_title: String,
        expected: Option<String>,
        expected_grapheme_count: Option<usize>,
        expected_suffix: Option<String>,
    }

    #[test]
    fn grapheme_parity_fixture_validation_matches_rust_outcome() {
        let fixture: ParityFixture = serde_json::from_str(GRAPHEME_PARITY).unwrap();
        for case in &fixture.validation_cases {
            let result = validate_manual_display_name(&case.input);
            if case.expected.ok {
                let expected_value = case
                    .expected
                    .value
                    .as_ref()
                    .unwrap_or_else(|| panic!("case `{}` has ok=true but no value", case.id));
                assert_eq!(
                    result.as_deref(),
                    Ok(expected_value.as_str()),
                    "validation case `{}` expected Ok but got {:?}",
                    case.id,
                    result
                );
            } else {
                let reason = case
                    .expected
                    .reason
                    .as_ref()
                    .unwrap_or_else(|| panic!("case `{}` has ok=false but no reason", case.id));
                let err = match result {
                    Ok(_) => panic!(
                        "validation case `{}` expected Err({}) but got Ok",
                        case.id, reason
                    ),
                    Err(e) => e,
                };
                let expected_code = match reason.as_str() {
                    "empty" => "manualSaveNameEmpty",
                    "tooLong" => "manualSaveNameTooLong",
                    "forbidden" => "manualSaveNameForbidden",
                    other => panic!("unknown parity reason `{other}` in case `{}`", case.id),
                };
                assert_eq!(
                    err.code, expected_code,
                    "validation case `{}` expected error code `{}` but got `{}`",
                    case.id, expected_code, err.code
                );
            }
        }
    }

    #[test]
    fn grapheme_parity_fixture_suggestion_matches_rust_outcome() {
        let fixture: ParityFixture = serde_json::from_str(GRAPHEME_PARITY).unwrap();
        for case in &fixture.suggestion_cases {
            let suggestion = suggested_display_name(&case.chapter_title, &case.scene_title);
            if let Some(expected) = &case.expected {
                assert_eq!(
                    suggestion, *expected,
                    "suggestion case `{}` exact match failed",
                    case.id
                );
            }
            if let Some(count) = case.expected_grapheme_count {
                let actual = suggestion.graphemes(true).count();
                assert_eq!(
                    actual, count,
                    "suggestion case `{}` expected {} graphemes but got {}",
                    case.id, count, actual
                );
            }
            if let Some(suffix) = &case.expected_suffix {
                assert!(
                    suggestion.ends_with(suffix.as_str()),
                    "suggestion case `{}` expected suffix `{}` but got `{}`",
                    case.id,
                    suffix,
                    suggestion
                );
            }
        }
    }

    #[test]
    fn envelope_validation_rejects_slot_timestamp_and_thumbnail_drift() {
        let representative = current_representative();
        let mut invalid: serde_json::Value = serde_json::from_slice(&representative).unwrap();
        invalid["slot"] = serde_json::json!(4);
        assert_eq!(
            parse_current_envelope(invalid.to_string().as_bytes())
                .unwrap_err()
                .code,
            "saveSlotMismatch"
        );

        let mut invalid: serde_json::Value = serde_json::from_slice(&representative).unwrap();
        invalid["savedAt"] = serde_json::json!("2026-07-26T12:34:56+01:00");
        assert_eq!(
            parse_current_envelope(invalid.to_string().as_bytes())
                .unwrap_err()
                .code,
            "malformedSaveJson"
        );

        let mut invalid: serde_json::Value = serde_json::from_slice(&representative).unwrap();
        invalid["thumbnail"] = serde_json::json!({
            "type": "available",
            "objectId": "650e8400-e29b-41d4-a716-446655440000",
            "format": "png",
            "width": 1,
            "height": 1,
            "byteLength": 1,
            "sha256": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        });
        assert_eq!(
            parse_current_envelope(invalid.to_string().as_bytes())
                .unwrap_err()
                .code,
            "thumbnailPngMalformed"
        );
    }

    #[test]
    fn envelope_validation_accepts_each_slot_range_boundary() {
        let representative = current_representative();
        for (save_type, slot) in [("auto", 1), ("auto", 5), ("manual", 1), ("manual", 3)] {
            let mut candidate: serde_json::Value = serde_json::from_slice(&representative).unwrap();
            candidate["saveType"] = serde_json::json!(save_type);
            candidate["slot"] = serde_json::json!(slot);
            assert!(parse_current_envelope(candidate.to_string().as_bytes()).is_ok());
        }
    }

    #[test]
    fn envelope_validation_rejects_each_slot_range_overflow() {
        let representative = current_representative();
        for (save_type, slot) in [("auto", 0), ("auto", 6), ("manual", 0), ("manual", 4)] {
            let mut candidate: serde_json::Value = serde_json::from_slice(&representative).unwrap();
            candidate["saveType"] = serde_json::json!(save_type);
            candidate["slot"] = serde_json::json!(slot);
            assert_eq!(
                parse_current_envelope(candidate.to_string().as_bytes())
                    .unwrap_err()
                    .code,
                "saveSlotMismatch"
            );
        }
    }

    #[test]
    fn investigation_override_runtime_key_round_trips() {
        for value in [
            InvestigationOverrideRefV1::Hotspot { id: "h1".into() },
            InvestigationOverrideRefV1::Sublocation { id: "s1".into() },
            InvestigationOverrideRefV1::Topic {
                character_id: "c1".into(),
                topic_id: "t1".into(),
            },
        ] {
            let key = value.runtime_key();
            assert_eq!(
                InvestigationOverrideRefV1::parse_runtime_key(&key).unwrap(),
                value
            );
        }
        assert_eq!(
            InvestigationOverrideRefV1::parse_runtime_key("unknown:x").unwrap_err(),
            "Unknown investigation override key 'unknown:x'."
        );
        assert_eq!(
            InvestigationOverrideRefV1::parse_runtime_key("topic:missing_at").unwrap_err(),
            "Malformed override key 'topic:missing_at'."
        );
    }

    #[test]
    fn interrogation_override_runtime_key_round_trips() {
        for value in [
            InterrogationOverrideRefV1::Question { id: "q1".into() },
            InterrogationOverrideRefV1::Phase { id: "p1".into() },
        ] {
            let key = value.runtime_key();
            assert_eq!(
                InterrogationOverrideRefV1::parse_runtime_key(&key).unwrap(),
                value
            );
        }
        assert_eq!(
            InterrogationOverrideRefV1::parse_runtime_key("unknown:x").unwrap_err(),
            "Unknown interrogation override key 'unknown:x'."
        );
    }

    #[test]
    fn validate_envelope_rejects_unsupported_schema_version_directly() {
        let mut envelope = crate::game::test_support::representative_save_envelope();
        envelope.schema_version = 99;
        assert_eq!(
            validate_envelope(&envelope).unwrap_err().code,
            "unsupportedSaveSchemaVersion"
        );
    }
}
