import { describe, expect, it } from "vitest";
import { createAnalysisDefinitionRegistry } from "./analysis-definition-registry";
import { buildReachabilityNodes } from "./reachability";
import type {
  ASTChapter,
  ASTHotspot,
  ASTInvestigationScene,
  ASTStoryCatalog,
  ASTSublocation,
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
      "chapter_2/investigation_scene_2/entry",
      "chapter_2/investigation_scene_2/hotspot:z",
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
  ast: ASTInvestigationScene,
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
    questions: [],
    objectives: [],
    authorizations: [],
    sourceGroups: [],
    sourceFile: "story_catalog.md",
    line: 1,
  };
}
