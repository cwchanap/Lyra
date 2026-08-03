import { describe, expect, it } from "vitest";
import { createAnalysisDefinitionRegistry } from "./analysis-definition-registry";
import {
  analyzeReachability,
  buildReachabilityNodes,
  evaluateMay,
  evaluateMust,
  type ReachabilityNode,
} from "./reachability";
import type {
  ASTChapter,
  ASTHotspot,
  ASTInquiryPhase,
  ASTInquiryQuestion,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  ASTStoryCatalog,
  ASTSublocation,
  ASTTestimonyLine,
  InvestigationRevealTarget,
} from "./types";
import type { SceneRecord } from "./validator";

describe("buildReachabilityNodes", () => {
  it("normalizes initially available investigation peers as a complete free-order region", () => {
    const scene = investigationScene({
      sublocations: [
        sublocation("main", [
          hotspot("a", {
            reveals: [{ kind: "assertFact", factId: "fact_a" }],
          }),
          hotspot("b"),
        ]),
      ],
    });

    const nodesByKey = new Map(
      buildNodes(
        [chapter("chapter_1", ["investigation_scene_1.md"])],
        [record("chapter_1", "investigation_scene_1.md", scene)],
      ).map((node) => [node.key, node]),
    );

    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/hotspot:a"),
    ).toMatchObject({
      legacyCompatibilityMode: false,
      strictPredecessorKeys: ["chapter_1/investigation_scene_1/entry"],
      mayExecuteBeforeKeys: ["chapter_1/investigation_scene_1/hotspot:b"],
      freeOrderRegionId: "chapter_1/investigation_scene_1/main",
    });
    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/hotspot:b"),
    ).toMatchObject({
      legacyCompatibilityMode: true,
      strictPredecessorKeys: ["chapter_1/investigation_scene_1/entry"],
      mayExecuteBeforeKeys: ["chapter_1/investigation_scene_1/hotspot:a"],
      freeOrderRegionId: "chapter_1/investigation_scene_1/main",
    });
  });

  it("orders nodes by authored chapter and scene order while preserving target indexes", () => {
    const sceneOne = investigationScene({
      id: "investigation_scene_1",
      sublocations: [
        sublocation("main", [
          hotspot("a", {
            reveals: [
              { kind: "evidence", id: "receipt" },
              { kind: "assertFact", factId: "fact_a" },
              { kind: "statement", id: "witness_account" },
            ],
          }),
        ]),
      ],
    });
    const sceneTwo = investigationScene({
      id: "investigation_scene_2",
      sourceFile: "chapter_2/investigation_scene_2.md",
      sublocations: [sublocation("main", [hotspot("z")])],
    });
    const chapters = [
      chapter("chapter_2", ["investigation_scene_2.md"], 2),
      chapter("chapter_1", ["investigation_scene_1.md"], 1),
    ];
    const reversedRecords = [
      record("chapter_2", "investigation_scene_2.md", sceneTwo),
      record("chapter_1", "investigation_scene_1.md", sceneOne),
    ];

    const first = buildNodes(chapters, reversedRecords);
    const second = buildNodes(
      [...chapters].reverse(),
      [...reversedRecords].reverse(),
    );

    expect(first).toEqual(second);
    expect(first.map((node) => node.key)).toEqual([
      "chapter_1/investigation_scene_1/entry",
      "chapter_1/investigation_scene_1/hotspot:a",
      "chapter_1/investigation_scene_1/outro",
      "chapter_2/investigation_scene_2/entry",
      "chapter_2/investigation_scene_2/hotspot:z",
      "chapter_2/investigation_scene_2/outro",
    ]);
    expect(first[1]!.effects).toEqual([
      {
        kind: "addAtom",
        atom: "hotspot:chapter_1@investigation_scene_1@a",
        targetIndex: -1,
      },
      { kind: "addAtom", atom: "evidence:receipt", targetIndex: 0 },
      {
        kind: "story",
        target: { kind: "assertFact", factId: "fact_a" },
        targetIndex: 1,
      },
      {
        kind: "addAtom",
        atom: "statement:witness_account",
        targetIndex: 2,
      },
    ]);
  });

  it("does not leak may-before peers across unrelated sublocation regions", () => {
    const scene = investigationScene({
      sublocations: [
        sublocation("main", [hotspot("a")]),
        sublocation("annex", [hotspot("b")]),
      ],
    });

    const nodesByKey = new Map(
      buildNodes(
        [chapter("chapter_1", ["investigation_scene_1.md"])],
        [record("chapter_1", "investigation_scene_1.md", scene)],
      ).map((node) => [node.key, node]),
    );

    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/hotspot:a"),
    ).toMatchObject({
      mayExecuteBeforeKeys: [],
      freeOrderRegionId: "chapter_1/investigation_scene_1/main",
    });
    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/hotspot:b"),
    ).toMatchObject({
      mayExecuteBeforeKeys: [],
      freeOrderRegionId: "chapter_1/investigation_scene_1/annex",
    });
  });

  it("preserves specialized inbound-reveal ordering for sublocation entry", () => {
    const scene = investigationScene({
      sublocations: [
        sublocation("main", [
          hotspot("a", {
            reveals: [{ kind: "sublocation", id: "annex" }],
          }),
        ]),
        sublocation("annex", [hotspot("b")], { status: "locked" }),
      ],
    });

    const nodesByKey = new Map(
      buildNodes(
        [chapter("chapter_1", ["investigation_scene_1.md"])],
        [record("chapter_1", "investigation_scene_1.md", scene)],
      ).map((node) => [node.key, node]),
    );

    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/sublocation:annex"),
    ).toMatchObject({
      strictPredecessorKeys: [
        "chapter_1/investigation_scene_1/entry",
        "chapter_1/investigation_scene_1/hotspot:a",
      ],
    });
    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/hotspot:b"),
    ).toMatchObject({
      strictPredecessorKeys: [
        "chapter_1/investigation_scene_1/sublocation:annex",
      ],
    });
  });

  it("normalizes linear and scene-outro completion boundaries for strict scene sequencing", () => {
    const investigation = investigationScene({
      outro: {
        unlock: { predicate: "fact_asserted", id: "fact_a" },
        dialogue: [],
      },
    });
    const linear = linearScene("scene_2");

    const nodesByKey = new Map(
      buildNodes(
        [chapter("chapter_1", ["investigation_scene_1.md", "scene_2.md"])],
        [
          record("chapter_1", "investigation_scene_1.md", investigation),
          record("chapter_1", "scene_2.md", linear),
        ],
      ).map((node) => [node.key, node]),
    );

    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/outro"),
    ).toMatchObject({
      condition: {
        predicate: "atom",
        atom: "fact_asserted:fact_a",
      },
      legacyCompatibilityMode: false,
    });
    expect(nodesByKey.get("chapter_1/scene_2/entry")).toMatchObject({
      strictPredecessorKeys: ["chapter_1/investigation_scene_1/outro"],
    });
    expect(nodesByKey.get("chapter_1/scene_2/outro")).toMatchObject({
      strictPredecessorKeys: ["chapter_1/scene_2/entry"],
    });
  });

  it("separates interrogation phase entry, question breakthrough, phase completion, and outro", () => {
    const phase = inquiryPhase({
      reveals: [{ kind: "evidence", id: "entry_key" }],
      questions: [
        inquiryQuestion({
          id: "honest",
          reveals: [{ kind: "assertFact", factId: "fact_a" }],
        }),
      ],
    });
    const scene = interrogationScene([phase]);
    const nodesByKey = new Map(
      buildNodes(
        [chapter("chapter_1", ["interrogation_scene_1.md"])],
        [record("chapter_1", "interrogation_scene_1.md", scene)],
      ).map((node) => [node.key, node]),
    );

    expect(
      nodesByKey.get("chapter_1/interrogation_scene_1/phase:p:entry"),
    ).toMatchObject({
      implicitPrerequisites: [],
      effects: [
        { kind: "addAtom", atom: "evidence:entry_key", targetIndex: 0 },
      ],
      strictPredecessorKeys: ["chapter_1/interrogation_scene_1/entry"],
    });
    expect(
      nodesByKey.get("chapter_1/interrogation_scene_1/question:honest:entry"),
    ).toMatchObject({
      strictPredecessorKeys: ["chapter_1/interrogation_scene_1/phase:p:entry"],
    });
    expect(
      nodesByKey.get(
        "chapter_1/interrogation_scene_1/question:honest:breakthrough",
      ),
    ).toMatchObject({
      effects: [
        {
          kind: "story",
          target: { kind: "assertFact", factId: "fact_a" },
          targetIndex: 0,
        },
        {
          kind: "addAtom",
          atom: "question_answered:chapter_1@interrogation_scene_1@honest",
          targetIndex: 1,
        },
      ],
    });
    expect(
      nodesByKey.get("chapter_1/interrogation_scene_1/phase:p:complete"),
    ).toMatchObject({
      implicitPrerequisites: [
        {
          predicate: "atom",
          atom: "question_answered:chapter_1@interrogation_scene_1@honest",
        },
      ],
      strictPredecessorKeys: [
        "chapter_1/interrogation_scene_1/phase:p:entry",
        "chapter_1/interrogation_scene_1/question:honest:breakthrough",
      ],
      effects: [
        {
          kind: "addAtom",
          atom: "phase_completed:chapter_1@interrogation_scene_1@p",
          targetIndex: 0,
        },
      ],
    });
    expect(
      nodesByKey.get("chapter_1/interrogation_scene_1/outro"),
    ).toMatchObject({
      implicitPrerequisites: [
        {
          predicate: "atom",
          atom: "phase_completed:chapter_1@interrogation_scene_1@p",
        },
      ],
      strictPredecessorKeys: [
        "chapter_1/interrogation_scene_1/entry",
        "chapter_1/interrogation_scene_1/phase:p:complete",
      ],
    });
  });

  it("keeps each correct testimony alternative as one ordered breakthrough batch", () => {
    const question = inquiryQuestion({
      id: "contradiction",
      reveals: [{ kind: "revealObjective", objectiveId: "objective_a" }],
      testimonyLines: [
        testimonyLine("left", "left_key", [
          { kind: "assertFact", factId: "fact_a" },
        ]),
        testimonyLine("right", "right_key", [
          { kind: "revealQuestion", questionId: "question_a" },
        ]),
      ],
    });
    const scene = interrogationScene([inquiryPhase({ questions: [question] })]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const breakthroughs = nodes.filter((node) =>
      node.key.includes("question:contradiction:line:"),
    );

    expect(breakthroughs.map((node) => node.key)).toEqual([
      "chapter_1/interrogation_scene_1/question:contradiction:line:left:breakthrough",
      "chapter_1/interrogation_scene_1/question:contradiction:line:right:breakthrough",
    ]);
    expect(breakthroughs[0]!.effects).toEqual([
      {
        kind: "story",
        target: { kind: "assertFact", factId: "fact_a" },
        targetIndex: 0,
      },
      {
        kind: "story",
        target: { kind: "revealObjective", objectiveId: "objective_a" },
        targetIndex: 1,
      },
      {
        kind: "addAtom",
        atom: "question_answered:chapter_1@interrogation_scene_1@contradiction",
        targetIndex: 2,
      },
    ]);
    expect(
      nodes.some(
        (node) =>
          node.key ===
          "chapter_1/interrogation_scene_1/question:contradiction:breakthrough",
      ),
    ).toBe(false);
    expect(
      breakthroughs.map((node) => ({
        key: node.key,
        oneShotEventId: node.oneShotEventId,
        mayExecuteBeforeKeys: node.mayExecuteBeforeKeys,
        freeOrderRegionId: node.freeOrderRegionId,
      })),
    ).toEqual([
      {
        key: "chapter_1/interrogation_scene_1/question:contradiction:line:left:breakthrough",
        oneShotEventId:
          "chapter_1/interrogation_scene_1/question:contradiction:breakthrough",
        mayExecuteBeforeKeys: [],
        freeOrderRegionId: null,
      },
      {
        key: "chapter_1/interrogation_scene_1/question:contradiction:line:right:breakthrough",
        oneShotEventId:
          "chapter_1/interrogation_scene_1/question:contradiction:breakthrough",
        mayExecuteBeforeKeys: [],
        freeOrderRegionId: null,
      },
    ]);
    expect(new Set(breakthroughs.map((node) => node.oneShotEventId)).size).toBe(
      1,
    );
  });

  it("retains an explicit interrogation outro expression on its completion node", () => {
    const scene = interrogationScene([inquiryPhase()]);
    scene.outro = {
      unlock: { predicate: "objective_completed", id: "objective_a" },
      dialogue: [],
    };

    const outro = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    ).find((node) => node.key === "chapter_1/interrogation_scene_1/outro");

    expect(outro).toMatchObject({
      condition: {
        predicate: "atom",
        atom: "objective_completed:objective_a",
      },
      implicitPrerequisites: [],
      legacyCompatibilityMode: false,
    });
  });

  it("models interrogation question choices as free-order entries without making alternatives peers", () => {
    const scene = interrogationScene([
      inquiryPhase({
        questions: [
          inquiryQuestion({ id: "a", required: false }),
          inquiryQuestion({ id: "b", required: false }),
        ],
      }),
    ]);
    const nodesByKey = new Map(
      buildNodes(
        [chapter("chapter_1", ["interrogation_scene_1.md"])],
        [record("chapter_1", "interrogation_scene_1.md", scene)],
      ).map((node) => [node.key, node]),
    );

    expect(
      nodesByKey.get("chapter_1/interrogation_scene_1/question:a:entry"),
    ).toMatchObject({
      mayExecuteBeforeKeys: [
        "chapter_1/interrogation_scene_1/question:b:entry",
      ],
      freeOrderRegionId: "chapter_1/interrogation_scene_1/phase:p",
    });
    expect(
      nodesByKey.get("chapter_1/interrogation_scene_1/question:a:breakthrough"),
    ).toMatchObject({
      mayExecuteBeforeKeys: [],
      freeOrderRegionId: null,
    });
  });

  it("does not make an unlocked target depend strictly on a later redundant reveal", () => {
    const scene = investigationScene({
      sublocations: [
        sublocation("main", [
          hotspot("a", {
            reveals: [{ kind: "hotspot", id: "b" }],
          }),
          hotspot("b"),
        ]),
      ],
    });
    const nodesByKey = new Map(
      buildNodes(
        [chapter("chapter_1", ["investigation_scene_1.md"])],
        [record("chapter_1", "investigation_scene_1.md", scene)],
      ).map((node) => [node.key, node]),
    );

    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/hotspot:b"),
    ).toMatchObject({
      strictPredecessorKeys: ["chapter_1/investigation_scene_1/entry"],
      mayExecuteBeforeKeys: ["chapter_1/investigation_scene_1/hotspot:a"],
    });
  });
});

describe("positive dependency and base reachability", () => {
  it("evaluates nested positive thresholds against may and must atoms", () => {
    const expression = {
      op: "at_least" as const,
      count: 2,
      conditions: [
        atomExpression("a"),
        {
          op: "at_least" as const,
          count: 2,
          conditions: [
            atomExpression("b"),
            atomExpression("c"),
            atomExpression("d"),
          ],
        },
        atomExpression("e"),
      ],
    };

    expect(evaluateMay(expression, new Set(["a", "b", "c"]))).toBe(true);
    expect(evaluateMust(expression, new Set(["a", "b"]))).toBe(false);
    expect(evaluateMust(expression, new Set(["a", "b", "c"]))).toBe(true);
  });

  it("rejects a direct positive self-reference", () => {
    const result = analyzeSynthetic([
      syntheticNode("self", {
        condition: atomExpression("fact_asserted:self"),
        effects: [addAtom("fact_asserted:self")],
      }),
    ]);

    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "positiveSelfReference",
        nodeKey: "self",
      }),
    ]);
  });

  it("suppresses a positive self-reference on a legacy-only node", () => {
    const result = analyzeSynthetic([
      syntheticNode("legacy-self", {
        legacyCompatibilityMode: true,
        condition: atomExpression("fact_asserted:legacy_self"),
        effects: [addAtom("fact_asserted:legacy_self")],
      }),
    ]);

    expect(result.errors).toEqual([]);
  });

  it("suppresses a positive dependency cycle when every member is legacy-only", () => {
    const result = analyzeSynthetic([
      syntheticNode("legacy-a", {
        legacyCompatibilityMode: true,
        condition: atomExpression("legacy-b"),
        effects: [addAtom("legacy-a")],
      }),
      syntheticNode("legacy-b", {
        legacyCompatibilityMode: true,
        condition: atomExpression("legacy-a"),
        effects: [addAtom("legacy-b")],
      }),
    ]);

    expect(result.errors).toEqual([]);
  });

  it("preserves a positive dependency diagnostic for a mixed legacy/new SCC", () => {
    const result = analyzeSynthetic([
      syntheticNode("legacy", {
        legacyCompatibilityMode: true,
        condition: atomExpression("new"),
        effects: [addAtom("legacy")],
      }),
      syntheticNode("new", {
        condition: atomExpression("legacy"),
        effects: [addAtom("new")],
      }),
    ]);

    expect(
      result.errors.filter(
        (diagnostic) => diagnostic.code === "positiveDependencyCycle",
      ),
    ).toEqual([expect.objectContaining({ code: "positiveDependencyCycle" })]);
  });

  it("emits one stable diagnostic for two-node and longer positive SCCs", () => {
    const twoNode = analyzeSynthetic([
      syntheticNode("b", {
        condition: atomExpression("a"),
        effects: [addAtom("b")],
      }),
      syntheticNode("a", {
        condition: atomExpression("b"),
        effects: [addAtom("a")],
      }),
    ]);
    const longer = analyzeSynthetic([
      syntheticNode("c", {
        condition: atomExpression("b"),
        effects: [addAtom("c")],
      }),
      syntheticNode("a", {
        condition: atomExpression("c"),
        effects: [addAtom("a")],
      }),
      syntheticNode("b", {
        condition: atomExpression("a"),
        effects: [addAtom("b")],
      }),
    ]);

    expect(
      twoNode.errors.filter(
        (diagnostic) => diagnostic.code === "positiveDependencyCycle",
      ),
    ).toEqual([
      expect.objectContaining({
        nodeKey: "a",
        message: expect.stringContaining("a -> b -> a"),
      }),
    ]);
    expect(
      longer.errors.filter(
        (diagnostic) => diagnostic.code === "positiveDependencyCycle",
      ),
    ).toEqual([
      expect.objectContaining({
        nodeKey: "a",
        message: expect.stringContaining("a -> b -> c -> a"),
      }),
    ]);
  });

  it("rejects a positive cycle even when one member is externally seeded", () => {
    const result = analyzeSynthetic([
      syntheticNode("a", {
        initiallyReachable: true,
        condition: atomExpression("b"),
        effects: [addAtom("a")],
      }),
      syntheticNode("b", {
        condition: atomExpression("a"),
        effects: [addAtom("b")],
      }),
    ]);

    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "positiveDependencyCycle" }),
    );
  });

  it("keeps may-before relations out of positive SCC input", () => {
    const result = analyzeSynthetic([
      syntheticNode("a", {
        initiallyReachable: true,
        effects: [addAtom("a")],
        mayExecuteBeforeKeys: ["b"],
      }),
      syntheticNode("b", {
        condition: atomExpression("a"),
        mayExecuteBeforeKeys: ["a"],
      }),
    ]);

    expect(
      result.errors.some((diagnostic) =>
        diagnostic.code.startsWith("positive"),
      ),
    ).toBe(false);
  });

  it("reaches a nested threshold only after deterministic fixed-point iterations", () => {
    const result = analyzeSynthetic([
      syntheticNode("seed", {
        initiallyReachable: true,
        effects: [addAtom("a")],
      }),
      syntheticNode("second", {
        condition: atomExpression("a"),
        effects: [addAtom("b"), addAtom("c")],
      }),
      syntheticNode("threshold", {
        condition: {
          op: "at_least",
          count: 2,
          conditions: [
            atomExpression("a"),
            {
              op: "at_least",
              count: 2,
              conditions: [atomExpression("b"), atomExpression("c")],
            },
          ],
        },
        effects: [addAtom("done")],
      }),
    ]);

    expect(result.reachableNodeKeys).toEqual(
      new Set(["seed", "second", "threshold"]),
    );
    expect(result.mayAtoms).toContain("done");
  });

  it("does not combine mutually exclusive one-shot outcomes", () => {
    const result = analyzeSynthetic([
      syntheticNode("left", {
        oneShotEventId: "breakthrough",
        initiallyReachable: true,
        effects: [addAtom("left")],
      }),
      syntheticNode("right", {
        oneShotEventId: "breakthrough",
        initiallyReachable: true,
        effects: [addAtom("right")],
      }),
      syntheticNode("impossible-threshold", {
        condition: {
          op: "at_least",
          count: 2,
          conditions: [atomExpression("left"), atomExpression("right")],
        },
      }),
    ]);

    expect(result.reachableNodeKeys).not.toContain("impossible-threshold");
  });

  it("reports unreachable new mandatory and optional nodes", () => {
    const result = analyzeSynthetic([
      syntheticNode("mandatory", {
        condition: atomExpression("missing"),
      }),
      syntheticNode("optional", {
        requirement: "optional",
        condition: atomExpression("missing"),
      }),
    ]);

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "requiredContentUnreachable",
        nodeKey: "mandatory",
      }),
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "optionalContentUnreachable",
        nodeKey: "optional",
      }),
    );
  });

  it("suppresses new reachability diagnostics for legacy-only nodes", () => {
    const result = analyzeSynthetic([
      syntheticNode("legacy-mandatory", {
        legacyCompatibilityMode: true,
        condition: atomExpression("missing"),
      }),
      syntheticNode("legacy-optional", {
        requirement: "optional",
        legacyCompatibilityMode: true,
        condition: atomExpression("missing"),
      }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    {
      name: "no grant producer",
      producer: null,
      message: "no authored grant producer",
    },
    {
      name: "mismatched authority",
      producer: syntheticGrantProducer("grant", "other_authority", true),
      message: 'do not match required authority "court"',
    },
    {
      name: "unreachable matching producer",
      producer: syntheticGrantProducer("grant", "court", false),
      message: "has no reachable matching grant producer",
    },
  ])("rejects mandatory authorization with $name", ({ producer, message }) => {
    const result = analyzeSynthetic(
      [
        ...(producer === null ? [] : [producer]),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "mandatoryAuthorizationUnreachable",
        nodeKey: "consumer",
        message: expect.stringContaining(message),
      }),
    ]);
  });

  it("accepts a reachable synthetic grant from the represented authority", () => {
    const result = analyzeSynthetic(
      [
        syntheticGrantProducer("grant", "court", true),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toEqual([]);
    expect(result.reachableNodeKeys).toContain("consumer");
    expect(result.mayAtoms).toContain("authorization_granted:permit");
  });
});

describe("ordered story batches", () => {
  it("rejects a resolver before its supporting fact and rolls back the batch", () => {
    const result = analyzeSynthetic([
      syntheticNode("batch", {
        initiallyReachable: true,
        effects: [
          storyEffect(
            {
              kind: "resolveQuestion",
              questionId: "question_a",
              factId: "fact_a",
            },
            0,
          ),
          storyEffect({ kind: "assertFact", factId: "fact_a" }, 1),
        ],
      }),
    ]);

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "storyRevealBatchAlwaysInvalid",
        nodeKey: "batch",
      }),
    );
    expect(result.mayAtoms).not.toContain("fact_asserted:fact_a");
    expect(result.mayAtoms).not.toContain("question_resolved:question_a");
  });

  it("makes an earlier provisional fact visible to a later resolver", () => {
    const result = analyzeSynthetic([
      syntheticNode("batch", {
        initiallyReachable: true,
        effects: [
          storyEffect({ kind: "assertFact", factId: "fact_a" }, 0),
          storyEffect(
            {
              kind: "resolveQuestion",
              questionId: "question_a",
              factId: "fact_a",
            },
            1,
          ),
        ],
      }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.mayAtoms).toContain("fact_asserted:fact_a");
    expect(result.mayAtoms).toContain("question_resolved:question_a");
  });

  it("publishes none of the earlier provisional atoms when the final target fails", () => {
    const result = analyzeSynthetic([
      syntheticNode("batch", {
        initiallyReachable: true,
        effects: [
          storyEffect({ kind: "assertFact", factId: "fact_a" }, 0),
          storyEffect(
            {
              kind: "resolveQuestion",
              questionId: "question_a",
              factId: "missing_fact",
            },
            1,
          ),
        ],
      }),
    ]);

    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "storyRevealBatchAlwaysInvalid" }),
    );
    expect(result.mayAtoms).not.toContain("fact_asserted:fact_a");
  });

  it("does not advance a strict successor after an always-invalid batch rolls back", () => {
    const result = analyzeSynthetic([
      syntheticNode("batch", {
        initiallyReachable: true,
        effects: [
          storyEffect(
            {
              kind: "resolveQuestion",
              questionId: "question_a",
              factId: "fact_a",
            },
            0,
          ),
        ],
      }),
      syntheticNode("successor", {
        strictPredecessorKeys: ["batch"],
        effects: [addAtom("advanced")],
      }),
    ]);

    expect(result.reachableNodeKeys).not.toContain("successor");
    expect(result.mayAtoms).not.toContain("advanced");
  });

  it("warns when a free-order fact makes the resolver batch succeed in only one order", () => {
    const result = analyzeSynthetic([
      syntheticNode("fact", {
        initiallyReachable: true,
        effects: [storyEffect({ kind: "assertFact", factId: "fact_a" }, 0)],
        mayExecuteBeforeKeys: ["resolver"],
        freeOrderRegionId: "region",
      }),
      syntheticNode("resolver", {
        initiallyReachable: true,
        effects: [
          storyEffect(
            {
              kind: "resolveQuestion",
              questionId: "question_a",
              factId: "fact_a",
            },
            0,
          ),
        ],
        mayExecuteBeforeKeys: ["fact"],
        freeOrderRegionId: "region",
      }),
    ]);

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "storyRevealBatchOrderDependent",
        nodeKey: "resolver",
      }),
    );
    expect(result.mayAtoms).toContain("question_resolved:question_a");
    expect(result.mustAtoms).not.toContain("question_resolved:question_a");
  });
});

describe("joint primary fixed point", () => {
  it("preserves the distinct primary outcomes of both concrete peer orders", () => {
    const aThenB = analyzeSynthetic(
      [
        primaryTransitionNode("a", false, "primary_a", {
          initiallyReachable: true,
        }),
        primaryTransitionNode("b", true, "primary_b", {
          strictPredecessorKeys: ["a"],
        }),
      ],
      primaryCatalog(),
    );
    const bThenA = analyzeSynthetic(
      [
        primaryTransitionNode("b", true, "primary_b", {
          initiallyReachable: true,
        }),
        primaryTransitionNode("a", false, "primary_a", {
          strictPredecessorKeys: ["b"],
        }),
      ],
      primaryCatalog(),
    );

    expect(aThenB.mayCompletedPrimaryIds).toEqual(new Set(["primary_a"]));
    expect(bThenA.mayCompletedPrimaryIds).toEqual(new Set());
  });

  it("summarizes both concrete orders when one peer sets A and another completes current into B", () => {
    const nodes = freeOrderPrimaryPeers(
      { completeCurrent: false, nextObjectiveId: "primary_a" },
      { completeCurrent: true, nextObjectiveId: "primary_b" },
    );

    const forward = analyzeSynthetic(nodes, primaryCatalog());
    const reversed = analyzeSynthetic([...nodes].reverse(), primaryCatalog());

    expect(primarySummary(forward)).toEqual(primarySummary(reversed));
    expect(forward.mayActivePrimaryIds).toEqual(
      new Set(["primary_a", "primary_b"]),
    );
    expect(forward.mayCompletedPrimaryIds).toContain("primary_a");
    expect(forward.mayAtoms).toContain("objective_completed:primary_a");
    expect(forward.mustAtoms).not.toContain("objective_completed:primary_a");
  });

  it("warns when one peer sets A and another can complete current into the same A", () => {
    const result = analyzeSynthetic(
      freeOrderPrimaryPeers(
        { completeCurrent: false, nextObjectiveId: "primary_a" },
        { completeCurrent: true, nextObjectiveId: "primary_a" },
      ),
      primaryCatalog(),
    );

    expect(result.errors).not.toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveTransitionAlwaysInvalid",
      }),
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveOrderingNotExhaustive",
        nodeKey: "b",
      }),
    );
  });

  it("hard-fails a strict attempt to reactivate an already completed primary", () => {
    const result = analyzeSynthetic(
      [
        primaryTransitionNode("set-a", false, "primary_a", {
          initiallyReachable: true,
        }),
        primaryTransitionNode("complete-a", true, null, {
          strictPredecessorKeys: ["set-a"],
        }),
        primaryTransitionNode("reactivate-a", false, "primary_a", {
          strictPredecessorKeys: ["complete-a"],
        }),
      ],
      primaryCatalog(),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveTransitionAlwaysInvalid",
        nodeKey: "reactivate-a",
      }),
    );
    expect(result.mustCompletedPrimaryIds).toContain("primary_a");
    expect(result.mustAtoms).toContain("objective_completed:primary_a");
  });

  it("distinguishes strict same-primary sequencing from a free-order pair", () => {
    const strict = analyzeSynthetic(
      [
        primaryTransitionNode("a", false, "primary_a", {
          initiallyReachable: true,
        }),
        primaryTransitionNode("b", true, "primary_a", {
          strictPredecessorKeys: ["a"],
        }),
      ],
      primaryCatalog(),
    );
    const free = analyzeSynthetic(
      freeOrderPrimaryPeers(
        { completeCurrent: false, nextObjectiveId: "primary_a" },
        { completeCurrent: true, nextObjectiveId: "primary_a" },
      ),
      primaryCatalog(),
    );

    expect(strict.errors).toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveTransitionAlwaysInvalid",
        nodeKey: "b",
      }),
    );
    expect(strict.errors).toContainEqual(
      expect.objectContaining({
        code: "storyRevealBatchAlwaysInvalid",
        nodeKey: "b",
      }),
    );
    expect(free.errors).not.toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveTransitionAlwaysInvalid",
      }),
    );
    expect(free.warnings).toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveOrderingNotExhaustive",
      }),
    );
    expect(free.warnings).toContainEqual(
      expect.objectContaining({ code: "storyRevealBatchOrderDependent" }),
    );
  });

  it("does not contaminate primary candidates from an unrelated region", () => {
    const result = analyzeSynthetic(
      [
        primaryTransitionNode("unrelated", false, "primary_a", {
          initiallyReachable: true,
          freeOrderRegionId: "other",
        }),
        primaryTransitionNode("target", true, "primary_a", {
          initiallyReachable: true,
          freeOrderRegionId: "target-region",
        }),
      ],
      primaryCatalog(),
    );

    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveOrderingNotExhaustive",
        nodeKey: "target",
      }),
    );
  });

  it("summarizes all three one-shot peers without replaying any member", () => {
    const result = analyzeSynthetic(
      [
        primaryTransitionNode("a", false, "primary_a", {
          initiallyReachable: true,
          mayExecuteBeforeKeys: ["b", "c"],
          freeOrderRegionId: "region",
        }),
        primaryTransitionNode("b", true, "primary_b", {
          initiallyReachable: true,
          mayExecuteBeforeKeys: ["a", "c"],
          freeOrderRegionId: "region",
        }),
        primaryTransitionNode("c", true, null, {
          initiallyReachable: true,
          mayExecuteBeforeKeys: ["a", "b"],
          freeOrderRegionId: "region",
        }),
      ],
      primaryCatalog(),
    );

    expect(result.mayActivePrimaryIds).toEqual(
      new Set([null, "primary_a", "primary_b"]),
    );
    expect(result.mayCompletedPrimaryIds).toEqual(
      new Set(["primary_a", "primary_b"]),
    );
    expect(result.mayAtoms).toContain("objective_completed:primary_a");
    expect(result.mayAtoms).toContain("objective_completed:primary_b");
    expect(result.mustCompletedPrimaryIds).toEqual(new Set());
  });

  it("does not invent an A to B to A replay through mutual may-before summaries", () => {
    const result = analyzeSynthetic(
      freeOrderPrimaryPeers(
        { completeCurrent: false, nextObjectiveId: "primary_a" },
        { completeCurrent: true, nextObjectiveId: "primary_b" },
      ),
      primaryCatalog(),
    );

    expect(result.mayCompletedPrimaryIds).toEqual(new Set(["primary_a"]));
    expect(result.mayAtoms).not.toContain("objective_completed:primary_b");
  });

  it("uses a primary completion atom to reach a dependent node", () => {
    const result = analyzeSynthetic(
      [
        primaryTransitionNode("set-a", false, "primary_a", {
          initiallyReachable: true,
        }),
        primaryTransitionNode("complete-a", true, null, {
          strictPredecessorKeys: ["set-a"],
        }),
        syntheticNode("consumer", {
          condition: atomExpression("objective_completed:primary_a"),
          effects: [addAtom("unlocked")],
        }),
      ],
      primaryCatalog(),
    );

    expect(result.reachableNodeKeys).toContain("consumer");
    expect(result.mayAtoms).toContain("objective_completed:primary_a");
    expect(result.mustAtoms).toContain("objective_completed:primary_a");
    expect(result.mayAtoms).toContain("unlocked");
  });

  it("keeps a completed secondary objective out of primary helper state", () => {
    const result = analyzeSynthetic([
      syntheticNode("secondary", {
        initiallyReachable: true,
        effects: [
          storyEffect(
            { kind: "completeObjective", objectiveId: "objective_a" },
            0,
          ),
        ],
      }),
    ]);

    expect(result.mayAtoms).toContain("objective_completed:objective_a");
    expect(result.mayCompletedPrimaryIds).not.toContain("objective_a");
    expect(result.mustCompletedPrimaryIds).not.toContain("objective_a");
  });

  it("does not combine primary completions from mutually exclusive one-shot outcomes", () => {
    const result = analyzeSynthetic(
      [
        primaryTransitionNode("left-set", false, "primary_a", {
          oneShotEventId: "choice",
          initiallyReachable: true,
        }),
        primaryTransitionNode("right-set", false, "primary_b", {
          oneShotEventId: "choice",
          initiallyReachable: true,
        }),
        primaryTransitionNode("left-complete", true, null, {
          oneShotEventId: "left-complete",
          strictPredecessorKeys: ["left-set"],
        }),
        primaryTransitionNode("right-complete", true, null, {
          oneShotEventId: "right-complete",
          strictPredecessorKeys: ["right-set"],
        }),
        syntheticNode("impossible", {
          condition: {
            op: "at_least",
            count: 2,
            conditions: [
              atomExpression("objective_completed:primary_a"),
              atomExpression("objective_completed:primary_b"),
            ],
          },
        }),
      ],
      primaryCatalog(),
    );

    expect(result.mayCompletedPrimaryIds).toEqual(
      new Set(["primary_a", "primary_b"]),
    );
    expect(result.reachableNodeKeys).not.toContain("impossible");
  });
});

describe("Task 9 fixed-point regressions", () => {
  it("does not use a strict successor as dynamic completion provenance for its consumer", () => {
    const result = analyzeSynthetic(
      [
        primaryTransitionNode("seed", false, "primary_a", {
          initiallyReachable: true,
        }),
        primaryTransitionNode("next", true, "primary_b", {
          strictPredecessorKeys: ["seed"],
        }),
        primaryTransitionNode("consumer", false, "primary_c", {
          condition: atomExpression("objective_completed:primary_a"),
        }),
        primaryTransitionNode("successor", true, null, {
          strictPredecessorKeys: ["consumer"],
        }),
      ],
      primaryCatalog(),
    );

    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveOrderingNotExhaustive",
        nodeKey: "consumer",
      }),
    );
    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({
        code: "storyRevealBatchOrderDependent",
        nodeKey: "consumer",
      }),
    );
    expect(result.mayCompletedPrimaryIds).toEqual(
      new Set(["primary_a", "primary_c"]),
    );
  });

  it("keeps common effects from mandatory shared one-shot alternatives in must state", () => {
    const result = analyzeSynthetic([
      syntheticNode("left", {
        oneShotEventId: "choice",
        initiallyReachable: true,
        effects: [addAtom("common")],
      }),
      syntheticNode("right", {
        oneShotEventId: "choice",
        initiallyReachable: true,
        effects: [addAtom("common")],
      }),
      syntheticNode("consumer", {
        condition: atomExpression("common"),
        effects: [addAtom("after-common")],
      }),
    ]);

    expect(result.mustReachableNodeKeys).not.toContain("left");
    expect(result.mustReachableNodeKeys).not.toContain("right");
    expect(result.mustReachableNodeKeys).toContain("consumer");
    expect(result.mustAtoms).toContain("common");
    expect(result.mustAtoms).toContain("after-common");
  });

  it("does not guarantee a mandatory alternative when an optional sibling can consume the event", () => {
    const result = analyzeSynthetic([
      syntheticNode("mandatory", {
        oneShotEventId: "choice",
        initiallyReachable: true,
        effects: [addAtom("common")],
      }),
      syntheticNode("optional", {
        oneShotEventId: "choice",
        requirement: "optional",
        initiallyReachable: true,
      }),
      syntheticNode("consumer", {
        condition: atomExpression("common"),
        effects: [addAtom("after-common")],
      }),
    ]);

    expect(result.mayAtoms).toContain("after-common");
    expect(result.mustReachableNodeKeys).not.toContain("consumer");
    expect(result.mustAtoms).not.toContain("common");
    expect(result.mustAtoms).not.toContain("after-common");
  });

  it("does not reintroduce a free-order subject through a strict-after peer summary", () => {
    const result = analyzeSynthetic(
      [
        primaryTransitionNode("seed", false, "primary_a", {
          initiallyReachable: true,
        }),
        primaryTransitionNode("a", true, null, {
          strictPredecessorKeys: ["seed"],
        }),
        primaryTransitionNode("k", false, "primary_b", {
          strictPredecessorKeys: ["a"],
        }),
        syntheticNode("observer", {
          initiallyReachable: true,
          mayExecuteBeforeKeys: ["a", "k"],
          freeOrderRegionId: "region",
        }),
        syntheticNode("y-consumer", {
          condition: atomExpression("objective_completed:primary_b"),
        }),
      ],
      primaryCatalog(),
    );

    expect(result.mayCompletedPrimaryIds).toEqual(new Set(["primary_a"]));
    expect(result.mayAtoms).not.toContain("objective_completed:primary_b");
    expect(result.reachableNodeKeys).not.toContain("y-consumer");
  });

  it("does not feed a strict successor's cumulative state back into its prerequisite producer", () => {
    const result = analyzeSynthetic(
      [
        syntheticNode("seed", {
          initiallyReachable: true,
          effects: [addAtom("x")],
        }),
        primaryTransitionNode("activate-a", false, "primary_a", {
          condition: atomExpression("x"),
        }),
        primaryTransitionNode("complete-a", true, null, {
          strictPredecessorKeys: ["activate-a"],
        }),
      ],
      primaryCatalog(),
    );

    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveOrderingNotExhaustive",
        nodeKey: "activate-a",
      }),
    );
    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({
        code: "storyRevealBatchOrderDependent",
        nodeKey: "activate-a",
      }),
    );
    expect(result.mustCompletedPrimaryIds).toContain("primary_a");
  });

  it("does not make an optional positive producer or its mandatory consumer must-reachable", () => {
    const result = analyzeSynthetic([
      syntheticNode("optional", {
        requirement: "optional",
        initiallyReachable: true,
        effects: [addAtom("a")],
      }),
      syntheticNode("consumer", {
        condition: atomExpression("a"),
        effects: [addAtom("b")],
      }),
    ]);

    expect(result.mayAtoms).toEqual(new Set(["a", "b"]));
    expect(result.mustReachableNodeKeys).not.toContain("consumer");
    expect(result.mustAtoms).not.toContain("a");
    expect(result.mustAtoms).not.toContain("b");
  });

  it("does not make a primary completion mandatory through an optional setter", () => {
    const result = analyzeSynthetic(
      [
        primaryTransitionNode("optional-setter", false, "primary_a", {
          requirement: "optional",
          initiallyReachable: true,
        }),
        primaryTransitionNode("completion", true, null, {
          condition: atomExpression("objective_revealed:primary_a"),
        }),
      ],
      primaryCatalog(),
    );

    expect(result.mayCompletedPrimaryIds).toContain("primary_a");
    expect(result.mustReachableNodeKeys).not.toContain("completion");
    expect(result.mustCompletedPrimaryIds).not.toContain("primary_a");
    expect(result.mustAtoms).not.toContain("objective_completed:primary_a");
  });

  it.each([
    {
      name: "conjunction",
      condition: {
        op: "and" as const,
        left: atomExpression("fact_asserted:fact_a"),
        right: atomExpression("gate"),
      },
    },
    {
      name: "threshold",
      condition: {
        op: "at_least" as const,
        count: 2,
        conditions: [
          atomExpression("fact_asserted:fact_a"),
          atomExpression("gate"),
          atomExpression("missing"),
        ],
      },
    },
  ])(
    "preserves must inputs across mandatory $name producers",
    ({ condition }) => {
      const result = analyzeSynthetic([
        syntheticNode("fact", {
          initiallyReachable: true,
          effects: [storyEffect({ kind: "assertFact", factId: "fact_a" }, 0)],
        }),
        syntheticNode("gate", {
          initiallyReachable: true,
          effects: [addAtom("gate")],
        }),
        syntheticNode("resolver", {
          condition,
          effects: [
            storyEffect(
              {
                kind: "resolveQuestion",
                questionId: "question_a",
                factId: "fact_a",
              },
              0,
            ),
          ],
        }),
      ]);

      expect(result.warnings).not.toContainEqual(
        expect.objectContaining({
          code: "storyRevealBatchOrderDependent",
          nodeKey: "resolver",
        }),
      );
      expect(result.mustAtoms).toContain("question_resolved:question_a");
    },
  );
});

function buildNodes(chapters: ASTChapter[], scenes: SceneRecord[]) {
  return buildReachabilityNodes({
    chapters,
    scenes,
    catalog: storyCatalog(),
    analysisRegistry: createAnalysisDefinitionRegistry({
      scenes: [],
      boards: [],
    }),
  });
}

function analyzeSynthetic(nodes: ReachabilityNode[], catalog = storyCatalog()) {
  return analyzeReachability({ nodes, catalog });
}

function syntheticNode(
  key: string,
  overrides: Partial<ReachabilityNode> = {},
): ReachabilityNode {
  return {
    key,
    oneShotEventId: key,
    requirement: "mandatory",
    legacyCompatibilityMode: false,
    initiallyReachable: false,
    condition: null,
    implicitPrerequisites: [],
    effects: [],
    representedAuthority: null,
    strictPredecessorKeys: [],
    mayExecuteBeforeKeys: [],
    freeOrderRegionId: null,
    sourceFile: "synthetic.md",
    line: 1,
    ...overrides,
  };
}

function atomExpression(atom: string) {
  return { predicate: "atom" as const, atom };
}

function addAtom(atom: string) {
  return { kind: "addAtom" as const, atom, targetIndex: 0 };
}

function storyEffect(
  target: Extract<
    ReachabilityNode["effects"][number],
    { kind: "story" }
  >["target"],
  targetIndex: number,
) {
  return { kind: "story" as const, target, targetIndex };
}

function primaryTransitionNode(
  key: string,
  completeCurrent: boolean,
  nextObjectiveId: string | null,
  overrides: Partial<ReachabilityNode> = {},
): ReachabilityNode {
  return syntheticNode(key, {
    effects: [
      storyEffect(
        { kind: "setPrimaryObjective", completeCurrent, nextObjectiveId },
        0,
      ),
    ],
    ...overrides,
  });
}

function freeOrderPrimaryPeers(
  a: { completeCurrent: boolean; nextObjectiveId: string | null },
  b: { completeCurrent: boolean; nextObjectiveId: string | null },
): ReachabilityNode[] {
  return [
    primaryTransitionNode("a", a.completeCurrent, a.nextObjectiveId, {
      initiallyReachable: true,
      mayExecuteBeforeKeys: ["b"],
      freeOrderRegionId: "region",
    }),
    primaryTransitionNode("b", b.completeCurrent, b.nextObjectiveId, {
      initiallyReachable: true,
      mayExecuteBeforeKeys: ["a"],
      freeOrderRegionId: "region",
    }),
  ];
}

function primarySummary(result: ReturnType<typeof analyzeSynthetic>) {
  return {
    mayActivePrimaryIds: result.mayActivePrimaryIds,
    mustActivePrimary: result.mustActivePrimary,
    mayCompletedPrimaryIds: result.mayCompletedPrimaryIds,
    mustCompletedPrimaryIds: result.mustCompletedPrimaryIds,
    mayAtoms: result.mayAtoms,
    mustAtoms: result.mustAtoms,
    errors: result.errors,
    warnings: result.warnings,
  };
}

function mandatoryAuthorizationConsumer(): ReachabilityNode {
  return syntheticNode("consumer", {
    condition: atomExpression("authorization_granted:permit"),
  });
}

function syntheticGrantProducer(
  key: string,
  representedAuthority: string,
  initiallyReachable: boolean,
): ReachabilityNode {
  return syntheticNode(key, {
    requirement: "optional",
    legacyCompatibilityMode: true,
    initiallyReachable,
    representedAuthority,
    effects: [
      {
        kind: "story",
        target: { kind: "grantAuthorization", authorizationId: "permit" },
        targetIndex: 0,
      },
    ],
  });
}

function catalogWithAuthorization(
  id: string,
  grantingAuthority: string,
): ASTStoryCatalog {
  const catalog = storyCatalog();
  catalog.authorizations = [
    {
      id,
      label: id,
      summary: "summary",
      grantingAuthority,
      sourceFile: "story_catalog.md",
      line: 8,
    },
  ];
  return catalog;
}

function chapter(
  dirName: string,
  sceneFiles: string[],
  number = Number(dirName.replace("chapter_", "")),
): ASTChapter {
  return {
    kind: "chapter",
    dirName,
    number,
    title: dirName,
    summary: "summary",
    sceneFiles,
    sourceFile: `${dirName}/chapter.md`,
    line: 1,
  };
}

function investigationScene(
  overrides: Partial<ASTInvestigationScene> = {},
): ASTInvestigationScene {
  return {
    kind: "investigationScene",
    id: "investigation_scene_1",
    title: "Investigation",
    summary: "summary",
    summaryAuthored: true,
    intro: [],
    sublocations: [sublocation("main", [hotspot("a")])],
    evidenceManifest: [],
    statementManifest: [],
    outro: { unlock: "auto", dialogue: [] },
    assetRefs: [],
    sourceFile: "chapter_1/investigation_scene_1.md",
    line: 1,
    ...overrides,
  };
}

function linearScene(id: string): ASTLinearScene {
  return {
    kind: "linearScene",
    id,
    title: id,
    summary: "summary",
    summaryAuthored: true,
    queue: [],
    assetRefs: [],
    sourceFile: `chapter_1/${id}.md`,
    line: 1,
  };
}

function interrogationScene(phases: ASTInquiryPhase[]): ASTInterrogationScene {
  return {
    kind: "interrogationScene",
    id: "interrogation_scene_1",
    title: "Interrogation",
    summary: "summary",
    summaryAuthored: true,
    intro: [],
    phases,
    evidenceManifest: [],
    statementManifest: [],
    outro: { unlock: "auto", dialogue: [] },
    assetRefs: [],
    sourceFile: "chapter_1/interrogation_scene_1.md",
    line: 1,
  };
}

function inquiryPhase(
  overrides: Partial<ASTInquiryPhase> & {
    questions?: ASTInquiryQuestion[];
  } = {},
): ASTInquiryPhase {
  return {
    kind: "inquiry",
    id: "p",
    label: "Phase",
    subject: {
      id: "suspect",
      name: "Suspect",
      role: "Witness",
      bio: "bio",
      sourceFile: "chapter_1/interrogation_scene_1.md",
      line: 2,
    },
    required: true,
    status: "unlocked",
    unlock: null,
    reveals: [],
    sceneTag: "phase",
    assetCue: null,
    entryDialogue: [],
    complete: "auto",
    questions: [inquiryQuestion()],
    sourceFile: "chapter_1/interrogation_scene_1.md",
    line: 2,
    ...overrides,
  };
}

function inquiryQuestion(
  overrides: Partial<ASTInquiryQuestion> & {
    testimonyLines?: ASTTestimonyLine[];
  } = {},
): ASTInquiryQuestion {
  const { testimonyLines, ...questionOverrides } = overrides;
  return {
    id: "q",
    label: "Question",
    status: "unlocked",
    required: true,
    unlock: null,
    reveals: [],
    testimony: {
      onLoop: [],
      loopPrompt: null,
      defaultChallenge: null,
      defaultWrong: null,
      wrongReply: null,
      lines: testimonyLines ?? [honestLine("honest")],
      sourceFile: "chapter_1/interrogation_scene_1.md",
      line: 3,
    },
    sourceFile: "chapter_1/interrogation_scene_1.md",
    line: 3,
    ...questionOverrides,
  };
}

function honestLine(id: string): ASTTestimonyLine {
  return {
    id,
    label: id,
    content: [],
    contradiction: null,
    challenge: null,
    onCorrect: null,
    onWrongEvidence: null,
    reveals: [],
    sourceFile: "chapter_1/interrogation_scene_1.md",
    line: 4,
  };
}

function testimonyLine(
  id: string,
  evidenceId: string,
  reveals: ASTTestimonyLine["reveals"],
): ASTTestimonyLine {
  return {
    id,
    label: id,
    content: [],
    contradiction: { kind: "evidence", id: evidenceId },
    challenge: [],
    onCorrect: [],
    onWrongEvidence: [],
    reveals,
    sourceFile: "chapter_1/interrogation_scene_1.md",
    line: id === "left" ? 4 : 5,
  };
}

function sublocation(
  id: string,
  hotspots: ASTHotspot[],
  overrides: Pick<Partial<ASTSublocation>, "status"> = {},
): ASTSublocation {
  return {
    id,
    label: id,
    status: "unlocked",
    unlock: null,
    reveals: [],
    sceneTag: id,
    assetCue: null,
    transitionDialogue: [],
    hotspots,
    characters: [],
    sourceFile: "chapter_1/investigation_scene_1.md",
    line: 2,
    ...overrides,
  };
}

function hotspot(
  id: string,
  overrides: { reveals?: InvestigationRevealTarget[] } = {},
): ASTHotspot {
  return {
    id,
    label: id,
    description: id,
    status: "unlocked",
    unlock: null,
    reveals: overrides.reveals ?? [],
    evidenceSource: null,
    sceneSourcePrompt: null,
    inspectDialogue: [],
    onReexamine: null,
    layout: null,
    sourceFile: "chapter_1/investigation_scene_1.md",
    line: id === "a" ? 3 : 4,
  };
}

function record(
  chapterId: string,
  file: string,
  ast: ASTInvestigationScene | ASTInterrogationScene | ASTLinearScene,
): SceneRecord {
  return { chapterId, file, ast };
}

function storyCatalog(): ASTStoryCatalog {
  return {
    facts: [
      {
        id: "fact_a",
        label: "Fact A",
        summary: "summary",
        details: "details",
        category: "test",
        sourceFile: "story_catalog.md",
        line: 2,
      },
    ],
    objectives: [
      {
        id: "objective_a",
        label: "Objective A",
        summary: "summary",
        kind: "secondary",
        sortOrder: 1,
        sourceFile: "story_catalog.md",
        line: 5,
      },
    ],
    questions: [
      {
        id: "question_a",
        label: "Question A",
        summary: "summary",
        resolvedByFactIds: [],
        sourceFile: "story_catalog.md",
        line: 4,
      },
    ],
    authorizations: [],
    sourceGroups: [],
    sourceFile: "story_catalog.md",
    line: 1,
  };
}

function primaryCatalog(): ASTStoryCatalog {
  const catalog = storyCatalog();
  catalog.objectives = [
    {
      id: "primary_a",
      label: "Primary A",
      summary: "summary",
      kind: "primary",
      sortOrder: 1,
      sourceFile: "story_catalog.md",
      line: 5,
    },
    {
      id: "primary_b",
      label: "Primary B",
      summary: "summary",
      kind: "primary",
      sortOrder: 2,
      sourceFile: "story_catalog.md",
      line: 6,
    },
    {
      id: "primary_c",
      label: "Primary C",
      summary: "summary",
      kind: "primary",
      sortOrder: 3,
      sourceFile: "story_catalog.md",
      line: 7,
    },
  ];
  return catalog;
}
