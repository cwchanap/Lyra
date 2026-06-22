// =============================================================================
// packages/scripts/compile-scenes.ts
//
// Entry point. Invoked by:
//   bun run scenes:compile  — one-shot
//   bun run scenes:watch    — long-lived (passes --watch)
// Resolves the repo root from this package so package scripts can run with
// cwd=packages/scripts.
// =============================================================================

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, formatErrors } from "./compile-scenes/orchestrator";
import { checkTauriConfig } from "./compile-scenes/config-check";
import { withCompileLock } from "./compile-scenes/compile-lock";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Source trees compiled into the runtime, merged in a single pass. A root that
// does not exist is skipped, so an empty static/ tree is fine while authored
// content lives under docs/. The same chapter_<N> must not appear in both.
const SOURCE_ROOTS = [
  resolve(REPO_ROOT, "static/stories_plan"),
  resolve(REPO_ROOT, "docs/stories_plan"),
];
const OUTPUT_ROOT = resolve(REPO_ROOT, "apps/game/src-tauri/resources/scenes");
const ASSET_CONFIG_ROOT = resolve(REPO_ROOT, "static/assets/config");
const ASSET_OUTPUT_ROOT = resolve(
  REPO_ROOT,
  "apps/game/src-tauri/resources/assets",
);

const args = process.argv.slice(2);
const isWatch = args.includes("--watch");

await main();

async function main() {
  try {
    const cfg = checkTauriConfig(REPO_ROOT);
    if (!cfg.ok) {
      console.error("[compile-scenes] Tauri config check FAILED:");
      for (const p of cfg.problems) console.error("  - " + p);
      process.exit(1);
    }

    await runOnce();

    if (isWatch) {
      const chokidar = await import("chokidar");
      console.log(
        `[compile-scenes] Watching ${SOURCE_ROOTS.join(", ")} and ${ASSET_CONFIG_ROOT} for changes...`,
      );
      chokidar
        .watch(
          [
            ...SOURCE_ROOTS.map((root) => `${root}/chapter_*/*.md`),
            ...SOURCE_ROOTS.map((root) => `${root}/chapter_*/*.layout.json`),
            `${ASSET_CONFIG_ROOT}/**/*.yaml`,
          ],
          {
            ignoreInitial: true,
          },
        )
        .on("all", async (event, path) => {
          console.log(`[compile-scenes] ${event} ${path} - recompiling.`);
          try {
            await runOnce();
          } catch (err) {
            console.error(
              `[compile-scenes] Unexpected error during recompilation (${event} ${path}):`,
              err,
            );
          }
        });
    }
  } catch (err) {
    console.error("[compile-scenes] Fatal error in main:", err);
    process.exit(1);
  }
}

async function runOnce() {
  const result = await withCompileLock(OUTPUT_ROOT, () =>
    compile({
      sourceRoot: SOURCE_ROOTS,
      outputRoot: OUTPUT_ROOT,
      assetConfigRoot: ASSET_CONFIG_ROOT,
      assetOutputRoot: ASSET_OUTPUT_ROOT,
      repoRoot: REPO_ROOT,
    }),
  );
  if (!result.ok) {
    console.error(
      "[compile-scenes] FAILED with " + result.errors.length + " error(s):",
    );
    console.error(formatErrors(result.errors));
    if (!isWatch) process.exit(2);
    return;
  }
  console.log(
    `[compile-scenes] OK — ${result.chaptersCompiled} chapter(s), ${result.scenesCompiled} scene(s).`,
  );
  if (result.assetReport.enabled) {
    const r = result.assetReport.requested;
    console.log(
      `[compile-scenes] Assets - backgrounds ${r.background}, portraits ${r.portrait}, standees ${r.standee}, evidence ${r.evidence}, audio ${r.audio}; warnings ${result.assetReport.warnings.length}.`,
    );
  }
  if (result.assetReport.warnings.length > 0) {
    console.warn(
      `[compile-scenes] Asset warnings (${result.assetReport.warnings.length}):`,
    );
    for (const w of result.assetReport.warnings) {
      console.warn(`  - [${w.code}] ${w.message}`);
    }
  }
}
