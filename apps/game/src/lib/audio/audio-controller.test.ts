import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIO_PREFERENCES } from "./audio-preferences";
import {
  GameplayAudioController,
  type AudioElementLike,
  type SfxBackend,
} from "./audio-controller";

class FakeAudio implements AudioElementLike {
  currentTime = 0;
  duration = 30;
  loop = false;
  muted = false;
  preload = "";
  volume = 1;
  paused = true;
  listeners = new Map<string, Set<() => void>>();
  load = vi.fn();
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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

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

  function sfxBackend(overrides: Partial<SfxBackend> = {}): SfxBackend {
    return {
      dispose: vi.fn(),
      play: vi.fn(() => true),
      preload: vi.fn(),
      ...overrides,
    };
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
    expect(created.every((a) => a.loop)).toBe(false);
    expect(created[0]?.volume).toBe(preferences.bgmVolume);
    expect(created[1]?.volume).toBe(preferences.bgsVolume);
    expect(created[0]?.play).toHaveBeenCalledTimes(1);
    expect(created[1]?.play).toHaveBeenCalledTimes(1);
  });

  it("restarts loops before the encoded tail can create an audible seam", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: null, bgs: { channel: "bgs", assetId: "audio.bgs.rain" } },
      preferences,
    );
    const bgs = created[0]!;

    bgs.currentTime = bgs.duration - 0.2;
    bgs.emit("timeupdate");

    expect(bgs.currentTime).toBe(0);
    expect(bgs.play).toHaveBeenCalledTimes(1);
  });

  it("schedules loop restarts ahead of the media boundary", async () => {
    vi.useFakeTimers();
    try {
      const audio = controller();
      await audio.updateLoopChannels(
        { bgm: null, bgs: { channel: "bgs", assetId: "audio.bgs.rain" } },
        preferences,
      );
      const bgs = created[0]!;
      bgs.currentTime = 12;

      vi.advanceTimersByTime(29_499);
      expect(bgs.currentTime).toBe(12);

      vi.advanceTimersByTime(1);
      expect(bgs.currentTime).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replays loops if the media reaches ended", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: null, bgs: { channel: "bgs", assetId: "audio.bgs.rain" } },
      preferences,
    );
    const bgs = created[0]!;

    bgs.currentTime = bgs.duration;
    bgs.paused = true;
    bgs.emit("ended");

    expect(bgs.currentTime).toBe(0);
    expect(bgs.play).toHaveBeenCalledTimes(2);
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

  it("does not warn when a replaced loop rejects stale playback", async () => {
    const firstPlay = deferred();
    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        if (created.length === 0) {
          element.play = vi.fn(() => firstPlay.promise);
        }
        created.push(element);
        return element;
      },
      logger: { warn },
    });

    const staleUpdate = audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.tense" }, bgs: null },
      preferences,
    );
    firstPlay.reject(new Error("AbortError: interrupted"));
    await staleUpdate;

    expect(warn).not.toHaveBeenCalled();
    expect(created).toHaveLength(2);
    expect(created[0]?.pause).toHaveBeenCalledTimes(1);
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.tense" }, bgs: null },
      preferences,
    );
    expect(created).toHaveLength(2);
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
    expect(created[0]?.load).toHaveBeenCalledTimes(1);
  });

  it("preloads SFX without waiting for a click", () => {
    const audio = controller();

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");

    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe(
      "/assets/audio/sfx/sfx_dialogue_proceed_tick.ogg",
    );
    expect(created[0]?.play).not.toHaveBeenCalled();
    expect(created[0]?.load).toHaveBeenCalledTimes(1);
  });

  it("uses the low-latency SFX backend when available", () => {
    const backend = sfxBackend();
    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        created.push(element);
        return element;
      },
      logger: { warn },
      sfxBackend: backend,
    });

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);

    expect(backend.preload).toHaveBeenCalledExactlyOnceWith(
      "/assets/audio/sfx/sfx_dialogue_proceed_tick.ogg",
    );
    expect(backend.play).toHaveBeenCalledExactlyOnceWith(
      "/assets/audio/sfx/sfx_dialogue_proceed_tick.ogg",
      preferences.sfxVolume,
    );
    expect(created).toHaveLength(0);
  });

  it("falls back to media SFX when the low-latency backend cannot play", () => {
    const backend = sfxBackend({ play: vi.fn(() => false) });
    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        created.push(element);
        return element;
      },
      logger: { warn },
      sfxBackend: backend,
    });

    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);

    expect(backend.play).toHaveBeenCalledExactlyOnceWith(
      "/assets/audio/sfx/sfx_dialogue_proceed_tick.ogg",
      preferences.sfxVolume,
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.play).toHaveBeenCalledTimes(1);
  });

  it("does not wait for SFX media play startup", () => {
    const play = deferred();
    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        element.play = vi.fn(() => play.promise);
        created.push(element);
        return element;
      },
      logger: { warn },
    });

    const result = audio.playSfx(
      "audio.sfx.sfx_dialogue_proceed_tick",
      preferences,
    );

    expect(result).toBeUndefined();
    expect(created).toHaveLength(1);
    expect(created[0]?.play).toHaveBeenCalledTimes(1);
    play.resolve();
  });

  it("restarts an active SFX instead of stacking duplicate audio elements", async () => {
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);
    const sfx = created[0]!;
    sfx.currentTime = 0.2;

    await audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", {
      ...preferences,
      sfxVolume: 0.25,
    });

    expect(created).toHaveLength(1);
    expect(sfx.pause).toHaveBeenCalledTimes(1);
    expect(sfx.currentTime).toBe(0);
    expect(sfx.play).toHaveBeenCalledTimes(2);
    expect(sfx.volume).toBe(0.25);
  });

  it("reuses a completed SFX element for immediate later playback", async () => {
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);
    const sfx = created[0]!;

    sfx.emit("ended");
    await audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);

    expect(created).toHaveLength(1);
    expect(sfx.currentTime).toBe(0);
    expect(sfx.play).toHaveBeenCalledTimes(2);
    expect(sfx.listeners.get("ended")?.size).toBe(1);
    expect(sfx.listeners.get("error")?.size).toBe(1);
  });

  it("ignores stale SFX play rejections after a rapid restart", async () => {
    const firstPlay = deferred();
    const secondPlay = deferred();
    const plays = [firstPlay, secondPlay];
    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        element.play = vi.fn(() => plays.shift()?.promise ?? Promise.resolve());
        created.push(element);
        return element;
      },
      logger: { warn },
    });

    const firstAttempt = audio.playSfx(
      "audio.sfx.sfx_dialogue_proceed_tick",
      preferences,
    );
    const sfx = created[0]!;
    const secondAttempt = audio.playSfx(
      "audio.sfx.sfx_dialogue_proceed_tick",
      preferences,
    );

    expect(created).toHaveLength(1);
    firstPlay.reject(new Error("interrupted by restart"));
    await firstAttempt;

    expect(warn).not.toHaveBeenCalled();
    expect(sfx.listeners.get("ended")?.size).toBe(1);
    secondPlay.resolve();
    await secondAttempt;
    sfx.emit("ended");
    expect(sfx.listeners.get("ended")?.size).toBe(1);
  });

  it("keeps completed SFX cached after playback ends", async () => {
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_usb_insert_chime", preferences);
    const sfx = created[0];

    expect(sfx?.listeners.get("ended")?.size).toBe(1);
    expect(sfx?.listeners.get("error")?.size).toBe(1);
    sfx?.emit("ended");
    expect(sfx?.listeners.get("ended")?.size).toBe(1);
    expect(sfx?.listeners.get("error")?.size).toBe(1);
  });

  it("disposes active SFX", async () => {
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_usb_insert_chime", preferences);
    const sfx = created[0];

    audio.dispose();

    expect(sfx?.pause).toHaveBeenCalledTimes(1);
    expect(sfx?.currentTime).toBe(0);
    expect(sfx?.listeners.get("ended")?.size ?? 0).toBe(0);
    expect(sfx?.listeners.get("error")?.size ?? 0).toBe(0);
  });

  it("disposes the low-latency SFX backend", () => {
    const backend = sfxBackend();
    const audio = new GameplayAudioController({
      audioFactory: (url) => new FakeAudio(url),
      logger: { warn },
      sfxBackend: backend,
    });

    audio.dispose();

    expect(backend.dispose).toHaveBeenCalledTimes(1);
  });

  it("suppresses SFX while muted", async () => {
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_usb_insert_chime", {
      ...preferences,
      muted: true,
    });
    expect(created).toHaveLength(0);
  });

  it("logs SFX media errors only once when play also rejects", async () => {
    const play = deferred();
    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        element.play = vi.fn(() => play.promise);
        created.push(element);
        return element;
      },
      logger: { warn },
    });

    const sfx = audio.playSfx("audio.sfx.sfx_usb_insert_chime", preferences);
    created[0]?.emit("error");
    play.reject(new Error("blocked"));
    await sfx;

    expect(warn).toHaveBeenCalledTimes(1);
    expect(created[0]?.listeners.get("ended")?.size ?? 0).toBe(0);
    expect(created[0]?.listeners.get("error")?.size ?? 0).toBe(0);
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
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Error: blocked"),
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
