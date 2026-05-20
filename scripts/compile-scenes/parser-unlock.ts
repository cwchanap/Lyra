// =============================================================================
// scripts/compile-scenes/parser-unlock.ts
//
// Recursive-descent parser for Unlock: expressions.
//
// Investigation grammar:
//   expr  := or
//   or    := and ( "or" and )*
//   and   := atom ( "and" atom )*
//   atom  := "(" expr ")" | predicate
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

import type { CompileError, InterrogationUnlockExpr, UnlockExpr } from "./types";

export type ParseResult =
  | { ok: true; value: UnlockExpr }
  | { ok: false; error: CompileError };

export type InterrogationParseResult =
  | { ok: true; value: InterrogationUnlockExpr }
  | { ok: false; error: CompileError };

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
        /\s|[()]/.test(this.src[this.i + word.length] ?? ""))
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
    while (this.i < this.src.length && /\s/.test(this.src[this.i] ?? "")) this.i++;
  }
}

export function parseUnlockExpr(
  source: string,
  sourceFile: string,
  line: number,
): ParseResult {
  const tokens = new Tokens(source.trim(), sourceFile, line);
  if (tokens.atEnd()) {
    return failure(sourceFile, line, "unlockEmpty", "Unlock expression is empty.");
  }
  const expr = parseOr(tokens);
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

export function parseInterrogationUnlockExpr(
  source: string,
  sourceFile: string,
  line: number,
): InterrogationParseResult {
  const tokens = new Tokens(source.trim(), sourceFile, line);
  if (tokens.atEnd()) {
    return failure(sourceFile, line, "unlockEmpty", "Unlock expression is empty.");
  }
  const expr = parseInterrogationOr(tokens);
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

function parseOr(t: Tokens): ParseResult {
  let left = parseAnd(t);
  if (!left.ok) return left;
  while (t.consumeWord("or")) {
    const right = parseAnd(t);
    if (!right.ok) return right;
    left = { ok: true, value: { op: "or", left: left.value, right: right.value } };
  }
  return left;
}

function parseAnd(t: Tokens): ParseResult {
  let left = parseAtom(t);
  if (!left.ok) return left;
  while (t.consumeWord("and")) {
    const right = parseAtom(t);
    if (!right.ok) return right;
    left = { ok: true, value: { op: "and", left: left.value, right: right.value } };
  }
  return left;
}

function parseAtom(t: Tokens): ParseResult {
  if (t.consume("(")) {
    const inner = parseOr(t);
    if (!inner.ok) return inner;
    if (!t.consume(")")) {
      return failure(t.sourceFile, t.line, "unlockUnclosedParen", "Missing closing paren.");
    }
    return inner;
  }
  return parsePredicate(t);
}

function parsePredicate(t: Tokens): ParseResult {
  if (t.consume("evidence:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing evidence id.");
    if (!t.consumeWord("collected"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "collected" after evidence:${id}.`);
    return { ok: true, value: { predicate: "evidence_collected", id } };
  }
  if (t.consume("statement:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing statement id.");
    if (!t.consumeWord("acquired"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "acquired" after statement:${id}.`);
    return { ok: true, value: { predicate: "statement_acquired", id } };
  }
  if (t.consume("topic:")) {
    const characterId = t.consumeId();
    if (!characterId) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing character id in topic predicate.");
    if (!t.consume("@"))
      return failure(t.sourceFile, t.line, "unlockMissingTopicSeparator", "Topic predicates require <character>@<topic>.");
    const topicId = t.consumeId();
    if (!topicId) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing topic id in topic predicate.");
    if (!t.consumeWord("discussed"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "discussed" after topic:${characterId}@${topicId}.`);
    return { ok: true, value: { predicate: "topic_discussed", characterId, topicId } };
  }
  if (t.consume("hotspot:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing hotspot id.");
    if (!t.consumeWord("investigated"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "investigated" after hotspot:${id}.`);
    return { ok: true, value: { predicate: "hotspot_investigated", id } };
  }
  return failure(
    t.sourceFile,
    t.line,
    "unlockUnknownPredicate",
    `Unknown predicate prefix at: "${t.peek()}"`,
  );
}

function parseInterrogationOr(t: Tokens): InterrogationParseResult {
  let left = parseInterrogationAnd(t);
  if (!left.ok) return left;
  while (t.consumeWord("or")) {
    const right = parseInterrogationAnd(t);
    if (!right.ok) return right;
    left = { ok: true, value: { op: "or", left: left.value, right: right.value } };
  }
  return left;
}

function parseInterrogationAnd(t: Tokens): InterrogationParseResult {
  let left = parseInterrogationAtom(t);
  if (!left.ok) return left;
  while (t.consumeWord("and")) {
    const right = parseInterrogationAtom(t);
    if (!right.ok) return right;
    left = { ok: true, value: { op: "and", left: left.value, right: right.value } };
  }
  return left;
}

function parseInterrogationAtom(t: Tokens): InterrogationParseResult {
  if (t.consume("(")) {
    const inner = parseInterrogationOr(t);
    if (!inner.ok) return inner;
    if (!t.consume(")")) {
      return failure(t.sourceFile, t.line, "unlockUnclosedParen", "Missing closing paren.");
    }
    return inner;
  }
  return parseInterrogationPredicate(t);
}

function parseInterrogationPredicate(t: Tokens): InterrogationParseResult {
  if (t.consume("evidence:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing evidence id.");
    if (!t.consumeWord("collected"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "collected" after evidence:${id}.`);
    return { ok: true, value: { predicate: "evidence_collected", id } };
  }
  if (t.consume("statement:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing statement id.");
    if (!t.consumeWord("acquired"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "acquired" after statement:${id}.`);
    return { ok: true, value: { predicate: "statement_acquired", id } };
  }
  if (t.consume("question:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing question id.");
    if (!t.consumeWord("answered"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "answered" after question:${id}.`);
    return { ok: true, value: { predicate: "question_answered", id } };
  }
  if (t.consume("phase:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing phase id.");
    if (!t.consumeWord("completed"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "completed" after phase:${id}.`);
    return { ok: true, value: { predicate: "phase_completed", id } };
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
