use crate::game::schema::InventoryTarget;
use crate::game::GameError;
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

const STORY_CATALOG_SCHEMA_VERSION: i64 = 1;

#[derive(Debug)]
pub(in crate::game) struct StoryCatalog {
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
    #[allow(dead_code)]
    evidence_by_id: BTreeMap<String, CaseRecordDefinitionIndex>,
    #[allow(dead_code)]
    statement_by_id: BTreeMap<String, CaseRecordDefinitionIndex>,
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
#[serde(rename_all = "camelCase")]
struct StoryCatalogJson {
    schema_version: i64,
    facts: Vec<FactDefinition>,
    questions: Vec<QuestionDefinition>,
    objectives: Vec<ObjectiveDefinitionJson>,
    authorizations: Vec<AuthorizationDefinition>,
    evidence_index: Vec<CaseRecordDefinitionIndex>,
    statements_index: Vec<CaseRecordDefinitionIndex>,
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

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaseRecordDefinitionIndex {
    id: String,
    // Retained immutable origin metadata for downstream story-state consumers.
    #[allow(dead_code)]
    chapter_id: String,
    #[allow(dead_code)]
    scene_id: String,
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
        let json: StoryCatalogJson = serde_json::from_str(&source).map_err(|error| {
            GameError::story_catalog_load_failed(
                &path,
                format!("catalog resource is malformed: {error}"),
            )
        })?;

        if json.schema_version != STORY_CATALOG_SCHEMA_VERSION {
            return Err(GameError::unsupported_story_catalog_version(
                &path,
                json.schema_version,
            ));
        }

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
        match target {
            InventoryTarget::Evidence { id } => self.evidence_by_id.contains_key(id),
            InventoryTarget::Statement { id } => self.statement_by_id.contains_key(id),
        }
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

    fn from_json(path: &Path, json: StoryCatalogJson) -> Result<Self, GameError> {
        let StoryCatalogJson {
            schema_version: _,
            facts,
            questions,
            objectives: objective_json,
            authorizations,
            evidence_index,
            statements_index,
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

        let evidence_by_id = case_record_index(path, "evidence", evidence_index.into_iter())?;
        let statement_by_id = case_record_index(path, "statement", statements_index.into_iter())?;

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
    definitions: impl Iterator<Item = CaseRecordDefinitionIndex>,
) -> Result<BTreeMap<String, CaseRecordDefinitionIndex>, GameError> {
    let mut index = BTreeMap::new();
    for definition in definitions {
        let id = definition.id.clone();
        if index.insert(id.clone(), definition).is_some() {
            return Err(GameError::story_catalog_validation_failed(
                path,
                format!("Duplicate {kind} index ID '{id}'."),
            ));
        }
    }
    Ok(index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::InventoryTarget;
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

    fn empty_json() -> &'static str {
        r#"{
  "schemaVersion": 1,
  "facts": [],
  "questions": [],
  "objectives": [],
  "authorizations": [],
  "evidenceIndex": [],
  "statementsIndex": []
}"#
    }

    #[test]
    fn loads_empty_version_one_catalog() {
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
    fn loads_populated_version_one_catalog_with_lookups_and_public_order() {
        let dir = TestDir::new("populated");
        write_catalog(
            dir.path(),
            r#"{
  "schemaVersion": 1,
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
  "evidenceIndex": [
    {"id":"record_shared","chapterId":"chapter_1","sceneId":"scene_1"}
  ],
  "statementsIndex": [
    {"id":"record_shared","chapterId":"chapter_2","sceneId":"scene_2"}
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
    fn rejects_unsupported_schema_version() {
        let dir = TestDir::new("version");
        write_catalog(
            dir.path(),
            &empty_json().replace("\"schemaVersion\": 1", "\"schemaVersion\": 2"),
        );

        let error = StoryCatalog::load(dir.path()).unwrap_err();

        assert_eq!(error.code, "unsupportedStoryCatalogVersion");
        assert!(error.message.contains("story_catalog.json"));
        assert!(error.message.contains('2'));
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
        let cases = ["evidenceIndex", "statementsIndex"];

        for index in cases {
            let dir = TestDir::new(index);
            let definitions = r#"[{"id":"duplicate_record","chapterId":"chapter_1","sceneId":"scene_1"},{"id":"duplicate_record","chapterId":"chapter_2","sceneId":"scene_2"}]"#;
            let json = empty_json().replace(
                &format!("\"{index}\": []"),
                &format!("\"{index}\": {definitions}"),
            );
            write_catalog(dir.path(), &json);

            let error = StoryCatalog::load(dir.path()).unwrap_err();

            assert_eq!(error.code, "storyCatalogValidationFailed", "{index}");
            assert!(error.message.contains("duplicate_record"), "{index}");
        }
    }
}
