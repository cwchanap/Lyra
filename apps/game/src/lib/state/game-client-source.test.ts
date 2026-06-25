import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GameplayCommandName,
  GameplaySfxEvent,
} from "$lib/audio/sfx-events";
import type { GameStateView } from "./types";

const mocks = vi.hoisted(() => ({
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
