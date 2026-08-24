# HPA-521 Single-Owner Save Persistence Simplification Design

## Status

Planning specification for HPA-521 against `main` at `0521a122636847a43fada24478dd9b74f1df84d0`.

This is a pre-release architecture simplification. It optimizes for development speed, correctness, and maintainability rather than preserving the internal persistence machinery shipped by HPA-392.

The prerequisite product decisions are settled:

- HPA-549 is complete: acquisition acknowledgement is an ordinary gameplay mutation plus ordinary no-thumbnail autosave. There is no dedicated acknowledgement persistence transaction to preserve.
- HPA-550 is complete with the product-owner decision **retain current dynamic save thumbnails**. HPA-521 keeps the existing thumbnail capture-ticket product.
- HPA-265 is complete and HPA-266 is a duplicate of HPA-265, so the Chapter 1 first-version gate has an effective completed successor.

HPA-521 is the next persistence architecture task before HPA-536 release hardening and before HPA-560 considers E2E orchestration simplification.

## Review resolution

A follow-up review was checked against current `main` rather than accepted mechanically.

| Finding | Verdict | Resolution |
| --- | --- | --- |
| Identity-bound checkpoint capture must survive queue deletion | **Valid** | Check the pending `(session_generation, durable_revision)` before checkpoint capture and again immediately before commit. Never capture "whatever is current" under an older receipt. |
| `operation_gate` scope must exclude debounce and thumbnail waiting | **Valid** | Debounce and terminal-thumbnail wait happen before the gate. The gate begins only when disk mutation/final replacement is ready. |
| `debounce.rs` contains product behavior, not only queue choreography | **Valid** | Use a named migration ledger. Product-test retention outranks test-line reduction. |
| Reuse the existing staged-write filesystem seam | **Valid with narrowing** | Reuse/extract the current `TrackingFilesystem` / `ProductionSaveFilesystem` + `StagedAtomicWrite` tracking/pause pattern. Do not carry the old `AutosaveBackend` W/G/S harness forward. |
| One owner must not become one 4k-line file | **Valid** | Keep one public owner behind a few private responsibility modules. No service container or trait graph. |
| Closeout must run e2e-gated Rust tests explicitly | **Valid** | Run both default and `--all-features` Rust suites. |
| Scheduler abstraction should disappear | **Valid with test-runtime correction** | Production uses direct `tauri::async_runtime::spawn`. Deterministic tests call private async behavior directly because Tauri's singleton runtime is not assumed to share each `#[tokio::test(start_paused)]` clock. Keep at most one real-time scheduling smoke. |

The architecture remains Option A: one owner and one `tokio::sync::Mutex<()>` operation gate.

## Current-state survey

Current `main` still has the complexity HPA-521 was created to remove:

- `game/save/coordinator/mod.rs` is about 150 KB and combines writer serialization, task scheduling, autosave debounce/retry, thumbnail tickets, persistence health, exit lifecycle, stale-write handling, cleanup ordering, and failure challenges.
- `src-tauri/src/lib.rs` is about 205 KB and still owns `ApplicationPersistence`, storage orchestration, save browser/manual/load/continue/delete/return flows, and persistence command cores.
- `coordinator/tests/debounce.rs` contains real HPA-549/HPA-550/retry/generation/health behavior and cannot be bulk-deleted.
- `coordinator/tests/writer.rs` is mainly queue-mechanism coverage.
- `coordinator/tests/lock_order.rs` mixes lock choreography with real stale-write/session-responsiveness behavior.

Current flow:

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

`WriterQueue` supplies serialization, not useful throughput. A mutex expresses the requirement directly.

## Decision summary

Replace the persistence scheduler graph with **one concrete application persistence owner and one async operation gate**.

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
- detached restore candidate construction.

There is no writer queue, writer class hierarchy, queue worker, replacement gate, generic persistence backend, or custom scheduler after this refactor.

`ApplicationPersistence` is the one application persistence owner. `SaveCoordinator` is deleted rather than kept as a façade over the same state machine.

## File and module boundary

"One owner" does not mean one giant source file.

```text
apps/game/src-tauri/src/game/save/
├── application/
│   ├── mod.rs          # ApplicationPersistence, PersistenceState, shared owner surface
│   ├── autosave.rs     # ready autosave, exact capture, flush, commit, cleanup
│   ├── tickets.rs      # retained HPA-550 thumbnail ticket/activity lifecycle
│   ├── session.rs      # AppSession/SessionPersistence and install/clear identity checks
│   ├── exit.rs         # Saving/Failed/Retry/Cancel/Without Saving behavior
│   ├── commands.rs     # persistence command cores; no Tauri transport decoding
│   └── tests/
├── capture.rs
├── e2e_faults.rs
├── mod.rs
├── restore.rs
├── schema.rs
├── storage.rs
└── thumbnail.rs
```

This is a responsibility split behind one owner:

- no private module has its own operation gate;
- no private module owns a second persistence state object;
- no trait is added to connect private modules;
- `ApplicationPersistence` remains the only persistence object held by `AppState`.

If one listed module is too small to earn a file, fold it into its nearest neighbor.

## Core behavior

### 1. Autosave coalescing happens before the gate

A pending autosave retains this identity:

```text
(session_generation, durable_revision, thumbnail_ticket)
```

`next_autosave_serial` is removed. The ticket is already a UUID; generation + revision + ticket distinguish stale work.

```text
notify durable commit
  -> issue/retain HPA-550 ticket behavior
  -> replace pending autosave identity
  -> spawn trailing debounce timer
  -> sleep until debounce deadline                         [NO operation_gate]
  -> verify identity still pending
  -> wait for existing ticket terminal/deadline           [NO operation_gate]
  -> verify identity still pending
  -> acquire operation_gate
  -> verify identity still pending
  -> identity-bound checkpoint capture
  -> prepare staged write
  -> revalidate same session generation + durable revision
  -> commit, or discard stale staged write
```

A later durable revision supersedes an earlier pending identity before gate acquisition. An in-flight older write may become stale; the newer pending identity remains responsible for one follow-up write.

### 2. Capture is identity-bound

For pending `(generation = G, revision = R)`, checkpoint capture is allowed only while the live session is exactly `G/R`.

Before `capture_checkpoint`:

```rust
if session.persistence.generation != pending.session_generation
    || engine.durable_revision() != pending.durable_revision
{
    // stale work: never bind a newer checkpoint to R
}
```

After staging, immediately before `commit_prepared_slot_write`, revalidate **the same** `(G, R)`. If it changed, discard the staged write.

Both checks remain required because ordinary gameplay can advance durable revision while filesystem staging is in progress.

### 3. Gate scope begins only when mutation is ready

`operation_gate` may be held across filesystem staging/install because it serializes persistence mutation.

It must not be held while waiting for:

- debounce time;
- thumbnail response;
- the existing 5-second thumbnail timeout;
- detached restore construction.

This prevents capture latency from blocking Load, Continue, manual save, delete, or exit before those operations reach disk work.

### 4. Manual save, delete, autosave, flush, cleanup share the gate

Manual save/delete become direct async operations rather than queued jobs + oneshots.

Any operation that captured session/browser identity before waiting for the gate must revalidate after gate acquisition and before storage mutation.

For delete:

- if final replacement wins the gate first, the waiting delete returns stale identity and leaves the slot intact;
- if delete wins first, it may complete before replacement installs.

No queue invalidation is retained.

### 5. Load/Continue may wait for in-flight persistence work

`replacement_gate` is removed.

Load/Continue build `RestoredGameCandidate` detached from the live session. Final install acquires `operation_gate`, revalidates `SessionTransitionIdentity`, then swaps the engine.

It is acceptable that Load/Continue wait for an in-flight save/delete. Preserving the old overlap would recreate a second lock graph.

A failed restore still leaves the live session untouched.

### 6. Flush is a direct barrier

A blocking flush:

1. reads required live session identity/revision;
2. cancels a covered pending autosave using its existing terminal thumbnail result when available;
3. acquires `operation_gate`;
4. revalidates identity;
5. observes whether a successful receipt already covers the revision;
6. otherwise captures **that exact revision**, stages, revalidates, and commits;
7. records the receipt in `SessionPersistence`.

If autosave already owns the gate, flush waits and then decides whether another write is required.

### 7. Cleanup is best-effort state, not job ordering

Remove:

- `CleanupOwner`;
- cleanup attempt counters/high-water marks;
- receipt-vs-attempt precedence helpers;
- `WriterJobClass::OrphanCleanup`.

Cleanup runs under the same operation gate at startup and when retrying the current cleanup diagnostic. It does not get a new queue or generation counter.

### 8. Background task spawning is concrete

Delete:

- `CoordinatorTask`;
- `CoordinatorTaskScheduler`;
- `PortableCoordinatorTaskScheduler`;
- `TauriCoordinatorTaskScheduler`;
- fallback Tokio runtime/thread;
- scheduler injection/failure tests.

Production timers/continuations call:

```rust
tauri::async_runtime::spawn(async move {
    // timer/continuation only; operation_gate owns persistence serialization
});
```

Do not add a replacement scheduler/task-spawner trait.

Tauri's async runtime is a singleton runtime, so deterministic tests must not assume this spawn shares a `#[tokio::test(start_paused)]` clock. Most tests directly await the private readiness/execution path; retain at most one real-time scheduling smoke.

### 9. Dynamic thumbnail behavior is retained exactly

HPA-550 retained the product. Keep:

- autosave/manual-save thumbnail purposes;
- capture tickets and UUID identity;
- ticket deadlines;
- intent supersession;
- prepare/submit/failure/read IPC;
- `ThumbnailActivityView`;
- PNG validation/size limits;
- non-blocking thumbnail failure;
- stored descriptors/read behavior.

The gate begins after autosave terminal-thumbnail wait. No native capture or preview removal is in scope.

### 10. Failure/discovery identities remain

Retain unless production call-site search proves dead:

- `next_session_generation`;
- `discovery_generation`;
- persistence failure UUID challenges;
- thumbnail ticket UUIDs and `latest_by_intent`.

Remove queue-only identities:

- `next_autosave_serial`;
- cleanup attempt ordering.

A stale late `notify_durable_commit` from an old session must still be rejected before mutating pending/ticket state or superseding a replacement session's live ticket.

### 11. Exit keeps behavior, not lock choreography

Player contract remains:

- ordinary close/quit enters Saving;
- successful flush exits;
- failed flush produces one typed actionable failure;
- Retry/Cancel/Exit Without Saving require the current failure token;
- duplicate close/quit does not start duplicate flushes.

Exit waits for `operation_gate` only when persistence work is ready. A tiny exit-specific synchronous state guard may remain if needed, but it is not a second disk-serialization boundary.

## Reuse survey

| Need | Decision |
| --- | --- |
| Atomic slot writes | Reuse `prepare_slot_write`, `commit_prepared_slot_write`, `discard_prepared_slot_write`, `delete_slot`. |
| Filesystem seam | Keep `SaveFilesystem`. |
| Staged-write tests | Extract/reuse `TrackingFilesystem` delegating to `ProductionSaveFilesystem` and wrapping `StagedAtomicWrite`; reuse the existing pause-after-prepare technique. |
| Detached load safety | Reuse `build_restore_candidate` and `SessionTransitionIdentity`. |
| Autosave target selection | Reuse `select_autosave_target`. |
| Thumbnail validation/storage | Reuse current types/IPC unchanged. |
| Persistence status | Reuse health/activity/exit views/events. |
| Acquisition acknowledgement | Keep HPA-549 ordinary no-thumbnail autosave. |
| Disk serialization | One `tokio::sync::Mutex<()>`. |
| Background scheduling | Direct Tauri async runtime spawn; no scheduler abstraction. |
| Exit boundary | Keep `ApplicationExit` because production `app.exit` and tests are meaningful separate implementations. |

## Test migration is an inventory

The queue is implementation; these existing tests encode retained product rules and require explicit migration/disposition:

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

Each old test either keeps its name under `application/tests/`, or the PR closeout records the exact replacement test name or an explicit reason the **product rule** disappeared.

### Waiting-delete successor

Preserve the player-visible successor of:

```text
replacement_invalidating_queued_delete_returns_stale_session_generation
```

as an application-level test such as:

```text
replacement_before_waiting_delete_returns_stale_session_generation_and_preserves_slot
```

Required behavior: stale delete returns `staleSessionGeneration`, slot still exists, replacement health remains Healthy.

No test observes queued futures or delete-enqueued notification.

### Delete outright

Delete tests whose only subject is:

- WriterQueue order/worker startup;
- scheduler rejection/fallback thread;
- W/G/S lock labels;
- queue invalidation mechanics;
- cleanup receipt-vs-attempt ordering.

### Staged-write helper rule

Do not create a new persistence backend fake. Extract only the useful filesystem helper:

- delegate to `ProductionSaveFilesystem`;
- wrap `StagedAtomicWrite` to count install/discard;
- add pause/release at staged-write boundary or immediately after prepare;
- optionally track active mutation count for one-gate serialization.

## Line-count policy

Line counts are diagnostic evidence, not permission to delete product tests.

Record separately:

- production application modules;
- remaining production/setup prefix of `src-tauri/src/lib.rs`;
- persistence test code.

Expected result: **material production-code deletion** because queue/backend/scheduler/lock-graph machinery disappears.

Test code may shrink less or grow slightly if equivalent behavior coverage needs it. A large production increase or replacement abstraction is a stop signal.

## Verification contract

Mandatory:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run check
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
```

Keep the existing packaged save/Continue smoke only when current PR policy selects it. Do not add a new packaged E2E suite.

## Single-PR boundary

HPA-521 remains one implementation PR with reviewable internal commits. Do not merge an intermediate architecture as the final result while both permanent serialization products survive.

In scope:

- one `ApplicationPersistence` owner;
- one operation gate;
- identity-bound capture + pre-commit revalidation;
- queue/backend/scheduler/fallback-runtime deletion;
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
- [ ] Autosave checkpoint capture is bound to the pending generation/revision.
- [ ] Every staged save revalidates the same identity immediately before commit and discards stale staging.
- [ ] Load/Continue may wait for in-flight disk work; no second replacement gate survives.
- [ ] Waiting stale delete after replacement cannot remove the slot.
- [ ] `SaveCoordinator`, queue/classes, custom scheduler/fallback runtime, and `AutosaveBackend`/`CoordinatorFuture` are gone.
- [ ] HPA-550 dynamic thumbnail behavior is unchanged.
- [ ] HPA-549 acknowledgement remains ordinary no-thumbnail autosave.
- [ ] Failure/discovery identities that protect stale player actions remain.
- [ ] Every named debounce/retry/generation/health test has an explicit migration disposition.
- [ ] Tests reuse the real staged-write filesystem seam rather than a replacement backend abstraction.
- [ ] `lib.rs` is setup/transport/gameplay routing rather than persistence implementation.
- [ ] Production persistence code is materially smaller; test counts are recorded separately without deleting product coverage to satisfy a metric.
- [ ] Default and `--all-features` Rust suites plus repository checks pass.
