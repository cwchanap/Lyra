# HPA-559 Remove Legacy Browser HTTP Game-Engine Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remove Lyra's developer-only browser HTTP game-engine transport so gameplay and persistence commands have one production path through Tauri IPC.

**Architecture:** keep the existing gameplay and persistence client ownership, delete their environment-based transport branches, and call `@tauri-apps/api/core.invoke` directly. Delete the standalone Rust HTTP server and only the development-dispatch surface that exists for it; preserve shared Tauri command cores and split mixed parity tests so their command-core assertions survive.

**Tech Stack:** Svelte 5 / TypeScript, Vitest + jsdom, Tauri 2 IPC, Rust, Cargo, existing WebdriverIO packaged E2E.

**Spec:** `docs/superpowers/specs/2026-08-17-hpa-559-remove-dev-http-transport-design.md`

## Global Constraints

- Production command flow after this work is exactly `Svelte client → Tauri invoke → Rust application facade`.
- Do not introduce `GameTransport`, `invokeGameCommand`, an adapter registry, local RPC, a mock HTTP server, or another one-implementation abstraction.
- Keep gameplay, save/load, acquisition, thumbnail, Analysis, interrogation, Case File, audio, and exit semantics unchanged.
- Keep `invokePersistenceCommand()` / `asGameError()` and the current three-argument binary thumbnail Tauri invocation.
- Do not make the HPA-550 thumbnail product decision.
- Do not perform HPA-521 save-coordinator simplification or HPA-560 E2E-policy restructuring.
- Do not preserve the browser transport for backward compatibility; Lyra has no released browser consumer.
- Do not rewrite historical `docs/superpowers/**` files just because they mention the old fallback.
- Keep `apps/game/vite.config.ts` HMR port `1421`; it is not the command server.
- Delete HTTP parser/CORS/server/string-router tests only when they have no surviving core assertion.
- Split mixed Rust HTTP-parity tests before deletion so command-core coverage is retained.
- Reuse the existing packaged smoke and save-core suites; do not add an HPA-559 E2E suite.
- Do not run or claim the full page/frontend suite between Tasks 1 and 2/3 while page fixtures still target the old HTTP path; use each task's focused tests until Task 3 completes.

---

## File Map

### Production/config files

| File | HPA-559 action |
|---|---|
| `apps/game/src/lib/state/game-client.svelte.ts` | Remove both gameplay HTTP branches: `runCommand()` and `listScenes()`. |
| `apps/game/src/lib/persistence/commands.ts` | Remove JSON and binary HTTP paths; keep typed Tauri wrappers. |
| `apps/game/src-tauri/examples/dev_engine_server.rs` | Delete. |
| `apps/game/src-tauri/Cargo.toml` | Delete `dev-engine-server` feature. |
| `apps/game/src-tauri/src/lib.rs` | Delete development-server dispatch surface; retain Tauri cores and split mixed tests. |
| `apps/game/src-tauri/src/game/error.rs` | Delete `request_origin_forbidden` and its constructor-code test row after server deletion. |
| `codecov.yml` | Keep `lib.rs` ignore; rewrite stale comment mentioning `dev_engine_server`. |

### Frontend tests

| File | HPA-559 action |
|---|---|
| `apps/game/src/lib/state/game-client-source.test.ts` | Mock Tauri invoke directly without fake `__TAURI_INTERNALS__`; cover `listScenes()`. |
| `apps/game/src/lib/persistence/commands.test.ts` | Import normally and assert direct Tauri error/binary shapes. |
| `apps/game/src/routes/page.test.ts` | Replace fetch/URL command fixtures with existing `mocks.invoke`. |

### Explicit non-change

- `apps/game/vite.config.ts`: keep HMR port `1421` exactly as-is.

---

## Execution Order

The sequence is intentional:

```text
Task 1 — gameplay client + focused tests
Task 2 — persistence client + focused tests
Task 3 — page tests migrate from fetch to invoke
Task 4 — Rust server/dispatch deletion + core-test preservation
Task 5 — live config cleanup + full verification
```

`page.test.ts` currently drives both gameplay and persistence through the browser fallback. If Task 3 is attempted before Task 2, persistence calls still use `fetch()` after the page fetch fixtures are removed. Do not bridge that mistake by restoring `__TAURI_INTERNALS__`, a fetch shim, or another transport helper.

---

### Task 1: Make gameplay and scene-index commands Tauri-only

**Files:**
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`

**Interfaces:**
- Consumes: `invoke<T>(command, args)` from `@tauri-apps/api/core`.
- Produces: unchanged public gameplay client API and scene-navigation error behavior.

- [ ] **Step 1: Remove fake Tauri-global setup from the focused client test loader**

Change `loadGameClient()` in `game-client-source.test.ts` to import the module without defining `window.__TAURI_INTERNALS__`:

```ts
async function loadGameClient(
  initialState: GameStateView | null = state("initial"),
): Promise<GameClientModule> {
  const client = await import("./game-client.svelte");
  client.gameState.value = initialState;
  client.gameState.error = null;
  client.gameState.loading = false;
  client.gameState.inFlight = false;
  return client;
}
```

Remove the `afterEach` `Reflect.deleteProperty(window, "__TAURI_INTERNALS__")` once no test creates the property.

- [ ] **Step 2: Add a failing no-global gameplay regression**

Add:

```ts
it("dispatches gameplay commands through Tauri invoke without a runtime global", async () => {
  const previous = state("previous");
  const next = state("next");
  const client = await loadGameClient(previous);

  expect("__TAURI_INTERNALS__" in window).toBe(false);
  mocks.invoke.mockResolvedValueOnce(next);

  await client.inspectHotspot("receipt");

  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("inspect_hotspot", {
    hotspotId: "receipt",
  });
  expect(client.gameState.value?.scene.id).toBe(next.scene.id);
});
```

- [ ] **Step 3: Strengthen the existing `listScenes()` test to assert the Tauri command**

The file already has a `listScenes()` fixture. Keep that fixture and add the exact transport assertion:

```ts
await expect(client.listScenes()).resolves.toEqual(index);
expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("list_scenes");
```

The test must run without `__TAURI_INTERNALS__`.

- [ ] **Step 4: Run RED**

```bash
bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected on the pre-change source: the no-global tests select `httpInvoke()` instead of `mocks.invoke` and fail.

- [ ] **Step 5: Delete gameplay HTTP transport declarations and helper**

Delete from `game-client.svelte.ts`:

```ts
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const DEV_HTTP_BASE = "http://127.0.0.1:1421";
```

Delete the complete `httpInvoke<T>()` function.

- [ ] **Step 6: Convert `runCommand()` to direct Tauri invoke**

Replace:

```ts
return isTauri
  ? await invoke<T>(command, args)
  : await httpInvoke<T>(command, args);
```

with:

```ts
return await invoke<T>(command, args);
```

Keep its existing local error normalization unchanged.

- [ ] **Step 7: Convert `listScenes()` too**

Replace its second transport branch with:

```ts
try {
  return await invoke<SceneNavigationIndex>("list_scenes");
} catch {
  return null;
}
```

Keep the existing reason for the local try/catch: scene-navigation errors stay on the panel-local surface rather than `gameState.error`.

- [ ] **Step 8: Run GREEN for the focused gameplay client**

```bash
bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected: PASS.

Do not run `page.test.ts` yet; it still contains HTTP fixtures and is intentionally migrated in Task 3.

- [ ] **Step 9: Prove the gameplay HTTP branch is gone**

```bash
rg -n 'DEV_HTTP_BASE|httpInvoke|127\.0\.0\.1:1421|__TAURI_INTERNALS__|return isTauri' \
  apps/game/src/lib/state/game-client.svelte.ts \
  apps/game/src/lib/state/game-client-source.test.ts
```

Expected: no matches.

- [ ] **Step 10: Commit Task 1**

```bash
git add \
  apps/game/src/lib/state/game-client.svelte.ts \
  apps/game/src/lib/state/game-client-source.test.ts
git commit -m "refactor(game): use Tauri-only gameplay commands"
```

---

### Task 2: Make persistence and thumbnail commands Tauri-only

**Files:**
- Modify: `apps/game/src/lib/persistence/commands.ts`
- Modify: `apps/game/src/lib/persistence/commands.test.ts`

**Interfaces:**
- Consumes: Tauri `invoke<T>()`.
- Produces: unchanged persistence helper signatures, `asGameError()` behavior, and binary thumbnail IPC shape.

- [ ] **Step 1: Make persistence tests import without a fake Tauri runtime global**

Change:

```ts
async function loadCommands() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  return import("./commands");
}
```

into:

```ts
async function loadCommands() {
  return import("./commands");
}
```

Remove the matching `afterEach` property deletion when nothing else creates it.

- [ ] **Step 2: Add a failing direct-invoke regression**

Add:

```ts
it("invokes Tauri directly without a runtime global", async () => {
  const commands = await loadCommands();
  mocks.invoke.mockResolvedValueOnce({ type: "idle" });

  expect("__TAURI_INTERNALS__" in window).toBe(false);
  await expect(commands.getThumbnailActivity()).resolves.toEqual({ type: "idle" });

  expect(mocks.invoke).toHaveBeenCalledWith("get_thumbnail_activity", undefined);
});
```

If the existing Tauri mock records a one-argument call when `args` is `undefined`, assert that exact current call shape instead; do not add an adapter to normalize the mock.

- [ ] **Step 3: Run RED**

```bash
bun run --cwd apps/game test src/lib/persistence/commands.test.ts
```

Expected on the pre-change source: the no-global import selects the HTTP fallback and the new Tauri assertion fails.

- [ ] **Step 4: Delete JSON HTTP transport support**

Delete from `commands.ts`:

```ts
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const developmentHttpBase = "http://127.0.0.1:1421";
```

Delete the complete functions:

- `assertDevelopmentFallback()`;
- `throwHttpError()`;
- `developmentJson<T>()`.

- [ ] **Step 5: Keep `invokePersistenceCommand()` as the typed error wrapper**

Use:

```ts
export async function invokePersistenceCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw asGameError(error);
  }
}
```

Do not inline `asGameError()` into every public helper.

- [ ] **Step 6: Keep the production binary thumbnail submit call exactly on Tauri**

`submitSaveThumbnail()` retains:

```ts
return await invoke<ThumbnailActivityView>(
  "submit_save_thumbnail",
  bytes,
  { headers: { [thumbnailTicketHeader]: ticket } },
);
```

Delete only the HTTP `fetch()` branch.

- [ ] **Step 7: Make thumbnail reads Tauri-only**

Use:

```ts
const response = await invoke<ArrayBuffer | Uint8Array>(
  "read_save_thumbnail",
  { reference, observedSaveId },
);
```

Keep the current `Uint8Array` / `ArrayBuffer` normalization and `thumbnailCorrupt` error. Delete `readDevelopmentThumbnail()`.

- [ ] **Step 8: Run GREEN for focused persistence tests**

```bash
bun run --cwd apps/game test src/lib/persistence/commands.test.ts
```

Expected: PASS, including the current three-argument thumbnail invocation assertion and structured error tests.

- [ ] **Step 9: Prove persistence HTTP support is gone**

```bash
rg -n 'developmentHttpBase|assertDevelopmentFallback|throwHttpError|developmentJson|readDevelopmentThumbnail|fetch\(|127\.0\.0\.1:1421|__TAURI_INTERNALS__|return isTauri' \
  apps/game/src/lib/persistence/commands.ts \
  apps/game/src/lib/persistence/commands.test.ts
```

Expected: no matches.

- [ ] **Step 10: Commit Task 2**

```bash
git add \
  apps/game/src/lib/persistence/commands.ts \
  apps/game/src/lib/persistence/commands.test.ts
git commit -m "refactor(save): use Tauri-only persistence commands"
```

---

### Task 3: Migrate page tests from HTTP fixtures to the existing Tauri mock

**Files:**
- Modify: `apps/game/src/routes/page.test.ts`

**Interfaces:**
- Consumes: the Tauri-only gameplay and persistence clients from Tasks 1-2.
- Produces: page tests that describe commands with `mocks.invoke(command, args)` and no network emulation.

- [ ] **Step 1: Remove the page-test fetch mock and HTTP response helpers**

From the hoisted `mocks`, delete:

```ts
fetch: vi.fn(),
```

Delete the complete `jsonResponse()` and `jsonError()` helpers.

Delete setup calls that exist only for the command fallback:

```ts
mocks.fetch.mockReset();
vi.stubGlobal("fetch", mocks.fetch);
```

Keep the existing Tauri mock:

```ts
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));
```

- [ ] **Step 2: Convert scene-navigation helper to command-based dispatch**

Replace `stubFetchForSceneNavigation()` with:

```ts
function stubInvokeForSceneNavigation() {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "list_scenes") return sceneNavigationIndex;
    if (command === "jump_to_scene") {
      return {
        state: jumpedState(),
        thumbnailCapture: null,
      };
    }
    return {};
  });
}
```

Rename all callers accordingly.

- [ ] **Step 3: Convert acquisition acknowledgement helper**

Use:

```ts
function stubAcquisitionAcknowledgement() {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "acknowledge_acquisition_event") {
      return {
        state: currentState(),
        thumbnailCapture: null,
      };
    }
    return {};
  });
}
```

Tests that need arguments should inspect the existing `command` and `args` callback parameters rather than a URL.

- [ ] **Step 4: Convert every remaining command fetch fixture**

Find them:

```bash
rg -n 'mocks\.fetch|stubGlobal\("fetch"|127\.0\.0\.1:1421|jsonResponse|jsonError' \
  apps/game/src/routes/page.test.ts
```

For success paths use `mocks.invoke.mockResolvedValueOnce(...)` or command-based `mockImplementation(...)` with the same response object the HTTP fixture returned.

For an HTTP error body such as:

```ts
{ code: "saveWriteFailed", message: "Save could not be written." }
```

use the equivalent Tauri rejection:

```ts
mocks.invoke.mockRejectedValueOnce({
  code: "saveWriteFailed",
  message: "Save could not be written.",
});
```

Do not add a generic fake transport helper.

- [ ] **Step 5: Run the page tests now that both production clients are Tauri-only**

```bash
bun run --cwd apps/game test src/routes/page.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the three affected frontend test files together**

```bash
bun run --cwd apps/game test \
  src/lib/state/game-client-source.test.ts \
  src/lib/persistence/commands.test.ts \
  src/routes/page.test.ts
```

Expected: PASS.

- [ ] **Step 7: Verify page tests no longer emulate the command server**

```bash
rg -n 'mocks\.fetch|stubGlobal\("fetch"|127\.0\.0\.1:1421|httpInvoke|jsonResponse|jsonError' \
  apps/game/src/routes/page.test.ts
```

Expected: no matches.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/game/src/routes/page.test.ts
git commit -m "test(game): mock Tauri commands directly"
```

---

### Task 4: Delete the Rust HTTP server without deleting command-core coverage

**Files:**
- Delete: `apps/game/src-tauri/examples/dev_engine_server.rs`
- Modify: `apps/game/src-tauri/Cargo.toml`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`

**Interfaces:**
- Consumes: current Tauri/core functions in `lib.rs`, existing `build_app_state_with_storage`, and existing `RecordingExit` test helper.
- Produces: no replacement interface; the alternate development string router disappears.

#### Keep/delete map

| Current test | Retain | Delete |
|---|---|---|
| `tauri_core_and_http_adapter_return_identical_raw_request_errors` | direct `submit_save_thumbnail_core` missing/duplicate header rejection | HTTP comparison |
| `exit_lifecycle_getter_event_and_http_share_complete_status_and_error_views` | exit getter/event parity + `cancel_exit_core` wrong-token rejection | HTTP body/error comparison + `DevelopmentExitDriver` |
| `thumbnail_read_returns_exact_bytes_and_rejects_stale_observed_identity` | direct exact-byte read + stale identity rejection | HTTP `image/png` response half |
| `development_http_adapter_serializes_the_shared_wrapper_and_save_views` | nothing | entire test |
| `development_http_dispatch_registers_the_complete_task_11_surface` | nothing | entire test |
| `command_surface_contract` | nothing | entire module |

- [ ] **Step 1: Turn the mixed raw-thumbnail parity test into a direct core test before deleting the adapter**

Rename the test to:

```rust
#[tokio::test]
async fn submit_save_thumbnail_core_rejects_missing_and_duplicate_ticket_headers()
```

Keep the current UUID and duplicate-header setup. Remove `AppState` and `dispatch_development_command` from this test. Assert both direct calls reject with the validation error already owned by the core:

```rust
assert_eq!(
    submit_save_thumbnail_core(&coordinator, &[], b"png")
        .unwrap_err(),
    GameError::stale_thumbnail_ticket()
);
assert_eq!(
    submit_save_thumbnail_core(&coordinator, &duplicate, b"png")
        .unwrap_err(),
    GameError::stale_thumbnail_ticket()
);
```

This preserves the cases not covered by malformed-PNG/oversized-PNG tests.

- [ ] **Step 2: Turn the mixed exit-lifecycle parity test into direct core coverage**

Rename it to:

```rust
#[tokio::test]
async fn exit_lifecycle_getter_event_and_cancel_core_preserve_status_and_errors()
```

Keep:

```rust
let getter = serde_json::to_value(get_exit_status_core(&app)).unwrap();
let latest_exit_event = events
    .lock()
    .unwrap()
    .iter()
    .rev()
    .find(|(name, _)| name == EXIT_STATUS_CHANGED_EVENT)
    .unwrap()
    .1
    .clone();
assert_eq!(latest_exit_event, getter);
```

Keep creation of the wrong `PersistenceFailureTokenView` and the direct call:

```rust
let error = cancel_exit_core(&app, wrong_token).unwrap_err();
assert_eq!(error, GameError::stale_persistence_failure_token());
```

Delete `DevelopmentExitDriver`, `dispatch_development_command_with_exit`, HTTP-body decoding, and HTTP-vs-core comparison from the test.

- [ ] **Step 3: Remove only the HTTP half from thumbnail-read coverage**

Keep the existing setup and these direct assertions:

```rust
assert_eq!(
    read_save_thumbnail_core(&app, SaveSlotRef::Manual { slot: 1 }, &save_id).unwrap(),
    expected
);
assert_eq!(
    read_save_thumbnail_core(
        &app,
        SaveSlotRef::Manual { slot: 1 },
        &uuid::Uuid::new_v4().hyphenated().to_string(),
    )
    .unwrap_err()
    .code,
    "staleSaveSelection"
);
```

Delete the following `dispatch_development_command("read_save_thumbnail", ...)` response assertions for `content_type == "image/png"` and `response.body == expected`.

The test name can stay because it accurately describes the retained core behavior.

- [ ] **Step 4: Run the retained Rust core tests before deleting the server**

Use focused name filters:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  submit_save_thumbnail_core_rejects_missing_and_duplicate_ticket_headers
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  exit_lifecycle_getter_event_and_cancel_core_preserve_status_and_errors
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  thumbnail_read_returns_exact_bytes_and_rejects_stale_observed_identity
```

Expected: all PASS on the still-present server baseline because they no longer rely on it.

- [ ] **Step 5: Confirm the server-only symbol set before deletion**

```bash
rg -n \
  'DevelopmentCommandResponse|DevelopmentExitDriver|build_development_app_state|dispatch_development_command(_with_exit)?' \
  apps/game/src-tauri
```

Expected owners: `src/lib.rs`, `examples/dev_engine_server.rs`, and HTTP-only tests still awaiting deletion.

`build_development_app_state` is deleted rather than replaced; surviving tests use `build_app_state_with_storage`.

- [ ] **Step 6: Delete the standalone server and Cargo feature**

Delete:

```text
apps/game/src-tauri/examples/dev_engine_server.rs
```

Remove from `Cargo.toml`:

```toml
dev-engine-server = []
```

Keep the existing `e2e` feature unchanged.

- [ ] **Step 7: Delete the development dispatch surface in `lib.rs`**

Delete the server-only family:

```text
DevelopmentCommandResponse
DevelopmentExitDriver
build_development_app_state
dispatch_development_command
dispatch_development_command_with_exit
```

Delete the command-name match/string-router and JSON/binary response glue owned by those functions.

Do not delete or move the shared Tauri command cores, `build_app_state_with_storage`, save storage, thumbnail core, application exit core, or E2E checkpoint functions.

Do not introduce a replacement dispatcher.

- [ ] **Step 8: Delete wholly HTTP/string-router tests**

Delete these complete tests/modules from `lib.rs`:

```text
development_http_adapter_serializes_the_shared_wrapper_and_save_views
development_http_dispatch_registers_the_complete_task_11_surface
command_surface_contract
```

Do not delete the retained direct-core tests from Steps 1-3.

- [ ] **Step 9: Delete the CORS-only error constructor and its constructor-table row together**

In `game/error.rs`, delete:

```rust
pub fn request_origin_forbidden(origin: &str) -> Self {
    Self::new(
        "requestOriginForbidden",
        format!("Request origin '{origin}' is not allowed by CORS policy."),
    )
}
```

In `uncovered_error_constructors_return_their_exact_codes`, delete exactly:

```rust
(
    "requestOriginForbidden",
    GameError::request_origin_forbidden("http://evil"),
),
```

Then run:

```bash
rg -n 'request_origin_forbidden|requestOriginForbidden' apps/game/src-tauri
```

Expected: no matches.

- [ ] **Step 10: Run all remaining Rust features**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run --cwd apps/game rust:fmt
bun run --cwd apps/game rust:lint
```

Expected: all PASS.

- [ ] **Step 11: Prove the server and string router are gone**

```bash
rg -n \
  'dev_engine_server|dev-engine-server|DevelopmentCommandResponse|DevelopmentExitDriver|build_development_app_state|dispatch_development_command' \
  apps/game/src-tauri
```

Expected: no matches.

- [ ] **Step 12: Commit Task 4**

```bash
git add \
  apps/game/src-tauri/Cargo.toml \
  apps/game/src-tauri/src/lib.rs \
  apps/game/src-tauri/src/game/error.rs \
  apps/game/src-tauri/examples/dev_engine_server.rs
git commit -m "refactor(tauri): remove dev HTTP engine server"
```

---

### Task 5: Fix live coverage commentary and verify the single transport end to end

**Files:**
- Modify: `codecov.yml`
- Verify only: `apps/game/vite.config.ts`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: live config that no longer references deleted infrastructure plus complete deterministic/packaged proof.

- [ ] **Step 1: Rewrite the stale Codecov comment without changing coverage policy**

Replace the comment above the `lib.rs` ignore with:

```yaml
# lib.rs is Tauri command registration and runtime/IPC glue. Deterministic
# business behavior is tested through GameEngine and command-core unit tests;
# real IPC/filesystem integration is covered by packaged Tauri E2E. The Tauri
# runtime glue itself is excluded from line coverage.
ignore:
  - "apps/game/src-tauri/src/lib.rs"
```

Do not change the 90% project/patch targets, threshold, blocking status, or ignore path.

- [ ] **Step 2: Search active code/config for the retired command server**

```bash
rg -n \
  'dev_engine_server|dev-engine-server|DEV_HTTP_BASE|developmentHttpBase|httpInvoke|127\.0\.0\.1:1421' \
  . \
  --glob '!docs/superpowers/**' \
  --glob '!target/**' \
  --glob '!node_modules/**'
```

Expected: no active command-server/transport references.

Do not edit historical `docs/superpowers/**` results.

- [ ] **Step 3: Verify the unrelated HMR owner remains**

```bash
rg -n '1421' apps/game/vite.config.ts
```

Expected: the `TAURI_DEV_HOST` HMR configuration still uses port `1421`.

- [ ] **Step 4: Run the full deterministic workspace verification**

```bash
bun run test
bun run check
bun run lint:all
```

Expected: all PASS.

- [ ] **Step 5: Run packaged Tauri smoke through the remaining real IPC path**

```bash
bun run --cwd apps/game test:e2e:smoke
```

Expected: PASS.

- [ ] **Step 6: Reuse the packaged build for the persistence boundary proof**

Run:

```bash
node apps/game/scripts/run-save-e2e.mjs --suite save-core
```

Expected: PASS through real Tauri IPC/filesystem boundaries.

Do not add another suite. If the standard smoke command cleans its build artifact, use the repository's existing build command once and then run the two existing suites against that build; do not add HPA-559 runner code.

- [ ] **Step 7: Confirm the implementation is a material net deletion**

```bash
git diff --stat main...HEAD
git diff --numstat main...HEAD | awk '{ add += $1; del += $2 } END { print "added", add, "deleted", del, "net", add-del }'
```

The implementation portion must materially reduce production/test code. Planning-document additions do not justify retaining runtime complexity.

- [ ] **Step 8: Commit the live config cleanup**

```bash
git add codecov.yml
git commit -m "docs(ci): remove stale dev server coverage claim"
```

---

## Final Review Checklist

- [ ] `runCommand()` has one Tauri invoke path.
- [ ] `listScenes()` also has one Tauri invoke path and retains local error handling.
- [ ] `invokePersistenceCommand()` / `asGameError()` remain and contain no HTTP branch.
- [ ] Binary thumbnail submit/read keep their existing Tauri semantics.
- [ ] Page tests mock `mocks.invoke` directly and contain no fetch/URL command fixtures.
- [ ] `dev_engine_server.rs` and `dev-engine-server` are gone.
- [ ] `build_development_app_state`, `DevelopmentExitDriver`, development response types, and string router are gone rather than wrapped or renamed.
- [ ] Mixed Rust parity tests retain the three direct core assertions identified by the keep/delete map.
- [ ] `request_origin_forbidden` and its constructor-code test row are both gone.
- [ ] `development_http_adapter_serializes_the_shared_wrapper_and_save_views`, `development_http_dispatch_registers_the_complete_task_11_surface`, and `command_surface_contract` are gone.
- [ ] `codecov.yml` keeps the `lib.rs` ignore but no longer cites `dev_engine_server` coverage.
- [ ] Vite HMR port `1421` remains.
- [ ] Full deterministic tests/check/lint pass after Task 3+4.
- [ ] Existing packaged smoke and save-core suites pass.
- [ ] No `GameTransport`, HTTP test harness, mock server, local RPC, HPA-550 decision, HPA-521 refactor, HPA-560 policy work, HPA-602 asset work, or Chapter 2 work is introduced.
