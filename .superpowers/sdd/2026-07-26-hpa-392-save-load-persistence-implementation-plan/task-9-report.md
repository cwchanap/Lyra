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

