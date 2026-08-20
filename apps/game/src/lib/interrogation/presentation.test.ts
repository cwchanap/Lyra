import { describe, expect, it } from "vitest";
import {
  brokenQuestionProgress,
  currentInterrogationPhase,
  interrogationLineText,
  isInterrogationPresentationActive,
  presentableRecords,
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
