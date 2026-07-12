# Tauri WebDriver E2E (Replace Playwright) Design

**Date:** 2026-07-11  
**Status:** Approved design

## Summary

Replace the Playwright browser e2e suite with WebdriverIO +
`@wdio/tauri-service` driving a **real Tauri desktop binary** that loads
**production compiled scenes** through real `invoke` IPC. Delete Playwright,
its mocks (`__TAURI_INTERNALS__`), and the browser-preview CI job. Run the new
suite locally on macOS and in GitHub Actions on Linux (headless via xvfb).

## Goals

- Full replacement of Playwright e2e (no parallel dual suite after cutover).
- Real shell + real engine + production resources (no JS Tauri mock).
- Official Tauri 2 WebDriver path: WDIO + embedded WebDriver plugin (macOS and
  Linux without CrabNebula).
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

## Background

Today:

- `apps/game/e2e/*.spec.ts` + `playwright.config.ts` run the **built static
  SPA** via `vite preview` on port 4173.
- Specs inject a browser-side `__TAURI_INTERNALS__.invoke` mock with fake
  chapter/scene views. Real Tauri IPC is never exercised.
- AGENTS.md already documents this limitation and that full desktop smoke is
  `bun run dev:game`.
- Rust already has engine integration tests under
  `apps/game/src-tauri/tests/` (e.g. `full_playthrough.rs`) that do **not**
  cover the WebView UI.
- CI job `e2e` (Playwright E2E) installs Chromium and runs `bun run test:e2e`.

Tauri 2 recommends WebdriverIO with `@wdio/tauri-service` and, for
cross-platform including macOS, the **embedded** WebDriver provider via
`tauri-plugin-wdio-webdriver`.

## Architecture

### Layers under test

| Layer | Role |
| --- | --- |
| Authored scenes → `bun run scenes:compile` | Production resources bundled into the app |
| Rust `GameEngine` + `#[tauri::command]` handlers | Real backend |
| Svelte SPA in the OS WebView | Real UI |
| WDIO + `@wdio/tauri-service` + embedded driver | Automation only |

### New components

1. **Cargo plugin:** `tauri-plugin-wdio-webdriver`, registered in
   `apps/game/src-tauri/src/lib.rs` so the binary exposes an embedded W3C
   WebDriver server. v1 registers it unconditionally (server is inert without
   a client). Optional later: Cargo feature `e2e` to strip from store builds.
2. **WDIO project** under `apps/game/`:
   - `wdio.conf.ts` — `services: [['tauri', { appBinaryPath, driverProvider: 'embedded' }]]`
   - `e2e-tauri/` — specs, helpers, production anchors
3. **Build pipeline for e2e:** `scenes:compile` → Tauri release build → WDIO
   points at the produced binary (`productName` / binary name `lyra`).
4. **CI:** Linux job with system WebKit/GTK deps + xvfb; no Playwright.

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
  loop until explore/menu-ready; hard cap (e.g. 50) with a clear failure
- `openGameMenu()` / `closeGameMenu()` — Escape + assert dialog accessible names
- `seedStoryCleared()` — set `lyra.storyClearedOnce.v1` in webview storage
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
| Character hover CSS | Production sprite-layout character; assert highlight/name opacity on hover |
| Escape closes topic popover before menu | Open topics → Escape → popover gone, menu not open → Escape → 遊戲選單 |

### Spec C — Scene nav prod gate (`scene-navigation-gate.e2e.ts`)

| Old | New |
| --- | --- |
| Hide 場景跳轉 when not cleared | Release binary (`DEV=false`) + empty storage → no 場景跳轉 |
| Show when cleared | Seed storage key → menu shows 場景跳轉 |

This is **stronger** than Playwright preview e2e: the production gate is
exercised on a real release-built frontend bundle.

### Non-ports

- `installTauriMock` / `__TAURI_INTERNALS__`
- `shouldRegisterPlaywrightSuite` Bun guard
- Exact mock dialogue/evidence strings

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
    Cargo.toml          # + tauri-plugin-wdio-webdriver
    src/lib.rs          # .plugin(tauri_plugin_wdio_webdriver::init())
```

### npm / bun packages (`apps/game` devDependencies)

- `webdriverio`
- `@wdio/cli`
- `@wdio/local-runner`
- `@wdio/mocha-framework` (keep runner simple; no Cucumber)
- `@wdio/spec-reporter`
- `@wdio/tauri-service`

Optional later: `@wdio/tauri-plugin` + matching Cargo plugin for
`browser.tauri.execute` / command mock / log capture — not required for v1
DOM + real-IPC tests.

### Cargo

- Dependency: `tauri-plugin-wdio-webdriver`
- Register in `run()` next to existing plugins

### WDIO config essentials

- `driverProvider: 'embedded'`
- `appBinaryPath` resolved per OS to the release binary produced by Tauri
  (prefer unbundled `target/release/lyra` for CI speed over full installers)
- `maxInstances: 1` (one desktop app)
- Elevated command timeouts (typewriter + production dialogue)
- CI retries: 1–2; local: 0

## Build and scripts

### Build under test

1. `bun run scenes:compile` — production resources under
   `apps/game/src-tauri/resources/`
2. Tauri release build so `beforeBuildCommand` compiles scenes + `vite build`
   and `import.meta.env.DEV === false`
3. WDIO launches that binary

### Package scripts

| Script | Behavior |
| --- | --- |
| `apps/game` `test:e2e` | Run WDIO (assumes binary already built) |
| `apps/game` `test:e2e:build` | `scenes:compile` + tauri release build + WDIO |
| Root `test:e2e` | Turbo filter `@lyra/game` → e2e entry used by CI (build + run) |

Drop Playwright `test:e2e:ui` unless a WDIO watch equivalent is added later.

### AGENTS.md / CLAUDE.md

Replace the Playwright preview caveat with: e2e drives the real Tauri binary
with production resources; requires a release build and platform WebView
deps. Note `production-anchors.ts` as the coupling point to chapter content.

## CI

Replace the `e2e` job in `.github/workflows/ci.yml`:

- **Name:** Tauri E2E
- **Runner:** `ubuntu-latest` only (v1)
- **System packages:** WebKitGTK / appindicator build deps as required for
  Tauri on Ubuntu, plus **xvfb**. Install webkit2gtk-driver as well if the
  embedded path still benefits from it on the runner image.
- **Steps:** checkout → bun install → rust toolchain + rust-cache (workspace
  `apps/game/src-tauri`) → `test:e2e:build` under `xvfb-run`
- **Artifacts:** WDIO logs / failure screenshots (not Playwright HTML)
- **Caching:** Rust target + bun lockfile to limit wall time

Windows/macOS CI matrix is a later option, not v1.

## Error handling and flake policy

- Dialogue drain loops always cap; failure message names the predicate and
  last visible text.
- Prefer role/accessible-name assertions over brittle full-string equality
  where production copy may grow.
- Soften pure pixel geometry asserts if WebKit differs; keep viewport
  containment and CSS opacity contracts.
- Serial execution only.

## Migration order

1. Scaffold WDIO + Cargo plugin; smoke: launch app, see title / main menu.
2. Add helpers + discover/write `production-anchors.ts` from compiled
   production JSON / authored chapter_1.
3. Port Spec A → B → C.
4. Wire Linux CI job; delete Playwright and old `e2e/`.
5. Update AGENTS.md / CLAUDE.md.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Long production intro | Drain helper with cap; earliest investigation anchors |
| Authoring renames break suite | Single anchors file; clear failure text |
| CI build duration | rust-cache; unbundled release binary |
| Embedded plugin Linux quirks | Follow WDIO/Tauri embedded docs; only then consider external driver |
| Error-banner gap | Explicitly out of v1; unit tests remain |
| Hover/CSS flake | Keep opacity/visibility contracts; relax exact pixels if needed |

## Success criteria

- After a release build, `bun run test:e2e` launches real Tauri and the ported
  suite passes on macOS local and Linux CI.
- No Playwright dependency or browser Tauri mocks remain.
- Real IPC loads production scenes.
- Scene-nav production gate is covered on a `DEV=false` binary.
- Docs describe the new e2e path and production anchors.

## Alternatives considered

1. **Keep Playwright against tauri-driver** — familiar API, but tauri-driver
   is Windows/Linux-centric for native drivers; macOS needs embedded/CrabNebula.
   Rejected in favor of official WDIO Tauri service.
2. **Thin smoke suite only** — lower flake, loses layout/menu/gate coverage
   already owned by e2e. Rejected for full-replacement goal.
3. **WDIO dual mode (desktop + browser mock)** — good for pure CSS isolation
   but reintroduces mock-IPC testing and two configs. Rejected for v1
   simplicity.
4. **Fixture scenes instead of production** — more deterministic, diverges
   from the user’s choice of production content. Not chosen for v1; can be
   revisited if flake cost becomes high.

## Open follow-ups (not v1)

- Cargo feature to omit the WebDriver plugin from store-signed builds.
- Re-add error-banner e2e via locked hotspot or approved test command.
- Optional `@wdio/tauri-plugin` for backend log capture.
- macOS/Windows CI matrix.
