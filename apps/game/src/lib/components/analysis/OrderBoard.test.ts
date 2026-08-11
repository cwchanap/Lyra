import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beat85CompilerAnalysisSceneFixture } from "$lib/analysis/test-fixtures";
import type { AnalysisBoardView, AnalysisDraft } from "$lib/state/types";
import OrderBoard from "./OrderBoard.svelte";

type OrderBoardView = Extract<AnalysisBoardView, { kind: "order" }>;
type OrderDraft = Extract<AnalysisDraft, { kind: "order" }>;

function requireFixtureBoard(): OrderBoardView {
  const board = beat85CompilerAnalysisSceneFixture.visibleBoards.find(
    (candidate): candidate is OrderBoardView => candidate.kind === "order",
  );
  if (!board) {
    throw new Error(
      "The compiler analysis fixture must contain an order board",
    );
  }
  return board;
}

const fixtureBoard = requireFixtureBoard();

function boardWith(
  cardIds: string[] = ["event_1841"],
  overrides: Partial<OrderBoardView> = {},
): OrderBoardView {
  return {
    ...fixtureBoard,
    ...overrides,
    draft: { kind: "order", cardIds },
  };
}

function renderBoard(
  board: OrderBoardView = boardWith(),
  onDraft: (draft: OrderDraft, focusKey: string) => void = vi.fn(),
) {
  return render(OrderBoard, { board, onDraft });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderBoard", () => {
  it("locks the fixed prefix card and labels it as fixed", () => {
    renderBoard();

    expect(screen.getByText("固定位置")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "上移：維護模式開啟" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "移除：維護模式開啟" }),
    ).not.toBeInTheDocument();
  });

  it("uses the same structural draft for pointer and keyboard add", async () => {
    const pointerOnDraft = vi.fn();
    const pointerUser = userEvent.setup();
    renderBoard(boardWith(), pointerOnDraft);

    await pointerUser.click(
      screen.getByRole("button", { name: "加入時間線：外包憑證開門" }),
    );
    const pointerDraft = pointerOnDraft.mock.lastCall;

    cleanup();

    const keyboardOnDraft = vi.fn();
    const keyboardUser = userEvent.setup();
    renderBoard(boardWith(), keyboardOnDraft);
    const add = screen.getByRole("button", {
      name: "加入時間線：外包憑證開門",
    });
    add.focus();
    await keyboardUser.keyboard("{Enter}");

    expect(keyboardOnDraft.mock.lastCall).toEqual(pointerDraft);
    expect(keyboardOnDraft).toHaveBeenLastCalledWith(
      { kind: "order", cardIds: ["event_1841", "event_1842"] },
      "card:event_1842",
    );
  });

  it("emits helper-produced drafts for up, down, and remove", async () => {
    const user = userEvent.setup();
    const upDraft = vi.fn();
    renderBoard(
      boardWith(["event_1841", "event_1842", "event_1843", "event_1844"]),
      upDraft,
    );
    await user.click(
      screen.getByRole("button", { name: "上移：員工憑證開門" }),
    );
    expect(upDraft).toHaveBeenLastCalledWith(
      {
        kind: "order",
        cardIds: ["event_1841", "event_1843", "event_1842", "event_1844"],
      },
      "card:event_1843",
    );

    cleanup();
    const downDraft = vi.fn();
    renderBoard(
      boardWith(["event_1841", "event_1842", "event_1843", "event_1844"]),
      downDraft,
    );
    await user.click(
      screen.getByRole("button", { name: "下移：員工憑證開門" }),
    );
    expect(downDraft).toHaveBeenLastCalledWith(
      {
        kind: "order",
        cardIds: ["event_1841", "event_1842", "event_1844", "event_1843"],
      },
      "card:event_1843",
    );

    cleanup();
    const removeDraft = vi.fn();
    renderBoard(boardWith(["event_1841", "event_1842"]), removeDraft);
    await user.click(
      screen.getByRole("button", { name: "移除：外包憑證開門" }),
    );
    expect(removeDraft).toHaveBeenLastCalledWith(
      { kind: "order", cardIds: ["event_1841"] },
      "card:event_1842",
    );
  });

  it("disables unavailable movable cards", () => {
    const unavailableBoard = boardWith(["event_1841"], {
      cards: fixtureBoard.cards.map((card) =>
        card.id === "event_1842" ? { ...card, available: false } : card,
      ),
    });
    renderBoard(unavailableBoard);

    expect(
      screen.getByRole("button", { name: "加入時間線：外包憑證開門" }),
    ).toBeDisabled();
  });

  it("shows a fixed-anchor-unavailable state without mutation controls", () => {
    const unavailableBoard = boardWith(["event_1841"], {
      cards: fixtureBoard.cards.map((card) =>
        card.id === "event_1841" ? { ...card, available: false } : card,
      ),
    });
    renderBoard(unavailableBoard);

    expect(
      screen.getByText("尚未取得固定卡，暫時無法編排時間線。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a configuration error for a stale non-prefix view", () => {
    const staleBoard = boardWith(["event_1841"], {
      fixedAnchors: [{ cardId: "event_1843", position: 3 }],
    });
    renderBoard(staleBoard);

    expect(
      screen.getByText("排序設定無法顯示，請重新載入內容。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  const staleDrafts: AnalysisDraft[] = [
    { kind: "classify", groupByCard: {} },
    { kind: "threshold", selectedCardIds: [] },
  ];

  it.each(staleDrafts)(
    "does not expose order mutations for a stale %s draft",
    (draft) => {
      const staleBoard: OrderBoardView = { ...fixtureBoard, draft };
      const onDraft = vi.fn();
      renderBoard(staleBoard, onDraft);

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(onDraft).not.toHaveBeenCalled();
    },
  );
});
