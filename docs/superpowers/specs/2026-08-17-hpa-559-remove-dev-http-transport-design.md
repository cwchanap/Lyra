# HPA-559 Remove Legacy Browser HTTP Game-Engine Fallback

**Date:** 2026-08-17  
**Status:** Approved design, revised after third review  
**Target baseline:** current `main` after HPA-621 / PR #62

## Goal

Reduce Lyra to one supported application command path:

```text
Svelte client → Tauri invoke → Rust application facade
```

Delete the browser HTTP game-engine fallback rather than hiding it behind another interface.

This is not a gameplay-feature change, but it is more than cosmetic cleanup: part of the alternate Rust command surface is currently **unconditionally compiled into `lyra_lib`**, so HPA-559 removes shipped library API/runtime surface as well as developer-only frontend branching.

Supported loops remain:

- `bun run dev:game` for the real Tauri app;
- Vitest/jsdom and component harnesses for browser-side UI iteration;
- packaged Tauri/WebDriver suites for real IPC, filesystem, and gameplay verification.

## Why HPA-559 is actionable now

HPA-559 has no blocker and removes infrastructure outside the supported development path.

Do not pull forward post-playtest work:

- HPA-550 still needs real Save/Load/Continue playtest evidence before deciding thumbnail behavior.
- HPA-521 should wait for HPA-550 rather than preserve machinery that may disappear.
- HPA-536 remains post-playtest release hardening.
- HPA-602 is an explicitly deferred two-raster visual follow-up.
- Chapter 2 remains deferred.

PR #61 deliberately retained the HTTP fallback and named HPA-559 as its owner.

## Current-state survey

### Supported development already uses Tauri

The normal loop is:

```text
bun run dev:game
  → game frontend + Tauri dev
```

Packaged WebDriver suites own real cross-layer proof. No live root/package script or CI job launches `dev_engine_server` as the normal workflow.

### Gameplay client still owns two transports

`apps/game/src/lib/state/game-client.svelte.ts` currently contains:

- `isTauri` runtime detection;
- `DEV_HTTP_BASE = "http://127.0.0.1:1421"`;
- `httpInvoke()`;
- a Tauri-vs-HTTP branch in `runCommand()`;
- a second Tauri-vs-HTTP branch in `listScenes()`.

Both branches must disappear.

### Persistence client duplicates the choice

`apps/game/src/lib/persistence/commands.ts` independently owns:

- another Tauri runtime check;
- another HTTP base;
- JSON fetch/error parsing;
- binary thumbnail HTTP submit/read behavior;
- Tauri-vs-HTTP branching.

Keep the meaningful wrappers:

- `asGameError()` owns structured error normalization, including `failureToken`.
- `invokePersistenceCommand()` remains the shared persistence error boundary.
- the existing three-argument Tauri `submit_save_thumbnail` invocation owns binary/header IPC semantics.

Delete only the alternate transport.

### The Rust alternate dispatch ships even though the example is dev-gated

The gate is on `examples/dev_engine_server.rs`, not on the library surface it imports.

These current `lib.rs` symbols have no `#[cfg]` gate and are compiled into normal `lyra_lib` builds:

- `DevelopmentCommandResponse`;
- `build_development_app_state`;
- `DevelopmentExitDriver`;
- `dispatch_development_command`;
- `dispatch_development_command_with_exit`;
- the large development command string router and its JSON/body helpers.

Therefore deletion reduces the shipped Rust library surface, not merely an optional example binary.

### Rust owns a complete second runtime

`apps/game/src-tauri/examples/dev_engine_server.rs` owns:

- raw TCP listening;
- HTTP request/header parsing;
- duplicate `Content-Length` / `Origin` handling;
- CORS policy;
- request-size limits;
- response encoding;
- thumbnail-specific binary handling;
- a separate Tokio runtime;
- a development command string router;
- parser/CORS/response tests.

`apps/game/src-tauri/Cargo.toml` exposes `dev-engine-server` only for this runtime.

### The example also forces unnecessary public Rust API

The example imports several library items that otherwise do not need external visibility.

Known cleanup when the example is deleted:

- delete `MAX_THUMBNAIL_SUBMISSION_BYTES`, a public alias used only by the example;
- narrow `RawThumbnailHeader` from `pub` to `pub(crate)`;
- narrow `RawThumbnailHeader::new` from `pub` to `pub(crate)`;
- narrow `validate_thumbnail_submission` from `pub` to `pub(crate)`.

Use the example's `use lyra_lib::{ ... }` block as the final checklist for any additional item made public only for the example. Do not narrow unrelated API merely to increase deletion counts.

### Existing application pieces are reusable

Do not rebuild infrastructure while deleting it:

- `build_development_app_state` is a passthrough to `build_app_state_with_storage`; delete the wrapper and keep the shared builder.
- `DevelopmentExitDriver` has no need to survive; existing exit tests already own a `RecordingExit` `ApplicationExit` double.
- `task_11_commands_are_registered_once_with_the_existing_application_surface` already validates the surviving Tauri `generate_handler!` registration list. Therefore deleting the HTTP-only `command_surface_contract` does **not** require a replacement registration guard.
- shared Tauri command cores, persistence storage, thumbnail validation, exit behavior, and E2E checkpoints remain the real owners.

### Page tests rely heavily on the old transport

`apps/game/src/routes/page.test.ts` already mocks `@tauri-apps/api/core`, but many current fixtures still feed commands through `mocks.fetch`, HTTP response helpers, and URL/body parsing.

Migration order is load-bearing:

```text
1. gameplay client + focused tests
2. persistence client + focused tests
3. page-test fixture conversion
```

Within page-test migration, convert call sites **before** deleting `mocks.fetch` / `jsonResponse` / `jsonError`. Keeping the old mock declaration until the last step prevents the file from becoming structurally broken while its many sites are still being rewritten.

### Port 1421 has an unrelated valid owner

`apps/game/vite.config.ts` uses port `1421` for Vite HMR when `TAURI_DEV_HOST` is set.

That is not the command server. HPA-559 removes `127.0.0.1:1421` command transport usage without removing or renumbering the HMR port.

### `codecov.yml` is live config

The current Codecov comment says `lib.rs` dispatch/arg handling is covered by `dev_engine_server`. That becomes false after deletion.

Keep the `lib.rs` ignore rule. Rewrite only the stale comment: deterministic business behavior is covered by core/unit tests and real IPC integration by packaged Tauri E2E.

### Historical planning records stay historical

Old `docs/superpowers/**` files may mention the fallback because it existed when written. Do not rewrite them for chronology.

## Architecture decision

### Selected: direct Tauri-only clients + deletion

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
- `dev-engine-server` feature;
- server-only development dispatch types/functions/tests;
- public visibility that existed only for the example.

### Rejected: one-implementation transport abstraction

Do not create `GameTransport`, `invokeGameCommand`, an adapter registry, local RPC layer, or mock HTTP server. Vitest already mocks `@tauri-apps/api/core.invoke` directly.

### Rejected: retain the server for hypothetical browser tooling

Keeping it would preserve parser, CORS, binary framing, second runtime, and parity maintenance for no current essential workflow.

## Frontend behavior

### Gameplay

Keep `game-client.svelte.ts` ownership and behavior for:

- in-flight fencing;
- loading/error state;
- `GameplayCommandResultView` application;
- thumbnail follow-up;
- SFX inference;
- Analysis action tokens;
- scene navigation;
- E2E checkpoints.

Change only transport:

- `runCommand()` calls Tauri `invoke()` directly.
- `listScenes()` calls `invoke<SceneNavigationIndex>("list_scenes")` inside its existing local try/catch.

### Persistence

Keep:

- `asGameError()`;
- `invokePersistenceCommand()`;
- exact binary thumbnail Tauri invocation shape;
- public helper signatures.

Remove:

- runtime Tauri detection;
- development HTTP assertion/error helpers;
- JSON HTTP invocation;
- HTTP thumbnail submit/read paths.

### Accepted browser-only development tradeoff

After deletion, manually opening the Vite URL in an ordinary browser no longer receives the friendly `"Tauri runtime unavailable"` fallback diagnostic. A direct Tauri `invoke()` failure may be less polished.

Accept this for HPA-559. The supported real-app loop is Tauri, component tests mock `invoke()` directly, and no transport shim or special browser-runtime abstraction is justified solely to preserve that message. If this becomes a recurring developer pain point, handle it later as a one-place diagnostic improvement.

## Rust deletion boundary

Delete:

- `apps/game/src-tauri/examples/dev_engine_server.rs`;
- Cargo feature `dev-engine-server`;
- `DevelopmentCommandResponse`;
- `DevelopmentExitDriver`;
- `build_development_app_state`;
- `development_json`;
- `parse_development_body`;
- `dispatch_development_command`;
- `dispatch_development_command_with_exit`;
- the development command string router/response glue;
- `MAX_THUMBNAIL_SUBMISSION_BYTES`.

Narrow:

- `RawThumbnailHeader` → `pub(crate)`;
- `RawThumbnailHeader::new` → `pub(crate)`;
- `validate_thumbnail_submission` → `pub(crate)`.

Keep:

- `build_app_state_with_storage`;
- Tauri command/core functions;
- thumbnail validation/storage behavior;
- save/load application persistence;
- exit lifecycle core;
- packaged E2E checkpoints/fault behavior;
- `RecordingExit` and other surviving core test helpers;
- `task_11_commands_are_registered_once_with_the_existing_application_surface` as the Tauri registration guard.

Do not use HPA-559 to decompose `lib.rs` or refactor the save coordinator.

## Rust test preservation rule

Do not delete tests wholesale merely because their current names contain HTTP.

| Current test | Keep as direct core coverage | Delete with HTTP adapter |
|---|---|---|
| `tauri_core_and_http_adapter_return_identical_raw_request_errors` | assert `submit_save_thumbnail_core` rejects missing and duplicate ticket headers with `stale_thumbnail_ticket` | HTTP comparison |
| `exit_lifecycle_getter_event_and_http_share_complete_status_and_error_views` | getter/event payload parity + `cancel_exit_core` wrong-token rejection | HTTP response/error comparison + `DevelopmentExitDriver` |
| `thumbnail_read_returns_exact_bytes_and_rejects_stale_observed_identity` | exact bytes + stale observed-save identity from `read_save_thumbnail_core` | HTTP `image/png` response half |
| `development_http_adapter_serializes_the_shared_wrapper_and_save_views` | nothing | whole test |
| `development_http_dispatch_registers_the_complete_task_11_surface` | nothing | whole test |
| `command_surface_contract` | nothing | whole module; surviving Tauri registration remains covered by `task_11_commands_are_registered_once_with_the_existing_application_surface` |

The first split also strengthens coverage: current parity only checks equality between two paths; the retained test should assert the concrete `stale_thumbnail_ticket` error.

## HTTP-only error cleanup

Delete `GameError::request_origin_forbidden()` with its `"requestOriginForbidden"` row in `uncovered_error_constructors_return_their_exact_codes`.

Use a final usage search. Do not preserve dead constructors to satisfy a table.

## Test architecture after deletion

- Gameplay/source tests mock `invoke()` directly and cover both `runCommand()` and `listScenes()` without `__TAURI_INTERNALS__`.
- Persistence tests import normally, mock `invoke()`, and retain structured-error + binary IPC assertions.
- Page tests use the existing `mocks.invoke` seam and no longer parse command URLs/bodies.
- Rust deletes parser/CORS/HTTP/string-router tests that have no surviving core assertion and keeps direct command-core coverage from the table above.

## Implementation order

```text
Task 1 — gameplay client + focused tests
Task 2 — persistence client + focused tests
Task 3 — page tests, convert call sites first and delete fetch helpers last
Task 4 — Rust server/dispatch/public-API deletion + core-test preservation
Task 5 — live config cleanup + full verification
```

Do not claim the full frontend suite until Task 3 is complete.

## Verification

### Static absence

```bash
rg -n 'DEV_HTTP_BASE|developmentHttpBase|httpInvoke|127\.0\.0\.1:1421' apps/game/src
rg -n 'dev_engine_server|dev-engine-server' apps/game/src-tauri apps/game/package.json package.json codecov.yml
rg -n 'MAX_THUMBNAIL_SUBMISSION_BYTES|DevelopmentCommandResponse|DevelopmentExitDriver|build_development_app_state|dispatch_development_command' apps/game/src-tauri
```

Expected: no retired command-server surface. `apps/game/vite.config.ts` may still contain HMR port `1421`.

### Rust/default and all-feature proof

Run both because the deleted dispatch family is currently compiled in normal library builds:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Then:

```bash
bun run test
bun run check
bun run lint:all
```

### Cross-layer proof

Reuse:

```bash
bun run --cwd apps/game test:e2e:smoke
node apps/game/scripts/run-save-e2e.mjs --suite save-core
```

No new suite.

## Acceptance criteria

- Gameplay and `listScenes()` have one transport: Tauri `invoke()`.
- Persistence has one transport while `invokePersistenceCommand()` / `asGameError()` remain.
- Existing binary thumbnail Tauri shape remains unchanged.
- `dev_engine_server.rs` and `dev-engine-server` are deleted.
- Unconditionally compiled development dispatch/string-router API is deleted from `lyra_lib`.
- `MAX_THUMBNAIL_SUBMISSION_BYTES` is deleted.
- `RawThumbnailHeader`, its constructor, and `validate_thumbnail_submission` are crate-private after the example disappears.
- Mixed parity tests preserve direct core assertions; HTTP-only tests/modules are deleted.
- The surviving Tauri registration guard remains; no replacement registration machinery is added.
- `request_origin_forbidden` and its constructor-table row are deleted together.
- `codecov.yml` keeps the `lib.rs` ignore but no longer cites the server.
- Vite HMR port `1421` remains.
- Page tests convert call sites before deleting fetch fixtures/helpers.
- Both default-feature and all-feature Rust tests pass.
- Existing smoke + save-core packaged verification passes.
- Implementation is a material net deletion.
- No `GameTransport`, HTTP test harness, local RPC, thumbnail decision, save-coordinator refactor, E2E-policy rewrite, HPA-602 work, or Chapter 2 work is introduced.
