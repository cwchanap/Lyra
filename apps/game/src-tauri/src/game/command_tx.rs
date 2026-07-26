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
        f: impl FnOnce(&mut Self, u64) -> Result<CommandMutation, GameError>,
    ) -> Result<GameStateView, GameError> {
        let snapshot = EngineRollbackSnapshot::capture(self);
        let command_id = self
            .durable_revision
            .checked_add(1)
            .ok_or_else(|| GameError::internal("durable revision overflow".into()))?;
        match f(self, command_id) {
            Ok(CommandMutation::Changed) => {
                self.record_current_dialogue_history();
                self.durable_revision = command_id;
                if let Err(error) = self.pending_acquisition_view() {
                    EngineRollbackSnapshot::restore(self, snapshot);
                    return Err(error);
                }
                Ok(self.view())
            }
            Ok(CommandMutation::Unchanged) => {
                let was_unchanged = snapshot.matches_engine(self);
                EngineRollbackSnapshot::restore(self, snapshot);
                if was_unchanged {
                    Ok(self.view())
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

    // Break caught: a successful state-changing command that does not commit
    // its first durable revision (or derives a command id from another source).
    #[test]
    fn changed_command_commits_first_durable_revision() {
        let mut engine =
            empty_engine_with_scene(investigation_scene_with_intro("scene_1", vec![]), 1);

        engine
            .command_tx(|_engine, command_id| {
                assert_eq!(command_id, 1);
                Ok(CommandMutation::Changed)
            })
            .unwrap();

        assert_eq!(engine.durable_revision, 1);
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
            .command_tx(|engine, command_id| {
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
        let mut engine =
            empty_engine_with_scene(investigation_scene_with_intro("scene_1", vec![]), 1);
        engine.inventory.evidence.push(EvidenceRecord {
            id: "receipt".into(),
            name: "Receipt".into(),
            description: "A receipt".into(),
            details: "Timestamp 22:10".into(),
            image_asset_id: Some("evidence.receipt".into()),
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "scene_1".into(),
        });
        engine.pending_acquisition_events = vec![
            crate::game::save::schema::AcquisitionEventStateV1 {
                id: "acq:7:1".into(),
                record_kind: crate::game::save::schema::RecordKind::Evidence,
                record_id: "receipt".into(),
                created_by_command_id: 7,
                ordinal: 1,
            },
            crate::game::save::schema::AcquisitionEventStateV1 {
                id: "acq:7:0".into(),
                record_kind: crate::game::save::schema::RecordKind::Evidence,
                record_id: "receipt".into(),
                created_by_command_id: 7,
                ordinal: 0,
            },
        ];

        let pending = engine.pending_acquisition_view().unwrap().unwrap();
        assert_eq!(pending.id, "acq:7:0");
        assert_eq!(pending.title, "Receipt");
        assert_eq!(pending.image_asset_id.as_deref(), Some("evidence.receipt"));

        let mut dialogue_engine = empty_engine_with_scene(
            investigation_scene_with_intro(
                "scene_1",
                vec![DialogueItem::Action {
                    text: "authored".into(),
                }],
            ),
            1,
        );
        dialogue_engine.prime_initial_queue().unwrap();
        dialogue_engine.pending_acquisition_events = engine.pending_acquisition_events;
        dialogue_engine.inventory = engine.inventory;
        assert!(dialogue_engine
            .pending_acquisition_view()
            .unwrap()
            .is_none());
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
    fn failed_scene_advance_through_tag_only_prime_keeps_previous_dialogue_view() {
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
                "queue": []
            }"#,
        )
        .unwrap();

        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let before = engine.view();
        assert_eq!(history_labels(&before), vec!["A: before"]);
        let token = token_from(&before);
        let expected_token_after_rollback = token.clone();
        let err = engine.advance_dialogue(token).unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        let after = engine.view();
        assert_eq!(history_labels(&after), vec!["A: before"]);
        assert_eq!(token_from(&after), expected_token_after_rollback);
        match after.mode {
            ModeView::Dialogue { current, .. } => {
                assert!(
                    matches!(current, DialogueItem::Line { speaker, text, .. } if speaker == "A" && text == "before")
                );
            }
            other => panic!("expected previous dialogue mode after failed advance, got {other:?}"),
        }
        match after.scene {
            SceneView::Linear {
                id, index, total, ..
            } => {
                assert_eq!(id, "scene_0");
                assert_eq!(index, 0);
                assert_eq!(total, 3);
            }
            other => panic!("expected previous linear scene after failed advance, got {other:?}"),
        }
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn failed_initial_silent_investigation_transition_rolls_back_inventory() {
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
                "queue": []
            }"#,
        )
        .unwrap();

        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let token = token_from(&engine.view());

        let err = engine.advance_dialogue(token).unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        assert!(engine.inventory.evidence.is_empty());
        assert_eq!(engine.current_chapter_idx, 0);
        assert_eq!(engine.current_scene_idx, 0);
        match engine.view().scene {
            SceneView::Linear {
                id, index, total, ..
            } => {
                assert_eq!(id, "scene_0");
                assert_eq!(index, 0);
                assert_eq!(total, 3);
            }
            other => panic!("expected previous linear scene after failed advance, got {other:?}"),
        }

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
                "queue": []
            }"#,
        )
        .unwrap();

        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
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
        let mut engine = GameEngine {
            resources_dir: d.clone(),
            content_manifest: test_content_manifest(),
            story_catalog: StoryCatalog::empty(),
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
        };
        engine.prime_initial_queue().unwrap();
        let token = token_from(&engine.view());

        let err = engine.advance_dialogue(token).unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");

        assert!(engine.inventory.evidence.is_empty());
        assert_eq!(engine.current_chapter_idx, 0);
        assert_eq!(engine.current_scene_idx, 0);
        let view = engine.view();
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
                "queue": []
            }"#,
        )
        .unwrap();

        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Investigation".into(),
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
        let mut engine = GameEngine {
            resources_dir: d.clone(),
            content_manifest: test_content_manifest(),
            story_catalog: StoryCatalog::empty(),
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

        let view = engine.view();
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

    #[test]
    fn rollback_scope_restores_story_state_and_filtered_view_on_error() {
        use crate::game::story::{AssertionOrigin, StoryState};

        let d = story_navigation_fixture_resources();
        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let snapshot_before = engine.story_state.snapshot();
        let view_before = serde_json::to_value(&engine.view().story).unwrap();

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
            serde_json::to_value(&engine.view().story).unwrap(),
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
