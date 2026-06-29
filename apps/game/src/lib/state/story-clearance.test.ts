import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORY_CLEARED_STORAGE_KEY,
  browserStoryClearanceStorage,
  loadStoryClearedOnce,
  saveStoryClearedOnce,
} from "./story-clearance";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("story clearance entitlement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage?.clear?.();
  });

  it("defaults to false when storage is unavailable or empty", () => {
    expect(loadStoryClearedOnce(null)).toBe(false);
    expect(loadStoryClearedOnce(new MemoryStorage())).toBe(false);
  });

  it("loads only an explicit true value as cleared", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORY_CLEARED_STORAGE_KEY, "true");
    expect(loadStoryClearedOnce(storage)).toBe(true);

    storage.setItem(STORY_CLEARED_STORAGE_KEY, "false");
    expect(loadStoryClearedOnce(storage)).toBe(false);

    storage.setItem(STORY_CLEARED_STORAGE_KEY, "yes");
    expect(loadStoryClearedOnce(storage)).toBe(false);
  });

  it("persists the cleared flag", () => {
    const storage = new MemoryStorage();
    expect(saveStoryClearedOnce(storage)).toBe(true);
    expect(storage.getItem(STORY_CLEARED_STORAGE_KEY)).toBe("true");
  });

  it("warns and returns false when saving fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota denied");
      },
    };

    expect(saveStoryClearedOnce(failing)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[StoryClearance]"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be saved"),
    );
  });

  it("warns at most once when loading fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw new Error("read denied");
      },
      setItem: () => undefined,
    };

    expect(loadStoryClearedOnce(failing)).toBe(false);
    expect(loadStoryClearedOnce(failing)).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[StoryClearance]"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be read"),
    );
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
      expect(browserStoryClearanceStorage()).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("[StoryClearance]"),
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

// `describeError` has two branches that the warn-once tests above don't
// reach: a non-Error thrown value (String() fallback) and an Error whose
// `name` is empty (message fallback). The module-level warn-once flags
// persist across tests in a single module instance, so isolate these in a
// fresh module via vi.resetModules() to re-arm the flags and actually hit
// the describeError call sites.
describe("story clearance describeError branches", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("describes a non-Error thrown value via String()", async () => {
    const { saveStoryClearedOnce } = await import("./story-clearance");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => null,
      setItem: () => {
        throw "quota string";
      },
    };

    expect(saveStoryClearedOnce(failing)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be saved"),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("quota string"));
  });

  it("falls back to error.message when error.name is empty", async () => {
    const { loadStoryClearedOnce } = await import("./story-clearance");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = new Error("read denied");
    Object.defineProperty(err, "name", { value: "" });
    const failing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw err;
      },
      setItem: () => undefined,
    };

    expect(loadStoryClearedOnce(failing)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be read"),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("read denied"));
  });
});
