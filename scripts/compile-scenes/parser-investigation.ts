// =============================================================================
// scripts/compile-scenes/parser-investigation.ts
//
// Parses an investigation scene (chapter_<N>/investigation_scene_<K>.md).
//
// Block hierarchy (see writing-investigation-scene SKILL.md):
//   H1: # Scene N: <title>
//   H2: ## Intro | ## Sub-location: | ## Evidence Manifest | ## Statement Manifest | ## Outro
//   H3: ### Hotspot: | ### Character: | ### evidence:<id> | ### statement:<id>
//   H4: #### Topic: | #### On Collect | #### On Reexamine | #### On Acquire | #### On Reexamine
//   H5: ##### On Reexamine   (under Topic)
//
// Strategy: a Cursor over the token list with per-block functions that consume
// tokens until they see a heading at their own level or shallower.
// =============================================================================

import { tokenize, type Token } from "./tokenizer";
import { parseUnlockExpr } from "./parser-unlock";
import type {
  ASTCharacter,
  ASTEvidence,
  ASTHotspot,
  ASTInvestigationScene,
  ASTOutro,
  ASTStatement,
  ASTSublocation,
  ASTTopic,
  CompileError,
  DialogueItem,
  RevealTarget,
  UnlockExpr,
} from "./types";

export type InvestigationParseResult =
  | { ok: true; value: ASTInvestigationScene }
  | { ok: false; error: CompileError };

class Cursor {
  i = 0;
  constructor(public readonly tokens: Token[], public readonly sourceFile: string) {}
  peek(): Token | undefined {
    return this.tokens[this.i];
  }
  next(): Token | undefined {
    return this.tokens[this.i++];
  }
  done(): boolean {
    return this.i >= this.tokens.length;
  }
}

export function parseInvestigationScene(
  source: string,
  sourceFile: string,
  id: string,
): InvestigationParseResult {
  const tokens = tokenize(source, sourceFile);
  const cur = new Cursor(tokens, sourceFile);

  const first = cur.peek();
  if (!first || first.kind !== "heading" || first.level !== 1) {
    return fail(sourceFile, first?.line ?? 1, "investigationSceneMissingTitle", "Investigation scene must start with `# Scene N: <title>`.");
  }
  cur.next();
  const titleMatch = /^Scene\s+\d+:\s*(.+)$/.exec(first.text);
  const title = titleMatch ? (titleMatch[1] ?? "").trim() : first.text;

  let intro: DialogueItem[] = [];
  const sublocations: ASTSublocation[] = [];
  const evidenceManifest: ASTEvidence[] = [];
  const statementManifest: ASTStatement[] = [];
  let outro: ASTOutro | null = null;

  while (!cur.done()) {
    const tok = cur.peek();
    if (!tok) break;
    if (tok.kind !== "heading" || tok.level !== 2) {
      return fail(sourceFile, tok.line, "investigationSceneUnexpectedToken", `Expected H2 block heading at scene top level; got: ${describe(tok)}.`);
    }

    if (tok.text === "Intro") {
      cur.next();
      const r = consumeDialogueUntilHeading(cur, 2);
      if (!r.ok) return r;
      intro = r.value;
    } else if (tok.text.startsWith("Sub-location:")) {
      const sub = parseSublocation(cur);
      if (!sub.ok) return sub;
      sublocations.push(sub.value);
    } else if (tok.text === "Evidence Manifest") {
      cur.next();
      const entries = parseEvidenceManifest(cur);
      if (!entries.ok) return entries;
      evidenceManifest.push(...entries.value);
    } else if (tok.text === "Statement Manifest") {
      cur.next();
      const entries = parseStatementManifest(cur);
      if (!entries.ok) return entries;
      statementManifest.push(...entries.value);
    } else if (tok.text === "Outro") {
      const o = parseOutro(cur);
      if (!o.ok) return o;
      outro = o.value;
    } else {
      return fail(sourceFile, tok.line, "investigationSceneUnknownH2", `Unknown H2 heading: ${tok.text}.`);
    }
  }

  if (!outro) {
    return fail(sourceFile, first.line, "investigationSceneMissingOutro", "Investigation scene must end with `## Outro`.");
  }
  if (sublocations.length === 0) {
    return fail(sourceFile, first.line, "investigationSceneNoSublocation", "Investigation scene must declare at least one sub-location.");
  }
  if (sublocations[0]?.status !== "unlocked") {
    return fail(sourceFile, sublocations[0]?.line ?? 1, "firstSublocationLocked", "The first sub-location must be Status: unlocked.");
  }

  return {
    ok: true,
    value: {
      kind: "investigationScene",
      id,
      title,
      intro,
      sublocations,
      evidenceManifest,
      statementManifest,
      outro,
      sourceFile,
      line: first.line,
    },
  };
}

function parseSublocation(cur: Cursor): { ok: true; value: ASTSublocation } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 2)
    return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseSublocation called off-position.");
  const id = head.anchorId;
  if (!id) return fail(cur.sourceFile, head.line, "sublocationMissingAnchor", "Sub-location heading must include {#id}.");
  const labelMatch = /^Sub-location:\s*(.+)$/.exec(head.text);
  if (!labelMatch) return fail(cur.sourceFile, head.line, "sublocationMalformedHeading", `Malformed sub-location heading: ${head.text}`);

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const statusCheck = validateStatus(meta.value.Status, "unlocked", cur.sourceFile, head.line);
  if (!statusCheck.ok) return statusCheck;
  const status = statusCheck.value;
  let unlock: UnlockExpr | null = null;
  if (meta.value.Unlock) {
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = meta.value.Reveals ? parseRevealsList(meta.value.Reveals, cur.sourceFile, head.line) : { ok: true as const, value: [] as RevealTarget[] };
  if (!reveals.ok) return reveals;

  let sceneTag: string | null = null;
  const transitionDialogue: DialogueItem[] = [];
  const hotspots: ASTHotspot[] = [];
  const characters: ASTCharacter[] = [];

  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 2) break;
    if (next.kind === "heading" && next.level === 3) {
      if (next.text.startsWith("Hotspot:")) {
        const h = parseHotspot(cur);
        if (!h.ok) return h;
        hotspots.push(h.value);
      } else if (next.text.startsWith("Character:")) {
        const c = parseCharacter(cur);
        if (!c.ok) return c;
        characters.push(c.value);
      } else {
        return fail(cur.sourceFile, next.line, "sublocationUnknownH3", `Unknown H3 inside sub-location: ${next.text}.`);
      }
      continue;
    }
    cur.next();
    if (next.kind === "sceneTag") {
      if (sceneTag !== null) return fail(cur.sourceFile, next.line, "sublocationDuplicateSceneTag", "Sub-location declared multiple [場景：...] tags.");
      sceneTag = next.text;
    } else if (next.kind === "action") {
      transitionDialogue.push({ kind: "action", text: next.text });
    } else if (next.kind === "dialogue") {
      transitionDialogue.push({ kind: "line", speaker: next.speaker, text: next.text });
    } else if (next.kind === "metadata") {
      return fail(cur.sourceFile, next.line, "sublocationStrayMetadata", `Stray metadata inside sub-location body: ${next.key}.`);
    } else if (next.kind === "unknown") {
      return fail(cur.sourceFile, next.line, "sublocationUnknownLine", `Unrecognized line in sub-location: ${next.text}.`);
    } else if (next.kind === "heading") {
      return fail(cur.sourceFile, next.line, "sublocationStrayHeading", `Unexpected H${next.level} "${next.text}" in sub-location body. Only H3 (Hotspot/Character) blocks are allowed here.`);
    }
  }

  if (sceneTag === null) return fail(cur.sourceFile, head.line, "sublocationNoSceneTag", "Sub-location body must include exactly one [場景：...] tag.");

  return {
    ok: true,
    value: {
      id,
      status,
      unlock,
      reveals: reveals.value,
      sceneTag,
      transitionDialogue,
      hotspots,
      characters,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseHotspot(cur: Cursor): { ok: true; value: ASTHotspot } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3) return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseHotspot called off-position.");
  const id = head.anchorId;
  if (!id) return fail(cur.sourceFile, head.line, "hotspotMissingAnchor", "Hotspot heading needs {#id}.");
  const labelMatch = /^Hotspot:\s*(.+)$/.exec(head.text);
  if (!labelMatch) return fail(cur.sourceFile, head.line, "hotspotMalformedHeading", `Malformed hotspot heading: ${head.text}`);
  const label = (labelMatch[1] ?? "").trim();

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const description = meta.value.Description;
  if (!description) return fail(cur.sourceFile, head.line, "hotspotMissingDescription", `Hotspot ${id} missing Description.`);
  const statusCheck = validateStatus(meta.value.Status, "unlocked", cur.sourceFile, head.line);
  if (!statusCheck.ok) return statusCheck;
  const status = statusCheck.value;
  let unlock: UnlockExpr | null = null;
  if (meta.value.Unlock) {
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = meta.value.Reveals ? parseRevealsList(meta.value.Reveals, cur.sourceFile, head.line) : { ok: true as const, value: [] as RevealTarget[] };
  if (!reveals.ok) return reveals;

  const inspectRes = consumeDialogueUntilHeading(cur, 3);
  if (!inspectRes.ok) return inspectRes;
  const inspectDialogue = inspectRes.value;
  const reexamRes = consumeOptionalOnReexamine(cur, 4);
  if (!reexamRes.ok) return reexamRes;
  const onReexamine = reexamRes.value;

  return {
    ok: true,
    value: {
      id,
      label,
      description,
      status,
      unlock,
      reveals: reveals.value,
      inspectDialogue,
      onReexamine,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseCharacter(cur: Cursor): { ok: true; value: ASTCharacter } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3) return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseCharacter called off-position.");
  const id = head.anchorId;
  if (!id) return fail(cur.sourceFile, head.line, "characterMissingAnchor", "Character heading needs {#id}.");
  const nameMatch = /^Character:\s*(.+)$/.exec(head.text);
  if (!nameMatch) return fail(cur.sourceFile, head.line, "characterMalformedHeading", `Malformed character heading: ${head.text}`);
  const name = (nameMatch[1] ?? "").trim();

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const role = meta.value.Role;
  const bio = meta.value.Bio;
  if (!role) return fail(cur.sourceFile, head.line, "characterMissingRole", `Character ${id} missing Role.`);
  if (!bio) return fail(cur.sourceFile, head.line, "characterMissingBio", `Character ${id} missing Bio.`);

  const topics: ASTTopic[] = [];
  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 3) break;
    if (next.kind === "heading" && next.level === 4 && next.text.startsWith("Topic:")) {
      const t = parseTopic(cur, id);
      if (!t.ok) return t;
      topics.push(t.value);
      continue;
    }
    return fail(cur.sourceFile, next.line, "characterBodyUnexpected", `Character body should only contain #### Topic blocks. Got: ${describe(next)}.`);
  }

  return {
    ok: true,
    value: {
      id,
      name,
      role,
      bio,
      topics,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseTopic(cur: Cursor, characterId: string): { ok: true; value: ASTTopic } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 4) return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseTopic called off-position.");
  const id = head.anchorId;
  if (!id) return fail(cur.sourceFile, head.line, "topicMissingAnchor", "Topic heading needs {#id}.");
  const labelMatch = /^Topic:\s*(.+)$/.exec(head.text);
  if (!labelMatch) return fail(cur.sourceFile, head.line, "topicMalformedHeading", `Malformed topic heading: ${head.text}`);
  const label = (labelMatch[1] ?? "").trim();

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const statusCheck = validateStatus(meta.value.Status, "unlocked", cur.sourceFile, head.line);
  if (!statusCheck.ok) return statusCheck;
  const status = statusCheck.value;
  let unlock: UnlockExpr | null = null;
  if (meta.value.Unlock) {
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = meta.value.Reveals ? parseRevealsList(meta.value.Reveals, cur.sourceFile, head.line) : { ok: true as const, value: [] as RevealTarget[] };
  if (!reveals.ok) return reveals;

  const topicRes = consumeDialogueUntilHeading(cur, 4);
  if (!topicRes.ok) return topicRes;
  const topicDialogue = topicRes.value;
  const reexamRes = consumeOptionalOnReexamine(cur, 5);
  if (!reexamRes.ok) return reexamRes;
  const onReexamine = reexamRes.value;

  return {
    ok: true,
    value: {
      id,
      label,
      status,
      unlock,
      reveals: reveals.value,
      topicDialogue,
      onReexamine,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseEvidenceManifest(cur: Cursor): { ok: true; value: ASTEvidence[] } | { ok: false; error: CompileError } {
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

function parseEvidenceEntry(cur: Cursor): { ok: true; value: ASTEvidence } | { ok: false; error: CompileError } {
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

function parseStatementManifest(cur: Cursor): { ok: true; value: ASTStatement[] } | { ok: false; error: CompileError } {
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

function parseStatementEntry(cur: Cursor): { ok: true; value: ASTStatement } | { ok: false; error: CompileError } {
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

function parseOutro(cur: Cursor): { ok: true; value: ASTOutro } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 2 || head.text !== "Outro") {
    return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseOutro called off-position.");
  }
  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  let unlock: UnlockExpr | "auto" = "auto";
  if (meta.value.Unlock) {
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const r = consumeDialogueUntilHeading(cur, 2);
  if (!r.ok) return r;
  const dialogue = r.value;
  return { ok: true, value: { unlock, dialogue } };
}

function consumeMetadata(
  cur: Cursor,
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

function consumeDialogueUntilHeading(cur: Cursor, _atOrAboveLevel: number): DialogueResult {
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
    if (next.kind === "sceneTag") out.push({ kind: "sceneTag", text: next.text });
    else if (next.kind === "action") out.push({ kind: "action", text: next.text });
    else if (next.kind === "dialogue") out.push({ kind: "line", speaker: next.speaker, text: next.text });
    else if (next.kind === "metadata") {
      return {
        ok: false,
        error: {
          code: "strayMetadataInDialogueBody",
          message: `Stray metadata in dialogue body: ${next.key}.`,
          sourceFile: cur.sourceFile,
          line: next.line,
        },
      };
    } else if (next.kind === "unknown") {
      return {
        ok: false,
        error: {
          code: "unrecognizedDialogueLine",
          message: `Unrecognized line in dialogue body: ${next.text}.`,
          sourceFile: cur.sourceFile,
          line: next.line,
        },
      };
    }
  }
  return { ok: true, value: out };
}

function consumeOptionalOnReexamine(
  cur: Cursor,
  expectedLevel: number,
): { ok: true; value: DialogueItem[] | null } | { ok: false; error: CompileError } {
  const next = cur.peek();
  if (!next || next.kind !== "heading") return { ok: true, value: null };
  if (next.level !== expectedLevel) return { ok: true, value: null };
  if (next.text !== "On Reexamine") return { ok: true, value: null };
  cur.next();
  const r = consumeDialogueUntilHeading(cur, expectedLevel);
  if (!r.ok) return r;
  return { ok: true, value: r.value };
}

function parseRevealsList(
  raw: string,
  sourceFile: string,
  line: number,
): { ok: true; value: RevealTarget[] } | { ok: false; error: CompileError } {
  const m = /^\[(.*)\]\s*$/.exec(raw.trim());
  if (!m) return fail(sourceFile, line, "revealsMalformed", `Reveals value must be a [list]. Got: ${raw}`);
  const items = (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const out: RevealTarget[] = [];
  for (const item of items) {
    const target = parseRevealTarget(item, sourceFile, line);
    if (!target.ok) return target;
    out.push(target.value);
  }
  return { ok: true, value: out };
}

function parseRevealTarget(
  raw: string,
  sourceFile: string,
  line: number,
): { ok: true; value: RevealTarget } | { ok: false; error: CompileError } {
  const m = /^(evidence|statement|hotspot|sublocation|topic):(.+)$/.exec(raw);
  if (!m) return fail(sourceFile, line, "revealUnknownPrefix", `Unknown reveal target prefix: ${raw}`);
  const kind = m[1] as RevealTarget["kind"];
  const tail = m[2] ?? "";
  if (kind === "topic") {
    const mt = /^([a-z0-9_]+)@([a-z0-9_]+)$/.exec(tail);
    if (!mt) return fail(sourceFile, line, "revealTopicMalformed", `Topic reveal must be topic:<char>@<topic>. Got: ${raw}`);
    return { ok: true, value: { kind: "topic", characterId: mt[1] ?? "", topicId: mt[2] ?? "" } };
  }
  if (!/^[a-z0-9_]+$/.test(tail)) return fail(sourceFile, line, "revealIdMalformed", `Reveal id must be snake_case slug: ${raw}`);
  return { ok: true, value: { kind, id: tail } };
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

function validateStatus(
  raw: string | undefined,
  fallback: "locked" | "unlocked",
  sourceFile: string,
  line: number,
): { ok: true; value: "locked" | "unlocked" } | { ok: false; error: CompileError } {
  if (raw === undefined) return { ok: true, value: fallback };
  if (raw === "locked" || raw === "unlocked") return { ok: true, value: raw };
  return {
    ok: false,
    error: {
      code: "invalidStatusValue",
      message: `Status must be "locked" or "unlocked"; got "${raw}".`,
      sourceFile,
      line,
    },
  };
}
