import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beat85CompilerAnalysisInventoryFixture,
  beat85CompilerAnalysisSceneFixture,
  p1PracticeAnalysisSceneFixture,
} from "$lib/analysis/test-fixtures";
import {
  neutralEvidenceRecordView,
  neutralStatementRecordView,
} from "$lib/state/test-fixtures";
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
      screen.getByRole("button", { name: /選取：\s*標示 REPRINT 的收據/ }),
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
      name: /選取：\s*標示 REPRINT 的收據/,
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
      screen.getByRole("button", { name: /選取：\s*監視器中的找零畫面/ }),
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
      screen.getByRole("button", { name: /選取：\s*標示 REPRINT 的收據/ }),
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
      screen.getByRole("button", { name: /選取：\s*標示 REPRINT 的收據/ }),
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
      screen.getByRole("button", { name: /選取：\s*標示 REPRINT 的收據/ }),
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

    await user.click(
      screen.getByRole("button", { name: /選取：\s*同源紀錄 B/ }),
    );

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

  it("renders a statement card's provenance from the inventory", () => {
    const statementRecord = neutralStatementRecordView({
      id: "manager_timing",
      speaker: "店長",
      content: "證詞內容。",
      onReexamine: null,
      acquiredInChapterId: "chapter_1",
      acquiredInSceneId: "investigation_scene_1",
    });
    statementRecord.provenance = {
      sourceKind: "testimony",
      representationLayer: "none",
      proceduralStatus: "exhibit",
      completeness: "unspecified",
      confidence: "unspecified",
      sourceGroupId: "manager-interview",
      sourceLabel: "店長程序固定訪談",
      proofCapabilities: ["time"],
      supersedesRecordId: null,
    };
    statementRecord.sourceGroup = {
      id: "manager-interview",
      label: "店長訪談",
      summary: "店長程序固定訪談的紀錄。",
    };
    const statementCardView: AnalysisCardView = {
      id: "manager_timing_card",
      label: "店長時間證詞",
      summary: "提供另一個可被程序固定的時間來源。",
      source: {
        kind: "statement",
        id: "manager_timing",
        label: "店長",
        summary: "證詞內容。",
      },
      sourceLabel: "店長",
      sourceSummary: "證詞內容。",
      available: true,
    };
    renderBoard(boardWith(realFixtureBoard, { cards: [statementCardView] }), {
      evidence: [],
      statements: [statementRecord],
    });

    expect(screen.getByText("來源類型：證人證詞")).toBeInTheDocument();
    expect(screen.getByText("程序狀態：正式證物")).toBeInTheDocument();
    expect(screen.getByText("來源：店長程序固定訪談")).toBeInTheDocument();
    expect(screen.getByText("來源群組：店長訪談")).toBeInTheDocument();
    expect(screen.getByText("可證明：時間")).toBeInTheDocument();
  });

  it("renders an empty provenance block for a record with all-neutral provenance", () => {
    const neutralRecord = neutralEvidenceRecordView({
      id: "neutral_evidence",
      name: "中性證物",
      description: "無來源標記的證物。",
      details: "細節。",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "investigation_scene_1",
    });
    const neutralCard: AnalysisCardView = {
      id: "neutral_card",
      label: "中性證物卡",
      summary: "無來源標記。",
      source: {
        kind: "evidence",
        id: "neutral_evidence",
        label: null,
        summary: null,
      },
      sourceLabel: null,
      sourceSummary: null,
      available: true,
    };
    renderBoard(boardWith(realFixtureBoard, { cards: [neutralCard] }), {
      evidence: [neutralRecord],
      statements: [],
    });

    // The provenance div renders (record exists) but all fields are null.
    expect(screen.getByRole("region", { name: "門檻板" })).toBeInTheDocument();
    expect(screen.queryByText(/來源類型：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/程序狀態：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/來源：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/來源群組：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/可證明：/)).not.toBeInTheDocument();
  });

  it("does not emit a draft when the disabled prop is true", async () => {
    const onDraft = vi.fn();
    render(ThresholdBoard, {
      board: boardWith(practiceFixtureBoard),
      inventory: emptyInventory,
      onDraft,
      disabled: true,
    });

    // No buttons rendered when not editable.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("does not emit a draft for a stale non-threshold draft kind", () => {
    const onDraft = vi.fn();
    const staleBoard = boardWith(practiceFixtureBoard, {
      draft: { kind: "classify", groupByCard: {} } as AnalysisDraft,
    });
    renderBoard(staleBoard, emptyInventory, onDraft);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("renders a hint when the board has one", () => {
    renderBoard(boardWith(practiceFixtureBoard, { hint: "先看時間順序。" }));

    expect(screen.getByText("提示：先看時間順序。")).toBeInTheDocument();
  });
});
