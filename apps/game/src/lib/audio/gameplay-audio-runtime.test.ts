import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioPreferences } from "./audio-preferences";
import type { Mode } from "$lib/state/types";

const DEFAULTS: AudioPreferences = {
  muted: false,
  bgmVolume: 0.5,
  bgsVolume: 0.5,
  sfxVolume: 0.5,
};

type ControllerSpy = {
  preloadSfx: ReturnType<typeof vi.fn>;
  applyPreferences: ReturnType<typeof vi.fn>;
  updateLoopChannels: ReturnType<typeof vi.fn>;
  playSfx: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  const instances: ControllerSpy[] = [];
  class GameplayAudioController {
    preloadSfx = vi.fn();
    applyPreferences = vi.fn();
    updateLoopChannels = vi.fn(async () => undefined);
    playSfx = vi.fn();
    dispose = vi.fn();
    constructor() {
      instances.push(this as unknown as ControllerSpy);
    }
  }
  return {
    GameplayAudioController,
    instances,
    loadAudioPreferences: vi.fn((): AudioPreferences => ({ ...DEFAULTS })),
    saveAudioPreferences: vi.fn((): boolean => true),
    normalizeAudioPreferences: vi.fn(
      (value: AudioPreferences): AudioPreferences => value,
    ),
    assetIdForGameplaySfxEvent: vi.fn((): string | null => null),
  };
});

vi.mock("./audio-controller", () => ({
  GameplayAudioController: mocks.GameplayAudioController,
}));

vi.mock("./audio-preferences", () => ({
  DEFAULT_AUDIO_PREFERENCES: DEFAULTS,
  loadAudioPreferences: mocks.loadAudioPreferences,
  saveAudioPreferences: mocks.saveAudioPreferences,
  normalizeAudioPreferences: mocks.normalizeAudioPreferences,
}));

vi.mock("./sfx-events", () => ({
  assetIdForGameplaySfxEvent: mocks.assetIdForGameplaySfxEvent,
}));

type RuntimeModule = typeof import("./gameplay-audio-runtime.svelte");

async function loadRuntime(): Promise<RuntimeModule> {
  return (await import("./gameplay-audio-runtime.svelte")) as RuntimeModule;
}

function controller(): ControllerSpy {
  const latest = mocks.instances.at(-1);
  if (!latest) throw new Error("controller not constructed");
  return latest;
}

const exploreMode: Mode = {
  type: "explore",
  sublocationId: "main",
  backgroundAssetId: null,
  bgm: { channel: "bgm", assetId: "audio.bgm.review" },
  bgs: { channel: "bgs", assetId: "audio.bgs.rain" },
};

describe("gameplay audio runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.instances.length = 0;
    mocks.loadAudioPreferences.mockReturnValue({ ...DEFAULTS });
    mocks.loadAudioPreferences.mockClear();
    mocks.saveAudioPreferences.mockReturnValue(true);
    mocks.saveAudioPreferences.mockClear();
    mocks.normalizeAudioPreferences.mockImplementation((value) => value);
    mocks.normalizeAudioPreferences.mockClear();
    mocks.assetIdForGameplaySfxEvent.mockReturnValue(null);
    mocks.assetIdForGameplaySfxEvent.mockClear();
  });

  it("preloads the menu-confirm SFX eagerly on module init", async () => {
    mocks.assetIdForGameplaySfxEvent.mockReturnValue("audio.sfx.tick");
    await loadRuntime();
    expect(mocks.assetIdForGameplaySfxEvent).toHaveBeenCalledWith(
      "ui:menu-confirm",
    );
    expect(controller().preloadSfx).toHaveBeenCalledExactlyOnceWith(
      "audio.sfx.tick",
    );
  });

  it("normalizes, persists, and applies preference patches", async () => {
    const runtime = await loadRuntime();
    const normalized: AudioPreferences = {
      muted: true,
      bgmVolume: 0.2,
      bgsVolume: 0.3,
      sfxVolume: 0.4,
    };
    mocks.normalizeAudioPreferences.mockReturnValue(normalized);

    runtime.updateAudioPreferences({ muted: true });

    expect(mocks.normalizeAudioPreferences).toHaveBeenCalledTimes(1);
    expect(mocks.saveAudioPreferences).toHaveBeenCalledExactlyOnceWith(
      normalized,
    );
    expect(controller().applyPreferences).toHaveBeenCalledExactlyOnceWith(
      normalized,
    );
    expect(runtime.audioPreferences.muted).toBe(true);
    expect(runtime.audioPreferences.bgmVolume).toBe(0.2);
  });

  it("disposes the controller when a game-complete mode arrives", async () => {
    const runtime = await loadRuntime();
    runtime.syncGameplayAudioMode({ type: "gameComplete" });
    expect(controller().dispose).toHaveBeenCalledTimes(1);
    expect(controller().updateLoopChannels).not.toHaveBeenCalled();
  });

  it("syncs loop channels from the current mode cues", async () => {
    const runtime = await loadRuntime();
    runtime.syncGameplayAudioMode(exploreMode);
    expect(controller().updateLoopChannels).toHaveBeenCalledExactlyOnceWith(
      {
        bgm: exploreMode.bgm,
        bgs: exploreMode.bgs,
      },
      expect.objectContaining({ muted: false }),
    );
    expect(controller().dispose).not.toHaveBeenCalled();
  });

  it("plays an SFX event that resolves to an asset", async () => {
    const runtime = await loadRuntime();
    mocks.assetIdForGameplaySfxEvent.mockReturnValue("audio.sfx.tick");
    runtime.playGameplaySfxEvent("ui:menu-confirm");
    expect(controller().playSfx).toHaveBeenCalledExactlyOnceWith(
      "audio.sfx.tick",
      expect.objectContaining({ muted: false }),
    );
  });

  it("ignores SFX events without a matching asset", async () => {
    const runtime = await loadRuntime();
    runtime.playGameplaySfxEvent("ui:new-game");
    expect(controller().playSfx).not.toHaveBeenCalled();
  });

  it("disposes the controller through the explicit teardown", async () => {
    const runtime = await loadRuntime();
    runtime.disposeGameplayAudio();
    expect(controller().dispose).toHaveBeenCalledTimes(1);
  });

  it("resets preferences back to the defaults", async () => {
    const runtime = await loadRuntime();
    runtime.resetAudioPreferences();
    expect(mocks.normalizeAudioPreferences).toHaveBeenCalledWith(DEFAULTS);
    expect(controller().applyPreferences).toHaveBeenCalledWith(DEFAULTS);
    expect(mocks.saveAudioPreferences).toHaveBeenCalledWith(DEFAULTS);
  });
});
