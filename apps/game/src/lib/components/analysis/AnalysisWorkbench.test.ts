import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnalysisWorkbench", () => {
  it("renders the v3 rail with every visible board and native progress", async () => {
    const state = analysisState({
      scene: analysisSceneWith({
        visibleBoards: beat85CompilerAnalysisSceneFixture.visibleBoards.map(
          (candidate) => {
            if (candidate.id === "local_event_sequence") {
              return {
                ...candidate,
                available: false,
                completed: true,
                readOnly: true,
              };
            }
            if (candidate.id === "narrow_request_basis") {
              return { ...candidate, available: false };
            }
            return candidate;
          },
        ),
      }),
    });
    const onSelectBoard = vi.fn().mockResolvedValue(state);
    renderWorkbench(state, { onSelectBoard });

    expect(screen.getByText("分析工作台")).toBeInTheDocument();
    expect(screen.queryByText("案件檔案")).not.toBeInTheDocument();

    const rail = screen.getByRole("navigation", { name: "分析板導覽" });
    const entries = rail.querySelectorAll("[data-analysis-board-id]");
    expect(entries).toHaveLength(3);

    const activeEntry = screen.getByRole("button", { name: "證據包整理" });
    expect(activeEntry).toHaveAttribute("aria-current", "page");
    expect(activeEntry).toHaveAttribute("data-analysis-board-state", "active");

    const completedEntry = screen.getByRole("button", {
      name: "本機事件順序",
    });
    expect(completedEntry).toHaveAttribute(
      "data-analysis-board-state",
      "completed",
    );
    expect(completedEntry).toBeEnabled();

    const lockedEntry = screen.getByRole("button", {
      name: "有限調取申請基礎",
    });
    expect(lockedEntry).toHaveAttribute("data-analysis-board-state", "locked");
    expect(lockedEntry).toBeDisabled();

    expect(screen.getAllByRole("progressbar")).toHaveLength(4);
    expect(screen.getByText(/完成\s*1\s*\/\s*3/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "分析板" })).toBeInTheDocument();
    expect(
      screen.getByRole("contentinfo", { name: "分析操作" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "比對推論" }),
    ).toBeInTheDocument();

    await userEvent.setup().click(completedEntry);
    expect(onSelectBoard).toHaveBeenCalledWith(
      actionToken(state),
      "local_event_sequence",
    );
    expect(onSelectBoard).not.toHaveBeenCalledWith(
      actionToken(state),
      "narrow_request_basis",
    );
  });

  it("exposes each rail entry state and progress through an accessible description", () => {
    const state = analysisState({
      scene: analysisSceneWith({
        visibleBoards: beat85CompilerAnalysisSceneFixture.visibleBoards.map(
          (candidate) => {
            if (candidate.id === "local_event_sequence") {
              return { ...candidate, available: false, completed: true };
            }
            if (candidate.id === "narrow_request_basis") {
              return { ...candidate, available: false };
            }
            return candidate;
          },
        ),
      }),
    });
    renderWorkbench(state);

    const expectedDescriptions = [
      { name: "證據包整理", state: "目前", progress: "0 / 3" },
      { name: "本機事件順序", state: "已完成", progress: "1 / 4" },
      { name: "有限調取申請基礎", state: "尚未解鎖", progress: "1 / 2" },
    ];

    for (const expected of expectedDescriptions) {
      const entry = screen.getByRole("button", { name: expected.name });
      const descriptionId = entry.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();

      const description = descriptionId
        ? document.getElementById(descriptionId)
        : null;
      expect(description).toBeInTheDocument();
      expect(description).toHaveTextContent(expected.state);
      expect(description).toHaveTextContent(expected.progress);
    }
  });

  it("preserves the read-only state for an available rail entry", () => {
    const state = analysisState({
      scene: analysisSceneWith({
        visibleBoards: beat85CompilerAnalysisSceneFixture.visibleBoards.map(
          (candidate) =>
            candidate.id === "local_event_sequence"
              ? { ...candidate, readOnly: true }
              : candidate,
        ),
      }),
    });
    renderWorkbench(state);

    const entry = screen.getByRole("button", { name: "本機事件順序" });
    expect(entry).toHaveAttribute("data-analysis-board-state", "available");
    expect(entry).toHaveTextContent("只讀");
    expect(entry).not.toHaveTextContent("可進入");

    const descriptionId = entry.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    const description = descriptionId
      ? document.getElementById(descriptionId)
      : null;
    expect(description).toHaveTextContent("只讀");
    expect(description).not.toHaveTextContent("可進入");
  });

  it("keeps non-completed read-only boards visibly distinct from completed boards", () => {
    const state = analysisState({
      scene: analysisSceneWith({
        visibleBoards: beat85CompilerAnalysisSceneFixture.visibleBoards.map(
          (candidate) =>
            candidate.id === "evidence_packages"
              ? { ...candidate, readOnly: true }
              : candidate,
        ),
      }),
    });
    renderWorkbench(state);

    expect(screen.getByText("目前只讀")).toBeInTheDocument();
    expect(screen.queryByText("已完成・只讀檢視")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "比對推論" }),
    ).not.toBeInTheDocument();
  });

  it("keeps P1 as one analysis rail entry with inline rejection feedback", () => {
    const state = analysisState({
      scene: p1PracticeAnalysisSceneFixture,
      mode: {
        ...p1PracticeAnalysisModeFixture,
        feedback: { state: "incorrect", message: "這組資料仍有矛盾。" },
      },
    });
    renderWorkbench(state);

    expect(
      screen
        .getByRole("navigation", { name: "分析板導覽" })
        .querySelectorAll("[data-analysis-board-id]"),
    ).toHaveLength(1);
    expect(screen.getByText("標示 REPRINT 的收據")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("這組資料仍有矛盾。");
    expect(screen.queryByText("案件檔案")).not.toBeInTheDocument();
  });

  it("focuses the host heading after board changes and fallback mutations", async () => {
    const state = analysisState();
    const view = renderWorkbench(state);
    const initialHeading = screen.getByRole("heading", { name: "證據包整理" });
    expect(initialHeading).toHaveAttribute(
      "data-analysis-focus-key",
      "board:evidence_packages",
    );
    expect(screen.getByRole("region", { name: "分析板" })).not.toContainElement(
      initialHeading,
    );

    await assignFirstClassifyCard();
    await waitFor(() => {
      expect(document.activeElement).toBe(initialHeading);
      expect(document.activeElement).not.toBe(document.body);
    });

    const next = analysisState({
      mode: analysisModeWith({ boardId: "local_event_sequence" }),
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
      const hostHeading = screen.getByRole("heading", {
        name: "本機事件順序",
      });
      expect(hostHeading).toHaveAttribute(
        "data-analysis-focus-key",
        "board:local_event_sequence",
      );
      expect(document.activeElement).toBe(hostHeading);
      expect(document.activeElement).not.toBe(document.body);
    });
  });

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
      const hostHeading = screen.getByRole("heading", {
        name: "本機事件順序",
      });
      expect(hostHeading).toHaveAttribute(
        "data-analysis-focus-key",
        "board:local_event_sequence",
      );
      expect(
        screen.getByRole("region", { name: "分析板" }),
      ).not.toContainElement(hostHeading);
      expect(document.activeElement).toBe(hostHeading);
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
    // The shared ErrorBanner (gameState.error) owns the failure alert; the
    // workbench must not render a duplicate local alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

  it("aborts submit without a local error when onSubmit returns null", async () => {
    const state = analysisState();
    const onSubmit = vi.fn().mockResolvedValue(null);
    renderWorkbench(state, { onSubmit });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "比對推論" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // The shared ErrorBanner (gameState.error) owns the failure alert; the
    // workbench must not render a duplicate local alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

  it("aborts a draft update without a local error when onUpdateDraft returns null", async () => {
    const state = analysisState();
    const onUpdateDraft = vi.fn().mockResolvedValue(null);
    renderWorkbench(state, { onUpdateDraft });

    await assignFirstClassifyCard();

    expect(onUpdateDraft).toHaveBeenCalledTimes(1);
    // The shared ErrorBanner (gameState.error) owns the failure alert; the
    // workbench must not render a duplicate local alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a mutation error when onUpdateDraft throws", async () => {
    const state = analysisState();
    const onUpdateDraft = vi.fn().mockRejectedValue(new Error("IPC failure"));
    renderWorkbench(state, { onUpdateDraft });

    await assignFirstClassifyCard();

    expect(onUpdateDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("IPC failure");
  });

  it("retries a draft update after a null return without surfacing a local error", async () => {
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
    // Null return is owned by gameState.error; no local alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Selection is preserved after the rejection; retry assign directly.
    await user.click(
      screen.getByRole("button", { name: "放入「三宅的小謊」" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a mutation error when onSubmit throws during submit", async () => {
    const state = analysisState();
    const onSubmit = vi.fn().mockRejectedValue(new Error("IPC failure"));
    renderWorkbench(state, { onSubmit });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "比對推論" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("IPC failure");
  });

  it("clears a stale submit error when a retry succeeds on the same board", async () => {
    const initial = analysisState({
      mode: analysisModeWith({ feedback: null }),
    });
    // Retry returns an incorrect-answer board that stays open with feedback.
    const retryState = analysisState({
      mode: analysisModeWith({
        feedback: { state: "incorrect", message: "這組資料仍有矛盾。" },
        lastFeedback: "這組資料仍有矛盾。",
      }),
    });
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("IPC failure"))
      .mockResolvedValueOnce(retryState);
    const view = renderWorkbench(initial, { onSubmit });

    const user = userEvent.setup();
    // First attempt fails and surfaces the transport error.
    await user.click(screen.getByRole("button", { name: "比對推論" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("IPC failure");

    // Retry on the same board succeeds; the host applies the returned state.
    await user.click(screen.getByRole("button", { name: "比對推論" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    await view.rerender({
      scene: retryState.scene,
      mode: retryState.mode,
      inventory: retryState.inventory,
      onSelectBoard: vi.fn().mockResolvedValue(retryState),
      onUpdateDraft: vi.fn().mockResolvedValue(retryState),
      onSubmit,
    });
    // The stale error alert must be gone; only the new feedback remains.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "這組資料仍有矛盾。",
      );
    });
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

  it("renders a loading state when the mode is not analysis", () => {
    const nonAnalysisMode = {
      type: "explore",
      sublocationId: "loc_1",
    } as unknown as Mode;
    render(AnalysisWorkbench, {
      scene: beat85CompilerAnalysisSceneFixture,
      mode: nonAnalysisMode,
      inventory: beat85CompilerAnalysisInventoryFixture,
      onSelectBoard: vi.fn(),
      onUpdateDraft: vi.fn(),
      onSubmit: vi.fn(),
    });

    expect(screen.getByRole("status")).toHaveTextContent("分析板載入中。");
  });

  it("renders a loading state when the scene is not analysis", () => {
    const nonAnalysisScene = {
      kind: "linear",
      id: "scene_1",
      title: "線性場景",
      summary: "",
      index: 0,
      total: 1,
    } as unknown as SceneView;
    render(AnalysisWorkbench, {
      scene: nonAnalysisScene,
      mode: beat85CompilerAnalysisModeFixture,
      inventory: beat85CompilerAnalysisInventoryFixture,
      onSelectBoard: vi.fn(),
      onUpdateDraft: vi.fn(),
      onSubmit: vi.fn(),
    });

    expect(screen.getByRole("status")).toHaveTextContent("分析板載入中。");
  });

  it("surfaces a mutation error when resetDraft fails", async () => {
    const state = analysisState();
    const onUpdateDraft = vi.fn().mockRejectedValue(new Error("IPC failure"));
    renderWorkbench(state, { onUpdateDraft });

    // First make an edit so Undo is available, then reset.
    await assignFirstClassifyCard();
    await userEvent.setup().click(screen.getByRole("button", { name: "重設" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("IPC failure");
    });
  });

  it("surfaces a mutation error when undo fails", async () => {
    const state = analysisState();
    let callCount = 0;
    const onUpdateDraft = vi.fn().mockImplementation(() => {
      callCount += 1;
      // First call (assign) succeeds; second call (undo) throws.
      return callCount === 1
        ? Promise.resolve(state)
        : Promise.reject(new Error("IPC failure"));
    });
    renderWorkbench(state, { onUpdateDraft });
    const user = userEvent.setup();

    await assignFirstClassifyCard();
    await user.click(screen.getByRole("button", { name: "復原" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("IPC failure");
    });
  });

  it("does not navigate when selectRelative finds no next board", async () => {
    // On the last board, 下一板 is disabled, but selectRelative(1) can still
    // be called internally. Verify it does not call onSelectBoard when there
    // is no next board in the navigation list.
    const state = analysisState({
      mode: analysisModeWith({ boardId: "narrow_request_basis" }),
    });
    const onSelectBoard = vi.fn();
    renderWorkbench(state, { onSelectBoard });

    // The 下一板 button is disabled on the last board, confirming no
    // forward navigation target exists.
    expect(screen.getByRole("button", { name: "下一板" })).toBeDisabled();
    expect(onSelectBoard).not.toHaveBeenCalled();
  });

  it("does not focus feedback when submit returns a non-analysis mode", async () => {
    const state = analysisState();
    const nonAnalysisReturn = {
      ...state,
      mode: { type: "gameComplete" },
    } as unknown as GameStateView;
    const onSubmit = vi.fn().mockResolvedValue(nonAnalysisReturn);
    renderWorkbench(state, { onSubmit });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "比對推論" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // No feedback element should be focused since the returned mode is not
    // analysis — the submit button itself receives focus instead.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "比對推論" })).toHaveFocus();
    });
  });

  it("surfaces a generic mutation message when onUpdateDraft throws a non-Error value", async () => {
    const state = analysisState();
    // Throw a non-Error value (string) to exercise the fallback branch in
    // mutationErrorMessage.
    const onUpdateDraft = vi.fn().mockRejectedValue("string error");
    renderWorkbench(state, { onUpdateDraft });

    await assignFirstClassifyCard();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "更新草稿時發生錯誤，請再試一次。",
    );
  });

  it("aborts a draft mutation when fallback-board reconciliation throws", async () => {
    const initial = analysisState({
      mode: analysisModeWith({ activeBoardId: null }),
      scene: analysisSceneWith({ activeBoardId: null }),
    });
    const onSelectBoard = vi.fn().mockRejectedValue(new Error("IPC failure"));
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

  it("aborts submit when fallback-board reconciliation throws", async () => {
    const initial = analysisState({
      mode: analysisModeWith({ activeBoardId: null }),
      scene: analysisSceneWith({ activeBoardId: null }),
    });
    const onSelectBoard = vi.fn().mockRejectedValue(new Error("IPC failure"));
    const onSubmit = vi.fn().mockResolvedValue(initial);
    renderWorkbench(initial, { onSelectBoard, onSubmit });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "比對推論" }));

    expect(onSelectBoard).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    // The shared ErrorBanner (gameState.error) owns the failure alert; the
    // workbench must not render a duplicate local alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears presentation state without focusing when the board becomes null", async () => {
    const state = analysisState();
    const view = renderWorkbench(state);
    await assignFirstClassifyCard();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "顯示提示" }));
    expect(screen.getByText(/提示：/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "復原" })).toBeInTheDocument();

    // Rerender with a non-analysis mode so analysisMode?.boardId becomes null.
    const nonAnalysisMode = {
      type: "explore",
      sublocationId: "loc_1",
    } as unknown as Mode;
    await view.rerender({
      scene: state.scene,
      mode: nonAnalysisMode,
      inventory: state.inventory,
      onSelectBoard: vi.fn(),
      onUpdateDraft: vi.fn(),
      onSubmit: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.queryByText(/提示：/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "復原" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("分析板載入中。");
    });
  });

  it("prevents duplicate submit while the action is in flight", async () => {
    const state = analysisState();
    const pending = deferred<GameStateView | null>();
    const onSubmit = vi.fn().mockReturnValue(pending.promise);
    renderWorkbench(state, { onSubmit });

    await fireEvent.click(screen.getByRole("button", { name: "比對推論" }));
    await fireEvent.click(screen.getByRole("button", { name: "比對推論" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    pending.resolve(state);
  });

  it("prevents duplicate reset while the action is in flight", async () => {
    const state = analysisState();
    const pending = deferred<GameStateView | null>();
    const onUpdateDraft = vi.fn().mockReturnValue(pending.promise);
    renderWorkbench(state, { onUpdateDraft });

    await fireEvent.click(screen.getByRole("button", { name: "重設" }));
    await fireEvent.click(screen.getByRole("button", { name: "重設" }));

    expect(onUpdateDraft).toHaveBeenCalledTimes(1);
    pending.resolve(state);
  });

  it("prevents duplicate undo while the action is in flight", async () => {
    const state = analysisState();
    const pending = deferred<GameStateView | null>();
    let callCount = 0;
    const onUpdateDraft = vi.fn().mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? Promise.resolve(state) : pending.promise;
    });
    renderWorkbench(state, { onUpdateDraft });

    await assignFirstClassifyCard();
    await fireEvent.click(screen.getByRole("button", { name: "復原" }));
    await fireEvent.click(screen.getByRole("button", { name: "復原" }));

    expect(onUpdateDraft).toHaveBeenCalledTimes(2);
    pending.resolve(state);
  });
});
