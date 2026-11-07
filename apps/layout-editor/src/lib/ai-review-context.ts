// =============================================================================
// apps/layout-editor/src/lib/ai-review-context.ts
//
// HPA-136: the deterministic context projection between a Workbench selection
// and the AI review provider request. Context comes only from what the
// Workbench already holds in memory (the Reader projection and the asset
// manifest); story planning docs live outside the repo, so none are attached.
// This module never performs Tauri I/O.
// =============================================================================

import type { AssetManifestEntry } from "@lyra/scripts/compile-scenes/assets/manifest";
import type { AiReviewLens } from "./ai-review";
import type { AssetSceneUsage } from "./asset-workspace";
import type { PendingFocusedEditSelection } from "./focused-edit";
import type {
  ReaderEditableRef,
  ReaderGroup,
  ReaderItem,
  ReaderScene,
} from "./workbench-types";

export type AiReviewContextKind =
  | "selection"
  | "sceneProjection"
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
      kind: "assetPrompt";
      assetId: string;
      entry: AssetManifestEntry;
      usages: AssetSceneUsage[];
      editSelection: PendingFocusedEditSelection | null;
    };

/** Lenses a selection may run; the panel offers no others. */
export function allowedLensesForSelection(
  selection: AiReviewSelection,
): AiReviewLens[] {
  switch (selection.kind) {
    case "readerScene":
      return ["storyConsistency"];
    case "readerItem":
      return ["storyConsistency", "dialogue"];
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

function selectionBase(selection: AiReviewSelection): {
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

/**
 * The whole public Reader projection of a scene. Required when the scene
 * itself is the selection; a removable chip when a single item is.
 */
function sceneProjectionItem(
  scene: ReaderScene,
  required: boolean,
): AiReviewContextItem {
  return contextItem(
    "sceneProjection",
    "sceneProjection",
    "Reader 場景投影",
    scene.sourcePath,
    readerProjectionText(scene),
    required,
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
): ContextAccumulator {
  const accumulator: ContextAccumulator = { items: [], missing: [] };
  switch (selection.kind) {
    case "assetPrompt":
      addPromptContext(accumulator, selection);
      return accumulator;
    case "readerScene":
      // Story consistency reviews the current public Reader projection, not
      // just the title: the required projection chip carries the whole walk.
      accumulator.items.push(sceneProjectionItem(selection.scene, true));
      return accumulator;
    case "readerItem":
      if (lens === "dialogue") {
        addContainingGroup(accumulator, selection);
      } else {
        accumulator.items.push(sceneProjectionItem(selection.scene, false));
      }
      return accumulator;
  }
}

/**
 * Builds the deterministic context bundle for one selection + lens. The
 * selected source is a required chip; supporting chips are removable; a
 * supporting item whose `sourceRef` equals the selected source's `sourceRef`
 * is skipped so the same source is never attached twice.
 */
export function buildAiReviewContext(
  selection: AiReviewSelection,
  lens: AiReviewLens,
  options?: { removeContextRefs?: ReadonlyArray<string> },
): AiReviewContextBundle {
  const base = selectionBase(selection);
  const { items, missing } = supportingContext(selection, lens);
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
