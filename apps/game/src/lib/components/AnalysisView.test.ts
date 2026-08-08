import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import AnalysisView from "./AnalysisView.svelte";
import type { SceneView } from "../state/types";

type AnalysisSceneView = Extract<SceneView, { kind: "analysis" }>;

function p1Scene(): AnalysisSceneView {
  return {
    kind: "analysis",
    id: "analysis_scene_p1_5",
    title: "把時間排回去",
    summary: "P1 practice",
    index: 2,
    total: 17,
    visibleBoards: [
      {
        kind: "threshold",
        id: "p1_reprint_time_board",
        label: "重印時間整理",
        prompt: "選出正確的三項資料。",
        minimumSelected: 3,
        selectedCardIds: [],
        completed: false,
        cards: [
          {
            id: "receipt_reprint",
            label: "標示 REPRINT 的收據",
            summary: "十七點四十二分的重印時間。",
            available: true,
          },
          {
            id: "register_paper_jam",
            label: "收銀機出紙口的卡紙痕跡",
            summary: "原本的收據可能卡住。",
            available: true,
          },
          {
            id: "cctv_change",
            label: "監視器中的找零畫面",
            summary: "學生在十七點三十八分前離開。",
            available: true,
          },
          {
            id: "handwritten_ledger",
            label: "手寫帳本的影印費",
            summary: "十七點三十七分的收入。",
            available: true,
          },
        ],
      },
    ],
  };
}

function renderP1(overrides?: {
  feedback?: string | null;
  onSelection?: (boardId: string, cardIds: string[]) => Promise<void>;
  onSubmit?: (boardId: string) => Promise<void>;
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
  it("renders all four P1-local practice cards", () => {
    const { getByText } = renderP1();

    expect(getByText("標示 REPRINT 的收據")).toBeTruthy();
    expect(getByText("收銀機出紙口的卡紙痕跡")).toBeTruthy();
    expect(getByText("監視器中的找零畫面")).toBeTruthy();
    expect(getByText("手寫帳本的影印費")).toBeTruthy();
  });

  it("sends a threshold selection and comparison through the P1 board", async () => {
    const onSelection = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { getByRole } = renderP1({ onSelection, onSubmit });

    await fireEvent.click(getByRole("button", { name: /標示 REPRINT 的收據/ }));
    expect(onSelection).toHaveBeenCalledExactlyOnceWith(
      "p1_reprint_time_board",
      ["receipt_reprint"],
    );

    await fireEvent.click(getByRole("button", { name: "比對推論" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("p1_reprint_time_board");
  });

  it("renders authored wrong-choice feedback", () => {
    const { getByRole } = renderP1({
      feedback: "監視器畫面是真的，但不能單獨說明十七點四十二分。",
    });

    expect(getByRole("status").textContent).toContain("監視器畫面是真的");
  });
});
