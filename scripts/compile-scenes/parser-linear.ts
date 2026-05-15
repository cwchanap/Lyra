// =============================================================================
// scripts/compile-scenes/parser-linear.ts
//
// Parses a linear scene (chapter_<N>/scene_<K>.md).
// Schema (see writing-detective-game-dialogue "Linear scene file format"):
//   # Scene N: <title>
//   <dialogue items in source order>
// No H2+ headings, no metadata.
// =============================================================================

import { tokenize, type Token } from "./tokenizer";
import type { ASTLinearScene, CompileError, DialogueItem } from "./types";

export type LinearParseResult =
  | { ok: true; value: ASTLinearScene }
  | { ok: false; error: CompileError };

export function parseLinearScene(
  source: string,
  sourceFile: string,
  id: string,
): LinearParseResult {
  const tokens = tokenize(source, sourceFile);

  if (tokens.length === 0 || tokens[0]?.kind !== "heading" || tokens[0].level !== 1) {
    return fail(
      sourceFile,
      tokens[0]?.line ?? 1,
      "linearSceneMissingTitle",
      "Linear scene must start with a `# Scene N: <title>` heading.",
    );
  }

  const titleToken = tokens[0];
  // Title text is "Scene 0: 接案" — strip the leading "Scene N:" part.
  const titleMatch = /^Scene\s+\d+:\s*(.+)$/.exec(titleToken.text);
  const title = titleMatch ? (titleMatch[1] ?? "").trim() : titleToken.text;

  const queue: DialogueItem[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;

    switch (tok.kind) {
      case "heading":
        return fail(
          sourceFile,
          tok.line,
          "linearSceneHasHeadings",
          `Linear scenes allow only the top-level H1. Found level-${tok.level} heading: ${tok.text}`,
        );
      case "metadata":
        return fail(
          sourceFile,
          tok.line,
          "linearSceneHasMetadata",
          `Linear scenes have no metadata. Found: ${tok.key}.`,
        );
      case "sceneTag":
        queue.push({ kind: "sceneTag", text: tok.text });
        break;
      case "action":
        queue.push({ kind: "action", text: tok.text });
        break;
      case "dialogue":
        queue.push({ kind: "line", speaker: tok.speaker, text: tok.text });
        break;
      case "unknown":
        return fail(
          sourceFile,
          tok.line,
          "linearSceneUnknownLine",
          `Unrecognized line: ${tok.text}`,
        );
    }
  }

  return {
    ok: true,
    value: {
      kind: "linearScene",
      id,
      title,
      queue,
      sourceFile,
      line: titleToken.line,
    },
  };
}

function fail(sourceFile: string, line: number, code: string, message: string): LinearParseResult {
  return { ok: false, error: { code, message, sourceFile, line } };
}
