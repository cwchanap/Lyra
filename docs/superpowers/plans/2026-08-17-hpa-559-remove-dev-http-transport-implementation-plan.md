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
| `apps/game/src-tauri/src/game/error.rs` | Remove HTTP-only `GameError` constructors only if the repository-wide usage check proves they have no remaining caller. |

### Tests to modify

| File | Responsibility after HPA-559 |
|---|---|
| `apps/game/src/lib/state/game-client-source.test.ts` | Mocks Tauri `invoke` directly; no fake `__TAURI_INTERNALS__` branch selection. |
| `apps/game/src/lib/persistence/commands.test.ts` | Tests exact Tauri command shapes and structured errors directly. |
| `apps/game/src/routes/page.test.ts` | Stubs application commands through `mocks.invoke`, not `fetch()` URLs. |

### Files explicitly not changed for the port-number coincidence

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

Keep the existing `@tauri-apps/api/core` mock. Add or tighten one focused assertion:

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

Run:

```bash
bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected before production change: the new no-global test attempts the HTTP fallback instead of `mocks.invoke`, so the command does not apply the mocked Tauri response.

- [ ] **Step 3: Remove gameplay transport branching**

In `apps/game/src/lib/state/game-client.svelte.ts`, delete:

```ts
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const DEV_HTTP_BASE = "http://127.0.0.1:1421";
```

Delete `httpInvoke<T>()` in full.

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

Run:

```bash
bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected: PASS, including the no-`__TAURI_INTERNALS__` regression.

- [ ] **Step 5: Run a source absence check for the gameplay HTTP branch**

Run:

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

- [ ] **Step 1: Replace the page-test transport mock shape**

In the hoisted `mocks` object, remove:

```ts
fetch: vi.fn(),
```

Delete the HTTP-only helpers:

```ts
function jsonResponse(...)
function jsonError(...)
```

Delete every `vi.stubGlobal("fetch", mocks.fetch)` and `mocks.fetch.mockReset()` whose only purpose is the game-engine fallback.

Keep the existing `@tauri-apps/api/core` mock:

```ts
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));
```

- [ ] **Step 2: Convert scene-navigation stubbing to command-based invocation**

Replace the HTTP helper with:

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

Update callers from `stubFetchForSceneNavigation()` to `stubInvokeForSceneNavigation()`.

- [ ] **Step 3: Convert acquisition acknowledgement stubbing to command-based invocation**

Replace the HTTP helper with:

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

For tests that need to inspect acknowledgement args, extend the callback signature rather than parsing a URL:

```ts
mocks.invoke.mockImplementation(
  async (command: string, args?: Record<string, unknown>) => {
    // assert/branch on command + args
  },
);
```

- [ ] **Step 4: Convert every remaining `mocks.fetch` setup in the file**

Search:

```bash
rg -n 'mocks\.fetch|stubGlobal\("fetch"|127\.0\.0\.1:1421|jsonResponse|jsonError' \
  apps/game/src/routes/page.test.ts
```

For each remaining hit, map the old URL path directly to the same command string passed to `mocks.invoke`. Preserve the exact response object/error the test previously supplied.

When the old test simulated an HTTP error response such as:

```ts
jsonError({ code: "saveWriteFailed", message: "Save could not be written." })
```

make the Tauri mock reject with the typed error instead:

```ts
mocks.invoke.mockRejectedValueOnce({
  code: "saveWriteFailed",
  message: "Save could not be written.",
});
```

Do not add a generic fake transport helper; use the existing hoisted `mocks.invoke` seam.

- [ ] **Step 5: Run the page test suite**

Run:

```bash
bun run --cwd apps/game test src/routes/page.test.ts
```

Expected: PASS with no network/fetch emulation.

- [ ] **Step 6: Verify the page test no longer knows about the HTTP engine**

Run:

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

- [ ] **Step 1: Make the persistence transport tests import without a fake Tauri global**

Simplify `loadCommands()` in `commands.test.ts` from runtime-global setup to a normal import:

```ts
async function loadCommands() {
  return import("./commands");
}
```

Remove the `afterEach` cleanup that deletes `window.__TAURI_INTERNALS__` when no test needs it.

Add a focused regression:

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

If the Tauri mock records a one-argument call when `args` is `undefined`, assert that exact existing invocation shape instead of adding an adapter only to normalize test calls.

- [ ] **Step 2: Run the focused persistence-command tests and confirm the new regression fails before production changes**

Run:

```bash
bun run --cwd apps/game test src/lib/persistence/commands.test.ts
```

Expected before production change: without the fake global, `commands.ts` selects its HTTP fallback and does not call `mocks.invoke`.

- [ ] **Step 3: Delete JSON HTTP fallback helpers from `commands.ts`**

Delete:

```ts
const isTauri = ...;
const developmentHttpBase = "http://127.0.0.1:1421";
function assertDevelopmentFallback() { ... }
function throwHttpError(...) { ... }
async function developmentJson<T>(...) { ... }
```

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

Keep the existing Tauri submit shape exactly:

```ts
return await invoke<ThumbnailActivityView>(
  "submit_save_thumbnail",
  bytes,
  { headers: { [thumbnailTicketHeader]: ticket } },
);
```

Delete the HTTP `fetch()` branch from `submitSaveThumbnail()`.

Change `readSaveThumbnail()` to invoke Tauri directly:

```ts
const response = await invoke<ArrayBuffer | Uint8Array>(
  "read_save_thumbnail",
  { reference, observedSaveId },
);
```

Keep the current `Uint8Array` / `ArrayBuffer` normalization and `thumbnailCorrupt` typed error.

Delete `readDevelopmentThumbnail()`.

- [ ] **Step 5: Run persistence command tests**

Run:

```bash
bun run --cwd apps/game test src/lib/persistence/commands.test.ts
```

Expected: PASS for direct invoke, binary submit/read, and structured errors.

- [ ] **Step 6: Check that persistence source contains no browser transport**

Run:

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

Run:

```bash
rg -n \
  'DevelopmentCommandResponse|DevelopmentExitDriver|build_development_app_state|dispatch_development_command(_with_exit)?' \
  apps/game/src-tauri
```

Expected baseline: matches are confined to `src/lib.rs` and `examples/dev_engine_server.rs` plus any tests co-located with those functions. If another live non-server caller appears, inspect it before deleting the symbol; do not invent a replacement adapter pre-emptively.

Also inspect HTTP-only error helpers:

```bash
rg -n \
  'request_origin_forbidden|request_parse_failure|requestOriginForbidden|requestParse' \
  apps/game/src-tauri
```

Any constructor/code used only by the server may be deleted with the server. A constructor used by Tauri or packaged E2E stays.

- [ ] **Step 2: Delete the standalone server file and Cargo feature**

Delete:

```text
apps/game/src-tauri/examples/dev_engine_server.rs
```

In `apps/game/src-tauri/Cargo.toml`, remove only:

```toml
dev-engine-server = []
```

Keep:

```toml
[features]
default = []
e2e = ["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"]
```

- [ ] **Step 3: Remove the development dispatch API from `src/lib.rs`**

Using the Step 1 symbol list, delete the server-only family:

```text
DevelopmentCommandResponse
DevelopmentExitDriver
build_development_app_state
dispatch_development_command
dispatch_development_command_with_exit
```

Delete the command-name switch and serialization/binary response glue owned only by these development functions.

Delete tests whose only subject is that development dispatch switch.

Preserve the functions/types that the Tauri commands and packaged E2E still own, including shared gameplay command cores, save/load application persistence, thumbnail validation/storage, application exit behavior, and E2E checkpoint functions.

Do not move surviving code to new files solely because deletion leaves gaps in `lib.rs`; HPA-521 owns broader persistence/application decomposition.

- [ ] **Step 4: Remove now-unused HTTP-only `GameError` constructors**

Re-run:

```bash
rg -n \
  'request_origin_forbidden|request_parse_failure|requestOriginForbidden|requestParse' \
  apps/game/src-tauri
```

If the only remaining matches are definitions in `game/error.rs`, delete those definitions and any tests specific to them. If there is a live Tauri/E2E caller, keep the constructor.

Do not rename an HTTP-only error to keep it alive artificially.

- [ ] **Step 5: Run Rust tests across all remaining features**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Expected: PASS. There is no `dev-engine-server` feature to compile.

- [ ] **Step 6: Run Rust format and lint checks**

Run:

```bash
bun run --cwd apps/game rust:fmt
bun run --cwd apps/game rust:lint
```

Expected: PASS with no dead-code/import fallout from the deleted facade.

- [ ] **Step 7: Verify the Rust server is absent**

Run:

```bash
rg -n 'dev_engine_server|dev-engine-server|DevelopmentCommandResponse|DevelopmentExitDriver|build_development_app_state|dispatch_development_command' \
  apps/game/src-tauri
```

Expected: no live code/config matches. Historical docs outside `apps/game/src-tauri` are not part of this check.

- [ ] **Step 8: Commit Task 4**

```bash
git add \
  apps/game/src-tauri/Cargo.toml \
  apps/game/src-tauri/src/lib.rs \
  apps/game/src-tauri/src/game/error.rs \
  apps/game/src-tauri/examples/dev_engine_server.rs
git commit -m "refactor(tauri): remove dev HTTP engine server"
```

If `game/error.rs` is unchanged, omit it from `git add` rather than making a no-op edit.

---

### Task 5: Audit live instructions and prove there is one command transport

**Files:**
- Modify only if a live instruction is found: current README / agent / contributor documentation.
- Do not modify historical design/plan records solely to remove old mentions.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: repository state with no supported legacy command-server workflow and no stale active instruction requiring it.

- [ ] **Step 1: Search the repository for old transport instructions**

Run:

```bash
rg -n \
  'dev_engine_server|dev-engine-server|DEV_HTTP_BASE|developmentHttpBase|httpInvoke|127\.0\.0\.1:1421' \
  . \
  --glob '!docs/superpowers/**' \
  --glob '!target/**' \
  --glob '!node_modules/**'
```

Classify each hit:

- production/test code: must be gone unless it is the unrelated HMR configuration;
- active README/agent/contributor instruction: update to `bun run dev:game`, component tests, or packaged Tauri E2E as appropriate;
- generated/cache/build output: do not commit; clean only if required by normal tooling.

Do not rewrite historical specs/plans for chronology.

- [ ] **Step 2: Verify the HMR port is intentionally retained**

Run:

```bash
rg -n '1421' apps/game/vite.config.ts
```

Expected: the `TAURI_DEV_HOST` HMR configuration still uses port `1421`.

This match is not a HPA-559 failure.

- [ ] **Step 3: Prove frontend production source has no command HTTP fallback**

Run:

```bash
rg -n \
  'DEV_HTTP_BASE|developmentHttpBase|httpInvoke|127\.0\.0\.1:1421|__TAURI_INTERNALS__' \
  apps/game/src/lib \
  apps/game/src/routes
```

Expected: no production command-transport matches. Legitimate packaged E2E helpers under `apps/game/e2e-tauri/**` are outside this search and are not to be deleted by name alone.

- [ ] **Step 4: Run the deterministic frontend/workspace verification**

Run:

```bash
bun run test
bun run check
bun run lint:all
```

Expected: all pass. No test should need a browser HTTP game engine.

- [ ] **Step 5: Run a real packaged Tauri smoke**

Run:

```bash
bun run --cwd apps/game test:e2e:smoke
```

Expected: packaged application launches and the smoke suite passes through real Tauri IPC.

- [ ] **Step 6: Reuse the packaged build for one persistence boundary proof**

If `test:e2e:smoke` left the packaged E2E build in the normal runner location, run without rebuilding:

```bash
node apps/game/scripts/run-save-e2e.mjs --suite save-core
```

Expected: PASS through real Tauri IPC/filesystem boundaries.

If the smoke command cleans the build by design, use the existing repository command that builds once then runs `save-core`; do not create a new HPA-559 runner or suite.

- [ ] **Step 7: Confirm the change is a material deletion**

Run:

```bash
git diff --stat main...HEAD
git diff --numstat main...HEAD | awk '{ add += $1; del += $2 } END { print "added", add, "deleted", del, "net", add-del }'
```

Acceptance: deletion materially exceeds added production/test lines. Planning docs are not counted as a reason to preserve implementation complexity; the implementation diff should clearly remove the server/branching surface.

- [ ] **Step 8: Commit any live-instruction cleanup**

Only if Step 1 found a current instruction that required editing:

```bash
git add <exact-current-doc-paths>
git commit -m "docs: retire legacy browser engine workflow"
```

If there is no live documentation change, do not create an empty commit.

---

## Final Review Checklist

Before marking HPA-559 ready for merge, verify all of the following against the spec:

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
