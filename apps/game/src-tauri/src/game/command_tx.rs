// src-tauri/src/game/command_tx.rs
//
// Command transaction seam. Every engine command that mutates state and
// returns a view runs inside `command_tx`, which owns snapshot → execute →
// commit/restore and the single dialogue-history finalization point.

use super::dialogue::DialogueHistory;
use super::save::schema::AcquisitionEventStateV1;
use super::scenes::SceneRuntime;
use super::state::Inventory;
use super::story::StoryState;
use super::view::GameStateView;
use super::{GameEngine, GameError, LastVisualCue};

/// Transient rollback state for a single in-flight command.
///
/// This is NOT the persistent `SaveSnapshot` of canonical design §16 — see
/// §7.4. Rollback may clone runtime-owned objects for atomic restoration;
/// persistent saves store stable IDs and mutable progress. HPA-129's save
/// capture reads the same field enumeration below, but into a different
/// contract.
pub(in crate::game) struct EngineRollbackSnapshot {
    current_chapter_idx: usize,
    current_scene_idx: usize,
    scene: SceneRuntime,
    last_visual_cue: LastVisualCue,
    inventory: Inventory,
    story_state: StoryState,
    next_queue_gen: u64,
    history: DialogueHistory,
    durable_revision: u64,
    pending_acquisition_events: Vec<AcquisitionEventStateV1>,
}

pub(super) enum CommandMutation {
    Changed,
    Unchanged,
}

impl EngineRollbackSnapshot {
    pub(in crate::game) fn capture(engine: &GameEngine) -> Self {
        // Exhaustive destructuring, no `..`: a field added to GameEngine fails
        // to compile here until it is classified as rollback-tracked or as
        // immutable-after-load.
        let GameEngine {
            resources_dir: _,
            content_manifest: _,
            chapters: _,
            story_catalog: _,
            story_locations: _immutable_story_locations,
            story_state,
            current_chapter_idx,
            current_scene_idx,
            scene,
            last_visual_cue,
            inventory,
            next_queue_gen,
            history,
            durable_revision,
            pending_acquisition_events,
            cached_pending_acquisition_scene: _,
        } = engine;
        Self {
            current_chapter_idx: *current_chapter_idx,
            current_scene_idx: *current_scene_idx,
            scene: scene.clone(),
            last_visual_cue: last_visual_cue.clone(),
            inventory: inventory.clone(),
            story_state: story_state.clone(),
            next_queue_gen: *next_queue_gen,
            history: history.clone(),
            durable_revision: *durable_revision,
            pending_acquisition_events: pending_acquisition_events.clone(),
        }
    }

    pub(in crate::game) fn restore(engine: &mut GameEngine, snapshot: EngineRollbackSnapshot) {
        // Exhaustive destructuring by value, no `..`: a field added to the
        // snapshot must be named here, and an unused binding is an error under
        // clippy's -D warnings, so it cannot be named and silently dropped.
        let EngineRollbackSnapshot {
            current_chapter_idx,
            current_scene_idx,
            scene,
            last_visual_cue,
            inventory,
            story_state,
            next_queue_gen,
            history,
            durable_revision,
            pending_acquisition_events,
        } = snapshot;
        engine.current_chapter_idx = current_chapter_idx;
        engine.current_scene_idx = current_scene_idx;
        engine.scene = scene;
        engine.last_visual_cue = last_visual_cue;
        engine.inventory = inventory;
        engine.story_state = story_state;
        engine.next_queue_gen = next_queue_gen;
        engine.history = history;
        engine.durable_revision = durable_revision;
        engine.pending_acquisition_events = pending_acquisition_events;
    }

    fn matches_engine(&self, engine: &GameEngine) -> bool {
        self.current_chapter_idx == engine.current_chapter_idx
            && self.current_scene_idx == engine.current_scene_idx
            && format!("{:?}", self.scene) == format!("{:?}", engine.scene)
            && format!("{:?}", self.last_visual_cue) == format!("{:?}", engine.last_visual_cue)
            && format!("{:?}", self.inventory) == format!("{:?}", engine.inventory)
            && self.story_state == engine.story_state
            && self.next_queue_gen == engine.next_queue_gen
            && format!("{:?}", self.history) == format!("{:?}", engine.history)
            && self.durable_revision == engine.durable_revision
            && self.pending_acquisition_events == engine.pending_acquisition_events
    }
}

impl GameEngine {
    /// Snapshot → run → restore on error. Returns the closure's value on
    /// success. Builds no view and records no history; use `command_tx` for
    /// command paths.
    ///
    /// Nesting is safe: an inner restore followed by an outer restore lands on
    /// the outer snapshot, which is what `advance_scene` running inside a
    /// command's transaction already relied on before this seam existed.
    pub(super) fn rollback_scope<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, GameError>,
    ) -> Result<T, GameError> {
        let snapshot = EngineRollbackSnapshot::capture(self);
        match f(self) {
            Ok(value) => Ok(value),
            Err(err) => {
                EngineRollbackSnapshot::restore(self, snapshot);
                Err(err)
            }
        }
    }

    /// The command seam. Runs `f` under rollback, then finalizes dialogue
    /// history and builds the view for state-changing commands.
    ///
    /// The closure returns an explicit mutation outcome, so no command can
    /// produce a `GameStateView` from inside a transaction without history
    /// being recorded first. Note
    /// the limit of that guarantee: `GameEngine::view` is `pub` (lib.rs needs
    /// it), so a command that bypasses `command_tx` entirely can still skip
    /// history. The source-contract test in mod.rs covers that residual gap.
    pub(super) fn command_tx(
        &mut self,
        f: impl FnOnce(&mut Self, u64, &mut u32) -> Result<CommandMutation, GameError>,
    ) -> Result<GameStateView, GameError> {
        let snapshot = EngineRollbackSnapshot::capture(self);
        let command_id = self
            .durable_revision
            .checked_add(1)
            .ok_or_else(|| GameError::internal("durable revision overflow".into()))?;
        let mut next_ordinal = 0;
        match f(self, command_id, &mut next_ordinal) {
            Ok(CommandMutation::Changed) => {
                self.record_current_dialogue_history();
                self.durable_revision = command_id;
                match self.view() {
                    Ok(view) => Ok(view),
                    Err(error) => {
                        EngineRollbackSnapshot::restore(self, snapshot);
                        Err(error)
                    }
                }
            }
            Ok(CommandMutation::Unchanged) => {
                let was_unchanged = snapshot.matches_engine(self);
                EngineRollbackSnapshot::restore(self, snapshot);
                if was_unchanged {
                    self.view()
                } else {
                    Err(GameError::internal(
                        "unchanged command mutated rollback-tracked state".into(),
                    ))
                }
            }
            Err(error) => {
                EngineRollbackSnapshot::restore(self, snapshot);
                Err(error)
            }
        }
    }
}

// Must stay below all production `pub fn`s in this file: the
// every_view_returning_command_routes_through_command_tx scanner stops at the
// first #[cfg(test)] line.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{
        EvidenceJson, HotspotJson, InvestigationSceneJson, LockStatus, OutroJson, OutroUnlock,
        RevealTarget, SceneType, SublocationJson, UnlockExpr,
    };
    use crate::game::state::{EvidenceRecord, SceneRef, StatementRecord};
    use crate::game::test_support::*;
    use crate::game::*;

    fn acquisition_event(
        record_kind: crate::game::save::schema::RecordKind,
        record_id: &str,
        command_id: u64,
        ordinal: u32,
    ) -> crate::game::save::schema::AcquisitionEventStateV1 {
        crate::game::save::schema::AcquisitionEventStateV1 {
            id: format!("acq:{command_id}:{ordinal}"),
            record_kind,
            record_id: record_id.into(),
            created_by_command_id: command_id,
            ordinal,
        }
    }

    fn mutable_evidence_record(id: &str) -> EvidenceRecord {
        EvidenceRecord {
            id: id.into(),
            name: "Mutable inventory name".into(),
            description: "Mutable inventory description".into(),
            details: "Mutable inventory details".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "investigation_scene_1".into(),
        }
    }

    fn mutable_statement_record(id: &str) -> StatementRecord {
        StatementRecord {
            id: id.into(),
            speaker: "Mutable inventory speaker".into(),
            content: "Mutable inventory content".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            on_reexamine: None,
            acquired_in_chapter_id: "chapter_1".into(),
            acquired_in_scene_id: "investigation_scene_1".into(),
        }
    }

    fn clear_active_fixture_dialogue(engine: &mut GameEngine) {
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!("expected investigation fixture");
        };
        scene.pending_queue = None;
    }

    // Break caught: a successful state-changing command that does not commit
    // its first durable revision (or derives a command id from another source).
    #[test]
    fn changed_command_commits_first_durable_revision() {
        let mut engine =
            empty_engine_with_scene(investigation_scene_with_intro("scene_1", vec![]), 1);

        engine
            .command_tx(|_engine, command_id, _next_ordinal| {
                assert_eq!(command_id, 1);
                Ok(CommandMutation::Changed)
            })
            .unwrap();

        assert_eq!(engine.durable_revision, 1);
    }

    // Break caught: command ids are reused after one successful command
    // instead of advancing exactly once per committed public command.
    #[test]
    fn consecutive_changed_commands_increment_durable_revision_once_each() {
        let resources = dialogue_history_fixture_resources(3);
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();

        let first_token = token_from(&engine.view().unwrap());
        let first = engine.advance_dialogue(first_token).unwrap();
        assert_eq!(engine.durable_revision, 1);

        let second = engine.advance_dialogue(token_from(&first)).unwrap();
        assert_eq!(engine.durable_revision, 2);
        assert_eq!(second.dialogue_history.len(), 3);

        let _ = std::fs::remove_dir_all(resources);
    }

    // Break caught: replaying a real stale queue token consumes a revision or
    // disturbs durable history/event state on the public command path.
    #[test]
    fn stale_dialogue_token_leaves_revision_history_and_events_untouched() {
        let resources = dialogue_history_fixture_resources(3);
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        let stale_token = token_from(&engine.view().unwrap());

        engine.advance_dialogue(stale_token.clone()).unwrap();
        let revision_before = engine.durable_revision;
        let history_before = serde_json::to_vec(engine.history.entries()).unwrap();
        let events_before = serde_json::to_vec(&engine.pending_acquisition_events).unwrap();

        engine.advance_dialogue(stale_token).unwrap();

        assert_eq!(engine.durable_revision, revision_before);
        assert_eq!(
            serde_json::to_vec(engine.history.entries()).unwrap(),
            history_before
        );
        assert_eq!(
            serde_json::to_vec(&engine.pending_acquisition_events).unwrap(),
            events_before
        );

        let _ = std::fs::remove_dir_all(resources);
    }

    // Break caught: the explicit successful no-op branch consumes a revision
    // or changes rollback-tracked durable state even when its closure is pure.
    #[test]
    fn explicit_unchanged_command_keeps_revision_history_and_events() {
        let mut engine =
            empty_engine_with_scene(investigation_scene_with_intro("scene_1", vec![]), 1);
        engine.durable_revision = 4;
        let history_before = serde_json::to_vec(engine.history.entries()).unwrap();
        let events_before = serde_json::to_vec(&engine.pending_acquisition_events).unwrap();

        engine
            .command_tx(|_engine, command_id, _next_ordinal| {
                assert_eq!(command_id, 5);
                Ok(CommandMutation::Unchanged)
            })
            .unwrap();

        assert_eq!(engine.durable_revision, 4);
        assert_eq!(
            serde_json::to_vec(engine.history.entries()).unwrap(),
            history_before
        );
        assert_eq!(
            serde_json::to_vec(&engine.pending_acquisition_events).unwrap(),
            events_before
        );
    }

    // Break caught: a state/read helper accidentally routes through the
    // command seam and advances the durable revision.
    #[test]
    fn read_only_state_helpers_do_not_increment_durable_revision() {
        let resources = dialogue_history_fixture_resources(2);
        let engine = GameEngine::new_started(resources.clone()).unwrap();

        let revision_before = engine.durable_revision;
        let _ = engine.view().unwrap();
        let _ = engine.pending_acquisition_view().unwrap();
        let _ = engine.current_queue_token();
        assert_eq!(engine.durable_revision, revision_before);

        let _ = std::fs::remove_dir_all(resources);
    }

    // Break caught: an explicit non-mutating result leaks transaction-local
    // state into the live engine or consumes a durable revision.
    #[test]
    fn unchanged_command_restores_revision_history_and_events() {
        let mut engine =
            empty_engine_with_scene(investigation_scene_with_intro("scene_1", vec![]), 1);
        engine.durable_revision = 4;
        engine.pending_acquisition_events.push(
            crate::game::save::schema::AcquisitionEventStateV1 {
                id: "acq:4:0".into(),
                record_kind: crate::game::save::schema::RecordKind::Evidence,
                record_id: "before".into(),
                created_by_command_id: 4,
                ordinal: 0,
            },
        );
        let before_history = engine.history.entries().to_vec();

        let error = engine
            .command_tx(|engine, command_id, _next_ordinal| {
                assert_eq!(command_id, 5);
                engine.durable_revision = 99;
                engine.pending_acquisition_events.clear();
                Ok(CommandMutation::Unchanged)
            })
            .unwrap_err();

        assert_eq!(error.code, "internalError");
        assert_eq!(engine.durable_revision, 4);
        assert_eq!(engine.pending_acquisition_events.len(), 1);
        assert_eq!(engine.history.entries(), before_history.as_slice());
    }

    // Break caught: acquisition presentation leaks over authored dialogue or
    // exposes insertion order instead of the earliest durable event.
    #[test]
    fn pending_acquisition_hides_during_dialogue_then_resolves_earliest_record() {
        use crate::game::save::schema::RecordKind;

        let (_guard, resources) = packaged_acquisition_fixture_resources();
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine.inventory.evidence = vec![mutable_evidence_record("receipt")];
        engine.pending_acquisition_events = vec![
            acquisition_event(RecordKind::Evidence, "receipt", 7, 1),
            acquisition_event(RecordKind::Evidence, "receipt", 7, 0),
        ];

        assert!(engine.pending_acquisition_view().unwrap().is_none());

        clear_active_fixture_dialogue(&mut engine);
        let pending = engine.pending_acquisition_view().unwrap().unwrap();
        assert_eq!(pending.id, "acq:7:0");
        assert_eq!(pending.title, "Packaged Receipt");
        assert_eq!(pending.image_asset_id.as_deref(), Some("evidence.receipt"));
    }

    // Break caught: pending presentation trusts mutable inventory display
    // fields instead of resolving the immutable definition identified by the
    // record's stored chapter/scene provenance.
    #[test]
    fn pending_acquisition_resolves_packaged_definitions_in_event_order() {
        use crate::game::save::schema::RecordKind;

        let (_guard, resources) = packaged_acquisition_fixture_resources();
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        clear_active_fixture_dialogue(&mut engine);
        engine.inventory.evidence = vec![
            mutable_evidence_record("receipt"),
            mutable_evidence_record("second_note"),
        ];
        engine.inventory.statements = vec![mutable_statement_record("alibi")];
        engine.pending_acquisition_events = vec![
            acquisition_event(RecordKind::Statement, "alibi", 8, 1),
            acquisition_event(RecordKind::Evidence, "second_note", 9, 0),
            acquisition_event(RecordKind::Evidence, "receipt", 8, 0),
        ];

        let first = engine.pending_acquisition_view().unwrap().unwrap();
        assert_eq!(first.id, "acq:8:0");
        assert_eq!(first.title, "Packaged Receipt");
        assert_eq!(first.description, "Packaged description");
        assert_eq!(first.details, "Packaged details");
        assert_eq!(first.image_asset_id.as_deref(), Some("evidence.receipt"));
        assert_eq!(
            engine.pending_acquisition_view().unwrap().unwrap().id,
            first.id,
            "presenting a pending acquisition must not acknowledge or consume it"
        );
        assert_eq!(engine.pending_acquisition_events.len(), 3);

        // Task 3 deliberately has no acknowledgement command. Remove the
        // displayed event as the later coordinator will, then verify ordering
        // advances to the next durable event rather than insertion order.
        engine
            .pending_acquisition_events
            .retain(|event| event.id != first.id);
        let second = engine.pending_acquisition_view().unwrap().unwrap();
        assert_eq!(second.id, "acq:8:1");
        assert_eq!(second.title, "Packaged Witness");
        assert_eq!(second.description, "Packaged alibi");
        assert_eq!(second.details, "Packaged alibi");

        engine
            .pending_acquisition_events
            .retain(|event| event.id != second.id);
        let third = engine.pending_acquisition_view().unwrap().unwrap();
        assert_eq!(third.id, "acq:9:0");
        assert_eq!(third.title, "Packaged Second Note");
    }

    // Break caught: an event can present an inventory copy whose ID exists
    // nowhere in packaged content, or whose packaged definition has another
    // record kind.
    #[test]
    fn pending_acquisition_rejects_missing_and_wrong_kind_definitions() {
        use crate::game::save::schema::RecordKind;

        let (_guard, resources) = packaged_acquisition_fixture_resources();
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        clear_active_fixture_dialogue(&mut engine);

        engine.inventory.evidence = vec![mutable_evidence_record("ghost")];
        engine.pending_acquisition_events =
            vec![acquisition_event(RecordKind::Evidence, "ghost", 3, 0)];
        let missing = engine.pending_acquisition_view().unwrap_err();
        assert_eq!(missing.code, "missingAcquisitionDefinition");

        let mut wrong_provenance = mutable_evidence_record("receipt");
        wrong_provenance.collected_in_scene_id = "missing_scene".into();
        engine.inventory.evidence = vec![wrong_provenance];
        engine.pending_acquisition_events =
            vec![acquisition_event(RecordKind::Evidence, "receipt", 4, 0)];
        let provenance_error = engine.pending_acquisition_view().unwrap_err();
        assert_eq!(provenance_error.code, "missingAcquisitionDefinition");

        engine.inventory.evidence = vec![mutable_evidence_record("alibi")];
        engine.pending_acquisition_events =
            vec![acquisition_event(RecordKind::Evidence, "alibi", 5, 0)];
        let mismatch = engine.pending_acquisition_view().unwrap_err();
        assert_eq!(mismatch.code, "acquisitionDefinitionMismatch");
    }

    // Break caught: authored dialogue returns None before a malformed event is
    // validated, allowing corrupt live state to escape public error handling.
    #[test]
    fn malformed_pending_acquisition_errors_before_dialogue_hiding() {
        use crate::game::save::schema::RecordKind;

        let (_guard, resources) = packaged_acquisition_fixture_resources();
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine.inventory.evidence = vec![mutable_evidence_record("receipt")];
        let mut malformed = acquisition_event(RecordKind::Evidence, "receipt", 2, 0);
        malformed.id = "malformed".into();
        engine.pending_acquisition_events = vec![malformed];

        let error = engine.pending_acquisition_view().unwrap_err();
        assert_eq!(error.code, "unknownAcquisitionEvent");
    }

    // Break caught: the public state builder absorbs pending-event errors into
    // `pendingAcquisition: null`, preventing Tauri state commands from
    // returning the typed engine error.
    #[test]
    fn public_view_propagates_malformed_and_unknown_pending_events() {
        use crate::game::save::schema::RecordKind;

        let (_guard, resources) = packaged_acquisition_fixture_resources();
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine.inventory.evidence = vec![mutable_evidence_record("receipt")];
        let mut malformed = acquisition_event(RecordKind::Evidence, "receipt", 2, 0);
        malformed.id = "malformed".into();
        engine.pending_acquisition_events = vec![malformed];

        let malformed_error = engine.view().unwrap_err();
        assert_eq!(malformed_error.code, "unknownAcquisitionEvent");

        clear_active_fixture_dialogue(&mut engine);
        engine.inventory.evidence.clear();
        engine.pending_acquisition_events =
            vec![acquisition_event(RecordKind::Evidence, "receipt", 3, 0)];
        let unknown_error = engine.view().unwrap_err();
        assert_eq!(unknown_error.code, "unknownAcquisitionEvent");
    }

    #[test]
    fn reexamine_evidence_rolls_back_tag_only_queue_when_scene_advance_fails() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-reexamine-evidence-rollback-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_2.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_2",
                "title": "Wrong Type",
                "summary": "Fixture scene summary.",
                "queue": []
            }"#,
        )
        .unwrap();

        let inventory = Inventory {
            evidence: vec![EvidenceRecord {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_reexamine: Some(vec![DialogueItem::SceneTag {
                    text: "tag_only".into(),
                    asset_cue: None,
                }]),
                collected_in_chapter_id: "chapter_1".into(),
                collected_in_scene_id: "interrogation_scene_1".into(),
            }],
            statements: vec![],
        };
        let mut engine = completed_interrogation_engine_with_bad_next_scene(d.clone(), inventory);
        // Seed non-empty dialogue history so the rollback assertion below can
        // distinguish "restored to non-empty" from "nothing to restore" — the
        // fixture starts with empty history. Companion to navigation.rs
        // `jump_to_scene_restores_non_empty_dialogue_history_when_priming_fails`.
        let seed_token_a = QueueToken {
            scene_id: "interrogation_scene_1".into(),
            queue_gen: 1,
            cursor: 0,
        };
        let seed_token_b = QueueToken {
            scene_id: "interrogation_scene_1".into(),
            queue_gen: 1,
            cursor: 1,
        };
        engine.history.record(
            seed_token_a,
            DialogueItem::Line {
                speaker: "偵探".into(),
                text: "先前的對話紀錄 A".into(),
                portrait: None,
            },
            "Chapter 1".into(),
            "Interrogation".into(),
        );
        engine.history.record(
            seed_token_b,
            DialogueItem::Line {
                speaker: "偵探".into(),
                text: "先前的對話紀錄 B".into(),
                portrait: None,
            },
            "Chapter 1".into(),
            "Interrogation".into(),
        );
        let pre_reexamine_history = engine.history.entries().to_vec();
        assert_eq!(
            pre_reexamine_history.len(),
            2,
            "history seed must take before the failing reexamine"
        );
        let previous_scene_tag = engine.last_visual_cue.scene_tag.clone();
        let previous_next_queue_gen = engine.next_queue_gen;

        let err = engine.reexamine_evidence("note").unwrap_err();

        assert_eq!(err.code, "sceneValidationFailed");
        assert_eq!(engine.current_scene_idx, 0);
        assert_eq!(engine.last_visual_cue.scene_tag, previous_scene_tag);
        assert_eq!(engine.next_queue_gen, previous_next_queue_gen);
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene after rollback");
        };
        assert!(scene.pending_queue.is_none());
        // Snapshot rollback must restore dialogue history after a failed
        // advance path (design spec: dialogue-history-design.md "Testing").
        // The fixture is seeded with non-empty history above, so this asserts
        // the entries are restored verbatim — not merely that history is empty
        // either way (the vacuous case the original assertion could not
        // distinguish from a real restore).
        assert_eq!(
            engine.history.entries(),
            pre_reexamine_history.as_slice(),
            "dialogue history must be restored to its pre-command state after rollback, got {:?}",
            engine.history.entries()
        );
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn reexamine_statement_rolls_back_tag_only_queue_when_scene_advance_fails() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-reexamine-statement-rollback-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_2.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_2",
                "title": "Wrong Type",
                "summary": "Fixture scene summary.",
                "queue": []
            }"#,
        )
        .unwrap();

        let inventory = Inventory {
            evidence: vec![],
            statements: vec![StatementRecord {
                id: "alibi".into(),
                speaker: "Witness".into(),
                content: "Alibi".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                on_reexamine: Some(vec![DialogueItem::SceneTag {
                    text: "tag_only".into(),
                    asset_cue: None,
                }]),
                acquired_in_chapter_id: "chapter_1".into(),
                acquired_in_scene_id: "interrogation_scene_1".into(),
            }],
        };
        let mut engine = completed_interrogation_engine_with_bad_next_scene(d.clone(), inventory);
        // Seed non-empty dialogue history so the rollback assertion below can
        // distinguish "restored to non-empty" from "nothing to restore" — the
        // fixture starts with empty history. Companion to navigation.rs
        // `jump_to_scene_restores_non_empty_dialogue_history_when_priming_fails`.
        let seed_token_a = QueueToken {
            scene_id: "interrogation_scene_1".into(),
            queue_gen: 1,
            cursor: 0,
        };
        let seed_token_b = QueueToken {
            scene_id: "interrogation_scene_1".into(),
            queue_gen: 1,
            cursor: 1,
        };
        engine.history.record(
            seed_token_a,
            DialogueItem::Line {
                speaker: "偵探".into(),
                text: "先前的對話紀錄 A".into(),
                portrait: None,
            },
            "Chapter 1".into(),
            "Interrogation".into(),
        );
        engine.history.record(
            seed_token_b,
            DialogueItem::Line {
                speaker: "偵探".into(),
                text: "先前的對話紀錄 B".into(),
                portrait: None,
            },
            "Chapter 1".into(),
            "Interrogation".into(),
        );
        let pre_reexamine_history = engine.history.entries().to_vec();
        assert_eq!(
            pre_reexamine_history.len(),
            2,
            "history seed must take before the failing reexamine"
        );
        let previous_scene_tag = engine.last_visual_cue.scene_tag.clone();
        let previous_next_queue_gen = engine.next_queue_gen;

        let err = engine.reexamine_statement("alibi").unwrap_err();

        assert_eq!(err.code, "sceneValidationFailed");
        assert_eq!(engine.current_scene_idx, 0);
        assert_eq!(engine.last_visual_cue.scene_tag, previous_scene_tag);
        assert_eq!(engine.next_queue_gen, previous_next_queue_gen);
        let SceneRuntime::Interrogation(scene) = &engine.scene else {
            panic!("expected interrogation scene after rollback");
        };
        assert!(scene.pending_queue.is_none());
        // Snapshot rollback must restore dialogue history after a failed
        // advance path (design spec: dialogue-history-design.md "Testing").
        // The fixture is seeded with non-empty history above, so this asserts
        // the entries are restored verbatim — not merely that history is empty
        // either way (the vacuous case the original assertion could not
        // distinguish from a real restore).
        assert_eq!(
            engine.history.entries(),
            pre_reexamine_history.as_slice(),
            "dialogue history must be restored to its pre-command state after rollback, got {:?}",
            engine.history.entries()
        );
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn startup_rejects_invalid_future_scene_before_tag_only_transition() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d =
            std::env::temp_dir().join(format!("lyra-advance-test-{}-{}", std::process::id(), n));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        write_empty_story_catalog_and_content_manifest(&d);
        fs::write(
            d.join("chapters.json"),
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter 1",
                    "summary": "Summary",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" },
                        { "type": "linear", "file": "chapter_1/scene_tag_only.json" },
                        { "type": "interrogation", "file": "chapter_1/interrogation_scene_1.json" }
                    ]
                }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("scene_0.json"),
            r#"{
                "type": "linear",
                "id": "scene_0",
                "title": "Opening",
                "summary": "Fixture scene summary.",
                "queue": [{ "kind": "line", "speaker": "A", "text": "before" }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("scene_tag_only.json"),
            r#"{
                "type": "linear",
                "id": "scene_tag_only",
                "title": "Silent transition",
                "summary": "Fixture scene summary.",
                "queue": [{ "kind": "sceneTag", "text": "transition" }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_1",
                "title": "Wrong Type",
                "summary": "Fixture scene summary.",
                "queue": []
            }"#,
        )
        .unwrap();

        let err = GameEngine::new_started(d.clone())
            .err()
            .expect("startup must reject an invalid future scene");
        assert_eq!(err.code, "sceneValidationFailed");
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn startup_rejects_invalid_future_scene_before_silent_investigation_transition() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-initial-transition-rollback-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        write_empty_story_catalog_and_content_manifest(&d);
        write_neutral_story_catalog(&d, &[("note", "chapter_1", "investigation_scene_1")], &[]);
        fs::write(
            d.join("chapters.json"),
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter 1",
                    "summary": "Summary",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" },
                        { "type": "investigation", "file": "chapter_1/investigation_scene_1.json" },
                        { "type": "interrogation", "file": "chapter_1/interrogation_scene_1.json" }
                    ]
                }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("scene_0.json"),
            r#"{
                "type": "linear",
                "id": "scene_0",
                "title": "Opening",
                "summary": "Fixture scene summary.",
                "queue": [{ "kind": "line", "speaker": "A", "text": "before" }]
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("investigation_scene_1.json"),
            r#"{
                "type": "investigation",
                "id": "investigation_scene_1",
                "title": "Investigation",
                "summary": "Fixture scene summary.",
                "intro": [],
                "sublocations": [{
                    "id": "room",
                    "label": "Room",
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [{ "kind": "evidence", "id": "note" }],
                    "sceneTag": "room",
                    "transitionDialogue": [],
                    "hotspots": [],
                    "characters": []
                }],
                "evidenceManifest": [{
                    "id": "note",
                    "name": "Note",
                    "description": "Note",
                    "details": "Note",
                    "onCollect": [],
                    "onReexamine": null
                }],
                "statementManifest": [],
                "outro": {
                    "unlock": { "predicate": "evidence_collected", "id": "note" },
                    "dialogue": []
                }
            }"#,
        )
        .unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_1",
                "title": "Wrong Type",
                "summary": "Fixture scene summary.",
                "queue": []
            }"#,
        )
        .unwrap();

        let err = GameEngine::new_started(d.clone())
            .err()
            .expect("startup must reject an invalid future scene");
        assert_eq!(err.code, "sceneValidationFailed");
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn failed_investigation_intro_completion_rolls_back_inventory() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-intro-rollback-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_1",
                "title": "Wrong Type",
                "summary": "Fixture scene summary.",
                "queue": []
            }"#,
        )
        .unwrap();

        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            summary: "Summary".into(),
            asset_refs: vec![],
            intro: vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "intro".into(),
                portrait: None,
            }],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![RevealTarget::Evidence { id: "note".into() }],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                transition_dialogue: vec![],
                hotspots: vec![],
                characters: vec![],
            }],
            evidence_manifest: vec![EvidenceJson {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            }],
            statement_manifest: vec![],
            outro: OutroJson {
                unlock: OutroUnlock::Expr(UnlockExpr::EvidenceCollected {
                    _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                    id: "note".into(),
                }),
                dialogue: vec![],
            },
        };
        let story_catalog = catalog_with_case_records(
            vec![(
                "note",
                "chapter_1",
                "investigation_scene_1",
                crate::game::provenance::CaseRecordProvenance::default(),
            )],
            vec![],
        );
        let mut engine = GameEngine {
            resources_dir: d.clone(),
            content_manifest: test_content_manifest(),
            story_catalog,
            story_locations: crate::game::story_location::StoryLocationIndex::for_test_scenes(
                "chapter_1",
                "Chapter 1",
                [SceneJson::Investigation(scene.clone())],
            ),
            story_state: StoryState::default(),
            chapters: vec![ChapterManifest {
                id: "chapter_1".into(),
                title: "Chapter 1".into(),
                summary: "summary".into(),
                scenes: vec![
                    SceneRef {
                        scene_type: SceneType::Investigation,
                        file: "chapter_1/investigation_scene_1.json".into(),
                    },
                    SceneRef {
                        scene_type: SceneType::Interrogation,
                        file: "chapter_1/interrogation_scene_1.json".into(),
                    },
                ],
            }],
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: SceneRuntime::Investigation(Box::new(InvestigationSceneState::from_json(
                scene, 1,
            ))),
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            history: dialogue::DialogueHistory::default(),
            durable_revision: 0,
            pending_acquisition_events: Vec::new(),
            cached_pending_acquisition_scene: std::cell::RefCell::new(None),
        };
        engine.prime_initial_queue().unwrap();
        let token = token_from(&engine.view().unwrap());

        let err = engine.advance_dialogue(token).unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        assert!(engine.inventory.evidence.is_empty());
        assert_eq!(engine.current_chapter_idx, 0);
        assert_eq!(engine.current_scene_idx, 0);
        let view = engine.view().unwrap();
        match view.mode {
            ModeView::Dialogue { current, .. } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "A" && text == "intro")
                );
            }
            other => panic!("expected previous intro dialogue after failed advance, got {other:?}"),
        }
        match view.scene {
            SceneView::Investigation {
                id, index, total, ..
            } => {
                assert_eq!(id, "investigation_scene_1");
                assert_eq!(index, 0);
                assert_eq!(total, 2);
            }
            other => {
                panic!("expected previous investigation scene after failed advance, got {other:?}")
            }
        }

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn failed_silent_investigation_completion_rolls_back_action_state() {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-silent-action-rollback-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "linear",
                "id": "interrogation_scene_1",
                "title": "Wrong Type",
                "summary": "Fixture scene summary.",
                "queue": []
            }"#,
        )
        .unwrap();

        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
            summary: "Summary".into(),
            asset_refs: vec![],
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: crate::game::schema::VisualAssetCueJson::default(),
                transition_dialogue: vec![],
                hotspots: vec![HotspotJson {
                    id: "desk".into(),
                    label: "Desk".into(),
                    description: "Desk".into(),
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![RevealTarget::Evidence { id: "note".into() }],
                    layout: None,
                    inspect_dialogue: vec![],
                    on_reexamine: None,
                }],
                characters: vec![],
            }],
            evidence_manifest: vec![EvidenceJson {
                id: "note".into(),
                name: "Note".into(),
                description: "Note".into(),
                details: "Note".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            }],
            statement_manifest: vec![],
            outro: OutroJson {
                unlock: OutroUnlock::Expr(UnlockExpr::EvidenceCollected {
                    _predicate: crate::game::schema::PredicateEvidenceCollected::X,
                    id: "note".into(),
                }),
                dialogue: vec![],
            },
        };
        let story_catalog = catalog_with_case_records(
            vec![(
                "note",
                "chapter_1",
                "investigation_scene_1",
                crate::game::provenance::CaseRecordProvenance::default(),
            )],
            vec![],
        );
        let mut engine = GameEngine {
            resources_dir: d.clone(),
            content_manifest: test_content_manifest(),
            story_catalog,
            story_locations: crate::game::story_location::StoryLocationIndex::for_test_scenes(
                "chapter_1",
                "Chapter 1",
                [SceneJson::Investigation(scene.clone())],
            ),
            story_state: StoryState::default(),
            chapters: vec![ChapterManifest {
                id: "chapter_1".into(),
                title: "Chapter 1".into(),
                summary: "summary".into(),
                scenes: vec![
                    SceneRef {
                        scene_type: SceneType::Investigation,
                        file: "chapter_1/investigation_scene_1.json".into(),
                    },
                    SceneRef {
                        scene_type: SceneType::Interrogation,
                        file: "chapter_1/interrogation_scene_1.json".into(),
                    },
                ],
            }],
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: SceneRuntime::Investigation(Box::new(InvestigationSceneState::from_json(
                scene, 1,
            ))),
            last_visual_cue: LastVisualCue::default(),
            inventory: Inventory::default(),
            next_queue_gen: 2,
            history: dialogue::DialogueHistory::default(),
            durable_revision: 0,
            pending_acquisition_events: Vec::new(),
            cached_pending_acquisition_scene: std::cell::RefCell::new(None),
        };
        engine.prime_initial_queue().unwrap();
        let previous_scene_tag = engine.last_visual_cue.scene_tag.clone();
        let previous_next_queue_gen = engine.next_queue_gen;

        let err = engine.inspect_hotspot("desk").unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        assert_eq!(engine.current_chapter_idx, 0);
        assert_eq!(engine.current_scene_idx, 0);
        assert_eq!(engine.last_visual_cue.scene_tag, previous_scene_tag);
        assert_eq!(engine.next_queue_gen, previous_next_queue_gen);
        assert!(engine.inventory.evidence.is_empty());

        let SceneRuntime::Investigation(inv) = &engine.scene else {
            panic!("expected investigation scene after failed silent completion");
        };
        assert_eq!(inv.current_sublocation_id.as_deref(), Some("room"));
        assert!(inv.inspected_hotspots.is_empty());
        assert!(!inv.outro_played);

        let view = engine.view().unwrap();
        assert!(
            matches!(view.mode, ModeView::Explore { sublocation_id, .. } if sublocation_id == "room")
        );
        match view.scene {
            SceneView::Investigation {
                id, index, total, ..
            } => {
                assert_eq!(id, "investigation_scene_1");
                assert_eq!(index, 0);
                assert_eq!(total, 2);
            }
            other => {
                panic!("expected previous investigation scene after failed advance, got {other:?}")
            }
        }

        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn rollback_scope_restores_every_tracked_field_on_error() {
        let scene = investigation_scene_with_intro(
            "investigation_scene_1",
            vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "intro".into(),
                portrait: None,
            }],
        );
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.inventory.add_evidence_from_def(
            &EvidenceJson {
                id: "before".into(),
                name: "before".into(),
                description: "before".into(),
                details: "before".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            },
            "chapter_1",
            "investigation_scene_1",
        );
        let gen_before = engine.next_queue_gen;
        let evidence_before = engine.inventory.evidence.len();

        let result: Result<(), GameError> = engine.rollback_scope(|e| {
            e.next_queue_gen += 99;
            e.inventory.evidence.clear();
            e.current_scene_idx += 5;
            Err(GameError::internal("boom".into()))
        });

        assert!(result.is_err());
        assert_eq!(
            engine.next_queue_gen, gen_before,
            "next_queue_gen not restored"
        );
        assert_eq!(
            engine.inventory.evidence.len(),
            evidence_before,
            "inventory not restored"
        );
        assert_eq!(engine.current_scene_idx, 0, "scene index not restored");
    }

    // Break caught: a failed transaction restores legacy runtime fields but
    // loses a non-zero revision, pending events, inventory, or history bytes.
    #[test]
    fn failed_transaction_restores_nonzero_durable_fields_byte_for_byte() {
        use crate::game::save::schema::RecordKind;

        let mut engine =
            empty_engine_with_scene(investigation_scene_with_intro("scene_1", vec![]), 1);
        engine.durable_revision = 7;
        engine.inventory.evidence = vec![mutable_evidence_record("receipt")];
        engine.pending_acquisition_events =
            vec![acquisition_event(RecordKind::Evidence, "receipt", 7, 0)];
        engine.history.record(
            QueueToken {
                scene_id: "scene_1".into(),
                queue_gen: 1,
                cursor: 0,
            },
            DialogueItem::Action {
                text: "before".into(),
            },
            "Chapter 1".into(),
            "Scene 1".into(),
        );

        let revision_before = engine.durable_revision;
        let inventory_before = engine.inventory.clone();
        let events_before = serde_json::to_vec(&engine.pending_acquisition_events).unwrap();
        let history_before = serde_json::to_vec(engine.history.entries()).unwrap();

        let error = engine
            .command_tx(|engine, command_id, _next_ordinal| {
                assert_eq!(command_id, 8);
                engine.durable_revision = 99;
                engine.inventory.evidence.clear();
                engine.pending_acquisition_events.clear();
                engine.history.record(
                    QueueToken {
                        scene_id: "scene_1".into(),
                        queue_gen: 9,
                        cursor: 9,
                    },
                    DialogueItem::Action {
                        text: "mutated".into(),
                    },
                    "Mutated".into(),
                    "Mutated".into(),
                );
                Err(GameError::internal("forced rollback".into()))
            })
            .unwrap_err();

        assert_eq!(error.code, "internalError");
        assert_eq!(engine.durable_revision, revision_before);
        assert_eq!(engine.inventory, inventory_before);
        assert_eq!(
            serde_json::to_vec(&engine.pending_acquisition_events).unwrap(),
            events_before
        );
        assert_eq!(
            serde_json::to_vec(engine.history.entries()).unwrap(),
            history_before
        );
    }

    // Break caught: direct snapshot capture/restore omits the two durable
    // fields introduced for save/load command identity and notifications.
    #[test]
    fn rollback_snapshot_explicitly_restores_revision_and_pending_events() {
        use crate::game::save::schema::RecordKind;

        let mut engine =
            empty_engine_with_scene(investigation_scene_with_intro("scene_1", vec![]), 1);
        engine.durable_revision = 6;
        engine.pending_acquisition_events =
            vec![acquisition_event(RecordKind::Statement, "alibi", 6, 0)];
        let expected_events = engine.pending_acquisition_events.clone();
        let snapshot = EngineRollbackSnapshot::capture(&engine);

        engine.durable_revision = 44;
        engine.pending_acquisition_events.clear();
        EngineRollbackSnapshot::restore(&mut engine, snapshot);

        assert_eq!(engine.durable_revision, 6);
        assert_eq!(engine.pending_acquisition_events, expected_events);
    }

    #[test]
    fn rollback_scope_restores_story_state_and_filtered_view_on_error() {
        use crate::game::story::{AssertionOrigin, StoryState};

        let d = story_navigation_fixture_resources();
        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let snapshot_before = engine.story_state.snapshot();
        let view_before = serde_json::to_value(&engine.view().unwrap().story).unwrap();

        let result: Result<(), GameError> = engine.rollback_scope(|engine| {
            engine.story_state.assert_fact(
                &engine.story_catalog,
                "persistent_fact",
                AssertionOrigin::Migration {
                    migration_id: "failed_command".into(),
                },
                &[],
                &[],
            )?;
            Err(GameError::internal("forced rollback".into()))
        });

        assert!(result.is_err());
        assert_eq!(engine.story_state.snapshot(), snapshot_before);
        assert_eq!(
            serde_json::to_value(&engine.view().unwrap().story).unwrap(),
            view_before
        );
        assert_eq!(engine.story_state, StoryState::default());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn rollback_scope_keeps_mutations_on_success() {
        let scene = investigation_scene_with_intro("investigation_scene_1", vec![]);
        let mut engine = empty_engine_with_scene(scene, 1);
        let gen_before = engine.next_queue_gen;

        let result: Result<u64, GameError> = engine.rollback_scope(|e| {
            e.next_queue_gen += 7;
            Ok(e.next_queue_gen)
        });

        assert_eq!(result.unwrap(), gen_before + 7);
        assert_eq!(engine.next_queue_gen, gen_before + 7);
    }
}
