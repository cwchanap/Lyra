# HPA-521 Single-Owner Save Persistence Simplification Design

## Status

Planning specification for HPA-521 against `main` at `0521a122636847a43fada24478dd9b74f1df84d0`.

This is a pre-release architecture simplification. It optimizes for development speed, correctness, and maintainability rather than preserving the internal persistence machinery shipped by HPA-392.

The prerequisite product decisions are settled:

- HPA-549 is complete: acquisition acknowledgement is an ordinary gameplay mutation plus ordinary no-thumbnail autosave. There is no dedicated acknowledgement persistence transaction to preserve.
- HPA-550 is complete with the product-owner decision **retain current dynamic save thumbnails**. HPA-521 keeps the existing thumbnail capture-ticket product; removing or replacing it would reopen a closed product decision.
- HPA-265 is complete and HPA-266 is a duplicate of HPA-265, so the Chapter 1 first-version gate has an effective completed successor.

HPA-521 is the next persistence architecture task before HPA-536 release hardening and before HPA-560 considers E2E orchestration simplification.

## Review resolution

A follow-up design review was checked against current `main` rather than accepted mechanically.

| Finding | Verdict | Resolution |
| --- | --- | --- |
| Identity-bound checkpoint capture must survive the queue deletion | **Valid** | The pending autosave's `(session_generation, durable_revision)` is checked before capture and again immediately before commit. Never capture "whatever is current" under a receipt for an older revision. |
| `operation_gate` scope must exclude debounce and thumbnail waiting | **Valid** | Debounce and terminal-thumbnail wait happen before the gate. The gate begins only when disk mutation/final session replacement is ready to run. |
| Existing debounce tests contain product behavior, not only queue choreography | **Valid** | The implementation plan now has a named migration ledger for the retained HPA-549/HPA-550/generation/retry/health cases plus the waiting-delete replacement invariant. Test coverage outranks test-line reduction. |
| Reuse the existing staged-write filesystem seam | **Valid with narrowing** | Reuse/extract the existing `TrackingFilesystem` / `ProductionSaveFilesystem` + `StagedAtomicWrite` tracking/pause pattern. Do not carry the old `AutosaveBackend` W/G/S harness into the new design and do not invent a second backend trait. |
| One owner must not become one 4k-line file | **Valid** | `ApplicationPersistence` is one public owner split across a few private responsibility modules. No service container or trait graph is introduced. |
| Closeout must run e2e-gated Rust tests explicitly | **Valid** | Both default and `--all-features` Rust test suites are mandatory closeout commands. |
| Scheduler abstraction should disappear | **Valid, with test-runtime correction** | Production timer/continuation work calls `tauri::async_runtime::spawn` directly. Tests do not replace it with another scheduler trait, but most deterministic tests call the private async behavior directly because Tauri's singleton runtime is not assumed to share each `#[tokio::test(start_paused)]` clock. Keep at most one real-time scheduling smoke. |

The architecture remains Option A: one owner and one `tokio::sync::Mutex<()>` operation gate.

## Current-state survey

The current architecture still contains the complexity HPA-521 was created to remove:

- `apps/game/src-tauri/src/game/save/coordinator/mod.rs` is about 150 KB and combines writer serialization, task scheduling, autosave debounce, retry state, thumbnail tickets, persistence health, exit lifecycle, session generations, stale-write handling, cleanup ordering, and failure challenges.
- `apps/game/src-tauri/src/lib.rs` is about 205 KB despite its header saying it primarily registers Tauri commands. It still contains `ApplicationPersistence`, storage orchestration, manual save/delete/load/continue/return-to-title flows, persistence events, and persistence-specific command cores.
- `coordinator/tests/debounce.rs` is large because it covers both queue internals **and real autosave product rules**. It must be inventoried, not bulk-deleted.
- `coordinator/tests/writer.rs` is primarily queue-mechanism coverage and can disappear once equivalent serialization behavior is proven at the application boundary.
- `coordinator/tests/lock_order.rs` mixes lock choreography with real stale-write/session-responsiveness behavior. The choreography disappears; the behavior remains.

The current writer flow is roughly:

```text
gameplay mutation
  -> pending autosave + thumbnail ticket
  -> debounce / thumbnail wait
  -> WriterQueue / WriterJobClass
  -> AutosaveBackend capture/register/prepare
  -> replacement_gate
  -> generation/revision revalidation
  -> commit

manual save / delete / blocking flush / cleanup
  -> WriterQueue
  -> oneshot result channel
  -> storage operation
```

`WriterQueue` supplies serialization, not useful throughput. A mutex expresses the requirement more directly.

## Decision summary

Replace the persistence scheduler graph with **one concrete application persistence owner and one async operation gate**.

Final high-level ownership:

```text
AppState
  -> session: Arc<Mutex<AppSession>>
  -> persistence: Arc<ApplicationPersistence>
  -> resources_dir

ApplicationPersistence
  -> state: Mutex<PersistenceState>
  -> operation_gate: tokio::sync::Mutex<()>
  -> session: Arc<Mutex<AppSession>>
  -> fs / root / discovery / saved-at clock
  -> autosave + flush + manual save + delete + cleanup
  -> final session install/clear
  -> retained thumbnail tickets/activity
  -> health/failure/exit state
```

All **disk-mutating persistence work and final session replacement** serialize through `operation_gate`.

The gate does **not** cover:

- the 500 ms autosave debounce sleep;
- waiting for an autosave thumbnail ticket to become terminal or reach its existing deadline;
- frontend thumbnail capture;
- detached restore candidate construction;
- ordinary gameplay mutation while no persistence commit/final replacement is occurring.

There is no writer-job queue, writer class hierarchy, queue worker, replacement gate, generic persistence backend, or custom scheduler after this refactor.

`ApplicationPersistence` is the one application persistence owner. `SaveCoordinator` is deleted rather than retained as a façade over the same state machine.

## File and module boundary

"One owner" does not mean one giant source file.

Use one public crate-private owner with a small number of private responsibility modules:

```text
apps/game/src-tauri/src/game/save/
├── application/
│   ├── mod.rs          # ApplicationPersistence, PersistenceState, shared views/helpers
│   ├── autosave.rs     # debounce completion, identity-bound capture, flush, commit, cleanup
│   ├── tickets.rs      # retained HPA-550 thumbnail ticket/activity lifecycle
│   ├── session.rs      # AppSession/SessionPersistence and final install/clear identity checks
│   ├── exit.rs         # close/quit Saving/Failed/Retry/Cancel/Without Saving behavior
│   ├── commands.rs     # persistence-specific command cores; no Tauri transport decoding
│   └── tests/
├── capture.rs
├── e2e_faults.rs
├── mod.rs
├── restore.rs
├── schema.rs
├── storage.rs
└── thumbnail.rs
```

This is a responsibility split behind one owner, not multiple services:

- no module has its own operation gate;
- no module owns a second persistence state object;
- no trait is added to connect these private modules;
- `ApplicationPersistence` remains the only object held by `AppState` for persistence operations.

If implementation shows one listed private module is too small to earn a file, fold it into the nearest owner module. Do not add more layers merely to match this diagram.

## Why direct serialization is the right mechanism

### Option A — one async mutex, direct operations — selected

Advantages:

- expresses the real invariant directly: only one disk mutation or final session replacement owns persistence authority at once;
- deletes `WriterQueue`, `WriterJobClass`, worker startup, queue invalidation, writer probes, and oneshot handoff plumbing;
- turns flush/manual/delete into ordinary async calls;
- preserves stale-write correctness explicitly through identity checks rather than queue position;
- keeps long filesystem work off the gameplay session mutex;
- is small enough for a hobby project without sacrificing later feature maintainability.

### Option B — smaller queue — rejected

A smaller queue still needs enqueueing, worker lifetime, cancellation/supersession rules, result delivery, and queue-specific tests. It preserves the wrong abstraction.

### Option C — actor/channel owner — rejected

An actor adds a mailbox protocol, request/response channels, shutdown semantics, and another concurrency product. No evidence justifies it for one local save directory and one window.

## Core behavior after the refactor

### 1. Autosave coalescing happens before the gate

A pending autosave retains the existing product identity:

```text
(session_generation, durable_revision, thumbnail_ticket)
```

`next_autosave_serial` is removed. The ticket is already a UUID; generation + revision + ticket uniquely identifies the pending attempt.

Flow:

```text
notify durable commit
  -> issue/retain the HPA-550 thumbnail ticket behavior
  -> replace pending autosave identity
  -> spawn trailing debounce timer
  -> sleep until debounce deadline                         [NO operation_gate]
  -> verify this identity is still pending
  -> wait for existing ticket deadline/terminal result   [NO operation_gate]
  -> verify this identity is still pending
  -> acquire operation_gate
  -> verify this identity is still pending again
  -> identity-bound checkpoint capture
  -> prepare staged write
  -> revalidate same session generation + durable revision
  -> commit, or discard stale staged write
```

A later durable revision supersedes the earlier pending identity before the gate. An in-flight write for an older revision may finish as stale; the newer pending identity remains responsible for the follow-up write.

### 2. Capture is identity-bound, never "capture current checkpoint"

The current production safety rule remains mandatory:

> For an autosave job for `(generation = G, revision = R)`, checkpoint capture is allowed only while the live session is still `G` and the live engine durable revision is still `R`.

Therefore `execute_pending_autosave` must perform a pre-capture check equivalent to today's `ApplicationPersistence::capture`:

```rust
if session.persistence.generation != pending.session_generation
    || engine.durable_revision() != pending.durable_revision
{
    // stale pending work: retire/discard; never bind a newer checkpoint to R
}
```

After staging, immediately before `commit_prepared_slot_write`, revalidate **the same** `(G, R)` identity again. If it no longer matches, discard the staged write.

The operation gate prevents another persistence install from racing the commit, but ordinary gameplay can still advance the durable revision while filesystem staging is in progress. The pre-capture and pre-commit checks are therefore both required.

### 3. Gate scope begins only when persistence mutation is ready

The operation gate may be held across filesystem staging/install because its purpose is disk mutation serialization.

It must not be held while waiting for:

- debounce time;
- a thumbnail capture response;
- the 5 second thumbnail timeout;
- detached restore construction.

This prevents a slow or unavailable thumbnail capture from blocking Load, Continue, manual save, delete, or exit before those operations even reach their disk work.

For flush/exit, wait on the operation gate only for the persistence work itself. Do not wait for a new thumbnail capture while holding the gate.

### 4. Manual save, delete, autosave, flush, cleanup share the same gate

Manual save/delete no longer reserve queue turns or create oneshot result channels. They await the gate and perform their existing storage operations directly.

A waiting operation must revalidate any captured session/browser identity **after acquiring the gate and before mutating storage**.

This is important for delete:

- delete captures the observed session/save-browser identity;
- if final replacement wins `operation_gate` first, the waiting delete must fail with stale identity and leave the slot intact;
- if delete wins first, it may complete before replacement installs.

Do not preserve queue invalidation to achieve this ordering.

### 5. Load/Continue may wait for in-flight disk work

`replacement_gate` is removed.

Load/Continue still build `RestoredGameCandidate` detached from the live session. Final install acquires the same `operation_gate`, then revalidates `SessionTransitionIdentity` and swaps the engine.

It is acceptable that Load/Continue wait for an in-flight save/delete operation. Preserving the old prepare/install overlap would require recreating a second lock graph, defeating HPA-521.

A failed restore still leaves the current session untouched because candidate construction remains detached and no install occurs until all validation succeeds.

### 6. Flush is a direct barrier

A blocking flush:

1. reads the required live session identity/revision;
2. cancels a covered pending autosave using the existing terminal thumbnail result when available;
3. acquires `operation_gate`;
4. revalidates the required identity;
5. observes whether an already-committed receipt covers the revision;
6. otherwise captures **that exact revision**, stages it, revalidates it, and commits;
7. records the receipt in `SessionPersistence`.

If an autosave already owns the gate, flush waits and then decides whether another write is necessary.

### 7. Cleanup is best-effort state, not job ordering

Remove:

- `CleanupOwner`;
- `next_cleanup_attempt`;
- `minimum_cleanup_attempt`;
- receipt-vs-attempt precedence helpers;
- `WriterJobClass::OrphanCleanup`.

Orphan cleanup runs through the same operation gate at startup and when retrying a current cleanup diagnostic. Only the current diagnostic matters to the UI.

Cleanup must not recreate its own queue, generation counter, or worker class.

### 8. Background task spawning is concrete

Delete:

- `CoordinatorTask`;
- `CoordinatorTaskScheduler`;
- `PortableCoordinatorTaskScheduler`;
- fallback Tokio runtime/thread;
- `TauriCoordinatorTaskScheduler`;
- scheduler injection and scheduler-failure tests.

Production debounce, thumbnail-expiry, and exit continuation tasks call:

```rust
tauri::async_runtime::spawn(async move {
    // timer/continuation only; persistence serialization is operation_gate
});
```

Do not add `TaskSpawner`, `Scheduler`, or another one-production-implementation wrapper.

#### Test-runtime rule

Tauri's async runtime is a singleton runtime. Deterministic tests must not assume `tauri::async_runtime::spawn` shares the current `#[tokio::test(start_paused = true)]` clock.

Therefore:

- most unit tests call the private async behavior that runs **after** debounce/ticket readiness, with explicit pending identities;
- timer deadline math is tested as pure/state behavior where useful;
- keep at most one real-time scheduling smoke proving a scheduled debounce eventually invokes the real path;
- delete the plain-thread/fallback-runtime test;
- do not add a scheduler trait merely to regain clock injection.

### 9. Dynamic thumbnail behavior is retained exactly

HPA-550 retained the current product. HPA-521 keeps:

- autosave/manual-save thumbnail purposes;
- capture tickets and UUID identity;
- ticket deadlines;
- intent supersession;
- prepare/submit/failure/read IPC;
- `ThumbnailActivityView`;
- PNG validation and size limits;
- non-blocking thumbnail failure semantics;
- stored descriptors/read behavior.

The gate begins **after** autosave terminal-thumbnail wait. Thumbnail ticket state uses `PersistenceState`, not the operation gate, until a persistence operation consumes the result.

No native capture or preview removal is in scope.

### 10. Failure/discovery identities stay because they protect player actions

Retain unless an implementation-time search proves a field has no production consumer:

- `next_session_generation`;
- `discovery_generation`;
- persistence failure UUID challenges;
- thumbnail ticket UUIDs and `latest_by_intent`.

Remove queue-only identities:

- `next_autosave_serial`;
- cleanup attempt ordering.

A stale late `notify_durable_commit` from an old session must still be rejected before it mutates pending/ticket state or supersedes a replacement session's live ticket.

### 11. Exit keeps behavior, not lock choreography

Player contract remains:

- ordinary close/quit enters Saving;
- successful flush exits;
- failed flush produces one typed actionable failure;
- Retry/Cancel/Exit Without Saving require the current failure token;
- duplicate close/quit does not start duplicate flushes.

Exit waits for `operation_gate` only when persistence work is ready to run. It does not create writer priority.

If a tiny synchronous exit-state transition guard remains necessary, it is exit-specific state protection, not a second disk-serialization boundary. There is no general lock-order suite in the final design.

## Reuse survey

| Need | Decision |
| --- | --- |
| Atomic slot writes | Reuse `save/storage.rs` `prepare_slot_write`, `commit_prepared_slot_write`, `discard_prepared_slot_write`, and `delete_slot`. |
| Filesystem seam | Keep `SaveFilesystem`; it has production, E2E-faulting, and useful test implementations. |
| Staged-write behavior tests | Extract/reuse the existing `TrackingFilesystem` pattern that delegates to `ProductionSaveFilesystem` and wraps `StagedAtomicWrite`. Reuse the existing pause-after-prepare technique; do not add a second fake backend. |
| Detached load safety | Reuse `build_restore_candidate` and `SessionTransitionIdentity`. |
| Autosave target selection | Reuse `select_autosave_target`. |
| Thumbnail validation/storage | Reuse current types/IPC unchanged. |
| Persistence status | Reuse health/activity/exit views/events. |
| Acquisition acknowledgement | Keep HPA-549 ordinary no-thumbnail autosave behavior. |
| Disk serialization | One `tokio::sync::Mutex<()>`. |
| Background scheduling | Direct `tauri::async_runtime::spawn` in production; no scheduler abstraction. |
| Exit boundary | Keep `ApplicationExit`: production `app.exit` and test implementations give it more than one meaningful implementation. |

## Test migration is an inventory, not a deletion slogan

The queue is an implementation detail; the following existing tests encode retained product rules and must be migrated deliberately.

### Required debounce/retry/identity migrations

Each old test below must either:

1. still exist under `application/tests/` with the same name (preferred when semantics are unchanged), or
2. have an explicit one-line disposition in the PR closeout naming the new test that supersedes it, or stating why the product rule itself was intentionally removed.

Required inventory:

```text
no_thumbnail_analysis_burst_writes_latest_revision_without_thumbnail_activity
no_thumbnail_retry_and_supersession_never_issue_capture_request
stale_no_thumbnail_retry_cannot_replace_a_newer_pending_write
<the two existing *_does_not_supersede_newer_pending_write_after_eligibility tests>
debounce_spends_the_existing_ticket_deadline
capture_timeout_writes_unavailable_without_degrading_persistence
revision_during_write_schedules_one_follow_up_for_newest_revision
first_write_success_keeps_health_pending_while_follow_up_is_outstanding
prior_generation_high_revision_never_suppresses_new_generation_low_revision
failed_revision_does_not_timer_loop_and_explicit_actions_retry_once
stale_notify_durable_commit_is_rejected_before_mutating_coordinator_state
stale_notify_durable_commit_cannot_supersede_live_replacement_autosave_ticket
```

These cover HPA-549 no-thumbnail behavior, HPA-550 deadline/failure behavior, follow-up scheduling, health truth, generation-scoped receipts, retry-storm prevention, and stale late notifications.

### Required queued-delete successor

The queue-specific mechanism may disappear, but the player-visible invariant must remain:

> If replacement installs before a delete that was waiting for persistence authority, the stale delete returns `staleSessionGeneration` and does not remove the slot.

Migrate `replacement_invalidating_queued_delete_returns_stale_session_generation` to an application-level test such as:

```text
replacement_before_waiting_delete_returns_stale_session_generation_and_preserves_slot
```

No test should observe a queued future or delete-enqueued notification.

### Delete outright

Delete tests whose only subject is:

- `WriterQueue` ordering/worker startup;
- scheduler rejection/fallback thread;
- W/G/S lock labels;
- queue invalidation mechanics;
- cleanup receipt-vs-attempt ordering.

### Staged-write helper rule

Do not create a new persistence backend fake.

Move/extract the minimum useful helper from current storage integration tests:

- delegate real file behavior to `ProductionSaveFilesystem`;
- wrap `StagedAtomicWrite` to count install/discard;
- add a pause/release hook around the staged-write boundary or immediately after preparation;
- optionally track active mutation count for the one-gate serialization assertion.

This proves real staging/discard behavior while keeping `AutosaveBackend` deleted.

## Line-count policy

Line counts are diagnostic evidence, not permission to delete product tests.

Closeout records production and test counts separately:

- production persistence owner/modules;
- remaining production portion of `src-tauri/src/lib.rs`;
- persistence test code.

Expected result: **material production-code deletion** because queue/backend/scheduler/lock-graph machinery disappears.

Do not fail the refactor merely because migrated behavior tests do not shrink by the same percentage. If test code grows slightly to express behavior instead of internals, that is acceptable when the named migration inventory remains intact.

A large production increase or a new replacement abstraction is a stop signal and requires simplification before completion.

## Verification contract

Closeout must run both Rust feature surfaces explicitly:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Also run:

```bash
bun run check
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
```

Keep the existing packaged save/Continue smoke only when current PR policy selects it. Do not add a new packaged E2E suite for HPA-521.

## Single-PR boundary

HPA-521 remains one implementation PR with reviewable internal commits.

Do not merge an intermediate architecture with two permanent serialization products.

In scope:

- one `ApplicationPersistence` owner;
- one operation gate;
- identity-bound capture and pre-commit revalidation;
- writer queue/backend/scheduler/fallback-runtime deletion;
- stale-write/flush/replacement/delete behavior preservation;
- modular extraction from `lib.rs`;
- named behavior-test migration;
- production net deletion.

Out of scope:

- thumbnail product redesign;
- acquisition acknowledgement transaction redesign;
- save schema/compatibility framework changes;
- Chapter 2 work;
- generic service/repository architecture;
- E2E router simplification;
- full Chapter 1 release hardening.

## Acceptance criteria

- [ ] `ApplicationPersistence` is the only application persistence owner held by `AppState`.
- [ ] Exactly one async `operation_gate` serializes disk mutation and final session replacement.
- [ ] No actor/channel/queue replaces `WriterQueue`.
- [ ] Debounce and autosave thumbnail waiting happen outside `operation_gate`.
- [ ] Autosave checkpoint capture is bound to the pending generation/revision, not merely the current live checkpoint.
- [ ] Every staged save revalidates that same identity immediately before commit and discards stale staging.
- [ ] Load/Continue may wait for in-flight disk work; no second replacement gate survives.
- [ ] Waiting stale delete after replacement cannot remove the slot.
- [ ] `SaveCoordinator`, `WriterQueue`, `WriterJobClass`, custom scheduler/fallback runtime, and `AutosaveBackend`/`CoordinatorFuture` are gone.
- [ ] HPA-550 dynamic thumbnail behavior is unchanged.
- [ ] HPA-549 acknowledgement remains ordinary no-thumbnail autosave.
- [ ] Failure/discovery identities that protect stale player actions remain.
- [ ] The named debounce/retry/generation/health test inventory has explicit migration dispositions.
- [ ] Tests use the existing real staged-write filesystem seam rather than a new backend abstraction.
- [ ] `lib.rs` is setup/transport/gameplay routing rather than persistence implementation.
- [ ] Production persistence code is materially smaller; test counts are recorded separately without using line-count pressure to remove product behavior.
- [ ] Default and `--all-features` Rust suites plus repository checks pass.
