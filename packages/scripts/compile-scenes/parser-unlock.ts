// =============================================================================
// packages/scripts/compile-scenes/parser-unlock.ts
//
// Recursive-descent parser for Unlock: expressions.
//
// Investigation grammar:
//   expr  := or
//   or    := and ( "or" and )*
//   and   := atom ( "and" atom )*
//   atom  := "(" expr ")" | at_least | predicate
//   at_least := "at_least" "(" count "," expr ("," expr)* ")"
//   pred  := "evidence:"  ID " collected"
//          | "statement:" ID " acquired"
//          | "topic:"     ID "@" ID " discussed"
//          | "hotspot:"   ID " investigated"
//
// Interrogation grammar uses the same operators and parentheses, with predicates:
//   pred  := "evidence:"   ID " collected"
//          | "statement:"  ID " acquired"
//          | "question:"   ID " answered"
//          | "phase:"      ID " completed"
//
// Operator precedence: `and` binds tighter than `or`.
// =============================================================================

import type {
  CompileError,
  InterrogationLocalPredicate,
  InterrogationUnlockExpr,
  InvestigationLocalPredicate,
  PositiveExpression,
  StoryPredicate,
  UnlockExpr,
} from "./types";

export type ParseResult =
  | { ok: true; value: UnlockExpr }
  | { ok: false; error: CompileError };

export type InterrogationParseResult =
  | { ok: true; value: InterrogationUnlockExpr }
  | { ok: false; error: CompileError };

type PositiveParseResult<P> =
  | { ok: true; value: PositiveExpression<P> }
  | { ok: false; error: CompileError };

type PredicateParseResult<P> =
  | { ok: true; value: P }
  | { ok: false; error: CompileError };

type PredicateParser<P> = (tokens: Tokens) => PredicateParseResult<P>;

const ID_RE = /[a-z0-9_]+/y;

class Tokens {
  private i = 0;
  constructor(
    private readonly src: string,
    public readonly sourceFile: string,
    public readonly line: number,
  ) {}
  peek(): string {
    this.skipWs();
    return this.src.slice(this.i);
  }
  consume(literal: string): boolean {
    this.skipWs();
    if (this.src.startsWith(literal, this.i)) {
      this.i += literal.length;
      return true;
    }
    return false;
  }
  consumeWord(word: string): boolean {
    this.skipWs();
    if (
      this.src.startsWith(word, this.i) &&
      (this.i + word.length === this.src.length ||
        /\s|[(),]/.test(this.src[this.i + word.length] ?? ""))
    ) {
      this.i += word.length;
      return true;
    }
    return false;
  }
  consumeId(): string | null {
    this.skipWs();
    ID_RE.lastIndex = this.i;
    const m = ID_RE.exec(this.src);
    if (!m || m.index !== this.i) return null;
    this.i += m[0].length;
    return m[0];
  }
  atEnd(): boolean {
    this.skipWs();
    return this.i >= this.src.length;
  }
  private skipWs() {
    while (this.i < this.src.length && /\s/.test(this.src[this.i] ?? ""))
      this.i++;
  }
}

export function parseUnlockExpr(
  source: string,
  sourceFile: string,
  line: number,
): ParseResult {
  return parsePositiveExpression(
    source,
    sourceFile,
    line,
    parseInvestigationPredicate,
  );
}

export function parseInterrogationUnlockExpr(
  source: string,
  sourceFile: string,
  line: number,
): InterrogationParseResult {
  return parsePositiveExpression(
    source,
    sourceFile,
    line,
    parseInterrogationPredicate,
  );
}

function parsePositiveExpression<P>(
  source: string,
  sourceFile: string,
  line: number,
  parsePredicate: PredicateParser<P>,
): PositiveParseResult<P> {
  const tokens = new Tokens(source.trim(), sourceFile, line);
  if (tokens.atEnd()) {
    return failure(
      sourceFile,
      line,
      "unlockEmpty",
      "Unlock expression is empty.",
    );
  }
  const expr = parseOr(tokens, parsePredicate);
  if (!expr.ok) return expr;
  if (!tokens.atEnd()) {
    return failure(
      sourceFile,
      line,
      "unlockTrailing",
      `Trailing tokens after parsed expression: "${tokens.peek()}"`,
    );
  }
  return expr;
}

function parseOr<P>(
  t: Tokens,
  parsePredicate: PredicateParser<P>,
): PositiveParseResult<P> {
  let left = parseAnd(t, parsePredicate);
  if (!left.ok) return left;
  while (t.consumeWord("or")) {
    const right = parseAnd(t, parsePredicate);
    if (!right.ok) return right;
    left = {
      ok: true,
      value: { op: "or", left: left.value, right: right.value },
    };
  }
  return left;
}

function parseAnd<P>(
  t: Tokens,
  parsePredicate: PredicateParser<P>,
): PositiveParseResult<P> {
  let left = parseAtom(t, parsePredicate);
  if (!left.ok) return left;
  while (t.consumeWord("and")) {
    const right = parseAtom(t, parsePredicate);
    if (!right.ok) return right;
    left = {
      ok: true,
      value: { op: "and", left: left.value, right: right.value },
    };
  }
  return left;
}

function parseAtom<P>(
  t: Tokens,
  parsePredicate: PredicateParser<P>,
): PositiveParseResult<P> {
  if (t.consume("(")) {
    const inner = parseOr(t, parsePredicate);
    if (!inner.ok) return inner;
    if (!t.consume(")")) {
      return failure(
        t.sourceFile,
        t.line,
        "unlockUnclosedParen",
        "Missing closing paren.",
      );
    }
    return inner;
  }
  if (t.consumeWord("at_least")) return parseAtLeast(t, parsePredicate);
  return parsePredicate(t);
}

function parseAtLeast<P>(
  t: Tokens,
  parsePredicate: PredicateParser<P>,
): PositiveParseResult<P> {
  if (!t.consume("(")) {
    return failure(
      t.sourceFile,
      t.line,
      "unlockAtLeastMissingParen",
      "at_least requires a parenthesized argument list.",
    );
  }

  const countText = t.consumeId();
  const count = countText == null ? Number.NaN : Number(countText);
  if (
    countText == null ||
    !/^[0-9]+$/.test(countText) ||
    !Number.isSafeInteger(count) ||
    count < 1
  ) {
    return failure(
      t.sourceFile,
      t.line,
      "unlockAtLeastInvalidCount",
      "at_least count must be a positive base-10 integer.",
    );
  }

  if (!t.consume(",")) {
    return failure(
      t.sourceFile,
      t.line,
      "unlockAtLeastEmptyConditions",
      "at_least requires at least one condition.",
    );
  }

  const conditions: PositiveExpression<P>[] = [];
  while (true) {
    if (t.consume(")")) {
      return failure(
        t.sourceFile,
        t.line,
        "unlockAtLeastEmptyConditions",
        "at_least requires at least one condition.",
      );
    }

    const condition = parseOr(t, parsePredicate);
    if (!condition.ok) return condition;
    conditions.push(condition.value);

    if (t.consume(")")) break;
    if (!t.consume(",")) {
      return failure(
        t.sourceFile,
        t.line,
        "unlockUnclosedParen",
        "Missing closing paren.",
      );
    }
  }

  if (count > conditions.length) {
    return failure(
      t.sourceFile,
      t.line,
      "unlockAtLeastCountExceedsConditions",
      "at_least count exceeds its number of conditions.",
    );
  }

  const seenConditions = new Set<string>();
  for (const condition of conditions) {
    const key = JSON.stringify(condition);
    if (seenConditions.has(key)) {
      return failure(
        t.sourceFile,
        t.line,
        "unlockAtLeastDuplicateCondition",
        "at_least conditions must not contain structural duplicates.",
      );
    }
    seenConditions.add(key);
  }

  return { ok: true, value: { op: "at_least", count, conditions } };
}

function parseInvestigationPredicate(
  t: Tokens,
): PredicateParseResult<InvestigationLocalPredicate | StoryPredicate> {
  const predicateSource = t.peek();
  if (t.consume("evidence:")) {
    const id = t.consumeId();
    if (!id)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing evidence id.",
      );
    if (!t.consumeWord("collected"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "collected" after evidence:${id}.`,
      );
    return { ok: true, value: { predicate: "evidence_collected", id } };
  }
  if (t.consume("statement:")) {
    const id = t.consumeId();
    if (!id)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing statement id.",
      );
    if (!t.consumeWord("acquired"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "acquired" after statement:${id}.`,
      );
    return { ok: true, value: { predicate: "statement_acquired", id } };
  }
  if (t.consume("topic:")) {
    const characterId = t.consumeId();
    if (!characterId)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing character id in topic predicate.",
      );
    if (!t.consume("@"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingTopicSeparator",
        "Topic predicates require <character>@<topic>.",
      );
    const topicId = t.consumeId();
    if (!topicId)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing topic id in topic predicate.",
      );
    if (!t.consumeWord("discussed"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "discussed" after topic:${characterId}@${topicId}.`,
      );
    return {
      ok: true,
      value: { predicate: "topic_discussed", characterId, topicId },
    };
  }
  if (t.consume("hotspot:")) {
    const id = t.consumeId();
    if (!id)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing hotspot id.",
      );
    if (!t.consumeWord("investigated"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "investigated" after hotspot:${id}.`,
      );
    return { ok: true, value: { predicate: "hotspot_investigated", id } };
  }
  if (t.consume("question:")) {
    const id = t.consumeId();
    if (id && t.consumeWord("resolved")) {
      return { ok: true, value: { predicate: "question_resolved", id } };
    }
    return failure(
      t.sourceFile,
      t.line,
      "unlockUnknownPredicate",
      `Unknown predicate prefix at: "${predicateSource}"`,
    );
  }
  return parseStoryPredicate(t);
}

function parseInterrogationPredicate(
  t: Tokens,
): PredicateParseResult<InterrogationLocalPredicate | StoryPredicate> {
  if (t.consume("evidence:")) {
    const id = t.consumeId();
    if (!id)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing evidence id.",
      );
    if (!t.consumeWord("collected"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "collected" after evidence:${id}.`,
      );
    return { ok: true, value: { predicate: "evidence_collected", id } };
  }
  if (t.consume("statement:")) {
    const id = t.consumeId();
    if (!id)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing statement id.",
      );
    if (!t.consumeWord("acquired"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "acquired" after statement:${id}.`,
      );
    return { ok: true, value: { predicate: "statement_acquired", id } };
  }
  if (t.consume("question:")) {
    const id = t.consumeId();
    if (!id)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing question id.",
      );
    if (t.consumeWord("answered")) {
      return { ok: true, value: { predicate: "question_answered", id } };
    }
    if (t.consumeWord("resolved")) {
      return { ok: true, value: { predicate: "question_resolved", id } };
    }
    return failure(
      t.sourceFile,
      t.line,
      "unlockMissingVerb",
      `Expected "answered" after question:${id}.`,
    );
  }
  if (t.consume("phase:")) {
    const id = t.consumeId();
    if (!id)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing phase id.",
      );
    if (!t.consumeWord("completed"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "completed" after phase:${id}.`,
      );
    return { ok: true, value: { predicate: "phase_completed", id } };
  }
  return parseStoryPredicate(t);
}

function parseStoryPredicate(t: Tokens): PredicateParseResult<StoryPredicate> {
  if (t.consume("fact:")) {
    const id = t.consumeId();
    if (!id)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing fact id.",
      );
    if (!t.consumeWord("asserted"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "asserted" after fact:${id}.`,
      );
    return { ok: true, value: { predicate: "fact_asserted", id } };
  }
  if (t.consume("objective:")) {
    const id = t.consumeId();
    if (!id)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing objective id.",
      );
    if (!t.consumeWord("completed"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "completed" after objective:${id}.`,
      );
    return { ok: true, value: { predicate: "objective_completed", id } };
  }
  if (t.consume("authorization:")) {
    const id = t.consumeId();
    if (!id)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing authorization id.",
      );
    if (!t.consumeWord("granted"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "granted" after authorization:${id}.`,
      );
    return { ok: true, value: { predicate: "authorization_granted", id } };
  }
  if (t.consume("analysis_scene:")) {
    const chapterId = t.consumeId();
    if (!chapterId)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing analysis scene chapter id.",
      );
    if (!t.consume("@"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingAnalysisSeparator",
        "Analysis scene predicates require <chapter>@<scene>.",
      );
    const sceneId = t.consumeId();
    if (!sceneId)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing analysis scene id.",
      );
    if (!t.consumeWord("completed"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "completed" after analysis_scene:${chapterId}@${sceneId}.`,
      );
    return {
      ok: true,
      value: { predicate: "analysis_scene_completed", chapterId, sceneId },
    };
  }
  if (t.consume("analysis_board:")) {
    const chapterId = t.consumeId();
    if (!chapterId)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing analysis board chapter id.",
      );
    if (!t.consume("@"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingAnalysisSeparator",
        "Analysis board predicates require <chapter>@<scene>@<board>.",
      );
    const sceneId = t.consumeId();
    if (!sceneId)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing analysis board scene id.",
      );
    if (!t.consume("@"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingAnalysisSeparator",
        "Analysis board predicates require <chapter>@<scene>@<board>.",
      );
    const boardId = t.consumeId();
    if (!boardId)
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingId",
        "Missing analysis board id.",
      );
    if (!t.consumeWord("completed"))
      return failure(
        t.sourceFile,
        t.line,
        "unlockMissingVerb",
        `Expected "completed" after analysis_board:${chapterId}@${sceneId}@${boardId}.`,
      );
    return {
      ok: true,
      value: {
        predicate: "analysis_board_completed",
        chapterId,
        sceneId,
        boardId,
      },
    };
  }
  return failure(
    t.sourceFile,
    t.line,
    "unlockUnknownPredicate",
    `Unknown predicate prefix at: "${t.peek()}"`,
  );
}

function failure(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): { ok: false; error: CompileError } {
  return { ok: false, error: { code, message, sourceFile, line } };
}
