# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **bun** (see `bun.lock`). Tauri's `beforeDevCommand`/`beforeBuildCommand` invoke `bun run dev`/`bun run build`, so use bun to keep behavior consistent.

- `bun run tauri dev` — full desktop app dev loop (spawns Vite on port 1420 + Rust app with HMR). This is the primary dev command.
- `bun run dev` — frontend only in browser (no Tauri APIs available; `invoke()` calls will fail).
- `bun run tauri build` — produce desktop bundles for all targets in `tauri.conf.json`.
- `bun run check` — type-check Svelte + TS (`svelte-kit sync && svelte-check`). Run before declaring frontend work done.
- `bun run check:watch` — same in watch mode.
- Rust-side checks: `cd src-tauri && cargo check` / `cargo clippy` / `cargo test`. Rust unit tests live alongside the code (e.g. `#[cfg(test)] mod tests` in `src-tauri/src/investigation.rs`). No frontend test runner is wired up yet.

## Architecture

Two-process desktop app: a **SvelteKit SPA frontend** rendered inside a **Tauri 2 (Rust) shell**.

- **SPA mode is mandatory.** `src/routes/+layout.ts` sets `export const ssr = false;` and `svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: "index.html"`. Tauri serves the static build — there is no Node server. Do not introduce `+page.server.ts`, `+server.ts`, hooks that assume a server, or any feature that requires SSR/endpoints.
- **Frontend → Rust IPC** goes through `@tauri-apps/api`'s `invoke("command_name", { args })`. Rust commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![...]` and annotated with `#[tauri::command]`. Adding a new command requires both: define the `#[tauri::command] fn`, then add it to `generate_handler!`.
  - **Arg naming:** Tauri converts JS arg keys to snake_case across the bridge, so the frontend passes `{ hotspotId }` and the Rust signature takes `hotspot_id: String`. Conversely, all serializable domain types in `src-tauri/src/investigation.rs` use `#[serde(rename_all = "camelCase")]`, so Rust `last_feedback` becomes TS `lastFeedback`. New types must follow the same attribute or the frontend will see snake_case keys.
  - **Shared state:** long-lived state lives in `AppState { engine: Mutex<InvestigationEngine> }`, registered with `.manage(...)` in `lib.rs`. Commands that touch it take `state: tauri::State<'_, AppState>` and lock the mutex; map poison errors to a typed `InvestigationError` (see `unavailable_error()`).
  - **Error contract:** commands return `Result<T, InvestigationError>` where `InvestigationError { code, message }` is serializable. The frontend's `normalizeError` (`src/routes/+page.svelte`) reads `error.message`; new error paths should construct a typed error rather than `panic!` or stringly-typed errors.
- **Entry points:** `src-tauri/src/main.rs` is a thin shim that calls `lyra_lib::run()` from `src-tauri/src/lib.rs` (the `_lib` suffix is required to avoid a Windows name collision per the Cargo.toml comment). Window config (size, title, CSP) lives in `src-tauri/tauri.conf.json`.
- **Permissions** for Tauri APIs are allow-listed in `src-tauri/capabilities/default.json`. New plugins/APIs the frontend calls usually need a corresponding permission entry here or `invoke` will be rejected at runtime.
- **Vite dev server** is pinned to port 1420 with `strictPort: true` (`vite.config.js`) because Tauri expects that exact port. `src-tauri/**` is excluded from the watcher so Rust changes don't trigger frontend reloads.

## Svelte 5

Uses Svelte 5 runes (`$state`, `$props`, etc.) — see `src/routes/+page.svelte`. Use rune syntax and event attributes like `onsubmit={...}` rather than legacy `on:submit` / `export let` patterns.

## Misc

- `AGENTS.md` is a symlink to `CLAUDE.md`; edit one, both update.
