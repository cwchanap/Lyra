// src-tauri/src/game/view.rs
use crate::game::save::schema::RecordKind;
use crate::game::schema::{
    AudioChannelJson, CharacterLayoutJson, DialogueItem, HotspotLayoutJson, InventoryTarget,
    SceneType,
};
use crate::game::state::{EvidenceRecord, Inventory, StatementRecord};
use crate::game::story::{StoryCatalog, StoryStateView};
use crate::game::story_location::{SceneLocationContextView, StoryLocationIndex};
use crate::game::{provenance::validate_inventory_record_against_catalog, GameError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryView {
    pub evidence: Vec<EvidenceRecordView>,
    pub statements: Vec<StatementRecordView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRecordView {
    pub id: String,
    pub name: String,
    pub description: String,
    pub details: String,
    pub provenance: crate::game::provenance::CaseRecordProvenance,
    pub image_asset_id: Option<String>,
    pub on_reexamine: Option<Vec<DialogueItem>>,
    pub collected_in_chapter_id: String,
    pub collected_in_scene_id: String,
    pub(in crate::game) acquisition_context: SceneLocationContextView,
    pub(in crate::game) source_group: Option<SourceGroupReferenceView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementRecordView {
    pub id: String,
    pub speaker: String,
    pub content: String,
    pub provenance: crate::game::provenance::CaseRecordProvenance,
    pub on_reexamine: Option<Vec<DialogueItem>>,
    pub acquired_in_chapter_id: String,
    pub acquired_in_scene_id: String,
    pub(in crate::game) acquisition_context: SceneLocationContextView,
    pub(in crate::game) source_group: Option<SourceGroupReferenceView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::game) struct SourceGroupReferenceView {
    pub(in crate::game) id: String,
    pub(in crate::game) label: String,
    pub(in crate::game) summary: String,
}

impl InventoryView {
    pub fn has_evidence(&self, id: &str) -> bool {
        self.evidence.iter().any(|record| record.id == id)
    }

    pub fn has_statement(&self, id: &str) -> bool {
        self.statements.iter().any(|record| record.id == id)
    }

    pub(in crate::game) fn from_inventory(
        catalog: &StoryCatalog,
        inventory: &Inventory,
        locations: &StoryLocationIndex,
    ) -> Result<Self, GameError> {
        let acquired_targets = inventory.acquired_targets();
        let evidence = inventory
            .evidence
            .iter()
            .map(|record| evidence_record_view(catalog, &acquired_targets, locations, record))
            .collect::<Result<Vec<_>, _>>()?;

        let statements = inventory
            .statements
            .iter()
            .map(|record| statement_record_view(catalog, &acquired_targets, locations, record))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Self {
            evidence,
            statements,
        })
    }
}

fn source_group_reference(
    catalog: &StoryCatalog,
    provenance: &crate::game::provenance::CaseRecordProvenance,
) -> Result<Option<SourceGroupReferenceView>, GameError> {
    let Some(source_group_id) = provenance.source_group_id.as_deref() else {
        return Ok(None);
    };
    let source_group = catalog.source_group(source_group_id).ok_or_else(|| {
        GameError::internal(format!(
            "Validated catalog omitted source group '{source_group_id}' referenced by an acquired record."
        ))
    })?;
    Ok(Some(SourceGroupReferenceView {
        id: source_group.id.clone(),
        label: source_group.label.clone(),
        summary: source_group.summary.clone(),
    }))
}

fn public_provenance(
    catalog: &StoryCatalog,
    acquired_targets: &std::collections::BTreeSet<InventoryTarget>,
    target: &InventoryTarget,
    provenance: &crate::game::provenance::CaseRecordProvenance,
) -> Result<crate::game::provenance::CaseRecordProvenance, GameError> {
    let mut public = provenance.clone();
    let predecessor = catalog.predecessor(target)?;
    if predecessor
        .as_ref()
        .is_none_or(|predecessor| !acquired_targets.contains(predecessor))
    {
        public.supersedes_record_id = None;
    }
    Ok(public)
}

fn evidence_record_view(
    catalog: &StoryCatalog,
    acquired_targets: &std::collections::BTreeSet<InventoryTarget>,
    locations: &StoryLocationIndex,
    record: &EvidenceRecord,
) -> Result<EvidenceRecordView, GameError> {
    let target = InventoryTarget::Evidence {
        id: record.id.clone(),
    };
    validate_inventory_record_against_catalog(
        catalog,
        &record.collected_in_chapter_id,
        &record.collected_in_scene_id,
        &target,
        &record.provenance,
    )?;
    Ok(EvidenceRecordView {
        id: record.id.clone(),
        name: record.name.clone(),
        description: record.description.clone(),
        details: record.details.clone(),
        provenance: public_provenance(catalog, acquired_targets, &target, &record.provenance)?,
        image_asset_id: record.image_asset_id.clone(),
        on_reexamine: record.on_reexamine.clone(),
        collected_in_chapter_id: record.collected_in_chapter_id.clone(),
        collected_in_scene_id: record.collected_in_scene_id.clone(),
        acquisition_context: locations.resolve_scene(
            &record.collected_in_chapter_id,
            &record.collected_in_scene_id,
        )?,
        source_group: source_group_reference(catalog, &record.provenance)?,
    })
}

fn statement_record_view(
    catalog: &StoryCatalog,
    acquired_targets: &std::collections::BTreeSet<InventoryTarget>,
    locations: &StoryLocationIndex,
    record: &StatementRecord,
) -> Result<StatementRecordView, GameError> {
    let target = InventoryTarget::Statement {
        id: record.id.clone(),
    };
    validate_inventory_record_against_catalog(
        catalog,
        &record.acquired_in_chapter_id,
        &record.acquired_in_scene_id,
        &target,
        &record.provenance,
    )?;
    Ok(StatementRecordView {
        id: record.id.clone(),
        speaker: record.speaker.clone(),
        content: record.content.clone(),
        provenance: public_provenance(catalog, acquired_targets, &target, &record.provenance)?,
        on_reexamine: record.on_reexamine.clone(),
        acquired_in_chapter_id: record.acquired_in_chapter_id.clone(),
        acquired_in_scene_id: record.acquired_in_scene_id.clone(),
        acquisition_context: locations
            .resolve_scene(&record.acquired_in_chapter_id, &record.acquired_in_scene_id)?,
        source_group: source_group_reference(catalog, &record.provenance)?,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStateView {
    pub mode: ModeView,
    pub chapter: ChapterView,
    pub scene: SceneView,
    pub inventory: InventoryView,
    pub story: StoryStateView,
    pub dialogue_history: Vec<DialogueHistoryEntry>,
    pub pending_acquisition: Option<PendingAcquisitionView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAcquisitionView {
    pub id: String,
    pub record_kind: RecordKind,
    pub record_id: String,
    pub title: String,
    pub description: String,
    pub details: String,
    pub image_asset_id: Option<String>,
    pub created_by_command_id: u64,
    pub ordinal: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DialogueHistoryEntry {
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

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ModeView {
    Dialogue {
        current: DialogueItem,
        queue_remaining: usize,
        scene_tag: Option<String>,
        background_asset_id: Option<String>,
        bgm: Option<AudioCueView>,
        bgs: Option<AudioCueView>,
        queue_token: QueueToken,
        /// While an interrogation testimony plays in the dialogue box, the id
        /// of the (not-yet-broken) line the inline `反駁` challenge targets.
        /// `None` for every other dialogue (linear/investigation scenes, the
        /// challenge lead-in, on-correct reveals, honest-question testimony).
        cross_exam_line_id: Option<String>,
    },
    Explore {
        sublocation_id: String,
        background_asset_id: Option<String>,
        bgm: Option<AudioCueView>,
        bgs: Option<AudioCueView>,
    },
    Interrogation {
        phase_id: String,
        background_asset_id: Option<String>,
        bgm: Option<AudioCueView>,
        bgs: Option<AudioCueView>,
    },
    GameComplete,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCueView {
    pub channel: AudioChannelJson,
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueueToken {
    pub scene_id: String,
    pub queue_gen: u64,
    pub cursor: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterView {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub index: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SceneView {
    Linear {
        id: String,
        title: String,
        summary: String,
        index: usize,
        total: usize,
    },
    Investigation {
        id: String,
        title: String,
        summary: String,
        index: usize,
        total: usize,
        current_sublocation_id: Option<String>,
        visible_sublocations: Vec<SublocationView>,
    },
    Interrogation {
        id: String,
        title: String,
        summary: String,
        index: usize,
        total: usize,
        current_phase_id: Option<String>,
        visible_phases: Vec<InterrogationPhaseView>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneNavigationIndex {
    pub chapters: Vec<SceneNavigationChapter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneNavigationChapter {
    pub id: String,
    pub title: String,
    pub index: usize,
    pub scenes: Vec<SceneNavigationScene>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneNavigationScene {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub scene_type: SceneType,
    pub index: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SublocationView {
    pub id: String,
    pub label: String,
    pub scene_tag: String,
    pub hotspots: Vec<HotspotView>,
    pub characters: Vec<CharacterView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotspotView {
    pub id: String,
    pub label: String,
    pub description: String,
    pub inspected: bool,
    pub layout: Option<HotspotLayoutJson>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterView {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bio: String,
    pub layout: Option<CharacterLayoutJson>,
    pub topics: Vec<TopicView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicView {
    pub id: String,
    pub label: String,
    pub discussed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterrogationPhaseView {
    pub id: String,
    pub label: String,
    pub subject: SubjectView,
    pub questions: Vec<InquiryQuestionView>,
    /// Some when a testimony is actively being cross-examined (playing a
    /// line or presenting evidence); None while the player is at the
    /// question menu.
    pub cross_exam: Option<CrossExamView>,
    /// True when the player may manually complete this (current) phase: it is
    /// the current `Auto` phase, no cross-examination is active, and every
    /// required question is broken. Drives the "完成訊問" button.
    pub can_complete: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectView {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bio: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InquiryQuestionView {
    pub id: String,
    pub label: String,
    pub broken: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossExamView {
    pub question_id: String,
    pub line_id: String,
    pub line_label: String,
    /// Echoed current line, rendered in DialogueBox styling.
    pub line_content: Vec<DialogueItem>,
    pub line_index: usize,
    pub line_total: usize,
    /// True when the evidence tray should be shown.
    pub presenting: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::provenance::{
        CaseRecordProvenance, Completeness, Confidence, ProceduralStatus, ProofCapability,
        RepresentationLayer, SourceKind,
    };
    use crate::game::schema::{EvidenceJson, SceneType, StatementJson};
    use crate::game::state::{ChapterManifest, Inventory, SceneRef};
    use crate::game::story_location::StoryLocationIndex;
    use crate::game::test_support::{
        catalog_with_case_records, catalog_with_case_records_and_source_groups,
    };
    use serde_json::json;
    use std::collections::BTreeSet;

    fn lead_provenance() -> CaseRecordProvenance {
        CaseRecordProvenance {
            source_kind: SourceKind::Physical,
            representation_layer: RepresentationLayer::Raw,
            procedural_status: ProceduralStatus::Lead,
            completeness: Completeness::Partial,
            confidence: Confidence::Unverified,
            source_group_id: None,
            source_label: Some("Station camera".into()),
            proof_capabilities: BTreeSet::from([ProofCapability::Source, ProofCapability::Time]),
            supersedes_record_id: None,
        }
    }

    fn successor_provenance() -> CaseRecordProvenance {
        CaseRecordProvenance {
            source_kind: SourceKind::Digital,
            representation_layer: RepresentationLayer::Sync,
            procedural_status: ProceduralStatus::Reacquired,
            completeness: Completeness::Complete,
            confidence: Confidence::Corroborated,
            source_group_id: None,
            source_label: Some("Reacquired station camera".into()),
            proof_capabilities: BTreeSet::from([
                ProofCapability::Source,
                ProofCapability::Route,
                ProofCapability::Time,
            ]),
            supersedes_record_id: Some("evidence:evidence_a".into()),
        }
    }

    fn evidence_definition(id: &str, provenance: CaseRecordProvenance) -> EvidenceJson {
        EvidenceJson {
            id: id.into(),
            name: format!("Evidence {id}"),
            description: format!("Description {id}"),
            details: format!("Details {id}"),
            provenance,
            image_asset_id: Some(format!("evidence.{id}")),
            on_collect: vec![],
            on_reexamine: None,
        }
    }

    fn statement_definition(id: &str, provenance: CaseRecordProvenance) -> StatementJson {
        StatementJson {
            id: id.into(),
            speaker: "Witness".into(),
            content: format!("Statement {id}"),
            provenance,
            on_acquire: vec![],
            on_reexamine: None,
        }
    }

    fn fixture_inventory_view() -> Result<InventoryView, GameError> {
        let grouped = CaseRecordProvenance {
            source_group_id: Some("rain_bell_lock_source".into()),
            ..lead_provenance()
        };
        let neutral = CaseRecordProvenance::default();
        let catalog = catalog_with_case_records_and_source_groups(
            vec![
                ("evidence_a", "chapter_1", "scene_1", grouped.clone()),
                ("evidence_b", "chapter_1", "scene_1", neutral.clone()),
            ],
            vec![("statement_a", "chapter_1", "scene_1", neutral.clone())],
            vec![json!({
                "id": "rain_bell_lock_source",
                "label": "雨鐘門鎖原始來源",
                "summary": "同一把門鎖的原始採證與記錄。",
                "members": [{"kind": "evidence", "id": "evidence_a"}],
            })],
        );
        let resources = tempfile::tempdir().unwrap();
        std::fs::create_dir(resources.path().join("chapter_1")).unwrap();
        std::fs::write(
            resources.path().join("chapter_1/scene_1.json"),
            json!({
                "type": "linear",
                "id": "scene_1",
                "title": "反轉調查",
                "queue": [{"kind": "line", "speaker": "Narrator", "text": "..."}],
            })
            .to_string(),
        )
        .unwrap();
        let locations = StoryLocationIndex::load(
            resources.path(),
            &StoryCatalog::empty(),
            &[ChapterManifest {
                id: "chapter_1".into(),
                title: "雨鐘咖啡館殺人事件".into(),
                summary: "summary".into(),
                scenes: vec![SceneRef {
                    scene_type: SceneType::Linear,
                    file: "chapter_1/scene_1.json".into(),
                }],
            }],
        )?;
        let mut inventory = Inventory::default();
        assert!(inventory.add_evidence_from_def(
            &evidence_definition("evidence_a", grouped),
            "chapter_1",
            "scene_1",
        ));
        assert!(inventory.add_evidence_from_def(
            &evidence_definition("evidence_b", neutral.clone()),
            "chapter_1",
            "scene_1",
        ));
        assert!(inventory.add_statement_from_def(
            &statement_definition("statement_a", neutral),
            "chapter_1",
            "scene_1",
        ));

        InventoryView::from_inventory(&catalog, &inventory, &locations)
    }

    fn fixture_location_index() -> StoryLocationIndex {
        let resources = tempfile::tempdir().unwrap();
        std::fs::create_dir(resources.path().join("chapter_1")).unwrap();
        std::fs::write(
            resources.path().join("chapter_1/scene_1.json"),
            json!({
                "type": "linear",
                "id": "scene_1",
                "title": "Test scene",
                "queue": [{"kind": "line", "speaker": "Narrator", "text": "..."}],
            })
            .to_string(),
        )
        .unwrap();
        StoryLocationIndex::load(
            resources.path(),
            &StoryCatalog::empty(),
            &[ChapterManifest {
                id: "chapter_1".into(),
                title: "Test chapter".into(),
                summary: "summary".into(),
                scenes: vec![SceneRef {
                    scene_type: SceneType::Linear,
                    file: "chapter_1/scene_1.json".into(),
                }],
            }],
        )
        .unwrap()
    }

    #[test]
    fn acquired_record_view_resolves_location_and_group_without_membership() {
        let view = fixture_inventory_view().unwrap();
        let evidence = &view.evidence[0];

        assert_eq!(evidence.acquisition_context.scene_title, "反轉調查");
        assert_eq!(
            evidence.source_group.as_ref().unwrap().label,
            "雨鐘門鎖原始來源"
        );
        let json = serde_json::to_value(evidence).unwrap();
        assert!(json["sourceGroup"].get("members").is_none());
        assert_eq!(
            view.evidence
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            vec!["evidence_a", "evidence_b"],
            "public evidence must retain acquisition order"
        );
        assert_eq!(
            serde_json::to_value(&view.evidence[1]).unwrap()["sourceGroup"],
            json!(null)
        );
        assert_eq!(
            serde_json::to_value(&view.statements[0]).unwrap()["sourceGroup"],
            json!(null)
        );
        assert_eq!(
            view.statements[0].acquisition_context.scene_title,
            "反轉調查"
        );
    }

    #[test]
    fn public_inventory_fails_closed_when_acquired_record_location_is_missing() {
        let provenance = lead_provenance();
        let catalog = catalog_with_case_records(
            vec![("evidence_a", "chapter_1", "scene_1", provenance.clone())],
            vec![],
        );
        let mut inventory = Inventory::default();
        assert!(inventory.add_evidence_from_def(
            &evidence_definition("evidence_a", provenance),
            "chapter_1",
            "scene_1",
        ));

        let error =
            InventoryView::from_inventory(&catalog, &inventory, &StoryLocationIndex::empty())
                .unwrap_err();

        assert_eq!(error.code, "storyLocationMissing");
    }

    #[test]
    fn public_inventory_recomputes_predecessor_redaction_and_preserves_acquisition_order() {
        let lead = lead_provenance();
        let successor = successor_provenance();
        let neutral = CaseRecordProvenance::default();
        let catalog = catalog_with_case_records(
            vec![
                ("evidence_a", "chapter_1", "scene_1", lead.clone()),
                ("evidence_b", "chapter_1", "scene_1", successor.clone()),
            ],
            vec![
                ("statement_z", "chapter_1", "scene_1", neutral.clone()),
                ("statement_a", "chapter_1", "scene_1", neutral.clone()),
            ],
        );
        let locations = fixture_location_index();
        let mut inventory = Inventory::default();
        assert!(inventory.add_evidence_from_def(
            &evidence_definition("evidence_b", successor),
            "chapter_1",
            "scene_1",
        ));
        assert!(inventory.add_statement_from_def(
            &statement_definition("statement_z", neutral.clone()),
            "chapter_1",
            "scene_1",
        ));
        assert!(inventory.add_statement_from_def(
            &statement_definition("statement_a", neutral),
            "chapter_1",
            "scene_1",
        ));

        let hidden = serde_json::to_value(
            InventoryView::from_inventory(&catalog, &inventory, &locations).unwrap(),
        )
        .unwrap();
        assert_eq!(
            hidden["evidence"][0]["provenance"]["supersedesRecordId"],
            json!(null)
        );
        assert_eq!(
            hidden["evidence"][0]["provenance"]["proofCapabilities"],
            json!(["time", "route", "source"])
        );
        assert_eq!(
            hidden["statements"]
                .as_array()
                .unwrap()
                .iter()
                .map(|record| record["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["statement_z", "statement_a"],
            "public statements must retain their acquisition order"
        );
        assert_eq!(
            hidden["statements"][0]["provenance"],
            json!({
                "sourceKind": "unspecified",
                "representationLayer": "none",
                "proceduralStatus": "unspecified",
                "completeness": "unspecified",
                "confidence": "unspecified",
                "sourceGroupId": null,
                "sourceLabel": null,
                "proofCapabilities": [],
                "supersedesRecordId": null
            })
        );
        assert!(
            hidden["evidence"][0].get("successorRecordId").is_none(),
            "a predecessor-only public record must not gain a future-successor field"
        );
        assert!(
            hidden["evidence"][0]["provenance"]
                .get("successorRecordId")
                .is_none(),
            "public provenance must not disclose a packaged future successor"
        );

        assert!(inventory.add_evidence_from_def(
            &evidence_definition("evidence_a", lead),
            "chapter_1",
            "scene_1",
        ));
        let revealed = serde_json::to_value(
            InventoryView::from_inventory(&catalog, &inventory, &locations).unwrap(),
        )
        .unwrap();
        assert_eq!(
            revealed["evidence"]
                .as_array()
                .unwrap()
                .iter()
                .map(|record| record["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["evidence_b", "evidence_a"],
            "public evidence must retain its acquisition order"
        );
        assert_eq!(
            revealed["evidence"][0]["provenance"]["supersedesRecordId"],
            "evidence:evidence_a"
        );
        assert_eq!(
            revealed["evidence"][1]["provenance"]["supersedesRecordId"],
            json!(null),
            "acquiring a predecessor must not reveal its packaged successor"
        );
    }

    #[test]
    fn public_inventory_rejects_mutated_internal_provenance_at_its_own_boundary() {
        let expected = lead_provenance();
        let catalog = catalog_with_case_records(
            vec![("evidence_a", "chapter_1", "scene_1", expected.clone())],
            vec![],
        );
        let mut inventory = Inventory::default();
        assert!(inventory.add_evidence_from_def(
            &evidence_definition("evidence_a", expected),
            "chapter_1",
            "scene_1",
        ));
        inventory.evidence[0].provenance.confidence = Confidence::Disputed;

        let error = InventoryView::from_inventory(&catalog, &inventory, &fixture_location_index())
            .unwrap_err();

        assert_eq!(error.code, "inventoryRecordDefinitionMismatch");
        assert_ne!(error.code, "caseRecordDefinitionMismatch");
    }

    #[test]
    fn public_inventory_validates_statement_acquisition_origin() {
        let catalog = catalog_with_case_records(
            vec![],
            vec![(
                "statement_a",
                "chapter_1",
                "scene_1",
                CaseRecordProvenance::default(),
            )],
        );
        let mut inventory = Inventory::default();
        assert!(inventory.add_statement_from_def(
            &statement_definition("statement_a", CaseRecordProvenance::default()),
            "chapter_1",
            "scene_1",
        ));
        inventory.statements[0].acquired_in_scene_id = "scene_other".into();

        let error = InventoryView::from_inventory(&catalog, &inventory, &fixture_location_index())
            .unwrap_err();

        assert_eq!(error.code, "inventoryRecordDefinitionMismatch");
    }
}
