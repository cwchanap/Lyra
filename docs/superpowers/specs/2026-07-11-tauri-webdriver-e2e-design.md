# Tauri WebDriver E2E (Replace Playwright) Design

**Date:** 2026-07-11  
**Status:** Approved design (amended after review)

## Summary

Replace the Playwright browser e2e suite with WebdriverIO +
`@wdio/tauri-service` driving a **real Tauri desktop binary** that loads
**production compiled scenes** through real `invoke` IPC. Delete Playwright,
its mocks (`__TAURI_INTERNALS__`), and the browser-preview CI job. Run the new
suite locally on macOS and in GitHub Actions on Linux (headless via xvfb).

The e2e binary is built with **Cargo feature `e2e`** (debug profile,
`--no-bundle`) so the embedded WebDriver plugin is linked only for that
target. The frontend is still produced by `vite build`, so
`import.meta.env.DEV === false` and the scene-nav production gate is real.
Ordinary `bun run dev:game` does **not** enable `e2e` and must not open a
WebDriver port.

## Goals

- Full replacement of Playwright e2e (no parallel dual suite after cutover).
- Real shell + real engine + production resources (no JS Tauri mock).
- Community WDIO Tauri path (embedded WebDriver plugin) for macOS local +
  Linux CI without CrabNebula. Official Tauri docs document `tauri-driver`;
  `@wdio/tauri-service` + `tauri-plugin-wdio-webdriver` is the WDIO-community
  convenience path, not a Tauri-apps-maintained crate.
- Linux CI from day one; macOS for local developer runs.
- Port the **intent** of the three existing specs (app shell, investigation
  layout, scene-nav production gate).
- Isolated e2e WebView storage (no pollution of the developer’s normal app
  data; Spec C starts from empty clearance).

## Non-goals

- Fixture-only or mocked-IPC desktop suites as the primary path.
- Expanding coverage beyond the intent of the current three specs.
- Layout-editor app e2e.
- Multi-OS CI matrix (Windows / macOS runners) in v1.
- Test-only error-injection commands (error-banner e2e deferred; unit coverage
  remains).
- Changing engine behavior, scene authoring format, or production resource
  layout beyond what e2e packaging already requires.
- Shipping the WebDriver plugin (or its permissions) in store/release
  artifacts, or enabling it during normal `dev:game`.

## Background

Today:

- `apps/game/e2e/*.spec.ts` + `playwright.config.ts` run the **built static
  SPA** via `vite preview` on port 4173.
- Specs inject a browser-side `__TAURI_INTERNALS__.invoke` mock with fake
  chapter/scene views. Real Tauri IPC is never exercised.
- The existing scene-nav e2e already exercises `import.meta.env.DEV === false`
  via the production Vite build served by `vite preview` — the gap is **real
  IPC + real shell**, not the DEV flag.
- Playwright page contexts isolate storage; a real Tauri WebView does **not**.
  Reusing the production app identifier would share `localStorage` with the
  developer’s normal install.
- AGENTS.md documents the mock-IPC limitation and that full desktop smoke is
  `bun run dev:game`.
- Rust already has engine integration tests under
  `apps/game/src-tauri/tests/` (e.g. `full_playthrough.rs`) that do **not**
  cover the WebView UI.
- CI job `e2e` (Playwright E2E) installs Chromium and runs `bun run test:e2e`.
- Root `test:e2e` is Turbo-filtered to `@lyra/game`. Turbo currently has
  `test:e2e.dependsOn: ["build"]`, which only runs the **Vite** `build` task —
  not a Tauri binary build.

Scene-nav gate (frontend only):

```ts
// apps/game/src/routes/+page.svelte
sceneNavigationEnabled = import.meta.env.DEV || storyClearedOnce
```

`import.meta.env.DEV` is a **Vite** compile-time flag. It is `false` after any
`vite build` (including Tauri `beforeBuildCommand`), regardless of Cargo
debug vs release. A Cargo **release** profile is therefore **not** required
for Spec C.

## Architecture

### Layers under test

| Layer | Role |
| --- | --- |
| Authored scenes → `bun run scenes:compile` | Production resources bundled into the app |
| Rust `GameEngine` + `#[tauri::command]` handlers | Real backend |
| Svelte SPA in the OS WebView (`vite build`) | Real UI with `DEV=false` |
| WDIO + `@wdio/tauri-service` + embedded driver | Automation only |

### Build profile (critical)

| Concern | Profile / flag |
| --- | --- |
| Frontend | `vite build` via Tauri `beforeBuildCommand` → `import.meta.env.DEV === false` |
| Rust binary | **Debug** + **`--features e2e`** (`tauri build --debug --no-bundle --features e2e` or equivalent) |
| Bundle packaging | `--no-bundle` → unbundled `src-tauri/target/debug/lyra` |
| Embedded WebDriver plugin | Linked and registered **only** under `#[cfg(feature = "e2e")]` |
| WebDriver capability | Present **only** in e2e builds (see Capabilities) |
| App identity / storage | **E2E-only** Tauri `identifier` (separate from production) |
| Ordinary `dev:game` / release | No `e2e` feature → no plugin, no WebDriver port, production identifier |

**Why feature `e2e`, not `cfg(debug_assertions)` alone:**

1. Cargo cannot use `cfg(debug_assertions)` to *conditionally add* crate
   dependencies the way `[target.'cfg(...)'.dependencies]` works for OS
   targets. Optional deps must use a **Cargo feature** (or always depend and
   cfg-gate usage — still wrong for “not in dev”).
2. Registering the plugin under only `#[cfg(debug_assertions)]` would open the
   default WebDriver HTTP server (port **4445**) on **every** ordinary
   `bun run dev:game` debug session — not “e2e only.”
3. Feature `e2e` is enabled **only** by the e2e build scripts. Dev and
   release never pass it.

Optional hardening (recommended): compile-fail if `feature = "e2e"` is set
without `debug_assertions`, so a mistaken `cargo build --release --features e2e`
cannot ship the server:

```rust
#[cfg(all(feature = "e2e", not(debug_assertions)))]
compile_error!("feature \"e2e\" is only for debug e2e builds");
```

### Capabilities (v1 blocker — not a follow-up)

Tauri ACL resolves permissions at **build** time. Referencing a permission
whose plugin is not linked fails the build with errors of the form
`Permission <id> not found` (same class of failure as
tauri-apps/plugins-workspace#2261 for unlinked plugins).

Therefore **do not** put `"wdio-webdriver:default"` permanently in the shared
`capabilities/default.json`. That would break `bun run build:tauri` / release
paths whenever the plugin is not linked.

**v1 mechanism (required), tied to feature `e2e`:**

1. Keep `capabilities/default.json` free of WebDriver permissions (production
   and normal dev path unchanged).
2. When building with `--features e2e`, ensure a capability fragment is present
   that grants `"wdio-webdriver:default"` for the main window (e.g. generated
   `capabilities/wdio-e2e.json`).
3. When building without `e2e`, that fragment must be **absent** so release ACL
   never references the permission.
4. Lifecycle: `build.rs` and/or the `test:e2e:build` prep step creates the
   fragment when `CARGO_FEATURE_E2E` / `LYRA_E2E=1` is set, and removes it
   otherwise (or never commits a permanent file that release builds would
   pick up).
5. Migration step 1 **must** prove both:
   - e2e build (`--features e2e`, debug, e2e config) succeeds with plugin +
     capability
   - release / default build succeeds **without** the permission and without
     the plugin
   - ordinary `dev:game` does not open port 4445

### E2E app identity and WebView storage (v1 blocker)

Real Tauri WebViews persist origin storage. Playwright’s isolated page
contexts do not. If the e2e binary reuses production
`identifier` (`com.chanwaichan.lyra`), Spec C and local runs will:

- inherit a developer’s existing `lyra.storyClearedOnce.v1` (false “cleared”
  assumptions)
- write clearance / other keys into the same store the normal app uses

**v1 requirements:**

1. **E2E-only Tauri config** (e.g. `tauri.e2e.conf.json` merged/overlaid like
   `tauri.dev.conf.json`) that sets a distinct
   `identifier` such as `com.chanwaichan.lyra.e2e` (and any related bundle id
   fields the platform uses for WebView data directories).
2. E2e builds invoke Tauri with that config (`tauri build -c …e2e…` or
   documented merge path).
3. **Helper `resetE2eStorage()`** (or equivalent) runs at the start of each
   test (or suite hook):
   - `browser.execute` → remove known Lyra keys (at least
     `STORY_CLEARED_STORAGE_KEY`) or `localStorage.clear()` if no other
     durable keys must survive within a single test
   - `browser.refresh()` so the SPA re-reads storage on cold init
4. Spec C “empty storage” cases rely on this reset, not on process isolation
   alone.
5. `seedStoryCleared()` runs **after** reset: set key → reload → assert.

### Plugin / crate disambiguation

Three near-named pieces exist; only the first is required for v1:

| Crate / package | npm counterpart | Purpose | v1 |
| --- | --- | --- | --- |
| `tauri-plugin-wdio-webdriver` | (none; used by `@wdio/tauri-service`) | Embedded W3C WebDriver HTTP server | **Required** |
| `tauri-plugin-wdio` | `@wdio/tauri-plugin` | `browser.tauri.execute()`, invoke mocking, log capture | Deferred |
| `tauri-plugin-webdriver` | (none) | Older Choochmeque crate that `wdio-webdriver` forked from | Do not use |

Basic DOM automation (click, keyboard, assertions) works with the embedded
server alone. Advanced execute/mock/log APIs need the second row and are out
of v1 scope.

### New components

1. **Cargo feature `e2e` (mandatory for WebDriver):**

   ```toml
   [features]
   e2e = ["dep:tauri-plugin-wdio-webdriver"]
   # existing features unchanged

   [dependencies]
   tauri-plugin-wdio-webdriver = { version = "=…", optional = true }
   ```

   ```rust
   #[cfg(feature = "e2e")]
   let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
   ```

   Pin an explicit version (not a floating caret). Prefer a version published
   at least ~7 days before adoption; if `1.2.x` is too new relative to
   adoption, pin `=1.0.0` or the oldest compatible `1.x` that supports
   embedded provider + Tauri 2.

2. **Capabilities (e2e-only):** gated `"wdio-webdriver:default"` as above —
   **not** a permanent line in `default.json`.

3. **E2E Tauri config** with distinct `identifier` (storage isolation).

4. **WDIO project** under `apps/game/`:
   - `wdio.conf.ts` lives in `apps/game/`. Service key
     `@wdio/tauri-service`. Options: `driverProvider: 'embedded'`,
     `appBinaryPath: './src-tauri/target/debug/lyra'` (**relative to the
     config file directory**, not the monorepo root). If the installed
     service also honors `tauri:options.application`, set one canonical path
     and avoid conflicting overrides.
   - `e2e-tauri/` — specs, helpers, production anchors

5. **Build pipeline for e2e:** prepare e2e capability →
   `tauri build --debug --no-bundle` with `--features e2e` and e2e config →
   WDIO launches `./src-tauri/target/debug/lyra`.

6. **CI:** Linux job with Tauri WebKit/GTK runtime/build deps + xvfb; no
   Playwright; no webkit2gtk-driver required for the embedded provider. CI
   entry **must** run the build-and-run script (see Package scripts).

### Explicit deletions after cutover

- `apps/game/e2e/`
- `apps/game/playwright.config.ts`
- Root / app `@playwright/test` dependency
- Playwright install/report steps in `.github/workflows/ci.yml`
- Playwright-specific `test:e2e:ui` (replace with WDIO watch only if useful)

### Out of scope systems

- `full_playthrough.rs` and other Rust engine tests stay as-is.
- Vitest unit/component tests stay as-is (including error-banner unit paths).
- Layout editor is not part of this suite.

## Suite map (Playwright → Tauri WDIO)

Port **intent**, re-anchor on **production content**. No mock views and no
fake “測試開始。” strings.

### Shared helpers (`e2e-tauri/helpers.ts`)

- `resetE2eStorage()` — clear relevant webview `localStorage` (at least story
  clearance; prefer clear of known Lyra keys), then reload and wait for shell.
  Called from a global `beforeEach` (or equivalent) so every test starts clean
  on the e2e app identifier.
- `startFromMenu()` — app ready → 開始調查 → wait for first real dialogue
- `advanceDialogueUntil(predicate)` — wait typewriter complete → 推進對話;
  loop until explore/menu-ready; hard cap with a clear failure. **Cap value
  is not fixed at 50 in the abstract** — during migration step 2, count
  production chapter_1 intro dialogue items (compiled JSON / authored
  scenes) and set the cap to **intro length + comfortable margin**. Document
  the chosen number next to the helper.
- `openGameMenu()` / `closeGameMenu()` — Escape + assert dialog accessible names
- `seedStoryCleared()` — **after** `resetE2eStorage()` (or after an explicit
  clear in that test): set-then-reload. W3C WebDriver has no Playwright-style
  `addInitScript`. With the embedded server alone:

  1. Wait until the webview document is available.
  2. `browser.execute` → `localStorage.setItem(STORY_CLEARED_STORAGE_KEY, "true")`
  3. `browser.refresh()`
  4. Wait for app shell so `loadStoryClearedOnce()` runs on a cold SPA init.

  Do not document a fictional pre-navigation init script as the primary path.

- Stable role selectors (遊戲選單, 物證 / EVIDENCE, 推進對話, etc.)

### Production anchors (`e2e-tauri/production-anchors.ts`)

Single source of chapter/scene/hotspot/character/topic IDs and Chinese labels
the suite depends on. Authoring renames fail CI with an obvious file to
update. Anchors are chosen from compiled production chapter_1 (or the
earliest stable investigation entry after intro).

### Spec A — App shell (`app.e2e.ts`)

| Old (mocked) | New (production) |
| --- | --- |
| Advance into investigation controls | Start → drain intro → assert explore controls (sublocation + hotspot/topic labels from anchors) |
| Escape opens game menu | Same; 繼續調查 focused; inventory entry visible |
| Portrait in viewport | Assert during a portrait-bearing production dialogue line |
| Acquisition popup sequence | Inspect a known production hotspot that yields evidence; assert 物證取得 → dismiss → optional 證言 → inventory |
| Command error banner | **Deferred in v1** (unit coverage remains). Revisit if a stable early locked hotspot exists or a test-only command is later approved |

### Spec B — Investigation layout (`investigation-layout.e2e.ts`)

| Old | New |
| --- | --- |
| Click placed hotspot | Production hotspot with rect layout (not list-only fallback) |
| Character hover CSS | Production sprite-layout character; assert highlight/name **opacity** on hover (and that name becomes visible). **Intentionally drop** the old Playwright pixel geometry asserts (`top: 10px`, `right: 10px`, `font-size: 18px`) — pure layout CSS / flaky across WebKit. Opacity/visibility is the e2e interaction contract. |
| Escape closes topic popover before menu | Open topics → Escape → popover gone, menu not open → Escape → 遊戲選單 |

### Spec C — Scene nav prod gate (`scene-navigation-gate.e2e.ts`)

| Old | New |
| --- | --- |
| Hide 場景跳轉 when not cleared | E2e binary + production frontend (`DEV=false`) + **reset storage** → no 場景跳轉 |
| Show when cleared | After reset, `seedStoryCleared()` then open menu → 場景跳轉 visible |

**What this gains over Playwright:** real Tauri shell + real `invoke` +
production scene resources + isolated e2e storage. It does **not** uniquely
gain `DEV=false` — the old suite already got that from `vite preview`. Frame
the win as **end-to-end desktop fidelity**, not as the first production-gate
coverage.

### Non-ports

- `installTauriMock` / `__TAURI_INTERNALS__`
- `shouldRegisterPlaywrightSuite` Bun guard
- Exact mock dialogue/evidence strings
- Playwright `addInitScript` pre-init injection (use set-then-reload)
- Exact pixel geometry CSS asserts from the old hover test
- Sharing production app identifier / WebView data with e2e

## Tooling and layout

```
apps/game/
  e2e-tauri/
    production-anchors.ts
    helpers.ts
    app.e2e.ts
    investigation-layout.e2e.ts
    scene-navigation-gate.e2e.ts
  wdio.conf.ts
  package.json                    # test:e2e = build+run; test:e2e:run = WDIO only
  src-tauri/
    Cargo.toml                    # feature e2e + optional plugin dep
    tauri.e2e.conf.json           # distinct identifier for storage isolation
    build.rs                      # capability fragment lifecycle for e2e
    capabilities/
      default.json                # production — no wdio-webdriver permission
      wdio-e2e.json               # present only when feature e2e is building
    src/lib.rs                    # #[cfg(feature = "e2e")] plugin init
```

### npm / bun packages (`apps/game` devDependencies)

- `webdriverio`
- `@wdio/cli`
- `@wdio/local-runner`
- `@wdio/mocha-framework` (keep runner simple; no Cucumber)
- `@wdio/spec-reporter`
- `@wdio/tauri-service`

Optional later (second plugin row above): `@wdio/tauri-plugin` + Cargo
`tauri-plugin-wdio` for execute/mock/logs — not required for v1 DOM + real-IPC
tests.

### Cargo + capabilities + identity checklist

- Feature `e2e` enables optional `tauri-plugin-wdio-webdriver` (pinned)
- `#[cfg(feature = "e2e")]` plugin registration
- Recommended: `compile_error!` if `e2e` without `debug_assertions`
- **Gated** `"wdio-webdriver:default"` capability (e2e builds only)
- **E2E-only** Tauri `identifier` (e.g. `com.chanwaichan.lyra.e2e`)
- Never leave WebDriver permission in the ACL graph of a non-e2e build
- Never enable `e2e` for `dev:game` or store/release builds

### WDIO config essentials

- Config file: `apps/game/wdio.conf.ts`
- Service: `['@wdio/tauri-service', { ... }]`
- `driverProvider: 'embedded'`
- `appBinaryPath: './src-tauri/target/debug/lyra'` (relative to config dir)
- Prefer explicit path over discovery; avoid conflicting
  `tauri:options.application` overrides
- `maxInstances: 1` (one desktop app)
- Elevated command timeouts (typewriter + production dialogue)
- CI retries: 1–2; local: 0
- Global hook: `resetE2eStorage()` before each test

## Build and scripts

### Build under test

1. Prepare e2e capability fragment (feature `e2e` / `LYRA_E2E=1`).
2. From `apps/game`, build with **debug**, **`--features e2e`**, **e2e Tauri
   config**, **`--no-bundle`**. Exact CLI shape is implementation detail
   (e.g. `tauri build --debug --no-bundle -c src-tauri/tauri.e2e.conf.json`
   plus Cargo feature pass-through as supported by the Tauri CLI / env).
   `beforeBuildCommand` still runs `scenes:compile` + `vite build`.
3. WDIO launches `./src-tauri/target/debug/lyra`.

**Do not** double-run `scenes:compile` in the default path:
`beforeBuildCommand` already compiles scenes. An explicit pre-step is only
for local iteration when resources change and the binary is already built.

### Package scripts (naming is load-bearing)

Turbo’s `test:e2e.dependsOn: ["build"]` only runs the **Vite** frontend
build. That is **not** a Tauri binary. Therefore:

| Script | Behavior |
| --- | --- |
| `apps/game` **`test:e2e`** | **Build-and-run** (prepare capability + e2e Tauri build with `--features e2e` + WDIO). This is what root Turbo and CI must invoke. |
| `apps/game` **`test:e2e:run`** | WDIO only (assumes binary already built) — local fast re-run after a successful build |
| Root **`test:e2e`** | `turbo run test:e2e --filter=@lyra/game` → app **`test:e2e`** (build-and-run) |

Update `turbo.json` accordingly:

- `test:e2e` must not rely on Vite-only `dependsOn: ["build"]` as a substitute
  for the Tauri e2e binary. Either drop that dependsOn and let `test:e2e`
  own the full build, or make `dependsOn` include a dedicated
  `test:e2e:prepare` / tauri-e2e-build task that produces
  `src-tauri/target/debug/lyra`. Document the chosen graph in the
  implementation plan.

Drop Playwright `test:e2e:ui` unless a WDIO watch equivalent is added later.

### AGENTS.md / CLAUDE.md

Replace the Playwright preview caveat with: e2e drives a **debug + feature
`e2e`** Tauri binary (embedded WebDriver, e2e app identifier) with a
**production** frontend bundle and production scene resources; requires
platform WebView deps. Note `production-anchors.ts`, storage reset, and that
the WebDriver plugin must never ship in release/store builds or run during
`dev:game`.

## CI

Replace the `e2e` job in `.github/workflows/ci.yml`:

- **Name:** Tauri E2E
- **Runner:** `ubuntu-latest` only (v1)
- **System packages:**
  - **Required:** Tauri Linux build/runtime deps (webkit2gtk, gtk,
    appindicator, etc.) and **xvfb** for a virtual display
  - **Not required** under `driverProvider: 'embedded'`: `webkit2gtk-driver`
    / external `tauri-driver`
- **Steps:** checkout → bun install → rust toolchain + rust-cache (workspace
  `apps/game/src-tauri`) → **`bun run test:e2e`** (build-and-run) under
  `xvfb-run`
- **Artifacts:** WDIO logs (not Playwright HTML). Failure screenshots are
  **not** captured in v1 — the WDIO config has no `screenshotPath`/capture
  hook, so the artifact contract is logs-only. Add screenshot capture and a
  corresponding artifact path as a follow-up only if flake debugging demands
  it.
- **Caching:** Rust target + bun lockfile to limit wall time

Windows/macOS CI matrix is a later option, not v1.

## Error handling and flake policy

- Dialogue drain loops always cap; failure message names the predicate and
  last visible text; cap sized from real intro length + margin.
- Prefer role/accessible-name assertions over brittle full-string equality
  where production copy may grow.
- Soften pure pixel geometry asserts if WebKit differs; keep viewport
  containment and CSS opacity contracts. Spec B hover is opacity/visibility
  only (no exact `px` geometry).
- Serial execution only.
- Storage reset before each test; never assume empty WebView store from a
  fresh OS user alone.

## Migration order

1. Scaffold feature `e2e` + optional plugin + gated capability + e2e Tauri
   config (distinct identifier). **Smoke:**
   - e2e build + WDIO → title / main menu
   - release/default build still succeeds (no unknown permission)
   - `dev:game` does not listen on 4445
2. Helpers: `resetE2eStorage`, dialogue drain (measure intro length), anchors.
3. Port Spec A → B → C.
4. Wire scripts so root/`turbo`/`CI` call **build-and-run** `test:e2e`; delete
   Playwright and old `e2e/`.
5. Update AGENTS.md / CLAUDE.md.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Long production intro | Drain helper with cap sized from real intro + margin |
| Authoring renames break suite | Single anchors file; clear failure text |
| CI build duration | rust-cache; debug unbundled binary |
| Wrong feature/profile (no server / server in dev) | Feature `e2e` only in e2e scripts; optional compile_error for release+e2e |
| Release build fails on unknown permission | Gated capability with feature `e2e` |
| CI runs WDIO without binary | Root/`test:e2e` is build-and-run; turbo graph fixed |
| Flaky Spec C / polluted storage | E2e identifier + `resetE2eStorage` every test |
| Embedded plugin Linux quirks | Follow WDIO embedded docs; only then consider external driver |
| Error-banner gap | Explicitly out of v1; unit tests remain |
| Hover/CSS flake | Opacity/visibility only |
| Community plugin maintenance | Pin versions (prefer ≥7-day-old release) |

## Success criteria

- After e2e build (`--features e2e`, debug, e2e identifier/config),
  `bun run test:e2e` (build-and-run) launches real Tauri and the ported suite
  passes on macOS local and Linux CI.
- Clean CI checkout produces the binary as part of `test:e2e` (no separate
  manual Tauri step required).
- Release/store builds and ordinary `dev:game` succeed **without** the
  WebDriver plugin, **without** `wdio-webdriver` permissions, and **without**
  listening on the WebDriver port.
- E2e WebView storage is isolated from the production app identifier; tests
  reset clearance state before each case.
- No Playwright dependency or browser Tauri mocks remain.
- Real IPC loads production scenes.
- Scene-nav production gate is covered on a production frontend bundle
  (`import.meta.env.DEV === false`) inside the desktop shell.
- Docs describe feature `e2e`, e2e identity, storage reset, and production
  anchors.

## Alternatives considered

1. **Keep Playwright against tauri-driver** — familiar API, but native
   `tauri-driver` is Windows/Linux-centric; macOS needs embedded/CrabNebula.
   Rejected in favor of WDIO + embedded plugin for local macOS + Linux CI.
2. **Thin smoke suite only** — lower flake, loses layout/menu/gate coverage
   already owned by e2e. Rejected for full-replacement goal.
3. **WDIO dual mode (desktop + browser mock)** — good for pure CSS isolation
   but reintroduces mock-IPC testing and two configs. Rejected for v1
   simplicity.
4. **Fixture scenes instead of production** — more deterministic, diverges
   from the user’s choice of production content. Not chosen for v1; can be
   revisited if flake cost becomes high.
5. **Cargo release binary + unconditional plugin** — rejected: ships a local
   remote-control HTTP server in production artifacts.
6. **Permanent `wdio-webdriver:default` in `default.json`** — rejected: breaks
   non-e2e builds when the plugin is not linked.
7. **`cfg(debug_assertions)` alone for plugin dependency/registration** —
   rejected: Cargo cannot feature-select deps that way cleanly, and debug
   registration would expose WebDriver during every `dev:game`. **Feature
   `e2e` is required.**
8. **Reuse production app identifier** — rejected: shared WebView storage
   pollutes Spec C and developer installs.

## Open follow-ups (not v1)

- Re-add error-banner e2e via locked hotspot or approved test command.
- Optional `tauri-plugin-wdio` / `@wdio/tauri-plugin` for execute/mock/logs
  (still behind feature `e2e`).
- macOS/Windows CI matrix.
