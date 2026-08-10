use crate::game::provenance::{CaseRecordProvenance, ProceduralStatus};
use crate::game::schema::{compare_inventory_targets, InventoryTarget};
use crate::game::GameError;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

const STORY_CATALOG_SCHEMA_VERSION: i64 = 2;
type SupersessionIndex = BTreeMap<InventoryTarget, InventoryTarget>;

#[derive(Clone, Debug)]
pub(crate) struct StoryCatalog {
    // These immutable arrays and indexes are consumed by the mutation and
    // public-view tasks that follow this loader task.
    facts: Vec<FactDefinition>,
    questions: Vec<QuestionDefinition>,
    objectives: Vec<ObjectiveDefinition>,
    authorizations: Vec<AuthorizationDefinition>,
    #[allow(dead_code)]
    fact_by_id: HashMap<String, usize>,
    #[allow(dead_code)]
    question_by_id: HashMap<String, usize>,
    #[allow(dead_code)]
    objective_by_id: HashMap<String, usize>,
    #[allow(dead_code)]
    authorization_by_id: HashMap<String, usize>,
    evidence_by_id: BTreeMap<String, CaseRecordDefinition>,
    statement_by_id: BTreeMap<String, CaseRecordDefinition>,
    #[allow(dead_code)] // Consumed by the support-lineage task that follows.
    source_group_by_id: BTreeMap<String, SourceGroupDefinition>,
    #[allow(dead_code)] // Consumed by the public lineage task that follows.
    predecessor_by_target: SupersessionIndex,
    #[allow(dead_code)] // Consumed by the public lineage task that follows.
    successor_by_target: SupersessionIndex,
    analysis_scenes: BTreeSet<AnalysisSceneRef>,
    analysis_boards: BTreeSet<AnalysisBoardRef>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::game) struct FactDefinition {
    pub(in crate::game) id: String,
    pub(in crate::game) label: String,
    pub(in crate::game) summary: String,
    pub(in crate::game) details: String,
    pub(in crate::game) category: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::game) struct QuestionDefinition {
    pub(in crate::game) id: String,
    pub(in crate::game) label: String,
    pub(in crate::game) summary: String,
    pub(in crate::game) resolved_by_fact_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::game) enum ObjectiveKind {
    Primary,
    Secondary,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct ObjectiveDefinition {
    pub(in crate::game) id: String,
    pub(in crate::game) label: String,
    pub(in crate::game) summary: String,
    pub(in crate::game) kind: ObjectiveKind,
    pub(in crate::game) sort_order: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::game) struct AuthorizationDefinition {
    pub(in crate::game) id: String,
    pub(in crate::game) label: String,
    pub(in crate::game) summary: String,
    pub(in crate::game) granting_authority: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoryCatalogJsonV2 {
    // The minimal envelope gates this value before the strict v2 payload is
    // deserialized. Retaining it here lets deny_unknown_fields cover the
    // complete document.
    #[serde(rename = "schemaVersion")]
    _schema_version: i64,
    facts: Vec<FactDefinition>,
    questions: Vec<QuestionDefinition>,
    objectives: Vec<ObjectiveDefinitionJson>,
    authorizations: Vec<AuthorizationDefinition>,
    source_groups: Vec<SourceGroupDefinitionJsonV2>,
    evidence_index: Vec<CaseRecordDefinitionJsonV2>,
    statements_index: Vec<CaseRecordDefinitionJsonV2>,
    #[serde(default)]
    analysis_scenes: Vec<AnalysisSceneRef>,
    #[serde(default)]
    analysis_boards: Vec<AnalysisBoardRef>,
}

/// Compiler-emitted, fully qualified immutable analysis-scene reference.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AnalysisSceneRef {
    pub(super) chapter_id: String,
    pub(super) scene_id: String,
}

/// Compiler-emitted, fully qualified immutable analysis-board reference.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AnalysisBoardRef {
    pub(super) chapter_id: String,
    pub(super) scene_id: String,
    pub(super) board_id: String,
}

// Minimal envelope used to gate the version before deserializing the
// version-specific payload. A future schema version that drops or renames v2
// fields would otherwise fail full deserialization first and surface as a
// generic "malformed" load failure instead of unsupportedStoryCatalogVersion.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoryCatalogVersionEnvelope {
    schema_version: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObjectiveDefinitionJson {
    id: String,
    label: String,
    summary: String,
    kind: String,
    sort_order: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaseRecordDefinitionJsonV2 {
    id: String,
    chapter_id: String,
    scene_id: String,
    provenance: CaseRecordProvenance,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct CaseRecordDefinition {
    pub(in crate::game) id: String,
    pub(in crate::game) chapter_id: String,
    pub(in crate::game) scene_id: String,
    pub(in crate::game) provenance: CaseRecordProvenance,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceGroupDefinitionJsonV2 {
    id: String,
    label: String,
    summary: String,
    members: Vec<InventoryTarget>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct SourceGroupDefinition {
    pub(in crate::game) id: String,
    pub(in crate::game) label: String,
    pub(in crate::game) summary: String,
    pub(in crate::game) members: BTreeSet<InventoryTarget>,
}

impl StoryCatalog {
    pub(in crate::game) fn load(resources_dir: &Path) -> Result<Self, GameError> {
        let path = resources_dir.join("story_catalog.json");
        let source = std::fs::read_to_string(&path).map_err(|error| {
            GameError::story_catalog_load_failed(
                &path,
                format!("could not read catalog resource: {error}"),
            )
        })?;
        // Check schemaVersion from a minimal envelope before deserializing
        // the version-specific payload. A future schema that drops or renames
        // v2 fields would otherwise fail full deserialization first and
        // surface as a generic "malformed" load failure instead of
        // unsupportedStoryCatalogVersion.
        let envelope: StoryCatalogVersionEnvelope =
            serde_json::from_str(&source).map_err(|error| {
                GameError::story_catalog_load_failed(
                    &path,
                    format!("catalog resource is malformed: {error}"),
                )
            })?;

        if envelope.schema_version != STORY_CATALOG_SCHEMA_VERSION {
            return Err(GameError::unsupported_story_catalog_version(
                &path,
                envelope.schema_version,
            ));
        }

        let json: StoryCatalogJsonV2 = serde_json::from_str(&source).map_err(|error| {
            GameError::story_catalog_load_failed(
                &path,
                format!("catalog resource is malformed: {error}"),
            )
        })?;

        Self::from_json(&path, json)
    }

    #[allow(dead_code)]
    pub(in crate::game) fn empty() -> Self {
        Self {
            facts: Vec::new(),
            questions: Vec::new(),
            objectives: Vec::new(),
            authorizations: Vec::new(),
            fact_by_id: HashMap::new(),
            question_by_id: HashMap::new(),
            objective_by_id: HashMap::new(),
            authorization_by_id: HashMap::new(),
            evidence_by_id: BTreeMap::new(),
            statement_by_id: BTreeMap::new(),
            source_group_by_id: BTreeMap::new(),
            predecessor_by_target: BTreeMap::new(),
            successor_by_target: BTreeMap::new(),
            analysis_scenes: BTreeSet::new(),
            analysis_boards: BTreeSet::new(),
        }
    }

    // The following read-only API is consumed by the mutation and public-view
    // tasks that follow this loader task.
    #[allow(dead_code)]
    pub(in crate::game) fn fact(&self, id: &str) -> Option<&FactDefinition> {
        self.fact_by_id.get(id).map(|index| &self.facts[*index])
    }

    #[allow(dead_code)]
    pub(in crate::game) fn question(&self, id: &str) -> Option<&QuestionDefinition> {
        self.question_by_id
            .get(id)
            .map(|index| &self.questions[*index])
    }

    #[allow(dead_code)]
    pub(in crate::game) fn objective(&self, id: &str) -> Option<&ObjectiveDefinition> {
        self.objective_by_id
            .get(id)
            .map(|index| &self.objectives[*index])
    }

    #[allow(dead_code)]
    pub(in crate::game) fn authorization(&self, id: &str) -> Option<&AuthorizationDefinition> {
        self.authorization_by_id
            .get(id)
            .map(|index| &self.authorizations[*index])
    }

    #[allow(dead_code)]
    pub(in crate::game) fn contains_inventory_target(&self, target: &InventoryTarget) -> bool {
        self.case_record(target).is_some()
    }

    pub(in crate::game) fn case_record(
        &self,
        target: &InventoryTarget,
    ) -> Option<&CaseRecordDefinition> {
        match target {
            InventoryTarget::Evidence { id } => self.evidence_by_id.get(id),
            InventoryTarget::Statement { id } => self.statement_by_id.get(id),
        }
    }

    pub(in crate::game) fn case_record_targets(&self) -> Vec<InventoryTarget> {
        let mut targets = self
            .evidence_by_id
            .keys()
            .map(|id| InventoryTarget::Evidence { id: id.clone() })
            .chain(
                self.statement_by_id
                    .keys()
                    .map(|id| InventoryTarget::Statement { id: id.clone() }),
            )
            .collect::<Vec<_>>();
        targets.sort_by(compare_inventory_targets);
        targets
    }

    pub(in crate::game) fn case_record_targets_for_origin(
        &self,
        chapter_id: &str,
        scene_id: &str,
    ) -> Vec<InventoryTarget> {
        self.case_record_targets()
            .into_iter()
            .filter(|target| {
                self.case_record(target).is_some_and(|definition| {
                    definition.chapter_id == chapter_id && definition.scene_id == scene_id
                })
            })
            .collect()
    }

    pub(in crate::game) fn source_group(&self, id: &str) -> Option<&SourceGroupDefinition> {
        self.source_group_by_id.get(id)
    }

    #[allow(dead_code)] // Consumed by the public lineage task that follows.
    pub(crate) fn predecessor(
        &self,
        target: &InventoryTarget,
    ) -> Result<Option<InventoryTarget>, GameError> {
        self.require_case_record(target)?;
        Ok(self.predecessor_by_target.get(target).cloned())
    }

    #[allow(dead_code)] // Consumed by the public lineage task that follows.
    pub(crate) fn successor(
        &self,
        target: &InventoryTarget,
    ) -> Result<Option<InventoryTarget>, GameError> {
        self.require_case_record(target)?;
        Ok(self.successor_by_target.get(target).cloned())
    }

    #[allow(dead_code)] // Consumed by the public lineage task that follows.
    pub(crate) fn chain(
        &self,
        target: &InventoryTarget,
    ) -> Result<Vec<InventoryTarget>, GameError> {
        self.require_case_record(target)?;
        let mut oldest = target.clone();
        while let Some(predecessor) = self.predecessor_by_target.get(&oldest) {
            oldest = predecessor.clone();
        }

        let mut chain = vec![oldest.clone()];
        let mut current = oldest;
        while let Some(successor) = self.successor_by_target.get(&current) {
            chain.push(successor.clone());
            current = successor.clone();
        }
        Ok(chain)
    }

    #[allow(dead_code)] // Consumed by the public lineage task that follows.
    pub(crate) fn latest_definition(
        &self,
        target: &InventoryTarget,
    ) -> Result<InventoryTarget, GameError> {
        self.chain(target)?
            .into_iter()
            .last()
            .ok_or_else(|| GameError::internal("Validated lineage chain was empty.".into()))
    }

    pub(in crate::game) fn facts(&self) -> impl Iterator<Item = &FactDefinition> {
        self.facts.iter()
    }

    pub(in crate::game) fn questions(&self) -> impl Iterator<Item = &QuestionDefinition> {
        self.questions.iter()
    }

    pub(in crate::game) fn objectives(&self) -> impl Iterator<Item = &ObjectiveDefinition> {
        self.objectives.iter()
    }

    pub(in crate::game) fn authorizations(&self) -> impl Iterator<Item = &AuthorizationDefinition> {
        self.authorizations.iter()
    }

    /// The compiler's qualified reference arrays are the sole runtime lookup
    /// authority for analysis predicates. They deliberately carry no mutable
    /// completion state.
    pub(in crate::game) fn has_analysis_scene(&self, chapter_id: &str, scene_id: &str) -> bool {
        self.analysis_scenes.contains(&AnalysisSceneRef {
            chapter_id: chapter_id.into(),
            scene_id: scene_id.into(),
        })
    }

    pub(in crate::game) fn has_analysis_board(
        &self,
        chapter_id: &str,
        scene_id: &str,
        board_id: &str,
    ) -> bool {
        self.analysis_boards.contains(&AnalysisBoardRef {
            chapter_id: chapter_id.into(),
            scene_id: scene_id.into(),
            board_id: board_id.into(),
        })
    }

    #[allow(dead_code)] // Shared validation for the public lineage queries above.
    fn require_case_record(&self, target: &InventoryTarget) -> Result<(), GameError> {
        if self.case_record(target).is_some() {
            return Ok(());
        }
        Err(GameError::unknown_supporting_case_record(
            inventory_target_kind(target),
            inventory_target_id(target),
        ))
    }

    fn from_json(path: &Path, json: StoryCatalogJsonV2) -> Result<Self, GameError> {
        let StoryCatalogJsonV2 {
            _schema_version: _,
            facts,
            questions,
            objectives: objective_json,
            authorizations,
            source_groups,
            evidence_index,
            statements_index,
            analysis_scenes,
            analysis_boards,
        } = json;

        let fact_by_id = definition_index(path, "fact", &facts, |definition| &definition.id)?;
        let question_by_id =
            definition_index(path, "question", &questions, |definition| &definition.id)?;
        let authorization_by_id =
            definition_index(path, "authorization", &authorizations, |definition| {
                &definition.id
            })?;

        for question in &questions {
            for fact_id in &question.resolved_by_fact_ids {
                if !fact_by_id.contains_key(fact_id) {
                    return Err(GameError::story_catalog_validation_failed(
                        path,
                        format!(
                            "Question '{}' references unknown resolver fact '{fact_id}'.",
                            question.id
                        ),
                    ));
                }
            }
        }

        let mut objectives = Vec::with_capacity(objective_json.len());
        for definition in objective_json {
            // "null" is the reserved sentinel for set_primary_objective:null
            // (clearing the active primary). The compiler rejects an objective
            // with this id (see parser-story-catalog.ts); the runtime loader
            // must reject it too so a hand-edited resource package cannot
            // define a primary objective named "null" and then reference it
            // through nextObjectiveId: "null".
            if definition.id == "null" {
                return Err(GameError::story_catalog_validation_failed(
                    path,
                    "Objective id 'null' is reserved for setPrimaryObjective:null.".into(),
                ));
            }
            let kind = match definition.kind.as_str() {
                "primary" => ObjectiveKind::Primary,
                "secondary" => ObjectiveKind::Secondary,
                invalid => {
                    return Err(GameError::story_catalog_validation_failed(
                        path,
                        format!(
                            "Objective '{}' has invalid kind '{invalid}'.",
                            definition.id
                        ),
                    ));
                }
            };
            objectives.push(ObjectiveDefinition {
                id: definition.id,
                label: definition.label,
                summary: definition.summary,
                kind,
                sort_order: definition.sort_order,
            });
        }
        let objective_by_id =
            definition_index(path, "objective", &objectives, |definition| &definition.id)?;

        let evidence_by_id = case_record_index(path, "evidence", evidence_index)?;
        let statement_by_id = case_record_index(path, "statement", statements_index)?;
        let source_group_by_id = source_group_index(path, source_groups)?;
        validate_source_group_projection(
            path,
            &evidence_by_id,
            &statement_by_id,
            &source_group_by_id,
        )?;
        let (predecessor_by_target, successor_by_target) =
            supersession_indexes(path, &evidence_by_id, &statement_by_id)?;

        Ok(Self {
            facts,
            questions,
            objectives,
            authorizations,
            fact_by_id,
            question_by_id,
            objective_by_id,
            authorization_by_id,
            evidence_by_id,
            statement_by_id,
            source_group_by_id,
            predecessor_by_target,
            successor_by_target,
            analysis_scenes: analysis_scenes.into_iter().collect(),
            analysis_boards: analysis_boards.into_iter().collect(),
        })
    }
}

fn definition_index<T>(
    path: &Path,
    kind: &str,
    definitions: &[T],
    id: impl Fn(&T) -> &str,
) -> Result<HashMap<String, usize>, GameError> {
    let mut index = HashMap::with_capacity(definitions.len());
    for (position, definition) in definitions.iter().enumerate() {
        let definition_id = id(definition);
        if index.insert(definition_id.to_owned(), position).is_some() {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!("Duplicate {kind} ID '{definition_id}'."),
            ));
        }
    }
    Ok(index)
}

fn case_record_index(
    path: &Path,
    kind: &str,
    definitions: Vec<CaseRecordDefinitionJsonV2>,
) -> Result<BTreeMap<String, CaseRecordDefinition>, GameError> {
    let mut index = BTreeMap::new();
    for definition in definitions {
        let CaseRecordDefinitionJsonV2 {
            id,
            chapter_id,
            scene_id,
            provenance,
        } = definition;
        let domain = CaseRecordDefinition {
            id: id.clone(),
            chapter_id,
            scene_id,
            provenance,
        };
        if index.insert(id.clone(), domain).is_some() {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!("Duplicate {kind} index ID '{id}'."),
            ));
        }
    }
    Ok(index)
}

fn source_group_index(
    path: &Path,
    definitions: Vec<SourceGroupDefinitionJsonV2>,
) -> Result<BTreeMap<String, SourceGroupDefinition>, GameError> {
    let mut index = BTreeMap::new();
    for definition in definitions {
        if definition.members.is_empty() {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!("Source group '{}' has no members.", definition.id),
            ));
        }

        let mut previous: Option<&InventoryTarget> = None;
        for (position, member) in definition.members.iter().enumerate() {
            if definition.members[..position].contains(member) {
                return Err(GameError::story_catalog_validation_failed(
                    path,
                    format!(
                        "Source group '{}' contains duplicate member '{}:{}'.",
                        definition.id,
                        inventory_target_kind(member),
                        inventory_target_id(member)
                    ),
                ));
            }
            if previous.is_some_and(|previous| compare_inventory_targets(previous, member).is_ge())
            {
                return Err(GameError::story_catalog_validation_failed(
                    path,
                    format!(
                        "Source group '{}' members are not in canonical order.",
                        definition.id
                    ),
                ));
            }
            previous = Some(member);
        }

        let id = definition.id;
        let members = definition.members.into_iter().collect();
        let domain = SourceGroupDefinition {
            id: id.clone(),
            label: definition.label,
            summary: definition.summary,
            members,
        };
        if index.insert(id.clone(), domain).is_some() {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!("Duplicate source group ID '{id}'."),
            ));
        }
    }
    Ok(index)
}

fn validate_source_group_projection(
    path: &Path,
    evidence_by_id: &BTreeMap<String, CaseRecordDefinition>,
    statement_by_id: &BTreeMap<String, CaseRecordDefinition>,
    source_group_by_id: &BTreeMap<String, SourceGroupDefinition>,
) -> Result<(), GameError> {
    for group in source_group_by_id.values() {
        for member in &group.members {
            let Some(record) = case_record_from_indexes(evidence_by_id, statement_by_id, member)
            else {
                return Err(GameError::story_catalog_validation_failed(
                    path,
                    format!(
                        "Source group '{}' references unknown member '{}:{}'.",
                        group.id,
                        inventory_target_kind(member),
                        inventory_target_id(member)
                    ),
                ));
            };
            if record.provenance.source_group_id.as_deref() != Some(group.id.as_str()) {
                return Err(GameError::story_catalog_validation_failed(
                    path,
                    format!(
                        "Source group '{}' member '{}:{}' does not name that group.",
                        group.id,
                        inventory_target_kind(member),
                        inventory_target_id(member)
                    ),
                ));
            }
        }
    }

    for target in all_case_record_targets(evidence_by_id, statement_by_id) {
        let record = case_record_from_indexes(evidence_by_id, statement_by_id, &target)
            .expect("target was built from catalog indexes");
        let Some(group_id) = record.provenance.source_group_id.as_deref() else {
            continue;
        };
        let Some(group) = source_group_by_id.get(group_id) else {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!(
                    "Case record '{}:{}' references unknown source group '{group_id}'.",
                    inventory_target_kind(&target),
                    inventory_target_id(&target)
                ),
            ));
        };
        if !group.members.contains(&target) {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!(
                    "Source group '{group_id}' omits case record '{}:{}'.",
                    inventory_target_kind(&target),
                    inventory_target_id(&target)
                ),
            ));
        }
    }
    Ok(())
}

fn supersession_indexes(
    path: &Path,
    evidence_by_id: &BTreeMap<String, CaseRecordDefinition>,
    statement_by_id: &BTreeMap<String, CaseRecordDefinition>,
) -> Result<(SupersessionIndex, SupersessionIndex), GameError> {
    let mut predecessor_by_target = BTreeMap::new();
    let mut successor_by_target = BTreeMap::new();
    let targets = all_case_record_targets(evidence_by_id, statement_by_id);

    for target in &targets {
        let definition = case_record_from_indexes(evidence_by_id, statement_by_id, target)
            .expect("target was built from catalog indexes");
        let Some(reference) = definition.provenance.supersedes_record_id.as_deref() else {
            continue;
        };
        let predecessor = parse_inventory_target(reference).ok_or_else(|| {
            GameError::story_catalog_validation_failed(
                path,
                format!(
                    "Case record '{}:{}' has malformed predecessor '{reference}'.",
                    inventory_target_kind(target),
                    inventory_target_id(target)
                ),
            )
        })?;

        if predecessor == *target {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!(
                    "Case record '{}:{}' cannot supersede itself.",
                    inventory_target_kind(target),
                    inventory_target_id(target)
                ),
            ));
        }
        let Some(predecessor_definition) =
            case_record_from_indexes(evidence_by_id, statement_by_id, &predecessor)
        else {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!(
                    "Case record '{}:{}' supersedes unknown predecessor '{reference}'.",
                    inventory_target_kind(target),
                    inventory_target_id(target)
                ),
            ));
        };
        if procedural_status_rank(definition.provenance.procedural_status)
            < procedural_status_rank(predecessor_definition.provenance.procedural_status)
        {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!(
                    "Case record '{}:{}' regresses procedural status from predecessor '{reference}'.",
                    inventory_target_kind(target),
                    inventory_target_id(target)
                ),
            ));
        }

        predecessor_by_target.insert(target.clone(), predecessor.clone());
        if let Some(existing_successor) =
            successor_by_target.insert(predecessor.clone(), target.clone())
        {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!(
                    "Case record '{}:{}' has multiple successors '{}:{}' and '{}:{}'.",
                    inventory_target_kind(&predecessor),
                    inventory_target_id(&predecessor),
                    inventory_target_kind(&existing_successor),
                    inventory_target_id(&existing_successor),
                    inventory_target_kind(target),
                    inventory_target_id(target)
                ),
            ));
        }
    }

    for target in &targets {
        let mut visited = BTreeSet::new();
        let mut current = target;
        loop {
            if !visited.insert(current.clone()) {
                return Err(GameError::story_catalog_validation_failed(
                    path,
                    format!(
                        "Supersession cycle contains '{}:{}'.",
                        inventory_target_kind(current),
                        inventory_target_id(current)
                    ),
                ));
            }
            let Some(predecessor) = predecessor_by_target.get(current) else {
                break;
            };
            current = predecessor;
        }
    }

    Ok((predecessor_by_target, successor_by_target))
}

fn all_case_record_targets(
    evidence_by_id: &BTreeMap<String, CaseRecordDefinition>,
    statement_by_id: &BTreeMap<String, CaseRecordDefinition>,
) -> Vec<InventoryTarget> {
    evidence_by_id
        .keys()
        .map(|id| InventoryTarget::Evidence { id: id.clone() })
        .chain(
            statement_by_id
                .keys()
                .map(|id| InventoryTarget::Statement { id: id.clone() }),
        )
        .collect()
}

fn case_record_from_indexes<'a>(
    evidence_by_id: &'a BTreeMap<String, CaseRecordDefinition>,
    statement_by_id: &'a BTreeMap<String, CaseRecordDefinition>,
    target: &InventoryTarget,
) -> Option<&'a CaseRecordDefinition> {
    match target {
        InventoryTarget::Evidence { id } => evidence_by_id.get(id),
        InventoryTarget::Statement { id } => statement_by_id.get(id),
    }
}

fn parse_inventory_target(value: &str) -> Option<InventoryTarget> {
    let (kind, id) = value.split_once(':')?;
    match kind {
        "evidence" => Some(InventoryTarget::Evidence { id: id.into() }),
        "statement" => Some(InventoryTarget::Statement { id: id.into() }),
        _ => None,
    }
}

fn inventory_target_kind(target: &InventoryTarget) -> &'static str {
    match target {
        InventoryTarget::Evidence { .. } => "evidence",
        InventoryTarget::Statement { .. } => "statement",
    }
}

fn inventory_target_id(target: &InventoryTarget) -> &str {
    match target {
        InventoryTarget::Evidence { id } | InventoryTarget::Statement { id } => id,
    }
}

fn procedural_status_rank(status: ProceduralStatus) -> u8 {
    match status {
        ProceduralStatus::Unspecified => 0,
        ProceduralStatus::Lead => 1,
        ProceduralStatus::Reacquired => 2,
        ProceduralStatus::Exhibit => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::InventoryTarget;
    use serde_json::{json, Value};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let n = SEQ.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "lyra-story-catalog-{label}-{}-{n}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write_catalog(dir: &Path, json: &str) {
        std::fs::write(dir.join("story_catalog.json"), json).unwrap();
    }

    fn write_catalog_value(dir: &Path, json: &Value) {
        std::fs::write(
            dir.join("story_catalog.json"),
            serde_json::to_vec_pretty(json).unwrap(),
        )
        .unwrap();
    }

    fn provenance_json(
        source_group_id: Option<&str>,
        procedural_status: &str,
        supersedes_record_id: Option<&str>,
    ) -> Value {
        json!({
            "sourceKind": "physical",
            "representationLayer": "raw",
            "proceduralStatus": procedural_status,
            "completeness": "complete",
            "confidence": "corroborated",
            "sourceGroupId": source_group_id,
            "sourceLabel": "Catalog fixture",
            "proofCapabilities": ["time"],
            "supersedesRecordId": supersedes_record_id,
        })
    }

    fn record_json(
        id: &str,
        source_group_id: Option<&str>,
        procedural_status: &str,
        supersedes_record_id: Option<&str>,
    ) -> Value {
        json!({
            "id": id,
            "chapterId": "chapter_1",
            "sceneId": "investigation_scene_1",
            "provenance": provenance_json(
                source_group_id,
                procedural_status,
                supersedes_record_id,
            ),
        })
    }

    fn catalog_json(
        evidence_index: Vec<Value>,
        statements_index: Vec<Value>,
        source_groups: Vec<Value>,
    ) -> Value {
        json!({
            "schemaVersion": 2,
            "facts": [],
            "questions": [],
            "objectives": [],
            "authorizations": [],
            "sourceGroups": source_groups,
            "evidenceIndex": evidence_index,
            "statementsIndex": statements_index,
        })
    }

    fn empty_json() -> &'static str {
        r#"{
  "schemaVersion": 2,
  "facts": [],
  "questions": [],
  "objectives": [],
  "authorizations": [],
  "sourceGroups": [],
  "evidenceIndex": [],
  "statementsIndex": []
}"#
    }

    #[test]
    fn loads_empty_version_two_catalog() {
        let dir = TestDir::new("empty");
        write_catalog(dir.path(), empty_json());

        let catalog = StoryCatalog::load(dir.path()).unwrap();

        assert!(catalog.facts().next().is_none());
        assert!(catalog.questions().next().is_none());
        assert!(catalog.objectives().next().is_none());
        assert!(catalog.authorizations().next().is_none());

        let empty = StoryCatalog::empty();
        assert!(empty.facts().next().is_none());
    }

    #[test]
    fn loads_compiler_generated_catalog_with_analysis_reference_arrays() {
        let dir = TestDir::new("compiler-analysis-references");
        write_catalog_value(
            dir.path(),
            &json!({
                "schemaVersion": 2,
                "facts": [],
                "questions": [],
                "objectives": [],
                "authorizations": [],
                "sourceGroups": [],
                "evidenceIndex": [],
                "statementsIndex": [],
                "analysisScenes": [
                    {"chapterId": "chapter_1", "sceneId": "analysis_scene_1"}
                ],
                "analysisBoards": [
                    {
                        "chapterId": "chapter_1",
                        "sceneId": "analysis_scene_1",
                        "boardId": "board_1"
                    }
                ]
            }),
        );

        let catalog = StoryCatalog::load(dir.path()).unwrap();

        assert!(catalog.case_record_targets().is_empty());
        assert!(catalog.has_analysis_scene("chapter_1", "analysis_scene_1"));
        assert!(catalog.has_analysis_board("chapter_1", "analysis_scene_1", "board_1"));
        assert!(!catalog.has_analysis_scene("chapter_1", "analysis_scene_missing"));
        assert!(!catalog.has_analysis_board("chapter_1", "analysis_scene_1", "board_missing"));
    }

    #[test]
    fn loads_populated_version_two_catalog_with_lookups_and_public_order() {
        let dir = TestDir::new("populated");
        write_catalog(
            dir.path(),
            r#"{
  "schemaVersion": 2,
  "facts": [
    {"id":"fact_b","label":"Fact B","summary":"B","details":"B details","category":"timeline"},
    {"id":"fact_a","label":"Fact A","summary":"A","details":"A details","category":"motive"}
  ],
  "questions": [
    {"id":"question_b","label":"Question B","summary":"B","resolvedByFactIds":["fact_b"]},
    {"id":"question_a","label":"Question A","summary":"A","resolvedByFactIds":[]}
  ],
  "objectives": [
    {"id":"objective_a","label":"Objective A","summary":"A","kind":"primary","sortOrder":1},
    {"id":"objective_b","label":"Objective B","summary":"B","kind":"secondary","sortOrder":2}
  ],
  "authorizations": [
    {"id":"authorization_b","label":"Authorization B","summary":"B","grantingAuthority":"Authority B"},
    {"id":"authorization_a","label":"Authorization A","summary":"A","grantingAuthority":"Authority A"}
  ],
  "sourceGroups": [],
  "evidenceIndex": [
    {
      "id":"record_shared",
      "chapterId":"chapter_1",
      "sceneId":"scene_1",
      "provenance":{
        "sourceKind":"physical",
        "representationLayer":"raw",
        "proceduralStatus":"lead",
        "completeness":"complete",
        "confidence":"corroborated",
        "sourceGroupId":null,
        "sourceLabel":"Receipt",
        "proofCapabilities":["time"],
        "supersedesRecordId":null
      }
    }
  ],
  "statementsIndex": [
    {
      "id":"record_shared",
      "chapterId":"chapter_2",
      "sceneId":"scene_2",
      "provenance":{
        "sourceKind":"testimony",
        "representationLayer":"summary",
        "proceduralStatus":"reacquired",
        "completeness":"partial",
        "confidence":"disputed",
        "sourceGroupId":null,
        "sourceLabel":"Witness",
        "proofCapabilities":["identity","credibility"],
        "supersedesRecordId":null
      }
    }
  ]
}"#,
        );

        let catalog = StoryCatalog::load(dir.path()).unwrap();

        assert_eq!(catalog.fact("fact_a").unwrap().label, "Fact A");
        assert_eq!(
            catalog.question("question_b").unwrap().resolved_by_fact_ids,
            ["fact_b"]
        );
        assert_eq!(
            catalog.objective("objective_a").unwrap().kind,
            ObjectiveKind::Primary
        );
        assert_eq!(
            catalog
                .authorization("authorization_a")
                .unwrap()
                .granting_authority,
            "Authority A"
        );
        assert_eq!(
            catalog
                .facts()
                .map(|definition| definition.id.as_str())
                .collect::<Vec<_>>(),
            ["fact_b", "fact_a"]
        );
        assert_eq!(
            catalog
                .questions()
                .map(|definition| definition.id.as_str())
                .collect::<Vec<_>>(),
            ["question_b", "question_a"]
        );
        assert_eq!(
            catalog
                .objectives()
                .map(|definition| definition.id.as_str())
                .collect::<Vec<_>>(),
            ["objective_a", "objective_b"]
        );
        assert_eq!(
            catalog
                .authorizations()
                .map(|definition| definition.id.as_str())
                .collect::<Vec<_>>(),
            ["authorization_b", "authorization_a"]
        );
        assert!(
            catalog.contains_inventory_target(&InventoryTarget::Evidence {
                id: "record_shared".into()
            })
        );
        assert!(
            catalog.contains_inventory_target(&InventoryTarget::Statement {
                id: "record_shared".into()
            })
        );
        assert!(
            !catalog.contains_inventory_target(&InventoryTarget::Evidence {
                id: "missing".into()
            })
        );
    }

    #[test]
    fn loads_compiler_safe_integer_sort_order_boundaries() {
        let dir = TestDir::new("safe-sort-order-boundaries");
        let json = empty_json().replace(
            "\"objectives\": []",
            r#""objectives": [
  {"id":"objective_min","label":"Minimum","summary":"Minimum safe integer","kind":"primary","sortOrder":-9007199254740991},
  {"id":"objective_max","label":"Maximum","summary":"Maximum safe integer","kind":"secondary","sortOrder":9007199254740991}
]"#,
        );
        write_catalog(dir.path(), &json);

        let catalog = StoryCatalog::load(dir.path()).unwrap();

        assert_eq!(
            catalog.objective("objective_min").unwrap().sort_order,
            -9_007_199_254_740_991
        );
        assert_eq!(
            catalog.objective("objective_max").unwrap().sort_order,
            9_007_199_254_740_991
        );
    }

    #[test]
    fn rejects_missing_catalog_as_load_failure() {
        let dir = TestDir::new("missing");

        let error = StoryCatalog::load(dir.path()).unwrap_err();

        assert_eq!(error.code, "storyCatalogLoadFailed");
        assert!(error.message.contains("story_catalog.json"));
    }

    #[test]
    fn rejects_unreadable_catalog_as_load_failure() {
        let dir = TestDir::new("unreadable");
        std::fs::create_dir(dir.path().join("story_catalog.json")).unwrap();

        let error = StoryCatalog::load(dir.path()).unwrap_err();

        assert_eq!(error.code, "storyCatalogLoadFailed");
        assert!(error.message.contains("story_catalog.json"));
    }

    #[test]
    fn rejects_malformed_catalog_as_load_failure() {
        let dir = TestDir::new("malformed");
        write_catalog(dir.path(), "{ definitely not JSON");

        let error = StoryCatalog::load(dir.path()).unwrap_err();

        assert_eq!(error.code, "storyCatalogLoadFailed");
        assert!(error.message.contains("story_catalog.json"));
    }

    #[test]
    fn rejects_version_one_before_v2_payload_validation() {
        let dir = TestDir::new("version");
        write_catalog(dir.path(), r#"{ "schemaVersion": 1 }"#);

        let error = StoryCatalog::load(dir.path()).unwrap_err();

        assert_eq!(error.code, "unsupportedStoryCatalogVersion");
        assert!(error.message.contains("story_catalog.json"));
        assert!(error.message.contains('1'));
    }

    #[test]
    fn rejects_version_three_before_v2_payload_validation() {
        // A future schema may drop or rename v2 fields. The loader must check
        // schemaVersion from a minimal envelope before attempting to
        // deserialize the version-specific payload, otherwise a v3 (or later)
        // document that omits v2 fields would surface as a generic
        // "malformed" load failure instead of unsupportedStoryCatalogVersion.
        let dir = TestDir::new("version-envelope");
        write_catalog(dir.path(), r#"{ "schemaVersion": 3 }"#);

        let error = StoryCatalog::load(dir.path()).unwrap_err();

        assert_eq!(error.code, "unsupportedStoryCatalogVersion");
        assert!(error.message.contains("story_catalog.json"));
        assert!(error.message.contains('3'));
    }

    #[test]
    fn version_two_requires_source_groups_and_record_provenance() {
        let cases = [
            (
                "missing-source-groups",
                json!({
                    "schemaVersion": 2,
                    "facts": [],
                    "questions": [],
                    "objectives": [],
                    "authorizations": [],
                    "evidenceIndex": [],
                    "statementsIndex": [],
                }),
            ),
            (
                "missing-provenance",
                catalog_json(
                    vec![json!({
                        "id": "receipt",
                        "chapterId": "chapter_1",
                        "sceneId": "investigation_scene_1",
                    })],
                    vec![],
                    vec![],
                ),
            ),
        ];

        for (label, json) in cases {
            let dir = TestDir::new(label);
            write_catalog_value(dir.path(), &json);

            let error = StoryCatalog::load(dir.path()).unwrap_err();

            assert_eq!(error.code, "storyCatalogLoadFailed", "{label}");
        }
    }

    #[test]
    fn rejects_unknown_v2_fields_at_the_owning_load_boundary() {
        let mut payload = catalog_json(vec![], vec![], vec![]);
        payload["unexpectedPayload"] = json!(true);

        let mut record = record_json("receipt", None, "lead", None);
        record["unexpectedRecord"] = json!(true);

        let mut provenance = provenance_json(None, "lead", None);
        provenance["unexpectedProvenance"] = json!(true);
        let record_with_unknown_provenance = json!({
            "id": "receipt",
            "chapterId": "chapter_1",
            "sceneId": "investigation_scene_1",
            "provenance": provenance,
        });

        let mut group = json!({
            "id": "receipt_source",
            "label": "Receipt source",
            "summary": "One physical source.",
            "members": [{"kind": "evidence", "id": "receipt"}],
        });
        group["unexpectedGroup"] = json!(true);

        let cases = [
            ("payload", payload),
            ("record", catalog_json(vec![record], vec![], vec![])),
            (
                "provenance",
                catalog_json(vec![record_with_unknown_provenance], vec![], vec![]),
            ),
            (
                "group",
                catalog_json(
                    vec![record_json("receipt", Some("receipt_source"), "lead", None)],
                    vec![],
                    vec![group],
                ),
            ),
        ];

        for (label, json) in cases {
            let dir = TestDir::new(label);
            write_catalog_value(dir.path(), &json);

            let error = StoryCatalog::load(dir.path()).unwrap_err();

            assert_eq!(error.code, "storyCatalogLoadFailed", "{label}");
        }
    }

    #[test]
    fn rejects_duplicate_ids_within_each_definition_kind() {
        let cases = [
            (
                "facts",
                r#"[{"id":"duplicate","label":"A","summary":"A","details":"A","category":"A"},{"id":"duplicate","label":"B","summary":"B","details":"B","category":"B"}]"#,
            ),
            (
                "questions",
                r#"[{"id":"duplicate","label":"A","summary":"A","resolvedByFactIds":[]},{"id":"duplicate","label":"B","summary":"B","resolvedByFactIds":[]}]"#,
            ),
            (
                "objectives",
                r#"[{"id":"duplicate","label":"A","summary":"A","kind":"primary","sortOrder":1},{"id":"duplicate","label":"B","summary":"B","kind":"secondary","sortOrder":2}]"#,
            ),
            (
                "authorizations",
                r#"[{"id":"duplicate","label":"A","summary":"A","grantingAuthority":"A"},{"id":"duplicate","label":"B","summary":"B","grantingAuthority":"B"}]"#,
            ),
        ];

        for (kind, definitions) in cases {
            let dir = TestDir::new(kind);
            let json = empty_json().replace(
                &format!("\"{kind}\": []"),
                &format!("\"{kind}\": {definitions}"),
            );
            write_catalog(dir.path(), &json);

            let error = StoryCatalog::load(dir.path()).unwrap_err();

            assert_eq!(error.code, "storyCatalogValidationFailed", "{kind}");
            assert!(error.message.contains("duplicate"), "{kind}");
        }
    }

    #[test]
    fn rejects_unresolved_question_fact() {
        let dir = TestDir::new("unresolved-fact");
        let json = empty_json().replace(
            "\"questions\": []",
            r#""questions": [{"id":"question","label":"Question","summary":"Question","resolvedByFactIds":["missing_fact"]}]"#,
        );
        write_catalog(dir.path(), &json);

        let error = StoryCatalog::load(dir.path()).unwrap_err();

        assert_eq!(error.code, "storyCatalogValidationFailed");
        assert!(error.message.contains("missing_fact"));
    }

    #[test]
    fn rejects_invalid_objective_kind() {
        let dir = TestDir::new("objective-kind");
        let json = empty_json().replace(
            "\"objectives\": []",
            r#""objectives": [{"id":"objective","label":"Objective","summary":"Objective","kind":"tertiary","sortOrder":1}]"#,
        );
        write_catalog(dir.path(), &json);

        let error = StoryCatalog::load(dir.path()).unwrap_err();

        assert_eq!(error.code, "storyCatalogValidationFailed");
        assert!(error.message.contains("objective"));
        assert!(error.message.contains("tertiary"));
    }

    #[test]
    fn rejects_duplicate_evidence_and_statement_index_ids() {
        let cases = [("evidence", true), ("statement", false)];

        for (kind, is_evidence) in cases {
            let dir = TestDir::new(kind);
            let records = vec![
                record_json("duplicate_record", None, "lead", None),
                record_json("duplicate_record", None, "reacquired", None),
            ];
            let json = if is_evidence {
                catalog_json(records, vec![], vec![])
            } else {
                catalog_json(vec![], records, vec![])
            };
            write_catalog_value(dir.path(), &json);

            let error = StoryCatalog::load(dir.path()).unwrap_err();

            assert_eq!(error.code, "storyCatalogValidationFailed", "{kind}");
            assert!(error.message.contains("duplicate_record"), "{kind}");
        }
    }

    #[test]
    fn loads_canonical_mixed_source_group_and_resolves_records() {
        let dir = TestDir::new("canonical-mixed-group");
        let json = catalog_json(
            vec![
                record_json("receipt_a", Some("shared_source"), "lead", None),
                record_json("receipt_b", Some("shared_source"), "reacquired", None),
            ],
            vec![record_json(
                "witness_a",
                Some("shared_source"),
                "lead",
                None,
            )],
            vec![json!({
                "id": "shared_source",
                "label": "Shared source",
                "summary": "One underlying source.",
                "members": [
                    {"kind": "evidence", "id": "receipt_a"},
                    {"kind": "evidence", "id": "receipt_b"},
                    {"kind": "statement", "id": "witness_a"},
                ],
            })],
        );
        write_catalog_value(dir.path(), &json);

        let catalog = StoryCatalog::load(dir.path()).unwrap();

        let target = InventoryTarget::Evidence {
            id: "receipt_a".into(),
        };
        let record = catalog.case_record(&target).unwrap();
        assert_eq!(record.chapter_id, "chapter_1");
        assert_eq!(record.scene_id, "investigation_scene_1");
        assert_eq!(
            record.provenance.source_group_id.as_deref(),
            Some("shared_source")
        );
        let group = catalog.source_group("shared_source").unwrap();
        assert_eq!(group.id, "shared_source");
        assert_eq!(group.label, "Shared source");
        assert_eq!(group.summary, "One underlying source.");
        assert_eq!(
            group.members.iter().cloned().collect::<Vec<_>>(),
            [
                InventoryTarget::Evidence {
                    id: "receipt_a".into()
                },
                InventoryTarget::Evidence {
                    id: "receipt_b".into()
                },
                InventoryTarget::Statement {
                    id: "witness_a".into()
                },
            ]
        );
    }

    #[test]
    fn rejects_invalid_source_group_membership_projection() {
        let grouped_record = record_json("receipt", Some("receipt_source"), "lead", None);
        let other_group_record = record_json("receipt", Some("other_source"), "lead", None);
        let ungrouped_record = record_json("receipt", None, "lead", None);
        let member = json!({"kind": "evidence", "id": "receipt"});

        let cases = [
            (
                "duplicate-member",
                catalog_json(
                    vec![grouped_record.clone()],
                    vec![],
                    vec![json!({
                        "id": "receipt_source",
                        "label": "Receipt",
                        "summary": "Source.",
                        "members": [member.clone(), member.clone()],
                    })],
                ),
            ),
            (
                "non-canonical-order",
                catalog_json(
                    vec![grouped_record.clone()],
                    vec![record_json("witness", Some("receipt_source"), "lead", None)],
                    vec![json!({
                        "id": "receipt_source",
                        "label": "Receipt",
                        "summary": "Source.",
                        "members": [
                            {"kind": "statement", "id": "witness"},
                            member.clone(),
                        ],
                    })],
                ),
            ),
            (
                "missing-target",
                catalog_json(
                    vec![],
                    vec![],
                    vec![json!({
                        "id": "receipt_source",
                        "label": "Receipt",
                        "summary": "Source.",
                        "members": [member.clone()],
                    })],
                ),
            ),
            (
                "null-record-group",
                catalog_json(
                    vec![ungrouped_record],
                    vec![],
                    vec![json!({
                        "id": "receipt_source",
                        "label": "Receipt",
                        "summary": "Source.",
                        "members": [member.clone()],
                    })],
                ),
            ),
            (
                "different-record-group",
                catalog_json(
                    vec![other_group_record],
                    vec![],
                    vec![
                        json!({
                            "id": "receipt_source",
                            "label": "Receipt",
                            "summary": "Source.",
                            "members": [member.clone()],
                        }),
                        json!({
                            "id": "other_source",
                            "label": "Other",
                            "summary": "Other source.",
                            "members": [{"kind": "evidence", "id": "receipt"}],
                        }),
                    ],
                ),
            ),
            (
                "record-omitted-from-group",
                catalog_json(
                    vec![
                        grouped_record.clone(),
                        record_json("other_receipt", Some("receipt_source"), "lead", None),
                    ],
                    vec![],
                    vec![json!({
                        "id": "receipt_source",
                        "label": "Receipt",
                        "summary": "Source.",
                        "members": [member.clone()],
                    })],
                ),
            ),
            (
                "empty-group",
                catalog_json(
                    vec![],
                    vec![],
                    vec![json!({
                        "id": "receipt_source",
                        "label": "Receipt",
                        "summary": "Source.",
                        "members": [],
                    })],
                ),
            ),
            (
                "duplicate-group-id",
                catalog_json(
                    vec![grouped_record],
                    vec![],
                    vec![
                        json!({
                            "id": "receipt_source",
                            "label": "Receipt",
                            "summary": "Source.",
                            "members": [member.clone()],
                        }),
                        json!({
                            "id": "receipt_source",
                            "label": "Duplicate",
                            "summary": "Duplicate source.",
                            "members": [member],
                        }),
                    ],
                ),
            ),
        ];

        for (label, json) in cases {
            let dir = TestDir::new(label);
            write_catalog_value(dir.path(), &json);

            let error = StoryCatalog::load(dir.path()).unwrap_err();

            assert_eq!(error.code, "storyCatalogValidationFailed", "{label}");
        }
    }

    #[test]
    fn resolves_complete_supersession_chain_from_every_member() {
        let dir = TestDir::new("supersession-chain");
        let json = catalog_json(
            vec![
                record_json("lead", None, "lead", None),
                record_json("reacquired", None, "reacquired", Some("evidence:lead")),
                record_json("exhibit", None, "exhibit", Some("evidence:reacquired")),
            ],
            vec![],
            vec![],
        );
        write_catalog_value(dir.path(), &json);
        let catalog = StoryCatalog::load(dir.path()).unwrap();
        let lead = InventoryTarget::Evidence { id: "lead".into() };
        let reacquired = InventoryTarget::Evidence {
            id: "reacquired".into(),
        };
        let exhibit = InventoryTarget::Evidence {
            id: "exhibit".into(),
        };
        let expected_chain = vec![lead.clone(), reacquired.clone(), exhibit.clone()];

        assert_eq!(catalog.predecessor(&lead).unwrap(), None);
        assert_eq!(
            catalog.predecessor(&reacquired).unwrap(),
            Some(lead.clone())
        );
        assert_eq!(
            catalog.predecessor(&exhibit).unwrap(),
            Some(reacquired.clone())
        );
        assert_eq!(catalog.successor(&lead).unwrap(), Some(reacquired.clone()));
        assert_eq!(
            catalog.successor(&reacquired).unwrap(),
            Some(exhibit.clone())
        );
        assert_eq!(catalog.successor(&exhibit).unwrap(), None);

        for member in [&lead, &reacquired, &exhibit] {
            assert_eq!(catalog.chain(member).unwrap(), expected_chain);
            assert_eq!(catalog.latest_definition(member).unwrap(), exhibit);
        }
    }

    #[test]
    fn resolves_cross_kind_supersession_chain_from_both_typed_namespaces() {
        let dir = TestDir::new("cross-kind-supersession-chain");
        let json = catalog_json(
            vec![record_json("evidence_lead", None, "lead", None)],
            vec![record_json(
                "statement_exhibit",
                None,
                "exhibit",
                Some("evidence:evidence_lead"),
            )],
            vec![],
        );
        write_catalog_value(dir.path(), &json);

        let catalog = StoryCatalog::load(dir.path()).unwrap();
        let evidence = InventoryTarget::Evidence {
            id: "evidence_lead".into(),
        };
        let statement = InventoryTarget::Statement {
            id: "statement_exhibit".into(),
        };

        assert_eq!(
            catalog.predecessor(&statement).unwrap(),
            Some(evidence.clone())
        );
        assert_eq!(
            catalog.successor(&evidence).unwrap(),
            Some(statement.clone())
        );
        assert_eq!(
            catalog.chain(&evidence).unwrap(),
            vec![evidence.clone(), statement.clone()]
        );
        assert_eq!(catalog.latest_definition(&evidence).unwrap(), statement);
    }

    #[test]
    fn rejects_invalid_supersession_graphs() {
        let cases = [
            (
                "unknown",
                catalog_json(
                    vec![record_json(
                        "successor",
                        None,
                        "reacquired",
                        Some("evidence:missing"),
                    )],
                    vec![],
                    vec![],
                ),
            ),
            (
                "self",
                catalog_json(
                    vec![record_json("record", None, "lead", Some("evidence:record"))],
                    vec![],
                    vec![],
                ),
            ),
            (
                "fork",
                catalog_json(
                    vec![
                        record_json("root", None, "lead", None),
                        record_json("successor_a", None, "reacquired", Some("evidence:root")),
                        record_json("successor_b", None, "reacquired", Some("evidence:root")),
                    ],
                    vec![],
                    vec![],
                ),
            ),
            (
                "cycle",
                catalog_json(
                    vec![
                        record_json("record_a", None, "lead", Some("evidence:record_b")),
                        record_json("record_b", None, "lead", Some("evidence:record_a")),
                    ],
                    vec![],
                    vec![],
                ),
            ),
            (
                "procedural-regression",
                catalog_json(
                    vec![
                        record_json("reacquired", None, "reacquired", None),
                        record_json("lead", None, "lead", Some("evidence:reacquired")),
                    ],
                    vec![],
                    vec![],
                ),
            ),
            (
                "cross-kind-cycle",
                catalog_json(
                    vec![record_json("e1", None, "lead", Some("statement:s1"))],
                    vec![record_json("s1", None, "lead", Some("evidence:e1"))],
                    vec![],
                ),
            ),
            (
                "cross-kind-fork",
                catalog_json(
                    vec![record_json("root", None, "lead", None)],
                    vec![
                        record_json("s_a", None, "reacquired", Some("evidence:root")),
                        record_json("s_b", None, "reacquired", Some("evidence:root")),
                    ],
                    vec![],
                ),
            ),
        ];

        for (label, json) in cases {
            let dir = TestDir::new(label);
            write_catalog_value(dir.path(), &json);

            let error = StoryCatalog::load(dir.path()).unwrap_err();

            assert_eq!(error.code, "storyCatalogValidationFailed", "{label}");
        }
    }
}
