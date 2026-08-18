import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beat85CompilerAnalysisSceneFixture } from "$lib/analysis/test-fixtures";
import type { AnalysisBoardView, AnalysisDraft } from "$lib/state/types";
import ClassifyBoard from "./ClassifyBoard.svelte";

type ClassifyBoardView = Extract<AnalysisBoardView, { kind: "classify" }>;
type ClassifyDraft = Extract<AnalysisDraft, { kind: "classify" }>;

function requireFixtureBoard(): ClassifyBoardView {
  const board = beat85CompilerAnalysisSceneFixture.visibleBoards.find(
    (candidate): candidate is ClassifyBoardView =>
      candidate.kind === "classify",
  );
  if (!board) {
    throw new Error(
      "The compiler analysis fixture must contain a classify board",
    );
  }
  return board;
}

const fixtureBoard = requireFixtureBoard();

function boardWith(
  groupByCard: Record<string, string> = {},
  overrides: Partial<ClassifyBoardView> = {},
): ClassifyBoardView {
  const board: ClassifyBoardView = {
    ...fixtureBoard,
    draft: { kind: "classify", groupByCard },
  };
  Object.assign(board, overrides);
  board.draft = { kind: "classify", groupByCard };
  return board;
}

function renderBoard(
  board: ClassifyBoardView = boardWith(),
  onDraft: (draft: ClassifyDraft, focusKey: string) => void = vi.fn(),
  options: {
    resolveDropTarget?: (x: number, y: number) => string | null;
  } = {},
) {
  return render(ClassifyBoard, { board, onDraft, ...options });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ClassifyBoard", () => {
  it("uses the same whole draft for pointer and Enter/Space assignment", async () => {
    const pointerOnDraft = vi.fn();
    const pointerUser = userEvent.setup();
    renderBoard(boardWith(), pointerOnDraft);

    await pointerUser.click(
      screen.getByRole("button", { name: /選取：\s*三宅母親通話紀錄/ }),
    );
    await pointerUser.click(
      screen.getByRole("button", { name: "放入「三宅的小謊」" }),
    );
    const pointerCall = pointerOnDraft.mock.lastCall;

    cleanup();

    const keyboardOnDraft = vi.fn();
    const keyboardUser = userEvent.setup();
    renderBoard(boardWith(), keyboardOnDraft);

    const card = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    card.focus();
    await keyboardUser.keyboard("{Enter}");
    const group = screen.getByRole("button", {
      name: "放入「三宅的小謊」",
    });
    group.focus();
    await keyboardUser.keyboard(" ");

    expect(keyboardOnDraft.mock.lastCall).toEqual(pointerCall);
    expect(keyboardOnDraft).toHaveBeenLastCalledWith(
      { kind: "classify", groupByCard: { miyake_call: "miyake_small_lies" } },
      "card:miyake_call",
    );
  });

  it("moves an already-assigned available card to another group", async () => {
    const onDraft = vi.fn();
    const user = userEvent.setup();
    renderBoard(boardWith({ miyake_call: "miyake_small_lies" }), onDraft);

    await user.click(
      screen.getByRole("button", { name: /選取：\s*三宅母親通話紀錄/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "放入「更早的第三者」" }),
    );

    expect(onDraft).toHaveBeenLastCalledWith(
      {
        kind: "classify",
        groupByCard: { miyake_call: "earlier_third_party" },
      },
      "card:miyake_call",
    );
  });

  it("dispatches one changed draft when a card is dragged onto another group", async () => {
    const onDraft = vi.fn();
    const resolveDropTarget = vi.fn(() => "classify:group:earlier_third_party");
    renderBoard(boardWith(), onDraft, { resolveDropTarget });

    const card = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    await fireEvent.pointerDown(card, {
      pointerId: 21,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(card, {
      pointerId: 21,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });
    await fireEvent.pointerUp(card, {
      pointerId: 21,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });

    await waitFor(() => {
      expect(onDraft).toHaveBeenCalledTimes(1);
    });
    expect(onDraft).toHaveBeenCalledWith(
      {
        kind: "classify",
        groupByCard: { miyake_call: "earlier_third_party" },
      },
      "card:miyake_call",
    );
    expect(resolveDropTarget).toHaveBeenCalledWith(20, 10);
  });

  it("dispatches one changed draft when a grouped card is dragged back to unassigned", async () => {
    const onDraft = vi.fn();
    const resolveDropTarget = vi.fn(() => "classify:unassigned");
    renderBoard(boardWith({ miyake_call: "miyake_small_lies" }), onDraft, {
      resolveDropTarget,
    });

    const card = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    await fireEvent.pointerDown(card, {
      pointerId: 22,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(card, {
      pointerId: 22,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });
    await fireEvent.pointerUp(card, {
      pointerId: 22,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });

    await waitFor(() => {
      expect(onDraft).toHaveBeenCalledTimes(1);
    });
    expect(onDraft).toHaveBeenCalledWith(
      { kind: "classify", groupByCard: {} },
      "card:miyake_call",
    );
  });

  it("does not dispatch when a card is dropped in its current group", async () => {
    const onDraft = vi.fn();
    const resolveDropTarget = vi.fn(() => "classify:group:miyake_small_lies");
    renderBoard(boardWith({ miyake_call: "miyake_small_lies" }), onDraft, {
      resolveDropTarget,
    });

    const card = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    await fireEvent.pointerDown(card, {
      pointerId: 23,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(card, {
      pointerId: 23,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });
    await fireEvent.pointerUp(card, {
      pointerId: 23,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });

    await waitFor(() => {
      expect(
        screen.getByRole("status", { name: "分類操作提示" }),
      ).toHaveTextContent("未變更");
    });
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("does not dispatch and announces an invalid drag target", async () => {
    const onDraft = vi.fn();
    const resolveDropTarget = vi.fn(() => "analysis:invalid");
    renderBoard(boardWith(), onDraft, { resolveDropTarget });

    const card = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    await fireEvent.pointerDown(card, {
      pointerId: 24,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(card, {
      pointerId: 24,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });
    await fireEvent.pointerUp(card, {
      pointerId: 24,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });

    await waitFor(() => {
      expect(
        screen.getByRole("status", { name: "分類操作提示" }),
      ).toHaveTextContent("無效");
    });
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("removes only the selected card mapping", async () => {
    const onDraft = vi.fn();
    const user = userEvent.setup();
    renderBoard(
      boardWith({
        miyake_call: "miyake_small_lies",
        l_corridor_replay: "earlier_third_party",
      }),
      onDraft,
    );

    await user.click(
      screen.getByRole("button", { name: "移除：三宅母親通話紀錄" }),
    );

    expect(onDraft).toHaveBeenLastCalledWith(
      {
        kind: "classify",
        groupByCard: { l_corridor_replay: "earlier_third_party" },
      },
      "card:miyake_call",
    );
  });

  it("keeps unavailable cards visible but disables selection and assignment", () => {
    const unavailableBoard = boardWith(undefined, {
      cards: fixtureBoard.cards.map((card) =>
        card.id === "miyake_call" ? { ...card, available: false } : card,
      ),
    });
    renderBoard(unavailableBoard);

    expect(
      screen.getByRole("button", { name: /選取：\s*三宅母親通話紀錄/ }),
    ).toBeDisabled();
  });

  it("exposes no mutation controls for a read-only board", () => {
    renderBoard(boardWith({}, { readOnly: true }));

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("hides remove buttons for assigned cards on a read-only board", () => {
    // A read-only board with cards already assigned to groups must render
    // the cards without remove buttons (the {#if editable} false branch).
    renderBoard(
      boardWith({ miyake_call: "miyake_small_lies" }, { readOnly: true }),
    );

    expect(
      screen.queryByRole("button", { name: /移除：/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /放入「/ }),
    ).not.toBeInTheDocument();
    // The assigned card is still visible inside the group.
    expect(screen.getByText("三宅母親通話紀錄")).toBeInTheDocument();
  });

  it("styles keyboard focus and reduced-motion behavior in the shared card", () => {
    const cardSource = readFileSync(
      resolve(import.meta.dirname!, "AnalysisCard.svelte"),
      "utf8",
    );
    expect(cardSource).toContain(":focus-visible");
    expect(cardSource).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("deselects a selected card on a second click", async () => {
    const user = userEvent.setup();
    renderBoard(boardWith());

    const cardButton = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    await user.click(cardButton);
    expect(cardButton).toHaveAttribute("aria-pressed", "true");

    await user.click(cardButton);
    expect(cardButton).toHaveAttribute("aria-pressed", "false");
  });

  it("clears the selection when removing the currently selected card", async () => {
    const user = userEvent.setup();
    renderBoard(boardWith({ miyake_call: "miyake_small_lies" }));

    // Select the assigned card first.
    const cardButton = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    await user.click(cardButton);
    expect(cardButton).toHaveAttribute("aria-pressed", "true");

    // Remove it from the group — this should also clear the selection.
    await user.click(
      screen.getByRole("button", { name: "移除：三宅母親通話紀錄" }),
    );

    // After removal, the card is back in the unassigned pool and not pressed.
    const unassignedCard = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    expect(unassignedCard).toHaveAttribute("aria-pressed", "false");
  });

  it("preserves the selection and re-enables controls when onDraft rejects", async () => {
    const onDraft = vi.fn().mockRejectedValue(new Error("reject"));
    const user = userEvent.setup();
    renderBoard(boardWith(), onDraft);

    const cardButton = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    await user.click(cardButton);
    expect(cardButton).toHaveAttribute("aria-pressed", "true");

    const assignButton = screen.getByRole("button", {
      name: "放入「三宅的小謊」",
    });
    await user.click(assignButton);

    // onDraft was attempted but rejected; the selection must be preserved.
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(cardButton).toHaveAttribute("aria-pressed", "true");
    // pending resets in finally, so the assign button re-enables.
    expect(assignButton).toBeEnabled();
  });

  it("shows the empty state when all cards are assigned to groups", () => {
    renderBoard(
      boardWith({
        miyake_call: "miyake_small_lies",
        l_corridor_replay: "earlier_third_party",
        external_credential_event: "earlier_third_party",
      }),
    );

    expect(screen.getByText("所有卡片都已放入分組。")).toBeInTheDocument();
  });

  it("shows the empty state for a group with no cards", () => {
    renderBoard(boardWith({ miyake_call: "earlier_third_party" }));

    // "三宅的小謊" group has no cards assigned.
    expect(screen.getByText("尚未放入卡片。")).toBeInTheDocument();
  });

  it("leaves title, prompt, and hint presentation to the workbench host", () => {
    renderBoard(boardWith(undefined, { hint: "先問每項資料能證明什麼。" }));

    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(
      screen.queryByText("把每張卡放進它真正支持的命題。"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/提示：/)).not.toBeInTheDocument();
  });

  it("does not emit a draft when the disabled prop is true", async () => {
    const onDraft = vi.fn();
    render(ClassifyBoard, {
      board: boardWith(),
      onDraft,
      disabled: true,
    });

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("does not emit a draft for a stale non-classify draft kind", () => {
    const onDraft = vi.fn();
    const staleBoard: ClassifyBoardView = {
      ...fixtureBoard,
      draft: { kind: "order", cardIds: [] } as AnalysisDraft,
    };
    renderBoard(staleBoard, onDraft);

    // editable includes the draft-kind check, so a stale non-classify draft
    // fails closed: no select, assign, or remove controls are rendered.
    expect(
      screen.queryByRole("button", { name: /選取：/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /放入「/ }),
    ).not.toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("does not render remove buttons for a stale non-classify draft", () => {
    const onDraft = vi.fn();
    const staleBoard: ClassifyBoardView = {
      ...fixtureBoard,
      draft: { kind: "order", cardIds: [] } as AnalysisDraft,
    };
    renderBoard(staleBoard, onDraft);

    // With a stale draft, assignedCardIds is empty (derived checks
    // draft.kind === "classify"), so no cards appear in groups and no
    // remove buttons are rendered.
    expect(
      screen.queryByRole("button", { name: /移除：/ }),
    ).not.toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("does not select an unavailable card in the pool", async () => {
    const onDraft = vi.fn();
    const boardWithUnavailable = boardWith(
      {},
      {
        cards: fixtureBoard.cards.map((card) =>
          card.id === "miyake_call" ? { ...card, available: false } : card,
        ),
      },
    );
    renderBoard(boardWithUnavailable, onDraft);
    const user = userEvent.setup();

    // The unavailable card is in the pool but clicking it should not select it.
    await user.click(
      screen.getByRole("button", { name: /選取：\s*三宅母親通話紀錄/ }),
    );

    // The assign button should still be disabled because no card is selected.
    expect(
      screen.getByRole("button", { name: "放入「三宅的小謊」" }),
    ).toBeDisabled();
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("announces an invalid placement when a card is dropped on an unknown group", async () => {
    const onDraft = vi.fn();
    // The target decodes to a group target, but the groupId does not match
    // any authored group, so applyClassifyPlacement returns null.
    const resolveDropTarget = vi.fn(() => "classify:group:nonexistent_group");
    renderBoard(boardWith(), onDraft, { resolveDropTarget });

    const card = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    await fireEvent.pointerDown(card, {
      pointerId: 25,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(card, {
      pointerId: 25,
      pointerType: "mouse",
      clientX: 20,
      clientY: 10,
    });
    await fireEvent.pointerUp(card, {
      pointerId: 25,
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 10,
    });

    await waitFor(() => {
      expect(
        screen.getByRole("status", { name: "分類操作提示" }),
      ).toHaveTextContent("無效");
    });
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("cancels a drag without emitting a draft on pointercancel", async () => {
    const onDraft = vi.fn();
    const resolveDropTarget = vi.fn(() => "classify:group:miyake_small_lies");
    renderBoard(boardWith(), onDraft, { resolveDropTarget });

    const card = screen.getByRole("button", {
      name: /選取：\s*三宅母親通話紀錄/,
    });
    await fireEvent.pointerDown(card, {
      pointerId: 26,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(card, {
      pointerId: 26,
      pointerType: "mouse",
      clientX: 20,
      clientY: 10,
    });
    await fireEvent.pointerCancel(card, {
      pointerId: 26,
      pointerType: "mouse",
      clientX: 20,
      clientY: 10,
    });

    expect(onDraft).not.toHaveBeenCalled();
  });
});
