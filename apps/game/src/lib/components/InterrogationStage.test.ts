import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import InterrogationStageHarness from "$lib/test-harnesses/InterrogationStageHarness.svelte";
import type { Inventory, Mode, SceneView } from "../state/types";

type InterrogationSceneView = Extract<SceneView, { kind: "interrogation" }>;

const inventory: Inventory = { evidence: [], statements: [] };

function scene(presenting = false): InterrogationSceneView {
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
          name: "三宅聰太",
          role: "證人",
          bio: "沉默地避開視線。",
        },
        questions: [
          { id: "q_1", label: "第一問", broken: true },
          { id: "q_2", label: "第二問", broken: false },
          { id: "q_3", label: "第三問", broken: false },
        ],
        crossExam: presenting
          ? {
              questionId: "q_1",
              lineId: "line_1",
              lineLabel: "否認",
              lineContent: [
                { kind: "line", speaker: "三宅聰太", text: "我不知道。" },
              ],
              lineIndex: 0,
              lineTotal: 1,
              presenting: true,
            }
          : null,
        canComplete: false,
      },
    ],
  };
}

const interrogationMode: Mode = {
  type: "interrogation",
  phaseId: "phase_1",
  backgroundAssetId: null,
  bgm: null,
  bgs: null,
};

const ordinaryDialogue: Mode = {
  type: "dialogue",
  current: { kind: "action", text: "普通對話" },
  queueRemaining: 0,
  sceneTag: null,
  queueToken: { sceneId: "scene_1", queueGen: 1, cursor: 0 },
  crossExamLineId: null,
  backgroundAssetId: null,
  bgm: null,
  bgs: null,
};

function props(
  overrides: Partial<{
    active: boolean;
    scene: SceneView;
    mode: Mode;
    disabled: boolean;
    onPresent: (
      lineId: string,
      kind: "evidence" | "statement",
      itemId: string,
    ) => void;
    onResume: () => void;
    onOpenGameMenu: (trigger: HTMLElement) => void;
    onOpenCaseFile: (trigger: HTMLElement) => void;
  }> = {},
) {
  return {
    active: overrides.active ?? true,
    scene: overrides.scene ?? scene(),
    mode: overrides.mode ?? interrogationMode,
    inventory,
    disabled: overrides.disabled ?? false,
    onPresent: overrides.onPresent ?? vi.fn(),
    onResume: overrides.onResume ?? vi.fn(),
    onOpenGameMenu: overrides.onOpenGameMenu ?? vi.fn(),
    onOpenCaseFile: overrides.onOpenCaseFile ?? vi.fn(),
  };
}

describe("InterrogationStage", () => {
  it("keeps its child mounted while active stage chrome exposes live subject progress", async () => {
    const user = userEvent.setup();
    const onOpenCaseFile = vi.fn();
    render(InterrogationStageHarness, props({ onOpenCaseFile }));

    expect(screen.getByText("stage child")).toBeInTheDocument();
    expect(screen.getByText("三宅聰太")).toBeInTheDocument();
    expect(screen.getByText("證人")).toBeInTheDocument();
    expect(screen.getByText("第一階段")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /案件檔案/ }));
    expect(onOpenCaseFile).toHaveBeenCalledExactlyOnceWith(
      expect.any(HTMLElement),
    );
  });

  it("removes only its chrome while inactive and leaves the wrapped mode child intact", async () => {
    const result = render(InterrogationStageHarness, props());

    await result.rerender(props({ active: false, mode: ordinaryDialogue }));

    expect(screen.getByText("stage child")).toBeInTheDocument();
    expect(screen.queryByText("三宅聰太")).toBeNull();
    expect(screen.queryByRole("button", { name: /案件檔案/ })).toBeNull();
  });

  it("mounts the Present tray directly from restored engine presentation state", async () => {
    render(InterrogationStageHarness, props({ scene: scene(true) }));

    expect(
      await screen.findByRole("dialog", { name: "提出證據" }),
    ).toBeInTheDocument();
  });
});
