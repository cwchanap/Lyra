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

## Part B1 — production persistence, discovery preflight, and manual save

### Scope

Part B1 replaces the Part A placeholders for application storage setup,
authoritative prepared-thumbnail intent resolution, `list_saves`, thumbnail
failure reporting, and `save_manual`. Load/Continue/delete/title transitions
remain Part B2; raw thumbnail bytes, status events, and HTTP parity remain
Part C.

### Task 9 internal type adjustment and lock identity

Task 9 introduced the single application-owned `Mutex<AppSession>`. The
production backend must inspect the same live session during capture and
commit, so Part B1 changes only its ownership wrapper to
`Arc<Mutex<AppSession>>`. It does not create a second session or copy session
state.

`ApplicationPersistence` and `AppState` hold clones of that exact session
`Arc` and the exact Task 9 replacement-gate `Arc`. A contract test uses
`Arc::ptr_eq` for both objects. The production backend preserves the approved
lock order:

- capture briefly takes `S`, captures and validates the exact
  generation/revision checkpoint, drops `S`, and only then performs discovery;
- `commit_if_current` takes `G`, briefly revalidates under `S`, drops `S`, and
  commits while retaining `G`;
- `commit_with_gate_held` assumes its Task 9 caller already owns that same
  `G`, briefly revalidates under `S`, drops `S`, and commits without
  reacquiring `G`;
- manual save flushes first, captures under brief `S`, and releases `S` before
  it awaits the serialized writer result.

A two-worker storage probe pauses inside production discovery and proves the
shared session mutex remains independently acquirable during that backend
await.

### Production storage and autosave backend

- Application setup now resolves the configured and production app-data
  roots through `resolve_save_root`. The production filesystem uses
  `ProductionSaveFilesystem`.
- Unsafe E2E root validation errors still propagate from setup and remain
  startup-fatal.
- Ordinary `ensure_save_layout` creation/permission failures no longer abort
  the title UI. Setup retains a state with no usable persistence backend and
  publishes the exact failure as degraded persistence health; title discovery
  returns an unavailable browser with no fabricated slots.
- Current packaged definitions are loaded once and shared by discovery and
  envelope construction.
- The production backend captures immutable checkpoints from the exact live
  session, discovers autosave targets off-lock, prepares/commits through the
  Task 6 storage primitives, and runs orphan cleanup through the same
  filesystem/root.
- Generated save timestamps are UTC RFC 3339 with nanosecond precision and
  advance monotonically within the process, so back-to-back writes remain
  distinct even when the wall clock does not advance.
- A real-filesystem integration advances the packaged fixture, executes a
  blocking autosave flush, rediscovers a valid checkpoint, and proves only the
  committed autosave target is adopted without changing the durable revision.

### Discovery and manual save

- `prepare_save_thumbnail` resolves closed manual/acknowledgement IPC intent
  into authoritative generation/revision/event identities while holding only
  brief session access. Event drift is rejected before a ticket is issued.
- `list_saves` skips flushing on the title screen. With an active session it
  attempts the Task 9 in-game-load flush before discovery, but a failed flush
  still returns the separately discovered browser, Rust-selected Continue
  candidate, exact diagnostic, and opaque generation/discovery-bound failure
  token.
- `save_manual` never bypasses a required flush. After a successful flush it
  validates the manual slot, Unicode display name, observed occupancy
  expectation, and exact prepared-thumbnail ticket; captures the immutable
  checkpoint; and serializes the write through the coordinator writer queue.
- Each manual save creates a new UUID v4, timestamp, and thumbnail attempt.
  Saving one unchanged durable revision to two manual slots therefore creates
  distinct checkpoint identities without advancing the revision or adopting
  either manual slot.
- The result contains the freshly rediscovered saved slot/browser plus the
  complete current thumbnail activity. Write failures degrade persistence;
  successful writes with cleanup diagnostics remain committed but retain
  degraded health.

### RED evidence

Authoritative prepare/list preflight:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
  exit 101; 6 compile errors
  3 missing SaveCoordinator::prepare_application_thumbnail
  3 missing list_saves_core
```

Production backend/setup/manual boundary:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
  exit 101; 6 E0425 compile errors
  4 missing build_app_state_with_storage
  2 missing save_manual_core
```

The first production implementation compile then reduced to one
test-lifetime error (`E0597`) in the no-guard-across-await probe; cloning the
exact backend `Arc` into the spawned task fixed the test without changing the
lock design.

### GREEN evidence

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
  exit 0; 20 passed, 473 filtered out across 5 suites

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save
  exit 0; 202 passed, 291 filtered out across 5 suites

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 493 passed across 6 suites

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
  exit 0; no issues found
```

### Deferred after Part B1

- Part B2: load, Continue, delete, Return to Title, and
  start/continue/return-without-saving challenge consumption.
- Part C: raw PNG IPC, status event binding, and development HTTP parity.

## Part B2 — disk-backed session transitions and deletion

### Scope

Part B2 replaces the remaining Task 10 disk/session placeholders:
`load_save`, `load_save_discarding_current`, `continue_game`, `delete_save`,
`return_to_title`, `return_to_title_without_saving`, `start_game`, and
`start_game_without_saving`. Raw thumbnail IPC, status events, and the
development HTTP mirror remain Part C.

### Transition ordering and atomicity

- Added bounded `read_save_envelope`: it rereads only the fixed typed slot,
  requires the browser-observed canonical UUID v4, rejects replacement ID
  drift, validates slot/type agreement, and returns the typed envelope for the
  existing restore boundary.
- Normal Load with an active session completes its mandatory flush before it
  rereads the selected slot. The immutable restore candidate is built outside
  both `G` and `S`.
- Continue follows the same ordering, then performs a fresh discovery and
  uses the shared Rust `select_continue_candidate`. If the newest slot is
  invalid it returns that slot's typed diagnostic and never falls back to an
  older valid checkpoint.
- A new `SessionTransitionIdentity` captures only generation and optional
  durable revision. Candidate installation and session clearing use
  conditional Task 9 seams: build/read happens off-lock, then `G → S`
  revalidates the identity before the atomic replacement. Revision/generation
  drift rejects the transition and preserves the complete live public view.
- Installed autosaves adopt their source; installed manual saves and fresh
  games have no autosave target. Every transition response has
  `thumbnailCapture: null`.
- Blocking flush now carries the briefly captured installed autosave target
  into the writer turn. This fixes a Task 9 integration gap where a real
  production flush rotated to a new empty slot instead of refreshing the
  adopted source; no session guard crosses the writer wait.

### Opaque failure challenges

- A normal Load flush failure returns a
  `LoadDiscardingCurrent` challenge bound to the current session and discovery
  generation. The bypass consumes the exact opaque token, skips flush,
  rereads/builds the caller's typed slot and observed save ID, and installs
  only if the challenged session remains current.
- Return to Title flushes first. Failure returns a
  `ReturnWithoutSaving` session-bound challenge; the bypass consumes it and
  conditionally clears under `G → S`.
- Initial storage failure returns a discovery-bound
  `StartWithoutSaving` challenge. The bypass builds the packaged fresh engine
  off-lock, consumes the exact challenge, and conditionally installs it.
- Challenge construction remains coordinator-private. Application code and
  tests never inspect operation/generation/revision bindings, and token reuse,
  wrong IDs, and later discovery invalidation remain rejected.

### Retryable startup persistence

Part B1 originally represented an ordinary `ensure_save_layout` failure by
omitting the backend. That could start degraded play but could not satisfy the
approved requirement that a later durable revision retry real persistence.
Part B2 corrects the representation:

- the production backend and exact shared session/gate identities are retained
  even after initial layout failure;
- only the opaque availability diagnostic is retained;
- discovery and backend capture retry `ensure_save_layout`;
- a successful retry clears availability and permits later autosave/flush;
- unsafe E2E root validation remains startup-fatal.

A recovering-filesystem regression proves Start Without Saving can install
degraded, storage can recover, and a later exact-revision flush creates a valid
checkpoint.

### Delete and fresh browser state

- Delete runs through the serialized coordinator writer queue and delegates to
  Task 6 `delete_slot` with the exact typed reference and
  `OccupiedSlotExpectation`.
- Canonical-ID replacements reject stale confirmations. Corrupt ID-less files
  require the exact observed mtime.
- Sidecar deletion is still derived only from a valid owned envelope; an
  application-level regression proves an unrelated thumbnail remains intact
  when deleting a corrupt checkpoint.
- Successful delete and Return to Title rediscover immediately, recompute
  Continue in Rust, and return `preflight: ready`.

### RED evidence

Initial load phase-ordering and candidate-failure boundary:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml transition_contract_load
  exit 101; 2 E0425 compile errors
  missing load_save_core in the flush-before-reread and build-failure tests
```

The first runtime execution found the adopted-target integration bug:

```text
transition_contract_load_flushes_before_rereading_an_adopted_source_slot
  expected staleSaveSelection after flush replaced source ID A with B
  got a successful load of A because blocking flush rotated into another slot
```

After the load slice was green, the broader transition matrix failed at its
intended API boundary:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml transition_contract
  exit 101; 12 compile errors
  missing load-discard, Continue, return/bypass, start/bypass, and delete cores
  plus private token construction rejected in two tests
```

Tests were changed to extract only the opaque token already carried by
`GameError`; the token field itself remained private.

### GREEN evidence

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml transition_
  exit 0; 14 passed, 490 filtered out across 5 suites

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
  exit 0; 31 passed, 473 filtered out across 5 suites

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save
  exit 0; 202 passed, 302 filtered out across 5 suites

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 504 passed across 6 suites

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
  exit 0; no issues found
```

### Deferred after Part B2

- Part C only: raw PNG request/response IPC, exact ticket-header parsing,
  complete persistence/thumbnail status events, and development HTTP parity.

## Part C — raw thumbnail IPC, complete status events, and HTTP parity

### Raw thumbnail request and response contracts

- `submit_save_thumbnail` now accepts `tauri::ipc::Request` and only accepts
  `InvokeBody::Raw`; a JSON byte array is rejected as a malformed PNG
  submission.
- One shared byte-oriented header validator is used by the Tauri command and
  development HTTP bridge. It matches
  `x-lyra-thumbnail-ticket` case-insensitively, requires exactly one value,
  rejects non-UTF-8 and noncanonical/non-v4 UUID values, and does not trim or
  normalize the opaque ticket.
- Missing, duplicate, invalid, and malformed ticket headers fail before
  coordinator submission. Contract tests prove the live ticket remains in
  `capturing`, so no rejected ingress mutates coordinator state.
- The 1 MiB raw body cap is checked on the borrowed request bytes before any
  clone or coordinator call. The HTTP bridge also checks `Content-Length`
  against that cap before body allocation.
- `read_save_thumbnail` delegates to the existing bounded Task 6 storage
  reader with only a typed slot and browser-observed save ID, then returns
  `tauri::ipc::Response::new(bytes)`. Tests save a real available thumbnail,
  recover byte-identical PNG data, and reject a stale observed ID. No command
  accepts or returns a filesystem path or URL.

### Complete status snapshots and events

- Getter snapshots and event payloads use the same complete
  `PersistenceHealthView` and `ThumbnailActivityView` serialization.
- Application setup binds the coordinator's one subscription surface to the
  exact `persistence-status-changed` and `thumbnail-activity-changed` event
  names.
- Subscription immediately emits both complete current snapshots and every
  later publication emits another complete replacement payload. Tests compare
  whole serialized values to the getters, including tagged variants and
  optional diagnostic fields, rather than reconstructing individual fields.
- The getters remain available for startup/event-recovery reads.

### Development HTTP mirror

- The development server now owns the same `AppState` facade as Tauri instead
  of a transport-specific `Mutex<Option<GameEngine>>`. Its dispatcher calls
  the exact Task 10 cores and preserves the existing gameplay/debug commands,
  so mutation responses use `GameplayCommandResultView` in both transports.
- A shared adapter serializes gameplay wrappers, save-browser views, and
  status views once; parity tests compare the complete JSON values against
  direct core results.
- `POST /command/submit_save_thumbnail` is explicitly normalized and accepts
  the same raw ticket-header/body shape. Legacy development command paths such
  as `/get_state` remain accepted.
- The socket parser preserves repeated header values and opaque non-UTF-8
  bytes until the shared validator. It rejects duplicate or overflowing
  `Content-Length`, rejects early EOF, and retains missing/duplicate ticket
  error parity with the Tauri core.
- Response writing is byte-oriented. A binary PNG response retains non-UTF-8
  bytes and uses their exact byte count for `Content-Length`; the shared
  thumbnail-read integration returns `image/png`.
- CORS allows exactly `Content-Type, X-Lyra-Thumbnail-Ticket`.
- Source guards require every Task 10 command plus the retained `reset_game`
  development alias exactly once and require the four Task 11 exit commands
  to remain absent from both Tauri registration and HTTP dispatch.

### RED evidence

Raw ingress contract:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  raw_thumbnail_command_contract
  exit 101; 7 compile errors
  missing RawThumbnailHeader and submit_save_thumbnail_core
```

Binary read and status events:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  thumbnail_read_returns_exact_bytes
  exit 101; 2 compile errors
  missing read_save_thumbnail_core

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  status_events_are_named_complete_snapshots
  exit 101; 5 compile errors
  missing event constants and bind_persistence_status_events
```

Shared development adapter and byte response:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  development_http_adapter_serializes
  exit 101; 4 compile errors
  missing development AppState builder and dispatcher

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  --example dev_engine_server binary_response_preserves_bytes
  exit 101; missing encode_response
```

### GREEN evidence

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  application_command_contract
  exit 0; 34 passed, 477 filtered out across 5 suites

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  --example dev_engine_server
  exit 0; 6 passed

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml thumbnail
  exit 0; 21 passed, 490 filtered out across 5 suites

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save
  exit 0; 203 passed, 308 filtered out across 5 suites

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 511 passed across 6 suites

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
  exit 0; no issues found

rtk git diff --check
  exit 0
```

### Deferred after Task 10

- Task 11 only: `get_exit_status`, `retry_exit`, `cancel_exit`, and
  `exit_without_saving`, plus native close/quit interception.
