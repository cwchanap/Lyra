import {
  consumeDialogueUntilHeading,
  consumeMetadata,
  describeToken,
  parseFailure,
} from "./parser-common";
import { parseRevealsList } from "./parser-reveals";
import { parseStoryUnlockExpr } from "./parser-unlock";
import { tokenize, type Token } from "./tokenizer";
import type {
  ASTAnalysisBoard,
  ASTAnalysisBoardCommon,
  ASTAnalysisCard,
  ASTAnalysisCardId,
  ASTAnalysisFeedback,
  ASTAnalysisFixedAnchor,
  ASTAnalysisGroup,
  ASTAnalysisScene,
  ASTClassifyBoard,
  ASTOrderBoard,
  ASTThresholdBoard,
  CompileError,
  DialogueItem,
  InventoryTarget,
  InvestigationRevealTarget,
  Located,
  ProceduralStatus,
  ProofCapability,
  StoryRevealTarget,
  StoryUnlockExpr,
} from "./types";

export type AnalysisParseResult =
  | { ok: true; value: ASTAnalysisScene }
  | { ok: false; error: CompileError };

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CompileError };

type BoardKind = "classify" | "order" | "threshold";

type AnalysisMetadata = {
  values: Record<string, string>;
  lines: Record<string, number>;
};

type ParsedBoardCommon = {
  prompt: Located<{ value: string }>;
  unlock: Located<{ value: StoryUnlockExpr }> | null;
  reveals: Located<{ value: StoryRevealTarget[] }>;
  feedback: ASTAnalysisFeedback;
};

const COMMON_BOARD_METADATA = new Set([
  "Kind",
  "Prompt",
  "Unlock",
  "Reveals",
  "Incomplete Feedback",
  "Incorrect Feedback",
  "Hint",
]);

const ORDER_METADATA = new Set(["Accepted Order", "Fixed Anchors"]);

const THRESHOLD_METADATA = new Set([
  "Eligible Cards",
  "Minimum Selected",
  "Minimum Distinct Source Groups",
  "Required Proof Capabilities",
  "Allowed Procedural Statuses",
  "Require Source Group",
]);

const PROOF_CAPABILITIES = new Set<ProofCapability>([
  "time",
  "order",
  "route",
  "identity",
  "access",
  "motive",
  "source",
  "credibility",
  "procedure",
  "causation",
]);

const PROCEDURAL_STATUSES = new Set<ProceduralStatus>([
  "unspecified",
  "lead",
  "reacquired",
  "exhibit",
]);

const SLUG_RE = /^[a-z0-9_]+$/;
const BLANK_METADATA_RE = /^-\s+\*\*([A-Za-z][A-Za-z0-9 ]*):\*\*\s*$/;
const SCENE_TITLE_RE = /^Scene\s+\d+(?:\.\d+)?:\s*(.+)$/;

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

export function parseAnalysisScene(
  source: string,
  sourceFile: string,
  id: string,
): AnalysisParseResult {
  const tokens = tokenize(source, sourceFile);
  const header = parseAnalysisHeader(tokens, sourceFile);
  if (!header.ok) return header;

  const cur = new Cursor(tokens, sourceFile);
  cur.i = header.value.nextTokenIndex;

  let intro: DialogueItem[] | null = null;
  const boards: ASTAnalysisBoard[] = [];
  let outro: DialogueItem[] | null = null;

  while (!cur.done()) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind !== "heading" || next.level !== 2) {
      return fail(
        sourceFile,
        next.line,
        "analysisSceneUnexpectedToken",
        `Expected an H2 scene block; got: ${describeToken(next)}.`,
      );
    }

    if (next.text === "Intro") {
      if (next.anchorId) {
        return fail(
          sourceFile,
          next.line,
          "analysisSceneIntroHasAnchor",
          "Intro must not declare an anchor.",
        );
      }
      if (intro !== null) {
        return fail(
          sourceFile,
          next.line,
          "analysisSceneDuplicateIntro",
          "Analysis scene may declare `## Intro` only once.",
        );
      }
      if (boards.length > 0 || outro !== null) {
        return fail(
          sourceFile,
          next.line,
          "analysisSceneIntroMisplaced",
          "`## Intro` must appear before every Board and Outro block.",
        );
      }
      cur.next();
      const parsedIntro = consumeDialogueUntilHeading(cur, 2);
      if (!parsedIntro.ok) return parsedIntro;
      intro = parsedIntro.value;
      continue;
    }

    if (next.text.startsWith("Board:")) {
      if (intro === null) {
        return fail(
          sourceFile,
          next.line,
          "analysisSceneBoardBeforeIntro",
          "Analysis scene must declare `## Intro` before its Board blocks.",
        );
      }
      if (outro !== null) {
        return fail(
          sourceFile,
          next.line,
          "analysisSceneBoardAfterOutro",
          "Board blocks must appear before `## Outro`.",
        );
      }
      const board = parseBoard(cur);
      if (!board.ok) return board;
      boards.push(board.value);
      continue;
    }

    if (next.text === "Outro") {
      if (next.anchorId) {
        return fail(
          sourceFile,
          next.line,
          "analysisSceneOutroHasAnchor",
          "Outro must not declare an anchor.",
        );
      }
      if (intro === null) {
        return fail(
          sourceFile,
          next.line,
          "analysisSceneOutroBeforeIntro",
          "Analysis scene must declare `## Intro` before `## Outro`.",
        );
      }
      if (boards.length === 0) {
        return fail(
          sourceFile,
          next.line,
          "analysisSceneOutroBeforeBoard",
          "Analysis scene must declare one or more Board blocks before `## Outro`.",
        );
      }
      if (outro !== null) {
        return fail(
          sourceFile,
          next.line,
          "analysisSceneDuplicateOutro",
          "Analysis scene may declare `## Outro` only once.",
        );
      }
      cur.next();
      const parsedOutro = consumeDialogueUntilHeading(cur, 2);
      if (!parsedOutro.ok) return parsedOutro;
      outro = parsedOutro.value;
      continue;
    }

    return fail(
      sourceFile,
      next.line,
      "analysisSceneUnknownH2",
      `Unknown analysis-scene H2 heading: ${next.text}.`,
    );
  }

  if (intro === null) {
    return fail(
      sourceFile,
      header.value.line,
      "analysisSceneMissingIntro",
      "Analysis scene must declare exactly one `## Intro` block.",
    );
  }
  if (boards.length === 0) {
    return fail(
      sourceFile,
      header.value.line,
      "analysisSceneNoBoards",
      "Analysis scene must declare one or more Board blocks.",
    );
  }
  if (outro === null) {
    return fail(
      sourceFile,
      header.value.line,
      "analysisSceneMissingOutro",
      "Analysis scene must declare exactly one `## Outro` block.",
    );
  }

  return {
    ok: true,
    value: {
      kind: "analysisScene",
      id,
      title: header.value.title,
      summary: header.value.summary,
      intro,
      boards,
      outro,
      assetRefs: [],
      sourceFile,
      line: header.value.line,
    },
  };
}

function parseAnalysisHeader(
  tokens: Token[],
  sourceFile: string,
): ParseResult<{
  title: string;
  summary: string;
  line: number;
  nextTokenIndex: number;
}> {
  const first = tokens[0];
  if (!first || first.kind !== "heading" || first.level !== 1) {
    return fail(
      sourceFile,
      first?.line ?? 1,
      "analysisSceneMissingTitle",
      "Analysis scene must start with `# Scene N: <title>`.",
    );
  }
  const title = SCENE_TITLE_RE.exec(first.text)?.[1]?.trim();
  if (!title) {
    return fail(
      sourceFile,
      first.line,
      "analysisSceneMissingTitle",
      "Analysis scene must start with `# Scene N: <title>`.",
    );
  }

  const summary = tokens[1];
  if (summary?.kind === "metadata" && summary.key === "Summary") {
    const value = summary.value.trim();
    if (!value) {
      return fail(
        sourceFile,
        summary.line,
        "analysisSceneBlankSummary",
        "Analysis scene Summary must not be blank.",
      );
    }
    return {
      ok: true,
      value: {
        title,
        summary: value,
        line: first.line,
        nextTokenIndex: 2,
      },
    };
  }
  const blank = blankMetadataToken(summary, "Summary");
  if (blank) {
    return fail(
      sourceFile,
      blank.line,
      "analysisSceneBlankSummary",
      "Analysis scene Summary must not be blank.",
    );
  }
  return fail(
    sourceFile,
    first.line,
    "analysisSceneMissingSummary",
    "Analysis scene requires `- **Summary:** <non-empty text>` immediately after the H1 title.",
  );
}

function parseBoard(cur: Cursor): ParseResult<ASTAnalysisBoard> {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 2) {
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseBoard called off-position.",
    );
  }
  if (!head.anchorId) {
    return fail(
      cur.sourceFile,
      head.line,
      "analysisBoardMissingAnchor",
      "Board heading must include a `{#id}` anchor.",
    );
  }
  const labelMatch = /^Board:\s*(.*)$/.exec(head.text);
  const label = labelMatch?.[1]?.trim();
  if (!label) {
    return fail(
      cur.sourceFile,
      head.line,
      "analysisBoardMalformedHeading",
      `Board heading must use \`## Board: <label> {#id}\`; got: ${head.text}.`,
    );
  }

  const metadata = consumeAnalysisMetadata(cur);
  if (!metadata.ok) return metadata;
  const kindValue = requiredText(
    metadata.value,
    "Kind",
    cur,
    head.line,
    "analysisBoardMissingKind",
    `Board ${head.anchorId} requires Kind.`,
    "analysisBoardBlankKind",
  );
  if (!kindValue.ok) return kindValue;
  const kind = parseBoardKind(kindValue.value, cur.sourceFile);
  if (!kind.ok) return kind;

  const allowedMetadata = new Set(COMMON_BOARD_METADATA);
  if (kind.value === "order") {
    for (const key of ORDER_METADATA) allowedMetadata.add(key);
  } else if (kind.value === "threshold") {
    for (const key of THRESHOLD_METADATA) allowedMetadata.add(key);
  }
  const unknownMetadata = rejectUnknownMetadata(
    metadata.value,
    allowedMetadata,
    cur.sourceFile,
    head.line,
    `Board ${head.anchorId}`,
  );
  if (!unknownMetadata.ok) return unknownMetadata;

  const common = parseCommonBoardMetadata(
    metadata.value,
    cur,
    head.line,
    head.anchorId,
  );
  if (!common.ok) return common;

  const cards: ASTAnalysisCard[] = [];
  const groups: ASTAnalysisGroup[] = [];
  let resultDialogue: DialogueItem[] | null = null;

  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 2) break;
    if (next.kind !== "heading") {
      return fail(
        cur.sourceFile,
        next.line,
        "analysisBoardUnexpectedToken",
        `Expected an H3 Card, Group, or Result Dialogue block; got: ${describeToken(next)}.`,
      );
    }
    if (next.level !== 3) {
      return fail(
        cur.sourceFile,
        next.line,
        "analysisBoardUnexpectedHeading",
        `Expected an H3 Card, Group, or Result Dialogue block; got: ${describeToken(next)}.`,
      );
    }

    if (next.text.startsWith("Card:")) {
      const card = parseCard(cur);
      if (!card.ok) return card;
      cards.push(card.value);
      continue;
    }
    if (next.text.startsWith("Group:")) {
      if (kind.value !== "classify") {
        return fail(
          cur.sourceFile,
          next.line,
          "analysisBoardGroupNotAllowed",
          `Board ${head.anchorId} has Kind ${kind.value}; Group blocks are allowed only for classify boards.`,
        );
      }
      const group = parseGroup(cur);
      if (!group.ok) return group;
      groups.push(group.value);
      continue;
    }
    if (next.text === "Result Dialogue") {
      if (next.anchorId) {
        return fail(
          cur.sourceFile,
          next.line,
          "analysisBoardResultDialogueHasAnchor",
          "Result Dialogue is direct board dialogue and must not declare a segment anchor.",
        );
      }
      if (resultDialogue !== null) {
        return fail(
          cur.sourceFile,
          next.line,
          "analysisBoardDuplicateResultDialogue",
          "Board may declare `### Result Dialogue` only once.",
        );
      }
      cur.next();
      const parsedDialogue = consumeDialogueUntilHeading(cur, 3);
      if (!parsedDialogue.ok) return parsedDialogue;
      resultDialogue = parsedDialogue.value;
      continue;
    }

    return fail(
      cur.sourceFile,
      next.line,
      "analysisBoardUnknownH3",
      `Unknown H3 inside Board ${head.anchorId}: ${next.text}.`,
    );
  }

  if (cards.length === 0) {
    return fail(
      cur.sourceFile,
      head.line,
      "analysisBoardNoCards",
      `Board ${head.anchorId} must declare one or more Card blocks.`,
    );
  }
  if (resultDialogue === null) {
    return fail(
      cur.sourceFile,
      head.line,
      "analysisBoardMissingResultDialogue",
      `Board ${head.anchorId} must declare exactly one \`### Result Dialogue\` block.`,
    );
  }

  const boardCommon: ASTAnalysisBoardCommon = {
    id: head.anchorId,
    label,
    ...common.value,
    cards,
    resultDialogue,
    sourceFile: cur.sourceFile,
    line: head.line,
  };

  if (kind.value === "classify") {
    const board: ASTClassifyBoard = {
      ...boardCommon,
      kind: "classify",
      groups,
    };
    return { ok: true, value: board };
  }
  if (kind.value === "order") {
    const order = parseCardIdList(
      metadata.value,
      "Accepted Order",
      cur,
      head.line,
      head.anchorId,
    );
    if (!order.ok) return order;
    const fixedAnchors = parseFixedAnchors(
      metadata.value,
      cur,
      head.line,
      head.anchorId,
    );
    if (!fixedAnchors.ok) return fixedAnchors;
    const board: ASTOrderBoard = {
      ...boardCommon,
      kind: "order",
      acceptedOrder: order.value,
      fixedAnchors: fixedAnchors.value,
    };
    return { ok: true, value: board };
  }

  const threshold = parseThresholdFields(
    metadata.value,
    cur,
    head.line,
    head.anchorId,
  );
  if (!threshold.ok) return threshold;
  const board: ASTThresholdBoard = {
    ...boardCommon,
    kind: "threshold",
    ...threshold.value,
  };
  return { ok: true, value: board };
}

function parseCommonBoardMetadata(
  metadata: AnalysisMetadata,
  cur: Cursor,
  boardLine: number,
  boardId: string,
): ParseResult<ParsedBoardCommon> {
  const prompt = requiredText(
    metadata,
    "Prompt",
    cur,
    boardLine,
    "analysisBoardMissingPrompt",
    `Board ${boardId} requires Prompt.`,
    "analysisBoardBlankPrompt",
  );
  if (!prompt.ok) return prompt;
  const revealsRaw = requiredText(
    metadata,
    "Reveals",
    cur,
    boardLine,
    "analysisBoardMissingReveals",
    `Board ${boardId} requires Reveals.`,
    "analysisBoardBlankReveals",
  );
  if (!revealsRaw.ok) return revealsRaw;
  const reveals = parseStoryReveals(
    revealsRaw.value.value,
    cur.sourceFile,
    revealsRaw.value.line,
  );
  if (!reveals.ok) return reveals;
  const incomplete = requiredText(
    metadata,
    "Incomplete Feedback",
    cur,
    boardLine,
    "analysisBoardMissingIncompleteFeedback",
    `Board ${boardId} requires Incomplete Feedback.`,
    "analysisBoardBlankIncompleteFeedback",
  );
  if (!incomplete.ok) return incomplete;
  const incorrect = requiredText(
    metadata,
    "Incorrect Feedback",
    cur,
    boardLine,
    "analysisBoardMissingIncorrectFeedback",
    `Board ${boardId} requires Incorrect Feedback.`,
    "analysisBoardBlankIncorrectFeedback",
  );
  if (!incorrect.ok) return incorrect;

  let unlock: Located<{ value: StoryUnlockExpr }> | null = null;
  const unlockRaw = metadata.values.Unlock;
  if (unlockRaw !== undefined) {
    const unlockLine = metadataLine(metadata, "Unlock", boardLine);
    const parsedUnlock = parseStoryUnlockExpr(
      unlockRaw,
      cur.sourceFile,
      unlockLine,
    );
    if (!parsedUnlock.ok) return parsedUnlock;
    unlock = locatedValue(parsedUnlock.value, cur.sourceFile, unlockLine);
  }

  const hintRaw = metadata.values.Hint;
  const hint =
    hintRaw === undefined
      ? null
      : locatedValue(
          hintRaw,
          cur.sourceFile,
          metadataLine(metadata, "Hint", boardLine),
        );

  return {
    ok: true,
    value: {
      prompt: prompt.value,
      unlock,
      reveals: locatedValue(
        reveals.value,
        cur.sourceFile,
        revealsRaw.value.line,
      ),
      feedback: {
        incomplete: incomplete.value,
        incorrect: incorrect.value,
        hint,
      },
    },
  };
}

function parseCard(cur: Cursor): ParseResult<ASTAnalysisCard> {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3) {
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseCard called off-position.",
    );
  }
  if (!head.anchorId) {
    return fail(
      cur.sourceFile,
      head.line,
      "analysisCardMissingAnchor",
      "Card heading must include a `{#id}` anchor.",
    );
  }
  const labelMatch = /^Card:\s*(.*)$/.exec(head.text);
  const label = labelMatch?.[1]?.trim();
  if (!label) {
    return fail(
      cur.sourceFile,
      head.line,
      "analysisCardMalformedHeading",
      `Card heading must use \`### Card: <label> {#id}\`; got: ${head.text}.`,
    );
  }

  const metadata = consumeAnalysisMetadata(cur);
  if (!metadata.ok) return metadata;
  const unknownMetadata = rejectUnknownMetadata(
    metadata.value,
    new Set(["Source", "Summary"]),
    cur.sourceFile,
    head.line,
    `Card ${head.anchorId}`,
  );
  if (!unknownMetadata.ok) return unknownMetadata;
  const sourceRaw = requiredText(
    metadata.value,
    "Source",
    cur,
    head.line,
    "analysisCardMissingSource",
    `Card ${head.anchorId} requires Source.`,
    "analysisCardBlankSource",
  );
  if (!sourceRaw.ok) return sourceRaw;
  const source = parseCardSource(
    sourceRaw.value.value,
    cur.sourceFile,
    sourceRaw.value.line,
  );
  if (!source.ok) return source;
  const summary = requiredText(
    metadata.value,
    "Summary",
    cur,
    head.line,
    "analysisCardMissingSummary",
    `Card ${head.anchorId} requires Summary.`,
    "analysisCardBlankSummary",
  );
  if (!summary.ok) return summary;

  return {
    ok: true,
    value: {
      id: head.anchorId,
      label,
      source: locatedValue(source.value, cur.sourceFile, sourceRaw.value.line),
      summary: summary.value,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseGroup(cur: Cursor): ParseResult<ASTAnalysisGroup> {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3) {
    return fail(
      cur.sourceFile,
      head?.line ?? 1,
      "internalParserState",
      "parseGroup called off-position.",
    );
  }
  if (!head.anchorId) {
    return fail(
      cur.sourceFile,
      head.line,
      "analysisGroupMissingAnchor",
      "Group heading must include a `{#id}` anchor.",
    );
  }
  const labelMatch = /^Group:\s*(.*)$/.exec(head.text);
  const label = labelMatch?.[1]?.trim();
  if (!label) {
    return fail(
      cur.sourceFile,
      head.line,
      "analysisGroupMalformedHeading",
      `Group heading must use \`### Group: <label> {#id}\`; got: ${head.text}.`,
    );
  }

  const metadata = consumeAnalysisMetadata(cur);
  if (!metadata.ok) return metadata;
  const unknownMetadata = rejectUnknownMetadata(
    metadata.value,
    new Set(["Description", "Accepted Cards"]),
    cur.sourceFile,
    head.line,
    `Group ${head.anchorId}`,
  );
  if (!unknownMetadata.ok) return unknownMetadata;
  const description = requiredText(
    metadata.value,
    "Description",
    cur,
    head.line,
    "analysisGroupMissingDescription",
    `Group ${head.anchorId} requires Description.`,
    "analysisGroupBlankDescription",
  );
  if (!description.ok) return description;
  const acceptedCards = parseCardIdList(
    metadata.value,
    "Accepted Cards",
    cur,
    head.line,
    head.anchorId,
  );
  if (!acceptedCards.ok) return acceptedCards;

  return {
    ok: true,
    value: {
      id: head.anchorId,
      label,
      description: description.value,
      acceptedCards: acceptedCards.value,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseThresholdFields(
  metadata: AnalysisMetadata,
  cur: Cursor,
  boardLine: number,
  boardId: string,
): ParseResult<
  Pick<
    ASTThresholdBoard,
    | "eligibleCards"
    | "minimumSelected"
    | "minimumDistinctSourceGroups"
    | "requiredProofCapabilities"
    | "allowedProceduralStatuses"
    | "requireSourceGroup"
  >
> {
  const eligibleCards = parseCardIdList(
    metadata,
    "Eligible Cards",
    cur,
    boardLine,
    boardId,
  );
  if (!eligibleCards.ok) return eligibleCards;
  const minimumSelected = parseIntegerMetadata(
    metadata,
    "Minimum Selected",
    cur,
    boardLine,
    boardId,
  );
  if (!minimumSelected.ok) return minimumSelected;
  const minimumDistinctSourceGroups = parseIntegerMetadata(
    metadata,
    "Minimum Distinct Source Groups",
    cur,
    boardLine,
    boardId,
  );
  if (!minimumDistinctSourceGroups.ok) return minimumDistinctSourceGroups;
  const requiredProofCapabilities = parseEnumMetadata(
    metadata,
    "Required Proof Capabilities",
    PROOF_CAPABILITIES,
    cur,
    boardLine,
    boardId,
    "analysisThresholdInvalidProofCapability",
  );
  if (!requiredProofCapabilities.ok) return requiredProofCapabilities;
  const allowedProceduralStatuses = parseEnumMetadata(
    metadata,
    "Allowed Procedural Statuses",
    PROCEDURAL_STATUSES,
    cur,
    boardLine,
    boardId,
    "analysisThresholdInvalidProceduralStatus",
  );
  if (!allowedProceduralStatuses.ok) return allowedProceduralStatuses;
  const requireSourceGroup = parseBooleanMetadata(
    metadata,
    "Require Source Group",
    cur,
    boardLine,
    boardId,
  );
  if (!requireSourceGroup.ok) return requireSourceGroup;

  return {
    ok: true,
    value: {
      eligibleCards: eligibleCards.value,
      minimumSelected: minimumSelected.value,
      minimumDistinctSourceGroups: minimumDistinctSourceGroups.value,
      requiredProofCapabilities: requiredProofCapabilities.value,
      allowedProceduralStatuses: allowedProceduralStatuses.value,
      requireSourceGroup: requireSourceGroup.value,
    },
  };
}

function parseCardIdList(
  metadata: AnalysisMetadata,
  key: string,
  cur: Cursor,
  blockLine: number,
  blockId: string,
): ParseResult<ASTAnalysisCardId[]> {
  const raw = requiredText(
    metadata,
    key,
    cur,
    blockLine,
    "analysisMetadataMissing",
    `${blockId} requires ${key}.`,
    "analysisMetadataBlank",
  );
  if (!raw.ok) return raw;
  const items = parseListItems(
    raw.value.value,
    cur.sourceFile,
    raw.value.line,
    key,
  );
  if (!items.ok) return items;
  const ids: ASTAnalysisCardId[] = [];
  for (const id of items.value) {
    if (!SLUG_RE.test(id)) {
      return fail(
        cur.sourceFile,
        raw.value.line,
        "analysisCardIdMalformed",
        `${key} must contain snake_case card IDs; got \`${id}\`.`,
      );
    }
    ids.push(locatedValue(id, cur.sourceFile, raw.value.line));
  }
  return { ok: true, value: ids };
}

function parseFixedAnchors(
  metadata: AnalysisMetadata,
  cur: Cursor,
  blockLine: number,
  blockId: string,
): ParseResult<ASTAnalysisFixedAnchor[]> {
  const raw = requiredText(
    metadata,
    "Fixed Anchors",
    cur,
    blockLine,
    "analysisOrderMissingFixedAnchors",
    `Order board ${blockId} requires Fixed Anchors.`,
    "analysisOrderBlankFixedAnchors",
  );
  if (!raw.ok) return raw;
  const items = parseListItems(
    raw.value.value,
    cur.sourceFile,
    raw.value.line,
    "Fixed Anchors",
  );
  if (!items.ok) return items;
  const anchors: ASTAnalysisFixedAnchor[] = [];
  for (const item of items.value) {
    const match = /^([a-z0-9_]+)@([1-9][0-9]*)$/.exec(item);
    const position = match?.[2] === undefined ? Number.NaN : Number(match[2]);
    if (!match || !Number.isSafeInteger(position)) {
      return fail(
        cur.sourceFile,
        raw.value.line,
        "analysisFixedAnchorMalformed",
        `Fixed Anchors entries must use <cardId>@<one-based integer>; got \`${item}\`.`,
      );
    }
    anchors.push({
      cardId: match[1] ?? "",
      position,
      sourceFile: cur.sourceFile,
      line: raw.value.line,
    });
  }
  return { ok: true, value: anchors };
}

function parseIntegerMetadata(
  metadata: AnalysisMetadata,
  key: string,
  cur: Cursor,
  blockLine: number,
  blockId: string,
): ParseResult<Located<{ value: number }>> {
  const raw = requiredText(
    metadata,
    key,
    cur,
    blockLine,
    "analysisThresholdMissingInteger",
    `Threshold board ${blockId} requires ${key}.`,
    "analysisThresholdBlankInteger",
  );
  if (!raw.ok) return raw;
  if (!/^-?\d+$/.test(raw.value.value)) {
    return fail(
      cur.sourceFile,
      raw.value.line,
      "analysisThresholdInvalidInteger",
      `${key} must be a base-10 integer; got \`${raw.value.value}\`.`,
    );
  }
  const value = Number(raw.value.value);
  if (!Number.isSafeInteger(value)) {
    return fail(
      cur.sourceFile,
      raw.value.line,
      "analysisThresholdInvalidInteger",
      `${key} must be a safe base-10 integer; got \`${raw.value.value}\`.`,
    );
  }
  return {
    ok: true,
    value: locatedValue(value, cur.sourceFile, raw.value.line),
  };
}

function parseEnumMetadata<T extends string>(
  metadata: AnalysisMetadata,
  key: string,
  allowed: ReadonlySet<T>,
  cur: Cursor,
  blockLine: number,
  blockId: string,
  invalidCode: string,
): ParseResult<Array<Located<{ value: T }>>> {
  const raw = requiredText(
    metadata,
    key,
    cur,
    blockLine,
    "analysisThresholdMissingList",
    `Threshold board ${blockId} requires ${key}.`,
    "analysisThresholdBlankList",
  );
  if (!raw.ok) return raw;
  const items = parseListItems(
    raw.value.value,
    cur.sourceFile,
    raw.value.line,
    key,
  );
  if (!items.ok) return items;
  const values: Array<Located<{ value: T }>> = [];
  for (const item of items.value) {
    if (!allowed.has(item as T)) {
      return fail(
        cur.sourceFile,
        raw.value.line,
        invalidCode,
        `${key} has unsupported value \`${item}\`.`,
      );
    }
    values.push(locatedValue(item as T, cur.sourceFile, raw.value.line));
  }
  return { ok: true, value: values };
}

function parseBooleanMetadata(
  metadata: AnalysisMetadata,
  key: string,
  cur: Cursor,
  blockLine: number,
  blockId: string,
): ParseResult<Located<{ value: boolean }>> {
  const raw = requiredText(
    metadata,
    key,
    cur,
    blockLine,
    "analysisThresholdMissingBoolean",
    `Threshold board ${blockId} requires ${key}.`,
    "analysisThresholdBlankBoolean",
  );
  if (!raw.ok) return raw;
  if (raw.value.value !== "true" && raw.value.value !== "false") {
    return fail(
      cur.sourceFile,
      raw.value.line,
      "analysisThresholdInvalidBoolean",
      `${key} must be \`true\` or \`false\`; got \`${raw.value.value}\`.`,
    );
  }
  return {
    ok: true,
    value: locatedValue(
      raw.value.value === "true",
      cur.sourceFile,
      raw.value.line,
    ),
  };
}

function parseStoryReveals(
  raw: string,
  sourceFile: string,
  line: number,
): ParseResult<StoryRevealTarget[]> {
  const parsed = parseRevealsList({
    family: "investigation",
    raw,
    sourceFile,
    line,
  });
  if (!parsed.ok) return parsed;

  const storyTargets: StoryRevealTarget[] = [];
  for (const target of parsed.value) {
    if (!isStoryRevealTarget(target)) {
      return fail(
        sourceFile,
        line,
        "analysisBoardNonStoryReveal",
        `Analysis-board Reveals may contain only story reveal targets; got ${target.kind}${
          "id" in target && typeof target.id === "string"
            ? ` (${target.id})`
            : ""
        }.`,
      );
    }
    storyTargets.push(target);
  }
  return { ok: true, value: storyTargets };
}

function isStoryRevealTarget(
  target: InvestigationRevealTarget,
): target is StoryRevealTarget {
  return (
    target.kind === "assertFact" ||
    target.kind === "revealQuestion" ||
    target.kind === "resolveQuestion" ||
    target.kind === "revealObjective" ||
    target.kind === "completeObjective" ||
    target.kind === "setPrimaryObjective" ||
    target.kind === "grantAuthorization"
  );
}

function parseBoardKind(
  value: Located<{ value: string }>,
  sourceFile: string,
): ParseResult<BoardKind> {
  if (
    value.value === "classify" ||
    value.value === "order" ||
    value.value === "threshold"
  ) {
    return { ok: true, value: value.value };
  }
  return fail(
    sourceFile,
    value.line,
    "analysisBoardInvalidKind",
    `Board Kind must be classify, order, or threshold; got \`${value.value}\`.`,
  );
}

function parseCardSource(
  raw: string,
  sourceFile: string,
  line: number,
): ParseResult<InventoryTarget> {
  const match = /^(evidence|statement):([a-z0-9_]+)$/.exec(raw);
  if (!match) {
    return fail(
      sourceFile,
      line,
      "analysisCardInvalidSource",
      `Card Source must be evidence:<id> or statement:<id>; got \`${raw}\`.`,
    );
  }
  return {
    ok: true,
    value: { kind: match[1] as InventoryTarget["kind"], id: match[2] ?? "" },
  };
}

function parseListItems(
  raw: string,
  sourceFile: string,
  line: number,
  key: string,
): ParseResult<string[]> {
  const match = /^\[(.*)\]$/.exec(raw.trim());
  if (!match) {
    return fail(
      sourceFile,
      line,
      "analysisListMalformed",
      `${key} must use [comma-separated values].`,
    );
  }
  const contents = (match[1] ?? "").trim();
  if (!contents) return { ok: true, value: [] };
  const items = contents.split(",").map((item) => item.trim());
  if (items.some((item) => !item)) {
    return fail(
      sourceFile,
      line,
      "analysisListMalformed",
      `${key} must not contain empty list entries.`,
    );
  }
  return { ok: true, value: items };
}

function consumeAnalysisMetadata(cur: Cursor): ParseResult<AnalysisMetadata> {
  const start = cur.i;
  const metadata = consumeMetadata(cur);
  if (!metadata.ok) return metadata;

  const lines: Record<string, number> = {};
  for (const token of cur.tokens.slice(start, cur.i)) {
    if (token.kind !== "metadata") continue;
    if (lines[token.key] !== undefined) {
      return fail(
        cur.sourceFile,
        token.line,
        "analysisMetadataDuplicate",
        `Metadata key ${token.key} may appear only once in a block.`,
      );
    }
    lines[token.key] = token.line;
  }

  return { ok: true, value: { values: metadata.value, lines } };
}

function rejectUnknownMetadata(
  metadata: AnalysisMetadata,
  allowed: ReadonlySet<string>,
  sourceFile: string,
  fallbackLine: number,
  scope: string,
): ParseResult<void> {
  for (const key of Object.keys(metadata.values)) {
    if (allowed.has(key)) continue;
    return fail(
      sourceFile,
      metadataLine(metadata, key, fallbackLine),
      "analysisMetadataUnknownKey",
      `${scope} does not allow metadata key ${key}.`,
    );
  }
  return { ok: true, value: undefined };
}

function requiredText(
  metadata: AnalysisMetadata,
  key: string,
  cur: Cursor,
  fallbackLine: number,
  missingCode: string,
  missingMessage: string,
  blankCode: string,
): ParseResult<Located<{ value: string }>> {
  const value = metadata.values[key];
  if (value !== undefined && value.trim()) {
    return {
      ok: true,
      value: locatedValue(
        value,
        cur.sourceFile,
        metadataLine(metadata, key, fallbackLine),
      ),
    };
  }
  const blank = blankMetadataToken(cur.peek(), key);
  if (blank) {
    return fail(
      cur.sourceFile,
      blank.line,
      blankCode,
      `${key} must not be blank.`,
    );
  }
  return fail(cur.sourceFile, fallbackLine, missingCode, missingMessage);
}

function blankMetadataToken(
  token: Token | undefined,
  key: string,
): Extract<Token, { kind: "unknown" }> | null {
  if (!token || token.kind !== "unknown") return null;
  const match = BLANK_METADATA_RE.exec(token.text);
  return match?.[1] === key ? token : null;
}

function metadataLine(
  metadata: AnalysisMetadata,
  key: string,
  fallbackLine: number,
): number {
  return metadata.lines[key] ?? fallbackLine;
}

function locatedValue<T>(
  value: T,
  sourceFile: string,
  line: number,
): Located<{ value: T }> {
  return { value, sourceFile, line };
}

function fail(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): { ok: false; error: CompileError } {
  return parseFailure(sourceFile, line, code, message);
}
