import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beat85CompilerAnalysisInventoryFixture,
  beat85CompilerAnalysisSceneFixture,
  beat85CompilerAnalysisModeFixture,
  p1PracticeAnalysisModeFixture,
  p1PracticeAnalysisSceneFixture,
} from "$lib/analysis/test-fixtures";
import type {
  AnalysisActionToken,
  AnalysisDraft,
  GameStateView,
  Mode,
  SceneView,
} from "$lib/state/types";
import AnalysisWorkbench from "./AnalysisWorkbench.svelte";

type AnalysisScene = Extract<SceneView, { kind: "analysis" }>;
type AnalysisModeView = Extract<Mode, { type: "analysis" }>;

function analysisState(
  overrides: {
    scene?: Partial<AnalysisScene>;
    mode?: Partial<AnalysisModeView>;
  } = {},
): GameStateView {
  const scene: AnalysisScene = {
    ...beat85CompilerAnalysisSceneFixture,
    ...overrides.scene,
  };
  const mode: AnalysisModeView = {
    ...beat85CompilerAnalysisModeFixture,
    ...overrides.mode,
  };
  return {
    chapter: {
      id: "chapter_1",
      title: "第一章",
      summary: "",
      index: 0,
      total: 1,
    },
    scene,
    mode,
    inventory: beat85CompilerAnalysisInventoryFixture,
    story: { facts: [], questions: [], objectives: [], authorizations: [] },
    dialogueHistory: [],
    pendingAcquisition: null,
  };
}

function analysisModeWith(
  overrides: Partial<AnalysisModeView> = {},
): AnalysisModeView {
  return { ...beat85CompilerAnalysisModeFixture, ...overrides };
}

function analysisSceneWith(
  overrides: Partial<AnalysisScene> = {},
): AnalysisScene {
  return { ...beat85CompilerAnalysisSceneFixture, ...overrides };
}

function renderWorkbench(
  state: GameStateView = analysisState(),
  callbacks: {
    onSelectBoard?: (
      token: AnalysisActionToken,
      boardId: string,
    ) => Promise<GameStateView | null>;
    onUpdateDraft?: (
      token: AnalysisActionToken,
      draft: AnalysisDraft,
    ) => Promise<GameStateView | null>;
    onSubmit?: (token: AnalysisActionToken) => Promise<GameStateView | null>;
    disabled?: boolean;
  } = {},
) {
  return render(AnalysisWorkbench, {
    scene: state.scene,
    mode: state.mode,
    inventory: state.inventory,
    onSelectBoard: callbacks.onSelectBoard ?? vi.fn().mockResolvedValue(state),
    onUpdateDraft: callbacks.onUpdateDraft ?? vi.fn().mockResolvedValue(state),
    onSubmit: callbacks.onSubmit ?? vi.fn().mockResolvedValue(state),
    disabled: callbacks.disabled ?? false,
  });
}

async function assignFirstClassifyCard() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: /選取：\s*三宅母親通話紀錄/ }),
  );
  await user.click(screen.getByRole("button", { name: "放入「三宅的小謊」" }));
}

function actionToken(state: GameStateView): AnalysisActionToken {
  if (state.mode.type !== "analysis") throw new Error("Expected Analysis mode");
  return state.mode.actionToken;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnalysisWorkbench", () => {
  it("keeps the P1 practice card and comparison flow through the workbench", async () => {
    const state = analysisState({
      scene: p1PracticeAnalysisSceneFixture,
      mode: p1PracticeAnalysisModeFixture,
    });
    const onUpdateDraft = vi.fn().mockResolvedValue(state);
    const onSubmit = vi.fn().mockResolvedValue(state);
    renderWorkbench(state, { onUpdateDraft, onSubmit });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: /選取：\s*標示 REPRINT 的收據/ }),
    );
    expect(onUpdateDraft).toHaveBeenCalledWith(
      p1PracticeAnalysisModeFixture.actionToken,
      { kind: "threshold", selectedCardIds: ["receipt_reprint"] },
    );

    await user.click(screen.getByRole("button", { name: "比對推論" }));
    expect(onSubmit).toHaveBeenCalledWith(
      p1PracticeAnalysisModeFixture.actionToken,
    );
  });

  it("keeps disabled P1 controls inert", async () => {
    const state = analysisState({
      scene: p1PracticeAnalysisSceneFixture,
      mode: p1PracticeAnalysisModeFixture,
    });
    const onUpdateDraft = vi.fn().mockResolvedValue(state);
    const onSubmit = vi.fn().mockResolvedValue(state);
    renderWorkbench(state, { onUpdateDraft, onSubmit, disabled: true });
    const user = userEvent.setup();

    expect(
      screen.queryByRole("button", { name: /選取：\s*標示 REPRINT 的收據/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "比對推論" })).toBeDisabled();
    expect(screen.getByText("標示 REPRINT 的收據")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "比對推論" }));
    expect(onUpdateDraft).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders board feedback when the mode has no feedback override", () => {
    const state = analysisState({
      scene: analysisSceneWith({
        visibleBoards: beat85CompilerAnalysisSceneFixture.visibleBoards.map(
          (candidate) =>
            candidate.id === "evidence_packages"
              ? {
                  ...candidate,
                  feedback: {
                    state: "incorrect",
                    message: "選擇的線索不足以推論。",
                  },
                }
              : candidate,
        ),
      }),
      mode: analysisModeWith({ feedback: null }),
    });
    renderWorkbench(state);

    expect(screen.getByRole("status")).toHaveTextContent(
      "選擇的線索不足以推論。",
    );
  });

  it("renders a loading state when the display board is missing", () => {
    renderWorkbench(
      analysisState({ mode: analysisModeWith({ boardId: "missing_board" }) }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("分析板載入中。");
  });

  it("renders the display board selected by mode.boardId", () => {
    const state = analysisState({
      mode: analysisModeWith({ boardId: "local_event_sequence" }),
    });
    renderWorkbench(state);

    expect(screen.getByRole("region", { name: "分析板" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "本機事件順序" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "排序板" })).toBeInTheDocument();
  });

  it("keeps an incomplete editable board's Submit action available", () => {
    renderWorkbench(
      analysisState({
        scene: analysisSceneWith({
          activeBoardId: "evidence_packages",
          actionToken: {
            ...beat85CompilerAnalysisSceneFixture.actionToken,
            activeBoardId: "evidence_packages",
          },
        }),
        mode: analysisModeWith({
          activeBoardId: "evidence_packages",
          actionToken: {
            ...beat85CompilerAnalysisModeFixture.actionToken,
            activeBoardId: "evidence_packages",
          },
        }),
      }),
    );

    expect(
      screen.getByRole("button", { name: "比對推論" }),
    ).toBeInTheDocument();
  });

  it("uses selectAnalysisBoard for board navigation", async () => {
    const state = analysisState();
    const onSelectBoard = vi.fn().mockResolvedValue(
      analysisState({
        mode: analysisModeWith({ boardId: "local_event_sequence" }),
      }),
    );
    renderWorkbench(state, { onSelectBoard });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "本機事件順序" }));

    expect(onSelectBoard).toHaveBeenCalledWith(
      actionToken(state),
      "local_event_sequence",
    );
  });

  it.each([
    ["classify", "evidence_packages", { kind: "classify", groupByCard: {} }],
    ["order", "local_event_sequence", { kind: "order", cardIds: [] }],
    [
      "threshold",
      "narrow_request_basis",
      { kind: "threshold", selectedCardIds: [] },
    ],
  ] as const)(
    "Reset sends the empty %s draft",
    async (_kind, boardId, expectedDraft) => {
      const state = analysisState({
        scene: analysisSceneWith({
          activeBoardId: boardId,
          actionToken: {
            ...beat85CompilerAnalysisSceneFixture.actionToken,
            activeBoardId: boardId,
          },
        }),
        mode: analysisModeWith({
          boardId,
          activeBoardId: boardId,
          actionToken: {
            ...beat85CompilerAnalysisModeFixture.actionToken,
            activeBoardId: boardId,
          },
        }),
      });
      const onUpdateDraft = vi.fn().mockResolvedValue(state);
      renderWorkbench(state, { onUpdateDraft });

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "重設" }));

      expect(onUpdateDraft).toHaveBeenCalledWith(
        actionToken(state),
        expectedDraft,
      );
    },
  );

  it("records one-step Undo only after an authoritative edit and sends the previous draft", async () => {
    const state = analysisState();
    const onUpdateDraft = vi.fn().mockResolvedValue(state);
    renderWorkbench(state, { onUpdateDraft });

    await assignFirstClassifyCard();
    await userEvent.setup().click(screen.getByRole("button", { name: "復原" }));

    expect(onUpdateDraft).toHaveBeenNthCalledWith(1, actionToken(state), {
      kind: "classify",
      groupByCard: { miyake_call: "miyake_small_lies" },
    });
    expect(onUpdateDraft).toHaveBeenNthCalledWith(2, actionToken(state), {
      kind: "classify",
      groupByCard: {},
    });
  });

  it("clears Undo and hint and focuses the newly selected board heading", async () => {
    const state = analysisState();
    const view = renderWorkbench(state);
    await assignFirstClassifyCard();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "顯示提示" }));
    expect(screen.getByText(/提示：/)).toBeInTheDocument();

    const next = analysisState({
      scene: analysisSceneWith({
        activeBoardId: "local_event_sequence",
        actionToken: {
          ...(state.scene.kind === "analysis"
            ? state.scene.actionToken
            : beat85CompilerAnalysisSceneFixture.actionToken),
          activeBoardId: "local_event_sequence",
          durableRevision: 9,
        },
      }),
      mode: analysisModeWith({
        boardId: "local_event_sequence",
        activeBoardId: "local_event_sequence",
        actionToken: {
          ...beat85CompilerAnalysisModeFixture.actionToken,
          activeBoardId: "local_event_sequence",
          durableRevision: 9,
        },
      }),
    });
    await view.rerender({
      scene: next.scene,
      mode: next.mode,
      inventory: next.inventory,
      onSelectBoard: vi.fn().mockResolvedValue(next),
      onUpdateDraft: vi.fn().mockResolvedValue(next),
      onSubmit: vi.fn().mockResolvedValue(next),
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "復原" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/提示：/)).not.toBeInTheDocument();
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "本機事件順序" }),
      );
    });
  });

  it("focuses visible feedback after a failed submit", async () => {
    const state = analysisState({
      mode: analysisModeWith({
        feedback: { state: "incorrect", message: "這組資料仍有矛盾。" },
        lastFeedback: "這組資料仍有矛盾。",
      }),
    });
    const onSubmit = vi.fn().mockResolvedValue(state);
    renderWorkbench(state, { onSubmit });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "比對推論" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveFocus();
    });
  });

  it("shows completed boards as read-only without mutation controls", () => {
    const scene = analysisSceneWith({
      visibleBoards: beat85CompilerAnalysisSceneFixture.visibleBoards.map(
        (board) =>
          board.id === "evidence_packages"
            ? { ...board, completed: true, readOnly: true }
            : board,
      ),
    });
    const state = analysisState({ scene });
    renderWorkbench(state);

    expect(screen.getByText("完成・只讀檢視")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "比對推論" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重設" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "復原" }),
    ).not.toBeInTheDocument();
  });

  it("keeps unavailable boards read-only without host mutation controls", async () => {
    const scene = analysisSceneWith({
      visibleBoards: beat85CompilerAnalysisSceneFixture.visibleBoards.map(
        (board) =>
          board.id === "evidence_packages"
            ? { ...board, available: false }
            : board,
      ),
    });
    const state = analysisState({ scene });
    const onUpdateDraft = vi.fn().mockResolvedValue(state);
    const onSubmit = vi.fn().mockResolvedValue(state);
    renderWorkbench(state, { onUpdateDraft, onSubmit });

    expect(
      screen.queryByRole("button", { name: "重設" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "比對推論" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "復原" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /選取：/ }),
    ).not.toBeInTheDocument();
    expect(onUpdateDraft).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not render or own the Case File", () => {
    renderWorkbench();
    expect(screen.queryByText("案件檔案")).not.toBeInTheDocument();
  });

  it("selects a fallback display board before updating it and uses the fresh token", async () => {
    const initial = analysisState({
      mode: analysisModeWith({
        boardId: "evidence_packages",
        activeBoardId: null,
        actionToken: {
          ...beat85CompilerAnalysisModeFixture.actionToken,
          activeBoardId: null,
          durableRevision: 41,
        },
      }),
      scene: analysisSceneWith({
        activeBoardId: null,
        actionToken: {
          ...beat85CompilerAnalysisSceneFixture.actionToken,
          activeBoardId: null,
          durableRevision: 41,
        },
      }),
    });
    const selected = analysisState({
      mode: analysisModeWith({
        boardId: "evidence_packages",
        activeBoardId: "evidence_packages",
        actionToken: {
          ...beat85CompilerAnalysisModeFixture.actionToken,
          activeBoardId: "evidence_packages",
          durableRevision: 42,
        },
      }),
      scene: analysisSceneWith({
        activeBoardId: "evidence_packages",
        actionToken: {
          ...beat85CompilerAnalysisSceneFixture.actionToken,
          activeBoardId: "evidence_packages",
          durableRevision: 42,
        },
      }),
    });
    const updated = analysisState({
      mode: analysisModeWith({
        boardId: "evidence_packages",
        activeBoardId: "evidence_packages",
        actionToken: {
          ...(selected.mode.type === "analysis"
            ? selected.mode.actionToken
            : beat85CompilerAnalysisModeFixture.actionToken),
          durableRevision: 43,
        },
      }),
      scene: analysisSceneWith({
        activeBoardId: "evidence_packages",
        actionToken: {
          ...(selected.scene.kind === "analysis"
            ? selected.scene.actionToken
            : beat85CompilerAnalysisSceneFixture.actionToken),
          activeBoardId: "evidence_packages",
          durableRevision: 43,
        },
      }),
    });
    const onSelectBoard = vi.fn().mockResolvedValue(selected);
    const onUpdateDraft = vi.fn().mockResolvedValue(updated);
    renderWorkbench(initial, { onSelectBoard, onUpdateDraft });

    await assignFirstClassifyCard();

    expect(onSelectBoard).toHaveBeenCalledWith(
      actionToken(initial),
      "evidence_packages",
    );
    expect(onUpdateDraft).toHaveBeenCalledWith(
      actionToken(selected),
      expect.objectContaining({ kind: "classify" }),
    );
  });

  it("aborts an edit when fallback-board reconciliation returns null", async () => {
    const initial = analysisState({
      mode: analysisModeWith({ activeBoardId: null }),
      scene: analysisSceneWith({ activeBoardId: null }),
    });
    const onSelectBoard = vi.fn().mockResolvedValue(null);
    const onUpdateDraft = vi.fn().mockResolvedValue(initial);
    renderWorkbench(initial, { onSelectBoard, onUpdateDraft });

    await assignFirstClassifyCard();

    expect(onSelectBoard).toHaveBeenCalledTimes(1);
    expect(onUpdateDraft).not.toHaveBeenCalled();

    // The player's card selection must be preserved so they can retry.
    const cardButton = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    expect(cardButton).toHaveAttribute("aria-pressed", "true");
  });

  it("reconciles a fallback board before Submit and aborts when reconciliation fails", async () => {
    const initial = analysisState({
      mode: analysisModeWith({ activeBoardId: null }),
      scene: analysisSceneWith({ activeBoardId: null }),
    });
    const onSelectBoard = vi.fn().mockResolvedValue(null);
    const onSubmit = vi.fn().mockResolvedValue(initial);
    renderWorkbench(initial, { onSelectBoard, onSubmit });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "比對推論" }));

    expect(onSelectBoard).toHaveBeenCalledWith(
      actionToken(initial),
      "evidence_packages",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reconciles a fallback board before Submit and uses the fresh token", async () => {
    const initial = analysisState({
      mode: analysisModeWith({
        activeBoardId: null,
        actionToken: {
          ...beat85CompilerAnalysisModeFixture.actionToken,
          activeBoardId: null,
          durableRevision: 51,
        },
      }),
      scene: analysisSceneWith({
        activeBoardId: null,
        actionToken: {
          ...beat85CompilerAnalysisSceneFixture.actionToken,
          activeBoardId: null,
          durableRevision: 51,
        },
      }),
    });
    const selected = analysisState({
      mode: analysisModeWith({
        activeBoardId: "evidence_packages",
        actionToken: {
          ...beat85CompilerAnalysisModeFixture.actionToken,
          activeBoardId: "evidence_packages",
          durableRevision: 52,
        },
      }),
      scene: analysisSceneWith({
        activeBoardId: "evidence_packages",
        actionToken: {
          ...beat85CompilerAnalysisSceneFixture.actionToken,
          activeBoardId: "evidence_packages",
          durableRevision: 52,
        },
      }),
    });
    const onSelectBoard = vi.fn().mockResolvedValue(selected);
    const onSubmit = vi.fn().mockResolvedValue(selected);
    renderWorkbench(initial, { onSelectBoard, onSubmit });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "比對推論" }));

    expect(onSelectBoard).toHaveBeenCalledWith(
      actionToken(initial),
      "evidence_packages",
    );
    expect(onSubmit).toHaveBeenCalledWith(actionToken(selected));
  });

  it("source-asserts keyboard focus and reduced-motion styles", () => {
    const source = readFileSync(
      import.meta.filename.replace(/\.test\.ts$/, ".svelte"),
      "utf8",
    );
    expect(source).toContain(":focus-visible");
    expect(source).toContain("prefers-reduced-motion: reduce");
  });

  it("navigates to the next board via the 下一板 button", async () => {
    const state = analysisState();
    const onSelectBoard = vi.fn().mockResolvedValue(
      analysisState({
        mode: analysisModeWith({ boardId: "local_event_sequence" }),
      }),
    );
    renderWorkbench(state, { onSelectBoard });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "下一板" }));

    expect(onSelectBoard).toHaveBeenCalledWith(
      actionToken(state),
      "local_event_sequence",
    );
  });

  it("navigates to the previous board via the 上一板 button", async () => {
    const state = analysisState({
      mode: analysisModeWith({ boardId: "local_event_sequence" }),
    });
    const onSelectBoard = vi.fn().mockResolvedValue(
      analysisState({
        mode: analysisModeWith({ boardId: "evidence_packages" }),
      }),
    );
    renderWorkbench(state, { onSelectBoard });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "上一板" }));

    expect(onSelectBoard).toHaveBeenCalledWith(
      actionToken(state),
      "evidence_packages",
    );
  });

  it("toggles the hint open and then closed", async () => {
    const state = analysisState();
    renderWorkbench(state);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "顯示提示" }));
    expect(screen.getByText(/提示：/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "隱藏提示" }));
    expect(screen.queryByText(/提示：/)).not.toBeInTheDocument();
  });

  it("focuses the submit button after a submit with no returned feedback", async () => {
    const state = analysisState({
      mode: analysisModeWith({ feedback: null }),
    });
    // Return a state with no feedback after submit.
    const submitted = analysisState({
      mode: analysisModeWith({ feedback: null }),
    });
    const onSubmit = vi.fn().mockResolvedValue(submitted);
    renderWorkbench(state, { onSubmit });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "比對推論" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "比對推論" })).toHaveFocus();
    });
  });

  it("aborts submit when onSubmit returns null", async () => {
    const state = analysisState();
    const onSubmit = vi.fn().mockResolvedValue(null);
    renderWorkbench(state, { onSubmit });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "比對推論" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("aborts a draft update when onUpdateDraft returns null", async () => {
    const state = analysisState();
    const onUpdateDraft = vi.fn().mockResolvedValue(null);
    renderWorkbench(state, { onUpdateDraft });

    await assignFirstClassifyCard();

    expect(onUpdateDraft).toHaveBeenCalledTimes(1);
    // Undo should not be available since the update returned null.
    expect(
      screen.queryByRole("button", { name: "復原" }),
    ).not.toBeInTheDocument();
  });

  it("swallows a thrown error from onSelectBoard during board navigation", async () => {
    const state = analysisState();
    const onSelectBoard = vi.fn().mockRejectedValue(new Error("IPC failure"));
    renderWorkbench(state, { onSelectBoard });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "本機事件順序" }));

    expect(onSelectBoard).toHaveBeenCalledTimes(1);
    // The workbench stays on the original board without throwing.
    expect(
      screen.getByRole("heading", { name: "證據包整理" }),
    ).toBeInTheDocument();
  });

  it("swallows a thrown error from onUpdateDraft during a draft mutation", async () => {
    const state = analysisState();
    const onUpdateDraft = vi.fn().mockRejectedValue(new Error("IPC failure"));
    renderWorkbench(state, { onUpdateDraft });

    await assignFirstClassifyCard();

    expect(onUpdateDraft).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "復原" }),
    ).not.toBeInTheDocument();
  });

  it("surfaces a mutation error when onUpdateDraft returns null", async () => {
    const state = analysisState();
    const onUpdateDraft = vi.fn().mockResolvedValue(null);
    renderWorkbench(state, { onUpdateDraft });

    await assignFirstClassifyCard();

    expect(onUpdateDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "草稿未被接受，請再試一次。",
    );
  });

  it("surfaces a mutation error when onUpdateDraft throws", async () => {
    const state = analysisState();
    const onUpdateDraft = vi.fn().mockRejectedValue(new Error("IPC failure"));
    renderWorkbench(state, { onUpdateDraft });

    await assignFirstClassifyCard();

    expect(onUpdateDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("IPC failure");
  });

  it("clears the mutation error after a subsequent successful update", async () => {
    const state = analysisState();
    let callCount = 0;
    const onUpdateDraft = vi.fn().mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? Promise.resolve(null) : Promise.resolve(state);
    });
    renderWorkbench(state, { onUpdateDraft });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: /選取：\s*三宅母親通話紀錄/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "放入「三宅的小謊」" }),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Selection is preserved after the rejection; retry assign directly.
    await user.click(
      screen.getByRole("button", { name: "放入「三宅的小謊」" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("swallows a thrown error from onSubmit during submit", async () => {
    const state = analysisState();
    const onSubmit = vi.fn().mockRejectedValue(new Error("IPC failure"));
    renderWorkbench(state, { onSubmit });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "比對推論" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("aborts board selection when the returned mode is not analysis", async () => {
    const state = analysisState();
    const wrongMode = {
      ...state,
      mode: { type: "explore", sceneId: "scene_1", sublocationId: "loc_1" },
    } as unknown as GameStateView;
    const onSelectBoard = vi.fn().mockResolvedValue(wrongMode);
    renderWorkbench(state, { onSelectBoard });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "本機事件順序" }));

    expect(onSelectBoard).toHaveBeenCalledTimes(1);
    // Stays on the original board.
    expect(
      screen.getByRole("heading", { name: "證據包整理" }),
    ).toBeInTheDocument();
  });

  it("aborts fallback-board reconciliation when the returned mode has the wrong boardId", async () => {
    const initial = analysisState({
      mode: analysisModeWith({ activeBoardId: null }),
      scene: analysisSceneWith({ activeBoardId: null }),
    });
    // Returns analysis mode but with a different boardId than requested.
    const wrongBoard = analysisState({
      mode: analysisModeWith({
        boardId: "narrow_request_basis",
        activeBoardId: "narrow_request_basis",
      }),
    });
    const onSelectBoard = vi.fn().mockResolvedValue(wrongBoard);
    const onUpdateDraft = vi.fn().mockResolvedValue(initial);
    renderWorkbench(initial, { onSelectBoard, onUpdateDraft });

    await assignFirstClassifyCard();

    expect(onSelectBoard).toHaveBeenCalledTimes(1);
    expect(onUpdateDraft).not.toHaveBeenCalled();
  });

  it("does not navigate when already on the last board and 下一板 is disabled", () => {
    const state = analysisState({
      mode: analysisModeWith({ boardId: "narrow_request_basis" }),
    });
    const onSelectBoard = vi.fn();
    renderWorkbench(state, { onSelectBoard });

    expect(screen.getByRole("button", { name: "下一板" })).toBeDisabled();
  });
});
