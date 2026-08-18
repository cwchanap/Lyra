# HPA-559 Remove Legacy Browser HTTP Game-Engine Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remove Lyra's browser HTTP game-engine transport so gameplay and persistence commands have one production path through Tauri IPC, while deleting the now-unneeded Rust server/string-router API and retaining core behavior coverage.

**Architecture:** keep the existing gameplay and persistence client ownership and call `@tauri-apps/api/core.invoke` directly. Delete the standalone HTTP example plus the unconditionally compiled library surface that exists for it; preserve existing Tauri command cores, binary thumbnail behavior, save semantics, and packaged E2E paths.

**Tech Stack:** Svelte 5 / TypeScript, Vitest + jsdom, Tauri 2 IPC, Rust/Cargo, existing WebdriverIO packaged E2E.

**Spec:** `docs/superpowers/specs/2026-08-17-hpa-559-remove-dev-http-transport-design.md`

## Global Constraints

- Final command flow is exactly `Svelte client → Tauri invoke → Rust application facade`.
- Do not introduce `GameTransport`, `invokeGameCommand`, an adapter registry, local RPC, a mock HTTP server, or another one-implementation abstraction.
- Keep gameplay, save/load, acquisition, thumbnail, Analysis, interrogation, Case File, audio, and exit semantics unchanged.
- Keep `invokePersistenceCommand()` / `asGameError()` and the existing three-argument binary thumbnail Tauri invocation.
- Do not make the HPA-550 thumbnail product decision.
- Do not perform HPA-521 save-coordinator simplification or HPA-560 E2E-policy restructuring.
- Keep `apps/game/vite.config.ts` HMR port `1421`; it is unrelated to the retired command server.
- Do not rewrite historical `docs/superpowers/**` records.
- Split mixed HTTP-parity tests before deletion so direct command-core coverage survives.
- Keep the existing Tauri registration guard `task_11_commands_are_registered_once_with_the_existing_application_surface`; do not replace it with another name list.
- Delete public Rust visibility that existed only for `dev_engine_server` when the usage audit proves it is no longer needed.
- Run both default-feature and `--all-features` Rust tests after deleting the unconditionally compiled development dispatch family.
- Accept that manually opening the Vite URL in a plain browser may lose the friendly `Tauri runtime unavailable` message; do not add a transport shim to preserve it.
- Reuse the existing packaged smoke and save-core suites; do not add an HPA-559-specific E2E suite.

---

## File Map

### Production/config files

| File | HPA-559 action |
|---|---|
| `apps/game/src/lib/state/game-client.svelte.ts` | Remove both `runCommand()` and `listScenes()` HTTP branches. |
| `apps/game/src/lib/persistence/commands.ts` | Remove JSON/binary HTTP paths; keep typed Tauri wrappers. |
| `apps/game/src-tauri/examples/dev_engine_server.rs` | Delete. |
| `apps/game/src-tauri/Cargo.toml` | Delete `dev-engine-server` feature. |
| `apps/game/src-tauri/src/lib.rs` | Delete development response/router API; preserve Tauri cores; narrow example-only public API. |
| `apps/game/src-tauri/src/game/error.rs` | Delete `request_origin_forbidden` and its constructor-code row. |
| `codecov.yml` | Keep `lib.rs` ignore; rewrite stale server-coverage comment only. |

### Frontend tests

| File | HPA-559 action |
|---|---|
| `apps/game/src/lib/state/game-client-source.test.ts` | Mock Tauri invoke directly without fake `__TAURI_INTERNALS__`; cover `listScenes()`. |
| `apps/game/src/lib/persistence/commands.test.ts` | Import normally; retain structured error and binary IPC assertions. |
| `apps/game/src/routes/page.test.ts` | Convert existing fetch/URL fixtures to `mocks.invoke`; delete fetch scaffolding last. |

### Explicit non-change

- `apps/game/vite.config.ts`: keep HMR port `1421` exactly as-is.

---

## Execution Order

```text
Task 1 — gameplay + scene-index client
Task 2 — persistence + thumbnail client
Task 3 — page-test fixture migration, convert sites first / delete fetch last
Task 4 — Rust server/string-router/public-API deletion with test preservation
Task 5 — live config cleanup + full verification
```

Do not run or claim the full frontend suite until Task 3 is complete. Tasks 1 and 2 use focused tests only.

---

### Task 1: Make gameplay and scene-index commands Tauri-only

**Files:**
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`

**Interfaces:**
- Consumes: `invoke<T>(command, args)` from `@tauri-apps/api/core`.
- Produces: unchanged public gameplay client API and unchanged panel-local `listScenes()` error behavior.

- [ ] **Step 1: Remove fake Tauri-global setup from the focused test loader**

Change `loadGameClient()` to:

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

Delete the `afterEach` cleanup of `window.__TAURI_INTERNALS__` when nothing else creates it.

- [ ] **Step 2: Add a no-global gameplay regression**

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

- [ ] **Step 3: Strengthen the existing `listScenes()` test**

Keep its existing index fixture and add:

```ts
await expect(client.listScenes()).resolves.toEqual(index);
expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("list_scenes");
```

The test must run without `__TAURI_INTERNALS__`.

- [ ] **Step 4: Run RED and interpret the failure correctly**

```bash
bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected on the pre-change source: removing the runtime global makes the client select `httpInvoke()`. Because this file does not install a fetch command stub, the run may surface a connection/fetch failure that `runCommand()` normalizes into `gameState.error`, rather than a clean `mocks.invoke` assertion diff. That is the expected RED signal; do not add a temporary HTTP harness.

- [ ] **Step 5: Delete gameplay HTTP declarations and helper**

Delete:

```ts
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const DEV_HTTP_BASE = "http://127.0.0.1:1421";
```

Delete the complete `httpInvoke<T>()` function.

- [ ] **Step 6: Convert `runCommand()` to direct invoke**

Use:

```ts
async function runCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  gameState.error = null;
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    gameState.error = normalizeError(e);
    return null;
  }
}
```

Do not change loading, in-flight, SFX, thumbnail, or state-application behavior.

- [ ] **Step 7: Convert `listScenes()` to direct invoke**

Use:

```ts
export async function listScenes(): Promise<SceneNavigationIndex | null> {
  try {
    return await invoke<SceneNavigationIndex>("list_scenes");
  } catch {
    return null;
  }
}
```

Keep its existing local-error ownership rationale.

- [ ] **Step 8: Run GREEN**

```bash
bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected: PASS.

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
- Produces: unchanged persistence helper signatures, `asGameError()` semantics, and binary thumbnail IPC shape.

- [ ] **Step 1: Remove fake Tauri-global setup from persistence tests**

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

Delete the matching `afterEach` property cleanup when nothing else creates it.

- [ ] **Step 2: Add a direct-invoke regression**

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

If the existing mock records one argument when `args` is `undefined`, assert that exact current shape instead of introducing an adapter.

- [ ] **Step 3: Run RED**

```bash
bun run --cwd apps/game test src/lib/persistence/commands.test.ts
```

Expected on pre-change source: the no-global import selects the HTTP fallback and the Tauri assertion fails.

- [ ] **Step 4: Delete JSON HTTP support**

Delete:

```ts
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const developmentHttpBase = "http://127.0.0.1:1421";
```

Delete the complete functions:

- `assertDevelopmentFallback()`;
- `throwHttpError()`;
- `developmentJson<T>()`.

- [ ] **Step 5: Keep `invokePersistenceCommand()` as the typed error boundary**

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

- [ ] **Step 6: Keep binary thumbnail submit on the existing Tauri path**

Retain:

```ts
return await invoke<ThumbnailActivityView>(
  "submit_save_thumbnail",
  bytes,
  { headers: { [thumbnailTicketHeader]: ticket } },
);
```

Delete only its HTTP branch.

- [ ] **Step 7: Make thumbnail reads Tauri-only**

Use:

```ts
const response = await invoke<ArrayBuffer | Uint8Array>(
  "read_save_thumbnail",
  { reference, observedSaveId },
);
```

Keep `Uint8Array` / `ArrayBuffer` normalization and `thumbnailCorrupt`. Delete `readDevelopmentThumbnail()`.

- [ ] **Step 8: Run GREEN**

```bash
bun run --cwd apps/game test src/lib/persistence/commands.test.ts
```

Expected: PASS, including structured error tests and the existing three-argument thumbnail invoke assertion.

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

### Task 3: Migrate page tests without breaking the file mid-edit

**Files:**
- Modify: `apps/game/src/routes/page.test.ts`

**Interfaces:**
- Consumes: Tauri-only gameplay/persistence clients from Tasks 1-2 and the file's existing `mocks.invoke`.
- Produces: page tests with no command-server fetch/URL/body fixtures.

**Ordering rule:** keep `mocks.fetch`, `jsonResponse`, `jsonError`, `mocks.fetch.mockReset()`, and `vi.stubGlobal("fetch", mocks.fetch)` in place until every command call site has been converted. Delete scaffolding last.

- [ ] **Step 1: Record the migration baseline before editing**

Run:

```bash
rg -c 'mocks\.fetch' apps/game/src/routes/page.test.ts
rg -c 'jsonResponse|jsonError' apps/game/src/routes/page.test.ts
rg -n 'init\?: RequestInit|RequestInit' apps/game/src/routes/page.test.ts
```

Keep these counts in the implementation notes. The first two counts must monotonically decrease as call sites are migrated.

- [ ] **Step 2: Convert the scene-navigation helper first, without deleting fetch scaffolding**

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

Rename all callers.

Run:

```bash
rg -c 'mocks\.fetch' apps/game/src/routes/page.test.ts
bun run --cwd apps/game test src/routes/page.test.ts
```

Expected: the test file still executes; cases whose fixtures are still fetch-backed may remain red, but there must be no TypeError caused by deleting `mocks.fetch` prematurely.

- [ ] **Step 3: Convert the acquisition acknowledgement helper next**

Replace its fetch-backed implementation with:

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

Run:

```bash
rg -c 'mocks\.fetch' apps/game/src/routes/page.test.ts
bun run --cwd apps/game test src/routes/page.test.ts
```

Again, remaining unconverted fetch-backed cases may fail, but the file must execute.

- [ ] **Step 4: Convert direct `mocks.fetch.mockImplementation` sites to command/args dispatch**

For every remaining command fixture, replace URL parsing with the existing Tauri mock shape:

```ts
mocks.invoke.mockImplementation(
  async (command: string, args?: Record<string, unknown>) => {
    if (command === "save_manual") {
      return saveManualResult;
    }
    if (command === "list_saves") {
      return titleDiscovery();
    }
    return {};
  },
);
```

For sites currently declared as `(url, init?: RequestInit)` and parsing `init.body`, move that logic to `args`. For example, replace:

```ts
const body = JSON.parse(String(init?.body ?? "{}"));
if (path === "load_save" && body.observedSaveId === "save-id") {
  return jsonResponse(loadResult);
}
```

with:

```ts
if (
  command === "load_save" &&
  args?.observedSaveId === "save-id"
) {
  return loadResult;
}
```

Use Tauri rejection directly for error paths:

```ts
mocks.invoke.mockRejectedValueOnce({
  code: "saveWriteFailed",
  message: "Save could not be written.",
});
```

Do not add a generic fake transport helper.

After each logical group of edits, run:

```bash
rg -c 'mocks\.fetch' apps/game/src/routes/page.test.ts
bun run --cwd apps/game test src/routes/page.test.ts
```

The fetch count must continue down. The file may stay partially red until all command fixtures are converted, but it remains executable throughout.

- [ ] **Step 5: Prove no command call site still depends on fetch before deleting the mock**

Run:

```bash
rg -n 'mocks\.fetch\.mockImplementation|mocks\.fetch\.mockResolvedValue|mocks\.fetch\.mockRejectedValue|127\.0\.0\.1:1421|init\?: RequestInit' \
  apps/game/src/routes/page.test.ts
```

Expected: no command-fixture matches remain.

At this point any remaining `mocks.fetch` references must be only the hoisted declaration/reset/stub setup awaiting deletion.

- [ ] **Step 6: Delete fetch scaffolding last**

Now delete from the hoisted `mocks` object:

```ts
fetch: vi.fn(),
```

Delete the complete helpers:

```text
jsonResponse
jsonError
```

Delete setup lines:

```ts
mocks.fetch.mockReset();
vi.stubGlobal("fetch", mocks.fetch);
```

Keep:

```ts
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));
```

- [ ] **Step 7: Run GREEN for the page suite**

```bash
bun run --cwd apps/game test src/routes/page.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run the three affected frontend test files together**

```bash
bun run --cwd apps/game test \
  src/lib/state/game-client-source.test.ts \
  src/lib/persistence/commands.test.ts \
  src/routes/page.test.ts
```

Expected: PASS.

- [ ] **Step 9: Prove page tests no longer emulate the command server**

```bash
rg -n 'mocks\.fetch|stubGlobal\("fetch"|127\.0\.0\.1:1421|httpInvoke|jsonResponse|jsonError|init\?: RequestInit' \
  apps/game/src/routes/page.test.ts
```

Expected: no command-server fixture matches.

- [ ] **Step 10: Commit Task 3**

```bash
git add apps/game/src/routes/page.test.ts
git commit -m "test(game): mock Tauri commands directly"
```

---

### Task 4: Delete the Rust HTTP server and its shipped library surface

**Files:**
- Delete: `apps/game/src-tauri/examples/dev_engine_server.rs`
- Modify: `apps/game/src-tauri/Cargo.toml`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`

**Interfaces:**
- Consumes: existing Tauri/core functions, `build_app_state_with_storage`, `RecordingExit`, and the surviving Tauri registration guard.
- Produces: no replacement interface; removes alternate dispatch and example-only public API.

#### Keep/delete map

| Current test | Retain | Delete |
|---|---|---|
| `tauri_core_and_http_adapter_return_identical_raw_request_errors` | direct missing/duplicate ticket-header assertions against `submit_save_thumbnail_core` | HTTP comparison |
| `exit_lifecycle_getter_event_and_http_share_complete_status_and_error_views` | getter/event payload parity + `cancel_exit_core` wrong-token error | HTTP response/error half + `DevelopmentExitDriver` |
| `thumbnail_read_returns_exact_bytes_and_rejects_stale_observed_identity` | exact bytes + stale observed identity from `read_save_thumbnail_core` | HTTP `image/png` response half |
| `development_http_adapter_serializes_the_shared_wrapper_and_save_views` | nothing | whole test |
| `development_http_dispatch_registers_the_complete_task_11_surface` | nothing | whole test |
| `command_surface_contract` | nothing | whole module; Tauri registration remains covered by `task_11_commands_are_registered_once_with_the_existing_application_surface` |

- [ ] **Step 1: Strengthen the raw-thumbnail core test before deleting parity**

Rename it to:

```rust
#[tokio::test]
async fn submit_save_thumbnail_core_rejects_missing_and_duplicate_ticket_headers()
```

Keep UUID/duplicate setup and assert concrete behavior:

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

Delete `AppState` and HTTP dispatch from this test.

- [ ] **Step 2: Preserve exit core coverage and remove the HTTP half**

Rename to:

```rust
#[tokio::test]
async fn exit_lifecycle_getter_event_and_cancel_core_preserve_status_and_errors()
```

Keep getter/event equality and direct wrong-token behavior:

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

let error = cancel_exit_core(&app, wrong_token).unwrap_err();
assert_eq!(error, GameError::stale_persistence_failure_token());
```

Delete `DevelopmentExitDriver` and HTTP response/error comparison from this test.

- [ ] **Step 3: Preserve thumbnail-read core coverage and remove HTTP response assertions**

Keep:

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

Delete the `dispatch_development_command("read_save_thumbnail", ...)` `image/png` assertions.

- [ ] **Step 4: Run the retained core tests before server deletion**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  submit_save_thumbnail_core_rejects_missing_and_duplicate_ticket_headers
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  exit_lifecycle_getter_event_and_cancel_core_preserve_status_and_errors
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  thumbnail_read_returns_exact_bytes_and_rejects_stale_observed_identity
```

Expected: PASS.

- [ ] **Step 5: Confirm the surviving Tauri registration guard before deleting the HTTP guard**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  task_11_commands_are_registered_once_with_the_existing_application_surface
```

Expected: PASS. This is why `command_surface_contract` needs no replacement.

- [ ] **Step 6: Audit the server import block as the public-API deletion checklist**

Run:

```bash
sed -n '16,22p' apps/game/src-tauri/examples/dev_engine_server.rs
```

Then verify ownership:

```bash
rg -n 'MAX_THUMBNAIL_SUBMISSION_BYTES|RawThumbnailHeader|validate_thumbnail_submission|DevelopmentCommandResponse|DevelopmentExitDriver|build_development_app_state|dispatch_development_command' \
  apps/game/src-tauri
```

Known outcome after the example is removed:

- delete `MAX_THUMBNAIL_SUBMISSION_BYTES`;
- delete the development response/driver/builder/dispatch family;
- keep `RawThumbnailHeader` and `validate_thumbnail_submission` for the Tauri thumbnail core but narrow them to `pub(crate)`;
- keep any other item only if the usage search shows a surviving non-example owner.

- [ ] **Step 7: Delete the standalone server and Cargo feature**

Delete:

```text
apps/game/src-tauri/examples/dev_engine_server.rs
```

Remove from `Cargo.toml`:

```toml
dev-engine-server = []
```

Keep the `e2e` feature unchanged.

- [ ] **Step 8: Delete the unconditionally compiled development dispatch family**

Delete from `lib.rs`:

```text
DevelopmentCommandResponse
build_development_app_state
development_json
parse_development_body
DevelopmentExitDriver
DevelopmentExitDriver::recorded_codes
dispatch_development_command
dispatch_development_command_with_exit
```

Delete the development command match/string-router and response-body glue they own.

Do not move shared Tauri command cores or save/persistence code to new files in this ticket.

- [ ] **Step 9: Remove/narrow the example-only public thumbnail API**

Delete:

```rust
#[doc(hidden)]
pub const MAX_THUMBNAIL_SUBMISSION_BYTES: usize = MAX_THUMBNAIL_BYTES;
```

Change:

```rust
pub struct RawThumbnailHeader<'a>
```

to:

```rust
pub(crate) struct RawThumbnailHeader<'a>
```

Change:

```rust
pub fn new(name: &'a [u8], value: &'a [u8]) -> Self
```

to:

```rust
pub(crate) fn new(name: &'a [u8], value: &'a [u8]) -> Self
```

Change:

```rust
pub fn validate_thumbnail_submission<'a>(
```

to:

```rust
pub(crate) fn validate_thumbnail_submission<'a>(
```

Re-run the Step 6 ownership search. If another item from the deleted example import block is now externally public with no surviving external owner, narrow/delete it only after proving that with `rg`.

- [ ] **Step 10: Delete wholly HTTP/string-router tests**

Delete:

```text
development_http_adapter_serializes_the_shared_wrapper_and_save_views
development_http_dispatch_registers_the_complete_task_11_surface
command_surface_contract
```

Keep `task_11_commands_are_registered_once_with_the_existing_application_surface` unchanged.

- [ ] **Step 11: Delete the CORS-only error constructor and table row together**

Delete from `game/error.rs`:

```rust
pub fn request_origin_forbidden(origin: &str) -> Self {
    Self::new(
        "requestOriginForbidden",
        format!("Request origin '{origin}' is not allowed by CORS policy."),
    )
}
```

Delete from `uncovered_error_constructors_return_their_exact_codes`:

```rust
(
    "requestOriginForbidden",
    GameError::request_origin_forbidden("http://evil"),
),
```

Verify:

```bash
rg -n 'request_origin_forbidden|requestOriginForbidden' apps/game/src-tauri
```

Expected: no matches.

- [ ] **Step 12: Run the default-feature Rust suite**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: PASS. This explicitly verifies the library configuration that ships without the `e2e` feature.

- [ ] **Step 13: Run the all-feature Rust suite plus format/lint**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run --cwd apps/game rust:fmt
bun run --cwd apps/game rust:lint
```

Expected: all PASS.

- [ ] **Step 14: Prove the server/public transport surface is gone**

```bash
rg -n \
  'dev_engine_server|dev-engine-server|DevelopmentCommandResponse|DevelopmentExitDriver|build_development_app_state|dispatch_development_command|MAX_THUMBNAIL_SUBMISSION_BYTES' \
  apps/game/src-tauri
```

Expected: no matches.

Verify the surviving thumbnail helpers are crate-private:

```bash
rg -n 'pub\(crate\) struct RawThumbnailHeader|pub\(crate\) fn validate_thumbnail_submission' \
  apps/game/src-tauri/src/lib.rs
```

Expected: both matches exist.

- [ ] **Step 15: Re-run the surviving Tauri registration guard after deletion**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  task_11_commands_are_registered_once_with_the_existing_application_surface
```

Expected: PASS.

- [ ] **Step 16: Commit Task 4**

```bash
git add \
  apps/game/src-tauri/Cargo.toml \
  apps/game/src-tauri/src/lib.rs \
  apps/game/src-tauri/src/game/error.rs \
  apps/game/src-tauri/examples/dev_engine_server.rs
git commit -m "refactor(tauri): remove dev HTTP engine server"
```

---

### Task 5: Fix live coverage commentary and verify one transport end to end

**Files:**
- Modify: `codecov.yml`
- Verify only: `apps/game/vite.config.ts`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: live config with no stale server claim plus complete deterministic/packaged proof.

- [ ] **Step 1: Rewrite the stale Codecov comment only**

Replace the comment above `ignore:` with:

```yaml
# lib.rs is Tauri command registration and runtime/IPC glue. Deterministic
# business behavior is tested through GameEngine and command-core unit tests;
# real IPC/filesystem integration is covered by packaged Tauri E2E. The Tauri
# runtime glue itself is excluded from line coverage.
ignore:
  - "apps/game/src-tauri/src/lib.rs"
```

Do not change coverage targets, threshold, blocking status, or ignore path.

- [ ] **Step 2: Search active code/config for retired transport/server references**

```bash
rg -n \
  'dev_engine_server|dev-engine-server|DEV_HTTP_BASE|developmentHttpBase|httpInvoke|127\.0\.0\.1:1421|MAX_THUMBNAIL_SUBMISSION_BYTES' \
  . \
  --glob '!docs/superpowers/**' \
  --glob '!target/**' \
  --glob '!node_modules/**'
```

Expected: no active retired-command-surface matches.

- [ ] **Step 3: Verify the HMR port remains**

```bash
rg -n '1421' apps/game/vite.config.ts
```

Expected: `TAURI_DEV_HOST` HMR configuration still uses `1421`.

- [ ] **Step 4: Run full deterministic workspace verification**

```bash
bun run test
bun run check
bun run lint:all
```

Expected: all PASS.

- [ ] **Step 5: Run packaged Tauri smoke**

```bash
bun run --cwd apps/game test:e2e:smoke
```

Expected: PASS through real Tauri IPC.

- [ ] **Step 6: Reuse the built packaged app for save-core**

```bash
node apps/game/scripts/run-save-e2e.mjs --suite save-core
```

Expected: PASS through Tauri IPC/filesystem boundaries. The current runner already supports this suite; do not add a fallback branch or new HPA-559 runner.

- [ ] **Step 7: Confirm material net deletion**

```bash
git diff --stat main...HEAD
git diff --numstat main...HEAD | awk '{ add += $1; del += $2 } END { print "added", add, "deleted", del, "net", add-del }'
```

The implementation portion must materially reduce production/test code. Planning-doc additions do not justify retaining runtime complexity.

- [ ] **Step 8: Commit the live config cleanup**

```bash
git add codecov.yml
git commit -m "docs(ci): remove stale dev server coverage claim"
```

---

## Final Review Checklist

- [ ] `runCommand()` and `listScenes()` each use Tauri `invoke()` only.
- [ ] `invokePersistenceCommand()` / `asGameError()` remain and contain no HTTP branch.
- [ ] Binary thumbnail submit/read retain existing Tauri semantics.
- [ ] Page-test command call sites were converted before fetch scaffolding was deleted.
- [ ] `page.test.ts` contains no fetch/URL/body command-server fixtures.
- [ ] `dev_engine_server.rs` and `dev-engine-server` are gone.
- [ ] The previously unconditionally compiled development response/builder/driver/string-router API is gone.
- [ ] `MAX_THUMBNAIL_SUBMISSION_BYTES` is gone.
- [ ] `RawThumbnailHeader`, its constructor, and `validate_thumbnail_submission` are crate-private.
- [ ] Mixed parity tests retain the three direct core behaviors from the keep/delete map.
- [ ] HTTP-only tests/modules are deleted.
- [ ] `task_11_commands_are_registered_once_with_the_existing_application_surface` survives and passes; no replacement registration list is added.
- [ ] `request_origin_forbidden` and its constructor-code row are both gone.
- [ ] `codecov.yml` keeps the `lib.rs` ignore but no longer cites the server.
- [ ] Vite HMR port `1421` remains.
- [ ] Default-feature and all-feature Rust suites pass.
- [ ] Full test/check/lint pass after migration.
- [ ] Existing packaged smoke and save-core pass.
- [ ] Plain-browser loss of the friendly runtime-unavailable diagnostic is accepted without transport machinery.
- [ ] No `GameTransport`, HTTP test harness, mock server, local RPC, HPA-550 decision, HPA-521 refactor, HPA-560 policy work, HPA-602 work, or Chapter 2 work is introduced.
