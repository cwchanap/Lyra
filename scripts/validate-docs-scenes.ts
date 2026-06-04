// scripts/validate-docs-scenes.ts
// Dev helper: validate the Chapter-1 DRAFT scenes authored under
// docs/stories_plan/ using the same compiler the CLI uses, without writing
// into the tracked static/ source tree. Output JSON goes to a throwaway temp
// dir and is discarded. Exit 0 = clean, exit 1 = compile errors.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compile } from "./compile-scenes/orchestrator";

const outputRoot = mkdtempSync(resolve(tmpdir(), "lyra-docs-scenes-"));

try {
  const result = compile({
    sourceRoot: resolve(process.cwd(), "docs/stories_plan"),
    outputRoot,
    assetConfigRoot: resolve(process.cwd(), "static/assets/config"),
    assetOutputRoot: outputRoot,
  });

  if (result.ok) {
    console.log(
      `OK: chapters=${result.chaptersCompiled} scenes=${result.scenesCompiled}`,
    );
    process.exitCode = 0;
  } else {
    console.error(`FAIL: ${result.errors.length} error(s)`);
    for (const e of result.errors) {
      console.error(`  [${e.code}] ${e.sourceFile}:${e.line} ${e.message}`);
    }
    process.exitCode = 1;
  }
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}
