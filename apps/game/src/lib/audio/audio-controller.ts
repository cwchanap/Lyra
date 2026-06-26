import { publicPathForStoryAsset } from "$lib/assets/story-assets";
import type { AudioCue } from "$lib/state/types";
import type { AudioPreferences } from "./audio-preferences";

type LoopChannel = "bgm" | "bgs";

export type AudioElementLike = {
  src: string;
  currentTime: number;
  duration: number;
  loop: boolean;
  muted: boolean;
  paused: boolean;
  preload: string;
  volume: number;
  // `error` mirrors HTMLMediaElement.error; read at event time to fold the
  // MediaError code into the absorb-as-warning detail (see onError handlers).
  error?: { code: number } | null;
  load?: () => void;
  play: () => Promise<void> | void;
  pause: () => void;
  // Required, not optional: every real producer (HTMLAudioElement, the test
  // FakeAudio) implements EventTarget, and the controller's absorb-as-warning
  // contract depends on error/ended/timeupdate/loadedmetadata actually being
  // wired. Making these optional let a backend compile cleanly while silently
  // dropping every handler — the opposite of the contract.
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type AudioFactory = (url: string) => AudioElementLike;

export type SfxBackend = {
  dispose?: () => void;
  play: (url: string, volume: number) => boolean;
  preload: (url: string) => void;
};

type LoggerLike = {
  warn: (message: string) => void;
};

type LoopState = {
  assetId: string;
  audio: AudioElementLike;
  onEnded: () => void;
  onError: () => void;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
  restartTimer: ReturnType<typeof setTimeout> | null;
};

type SfxState = {
  audio: AudioElementLike;
  destroy: () => void;
  generation: number;
  onEnded: () => void;
  onError: () => void;
  warnOnce: (detail: string) => void;
};

export type LoopChannelInput = {
  bgm: AudioCue | null;
  bgs: AudioCue | null;
};

export type GameplayAudioControllerOptions = {
  audioFactory?: AudioFactory;
  logger?: LoggerLike;
  sfxBackend?: SfxBackend | null;
};

const LOOP_RESTART_MARGIN_SECONDS = 0.5;

function defaultAudioFactory(url: string): AudioElementLike {
  const audio = new Audio(url);
  return audio;
}

function defaultSfxBackend(logger: LoggerLike): SfxBackend | null {
  if (typeof window === "undefined") return null;
  const audioWindow = window as Window &
    typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const AudioContextCtor =
    audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextCtor || typeof fetch !== "function") return null;

  // The AudioContext is constructed lazily on the first SFX preload/play
  // rather than at backend creation: defaultSfxBackend() runs through the
  // gameplay-audio-runtime singleton at module load, before any user gesture.
  // Constructing an AudioContext before the first gesture leaves it suspended
  // and logs an autoplay-policy warning in WebKit/WKWebView (Tauri's macOS
  // engine). Deferring creation to the first real SFX use keeps it
  // gesture-adjacent. Per the design spec ("Audio must never block gameplay";
  // "absorb browser audio failures as silence plus warnings"), a construction
  // failure is still absorbed as "no low-latency backend" plus a one-shot
  // warning, never propagated.
  let context: AudioContext | null = null;
  let contextFailed = false;
  let constructionWarned = false;
  const ensureContext = (): AudioContext | null => {
    if (context) return context;
    if (contextFailed) return null;
    try {
      context = new AudioContextCtor({ latencyHint: "interactive" });
      return context;
    } catch (error) {
      contextFailed = true;
      if (!constructionWarned) {
        constructionWarned = true;
        logger.warn(
          `[GameplayAudio] WebAudio SFX unavailable: AudioContext construction failed (${normalizePlaybackError(error)})`,
        );
      }
      return null;
    }
  };
  const buffers = new Map<
    string,
    {
      active: AudioBufferSourceNode | null;
      buffer: AudioBuffer | null;
      failed: boolean;
      loading: Promise<void> | null;
      warned: boolean;
    }
  >();

  const warnOnce = (url: string, detail: string) => {
    const entry = buffers.get(url);
    if (entry?.warned) return;
    if (entry) entry.warned = true;
    logger.warn(
      `[GameplayAudio] Low-latency SFX unavailable: ${url} (${detail})`,
    );
  };
  const entryFor = (url: string) => {
    let entry = buffers.get(url);
    if (!entry) {
      entry = {
        active: null,
        buffer: null,
        failed: false,
        loading: null,
        warned: false,
      };
      buffers.set(url, entry);
    }
    return entry;
  };
  const decodeOnce = (ctx: AudioContext, url: string) => {
    const entry = entryFor(url);
    if (entry.buffer || entry.loading || entry.failed) return;
    entry.loading = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        entry.buffer = buffer;
      })
      .catch((error) => {
        entry.failed = true;
        warnOnce(url, normalizePlaybackError(error));
      })
      .finally(() => {
        entry.loading = null;
      });
  };
  const preload = (url: string) => {
    const ctx = ensureContext();
    if (!ctx) return;
    decodeOnce(ctx, url);
  };

  return {
    dispose: () => {
      for (const entry of buffers.values()) {
        entry.active?.stop();
        entry.active = null;
      }
      buffers.clear();
      // Only close a context that was actually created; dispose() may run
      // before any SFX ever primed the backend (e.g. a short session that
      // never played SFX), and calling close() on a never-built context is
      // impossible.
      if (context) {
        void context.close().catch((error) => {
          logger.warn(
            `[GameplayAudio] Failed to close SFX context (${normalizePlaybackError(error)})`,
          );
        });
      }
    },
    play: (url, volume) => {
      const ctx = ensureContext();
      if (!ctx) return false;
      const entry = entryFor(url);
      if (!entry.buffer) {
        decodeOnce(ctx, url);
        return false;
      }
      try {
        entry.active?.stop();
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = entry.buffer;
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.onended = () => {
          if (entry.active === source) entry.active = null;
        };
        if (ctx.state === "suspended") {
          void ctx.resume().catch((error) => {
            warnOnce(url, normalizePlaybackError(error));
          });
        }
        source.start(0);
        entry.active = source;
        return true;
      } catch (error) {
        warnOnce(url, normalizePlaybackError(error));
        return false;
      }
    },
    preload,
  };
}

function channelVolume(
  channel: LoopChannel | "sfx",
  preferences: AudioPreferences,
): number {
  if (channel === "bgm") return preferences.bgmVolume;
  if (channel === "bgs") return preferences.bgsVolume;
  return preferences.sfxVolume;
}

function playbackFailureDetail(url: string, error: unknown): string {
  return `${url}; ${normalizePlaybackError(error)}`;
}

// HTMLMediaElement error events carry a MediaError on `audio.error` whose code
// distinguishes 404/network/decode/unsupported-codec failures. The WebAudio
// path folds its failure reason into the warn detail; do the same here instead
// of collapsing every media failure into a bare URL (the design spec wants "a
// concise warning with the asset ID and URL" plus the failure reason).
function mediaErrorDetail(audio: AudioElementLike, url: string): string {
  const code = audio.error?.code;
  return typeof code === "number" ? `${url} (media error ${code})` : url;
}

function normalizePlaybackError(error: unknown): string {
  if (error instanceof Error) {
    return formatErrorNameMessage(error.name, error.message);
  }
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; name?: unknown };
    if (typeof record.name === "string" || typeof record.message === "string") {
      return formatErrorNameMessage(record.name, record.message);
    }
  }
  return String(error);
}

function formatErrorNameMessage(name: unknown, message: unknown): string {
  const normalizedName =
    typeof name === "string" && name.length > 0 ? name : "Error";
  return typeof message === "string" && message.length > 0
    ? `${normalizedName}: ${message}`
    : normalizedName;
}

export class GameplayAudioController {
  private loops: Record<LoopChannel, LoopState | null> = {
    bgm: null,
    bgs: null,
  };
  private readonly activeSfx = new Set<SfxState>();
  private readonly sfxByAsset = new Map<string, SfxState>();
  private readonly audioFactory: AudioFactory;
  private readonly logger: LoggerLike;
  private readonly sfxBackend: SfxBackend | null;
  private disposed = false;
  private playbackLocked = false;
  private lastDesiredInput: LoopChannelInput = { bgm: null, bgs: null };

  constructor(options: GameplayAudioControllerOptions = {}) {
    this.audioFactory = options.audioFactory ?? defaultAudioFactory;
    this.logger = options.logger ?? console;
    this.sfxBackend =
      options.sfxBackend === undefined
        ? defaultSfxBackend(this.logger)
        : options.sfxBackend;
  }

  async updateLoopChannels(
    input: LoopChannelInput,
    preferences: AudioPreferences,
  ): Promise<void> {
    this.lastDesiredInput = { bgm: input.bgm, bgs: input.bgs };
    await Promise.all([
      this.updateLoopChannel("bgm", input.bgm, preferences),
      this.updateLoopChannel("bgs", input.bgs, preferences),
    ]);
  }

  applyPreferences(preferences: AudioPreferences): void {
    for (const channel of ["bgm", "bgs"] as const) {
      const loop = this.loops[channel];
      if (!loop) continue;
      loop.audio.muted = preferences.muted;
      loop.audio.volume = channelVolume(channel, preferences);
    }
  }

  /**
   * Re-attempts the desired loop channels after a browser autoplay lock
   * clears (typically on the first user gesture). No-op if playback was never
   * locked. Per the gameplay-audio design spec: autoplay rejection records a
   * locked state and retries after the next player gesture.
   */
  unlock(preferences: AudioPreferences): void {
    if (!this.playbackLocked) return;
    this.playbackLocked = false;
    void this.updateLoopChannels(this.lastDesiredInput, preferences);
  }

  preloadSfx(assetId: string | null): void {
    if (!assetId) return;
    let url: string;
    try {
      url = publicPathForStoryAsset(assetId, "audio");
    } catch (error) {
      this.warn(assetId, String(error));
      return;
    }
    this.sfxBackend?.preload(url);
    if (this.sfxBackend) return;
    this.getOrCreateSfx(assetId);
  }

  playSfx(assetId: string | null, preferences: AudioPreferences): void {
    if (!assetId || preferences.muted) return;
    let url: string;
    try {
      url = publicPathForStoryAsset(assetId, "audio");
    } catch (error) {
      this.warn(assetId, String(error));
      return;
    }

    if (this.sfxBackend?.play(url, channelVolume("sfx", preferences))) {
      return;
    }

    const sfx = this.getOrCreateSfx(assetId, url);
    if (!sfx) return;
    this.restartSfx(sfx, url, preferences, this.activeSfx.has(sfx));
  }

  private getOrCreateSfx(
    assetId: string,
    resolvedUrl?: string,
  ): SfxState | null {
    const existing = this.sfxByAsset.get(assetId);
    if (existing) return existing;

    let url: string;
    try {
      url = resolvedUrl ?? publicPathForStoryAsset(assetId, "audio");
    } catch (error) {
      this.warn(assetId, String(error));
      return null;
    }
    const audio = this.audioFactory(url);
    let destroyed = false;
    let warned = false;
    const state: SfxState = {
      audio,
      destroy: () => undefined,
      generation: 0,
      onEnded: () => undefined,
      onError: () => undefined,
      warnOnce: () => undefined,
    };
    const warnOnce = (detail: string) => {
      if (warned) return;
      warned = true;
      this.warn(assetId, detail);
    };
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      audio.removeEventListener("ended", state.onEnded);
      audio.removeEventListener("error", state.onError);
      this.activeSfx.delete(state);
      if (this.sfxByAsset.get(assetId) === state) {
        this.sfxByAsset.delete(assetId);
      }
      audio.pause();
      audio.currentTime = 0;
    };
    const onEnded = () => {
      this.activeSfx.delete(state);
      audio.currentTime = 0;
    };
    const onError = () => {
      warnOnce(mediaErrorDetail(audio, url));
      destroy();
    };
    state.destroy = destroy;
    state.onEnded = onEnded;
    state.onError = onError;
    state.warnOnce = warnOnce;
    audio.loop = false;
    audio.preload = "auto";
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);
    audio.load?.();
    this.sfxByAsset.set(assetId, state);
    return state;
  }

  dispose(): void {
    // Idempotent: lifecycle cleanup (e.g. Svelte onDestroy) can fire more than
    // once. Without this guard, sfxBackend.dispose() closes the same
    // AudioContext again, logging a spurious "Failed to close SFX context"
    // warning on every repeat. Once disposed, the controller is single-use.
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop("bgm");
    this.stopLoop("bgs");
    for (const sfx of Array.from(this.sfxByAsset.values())) {
      this.stopSfx(sfx);
    }
    this.sfxBackend?.dispose?.();
  }

  /**
   * Stops both loop channels but leaves the SFX backend alive. Use this for
   * transient "silence the gameplay mix" transitions (e.g. gameComplete) where
   * the controller singleton must keep serving SFX for later replay. Reserve
   * dispose() for true teardown.
   */
  stopLoopChannels(): void {
    this.stopLoop("bgm");
    this.stopLoop("bgs");
  }

  private async updateLoopChannel(
    channel: LoopChannel,
    cue: AudioCue | null,
    preferences: AudioPreferences,
  ): Promise<void> {
    if (!cue) {
      this.applyPreferences(preferences);
      return;
    }
    if (cue.assetId === null) {
      this.stopLoop(channel);
      return;
    }
    if (this.loops[channel]?.assetId === cue.assetId) {
      this.applyPreferences(preferences);
      return;
    }

    this.stopLoop(channel);
    await this.startLoop(channel, cue.assetId, preferences);
  }

  private async startLoop(
    channel: LoopChannel,
    assetId: string,
    preferences: AudioPreferences,
  ): Promise<void> {
    let url: string;
    try {
      url = publicPathForStoryAsset(assetId, "audio");
    } catch (error) {
      this.warn(assetId, String(error));
      return;
    }

    const audio = this.audioFactory(url);
    const loop: LoopState = {
      assetId,
      audio,
      onEnded: () => {},
      onError: () => {},
      onLoadedMetadata: () => {},
      onTimeUpdate: () => {},
      restartTimer: null,
    };
    let warned = false;
    const warnOnce = (detail: string) => {
      if (warned) return;
      warned = true;
      this.warn(assetId, detail);
    };
    const clearRestartTimer = () => {
      if (loop.restartTimer === null) return;
      clearTimeout(loop.restartTimer);
      loop.restartTimer = null;
    };
    const scheduleLoopRestart = () => {
      clearRestartTimer();
      if (this.loops[channel]?.audio !== audio) return;
      if (!Number.isFinite(audio.duration)) return;
      if (audio.duration <= LOOP_RESTART_MARGIN_SECONDS) return;
      const restartInSeconds = Math.max(
        0,
        audio.duration - audio.currentTime - LOOP_RESTART_MARGIN_SECONDS,
      );
      loop.restartTimer = setTimeout(
        restartActiveLoop,
        restartInSeconds * 1000,
      );
    };
    const playActiveLoop = async () => {
      try {
        await audio.play();
        // Any successful loop playback clears an autoplay lock: once media is
        // actually playing the session is unlocked and earlier rejections no
        // longer need a gesture-driven retry.
        this.playbackLocked = false;
      } catch (error) {
        if (this.loops[channel]?.audio !== audio) return;
        // Autoplay-policy rejection (e.g. NotAllowedError/AbortError before the
        // first user gesture) is recoverable. Record a locked state so a later
        // gesture can re-sync the desired loops via unlock(); the loop itself
        // is still stopped so it does not sit in a half-started state.
        this.playbackLocked = true;
        warnOnce(playbackFailureDetail(url, error));
        if (this.loops[channel]?.audio === audio) this.stopLoop(channel);
      }
    };
    const restartActiveLoop = () => {
      if (this.loops[channel]?.audio !== audio) return;
      clearRestartTimer();
      audio.currentTime = 0;
      scheduleLoopRestart();
      if (audio.paused) void playActiveLoop();
    };
    loop.onEnded = () => restartActiveLoop();
    loop.onError = () => {
      warnOnce(mediaErrorDetail(audio, url));
      if (this.loops[channel]?.audio === audio) this.stopLoop(channel);
    };
    loop.onLoadedMetadata = () => scheduleLoopRestart();
    loop.onTimeUpdate = () => {
      if (!Number.isFinite(audio.duration)) return;
      if (audio.duration <= LOOP_RESTART_MARGIN_SECONDS) return;
      if (audio.currentTime < audio.duration - LOOP_RESTART_MARGIN_SECONDS)
        return;
      restartActiveLoop();
    };
    audio.loop = false;
    audio.preload = "auto";
    audio.muted = preferences.muted;
    audio.volume = channelVolume(channel, preferences);
    audio.addEventListener("error", loop.onError);
    audio.addEventListener("ended", loop.onEnded);
    audio.addEventListener("loadedmetadata", loop.onLoadedMetadata);
    audio.addEventListener("timeupdate", loop.onTimeUpdate);
    this.loops[channel] = loop;
    audio.load?.();
    scheduleLoopRestart();

    await playActiveLoop();
  }

  private stopLoop(channel: LoopChannel): void {
    const loop = this.loops[channel];
    if (!loop) return;
    if (loop.restartTimer !== null) clearTimeout(loop.restartTimer);
    loop.audio.removeEventListener("error", loop.onError);
    loop.audio.removeEventListener("ended", loop.onEnded);
    loop.audio.removeEventListener("loadedmetadata", loop.onLoadedMetadata);
    loop.audio.removeEventListener("timeupdate", loop.onTimeUpdate);
    loop.audio.pause();
    loop.audio.currentTime = 0;
    this.loops[channel] = null;
  }

  private stopSfx(sfx: SfxState): void {
    sfx.destroy();
  }

  private restartSfx(
    sfx: SfxState,
    url: string,
    preferences: AudioPreferences,
    cutActivePlayback: boolean,
  ): void {
    const generation = ++sfx.generation;
    sfx.audio.muted = preferences.muted;
    sfx.audio.volume = channelVolume("sfx", preferences);
    if (cutActivePlayback) sfx.audio.pause();
    sfx.audio.currentTime = 0;
    this.activeSfx.add(sfx);
    try {
      const playResult = sfx.audio.play();
      if (playResult) {
        void Promise.resolve(playResult).catch((error) => {
          this.handleSfxPlaybackFailure(sfx, url, generation, error);
        });
      }
    } catch (error) {
      this.handleSfxPlaybackFailure(sfx, url, generation, error);
    }
  }

  private handleSfxPlaybackFailure(
    sfx: SfxState,
    url: string,
    generation: number,
    error: unknown,
  ): void {
    if (sfx.generation !== generation || !this.activeSfx.has(sfx)) return;
    sfx.warnOnce(playbackFailureDetail(url, error));
    sfx.destroy();
  }

  private warn(assetId: string, detail: string): void {
    this.logger.warn(
      `[GameplayAudio] Audio unavailable: ${assetId} (${detail})`,
    );
  }
}
