# Task 10 implementation report

## Part A — centralized application command policies

### Scope

Part A installs the application command result types, one short-lived
gameplay-mutation guard, explicit mutation persistence policies, the Task 10
command registration surface, and contract tests. It intentionally does not
implement disk-backed save/load/title commands, raw thumbnail IPC, status
events, or development HTTP transport parity; those remain Parts B/C.

### Application facade

- Added the pinned camel-case wire views:
  `GameplayCommandResultView`, `ManualSaveResultView`,
  `SaveBrowserOpenResultView`, and tagged `SaveBrowserPreflightView`.
- Added the closed `MutationPersistencePolicy` enum:
  `AutosaveIfAdvanced`, `CoordinatorManaged`, and
  `AdvanceWithoutSaving`.
- `run_gameplay_mutation` is the only ordinary gameplay mutation entry seam.
  It:
  1. takes a short-lived `AppSession` guard;
  2. rejects an absent engine with `gameNotStarted`;
  3. rejects an exclusive persistence operation with
     `persistenceOperationInProgress`;
  4. records the session generation and before/after durable revisions;
  5. invokes the engine command;
  6. releases the session guard before coordinator notification; and
  7. schedules autosave capture only when the durable revision advanced.
- A scheduling failure is post-commit background degradation: the command
  returns the committed state with `thumbnailCapture: null`, while persistence
  health becomes `degraded`.
- `get_state` remains a bare `GameStateView`.
- `start_game` and `reset_game` preserve the Task 9 monotonic installation
  semantics and return the wrapper with no revision-zero capture.
- `install_session_candidate` evaluates the fallible candidate before calling
  the Task 9 installation seam. A failed candidate changes neither the public
  view nor session generation.

### Policy matrix

| Command class | Policy | Capture/notification result |
| --- | --- | --- |
| ordinary gameplay mutation with revision advance | `AutosaveIfAdvanced` | one coordinator notification; returned capture request when scheduling succeeds |
| stale/unchanged gameplay result | `AutosaveIfAdvanced` | no notification; `thumbnailCapture: null` |
| acquisition acknowledgement | `CoordinatorManaged` | Task 9 coordinator owns the durable write; application wrapper does not notify again |
| acknowledgement Continue Without Saving | `AdvanceWithoutSaving` | live revision advances; application wrapper never schedules that revision |
| start/reset/load-style session installation | transition seam | `thumbnailCapture: null` |
| read-only state/status | not a mutation policy | bare view |

Every existing ordinary gameplay handler now selects
`AutosaveIfAdvanced`: scene jump, dialogue advance, hotspot/topic/sublocation
actions, evidence/statement re-examination, and every interrogation action.
None directly locks the application session.

### Registration matrix

Part A registers each Task 10-owned command name exactly once:

| Surface | Registered commands |
| --- | --- |
| read/status | `list_saves`, `get_state`, `get_persistence_status`, `get_thumbnail_activity` |
| session | `start_game`, `start_game_without_saving`, `load_save`, `load_save_discarding_current`, `continue_game`, `return_to_title`, `return_to_title_without_saving` |
| thumbnail/manual | `prepare_save_thumbnail`, `submit_save_thumbnail`, `report_save_thumbnail_failure`, `read_save_thumbnail`, `save_manual` |
| save management | `delete_save` |
| acquisition | `acknowledge_acquisition_event`, `confirm_acquisition_without_saving` |

All pre-existing gameplay/debug commands remain registered. The Task 11-only
commands `get_exit_status`, `retry_exit`, `cancel_exit`, and
`exit_without_saving` remain absent.

Except for the already-complete Task 9 acquisition coordinator calls and
read-only status snapshots, newly registered persistence commands are explicit
`unavailable` placeholders. They pin command ownership without pretending that
Parts B/C disk or raw-byte behavior exists.

### RED evidence

Initial application facade:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
  exit 101; 11 compile errors
  missing MutationPersistencePolicy, run_gameplay_mutation, read_game_state,
  and the test backend constructor boundary
```

Candidate installation seam:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
  exit 101; E0425
  install_session_candidate did not exist
```

Registration ownership:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
  7 passed, 1 failed
  list_saves registration count was 0; expected exactly 1
```

Post-commit scheduler degradation:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
  exit 101; E0624
  the contract could not drive the existing fail-next-schedule test seam
```

### GREEN evidence

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
  exit 0; 10 passed, 473 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 483 passed across 6 suites

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
  exit 0; no issues found

rtk git diff --check
  exit 0
```

### Remaining Parts B/C

- Part B: bind the production storage backend and implement discovery,
  manual-save, load/Continue, deletion, start-without-saving, and Return to
  Title transitions against Task 9 flush/failure-challenge contracts.
- Part C: implement raw PNG request/response IPC, exact ticket-header parsing,
  complete persistence/thumbnail events, and the matching development HTTP
  transport.
- Task 11: add only the four exit lifecycle commands after its state machine
  and exit-driver adapter exist.
