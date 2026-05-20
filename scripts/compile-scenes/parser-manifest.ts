// =============================================================================
// scripts/compile-scenes/parser-manifest.ts
//
// Shared Evidence Manifest and Statement Manifest parsing for scene markdown
// parsers.
// =============================================================================

import type { Token } from "./tokenizer";
import type {
  ASTEvidence,
  ASTStatement,
  CompileError,
  DialogueItem,
} from "./types";

type CursorLike = {
  readonly sourceFile: string;
  peek(): Token | undefined;
  next(): Token | undefined;
};

export function parseEvidenceManifest(
  cur: CursorLike,
): { ok: true; value: ASTEvidence[] } | { ok: false; error: CompileError } {
  const entries: ASTEvidence[] = [];
  while (true) {
    const tok = cur.peek();
    if (!tok) break;
    if (tok.kind === "heading" && tok.level <= 2) break;
    if (tok.kind === "heading" && tok.level === 3) {
      const e = parseEvidenceEntry(cur);
      if (!e.ok) return e;
      entries.push(e.value);
      continue;
    }
    return fail(cur.sourceFile, tok.line, "evidenceManifestUnexpected", `Unexpected content in Evidence Manifest: ${describe(tok)}.`);
  }
  return { ok: true, value: entries };
}

function parseEvidenceEntry(cur: CursorLike): { ok: true; value: ASTEvidence } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3) return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseEvidenceEntry called off-position.");
  const m = /^evidence:([a-z0-9_]+)$/.exec(head.text);
  if (!m) return fail(cur.sourceFile, head.line, "evidenceMalformedHeading", `Evidence heading must be "### evidence:<id> {#<id>}". Got: ${head.text}`);
  const id = m[1] ?? "";
  if (head.anchorId !== id) return fail(cur.sourceFile, head.line, "evidenceAnchorMismatch", `Evidence anchor #${head.anchorId} does not match id ${id}.`);

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const name = meta.value.Name;
  const description = meta.value.Description;
  const details = meta.value.Details;
  if (!name || !description || !details) return fail(cur.sourceFile, head.line, "evidenceMissingMetadata", `Evidence ${id} requires Name, Description, Details.`);

  let onCollect: DialogueItem[] | null = null;
  let onReexamine: DialogueItem[] | null = null;

  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 3) break;
    if (next.kind === "heading" && next.level === 4) {
      if (next.text === "On Collect") {
        cur.next();
        const r = consumeDialogueUntilHeading(cur, 4);
        if (!r.ok) return r;
        onCollect = r.value;
        continue;
      }
      if (next.text === "On Reexamine") {
        cur.next();
        const r = consumeDialogueUntilHeading(cur, 4);
        if (!r.ok) return r;
        onReexamine = r.value;
        continue;
      }
      return fail(cur.sourceFile, next.line, "evidenceUnknownH4", `Unknown H4 under evidence ${id}: ${next.text}.`);
    }
    return fail(cur.sourceFile, next.line, "evidenceUnexpectedToken", `Unexpected token in evidence ${id}: ${describe(next)}.`);
  }

  if (!onCollect) return fail(cur.sourceFile, head.line, "evidenceMissingOnCollect", `Evidence ${id} must define #### On Collect.`);

  return {
    ok: true,
    value: {
      id,
      name,
      description,
      details,
      onCollect,
      onReexamine,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

export function parseStatementManifest(
  cur: CursorLike,
): { ok: true; value: ASTStatement[] } | { ok: false; error: CompileError } {
  const entries: ASTStatement[] = [];
  while (true) {
    const tok = cur.peek();
    if (!tok) break;
    if (tok.kind === "heading" && tok.level <= 2) break;
    if (tok.kind === "heading" && tok.level === 3) {
      const e = parseStatementEntry(cur);
      if (!e.ok) return e;
      entries.push(e.value);
      continue;
    }
    return fail(cur.sourceFile, tok.line, "statementManifestUnexpected", `Unexpected content in Statement Manifest: ${describe(tok)}.`);
  }
  return { ok: true, value: entries };
}

function parseStatementEntry(cur: CursorLike): { ok: true; value: ASTStatement } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3) return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseStatementEntry called off-position.");
  const m = /^statement:([a-z0-9_]+)$/.exec(head.text);
  if (!m) return fail(cur.sourceFile, head.line, "statementMalformedHeading", `Statement heading must be "### statement:<id> {#<id>}". Got: ${head.text}`);
  const id = m[1] ?? "";
  if (head.anchorId !== id) return fail(cur.sourceFile, head.line, "statementAnchorMismatch", `Statement anchor #${head.anchorId} does not match id ${id}.`);

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const speaker = meta.value.Speaker;
  const content = meta.value.Content;
  if (!speaker || !content) return fail(cur.sourceFile, head.line, "statementMissingMetadata", `Statement ${id} requires Speaker and Content.`);

  let onAcquire: DialogueItem[] | null = null;
  let onReexamine: DialogueItem[] | null = null;

  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 3) break;
    if (next.kind === "heading" && next.level === 4) {
      if (next.text === "On Acquire") {
        cur.next();
        const r = consumeDialogueUntilHeading(cur, 4);
        if (!r.ok) return r;
        onAcquire = r.value;
        continue;
      }
      if (next.text === "On Reexamine") {
        cur.next();
        const r = consumeDialogueUntilHeading(cur, 4);
        if (!r.ok) return r;
        onReexamine = r.value;
        continue;
      }
      return fail(cur.sourceFile, next.line, "statementUnknownH4", `Unknown H4 under statement ${id}: ${next.text}.`);
    }
    return fail(cur.sourceFile, next.line, "statementUnexpectedToken", `Unexpected token in statement ${id}: ${describe(next)}.`);
  }

  if (!onAcquire) return fail(cur.sourceFile, head.line, "statementMissingOnAcquire", `Statement ${id} must define #### On Acquire.`);

  return {
    ok: true,
    value: {
      id,
      speaker,
      content,
      onAcquire,
      onReexamine,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function consumeMetadata(
  cur: CursorLike,
): { ok: true; value: Record<string, string> } | { ok: false; error: CompileError } {
  const out: Record<string, string> = {};
  while (true) {
    const next = cur.peek();
    if (!next || next.kind !== "metadata") return { ok: true, value: out };
    cur.next();
    out[next.key] = next.value;
  }
}

type DialogueResult =
  | { ok: true; value: DialogueItem[] }
  | { ok: false; error: CompileError };

function consumeDialogueUntilHeading(cur: CursorLike, _atOrAboveLevel: number): DialogueResult {
  const out: DialogueItem[] = [];
  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading") break;
    cur.next();
    if (next.kind === "sceneTag") out.push({ kind: "sceneTag", text: next.text });
    else if (next.kind === "action") out.push({ kind: "action", text: next.text });
    else if (next.kind === "dialogue") out.push({ kind: "line", speaker: next.speaker, text: next.text });
    else if (next.kind === "metadata") {
      return fail(cur.sourceFile, next.line, "strayMetadataInDialogueBody", `Stray metadata in dialogue body: ${next.key}.`);
    } else if (next.kind === "unknown") {
      return fail(cur.sourceFile, next.line, "unrecognizedDialogueLine", `Unrecognized line in dialogue body: ${next.text}.`);
    }
  }
  return { ok: true, value: out };
}

function describe(tok: Token): string {
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
  }
}

function fail(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): { ok: false; error: CompileError } {
  return { ok: false, error: { code, message, sourceFile, line } };
}
