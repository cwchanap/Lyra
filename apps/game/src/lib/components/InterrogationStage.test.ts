import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { createRawSnippet } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import InterrogationStageHarness from "$lib/test-harnesses/InterrogationStageHarness.svelte";
import InterrogationStage from "./InterrogationStage.svelte";
import {
  closeTopmostEscapeClaim,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import type {
  DialogueHistoryEntry,
  Inventory,
  Mode,
  ObjectiveView,
  PortraitRef,
  SceneView,
} from "../state/types";
import { neutralEvidenceRecordView } from "../state/test-fixtures";

type InterrogationSceneView = Extract<SceneView, { kind: "interrogation" }>;

const inventory: Inventory = { evidence: [], statements: [] };

const menuInventory: Inventory = {
  evidence: [
    neutralEvidenceRecordView({
      id: "evidence_1",
      name: "咖啡收據",
      description: "收據上的時間被圈起。",
      details: "",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "scene_1",
    }),
    neutralEvidenceRecordView({
      id: "evidence_2",
      name: "錄音筆",
      description: "錄音筆裡有一段未公開的錄音。",
      details: "",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "scene_1",
    }),
  ],
  statements: [],
};

const history: DialogueHistoryEntry[] = [
  {
    id: 1,
    kind: "line",
    speaker: "相馬律",
    text: "雨聲太乾淨了。",
    chapterTitle: "雨夜的第一份證詞",
    sceneTitle: "Opening",
  },
];

function scene(
  presenting = false,
  portrait: PortraitRef | null = null,
): InterrogationSceneView {
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
          portrait,
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

function dialogueWithPortrait(
  portrait: PortraitRef,
): Extract<Mode, { type: "dialogue" }> {
  return {
    type: "dialogue",
    current: { kind: "line", speaker: "相馬律", text: "請回答。", portrait },
    queueRemaining: 0,
    queueToken: { sceneId: "interrogation_1", queueGen: 1, cursor: 0 },
    crossExamLineId: null,
    sceneTag: "訊問室",
    backgroundAssetId: "background.interrogation_room",
    bgm: null,
    bgs: null,
  };
}

const activeObjective: ObjectiveView = {
  id: "objective_follow_witness",
  label: "追查雨夜目擊者",
  summary: "找出目擊者隱瞞的證詞。",
  kind: "primary",
  sortOrder: 10,
  completed: false,
  activePrimary: true,
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
    onOpenCaseFile: (
      section: "objective" | "evidence",
      trigger: HTMLElement,
    ) => void;
    inventory?: Inventory;
    history?: DialogueHistoryEntry[];
  }> = {},
) {
  return {
    active: overrides.active ?? true,
    scene: overrides.scene ?? scene(),
    mode: overrides.mode ?? interrogationMode,
    inventory: overrides.inventory ?? inventory,
    history: overrides.history ?? [],
    disabled: overrides.disabled ?? false,
    onPresent: overrides.onPresent ?? vi.fn(),
    onResume: overrides.onResume ?? vi.fn(),
    onOpenGameMenu: overrides.onOpenGameMenu ?? vi.fn(),
    onOpenCaseFile: overrides.onOpenCaseFile ?? vi.fn(),
  };
}

afterEach(() => {
  resetEscapeCoordinator();
});

describe("InterrogationStage", () => {
  it("keeps its child mounted with menu-only controls and live subject progress", async () => {
    const user = userEvent.setup();
    const onOpenCaseFile = vi.fn();
    render(
      InterrogationStageHarness,
      props({
        onOpenCaseFile,
        inventory: menuInventory,
      }),
    );

    expect(screen.getByText("stage child")).toBeInTheDocument();
    expect(screen.getByText("三宅聰太")).toBeInTheDocument();
    expect(screen.getByText("證人")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LOG" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "案件檔案" }),
    ).toBeInTheDocument();
    const locker = screen.getByRole("button", { name: "證物櫃 02" });
    expect(locker).toBeInTheDocument();

    const objective = document.querySelector<HTMLButtonElement>(
      "[data-interrogation-case-file-objective]",
    );
    const meter = document.querySelector(
      "[data-interrogation-broken-progress]",
    );
    expect(objective).toBeInTheDocument();
    expect(meter).toHaveAttribute("role", "progressbar");
    expect(meter).toHaveAttribute("aria-valuenow", "1");
    expect(meter).toHaveAttribute("aria-valuemax", "3");
    expect(meter).toHaveAccessibleName("已突破 1 / 3 題");

    await user.click(objective!);
    expect(onOpenCaseFile).toHaveBeenCalledExactlyOnceWith(
      "objective",
      objective!,
    );
  });

  it("dispatches the evidence Case File section from the locker trigger", async () => {
    const user = userEvent.setup();
    const onOpenCaseFile = vi.fn();
    render(
      InterrogationStageHarness,
      props({ onOpenCaseFile, inventory: menuInventory }),
    );

    const locker = screen.getByRole("button", { name: "證物櫃 02" });
    await user.click(locker);

    expect(onOpenCaseFile).toHaveBeenLastCalledWith("evidence", locker);
  });

  it.each([{ label: "案件檔案" }, { label: "證物櫃 02" }])(
    "closes Stage history before the $label request so Escape reaches Case File",
    async ({ label }) => {
      const user = userEvent.setup();
      let caseFileOpen = false;
      const onOpenCaseFile = vi.fn(() => {
        caseFileOpen = true;
      });
      render(
        InterrogationStageHarness,
        props({ onOpenCaseFile, history, inventory: menuInventory }),
      );

      const log = screen.getByRole("button", { name: "LOG" });
      await user.click(log);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      const trigger = screen.getByRole("button", { name: label });
      await user.click(trigger);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(trigger).toHaveFocus();
      });
      expect(caseFileOpen).toBe(true);

      // Model the GameShell's Case File submenu branch: its root has no
      // nested claim, so Escape closes the submenu only after giving any
      // nested layer (including Stage history) first refusal.
      const dismissCaseFile = () => {
        if (!closeTopmostEscapeClaim()) caseFileOpen = false;
      };
      window.addEventListener("keydown", dismissCaseFile);
      try {
        fireEvent.keyDown(window, { key: "Escape" });
      } finally {
        window.removeEventListener("keydown", dismissCaseFile);
      }

      expect(caseFileOpen).toBe(false);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(trigger).toHaveFocus();
    },
  );

  it("hides menu history and toolbar outside the interrogation menu", async () => {
    const user = userEvent.setup();
    const result = render(
      InterrogationStageHarness,
      props({ history, inventory: menuInventory }),
    );

    await user.click(screen.getByRole("button", { name: "LOG" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await result.rerender(props({ mode: ordinaryDialogue, history }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "LOG" })).toBeNull();
    expect(
      document.querySelector("[data-interrogation-case-file-objective]"),
    ).toBeNull();

    await result.rerender(
      props({ history, inventory: menuInventory, mode: interrogationMode }),
    );
    const log = screen.getByRole("button", { name: "LOG" });
    await user.click(log);
    const historyDialog = screen.getByRole("dialog");
    await user.click(
      within(historyDialog).getByRole("button", { name: "關閉對話紀錄" }),
    );
    await waitFor(() => expect(log).toHaveFocus());
  });

  it("hides the menu-only toolbar while Present is active", () => {
    render(
      InterrogationStageHarness,
      props({ scene: scene(true), inventory: menuInventory }),
    );

    expect(screen.queryByRole("button", { name: "LOG" })).toBeNull();
    expect(
      document.querySelector("[data-interrogation-case-file-objective]"),
    ).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "提出證據" }),
    ).toBeInTheDocument();
  });

  it("removes only its chrome while inactive and leaves the wrapped mode child intact", async () => {
    const result = render(InterrogationStageHarness, props());

    await result.rerender(props({ active: false, mode: ordinaryDialogue }));

    expect(screen.getByText("stage child")).toBeInTheDocument();
    expect(screen.queryByText("三宅聰太")).toBeNull();
    expect(screen.queryByRole("button", { name: "案件檔案" })).toBeNull();
  });

  it("renders the primary objective exactly once inside the active stage", () => {
    render(InterrogationStage, {
      ...props(),
      activePrimaryObjective: activeObjective,
      children: createRawSnippet(() => ({
        render: () => '<p data-testid="stage-child">stage child</p>',
      })),
    });

    expect(screen.getAllByRole("status", { name: "主要目標" })).toHaveLength(1);
    expect(screen.getByTestId("stage-child")).toBeInTheDocument();
  });

  it("keeps one stage-owned backdrop mounted across interrogation and same-scene dialogue", async () => {
    const interrogation: Extract<Mode, { type: "interrogation" }> = {
      ...interrogationMode,
      backgroundAssetId: "background.interrogation_room",
    };
    const dialogue: Extract<Mode, { type: "dialogue" }> = {
      ...dialogueWithPortrait({
        characterId: "miyake_sota",
        expression: "standard",
        assetId: "portrait.miyake_sota.standard",
      }),
      backgroundAssetId: "background.interrogation_room_evening",
    };
    const result = render(
      InterrogationStageHarness,
      props({ mode: interrogation }),
    );
    const backdrop = await waitFor(() => {
      const element = document.querySelector(
        '[data-save-thumbnail-layout="backdrop"]',
      );
      if (!element) throw new Error("stage backdrop not mounted");
      return element;
    });

    await result.rerender(props({ mode: dialogue }));

    expect(
      document.querySelector('[data-save-thumbnail-layout="backdrop"]'),
    ).toBe(backdrop);
  });

  it("mounts no stage backdrop for non-dialogue modes", () => {
    render(
      InterrogationStageHarness,
      props({
        mode: {
          type: "explore",
          sublocationId: "sub_1",
          backgroundAssetId: null,
          bgm: null,
          bgs: null,
        },
      }),
    );

    expect(
      document.querySelector('[data-save-thumbnail-layout="backdrop"]'),
    ).toBeNull();
  });

  it("uses the phase subject standard portrait for interrogation menu art", async () => {
    const subjectPortrait: PortraitRef = {
      characterId: "miyake_sota",
      expression: "standard",
      assetId: "portrait.miyake_sota.standard",
    };
    const { container } = render(
      InterrogationStageHarness,
      props({ scene: scene(false, subjectPortrait) }),
    );

    await waitFor(() => {
      expect(
        container.querySelector(
          'img.interrogation-subject-portrait[src*="miyake_sota/standard"]',
        ),
      ).toBeInTheDocument();
    });
  });

  it("uses the current dialogue expression instead of the subject standard portrait", async () => {
    const subjectPortrait: PortraitRef = {
      characterId: "miyake_sota",
      expression: "standard",
      assetId: "portrait.miyake_sota.standard",
    };
    const expressionPortrait: PortraitRef = {
      characterId: "miyake_sota",
      expression: "concerned",
      assetId: "portrait.miyake_sota.concerned",
    };
    const { container } = render(
      InterrogationStageHarness,
      props({
        scene: scene(false, subjectPortrait),
        mode: dialogueWithPortrait(expressionPortrait),
      }),
    );

    await waitFor(() => {
      expect(
        container.querySelector(
          'img.interrogation-subject-portrait[src*="miyake_sota/concerned"]',
        ),
      ).toBeInTheDocument();
    });
  });

  it("falls back to the subject portrait for a portraitless dialogue line", async () => {
    const subjectPortrait: PortraitRef = {
      characterId: "miyake_sota",
      expression: "standard",
      assetId: "portrait.miyake_sota.standard",
    };
    const portraitlessDialogue: Extract<Mode, { type: "dialogue" }> = {
      ...dialogueWithPortrait(subjectPortrait),
      current: { kind: "line", speaker: "相馬律", text: "請回答。" },
    };
    const { container } = render(
      InterrogationStageHarness,
      props({
        scene: scene(false, subjectPortrait),
        mode: portraitlessDialogue,
      }),
    );

    await waitFor(() => {
      expect(
        container.querySelector(
          'img.interrogation-subject-portrait[src*="miyake_sota/standard"]',
        ),
      ).toBeInTheDocument();
    });
  });

  it("follows a non-subject speaker portrait during same-scene dialogue", async () => {
    const subjectPortrait: PortraitRef = {
      characterId: "miyake_sota",
      expression: "standard",
      assetId: "portrait.miyake_sota.standard",
    };
    const speakerPortrait: PortraitRef = {
      characterId: "soma_ritsu",
      expression: "focused",
      assetId: "portrait.soma_ritsu.focused",
    };
    const { container } = render(
      InterrogationStageHarness,
      props({
        scene: scene(false, subjectPortrait),
        mode: dialogueWithPortrait(speakerPortrait),
      }),
    );

    await waitFor(() => {
      expect(
        container.querySelector(
          'img.interrogation-subject-portrait[src*="soma_ritsu/focused"]',
        ),
      ).toBeInTheDocument();
    });
  });

  it("mounts the Present tray directly from restored engine presentation state", async () => {
    render(InterrogationStageHarness, props({ scene: scene(true) }));

    expect(
      await screen.findByRole("dialog", { name: "提出證據" }),
    ).toBeInTheDocument();
  });

  it("does not open the case file when the stage is disabled", async () => {
    const onOpenCaseFile = vi.fn();
    render(
      InterrogationStageHarness,
      props({ disabled: true, onOpenCaseFile }),
    );

    // fireEvent.click bypasses the native disabled button guard in jsdom,
    // reaching the openCaseFile handler so its internal `if (disabled) return`
    // guard is exercised. userEvent.click would respect the disabled state
    // and never dispatch the click, leaving the guard's return branch
    // uncovered.
    await fireEvent.click(screen.getByRole("button", { name: "案件檔案" }));
    expect(onOpenCaseFile).not.toHaveBeenCalled();
  });

  it("stores a null tray return focus when no HTMLElement has focus when presenting begins", async () => {
    // When the presenting state transitions from false to true while
    // document.activeElement is not an HTMLElement (e.g. null), the tray
    // return focus must be null rather than throwing or storing a bad ref.
    const activeElementSpy = vi
      .spyOn(Document.prototype, "activeElement", "get")
      .mockReturnValue(null);

    try {
      const { rerender } = render(
        InterrogationStageHarness,
        props({ scene: scene(false) }),
      );

      // Transition to presenting while activeElement is null.
      rerender(props({ scene: scene(true) }));

      expect(
        await screen.findByRole("dialog", { name: "提出證據" }),
      ).toBeInTheDocument();
    } finally {
      activeElementSpy.mockRestore();
    }
  });

  it("does not recapture focus when presenting stays true across a scene rerender", async () => {
    // The $effect that captures trayReturnFocus guards on
    // `presenting && !wasPresenting`. When presenting is already true and
    // the scene rerenders with presenting still true, the effect does not
    // re-run (presenting hasn't changed). This test verifies the tray
    // remains mounted and functional across such a rerender.
    const { rerender } = render(
      InterrogationStageHarness,
      props({ scene: scene(true) }),
    );

    expect(
      await screen.findByRole("dialog", { name: "提出證據" }),
    ).toBeInTheDocument();

    // Rerender with the same presenting state (different scene object but
    // same presenting=true). The tray must stay mounted.
    rerender(props({ scene: scene(true) }));
    expect(
      screen.getByRole("dialog", { name: "提出證據" }),
    ).toBeInTheDocument();
  });

  it("does not open Stage history when the stage is disabled", async () => {
    // The LOG button's onclick handler openStageHistory guards on
    // `if (!disabled)`. fireEvent.click bypasses the native disabled button
    // guard in jsdom, reaching the handler so its return branch is exercised.
    render(InterrogationStageHarness, props({ disabled: true, history }));

    await fireEvent.click(screen.getByRole("button", { name: "LOG" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides the subject record when the current phase is not found", () => {
    // When currentPhaseId doesn't match any visible phase, phase is null and
    // the {#if phase} block doesn't render. This covers the false arm of the
    // phase guard and the empty-questions progress fallback.
    render(
      InterrogationStageHarness,
      props({
        scene: {
          ...scene(),
          currentPhaseId: "missing_phase",
        },
      }),
    );

    expect(screen.queryByText("三宅聰太")).toBeNull();
    expect(screen.queryByText("INTERROGATION / 訊問中")).toBeNull();
  });

  it("renders zero-progress meter when the current phase has no questions", () => {
    // When the phase has an empty questions array, brokenQuestionProgress
    // returns { broken: 0, total: 0 }. The progress bar's
    // `progress.total === 0 ? 0 : ...` ternary must take the zero arm.
    render(
      InterrogationStageHarness,
      props({
        scene: {
          ...scene(),
          visiblePhases: [
            {
              ...scene().visiblePhases[0],
              questions: [],
            },
          ],
        },
      }),
    );

    const meter = document.querySelector(
      "[data-interrogation-broken-progress]",
    );
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "0");
    expect(meter).toHaveAccessibleName("已突破 0 / 0 題");
  });
});
