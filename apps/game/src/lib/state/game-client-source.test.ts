import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GameplayCommandName,
  GameplaySfxEvent,
} from "$lib/audio/sfx-events";
import type { GameplayCommandResultView } from "$lib/persistence/types";
import type { E2eCheckpointProjection } from "$lib/e2e/checkpoints";
import { MUTATING_GAMEPLAY_COMMANDS } from "./game-client.svelte";
import type { GameStateView, QuestionView } from "./types";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  invokePersistenceCommand: vi.fn(),
  pinThumbnailCaptureDeadline: vi.fn(),
  reportSaveThumbnailFailure: vi.fn(),
  submitSaveThumbnail: vi.fn(),
  tick: vi.fn(),
  inferGameplaySfxEvents: vi.fn(),
  invoke: vi.fn(),
  playGameplaySfxEvent: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (
    command: string,
    args?: Record<string, unknown>,
    options?: unknown,
  ) => {
    const response =
      options === undefined
        ? args === undefined
          ? await mocks.invoke(command)
          : await mocks.invoke(command, args)
        : await mocks.invoke(command, args, options);
    if (
      MUTATING_GAMEPLAY_COMMANDS.has(command) &&
      response &&
      typeof response === "object" &&
      !("state" in response)
    ) {
      return { state: response, thumbnailCapture: null };
    }
    return response;
  },
}));

vi.mock("$lib/audio/gameplay-audio-runtime.svelte", () => ({
  playGameplaySfxEvent: mocks.playGameplaySfxEvent,
}));

vi.mock("$lib/audio/sfx-events", () => ({
  inferGameplaySfxEvents: mocks.inferGameplaySfxEvents,
}));

vi.mock("$lib/persistence/commands", () => ({
  asGameError: (error: unknown) => error,
  invokePersistenceCommand: mocks.invokePersistenceCommand,
  reportSaveThumbnailFailure: mocks.reportSaveThumbnailFailure,
  submitSaveThumbnail: mocks.submitSaveThumbnail,
}));

vi.mock("$lib/persistence/thumbnail-capture", () => ({
  gameplayThumbnailCapture: { capture: mocks.capture },
  pinThumbnailCaptureDeadline: mocks.pinThumbnailCaptureDeadline,
}));

vi.mock("svelte", async (importOriginal) => {
  const actual = await importOriginal<typeof import("svelte")>();
  return { ...actual, tick: mocks.tick };
});

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
      summary: "",
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
    story: { facts: [], questions: [], objectives: [], authorizations: [] },
    dialogueHistory: [],
    pendingAcquisition: null,
  };
}

function wrapped(
  next: GameStateView,
  capture: GameplayCommandResultView["thumbnailCapture"] = null,
): GameplayCommandResultView {
  return { state: next, thumbnailCapture: capture };
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
  mocks.capture.mockReset().mockResolvedValue({
    type: "available",
    bytes: new Uint8Array([1, 2, 3]),
  });
  mocks.invokePersistenceCommand.mockReset();
  mocks.pinThumbnailCaptureDeadline
    .mockReset()
    .mockImplementation((request) => request);
  mocks.reportSaveThumbnailFailure
    .mockReset()
    .mockResolvedValue({ type: "idle" });
  mocks.submitSaveThumbnail.mockReset().mockResolvedValue({ type: "idle" });
  mocks.tick.mockReset().mockResolvedValue(undefined);
  mocks.inferGameplaySfxEvents.mockReset().mockReturnValue([]);
  mocks.invoke.mockReset();
  mocks.playGameplaySfxEvent.mockReset();
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.unstubAllEnvs();
});

describe("game client audio events", () => {
  it("accepts an applied question resolver without candidate resolver ids", async () => {
    const resolvedQuestion: QuestionView = {
      id: "who_sent_the_message",
      label: "Who sent the message?",
      summary: "The sender has been identified.",
      status: "resolved",
      resolvedByFactId: "fact_sender_identity",
    };
    type PublicQuestion = GameStateView["story"]["questions"][number];
    type HasCandidateResolvers =
      "resolvedByFactIds" extends keyof PublicQuestion ? true : false;
    const hasCandidateResolvers: HasCandidateResolvers = false;
    const previous = state("previous");
    const next = state("next");
    next.story.questions = [resolvedQuestion];
    const client = await loadGameClient(previous);
    mocks.invoke.mockResolvedValueOnce(next);
    mocks.inferGameplaySfxEvents.mockReturnValueOnce([]);

    await client.inspectHotspot("receipt");

    expect(client.gameState.value?.story.questions).toEqual([resolvedQuestion]);
    expect(hasCandidateResolvers).toBe(false);
  });

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
    expect(mocks.inferGameplaySfxEvents).not.toHaveBeenCalled();
    expect(mocks.playGameplaySfxEvent).not.toHaveBeenCalled();
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

describe("get_state persistence exclusivity", () => {
  it("swallows only the known busy code during acquisition saving", async () => {
    const client = await loadGameClient(state("previous"));
    const previous = client.gameState.value;
    client.gameState.error = "existing banner";
    mocks.invokePersistenceCommand.mockRejectedValueOnce({
      code: "persistenceOperationInProgress",
      message: "Persistence is busy.",
    });

    await expect(
      client.refreshGameState({
        acquisitionPhase: { type: "saving", slow: false },
        exitStatus: { type: "idle" },
      }),
    ).resolves.toBe(previous);

    expect(client.gameState.value).toBe(previous);
    expect(client.gameState.error).toBe("existing banner");
    expect(mocks.invokePersistenceCommand).toHaveBeenCalledExactlyOnceWith(
      "get_state",
    );
  });

  it("swallows only the known busy code while exit status is saving", async () => {
    const client = await loadGameClient(state("previous"));
    const previous = client.gameState.value;
    mocks.invokePersistenceCommand.mockRejectedValueOnce({
      code: "persistenceOperationInProgress",
      message: "Persistence is busy.",
    });

    await expect(
      client.refreshGameState({
        acquisitionPhase: { type: "idle" },
        exitStatus: { type: "saving" },
      }),
    ).resolves.toBe(previous);

    expect(client.gameState.value).toBe(previous);
    expect(client.gameState.error).toBeNull();
    expect(mocks.invokePersistenceCommand).toHaveBeenCalledTimes(1);
  });

  it("shows the busy error outside the exact local saving intervals", async () => {
    const client = await loadGameClient(state("previous"));
    const previous = client.gameState.value;
    mocks.invokePersistenceCommand.mockRejectedValueOnce({
      code: "persistenceOperationInProgress",
      message: "Persistence is busy.",
    });

    await expect(
      client.refreshGameState({
        acquisitionPhase: { type: "capturing" },
        exitStatus: { type: "idle" },
      }),
    ).resolves.toBeNull();

    expect(client.gameState.value).toBe(previous);
    expect(client.gameState.error).toBe("Persistence is busy.");
  });

  it("shows every other typed error even during a local saving interval", async () => {
    const client = await loadGameClient();
    mocks.invokePersistenceCommand.mockRejectedValueOnce({
      code: "saveReadFailed",
      message: "Save could not be read.",
      failureToken: "opaque-token",
    });

    await expect(
      client.refreshGameState({
        acquisitionPhase: { type: "saving", slow: true },
        exitStatus: { type: "saving" },
      }),
    ).resolves.toBeNull();

    expect(client.gameState.error).toBe("Save could not be read.");
    expect(mocks.invokePersistenceCommand).toHaveBeenCalledTimes(1);
  });

  it("accepts a successful read-only bare state", async () => {
    const next = state("next");
    const client = await loadGameClient();
    mocks.invokePersistenceCommand.mockResolvedValueOnce(next);

    await expect(
      client.refreshGameState({
        acquisitionPhase: { type: "idle" },
        exitStatus: { type: "idle" },
      }),
    ).resolves.toEqual(next);

    expect(client.gameState.value).toEqual(next);
    expect(client.gameState.value).not.toHaveProperty("state");
  });
});

describe("game client persistence response boundary", () => {
  it("captures the autosave ticket returned by an advancing dialogue command", async () => {
    const next = state("next");
    const client = await loadGameClient(state("previous"));
    const request = { ticket: "ticket-dialogue-autosave", timeoutMs: 725 };
    mocks.invoke.mockResolvedValueOnce(wrapped(next, request));

    await client.advanceDialogue({
      sceneId: "scene_previous",
      queueGen: 1,
      cursor: 0,
    });

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("advance_dialogue", {
      expected: {
        sceneId: "scene_previous",
        queueGen: 1,
        cursor: 0,
      },
    });
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(request);
    expect(mocks.submitSaveThumbnail).toHaveBeenCalledExactlyOnceWith(
      "ticket-dialogue-autosave",
      new Uint8Array([1, 2, 3]),
    );
  });

  it("unwraps the gameplay-command result before state and SFX consumers see it", async () => {
    const previous = state("previous");
    const next = state("next");
    const client = await loadGameClient(previous);
    mocks.invoke.mockResolvedValueOnce(
      wrapped(next, { ticket: "ticket-game", timeoutMs: 725 }),
    );

    await client.inspectHotspot("receipt");

    expect(client.gameState.value).toEqual(next);
    expect(client.gameState.value).not.toHaveProperty("state");
    expect(mocks.inferGameplaySfxEvents).toHaveBeenCalledExactlyOnceWith(
      previous,
      next,
      "inspect_hotspot",
    );
  });

  it("uses the same unwrap boundary for state-changing navigation", async () => {
    const next = state("jumped");
    const client = await loadGameClient(state("previous"));
    mocks.invoke.mockResolvedValueOnce(
      wrapped(next, { ticket: "ticket-jump", timeoutMs: 725 }),
    );

    await client.jumpToScene("chapter_1", "scene_2");

    expect(client.gameState.value).toEqual(next);
    expect(client.gameState.value).not.toHaveProperty("state");
  });

  it("pins one deadline at receipt and waits for tick before capture", async () => {
    const next = state("next");
    const client = await loadGameClient();
    let releaseTick!: () => void;
    mocks.tick.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseTick = resolve;
      }),
    );
    mocks.capture.mockImplementationOnce(async () => {
      expect(client.gameState.value).toEqual(next);
      return { type: "available", bytes: new Uint8Array([4, 5, 6]) };
    });
    const request = { ticket: "ticket-tick", timeoutMs: 725 };
    mocks.invoke.mockResolvedValueOnce(wrapped(next, request));

    const command = client.inspectHotspot("receipt");
    await vi.waitFor(() =>
      expect(mocks.pinThumbnailCaptureDeadline).toHaveBeenCalledExactlyOnceWith(
        request,
      ),
    );
    await vi.waitFor(() => expect(mocks.tick).toHaveBeenCalledTimes(1));
    expect(mocks.capture).not.toHaveBeenCalled();

    releaseTick();
    await command;

    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(request);
    expect(mocks.submitSaveThumbnail).toHaveBeenCalledExactlyOnceWith(
      "ticket-tick",
      new Uint8Array([4, 5, 6]),
    );
  });

  it("discards a capture result after the committed state identity changes", async () => {
    const next = state("next");
    const client = await loadGameClient();
    let finishCapture!: (result: {
      type: "available";
      bytes: Uint8Array;
    }) => void;
    mocks.capture.mockReturnValueOnce(
      new Promise((resolve) => {
        finishCapture = resolve;
      }),
    );
    mocks.invoke.mockResolvedValueOnce(
      wrapped(next, { ticket: "ticket-stale", timeoutMs: 725 }),
    );

    const command = client.inspectHotspot("receipt");
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1));
    client.gameState.value = state("replacement");
    finishCapture({
      type: "available",
      bytes: new Uint8Array([7, 8, 9]),
    });
    await command;

    expect(mocks.submitSaveThumbnail).not.toHaveBeenCalled();
    expect(mocks.reportSaveThumbnailFailure).not.toHaveBeenCalled();
  });

  it("reports terminal capture unavailability without rejecting committed gameplay", async () => {
    const next = state("next");
    const client = await loadGameClient();
    mocks.capture.mockResolvedValueOnce({
      type: "unavailable",
      reason: "fonts did not become ready",
    });
    mocks.invoke.mockResolvedValueOnce(
      wrapped(next, { ticket: "ticket-unavailable", timeoutMs: 725 }),
    );

    await expect(client.inspectHotspot("receipt")).resolves.toBeUndefined();

    expect(client.gameState.value).toEqual(next);
    expect(mocks.reportSaveThumbnailFailure).toHaveBeenCalledExactlyOnceWith(
      "ticket-unavailable",
    );
  });

  it("reports capture exceptions and absorbs report failures after committing state", async () => {
    const next = state("next");
    const client = await loadGameClient();
    mocks.capture.mockRejectedValueOnce(new Error("canvas failed"));
    mocks.reportSaveThumbnailFailure.mockRejectedValueOnce(
      new Error("ticket expired"),
    );
    mocks.invoke.mockResolvedValueOnce(
      wrapped(next, { ticket: "ticket-error", timeoutMs: 725 }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(client.inspectHotspot("receipt")).resolves.toBeUndefined();

    expect(client.gameState.value).toEqual(next);
    expect(mocks.reportSaveThumbnailFailure).toHaveBeenCalledExactlyOnceWith(
      "ticket-error",
    );
    expect(warn).toHaveBeenCalledWith(
      "[Persistence] Thumbnail capture failed",
      expect.any(Error),
    );
    expect(warn).toHaveBeenCalledWith(
      "[Persistence] Thumbnail failure report failed",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("keeps read-only command responses bare", async () => {
    const client = await loadGameClient();
    const index = {
      chapters: [
        {
          id: "chapter_1",
          title: "Chapter 1",
          summary: "",
          index: 0,
          scenes: [
            {
              id: "scene_1",
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
  });

  it("renders an actionable error message without destroying its typed token", async () => {
    const client = await loadGameClient();
    const actionable = {
      code: "saveWriteFailed",
      message: "Save could not be written.",
      failureToken: "00000000-0000-4000-8000-000000000000",
    };
    mocks.invoke.mockRejectedValueOnce(actionable);

    await client.inspectHotspot("receipt");

    expect(client.gameState.error).toBe(actionable.message);
    expect(actionable.failureToken).toBe(
      "00000000-0000-4000-8000-000000000000",
    );
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
          summary: "",
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
  });

  it("returnToMainMenu clears state when no command is in flight", async () => {
    const previous = state("previous");
    const client = await loadGameClient(previous);

    client.returnToMainMenu();

    expect(client.gameState.value).toBeNull();
    expect(client.gameState.error).toBeNull();
    expect(client.gameState.loading).toBe(false);
    expect(client.gameState.inFlight).toBe(false);
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

describe("game client analysis commands", () => {
  it("records a selection-dispatch failure in the shared game error state", async () => {
    const next = state("selection-failure");
    const client = await loadGameClient(state("previous"));
    mocks.invoke.mockResolvedValueOnce(wrapped(next));
    mocks.tick.mockRejectedValueOnce(new Error("selection apply failed"));

    await expect(
      client.setAnalysisSelection("board", ["card"]),
    ).resolves.toBeUndefined();

    expect(client.gameState.value).toEqual(next);
    expect(client.gameState.error).toBe("selection apply failed");
    expect(client.gameState.inFlight).toBe(false);
  });

  it("records a submission-dispatch failure in the shared game error state", async () => {
    const next = state("submission-failure");
    const client = await loadGameClient(state("previous"));
    mocks.invoke.mockResolvedValueOnce(wrapped(next));
    mocks.tick.mockRejectedValueOnce(new Error("submission apply failed"));

    await expect(
      client.submitAnalysisSelection("board"),
    ).resolves.toBeUndefined();

    expect(client.gameState.value).toEqual(next);
    expect(client.gameState.error).toBe("submission apply failed");
    expect(client.gameState.inFlight).toBe(false);
  });
});

describe("loadE2eCheckpointThroughClient packaged checkpoint bridge", () => {
  const CHECKPOINT_ID = "chapter-1-investigation-explore";
  const projection = {
    chapterId: "chapter_1",
    sceneId: "scene_1",
    mode: "explore",
    dialogue: null,
    sublocationId: "main",
    evidenceIds: [],
    statementIds: [],
    objectives: [],
    authorizationIds: [],
    pendingAcquisition: null,
    sceneNavigationEligible: false,
    durableRevision: 1,
  } as E2eCheckpointProjection;

  function checkpointResult(
    generation: number,
    next: GameStateView,
  ): {
    generation: number;
    state: GameStateView;
    projection: E2eCheckpointProjection;
  } {
    return { generation, state: next, projection };
  }

  async function loadE2eClient(
    initialState: GameStateView | null = state("initial"),
  ): Promise<GameClientModule> {
    vi.stubEnv("VITE_E2E", "true");
    return loadGameClient(initialState);
  }

  it("throws when packaged checkpoints are unavailable in this build", async () => {
    // VITE_E2E is unset in the unit-test environment by default.
    const client = await loadGameClient(state("initial"));

    await expect(
      client.loadE2eCheckpointThroughClient(CHECKPOINT_ID, 0, {
        applyProjection: vi.fn(),
        publishGeneration: vi.fn(),
      }),
    ).rejects.toThrow("Packaged checkpoints are unavailable in this build.");

    // The guard throws before the try/finally, so it must not touch state.
    expect(client.gameState.inFlight).toBe(false);
    expect(client.gameState.loading).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("refuses to load while another command is already in flight", async () => {
    const client = await loadE2eClient(state("initial"));
    client.gameState.inFlight = true;
    client.gameState.loading = true;

    await expect(
      client.loadE2eCheckpointThroughClient(CHECKPOINT_ID, 0, {
        applyProjection: vi.fn(),
        publishGeneration: vi.fn(),
      }),
    ).rejects.toThrow("A game command is already in progress.");

    // The guard throws before the try/finally, so the existing in-flight
    // command's flags must survive (no clobbering).
    expect(client.gameState.inFlight).toBe(true);
    expect(client.gameState.loading).toBe(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("applies state, projection, and generation on a successful load", async () => {
    const next = state("checkpoint");
    const client = await loadE2eClient(state("initial"));
    const applyProjection = vi.fn();
    const publishGeneration = vi.fn();
    mocks.invoke.mockResolvedValueOnce(checkpointResult(7, next));

    const result = await client.loadE2eCheckpointThroughClient(
      CHECKPOINT_ID,
      6,
      { applyProjection, publishGeneration },
    );

    expect(result).toEqual(checkpointResult(7, next));
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "e2e_load_checkpoint",
      { id: CHECKPOINT_ID },
    );
    expect(client.gameState.value).toEqual(next);
    expect(client.gameState.error).toBeNull();
    expect(client.gameState.inFlight).toBe(false);
    expect(client.gameState.loading).toBe(false);
    expect(applyProjection).toHaveBeenCalledExactlyOnceWith(projection);
    expect(publishGeneration).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("records the backend load failure and recovers inFlight/loading", async () => {
    const client = await loadE2eClient(state("initial"));
    const applyProjection = vi.fn();
    const publishGeneration = vi.fn();
    mocks.invoke.mockRejectedValueOnce({
      code: "checkpointMissing",
      message: "Checkpoint not found.",
    });

    await expect(
      client.loadE2eCheckpointThroughClient(CHECKPOINT_ID, 0, {
        applyProjection,
        publishGeneration,
      }),
    ).rejects.toThrow("Checkpoint not found.");

    expect(client.gameState.error).toBe("Checkpoint not found.");
    expect(client.gameState.inFlight).toBe(false);
    expect(client.gameState.loading).toBe(false);
    expect(applyProjection).not.toHaveBeenCalled();
    expect(publishGeneration).not.toHaveBeenCalled();
  });

  it("records a non-advancing generation and recovers inFlight/loading", async () => {
    const next = state("checkpoint");
    const client = await loadE2eClient(state("initial"));
    const applyProjection = vi.fn();
    const publishGeneration = vi.fn();
    // Backend returns a generation that does not advance past the previous one.
    mocks.invoke.mockResolvedValueOnce(checkpointResult(5, next));

    await expect(
      client.loadE2eCheckpointThroughClient(CHECKPOINT_ID, 5, {
        applyProjection,
        publishGeneration,
      }),
    ).rejects.toThrow("Checkpoint generation 5 did not advance past 5.");

    expect(client.gameState.error).toBe(
      "Checkpoint generation 5 did not advance past 5.",
    );
    expect(client.gameState.inFlight).toBe(false);
    expect(client.gameState.loading).toBe(false);
    // applyState runs after the generation check, so neither hook fires.
    expect(applyProjection).not.toHaveBeenCalled();
    expect(publishGeneration).not.toHaveBeenCalled();
  });

  it("records an applyState failure and recovers inFlight/loading", async () => {
    const next = state("checkpoint");
    const client = await loadE2eClient(state("initial"));
    const applyProjection = vi.fn();
    const publishGeneration = vi.fn();
    mocks.invoke.mockResolvedValueOnce(checkpointResult(7, next));
    // applyState awaits applyGameplayCommandResult, which awaits tick. Rejecting
    // the first tick call fails applyState before projection settlement.
    mocks.tick.mockRejectedValueOnce(new Error("applyState tick failed"));

    await expect(
      client.loadE2eCheckpointThroughClient(CHECKPOINT_ID, 6, {
        applyProjection,
        publishGeneration,
      }),
    ).rejects.toThrow("applyState tick failed");

    expect(client.gameState.error).toBe("applyState tick failed");
    expect(client.gameState.inFlight).toBe(false);
    expect(client.gameState.loading).toBe(false);
    // applyState failed before applyProjection/settleProjection/publishGeneration.
    expect(applyProjection).not.toHaveBeenCalled();
    expect(publishGeneration).not.toHaveBeenCalled();
  });

  it("records a projection settlement failure and recovers inFlight/loading", async () => {
    const next = state("checkpoint");
    const client = await loadE2eClient(state("initial"));
    const applyProjection = vi.fn();
    const publishGeneration = vi.fn();
    mocks.invoke.mockResolvedValueOnce(checkpointResult(7, next));
    // First tick resolves (applyState succeeds); second tick rejects
    // (settleProjection fails after applyProjection).
    mocks.tick.mockResolvedValueOnce(undefined);
    mocks.tick.mockRejectedValueOnce(new Error("settlement tick failed"));

    await expect(
      client.loadE2eCheckpointThroughClient(CHECKPOINT_ID, 6, {
        applyProjection,
        publishGeneration,
      }),
    ).rejects.toThrow("settlement tick failed");

    expect(client.gameState.error).toBe("settlement tick failed");
    expect(client.gameState.inFlight).toBe(false);
    expect(client.gameState.loading).toBe(false);
    // applyProjection fires before settleProjection; publishGeneration does not.
    expect(applyProjection).toHaveBeenCalledExactlyOnceWith(projection);
    expect(publishGeneration).not.toHaveBeenCalled();
  });

  it("records a generation publication failure and recovers inFlight/loading", async () => {
    const next = state("checkpoint");
    const client = await loadE2eClient(state("initial"));
    const applyProjection = vi.fn();
    const publishGeneration = vi.fn(() => {
      throw new Error("generation publication failed");
    });
    mocks.invoke.mockResolvedValueOnce(checkpointResult(7, next));

    await expect(
      client.loadE2eCheckpointThroughClient(CHECKPOINT_ID, 6, {
        applyProjection,
        publishGeneration,
      }),
    ).rejects.toThrow("generation publication failed");

    expect(client.gameState.error).toBe("generation publication failed");
    expect(client.gameState.inFlight).toBe(false);
    expect(client.gameState.loading).toBe(false);
    // State and projection were already applied; only publication threw.
    expect(client.gameState.value).toEqual(next);
    expect(applyProjection).toHaveBeenCalledExactlyOnceWith(projection);
    expect(publishGeneration).toHaveBeenCalledExactlyOnceWith(7);
  });
});
