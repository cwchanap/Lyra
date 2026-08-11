import { cleanup, render, screen } from "@testing-library/svelte";
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
) {
  return render(ClassifyBoard, { board, onDraft });
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
      screen.getByRole("button", { name: /選取：三宅母親通話紀錄/ }),
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
      name: /選取：三宅母親通話紀錄/,
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
      screen.getByRole("button", { name: /選取：三宅母親通話紀錄/ }),
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
      screen.getByRole("button", { name: /選取：三宅母親通話紀錄/ }),
    ).toBeDisabled();
  });

  it("exposes no mutation controls for a read-only board", () => {
    renderBoard(boardWith({}, { readOnly: true }));

    expect(screen.queryAllByRole("button")).toHaveLength(0);
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
      name: /選取：三宅母親通話紀錄/,
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
      name: /選取：三宅母親通話紀錄/,
    });
    await user.click(cardButton);
    expect(cardButton).toHaveAttribute("aria-pressed", "true");

    // Remove it from the group — this should also clear the selection.
    await user.click(
      screen.getByRole("button", { name: "移除：三宅母親通話紀錄" }),
    );

    // After removal, the card is back in the unassigned pool and not pressed.
    const unassignedCard = screen.getByRole("button", {
      name: /選取：三宅母親通話紀錄/,
    });
    expect(unassignedCard).toHaveAttribute("aria-pressed", "false");
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

  it("renders a hint when the board has one", () => {
    renderBoard(boardWith(undefined, { hint: "先問每項資料能證明什麼。" }));

    expect(
      screen.getByText("提示：先問每項資料能證明什麼。"),
    ).toBeInTheDocument();
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

  it("does not emit a draft for a stale non-classify draft kind", async () => {
    const onDraft = vi.fn();
    const staleBoard: ClassifyBoardView = {
      ...fixtureBoard,
      draft: { kind: "order", cardIds: [] } as AnalysisDraft,
    };
    renderBoard(staleBoard, onDraft);
    const user = userEvent.setup();

    // Buttons are rendered (editable doesn't check draft kind), but clicking
    // them must not emit because assignCard/removeCard guard the draft kind.
    await user.click(
      screen.getByRole("button", { name: /選取：三宅母親通話紀錄/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "放入「三宅的小謊」" }),
    );

    expect(onDraft).not.toHaveBeenCalled();
  });
});
