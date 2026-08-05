use crate::game::schema::{compare_inventory_targets, InventoryTarget};
use crate::game::story::{FactProgress, StoryCatalog, StoryState};
use crate::game::GameError;
use std::collections::BTreeSet;

#[allow(dead_code)] // Consumed by later public-view and save integration tasks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceGroupClosure {
    pub groups: BTreeSet<String>,
    pub missing_group_records: BTreeSet<InventoryTarget>,
}

#[allow(dead_code)] // Consumed by later public-view and save integration tasks.
pub(crate) struct SupportLineage<'a> {
    catalog: &'a StoryCatalog,
    state: &'a StoryState,
}

#[derive(Debug)]
enum TraversalFrame {
    Enter(String),
    Exit(String),
}

#[derive(Debug, Default)]
struct TransitiveClosure {
    records: BTreeSet<InventoryTarget>,
    facts: BTreeSet<String>,
}

#[allow(dead_code)] // Consumed by later public-view and save integration tasks.
impl<'a> SupportLineage<'a> {
    pub(crate) fn new(catalog: &'a StoryCatalog, state: &'a StoryState) -> Self {
        Self { catalog, state }
    }

    pub(crate) fn direct_records(
        &self,
        fact_id: &str,
    ) -> Result<BTreeSet<InventoryTarget>, GameError> {
        let progress = self.root_progress(fact_id)?;
        let records = progress.supporting_records().clone();
        for target in &records {
            self.require_case_record(target)?;
        }
        Ok(records)
    }

    pub(crate) fn transitive_records(
        &self,
        fact_id: &str,
    ) -> Result<BTreeSet<InventoryTarget>, GameError> {
        Ok(self.transitive_closure(fact_id)?.records)
    }

    pub(crate) fn transitive_facts(&self, fact_id: &str) -> Result<BTreeSet<String>, GameError> {
        Ok(self.transitive_closure(fact_id)?.facts)
    }

    pub(crate) fn transitive_source_group_closure(
        &self,
        fact_id: &str,
    ) -> Result<SourceGroupClosure, GameError> {
        let records = self.transitive_records(fact_id)?;
        let mut groups = BTreeSet::new();
        let mut missing_group_records = BTreeSet::new();

        for target in records {
            let definition = self.require_case_record(&target)?;
            if let Some(group_id) = &definition.provenance.source_group_id {
                groups.insert(group_id.clone());
            } else {
                missing_group_records.insert(target);
            }
        }

        Ok(SourceGroupClosure {
            groups,
            missing_group_records,
        })
    }

    pub(crate) fn transitive_source_groups(
        &self,
        fact_id: &str,
    ) -> Result<BTreeSet<String>, GameError> {
        let closure = self.transitive_source_group_closure(fact_id)?;
        if closure.missing_group_records.is_empty() {
            return Ok(closure.groups);
        }

        let mut missing_records = closure
            .missing_group_records
            .iter()
            .collect::<Vec<&InventoryTarget>>();
        missing_records.sort_by(|left, right| compare_inventory_targets(left, right));
        let records = missing_records
            .into_iter()
            .map(format_inventory_target)
            .collect::<Vec<_>>()
            .join(", ");
        Err(GameError::missing_case_record_source_group(records))
    }

    fn root_progress(&self, fact_id: &str) -> Result<&FactProgress, GameError> {
        if self.catalog.fact(fact_id).is_none() {
            return Err(GameError::unknown_story_fact(fact_id));
        }
        self.state
            .fact_progress(fact_id)
            .ok_or_else(|| GameError::unknown_story_fact(fact_id))
    }

    fn supporting_progress(&self, fact_id: &str) -> Result<&FactProgress, GameError> {
        if self.catalog.fact(fact_id).is_none() {
            return Err(GameError::invalid_supporting_fact(
                fact_id,
                "the definition does not exist",
            ));
        }
        self.state.fact_progress(fact_id).ok_or_else(|| {
            GameError::invalid_supporting_fact(fact_id, "the fact has not been asserted")
        })
    }

    fn require_case_record(
        &self,
        target: &InventoryTarget,
    ) -> Result<&crate::game::story::CaseRecordDefinition, GameError> {
        self.catalog.case_record(target).ok_or_else(|| {
            let (kind, id) = inventory_target_parts(target);
            GameError::unknown_supporting_case_record(kind, id)
        })
    }

    fn transitive_closure(&self, root_fact_id: &str) -> Result<TransitiveClosure, GameError> {
        self.root_progress(root_fact_id)?;

        let mut closure = TransitiveClosure::default();
        let mut stack = vec![TraversalFrame::Enter(root_fact_id.to_owned())];
        let mut active = BTreeSet::new();
        let mut visited = BTreeSet::new();

        while let Some(frame) = stack.pop() {
            match frame {
                TraversalFrame::Exit(fact_id) => {
                    active.remove(&fact_id);
                    visited.insert(fact_id);
                }
                TraversalFrame::Enter(fact_id) => {
                    if visited.contains(&fact_id) {
                        continue;
                    }
                    if !active.insert(fact_id.clone()) {
                        return Err(GameError::invalid_supporting_fact(
                            &fact_id,
                            "support lineage contains a cycle",
                        ));
                    }

                    let progress = if fact_id == root_fact_id {
                        self.root_progress(&fact_id)?
                    } else {
                        self.supporting_progress(&fact_id)?
                    };
                    for target in progress.supporting_records() {
                        self.require_case_record(target)?;
                        closure.records.insert(target.clone());
                    }
                    for supporting_fact_id in progress.supporting_fact_ids() {
                        if supporting_fact_id != root_fact_id {
                            closure.facts.insert(supporting_fact_id.clone());
                        }
                    }

                    stack.push(TraversalFrame::Exit(fact_id));
                    for supporting_fact_id in progress.supporting_fact_ids().iter().rev() {
                        stack.push(TraversalFrame::Enter(supporting_fact_id.clone()));
                    }
                }
            }
        }

        Ok(closure)
    }
}

fn inventory_target_parts(target: &InventoryTarget) -> (&'static str, &str) {
    match target {
        InventoryTarget::Evidence { id } => ("evidence", id),
        InventoryTarget::Statement { id } => ("statement", id),
    }
}

fn format_inventory_target(target: &InventoryTarget) -> String {
    let (kind, id) = inventory_target_parts(target);
    format!("{kind}:{id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::InventoryTarget;
    use crate::game::story::{AssertionOrigin, StoryCatalog, StoryState};
    use serde_json::{json, Value};
    use std::collections::BTreeSet;

    #[derive(Clone)]
    struct RecordFixture {
        target: InventoryTarget,
        source_group_id: Option<&'static str>,
    }

    fn evidence(id: &str) -> InventoryTarget {
        InventoryTarget::Evidence { id: id.into() }
    }

    fn statement(id: &str) -> InventoryTarget {
        InventoryTarget::Statement { id: id.into() }
    }

    fn record(target: InventoryTarget, source_group_id: Option<&'static str>) -> RecordFixture {
        RecordFixture {
            target,
            source_group_id,
        }
    }

    fn catalog(fact_ids: &[&str], records: &[RecordFixture]) -> StoryCatalog {
        let dir = tempfile::tempdir().unwrap();
        let facts = fact_ids
            .iter()
            .map(|id| {
                json!({
                    "id": id,
                    "label": id,
                    "summary": id,
                    "details": format!("{id} details"),
                    "category": "timeline",
                })
            })
            .collect::<Vec<_>>();
        let record_json = |fixture: &RecordFixture| {
            json!({
                "id": target_id(&fixture.target),
                "chapterId": "chapter_1",
                "sceneId": "scene_1",
                "provenance": {
                    "sourceKind": "unspecified",
                    "representationLayer": "none",
                    "proceduralStatus": "unspecified",
                    "completeness": "unspecified",
                    "confidence": "unspecified",
                    "sourceGroupId": fixture.source_group_id,
                    "sourceLabel": null,
                    "proofCapabilities": [],
                    "supersedesRecordId": null,
                },
            })
        };
        let evidence_index = records
            .iter()
            .filter(|fixture| matches!(fixture.target, InventoryTarget::Evidence { .. }))
            .map(record_json)
            .collect::<Vec<_>>();
        let statements_index = records
            .iter()
            .filter(|fixture| matches!(fixture.target, InventoryTarget::Statement { .. }))
            .map(record_json)
            .collect::<Vec<_>>();
        let mut group_ids = records
            .iter()
            .filter_map(|fixture| fixture.source_group_id)
            .collect::<Vec<_>>();
        group_ids.sort_unstable();
        group_ids.dedup();
        let source_groups = group_ids
            .into_iter()
            .map(|id| {
                let mut members = records
                    .iter()
                    .filter(|fixture| fixture.source_group_id == Some(id))
                    .map(|fixture| fixture.target.clone())
                    .collect::<Vec<_>>();
                members.sort_by(crate::game::schema::compare_inventory_targets);
                json!({
                    "id": id,
                    "label": id,
                    "summary": format!("{id} summary"),
                    "members": members,
                })
            })
            .collect::<Vec<Value>>();

        std::fs::write(
            dir.path().join("story_catalog.json"),
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 2,
                "facts": facts,
                "questions": [],
                "objectives": [],
                "authorizations": [],
                "sourceGroups": source_groups,
                "evidenceIndex": evidence_index,
                "statementsIndex": statements_index,
            }))
            .unwrap(),
        )
        .unwrap();
        StoryCatalog::load(dir.path()).unwrap()
    }

    fn target_id(target: &InventoryTarget) -> &str {
        match target {
            InventoryTarget::Evidence { id } | InventoryTarget::Statement { id } => id,
        }
    }

    fn assert_fact(
        state: &mut StoryState,
        catalog: &StoryCatalog,
        fact_id: &str,
        supporting_records: &[InventoryTarget],
        supporting_fact_ids: &[&str],
    ) {
        state
            .assert_fact(
                catalog,
                fact_id,
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "scene_1".into(),
                    block_kind: crate::game::story::StoryEventBlockKind::Hotspot,
                    block_id: "support_event".into(),
                },
                supporting_records,
                &supporting_fact_ids
                    .iter()
                    .map(|id| (*id).to_owned())
                    .collect::<Vec<_>>(),
            )
            .unwrap();
    }

    #[test]
    fn direct_and_transitive_closures_follow_support_edges_and_exclude_the_root_fact() {
        let evidence_a = evidence("a");
        let statement_b = statement("b");
        let evidence_c = evidence("c");
        let catalog = catalog(
            &["fact_a", "fact_b", "fact_c"],
            &[
                record(evidence_a.clone(), Some("source_a")),
                record(statement_b.clone(), Some("source_b")),
                record(evidence_c.clone(), Some("source_c")),
            ],
        );
        let mut state = StoryState::default();
        assert_fact(
            &mut state,
            &catalog,
            "fact_a",
            std::slice::from_ref(&evidence_a),
            &[],
        );
        assert_fact(
            &mut state,
            &catalog,
            "fact_b",
            std::slice::from_ref(&statement_b),
            &["fact_a"],
        );
        assert_fact(
            &mut state,
            &catalog,
            "fact_c",
            std::slice::from_ref(&evidence_c),
            &["fact_b"],
        );

        let lineage = SupportLineage::new(&catalog, &state);

        assert_eq!(
            lineage.direct_records("fact_c").unwrap(),
            BTreeSet::from([evidence_c.clone()])
        );
        assert_eq!(
            lineage.transitive_records("fact_c").unwrap(),
            BTreeSet::from([evidence_a, statement_b, evidence_c])
        );
        assert_eq!(
            lineage.transitive_facts("fact_c").unwrap(),
            BTreeSet::from(["fact_a".into(), "fact_b".into()])
        );
    }

    #[test]
    fn repeated_fact_paths_deduplicate_typed_records_and_facts() {
        let evidence_a = evidence("a");
        let statement_b = statement("b");
        let catalog = catalog(
            &["fact_a", "fact_b", "fact_root"],
            &[
                record(evidence_a.clone(), Some("source_a")),
                record(statement_b.clone(), Some("source_b")),
            ],
        );
        let mut state = StoryState::default();
        assert_fact(
            &mut state,
            &catalog,
            "fact_a",
            std::slice::from_ref(&evidence_a),
            &[],
        );
        assert_fact(
            &mut state,
            &catalog,
            "fact_b",
            std::slice::from_ref(&statement_b),
            &["fact_a"],
        );
        assert_fact(
            &mut state,
            &catalog,
            "fact_root",
            std::slice::from_ref(&evidence_a),
            &["fact_a", "fact_b"],
        );

        let lineage = SupportLineage::new(&catalog, &state);

        assert_eq!(
            lineage.transitive_records("fact_root").unwrap(),
            BTreeSet::from([evidence_a, statement_b])
        );
        assert_eq!(
            lineage.transitive_facts("fact_root").unwrap(),
            BTreeSet::from(["fact_a".into(), "fact_b".into()])
        );
    }

    #[test]
    fn source_group_closure_resolves_unacquired_evidence_and_statement_definitions() {
        let evidence_a = evidence("a");
        let statement_b = statement("b");
        let catalog = catalog(
            &["fact_a", "fact_root"],
            &[
                record(evidence_a.clone(), Some("physical_source")),
                record(statement_b.clone(), Some("testimony_source")),
            ],
        );
        let mut state = StoryState::default();
        assert_fact(
            &mut state,
            &catalog,
            "fact_a",
            std::slice::from_ref(&evidence_a),
            &[],
        );
        assert_fact(
            &mut state,
            &catalog,
            "fact_root",
            std::slice::from_ref(&statement_b),
            &["fact_a"],
        );

        let lineage = SupportLineage::new(&catalog, &state);

        assert_eq!(
            lineage.transitive_records("fact_root").unwrap(),
            BTreeSet::from([evidence_a, statement_b])
        );
        assert_eq!(
            lineage
                .transitive_source_group_closure("fact_root")
                .unwrap(),
            SourceGroupClosure {
                groups: BTreeSet::from(["physical_source".into(), "testimony_source".into()]),
                missing_group_records: BTreeSet::new(),
            }
        );
        assert_eq!(
            lineage.transitive_source_groups("fact_root").unwrap(),
            BTreeSet::from(["physical_source".into(), "testimony_source".into()])
        );
    }

    #[test]
    fn diagnostic_source_closure_keeps_known_groups_and_all_missing_typed_records() {
        let evidence_known = evidence("known");
        let evidence_z = evidence("z_missing");
        let statement_a = statement("a_missing");
        let catalog = catalog(
            &["fact_leaf", "fact_root"],
            &[
                record(evidence_known.clone(), Some("known_source")),
                record(evidence_z.clone(), None),
                record(statement_a.clone(), None),
            ],
        );
        let mut state = StoryState::default();
        assert_fact(
            &mut state,
            &catalog,
            "fact_leaf",
            &[evidence_known, evidence_z.clone(), statement_a.clone()],
            &[],
        );
        assert_fact(
            &mut state,
            &catalog,
            "fact_root",
            &[evidence_z.clone(), statement_a.clone()],
            &["fact_leaf"],
        );

        let closure = SupportLineage::new(&catalog, &state)
            .transitive_source_group_closure("fact_root")
            .unwrap();

        assert_eq!(closure.groups, BTreeSet::from(["known_source".into()]));
        assert_eq!(
            closure.missing_group_records,
            BTreeSet::from([evidence_z, statement_a])
        );
    }

    #[test]
    fn strict_source_groups_list_every_missing_record_in_explicit_typed_order() {
        let evidence_z = evidence("z_missing");
        let statement_a = statement("a_missing");
        let catalog = catalog(
            &["fact_root"],
            &[
                record(evidence_z.clone(), None),
                record(statement_a.clone(), None),
            ],
        );
        let mut state = StoryState::default();
        assert_fact(
            &mut state,
            &catalog,
            "fact_root",
            &[statement_a, evidence_z],
            &[],
        );

        let error = SupportLineage::new(&catalog, &state)
            .transitive_source_groups("fact_root")
            .unwrap_err();

        assert_eq!(error.code, "missingCaseRecordSourceGroup");
        assert_eq!(
            error.message,
            "Strict source counting requires source groups for these case records: \
             evidence:z_missing, statement:a_missing."
        );
    }

    #[test]
    fn an_unknown_root_fact_returns_unknown_story_fact() {
        let catalog = catalog(&["fact_a"], &[]);
        let state = StoryState::default();

        let error = SupportLineage::new(&catalog, &state)
            .transitive_records("missing_fact")
            .unwrap_err();

        assert_eq!(error.code, "unknownStoryFact");
    }

    #[test]
    fn an_unknown_supporting_fact_returns_invalid_supporting_fact() {
        let complete_catalog = catalog(&["fact_leaf", "fact_root"], &[]);
        let mut state = StoryState::default();
        assert_fact(&mut state, &complete_catalog, "fact_leaf", &[], &[]);
        assert_fact(
            &mut state,
            &complete_catalog,
            "fact_root",
            &[],
            &["fact_leaf"],
        );
        let incomplete_catalog = catalog(&["fact_root"], &[]);

        let error = SupportLineage::new(&incomplete_catalog, &state)
            .transitive_records("fact_root")
            .unwrap_err();

        assert_eq!(error.code, "invalidSupportingFact");
        assert!(error.message.contains("fact_leaf"));
    }

    #[test]
    fn an_unknown_supporting_record_returns_unknown_supporting_case_record() {
        let evidence_a = evidence("a");
        let complete_catalog = catalog(
            &["fact_root"],
            &[record(evidence_a.clone(), Some("source_a"))],
        );
        let mut state = StoryState::default();
        assert_fact(
            &mut state,
            &complete_catalog,
            "fact_root",
            std::slice::from_ref(&evidence_a),
            &[],
        );
        let incomplete_catalog = catalog(&["fact_root"], &[]);

        let error = SupportLineage::new(&incomplete_catalog, &state)
            .transitive_records("fact_root")
            .unwrap_err();

        assert_eq!(error.code, "unknownSupportingCaseRecord");
        assert!(error.message.contains("evidence:a"));
    }

    #[test]
    fn a_corrupt_support_cycle_returns_invalid_supporting_fact() {
        let catalog = catalog(&["fact_a", "fact_b"], &[]);
        let mut state = StoryState::default();
        assert_fact(&mut state, &catalog, "fact_a", &[], &[]);
        assert_fact(&mut state, &catalog, "fact_b", &[], &["fact_a"]);
        state.replace_supporting_fact_ids_for_test("fact_a", BTreeSet::from(["fact_b".into()]));

        let error = SupportLineage::new(&catalog, &state)
            .transitive_records("fact_a")
            .unwrap_err();

        assert_eq!(error.code, "invalidSupportingFact");
        assert!(error.message.contains("cycle"));
    }
}
