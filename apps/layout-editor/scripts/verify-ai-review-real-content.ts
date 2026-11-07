// =============================================================================
// apps/layout-editor/scripts/verify-ai-review-real-content.ts
//
// Real-corpus verifier for the HPA-136 AI review prompt-refinement context.
// Mirrors the other real-content verifiers: local reads only, no network, and
// it must FAIL when the compiler-owned prompt contract no longer matches the
// current Chapter 1 corpus — never hedge with fallback wording.
//
// Real Assets/compiler assertions (mirrors verify-asset-real-content.ts):
//   1. one real scene-owned Chapter 1 background/evidence manifest entry
//      yields globalStyle, typePrompt, optional authored subjectPrompt,
//      entryPrompt, concrete AssetSceneUsage[] impact, and a non-null
//      HPA-135 assetPromptEditSource() identity driving a replacement
//      target in the AI review bundle;
//   2. one real Chapter 1 portrait prompt yields the compiler-owned prompt
//      layers (including its authored subjectPrompt) but a null HPA-135
//      replacement target.
// =============================================================================

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChaptersIndex } from "@lyra/scene-types";
import type { AssetManifest } from "@lyra/scripts/compile-scenes/assets/manifest";
import type { AssetReport } from "@lyra/scripts/compile-scenes/orchestrator";
import { buildAiReviewContext } from "../src/lib/ai-review-context";
import {
  assetPromptEditSource,
  projectAssetWorkspace,
} from "../src/lib/asset-workspace";
import type {
  WorkbenchAssetScenePayload,
  WorkbenchAssetWorkspacePayload,
  WorkbenchScenePayload,
} from "../src/lib/workbench-types";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ---- real Assets/compiler prompt ownership ---------------------------
// Fresh compiler output projected exactly like verify-asset-real-content.ts
// (the load_asset_workspace payload shape). No story content is modified.

const resourcesRoot = resolve(repoRoot, "apps/game/src-tauri/resources");
const scenesRoot = resolve(resourcesRoot, "scenes");
const chapters = JSON.parse(
  readFileSync(resolve(resourcesRoot, "scenes/chapters.json"), "utf8"),
) as ChaptersIndex;
if (chapters.chapters.length === 0) {
  throw new Error("no compiled chapters found; run `bun run scenes:compile`");
}
const assetScenes: WorkbenchAssetScenePayload[] = [];
for (const chapter of chapters.chapters) {
  for (const entry of chapter.scenes) {
    if (entry.type === "analysis") continue; // Rust sanitizer owns Analysis.
    const compiled = JSON.parse(
      readFileSync(resolve(scenesRoot, entry.file), "utf8"),
    ) as WorkbenchScenePayload;
    assetScenes.push({
      chapterId: chapter.id,
      sceneId: entry.file.replace(/^.*\//, "").replace(/\.json$/, ""),
      sourcePath: `docs/stories_plan/${entry.file.replace(/\.json$/, ".md")}`,
      scene: compiled,
    });
  }
}

const staticAssetFiles: string[] = [];
const walkStaticAssets = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walkStaticAssets(path);
    else if (entry.isFile())
      staticAssetFiles.push(path.slice(repoRoot.length + 1));
  }
};
walkStaticAssets(resolve(repoRoot, "static/assets"));

const assetPayload: WorkbenchAssetWorkspacePayload = {
  manifest: JSON.parse(
    readFileSync(resolve(resourcesRoot, "assets/manifest.json"), "utf8"),
  ) as AssetManifest,
  report: JSON.parse(
    readFileSync(resolve(resourcesRoot, "assets/report.json"), "utf8"),
  ) as AssetReport,
  configSources: {
    characters: {
      path: "static/assets/config/characters.yaml",
      content: readSource("static/assets/config/characters.yaml"),
    },
    audio: {
      path: "static/assets/config/audio.yaml",
      content: readSource("static/assets/config/audio.yaml"),
    },
  },
  scenes: assetScenes,
  existingAssetPaths: staticAssetFiles.sort(),
};
const assetWorkspace = projectAssetWorkspace(assetPayload);
const manifestEntries = assetPayload.manifest.entries;

// ---- 1: one real scene-owned Chapter 1 background/evidence prompt ----------

const sceneOwnedEntry = manifestEntries.find(
  (entry) =>
    entry.source.chapterId === "chapter_1" &&
    ((entry.type === "background" && "unitId" in entry.source) ||
      (entry.type === "evidence" && "evidenceId" in entry.source)),
);
assert(
  sceneOwnedEntry !== undefined,
  "real corpus lost every scene-owned Chapter 1 background/evidence manifest entry",
);
const sceneOwnedParts = sceneOwnedEntry.promptParts;
assert(
  sceneOwnedParts.globalStyle.length > 0 &&
    sceneOwnedParts.typePrompt.length > 0 &&
    sceneOwnedParts.entryPrompt.length > 0,
  `scene-owned entry ${sceneOwnedEntry.assetId} lost a compiler prompt layer`,
);
assert(
  sceneOwnedParts.subjectPrompt === "" ||
    sceneOwnedEntry.finalPrompt.includes(sceneOwnedParts.subjectPrompt),
  `authored subjectPrompt of ${sceneOwnedEntry.assetId} must reach finalPrompt`,
);
for (const part of [
  sceneOwnedParts.globalStyle,
  sceneOwnedParts.typePrompt,
  sceneOwnedParts.entryPrompt,
]) {
  assert(
    sceneOwnedEntry.finalPrompt.includes(part),
    `finalPrompt of ${sceneOwnedEntry.assetId} must join every authored prompt layer`,
  );
}

const sceneOwnedUsages = assetWorkspace.sceneUsages.filter(
  (usage) => usage.assetId === sceneOwnedEntry.assetId,
);
assert(
  sceneOwnedUsages.length > 0,
  `scene-owned entry ${sceneOwnedEntry.assetId} lost its concrete scene usages`,
);
for (const usage of sceneOwnedUsages) {
  assert(
    usage.carrierId.length > 0 &&
      usage.sceneSourcePath.startsWith("docs/stories_plan/"),
    `usage row of ${sceneOwnedEntry.assetId} is not concrete: ${JSON.stringify(usage)}`,
  );
}

const sceneOwnedEditSource = assetPromptEditSource(sceneOwnedEntry);
assert(
  sceneOwnedEditSource !== null,
  `scene-owned entry ${sceneOwnedEntry.assetId} lost its HPA-135 edit identity`,
);
assert(
  sceneOwnedEditSource.chapterId === "chapter_1" &&
    sceneOwnedEditSource.sceneId === sceneOwnedEntry.source.sceneId &&
    sceneOwnedEditSource.authoredPrompt === sceneOwnedParts.entryPrompt &&
    sceneOwnedEditSource.kind ===
      (sceneOwnedEntry.type === "background"
        ? "backgroundPrompt"
        : "evidenceImagePrompt"),
  `HPA-135 edit identity of ${sceneOwnedEntry.assetId} drifted from the manifest source`,
);

const sceneOwnedBundle = buildAiReviewContext(
  {
    kind: "assetPrompt",
    assetId: sceneOwnedEntry.assetId,
    entry: sceneOwnedEntry,
    usages: sceneOwnedUsages,
    editSelection: {
      surface: "asset",
      assetId: sceneOwnedEntry.assetId,
      prompt: sceneOwnedEditSource,
      sceneUsages: sceneOwnedUsages,
    },
  },
  "promptRefinement",
);
for (const layer of ["globalStyle", "typePrompt", "entryPrompt"]) {
  assert(
    sceneOwnedBundle.context.some(
      (item) =>
        item.kind === "promptLayer" &&
        item.sourceRef === `asset-manifest:${sceneOwnedEntry.assetId}:${layer}`,
    ),
    `promptRefinement context must expose the ${layer} prompt layer`,
  );
}
assert(
  sceneOwnedBundle.context.some(
    (item) => item.kind === "usageImpact" && item.content.length > 0,
  ),
  "promptRefinement context must expose concrete usage impact",
);
const expectedSceneOwnedTargetRef =
  sceneOwnedEditSource.kind === "backgroundPrompt"
    ? `asset:background:${sceneOwnedEditSource.unitId}`
    : `asset:evidence:${sceneOwnedEditSource.evidenceId}:imagePrompt`;
assert(
  sceneOwnedBundle.replacementTargetRef === expectedSceneOwnedTargetRef,
  `scene-owned prompt replacement target drifted: expected ${expectedSceneOwnedTargetRef}, got ${sceneOwnedBundle.replacementTargetRef}`,
);
assert(
  sceneOwnedBundle.selectedText === sceneOwnedParts.entryPrompt,
  "asset prompt review must select the entry prompt text",
);

// ---- 2: one real Chapter 1 portrait prompt stays findings-only --------------

const portraitEntry = manifestEntries.find(
  (entry) =>
    entry.type === "portrait" && entry.source.chapterId === "chapter_1",
);
assert(
  portraitEntry !== undefined,
  "real corpus lost every Chapter 1 portrait manifest entry",
);
const portraitParts = portraitEntry.promptParts;
assert(
  portraitParts.globalStyle.length > 0 &&
    portraitParts.typePrompt.length > 0 &&
    portraitParts.entryPrompt.length > 0,
  `portrait entry ${portraitEntry.assetId} lost a compiler prompt layer`,
);
assert(
  portraitParts.subjectPrompt.length > 0 &&
    portraitEntry.finalPrompt.includes(portraitParts.subjectPrompt),
  `authored subjectPrompt of ${portraitEntry.assetId} must reach finalPrompt`,
);
assert(
  assetPromptEditSource(portraitEntry) === null,
  `character-owned portrait ${portraitEntry.assetId} must never expose an HPA-135 edit identity`,
);
const portraitBundle = buildAiReviewContext(
  {
    kind: "assetPrompt",
    assetId: portraitEntry.assetId,
    entry: portraitEntry,
    usages: assetWorkspace.sceneUsages.filter(
      (usage) => usage.assetId === portraitEntry.assetId,
    ),
    editSelection: null,
  },
  "promptRefinement",
);
assert(
  portraitBundle.context.some(
    (item) =>
      item.kind === "promptLayer" &&
      item.sourceRef ===
        `asset-manifest:${portraitEntry.assetId}:subjectPrompt`,
  ),
  "portrait prompt context must expose its authored subjectPrompt layer",
);
assert(
  portraitBundle.replacementTargetRef === null,
  "findings-only portrait review must carry a null replacement target",
);

console.log(
  `verify-ai-review-real-content: OK — ` +
    `scene-owned prompt ${sceneOwnedEntry.assetId} edit-owned, ` +
    `portrait ${portraitEntry.assetId} findings-only`,
);
