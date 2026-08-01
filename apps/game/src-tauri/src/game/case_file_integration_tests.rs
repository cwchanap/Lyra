use super::save::capture::{capture_checkpoint_v2, CapturedCheckpointV2};
use super::save::restore::{build_restore_candidate, load_current_definitions};
use super::save::schema::{SaveEnvelopeV2, SaveType, ThumbnailDescriptorV1};
use super::scenes::SceneRuntime;
use super::schema::InventoryTarget;
use super::story::{AssertionOrigin, StoryEventBlockKind};
use super::test_support::case_file_acceptance_fixture_resources;
use super::GameEngine;
use serde_json::{json, Value};

const LOCKED_IDS: [&str; 6] = [
    "future_scan",
    "locked_statement",
    "fact_locked",
    "question_locked",
    "objective_locked",
    "authorization_locked",
];

fn acquire_fixture_records(engine: &mut GameEngine) {
    let SceneRuntime::Investigation(scene) = &engine.scene else {
        panic!("acceptance fixture must start in an investigation scene");
    };
    let evidence = scene.def.evidence_manifest.clone();
    let statements = scene.def.statement_manifest.clone();

    for id in [
        "neutral_note",
        "shared_record",
        "signed_scan",
        "orphan_scan",
    ] {
        let definition = evidence
            .iter()
            .find(|definition| definition.id == id)
            .unwrap_or_else(|| panic!("missing fixture evidence '{id}'"));
        assert!(engine.inventory.add_evidence_from_def(
            definition,
            "synthetic_chapter",
            "synthetic_case_file"
        ));
    }
    let statement = statements
        .iter()
        .find(|definition| definition.id == "shared_record")
        .expect("missing fixture statement 'shared_record'");
    assert!(engine.inventory.add_statement_from_def(
        statement,
        "synthetic_chapter",
        "synthetic_case_file"
    ));
}

fn reveal_fixture_story_state(engine: &mut GameEngine) {
    engine
        .story_state
        .set_primary_objective(&engine.story_catalog, false, Some("objective_primary"))
        .unwrap();
    for id in ["objective_secondary_a", "objective_secondary_b"] {
        engine
            .story_state
            .reveal_objective(&engine.story_catalog, id)
            .unwrap();
    }
    for id in [
        "objective_completed_1",
        "objective_completed_2",
        "objective_completed_3",
        "objective_completed_4",
    ] {
        engine
            .story_state
            .complete_objective(&engine.story_catalog, id)
            .unwrap();
    }

    let origin = || AssertionOrigin::SceneEvent {
        chapter_id: "synthetic_chapter".into(),
        scene_id: "synthetic_case_file".into(),
        block_kind: StoryEventBlockKind::Hotspot,
        block_id: "acceptance_fixture".into(),
    };
    engine
        .story_state
        .assert_fact(
            &engine.story_catalog,
            "fact_clock",
            origin(),
            &[InventoryTarget::Evidence {
                id: "neutral_note".into(),
            }],
            &[],
        )
        .unwrap();
    engine
        .story_state
        .assert_fact(
            &engine.story_catalog,
            "fact_route",
            origin(),
            &[InventoryTarget::Statement {
                id: "shared_record".into(),
            }],
            &["fact_clock".into()],
        )
        .unwrap();
    engine
        .story_state
        .reveal_question(&engine.story_catalog, "question_open")
        .unwrap();
    engine
        .story_state
        .resolve_question(&engine.story_catalog, "question_resolved", "fact_route")
        .unwrap();
    engine
        .story_state
        .grant_authorization(
            &engine.story_catalog,
            "authorization_archive",
            AssertionOrigin::SceneEvent {
                chapter_id: "synthetic_chapter".into(),
                scene_id: "synthetic_case_file".into(),
                block_kind: StoryEventBlockKind::Hotspot,
                block_id: "acceptance_fixture".into(),
            },
        )
        .unwrap();
}

fn case_file_inputs(view: &Value) -> Value {
    json!({
        "inventory": view["inventory"],
        "story": view["story"],
    })
}

fn save_envelope(engine: &GameEngine, checkpoint: CapturedCheckpointV2) -> SaveEnvelopeV2 {
    SaveEnvelopeV2 {
        schema_version: 2,
        content_revision: engine.content_manifest.content_revision().into(),
        save_id: "550e8400-e29b-41d4-a716-446655440258".into(),
        save_type: SaveType::Manual,
        slot: 1,
        saved_at: "2026-07-31T12:34:56Z".into(),
        display_name: "Synthetic Case File acceptance".into(),
        thumbnail: ThumbnailDescriptorV1::Unavailable,
        summary: checkpoint.summary,
        snapshot: checkpoint.snapshot,
    }
}

fn ids(value: &Value, pointer: &str) -> Vec<String> {
    value
        .pointer(pointer)
        .unwrap_or_else(|| panic!("missing array at '{pointer}'"))
        .as_array()
        .unwrap_or_else(|| panic!("value at '{pointer}' is not an array"))
        .iter()
        .map(|item| {
            item["id"]
                .as_str()
                .unwrap_or_else(|| panic!("item at '{pointer}' has no id"))
                .to_owned()
        })
        .collect()
}

fn record<'a>(view: &'a Value, collection: &str, id: &str) -> &'a Value {
    view["inventory"][collection]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["id"] == id)
        .unwrap_or_else(|| panic!("missing public {collection} record '{id}'"))
}

#[test]
fn case_file_acceptance_is_spoiler_safe_and_preserves_complete_public_inputs_on_restore() {
    let (_guard, resources) = case_file_acceptance_fixture_resources();
    let mut engine = GameEngine::new_started(resources.clone()).unwrap();
    acquire_fixture_records(&mut engine);
    reveal_fixture_story_state(&mut engine);

    let before = serde_json::to_value(engine.view().unwrap()).unwrap();
    assert_eq!(
        ids(&before, "/inventory/evidence"),
        [
            "neutral_note",
            "shared_record",
            "signed_scan",
            "orphan_scan"
        ],
        "evidence must retain acquisition order"
    );
    assert_eq!(
        ids(&before, "/inventory/statements"),
        ["shared_record"],
        "statement acquisition order must remain independent from evidence"
    );
    let public_records = before["inventory"]["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .chain(before["inventory"]["statements"].as_array().unwrap());
    let neutral_provenance = json!({
        "sourceKind": "unspecified",
        "representationLayer": "none",
        "proceduralStatus": "unspecified",
        "completeness": "unspecified",
        "confidence": "unspecified",
        "sourceGroupId": null,
        "sourceLabel": null,
        "proofCapabilities": [],
        "supersedesRecordId": null
    });
    assert_eq!(
        public_records
            .clone()
            .filter(|record| record["provenance"] == neutral_provenance)
            .count(),
        1,
        "the populated public fixture has exactly one neutral legacy record"
    );
    assert_eq!(
        public_records
            .filter(|record| {
                !record["sourceGroup"].is_null()
                    && record["provenance"]["proofCapabilities"]
                        .as_array()
                        .is_some_and(|capabilities| !capabilities.is_empty())
            })
            .count(),
        1,
        "the populated public fixture has exactly one grouped proof-capable record"
    );
    assert_eq!(ids(&before, "/story/facts"), ["fact_clock", "fact_route"]);
    assert_eq!(
        ids(&before, "/story/questions"),
        ["question_open", "question_resolved"]
    );
    assert_eq!(
        ids(&before, "/story/objectives"),
        [
            "objective_primary",
            "objective_secondary_a",
            "objective_secondary_b",
            "objective_completed_1",
            "objective_completed_2",
            "objective_completed_3",
            "objective_completed_4",
        ]
    );
    assert_eq!(
        ids(&before, "/story/authorizations"),
        ["authorization_archive"]
    );

    for collection in ["evidence", "statements"] {
        for item in before["inventory"][collection].as_array().unwrap() {
            assert_eq!(
                item["acquisitionContext"],
                json!({
                    "chapterId": "synthetic_chapter",
                    "chapterTitle": "合成測試章",
                    "sceneId": "synthetic_case_file",
                    "sceneTitle": "案件檔案測試室"
                })
            );
        }
    }
    assert_eq!(
        before["story"]["facts"][0]["originContext"]["location"],
        json!({
            "chapterId": "synthetic_chapter",
            "chapterTitle": "合成測試章",
            "sceneId": "synthetic_case_file",
            "sceneTitle": "案件檔案測試室"
        })
    );
    assert_eq!(
        before["story"]["authorizations"][0]["originContext"]["location"],
        json!({
            "chapterId": "synthetic_chapter",
            "chapterTitle": "合成測試章",
            "sceneId": "synthetic_case_file",
            "sceneTitle": "案件檔案測試室"
        })
    );

    let grouped_statement = record(&before, "statements", "shared_record");
    assert_eq!(
        grouped_statement["sourceGroup"],
        json!({
            "id": "synthetic_bundle",
            "label": "合成來源組",
            "summary": "只公開玩家已取得紀錄所需的來源摘要。"
        }),
        "grouped statements serialize their public source-group summary"
    );
    assert!(
        grouped_statement["sourceGroup"].get("members").is_none(),
        "source-group membership must remain catalog-private"
    );
    assert_eq!(
        record(&before, "evidence", "signed_scan")["provenance"]["supersedesRecordId"],
        "statement:shared_record"
    );
    assert_eq!(
        record(&before, "evidence", "orphan_scan")["provenance"]["supersedesRecordId"],
        Value::Null,
        "an acquired record must not expose an unrevealed predecessor"
    );
    assert!(
        record(&before, "evidence", "signed_scan")
            .get("successorRecordId")
            .is_none(),
        "an acquired record must not expose a future successor"
    );

    let encoded = serde_json::to_string(&case_file_inputs(&before)).unwrap();
    for locked_id in LOCKED_IDS {
        assert!(
            !encoded.contains(locked_id),
            "locked catalog id '{locked_id}' leaked into the public Case File"
        );
    }

    let checkpoint = capture_checkpoint_v2(&engine).unwrap();
    let definitions = load_current_definitions(&resources).unwrap();
    let restored = build_restore_candidate(
        resources,
        &definitions,
        save_envelope(&engine, checkpoint.clone()),
    )
    .unwrap();
    assert_eq!(
        capture_checkpoint_v2(&restored.engine).unwrap(),
        checkpoint,
        "SaveSnapshotV1 capture/restore must retain exact identity"
    );
    let after = serde_json::to_value(restored.engine.view().unwrap()).unwrap();
    assert_eq!(
        case_file_inputs(&after),
        case_file_inputs(&before),
        "restore must rebuild every public Case File input exactly"
    );
}
