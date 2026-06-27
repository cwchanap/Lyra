import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameStateView } from "$lib/state/types";

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

  it("renders the AudioSettings panel bound to runtime preferences", () => {
    render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

    expect(
      screen.getByRole("region", { name: "音訊設定" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("BGM")).toBeInTheDocument();
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

  it("invokes onReset when the close-case button is clicked", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(GameShellHarness, { gameState: state(), onReset });

    await user.click(screen.getByRole("button", { name: /結束/ }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("opens the game menu and consumes Escape during investigation exploration", async () => {
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
  });

  it("reasserts Tauri fullscreen when Escape opens the game menu from fullscreen", async () => {
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
  });
});
