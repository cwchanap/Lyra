import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameStateView } from "$lib/state/types";
import { reportAsyncTestFailure } from "$lib/test-utils";

const mocks = vi.hoisted(() => ({
  audioPreferences: {
    muted: false,
    bgmVolume: 0.5,
    bgsVolume: 0.5,
    sfxVolume: 0.5,
  },
  updateAudioPreferences: vi.fn(),
  currentWindow: {
    isFullscreen: vi.fn(),
    setFullscreen: vi.fn(),
  },
}));

vi.mock("$lib/audio/gameplay-audio-runtime.svelte", () => ({
  audioPreferences: mocks.audioPreferences,
  updateAudioPreferences: mocks.updateAudioPreferences,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mocks.currentWindow,
}));

import GameShellHarness from "./GameShellHarness.svelte";

function state(
  mode: GameStateView["mode"] = {
    type: "dialogue",
    current: { kind: "action", text: "幕開" },
    queueRemaining: 0,
    sceneTag: null,
    queueToken: { sceneId: "scene_1", queueGen: 1, cursor: 0 },
    backgroundAssetId: null,
    bgm: null,
    bgs: null,
  },
): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      summary: "案件摘要",
      index: 0,
      total: 3,
    },
    scene: { kind: "linear", id: "scene_1", title: "", index: 0, total: 1 },
    mode,
    inventory: { evidence: [], statements: [] },
  };
}

describe("GameShell", () => {
  afterEach(() => {
    cleanup();
    mocks.updateAudioPreferences.mockClear();
    mocks.currentWindow.isFullscreen.mockReset();
    mocks.currentWindow.setFullscreen.mockReset();
  });

  it("renders the chapter header and scoped children", () => {
    render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

    expect(screen.getByText("雨夜的第一份證詞")).toBeInTheDocument();
    expect(screen.getByText("案件摘要")).toBeInTheDocument();
    expect(screen.getByText("FILE", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("scoped child")).toBeInTheDocument();
  });

  it("keeps duplicated utility controls out of the chapter HUD", () => {
    render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

    expect(screen.getByText("雨夜的第一份證詞")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "音訊設定" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /結束/ }),
    ).not.toBeInTheDocument();
  });

  it("hides chapter chrome during investigation exploration", () => {
    render(GameShellHarness, {
      gameState: state({
        type: "explore",
        sublocationId: "main",
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      }),
      onReset: vi.fn(),
    });

    expect(screen.queryByText("雨夜的第一份證詞")).not.toBeInTheDocument();
    expect(screen.queryByText("案件摘要")).not.toBeInTheDocument();
    expect(
      screen.queryByText("FILE", { exact: false }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "音訊設定" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("scoped child")).toBeInTheDocument();
  });

  it("renders close-case and audio controls inside the game menu", async () => {
    const testName =
      "renders close-case and audio controls inside the game menu";

    try {
      const user = userEvent.setup();
      const onReset = vi.fn();
      render(GameShellHarness, { gameState: state(), onReset });

      await user.keyboard("{Escape}");
      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });

      expect(
        screen.getByRole("region", { name: "音訊設定" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("BGM")).toBeInTheDocument();

      await user.click(
        within(dialog).getByRole("button", { name: /結束案件/ }),
      );

      expect(onReset).toHaveBeenCalledTimes(1);
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("opens the game menu and consumes Escape during investigation exploration", async () => {
    const testName =
      "opens the game menu and consumes Escape during investigation exploration";

    try {
      const onReset = vi.fn();
      render(GameShellHarness, {
        gameState: state({
          type: "explore",
          sublocationId: "main",
          backgroundAssetId: null,
          bgm: null,
          bgs: null,
        }),
        onReset,
      });

      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });

      const propagated = window.dispatchEvent(escape);

      expect(propagated).toBe(false);
      expect(escape.defaultPrevented).toBe(true);
      expect(
        await screen.findByRole("dialog", { name: "遊戲選單" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /繼續調查/ })).toBeVisible();
      expect(onReset).not.toHaveBeenCalled();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("traps focus inside the game menu and restores focus on close", async () => {
    const testName =
      "traps focus inside the game menu and restores focus on close";

    try {
      document.body.tabIndex = -1;
      document.body.focus();

      render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );

      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
      const resume = within(dialog).getByRole("button", {
        name: /繼續調查/,
      });
      const sfx = screen.getByLabelText("SFX");

      expect(resume).toHaveFocus();

      await fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
      expect(sfx).toHaveFocus();

      await fireEvent.keyDown(dialog, { key: "Tab" });
      expect(resume).toHaveFocus();

      await fireEvent.click(resume);
      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });
      expect(document.body).toHaveFocus();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    } finally {
      document.body.removeAttribute("tabindex");
    }
  });

  it("skips focus restoration when the source element was removed while the menu was open", async () => {
    const testName =
      "skips focus restoration when the source element was removed while the menu was open";

    // Exercises the `isConnected` guard in closeGameMenu(): if the element that
    // was focused when the menu opened is detached before close, the guard must
    // skip calling focus() on a detached node rather than leaving focus in an
    // inconsistent state.
    let trigger: HTMLButtonElement | null = null;
    try {
      render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

      trigger = document.createElement("button");
      trigger.textContent = "outside trigger";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      // Spy on focus() so we can assert the guard does NOT invoke it once the
      // node is detached. (jsdom exposes `focus` as a getter-only property, so
      // direct assignment throws; vi.spyOn redefines it as configurable.)
      const focusSpy = vi.spyOn(trigger, "focus");

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await screen.findByRole("dialog", { name: "遊戲選單" });

      // Detach the source element while the menu is open.
      document.body.removeChild(trigger);
      expect(trigger.isConnected).toBe(false);

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });

      // The guard skipped focus(); restoring it would call the spy and fail
      // this assertion.
      expect(focusSpy).not.toHaveBeenCalled();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    } finally {
      if (trigger?.isConnected) {
        document.body.removeChild(trigger);
      }
    }
  });

  it("renders menu slot content only inside the Escape menu", async () => {
    const testName = "renders menu slot content only inside the Escape menu";

    try {
      render(GameShellHarness, {
        gameState: state(),
        onReset: vi.fn(),
        menuContent: "menu inventory slot",
      });

      expect(screen.queryByText("menu inventory slot")).not.toBeInTheDocument();

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );

      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
      expect(
        within(dialog).getByText("menu inventory slot"),
      ).toBeInTheDocument();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("reasserts Tauri fullscreen when Escape opens the game menu from fullscreen", async () => {
    const testName =
      "reasserts Tauri fullscreen when Escape opens the game menu from fullscreen";

    try {
      mocks.currentWindow.isFullscreen.mockResolvedValue(true);
      mocks.currentWindow.setFullscreen.mockResolvedValue(undefined);
      render(GameShellHarness, {
        gameState: state({
          type: "explore",
          sublocationId: "main",
          backgroundAssetId: null,
          bgm: null,
          bgs: null,
        }),
        onReset: vi.fn(),
      });

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(() => {
        expect(mocks.currentWindow.setFullscreen).toHaveBeenCalledWith(true);
      });
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });
});
