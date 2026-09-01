// =============================================================================
// packages/scripts/compile-scenes/parser-investigation.ts
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
import { parseSceneHeader } from "./parser-scene-header";
import {
  isEmptyVisualAssetCue,
  parseVisualAssetCue,
  rejectReservedAssetMetadata,
  VISUAL_ASSET_METADATA_KEYS,
} from "./parser-assets";
import {
  consumeDialogueUntilHeading,
  consumeMetadata,
  describeToken as describe,
  parseFailure as fail,
} from "./parser-common";
import { parseUnlockExpr } from "./parser-unlock";
import { parseRevealsList } from "./parser-reveals";
import {
  parseEvidenceManifest,
  parseStatementManifest,
} from "./parser-manifest";
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
  EvidenceSource,
  InvestigationRevealTarget,
  UnlockExpr,
} from "./types";

export type InvestigationParseResult =
  | { ok: true; value: ASTInvestigationScene }
  | { ok: false; error: CompileError };

class Cursor {
  i = 0;
  constructor(
    public readonly tokens: Token[],
    public readonly sourceFile: string,
  ) {}
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
  const header = parseSceneHeader(tokens, sourceFile, {
    code: "investigationSceneMissingTitle",
    message: "Investigation scene must start with `# Scene N: <title>`.",
  });
  if (!header.ok) return header;
  cur.i = header.value.nextTokenIndex;

  const mapField = parseMapField(cur, tokens);
  if (!mapField.ok) return mapField;

  let intro: DialogueItem[] = [];
  const sublocations: ASTSublocation[] = [];
  const evidenceManifest: ASTEvidence[] = [];
  const statementManifest: ASTStatement[] = [];
  let outro: ASTOutro | null = null;

  while (!cur.done()) {
    const tok = cur.peek();
    if (!tok) break;
    if (tok.kind !== "heading" || tok.level !== 2) {
      return fail(
        sourceFile,
        tok.line,
        "investigationSceneUnexpectedToken",
        `Expected H2 block heading at scene top level; got: ${describe(tok)}.`,
      );
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
      return fail(
        sourceFile,
        tok.line,
        "investigationSceneUnknownH2",
        `Unknown H2 heading: ${tok.text}.`,
      );
    }
  }

  if (!outro) {
    return fail(
      sourceFile,
      header.value.line,
      "investigationSceneMissingOutro",
      "Investigation scene must end with `## Outro`.",
    );
  }
  if (sublocations.length === 0) {
    return fail(
      sourceFile,
      header.value.line,
      "investigationSceneNoSublocation",
      "Investigation scene must declare at least one sub-location.",
    );
  }
  if (sublocations[0]?.status !== "unlocked") {
    return fail(
      sourceFile,
      sublocations[0]?.line ?? 1,
      "firstSublocationLocked",
      "The first sub-location must be Status: unlocked.",
    );
  }

  normalizeTravelOnlyCues(mapField.mapId, sublocations);

  return {
    ok: true,
    value: {
      kind: "investigationScene",
      id,
      title: header.value.title,
      summary: header.value.summary,
      summaryAuthored: header.value.summaryAuthored,
      mapId: mapField.mapId,
      intro,
      sublocations,
      evidenceManifest,
      statementManifest,
      outro,
      assetRefs: [],
      sourceFile,
      line: header.value.line,
    },
  };
}

/**
 * HPA-601 §3: in a mapped scene, a travel-only sublocation — no hotspots,
 * characters, entry reveals, or transition dialogue — with an all-empty
 * visual cue is normalized to `null` after parsing. This keeps the wrapper
 * from becoming the corpus's first visual unit (no assetFirstCueMissingBgm/
 * Bgs errors) and from requesting a scene-local background. Ordinary
 * (map-less) investigations keep their normal authored visual-cue
 * requirements, and mapped sublocations with real content are untouched.
 */
function normalizeTravelOnlyCues(
  mapId: string | null,
  sublocations: ASTSublocation[],
): void {
  if (mapId === null) return;
  for (let i = 0; i < sublocations.length; i++) {
    const sub = sublocations[i];
    if (!sub) continue;
    // Transition dialogue never holds sceneTag items (the tag is captured
    // separately), so an empty list means no non-scene-tag dialogue.
    const travelOnly =
      sub.hotspots.length === 0 &&
      sub.characters.length === 0 &&
      sub.reveals.length === 0 &&
      sub.transitionDialogue.length === 0;
    if (travelOnly && isEmptyVisualAssetCue(sub.assetCue)) {
      sublocations[i] = { ...sub, assetCue: null };
    }
  }
}

function parseMapField(
  cur: Cursor,
  tokens: Token[],
): { ok: true; mapId: string | null } | { ok: false; error: CompileError } {
  // Optional scene-level field: exactly `- **Map:** <id>` directly after the
  // Summary (or H1 when no Summary is authored). No `Map Location` field
  // exists.
  let mapId: string | null = null;
  const first = cur.peek();
  if (first?.kind === "metadata" && first.key === "Map") {
    cur.next();
    const value = first.value.trim();
    if (!value) {
      return fail(
        cur.sourceFile,
        first.line,
        "sceneMapBlank",
        "Scene Map must name a map ID (e.g. tokyo).",
      );
    }
    mapId = value;
  } else if (
    first?.kind === "unknown" &&
    /^-\s+\*\*Map:\*\*\s*$/.test(first.text)
  ) {
    // The tokenizer cannot produce an empty metadata value, so a blank
    // `- **Map:**` arrives as an unknown token (same as blank Summary).
    return fail(
      cur.sourceFile,
      first.line,
      "sceneMapBlank",
      "Scene Map must name a map ID (e.g. tokyo).",
    );
  }
  // Any other Map/Map Location metadata anywhere else in the file is a
  // duplicate (just consumed above) or misplaced — reject it before block
  // parsing turns it into a generic stray-metadata error.
  for (let i = cur.i; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok || tok.kind !== "metadata") continue;
    if (tok.key === "Map") {
      return fail(
        cur.sourceFile,
        tok.line,
        "sceneMapMisplaced",
        "Scene Map may be declared only once, directly after the Summary.",
      );
    }
    if (tok.key === "Map Location") {
      return fail(
        cur.sourceFile,
        tok.line,
        "sceneMapLocationRejected",
        'Unknown scene field "Map Location"; use `- **Map:** <mapId>` directly after the Summary.',
      );
    }
  }
  return { ok: true, mapId };
}

function parseSublocation(
  cur: Cursor,
): { ok: true; value: ASTSublocation } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 2)
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseSublocation called off-position.",
    );
  const id = head.anchorId;
  if (!id)
    return fail(
      cur.sourceFile,
      head.line,
      "sublocationMissingAnchor",
      "Sub-location heading must include {#id}.",
    );
  const labelMatch = /^Sub-location:\s*(.+)$/.exec(head.text);
  if (!labelMatch)
    return fail(
      cur.sourceFile,
      head.line,
      "sublocationMalformedHeading",
      `Malformed sub-location heading: ${head.text}`,
    );
  const label = (labelMatch[1] ?? "").trim();

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const badAssetMeta = rejectReservedAssetMetadata(
    meta.value,
    VISUAL_ASSET_METADATA_KEYS,
    cur.sourceFile,
    head.line,
  );
  if (badAssetMeta) return { ok: false, error: badAssetMeta };
  const assetCue = parseVisualAssetCue(meta.value);
  if (meta.value.Status === undefined) {
    return fail(
      cur.sourceFile,
      head.line,
      "sublocationMissingStatus",
      "Sub-location requires an explicit Status (locked or unlocked).",
    );
  }
  const statusCheck = validateStatus(
    meta.value.Status,
    "unlocked",
    cur.sourceFile,
    head.line,
  );
  if (!statusCheck.ok) return statusCheck;
  const status = statusCheck.value;
  let unlock: UnlockExpr | null = null;
  if (meta.value.Unlock) {
    if (status !== "locked") {
      return fail(
        cur.sourceFile,
        head.line,
        "unlockOnNonLockedBlock",
        `Block has an Unlock condition but Status is "${status}". Set Status to "locked" or remove the Unlock.`,
      );
    }
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = meta.value.Reveals
    ? parseRevealsList({
        family: "investigation",
        raw: meta.value.Reveals,
        sourceFile: cur.sourceFile,
        line: head.line,
      })
    : { ok: true as const, value: [] as InvestigationRevealTarget[] };
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
        return fail(
          cur.sourceFile,
          next.line,
          "sublocationUnknownH3",
          `Unknown H3 inside sub-location: ${next.text}.`,
        );
      }
      continue;
    }
    cur.next();
    if (next.kind === "sceneTag") {
      if (sceneTag !== null)
        return fail(
          cur.sourceFile,
          next.line,
          "sublocationDuplicateSceneTag",
          "Sub-location declared multiple [場景：...] tags.",
        );
      sceneTag = next.text;
    } else if (next.kind === "action") {
      transitionDialogue.push({ kind: "action", text: next.text });
    } else if (next.kind === "dialogue") {
      transitionDialogue.push({
        kind: "line",
        speaker: next.speaker,
        text: next.text,
        expression: next.expression,
        portrait: null,
      });
    } else if (next.kind === "metadata") {
      return fail(
        cur.sourceFile,
        next.line,
        "sublocationStrayMetadata",
        `Stray metadata inside sub-location body: ${next.key}.`,
      );
    } else if (next.kind === "unknown") {
      return fail(
        cur.sourceFile,
        next.line,
        "sublocationUnknownLine",
        `Unrecognized line in sub-location: ${next.text}.`,
      );
    } else if (next.kind === "heading") {
      return fail(
        cur.sourceFile,
        next.line,
        "sublocationStrayHeading",
        `Unexpected H${next.level} "${next.text}" in sub-location body. Only H3 (Hotspot/Character) blocks are allowed here.`,
      );
    }
  }

  if (sceneTag === null)
    return fail(
      cur.sourceFile,
      head.line,
      "sublocationNoSceneTag",
      "Sub-location body must include exactly one [場景：...] tag.",
    );

  return {
    ok: true,
    value: {
      id,
      label,
      status,
      unlock,
      reveals: reveals.value,
      sceneTag,
      assetCue,
      transitionDialogue,
      hotspots,
      characters,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseHotspot(
  cur: Cursor,
): { ok: true; value: ASTHotspot } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3)
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseHotspot called off-position.",
    );
  const id = head.anchorId;
  if (!id)
    return fail(
      cur.sourceFile,
      head.line,
      "hotspotMissingAnchor",
      "Hotspot heading needs {#id}.",
    );
  const labelMatch = /^Hotspot:\s*(.+)$/.exec(head.text);
  if (!labelMatch)
    return fail(
      cur.sourceFile,
      head.line,
      "hotspotMalformedHeading",
      `Malformed hotspot heading: ${head.text}`,
    );
  const label = (labelMatch[1] ?? "").trim();

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const badAssetMeta = rejectReservedAssetMetadata(
    meta.value,
    [],
    cur.sourceFile,
    head.line,
  );
  if (badAssetMeta) return { ok: false, error: badAssetMeta };
  const description = meta.value.Description;
  if (!description)
    return fail(
      cur.sourceFile,
      head.line,
      "hotspotMissingDescription",
      `Hotspot ${id} missing Description.`,
    );
  const statusCheck = validateStatus(
    meta.value.Status,
    "unlocked",
    cur.sourceFile,
    head.line,
  );
  if (!statusCheck.ok) return statusCheck;
  const status = statusCheck.value;
  let unlock: UnlockExpr | null = null;
  if (meta.value.Unlock) {
    if (status !== "locked") {
      return fail(
        cur.sourceFile,
        head.line,
        "unlockOnNonLockedBlock",
        `Block has an Unlock condition but Status is "${status}". Set Status to "locked" or remove the Unlock.`,
      );
    }
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = meta.value.Reveals
    ? parseRevealsList({
        family: "investigation",
        raw: meta.value.Reveals,
        sourceFile: cur.sourceFile,
        line: head.line,
      })
    : { ok: true as const, value: [] as InvestigationRevealTarget[] };
  if (!reveals.ok) return reveals;
  const evidenceSource = parseEvidenceSource(
    meta.value["Evidence Source"],
    cur.sourceFile,
    head.line,
  );
  if (!evidenceSource.ok) return evidenceSource;
  const sceneSourcePrompt = meta.value["Scene Source Prompt"] ?? null;
  if (sceneSourcePrompt && !evidenceSource.value) {
    return fail(
      cur.sourceFile,
      head.line,
      "hotspotSceneSourcePromptWithoutSource",
      `Hotspot ${id} declares Scene Source Prompt but does not declare Evidence Source.`,
    );
  }
  const revealsEvidence = reveals.value.some(
    (reveal) => reveal.kind === "evidence",
  );
  if (evidenceSource.value && !revealsEvidence) {
    return fail(
      cur.sourceFile,
      head.line,
      "hotspotEvidenceSourceWithoutEvidenceReveal",
      `Hotspot ${id} declares Evidence Source but does not reveal evidence.`,
    );
  }

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
      evidenceSource: evidenceSource.value,
      sceneSourcePrompt,
      inspectDialogue,
      onReexamine,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseCharacter(
  cur: Cursor,
): { ok: true; value: ASTCharacter } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3)
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseCharacter called off-position.",
    );
  const id = head.anchorId;
  if (!id)
    return fail(
      cur.sourceFile,
      head.line,
      "characterMissingAnchor",
      "Character heading needs {#id}.",
    );
  const nameMatch = /^Character:\s*(.+)$/.exec(head.text);
  if (!nameMatch)
    return fail(
      cur.sourceFile,
      head.line,
      "characterMalformedHeading",
      `Malformed character heading: ${head.text}`,
    );
  const name = (nameMatch[1] ?? "").trim();

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const badAssetMeta = rejectReservedAssetMetadata(
    meta.value,
    [],
    cur.sourceFile,
    head.line,
  );
  if (badAssetMeta) return { ok: false, error: badAssetMeta };
  const role = meta.value.Role;
  const bio = meta.value.Bio;
  if (!role)
    return fail(
      cur.sourceFile,
      head.line,
      "characterMissingRole",
      `Character ${id} missing Role.`,
    );
  if (!bio)
    return fail(
      cur.sourceFile,
      head.line,
      "characterMissingBio",
      `Character ${id} missing Bio.`,
    );

  const topics: ASTTopic[] = [];
  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 3) break;
    if (
      next.kind === "heading" &&
      next.level === 4 &&
      next.text.startsWith("Topic:")
    ) {
      const t = parseTopic(cur);
      if (!t.ok) return t;
      topics.push(t.value);
      continue;
    }
    return fail(
      cur.sourceFile,
      next.line,
      "characterBodyUnexpected",
      `Character body should only contain #### Topic blocks. Got: ${describe(next)}.`,
    );
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

function parseTopic(
  cur: Cursor,
): { ok: true; value: ASTTopic } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 4)
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseTopic called off-position.",
    );
  const id = head.anchorId;
  if (!id)
    return fail(
      cur.sourceFile,
      head.line,
      "topicMissingAnchor",
      "Topic heading needs {#id}.",
    );
  const labelMatch = /^Topic:\s*(.+)$/.exec(head.text);
  if (!labelMatch)
    return fail(
      cur.sourceFile,
      head.line,
      "topicMalformedHeading",
      `Malformed topic heading: ${head.text}`,
    );
  const label = (labelMatch[1] ?? "").trim();

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const badAssetMeta = rejectReservedAssetMetadata(
    meta.value,
    [],
    cur.sourceFile,
    head.line,
  );
  if (badAssetMeta) return { ok: false, error: badAssetMeta };
  const statusCheck = validateStatus(
    meta.value.Status,
    "unlocked",
    cur.sourceFile,
    head.line,
  );
  if (!statusCheck.ok) return statusCheck;
  const status = statusCheck.value;
  let unlock: UnlockExpr | null = null;
  if (meta.value.Unlock) {
    if (status !== "locked") {
      return fail(
        cur.sourceFile,
        head.line,
        "unlockOnNonLockedBlock",
        `Block has an Unlock condition but Status is "${status}". Set Status to "locked" or remove the Unlock.`,
      );
    }
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = meta.value.Reveals
    ? parseRevealsList({
        family: "investigation",
        raw: meta.value.Reveals,
        sourceFile: cur.sourceFile,
        line: head.line,
      })
    : { ok: true as const, value: [] as InvestigationRevealTarget[] };
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

function parseOutro(
  cur: Cursor,
): { ok: true; value: ASTOutro } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (
    !head ||
    head.kind !== "heading" ||
    head.level !== 2 ||
    head.text !== "Outro"
  ) {
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseOutro called off-position.",
    );
  }
  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const badAssetMeta = rejectReservedAssetMetadata(
    meta.value,
    [],
    cur.sourceFile,
    head.line,
  );
  if (badAssetMeta) return { ok: false, error: badAssetMeta };
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

function parseEvidenceSource(
  raw: string | undefined,
  sourceFile: string,
  line: number,
):
  | { ok: true; value: EvidenceSource | null }
  | { ok: false; error: CompileError } {
  if (raw === undefined) return { ok: true, value: null };
  if (raw === "visible" || raw === "implied" || raw === "hidden") {
    return { ok: true, value: raw };
  }
  return fail(
    sourceFile,
    line,
    "hotspotEvidenceSourceInvalid",
    `Evidence Source must be visible, implied, or hidden; got "${raw}".`,
  );
}

function consumeOptionalOnReexamine(
  cur: Cursor,
  expectedLevel: number,
):
  | { ok: true; value: DialogueItem[] | null }
  | { ok: false; error: CompileError } {
  const next = cur.peek();
  if (!next || next.kind !== "heading") return { ok: true, value: null };
  if (next.level !== expectedLevel) return { ok: true, value: null };
  if (next.text !== "On Reexamine") return { ok: true, value: null };
  cur.next();
  const r = consumeDialogueUntilHeading(cur, expectedLevel);
  if (!r.ok) return r;
  return { ok: true, value: r.value };
}

function validateStatus(
  raw: string | undefined,
  fallback: "locked" | "unlocked",
  sourceFile: string,
  line: number,
):
  | { ok: true; value: "locked" | "unlocked" }
  | { ok: false; error: CompileError } {
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
