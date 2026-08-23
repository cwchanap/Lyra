# HPA-521 Single-Owner Save Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Lyra's custom save writer queue/lock graph with one concrete application persistence owner and one async serialization gate, while retaining save/load/exit guarantees and the HPA-550 dynamic thumbnail product.

**Architecture:** `ApplicationPersistence` moves into `game/save/application.rs` and becomes the single application persistence owner. One `tokio::sync::Mutex<()>` serializes autosave, flush, manual save, delete, cleanup, and final session replacement; stale generation/revision checks remain the commit-time correctness fence. `SaveCoordinator`, `WriterQueue`, the custom task scheduler/fallback runtime, and backend future abstractions are deleted rather than replaced by another queue or actor.

**Tech Stack:** Rust, Tokio/Tauri async runtime, Tauri 2, existing `SaveFilesystem`/atomic-write storage layer, existing Rust unit/integration tests, Bun/Turbo repo checks.

**Spec:** `docs/superpowers/specs/2026-08-23-hpa-521-single-owner-save-persistence-design.md`

## Global Constraints

- One Linear ticket and one implementation PR for HPA-521.
- No save-schema, disk-layout, content-revision, or atomic-write semantic change.
- HPA-549 stays in force: acquisition acknowledgement is an ordinary no-thumbnail autosave mutation; do not recreate acknowledgement persistence machinery.
- HPA-550 stays in force: retain dynamic save thumbnails, capture tickets, deadlines, submit/failure IPC, `ThumbnailActivityView`, and current non-blocking thumbnail failure behavior.
- Do not introduce an actor, channel protocol, service container, repository layer, command bus, DI framework, compatibility shim, or replacement generic scheduler.
- Long filesystem work must not hold the gameplay session mutex.
- Every prepared save must revalidate session generation and durable revision immediately before commit.
- `SaveFilesystem` remains the storage test seam; tests alone do not justify keeping `AutosaveBackend` or a replacement backend trait.
- Preserve Retry/Cancel/Without Saving failure-token semantics unless a field is proven to have no production consumer after the queue collapse.
- Record before/after persistence production/test line counts before closing the PR.

---

## File Structure

Final intended structure:

```text
apps/game/src-tauri/src/game/save/
├── application.rs                 # single persistence owner + application orchestration
├── application/
│   └── tests/                     # behavior-focused persistence tests
├── capture.rs
├── e2e_faults.rs                  # feature-gated, unchanged except imports
├── mod.rs
├── restore.rs
├── schema.rs
├── storage.rs
└── thumbnail.rs

apps/game/src-tauri/src/lib.rs     # Tauri wiring, thin command wrappers, gameplay routing
```

Deleted at the end of the PR:

```text
apps/game/src-tauri/src/game/save/coordinator/mod.rs
apps/game/src-tauri/src/game/save/coordinator/tests/*
```

The test files are not mechanically deleted first. Their behavior assertions are moved to `application/tests/*`; only queue/lock/scheduler implementation assertions disappear.

---

### Task 1: Extract the concrete application persistence module without changing behavior

**Files:**
- Create: `apps/game/src-tauri/src/game/save/application.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Test: existing `apps/game/src-tauri/src/game/save/coordinator/tests/storage_integration.rs`
- Test: existing `apps/game/src-tauri/src/lib.rs` tests

**Interfaces:**
- Consumes: existing `AppSession`, `SaveCoordinator`, `SaveFilesystem`, `SaveDiscoveryContext`, `CapturedCheckpoint`, `SaveEnvelope`.
- Produces: concrete `ApplicationPersistence` in `game::save::application`, with the same storage/discovery methods currently defined in `lib.rs`.

- [ ] **Step 1: Record the implementation baseline**

Run:

```bash
wc -l apps/game/src-tauri/src/game/save/coordinator/mod.rs
wc -l apps/game/src-tauri/src/lib.rs
find apps/game/src-tauri/src/game/save/coordinator/tests -name '*.rs' -print0 | xargs -0 wc -l
```

Copy the totals into the PR description under `Baseline`. Do not add a generated metrics file to the repository.

- [ ] **Step 2: Move `ApplicationPersistence` and its concrete storage helpers into `game/save/application.rs`**

Move, without semantic change, the current fields and methods from `lib.rs`:

```rust
pub(crate) struct ApplicationPersistence {
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) replacement_gate: Arc<tokio::sync::Mutex<()>>,
    pub(crate) fs: Arc<dyn SaveFilesystem>,
    pub(crate) root: PathBuf,
    pub(crate) discovery: SaveDiscoveryContext,
    last_saved_at: Mutex<Option<DateTime<Utc>>>,
    availability_error: Mutex<Option<GameError>>,
}
```

and the current methods:

```rust
impl ApplicationPersistence {
    pub(crate) fn discover(&self) -> SaveBrowserView;
    pub(crate) fn availability_error(&self) -> Option<GameError>;
    pub(crate) fn next_saved_at(&self) -> Result<String, GameError>;
    pub(crate) fn envelope(...) -> Result<SaveEnvelope, GameError>;
    pub(crate) async fn run_storage_write_if_session_current<T, F>(...) -> Result<T, GameError>;
    pub(crate) fn commit_current(...) -> Result<AutosaveCommitOutcome, GameError>;
}
```

Keep `impl AutosaveBackend for ApplicationPersistence` temporarily in this task. This is a move-only seam so later tasks can delete the abstraction without mixing it with the `lib.rs` extraction.

- [ ] **Step 3: Export the module and update imports**

In `game/save/mod.rs` add:

```rust
pub(crate) mod application;
```

In `lib.rs`, import the moved type instead of defining it locally:

```rust
use game::save::application::ApplicationPersistence;
```

Keep `AppState` and command functions unchanged in Task 1.

- [ ] **Step 4: Run the Rust suite to verify the move is behavior-neutral**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: all existing persistence, thumbnail, exit, and command tests pass with no assertion changes.

- [ ] **Step 5: Commit the seam move**

```bash
git add apps/game/src-tauri/src/game/save/application.rs \
        apps/game/src-tauri/src/game/save/mod.rs \
        apps/game/src-tauri/src/lib.rs
git commit -m "refactor(save): extract application persistence owner"
```

---

### Task 2: Add one operation gate and replace writer-queue serialization with direct operations

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Create: `apps/game/src-tauri/src/game/save/application/tests/serialization.rs`
- Create: `apps/game/src-tauri/src/game/save/application/tests/mod.rs`
- Modify: `apps/game/src-tauri/src/game/save/application.rs` test module declaration
- Delete later in this task after behavior tests pass: `apps/game/src-tauri/src/game/save/coordinator/tests/writer.rs`

**Interfaces:**
- Produces one serialization boundary:

```rust
operation_gate: Arc<tokio::sync::Mutex<()>>
```

- Produces direct application operations used by autosave/flush/manual/delete:

```rust
async fn with_operation_gate<T, F, Fut>(&self, operation: F) -> Result<T, GameError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, GameError>>;
```

The helper may be inlined if that is clearer; the architectural requirement is one gate, not this exact helper name.

- [ ] **Step 1: Write a behavior test that proves two storage mutations cannot overlap**

Create a `SaveFilesystem` test wrapper that delegates to the existing test filesystem but blocks inside `stage_atomic` until released. Track active calls with atomics.

The assertion must be behavioral:

```rust
assert_eq!(filesystem.max_concurrent_mutations(), 1);
```

Exercise two real persistence operations (for example a manual write and delete, or two direct test operations) rather than `WriterJobClass` labels.

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::serialization::storage_mutations_share_one_operation_gate -- --exact
```

Expected before implementation: FAIL because the new application operation gate does not exist.

- [ ] **Step 2: Add `operation_gate` to `ApplicationPersistence`**

Initialize one gate in the application persistence constructor/build path:

```rust
let operation_gate = Arc::new(tokio::sync::Mutex::new(()));
```

All clones of `ApplicationPersistence` share that exact gate.

- [ ] **Step 3: Route manual save and delete directly through the gate**

Replace the current pattern:

```text
publish Pending
-> reserve_*_writer(future)
-> oneshot
-> await receiver
```

with:

```rust
let _operation = persistence.operation_gate.lock().await;
let result = persistence
    .run_storage_write_if_session_current(session_generation, |fs, root| {
        // existing prepare/commit or delete storage code
    })
    .await;
```

After this step, delete `reserve_manual_writer` and `reserve_delete_writer` callers. Keep the current health publication and rediscovery semantics.

- [ ] **Step 4: Route debounced autosave and blocking flush through the same gate**

For autosave, after debounce/ticket completion:

```rust
let _operation = persistence.operation_gate.lock().await;
if !persistence.pending_matches(&pending) {
    return;
}
persistence.execute_pending_autosave(pending, thumbnail).await;
```

For flush:

```rust
let _operation = persistence.operation_gate.lock().await;
let result = persistence
    .execute_blocking_flush(
        session_generation,
        flush_revision,
        preferred_target,
        thumbnail,
        thumbnail_capture_required,
    )
    .await?;
```

Do not enqueue either operation and do not introduce a replacement queue.

- [ ] **Step 5: Delete writer-queue production machinery**

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

Remove `VecDeque` if it is no longer used elsewhere in the production module.

Delete `coordinator/tests/writer.rs` after the new serialization test passes.

- [ ] **Step 6: Verify serialization and the full Rust suite**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::serialization
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: the new operation-gate test passes; no writer-queue test remains.

- [ ] **Step 7: Commit the direct serialization change**

```bash
git add -A apps/game/src-tauri/src/game/save apps/game/src-tauri/src/lib.rs
git commit -m "refactor(save): serialize persistence through one gate"
```

---

### Task 3: Make session replacement and cleanup use the same owner; remove replacement/cleanup ordering state

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Create/Modify: `apps/game/src-tauri/src/game/save/application/tests/serialization.rs`
- Migrate behavior from: `apps/game/src-tauri/src/game/save/coordinator/tests/lock_order.rs`
- Delete: `apps/game/src-tauri/src/game/save/coordinator/tests/lock_order.rs`

**Interfaces:**
- Session installation/clearing becomes an `ApplicationPersistence` operation that acquires the same `operation_gate` and revalidates `SessionTransitionIdentity`.
- Cleanup failure becomes one current diagnostic; there is no cleanup job identity ordering.

- [ ] **Step 1: Add a stale-write-vs-replacement behavior test**

Use the existing filesystem staging seam to pause a prepared write. While the prepared write is paused, arrange for the live session identity to advance before commit revalidation, then release it.

Assert:

```rust
assert_eq!(installed_save_count, 0);
assert_eq!(discarded_staged_write_count, 1);
assert!(persistence.last_successful_write().is_none());
```

The test name should describe the product invariant, for example:

```rust
stale_prepared_autosave_never_installs_after_session_identity_changes
```

- [ ] **Step 2: Replace `replacement_gate` with the shared operation gate**

Remove `replacement_gate` from:

- `AppState`;
- `ApplicationPersistence`;
- coordinator/application constructors;
- session install/clear methods;
- tests.

Final install shape:

```rust
let _operation = self.operation_gate.lock().await;
let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
if session.persistence.generation != expected.generation
    || session.durable_revision() != expected.durable_revision
{
    return Err(GameError::stale_save_selection());
}
// increment generation and install candidate
```

Detached candidate construction still happens before acquiring the operation gate.

- [ ] **Step 3: Keep disk I/O outside the gameplay session lock**

Add/retain a behavior test that pauses `stage_atomic` and asserts:

```rust
assert!(session.try_lock().is_ok());
```

while the persistence operation is blocked on filesystem work. The test must not inspect lock names such as `G`, `S`, or `W`; those implementation concepts are being deleted.

- [ ] **Step 4: Collapse orphan-cleanup ordering**

Delete:

```rust
CleanupOwner
next_cleanup_attempt
minimum_cleanup_attempt
WriterJobClass::OrphanCleanup
enqueue_cleanup_retry owner sequencing
cleanup_owner_replaces
cleanup_success_resolves
```

Keep only one current cleanup diagnostic in persistence state. Run `clean_orphaned_save_files` under `operation_gate` at startup and retry it after a subsequent successful persistence operation when the diagnostic remains present.

A cleanup failure may degrade persistence health, but it must not reorder or block a newer save receipt through custom receipt/attempt precedence logic.

- [ ] **Step 5: Migrate the useful `lock_order.rs` assertions**

Re-home only these behaviors:

- session generations increment monotonically;
- only auto saves are adopted as autosave targets;
- blocked disk I/O leaves gameplay session access responsive;
- stale prepared data is discarded after session identity changes.

Delete `lock_order.rs` entirely after those assertions pass in the application tests.

- [ ] **Step 6: Run focused and full Rust tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::serialization
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

- [ ] **Step 7: Commit the session/cleanup collapse**

```bash
git add -A apps/game/src-tauri/src/game/save apps/game/src-tauri/src/lib.rs
git commit -m "refactor(save): unify replacement and cleanup ownership"
```

---

### Task 4: Fold coordinator state into `ApplicationPersistence` and delete one-implementation async abstractions

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify/move: remaining `apps/game/src-tauri/src/game/save/coordinator/tests/*.rs`
- Delete: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- Delete: `apps/game/src-tauri/src/game/save/coordinator/` after tests are migrated

**Interfaces:**
- Final owner: `ApplicationPersistence`.
- Final background spawning: Tauri async runtime directly.
- No `AutosaveBackend`, `CoordinatorFuture`, `CoordinatorTaskScheduler`, or `PortableCoordinatorTaskScheduler`.

- [ ] **Step 1: Move coordinator state required by real behavior into `ApplicationPersistence`**

Move the surviving state into a private `PersistenceState` owned by `ApplicationPersistence`:

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

Do **not** carry forward `next_autosave_serial`, writer-queue state, or cleanup-attempt counters.

- [ ] **Step 2: Replace autosave serial matching with pending identity matching**

Use the already unique ticket together with generation/revision:

```rust
fn pending_matches(state: &PersistenceState, pending: &PendingAutosave) -> bool {
    state.pending_autosave.as_ref().is_some_and(|live| {
        live.session_generation == pending.session_generation
            && live.durable_revision == pending.durable_revision
            && live.ticket == pending.ticket
    })
}
```

The latest durable commit replaces `pending_autosave`; stale timer tasks exit after this check.

- [ ] **Step 3: Remove `AutosaveBackend` and call concrete owner methods**

Move the current capture/register/prepare/commit behavior into private `ApplicationPersistence` methods that reuse `capture_checkpoint`, `SaveFilesystem`, `prepare_slot_write`, and `commit_prepared_slot_write` directly.

Delete:

```rust
AutosaveBackend
CoordinatorFuture
with_backend
with_backend_for_application
```

Tests use `SaveFilesystem` fakes/fault wrappers instead of introducing a replacement backend trait.

- [ ] **Step 4: Remove the custom task scheduler and fallback thread**

Delete:

```rust
CoordinatorTask
CoordinatorTaskScheduler
PortableCoordinatorTaskScheduler
with_task_scheduler
fallback Tokio runtime
lyra-save-coordinator thread
```

Spawn the existing timer/continuation futures through the Tauri async runtime:

```rust
tauri::async_runtime::spawn(async move {
    // debounce, thumbnail expiry, or exit continuation
});
```

Do not create a wrapper trait around this call.

- [ ] **Step 5: Preserve the HPA-550 thumbnail tests while changing their owner**

Move ticket/activity tests to the application test module and keep assertions for:

- purpose matching;
- stale ticket rejection;
- timeout -> unavailable;
- intent supersession;
- submit failure terminal state;
- thumbnail failure never blocking the save itself.

No product behavior or frontend IPC changes are allowed in this task.

- [ ] **Step 6: Delete `SaveCoordinator` and update all call sites**

`AppState` final persistence fields should be reduced to:

```rust
pub(crate) struct AppState {
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) persistence: Arc<ApplicationPersistence>,
    pub(crate) resources_dir: PathBuf,
}
```

If `save_root` remains used only through persistence, remove it from `AppState` and keep it private to `ApplicationPersistence`.

Update call sites from:

```rust
state.coordinator.some_operation(...)
```

to:

```rust
state.persistence.some_operation(...)
```

Remove `pub(crate) mod coordinator;` from `game/save/mod.rs` and delete the coordinator production file once compilation succeeds.

- [ ] **Step 7: Run the Rust suite**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: all persistence behavior passes without coordinator, writer queue, backend trait, or scheduler abstraction.

- [ ] **Step 8: Commit the owner collapse**

```bash
git add -A apps/game/src-tauri/src/game/save apps/game/src-tauri/src/lib.rs
git commit -m "refactor(save): collapse coordinator into application owner"
```

---

### Task 5: Move persistence command orchestration out of `lib.rs`

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: application persistence tests

**Interfaces:**
- `lib.rs` retains thin `#[tauri::command]` wrappers.
- `game/save/application.rs` exposes crate-private core functions/methods for save browser/manual/load/continue/delete/return/exit behavior.

- [ ] **Step 1: Move persistence-specific command cores into the application module**

Move the current logic for:

```text
list_saves_core
prepare/submit/report/read thumbnail core
save_manual_core
build_selected_candidate
load_save_core
load_save_discarding_current_core
continue_game_core
delete_save_core
return_to_title_core
return_to_title_without_saving_core
cancel persistence failure
retry/cancel/without-saving exit cores
```

Keep Tauri-specific request decoding in `lib.rs` where it is genuinely transport code; for example raw thumbnail header/body extraction may stay as a thin adapter before delegating validated bytes/ticket to persistence.

- [ ] **Step 2: Keep wrappers thin and explicit**

Target shape:

```rust
#[tauri::command]
async fn delete_save(
    state: tauri::State<'_, AppState>,
    reference: SaveSlotRef,
    expectation: OccupiedSlotExpectation,
) -> Result<SaveBrowserOpenResultView, GameError> {
    state.persistence.delete_save(reference, expectation).await
}
```

and equivalent delegation for other persistence commands.

Do not introduce a generic dispatch enum or command bus.

- [ ] **Step 3: Keep generic gameplay mutation routing in `lib.rs`**

`run_gameplay_mutation` and `MutationPersistencePolicy` may remain in `lib.rs` if they continue to serve ordinary gameplay commands. Update only their persistence notification call to the new owner.

Acquisition acknowledgement must still route through:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
```

- [ ] **Step 4: Run compile/tests and inspect `lib.rs` responsibilities**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Then inspect the remaining persistence code in `lib.rs`. Any block that performs storage selection, save discovery, commit/retry ordering, or session replacement belongs in `application.rs`; Tauri attribute wrappers/event wiring belong in `lib.rs`.

- [ ] **Step 5: Commit the application-boundary cleanup**

```bash
git add apps/game/src-tauri/src/game/save/application.rs apps/game/src-tauri/src/lib.rs
git commit -m "refactor(tauri): delegate persistence orchestration"
```

---

### Task 6: Replace mechanism tests with behavior tests and close the deletion budget

**Files:**
- Modify/create: `apps/game/src-tauri/src/game/save/application/tests/*.rs`
- Delete: remaining `apps/game/src-tauri/src/game/save/coordinator/tests/*.rs` after migration
- Modify: `apps/game/src-tauri/src/game/save/application.rs` test declarations
- No production behavior expansion

**Interfaces:**
- Tests speak in terms of save state, disk state, session identity, health/activity/exit views, and observable commands.
- Tests do not expose writer classes, queue ordering, gate names, scheduler rejection, or lock-order labels.

- [ ] **Step 1: Preserve the required behavior matrix**

Ensure focused tests exist for all of the following:

```text
failed gameplay command -> no autosave / prior save intact
multiple durable revisions -> only newest debounced revision is saved
stale prepared write -> discarded, never installed
failed detached restore -> old live session remains
flush -> waits for current persistence operation or writes required revision
manual save/delete/autosave -> never overlap storage mutation
blocked storage -> gameplay session mutex remains available
exit -> success / failure / retry / cancel / without-saving semantics
acquisition acknowledgement -> ordinary no-thumbnail autosave path
thumbnail -> ticket expiry/supersession/submission/failure semantics unchanged
storage -> current atomic replace/corrupt-save behavior unchanged
```

- [ ] **Step 2: Delete tests whose subject no longer exists**

Remove assertions that mention or require:

```text
WriterQueue
WriterJobClass
queued future order
writer worker startup
schedule rejection retaining jobs
G/S/W lock names
replacement_gate availability
CleanupOwner Receipt vs Attempt ordering
PortableCoordinatorTaskScheduler fallback runtime/thread
```

Do not recreate these concepts in test helpers.

- [ ] **Step 3: Run the complete Rust suite with and without E2E feature where current CI does so**

Run at minimum:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

If the repository's current CI invokes an E2E feature-specific Rust test command, run that exact existing command as well; do not invent a new suite.

- [ ] **Step 4: Run repository validation**

```bash
bun run check
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
```

Expected: all commands pass.

- [ ] **Step 5: Record final line counts and verify net deletion**

Run:

```bash
wc -l apps/game/src-tauri/src/game/save/application.rs
wc -l apps/game/src-tauri/src/lib.rs
find apps/game/src-tauri/src/game/save -path '*test*' -name '*.rs' -print0 | xargs -0 wc -l
```

Update the PR description with `After` totals and the delta from Task 1.

The result must be a material net reduction. If production/test lines increase, stop and remove duplicated/transitional abstractions before calling HPA-521 complete.

- [ ] **Step 6: Search for forbidden remnants**

Run:

```bash
rg 'WriterQueue|WriterJobClass|QueuedWriterJob|replacement_gate|CoordinatorTaskScheduler|PortableCoordinatorTaskScheduler|AutosaveBackend|CoordinatorFuture|CleanupOwner' apps/game/src-tauri/src
```

Expected: no production matches. A historical design/plan document outside `src` does not block completion.

- [ ] **Step 7: Commit the closeout cleanup**

```bash
git add -A apps/game/src-tauri/src
git commit -m "test(save): keep persistence coverage behavior-focused"
```

---

## Final self-review checklist

Before marking the implementation PR ready for review:

- [ ] One and only one async operation gate serializes disk mutation/final replacement.
- [ ] No queue/actor/channel replaced `WriterQueue`.
- [ ] Dynamic thumbnails still behave exactly as retained by HPA-550.
- [ ] Acquisition acknowledgement still uses HPA-549 ordinary no-thumbnail autosave.
- [ ] No save schema/disk layout/content revision changed.
- [ ] Stale staged writes are discarded after session identity changes.
- [ ] Gameplay session mutex is not held during filesystem staging/install waits.
- [ ] Exit still yields one actionable typed failure and supports Retry/Cancel/Without Saving.
- [ ] `lib.rs` contains transport/setup/wiring rather than persistence implementation.
- [ ] Tests no longer encode queue class order or G/S/W lock choreography.
- [ ] Persistence production + test line count is materially lower than the baseline.
- [ ] Full Rust and repository validation commands pass.

## Implementation handoff

Implement this plan on the same HPA-521 branch/PR. Use one reviewable commit per task where practical, but do not split HPA-521 across multiple PRs. The final architecture must land atomically as one persistence simplification.