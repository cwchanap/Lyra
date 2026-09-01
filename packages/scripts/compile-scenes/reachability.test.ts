import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createAnalysisDefinitionRegistry,
  createAnalysisDefinitionRegistryFromScenes,
} from "./analysis-definition-registry";
import { compileCaseRecordCorpus } from "./case-record-provenance";
import { parseAnalysisScene } from "./parser-analysis";
import { parseInvestigationScene } from "./parser-investigation";
import { parseStoryCatalog } from "./parser-story-catalog";
import {
  analyzeReachability,
  buildReachabilityNodes,
  evaluateMay,
  evaluateMust,
  type ReachabilityNode,
} from "./reachability";
import { validateAnalysisScenes } from "./validator-analysis";
import type {
  ASTChapter,
  ASTCharacter,
  ASTHotspot,
  ASTInquiryPhase,
  ASTInquiryQuestion,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  ASTStoryCatalog,
  ASTSublocation,
  ASTTestimonyLine,
  ASTTopic,
  InvestigationRevealTarget,
} from "./types";
import type { SceneRecord } from "./validator";

describe("buildReachabilityNodes", () => {
  // HPA-601: a mapped scene's first unlocked sublocation is *available*, not
  // auto-entered, so the entry node must not carry its reveal effects.
  it("keeps mapped scene entry free of first-unlocked entry reveal effects", () => {
    const scene = investigationScene({
      mapId: "tokyo",
      sublocations: [
        sublocation("main", [], {
          reveals: [{ kind: "assertFact", factId: "entry_fact" }],
        }),
      ],
    });

    const nodesByKey = new Map(
      buildNodes(
        [chapter("chapter_1", ["investigation_scene_1.md"])],
        [record("chapter_1", "investigation_scene_1.md", scene)],
      ).map((node) => [node.key, node]),
    );

    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/entry")?.effects,
    ).toEqual([]);
    // The first unlocked sublocation is projected as its own node whose
    // reveals fire only when the player enters it.
    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/sublocation:main"),
    ).toMatchObject({
      initiallyReachable: true,
      strictPredecessorKeys: ["chapter_1/investigation_scene_1/entry"],
    });
  });

  it("keeps normal first-unlocked auto-entry reveal effects unchanged", () => {
    const scene = investigationScene({
      sublocations: [
        sublocation("main", [], {
          reveals: [{ kind: "assertFact", factId: "entry_fact" }],
        }),
      ],
    });

    const nodesByKey = new Map(
      buildNodes(
        [chapter("chapter_1", ["investigation_scene_1.md"])],
        [record("chapter_1", "investigation_scene_1.md", scene)],
      ).map((node) => [node.key, node]),
    );

    expect(
      nodesByKey.get("chapter_1/investigation_scene_1/entry")?.effects,
    ).toEqual([
      {
        kind: "story",
        target: { kind: "assertFact", factId: "entry_fact" },
        targetIndex: 0,
      },
    ]);
  });

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

  it("treats P1-local practice reveals as contextual markers without reachability effects", () => {
    const scene = investigationScene({
      sublocations: [
        sublocation("main", [
          hotspot("receipt", {
            reveals: [{ kind: "practice", id: "p1_receipt_reprint" }],
          }),
        ]),
      ],
    });

    const nodes = buildNodes(
      [chapter("chapter_1", ["investigation_scene_p1.md"])],
      [record("chapter_1", "investigation_scene_p1.md", scene)],
    );

    expect(nodes[1]!.effects).toEqual([
      {
        kind: "addAtom",
        atom: "hotspot:chapter_1@investigation_scene_1@receipt",
        targetIndex: -1,
      },
    ]);
    expect(
      analyzeReachability({ nodes, catalog: storyCatalog() }).errors,
    ).toEqual([]);
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

  it("does not let a later statically unlocked phase reveal satisfy the current phase", () => {
    const scene = interrogationScene([
      inquiryPhase({
        id: "first",
        questions: [
          inquiryQuestion({
            id: "needs_late_fact",
            status: "locked",
            unlock: { predicate: "fact_asserted", id: "fact_a" },
          }),
        ],
      }),
      inquiryPhase({
        id: "later",
        reveals: [{ kind: "assertFact", factId: "fact_a" }],
        questions: [inquiryQuestion({ id: "later_question" })],
      }),
    ]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const result = analyzeReachability({ nodes, catalog: storyCatalog() });

    expect(
      nodes.find(
        (node) =>
          node.key === "chapter_1/interrogation_scene_1/phase:later:entry",
      ),
    ).toMatchObject({
      strictPredecessorKeys: [
        "chapter_1/interrogation_scene_1/entry",
        "chapter_1/interrogation_scene_1/phase:first:complete",
      ],
    });
    expect(result.reachableNodeKeys).not.toContain(
      "chapter_1/interrogation_scene_1/phase:later:entry",
    );
    expect(result.reachableNodeKeys).not.toContain(
      "chapter_1/interrogation_scene_1/question:needs_late_fact:entry",
    );
    expect(result.mayAtoms).not.toContain("fact_asserted:fact_a");
  });

  it("hands off to a later statically unlocked phase after current completion", () => {
    const scene = interrogationScene([
      inquiryPhase({
        id: "first",
        questions: [inquiryQuestion({ id: "first_question" })],
      }),
      inquiryPhase({
        id: "later",
        reveals: [{ kind: "assertFact", factId: "fact_a" }],
        questions: [inquiryQuestion({ id: "later_question" })],
      }),
    ]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const result = analyzeReachability({ nodes, catalog: storyCatalog() });
    const firstCompleteKey =
      "chapter_1/interrogation_scene_1/phase:first:complete";
    const laterEntryKey = "chapter_1/interrogation_scene_1/phase:later:entry";

    expect(nodes.find((node) => node.key === laterEntryKey)).toMatchObject({
      strictPredecessorKeys: [
        "chapter_1/interrogation_scene_1/entry",
        firstCompleteKey,
      ],
    });
    expect(
      nodes.findIndex((node) => node.key === firstCompleteKey),
    ).toBeLessThan(nodes.findIndex((node) => node.key === laterEntryKey));
    expect(result.reachableNodeKeys).toContain(firstCompleteKey);
    expect(result.reachableNodeKeys).toContain(laterEntryKey);
    expect(result.mayAtoms).toContain("fact_asserted:fact_a");
  });

  it("keeps a later phase eligible when an earlier phase is statically locked", () => {
    const scene = interrogationScene([
      inquiryPhase({
        id: "locked_first",
        status: "locked",
        unlock: { predicate: "fact_asserted", id: "fact_a" },
        questions: [inquiryQuestion({ id: "locked_question" })],
      }),
      inquiryPhase({
        id: "available_later",
        questions: [inquiryQuestion({ id: "available_question" })],
      }),
    ]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const result = analyzeReachability({ nodes, catalog: storyCatalog() });
    const laterEntryKey =
      "chapter_1/interrogation_scene_1/phase:available_later:entry";

    expect(nodes.find((node) => node.key === laterEntryKey)).toMatchObject({
      strictPredecessorKeys: ["chapter_1/interrogation_scene_1/entry"],
    });
    expect(result.reachableNodeKeys).toContain(laterEntryKey);
  });

  it("uses required-before-optional runtime priority for guaranteed phase handoff", () => {
    const scene = interrogationScene([
      inquiryPhase({
        id: "optional_first",
        required: false,
        questions: [inquiryQuestion({ id: "optional_question" })],
      }),
      inquiryPhase({
        id: "required_later",
        questions: [inquiryQuestion({ id: "required_question" })],
      }),
    ]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );

    expect(
      nodes.find(
        (node) =>
          node.key ===
          "chapter_1/interrogation_scene_1/phase:required_later:entry",
      ),
    ).toMatchObject({
      strictPredecessorKeys: ["chapter_1/interrogation_scene_1/entry"],
    });
    expect(
      nodes.find(
        (node) =>
          node.key ===
          "chapter_1/interrogation_scene_1/phase:optional_first:entry",
      ),
    ).toMatchObject({
      strictPredecessorKeys: [
        "chapter_1/interrogation_scene_1/entry",
        "chapter_1/interrogation_scene_1/phase:required_later:complete",
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

  // Local reveals of hotspot/topic/question/phase targets only unlock those
  // blocks at runtime; they do not investigate/discuss/answer/complete them.
  // The revealed target's own normalized execution node must remain the sole
  // producer of the corresponding completion atom, otherwise the fixed-point
  // analyzer would satisfy downstream predicates before the player executes
  // the revealed target and could hide a real deadlock.
  it("does not let a local hotspot reveal satisfy hotspot_investigated before the target is executed", () => {
    const scene = investigationScene({
      sublocations: [
        sublocation("main", [
          hotspot("a", {
            reveals: [{ kind: "hotspot", id: "b" }],
          }),
          hotspot("b", {
            status: "locked",
            unlock: { predicate: "fact_asserted", id: "fact_a" },
          }),
          hotspot("c", {
            status: "locked",
            unlock: { predicate: "hotspot_investigated", id: "b" },
          }),
        ]),
      ],
    });
    const nodes = buildNodes(
      [chapter("chapter_1", ["investigation_scene_1.md"])],
      [record("chapter_1", "investigation_scene_1.md", scene)],
    );
    const result = analyzeReachability({ nodes, catalog: storyCatalog() });

    expect(result.mayAtoms).not.toContain(
      "hotspot:chapter_1@investigation_scene_1@b",
    );
    expect(result.reachableNodeKeys).not.toContain(
      "chapter_1/investigation_scene_1/hotspot:c",
    );
  });

  it("does not let a local topic reveal satisfy topic_discussed before the target is executed", () => {
    const main = sublocation("main", [
      hotspot("a", {
        reveals: [{ kind: "topic", characterId: "cx", topicId: "ty" }],
      }),
      hotspot("c", {
        status: "locked",
        unlock: {
          predicate: "topic_discussed",
          characterId: "cx",
          topicId: "ty",
        },
      }),
    ]);
    main.characters = [
      character("cx", [
        topic("ty", {
          status: "locked",
          unlock: { predicate: "fact_asserted", id: "fact_a" },
        }),
      ]),
    ];
    const scene = investigationScene({ sublocations: [main] });
    const nodes = buildNodes(
      [chapter("chapter_1", ["investigation_scene_1.md"])],
      [record("chapter_1", "investigation_scene_1.md", scene)],
    );
    const result = analyzeReachability({ nodes, catalog: storyCatalog() });

    expect(result.mayAtoms).not.toContain(
      "topic:chapter_1@investigation_scene_1@cx@ty",
    );
    expect(result.reachableNodeKeys).not.toContain(
      "chapter_1/investigation_scene_1/hotspot:c",
    );
  });

  it("does not let a local question reveal satisfy question_answered before the target is executed", () => {
    const scene = interrogationScene([
      inquiryPhase({
        id: "first",
        questions: [
          inquiryQuestion({
            id: "revealer",
            required: false,
            reveals: [{ kind: "question", id: "target" }],
          }),
          inquiryQuestion({
            id: "consumer",
            required: false,
            status: "locked",
            unlock: { predicate: "question_answered", id: "target" },
          }),
        ],
      }),
      inquiryPhase({
        id: "second",
        status: "locked",
        unlock: { predicate: "fact_asserted", id: "fact_a" },
        questions: [inquiryQuestion({ id: "target", status: "locked" })],
      }),
    ]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const result = analyzeReachability({ nodes, catalog: storyCatalog() });

    expect(result.mayAtoms).not.toContain(
      "question_answered:chapter_1@interrogation_scene_1@target",
    );
    expect(result.reachableNodeKeys).not.toContain(
      "chapter_1/interrogation_scene_1/question:consumer:entry",
    );
  });

  it("does not let a local phase reveal satisfy phase_completed before the target is executed", () => {
    const scene = interrogationScene([
      inquiryPhase({
        id: "first",
        reveals: [{ kind: "phase", id: "second" }],
        questions: [
          inquiryQuestion({ id: "revealer", required: false }),
          inquiryQuestion({
            id: "consumer",
            required: false,
            status: "locked",
            unlock: { predicate: "phase_completed", id: "second" },
          }),
        ],
      }),
      inquiryPhase({
        id: "second",
        status: "locked",
        unlock: { predicate: "fact_asserted", id: "fact_a" },
        questions: [inquiryQuestion({ id: "second_question" })],
      }),
    ]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const result = analyzeReachability({ nodes, catalog: storyCatalog() });

    expect(result.mayAtoms).not.toContain(
      "phase_completed:chapter_1@interrogation_scene_1@second",
    );
    expect(result.reachableNodeKeys).not.toContain(
      "chapter_1/interrogation_scene_1/question:consumer:entry",
    );
  });

  it("keeps story-effect prerequisites causal inside a free-order region", () => {
    const factProducer = hotspot("a", {
      reveals: [
        { kind: "assertFact", factId: "fact_a" },
        {
          kind: "setPrimaryObjective",
          completeCurrent: true,
          nextObjectiveId: "primary_a",
        },
      ],
    });
    const dependentSetter = hotspot("b", {
      reveals: [
        {
          kind: "setPrimaryObjective",
          completeCurrent: false,
          nextObjectiveId: "primary_b",
        },
      ],
    });
    dependentSetter.status = "locked";
    dependentSetter.unlock = { predicate: "fact_asserted", id: "fact_a" };
    const impossibleCompletionConsumer = hotspot("c");
    impossibleCompletionConsumer.status = "locked";
    impossibleCompletionConsumer.unlock = {
      predicate: "objective_completed",
      id: "primary_b",
    };
    const scene = investigationScene({
      sublocations: [
        sublocation("main", [
          factProducer,
          dependentSetter,
          impossibleCompletionConsumer,
        ]),
      ],
    });
    const catalog = primaryCatalog();
    const nodes = buildReachabilityNodes({
      chapters: [chapter("chapter_1", ["investigation_scene_1.md"])],
      scenes: [record("chapter_1", "investigation_scene_1.md", scene)],
      catalog,
      analysisRegistry: createAnalysisDefinitionRegistry({
        scenes: [],
        boards: [],
      }),
    });
    const nodesByKey = new Map(nodes.map((node) => [node.key, node]));
    const producerKey = "chapter_1/investigation_scene_1/hotspot:a";
    const setterKey = "chapter_1/investigation_scene_1/hotspot:b";
    const consumerKey = "chapter_1/investigation_scene_1/hotspot:c";

    expect(nodesByKey.get(setterKey)).toMatchObject({
      strictPredecessorKeys: [
        "chapter_1/investigation_scene_1/entry",
        producerKey,
      ],
    });
    expect(nodesByKey.get(setterKey)?.mayExecuteBeforeKeys).toContain(
      producerKey,
    );
    expect(nodesByKey.get(producerKey)?.mayExecuteBeforeKeys).not.toContain(
      setterKey,
    );

    const result = analyzeReachability({ nodes, catalog });
    expect(result.mayCompletedPrimaryIds).not.toContain("primary_b");
    expect(result.mayAtoms).not.toContain("objective_completed:primary_b");
    expect(result.reachableNodeKeys).not.toContain(consumerKey);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "requiredContentUnreachable",
        nodeKey: consumerKey,
      }),
    );
  });

  it("maps normalized analysis cards, board effects, and scene completion through HPA-257", () => {
    // Break caught: an adapter could make the final scene reachable without
    // preserving every displayed card source, each board atom, or the
    // all-board prerequisite for the qualified scene-completion atom.
    const { catalog, nodes } = analysisChapterFixture();
    const nodesByKey = new Map(nodes.map((node) => [node.key, node]));
    const evidenceBoard =
      "chapter_1/analysis_scene_8_5/board:evidence_packages";
    const orderBoard =
      "chapter_1/analysis_scene_8_5/board:local_event_sequence";
    const thresholdBoard =
      "chapter_1/analysis_scene_8_5/board:narrow_request_basis";
    const analysisOutro = "chapter_1/analysis_scene_8_5/outro";

    expect(nodesByKey.get(evidenceBoard)).toMatchObject({
      requirement: "mandatory",
      strictPredecessorKeys: [
        "chapter_1/investigation_scene_1/outro",
        "chapter_1/investigation_scene_1/hotspot:acquire_analysis_sources",
      ],
      implicitPrerequisites: [
        { predicate: "atom", atom: "evidence:miyake_call_record" },
        { predicate: "atom", atom: "evidence:l_corridor_replay" },
        { predicate: "atom", atom: "evidence:external_credential_event" },
      ],
      effects: [
        {
          kind: "addAtom",
          atom: "analysis_board_completed:chapter_1@analysis_scene_8_5@evidence_packages",
          targetIndex: -1,
        },
        {
          kind: "story",
          target: {
            kind: "assertFact",
            factId: "miyake_known_lies_are_unrelated_to_murder",
          },
          targetIndex: 0,
        },
        {
          kind: "story",
          target: {
            kind: "assertFact",
            factId: "earlier_external_entry_exists",
          },
          targetIndex: 1,
        },
      ],
    });
    expect(nodesByKey.get(orderBoard)).toMatchObject({
      strictPredecessorKeys: [
        "chapter_1/investigation_scene_1/outro",
        evidenceBoard,
        "chapter_1/investigation_scene_1/hotspot:acquire_analysis_sources",
      ],
      condition: {
        predicate: "atom",
        atom: "analysis_board_completed:chapter_1@analysis_scene_8_5@evidence_packages",
      },
    });
    expect(nodesByKey.get(thresholdBoard)).toMatchObject({
      strictPredecessorKeys: [
        "chapter_1/investigation_scene_1/outro",
        orderBoard,
        "chapter_1/investigation_scene_1/hotspot:acquire_analysis_sources",
      ],
      implicitPrerequisites: [
        { predicate: "atom", atom: "evidence:lock_sequence" },
        { predicate: "atom", atom: "evidence:phone_notification" },
        { predicate: "atom", atom: "statement:manager_timing" },
      ],
    });
    expect(nodesByKey.get(analysisOutro)).toMatchObject({
      requirement: "mandatory",
      strictPredecessorKeys: [evidenceBoard, orderBoard, thresholdBoard],
      implicitPrerequisites: [
        {
          predicate: "atom",
          atom: "analysis_board_completed:chapter_1@analysis_scene_8_5@evidence_packages",
        },
        {
          predicate: "atom",
          atom: "analysis_board_completed:chapter_1@analysis_scene_8_5@local_event_sequence",
        },
        {
          predicate: "atom",
          atom: "analysis_board_completed:chapter_1@analysis_scene_8_5@narrow_request_basis",
        },
      ],
      effects: [
        {
          kind: "addAtom",
          atom: "analysis_scene_completed:chapter_1@analysis_scene_8_5",
          targetIndex: 0,
        },
      ],
    });

    const result = analyzeReachability({ nodes, catalog });
    for (const atom of [
      "analysis_board_completed:chapter_1@analysis_scene_8_5@evidence_packages",
      "analysis_board_completed:chapter_1@analysis_scene_8_5@local_event_sequence",
      "analysis_board_completed:chapter_1@analysis_scene_8_5@narrow_request_basis",
      "analysis_scene_completed:chapter_1@analysis_scene_8_5",
      "fact_asserted:miyake_known_lies_are_unrelated_to_murder",
      "fact_asserted:merge_time_is_not_event_time",
      "fact_asserted:two_independent_lock_contradictions_identified",
      "objective_completed:prepare_narrow_lock_request",
    ]) {
      expect(result.mayAtoms).toContain(atom);
    }
    expect(result.reachableNodeKeys).toContain(
      "chapter_1/investigation_scene_2/hotspot:advance_after_analysis",
    );
  });

  it("treats Practice-only classify cards as authored-static with no implicit prerequisites", () => {
    // Practice cards are authored-static Analysis material: they produce no
    // reachability atoms and require none. The matching Investigation reveal
    // marker is present for realism; validatePracticeCardBindings (which
    // cross-checks practice ids between Investigation reveals and Analysis
    // cards) is NOT part of this reachability-unit path. The assertion is
    // specifically about Analysis node prerequisites.
    const { nodes } = practiceAnalysisFixture();
    const nodesByKey = new Map(nodes.map((node) => [node.key, node]));
    const practiceBoard = nodesByKey.get(
      "chapter_1/analysis_scene_p1/board:practice_classify",
    );
    expect(practiceBoard).toBeDefined();

    expect(practiceBoard!.implicitPrerequisites).toEqual([]);
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

  it("carries interrogation phase authority to a reachable grant producer", () => {
    const phase = inquiryPhase({
      representedAuthority: "court",
      reveals: [{ kind: "evidence", id: "record" }],
      questions: [
        inquiryQuestion({
          testimonyLines: [
            testimonyLine("grant", "record", [
              { kind: "grantAuthorization", authorizationId: "permit" },
            ]),
          ],
        }),
      ],
    });
    const scene = interrogationScene([phase]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const result = analyzeSynthetic(
      nodes,
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toEqual([]);
    expect(result.mayAtoms).toContain("authorization_granted:permit");
  });

  it("rejects a mandatory authorization grant on only one of two breakthrough alternatives", () => {
    // Regression: when a required question has two correct lines and only one
    // grants the authorization, the grant is may-reachable (via the granting
    // alternative) but not guaranteed — the player can choose the other
    // alternative, complete the question, and soft-lock the required successor.
    const phase = inquiryPhase({
      representedAuthority: "court",
      reveals: [{ kind: "evidence", id: "record" }],
      questions: [
        inquiryQuestion({
          testimonyLines: [
            testimonyLine("grant", "record", [
              { kind: "grantAuthorization", authorizationId: "permit" },
            ]),
            testimonyLine("no_grant", "record", []),
          ],
        }),
      ],
    });
    const scene = interrogationScene([phase]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const result = analyzeSynthetic(
      [...nodes, mandatoryAuthorizationConsumer()],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "mandatoryAuthorizationGrantNotGuaranteed",
        nodeKey: "consumer",
      }),
    );
  });

  it("rejects a mandatory authorization grant on an optional question", () => {
    // Regression: when an optional question grants the authorization, the
    // player can skip it entirely, so the grant is not guaranteed for a
    // required successor.
    const phase = inquiryPhase({
      representedAuthority: "court",
      reveals: [{ kind: "evidence", id: "record" }],
      questions: [
        inquiryQuestion({
          required: false,
          testimonyLines: [
            testimonyLine("grant", "record", [
              { kind: "grantAuthorization", authorizationId: "permit" },
            ]),
          ],
        }),
      ],
    });
    const scene = interrogationScene([phase]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const result = analyzeSynthetic(
      [...nodes, mandatoryAuthorizationConsumer()],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "mandatoryAuthorizationGrantNotGuaranteed",
        nodeKey: "consumer",
      }),
    );
  });

  it("rejects a mandatory grant producer behind an optional predecessor", () => {
    // Regression: a mandatory (required) grant producer whose own predecessor
    // is optional is only may-reachable — the player can skip the optional
    // predecessor, never reach the mandatory grant producer, and soft-lock the
    // required successor. The grant atom is absent from mustAtoms, so the
    // mandatory producer must be flagged as unguaranteed just like an optional
    // producer.
    const result = analyzeSynthetic(
      [
        syntheticNode("gate", {
          requirement: "optional",
          initiallyReachable: true,
          effects: [addAtom("gate_open")],
        }),
        syntheticNode("grant", {
          requirement: "mandatory",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          condition: atomExpression("gate_open"),
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "mandatoryAuthorizationGrantNotGuaranteed",
        nodeKey: "consumer",
      }),
    );
  });

  it("accepts a mandatory authorization grant when every alternative grants it", () => {
    // Valid case: when every mutually-exclusive breakthrough alternative grants
    // the same authorization, the grant is guaranteed regardless of which
    // alternative the player chooses.
    const phase = inquiryPhase({
      representedAuthority: "court",
      reveals: [{ kind: "evidence", id: "record" }],
      questions: [
        inquiryQuestion({
          testimonyLines: [
            testimonyLine("grant_a", "record", [
              { kind: "grantAuthorization", authorizationId: "permit" },
            ]),
            testimonyLine("grant_b", "record", [
              { kind: "grantAuthorization", authorizationId: "permit" },
            ]),
          ],
        }),
      ],
    });
    const scene = interrogationScene([phase]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const result = analyzeSynthetic(
      [...nodes, mandatoryAuthorizationConsumer()],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toEqual([]);
    expect(result.reachableNodeKeys).toContain("consumer");
  });

  it("rejects a mandatory authorization grant when every alternative grants it but the Question is optional", () => {
    // Negative regression: an optional interrogation Question with two correct
    // lines where BOTH lines grant the same authorization. Every mutually-
    // exclusive alternative grants the authorization, so the old "every
    // alternative grants it" check passed — but the Question is optional, so
    // the player can skip it entirely and the one-shot event never fires. The
    // grant is not guaranteed and a required successor soft-locks.
    const phase = inquiryPhase({
      representedAuthority: "court",
      reveals: [{ kind: "evidence", id: "record" }],
      questions: [
        inquiryQuestion({
          required: false,
          testimonyLines: [
            testimonyLine("grant_a", "record", [
              { kind: "grantAuthorization", authorizationId: "permit" },
            ]),
            testimonyLine("grant_b", "record", [
              { kind: "grantAuthorization", authorizationId: "permit" },
            ]),
          ],
        }),
      ],
    });
    const scene = interrogationScene([phase]);
    const nodes = buildNodes(
      [chapter("chapter_1", ["interrogation_scene_1.md"])],
      [record("chapter_1", "interrogation_scene_1.md", scene)],
    );
    const result = analyzeSynthetic(
      [...nodes, mandatoryAuthorizationConsumer()],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "mandatoryAuthorizationGrantNotGuaranteed",
        nodeKey: "consumer",
      }),
    );
  });

  it("rejects a mandatory authorization grant when every alternative grants it but the Question entry is only may-reachable", () => {
    // Second regression: a required Question whose entry node is mandatory but
    // gated behind an optional prerequisite. The entry is may-reachable (when
    // the optional progress fires) but not must-reachable (the player can skip
    // the optional progress). Even though the Question itself is required and
    // every breakthrough alternative directly grants the authorization, the
    // shared trigger (the entry) is not must-reachable, so the one-shot event
    // is not guaranteed to fire and the mandatory grant can soft-lock.
    const result = analyzeSynthetic(
      [
        syntheticNode("optional_progress", {
          requirement: "optional",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:progress")],
        }),
        syntheticNode("question_entry", {
          requirement: "mandatory",
          initiallyReachable: false,
          condition: atomExpression("fact_asserted:progress"),
        }),
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["question_entry"],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["question_entry"],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "mandatoryAuthorizationGrantNotGuaranteed",
        nodeKey: "consumer",
      }),
    );
  });

  it("accepts a mandatory grant whose prerequisite is guaranteed by exhaustive optional alternatives", () => {
    // Regression: a required question with two correct testimony lines models
    // both breakthrough nodes as optional (mutually-exclusive alternatives of
    // one one-shot event). When both alternatives assert the same prerequisite
    // fact, one alternative must execute, so the fact is guaranteed even though
    // each producer node is individually optional and therefore absent from the
    // must fixed point. A mandatory grant producer gated on that fact, followed
    // by a mandatory successor, must compile.
    const result = analyzeSynthetic(
      [
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:request_ready")],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:request_ready")],
        }),
        syntheticNode("grant", {
          requirement: "mandatory",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          condition: atomExpression("fact_asserted:request_ready"),
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toEqual([]);
    expect(result.reachableNodeKeys).toContain("consumer");
    expect(result.mayAtoms).toContain("authorization_granted:permit");
  });

  it("rejects a mandatory grant when only one exhaustive alternative produces its prerequisite", () => {
    // Negative counterpart: when two mutually-exclusive alternatives share a
    // one-shot event but only one asserts the prerequisite fact, the fact is
    // not guaranteed — the player can choose the other alternative, skip the
    // fact, and soft-lock the required grant successor.
    const result = analyzeSynthetic(
      [
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:request_ready")],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          initiallyReachable: true,
          effects: [],
        }),
        syntheticNode("grant", {
          requirement: "mandatory",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          condition: atomExpression("fact_asserted:request_ready"),
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "mandatoryAuthorizationGrantNotGuaranteed",
        nodeKey: "consumer",
      }),
    );
  });

  it("rejects a mandatory grant whose prerequisite comes from an optional Question every alternative produces", () => {
    // Negative regression: an optional interrogation Question the player can
    // skip entirely models its breakthrough alternatives as mutually-exclusive
    // members of one one-shot event, each with the Question-entry node as a
    // strict predecessor. When the entry is optional (the Question is not
    // required), the player can skip the whole Question, so the event may
    // never fire. Even though every alternative asserts the prerequisite fact,
    // the fact is NOT guaranteed — a mandatory grant gated on it can soft-lock.
    const result = analyzeSynthetic(
      [
        syntheticNode("question_entry", {
          requirement: "optional",
          initiallyReachable: true,
        }),
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          initiallyReachable: false,
          strictPredecessorKeys: ["question_entry"],
          effects: [addAtom("fact_asserted:request_ready")],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          initiallyReachable: false,
          strictPredecessorKeys: ["question_entry"],
          effects: [addAtom("fact_asserted:request_ready")],
        }),
        syntheticNode("grant", {
          requirement: "mandatory",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          condition: atomExpression("fact_asserted:request_ready"),
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "mandatoryAuthorizationGrantNotGuaranteed",
        nodeKey: "consumer",
      }),
    );
  });

  it("rejects a mandatory grant whose required Question entry depends on optional progress", () => {
    // Second regression: a required Question whose entry node is mandatory but
    // gated behind an optional prerequisite. The entry is may-reachable (when
    // the optional progress fires) but not must-reachable (the player can skip
    // the optional progress). Even though every breakthrough alternative
    // asserts the prerequisite fact and the Question itself is required, the
    // shared trigger (the entry) is not must-reachable, so the event is not
    // guaranteed to fire and the mandatory grant can soft-lock.
    const result = analyzeSynthetic(
      [
        syntheticNode("optional_progress", {
          requirement: "optional",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:progress")],
        }),
        syntheticNode("question_entry", {
          requirement: "mandatory",
          initiallyReachable: false,
          condition: atomExpression("fact_asserted:progress"),
        }),
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          initiallyReachable: false,
          strictPredecessorKeys: ["question_entry"],
          effects: [addAtom("fact_asserted:request_ready")],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          initiallyReachable: false,
          strictPredecessorKeys: ["question_entry"],
          effects: [addAtom("fact_asserted:request_ready")],
        }),
        syntheticNode("grant", {
          requirement: "mandatory",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          condition: atomExpression("fact_asserted:request_ready"),
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "mandatoryAuthorizationGrantNotGuaranteed",
        nodeKey: "consumer",
      }),
    );
  });

  it("accepts a mandatory grant when alternatives have guaranteed alternative-specific prerequisites", () => {
    // Each mutually-exclusive alternative grants the authorization but has a
    // DIFFERENT implicit prerequisite atom. When each alternative's own
    // prerequisite is independently guaranteed (here via mandatory producers
    // that land in mustAtoms), the shared trigger is must-reachable and the
    // grant is guaranteed regardless of which alternative the player chooses.
    const result = analyzeSynthetic(
      [
        syntheticNode("producer_a", {
          requirement: "mandatory",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:A")],
        }),
        syntheticNode("producer_b", {
          requirement: "mandatory",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:B")],
        }),
        syntheticNode("entry", {
          requirement: "mandatory",
          initiallyReachable: true,
        }),
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:A")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:B")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toEqual([]);
    expect(result.reachableNodeKeys).toContain("consumer");
  });

  it("accepts a mandatory grant when one alternative's prerequisite is only may-reachable but another is always satisfiable", () => {
    // alt_a requires atom A (produced only by an optional node → may-reachable
    // but not guaranteed) while alt_b requires atom B (in mustAtoms). The
    // shared structural trigger (entry) is must-reachable, and every
    // may-reachable alternative grants the authorization. Under the per-path
    // guarantee check, every reachable scenario has a usable granting
    // alternative: on a path where A is absent alt_b is still satisfiable (B
    // is guaranteed) and grants; on a path where A is present alt_a grants.
    // The grant is therefore guaranteed even though alt_a's own prerequisite
    // is not globally guaranteed — the case the earlier per-atom check
    // falsely rejected.
    const result = analyzeSynthetic(
      [
        syntheticNode("optional_progress", {
          requirement: "optional",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:A")],
        }),
        syntheticNode("producer_b", {
          requirement: "mandatory",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:B")],
        }),
        syntheticNode("entry", {
          requirement: "mandatory",
          initiallyReachable: true,
        }),
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:A")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:B")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toEqual([]);
    expect(result.reachableNodeKeys).toContain("consumer");
  });

  it("rejects a mandatory grant when every alternative's prerequisite is only may-reachable via independent optional nodes", () => {
    // Negative counterpart to the per-path accept case: alt_a requires A and
    // alt_b requires B, but BOTH A and B are produced only by independent
    // optional nodes (neither is guaranteed). There is a reachable scenario
    // where the player skips both optional nodes — neither A nor B holds, no
    // granting alternative is satisfiable, and the one-shot event cannot fire,
    // soft-locking the required successor. The per-path enumeration must find
    // that empty scenario and reject.
    const result = analyzeSynthetic(
      [
        syntheticNode("optional_a", {
          requirement: "optional",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:A")],
        }),
        syntheticNode("optional_b", {
          requirement: "optional",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:B")],
        }),
        syntheticNode("entry", {
          requirement: "mandatory",
          initiallyReachable: true,
        }),
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:A")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:B")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "mandatoryAuthorizationGrantNotGuaranteed",
        nodeKey: "consumer",
      }),
    );
  });

  it("accepts a mandatory grant when paired exhaustive alternatives cover every path", () => {
    // The paired-exhaustive case the per-path check exists to accept: an
    // upstream required one-shot guarantees exactly one of fact:X / fact:Y
    // (pre_x produces X, pre_y produces Y, both initially reachable with no
    // predecessors so the trigger is the scene entry). Breakthrough A requires
    // X and breakthrough B requires Y, and both grant the same authorization.
    // Neither X nor Y is globally guaranteed, so the old per-atom check
    // rejected this; but every reachable scenario has exactly one usable
    // granting alternative, so the grant is guaranteed.
    const result = analyzeSynthetic(
      [
        syntheticNode("pre_x", {
          requirement: "optional",
          oneShotEventId: "pre_event",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:X")],
        }),
        syntheticNode("pre_y", {
          requirement: "optional",
          oneShotEventId: "pre_event",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:Y")],
        }),
        syntheticNode("entry", {
          requirement: "mandatory",
          initiallyReachable: true,
        }),
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:X")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:Y")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toEqual([]);
    expect(result.reachableNodeKeys).toContain("consumer");
  });

  it("rejects a mandatory grant when an upstream exhaustive one-shot's members have their own non-guaranteed prerequisites", () => {
    // Negative counterpart to the paired-exhaustive accept case: the upstream
    // one-shot (pre_event) is structurally must-reachable — pre_x and pre_y
    // are initially reachable with no strict predecessors, so the trigger is
    // the scene entry. But pre_x requires atom P (produced only by an
    // independent optional node) and pre_y requires atom Q (produced only by
    // another independent optional node). When the player skips both optional
    // P and Q, the one-shot event still selects a member, yet that member's
    // nodeMayExecute() fails, so neither X nor Y is produced. The downstream
    // breakthrough A (requires X) / B (requires Y) then has no satisfiable
    // granting alternative, soft-locking the required successor. The per-path
    // enumerator must add a "none" outcome for the upstream dimension when a
    // member's own prerequisites are not guaranteed, otherwise it falsely
    // proves the grant guaranteed.
    const result = analyzeSynthetic(
      [
        syntheticNode("optional_p", {
          requirement: "optional",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:P")],
        }),
        syntheticNode("optional_q", {
          requirement: "optional",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:Q")],
        }),
        syntheticNode("pre_x", {
          requirement: "optional",
          oneShotEventId: "pre_event",
          initiallyReachable: true,
          implicitPrerequisites: [atomExpression("fact_asserted:P")],
          effects: [addAtom("fact_asserted:X")],
        }),
        syntheticNode("pre_y", {
          requirement: "optional",
          oneShotEventId: "pre_event",
          initiallyReachable: true,
          implicitPrerequisites: [atomExpression("fact_asserted:Q")],
          effects: [addAtom("fact_asserted:Y")],
        }),
        syntheticNode("entry", {
          requirement: "mandatory",
          initiallyReachable: true,
        }),
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:X")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:Y")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "mandatoryAuthorizationGrantNotGuaranteed",
        nodeKey: "consumer",
      }),
    );
  });

  it("accepts a mandatory grant when alternative-specific prerequisites are guaranteed by exhaustive alternatives", () => {
    // alt_a requires atom A, which is guaranteed not by a mandatory producer
    // but by exhaustive mutually-exclusive alternatives (pre_alt_a and
    // pre_alt_b both produce A, share a one-shot event, and are initially
    // reachable with no predecessors — the trigger is the scene entry).
    // alt_b requires atom B, which is in mustAtoms. The recursive guarantee
    // check must follow the exhaustive-alternative chain for A while checking
    // each alternative's own prerequisites independently.
    const result = analyzeSynthetic(
      [
        syntheticNode("pre_alt_a", {
          requirement: "optional",
          oneShotEventId: "pre_event",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:A")],
        }),
        syntheticNode("pre_alt_b", {
          requirement: "optional",
          oneShotEventId: "pre_event",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:A")],
        }),
        syntheticNode("producer_b", {
          requirement: "mandatory",
          initiallyReachable: true,
          effects: [addAtom("fact_asserted:B")],
        }),
        syntheticNode("entry", {
          requirement: "mandatory",
          initiallyReachable: true,
        }),
        syntheticNode("alt_a", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:A")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        syntheticNode("alt_b", {
          requirement: "optional",
          oneShotEventId: "breakthrough",
          legacyCompatibilityMode: false,
          representedAuthority: "court",
          initiallyReachable: false,
          strictPredecessorKeys: ["entry"],
          implicitPrerequisites: [atomExpression("fact_asserted:B")],
          effects: [
            storyEffect(
              { kind: "grantAuthorization", authorizationId: "permit" },
              0,
            ),
          ],
        }),
        mandatoryAuthorizationConsumer(),
      ],
      catalogWithAuthorization("permit", "court"),
    );

    expect(result.errors).toEqual([]);
    expect(result.reachableNodeKeys).toContain("consumer");
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

  it("matches the valid and invalid concrete orders of the runtime same-A fixture", () => {
    const aThenB = analyzeSynthetic(
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
    const bThenA = analyzeSynthetic(
      [
        primaryTransitionNode("b", true, "primary_a", {
          initiallyReachable: true,
        }),
        primaryTransitionNode("a", false, "primary_a", {
          strictPredecessorKeys: ["b"],
        }),
      ],
      primaryCatalog(),
    );
    const freeOrder = analyzeSynthetic(
      freeOrderPrimaryPeers(
        { completeCurrent: false, nextObjectiveId: "primary_a" },
        { completeCurrent: true, nextObjectiveId: "primary_a" },
      ),
      primaryCatalog(),
    );

    expect(aThenB.errors).toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveTransitionAlwaysInvalid",
        nodeKey: "b",
      }),
    );
    expect(bThenA.errors).not.toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveTransitionAlwaysInvalid",
      }),
    );
    expect(freeOrder.errors).not.toContainEqual(
      expect.objectContaining({
        code: "primaryObjectiveTransitionAlwaysInvalid",
      }),
    );
    expect(freeOrder.warnings).toContainEqual(
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

describe("fixed-point provenance and must-state regressions", () => {
  it("does not use a positive successor as dynamic completion provenance for its consumer", () => {
    const result = analyzeSynthetic(
      [
        primaryTransitionNode("seed", false, "primary_a", {
          initiallyReachable: true,
        }),
        primaryTransitionNode("next", true, "primary_b", {
          strictPredecessorKeys: ["seed"],
        }),
        syntheticNode("consumer", {
          condition: atomExpression("objective_completed:primary_a"),
          effects: [
            storyEffect(
              {
                kind: "setPrimaryObjective",
                completeCurrent: false,
                nextObjectiveId: "primary_c",
              },
              0,
            ),
            addAtom("x"),
          ],
        }),
        primaryTransitionNode("successor", true, null, {
          condition: atomExpression("x"),
        }),
      ],
      primaryCatalog(),
    );

    expect(result.errors).not.toContainEqual(
      expect.objectContaining({ code: "positiveDependencyCycle" }),
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

  it("keeps a common active primary from mandatory shared one-shot alternatives", () => {
    const result = analyzeSynthetic(
      [
        primaryTransitionNode("seed", false, "primary_a", {
          initiallyReachable: true,
        }),
        primaryTransitionNode("left", true, "primary_b", {
          oneShotEventId: "choice",
          strictPredecessorKeys: ["seed"],
        }),
        primaryTransitionNode("right", true, "primary_b", {
          oneShotEventId: "choice",
          strictPredecessorKeys: ["seed"],
        }),
      ],
      primaryCatalog(),
    );

    expect(result.mustReachableNodeKeys).not.toContain("left");
    expect(result.mustReachableNodeKeys).not.toContain("right");
    expect(result.mustCompletedPrimaryIds).toContain("primary_a");
    expect(result.mustAtoms).toContain("objective_completed:primary_a");
    expect(result.mustAtoms).toContain("objective_revealed:primary_b");
    expect(result.mustActivePrimary).toEqual({
      kind: "known",
      id: "primary_b",
    });
  });

  it("does not use a redundant static effect as terminal causal provenance", () => {
    const result = analyzeSynthetic(
      [
        syntheticNode("seed-x", {
          initiallyReachable: true,
          effects: [addAtom("x")],
        }),
        syntheticNode("advance-a", {
          strictPredecessorKeys: ["seed-x"],
          mayExecuteBeforeKeys: ["consumer-b"],
          freeOrderRegionId: "region",
          effects: [
            storyEffect(
              {
                kind: "setPrimaryObjective",
                completeCurrent: false,
                nextObjectiveId: "primary_a",
              },
              0,
            ),
            addAtom("x"),
          ],
        }),
        primaryTransitionNode("consumer-b", false, "primary_b", {
          condition: atomExpression("x"),
          mayExecuteBeforeKeys: ["advance-a"],
          freeOrderRegionId: "region",
        }),
      ],
      primaryCatalog(),
    );

    expect(result.mustActivePrimary).toEqual({ kind: "unknown" });
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
    mapId: null,
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
      portrait: null,
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
  overrides: Pick<Partial<ASTSublocation>, "status" | "reveals"> = {},
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

function character(id: string, topics: ASTTopic[]): ASTCharacter {
  return {
    id,
    name: id,
    role: "Witness",
    bio: "bio",
    topics,
    sourceFile: "chapter_1/investigation_scene_1.md",
    line: 3,
  };
}

function topic(id: string, overrides: Partial<ASTTopic> = {}): ASTTopic {
  return {
    id,
    label: id,
    status: "unlocked",
    unlock: null,
    reveals: [],
    topicDialogue: [],
    onReexamine: null,
    sourceFile: "chapter_1/investigation_scene_1.md",
    line: 4,
    ...overrides,
  };
}

function hotspot(
  id: string,
  overrides: {
    reveals?: InvestigationRevealTarget[];
    status?: ASTHotspot["status"];
    unlock?: ASTHotspot["unlock"];
  } = {},
): ASTHotspot {
  return {
    id,
    label: id,
    description: id,
    status: "unlocked",
    unlock: null,
    reveals: [],
    evidenceSource: null,
    sceneSourcePrompt: null,
    inspectDialogue: [],
    onReexamine: null,
    layout: null,
    sourceFile: "chapter_1/investigation_scene_1.md",
    line: id === "a" ? 3 : 4,
    ...overrides,
  };
}

function record(
  chapterId: string,
  file: string,
  ast: ASTInvestigationScene | ASTInterrogationScene | ASTLinearScene,
): SceneRecord {
  return { chapterId, file, ast };
}

function practiceAnalysisFixture() {
  // Inline Practice-only classify fixture. No threshold board, so
  // provenance-neutrality rules are irrelevant to this reachability test.
  // The Investigation `Reveals: [practice:p1_context]` marker is present for
  // realism, but validatePracticeCardBindings (which binds practice ids
  // between Investigation reveals and Analysis cards) is NOT part of this
  // reachability-unit path: the assertion is specifically about Analysis
  // node prerequisites.
  const parsedCatalog = parseStoryCatalog(
    [
      "# Story Catalog",
      "## Facts",
      "### Fact: 練習完成 {#p1_practice_complete}",
      "- **Summary:** 練習分類完成。",
      "- **Details:** 練習用的情境卡已分類。",
      "- **Category:** fixture",
    ].join("\n"),
    "story_catalog.md",
  );
  if (!parsedCatalog.ok) throw new Error(parsedCatalog.errors[0]!.message);
  const parsedSource = parseInvestigationScene(
    [
      "# Scene 1: 練習情境",
      "- **Summary:** 取得練習情境卡。",
      "## Intro",
      "**相馬律**：先取得練習情境。",
      "## Sub-location: 練習桌 {#practice_desk}",
      "- **Status:** unlocked",
      "[場景：練習桌前。]",
      "### Hotspot: 練習情境 {#acquire_practice_context}",
      "- **Description:** 取得練習情境卡。",
      "- **Status:** unlocked",
      "- **Reveals:** [practice:p1_context]",
      "**相馬律**：這是練習情境。",
      "## Outro",
      "**相馬律**：練習情境已取得。",
    ].join("\n"),
    "chapter_1/investigation_scene_1.md",
    "investigation_scene_1",
  );
  if (!parsedSource.ok) throw new Error(parsedSource.error.message);
  const parsedAnalysis = parseAnalysisScene(
    [
      "# Scene 1: 練習分類",
      "- **Summary:** 把練習卡分類。",
      "## Intro",
      "**相馬律**：開始練習分類。",
      "## Board: 練習分類 {#practice_classify}",
      "- **Kind:** classify",
      "- **Prompt:** 把卡片放進正確的群組。",
      "- **Reveals:** [assert_fact:p1_practice_complete]",
      "- **Incomplete Feedback:** 還有卡片未分類。",
      "- **Incorrect Feedback:** 卡片放錯群組。",
      "### Card: 練習情境卡 {#p1_context_card}",
      "- **Source:** practice:p1_context",
      "- **Summary:** 練習情境。",
      "### Group: 練習群組 {#practice_group}",
      "- **Description:** 練習卡的目的群組。",
      "- **Accepted Cards:** [p1_context_card]",
      "### Result Dialogue",
      "**相馬律**：分類完成。",
      "## Outro",
      "**相馬律**：練習結束。",
    ].join("\n"),
    "chapter_1/analysis_scene_p1.md",
    "analysis_scene_p1",
  );
  if (!parsedAnalysis.ok) throw new Error(parsedAnalysis.error.message);

  const scenes = [
    record("chapter_1", "investigation_scene_1.md", parsedSource.value),
  ];
  const analysisScenes = [
    {
      chapterId: "chapter_1",
      file: "analysis_scene_p1.md",
      ast: parsedAnalysis.value,
    },
  ];
  const analysisRegistry =
    createAnalysisDefinitionRegistryFromScenes(analysisScenes);
  const caseRecords = compileCaseRecordCorpus(parsedCatalog.value, scenes);
  if (!caseRecords.ok) throw new Error(caseRecords.errors[0]!.message);
  const normalized = validateAnalysisScenes({
    scenes: analysisScenes,
    catalog: parsedCatalog.value,
    caseRecords: caseRecords.value,
    analysisRegistry,
  });
  if (!normalized.ok) throw new Error(normalized.errors[0]!.message);

  return {
    catalog: parsedCatalog.value,
    nodes: buildReachabilityNodes({
      chapters: [
        chapter("chapter_1", [
          "investigation_scene_1.md",
          "analysis_scene_p1.md",
        ]),
      ],
      scenes,
      catalog: parsedCatalog.value,
      analysisRegistry,
      analysisScenes,
      normalizedAnalysisScenes: normalized.value,
    }),
  };
}

function analysisChapterFixture() {
  const fixtureRoot = "packages/scripts/__fixtures__/analysis-chapter-1";
  const readFixture = (path: string) =>
    readFileSync(`${fixtureRoot}/${path}`, "utf-8");
  const parsedCatalog = parseStoryCatalog(
    readFixture("story_catalog.md"),
    "story_catalog.md",
  );
  if (!parsedCatalog.ok) throw new Error(parsedCatalog.errors[0]!.message);
  const parsedSource = parseInvestigationScene(
    readFixture("chapter_1/investigation_scene_1.md"),
    "chapter_1/investigation_scene_1.md",
    "investigation_scene_1",
  );
  if (!parsedSource.ok) throw new Error(parsedSource.error.message);
  const parsedAnalysis = parseAnalysisScene(
    readFixture("chapter_1/analysis_scene_8_5.md"),
    "chapter_1/analysis_scene_8_5.md",
    "analysis_scene_8_5",
  );
  if (!parsedAnalysis.ok) throw new Error(parsedAnalysis.error.message);
  const parsedFollowUp = parseInvestigationScene(
    readFixture("chapter_1/investigation_scene_2.md"),
    "chapter_1/investigation_scene_2.md",
    "investigation_scene_2",
  );
  if (!parsedFollowUp.ok) throw new Error(parsedFollowUp.error.message);

  const scenes = [
    record("chapter_1", "investigation_scene_1.md", parsedSource.value),
    record("chapter_1", "investigation_scene_2.md", parsedFollowUp.value),
  ];
  const analysisScenes = [
    {
      chapterId: "chapter_1",
      file: "analysis_scene_8_5.md",
      ast: parsedAnalysis.value,
    },
  ];
  const analysisRegistry =
    createAnalysisDefinitionRegistryFromScenes(analysisScenes);
  const caseRecords = compileCaseRecordCorpus(parsedCatalog.value, scenes);
  if (!caseRecords.ok) throw new Error(caseRecords.errors[0]!.message);
  const normalized = validateAnalysisScenes({
    scenes: analysisScenes,
    catalog: parsedCatalog.value,
    caseRecords: caseRecords.value,
    analysisRegistry,
  });
  if (!normalized.ok) throw new Error(normalized.errors[0]!.message);

  return {
    catalog: parsedCatalog.value,
    nodes: buildReachabilityNodes({
      chapters: [
        chapter("chapter_1", [
          "investigation_scene_1.md",
          "analysis_scene_8_5.md",
          "investigation_scene_2.md",
        ]),
      ],
      scenes,
      catalog: parsedCatalog.value,
      analysisRegistry,
      analysisScenes,
      normalizedAnalysisScenes: normalized.value,
    }),
  };
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

describe("scenario limit", () => {
  it("fails with a scenarioLimitExceeded error and emits no partial reachability when the Cartesian product exceeds the cap", () => {
    // 13 one-shot events with 2 alternatives each => 2^13 = 8192 scenarios,
    // which exceeds the 4096 cap. The enumerator must stop early and fail the
    // compile with a single scenarioLimitExceeded error rather than solving
    // partial selections whose one-shot mutual exclusion is not preserved.
    const eventCount = 13;
    const nodes: ReachabilityNode[] = [];
    for (let index = 0; index < eventCount; index += 1) {
      const eventId = `event_${index}`;
      nodes.push(
        syntheticNode(`${eventId}_a`, {
          oneShotEventId: eventId,
          initiallyReachable: true,
          effects: [addAtom(`atom_${index}_a`)],
        }),
      );
      nodes.push(
        syntheticNode(`${eventId}_b`, {
          oneShotEventId: eventId,
          initiallyReachable: true,
          effects: [addAtom(`atom_${index}_b`)],
        }),
      );
    }

    const result = analyzeSynthetic(nodes);

    const limitErrors = result.errors.filter(
      (error) => error.code === "scenarioLimitExceeded",
    );
    expect(limitErrors).toHaveLength(1);
    expect(limitErrors[0]!.message).toContain("4096");
    expect(
      result.warnings.filter((w) => w.code === "scenarioLimitExceeded"),
    ).toHaveLength(0);
    // No partial reachability is published: the short-circuit returns empty
    // result sets so unsound combinations cannot leak into packaged content.
    expect(result.reachableNodeKeys.size).toBe(0);
    expect(result.mayAtoms.size).toBe(0);
  });

  it("does not accept the conjunction of distinct atoms from a one-shot group skipped by overflow", () => {
    // 12 one-shot events with 2 alternatives each fit under the cap (2^12 =
    // 4096). A 13th event (event_12) would push the product to 8192 > 4096, so
    // the enumerator stops BEFORE assigning event_12. Under the old behavior,
    // an absent selection let both event_12 alternatives run together, so a
    // downstream node requiring their distinct atoms (left AND right) was
    // falsely reported reachable even though runtime can choose only one.
    // The compile must fail before producing such reachability results.
    const fillerCount = 12;
    const nodes: ReachabilityNode[] = [];
    for (let index = 0; index < fillerCount; index += 1) {
      const eventId = `event_${String(index).padStart(2, "0")}`;
      nodes.push(
        syntheticNode(`${eventId}_a`, {
          oneShotEventId: eventId,
          initiallyReachable: true,
          effects: [addAtom(`filler_${index}_a`)],
        }),
      );
      nodes.push(
        syntheticNode(`${eventId}_b`, {
          oneShotEventId: eventId,
          initiallyReachable: true,
          effects: [addAtom(`filler_${index}_b`)],
        }),
      );
    }
    // The 13th event is the one skipped by overflow; its two alternatives
    // produce distinct atoms `left` and `right`.
    nodes.push(
      syntheticNode("event_12_a", {
        oneShotEventId: "event_12",
        initiallyReachable: true,
        effects: [addAtom("left")],
      }),
    );
    nodes.push(
      syntheticNode("event_12_b", {
        oneShotEventId: "event_12",
        initiallyReachable: true,
        effects: [addAtom("right")],
      }),
    );
    // A mandatory node requiring both `left` and `right`. Runtime can never
    // satisfy this because event_12 is one-shot (only one alternative fires).
    nodes.push(
      syntheticNode("needs_left_and_right", {
        requirement: "mandatory",
        condition: {
          op: "and" as const,
          left: atomExpression("left"),
          right: atomExpression("right"),
        },
      }),
    );

    const result = analyzeSynthetic(nodes);

    expect(
      result.errors.filter((e) => e.code === "scenarioLimitExceeded"),
    ).toHaveLength(1);
    // The short-circuit publishes no reachability, so the impossible
    // conjunction is never accepted.
    expect(result.reachableNodeKeys.has("needs_left_and_right")).toBe(false);
    expect(result.mayAtoms.has("left")).toBe(false);
    expect(result.mayAtoms.has("right")).toBe(false);
  });

  it("does not emit scenarioLimitExceeded when the product fits under the cap", () => {
    // 10 one-shot events with 2 alternatives each => 2^10 = 1024 scenarios,
    // which is under the 4096 cap.
    const eventCount = 10;
    const nodes: ReachabilityNode[] = [];
    for (let index = 0; index < eventCount; index += 1) {
      const eventId = `event_${index}`;
      nodes.push(
        syntheticNode(`${eventId}_a`, {
          oneShotEventId: eventId,
          initiallyReachable: true,
          effects: [addAtom(`atom_${index}_a`)],
        }),
      );
      nodes.push(
        syntheticNode(`${eventId}_b`, {
          oneShotEventId: eventId,
          initiallyReachable: true,
          effects: [addAtom(`atom_${index}_b`)],
        }),
      );
    }

    const result = analyzeSynthetic(nodes);

    expect(
      result.warnings.filter((w) => w.code === "scenarioLimitExceeded"),
    ).toHaveLength(0);
  });
});
