import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeTopmostEscapeClaim,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import type { CrossExamView, Inventory } from "../state/types";
import {
  neutralEvidenceRecordView,
  neutralStatementRecordView,
} from "../state/test-fixtures";
import * as storyAssets from "$lib/assets/story-assets";
import InterrogationEvidenceTray from "./InterrogationEvidenceTray.svelte";

const crossExam: CrossExamView = {
  questionId: "q_alibi",
  lineId: "line_1",
  lineLabel: "否認",
  lineContent: [
    { kind: "sceneTag", text: "雨聲。" },
    { kind: "action", text: "她移開視線。" },
    { kind: "line", speaker: "嫌疑人", text: "我沒去。" },
  ],
  lineIndex: 0,
  lineTotal: 3,
  presenting: true,
};

const inventory: Inventory = {
  evidence: [
    neutralEvidenceRecordView({
      id: "coffee-order",
      name: "咖啡訂單",
      description: "訂單時間與證詞不符。",
      details: "最終列印時間為 21:17。",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "scene_1",
    }),
  ],
  statements: [
    neutralStatementRecordView({
      id: "clerk-statement",
      speaker: "店員的證言",
      content: "她在雨勢轉大前離開。",
      onReexamine: null,
      acquiredInChapterId: "chapter_1",
      acquiredInSceneId: "scene_1",
    }),
  ],
};

function props(
  overrides: Partial<{
    inventory: Inventory;
    disabled: boolean;
    returnFocusTo: HTMLElement | null;
    fallbackFocusTarget: HTMLElement | null;
    onPresent: (
      lineId: string,
      kind: "evidence" | "statement",
      itemId: string,
    ) => void;
    onResume: () => void;
    onOpenGameMenu: (trigger: HTMLElement) => void;
  }> = {},
) {
  return {
    crossExam,
    inventory: overrides.inventory ?? inventory,
    disabled: overrides.disabled ?? false,
    returnFocusTo: overrides.returnFocusTo ?? null,
    fallbackFocusTarget: overrides.fallbackFocusTarget ?? null,
    onPresent: overrides.onPresent ?? vi.fn(),
    onResume: overrides.onResume ?? vi.fn(),
    onOpenGameMenu: overrides.onOpenGameMenu ?? vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  resetEscapeCoordinator();
});

describe("InterrogationEvidenceTray", () => {
  it("submits the selected evidence and statement against the live testimony line", async () => {
    const user = userEvent.setup();
    const onPresent = vi.fn();
    render(InterrogationEvidenceTray, props({ onPresent }));

    expect(screen.getByRole("dialog", { name: "提出證據" })).toHaveTextContent(
      "她移開視線。我沒去。",
    );
    expect(screen.getByText("訂單時間與證詞不符。")).toBeInTheDocument();
    expect(screen.getByText("最終列印時間為 21:17。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /咖啡訂單/ }));
    await user.click(screen.getByRole("button", { name: /店員的證言/ }));

    expect(onPresent).toHaveBeenNthCalledWith(
      1,
      "line_1",
      "evidence",
      "coffee-order",
    );
    expect(onPresent).toHaveBeenNthCalledWith(
      2,
      "line_1",
      "statement",
      "clerk-statement",
    );
  });

  it("resumes the testimony from 收回 and its topmost Escape claim", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(InterrogationEvidenceTray, props({ onResume }));

    await user.click(screen.getByRole("button", { name: "收回" }));
    expect(onResume).toHaveBeenCalledTimes(1);

    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(onResume).toHaveBeenCalledTimes(2);
  });

  it("opens the game menu without resuming the active Present state", async () => {
    const user = userEvent.setup();
    const onOpenGameMenu = vi.fn();
    const onResume = vi.fn();
    render(InterrogationEvidenceTray, props({ onOpenGameMenu, onResume }));

    await user.click(screen.getByRole("button", { name: "遊戲選單" }));

    expect(onOpenGameMenu).toHaveBeenCalledOnce();
    expect(onOpenGameMenu).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
    expect(onResume).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "提出證據" }),
    ).toBeInTheDocument();
  });

  it("traps tab focus among its active controls", async () => {
    const user = userEvent.setup();
    render(InterrogationEvidenceTray, props());

    const evidence = screen.getByRole("button", { name: /咖啡訂單/ });
    const statement = screen.getByRole("button", { name: /店員的證言/ });
    const gameMenu = screen.getByRole("button", { name: "遊戲選單" });
    const withdraw = screen.getByRole("button", { name: "收回" });

    await waitFor(() => expect(evidence).toHaveFocus());
    await user.tab();
    expect(statement).toHaveFocus();
    await user.tab();
    expect(gameMenu).toHaveFocus();
    await user.tab();
    expect(withdraw).toHaveFocus();
    await user.tab();
    expect(evidence).toHaveFocus();
  });

  it("returns focus to a connected trigger when the tray unmounts", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "evidence hud";
    document.body.append(trigger);
    const result = render(
      InterrogationEvidenceTray,
      props({ returnFocusTo: trigger }),
    );

    try {
      result.unmount();
      await waitFor(() => expect(trigger).toHaveFocus());
    } finally {
      trigger.remove();
    }
  });

  it("uses the stage fallback when document.body was the focus origin", async () => {
    const fallback = document.createElement("div");
    fallback.tabIndex = -1;
    document.body.append(fallback);
    const result = render(
      InterrogationEvidenceTray,
      props({ returnFocusTo: document.body, fallbackFocusTarget: fallback }),
    );

    try {
      result.unmount();
      await waitFor(() => expect(fallback).toHaveFocus());
    } finally {
      fallback.remove();
    }
  });

  it("keeps evidence, 收回, and Escape inert while the game command is in flight", async () => {
    const user = userEvent.setup();
    const onPresent = vi.fn();
    const onResume = vi.fn();
    const onOpenGameMenu = vi.fn();
    render(
      InterrogationEvidenceTray,
      props({ disabled: true, onPresent, onResume, onOpenGameMenu }),
    );

    const evidence = screen.getByRole("button", { name: /咖啡訂單/ });
    const gameMenu = screen.getByRole("button", { name: "遊戲選單" });
    const withdraw = screen.getByRole("button", { name: "收回" });
    expect(evidence).toBeDisabled();
    expect(gameMenu).toBeDisabled();
    expect(withdraw).toBeDisabled();

    await user.click(evidence);
    await user.click(gameMenu);
    await user.click(withdraw);
    expect(closeTopmostEscapeClaim()).toBe(true);

    expect(onPresent).not.toHaveBeenCalled();
    expect(onOpenGameMenu).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it("renders a resolved evidence image and swaps to a placeholder when the image fails to load", async () => {
    const inventoryWithImage: Inventory = {
      evidence: [
        neutralEvidenceRecordView({
          id: "coffee-order",
          name: "咖啡訂單",
          description: "訂單時間與證詞不符。",
          details: "最終列印時間為 21:17。",
          imageAssetId: "evidence.coffee_order.receipt",
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
        }),
      ],
      statements: [],
    };

    const { container } = render(
      InterrogationEvidenceTray,
      props({ inventory: inventoryWithImage }),
    );

    const img = await waitFor(() => {
      const el =
        container.querySelector<HTMLImageElement>(".evidence-card img");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(img).toHaveAttribute(
      "src",
      expect.stringContaining("/assets/evidence/coffee_order.receipt.png"),
    );

    // Simulate a browser load failure (the URL is path-construction-only;
    // the actual file does not exist in jsdom). The onerror handler must
    // swap the src to a placeholder data URI.
    img.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(img).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });

  it("falls back to a placeholder when evidence image resolution rejects", async () => {
    const assetId = "evidence.broken_asset.reject_test";
    const inventoryWithFailingImage: Inventory = {
      evidence: [
        neutralEvidenceRecordView({
          id: "broken-evidence",
          name: "破損證物",
          description: "無法載入。",
          details: "",
          imageAssetId: assetId,
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
        }),
      ],
      statements: [],
    };

    const resolveSpy = vi
      .spyOn(storyAssets, "resolveStoryAsset")
      .mockRejectedValueOnce(new Error("network"));

    try {
      const { container } = render(
        InterrogationEvidenceTray,
        props({ inventory: inventoryWithFailingImage }),
      );

      const img = await waitFor(() => {
        const el =
          container.querySelector<HTMLImageElement>(".evidence-card img");
        expect(el).not.toBeNull();
        return el!;
      });
      expect(img).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    } finally {
      resolveSpy.mockRestore();
    }
  });
});
