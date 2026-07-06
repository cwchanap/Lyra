// =============================================================================
// packages/scripts/compile-scenes/parser-interrogation.ts
//
// Parses an interrogation scene (chapter_<N>/interrogation_scene_<K>.md).
//
// Block hierarchy:
//   H1: # Scene N: <title>
//   H2: ## Intro | ## Phase: | ## Evidence Manifest | ## Statement Manifest | ## Outro
//   H3: ### Subject: | ### Question:
//   H4: #### Testimony
//   H5: ##### Line:
//
// Every phase is `Kind: inquiry`. Each `### Question:` owns exactly one
// `#### Testimony` block, which carries a required `On Loop` line plus one or
// more `##### Line:` entries -- the suspect's cross-examinable testimony. A
// Line with a `Contradiction` target must also declare `Challenge`,
// `On Correct`, and `On Wrong Evidence`; `On Correct` may itself carry a
// nested `- **Reveals:** [...]` bullet (functionally just another metadata
// key on the same Line block -- the tokenizer does not track indentation).
// =============================================================================

import { tokenize, type Token } from "./tokenizer";
import {
  parseVisualAssetCue,
  rejectReservedAssetMetadata,
  rejectUnknownAssetMetadata,
  VISUAL_ASSET_METADATA_KEYS,
} from "./parser-assets";
import {
  parseEvidenceManifest,
  parseStatementManifest,
} from "./parser-manifest";
import { parseInterrogationUnlockExpr } from "./parser-unlock";
import type {
  ASTEvidence,
  ASTInquiryPhase,
  ASTInquiryQuestion,
  ASTInterrogationOutro,
  ASTInterrogationPhase,
  ASTInterrogationScene,
  ASTStatement,
  ASTSubject,
  ASTTestimony,
  ASTTestimonyLine,
  CompileError,
  DialogueItem,
  InterrogationRevealTarget,
  InterrogationUnlockExpr,
  InventoryTarget,
  VisualAssetCue,
} from "./types";

export type InterrogationParseResult =
  | { ok: true; value: ASTInterrogationScene }
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

type Meta = Record<string, string>;

export function parseInterrogationScene(
  source: string,
  sourceFile: string,
  id: string,
): InterrogationParseResult {
  const tokens = tokenize(source, sourceFile);
  const cur = new Cursor(tokens, sourceFile);

  const first = cur.peek();
  if (!first || first.kind !== "heading" || first.level !== 1) {
    return fail(
      sourceFile,
      first?.line ?? 1,
      "interrogationSceneMissingTitle",
      "Interrogation scene must start with `# Scene N: <title>`.",
    );
  }
  cur.next();
  const titleMatch = /^Scene\s+\d+:\s*(.+)$/.exec(first.text);
  if (!titleMatch) {
    return fail(
      sourceFile,
      first.line,
      "interrogationSceneMissingTitle",
      "Interrogation scene must start with `# Scene N: <title>`.",
    );
  }
  const title = (titleMatch[1] ?? "").trim();

  let intro: DialogueItem[] = [];
  const phases: ASTInterrogationPhase[] = [];
  const evidenceManifest: ASTEvidence[] = [];
  const statementManifest: ASTStatement[] = [];
  let outro: ASTInterrogationOutro | null = null;

  while (!cur.done()) {
    const tok = cur.peek();
    if (!tok) break;
    if (tok.kind !== "heading" || tok.level !== 2) {
      return fail(
        sourceFile,
        tok.line,
        "interrogationSceneUnknownH2",
        `Expected H2 block heading at scene top level; got: ${describe(tok)}.`,
      );
    }

    if (tok.text === "Intro") {
      cur.next();
      const r = consumeDialogueUntilHeading(cur, 2);
      if (!r.ok) return r;
      intro = r.value;
    } else if (tok.text.startsWith("Phase:")) {
      const p = parsePhase(cur);
      if (!p.ok) return p;
      phases.push(p.value);
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
        "interrogationSceneUnknownH2",
        `Unknown H2 heading: ${tok.text}.`,
      );
    }
  }

  if (!outro) {
    return fail(
      sourceFile,
      first.line,
      "interrogationSceneMissingOutro",
      "Interrogation scene must end with `## Outro`.",
    );
  }
  if (phases.length === 0) {
    return fail(
      sourceFile,
      first.line,
      "interrogationSceneNoPhases",
      "Interrogation scene must declare at least one phase.",
    );
  }

  return {
    ok: true,
    value: {
      kind: "interrogationScene",
      id,
      title,
      intro,
      phases,
      evidenceManifest,
      statementManifest,
      outro,
      assetRefs: [],
      sourceFile,
      line: first.line,
    },
  };
}

function parsePhase(
  cur: Cursor,
):
  | { ok: true; value: ASTInterrogationPhase }
  | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 2)
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parsePhase called off-position.",
    );
  if (!head.anchorId)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationPhaseMissingAnchor",
      "Phase heading must include {#id}.",
    );
  const labelMatch = /^Phase:\s*(.+)$/.exec(head.text);
  if (!labelMatch)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationPhaseMalformedHeading",
      `Malformed phase heading: ${head.text}`,
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
  const kind = meta.value.Kind;
  if (!kind)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationPhaseMissingKind",
      `Phase ${head.anchorId} requires Kind.`,
    );
  if (kind === "inquiry")
    return parseInquiryPhase(cur, {
      head,
      id: head.anchorId,
      label,
      meta: meta.value,
    });
  return fail(
    cur.sourceFile,
    head.line,
    "interrogationPhaseUnknownKind",
    `Unknown interrogation phase Kind: ${kind}.`,
  );
}

type PhaseMeta = {
  head: Extract<Token, { kind: "heading" }>;
  id: string;
  label: string;
  meta: Meta;
};

function parseSubject(
  cur: Cursor,
): { ok: true; value: ASTSubject } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3)
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseSubject called off-position.",
    );
  if (!head.anchorId)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationSubjectMissingAnchor",
      "Subject heading must include {#id}.",
    );
  const nameMatch = /^Subject:\s*(.+)$/.exec(head.text);
  if (!nameMatch)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationSubjectMissingAnchor",
      `Malformed subject heading: ${head.text}`,
    );
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
  if (!role || !bio)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationSubjectMissingMetadata",
      `Subject ${head.anchorId} requires Role and Bio.`,
    );
  return {
    ok: true,
    value: {
      id: head.anchorId,
      name: (nameMatch[1] ?? "").trim(),
      role,
      bio,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseInquiryPhase(
  cur: Cursor,
  phaseMeta: PhaseMeta,
): { ok: true; value: ASTInquiryPhase } | { ok: false; error: CompileError } {
  const common = parseCommonPhaseMeta(phaseMeta);
  if (!common.ok) return common;

  let subject: ASTSubject | null = null;
  let sceneTag: string | null = null;
  const entryDialogue: DialogueItem[] = [];
  const questions: ASTInquiryQuestion[] = [];

  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 2) break;
    if (
      next.kind === "heading" &&
      next.level === 3 &&
      next.text.startsWith("Subject:")
    ) {
      if (subject)
        return fail(
          cur.sourceFile,
          next.line,
          "interrogationPhaseDuplicateSubject",
          `Phase ${phaseMeta.id} declared multiple Subject blocks.`,
        );
      const s = parseSubject(cur);
      if (!s.ok) return s;
      subject = s.value;
      continue;
    }
    if (
      next.kind === "heading" &&
      next.level === 3 &&
      next.text.startsWith("Question:")
    ) {
      const q = parseInquiryQuestion(cur);
      if (!q.ok) return q;
      questions.push(q.value);
      continue;
    }
    const body = consumePhaseBodyToken(
      cur,
      sceneTag,
      entryDialogue,
      phaseMeta.id,
    );
    if (!body.ok) return body;
    sceneTag = body.value.sceneTag;
  }

  if (sceneTag === null)
    return fail(
      cur.sourceFile,
      phaseMeta.head.line,
      "interrogationPhaseNoSceneTag",
      "Interrogation phase body must include exactly one [場景：...] tag.",
    );
  if (!subject)
    return fail(
      cur.sourceFile,
      phaseMeta.head.line,
      "interrogationPhaseMissingSubject",
      `Phase ${phaseMeta.id} must declare a Subject.`,
    );
  if (questions.length === 0)
    return fail(
      cur.sourceFile,
      phaseMeta.head.line,
      "interrogationInquiryNoQuestions",
      `Inquiry phase ${phaseMeta.id} must declare at least one question.`,
    );

  const complete = phaseMeta.meta.Complete
    ? parseInterrogationUnlockExpr(
        phaseMeta.meta.Complete,
        cur.sourceFile,
        phaseMeta.head.line,
      )
    : { ok: true as const, value: "auto" as const };
  if (!complete.ok) return complete;

  return {
    ok: true,
    value: {
      kind: "inquiry",
      id: phaseMeta.id,
      label: phaseMeta.label,
      subject,
      required: common.value.required,
      status: common.value.status,
      unlock: common.value.unlock,
      reveals: common.value.reveals,
      sceneTag,
      assetCue: common.value.assetCue,
      entryDialogue,
      complete: complete.value,
      questions,
      sourceFile: cur.sourceFile,
      line: phaseMeta.head.line,
    },
  };
}

function parseInquiryQuestion(
  cur: Cursor,
):
  | { ok: true; value: ASTInquiryQuestion }
  | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3)
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseInquiryQuestion called off-position.",
    );
  if (!head.anchorId)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationQuestionMissingAnchor",
      "Question heading must include {#id}.",
    );
  const labelMatch = /^Question:\s*(.+)$/.exec(head.text);
  if (!labelMatch)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationQuestionMalformedHeading",
      `Malformed question heading: ${head.text}`,
    );

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const badAssetMeta = rejectReservedAssetMetadata(
    meta.value,
    [],
    cur.sourceFile,
    head.line,
  );
  if (badAssetMeta) return { ok: false, error: badAssetMeta };
  const status = validateStatus(
    meta.value.Status,
    "unlocked",
    cur.sourceFile,
    head.line,
  );
  if (!status.ok) return status;
  let unlock: InterrogationUnlockExpr | null = null;
  if (meta.value.Unlock) {
    if (status.value !== "locked") {
      return fail(
        cur.sourceFile,
        head.line,
        "unlockOnNonLockedBlock",
        `Block has an Unlock condition but Status is "${status.value}". Set Status to "locked" or remove the Unlock.`,
      );
    }
    const r = parseInterrogationUnlockExpr(
      meta.value.Unlock,
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = meta.value.Reveals
    ? parseInterrogationRevealsList(
        meta.value.Reveals,
        cur.sourceFile,
        head.line,
      )
    : { ok: true as const, value: [] as InterrogationRevealTarget[] };
  if (!reveals.ok) return reveals;
  const required = parseBoolean(
    meta.value.Required,
    true,
    cur.sourceFile,
    head.line,
  );
  if (!required.ok) return required;

  const next = cur.peek();
  if (
    !next ||
    next.kind !== "heading" ||
    next.level !== 4 ||
    next.text !== "Testimony"
  ) {
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationQuestionMissingTestimony",
      `Question ${head.anchorId} must be followed by exactly one #### Testimony block.`,
    );
  }
  const testimony = parseTestimony(cur, head.anchorId);
  if (!testimony.ok) return testimony;

  return {
    ok: true,
    value: {
      id: head.anchorId,
      label: (labelMatch[1] ?? "").trim(),
      status: status.value,
      required: required.value,
      unlock,
      reveals: reveals.value,
      testimony: testimony.value,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseTestimony(
  cur: Cursor,
  questionId: string,
): { ok: true; value: ASTTestimony } | { ok: false; error: CompileError } {
  const head = cur.next(); // the "#### Testimony" heading itself
  if (
    !head ||
    head.kind !== "heading" ||
    head.level !== 4 ||
    head.text !== "Testimony"
  )
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseTestimony called off-position.",
    );

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const badAssetMeta = rejectReservedAssetMetadata(
    meta.value,
    [],
    cur.sourceFile,
    head.line,
  );
  if (badAssetMeta) return { ok: false, error: badAssetMeta };

  const TESTIMONY_FIELDS = new Set([
    "On Loop",
    "Loop Prompt",
    "Default Challenge",
    "Default Wrong",
    "Wrong Reply",
  ]);
  for (const key of Object.keys(meta.value)) {
    if (!TESTIMONY_FIELDS.has(key))
      return fail(
        cur.sourceFile,
        head.line,
        "interrogationBadTestimonyField",
        `Unknown Testimony field "${key}" on question ${questionId}.`,
      );
  }

  const onLoopRaw = meta.value["On Loop"];
  if (!onLoopRaw)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationMissingOnLoop",
      `Question ${questionId}'s #### Testimony requires On Loop dialogue.`,
    );
  const onLoop = parseDialogueFieldValue(onLoopRaw, cur.sourceFile, head.line);
  if (!onLoop.ok) return onLoop;

  let defaultChallenge: DialogueItem[] | null = null;
  if (meta.value["Default Challenge"] !== undefined) {
    const r = parseDialogueFieldValue(
      meta.value["Default Challenge"],
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    defaultChallenge = r.value;
  }
  let defaultWrong: DialogueItem[] | null = null;
  if (meta.value["Default Wrong"] !== undefined) {
    const r = parseDialogueFieldValue(
      meta.value["Default Wrong"],
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    defaultWrong = r.value;
  }
  let loopPrompt: DialogueItem[] | null = null;
  if (meta.value["Loop Prompt"] !== undefined) {
    const r = parseDialogueFieldValue(
      meta.value["Loop Prompt"],
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    loopPrompt = r.value;
  }
  let wrongReply: DialogueItem[] | null = null;
  if (meta.value["Wrong Reply"] !== undefined) {
    const r = parseDialogueFieldValue(
      meta.value["Wrong Reply"],
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    wrongReply = r.value;
  }

  const lines: ASTTestimonyLine[] = [];
  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 3) break;
    if (
      next.kind === "heading" &&
      next.level === 5 &&
      next.text.startsWith("Line:")
    ) {
      const l = parseTestimonyLine(cur);
      if (!l.ok) return l;
      lines.push(l.value);
      continue;
    }
    return fail(
      cur.sourceFile,
      next.line,
      "interrogationTestimonyUnexpectedContent",
      `Unexpected content in question ${questionId}'s #### Testimony: ${describe(next)}.`,
    );
  }
  if (lines.length === 0)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationEmptyTestimony",
      `Question ${questionId}'s #### Testimony needs at least one ##### Line.`,
    );

  const hasContradiction = lines.some((line) => line.contradiction !== null);
  if (hasContradiction) {
    if (!loopPrompt)
      return fail(
        cur.sourceFile,
        head.line,
        "interrogationMissingLoopPrompt",
        `Question ${questionId}'s #### Testimony has a Contradiction line and requires Loop Prompt dialogue.`,
      );
    if (!wrongReply)
      return fail(
        cur.sourceFile,
        head.line,
        "interrogationMissingWrongReply",
        `Question ${questionId}'s #### Testimony has a Contradiction line and requires Wrong Reply dialogue.`,
      );
  }

  return {
    ok: true,
    value: {
      onLoop: onLoop.value,
      loopPrompt,
      defaultChallenge,
      defaultWrong,
      wrongReply,
      lines,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseTestimonyLine(
  cur: Cursor,
): { ok: true; value: ASTTestimonyLine } | { ok: false; error: CompileError } {
  const head = cur.next(); // "##### Line: <label> {#id}"
  if (!head || head.kind !== "heading" || head.level !== 5)
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseTestimonyLine called off-position.",
    );
  if (!head.anchorId)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationLineMissingAnchor",
      "##### Line heading must include {#id}.",
    );
  const labelMatch = /^Line:\s*(.+)$/.exec(head.text);
  if (!labelMatch)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationLineMalformedHeading",
      `Malformed line heading: ${head.text}`,
    );
  const label = (labelMatch[1] ?? "").trim();

  const content = readLeadingDialogue(cur);
  if (!content.ok) return content;
  if (content.value.length === 0)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationEmptyLine",
      `##### Line "${head.anchorId}" needs suspect dialogue.`,
    );

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const badAssetMeta = rejectReservedAssetMetadata(
    meta.value,
    [],
    cur.sourceFile,
    head.line,
  );
  if (badAssetMeta) return { ok: false, error: badAssetMeta };

  const LINE_FIELDS = new Set([
    "Contradiction",
    "Challenge",
    "On Correct",
    "On Wrong Evidence",
    "Reveals",
  ]);
  for (const key of Object.keys(meta.value)) {
    if (!LINE_FIELDS.has(key))
      return fail(
        cur.sourceFile,
        head.line,
        "interrogationBadLineField",
        `Unknown Line field "${key}" on ${head.anchorId}.`,
      );
  }

  let contradiction: InventoryTarget | null = null;
  if (meta.value.Contradiction !== undefined) {
    const r = parseInventoryTarget(
      meta.value.Contradiction,
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    contradiction = r.value;
  }
  let challenge: DialogueItem[] | null = null;
  if (meta.value.Challenge !== undefined) {
    const r = parseDialogueFieldValue(
      meta.value.Challenge,
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    challenge = r.value;
  }
  let onCorrect: DialogueItem[] | null = null;
  if (meta.value["On Correct"] !== undefined) {
    const r = parseDialogueFieldValue(
      meta.value["On Correct"],
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    onCorrect = r.value;
  }
  let onWrongEvidence: DialogueItem[] | null = null;
  if (meta.value["On Wrong Evidence"] !== undefined) {
    const r = parseDialogueFieldValue(
      meta.value["On Wrong Evidence"],
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    onWrongEvidence = r.value;
  }
  // "- **Reveals:** [...]" is authored indented under "- **On Correct:**" for
  // readability, but the tokenizer trims leading whitespace on every line, so
  // it arrives here as just another metadata key on this Line block -- there
  // is no nesting to thread through.
  const reveals = meta.value.Reveals
    ? parseInterrogationRevealsList(
        meta.value.Reveals,
        cur.sourceFile,
        head.line,
      )
    : { ok: true as const, value: [] as InterrogationRevealTarget[] };
  if (!reveals.ok) return reveals;

  if (contradiction !== null) {
    if (!challenge)
      return fail(
        cur.sourceFile,
        head.line,
        "interrogationMissingChallenge",
        `Line "${head.anchorId}" with Contradiction needs Challenge.`,
      );
    if (!onCorrect)
      return fail(
        cur.sourceFile,
        head.line,
        "interrogationMissingOnCorrect",
        `Line "${head.anchorId}" with Contradiction needs On Correct.`,
      );
    if (!onWrongEvidence)
      return fail(
        cur.sourceFile,
        head.line,
        "interrogationMissingOnWrongEvidence",
        `Line "${head.anchorId}" with Contradiction needs On Wrong Evidence.`,
      );
  }

  return {
    ok: true,
    value: {
      id: head.anchorId,
      label,
      content: content.value,
      contradiction,
      challenge,
      onCorrect,
      onWrongEvidence,
      reveals: reveals.value,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseOutro(
  cur: Cursor,
):
  | { ok: true; value: ASTInterrogationOutro }
  | { ok: false; error: CompileError } {
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
  let unlock: InterrogationUnlockExpr | "auto" = "auto";
  if (meta.value.Unlock) {
    const r = parseInterrogationUnlockExpr(
      meta.value.Unlock,
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    unlock = r.value;
  }
  const r = consumeDialogueUntilHeading(cur, 2);
  if (!r.ok) return r;
  return { ok: true, value: { unlock, dialogue: r.value } };
}

function parseCommonPhaseMeta(phaseMeta: PhaseMeta):
  | {
      ok: true;
      value: {
        required: boolean;
        status: "locked" | "unlocked";
        unlock: InterrogationUnlockExpr | null;
        reveals: InterrogationRevealTarget[];
        assetCue: VisualAssetCue;
      };
    }
  | { ok: false; error: CompileError } {
  const badAssetMeta = rejectReservedAssetMetadata(
    phaseMeta.meta,
    VISUAL_ASSET_METADATA_KEYS,
    phaseMeta.head.sourceFile,
    phaseMeta.head.line,
  );
  if (badAssetMeta) return { ok: false, error: badAssetMeta };
  const required = parseBoolean(
    phaseMeta.meta.Required,
    true,
    phaseMeta.head.sourceFile,
    phaseMeta.head.line,
  );
  if (!required.ok) return required;
  const status = validateStatus(
    phaseMeta.meta.Status,
    "unlocked",
    phaseMeta.head.sourceFile,
    phaseMeta.head.line,
  );
  if (!status.ok) return status;
  let unlock: InterrogationUnlockExpr | null = null;
  if (phaseMeta.meta.Unlock) {
    if (status.value !== "locked") {
      return fail(
        phaseMeta.head.sourceFile,
        phaseMeta.head.line,
        "unlockOnNonLockedBlock",
        `Block has an Unlock condition but Status is "${status.value}". Set Status to "locked" or remove the Unlock.`,
      );
    }
    const r = parseInterrogationUnlockExpr(
      phaseMeta.meta.Unlock,
      phaseMeta.head.sourceFile,
      phaseMeta.head.line,
    );
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = phaseMeta.meta.Reveals
    ? parseInterrogationRevealsList(
        phaseMeta.meta.Reveals,
        phaseMeta.head.sourceFile,
        phaseMeta.head.line,
      )
    : { ok: true as const, value: [] as InterrogationRevealTarget[] };
  if (!reveals.ok) return reveals;
  return {
    ok: true,
    value: {
      required: required.value,
      status: status.value,
      unlock,
      reveals: reveals.value,
      assetCue: parseVisualAssetCue(phaseMeta.meta),
    },
  };
}

function consumePhaseBodyToken(
  cur: Cursor,
  sceneTag: string | null,
  entryDialogue: DialogueItem[],
  phaseId: string,
):
  | { ok: true; value: { sceneTag: string | null } }
  | { ok: false; error: CompileError } {
  const next = cur.next();
  if (!next) return { ok: true, value: { sceneTag } };
  if (next.kind === "sceneTag") {
    if (sceneTag !== null)
      return fail(
        cur.sourceFile,
        next.line,
        "interrogationPhaseDuplicateSceneTag",
        `Phase ${phaseId} declared multiple [場景：...] tags.`,
      );
    return { ok: true, value: { sceneTag: next.text } };
  }
  if (next.kind === "action") {
    entryDialogue.push({ kind: "action", text: next.text });
    return { ok: true, value: { sceneTag } };
  }
  if (next.kind === "dialogue") {
    entryDialogue.push({
      kind: "line",
      speaker: next.speaker,
      text: next.text,
      expression: next.expression,
      portrait: null,
    });
    return { ok: true, value: { sceneTag } };
  }
  if (next.kind === "metadata")
    return fail(
      cur.sourceFile,
      next.line,
      "strayMetadataInDialogueBody",
      `Stray metadata in phase body: ${next.key}.`,
    );
  if (next.kind === "unknown")
    return fail(
      cur.sourceFile,
      next.line,
      "unrecognizedDialogueLine",
      `Unrecognized line in phase body: ${next.text}.`,
    );
  return fail(
    cur.sourceFile,
    next.line,
    "interrogationPhaseMalformedHeading",
    `Unexpected H${next.level} "${next.text}" in phase ${phaseId}.`,
  );
}

function consumeMetadata(
  cur: Cursor,
): { ok: true; value: Meta } | { ok: false; error: CompileError } {
  const out: Meta = {};
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

function consumeDialogueUntilHeading(
  cur: Cursor,
  _atOrAboveLevel: number,
): DialogueResult {
  // Stops at ANY heading regardless of level. Every dialogue body in this
  // grammar terminates at the next heading (the next structural block, e.g.
  // a Subject, Question, Phase, or Outro heading), so a level-aware check
  // would silently swallow headings whose level exceeds the cutoff. The
  // level parameter is kept for documentation but no longer affects
  // behavior.
  //
  // Unknown/metadata tokens inside a dialogue body are a hard error -- they
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
      return fail(
        cur.sourceFile,
        next.line,
        "strayMetadataInDialogueBody",
        `Stray metadata in dialogue body: ${next.key}.`,
      );
    } else if (next.kind === "unknown") {
      return fail(
        cur.sourceFile,
        next.line,
        "unrecognizedDialogueLine",
        `Unrecognized line in dialogue body: ${next.text}.`,
      );
    }
  }
  return { ok: true, value: out };
}

// Like consumeDialogueUntilHeading, but for a ##### Line body: the suspect's
// dialogue is immediately followed by "- **Key:** value" metadata fields
// (Contradiction, Challenge, ...), not another heading. Unlike
// consumeDialogueUntilHeading, hitting a metadata token here is the normal,
// expected end of the leading dialogue -- not a stray-metadata error -- so
// this stops cleanly at either a heading or a metadata token.
function readLeadingDialogue(cur: Cursor): DialogueResult {
  const out: DialogueItem[] = [];
  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" || next.kind === "metadata") break;
    cur.next();
    if (next.kind === "sceneTag")
      out.push({ kind: "sceneTag", text: next.text, assetCue: null });
    else if (next.kind === "action")
      out.push({ kind: "action", text: next.text });
    else if (next.kind === "dialogue") {
      out.push({
        kind: "line",
        speaker: next.speaker,
        text: next.text,
        expression: next.expression,
        portrait: null,
      });
    } else if (next.kind === "unknown") {
      return fail(
        cur.sourceFile,
        next.line,
        "unrecognizedDialogueLine",
        `Unrecognized line in dialogue body: ${next.text}.`,
      );
    }
  }
  return { ok: true, value: out };
}

// Testimony/Line fields (On Loop, Challenge, On Correct, On Wrong Evidence,
// ...) are authored as a single metadata bullet whose value is itself a
// dialogue line, e.g. `- **On Loop:** **相馬律**：還有哪裡對不上。`. The
// tokenizer already knows how to recognize a "**Speaker**：text" or
// "[action]" line -- re-tokenizing the raw field value (guaranteed to be a
// single physical line; METADATA_RE never spans lines) reuses that logic
// instead of duplicating its regexes here.
function parseDialogueFieldValue(
  raw: string,
  sourceFile: string,
  line: number,
): { ok: true; value: DialogueItem[] } | { ok: false; error: CompileError } {
  const toks = tokenize(raw, sourceFile);
  const items: DialogueItem[] = [];
  for (const t of toks) {
    if (t.kind === "dialogue") {
      items.push({
        kind: "line",
        speaker: t.speaker,
        text: t.text,
        expression: t.expression,
        portrait: null,
      });
    } else if (t.kind === "action") {
      items.push({ kind: "action", text: t.text });
    } else {
      return fail(
        sourceFile,
        line,
        "interrogationBadDialogueField",
        `Expected dialogue text (e.g. **Name**：...); got: ${raw}`,
      );
    }
  }
  if (items.length === 0)
    return fail(
      sourceFile,
      line,
      "interrogationBadDialogueField",
      `Expected dialogue text (e.g. **Name**：...); got: ${raw}`,
    );
  return { ok: true, value: items };
}

function parseInterrogationRevealsList(
  raw: string,
  sourceFile: string,
  line: number,
):
  | { ok: true; value: InterrogationRevealTarget[] }
  | { ok: false; error: CompileError } {
  const m = /^\[(.*)\]\s*$/.exec(raw.trim());
  if (!m)
    return fail(
      sourceFile,
      line,
      "interrogationRevealUnknownTarget",
      `Reveals value must be a [list]. Got: ${raw}`,
    );
  const items = (m[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: InterrogationRevealTarget[] = [];
  for (const item of items) {
    const target = parseInterrogationRevealTarget(item, sourceFile, line);
    if (!target.ok) return target;
    out.push(target.value);
  }
  return { ok: true, value: out };
}

function parseInterrogationRevealTarget(
  raw: string,
  sourceFile: string,
  line: number,
):
  | { ok: true; value: InterrogationRevealTarget }
  | { ok: false; error: CompileError } {
  const m = /^(evidence|statement|question|phase):([a-z0-9_]+)$/.exec(raw);
  if (!m)
    return fail(
      sourceFile,
      line,
      "interrogationRevealUnknownTarget",
      `Unknown interrogation reveal target: ${raw}`,
    );
  const kind = m[1] as InterrogationRevealTarget["kind"];
  const id = m[2] ?? "";
  return { ok: true, value: { kind, id } };
}

function parseInventoryTarget(
  raw: string,
  sourceFile: string,
  line: number,
): { ok: true; value: InventoryTarget } | { ok: false; error: CompileError } {
  const m = /^(evidence|statement):([a-z0-9_]+)$/.exec(raw.trim());
  if (!m)
    return fail(
      sourceFile,
      line,
      "interrogationContradictionMalformed",
      `Contradiction must be evidence:<id> or statement:<id>. Got: ${raw}`,
    );
  return {
    ok: true,
    value: { kind: m[1] as InventoryTarget["kind"], id: m[2] ?? "" },
  };
}

function parseBoolean(
  raw: string | undefined,
  fallback: boolean,
  sourceFile: string,
  line: number,
): { ok: true; value: boolean } | { ok: false; error: CompileError } {
  if (raw === undefined) return { ok: true, value: fallback };
  if (raw === "true") return { ok: true, value: true };
  if (raw === "false") return { ok: true, value: false };
  return fail(
    sourceFile,
    line,
    "invalidBooleanValue",
    `Boolean metadata must be "true" or "false"; got "${raw}".`,
  );
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
  return fail(
    sourceFile,
    line,
    "invalidStatusValue",
    `Status must be "locked" or "unlocked"; got "${raw}".`,
  );
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
