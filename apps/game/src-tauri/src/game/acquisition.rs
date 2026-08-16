// src-tauri/src/game/acquisition.rs

use super::provenance::validate_scene_record_against_catalog;
use super::save::schema::{AcquisitionEventStateV1, RecordKind};
use super::schema::{EvidenceJson, InventoryTarget, StatementJson};
use super::state::Inventory;
use super::story::StoryCatalog;
use super::GameError;

/// The engine's named entry point for adding records to the inventory.
///
/// This is an entry point, not an enforced funnel. `Inventory` exposes its
/// `evidence` and `statements` vectors publicly, so any holder of
/// `&mut Inventory` can still push directly; making that impossible means
/// encapsulating those fields behind accessors, which is out of scope for
/// HPA-55. What this type provides is one well-named place that all three
/// current acquisition call sites route through, and a home for HPA-129's
/// `AcquisitionLog` and `command_id`.
///
/// It is a borrowed context rather than a `&mut self` engine method because
/// `reveals::*` already holds `&mut scene` and `&mut inventory` as disjoint
/// borrows of the engine; a `&mut self` call from inside would not compile.
pub(super) struct AcquisitionCtx<'a> {
    pub(super) catalog: &'a StoryCatalog,
    pub(super) inventory: &'a mut Inventory,
    pub(super) pending_events: &'a mut Vec<AcquisitionEventStateV1>,
    pub(super) command_id: u64,
    pub(super) next_ordinal: &'a mut u32,
}

impl AcquisitionCtx<'_> {
    /// Returns true when the record was newly acquired.
    pub(super) fn evidence(
        &mut self,
        def: &EvidenceJson,
        chapter_id: &str,
        scene_id: &str,
    ) -> Result<bool, GameError> {
        validate_scene_record_against_catalog(
            self.catalog,
            chapter_id,
            scene_id,
            &InventoryTarget::Evidence { id: def.id.clone() },
            &def.provenance,
        )?;
        let added = self
            .inventory
            .add_evidence_from_def(def, chapter_id, scene_id);
        if added {
            self.record(RecordKind::Evidence, &def.id);
        }
        Ok(added)
    }

    /// Returns true when the record was newly acquired.
    pub(super) fn statement(
        &mut self,
        def: &StatementJson,
        chapter_id: &str,
        scene_id: &str,
    ) -> Result<bool, GameError> {
        validate_scene_record_against_catalog(
            self.catalog,
            chapter_id,
            scene_id,
            &InventoryTarget::Statement { id: def.id.clone() },
            &def.provenance,
        )?;
        let added = self
            .inventory
            .add_statement_from_def(def, chapter_id, scene_id);
        if added {
            self.record(RecordKind::Statement, &def.id);
        }
        Ok(added)
    }

    fn record(&mut self, record_kind: RecordKind, record_id: &str) {
        let ordinal = *self.next_ordinal;
        self.pending_events.push(AcquisitionEventStateV1 {
            id: acquisition_event_id(self.command_id, ordinal),
            record_kind,
            record_id: record_id.into(),
            created_by_command_id: self.command_id,
            ordinal,
        });
        *self.next_ordinal = ordinal
            .checked_add(1)
            .expect("acquisition event ordinal overflowed u32");
    }
}

pub(in crate::game) fn acquisition_event_id(command_id: u64, ordinal: u32) -> String {
    format!("acq:{command_id}:{ordinal}")
}

/// Canonical presentation index: the earliest pending event by
/// (created_by_command_id, ordinal), regardless of physical vector order.
/// This is the single shared ordering for both the pending-acquisition view
/// and acknowledgement; the vector is never normalized on load.
pub(in crate::game) fn presented_event_index(events: &[AcquisitionEventStateV1]) -> Option<usize> {
    events
        .iter()
        .enumerate()
        .min_by_key(|(_, event)| (event.created_by_command_id, event.ordinal))
        .map(|(index, _)| index)
}

pub(in crate::game) fn validate_event_id(event: &AcquisitionEventStateV1) -> Result<(), GameError> {
    (event.id == acquisition_event_id(event.created_by_command_id, event.ordinal))
        .then_some(())
        .ok_or_else(GameError::unknown_acquisition_event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::provenance::{
        CaseRecordProvenance, Completeness, Confidence, ProceduralStatus, ProofCapability,
        RepresentationLayer, SourceKind,
    };
    use crate::game::save::schema::{AcquisitionEventStateV1, RecordKind};
    use crate::game::schema::{EvidenceJson, StatementJson};
    use crate::game::state::Inventory;
    use crate::game::test_support::catalog_with_case_records;
    use std::collections::BTreeSet;

    fn evidence_def(id: &str) -> EvidenceJson {
        EvidenceJson {
            id: id.into(),
            name: id.into(),
            description: id.into(),
            details: id.into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: None,
            on_collect: vec![],
            on_reexamine: None,
        }
    }

    fn statement_def(id: &str) -> StatementJson {
        StatementJson {
            id: id.into(),
            speaker: id.into(),
            content: id.into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            on_acquire: vec![],
            on_reexamine: None,
        }
    }

    fn exact_provenance() -> CaseRecordProvenance {
        CaseRecordProvenance {
            source_kind: SourceKind::Physical,
            representation_layer: RepresentationLayer::Raw,
            procedural_status: ProceduralStatus::Exhibit,
            completeness: Completeness::Complete,
            confidence: Confidence::Corroborated,
            source_group_id: None,
            source_label: Some("Original receipt".into()),
            proof_capabilities: BTreeSet::from([ProofCapability::Time, ProofCapability::Source]),
            supersedes_record_id: None,
        }
    }

    // Break caught: definition validation happens after inventory/event/ordinal
    // mutation, leaving a partial acquisition behind on error.
    #[test]
    fn mismatched_evidence_definition_is_rejected_before_any_mutation() {
        let catalog = catalog_with_case_records(
            vec![(
                "receipt",
                "chapter_1",
                "scene_1",
                CaseRecordProvenance::default(),
            )],
            vec![],
        );
        let mut definition = evidence_def("receipt");
        definition.provenance = exact_provenance();
        let mut inventory = Inventory::default();
        let mut events = vec![AcquisitionEventStateV1 {
            id: "acq:4:0".into(),
            record_kind: RecordKind::Evidence,
            record_id: "existing".into(),
            created_by_command_id: 4,
            ordinal: 0,
        }];
        let mut next_ordinal = 3;
        let mut ctx = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inventory,
            pending_events: &mut events,
            command_id: 4,
            next_ordinal: &mut next_ordinal,
        };

        let error = ctx
            .evidence(&definition, "chapter_1", "scene_1")
            .unwrap_err();

        assert_eq!(error.code, "caseRecordDefinitionMismatch");
        assert!(inventory.evidence.is_empty());
        assert_eq!(events.len(), 1);
        assert_eq!(next_ordinal, 3);
    }

    // Break caught: a valid acquisition loses or normalizes the immutable
    // provenance copied from its validated scene definition.
    #[test]
    fn valid_acquisitions_copy_exact_provenance() {
        let provenance = exact_provenance();
        let catalog = catalog_with_case_records(
            vec![("receipt", "chapter_1", "scene_1", provenance.clone())],
            vec![(
                "witness_account",
                "chapter_1",
                "scene_1",
                provenance.clone(),
            )],
        );
        let mut evidence = evidence_def("receipt");
        evidence.provenance = provenance.clone();
        let mut statement = statement_def("witness_account");
        statement.provenance = provenance.clone();
        let mut inventory = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut ctx = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inventory,
            pending_events: &mut events,
            command_id: 4,
            next_ordinal: &mut next_ordinal,
        };

        assert!(ctx.evidence(&evidence, "chapter_1", "scene_1").unwrap());
        assert!(ctx.statement(&statement, "chapter_1", "scene_1").unwrap());

        assert_eq!(inventory.evidence[0].provenance, provenance);
        assert_eq!(inventory.statements[0].provenance, provenance);
        assert_eq!(events.len(), 2);
        assert_eq!(next_ordinal, 2);
    }

    #[test]
    fn evidence_reports_newly_added_then_dedupes() {
        let catalog = catalog_with_case_records(
            vec![(
                "coffee",
                "chapter_1",
                "scene_1",
                CaseRecordProvenance::default(),
            )],
            vec![],
        );
        let mut inventory = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut ctx = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inventory,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        assert!(ctx
            .evidence(&evidence_def("coffee"), "chapter_1", "scene_1")
            .unwrap());
        assert!(!ctx
            .evidence(&evidence_def("coffee"), "chapter_1", "scene_1")
            .unwrap());
        assert_eq!(inventory.evidence.len(), 1);
    }

    #[test]
    fn statement_reports_newly_added_then_dedupes() {
        let catalog = catalog_with_case_records(
            vec![],
            vec![(
                "alibi",
                "chapter_1",
                "scene_1",
                CaseRecordProvenance::default(),
            )],
        );
        let mut inventory = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut ctx = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inventory,
            pending_events: &mut events,
            command_id: 1,
            next_ordinal: &mut next_ordinal,
        };
        assert!(ctx
            .statement(&statement_def("alibi"), "chapter_1", "scene_1")
            .unwrap());
        assert!(!ctx
            .statement(&statement_def("alibi"), "chapter_1", "scene_1")
            .unwrap());
        assert_eq!(inventory.statements.len(), 1);
    }

    // Break caught: new records fail to emit ordered, durable command events,
    // or re-acquisition consumes an ordinal despite adding no record.
    #[test]
    fn new_records_emit_reveal_ordered_events_without_dedupe_gaps() {
        let catalog = catalog_with_case_records(
            vec![(
                "receipt",
                "chapter_1",
                "scene_1",
                CaseRecordProvenance::default(),
            )],
            vec![(
                "alibi",
                "chapter_1",
                "scene_1",
                CaseRecordProvenance::default(),
            )],
        );
        let mut inventory = Inventory::default();
        let mut events = Vec::new();
        let mut next_ordinal = 0;
        let mut ctx = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inventory,
            pending_events: &mut events,
            command_id: 7,
            next_ordinal: &mut next_ordinal,
        };

        assert!(ctx
            .evidence(&evidence_def("receipt"), "chapter_1", "scene_1")
            .unwrap());
        assert!(ctx
            .statement(&statement_def("alibi"), "chapter_1", "scene_1")
            .unwrap());
        assert!(!ctx
            .evidence(&evidence_def("receipt"), "chapter_1", "scene_1")
            .unwrap());

        assert_eq!(
            events,
            vec![
                AcquisitionEventStateV1 {
                    id: "acq:7:0".into(),
                    record_kind: RecordKind::Evidence,
                    record_id: "receipt".into(),
                    created_by_command_id: 7,
                    ordinal: 0,
                },
                AcquisitionEventStateV1 {
                    id: "acq:7:1".into(),
                    record_kind: RecordKind::Statement,
                    record_id: "alibi".into(),
                    created_by_command_id: 7,
                    ordinal: 1,
                },
            ]
        );
        assert_eq!(next_ordinal, 2);
    }

    // Break caught: a nested acquisition ignores the command-local ordinal
    // supplied by its owning transaction and instead derives an ordinal from
    // unrelated global pending events.
    #[test]
    fn acquisition_uses_the_supplied_command_local_ordinal() {
        let catalog = catalog_with_case_records(
            vec![(
                "receipt",
                "chapter_1",
                "scene_1",
                CaseRecordProvenance::default(),
            )],
            vec![],
        );
        let mut inventory = Inventory::default();
        let mut events = vec![AcquisitionEventStateV1 {
            id: "acq:7:0".into(),
            record_kind: RecordKind::Evidence,
            record_id: "earlier".into(),
            created_by_command_id: 7,
            ordinal: 0,
        }];
        let mut next_ordinal = 3;
        let mut ctx = AcquisitionCtx {
            catalog: &catalog,
            inventory: &mut inventory,
            pending_events: &mut events,
            command_id: 7,
            next_ordinal: &mut next_ordinal,
        };

        assert!(ctx
            .evidence(&evidence_def("receipt"), "chapter_1", "scene_1")
            .unwrap());
        assert_eq!(events[1].id, "acq:7:3");
        assert_eq!(events[1].ordinal, 3);
        assert_eq!(next_ordinal, 4);
    }

    // Break caught: disk events lose their numeric command ID or grow an
    // acknowledgement field that does not belong to the closed save contract.
    #[test]
    fn acquisition_event_json_uses_numeric_command_id_without_acknowledgement() {
        let value = serde_json::to_value(AcquisitionEventStateV1 {
            id: "acq:7:0".into(),
            record_kind: RecordKind::Evidence,
            record_id: "receipt".into(),
            created_by_command_id: 7,
            ordinal: 0,
        })
        .unwrap();

        assert_eq!(value["createdByCommandId"], serde_json::json!(7));
        assert!(value.get("acknowledged").is_none());
    }

    // Break caught: a stored event whose textual ID disagrees with its numeric
    // command/ordinal pair reaches the view or save boundary as a real event.
    #[test]
    fn malformed_event_id_is_rejected_against_numeric_fields() {
        let event = AcquisitionEventStateV1 {
            id: "acq:7:9".into(),
            record_kind: RecordKind::Evidence,
            record_id: "receipt".into(),
            created_by_command_id: 7,
            ordinal: 1,
        };

        assert!(validate_event_id(&event).is_err());
    }
}
