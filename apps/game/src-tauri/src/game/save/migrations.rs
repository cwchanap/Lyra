use crate::game::save::schema::{
    parse_schema_version, SaveEnvelopeV1, SaveEnvelopeV2, SaveSummaryV2, SAVE_SCHEMA_VERSION,
    SAVE_SCHEMA_VERSION_V1, SAVE_SCHEMA_VERSION_V2,
};
use crate::game::GameError;

pub(crate) fn dispatch_current(version: u32) -> Result<(), GameError> {
    if version == SAVE_SCHEMA_VERSION {
        Ok(())
    } else {
        Err(GameError::unsupported_save_schema_version())
    }
}

const MIGRATION_REGISTRY: &[(u32, Option<u32>)] = &[
    (SAVE_SCHEMA_VERSION_V1, Some(SAVE_SCHEMA_VERSION_V2)),
    (SAVE_SCHEMA_VERSION_V2, None),
];

pub(crate) fn migrate_to_current(bytes: &[u8]) -> Result<SaveEnvelopeV2, GameError> {
    migrate_to_current_with_registry(bytes, MIGRATION_REGISTRY)
}

fn migrate_to_current_with_registry(
    bytes: &[u8],
    registry: &[(u32, Option<u32>)],
) -> Result<SaveEnvelopeV2, GameError> {
    let version = parse_schema_version(bytes)?;
    let Some((_, next_version)) = registry
        .iter()
        .find(|(registered, _)| *registered == version)
    else {
        return Err(GameError::unsupported_save_schema_version());
    };
    match version {
        SAVE_SCHEMA_VERSION_V2 => decode_v2(bytes),
        SAVE_SCHEMA_VERSION_V1 => {
            if *next_version != Some(SAVE_SCHEMA_VERSION_V2) {
                return Err(GameError::missing_save_schema_migration());
            }
            let source = decode_v1(bytes)?;
            Ok(migrate_v1_to_v2(source))
        }
        _ => Err(GameError::unsupported_save_schema_version()),
    }
}

fn decode_v1(bytes: &[u8]) -> Result<SaveEnvelopeV1, GameError> {
    serde_json::from_slice(bytes)
        .map_err(|error| GameError::new("malformedSaveJson", error.to_string()))
}

fn decode_v2(bytes: &[u8]) -> Result<SaveEnvelopeV2, GameError> {
    serde_json::from_slice(bytes)
        .map_err(|error| GameError::new("malformedSaveJson", error.to_string()))
}

fn migrate_v1_to_v2(source: SaveEnvelopeV1) -> SaveEnvelopeV2 {
    let SaveEnvelopeV1 {
        schema_version: _,
        content_revision,
        save_id,
        save_type,
        slot,
        saved_at,
        display_name,
        thumbnail,
        summary,
        snapshot,
    } = source;
    SaveEnvelopeV2 {
        schema_version: SAVE_SCHEMA_VERSION_V2,
        content_revision,
        save_id,
        save_type,
        slot,
        saved_at,
        display_name,
        thumbnail,
        summary: SaveSummaryV2 {
            chapter_id: summary.chapter_id,
            chapter_title: summary.chapter_title,
            chapter_summary: None,
            scene_id: summary.scene_id,
            scene_title: summary.scene_title,
            scene_summary: None,
            active_primary_objective_id: summary.active_primary_objective_id,
            active_primary_objective_label: summary.active_primary_objective_label,
            active_primary_objective_summary: None,
        },
        snapshot,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::save::schema::{SaveEnvelopeV1, SaveEnvelopeV2, SaveSummaryV2};

    const REPRESENTATIVE_V1: &str =
        include_str!("../../../tests/fixtures/saves/v1-representative.json");

    fn expected_v2(source: &SaveEnvelopeV1) -> SaveEnvelopeV2 {
        SaveEnvelopeV2 {
            schema_version: 2,
            content_revision: source.content_revision.clone(),
            save_id: source.save_id.clone(),
            save_type: source.save_type,
            slot: source.slot,
            saved_at: source.saved_at.clone(),
            display_name: source.display_name.clone(),
            thumbnail: source.thumbnail.clone(),
            summary: SaveSummaryV2 {
                chapter_id: source.summary.chapter_id.clone(),
                chapter_title: source.summary.chapter_title.clone(),
                chapter_summary: None,
                scene_id: source.summary.scene_id.clone(),
                scene_title: source.summary.scene_title.clone(),
                scene_summary: None,
                active_primary_objective_id: source.summary.active_primary_objective_id.clone(),
                active_primary_objective_label: source
                    .summary
                    .active_primary_objective_label
                    .clone(),
                active_primary_objective_summary: None,
            },
            snapshot: source.snapshot.clone(),
        }
    }

    #[test]
    fn migrates_v1_to_v2_without_inventing_recap_copy() {
        let source: SaveEnvelopeV1 = serde_json::from_str(REPRESENTATIVE_V1).unwrap();

        let migrated = migrate_to_current(REPRESENTATIVE_V1.as_bytes()).unwrap();

        assert_eq!(migrated, expected_v2(&source));
        assert_eq!(migrated.content_revision, source.content_revision);
        assert_eq!(migrated.snapshot, source.snapshot);
    }

    #[test]
    fn passes_a_strict_v2_envelope_through_unchanged() {
        let source_v1: SaveEnvelopeV1 = serde_json::from_str(REPRESENTATIVE_V1).unwrap();
        let source_v2 = expected_v2(&source_v1);
        let bytes = serde_json::to_vec(&source_v2).unwrap();

        assert_eq!(migrate_to_current(&bytes).unwrap(), source_v2);
    }

    #[test]
    fn rejects_unknown_fields_in_each_registered_version() {
        let mut v1: serde_json::Value = serde_json::from_str(REPRESENTATIVE_V1).unwrap();
        v1["unexpected"] = serde_json::json!(true);
        assert_eq!(
            migrate_to_current(v1.to_string().as_bytes())
                .unwrap_err()
                .code,
            "malformedSaveJson"
        );

        let source_v1: SaveEnvelopeV1 = serde_json::from_str(REPRESENTATIVE_V1).unwrap();
        let mut v2 = serde_json::to_value(expected_v2(&source_v1)).unwrap();
        v2["summary"]["unexpected"] = serde_json::json!(true);
        assert_eq!(
            migrate_to_current(v2.to_string().as_bytes())
                .unwrap_err()
                .code,
            "malformedSaveJson"
        );
    }

    #[test]
    fn rejects_future_versions_before_strict_version_specific_decode() {
        let mut future: serde_json::Value = serde_json::from_str(REPRESENTATIVE_V1).unwrap();
        future["schemaVersion"] = serde_json::json!(3);
        future["unexpectedFutureField"] = serde_json::json!(true);

        assert_eq!(
            migrate_to_current(future.to_string().as_bytes())
                .unwrap_err()
                .code,
            "unsupportedSaveSchemaVersion"
        );
    }

    #[test]
    fn reports_a_missing_registry_link_with_its_typed_code() {
        let registry = &[
            (SAVE_SCHEMA_VERSION_V1, None),
            (SAVE_SCHEMA_VERSION_V2, None),
        ];
        assert_eq!(
            migrate_to_current_with_registry(REPRESENTATIVE_V1.as_bytes(), registry)
                .unwrap_err()
                .code,
            "missingSaveSchemaMigration"
        );
    }
}
