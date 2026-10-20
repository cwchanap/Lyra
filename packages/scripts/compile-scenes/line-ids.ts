// =============================================================================
// packages/scripts/compile-scenes/line-ids.ts
//
// Stable IDs for spoken dialogue lines. A line may end in ` {#L012}`; the ID
// is unique within its scene file and never part of the spoken text.
// Translations (`<chapter>/<locale>/<scene>.<locale>.yaml`) and voice clips
// link to a line through it, so a line keeps its translation when its text
// is edited or the scene is reordered. Writers never type IDs:
// `bun run voice:sync` appends them to lines that have none.
// =============================================================================

import { tokenize, type Token } from "./tokenizer";
import type { CompileError } from "./types";

export const LINE_ID_PATTERN = /^L\d{3,}$/;

type DialogueToken = Extract<Token, { kind: "dialogue" }>;

/**
 * The spoken line on one token's physical line: a dialogue token itself, or
 * the dialogue inside a metadata value such as `- **On Loop:** **澪**：…`.
 */
function dialogueOf(token: Token): DialogueToken | null {
  if (token.kind === "dialogue") return token;
  if (token.kind === "metadata") {
    const inner = tokenize(token.value, token.sourceFile)[0];
    if (inner?.kind === "dialogue") return inner;
  }
  return null;
}

function lineIdNumber(id: string): number {
  return Number(id.slice(1));
}

export function formatLineId(n: number): string {
  return `L${String(n).padStart(3, "0")}`;
}

export type SourceLineIds = {
  /** 1-based physical line -> line ID, for lines that carry one. */
  byLine: Map<number, string>;
  /** Physical lines of spoken dialogue without an ID. */
  missing: number[];
  errors: CompileError[];
};

/**
 * Reads the line IDs of one scene file. Errors on an ID used twice in the
 * file and on a trailing `{#…}` that is not a valid line ID (it would
 * otherwise be spoken as part of the text).
 */
export function scanSourceLineIds(
  source: string,
  sourceFile: string,
): SourceLineIds {
  const byLine = new Map<number, string>();
  const firstLine = new Map<string, number>();
  const missing: number[] = [];
  const errors: CompileError[] = [];
  for (const token of tokenize(source, sourceFile)) {
    const dialogue = dialogueOf(token);
    if (!dialogue) continue;
    if (dialogue.lineId === null) {
      if (/\{#[^}]*\}\s*$/.test(dialogue.text)) {
        errors.push({
          code: "dialogueLineIdMalformed",
          message: `${sourceFile}:${token.line}: a line ID is \` {#L}\` plus at least three digits, such as {#L012}; run \`bun run voice:sync\` to assign one.`,
          sourceFile,
          line: token.line,
        });
      } else {
        missing.push(token.line);
      }
      continue;
    }
    const prior = firstLine.get(dialogue.lineId);
    if (prior !== undefined) {
      errors.push({
        code: "dialogueLineIdDuplicate",
        message: `${sourceFile}:${token.line}: line ID {#${dialogue.lineId}} is already used on line ${prior}; each spoken line needs its own ID. Delete the copied ID and run \`bun run voice:sync\`.`,
        sourceFile,
        line: token.line,
      });
      continue;
    }
    firstLine.set(dialogue.lineId, token.line);
    byLine.set(token.line, dialogue.lineId);
  }
  return { byLine, missing, errors };
}

/**
 * Appends ` {#Lnnn}` to every spoken line that has no ID, numbering after the
 * highest ID already in the file or in `reserved` (IDs a translation still
 * refers to), so an ID is never reused. Keeps every other byte, including
 * line endings and trailing whitespace.
 */
export function addMissingLineIds(
  source: string,
  reserved: Iterable<string> = [],
): { text: string; added: number } {
  const scan = scanSourceLineIds(source, "");
  if (scan.missing.length === 0) return { text: source, added: 0 };
  let next = 1;
  for (const id of [...scan.byLine.values(), ...reserved]) {
    if (LINE_ID_PATTERN.test(id)) next = Math.max(next, lineIdNumber(id) + 1);
  }
  const lines = source.split("\n");
  for (const lineNumber of scan.missing) {
    const raw = lines[lineNumber - 1] ?? "";
    const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const content = body.trimEnd();
    lines[lineNumber - 1] =
      `${content} {#${formatLineId(next)}}${body.slice(content.length)}${raw.endsWith("\r") ? "\r" : ""}`;
    next += 1;
  }
  return { text: lines.join("\n"), added: scan.missing.length };
}
