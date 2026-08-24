# HPA-521 Single-Owner Save Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Use TDD for behavior changes and verify each task before the next.

**Goal:** Collapse Lyra's save persistence coordination to one concrete `ApplicationPersistence` owner and one widened async operation gate, deleting the writer queue/backend/scheduler machinery without changing retained save/load/thumbnail/exit behavior.

**Architecture:** Reuse the existing `ApplicationPersistence` and the existing `replacement_gate: Arc<tokio::sync::Mutex<()>>`. Rename/widen that exact gate into `operation_gate`; do not create a second permanent gate. Debounce and thumbnail-terminal waiting stay outside it. Disk mutation and final session replacement run under it. Existing session-transition APIs move without semantic rewriting. Successfully discarded stale autosave work is benign.

**Tech Stack:** Rust, Tokio/Tauri 2 async runtime, existing `SaveFilesystem` / `ProductionSaveFilesystem` / `StagedAtomicWrite` storage layer, current Tauri E2E feature surface, Bun/Turbo repository checks.

**Spec:** `docs/superpowers/specs/2026-08-23-hpa-521-single-owner-save-persistence-design.md`

## Global Constraints

- HPA-521 is one ticket and one implementation PR. Do not split Task 1 into a second PR.
- Task 1 is a move-only first commit/review checkpoint; no behavioral refactor enters that commit.
- HPA-549 remains unchanged: acquisition acknowledgement uses ordinary `AutosaveIfAdvancedWithoutThumbnail`.
- HPA-550 remains unchanged: dynamic thumbnail tickets/deadlines/activity/IPC remain.
- Reuse/widen the existing `replacement_gate`; do not allocate a second persistence mutex and later reconcile them.
- No actor, channel, queue replacement, service container, repository layer, DI framework, command bus, scheduler wrapper, or replacement backend trait.
- Debounce sleep and terminal-thumbnail/deadline wait never hold `operation_gate`.
- Autosave captures only the exact requested `(session_generation, durable_revision)` and revalidates the same identity before commit.
- A successful stale discard is benign: no `failed_write`, Degraded health, or failure challenge. A discard I/O failure is a real persistence error.
- Long filesystem work never holds the gameplay `AppSession` mutex.
- Load/Continue/E2E replacement may wait for in-flight persistence rather than preserving overlap with a second gate.
- Preserve all current session-transition error codes, including `staleSaveSelection` vs `stalePersistenceFailureToken`.
- Preserve every product-behavior test through a complete generated baseline/disposition ledger; passing tests after deleting old tests is not sufficient evidence.
- Keep `ApplicationExit`.
- Measure production and test LOC separately. Production deletion is an acceptance signal; test deletion is not.

---

## Final File Shape

```text
apps/game/src-tauri/src/game/save/
├── application/
│   ├── mod.rs          # ApplicationPersistence + PersistenceState
│   ├── autosave.rs     # pending autosave/readiness/flush/commit/cleanup
│   ├── tickets.rs      # retained HPA-550 ticket/activity lifecycle
│   ├── session.rs      # AppSession/SessionPersistence + all replacement paths
│   ├── exit.rs         # exit state machine + ApplicationExit integration
│   ├── commands.rs     # persistence-specific command cores
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

apps/game/src-tauri/src/lib.rs  # Tauri setup/events/raw IPC adapters/gameplay routing
```

This is one owner behind private modules. Private modules do not own separate gates/state/services.

Deleted before completion:

```text
apps/game/src-tauri/src/game/save/coordinator/mod.rs
apps/game/src-tauri/src/game/save/coordinator/tests/*
```

---

## Task 1: Freeze the test inventory and perform the move-only extraction

**Purpose:** make the later behavior diff reviewable without silently losing the large coordinator test surface.

**Files:**
- Create: `apps/game/src-tauri/src/game/save/application/mod.rs`
- Create: `apps/game/src-tauri/src/game/save/application/session.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify imports in `game/save/coordinator/mod.rs` and tests only as required by the move

### Step 1.1 — Record production/test line-count baseline

Run on the pinned HPA-521 base:

```bash
wc -l apps/game/src-tauri/src/game/save/coordinator/mod.rs
find apps/game/src-tauri/src/game/save/coordinator/tests -name '*.rs' -print0 | xargs -0 wc -l
wc -l apps/game/src-tauri/src/lib.rs
```

Also record the line at which the current top-level `#[cfg(test)] mod tests` begins in `lib.rs`, so production/setup and test code can be compared separately at closeout.

Paste these values into the PR description under `Baseline`.

### Step 1.2 — Generate the complete coordinator test inventory

Do **not** inventory only `debounce.rs`. Include `coordinator/mod.rs` inline tests plus every file under `coordinator/tests/`.

Run:

```bash
python3 - <<'PY' > /tmp/hpa521-before-tests.tsv
from pathlib import Path
import re

root = Path("apps/game/src-tauri/src/game/save/coordinator")
pattern = re.compile(
    r'#\[(?:tokio::)?test(?:\([^\]]*\))?\]\s*(?:async\s+)?fn\s+([A-Za-z0-9_]+)',
    re.MULTILINE,
)
rows = []
for path in sorted(root.rglob("*.rs")):
    text = path.read_text()
    for name in pattern.findall(text):
        rows.append((path.as_posix(), name))
for path, name in rows:
    print(f"{path}\t{name}")
print(f"# total\t{len(rows)}")
PY
cat /tmp/hpa521-before-tests.tsv
```

Paste the complete path/name inventory and total into one PR comment titled `HPA-521 baseline persistence test inventory`.

The review counted 197 tests under `coordinator/tests/`; do not hard-code that number. The generated recursive count is authoritative because inline tests in `coordinator/mod.rs` will also disappear.

### Step 1.3 — Mark the mandatory autosave anchors

These retained product rules must ultimately map to `KEPT` or `RENAMED`, never deletion in HPA-521:

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

### Step 1.4 — Move the existing owner without rewriting it

Move the current `ApplicationPersistence` from `lib.rs` into `application/mod.rs` with the same fields/methods, including the temporary existing `replacement_gate` name and temporary `impl AutosaveBackend`.

Move `AppSession`, `SessionPersistence`, and `SessionTransitionIdentity` into `application/session.rs` without changing fields or behavior.

This task does **not**:

- rename the gate;
- delete queue/backend/scheduler code;
- change autosave behavior;
- rewrite install/clear functions;
- alter error codes.

Update imports only.

### Step 1.5 — Verify move-only neutrality

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Both must pass without assertion edits other than path/import movement.

Review the commit specifically for semantic drift:

```bash
git diff --stat HEAD^
git diff HEAD^ -- apps/game/src-tauri/src/lib.rs apps/game/src-tauri/src/game/save
```

No Task 2 behavior change is allowed in this commit.

### Step 1.6 — Commit review checkpoint

```bash
git add -A apps/game/src-tauri/src
git commit -m "refactor(save): extract application persistence owner"
```

Keep this as commit 1 in the same HPA-521 PR; do not open a second PR.

---

## Task 2: Widen the existing replacement gate and delete `WriterQueue`

**Purpose:** replace the hand-rolled queue with the existing mutex primitive, not a newly allocated one.

**Files:**
- Modify: `game/save/application/mod.rs`
- Create: `game/save/application/autosave.rs`
- Create: `game/save/application/tests/helpers.rs`
- Create: `game/save/application/tests/serialization.rs`
- Modify: `game/save/coordinator/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Delete after green replacement coverage: `coordinator/tests/writer.rs`

### Step 2.1 — Extract the existing staged-write test seam

Move only the useful parts of the current `coordinator/tests/storage_integration.rs` helper:

```text
TrackingFilesystem
TrackingStagedWrite
pause/release around real staged writes
install/discard counters
```

Keep delegation to `ProductionSaveFilesystem` and wrapping of real `StagedAtomicWrite`.

Add only what is needed for behavior tests, such as:

```text
active mutation count
max concurrent mutation count
stage reached/release notification
```

Do **not** port `AutosaveBackend`, `StorageBackend.writer`, phase labels, W/G/S lock probes, or a fake replacement gate.

### Step 2.2 — Write RED serialization coverage

Add:

```text
storage_mutations_share_one_operation_gate
blocked_staged_write_does_not_hold_gameplay_session_mutex
```

The first must exercise real application storage paths and prove max concurrent mutation is one. The second pauses staging and proves `AppSession::try_lock()` succeeds during filesystem work.

### Step 2.3 — Rename/widen the existing gate

Rename the existing shared field/constructor parameter:

```text
replacement_gate -> operation_gate
```

across `AppState`, `ApplicationPersistence`, coordinator application context, and current transition call sites.

**Do not construct another `Arc<Mutex<()>>`.** The same object that previously guarded replacement becomes the general persistence-operation gate.

### Step 2.4 — Remove queue wrapping from manual save/delete by reusing the existing storage helper

Current manual/delete jobs eventually call:

```text
ApplicationPersistence::run_storage_write_if_session_current
```

which already acquires the gate and rechecks session generation.

Delete the `reserve_manual_writer` / `reserve_delete_writer` + oneshot layer and call `run_storage_write_if_session_current` directly from the command core.

Keep existing health publication, save-ID validation, rediscovery, expected-manual/delete expectation handling, and typed errors unchanged.

Do not create `write_manual_current` or `delete_current` if the existing helper expresses the operation cleanly.

### Step 2.5 — Move autosave gate acquisition to the ready-write boundary

Keep:

```text
debounce sleep                       NO GATE
terminal thumbnail/deadline wait     NO GATE
pending_matches                       NO GATE
```

Then:

```text
acquire operation_gate
pending_matches again
exact generation/revision capture
select target/register/prepare
same generation/revision revalidation
commit or discard
```

The existing backend currently acquires the old replacement gate only at commit. The new one-gate model deliberately widens gate ownership to the ready persistence operation, while still keeping debounce/thumbnail wait outside.

### Step 2.6 — Preserve identity-bound capture

Before capture for `(G,R)`, require the current live session generation and durable revision to equal `(G,R)`.

After staging, use the existing `commit_current` semantics: compare the same identity immediately before install. Do not replace this with “capture whatever is current”.

### Step 2.7 — Make stale completion explicitly benign

Preserve the behavior of current `record_stale_write`.

Rules:

- pre-gate or post-gate `pending_matches == false`: return without recording failure;
- generation/revision mismatch before capture: stale/no-op, not persistence failure;
- generation/revision mismatch after prepare: discard staged write;
- successful discard: never populate `failed_write`, publish Degraded, or create failure authority;
- clear pending only when the stale attempt is still the current pending identity;
- if newer pending work exists, derived health remains Pending;
- discard I/O failure goes through normal background-failure handling.

Add:

```text
superseded_autosave_discard_leaves_health_pending_not_failed
```

and assert no failure challenge is produced for the benign stale path.

### Step 2.8 — Delete writer-queue production machinery

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
queue-only delete_enqueued/cleanup-before-lock probes
```

Remove `VecDeque` when no longer used.

Delete `coordinator/tests/writer.rs` only after its useful serialization behavior is replaced by application-level tests; queue-order mechanism assertions disappear.

### Step 2.9 — Verify Task 2

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::serialization
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

### Step 2.10 — Commit

```bash
git add -A apps/game/src-tauri/src
git commit -m "refactor(save): serialize persistence through one operation gate"
```

---

## Task 3: Migrate autosave/ticket timing behavior and delete scheduler abstraction

**Files:**
- Modify: `game/save/application/autosave.rs`
- Create/Modify: `game/save/application/tests/autosave.rs`
- Create/Modify: `game/save/application/tests/helpers.rs`
- Migrate from: `coordinator/tests/debounce.rs`
- Migrate relevant scheduler-only cases from `ticket.rs`, `exit_lifecycle.rs`, and other coordinator tests

### Step 3.1 — Reuse the existing autosave scheduling entry point

Move the existing `schedule_autosave` behavior into `ApplicationPersistence`/`autosave.rs` rather than introducing a parallel scheduling API.

Separate the implementation internally into:

```text
schedule_autosave            # spawn only
await_pending_autosave       # debounce + pending checks + terminal thumbnail wait
execute_ready_autosave       # operation_gate + exact persistence work
```

The names of the inner private helpers may follow the existing code if clearer; the ownership boundary is mandatory.

### Step 3.2 — Production spawn is direct Tauri runtime usage

Delete:

```text
CoordinatorTask
CoordinatorTaskScheduler
PortableCoordinatorTaskScheduler
TauriCoordinatorTaskScheduler
with_task_scheduler
fallback Tokio runtime
lyra-save-coordinator thread
fail_next_schedule scheduler injection
```

Production uses:

```rust
tauri::async_runtime::spawn(async move {
    // debounce/ticket/exit continuation
});
```

Do not create `TaskSpawner` or another wrapper trait.

### Step 3.3 — Deterministic tests do not depend on Tauri singleton clock

Paused-time unit tests call the inner async debounce/readiness method directly from their own `#[tokio::test(start_paused = true)]` runtime.

Keep at most one real-time smoke that invokes the production scheduling entry point and waits with a bounded timeout for real persistence activity.

Delete plain-thread/fallback-runtime and scheduler-rejection tests whose only product was the removed scheduler abstraction.

### Step 3.4 — Migrate every `debounce.rs` test with a disposition

Do not stop at the 13 anchors. For every test from `debounce.rs` in the Task 1 inventory, mark one of:

```text
KEPT
RENAMED
MECHANISM DELETED
DELETED PRODUCT RULE
```

The 13 anchor tests must be KEPT/RENAMED because their behavior remains.

Add explicit timing coverage:

```text
debounce_and_thumbnail_wait_do_not_hold_operation_gate
```

and retain existing product rules for:

- no-thumbnail acknowledgement/bursts;
- retry vs newer pending work;
- original capture deadline not reset by debounce;
- thumbnail timeout becoming unavailable without degrading persistence;
- newest follow-up after revision during in-flight write;
- health Pending while follow-up remains;
- generation-scoped successful receipts;
- no retry storm;
- stale late notify cannot mutate replacement state/tickets.

### Step 3.5 — Verify Task 3

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::autosave
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

### Step 3.6 — Commit

```bash
git add -A apps/game/src-tauri/src/game/save
git commit -m "refactor(save): keep autosave behavior without scheduler machinery"
```

---

## Task 4: Move transition/E2E/cleanup ownership without changing transition semantics

**Files:**
- Modify: `game/save/application/session.rs`
- Modify: `game/save/application/mod.rs`
- Modify: `game/save/application/autosave.rs`
- Create/Modify: `game/save/application/tests/session.rs`
- Create/Modify: `game/save/application/tests/serialization.rs`
- Migrate: `coordinator/tests/lock_order.rs`
- Migrate: `coordinator/tests/e2e_replacement.rs`
- Modify: `src-tauri/src/lib.rs`

### Step 4.1 — Move all four existing session-transition APIs, do not rewrite them

Move these existing functions from `SaveCoordinator` to the application owner/session module:

```text
install_session
install_session_if_current
clear_session
clear_session_if_current
```

Use the renamed `operation_gate` in place of the old `replacement_gate` and otherwise preserve their current validation/order/error semantics.

Pin these mismatch codes with tests:

```text
install_session_if_current -> staleSaveSelection
clear_session_if_current   -> stalePersistenceFailureToken
```

Do not implement clear behavior by copying the install mismatch body.

### Step 4.2 — Preserve transition behavior currently covered by `unit.rs`

The Task 1 ledger must map all existing install/clear generation, target-adoption, failure-token, and stale-identity tests to the new owner.

Keep, at minimum:

- session generations monotonically increase;
- manual slots are not adopted as autosave targets;
- failed detached restore leaves old session installed;
- stale transition identity produces the same typed error as before.

### Step 4.3 — Rewrite `replace_session_for_e2e` explicitly under the one gate

Keep the E2E entry point and normal frontend state-application contract.

New mechanism:

```text
validate persistence/exit state
await operation_gate
(if retained) acquire exit_transition
lock session
lock persistence state
advance generation/discovery state
clear pending/tickets/failures/health state per current replacement contract
install E2E engine
publish Healthy/Idle
reset retained E2E fault controls
```

Delete queue-era dependencies:

```text
writer_queue.invalidate_queued_for_e2e
next_autosave_serial bump
minimum_cleanup_attempt handoff
fail_next_schedule reset
```

**Decision:** E2E checkpoint replacement may wait behind in-flight persistence. Do not recreate bypass/queue invalidation.

Do not increase timeout constants preemptively. Verify the existing packaged/canonical E2E checkpoint/persistence path under current policy; only adjust timeout guidance from measured failure evidence.

### Step 4.4 — Delete dropped-writer classification when its only cause disappears

Delete `classify_dropped_writer` and update manual/delete call sites so there is no oneshot-receiver-drop classification path.

The old helper existed to reinterpret a writer future dropped by E2E queue invalidation as stale generation rather than storage failure. With direct awaited operations and no queue invalidation, that distinction is expressed by post-gate identity validation instead.

### Step 4.5 — Collapse cleanup ordering

Delete:

```text
CleanupOwner
next_cleanup_attempt
minimum_cleanup_attempt
cleanup_owner_replaces
cleanup_success_resolves
WriterJobClass::OrphanCleanup
```

Keep one current cleanup diagnostic. Run orphan cleanup under `operation_gate` at startup and retry after a later successful persistence operation when the diagnostic remains.

A cleanup I/O failure may degrade health; stale autosave discard itself may not.

### Step 4.6 — Pin the exit guard hierarchy if `exit_transition` survives

First try to remove `exit_transition` if the surviving owner/state structure makes it unnecessary.

If retained, document/enforce:

```text
exit-only transition:
  exit_transition -> session -> persistence state
  (never operation_gate)

path requiring both:
  operation_gate -> exit_transition -> session -> persistence state

forbidden:
  exit_transition -> await/acquire operation_gate
```

Do not hold `exit_transition` across callbacks, `ApplicationExit::exit`, filesystem work, or async waits.

Add the behavior-level regression:

```text
exit_request_arms_while_operation_gate_is_busy_and_flush_waits_afterward
```

Test shape:

1. hold `operation_gate`;
2. request exit;
3. prove the request reaches `ExitStatusView::Saving` without waiting for the gate;
4. release the gate;
5. prove flush/exit completes.

This replaces broad lock choreography with the one remaining no-reverse-acquisition invariant.

### Step 4.7 — Preserve waiting-delete replacement behavior without queue concepts

Migrate the existing feature-gated product rule to:

```text
replacement_before_waiting_delete_returns_stale_session_generation_and_preserves_slot
```

Assert:

```text
error code == staleSessionGeneration
slot still exists
persistence health remains Healthy
```

Use operation-gate contention/filesystem hooks, not a placeholder queued writer.

### Step 4.8 — Verify Task 4

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::session
cargo test --manifest-path apps/game/src-tauri/Cargo.toml application::tests::serialization
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Run the existing packaged checkpoint/persistence smoke when selected by current PR policy.

### Step 4.9 — Commit

```bash
git add -A apps/game/src-tauri/src
git commit -m "refactor(save): unify session replacement and cleanup ownership"
```

---

## Task 5: Collapse the remaining coordinator into `ApplicationPersistence`

**Files:**
- Modify: `game/save/application/mod.rs`
- Modify/Create: `game/save/application/tickets.rs`
- Modify/Create: `game/save/application/exit.rs`
- Modify/Create: `game/save/application/commands.rs`
- Modify: `game/save/application/autosave.rs`
- Modify: `game/save/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Move/rewrite remaining coordinator tests
- Delete: `game/save/coordinator/mod.rs`

### Step 5.1 — Move only behavior-backed state

Move retained state into one private `PersistenceState`, including:

```text
thumbnail tickets + latest-by-intent
persistence health/activity/exit status + subscribers
session/discovery generation
pending autosave
last successful write / failed write
current cleanup diagnostic
failure challenges/tokens
exit action/bypass state
```

Do not carry forward:

```text
next_autosave_serial
writer queue state
cleanup owner/attempt ordering
scheduler/failure-injection state that existed only for the scheduler
```

### Step 5.2 — Replace serial-only pending identity

Extend existing `pending_matches` to compare:

```text
session_generation
durable_revision
ticket UUID
```

A retry for the same generation/revision receives a new ticket, so it is distinct from the failed predecessor without `next_autosave_serial`.

### Step 5.3 — Delete the one-production-implementation backend/future abstraction

Move concrete capture/register/prepare/commit behavior into application/autosave methods using:

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

The test seam remains `SaveFilesystem`, not a replacement persistence backend.

### Step 5.4 — Move retained thumbnail ticket behavior

Move ticket/activity code to `tickets.rs` with semantics unchanged:

- purpose matching;
- stale ticket rejection;
- original deadline;
- intent supersession;
- submit/report failure;
- available/unavailable terminal state;
- activity publication.

Ticket wait remains outside `operation_gate`.

### Step 5.5 — Move exit behavior, retaining `ApplicationExit`

Move exit state machine to `exit.rs`. Preserve Saving/Failed/Retry/Cancel/Exit Without Saving and failure-token semantics.

Preserve the Task 4 exit hierarchy if `exit_transition` survives; do not introduce another async mutex.

### Step 5.6 — Move persistence command cores out of `lib.rs`

Move application logic for:

```text
list saves
manual save
load / load discarding current
Continue
delete
return to title / return without saving
thumbnail prepare/submit/report/read core
persistence failure cancellation
exit retry/cancel/without-saving core
```

Keep raw Tauri request/header/body decoding and thin `#[tauri::command]` adapters in `lib.rs`.

Keep generic gameplay mutation routing in `lib.rs` when shared by gameplay commands. Acquisition acknowledgement still uses `AutosaveIfAdvancedWithoutThumbnail`.

### Step 5.7 — Delete `SaveCoordinator` and reduce `AppState`

Target:

```rust
pub(crate) struct AppState {
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) persistence: Arc<ApplicationPersistence>,
    pub(crate) resources_dir: PathBuf,
}
```

Keep `save_root` only if production call-site search proves a non-persistence owner remains.

Remove `pub(crate) mod coordinator;` and delete the coordinator tree after test migration is ready.

### Step 5.8 — Verify Task 5

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

### Step 5.9 — Commit

```bash
git add -A apps/game/src-tauri/src
git commit -m "refactor(save): collapse persistence into application owner"
```

---

## Task 6: Reconcile the complete test inventory and close out the simplification

**Files:**
- Modify/create: `game/save/application/tests/*.rs`
- Delete: remaining `game/save/coordinator/tests/*`
- Update PR description/comments and Linear closeout after verification
- No production behavior expansion

### Step 6.1 — Disposition every baseline test, not just the named subset

Use the Task 1 PR-comment inventory as the source of truth.

Create a closeout table with one row per baseline `(path, test_name)`:

```text
BASELINE PATH::NAME | DISPOSITION | DESTINATION / REASON
```

Allowed dispositions:

```text
KEPT
RENAMED
MECHANISM DELETED
DELETED PRODUCT RULE
```

Rules:

- `KEPT`/`RENAMED` must name the final destination test.
- `MECHANISM DELETED` must name the deleted sole subject, e.g. WriterQueue order or scheduler rejection.
- `DELETED PRODUCT RULE` must explain why the externally observable behavior itself was intentionally removed.
- The 13 autosave anchors cannot use either deletion disposition in HPA-521.
- `unit.rs`, `exit_lifecycle.rs`, `flush.rs`, `ticket.rs`, `failure_token.rs`, `storage_integration.rs`, `e2e_replacement.rs`, useful `lock_order.rs` behavior, and inline coordinator tests all require dispositions.

Compare the number of disposition rows to the Task 1 baseline count. No baseline test may disappear silently.

### Step 6.2 — Explicitly verify the load-bearing behavior matrix

Final tests must cover at least:

```text
failed gameplay command -> no autosave / previous committed save intact
trailing debounce -> newest revision wins
no-thumbnail acknowledgement/burst/retry -> no capture activity/request
thumbnail deadline -> debounce does not reset it
capture timeout -> unavailable thumbnail without persistence degradation
revision during in-flight write -> one newest follow-up
health stays Pending while follow-up remains
old-generation high revision cannot suppress new-generation lower revision
failed revision does not timer-loop; explicit retry acts once
stale late notify cannot mutate replacement state or supersede replacement ticket
identity-bound capture never binds newer checkpoint to older receipt
successfully discarded stale autosave is benign
stale-discard I/O failure is a real failure
manual/delete/autosave storage mutation max concurrency == 1
blocked filesystem work leaves AppSession mutex responsive
install_session_if_current mismatch -> staleSaveSelection
clear_session_if_current mismatch -> stalePersistenceFailureToken
failed detached restore leaves old session
waiting stale delete after replacement leaves slot + returns staleSessionGeneration
E2E checkpoint replacement waits for in-flight persistence and then installs through normal state path
exit request can arm while operation_gate is busy; flush waits afterward
exit success/failure/retry/cancel/without-saving unchanged
thumbnail ticket/activity behavior unchanged
atomic storage/corrupt-save behavior unchanged
```

### Step 6.3 — Remove all mechanism-only test infrastructure

Delete helpers/tests whose only subject is:

```text
WriterQueue / WriterJobClass
queue worker scheduling/order
queue invalidation/drop classification
CoordinatorTaskScheduler / fallback thread
scheduler rejection/fail_next_schedule
G/S/W generic lock choreography
replacement_gate as a distinct lock
CleanupOwner Receipt vs Attempt ordering
```

Do not recreate these concepts in application test helpers.

### Step 6.4 — Run both Rust feature surfaces

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Both are mandatory; default CI coverage alone does not exercise all `#[cfg(feature = "e2e")]` behavior.

### Step 6.5 — Run repository validation

```bash
bun run check
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
```

Run current packaged persistence/checkpoint/Continue E2E coverage when selected by existing PR policy. Do not add a new E2E suite or increase timeouts without evidence.

### Step 6.6 — Search for forbidden remnants

```bash
rg 'WriterQueue|WriterJobClass|QueuedWriterJob|replacement_gate|CoordinatorTaskScheduler|PortableCoordinatorTaskScheduler|TauriCoordinatorTaskScheduler|AutosaveBackend|CoordinatorFuture|CleanupOwner|next_autosave_serial|minimum_cleanup_attempt|lyra-save-coordinator|classify_dropped_writer' apps/game/src-tauri/src
```

Expected: no production matches. Historical planning docs outside `src` do not block completion.

If `exit_transition` remains, also inspect every acquisition and prove no path holds it while waiting for `operation_gate`.

### Step 6.7 — Record production/test line counts separately

Record:

```bash
find apps/game/src-tauri/src/game/save/application -maxdepth 1 -name '*.rs' -print0 | xargs -0 wc -l
find apps/game/src-tauri/src/game/save/application/tests -name '*.rs' -print0 | xargs -0 wc -l
wc -l apps/game/src-tauri/src/lib.rs
```

Also record the final production/setup prefix of `lib.rs` separately from its top-level test module.

Expected:

- material production persistence/orchestration deletion;
- no replacement framework;
- test lines reported separately and allowed to remain similar when product coverage is retained.

### Step 6.8 — Final source self-review

Confirm directly in source:

```text
A. the old replacement_gate object was widened/renamed, not duplicated
B. debounce + thumbnail-terminal wait precede operation_gate
C. capture validates exact requested generation/revision
D. pre-commit revalidation checks the same identity
E. successful stale discard does not enter background-failure state
F. all four install/clear functions preserve existing typed errors/semantics
G. replace_session_for_e2e uses operation_gate and no queue invalidation
H. classify_dropped_writer is gone
I. no exit_transition path waits for operation_gate
J. complete baseline test inventory has one disposition per row
```

### Step 6.9 — Commit closeout

```bash
git add -A apps/game/src-tauri/src
git commit -m "test(save): reconcile persistence coverage after coordinator removal"
```

---

## Final Self-Review Checklist

- [ ] Same existing gate object widened from replacement-only to `operation_gate`.
- [ ] One `ApplicationPersistence` owner in `AppState`.
- [ ] No queue/actor/channel/scheduler/backend replacement framework.
- [ ] Debounce and thumbnail wait outside gate.
- [ ] Exact identity before capture and before commit.
- [ ] Benign stale discard never creates persistence failure; discard I/O failure still does.
- [ ] Gameplay session mutex free during filesystem work.
- [ ] `install_session`, `install_session_if_current`, `clear_session`, `clear_session_if_current` moved, not semantically rewritten.
- [ ] `staleSaveSelection` and `stalePersistenceFailureToken` remain distinct where currently used.
- [ ] E2E replacement explicitly migrated; may wait behind in-flight persistence.
- [ ] `classify_dropped_writer` removed with queue invalidation.
- [ ] Waiting stale delete preserves slot.
- [ ] HPA-549/HPA-550 behavior unchanged.
- [ ] Exit guard hierarchy explicit if guard remains; no reverse gate acquisition.
- [ ] Complete recursive coordinator test baseline recorded.
- [ ] Every baseline test has KEPT/RENAMED/MECHANISM DELETED/DELETED PRODUCT RULE disposition.
- [ ] All 13 autosave anchors retained/replaced.
- [ ] Real staged-write filesystem seam reused.
- [ ] Default and `--all-features` Rust tests pass.
- [ ] Repository validation passes.
- [ ] Production code materially smaller; test counts measured separately.
- [ ] Task 1 is isolated as first move-only commit in the **same** HPA-521 PR.

## Implementation Handoff

Continue on the existing HPA-521 branch and draft PR. Review Task 1 as a standalone move-only commit, then execute Tasks 2–6 sequentially in the same PR. Do not create a second PR for the extraction and do not merge an intermediate architecture while queue/backend/scheduler remnants remain as permanent products.
