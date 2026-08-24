# HPA-521 Single-Owner Save Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Lyra's custom save writer queue/lock graph with one concrete application persistence owner and one async serialization gate, while preserving identity-bound saves, HPA-549 no-thumbnail autosave behavior, HPA-550 dynamic thumbnails, stale-action safety, and exit/load guarantees.

**Architecture:** `ApplicationPersistence` becomes the only persistence owner held by `AppState`. One `tokio::sync::Mutex<()>` serializes disk mutation and final session replacement, while autosave debounce and terminal-thumbnail waiting remain outside that gate. Autosave checkpoint capture is bound to the pending `(session_generation, durable_revision)` before staging and revalidated again immediately before commit. `SaveCoordinator`, `WriterQueue`, `replacement_gate`, `AutosaveBackend`, the custom scheduler/fallback runtime, and queue-only counters are deleted rather than renamed.

**Tech Stack:** Rust, Tokio, Tauri 2 async runtime, existing `SaveFilesystem` / `StagedAtomicWrite` / atomic storage primitives, existing Tauri E2E feature gates, Bun/Turbo repository checks.

**Spec:** `docs/superpowers/specs/2026-08-23-hpa-521-single-owner-save-persistence-design.md`

## Global Constraints

- One Linear ticket and one implementation PR for HPA-521.
- No save-schema, disk-layout, content-revision, atomic-replacement, or frontend IPC semantic change.
- HPA-549 stays in force: acquisition acknowledgement remains an ordinary `AutosaveIfAdvancedWithoutThumbnail` gameplay mutation.
- HPA-550 stays in force: retain dynamic save thumbnails, capture tickets, existing deadlines, submit/failure/read IPC, activity view, and non-blocking capture failure.
- Exactly one async `operation_gate` serializes disk mutation and final session replacement.
- The 500 ms debounce sleep and terminal-thumbnail wait happen **before** `operation_gate` acquisition.
- Every autosave/flush captures only the pending operation's exact session generation and durable revision; never bind a newer live checkpoint to an older receipt.
- Every staged save revalidates that same generation/revision immediately before commit and discards stale staging.
- Long filesystem work must not hold the gameplay `AppSession` mutex.
- Load/Continue are allowed to wait for an in-flight persistence operation; do not preserve the old prepare/replacement overlap with a second gate.
- A waiting delete that becomes stale after replacement must return `staleSessionGeneration` and leave the slot intact.
- `SaveFilesystem` remains the test seam. Do not introduce a replacement `AutosaveBackend`, repository interface, actor, channel, service container, command bus, DI framework, generic scheduler, or task-spawner trait.
- Keep `ApplicationExit`; it has meaningful production/test implementations.
- Preserve current failure-token and discovery-generation semantics unless a field is proven dead by production call-site search.
- Product-behavior test migration outranks test-line reduction. Production net deletion is expected; test counts are measured separately.

---

## Final File Structure

Use one owner with private modules instead of one monolithic `application.rs`:

```text
apps/game/src-tauri/src/game/save/
├── application/
│   ├── mod.rs          # ApplicationPersistence + PersistenceState + shared owner surface
│   ├── autosave.rs     # pending autosave, terminal wait handoff, exact capture, flush, cleanup
│   ├── tickets.rs      # retained HPA-550 thumbnail tickets/activity
│   ├── session.rs      # AppSession/SessionPersistence + transition/install/clear
│   ├── exit.rs         # Saving/Failed/Retry/Cancel/Without Saving lifecycle
│   ├── commands.rs     # persistence-specific command cores, no Tauri request decoding
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

apps/game/src-tauri/src/lib.rs  # setup/event binding/thin Tauri wrappers/gameplay routing
```

`ApplicationPersistence` is the only application persistence type exposed from `game::save::application`. Private modules do not get separate state owners, gates, or traits.

If one private file remains trivial after implementation, fold it into its closest neighbor. Do not create a file merely to match the diagram.

Deleted before completion:

```text
apps/game/src-tauri/src/game/save/coordinator/mod.rs
apps/game/src-tauri/src/game/save/coordinator/tests/*
```

---

## Required Existing-Test Migration Ledger

Before deleting `coordinator/tests/debounce.rs`, account for every retained product test below. Prefer keeping the same test name under `application/tests/`; if a name changes, record `old -> new` in the PR closeout. A product rule may be deleted only with an explicit one-line disposition explaining why the rule itself no longer exists.

### HPA-549/HPA-550/autosave/generation behavior

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

### Replacement vs waiting delete

Existing feature-gated test:

```text
replacement_invalidating_queued_delete_returns_stale_session_generation
```

Replace its queue observation with the product-level successor:

```text
replacement_before_waiting_delete_returns_stale_session_generation_and_preserves_slot
```

Required assertions:

```rust
assert_eq!(error.code, "staleSessionGeneration");
assert!(slot_path.exists());
assert_eq!(persistence.persistence_health(), PersistenceHealthView::Healthy);
```

No test may keep `wait_for_queued_delete_writer`, queue probes, or a placeholder writer merely to reproduce the old mechanism.

---

### Task 1: Extract the existing application owner into the final module boundary

**Files:**
- Create: `apps/game/src-tauri/src/game/save/application/mod.rs`
- Create: `apps/game/src-tauri/src/game/save/application/session.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Test: existing `apps/game/src-tauri/src/game/save/coordinator/tests/storage_integration.rs`
- Test: existing `apps/game/src-tauri/src/lib.rs` tests

**Interfaces:**
- Consumes current `ApplicationPersistence`, `AppSession`, `SessionPersistence`, `SaveFilesystem`, `SaveDiscoveryContext`, `CapturedCheckpoint`, and `SaveEnvelope`.
- Produces `game::save::application::ApplicationPersistence` while the old coordinator still delegates behavior during this move-only task.
- Produces `application::session::{AppSession, SessionPersistence, SessionTransitionIdentity}` as the final home for persistence-facing session metadata.

- [ ] **Step 1: Record the pinned baseline without turning test deletion into a target**

Run on the HPA-521 base commit:

```bash
wc -l apps/game/src-tauri/src/game/save/coordinator/mod.rs
find apps/game/src-tauri/src/game/save/coordinator/tests -name '*.rs' -print0 | xargs -0 wc -l
wc -l apps/game/src-tauri/src/lib.rs
sed -n '1,2067p' apps/game/src-tauri/src/lib.rs | wc -l
```

`2067` is the production/setup prefix before the current top-level `#[cfg(test)] mod tests` on the pinned base. Record:

```text
coordinator production lines
coordinator test lines
full lib.rs lines
pre-top-level-test lib.rs lines
```

Do not require the final test total to decrease by a fixed percentage.

- [ ] **Step 2: Move `ApplicationPersistence` storage/discovery behavior to `application/mod.rs` without semantic change**

Move the current production fields and methods from `lib.rs`, including:

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

Move `discover`, `availability_error`, `next_saved_at`, `envelope`, `run_storage_write_if_session_current`, `commit_current`, and the temporary `impl AutosaveBackend for ApplicationPersistence` unchanged.

- [ ] **Step 3: Move `AppSession` / `SessionPersistence` to `application/session.rs`**

Move their existing fields/behavior without changing generation, written-revision, flush-baseline, autosave-target, or exit-flush semantics.

Keep call sites compiling through imports; do not redesign transition identity yet.

- [ ] **Step 4: Export the module and update imports**

In `save/mod.rs`:

```rust
pub(crate) mod application;
```

In `lib.rs` import the moved owner/session types. Keep command orchestration in place for Task 1.

- [ ] **Step 5: Prove the move is neutral on both Rust feature surfaces**

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

### Task 2: Introduce the one operation gate and delete WriterQueue without changing capture identity

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application/mod.rs`
- Create: `apps/game/src-tauri/src/game/save/application/autosave.rs`
- Create: `apps/game/src-tauri/src/game/save/application/tests/helpers.rs`
- Create: `apps/game/src-tauri/src/game/save/application/tests/serialization.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Delete after green replacement coverage: `apps/game/src-tauri/src/game/save/coordinator/tests/writer.rs`

**Interfaces:**
- `ApplicationPersistence` gains exactly one:

```rust
operation_gate: Arc<tokio::sync::Mutex<()>>
```

- `application/autosave.rs` owns direct persistence-operation code that formerly needed `WriterQueue`.
- The existing HPA-550 ticket state still lives in the old coordinator until Task 5; this task changes serialization, not product ownership.

- [ ] **Step 1: Reuse the real staged-write test seam instead of creating a new backend fake**

Move the minimum useful parts of these existing helpers into `application/tests/helpers.rs`:

```text
coordinator/tests/storage_integration.rs::TrackingFilesystem
coordinator/tests/storage_integration.rs::TrackingStagedWrite
StorageBackend's pause-after-prepare technique
```

The helper must still delegate to `ProductionSaveFilesystem` and wrap the real `StagedAtomicWrite`.

Extend test-only state with:

```rust
active_mutations: AtomicUsize,
max_concurrent_mutations: AtomicUsize,
pause_after_stage: AtomicBool,
stage_reached: Notify,
stage_release: Notify,
```

Do **not** port `AutosaveBackend`, `writer`, `gate`, `gameplay_lock`, phase labels, or `W/G/S` assertions.

- [ ] **Step 2: Write RED behavior tests for single serialization and gameplay-session responsiveness**

Add:

```rust
#[tokio::test]
async fn storage_mutations_share_one_operation_gate()

#[tokio::test]
async fn blocked_staged_write_does_not_hold_gameplay_session_mutex()
```

The first starts two real application persistence mutations through the filesystem helper and requires:

```rust
assert_eq!(fs.max_concurrent_mutations(), 1);
```

The second pauses after staging and requires:

```rust
assert!(session.try_lock().is_ok());
```

Run the focused tests and require RED because the new operation gate is not wired yet.

- [ ] **Step 3: Add one shared `operation_gate` to `ApplicationPersistence`**

All application persistence clones share the same `Arc<tokio::sync::Mutex<()>>`.

Do not add a generic `with_operation_gate` abstraction unless it materially shortens code; explicit lock sites are acceptable.

- [ ] **Step 4: Route manual save and delete directly through the gate**

Replace:

```text
publish Pending
-> reserve_manual_writer/reserve_delete_writer
-> oneshot result
-> await queue worker
```

with direct async operation:

```rust
let _operation = persistence.operation_gate.lock().await;
persistence.ensure_session_generation(session_generation)?;
let outcome = /* existing prepare+commit or delete_slot operation */;
```

The generation check occurs **after gate acquisition and before storage mutation**.

This is mandatory for delete: a replacement that wins the gate first makes a waiting delete stale before `delete_slot` runs.

- [ ] **Step 5: Route ready autosave and blocking flush through the same gate**

Important ordering contract:

```text
debounce sleep                       NO GATE
wait for terminal thumbnail/deadline NO GATE
acquire operation_gate
pending identity re-check
exact generation/revision capture
stage write
same generation/revision re-check
commit or discard
```

Do not call a helper that can sleep for debounce or thumbnail readiness while holding the gate.

For blocking flush, acquire the gate only when ready to observe/write the required revision. Do not request or wait for new thumbnail capture under the gate.

- [ ] **Step 6: Preserve identity-bound capture while removing the queue**

Before `capture_checkpoint(engine)` for pending `(G, R)`:

```rust
let session = self.session.lock().map_err(|_| GameError::unavailable())?;
let engine = session.engine.as_ref().ok_or_else(GameError::game_not_started)?;
if session.persistence.generation != pending.session_generation
    || engine.durable_revision() != pending.durable_revision
{
    return Err(GameError::stale_session_generation());
}
let checkpoint = capture_checkpoint(engine)?;
drop(session);
```

After staging and immediately before `commit_prepared_slot_write`, lock only long enough to revalidate the **same** `G/R`. If stale, call `discard_prepared_slot_write` and do not publish a successful receipt.

Do not replace this with `capture current checkpoint` after gate acquisition.

- [ ] **Step 7: Delete writer-queue production machinery**

Delete:

```rust
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

Delete `coordinator/tests/writer.rs` only after Steps 2-6 are green.

- [ ] **Step 8: Verify Task 2**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::serialization
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

- [ ] **Step 9: Commit**

```bash
git add -A apps/game/src-tauri/src/game/save apps/game/src-tauri/src/lib.rs
git commit -m "refactor(save): serialize persistence through one gate"
```

---

### Task 3: Re-home the autosave/retry/thumbnail-wait product matrix before deleting debounce internals

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application/autosave.rs`
- Create/Modify: `apps/game/src-tauri/src/game/save/application/tests/autosave.rs`
- Modify: `apps/game/src-tauri/src/game/save/application/tests/helpers.rs`
- Migrate from: `apps/game/src-tauri/src/game/save/coordinator/tests/debounce.rs`

**Interfaces:**
- Production scheduling decomposes naturally into:

```rust
fn schedule_autosave(&self, pending: PendingAutosave);
async fn await_pending_autosave(self: Arc<Self>, pending: PendingAutosave);
async fn execute_ready_autosave(&self, pending: PendingAutosave, thumbnail: CaptureTerminalResult);
```

Names may vary, but keep the boundary: `await_pending_autosave` owns debounce + thumbnail wait; `execute_ready_autosave` acquires `operation_gate` and performs the exact-identity write.

- [ ] **Step 1: Preserve deterministic timing tests without a scheduler trait**

Production `schedule_autosave` will eventually call Tauri spawn, but deterministic tests should directly await `await_pending_autosave` or `execute_ready_autosave` inside their `#[tokio::test]` runtime.

This lets `start_paused = true` continue to control `tokio::time` **without** assuming Tauri's singleton runtime shares the test clock.

Do not create `TaskSpawner`, `CoordinatorTaskScheduler`, or a test scheduler.

- [ ] **Step 2: Migrate every named test in the required ledger**

Move/rewrite these exact behaviors under `application/tests/autosave.rs`:

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

Each test must assert observable writes, current pending identity, health/activity state, or returned ticket behavior. No test may assert a `WriterJobClass`, queued order, or scheduler count.

- [ ] **Step 3: Pin the gate timing explicitly**

Add a focused test:

```rust
#[tokio::test(start_paused = true)]
async fn debounce_and_thumbnail_wait_do_not_hold_operation_gate()
```

Arrange a pending autosave whose thumbnail is not terminal. While directly polling/awaiting the pre-gate readiness path, prove another operation can acquire `operation_gate`.

Then terminalize the ticket and prove the ready write acquires the gate only for storage work.

- [ ] **Step 4: Keep one real scheduling smoke; delete the portable-thread product**

Add at most one non-paused test using the production schedule entry point:

```rust
#[tokio::test]
async fn scheduled_debounce_eventually_runs_ready_autosave()
```

Use a bounded timeout longer than `AUTOSAVE_DEBOUNCE` and a notification from the filesystem helper.

Delete `plain_thread_issues_a_ticket_and_eventually_runs_the_debounced_writer` and scheduler-rejection tests. The fallback thread/runtime is not a product guarantee.

- [ ] **Step 5: Do not delete `debounce.rs` yet unless the migration ledger is complete**

At this checkpoint, produce a PR comment/table with one row per required old test:

```text
old test | new file/test | kept/replaced/deleted-with-product-reason
```

Only rows with an explicit disposition may disappear from the old file.

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

### Task 4: Use the same gate for final replacement and cleanup; preserve the stale-delete slot invariant

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application/mod.rs`
- Modify: `apps/game/src-tauri/src/game/save/application/session.rs`
- Modify: `apps/game/src-tauri/src/game/save/application/autosave.rs`
- Create/Modify: `apps/game/src-tauri/src/game/save/application/tests/session.rs`
- Create/Modify: `apps/game/src-tauri/src/game/save/application/tests/serialization.rs`
- Migrate from: `apps/game/src-tauri/src/game/save/coordinator/tests/lock_order.rs`
- Migrate from: `apps/game/src-tauri/src/lib.rs` feature-gated replacement/delete test
- Delete after migration: `apps/game/src-tauri/src/game/save/coordinator/tests/lock_order.rs`

**Interfaces:**
- Final install/clear acquires `ApplicationPersistence::operation_gate`.
- `replacement_gate` is deleted.
- Cleanup state becomes one current diagnostic; cleanup-attempt ownership ordering disappears.

- [ ] **Step 1: Migrate real staged-write stale-discard coverage using the extracted filesystem helper**

Create/retain:

```rust
#[tokio::test]
async fn stale_prepared_autosave_never_installs_after_revision_changes_during_staging()
```

Pause after a real staged write has been prepared. Advance the live engine durable revision without holding the persistence gate. Release staging.

Assert:

```rust
assert_eq!(fs.installed_count(), 0);
assert_eq!(fs.discarded_count(), 1);
assert!(persistence.last_successful_write().is_none());
```

This proves the second generation/revision fence rather than queue order.

- [ ] **Step 2: Replace final `replacement_gate` use with `operation_gate`**

Detached candidate creation remains before the gate.

Final install:

```rust
let _operation = self.operation_gate.lock().await;
let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
if session.persistence.generation != expected.generation
    || session.durable_revision() != expected.durable_revision
{
    return Err(GameError::stale_save_selection());
}
let generation = self.next_session_generation()?;
*session = AppSession::installed(engine, generation, autosave_target);
```

Remove `replacement_gate` from `AppState`, `ApplicationPersistence`, constructors, and tests.

Accept that Load/Continue now wait for in-flight disk work.

- [ ] **Step 3: Preserve the waiting-delete replacement behavior without queue mechanics**

Migrate:

```text
replacement_invalidating_queued_delete_returns_stale_session_generation
```

to:

```rust
#[cfg(feature = "e2e")]
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn replacement_before_waiting_delete_returns_stale_session_generation_and_preserves_slot()
```

Use the filesystem pause hook to make delete wait for `operation_gate`, allow replacement to win the gate, then release the delete.

Assert exactly:

```rust
assert_eq!(delete_error.code, "staleSessionGeneration");
assert!(slot_path.exists(), "stale delete must not remove the save");
assert_eq!(persistence.persistence_health(), PersistenceHealthView::Healthy);
```

Do not inspect queue presence.

- [ ] **Step 4: Migrate only useful lock-order behaviors**

Keep application-level tests for:

```text
session generations are monotonic
only auto slots become autosave targets
blocked storage leaves AppSession mutex responsive
stale prepared data is discarded after revision/session identity changes
```

Delete tests whose only assertion is that a waiter owns neither named `G/S/W` lock.

- [ ] **Step 5: Collapse cleanup ordering**

Delete:

```rust
CleanupOwner
next_cleanup_attempt
minimum_cleanup_attempt
cleanup_owner_replaces
cleanup_success_resolves
WriterJobClass::OrphanCleanup // if any transitional reference remains
```

Keep one current cleanup diagnostic. Run cleanup under `operation_gate` at startup and retry it after a later successful persistence operation while the diagnostic remains.

Do not create a cleanup worker identity.

- [ ] **Step 6: Delete `lock_order.rs` after its product assertions are green**

Run:

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
- Modify/Create: `apps/game/src-tauri/src/game/save/application/tickets.rs`
- Modify/Create: `apps/game/src-tauri/src/game/save/application/exit.rs`
- Modify/Create: `apps/game/src-tauri/src/game/save/application/commands.rs`
- Modify: `apps/game/src-tauri/src/game/save/application/autosave.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Move/rewrite: remaining `apps/game/src-tauri/src/game/save/coordinator/tests/*.rs`
- Delete: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`

**Interfaces:**
- Final owner: `ApplicationPersistence`.
- Final spawn path: direct `tauri::async_runtime::spawn` in production scheduling entry points.
- No `SaveCoordinator`, `AutosaveBackend`, `CoordinatorFuture`, `CoordinatorTaskScheduler`, or `PortableCoordinatorTaskScheduler`.

- [ ] **Step 1: Move surviving state into `PersistenceState`**

Final state shape includes only behavior-backed fields:

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

- [ ] **Step 2: Match pending autosave by product identity instead of serial**

```rust
fn pending_matches(state: &PersistenceState, pending: &PendingAutosave) -> bool {
    state.pending_autosave.as_ref().is_some_and(|live| {
        live.session_generation == pending.session_generation
            && live.durable_revision == pending.durable_revision
            && live.ticket == pending.ticket
    })
}
```

This is not a new ticket protocol: retained HPA-550 tickets are already UUIDs.

- [ ] **Step 3: Delete `AutosaveBackend` / `CoordinatorFuture` and use concrete storage methods**

Move current capture/register/prepare/commit logic into private methods on the application owner/autosave module using:

```text
capture_checkpoint
select_autosave_target
prepare_slot_write
commit_prepared_slot_write
discard_prepared_slot_write
SaveFilesystem
```

Tests use the `SaveFilesystem` helper from Task 2. Do not create another backend trait.

- [ ] **Step 4: Move retained thumbnail ticket behavior to `tickets.rs`**

Preserve current semantics for:

```text
purpose matching
stale ticket rejection
existing deadline
intent supersession
terminal available/unavailable state
submit/report failure
thumbnail activity publication
```

Keep ticket state outside `operation_gate` until the ready persistence operation consumes the result.

- [ ] **Step 5: Move exit behavior to `exit.rs`; keep `ApplicationExit`**

Preserve Saving/Failed/Retry/Cancel/Without Saving behavior and failure-token checks.

Remove general lock-order commentary/state that only existed for writer/replacement gates. If a tiny synchronous exit transition mutex is still required, document it as exit state protection only; it must not serialize disk work.

- [ ] **Step 6: Delete scheduler abstractions; production calls Tauri spawn directly**

Delete:

```rust
CoordinatorTask
CoordinatorTaskScheduler
PortableCoordinatorTaskScheduler
TauriCoordinatorTaskScheduler
with_task_scheduler
fallback Tokio runtime
lyra-save-coordinator thread
fail_next_schedule
```

Production timer/continuation sites use:

```rust
tauri::async_runtime::spawn(async move {
    persistence.await_pending_autosave(pending).await;
});
```

and equivalent direct spawn for ticket expiry/exit continuation.

Do not modify deterministic tests to depend on this singleton runtime; they call the private async behavior directly as established in Task 3.

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

Keep raw Tauri IPC request decoding and thin `#[tauri::command]` wrappers in `lib.rs`.

Keep generic `run_gameplay_mutation` / `MutationPersistencePolicy` in `lib.rs` if still shared by gameplay commands. Acquisition acknowledgement must continue to select `AutosaveIfAdvancedWithoutThumbnail`.

- [ ] **Step 8: Delete `SaveCoordinator` and update `AppState`**

Final state:

```rust
pub struct AppState {
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) persistence: Arc<ApplicationPersistence>,
    pub(crate) resources_dir: PathBuf,
}
```

Remove `save_root` from `AppState` if it has no non-persistence production consumer.

Remove `pub(crate) mod coordinator;` and delete the coordinator production file after all imports compile.

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

### Task 6: Complete the behavior-test inventory, verify both Rust feature surfaces, and close out production deletion

**Files:**
- Modify/create: `apps/game/src-tauri/src/game/save/application/tests/*.rs`
- Delete: remaining `apps/game/src-tauri/src/game/save/coordinator/tests/*`
- Modify: PR description / Linear closeout only after verification
- No new production behavior

**Interfaces:**
- Tests speak only in save/session/disk/health/activity/exit/ticket behavior.
- No test helper exposes writer classes, queue order, scheduler injection, W/G/S lock names, replacement gate, or cleanup-owner precedence.

- [ ] **Step 1: Finish the named migration ledger**

For every required old test listed at the top of this plan, record one of:

```text
KEPT: old name -> application/tests/<file>.rs::<same name>
RENAMED: old name -> application/tests/<file>.rs::<new behavior name>
DELETED PRODUCT RULE: old name -> <one sentence why the product rule itself no longer exists>
```

`DELETED PRODUCT RULE` is not allowed for a test merely because its old fixture used `WriterQueue` or `AutosaveBackend`.

The replacement/delete row must point to:

```text
replacement_before_waiting_delete_returns_stale_session_generation_and_preserves_slot
```

- [ ] **Step 2: Preserve the broad player/storage behavior matrix**

Ensure focused application tests cover:

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

Remove tests whose only subject is:

```text
WriterQueue / WriterJobClass
queue worker startup/order
scheduler rejection or fallback thread
queue invalidation notification
G/S/W lock choreography
replacement_gate availability
CleanupOwner Receipt vs Attempt ordering
```

Delete old backend/test types after all product assertions have moved.

- [ ] **Step 4: Run both Rust test surfaces explicitly**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Both are mandatory. Do not rely on the default CI Rust coverage command to execute `#[cfg(feature = "e2e")]` tests.

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

Expected: no production matches. Test/historical documentation outside the implementation source is handled by the migration ledger, not compatibility shims.

- [ ] **Step 7: Record production and test line counts separately**

Production application modules:

```bash
find apps/game/src-tauri/src/game/save/application -maxdepth 1 -name '*.rs' -print0 | xargs -0 wc -l
```

Remaining `lib.rs` production/setup prefix: locate the final top-level `#[cfg(test)] mod tests` and record the prefix line count separately from the full file.

Persistence tests:

```bash
find apps/game/src-tauri/src/game/save/application/tests -name '*.rs' -print0 | xargs -0 wc -l
```

Compare with Task 1 baseline.

Completion expectation:

- production persistence/orchestration code shows material net deletion;
- no replacement framework appears;
- test count is reported separately and is **not** forced lower if the named product matrix requires equivalent coverage.

If production code grows or remains roughly equivalent because queue/scheduler concepts were merely relocated, stop and simplify before closeout.

- [ ] **Step 8: Self-review owner/gate/capture timing**

Confirm all three invariants directly in source:

```text
A. debounce sleep + terminal-thumbnail wait occur before operation_gate
B. checkpoint capture checks pending generation + revision before capture
C. staged commit checks the same generation + revision immediately before install
```

Also confirm Load/Continue final install and delete both revalidate their captured identity after acquiring `operation_gate`.

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
- [ ] Real staged-write tracking reuses the existing `SaveFilesystem`/`StagedAtomicWrite` seam.
- [ ] Deterministic tests do not depend on Tauri's singleton runtime sharing a paused Tokio test clock.
- [ ] Default and `--all-features` Rust tests pass.
- [ ] Repository validation passes.
- [ ] Production code is materially smaller; test counts are recorded separately without deleting product coverage to satisfy a metric.

## Implementation Handoff

Implement this plan on the same HPA-521 branch/PR. Use one reviewable commit per task where practical. Do not split HPA-521 across multiple PRs, and do not merge an intermediate state as the final architecture until the queue/coordinator/scheduler path is gone.