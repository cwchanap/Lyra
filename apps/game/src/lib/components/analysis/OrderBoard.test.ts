import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
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
  options: {
    resolveDropTarget?: (x: number, y: number) => string | null;
  } = {},
) {
  return render(OrderBoard, { board, onDraft, ...options });
}

async function dragCard(card: HTMLElement, pointerId: number) {
  await fireEvent.pointerDown(card, {
    pointerId,
    pointerType: "mouse",
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  await fireEvent.pointerMove(card, {
    pointerId,
    pointerType: "mouse",
    button: 0,
    clientX: 20,
    clientY: 10,
  });
  await fireEvent.pointerUp(card, {
    pointerId,
    pointerType: "mouse",
    button: 0,
    clientX: 20,
    clientY: 10,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderBoard", () => {
  it("renders a numbered vertical timeline with stable movable gutters", () => {
    const { container } = renderBoard(
      boardWith(["event_1841", "event_1842", "event_1843"]),
    );

    expect(
      [...container.querySelectorAll(".timeline-index")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["1", "2", "3"]);
    expect(
      [...container.querySelectorAll("[data-analysis-drop-target]")].map(
        (element) => element.getAttribute("data-analysis-drop-target"),
      ),
    ).toEqual([
      "order:before:event_1842",
      "order:before:event_1843",
      "order:end",
      "order:pending",
    ]);
    expect(
      container.querySelector(
        '[data-analysis-card-id="event_1841"] [data-analysis-drop-target]',
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps insertion gutters out of the ordered event list", () => {
    const { container } = renderBoard(
      boardWith(["event_1841", "event_1842", "event_1843"]),
    );
    const timeline = container.querySelector("ol.timeline");

    expect(timeline).not.toBeNull();
    expect(timeline?.querySelectorAll(":scope > li")).toHaveLength(3);
    expect(
      timeline?.querySelectorAll(":scope > .insertion-gutter"),
    ).toHaveLength(0);
  });

  it("inserts a pending card before a movable timeline card", async () => {
    const onDraft = vi.fn();
    const resolveDropTarget = vi.fn(() => "order:before:event_1843");
    const { container } = renderBoard(
      boardWith(["event_1841", "event_1843"]),
      onDraft,
      { resolveDropTarget },
    );

    const card = container.querySelector<HTMLElement>(
      '[data-analysis-card-id="event_1842"]',
    );
    expect(card).not.toBeNull();
    await dragCard(card as HTMLElement, 31);

    await waitFor(() => {
      expect(onDraft).toHaveBeenCalledTimes(1);
    });
    expect(onDraft).toHaveBeenCalledWith(
      { kind: "order", cardIds: ["event_1841", "event_1842", "event_1843"] },
      "card:event_1842",
    );
    expect(resolveDropTarget).toHaveBeenCalledWith(20, 10);
  });

  it("reorders a timeline card through a before gutter", async () => {
    const onDraft = vi.fn();
    const resolveDropTarget = vi.fn(() => "order:before:event_1842");
    const { container } = renderBoard(
      boardWith(["event_1841", "event_1842", "event_1843"]),
      onDraft,
      { resolveDropTarget },
    );

    const card = container.querySelector<HTMLElement>(
      '[data-analysis-card-id="event_1843"]',
    );
    expect(card).not.toBeNull();
    await dragCard(card as HTMLElement, 32);

    await waitFor(() => {
      expect(onDraft).toHaveBeenCalledTimes(1);
    });
    expect(onDraft).toHaveBeenCalledWith(
      { kind: "order", cardIds: ["event_1841", "event_1843", "event_1842"] },
      "card:event_1843",
    );
  });

  it("removes a timeline card when dropped on the pending pool", async () => {
    const onDraft = vi.fn();
    const resolveDropTarget = vi.fn(() => "order:pending");
    const { container } = renderBoard(
      boardWith(["event_1841", "event_1842"]),
      onDraft,
      { resolveDropTarget },
    );

    const card = container.querySelector<HTMLElement>(
      '[data-analysis-card-id="event_1842"]',
    );
    expect(card).not.toBeNull();
    await dragCard(card as HTMLElement, 33);

    await waitFor(() => {
      expect(onDraft).toHaveBeenCalledTimes(1);
    });
    expect(onDraft).toHaveBeenCalledWith(
      { kind: "order", cardIds: ["event_1841"] },
      "card:event_1842",
    );
  });

  it("marks the active gutter as the insertion preview while dragging", async () => {
    const resolveDropTarget = vi.fn(() => "order:before:event_1842");
    const { container } = renderBoard(
      boardWith(["event_1841", "event_1842"]),
      vi.fn(),
      { resolveDropTarget },
    );
    const card = container.querySelector<HTMLElement>(
      '[data-analysis-card-id="event_1842"]',
    );
    expect(card).not.toBeNull();

    await fireEvent.pointerDown(card as HTMLElement, {
      pointerId: 34,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(card as HTMLElement, {
      pointerId: 34,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });

    const gutter = container.querySelector(
      '[data-analysis-drop-target="order:before:event_1842"]',
    );
    expect(gutter).toHaveClass("drop-target");
    expect(gutter).toHaveTextContent("放置在此");
  });

  it("does not treat the fixed anchor as a drag source", async () => {
    const resolveDropTarget = vi.fn(() => "order:end");
    const onDraft = vi.fn();
    const { container } = renderBoard(boardWith(), onDraft, {
      resolveDropTarget,
    });
    const anchor = container.querySelector<HTMLElement>(
      '[data-analysis-card-id="event_1841"]',
    );
    expect(anchor).not.toBeNull();

    await fireEvent.pointerDown(anchor as HTMLElement, {
      pointerId: 35,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(anchor as HTMLElement, {
      pointerId: 35,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });
    await fireEvent.pointerUp(anchor as HTMLElement, {
      pointerId: 35,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });

    expect(resolveDropTarget).not.toHaveBeenCalled();
    expect(onDraft).not.toHaveBeenCalled();
  });

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

  it("renders the blocked state without throwing when the wire is malformed", () => {
    // The helper tolerates non-array fixedAnchors/cards; the component must
    // consume sanitized values so malformed stale views show the blocked
    // state instead of throwing before the UI can protect the renderer.
    const malformedBoard = boardWith(["event_1841"], {
      fixedAnchors: "not-an-array" as unknown as OrderBoardView["fixedAnchors"],
      cards: null as unknown as OrderBoardView["cards"],
    });
    renderBoard(malformedBoard);

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

  it("renders a stale-card placeholder when the draft references an unknown card on a blocked board", () => {
    // With unsupported anchors, materializePrefixAnchors is bypassed and the
    // raw draft cardIds are displayed. A stale id produces the stale-card
    // placeholder branch.
    const staleBoard = boardWith(["stale_id"], {
      fixedAnchors: [{ cardId: "event_1843", position: 3 }],
    });
    renderBoard(staleBoard);

    expect(screen.getByText("stale_id")).toBeInTheDocument();
    expect(screen.getByText("尚未取得卡片資料")).toBeInTheDocument();
  });

  it("shows the empty timeline state when no cards are placed and there are no fixed anchors", () => {
    const noAnchorBoard = boardWith([], {
      fixedAnchors: [],
    });
    renderBoard(noAnchorBoard);

    expect(screen.getByText("尚未加入事件。")).toBeInTheDocument();
  });

  it("shows the empty unplaced state when all cards are in the timeline", () => {
    renderBoard(
      boardWith(["event_1841", "event_1842", "event_1843", "event_1844"]),
    );

    expect(screen.getByText("所有事件都已放入時間線。")).toBeInTheDocument();
  });

  it("disables up/down buttons at the prefix and end boundaries", () => {
    renderBoard(boardWith(["event_1841", "event_1842", "event_1843"]));

    // event_1842 is the first movable card (index 1, prefix length 1).
    // Up is disabled because index <= fixedPrefixLength (1 <= 1).
    expect(
      screen.getByRole("button", { name: "上移：外包憑證開門" }),
    ).toBeDisabled();

    // event_1843 is the last card in the timeline (index 2, length 3).
    // Down is disabled because index >= length - 1 (2 >= 2).
    expect(
      screen.getByRole("button", { name: "下移：員工憑證開門" }),
    ).toBeDisabled();
  });

  it("leaves title, prompt, and hint presentation to the workbench host", () => {
    renderBoard(boardWith(["event_1841"], { hint: "先排維護模式。" }));

    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(
      screen.queryByText("把本機事件排回原始先後。"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/提示：/)).not.toBeInTheDocument();
  });

  it("does not emit a draft when the disabled prop is true", async () => {
    const onDraft = vi.fn();
    render(OrderBoard, {
      board: boardWith(["event_1841"]),
      onDraft,
      disabled: true,
    });

    // No mutation buttons when disabled.
    expect(
      screen.queryByRole("button", { name: "加入時間線：外包憑證開門" }),
    ).not.toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
  });
});
