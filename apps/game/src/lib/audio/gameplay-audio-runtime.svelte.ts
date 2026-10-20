import type { Mode } from "$lib/state/types";
import {
  DEFAULT_AUDIO_PREFERENCES,
  loadAudioPreferences,
  normalizeAudioPreferences,
  saveAudioPreferences,
  type AudioPreferences,
} from "./audio-preferences";
import { GameplayAudioController } from "./audio-controller";
import {
  createDialogueVoiceLoader,
  type DialogueVoiceLine,
} from "./dialogue-voice";
import {
  assetIdForGameplaySfxEvent,
  mappedGameplaySfxAssetIds,
  type GameplaySfxEvent,
} from "./sfx-events";

export const audioPreferences = $state<AudioPreferences>(
  loadAudioPreferences(),
);

// The controller is a process-lifetime singleton, but it must be recreatable
// after disposeGameplayAudio(): dispose() closes the SFX AudioContext
// permanently, so a controller that has been torn down can never serve audio
// again. Svelte HMR (dev) and any future "return to main menu" flow unmount
// and remount GameplayAudio.svelte, firing onDestroy. Without recreation, all
// audio in the rest of that session would be silent. We track disposal here
// and lazily spin up a fresh controller on the next use.
//
// The controller is constructed WITHOUT preloading SFX: preloading would
// construct the WebAudio AudioContext immediately (decodeAudioData needs a
// context), and building it at module load — before the first user gesture —
// leaves it suspended and logs an autoplay-policy warning in WebKit/WKWebView
// (Tauri's macOS engine). The AudioContext is instead created lazily on the
// first real SFX preload/play inside the controller, which is gesture-adjacent.
function createController(): GameplayAudioController {
  return new GameplayAudioController();
}

let controller = createController();
let disposed = false;

function activeController(): GameplayAudioController {
  if (disposed) {
    controller = createController();
    disposed = false;
  }
  return controller;
}

export function updateAudioPreferences(patch: Partial<AudioPreferences>): void {
  const next = normalizeAudioPreferences({ ...audioPreferences, ...patch });
  audioPreferences.muted = next.muted;
  audioPreferences.bgmVolume = next.bgmVolume;
  audioPreferences.bgsVolume = next.bgsVolume;
  audioPreferences.sfxVolume = next.sfxVolume;
  audioPreferences.voiceVolume = next.voiceVolume;
  audioPreferences.voiceEnabled = next.voiceEnabled;
  saveAudioPreferences(next);
  activeController().applyPreferences(next);
}

// The voice manifest is read once per session, on the first voiced line.
const loadDialogueVoices = createDialogueVoiceLoader();
// Bumped by every voice start and stop, so a manifest load that resolves
// after the line has moved on (or the dialogue box closed) plays nothing.
let voiceRequest = 0;

/**
 * Starts the voice clip for a dialogue line, cutting any clip still playing.
 * Returns a handle for {@link stopDialogueVoice}. Lines without a clip, and
 * every line while muted or with voices off, are silent.
 */
export function playDialogueVoice(line: DialogueVoiceLine): number {
  const request = ++voiceRequest;
  activeController().stopVoice();
  if (audioPreferences.muted || !audioPreferences.voiceEnabled) return request;
  void loadDialogueVoices().then((index) => {
    if (request !== voiceRequest) return;
    const assetId = index.voiceFor(line);
    if (assetId) activeController().playVoice(assetId, audioPreferences);
  });
  return request;
}

/**
 * Stops the clip started by `request`. A stale handle (its line already
 * replaced by a newer one) is ignored, so a closing dialogue box never cuts
 * the next line's voice.
 */
export function stopDialogueVoice(request: number): void {
  if (request !== voiceRequest) return;
  stopAnyDialogueVoice();
}

function stopAnyDialogueVoice(): void {
  voiceRequest += 1;
  if (!disposed) controller.stopVoice();
}

export function syncGameplayAudioMode(mode: Mode): void {
  const active = activeController();
  if (mode.type === "gameComplete") {
    // Stop the gameplay mix without disposing the singleton: the player can
    // start a new game in the same session, and dispose() would close the SFX
    // AudioContext permanently (leaving all later SFX silent). True teardown
    // belongs to disposeGameplayAudio().
    stopAnyDialogueVoice();
    active.stopLoopChannels();
    return;
  }
  void active.updateLoopChannels(
    {
      bgm: mode.bgm ?? null,
      bgs: mode.bgs ?? null,
    },
    audioPreferences,
  );
}

export function syncMainMenuAudio(): void {
  stopAnyDialogueVoice();
  void activeController().updateLoopChannels(
    {
      bgm: {
        channel: "bgm",
        assetId: "audio.bgm.bgm_chapter_close",
      },
      bgs: null,
    },
    audioPreferences,
  );
}

export function playGameplaySfxEvent(event: GameplaySfxEvent): void {
  const assetId = assetIdForGameplaySfxEvent(event);
  if (!assetId) return;
  void activeController().playSfx(assetId, audioPreferences);
}

/**
 * Warms the low-latency WebAudio decode cache for every mapped SFX asset.
 * Intended to run on the first user gesture (see GameplayAudio.svelte's
 * handleUnlockGesture): the gesture clears the browser autoplay lock, and
 * preloading starts the fetch+decode so the first real `playSfx` for any
 * mapped SFX hits the buffer cache instead of falling back to the
 * higher-latency HTMLAudioElement path while the decode races. No-op for
 * assets that fail to load (the backend marks them failed and `playSfx`
 * falls back per-asset). Safe to call before any gesture: `preloadSfx`
 * constructs the AudioContext lazily on first use, which is gesture-adjacent
 * when invoked from the gesture handler.
 */
export function preloadKnownGameplaySfx(): void {
  const controller = activeController();
  for (const assetId of mappedGameplaySfxAssetIds()) {
    controller.preloadSfx(assetId);
  }
}

/**
 * Re-attempts the desired BGM/BGS loops after a browser autoplay lock clears
 * (typically on the first user gesture). No-op if playback was never locked
 * or if the singleton has been explicitly disposed. See GameplayAudio design
 * spec: "autoplay rejection records a locked state and retries after the next
 * player gesture."
 */
export function retryLockedGameplayAudio(): void {
  if (disposed) return;
  controller.unlock(audioPreferences);
}

export function disposeGameplayAudio(): void {
  voiceRequest += 1;
  controller.dispose();
  disposed = true;
}

export function resetAudioPreferences(): void {
  updateAudioPreferences(DEFAULT_AUDIO_PREFERENCES);
}
