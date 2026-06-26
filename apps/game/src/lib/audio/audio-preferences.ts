export type AudioPreferences = {
  muted: boolean;
  bgmVolume: number;
  bgsVolume: number;
  sfxVolume: number;
};

export const AUDIO_PREFERENCES_STORAGE_KEY = "lyra.audioPreferences.v1";

export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  muted: false,
  bgmVolume: 0.55,
  bgsVolume: 0.45,
  sfxVolume: 0.7,
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

// Persistence failures (Safari private-mode SecurityError on localStorage
// access, QuotaExceededError on setItem, or corrupt stored JSON) used to be
// swallowed by bare `catch {}` blocks: a player's muted/lowered-volume prefs
// would silently revert to defaults or fail to persist across relaunch with
// zero signal. Per the gameplay-audio design spec ("absorb failures as
// silence plus warnings"), each failure path now logs a concise [GameplayAudio]
// warning. The save/storage paths are one-shot because they are invoked on
// every preference change (volume sliders fire one save per input event): in a
// broken-storage session the failure is persistent, so a single warning is the
// right signal rather than a flood on every slider tick.
let storageUnavailableWarned = false;
let saveFailureWarned = false;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.name || error.message;
  return String(error);
}

function clampVolume(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function normalizeAudioPreferences(value: unknown): AudioPreferences {
  const raw = value && typeof value === "object" ? value : {};
  const record = raw as Partial<AudioPreferences>;
  return {
    muted:
      typeof record.muted === "boolean"
        ? record.muted
        : DEFAULT_AUDIO_PREFERENCES.muted,
    bgmVolume: clampVolume(
      record.bgmVolume,
      DEFAULT_AUDIO_PREFERENCES.bgmVolume,
    ),
    bgsVolume: clampVolume(
      record.bgsVolume,
      DEFAULT_AUDIO_PREFERENCES.bgsVolume,
    ),
    sfxVolume: clampVolume(
      record.sfxVolume,
      DEFAULT_AUDIO_PREFERENCES.sfxVolume,
    ),
  };
}

export function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (error) {
    if (!storageUnavailableWarned) {
      storageUnavailableWarned = true;
      console.warn(
        `[GameplayAudio] localStorage unavailable (${describeError(error)}); audio preferences will not persist across relaunch`,
      );
    }
    return null;
  }
}

export function loadAudioPreferences(
  storage: StorageLike | null = browserStorage(),
): AudioPreferences {
  // Always hand back a fresh object. Callers wrap the result in a Svelte 5
  // $state() proxy, whose writes propagate to the underlying target. Returning
  // the shared DEFAULT_AUDIO_PREFERENCES here would let updateAudioPreferences
  // mutate the module-level canonical defaults (e.g. breaking resetAudioPreferences).
  if (!storage) return { ...DEFAULT_AUDIO_PREFERENCES };
  try {
    const text = storage.getItem(AUDIO_PREFERENCES_STORAGE_KEY);
    if (!text) return { ...DEFAULT_AUDIO_PREFERENCES };
    return normalizeAudioPreferences(JSON.parse(text));
  } catch (error) {
    // loadAudioPreferences runs once at startup, so this is naturally
    // one-shot in production — no dedupe flag needed (and a flag would make
    // the unit-test assertion depend on test ordering).
    console.warn(
      `[GameplayAudio] stored audio preferences could not be read (${describeError(error)}); using defaults`,
    );
    return { ...DEFAULT_AUDIO_PREFERENCES };
  }
}

export function saveAudioPreferences(
  preferences: AudioPreferences,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      AUDIO_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalizeAudioPreferences(preferences)),
    );
    return true;
  } catch (error) {
    if (!saveFailureWarned) {
      saveFailureWarned = true;
      console.warn(
        `[GameplayAudio] audio preferences could not be saved (${describeError(error)}); changes will not persist across relaunch`,
      );
    }
    return false;
  }
}
