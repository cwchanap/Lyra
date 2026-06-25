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

const controller = new GameplayAudioController();
controller.preloadSfx(assetIdForGameplaySfxEvent("ui:menu-confirm"));

export function updateAudioPreferences(patch: Partial<AudioPreferences>): void {
  const next = normalizeAudioPreferences({ ...audioPreferences, ...patch });
  audioPreferences.muted = next.muted;
  audioPreferences.bgmVolume = next.bgmVolume;
  audioPreferences.bgsVolume = next.bgsVolume;
  audioPreferences.sfxVolume = next.sfxVolume;
  saveAudioPreferences(next);
  controller.applyPreferences(next);
}

export function syncGameplayAudioMode(mode: Mode): void {
  if (mode.type === "gameComplete") {
    // Stop the gameplay mix without disposing the singleton: the player can
    // start a new game in the same session, and dispose() would close the SFX
    // AudioContext permanently (leaving all later SFX silent). True teardown
    // belongs to disposeGameplayAudio().
    controller.stopLoopChannels();
    return;
  }
  void controller.updateLoopChannels(
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
  void controller.playSfx(assetId, audioPreferences);
}

export function disposeGameplayAudio(): void {
  controller.dispose();
}

export function resetAudioPreferences(): void {
  updateAudioPreferences(DEFAULT_AUDIO_PREFERENCES);
}
