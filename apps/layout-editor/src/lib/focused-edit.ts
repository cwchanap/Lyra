// =============================================================================
// apps/layout-editor/src/lib/focused-edit.ts
//
// HPA-135 Task 2: the focused draft seam between a Reader/Assets selection and
// the shared review UI. Resolution is compiler-owned only: Reader items join
// their authored source line by (carrierId, itemIndex) through
// resolveDialogueItemSource(); asset prompts join the typed manifest's
// promptLine + authoredPrompt. The current document must still agree with the
// compiled projection before any draft exists (focusedEditCompiledSourceStale),
// replacements are rendered by the Task-1 byte-preserving renderer, and the
// diff is one hand-rolled unified hunk with a locality assertion.
// =============================================================================

import {
  deriveDialogueSegments,
  dialogueSegmentCarrierId,
  resolveDialogueItemSource,
} from "@lyra/scripts/compile-scenes/dialogue-segment-origins";
import { NO_NEW_FINDINGS_DIALOGUE } from "@lyra/scripts/compile-scenes/semantic-defaults";
import { parseInterrogationScene } from "@lyra/scripts/compile-scenes/parser-interrogation";
import { parseInvestigationScene } from "@lyra/scripts/compile-scenes/parser-investigation";
import { parseLinearScene } from "@lyra/scripts/compile-scenes/parser-linear";
import { tokenize } from "@lyra/scripts/compile-scenes/tokenizer";
import type {
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  CompileError,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
} from "@lyra/scripts/compile-scenes/types";
import {
  renderSceneSourceReplacement,
  type WorkbenchSourceTarget,
  type WorkbenchSourceTargetKind,
} from "@lyra/scripts/workbench/source-edit-targets";
import type { AssetPromptEditSource, AssetSceneUsage } from "./asset-workspace";

/** HPA-135 v1 document identity: one authored scene Markdown file. */
export type SourceDocumentId = `scene:${string}:${string}`;

/** Exact request body of the Rust `apply_workbench_source_edit` command.
 * Carries only the six backend-guarded fields — no paths, no diff, no impact. */
export type ApplyWorkbenchSourceEditRequest = {
  sourceDocumentId: SourceDocumentId;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  expectedLine: number;
  nextContent: string;
};

export type WorkbenchValidationDiagnostic = { code: string; message: string };

/** Post-apply compile outcome: `ok: false` means written-but-invalid (no rollback). */
export type WorkbenchValidationReport = {
  ok: boolean;
  diagnostics: WorkbenchValidationDiagnostic[];
};

export type ApplyWorkbenchSourceEditResult = {
  validation: WorkbenchValidationReport;
};

/** Source document snapshot the draft is built from (hash echoed into Apply). */
export type FocusedEditSourceDocument = {
  id: SourceDocumentId;
  path: string;
  content: string;
  hash: string;
};

/**
 * Where a dialogue/action edit lands: the selected scene only. Character and
 * audio surfaces stay read-only and never produce impact.
 */
export type FocusedEditImpact =
  | { scope: "scene"; chapterId: string; sceneId: string }
  | {
      scope: "asset";
      assetId: string;
      scenes: Array<{ chapterId: string; sceneId: string }>;
      usages: number;
      shared: boolean;
    };

export type FocusedEditDraft = {
  sourceDocumentId: SourceDocumentId;
  sourcePath: string;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  expectedLine: number;
  originalText: string;
  replacementText: string;
  nextContent: string;
  impact: FocusedEditImpact;
};

/** The projected Reader line/action item a draft is opened from. */
export type ReaderFocusedEditItem =
  | { kind: "line"; speaker: string; text: string }
  | { kind: "action"; text: string };

export type FocusedEditSelection =
  | {
      surface: "reader";
      document: FocusedEditSourceDocument;
      chapterId: string;
      sceneId: string;
      compiledScene:
        | JSONLinearScene
        | JSONInvestigationScene
        | JSONInterrogationScene;
      carrierId: string;
      itemIndex: number;
      item: ReaderFocusedEditItem;
    }
  | {
      surface: "asset";
      document: FocusedEditSourceDocument;
      assetId: string;
      prompt: AssetPromptEditSource;
      sceneUsages: AssetSceneUsage[];
    };

export type OpenFocusedEditResult =
  | { ok: true; draft: FocusedEditDraft }
  | { ok: false; diagnostic: CompileError };

function fail(code: string, message: string): OpenFocusedEditResult {
  return {
    ok: false,
    diagnostic: { code, message, sourceFile: "", line: 0 },
  };
}

function compiledSourceStale(reason: string): OpenFocusedEditResult {
  return fail(
    "focusedEditCompiledSourceStale",
    `${reason} Run \`bun run scenes:compile\` and refresh before editing.`,
  );
}

// ---- one-hunk diff (2.3) ------------------------------------------------------

export type FocusedEditDiffLine = {
  kind: "context" | "del" | "add";
  text: string;
};

export type FocusedEditDiffHunk = {
  /** 1-based inclusive start line of the hunk in the original document. */
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: FocusedEditDiffLine[];
};

export type FocusedEditDiffResult =
  | { ok: true; hunk: FocusedEditDiffHunk }
  | { ok: false; diagnostic: CompileError };

const DIFF_CONTEXT_LINES = 3;

/**
 * Hand-rolled single-hunk unified-style diff with up to three context lines
 * per side. Asserts the renderer's locality contract independently: same
 * physical line count, exactly one changed line, changed on `expectedLine`.
 */
export function focusedEditDiff(
  originalContent: string,
  nextContent: string,
  expectedLine: number,
): FocusedEditDiffResult {
  const before = originalContent.split("\n");
  const after = nextContent.split("\n");
  const notFocused = (reason: string): FocusedEditDiffResult => ({
    ok: false,
    diagnostic: {
      code: "workbenchSourceNotFocused",
      message: `Focused edit must change exactly the expected line ${expectedLine}: ${reason}`,
      sourceFile: "",
      line: expectedLine,
    },
  });
  if (before.length !== after.length) {
    return notFocused("physical line count changed");
  }
  const changed = before
    .map((line, index) => (line === after[index] ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length !== 1) {
    return notFocused(
      `expected exactly one changed line, got ${changed.length}`,
    );
  }
  if (changed[0] !== expectedLine - 1) {
    return notFocused(`changed line ${changed[0] + 1} instead`);
  }
  const index = changed[0];
  const contextStart = Math.max(0, index - DIFF_CONTEXT_LINES);
  const contextEnd = Math.min(before.length - 1, index + DIFF_CONTEXT_LINES);
  const lines: FocusedEditDiffLine[] = [];
  for (let i = contextStart; i < index; i++) {
    lines.push({ kind: "context", text: before[i] as string });
  }
  lines.push({ kind: "del", text: before[index] as string });
  lines.push({ kind: "add", text: after[index] as string });
  for (let i = index + 1; i <= contextEnd; i++) {
    lines.push({ kind: "context", text: before[i] as string });
  }
  const contextCount = lines.length - 2;
  return {
    ok: true,
    hunk: {
      oldStart: contextStart + 1,
      oldLines: contextCount + 1,
      newStart: contextStart + 1,
      newLines: contextCount + 1,
      lines,
    },
  };
}

// ---- impact reuse (2.4) -------------------------------------------------------

function sceneImpact(chapterId: string, sceneId: string): FocusedEditImpact {
  return { scope: "scene", chapterId, sceneId };
}

function assetImpact(
  assetId: string,
  sceneUsages: AssetSceneUsage[],
): FocusedEditImpact {
  const rows = sceneUsages.filter((usage) => usage.assetId === assetId);
  const scenes = new Map<string, { chapterId: string; sceneId: string }>();
  for (const usage of rows) {
    scenes.set(`${usage.chapterId}\u0000${usage.sceneId}`, {
      chapterId: usage.chapterId,
      sceneId: usage.sceneId,
    });
  }
  return {
    scope: "asset",
    assetId,
    scenes: [...scenes.values()],
    usages: rows.length,
    shared: scenes.size > 1,
  };
}

// ---- reader source resolve (2.2) ----------------------------------------------

type EditableCompiledScene =
  | JSONLinearScene
  | JSONInvestigationScene
  | JSONInterrogationScene;

type EditableSourceAst =
  | ASTLinearScene
  | ASTInvestigationScene
  | ASTInterrogationScene;

/**
 * Parses the CURRENT document content with the compiler's own parser so the
 * source-line join proves the document still agrees with the compiled scene.
 * Analysis scenes are excluded: the editor only holds the sanitized public
 * view, so their full compiled scene cannot validate a source join.
 */
function parseEditableSceneSource(
  document: FocusedEditSourceDocument,
  compiled: EditableCompiledScene,
): { ok: true; ast: EditableSourceAst } | { ok: false; error: CompileError } {
  switch (compiled.type) {
    case "linear": {
      const parsed = parseLinearScene(
        document.content,
        document.path,
        compiled.id,
      );
      return parsed.ok ? { ok: true, ast: parsed.value } : parsed;
    }
    case "investigation": {
      const parsed = parseInvestigationScene(
        document.content,
        document.path,
        compiled.id,
      );
      return parsed.ok ? { ok: true, ast: parsed.value } : parsed;
    }
    case "interrogation": {
      const parsed = parseInterrogationScene(
        document.content,
        document.path,
        compiled.id,
      );
      return parsed.ok ? { ok: true, ast: parsed.value } : parsed;
    }
  }
}

/**
 * The compiler synthesizes default re-examination dialogue when authors omit
 * it; those items have no authored source line. Like the Task-1 real-content
 * verifier, they are "not editable" — recompiling would never make them
 * resolvable, so reporting compiled/source staleness would mislead.
 *
 * Exported so the Reader view can consult the same signal BEFORE rendering an
 * Edit affordance on items that could never open a draft (HPA-135 Task-2
 * review carry-over).
 */
export function isSynthesizedDefaultDialogue(
  item: ReaderFocusedEditItem,
): boolean {
  return (
    item.kind === "action" && item.text === NO_NEW_FINDINGS_DIALOGUE[0]!.text
  );
}

/**
 * Every action ref in the compiled scene: the fail-closed answer when the
 * document cannot be parsed against it — no action may render Edit when its
 * authored source line cannot be consulted.
 */
function allCompiledActionRefs(
  chapterId: string,
  compiledScene: EditableCompiledScene,
): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const segment of deriveDialogueSegments({
    chapterId,
    json: compiledScene,
  })) {
    const carrierId = dialogueSegmentCarrierId(segment.origin);
    segment.items.forEach((item, itemIndex) => {
      if (item.kind === "action") refs.add(`${carrierId}#${itemIndex}`);
    });
  }
  return refs;
}

/**
 * Reader actions whose authored source line does not contain the complete
 * action — multiline bracket blocks, read-only in v1 (plan lock). Uses the
 * same incomplete-bracket predicate as the replacement renderer's
 * `workbenchSourceMultilineActionUnsupported` rejection, so the Reader can
 * refuse to render an Edit affordance for them at all instead of failing
 * only at draft-open. Returns `carrierId#itemIndex` keys for the projection.
 * Fail-closed by design: a source join or line disagreement marks that
 * action, and a document that no longer parses marks every action — an
 * unverifiable action never renders Edit. The draft-open seam stays the
 * loud backstop.
 */
export function multilineReaderActionRefs(selection: {
  chapterId: string;
  document: FocusedEditSourceDocument;
  compiledScene: EditableCompiledScene;
}): ReadonlySet<string> {
  const parsed = parseEditableSceneSource(
    selection.document,
    selection.compiledScene,
  );
  if (!parsed.ok) {
    return allCompiledActionRefs(selection.chapterId, selection.compiledScene);
  }
  const segments = deriveDialogueSegments({
    chapterId: selection.chapterId,
    json: selection.compiledScene,
    sourceAst: parsed.ast,
  });
  const lines = selection.document.content.split("\n");
  const refs = new Set<string>();
  for (const segment of segments) {
    const carrierId = dialogueSegmentCarrierId(segment.origin);
    segment.items.forEach((item, itemIndex) => {
      if (item.kind !== "action") return;
      const source = segment.itemSources?.[itemIndex];
      const trimmed = source ? (lines[source.line - 1] ?? "").trim() : "";
      const token = tokenize(trimmed, "")[0];
      if (
        !source ||
        trimmed === "" ||
        (token?.kind === "unknown" && trimmed.startsWith("["))
      ) {
        refs.add(`${carrierId}#${itemIndex}`);
      }
    });
  }
  return refs;
}

// ---- draft assembly -------------------------------------------------------------

function buildDraft(
  document: FocusedEditSourceDocument,
  target: WorkbenchSourceTarget,
  impact: FocusedEditImpact,
  replacementText: string,
): OpenFocusedEditResult {
  const rendered = renderSceneSourceReplacement({
    source: document.content,
    target,
    replacementText,
  });
  if (!rendered.ok) {
    // The renderer's own compiled-vs-source disagreement is the same named
    // stale state, surfaced with the focused-edit code.
    if (rendered.diagnostic.code === "workbenchSourceCarrierStale") {
      return compiledSourceStale(rendered.diagnostic.message);
    }
    // A no-op replacement renders zero changed lines, which the renderer's
    // locality assert rejects; staleness still wins over the no-change guard.
    if (
      rendered.diagnostic.code === "workbenchSourceNotFocused" &&
      replacementText === target.currentText
    ) {
      return fail(
        "focusedEditNoChange",
        `Replacement for "${target.semanticRef}" equals the current text.`,
      );
    }
    return { ok: false, diagnostic: rendered.diagnostic };
  }
  const diff = focusedEditDiff(
    document.content,
    rendered.nextContent,
    target.line,
  );
  if (!diff.ok) return diff;
  return {
    ok: true,
    draft: {
      sourceDocumentId: document.id,
      sourcePath: document.path,
      expectedHash: document.hash,
      semanticRef: target.semanticRef,
      kind: target.kind,
      expectedLine: target.line,
      originalText: target.currentText,
      replacementText,
      nextContent: rendered.nextContent,
      impact,
    },
  };
}

/**
 * Opens the single focused-edit draft for one supported selection. No draft
 * exists on any failure — staleness, no-change, unsupported, unfocused.
 * `initialReplacement` prefills the reviewed replacement (HPA-136 reuse seam);
 * it defaults to an empty replacement.
 */
export function openFocusedEdit(
  selection: FocusedEditSelection,
  initialReplacement?: string,
): OpenFocusedEditResult {
  const replacementText = initialReplacement ?? "";
  if (selection.surface === "reader") {
    const { document, compiledScene, carrierId, itemIndex, item } = selection;
    const parsed = parseEditableSceneSource(document, compiledScene);
    if (!parsed.ok) {
      return compiledSourceStale(
        `Authored source "${document.path}" no longer parses against the compiled scene: ${parsed.error.message}`,
      );
    }
    const segments = deriveDialogueSegments({
      chapterId: selection.chapterId,
      json: compiledScene,
      sourceAst: parsed.ast,
    });
    const resolution = resolveDialogueItemSource(
      segments,
      carrierId,
      itemIndex,
    );
    if (!resolution.ok) {
      if (isSynthesizedDefaultDialogue(item)) {
        return fail(
          "focusedEditTargetNotEditable",
          `Dialogue carrier "${carrierId}" item ${itemIndex} is compiler-synthesized and has no authored source line to edit.`,
        );
      }
      return compiledSourceStale(resolution.error.message);
    }
    const isAction = item.kind === "action";
    return buildDraft(
      document,
      {
        semanticRef: `reader:${isAction ? "action" : "dialogue"}:${carrierId}:${itemIndex}`,
        kind: isAction ? "readerAction" : "readerDialogue",
        line: resolution.line,
        currentText: item.text,
      },
      sceneImpact(selection.chapterId, selection.sceneId),
      replacementText,
    );
  }

  const { document, prompt } = selection;
  const target: WorkbenchSourceTarget =
    prompt.kind === "backgroundPrompt"
      ? {
          semanticRef: `asset:background:${prompt.unitId}`,
          kind: "backgroundPrompt",
          line: prompt.promptLine,
          currentText: prompt.authoredPrompt,
        }
      : {
          semanticRef: `asset:evidence:${prompt.evidenceId}:imagePrompt`,
          kind: "evidenceImagePrompt",
          line: prompt.promptLine,
          currentText: prompt.authoredPrompt,
        };
  return buildDraft(
    document,
    target,
    assetImpact(selection.assetId, selection.sceneUsages),
    replacementText,
  );
}
