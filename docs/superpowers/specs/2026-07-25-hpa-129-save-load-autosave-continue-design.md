# HPA-392 Save/Load Persistence, Named Saves, Thumbnails, and Continue Design

**Status:** Approved in conversation  
**Issue:** HPA-392 — Complete HPA-129 save/load persistence, named saves,
thumbnails, Continue, and UI  
**Parent:** HPA-129 — Save/load, autosave, and Continue  
**Date:** 2026-07-26

**Compatibility amendment:** Approved in conversation on 2026-07-25. Released
static content is immutable. Saves contain mutable state only and require one
exact package-wide `contentRevision`; any static semantic content change
invalidates pre-release/development saves.

**HPA-392 expansion:** Approved in conversation on 2026-07-26. This revision
keeps HPA-129's authoritative persistence contract and adds player-authored
manual-save names plus aspect-ratio-preserving screenshot thumbnails. The
previous statements that thumbnails and user-authored names were non-goals are
superseded by this document.

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

It also consumes the content-identity and dialogue-reconstruction prerequisite
merged in PR #27:

- one compiler-owned package `contentRevision` and minimal content manifest;
- stable semantic segmented-dialogue origins;
- live `ActiveDialogueQueue` state with existing flattened token/history
  semantics;
- crate-private active-dialogue capture and transactional reconstruction
  adapters.

HPA-392 completes the player-visible HPA-129 feature. It delivers:

- a versioned, Rust-owned persistent save contract;
- exact capture and transactional restoration for every current runtime;
- ordered, definition-backed dialogue segments;
- Rust-owned durable acquisition acknowledgement;
- five visible rotating autosaves;
- three visible named manual slots with overwrite confirmation;
- one clean gameplay screenshot thumbnail per successful save when capture is
  available, with deterministic placeholders when it is not;
- title-screen Continue and Load Game;
- in-game Save/Load and Return to Title;
- explicit second-confirmation escape paths when persistence is unavailable;
- explicit save-schema migrations and exact packaged-content compatibility;
- atomic storage and actionable compatibility diagnostics;
- a P0-owned generic resumable-state fixture that does not depend on the
  analysis runtime.

This design deliberately refines four requirements from the parent design and
the current Linear issue:

1. Five visible rotating autosaves replace the original one current autosave
   plus one hidden backup.
2. Continue targets the newest written save only. If that file is corrupt or
   incompatible, Continue stops with a diagnostic and directs the player to
   Load Game. It does not silently select an older save.
3. Manual saves carry validated, player-authored Unicode display names.
4. Every save attempts a clean gameplay-frame PNG thumbnail. Thumbnail failure
   is presentation-only and never invalidates authoritative save state.

The user approved the first two refinements during HPA-129 design and the latter
two during HPA-392 design.

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
15. Saving stores stable IDs and mutable state, not copies of authored
    definitions. The bounded dialogue transcript is the deliberate exception:
    it retains the copy that the player already saw.
16. Invalid files remain on disk until the player deletes them or normal,
    deliberate slot replacement overwrites them.
17. A failed durability action first offers Retry/Cancel. Load, Return to
    Title, acquisition-popup dismissal, and New Game after global discovery
    failure may then proceed without saving only after a second explicit
    data-loss confirmation.
18. Persistence health is application/session state exposed separately from
    engine-owned `GameStateView`.
19. A normal gameplay autosave rotates the five-slot ring. Acquisition
    acknowledgement refreshes that session's current autosave slot in place so
    acknowledgements cannot consume the recovery history.
20. One package-wide `contentRevision` is the load compatibility gate. Any
    emitted static semantic-content change, including prose, ordering, or a
    compiler-materialized default needed for reconstruction, invalidates
    existing saves. This is acceptable before release; released static content
    is treated as immutable.
21. Manual saves store one player-authored display name. An occupied slot keeps
    its existing name by default; the player may edit it before overwrite.
22. Manual names are trimmed, contain 1–40 Unicode grapheme clusters, reject
    control/line-separator characters, and otherwise preserve Unicode and
    internal spacing verbatim.
23. New manual slots and autosaves use a Rust-generated
    `<chapter title> · <scene title>` suggestion, shortened by grapheme cluster
    when required. Autosave names are read-only.
24. Thumbnails are clean gameplay-frame PNGs fitted inside 480×360 without
    cropping, non-uniform scaling, padding, or upscaling.
25. Save menus, confirmations, errors, acquisition popups, and other transient
    overlays never appear in thumbnails; the ordinary gameplay scene,
    dialogue, and HUD may appear.
26. Thumbnail bytes are presentation sidecars owned through opaque save IDs,
    never embedded in `SaveSnapshot` and never addressed through a display
    name.
27. Missing, corrupt, timed-out, or failed thumbnail capture produces a
    deterministic placeholder and a non-blocking presentation warning. It does
    not change compatibility, ordering, Continue, or Load behavior.
28. Acquisition acknowledgement prepares and submits its clean-frame thumbnail
    before the durable acknowledgement command. The command consumes that
    event-bound ticket, advances the revision, flushes the refreshed autosave,
    and returns only after the durability result is known.
29. When both filesystem modification time and valid `saved_at` are exactly
    tied, Continue prefers a manual save because it is the explicit
    player-authored checkpoint; this fallback never outranks a measurably newer
    autosave.
30. The packaged thumbnail proof is an architecture gate. If clean DOM capture
    cannot meet the approved frame contract in Tauri's packaged WebView,
    implementation stops and returns to design; systematically unavailable
    thumbnails do not satisfy HPA-392.

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
- represents active dialogue through ordered `ActiveDialogueQueue` segments
  while preserving the public flattened cursor;
- exposes crate-private active-dialogue capture and definition-backed
  reconstruction adapters;
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
  popup focus, and audio controllers outside Rust;
- has no DOM-to-image capture dependency or save-browser state.

HPA-392 removes inventory-diff inference for acquisition acknowledgement but
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
  thumbnail.rs
```

Responsibilities:

| Module | Responsibility |
| --- | --- |
| `schema.rs` | Serializable envelope, mutable snapshot, names, thumbnail descriptors, slot metadata, dialogue origins, acquisition events, and typed load diagnostics |
| `capture.rs` | Convert one stable committed `GameEngine` into a persistent snapshot containing IDs and mutable progress |
| `restore.rs` | Verify the exact packaged-content revision, resolve stable IDs against current definitions, reconstruct a complete candidate engine, and return it without touching the live engine |
| `migrations.rs` | Sequential save-schema migrations |
| `storage.rs` | App-data paths, discovery, five-autosave rotation, in-place acknowledgement refresh, three manual slots, atomic envelope/sidecar writes, reads, orphan cleanup, and deletion |
| `coordinator.rs` | Debounced autosave scheduling, current-session autosave targeting, durable-revision tracking, opaque thumbnail-ticket coordination, flushes, write serialization, and save-health state |
| `thumbnail.rs` | Validate bounded PNG submissions, bind them to an exact session/revision, derive opaque sidecar identities, inspect sidecars without eager decode, and expose typed thumbnail availability |

`GameEngine` remains the gameplay authority. The save subsystem may use
crate-private capture/restore accessors, but it does not expose authored
definitions through the IPC layer.

`AppState` becomes one coherent session aggregate rather than unrelated locks:

```rust
struct AppState {
    session: Mutex<AppSession>,
    replacement_gate: Mutex<()>,
}

struct AppSession {
    engine: Option<GameEngine>,
    persistence: SaveCoordinator,
}
```

The exact synchronization primitives may be refined during planning.
`replacement_gate` is a narrow ordering gate, not the gameplay mutex described
in §11.2. The invariant is fixed: engine replacement, session-generation
changes, and autosave scheduling share one ordering boundary. No timer may
replace a slot from a session that has already returned to title, started a new
game, or loaded another save.

## 5. Compiled content identity

### 5.1 Revision ownership

The scene compiler owns the package revision because it already owns the
canonical generated wire representations. Runtime code must not reproduce the
revision from authored Markdown, filesystem paths, or Rust lookup structures.

The compiler emits one standalone runtime artifact alongside
`story_catalog.json`, including for minimal fixture bundles:

```text
apps/game/src-tauri/resources/scenes/save_content_manifest.json
```

Version 1 is deliberately small:

```rust
struct SaveContentManifestV1 {
    manifest_version: u32,
    content_revision: String,
}
```

`contentRevision` is SHA-256 over one deterministic canonical JSON projection
of the complete emitted static semantic bundle:

- ordered chapters with stable IDs, titles, summaries, and ordered scene
  identities;
- every emitted linear, investigation, and interrogation scene value;
- compiler-materialized dialogue defaults required to reconstruct a resumable
  runtime queue;
- the emitted story catalog, including record indexes and global definitions.

The projection includes all emitted semantic copy, IDs, kinds, order, cues,
unlock/reveal/progression rules, authored static definitions, and deterministic
compiler defaults. Therefore any static semantic edit—including prose, labels,
descriptions, dialogue order, scene order, progression structure, or fallback
copy—changes the revision.

Canonicalization:

- sorts object keys recursively;
- preserves every semantically ordered array;
- uses emitted semantic values rather than raw Markdown bytes;
- excludes source locations, source formatting, absolute paths, generated
  timestamps, and compiler/runtime `Map`, `Set`, or `HashMap` iteration.

The encoded value is `sha256:<lowercase hex>`. Repeated compilation of
semantically identical inputs produces the same revision. One shared canonical
serializer owns this calculation; feature code does not hand-roll alternate
`JSON.stringify` hash paths.

Before emission and hashing, the compiler materializes the exact action
`（沒有新發現。）` for a missing or empty re-examination block on a hotspot,
topic, evidence record, or statement record. The emitted scene wire is the
single source used by both live queue installation and later reconstruction;
Rust does not retain a second unhashed fallback-copy constant. Changing the
fallback copy or its four-role applicability therefore changes
`contentRevision` automatically.

This artifact is a compiler/runtime contract, not an editor scene-graph
contract. HPA-392 adds no save-only fields to `@lyra/scene-types`.

### 5.2 Exact compatibility gate

The save envelope records the package `contentRevision`. Discovery and load
require it to equal the currently packaged manifest exactly after any
save-schema migration. A mismatch makes that slot incompatible with an
actionable diagnostic; the loader does not attempt partial per-definition
compatibility, copy-only compatibility, or best-effort progress recovery.

This is an explicit product assumption:

- pre-release and development content edits may invalidate existing test saves;
- released static content is immutable for that release line;
- if a future shipped release must change static content while retaining saves,
  that release must introduce an explicit new migration design rather than
  relying on HPA-392 version 1 heuristics.

The revision is a fingerprint, not a snapshot of static content. Saves still
serialize only mutable authoritative state plus stable IDs and dialogue origins
needed to resolve the unchanged packaged definitions. Static scenes, dialogue
items, catalog definitions, answer keys, labels, and descriptions remain in
the packaged resources.

After the revision matches, restore still validates every referenced stable ID,
cursor, and invariant. Those checks detect save corruption; they are not a
substitute for the package compatibility gate. The bounded dialogue transcript
continues to store already-rendered historical copy as described in §7.3.

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
    display_name: String,
    thumbnail: ThumbnailDescriptorV1,
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

`display_name` is presentation metadata. Rust owns its final value:

- manual input is trimmed using Unicode whitespace;
- the stored result must contain 1–40 extended grapheme clusters;
- control characters plus U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR
  are rejected;
- remaining Unicode code points and internal spacing are stored verbatim,
  without normalization, collapsing, slugification, or path conversion;
- a new manual slot is prefilled with
  `<chapter title> · <scene title>`, shortened by complete grapheme clusters
  when required: a value over 40 clusters retains its first 39 clusters and
  uses `…` as the fortieth;
- an occupied manual slot is prefilled with its existing name when that field is
  independently readable and still passes the current name rules; otherwise it
  uses the generated chapter/scene suggestion;
- autosaves use the same generated chapter/scene form and cannot be renamed.

The frontend mirrors these checks for immediate feedback, but the Rust command
is authoritative and returns a typed name diagnostic on failure.

Thumbnail metadata is presentation-only:

```rust
#[serde(tag = "type", rename_all = "camelCase")]
enum ThumbnailDescriptorV1 {
    Available {
        object_id: String,
        format: ThumbnailFormat,
        width: u32,
        height: u32,
        byte_length: u32,
        sha256: String,
    },
    Unavailable,
}

enum ThumbnailFormat {
    Png,
}
```

`object_id` is derived from the opaque checkpoint `save_id`, never from
`display_name`, chapter/scene copy, or a frontend path. Accepted images must be
PNG, non-empty, at most 1 MiB encoded, and no larger than 480×360. Width and
height retain the captured ratio; capture never crops, stretches, pads, or
upscales. Rust validates the PNG signature/IHDR, byte length, dimensions, and
digest before retaining a candidate. The digest wire format is
`sha256:<lowercase hex>`.

On every read, Rust validates the checkpoint ID as a canonical UUID, recomputes
the one expected object ID, and requires the descriptor to match before
resolving a bounded child path under `thumbnails/`. A mismatch is presentation
corruption. An object ID parsed from an envelope is never joined directly to an
application-data path.

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
state from `snapshot`; summary mismatches are reported as corruption. Display
names and thumbnail descriptors are not compared with engine state and cannot
affect restoration.

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
    pending_acquisition_events: Vec<AcquisitionEventStateV1>,
    story_state: StoryStateSnapshot,
    dialogue_history: DialogueHistorySnapshotV1,
    next_queue_gen: u64,
    durable_revision: u64,
}
```

This is a conceptual field list; planning may group fields into nested structs
without changing their meaning.

The snapshot does not repeat static definition hashes or authored definitions.
Its closed scene-progress, inventory, story-state, and dialogue-origin types
carry only the stable IDs needed to resolve the exact packaged bundle selected
by `SaveEnvelopeV1.content_revision`.

### 7.1 Scene progress

`SceneProgressSnapshotV1` is a closed tagged enum:

```rust
enum SceneProgressSnapshotV1 {
    Linear,
    GameComplete {
        final_chapter_id: String,
        final_scene_id: String,
    },
    Investigation {
        intro_played: bool,
        outro_played: bool,
        current_sublocation_id: Option<String>,
        inspected_hotspot_ids: Vec<String>,
        discussed_topic_ids: Vec<CharacterTopicRefV1>,
        entered_sublocation_ids: Vec<String>,
        unlocked_overrides: Vec<InvestigationOverrideRefV1>,
    },
    Interrogation {
        intro_played: bool,
        outro_played: bool,
        current_phase_id: Option<String>,
        cross_exam: CrossExamSnapshotV1,
        broken_question_ids: Vec<String>,
        completed_phase_ids: Vec<String>,
        unlocked_overrides: Vec<InterrogationOverrideRefV1>,
        entered_phase_ids: Vec<String>,
        line_content_boundary: Option<DialogueCursorV1>,
    },
}

struct CharacterTopicRefV1 {
    character_id: String,
    topic_id: String,
}

enum InvestigationOverrideRefV1 {
    Hotspot { id: String },
    Sublocation { id: String },
    Topic {
        character_id: String,
        topic_id: String,
    },
}

enum InterrogationOverrideRefV1 {
    Question { id: String },
    Phase { id: String },
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

The current runtime may continue to use internal composite strings such as
`hotspot:<id>` or `question:<id>`. Those strings are not a persistence
contract. Capture converts them through one exhaustive adapter into the closed
snapshot enums; restore validates every referenced ID and reconstructs the
runtime key through the same central adapter. Unknown prefixes or malformed
internal keys fail capture rather than leaking into the save wire format.

Definitions themselves remain packaged content. Capture serializes stable IDs,
sets, scalars, and progress only. Unordered runtime sets are sorted before
serialization for deterministic fixtures and diagnostics.

The current runtime's `CrossExam::Playing` stores a line array index. Persistent
state deliberately stores the stable line ID instead. Restore resolves that ID
to the current index only after the package revision and question/line IDs
validate.
The line-content boundary uses segment/item coordinates rather than a flattened
queue offset and must agree with the reconstructed active queue.

`intro_queue_gen` is derived runtime bookkeeping and is not serialized as a
separate scene-progress field. Capture is allowed only after initial scene
priming completes. When an intro segment is active, restore uses
`active_dialogue.queue_gen` for both the reconstructed queue and the runtime
intro generation. Otherwise it initializes the now-unused runtime field from
`next_queue_gen`; restore does not re-run `prime_initial_queue`. Capture rejects
a non-empty, unplayed intro with no matching active intro segment as an
impossible stable state.

For interrogation restore, `line_content_boundary` maps back to the runtime's
flattened `line_content_start` only after every segment has been reconstructed.
`None` maps to the reconstructed queue length, meaning nothing is
challengeable; when there is no active queue, the runtime field resets to `0`.
A non-`None` boundary must identify the first item of the active testimony-line
content segment and fall within that segment. Any boundary outside the
reconstructed line content rejects the load. `CrossExamSnapshotV1::Playing`
likewise maps its stable line ID to exactly one runtime line index; capture and
restore never persist both formats.

`CrossExamSnapshotV1::Presenting` validates the stable question/line pair,
reinstates runtime `CrossExam::Presenting`, and returns an interrogation view
with `presenting: true`. The restored frontend therefore reopens the evidence
tray against that exact saved line; it does not silently fall back to the
line-content or question-menu view.

The loader rejects:

- a missing chapter or scene;
- a scene whose current kind differs from the snapshot;
- unknown sublocations, hotspots, characters, topics, phases, questions,
  testimony lines, or override targets;
- mutually inconsistent progress, such as a cross-exam line outside its
  restored question;
- any package `contentRevision` mismatch.

`GameComplete` is captured rather than excluded. It retains the final entered
chapter/scene IDs for summary and validation. Restore resolves those final
packaged definitions, restores all saved mutable state, and then reinstalls the
existing completion sentinel (`current_chapter_idx == chapters.len()` while the
final scene remains retained). Continue therefore returns to Game Complete
rather than attempting to enter a nonexistent successor scene.

Captures occur only after a durable command and all synchronous navigation
triggered by that command have completed. Therefore:

- a linear cursor past its final item is never saved as a mid-transition
  linear scene; the snapshot contains the fully entered next scene;
- an investigation outro that is still playing has `outro_played = true` and
  `active_dialogue = Some(...)` with the outro segment;
- an interrogation phase-entry queue is captured only after the phase is
  current/entered and its atomic reveals have committed, with
  `active_dialogue = Some(...)`;
- an empty successor queue is exhausted synchronously before capture instead
  of producing a persistent empty active queue.

### 7.2 Inventory and story state

Inventory snapshots preserve the current per-kind acquisition order and contain
only:

```rust
struct InventorySnapshotV1 {
    evidence: Vec<EvidenceInventoryEntryV1>,
    statements: Vec<StatementInventoryEntryV1>,
}

struct EvidenceInventoryEntryV1 {
    record_id: String,
    collected_in_chapter_id: String,
    collected_in_scene_id: String,
}

struct StatementInventoryEntryV1 {
    record_id: String,
    acquired_in_chapter_id: String,
    acquired_in_scene_id: String,
}
```

The entry type is the closed record-kind discriminator. Snapshots do not copy
evidence/statement labels, descriptions, details, speaker/content, authored
re-examination dialogue, image asset IDs, or paths.

Restore resolves each record through the current packaged catalog/scene
definitions and validates record kind. A missing record rejects the load.

HPA-255's `StoryStateSnapshot` remains the persistence payload for facts,
questions, objectives, and authorizations. Restore continues to use
`StoryState::from_snapshot`, so:

- all referenced definitions must exist;
- assertion/support origins remain typed;
- active-primary uniqueness remains structural;
- mutable state does not acquire copies of authored answer keys or prose.

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

struct AudioCueSnapshotV1 {
    channel: AudioChannelJson,
    asset_id: Option<String>,
}
```

A fresh game therefore stores one empty/default cue object rather than omitting
the field. The loader validates that the `bgm` field carries the BGM channel and
the `bgs` field carries the BGS channel.

Restored audio is authoritative current channel state, not an incremental scene
cue. An `asset_id` restarts that BGM/BGS asset from the beginning; playback
position is deliberately not saved. An absent channel or an explicit
`asset_id: None` produces silence after the frontend resets presentation.
Existing “keep previous audio across a scene boundary” behavior is preserved
because the already-carried cue is present in `last_visual_cue` before capture.
Mute and volume preferences remain unchanged.

Dialogue history stores the bounded Rust-owned transcript, its next entry ID,
and its last recorded queue token. The transcript is a deliberate narrow
exception to the general no-authored-prose rule: it is already-realized,
player-visible historical output, not a source used to reconstruct an active
queue or replay mutations. Keeping the rendered speaker/text/title copy
preserves the exact log the player saw across process restart.

Restoring the bounded entries, counter, and last token prevents duplicate
history entries on the first post-load view. Historical transcript copy is not
an authoritative static-definition reference and cannot affect gameplay state.

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
    items: Vec<DialogueItem>,
}
```

A linear scene uses one segment. Investigation and interrogation commands may
install several ordered segments in one queue. Empty authored segments are
omitted before queue installation; a queue with no remaining items is `None`.

The public `QueueToken` retains its existing flattened `cursor` for frontend
compatibility. Its value is normative:

```text
flattened_cursor =
  sum(segments[0..active_segment_index].items.len()) + item_cursor
```

The sum includes every raw dialogue item, including scene tags already consumed
within earlier positions. Persistent state records both segment/item
coordinates and preserves `queue_gen` exactly. Capture and restore must prove
that the token for the same logical visible item is identical before and after
load; this preserves stale-action rejection and `DialogueHistory.last_token`
deduplication. Overflow, an out-of-range segment, or an out-of-range item cursor
rejects capture/load rather than saturating.

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

The four closed re-examination roles—hotspot, topic, evidence, and
statement—receive the compiler-materialized action `（沒有新發現。）` when their
authored `onReexamine` target is missing or empty. The resolver consumes that
emitted item under the same semantic origin used by authored content. Other
missing or empty dialogue targets remain invalid. Because the materialized
item is part of the canonical emitted bundle, changing its copy or
applicability changes the package `contentRevision`; live installation and
restoration cannot silently drift.

Future analysis/story-event origins require new schema variants or migrations;
HPA-392 does not pre-implement those runtimes.

### 8.3 Capture and reconstruction

`ActiveDialogueStateV1` stores:

```rust
struct ActiveDialogueStateV1 {
    segment_origins: Vec<DialogueSegmentOriginV1>,
    active_segment_index: usize,
    item_cursor: usize,
    queue_gen: u64,
}
```

It does not store `items`. The envelope's exact `contentRevision` match proves
the packaged static dialogue bundle is unchanged. Restore resolves every
origin in order, rebuilds its items, verifies cursor bounds, and then installs
the reconstructed queue. It does not replay reveals or inventory mutations to
rebuild the queue.

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
}
```

An event ID uses the fixed format `acq:<command_id>:<ordinal>`, where ordinal
starts at `0` within that command. The loader recomputes and validates the ID
from the stored numeric fields. One command acquiring several records produces
distinct events in deterministic reveal order. Re-acquiring an already-owned
record produces no event.

The persisted `id` is intentionally redundant. The numeric command/ordinal
pair is canonical, and the recomputed-ID equality check is a corruption
tripwire rather than a second source of identity.

Pending events exist only until acknowledgement. The command transaction
derives its command ID from the rollback-tracked durable revision; a failed
command restores the revision, inventory, and pending events together.

### 9.2 Presentation

`GameStateView` exposes at most one `pendingAcquisition`:

- only pending events are eligible;
- authored dialogue always drains first;
- event ordering follows command ID then ordinal;
- the view resolves the current record presentation from packaged definitions.

The Svelte acquisition controller stops inferring inventory differences. It
renders the Rust-provided event and invokes
`prepare_save_thumbnail({ type: "acquisitionAcknowledgement", eventId })` when
the player chooses to dismiss the popup. The returned ticket is bound to the
current session generation, current durable revision, and exact pending event.
While the popup remains visible, Svelte captures the marked gameplay root
beneath it and submits either the PNG or a terminal capture failure.

The frontend then invokes
`acknowledge_acquisition_event(eventId, preparedThumbnailTicket)`.
Acknowledgement is a durable Rust command. It atomically verifies and consumes
the event-bound ticket, advances the revision, refreshes the session autosave
with the accepted image or `Unavailable`, and returns success only after the
authoritative slot replacement. A post-commit sidecar cleanup failure follows
§12.2's cleanup-pending/degraded result but does not undo the durable
acknowledgement. The post-command wrapper carries no second capture request.
The frontend does not close the popup until this command returns a committed
result, preventing a successfully acknowledged event from reappearing after a
process exit between dismissal and the normal debounce.

Until the slot replacement succeeds, the acknowledgement mutation remains
rollback-capable behind the replacement gate. An authoritative write failure
before JSON replacement restores the prior durable revision and pending event
before returning its typed failure, so Retry begins from the same visible popup
and prepares a fresh capture ticket. This synchronous durability path is the
deliberate exception to background autosave failure leaving an ordinary
gameplay mutation committed.

The command acquires the replacement gate before the session lock, retains an
`EngineRollbackSnapshot`, and registers an exclusive acknowledgement intent
that makes every other gameplay state command—including `get_state`—fail fast
until resolution, so no caller can observe the provisional acknowledged view.
It applies and captures the acknowledgement checkpoint, then releases the
session lock while retaining the gate for file I/O. Success finalizes the
mutation and checkpoint together; failure reacquires the session lock under the
already-held gate, verifies the intent and unchanged generation, restores the
snapshot, and then releases both. It never holds the gameplay/session mutex
during serialization, PNG/JSON writes, flushes, or directory sync.

This preflight capture is valid for the resulting checkpoint because the
acquisition popup is a filtered sibling outside the gameplay root, and removing
the pending event changes only that excluded presentation. Any intervening
durable mutation, different pending event, session change, expired ticket, or
already-consumed ticket rejects acknowledgement as stale. Capture failure or
timeout still supplies a terminal `Unavailable` result and never blocks the
authoritative acknowledgement merely because no preview could be produced.

If that flush fails, the popup first remains open with Retry and Cancel. A
second explicit confirmation may choose Continue Without Saving. Rust removes
the event from live pending state transactionally and marks persistence
degraded, but allows the popup to close. A later successful autosave persists
the removal; if the process exits first, the event may correctly reappear
because the player explicitly accepted that durability loss.

If the process exits before acknowledgement commits, the event appears again
after resume. That is correct because acknowledgement was never durable.

Acknowledgement does not rotate the autosave ring. The coordinator tracks the
autosave slot chosen by the current session's latest normal gameplay
checkpoint. Acknowledgement refreshes that same slot with a new envelope,
`save_id`, revision, and modification time. If the session has no autosave
target—for example, the first mutation after loading a manual save—the
acknowledgement allocates one slot through normal rotation and then makes it the
session target.

An acquisition checkpoint already pending or in flight and its following
acknowledgement share one target. The coordinator coalesces the latest
acknowledged revision into that target rather than selecting another slot.
Several acquisition events acknowledged in sequence therefore refresh one
autosave and consume no additional recovery points. A failed refresh leaves the
previous slot file intact; the existing Retry/Cancel/Continue Without Saving
behavior still applies. Manual slots are never refresh targets.

Loading an autosave adopts that autosave as the session target. If it contains
a pending acquisition event, acknowledging it intentionally refreshes and
overwrites that adopted autosave slot with the newer durable checkpoint; loading
it alone never writes the file.

## 10. Generic resumable-state fixture

The save subsystem defines an internal definition-bound restore adapter:

```rust
trait ResumableStateAdapter {
    type Snapshot;

    fn capture(&self) -> Self::Snapshot;
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

This adapter is crate-internal and may remain test-facing if a trait adds no
production reuse. It does not introduce a trait tag, erased payload, or generic
JSON bag into the disk schema; the production wire contract remains the closed
typed enums in §7.

A test-only P0 fixture implements the same contract with:

- a stable definition ID resolved from the exact current package revision;
- an incomplete boolean/small-enum mutable state;
- a cursor;
- a required referenced definition;
- a public value that proves the cursor/state restored exactly.

The fixture passes through JSON serialization, exact revision validation,
stable-ID resolution, candidate construction, and transactional replacement in
the test harness. It is not a production scene type, does not add an arbitrary
JSON bag to `SaveSnapshot`, and does not depend on HPA-260's analysis runtime.

## 11. Durable revision and autosave scheduling

### 11.1 Commit signal

`GameEngine` persists one rollback-tracked `durable_revision` counter. Fresh
version-1 state starts at `0`. A durable command derives its ID as
`durable_revision + 1`; on success it commits that same value as the new
`durable_revision`, and on failure the rollback restores the prior revision and
all pending events. Acquisition event IDs use that derived command ID. Read-only
commands, discovery, flush-only work, manual save, and load construction do not
advance the revision.

For every successful durable command:

1. the command mutates inside the existing rollback scope;
2. dialogue history finalizes;
3. the derived command ID and acquisition events finalize;
4. `durable_revision` becomes that command ID;
5. the public view is built;
6. the application-level command wrapper notifies `SaveCoordinator`.

A failed command restores all mutable state and produces no autosave signal.
Read-only commands and save-list discovery do not increment the revision.

Mutating Tauri commands return an application wrapper without putting
persistence state into engine-owned `GameStateView`:

```rust
struct GameplayCommandResultView {
    state: GameStateView,
    thumbnail_capture: Option<ThumbnailCaptureRequestView>,
}

struct ThumbnailCaptureRequestView {
    ticket: String,
    timeout_ms: u32,
}
```

The wrapper issues a request only when the durable revision advanced, except
for acquisition acknowledgement's explicit preflight path below. Stale
queue-token no-ops, read-only commands, and a successfully acknowledged event
return no post-command request. `ticket` is an opaque UUID v4 correlation value
bound inside the coordinator to a typed capture purpose and exact session
identity; it is neither a path nor an authorization secret.

`prepare_save_thumbnail` accepts one closed purpose:

- `ManualSave`, bound to the current session generation and durable revision;
- `AcquisitionAcknowledgement { event_id }`, additionally bound to the exact
  pending event and the one expected next durable revision.

Manual Save requests its ticket after gameplay input is isolated by the save
browser. It does not advance the durable revision. The subsequent
`save_manual` command consumes that exact ticket and rejects it if the session
or revision changed. Acquisition acknowledgement follows the preflight sequence
in §9.2; only that successful command may promote its prepared frame from the
source revision to the bound next revision. Any intervening mutation
supersedes the ticket.

For ordinary gameplay mutations, Svelte first applies the returned `state`,
lets the gameplay root render, and then handles the wrapper's request. For
Manual Save and acquisition acknowledgement, it captures the already-current
root before invoking the consuming command. Every path submits either:

- `submit_save_thumbnail(ticket, png_bytes)`, or
- `report_save_thumbnail_failure(ticket)`.

Rust validates and retains at most one latest candidate/result per typed capture
intent. Older or superseded ticket results are discarded without altering
gameplay. Thumbnail results are bounded before retention; arbitrary frontend
bytes are never written directly to a caller-selected path. Every prepared
ticket reaches one bounded terminal state: accepted bytes, reported failure,
expiry, or supersession. `save_manual` and
`acknowledge_acquisition_event` may wait only for the remainder of that
ticket's 1,000 ms deadline without holding the gameplay/session mutex; expiry
is consumed as `Unavailable`, so preview failure cannot strand the
authoritative operation.

### 11.2 Thumbnail capture and debounce

Autosave uses a 500 ms trailing debounce:

- rapid committed commands coalesce;
- the coordinator captures the latest stable revision after the quiet period;
- it waits at most 1,000 ms for that revision's thumbnail result;
- at most one disk write runs at a time;
- if a newer revision commits during a write, the coordinator schedules one
  follow-up write for the newest revision;
- completed writes record the revision and session generation they contain.

Both time values are fixed in named constants and covered with fake-clock
tests. They are not user-configurable. Thumbnail timeout records
`ThumbnailDescriptorV1::Unavailable` and proceeds with the authoritative save.
It does not hold the gameplay/session mutex or prevent later gameplay commands.

The frontend capture adapter is `GameplayThumbnailCapture`, backed initially by
`html-to-image` behind that narrow interface. It targets the marked gameplay
root after Svelte `tick()`, filters `data-save-thumbnail-exclude` descendants,
sets `pixelRatio: 1`, and calculates one uniform scale that fits the rendered
root inside 480×360 without upscaling. It returns a PNG `Blob` or a typed
capture failure. Within the same deadline it waits for fonts and currently
referenced images under that root to become ready; a timeout produces the normal
unavailable result rather than a partially rendered preview. Menus and modals
are siblings outside the root, so capture requires no visibility flicker.

HPA-392 does not use OS/window screenshot capture, a community Tauri screenshot
plugin, or a duplicate semantic thumbnail renderer. The former would capture
the wrong presentation boundary and may require system recording permission;
the latter would drift from the real Svelte gameplay frame.

Bulk serialization and file I/O must not hold the gameplay/session mutex.
Writes use this ordering:

1. under the session lock, verify the session generation, capture one immutable
   envelope plus revision and matching thumbnail result, and register its
   target/write intent;
2. release the session lock, serialize, write, flush, and sync unique
   same-filesystem temporary sidecar/envelope files in the detailed §12.2
   order;
3. acquire a narrow replacement gate shared with New Game, Load, and Return to
   Title session-generation transitions;
4. under the session lock, revalidate the generation and registered
   target/revision intent, note whether a newer revision now exists, then
   release the session lock while retaining the replacement gate;
5. if stale, skip replacement and clean the temporary files; otherwise commit
   the sidecar, then atomically replace the envelope and sync both parent
   directories without holding the gameplay mutex;
6. under the session lock, record success/health for the written revision and
   schedule a follow-up when the same session has a newer committed revision;
7. release the session lock and replacement gate.

All users acquire the replacement gate before the session lock when both are
needed. This prevents a stale session from replacing a slot while keeping
gameplay responsive during the long temporary-file write.

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
- acquisition acknowledgement response, using the in-place session autosave
  target from §9.2.

Flush idempotence is operation-independent but scoped to one session
generation. The coordinator records the written `(session_generation,
durable_revision)` pair; a flush performs no write, replacement, rotation, or
timestamp change only when the written generation equals the current generation
and its revision is at least the current durable revision. This applies to
manual-save preflush, confirmed load, Return to Title, and acquisition
acknowledgement as well as ordinary debounced flushes. A high revision from an
older generation can never satisfy or suppress a new session's flush.

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
  thumbnails/
    <opaque-save-id>.png
```

Envelope and thumbnail temporary files use unique names in their respective
target directories, keeping every final rename on one filesystem. They are
removed after success or failure where possible. Discovery ignores them and
performs bounded cleanup only after age, filename-shape, and reference checks.

No save path is accepted from the frontend. IPC selects a typed save kind and
bounded slot number. Thumbnail object IDs and paths are Rust-derived from the
opaque checkpoint save ID; display names never participate.

Only builds compiled with `#[cfg(feature = "e2e")]` resolve saves from
`LYRA_E2E_APP_DATA_DIR`. The e2e harness must provide an explicit absolute
temporary directory, and resolution fails before startup if it is missing,
points at the production app-data directory or user home, or runs under a
non-e2e Tauri identifier. Non-e2e builds do not read this environment variable.

### 12.2 Atomic write

For a save with an available thumbnail:

1. retain the authoritative snapshot/metadata and validated PNG in memory;
2. write a unique PNG temporary file under `thumbnails/`, flush, and sync it;
3. atomically install `<save_id>.png` and sync `thumbnails/`;
4. construct/serialize the envelope with the descriptor that actually
   succeeded;
5. write a unique JSON temporary file under `saves/`, flush, and sync it;
6. atomically replace the chosen slot through the platform storage adapter;
7. sync `saves/`;
8. remove the sidecar referenced by the previously committed envelope;
9. sync `thumbnails/`, then report success/update coordinator health.

When capture/validation is unavailable, the sequence skips steps 2–3 and
commits an unavailable descriptor normally. A PNG temporary-write, sync, or
install failure is likewise converted to `Unavailable` after cleaning any new
temporary/object file, then the authoritative JSON write proceeds. A JSON
temporary-write, sync, or replacement failure remains an authoritative
persistence failure and leaves the existing slot and sidecar intact. A newly
installed but not-yet-referenced PNG is removed immediately where possible and
is safe for later orphan cleanup. Failure after JSON replacement but before
old-sidecar deletion leaves only an orphan; the new save always points to its
own sidecar.

Old-sidecar deletion and final directory sync are part of successful
finalization. If either fails after JSON replacement, the new authoritative
save remains committed but persistence health becomes a typed
cleanup-pending/degraded state rather than reporting a fully healthy success.
Retry performs idempotent reference-aware cleanup; discovery may also complete
it after proving the object is unreferenced. A fully successful replacement,
rotation, overwrite, or deletion therefore retains no orphan.

The implementation must use replacement mechanisms with verified macOS,
Windows, and Linux semantics; plain `std::fs::rename` overwrite behavior is not
assumed portable.

### 12.3 Autosave rotation

Autosave selects:

1. the lowest-numbered empty autosave slot, otherwise
2. the autosave slot with the oldest filesystem modification time, with slot
   number ascending as the deterministic tie-breaker.

Valid, corrupt, and incompatible autosaves all participate in the same
five-slot rotation. Rotation is the deliberate replacement policy for
autosaves. Manual files are never selected by autosave.

Normal gameplay checkpoints use that rotation and set the current session's
autosave target. Acquisition acknowledgement is the sole in-place refresh
operation: it replaces that target without another selection. If no target
exists, it performs one normal selection. Loading an autosave adopts its slot
as the new session target; loading a manual save starts with no autosave target.

Starting New Game does not pre-delete saves and shows no warning. The first
committed mutation produces an autosave through normal rotation.
This intentionally means repeated new prologue sessions can rotate out older
autosaves after six writes; manual slots remain untouched. QA covers that
accepted retention behavior explicitly.

Normal replacement gives every checkpoint a new opaque `save_id` and therefore
a new sidecar object. Acquisition acknowledgement refreshes the adopted/current
autosave in place at the slot level but still creates a new checkpoint ID and
thumbnail attempt. Manual overwrite likewise never reuses the prior sidecar
identity.

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
    Invalid {
        metadata: Option<ReadableSaveMetadataView>,
        diagnostic: SaveDiagnosticView,
    },
}

#[serde(rename_all = "camelCase")]
struct SaveMetadataView {
    save_id: String,
    save_type: SaveType,
    schema_version: u32,
    content_revision: String,
    saved_at: String,
    display_name: String,
    thumbnail: ThumbnailAvailabilityView,
    summary: SaveSummaryView,
}

#[serde(rename_all = "camelCase")]
struct ReadableSaveMetadataView {
    save_id: Option<String>,
    saved_at: Option<String>,
    display_name: Option<String>,
    thumbnail: ThumbnailAvailabilityView,
    summary: Option<SaveSummaryView>,
}

#[serde(tag = "type", rename_all = "camelCase")]
enum ThumbnailAvailabilityView {
    Available { width: u32, height: u32 },
    Unavailable { reason: ThumbnailUnavailableReason },
}

#[serde(rename_all = "camelCase")]
struct SaveSummaryView {
    chapter_id: String,
    chapter_title: String,
    scene_id: String,
    scene_title: String,
    active_primary_objective_id: Option<String>,
    active_primary_objective_label: Option<String>,
}
```

`schema_version` and `content_revision` report the source checkpoint's on-disk
values even when discovery applies migrations in memory. `SaveSlotView.reference`
remains the authoritative storage position; `metadata.save_type` must agree
with it. An invalid slot carries best-effort readable presentation metadata
only when the relevant envelope fields parsed independently of snapshot
validation. This preserves an incompatible/corrupt manual save's display name
when readable without treating partial metadata as load permission.

`Valid` means the file passed current non-mutating discovery validation, not
merely that its JSON was readable. Discovery:

1. reads the file and source modification time;
2. parses the minimal version envelope and applies schema migrations in memory;
3. validates path/slot/envelope identity and summary shape;
4. loads the packaged manifest and definitions once for the discovery batch;
5. requires the save's `contentRevision` to match the packaged revision exactly;
6. resolves every saved stable ID against those shared packaged definitions;
7. reconstructs dialogue lengths and validates all scene progress, set
   references, cross-exam state, queue coordinates, history token, counter
   invariants, and summary references without replacing the live engine;
8. for an available thumbnail descriptor, reads at most 1 MiB of encoded
   sidecar data, verifies byte length/digest/signature/IHDR, and reports missing,
   corrupt, or unreadable presentation state without changing slot validity.

A discovery batch performs bounded work outside the engine/session lock: one
shared packaged manifest/definitions load, at most eight slot-file reads, and
at most eight bounded sidecar reads. It parses the shared definitions once,
does not reread packaged scenes per slot, and never decodes thumbnail pixels.
The UI exposes a visible loading state while the batch runs. A failure to load
the save-envelope directory or shared packaged manifest/definitions makes
discovery globally unavailable. A revision mismatch or invalid stable
reference found while validating one save makes only that slot invalid. A
missing/corrupt thumbnail—or an unavailable thumbnail directory—makes only the
affected thumbnail presentation unavailable. Discovery returns the same typed
schema, content-revision, cursor, and progress diagnostics that a load would
return.

Thumbnail image bytes are loaded lazily through
`read_save_thumbnail(reference, observed_save_id)`. Rust rereads the slot
envelope, verifies the observed save ID and sidecar descriptor, and returns
bytes only when ownership still matches. Svelte creates a Blob URL and revokes
it when the card changes or unmounts. Filesystem paths and object IDs do not
cross IPC.

Load still re-reads the selected file, verifies the observed `save_id`, and
repeats all validation before building/swapping the candidate engine. This
closes the discovery-to-load race; a prior `Valid` result is not permission to
trust a file that changed afterward.

Filesystem modification time is the authoritative recency key for rotation
and Continue. This allows an unparseable newest file to remain newest and block
Continue as approved. A valid envelope's `saved_at` remains the user-facing
timestamp.

This is an app-owned local-filesystem policy, not a mathematically monotonic
cross-device clock. `durable_revision` cannot rank files across sessions
because it restarts at New Game, and `saved_at` is also wall-clock based.
External backup restoration, cloud synchronization, manual mtime mutation, and
system-clock rollback may therefore alter the perceived order and are outside
HPA-392's guarantees. Adding a transactional global write ledger solely to
cover those external mutations is out of scope.

Continue uses one total newest-first ordering:

1. filesystem modification time;
2. when both tied files are valid, envelope `saved_at`;
3. a fixed storage-key fallback: manual before auto, then higher slot number.

The last rule is only a deterministic fallback for filesystems whose timestamp
resolution cannot distinguish writes, including ties involving an invalid file.
It does not permit skipping a higher-ranked invalid file. When both comparable
timestamps are exactly equal, manual-before-auto intentionally prefers the
explicit player-authored checkpoint. A later autosave still wins whenever
either filesystem modification time or valid `saved_at` distinguishes it.

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

Parse, migration, content-revision, definition, and I/O failures do not delete
or modify the source save. Successful schema migration happens in memory; the
original file is not rewritten during load. A later manual save or autosave
creates a new current envelope through normal policy.

Confirmed deletion removes the slot JSON first and its referenced thumbnail
second. A crash can therefore leave only an unreferenced sidecar, never a
remaining save that deletion itself stripped of its image. Orphan cleanup never
deletes a sidecar still referenced by any of the eight slot envelopes.

## 13. Transactional load

Load never mutates the live engine incrementally:

1. read the selected file;
2. parse a minimal version envelope;
3. run sequential schema migrations in memory;
4. validate slot/envelope consistency;
5. load the packaged content manifest and require an exact revision match;
6. load current packaged chapters, scenes, and catalog;
7. resolve all saved stable IDs;
8. reconstruct dialogue segments and scene progress;
9. build a complete candidate `GameEngine`;
10. build its public view and validate summary invariants;
11. acquire the replacement gate without holding the session lock;
12. under the session lock, verify that the requested session generation is
    still current;
13. replace the live engine and reset the persistence generation;
14. release the session lock and replacement gate, then return the already
    validated candidate view.

Any failure before step 13 leaves the existing engine, autosave coordinator,
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

Return to Title first flushes the current revision, then acquires the
replacement gate before the session lock, cancels its session generation, sets
the engine to `None`, and returns a freshly discovered save list. New Game and
title-screen Continue likewise construct their candidate outside both locks,
then acquire the replacement gate before the session lock for the generation
transition. Continue therefore proves the disk restoration path instead of
reusing an in-memory engine.

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

### 14.2 Content compatibility

Version 1 has no per-definition content-migration registry. The package
`contentRevision` must match exactly or the save is incompatible. The loader
does not guess by label, prose, array position, similar ID, or partial
dependency matching, and it never silently resets progress.

This keeps the initial contract aligned with the release assumption in §5.2:
pre-release content changes may invalidate development saves, while released
static content is immutable. A future shipped release that must retain saves
across a static-content change requires a separately designed, explicit
whole-revision migration; it is not pre-generalized by HPA-392.

## 15. Tauri command surface

The Rust shell exposes narrow typed commands:

```text
list_saves
get_persistence_status
get_thumbnail_activity
start_game
start_game_without_saving
prepare_save_thumbnail
submit_save_thumbnail
report_save_thumbnail_failure
read_save_thumbnail
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

Existing engine methods continue to return `GameStateView`; mutating Tauri
handlers wrap that view in `GameplayCommandResultView` (§11.1), schedule
autosave after a successful durable revision, and issue a thumbnail ticket only
for an advanced revision other than preflight-backed acquisition
acknowledgement. `GameStateView` remains engine-owned and does not absorb
coordinator health or capture coordination.

This wrapper is an intentional breaking change to the app's internal mutating
IPC response shape. The frontend updates the central `dispatchGameCommand` and
`dispatchStateCommand` boundaries to unwrap `.state`, schedule any
`.thumbnailCapture`, and keep all downstream game-state consumers on
`GameStateView`. The development HTTP bridge must mirror the Tauri wire shape.
Read-only commands retain their existing result types. Focused contract tests
cover both dispatch boundaries so a mutating command cannot accidentally be
treated as a bare state.

`prepare_save_thumbnail` accepts only the closed Manual Save or
Acquisition Acknowledgement purpose from §11.1. `save_manual` accepts a bounded
manual slot, the display-name input, the observed prior `save_id` for overwrite
(or an explicit empty expectation), and the prepared Manual Save ticket.
`acknowledge_acquisition_event` accepts the exact event ID and its prepared
acknowledgement ticket. `read_save_thumbnail` accepts only a typed slot
reference plus observed save ID. No command accepts an application-data path
or thumbnail object ID.

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
the rendered copy. Every event payload is the complete current
`PersistenceHealthView`, never a delta, so a missed or duplicated event cannot
require frontend state reconstruction.

Thumbnail presentation is separate:

```rust
#[serde(tag = "type", rename_all = "camelCase")]
enum ThumbnailActivityView {
    Idle,
    Capturing,
    Unavailable { diagnostic: ThumbnailDiagnosticView },
}
```

Capture activity may be returned with a save result or emitted as a complete
`thumbnail-activity-changed` payload; `get_thumbnail_activity` supplies the
initial/current value. It never changes
`PersistenceHealthView::Healthy` into `Degraded`, because a valid authoritative
save exists without a thumbnail.

Conceptual public save types:

```ts
type SaveSlotRef =
  | { type: "auto"; slot: 1 | 2 | 3 | 4 | 5 }
  | { type: "manual"; slot: 1 | 2 | 3 };

type SaveMetadataView = {
  saveId: string;
  saveType: "auto" | "manual";
  schemaVersion: number;
  contentRevision: string;
  savedAt: string;
  displayName: string;
  thumbnail:
    | { type: "available"; width: number; height: number }
    | {
        type: "unavailable";
        reason: "captureUnavailable" | "missing" | "corrupt" | "readFailed";
      };
  summary: {
    chapterId: string;
    chapterTitle: string;
    sceneId: string;
    sceneTitle: string;
    activePrimaryObjectiveId: string | null;
    activePrimaryObjectiveLabel: string | null;
  };
};

type SaveSlotStatusView =
  | { type: "empty" }
  | { type: "valid"; metadata: SaveMetadataView }
  | {
      type: "invalid";
      metadata: {
        saveId: string | null;
        savedAt: string | null;
        displayName: string | null;
        thumbnail: SaveMetadataView["thumbnail"];
        summary: SaveMetadataView["summary"] | null;
      } | null;
      diagnostic: SaveDiagnosticView;
    };

type SaveSlotView = {
  reference: SaveSlotRef;
  modifiedAt: string | null;
  status: SaveSlotStatusView;
};

type SaveBrowserView = {
  discovery:
    | { type: "loading" }
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
- manual display-name trimming, grapheme count, and forbidden characters;
- session generation;
- save/load availability;
- thumbnail-ticket purpose/session/revision/event ownership and PNG bounds;
- event identity and pending-state.

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

- its thumbnail at the captured natural aspect ratio, or a deterministic
  placeholder;
- its display name;
- chapter title;
- scene title;
- active primary objective label, or a localized no-active-objective state;
- Autosave or Manual Save;
- local saved date/time.

An invalid entry shows its slot identity, any independently readable display
name/summary, and its typed diagnostic. It is disabled for Load but remains
selectable for details and deletion. Empty entries use a clear empty-slot state.
A missing/corrupt/unreadable thumbnail changes only the image to the
deterministic placeholder with `Preview unavailable`; it does not make the
slot invalid.

Save mode shows only the three manual slots. Choosing any slot opens a name
prompt before capture/write. An empty slot is prefilled with the generated
chapter/scene suggestion. An occupied slot is prefilled with its independently
readable valid existing name, or the generated suggestion when that name cannot
be safely reused; after name validation it opens overwrite confirmation
containing the old slot metadata/thumbnail and current-game metadata. Rust
repeats name and stale slot validation at commit.

Thumbnail bytes load lazily through `read_save_thumbnail`; each card owns and
revokes its Blob URL. Images use their intrinsic dimensions and `object-fit:
contain`, never non-uniform scaling. Cards do not receive or construct
filesystem URLs.

### 16.3 Escape menu

The root Escape menu adds:

- Save Game;
- Load Game;
- Return to Title.

The two browser modes share components but remain distinct root actions. Escape
closes the topmost confirmation, then the name dialog, then returns from the
save browser to the root menu, then closes the menu. Focus returns to the
control that opened each dismissed layer.

Saving is allowed during stable dialogue, investigation, and interrogation
views. Frontend-only typewriter or fade animation does not make the Rust engine
unstable. A command already holding the session mutation boundary serializes
before save capture. Save Game isolates gameplay input, obtains an opaque
thumbnail ticket, captures the marked gameplay root beneath the menu, and
submits success/failure before `save_manual` consumes the ticket. The menu never
needs to hide or flicker because it is outside the capture root.

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
- clears pending thumbnail requests and revokes all save-card Blob URLs;
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
- incompatible package content revision;
- missing required definition;
- invalid runtime progress or cursor;
- empty, over-limit, or forbidden-character manual display name;
- malformed, oversized, or out-of-bounds submitted PNG;
- stale/superseded thumbnail ticket;
- mismatched acquisition-acknowledgement ticket purpose or event;
- gameplay state command attempted while acknowledgement persistence is
  unresolved;
- stale manual-overwrite confirmation;
- stale session generation;
- unavailable or stale persistence-bypass confirmation;
- unknown/non-pending acquisition event.

Messages name the affected slot and give a user action where one exists. They
do not expose arbitrary absolute filesystem paths in the normal UI.

Thumbnail presentation diagnostics use a separate closed reason:

```rust
enum ThumbnailUnavailableReason {
    CaptureUnavailable,
    Missing,
    Corrupt,
    ReadFailed,
}

struct ThumbnailDiagnosticView {
    reason: ThumbnailUnavailableReason,
    message: String,
    retryable: bool,
}
```

Capture/encoding failure, the 1,000 ms timeout, or a rejected PNG records
`CaptureUnavailable` in the newly written envelope. A missing, digest-mismatched,
malformed, or unreadable sidecar maps to the other discovery reasons. None
changes the slot's authoritative valid/invalid classification.

`ThumbnailActivityView::Unavailable` exposes a non-blocking `Preview
unavailable` warning. Before envelope commit, the capture adapter may retry on
the same ticket only while the exact session/revision and rendered gameplay
frame remain current and the 1,000 ms window has not elapsed. After envelope
commit, gameplay advance, or process restart, the application keeps the
placeholder rather than rewriting checkpoint recency or capturing a newer
frame for an older checkpoint.

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

A thumbnail failure is not a Manual Save failure: the authoritative envelope
still commits and the success result identifies the missing preview. Conversely,
a save-envelope write failure is never hidden behind a thumbnail warning.

## 18. Verification

### 18.1 Compiler tests

- `contentRevision` is deterministic across repeated compilation.
- One canonical fixture has a checked-in exact golden revision, and the focused
  test produces that same digest on macOS and Linux rather than checking only a
  hash-shaped string on one host.
- The compiler emits one complete, versioned
  `save_content_manifest.json` containing the exact package revision.
- Missing/empty re-examination blocks for all four supported roles emit the
  exact fallback action before hashing; changing that copy or applicability
  changes the golden/content revision.
- Any emitted static semantic change—including prose, labels, descriptions,
  dialogue order, scene order, cues, IDs, or progression—changes the revision.
- Object/source ordering that is not emitted semantics does not affect the
  revision.
- Source locations, raw Markdown formatting, absolute paths, and timestamps do
  not affect the revision.
- Every resumable dialogue block receives one stable origin.
- Reordering or inserting sibling hotspots, topics, phases, questions, or
  testimony lines leaves every unaffected segment origin unchanged.
- Every dialogue-bearing field maps to one derived role key, and any
  derived-origin collision fails with source locations.
- Existing Chapter 1 compiles and produces a loadable content manifest.

### 18.2 Rust schema, capture, and restore tests

- Serialize and deserialize schema version 1.
- Round-trip display-name and thumbnail descriptors without placing either in
  `SaveSnapshotV1`.
- Prove exhaustive `GameEngine` field classification fails to compile when a
  new field is neither persistent, immutable, derived, nor rollback-only.
- Round-trip linear dialogue at a nonzero cursor.
- Round-trip `GameComplete` with final chapter/scene IDs, validate those final
  definitions, and reinstate the completion sentinel after restore.
- Round-trip investigation progress and active dialogue.
- Round-trip interrogation phase, cross-exam, line-content boundary, and active
  dialogue.
- Derive `intro_queue_gen` from active intro state and reject an impossible
  unplayed non-empty intro without its active segment.
- Restore `line_content_start` only from a validated testimony-content boundary
  and restore `CrossExam::Playing` from one stable line ID.
- Restore `CrossExam::Presenting` to the exact stable line with
  `presenting: true`, causing the evidence tray—not the line-content or
  question-menu view—to reappear.
- Preserve inventory per-kind order, record IDs, and collected/acquired
  chapter/scene provenance without authored record copy.
- Preserve HPA-255 story state and active-primary uniqueness.
- Preserve the bounded dialogue transcript, next ID, last token, visual/audio
  cue IDs, queue generation, and durable revision.
- Round-trip a fresh engine's non-optional default `last_visual_cue` object.
- Restart restored BGM/BGS assets from the beginning, preserve carried
  cross-scene cues, and restore explicit silence without changing preferences.
- Derive each command ID as `durable_revision + 1`; prove failed commands roll
  the revision and pending events back while acknowledgement advances the
  revision and flush/manual-save do not.
- Reject past-end linear mid-transition state and preserve active investigation
  outro/interrogation phase-entry queues at their committed boundaries.
- Sort set-backed fields deterministically.
- Reject a package `contentRevision` mismatch before candidate construction.
- Reject missing current/required stable IDs even after the revision matches.
- Rebuild pending dialogue from unchanged packaged copy and preserve
  already-recorded historical transcript copy.
- Reject malformed snapshot override references and round-trip every closed
  investigation/interrogation override variant.
- Reject inconsistent scene/runtime/cursor combinations.
- Prove a failed load leaves the live engine's public view and coordinator
  generation unchanged.
- Pass the generic resumable-state fixture through JSON, exact revision
  validation, stable-ID resolution, candidate construction, and transactional
  replacement.

### 18.3 Dialogue and acquisition tests

- Reconstruct one linear segment at the same item.
- Reconstruct composite multi-segment queues at the same segment and item.
- Derive the public flattened cursor from segment lengths and prove the
  pre-load/post-load `QueueToken` and history last token are identical.
- Preserve order across `onCollect`, `onAcquire`, result, and reveal segments.
- Reject stale queue tokens after normal advancement.
- Create one acquisition event per newly acquired record.
- Roll back command IDs and events when a command fails.
- Hide pending acquisition until authored dialogue drains.
- Persist a pending event and present it after resume.
- Bind acknowledgement preflight capture to the exact session/revision/event,
  reject intervening mutation or event drift, and emit no post-command ticket.
- Flush acknowledgement before popup dismissal succeeds; on pre-replacement
  authoritative failure, roll back the revision/event, retain the popup, and
  require Retry to prepare a fresh ticket; after replacement, preserve the
  acknowledgement through any cleanup-pending degradation.
- While acknowledgement persistence is unresolved, reject every other gameplay
  state command and prove no read can observe its provisional acknowledged
  view.
- Remove an acknowledged event from pending state and never present it after a
  successful checkpointed resume.
- Treat stored event IDs as corruption tripwires and reject a value that does
  not match its command ID and ordinal.

### 18.4 Storage and coordinator tests

Use temporary directories, a fake clock, a fake filesystem replacement layer,
and a controllable writer:

- fill five autosave slots, write a sixth, and replace only the oldest;
- prefer empty autosave slots in numeric order;
- never rotate into manual slots;
- list five autosaves and three manual slots in stable groups;
- validate manual names at 0, 1, 40, and 41 grapheme clusters; preserve composed
  and decomposed Unicode, emoji sequences, and internal whitespace; reject
  controls and Unicode line separators;
- generate deterministic chapter/scene suggestions, shorten only at grapheme
  boundaries, preserve a readable valid occupied manual name by default, fall
  back for an unusable name, and prevent all display-name influence on paths;
- accept only bounded PNG submissions with matching signature, IHDR,
  dimensions, byte length, and digest;
- reject a noncanonical checkpoint/object-ID pair before resolving any
  thumbnail path;
- reject stale/superseded thumbnail tickets; bind ordinary candidates to one
  session generation plus durable revision and acknowledgement preflight
  candidates additionally to one event plus expected next revision;
- reach one terminal result for every prepared ticket; time out thumbnail
  capture after 1,000 ms and still commit a valid envelope with
  `thumbnailUnavailable`;
- mark a slot `Valid` only after non-mutating schema migration, exact
  `contentRevision` validation, stable-ID resolution, and snapshot validation;
- mark a differing `contentRevision` incompatible without attempting partial
  definition matching;
- repeat validation and reject a changed `save_id` between discovery and load;
- select Continue by filesystem recency across both save types;
- resolve equal-mtime Continue candidates by valid `saved_at`, then the fixed
  manual/auto and slot-number fallback;
- let an unparseable newest file block Continue;
- manually load an older valid file;
- preserve existing files on temporary-write, sync, and replacement failure;
- inject failure before/after PNG install, JSON replacement, and old-sidecar
  deletion; prove the committed envelope never points at another checkpoint's
  thumbnail;
- ignore stale temporary files during discovery;
- remove unreferenced temporary/thumbnail files without deleting any sidecar
  referenced by the eight slot envelopes;
- preserve corrupt/incompatible source files after failed reads or migrations;
- mark `manual-2.json` invalid when its envelope claims another type/slot;
- delete only the explicitly selected slot and its referenced sidecar, JSON
  first;
- reject stale manual overwrite confirmation;
- coalesce rapid revisions into one 500 ms autosave;
- schedule a follow-up write when a revision commits during a write;
- prevent stale session generations from replacing slots;
- reject without-saving commands before a matching persistence failure and
  after their session generation becomes stale;
- flush before manual save, in-game load, Return to Title, and acquisition
  acknowledgement;
- prove every same-generation idempotent flush
  (`written_revision >= durable_revision`) makes no write, replacement,
  rotation, or timestamp change, while an older generation can never suppress
  a new session's flush;
- rotate at most once for an acquisition checkpoint plus its acknowledgement,
  then refresh that same autosave for sequential acknowledgements;
- allocate one autosave target when acknowledgement has none, adopt a loaded
  autosave's slot, and never refresh a manual slot;
- after loading an autosave with a pending event, acknowledge it and prove the
  adopted autosave is intentionally refreshed in place;
- preserve the prior autosave file when an acknowledgement refresh fails;
- prove an older high-revision session does not outrank a newer low-revision
  session merely because of `durable_revision`;
- retain committed gameplay and expose save health on background failure;
- publish full Healthy/Pending/Degraded status payloads without putting
  coordinator state in `GameStateView`;
- prove gameplay commands remain responsive during temporary-file writes and a
  stale generation cannot pass the replacement gate;
- prove Load, Continue, New Game, and Return to Title acquire the replacement
  gate before the session lock and cannot deadlock with a writer holding the
  gate;
- return one global discovery error rather than eight fabricated invalid slots
  when directory enumeration or the shared packaged manifest fails, while
  keeping file-specific revision/reference mismatches per-slot;
- preserve readable display-name/summary metadata on incompatible or
  snapshot-corrupt slots;
- treat missing, malformed, digest-mismatched, and unreadable thumbnails as
  presentation-only unavailable states;
- count one shared packaged manifest/definitions load, one definitions parse,
  at most eight slot-file reads, and at most eight bounded sidecar reads per
  discovery batch without holding the engine/session lock or decoding pixels;
  assert visible loading state rather than timing.

### 18.5 Svelte tests

- When discovery succeeds, title Continue/Load is disabled only when no files
  exist.
- Global discovery failure disables Continue/Load and gates Play Without Saving
  behind a second confirmation.
- Continue diagnostic opens Load Game on the failed newest slot.
- Shared browser renders valid, invalid, and empty states.
- Valid rows render the complete save metadata contract; package-revision
  incompatibilities render the discovery diagnostic before Load is selected.
- Cards render intrinsic-ratio thumbnails, deterministic placeholders, and
  readable invalid-slot names without constructing filesystem URLs.
- Lazy thumbnail loads pass slot plus observed save ID, revoke stale Blob URLs,
  and fall back on image decode failure.
- Browser renders all five autosaves and all three manual slots.
- Empty manual slots prefill the generated name; occupied slots retain a
  readable valid name or fall back to the suggestion; mirrored
  1–40-grapheme validation blocks submission before Rust.
- Manual overwrite and deletion require confirmation.
- In-game Load requires confirmation; title Load does not.
- Flush failures require Retry/Cancel before the distinct without-saving
  confirmation becomes available.
- New Game starts without an existing-save warning.
- Escape steps back through confirmation/name dialog/browser/root menu.
- Successful load clears transient overlays and restores focus.
- The capture adapter targets only the marked gameplay root, filters excluded
  descendants, waits boundedly for current fonts/images, calculates uniform
  480×360 bounds, avoids upscaling, and reports capture failure without throwing
  through gameplay dispatch.
- Mutating command results trigger capture only after the new Svelte view
  renders; stale capture responses cannot attach to a newer revision.
- Both central mutating dispatch boundaries unwrap
  `GameplayCommandResultView.state`, handle optional capture requests, and
  preserve bare result types for read-only commands and HTTP/Tauri parity.
- Acquisition acknowledgement captures the gameplay root beneath the still-open
  excluded popup before invoking the event-bound consuming command; a failed
  flush leaves that popup visible.
- Save-health warning persists until a successful save/flush clears it.
- Persistence status events update the warning after background writes without
  a gameplay command.
- Acquisition popup renders Rust event state rather than inventory diffs.
- Acquisition Continue Without Saving warns that acknowledgement may reappear
  after restart.

### 18.6 Packaged Tauri E2E

The debug e2e build proves real app-data storage and process boundaries:

1. Create a Unicode-named manual save with its own thumbnail during
   single-segment dialogue, Return to Title, and Continue at the same dialogue
   item after process-boundary discovery.
2. Save during a composite queue and resume the same segment/item.
3. Save after one command acquires two records while its authored dialogue is
   active, resume, drain dialogue, acknowledge both popups, and prove the
   preflight thumbnails belong to the resulting acknowledgement checkpoints,
   the acknowledgements refresh one autosave target without rotating twice,
   and no post-command capture deadlocks; return to title and prove neither
   popup reappears.
4. Exercise incomplete investigation and interrogation state.
5. Create six autosaves and prove only the latest five remain, each card's
   thumbnail ownership matching its JSON checkpoint after restart.
6. Overwrite a manual slot only after name prompt plus confirmation, preserve
   the old name by default, replace its thumbnail, and leave no prior sidecar.
7. Corrupt the newest file, prove Continue stops with its diagnostic, then load
   an older valid file manually.
8. Return to Title and prove Continue reconstructs from disk rather than a live
   in-memory engine.
9. Force thumbnail capture failure, prove the save remains loadable with a
   deterministic placeholder, then prove a missing/corrupt sidecar likewise
   does not affect compatibility.
10. Delete a manual save and prove both its card and owned thumbnail disappear
    without affecting any other slot.

E2E tests use an isolated app-data directory and clean only that test-owned
directory. The harness requires an explicit temporary HPA-392 app-data path and
refuses to start or clean when it resolves to the production application-data
directory, the user's home directory, or a non-test Tauri identifier. CI never
discovers or mutates real user saves.

The harness supplies that path through `LYRA_E2E_APP_DATA_DIR`; only the
feature-gated e2e resolver honors it. Coverage includes refusal cases for a
missing, relative, production, home, or non-e2e-identifier path.

### 18.7 Final gates

Before HPA-392 implementation is complete:

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
- the canonical content-revision fixture produces its checked-in digest on
  macOS and Linux;
- a packaged Tauri `html-to-image` proof captures Lyra backgrounds, portraits,
  fonts, dialogue, gradients, and clipped UI correctly;
- packaged Tauri HPA-392 E2E scenarios pass.

The packaged capture proof runs before save-browser UI implementation becomes
the committed direction. If it fails the approved visual contract, work stops
at that gate and returns to design to select and prove another implementation
behind `GameplayThumbnailCapture`. The feature may not be declared complete by
turning every thumbnail into `Unavailable`.

## 19. Expected implementation areas

Planning must respect this dependency order:

1. materialize the four-role re-examination fallback in emitted content, remove
   the unhashed runtime fallback copy, and pin the package revision with a
   cross-host golden fixture;
2. add the versioned envelope/snapshot, exhaustive capture/restore adapters,
   durable revision, and Rust-owned pending acquisition events with focused
   round-trip tests;
3. add manual-name validation, storage, migrations, bounded discovery,
   autosave coordinator/replacement gate, thumbnail tickets, PNG validation,
   atomic sidecar ownership, and failure-injection tests;
4. add typed Tauri/HTTP command wrappers, update both central frontend dispatch
   boundaries, add persistence/thumbnail client state, and complete the
   Rust-event-backed acquisition-controller rewrite with acknowledgement
   preflight capture;
5. prove `html-to-image` in the packaged Tauri WebView, then add the shared
   save browser/cards/name prompt/confirmations and title/Escape-menu flows;
6. add packaged HPA-392 E2E coverage and run the full cross-stack verification
   gates.

PR #27 already delivered compiler-owned content identity,
`ActiveDialogueQueue`, stable origins, and capture/reconstruction seams. HPA-392
must consume those boundaries rather than reimplementing canonicalization,
per-definition hashes, queue identities, or a second static-definition store.

Likely implementation touches:

```text
packages/scripts/compile-scenes/
packages/scripts/compile-scenes/save-content-manifest.test.ts
apps/game/src-tauri/src/game/save/
apps/game/src-tauri/src/game/acquisition.rs
apps/game/src-tauri/src/game/command_tx.rs
apps/game/src-tauri/src/game/dialogue.rs
apps/game/src-tauri/src/game/loader.rs
apps/game/src-tauri/src/game/scenes/
apps/game/src-tauri/src/game/state.rs
apps/game/src-tauri/src/game/story/
apps/game/src-tauri/src/game/view.rs
apps/game/src-tauri/src/game/mod.rs
apps/game/src-tauri/src/lib.rs
apps/game/src-tauri/examples/dev_engine_server.rs
apps/game/src-tauri/Cargo.toml
apps/game/src/lib/state/
apps/game/src/lib/persistence/
apps/game/src/lib/components/SaveBrowser.svelte
apps/game/src/lib/components/SaveCard.svelte
apps/game/src/lib/components/SaveNameDialog.svelte
apps/game/src/lib/components/SaveConfirmationDialog.svelte
apps/game/src/lib/components/MainMenu.svelte
apps/game/src/lib/components/GameShell.svelte
apps/game/src/routes/+page.svelte
apps/game/e2e-tauri/
apps/game/scripts/build-e2e.mjs
apps/game/wdio.conf.ts
apps/game/package.json
.github/workflows/ci.yml
bun.lock
```

`packages/scene-types/` is intentionally absent: the standalone save-content
manifest is not consumed by the editor and does not belong in the shared
scene-graph wire package.

Planning must keep files focused. In particular, save schema/storage/migrations
must not be appended to the existing `game/mod.rs` facade, and the shared save
browser must not duplicate title and in-game slot rendering.

## 20. Non-goals

HPA-392 does not add:

- cloud sync, cross-device saves, or ordering repair after external mtime/clock
  manipulation;
- accounts or server storage;
- quicksave/quickload hotkeys;
- more than one local run/profile namespace;
- audio preference persistence changes;
- thumbnail cropping, filters, galleries, user-selected images, manual retakes
  after the saved revision is no longer current, or full-resolution screenshot
  archival;
- analysis runtime, board drafts, or analysis result restoration;
- HPA-258's case-file or Continue recap screen beyond save summary metadata;
- HPA-256 provenance/supersession behavior;
- arbitrary generic JSON flags or a generic production scene type;
- a generic per-definition content-migration mechanism.

Analysis-specific draft resume remains owned by HPA-260, with packaged
board/result-dialogue resume accepted by HPA-266.

## 21. Acceptance traceability

| HPA-392 outcome | Design coverage |
| --- | --- |
| Round-trip every current runtime | §§7, 8, 13, 18.2 |
| Resume one dialogue segment exactly | §§8.1–8.3, 18.3 |
| Resume composite dialogue exactly | §§8.1–8.3, 18.3 |
| Acquisition acknowledgement appears once without consuming recovery depth | §§2, 9, 11.1–11.3, 12.3, 18.3–18.6 |
| Acknowledgement thumbnail and durable refresh complete before the popup closes | §§2, 9, 11.1, 18.3–18.6 |
| Generic incomplete resumable fixture | §10, §18.2 |
| Five visible latest autosaves | §§2, 12.3–12.4, 16.2, 18.4 |
| Invalid newest blocks Continue | §§2, 12.4, 16.1, 18.4 |
| Slot validity includes compatibility/progress checks | §§12.4, 13, 18.4–18.5 |
| Stable compiler-owned segment identity | §§5.1, 8.2, 18.1 |
| Compiler-owned reexamine defaults cannot drift between live play and resume | §§5, 8.2, 18.1 |
| Any static semantic content change invalidates older saves | §§5, 8.2, 13, 14, 18.1–18.2 |
| Missing definitions reject transactionally | §§7, 13, 17, 18.2 |
| Degraded-storage warning and explicit escape | §§11.3, 15–17, 18.4–18.5 |
| Manual overwrite confirmation | §§15, 16.2, 18.4–18.6 |
| Unicode named manual saves survive restart/overwrite/load | §§2, 6, 12.4, 15–16, 18.4–18.6 |
| Names never affect filesystem paths | §§2, 6, 12.1, 15, 18.4 |
| Clean, aspect-ratio-preserving thumbnails | §§2, 6, 9, 11.1–11.2, 16.2–16.3, 18.4–18.6 |
| Save/thumbnail rotation, overwrite, and deletion stay aligned | §§12.2–12.5, 18.4, 18.6 |
| Thumbnail failure leaves a loadable save with placeholder | §§6, 11.2, 12.4, 17, 18.4–18.6 |
| Missing/corrupt thumbnail does not affect compatibility | §§12.4, 17, 18.4–18.6 |
| Save to title to Continue | §§13, 16.1, 18.6 |

The original corrupt-primary automatic fallback criterion is intentionally
superseded by five visible autosaves plus explicit manual recovery through Load
Game.
