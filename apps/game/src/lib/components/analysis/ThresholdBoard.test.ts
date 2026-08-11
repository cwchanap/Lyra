import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beat85CompilerAnalysisInventoryFixture,
  beat85CompilerAnalysisSceneFixture,
  p1PracticeAnalysisSceneFixture,
} from "$lib/analysis/test-fixtures";
import type {
  AnalysisBoardView,
  AnalysisCardView,
  AnalysisDraft,
  Inventory,
} from "$lib/state/types";
import ThresholdBoard from "./ThresholdBoard.svelte";

type ThresholdBoardView = Extract<AnalysisBoardView, { kind: "threshold" }>;
type ThresholdDraft = Extract<AnalysisDraft, { kind: "threshold" }>;

const emptyInventory: Inventory = { evidence: [], statements: [] };

function requireThresholdBoard(
  scene:
    | typeof p1PracticeAnalysisSceneFixture
    | typeof beat85CompilerAnalysisSceneFixture,
): ThresholdBoardView {
  const board = scene.visibleBoards.find(
    (candidate): candidate is ThresholdBoardView =>
      candidate.kind === "threshold",
  );
  if (!board) throw new Error("Fixture must include a threshold board");
  return board;
}

const practiceFixtureBoard = requireThresholdBoard(
  p1PracticeAnalysisSceneFixture,
);
const realFixtureBoard = requireThresholdBoard(
  beat85CompilerAnalysisSceneFixture,
);

function boardWith(
  board: ThresholdBoardView,
  overrides: Partial<ThresholdBoardView> = {},
): ThresholdBoardView {
  const draft =
    overrides.draft ??
    (board.draft.kind === "threshold"
      ? { kind: "threshold", selectedCardIds: [...board.draft.selectedCardIds] }
      : { kind: "threshold", selectedCardIds: [] });
  return {
    ...board,
    ...overrides,
    draft,
  };
}

function renderBoard(
  board: ThresholdBoardView = boardWith(practiceFixtureBoard),
  inventory: Inventory = emptyInventory,
  onDraft: (draft: ThresholdDraft, focusKey: string) => void = vi.fn(),
) {
  return render(ThresholdBoard, { board, inventory, onDraft });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThresholdBoard", () => {
  it("renders all four practice cards without an inventory lookup", () => {
    renderBoard();

    expect(screen.getByText("標示 REPRINT 的收據")).toBeInTheDocument();
    expect(screen.getByText("收銀機出紙口的卡紙痕跡")).toBeInTheDocument();
    expect(screen.getByText("監視器中的找零畫面")).toBeInTheDocument();
    expect(screen.getByText("手寫帳本的影印費")).toBeInTheDocument();
    expect(screen.queryByText(/來源類型：/)).not.toBeInTheDocument();
  });

  it("uses the same threshold draft for pointer and keyboard toggles", async () => {
    const pointerOnDraft = vi.fn();
    const pointerUser = userEvent.setup();
    renderBoard(
      boardWith(practiceFixtureBoard),
      emptyInventory,
      pointerOnDraft,
    );

    await pointerUser.click(
      screen.getByRole("button", { name: "選取：標示 REPRINT 的收據" }),
    );
    const pointerDraft = pointerOnDraft.mock.lastCall;

    cleanup();

    const keyboardOnDraft = vi.fn();
    const keyboardUser = userEvent.setup();
    renderBoard(
      boardWith(practiceFixtureBoard),
      emptyInventory,
      keyboardOnDraft,
    );
    const card = screen.getByRole("button", {
      name: "選取：標示 REPRINT 的收據",
    });
    card.focus();
    await keyboardUser.keyboard("{Enter}");

    expect(keyboardOnDraft.mock.lastCall).toEqual(pointerDraft);
    expect(keyboardOnDraft).toHaveBeenLastCalledWith(
      { kind: "threshold", selectedCardIds: ["receipt_reprint"] },
      "card:receipt_reprint",
    );
  });

  it("emits selected IDs in deterministic sorted order", async () => {
    const onDraft = vi.fn();
    const user = userEvent.setup();
    renderBoard(
      boardWith(practiceFixtureBoard, {
        draft: { kind: "threshold", selectedCardIds: ["handwritten_ledger"] },
      }),
      emptyInventory,
      onDraft,
    );

    await user.click(
      screen.getByRole("button", { name: "選取：監視器中的找零畫面" }),
    );

    expect(onDraft).toHaveBeenLastCalledWith(
      {
        kind: "threshold",
        selectedCardIds: ["cctv_change", "handwritten_ledger"],
      },
      "card:cctv_change",
    );
  });

  it("toggles an already-selected practice card off", async () => {
    const onDraft = vi.fn();
    const user = userEvent.setup();
    renderBoard(
      boardWith(practiceFixtureBoard, {
        draft: { kind: "threshold", selectedCardIds: ["receipt_reprint"] },
      }),
      emptyInventory,
      onDraft,
    );

    await user.click(
      screen.getByRole("button", { name: "選取：標示 REPRINT 的收據" }),
    );

    expect(onDraft).toHaveBeenLastCalledWith(
      { kind: "threshold", selectedCardIds: [] },
      "card:receipt_reprint",
    );
  });

  it("uses board.draft as the authoritative selection", () => {
    const contradictory = boardWith(practiceFixtureBoard, {
      selectedCardIds: ["receipt_reprint"],
      draft: { kind: "threshold", selectedCardIds: [] },
    });
    renderBoard(contradictory);

    expect(
      screen.getByRole("button", { name: "選取：標示 REPRINT 的收據" }),
    ).not.toHaveAttribute("aria-pressed", "true");
  });

  it("disables unavailable cards", () => {
    const unavailable = boardWith(practiceFixtureBoard, {
      cards: practiceFixtureBoard.cards.map((card) =>
        card.id === "receipt_reprint" ? { ...card, available: false } : card,
      ),
    });
    renderBoard(unavailable);

    expect(
      screen.getByRole("button", { name: "選取：標示 REPRINT 的收據" }),
    ).toBeDisabled();
  });

  it.each([
    { completed: true, readOnly: false },
    { completed: false, readOnly: true },
  ])("exposes no mutation control for a completed/read-only board", (state) => {
    renderBoard(boardWith(practiceFixtureBoard, state));

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("allows two same-source-group records to be selected locally", async () => {
    const sameSourceEvidence =
      beat85CompilerAnalysisInventoryFixture.evidence.find(
        (record) => record.id === "same_source_group_evidence",
      );
    const sameSourceStatement =
      beat85CompilerAnalysisInventoryFixture.statements.find(
        (record) => record.id === "same_source_group_statement",
      );
    if (!sameSourceEvidence || !sameSourceStatement) {
      throw new Error("Fixture must include same-source-group records");
    }
    const cards: AnalysisCardView[] = [
      {
        id: "same-source-evidence-card",
        label: "同源紀錄 A",
        summary: "同一來源群組的紀錄 A。",
        source: {
          kind: "evidence",
          id: sameSourceEvidence.id,
          label: "卡片投影 A",
          summary: sameSourceEvidence.description,
        },
        sourceLabel: "卡片投影 A",
        sourceSummary: sameSourceEvidence.description,
        available: true,
      },
      {
        id: "same-source-statement-card",
        label: "同源紀錄 B",
        summary: "同一來源群組的紀錄 B。",
        source: {
          kind: "statement",
          id: sameSourceStatement.id,
          label: "卡片投影 B",
          summary: sameSourceStatement.content,
        },
        sourceLabel: "卡片投影 B",
        sourceSummary: sameSourceStatement.content,
        available: true,
      },
    ];
    const onDraft = vi.fn();
    const user = userEvent.setup();
    renderBoard(
      boardWith(realFixtureBoard, {
        cards,
        draft: {
          kind: "threshold",
          selectedCardIds: ["same-source-evidence-card"],
        },
      }),
      beat85CompilerAnalysisInventoryFixture,
      onDraft,
    );

    await user.click(screen.getByRole("button", { name: "選取：同源紀錄 B" }));

    expect(onDraft).toHaveBeenLastCalledWith(
      {
        kind: "threshold",
        selectedCardIds: [
          "same-source-evidence-card",
          "same-source-statement-card",
        ],
      },
      "card:same-source-statement-card",
    );
  });

  it("shows shared provenance vocabulary for real inventory records", () => {
    const card = realFixtureBoard.cards.find(
      (candidate) => candidate.id === "lock_sequence",
    );
    if (!card) throw new Error("Fixture must include lock_sequence card");
    const projectedCard = {
      ...card,
      sourceLabel: "卡片投影名稱",
      source: { ...card.source, label: "卡片投影名稱" },
    };
    renderBoard(
      boardWith(realFixtureBoard, { cards: [projectedCard] }),
      beat85CompilerAnalysisInventoryFixture,
    );

    expect(screen.getByText("來源類型：數位紀錄")).toBeInTheDocument();
    expect(screen.getByText("程序狀態：重新取得")).toBeInTheDocument();
    expect(screen.getByText("來源：雨鐘後場門鎖")).toBeInTheDocument();
    expect(screen.getByText("來源群組：門鎖本機")).toBeInTheDocument();
    expect(screen.getByText("可證明：時間、順序")).toBeInTheDocument();
    expect(screen.queryByText("來源：卡片投影名稱")).not.toBeInTheDocument();
  });
});
