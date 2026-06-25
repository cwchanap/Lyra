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
  } catch {
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
  } catch {
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
  } catch {
    return false;
  }
}
