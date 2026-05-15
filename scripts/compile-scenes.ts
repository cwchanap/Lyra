// =============================================================================
// scripts/compile-scenes.ts
//
// Entry point. Invoked by:
//   bun run scenes:compile  — one-shot
//   bun run scenes:watch    — long-lived (passes --watch)
// Run from the repo root.
// =============================================================================

import { resolve } from "node:path";
import { compile, formatErrors } from "./compile-scenes/orchestrator";
import { checkTauriConfig } from "./compile-scenes/config-check";

const SOURCE_ROOT = resolve(process.cwd(), "static/stories_plan");
const OUTPUT_ROOT = resolve(process.cwd(), "src-tauri/resources/scenes");

const args = process.argv.slice(2);
const isWatch = args.includes("--watch");

await main();

async function main() {
  const cfg = checkTauriConfig(process.cwd());
  if (!cfg.ok) {
    console.error("[compile-scenes] Tauri config check FAILED:");
    for (const p of cfg.problems) console.error("  - " + p);
    process.exit(1);
  }

  await runOnce();

  if (isWatch) {
    const chokidar = await import("chokidar");
    console.log(`[compile-scenes] Watching ${SOURCE_ROOT} for changes…`);
    chokidar
      .watch(`${SOURCE_ROOT}/**/*.md`, { ignoreInitial: true })
      .on("all", async (event, path) => {
        console.log(`[compile-scenes] ${event} ${path} — recompiling.`);
        try {
          await runOnce();
        } catch (err) {
          console.error(`[compile-scenes] Unexpected error during recompilation (${event} ${path}):`, err);
        }
      });
  }
}

async function runOnce() {
  const result = compile({ sourceRoot: SOURCE_ROOT, outputRoot: OUTPUT_ROOT });
  if (!result.ok) {
    console.error("[compile-scenes] FAILED with " + result.errors.length + " error(s):");
    console.error(formatErrors(result.errors));
    if (!isWatch) process.exit(2);
    return;
  }
  console.log(`[compile-scenes] OK — ${result.chaptersCompiled} chapter(s), ${result.scenesCompiled} scene(s).`);
}
