# HPA-521 Single-Owner Save Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Lyra's custom save writer queue/lock graph with one concrete application persistence owner and one async serialization gate, while preserving exact autosave identity, HPA-549 no-thumbnail autosave behavior, HPA-550 dynamic thumbnails, stale-action safety, and exit/load guarantees.

**Architecture:** `ApplicationPersistence` becomes the only persistence owner held by `AppState`. One `tokio::sync::Mutex<()>` serializes disk mutation and final session replacement. Autosave debounce and terminal-thumbnail waiting remain outside that gate. Autosave checkpoint capture is bound to the pending `(session_generation, durable_revision)` before staging and the same identity is revalidated immediately before commit. `SaveCoordinator`, `WriterQueue`, `replacement_gate`, `AutosaveBackend`, `CoordinatorFuture`, the custom scheduler/fallback runtime, and queue-only counters are deleted rather than renamed.

**Tech Stack:** Rust, Tokio, Tauri 2 async runtime, existing `SaveFilesystem` / `StagedAtomicWrite` / atomic slot-write layer, existing Tauri E2E feature gates, Bun/Turbo repository checks.

**Spec:** `docs/superpowers/specs/2026-08-23-hpa-521-single-owner-save-persistence-design.md`

## Global Constraints

- One Linear ticket and one implementation PR for HPA-521.
- No save-schema, disk-layout, content-revision, atomic-replacement, or frontend IPC semantic change.
- HPA-549 remains authoritative: acquisition acknowledgement is an ordinary `AutosaveIfAdvancedWithoutThumbnail` gameplay mutation.
- HPA-550 remains authoritative: retain dynamic save thumbnails, capture tickets, existing deadlines, submit/failure/read IPC, `ThumbnailActivityView`, and non-blocking capture failure.
- Exactly one async `operation_gate` serializes disk mutation and final session replacement.
- The 500 ms debounce sleep and terminal-thumbnail wait happen **before** `operation_gate` acquisition.
- Every autosave/flush captures only the requested operation's exact session generation and durable revision; never bind a newer live checkpoint to an older receipt.
- Every staged autosave/flush revalidates the same generation/revision immediately before commit and discards stale staging.
- Long filesystem work must not hold the gameplay `AppSession` mutex.
- Load/Continue may wait for an in-flight persistence operation; do not preserve the old prepare/replacement overlap with a second gate.
- A waiting delete that becomes stale after replacement must return `staleSessionGeneration` and leave the slot intact.
- `SaveFilesystem` remains the storage/test seam. Do not introduce a replacement `AutosaveBackend`, repository interface, actor, channel, service container, command bus, DI framework, scheduler, or task-spawner trait.
- Keep `ApplicationExit`; production `app.exit` and test exit implementations justify the seam.
- Preserve current failure-token and discovery-generation semantics unless production call-site search proves a field dead.
- Product-behavior test migration outranks test-line reduction. Production net deletion is expected; test counts are measured separately.

---

## Final File Structure

```text
apps/game/src-tauri/src/game/save/
├── application/
│   ├── mod.rs          # ApplicationPersistence + PersistenceState + shared owner surface
│   ├── autosave.rs     # pending autosave, readiness, exact capture, flush, commit, cleanup
│   ├── tickets.rs      # retained HPA-550 thumbnail ticket/activity lifecycle
│   ├── session.rs      # AppSession/SessionPersistence + transition/install/clear
│   ├── exit.rs         # Saving/Failed/Retry/Cancel/Without Saving lifecycle
│   ├── commands.rs     # persistence command cores; no Tauri raw-request decoding
│   └── tests/
│       ├── mod.rs
│       ├── helpers.rs
│       ├── autosave.rs
│       ├── serialization.rs
│       ├── session.rs
│       ├── tickets.rs
│       ├── exit.rs
│       └── commands.rs
├── capture.rs
├── e2e_faults.rs
├── mod.rs
├── restore.rs
├── schema.rs
├── storage.rs
└── thumbnail.rs

apps/game/src-tauri/src/lib.rs  # Tauri setup/events/thin command adapters/gameplay routing
```

`ApplicationPersistence` is the only application persistence type exposed from `game::save::application`. Private modules share its state and gate; they do not define separate owners, services, or traits. If a listed private file stays trivial, fold it into the closest neighboring module rather than preserving a file for ceremony.

Delete before completion:

```text
apps/game/src-tauri/src/game/save/coordinator/mod.rs
apps/game/src-tauri/src/game/save/coordinator/tests/*
```

---

## Required Existing-Test Migration Ledger

Before deleting `coordinator/tests/debounce.rs`, account for every retained product test below. Prefer keeping the same name under `application/tests/`. If a name changes, record `old -> new` in the PR closeout. A test may disappear without a replacement only when the **product rule itself** was intentionally removed, with a one-line reason.

```text
no_thumbnail_analysis_burst_writes_latest_revision_without_thumbnail_activity
no_thumbnail_retry_and_supersession_never_issue_capture_request
stale_no_thumbnail_retry_cannot_replace_a_newer_pending_write
no_thumbnail_retry_does_not_supersede_newer_pending_write_after_eligibility
ordinary_retry_does_not_supersede_newer_pending_write_after_eligibility
debounce_spends_the_existing_ticket_deadline
capture_timeout_writes_unavailable_without_degrading_persistence
revision_during_write_schedules_one_follow_up_for_newest_revision
first_write_success_keeps_health_pending_while_follow_up_is_outstanding
prior_generation_high_revision_never_suppresses_new_generation_low_revision
failed_revision_does_not_timer_loop_and_explicit_actions_retry_once
stale_notify_durable_commit_is_rejected_before_mutating_coordinator_state
stale_notify_durable_commit_cannot_supersede_live_replacement_autosave_ticket
```

Also replace the queue-specific feature-gated test:

```text
replacement_invalidating_queued_delete_returns_stale_session_generation
```

with the product-level successor:

```text
replacement_before_waiting_delete_returns_stale_session_generation_and_preserves_slot
```

Required successor assertions:

```rust
assert_eq!(delete_error.code, "staleSessionGeneration");
assert!(slot_path.exists(), "stale delete must not remove the save");
assert_eq!(
    persistence.persistence_health(),
    PersistenceHealthView::Healthy,
);
```

No migrated test may retain `wait_for_queued_delete_writer`, queue probes, a placeholder writer, scheduler injection, or W/G/S lock labels.

---

### Task 1: Extract the existing application owner into the final module boundary

**Files:**
- Create: `apps/game/src-tauri/src/game/save/application/mod.rs`
- Create: `apps/game/src-tauri/src/game/save/application/session.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Test: existing persistence/storage tests and `lib.rs` tests

**Interfaces:**
- Consumes current `ApplicationPersistence`, `AppSession`, `SessionPersistence`, `SaveFilesystem`, `SaveDiscoveryContext`, `CapturedCheckpoint`, and `SaveEnvelope`.
- Produces `game::save::application::ApplicationPersistence` while the old `SaveCoordinator` still delegates behavior during this move-only task.
- Produces `application::session::{AppSession, SessionPersistence, SessionTransitionIdentity}` as the final home for persistence-facing session metadata.

- [ ] **Step 1: Record the pinned baseline without making test deletion a target**

Run on the HPA-521 base commit:

```bash
wc -l apps/game/src-tauri/src/game/save/coordinator/mod.rs
find apps/game/src-tauri/src/game/save/coordinator/tests -name '*.rs' -print0 | xargs -0 wc -l
wc -l apps/game/src-tauri/src/lib.rs
sed -n '1,2067p' apps/game/src-tauri/src/lib.rs | wc -l
```

Record in the PR description:

```text
coordinator production lines
coordinator test lines
full lib.rs lines
pre-top-level-test lib.rs lines
```

`2067` is the pinned-base line before the current top-level `#[cfg(test)] mod tests`. Do not require final test lines to shrink by a fixed percentage.

- [ ] **Step 2: Move `ApplicationPersistence` storage/discovery behavior to `application/mod.rs` without semantic change**

Move the current fields:

```rust
pub(crate) struct ApplicationPersistence {
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) replacement_gate: Arc<tokio::sync::Mutex<()>>, // temporary until Task 4
    fs: Arc<dyn SaveFilesystem>,
    root: PathBuf,
    discovery: SaveDiscoveryContext,
    last_saved_at: Mutex<Option<DateTime<Utc>>>,
    availability_error: Mutex<Option<GameError>>,
}
```

Move these current methods unchanged:

```text
discover
availability_error
next_saved_at
envelope
run_storage_write_if_session_current
commit_current
```

Keep the existing `impl AutosaveBackend for ApplicationPersistence` temporarily in Task 1. This task is only a module move.

- [ ] **Step 3: Move `AppSession`, `SessionPersistence`, and `SessionTransitionIdentity` to `application/session.rs`**

Preserve generation, flush-baseline, written-revision, autosave-target, and exit-flush semantics exactly. Update imports only.

- [ ] **Step 4: Export the module and remove the local `lib.rs` definitions**

In `save/mod.rs`:

```rust
pub(crate) mod application;
```

In `lib.rs`:

```rust
use game::save::application::{ApplicationPersistence, AppSession};
```

Keep persistence command cores in `lib.rs` for this task.

- [ ] **Step 5: Verify the move on both Rust feature surfaces**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Expected: no behavioral assertion changes.

- [ ] **Step 6: Commit**

```bash
git add apps/game/src-tauri/src/game/save/application \
        apps/game/src-tauri/src/game/save/mod.rs \
        apps/game/src-tauri/src/lib.rs
git commit -m "refactor(save): extract application persistence owner"
```

---

### Task 2: Introduce one operation gate and delete `WriterQueue`

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application/mod.rs`
- Create: `apps/game/src-tauri/src/game/save/application/autosave.rs`
- Create: `apps/game/src-tauri/src/game/save/application/tests/helpers.rs`
- Create: `apps/game/src-tauri/src/game/save/application/tests/serialization.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Delete after green behavior coverage: `apps/game/src-tauri/src/game/save/coordinator/tests/writer.rs`

**Interfaces:**

`ApplicationPersistence` gains exactly one serialization primitive:

```rust
operation_gate: Arc<tokio::sync::Mutex<()>>,
```

Add these concrete methods during Task 2:

```rust
impl ApplicationPersistence {
    fn ensure_session_generation(&self, expected: u64) -> Result<(), GameError>;

    async fn write_manual_current(
        &self,
        session_generation: u64,
        request: SlotWriteRequest,
    ) -> Result<SlotWriteOutcome, GameError>;

    async fn delete_current(
        &self,
        session_generation: u64,
        reference: SaveSlotRef,
        expectation: OccupiedSlotExpectation,
    ) -> Result<SlotDeleteOutcome, GameError>;
}
```

- [ ] **Step 1: Extract the real staged-write filesystem helper instead of creating a new backend fake**

Move the minimum useful behavior from the current storage integration helpers into `application/tests/helpers.rs`:

```text
TrackingFilesystem
TrackingStagedWrite
pause-after-prepare/stage notification pattern
```

The helper must delegate to `ProductionSaveFilesystem` and wrap real `StagedAtomicWrite` values. Add only these test controls:

```rust
active_mutations: AtomicUsize,
max_concurrent_mutations: AtomicUsize,
pause_after_stage: AtomicBool,
stage_reached: Notify,
stage_release: Notify,
```

Do not port `AutosaveBackend`, `StorageBackend.writer`, `StorageBackend.gate`, `gameplay_lock`, phase labels, or W/G/S assertions.

- [ ] **Step 2: Write RED serialization and session-responsiveness tests**

Create:

```rust
#[tokio::test]
async fn storage_mutations_share_one_operation_gate()

#[tokio::test]
async fn blocked_staged_write_does_not_hold_gameplay_session_mutex()
```

The first starts two actual application persistence mutations and asserts:

```rust
assert_eq!(fs.max_concurrent_mutations(), 1);
```

The second pauses filesystem staging and asserts:

```rust
assert!(session.try_lock().is_ok());
```

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::serialization -- --nocapture
```

Expected before the gate is wired: at least the serialization test fails.

- [ ] **Step 3: Add `operation_gate` and exact generation helper**

Implement:

```rust
fn ensure_session_generation(&self, expected: u64) -> Result<(), GameError> {
    let session = self.session.lock().map_err(|_| GameError::unavailable())?;
    session.ensure_persistence_available()?;
    if session.persistence.generation != expected {
        return Err(GameError::stale_session_generation());
    }
    Ok(())
}
```

Construct one shared `Arc<tokio::sync::Mutex<()>>` per `ApplicationPersistence`.

- [ ] **Step 4: Replace manual-save queue reservation with a direct gated storage method**

Implement:

```rust
async fn write_manual_current(
    &self,
    session_generation: u64,
    request: SlotWriteRequest,
) -> Result<SlotWriteOutcome, GameError> {
    let _operation = self.operation_gate.lock().await;
    self.ensure_session_generation(session_generation)?;
    let prepared = prepare_slot_write(self.fs.as_ref(), &self.root, request)?;
    commit_prepared_slot_write(self.fs.as_ref(), &self.root, prepared)
}
```

Change `save_manual_core` to call `write_manual_current` and keep its existing health publication, rediscovery, and saved-ID validation. Remove `reserve_manual_writer` and its oneshot handoff.

- [ ] **Step 5: Replace delete queue reservation with a direct gated storage method**

Implement:

```rust
async fn delete_current(
    &self,
    session_generation: u64,
    reference: SaveSlotRef,
    expectation: OccupiedSlotExpectation,
) -> Result<SlotDeleteOutcome, GameError> {
    let _operation = self.operation_gate.lock().await;
    self.ensure_session_generation(session_generation)?;
    delete_slot(
        self.fs.as_ref(),
        &self.root,
        reference,
        expectation,
    )
}
```

Change `delete_save_core` to call `delete_current`, then preserve current health publication and rediscovery. Remove `reserve_delete_writer`, `wait_for_queued_delete_writer`, and the delete-enqueued notification.

- [ ] **Step 6: Route ready autosave and blocking flush through the same gate without moving waits under it**

The required flow is fixed:

```text
debounce sleep                       NO GATE
terminal thumbnail/deadline wait     NO GATE
acquire operation_gate
pending identity re-check
exact generation/revision capture
stage write
same generation/revision re-check
commit or discard
```

For flush, acquire `operation_gate` only after the caller has decided which exact revision must be written. Do not request or wait for a new thumbnail under the gate.

- [ ] **Step 7: Preserve exact generation/revision capture before staging**

For pending autosave `(G, R)`, use this shape before `capture_checkpoint`:

```rust
let (checkpoint, content_revision) = {
    let session = self.session.lock().map_err(|_| GameError::unavailable())?;
    let engine = session
        .engine
        .as_ref()
        .ok_or_else(GameError::game_not_started)?;
    if session.persistence.generation != pending.session_generation
        || engine.durable_revision() != pending.durable_revision
    {
        return Err(GameError::stale_session_generation());
    }
    (
        capture_checkpoint(engine)?,
        self.discovery.definitions.content_revision().to_owned(),
    )
};
```

After `prepare_slot_write`, lock the session only long enough to compare the same `G/R` immediately before `commit_prepared_slot_write`. On mismatch:

```rust
discard_prepared_slot_write(prepared)?;
return Err(GameError::stale_session_generation());
```

Do not replace this with “capture current checkpoint after acquiring the gate”.

- [ ] **Step 8: Delete writer-queue production machinery**

Delete:

```text
WriterJobClass
QueuedWriterJob
WriterQueueState
WriterQueue
WriterQueueProbe
reserve_manual_writer
reserve_delete_writer
wait_for_queued_delete_writer
enqueue_writer_probe
```

Delete `coordinator/tests/writer.rs` after Steps 2-7 are green.

- [ ] **Step 9: Verify Task 2**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::serialization
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

- [ ] **Step 10: Commit**

```bash
git add -A apps/game/src-tauri/src/game/save apps/game/src-tauri/src/lib.rs
git commit -m "refactor(save): serialize persistence through one gate"
```

---

### Task 3: Re-home autosave/retry/thumbnail-wait behavior before deleting debounce internals

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application/autosave.rs`
- Create: `apps/game/src-tauri/src/game/save/application/tests/autosave.rs`
- Modify: `apps/game/src-tauri/src/game/save/application/tests/helpers.rs`
- Migrate from: `apps/game/src-tauri/src/game/save/coordinator/tests/debounce.rs`

**Interfaces:**

These method names are fixed for this plan:

```rust
impl ApplicationPersistence {
    fn schedule_autosave(self: &Arc<Self>, pending: PendingAutosave);

    async fn await_pending_autosave(self: Arc<Self>, pending: PendingAutosave);

    async fn execute_ready_autosave(
        &self,
        pending: PendingAutosave,
        thumbnail: CaptureTerminalResult,
    );
}
```

Ownership boundary:

- `schedule_autosave` performs only the concrete Tauri spawn.
- `await_pending_autosave` owns debounce sleep, pending checks, and terminal-thumbnail wait; it does **not** acquire `operation_gate` until it calls `execute_ready_autosave`.
- `execute_ready_autosave` acquires `operation_gate` and performs the exact-identity storage path from Task 2.

- [ ] **Step 1: Preserve deterministic time tests without a scheduler trait**

Production scheduling:

```rust
fn schedule_autosave(self: &Arc<Self>, pending: PendingAutosave) {
    let persistence = Arc::clone(self);
    tauri::async_runtime::spawn(async move {
        persistence.await_pending_autosave(pending).await;
    });
}
```

Deterministic `#[tokio::test(start_paused = true)]` tests call `await_pending_autosave` or `execute_ready_autosave` directly on their own Tokio runtime. They do not invoke `schedule_autosave`.

Do not create `TaskSpawner`, `CoordinatorTaskScheduler`, or another test scheduler.

- [ ] **Step 2: Migrate every named product test from the ledger**

Recreate each exact behavior under `application/tests/autosave.rs`:

```text
no_thumbnail_analysis_burst_writes_latest_revision_without_thumbnail_activity
no_thumbnail_retry_and_supersession_never_issue_capture_request
stale_no_thumbnail_retry_cannot_replace_a_newer_pending_write
no_thumbnail_retry_does_not_supersede_newer_pending_write_after_eligibility
ordinary_retry_does_not_supersede_newer_pending_write_after_eligibility
debounce_spends_the_existing_ticket_deadline
capture_timeout_writes_unavailable_without_degrading_persistence
revision_during_write_schedules_one_follow_up_for_newest_revision
first_write_success_keeps_health_pending_while_follow_up_is_outstanding
prior_generation_high_revision_never_suppresses_new_generation_low_revision
failed_revision_does_not_timer_loop_and_explicit_actions_retry_once
stale_notify_durable_commit_is_rejected_before_mutating_coordinator_state
stale_notify_durable_commit_cannot_supersede_live_replacement_autosave_ticket
```

Assertions must use observable write receipts, pending identity, health/activity state, or returned ticket behavior. No test may assert queue class/order or scheduler count.

- [ ] **Step 3: Pin gate timing with a focused paused-time test**

Add:

```rust
#[tokio::test(start_paused = true)]
async fn debounce_and_thumbnail_wait_do_not_hold_operation_gate()
```

Arrange a pending autosave with a nonterminal ticket. Drive `await_pending_autosave` on the current test runtime. Before terminalizing the ticket, assert another task can acquire:

```rust
let guard = persistence
    .operation_gate
    .try_lock()
    .expect("thumbnail wait must not hold operation gate");
drop(guard);
```

Terminalize the ticket, advance to readiness, and prove the actual filesystem mutation is serialized by the Task 2 helper.

- [ ] **Step 4: Keep one real-time production-spawn smoke**

Add one non-paused test:

```rust
#[tokio::test]
async fn scheduled_debounce_eventually_runs_ready_autosave()
```

Call `schedule_autosave` once, terminalize its ticket, and await a filesystem-helper notification with:

```rust
let observed = tokio::time::timeout(
    AUTOSAVE_DEBOUNCE + Duration::from_secs(2),
    fs.wait_for_first_mutation(),
)
.await;
assert!(observed.is_ok());
```

Delete the old plain-thread fallback-runtime test and all scheduler-rejection tests. Do not add another runtime abstraction.

- [ ] **Step 5: Publish the migration ledger before deleting old debounce tests**

Add a PR comment table:

```text
old test | new file/test | KEPT / RENAMED / DELETED PRODUCT RULE
```

Every required ledger row must have an explicit disposition before the old test is removed.

- [ ] **Step 6: Verify Task 3**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::autosave
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

- [ ] **Step 7: Commit**

```bash
git add -A apps/game/src-tauri/src/game/save
git commit -m "test(save): preserve autosave behavior across queue removal"
```

---

### Task 4: Use the same gate for final replacement and cleanup; preserve stale-delete behavior

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application/mod.rs`
- Modify: `apps/game/src-tauri/src/game/save/application/session.rs`
- Modify: `apps/game/src-tauri/src/game/save/application/autosave.rs`
- Create: `apps/game/src-tauri/src/game/save/application/tests/session.rs`
- Modify: `apps/game/src-tauri/src/game/save/application/tests/serialization.rs`
- Migrate from: `apps/game/src-tauri/src/game/save/coordinator/tests/lock_order.rs`
- Migrate from: `apps/game/src-tauri/src/lib.rs` feature-gated replacement/delete test
- Delete after migration: `apps/game/src-tauri/src/game/save/coordinator/tests/lock_order.rs`

**Interfaces:**

Final replacement methods live on `ApplicationPersistence`:

```rust
async fn install_session_if_current(
    &self,
    engine: GameEngine,
    autosave_target: Option<SaveSlotRef>,
    expected: SessionTransitionIdentity,
) -> Result<GameStateView, GameError>;

async fn clear_session_if_current(
    &self,
    expected: SessionTransitionIdentity,
) -> Result<u64, GameError>;
```

- [ ] **Step 1: Add real staged-write stale-discard coverage**

Add:

```rust
#[tokio::test]
async fn stale_prepared_autosave_never_installs_after_revision_changes_during_staging()
```

Pause after a real staged write is prepared. Advance the live engine durable revision without holding `operation_gate`, then release staging.

Assert:

```rust
assert_eq!(fs.installed_count(), 0);
assert_eq!(fs.discarded_count(), 1);
assert!(persistence.last_successful_write().is_none());
```

- [ ] **Step 2: Replace final `replacement_gate` with `operation_gate`**

Detached restore construction remains before this method. Implement final install as:

```rust
async fn install_session_if_current(
    &self,
    engine: GameEngine,
    autosave_target: Option<SaveSlotRef>,
    expected: SessionTransitionIdentity,
) -> Result<GameStateView, GameError> {
    let view = engine.view()?;
    let _operation = self.operation_gate.lock().await;
    let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
    session.ensure_persistence_available()?;
    if session.persistence.generation != expected.generation
        || session.durable_revision() != expected.durable_revision
    {
        return Err(GameError::stale_save_selection());
    }
    let generation = self.next_session_generation()?;
    let autosave_target = match autosave_target {
        Some(target @ SaveSlotRef::Auto { .. }) => Some(target),
        Some(SaveSlotRef::Manual { .. }) | None => None,
    };
    *session = AppSession::installed(engine, generation, autosave_target);
    Ok(view)
}
```

Implement `clear_session_if_current` with the same gate + expected identity check before replacing the session with `AppSession::empty_at_generation(generation)`.

Remove `replacement_gate` from `AppState`, `ApplicationPersistence`, constructors, and tests.

- [ ] **Step 3: Migrate the waiting-delete replacement invariant without queue mechanics**

Create the feature-gated test:

```rust
#[cfg(feature = "e2e")]
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn replacement_before_waiting_delete_returns_stale_session_generation_and_preserves_slot()
```

Use the filesystem helper to hold the operation gate with one persistence mutation. Start delete so it waits. Release the first operation, make replacement acquire and complete before delete reacquires, then allow delete to continue.

Assert:

```rust
assert_eq!(delete_error.code, "staleSessionGeneration");
assert!(slot_path.exists(), "stale delete must not remove the save");
assert_eq!(
    persistence.persistence_health(),
    PersistenceHealthView::Healthy,
);
```

Do not inspect queued work.

- [ ] **Step 4: Migrate only behavior from `lock_order.rs`**

Keep application-level tests for:

```text
session generations increment monotonically
only auto slots become autosave targets
blocked staged I/O leaves AppSession mutex available
stale staged data is discarded after revision/session identity changes
```

Delete tests whose only assertion is which named G/S/W lock a waiter owns.

- [ ] **Step 5: Collapse cleanup ordering**

Delete:

```text
CleanupOwner
next_cleanup_attempt
minimum_cleanup_attempt
cleanup_owner_replaces
cleanup_success_resolves
WriterJobClass::OrphanCleanup
```

Keep one current cleanup diagnostic. Run `clean_orphaned_save_files` under `operation_gate` at startup and retry it after a later successful persistence operation while the diagnostic remains. Do not create a cleanup job identity.

- [ ] **Step 6: Delete `lock_order.rs` after migrated behavior is green**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::session
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::serialization
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

- [ ] **Step 7: Commit**

```bash
git add -A apps/game/src-tauri/src
git commit -m "refactor(save): unify replacement and cleanup ownership"
```

---

### Task 5: Collapse coordinator state into the modular owner and remove one-implementation abstractions

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application/mod.rs`
- Create: `apps/game/src-tauri/src/game/save/application/tickets.rs`
- Create: `apps/game/src-tauri/src/game/save/application/exit.rs`
- Create: `apps/game/src-tauri/src/game/save/application/commands.rs`
- Modify: `apps/game/src-tauri/src/game/save/application/autosave.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Move/rewrite: remaining coordinator tests
- Delete: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`

**Interfaces:**
- Final owner: `ApplicationPersistence`.
- Final timer/continuation spawn: direct `tauri::async_runtime::spawn`.
- Final `AppState` has `session`, `persistence`, and `resources_dir`; no `coordinator` or `replacement_gate`.

- [ ] **Step 1: Move only behavior-backed coordinator state into `PersistenceState`**

Final state:

```rust
struct PersistenceState {
    tickets: HashMap<String, TicketRecord>,
    latest_by_intent: HashMap<CaptureIntent, String>,
    persistence_health: PersistenceHealthView,
    thumbnail_activity: ThumbnailActivityView,
    health_subscribers: Vec<HealthSubscriber>,
    activity_subscribers: Vec<ActivitySubscriber>,
    exit_subscribers: Vec<ExitSubscriber>,
    next_session_generation: u64,
    discovery_generation: u64,
    pending_autosave: Option<PendingAutosave>,
    last_successful_write: Option<AutosaveWriteReceipt>,
    failed_write: Option<BackgroundWriteFailure>,
    cleanup_failure: Option<GameError>,
    failure_challenges: HashMap<Uuid, PersistenceFailureChallenge>,
    failure_token_source: FailureTokenSource,
    exit_status: ExitStatusView,
    programmatic_exit_bypass: bool,
    exit_action_in_progress: bool,
}
```

Do not carry forward:

```text
next_autosave_serial
writer queue state
cleanup attempt counters/owners
scheduler state/failure injection
```

- [ ] **Step 2: Replace serial-only pending matching with retained product identity**

Implement:

```rust
fn pending_matches(state: &PersistenceState, pending: &PendingAutosave) -> bool {
    state.pending_autosave.as_ref().is_some_and(|live| {
        live.session_generation == pending.session_generation
            && live.durable_revision == pending.durable_revision
            && live.ticket == pending.ticket
    })
}
```

Retained HPA-550 tickets are UUIDs, so this removes a redundant queue-era serial instead of creating a new protocol.

- [ ] **Step 3: Delete `AutosaveBackend` and `CoordinatorFuture`**

Move the current capture/register/prepare/commit behavior into private `ApplicationPersistence` / `autosave.rs` methods that call these concrete seams directly:

```text
capture_checkpoint
select_autosave_target
prepare_slot_write
commit_prepared_slot_write
discard_prepared_slot_write
SaveFilesystem
```

Delete:

```text
AutosaveBackend
CoordinatorFuture
with_backend
with_backend_for_application
```

Tests use the Task 2 filesystem helper only.

- [ ] **Step 4: Move retained thumbnail-ticket state to `tickets.rs` without changing behavior**

Preserve tests/behavior for:

```text
purpose matching
stale ticket rejection
original deadline
intent supersession
available/unavailable terminal state
submit/report failure
thumbnail activity publication
```

Ticket state is protected by `PersistenceState` and is not held behind `operation_gate` while waiting for frontend capture.

- [ ] **Step 5: Move exit lifecycle to `exit.rs`; keep `ApplicationExit`**

Preserve Saving/Failed/Retry/Cancel/Exit Without Saving behavior and current failure-token checks. Remove general writer/replacement lock-order commentary.

If an exit-specific synchronous transition mutex remains necessary for atomic Idle/Failed -> Saving state changes, name and document it as exit-state protection only. It must not serialize disk work.

- [ ] **Step 6: Delete all scheduler abstractions; production calls Tauri spawn directly**

Delete:

```text
CoordinatorTask
CoordinatorTaskScheduler
PortableCoordinatorTaskScheduler
TauriCoordinatorTaskScheduler
with_task_scheduler
fallback Tokio runtime
lyra-save-coordinator thread
fail_next_schedule
```

The production debounce entry point is the fixed `schedule_autosave` implementation from Task 3. Ticket-expiry and exit continuations also call `tauri::async_runtime::spawn` directly.

Do not change deterministic tests to use the Tauri singleton runtime; they keep calling private async behavior directly.

- [ ] **Step 7: Move persistence command cores to `commands.rs`**

Move application logic for:

```text
list saves
manual save
load / load discarding current
Continue
delete
return to title / return without saving
thumbnail prepare/submit/report/read core
persistence failure cancel
exit retry/cancel/without-saving core
```

Keep raw Tauri request/header/body decoding and thin `#[tauri::command]` wrappers in `lib.rs`.

Keep generic `run_gameplay_mutation` and `MutationPersistencePolicy` in `lib.rs` when still shared by gameplay commands. Acquisition acknowledgement must continue to use:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
```

- [ ] **Step 8: Delete `SaveCoordinator` and reduce `AppState`**

Final state:

```rust
pub struct AppState {
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) persistence: Arc<ApplicationPersistence>,
    pub(crate) resources_dir: PathBuf,
}
```

Remove `save_root` from `AppState` if its production call-site search shows only persistence ownership. Remove `pub(crate) mod coordinator;` from `save/mod.rs` and delete the coordinator production file once compilation succeeds.

- [ ] **Step 9: Verify owner collapse**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

- [ ] **Step 10: Commit**

```bash
git add -A apps/game/src-tauri/src
git commit -m "refactor(save): collapse persistence into application owner"
```

---

### Task 6: Complete the behavior-test inventory and close out production deletion

**Files:**
- Modify/create: `apps/game/src-tauri/src/game/save/application/tests/*.rs`
- Delete: remaining `apps/game/src-tauri/src/game/save/coordinator/tests/*`
- Update: PR description / Linear closeout only after verification
- No production behavior expansion

**Interfaces:**
- Tests speak only in save/session/disk/health/activity/exit/ticket behavior.
- No test helper exposes writer classes, queue order, scheduler injection, W/G/S lock names, replacement gate, or cleanup-owner precedence.

- [ ] **Step 1: Finish the named migration ledger**

For every required old test at the top of this plan, record exactly one:

```text
KEPT: old_name -> application/tests/file.rs::same_name
RENAMED: old_name -> application/tests/file.rs::new_behavior_name
DELETED PRODUCT RULE: old_name -> one sentence explaining why the product rule itself no longer exists
```

`DELETED PRODUCT RULE` is not allowed merely because the old fixture used `WriterQueue` or `AutosaveBackend`.

The replacement/delete row must resolve to:

```text
replacement_before_waiting_delete_returns_stale_session_generation_and_preserves_slot
```

- [ ] **Step 2: Verify the complete retained behavior matrix**

Ensure focused tests prove:

```text
failed gameplay command -> no autosave / prior committed save intact
trailing debounce -> newest revision wins
no-thumbnail burst/retry -> no capture activity/request
ticket deadline -> debounce does not reset it
capture timeout -> unavailable thumbnail without persistence degradation
revision during write -> one newest follow-up
health remains Pending while follow-up exists
generation-scoped receipts -> old high revision cannot suppress new low revision
failed revision -> no timer retry storm; explicit actions retry once
stale late notify -> cannot mutate replacement state or supersede live ticket
identity-bound capture -> never capture newer live checkpoint for older receipt
stale staged write -> discarded before commit
manual/delete/autosave -> storage mutation max concurrency = 1
blocked staged I/O -> AppSession mutex responsive
failed detached restore -> old session remains
waiting stale delete after replacement -> slot survives + staleSessionGeneration
exit -> success / failure / retry / cancel / without-saving
thumbnail ticket/activity semantics unchanged
real storage atomic replacement/corrupt-save behavior unchanged
```

- [ ] **Step 3: Delete mechanism-only tests and helpers**

Remove tests/types whose only subject is:

```text
WriterQueue / WriterJobClass
queue worker startup/order
scheduler rejection/fallback thread
queue invalidation notification
G/S/W lock choreography
replacement_gate availability
CleanupOwner Receipt vs Attempt ordering
```

Delete old backend test types only after every product assertion has a migration disposition.

- [ ] **Step 4: Run both Rust test surfaces explicitly**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Both are mandatory. Do not rely on the default CI Rust coverage path to execute `#[cfg(feature = "e2e")]` tests.

- [ ] **Step 5: Run repository validation**

```bash
bun run check
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
```

Run the existing packaged save/Continue smoke only when current PR selection policy requires it. Do not add a new E2E suite.

- [ ] **Step 6: Search for forbidden production remnants**

```bash
rg 'WriterQueue|WriterJobClass|QueuedWriterJob|replacement_gate|CoordinatorTaskScheduler|PortableCoordinatorTaskScheduler|TauriCoordinatorTaskScheduler|AutosaveBackend|CoordinatorFuture|CleanupOwner|lyra-save-coordinator' apps/game/src-tauri/src
```

Expected: no production matches.

- [ ] **Step 7: Record production and test counts separately**

Production application modules:

```bash
find apps/game/src-tauri/src/game/save/application -maxdepth 1 -name '*.rs' -print0 | xargs -0 wc -l
```

Find the final top-level `#[cfg(test)] mod tests` in `lib.rs` and record the production/setup prefix separately from the full file.

Persistence tests:

```bash
find apps/game/src-tauri/src/game/save/application/tests -name '*.rs' -print0 | xargs -0 wc -l
```

Compare against Task 1 baseline. Completion expectation:

- material production persistence/orchestration deletion;
- no replacement framework;
- test count reported separately and not forced lower when equivalent behavior coverage requires it.

If production code grows or remains roughly equivalent because queue/scheduler concepts were merely relocated, stop and simplify before closeout.

- [ ] **Step 8: Self-review the three load-bearing ordering invariants in source**

Confirm directly:

```text
A. debounce sleep + terminal-thumbnail wait occur before operation_gate
B. checkpoint capture checks the requested generation + revision before capture
C. staged commit checks the same generation + revision immediately before install
```

Also confirm Load/Continue final install and delete revalidate their captured identities after acquiring `operation_gate`.

- [ ] **Step 9: Commit closeout cleanup**

```bash
git add -A apps/game/src-tauri/src
git commit -m "test(save): keep persistence coverage behavior-focused"
```

---

## Final Self-Review Checklist

- [ ] One `ApplicationPersistence` owner is held by `AppState`.
- [ ] One and only one async `operation_gate` serializes disk mutation/final replacement.
- [ ] No queue/actor/channel replaces `WriterQueue`.
- [ ] Debounce and thumbnail waiting happen outside the operation gate.
- [ ] Pending autosave capture is identity-bound to its exact generation/revision.
- [ ] The same identity is revalidated immediately before staged commit.
- [ ] Gameplay session mutex is free during filesystem staging/install waits.
- [ ] Load/Continue may wait for in-flight disk work; no second replacement gate exists.
- [ ] A stale waiting delete after replacement leaves its slot intact and returns `staleSessionGeneration`.
- [ ] HPA-550 dynamic thumbnail tickets/deadlines/activity/IPC are unchanged.
- [ ] HPA-549 acknowledgement still uses ordinary no-thumbnail autosave.
- [ ] No `SaveCoordinator`, writer queue, backend trait, scheduler/fallback runtime, or cleanup-owner ordering remains.
- [ ] `ApplicationPersistence` is modular internally rather than a replacement 4k-line blob.
- [ ] Every named debounce/retry/generation/health test has a migration disposition.
- [ ] Staged-write tracking reuses the existing `SaveFilesystem`/`StagedAtomicWrite` seam.
- [ ] Deterministic tests do not depend on Tauri's singleton runtime sharing a paused Tokio test clock.
- [ ] Default and `--all-features` Rust tests pass.
- [ ] Repository validation passes.
- [ ] Production code is materially smaller; test counts are recorded separately without deleting product coverage to satisfy a metric.

## Implementation Handoff

Implement this plan on the same HPA-521 branch/PR. Use one reviewable commit per task where practical. Do not split HPA-521 across multiple PRs, and do not merge an intermediate state as the final architecture until the queue/coordinator/scheduler path is gone.