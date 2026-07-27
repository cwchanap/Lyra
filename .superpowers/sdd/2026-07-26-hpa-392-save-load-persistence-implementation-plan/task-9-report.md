# Task 9 implementation report

## Part A — generation-scoped sessions and blocking flush foundation

### Summary

Implemented the Part A session facade and baseline/idempotent blocking flush
foundation without acknowledgement mutation, failure challenges, or Task 10
IPC/HTTP surface changes.

`AppState` now owns the exact session mutex, Tokio replacement gate,
coordinator, resources directory, and save root from the approved Task 9
contract. Fresh game installation allocates a monotonic generation, initializes
the flush baseline from the installed engine revision, and installs under
`G → S`. Existing gameplay commands continue to return
`Result<GameStateView, GameError>` and now fail fast through the exclusive-intent
availability hook.

Blocking flush waits in the Task 8 serialized writer queue while owning neither
`G` nor `S`, writes through the existing capture/register/prepare/
commit-if-current backend phases, and takes `G → S` only after awaited writer
work to record the exact receipt. Baseline or same-generation written coverage
is a physical no-op. A pending same-revision debounce is cancelled before it
can enter the writer; an already-entered covering writer is coalesced.

### Files

- `apps/game/src-tauri/src/game/save/coordinator.rs`
  - `AppSession`, `SessionPersistence`, `FlushOperation`, `FlushOutcome`, and
    the exclusive-intent availability hook;
  - monotonic session generation allocation;
  - generation-scoped baseline/written decisions;
  - blocking flush scheduling, debounce cancellation, writer coalescing, and
    receipt finalization;
  - explicit target ownership in `SessionPersistence`; the coordinator's
    compatibility accessor now derives from its recorded receipt rather than
    storing a second target field;
  - eleven focused `tests::flush` cases.
- `apps/game/src-tauri/src/game/mod.rs`
  - crate-visible read-only durable revision accessor for session capture.
- `apps/game/src-tauri/src/lib.rs`
  - exact `AppState` shape;
  - setup-time resources/save-root resolution;
  - generation-scoped fresh installation under `G → S`;
  - session-engine access and exclusive-intent guards for existing commands.

### Decisions

- Generation `0` represents the empty pre-game session. Installed sessions use
  coordinator-issued generations starting at `1`; allocation is checked and
  never wraps.
- `flush_baseline_revision` is the installed engine revision. A flush writes
  only when the live revision is greater than both the baseline and the
  same-generation `written_revision`.
- `record_written` ignores a receipt from any other generation, so generation 1
  revision 900 cannot cover generation 2 revision 1.
- `SessionPersistence.autosave_target` is the one explicit live-session target
  owner. Task 8's coordinator target accessor is retained for compatibility but
  derives from `last_successful_write`.
- A blocking flush uses `CaptureTerminalResult::Unavailable`; thumbnail
  unavailability remains independent of persistence health and cannot prevent
  the JSON write.
- A debounce for the same generation/revision is removed before blocking flush
  enqueue. If work already owns or is queued for `W`, the blocking job waits
  without `G`/`S` and treats a covering receipt as a no-op.
- Flush and manual-save policy decisions never mutate `GameEngine` and therefore
  never advance `durable_revision`.
- The exclusive intent is only a fail-fast hook in Part A. Part B owns intent
  registration/release and acknowledgement rollback semantics.

### RED evidence

Initial binding RED:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::flush
  exit 101
  E0432: unresolved FlushOperation and SessionPersistence
```

Monotonic generation RED:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::flush
  exit 101
  E0599: SaveCoordinator::next_session_generation did not exist
```

Blocking flush RED:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::flush
  exit 101
  unresolved FlushOutcome and missing SaveCoordinator::flush_session
```

Idempotency race RED:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::flush::blocking_flush_cancels_same_revision_debounce_before_it_enters_writer
  exit 101
  expected one write, observed two
```

The last RED proved a pending revision-1 debounce could enter `W` after the
blocking flush had already persisted revision 1. Cancelling the covered pending
intent and waking its ticket waiter removed the duplicate.

### GREEN evidence

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::flush
  11 passed, 427 filtered out
```

### Generation, transition, and no-op matrix

| Boundary | Evidence | Result |
| --- | --- | --- |
| fresh generation baseline | installed revision 0, baseline 0 | flush returns `Noop`; writer count remains 0 |
| loaded autosave baseline | installed revision 44 with autosave-3 source | revision 44 is `Noop`; revision 45 writes once |
| loaded target adoption | autosave source versus fresh/manual `None` | autosave target retained only for the autosave source |
| same-generation written coverage | baseline 12, written 18 | live revisions 12 and 18 no-op; 19 requires write |
| cross-generation high revision | generation 1 revision 900 receipt presented to generation 2 | ignored; generation 2 revision 1 writes |
| monotonic install generation | three sequential allocations | 1, 2, 3 |
| manual save boundary | flush policy lookup at covered/uncovered revision | same no-op/write rules; engine revision unchanged |
| in-game Load boundary | revision 44 then 45 | no-op then one blocking write |
| Return to Title boundary | fresh 0 and dirty 1 | no-op then one blocking write |
| acknowledgement boundary registration | policy decision included in boundary matrix | registered without adding acknowledgement semantics |
| pending debounce | notify revision 1, immediately flush revision 1, advance ticket deadline | exactly one writer entry |
| completed receipt | flush again after revision 1 receipt | `Noop`; no timestamp/rotation-capable writer entry |
| lock lifetime | writer wait followed by `G → S` receipt finalization | no synchronous session guard crosses await |
| public command contract | full crate build after AppState migration | existing commands retain `Result<GameStateView, GameError>` |

### Commands and results

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::flush
  exit 0; 11 passed, 427 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 438 passed across 6 suites

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
  exit 0; no issues found

rtk git diff --check
  exit 0
```

### Remaining Part B/C

- Part B: acknowledgement intent registration/release, event-bound ticket
  claim, `W → G → S` rollback/write/finalize transaction, target pin/reuse,
  sequential-event refresh, and authoritative cleanup outcomes.
- Part C: UUID failure-challenge registry, operation/generation/revision/
  discovery bindings, Retry/Cancel/bypass consumption, acknowledgement
  Continue Without Saving, and lock-order stress coverage.
- Task 10: concrete production backend binding, save/load/manual/title/exit
  commands, Tauri events, and development HTTP parity.

## Part B: durable acquisition acknowledgement

### Scope

Part B implements only exclusive acquisition acknowledgement and its normative
writer races. Failure challenges, Continue Without Saving, and the broader
lock-order stress matrix remain Part C.

### Implementation

- `acknowledge_acquisition(app, event_id, ticket)` now:
  1. verifies exactly one matching pending event and claims the terminal
     acquisition-bound thumbnail ticket;
  2. registers `AcquisitionAcknowledgement` as the session's exclusive intent;
  3. cancels a covered pending debounce before it can enter the writer;
  4. reserves the next acknowledgement-priority writer turn and waits without
     holding the replacement gate or session mutex;
  5. acquires `G → S`, reconciles any just-completed revision-N receipt into
     the session target, captures `EngineRollbackSnapshot`, removes exactly the
     requested event, and advances exactly once to N+1;
  6. validates the resulting public view before persistence, releases `S`, and
     performs the registered Task 8 prepare/commit path while retaining the
     writer turn and `G`;
  7. reacquires `S` to adopt the receipt on success or restore the rollback
     snapshot on authoritative write failure; and
  8. clears the exclusive intent and releases the writer reservation on every
     returned result.
- Successful replacement plus cleanup failure returns the committed N+1 state
  and typed cleanup diagnostic. It does not restore the event.
- The first successful acknowledgement allocation becomes the session
  autosave target. Sequential events refresh it, loaded autosaves refresh their
  source slot, and loaded manual sessions allocate a new autosave target.
- The acknowledgement path continues to use `AutosaveRegisteredIntent`,
  `AutosavePreparedWrite`, and the Task 8 backend phase split. Storage-backed
  acknowledgement tests exercise real `PreparedSlotWrite` replacement and
  cleanup behavior.

### RED evidence

Initial acknowledgement binding:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::acknowledgement
  exit 101
  unresolved AcknowledgementOutcome and missing SaveCoordinator::acknowledge_acquisition
```

The completed storage-backed cleanup case initially pinned the wrong diagnostic
constructor:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::acknowledgement
  7 passed, 1 failed
  observed cleanup diagnostic saveWriteFailed; expected saveReadFailed
```

The test was corrected to the real storage contract: failure to remove the old
sidecar after JSON replacement is a typed write-cleanup diagnostic, while the
acknowledgement remains committed.

### Race and target matrix

| Case | Result |
| --- | --- |
| N pending before writer | pending N is cancelled; only N+1 writes; no deadline follow-up |
| N already owns writer and commits | acknowledgement waits without `G`/`S`; N and N+1 use autosave-1 |
| N already owns writer and fails | the registered target remains autosave-1; only N+1 receives a receipt |
| sequential pending events | revisions 5 and 6 refresh the same autosave-1 target |
| loaded autosave | source autosave-4 is refreshed |
| loaded manual | no inherited target; autosave-1 is allocated |
| failed acknowledgement replacement | engine restores revision/event and prior slot bytes remain identical |
| cleanup-only failure | JSON replacement, revision N+1, and event removal remain committed; typed diagnostic returned |
| exclusivity | another session/gameplay operation observes `persistenceOperationInProgress` |
| wait lifetime | writer wait permits independent `G` and `S` acquisition |

### Commands and results

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::acknowledgement
  exit 0; 8 passed, 438 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::flush
  exit 0; 11 passed, 435 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
  exit 0; 11 passed, 435 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce
  exit 0; 23 passed, 423 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::writer
  exit 0; 4 passed, 442 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::storage_integration
  exit 0; 6 passed, 440 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 446 passed across 6 suites

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
  exit 0; no issues found

rtk git diff --check
  exit 0
```

### Remaining Part C

- UUID failure-challenge registry with exact operation/generation/revision/
  discovery identity and one-shot consumption.
- Retry, Cancel, and operation-specific bypasses, including acquisition
  Continue Without Saving.
- The full fault-injected lock-order stress matrix.
