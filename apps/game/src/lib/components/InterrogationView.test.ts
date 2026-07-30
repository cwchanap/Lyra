import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import InterrogationView from "./InterrogationView.svelte";
import type { Inventory, SceneView } from "../state/types";
import {
  neutralEvidenceRecordView,
  neutralStatementRecordView,
} from "../state/test-fixtures";

// Narrows SceneView down to the interrogation arm so fixtures can be built
// (and spread/mutated) with visiblePhases/currentPhaseId in scope, without
// the function's own return-type annotation widening it back to the full
// SceneView union.
type InterrogationSceneView = Extract<SceneView, { kind: "interrogation" }>;

function sampleInventory(): Inventory {
  return {
    evidence: [
      neutralEvidenceRecordView({
        id: "cleaning_log",
        name: "清掃日誌",
        description: "記錄了當晚的清潔時段。",
        details: "頁面上的時間欄被劃掉重寫。",
        imageAssetId: null,
        onReexamine: null,
        collectedInChapterId: "chapter_1",
        collectedInSceneId: "scene_0",
      }),
    ],
    statements: [
      neutralStatementRecordView({
        id: "stmt_clerk",
        speaker: "店員的證言",
        content: "當晚的清掃時段。",
        onReexamine: null,
        acquiredInChapterId: "chapter_1",
        acquiredInSceneId: "scene_0",
      }),
    ],
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
  const scene = sceneWithMenu();
  return { ...scene, currentPhaseId: null };
}

function renderView(
  scene: SceneView,
  overrides?: {
    inventory?: Inventory;
    onAsk?: (questionId: string) => void | Promise<void>;
    onPresent?: (
      lineId: string,
      itemKind: "evidence" | "statement",
      itemId: string,
    ) => void | Promise<void>;
    onResume?: () => void | Promise<void>;
    onComplete?: () => void | Promise<void>;
    disabled?: boolean;
  },
) {
  return render(InterrogationView, {
    scene,
    inventory: overrides?.inventory ?? sampleInventory(),
    onAsk: overrides?.onAsk ?? vi.fn(),
    onPresent: overrides?.onPresent ?? vi.fn(),
    onResume: overrides?.onResume ?? vi.fn(),
    onComplete: overrides?.onComplete ?? vi.fn(),
    disabled: overrides?.disabled ?? false,
  });
}

describe("InterrogationView", () => {
  it("shows the question menu when no cross-exam is active", async () => {
    const { getByText } = renderView(sceneWithMenu()); // crossExam: null, one question "當晚行蹤"
    expect(getByText("當晚行蹤")).toBeTruthy();
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

  it("resumes the testimony (not the menu) when 收回 is clicked in the tray", async () => {
    const onResume = vi.fn();
    const { getByRole } = renderView(sceneInPresenting(), { onResume });
    await fireEvent.click(getByRole("button", { name: "收回" }));
    expect(onResume).toHaveBeenCalledTimes(1);
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

  it("shows the question menu (not the tray) while a testimony is only playing", () => {
    // A non-presenting cross-exam plays in the DialogueBox, so the
    // InterrogationView falls back to the question menu rather than a line card.
    const { getByText, queryByText } = renderView(sceneInPlayback());
    expect(getByText("當晚行蹤")).toBeTruthy();
    expect(queryByText("針對此句提出證據 · PRESENT")).toBeNull();
  });

  it("renders the subject bio when present", () => {
    const { getByText } = renderView(sceneWithBio("沉默寡言的店員。"));
    expect(getByText("沉默寡言的店員。")).toBeTruthy();
  });

  it("omits the bio paragraph when the subject bio is empty", () => {
    const { queryByText } = renderView(sceneWithBio(""));
    expect(queryByText("沉默寡言的店員。")).toBeNull();
  });

  it("calls onAsk with the question id when a question button is clicked", async () => {
    const onAsk = vi.fn();
    const { getByText } = renderView(sceneWithMenu(), { onAsk });
    await fireEvent.click(getByText("當晚行蹤"));
    expect(onAsk).toHaveBeenCalledExactlyOnceWith("q_alibi");
  });

  it("renders statement items in the evidence tray and calls onPresent with statement kind", async () => {
    const onPresent = vi.fn();
    const { getByText } = renderView(sceneInPresenting(), { onPresent });
    // The statement tray button is labelled with the statement's speaker.
    const statementButton = getByText("店員的證言");
    await fireEvent.click(statementButton);
    expect(onPresent).toHaveBeenCalledExactlyOnceWith(
      "l_deny",
      "statement",
      "stmt_clerk",
    );
  });

  it("shows the muted placeholder when the interrogation has no current phase", () => {
    const { getByText, queryByText } = renderView(sceneWithNoCurrentPhase());
    expect(getByText("尚未進入任何訊問階段。")).toBeTruthy();
    // The question menu must not render while no phase is current.
    expect(queryByText("當晚行蹤")).toBeNull();
  });

  it("disables every button when the disabled prop is set in the presenting branch", () => {
    const { getAllByRole } = renderView(sceneInPresenting(), {
      disabled: true,
    });
    // Every button inside the view (evidence/statement tray + 收回) must be
    // disabled so an in-flight command can't be re-triggered mid-dispatch.
    for (const button of getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("disables the 完成訊問 button when disabled is set even if the phase is completable", () => {
    const { getByRole } = renderView(sceneWithCompletableMenu(), {
      disabled: true,
    });
    expect(
      (getByRole("button", { name: "完成訊問" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
