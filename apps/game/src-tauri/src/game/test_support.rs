// src-tauri/src/game/test_support.rs
//
// Shared test fixtures for the `game` module tree. Declared `#[cfg(test)]`
// from `mod.rs`; every item is `pub(super)` so sibling test modules
// (`dialogue::tests`, `navigation::tests`, `command_tx::tests`, `tests`)
// can reach them as `crate::game::test_support::*`.

use super::*;
use crate::game::scenes::interrogation::InterrogationSceneState;
use crate::game::schema::{
    AutoMarker, EvidenceJson, InquiryQuestionJson, InterrogationOutroJson,
    InterrogationOutroUnlock, InterrogationPhaseJson, InterrogationSceneJson,
    InterrogationUnlockExpr, InvestigationSceneJson, LockStatus, OutroJson, OutroUnlock, SceneType,
    SubjectJson, SublocationJson, TestimonyJson, TestimonyLineJson, VisualAssetCueJson,
};
use crate::game::state::SceneRef;
use crate::game::view::DialogueHistoryEntry;
use std::path::Path;

pub(super) fn test_content_manifest() -> crate::game::content_manifest::ContentManifest {
    crate::game::content_manifest::ContentManifest::for_test()
}

pub(super) fn representative_save_envelope() -> crate::game::save::schema::SaveEnvelopeV2 {
    crate::game::save::migrations::migrate_to_current(include_bytes!(
        "../../tests/fixtures/saves/v1-representative.json"
    ))
    .unwrap()
}

/// Minimal PNG header fixture (signature + IHDR) used by save-coordinator and
/// thumbnail tests that only need a byte payload shaped like a PNG. Shared so
/// the three former local copies (flush, ticket, storage_integration) cannot
/// drift. The payload is not a decodable image; tests that need a real PNG
/// construct their own.
pub(super) fn png_fixture(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes.extend_from_slice(&[0, 0, 0, 0]);
    bytes
}

pub(super) fn write_content_manifest(dir: &Path) {
    std::fs::write(
        dir.join("save_content_manifest.json"),
        r#"{
  "manifestVersion": 1,
  "contentRevision": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}
"#,
    )
    .unwrap();
}

pub fn write_empty_story_catalog_and_content_manifest(dir: &Path) {
    std::fs::write(
        dir.join("story_catalog.json"),
        r#"{
  "schemaVersion": 2,
  "facts": [],
  "questions": [],
  "objectives": [],
  "authorizations": [],
  "sourceGroups": [],
  "evidenceIndex": [],
  "statementsIndex": []
}
"#,
    )
    .unwrap();
    write_content_manifest(dir);
}

pub(super) fn write_neutral_story_catalog(
    dir: &Path,
    evidence: &[(&str, &str, &str)],
    statements: &[(&str, &str, &str)],
) {
    let record_json = |(id, chapter_id, scene_id): &(&str, &str, &str)| {
        serde_json::json!({
            "id": id,
            "chapterId": chapter_id,
            "sceneId": scene_id,
            "provenance": neutral_provenance_json()
        })
    };
    std::fs::write(
        dir.join("story_catalog.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 2,
            "facts": [],
            "questions": [],
            "objectives": [],
            "authorizations": [],
            "sourceGroups": [],
            "evidenceIndex": evidence.iter().map(record_json).collect::<Vec<_>>(),
            "statementsIndex": statements.iter().map(record_json).collect::<Vec<_>>(),
        }))
        .unwrap(),
    )
    .unwrap();
}

pub(super) fn neutral_provenance_json() -> serde_json::Value {
    serde_json::to_value(crate::game::provenance::CaseRecordProvenance::default()).unwrap()
}

pub(super) fn catalog_with_case_records(
    evidence: Vec<(
        &str,
        &str,
        &str,
        crate::game::provenance::CaseRecordProvenance,
    )>,
    statements: Vec<(
        &str,
        &str,
        &str,
        crate::game::provenance::CaseRecordProvenance,
    )>,
) -> crate::game::story::StoryCatalog {
    catalog_with_case_records_and_source_groups(evidence, statements, vec![])
}

pub(super) fn catalog_with_case_records_and_source_groups(
    evidence: Vec<(
        &str,
        &str,
        &str,
        crate::game::provenance::CaseRecordProvenance,
    )>,
    statements: Vec<(
        &str,
        &str,
        &str,
        crate::game::provenance::CaseRecordProvenance,
    )>,
    source_groups: Vec<serde_json::Value>,
) -> crate::game::story::StoryCatalog {
    let dir = tempfile::tempdir().unwrap();
    let record_json = |(id, chapter_id, scene_id, provenance)| {
        serde_json::json!({
            "id": id,
            "chapterId": chapter_id,
            "sceneId": scene_id,
            "provenance": provenance,
        })
    };
    std::fs::write(
        dir.path().join("story_catalog.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 2,
            "facts": [],
            "questions": [],
            "objectives": [],
            "authorizations": [],
            "sourceGroups": source_groups,
            "evidenceIndex": evidence.into_iter().map(record_json).collect::<Vec<_>>(),
            "statementsIndex": statements.into_iter().map(record_json).collect::<Vec<_>>(),
        }))
        .unwrap(),
    )
    .unwrap();
    crate::game::story::StoryCatalog::load(dir.path()).unwrap()
}

pub(crate) fn investigation_scene_with_intro(
    id: &str,
    intro: Vec<DialogueItem>,
) -> InvestigationSceneJson {
    InvestigationSceneJson {
        id: id.into(),
        title: id.into(),
        summary: "Summary".into(),
        asset_refs: vec![],
        intro,
        sublocations: vec![SublocationJson {
            id: "room".into(),
            label: "Room".into(),
            status: LockStatus::Unlocked,
            unlock: None,
            reveals: vec![],
            scene_tag: "room".into(),
            flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
            transition_dialogue: vec![],
            hotspots: vec![],
            characters: vec![],
        }],
        evidence_manifest: vec![],
        statement_manifest: vec![],
        outro: OutroJson {
            unlock: OutroUnlock::Auto(crate::game::schema::AutoMarker::Auto),
            dialogue: vec![],
        },
    }
}
pub(crate) fn empty_engine_with_scene(
    scene: InvestigationSceneJson,
    intro_queue_gen: u64,
) -> GameEngine {
    let story_catalog = catalog_with_case_records(
        scene
            .evidence_manifest
            .iter()
            .map(|definition| {
                (
                    definition.id.as_str(),
                    "chapter_1",
                    scene.id.as_str(),
                    definition.provenance.clone(),
                )
            })
            .collect(),
        scene
            .statement_manifest
            .iter()
            .map(|definition| {
                (
                    definition.id.as_str(),
                    "chapter_1",
                    scene.id.as_str(),
                    definition.provenance.clone(),
                )
            })
            .collect(),
    );
    GameEngine {
        resources_dir: PathBuf::new(),
        content_manifest: test_content_manifest(),
        chapters: vec![ChapterManifest {
            id: "chapter_1".into(),
            title: "Chapter 1".into(),
            summary: "summary".into(),
            scenes: vec![SceneRef {
                scene_type: SceneType::Investigation,
                file: "chapter_1/investigation_scene_1.json".into(),
            }],
        }],
        story_catalog,
        story_locations: crate::game::story_location::StoryLocationIndex::for_test_scenes(
            "chapter_1",
            "Chapter 1",
            [SceneJson::Investigation(scene.clone())],
        ),
        story_state: StoryState::default(),
        current_chapter_idx: 0,
        current_scene_idx: 0,
        scene: SceneRuntime::Investigation(Box::new(InvestigationSceneState::from_json(
            scene,
            intro_queue_gen,
        ))),
        last_visual_cue: LastVisualCue::default(),
        inventory: Inventory::default(),
        next_queue_gen: intro_queue_gen + 1,
        history: dialogue::DialogueHistory::default(),
        durable_revision: 0,
        pending_acquisition_events: Vec::new(),
        cached_pending_acquisition_scene: std::cell::RefCell::new(None),
    }
}
pub(super) fn token_from(view: &GameStateView) -> QueueToken {
    match &view.mode {
        ModeView::Dialogue { queue_token, .. } => queue_token.clone(),
        other => panic!("expected dialogue mode, got {other:?}"),
    }
}
pub(super) fn history_labels(view: &GameStateView) -> Vec<String> {
    view.dialogue_history
        .iter()
        .map(|entry| match entry {
            DialogueHistoryEntry::Line { speaker, text, .. } => {
                format!("{speaker}: {text}")
            }
            DialogueHistoryEntry::Action { text, .. } => format!("narration: {text}"),
        })
        .collect()
}
pub(super) fn dialogue_history_fixture_resources(line_count: usize) -> PathBuf {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!(
        "lyra-dialogue-history-test-{}-{}",
        std::process::id(),
        n
    ));
    let chapter_dir = d.join("chapter_1");
    fs::create_dir_all(&chapter_dir).unwrap();
    write_empty_story_catalog_and_content_manifest(&d);
    fs::write(
        d.join("chapters.json"),
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

    let mut queue_items = Vec::new();
    queue_items.push(
        r#"{ "kind": "sceneTag", "text": "opening", "assetCue": { "backgroundAssetId": "background.opening" } }"#.to_string(),
    );
    for i in 0..line_count {
        if i % 2 == 0 {
            queue_items.push(format!(
                r#"{{ "kind": "line", "speaker": "A", "text": "line {i}" }}"#
            ));
        } else {
            queue_items.push(format!(r#"{{ "kind": "action", "text": "action {i}" }}"#));
        }
    }
    fs::write(
        chapter_dir.join("scene_0.json"),
        format!(
            r#"{{
                "type": "linear",
                "id": "scene_0",
                "title": "Opening",
                "summary": "Fixture scene summary.",
                "queue": [{}]
            }}"#,
            queue_items.join(",")
        ),
    )
    .unwrap();
    fs::write(
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
    d
}

pub(super) fn packaged_acquisition_fixture_resources() -> (tempfile::TempDir, PathBuf) {
    use std::fs;

    let dir = tempfile::tempdir().unwrap();
    let resources = dir.path().to_path_buf();
    let chapter_dir = resources.join("chapter_1");
    fs::create_dir_all(&chapter_dir).unwrap();
    write_empty_story_catalog_and_content_manifest(&resources);
    write_neutral_story_catalog(
        &resources,
        &[
            ("receipt", "chapter_1", "investigation_scene_1"),
            ("second_note", "chapter_1", "investigation_scene_1"),
        ],
        &[("alibi", "chapter_1", "investigation_scene_1")],
    );
    fs::write(
        resources.join("chapters.json"),
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
    fs::write(
        chapter_dir.join("investigation_scene_1.json"),
        r#"{
            "type": "investigation",
            "id": "investigation_scene_1",
            "title": "Packaged Definitions",
            "summary": "Fixture scene summary.",
            "intro": [{ "kind": "action", "text": "authored dialogue" }],
            "sublocations": [{
                "id": "room",
                "label": "Room",
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "room",
                "transitionDialogue": [],
                "hotspots": [{
                    "id": "never",
                    "label": "Never",
                    "description": "Never",
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [],
                    "inspectDialogue": [],
                    "onReexamine": null
                }],
                "characters": []
            }],
            "evidenceManifest": [
                {
                    "id": "receipt",
                    "name": "Packaged Receipt",
                    "description": "Packaged description",
                    "details": "Packaged details",
                    "imageAssetId": "evidence.receipt",
                    "onCollect": [],
                    "onReexamine": null
                },
                {
                    "id": "second_note",
                    "name": "Packaged Second Note",
                    "description": "Second description",
                    "details": "Second details",
                    "imageAssetId": null,
                    "onCollect": [],
                    "onReexamine": null
                }
            ],
            "statementManifest": [{
                "id": "alibi",
                "speaker": "Packaged Witness",
                "content": "Packaged alibi",
                "onAcquire": [],
                "onReexamine": null
            }],
            "outro": {
                "unlock": {
                    "predicate": "hotspot_investigated",
                    "id": "never"
                },
                "dialogue": []
            }
        }"#,
    )
    .unwrap();
    (dir, resources)
}

fn write_scene_jump_fixture_into(d: &Path) {
    use std::fs;

    let chapter_1 = d.join("chapter_1");
    fs::create_dir_all(&chapter_1).unwrap();
    write_empty_story_catalog_and_content_manifest(d);
    fs::write(
        d.join("story_catalog.json"),
        r#"{
  "schemaVersion": 2,
  "facts": [],
  "questions": [],
  "objectives": [],
  "authorizations": [],
  "sourceGroups": [],
  "evidenceIndex": [{
    "id": "test_evidence",
    "chapterId": "chapter_1",
    "sceneId": "investigation_scene_1",
    "provenance": {
      "sourceKind": "unspecified",
      "representationLayer": "none",
      "proceduralStatus": "unspecified",
      "completeness": "unspecified",
      "confidence": "unspecified",
      "sourceGroupId": null,
      "sourceLabel": null,
      "proofCapabilities": [],
      "supersedesRecordId": null
    }
  }],
  "statementsIndex": []
}"#,
    )
    .unwrap();
    fs::write(
        d.join("chapters.json"),
        r#"{
        "chapters": [{
            "id": "chapter_1",
            "title": "Chapter One",
            "summary": "First",
            "scenes": [
                { "type": "linear", "file": "chapter_1/scene_0.json" },
                { "type": "investigation", "file": "chapter_1/investigation_scene_1.json" },
                { "type": "interrogation", "file": "chapter_1/interrogation_scene_2.json" }
            ]
        }]
    }"#,
    )
    .unwrap();
    fs::write(
        chapter_1.join("scene_0.json"),
        r#"{
        "type": "linear",
        "id": "scene_0",
        "title": "Opening",
        "summary": "The detective arrives at the opening scene.",
        "assetRefs": [
            { "type": "background", "assetId": "background.opening" },
            { "type": "audio", "assetId": "bgm.rain" },
            { "type": "audio", "assetId": "bgs.room" }
        ],
        "queue": [
            { "kind": "sceneTag", "text": "opening", "assetCue": { "backgroundAssetId": "background.opening" } },
            { "kind": "line", "speaker": "A", "text": "linear start" }
        ]
    }"#,
    )
    .unwrap();
    fs::write(
        chapter_1.join("investigation_scene_1.json"),
        r#"{
        "type": "investigation",
        "id": "investigation_scene_1",
        "title": "Investigation",
        "summary": "The detective searches the room for evidence.",
        "intro": [{ "kind": "line", "speaker": "B", "text": "investigation intro" }],
        "sublocations": [{
            "id": "room",
            "label": "Room",
            "status": "unlocked",
            "unlock": null,
            "reveals": [],
            "sceneTag": "room",
            "backgroundAssetId": "background.room",
            "transitionDialogue": [],
            "hotspots": [{
                "id": "never",
                "label": "Never",
                "description": "Never",
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "inspectDialogue": [],
                "onReexamine": null
            }],
            "characters": []
        }],
        "evidenceManifest": [{
            "id": "test_evidence",
            "name": "Test Evidence",
            "description": "d",
            "details": "d",
            "imageAssetId": null,
            "onCollect": [],
            "onReexamine": null
        }],
        "statementManifest": [],
        "outro": { "unlock": { "predicate": "hotspot_investigated", "id": "never" }, "dialogue": [] }
    }"#,
    )
    .unwrap();
    fs::write(
        chapter_1.join("interrogation_scene_2.json"),
        r#"{
        "type": "interrogation",
        "id": "interrogation_scene_2",
        "title": "Interrogation",
        "summary": "The detective questions the witness about the evidence.",
        "intro": [],
        "phases": [{
            "kind": "inquiry",
            "id": "phase_1",
            "label": "證言",
            "subject": { "id": "witness", "name": "Witness", "role": "Witness", "bio": "Quiet." },
            "required": true,
            "status": "unlocked",
            "unlock": null,
            "reveals": [],
            "sceneTag": "interrogation room",
            "backgroundAssetId": "background.interrogation",
            "entryDialogue": [],
            "complete": "auto",
            "questions": [{
                "id": "q1",
                "label": "問題一",
                "status": "unlocked",
                "required": true,
                "unlock": null,
                "reveals": [],
                "testimony": {
                    "onLoop": [{ "kind": "line", "speaker": "witness", "text": "沒有別的了。" }],
                    "lines": [{
                        "id": "l1",
                        "label": "行1",
                        "content": [{ "kind": "line", "speaker": "witness", "text": "我在店裡。" }],
                        "contradiction": null
                    }]
                }
            }]
        }],
        "evidenceManifest": [],
        "statementManifest": [],
        "outro": { "unlock": "auto", "dialogue": [] }
    }"#,
    )
    .unwrap();
}

pub(super) fn scene_jump_fixture_resources() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!("lyra-scene-jump-test-{}-{}", std::process::id(), n));
    write_scene_jump_fixture_into(&d);
    d
}

pub(crate) fn save_capture_fixture_resources() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    write_scene_jump_fixture_into(dir.path());
    let resources = dir.path().to_path_buf();
    std::fs::write(
        resources.join("story_catalog.json"),
        r#"{
  "schemaVersion": 2,
  "facts": [{
    "id": "fact_origin",
    "label": "Origin fact",
    "summary": "Exercises persisted assertion origins.",
    "details": "Only used by save/restore fixtures.",
    "category": "timeline"
  },{
    "id": "fact_supporting",
    "label": "Supporting fact",
    "summary": "Exercises supporting fact id round-trip.",
    "details": "Only used by save/restore fixtures.",
    "category": "timeline"
  }],
  "questions": [{
    "id": "question_open",
    "label": "Open question",
    "summary": "Exercises question reveal and resolution.",
    "resolvedByFactIds": ["fact_origin"]
  }],
  "objectives": [{
    "id": "objective_truth",
    "label": "Find the truth",
    "summary": "Resolve the contradiction.",
    "kind": "primary",
    "sortOrder": 1
  }],
  "authorizations": [{
    "id": "authorization_scene",
    "label": "Scene authorization",
    "summary": "Exercises authorization grant round-trip.",
    "grantingAuthority": "Detective"
  }],
  "sourceGroups": [],
  "evidenceIndex": [{
    "id":"test_evidence",
    "chapterId":"chapter_1",
    "sceneId":"investigation_scene_1",
    "provenance":{
      "sourceKind":"unspecified",
      "representationLayer":"none",
      "proceduralStatus":"unspecified",
      "completeness":"unspecified",
      "confidence":"unspecified",
      "sourceGroupId":null,
      "sourceLabel":null,
      "proofCapabilities":[],
      "supersedesRecordId":null
    }
  }],
  "statementsIndex": [{
    "id":"alibi_statement",
    "chapterId":"chapter_1",
    "sceneId":"investigation_scene_1",
    "provenance":{
      "sourceKind":"unspecified",
      "representationLayer":"none",
      "proceduralStatus":"unspecified",
      "completeness":"unspecified",
      "confidence":"unspecified",
      "sourceGroupId":null,
      "sourceLabel":null,
      "proofCapabilities":[],
      "supersedesRecordId":null
    }
  }]
}"#,
    )
    .unwrap();
    std::fs::write(
        resources.join("chapter_1/investigation_scene_1.json"),
        r#"{
  "type": "investigation",
  "id": "investigation_scene_1",
  "title": "Investigation",
  "summary": "Fixture scene summary.",
  "intro": [{"kind":"line","speaker":"B","text":"investigation intro"}],
  "sublocations": [{
    "id": "room",
    "label": "Room",
    "status": "unlocked",
    "unlock": null,
    "reveals": [],
    "sceneTag": "room",
    "transitionDialogue": [{"kind":"action","text":"room transition"}],
    "hotspots": [{
      "id": "desk",
      "label": "Desk",
      "description": "Desk",
      "status": "unlocked",
      "unlock": null,
      "reveals": [],
      "inspectDialogue": [{"kind":"action","text":"result"}],
      "onReexamine": null
    }, {
      "id": "lamp",
      "label": "Lamp",
      "description": "Lamp",
      "status": "unlocked",
      "unlock": null,
      "reveals": [],
      "inspectDialogue": [],
      "onReexamine": null
    }],
    "characters": [{
      "id": "witness",
      "name": "Witness",
      "role": "Clerk",
      "bio": "Nervous.",
      "topics": [{
        "id": "alibi",
        "label": "Alibi",
        "status": "unlocked",
        "unlock": null,
        "reveals": [],
        "topicDialogue": [{"kind":"action","text":"reveal"}],
        "onReexamine": null
      }]
    }, {
      "id": "clerk",
      "name": "Clerk",
      "role": "Clerk",
      "bio": "Quiet.",
      "topics": [{
        "id": "rain",
        "label": "Rain",
        "status": "unlocked",
        "unlock": null,
        "reveals": [],
        "topicDialogue": [],
        "onReexamine": null
      }]
    }]
  }, {
    "id": "archive",
    "label": "Archive",
    "status": "locked",
    "unlock": null,
    "reveals": [],
    "sceneTag": "archive",
    "transitionDialogue": [],
    "hotspots": [],
    "characters": []
  }],
  "evidenceManifest": [{
    "id": "test_evidence",
    "name": "Test Evidence",
    "description": "Evidence",
    "details": "Details",
    "imageAssetId": null,
    "onCollect": [
      {"kind":"action","text":"onCollect one"},
      {"kind":"action","text":"onCollect two"}
    ],
    "onReexamine": null
  }],
  "statementManifest": [{
    "id": "alibi_statement",
    "speaker": "Witness",
    "content": "Alibi",
    "onAcquire": [{"kind":"action","text":"onAcquire"}],
    "onReexamine": null
  }],
  "outro": {
    "unlock": {"predicate":"hotspot_investigated","id":"desk"},
    "dialogue": [{"kind":"action","text":"outro"}]
  }
}"#,
    )
    .unwrap();
    std::fs::write(
        resources.join("chapter_1/interrogation_scene_2.json"),
        r#"{
  "type": "interrogation",
  "id": "interrogation_scene_2",
  "title": "Interrogation",
  "summary": "Fixture scene summary.",
  "intro": [{"kind":"action","text":"interrogation intro"}],
  "phases": [{
    "kind": "inquiry",
    "id": "phase_zero",
    "label": "Earlier phase",
    "subject": {"id":"witness","name":"Witness","role":"Witness","bio":"Quiet."},
    "required": false,
    "status": "unlocked",
    "unlock": null,
    "reveals": [],
    "sceneTag": "interrogation room",
    "entryDialogue": [],
    "complete": "auto",
    "questions": [{
      "id": "resolved_question",
      "label": "Resolved",
      "status": "unlocked",
      "required": false,
      "unlock": null,
      "reveals": [],
      "testimony": {
        "onLoop": [],
        "lines": [{
          "id": "resolved_line",
          "label": "Resolved line",
          "content": [{"kind":"action","text":"resolved"}],
          "contradiction": null
        }]
      }
    }]
  }, {
    "kind": "inquiry",
    "id": "phase_1",
    "label": "證言",
    "subject": {"id":"witness","name":"Witness","role":"Witness","bio":"Quiet."},
    "required": true,
    "status": "unlocked",
    "unlock": null,
    "reveals": [],
    "sceneTag": "interrogation room",
    "entryDialogue": [{"kind":"action","text":"phase entry"}],
    "complete": "auto",
    "questions": [{
      "id": "q1",
      "label": "問題一",
      "status": "unlocked",
      "required": true,
      "unlock": null,
      "reveals": [],
      "testimony": {
        "onLoop": [
          {"kind":"action","text":"onLoop one"},
          {"kind":"action","text":"onLoop two"}
        ],
        "loopPrompt": [{"kind":"action","text":"prompt"}],
        "lines": [{
          "id": "l1",
          "label": "行1",
          "content": [{"kind":"line","speaker":"witness","text":"line"}],
          "contradiction": {"kind":"evidence","id":"test_evidence"}
        }]
      }
    }]
  }, {
    "kind": "inquiry",
    "id": "phase_two",
    "label": "Follow-up",
    "subject": {"id":"witness","name":"Witness","role":"Witness","bio":"Quiet."},
    "required": false,
    "status": "locked",
    "unlock": null,
    "reveals": [],
    "sceneTag": "interrogation room",
    "entryDialogue": [{"kind":"action","text":"follow-up entry"}],
    "complete": "auto",
    "questions": []
  }],
  "evidenceManifest": [],
  "statementManifest": [],
  "outro": {"unlock":"auto","dialogue":[{"kind":"action","text":"outro"}]}
}"#,
    )
    .unwrap();
    (dir, resources)
}

pub(super) fn case_file_acceptance_fixture_resources() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let resources = dir.path().to_path_buf();
    let chapter_dir = resources.join("synthetic_chapter");
    std::fs::create_dir_all(&chapter_dir).unwrap();
    write_content_manifest(&resources);
    std::fs::write(
        resources.join("chapters.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "chapters": [{
                "id": "synthetic_chapter",
                "title": "合成測試章",
                "summary": "只供案件檔案跨層驗收使用。",
                "scenes": [{
                    "type": "investigation",
                    "file": "synthetic_chapter/synthetic_case_file.json"
                }]
            }]
        }))
        .unwrap(),
    )
    .unwrap();

    let same_slug_evidence = serde_json::json!({
        "sourceKind": "digital",
        "representationLayer": "raw",
        "proceduralStatus": "lead",
        "completeness": "complete",
        "confidence": "corroborated",
        "sourceGroupId": null,
        "sourceLabel": "合成照片",
        "proofCapabilities": [],
        "supersedesRecordId": null
    });
    let grouped_statement = serde_json::json!({
        "sourceKind": "testimony",
        "representationLayer": "raw",
        "proceduralStatus": "lead",
        "completeness": "complete",
        "confidence": "corroborated",
        "sourceGroupId": "synthetic_bundle",
        "sourceLabel": "合成目擊筆錄",
        "proofCapabilities": ["identity"],
        "supersedesRecordId": null
    });
    let signed_scan = serde_json::json!({
        "sourceKind": "digital",
        "representationLayer": "sync",
        "proceduralStatus": "exhibit",
        "completeness": "complete",
        "confidence": "corroborated",
        "sourceGroupId": null,
        "sourceLabel": "合成簽署掃描",
        "proofCapabilities": ["time", "identity", "source", "procedure"],
        "supersedesRecordId": "statement:shared_record"
    });
    let orphan_scan = serde_json::json!({
        "sourceKind": "digital",
        "representationLayer": "sync",
        "proceduralStatus": "reacquired",
        "completeness": "complete",
        "confidence": "corroborated",
        "sourceGroupId": null,
        "sourceLabel": "合成孤立掃描",
        "proofCapabilities": ["source"],
        "supersedesRecordId": "statement:locked_statement"
    });
    let future_scan = serde_json::json!({
        "sourceKind": "digital",
        "representationLayer": "sync",
        "proceduralStatus": "exhibit",
        "completeness": "complete",
        "confidence": "corroborated",
        "sourceGroupId": null,
        "sourceLabel": "未取得的後續掃描",
        "proofCapabilities": ["procedure"],
        "supersedesRecordId": "evidence:signed_scan"
    });
    let locked_statement = serde_json::json!({
        "sourceKind": "testimony",
        "representationLayer": "raw",
        "proceduralStatus": "lead",
        "completeness": "complete",
        "confidence": "disputed",
        "sourceGroupId": null,
        "sourceLabel": "未公開筆錄",
        "proofCapabilities": [],
        "supersedesRecordId": null
    });
    let neutral = neutral_provenance_json();
    let catalog_record = |id: &str, provenance: serde_json::Value| {
        serde_json::json!({
            "id": id,
            "chapterId": "synthetic_chapter",
            "sceneId": "synthetic_case_file",
            "provenance": provenance
        })
    };

    std::fs::write(
        resources.join("story_catalog.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 2,
            "facts": [
                {
                    "id": "fact_clock",
                    "label": "時鐘已校準",
                    "summary": "便箋時間可直接採信。",
                    "details": "校準紀錄與便箋互相吻合。",
                    "category": "timeline"
                },
                {
                    "id": "fact_route",
                    "label": "路線已確認",
                    "summary": "目擊筆錄支持移動路線。",
                    "details": "路線結論同時依賴時鐘事實。",
                    "category": "location"
                },
                {
                    "id": "fact_locked",
                    "label": "未揭露事實",
                    "summary": "不得出現在玩家輸出。",
                    "details": "只供防洩漏斷言。",
                    "category": "procedure"
                }
            ],
            "questions": [
                {
                    "id": "question_open",
                    "label": "誰留下便箋？",
                    "summary": "仍需確認便箋作者。",
                    "resolvedByFactIds": ["fact_clock"]
                },
                {
                    "id": "question_resolved",
                    "label": "目擊路線為何？",
                    "summary": "已由路線事實解答。",
                    "resolvedByFactIds": ["fact_route"]
                },
                {
                    "id": "question_locked",
                    "label": "未揭露問題",
                    "summary": "不得出現在玩家輸出。",
                    "resolvedByFactIds": ["fact_locked"]
                }
            ],
            "objectives": [
                {
                    "id": "objective_primary",
                    "label": "確認合成檔案",
                    "summary": "核對所有已揭露資料。",
                    "kind": "primary",
                    "sortOrder": 1
                },
                {
                    "id": "objective_secondary_a",
                    "label": "核對來源",
                    "summary": "比對來源群組。",
                    "kind": "secondary",
                    "sortOrder": 2
                },
                {
                    "id": "objective_secondary_b",
                    "label": "核對時間",
                    "summary": "確認取得順序。",
                    "kind": "secondary",
                    "sortOrder": 3
                },
                {
                    "id": "objective_completed_1",
                    "label": "完成舊線索一",
                    "summary": "第一項已完成目標。",
                    "kind": "secondary",
                    "sortOrder": 10
                },
                {
                    "id": "objective_completed_2",
                    "label": "完成舊線索二",
                    "summary": "第二項已完成目標。",
                    "kind": "secondary",
                    "sortOrder": 11
                },
                {
                    "id": "objective_completed_3",
                    "label": "完成舊線索三",
                    "summary": "第三項已完成目標。",
                    "kind": "secondary",
                    "sortOrder": 12
                },
                {
                    "id": "objective_completed_4",
                    "label": "完成舊線索四",
                    "summary": "第四項已完成目標。",
                    "kind": "secondary",
                    "sortOrder": 13
                },
                {
                    "id": "objective_locked",
                    "label": "未揭露目標",
                    "summary": "不得出現在玩家輸出。",
                    "kind": "secondary",
                    "sortOrder": 99
                }
            ],
            "authorizations": [
                {
                    "id": "authorization_archive",
                    "label": "調閱合成檔案",
                    "summary": "可調閱本測試的合成來源。",
                    "grantingAuthority": "測試管理員"
                },
                {
                    "id": "authorization_locked",
                    "label": "未授予權限",
                    "summary": "不得出現在玩家輸出。",
                    "grantingAuthority": "未公開單位"
                }
            ],
            "sourceGroups": [{
                "id": "synthetic_bundle",
                "label": "合成來源組",
                "summary": "只公開玩家已取得紀錄所需的來源摘要。",
                "members": [
                    {"kind": "statement", "id": "shared_record"}
                ]
            }],
            "evidenceIndex": [
                catalog_record("neutral_note", neutral.clone()),
                catalog_record("shared_record", same_slug_evidence.clone()),
                catalog_record("signed_scan", signed_scan.clone()),
                catalog_record("orphan_scan", orphan_scan.clone()),
                catalog_record("future_scan", future_scan.clone())
            ],
            "statementsIndex": [
                catalog_record("shared_record", grouped_statement.clone()),
                catalog_record("locked_statement", locked_statement.clone())
            ]
        }))
        .unwrap(),
    )
    .unwrap();

    let evidence_definition = |id: &str, name: &str, provenance: serde_json::Value| {
        serde_json::json!({
            "id": id,
            "name": name,
            "description": format!("{name}摘要。"),
            "details": format!("{name}詳情。"),
            "imageAssetId": null,
            "provenance": provenance,
            "onCollect": [],
            "onReexamine": null
        })
    };
    let statement_definition =
        |id: &str, speaker: &str, content: &str, provenance: serde_json::Value| {
            serde_json::json!({
                "id": id,
                "speaker": speaker,
                "content": content,
                "provenance": provenance,
                "onAcquire": [],
                "onReexamine": null
            })
        };
    std::fs::write(
        chapter_dir.join("synthetic_case_file.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "type": "investigation",
            "id": "synthetic_case_file",
            "title": "案件檔案測試室",
            "summary": "Fixture scene summary.",
            "intro": [],
            "sublocations": [{
                "id": "fixture_room",
                "label": "合成測試室",
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "合成測試室",
                "transitionDialogue": [],
                "hotspots": [{
                    "id": "acceptance_fixture",
                    "label": "驗收固定點",
                    "description": "提供可驗證的故事來源座標。",
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [],
                    "inspectDialogue": [],
                    "onReexamine": null
                }],
                "characters": []
            }],
            "evidenceManifest": [
                evidence_definition("neutral_note", "折角便箋", neutral.clone()),
                evidence_definition("shared_record", "共用代號照片", same_slug_evidence),
                evidence_definition("signed_scan", "簽署掃描", signed_scan),
                evidence_definition("orphan_scan", "孤立掃描", orphan_scan),
                evidence_definition("future_scan", "未取得的後續掃描", future_scan)
            ],
            "statementManifest": [
                statement_definition(
                    "shared_record",
                    "目擊者乙",
                    "我看見簽署檔案移交。",
                    grouped_statement
                ),
                statement_definition(
                    "locked_statement",
                    "未公開證人",
                    "不得出現在玩家輸出。",
                    locked_statement
                )
            ],
            "outro": {"unlock": "auto", "dialogue": []}
        }))
        .unwrap(),
    )
    .unwrap();

    (dir, resources)
}

pub(super) fn provenance_save_fixture_resources() -> (tempfile::TempDir, PathBuf) {
    let (dir, resources) = save_capture_fixture_resources();
    let provenance = |procedural_status: &str,
                      source_group_id: &str,
                      proof_capabilities: &[&str],
                      supersedes_record_id: Option<&str>| {
        serde_json::json!({
            "sourceKind": "digital",
            "representationLayer": "sync",
            "proceduralStatus": procedural_status,
            "completeness": "complete",
            "confidence": "corroborated",
            "sourceGroupId": source_group_id,
            "sourceLabel": "Station camera",
            "proofCapabilities": proof_capabilities,
            "supersedesRecordId": supersedes_record_id,
        })
    };
    let statement_provenance = serde_json::json!({
        "sourceKind": "testimony",
        "representationLayer": "raw",
        "proceduralStatus": "lead",
        "completeness": "complete",
        "confidence": "corroborated",
        "sourceGroupId": "witness_accounts",
        "sourceLabel": "Witness interview",
        "proofCapabilities": ["identity", "credibility"],
        "supersedesRecordId": null,
    });
    let evidence = [
        (
            "chain_exhibit",
            "exhibit",
            &["time", "route", "identity"][..],
            Some("evidence:chain_reacquired"),
            "Exhibit recording",
        ),
        ("chain_lead", "lead", &["time"][..], None, "Lead recording"),
        (
            "chain_reacquired",
            "reacquired",
            &["time", "route"][..],
            Some("evidence:chain_lead"),
            "Reacquired recording",
        ),
    ];

    let mut catalog: serde_json::Value =
        serde_json::from_slice(&std::fs::read(resources.join("story_catalog.json")).unwrap())
            .unwrap();
    catalog["sourceGroups"] = serde_json::json!([
        {
            "id": "video_versions",
            "label": "Station camera versions",
            "summary": "Successive procedural forms of the same recording.",
            "members": [
                {"kind": "evidence", "id": "chain_exhibit"},
                {"kind": "evidence", "id": "chain_lead"},
                {"kind": "evidence", "id": "chain_reacquired"}
            ]
        },
        {
            "id": "witness_accounts",
            "label": "Witness accounts",
            "summary": "Statements supplied by the station witness.",
            "members": [{"kind": "statement", "id": "witness_support"}]
        }
    ]);
    catalog["evidenceIndex"] = serde_json::Value::Array(
        evidence
            .iter()
            .map(|(id, status, capabilities, supersedes, _)| {
                serde_json::json!({
                    "id": id,
                    "chapterId": "chapter_1",
                    "sceneId": "investigation_scene_1",
                    "provenance": provenance(
                        status,
                        "video_versions",
                        capabilities,
                        *supersedes,
                    ),
                })
            })
            .collect(),
    );
    catalog["statementsIndex"] = serde_json::json!([{
        "id": "witness_support",
        "chapterId": "chapter_1",
        "sceneId": "investigation_scene_1",
        "provenance": statement_provenance.clone(),
    }]);
    std::fs::write(
        resources.join("story_catalog.json"),
        serde_json::to_vec_pretty(&catalog).unwrap(),
    )
    .unwrap();

    let scene_path = resources.join("chapter_1/investigation_scene_1.json");
    let mut scene: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&scene_path).unwrap()).unwrap();
    scene["evidenceManifest"] = serde_json::Value::Array(
        evidence
            .iter()
            .map(|(id, status, capabilities, supersedes, name)| {
                serde_json::json!({
                    "id": id,
                    "name": name,
                    "description": "Camera recording",
                    "details": "Fixture provenance",
                    "provenance": provenance(
                        status,
                        "video_versions",
                        capabilities,
                        *supersedes,
                    ),
                    "imageAssetId": null,
                    "onCollect": [],
                    "onReexamine": null,
                })
            })
            .collect(),
    );
    scene["statementManifest"] = serde_json::json!([{
        "id": "witness_support",
        "speaker": "Witness",
        "content": "The camera clock matched the station clock.",
        "provenance": statement_provenance,
        "onAcquire": [],
        "onReexamine": null,
    }]);
    std::fs::write(scene_path, serde_json::to_vec_pretty(&scene).unwrap()).unwrap();

    (dir, resources)
}

pub(super) fn story_navigation_fixture_resources() -> PathBuf {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!(
        "lyra-story-navigation-test-{}-{}",
        std::process::id(),
        n
    ));
    let chapter_1 = d.join("chapter_1");
    let chapter_2 = d.join("chapter_2");
    fs::create_dir_all(&chapter_1).unwrap();
    fs::create_dir_all(&chapter_2).unwrap();
    write_content_manifest(&d);
    fs::write(
        d.join("story_catalog.json"),
        r#"{
  "schemaVersion": 2,
  "facts": [
    {"id":"persistent_fact","label":"Persistent fact","summary":"Persists","details":"Persists across navigation","category":"timeline"}
  ],
  "questions": [],
  "objectives": [],
  "authorizations": [],
  "sourceGroups": [],
  "evidenceIndex": [],
  "statementsIndex": []
}"#,
    )
    .unwrap();
    fs::write(
        d.join("chapters.json"),
        r#"{
  "chapters": [
    {
      "id": "chapter_1",
      "title": "Chapter One",
      "summary": "First",
      "scenes": [
        {"type":"linear","file":"chapter_1/scene_0.json"},
        {"type":"linear","file":"chapter_1/scene_1.json"}
      ]
    },
    {
      "id": "chapter_2",
      "title": "Chapter Two",
      "summary": "Second",
      "scenes": [
        {"type":"linear","file":"chapter_2/scene_0.json"}
      ]
    }
  ]
}"#,
    )
    .unwrap();
    for (path, id, title, speaker) in [
        (
            chapter_1.join("scene_0.json"),
            "scene_0",
            "First scene",
            "A",
        ),
        (
            chapter_1.join("scene_1.json"),
            "scene_1",
            "Second scene",
            "B",
        ),
        (
            chapter_2.join("scene_0.json"),
            "scene_0",
            "Next chapter",
            "C",
        ),
    ] {
        fs::write(
            path,
            format!(
                r#"{{
  "type": "linear",
  "id": "{id}",
  "title": "{title}",
  "summary": "Fixture scene summary.",
  "queue": [{{"kind":"line","speaker":"{speaker}","text":"line"}}]
}}"#
            ),
        )
        .unwrap();
    }
    d
}
pub(super) fn subject() -> SubjectJson {
    SubjectJson {
        id: "suspect".into(),
        name: "Suspect".into(),
        role: "Witness".into(),
        bio: "Quiet.".into(),
    }
}
/// A testimony with no lines — used for questions whose testimony content
/// is irrelevant to the test at hand. Note that `begin_question` treats a
/// testimony with no contradiction-bearing line as auto-broken.
pub(super) fn empty_testimony() -> TestimonyJson {
    TestimonyJson {
        on_loop: vec![],
        loop_prompt: vec![],
        default_challenge: vec![],
        default_wrong: vec![],
        wrong_reply: vec![],
        lines: vec![],
    }
}
/// A single required phase (`press`) with one question (`alibi`) that has
/// two testimony lines: `l_off` (no contradiction) and `l_deny`
/// (contradiction `evidence:cleaning_log`). Mirrors
/// `scenes::interrogation::tests::two_line_question_scene` so the
/// view-builder test below exercises the same cross-exam shape Task 7's
/// state-machine tests cover.
pub(super) fn two_line_question_scene() -> InterrogationSceneJson {
    InterrogationSceneJson {
        id: "interrogation_scene_1".into(),
        title: "Interrogation".into(),
        summary: "Summary".into(),
        asset_refs: vec![],
        intro: vec![],
        phases: vec![InterrogationPhaseJson::Inquiry {
            id: "press".into(),
            label: "Press".into(),
            subject: subject(),
            required: true,
            status: LockStatus::Unlocked,
            unlock: None,
            reveals: vec![],
            scene_tag: "room".into(),
            flattened_asset_cue: VisualAssetCueJson::default(),
            entry_dialogue: vec![],
            complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            questions: vec![InquiryQuestionJson {
                id: "alibi".into(),
                label: "Alibi".into(),
                status: LockStatus::Unlocked,
                required: true,
                unlock: None,
                reveals: vec![],
                testimony: TestimonyJson {
                    on_loop: vec![DialogueItem::Action {
                        text: "loop".into(),
                    }],
                    loop_prompt: vec![DialogueItem::Action {
                        text: "detective-loop".into(),
                    }],
                    default_challenge: vec![],
                    default_wrong: vec![],
                    wrong_reply: vec![DialogueItem::Action {
                        text: "detective-wrong".into(),
                    }],
                    lines: vec![
                        TestimonyLineJson {
                            id: "l_off".into(),
                            label: "Off".into(),
                            content: vec![DialogueItem::Line {
                                speaker: "suspect".into(),
                                text: "我那天沒去。".into(),
                                portrait: None,
                            }],
                            contradiction: None,
                            challenge: vec![],
                            on_correct: vec![],
                            on_wrong_evidence: vec![],
                            reveals: vec![],
                        },
                        TestimonyLineJson {
                            id: "l_deny".into(),
                            label: "Deny".into(),
                            content: vec![DialogueItem::Line {
                                speaker: "suspect".into(),
                                text: "我從沒打掃過那裡。".into(),
                                portrait: None,
                            }],
                            contradiction: Some(InventoryTarget::Evidence {
                                id: "cleaning_log".into(),
                            }),
                            challenge: vec![DialogueItem::Action {
                                text: "challenge".into(),
                            }],
                            on_correct: vec![DialogueItem::Action {
                                text: "correct".into(),
                            }],
                            on_wrong_evidence: vec![DialogueItem::Action {
                                text: "wrong".into(),
                            }],
                            reveals: vec![],
                        },
                    ],
                },
            }],
        }],
        evidence_manifest: vec![
            EvidenceJson {
                id: "cleaning_log".into(),
                name: "Cleaning Log".into(),
                description: "Cleaning log".into(),
                details: "Cleaning log".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            },
            EvidenceJson {
                id: "unrelated".into(),
                name: "Unrelated".into(),
                description: "Unrelated".into(),
                details: "Unrelated".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            },
        ],
        statement_manifest: vec![],
        outro: InterrogationOutroJson {
            unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            dialogue: vec![],
        },
    }
}
pub(super) fn empty_inquiry_interrogation_scene() -> InterrogationSceneJson {
    InterrogationSceneJson {
        id: "interrogation_scene_1".into(),
        title: "Interrogation".into(),
        summary: "Summary".into(),
        asset_refs: vec![],
        intro: vec![],
        phases: vec![InterrogationPhaseJson::Inquiry {
            id: "inquiry".into(),
            label: "Inquiry".into(),
            subject: subject(),
            required: true,
            status: LockStatus::Unlocked,
            unlock: None,
            reveals: vec![crate::game::schema::InterrogationRevealTarget::Evidence {
                id: "note".into(),
            }],
            scene_tag: "interrogation_room".into(),
            flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
            entry_dialogue: vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "entry".into(),
                portrait: None,
            }],
            complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            questions: vec![],
        }],
        evidence_manifest: vec![EvidenceJson {
            id: "note".into(),
            name: "Note".into(),
            description: "Note".into(),
            details: "Note".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: None,
            on_collect: vec![],
            on_reexamine: None,
        }],
        statement_manifest: vec![],
        outro: InterrogationOutroJson {
            unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            dialogue: vec![],
        },
    }
}
pub(super) fn locked_unsatisfied_interrogation_scene() -> InterrogationSceneJson {
    InterrogationSceneJson {
        id: "interrogation_scene_1".into(),
        title: "Interrogation".into(),
        summary: "Summary".into(),
        asset_refs: vec![],
        intro: vec![],
        phases: vec![InterrogationPhaseJson::Inquiry {
            id: "locked_inquiry".into(),
            label: "Locked Inquiry".into(),
            subject: subject(),
            required: true,
            status: LockStatus::Locked,
            unlock: None,
            reveals: vec![],
            scene_tag: "interrogation_room".into(),
            flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
            entry_dialogue: vec![],
            complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            questions: vec![],
        }],
        evidence_manifest: vec![],
        statement_manifest: vec![],
        outro: InterrogationOutroJson {
            unlock: InterrogationOutroUnlock::Expr(InterrogationUnlockExpr::EvidenceCollected {
                _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                id: "missing".into(),
            }),
            dialogue: vec![],
        },
    }
}
pub(super) fn locked_inventory_unlocked_interrogation_scene() -> InterrogationSceneJson {
    InterrogationSceneJson {
        id: "interrogation_scene_1".into(),
        title: "Interrogation".into(),
        summary: "Summary".into(),
        asset_refs: vec![],
        intro: vec![],
        phases: vec![InterrogationPhaseJson::Inquiry {
            id: "inventory_unlocked_inquiry".into(),
            label: "Inventory Unlocked Inquiry".into(),
            subject: subject(),
            required: true,
            status: LockStatus::Locked,
            unlock: Some(InterrogationUnlockExpr::EvidenceCollected {
                _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                id: "key".into(),
            }),
            reveals: vec![crate::game::schema::InterrogationRevealTarget::Evidence {
                id: "note".into(),
            }],
            scene_tag: "interrogation_room".into(),
            flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
            entry_dialogue: vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "entry".into(),
                portrait: None,
            }],
            complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            questions: vec![crate::game::schema::InquiryQuestionJson {
                id: "required_question".into(),
                label: "Required Question".into(),
                status: LockStatus::Unlocked,
                required: true,
                unlock: None,
                reveals: vec![],
                testimony: empty_testimony(),
            }],
        }],
        evidence_manifest: vec![
            EvidenceJson {
                id: "key".into(),
                name: "Key".into(),
                description: "Key".into(),
                details: "Key".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            },
            EvidenceJson {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            },
        ],
        statement_manifest: vec![],
        outro: InterrogationOutroJson {
            unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            dialogue: vec![],
        },
    }
}
pub(super) fn source_order_inventory_unlocked_interrogation_scene() -> InterrogationSceneJson {
    InterrogationSceneJson {
        id: "interrogation_scene_1".into(),
        title: "Interrogation".into(),
        summary: "Summary".into(),
        asset_refs: vec![],
        intro: vec![],
        phases: vec![
            InterrogationPhaseJson::Inquiry {
                id: "early_inventory_inquiry".into(),
                label: "Early Inventory Inquiry".into(),
                subject: subject(),
                required: true,
                status: LockStatus::Locked,
                unlock: Some(InterrogationUnlockExpr::EvidenceCollected {
                    _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                    id: "key".into(),
                }),
                reveals: vec![crate::game::schema::InterrogationRevealTarget::Evidence {
                    id: "early_note".into(),
                }],
                scene_tag: "early_room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![DialogueItem::Line {
                    speaker: "A".into(),
                    text: "early entry".into(),
                    portrait: None,
                }],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![crate::game::schema::InquiryQuestionJson {
                    id: "early_question".into(),
                    label: "Early Question".into(),
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![],
                    testimony: empty_testimony(),
                }],
            },
            InterrogationPhaseJson::Inquiry {
                id: "late_static_inquiry".into(),
                label: "Late Static Inquiry".into(),
                subject: subject(),
                required: true,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![crate::game::schema::InterrogationRevealTarget::Evidence {
                    id: "late_note".into(),
                }],
                scene_tag: "late_room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                entry_dialogue: vec![DialogueItem::Line {
                    speaker: "A".into(),
                    text: "late entry".into(),
                    portrait: None,
                }],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![crate::game::schema::InquiryQuestionJson {
                    id: "late_question".into(),
                    label: "Late Question".into(),
                    status: LockStatus::Unlocked,
                    required: true,
                    unlock: None,
                    reveals: vec![],
                    testimony: empty_testimony(),
                }],
            },
        ],
        evidence_manifest: vec![
            EvidenceJson {
                id: "key".into(),
                name: "Key".into(),
                description: "Key".into(),
                details: "Key".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            },
            EvidenceJson {
                id: "early_note".into(),
                name: "Early Note".into(),
                description: "Early Note".into(),
                details: "Early Note".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            },
            EvidenceJson {
                id: "late_note".into(),
                name: "Late Note".into(),
                description: "Late Note".into(),
                details: "Late Note".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            },
        ],
        statement_manifest: vec![],
        outro: InterrogationOutroJson {
            unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            dialogue: vec![],
        },
    }
}
pub(super) fn empty_engine_with_interrogation_scene(
    scene: InterrogationSceneJson,
    intro_queue_gen: u64,
) -> GameEngine {
    let story_catalog = catalog_with_case_records(
        scene
            .evidence_manifest
            .iter()
            .map(|definition| {
                (
                    definition.id.as_str(),
                    "chapter_1",
                    scene.id.as_str(),
                    definition.provenance.clone(),
                )
            })
            .collect(),
        scene
            .statement_manifest
            .iter()
            .map(|definition| {
                (
                    definition.id.as_str(),
                    "chapter_1",
                    scene.id.as_str(),
                    definition.provenance.clone(),
                )
            })
            .collect(),
    );
    GameEngine {
        resources_dir: PathBuf::new(),
        content_manifest: test_content_manifest(),
        chapters: vec![ChapterManifest {
            id: "chapter_1".into(),
            title: "Chapter 1".into(),
            summary: "summary".into(),
            scenes: vec![SceneRef {
                scene_type: SceneType::Interrogation,
                file: "chapter_1/interrogation_scene_1.json".into(),
            }],
        }],
        story_catalog,
        story_locations: crate::game::story_location::StoryLocationIndex::for_test_scenes(
            "chapter_1",
            "Chapter 1",
            [SceneJson::Interrogation(scene.clone())],
        ),
        story_state: StoryState::default(),
        current_chapter_idx: 0,
        current_scene_idx: 0,
        scene: SceneRuntime::Interrogation(Box::new(InterrogationSceneState::from_json(
            scene,
            intro_queue_gen,
        ))),
        last_visual_cue: LastVisualCue::default(),
        inventory: Inventory::default(),
        next_queue_gen: intro_queue_gen + 1,
        history: dialogue::DialogueHistory::default(),
        durable_revision: 0,
        pending_acquisition_events: Vec::new(),
        cached_pending_acquisition_scene: std::cell::RefCell::new(None),
    }
}
pub(super) fn completed_interrogation_engine_with_bad_next_scene(
    resources_dir: PathBuf,
    inventory: Inventory,
) -> GameEngine {
    let scene_def = two_line_question_scene();
    let mut scene = InterrogationSceneState::from_json(scene_def.clone(), 1);
    scene.current_phase_id = None;
    scene.outro_played = true;
    let story_catalog = catalog_with_case_records(
        inventory
            .evidence
            .iter()
            .map(|record| {
                (
                    record.id.as_str(),
                    record.collected_in_chapter_id.as_str(),
                    record.collected_in_scene_id.as_str(),
                    record.provenance.clone(),
                )
            })
            .collect(),
        inventory
            .statements
            .iter()
            .map(|record| {
                (
                    record.id.as_str(),
                    record.acquired_in_chapter_id.as_str(),
                    record.acquired_in_scene_id.as_str(),
                    record.provenance.clone(),
                )
            })
            .collect(),
    );
    GameEngine {
        resources_dir,
        content_manifest: test_content_manifest(),
        chapters: vec![ChapterManifest {
            id: "chapter_1".into(),
            title: "Chapter 1".into(),
            summary: "summary".into(),
            scenes: vec![
                SceneRef {
                    scene_type: SceneType::Interrogation,
                    file: "chapter_1/interrogation_scene_1.json".into(),
                },
                SceneRef {
                    scene_type: SceneType::Interrogation,
                    file: "chapter_1/interrogation_scene_2.json".into(),
                },
            ],
        }],
        story_catalog,
        story_locations: crate::game::story_location::StoryLocationIndex::for_test_scenes(
            "chapter_1",
            "Chapter 1",
            [SceneJson::Interrogation(scene_def)],
        ),
        story_state: StoryState::default(),
        current_chapter_idx: 0,
        current_scene_idx: 0,
        scene: SceneRuntime::Interrogation(Box::new(scene)),
        last_visual_cue: LastVisualCue {
            scene_tag: Some("before".into()),
            ..Default::default()
        },
        inventory,
        next_queue_gen: 7,
        history: dialogue::DialogueHistory::default(),
        durable_revision: 0,
        pending_acquisition_events: Vec::new(),
        cached_pending_acquisition_scene: std::cell::RefCell::new(None),
    }
}
/// Builds a single required `Auto` inquiry phase with one required
/// contradiction question (`q1`/`l1`, contradiction `ev`) and a non-empty
/// outro, for manual-completion tests.
pub(super) fn single_required_question_scene() -> crate::game::schema::InterrogationSceneJson {
    use crate::game::schema::{
        InterrogationOutroJson, InterrogationOutroUnlock, InterrogationPhaseJson,
        InterrogationSceneJson,
    };
    InterrogationSceneJson {
        id: "manual_complete".into(),
        title: "Manual Complete".into(),
        summary: "Summary".into(),
        asset_refs: vec![],
        intro: vec![],
        phases: vec![InterrogationPhaseJson::Inquiry {
            id: "phase".into(),
            label: "Phase".into(),
            subject: subject(),
            required: true,
            status: LockStatus::Unlocked,
            unlock: None,
            reveals: vec![],
            scene_tag: "room".into(),
            flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
            entry_dialogue: vec![],
            complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            questions: vec![InquiryQuestionJson {
                id: "q1".into(),
                label: "Q1".into(),
                status: LockStatus::Unlocked,
                required: true,
                unlock: None,
                reveals: vec![],
                testimony: TestimonyJson {
                    on_loop: vec![],
                    loop_prompt: vec![],
                    default_challenge: vec![],
                    default_wrong: vec![],
                    wrong_reply: vec![],
                    lines: vec![TestimonyLineJson {
                        id: "l1".into(),
                        label: "L1".into(),
                        content: vec![DialogueItem::Line {
                            speaker: "suspect".into(),
                            text: "I am innocent.".into(),
                            portrait: None,
                        }],
                        contradiction: Some(InventoryTarget::Evidence { id: "ev".into() }),
                        challenge: vec![DialogueItem::Action {
                            text: "challenge".into(),
                        }],
                        on_correct: vec![DialogueItem::Line {
                            speaker: "Detective".into(),
                            text: "Broken!".into(),
                            portrait: None,
                        }],
                        on_wrong_evidence: vec![],
                        reveals: vec![],
                    }],
                },
            }],
        }],
        evidence_manifest: vec![EvidenceJson {
            id: "ev".into(),
            name: "Ev".into(),
            description: "d".into(),
            details: "d".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: None,
            on_collect: vec![],
            on_reexamine: None,
        }],
        statement_manifest: vec![],
        outro: InterrogationOutroJson {
            unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            dialogue: vec![DialogueItem::Line {
                speaker: "Detective".into(),
                text: "That concludes the interrogation.".into(),
                portrait: None,
            }],
        },
    }
}
pub(super) fn break_q1(engine: &mut GameEngine) {
    let ask_view = engine.ask_interrogation_question("q1").unwrap();
    engine.advance_dialogue(token_from(&ask_view)).unwrap();
    let challenge_view = engine.challenge_interrogation_line("l1").unwrap();
    engine
        .advance_dialogue(token_from(&challenge_view))
        .unwrap();
    let present_view = engine
        .present_interrogation_evidence("l1", "evidence", "ev")
        .unwrap();
    engine.advance_dialogue(token_from(&present_view)).unwrap();
}
/// One phase with a single required question whose only testimony line is
/// contradiction-free (honest) — auto-broken on ask. Used to exercise the
/// honest-question return-to-menu path.
pub(super) fn single_honest_question_scene() -> crate::game::schema::InterrogationSceneJson {
    use crate::game::schema::{
        InterrogationOutroJson, InterrogationOutroUnlock, InterrogationPhaseJson,
        InterrogationSceneJson,
    };
    InterrogationSceneJson {
        id: "honest".into(),
        title: "Honest".into(),
        summary: "Summary".into(),
        asset_refs: vec![],
        intro: vec![],
        phases: vec![InterrogationPhaseJson::Inquiry {
            id: "phase".into(),
            label: "Phase".into(),
            subject: subject(),
            required: true,
            status: LockStatus::Unlocked,
            unlock: None,
            reveals: vec![],
            scene_tag: "room".into(),
            flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
            entry_dialogue: vec![],
            complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            questions: vec![InquiryQuestionJson {
                id: "q1".into(),
                label: "Q1".into(),
                status: LockStatus::Unlocked,
                required: true,
                unlock: None,
                reveals: vec![],
                testimony: TestimonyJson {
                    on_loop: vec![],
                    loop_prompt: vec![],
                    default_challenge: vec![],
                    default_wrong: vec![],
                    wrong_reply: vec![],
                    lines: vec![TestimonyLineJson {
                        id: "h1".into(),
                        label: "H1".into(),
                        content: vec![DialogueItem::Line {
                            speaker: "suspect".into(),
                            text: "誠實回答。".into(),
                            portrait: None,
                        }],
                        contradiction: None,
                        challenge: vec![],
                        on_correct: vec![],
                        on_wrong_evidence: vec![],
                        reveals: vec![],
                    }],
                },
            }],
        }],
        evidence_manifest: vec![],
        statement_manifest: vec![],
        outro: InterrogationOutroJson {
            unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
            dialogue: vec![DialogueItem::Line {
                speaker: "Detective".into(),
                text: "done".into(),
                portrait: None,
            }],
        },
    }
}
