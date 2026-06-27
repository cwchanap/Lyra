import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIO_PREFERENCES } from "./audio-preferences";
import {
  GameplayAudioController,
  type AudioElementLike,
  type LoopChannelInput,
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
  // Mirrors HTMLMediaElement.error; tests set this before emitting "error" to
  // assert the MediaError code is folded into the warn detail.
  error: { code: number } | null = null;
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
      setActiveGain: vi.fn(),
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
    expect(created.every((a) => a.loop)).toBe(true);
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

  it("enables native seamless looping on loop channels (regression: audible loop click)", async () => {
    // Regression guard for 7e54845: loop channels must set the media element's
    // native `loop` flag so the element rewinds at the decode layer without an
    // audible gap. Reverting to loop=false falls back to timer-only restarts
    // and reintroduces a click at the loop point. This is the primary anti-seam
    // mechanism; the scheduled-restart path is defense-in-depth only.
    const audio = controller();
    await audio.updateLoopChannels(
      {
        bgm: { channel: "bgm", assetId: "audio.bgm.review" },
        bgs: { channel: "bgs", assetId: "audio.bgs.rain" },
      },
      preferences,
    );

    expect(created.length).toBe(2);
    for (const loopAudio of created) {
      expect(loopAudio.loop).toBe(true);
    }
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

  it("ignores time updates while the loop is still well away from the boundary", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: null, bgs: { channel: "bgs", assetId: "audio.bgs.rain" } },
      preferences,
    );
    const bgs = created[0]!;

    bgs.currentTime = 5;
    bgs.emit("timeupdate");

    expect(bgs.currentTime).toBe(5);
    expect(bgs.play).toHaveBeenCalledTimes(1);
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

  it("mutes and rescales an SFX one-shot already in flight", async () => {
    // Without applyPreferences reaching active SFX, a clip already playing
    // keeps its original gain until it ends — so muting mid-SFX leaves the
    // active clip audible and dragging the SFX slider doesn't rescale it. The
    // HTMLAudio fallback path must update muted/volume on the active element.
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_usb_insert_chime", preferences);
    const sfx = created[0]!;
    expect(sfx.volume).toBe(preferences.sfxVolume);
    expect(sfx.muted).toBe(false);

    audio.applyPreferences({
      muted: true,
      bgmVolume: preferences.bgmVolume,
      bgsVolume: preferences.bgsVolume,
      sfxVolume: 0.4,
    });

    expect(sfx.muted).toBe(true);
    // Volume is updated too so unmuting resumes at the new SFX level, not the
    // stale one captured when the clip started.
    expect(sfx.volume).toBe(0.4);
  });

  it("updates the SFX backend's active gains when preferences change", async () => {
    // The low-latency WebAudio path bakes a single gain value in per play(); a
    // mute/volume change must be pushed to in-flight sources via setActiveGain,
    // using 0 when muted and the per-channel SFX volume otherwise.
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

    audio.applyPreferences({
      muted: true,
      bgmVolume: preferences.bgmVolume,
      bgsVolume: preferences.bgsVolume,
      sfxVolume: 0.6,
    });
    expect(backend.setActiveGain).toHaveBeenCalledExactlyOnceWith(0);

    audio.applyPreferences({
      muted: false,
      bgmVolume: preferences.bgmVolume,
      bgsVolume: preferences.bgsVolume,
      sfxVolume: 0.6,
    });
    expect(backend.setActiveGain).toHaveBeenNthCalledWith(2, 0.6);
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

  it("dispose() is idempotent across repeated teardowns", () => {
    // Lifecycle cleanup (Svelte onDestroy) can fire more than once. The
    // disposed guard must prevent a second dispose from re-closing the SFX
    // backend (which would log a spurious "Failed to close" warning). Use a
    // mock backend so the guard's effect — backend.dispose exactly once and no
    // double-close warning — is directly observable.
    const backend = sfxBackend();
    const audio = new GameplayAudioController({
      audioFactory: (url) => new FakeAudio(url),
      logger: { warn },
      sfxBackend: backend,
    });

    audio.dispose();
    audio.dispose();

    expect(backend.dispose).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stopLoopChannels silences loops but keeps the SFX backend alive", async () => {
    // stopLoopChannels is the gameComplete transition: it must stop the
    // gameplay mix WITHOUT tearing down the SFX backend, so SFX keeps serving
    // for a later new game in the same session. A regression that routed this
    // through dispose() would close the AudioContext permanently.
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
    await audio.updateLoopChannels(
      {
        bgm: { channel: "bgm", assetId: "audio.bgm.review" },
        bgs: { channel: "bgs", assetId: "audio.bgs.rain" },
      },
      preferences,
    );
    const bgm = created[0]!;
    const bgs = created[1]!;

    audio.stopLoopChannels();

    // Both loops are silenced...
    expect(bgm.pause).toHaveBeenCalledTimes(1);
    expect(bgs.pause).toHaveBeenCalledTimes(1);
    expect(bgm.currentTime).toBe(0);
    expect(bgs.currentTime).toBe(0);
    // ...but the SFX backend is NOT torn down, and SFX still plays.
    expect(backend.dispose).not.toHaveBeenCalled();
    audio.playSfx("audio.sfx.sfx_usb_insert_chime", preferences);
    expect(backend.play).toHaveBeenCalledExactlyOnceWith(
      "/assets/audio/sfx/sfx_usb_insert_chime.ogg",
      preferences.sfxVolume,
    );
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

  it("retries the desired loop after an autoplay lock clears via unlock()", async () => {
    const warnFn = vi.fn<(message: string) => void>();
    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        // First loop attempt is rejected by the browser autoplay policy.
        if (created.length === 0) {
          element.play = vi.fn(() =>
            Promise.reject(new Error("NotAllowedError: autoplay blocked")),
          );
        }
        created.push(element);
        return element;
      },
      logger: { warn: warnFn },
    });
    const input: LoopChannelInput = {
      bgm: { channel: "bgm", assetId: "audio.bgm.review" },
      bgs: null,
    };

    await audio.updateLoopChannels(input, preferences);

    // The rejected loop was warned about and stopped, and the lock recorded.
    expect(warnFn).toHaveBeenCalledWith(
      expect.stringContaining("NotAllowedError"),
    );
    expect(created[0]?.pause).toHaveBeenCalled();

    // Retry after the first user gesture: unlock re-attempts the desired loop
    // by spinning up a fresh media element that this time plays successfully.
    audio.unlock(preferences);
    await Promise.resolve();

    expect(created).toHaveLength(2);
    expect(created[1]?.play).toHaveBeenCalledTimes(1);
    expect(created[1]?.volume).toBe(preferences.bgmVolume);
  });

  it("unlock() is a no-op when playback was never locked", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    const activeBefore = created.length;

    audio.unlock(preferences);
    await Promise.resolve();

    // No new loop is created when nothing was locked.
    expect(created).toHaveLength(activeBefore);
  });

  it("warns and stops a loop when the media element fires an error", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    const bgm = created[0]!;

    bgm.emit("error");

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("/assets/audio/bgm/review.ogg"),
    );
    expect(bgm.pause).toHaveBeenCalled();
  });

  it("folds the MediaError code into the loop error warning", async () => {
    // A bare-URL warning collapses 404 / corrupt-.ogg / unsupported-codec into
    // one identical message. The HTMLMediaElement carries a MediaError code at
    // event time that must be preserved so the failure mode is diagnosable.
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    const bgm = created[0]!;
    bgm.error = { code: 4 };

    bgm.emit("error");

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("media error 4"));
  });

  it("folds the MediaError code into the SFX error warning", async () => {
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_usb_insert_chime", preferences);
    const sfx = created[0]!;
    sfx.error = { code: 2 };

    sfx.emit("error");

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("media error 2"));
  });

  it("skips loop restart scheduling for non-finite durations", async () => {
    vi.useFakeTimers();
    try {
      const audio = controller();
      await audio.updateLoopChannels(
        { bgm: null, bgs: { channel: "bgs", assetId: "audio.bgs.rain" } },
        preferences,
      );
      const bgs = created[0]!;
      bgs.duration = Number.NaN;

      bgs.emit("loadedmetadata");
      vi.advanceTimersByTime(60_000);

      expect(bgs.currentTime).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips loop restart scheduling for clips shorter than the restart margin", async () => {
    vi.useFakeTimers();
    try {
      const audio = controller();
      await audio.updateLoopChannels(
        { bgm: null, bgs: { channel: "bgs", assetId: "audio.bgs.rain" } },
        preferences,
      );
      const bgs = created[0]!;
      bgs.duration = 0.2;

      bgs.emit("loadedmetadata");
      vi.advanceTimersByTime(60_000);

      expect(bgs.currentTime).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [
      "a string",
      "media dropped the connection",
      "media dropped the connection",
    ],
    [
      "an Error-like object",
      { name: "NotSupported", message: "nope" },
      "NotSupported: nope",
    ],
    ["an unrecognized shape", 42, "42"],
  ])(
    "normalizes loop playback rejections that are %s",
    async (_label, rejection, expected) => {
      const audio = new GameplayAudioController({
        audioFactory: (url) => {
          const element = new FakeAudio(url);
          element.play = vi.fn(() => Promise.reject(rejection));
          created.push(element);
          return element;
        },
        logger: { warn },
      });
      await audio.updateLoopChannels(
        { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
        preferences,
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(expected));
    },
  );

  it("warns when a loop asset id is malformed", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.muzak.review" }, bgs: null },
      preferences,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("audio.muzak.review"),
    );
    expect(created).toHaveLength(0);
  });

  it("warns when an SFX asset id is malformed during preload", () => {
    const audio = controller();
    audio.preloadSfx("audio.muzak.tick");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("audio.muzak.tick"),
    );
    expect(created).toHaveLength(0);
  });

  it("warns when an SFX asset id is malformed during play", () => {
    const audio = controller();
    audio.playSfx("audio.muzak.tick", preferences);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("audio.muzak.tick"),
    );
    expect(created).toHaveLength(0);
  });

  it("ignores a null SFX preload request", () => {
    const audio = controller();
    audio.preloadSfx(null);
    expect(warn).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it("destroys an SFX and warns when its play() throws synchronously", async () => {
    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        element.play = vi.fn(() => {
          throw new Error("sync blocked");
        });
        created.push(element);
        return element;
      },
      logger: { warn },
    });
    audio.playSfx("audio.sfx.sfx_usb_insert_chime", preferences);
    const sfx = created[0]!;
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sync blocked"));
    expect(sfx.pause).toHaveBeenCalledTimes(1);
    expect(sfx.listeners.get("error")?.size ?? 0).toBe(0);
  });

  it("uses the default HTMLAudioElement factory when none is supplied", () => {
    const audio = new GameplayAudioController({
      logger: { warn },
      sfxBackend: null,
    });
    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    expect(warn).not.toHaveBeenCalled();
  });
});

class FakeBufferSourceNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGainNode {
  gain = { value: 1 };
  connect = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = "running";
  latencyHint?: string;
  decodeAudioData = vi.fn(async (_data: ArrayBuffer) => ({ length: 1 }));
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => undefined);
  destination = { id: "destination" };
  createBufferSource = vi.fn(() => new FakeBufferSourceNode());
  createGain = vi.fn(() => new FakeGainNode());

  constructor(options?: { latencyHint?: string }) {
    this.latencyHint = options?.latencyHint;
    instances.push(this);
  }
}

const instances: FakeAudioContext[] = [];

function okResponse(data = new ArrayBuffer(8)): Response {
  return new Response(data, { status: 200 });
}

describe("GameplayAudioController default SFX backend", () => {
  let warn: (message: string) => void;
  let fetchMock: ReturnType<typeof vi.fn>;
  let created: FakeAudio[];

  beforeEach(() => {
    warn = vi.fn();
    fetchMock = vi.fn();
    created = [];
    instances.length = 0;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function controller() {
    return new GameplayAudioController({ logger: { warn } });
  }

  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("constructs the AudioContext lazily on first SFX use", () => {
    // The AudioContext must NOT be built at controller/backend construction:
    // defaultSfxBackend() runs through the gameplay-audio-runtime singleton at
    // module load (before any user gesture), and constructing an AudioContext
    // before the first gesture leaves it suspended and logs an autoplay-policy
    // warning in WebKit/WKWebView (Tauri's macOS engine). Creation is deferred
    // to the first SFX preload/play, which is gesture-adjacent.
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();
    expect(instances).toHaveLength(0);

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    expect(instances).toHaveLength(1);
    expect(instances[0]?.latencyHint).toBe("interactive");
  });

  it("preloads a buffer and plays it through the low-latency graph", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    const ctx = instances[0]!;
    await flush();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/assets/audio/sfx/sfx_dialogue_proceed_tick.ogg",
    );
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);

    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);
    const source = ctx.createBufferSource.mock.results[0]?.value;
    const gain = ctx.createGain.mock.results[0]?.value;
    expect(source.buffer).toBeDefined();
    expect(gain.gain.value).toBe(preferences.sfxVolume);
    expect(source.connect).toHaveBeenCalledExactlyOnceWith(gain);
    expect(gain.connect).toHaveBeenCalledExactlyOnceWith(ctx.destination);
    expect(source.start).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("starts preloading and falls back when the buffer is not ready", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();

    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);
    const ctx = instances[0]!;
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await flush();
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("warns once when the SFX fetch is not ok and never plays the buffer", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    const audio = controller();

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    const ctx = instances[0]!;
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 404"));

    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns once when audio decoding fails", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    // decodeAudioData runs asynchronously after the fetch resolves, so the
    // rejection can be armed after preloadSfx creates the context but before
    // the microtask chain reaches decode.
    const ctx = instances[0]!;
    ctx.decodeAudioData.mockRejectedValueOnce(new Error("decode failed"));
    await flush();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("decode failed"));
    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
  });

  it("resumes a suspended AudioContext before starting playback", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    const ctx = instances[0]!;
    ctx.state = "suspended";
    await flush();
    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);

    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("warns when resuming a suspended context rejects", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    const ctx = instances[0]!;
    ctx.state = "suspended";
    ctx.resume.mockRejectedValueOnce(new Error("blocked"));
    await flush();
    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);
    await flush();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("blocked"));
  });

  it("warns and skips playback when starting the buffer source throws", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    await flush();
    const ctx = instances[0]!;
    ctx.createBufferSource.mockImplementationOnce(() => {
      throw new Error("graph broken");
    });
    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);

    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("graph broken"));
  });

  it("stops active sources and closes the context on dispose", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    await flush();
    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);
    const ctx = instances[0]!;
    const source = ctx.createBufferSource.mock.results[0]?.value;

    audio.dispose();

    expect(source.stop).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it("rescales the active gain node when SFX preferences change mid-playback", async () => {
    // A source already started via the WebAudio graph keeps its baked gain
    // value for the clip's lifetime. applyPreferences() must push the new
    // effective gain (0 when muted, otherwise the SFX volume) to in-flight
    // sources so the mute/volume control covers the full mix.
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();

    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    await flush();
    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);
    const ctx = instances[0]!;
    const gain = ctx.createGain.mock.results[0]?.value;
    expect(gain.gain.value).toBe(preferences.sfxVolume);

    audio.applyPreferences({
      muted: true,
      bgmVolume: preferences.bgmVolume,
      bgsVolume: preferences.bgsVolume,
      sfxVolume: 0.2,
    });
    expect(gain.gain.value).toBe(0);

    audio.applyPreferences({
      muted: false,
      bgmVolume: preferences.bgmVolume,
      bgsVolume: preferences.bgsVolume,
      sfxVolume: 0.2,
    });
    expect(gain.gain.value).toBe(0.2);
  });

  it("dispose() is idempotent and does not close the context twice", async () => {
    // Repeated teardown (e.g. Svelte onDestroy firing more than once) must not
    // close the AudioContext again — the second close() would reject and log a
    // spurious "Failed to close SFX context" warning.
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();
    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    const ctx = instances[0]!;

    audio.dispose();
    audio.dispose();

    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when closing the SFX context rejects", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const audio = controller();

    // The context is created lazily, so prime it with a preload before dispose
    // has anything to close.
    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    const ctx = instances[0]!;
    ctx.close.mockRejectedValueOnce(new Error("closing blocked"));

    audio.dispose();
    await flush();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("closing blocked"),
    );
  });

  it("falls back to webkitAudioContext when AudioContext is absent", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", FakeAudioContext);
    fetchMock.mockResolvedValue(okResponse());

    const audio = controller();
    // The context is created lazily on first SFX use, not at construction.
    expect(instances).toHaveLength(0);
    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    expect(instances).toHaveLength(1);
  });

  it("falls back to media SFX when the AudioContext constructor throws", () => {
    // Regression guard for the fail-silent contract: an edge-case WebView may
    // expose an AudioContext constructor that throws on construction (disabled
    // by policy, unsupported codec path, etc.). Because the context is built
    // lazily on first SFX use, that throw happens during the first preload/play
    // rather than at module load, and must be absorbed as "no low-latency
    // backend" + a one-shot warning — never propagated — so gameplay proceeds
    // with media-element SFX.
    class ThrowingAudioContext {
      constructor() {
        throw new Error("AudioContext disabled in this WebView");
      }
    }
    vi.stubGlobal("AudioContext", ThrowingAudioContext);
    fetchMock.mockResolvedValue(okResponse());

    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        created.push(element);
        return element;
      },
      logger: { warn },
    });

    // Construction itself does not throw or warn: the context is deferred.
    expect(warn).not.toHaveBeenCalled();

    // The first preload triggers the (failing) context construction, absorbed
    // as a one-shot warning. The controller still sees a low-latency backend
    // object, so preload does not yet spin up a media element.
    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("AudioContext construction failed"),
    );
    expect(instances).toHaveLength(0);

    // The first play finds no usable context, so the backend reports failure
    // and the controller falls back to a media element.
    audio.playSfx("audio.sfx.sfx_dialogue_proceed_tick", preferences);
    expect(created).toHaveLength(1);
  });

  it("produces no low-latency backend when neither context nor fetch exist", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("fetch", undefined);

    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        created.push(element);
        return element;
      },
      logger: { warn },
    });
    audio.preloadSfx("audio.sfx.sfx_dialogue_proceed_tick");

    expect(instances).toHaveLength(0);
    expect(created).toHaveLength(1);
  });
});
