import "@testing-library/jest-dom/vitest";

// Several behaviors persist to localStorage (story clearance
// `lyra.storyClearedOnce.v1`, audio preferences), and the behavioral tests
// assert against the persisted value, so they need a working Storage.
// jsdom 29.1.1 exposes a native `window.localStorage`, so the shim below is
// not installed in the current environment; it remains as a fallback for any
// future environment (e.g. happy-dom) that lacks a working localStorage.
// Tests reset it via `window.localStorage.clear()` in their
// beforeEach/afterEach.
// Probe the native localStorage defensively: accessing `window.localStorage`
// can throw in some environments (e.g. cookies disabled → SecurityError), and
// an uncaught throw here would abort test setup before the shim below can be
// installed. Treat any access failure as "storage unavailable" so the fallback
// still installs.
let nativeLocalStorage: Storage | null = null;
if (typeof window !== "undefined") {
  try {
    nativeLocalStorage = window.localStorage;
  } catch {
    nativeLocalStorage = null;
  }
}

if (typeof window !== "undefined" && !nativeLocalStorage) {
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
