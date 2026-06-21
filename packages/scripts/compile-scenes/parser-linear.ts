// =============================================================================
// packages/scripts/compile-scenes/parser-linear.ts
//
// Parses a linear scene (chapter_<N>/scene_<K>.md).
// Schema (see writing-detective-game-dialogue "Linear scene file format"):
//   # Scene N: <title>
//   <dialogue items in source order>
// No H2+ headings. Metadata is allowed only as immediate visual/audio asset
// cue metadata after a scene tag.
// =============================================================================

import { tokenize } from "./tokenizer";
import {
  parseVisualAssetCue,
  rejectUnknownAssetMetadata,
  VISUAL_ASSET_METADATA_KEYS,
} from "./parser-assets";
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

  if (
    tokens.length === 0 ||
    tokens[0]?.kind !== "heading" ||
    tokens[0].level !== 1
  ) {
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
      case "sceneTag": {
        const meta: Record<string, string> = {};
        const metadataLines: Record<string, number> = {};
        while (tokens[i + 1]?.kind === "metadata") {
          const next = tokens[++i]!;
          if (next.kind === "metadata") {
            meta[next.key] = next.value;
            metadataLines[next.key] = next.line;
          }
        }
        const bad = rejectUnknownAssetMetadata(
          meta,
          VISUAL_ASSET_METADATA_KEYS,
          sourceFile,
          tok.line,
          metadataLines,
        );
        if (bad) return { ok: false, error: bad };
        queue.push({
          kind: "sceneTag",
          text: tok.text,
          assetCue: parseVisualAssetCue(meta),
        });
        break;
      }
      case "action":
        queue.push({ kind: "action", text: tok.text });
        break;
      case "dialogue":
        queue.push({
          kind: "line",
          speaker: tok.speaker,
          text: tok.text,
          expression: tok.expression,
          portrait: null,
        });
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

  if (queue.length === 0) {
    return fail(
      sourceFile,
      titleToken.line,
      "linearSceneEmptyQueue",
      "Linear scene has no dialogue items after the heading. An empty scene causes the engine to end the game immediately.",
    );
  }

  return {
    ok: true,
    value: {
      kind: "linearScene",
      id,
      title,
      queue,
      assetRefs: [],
      sourceFile,
      line: titleToken.line,
    },
  };
}

function fail(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): LinearParseResult {
  return { ok: false, error: { code, message, sourceFile, line } };
}
