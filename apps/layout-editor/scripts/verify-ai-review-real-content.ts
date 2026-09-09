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
// =============================================================================

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAiReviewContext,
  chapterPlanTargetForScene,
  type AiReviewSelection,
} from "../src/lib/ai-review-context";
import {
  headingSectionText,
  projectPlanWorkspace,
} from "../src/lib/plan-workspace";
import type {
  ReaderScene,
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

console.log(
  `verify-ai-review-real-content: OK — ${RESOLVED_TARGETS.length} plan target(s), ` +
    `bible/aoba/voice chips exact, Plan-on-Aoba deduped`,
);
