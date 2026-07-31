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
  it("normalizes the complete spoiler-safe populated acceptance wire fixture", () => {
    const syntheticLocation: SceneLocationContextView = {
      chapterId: "synthetic_chapter",
      chapterTitle: "合成測試章",
      sceneId: "synthetic_case_file",
      sceneTitle: "案件檔案測試室",
    };
    const sameSlugEvidence = {
      ...evidence("shared_record"),
      name: "共用代號照片",
      collectedInChapterId: "synthetic_chapter",
      collectedInSceneId: "synthetic_case_file",
      acquisitionContext: syntheticLocation,
      provenance: {
        ...neutralProvenance,
        sourceKind: "digital" as const,
        representationLayer: "raw" as const,
        proceduralStatus: "lead" as const,
        completeness: "complete" as const,
        confidence: "corroborated" as const,
        sourceGroupId: null,
        sourceLabel: "合成照片",
        proofCapabilities: [],
      },
      sourceGroup: null,
    };
    const sharedStatement = {
      ...statement("shared_record"),
      speaker: "目擊者乙",
      content: "我看見簽署檔案移交。",
      acquiredInChapterId: "synthetic_chapter",
      acquiredInSceneId: "synthetic_case_file",
      acquisitionContext: syntheticLocation,
      provenance: {
        ...neutralProvenance,
        sourceKind: "testimony" as const,
        representationLayer: "raw" as const,
        proceduralStatus: "lead" as const,
        completeness: "complete" as const,
        confidence: "corroborated" as const,
        sourceGroupId: "synthetic_bundle",
        sourceLabel: "合成目擊筆錄",
        proofCapabilities: ["identity" as const],
      },
      sourceGroup: {
        id: "synthetic_bundle",
        label: "合成來源組",
        summary: "只公開玩家已取得紀錄所需的來源摘要。",
      },
    };
    const model = buildCaseFileModel(
      stateWithCaseFile({
        evidence: [
          {
            ...evidence("neutral_note"),
            name: "折角便箋",
            collectedInChapterId: "synthetic_chapter",
            collectedInSceneId: "synthetic_case_file",
            acquisitionContext: syntheticLocation,
          },
          sameSlugEvidence,
          {
            ...evidence("signed_scan", "statement:shared_record"),
            name: "簽署掃描",
            collectedInChapterId: "synthetic_chapter",
            collectedInSceneId: "synthetic_case_file",
            acquisitionContext: syntheticLocation,
            provenance: {
              ...neutralProvenance,
              sourceKind: "digital",
              representationLayer: "sync",
              proceduralStatus: "exhibit",
              completeness: "complete",
              confidence: "corroborated",
              sourceGroupId: null,
              sourceLabel: "合成簽署掃描",
              proofCapabilities: ["time", "identity", "source", "procedure"],
              supersedesRecordId: "statement:shared_record",
            },
            sourceGroup: null,
          },
          {
            ...evidence("orphan_scan"),
            name: "孤立掃描",
            collectedInChapterId: "synthetic_chapter",
            collectedInSceneId: "synthetic_case_file",
            acquisitionContext: syntheticLocation,
            provenance: {
              ...neutralProvenance,
              sourceKind: "digital",
              representationLayer: "sync",
              proceduralStatus: "reacquired",
              completeness: "complete",
              confidence: "corroborated",
              sourceLabel: "合成孤立掃描",
              proofCapabilities: ["source"],
            },
          },
        ],
        statements: [sharedStatement],
        facts: [
          {
            id: "fact_clock",
            label: "時鐘已校準",
            summary: "便箋時間可直接採信。",
            details: "校準紀錄與便箋互相吻合。",
            category: "時序",
            assertedInChapterId: "synthetic_chapter",
            assertedInSceneId: "synthetic_case_file",
            firstOrigin: {
              type: "sceneEvent",
              chapterId: "synthetic_chapter",
              sceneId: "synthetic_case_file",
              blockKind: "hotspot",
              blockId: "acceptance_fixture",
            },
            originContext: {
              type: "scene",
              originKind: "sceneEvent",
              location: syntheticLocation,
            },
            supportingRecords: [{ kind: "evidence", id: "neutral_note" }],
            supportingFactIds: [],
          },
          {
            id: "fact_route",
            label: "路線已確認",
            summary: "目擊筆錄支持移動路線。",
            details: "路線結論同時依賴時鐘事實。",
            category: "位置",
            assertedInChapterId: "synthetic_chapter",
            assertedInSceneId: "synthetic_case_file",
            firstOrigin: {
              type: "sceneEvent",
              chapterId: "synthetic_chapter",
              sceneId: "synthetic_case_file",
              blockKind: "hotspot",
              blockId: "acceptance_fixture",
            },
            originContext: {
              type: "scene",
              originKind: "sceneEvent",
              location: syntheticLocation,
            },
            supportingRecords: [{ kind: "statement", id: "shared_record" }],
            supportingFactIds: ["fact_clock"],
          },
        ],
        questions: [
          {
            id: "question_open",
            label: "誰留下便箋？",
            summary: "仍需確認便箋作者。",
            status: "open",
            resolvedByFactId: null,
          },
          {
            id: "question_resolved",
            label: "目擊路線為何？",
            summary: "已由路線事實解答。",
            status: "resolved",
            resolvedByFactId: "fact_route",
          },
        ],
        objectives: [
          {
            id: "objective_primary",
            label: "確認合成檔案",
            summary: "核對所有已揭露資料。",
            kind: "primary",
            sortOrder: 1,
            completed: false,
            activePrimary: true,
          },
          ...[
            ["objective_secondary_a", "核對來源", 2, false],
            ["objective_secondary_b", "核對時間", 3, false],
            ["objective_completed_1", "完成舊線索一", 10, true],
            ["objective_completed_2", "完成舊線索二", 11, true],
            ["objective_completed_3", "完成舊線索三", 12, true],
            ["objective_completed_4", "完成舊線索四", 13, true],
          ].map(([id, label, sortOrder, completed]) => ({
            id: id as string,
            label: label as string,
            summary: `${label as string}摘要。`,
            kind: "secondary" as const,
            sortOrder: sortOrder as number,
            completed: completed as boolean,
            activePrimary: false,
          })),
        ],
        authorizations: [
          {
            id: "authorization_archive",
            label: "調閱合成檔案",
            summary: "可調閱本測試的合成來源。",
            grantingAuthority: "測試管理員",
            grantedInChapterId: "synthetic_chapter",
            grantedInSceneId: "synthetic_case_file",
            firstOrigin: {
              type: "sceneEvent",
              chapterId: "synthetic_chapter",
              sceneId: "synthetic_case_file",
              blockKind: "hotspot",
              blockId: "acceptance_fixture",
            },
            originContext: {
              type: "scene",
              originKind: "sceneEvent",
              location: syntheticLocation,
            },
          },
        ],
      }),
    );

    expect(model.counts).toEqual({
      objective: 7,
      evidence: 4,
      statements: 1,
      facts: 2,
      questions: 2,
      authorizations: 1,
    });
    expect(model.objectives.activePrimary?.id).toBe("objective_primary");
    expect(model.objectives.incompleteSecondaries.map(({ id }) => id)).toEqual([
      "objective_secondary_a",
      "objective_secondary_b",
    ]);
    expect(model.objectives.recentCompleted.map(({ id }) => id)).toEqual([
      "objective_completed_4",
      "objective_completed_3",
      "objective_completed_2",
    ]);
    expect(model.objectives.earlierCompleted.map(({ id }) => id)).toEqual([
      "objective_completed_1",
    ]);
    expect(
      model.recordsByKey.get("statement:shared_record")?.successor,
    ).toEqual({ kind: "evidence", id: "signed_scan" });
    expect(model.recordsByKey.get("evidence:signed_scan")?.predecessor).toEqual(
      { kind: "statement", id: "shared_record" },
    );
    expect(
      model.facts.find(({ fact }) => fact.id === "fact_route")
        ?.supportingRecordKeys,
    ).toEqual(["statement:shared_record"]);
    expect(
      model.facts.find(({ fact }) => fact.id === "fact_route")
        ?.supportingFactKeys,
    ).toEqual(["fact:fact_clock"]);
    expect(model.questions.resolved[0]?.resolvedFactKey).toBe(
      "fact:fact_route",
    );
    expect([...model.itemsByKey.keys()]).toEqual([
      "evidence:neutral_note",
      "evidence:shared_record",
      "evidence:signed_scan",
      "evidence:orphan_scan",
      "statement:shared_record",
      "fact:fact_clock",
      "fact:fact_route",
      "question:question_open",
      "question:question_resolved",
      "objective:objective_primary",
      "objective:objective_secondary_a",
      "objective:objective_secondary_b",
      "objective:objective_completed_4",
      "objective:objective_completed_3",
      "objective:objective_completed_2",
      "objective:objective_completed_1",
      "authorization:authorization_archive",
    ]);
  });

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
