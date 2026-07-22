// src-tauri/src/game/acquisition.rs

use super::schema::{EvidenceJson, StatementJson};
use super::state::Inventory;

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
    pub(super) inventory: &'a mut Inventory,
    // HPA-129 adds: events: &'a mut AcquisitionLog, command_id: &'a str
}

impl AcquisitionCtx<'_> {
    /// Returns true when the record was newly acquired.
    pub(super) fn evidence(
        &mut self,
        def: &EvidenceJson,
        chapter_id: &str,
        scene_id: &str,
    ) -> bool {
        self.inventory
            .add_evidence_from_def(def, chapter_id, scene_id)
    }

    /// Returns true when the record was newly acquired.
    pub(super) fn statement(
        &mut self,
        def: &StatementJson,
        chapter_id: &str,
        scene_id: &str,
    ) -> bool {
        self.inventory
            .add_statement_from_def(def, chapter_id, scene_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::EvidenceJson;
    use crate::game::state::Inventory;

    fn evidence_def(id: &str) -> EvidenceJson {
        EvidenceJson {
            id: id.into(),
            name: id.into(),
            description: id.into(),
            details: id.into(),
            image_asset_id: None,
            on_collect: vec![],
            on_reexamine: None,
        }
    }

    #[test]
    fn evidence_reports_newly_added_then_dedupes() {
        let mut inventory = Inventory::default();
        let mut ctx = AcquisitionCtx {
            inventory: &mut inventory,
        };
        assert!(ctx.evidence(&evidence_def("coffee"), "chapter_1", "scene_1"));
        assert!(!ctx.evidence(&evidence_def("coffee"), "chapter_1", "scene_1"));
        assert_eq!(inventory.evidence.len(), 1);
    }
}
