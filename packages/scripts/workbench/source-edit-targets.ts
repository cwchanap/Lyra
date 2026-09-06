// =============================================================================
// packages/scripts/workbench/source-edit-targets.ts
//
// HPA-135 one-line byte-preserving scene source renderer. Filesystem-free:
// reads only the compiler-provided physical line of the source document,
// never scans other lines, and preserves every byte around the replaced
// logical value (metadata prefix, speaker/expression markup, brackets,
// indentation, trailing whitespace, line endings).
// =============================================================================

import { tokenize } from "../compile-scenes/tokenizer";
import type { CompileError } from "../compile-scenes/types";

export type WorkbenchSourceTargetKind =
  | "readerDialogue"
  | "readerAction"
  | "backgroundPrompt"
  | "evidenceImagePrompt";

export type WorkbenchSourceTarget = {
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  line: number;
  currentText: string;
};

export type SceneSourceReplacementResult =
  | { ok: true; nextContent: string }
  | { ok: false; diagnostic: CompileError };

const PROMPT_KEY_BY_KIND: Record<
  "backgroundPrompt" | "evidenceImagePrompt",
  string
> = {
  backgroundPrompt: "Background Prompt",
  evidenceImagePrompt: "Image Prompt",
};

function fail(
  target: WorkbenchSourceTarget,
  code: string,
  message: string,
): { ok: false; diagnostic: CompileError } {
  return {
    ok: false,
    diagnostic: { code, message, sourceFile: "", line: target.line },
  };
}

function stale(
  target: WorkbenchSourceTarget,
  reason: string,
): { ok: false; diagnostic: CompileError } {
  return fail(
    target,
    "workbenchSourceCarrierStale",
    `Source no longer matches the compiled artifact for "${target.semanticRef}" at line ${target.line}: ${reason}. Run \`bun run scenes:compile\` and refresh.`,
  );
}

export function renderSceneSourceReplacement(input: {
  source: string;
  target: WorkbenchSourceTarget;
  replacementText: string;
}): SceneSourceReplacementResult {
  const { source, target, replacementText } = input;

  if (/[\r\n]/.test(replacementText)) {
    return fail(
      target,
      "workbenchSourceMultilineReplacementUnsupported",
      `Replacement for "${target.semanticRef}" must be a single line without CR/LF.`,
    );
  }

  const lines = source.split("\n");
  const raw = lines[target.line - 1];
  if (raw === undefined) {
    return stale(target, `line ${target.line} is outside the document`);
  }

  // Keep the original line ending intact: a trailing \r (CRLF file) stays.
  const hasCarriageReturn = raw.endsWith("\r");
  const body = hasCarriageReturn ? raw.slice(0, -1) : raw;
  const leadingWhitespace = body.length - body.trimStart().length;
  const trailingWhitespace = body.length - body.trimEnd().length;
  const trimmed = body.slice(
    leadingWhitespace,
    body.length - trailingWhitespace,
  );

  // Tokenize exactly the target physical line. One physical line yields at
  // most one token.
  const token = tokenize(trimmed, "")[0];

  // Tail offset of the replaced logical value inside `trimmed`.
  let valueEndOffset: number;

  if (
    target.kind === "backgroundPrompt" ||
    target.kind === "evidenceImagePrompt"
  ) {
    const expectedKey = PROMPT_KEY_BY_KIND[target.kind];
    if (!token || token.kind !== "metadata" || token.key !== expectedKey) {
      return stale(target, `expected a "- **${expectedKey}:**" metadata line`);
    }
    if (token.value !== target.currentText) {
      return stale(
        target,
        `metadata value is "${token.value}", compiled value is "${target.currentText}"`,
      );
    }
    valueEndOffset = 0;
  } else {
    const wanted = target.kind === "readerDialogue" ? "dialogue" : "action";
    if (!token) {
      return stale(target, "line is blank");
    }
    if (token.kind === "dialogue" || token.kind === "action") {
      if (token.kind !== wanted) {
        return stale(target, `line is a ${token.kind}, not a ${wanted}`);
      }
      if (token.text !== target.currentText) {
        return stale(target, `current value is "${token.text}"`);
      }
      valueEndOffset = token.kind === "action" ? 1 : 0; // closing bracket
    } else if (token.kind === "metadata") {
      // Metadata-wrapped Reader item: the outer metadata value re-tokenizes
      // to the inner dialogue/action (interrogation fields). The outer
      // prefix stays byte-identical; only the inner logical value moves.
      const inner = tokenize(token.value, "")[0];
      if (
        !inner ||
        inner.kind !== wanted ||
        inner.text !== target.currentText
      ) {
        return stale(
          target,
          "metadata value does not re-tokenize to the compiled dialogue/action",
        );
      }
      valueEndOffset = inner.kind === "action" ? 1 : 0;
    } else if (token.kind === "unknown" && trimmed.startsWith("[")) {
      // Bracketed block spanning multiple physical lines: read-only in v1.
      return fail(
        target,
        "workbenchSourceMultilineActionUnsupported",
        `Action at line ${target.line} spans multiple physical lines and is not editable in this version.`,
      );
    } else {
      return stale(target, `line is not an editable ${target.kind}`);
    }
  }

  const valueStart =
    trimmed.length - target.currentText.length - valueEndOffset;
  const newTrimmed =
    trimmed.slice(0, valueStart) +
    replacementText +
    trimmed.slice(valueStart + target.currentText.length);
  const newBody =
    body.slice(0, leadingWhitespace) +
    newTrimmed +
    (trailingWhitespace > 0
      ? body.slice(body.length - trailingWhitespace)
      : "");

  const nextLines = [...lines];
  nextLines[target.line - 1] = hasCarriageReturn ? `${newBody}\r` : newBody;
  const nextContent = nextLines.join("\n");

  // Defensive locality assertion: identical physical line count, exactly one
  // changed physical line, changed on the resolved target line only.
  const changed = nextLines
    .map((line, index) => (line === lines[index] ? -1 : index))
    .filter((index) => index >= 0);
  if (
    nextLines.length !== lines.length ||
    changed.length !== 1 ||
    changed[0] !== target.line - 1
  ) {
    return fail(
      target,
      "workbenchSourceNotFocused",
      `Replacement for "${target.semanticRef}" must change exactly the target line ${target.line}.`,
    );
  }

  return { ok: true, nextContent };
}
