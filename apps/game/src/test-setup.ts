import "@testing-library/jest-dom/vitest";

// Under Vitest, neither the jsdom nor happy-dom environment exposes a working
// `window.localStorage` — the environment's global-transfer drops it
// (sessionStorage survives, localStorage does not). Several behaviors persist
// to localStorage (story clearance `lyra.storyClearedOnce.v1`, audio
// preferences), and the production code (`browserStoryClearanceStorage`)
// guards against this, but the behavioral tests assert against the persisted
// value, so they need a working Storage. Provide a minimal in-memory shim
// scoped to the test environment. Tests reset it via
// `window.localStorage.clear()` in their beforeEach/afterEach.
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
