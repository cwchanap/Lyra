import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeTopmostEscapeClaim,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import type { CrossExamView, Inventory } from "../state/types";
import {
  neutralCaseRecordProvenance,
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

const coffeeReceipt = neutralEvidenceRecordView({
  id: "receipt",
  name: "咖啡收據",
  description: "十七點四十二分的消費紀錄。",
  details: "付款末四碼 0192。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "scene_1",
});
coffeeReceipt.provenance = {
  ...neutralCaseRecordProvenance(),
  sourceLabel: "店內收銀匯出",
};

const inventory: Inventory = {
  evidence: [coffeeReceipt],
  statements: [
    neutralStatementRecordView({
      id: "witness",
      speaker: "目擊者",
      content: "我看見她走進巷子。",
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
    topLayerOpen: boolean;
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
    topLayerOpen: overrides.topLayerOpen ?? false,
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
  it("excludes the transient Present scrim from save thumbnails", () => {
    const { container } = render(InterrogationEvidenceTray, props());

    const scrim = container.querySelector(".interrogation-tray-scrim");
    expect(scrim).not.toBeNull();
    expect(scrim).toHaveAttribute("data-save-thumbnail-exclude", "");
  });

  it("renders tile choices with a transient hover and focus detail panel", async () => {
    const user = userEvent.setup();
    const { container } = render(InterrogationEvidenceTray, props());

    const grid = container.querySelector("[data-interrogation-evidence-grid]");
    expect(grid).not.toBeNull();

    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );
    expect(detail).not.toBeNull();
    expect(detail).toHaveTextContent(
      "將游標移至紀錄，或以 Tab 選取以查看詳情。",
    );

    const evidenceTile = screen.getByRole("button", {
      name: /咖啡收據.*店內收銀匯出/,
    });
    expect(evidenceTile).toHaveTextContent("咖啡收據");
    expect(evidenceTile).toHaveTextContent("店內收銀匯出");
    expect(evidenceTile).not.toHaveTextContent("十七點四十二分的消費紀錄。");
    expect(evidenceTile).not.toHaveTextContent("付款末四碼 0192。");

    await user.hover(evidenceTile);
    expect(detail).toHaveTextContent("十七點四十二分的消費紀錄。");
    expect(detail).toHaveTextContent("付款末四碼 0192。");

    evidenceTile.focus();
    expect(detail).toHaveTextContent("物證 / EVIDENCE");
    expect(detail).toHaveTextContent("店內收銀匯出");
  });

  it("keeps the focused detail after the pointer leaves another tile", async () => {
    const { container } = render(InterrogationEvidenceTray, props());
    const evidenceTile = screen.getByRole("button", {
      name: /咖啡收據.*店內收銀匯出/,
    });
    const statementTile = screen.getByRole("button", { name: /目擊者/ });
    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ESC" })).toHaveFocus(),
    );
    evidenceTile.focus();
    await waitFor(() => expect(detail).toHaveTextContent("咖啡收據"));
    fireEvent.mouseEnter(statementTile);
    await waitFor(() => expect(detail).toHaveTextContent("目擊者"));
    fireEvent.mouseLeave(statementTile);
    await waitFor(() => expect(detail).toHaveTextContent("咖啡收據"));
  });

  it("keeps evidence and statement detail distinct when their ids collide", async () => {
    const user = userEvent.setup();
    const sharedId = "shared-record";
    const collisionInventory: Inventory = {
      evidence: [
        neutralEvidenceRecordView({
          id: sharedId,
          name: "同名物證",
          description: "物證詳情。",
          details: "物證補充。",
          imageAssetId: null,
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
        }),
      ],
      statements: [
        neutralStatementRecordView({
          id: sharedId,
          speaker: "同名證言",
          content: "證言詳情。",
          onReexamine: null,
          acquiredInChapterId: "chapter_1",
          acquiredInSceneId: "scene_1",
        }),
      ],
    };
    const { container } = render(
      InterrogationEvidenceTray,
      props({ inventory: collisionInventory }),
    );
    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );
    const evidenceTile = screen.getByRole("button", { name: /同名物證/ });
    const statementTile = screen.getByRole("button", { name: /同名證言/ });

    await user.hover(evidenceTile);
    expect(detail).toHaveTextContent("物證詳情。");
    await user.unhover(evidenceTile);
    await user.hover(statementTile);
    expect(detail).toHaveTextContent("證言詳情。");
    expect(detail).not.toHaveTextContent("物證詳情。");
  });

  it("presents the mapped kind and id immediately and exposes the tray Escape button", async () => {
    const user = userEvent.setup();
    const onPresent = vi.fn();
    const onResume = vi.fn();
    render(InterrogationEvidenceTray, props({ onPresent, onResume }));

    await user.click(
      screen.getByRole("button", { name: /咖啡收據.*店內收銀匯出/ }),
    );
    expect(onPresent).toHaveBeenCalledWith("line_1", "evidence", "receipt");

    const escape = screen.getByRole("button", { name: "ESC" });
    expect(escape).toHaveAttribute("data-interrogation-tray-escape");
    await user.click(escape);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("submits the selected evidence and statement against the live testimony line", async () => {
    const user = userEvent.setup();
    const onPresent = vi.fn();
    const { container } = render(
      InterrogationEvidenceTray,
      props({ onPresent }),
    );

    expect(
      container.querySelector("[data-interrogation-present-tray]"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "提出證據" })).toHaveTextContent(
      "她移開視線。我沒去。",
    );
    expect(
      container.querySelector("[data-interrogation-evidence-detail]"),
    ).toHaveTextContent("將游標移至紀錄，或以 Tab 選取以查看詳情。");

    await user.click(screen.getByRole("button", { name: /咖啡收據/ }));
    await user.click(screen.getByRole("button", { name: /目擊者/ }));

    expect(onPresent).toHaveBeenNthCalledWith(
      1,
      "line_1",
      "evidence",
      "receipt",
    );
    expect(onPresent).toHaveBeenNthCalledWith(
      2,
      "line_1",
      "statement",
      "witness",
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

    const escape = screen.getByRole("button", { name: "ESC" });
    const evidence = screen.getByRole("button", { name: /咖啡收據/ });
    const statement = screen.getByRole("button", { name: /目擊者/ });
    const gameMenu = screen.getByRole("button", { name: "遊戲選單" });
    const withdraw = screen.getByRole("button", { name: "收回" });

    await waitFor(() => expect(escape).toHaveFocus());
    await user.tab();
    expect(evidence).toHaveFocus();
    await user.tab();
    expect(statement).toHaveFocus();
    await user.tab();
    expect(gameMenu).toHaveFocus();
    await user.tab();
    expect(withdraw).toHaveFocus();
    await user.tab();
    expect(escape).toHaveFocus();
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

    const evidence = screen.getByRole("button", { name: /咖啡收據/ });
    const escape = screen.getByRole("button", { name: "ESC" });
    const gameMenu = screen.getByRole("button", { name: "遊戲選單" });
    const withdraw = screen.getByRole("button", { name: "收回" });
    expect(evidence).toBeDisabled();
    expect(escape).toBeDisabled();
    expect(gameMenu).toBeDisabled();
    expect(withdraw).toBeDisabled();

    await user.click(evidence);
    await user.click(escape);
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

  it("does not swap a placeholder image again when onerror fires a second time", async () => {
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

    // First error swaps to a placeholder data URI.
    img.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(img).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });

    // A second error on the already-placeholder image must be a no-op:
    // handleEvidenceImageError returns early when image.placeholder is true.
    const srcAfterFirstSwap = img.getAttribute("src");
    img.dispatchEvent(new Event("error"));
    await Promise.resolve();
    expect(img.getAttribute("src")).toBe(srcAfterFirstSwap);
  });

  it("renders the seal fallback when resolveStoryAsset resolves with null", async () => {
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

    const resolveSpy = vi
      .spyOn(storyAssets, "resolveStoryAsset")
      .mockResolvedValue(null);

    try {
      const { container } = render(
        InterrogationEvidenceTray,
        props({ inventory: inventoryWithImage }),
      );

      // When resolveStoryAsset resolves with null, the $effect's
      // `if (!cancelled && asset)` guard skips setting evidenceImages, so
      // the seal fallback renders instead of an <img>.
      await waitFor(() => {
        expect(container.querySelector(".evidence-card img")).toBeNull();
        expect(
          container.querySelector(".evidence-card .record-seal"),
        ).not.toBeNull();
      });
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it("wraps shift+Tab from the first control to the last", async () => {
    const user = userEvent.setup();
    render(InterrogationEvidenceTray, props());

    const escape = screen.getByRole("button", { name: "ESC" });
    const withdraw = screen.getByRole("button", { name: "收回" });

    await waitFor(() => expect(escape).toHaveFocus());
    await user.tab({ shift: true });
    expect(withdraw).toHaveFocus();
  });

  it("focuses the first or last control when Tab arrives from outside the tray", async () => {
    render(InterrogationEvidenceTray, props());

    const escape = screen.getByRole("button", { name: "ESC" });
    const withdraw = screen.getByRole("button", { name: "收回" });

    // Focus is on <body>, outside the tray's controls (activeIndex < 0).
    expect(document.activeElement).toBe(document.body);

    // Forward Tab from outside lands on the first control.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    await waitFor(() => expect(escape).toHaveFocus());

    // Shift+Tab from outside wraps to the last control.
    document.body.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );
    await waitFor(() => expect(withdraw).toHaveFocus());
  });

  it("focuses the tray itself when Tab arrives and all controls are disabled", async () => {
    render(InterrogationEvidenceTray, props({ disabled: true }));

    // All buttons are disabled, so controls.length === 0. The Tab handler
    // must focus the tray container rather than crashing or doing nothing.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    await waitFor(() => {
      const tray = screen.getByRole("dialog", { name: "提出證據" });
      expect(tray).toHaveFocus();
    });
  });

  it("ignores non-Tab keys in the focus trap handler", async () => {
    render(InterrogationEvidenceTray, props());

    const escape = screen.getByRole("button", { name: "ESC" });
    await waitFor(() => expect(escape).toHaveFocus());

    // A non-Tab key must not be intercepted by the Tab trap handler.
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    const dispatched = window.dispatchEvent(event);
    expect(dispatched).toBe(true);
    expect(escape).toHaveFocus();
  });

  it("suspends the Tab trap while an upper layer is open", async () => {
    // When the Game Menu / Save Browser opens above the tray, the tray stays
    // mounted but must not intercept Tab — the upper dialog owns keyboard
    // navigation. A window-dispatched Tab must pass through (not cancelled)
    // rather than being swallowed by preventDefault + stopImmediatePropagation.
    const { rerender } = render(InterrogationEvidenceTray, props());

    const escape = screen.getByRole("button", { name: "ESC" });
    await waitFor(() => expect(escape).toHaveFocus());

    // While suspended, Tab is not cancelled and focus is not moved by the
    // trap.
    await rerender(props({ topLayerOpen: true }));
    const suspendedEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    expect(window.dispatchEvent(suspendedEvent)).toBe(true);
    expect(suspendedEvent.defaultPrevented).toBe(false);
    expect(escape).toHaveFocus();

    // Once the upper layer closes, the trap resumes: Tab is cancelled
    // (preventDefault) so the browser's native Tab navigation is overridden
    // by the trap's focus cycling.
    await rerender(props({ topLayerOpen: false }));
    const resumedEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(resumedEvent);
    expect(resumedEvent.defaultPrevented).toBe(true);
  });

  it("falls back to the stage fallback when the return-focus target was disconnected before unmount", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "evidence hud";
    document.body.append(trigger);
    const fallback = document.createElement("div");
    fallback.tabIndex = -1;
    document.body.append(fallback);

    const result = render(
      InterrogationEvidenceTray,
      props({ returnFocusTo: trigger, fallbackFocusTarget: fallback }),
    );

    try {
      // Detach the trigger while the tray is still mounted. On unmount, the
      // `target.isConnected` guard is false, so focus must fall through to
      // the connected fallback.
      trigger.remove();
      result.unmount();
      await waitFor(() => expect(fallback).toHaveFocus());
    } finally {
      fallback.remove();
    }
  });

  it("does not focus anything when both return-focus target and fallback are disconnected on unmount", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "evidence hud";
    document.body.append(trigger);
    const fallback = document.createElement("div");
    fallback.tabIndex = -1;
    document.body.append(fallback);

    const focusSpy = vi.spyOn(fallback, "focus");

    const result = render(
      InterrogationEvidenceTray,
      props({ returnFocusTo: trigger, fallbackFocusTarget: fallback }),
    );

    try {
      trigger.remove();
      fallback.remove();
      result.unmount();
      // Give the tick().then() callback a chance to run.
      await waitFor(() => {
        expect(focusSpy).not.toHaveBeenCalled();
      });
    } finally {
      focusSpy.mockRestore();
    }
  });
});
