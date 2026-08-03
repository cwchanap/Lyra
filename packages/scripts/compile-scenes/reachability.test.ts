import { describe, expect, it } from "vitest";
import { createAnalysisDefinitionRegistry } from "./analysis-definition-registry";
import { buildReachabilityNodes } from "./reachability";
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
