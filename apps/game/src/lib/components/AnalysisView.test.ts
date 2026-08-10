import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import AnalysisView from "./AnalysisView.svelte";
import type {
  AnalysisActionToken,
  AnalysisBoardView,
  AnalysisDraft,
  SceneView,
} from "../state/types";

type AnalysisSceneView = Extract<SceneView, { kind: "analysis" }>;

function p1Scene(): AnalysisSceneView {
  return {
    kind: "analysis",
    id: "analysis_scene_p1_5",
    title: "把時間排回去",
    summary: "P1 practice",
    index: 2,
    total: 17,
    activeBoardId: "p1_reprint_time_board",
    actionToken: {
      sceneId: "analysis_scene_p1_5",
      activeBoardId: "p1_reprint_time_board",
      durableRevision: 3,
    },
    availableBoardIds: ["p1_reprint_time_board"],
    backgroundAssetId: null,
    bgm: null,
    bgs: null,
    visibleBoards: [
      {
        kind: "threshold",
        id: "p1_reprint_time_board",
        label: "重印時間整理",
        prompt: "選出正確的三項資料。",
        minimumSelected: 3,
        selectedCardIds: [],
        available: true,
        completed: false,
        readOnly: false,
        draft: { kind: "threshold", selectedCardIds: [] },
        feedback: null,
        hint: null,
        cards: [
          {
            id: "receipt_reprint",
            label: "標示 REPRINT 的收據",
            summary: "十七點四十二分的重印時間。",
            source: {
              kind: "practice",
              id: "receipt_reprint",
              label: null,
              summary: null,
            },
            sourceLabel: null,
            sourceSummary: null,
            available: true,
          },
          {
            id: "register_paper_jam",
            label: "收銀機出紙口的卡紙痕跡",
            summary: "原本的收據可能卡住。",
            source: {
              kind: "practice",
              id: "register_paper_jam",
              label: null,
              summary: null,
            },
            sourceLabel: null,
            sourceSummary: null,
            available: true,
          },
          {
            id: "cctv_change",
            label: "監視器中的找零畫面",
            summary: "學生在十七點三十八分前離開。",
            source: {
              kind: "practice",
              id: "cctv_change",
              label: null,
              summary: null,
            },
            sourceLabel: null,
            sourceSummary: null,
            available: true,
          },
          {
            id: "handwritten_ledger",
            label: "手寫帳本的影印費",
            summary: "十七點三十七分的收入。",
            source: {
              kind: "practice",
              id: "handwritten_ledger",
              label: null,
              summary: null,
            },
            sourceLabel: null,
            sourceSummary: null,
            available: true,
          },
        ],
      },
    ],
  };
}

function renderP1(overrides?: {
  feedback?: string | null;
  onSelection?: (
    actionToken: AnalysisActionToken,
    draft: AnalysisDraft,
  ) => Promise<void>;
  onSubmit?: (actionToken: AnalysisActionToken) => Promise<void>;
}) {
  return render(AnalysisView, {
    scene: p1Scene(),
    boardId: "p1_reprint_time_board",
    feedback: overrides?.feedback ?? null,
    onSelection: overrides?.onSelection ?? vi.fn(),
    onSubmit: overrides?.onSubmit ?? vi.fn(),
  });
}

describe("AnalysisView", () => {
  it("keeps the public board union while retaining threshold rendering", () => {
    expectTypeOf<AnalysisBoardView["kind"]>().toEqualTypeOf<
      "classify" | "order" | "threshold"
    >();
  });

  it("renders all four P1-local practice cards", () => {
    const { getByText, queryByText } = renderP1();

    expect(getByText("標示 REPRINT 的收據")).toBeTruthy();
    expect(getByText("收銀機出紙口的卡紙痕跡")).toBeTruthy();
    expect(getByText("監視器中的找零畫面")).toBeTruthy();
    expect(getByText("手寫帳本的影印費")).toBeTruthy();
    expect(queryByText("此分析板需要分類或排序操作。")).toBeNull();
  });

  it("sends a threshold selection and comparison through the P1 board", async () => {
    const onSelection = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { getByRole } = renderP1({ onSelection, onSubmit });

    await fireEvent.click(getByRole("button", { name: /標示 REPRINT 的收據/ }));
    expect(onSelection).toHaveBeenCalledExactlyOnceWith(p1Scene().actionToken, {
      kind: "threshold",
      selectedCardIds: ["receipt_reprint"],
    });

    await fireEvent.click(getByRole("button", { name: "比對推論" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(p1Scene().actionToken);
  });

  it("contains a rejected selection callback inside the card handler", async () => {
    const error = new Error("selection failed");
    const onSelection = vi.fn().mockRejectedValue(error);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getByRole } = renderP1({ onSelection });

    try {
      await fireEvent.click(
        getByRole("button", { name: /標示 REPRINT 的收據/ }),
      );
      expect(onSelection).toHaveBeenCalledExactlyOnceWith(
        p1Scene().actionToken,
        { kind: "threshold", selectedCardIds: ["receipt_reprint"] },
      );
      expect(warn).toHaveBeenCalledWith("[Analysis] Selection failed", error);
    } finally {
      warn.mockRestore();
    }
  });

  it("contains a rejected submission callback inside the submit handler", async () => {
    const error = new Error("submission failed");
    const onSubmit = vi.fn().mockRejectedValue(error);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getByRole } = renderP1({ onSubmit });

    try {
      await fireEvent.click(getByRole("button", { name: "比對推論" }));
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith(p1Scene().actionToken);
      expect(warn).toHaveBeenCalledWith("[Analysis] Submission failed", error);
    } finally {
      warn.mockRestore();
    }
  });

  it("renders authored wrong-choice feedback", () => {
    const { getByRole } = renderP1({
      feedback: "監視器畫面是真的，但不能單獨說明十七點四十二分。",
    });

    expect(getByRole("status").textContent).toContain("監視器畫面是真的");
  });

  it("renders the classify/order placeholder for non-threshold boards", () => {
    const classifyScene: AnalysisSceneView = {
      ...p1Scene(),
      visibleBoards: [
        {
          kind: "classify",
          id: "classify_board",
          label: "分類板",
          prompt: "分類",
          cards: [],
          groups: [],
          available: true,
          completed: false,
          readOnly: false,
          draft: { kind: "classify", groupByCard: {} },
          feedback: null,
          hint: null,
        },
      ],
      activeBoardId: "classify_board",
    };
    const { getByText, queryByText } = render(AnalysisView, {
      scene: classifyScene,
      boardId: "classify_board",
      feedback: null,
      onSelection: vi.fn(),
      onSubmit: vi.fn(),
    });
    expect(getByText("此分析板需要分類或排序操作。")).toBeTruthy();
    expect(queryByText("比對推論")).toBeNull();
  });

  it("renders the loading placeholder when the board is not found", () => {
    const { getByText } = render(AnalysisView, {
      scene: p1Scene(),
      boardId: "nonexistent_board",
      feedback: null,
      onSelection: vi.fn(),
      onSubmit: vi.fn(),
    });
    expect(getByText("分析板載入中。")).toBeTruthy();
  });

  it("disables card buttons and submit when the disabled prop is set", () => {
    const onSelection = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { getByRole } = render(AnalysisView, {
      scene: p1Scene(),
      boardId: "p1_reprint_time_board",
      feedback: null,
      onSelection,
      onSubmit,
      disabled: true,
    });
    const cardButton = getByRole("button", { name: /標示 REPRINT 的收據/ });
    expect(cardButton).toBeDisabled();
    const submitButton = getByRole("button", { name: "比對推論" });
    expect(submitButton).toBeDisabled();
    // Clicking disabled buttons should not invoke callbacks.
    fireEvent.click(cardButton);
    fireEvent.click(submitButton);
    expect(onSelection).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables card buttons and submit when the board is completed", () => {
    const completedScene: AnalysisSceneView = {
      ...p1Scene(),
      visibleBoards: [
        {
          ...p1Scene().visibleBoards[0],
          completed: true,
          readOnly: true,
          selectedCardIds: [
            "receipt_reprint",
            "register_paper_jam",
            "cctv_change",
          ],
        },
      ],
    };
    const onSelection = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { getByRole } = render(AnalysisView, {
      scene: completedScene,
      boardId: "p1_reprint_time_board",
      feedback: null,
      onSelection,
      onSubmit,
    });
    const cardButton = getByRole("button", { name: /標示 REPRINT 的收據/ });
    expect(cardButton).toBeDisabled();
    const submitButton = getByRole("button", { name: "比對推論" });
    expect(submitButton).toBeDisabled();
  });

  it("toggles a card off when clicking an already-selected card", async () => {
    const onSelection = vi.fn().mockResolvedValue(undefined);
    const sceneWithSelection: AnalysisSceneView = {
      ...p1Scene(),
      visibleBoards: [
        {
          ...p1Scene().visibleBoards[0],
          selectedCardIds: ["receipt_reprint"],
        },
      ],
    };
    const { getByRole } = render(AnalysisView, {
      scene: sceneWithSelection,
      boardId: "p1_reprint_time_board",
      feedback: null,
      onSelection,
      onSubmit: vi.fn(),
    });
    await fireEvent.click(getByRole("button", { name: /標示 REPRINT 的收據/ }));
    expect(onSelection).toHaveBeenCalledExactlyOnceWith(
      sceneWithSelection.actionToken,
      { kind: "threshold", selectedCardIds: [] },
    );
  });

  it("disables unavailable cards", () => {
    const sceneWithUnavailableCard: AnalysisSceneView = {
      ...p1Scene(),
      visibleBoards: [
        {
          ...p1Scene().visibleBoards[0],
          cards: [
            {
              ...p1Scene().visibleBoards[0].cards[0],
              available: false,
            },
            ...p1Scene().visibleBoards[0].cards.slice(1),
          ],
        },
      ],
    };
    const { getByRole } = render(AnalysisView, {
      scene: sceneWithUnavailableCard,
      boardId: "p1_reprint_time_board",
      feedback: null,
      onSelection: vi.fn(),
      onSubmit: vi.fn(),
    });
    const unavailableButton = getByRole("button", {
      name: /標示 REPRINT 的收據/,
    });
    expect(unavailableButton).toBeDisabled();
  });

  it("renders board-level feedback from the board view when no override is supplied", () => {
    const sceneWithBoardFeedback: AnalysisSceneView = {
      ...p1Scene(),
      visibleBoards: [
        {
          ...p1Scene().visibleBoards[0],
          feedback: {
            state: "incorrect",
            message: "選擇的線索不足以推論重印時間。",
          },
        },
      ],
    };
    const { getByRole } = render(AnalysisView, {
      scene: sceneWithBoardFeedback,
      boardId: "p1_reprint_time_board",
      feedback: null,
      onSelection: vi.fn(),
      onSubmit: vi.fn(),
    });
    expect(getByRole("status").textContent).toContain(
      "選擇的線索不足以推論重印時間",
    );
  });
});
