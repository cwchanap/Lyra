import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioPreferences } from "./audio-preferences";
import type { Mode } from "$lib/state/types";

const DEFAULTS: AudioPreferences = {
  muted: false,
  bgmVolume: 0.5,
  bgsVolume: 0.5,
  sfxVolume: 0.5,
  voiceVolume: 0.9,
  voiceEnabled: true,
};

type ControllerSpy = {
  preloadSfx: ReturnType<typeof vi.fn>;
  applyPreferences: ReturnType<typeof vi.fn>;
  updateLoopChannels: ReturnType<typeof vi.fn>;
  stopLoopChannels: ReturnType<typeof vi.fn>;
  playSfx: ReturnType<typeof vi.fn>;
  unlock: ReturnType<typeof vi.fn>;
  playVoice: ReturnType<typeof vi.fn>;
  stopVoice: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  const instances: ControllerSpy[] = [];
  class GameplayAudioController {
    preloadSfx = vi.fn();
    applyPreferences = vi.fn();
    updateLoopChannels = vi.fn(async () => undefined);
    stopLoopChannels = vi.fn();
    playSfx = vi.fn();
    unlock = vi.fn();
    playVoice = vi.fn();
    stopVoice = vi.fn();
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
    mappedGameplaySfxAssetIds: vi.fn((): string[] => []),
    voiceFor: vi.fn((_line: unknown): string | null => null),
    loadDialogueVoices: vi.fn(),
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

vi.mock("./dialogue-voice", () => ({
  createDialogueVoiceLoader: () => mocks.loadDialogueVoices,
}));

vi.mock("./sfx-events", () => ({
  assetIdForGameplaySfxEvent: mocks.assetIdForGameplaySfxEvent,
  mappedGameplaySfxAssetIds: mocks.mappedGameplaySfxAssetIds,
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
  presentFeedback: null,
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
    mocks.mappedGameplaySfxAssetIds.mockReturnValue([]);
    mocks.mappedGameplaySfxAssetIds.mockClear();
    mocks.voiceFor.mockReset().mockReturnValue(null);
    mocks.loadDialogueVoices
      .mockReset()
      .mockImplementation(async () => ({ voiceFor: mocks.voiceFor }));
  });

  it("constructs the controller eagerly but defers SFX preload past module init", async () => {
    // The controller singleton must exist as soon as the runtime module loads
    // (so BGM/BGS/SFX are immediately dispatchable), but it must NOT preload
    // SFX at module load: preload constructs the AudioContext, and building an
    // AudioContext before the first user gesture leaves it suspended and logs
    // an autoplay-policy warning in WebKit/WKWebView (Tauri's macOS engine).
    // The AudioContext is created lazily on the first real SFX preload/play.
    mocks.assetIdForGameplaySfxEvent.mockReturnValue("audio.sfx.tick");
    await loadRuntime();
    expect(mocks.instances).toHaveLength(1);
    expect(controller().preloadSfx).not.toHaveBeenCalled();
  });

  it("normalizes, persists, and applies preference patches", async () => {
    const runtime = await loadRuntime();
    const normalized: AudioPreferences = {
      muted: true,
      bgmVolume: 0.2,
      bgsVolume: 0.3,
      sfxVolume: 0.4,
      voiceVolume: 0.5,
      voiceEnabled: false,
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
    expect(runtime.audioPreferences.voiceVolume).toBe(0.5);
    expect(runtime.audioPreferences.voiceEnabled).toBe(false);
  });

  it("stops loop channels without disposing when a game-complete mode arrives", async () => {
    const runtime = await loadRuntime();
    runtime.syncGameplayAudioMode({ type: "gameComplete", storyCleared: true });
    expect(controller().stopLoopChannels).toHaveBeenCalledTimes(1);
    // The singleton must stay alive so SFX works for a subsequent new game in
    // the same session; dispose() would close the AudioContext permanently.
    expect(controller().dispose).not.toHaveBeenCalled();
    expect(controller().updateLoopChannels).not.toHaveBeenCalled();
  });

  it("resumes loop syncing on the mode after game-complete (replay stays audible)", async () => {
    const runtime = await loadRuntime();
    runtime.syncGameplayAudioMode({ type: "gameComplete", storyCleared: true });
    controller().stopLoopChannels.mockClear();
    controller().dispose.mockClear();

    runtime.syncGameplayAudioMode(exploreMode);
    expect(controller().updateLoopChannels).toHaveBeenCalledExactlyOnceWith(
      {
        bgm: exploreMode.bgm,
        bgs: exploreMode.bgs,
      },
      expect.objectContaining({ muted: false }),
    );
    // Controller was not torn down between game-complete and replay.
    expect(controller().dispose).not.toHaveBeenCalled();
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

  it("syncs the title theme as an explicitly owned main-menu loop", async () => {
    const runtime = await loadRuntime();

    runtime.syncMainMenuAudio();

    expect(controller().updateLoopChannels).toHaveBeenCalledExactlyOnceWith(
      {
        bgm: {
          channel: "bgm",
          assetId: "audio.bgm.bgm_chapter_close",
        },
        bgs: null,
      },
      expect.objectContaining({ muted: false }),
    );
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

  it("preloads every mapped SFX asset to warm the decode cache", async () => {
    const runtime = await loadRuntime();
    const assetIds = [
      "audio.sfx.sfx_dialogue_proceed_tick",
      "audio.sfx.sfx_usb_insert_chime",
    ];
    mocks.mappedGameplaySfxAssetIds.mockReturnValue(assetIds);

    runtime.preloadKnownGameplaySfx();

    expect(controller().preloadSfx).toHaveBeenCalledTimes(assetIds.length);
    for (const id of assetIds) {
      expect(controller().preloadSfx).toHaveBeenCalledWith(id);
    }
  });

  it("preloads nothing when no SFX assets are mapped", async () => {
    const runtime = await loadRuntime();
    runtime.preloadKnownGameplaySfx();
    expect(controller().preloadSfx).not.toHaveBeenCalled();
  });

  it("disposes the controller through the explicit teardown", async () => {
    const runtime = await loadRuntime();
    runtime.disposeGameplayAudio();
    expect(controller().dispose).toHaveBeenCalledTimes(1);
  });

  it("recreates the controller after disposal so audio stays usable across remounts", async () => {
    // Svelte HMR (dev) and any future return-to-menu flow unmount/remount
    // GameplayAudio.svelte, firing onDestroy. The controller singleton must
    // come back to life on the next use rather than staying silently dead.
    mocks.assetIdForGameplaySfxEvent.mockReturnValue("audio.sfx.tick");
    const runtime = await loadRuntime();
    const first = controller();
    runtime.disposeGameplayAudio();

    runtime.syncGameplayAudioMode(exploreMode);

    expect(mocks.instances).toHaveLength(2);
    const second = controller();
    expect(second).not.toBe(first);
    // The recreated controller does not preload at construction (the
    // AudioContext is built lazily on first real SFX use), so only the
    // loop sync primes it for the new mode.
    expect(second.preloadSfx).not.toHaveBeenCalled();
    expect(second.updateLoopChannels).toHaveBeenCalledExactlyOnceWith(
      {
        bgm: exploreMode.bgm,
        bgs: exploreMode.bgs,
      },
      expect.objectContaining({ muted: false }),
    );
  });

  it("retries locked audio playback through the controller", async () => {
    const runtime = await loadRuntime();
    runtime.retryLockedGameplayAudio();
    expect(controller().unlock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ muted: false }),
    );
  });

  it("does not retry locked audio after explicit disposal", async () => {
    const runtime = await loadRuntime();
    const first = controller();
    runtime.disposeGameplayAudio();
    first.unlock.mockClear();

    runtime.retryLockedGameplayAudio();

    expect(first.unlock).not.toHaveBeenCalled();
  });

  it("resets preferences back to the defaults", async () => {
    const runtime = await loadRuntime();
    runtime.resetAudioPreferences();
    expect(mocks.normalizeAudioPreferences).toHaveBeenCalledWith(DEFAULTS);
    expect(controller().applyPreferences).toHaveBeenCalledWith(DEFAULTS);
    expect(mocks.saveAudioPreferences).toHaveBeenCalledWith(DEFAULTS);
  });

  describe("dialogue voice", () => {
    const line = {
      chapterId: "chapter_1",
      speaker: "相馬律",
      text: "不說謊。",
      expression: null,
    };

    it("plays the clip the manifest names for a line", async () => {
      mocks.voiceFor.mockReturnValue("voice.ja.ch1_soma_ritsu_0001");
      const runtime = await loadRuntime();

      runtime.playDialogueVoice(line);
      await vi.waitFor(() =>
        expect(controller().playVoice).toHaveBeenCalledOnce(),
      );

      expect(controller().stopVoice).toHaveBeenCalledBefore(
        controller().playVoice,
      );
      expect(mocks.voiceFor).toHaveBeenCalledExactlyOnceWith(line);
      expect(controller().playVoice).toHaveBeenCalledWith(
        "voice.ja.ch1_soma_ritsu_0001",
        expect.objectContaining({ voiceEnabled: true }),
      );
    });

    it("plays nothing for an unvoiced line", async () => {
      const runtime = await loadRuntime();
      runtime.playDialogueVoice(line);
      await vi.waitFor(() => expect(mocks.voiceFor).toHaveBeenCalledOnce());
      expect(controller().playVoice).not.toHaveBeenCalled();
    });

    it("skips the manifest entirely while muted or with voices off", async () => {
      mocks.loadAudioPreferences.mockReturnValue({
        ...DEFAULTS,
        voiceEnabled: false,
      });
      const runtime = await loadRuntime();
      runtime.playDialogueVoice(line);
      runtime.updateAudioPreferences({ voiceEnabled: true, muted: true });
      runtime.playDialogueVoice(line);
      await Promise.resolve();
      expect(mocks.loadDialogueVoices).not.toHaveBeenCalled();
      expect(controller().stopVoice).toHaveBeenCalledTimes(2);
    });

    it("drops a line whose manifest load resolves after the next line started", async () => {
      let release!: () => void;
      mocks.loadDialogueVoices.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ voiceFor: mocks.voiceFor });
          }),
      );
      mocks.voiceFor.mockImplementation((next) =>
        (next as typeof line).text === "不說謊。"
          ? "voice.ja.old"
          : "voice.ja.new",
      );
      const runtime = await loadRuntime();

      runtime.playDialogueVoice(line);
      runtime.playDialogueVoice({ ...line, text: "下一句。" });
      await vi.waitFor(() =>
        expect(controller().playVoice).toHaveBeenCalledOnce(),
      );
      release();
      await Promise.resolve();
      await Promise.resolve();

      expect(controller().playVoice).toHaveBeenCalledOnce();
      expect(controller().playVoice).toHaveBeenCalledWith(
        "voice.ja.new",
        expect.anything(),
      );
    });

    it("stops a line only while it is still the current one", async () => {
      const runtime = await loadRuntime();
      const first = runtime.playDialogueVoice(line);
      const second = runtime.playDialogueVoice(line);
      controller().stopVoice.mockClear();

      runtime.stopDialogueVoice(first);
      expect(controller().stopVoice).not.toHaveBeenCalled();

      runtime.stopDialogueVoice(second);
      expect(controller().stopVoice).toHaveBeenCalledOnce();
    });

    it("cuts the voice on the ending screen and the main menu", async () => {
      const runtime = await loadRuntime();
      runtime.syncGameplayAudioMode({
        type: "gameComplete",
        storyCleared: true,
      });
      expect(controller().stopVoice).toHaveBeenCalledOnce();
      runtime.syncMainMenuAudio();
      expect(controller().stopVoice).toHaveBeenCalledTimes(2);
    });

    it("never starts a clip that was still loading when audio was disposed", async () => {
      mocks.voiceFor.mockReturnValue("voice.ja.ch1_soma_ritsu_0001");
      const runtime = await loadRuntime();
      const first = controller();
      runtime.playDialogueVoice(line);
      runtime.disposeGameplayAudio();
      await Promise.resolve();
      await Promise.resolve();
      expect(first.playVoice).not.toHaveBeenCalled();
      expect(mocks.instances).toHaveLength(1);
    });
  });
});
