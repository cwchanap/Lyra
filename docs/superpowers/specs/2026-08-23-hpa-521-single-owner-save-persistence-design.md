# HPA-521 Single-Owner Save Persistence Simplification Design

## Status

Planning specification for HPA-521 against `main` at `0521a122636847a43fada24478dd9b74f1df84d0`.

This is a pre-release architecture simplification. It deliberately optimizes for development speed and maintainability rather than preserving the internal persistence architecture shipped by HPA-392. There is no released save-format compatibility requirement beyond the current-format behavior explicitly retained below.

The prerequisite product decisions are now settled:

- HPA-549 is complete: acquisition acknowledgement is an ordinary gameplay mutation plus ordinary autosave. There is no second acknowledgement persistence transaction to preserve.
- HPA-550 is complete with the product-owner decision **retain current dynamic save thumbnails**. HPA-521 must therefore keep the existing thumbnail ticket/capture behavior; removing or replacing it would reopen a closed product decision.
- HPA-265 is complete and HPA-266 was marked duplicate of HPA-265, so the Chapter 1 acceptance dependency has an effective completed successor.

HPA-521 is the next persistence task before HPA-536 production hardening and before HPA-560 considers simplifying E2E orchestration.

## Current-state survey

The current architecture still contains the complexity HPA-521 was created to remove:

- `apps/game/src-tauri/src/game/save/coordinator/mod.rs` is about 150 KB and owns a custom writer queue, scheduling abstraction, retry ordering, session generations, thumbnail tickets, persistence health, exit lifecycle, stale-write handling, cleanup ordering, and failure challenges.
- `apps/game/src-tauri/src/lib.rs` is about 205 KB despite its header saying it only registers Tauri commands. It contains `ApplicationPersistence`, save storage orchestration, manual save/delete/load/continue/return-to-title flows, persistence events, and persistence-specific command cores.
- The coordinator test directory contains large mechanism-focused suites: `debounce.rs` (~65 KB), `exit_lifecycle.rs` (~38 KB), `storage_integration.rs` (~32 KB), `unit.rs` (~55 KB), plus dedicated `writer.rs` and `lock_order.rs` tests.

The current writer architecture is:

```text
gameplay mutation
  -> debounce task
  -> WriterQueue / WriterJobClass
  -> backend trait capture/register/prepare
  -> replacement_gate
  -> session-generation/revision revalidation
  -> commit

manual save / delete / blocking flush / orphan cleanup
  -> WriterQueue
  -> oneshot result channel
  -> backend/storage operation
```

`WriterQueue` is not providing parallel throughput; it exists to serialize work in a single-process, single-window game. That makes it an expensive representation of a mutex.

## Decision summary

Replace the persistence scheduler graph with **one concrete application persistence owner and one async operation gate**.

The chosen architecture is:

```text
AppState
  -> session: Arc<Mutex<AppSession>>
  -> persistence: Arc<ApplicationPersistence>

ApplicationPersistence
  -> state: Mutex<PersistenceState>
  -> operation_gate: tokio::sync::Mutex<()>
  -> session: Arc<Mutex<AppSession>>
  -> fs / root / discovery / saved-at clock
  -> thumbnail tickets + health + exit/failure state
```

All disk-mutating persistence operations serialize through `operation_gate`:

- debounced autosave;
- blocking flush;
- manual save;
- save deletion;
- orphan cleanup;
- session installation/clearing at the final replacement boundary;
- exit flush.

There is no writer-job queue, writer class hierarchy, background writer worker, replacement gate, or queue-specific ordering policy after this refactor.

`ApplicationPersistence` is the one owner. The existing `SaveCoordinator` type is removed rather than retained as a second persistence state machine with a new name.

## Why direct serialization is the right mechanism

### Option A — one async mutex, direct operations — selected

Advantages:

- expresses the actual requirement directly: only one persistence mutation may own disk/session-replacement authority at a time;
- deletes `WriterQueue`, `WriterJobClass`, `QueuedWriterJob`, queue worker startup, queue invalidation, writer probes, and oneshot handoff plumbing;
- turns flush/manual/delete into normal async calls that await the operation they requested;
- makes stale-write protection explicit at the storage boundary instead of emergent from queue ordering;
- keeps gameplay responsive because the long disk operation holds only `operation_gate`, not the gameplay session mutex;
- is easy to reason about for a hobby project and easy to extend when Chapter 2 adds ordinary content rather than new persistence products.

### Option B — shrink the existing queue — rejected

A smaller queue could keep one worker and fewer job classes, but the remaining object would still need enqueueing, worker startup, cancellation/supersession rules, result delivery, and queue-specific tests. It solves a problem the application does not have: prioritizing multiple independent persistence producers.

### Option C — channel-owned actor/task — rejected

A dedicated persistence actor would centralize ownership but adds a mailbox protocol, task lifetime, request/response channels, shutdown semantics, and another class of tests. There is no evidence that Lyra needs an actor for one local save directory and one window.

## Core behavior after the refactor

### 1. Autosave debounce stays, the writer queue does not

Autosave remains trailing-edge debounced. A pending autosave is identified by the current session generation, durable revision, and thumbnail ticket identity.

```text
notify durable commit
  -> replace pending autosave
  -> spawn debounce timer
  -> timer wakes
  -> if it is no longer the pending identity: return
  -> acquire operation_gate
  -> re-check pending identity
  -> capture current checkpoint
  -> prepare write
  -> re-check generation + durable revision
  -> commit or discard stale prepared write
```

A later durable revision supersedes an earlier pending autosave before either acquires the operation gate. This preserves debounce coalescing without `VecDeque` or `WriterJobClass::Debounced`.

`next_autosave_serial` is deleted. The already-unique pending ticket/identity is sufficient to reject stale timer tasks.

### 2. One gate owns every disk mutation

Manual save, delete, flush, autosave, and cleanup call the concrete `ApplicationPersistence` operation directly after acquiring `operation_gate`.

There are no `reserve_manual_writer`, `reserve_delete_writer`, result oneshots, or generic `CoordinatorFuture` wrappers.

This is serialization, not a global gameplay lock. The session mutex is held only long enough to:

- capture a checkpoint or read a generation/revision;
- validate the current session immediately before commit;
- install or clear a session after a detached restore succeeds.

Disk staging and filesystem work do not hold the gameplay session mutex.

### 3. Session replacement uses the same gate

`replacement_gate` is removed.

Load/Continue continue to build `RestoredGameCandidate` detached from the live session. Only the final install step acquires `operation_gate`, re-checks the expected `SessionTransitionIdentity`, increments the session generation, and swaps the engine.

A failed restore therefore still leaves the current session untouched.

A save write already holding `operation_gate` completes or becomes stale before replacement can install. A replacement already holding the gate installs before a waiting writer is allowed to revalidate. This is the whole ordering rule; no separate lock graph is needed.

### 4. Stale writes are rejected by identity, not queue position

The durable safety invariant remains:

> A prepared write may commit only when its session generation and durable revision still match the live session identity expected by that operation.

The operation gate prevents two storage mutations from committing concurrently, while the generation/revision check prevents an old captured state from becoming current merely because it reached the gate later.

The refactor must keep a behavior test that pauses a real staged write, changes the current session identity, resumes the write, and proves the staged data is discarded rather than installed.

### 5. Flush becomes a direct barrier

A blocking flush does not enqueue a special job.

It:

1. reads the live session identity and required revision;
2. cancels a pending autosave covered by that revision, retaining a terminal thumbnail result when it matches exactly;
3. acquires `operation_gate`;
4. checks whether a successful write already covers the revision;
5. writes the exact required revision if needed;
6. validates the session is still the expected generation/revision;
7. records the committed receipt in `SessionPersistence`.

If an autosave is already in the operation gate, flush simply waits for the same gate and then observes whether that write covered the requested revision.

### 6. Cleanup is best-effort state, not an ordered job class

`CleanupOwner`, `next_cleanup_attempt`, `minimum_cleanup_attempt`, and `WriterJobClass::OrphanCleanup` are removed.

Orphan cleanup runs under the same operation gate:

- once during application persistence initialization/startup;
- after a write reports cleanup work or on the next successful persistence operation when a prior cleanup failed.

Only the current cleanup diagnostic matters to the UI. We do not need receipt-vs-attempt ordering for orphan files in a single local save directory.

### 7. Background task spawning becomes concrete

Delete:

- `CoordinatorTask`;
- `CoordinatorTaskScheduler`;
- `PortableCoordinatorTaskScheduler`;
- the fallback current-thread Tokio runtime and `lyra-save-coordinator` thread;
- scheduler-rejection tests whose only subject is that abstraction.

Application-level debounce, thumbnail-expiry, and exit tasks are spawned with the existing Tauri async runtime directly. They remain small timer/continuation tasks; they do not own persistence serialization.

This intentionally makes the Tauri boundary concrete rather than preserving a one-production-implementation scheduler interface.

### 8. Dynamic thumbnail behavior is retained exactly

HPA-550 closed the removal question. HPA-521 therefore retains:

- autosave/manual-save thumbnail purposes;
- capture tickets;
- ticket deadlines;
- intent supersession;
- submit/failure IPC;
- `ThumbnailActivityView`;
- PNG validation/size limits;
- non-blocking thumbnail failure semantics;
- stored thumbnail descriptors and read behavior.

Thumbnail ticket state lives inside `ApplicationPersistence::state`, but it is not serialized through `operation_gate` until a save operation consumes a terminal result.

Do not add native capture, remove dynamic previews, or change frontend capture behavior in this PR.

### 9. Failure-token and discovery identity stay unless proven dead during implementation

The following are retained deliberately in this refactor:

- `next_session_generation`: protects stale session replacement and stale background work;
- `discovery_generation`: protects actions against a save-browser snapshot that has already been rediscovered;
- persistence failure UUID challenges: protect Retry/Cancel/Without Saving actions from stale UI commands;
- thumbnail ticket UUIDs and `latest_by_intent`: required by the retained dynamic thumbnail protocol.

These identities are tied to player-visible stale-action protection, not writer-queue implementation. HPA-521 must not broaden into a separate modal/failure-token product redesign unless implementation proves one of these fields has no production consumer after the queue collapse.

The counters removed by design are queue-only identities: autosave serials and cleanup-attempt ordering.

### 10. Exit keeps behavior, not the old lock graph

The player contract remains:

- ordinary close/quit requests enter Saving;
- a successful flush exits;
- a failed flush produces one typed actionable failure;
- Retry, Cancel, and Exit Without Saving require the current failure token;
- duplicate close/quit requests do not start duplicate exit flushes.

Exit state stays inside `PersistenceState`. No separate writer priority is required because exit flush waits on the same operation gate.

The implementation should remove `exit_transition` if the state/session transition can be expressed with the owner state mutex plus the single operation gate. If a tiny synchronous guard remains necessary to make the Idle -> Saving transition atomic with the session exit flag, it must remain exit-specific and must not become a second disk-serialization boundary. There should be no general lock-order test suite after this refactor.

## Application module and `lib.rs` boundary

Create `apps/game/src-tauri/src/game/save/application.rs` and move application persistence ownership/orchestration there.

The module owns:

- `AppSession` / `SessionPersistence` persistence-facing session metadata;
- `ApplicationPersistence` and `PersistenceState`;
- concrete storage/discovery context;
- autosave scheduling and flush;
- thumbnail ticket lifecycle;
- save browser discovery;
- manual save/delete;
- detached restore + final session install helpers;
- return-to-title persistence behavior;
- persistence health and exit lifecycle;
- persistence-specific result views that are not generic gameplay views.

`src-tauri/src/lib.rs` should be left primarily with:

- Tauri setup;
- `AppState` wiring;
- event binding;
- thin `#[tauri::command]` wrappers;
- gameplay mutation routing that is not persistence implementation;
- command registration.

Do not introduce a service container, repository layer, generic command bus, DI framework, or trait-per-operation structure.

## Reuse survey

| Need | Decision |
| --- | --- |
| Atomic slot writes | Reuse `save/storage.rs` `prepare_slot_write`, `commit_prepared_slot_write`, and `delete_slot`. |
| Filesystem test seam | Keep `SaveFilesystem`; it has production, E2E-faulting, and test implementations and protects real disk behavior. |
| Detached load safety | Reuse `build_restore_candidate` and current `SessionTransitionIdentity` semantics. |
| Autosave target selection | Reuse `select_autosave_target`. |
| Thumbnail validation/storage | Reuse current thumbnail and schema types unchanged. |
| Persistence status events | Reuse existing health/activity/exit views and Tauri events. |
| Acquisition acknowledgement | Reuse HPA-549 ordinary no-thumbnail autosave path; do not reintroduce dedicated acknowledgement persistence. |
| Writer serialization | Replace with one `tokio::sync::Mutex<()>`; do not extend `WriterQueue`. |
| Background scheduling | Use concrete Tauri async runtime spawning; no custom scheduler abstraction. |
| Application persistence | Move/extend the existing `ApplicationPersistence` implementation from `lib.rs`; do not create a parallel service. |

## Test strategy

Tests should prove behavior, not the deleted machinery.

### Delete outright

- `coordinator/tests/writer.rs`: its production subject is the writer queue itself.
- `coordinator/tests/lock_order.rs` as a lock-order suite.
- scheduler rejection/fallback-thread tests whose only purpose is `CoordinatorTaskScheduler`/`PortableCoordinatorTaskScheduler`.
- queue invalidation probes and delete-enqueued notifications that exist only to observe queue internals.
- cleanup-owner ordering tests that only compare `Receipt` vs `Attempt` ownership.

### Re-home the behavior worth keeping

Preserve or rewrite tests for:

- trailing-edge autosave coalesces multiple durable revisions to the newest revision;
- manual save/delete/autosave never mutate storage concurrently;
- a blocked disk operation does not hold the gameplay session mutex;
- a stale prepared autosave cannot install after session identity changes;
- flush waits for an in-flight persistence operation and either observes its receipt or writes the required revision itself;
- failed load/Continue leaves the old session installed;
- session generations remain monotonic and only auto slots become autosave targets;
- exit flush succeeds/fails/retries without duplicate work;
- dynamic thumbnail ticket expiry/supersession/submission still behaves exactly as HPA-550 retained;
- real storage atomic replacement and corrupt-save handling still pass.

Use the existing `SaveFilesystem` fake/fault seams for serialization and stale-write tests instead of adding a new persistence backend trait just for tests.

## File-level plan

### Create

- `apps/game/src-tauri/src/game/save/application.rs` — the single concrete application persistence owner and orchestration surface.

### Modify

- `apps/game/src-tauri/src/game/save/mod.rs` — export `application`; remove `coordinator` after migration.
- `apps/game/src-tauri/src/lib.rs` — remove persistence implementation and keep setup/thin Tauri wrappers.
- `apps/game/src-tauri/src/game/save/storage.rs` — only if a small test hook/helper is needed to express behavior at the existing filesystem seam; do not redesign storage.
- existing Rust persistence tests — move assertions from queue/lock identity to behavior.

### Delete after migration

- `apps/game/src-tauri/src/game/save/coordinator/mod.rs`.
- `apps/game/src-tauri/src/game/save/coordinator/tests/writer.rs`.
- `apps/game/src-tauri/src/game/save/coordinator/tests/lock_order.rs`.
- remaining coordinator test files only after equivalent player-visible/storage behavior is re-homed under application persistence tests.

No frontend production file, save schema, story content, or IPC payload change is planned.

## Single-PR boundary

HPA-521 is one implementation PR.

The PR may use multiple reviewable commits/tasks internally, but it must end with one coherent architecture. Do not merge an intermediate state that has both `WriterQueue` and the new operation gate as two permanent serialization products.

In scope:

- single owner + single operation gate;
- writer queue/scheduler/fallback runtime deletion;
- stale-write/flush/replacement behavior preservation;
- app persistence extraction from `lib.rs`;
- behavior-level test migration;
- material net deletion.

Out of scope:

- thumbnail product redesign (HPA-550 is closed as retain current behavior);
- save schema or compatibility framework changes;
- Chapter 2 content/gameplay;
- generic repository/service architecture;
- E2E router simplification (HPA-560);
- full Chapter 1 production hardening (HPA-536);
- new persistence features.

## Acceptance criteria

The implementation is complete when:

1. `ApplicationPersistence` is the only application persistence owner.
2. Every disk-mutating persistence operation and final session replacement serializes through one async operation gate.
3. `WriterQueue`, `WriterJobClass`, queued writer futures, queue worker machinery, and queue-specific probes are gone.
4. `replacement_gate` is gone.
5. `CoordinatorTaskScheduler`, `PortableCoordinatorTaskScheduler`, and the fallback runtime/thread are gone.
6. `AutosaveBackend`/`CoordinatorFuture` are gone unless implementation discovers a second real production backend; tests alone are not justification.
7. Autosave debounce still coalesces to the newest durable revision.
8. Stale prepared writes cannot clobber a newer session/revision.
9. Flush/manual/delete/exit preserve their current player-visible guarantees.
10. HPA-549 acquisition acknowledgement remains ordinary no-thumbnail autosave behavior.
11. HPA-550 dynamic thumbnails retain their current ticket/capture behavior.
12. `lib.rs` is materially smaller and setup/registration oriented.
13. Mechanism-only writer/lock/scheduler tests are removed and surviving guarantees are covered by behavior tests.
14. Production persistence code plus persistence-specific tests have a material net line reduction; record before/after counts in the PR closeout.
15. No actor, channel protocol, new framework, compatibility shim, or generic abstraction replaces the deleted machinery.

## Verification

Minimum implementation verification:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run check
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
```

Run the existing packaged save/Continue smoke when the current PR policy requires it. Do not add a new packaged suite solely to test the operation gate; HPA-560 owns future E2E suite simplification.

Before closing the implementation PR, record line counts for:

```bash
wc -l apps/game/src-tauri/src/game/save/application.rs
wc -l apps/game/src-tauri/src/lib.rs
find apps/game/src-tauri/src/game/save -path '*test*' -name '*.rs' -print0 | xargs -0 wc -l
```

Compare them against the pre-refactor coordinator/lib/test footprint and explain any retained complexity by player-visible behavior.