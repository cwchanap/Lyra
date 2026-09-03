// =============================================================================
// apps/layout-editor/scripts/verify-asset-real-content.ts
//
// Early real-corpus verifier for the Assets workbench projection. Mirrors
// verify-reader-real-content.ts: reads fresh compiler output from the repo and
// runs EVERY compiled non-Analysis scene through projectReaderScene() +
// projectAssetWorkspace() headlessly.
//
// Raw compiled Analysis is deliberately skipped here rather than copying the
// Rust public whitelist into TypeScript — the IPC layer sanitizes Analysis
// before the editor ever sees it. Rust sanitizer tests + PublicAnalysisScene
// unit fixtures own Analysis until final GUI smoke.
//
// Checks:
//   1. Reader/presentation completeness: projectReaderScene() throws on any
//      unconsumed compiler dialogue carrier, so a clean run proves the strict
//      single-walk contract holds on the real corpus.
//   2. Every concrete presentation reference either joins a generated manifest
//      entry or appears in the explicit unresolved diagnostic path — never
//      silently dropped.
//   3. Required rasters physically exist (HPA-601 Step 5.7): the compiler
//      records a missing asset file as a non-blocking `assetFileMissing`
//      warning, which checks 1-2 never inspect, so a deleted required raster
//      would still pass. Assert each required manifest entry's `expectedPath`
//      is present in the collected `existingAssetPaths`. Kept narrow: only
//      asset IDs a feature step requires to resolve to a real file.
// =============================================================================

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChaptersIndex } from "@lyra/scene-types";
import type { AssetManifest } from "@lyra/scripts/compile-scenes/assets/manifest";
import type { AssetReport } from "@lyra/scripts/compile-scenes/orchestrator";
import { projectAssetWorkspace } from "../src/lib/asset-workspace";
import {
  findMissingRequiredAssets,
  formatMissingRequiredAssets,
} from "../src/lib/required-asset-presence";
import { projectReaderScene } from "../src/lib/reader-projection";
import type {
  WorkbenchAssetScenePayload,
  WorkbenchAssetWorkspacePayload,
  WorkbenchScenePayload,
} from "../src/lib/workbench-types";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const resourcesRoot = resolve(repoRoot, "apps/game/src-tauri/resources/scenes");
const assetsRoot = resolve(repoRoot, "apps/game/src-tauri/resources/assets");

const chapters = JSON.parse(
  readFileSync(resolve(resourcesRoot, "chapters.json"), "utf8"),
) as ChaptersIndex;
if (chapters.chapters.length === 0) {
  throw new Error("no compiled chapters found; run `bun run scenes:compile`");
}

const scenes: WorkbenchAssetScenePayload[] = [];
for (const chapter of chapters.chapters) {
  for (const entry of chapter.scenes) {
    if (entry.type === "analysis") continue; // Rust sanitizer owns Analysis.
    const compiled = JSON.parse(
      readFileSync(resolve(resourcesRoot, entry.file), "utf8"),
    ) as WorkbenchScenePayload;
    scenes.push({
      chapterId: chapter.id,
      sceneId: entry.file.replace(/^.*\//, "").replace(/\.json$/, ""),
      sourcePath: `docs/stories_plan/${entry.file.replace(/\.json$/, ".md")}`,
      scene: compiled,
    });
  }
}
if (scenes.length === 0) {
  throw new Error(
    "no compiled non-Analysis scenes found; run `bun run scenes:compile`",
  );
}

// A clean projectReaderScene() run per scene is check 1: the strict walk
// throws on any unconsumed compiler dialogue carrier or unknown carrier ID.
for (const snapshot of scenes) {
  projectReaderScene(snapshot.chapterId, snapshot.sourcePath, snapshot.scene);
}

function listStaticAssetFiles(): string[] {
  const root = resolve(repoRoot, "static/assets");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path.slice(repoRoot.length + 1));
    }
  };
  walk(root);
  return files.sort();
}

const payload: WorkbenchAssetWorkspacePayload = {
  manifest: JSON.parse(
    readFileSync(resolve(assetsRoot, "manifest.json"), "utf8"),
  ) as AssetManifest,
  report: JSON.parse(
    readFileSync(resolve(assetsRoot, "report.json"), "utf8"),
  ) as AssetReport,
  configSources: {
    characters: {
      path: "static/assets/config/characters.yaml",
      content: readFileSync(
        resolve(repoRoot, "static/assets/config/characters.yaml"),
        "utf8",
      ),
    },
    audio: {
      path: "static/assets/config/audio.yaml",
      content: readFileSync(
        resolve(repoRoot, "static/assets/config/audio.yaml"),
        "utf8",
      ),
    },
  },
  scenes,
  existingAssetPaths: listStaticAssetFiles(),
};

const workspace = projectAssetWorkspace(payload);

// Check 2: no silently unresolved concrete presentation reference.
const manifestAssetIds = new Set(
  payload.manifest.entries.map((e) => e.assetId),
);
const isDiagnosed = (assetId: string): boolean =>
  workspace.diagnostics.some(
    (diagnostic) =>
      diagnostic.code === "assetUsageUnresolved" &&
      diagnostic.message.includes(`"${assetId}"`),
  );
const silentlyUnresolved: string[] = [];
for (const usage of workspace.sceneUsages) {
  if (usage.type === null && !isDiagnosed(usage.assetId)) {
    silentlyUnresolved.push(
      `${usage.chapterId}/${usage.sceneId} ${usage.role} "${usage.assetId}" at carrier "${usage.carrierId}"`,
    );
  }
}
for (const delta of workspace.sceneAudioDeltas) {
  if (
    delta.state === "set" &&
    delta.assetId !== null &&
    !manifestAssetIds.has(delta.assetId) &&
    !isDiagnosed(delta.assetId)
  ) {
    silentlyUnresolved.push(
      `${delta.chapterId}/${delta.sceneId} ${delta.channel} "${delta.assetId}" at carrier "${delta.carrierId}"`,
    );
  }
}
if (silentlyUnresolved.length > 0) {
  throw new Error(
    `presentation references resolved to no manifest entry and no unresolved diagnostic:\n${silentlyUnresolved.join("\n")}`,
  );
}

// Check 3 (HPA-601 Step 5.7): required rasters must physically exist. The
// compiler records a missing file as a non-blocking `assetFileMissing`
// warning, which checks 1-2 never inspect — so a deleted required raster
// would still pass this gate. Assert each required manifest entry's
// `expectedPath` is present in the collected `existingAssetPaths`.
const missingRequired = findMissingRequiredAssets(
  payload.manifest,
  payload.existingAssetPaths,
);
if (missingRequired.length > 0) {
  throw new Error(
    `required asset raster(s) missing from static/assets:\n${formatMissingRequiredAssets(missingRequired).join("\n")}`,
  );
}

const unresolvedCount = workspace.diagnostics.filter(
  (diagnostic) => diagnostic.code === "assetUsageUnresolved",
).length;
console.log(
  `verify-asset-real-content: OK — ${scenes.length} non-Analysis scene(s), ` +
    `${workspace.sceneUsages.length} usage(s), ` +
    `${workspace.sceneAudioDeltas.length} audio delta(s), ` +
    `${unresolvedCount} explicitly unresolved reference(s)`,
);
