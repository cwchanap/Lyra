import { cleanup, render, screen, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameStateView } from "$lib/state/types";
import { gameState } from "$lib/state/game-client.svelte";
import Page from "./+page.svelte";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  audioPreferences: {
    muted: false,
    bgmVolume: 0.5,
    bgsVolume: 0.5,
    sfxVolume: 0.5,
  },
  updateAudioPreferences: vi.fn(),
  playGameplaySfxEvent: vi.fn(),
  syncGameplayAudioMode: vi.fn(),
  preloadKnownGameplaySfx: vi.fn(),
  retryLockedGameplayAudio: vi.fn(),
  disposeGameplayAudio: vi.fn(),
  currentWindow: {
    close: vi.fn(),
    isFullscreen: vi.fn(),
    setFullscreen: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mocks.currentWindow,
}));

vi.mock("$lib/audio/gameplay-audio-runtime.svelte", () => ({
  audioPreferences: mocks.audioPreferences,
  updateAudioPreferences: mocks.updateAudioPreferences,
  playGameplaySfxEvent: mocks.playGameplaySfxEvent,
  syncGameplayAudioMode: mocks.syncGameplayAudioMode,
  preloadKnownGameplaySfx: mocks.preloadKnownGameplaySfx,
  retryLockedGameplayAudio: mocks.retryLockedGameplayAudio,
  disposeGameplayAudio: mocks.disposeGameplayAudio,
}));

function currentState(): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      summary: "案件摘要",
      index: 0,
      total: 3,
    },
    scene: { kind: "linear", id: "scene_1", title: "序章", index: 0, total: 1 },
    mode: {
      type: "dialogue",
      current: { kind: "action", text: "幕開" },
      queueRemaining: 0,
      sceneTag: null,
      queueToken: { sceneId: "scene_1", queueGen: 1, cursor: 0 },
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
  };
}

function seedGameState() {
  gameState.value = currentState();
  gameState.error = null;
  gameState.loading = false;
  gameState.inFlight = false;
}

describe("+page close case flow", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.updateAudioPreferences.mockReset();
    mocks.playGameplaySfxEvent.mockReset();
    mocks.syncGameplayAudioMode.mockReset();
    mocks.preloadKnownGameplaySfx.mockReset();
    mocks.retryLockedGameplayAudio.mockReset();
    mocks.disposeGameplayAudio.mockReset();
    mocks.currentWindow.close.mockReset();
    mocks.currentWindow.isFullscreen.mockReset();
    mocks.currentWindow.setFullscreen.mockReset();
    mocks.currentWindow.isFullscreen.mockResolvedValue(false);
    seedGameState();
  });

  afterEach(() => {
    cleanup();
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
  });

  it("returns to the start screen instead of resetting to chapter one", async () => {
    const user = userEvent.setup();
    render(Page);

    expect(
      screen.queryByRole("main", { name: "主選單" }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(within(dialog).getByRole("button", { name: /結束案件/ }));

    expect(
      await screen.findByRole("main", { name: "主選單" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "遊戲選單" }),
    ).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("reset_game", undefined);
  });
});
