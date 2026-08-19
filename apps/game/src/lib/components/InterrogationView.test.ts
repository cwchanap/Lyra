import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import InterrogationView from "./InterrogationView.svelte";
import type { SceneView } from "../state/types";

type InterrogationSceneView = Extract<SceneView, { kind: "interrogation" }>;

function sceneWithMenu(): InterrogationSceneView {
  return {
    kind: "interrogation",
    id: "interrogation_1",
    title: "訊問",
    summary: "",
    index: 0,
    total: 1,
    currentPhaseId: "phase_1",
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

function sceneInPresenting(): InterrogationSceneView {
  const scene = sceneWithMenu();
  const phase = scene.visiblePhases[0];
  return {
    ...scene,
    visiblePhases: [
      {
        ...phase,
        crossExam: {
          questionId: "q_alibi",
          lineId: "l_deny",
          lineLabel: "否認",
          lineContent: [
            { kind: "line", speaker: "嫌疑人", text: "我當晚沒有去過那裡。" },
          ],
          lineIndex: 0,
          lineTotal: 3,
          presenting: true,
        },
      },
    ],
  };
}

function sceneWithBio(bio: string): InterrogationSceneView {
  const scene = sceneWithMenu();
  const phase = scene.visiblePhases[0];
  return {
    ...scene,
    visiblePhases: [
      {
        ...phase,
        subject: { ...phase.subject, bio },
      },
    ],
  };
}

function sceneWithNoCurrentPhase(): InterrogationSceneView {
  return { ...sceneWithMenu(), currentPhaseId: null };
}

function renderView(
  scene: SceneView,
  overrides?: {
    onAsk?: (questionId: string) => void | Promise<void>;
    onComplete?: () => void | Promise<void>;
    disabled?: boolean;
  },
) {
  return render(InterrogationView, {
    scene,
    onAsk: overrides?.onAsk ?? vi.fn(),
    onComplete: overrides?.onComplete ?? vi.fn(),
    disabled: overrides?.disabled ?? false,
  });
}

describe("InterrogationView", () => {
  it("shows the current phase's question record", () => {
    const { getByText } = renderView(sceneWithMenu());

    expect(getByText("當晚行蹤")).toBeTruthy();
  });

  it("keeps question records behind the stage-owned presenting tray", () => {
    const { getByText, queryByText } = renderView(sceneInPresenting());

    expect(getByText("當晚行蹤")).toBeTruthy();
    expect(queryByText("針對此句提出證據 · PRESENT")).toBeNull();
  });

  it("leaves subject biography chrome to the surrounding stage", () => {
    const { queryByText } = renderView(sceneWithBio("沉默寡言的店員。"));

    expect(queryByText("沉默寡言的店員。")).toBeNull();
  });

  it("calls onAsk with the current question id", async () => {
    const onAsk = vi.fn();
    const { getByText } = renderView(sceneWithMenu(), { onAsk });

    await fireEvent.click(getByText("當晚行蹤"));

    expect(onAsk).toHaveBeenCalledExactlyOnceWith("q_alibi");
  });

  it("disables 完成訊問 until the phase is completable", () => {
    const { getByRole } = renderView(sceneWithMenu());

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

  it("shows the muted placeholder when the interrogation has no current phase", () => {
    const { getByText, queryByText } = renderView(sceneWithNoCurrentPhase());

    expect(getByText("尚未進入任何訊問階段。")).toBeTruthy();
    expect(queryByText("當晚行蹤")).toBeNull();
  });

  it("disables the remaining phase controls while a game command is in flight", () => {
    const { getAllByRole } = renderView(sceneWithCompletableMenu(), {
      disabled: true,
    });

    for (const button of getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
