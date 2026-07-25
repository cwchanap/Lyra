# HPA-129 Save, Load, Autosave, and Continue Design

**Status:** Approved in conversation  
**Issue:** HPA-129 — Save/load, autosave, and Continue  
**Date:** 2026-07-25

## 1. References and scope

This focused design refines:

- `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md`
  §§7.4 and 16;
- `docs/superpowers/plans/2026-07-19-detective-gameplay-systems-implementation-plan.md`
  epic P0.4;
- the HPA-55 command-transaction, dialogue, navigation, and acquisition
  attachment seams now present under `apps/game/src-tauri/src/game/`;
- the HPA-255 global story catalog and durable story state now present under
  `apps/game/src-tauri/src/game/story/`.

HPA-129 makes current Lyra sessions safe to leave and resume. It delivers:

- a versioned, Rust-owned persistent save contract;
- exact capture and transactional restoration for every current runtime;
- ordered, definition-backed dialogue segments;
- Rust-owned durable acquisition acknowledgement;
- five visible rotating autosaves;
- three visible manual slots with overwrite confirmation;
- title-screen Continue and Load Game;
- in-game Save/Load and Return to Title;
- explicit second-confirmation escape paths when persistence is unavailable;
- explicit schema and content migrations;
- atomic storage and actionable compatibility diagnostics;
- a P0-owned generic resumable-state fixture that does not depend on the
  analysis runtime.

This design deliberately refines two requirements from the parent design and
the current Linear issue:

1. Five visible rotating autosaves replace the original one current autosave
   plus one hidden backup.
2. Continue targets the newest written save only. If that file is corrupt or
   incompatible, Continue stops with a diagnostic and directs the player to
   Load Game. It does not silently select an older save.

The user approved both refinements during HPA-129 design.

## 2. Approved product decisions

1. Rust owns schemas, capture, restoration, migrations, storage, autosave
   scheduling, acquisition events, and compatibility checks.
2. Svelte owns presentation, confirmation, focus, and command orchestration
   only.
3. Five autosaves and three manual slots are visible in Load Game.
4. There is no hidden autosave backup.
5. Continue chooses the newest written save across autosaves and manual slots.
6. An invalid newest file blocks Continue; the player may choose an older valid
   file through Load Game.
7. Manual Save/Load is available through the in-game Escape menu.
8. Load Game is available beside Continue on the title screen.
9. Loading from the title screen is immediate.
10. Loading from an active game requires confirmation.
11. Manual-slot overwrite and save deletion require confirmation.
12. New Game starts without warning even when autosaves exist. Its first
    autosave joins normal rotation; manual slots are untouched.
13. Return to Title flushes pending autosave work and clears the live engine.
14. Audio preferences stay in their existing independent settings store.
15. Saving stores stable IDs and mutable state, not copies of authored prose or
    definitions.
16. Invalid files remain on disk until the player deletes them or normal,
    deliberate slot replacement overwrites them.
17. A failed durability action first offers Retry/Cancel. Load, Return to
    Title, acquisition-popup dismissal, and New Game after global discovery
    failure may then proceed without saving only after a second explicit
    data-loss confirmation.
18. Persistence health is application/session state exposed separately from
    engine-owned `GameStateView`.

## 3. Current constraints

### 3.1 Runtime

The current Rust runtime:

- owns one optional `GameEngine` behind `AppState.engine`;
- creates a fresh game through `GameEngine::new_started`;
- centralizes successful gameplay mutations through `command_tx`;
- rolls failed commands back through `EngineRollbackSnapshot`;
- owns immutable chapter, scene, and story-catalog definitions loaded from
  packaged Tauri resources;
- owns mutable chapter/scene position, scene runtime, visual/audio cues,
  inventory, story state, queue generation, and dialogue history;
- represents linear dialogue as one flat queue and investigation/interrogation
  dialogue as an optional flat `DialogueQueue`;
- exposes stale-action protection through `QueueToken`;
- has no persistent save schema, disk storage, content migrations, or
  Rust-owned acquisition-event collection.

`EngineRollbackSnapshot` remains the exhaustive in-memory rollback clone. It is
not serialized and is not the persistent save format.

### 3.2 Frontend

The current Svelte frontend:

- switches between title and gameplay presentation;
- already has a title-screen Continue callback surface;
- owns the Escape-menu panel stack;
- infers acquisition notifications by diffing public inventory views;
- keeps transient presentation state such as open menus, dialogue history,
  popup focus, and audio controllers outside Rust.

HPA-129 removes inventory-diff inference for acquisition acknowledgement but
does not move transient visual animation state into Rust.

### 3.3 Packaged-content boundary

Tauri production builds load generated scene and catalog JSON from resources.
Saves live under the platform application-data directory. They never live
under generated resources and are never included in bundles or commits.

## 4. Ownership and module boundaries

Add a focused Rust persistence subsystem:

```text
apps/game/src-tauri/src/game/save/
  mod.rs
  schema.rs
  capture.rs
  restore.rs
  migrations.rs
  storage.rs
  coordinator.rs
```

Responsibilities:

| Module | Responsibility |
| --- | --- |
| `schema.rs` | Serializable envelope, snapshot, slot metadata, definition references, dialogue origins, acquisition events, and typed load diagnostics |
| `capture.rs` | Convert one stable committed `GameEngine` into a persistent snapshot containing IDs and mutable progress |
| `restore.rs` | Resolve current packaged definitions, validate dependencies, reconstruct a complete candidate engine, and return it without touching the live engine |
| `migrations.rs` | Sequential save-schema migrations and explicit content/definition migrations |
| `storage.rs` | App-data paths, discovery, five-autosave rotation, three manual slots, atomic writes, reads, and deletion |
| `coordinator.rs` | Debounced autosave scheduling, durable-revision tracking, flushes, write serialization, and save-health state |

`GameEngine` remains the gameplay authority. The save subsystem may use
crate-private capture/restore accessors, but it does not expose authored
definitions through the IPC layer.

`AppState` becomes one coherent session aggregate rather than unrelated locks:

```rust
struct AppState {
    session: Mutex<AppSession>,
}

struct AppSession {
    engine: Option<GameEngine>,
    persistence: SaveCoordinator,
}
```

The exact synchronization primitive may be refined during planning, but the
invariant is fixed: engine replacement, session-generation changes, and
autosave scheduling share one ordering boundary. No timer may write a snapshot
from a session that has already returned to title, started a new game, or
loaded another save.

## 5. Compiled content identity

### 5.1 Hash ownership

The scene compiler owns definition hashes because it already owns the canonical
generated wire representations. Runtime code must not try to reproduce hashes
from authored Markdown or filesystem paths.

The compiler emits:

- one bundle-level `contentRevision`;
- one `definitionHash` for every resumable scene and dialogue segment;
- individual hashes for story definitions that can remain active or
  incomplete across a save.

Hashes use SHA-256 over deterministic canonical JSON and are encoded as
`sha256:<lowercase hex>`. Canonicalization:

- sorts object keys recursively;
- preserves array order where order is semantic;
- excludes source locations, absolute paths, generated timestamps, and the
  hash field itself;
- uses the generated semantic wire values, including authored dialogue, rather
  than raw Markdown bytes.

Repeated compilation of semantically identical inputs produces identical
hashes and the same bundle revision.

Canonical hashing is the highest-risk compiler portion of HPA-129. The current
TypeScript emitter primarily builds plain objects and arrays, while some
compiler-only indexes use `Map`/`Set` and the Rust loader later builds
`HashMap` indexes. Hash input must be restricted to the emitted semantic JSON
boundary: compiler-only indexes are normalized into explicitly sorted arrays
or excluded, and Rust lookup-map iteration never participates. One shared
canonical serializer must produce both per-definition hashes and the bundle
revision; feature code must not hand-roll local `JSON.stringify` hash paths.
The implementation plan schedules this canonicalizer and determinism fixtures
before runtime save work depends on the hashes.

### 5.2 Bundle revision versus required definitions

`contentRevision` identifies the entire packaged story bundle, but a changed
bundle revision does not automatically invalidate every save. The loader
validates the concrete definition dependencies recorded by the snapshot.

Examples:

- changing an unrelated future scene changes the bundle revision but does not
  reject a save whose dependencies still have matching hashes;
- changing an active dialogue segment rejects the load unless an explicit
  migration maps the old segment state;
- removing the current scene, an acquired required record, or an active
  objective rejects the load transactionally;
- completed historical state may survive only when an explicit migration or a
  dependency rule proves that no surviving mutable state depends on the
  changed definition.

The snapshot never treats matching IDs alone as compatibility proof.

## 6. Save envelope

The initial disk contract is schema version 1:

```rust
struct SaveEnvelopeV1 {
    schema_version: u32,
    content_revision: String,
    save_id: String,
    save_type: SaveType,
    slot: u8,
    saved_at: String,
    summary: SaveSummary,
    snapshot: SaveSnapshotV1,
}

enum SaveType {
    Auto,
    Manual,
}
```

`slot` is `1..=5` for autosaves and `1..=3` for manual saves. Slot identity
comes from the storage target as well as the envelope. A mismatch is a corrupt
file, not a request to load a different slot.

`save_id` identifies the logical saved checkpoint and is generated as a
cryptographically random UUID v4. It changes whenever any slot receives a new
snapshot and remains stable only when an explicit migration reads that same
checkpoint in memory. It is an optimistic-concurrency token, not an
authorization secret.

`saved_at` is one RFC 3339 UTC timestamp for the checkpoint. There is no
separate creation timestamp because every disk write creates a new checkpoint
and save ID. Filesystem write metadata determines Continue and rotation
ordering so even an unparseable newest file can block Continue correctly.

`SaveSummary` stores presentation metadata only:

```rust
struct SaveSummary {
    chapter_id: String,
    chapter_title: String,
    scene_id: String,
    scene_title: String,
    active_primary_objective_id: Option<String>,
    active_primary_objective_label: Option<String>,
}
```

Summary copy is not authoritative gameplay state. Restore derives gameplay
state from `snapshot`; summary mismatches are reported as corruption.

## 7. Persistent snapshot

`SaveSnapshotV1` stores all mutable authoritative state needed for exact
resume:

```rust
struct SaveSnapshotV1 {
    chapter_id: String,
    scene_id: String,
    scene: SceneProgressSnapshotV1,
    active_dialogue: Option<ActiveDialogueStateV1>,
    last_visual_cue: LastVisualCueSnapshotV1,
    inventory: InventorySnapshotV1,
    acquisition_events: Vec<AcquisitionEventStateV1>,
    story_state: StoryStateSnapshot,
    dialogue_history: DialogueHistorySnapshotV1,
    next_queue_gen: u64,
    next_command_id: u64,
    durable_revision: u64,
    dependencies: Vec<DefinitionDependencyV1>,
}
```

This is a conceptual field list; planning may group fields into nested structs
without changing their meaning.

Definition identity and dependency roles are closed, typed contracts:

```rust
enum DefinitionRefV1 {
    Scene {
        chapter_id: String,
        scene_id: String,
        scene_kind: SceneType,
    },
    DialogueSegment {
        origin: DialogueSegmentOriginV1,
    },
    InventoryRecord {
        record_kind: RecordKind,
        record_id: String,
    },
    Fact { id: String },
    Question { id: String },
    Objective { id: String },
    Authorization { id: String },
    #[cfg(test)]
    Fixture { id: String },
}

struct DefinitionIdentityV1 {
    reference: DefinitionRefV1,
    definition_hash: String,
}

enum DefinitionDependencyRoleV1 {
    CurrentScene,
    ActiveDialogue,
    InventoryRecord,
    ActiveStoryState,
    IncompleteStoryState,
    #[cfg(test)]
    GenericResumableState,
}

struct DefinitionDependencyV1 {
    definition: DefinitionIdentityV1,
    role: DefinitionDependencyRoleV1,
}
```

The typed reference is the migration key; `role` explains why the save still
depends on it and therefore which migration/drop rules are legal. Capture
deduplicates identical `(reference, role)` pairs and sorts dependencies by a
canonical reference order. Fixture variants exist only in Rust test builds and
are not part of the production version-1 wire contract.

### 7.1 Scene progress

`SceneProgressSnapshotV1` is a closed tagged enum:

```rust
enum SceneProgressSnapshotV1 {
    Linear {
        definition: DefinitionIdentityV1,
    },
    Investigation {
        definition: DefinitionIdentityV1,
        intro_played: bool,
        outro_played: bool,
        current_sublocation_id: Option<String>,
        inspected_hotspot_ids: Vec<String>,
        discussed_topic_ids: Vec<CharacterTopicRefV1>,
        entered_sublocation_ids: Vec<String>,
        unlocked_override_ids: Vec<String>,
    },
    Interrogation {
        definition: DefinitionIdentityV1,
        intro_played: bool,
        outro_played: bool,
        current_phase_id: Option<String>,
        cross_exam: CrossExamSnapshotV1,
        broken_question_ids: Vec<String>,
        completed_phase_ids: Vec<String>,
        unlocked_override_ids: Vec<String>,
        entered_phase_ids: Vec<String>,
        line_content_boundary: Option<DialogueCursorV1>,
    },
}

struct CharacterTopicRefV1 {
    character_id: String,
    topic_id: String,
}

struct DialogueCursorV1 {
    segment_index: usize,
    item_cursor: usize,
}

enum CrossExamSnapshotV1 {
    Idle,
    Playing {
        question_id: String,
        line_id: String,
    },
    Presenting {
        question_id: String,
        line_id: String,
    },
}
```

Definitions themselves remain packaged content. Capture serializes stable IDs,
sets, scalars, and progress only. Unordered runtime sets are sorted before
serialization for deterministic fixtures and diagnostics.

The current runtime's `CrossExam::Playing` stores a line array index. Persistent
state deliberately stores the stable line ID instead. Restore resolves that ID
to the current index only after the question/line definitions and hashes pass.
The line-content boundary uses segment/item coordinates rather than a flattened
queue offset and must agree with the reconstructed active queue.

The loader rejects:

- a missing chapter or scene;
- a scene whose current kind differs from the snapshot;
- unknown sublocations, hotspots, characters, topics, phases, questions,
  testimony lines, or override targets;
- mutually inconsistent progress, such as a cross-exam line outside its
  restored question;
- any active definition-hash mismatch without a migration.

### 7.2 Inventory and story state

Inventory snapshots store record kind, stable record ID, and mutable acquisition
metadata. They do not copy evidence/statement labels, descriptions, authored
dialogue, or asset paths.

Restore resolves each record through the current packaged catalog/scene
definitions and validates record kind. A missing record rejects the load.

HPA-255's `StoryStateSnapshot` remains the persistence payload for facts,
questions, objectives, and authorizations. Restore continues to use
`StoryState::from_snapshot`, so:

- all referenced definitions must exist;
- assertion/support origins remain typed;
- active-primary uniqueness remains structural;
- mutable state does not acquire copies of authored answer keys or prose.

Active or incomplete story definitions also appear in the snapshot dependency
list with their individual hashes.

### 7.3 Visual/audio cues and history

The snapshot stores the current semantic scene tag, background asset ID, and
audio cue IDs/state needed to produce the same public view after resume. It
does not store decoded media, filesystem paths, playback position, volume, or
mute preferences.

`last_visual_cue` is non-optional because the engine always owns
`LastVisualCue::default()`. Its snapshot mirrors that defaultable shape:

```rust
struct LastVisualCueSnapshotV1 {
    scene_tag: Option<String>,
    background_asset_id: Option<String>,
    bgm: Option<AudioCueSnapshotV1>,
    bgs: Option<AudioCueSnapshotV1>,
}
```

A fresh game therefore stores one empty/default cue object rather than omitting
the field.

Dialogue history stores the bounded Rust-owned transcript, its next entry ID,
and its last recorded queue token. The transcript is a deliberate narrow
exception to the general no-authored-prose rule: it is already-realized,
player-visible historical output, not a source used to reconstruct an active
queue or replay mutations. Keeping the rendered speaker/text/title copy
preserves the exact log the player saw even when later packaged copy changes.

Restoring the bounded entries, counter, and last token prevents duplicate
history entries on the first post-load view. Historical transcript copy is not
an active definition dependency and cannot affect authoritative gameplay.

## 8. Ordered dialogue segments

### 8.1 Runtime representation

Flat pending queues become one shared ordered representation:

```rust
struct ActiveDialogueQueue {
    segments: Vec<DialogueSegment>,
    active_segment_index: usize,
    item_cursor: usize,
    queue_gen: u64,
}

struct DialogueSegment {
    origin: DialogueSegmentOrigin,
    definition_hash: String,
    items: Vec<DialogueItem>,
}
```

A linear scene uses one segment. Investigation and interrogation commands may
install several ordered segments in one queue. Empty authored segments are
omitted before queue installation; a queue with no remaining items is `None`.

The public `QueueToken` may retain its existing flattened `cursor` for frontend
compatibility. Rust derives that cursor from the active segment and item cursor.
Persistent state always records both coordinates.

### 8.2 Stable origins

Version 1 supports current-runtime origins:

```rust
enum DialogueSegmentOriginV1 {
    LinearScene {
        chapter_id: String,
        scene_id: String,
    },
    InvestigationIntro {
        chapter_id: String,
        scene_id: String,
    },
    InvestigationOutro {
        chapter_id: String,
        scene_id: String,
    },
    InvestigationInteraction {
        chapter_id: String,
        scene_id: String,
        interaction_id: String,
        segment_id: String,
    },
    InterrogationIntro {
        chapter_id: String,
        scene_id: String,
    },
    InterrogationOutro {
        chapter_id: String,
        scene_id: String,
    },
    InterrogationPhase {
        chapter_id: String,
        scene_id: String,
        phase_id: String,
        segment_id: String,
    },
}
```

`segment_id` is derived by the compiler from existing stable semantic IDs and
the dialogue field's closed role. Writers do not author an additional segment
ID. Reordering siblings or inserting a new sibling therefore does not rename
existing segments.

Representative keys:

```text
linear:body
investigation:intro
investigation:outro
sublocation:<sublocationId>:transition
hotspot:<hotspotId>:inspect
hotspot:<hotspotId>:reexamine
topic:<characterId>:<topicId>:dialogue
topic:<characterId>:<topicId>:reexamine
evidence:<evidenceId>:onCollect
evidence:<evidenceId>:onReexamine
statement:<statementId>:onAcquire
statement:<statementId>:onReexamine
interrogation:intro
interrogation:outro
phase:<phaseId>:entry
question:<questionId>:onLoop
question:<questionId>:loopPrompt
question:<questionId>:defaultChallenge
question:<questionId>:defaultWrong
question:<questionId>:wrongReply
question:<questionId>:line:<lineId>:content
question:<questionId>:line:<lineId>:challenge
question:<questionId>:line:<lineId>:onCorrect
question:<questionId>:line:<lineId>:onWrongEvidence
```

The compiler owns one exhaustive mapping from each dialogue-bearing wire field
to its role key. Parent semantic IDs are already authoring-contract IDs;
existing compiler uniqueness checks keep their structural paths unambiguous.
The compiler rejects any derived-origin collision as an internal contract
error. `segment_id` is never a vector index and never depends on label or
dialogue copy.

Future analysis/story-event origins require new schema variants or migrations;
HPA-129 does not pre-implement those runtimes.

### 8.3 Capture and reconstruction

`ActiveDialogueStateV1` stores:

```rust
struct ActiveDialogueStateV1 {
    segments: Vec<DialogueSegmentIdentityV1>,
    active_segment_index: usize,
    item_cursor: usize,
    queue_gen: u64,
}

struct DialogueSegmentIdentityV1 {
    origin: DialogueSegmentOriginV1,
    definition_hash: String,
}
```

It does not store `items`.

Restore resolves every origin in order, verifies its current hash, rebuilds its
items, verifies cursor bounds, and then installs the reconstructed queue. It
does not replay reveals or inventory mutations to rebuild the queue.

This preserves composite ordering when several authored `onCollect`,
`onAcquire`, result, or reveal blocks were installed by one command.

## 9. Durable acquisition acknowledgement

### 9.1 State

Rust adds:

```rust
struct AcquisitionEventStateV1 {
    id: String,
    record_kind: RecordKind,
    record_id: String,
    created_by_command_id: u64,
    ordinal: u32,
    acknowledged: bool,
}
```

An event ID is derived from the committed command ID and acquisition ordinal.
One command acquiring several records produces distinct events in deterministic
order. Re-acquiring an already-owned record produces no event.

The command transaction allocates command IDs inside rollback-tracked state.
A failed command restores the counter, inventory, and pending events together.

### 9.2 Presentation

`GameStateView` exposes at most one `pendingAcquisition`:

- only unacknowledged events are eligible;
- authored dialogue always drains first;
- event ordering follows command ID then ordinal;
- the view resolves the current record presentation from packaged definitions.

The Svelte acquisition controller stops inferring inventory differences. It
renders the Rust-provided event and invokes
`acknowledge_acquisition_event(eventId)` when the player dismisses the popup.

Acknowledgement is a durable Rust command. The frontend does not close the
popup until the command succeeds and its resulting autosave is flushed. This
prevents a successfully acknowledged event from reappearing after a process
exit between dismissal and the normal debounce.

If that flush fails, the popup first remains open with Retry and Cancel. A
second explicit confirmation may choose Continue Without Saving. Rust keeps
the event acknowledged in the live engine and marks persistence degraded, but
allows the popup to close. A later successful autosave persists the
acknowledgement; if the process exits first, the event may correctly reappear
because the player explicitly accepted that durability loss.

If the process exits before acknowledgement commits, the event appears again
after resume. That is correct because acknowledgement was never durable.

## 10. Generic resumable-state fixture

The save subsystem defines an internal definition-bound restore adapter:

```rust
trait ResumableStateAdapter {
    type Snapshot;

    fn capture(&self) -> Self::Snapshot;
    fn dependencies(snapshot: &Self::Snapshot) -> Vec<DefinitionDependencyV1>;
    fn restore(
        definitions: &CurrentDefinitions,
        snapshot: Self::Snapshot,
    ) -> Result<Self, SaveLoadError>
    where
        Self: Sized;
}
```

Current linear, investigation, and interrogation restoration use this contract
or an equivalent closed dispatcher.

A test-only P0 fixture implements the same contract with:

- a stable definition reference and hash;
- an incomplete boolean/small-enum mutable state;
- a cursor;
- a required referenced definition;
- a public value that proves the cursor/state restored exactly.

The fixture passes through JSON serialization, dependency validation, candidate
construction, and transactional replacement in the test harness. It is not a
production scene type, does not add an arbitrary JSON bag to `SaveSnapshot`,
and does not depend on HPA-260's analysis runtime.

## 11. Durable revision and autosave scheduling

### 11.1 Commit signal

`GameEngine` adds rollback-tracked `next_command_id` and persistent
`durable_revision` counters.

For every successful durable command:

1. the command mutates inside the existing rollback scope;
2. dialogue history finalizes;
3. the command ID and acquisition events finalize;
4. `durable_revision` increments once;
5. the public view is built;
6. the application-level command wrapper notifies `SaveCoordinator`.

A failed command restores all mutable state and produces no autosave signal.
Read-only commands and save-list discovery do not increment the revision.

### 11.2 Debounce

Autosave uses a 500 ms trailing debounce:

- rapid committed commands coalesce;
- the coordinator captures the latest stable revision after the quiet period;
- at most one disk write runs at a time;
- if a newer revision commits during a write, the coordinator schedules one
  follow-up write for the newest revision;
- completed writes record the revision and session generation they contain.

The value is fixed in one named constant and covered with a fake-clock test.
It is not user-configurable.

### 11.3 Session generations and flushes

Starting a game, successfully loading a save, and clearing the engine each
advance a volatile session generation. Every timer/write carries the generation
it was scheduled for. A stale generation may finish a temporary file but may
not replace a slot.

The following operations flush the current committed revision before
continuing:

- manual save;
- confirmed in-game load;
- Return to Title;
- acquisition acknowledgement response.

The first flush failure blocks the requested operation with an actionable error
and Retry/Cancel. Manual Save has no bypass because bypassing it would perform
no useful action. In-game Load, Return to Title, and acquisition-popup
dismissal additionally offer Continue Without Saving behind a second explicit
data-loss confirmation.

Those bypasses use distinct typed Rust commands tied to the current session
generation and persistence failure. They are not an `allowDataLoss` boolean on
the ordinary command and cannot be invoked before a real flush failure. An
approved bypass records degraded persistence health and then discards or
continues the affected in-memory state as described by the UI flow. Ordinary
gameplay commands remain committed when a background autosave fails.

The actionable error returns an opaque `failureToken`. Rust stores the
corresponding one-shot challenge in the coordinator, bound to the failed
operation and all relevant identity: session/discovery generation, durable
revision, selected save ID, or acquisition event ID. The token is a UUID v4
correlation value, not an authorization boundary; the frontend cannot inspect
or manufacture the stored challenge. A successful retry, any superseding
session/discovery transition, a changed selected save/event, or one bypass use
invalidates it. Every without-saving command requires the matching live token.

## 12. Storage contract

### 12.1 Directory and files

The Rust shell resolves:

```text
<tauri-app-data>/saves/
  autosave-1.json
  autosave-2.json
  autosave-3.json
  autosave-4.json
  autosave-5.json
  manual-1.json
  manual-2.json
  manual-3.json
```

Temporary files use unique names in the same directory and are removed after a
successful replacement. Stale temporary files are ignored during discovery
and may be cleaned only after age/type checks.

No save path is accepted from the frontend. IPC selects a typed save kind and
bounded slot number.

### 12.2 Atomic write

For every save:

1. serialize the complete envelope in memory;
2. write a uniquely named temporary file in the save directory;
3. flush and sync the temporary file;
4. atomically replace the chosen slot using the platform storage adapter;
5. sync the parent directory where supported;
6. only then report success/update coordinator health.

Failure before replacement leaves the existing slot intact. The implementation
must use a replacement mechanism with verified macOS, Windows, and Linux
semantics; plain `std::fs::rename` overwrite behavior is not assumed to be
portable.

### 12.3 Autosave rotation

Autosave selects:

1. the lowest-numbered empty autosave slot, otherwise
2. the autosave slot with the oldest filesystem modification time, with slot
   number ascending as the deterministic tie-breaker.

Valid, corrupt, and incompatible autosaves all participate in the same
five-slot rotation. Rotation is the deliberate replacement policy for
autosaves. Manual files are never selected by autosave.

Starting New Game does not pre-delete saves and shows no warning. The first
committed mutation produces an autosave through normal rotation.

### 12.4 Discovery and ordering

Discovery returns all eight positions as one of:

```rust
#[serde(rename_all = "camelCase")]
struct SaveSlotView {
    reference: SaveSlotRef,
    modified_at: Option<String>,
    status: SaveSlotStatusView,
}

#[serde(tag = "type", rename_all = "camelCase")]
enum SaveSlotStatusView {
    Empty,
    Valid { metadata: SaveMetadataView },
    Invalid { diagnostic: SaveDiagnosticView },
}
```

Filesystem modification time is the authoritative recency key for rotation
and Continue. This allows an unparseable newest file to remain newest and block
Continue as approved. A valid envelope's `saved_at` remains the user-facing
timestamp.

Continue uses one total newest-first ordering:

1. filesystem modification time;
2. when both tied files are valid, envelope `saved_at`;
3. a fixed storage-key fallback: manual before auto, then higher slot number.

The last rule is only a deterministic fallback for filesystems whose timestamp
resolution cannot distinguish writes, including ties involving an invalid file.
It does not permit skipping a higher-ranked invalid file.

Continue:

1. discovers non-empty slots;
2. selects exactly the newest by filesystem recency;
3. attempts to load only that slot;
4. returns its typed diagnostic on failure.

Load Game lets the player choose any valid older file. It never interprets
"newest valid" as permission to skip a newer invalid file.

### 12.5 Deletion and preservation

Deletion is an explicit typed command and requires frontend confirmation.
Deleting a slot does not renumber or rewrite other files.

Parse, migration, definition, and I/O failures do not delete or modify the
source save. Successful migration happens in memory; the original file is not
rewritten during load. A later manual save or autosave creates a new current
envelope through normal policy.

## 13. Transactional load

Load never mutates the live engine incrementally:

1. read the selected file;
2. parse a minimal version envelope;
3. run sequential schema migrations in memory;
4. run explicit content migrations in memory;
5. validate slot/envelope consistency;
6. load current packaged chapters, scenes, catalog, and hash metadata;
7. resolve all snapshot dependencies;
8. reconstruct dialogue segments and scene progress;
9. build a complete candidate `GameEngine`;
10. build its public view and validate summary invariants;
11. under the session lock, verify that the requested session generation is
    still current;
12. replace the live engine, reset the persistence generation, and return the
    candidate view.

Any failure before step 12 leaves the existing engine, autosave coordinator,
and frontend state unchanged.

Loading a save does not itself update that file or immediately create an
autosave. The first subsequent durable mutation enters autosave rotation.

Opening the in-game Save/Load browser first flushes the pre-load engine, then
lists slots. This protects the current position and prevents a pending
autosave rotation from changing a listed slot during selection. The menu is
inert to gameplay commands while it is open.

If that opening flush fails, Retry/Cancel is shown first. The approved second
confirmation may open the browser without saving the current revision when
slot discovery itself is still available. The resulting failure token/session
generation is carried into `load_save_discarding_current`; ordinary
`load_save` remains unavailable until a flush succeeds.

The Load command carries the selected slot and the `save_id` observed by the
browser. Rust rejects a stale selection if the slot changed. After confirmation
it builds the candidate from that exact checkpoint. Ordinary Load performs an
idempotent flush check; Load and Discard Current Unsaved Progress instead
validates the matching persistence failure/session generation. Rust swaps
engines only after the selected path and candidate validation both succeed.

Return to Title flushes the current revision, cancels its session generation,
sets the engine to `None`, and returns a freshly discovered save list. Continue
therefore proves the disk restoration path instead of reusing an in-memory
engine.

## 14. Migration policy

### 14.1 Schema migrations

The loader first parses only `schemaVersion`. It dispatches through a sequential
registry:

```text
v1 -> v2 -> ... -> current
```

Rules:

- every step is explicit, typed, and independently tested;
- missing intermediate steps reject the load;
- future versions reject with `unsupportedSaveSchemaVersion`;
- a migration may add defaults only when the old schema had one unambiguous
  meaning;
- migration output must pass the same current-schema validation as a new save.

Version 1 has no legacy importer. Existing Lyra releases have no save contract.

### 14.2 Content migrations

Content migrations are keyed by old content revision plus stable definition
identity/hash. They may:

- rename a stable definition ID;
- map an old cursor to a changed segment;
- transform mutable progress;
- prove that a completed historical definition may be dropped while preserving
  every surviving durable output.

They may not:

- guess by label, prose, array position, or similar ID;
- silently reset active/incomplete progress;
- invent evidence, facts, objective completion, or acknowledgement;
- rewrite the source save during load.

The initial implementation includes the registry and rejection behavior but no
production content migration because there is no prior HPA-129 save schema.
Tests use explicit old/current fixture revisions.

## 15. Tauri command surface

The Rust shell exposes narrow typed commands:

```text
list_saves
get_persistence_status
start_game
start_game_without_saving
save_manual
load_save
load_save_discarding_current
continue_game
delete_save
return_to_title
return_to_title_without_saving
acknowledge_acquisition_event
confirm_acquisition_without_saving
```

Existing gameplay commands continue to return `GameStateView`. Their shared
application wrapper schedules autosave after a successful durable revision.
`GameStateView` remains engine-owned and does not absorb coordinator health.

The coordinator exposes:

```rust
#[serde(tag = "type", rename_all = "camelCase")]
enum PersistenceHealthView {
    Healthy,
    Pending,
    Degraded { diagnostic: SaveDiagnosticView },
}
```

`get_persistence_status` supplies the initial/current value. Rust emits one
`persistence-status-changed` Tauri event whenever background persistence
transitions between these states; the frontend store subscribes and owns only
the rendered copy.

Conceptual public save types:

```ts
type SaveSlotRef =
  | { type: "auto"; slot: 1 | 2 | 3 | 4 | 5 }
  | { type: "manual"; slot: 1 | 2 | 3 };

type SaveSlotStatusView =
  | { type: "empty" }
  | { type: "valid"; metadata: SaveMetadataView }
  | { type: "invalid"; diagnostic: SaveDiagnosticView };

type SaveSlotView = {
  reference: SaveSlotRef;
  modifiedAt: string | null;
  status: SaveSlotStatusView;
};

type SaveBrowserView = {
  discovery:
    | { type: "available" }
    | { type: "unavailable"; diagnostic: SaveDiagnosticView };
  slots: SaveSlotView[];
};
```

Rust uses the same `SaveSlotView`, `SaveMetadataView`, and
`SaveDiagnosticView` concept names. Every Rust save-view struct/enum uses
`#[serde(rename_all = "camelCase")]` (and `rename_all_fields` for tagged-enum
fields) so these TypeScript types mirror the IPC wire contract directly.

When save-directory resolution or enumeration fails globally, `list_saves`
returns `discovery: unavailable` and no fabricated per-slot statuses.

Frontend booleans are not trusted for overwrite/load confirmation. They are UI
workflow state only. Rust still validates:

- slot bounds and type;
- whether a manual slot is occupied before overwrite;
- session generation;
- save/load availability;
- event identity and acknowledgement state.

The overwrite command carries the slot plus the save ID observed by the
confirmation screen. If another write changes the slot before confirmation,
Rust rejects the stale overwrite instead of overwriting unseen data.

## 16. UI design and flows

### 16.1 Title screen

The title menu contains:

- Continue;
- Load Game;
- New Game;
- the existing remaining entries.

When discovery succeeds, Continue and Load Game are disabled only when all
eight files are absent. They remain enabled when files exist but are invalid,
so the player can see their diagnostics.

If save discovery fails globally, Continue and Load Game are disabled and the
title shows the global diagnostic with Retry. New Game first returns the same
persistence-unavailable error. The player may then confirm Play Without Saving
through the distinct `start_game_without_saving` path; the new session starts
with degraded persistence health and later durable revisions may retry normal
autosave.

Continue shows a blocking diagnostic when the newest file fails. The action
from that diagnostic opens Load Game with the failed slot selected.

New Game starts immediately without deleting or warning about existing saves.

### 16.2 Shared save browser

One shared save-browser component supports:

- title Load mode;
- in-game Load mode;
- in-game Manual Save mode.

Load mode shows:

1. five autosave positions, newest visually marked;
2. three manual positions.

Each valid entry shows:

- chapter title;
- scene title;
- active primary objective label, or a localized no-active-objective state;
- Autosave or Manual Save;
- local saved date/time.

An invalid entry shows its slot identity and typed diagnostic. It is disabled
for Load but remains selectable for details and deletion. Empty entries use a
clear empty-slot state.

Save mode shows only the three manual slots. Choosing an empty slot writes
immediately. Choosing an occupied slot opens overwrite confirmation containing
the old slot metadata and the current-game metadata.

### 16.3 Escape menu

The root Escape menu adds:

- Save/Load;
- Return to Title.

The Save/Load submenu preserves existing Escape layering: Escape closes a
confirmation first, then returns from the save browser to the root menu, then
closes the menu.

Saving is allowed during stable dialogue, investigation, and interrogation
views. Frontend-only typewriter or fade animation does not make the Rust engine
unstable. A command already holding the session mutation boundary serializes
before save capture.

Loading from an active game always opens confirmation. On confirmation, Rust
flushes the current autosave, transactionally loads the selected file, and
returns the replacement state.

If the pre-load flush fails, the first dialog offers Retry/Cancel. A second
confirmation may choose Load and Discard Current Unsaved Progress through
`load_save_discarding_current`; Rust still transactionally validates the target
before replacing the engine.

Return to Title flushes pending autosave work. A first failure keeps the game
open with Retry/Cancel. A second confirmation may invoke
`return_to_title_without_saving`, clear the live engine, and retain the degraded
health diagnostic on the title screen.

### 16.4 Post-load frontend reset

After load succeeds, the frontend:

- replaces the entire public `GameStateView`;
- closes Escape-menu and save-browser state;
- closes dialogue history and transient confirmation overlays;
- discards inventory-diff acquisition inference;
- renders any Rust-provided pending acquisition only after restored authored
  dialogue drains;
- resets focus to the active gameplay control;
- resynchronizes background/portrait/audio presentation from restored semantic
  cue IDs;
- keeps audio preferences unchanged.

Frontend animation progress is not saved. Dialogue resumes at the exact current
item and starts that item's presentation from its beginning.

## 17. Errors and save health

Persistence errors use typed `GameError` codes. The design requires distinct
diagnostics for:

- save directory/path resolution failure;
- save read/write/sync/replace failure;
- global save discovery unavailable;
- malformed JSON;
- slot/envelope mismatch;
- unsupported schema version;
- missing schema migration;
- missing content migration;
- missing required definition;
- changed required definition hash;
- invalid runtime progress or cursor;
- stale manual-overwrite confirmation;
- stale session generation;
- unavailable or stale persistence-bypass confirmation;
- unknown/already-acknowledged acquisition event.

Messages name the affected slot and give a user action where one exists. They
do not expose arbitrary absolute filesystem paths in the normal UI.

Background autosave failure:

- does not roll back the committed gameplay command;
- records persistent save-health state;
- updates `get_persistence_status` and emits `persistence-status-changed`;
- exposes a visible warning in the in-game system menu/HUD;
- retries only after a later durable revision or an explicit flush/save action;
- never loops continuously on an unchanged failed revision.

Manual Save remains blocked on failure because there is no meaningful
without-saving result. Load, Return to Title, acquisition acknowledgement, and
New Game after global discovery failure first block, then offer the approved
second-confirmation bypass. The bypass warning states exactly which progress
may be lost and that acquisition acknowledgement may reappear after restart.

## 18. Verification

### 18.1 Compiler tests

- Hashes and `contentRevision` are deterministic across repeated compilation.
- Semantic array order affects hashes where required.
- Object/source ordering that is not semantic does not affect hashes.
- Source locations, paths, and timestamps do not affect hashes.
- Every resumable scene/dialogue block receives one stable origin/hash.
- Reordering or inserting sibling hotspots, topics, phases, questions, or
  testimony lines leaves every unaffected segment origin unchanged.
- Every dialogue-bearing field maps to one derived role key, and any
  derived-origin collision fails with source locations.
- Existing Chapter 1 compiles and produces loadable hash metadata.

### 18.2 Rust schema, capture, and restore tests

- Serialize and deserialize schema version 1.
- Round-trip linear dialogue at a nonzero cursor.
- Round-trip investigation progress and active dialogue.
- Round-trip interrogation phase, cross-exam, line-content boundary, and active
  dialogue.
- Preserve inventory acquisition metadata.
- Preserve HPA-255 story state and active-primary uniqueness.
- Preserve the bounded dialogue transcript, next ID, last token, visual/audio
  cue IDs, queue generation, command ID, and durable revision.
- Round-trip a fresh engine's non-optional default `last_visual_cue` object.
- Sort set-backed fields deterministically.
- Reject missing current/required definitions.
- Reject active definition-hash changes without migration.
- Apply an explicit definition/cursor migration fixture.
- Reject inconsistent scene/runtime/cursor combinations.
- Prove a failed load leaves the live engine's public view and coordinator
  generation unchanged.
- Pass the generic resumable-state fixture through JSON, dependency validation,
  candidate construction, and transactional replacement.

### 18.3 Dialogue and acquisition tests

- Reconstruct one linear segment at the same item.
- Reconstruct composite multi-segment queues at the same segment and item.
- Preserve order across `onCollect`, `onAcquire`, result, and reveal segments.
- Reject stale queue tokens after normal advancement.
- Create one acquisition event per newly acquired record.
- Roll back command IDs and events when a command fails.
- Hide pending acquisition until authored dialogue drains.
- Persist an unacknowledged event and present it after resume.
- Flush acknowledgement before popup dismissal succeeds.
- Never present an acknowledged event after resume.

### 18.4 Storage and coordinator tests

Use temporary directories, a fake clock, a fake filesystem replacement layer,
and a controllable writer:

- fill five autosave slots, write a sixth, and replace only the oldest;
- prefer empty autosave slots in numeric order;
- never rotate into manual slots;
- list five autosaves and three manual slots in stable groups;
- select Continue by filesystem recency across both save types;
- resolve equal-mtime Continue candidates by valid `saved_at`, then the fixed
  manual/auto and slot-number fallback;
- let an unparseable newest file block Continue;
- manually load an older valid file;
- preserve existing files on temporary-write, sync, and replacement failure;
- ignore stale temporary files during discovery;
- preserve corrupt/incompatible source files after failed reads/migrations;
- delete only the explicitly selected slot;
- reject stale manual overwrite confirmation;
- coalesce rapid revisions into one 500 ms autosave;
- schedule a follow-up write when a revision commits during a write;
- prevent stale session generations from replacing slots;
- reject without-saving commands before a matching persistence failure and
  after their session generation becomes stale;
- flush before manual save, in-game load, Return to Title, and acquisition
  acknowledgement;
- retain committed gameplay and expose save health on background failure;
- publish Healthy/Pending/Degraded status transitions without putting
  coordinator state in `GameStateView`;
- return one global discovery error rather than eight fabricated invalid slots.

### 18.5 Svelte tests

- When discovery succeeds, title Continue/Load is disabled only when no files
  exist.
- Global discovery failure disables Continue/Load and gates Play Without Saving
  behind a second confirmation.
- Continue diagnostic opens Load Game on the failed newest slot.
- Shared browser renders valid, invalid, and empty states.
- Browser renders all five autosaves and all three manual slots.
- Manual overwrite and deletion require confirmation.
- In-game Load requires confirmation; title Load does not.
- Flush failures require Retry/Cancel before the distinct without-saving
  confirmation becomes available.
- New Game starts without an existing-save warning.
- Escape steps back through confirmation/browser/root menu.
- Successful load clears transient overlays and restores focus.
- Save-health warning persists until a successful save/flush clears it.
- Persistence status events update the warning after background writes without
  a gameplay command.
- Acquisition popup renders Rust event state rather than inventory diffs.
- Acquisition Continue Without Saving warns that acknowledgement may reappear
  after restart.

### 18.6 Packaged Tauri E2E

The debug e2e build proves real app-data storage and process boundaries:

1. Save during single-segment dialogue, Return to Title, and Continue at the
   same dialogue item.
2. Save during a composite queue and resume the same segment/item.
3. Save after evidence acquisition while its authored dialogue is active,
   resume, drain dialogue, acknowledge the popup once, return to title, and
   prove it does not reappear.
4. Exercise incomplete investigation and interrogation state.
5. Create six autosaves and prove only the latest five remain.
6. Overwrite a manual slot only after confirmation.
7. Corrupt the newest file, prove Continue stops with its diagnostic, then load
   an older valid file manually.
8. Return to Title and prove Continue reconstructs from disk rather than a live
   in-memory engine.

E2E tests use an isolated app-data directory and clean only that test-owned
directory.

### 18.7 Final gates

Before HPA-129 implementation is complete:

- focused compiler Vitest files pass;
- `bun run scenes:compile` passes;
- `bun run check:scripts` passes;
- focused Rust tests pass;
- full `cargo test --manifest-path apps/game/src-tauri/Cargo.toml` passes;
- `bun run rust:lint` and `bun run rust:fmt` pass;
- focused Svelte tests pass;
- `bun run check` passes;
- `bun run test` passes;
- `bun run --cwd apps/game check:e2e` passes;
- packaged Tauri HPA-129 E2E scenarios pass.

## 19. Expected implementation areas

Likely implementation touches:

```text
packages/scripts/compile-scenes/
packages/scripts/__tests__/
packages/scripts/__fixtures__/
apps/game/src-tauri/src/game/save/
apps/game/src-tauri/src/game/command_tx.rs
apps/game/src-tauri/src/game/dialogue.rs
apps/game/src-tauri/src/game/scenes/
apps/game/src-tauri/src/game/story/
apps/game/src-tauri/src/game/view.rs
apps/game/src-tauri/src/game/mod.rs
apps/game/src-tauri/src/lib.rs
apps/game/src-tauri/Cargo.toml
apps/game/src/lib/state/
apps/game/src/lib/components/MainMenu.svelte
apps/game/src/lib/components/GameShell.svelte
apps/game/src/routes/+page.svelte
apps/game/e2e-tauri/
```

Planning must keep files focused. In particular, save schema/storage/migrations
must not be appended to the existing `game/mod.rs` facade, and the shared save
browser must not duplicate title and in-game slot rendering.

## 20. Non-goals

HPA-129 does not add:

- cloud sync or cross-device saves;
- accounts or server storage;
- save screenshots/thumbnails;
- quicksave/quickload hotkeys;
- more than one local run/profile namespace;
- user-authored save names;
- audio preference persistence changes;
- analysis runtime, board drafts, or analysis result restoration;
- HPA-258's case-file or Continue recap screen beyond save summary metadata;
- HPA-256 provenance/supersession behavior;
- arbitrary generic JSON flags or a generic production scene type;
- a production content migration from a pre-HPA-129 format.

Analysis-specific draft resume remains owned by HPA-260, with packaged
board/result-dialogue resume accepted by HPA-266.

## 21. Acceptance traceability

| HPA-129 outcome | Design coverage |
| --- | --- |
| Round-trip every current runtime | §§7, 8, 13, 18.2 |
| Resume one dialogue segment exactly | §§8.1–8.3, 18.3 |
| Resume composite dialogue exactly | §§8.1–8.3, 18.3 |
| Acquisition acknowledgement appears once | §9, §11.3, §18.3 |
| Generic incomplete resumable fixture | §10, §18.2 |
| Five visible latest autosaves | §§2, 12.3–12.4, 16.2, 18.4 |
| Invalid newest blocks Continue | §§2, 12.4, 16.1, 18.4 |
| Stable compiler-owned segment identity | §§5.1, 8.2, 18.1 |
| Definition changes reject without migration | §§5, 13, 14, 18.2 |
| Missing definitions reject transactionally | §§7, 13, 17, 18.2 |
| Degraded-storage warning and explicit escape | §§11.3, 15–17, 18.4–18.5 |
| Manual overwrite confirmation | §§15, 16.2, 18.4–18.6 |
| Save to title to Continue | §§13, 16.1, 18.6 |

The original corrupt-primary automatic fallback criterion is intentionally
superseded by five visible autosaves plus explicit manual recovery through Load
Game.
