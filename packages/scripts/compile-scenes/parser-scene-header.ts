import type { CompileError } from "./types";
import type { Token } from "./tokenizer";

export type ParsedSceneHeader = {
  title: string;
  summary: string;
  summaryAuthored: boolean;
  nextTokenIndex: number;
  line: number;
};

export type SceneHeaderParseResult =
  | { ok: true; value: ParsedSceneHeader }
  | { ok: false; error: CompileError };

type MissingTitleError = Pick<CompileError, "code" | "message">;

const SCENE_TITLE_RE = /^Scene\s+(?:\d+|P\d+|\d+\.\d+):\s*(.+)$/;
const DASHLESS_SUMMARY_RE = /^\*\*Summary:\*\*\s*(.*)$/;
const BLANK_SUMMARY_RE = /^-\s+\*\*Summary:\*\*\s*$/;

export function parseSceneHeader(
  tokens: Token[],
  sourceFile: string,
  missingTitle: MissingTitleError,
): SceneHeaderParseResult {
  const first = tokens[0];
  if (!first || first.kind !== "heading" || first.level !== 1) {
    return fail(
      sourceFile,
      first?.line ?? 1,
      missingTitle.code,
      missingTitle.message,
    );
  }

  const titleMatch = SCENE_TITLE_RE.exec(first.text);
  const title = titleMatch?.[1]?.trim();
  if (!title) {
    return fail(
      sourceFile,
      first.line,
      missingTitle.code,
      missingTitle.message,
    );
  }

  let summary = title;
  let summaryAuthored = false;
  let nextTokenIndex = 1;
  const immediate = tokens[nextTokenIndex];
  const immediateError = summarySyntaxError(immediate, sourceFile);
  if (immediateError) return immediateError;

  if (immediate?.kind === "metadata" && immediate.key === "Summary") {
    const authoredSummary = immediate.value.trim();
    if (!authoredSummary) {
      return fail(
        sourceFile,
        immediate.line,
        "sceneSummaryBlank",
        "Scene Summary must not be blank.",
      );
    }
    summary = authoredSummary;
    summaryAuthored = true;
    nextTokenIndex++;
  }

  for (let i = nextTokenIndex; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const syntaxError = summarySyntaxError(token, sourceFile);
    if (syntaxError) return syntaxError;
    if (token.kind === "metadata" && token.key === "Summary") {
      return fail(
        sourceFile,
        token.line,
        summaryAuthored ? "sceneSummaryDuplicate" : "sceneSummaryMisplaced",
        summaryAuthored
          ? "Scene may declare Summary only once."
          : "Scene Summary must appear immediately after the H1 title.",
      );
    }
  }

  return {
    ok: true,
    value: {
      title,
      summary,
      summaryAuthored,
      nextTokenIndex,
      line: first.line,
    },
  };
}

function summarySyntaxError(
  token: Token | undefined,
  sourceFile: string,
): SceneHeaderParseResult | null {
  if (!token || token.kind !== "unknown") return null;
  if (DASHLESS_SUMMARY_RE.test(token.text)) {
    return fail(
      sourceFile,
      token.line,
      "sceneSummaryMalformedSyntax",
      "Scene Summary must use `- **Summary:** <text>` metadata syntax.",
    );
  }
  if (BLANK_SUMMARY_RE.test(token.text)) {
    return fail(
      sourceFile,
      token.line,
      "sceneSummaryBlank",
      "Scene Summary must not be blank.",
    );
  }
  return null;
}

function fail(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): SceneHeaderParseResult {
  return { ok: false, error: { code, message, sourceFile, line } };
}
