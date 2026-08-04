use super::save::capture::{capture_checkpoint, CapturedCheckpoint};
use super::save::restore::{build_restore_candidate, load_current_definitions};
use super::save::schema::{SaveEnvelope, SaveType, ThumbnailDescriptorV1};
use super::schema::InventoryTarget;
use super::story::{AssertionOrigin, StoryEventBlockKind};
use super::support_lineage::SupportLineage;
use super::test_support::save_capture_fixture_resources;
use super::{GameEngine, ModeView};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn provenance(
    procedural_status: &str,
    source_group_id: Option<&str>,
    proof_capabilities: &[&str],
    supersedes_record_id: Option<&str>,
) -> Value {
    json!({
        "sourceKind": "digital",
        "representationLayer": "sync",
        "proceduralStatus": procedural_status,
        "completeness": "complete",
        "confidence": "corroborated",
        "sourceGroupId": source_group_id,
        "sourceLabel": "Station camera export",
        "proofCapabilities": proof_capabilities,
        "supersedesRecordId": supersedes_record_id,
    })
}

fn statement_provenance() -> Value {
    json!({
        "sourceKind": "testimony",
        "representationLayer": "raw",
        "proceduralStatus": "lead",
        "completeness": "complete",
        "confidence": "corroborated",
        "sourceGroupId": "mixed_station_source",
        "sourceLabel": "Station witness interview",
        "proofCapabilities": ["identity", "credibility"],
        "supersedesRecordId": null,
    })
}

fn catalog_record(id: &str, scene_id: &str, provenance: Value) -> Value {
    json!({
        "id": id,
        "chapterId": "chapter_1",
        "sceneId": scene_id,
        "provenance": provenance,
    })
}

fn evidence_definition(
    id: &str,
    procedural_status: &str,
    source_group_id: Option<&str>,
    proof_capabilities: &[&str],
    supersedes_record_id: Option<&str>,
) -> Value {
    json!({
        "id": id,
        "name": id,
        "description": format!("{id} description"),
        "details": format!("{id} details"),
        "imageAssetId": null,
        "provenance": provenance(
            procedural_status,
            source_group_id,
            proof_capabilities,
            supersedes_record_id,
        ),
        "onCollect": [],
        "onReexamine": null,
    })
}

fn hotspot(id: &str, evidence_id: Option<&str>) -> Value {
    json!({
        "id": id,
        "label": id,
        "description": id,
        "status": "unlocked",
        "unlock": null,
        "reveals": evidence_id
            .map(|record_id| vec![json!({"kind": "evidence", "id": record_id})])
            .unwrap_or_default(),
        "inspectDialogue": [],
        "onReexamine": null,
    })
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn write_json(path: &Path, value: &Value) {
    std::fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
}

fn compiler_shaped_resources() -> (tempfile::TempDir, PathBuf) {
    let (guard, resources) = save_capture_fixture_resources();
    let lead = provenance(
        "lead",
        Some("mixed_station_source"),
        &["time", "source"],
        None,
    );
    let reacquired = provenance(
        "reacquired",
        Some("mixed_station_source"),
        &["time", "route", "procedure"],
        Some("evidence:camera_lead"),
    );
    let exhibit = provenance(
        "exhibit",
        Some("mixed_station_source"),
        &["time", "identity", "source", "procedure", "causation"],
        Some("evidence:camera_reacquired"),
    );
    let ungrouped = provenance("lead", None, &["time"], None);
    let statement = statement_provenance();

    let catalog = json!({
        "schemaVersion": 2,
        "facts": [
            {
                "id": "fact_clock",
                "label": "Clock corroboration",
                "summary": "The witness corroborates the clock.",
                "details": "Direct statement support.",
                "category": "timeline"
            },
            {
                "id": "fact_timeline",
                "label": "Camera timeline",
                "summary": "The camera timeline follows from the clock.",
                "details": "Direct and transitive support.",
                "category": "timeline"
            },
            {
                "id": "fact_unknown_source",
                "label": "Unknown-source note",
                "summary": "A source-group diagnostic fixture.",
                "details": "The support record intentionally has no group.",
                "category": "procedure"
            }
        ],
        "questions": [],
        "objectives": [],
        "authorizations": [],
        "sourceGroups": [{
            "id": "mixed_station_source",
            "label": "Station camera and witness source",
            "summary": "Compiler-derived mixed evidence and statement membership.",
            "members": [
                {"kind": "evidence", "id": "camera_exhibit"},
                {"kind": "evidence", "id": "camera_lead"},
                {"kind": "evidence", "id": "camera_reacquired"},
                {"kind": "statement", "id": "camera_exhibit"}
            ]
        }],
        "evidenceIndex": [
            catalog_record("camera_exhibit", "investigation_scene_1", exhibit.clone()),
            catalog_record("camera_lead", "investigation_scene_1", lead.clone()),
            catalog_record(
                "camera_reacquired",
                "investigation_scene_1",
                reacquired.clone(),
            ),
            catalog_record(
                "ungrouped_note",
                "investigation_scene_1",
                ungrouped.clone(),
            )
        ],
        "statementsIndex": [
            catalog_record(
                "camera_exhibit",
                "interrogation_scene_2",
                statement.clone(),
            )
        ]
    });
    write_json(&resources.join("story_catalog.json"), &catalog);

    let investigation_path = resources.join("chapter_1/investigation_scene_1.json");
    let mut investigation = read_json(&investigation_path);
    investigation["intro"] = json!([]);
    investigation["sublocations"][0]["transitionDialogue"] = json!([]);
    investigation["sublocations"][0]["hotspots"] = json!([
        hotspot("exhibit_terminal", Some("camera_exhibit")),
        hotspot("lead_terminal", Some("camera_lead")),
        hotspot("reacquired_terminal", Some("camera_reacquired")),
        hotspot("finish", None),
    ]);
    investigation["evidenceManifest"] = json!([
        evidence_definition(
            "camera_exhibit",
            "exhibit",
            Some("mixed_station_source"),
            &["time", "identity", "source", "procedure", "causation"],
            Some("evidence:camera_reacquired"),
        ),
        evidence_definition(
            "camera_lead",
            "lead",
            Some("mixed_station_source"),
            &["time", "source"],
            None,
        ),
        evidence_definition(
            "camera_reacquired",
            "reacquired",
            Some("mixed_station_source"),
            &["time", "route", "procedure"],
            Some("evidence:camera_lead"),
        ),
        evidence_definition("ungrouped_note", "lead", None, &["time"], None),
    ]);
    investigation["statementManifest"] = json!([]);
    investigation["outro"] = json!({
        "unlock": {"predicate": "hotspot_investigated", "id": "finish"},
        "dialogue": []
    });
    write_json(&investigation_path, &investigation);

    let interrogation_path = resources.join("chapter_1/interrogation_scene_2.json");
    let mut interrogation = read_json(&interrogation_path);
    interrogation["statementManifest"] = json!([{
        "id": "camera_exhibit",
        "speaker": "Witness",
        "content": "The station clock matched the camera clock.",
        "provenance": statement,
        "onAcquire": [],
        "onReexamine": null
    }]);
    interrogation["phases"][1]["questions"][0]["testimony"]["lines"][0]["contradiction"] =
        json!({"kind": "evidence", "id": "camera_exhibit"});
    write_json(&interrogation_path, &interrogation);

    (guard, resources)
}

fn drain_dialogue(engine: &mut GameEngine) {
    for _ in 0..16 {
        let view = engine.view().unwrap();
        let ModeView::Dialogue { queue_token, .. } = view.mode else {
            return;
        };
        engine.advance_dialogue(queue_token).unwrap();
    }
    let view = engine.view().unwrap();
    if !matches!(view.mode, ModeView::Dialogue { .. }) {
        return;
    }
    panic!("fixture dialogue did not drain");
}

fn assert_fact(
    engine: &mut GameEngine,
    fact_id: &str,
    supporting_records: &[InventoryTarget],
    supporting_fact_ids: &[&str],
) {
    engine
        .story_state
        .assert_fact(
            &engine.story_catalog,
            fact_id,
            AssertionOrigin::SceneEvent {
                chapter_id: "chapter_1".into(),
                scene_id: "investigation_scene_1".into(),
                block_kind: StoryEventBlockKind::Hotspot,
                block_id: "exhibit_terminal".into(),
            },
            supporting_records,
            &supporting_fact_ids
                .iter()
                .map(|id| (*id).to_string())
                .collect::<Vec<_>>(),
        )
        .unwrap();
}

fn save_envelope(engine: &GameEngine, checkpoint: CapturedCheckpoint) -> SaveEnvelope {
    SaveEnvelope {
        schema_version: 2,
        content_revision: engine.content_manifest.content_revision().into(),
        save_id: "550e8400-e29b-41d4-a716-446655440256".into(),
        save_type: SaveType::Manual,
        slot: 2,
        saved_at: "2026-07-30T12:34:56Z".into(),
        display_name: "Provenance integration".into(),
        thumbnail: ThumbnailDescriptorV1::Unavailable,
        summary: checkpoint.summary,
        snapshot: checkpoint.snapshot,
    }
}

#[test]
fn restored_engine_rebuilds_story_locations_from_the_current_package() {
    let (_guard, resources) = compiler_shaped_resources();
    let engine = GameEngine::new_started(resources.clone()).unwrap();
    let checkpoint = capture_checkpoint(&engine).unwrap();
    let definitions = load_current_definitions(&resources).unwrap();

    let restored =
        build_restore_candidate(resources, &definitions, save_envelope(&engine, checkpoint))
            .unwrap();
    let location = restored
        .engine
        .story_locations
        .resolve_scene("chapter_1", "investigation_scene_1")
        .unwrap();

    assert_eq!(location.chapter_title, "Chapter One");
    assert_eq!(location.scene_title, "Investigation");
}

fn fact<'a>(view: &'a Value, id: &str) -> &'a Value {
    view["story"]["facts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|fact| fact["id"] == id)
        .unwrap()
}

#[test]
fn compiler_shaped_provenance_lineage_and_public_redaction_survive_exact_restore() {
    let (_guard, resources) = compiler_shaped_resources();
    let mut engine = GameEngine::new_started(resources.clone()).unwrap();
    drain_dialogue(&mut engine);

    assert_eq!(
        engine
            .story_catalog
            .chain(&InventoryTarget::Evidence {
                id: "camera_exhibit".into(),
            })
            .unwrap(),
        vec![
            InventoryTarget::Evidence {
                id: "camera_lead".into(),
            },
            InventoryTarget::Evidence {
                id: "camera_reacquired".into(),
            },
            InventoryTarget::Evidence {
                id: "camera_exhibit".into(),
            },
        ]
    );
    assert_eq!(
        serde_json::to_value(
            &engine
                .story_catalog
                .source_group("mixed_station_source")
                .unwrap()
                .members
        )
        .unwrap(),
        json!([
            {"kind": "evidence", "id": "camera_exhibit"},
            {"kind": "evidence", "id": "camera_lead"},
            {"kind": "evidence", "id": "camera_reacquired"},
            {"kind": "statement", "id": "camera_exhibit"}
        ]),
        "typed namespaces must retain same-slug evidence and statement members"
    );

    let successor_first = engine.inspect_hotspot("exhibit_terminal").unwrap();
    let successor = successor_first
        .inventory
        .evidence
        .iter()
        .find(|record| record.id == "camera_exhibit")
        .unwrap();
    assert_eq!(successor.provenance.supersedes_record_id, None);
    assert_eq!(
        serde_json::to_value(&successor.provenance).unwrap()["proofCapabilities"],
        json!(["time", "identity", "source", "procedure", "causation"])
    );
    assert_eq!(successor.acquisition_context.chapter_title, "Chapter One");
    assert_eq!(successor.acquisition_context.scene_title, "Investigation");
    let source_group = successor.source_group.as_ref().unwrap();
    assert_eq!(source_group.label, "Station camera and witness source");
    assert_eq!(
        serde_json::to_value(source_group).unwrap()["members"],
        Value::Null,
        "acquired-record source groups must not expose catalog membership"
    );
    assert!(
        successor_first
            .inventory
            .evidence
            .iter()
            .all(|record| record.id != "camera_reacquired"),
        "successor-first acquisition must not reveal its future predecessor"
    );

    assert_fact(
        &mut engine,
        "fact_clock",
        &[InventoryTarget::Statement {
            id: "camera_exhibit".into(),
        }],
        &[],
    );
    assert_fact(
        &mut engine,
        "fact_timeline",
        &[InventoryTarget::Evidence {
            id: "camera_exhibit".into(),
        }],
        &["fact_clock"],
    );
    assert_fact(
        &mut engine,
        "fact_unknown_source",
        &[InventoryTarget::Evidence {
            id: "ungrouped_note".into(),
        }],
        &[],
    );

    let lineage = SupportLineage::new(&engine.story_catalog, &engine.story_state);
    assert_eq!(
        lineage.direct_records("fact_timeline").unwrap(),
        BTreeSet::from([InventoryTarget::Evidence {
            id: "camera_exhibit".into(),
        }])
    );
    assert_eq!(
        serde_json::to_value(lineage.transitive_records("fact_timeline").unwrap()).unwrap(),
        json!([
            {"kind": "evidence", "id": "camera_exhibit"},
            {"kind": "statement", "id": "camera_exhibit"}
        ]),
        "internal closure must retain distinct same-slug evidence and unacquired statement support"
    );
    assert_eq!(
        lineage.transitive_facts("fact_timeline").unwrap(),
        BTreeSet::from(["fact_clock".into()])
    );
    let complete = lineage
        .transitive_source_group_closure("fact_timeline")
        .unwrap();
    assert_eq!(
        complete.groups,
        BTreeSet::from(["mixed_station_source".into()])
    );
    assert!(complete.missing_group_records.is_empty());
    assert_eq!(
        lineage.transitive_source_groups("fact_timeline").unwrap(),
        BTreeSet::from(["mixed_station_source".into()])
    );
    let diagnostic = lineage
        .transitive_source_group_closure("fact_unknown_source")
        .unwrap();
    assert!(diagnostic.groups.is_empty());
    assert_eq!(
        diagnostic.missing_group_records,
        BTreeSet::from([InventoryTarget::Evidence {
            id: "ungrouped_note".into(),
        }])
    );
    assert_eq!(
        lineage
            .transitive_source_groups("fact_unknown_source")
            .unwrap_err()
            .code,
        "missingCaseRecordSourceGroup"
    );

    engine.inspect_hotspot("lead_terminal").unwrap();
    let before_restore = serde_json::to_value(engine.view().unwrap()).unwrap();
    assert_eq!(
        before_restore["inventory"]["evidence"]
            .as_array()
            .unwrap()
            .iter()
            .map(|record| record["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["camera_exhibit", "camera_lead"],
        "public evidence must follow the hotspot acquisition sequence"
    );
    assert_eq!(
        before_restore["inventory"]["evidence"][0]["provenance"]["supersedesRecordId"],
        Value::Null
    );
    let lead = before_restore["inventory"]["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["id"] == "camera_lead")
        .unwrap();
    assert!(lead.get("successorRecordId").is_none());
    assert_eq!(lead["provenance"]["supersedesRecordId"], Value::Null);
    assert_eq!(
        fact(&before_restore, "fact_timeline")["supportingRecords"],
        json!([{"kind": "evidence", "id": "camera_exhibit"}])
    );
    assert_eq!(
        fact(&before_restore, "fact_clock")["supportingRecords"],
        json!([])
    );
    assert_eq!(
        fact(&before_restore, "fact_clock")["originContext"],
        json!({
            "originKind": "sceneEvent",
            "location": {
                "chapterId": "chapter_1",
                "chapterTitle": "Chapter One",
                "sceneId": "investigation_scene_1",
                "sceneTitle": "Investigation"
            }
        }),
        "public facts must retain their exact origin while exposing packaged scene titles"
    );
    assert!(fact(&before_restore, "fact_clock")
        .get("hasHiddenSupportingRecords")
        .is_none());
    assert!(before_restore["inventory"]["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .all(|record| record.get("successorRecordId").is_none()));

    let checkpoint = capture_checkpoint(&engine).unwrap();
    let envelope = save_envelope(&engine, checkpoint.clone());
    let encoded = serde_json::to_vec(&envelope).unwrap();
    let parsed = super::save::schema::parse_current_envelope(&encoded).unwrap();
    let definitions = load_current_definitions(&resources).unwrap();
    let mut restored = build_restore_candidate(resources.clone(), &definitions, parsed).unwrap();

    assert_eq!(
        capture_checkpoint(&restored.engine).unwrap(),
        checkpoint,
        "restored immutable definitions and direct support must recapture exactly"
    );
    assert_eq!(
        serde_json::to_value(restored.engine.view().unwrap()).unwrap(),
        before_restore
    );
    let restored_lineage =
        SupportLineage::new(&restored.engine.story_catalog, &restored.engine.story_state);
    assert_eq!(
        serde_json::to_value(
            restored_lineage
                .transitive_records("fact_timeline")
                .unwrap()
        )
        .unwrap(),
        json!([
            {"kind": "evidence", "id": "camera_exhibit"},
            {"kind": "statement", "id": "camera_exhibit"}
        ])
    );
    assert_eq!(
        restored_lineage
            .transitive_source_groups("fact_timeline")
            .unwrap(),
        BTreeSet::from(["mixed_station_source".into()])
    );

    let predecessor_acquired = restored
        .engine
        .inspect_hotspot("reacquired_terminal")
        .unwrap();
    let exhibit = predecessor_acquired
        .inventory
        .evidence
        .iter()
        .find(|record| record.id == "camera_exhibit")
        .unwrap();
    assert_eq!(
        exhibit.provenance.supersedes_record_id.as_deref(),
        Some("evidence:camera_reacquired"),
        "public predecessor redaction must be recomputed after later acquisition"
    );
    let reacquired = predecessor_acquired
        .inventory
        .evidence
        .iter()
        .find(|record| record.id == "camera_reacquired")
        .unwrap();
    assert_eq!(
        reacquired.provenance.supersedes_record_id.as_deref(),
        Some("evidence:camera_lead")
    );
}
