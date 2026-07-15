import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GameplayCommandName,
  GameplaySfxEvent,
} from "$lib/audio/sfx-events";
import type { GameStateView } from "./types";

const mocks = vi.hoisted(() => ({
  acquisitionClear: vi.fn(),
  acquisitionEnqueue: vi.fn(),
  inferAcquisitionNotifications: vi.fn(),
  inferGameplaySfxEvents: vi.fn(),
  invoke: vi.fn(),
  playGameplaySfxEvent: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("$lib/audio/gameplay-audio-runtime.svelte", () => ({
  playGameplaySfxEvent: mocks.playGameplaySfxEvent,
}));

vi.mock("$lib/audio/sfx-events", () => ({
  inferGameplaySfxEvents: mocks.inferGameplaySfxEvents,
}));

vi.mock("./acquisition-notifications", () => ({
  inferAcquisitionNotifications: mocks.inferAcquisitionNotifications,
}));

vi.mock("./acquisition-controller.svelte", () => ({
  acquisitionController: {
    enqueue: mocks.acquisitionEnqueue,
    clear: mocks.acquisitionClear,
  },
}));

type GameClientModule = typeof import("./game-client.svelte");

function state(id: string): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: `Chapter ${id}`,
      summary: "",
      index: 0,
      total: 1,
    },
    scene: {
      kind: "investigation",
      id: `scene_${id}`,
      title: "",
      index: 0,
      total: 1,
      currentSublocationId: "main",
      visibleSublocations: [],
    },
    mode: {
      type: "explore",
      sublocationId: "main",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
    dialogueHistory: [],
  };
}

async function loadGameClient(
  initialState: GameStateView | null = state("initial"),
): Promise<GameClientModule> {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  const client = await import("./game-client.svelte");
  client.gameState.value = initialState;
  client.gameState.error = null;
  client.gameState.loading = false;
  client.gameState.inFlight = false;
  return client;
}

beforeEach(() => {
  vi.resetModules();
  mocks.acquisitionClear.mockReset();
  mocks.acquisitionEnqueue.mockReset();
  mocks.inferAcquisitionNotifications.mockReset().mockReturnValue([]);
  mocks.inferGameplaySfxEvents.mockReset();
  mocks.invoke.mockReset();
  mocks.playGameplaySfxEvent.mockReset();
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("game client audio events", () => {
  it("does not play dialogue-click feedback from command dispatch", async () => {
    const previous = state("previous");
    const next = state("next");
    const client = await loadGameClient(previous);
    let resolveInvoke!: (value: GameStateView) => void;

    mocks.invoke.mockReturnValueOnce(
      new Promise<GameStateView>((resolve) => {
        resolveInvoke = resolve;
      }),
    );
    mocks.inferGameplaySfxEvents.mockReturnValueOnce([]);

    const command = client.advanceDialogue({
      sceneId: "scene_previous",
      queueGen: 1,
      cursor: 0,
    });

    expect(mocks.playGameplaySfxEvent).not.toHaveBeenCalled();
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();

    resolveInvoke(next);
    await command;
  });

  it("plays inferred SFX once after a successful command", async () => {
    const previous = state("previous");
    const next = state("next");
    const event: GameplaySfxEvent = "story:usb-insert";
    const client = await loadGameClient(previous);
    const capturedPrevious = client.gameState.value;

    mocks.invoke.mockResolvedValueOnce(next);
    mocks.inferGameplaySfxEvents.mockReturnValueOnce([event]);

    await client.inspectHotspot("receipt");

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("inspect_hotspot", {
      hotspotId: "receipt",
    });
    expect(client.gameState.value?.scene.id).toBe(next.scene.id);
    expect(mocks.inferGameplaySfxEvents).toHaveBeenCalledExactlyOnceWith(
      capturedPrevious,
      next,
      "inspect_hotspot",
    );
    expect(mocks.playGameplaySfxEvent).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("commits a successful state and enqueues inferred acquisitions once", async () => {
    const previous = state("previous");
    const next = state("next");
    const notification = {
      key: "evidence:receipt",
      kind: "evidence" as const,
      record: {
        id: "receipt",
        name: "Receipt",
        description: "Timestamp circled.",
        details: "",
        imageAssetId: null,
        onReexamine: null,
        collectedInChapterId: "chapter_1",
        collectedInSceneId: "scene_next",
      },
    };
    const client = await loadGameClient(previous);
    mocks.invoke.mockResolvedValueOnce(next);
    mocks.inferAcquisitionNotifications.mockReturnValueOnce([notification]);
    mocks.inferGameplaySfxEvents.mockReturnValueOnce([]);

    await client.inspectHotspot("receipt");

    expect(client.gameState.value).toEqual(next);
    expect(mocks.inferAcquisitionNotifications).toHaveBeenCalledExactlyOnceWith(
      previous,
      next,
    );
    expect(mocks.acquisitionEnqueue).toHaveBeenCalledExactlyOnceWith([
      notification,
    ]);
  });

  it("waits until the final investigation dialogue item before enqueuing an acquisition", async () => {
    const previous = state("previous");
    const dialogue = state("dialogue");
    dialogue.mode = {
      type: "dialogue",
      current: { kind: "line", speaker: "A", text: "item dialogue" },
      queueRemaining: 0,
      sceneTag: null,
      queueToken: { sceneId: "scene_dialogue", queueGen: 2, cursor: 1 },
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
      crossExamLineId: null,
    };
    const afterDialogue = state("after-dialogue");
    const notification = {
      key: "evidence:receipt",
      kind: "evidence" as const,
      record: {
        id: "receipt",
        name: "Receipt",
        description: "Timestamp circled.",
        details: "",
        imageAssetId: null,
        onReexamine: null,
        collectedInChapterId: "chapter_1",
        collectedInSceneId: "scene_dialogue",
      },
    };
    const client = await loadGameClient(previous);
    mocks.invoke
      .mockResolvedValueOnce(dialogue)
      .mockResolvedValueOnce(afterDialogue);
    mocks.inferAcquisitionNotifications
      .mockReturnValueOnce([notification])
      .mockReturnValueOnce([]);
    mocks.inferGameplaySfxEvents.mockReturnValue([]);

    await client.inspectHotspot("receipt");

    expect(mocks.acquisitionEnqueue).not.toHaveBeenCalled();

    await client.advanceDialogue({
      sceneId: "scene_dialogue",
      queueGen: 2,
      cursor: 1,
    });

    expect(mocks.acquisitionEnqueue).toHaveBeenCalledExactlyOnceWith([
      notification,
    ]);
  });

  it("does not flush a new acquisition from a newly started dialogue", async () => {
    const previous = state("previous");
    const firstDialogue = state("first-dialogue");
    firstDialogue.mode = {
      type: "dialogue",
      current: { kind: "line", speaker: "A", text: "first item dialogue" },
      queueRemaining: 0,
      sceneTag: null,
      queueToken: { sceneId: "scene_first", queueGen: 2, cursor: 1 },
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
      crossExamLineId: null,
    };
    const secondDialogue = state("second-dialogue");
    secondDialogue.mode = {
      ...firstDialogue.mode,
      current: { kind: "line", speaker: "B", text: "second item dialogue" },
      queueToken: { sceneId: "scene_second", queueGen: 3, cursor: 0 },
    };
    const firstNotification = {
      key: "evidence:first",
      kind: "evidence" as const,
      record: {
        id: "first",
        name: "First",
        description: "First item.",
        details: "",
        imageAssetId: null,
        onReexamine: null,
        collectedInChapterId: "chapter_1",
        collectedInSceneId: "scene_first",
      },
    };
    const secondNotification = {
      ...firstNotification,
      key: "evidence:second",
      record: {
        ...firstNotification.record,
        id: "second",
        name: "Second",
        description: "Second item.",
      },
    };
    const client = await loadGameClient(previous);
    mocks.invoke
      .mockResolvedValueOnce(firstDialogue)
      .mockResolvedValueOnce(secondDialogue)
      .mockResolvedValueOnce(state("after-dialogue"));
    mocks.inferAcquisitionNotifications
      .mockReturnValueOnce([firstNotification])
      .mockReturnValueOnce([secondNotification])
      .mockReturnValueOnce([]);
    mocks.inferGameplaySfxEvents.mockReturnValue([]);

    await client.inspectHotspot("first");
    await client.advanceDialogue({
      sceneId: "scene_first",
      queueGen: 2,
      cursor: 1,
    });

    expect(mocks.acquisitionEnqueue).toHaveBeenCalledExactlyOnceWith([
      firstNotification,
    ]);

    await client.advanceDialogue({
      sceneId: "scene_second",
      queueGen: 3,
      cursor: 0,
    });

    expect(mocks.acquisitionEnqueue).toHaveBeenCalledWith([secondNotification]);
  });

  it("flushes pending acquisitions when a non-advance command leaves dialogue", async () => {
    // Covers the `if (next.mode.type !== "dialogue") flushPendingAcquisitions()`
    // branch in enqueueAcquisitions (game-client.svelte.ts): a notification
    // buffered while a prior command returned dialogue must be flushed when a
    // subsequent non-advance_dialogue command (here inspectHotspot) returns a
    // non-dialogue mode, without waiting for an advance_dialogue to finish the
    // queue.
    const previous = state("previous");
    const dialogue = state("dialogue");
    dialogue.mode = {
      type: "dialogue",
      current: { kind: "line", speaker: "A", text: "item dialogue" },
      queueRemaining: 0,
      sceneTag: null,
      queueToken: { sceneId: "scene_dialogue", queueGen: 2, cursor: 1 },
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
      crossExamLineId: null,
    };
    const afterExplore = state("after-explore");
    const notification = {
      key: "evidence:receipt",
      kind: "evidence" as const,
      record: {
        id: "receipt",
        name: "Receipt",
        description: "Timestamp circled.",
        details: "",
        imageAssetId: null,
        onReexamine: null,
        collectedInChapterId: "chapter_1",
        collectedInSceneId: "scene_dialogue",
      },
    };
    const client = await loadGameClient(previous);
    mocks.invoke
      .mockResolvedValueOnce(dialogue)
      .mockResolvedValueOnce(afterExplore);
    mocks.inferAcquisitionNotifications
      .mockReturnValueOnce([notification])
      .mockReturnValueOnce([]);
    mocks.inferGameplaySfxEvents.mockReturnValue([]);

    // First inspectHotspot returns dialogue — the notification is buffered,
    // not enqueued.
    await client.inspectHotspot("receipt");
    expect(mocks.acquisitionEnqueue).not.toHaveBeenCalled();

    // A second non-advance command returns a non-dialogue mode, flushing the
    // buffered notification via the line-117 branch (not via advance_dialogue).
    await client.inspectHotspot("other");
    expect(mocks.acquisitionEnqueue).toHaveBeenCalledExactlyOnceWith([
      notification,
    ]);
  });

  it("commits the new state and does not rethrow when SFX playback throws", async () => {
    const previous = state("previous");
    const next = state("next");
    const event: GameplaySfxEvent = "story:usb-insert";
    const client = await loadGameClient(previous);

    mocks.invoke.mockResolvedValueOnce(next);
    mocks.inferGameplaySfxEvents.mockReturnValueOnce([event]);
    mocks.playGameplaySfxEvent.mockImplementationOnce(() => {
      throw new Error("audio backend exploded");
    });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // SFX is a non-essential side effect: the error must be swallowed so the
    // game-state update (already committed) is not rolled back into the caller.
    await expect(client.inspectHotspot("receipt")).resolves.toBeUndefined();

    expect(client.gameState.value?.scene.id).toBe(next.scene.id);
    expect(mocks.playGameplaySfxEvent).toHaveBeenCalledExactlyOnceWith(event);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not infer or play SFX when a command rejects through runCommand", async () => {
    const previous = state("previous");
    const client = await loadGameClient(previous);
    const capturedPrevious = client.gameState.value;

    mocks.invoke.mockRejectedValueOnce({
      code: "failed",
      message: "Command failed.",
    });

    await client.inspectHotspot("receipt");

    expect(client.gameState.value).toBe(capturedPrevious);
    expect(client.gameState.error).toBe("Command failed.");
    expect(mocks.inferAcquisitionNotifications).not.toHaveBeenCalled();
    expect(mocks.acquisitionEnqueue).not.toHaveBeenCalled();
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();
    expect(mocks.playGameplaySfxEvent).not.toHaveBeenCalled();
  });

  it("keeps the committed state when acquisition inference throws", async () => {
    const previous = state("previous");
    const next = state("next");
    const client = await loadGameClient(previous);
    mocks.invoke.mockResolvedValueOnce(next);
    mocks.inferAcquisitionNotifications.mockImplementationOnce(() => {
      throw new Error("inventory contract drift");
    });
    mocks.inferGameplaySfxEvents.mockReturnValueOnce([]);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(client.inspectHotspot("receipt")).resolves.toBeUndefined();

    expect(client.gameState.value).toEqual(next);
    expect(mocks.acquisitionEnqueue).not.toHaveBeenCalled();
    expect(mocks.inferGameplaySfxEvents).toHaveBeenCalledExactlyOnceWith(
      previous,
      next,
      "inspect_hotspot",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[AcquisitionPopup] inference failed for inspect_hotspot",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("clears pending acquisitions before resetting the game", async () => {
    const client = await loadGameClient(state("previous"));
    const next = state("reset");
    mocks.invoke.mockResolvedValueOnce(next);
    mocks.inferGameplaySfxEvents.mockReturnValueOnce([]);

    await client.resetGame();

    expect(mocks.acquisitionClear).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "reset_game",
      undefined,
    );
  });

  it("does not infer or play SFX when a command returns null", async () => {
    const previous = state("previous");
    const client = await loadGameClient(previous);
    const capturedPrevious = client.gameState.value;

    mocks.invoke.mockResolvedValueOnce(null);

    await client.inspectHotspot("receipt");

    expect(client.gameState.value).toBe(capturedPrevious);
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();
    expect(mocks.playGameplaySfxEvent).not.toHaveBeenCalled();
  });

  it("suppresses concurrent in-flight commands so SFX dispatch is not duplicated", async () => {
    const previous = state("previous");
    const next = state("next");
    const event: GameplaySfxEvent = "story:usb-insert";
    const client = await loadGameClient(previous);
    const capturedPrevious = client.gameState.value;
    let resolveInvoke!: (value: GameStateView) => void;

    mocks.invoke.mockReturnValueOnce(
      new Promise<GameStateView>((resolve) => {
        resolveInvoke = resolve;
      }),
    );
    mocks.inferGameplaySfxEvents.mockReturnValueOnce([event]);

    const first = client.inspectHotspot("receipt");
    const second = client.inspectHotspot("ignored");

    await expect(second).resolves.toBeUndefined();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("inspect_hotspot", {
      hotspotId: "receipt",
    });
    expect(mocks.playGameplaySfxEvent).not.toHaveBeenCalled();

    resolveInvoke(next);
    await first;

    expect(client.gameState.value?.scene.id).toBe(next.scene.id);
    expect(mocks.inferGameplaySfxEvents).toHaveBeenCalledExactlyOnceWith(
      capturedPrevious,
      next,
      "inspect_hotspot",
    );
    expect(mocks.playGameplaySfxEvent).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("passes the pre-command state to SFX inference after updating to the next state", async () => {
    const previous = state("previous");
    const next = state("next");
    const client = await loadGameClient(previous);
    const capturedPrevious = client.gameState.value;

    mocks.invoke.mockResolvedValueOnce(next);
    mocks.inferGameplaySfxEvents.mockImplementationOnce(
      (
        previousArg: GameStateView | null,
        nextArg: GameStateView | null,
        command: GameplayCommandName,
      ): GameplaySfxEvent[] => {
        expect(client.gameState.value?.scene.id).toBe(next.scene.id);
        expect(previousArg).toBe(capturedPrevious);
        expect(previousArg).not.toBe(client.gameState.value);
        expect(previousArg?.scene.id).toBe(previous.scene.id);
        expect(nextArg).toBe(next);
        expect(command).toBe("advance_dialogue");
        return [];
      },
    );

    await client.advanceDialogue({
      sceneId: "scene_previous",
      queueGen: 1,
      cursor: 0,
    });

    expect(mocks.inferGameplaySfxEvents).toHaveBeenCalledTimes(1);
  });
});

describe("game client scene navigation commands", () => {
  it("requests the scene navigation index without SFX inference", async () => {
    const client = await loadGameClient(state("previous"));
    const index = {
      chapters: [
        {
          id: "chapter_1",
          title: "Chapter 1",
          index: 0,
          scenes: [
            {
              id: "scene_0",
              title: "Opening",
              type: "linear" as const,
              index: 0,
            },
          ],
        },
      ],
    };
    mocks.invoke.mockResolvedValueOnce(index);

    await expect(client.listScenes()).resolves.toEqual(index);

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("list_scenes");
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();
  });

  it("returns null on failure without clearing or writing gameState.error", async () => {
    // listScenes owns its own error surface (the SceneNavigationPanel's
    // error/retry UI) and must NOT route through runCommand, which would
    // write gameState.error (double-reporting via the global ErrorBanner) and
    // clobber a pre-existing game-command error on every call.
    const client = await loadGameClient(state("previous"));
    client.gameState.error = "prior game error";
    mocks.invoke.mockRejectedValueOnce({ code: "boom", message: "index down" });

    await expect(client.listScenes()).resolves.toBeNull();

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("list_scenes");
    // The pre-existing game error must survive a scene-index query failure.
    expect(client.gameState.error).toBe("prior game error");
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();
  });

  it("jumps to a scene without SFX inference", async () => {
    const previous = state("previous");
    const next = state("jumped");
    const client = await loadGameClient(previous);
    mocks.invoke.mockResolvedValueOnce(next);

    await client.jumpToScene("chapter_1", "scene_0");

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("jump_to_scene", {
      chapterId: "chapter_1",
      sceneId: "scene_0",
    });
    expect(client.gameState.value).toEqual(next);
    expect(mocks.acquisitionClear).toHaveBeenCalledTimes(1);
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();
  });

  it("does not mutate state when scene jump fails", async () => {
    const previous = state("previous");
    const client = await loadGameClient(previous);
    const capturedPrevious = client.gameState.value;
    mocks.invoke.mockRejectedValueOnce({
      code: "unknownScene",
      message: "Scene missing.",
    });

    await client.jumpToScene("chapter_1", "missing");

    expect(client.gameState.value).toBe(capturedPrevious);
    expect(client.gameState.error).toBe("Scene missing.");
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();
  });

  it("suppresses scene jumps while another command is in flight", async () => {
    // Covers the `if (gameState.inFlight) return;` guard in jumpToScene
    // (mirrors returnToMainMenu). With inFlight already true, jumpToScene must
    // short-circuit without invoking the backend, touching state, or wiping
    // acquisition state — the in-flight command may still enqueue popups.
    const previous = state("previous");
    const client = await loadGameClient(previous);
    client.gameState.inFlight = true;
    const capturedPrevious = client.gameState.value;

    await client.jumpToScene("chapter_1", "scene_0");

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(client.gameState.value).toBe(capturedPrevious);
    expect(client.gameState.inFlight).toBe(true);
    expect(mocks.acquisitionClear).not.toHaveBeenCalled();
  });

  it("suppresses startGame while another command is in flight", async () => {
    // Covers the `if (gameState.inFlight) return;` guard in startGame.
    // With inFlight true, startGame must not wipe acquisition state or invoke
    // the backend — the in-flight command may still commit a fresh view.
    const previous = state("previous");
    const client = await loadGameClient(previous);
    client.gameState.inFlight = true;
    const capturedPrevious = client.gameState.value;

    await client.startGame();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(client.gameState.value).toBe(capturedPrevious);
    expect(client.gameState.inFlight).toBe(true);
    expect(mocks.acquisitionClear).not.toHaveBeenCalled();
  });

  it("suppresses resetGame while another command is in flight", async () => {
    // Covers the `if (gameState.inFlight) return;` guard in resetGame.
    // With inFlight true, resetGame must not wipe acquisition state or invoke
    // the backend — the in-flight command may still commit a fresh view.
    const previous = state("previous");
    const client = await loadGameClient(previous);
    client.gameState.inFlight = true;
    const capturedPrevious = client.gameState.value;

    await client.resetGame();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(client.gameState.value).toBe(capturedPrevious);
    expect(client.gameState.inFlight).toBe(true);
    expect(mocks.acquisitionClear).not.toHaveBeenCalled();
  });

  it("returnToMainMenu no-ops while a command is in flight", async () => {
    // Covers the `if (gameState.inFlight) return;` guard in
    // returnToMainMenu. With inFlight true, the state must not be cleared
    // (an in-flight command may still commit a fresh view).
    const previous = state("previous");
    const client = await loadGameClient(previous);
    client.gameState.inFlight = true;
    const capturedPrevious = client.gameState.value;

    client.returnToMainMenu();

    expect(client.gameState.value).toBe(capturedPrevious);
    expect(client.gameState.inFlight).toBe(true);
    expect(mocks.acquisitionClear).not.toHaveBeenCalled();
  });

  it("returnToMainMenu clears state when no command is in flight", async () => {
    const previous = state("previous");
    const client = await loadGameClient(previous);

    client.returnToMainMenu();

    expect(client.gameState.value).toBeNull();
    expect(client.gameState.error).toBeNull();
    expect(client.gameState.loading).toBe(false);
    expect(client.gameState.inFlight).toBe(false);
    expect(mocks.acquisitionClear).toHaveBeenCalledTimes(1);
  });
});

describe("game client interrogation commands", () => {
  // Each interrogation command is a thin wrapper over dispatchGameCommand
  // that forwards a fixed-shape args payload to a named Rust command. The
  // assertions pin both the command name and the snake_case arg keys Tauri
  // expects across the bridge, so a rename on either side fails loudly here.
  async function resolveAfterCall(
    client: GameClientModule,
    fn: () => Promise<void>,
  ): Promise<GameStateView> {
    const next = state("next");
    let resolveInvoke!: (value: GameStateView) => void;
    mocks.invoke.mockReturnValueOnce(
      new Promise<GameStateView>((resolve) => {
        resolveInvoke = resolve;
      }),
    );
    mocks.inferGameplaySfxEvents.mockReturnValueOnce([]);

    const pending = fn();
    // The dispatch must have already invoked the backend before resolving.
    await Promise.resolve();
    resolveInvoke(next);
    await pending;
    return next;
  }

  it("askInterrogationQuestion forwards ask_interrogation_question with questionId", async () => {
    const client = await loadGameClient(state("previous"));
    const next = await resolveAfterCall(client, () =>
      client.askInterrogationQuestion("q_alibi"),
    );
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "ask_interrogation_question",
      { questionId: "q_alibi" },
    );
    expect(client.gameState.value?.scene.id).toBe(next.scene.id);
  });

  it("challengeInterrogationLine forwards challenge_interrogation_line with lineId", async () => {
    const client = await loadGameClient(state("previous"));
    await resolveAfterCall(client, () =>
      client.challengeInterrogationLine("l_deny"),
    );
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "challenge_interrogation_line",
      { lineId: "l_deny" },
    );
  });

  it("presentInterrogationEvidence forwards present_interrogation_evidence with line/itemKind/itemId", async () => {
    const client = await loadGameClient(state("previous"));
    await resolveAfterCall(client, () =>
      client.presentInterrogationEvidence("l_deny", "evidence", "cleaning_log"),
    );
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "present_interrogation_evidence",
      {
        lineId: "l_deny",
        itemKind: "evidence",
        itemId: "cleaning_log",
      },
    );
  });

  it("withdrawInterrogation forwards withdraw_interrogation with an empty args object", async () => {
    const client = await loadGameClient(state("previous"));
    await resolveAfterCall(client, () => client.withdrawInterrogation());
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "withdraw_interrogation",
      {},
    );
  });

  it("resumeInterrogationTestimony forwards resume_interrogation_testimony with an empty args object", async () => {
    const client = await loadGameClient(state("previous"));
    await resolveAfterCall(client, () => client.resumeInterrogationTestimony());
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "resume_interrogation_testimony",
      {},
    );
  });

  it("completeInterrogationPhase forwards complete_interrogation_phase with an empty args object", async () => {
    const client = await loadGameClient(state("previous"));
    await resolveAfterCall(client, () => client.completeInterrogationPhase());
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "complete_interrogation_phase",
      {},
    );
  });
});
