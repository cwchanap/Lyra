import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import type {
  GameStateView,
  PendingAcquisitionView,
  SceneNavigationIndex,
} from "$lib/state/types";
import type {
  SaveBrowserOpenResultView,
  SaveSlotStatusView,
} from "$lib/persistence/types";
import {
  advanceDialogue,
  gameState,
  presentationState,
} from "$lib/state/game-client.svelte";
import { acquisitionController } from "$lib/state/acquisition-controller.svelte";
import { persistenceStore } from "$lib/persistence/persistence-store.svelte";
import {
  STORY_CLEARED_STORAGE_KEY,
  __resetStoryClearanceWarningLatches,
} from "$lib/state/story-clearance";
import Page from "./+page.svelte";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  fetch: vi.fn(),
  saveNameSummary: vi.fn(),
  saveConfirmationSummary: vi.fn(),
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

vi.mock("$lib/components/SaveNameDialog.svelte", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("$lib/components/SaveNameDialog.svelte")
    >();
  const Actual = actual.default as unknown as (
    anchor: Node,
    props: Record<string, unknown>,
  ) => unknown;
  return {
    ...actual,
    default: (anchor: Node, props: Record<string, unknown>) => {
      mocks.saveNameSummary(props.currentSummary);
      return Actual(anchor, props);
    },
  };
});

vi.mock(
  "$lib/components/SaveConfirmationDialog.svelte",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("$lib/components/SaveConfirmationDialog.svelte")
      >();
    const Actual = actual.default as unknown as (
      anchor: Node,
      props: Record<string, unknown>,
    ) => unknown;
    return {
      ...actual,
      default: (anchor: Node, props: Record<string, unknown>) => {
        if (props.kind === "overwrite") {
          mocks.saveConfirmationSummary(props.currentSummary);
        }
        return Actual(anchor, props);
      },
    };
  },
);

beforeEach(() => {
  acquisitionController.clear();
});

afterEach(() => {
  acquisitionController.clear();
});

function currentState(): GameStateView {
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
      id: "scene_1",
      title: "序章",
      summary: "",
      index: 0,
      total: 1,
    },
    mode: {
      type: "dialogue",
      crossExamLineId: null,
      current: { kind: "action", text: "幕開" },
      queueRemaining: 0,
      sceneTag: null,
      queueToken: { sceneId: "scene_1", queueGen: 1, cursor: 0 },
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
    story: { facts: [], questions: [], objectives: [], authorizations: [] },
    dialogueHistory: [],
    pendingAcquisition: null,
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
    scene: {
      kind: "linear",
      id: "scene_1",
      title: "序章",
      summary: "",
      index: 0,
      total: 1,
    },
    mode: { type: "gameComplete" },
    inventory: { evidence: [], statements: [] },
    story: { facts: [], questions: [], objectives: [], authorizations: [] },
    dialogueHistory: [],
    pendingAcquisition: null,
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
      summary: "",
      index: 1,
      total: 2,
    },
    mode: {
      type: "dialogue",
      crossExamLineId: null,
      current: { kind: "action", text: "幕開" },
      queueRemaining: 0,
      sceneTag: null,
      queueToken: { sceneId: "scene_2", queueGen: 1, cursor: 0 },
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
    story: { facts: [], questions: [], objectives: [], authorizations: [] },
    dialogueHistory: [],
    pendingAcquisition: null,
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

const acquiredEvidence: PendingAcquisitionView = {
  id: "event-evidence",
  recordKind: "evidence",
  recordId: "receipt",
  title: "咖啡收據",
  description: "收據上的時間被圈起。",
  details: "",
  imageAssetId: null,
  createdByCommandId: 7,
  ordinal: 0,
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

function jsonError(body: unknown): Response {
  return {
    ok: false,
    status: 500,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function titleDiscovery(
  firstStatus: SaveSlotStatusView = { type: "empty" },
): SaveBrowserOpenResultView {
  return {
    browser: {
      discovery: { type: "available" },
      slots: Array.from({ length: 8 }, (_, index) => ({
        reference:
          index < 5
            ? ({ type: "auto", slot: index + 1 } as const)
            : ({ type: "manual", slot: index - 4 } as const),
        modifiedAt: index === 0 ? "2026-07-27T12:00:00Z" : null,
        status: index === 0 ? firstStatus : ({ type: "empty" } as const),
      })),
    },
    continueCandidate:
      firstStatus.type === "empty" ? null : { type: "auto", slot: 1 },
    preflight: { type: "ready" },
  };
}

function validSlotStatus(saveId: string): SaveSlotStatusView {
  return {
    type: "valid",
    metadata: {
      saveId,
      saveType: "manual",
      schemaVersion: 2,
      contentRevision: "revision",
      savedAt: "2026-07-27T12:00:00Z",
      displayName: "新的存檔",
      thumbnail: { type: "unavailable", reason: "missing" },
      summary: {
        chapterId: "chapter_1",
        chapterTitle: "雨夜的第一份證詞",
        chapterSummary: null,
        sceneId: "scene_1",
        sceneTitle: "序章",
        sceneSummary: null,
        activePrimaryObjectiveId: null,
        activePrimaryObjectiveLabel: null,
        activePrimaryObjectiveSummary: null,
      },
    },
  };
}

function stubFetchForSceneNavigation() {
  mocks.fetch.mockImplementation(async (url: string) => {
    const path = String(url).replace("http://127.0.0.1:1421/", "");
    if (path === "list_scenes") return jsonResponse(sceneNavigationIndex);
    if (path === "jump_to_scene") {
      return jsonResponse({
        state: jumpedState(),
        thumbnailCapture: null,
      });
    }
    return jsonResponse({});
  });
}

function stubAcquisitionAcknowledgement() {
  mocks.fetch.mockImplementation(async (url: string) => {
    const path = String(url).replace("http://127.0.0.1:1421/", "");
    if (path === "acknowledge_acquisition_event") {
      return jsonResponse({
        state: currentState(),
        thumbnailCapture: null,
      });
    }
    return jsonResponse({});
  });
}

describe("+page title persistence flows", () => {
  let canvasGetContextSpy: MockInstance<
    typeof HTMLCanvasElement.prototype.getContext
  >;

  beforeEach(() => {
    canvasGetContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    canvasGetContextSpy.mockRestore();
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
  });

  it("discovers saves on title and disables Continue and Load for eight empty slots", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(titleDiscovery());
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      return jsonResponse({});
    });

    render(Page);

    expect(screen.getByRole("status")).toHaveTextContent("讀取存檔中…");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "繼續遊戲" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "載入遊戲" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "開始新遊戲" })).toBeEnabled();
    });
    expect(
      mocks.fetch.mock.calls.some(([url]) =>
        String(url).endsWith("/list_saves"),
      ),
    ).toBe(true);
  });

  it("requires a second confirmation and preserves the exact token before starting without persistence", async () => {
    const user = userEvent.setup();
    const unavailable: SaveBrowserOpenResultView = {
      browser: {
        discovery: {
          type: "unavailable",
          diagnostic: {
            code: "saveDiscoveryUnavailable",
            message: "無法建立存檔目錄",
          },
        },
        slots: [],
      },
      continueCandidate: null,
      preflight: { type: "ready" },
    };
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(unavailable);
      if (command === "get_persistence_status") {
        return jsonResponse({
          type: "degraded",
          diagnostic:
            unavailable.browser.discovery.type === "unavailable"
              ? unavailable.browser.discovery.diagnostic
              : null,
        });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      if (command === "start_game") {
        return jsonError({
          code: "persistenceUnavailable",
          message: "無法儲存新遊戲",
          failureToken: "new-game-token",
        });
      }
      if (command === "start_game_without_saving") {
        expect(JSON.parse(String(init?.body))).toEqual({
          failureToken: "new-game-token",
        });
        return jsonResponse({
          state: currentState(),
          thumbnailCapture: null,
        });
      }
      return jsonResponse({});
    });

    render(Page);
    const newGame = await screen.findByRole("button", {
      name: "開始新遊戲",
    });
    await user.click(newGame);

    const firstWarning = await screen.findByRole("dialog", {
      name: "無法儲存新遊戲",
    });
    expect(
      within(firstWarning).getByRole("button", { name: "不儲存並開始遊戲" }),
    ).toBeInTheDocument();
    expect(gameState.value).toBeNull();

    await user.click(
      within(firstWarning).getByRole("button", {
        name: "不儲存並開始遊戲",
      }),
    );
    const confirmation = await screen.findByRole("dialog", {
      name: "確認不儲存並開始遊戲",
    });
    await user.click(
      within(confirmation).getByRole("button", {
        name: "不儲存並開始遊戲",
      }),
    );

    await waitFor(() => expect(gameState.value).not.toBeNull());
  });

  it("cancels a new-game challenge before dismissing it and remains blocking when cancellation fails", async () => {
    const user = userEvent.setup();
    const cancelBodies: Record<string, unknown>[] = [];
    let cancelAttempts = 0;
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(titleDiscovery());
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      if (command === "start_game") {
        return jsonError({
          code: "saveWriteFailed",
          message: "無法儲存新遊戲",
          failureToken: "new-game-cancel-token",
        });
      }
      if (command === "cancel_persistence_failure") {
        cancelBodies.push(JSON.parse(String(init?.body)));
        cancelAttempts += 1;
        return cancelAttempts === 1
          ? jsonError({
              code: "persistenceUnavailable",
              message: "暫時無法取消",
            })
          : jsonResponse(null);
      }
      return jsonResponse({});
    });

    render(Page);
    await user.click(await screen.findByRole("button", { name: "開始新遊戲" }));
    let failure = await screen.findByRole("dialog", {
      name: "無法儲存新遊戲",
    });
    await user.click(within(failure).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(cancelBodies).toHaveLength(1));
    failure = screen.getByRole("dialog", { name: "無法儲存新遊戲" });
    expect(within(failure).getByRole("alert")).toHaveTextContent(
      "暫時無法取消",
    );

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(cancelBodies).toHaveLength(2);
      expect(
        screen.queryByRole("dialog", { name: "無法儲存新遊戲" }),
      ).not.toBeInTheDocument();
    });
    expect(cancelBodies).toEqual([
      { failureToken: "new-game-cancel-token" },
      { failureToken: "new-game-cancel-token" },
    ]);
  });

  it("does not carry a failed New Game cancellation alert into a later Return recovery", async () => {
    const user = userEvent.setup();
    let startAttempts = 0;
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(titleDiscovery());
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      if (command === "start_game") {
        startAttempts += 1;
        return startAttempts === 1
          ? jsonError({
              code: "saveWriteFailed",
              message: "無法儲存新遊戲",
              failureToken: "new-alert-token",
            })
          : jsonResponse({
              state: currentState(),
              thumbnailCapture: null,
            });
      }
      if (command === "cancel_persistence_failure") {
        return jsonError({
          code: "persistenceUnavailable",
          message: "這是上一個取消錯誤",
        });
      }
      if (command === "return_to_title") {
        return jsonError({
          code: "saveWriteFailed",
          message: "返回標題前無法儲存",
          failureToken: "return-alert-token",
        });
      }
      return jsonResponse({});
    });

    render(Page);
    await user.click(await screen.findByRole("button", { name: "開始新遊戲" }));
    let failure = await screen.findByRole("dialog", {
      name: "無法儲存新遊戲",
    });
    await user.click(within(failure).getByRole("button", { name: "取消" }));
    expect(await within(failure).findByRole("alert")).toHaveTextContent(
      "這是上一個取消錯誤",
    );
    await user.click(within(failure).getByRole("button", { name: "重試" }));
    await waitFor(() => expect(gameState.value).not.toBeNull());

    await user.keyboard("{Escape}");
    const menu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(menu).getByRole("button", { name: "返回標題畫面" }),
    );
    failure = await screen.findByRole("dialog", {
      name: "無法返回標題畫面",
    });

    expect(within(failure).queryByRole("alert")).not.toBeInTheDocument();
    expect(failure).toHaveTextContent("返回標題前無法儲存");
  });

  it("refreshes after a failed Continue and opens Load at Rust's new candidate", async () => {
    const user = userEvent.setup();
    const invalid = titleDiscovery({
      type: "invalid",
      metadata: null,
      diagnostic: { code: "saveCorrupt", message: "最新存檔已損毀" },
    });
    const refreshed = titleDiscovery();
    refreshed.browser.slots[6] = {
      reference: { type: "manual", slot: 2 },
      modifiedAt: "2026-07-27T13:00:00Z",
      status: validSlotStatus("new-save"),
    };
    refreshed.continueCandidate = { type: "manual", slot: 2 };
    let listCalls = 0;
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") {
        listCalls += 1;
        return jsonResponse(listCalls === 1 ? invalid : refreshed);
      }
      if (command === "continue_game") {
        return jsonError({
          code: "saveCorrupt",
          message: "最新存檔已損毀",
        });
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      return jsonResponse({});
    });

    render(Page);
    const continueButton = await screen.findByRole("button", {
      name: "繼續遊戲",
    });
    await waitFor(() => expect(continueButton).toBeEnabled());
    await user.click(continueButton);

    const diagnostic = await screen.findByRole("dialog", {
      name: "無法繼續遊戲",
    });
    expect(diagnostic).toHaveTextContent("最新存檔已損毀");
    await user.click(
      within(diagnostic).getByRole("button", { name: "載入遊戲" }),
    );

    const browser = await screen.findByRole("region", {
      name: "存檔瀏覽器",
    });
    expect(listCalls).toBe(2);
    const current = browser.querySelector(
      '[data-slot-type="manual"][data-slot-number="2"]',
    );
    expect(current).toHaveTextContent("最新");
    expect(current).toHaveClass("selected");
  });

  it("loads a valid title slot directly with its observed save ID", async () => {
    const user = userEvent.setup();
    const discovery = titleDiscovery(validSlotStatus("title-load-id"));
    let loadArgs: Record<string, unknown> | null = null;
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(discovery);
      if (command === "load_save") {
        loadArgs = JSON.parse(String(init?.body));
        return jsonResponse({
          state: jumpedState(),
          thumbnailCapture: null,
        });
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") {
        return jsonResponse({ type: "idle" });
      }
      return jsonResponse({});
    });

    render(Page);
    await user.click(await screen.findByRole("button", { name: "載入遊戲" }));
    const browser = await screen.findByRole("region", {
      name: "存檔瀏覽器",
    });
    const autoOne = browser.querySelector(
      '[data-slot-type="auto"][data-slot-number="1"]',
    )!;
    await user.click(
      within(autoOne as HTMLElement).getByRole("button", {
        name: "載入自動存檔 1",
      }),
    );

    await waitFor(() => expect(loadArgs).not.toBeNull());
    expect(loadArgs).toEqual({
      reference: { type: "auto", slot: 1 },
      observedSaveId: "title-load-id",
    });
    expect(gameState.value?.scene.id).toBe("scene_2");
    expect(screen.queryByRole("region", { name: "存檔瀏覽器" })).toBeNull();
  });

  it("single-flights a double title Load before the first IPC settles", async () => {
    const user = userEvent.setup();
    const discovery = titleDiscovery(validSlotStatus("title-load-id"));
    let resolveLoad!: (response: Response) => void;
    const delayedLoad = new Promise<Response>((resolve) => {
      resolveLoad = resolve;
    });
    let loadCalls = 0;
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(discovery);
      if (command === "load_save") {
        loadCalls += 1;
        return delayedLoad;
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") {
        return jsonResponse({ type: "idle" });
      }
      return jsonResponse({});
    });

    render(Page);
    await user.click(await screen.findByRole("button", { name: "載入遊戲" }));
    const browser = await screen.findByRole("region", {
      name: "存檔瀏覽器",
    });
    const load = within(
      browser.querySelector(
        '[data-slot-type="auto"][data-slot-number="1"]',
      ) as HTMLElement,
    ).getByRole("button", { name: "載入自動存檔 1" });

    await fireEvent.click(load);
    await fireEvent.click(load);

    expect(loadCalls).toBe(1);
    expect(screen.queryByRole("dialog", { name: "載入失敗" })).toBeNull();
    resolveLoad(jsonResponse({ state: jumpedState(), thumbnailCapture: null }));
    await waitFor(() => expect(gameState.value?.scene.id).toBe("scene_2"));
    expect(screen.queryByRole("dialog", { name: "載入失敗" })).toBeNull();
  });

  it("closes the title browser from the real window Escape handler and restores Load focus", async () => {
    const user = userEvent.setup();
    const discovery = titleDiscovery(validSlotStatus("title-load-id"));
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(discovery);
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      return jsonResponse({});
    });

    render(Page);
    const load = await screen.findByRole("button", { name: "載入遊戲" });
    await user.click(load);
    expect(
      await screen.findByRole("region", { name: "存檔瀏覽器" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "存檔瀏覽器" }),
      ).not.toBeInTheDocument();
      expect(load).toHaveFocus();
    });
  });

  it("retries the title slot the player selected instead of the initial Continue candidate", async () => {
    const user = userEvent.setup();
    const discovery = titleDiscovery(validSlotStatus("candidate-save-id"));
    discovery.browser.slots[6] = {
      reference: { type: "manual", slot: 2 },
      modifiedAt: "2026-07-27T13:00:00Z",
      status: validSlotStatus("selected-save-id"),
    };
    const loadArgs: Record<string, unknown>[] = [];
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(discovery);
      if (command === "load_save") {
        loadArgs.push(JSON.parse(String(init?.body)));
        return jsonError({
          code: "saveReadFailed",
          message: "選取的存檔暫時無法載入",
        });
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") {
        return jsonResponse({ type: "idle" });
      }
      return jsonResponse({});
    });

    render(Page);
    await user.click(await screen.findByRole("button", { name: "載入遊戲" }));
    const browser = await screen.findByRole("region", {
      name: "存檔瀏覽器",
    });
    await user.click(
      within(browser).getByRole("button", { name: "選擇手動存檔 2" }),
    );
    const failure = await screen.findByRole("dialog", { name: "載入失敗" });
    await user.click(within(failure).getByRole("button", { name: "重試" }));

    await waitFor(() => expect(loadArgs).toHaveLength(2));
    expect(loadArgs).toEqual([
      {
        reference: { type: "manual", slot: 2 },
        observedSaveId: "selected-save-id",
      },
      {
        reference: { type: "manual", slot: 2 },
        observedSaveId: "selected-save-id",
      },
    ]);
  });
});

describe("+page acquisition popup integration", () => {
  let canvasGetContextSpy: MockInstance<
    typeof HTMLCanvasElement.prototype.getContext
  >;

  beforeEach(() => {
    canvasGetContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.currentWindow.isFullscreen.mockResolvedValue(false);
    seedGameState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    canvasGetContextSpy.mockRestore();
    acquisitionController.clear();
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
  });

  it("inerts gameplay and restores focus after the final acknowledgement", async () => {
    const user = userEvent.setup();
    stubAcquisitionAcknowledgement();
    const { container } = render(Page);
    const advanceButton = screen.getByRole("button", { name: "推進對話" });
    advanceButton.focus();

    gameState.value = {
      ...currentState(),
      pendingAcquisition: acquiredEvidence,
    };

    const popup = await screen.findByRole("dialog", { name: "物證取得" });
    const gameplayRoot = container.querySelector("[data-gameplay-root]")!;
    const gameplayMain = gameplayRoot.querySelector("main")!;
    expect(gameplayRoot).not.toHaveAttribute("inert");
    expect(gameplayMain.inert).toBe(true);
    expect(
      within(popup).getByRole("button", { name: "CONTINUE / 繼續" }),
    ).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "物證取得" })).toBeNull();
      expect(gameplayMain.inert).toBe(false);
      expect(advanceButton).toHaveFocus();
    });
    expect(
      mocks.fetch.mock.calls.some(([url]) =>
        String(url).endsWith("/advance_dialogue"),
      ),
    ).toBe(false);
  });

  it("surfaces an acknowledgement failure inside the dialog and retries Continue", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockImplementation(async (url: string) => {
      const path = String(url).replace("http://127.0.0.1:1421/", "");
      if (path === "acknowledge_acquisition_event") {
        return jsonError({
          code: "unknownAcquisitionEvent",
          message: "尚未呈現的取得事件無法確認。",
        });
      }
      return jsonResponse({});
    });
    render(Page);

    gameState.value = {
      ...currentState(),
      pendingAcquisition: acquiredEvidence,
    };

    const popup = await screen.findByRole("dialog", { name: "物證取得" });
    const continueButton = within(popup).getByRole("button", {
      name: "CONTINUE / 繼續",
    });
    expect(continueButton).toBeEnabled();

    // The first Continue fails; the typed error surfaces through the shared
    // dispatch path inside the dialog.
    await user.click(continueButton);
    const alert = await within(popup).findByRole("alert");
    expect(alert).toHaveTextContent("尚未呈現的取得事件無法確認。");
    expect(gameState.error).toBe("尚未呈現的取得事件無法確認。");
    expect(continueButton).toBeEnabled();

    // The second Continue retries the same acknowledgement and succeeds.
    mocks.fetch.mockImplementation(async (url: string) => {
      const path = String(url).replace("http://127.0.0.1:1421/", "");
      if (path === "acknowledge_acquisition_event") {
        return jsonResponse({
          state: currentState(),
          thumbnailCapture: null,
        });
      }
      return jsonResponse({});
    });
    await user.click(continueButton);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "物證取得" })).toBeNull();
    });
    expect(gameState.error).toBeNull();
  });

  it("does not open the game menu while a command is in flight", async () => {
    const user = userEvent.setup();
    let resolveAdvance!: (response: Response) => void;
    const delayedAdvance = new Promise<Response>((resolve) => {
      resolveAdvance = resolve;
    });
    mocks.fetch.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/advance_dialogue")) return delayedAdvance;
      if (String(url).endsWith("/list_scenes")) {
        return jsonResponse(sceneNavigationIndex);
      }
      return jsonResponse({});
    });
    render(Page);

    const command = advanceDialogue({
      sceneId: "scene_1",
      queueGen: 1,
      cursor: 0,
    });
    await waitFor(() => expect(gameState.inFlight).toBe(true));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
    resolveAdvance(
      jsonResponse({ state: currentState(), thumbnailCapture: null }),
    );
    await command;
  });

  it("clears inFlight after a command error so the UI does not lock up", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/advance_dialogue")) {
        return {
          ok: false,
          status: 500,
          text: () => Promise.resolve(JSON.stringify({ message: "bad token" })),
        } as unknown as Response;
      }
      return jsonResponse({});
    });
    render(Page);

    expect(gameState.inFlight).toBe(false);
    const command = advanceDialogue({
      sceneId: "scene_1",
      queueGen: 1,
      cursor: 0,
    });
    await waitFor(() => expect(gameState.inFlight).toBe(true));
    await command;

    expect(gameState.inFlight).toBe(false);
    expect(gameState.error).not.toBeNull();
  });
});

describe("+page in-game persistence browser", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.currentWindow.isFullscreen.mockResolvedValue(false);
    persistenceStore.replacePersistenceStatus({ type: "healthy" });
    persistenceStore.replaceThumbnailActivity({ type: "idle" });
    persistenceStore.replaceExitStatus({ type: "idle" });
    seedGameState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
    persistenceStore.replacePersistenceStatus({ type: "healthy" });
    persistenceStore.replaceThumbnailActivity({ type: "idle" });
    persistenceStore.replaceExitStatus({ type: "idle" });
  });

  it("keeps gameplay isolated behind visible loading until Manual Save preflight succeeds", async () => {
    let resolveList!: (response: Response) => void;
    const delayedList = new Promise<Response>((resolve) => {
      resolveList = resolve;
    });
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return delayedList;
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      return jsonResponse({});
    });

    const user = userEvent.setup();
    const { container } = render(Page);
    await user.keyboard("{Escape}");
    const rootMenu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(rootMenu).getByRole("button", { name: "儲存遊戲" }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("讀取存檔中…");
    const gameplayRoot = container.querySelector("[data-gameplay-root]");
    const gameplayMain = gameplayRoot?.querySelector("main");
    expect(gameplayRoot).not.toHaveAttribute("inert");
    expect(gameplayMain?.inert).toBe(true);
    expect(rootMenu.inert).toBe(true);
    expect(screen.getByRole("status").closest("[inert]")).toBeNull();

    resolveList(jsonResponse(titleDiscovery()));
    const browser = await screen.findByRole("region", {
      name: "存檔瀏覽器",
    });
    expect(
      within(browser).getByRole("heading", { name: "儲存遊戲" }),
    ).toBeInTheDocument();
    expect(
      within(browser).queryByRole("group", { name: "自動存檔" }),
    ).toBeNull();
    expect(rootMenu).toBeInTheDocument();
  });

  it("offers only Retry and Cancel when Manual Save preflight flush fails", async () => {
    const failed = titleDiscovery();
    failed.preflight = {
      type: "flushFailed",
      diagnostic: {
        code: "saveWriteFailed",
        message: "無法先儲存目前進度",
      },
      failureToken: "manual-flush-token",
    };
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(failed);
      if (command === "list_scenes") return jsonResponse(sceneNavigationIndex);
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      return jsonResponse({});
    });

    const user = userEvent.setup();
    render(Page);
    await user.keyboard("{Escape}");
    const rootMenu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(rootMenu).getByRole("button", { name: "儲存遊戲" }),
    );

    const failure = await screen.findByRole("dialog", {
      name: "無法開啟存檔",
    });
    expect(
      within(failure).getByRole("button", { name: "重試" }),
    ).toBeInTheDocument();
    expect(
      within(failure).getByRole("button", { name: "取消" }),
    ).toBeInTheDocument();
    expect(
      within(failure).queryByRole("button", {
        name: "捨棄未儲存進度並載入",
      }),
    ).toBeNull();
  });

  it("requires a second confirmation before opening Load with the exact discard token", async () => {
    const user = userEvent.setup();
    const failed = titleDiscovery();
    failed.preflight = {
      type: "flushFailed",
      diagnostic: {
        code: "saveWriteFailed",
        message: "無法先儲存目前進度",
      },
      failureToken: "load-flush-token",
    };
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(failed);
      if (command === "list_scenes") return jsonResponse(sceneNavigationIndex);
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      return jsonResponse({});
    });

    render(Page);
    await user.keyboard("{Escape}");
    const rootMenu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(rootMenu).getByRole("button", { name: "載入遊戲" }),
    );
    const failure = await screen.findByRole("dialog", {
      name: "無法開啟存檔",
    });
    await user.click(
      within(failure).getByRole("button", {
        name: "捨棄未儲存進度並載入",
      }),
    );

    const confirmation = await screen.findByRole("dialog", {
      name: "確認捨棄未儲存進度並載入",
    });
    expect(screen.queryByRole("region", { name: "存檔瀏覽器" })).toBeNull();
    await user.click(
      within(confirmation).getByRole("button", {
        name: "捨棄未儲存進度並載入",
      }),
    );

    expect(
      await screen.findByRole("region", { name: "存檔瀏覽器" }),
    ).toBeInTheDocument();
  });

  it("cancels a discarded-progress browser token before closing so a normal reopen uses load_save", async () => {
    const user = userEvent.setup();
    const failed = titleDiscovery(validSlotStatus("discard-candidate"));
    failed.preflight = {
      type: "flushFailed",
      diagnostic: {
        code: "saveWriteFailed",
        message: "無法先儲存目前進度",
      },
      failureToken: "discard-browser-token",
    };
    const ready = titleDiscovery(validSlotStatus("normal-load-id"));
    const commands: Array<{
      command: string;
      args: Record<string, unknown>;
    }> = [];
    let listCalls = 0;
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1)!;
      if (command === "list_saves") {
        listCalls += 1;
        return jsonResponse(listCalls === 1 ? failed : ready);
      }
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      if (
        command === "cancel_persistence_failure" ||
        command === "load_save" ||
        command === "load_save_discarding_current"
      ) {
        commands.push({
          command,
          args: JSON.parse(String(init?.body)),
        });
        return command === "cancel_persistence_failure"
          ? jsonResponse(null)
          : jsonResponse({
              state: jumpedState(),
              thumbnailCapture: null,
            });
      }
      return jsonResponse({});
    });

    render(Page);
    await user.keyboard("{Escape}");
    const menu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(within(menu).getByRole("button", { name: "載入遊戲" }));
    const failure = await screen.findByRole("dialog", {
      name: "無法開啟存檔",
    });
    await user.click(
      within(failure).getByRole("button", {
        name: "捨棄未儲存進度並載入",
      }),
    );
    const confirmation = await screen.findByRole("dialog", {
      name: "確認捨棄未儲存進度並載入",
    });
    await user.click(
      within(confirmation).getByRole("button", {
        name: "捨棄未儲存進度並載入",
      }),
    );
    let browser = await screen.findByRole("region", { name: "存檔瀏覽器" });
    await user.click(within(browser).getByRole("button", { name: "返回" }));

    await waitFor(() =>
      expect(commands).toEqual([
        {
          command: "cancel_persistence_failure",
          args: { failureToken: "discard-browser-token" },
        },
      ]),
    );
    expect(
      screen.queryByRole("region", { name: "存檔瀏覽器" }),
    ).not.toBeInTheDocument();

    await user.click(within(menu).getByRole("button", { name: "載入遊戲" }));
    browser = await screen.findByRole("region", { name: "存檔瀏覽器" });
    const autoOne = browser.querySelector(
      '[data-slot-type="auto"][data-slot-number="1"]',
    )!;
    await user.click(
      within(autoOne as HTMLElement).getByRole("button", {
        name: "載入自動存檔 1",
      }),
    );
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "載入自動存檔 1" }),
      ).getByRole("button", { name: "確認載入" }),
    );

    await waitFor(() => expect(gameState.value?.scene.id).toBe("scene_2"));
    expect(commands.at(-1)).toEqual({
      command: "load_save",
      args: {
        reference: { type: "auto", slot: 1 },
        observedSaveId: "normal-load-id",
      },
    });
    expect(
      commands.some(
        ({ command }) => command === "load_save_discarding_current",
      ),
    ).toBe(false);
  });

  it("single-flights an empty manual save before thumbnail preparation settles", async () => {
    const user = userEvent.setup();
    let manualArgs: Record<string, unknown> | null = null;
    let resolvePreparation!: (response: Response) => void;
    const delayedPreparation = new Promise<Response>((resolve) => {
      resolvePreparation = resolve;
    });
    let prepareCalls = 0;
    let manualCalls = 0;
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(titleDiscovery());
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "prepare_save_thumbnail") {
        prepareCalls += 1;
        return delayedPreparation;
      }
      if (command === "report_save_thumbnail_failure") {
        return jsonResponse({
          type: "unavailable",
          diagnostic: {
            reason: "captureUnavailable",
            message: "無法顯示預覽",
            retryable: false,
          },
        });
      }
      if (command === "save_manual") {
        manualCalls += 1;
        manualArgs = JSON.parse(String(init?.body));
        const browser = titleDiscovery().browser;
        return jsonResponse({
          savedSlot: browser.slots[5],
          browser,
          thumbnailActivity: {
            type: "unavailable",
            diagnostic: {
              reason: "captureUnavailable",
              message: "無法顯示預覽",
              retryable: false,
            },
          },
        });
      }
      return jsonResponse({});
    });

    render(Page);
    await user.keyboard("{Escape}");
    const rootMenu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(rootMenu).getByRole("button", { name: "儲存遊戲" }),
    );
    const browser = await screen.findByRole("region", {
      name: "存檔瀏覽器",
    });
    await user.click(
      within(browser).getByRole("button", { name: "選擇手動存檔 1" }),
    );

    const nameDialog = await screen.findByRole("dialog", { name: "命名存檔" });
    const input = within(nameDialog).getByRole("textbox", {
      name: "存檔名稱",
    });
    await user.clear(input);
    await user.type(input, "雨夜調查");
    const submit = within(nameDialog).getByRole("button", { name: "繼續" });
    await fireEvent.click(submit);
    await fireEvent.click(submit);

    expect(prepareCalls).toBe(1);
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.getByRole("dialog", { name: "命名存檔" }),
    ).toBeInTheDocument();
    resolvePreparation(jsonResponse({ ticket: "manual-ticket", timeoutMs: 0 }));
    await waitFor(() => expect(manualArgs).not.toBeNull());
    expect(manualCalls).toBe(1);
    expect(manualArgs).toEqual({
      reference: { type: "manual", slot: 1 },
      displayName: "雨夜調查",
      expectation: { type: "empty" },
      preparedThumbnailTicket: "manual-ticket",
    });
    expect(
      await screen.findByRole("status", { name: "預覽狀態" }),
    ).toHaveTextContent("無法顯示預覽");
    expect(persistenceStore.thumbnailActivity).toEqual({
      type: "unavailable",
      diagnostic: {
        reason: "captureUnavailable",
        message: "無法顯示預覽",
        retryable: false,
      },
    });
    expect(screen.getAllByRole("status", { name: "預覽狀態" })).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "儲存失敗" })).toBeNull();
  });

  it.each([
    {
      caseName: "active primary objective",
      objectives: [
        {
          id: "objective_follow_witness",
          label: "追查雨夜目擊者",
          summary: "找出目擊者隱瞞的證詞。",
          kind: "primary" as const,
          sortOrder: 10,
          completed: false,
          activePrimary: true,
        },
      ],
      expectedLabel: "追查雨夜目擊者",
      unexpectedLabel: "沒有進行中的主要目標",
    },
    {
      caseName: "no active primary objective",
      objectives: [],
      expectedLabel: "沒有進行中的主要目標",
      unexpectedLabel: "追查雨夜目擊者",
    },
  ])(
    "shows the $caseName in an occupied manual overwrite summary",
    async ({ objectives, expectedLabel, unexpectedLabel }) => {
      const user = userEvent.setup();
      const state = currentState();
      state.chapter.summary = "目前章節摘要";
      state.scene.summary = "目前場景摘要";
      state.story.objectives = objectives;
      gameState.value = state;
      const saves = titleDiscovery();
      saves.browser.slots[5] = {
        reference: { type: "manual", slot: 1 },
        modifiedAt: "2026-07-27T12:00:01Z",
        status: validSlotStatus("occupied-manual-id"),
      };
      mocks.fetch.mockImplementation(async (url: string) => {
        const command = String(url).split("/").at(-1);
        if (command === "list_saves") return jsonResponse(saves);
        if (command === "list_scenes") {
          return jsonResponse(sceneNavigationIndex);
        }
        if (command === "get_persistence_status") {
          return jsonResponse({ type: "healthy" });
        }
        if (command === "get_thumbnail_activity") {
          return jsonResponse({ type: "idle" });
        }
        if (command === "get_exit_status") {
          return jsonResponse({ type: "idle" });
        }
        return jsonResponse({});
      });

      render(Page);
      await user.keyboard("{Escape}");
      const menu = await screen.findByRole("dialog", { name: "遊戲選單" });
      await user.click(within(menu).getByRole("button", { name: "儲存遊戲" }));
      const browser = await screen.findByRole("region", {
        name: "存檔瀏覽器",
      });
      await user.click(
        within(browser).getByRole("button", { name: "選擇手動存檔 1" }),
      );
      const nameDialog = await screen.findByRole("dialog", {
        name: "命名存檔",
      });
      const expectedCurrentSummary = {
        chapterId: "chapter_1",
        chapterTitle: "雨夜的第一份證詞",
        chapterSummary: "目前章節摘要",
        sceneId: "scene_1",
        sceneTitle: "序章",
        sceneSummary: "目前場景摘要",
        activePrimaryObjectiveId: objectives[0]?.id ?? null,
        activePrimaryObjectiveLabel: objectives[0]?.label ?? null,
        activePrimaryObjectiveSummary: objectives[0]?.summary ?? null,
      };
      expect(mocks.saveNameSummary).toHaveBeenLastCalledWith(
        expectedCurrentSummary,
      );
      await user.click(
        within(nameDialog).getByRole("button", { name: "繼續" }),
      );

      const current = await screen.findByRole("region", {
        name: "目前遊戲",
      });
      expect(mocks.saveConfirmationSummary).toHaveBeenLastCalledWith(
        expectedCurrentSummary,
      );
      expect(current).toHaveTextContent(expectedLabel);
      expect(current).not.toHaveTextContent(unexpectedLabel);
    },
  );

  it("dismisses only the top manual-save failure on Escape and leaves its name layer intact", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(titleDiscovery());
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      if (command === "prepare_save_thumbnail") {
        return jsonResponse({ ticket: "manual-ticket", timeoutMs: 0 });
      }
      if (command === "report_save_thumbnail_failure") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "save_manual") {
        return jsonError({
          code: "saveWriteFailed",
          message: "手動存檔失敗",
        });
      }
      return jsonResponse({});
    });

    const { container } = render(Page);
    await user.keyboard("{Escape}");
    const menu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(within(menu).getByRole("button", { name: "儲存遊戲" }));
    const browser = await screen.findByRole("region", {
      name: "存檔瀏覽器",
    });
    await user.click(
      within(browser).getByRole("button", { name: "選擇手動存檔 1" }),
    );
    const nameDialog = await screen.findByRole("dialog", { name: "命名存檔" });
    await user.click(within(nameDialog).getByRole("button", { name: "繼續" }));
    expect(
      await screen.findByRole("dialog", { name: "儲存失敗" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "儲存失敗" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "命名存檔" }),
    ).toBeInTheDocument();
    expect(menu).toBeInTheDocument();
    expect(
      container.querySelector<HTMLElement>("[data-gameplay-root] main")?.inert,
    ).toBe(true);
  });

  it("always confirms in-game Load, installs the full state, and closes transient layers", async () => {
    const user = userEvent.setup();
    const saves = titleDiscovery(validSlotStatus("load-save-id"));
    let loadArgs: Record<string, unknown> | null = null;
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(saves);
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "load_save") {
        loadArgs = JSON.parse(String(init?.body));
        return jsonResponse({
          state: jumpedState(),
          thumbnailCapture: null,
        });
      }
      return jsonResponse({});
    });

    render(Page);
    await user.keyboard("{Escape}");
    const rootMenu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(rootMenu).getByRole("button", { name: "載入遊戲" }),
    );
    const browser = await screen.findByRole("region", {
      name: "存檔瀏覽器",
    });
    const autoOne = browser.querySelector(
      '[data-slot-type="auto"][data-slot-number="1"]',
    )!;
    await user.click(
      within(autoOne as HTMLElement).getByRole("button", {
        name: "載入自動存檔 1",
      }),
    );

    const confirmation = await screen.findByRole("dialog", {
      name: "載入自動存檔 1",
    });
    expect(gameState.value?.scene.id).toBe("scene_1");
    await user.click(
      within(confirmation).getByRole("button", { name: "確認載入" }),
    );

    await waitFor(() => expect(gameState.value?.scene.id).toBe("scene_2"));
    expect(loadArgs).toEqual({
      reference: { type: "auto", slot: 1 },
      observedSaveId: "load-save-id",
    });
    expect(screen.queryByRole("region", { name: "存檔瀏覽器" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "載入自動存檔 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "推進對話" })).toHaveFocus();
  });

  it("retains the exact Load failure token through the second discard confirmation", async () => {
    const user = userEvent.setup();
    const saves = titleDiscovery(validSlotStatus("observed-load-id"));
    let discardArgs: Record<string, unknown> | null = null;
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(saves);
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "load_save") {
        return jsonError({
          code: "saveWriteFailed",
          message: "無法先儲存目前進度",
          failureToken: "opaque-load-token",
        });
      }
      if (command === "load_save_discarding_current") {
        discardArgs = JSON.parse(String(init?.body));
        return jsonResponse({
          state: jumpedState(),
          thumbnailCapture: null,
        });
      }
      return jsonResponse({});
    });

    render(Page);
    await user.keyboard("{Escape}");
    const rootMenu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(rootMenu).getByRole("button", { name: "載入遊戲" }),
    );
    const browser = await screen.findByRole("region", {
      name: "存檔瀏覽器",
    });
    const autoOne = browser.querySelector(
      '[data-slot-type="auto"][data-slot-number="1"]',
    )!;
    await user.click(
      within(autoOne as HTMLElement).getByRole("button", {
        name: "載入自動存檔 1",
      }),
    );
    const initialConfirmation = await screen.findByRole("dialog", {
      name: "載入自動存檔 1",
    });
    await user.click(
      within(initialConfirmation).getByRole("button", { name: "確認載入" }),
    );

    const failure = await screen.findByRole("dialog", { name: "載入失敗" });
    expect(
      within(failure).getByRole("button", { name: "重試" }),
    ).toBeInTheDocument();
    expect(
      within(failure).getByRole("button", { name: "取消" }),
    ).toBeInTheDocument();
    await user.click(
      within(failure).getByRole("button", {
        name: "捨棄未儲存進度並載入",
      }),
    );

    const discardConfirmation = await screen.findByRole("dialog", {
      name: "確認捨棄未儲存進度並載入",
    });
    await user.click(
      within(discardConfirmation).getByRole("button", {
        name: "捨棄未儲存進度並載入",
      }),
    );

    await waitFor(() => expect(discardArgs).not.toBeNull());
    expect(discardArgs).toEqual({
      reference: { type: "auto", slot: 1 },
      observedSaveId: "observed-load-id",
      failureToken: "opaque-load-token",
    });
    expect(gameState.value?.scene.id).toBe("scene_2");
  });

  it("cancels an in-game Load challenge before returning to the browser", async () => {
    const user = userEvent.setup();
    const saves = titleDiscovery(validSlotStatus("observed-load-id"));
    let cancelArgs: Record<string, unknown> | null = null;
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_saves") return jsonResponse(saves);
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      if (command === "load_save") {
        return jsonError({
          code: "saveWriteFailed",
          message: "無法先儲存目前進度",
          failureToken: "load-cancel-token",
        });
      }
      if (command === "cancel_persistence_failure") {
        cancelArgs = JSON.parse(String(init?.body));
        return jsonResponse(null);
      }
      return jsonResponse({});
    });

    render(Page);
    await user.keyboard("{Escape}");
    const menu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(within(menu).getByRole("button", { name: "載入遊戲" }));
    const browser = await screen.findByRole("region", {
      name: "存檔瀏覽器",
    });
    const autoOne = browser.querySelector(
      '[data-slot-type="auto"][data-slot-number="1"]',
    )!;
    await user.click(
      within(autoOne as HTMLElement).getByRole("button", {
        name: "載入自動存檔 1",
      }),
    );
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "載入自動存檔 1" }),
      ).getByRole("button", { name: "確認載入" }),
    );
    const failure = await screen.findByRole("dialog", { name: "載入失敗" });
    await user.click(within(failure).getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(cancelArgs).toEqual({ failureToken: "load-cancel-token" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "載入失敗" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "存檔瀏覽器" }),
    ).toBeInTheDocument();
  });

  it("uses the exact exit failure token for Cancel, Retry, and exit without saving", async () => {
    const user = userEvent.setup();
    const commandArgs: Array<{
      command: string;
      args: Record<string, unknown>;
    }> = [];
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1)!;
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") {
        return jsonResponse({ type: "idle" });
      }
      if (
        command === "cancel_exit" ||
        command === "retry_exit" ||
        command === "exit_without_saving"
      ) {
        commandArgs.push({
          command,
          args: JSON.parse(String(init?.body)),
        });
        return jsonResponse(
          command === "retry_exit" ? { type: "saving" } : { type: "idle" },
        );
      }
      return jsonResponse({});
    });

    const { container } = render(Page);
    await waitFor(() =>
      expect(
        mocks.fetch.mock.calls.some(([url]) =>
          String(url).endsWith("/get_exit_status"),
        ),
      ).toBe(true),
    );

    persistenceStore.replaceExitStatus({ type: "saving" });
    expect(
      await screen.findByRole("status", { name: "儲存中…" }),
    ).toHaveTextContent("仍在儲存，請稍候…");
    const gameplayRoot = container.querySelector("[data-gameplay-root]")!;
    expect(gameplayRoot).not.toHaveAttribute("inert");
    expect(gameplayRoot.querySelector("main")?.inert).toBe(true);

    const failed = {
      type: "failed",
      diagnostic: { code: "saveWriteFailed", message: "無法結束前儲存" },
      failureToken: "opaque-exit-token",
    } as const;
    persistenceStore.replaceExitStatus(failed);
    let dialog = await screen.findByRole("dialog", { name: "無法結束遊戲" });
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(commandArgs).toHaveLength(1));

    persistenceStore.replaceExitStatus(failed);
    dialog = await screen.findByRole("dialog", { name: "無法結束遊戲" });
    await user.click(within(dialog).getByRole("button", { name: "重試" }));
    await waitFor(() => expect(commandArgs).toHaveLength(2));

    persistenceStore.replaceExitStatus(failed);
    dialog = await screen.findByRole("dialog", { name: "無法結束遊戲" });
    await user.click(
      within(dialog).getByRole("button", {
        name: "不儲存並結束遊戲",
      }),
    );
    const confirmation = await screen.findByRole("dialog", {
      name: "確認不儲存並結束遊戲",
    });
    await user.click(
      within(confirmation).getByRole("button", {
        name: "不儲存並結束遊戲",
      }),
    );
    await waitFor(() => expect(commandArgs).toHaveLength(3));

    expect(commandArgs).toEqual([
      {
        command: "cancel_exit",
        args: { failureToken: "opaque-exit-token" },
      },
      {
        command: "retry_exit",
        args: { failureToken: "opaque-exit-token" },
      },
      {
        command: "exit_without_saving",
        args: { failureToken: "opaque-exit-token" },
      },
    ]);
  });

  it("swallows Escape while exit is saving and uses exact cancel_exit from the failed layer", async () => {
    const user = userEvent.setup();
    const cancelBodies: Record<string, unknown>[] = [];
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1)!;
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      if (command === "cancel_exit") {
        cancelBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ type: "idle" });
      }
      return jsonResponse({});
    });

    render(Page);
    await waitFor(() =>
      expect(
        mocks.fetch.mock.calls.some(([url]) =>
          String(url).endsWith("/get_exit_status"),
        ),
      ).toBe(true),
    );
    persistenceStore.replaceExitStatus({ type: "saving" });
    expect(
      await screen.findByRole("status", { name: "儲存中…" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(cancelBodies).toEqual([]);
    expect(
      screen.queryByRole("dialog", { name: "遊戲選單" }),
    ).not.toBeInTheDocument();
    expect(persistenceStore.exitStatus.type).toBe("saving");

    persistenceStore.replaceExitStatus({
      type: "failed",
      diagnostic: { code: "saveWriteFailed", message: "無法結束前儲存" },
      failureToken: "escape-exit-token",
    });
    expect(
      await screen.findByRole("dialog", { name: "無法結束遊戲" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(cancelBodies).toEqual([{ failureToken: "escape-exit-token" }]),
    );
    expect(persistenceStore.exitStatus.type).toBe("idle");
    expect(
      screen.queryByRole("dialog", { name: "遊戲選單" }),
    ).not.toBeInTheDocument();
  });

  it("keeps degraded persistence health visible separately from preview failure", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "list_scenes") return jsonResponse(sceneNavigationIndex);
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      return jsonResponse({});
    });
    render(Page);
    await waitFor(() =>
      expect(
        mocks.fetch.mock.calls.some(([url]) =>
          String(url).endsWith("/get_exit_status"),
        ),
      ).toBe(true),
    );

    persistenceStore.replacePersistenceStatus({
      type: "degraded",
      diagnostic: { code: "saveWriteFailed", message: "自動存檔失敗" },
    });
    persistenceStore.replaceThumbnailActivity({
      type: "unavailable",
      diagnostic: {
        reason: "captureUnavailable",
        message: "無法顯示預覽",
        retryable: false,
      },
    });

    expect(
      await screen.findByRole("status", { name: "儲存狀態" }),
    ).toHaveTextContent("自動存檔失敗");
    expect(screen.getByRole("status", { name: "預覽狀態" })).toHaveTextContent(
      "無法顯示預覽",
    );

    persistenceStore.replacePersistenceStatus({ type: "healthy" });
    persistenceStore.replaceThumbnailActivity({ type: "idle" });
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "儲存狀態" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("status", { name: "預覽狀態" }),
    ).not.toBeInTheDocument();
  });
});

describe("+page close case flow", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
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
    vi.unstubAllGlobals();
    cleanup();
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
  });

  it("returns the Rust discovery snapshot to title without rediscovering and focuses Continue", async () => {
    const user = userEvent.setup();
    const returned = titleDiscovery(validSlotStatus("return-save"));
    let listCalls = 0;
    mocks.fetch.mockImplementation(async (url: string) => {
      const command = String(url).split("/").at(-1);
      if (command === "return_to_title") return jsonResponse(returned);
      if (command === "list_saves") {
        listCalls += 1;
        return jsonResponse(titleDiscovery());
      }
      if (command === "list_scenes") return jsonResponse(sceneNavigationIndex);
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      return jsonResponse({});
    });
    render(Page);

    expect(
      screen.queryByRole("main", { name: "主選單" }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(dialog).getByRole("button", { name: "返回標題畫面" }),
    );

    expect(
      await screen.findByRole("main", { name: "主選單" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "遊戲選單" }),
    ).not.toBeInTheDocument();
    expect(listCalls).toBe(0);
    expect(screen.getByRole("button", { name: "繼續遊戲" })).toHaveFocus();
  });

  it("keeps gameplay on Return failure and retains the exact token through the second confirmation", async () => {
    const user = userEvent.setup();
    let discardArgs: Record<string, unknown> | null = null;
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1);
      if (command === "return_to_title") {
        return jsonError({
          code: "saveWriteFailed",
          message: "返回標題前無法儲存",
          failureToken: "opaque-return-token",
        });
      }
      if (command === "return_to_title_without_saving") {
        discardArgs = JSON.parse(String(init?.body));
        return jsonResponse(titleDiscovery());
      }
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") {
        return jsonResponse({ type: "idle" });
      }
      return jsonResponse({});
    });

    render(Page);
    await user.keyboard("{Escape}");
    const rootMenu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(rootMenu).getByRole("button", { name: "返回標題畫面" }),
    );

    const failure = await screen.findByRole("dialog", {
      name: "無法返回標題畫面",
    });
    expect(gameState.value).not.toBeNull();
    expect(
      within(failure).getByRole("button", { name: "重試" }),
    ).toBeInTheDocument();
    expect(
      within(failure).getByRole("button", { name: "取消" }),
    ).toBeInTheDocument();
    await user.click(
      within(failure).getByRole("button", {
        name: "不儲存並返回標題畫面",
      }),
    );

    const confirmation = await screen.findByRole("dialog", {
      name: "確認不儲存並返回標題畫面",
    });
    expect(gameState.value).not.toBeNull();
    await user.click(
      within(confirmation).getByRole("button", {
        name: "不儲存並返回標題畫面",
      }),
    );

    await waitFor(() => expect(discardArgs).not.toBeNull());
    expect(discardArgs).toEqual({ failureToken: "opaque-return-token" });
    expect(gameState.value).toBeNull();
    expect(screen.getByRole("button", { name: "開始新遊戲" })).toHaveFocus();
  });

  it("cancels a Return challenge with its exact token before Escape restores the game menu", async () => {
    const user = userEvent.setup();
    let cancelArgs: Record<string, unknown> | null = null;
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const command = String(url).split("/").at(-1);
      if (command === "return_to_title") {
        return jsonError({
          code: "saveWriteFailed",
          message: "返回標題前無法儲存",
          failureToken: "return-cancel-token",
        });
      }
      if (command === "cancel_persistence_failure") {
        cancelArgs = JSON.parse(String(init?.body));
        return jsonResponse(null);
      }
      if (command === "list_scenes") {
        return jsonResponse(sceneNavigationIndex);
      }
      if (command === "get_persistence_status") {
        return jsonResponse({ type: "healthy" });
      }
      if (command === "get_thumbnail_activity") {
        return jsonResponse({ type: "idle" });
      }
      if (command === "get_exit_status") return jsonResponse({ type: "idle" });
      return jsonResponse({});
    });

    render(Page);
    await user.keyboard("{Escape}");
    const menu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(menu).getByRole("button", { name: "返回標題畫面" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "無法返回標題畫面" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(cancelArgs).toEqual({ failureToken: "return-cancel-token" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "無法返回標題畫面" }),
    ).not.toBeInTheDocument();
    expect(menu).toBeInTheDocument();
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
      if (path === "return_to_title") {
        return jsonResponse(titleDiscovery());
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
    await user.click(
      within(dialog).getByRole("button", { name: "返回標題畫面" }),
    );
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

  it("ignores stale scene-index failures that resolve after closing the case", async () => {
    // Race regression: if the user closes the case while the initial
    // list_scenes request is still pending, a later failure resolves and
    // re-sets sceneNavigationError AFTER the close-case / title-reset path
    // already cleared the latches. The title-screen reset effect only
    // reruns on gameState.value changes, so the stale error outlives the
    // reset and suppresses the next session's auto-load. The load must
    // detect it was superseded and drop the stale result.
    let resolveFirstLoad!: (resp: Response) => void;
    const firstLoad = new Promise<Response>((resolve) => {
      resolveFirstLoad = resolve;
    });
    let listScenesCallCount = 0;
    mocks.fetch.mockImplementation(async (url: string) => {
      const path = String(url).replace("http://127.0.0.1:1421/", "");
      if (path === "list_scenes") {
        listScenesCallCount += 1;
        if (listScenesCallCount === 1) return firstLoad;
        return jsonResponse(sceneNavigationIndex);
      }
      if (path === "return_to_title") {
        return jsonResponse(titleDiscovery());
      }
      return jsonResponse({});
    });

    const user = userEvent.setup();
    render(Page);

    // First load fires and is pending.
    await waitFor(() => {
      expect(listScenesCallCount).toBe(1);
    });

    // Close the case while the first load is still in flight.
    await user.keyboard("{Escape}");
    const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(
      within(dialog).getByRole("button", { name: "返回標題畫面" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("main", { name: "主選單" })).toBeInTheDocument();
    });

    // The stale first load now resolves with failure AFTER the close-case
    // path cleared the latches. Without the generation guard, this would
    // re-set sceneNavigationError = true and suppress the next session's
    // auto-load.
    let firstLoadTextConsumed = false;
    resolveFirstLoad({
      ok: false,
      status: 500,
      text: () => {
        firstLoadTextConsumed = true;
        return Promise.resolve("index unavailable");
      },
    } as unknown as Response);
    // Wait for the stale failure to fully settle before starting the next
    // session. The stale path is `await fetch` → `await r.text()` → throw →
    // listScenes catch → gen guard; a single `await Promise.resolve()` only
    // advances the fetch promise, so the gen check could still be pending
    // when seedGameState() runs and the test would pass without exercising
    // the guard. Poll until r.text() has been consumed, then flush the
    // remaining microtasks (text() resolve, throw/catch, gen check) via a
    // macrotask so the stale load has fully returned.
    await waitFor(() => {
      expect(firstLoadTextConsumed).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Start a fresh game. The auto-load $effect must re-fire despite the
    // stale failure having resolved after the reset.
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

describe("+page active primary objective HUD", () => {
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

  it("shows only the active uncompleted primary objective in the exploration HUD", async () => {
    const state = currentState();
    state.scene = {
      kind: "investigation",
      id: "inv_scene",
      title: "調査開始",
      summary: "",
      index: 0,
      total: 1,
      currentSublocationId: "coffee_shop",
      visibleSublocations: [
        {
          id: "coffee_shop",
          label: "喫茶店",
          sceneTag: "雨夜喫茶店",
          hotspots: [],
          characters: [],
        },
      ],
    };
    state.mode = {
      type: "explore",
      sublocationId: "coffee_shop",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    };
    state.story.objectives = [
      {
        id: "objective_follow_witness",
        label: "追查雨夜目擊者",
        summary: "找出目擊者隱瞞的證詞。",
        kind: "primary",
        sortOrder: 10,
        completed: false,
        activePrimary: true,
      },
      {
        id: "objective_archived",
        label: "已完成的舊目標",
        summary: "這不應再顯示。",
        kind: "primary",
        sortOrder: 1,
        completed: true,
        activePrimary: true,
      },
    ];
    gameState.value = state;

    render(Page);

    const objectiveHud = await screen.findByRole("status", {
      name: "主要目標",
    });
    expect(objectiveHud).toHaveTextContent("追查雨夜目擊者");
    expect(objectiveHud).not.toHaveTextContent("已完成的舊目標");
    expect(screen.getAllByRole("status", { name: "主要目標" })).toHaveLength(1);
    expect(
      screen.getByRole("navigation", { name: "地點導航" }),
    ).toBeInTheDocument();
  });
});

describe("+page Case File menu integration", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    stubFetchForSceneNavigation();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.currentWindow.isFullscreen.mockResolvedValue(false);
    presentationState.sessionEpoch = 0;
    seedGameState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    presentationState.sessionEpoch = 0;
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
  });

  it("preserves the chosen Case File section across menu reopen and resets it for a replacement session", async () => {
    const user = userEvent.setup();
    render(Page);

    await user.keyboard("{Escape}");
    let menu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(within(menu).getByRole("button", { name: /案件檔案/ }));
    const evidenceTab = await screen.findByRole("tab", { name: /證物/ });
    await user.click(evidenceTab);
    expect(evidenceTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    menu = await screen.findByRole("dialog", { name: "遊戲選單" });
    await user.click(within(menu).getByRole("button", { name: /案件檔案/ }));
    expect(
      await screen.findByRole("tab", { name: /證物/, selected: true }),
    ).toBeInTheDocument();

    presentationState.sessionEpoch += 1;

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "遊戲選單" }),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /案件檔案/ }));
    expect(
      await screen.findByRole("tab", { name: /目標/, selected: true }),
    ).toBeInTheDocument();
  });
});
