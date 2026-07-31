use super::catalog::{ObjectiveKind, StoryCatalog};
use super::state::{AssertionOrigin, StoryState};
use crate::game::schema::{compare_inventory_targets, InventoryTarget};
use crate::game::story_location::{SceneLocationContextView, StoryLocationIndex};
use crate::game::GameError;
use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryStateView {
    pub facts: Vec<FactView>,
    pub questions: Vec<QuestionView>,
    pub objectives: Vec<ObjectiveView>,
    pub authorizations: Vec<AuthorizationView>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactView {
    pub id: String,
    pub label: String,
    pub summary: String,
    pub details: String,
    pub category: String,
    pub asserted_in_chapter_id: Option<String>,
    pub asserted_in_scene_id: Option<String>,
    pub first_origin: AssertionOrigin,
    pub(in crate::game) origin_context: OriginContextView,
    /// Empty means no acquired direct supporting records are exposed. Internal
    /// story progress may still contain direct support that is not yet acquired.
    pub supporting_records: Vec<InventoryTarget>,
    pub supporting_fact_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionView {
    pub id: String,
    pub label: String,
    pub summary: String,
    pub status: QuestionStatusView,
    pub resolved_by_fact_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QuestionStatusView {
    Open,
    Resolved,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveView {
    pub id: String,
    pub label: String,
    pub summary: String,
    pub kind: ObjectiveKindView,
    pub sort_order: i64,
    pub completed: bool,
    pub active_primary: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ObjectiveKindView {
    Primary,
    Secondary,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(in crate::game) enum OriginContextView {
    Scene {
        origin_kind: OriginContextKindView,
        location: SceneLocationContextView,
    },
    Migration,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::game) enum OriginContextKindView {
    SceneEvent,
    AnalysisBoard,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationView {
    pub id: String,
    pub label: String,
    pub summary: String,
    pub granting_authority: String,
    pub granted_in_chapter_id: Option<String>,
    pub granted_in_scene_id: Option<String>,
    pub first_origin: AssertionOrigin,
    pub(in crate::game) origin_context: OriginContextView,
}

impl StoryStateView {
    pub(in crate::game) fn from_catalog_state(
        catalog: &StoryCatalog,
        state: &StoryState,
        acquired_targets: &BTreeSet<InventoryTarget>,
        locations: &StoryLocationIndex,
    ) -> Result<Self, GameError> {
        let facts = catalog
            .facts()
            .filter_map(|definition| {
                state
                    .facts
                    .get(&definition.id)
                    .map(|progress| (definition, progress))
            })
            .map(|(definition, progress)| {
                let mut supporting_records = progress
                    .supporting_records
                    .iter()
                    .filter(|target| acquired_targets.contains(*target))
                    .cloned()
                    .collect::<Vec<_>>();
                supporting_records.sort_by(compare_inventory_targets);
                Ok(FactView {
                    id: definition.id.clone(),
                    label: definition.label.clone(),
                    summary: definition.summary.clone(),
                    details: definition.details.clone(),
                    category: definition.category.clone(),
                    asserted_in_chapter_id: progress.asserted_in_chapter_id.clone(),
                    asserted_in_scene_id: progress.asserted_in_scene_id.clone(),
                    first_origin: progress.first_origin.clone(),
                    origin_context: origin_context(&progress.first_origin, locations)?,
                    supporting_records,
                    supporting_fact_ids: progress.supporting_fact_ids.iter().cloned().collect(),
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let questions = catalog
            .questions()
            .filter_map(|definition| {
                let progress = state.questions.get(&definition.id)?;
                Some(QuestionView {
                    id: definition.id.clone(),
                    label: definition.label.clone(),
                    summary: definition.summary.clone(),
                    status: if progress.resolved_by_fact_id.is_some() {
                        QuestionStatusView::Resolved
                    } else {
                        QuestionStatusView::Open
                    },
                    resolved_by_fact_id: progress.resolved_by_fact_id.clone(),
                })
            })
            .collect();

        let mut objectives = catalog
            .objectives()
            .filter_map(|definition| {
                let progress = state.objectives.get(&definition.id)?;
                let completed = progress.completed;
                Some(ObjectiveView {
                    id: definition.id.clone(),
                    label: definition.label.clone(),
                    summary: definition.summary.clone(),
                    kind: match definition.kind {
                        ObjectiveKind::Primary => ObjectiveKindView::Primary,
                        ObjectiveKind::Secondary => ObjectiveKindView::Secondary,
                    },
                    sort_order: definition.sort_order,
                    completed,
                    active_primary: !completed
                        && state.active_primary_objective_id.as_deref()
                            == Some(definition.id.as_str()),
                })
            })
            .collect::<Vec<_>>();
        objectives.sort_by(|left, right| {
            (left.sort_order, left.id.as_str()).cmp(&(right.sort_order, right.id.as_str()))
        });

        let authorizations = catalog
            .authorizations()
            .filter_map(|definition| {
                state
                    .authorizations
                    .get(&definition.id)
                    .map(|progress| (definition, progress))
            })
            .map(|(definition, progress)| {
                Ok(AuthorizationView {
                    id: definition.id.clone(),
                    label: definition.label.clone(),
                    summary: definition.summary.clone(),
                    granting_authority: definition.granting_authority.clone(),
                    granted_in_chapter_id: progress.granted_in_chapter_id.clone(),
                    granted_in_scene_id: progress.granted_in_scene_id.clone(),
                    first_origin: progress.first_origin.clone(),
                    origin_context: origin_context(&progress.first_origin, locations)?,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Self {
            facts,
            questions,
            objectives,
            authorizations,
        })
    }
}

fn origin_context(
    origin: &AssertionOrigin,
    locations: &StoryLocationIndex,
) -> Result<OriginContextView, GameError> {
    match origin {
        AssertionOrigin::SceneEvent {
            chapter_id,
            scene_id,
            ..
        } => Ok(OriginContextView::Scene {
            origin_kind: OriginContextKindView::SceneEvent,
            location: locations.resolve_scene(chapter_id, scene_id)?,
        }),
        AssertionOrigin::AnalysisBoard {
            chapter_id,
            scene_id,
            ..
        } => Ok(OriginContextView::Scene {
            origin_kind: OriginContextKindView::AnalysisBoard,
            location: locations.resolve_scene(chapter_id, scene_id)?,
        }),
        AssertionOrigin::Migration { .. } => Ok(OriginContextView::Migration),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{InventoryTarget, SceneType};
    use crate::game::state::{ChapterManifest, SceneRef};
    use crate::game::story::{AssertionOrigin, StoryCatalog, StoryEventBlockKind, StoryState};
    use crate::game::story_location::StoryLocationIndex;
    use serde_json::json;
    use std::collections::BTreeSet;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn catalog() -> StoryCatalog {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "lyra-story-view-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            path.join("story_catalog.json"),
            r#"{
  "schemaVersion": 2,
  "facts": [
    {"id":"fact_first","label":"First fact","summary":"First summary","details":"First details","category":"timeline"},
    {"id":"fact_second","label":"Second fact","summary":"Second summary","details":"Second details","category":"motive"},
    {"id":"fact_untouched","label":"Untouched fact","summary":"Hidden","details":"Hidden","category":"identity"}
  ],
  "questions": [
    {"id":"question_open","label":"Open question","summary":"Open summary","resolvedByFactIds":["fact_first"]},
    {"id":"question_resolved","label":"Resolved question","summary":"Resolved summary","resolvedByFactIds":["fact_first","fact_second"]},
    {"id":"question_untouched","label":"Untouched question","summary":"Hidden","resolvedByFactIds":["fact_second"]}
  ],
  "objectives": [
    {"id":"objective_secondary","label":"Secondary","summary":"Secondary summary","kind":"secondary","sortOrder":20},
    {"id":"objective_primary_b","label":"Primary B","summary":"Primary B summary","kind":"primary","sortOrder":10},
    {"id":"objective_primary_a","label":"Primary A","summary":"Primary A summary","kind":"primary","sortOrder":10},
    {"id":"objective_completed","label":"Completed","summary":"Completed summary","kind":"primary","sortOrder":30},
    {"id":"objective_untouched","label":"Untouched","summary":"Hidden","kind":"secondary","sortOrder":0}
  ],
  "authorizations": [
    {"id":"authorization_scene","label":"Scene authorization","summary":"Scene summary","grantingAuthority":"Police"},
    {"id":"authorization_migration","label":"Migration authorization","summary":"Migration summary","grantingAuthority":"Court"},
    {"id":"authorization_untouched","label":"Untouched authorization","summary":"Hidden","grantingAuthority":"Hidden"}
  ],
  "sourceGroups": [],
  "evidenceIndex": [
    {
      "id":"evidence_z",
      "chapterId":"chapter_1",
      "sceneId":"scene_1",
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
    },
    {
      "id":"evidence_a",
      "chapterId":"chapter_1",
      "sceneId":"scene_1",
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
    }
  ],
  "statementsIndex": [
    {
      "id":"statement_b",
      "chapterId":"chapter_1",
      "sceneId":"scene_1",
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
    }
  ]
}"#,
        )
        .unwrap();
        let catalog = StoryCatalog::load(&path).unwrap();
        std::fs::remove_dir_all(path).unwrap();
        catalog
    }

    fn populated_state(catalog: &StoryCatalog) -> StoryState {
        let mut state = StoryState::default();
        state
            .assert_fact(
                catalog,
                "fact_first",
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "scene_1".into(),
                    block_kind: StoryEventBlockKind::Hotspot,
                    block_id: "hotspot_clock".into(),
                },
                &[
                    InventoryTarget::Statement {
                        id: "statement_b".into(),
                    },
                    InventoryTarget::Evidence {
                        id: "evidence_z".into(),
                    },
                    InventoryTarget::Evidence {
                        id: "evidence_a".into(),
                    },
                ],
                &[],
            )
            .unwrap();
        state
            .assert_fact(
                catalog,
                "fact_second",
                AssertionOrigin::Migration {
                    migration_id: "legacy_case".into(),
                },
                &[],
                &["fact_first".into()],
            )
            .unwrap();
        state.reveal_question(catalog, "question_open").unwrap();
        state
            .resolve_question(catalog, "question_resolved", "fact_second")
            .unwrap();
        state
            .reveal_objective(catalog, "objective_secondary")
            .unwrap();
        state
            .set_primary_objective(catalog, false, Some("objective_primary_b"))
            .unwrap();
        state
            .reveal_objective(catalog, "objective_primary_a")
            .unwrap();
        state
            .complete_objective(catalog, "objective_completed")
            .unwrap();
        state
            .grant_authorization(
                catalog,
                "authorization_scene",
                AssertionOrigin::AnalysisBoard {
                    chapter_id: "chapter_1".into(),
                    scene_id: "scene_2".into(),
                    board_id: "timeline_board".into(),
                },
            )
            .unwrap();
        state
            .grant_authorization(
                catalog,
                "authorization_migration",
                AssertionOrigin::Migration {
                    migration_id: "legacy_auth".into(),
                },
            )
            .unwrap();
        state
    }

    fn location_index() -> StoryLocationIndex {
        let resources = tempfile::tempdir().unwrap();
        std::fs::create_dir(resources.path().join("chapter_1")).unwrap();
        for (scene_id, scene_title) in [("scene_1", "First scene"), ("scene_2", "Second scene")] {
            std::fs::write(
                resources.path().join(format!("chapter_1/{scene_id}.json")),
                json!({
                    "type": "linear",
                    "id": scene_id,
                    "title": scene_title,
                    "queue": [{"kind": "line", "speaker": "Narrator", "text": "..."}],
                })
                .to_string(),
            )
            .unwrap();
        }
        StoryLocationIndex::load(
            resources.path(),
            &StoryCatalog::empty(),
            &[ChapterManifest {
                id: "chapter_1".into(),
                title: "First chapter".into(),
                summary: "summary".into(),
                scenes: vec![
                    SceneRef {
                        scene_type: SceneType::Linear,
                        file: "chapter_1/scene_1.json".into(),
                    },
                    SceneRef {
                        scene_type: SceneType::Linear,
                        file: "chapter_1/scene_2.json".into(),
                    },
                ],
            }],
        )
        .unwrap()
    }

    fn build_story_view_with_origin(
        origin: AssertionOrigin,
        locations: &StoryLocationIndex,
    ) -> Result<StoryStateView, crate::game::GameError> {
        let catalog = catalog();
        let mut state = StoryState::default();
        state
            .assert_fact(&catalog, "fact_first", origin, &[], &[])
            .unwrap();
        StoryStateView::from_catalog_state(&catalog, &state, &BTreeSet::new(), locations)
    }

    #[test]
    fn story_state_view_scene_event_origin_resolves_titles() {
        let locations = location_index();
        let view = build_story_view_with_origin(
            AssertionOrigin::SceneEvent {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_1".into(),
                block_kind: StoryEventBlockKind::Hotspot,
                block_id: "hotspot_clock".into(),
            },
            &locations,
        )
        .unwrap();

        assert_eq!(
            view.facts[0].origin_context,
            OriginContextView::Scene {
                origin_kind: OriginContextKindView::SceneEvent,
                location: crate::game::story_location::SceneLocationContextView {
                    chapter_id: "chapter_1".into(),
                    chapter_title: "First chapter".into(),
                    scene_id: "scene_1".into(),
                    scene_title: "First scene".into(),
                },
            }
        );
    }

    #[test]
    fn story_state_view_analysis_board_origin_resolves_titles() {
        let locations = location_index();
        let view = build_story_view_with_origin(
            AssertionOrigin::AnalysisBoard {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_2".into(),
                board_id: "timeline_board".into(),
            },
            &locations,
        )
        .unwrap();

        assert!(matches!(
            view.facts[0].origin_context,
            OriginContextView::Scene {
                origin_kind: OriginContextKindView::AnalysisBoard,
                location: crate::game::story_location::SceneLocationContextView {
                    ref chapter_title,
                    ref scene_title,
                    ..
                },
            } if chapter_title == "First chapter" && scene_title == "Second scene"
        ));
    }

    #[test]
    fn story_state_view_migration_origin_never_requires_scene_lookup() {
        let view = build_story_view_with_origin(
            AssertionOrigin::Migration {
                migration_id: "save_v1".into(),
            },
            &StoryLocationIndex::empty(),
        )
        .unwrap();

        assert_eq!(view.facts[0].origin_context, OriginContextView::Migration);
    }

    #[test]
    fn story_state_view_unknown_scene_origin_fails_closed_with_story_location_missing() {
        let error = build_story_view_with_origin(
            AssertionOrigin::SceneEvent {
                chapter_id: "chapter_missing".into(),
                scene_id: "scene_missing".into(),
                block_kind: StoryEventBlockKind::Hotspot,
                block_id: "hotspot_missing".into(),
            },
            &StoryLocationIndex::empty(),
        )
        .unwrap_err();

        assert_eq!(error.code, "storyLocationMissing");
    }

    #[test]
    fn filters_untouched_definitions_and_serializes_only_applied_progress() {
        let catalog = catalog();
        let state = populated_state(&catalog);
        let locations = location_index();
        let acquired_targets = BTreeSet::from([
            InventoryTarget::Evidence {
                id: "evidence_a".into(),
            },
            InventoryTarget::Evidence {
                id: "evidence_z".into(),
            },
            InventoryTarget::Statement {
                id: "statement_b".into(),
            },
        ]);

        let value = serde_json::to_value(
            StoryStateView::from_catalog_state(&catalog, &state, &acquired_targets, &locations)
                .unwrap(),
        )
        .unwrap();

        assert_eq!(
            value,
            json!({
                "facts": [
                    {
                        "id": "fact_first",
                        "label": "First fact",
                        "summary": "First summary",
                        "details": "First details",
                        "category": "timeline",
                        "assertedInChapterId": "chapter_1",
                        "assertedInSceneId": "scene_1",
                        "firstOrigin": {
                            "type": "sceneEvent",
                            "chapterId": "chapter_1",
                            "sceneId": "scene_1",
                            "blockKind": "hotspot",
                            "blockId": "hotspot_clock"
                        },
                        "originContext": {
                            "type": "scene",
                            "originKind": "sceneEvent",
                            "location": {
                                "chapterId": "chapter_1",
                                "chapterTitle": "First chapter",
                                "sceneId": "scene_1",
                                "sceneTitle": "First scene"
                            }
                        },
                        "supportingRecords": [
                            {"kind": "evidence", "id": "evidence_a"},
                            {"kind": "evidence", "id": "evidence_z"},
                            {"kind": "statement", "id": "statement_b"}
                        ],
                        "supportingFactIds": []
                    },
                    {
                        "id": "fact_second",
                        "label": "Second fact",
                        "summary": "Second summary",
                        "details": "Second details",
                        "category": "motive",
                        "assertedInChapterId": null,
                        "assertedInSceneId": null,
                        "firstOrigin": {"type": "migration", "migrationId": "legacy_case"},
                        "originContext": {"type": "migration"},
                        "supportingRecords": [],
                        "supportingFactIds": ["fact_first"]
                    }
                ],
                "questions": [
                    {
                        "id": "question_open",
                        "label": "Open question",
                        "summary": "Open summary",
                        "status": "open",
                        "resolvedByFactId": null
                    },
                    {
                        "id": "question_resolved",
                        "label": "Resolved question",
                        "summary": "Resolved summary",
                        "status": "resolved",
                        "resolvedByFactId": "fact_second"
                    }
                ],
                "objectives": [
                    {
                        "id": "objective_primary_a",
                        "label": "Primary A",
                        "summary": "Primary A summary",
                        "kind": "primary",
                        "sortOrder": 10,
                        "completed": false,
                        "activePrimary": false
                    },
                    {
                        "id": "objective_primary_b",
                        "label": "Primary B",
                        "summary": "Primary B summary",
                        "kind": "primary",
                        "sortOrder": 10,
                        "completed": false,
                        "activePrimary": true
                    },
                    {
                        "id": "objective_secondary",
                        "label": "Secondary",
                        "summary": "Secondary summary",
                        "kind": "secondary",
                        "sortOrder": 20,
                        "completed": false,
                        "activePrimary": false
                    },
                    {
                        "id": "objective_completed",
                        "label": "Completed",
                        "summary": "Completed summary",
                        "kind": "primary",
                        "sortOrder": 30,
                        "completed": true,
                        "activePrimary": false
                    }
                ],
                "authorizations": [
                    {
                        "id": "authorization_scene",
                        "label": "Scene authorization",
                        "summary": "Scene summary",
                        "grantingAuthority": "Police",
                        "grantedInChapterId": "chapter_1",
                        "grantedInSceneId": "scene_2",
                        "firstOrigin": {
                            "type": "analysisBoard",
                            "chapterId": "chapter_1",
                            "sceneId": "scene_2",
                            "boardId": "timeline_board"
                        },
                        "originContext": {
                            "type": "scene",
                            "originKind": "analysisBoard",
                            "location": {
                                "chapterId": "chapter_1",
                                "chapterTitle": "First chapter",
                                "sceneId": "scene_2",
                                "sceneTitle": "Second scene"
                            }
                        }
                    },
                    {
                        "id": "authorization_migration",
                        "label": "Migration authorization",
                        "summary": "Migration summary",
                        "grantingAuthority": "Court",
                        "grantedInChapterId": null,
                        "grantedInSceneId": null,
                        "firstOrigin": {"type": "migration", "migrationId": "legacy_auth"},
                        "originContext": {"type": "migration"}
                    }
                ]
            })
        );
        assert!(
            value["questions"][1].get("resolvedByFactIds").is_none(),
            "candidate resolver lists must remain immutable catalog-only data"
        );
    }

    #[test]
    fn public_facts_filter_unacquired_direct_support_and_sort_acquired_targets() {
        let catalog = catalog();
        let state = populated_state(&catalog);
        let locations = location_index();
        let mut acquired_targets = BTreeSet::from([InventoryTarget::Statement {
            id: "statement_b".into(),
        }]);

        let statement_only = serde_json::to_value(
            StoryStateView::from_catalog_state(&catalog, &state, &acquired_targets, &locations)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            statement_only["facts"][0]["supportingRecords"],
            json!([{"kind": "statement", "id": "statement_b"}])
        );
        assert_eq!(
            state
                .fact_progress("fact_first")
                .unwrap()
                .supporting_records()
                .len(),
            3,
            "public filtering must not erase inventory-independent internal support"
        );

        acquired_targets.insert(InventoryTarget::Evidence {
            id: "evidence_a".into(),
        });
        let evidence_then_statement = serde_json::to_value(
            StoryStateView::from_catalog_state(&catalog, &state, &acquired_targets, &locations)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            evidence_then_statement["facts"][0]["supportingRecords"],
            json!([
                {"kind": "evidence", "id": "evidence_a"},
                {"kind": "statement", "id": "statement_b"}
            ])
        );
    }

    #[test]
    fn empty_public_support_means_no_acquired_direct_support_without_a_spoiler_flag() {
        let catalog = catalog();
        let state = populated_state(&catalog);
        let locations = location_index();

        let value = serde_json::to_value(
            StoryStateView::from_catalog_state(&catalog, &state, &BTreeSet::new(), &locations)
                .unwrap(),
        )
        .unwrap();

        assert_eq!(value["facts"][0]["supportingRecords"], json!([]));
        assert_eq!(
            value["facts"][1]["supportingFactIds"],
            json!(["fact_first"]),
            "supporting fact IDs retain their existing asserted-fact semantics"
        );
        assert!(
            value["facts"][0]
                .get("hasHiddenSupportingRecords")
                .is_none(),
            "a hidden-support flag would itself disclose locked support"
        );
    }
}
