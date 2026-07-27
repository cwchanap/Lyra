# Task 11 implementation report

## Scope

Task 11 intercepts native close and quit requests, flushes the current
persistent session before allowing Tauri to exit, and exposes the same complete
exit state machine through Tauri IPC and the development HTTP transport. It
does not add the Task 12 frontend overlay.

## Lifecycle state machine

- Added the complete tagged `ExitStatusView` wire contract:
  `idle`, `saving`, and `failed { diagnostic, failureToken }`.
- Added the fallible `ApplicationExit: Send + Sync` boundary. Production
  delegates to `AppHandle::exit(0)` and reports successful scheduling; the
  development adapter records exit codes without terminating the server or
  test process, while test drivers can reject an action deterministically.
- A first main-window close or user-originated application quit transitions
  Idle to Saving, installs session-level exit exclusivity, and schedules one
  asynchronous flush.
- Repeated close/quit requests see the non-Idle state and do not schedule
  another flush.
- A successful or no-op flush arms exactly one programmatic-exit bypass before
  calling the exit driver. Only a coded `ExitRequested` consumes that bypass;
  unrelated user requests remain intercepted.
- A failed flush keeps the process alive, registers an
  `ExitWithoutSaving` persistence challenge, and publishes a complete Failed
  status carrying the registered opaque token. No synthetic or unregistered
  failure token is emitted.
- Failure-token generation and challenge reservation are coordinator-state
  owned. Production candidates remain canonical random UUID v4 values. Each
  candidate is checked through `HashMap::entry` while the state lock is held;
  an occupied candidate is retried, so generic and exit challenges never
  overwrite an existing authority. Exit Failed status and its matching
  challenge are committed together before subscribers are notified.
- Retry tentatively transitions and consumes the matching challenge only after
  its scheduler accepts the gated task. Cancel consumes it in the same commit
  that clears exit exclusivity. Exit Without Saving consumes it only after the
  fallible exit action succeeds. Failed actions preserve the exact Failed view
  and token. Wrong, stale, and replayed tokens retain the existing typed
  stale-token error.
- The gated exit worker receives an `ExitAttemptRecovery` that owns the exact
  pre-attempt lifecycle snapshot and, for retries, the one consumed challenge.
  It arms a synchronous RAII drop guard immediately after the start gate and
  before its first await. Task cancellation or an in-process panic therefore
  restores an initial attempt to Idle, or a retry to the structurally identical
  Failed view and exact challenge/token. A restored token succeeds once and
  replay remains stale.
- The guard disarms only after a successful external exit action returns with
  the programmatic bypass committed, or after Failed status and its newly
  registered challenge have committed atomically. Subscriber notification is
  deliberately separated from that commit. Scheduler rejection and a dropped
  start-gate receiver remain synchronous recovery paths with one recovery
  owner.
- A coordinator without application session/gate context leaves exit status
  Idle rather than publishing Saving for work it cannot schedule.

## Native and development transport

- Converted the Tauri builder from `.run(...)` to `.build(...); app.run(...)`
  so the callback can intercept:
  - `WindowEvent::CloseRequested` for the `main` window only;
  - user `RunEvent::ExitRequested`; and
  - the one permitted programmatic `ExitRequested`.
- Registered `get_exit_status`, `retry_exit`, `cancel_exit`, and
  `exit_without_saving` exactly once in the Tauri invoke handler and in the
  development dispatcher.
- Bound `exit-status-changed` as a complete payload through the existing event
  binding seam. `get_exit_status` and the event use the same snapshot and
  serialization.
- The development server owns one shared `DevelopmentExitDriver`, so separate
  HTTP requests participate in the same typed exit interaction without killing
  the server.

## Responsiveness and lock audit

Session exit exclusivity blocks new gameplay mutations, session replacement,
manual saves, and acknowledgement starts with
`persistenceOperationInProgress`. `get_state` uses the narrower rendered-state
guard, so the already-rendered view remains readable while exit saving is in
progress.

An acknowledgement that began before exit is allowed to finish. Its intent
guard releases the session mutex before notifying the exit waiter. Exit waits
on `Notify` without holding the session mutex (`S`), replacement gate (`G`), or
writer ownership.

Pending debounce work is superseded into the immediate exit flush. An active
writer is awaited through the existing serialized writer queue. The flush then
uses the established order: capture/revision inspection under brief `S`,
off-lock writer work, then `G -> S` for receipt adoption.

The production backend needed one deliberate revalidation adjustment. Backend
`capture` and `commit_current` no longer call the command-side exclusivity
guard: those writes were already authorized by the coordinator before exit
installed exclusivity, and exit must wait for them rather than reject them.
This bypass is limited to that internal writer path. It does not skip writer
serialization, prepared-write/receipt handling, the replacement gate, session
generation checks, durable-revision checks, or commit-time stale-write
revalidation. A production-filesystem regression proves an exit flush can
commit while exit exclusivity is active.

Whole-review hardening makes lifecycle transitions use the documented
`exit-transition -> S -> coordinator-state` order. The writer path retains
`writer gate -> G -> S`; lifecycle code never owns the writer gate or `G`.
There is no lifecycle inverse (`coordinator-state -> S`): status prechecks
release coordinator state before taking `S`, and every multi-lock lifecycle
commit takes `S` before coordinator state. Scheduler calls, subscriber
callbacks, awaits, and external exit actions all run after those guards are
released. A lock-probe exit driver verifies both exit-transition and `S` are
available inside the external action.

Cancellation recovery uses that same `exit-transition -> S ->
coordinator-state` order synchronously from `Drop`, without awaiting. The
worker's inner futures and any of their temporary guards drop before the
recovery guard. Controlled prepare-await tests prove `exit-transition` and `S`
are both acquirable while initial and retry workers are blocked. The retry
guard moves one consumed challenge record rather than cloning it; recovery
keeps a semantically identical record already present at that token. For the
impossible case where a different record collides with the previously issued
retry token, the prior issued authority wins at that key and the conflicting
record is invalidated. Lifecycle/session restoration completes in the same
commit, and unrelated challenge entries remain untouched.

The scheduler is transport-neutral and coordinator-owned. Test/development
construction captures its Tokio handle once, with a dedicated Tokio-thread
fallback when constructed outside a runtime, so a later plain `std::thread`
request does not depend on caller-local runtime context. Production explicitly
injects a scheduler backed by `tauri::async_runtime::spawn`.

`delete_save_core` now applies the centralized session admission guard before
publishing Pending, reserving writer work, or touching the filesystem. Its
Saving-state regression proves the typed busy error leaves persistence health,
the discovered browser, and filesystem remove count unchanged.

## TDD evidence

Initial lifecycle contract:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml exit_lifecycle
  exit 101; missing ApplicationExit, ExitRequestSource, and ExitStatusView
```

Subscriber/application constructors:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml exit_lifecycle
  exit 101; missing subscribe_exit_status and with_backend_for_application
```

Acknowledgement and native policy seams:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml exit_lifecycle
  exit 101; missing with_exit_application

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml exit_lifecycle
  exit 101; missing handle_close_requested and handle_exit_requested
```

Transport parity:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml exit_lifecycle
  exit 101; missing exit_status_snapshot, get_exit_status_core,
  DevelopmentExitDriver, dispatch_development_command_with_exit, and
  cancel_exit_core
```

Production backend regression:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  exit_lifecycle_production_backend_flushes_while_exit_exclusivity_is_active
  exit 101; production exit flush published Failed instead of exiting

# After restricting exclusivity to command-side admission:
cargo test: 1 passed, 532 filtered out (5 suites, 0.06s)
```

Unavailable application context:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  exit_lifecycle_request_without_application_context_stays_idle
  exit 101; status was Saving

# After checking context before the state transition:
cargo test: 1 passed, 533 filtered out (5 suites, 0.00s)
```

Whole-review RED/GREEN evidence:

```text
# Caller-local runtime dependency
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  exit_lifecycle_plain_thread_request_still_schedules_and_exits_once
  RED: 0 passed, 1 failed, 515 filtered; exit timed out after 1.01s
  GREEN: 1 passed, 534 filtered

# Scheduler rejection stranded Saving
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  exit_lifecycle_scheduler_rejection_restores_idle_and_session_admission
  RED: 0 passed, 1 failed, 516 filtered
  GREEN: 1 passed, 535 filtered

# Prerequisite, cancel, and challenge-publication failpoints
exit_lifecycle_prerequisite_failure_does_not_arm_saving
  RED: missing deterministic prerequisite failpoint
  GREEN: 1 passed, 536 filtered
exit_lifecycle_cancel_guard_clear_failure_preserves_exact_failed_token
  RED: missing deterministic guard-clear failpoint
  GREEN: 1 passed, 538 filtered
exit_lifecycle_challenge_publication_failure_restores_recoverable_idle
  RED: missing deterministic challenge-publication failpoint
  GREEN: 1 passed, 540 filtered

# Token/action atomicity
exact_identity_rejects_stale_session_revision_discovery_save_and_event
  RED: stale identity consumed the otherwise exact token
  GREEN: 1 passed, 536 filtered
exit_lifecycle_retry_scheduler_failure_preserves_exact_failed_token
  RED: retry rejection consumed the exact token
  GREEN: 1 passed, 537 filtered
exit_lifecycle_without_saving_action_failure_preserves_exact_failed_token
  RED: ApplicationExit could not report action failure
  GREEN: 1 passed, 539 filtered

# Delete admission
exit_lifecycle_saving_rejects_delete_before_health_writer_or_filesystem_side_effects
  RED: delete completed while exit Saving
  GREEN: 1 passed, 541 filtered

# Detached-worker cancellation recovery
exit_lifecycle_cancelled_initial_worker_restores_idle_and_session_admission
  RED: 0 passed, 1 failed, 524 filtered; abort left status Saving
  GREEN: included in 2 passed, 544 filtered for cancelled-worker tests
exit_lifecycle_cancelled_retry_restores_exact_failed_status_and_challenge
  RED: 0 passed, 1 failed, 525 filtered; Failed view restored without the
       consumed challenge, so the exact token was stale
  GREEN: included in 2 passed, 544 filtered for cancelled-worker tests;
         exact Failed JSON and one challenge restored, token succeeded once,
         replay returned stalePersistenceFailureToken

# Start-gate ownership and in-process panic
exit_lifecycle_dropped_start_gate_restores_idle_synchronously
exit_lifecycle_retry_start_gate_failure_preserves_exact_failed_token
  GREEN: each 1 passed, 546 filtered
exit_lifecycle_panicking_initial_worker_unwinds_to_idle_and_can_retry
  GREEN: 1 passed, 526 filtered; JoinError was panic, not cancellation, and
         a fresh exit request succeeded

# Failure-token collision ownership
exit_lifecycle_failure_token_collision_reserves_a_new_matching_challenge
  RED: 0 passed, 1 failed, 528 filtered; exit failure reused occupied
       00000000-0000-4000-8000-000000000001 instead of reserving fresh
       00000000-0000-4000-8000-000000000002
  GREEN: 1 passed, 547 filtered; original and exit authorities each consumed
         once and neither replayed
exit_lifecycle_retry_recovery_collision_restores_prior_authority_only
  RED: 0 passed, 1 failed, 529 filtered; occupied recovery entry returned
       early and left lifecycle Saving
  GREEN: 1 passed, 548 filtered; exact Failed JSON/token and session guard
         restored, only the colliding record replaced, unrelated record
         remained structurally identical and consumable
```

## Final verification

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml collision
  cargo test: 2 passed, 547 filtered out (5 suites, 0.01s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  exit_lifecycle_cancelled_
  cargo test: 2 passed, 547 filtered out (5 suites, 0.01s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml exit_lifecycle
  cargo test: 28 passed, 521 filtered out (5 suites, 0.05s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator
  cargo test: 112 passed, 437 filtered out (5 suites, 0.10s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  --example dev_engine_server
  cargo test: 6 passed (1 suite, 0.00s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  application_command_contract
  cargo test: 45 passed, 504 filtered out (5 suites, 0.42s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  cargo test: 549 passed (6 suites, 1.49s)

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
  cargo clippy: No issues found

rtk git diff --check
  exit 0
```

The exact resolved Tauri 2.11.0 crate source was used to verify the callback
shapes and semantics for `App::run`, `RunEvent::ExitRequested`,
`WindowEvent::CloseRequested`, `prevent_exit`, and `prevent_close`.

## Files changed

- `apps/game/src-tauri/src/game/save/coordinator.rs`
- `apps/game/src-tauri/src/lib.rs`
- `apps/game/src-tauri/examples/dev_engine_server.rs`
- this report
