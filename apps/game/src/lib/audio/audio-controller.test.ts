import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIO_PREFERENCES } from "./audio-preferences";
import {
  GameplayAudioController,
  type AudioElementLike,
} from "./audio-controller";

class FakeAudio implements AudioElementLike {
  currentTime = 0;
  loop = false;
  muted = false;
  preload = "";
  volume = 1;
  paused = true;
  listeners = new Map<string, Set<() => void>>();
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });

  constructor(public src: string) {}

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const preferences = DEFAULT_AUDIO_PREFERENCES;

describe("GameplayAudioController", () => {
  let created: FakeAudio[];
  let warn: (message: string) => void;

  beforeEach(() => {
    created = [];
    warn = vi.fn<(message: string) => void>();
  });

  function controller() {
    return new GameplayAudioController({
      audioFactory: (url) => {
        const audio = new FakeAudio(url);
        created.push(audio);
        return audio;
      },
      logger: { warn },
    });
  }

  it("starts BGM and BGS loops", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      {
        bgm: { channel: "bgm", assetId: "audio.bgm.review" },
        bgs: { channel: "bgs", assetId: "audio.bgs.rain" },
      },
      preferences,
    );

    expect(created.map((a) => a.src)).toEqual([
      "/assets/audio/bgm/review.ogg",
      "/assets/audio/bgs/rain.ogg",
    ]);
    expect(created.every((a) => a.loop)).toBe(true);
    expect(created[0]?.volume).toBe(preferences.bgmVolume);
    expect(created[1]?.volume).toBe(preferences.bgsVolume);
    expect(created[0]?.play).toHaveBeenCalledTimes(1);
    expect(created[1]?.play).toHaveBeenCalledTimes(1);
  });

  it("keeps unchanged loops without restarting", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.play).toHaveBeenCalledTimes(1);
  });

  it("stops on explicit none", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: null }, bgs: null },
      preferences,
    );
    expect(created[0]?.pause).toHaveBeenCalledTimes(1);
    expect(created[0]?.currentTime).toBe(0);
  });

  it("applies mute and volumes to active loops", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    audio.applyPreferences({
      muted: true,
      bgmVolume: 0.1,
      bgsVolume: 0.2,
      sfxVolume: 0.3,
    });
    expect(created[0]?.muted).toBe(true);
    expect(created[0]?.volume).toBe(0.1);
  });

  it("plays SFX as a non-looping one-shot", async () => {
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_usb_insert_chime", preferences);
    expect(created[0]?.src).toBe("/assets/audio/sfx/sfx_usb_insert_chime.ogg");
    expect(created[0]?.loop).toBe(false);
    expect(created[0]?.volume).toBe(preferences.sfxVolume);
  });

  it("suppresses SFX while muted", async () => {
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_usb_insert_chime", {
      ...preferences,
      muted: true,
    });
    expect(created).toHaveLength(0);
  });

  it("logs and silences rejected playback", async () => {
    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        element.play = vi.fn(async () => {
          throw new Error("blocked");
        });
        created.push(element);
        return element;
      },
      logger: { warn },
    });
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("audio.bgm.review"),
    );
    expect(created[0]?.pause).toHaveBeenCalled();
  });

  it("disposes active loops", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    audio.dispose();
    expect(created[0]?.pause).toHaveBeenCalled();
  });
});
