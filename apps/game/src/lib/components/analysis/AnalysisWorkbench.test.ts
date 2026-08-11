import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beat85CompilerAnalysisInventoryFixture,
  beat85CompilerAnalysisSceneFixture,
  beat85CompilerAnalysisModeFixture,
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
  } = {},
) {
  return render(AnalysisWorkbench, {
    scene: state.scene,
    mode: state.mode,
    inventory: state.inventory,
    onSelectBoard: callbacks.onSelectBoard ?? vi.fn().mockResolvedValue(state),
    onUpdateDraft: callbacks.onUpdateDraft ?? vi.fn().mockResolvedValue(state),
    onSubmit: callbacks.onSubmit ?? vi.fn().mockResolvedValue(state),
  });
}

async function assignFirstClassifyCard() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: /選取：三宅母親通話紀錄/ }),
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

  it("source-asserts keyboard focus and reduced-motion styles", () => {
    const source = readFileSync(
      import.meta.filename.replace(/\.test\.ts$/, ".svelte"),
      "utf8",
    );
    expect(source).toContain(":focus-visible");
    expect(source).toContain("prefers-reduced-motion: reduce");
  });
});
