# HPA-521 Single-Owner Save Persistence Simplification Design

## Status

Planning specification for HPA-521 against `main` at `0521a122636847a43fada24478dd9b74f1df84d0`.

This is a pre-release simplification. The goal is deletion of coordination machinery while preserving the player-visible save/load/exit contract and the already-settled HPA-549/HPA-550 product decisions.

Prerequisites are settled:

- HPA-549: acquisition acknowledgement is an ordinary gameplay mutation with ordinary no-thumbnail autosave.
- HPA-550: retain the current dynamic save-thumbnail product, including tickets, deadlines, activity, and IPC.
- HPA-521 remains one implementation ticket and one implementation PR; internal work is separated into reviewable commits rather than separate PRs.

## Reuse survey

This refactor should mostly **move, widen, or delete existing code**, not create parallel interfaces.

| Need | Decision |
| --- | --- |
| Persistence serialization gate | **EXTEND/RENAME** the existing `replacement_gate: Arc<tokio::sync::Mutex<()>>`; widen it into `operation_gate`. Do not allocate a second permanent gate. |
| Application owner | **REUSE/MOVE** the existing `ApplicationPersistence`. |
| Session install/clear | **REUSE/MOVE** the existing `install_session`, `install_session_if_current`, `clear_session`, and `clear_session_if_current`; preserve their error semantics. |
| E2E session replacement | **REUSE/REWRITE MECHANISM** `replace_session_for_e2e`; keep its checkpoint/product contract while replacing queue invalidation with the one gate. |
| Autosave scheduling | **REUSE/MOVE** the existing `schedule_autosave` behavior; delete the scheduler abstraction around it. |
| Manual save/delete storage boundary | **EXTEND** `ApplicationPersistence::run_storage_write_if_session_current` / `commit_current`; do not invent a repository layer. |
| Session-generation validation | **EXTRACT** the existing inline generation checks into a small helper only if it reduces duplication. |
| Pending autosave identity | **EXTEND** existing `pending_matches` from queue serial to `(generation, revision, ticket)`. |
| Staged-write tests | **REUSE** `TrackingFilesystem`, `ProductionSaveFilesystem`, and `StagedAtomicWrite`; do not recreate an `AutosaveBackend` test abstraction. |
| Exit side effect | **KEEP** `ApplicationExit`; production `app.exit` and test exits are genuinely different implementations. |
| Application module split | **NEW ORGANIZATION ONLY** under one `ApplicationPersistence`; no new service ownership. |

Deletion targets remain the existing queue/backend/scheduler machinery: `WriterQueue`, `WriterJobClass`, `QueuedWriterJob`, `AutosaveBackend`, `CoordinatorFuture`, `CoordinatorTaskScheduler`, portable/fallback runtime state, cleanup-owner ordering, and `next_autosave_serial`.

## Review resolution

The latest review was checked against current code rather than adopted mechanically.

| Finding | Verdict | Resolution |
| --- | --- | --- |
| F1: the hand-written migration ledger covers only a small subset of tests | **Valid** | Replace the subset-only process with a mechanical baseline inventory of **every test under `game/save/coordinator/`, including inline tests in `mod.rs`**. Every baseline path/name gets a closeout disposition. The 13 previously named autosave tests remain mandatory retained anchors. |
| F2: Task 4 would drift session-transition errors and omitted `clear_session` | **Valid, broader than reported** | Move-don't-rewrite **all four** existing transition APIs: `install_session`, `install_session_if_current`, `clear_session`, `clear_session_if_current`. Swap gate ownership only. `install_session_if_current` keeps `staleSaveSelection`; `clear_session_if_current` keeps `stalePersistenceFailureToken`. |
| F3: `replace_session_for_e2e` depends on every deleted mechanism | **Valid** | Rewrite it explicitly under `operation_gate`; remove queue invalidation, queue-only counters, and `classify_dropped_writer`. E2E checkpoint install is allowed to wait for in-flight persistence. The frontend normal game-state application path remains unchanged. |
| F4: stale-discard classification was unspecified | **Valid** | A successfully discarded stale/superseded autosave is a benign completion: never set `failed_write`, publish Degraded, or create a failure challenge. A failure to discard staged storage is a real storage error and may degrade persistence. |
| F5: Task 1 would be easier to review as a separate PR | **Concern valid; split rejected** | Keep the one-PR delivery boundary. Task 1 is a strictly move-only first commit with both Rust feature surfaces green and an explicit review checkpoint before behavior changes begin. This preserves reviewability without splitting one ticket across PRs. |
| F6: retained `exit_transition` needs a stated hierarchy | **Valid with narrowing** | Exit-only state transitions do not acquire `operation_gate`. If a path needs both (notably E2E replacement), acquire `operation_gate -> exit_transition -> session -> persistence state`. Never acquire/await `operation_gate` while holding `exit_transition`. Preserve one behavior-level concurrency test instead of a general lock-order suite. |

The architecture remains Option A: one application owner and one async persistence-operation gate.

## Final ownership

```text
AppState
  -> session: Arc<Mutex<AppSession>>
  -> persistence: Arc<ApplicationPersistence>
  -> resources_dir

ApplicationPersistence
  -> state: Mutex<PersistenceState>
  -> operation_gate: Arc<tokio::sync::Mutex<()>>   # widened existing replacement_gate
  -> session: Arc<Mutex<AppSession>>
  -> fs / root / discovery / saved-at clock
  -> autosave / flush / manual save / delete / cleanup
  -> session install / clear / E2E replacement
  -> retained thumbnail ticket/activity state
  -> health / failure / exit state
```

All disk-mutating persistence work and final session replacement serialize through `operation_gate`.

There is no second writer queue, actor, mailbox, channel, repository service, task scheduler, or replacement persistence backend.

## Module boundary

One owner does not mean one giant file.

```text
apps/game/src-tauri/src/game/save/
├── application/
│   ├── mod.rs          # ApplicationPersistence + PersistenceState
│   ├── autosave.rs     # debounce readiness, exact capture, flush, commit, cleanup
│   ├── tickets.rs      # HPA-550 ticket/activity lifecycle
│   ├── session.rs      # AppSession/SessionPersistence + install/clear/E2E replacement
│   ├── exit.rs         # Saving/Failed/Retry/Cancel/Without Saving
│   ├── commands.rs     # persistence command cores
│   └── tests/
├── capture.rs
├── e2e_faults.rs
├── mod.rs
├── restore.rs
├── schema.rs
├── storage.rs
└── thumbnail.rs
```

Private modules do not own separate gates or state objects and do not communicate through traits. Fold trivial modules together rather than preserving ceremony.

## Core ordering rules

### 1. Widen the existing gate; do not create a second mutex product

`replacement_gate` already represents final-session replacement authority. HPA-521 widens that exact shared `Arc<tokio::sync::Mutex<()>>` into `operation_gate` and routes storage mutation through it.

During implementation the queue may exist transiently while call sites are migrated, but the completed Task 2 commit must not leave both `WriterQueue` and direct gate serialization as two permanent products.

### 2. Autosave readiness happens outside the gate

Pending autosave identity is:

```text
(session_generation, durable_revision, thumbnail_ticket)
```

`next_autosave_serial` is deleted. Retry is still distinguishable because retry issues a fresh retained thumbnail ticket.

Required flow:

```text
notify durable commit
  -> replace pending identity
  -> debounce sleep                              [NO operation_gate]
  -> pending identity check
  -> terminal-thumbnail/deadline wait            [NO operation_gate]
  -> pending identity check
  -> acquire operation_gate
  -> pending identity check again
  -> exact generation/revision checkpoint capture
  -> prepare staged write
  -> same generation/revision revalidation
  -> commit or discard stale staging
```

Do not hold the gate during the 500 ms debounce or the existing thumbnail timeout.

### 3. Capture is bound to the requested identity

For pending `(G, R)`, checkpoint capture is legal only while live session generation is `G` and live durable revision is `R`.

Do not capture a newer live checkpoint and label it as receipt `R`.

After staging, revalidate the same `(G, R)` immediately before `commit_prepared_slot_write`. Ordinary gameplay may advance revision while staging runs, so the second fence remains required even though persistence operations share one gate.

### 4. Stale/superseded autosave is benign when discard succeeds

There are three benign stale exits:

1. pending identity no longer matches before gate acquisition;
2. pending identity no longer matches after gate acquisition;
3. live generation/revision changed before commit and staged storage is successfully discarded.

These cases must **not**:

- populate `failed_write`;
- publish `PersistenceHealthView::Degraded` merely because the work was stale;
- create a persistence failure challenge;
- suppress a newer pending autosave.

They should preserve the behavior of the current `record_stale_write`: clear pending only if the stale attempt is still the current pending identity, then derive health from remaining work/failures. If a newer pending autosave exists, health remains Pending.

A failure from `discard_prepared_slot_write` is different: that is an actual storage failure and may enter the normal background-failure path.

Required regression:

```text
superseded_autosave_discard_leaves_health_pending_not_failed
```

### 5. Manual save/delete/flush share the gate and revalidate after waiting

Manual save and delete no longer reserve queue turns or await result oneshots. They await the widened gate and execute the current storage logic directly.

Any identity captured before gate acquisition must be checked again after acquisition and before mutation.

For delete:

- replacement wins first -> waiting delete returns `staleSessionGeneration`, slot remains;
- delete wins first -> delete may finish before replacement installs.

Blocking flush waits for the gate, then observes whether the requested revision is already covered or writes that exact revision.

### 6. Existing session-transition APIs move without semantic rewriting

The following methods already exist and are not redesigned:

```text
install_session
install_session_if_current
clear_session
clear_session_if_current
```

Move them to the application owner and replace only the gate reference.

Pinned error semantics:

```text
install_session_if_current identity mismatch -> staleSaveSelection
clear_session_if_current identity mismatch   -> stalePersistenceFailureToken
```

The unqualified install/clear methods retain their existing persistence-availability and generation behavior.

Do not copy a newly written install body into clear behavior.

### 7. E2E checkpoint replacement follows the one-gate model

`replace_session_for_e2e` remains because packaged E2E checkpoint IPC is an intentional test-only contract.

Final behavior:

1. validate session/persistence and current exit status as today;
2. await `operation_gate`;
3. if `exit_transition` survives, acquire it next;
4. acquire session, then persistence state;
5. advance session/discovery generation and clear pending ticket/failure/health state according to the existing replacement contract;
6. install the E2E engine and publish Healthy/Idle views;
7. reset retained E2E fault flags.

Delete queue-era replacement work:

```text
writer_queue.invalidate_queued_for_e2e
next_autosave_serial bump
minimum_cleanup_attempt handoff
fail_next_schedule reset
classify_dropped_writer
```

**Product decision:** E2E checkpoint replacement may wait behind an in-flight persistence mutation. It no longer clears queued work to bypass it. Thumbnail waiting does not extend this wait because thumbnail readiness is outside the gate.

Do not increase E2E timeouts speculatively. Run the existing packaged/canonical persistence path under current timeout policy; change timeout guidance only with observed evidence.

The checkpoint must still travel through the frontend's normal game-state application path.

### 8. Cleanup is current diagnostic state, not ordered work identity

Delete cleanup-owner/attempt ordering and run cleanup under the same operation gate.

Keep only the current cleanup diagnostic and best-effort retry after a later successful persistence operation.

### 9. Background scheduling is concrete

Delete the custom scheduler, portable runtime, fallback thread, and scheduler-failure test surface.

Production debounce/ticket-expiry/exit continuation code uses direct `tauri::async_runtime::spawn`.

Deterministic tests do not assume Tauri's singleton runtime shares a paused Tokio test clock. Test inner async readiness/execution directly and keep at most one bounded real-time spawn smoke.

### 10. Exit guard hierarchy if `exit_transition` remains

Preferred simplification is to remove `exit_transition` if application state can be transitioned safely without it. If it remains, it is **exit-state protection only**, not a second persistence serialization boundary.

Rules:

```text
exit-only arm / rollback / token transition:
    exit_transition -> session -> persistence state
    (never acquire operation_gate)

path that genuinely needs both (for example E2E replacement):
    operation_gate -> exit_transition -> session -> persistence state

forbidden:
    exit_transition -> await/acquire operation_gate
```

No callbacks, external `ApplicationExit::exit`, long filesystem work, or async wait occur while holding `exit_transition`.

Required behavior-level test if the guard remains:

```text
exit_request_arms_while_operation_gate_is_busy_and_flush_waits_afterward
```

The test holds `operation_gate`, proves an exit request can still transition to Saving without waiting on the gate, then releases the gate and proves the flush/exit completes. This protects the no-reverse-acquisition rule without restoring a general G/S/W lock-order suite.

## Dynamic thumbnails and acquisition acknowledgement remain unchanged

HPA-550 retains:

- autosave/manual-save thumbnail purposes;
- UUID tickets;
- original deadlines;
- intent supersession;
- prepare/submit/failure/read IPC;
- `ThumbnailActivityView`;
- PNG validation/size limits;
- non-blocking unavailable-thumbnail behavior;
- stored descriptors/read behavior.

HPA-549 retains acquisition acknowledgement as an ordinary no-thumbnail autosave and it must not issue a capture request/activity.

## Failure/discovery identities retained

Retain identities tied to stale player actions unless production search proves them dead:

- session generation;
- discovery generation;
- durable revision;
- persistence failure UUID challenge/token;
- thumbnail ticket UUID and latest-by-intent state.

Do not broaden HPA-521 into a failure-token redesign.

## Complete test-migration inventory

The previous 13-name ledger was insufficient because deleting `coordinator/` removes many product tests outside `debounce.rs` and inline tests in `coordinator/mod.rs`.

### Baseline inventory rule

Before moving code, generate a recursive path+test-name inventory from the pinned base across **all Rust files under**:

```text
apps/game/src-tauri/src/game/save/coordinator/
```

including `coordinator/mod.rs` itself.

Use a local one-shot script such as:

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
```

Paste the resulting baseline inventory/count into the PR as persistent review evidence. The reviewer's quoted `197` tests in `coordinator/tests/` is a useful warning, but the implementation must use the generated pinned-base total because inline coordinator tests also disappear.

### Closeout disposition rule

Every baseline `(path, test_name)` row receives exactly one disposition:

```text
KEPT      -> destination path::test_name
RENAMED   -> destination path::new_behavior_name
DELETED PRODUCT RULE -> one sentence explaining why the externally observable rule itself no longer exists
MECHANISM DELETED     -> one sentence naming the deleted implementation concept that was the sole subject
```

The 13 previously named HPA-549/HPA-550/retry/generation/health tests are mandatory retained anchors. Because their product rules remain in scope, they must resolve to `KEPT` or `RENAMED`, not deletion.

Likewise retain product coverage from `unit.rs`, `exit_lifecycle.rs`, `flush.rs`, `ticket.rs`, `failure_token.rs`, `storage_integration.rs`, `e2e_replacement.rs`, and useful `lock_order.rs` behaviors. Only tests whose sole subject is deleted queue/scheduler/lock/cleanup-owner machinery disappear.

Passing `--all-features` is necessary but does not replace this disposition ledger.

## Staged-write test seam

Extract only the useful test behavior from the existing storage integration harness:

- delegate to `ProductionSaveFilesystem`;
- wrap `StagedAtomicWrite` to observe install/discard;
- pause/release around staging or immediately after prepare;
- optionally count concurrent mutations.

Do not port the old `AutosaveBackend`, writer/gate phase labels, or W/G/S test model.

## Line-count policy

Measure production and tests separately.

Expected outcome:

- material production deletion from queue/backend/scheduler/lock-graph removal;
- no replacement framework;
- test code may remain similar in size when product behavior is preserved.

Line count is a smell check, not permission to delete retained tests.

## Delivery boundary

HPA-521 remains one implementation PR.

Task 1 is a move-only first commit/review checkpoint. Tasks 2–6 perform behavior-preserving simplification on top of it. Do not merge an intermediate final state containing both permanent queue and gate serialization products.

The separate-PR suggestion is intentionally not adopted; reviewability is provided by commit isolation without splitting the ticket.

## Verification contract

Mandatory Rust surfaces:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Repository checks:

```bash
bun run check
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
```

Run existing packaged E2E save/Continue/checkpoint coverage when current PR selection policy requires it; do not add a new E2E framework in HPA-521.

## Acceptance criteria

- [ ] Existing `replacement_gate` is widened/renamed into the single `operation_gate`; no second persistence gate survives.
- [ ] `ApplicationPersistence` is the only persistence owner held by `AppState`.
- [ ] `WriterQueue`, writer job classes, backend/future abstraction, custom scheduler/fallback runtime, queue probes, and cleanup-owner ordering are removed rather than renamed.
- [ ] Debounce and terminal-thumbnail waits occur outside `operation_gate`.
- [ ] Autosave captures only the exact requested generation/revision and revalidates it immediately before commit.
- [ ] Successfully discarded stale/superseded autosave work is benign and never creates a persistence failure; discard failure remains a real error.
- [ ] `install_session`, `install_session_if_current`, `clear_session`, and `clear_session_if_current` are moved rather than semantically rewritten.
- [ ] `install_session_if_current` still returns `staleSaveSelection` on identity mismatch.
- [ ] `clear_session_if_current` still returns `stalePersistenceFailureToken` on identity mismatch.
- [ ] E2E `replace_session_for_e2e` is explicitly migrated to the one gate and may wait for in-flight persistence.
- [ ] `classify_dropped_writer` is removed with the queue-invalidation drop path.
- [ ] Waiting stale delete after replacement returns `staleSessionGeneration` and leaves its slot intact.
- [ ] HPA-549 no-thumbnail acknowledgement and HPA-550 dynamic-thumbnail behavior remain unchanged.
- [ ] If `exit_transition` remains, no path holds it while waiting for `operation_gate`; dual-lock paths use gate -> exit-transition order and one behavior regression protects this.
- [ ] A complete recursive baseline test inventory exists and every deleted coordinator test has a closeout disposition.
- [ ] All 13 named autosave anchors resolve to retained/replaced tests.
- [ ] Tests reuse the real `SaveFilesystem`/`StagedAtomicWrite` seam rather than a replacement backend trait.
- [ ] `lib.rs` becomes setup/transport/gameplay routing rather than persistence implementation.
- [ ] Production persistence code shows material net deletion; test count is reported separately.
- [ ] Default and `--all-features` Rust suites plus repository validation pass.
- [ ] HPA-521 lands as one implementation PR with Task 1 isolated as a move-only commit.
