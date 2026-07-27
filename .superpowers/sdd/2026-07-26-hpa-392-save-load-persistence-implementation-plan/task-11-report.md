# Task 11 implementation report

## Scope

Task 11 intercepts native close and quit requests, flushes the current
persistent session before allowing Tauri to exit, and exposes the same complete
exit state machine through Tauri IPC and the development HTTP transport. It
does not add the Task 12 frontend overlay.

## Lifecycle state machine

- Added the complete tagged `ExitStatusView` wire contract:
  `idle`, `saving`, and `failed { diagnostic, failureToken }`.
- Added the `ApplicationExit: Send + Sync` boundary. Production delegates to
  `AppHandle::exit(0)`; the development adapter records exit codes without
  terminating the server or test process.
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
- Retry consumes the matching challenge and starts a fresh exit flush. Cancel
  consumes it, clears exit exclusivity, and returns Idle. Exit Without Saving
  consumes it, arms the same one-shot bypass, and exits. Wrong, stale, and
  replayed tokens retain the existing typed stale-token error.
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

## Final verification

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml exit_lifecycle
  cargo test: 13 passed, 521 filtered out (5 suites, 0.06s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator
  cargo test: 98 passed, 436 filtered out (5 suites, 0.10s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  --example dev_engine_server
  cargo test: 6 passed (1 suite, 0.00s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  application_command_contract
  cargo test: 44 passed, 490 filtered out (5 suites, 0.40s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  cargo test: 534 passed (6 suites, 1.46s)

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
  cargo clippy: No issues found

rtk git diff --check
  exit 0
```

The exact local Tauri 2.11.5 crate source was used to verify the callback
shapes and semantics for `App::run`, `RunEvent::ExitRequested`,
`WindowEvent::CloseRequested`, `prevent_exit`, and `prevent_close`.

## Files changed

- `apps/game/src-tauri/src/game/save/coordinator.rs`
- `apps/game/src-tauri/src/lib.rs`
- `apps/game/src-tauri/examples/dev_engine_server.rs`
- this report

