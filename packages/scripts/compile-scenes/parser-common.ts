import {
  parseVisualAssetCue,
  rejectUnknownAssetMetadata,
  VISUAL_ASSET_METADATA_KEYS,
} from "./parser-assets";
import type { Token } from "./tokenizer";
import type { CompileError, DialogueItem } from "./types";

type CursorLike = {
  readonly sourceFile: string;
  peek(): Token | undefined;
  next(): Token | undefined;
};

type DialogueResult =
  | { ok: true; value: DialogueItem[] }
  | { ok: false; error: CompileError };

export function consumeMetadata(
  cur: CursorLike,
):
  | { ok: true; value: Record<string, string> }
  | { ok: false; error: CompileError } {
  const out: Record<string, string> = {};
  while (true) {
    const next = cur.peek();
    if (!next || next.kind !== "metadata") return { ok: true, value: out };
    cur.next();
    out[next.key] = next.value;
  }
}

export function consumeDialogueUntilHeading(
  cur: CursorLike,
  _atOrAboveLevel: number,
): DialogueResult {
  // Stops at ANY heading regardless of level. Every dialogue body in this
  // grammar terminates at the next heading (the next structural block or an
  // optional sub-block like On Reexamine), so a level-aware check would
  // silently swallow headings whose level exceeds the cutoff. The level
  // parameter is kept for documentation but no longer affects behavior.
  //
  // Unknown/metadata tokens inside a dialogue body are a hard error — they
  // indicate authoring mistakes (typo'd dialogue line, stray metadata) that
  // would otherwise be silently lost.
  const out: DialogueItem[] = [];
  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading") break;
    cur.next();
    if (next.kind === "sceneTag") {
      const meta: Record<string, string> = {};
      const metadataLines: Record<string, number> = {};
      while (cur.peek()?.kind === "metadata") {
        const metadata = cur.next()!;
        if (metadata.kind === "metadata") {
          meta[metadata.key] = metadata.value;
          metadataLines[metadata.key] = metadata.line;
        }
      }
      const bad = rejectUnknownAssetMetadata(
        meta,
        VISUAL_ASSET_METADATA_KEYS,
        cur.sourceFile,
        next.line,
        metadataLines,
      );
      if (bad) return { ok: false, error: bad };
      out.push({
        kind: "sceneTag",
        text: next.text,
        assetCue:
          Object.keys(meta).length > 0 ? parseVisualAssetCue(meta) : null,
      });
    } else if (next.kind === "action")
      out.push({ kind: "action", text: next.text });
    else if (next.kind === "dialogue") {
      out.push({
        kind: "line",
        speaker: next.speaker,
        text: next.text,
        expression: next.expression,
        portrait: null,
      });
    } else if (next.kind === "metadata") {
      return parseFailure(
        cur.sourceFile,
        next.line,
        "strayMetadataInDialogueBody",
        `Stray metadata in dialogue body: ${next.key}.`,
      );
    } else if (next.kind === "unknown") {
      return parseFailure(
        cur.sourceFile,
        next.line,
        "unrecognizedDialogueLine",
        `Unrecognized line in dialogue body: ${next.text}.`,
      );
    }
  }
  return { ok: true, value: out };
}

export function describeToken(tok: Token): string {
  switch (tok.kind) {
    case "heading":
      return `H${tok.level} "${tok.text}"`;
    case "metadata":
      return `metadata ${tok.key}`;
    case "sceneTag":
      return `[場景：${tok.text}]`;
    case "action":
      return `[${tok.text}]`;
    case "dialogue":
      return `**${tok.speaker}**：${tok.text}`;
    case "unknown":
      return `unknown(${tok.text})`;
    default: {
      // Exhaustiveness guard: adding a new Token kind is a compile error here
      // instead of silently returning undefined at runtime.
      const _exhaustive: never = tok;
      return String((_exhaustive as Token).kind);
    }
  }
}

export function parseFailure(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): { ok: false; error: CompileError } {
  return { ok: false, error: { code, message, sourceFile, line } };
}
