import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameStateView, SceneNavigationIndex } from "$lib/state/types";
import { gameState } from "$lib/state/game-client.svelte";
import {
  STORY_CLEARED_STORAGE_KEY,
  __resetStoryClearanceWarningLatches,
} from "$lib/state/story-clearance";
import Page from "./+page.svelte";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  fetch: vi.fn(),
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

function gameCompleteState(): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      summary: "案件摘要",
      index: 0,
      total: 3,
    },
    scene: { kind: "linear", id: "scene_1", title: "序章", index: 0, total: 1 },
    mode: { type: "gameComplete" },
    inventory: { evidence: [], statements: [] },
  };
}

function jumpedState(): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      summary: "案件摘要",
      index: 0,
      total: 3,
    },
    scene: {
      kind: "linear",
      id: "scene_2",
      title: "第二場景",
      index: 1,
      total: 2,
    },
    mode: {
      type: "dialogue",
      current: { kind: "action", text: "幕開" },
      queueRemaining: 0,
      sceneTag: null,
      queueToken: { sceneId: "scene_2", queueGen: 1, cursor: 0 },
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
  };
}

const sceneNavigationIndex: SceneNavigationIndex = {
  chapters: [
    {
      id: "chapter_1",
      title: "第一章",
      index: 0,
      scenes: [{ id: "scene_2", title: "第二場景", type: "linear", index: 1 }],
    },
  ],
};

// `httpInvoke` (the non-Tauri dev fallback used in tests, since
// `__TAURI_INTERNALS__` is absent) POSTs to `${DEV_HTTP_BASE}/${command}` and
// reads `r.text()`. Shape a minimal Response so the fallback resolves.
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function stubFetchForSceneNavigation() {
  mocks.fetch.mockImplementation(async (url: string) => {
    const path = String(url).replace("http://127.0.0.1:1421/", "");
    if (path === "list_scenes") return jsonResponse(sceneNavigationIndex);
    if (path === "jump_to_scene") return jsonResponse(jumpedState());
    return jsonResponse({});
  });
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
    // "Close case" must return to the main menu, never invoke reset_game
    // under any argument shape. Assert against the raw call list so a
    // regression (missing/different second arg) is still caught —
    // `not.toHaveBeenCalledWith("reset_game", undefined)` would pass even if
    // reset_game were called with other args.
    expect(
      mocks.invoke.mock.calls.every((call) => call[0] !== "reset_game"),
    ).toBe(true);
  });
});

describe("+page story clearance on game complete", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    stubFetchForSceneNavigation();
    vi.stubGlobal("fetch", mocks.fetch);
    __resetStoryClearanceWarningLatches();
    window.localStorage.clear();
    gameState.value = gameCompleteState();
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
    window.localStorage.clear();
    __resetStoryClearanceWarningLatches();
  });

  it("persists the cleared-once flag to localStorage when gameComplete is observed", async () => {
    // The page's $effect watches gameState.value.mode.type === "gameComplete"
    // and calls saveStoryClearedOnce() the first time it observes that mode.
    // This is a behavioral test (not a source-string pin): it renders the real
    // page, lets the effect run, and asserts the flag is actually persisted.
    expect(window.localStorage.getItem(STORY_CLEARED_STORAGE_KEY)).toBeNull();

    render(Page);

    await waitFor(() => {
      expect(window.localStorage.getItem(STORY_CLEARED_STORAGE_KEY)).toBe(
        "true",
      );
    });
  });
});

describe("+page scene jump closes the escape menu", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    stubFetchForSceneNavigation();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.currentWindow.isFullscreen.mockResolvedValue(false);
    seedGameState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
  });

  it("closes the escape menu after a successful scene selection", async () => {
    // Behavioral test (not a source-string pin): opens the real Escape menu,
    // enters the Scene Select submenu, clicks a scene, and asserts the menu
    // dialog disappears once jumpToScene resolves. The scene index is served
    // through the dev HTTP fetch fallback (isTauri is false in this test file).
    const user = userEvent.setup();
    render(Page);

    // Open the Escape menu.
    await user.keyboard("{Escape}");
    const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });

    // Enter the Scene Select submenu.
    await user.click(within(dialog).getByRole("button", { name: /場景跳轉/ }));

    // The panel auto-expands the current chapter (chapter_1) and lists
    // scene_2. Wait for the index to load and the scene button to appear.
    const sceneButton = await screen.findByRole("button", {
      name: /第二場景/,
    });
    await user.click(sceneButton);

    // The menu must close once the jump resolves (success path), revealing
    // the jumped scene instead of trapping it behind the modal scrim.
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "遊戲選單" }),
      ).not.toBeInTheDocument();
    });
    expect(gameState.value?.scene.id).toBe("scene_2");
  });
});

describe("+page scene navigation retries after return to title", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.currentWindow.isFullscreen.mockResolvedValue(false);
    seedGameState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
  });

  it("re-attempts the index load on a fresh game after a prior failure", async () => {
    // Regression guard: a failed scene-index load sets latches
    // (sceneNavigationError / sceneNavigationRequested) that suppress the
    // auto-load $effect. Closing the case (the real return-to-title path)
    // must clear those latches so a subsequent game session re-attempts the
    // load instead of inheriting the stale failure. Asserted by counting
    // list_scenes fetch calls across the session boundary.
    let listScenesCallCount = 0;
    mocks.fetch.mockImplementation(async (url: string) => {
      const path = String(url).replace("http://127.0.0.1:1421/", "");
      if (path === "list_scenes") {
        listScenesCallCount += 1;
        if (listScenesCallCount === 1) {
          return {
            ok: false,
            status: 500,
            text: () => Promise.resolve("index unavailable"),
          } as unknown as Response;
        }
        return jsonResponse(sceneNavigationIndex);
      }
      return jsonResponse({});
    });

    const user = userEvent.setup();
    render(Page);

    // First load fires and fails.
    await waitFor(() => {
      expect(listScenesCallCount).toBe(1);
    });

    // Close the case through the real UI path — handleCloseCase resets the
    // scene-nav latches synchronously before returning to the title.
    await user.keyboard("{Escape}");
    const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(within(dialog).getByRole("button", { name: /結束案件/ }));
    await waitFor(() => {
      expect(screen.getByRole("main", { name: "主選單" })).toBeInTheDocument();
    });

    // Start a fresh game. Without the latch reset, the stale
    // error/requested latches would keep the load $effect from re-firing.
    seedGameState();

    await waitFor(() => {
      expect(listScenesCallCount).toBe(2);
    });
  });
});

describe("+page scene navigation eligibility gate (production)", () => {
  // sceneNavigationEnabled = `import.meta.env.DEV || storyClearedOnce`.
  // Vitest defaults import.meta.env.DEV to true, so the production branch
  // (DEV=false, gated on cleared-once) is never exercised by the rest of the
  // suite. These tests flip DEV=false so a regression that dropped or
  // inverted the cleared-once gate fails here instead of slipping through.
  beforeEach(() => {
    mocks.fetch.mockReset();
    stubFetchForSceneNavigation();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.currentWindow.isFullscreen.mockResolvedValue(false);
    __resetStoryClearanceWarningLatches();
    window.localStorage.clear();
    seedGameState();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    cleanup();
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
    window.localStorage.clear();
    __resetStoryClearanceWarningLatches();
  });

  it("hides the scene-select entry when DEV=false and the story is not cleared", async () => {
    vi.stubEnv("DEV", false);
    const user = userEvent.setup();
    render(Page);

    await user.keyboard("{Escape}");
    const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });

    expect(
      within(dialog).queryByRole("button", { name: /場景跳轉/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the scene-select entry when DEV=false but the story has been cleared", async () => {
    vi.stubEnv("DEV", false);
    window.localStorage.setItem(STORY_CLEARED_STORAGE_KEY, "true");

    const user = userEvent.setup();
    render(Page);

    await user.keyboard("{Escape}");
    const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });

    expect(
      await within(dialog).findByRole("button", { name: /場景跳轉/ }),
    ).toBeInTheDocument();
  });
});
