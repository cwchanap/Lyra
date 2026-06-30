import "@testing-library/jest-dom/vitest";

// Several behaviors persist to localStorage (story clearance
// `lyra.storyClearedOnce.v1`, audio preferences), and the behavioral tests
// assert against the persisted value, so they need a working Storage.
// jsdom 29.1.1 exposes a native `window.localStorage`, so the shim below is
// not installed in the current environment; it remains as a fallback for any
// future environment (e.g. happy-dom) that lacks a working localStorage.
// Tests reset it via `window.localStorage.clear()` in their
// beforeEach/afterEach.
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  const localStorageShim: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: localStorageShim,
    configurable: true,
    writable: true,
  });
}
