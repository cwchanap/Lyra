// src-tauri/src/game/schema.rs
use serde::{Deserialize, Serialize};

// ============================================================================
// Shared atoms
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DialogueItem {
    SceneTag {
        text: String,
        #[serde(default)]
        asset_cue: Option<VisualAssetCueJson>,
    },
    Action {
        text: String,
    },
    Line {
        speaker: String,
        text: String,
        #[serde(default)]
        portrait: Option<PortraitRefJson>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortraitRefJson {
    pub character_id: String,
    pub expression: String,
    pub asset_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCueJson {
    pub channel: AudioChannelJson,
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioChannelJson {
    Bgm,
    Bgs,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualAssetCueJson {
    #[serde(default)]
    pub background_asset_id: Option<String>,
    #[serde(default)]
    pub bgm: Option<AudioCueJson>,
    #[serde(default)]
    pub bgs: Option<AudioCueJson>,
}

impl VisualAssetCueJson {
    pub fn is_empty(&self) -> bool {
        self.background_asset_id.is_none() && self.bgm.is_none() && self.bgs.is_none()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetTypeJson {
    Background,
    Portrait,
    Standee,
    Evidence,
    Audio,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRefJson {
    #[serde(rename = "type")]
    pub asset_type: AssetTypeJson,
    pub asset_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HotspotLayoutJson {
    Rect { x: f64, y: f64, w: f64, h: f64 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CharacterLayoutJson {
    Sprite {
        asset_id: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        anchor: CharacterLayoutAnchorJson,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CharacterLayoutAnchorJson {
    BottomCenter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RevealTarget {
    Evidence {
        id: String,
    },
    Statement {
        id: String,
    },
    Topic {
        character_id: String,
        topic_id: String,
    },
    Hotspot {
        id: String,
    },
    Sublocation {
        id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InventoryTarget {
    Evidence { id: String },
    Statement { id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InterrogationRevealTarget {
    Evidence { id: String },
    Statement { id: String },
    Question { id: String },
    Phase { id: String },
}

/// `unlock` JSON values are either the literal string "auto" (Outro auto-mode)
/// or a tagged tree of predicates and combinators. We represent that as an
/// untagged enum.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OutroUnlock {
    Auto(AutoMarker),
    Expr(UnlockExpr),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InterrogationOutroUnlock {
    Auto(AutoMarker),
    Expr(InterrogationUnlockExpr),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoMarker {
    #[serde(rename = "auto")]
    Auto,
}

/// Per-block (non-Outro) Unlock JSON: null or UnlockExpr.
/// Represented in Rust as Option<UnlockExpr>.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum UnlockExpr {
    Combinator {
        op: Combinator,
        left: Box<UnlockExpr>,
        right: Box<UnlockExpr>,
    },
    EvidenceCollected {
        #[serde(rename = "predicate")]
        _predicate: PredicateEvidenceCollected,
        id: String,
    },
    StatementAcquired {
        #[serde(rename = "predicate")]
        _predicate: PredicateStatementAcquired,
        id: String,
    },
    TopicDiscussed {
        #[serde(rename = "predicate")]
        _predicate: PredicateTopicDiscussed,
        character_id: String,
        topic_id: String,
    },
    HotspotInvestigated {
        #[serde(rename = "predicate")]
        _predicate: PredicateHotspotInvestigated,
        id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum InterrogationUnlockExpr {
    Combinator {
        op: Combinator,
        left: Box<InterrogationUnlockExpr>,
        right: Box<InterrogationUnlockExpr>,
    },
    EvidenceCollected {
        #[serde(rename = "predicate")]
        _predicate: PredicateEvidenceCollected,
        id: String,
    },
    StatementAcquired {
        #[serde(rename = "predicate")]
        _predicate: PredicateStatementAcquired,
        id: String,
    },
    QuestionAnswered {
        #[serde(rename = "predicate")]
        _predicate: PredicateQuestionAnswered,
        id: String,
    },
    PhaseCompleted {
        #[serde(rename = "predicate")]
        _predicate: PredicatePhaseCompleted,
        id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Combinator {
    And,
    Or,
}

// Marker enums for each predicate kind, so serde's untagged dispatch picks the
// right variant from the `predicate` discriminator field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateEvidenceCollected {
    #[serde(rename = "evidence_collected")]
    X,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateStatementAcquired {
    #[serde(rename = "statement_acquired")]
    X,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateTopicDiscussed {
    #[serde(rename = "topic_discussed")]
    X,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateHotspotInvestigated {
    #[serde(rename = "hotspot_investigated")]
    X,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateQuestionAnswered {
    #[serde(rename = "question_answered")]
    X,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicatePhaseCompleted {
    #[serde(rename = "phase_completed")]
    X,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LockStatus {
    Locked,
    Unlocked,
}

// ============================================================================
// Chapters index
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaptersIndexJson {
    pub chapters: Vec<ChapterEntryJson>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterEntryJson {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub scenes: Vec<SceneEntryJson>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneEntryJson {
    #[serde(rename = "type")]
    pub scene_type: SceneType,
    pub file: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SceneType {
    Linear,
    Investigation,
    Interrogation,
}

// ============================================================================
// Scene JSON (tagged-union, discriminator: "type")
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SceneJson {
    #[serde(rename = "linear")]
    Linear(LinearSceneJson),
    #[serde(rename = "investigation")]
    Investigation(InvestigationSceneJson),
    #[serde(rename = "interrogation")]
    Interrogation(InterrogationSceneJson),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearSceneJson {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub asset_refs: Vec<AssetRefJson>,
    pub queue: Vec<DialogueItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestigationSceneJson {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub asset_refs: Vec<AssetRefJson>,
    pub intro: Vec<DialogueItem>,
    pub sublocations: Vec<SublocationJson>,
    pub evidence_manifest: Vec<EvidenceJson>,
    pub statement_manifest: Vec<StatementJson>,
    pub outro: OutroJson,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterrogationSceneJson {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub asset_refs: Vec<AssetRefJson>,
    pub intro: Vec<DialogueItem>,
    pub phases: Vec<InterrogationPhaseJson>,
    pub evidence_manifest: Vec<EvidenceJson>,
    pub statement_manifest: Vec<StatementJson>,
    pub outro: InterrogationOutroJson,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum InterrogationPhaseJson {
    Inquiry {
        id: String,
        label: String,
        subject: SubjectJson,
        required: bool,
        status: LockStatus,
        unlock: Option<InterrogationUnlockExpr>,
        reveals: Vec<InterrogationRevealTarget>,
        scene_tag: String,
        #[serde(flatten)]
        flattened_asset_cue: VisualAssetCueJson,
        entry_dialogue: Vec<DialogueItem>,
        complete: InterrogationOutroUnlock,
        questions: Vec<InquiryQuestionJson>,
    },
    Testimony {
        id: String,
        label: String,
        subject: SubjectJson,
        required: bool,
        status: LockStatus,
        unlock: Option<InterrogationUnlockExpr>,
        reveals: Vec<InterrogationRevealTarget>,
        scene_tag: String,
        #[serde(flatten)]
        flattened_asset_cue: VisualAssetCueJson,
        entry_dialogue: Vec<DialogueItem>,
        statements: Vec<TestimonyStatementJson>,
        results: Vec<TestimonyResultJson>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectJson {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bio: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InquiryQuestionJson {
    pub id: String,
    pub label: String,
    pub kind: InquiryQuestionKind,
    pub parent_question_id: Option<String>,
    pub status: LockStatus,
    pub required: bool,
    pub unlock: Option<InterrogationUnlockExpr>,
    pub reveals: Vec<InterrogationRevealTarget>,
    pub answer_dialogue: Vec<DialogueItem>,
    pub on_reask: Option<Vec<DialogueItem>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InquiryQuestionKind {
    Question,
    FollowUp,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestimonyStatementJson {
    pub id: String,
    pub label: String,
    pub content: String,
    pub contradiction: Option<InventoryTarget>,
    pub on_correct: Option<String>,
    pub on_wrong: Option<String>,
    pub on_press: Option<Vec<DialogueItem>>,
    pub on_present: Option<Vec<DialogueItem>>,
    pub on_wrong_present: Option<Vec<DialogueItem>>,
    pub reveals: Vec<InterrogationRevealTarget>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestimonyResultJson {
    pub id: String,
    pub label: String,
    pub reveals: Vec<InterrogationRevealTarget>,
    pub dialogue: Vec<DialogueItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SublocationJson {
    pub id: String,
    pub label: String,
    pub status: LockStatus,
    pub unlock: Option<UnlockExpr>,
    pub reveals: Vec<RevealTarget>,
    pub scene_tag: String,
    #[serde(flatten)]
    pub flattened_asset_cue: VisualAssetCueJson,
    pub transition_dialogue: Vec<DialogueItem>,
    pub hotspots: Vec<HotspotJson>,
    pub characters: Vec<CharacterJson>,
}

impl SublocationJson {
    pub fn visual_asset_cue(&self) -> Option<VisualAssetCueJson> {
        (!self.flattened_asset_cue.is_empty()).then(|| self.flattened_asset_cue.clone())
    }
}

impl InterrogationPhaseJson {
    pub fn visual_asset_cue(&self) -> Option<VisualAssetCueJson> {
        let flattened = match self {
            Self::Inquiry {
                flattened_asset_cue,
                ..
            }
            | Self::Testimony {
                flattened_asset_cue,
                ..
            } => flattened_asset_cue,
        };
        (!flattened.is_empty()).then(|| flattened.clone())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotspotJson {
    pub id: String,
    pub label: String,
    pub description: String,
    pub status: LockStatus,
    pub unlock: Option<UnlockExpr>,
    pub reveals: Vec<RevealTarget>,
    #[serde(default)]
    pub layout: Option<HotspotLayoutJson>,
    pub inspect_dialogue: Vec<DialogueItem>,
    pub on_reexamine: Option<Vec<DialogueItem>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterJson {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bio: String,
    #[serde(default)]
    pub layout: Option<CharacterLayoutJson>,
    pub topics: Vec<TopicJson>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicJson {
    pub id: String,
    pub label: String,
    pub status: LockStatus,
    pub unlock: Option<UnlockExpr>,
    pub reveals: Vec<RevealTarget>,
    pub topic_dialogue: Vec<DialogueItem>,
    pub on_reexamine: Option<Vec<DialogueItem>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceJson {
    pub id: String,
    pub name: String,
    pub description: String,
    pub details: String,
    #[serde(default)]
    pub image_asset_id: Option<String>,
    pub on_collect: Vec<DialogueItem>,
    pub on_reexamine: Option<Vec<DialogueItem>>,
    // NOTE: the compiler emitter also writes `sourceSublocationId` on each
    // evidence item (see scripts/compile-scenes/emitter.ts). It is
    // intentionally NOT declared here: it is a layout-editor filter key used
    // to scope the read-only Evidence Sources panel to a sublocation, and the
    // Rust runtime never needs it (evidence is revealed by hotspot/topic
    // `reveals` targets, not by its source sublocation). Serde ignores
    // unknown fields by default, so the key is silently dropped on load.
    // Add `#[serde(default)] source_sublocation_id: Option<String>` here only
    // if a future runtime feature needs the source sublocation.
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementJson {
    pub id: String,
    pub speaker: String,
    pub content: String,
    pub on_acquire: Vec<DialogueItem>,
    pub on_reexamine: Option<Vec<DialogueItem>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutroJson {
    pub unlock: OutroUnlock,
    pub dialogue: Vec<DialogueItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterrogationOutroJson {
    pub unlock: InterrogationOutroUnlock,
    pub dialogue: Vec<DialogueItem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_linear_scene() {
        let json = r#"{
            "type": "linear",
            "id": "scene_0",
            "title": "接案",
            "queue": [
                {"kind": "sceneTag", "text": "街道"},
                {"kind": "action", "text": "推開門"},
                {"kind": "line", "speaker": "A", "text": "hi"}
            ]
        }"#;
        let parsed: SceneJson = serde_json::from_str(json).unwrap();
        match parsed {
            SceneJson::Linear(s) => {
                assert_eq!(s.id, "scene_0");
                assert_eq!(s.queue.len(), 3);
            }
            _ => panic!("expected Linear variant"),
        }
    }

    #[test]
    fn deserializes_dialogue_line_with_portrait() {
        let json = r#"{
            "kind": "line",
            "speaker": "早坂茜",
            "text": "你不舒服？",
            "portrait": {
                "characterId": "hayasaka_akane",
                "expression": "concerned",
                "assetId": "portrait.hayasaka_akane.concerned"
            }
        }"#;
        let parsed: DialogueItem = serde_json::from_str(json).unwrap();
        match parsed {
            DialogueItem::Line { portrait, .. } => {
                let portrait = portrait.unwrap();
                assert_eq!(portrait.character_id, "hayasaka_akane");
                assert_eq!(portrait.expression, "concerned");
                assert_eq!(portrait.asset_id, "portrait.hayasaka_akane.concerned");
            }
            _ => panic!("expected line"),
        }
    }

    #[test]
    fn deserializes_scene_tag_with_asset_cue() {
        let json = r#"{
            "kind": "sceneTag",
            "text": "咖啡館外",
            "assetCue": {
                "backgroundPrompt": null,
                "backgroundAssetId": "background.chapter_1.scene_0.tag_001",
                "bgm": { "channel": "bgm", "assetId": "audio.bgm.rain_mystery_low" },
                "bgs": { "channel": "bgs", "assetId": null }
            }
        }"#;
        let parsed: DialogueItem = serde_json::from_str(json).unwrap();
        match parsed {
            DialogueItem::SceneTag { asset_cue, .. } => {
                assert_eq!(
                    asset_cue.unwrap().background_asset_id.as_deref(),
                    Some("background.chapter_1.scene_0.tag_001")
                );
            }
            _ => panic!("expected scene tag"),
        }
    }

    #[test]
    fn deserializes_unlock_expr_predicate() {
        let json = r#"{"predicate": "evidence_collected", "id": "blue_umbrella"}"#;
        let parsed: UnlockExpr = serde_json::from_str(json).unwrap();
        match parsed {
            UnlockExpr::EvidenceCollected { id, .. } => assert_eq!(id, "blue_umbrella"),
            _ => panic!("expected EvidenceCollected"),
        }
    }

    #[test]
    fn deserializes_unlock_expr_combinator() {
        let json = r#"{
            "op": "and",
            "left": {"predicate": "hotspot_investigated", "id": "a"},
            "right": {"predicate": "statement_acquired", "id": "b"}
        }"#;
        let parsed: UnlockExpr = serde_json::from_str(json).unwrap();
        match parsed {
            UnlockExpr::Combinator { op, .. } => assert_eq!(op, Combinator::And),
            _ => panic!("expected Combinator"),
        }
    }

    #[test]
    fn deserializes_outro_auto() {
        let json = r#""auto""#;
        let parsed: OutroUnlock = serde_json::from_str(json).unwrap();
        assert!(matches!(parsed, OutroUnlock::Auto(AutoMarker::Auto)));
    }

    #[test]
    fn deserializes_outro_with_expr() {
        let json = r#"{"predicate": "hotspot_investigated", "id": "x"}"#;
        let parsed: OutroUnlock = serde_json::from_str(json).unwrap();
        assert!(matches!(parsed, OutroUnlock::Expr(_)));
    }

    #[test]
    fn deserializes_topic_reveal_with_camelcase_keys() {
        let json = r#"{"kind": "topic", "characterId": "witness", "topicId": "motive"}"#;
        let parsed: RevealTarget = serde_json::from_str(json).unwrap();
        match parsed {
            RevealTarget::Topic {
                character_id,
                topic_id,
            } => {
                assert_eq!(character_id, "witness");
                assert_eq!(topic_id, "motive");
            }
            _ => panic!("expected Topic"),
        }
    }

    #[test]
    fn deserializes_unlock_expr_topic_discussed_with_camelcase() {
        let json =
            r#"{"predicate": "topic_discussed", "characterId": "witness", "topicId": "motive"}"#;
        let parsed: UnlockExpr = serde_json::from_str(json).unwrap();
        match parsed {
            UnlockExpr::TopicDiscussed {
                character_id,
                topic_id,
                ..
            } => {
                assert_eq!(character_id, "witness");
                assert_eq!(topic_id, "motive");
            }
            _ => panic!("expected TopicDiscussed"),
        }
    }

    #[test]
    fn deserializes_interrogation_scene() {
        let json = r#"{
            "type": "interrogation",
            "id": "interrogation_scene_2",
            "title": "詢問",
            "intro": [],
            "phases": [{
                "kind": "inquiry",
                "id": "p",
                "label": "問話",
                "subject": { "id": "suspect", "name": "嫌疑人", "role": "嫌疑人", "bio": "沉默。" },
                "required": true,
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "詢問室",
                "entryDialogue": [],
                "complete": "auto",
                "questions": []
            }],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": "auto", "dialogue": [] }
        }"#;
        let parsed: SceneJson = serde_json::from_str(json).unwrap();
        assert!(matches!(parsed, SceneJson::Interrogation(_)));
    }

    #[test]
    fn deserializes_interrogation_question_reveal() {
        let json = r#"{"kind":"question","id":"hidden"}"#;
        let parsed: InterrogationRevealTarget = serde_json::from_str(json).unwrap();
        assert!(matches!(parsed, InterrogationRevealTarget::Question { id } if id == "hidden"));
    }

    #[test]
    fn deserializes_asset_ref_with_typed_asset_type() {
        let json = r#"{"type": "background", "assetId": "background.chapter_1.scene_0.tag_001"}"#;
        let parsed: AssetRefJson = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.asset_type, AssetTypeJson::Background);
        assert_eq!(parsed.asset_id, "background.chapter_1.scene_0.tag_001");
    }

    #[test]
    fn deserializes_asset_ref_with_standee_type() {
        let json = r#"{"type": "standee", "assetId": "standee.hayasaka_akane.standard"}"#;
        let parsed: AssetRefJson = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.asset_type, AssetTypeJson::Standee);
        assert_eq!(parsed.asset_id, "standee.hayasaka_akane.standard");
    }

    #[test]
    fn serializes_standee_type_as_lowercase() {
        let asset_ref = AssetRefJson {
            asset_type: AssetTypeJson::Standee,
            asset_id: "standee.kurose.standard".to_string(),
        };
        let json = serde_json::to_string(&asset_ref).unwrap();
        assert!(json.contains(r#""type":"standee""#));
    }

    #[test]
    fn rejects_invalid_asset_type_at_deserialization() {
        let json = r#"{"type": "bckground", "assetId": "bg"}"#;
        let result = serde_json::from_str::<AssetRefJson>(json);
        assert!(result.is_err());
    }

    #[test]
    fn deserializes_hotspot_layout() {
        let json = r#"{
            "id": "table",
            "label": "桌面",
            "description": "桌上有一只杯子。",
            "status": "unlocked",
            "unlock": null,
            "reveals": [],
            "layout": { "kind": "rect", "x": 0.18, "y": 0.52, "w": 0.16, "h": 0.12 },
            "inspectDialogue": []
        }"#;
        let parsed: HotspotJson = serde_json::from_str(json).unwrap();
        let HotspotLayoutJson::Rect { x, .. } = parsed.layout.unwrap();
        assert_eq!(x, 0.18);
    }

    #[test]
    fn deserializes_character_layout() {
        let json = r#"{
            "id": "witness",
            "name": "目擊者",
            "role": "店員",
            "bio": "緊張的店員。",
            "layout": {
                "kind": "sprite",
                "assetId": "portrait.witness.standard",
                "x": 0.72,
                "y": 0.18,
                "w": 0.16,
                "h": 0.72,
                "anchor": "bottomCenter"
            },
            "topics": []
        }"#;
        let parsed: CharacterJson = serde_json::from_str(json).unwrap();
        let CharacterLayoutJson::Sprite { asset_id, .. } = parsed.layout.unwrap();
        assert_eq!(asset_id, "portrait.witness.standard");
    }

    #[test]
    fn sublocation_visual_asset_cue_returns_none_when_empty() {
        let sub = SublocationJson {
            id: "test".into(),
            label: "Test".into(),
            status: LockStatus::Unlocked,
            unlock: None,
            reveals: vec![],
            scene_tag: "test".into(),
            flattened_asset_cue: VisualAssetCueJson::default(),
            transition_dialogue: vec![],
            hotspots: vec![],
            characters: vec![],
        };
        assert!(sub.visual_asset_cue().is_none());
    }

    #[test]
    fn sublocation_visual_asset_cue_returns_some_when_populated() {
        let cue = VisualAssetCueJson {
            background_asset_id: Some("bg.x".into()),
            ..Default::default()
        };
        let sub = SublocationJson {
            id: "test".into(),
            label: "Test".into(),
            status: LockStatus::Unlocked,
            unlock: None,
            reveals: vec![],
            scene_tag: "test".into(),
            flattened_asset_cue: cue.clone(),
            transition_dialogue: vec![],
            hotspots: vec![],
            characters: vec![],
        };
        assert_eq!(sub.visual_asset_cue(), Some(cue));
    }
}
