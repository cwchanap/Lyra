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

pub(super) fn representative_save_envelope() -> crate::game::save::schema::SaveEnvelopeV1 {
    serde_json::from_str(include_str!(
        "../../tests/fixtures/saves/v1-representative.json"
    ))
    .unwrap()
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
  "schemaVersion": 1,
  "facts": [],
  "questions": [],
  "objectives": [],
  "authorizations": [],
  "evidenceIndex": [],
  "statementsIndex": []
}
"#,
    )
    .unwrap();
    write_content_manifest(dir);
}

pub(crate) fn investigation_scene_with_intro(
    id: &str,
    intro: Vec<DialogueItem>,
) -> InvestigationSceneJson {
    InvestigationSceneJson {
        id: id.into(),
        title: id.into(),
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
        story_catalog: StoryCatalog::empty(),
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
  "schemaVersion": 1,
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
  "evidenceIndex": [{
    "id":"test_evidence",
    "chapterId":"chapter_1",
    "sceneId":"investigation_scene_1"
  }],
  "statementsIndex": [{
    "id":"alibi_statement",
    "chapterId":"chapter_1",
    "sceneId":"investigation_scene_1"
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
  "schemaVersion": 1,
  "facts": [
    {"id":"persistent_fact","label":"Persistent fact","summary":"Persists","details":"Persists across navigation","category":"timeline"}
  ],
  "questions": [],
  "objectives": [],
  "authorizations": [],
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
        evidence_manifest: vec![],
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
        evidence_manifest: vec![EvidenceJson {
            id: "note".into(),
            name: "Note".into(),
            description: "Note".into(),
            details: "Note".into(),
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
pub(super) fn source_order_inventory_unlocked_interrogation_scene() -> InterrogationSceneJson {
    InterrogationSceneJson {
        id: "interrogation_scene_1".into(),
        title: "Interrogation".into(),
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
                id: "early_note".into(),
                name: "Early Note".into(),
                description: "Early Note".into(),
                details: "Early Note".into(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            },
            EvidenceJson {
                id: "late_note".into(),
                name: "Late Note".into(),
                description: "Late Note".into(),
                details: "Late Note".into(),
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
        story_catalog: StoryCatalog::empty(),
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
    let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
    scene.current_phase_id = None;
    scene.outro_played = true;
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
        story_catalog: StoryCatalog::empty(),
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
