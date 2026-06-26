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
  assetIdForGameplaySfxEvent,
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
  saveAudioPreferences(next);
  activeController().applyPreferences(next);
}

export function syncGameplayAudioMode(mode: Mode): void {
  const active = activeController();
  if (mode.type === "gameComplete") {
    // Stop the gameplay mix without disposing the singleton: the player can
    // start a new game in the same session, and dispose() would close the SFX
    // AudioContext permanently (leaving all later SFX silent). True teardown
    // belongs to disposeGameplayAudio().
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

export function playGameplaySfxEvent(event: GameplaySfxEvent): void {
  const assetId = assetIdForGameplaySfxEvent(event);
  if (!assetId) return;
  void activeController().playSfx(assetId, audioPreferences);
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
  controller.dispose();
  disposed = true;
}

export function resetAudioPreferences(): void {
  updateAudioPreferences(DEFAULT_AUDIO_PREFERENCES);
}
