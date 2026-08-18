# HPA-559 Remove Legacy Browser HTTP Game-Engine Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remove Lyra's developer-only browser HTTP game-engine transport so gameplay and persistence commands have one production path through Tauri IPC.

**Architecture:** keep the existing gameplay and persistence client ownership, but delete their environment-based transport branching and call `@tauri-apps/api/core.invoke` directly. Delete the standalone Rust HTTP server plus only the Rust development-dispatch surface that exists to serve it; keep all shared Tauri command cores, persistence behavior, thumbnail behavior, and packaged E2E paths unchanged.

**Tech Stack:** Svelte 5 / TypeScript, Vitest + jsdom, Tauri 2 IPC, Rust, Cargo, existing WebdriverIO packaged E2E.

**Spec:** `docs/superpowers/specs/2026-08-17-hpa-559-remove-dev-http-transport-design.md`

## Global Constraints

- Production command flow after this work is exactly `Svelte client → Tauri invoke → Rust application facade`.
- Do not introduce `GameTransport`, an adapter registry, local RPC, a mock HTTP server, or another one-implementation abstraction.
- Keep current player-visible gameplay, save/load, acquisition, thumbnail, Analysis, interrogation, Case File, audio, and exit semantics unchanged.
- Do not make the HPA-550 thumbnail product decision in this ticket; current thumbnail capture behavior remains in place.
- Do not perform HPA-521 save-coordinator simplification or HPA-560 E2E-policy restructuring.
- Do not preserve the deleted browser transport for backward compatibility; Lyra has no released browser consumer.
- Do not edit historical `docs/superpowers/**` records merely because they mention the old HTTP fallback.
- Keep `apps/game/vite.config.ts` HMR port `1421`; it is unrelated to `127.0.0.1:1421` command dispatch.
- Delete tests that only prove deleted HTTP parser/CORS/server behavior instead of porting those tests to another layer.
- Reuse existing packaged smoke/save-core suites; do not add a new HPA-559 E2E suite.
- Every task should produce a net-simpler implementation; if a step starts adding more transport machinery than it removes, stop and revisit the design.

---

## File Map

### Production files to modify/delete

| File | Responsibility after HPA-559 |
|---|---|
| `apps/game/src/lib/state/game-client.svelte.ts` | Gameplay state/orchestration; calls Tauri `invoke` directly. |
| `apps/game/src/lib/persistence/commands.ts` | Typed persistence command/error boundary; calls Tauri `invoke` directly, including binary thumbnail commands. |
| `apps/game/src-tauri/Cargo.toml` | Removes the `dev-engine-server` feature. |
| `apps/game/src-tauri/examples/dev_engine_server.rs` | Delete entirely. |
| `apps/game/src-tauri/src/lib.rs` | Keeps Tauri application/command cores; removes development-server-only response/exit/dispatch surface. |
| `apps/game/src-tauri/src/game/error.rs` | Remove `request_origin_forbidden` only if the final usage search confirms it has no caller after the server is deleted. |

### Tests to modify

| File | Responsibility after HPA-559 |
|---|---|
| `apps/game/src/lib/state/game-client-source.test.ts` | Mocks Tauri `invoke` directly; no fake `__TAURI_INTERNALS__` branch selection. |
| `apps/game/src/lib/persistence/commands.test.ts` | Tests exact Tauri command shapes and structured errors directly. |
| `apps/game/src/routes/page.test.ts` | Stubs application commands through `mocks.invoke`, not `fetch()` URLs. |

### File explicitly not changed for the port-number coincidence

- `apps/game/vite.config.ts` — `1421` is the Tauri-dev HMR port when `TAURI_DEV_HOST` is set. Keep it.

---

### Task 1: Make gameplay command dispatch Tauri-only

**Files:**
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`

**Interfaces:**
- Consumes: `invoke<T>(command, args)` from `@tauri-apps/api/core`.
- Produces: unchanged exported gameplay-client functions and `gameState`; no transport abstraction is added.

- [ ] **Step 1: Add a regression test that proves jsdom uses Tauri IPC without a runtime-global branch**

In `apps/game/src/lib/state/game-client-source.test.ts`, change `loadGameClient()` so it no longer creates `window.__TAURI_INTERNALS__` before import:

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

Keep the existing `@tauri-apps/api/core` mock. Add this focused assertion:

```ts
it("dispatches gameplay commands through Tauri invoke without a Tauri runtime global", async () => {
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

Remove the `afterEach` deletion of `__TAURI_INTERNALS__` once no test in this file creates it.

- [ ] **Step 2: Run the focused test and confirm it fails on the current branch**

```bash
bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected before production change: the no-global test selects the HTTP fallback instead of `mocks.invoke`, so the mocked Tauri response is not applied.

- [ ] **Step 3: Remove gameplay transport branching**

In `apps/game/src/lib/state/game-client.svelte.ts`, delete these exact declarations:

```ts
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const DEV_HTTP_BASE = "http://127.0.0.1:1421";
```

Delete the complete `httpInvoke<T>(command, args)` function.

Replace the branch in `runCommand()`:

```ts
return isTauri
  ? await invoke<T>(command, args)
  : await httpInvoke<T>(command, args);
```

with:

```ts
return await invoke<T>(command, args);
```

Do not change error normalization, loading state, in-flight fencing, thumbnail follow-up, SFX, action-token reconciliation, or public exports.

- [ ] **Step 4: Run focused gameplay-client tests**

```bash
bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected: PASS, including the no-`__TAURI_INTERNALS__` regression.

- [ ] **Step 5: Run a source absence check for the gameplay HTTP branch**

```bash
rg -n 'DEV_HTTP_BASE|httpInvoke|127\.0\.0\.1:1421|__TAURI_INTERNALS__' \
  apps/game/src/lib/state/game-client.svelte.ts \
  apps/game/src/lib/state/game-client-source.test.ts
```

Expected: no matches.

- [ ] **Step 6: Commit Task 1**

```bash
git add \
  apps/game/src/lib/state/game-client.svelte.ts \
  apps/game/src/lib/state/game-client-source.test.ts
git commit -m "refactor(game): use Tauri-only gameplay commands"
```

---

### Task 2: Migrate page tests from the deleted HTTP transport to Tauri command mocks

**Files:**
- Modify: `apps/game/src/routes/page.test.ts`

**Interfaces:**
- Consumes: the unchanged gameplay/persistence public client APIs from Task 1.
- Produces: page tests that describe command semantics via `mocks.invoke(command, args)` instead of HTTP URLs.

- [ ] **Step 1: Remove page-test HTTP fixtures**

From the hoisted `mocks` object, remove `fetch: vi.fn()`.

Delete the complete `jsonResponse(body)` and `jsonError(body)` helper functions. Delete `vi.stubGlobal("fetch", mocks.fetch)` and `mocks.fetch.mockReset()` setup used by the command fallback.

Keep the existing Tauri mock:

```ts
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));
```

- [ ] **Step 2: Convert scene-navigation stubbing to command-based invocation**

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

Update all callers to `stubInvokeForSceneNavigation()`.

- [ ] **Step 3: Convert acquisition acknowledgement stubbing to command-based invocation**

Replace `stubAcquisitionAcknowledgement()` with:

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

Tests that need acknowledgement arguments should branch on the existing callback parameters `command` and `args`; they should not reconstruct URLs.

- [ ] **Step 4: Convert every remaining `mocks.fetch` setup in the file**

```bash
rg -n 'mocks\.fetch|stubGlobal\("fetch"|127\.0\.0\.1:1421|jsonResponse|jsonError' \
  apps/game/src/routes/page.test.ts
```

For each remaining hit, use `mocks.invoke.mockResolvedValueOnce(...)`, `mockRejectedValueOnce(...)`, or `mockImplementation(...)` with the same command result/error that the test previously supplied through HTTP.

For example, replace an HTTP 500 fixture containing:

```ts
{ code: "saveWriteFailed", message: "Save could not be written." }
```

with a Tauri rejection:

```ts
mocks.invoke.mockRejectedValueOnce({
  code: "saveWriteFailed",
  message: "Save could not be written.",
});
```

Do not add a generic fake transport helper.

- [ ] **Step 5: Run the page test suite**

```bash
bun run --cwd apps/game test src/routes/page.test.ts
```

Expected: PASS with no network/fetch emulation.

- [ ] **Step 6: Verify the page test no longer knows about the HTTP engine**

```bash
rg -n 'mocks\.fetch|stubGlobal\("fetch"|127\.0\.0\.1:1421|httpInvoke|jsonResponse|jsonError' \
  apps/game/src/routes/page.test.ts
```

Expected: no matches.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/game/src/routes/page.test.ts
git commit -m "test(game): mock Tauri commands directly"
```

---

### Task 3: Make persistence commands Tauri-only

**Files:**
- Modify: `apps/game/src/lib/persistence/commands.ts`
- Modify: `apps/game/src/lib/persistence/commands.test.ts`

**Interfaces:**
- Consumes: `invoke<T>()` from Tauri.
- Produces: unchanged public persistence helper signatures, unchanged `asGameError()` normalization, unchanged binary thumbnail command shapes.

- [ ] **Step 1: Make persistence tests import without a fake Tauri global**

Change `loadCommands()` in `commands.test.ts` to:

```ts
async function loadCommands() {
  return import("./commands");
}
```

Remove the cleanup that deletes `window.__TAURI_INTERNALS__` once no test in this file creates it.

Add:

```ts
it("invokes Tauri directly when no Tauri runtime global is installed", async () => {
  const commands = await loadCommands();
  mocks.invoke.mockResolvedValueOnce({ type: "idle" });

  expect("__TAURI_INTERNALS__" in window).toBe(false);
  await expect(commands.getThumbnailActivity()).resolves.toEqual({
    type: "idle",
  });

  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
    "get_thumbnail_activity",
    undefined,
  );
});
```

- [ ] **Step 2: Run the focused persistence-command tests and confirm the new regression fails before production changes**

```bash
bun run --cwd apps/game test src/lib/persistence/commands.test.ts
```

Expected before production change: without the fake global, `commands.ts` selects its HTTP fallback and does not call `mocks.invoke`.

- [ ] **Step 3: Delete JSON HTTP fallback helpers from `commands.ts`**

Delete these exact declarations:

```ts
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const developmentHttpBase = "http://127.0.0.1:1421";
```

Delete the complete functions `assertDevelopmentFallback()`, `throwHttpError()`, and `developmentJson<T>()`.

Change `invokePersistenceCommand()` to:

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

- [ ] **Step 4: Keep thumbnail binary behavior but remove its HTTP branch**

`submitSaveThumbnail()` keeps the existing Tauri call:

```ts
return await invoke<ThumbnailActivityView>(
  "submit_save_thumbnail",
  bytes,
  { headers: { [thumbnailTicketHeader]: ticket } },
);
```

Delete its HTTP `fetch()` branch.

`readSaveThumbnail()` should call Tauri directly:

```ts
const response = await invoke<ArrayBuffer | Uint8Array>(
  "read_save_thumbnail",
  { reference, observedSaveId },
);
```

Keep the current `Uint8Array` / `ArrayBuffer` normalization and `thumbnailCorrupt` typed error. Delete the complete `readDevelopmentThumbnail()` function.

- [ ] **Step 5: Run persistence command tests**

```bash
bun run --cwd apps/game test src/lib/persistence/commands.test.ts
```

Expected: PASS for direct invoke, binary submit/read, and structured errors.

- [ ] **Step 6: Check that persistence source contains no browser transport**

```bash
rg -n 'developmentHttpBase|assertDevelopmentFallback|throwHttpError|developmentJson|readDevelopmentThumbnail|fetch\(|127\.0\.0\.1:1421|__TAURI_INTERNALS__' \
  apps/game/src/lib/persistence/commands.ts \
  apps/game/src/lib/persistence/commands.test.ts
```

Expected: no matches.

- [ ] **Step 7: Commit Task 3**

```bash
git add \
  apps/game/src/lib/persistence/commands.ts \
  apps/game/src/lib/persistence/commands.test.ts
git commit -m "refactor(save): use Tauri-only persistence commands"
```

---

### Task 4: Delete the Rust development HTTP server and server-only facade

**Files:**
- Delete: `apps/game/src-tauri/examples/dev_engine_server.rs`
- Modify: `apps/game/src-tauri/Cargo.toml`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify only if proven server-only: `apps/game/src-tauri/src/game/error.rs`

**Interfaces:**
- Consumes: existing Tauri command/core implementations in `src/lib.rs`.
- Produces: no new interface; removes the alternate development-server API.

- [ ] **Step 1: Record exact server-only symbol ownership before deletion**

```bash
rg -n \
  'DevelopmentCommandResponse|DevelopmentExitDriver|build_development_app_state|dispatch_development_command(_with_exit)?' \
  apps/game/src-tauri
```

Expected baseline: matches are confined to `src/lib.rs` and `examples/dev_engine_server.rs` plus co-located tests of those development functions. If a live non-server caller appears, stop before deletion and amend this design rather than inventing an adapter.

Also confirm the HTTP-origin error is server-only:

```bash
rg -n 'request_origin_forbidden|requestOriginForbidden' apps/game/src-tauri
```

Expected baseline: definition in `game/error.rs` plus usage/test in the HTTP server only.

- [ ] **Step 2: Delete the standalone server file and Cargo feature**

Delete:

```text
apps/game/src-tauri/examples/dev_engine_server.rs
```

In `apps/game/src-tauri/Cargo.toml`, change:

```toml
[features]
default = []
dev-engine-server = []
e2e = ["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"]
```

to:

```toml
[features]
default = []
e2e = ["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"]
```

- [ ] **Step 3: Remove the development dispatch API from `src/lib.rs`**

Using the Step 1 symbol list, delete the server-only family in full:

```text
DevelopmentCommandResponse
DevelopmentExitDriver
build_development_app_state
dispatch_development_command
dispatch_development_command_with_exit
```

Delete the command-name switch, response-content-type/body wrapper, and tests whose only subject is development-server dispatch parity.

Preserve shared gameplay command cores, save/load persistence, thumbnail validation/storage, application exit behavior, and E2E checkpoint functions used by Tauri commands or packaged tests.

Do not move surviving code to new files solely because deletion leaves gaps in `lib.rs`; HPA-521 owns broader persistence/application decomposition.

- [ ] **Step 4: Remove the now-unused HTTP-origin error**

After the server and development dispatch functions are gone, run:

```bash
rg -n 'request_origin_forbidden|requestOriginForbidden' apps/game/src-tauri
```

If only the constructor definition remains in `game/error.rs`, delete that constructor. If a live Tauri/E2E caller remains, keep it and record the caller in the implementation PR description instead of deleting it.

Do not remove generic `GameError::parse_failure` solely because the HTTP server used it; it may have non-HTTP owners.

- [ ] **Step 5: Run Rust tests across all remaining features**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Expected: PASS. There is no `dev-engine-server` feature to compile.

- [ ] **Step 6: Run Rust format and lint checks**

```bash
bun run --cwd apps/game rust:fmt
bun run --cwd apps/game rust:lint
```

Expected: PASS with no dead-code/import fallout from the deleted facade.

- [ ] **Step 7: Verify the Rust server is absent**

```bash
rg -n 'dev_engine_server|dev-engine-server|DevelopmentCommandResponse|DevelopmentExitDriver|build_development_app_state|dispatch_development_command' \
  apps/game/src-tauri
```

Expected: no matches.

- [ ] **Step 8: Commit Task 4**

Stage the guaranteed files first:

```bash
git add \
  apps/game/src-tauri/Cargo.toml \
  apps/game/src-tauri/src/lib.rs \
  apps/game/src-tauri/examples/dev_engine_server.rs
```

If Step 4 changed `game/error.rs`, stage it too:

```bash
git add apps/game/src-tauri/src/game/error.rs
```

Then commit:

```bash
git commit -m "refactor(tauri): remove dev HTTP engine server"
```

---

### Task 5: Prove there is one supported command transport

**Files:**
- No planned source file beyond Tasks 1-4.
- Current planning survey found no active README/contributor script that launches `dev_engine_server`; historical specs/plans remain historical.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: verified repository state with one Tauri command transport.

- [ ] **Step 1: Re-run the repository survey for stale live command-server references**

```bash
rg -n \
  'dev_engine_server|dev-engine-server|DEV_HTTP_BASE|developmentHttpBase|httpInvoke|127\.0\.0\.1:1421' \
  . \
  --glob '!docs/superpowers/**' \
  --glob '!target/**' \
  --glob '!node_modules/**'
```

Expected from the planning survey: no live command-server reference remains after Tasks 1-4. If this exposes an active README/contributor instruction not present during planning, stop and amend the plan before changing documentation; do not improvise a replacement workflow inside implementation.

- [ ] **Step 2: Verify the unrelated HMR port is intentionally retained**

```bash
rg -n '1421' apps/game/vite.config.ts
```

Expected: the `TAURI_DEV_HOST` HMR configuration still uses port `1421`. This match is not a HPA-559 failure.

- [ ] **Step 3: Prove frontend application source has no command HTTP fallback**

```bash
rg -n \
  'DEV_HTTP_BASE|developmentHttpBase|httpInvoke|127\.0\.0\.1:1421|__TAURI_INTERNALS__' \
  apps/game/src/lib \
  apps/game/src/routes
```

Expected: no production command-transport matches. Packaged E2E helpers under `apps/game/e2e-tauri/**` are outside this search and are not deleted by name alone.

- [ ] **Step 4: Run deterministic workspace verification**

```bash
bun run test
bun run check
bun run lint:all
```

Expected: all pass. No test should require a browser HTTP game engine.

- [ ] **Step 5: Run a real packaged Tauri smoke**

```bash
bun run --cwd apps/game test:e2e:smoke
```

Expected: packaged application launches and smoke passes through real Tauri IPC.

- [ ] **Step 6: Reuse the packaged build for one persistence boundary proof**

Run:

```bash
node apps/game/scripts/run-save-e2e.mjs --suite save-core
```

Expected: PASS through real Tauri IPC/filesystem boundaries. If the smoke command cleaned the build as part of its normal lifecycle, use the existing `apps/game` E2E build command once and rerun the two existing suites; do not create a new HPA-559 runner or suite.

- [ ] **Step 7: Confirm the implementation is a material deletion**

```bash
git diff --stat main...HEAD
git diff --numstat main...HEAD | awk '{ add += $1; del += $2 } END { print "added", add, "deleted", del, "net", add-del }'
```

Acceptance: deleted production/test lines materially exceed additions. Do not count planning-document length as justification for implementation complexity.

---

## Final Review Checklist

Before marking HPA-559 ready for merge, verify:

- [ ] `game-client.svelte.ts` has no environment transport branch.
- [ ] `persistence/commands.ts` has no environment transport branch.
- [ ] Page/component tests mock Tauri `invoke` directly and no longer emulate command URLs.
- [ ] `dev_engine_server.rs` and `dev-engine-server` feature are gone.
- [ ] Server-only development dispatch APIs/tests are gone, not moved or renamed.
- [ ] Shared Tauri command cores and current thumbnail behavior remain unchanged.
- [ ] Vite HMR port `1421` remains intact.
- [ ] No replacement transport abstraction was introduced.
- [ ] Full deterministic tests/checks/lints pass.
- [ ] Packaged smoke + save-core pass through real Tauri IPC.
- [ ] Implementation shows a material net deletion.
- [ ] HPA-550, HPA-521, HPA-536, HPA-560, HPA-602, and Chapter 2 remain out of scope.
