import { describe, expect, it } from "vitest";
import {
  brokenQuestionProgress,
  currentInterrogationPhase,
  filterPresentableRecords,
  interrogationLineText,
  isInterrogationPresentationActive,
  presentableRecords,
  type PresentableRecord,
} from "./presentation";
import type { Mode, SceneView } from "../state/types";
import {
  neutralCaseRecordProvenance,
  neutralEvidenceRecordView,
  neutralStatementRecordView,
} from "../state/test-fixtures";

type InterrogationSceneView = Extract<SceneView, { kind: "interrogation" }>;

function interrogationScene(
  currentPhaseId: string | null = "phase_1",
): InterrogationSceneView {
  return {
    kind: "interrogation",
    id: "interrogation_1",
    title: "訊問",
    summary: "",
    index: 0,
    total: 1,
    currentPhaseId,
    visiblePhases: [
      {
        id: "phase_1",
        label: "第一階段",
        subject: {
          id: "suspect_1",
          name: "嫌疑人",
          role: "店員",
          bio: "",
          portrait: null,
        },
        questions: [
          { id: "q_1", label: "第一問", broken: false },
          { id: "q_2", label: "第二問", broken: true },
          { id: "q_3", label: "第三問", broken: false },
        ],
        crossExam: null,
        canComplete: false,
      },
    ],
  };
}

function dialogueMode(
  crossExamLineId: string | null,
  sceneId = "interrogation_1",
): Extract<Mode, { type: "dialogue" }> {
  return {
    type: "dialogue",
    promptFeedback: null,
    current: { kind: "line", speaker: "嫌疑人", text: "我沒去。" },
    queueRemaining: 0,
    sceneTag: null,
    queueToken: { sceneId, queueGen: 1, cursor: 0 },
    crossExamLineId,
    backgroundAssetId: null,
    bgm: null,
    bgs: null,
  };
}

describe("interrogation presentation helpers", () => {
  it("keeps same-scene dialogue active even without a cross-exam line and rejects another scene", () => {
    const scene = interrogationScene();

    expect(
      isInterrogationPresentationActive(scene, {
        type: "interrogation",
        phaseId: "phase_1",
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      }),
    ).toBe(true);
    expect(isInterrogationPresentationActive(scene, dialogueMode(null))).toBe(
      true,
    );
    expect(
      isInterrogationPresentationActive(scene, dialogueMode(null, "scene_2")),
    ).toBe(false);
  });

  it("returns the visible phase selected by the scene", () => {
    const phase = currentInterrogationPhase(interrogationScene());

    expect(phase?.id).toBe("phase_1");
    expect(currentInterrogationPhase(interrogationScene("missing"))).toBeNull();
  });

  it("returns null for a non-interrogation scene", () => {
    const linearScene = {
      kind: "linear" as const,
      id: "scene_1",
      title: "",
      summary: "",
      index: 0,
      total: 1,
    };
    expect(currentInterrogationPhase(linearScene)).toBeNull();
    expect(
      isInterrogationPresentationActive(linearScene, dialogueMode(null)),
    ).toBe(false);
  });

  it("counts broken questions from the current phase", () => {
    expect(
      brokenQuestionProgress(currentInterrogationPhase(interrogationScene())),
    ).toEqual({
      broken: 1,
      total: 3,
    });
    expect(brokenQuestionProgress(null)).toEqual({ broken: 0, total: 0 });
  });

  it("renders only narration and spoken text from a testimony line", () => {
    expect(
      interrogationLineText([
        { kind: "sceneTag", text: "雨聲。" },
        { kind: "action", text: "她移開視線。" },
        { kind: "line", speaker: "嫌疑人", text: "我沒去。" },
      ]),
    ).toBe("她移開視線。我沒去。");
  });

  it("maps Present records once while preserving their engine payload and display fallbacks", () => {
    const evidence = neutralEvidenceRecordView({
      id: "receipt",
      name: "咖啡收據",
      description: "十七點四十二分的消費紀錄。",
      details: "付款末四碼 0192。",
      imageAssetId: "evidence.coffee_receipt",
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "scene_1",
    });
    evidence.provenance = {
      ...neutralCaseRecordProvenance(),
      sourceLabel: "店內收銀匯出",
    };
    const statement = neutralStatementRecordView({
      id: "witness",
      speaker: "目擊者",
      content: "我看見她走進巷子。",
      onReexamine: null,
      acquiredInChapterId: "chapter_1",
      acquiredInSceneId: "scene_1",
    });
    statement.provenance = {
      ...neutralCaseRecordProvenance(),
      sourceLabel: "   ",
    };
    statement.acquisitionContext = {
      ...statement.acquisitionContext,
      sceneTitle: "雨夜巷口",
    };

    expect(
      presentableRecords({ evidence: [evidence], statements: [statement] }),
    ).toEqual([
      {
        kind: "evidence",
        id: "receipt",
        shortName: "咖啡收據",
        typeLabel: "物證 / EVIDENCE",
        sourceTag: "店內收銀匯出",
        description: "十七點四十二分的消費紀錄。",
        details: "付款末四碼 0192。",
        imageAssetId: "evidence.coffee_receipt",
      },
      {
        kind: "statement",
        id: "witness",
        shortName: "目擊者",
        typeLabel: "證言 / STATEMENT",
        sourceTag: "雨夜巷口",
        description: "我看見她走進巷子。",
        details: null,
        imageAssetId: null,
      },
    ]);

    const fallbackEvidence = neutralEvidenceRecordView({
      id: "scene-note",
      name: "現場筆記",
      description: "雨夜巷口的記錄。",
      details: "   ",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "scene_1",
    });
    fallbackEvidence.provenance = {
      ...neutralCaseRecordProvenance(),
      sourceLabel: "   ",
    };
    fallbackEvidence.acquisitionContext = {
      ...fallbackEvidence.acquisitionContext,
      sceneTitle: "雨夜巷口",
    };

    expect(
      presentableRecords({ evidence: [fallbackEvidence], statements: [] })[0],
    ).toMatchObject({
      sourceTag: "雨夜巷口",
      details: null,
    });

    const blankSourceEvidence = neutralEvidenceRecordView({
      id: "blank-source",
      name: "無來源物證",
      description: "沒有來源標籤的物證。",
      details: "",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "scene_1",
    });
    blankSourceEvidence.provenance = {
      ...neutralCaseRecordProvenance(),
      sourceLabel: "   ",
    };
    blankSourceEvidence.acquisitionContext = {
      ...blankSourceEvidence.acquisitionContext,
      sceneTitle: "",
    };

    expect(
      presentableRecords({
        evidence: [blankSourceEvidence],
        statements: [],
      })[0]?.sourceTag,
    ).toBe("物證 / EVIDENCE");
  });
});

describe("filterPresentableRecords", () => {
  function presentable(
    overrides: Partial<PresentableRecord> = {},
  ): PresentableRecord {
    return {
      kind: "evidence",
      id: "record",
      shortName: "",
      typeLabel: "物證 / EVIDENCE",
      sourceTag: "",
      description: "",
      details: null,
      imageAssetId: null,
      ...overrides,
    };
  }

  const searchRecords: PresentableRecord[] = [
    presentable({
      id: "receipt",
      shortName: "咖啡收據",
      sourceTag: "店內收銀匯出",
      description: "十七點四十二分的消費紀錄。",
      details: "付款末四碼 0192。",
    }),
    presentable({
      kind: "statement",
      id: "witness",
      typeLabel: "證言 / STATEMENT",
      shortName: "目擊者",
      sourceTag: "雨夜巷口",
      description: "我看見她走進巷子。",
    }),
    presentable({
      id: "maintenance",
      shortName: "維修單",
      sourceTag: "SR-2307 維修單",
      description: "冷氣主機的維修紀錄。",
      details: "型號 SR-2307。",
    }),
    presentable({
      id: "full-width",
      shortName: "全形編號",
      sourceTag: "檔案室",
      description: "編號ＳＲ－２３０７的影本。",
    }),
    presentable({
      id: "latin",
      shortName: "Coffee Receipt",
      sourceTag: "Store Ledger",
      description: "Printed At 21:17",
    }),
  ];

  it.each([
    ["by shortName", "收據", ["receipt"]],
    ["by sourceTag", "收銀", ["receipt"]],
    ["by description", "走進巷子", ["witness"]],
    ["by details", "0192", ["receipt"]],
    [
      "with a full-width query against half-width text via NFKC",
      "ＳＲ－２３０７",
      ["maintenance", "full-width"],
    ],
    [
      "with a half-width query against full-width text via NFKC",
      "sr-2307",
      ["maintenance", "full-width"],
    ],
    ["case-insensitively from a lowercase query", "coffee receipt", ["latin"]],
    ["case-insensitively from an uppercase query", "COFFEE RECEIPT", ["latin"]],
    ["with surrounding whitespace trimmed", "  目擊  ", ["witness"]],
    ["to no record", "不存在的關鍵字", []],
  ])("filters records %s", (_case, query, expectedIds) => {
    expect(
      filterPresentableRecords(searchRecords, query).map((record) => record.id),
    ).toEqual(expectedIds);
  });

  it("returns the same records array for an empty query", () => {
    expect(filterPresentableRecords(searchRecords, "")).toBe(searchRecords);
    expect(filterPresentableRecords(searchRecords, "   ")).toBe(searchRecords);
  });

  it("keeps the original order and kind/id of matches without mutating the source", () => {
    const filtered = filterPresentableRecords(searchRecords, "ＳＲ－２３０７");

    expect(filtered.map((record) => [record.kind, record.id])).toEqual([
      ["evidence", "maintenance"],
      ["evidence", "full-width"],
    ]);
    expect(filtered[0]).toBe(searchRecords[2]);
    expect(searchRecords.map((record) => record.id)).toEqual([
      "receipt",
      "witness",
      "maintenance",
      "full-width",
      "latin",
    ]);
  });
});
