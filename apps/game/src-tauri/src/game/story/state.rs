use super::catalog::{ObjectiveKind, StoryCatalog};
use crate::game::schema::InventoryTarget;
use crate::game::GameError;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct FactProgress {
    pub(super) asserted_in_chapter_id: Option<String>,
    pub(super) asserted_in_scene_id: Option<String>,
    pub(super) first_origin: AssertionOrigin,
    pub(super) supporting_records: BTreeSet<InventoryTarget>,
    pub(super) supporting_fact_ids: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct QuestionProgress {
    pub(super) resolved_by_fact_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct ObjectiveProgress {
    pub(super) completed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct AuthorizationProgress {
    pub(super) granted_in_chapter_id: Option<String>,
    pub(super) granted_in_scene_id: Option<String>,
    pub(super) first_origin: AssertionOrigin,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(in crate::game) struct StoryState {
    pub(super) facts: BTreeMap<String, FactProgress>,
    pub(super) questions: BTreeMap<String, QuestionProgress>,
    pub(super) objectives: BTreeMap<String, ObjectiveProgress>,
    pub(super) authorizations: BTreeMap<String, AuthorizationProgress>,
    pub(super) active_primary_objective_id: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoryStateSnapshot {
    pub facts: BTreeMap<String, FactProgressSnapshot>,
    pub questions: BTreeMap<String, QuestionProgressSnapshot>,
    pub objectives: BTreeMap<String, ObjectiveProgressSnapshot>,
    pub authorizations: BTreeMap<String, AuthorizationProgressSnapshot>,
    pub active_primary_objective_id: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactProgressSnapshot {
    pub asserted_in_chapter_id: Option<String>,
    pub asserted_in_scene_id: Option<String>,
    pub first_origin: AssertionOrigin,
    pub supporting_records: BTreeSet<InventoryTarget>,
    pub supporting_fact_ids: BTreeSet<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionProgressSnapshot {
    pub resolved_by_fact_id: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObjectiveProgressSnapshot {
    pub completed: bool,
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthorizationProgressSnapshot {
    pub granted_in_chapter_id: Option<String>,
    pub granted_in_scene_id: Option<String>,
    pub first_origin: AssertionOrigin,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssertionOrigin {
    SceneEvent {
        chapter_id: String,
        scene_id: String,
        block_kind: StoryEventBlockKind,
        block_id: String,
    },
    AnalysisBoard {
        chapter_id: String,
        scene_id: String,
        board_id: String,
    },
    Migration {
        migration_id: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StoryEventBlockKind {
    Sublocation,
    Hotspot,
    Topic,
    InterrogationPhase,
    InquiryQuestion,
    TestimonyLine,
    StoryEvent,
}

#[allow(dead_code)]
impl AssertionOrigin {
    pub(super) fn derived_location(&self) -> Result<(Option<String>, Option<String>), String> {
        match self {
            Self::SceneEvent {
                chapter_id,
                scene_id,
                block_id,
                ..
            } => {
                validate_origin_segments(&[
                    ("chapterId", chapter_id),
                    ("sceneId", scene_id),
                    ("blockId", block_id),
                ])?;
                Ok((Some(chapter_id.clone()), Some(scene_id.clone())))
            }
            Self::AnalysisBoard {
                chapter_id,
                scene_id,
                board_id,
            } => {
                validate_origin_segments(&[
                    ("chapterId", chapter_id),
                    ("sceneId", scene_id),
                    ("boardId", board_id),
                ])?;
                Ok((Some(chapter_id.clone()), Some(scene_id.clone())))
            }
            Self::Migration { migration_id } => {
                validate_origin_segments(&[("migrationId", migration_id)])?;
                Ok((None, None))
            }
        }
    }
}

#[allow(dead_code)]
fn validate_origin_segments(segments: &[(&str, &String)]) -> Result<(), String> {
    for (name, value) in segments {
        if !is_slug(value) {
            return Err(format!(
                "assertion origin {name} '{value}' must match ^[a-z0-9_]+$"
            ));
        }
    }
    Ok(())
}

#[allow(dead_code)]
fn is_slug(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

#[allow(dead_code)]
impl StoryState {
    pub(crate) fn snapshot(&self) -> StoryStateSnapshot {
        StoryStateSnapshot {
            facts: self
                .facts
                .iter()
                .map(|(id, progress)| {
                    (
                        id.clone(),
                        FactProgressSnapshot {
                            asserted_in_chapter_id: progress.asserted_in_chapter_id.clone(),
                            asserted_in_scene_id: progress.asserted_in_scene_id.clone(),
                            first_origin: progress.first_origin.clone(),
                            supporting_records: progress.supporting_records.clone(),
                            supporting_fact_ids: progress.supporting_fact_ids.clone(),
                        },
                    )
                })
                .collect(),
            questions: self
                .questions
                .iter()
                .map(|(id, progress)| {
                    (
                        id.clone(),
                        QuestionProgressSnapshot {
                            resolved_by_fact_id: progress.resolved_by_fact_id.clone(),
                        },
                    )
                })
                .collect(),
            objectives: self
                .objectives
                .iter()
                .map(|(id, progress)| {
                    (
                        id.clone(),
                        ObjectiveProgressSnapshot {
                            completed: progress.completed,
                        },
                    )
                })
                .collect(),
            authorizations: self
                .authorizations
                .iter()
                .map(|(id, progress)| {
                    (
                        id.clone(),
                        AuthorizationProgressSnapshot {
                            granted_in_chapter_id: progress.granted_in_chapter_id.clone(),
                            granted_in_scene_id: progress.granted_in_scene_id.clone(),
                            first_origin: progress.first_origin.clone(),
                        },
                    )
                })
                .collect(),
            active_primary_objective_id: self.active_primary_objective_id.clone(),
        }
    }

    pub(crate) fn from_snapshot(
        catalog: &StoryCatalog,
        snapshot: StoryStateSnapshot,
    ) -> Result<Self, GameError> {
        validate_snapshot(catalog, &snapshot)?;

        Ok(Self {
            facts: snapshot
                .facts
                .into_iter()
                .map(|(id, progress)| {
                    (
                        id,
                        FactProgress {
                            asserted_in_chapter_id: progress.asserted_in_chapter_id,
                            asserted_in_scene_id: progress.asserted_in_scene_id,
                            first_origin: progress.first_origin,
                            supporting_records: progress.supporting_records,
                            supporting_fact_ids: progress.supporting_fact_ids,
                        },
                    )
                })
                .collect(),
            questions: snapshot
                .questions
                .into_iter()
                .map(|(id, progress)| {
                    (
                        id,
                        QuestionProgress {
                            resolved_by_fact_id: progress.resolved_by_fact_id,
                        },
                    )
                })
                .collect(),
            objectives: snapshot
                .objectives
                .into_iter()
                .map(|(id, progress)| {
                    (
                        id,
                        ObjectiveProgress {
                            completed: progress.completed,
                        },
                    )
                })
                .collect(),
            authorizations: snapshot
                .authorizations
                .into_iter()
                .map(|(id, progress)| {
                    (
                        id,
                        AuthorizationProgress {
                            granted_in_chapter_id: progress.granted_in_chapter_id,
                            granted_in_scene_id: progress.granted_in_scene_id,
                            first_origin: progress.first_origin,
                        },
                    )
                })
                .collect(),
            active_primary_objective_id: snapshot.active_primary_objective_id,
        })
    }
}

#[allow(dead_code)]
fn validate_snapshot(
    catalog: &StoryCatalog,
    snapshot: &StoryStateSnapshot,
) -> Result<(), GameError> {
    for (fact_id, progress) in &snapshot.facts {
        if catalog.fact(fact_id).is_none() {
            return Err(invalid_snapshot(format!(
                "fact progress references unknown fact '{fact_id}'"
            )));
        }
        let derived = progress
            .first_origin
            .derived_location()
            .map_err(invalid_snapshot)?;
        let stored = (
            progress.asserted_in_chapter_id.clone(),
            progress.asserted_in_scene_id.clone(),
        );
        if stored != derived {
            return Err(invalid_snapshot(format!(
                "fact '{fact_id}' stores a location that disagrees with its first origin"
            )));
        }
        for target in &progress.supporting_records {
            if !catalog.contains_inventory_target(target) {
                return Err(invalid_snapshot(format!(
                    "fact '{fact_id}' references unknown supporting record '{}:{}'",
                    inventory_target_kind(target),
                    inventory_target_id(target)
                )));
            }
        }
        for supporting_fact_id in &progress.supporting_fact_ids {
            if catalog.fact(supporting_fact_id).is_none() {
                return Err(invalid_snapshot(format!(
                    "fact '{fact_id}' references unknown supporting fact '{supporting_fact_id}'"
                )));
            }
            if !snapshot.facts.contains_key(supporting_fact_id) {
                return Err(invalid_snapshot(format!(
                    "fact '{fact_id}' references unasserted supporting fact '{supporting_fact_id}'"
                )));
            }
            if supporting_fact_id == fact_id {
                return Err(invalid_snapshot(format!(
                    "fact '{fact_id}' supports itself"
                )));
            }
            if support_chain_reaches(supporting_fact_id, fact_id, &snapshot.facts) {
                return Err(invalid_snapshot(format!(
                    "fact '{fact_id}' forms a supporting-fact cycle through '{supporting_fact_id}'"
                )));
            }
        }
    }

    for (question_id, progress) in &snapshot.questions {
        let Some(definition) = catalog.question(question_id) else {
            return Err(invalid_snapshot(format!(
                "question progress references unknown question '{question_id}'"
            )));
        };
        if let Some(fact_id) = &progress.resolved_by_fact_id {
            if catalog.fact(fact_id).is_none() {
                return Err(invalid_snapshot(format!(
                    "question '{question_id}' is resolved by unknown fact '{fact_id}'"
                )));
            }
            if !snapshot.facts.contains_key(fact_id) {
                return Err(invalid_snapshot(format!(
                    "question '{question_id}' is resolved by unasserted fact '{fact_id}'"
                )));
            }
            if !definition
                .resolved_by_fact_ids
                .iter()
                .any(|candidate| candidate == fact_id)
            {
                return Err(invalid_snapshot(format!(
                    "question '{question_id}' is resolved by non-candidate fact '{fact_id}'"
                )));
            }
        }
    }

    for objective_id in snapshot.objectives.keys() {
        if catalog.objective(objective_id).is_none() {
            return Err(invalid_snapshot(format!(
                "objective progress references unknown objective '{objective_id}'"
            )));
        }
    }

    for (authorization_id, progress) in &snapshot.authorizations {
        if catalog.authorization(authorization_id).is_none() {
            return Err(invalid_snapshot(format!(
                "authorization progress references unknown authorization '{authorization_id}'"
            )));
        }
        let derived = progress
            .first_origin
            .derived_location()
            .map_err(invalid_snapshot)?;
        let stored = (
            progress.granted_in_chapter_id.clone(),
            progress.granted_in_scene_id.clone(),
        );
        if stored != derived {
            return Err(invalid_snapshot(format!(
                "authorization '{authorization_id}' stores a location that disagrees with its first origin"
            )));
        }
    }

    if let Some(objective_id) = &snapshot.active_primary_objective_id {
        let Some(definition) = catalog.objective(objective_id) else {
            return Err(invalid_snapshot(format!(
                "active primary objective references unknown objective '{objective_id}'"
            )));
        };
        if definition.kind != ObjectiveKind::Primary {
            return Err(invalid_snapshot(format!(
                "active objective '{objective_id}' is not primary"
            )));
        }
        let Some(progress) = snapshot.objectives.get(objective_id) else {
            return Err(invalid_snapshot(format!(
                "active primary objective '{objective_id}' has not been revealed"
            )));
        };
        if progress.completed {
            return Err(invalid_snapshot(format!(
                "active primary objective '{objective_id}' is completed"
            )));
        }
    }

    Ok(())
}

#[allow(dead_code)]
fn invalid_snapshot(detail: impl Into<String>) -> GameError {
    GameError::invalid_story_state_snapshot(detail)
}

// Shared acyclicity check for supporting-fact edges. Both the live mutation
// path (`assert_fact`) and the snapshot rehydration path (`validate_snapshot`)
// need to reject a supporting fact that transitively depends on the fact being
// asserted. The `SupportFacts` trait lets one traversal serve both
// `FactProgress` (live) and `FactProgressSnapshot` (rehydrated) shapes.
pub(super) trait SupportFacts {
    fn supporting_fact_ids(&self) -> &BTreeSet<String>;
}

impl SupportFacts for FactProgress {
    fn supporting_fact_ids(&self) -> &BTreeSet<String> {
        &self.supporting_fact_ids
    }
}

impl SupportFacts for FactProgressSnapshot {
    fn supporting_fact_ids(&self) -> &BTreeSet<String> {
        &self.supporting_fact_ids
    }
}

/// Returns true when `start`'s supporting-fact chain reaches `target`.
///
/// `start` is a supporting fact already present in `facts`; the walk follows
/// each node's `supporting_fact_ids` and reports whether `target` appears
/// anywhere downstream. Visited tracking keeps the traversal linear in the
/// number of facts even when the existing graph already contains its own
/// (prevented) cycles.
pub(super) fn support_chain_reaches<T: SupportFacts>(
    start: &str,
    target: &str,
    facts: &BTreeMap<String, T>,
) -> bool {
    let mut stack: Vec<&str> = vec![start];
    let mut visited: BTreeSet<String> = BTreeSet::new();
    while let Some(current) = stack.pop() {
        if !visited.insert(current.to_owned()) {
            continue;
        }
        let Some(progress) = facts.get(current) else {
            continue;
        };
        for next in progress.supporting_fact_ids() {
            if next == target {
                return true;
            }
            if !visited.contains(next.as_str()) {
                stack.push(next);
            }
        }
    }
    false
}

#[allow(dead_code)]
pub(super) fn inventory_target_kind(target: &InventoryTarget) -> &'static str {
    match target {
        InventoryTarget::Evidence { .. } => "evidence",
        InventoryTarget::Statement { .. } => "statement",
    }
}

#[allow(dead_code)]
pub(super) fn inventory_target_id(target: &InventoryTarget) -> &str {
    match target {
        InventoryTarget::Evidence { id } | InventoryTarget::Statement { id } => id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::InventoryTarget;
    use std::collections::{BTreeMap, BTreeSet};
    use std::sync::atomic::{AtomicU64, Ordering};

    fn catalog() -> StoryCatalog {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "lyra-story-state-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            path.join("story_catalog.json"),
            r#"{
  "schemaVersion": 1,
  "facts": [
    {"id":"fact_alpha","label":"Alpha","summary":"Alpha","details":"Alpha details","category":"timeline"},
    {"id":"fact_beta","label":"Beta","summary":"Beta","details":"Beta details","category":"motive"},
    {"id":"fact_gamma","label":"Gamma","summary":"Gamma","details":"Gamma details","category":"identity"}
  ],
  "questions": [
    {"id":"question_main","label":"Main","summary":"Main","resolvedByFactIds":["fact_alpha","fact_beta"]}
  ],
  "objectives": [
    {"id":"primary_a","label":"Primary A","summary":"A","kind":"primary","sortOrder":1},
    {"id":"primary_b","label":"Primary B","summary":"B","kind":"primary","sortOrder":2},
    {"id":"secondary_a","label":"Secondary A","summary":"S","kind":"secondary","sortOrder":3}
  ],
  "authorizations": [
    {"id":"authorization_a","label":"Authorization A","summary":"A","grantingAuthority":"Police"}
  ],
  "evidenceIndex": [
    {"id":"evidence_a","chapterId":"chapter_1","sceneId":"scene_1"}
  ],
  "statementsIndex": [
    {"id":"statement_a","chapterId":"chapter_1","sceneId":"scene_1"}
  ]
}"#,
        )
        .unwrap();
        let catalog = StoryCatalog::load(&path).unwrap();
        std::fs::remove_dir_all(path).unwrap();
        catalog
    }

    fn empty_snapshot() -> StoryStateSnapshot {
        StoryStateSnapshot {
            facts: BTreeMap::new(),
            questions: BTreeMap::new(),
            objectives: BTreeMap::new(),
            authorizations: BTreeMap::new(),
            active_primary_objective_id: None,
        }
    }

    fn scene_origin() -> AssertionOrigin {
        AssertionOrigin::SceneEvent {
            chapter_id: "chapter_1".into(),
            scene_id: "scene_1".into(),
            block_kind: StoryEventBlockKind::Hotspot,
            block_id: "counter".into(),
        }
    }

    fn asserted_fact(origin: AssertionOrigin) -> FactProgressSnapshot {
        let (chapter_id, scene_id) = match &origin {
            AssertionOrigin::SceneEvent {
                chapter_id,
                scene_id,
                ..
            }
            | AssertionOrigin::AnalysisBoard {
                chapter_id,
                scene_id,
                ..
            } => (Some(chapter_id.clone()), Some(scene_id.clone())),
            AssertionOrigin::Migration { .. } => (None, None),
        };
        FactProgressSnapshot {
            asserted_in_chapter_id: chapter_id,
            asserted_in_scene_id: scene_id,
            first_origin: origin,
            supporting_records: BTreeSet::new(),
            supporting_fact_ids: BTreeSet::new(),
        }
    }

    fn valid_snapshot() -> StoryStateSnapshot {
        let mut fact_alpha = asserted_fact(scene_origin());
        fact_alpha.supporting_records = BTreeSet::from([
            InventoryTarget::Evidence {
                id: "evidence_a".into(),
            },
            InventoryTarget::Statement {
                id: "statement_a".into(),
            },
        ]);
        fact_alpha.supporting_fact_ids = BTreeSet::from(["fact_beta".into()]);

        StoryStateSnapshot {
            facts: BTreeMap::from([
                ("fact_alpha".into(), fact_alpha),
                (
                    "fact_beta".into(),
                    asserted_fact(AssertionOrigin::Migration {
                        migration_id: "legacy_import".into(),
                    }),
                ),
            ]),
            questions: BTreeMap::from([(
                "question_main".into(),
                QuestionProgressSnapshot {
                    resolved_by_fact_id: Some("fact_alpha".into()),
                },
            )]),
            objectives: BTreeMap::from([
                (
                    "primary_a".into(),
                    ObjectiveProgressSnapshot { completed: false },
                ),
                (
                    "secondary_a".into(),
                    ObjectiveProgressSnapshot { completed: true },
                ),
            ]),
            authorizations: BTreeMap::from([(
                "authorization_a".into(),
                AuthorizationProgressSnapshot {
                    granted_in_chapter_id: None,
                    granted_in_scene_id: None,
                    first_origin: AssertionOrigin::Migration {
                        migration_id: "legacy_import".into(),
                    },
                },
            )]),
            active_primary_objective_id: Some("primary_a".into()),
        }
    }

    fn reject(snapshot: StoryStateSnapshot) -> GameError {
        let result = StoryState::from_snapshot(&catalog(), snapshot);
        assert!(result.is_err());
        result.unwrap_err()
    }

    #[test]
    fn empty_state_snapshot_has_exact_sparse_shape() {
        let snapshot = StoryState::default().snapshot();

        assert_eq!(snapshot, empty_snapshot());
        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::json!({
                "facts": {},
                "questions": {},
                "objectives": {},
                "authorizations": {},
                "activePrimaryObjectiveId": null
            })
        );
    }

    #[test]
    fn populated_snapshot_round_trips_through_validating_live_join() {
        let snapshot = valid_snapshot();
        let encoded = serde_json::to_value(&snapshot).unwrap();
        let decoded: StoryStateSnapshot = serde_json::from_value(encoded).unwrap();

        let live = StoryState::from_snapshot(&catalog(), decoded).unwrap();

        assert_eq!(live.snapshot(), snapshot);
    }

    #[test]
    fn origins_and_every_story_event_block_kind_have_exact_wire_shape() {
        let kinds = [
            (StoryEventBlockKind::Sublocation, "sublocation"),
            (StoryEventBlockKind::Hotspot, "hotspot"),
            (StoryEventBlockKind::Topic, "topic"),
            (
                StoryEventBlockKind::InterrogationPhase,
                "interrogationPhase",
            ),
            (StoryEventBlockKind::InquiryQuestion, "inquiryQuestion"),
            (StoryEventBlockKind::TestimonyLine, "testimonyLine"),
            (StoryEventBlockKind::StoryEvent, "storyEvent"),
        ];
        for (kind, expected) in kinds {
            assert_eq!(
                serde_json::to_value(AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "scene_1".into(),
                    block_kind: kind,
                    block_id: "block_1".into(),
                })
                .unwrap(),
                serde_json::json!({
                    "type": "sceneEvent",
                    "chapterId": "chapter_1",
                    "sceneId": "scene_1",
                    "blockKind": expected,
                    "blockId": "block_1"
                })
            );
        }
        assert_eq!(
            serde_json::to_value(AssertionOrigin::AnalysisBoard {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_1".into(),
                board_id: "board_1".into(),
            })
            .unwrap(),
            serde_json::json!({
                "type": "analysisBoard",
                "chapterId": "chapter_1",
                "sceneId": "scene_1",
                "boardId": "board_1"
            })
        );
        assert_eq!(
            serde_json::to_value(AssertionOrigin::Migration {
                migration_id: "legacy_import".into(),
            })
            .unwrap(),
            serde_json::json!({
                "type": "migration",
                "migrationId": "legacy_import"
            })
        );
    }

    #[test]
    fn rejects_unknown_progress_map_keys() {
        let cases = [
            {
                let mut snapshot = empty_snapshot();
                snapshot
                    .facts
                    .insert("missing".into(), asserted_fact(scene_origin()));
                snapshot
            },
            {
                let mut snapshot = empty_snapshot();
                snapshot.questions.insert(
                    "missing".into(),
                    QuestionProgressSnapshot {
                        resolved_by_fact_id: None,
                    },
                );
                snapshot
            },
            {
                let mut snapshot = empty_snapshot();
                snapshot.objectives.insert(
                    "missing".into(),
                    ObjectiveProgressSnapshot { completed: false },
                );
                snapshot
            },
            {
                let mut snapshot = empty_snapshot();
                snapshot.authorizations.insert(
                    "missing".into(),
                    AuthorizationProgressSnapshot {
                        granted_in_chapter_id: None,
                        granted_in_scene_id: None,
                        first_origin: AssertionOrigin::Migration {
                            migration_id: "legacy_import".into(),
                        },
                    },
                );
                snapshot
            },
        ];

        for snapshot in cases {
            assert_eq!(reject(snapshot).code, "invalidStoryStateSnapshot");
        }
    }

    #[test]
    fn rejects_unknown_or_unasserted_direct_support() {
        let mut unknown_record = empty_snapshot();
        let mut progress = asserted_fact(scene_origin());
        progress
            .supporting_records
            .insert(InventoryTarget::Evidence {
                id: "missing".into(),
            });
        unknown_record.facts.insert("fact_alpha".into(), progress);
        assert_eq!(reject(unknown_record).code, "invalidStoryStateSnapshot");

        let mut unknown_fact = empty_snapshot();
        let mut progress = asserted_fact(scene_origin());
        progress.supporting_fact_ids.insert("missing".into());
        unknown_fact.facts.insert("fact_alpha".into(), progress);
        assert_eq!(reject(unknown_fact).code, "invalidStoryStateSnapshot");

        let mut unasserted_fact = empty_snapshot();
        let mut progress = asserted_fact(scene_origin());
        progress.supporting_fact_ids.insert("fact_beta".into());
        unasserted_fact.facts.insert("fact_alpha".into(), progress);
        assert_eq!(reject(unasserted_fact).code, "invalidStoryStateSnapshot");
    }

    #[test]
    fn rejects_self_support_and_transitive_support_cycles() {
        // Self-support: fact_alpha lists itself as a supporter.
        let mut self_support = valid_snapshot();
        let fact_alpha = self_support.facts.get_mut("fact_alpha").unwrap();
        fact_alpha.supporting_fact_ids.insert("fact_alpha".into());
        assert_eq!(reject(self_support).code, "invalidStoryStateSnapshot");

        // valid_snapshot already has fact_alpha -> fact_beta. Adding
        // fact_alpha to fact_beta's supporters closes the cycle
        // fact_alpha -> fact_beta -> fact_alpha.
        let mut cycle = valid_snapshot();
        let fact_beta = cycle.facts.get_mut("fact_beta").unwrap();
        fact_beta.supporting_fact_ids.insert("fact_alpha".into());
        assert_eq!(reject(cycle).code, "invalidStoryStateSnapshot");
    }

    #[test]
    fn rejects_invalid_resolved_question_fact() {
        let mut unknown = empty_snapshot();
        unknown.questions.insert(
            "question_main".into(),
            QuestionProgressSnapshot {
                resolved_by_fact_id: Some("missing".into()),
            },
        );
        assert_eq!(reject(unknown).code, "invalidStoryStateSnapshot");

        let mut unasserted = empty_snapshot();
        unasserted.questions.insert(
            "question_main".into(),
            QuestionProgressSnapshot {
                resolved_by_fact_id: Some("fact_alpha".into()),
            },
        );
        assert_eq!(reject(unasserted).code, "invalidStoryStateSnapshot");

        let mut non_candidate = empty_snapshot();
        non_candidate
            .facts
            .insert("fact_gamma".into(), asserted_fact(scene_origin()));
        non_candidate.questions.insert(
            "question_main".into(),
            QuestionProgressSnapshot {
                resolved_by_fact_id: Some("fact_gamma".into()),
            },
        );
        assert_eq!(reject(non_candidate).code, "invalidStoryStateSnapshot");
    }

    #[test]
    fn rejects_origin_location_mismatches_for_facts_and_authorizations() {
        let mut fact_mismatch = empty_snapshot();
        let mut progress = asserted_fact(scene_origin());
        progress.asserted_in_chapter_id = Some("chapter_2".into());
        fact_mismatch.facts.insert("fact_alpha".into(), progress);
        assert_eq!(reject(fact_mismatch).code, "invalidStoryStateSnapshot");

        let mut authorization_mismatch = empty_snapshot();
        authorization_mismatch.authorizations.insert(
            "authorization_a".into(),
            AuthorizationProgressSnapshot {
                granted_in_chapter_id: Some("chapter_1".into()),
                granted_in_scene_id: Some("scene_1".into()),
                first_origin: AssertionOrigin::Migration {
                    migration_id: "legacy_import".into(),
                },
            },
        );
        assert_eq!(
            reject(authorization_mismatch).code,
            "invalidStoryStateSnapshot"
        );
    }

    #[test]
    fn rejects_malformed_ids_in_every_origin_variant() {
        let origins = [
            AssertionOrigin::SceneEvent {
                chapter_id: "bad-id".into(),
                scene_id: "scene_1".into(),
                block_kind: StoryEventBlockKind::StoryEvent,
                block_id: "block_1".into(),
            },
            AssertionOrigin::SceneEvent {
                chapter_id: "chapter_1".into(),
                scene_id: "".into(),
                block_kind: StoryEventBlockKind::StoryEvent,
                block_id: "block_1".into(),
            },
            AssertionOrigin::SceneEvent {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_1".into(),
                block_kind: StoryEventBlockKind::StoryEvent,
                block_id: "bad.id".into(),
            },
            AssertionOrigin::AnalysisBoard {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_1".into(),
                board_id: "bad board".into(),
            },
            AssertionOrigin::Migration {
                migration_id: "BadMigration".into(),
            },
        ];

        for origin in origins {
            let mut snapshot = empty_snapshot();
            snapshot
                .facts
                .insert("fact_alpha".into(), asserted_fact(origin));
            assert_eq!(reject(snapshot).code, "invalidStoryStateSnapshot");
        }
    }

    #[test]
    fn rejects_invalid_active_primary_objective_invariants() {
        let cases = [
            {
                let mut snapshot = empty_snapshot();
                snapshot.active_primary_objective_id = Some("missing".into());
                snapshot
            },
            {
                let mut snapshot = empty_snapshot();
                snapshot.objectives.insert(
                    "secondary_a".into(),
                    ObjectiveProgressSnapshot { completed: false },
                );
                snapshot.active_primary_objective_id = Some("secondary_a".into());
                snapshot
            },
            {
                let mut snapshot = empty_snapshot();
                snapshot.active_primary_objective_id = Some("primary_a".into());
                snapshot
            },
            {
                let mut snapshot = empty_snapshot();
                snapshot.objectives.insert(
                    "primary_a".into(),
                    ObjectiveProgressSnapshot { completed: true },
                );
                snapshot.active_primary_objective_id = Some("primary_a".into());
                snapshot
            },
        ];

        for snapshot in cases {
            assert_eq!(reject(snapshot).code, "invalidStoryStateSnapshot");
        }
    }
}
