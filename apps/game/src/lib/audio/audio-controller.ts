import { publicPathForStoryAsset } from "$lib/assets/story-assets";
import type { AudioCue } from "$lib/state/types";
import type { AudioPreferences } from "./audio-preferences";

type LoopChannel = "bgm" | "bgs";

export type AudioElementLike = {
  src: string;
  currentTime: number;
  loop: boolean;
  muted: boolean;
  preload: string;
  volume: number;
  play: () => Promise<void> | void;
  pause: () => void;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

export type AudioFactory = (url: string) => AudioElementLike;

type LoggerLike = {
  warn: (message: string) => void;
};

type LoopState = {
  assetId: string;
  audio: AudioElementLike;
  onError: () => void;
};

export type LoopChannelInput = {
  bgm: AudioCue | null;
  bgs: AudioCue | null;
};

export type GameplayAudioControllerOptions = {
  audioFactory?: AudioFactory;
  logger?: LoggerLike;
};

function defaultAudioFactory(url: string): AudioElementLike {
  const audio = new Audio(url);
  return audio;
}

function channelVolume(
  channel: LoopChannel | "sfx",
  preferences: AudioPreferences,
): number {
  if (channel === "bgm") return preferences.bgmVolume;
  if (channel === "bgs") return preferences.bgsVolume;
  return preferences.sfxVolume;
}

export class GameplayAudioController {
  private loops: Record<LoopChannel, LoopState | null> = {
    bgm: null,
    bgs: null,
  };
  private readonly audioFactory: AudioFactory;
  private readonly logger: LoggerLike;

  constructor(options: GameplayAudioControllerOptions = {}) {
    this.audioFactory = options.audioFactory ?? defaultAudioFactory;
    this.logger = options.logger ?? console;
  }

  async updateLoopChannels(
    input: LoopChannelInput,
    preferences: AudioPreferences,
  ): Promise<void> {
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

  async playSfx(
    assetId: string | null,
    preferences: AudioPreferences,
  ): Promise<void> {
    if (!assetId || preferences.muted) return;
    let url: string;
    try {
      url = publicPathForStoryAsset(assetId, "audio");
    } catch (error) {
      this.warn(assetId, String(error));
      return;
    }

    const audio = this.audioFactory(url);
    audio.loop = false;
    audio.preload = "auto";
    audio.muted = preferences.muted;
    audio.volume = channelVolume("sfx", preferences);
    const onError = () => this.warn(assetId, url);
    audio.addEventListener?.("error", onError);
    try {
      await audio.play();
    } catch {
      this.warn(assetId, url);
      audio.pause();
      audio.currentTime = 0;
    }
  }

  dispose(): void {
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
    const onError = () => {
      this.warn(assetId, url);
      if (this.loops[channel]?.audio === audio) this.stopLoop(channel);
    };
    audio.loop = true;
    audio.preload = "auto";
    audio.muted = preferences.muted;
    audio.volume = channelVolume(channel, preferences);
    audio.addEventListener?.("error", onError);
    this.loops[channel] = { assetId, audio, onError };

    try {
      await audio.play();
    } catch {
      this.warn(assetId, url);
      if (this.loops[channel]?.audio === audio) this.stopLoop(channel);
    }
  }

  private stopLoop(channel: LoopChannel): void {
    const loop = this.loops[channel];
    if (!loop) return;
    loop.audio.removeEventListener?.("error", loop.onError);
    loop.audio.pause();
    loop.audio.currentTime = 0;
    this.loops[channel] = null;
  }

  private warn(assetId: string, detail: string): void {
    this.logger.warn(
      `[GameplayAudio] Audio unavailable: ${assetId} (${detail})`,
    );
  }
}
