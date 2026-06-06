# CLAUDE.md

This file provides guidance to Claude Code and other coding agents working in
this repository.

## Commands

Package manager is **bun** (see `bun.lock`). Use bun for frontend, scene
compiler, and Tauri commands so local runs match `tauri.conf.json`.

- `bun run tauri dev` - full desktop app dev loop. Tauri runs
  `bun run dev:tauri`, which compiles scenes and then starts Vite on port 1420
  before launching the Rust shell with HMR. This is the primary dev command.
- `bun run dev` - frontend only in a browser. Tauri APIs are unavailable here;
  `invoke()` calls will fail unless mocked.
- `bun run tauri build` - produce desktop bundles for all targets in
  `tauri.conf.json`. Tauri runs `bun run build:tauri`, which compiles scenes
  before `vite build`.
- `bun run scenes:compile` - one-shot compile. Merges scenes from both
  `static/stories_plan/` and `docs/stories_plan/` (a root that does not exist
  is skipped) plus `static/assets/config/` into Tauri resource JSON.
- `bun run scenes:watch` - watch authored scene Markdown and asset YAML while
  iterating on story content.
- `bun run check` / `bun run check:watch` - type-check Svelte + TS
  (`svelte-kit sync && svelte-check`). Run before declaring frontend work done.
- `bun run test` / `bun run test:watch` - Vitest unit tests for frontend logic
  and compile-script tests. Run a single file with
  `bun run test src/lib/state/mode.test.ts` or a single case with
  `bun run test -t "test name"`.
- `bun run test:e2e` / `bun run test:e2e:ui` - Playwright e2e tests in `e2e/`
  (config: `playwright.config.ts`). These spin up `bun run preview` on port
  4173 and exercise the **built static SPA in a browser**. Tauri `invoke()`
  calls do not work there, so e2e tests must cover only the pure-frontend
  surface or explicit browser-safe mocks.
- `bun run lint:all` - ESLint, Prettier check, Rust format check, and Rust
  clippy with warnings denied.
- Rust-side checks can be run through package scripts
  (`bun run rust:fmt`, `bun run rust:lint`) or directly with
  `cd src-tauri && cargo check` / `cargo clippy` / `cargo test`. Rust unit
  tests live alongside the code, with integration coverage under
  `src-tauri/tests/`.

## Architecture

Two-process desktop app: a **SvelteKit SPA frontend** rendered inside a **Tauri 2 (Rust) shell**.

- **SPA mode is mandatory.** `src/routes/+layout.ts` sets `export const ssr = false;` and `svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: "index.html"`. Tauri serves the static build — there is no Node server. Do not introduce `+page.server.ts`, `+server.ts`, hooks that assume a server, or any feature that requires SSR/endpoints.
- **Frontend → Rust IPC** goes through `@tauri-apps/api`'s `invoke("command_name", { args })`. Rust commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![...]` and annotated with `#[tauri::command]`. Adding a new command requires both: define the `#[tauri::command] fn`, then add it to `generate_handler!`.
  - **Arg naming:** Tauri converts JS arg keys to snake_case across the bridge, so the frontend passes `{ hotspotId }` and the Rust signature takes `hotspot_id: String`. Conversely, all serializable domain types in `src-tauri/src/game/schema.rs` use `#[serde(rename_all = "camelCase")]`, so Rust `last_feedback` becomes TS `lastFeedback`. New types must follow the same attribute or the frontend will see snake_case keys.
  - **Shared state:** long-lived state lives in `AppState { engine: Mutex<Option<GameEngine>> }`, registered with `.manage(...)` in `lib.rs`. Commands that touch it take `state: tauri::State<'_, AppState>` and lock the mutex; map poison errors to a typed `GameError` (see `unavailable_error()`).
  - **Error contract:** commands return `Result<T, GameError>` where `GameError { code, message }` is serializable. The frontend's `normalizeError` (`src/routes/+page.svelte`) reads `error.message`; new error paths should construct a typed error rather than `panic!` or stringly-typed errors.
- **Entry points:** `src-tauri/src/main.rs` is a thin shim that calls `lyra_lib::run()` from `src-tauri/src/lib.rs` (the `_lib` suffix is required to avoid a Windows name collision per the Cargo.toml comment). Window config (size, title, CSP) lives in `src-tauri/tauri.conf.json`.
- **Permissions** for Tauri APIs are allow-listed in `src-tauri/capabilities/default.json`. New plugins/APIs the frontend calls usually need a corresponding permission entry here or `invoke` will be rejected at runtime.
- **Vite dev server** is pinned to port 1420 with `strictPort: true` (`vite.config.js`) because Tauri expects that exact port. `src-tauri/**` is excluded from the watcher so Rust changes don't trigger frontend reloads.

## Scene Pipeline

Lyra's playable content is compiler-driven:

1. Authored Markdown lives under `static/stories_plan/` and/or
   `docs/stories_plan/`. The compiler merges both source roots in a single
   pass; a root that does not exist is skipped, and the same `chapter_<N>`
   must not appear in both roots.
2. Asset policy/catalog YAML lives under `static/assets/config/`.
3. `scripts/compile-scenes.ts` validates and emits runtime JSON under
   `src-tauri/resources/scenes/` and asset manifests/reports under
   `src-tauri/resources/assets/`.
4. Rust loads scenes and asset manifests from `BaseDirectory::Resource`.
5. Svelte renders the typed game/view state returned by Rust commands.

Keep the ownership boundary intact:

- Do not hand-edit generated JSON in `src-tauri/resources/scenes/` or
  `src-tauri/resources/assets/`; regenerate it with `bun run scenes:compile`.
- Only `.gitkeep` files are tracked in those generated resource directories.
  Generated JSON may appear locally after compile/build and is intentionally
  ignored.
- Writers author semantic intent only: dialogue, scene tags, prompts, speaker
  expression IDs, and audio IDs. Writers must not author filesystem paths.
- Character IDs, expression IDs, and asset IDs become path or manifest keys, so
  keep slug validation in the compiler/config layer before generating paths.
- When asked to generate or edit raster image assets, invoke the repo-local
  `generating-lyra-image-assets` skill first. That SOP owns how Lyra agents use
  the system `imagegen` skill/tools, save project-bound outputs, normalize
  dimensions, and verify generated files. If the required `imagegen` tools are
  unavailable, tell the user to run the image request in the Codex app instead
  of substituting non-image placeholders or another generation path.

## Svelte 5

Uses Svelte 5 runes (`$state`, `$props`, etc.) - see `src/routes/+page.svelte`
and `src/lib/state/game-client.svelte.ts`. Use rune syntax and event
attributes like `onsubmit={...}` rather than legacy `on:submit` /
`export let` patterns.

## Project domain

This repo is a detective/mystery game (《東京雨證：第零證人》, Traditional
Chinese). Narrative content has two kinds — keep them straight even though both
roots now feed the compiler:

- **Planning/design** is reference for writers, not playable input: the story
  bible (`tokyo_rain_witness_final_story_bible_v*.md`), per-chapter writing
  plans, and agent addenda. The compiler only descends into `chapter_<N>/`
  directories and within each only reads the files its `chapter.md` manifest
  lists, so planning docs are ignored even when they sit beside authored scenes.
- **Authored playable content** lives in `<root>/chapter_<N>/`, where `<root>`
  is either `static/stories_plan/` or `docs/stories_plan/` — the compiler
  merges both (`scripts/compile-scenes.ts` passes them as a `sourceRoot` list;
  `compile()` skips a missing root and rejects a `chapter_<N>` that appears in
  both). A given chapter must live in exactly one root. Files in a chapter dir:
  - `chapter.md` - the chapter manifest (title, summary, ordered scene list).
    Authored via the `writing-chapter-manifest` skill.
  - `scene_<K>.md` - linear-dialogue scenes (intros, transitions, endings).
    Authored via `writing-detective-game-dialogue`.
  - `investigation_scene_<K>.md` - interactive investigation scenes (hotspots,
    characters, evidence). Authored via `writing-investigation-scene`.
  - `interrogation_scene_<K>.md` - authored and compiler-validated suspect
    inquiry and testimony cross-examination scenes. Authored via
    `writing-interrogation-scene`.

Compiler unit tests use fixtures under `scripts/__fixtures__/` (e.g.
`valid/`, `valid_interrogation/`, `asset_enabled/`, and `invalid/<case>/` with
matching `expected-error.txt`), not the live `static/stories_plan/` or
`docs/stories_plan/` trees.

Active writer instructions live in `.claude/skills/*/SKILL.md` and are part of
the repo contract. When writing or modifying scene content, invoke the relevant
skill rather than free-forming the format. These skills own details such as
Traditional Chinese dialogue style, full-width `場景：` tags, investigation
hotspots, interrogation phases, and asset metadata.

Image-asset generation instructions also live in `.claude/skills/` and are part
of the repo contract. When generating or editing story backgrounds, portraits,
evidence icons, starter packs, or missing asset files, invoke
`generating-lyra-image-assets`.

Relevant design specs:

- `docs/superpowers/specs/2026-05-13-scene-pipeline-design.md`
- `docs/superpowers/specs/2026-05-19-interrogation-scene-design.md`
- `docs/superpowers/specs/2026-05-30-story-asset-pipeline-design.md`

## Verification Guidance

Choose the smallest verification set that covers the change, then run the
broader checks before claiming cross-stack work is done.

- Scene authoring or compiler changes: `bun run scenes:compile` and focused
  Vitest files under `scripts/compile-scenes*.test.ts`.
- Asset pipeline changes: focused tests under `scripts/compile-scenes/assets/`,
  `src/lib/assets/story-assets.test.ts`, then `bun run scenes:compile`.
- Frontend component/state changes: focused Vitest tests, then `bun run check`.
- Rust engine/runtime changes: focused `cargo test` filters where useful, then
  `cd src-tauri && cargo test`; use `bun run rust:lint` before finalizing Rust
  logic changes.
- Full desktop smoke test: `bun run tauri dev`. Use this when the change depends
  on real Tauri IPC or resource loading.

## Misc

- `AGENTS.md` is a symlink to `CLAUDE.md`; edit one, both update.
- Keep generated artifacts, local settings, build output, coverage, Playwright
  reports, and `.worktrees/` out of commits unless the task explicitly changes
  ignore policy.
