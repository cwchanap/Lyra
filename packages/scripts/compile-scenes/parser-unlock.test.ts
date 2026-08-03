import { describe, expect, it } from "vitest";
import { parseInterrogationUnlockExpr, parseUnlockExpr } from "./parser-unlock";

describe("parseUnlockExpr", () => {
  it("parses a single evidence_collected predicate", () => {
    const result = parseUnlockExpr("evidence:coffee collected", "test.md", 5);
    expect(result).toEqual({
      ok: true,
      value: { predicate: "evidence_collected", id: "coffee" },
    });
  });

  it("parses a single statement_acquired predicate", () => {
    const result = parseUnlockExpr("statement:alibi acquired", "test.md", 5);
    expect(result).toEqual({
      ok: true,
      value: { predicate: "statement_acquired", id: "alibi" },
    });
  });

  it("parses a topic_discussed predicate with character@topic syntax", () => {
    const result = parseUnlockExpr(
      "topic:witness@motive discussed",
      "test.md",
      5,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        predicate: "topic_discussed",
        characterId: "witness",
        topicId: "motive",
      },
    });
  });

  it("parses a hotspot_investigated predicate", () => {
    const result = parseUnlockExpr(
      "hotspot:back_door investigated",
      "test.md",
      5,
    );
    expect(result).toEqual({
      ok: true,
      value: { predicate: "hotspot_investigated", id: "back_door" },
    });
  });

  it("parses an `and` combinator", () => {
    const result = parseUnlockExpr(
      "hotspot:a investigated and evidence:b collected",
      "test.md",
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      op: "and",
      left: { predicate: "hotspot_investigated", id: "a" },
      right: { predicate: "evidence_collected", id: "b" },
    });
  });

  it("parses an `or` combinator", () => {
    const result = parseUnlockExpr(
      "hotspot:a investigated or hotspot:b investigated",
      "test.md",
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      op: "or",
      left: { predicate: "hotspot_investigated", id: "a" },
      right: { predicate: "hotspot_investigated", id: "b" },
    });
  });

  it("respects precedence: and binds tighter than or", () => {
    // a and b or c   ===   (a and b) or c
    const result = parseUnlockExpr(
      "hotspot:a investigated and hotspot:b investigated or hotspot:c investigated",
      "test.md",
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      op: "or",
      left: {
        op: "and",
        left: { predicate: "hotspot_investigated", id: "a" },
        right: { predicate: "hotspot_investigated", id: "b" },
      },
      right: { predicate: "hotspot_investigated", id: "c" },
    });
  });

  it("keeps legacy binary trees left-associated", () => {
    expect(
      parseUnlockExpr(
        "hotspot:a investigated and hotspot:b investigated and hotspot:c investigated",
        "legacy.md",
        17,
      ),
    ).toEqual({
      ok: true,
      value: {
        op: "and",
        left: {
          op: "and",
          left: { predicate: "hotspot_investigated", id: "a" },
          right: { predicate: "hotspot_investigated", id: "b" },
        },
        right: { predicate: "hotspot_investigated", id: "c" },
      },
    });
  });

  it("parses nested at_least with no whitespace around commas", () => {
    expect(
      parseUnlockExpr(
        "at_least(2,hotspot:a investigated,at_least(1,evidence:b collected))",
        "threshold.md",
        8,
      ),
    ).toEqual({
      ok: true,
      value: {
        op: "at_least",
        count: 2,
        conditions: [
          { predicate: "hotspot_investigated", id: "a" },
          {
            op: "at_least",
            count: 1,
            conditions: [{ predicate: "evidence_collected", id: "b" }],
          },
        ],
      },
    });
  });

  it.each([
    ["at_least(0,hotspot:a investigated)", "unlockAtLeastInvalidCount"],
    [
      "at_least(2,hotspot:a investigated)",
      "unlockAtLeastCountExceedsConditions",
    ],
    ["at_least(1)", "unlockAtLeastEmptyConditions"],
    [
      "at_least(2,hotspot:a investigated,hotspot:a investigated)",
      "unlockAtLeastDuplicateCondition",
    ],
  ])("rejects invalid threshold %s", (source, code) => {
    const result = parseUnlockExpr(source, "threshold.md", 9);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it("rejects structural duplicates after parentheses are discarded", () => {
    expect(
      parseUnlockExpr(
        "at_least(2,hotspot:a investigated,(hotspot:a investigated))",
        "threshold.md",
        10,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "unlockAtLeastDuplicateCondition" },
    });
  });

  it("keeps generic predicate diagnostics at the supplied source location", () => {
    expect(parseUnlockExpr("foo:bar baz", "legacy.md", 19)).toEqual({
      ok: false,
      error: {
        code: "unlockUnknownPredicate",
        message: 'Unknown predicate prefix at: "foo:bar baz"',
        sourceFile: "legacy.md",
        line: 19,
      },
    });
  });

  it("rejects malformed input", () => {
    const result = parseUnlockExpr("evidence: collected", "test.md", 5);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = parseUnlockExpr("", "test.md", 5);
    expect(result.ok).toBe(false);
  });
});

describe("parseInterrogationUnlockExpr", () => {
  it.each([
    [
      "evidence:coffee_receipt collected",
      { predicate: "evidence_collected", id: "coffee_receipt" },
    ],
    [
      "statement:witness_alibi acquired",
      { predicate: "statement_acquired", id: "witness_alibi" },
    ],
    [
      "question:hidden_discarded_beans answered",
      { predicate: "question_answered", id: "hidden_discarded_beans" },
    ],
    [
      "phase:wakatsuki_inquiry completed",
      { predicate: "phase_completed", id: "wakatsuki_inquiry" },
    ],
  ])("parses allowed interrogation predicate form %s", (source, value) => {
    const result = parseInterrogationUnlockExpr(
      source,
      "interrogation_scene_2.md",
      10,
    );
    expect(result).toEqual({ ok: true, value });
  });

  it("parses question_answered and phase_completed predicates", () => {
    const result = parseInterrogationUnlockExpr(
      "question:hidden_discarded_beans answered and phase:wakatsuki_inquiry completed",
      "interrogation_scene_2.md",
      12,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        op: "and",
        left: { predicate: "question_answered", id: "hidden_discarded_beans" },
        right: { predicate: "phase_completed", id: "wakatsuki_inquiry" },
      },
    });
  });

  it("keeps parentheses authoritative", () => {
    const result = parseInterrogationUnlockExpr(
      "question:q answered and (phase:p completed or evidence:e collected)",
      "legacy.md",
      23,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ op: "and" });
  });

  it("keeps interrogation unlocks limited to inventory, question, and phase predicates", () => {
    expect(
      parseInterrogationUnlockExpr(
        "hotspot:counter investigated",
        "interrogation_scene_2.md",
        20,
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "unlockUnknownPredicate",
        message: 'Unknown predicate prefix at: "hotspot:counter investigated"',
        sourceFile: "interrogation_scene_2.md",
        line: 20,
      },
    });
  });
});
