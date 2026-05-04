# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **bun** (see `bun.lock`). Tauri's `beforeDevCommand`/`beforeBuildCommand` invoke `bun run dev`/`bun run build`, so use bun to keep behavior consistent.

- `bun run tauri dev` — full desktop app dev loop (spawns Vite on port 1420 + Rust app with HMR). This is the primary dev command.
- `bun run dev` — frontend only in browser (no Tauri APIs available; `invoke()` calls will fail).
- `bun run tauri build` — produce desktop bundles for all targets in `tauri.conf.json`.
- `bun run check` — type-check Svelte + TS (`svelte-kit sync && svelte-check`). Run before declaring frontend work done.
- `bun run check:watch` — same in watch mode.
- Rust-side checks: `cd src-tauri && cargo check` / `cargo clippy`. There is no test runner wired up yet on either side.

## Architecture

Two-process desktop app: a **SvelteKit SPA frontend** rendered inside a **Tauri 2 (Rust) shell**.

- **SPA mode is mandatory.** `src/routes/+layout.ts` sets `export const ssr = false;` and `svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: "index.html"`. Tauri serves the static build — there is no Node server. Do not introduce `+page.server.ts`, `+server.ts`, hooks that assume a server, or any feature that requires SSR/endpoints.
- **Frontend → Rust IPC** goes through `@tauri-apps/api`'s `invoke("command_name", { args })`. Rust commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![...]` and annotated with `#[tauri::command]`. Adding a new command requires both: define the `#[tauri::command] fn`, then add it to `generate_handler!`.
- **Entry points:** `src-tauri/src/main.rs` is a thin shim that calls `lyra_lib::run()` from `src-tauri/src/lib.rs` (the `_lib` suffix is required to avoid a Windows name collision per the Cargo.toml comment). Window config (size, title, CSP) lives in `src-tauri/tauri.conf.json`.
- **Permissions** for Tauri APIs are allow-listed in `src-tauri/capabilities/default.json`. New plugins/APIs the frontend calls usually need a corresponding permission entry here or `invoke` will be rejected at runtime.
- **Vite dev server** is pinned to port 1420 with `strictPort: true` (`vite.config.js`) because Tauri expects that exact port. `src-tauri/**` is excluded from the watcher so Rust changes don't trigger frontend reloads.

## Svelte 5

Uses Svelte 5 runes (`$state`, `$props`, etc.) — see `src/routes/+page.svelte`. Use rune syntax and event attributes like `onsubmit={...}` rather than legacy `on:submit` / `export let` patterns.
