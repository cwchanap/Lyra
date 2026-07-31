import { describe, expect, it } from "vitest";
import type {
  AuthorizationView,
  CaseRecordProvenance,
  EncodedInventoryTarget,
  EvidenceRecord,
  FactView,
  GameStateView,
  ObjectiveView,
  QuestionView,
  SceneLocationContextView,
  StatementRecord,
} from "$lib/state/types";
import {
  buildCaseFileModel,
  factKey,
  hasVisibleProvenance,
  parseEncodedRecordTarget,
  recordKey,
} from "./case-file-model";

function stateWithCaseFile(overrides: {
  evidence?: EvidenceRecord[];
  statements?: StatementRecord[];
  facts?: FactView[];
  questions?: QuestionView[];
  objectives?: ObjectiveView[];
  authorizations?: AuthorizationView[];
}): GameStateView {
  return {
    mode: { type: "gameComplete" },
    chapter: {
      id: "chapter_1",
      title: "第一章",
      summary: "",
      index: 1,
      total: 1,
    },
    scene: { kind: "linear", id: "scene_1", title: "起點", index: 1, total: 1 },
    inventory: {
      evidence: overrides.evidence ?? [],
      statements: overrides.statements ?? [],
    },
    story: {
      facts: overrides.facts ?? [],
      questions: overrides.questions ?? [],
      objectives: overrides.objectives ?? [],
      authorizations: overrides.authorizations ?? [],
    },
    dialogueHistory: [],
    pendingAcquisition: null,
  };
}

const acquisitionContext: SceneLocationContextView = {
  chapterId: "chapter_1",
  chapterTitle: "第一章",
  sceneId: "scene_1",
  sceneTitle: "雨中現場",
};

const neutralProvenance: CaseRecordProvenance = {
  sourceKind: "unspecified",
  representationLayer: "none",
  proceduralStatus: "unspecified",
  completeness: "unspecified",
  confidence: "unspecified",
  sourceGroupId: null,
  sourceLabel: null,
  proofCapabilities: [],
  supersedesRecordId: null,
};

function evidence(
  id: string,
  supersedesRecordId: EncodedInventoryTarget | null = null,
): EvidenceRecord {
  return {
    id,
    name: `證物 ${id}`,
    description: `證物摘要 ${id}`,
    details: `證物詳情 ${id}`,
    provenance: { ...neutralProvenance, supersedesRecordId },
    imageAssetId: null,
    onReexamine: null,
    collectedInChapterId: "chapter_1",
    collectedInSceneId: "scene_1",
    acquisitionContext,
    sourceGroup: null,
  };
}

function statement(
  id: string,
  supersedesRecordId: EncodedInventoryTarget | null = null,
): StatementRecord {
  return {
    id,
    speaker: "證人",
    content: `證詞 ${id}`,
    provenance: { ...neutralProvenance, supersedesRecordId },
    onReexamine: null,
    acquiredInChapterId: "chapter_1",
    acquiredInSceneId: "scene_1",
    acquisitionContext,
    sourceGroup: null,
  };
}

describe("Case File key normalization", () => {
  it("keeps evidence and statement records with the same slug distinct", () => {
    expect(recordKey({ kind: "evidence", id: "shared" })).toBe(
      "evidence:shared",
    );
    expect(recordKey({ kind: "statement", id: "shared" })).toBe(
      "statement:shared",
    );
    expect(factKey("shared")).toBe("fact:shared");
    expect(parseEncodedRecordTarget("statement:shared")).toEqual({
      kind: "statement",
      id: "shared",
    });
    expect(parseEncodedRecordTarget("fact:shared")).toBeNull();
  });
});

describe("buildCaseFileModel", () => {
  it("groups only public objectives and questions in their player-facing order", () => {
    const model = buildCaseFileModel(
      stateWithCaseFile({
        objectives: [
          {
            id: "future-primary",
            label: "未啟用主要目標",
            summary: "",
            kind: "primary",
            sortOrder: 99,
            completed: false,
            activePrimary: false,
          },
          {
            id: "active-primary",
            label: "目前主要目標",
            summary: "",
            kind: "primary",
            sortOrder: 4,
            completed: false,
            activePrimary: true,
          },
          {
            id: "completed-primary",
            label: "已完成主要目標",
            summary: "",
            kind: "primary",
            sortOrder: 20,
            completed: true,
            activePrimary: true,
          },
          {
            id: "secondary-first",
            label: "第一個次要目標",
            summary: "",
            kind: "secondary",
            sortOrder: 1,
            completed: false,
            activePrimary: false,
          },
          {
            id: "secondary-second",
            label: "第二個次要目標",
            summary: "",
            kind: "secondary",
            sortOrder: 2,
            completed: false,
            activePrimary: false,
          },
          ...["c", "a", "b", "d"].map((id, index) => ({
            id,
            label: `已完成 ${id}`,
            summary: "",
            kind: "secondary" as const,
            sortOrder: index < 3 ? 10 : 2,
            completed: true,
            activePrimary: false,
          })),
        ],
        questions: [
          {
            id: "resolved",
            label: "已解問題",
            summary: "",
            status: "resolved",
            resolvedByFactId: null,
          },
          {
            id: "open",
            label: "未解問題",
            summary: "",
            status: "open",
            resolvedByFactId: null,
          },
        ],
      }),
    );

    expect(model.objectives.activePrimary?.id).toBe("active-primary");
    expect(model.objectives.incompleteSecondaries.map(({ id }) => id)).toEqual([
      "secondary-first",
      "secondary-second",
    ]);
    expect(model.objectives.recentCompleted.map(({ id }) => id)).toEqual([
      "completed-primary",
      "a",
      "b",
    ]);
    expect(model.objectives.earlierCompleted.map(({ id }) => id)).toEqual([
      "c",
      "d",
    ]);
    expect(model.questions.open.map(({ question }) => question.id)).toEqual([
      "open",
    ]);
    expect(model.questions.resolved.map(({ question }) => question.id)).toEqual(
      ["resolved"],
    );
    expect(model.counts).toEqual({
      objective: 8,
      evidence: 0,
      statements: 0,
      facts: 0,
      questions: 2,
      authorizations: 0,
    });
    expect(model.itemsByKey.has("objective:future-primary")).toBe(false);
  });

  it("normalizes direct support and acquired cross-kind successor navigation", () => {
    const model = buildCaseFileModel(
      stateWithCaseFile({
        evidence: [evidence("shared")],
        statements: [
          statement("shared"),
          statement("revised", "evidence:shared"),
        ],
        facts: [
          {
            id: "shared",
            label: "事實",
            summary: "",
            details: "",
            category: "時序",
            assertedInChapterId: "chapter_1",
            assertedInSceneId: "scene_1",
            firstOrigin: {
              type: "sceneEvent",
              chapterId: "chapter_1",
              sceneId: "scene_1",
              blockKind: "hotspot",
              blockId: "desk",
            },
            originContext: {
              type: "scene",
              originKind: "sceneEvent",
              location: acquisitionContext,
            },
            supportingRecords: [
              { kind: "evidence", id: "shared" },
              { kind: "statement", id: "shared" },
            ],
            supportingFactIds: ["supporting-fact"],
          },
          {
            id: "supporting-fact",
            label: "支持事實",
            summary: "",
            details: "",
            category: "時序",
            assertedInChapterId: null,
            assertedInSceneId: null,
            firstOrigin: { type: "migration", migrationId: "legacy" },
            originContext: { type: "migration" },
            supportingRecords: [],
            supportingFactIds: [],
          },
        ],
      }),
    );

    const sharedFact = model.facts.find(({ fact }) => fact.id === "shared");
    expect(sharedFact?.supportingRecordKeys).toEqual([
      "evidence:shared",
      "statement:shared",
    ]);
    expect(sharedFact?.supportingFactKeys).toEqual(["fact:supporting-fact"]);
    expect(model.acquiredSuccessorByRecordKey.get("evidence:shared")).toEqual({
      kind: "statement",
      id: "revised",
    });
    expect(model.recordsByKey.get("evidence:shared")?.successor).toEqual({
      kind: "statement",
      id: "revised",
    });
    expect(model.recordsByKey.get("statement:revised")?.predecessor).toEqual({
      kind: "evidence",
      id: "shared",
    });
  });

  it("omits malformed and dangling relation targets without exposing their raw IDs", () => {
    const model = buildCaseFileModel(
      stateWithCaseFile({
        evidence: [evidence("visible", "statement:hidden")],
        statements: [
          statement("invalid", "fact:not-a-record" as EncodedInventoryTarget),
        ],
        facts: [
          {
            id: "fact",
            label: "可見事實",
            summary: "",
            details: "",
            category: "程序",
            assertedInChapterId: null,
            assertedInSceneId: null,
            firstOrigin: { type: "migration", migrationId: "legacy" },
            originContext: { type: "migration" },
            supportingRecords: [{ kind: "evidence", id: "hidden" }],
            supportingFactIds: ["hidden-fact"],
          },
        ],
      }),
    );

    expect(model.recordsByKey.get("evidence:visible")?.predecessor).toBeNull();
    expect(model.recordsByKey.get("statement:invalid")?.predecessor).toBeNull();
    expect(model.acquiredSuccessorByRecordKey.size).toBe(0);
    expect(model.facts[0]?.supportingRecordKeys).toEqual([]);
    expect(model.facts[0]?.supportingFactKeys).toEqual([]);
    expect(JSON.stringify(model)).not.toContain("hidden");
    expect(JSON.stringify(model)).not.toContain("not-a-record");
  });
});

describe("hasVisibleProvenance", () => {
  it("hides a completely neutral record without acquired lineage", () => {
    expect(hasVisibleProvenance(evidence("neutral"), null)).toBe(false);
  });
});
