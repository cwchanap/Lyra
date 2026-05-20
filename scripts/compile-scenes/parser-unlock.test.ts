import { describe, expect, it } from "bun:test";
import { parseInterrogationUnlockExpr, parseUnlockExpr } from "./parser-unlock";
import type { UnlockExpr } from "./types";

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
    const result = parseUnlockExpr("topic:witness@motive discussed", "test.md", 5);
    expect(result).toEqual({
      ok: true,
      value: { predicate: "topic_discussed", characterId: "witness", topicId: "motive" },
    });
  });

  it("parses a hotspot_investigated predicate", () => {
    const result = parseUnlockExpr("hotspot:back_door investigated", "test.md", 5);
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

  it("rejects an unknown predicate kind", () => {
    const result = parseUnlockExpr("foo:bar baz", "test.md", 5);
    expect(result.ok).toBe(false);
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

  it("keeps interrogation unlocks limited to inventory, question, and phase predicates", () => {
    const result = parseInterrogationUnlockExpr(
      "hotspot:counter investigated",
      "interrogation_scene_2.md",
      20,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unlockUnknownPredicate");
  });
});
