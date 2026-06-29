import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_PREFERENCES_STORAGE_KEY,
  DEFAULT_AUDIO_PREFERENCES,
  browserStorage,
  loadAudioPreferences,
  normalizeAudioPreferences,
  saveAudioPreferences,
} from "./audio-preferences";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "clear"> {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  clear() {
    this.values.clear();
  }
}

describe("audio preferences", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = new MemoryStorage();
    storage.setItem(AUDIO_PREFERENCES_STORAGE_KEY, "{bad json");
    expect(loadAudioPreferences(storage)).toEqual(DEFAULT_AUDIO_PREFERENCES);
    // Corrupt stored prefs must surface a warning rather than silently
    // reverting to defaults.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[GameplayAudio]"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be read"),
    );
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

  it("returns a fresh copy of the defaults (never the shared reference) on every fallback path", () => {
    // $state() proxies write through to their target. If any fallback branch
    // returned DEFAULT_AUDIO_PREFERENCES by reference, mutating the loaded
    // preferences would corrupt the module-level canonical defaults.
    // The throwing-getItem path now logs a read-failure warning; silence it
    // here so it does not clutter this unrelated fallback-reference test.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const noStorage = loadAudioPreferences(null);
    const emptyStorage = loadAudioPreferences(new MemoryStorage());
    const throwing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {},
    };
    const errored = loadAudioPreferences(throwing);

    for (const loaded of [noStorage, emptyStorage, errored]) {
      expect(loaded).toEqual(DEFAULT_AUDIO_PREFERENCES);
      expect(loaded).not.toBe(DEFAULT_AUDIO_PREFERENCES);
    }

    // Mutating any of them must leave the canonical defaults untouched.
    noStorage.muted = true;
    noStorage.bgmVolume = 0;
    expect(DEFAULT_AUDIO_PREFERENCES.muted).toBe(false);
    expect(DEFAULT_AUDIO_PREFERENCES.bgmVolume).toBe(0.55);
  });

  it("returns false when persisting throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota denied");
      },
    };
    expect(saveAudioPreferences(DEFAULT_AUDIO_PREFERENCES, failing)).toBe(
      false,
    );
    // Persistence failure must surface a warning rather than silently dropping
    // the player's preference change.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[GameplayAudio]"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be saved"),
    );
  });
});

describe("browserStorage", () => {
  let originalLocalStorageDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  afterEach(() => {
    // Match the "audio preferences" suite: restore spies/mocks (e.g. the
    // console.warn spy installed by the localStorage-throws test) so they
    // cannot leak into later tests in this file.
    vi.restoreAllMocks();
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(
        window,
        "localStorage",
        originalLocalStorageDescriptor,
      );
    } else {
      Reflect.deleteProperty(window, "localStorage");
    }
  });

  it("exposes window.localStorage in a browser-like environment", () => {
    expect(browserStorage()).toBe(window.localStorage);
  });

  it("loads preferences through the default browser storage", () => {
    window.localStorage.setItem(
      AUDIO_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        muted: true,
        bgmVolume: 0.3,
        bgsVolume: 0.4,
        sfxVolume: 0.5,
      }),
    );
    expect(loadAudioPreferences()).toEqual({
      muted: true,
      bgmVolume: 0.3,
      bgsVolume: 0.4,
      sfxVolume: 0.5,
    });
  });

  it("persists preferences through the default browser storage", () => {
    expect(saveAudioPreferences(DEFAULT_AUDIO_PREFERENCES)).toBe(true);
    expect(
      JSON.parse(
        window.localStorage.getItem(AUDIO_PREFERENCES_STORAGE_KEY) ?? "{}",
      ),
    ).toEqual(DEFAULT_AUDIO_PREFERENCES);
  });

  it("returns null when localStorage access throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(browserStorage()).toBeNull();
      // Safari private-mode SecurityError must surface a warning rather than
      // silently disabling preference persistence for the whole session.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("[GameplayAudio]"),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("localStorage unavailable"),
      );
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "localStorage", descriptor);
      }
    }
  });
});
