import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import InterrogationView from "./InterrogationView.svelte";
import type { Inventory, SceneView } from "../state/types";

// Narrows SceneView down to the interrogation arm so fixtures can be built
// (and spread/mutated) with visiblePhases/currentPhaseId in scope, without
// the function's own return-type annotation widening it back to the full
// SceneView union.
type InterrogationSceneView = Extract<SceneView, { kind: "interrogation" }>;

function sampleInventory(): Inventory {
  return {
    evidence: [
      {
        id: "cleaning_log",
        name: "清掃日誌",
        description: "記錄了當晚的清潔時段。",
        details: "頁面上的時間欄被劃掉重寫。",
        imageAssetId: null,
        onReexamine: null,
        collectedInChapterId: "chapter_1",
        collectedInSceneId: "scene_0",
      },
    ],
    statements: [],
  };
}

function sceneWithMenu(): InterrogationSceneView {
  return {
    kind: "interrogation",
    id: "interrogation_1",
    title: "訊問",
    index: 0,
    total: 1,
    currentPhaseId: "phase_1",
    visiblePhases: [
      {
        id: "phase_1",
        label: "第一階段",
        subject: { id: "suspect_1", name: "嫌疑人", role: "店員", bio: "" },
        questions: [{ id: "q_alibi", label: "當晚行蹤", broken: false }],
        crossExam: null,
        canComplete: false,
      },
    ],
  };
}

function sceneWithCompletableMenu(): InterrogationSceneView {
  const scene = sceneWithMenu();
  const phase = scene.visiblePhases[0];
  return {
    ...scene,
    visiblePhases: [
      {
        ...phase,
        questions: [{ id: "q_alibi", label: "當晚行蹤", broken: true }],
        canComplete: true,
      },
    ],
  };
}

function sceneInPlayback(): InterrogationSceneView {
  return {
    kind: "interrogation",
    id: "interrogation_1",
    title: "訊問",
    index: 0,
    total: 1,
    currentPhaseId: "phase_1",
    visiblePhases: [
      {
        id: "phase_1",
        label: "第一階段",
        subject: { id: "suspect_1", name: "嫌疑人", role: "店員", bio: "" },
        questions: [{ id: "q_alibi", label: "當晚行蹤", broken: false }],
        crossExam: {
          questionId: "q_alibi",
          lineId: "l_deny",
          lineLabel: "否認",
          lineContent: [
            { kind: "line", speaker: "嫌疑人", text: "我當晚沒有去過那裡。" },
          ],
          lineIndex: 0,
          lineTotal: 3,
          presenting: false,
        },
        canComplete: false,
      },
    ],
  };
}

function sceneInPresenting(): InterrogationSceneView {
  const scene = sceneInPlayback();
  const phase = scene.visiblePhases[0];
  return {
    ...scene,
    visiblePhases: [
      {
        ...phase,
        crossExam: { ...phase.crossExam!, presenting: true },
      },
    ],
  };
}

function renderView(
  scene: SceneView,
  overrides?: {
    inventory?: Inventory;
    onAsk?: (questionId: string) => void | Promise<void>;
    onProceed?: () => void | Promise<void>;
    onChallenge?: (lineId: string) => void | Promise<void>;
    onPresent?: (
      lineId: string,
      itemKind: "evidence" | "statement",
      itemId: string,
    ) => void | Promise<void>;
    onWithdraw?: () => void | Promise<void>;
    onComplete?: () => void | Promise<void>;
    disabled?: boolean;
  },
) {
  return render(InterrogationView, {
    scene,
    inventory: overrides?.inventory ?? sampleInventory(),
    onAsk: overrides?.onAsk ?? vi.fn(),
    onProceed: overrides?.onProceed ?? vi.fn(),
    onChallenge: overrides?.onChallenge ?? vi.fn(),
    onPresent: overrides?.onPresent ?? vi.fn(),
    onWithdraw: overrides?.onWithdraw ?? vi.fn(),
    onComplete: overrides?.onComplete ?? vi.fn(),
    disabled: overrides?.disabled ?? false,
  });
}

describe("InterrogationView", () => {
  it("shows the question menu when no cross-exam is active", async () => {
    const { getByText } = renderView(sceneWithMenu()); // crossExam: null, one question "當晚行蹤"
    expect(getByText("當晚行蹤")).toBeTruthy();
  });

  it("shows 反駁/繼續/退下 controls during playback", () => {
    const { getByRole } = renderView(sceneInPlayback()); // crossExam.presenting === false
    expect(getByRole("button", { name: /反駁/ })).toBeTruthy();
    expect(getByRole("button", { name: /繼續/ })).toBeTruthy();
    expect(getByRole("button", { name: /退下/ })).toBeTruthy();
  });

  it("shows the evidence tray when presenting", () => {
    const { getByText } = renderView(sceneInPresenting()); // crossExam.presenting === true, inventory has 清掃日誌
    expect(getByText("清掃日誌")).toBeTruthy();
  });

  it("calls onPresent with line + item on tray click", async () => {
    const onPresent = vi.fn();
    const { getByText } = renderView(sceneInPresenting(), { onPresent });
    await fireEvent.click(getByText("清掃日誌"));
    expect(onPresent).toHaveBeenCalledWith(
      "l_deny",
      "evidence",
      "cleaning_log",
    );
  });

  it("disables the 完成訊問 button until the phase is completable", () => {
    const { getByRole } = renderView(sceneWithMenu()); // canComplete: false
    expect(
      (getByRole("button", { name: "完成訊問" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("enables 完成訊問 and calls onComplete when the phase is completable", async () => {
    const onComplete = vi.fn();
    const { getByRole } = renderView(sceneWithCompletableMenu(), {
      onComplete,
    });
    const button = getByRole("button", {
      name: "完成訊問",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await fireEvent.click(button);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("hides the 完成訊問 button during an active cross-examination", () => {
    const { queryByRole } = renderView(sceneInPlayback());
    expect(queryByRole("button", { name: "完成訊問" })).toBeNull();
  });
});
