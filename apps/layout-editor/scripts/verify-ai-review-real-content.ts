// =============================================================================
// apps/layout-editor/scripts/verify-ai-review-real-content.ts
//
// Real-corpus verifier for the HPA-136 AI review context projection. Mirrors
// the other real-content verifiers: local reads only, no network, and it must
// FAIL when the exact matching contract no longer matches the current Chapter
// 1 corpus — never hedge with fallback wording.
//
// Task-1 core assertions:
//   1.  scene_p0                 -> unique H1 `Prologue 0：...`
//   2.  investigation_scene_p1   -> unique H1 `Prologue 1：...`
//   3.  scene_p2                 -> unique H1 `Prologue 2：...`
//   4.  scene_2                  -> unique H1 `Beat 2：...`
//   5.  analysis_scene_8_5       -> unique H1 `Beat 8.5：...`
//   6.  analysis_scene_p1_5 and investigation_scene_map_01 stay missing
//   7.  Chapter 1 Bible resolves exactly to `第 1 章：雨鐘咖啡館殺人事件`
//       and not `第 1 章角色外貌與細節`
//   8.  Chapter 1 Aoba stage is exactly `第 1 章`
//   9.  `相馬律` resolves to exactly one `characters.md` H3 through
//       headingSectionText()
//   10. selecting the Aoba source itself does not duplicate that sourceRef
//       as support
//
// Real Assets/compiler assertions (mirrors verify-asset-real-content.ts):
//   11. one real scene-owned Chapter 1 background/evidence manifest entry
//       yields globalStyle, typePrompt, optional authored subjectPrompt,
//       entryPrompt, concrete AssetSceneUsage[] impact, and a non-null
//       HPA-135 assetPromptEditSource() identity driving a replacement
//       target in the AI review bundle;
//   12. one real Chapter 1 portrait prompt yields the compiler-owned prompt
//       layers (including its authored subjectPrompt) but a null HPA-135
//       replacement target.
// =============================================================================

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChaptersIndex } from "@lyra/scene-types";
import type { AssetManifest } from "@lyra/scripts/compile-scenes/assets/manifest";
import type { AssetReport } from "@lyra/scripts/compile-scenes/orchestrator";
import {
  buildAiReviewContext,
  chapterPlanTargetForScene,
  type AiReviewSelection,
} from "../src/lib/ai-review-context";
import {
  assetPromptEditSource,
  projectAssetWorkspace,
} from "../src/lib/asset-workspace";
import {
  headingSectionText,
  projectPlanWorkspace,
} from "../src/lib/plan-workspace";
import type {
  ReaderScene,
  WorkbenchAssetScenePayload,
  WorkbenchAssetWorkspacePayload,
  WorkbenchScenePayload,
} from "../src/lib/workbench-types";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const BIBLE_PATH = "docs/stories_plan/final_story_bible.md";
const CHAPTER_PLAN_PATH = "docs/stories_plan/chapter_1_plan.md";
const CHARACTERS_PATH = "docs/stories_plan/characters.md";

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspace = projectPlanWorkspace({
  documents: [
    {
      id: "story-bible",
      kind: "storyBible",
      path: BIBLE_PATH,
      content: readSource(BIBLE_PATH),
      chapterNumber: null,
    },
    {
      id: "chapter-1-plan",
      kind: "chapterPlan",
      path: CHAPTER_PLAN_PATH,
      content: readSource(CHAPTER_PLAN_PATH),
      chapterNumber: 1,
    },
  ],
  storyCharactersMd: {
    path: CHARACTERS_PATH,
    content: readSource(CHARACTERS_PATH),
  },
});

const planDocument = workspace.documents.find(
  (document) => document.kind === "chapterPlan",
);
assert(planDocument !== undefined, "chapter 1 plan document missing");

function sceneSelection(sceneId: string): AiReviewSelection {
  const scene: ReaderScene = {
    id: sceneId,
    type: "linear",
    title: sceneId,
    sourcePath: `docs/stories_plan/chapter_1/${sceneId}.md`,
    groups: [],
    presentation: [],
  };
  return { kind: "readerScene", chapterId: "chapter_1", sceneId, scene };
}

// ---- 1–5: each resolvable scene target owns exactly one real H1 -------------

const RESOLVED_TARGETS = [
  ["scene_p0", "Prologue 0："],
  ["investigation_scene_p1", "Prologue 1："],
  ["scene_p2", "Prologue 2："],
  ["scene_2", "Beat 2："],
  ["analysis_scene_8_5", "Beat 8.5："],
] as const;

for (const [sceneId, expectedPrefix] of RESOLVED_TARGETS) {
  const target = chapterPlanTargetForScene(sceneId);
  assert(
    target !== null && `${target.prefix} ${target.label}：` === expectedPrefix,
    `${sceneId} closed-parser target drifted: expected prefix ${expectedPrefix}`,
  );
  const matches = planDocument.headings.filter(
    (heading) => heading.level === 1 && heading.text.startsWith(expectedPrefix),
  );
  assert(
    matches.length === 1,
    `${sceneId} must resolve to exactly one H1 beginning "${expectedPrefix}", found ${matches.length}`,
  );
  const heading = matches[0]!;
  const bundle = buildAiReviewContext(
    sceneSelection(sceneId),
    "storyConsistency",
    workspace,
  );
  const chip = bundle.context.find((item) => item.kind === "chapterPlan");
  assert(
    chip !== undefined &&
      chip.sourceRef === `${CHAPTER_PLAN_PATH}#${heading.anchor}`,
    `${sceneId} chapterPlan chip must anchor the unique real H1 "${heading.text}"`,
  );
  assert(
    bundle.missingContext.length === 0,
    `${sceneId} resolved every canon source but reported: ${JSON.stringify(bundle.missingContext)}`,
  );
}

// ---- 6: map wrappers / un-authored prologue beats stay visibly missing ------

for (const sceneId of ["analysis_scene_p1_5", "investigation_scene_map_01"]) {
  assert(
    chapterPlanTargetForScene(sceneId) === null,
    `${sceneId} must not resolve to a closed chapter-plan target`,
  );
  const bundle = buildAiReviewContext(
    sceneSelection(sceneId),
    "storyConsistency",
    workspace,
  );
  assert(
    !bundle.context.some((item) => item.kind === "chapterPlan"),
    `${sceneId} must not fabricate plan context`,
  );
  assert(
    bundle.missingContext.some((item) => item.kind === "chapterPlan"),
    `${sceneId} missing parent-plan context must stay visible`,
  );
}

// ---- 7: exact Story Bible Chapter 1 H2 --------------------------------------

const scene2 = buildAiReviewContext(
  sceneSelection("scene_2"),
  "storyConsistency",
  workspace,
);
const bibleDocument = workspace.documents.find(
  (document) => document.kind === "storyBible",
);
assert(bibleDocument !== undefined, "Story Bible document missing");

const exactBibleHeading = bibleDocument.headings.find(
  (heading) =>
    heading.level === 2 && heading.text === "第 1 章：雨鐘咖啡館殺人事件",
);
assert(
  exactBibleHeading !== undefined,
  "real corpus lost the exact H2 第 1 章：雨鐘咖啡館殺人事件",
);
const decoyBibleHeading = bibleDocument.headings.find(
  (heading) => heading.level === 2 && heading.text === "第 1 章角色外貌與細節",
);
assert(
  decoyBibleHeading !== undefined,
  "real corpus lost the decoy H2 第 1 章角色外貌與細節 (this gate pins that it is NOT selected)",
);
const bibleChip = scene2.context.find((item) => item.kind === "storyBible");
assert(
  bibleChip !== undefined &&
    bibleChip.sourceRef === `${BIBLE_PATH}#${exactBibleHeading.anchor}`,
  "Chapter 1 bible chip must anchor exactly 第 1 章：雨鐘咖啡館殺人事件",
);
assert(
  bibleChip.sourceRef !== `${BIBLE_PATH}#${decoyBibleHeading.anchor}`,
  "bible chip must never anchor 第 1 章角色外貌與細節",
);

// ---- 8: exact Aoba stage label ----------------------------------------------

const aobaReveal = workspace.aobaReveal;
assert(aobaReveal !== null, "§18.5 reveal ladder missing from the Story Bible");
const stage1 = aobaReveal.stages.find(
  (stage) => stage.chapterLabel === "第 1 章",
);
assert(stage1 !== undefined, "§18.5 lost the exact 第 1 章 stage row");
assert(
  !aobaReveal.stages.some((stage) =>
    /^第 5 章$|^第 6 章$|^第 7 章$/.test(stage.chapterLabel),
  ),
  "§18.5 unexpectedly gained exact 第 5/6/7 章 rows; range rows must stay the only carriers",
);
const aobaChip = scene2.context.find((item) => item.kind === "revealBoundary");
assert(
  aobaChip !== undefined &&
    aobaChip.sourceRef === `${BIBLE_PATH}#${aobaReveal.anchor}` &&
    aobaChip.content ===
      `必須建立：${stage1.mustEstablish}\n絕對不能建立：${stage1.mustNotEstablish}`,
  "Aoba chip must carry the exact 第 1 章 stage and link §18.5",
);

// ---- 9: speaker voice section through the shared heading walk ---------------

const speakerPredicate = (heading: { level: number; text: string }) =>
  heading.level === 3 &&
  (heading.text === "相馬律" ||
    (heading.text.startsWith("相馬律（") && heading.text.endsWith("）")));
const speakerSection = headingSectionText(
  workspace.storyCharactersMd.content,
  speakerPredicate,
);
assert(
  speakerSection !== null,
  "相馬律 must resolve to exactly one characters.md H3 section",
);
assert(
  speakerSection.text === "相馬律（主角）",
  `real 相馬律 H3 drifted: ${speakerSection.text}`,
);
const somaBundle = buildAiReviewContext(
  {
    kind: "readerItem",
    chapterId: "chapter_1",
    sceneId: "scene_2",
    scene: {
      id: "scene_2",
      type: "linear",
      title: "scene_2",
      sourcePath: "docs/stories_plan/chapter_1/scene_2.md",
      groups: [],
      presentation: [],
    },
    group: {
      id: "intro",
      kind: "intro",
      label: "intro",
      flow: "main",
      sourceAnchor: null,
      items: [],
      children: [],
    },
    ref: { carrierId: "intro", itemIndex: 0 },
    item: {
      kind: "line",
      speaker: "相馬律",
      text: "相馬律：先不要急著判斷。",
      editable: { carrierId: "intro", itemIndex: 0 },
    },
    editSelection: {
      surface: "reader",
      chapterId: "chapter_1",
      sceneId: "scene_2",
      compiledScene: {} as unknown as WorkbenchScenePayload,
      carrierId: "intro",
      itemIndex: 0,
      item: {
        kind: "line",
        speaker: "相馬律",
        text: "相馬律：先不要急著判斷。",
      },
    },
  },
  "dialogue",
  workspace,
);
const voiceChip = somaBundle.context.find(
  (item) => item.kind === "characterVoice",
);
assert(
  voiceChip !== undefined &&
    voiceChip.sourceRef === `${CHARACTERS_PATH}#${speakerSection.anchor}` &&
    voiceChip.content === speakerSection.content,
  "dialogue voice chip must carry the exact 相馬律（主角） section",
);

// ---- 10: Plan-on-Aoba never duplicates the selected sourceRef ---------------

const aobaSelection: AiReviewSelection = {
  kind: "planSection",
  documentId: "story-bible",
  anchor: aobaReveal.anchor,
};
const aobaBundle = buildAiReviewContext(
  aobaSelection,
  "storyConsistency",
  workspace,
);
assert(
  aobaBundle.selectedSourceRef === `${BIBLE_PATH}#${aobaReveal.anchor}`,
  "Plan-on-Aoba selected sourceRef drifted",
);
assert(
  !aobaBundle.context.some((item) => item.kind === "revealBoundary"),
  "Plan-on-Aoba must not attach the same sourceRef as supporting context",
);
assert(
  aobaBundle.context.some((item) => item.required && item.kind === "selection"),
  "Plan-on-Aoba must keep the required selection chip",
);

// ---- 11–12: real Assets/compiler prompt ownership ---------------------------
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

// ---- 11: one real scene-owned Chapter 1 background/evidence prompt ----------

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
  workspace,
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

// ---- 12: one real Chapter 1 portrait prompt stays findings-only --------------

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
  workspace,
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
  `verify-ai-review-real-content: OK — ${RESOLVED_TARGETS.length} plan target(s), ` +
    `bible/aoba/voice chips exact, Plan-on-Aoba deduped, ` +
    `scene-owned prompt ${sceneOwnedEntry.assetId} edit-owned, ` +
    `portrait ${portraitEntry.assetId} findings-only`,
);
