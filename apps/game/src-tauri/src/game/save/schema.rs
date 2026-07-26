use crate::game::dialogue_queue::ActiveDialogueStateV1;
use crate::game::schema::AudioChannelJson;
use crate::game::story::StoryStateSnapshot;
use crate::game::{DialogueHistoryEntry, GameError, QueueToken};
use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use unicode_segmentation::UnicodeSegmentation;

pub(crate) const SAVE_SCHEMA_VERSION: u32 = 1;
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveSummary {
    pub(crate) chapter_id: String,
    pub(crate) chapter_title: String,
    pub(crate) scene_id: String,
    pub(crate) scene_title: String,
    pub(crate) active_primary_objective_id: Option<String>,
    pub(crate) active_primary_objective_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveEnvelopeV1 {
    pub(crate) schema_version: u32,
    pub(crate) content_revision: String,
    pub(crate) save_id: String,
    pub(crate) save_type: SaveType,
    pub(crate) slot: u8,
    pub(crate) saved_at: String,
    pub(crate) display_name: String,
    pub(crate) thumbnail: ThumbnailDescriptorV1,
    pub(crate) summary: SaveSummary,
    pub(crate) snapshot: SaveSnapshotV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveSnapshotV1 {
    pub(crate) chapter_id: String,
    pub(crate) scene_id: String,
    pub(crate) scene: SceneProgressSnapshotV1,
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
pub(crate) enum SceneProgressSnapshotV1 {
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CharacterTopicRefV1 {
    pub(crate) character_id: String,
    pub(crate) topic_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
pub(crate) enum RecordKind {
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
    pub(crate) entries: Vec<DialogueHistoryEntry>,
    pub(crate) next_id: u64,
    pub(crate) last_token: Option<QueueToken>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionOnly {
    schema_version: u32,
}

pub(crate) fn parse_current_envelope(bytes: &[u8]) -> Result<SaveEnvelopeV1, GameError> {
    let version = serde_json::from_slice::<VersionOnly>(bytes)
        .map_err(|error| GameError::new("malformedSaveJson", error.to_string()))?
        .schema_version;
    if version != SAVE_SCHEMA_VERSION {
        return Err(GameError::new(
            "unsupportedSaveSchemaVersion",
            format!("Save schema version {version} is unsupported."),
        ));
    }
    let envelope = serde_json::from_slice::<SaveEnvelopeV1>(bytes)
        .map_err(|error| GameError::new("malformedSaveJson", error.to_string()))?;
    validate_envelope(&envelope)?;
    Ok(envelope)
}

fn validate_envelope(envelope: &SaveEnvelopeV1) -> Result<(), GameError> {
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
    let parsed: DateTime<FixedOffset> = DateTime::parse_from_rfc3339(&envelope.saved_at)
        .map_err(|_| GameError::new("malformedSaveJson", "Save timestamp is not RFC 3339."))?;
    if parsed.offset().local_minus_utc() != 0 {
        return Err(GameError::new(
            "malformedSaveJson",
            "Save timestamp must be UTC.",
        ));
    }
    validate_manual_display_name(&envelope.display_name)?;
    super::thumbnail::validate_descriptor(&envelope.save_id, &envelope.thumbnail)?;
    Ok(())
}

pub(crate) fn canonical_uuid_v4(input: &str) -> Result<uuid::Uuid, GameError> {
    let parsed = uuid::Uuid::parse_str(input)
        .map_err(|_| GameError::new("malformedSaveJson", "Save ID is not a UUID."))?;
    if parsed.get_version_num() != 4 || parsed.hyphenated().to_string() != input {
        return Err(GameError::new(
            "malformedSaveJson",
            "Save ID is not a canonical UUID v4.",
        ));
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

    const REPRESENTATIVE: &str =
        include_str!("../../../tests/fixtures/saves/v1-representative.json");

    #[test]
    fn v1_representative_fixture_round_trips_exactly() {
        let save: SaveEnvelopeV1 = serde_json::from_str(REPRESENTATIVE).unwrap();
        assert_eq!(
            format!("{}\n", serde_json::to_string(&save).unwrap()),
            REPRESENTATIVE
        );
        assert_eq!(
            serde_json::from_str::<SaveEnvelopeV1>(REPRESENTATIVE).unwrap(),
            save
        );
    }

    #[test]
    fn current_dispatch_rejects_unknown_and_wrong_dialect_fields() {
        for input in [
            r#"{\"schemaVersion\":1,\"unexpected\":true}"#,
            r#"{\"schema_version\":1}"#,
            r#"{\"schemaVersion\":2}"#,
            r#"{}"#,
        ] {
            assert!(parse_current_envelope(input.as_bytes()).is_err(), "{input}");
        }
    }

    #[test]
    fn closed_envelope_rejects_nested_unknown_fields_and_wrong_enum_dialect() {
        let mut nested: serde_json::Value = serde_json::from_str(REPRESENTATIVE).unwrap();
        nested["snapshot"]["scene"]["unknown"] = serde_json::json!(true);
        assert_eq!(
            parse_current_envelope(nested.to_string().as_bytes())
                .unwrap_err()
                .code,
            "malformedSaveJson"
        );

        let wrong_enum = REPRESENTATIVE.replace("\"manual\"", "\"Manual\"");
        assert_eq!(
            parse_current_envelope(wrong_enum.as_bytes())
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
            assert!(canonical_uuid_v4(invalid).is_err(), "{invalid}");
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

    #[test]
    fn envelope_validation_rejects_slot_timestamp_and_thumbnail_drift() {
        let mut invalid: serde_json::Value = serde_json::from_str(REPRESENTATIVE).unwrap();
        invalid["slot"] = serde_json::json!(4);
        assert_eq!(
            parse_current_envelope(invalid.to_string().as_bytes())
                .unwrap_err()
                .code,
            "saveSlotMismatch"
        );

        let mut invalid: serde_json::Value = serde_json::from_str(REPRESENTATIVE).unwrap();
        invalid["savedAt"] = serde_json::json!("2026-07-26T12:34:56+01:00");
        assert_eq!(
            parse_current_envelope(invalid.to_string().as_bytes())
                .unwrap_err()
                .code,
            "malformedSaveJson"
        );

        let mut invalid: serde_json::Value = serde_json::from_str(REPRESENTATIVE).unwrap();
        invalid["thumbnail"]["objectId"] =
            serde_json::json!("650e8400-e29b-41d4-a716-446655440000");
        assert_eq!(
            parse_current_envelope(invalid.to_string().as_bytes())
                .unwrap_err()
                .code,
            "thumbnailPngMalformed"
        );
    }
}
