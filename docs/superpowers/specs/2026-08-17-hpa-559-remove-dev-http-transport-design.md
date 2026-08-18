# HPA-559 Remove Legacy Browser HTTP Game-Engine Fallback

**Date:** 2026-08-17  
**Status:** Approved design, revised after review  
**Target baseline:** current `main` after HPA-621 / PR #62

## Goal

Reduce Lyra to one supported application command path:

```text
Svelte client → Tauri invoke → Rust application facade
```

Delete the developer-only browser HTTP game-engine fallback rather than preserving it behind another interface.

This is a maintenance simplification, not a gameplay change. The supported loops remain:

- `bun run dev:game` for the real Tauri app;
- Vitest/jsdom and component harnesses for browser-side UI iteration;
- packaged Tauri/WebDriver suites for cross-layer IPC, filesystem, and gameplay verification.

## Why HPA-559 is actionable now

HPA-559 has no blocker and removes infrastructure that is already outside the supported development path.

Do not pull forward the post-playtest work:

- HPA-550 still needs real Save/Load/Continue playtest evidence before deciding thumbnail behavior.
- HPA-521 should wait for the HPA-550 decision rather than preserve machinery that may disappear.
- HPA-536 is release hardening and remains gated on post-playtest product/architecture choices.
- HPA-602 is an explicitly deferred two-raster visual follow-up.
- Chapter 2 remains deferred.

PR #61 deliberately retained the browser HTTP fallback and named HPA-559 as its owner.

## Current-state survey

### Supported dev and validation already use Tauri

The current scripts already provide:

```text
bun run dev:game
  → game frontend + Tauri dev
```

Packaged WebDriver suites own the real cross-layer application boundary. No live root/package script or CI job launches `dev_engine_server` as the normal workflow.

### Gameplay client still owns two transports

`apps/game/src/lib/state/game-client.svelte.ts` currently contains:

- `isTauri` runtime detection;
- `DEV_HTTP_BASE = "http://127.0.0.1:1421"`;
- `httpInvoke()`;
- a Tauri-vs-HTTP branch in `runCommand()`;
- a second Tauri-vs-HTTP branch in `listScenes()`.

Both branches must disappear. HPA-559 is incomplete if `runCommand()` becomes Tauri-only while `listScenes()` still calls `httpInvoke()`.

### Persistence client duplicates the same choice

`apps/game/src/lib/persistence/commands.ts` independently owns:

- another Tauri runtime check;
- another HTTP base;
- JSON fetch/error parsing;
- binary thumbnail HTTP submit/read behavior;
- Tauri-vs-HTTP branching.

Keep the meaningful wrappers:

- `asGameError()` owns typed error normalization.
- `invokePersistenceCommand()` remains the shared persistence error boundary.
- the existing three-argument Tauri `submit_save_thumbnail` invocation owns the binary/header IPC shape.

Delete only the alternate transport behavior.

### Rust owns a complete second runtime

`apps/game/src-tauri/examples/dev_engine_server.rs` owns:

- raw TCP listening;
- HTTP request/header parsing;
- duplicate `Content-Length` / `Origin` handling;
- CORS policy;
- request-size limits;
- response encoding;
- thumbnail-specific binary request handling;
- a separate Tokio runtime;
- a development command string router;
- server/parser/CORS tests.

`apps/game/src-tauri/Cargo.toml` exposes `dev-engine-server` only for this runtime.

### Existing application pieces are reusable

Do not rebuild infrastructure while deleting the server:

- `build_development_app_state` is only a thin wrapper over the existing `build_app_state_with_storage`; delete the wrapper and keep the shared builder.
- `DevelopmentExitDriver` exists for development dispatch parity; existing exit tests already have their own `RecordingExit` test double. Do not invent a replacement driver.
- Tauri command cores, persistence storage, thumbnail validation, exit behavior, and E2E checkpoint code remain the production owners.

### Frontend page tests currently rely on both HTTP branches

`apps/game/src/routes/page.test.ts` has an existing `@tauri-apps/api/core` mock, but its live command path is currently `fetch()` because jsdom has no `__TAURI_INTERNALS__` global.

That file exercises both gameplay and persistence flows. Therefore migration order matters:

```text
1. gameplay client + focused unit tests
2. persistence client + focused unit tests
3. page tests
```

If page tests are converted before persistence becomes Tauri-only, save/load/thumbnail page flows still try to use HTTP after the fetch fixtures are removed. Do not temporarily restore `__TAURI_INTERNALS__` or a fetch shim to bridge that ordering mistake.

### Port 1421 has an unrelated valid owner

`apps/game/vite.config.ts` uses port `1421` for Vite HMR when `TAURI_DEV_HOST` is set.

That is not the game-engine HTTP server. The implementation must remove `127.0.0.1:1421` command transport usage without removing or renumbering the HMR port.

### `codecov.yml` is live config, not historical documentation

The current Codecov comment says `lib.rs` dispatch/arg handling is covered by the `dev_engine_server` example. That statement becomes false when the server is deleted.

Keep the `lib.rs` ignore rule, but rewrite the comment to describe the remaining reason only: `lib.rs` is Tauri registration/runtime glue whose deterministic business behavior is tested below the runtime boundary and whose real IPC integration is covered by packaged Tauri tests.

Do not invent a replacement browser-HTTP coverage story.

### Historical planning records stay historical

Older `docs/superpowers/**` documents may mention the fallback because it existed when they were written. Do not rewrite those records for chronology.

## Architecture decision

### Selected: direct Tauri-only clients + deletion

Keep current ownership boundaries and remove the choice:

```text
Gameplay client
  → invoke(command, args)

Persistence command boundary
  → invoke(command, args)
  → asGameError(error)

Rust
  → existing Tauri command/core ownership
```

Delete:

- frontend environment transport branching;
- HTTP JSON/binary helpers;
- standalone Rust HTTP server;
- the `dev-engine-server` feature;
- server-only development dispatch types/functions/tests.

### Rejected: one-implementation transport abstraction

Do not create `GameTransport`, `invokeGameCommand`, an adapter registry, local RPC layer, or a mock HTTP server. Vitest already mocks `@tauri-apps/api/core.invoke` directly.

### Rejected: retain the server for hypothetical browser tooling

Keeping the server would preserve the largest maintenance surface—parser, CORS, binary framing, second runtime, and dispatch parity—for no current essential workflow.

## Frontend behavior

### Gameplay

`game-client.svelte.ts` remains the gameplay orchestration owner.

Keep unchanged:

- command in-flight fencing;
- loading/error state;
- `GameplayCommandResultView` application;
- thumbnail capture follow-up;
- SFX inference;
- Analysis action-token behavior;
- scene navigation semantics;
- E2E checkpoint behavior.

Change both command entry points:

- `runCommand()` calls `invoke()` directly.
- `listScenes()` calls `invoke<SceneNavigationIndex>("list_scenes")` directly inside its existing local try/catch so panel-local error behavior stays unchanged.

### Persistence

`persistence/commands.ts` remains the typed persistence boundary.

Keep:

- `asGameError()`;
- `invokePersistenceCommand()`;
- exact binary thumbnail Tauri shapes;
- all public helper signatures.

Remove:

- runtime Tauri detection;
- development HTTP assertion/error helpers;
- JSON HTTP invocation;
- HTTP thumbnail submit/read branches.

## Rust deletion boundary

Delete:

- `apps/game/src-tauri/examples/dev_engine_server.rs`;
- Cargo feature `dev-engine-server`;
- `DevelopmentCommandResponse`;
- `DevelopmentExitDriver`;
- `build_development_app_state`;
- `dispatch_development_command`;
- `dispatch_development_command_with_exit`;
- the development command string router and serializer/binary adapter glue.

Keep:

- `build_app_state_with_storage`;
- shared command core functions;
- thumbnail validation/storage core;
- save/load application persistence;
- exit lifecycle core;
- packaged E2E checkpoints/fault behavior;
- existing core test helpers such as `RecordingExit`.

Do not use HPA-559 as an excuse to decompose `lib.rs` or refactor the save coordinator. HPA-521 owns that broader work if it activates later.

## Rust test preservation rule

The review found several tests whose names look HTTP-specific but whose bodies also carry valuable command-core assertions. Do not delete these tests wholesale.

| Current test | Keep as direct core coverage | Delete with HTTP adapter |
|---|---|---|
| `tauri_core_and_http_adapter_return_identical_raw_request_errors` | `submit_save_thumbnail_core` rejects empty and duplicate ticket headers | HTTP dispatch comparison |
| `exit_lifecycle_getter_event_and_http_share_complete_status_and_error_views` | getter/event payload parity plus `cancel_exit_core` wrong-token error | HTTP response/error comparison and `DevelopmentExitDriver` use |
| `thumbnail_read_returns_exact_bytes_and_rejects_stale_observed_identity` | `read_save_thumbnail_core` exact bytes plus stale observed-save identity | HTTP `image/png` body comparison |
| `development_http_adapter_serializes_the_shared_wrapper_and_save_views` | nothing | entire test |
| `development_http_dispatch_registers_the_complete_task_11_surface` | nothing | entire test |
| `command_surface_contract` module | nothing | entire module; it only mirrors the development string router against Tauri registration |

Implementation should rename/split the first three as direct core tests before deleting their HTTP halves. This avoids losing real behavior coverage while still deleting parity machinery.

Nearby malformed-PNG/oversized-thumbnail tests do not replace the empty/duplicate ticket-header assertions, so those core assertions must survive explicitly.

## HTTP-only error cleanup

`GameError::request_origin_forbidden()` becomes dead with the CORS server.

Delete:

- the constructor itself;
- its `"requestOriginForbidden"` row in `uncovered_error_constructors_return_their_exact_codes`.

Use a final usage search to confirm there is no other caller. Do not keep a dead constructor merely to satisfy the constructor-code table.

Other error constructors stay unless the deletion proves they are server-only.

## Test architecture after deletion

### Gameplay unit/source tests

Mock `@tauri-apps/api/core.invoke` directly. No fake `window.__TAURI_INTERNALS__` branch selection.

Retain a regression proving gameplay commands and `listScenes()` use the Tauri mock even when the jsdom runtime global is absent.

### Persistence tests

Import `commands.ts` normally and mock `invoke()` directly.

Retain:

- structured error normalization;
- binary submit header/bytes shape;
- binary thumbnail read normalization;
- corrupt-response handling.

### Page tests

After both production clients are Tauri-only, replace HTTP URL/fetch fixtures with the existing `mocks.invoke` seam.

No generic fake transport helper.

### Rust tests

Delete parser/CORS/HTTP encoding/string-router parity tests that no longer have a product owner.

Preserve direct command-core assertions according to the keep/delete table above.

## Implementation order

The order is load-bearing:

```text
Task 1 — gameplay client + focused tests, including listScenes
Task 2 — persistence client + focused tests
Task 3 — page tests migrate from fetch to invoke
Task 4 — Rust server/dispatch deletion + core-test preservation
Task 5 — live config cleanup + absence/full verification
```

Focused tests may be green at the end of Tasks 1 and 2 while `page.test.ts` remains temporarily dependent on the old HTTP path. Do not claim the full frontend suite until Task 3 completes.

## Live config cleanup

`codecov.yml` is the known live configuration change.

Keep:

```yaml
ignore:
  - "apps/game/src-tauri/src/lib.rs"
```

Rewrite only the explanatory comment so it no longer claims coverage from a deleted `dev_engine_server` example.

No historical doc rewrite is part of this ticket.

## Verification

### Static absence

```bash
rg -n 'DEV_HTTP_BASE|developmentHttpBase|httpInvoke|127\.0\.0\.1:1421' apps/game/src
rg -n 'dev_engine_server|dev-engine-server' apps/game/src-tauri apps/game/package.json package.json codecov.yml
```

Expected after implementation:

- no legacy command transport/server matches;
- repository-wide `1421` may still appear in `apps/game/vite.config.ts` for HMR.

### Deterministic tests

```bash
bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
bun run --cwd apps/game test src/lib/persistence/commands.test.ts
bun run --cwd apps/game test src/routes/page.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run test
bun run check
bun run lint:all
```

### Cross-layer proof

Reuse existing packaged suites:

```bash
bun run --cwd apps/game test:e2e:smoke
node apps/game/scripts/run-save-e2e.mjs --suite save-core
```

No new E2E suite.

## Acceptance criteria

- Gameplay has one command transport: Tauri `invoke()`.
- `listScenes()` has no separate HTTP branch.
- Persistence has one command transport: Tauri `invoke()`.
- `invokePersistenceCommand()` / `asGameError()` remain the typed persistence boundary.
- Existing binary thumbnail Tauri command shape remains unchanged.
- `dev_engine_server.rs` and `dev-engine-server` feature are deleted.
- Server-only development dispatch APIs/tests are removed, not renamed.
- Mixed Rust parity tests retain their direct core assertions before HTTP halves are deleted.
- `request_origin_forbidden` and its constructor-code table row are deleted together.
- `codecov.yml` no longer claims the deleted server provides coverage; the `lib.rs` ignore remains.
- Vite HMR port `1421` remains intact.
- Frontend tests mock Tauri IPC directly rather than URLs/fetch.
- Existing smoke + save-core packaged verification stays green.
- Implementation is a material net deletion.
- No replacement transport abstraction, mock server, RPC layer, thumbnail decision, save-coordinator refactor, or Chapter 2 work is introduced.
