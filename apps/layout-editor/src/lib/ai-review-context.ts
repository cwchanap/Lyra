// =============================================================================
// apps/layout-editor/src/lib/ai-review-context.ts
//
// HPA-136: the deterministic, exact-match context projection between a
// Workbench selection and the AI review provider request. Every canon
// relationship resolves through the closed scene-id parser plus exact
// heading/label equality; missing context is reported, never guessed.
//
// All Markdown heading extraction is delegated to plan-workspace.ts's single
// Marked walk (headingSectionText / planSectionText over projected ranges);
// this module never lexes Markdown itself and never performs Tauri I/O.
// =============================================================================

import type { AssetManifestEntry } from "@lyra/scripts/compile-scenes/assets/manifest";
import type { AiReviewLens } from "./ai-review";
import type { AssetSceneUsage } from "./asset-workspace";
import type { PendingFocusedEditSelection } from "./focused-edit";
import {
  headingSectionText,
  planSectionText,
  type PlanHeading,
  type PlanWorkspace,
} from "./plan-workspace";
import type {
  ReaderEditableRef,
  ReaderGroup,
  ReaderItem,
  ReaderScene,
} from "./workbench-types";

export type AiReviewContextKind =
  | "selection"
  | "sceneProjection"
  | "chapterPlan"
  | "storyBible"
  | "revealBoundary"
  | "characterVoice"
  | "promptLayer"
  | "usageImpact";

export type AiReviewContextItem = {
  ref: string;
  kind: AiReviewContextKind;
  label: string;
  sourceRef: string;
  content: string;
  approxChars: number;
  required: boolean;
};

export type AiReviewMissingContext = {
  kind: AiReviewContextKind;
  label: string;
  reason: string;
};

/** Selection identity only — never provider output, never a write target. */
export type AiReviewSelection =
  | {
      kind: "readerScene";
      chapterId: string;
      sceneId: string;
      scene: ReaderScene;
    }
  | {
      kind: "readerItem";
      chapterId: string;
      sceneId: string;
      scene: ReaderScene;
      group: ReaderGroup;
      ref: ReaderEditableRef;
      item: Extract<ReaderItem, { kind: "line" | "action" }>;
      editSelection: PendingFocusedEditSelection;
    }
  | {
      kind: "planSection";
      documentId: string;
      anchor: string;
    }
  | {
      kind: "assetPrompt";
      assetId: string;
      entry: AssetManifestEntry;
      usages: AssetSceneUsage[];
      editSelection: PendingFocusedEditSelection | null;
    };

export type ChapterPlanTarget = {
  prefix: "Beat" | "Prologue";
  label: string;
};

/** Closed scene-id grammar: exact Beat/Prologue targets only, no fuzz. */
export function chapterPlanTargetForScene(
  sceneId: string,
): ChapterPlanTarget | null {
  const beat =
    /^(?:scene|investigation_scene|interrogation_scene|analysis_scene)_(\d+(?:_\d+)?)$/.exec(
      sceneId,
    );
  if (beat) {
    return { prefix: "Beat", label: beat[1]!.replaceAll("_", ".") };
  }

  const prologue = /^(?:scene|investigation_scene)_p(\d+)$/.exec(sceneId);
  return prologue ? { prefix: "Prologue", label: prologue[1]! } : null;
}

/** Lenses a selection may run; the panel offers no others. */
export function allowedLensesForSelection(
  selection: AiReviewSelection,
): AiReviewLens[] {
  switch (selection.kind) {
    case "readerScene":
      return ["storyConsistency"];
    case "readerItem":
      return ["storyConsistency", "dialogue"];
    case "planSection":
      return ["storyConsistency"];
    case "assetPrompt":
      return ["promptRefinement"];
  }
}

/** Everything the review panel needs except the lens and chip removals. */
export type AiReviewContextBundle = {
  selectedSourceRef: string;
  selectedText: string;
  replacementTargetRef: string | null;
  context: AiReviewContextItem[];
  missingContext: AiReviewMissingContext[];
};

// ----- assembly helpers -------------------------------------------------------

type ContextAccumulator = {
  items: AiReviewContextItem[];
  missing: AiReviewMissingContext[];
};

function readerItemText(item: ReaderItem): string {
  return item.kind === "line" ? `${item.speaker}: ${item.text}` : item.text;
}

function appendProjectionText(lines: string[], group: ReaderGroup): void {
  lines.push(group.label);
  for (const item of group.items) lines.push(readerItemText(item));
  for (const child of group.children) appendProjectionText(lines, child);
}

/** Deterministic public Reader projection text for one scene. */
function readerProjectionText(scene: ReaderScene): string {
  const lines: string[] = [scene.title];
  for (const group of scene.groups) appendProjectionText(lines, group);
  return lines.join("\n");
}

function contextItem(
  ref: string,
  kind: AiReviewContextKind,
  label: string,
  sourceRef: string,
  content: string,
  required = false,
): AiReviewContextItem {
  return {
    ref,
    kind,
    label,
    sourceRef,
    content,
    approxChars: content.length,
    required,
  };
}

function biblePath(workspace: PlanWorkspace): string {
  return (
    workspace.documents.find((document) => document.kind === "storyBible")
      ?.path ?? "docs/stories_plan/final_story_bible.md"
  );
}

function chapterNumberFor(chapterId: string): string | null {
  return /^chapter_(\d+)$/.exec(chapterId)?.[1] ?? null;
}

function speakerHeadingMatch(speaker: string) {
  return (heading: Pick<PlanHeading, "level" | "text" | "anchor">) =>
    heading.level === 3 &&
    (heading.text === speaker ||
      (heading.text.startsWith(`${speaker}（`) && heading.text.endsWith("）")));
}

/**
 * The HPA-135 semanticRef forms derived in focused-edit.ts `openFocusedEdit()`.
 * Kept textually paired — the replacement handoff re-derives the same ref.
 */
function readerSemanticRef(
  item: Extract<ReaderItem, { kind: "line" | "action" }>,
  ref: ReaderEditableRef,
): string {
  return `reader:${item.kind === "line" ? "dialogue" : "action"}:${ref.carrierId}:${ref.itemIndex}`;
}

function assetPromptSemanticRef(
  selection: Extract<AiReviewSelection, { kind: "assetPrompt" }>,
): string {
  const editSelection = selection.editSelection;
  const prompt =
    editSelection?.surface === "asset" ? editSelection.prompt : null;
  if (prompt?.kind === "backgroundPrompt") {
    return `asset:background:${prompt.unitId}`;
  }
  if (prompt?.kind === "evidenceImagePrompt") {
    return `asset:evidence:${prompt.evidenceId}:imagePrompt`;
  }
  // Findings-only prompts carry an entry-level identity instead.
  return `asset:${selection.entry.type}:${selection.entry.assetId}`;
}

function selectionBase(
  selection: AiReviewSelection,
  workspace: PlanWorkspace,
): {
  selectedSourceRef: string;
  selectedText: string;
  replacementTargetRef: string | null;
} {
  switch (selection.kind) {
    case "readerScene":
      return {
        selectedSourceRef: selection.scene.sourcePath,
        selectedText: selection.scene.title,
        replacementTargetRef: null,
      };
    case "readerItem": {
      const semanticRef = readerSemanticRef(selection.item, selection.ref);
      return {
        selectedSourceRef: `${selection.scene.sourcePath}#${semanticRef}`,
        selectedText: readerItemText(selection.item),
        replacementTargetRef: semanticRef,
      };
    }
    case "planSection": {
      const document = workspace.documents.find(
        (candidate) => candidate.id === selection.documentId,
      );
      return {
        selectedSourceRef: document
          ? `${document.path}#${selection.anchor}`
          : selection.documentId,
        selectedText: document
          ? (planSectionText(document, selection.anchor) ?? "")
          : "",
        replacementTargetRef: null,
      };
    }
    case "assetPrompt": {
      const semanticRef = assetPromptSemanticRef(selection);
      const sceneSourcePath = selection.usages[0]?.sceneSourcePath;
      return {
        selectedSourceRef: sceneSourcePath
          ? `${sceneSourcePath}#${semanticRef}`
          : semanticRef,
        selectedText:
          selection.entry.promptParts.entryPrompt ||
          selection.entry.finalPrompt,
        replacementTargetRef:
          selection.editSelection === null ? null : semanticRef,
      };
    }
  }
}

// ----- supporting context -------------------------------------------------------

/** Adds the voice section for one speaker; no/…multiple matches stay missing. */
function addCharacterVoice(
  accumulator: ContextAccumulator,
  speaker: string,
  workspace: PlanWorkspace,
): void {
  const section = headingSectionText(
    workspace.storyCharactersMd.content,
    speakerHeadingMatch(speaker),
  );
  if (section === null) {
    accumulator.missing.push({
      kind: "characterVoice",
      label: `角色聲音 ${speaker}`,
      reason: `「${workspace.storyCharactersMd.path}」必須恰好有一個符合「${speaker}」的 H3 小節。`,
    });
    return;
  }
  accumulator.items.push(
    contextItem(
      "characterVoice",
      "characterVoice",
      `角色聲音 ${speaker}`,
      `${workspace.storyCharactersMd.path}#${section.anchor}`,
      section.content,
    ),
  );
}

/**
 * The containing Reader group of a dialogue selection (spec §Context-by-lens,
 * Dialogue item 2): one removable sceneProjection chip anchored at the
 * group's source anchor. Groups without rendered items add no chip.
 */
function addContainingGroup(
  accumulator: ContextAccumulator,
  selection: Extract<AiReviewSelection, { kind: "readerItem" }>,
): void {
  const { group, scene } = selection;
  const content = group.items.map(readerItemText).join("\n");
  if (content === "") return;
  accumulator.items.push(
    contextItem(
      `readerGroup:${group.id}`,
      "sceneProjection",
      `Reader 群組 ${group.label}`,
      group.sourceAnchor
        ? `${scene.sourcePath}${group.sourceAnchor}`
        : scene.sourcePath,
      content,
    ),
  );
}

/**
 * Exact Beat/Prologue parent-plan section for a scene selection. Requires the
 * closed parser to succeed AND exactly one H1 beginning `<prefix> <label>：`.
 */
function addChapterPlanSection(
  accumulator: ContextAccumulator,
  chapterNumber: string | null,
  sceneId: string,
  workspace: PlanWorkspace,
): void {
  const target = chapterPlanTargetForScene(sceneId);
  if (target === null) {
    accumulator.missing.push({
      kind: "chapterPlan",
      label: `章節計畫（${sceneId}）`,
      reason: "場景 ID 不符合已定義的 Beat/Prologue 命名語法。",
    });
    return;
  }
  if (chapterNumber === null) {
    accumulator.missing.push({
      kind: "chapterPlan",
      label: `章節計畫 ${target.prefix} ${target.label}`,
      reason: `無法從章節 ID 解析章別：${sceneId}。`,
    });
    return;
  }
  const planDocument = workspace.documents.find(
    (document) =>
      document.kind === "chapterPlan" &&
      document.chapterNumber === Number(chapterNumber),
  );
  if (!planDocument) {
    accumulator.missing.push({
      kind: "chapterPlan",
      label: `章節計畫 ${target.prefix} ${target.label}`,
      reason: `找不到第 ${chapterNumber} 章計畫文件。`,
    });
    return;
  }
  const expected = `${target.prefix} ${target.label}：`;
  const matches = planDocument.headings.filter(
    (heading) => heading.level === 1 && heading.text.startsWith(expected),
  );
  if (matches.length !== 1) {
    accumulator.missing.push({
      kind: "chapterPlan",
      label: `章節計畫 ${target.prefix} ${target.label}`,
      reason: `章節計畫必須恰好有一個 H1「${expected}…」，實際 ${matches.length} 個。`,
    });
    return;
  }
  const heading = matches[0]!;
  accumulator.items.push(
    contextItem(
      "chapterPlan",
      "chapterPlan",
      `章節計畫 ${target.prefix} ${target.label}`,
      `${planDocument.path}#${heading.anchor}`,
      planSectionText(planDocument, heading.anchor) ?? heading.text,
    ),
  );
}

/** Exact `第 N 章：<overview title>` H2 — never the `第 N 章…` prefix family. */
function addStoryBibleChapter(
  accumulator: ContextAccumulator,
  chapterNumber: string,
  workspace: PlanWorkspace,
): void {
  const row =
    workspace.chapterOverview?.rows.find(
      (candidate) => candidate.chapter === chapterNumber,
    ) ?? null;
  const bibleDocument = workspace.documents.find(
    (document) => document.kind === "storyBible",
  );
  if (row === null || !bibleDocument) {
    accumulator.missing.push({
      kind: "storyBible",
      label: `故事聖經 第 ${chapterNumber} 章`,
      reason:
        row === null
          ? `章節總覽缺少第 ${chapterNumber} 章列。`
          : "找不到 Story Bible 文件。",
    });
    return;
  }
  const expected = `第 ${chapterNumber} 章：${row.title}`;
  const matches = bibleDocument.headings.filter(
    (heading) => heading.level === 2 && heading.text === expected,
  );
  if (matches.length !== 1) {
    accumulator.missing.push({
      kind: "storyBible",
      label: `故事聖經 ${expected}`,
      reason: `Story Bible 必須恰好有一個 H2「${expected}」，實際 ${matches.length} 個。`,
    });
    return;
  }
  const heading = matches[0]!;
  accumulator.items.push(
    contextItem(
      "storyBible",
      "storyBible",
      `故事聖經 ${expected}`,
      `${bibleDocument.path}#${heading.anchor}`,
      planSectionText(bibleDocument, heading.anchor) ?? expected,
    ),
  );
}

/** One stage whose `chapterLabel` is exactly `第 N 章`; ranges never match. */
function addRevealBoundaryStage(
  accumulator: ContextAccumulator,
  chapterNumber: string,
  workspace: PlanWorkspace,
): void {
  const expectedLabel = `第 ${chapterNumber} 章`;
  const ladder = workspace.aobaReveal;
  const stages =
    ladder?.stages.filter((stage) => stage.chapterLabel === expectedLabel) ??
    [];
  if (!ladder || stages.length !== 1) {
    accumulator.missing.push({
      kind: "revealBoundary",
      label: `青葉揭示邊界 ${expectedLabel}`,
      reason: `§18.5 必須恰好有一個「${expectedLabel}」列，實際 ${stages.length} 個。`,
    });
    return;
  }
  const stage = stages[0]!;
  accumulator.items.push(
    contextItem(
      "revealBoundary",
      "revealBoundary",
      `青葉揭示邊界 ${expectedLabel}`,
      `${biblePath(workspace)}#${ladder.anchor}`,
      `必須建立：${stage.mustEstablish}\n絕對不能建立：${stage.mustNotEstablish}`,
    ),
  );
}

/**
 * Chapter-scoped canon support for story-consistency reviews: exact parent
 * plan section (scene-driven only) + exact bible chapter + exact Aoba stage.
 */
function addChapterCanon(
  accumulator: ContextAccumulator,
  chapterNumber: string | null,
  sceneId: string | null,
  workspace: PlanWorkspace,
): void {
  if (sceneId !== null) {
    addChapterPlanSection(accumulator, chapterNumber, sceneId, workspace);
  }
  if (chapterNumber !== null) {
    addStoryBibleChapter(accumulator, chapterNumber, workspace);
    addRevealBoundaryStage(accumulator, chapterNumber, workspace);
  }
}

/**
 * Reveal-boundary canon for Bible-section plan reviews: every exact
 * `第 N 章` stage becomes one chip (range rows never do). Reviewing the
 * §18.5 section itself dedupes via the selected-sourceRef skip rule.
 */
function addBibleRevealChips(
  accumulator: ContextAccumulator,
  workspace: PlanWorkspace,
): void {
  const ladder = workspace.aobaReveal;
  if (!ladder) {
    accumulator.missing.push({
      kind: "revealBoundary",
      label: "青葉揭示邊界",
      reason: "找不到 §18.5 第一幕 reveal ladder。",
    });
    return;
  }
  for (const stage of ladder.stages) {
    if (!/^第 \d+ 章$/.test(stage.chapterLabel)) continue;
    accumulator.items.push(
      contextItem(
        `revealBoundary:${stage.chapterLabel}`,
        "revealBoundary",
        `青葉揭示邊界 ${stage.chapterLabel}`,
        `${biblePath(workspace)}#${ladder.anchor}`,
        `必須建立：${stage.mustEstablish}\n絕對不能建立：${stage.mustNotEstablish}`,
      ),
    );
  }
}

const PROMPT_LAYER_LABELS: Record<string, string> = {
  globalStyle: "全域風格",
  typePrompt: "類型提示",
  subjectPrompt: "主體提示",
  entryPrompt: "進場提示",
};

/** Prompt-layer + usage-impact context from the compiler's typed manifest. */
function addPromptContext(
  accumulator: ContextAccumulator,
  selection: Extract<AiReviewSelection, { kind: "assetPrompt" }>,
): void {
  const parts = selection.entry.promptParts;
  for (const [layer, content] of Object.entries(parts)) {
    if (content === "") continue;
    accumulator.items.push(
      contextItem(
        `promptLayer:${layer}`,
        "promptLayer",
        `提示層：${PROMPT_LAYER_LABELS[layer] ?? layer}`,
        `asset-manifest:${selection.entry.assetId}:${layer}`,
        content,
      ),
    );
  }
  if (selection.usages.length > 0) {
    accumulator.items.push(
      contextItem(
        "usageImpact",
        "usageImpact",
        "使用影響",
        `asset-manifest:${selection.entry.assetId}:usages`,
        selection.usages
          .map(
            (usage) =>
              `${usage.chapterId}/${usage.sceneId}｜${usage.carrierLabel}｜${usage.role}`,
          )
          .join("\n"),
      ),
    );
  }
}

function supportingContext(
  selection: AiReviewSelection,
  lens: AiReviewLens,
  workspace: PlanWorkspace,
): ContextAccumulator {
  const accumulator: ContextAccumulator = { items: [], missing: [] };
  switch (selection.kind) {
    case "readerScene":
      // Story consistency reviews the current public Reader projection, not
      // just the title: the required projection chip carries the whole walk.
      accumulator.items.push(
        contextItem(
          "sceneProjection",
          "sceneProjection",
          "Reader 場景投影",
          selection.scene.sourcePath,
          readerProjectionText(selection.scene),
          true,
        ),
      );
      addChapterCanon(
        accumulator,
        chapterNumberFor(selection.chapterId),
        selection.sceneId,
        workspace,
      );
      return accumulator;
    case "readerItem":
      if (lens === "dialogue") {
        addContainingGroup(accumulator, selection);
        addChapterCanon(
          accumulator,
          chapterNumberFor(selection.chapterId),
          selection.sceneId,
          workspace,
        );
        if (selection.item.kind === "line") {
          addCharacterVoice(accumulator, selection.item.speaker, workspace);
        }
        return accumulator;
      }
      addChapterCanon(
        accumulator,
        chapterNumberFor(selection.chapterId),
        selection.sceneId,
        workspace,
      );
      return accumulator;
    case "planSection": {
      const document = workspace.documents.find(
        (candidate) => candidate.id === selection.documentId,
      );
      if (document?.kind === "chapterPlan" && document.chapterNumber !== null) {
        addChapterCanon(
          accumulator,
          String(document.chapterNumber),
          null,
          workspace,
        );
      } else if (document?.kind === "storyBible") {
        addBibleRevealChips(accumulator, workspace);
      }
      return accumulator;
    }
    case "assetPrompt":
      addPromptContext(accumulator, selection);
      return accumulator;
  }
}

/**
 * Builds the deterministic context bundle for one selection + lens. The
 * selected source is a required chip; supporting chips are removable; a
 * supporting item whose `sourceRef` equals the selected source's `sourceRef`
 * is skipped so Plan-on-Aoba never attaches the same source twice.
 */
export function buildAiReviewContext(
  selection: AiReviewSelection,
  lens: AiReviewLens,
  workspace: PlanWorkspace,
  options?: { removeContextRefs?: ReadonlyArray<string> },
): AiReviewContextBundle {
  const base = selectionBase(selection, workspace);
  const { items, missing } = supportingContext(selection, lens, workspace);
  const remove = new Set(options?.removeContextRefs ?? []);
  const selectionChip = contextItem(
    "selection",
    "selection",
    "選取內容",
    base.selectedSourceRef,
    base.selectedText,
    true,
  );
  const context = [selectionChip, ...items].filter(
    (item) =>
      item.required ||
      (!remove.has(item.ref) && item.sourceRef !== base.selectedSourceRef),
  );
  return {
    selectedSourceRef: base.selectedSourceRef,
    selectedText: base.selectedText,
    replacementTargetRef: base.replacementTargetRef,
    context,
    missingContext: missing,
  };
}
