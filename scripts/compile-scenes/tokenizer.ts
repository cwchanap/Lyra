// =============================================================================
// scripts/compile-scenes/tokenizer.ts
//
// Line-oriented tokenizer. Classifies each source line into one of:
//   - heading        (# / ## / ### / #### / ##### with optional {#anchor})
//   - metadata       (- **Key:** value)
//   - sceneTag       ([場景：...])
//   - action         (any other [bracketed] line)
//   - dialogue       (**Name**：text — full-width colon)
//   - unknown        (any line that didn't match above)
//
// Blank lines are skipped but counted (so line numbers stay accurate).
// The tokenizer does not understand block structure. The parser does that.
// =============================================================================

export type Token =
  | {
      kind: "heading";
      level: 1 | 2 | 3 | 4 | 5;
      text: string;
      anchorId: string | null;
      sourceFile: string;
      line: number;
    }
  | { kind: "metadata"; key: string; value: string; sourceFile: string; line: number }
  | { kind: "sceneTag"; text: string; sourceFile: string; line: number }
  | { kind: "action"; text: string; sourceFile: string; line: number }
  | { kind: "dialogue"; speaker: string; expression: string | null; text: string; sourceFile: string; line: number }
  | { kind: "unknown"; text: string; sourceFile: string; line: number };

const HEADING_RE = /^(#{1,5})\s+(.+?)(?:\s+\{#([a-z0-9_]+)\})?\s*$/;
const METADATA_RE = /^-\s+\*\*([A-Za-z][A-Za-z0-9 ]*):\*\*\s+(.+?)\s*$/;
const BRACKETED_RE = /^\[(.+?)\]\s*$/;
const DIALOGUE_RE = /^\*\*([^*]+)\*\*(?:\[([a-z][a-z0-9_]*)\])?：(.+?)\s*$/;
const SCENE_TAG_PREFIX = "場景：";

export function tokenize(source: string, sourceFile: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const line = i + 1;
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) continue;

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      const hashes = heading[1] ?? "";
      const text = heading[2] ?? "";
      const anchorId = heading[3] ?? null;
      tokens.push({
        kind: "heading",
        level: hashes.length as 1 | 2 | 3 | 4 | 5,
        text,
        anchorId,
        sourceFile,
        line,
      });
      continue;
    }

    const metadata = METADATA_RE.exec(trimmed);
    if (metadata) {
      tokens.push({
        kind: "metadata",
        key: metadata[1] ?? "",
        value: metadata[2] ?? "",
        sourceFile,
        line,
      });
      continue;
    }

    // Check for single-line bracketed blocks first.
    const bracketed = BRACKETED_RE.exec(trimmed);
    if (bracketed) {
      const inner = bracketed[1] ?? "";
      if (inner.startsWith(SCENE_TAG_PREFIX)) {
        tokens.push({
          kind: "sceneTag",
          text: inner.slice(SCENE_TAG_PREFIX.length),
          sourceFile,
          line,
        });
      } else {
        tokens.push({ kind: "action", text: inner, sourceFile, line });
      }
      continue;
    }

    // Multi-line bracketed block: starts with "[" but doesn't end with "]" on
    // the same line. Accumulate subsequent lines until a closing "]" is found.
    if (trimmed.startsWith("[")) {
      let accumulated = trimmed;
      let endLine = line;
      while (i + 1 < lines.length && !accumulated.includes("]")) {
        i++;
        const nextTrimmed = (lines[i] ?? "").trim();
        if (nextTrimmed.length === 0) continue;
        accumulated += "\n" + nextTrimmed;
        endLine = i + 1;
      }
      const multiMatch = /^\[(.+?)\]\s*$/s.exec(accumulated);
      if (multiMatch) {
        // Normalise internal newlines to spaces for downstream consumers.
        const inner = (multiMatch[1] ?? "").replace(/\n/g, " ");
        if (inner.startsWith(SCENE_TAG_PREFIX)) {
          tokens.push({
            kind: "sceneTag",
            text: inner.slice(SCENE_TAG_PREFIX.length),
            sourceFile,
            line,
          });
        } else {
          tokens.push({ kind: "action", text: inner, sourceFile, line });
        }
        continue;
      }
      // If we accumulated lines but still couldn't parse a valid bracket
      // block, emit the original first line as unknown.
      tokens.push({ kind: "unknown", text: trimmed, sourceFile, line });
      continue;
    }

    const dialogue = DIALOGUE_RE.exec(trimmed);
    if (dialogue) {
      tokens.push({
        kind: "dialogue",
        speaker: dialogue[1] ?? "",
        expression: dialogue[2] ?? null,
        text: dialogue[3] ?? "",
        sourceFile,
        line,
      });
      continue;
    }

    tokens.push({ kind: "unknown", text: trimmed, sourceFile, line });
  }

  return tokens;
}
