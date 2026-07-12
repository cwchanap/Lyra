# Tauri WebDriver E2E (Replace Playwright) Design

**Date:** 2026-07-11  
**Status:** Approved design (amended after review)

## Summary

Replace the Playwright browser e2e suite with WebdriverIO +
`@wdio/tauri-service` driving a **real Tauri desktop binary** that loads
**production compiled scenes** through real `invoke` IPC. Delete Playwright,
its mocks (`__TAURI_INTERNALS__`), and the browser-preview CI job. Run the new
suite locally on macOS and in GitHub Actions on Linux (headless via xvfb).

The e2e binary is a **debug-profile** Tauri build (`tauri build --debug
--no-bundle`) so the embedded WebDriver plugin is present under
`cfg(debug_assertions)`. The frontend is still produced by `vite build`, so
`import.meta.env.DEV === false` and the scene-nav production gate is real.

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
  artifacts.

## Background

Today:

- `apps/game/e2e/*.spec.ts` + `playwright.config.ts` run the **built static
  SPA** via `vite preview` on port 4173.
- Specs inject a browser-side `__TAURI_INTERNALS__.invoke` mock with fake
  chapter/scene views. Real Tauri IPC is never exercised.
- The existing scene-nav e2e already exercises `import.meta.env.DEV === false`
  via the production Vite build served by `vite preview` — the gap is **real
  IPC + real shell**, not the DEV flag.
- AGENTS.md documents the mock-IPC limitation and that full desktop smoke is
  `bun run dev:game`.
- Rust already has engine integration tests under
  `apps/game/src-tauri/tests/` (e.g. `full_playthrough.rs`) that do **not**
  cover the WebView UI.
- CI job `e2e` (Playwright E2E) installs Chromium and runs `bun run test:e2e`.

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
| Rust binary | **Debug** (`tauri build --debug --no-bundle`) → `cfg(debug_assertions)` on |
| Bundle packaging | `--no-bundle` → unbundled `src-tauri/target/debug/lyra` (faster CI; no installer) |
| Embedded WebDriver plugin | Registered **only** under `#[cfg(debug_assertions)]` |
| WebDriver capability | Present **only** in debug e2e builds (see Capabilities below) |
| Store / release builds | No plugin, no WebDriver HTTP server, no test permissions |

Upstream guidance for `tauri-plugin-wdio-webdriver`: do **not** ship it in
production. The plugin opens a W3C WebDriver HTTP server (default
`127.0.0.1:4445`) that any local client can drive — it is **not** “inert
without a client.” Conditional compilation is the strip mechanism for the
Rust plugin. Capability files must be gated the same way (see next section).

### Capabilities (v1 blocker — not a follow-up)

Tauri ACL resolves permissions at **build** time. Referencing a permission
whose plugin is not linked fails the build with errors of the form
`Permission <id> not found` (same class of failure as
tauri-apps/plugins-workspace#2261 for unlinked plugins).

Therefore **do not** put `"wdio-webdriver:default"` permanently in the shared
`capabilities/default.json`. That would break `bun run build:tauri` / release
paths the moment the plugin is debug-only.

**v1 mechanism (required):**

1. Keep `capabilities/default.json` free of WebDriver permissions (production
   path unchanged).
2. Maintain a debug-only capability fragment, e.g.
   `capabilities/wdio-debug.json` (or generated equivalent), that grants
   `"wdio-webdriver:default"` for the main window.
3. Ensure that fragment is **present only for debug e2e builds** and **absent
   for release builds**. Concrete implementation (pick one during migration
   step 1 and keep the other as fallback):

   - **Preferred:** `build.rs` (or a small pre-build script invoked by
     `test:e2e:build`) writes/removes `capabilities/wdio-debug.json` based on
     profile / env (e.g. only when building debug / `LYRA_E2E=1`). Tauri
     auto-includes files under `capabilities/`. Release builds must not leave
     the file in the tree (gitkeep or regenerate; do not commit a permanent
     permission that release ACL cannot resolve).
   - **Alternative:** optional Cargo feature `e2e` that links the plugin and
     is paired with the same capability file lifecycle; e2e always builds with
     `--features e2e`, release never does.

4. Migration step 1 **must** prove both:
   - debug e2e build succeeds with plugin + capability
   - release build (`tauri build` without debug/e2e) succeeds **without** the
     permission and without the plugin

If empirical step 1 shows Tauri is more lenient than expected on this crate
version, still keep the gated capability design — do not rely on accidental
leniency.

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

1. **Cargo (debug-only):** `tauri-plugin-wdio-webdriver` under
   `[target.'cfg(debug_assertions)'.dependencies]` (or optional feature
   `e2e` if that pairs cleaner with capability gating). Register in
   `lib.rs`:

   ```rust
   #[cfg(debug_assertions)]
   let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
   ```

   Pin an explicit version (not a floating caret). Prefer a version published
   at least ~7 days before adoption; if `1.2.x` is too new relative to
   adoption, pin `=1.0.0` or the oldest compatible `1.x` that supports
   embedded provider + Tauri 2.

2. **Capabilities (debug-only):** gated `"wdio-webdriver:default"` as
   described above — **not** a permanent line in `default.json`.

3. **WDIO project** under `apps/game/`:
   - `wdio.conf.ts` lives in `apps/game/`. Service key
     `@wdio/tauri-service`. Options: `driverProvider: 'embedded'`,
     `appBinaryPath: './src-tauri/target/debug/lyra'` (**relative to the
     config file directory**, not the monorepo root — do not use
     `apps/game/src-tauri/...` from this config). If the installed service
     also honors `tauri:options.application`, set one canonical path and
     avoid conflicting overrides.
   - `e2e-tauri/` — specs, helpers, production anchors

4. **Build pipeline for e2e:** ensure debug capability is present →
   `tauri build --debug --no-bundle` (runs `beforeBuildCommand`, which
   already compiles scenes + `vite build`) → WDIO launches
   `./src-tauri/target/debug/lyra`.

5. **CI:** Linux job with Tauri WebKit/GTK runtime/build deps + xvfb; no
   Playwright; no webkit2gtk-driver required for the embedded provider.

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

- `startFromMenu()` — app ready → 開始調查 → wait for first real dialogue
- `advanceDialogueUntil(predicate)` — wait typewriter complete → 推進對話;
  loop until explore/menu-ready; hard cap with a clear failure. **Cap value
  is not fixed at 50 in the abstract** — during migration step 2, count
  production chapter_1 intro dialogue items (compiled JSON / authored
  scenes) and set the cap to **intro length + comfortable margin**. Document
  the chosen number next to the helper.
- `openGameMenu()` / `closeGameMenu()` — Escape + assert dialog accessible names
- `seedStoryCleared()` — **primary mechanism: set-then-reload**. W3C
  WebDriver has no Playwright-style `addInitScript`. With the embedded
  server alone:

  1. Wait until the webview document is available.
  2. `browser.execute` → `localStorage.setItem(STORY_CLEARED_STORAGE_KEY, "true")`
  3. `browser.refresh()` (or equivalent navigation reload)
  4. Wait for app shell again so `loadStoryClearedOnce()` runs on a cold
     SPA init that observes the key.

  Do not document a fictional pre-navigation init script as the primary
  path. If a later optional `@wdio/tauri-plugin` execute path offers a
  cleaner hook, that is a follow-up — v1 uses set-then-reload.

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
| Character hover CSS | Production sprite-layout character; assert highlight/name **opacity** on hover (and that name becomes visible). **Intentionally drop** the old Playwright pixel geometry asserts (`top: 10px`, `right: 10px`, `font-size: 18px`) — those are pure layout CSS better covered by component/source tests if needed, and they flake across WebKit. Opacity/visibility is the sprite-layout interaction contract for e2e. |
| Escape closes topic popover before menu | Open topics → Escape → popover gone, menu not open → Escape → 遊戲選單 |

### Spec C — Scene nav prod gate (`scene-navigation-gate.e2e.ts`)

| Old | New |
| --- | --- |
| Hide 場景跳轉 when not cleared | Debug-profile binary + production frontend (`DEV=false`) + empty storage → no 場景跳轉 |
| Show when cleared | `seedStoryCleared()` (set-then-reload) then open menu → 場景跳轉 visible |

**What this gains over Playwright:** real Tauri shell + real `invoke` +
production scene resources. It does **not** uniquely gain `DEV=false` — the
old suite already got that from `vite preview`. Frame the win as
**end-to-end desktop fidelity**, not as the first production-gate coverage.

### Non-ports

- `installTauriMock` / `__TAURI_INTERNALS__`
- `shouldRegisterPlaywrightSuite` Bun guard
- Exact mock dialogue/evidence strings
- Playwright `addInitScript` pre-init injection (use set-then-reload)
- Exact pixel geometry CSS asserts from the old hover test

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
  package.json          # test:e2e scripts
  src-tauri/
    Cargo.toml          # debug-only tauri-plugin-wdio-webdriver
    build.rs            # optional: capability fragment lifecycle
    capabilities/
      default.json      # production — no wdio-webdriver permission
      wdio-debug.json   # debug/e2e only (generated or gated; not for release)
    src/lib.rs          # #[cfg(debug_assertions)] plugin init
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

### Cargo + capabilities checklist

- Debug-only dependency: `tauri-plugin-wdio-webdriver` (pinned version)
- `#[cfg(debug_assertions)]` `.plugin(tauri_plugin_wdio_webdriver::init())`
- **Gated** `"wdio-webdriver:default"` capability (debug/e2e only)
- **Never** leave that permission in the ACL graph of a release build
- Do **not** register or depend on the plugin in release/store builds

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

## Build and scripts

### Build under test

1. Ensure debug WebDriver capability fragment is present (see Capabilities).
2. `tauri build --debug --no-bundle` from `apps/game` — runs
   `beforeBuildCommand` (`scenes:compile` + `vite build`) so the WebView
   loads a production frontend (`DEV=false`) while the Rust profile stays
   debug so the embedded WebDriver plugin is linked.
3. WDIO launches `./src-tauri/target/debug/lyra`.

**Do not** double-run `scenes:compile` in `test:e2e:build` unless there is a
specific reason: `beforeBuildCommand` already compiles scenes. An explicit
pre-step is optional for local iteration when only resources changed and the
binary is already built; the default documented path relies on
`beforeBuildCommand` alone.

### Package scripts

| Script | Behavior |
| --- | --- |
| `apps/game` `test:e2e` | Run WDIO (assumes debug binary + capability already prepared) |
| `apps/game` `test:e2e:build` | Prepare debug capability → `tauri build --debug --no-bundle` → WDIO |
| Root `test:e2e` | Turbo filter `@lyra/game` → e2e entry used by CI (build + run) |

Drop Playwright `test:e2e:ui` unless a WDIO watch equivalent is added later.

### AGENTS.md / CLAUDE.md

Replace the Playwright preview caveat with: e2e drives a **debug-profile**
Tauri binary (embedded WebDriver) with a **production** frontend bundle and
production scene resources; requires platform WebView deps. Note
`production-anchors.ts` as the coupling point to chapter content. State that
the WebDriver plugin and its capability must never ship in release/store
builds.

## CI

Replace the `e2e` job in `.github/workflows/ci.yml`:

- **Name:** Tauri E2E
- **Runner:** `ubuntu-latest` only (v1)
- **System packages:**
  - **Required:** Tauri Linux build/runtime deps (webkit2gtk, gtk,
    appindicator, etc.) and **xvfb** for a virtual display
  - **Not required** under `driverProvider: 'embedded'`: `webkit2gtk-driver`
    / external `tauri-driver` (those are for the external-driver path)
- **Steps:** checkout → bun install → rust toolchain + rust-cache (workspace
  `apps/game/src-tauri`) → `test:e2e:build` under `xvfb-run`
- **Artifacts:** WDIO logs / failure screenshots (not Playwright HTML)
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

## Migration order

1. Scaffold WDIO + Cargo plugin behind `cfg(debug_assertions)`; implement
   **gated** `wdio-webdriver:default` capability. **Smoke:**
   - `tauri build --debug --no-bundle` + WDIO → title / main menu
   - release/default build still succeeds (no unknown permission)
   - (A release binary will not expose the embedded server — session-start
     timeouts usually mean wrong profile, not missing Linux deps.)
2. Add helpers + discover/write `production-anchors.ts` from compiled
   production JSON / authored chapter_1; measure intro length and set
   dialogue drain cap.
3. Port Spec A → B → C (including set-then-reload `seedStoryCleared()`).
4. Wire Linux CI job; delete Playwright and old `e2e/`.
5. Update AGENTS.md / CLAUDE.md.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Long production intro | Drain helper with cap sized from real intro + margin |
| Authoring renames break suite | Single anchors file; clear failure text |
| CI build duration | rust-cache; debug unbundled binary (`--debug --no-bundle`) |
| Wrong build profile (no embedded server) | Document debug-only plugin; smoke step uses `--debug` explicitly |
| Release build fails on unknown permission | **v1 gated capability** (not permanent `default.json`) |
| Embedded plugin Linux quirks | Follow WDIO embedded docs; only then consider external driver |
| Error-banner gap | Explicitly out of v1; unit tests remain |
| Hover/CSS flake | Opacity/visibility only; no exact pixel geometry in e2e |
| Community plugin maintenance | Pin versions (prefer ≥7-day-old release); treat as WDIO-community path |

## Success criteria

- After `tauri build --debug --no-bundle` (with debug capability present),
  `bun run test:e2e` launches real Tauri and the ported suite passes on macOS
  local and Linux CI.
- Release/store builds succeed **without** the WebDriver plugin and **without**
  `wdio-webdriver` permissions in the ACL graph; no WebDriver HTTP port.
- No Playwright dependency or browser Tauri mocks remain.
- Real IPC loads production scenes.
- Scene-nav production gate is covered on a production frontend bundle
  (`import.meta.env.DEV === false`) inside the desktop shell.
- Docs describe the new e2e path, debug-only plugin + capability policy, and
  production anchors.

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
   remote-control HTTP server in production artifacts and contradicts
   upstream plugin guidance. Debug-profile e2e binary is the fix.
6. **Permanent `wdio-webdriver:default` in `default.json`** — rejected: breaks
   release builds when the plugin is not linked. Gated capability is required
   in v1.

## Open follow-ups (not v1)

- Re-add error-banner e2e via locked hotspot or approved test command.
- Optional `tauri-plugin-wdio` / `@wdio/tauri-plugin` for execute/mock/logs
  (still debug-only), which could replace set-then-reload if a better storage
  hook appears.
- macOS/Windows CI matrix.
