import { describe, expect, it } from "vitest";
import {
  AUDIO_PREFERENCES_STORAGE_KEY,
  DEFAULT_AUDIO_PREFERENCES,
  loadAudioPreferences,
  normalizeAudioPreferences,
  saveAudioPreferences,
} from "./audio-preferences";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("audio preferences", () => {
  it("returns defaults when storage is unavailable", () => {
    expect(loadAudioPreferences(null)).toEqual(DEFAULT_AUDIO_PREFERENCES);
  });

  it("normalizes malformed and out-of-range values", () => {
    expect(
      normalizeAudioPreferences({
        muted: "yes",
        bgmVolume: 2,
        bgsVolume: -1,
        sfxVolume: 0.25,
      }),
    ).toEqual({
      muted: false,
      bgmVolume: 1,
      bgsVolume: 0,
      sfxVolume: 0.25,
    });
  });

  it("loads valid stored preferences", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      AUDIO_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        muted: true,
        bgmVolume: 0.4,
        bgsVolume: 0.5,
        sfxVolume: 0.6,
      }),
    );
    expect(loadAudioPreferences(storage)).toEqual({
      muted: true,
      bgmVolume: 0.4,
      bgsVolume: 0.5,
      sfxVolume: 0.6,
    });
  });

  it("falls back to defaults for invalid stored JSON", () => {
    const storage = new MemoryStorage();
    storage.setItem(AUDIO_PREFERENCES_STORAGE_KEY, "{bad json");
    expect(loadAudioPreferences(storage)).toEqual(DEFAULT_AUDIO_PREFERENCES);
  });

  it("saves normalized preferences", () => {
    const storage = new MemoryStorage();
    const saved = saveAudioPreferences(
      { muted: true, bgmVolume: 9, bgsVolume: 0.2, sfxVolume: -3 },
      storage,
    );
    expect(saved).toBe(true);
    expect(
      JSON.parse(storage.getItem(AUDIO_PREFERENCES_STORAGE_KEY) ?? "{}"),
    ).toEqual({
      muted: true,
      bgmVolume: 1,
      bgsVolume: 0.2,
      sfxVolume: 0,
    });
  });
});
