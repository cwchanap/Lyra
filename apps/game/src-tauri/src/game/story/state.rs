use super::catalog::{AnalysisBoardRef, AnalysisSceneRef, ObjectiveKind, StoryCatalog};
use crate::game::schema::InventoryTarget;
use crate::game::unlock::StoryUnlockContext;
use crate::game::GameError;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct FactProgress {
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
    pub(super) first_origin: AssertionOrigin,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(in crate::game) struct StoryState {
    pub(super) facts: BTreeMap<String, FactProgress>,
    pub(super) questions: BTreeMap<String, QuestionProgress>,
    pub(super) objectives: BTreeMap<String, ObjectiveProgress>,
    pub(super) authorizations: BTreeMap<String, AuthorizationProgress>,
    pub(super) active_primary_objective_id: Option<String>,
    pub(super) completed_analysis_scenes: BTreeSet<AnalysisSceneRef>,
    pub(super) completed_analysis_boards: BTreeSet<AnalysisBoardRef>,
}

impl StoryUnlockContext for StoryState {
    fn fact_asserted(&self, id: &str) -> bool {
        self.facts.contains_key(id)
    }

    fn question_resolved(&self, id: &str) -> bool {
        self.questions
            .get(id)
            .is_some_and(|progress| progress.resolved_by_fact_id.is_some())
    }

    fn objective_completed(&self, id: &str) -> bool {
        self.objectives
            .get(id)
            .is_some_and(|progress| progress.completed)
    }

    fn analysis_scene_completed(&self, chapter_id: &str, scene_id: &str) -> bool {
        self.completed_analysis_scenes.contains(&AnalysisSceneRef {
            chapter_id: chapter_id.into(),
            scene_id: scene_id.into(),
        })
    }

    fn analysis_board_completed(&self, chapter_id: &str, scene_id: &str, board_id: &str) -> bool {
        self.completed_analysis_boards.contains(&AnalysisBoardRef {
            chapter_id: chapter_id.into(),
            scene_id: scene_id.into(),
            board_id: board_id.into(),
        })
    }

    fn authorization_granted(&self, id: &str) -> bool {
        self.authorizations.contains_key(id)
    }
}

impl FactProgress {
    pub(in crate::game) fn supporting_records(&self) -> &BTreeSet<InventoryTarget> {
        &self.supporting_records
    }

    pub(in crate::game) fn supporting_fact_ids(&self) -> &BTreeSet<String> {
        &self.supporting_fact_ids
    }
}

impl StoryState {
    pub(in crate::game) fn fact_progress(&self, id: &str) -> Option<&FactProgress> {
        self.facts.get(id)
    }

    #[cfg(test)]
    pub(in crate::game) fn replace_supporting_fact_ids_for_test(
        &mut self,
        fact_id: &str,
        supporting_fact_ids: BTreeSet<String>,
    ) {
        self.facts
            .get_mut(fact_id)
            .expect("test fact progress must exist")
            .supporting_fact_ids = supporting_fact_ids;
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoryStateSnapshot {
    pub facts: BTreeMap<String, FactProgressSnapshot>,
    pub questions: BTreeMap<String, QuestionProgressSnapshot>,
    pub objectives: BTreeMap<String, ObjectiveProgressSnapshot>,
    pub authorizations: BTreeMap<String, AuthorizationProgressSnapshot>,
    pub active_primary_objective_id: Option<String>,
    #[serde(default)]
    pub(super) completed_analysis_scenes: BTreeSet<AnalysisSceneRef>,
    #[serde(default)]
    pub(super) completed_analysis_boards: BTreeSet<AnalysisBoardRef>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FactProgressSnapshot {
    pub first_origin: AssertionOrigin,
    pub supporting_records: BTreeSet<InventoryTarget>,
    pub supporting_fact_ids: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuestionProgressSnapshot {
    pub resolved_by_fact_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ObjectiveProgressSnapshot {
    pub completed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthorizationProgressSnapshot {
    pub first_origin: AssertionOrigin,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
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

impl AssertionOrigin {
    /// Returns `Err` when the origin kind cannot be resolved against current
    /// packaged definitions and therefore must not be persisted.
    ///
    /// `StoryEvent` awaits a package-backed story-event registry. Until that
    /// registries exist, mutation and capture must reject these origins so
    /// that every saved state can be restored — the persistence contract must
    /// be symmetric.
    pub(super) fn ensure_origin_kind_is_persistable(
        &self,
        catalog: &StoryCatalog,
    ) -> Result<(), String> {
        match self {
            Self::AnalysisBoard {
                chapter_id,
                scene_id,
                board_id,
            } => {
                if catalog.has_analysis_board(chapter_id, scene_id, board_id) {
                    Ok(())
                } else {
                    Err(format!(
                        "analysis board origin references unknown board '{chapter_id}/{scene_id}/{board_id}'"
                    ))
                }
            }
            Self::SceneEvent {
                block_kind: StoryEventBlockKind::StoryEvent,
                ..
            } => Err(
                "story event origins are not persistable until a package-backed story event registry exists"
                    .to_string(),
            ),
            _ => Ok(()),
        }
    }

    pub(super) fn derived_location(&self) -> Result<(String, String), String> {
        match self {
            Self::SceneEvent {
                chapter_id,
                scene_id,
                block_id,
                ..
            } => {
                validate_origin_segments(&[("chapterId", chapter_id), ("sceneId", scene_id)])?;
                // The topic block id is qualified as `character_id@topic_id`
                // (see mod.rs interview_topic), so `@` is permitted here and
                // only here; chapter/scene ids remain plain slugs.
                if !is_block_id_slug(block_id) {
                    return Err(format!(
                        "assertion origin blockId '{block_id}' must match ^[a-z0-9_]+(@[a-z0-9_]+)?$"
                    ));
                }
                Ok((chapter_id.clone(), scene_id.clone()))
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
                Ok((chapter_id.clone(), scene_id.clone()))
            }
        }
    }
}

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

fn is_slug(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

/// Like `is_slug`, but also permits a single `@` separator so that topic
/// block ids of the form `character_id@topic_id` validate.
fn is_block_id_slug(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let mut parts = value.split('@');
    let first = parts.next();
    let second = parts.next();
    let rest = parts.next();
    match (first, second, rest) {
        (Some(first), None, None) => is_slug(first),
        (Some(first), Some(second), None) => is_slug(first) && is_slug(second),
        _ => false,
    }
}

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
                            first_origin: progress.first_origin.clone(),
                        },
                    )
                })
                .collect(),
            active_primary_objective_id: self.active_primary_objective_id.clone(),
            completed_analysis_scenes: self.completed_analysis_scenes.clone(),
            completed_analysis_boards: self.completed_analysis_boards.clone(),
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
                            first_origin: progress.first_origin,
                        },
                    )
                })
                .collect(),
            active_primary_objective_id: snapshot.active_primary_objective_id,
            completed_analysis_scenes: snapshot.completed_analysis_scenes,
            completed_analysis_boards: snapshot.completed_analysis_boards,
        })
    }

    #[cfg(test)]
    pub(crate) fn insert_unknown_objective_for_test(&mut self, id: &str) {
        self.objectives
            .insert(id.into(), ObjectiveProgress { completed: false });
    }
}

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
        progress
            .first_origin
            .derived_location()
            .map_err(invalid_snapshot)?;
        progress
            .first_origin
            .ensure_origin_kind_is_persistable(catalog)
            .map_err(invalid_snapshot)?;
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
        progress
            .first_origin
            .derived_location()
            .map_err(invalid_snapshot)?;
        progress
            .first_origin
            .ensure_origin_kind_is_persistable(catalog)
            .map_err(invalid_snapshot)?;
    }

    for key in &snapshot.completed_analysis_scenes {
        if !catalog.has_analysis_scene(&key.chapter_id, &key.scene_id) {
            return Err(invalid_snapshot(format!(
                "analysis scene progress references unknown analysis scene '{}/{}'",
                key.chapter_id, key.scene_id
            )));
        }
    }

    for key in &snapshot.completed_analysis_boards {
        if !catalog.has_analysis_board(&key.chapter_id, &key.scene_id, &key.board_id) {
            return Err(invalid_snapshot(format!(
                "analysis board progress references unknown board '{}/{}/{}'",
                key.chapter_id, key.scene_id, key.board_id
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
    use super::super::catalog::{AnalysisBoardRef, AnalysisSceneRef};
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
  "schemaVersion": 2,
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
  "sourceGroups": [],
  "evidenceIndex": [
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
      "id":"statement_a",
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
  "analysisScenes": [
    {"chapterId":"chapter_1","sceneId":"analysis_scene_1"}
  ],
  "analysisBoards": [
    {"chapterId":"chapter_1","sceneId":"analysis_scene_1","boardId":"board_1"}
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
            completed_analysis_scenes: BTreeSet::new(),
            completed_analysis_boards: BTreeSet::new(),
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
        FactProgressSnapshot {
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
                    asserted_fact(AssertionOrigin::SceneEvent {
                        chapter_id: "chapter_1".into(),
                        scene_id: "scene_1".into(),
                        block_kind: StoryEventBlockKind::Hotspot,
                        block_id: "board_1".into(),
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
                    first_origin: scene_origin(),
                },
            )]),
            active_primary_objective_id: Some("primary_a".into()),
            completed_analysis_scenes: BTreeSet::new(),
            completed_analysis_boards: BTreeSet::new(),
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
                "activePrimaryObjectiveId": null,
                "completedAnalysisScenes": [],
                "completedAnalysisBoards": []
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

    // Break caught: serialized story progress stores a second, mutable copy of
    // the origin scene alongside firstOrigin, allowing the two locations to
    // drift apart.
    #[test]
    fn snapshot_serializes_locations_only_with_the_origin() {
        let encoded = serde_json::to_value(valid_snapshot()).unwrap();

        let fact = encoded["facts"]["fact_alpha"].as_object().unwrap();
        assert!(!fact.contains_key("assertedInChapterId"));
        assert!(!fact.contains_key("assertedInSceneId"));
        assert_eq!(fact["firstOrigin"]["chapterId"], "chapter_1");
        assert_eq!(fact["firstOrigin"]["sceneId"], "scene_1");

        let authorization = encoded["authorizations"]["authorization_a"]
            .as_object()
            .unwrap();
        assert!(!authorization.contains_key("grantedInChapterId"));
        assert!(!authorization.contains_key("grantedInSceneId"));
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
                        first_origin: scene_origin(),
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
    fn rejects_well_formed_but_unresolvable_origin_kinds() {
        // StoryEvent has valid slug segments but still has no package-backed
        // registry. Analysis boards now do have a packaged definition path,
        // so they are deliberately accepted by the persistability boundary.
        let origins = [AssertionOrigin::SceneEvent {
            chapter_id: "chapter_1".into(),
            scene_id: "scene_1".into(),
            block_kind: StoryEventBlockKind::StoryEvent,
            block_id: "block_1".into(),
        }];

        for origin in origins {
            let mut snapshot = empty_snapshot();
            snapshot
                .facts
                .insert("fact_alpha".into(), asserted_fact(origin.clone()));
            assert_eq!(
                reject(snapshot).code,
                "invalidStoryStateSnapshot",
                "validate_snapshot must reject unresolvable origin kind: {origin:?}"
            );

            let mut snapshot = empty_snapshot();
            snapshot.authorizations.insert(
                "authorization_a".into(),
                AuthorizationProgressSnapshot {
                    first_origin: origin,
                },
            );
            assert_eq!(
                reject(snapshot).code,
                "invalidStoryStateSnapshot",
                "validate_snapshot must reject unresolvable authorization origin kind"
            );
        }
    }

    #[test]
    fn accepts_well_formed_analysis_board_origins() {
        let origin = AssertionOrigin::AnalysisBoard {
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
            board_id: "board_1".into(),
        };
        let mut snapshot = empty_snapshot();
        snapshot
            .facts
            .insert("fact_alpha".into(), asserted_fact(origin.clone()));
        snapshot.authorizations.insert(
            "authorization_a".into(),
            AuthorizationProgressSnapshot {
                first_origin: origin,
            },
        );

        StoryState::from_snapshot(&catalog(), snapshot)
            .expect("analysis board origins are now persistable");
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

    #[test]
    fn rejects_snapshot_with_unknown_analysis_scene_progress() {
        let mut snapshot = empty_snapshot();
        snapshot.completed_analysis_scenes.insert(AnalysisSceneRef {
            chapter_id: "chapter_1".into(),
            scene_id: "nonexistent".into(),
        });
        assert_eq!(reject(snapshot).code, "invalidStoryStateSnapshot");
    }

    #[test]
    fn rejects_snapshot_with_unknown_analysis_board_progress() {
        let mut snapshot = empty_snapshot();
        snapshot.completed_analysis_boards.insert(AnalysisBoardRef {
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
            board_id: "nonexistent".into(),
        });
        assert_eq!(reject(snapshot).code, "invalidStoryStateSnapshot");
    }

    #[test]
    fn rejects_snapshot_with_unknown_analysis_board_origin() {
        let origin = AssertionOrigin::AnalysisBoard {
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
            board_id: "nonexistent".into(),
        };
        let mut snapshot = empty_snapshot();
        snapshot
            .facts
            .insert("fact_alpha".into(), asserted_fact(origin.clone()));
        snapshot.authorizations.insert(
            "authorization_a".into(),
            AuthorizationProgressSnapshot {
                first_origin: origin,
            },
        );

        assert_eq!(reject(snapshot).code, "invalidStoryStateSnapshot");
    }

    #[test]
    fn completion_snapshot_uses_catalog_analysis_reference_types() {
        let snapshot = StoryStateSnapshot {
            facts: BTreeMap::new(),
            questions: BTreeMap::new(),
            objectives: BTreeMap::new(),
            authorizations: BTreeMap::new(),
            active_primary_objective_id: None,
            completed_analysis_scenes: BTreeSet::from([AnalysisSceneRef {
                chapter_id: "chapter_1".into(),
                scene_id: "analysis_scene_1".into(),
            }]),
            completed_analysis_boards: BTreeSet::from([AnalysisBoardRef {
                chapter_id: "chapter_1".into(),
                scene_id: "analysis_scene_1".into(),
                board_id: "board_1".into(),
            }]),
        };

        StoryState::from_snapshot(&catalog(), snapshot)
            .expect("catalog-qualified completion refs should restore");
    }

    #[test]
    fn accepts_snapshot_with_valid_analysis_progress() {
        let mut snapshot = empty_snapshot();
        snapshot.completed_analysis_scenes.insert(AnalysisSceneRef {
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
        });
        snapshot.completed_analysis_boards.insert(AnalysisBoardRef {
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
            board_id: "board_1".into(),
        });
        StoryState::from_snapshot(&catalog(), snapshot)
            .expect("valid analysis progress should be accepted");
    }

    #[test]
    fn story_state_reports_analysis_completion_through_unlock_context() {
        let mut snapshot = empty_snapshot();
        snapshot.completed_analysis_scenes.insert(AnalysisSceneRef {
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
        });
        snapshot.completed_analysis_boards.insert(AnalysisBoardRef {
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_1".into(),
            board_id: "board_1".into(),
        });
        let state = StoryState::from_snapshot(&catalog(), snapshot).unwrap();
        assert!(state.analysis_scene_completed("chapter_1", "analysis_scene_1"));
        assert!(!state.analysis_scene_completed("chapter_1", "other"));
        assert!(state.analysis_board_completed("chapter_1", "analysis_scene_1", "board_1"));
        assert!(!state.analysis_board_completed("chapter_1", "analysis_scene_1", "other"));
    }
}
