# HPA-559 Remove Legacy Browser HTTP Game-Engine Fallback

**Date:** 2026-08-17  
**Status:** Proposed design for implementation  
**Target baseline:** current `main` after HPA-621 / PR #62

## Goal

Reduce Lyra to one supported application command path:

```text
Svelte client → Tauri invoke → Rust application facade
```

Delete the developer-only browser HTTP game-engine fallback rather than preserving it behind another interface.

This is a maintenance simplification, not a gameplay change. The result should materially reduce production/test code while keeping the workflows the project actually uses today:

- `bun run dev:game` for the real application;
- Vitest/jsdom and component harnesses for browser-side UI iteration;
- packaged Tauri/WebDriver suites for cross-layer IPC, filesystem, and gameplay verification.

## Why this is the next actionable slice

The current Chapter 1 product loop has just completed the HPA-621 workbench redesign. The remaining post-playtest tickets are intentionally gated:

- HPA-550 requires real Save/Load/Continue playtest evidence before deciding thumbnail behavior;
- HPA-521 should not preserve or refactor thumbnail machinery before HPA-550 resolves it;
- HPA-536 is release hardening and is explicitly blocked by HPA-550 and the post-playtest architecture decisions.

HPA-559 has no blocker and removes infrastructure that is already outside the supported development path. PR #61 also intentionally kept the HTTP fallback in place and named HPA-559 as its owner.

HPA-602 is also technically actionable, but it is a deliberately deferred two-raster visual-continuity follow-up. HPA-559 provides a larger maintenance win without making Chapter 2 commitments or hardening unstable product decisions.

## Current-state survey

### Supported development and validation already use Tauri

The root `package.json` defines:

```text
bun run dev:game
  → turbo dev:frontend + dev:tauri for @lyra/game
```

`apps/game/package.json` owns `dev:tauri`, packaged WebDriver suites, and the existing smoke/save/gameplay journeys. There is no current root script that launches `dev_engine_server` as the normal development path.

### Gameplay client still has two transports

`apps/game/src/lib/state/game-client.svelte.ts` currently owns:

- `isTauri` detection through `window.__TAURI_INTERNALS__`;
- `DEV_HTTP_BASE = "http://127.0.0.1:1421"`;
- a local `httpInvoke()` implementation;
- runtime branching between `invoke()` and `httpInvoke()`.

That means every gameplay command still carries a transport decision even though the supported application runtime is Tauri.

### Persistence client duplicates the same decision

`apps/game/src/lib/persistence/commands.ts` independently owns:

- another `isTauri` check;
- another HTTP base;
- JSON fetch/error parsing;
- binary thumbnail submit/read HTTP behavior;
- runtime branching between Tauri IPC and HTTP.

This is a second copy of the same obsolete transport choice, including a custom binary path that has to stay in sync with Tauri command semantics.

### Rust owns an entire second runtime

`apps/game/src-tauri/examples/dev_engine_server.rs` is not a thin launcher. It owns:

- raw TCP listening on `127.0.0.1:1421`;
- HTTP request-line and header parsing;
- duplicate `Content-Length` / `Origin` handling;
- CORS policy;
- request-size limits;
- JSON and binary response encoding;
- thumbnail-specific header/body handling;
- a separate Tokio runtime;
- a development `AppState` / exit driver dispatch path;
- parser/CORS/response tests.

`apps/game/src-tauri/Cargo.toml` also exposes the `dev-engine-server` feature solely for this runtime.

### Frontend tests currently depend on the fallback by accident

`apps/game/src/routes/page.test.ts` runs without `__TAURI_INTERNALS__`, so it stubs global `fetch()` and reconstructs `http://127.0.0.1:1421/<command>` behavior even though `@tauri-apps/api/core` is already mocked in the same test file.

`apps/game/src/lib/state/game-client-source.test.ts` and `apps/game/src/lib/persistence/commands.test.ts` explicitly install fake `window.__TAURI_INTERNALS__` state before importing modules so they exercise the Tauri branch.

After HPA-559, tests should mock the real production boundary directly: `@tauri-apps/api/core.invoke`.

### Port 1421 has one unrelated valid owner

`apps/game/vite.config.ts` uses port `1421` for Vite HMR when `TAURI_DEV_HOST` is set.

That is **not** the legacy game-engine HTTP server. HPA-559 must remove `127.0.0.1:1421` game-command usage without deleting or changing the HMR port merely because the number matches.

### Historical planning documents are historical

Older design/plan documents mention the browser fallback because it existed when those plans were written. They are not current contributor instructions.

Do not rewrite historical specs just to make old decisions read as if HPA-559 had already happened. Only active developer/agent instructions should be changed if the implementation survey finds a live instruction that still requires the HTTP server.

## Approaches considered

### Approach A — direct Tauri-only clients and delete the server — selected

Keep the current frontend ownership boundaries but remove their transport branching:

- gameplay client calls `invoke()` directly;
- persistence commands call `invoke()` directly;
- Rust retains the application/core functions used by Tauri commands, but deletes server-only wrappers and development dispatch types;
- tests mock `invoke()` directly.

**Why selected**

- smallest production architecture;
- maximum deletion;
- no new abstraction for one runtime;
- aligns with actual development/E2E workflows;
- preserves command names and application semantics without inventing compatibility requirements before release.

### Approach B — introduce a `GameTransport` / injected command adapter — rejected

Create a frontend transport interface with Tauri as the only production implementation and inject a fake implementation in tests.

**Why rejected**

The abstraction would exist primarily to preserve a choice the product no longer has. Vitest can already mock `@tauri-apps/api/core.invoke`; adding a transport interface would trade one obsolete branch for permanent adapter plumbing.

### Approach C — keep the HTTP server but isolate it from production clients — rejected

Remove runtime branching from production code but retain the server as an optional browser automation tool.

**Why rejected**

The server still carries the largest maintenance cost: custom parser, CORS, binary framing, second runtime, tests, and application dispatch wrappers. No current essential workflow has been found that justifies it. If a future browser-only Rust-driving workflow becomes valuable, it should be justified then rather than kept speculatively now.

## Architecture

### Frontend gameplay boundary

`game-client.svelte.ts` remains the gameplay orchestration owner. Only the transport choice disappears.

Before:

```text
runCommand
  ├─ Tauri → invoke(command, args)
  └─ browser dev → fetch(127.0.0.1:1421)
```

After:

```text
runCommand
  └─ invoke(command, args)
```

Keep unchanged:

- in-flight command fencing;
- loading/error state;
- `GameplayCommandResultView` application;
- thumbnail capture follow-up;
- SFX inference;
- Analysis action-token behavior;
- scene navigation semantics;
- E2E checkpoint behavior.

Do not introduce `invokeGameCommand()`, `GameTransport`, or an environment switch solely to wrap one call site unless an existing helper already owns meaningful semantics beyond transport.

### Frontend persistence boundary

`persistence/commands.ts` remains the typed persistence command boundary and error-normalization owner.

Keep:

- `asGameError()`;
- `invokePersistenceCommand()` as the shared structured-error wrapper;
- exact binary thumbnail Tauri command shapes;
- public helpers such as `getPersistenceStatus()`, `submitSaveThumbnail()`, and `readSaveThumbnail()`.

Remove:

- Tauri detection;
- development HTTP assertions;
- HTTP JSON helpers;
- HTTP error decoding;
- HTTP thumbnail submit/read helpers.

`invokePersistenceCommand()` should become one Tauri `invoke()` call wrapped by `asGameError()`.

### Rust application boundary

Delete `apps/game/src-tauri/examples/dev_engine_server.rs` and the Cargo feature that exists only to compile it.

In `apps/game/src-tauri/src/lib.rs`, remove server-only public/development dispatch surface after verifying each symbol has no non-server caller. The expected server-only family includes:

- `DevelopmentCommandResponse`;
- `DevelopmentExitDriver`;
- `build_development_app_state`;
- `dispatch_development_command` / `dispatch_development_command_with_exit` and their command-name switch;
- tests whose only purpose is proving development HTTP dispatch parity.

Do **not** delete shared Tauri command cores, application persistence logic, thumbnail validation, save storage, exit behavior, or E2E checkpoint functions merely because the HTTP server called them too.

The desired end state is not a new Rust facade. It is the existing Tauri command/core ownership minus the alternate server adapter.

### Error behavior

Gameplay error behavior remains unchanged from the player's perspective:

- a Tauri command rejection is normalized by `game-client.svelte.ts` into `gameState.error`;
- persistence errors continue through `asGameError()` so typed `code`, `message`, and optional `failureToken` are preserved.

HTTP-specific parse failures, CORS failures, malformed request handling, and status-code translation disappear because no HTTP command surface remains.

### Test architecture

Tests should follow the production boundary, not emulate the deleted transport.

#### Gameplay source/controller tests

Mock `@tauri-apps/api/core.invoke` directly. Remove setup whose only purpose is installing `window.__TAURI_INTERNALS__`.

Add/retain a regression proving a gameplay command still calls the expected Tauri command and applies the returned wrapped state when `__TAURI_INTERNALS__` is absent in jsdom. This proves HPA-559 does not accidentally make test/runtime dispatch depend on a browser global.

#### Page tests

Replace `fetch()` stubs and URL parsing with `mocks.invoke` command dispatch. Existing page behavior assertions stay the same.

The test should describe application commands, not an HTTP URL.

#### Persistence command tests

Import `commands.ts` normally. No fake Tauri global should be required.

Retain binary-shape and structured-error assertions against mocked `invoke()`.

#### Rust tests

Delete tests embedded in `dev_engine_server.rs` and any `lib.rs` tests that solely validate development-command switching/HTTP adapter behavior.

Do not recreate parser/CORS/request-size tests elsewhere. The feature is deleted, so its tests should be deleted with it.

## Implementation scope

Expected production changes:

- Modify `apps/game/src/lib/state/game-client.svelte.ts`.
- Modify `apps/game/src/lib/persistence/commands.ts`.
- Delete `apps/game/src-tauri/examples/dev_engine_server.rs`.
- Modify `apps/game/src-tauri/Cargo.toml`.
- Modify `apps/game/src-tauri/src/lib.rs` to remove server-only development dispatch surface.

Expected test changes:

- Modify `apps/game/src/lib/state/game-client-source.test.ts`.
- Modify `apps/game/src/lib/persistence/commands.test.ts`.
- Modify `apps/game/src/routes/page.test.ts`.
- Delete server-only Rust tests with the server/dispatch code that owned them.

Documentation/config changes are conditional on the implementation-time search:

- do not edit `apps/game/vite.config.ts` HMR port `1421`;
- do not rewrite historical design/plan records;
- update a current README/agent/contributor instruction only if it still tells developers to run the legacy server.

## Verification

### Static absence checks

The implementation must prove:

```bash
rg -n 'DEV_HTTP_BASE|developmentHttpBase|httpInvoke|127\.0\.0\.1:1421' apps/game/src
rg -n 'dev_engine_server|dev-engine-server' apps/game/src-tauri apps/game/package.json package.json
```

Expected: no legacy command-transport/server owner remains.

A repository-wide search for `1421` may still report `apps/game/vite.config.ts`; that HMR use is expected and must remain.

### Deterministic tests

Run:

```bash
bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
bun run --cwd apps/game test src/lib/persistence/commands.test.ts
bun run --cwd apps/game test src/routes/page.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run check
bun run lint:all
```

### Cross-layer proof

Because the deleted feature is a transport/runtime boundary, keep packaged proof small but real:

```bash
bun run --cwd apps/game test:e2e:smoke
node apps/game/scripts/run-save-e2e.mjs --suite save-core
```

If the smoke build already exists in the same implementation session, do not rebuild solely to run the second suite; reuse the built packaged app.

No new E2E suite is needed.

## Acceptance criteria

- Production gameplay commands have exactly one transport path: Tauri `invoke()`.
- Production persistence commands have exactly one transport path: Tauri `invoke()`.
- `apps/game/src-tauri/examples/dev_engine_server.rs` is deleted.
- `dev-engine-server` Cargo feature is deleted.
- Server-only development dispatch types/functions/tests are removed rather than renamed.
- No production frontend code calls `http://127.0.0.1:1421`.
- Tests mock Tauri IPC directly and no longer need fake `__TAURI_INTERNALS__` solely to select a branch.
- The unrelated Vite HMR port `1421` remains intact.
- Supported Tauri development, component/unit tests, and packaged smoke/save-core verification remain green.
- Production + test line count is materially reduced.
- No replacement transport interface, mock server, local RPC framework, or compatibility shim is added.

## Non-goals

- No gameplay, scene, story, Analysis, interrogation, or Case File behavior change.
- No save schema or persistence coordinator refactor.
- No HPA-550 thumbnail product decision; current thumbnail behavior stays as-is.
- No HPA-521 coordination simplification.
- No HPA-560 E2E-policy rewrite.
- No Chapter 2 work.
- No generic transport abstraction.
- No effort to preserve browser-only real-Rust command dispatch before release.
