import { describe, expect, it } from "vitest";
import {
  brokenQuestionProgress,
  currentInterrogationPhase,
  interrogationLineText,
  isInterrogationPresentationActive,
} from "./presentation";
import type { Mode, SceneView } from "../state/types";

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
): Extract<Mode, { type: "dialogue" }> {
  return {
    type: "dialogue",
    current: { kind: "line", speaker: "嫌疑人", text: "我沒去。" },
    queueRemaining: 0,
    sceneTag: null,
    queueToken: { sceneId: "interrogation_1", queueGen: 1, cursor: 0 },
    crossExamLineId,
    backgroundAssetId: null,
    bgm: null,
    bgs: null,
  };
}

describe("interrogation presentation helpers", () => {
  it("only activates the stage for an interrogation mode or a tagged cross-exam dialogue", () => {
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
    expect(
      isInterrogationPresentationActive(scene, dialogueMode("line_1")),
    ).toBe(true);
    expect(isInterrogationPresentationActive(scene, dialogueMode(null))).toBe(
      false,
    );
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
});
