// =============================================================================
// packages/scripts/compile-scenes/parser-interrogation.ts
//
// Parses an interrogation scene (chapter_<N>/interrogation_scene_<K>.md).
//
// Block hierarchy:
//   H1: # Scene N: <title>
//   H2: ## Intro | ## Phase: | ## Evidence Manifest | ## Statement Manifest | ## Outro
//   H3: ### Subject: | ### Question: | ### Testimony | ### Result:
//   H4: #### Follow-up: | #### On Reask | #### Statement:
//   H5: ##### On Reask | ##### On Press | ##### On Present | ##### On Wrong Present
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
  ASTTestimonyPhase,
  ASTTestimonyResult,
  ASTTestimonyStatement,
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
  if (kind === "testimony")
    return parseTestimonyPhase(cur, {
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
  let lastQuestionId: string | null = null;

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
      const q = parseInquiryQuestion(cur, null);
      if (!q.ok) return q;
      questions.push(q.value);
      lastQuestionId = q.value.id;
      continue;
    }
    if (
      next.kind === "heading" &&
      next.level === 4 &&
      next.text.startsWith("Follow-up:")
    ) {
      if (!lastQuestionId)
        return fail(
          cur.sourceFile,
          next.line,
          "interrogationQuestionMalformedHeading",
          "Follow-up must appear after a parent Question.",
        );
      const q = parseInquiryQuestion(cur, lastQuestionId);
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

function parseTestimonyPhase(
  cur: Cursor,
  phaseMeta: PhaseMeta,
): { ok: true; value: ASTTestimonyPhase } | { ok: false; error: CompileError } {
  const common = parseCommonPhaseMeta(phaseMeta);
  if (!common.ok) return common;

  let subject: ASTSubject | null = null;
  let sceneTag: string | null = null;
  let hasTestimonyContainer = false;
  const entryDialogue: DialogueItem[] = [];
  const statements: ASTTestimonyStatement[] = [];
  const results: ASTTestimonyResult[] = [];

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
      next.text === "Testimony"
    ) {
      if (hasTestimonyContainer)
        return fail(
          cur.sourceFile,
          next.line,
          "testimonyDuplicateContainer",
          `Testimony phase ${phaseMeta.id} declared multiple Testimony containers.`,
        );
      cur.next();
      hasTestimonyContainer = true;
      while (true) {
        const tok = cur.peek();
        if (!tok) break;
        if (tok.kind === "heading" && tok.level <= 3) break;
        if (
          tok.kind === "heading" &&
          tok.level === 4 &&
          tok.text.startsWith("Statement:")
        ) {
          const s = parseTestimonyStatement(cur);
          if (!s.ok) return s;
          statements.push(s.value);
          continue;
        }
        return fail(
          cur.sourceFile,
          tok.line,
          "testimonyMissingContainer",
          `Unexpected content in Testimony container: ${describe(tok)}.`,
        );
      }
      continue;
    }
    if (
      next.kind === "heading" &&
      next.level === 3 &&
      next.text.startsWith("Result:")
    ) {
      const r = parseTestimonyResult(cur);
      if (!r.ok) return r;
      results.push(r.value);
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
  if (!hasTestimonyContainer)
    return fail(
      cur.sourceFile,
      phaseMeta.head.line,
      "testimonyMissingContainer",
      `Testimony phase ${phaseMeta.id} must declare ### Testimony.`,
    );
  if (statements.length === 0)
    return fail(
      cur.sourceFile,
      phaseMeta.head.line,
      "testimonyNoStatements",
      `Testimony phase ${phaseMeta.id} must declare at least one statement.`,
    );
  if (results.length === 0)
    return fail(
      cur.sourceFile,
      phaseMeta.head.line,
      "testimonyNoResults",
      `Testimony phase ${phaseMeta.id} must declare at least one result.`,
    );

  return {
    ok: true,
    value: {
      kind: "testimony",
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
      statements,
      results,
      sourceFile: cur.sourceFile,
      line: phaseMeta.head.line,
    },
  };
}

function parseInquiryQuestion(
  cur: Cursor,
  parentQuestionId: string | null,
):
  | { ok: true; value: ASTInquiryQuestion }
  | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading")
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
  const expectedLevel = parentQuestionId === null ? 3 : 4;
  if (head.level !== expectedLevel)
    return fail(
      cur.sourceFile,
      head.line,
      "interrogationQuestionMalformedHeading",
      `Unexpected question heading level H${head.level}.`,
    );
  const labelMatch =
    parentQuestionId === null
      ? /^Question:\s*(.+)$/.exec(head.text)
      : /^Follow-up:\s*(.+)$/.exec(head.text);
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

  const answer = consumeDialogueUntilHeading(cur, head.level);
  if (!answer.ok) return answer;

  let onReask: DialogueItem[] | null = null;
  const next = cur.peek();
  const onReaskLevel = parentQuestionId === null ? 4 : 5;
  if (
    next &&
    next.kind === "heading" &&
    next.level === onReaskLevel &&
    next.text === "On Reask"
  ) {
    cur.next();
    const r = consumeDialogueUntilHeading(cur, onReaskLevel);
    if (!r.ok) return r;
    onReask = r.value;
  } else if (
    next &&
    next.kind === "heading" &&
    next.level === 5 &&
    parentQuestionId === null
  ) {
    return fail(
      cur.sourceFile,
      next.line,
      "interrogationQuestionMalformedHeading",
      `Unexpected H5 under Question: ${next.text}.`,
    );
  }

  return {
    ok: true,
    value: {
      id: head.anchorId,
      label: (labelMatch[1] ?? "").trim(),
      kind: parentQuestionId === null ? "question" : "followUp",
      parentQuestionId,
      status: status.value,
      required: required.value,
      unlock,
      reveals: reveals.value,
      answerDialogue: answer.value,
      onReask,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseTestimonyStatement(
  cur: Cursor,
):
  | { ok: true; value: ASTTestimonyStatement }
  | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 4)
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseTestimonyStatement called off-position.",
    );
  if (!head.anchorId)
    return fail(
      cur.sourceFile,
      head.line,
      "testimonyStatementMissingAnchor",
      "Testimony statement heading must include {#id}.",
    );
  const labelMatch = /^Statement:\s*(.+)$/.exec(head.text);
  if (!labelMatch)
    return fail(
      cur.sourceFile,
      head.line,
      "testimonyStatementMissingAnchor",
      `Malformed testimony statement heading: ${head.text}`,
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
  const content = meta.value.Content;
  if (!content)
    return fail(
      cur.sourceFile,
      head.line,
      "testimonyStatementMissingContent",
      `Testimony statement ${head.anchorId} requires Content.`,
    );
  const contradiction = meta.value.Contradiction
    ? parseInventoryTarget(meta.value.Contradiction, cur.sourceFile, head.line)
    : { ok: true as const, value: null };
  if (!contradiction.ok) return contradiction;
  const reveals = meta.value.Reveals
    ? parseInterrogationRevealsList(
        meta.value.Reveals,
        cur.sourceFile,
        head.line,
      )
    : { ok: true as const, value: [] as InterrogationRevealTarget[] };
  if (!reveals.ok) return reveals;

  let onPress: DialogueItem[] | null = null;
  let onPresent: DialogueItem[] | null = null;
  let onWrongPresent: DialogueItem[] | null = null;

  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 4) break;
    if (next.kind === "heading" && next.level === 5) {
      if (next.text === "On Press") {
        cur.next();
        const r = consumeDialogueUntilHeading(cur, 5);
        if (!r.ok) return r;
        onPress = r.value;
        continue;
      }
      if (next.text === "On Present") {
        cur.next();
        const r = consumeDialogueUntilHeading(cur, 5);
        if (!r.ok) return r;
        onPresent = r.value;
        continue;
      }
      if (next.text === "On Wrong Present") {
        cur.next();
        const r = consumeDialogueUntilHeading(cur, 5);
        if (!r.ok) return r;
        onWrongPresent = r.value;
        continue;
      }
      return fail(
        cur.sourceFile,
        next.line,
        "testimonyUnknownH5",
        `Unknown H5 under testimony statement ${head.anchorId}: ${next.text}.`,
      );
    }
    return fail(
      cur.sourceFile,
      next.line,
      "testimonyUnknownH5",
      `Unexpected token in testimony statement ${head.anchorId}: ${describe(next)}.`,
    );
  }

  return {
    ok: true,
    value: {
      id: head.anchorId,
      label: (labelMatch[1] ?? "").trim(),
      content,
      contradiction: contradiction.value,
      onCorrect: meta.value["On Correct"] ?? null,
      onWrong: meta.value["On Wrong"] ?? null,
      onPress,
      onPresent,
      onWrongPresent,
      reveals: reveals.value,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseTestimonyResult(
  cur: Cursor,
):
  | { ok: true; value: ASTTestimonyResult }
  | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3)
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseTestimonyResult called off-position.",
    );
  if (!head.anchorId)
    return fail(
      cur.sourceFile,
      head.line,
      "testimonyResultMissingAnchor",
      "Testimony result heading must include {#id}.",
    );
  const labelMatch = /^Result:\s*(.+)$/.exec(head.text);
  if (!labelMatch)
    return fail(
      cur.sourceFile,
      head.line,
      "testimonyResultMissingAnchor",
      `Malformed testimony result heading: ${head.text}`,
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
  const reveals = meta.value.Reveals
    ? parseInterrogationRevealsList(
        meta.value.Reveals,
        cur.sourceFile,
        head.line,
      )
    : { ok: true as const, value: [] as InterrogationRevealTarget[] };
  if (!reveals.ok) return reveals;
  const dialogue = consumeDialogueUntilHeading(cur, 3);
  if (!dialogue.ok) return dialogue;
  return {
    ok: true,
    value: {
      id: head.anchorId,
      label: (labelMatch[1] ?? "").trim(),
      reveals: reveals.value,
      dialogue: dialogue.value,
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
  // grammar terminates at the next heading (the next structural block or an
  // optional sub-block like On Reask), so a level-aware check would silently
  // swallow headings whose level exceeds the cutoff. The level parameter is
  // kept for documentation but no longer affects behavior.
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
