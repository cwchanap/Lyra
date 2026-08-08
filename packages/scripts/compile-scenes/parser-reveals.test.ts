import { describe, expect, it } from "vitest";
import { parseRevealsList } from "./parser-reveals";

describe("parseRevealsList", () => {
  it("parses ordered investigation story targets", () => {
    expect(
      parseRevealsList({
        family: "investigation",
        raw: "[assert_fact:door_conflict, resolve_question:who_entered@door_conflict, set_primary_objective:present_request; complete_current]",
        sourceFile: "scene.md",
        line: 10,
      }),
    ).toEqual({
      ok: true,
      value: [
        { kind: "assertFact", factId: "door_conflict" },
        {
          kind: "resolveQuestion",
          questionId: "who_entered",
          factId: "door_conflict",
        },
        {
          kind: "setPrimaryObjective",
          nextObjectiveId: "present_request",
          completeCurrent: true,
        },
      ],
    });
  });

  it.each([
    [
      "assert_fact:door_conflict",
      { kind: "assertFact", factId: "door_conflict" },
    ],
    [
      "reveal_question:who_entered",
      { kind: "revealQuestion", questionId: "who_entered" },
    ],
    [
      "resolve_question:who_entered@door_conflict",
      {
        kind: "resolveQuestion",
        questionId: "who_entered",
        factId: "door_conflict",
      },
    ],
    [
      "reveal_objective:prepare_request",
      { kind: "revealObjective", objectiveId: "prepare_request" },
    ],
    [
      "complete_objective:prepare_request",
      { kind: "completeObjective", objectiveId: "prepare_request" },
    ],
    [
      "set_primary_objective:present_request",
      {
        kind: "setPrimaryObjective",
        nextObjectiveId: "present_request",
        completeCurrent: false,
      },
    ],
    [
      "grant_authorization:narrow_export",
      { kind: "grantAuthorization", authorizationId: "narrow_export" },
    ],
  ])("accepts story target %s in both scene families", (target, expected) => {
    for (const family of ["investigation", "interrogation"] as const) {
      expect(
        parseRevealsList({
          family,
          raw: `[${target}]`,
          sourceFile: `${family}.md`,
          line: 12,
        }),
      ).toEqual({ ok: true, value: [expected] });
    }
  });

  it("parses a null primary transition with complete_current", () => {
    expect(
      parseRevealsList({
        family: "interrogation",
        raw: "[set_primary_objective:null; complete_current]",
        sourceFile: "interrogation.md",
        line: 19,
      }),
    ).toEqual({
      ok: true,
      value: [
        {
          kind: "setPrimaryObjective",
          nextObjectiveId: null,
          completeCurrent: true,
        },
      ],
    });
  });

  it("rejects malformed primary-transition modifiers at the reveal location", () => {
    expect(
      parseRevealsList({
        family: "investigation",
        raw: "[set_primary_objective:present_request; leave_current]",
        sourceFile: "scene.md",
        line: 24,
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "storyRevealMalformedModifier",
        message:
          "set_primary_objective only accepts the optional `; complete_current` modifier. Got: set_primary_objective:present_request; leave_current",
        sourceFile: "scene.md",
        line: 24,
      },
    });
  });

  it("keeps local target families scoped with their legacy diagnostics", () => {
    expect(
      parseRevealsList({
        family: "investigation",
        raw: "[question:local_question]",
        sourceFile: "investigation.md",
        line: 8,
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "revealUnknownPrefix",
        message: "Unknown reveal target prefix: question:local_question",
        sourceFile: "investigation.md",
        line: 8,
      },
    });
    expect(
      parseRevealsList({
        family: "interrogation",
        raw: "[hotspot:counter]",
        sourceFile: "interrogation.md",
        line: 9,
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "interrogationRevealUnknownTarget",
        message: "Unknown interrogation reveal target: hotspot:counter",
        sourceFile: "interrogation.md",
        line: 9,
      },
    });
  });

  it("parses a tutorial practice-card reveal only for investigation scenes", () => {
    // Break caught: a Prologue Notebook card must be collectable from an
    // investigation hotspot, but it must not broaden interrogation evidence.
    expect(
      parseRevealsList({
        family: "investigation",
        raw: "[practice:p1_receipt_reprint]",
        sourceFile: "investigation.md",
        line: 11,
      }),
    ).toEqual({
      ok: true,
      value: [{ kind: "practice", id: "p1_receipt_reprint" }],
    });
    expect(
      parseRevealsList({
        family: "interrogation",
        raw: "[practice:p1_receipt_reprint]",
        sourceFile: "interrogation.md",
        line: 11,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "interrogationRevealUnknownTarget" },
    });
  });

  it("keeps local reveal duplicates in authored order", () => {
    expect(
      parseRevealsList({
        family: "investigation",
        raw: "[evidence:door_photo, evidence:door_photo]",
        sourceFile: "legacy.md",
        line: 13,
      }),
    ).toEqual({
      ok: true,
      value: [
        { kind: "evidence", id: "door_photo" },
        { kind: "evidence", id: "door_photo" },
      ],
    });
  });

  it("rejects exact normalized story-target duplicates", () => {
    expect(
      parseRevealsList({
        family: "investigation",
        raw: "[assert_fact:door_conflict, assert_fact:door_conflict]",
        sourceFile: "scene.md",
        line: 31,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "duplicateStoryRevealTarget",
        sourceFile: "scene.md",
        line: 31,
      },
    });
  });

  it("rejects conflicting resolvers for one question", () => {
    expect(
      parseRevealsList({
        family: "interrogation",
        raw: "[resolve_question:who_entered@door_conflict, resolve_question:who_entered@window_fact]",
        sourceFile: "interrogation.md",
        line: 36,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "conflictingQuestionResolution",
        sourceFile: "interrogation.md",
        line: 36,
      },
    });
  });

  it("rejects multiple distinct primary transitions", () => {
    expect(
      parseRevealsList({
        family: "investigation",
        raw: "[set_primary_objective:prepare_request, set_primary_objective:present_request]",
        sourceFile: "scene.md",
        line: 41,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "multiplePrimaryTransitions",
        sourceFile: "scene.md",
        line: 41,
      },
    });
  });
});
