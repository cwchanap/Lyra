import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExitStatusView,
  PersistenceHealthView,
  ThumbnailActivityView,
} from "./types";

const mocks = vi.hoisted(() => ({
  getExitStatus: vi.fn(),
  getPersistenceStatus: vi.fn(),
  getThumbnailActivity: vi.fn(),
  listen: vi.fn(),
  sequence: [] as string[],
}));

vi.mock("./commands", () => ({
  getExitStatus: mocks.getExitStatus,
  getPersistenceStatus: mocks.getPersistenceStatus,
  getThumbnailActivity: mocks.getThumbnailActivity,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

type EventHandler<T> = (event: { payload: T }) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetModules();
  mocks.sequence.splice(0);
  mocks.getPersistenceStatus.mockReset().mockImplementation(async () => {
    mocks.sequence.push("get:persistence");
    return { type: "healthy" } satisfies PersistenceHealthView;
  });
  mocks.getThumbnailActivity.mockReset().mockImplementation(async () => {
    mocks.sequence.push("get:thumbnail");
    return { type: "idle" } satisfies ThumbnailActivityView;
  });
  mocks.getExitStatus.mockReset().mockImplementation(async () => {
    mocks.sequence.push("get:exit");
    return { type: "idle" } satisfies ExitStatusView;
  });
  mocks.listen.mockReset().mockImplementation(async (name: string) => {
    mocks.sequence.push(`listen:${name}`);
    return vi.fn();
  });
});

describe("persistence event-backed store", () => {
  it("bootstraps getters, subscribes, then reconciles every channel", async () => {
    const { createPersistenceStore } =
      await import("./persistence-store.svelte");
    const store = createPersistenceStore();

    const teardown = await store.start();

    expect(store.persistenceStatus).toEqual({ type: "healthy" });
    expect(store.thumbnailActivity).toEqual({ type: "idle" });
    expect(store.exitStatus).toEqual({ type: "idle" });
    expect(mocks.sequence).toEqual([
      "get:persistence",
      "get:thumbnail",
      "get:exit",
      "listen:persistence-status-changed",
      "listen:thumbnail-activity-changed",
      "listen:exit-status-changed",
      "get:persistence",
      "get:thumbnail",
      "get:exit",
    ]);
    await teardown();
  });

  it("reconciles an event missed in the initial getter-to-listener gap", async () => {
    const healthy = { type: "healthy" } satisfies PersistenceHealthView;
    const degraded = {
      type: "degraded",
      diagnostic: { code: "saveWriteFailed", message: "write failed" },
    } satisfies PersistenceHealthView;
    let backendStatus: PersistenceHealthView = healthy;
    mocks.getPersistenceStatus.mockImplementation(async () => backendStatus);
    mocks.listen.mockImplementation(async (name: string) => {
      if (name === "persistence-status-changed") {
        backendStatus = degraded;
      }
      return vi.fn();
    });
    const { createPersistenceStore } =
      await import("./persistence-store.svelte");
    const store = createPersistenceStore();

    const teardown = await store.start();

    expect(store.persistenceStatus).toEqual(degraded);
    expect(mocks.getPersistenceStatus).toHaveBeenCalledTimes(2);
    await teardown();
  });

  it("does not let a late reconciliation getter overwrite a newer event", async () => {
    const healthy = { type: "healthy" } satisfies PersistenceHealthView;
    const degraded = {
      type: "degraded",
      diagnostic: { code: "saveWriteFailed", message: "write failed" },
    } satisfies PersistenceHealthView;
    const reconciliation = deferred<PersistenceHealthView>();
    const handlers = new Map<string, EventHandler<unknown>>();
    mocks.getPersistenceStatus
      .mockResolvedValueOnce(healthy)
      .mockReturnValueOnce(reconciliation.promise);
    mocks.listen.mockImplementation(
      async (name: string, handler: EventHandler<unknown>) => {
        handlers.set(name, handler);
        return vi.fn();
      },
    );
    const { createPersistenceStore } =
      await import("./persistence-store.svelte");
    const store = createPersistenceStore();

    const starting = store.start();
    await vi.waitFor(() =>
      expect(mocks.getPersistenceStatus).toHaveBeenCalledTimes(2),
    );
    handlers.get("persistence-status-changed")?.({ payload: degraded });
    reconciliation.resolve(healthy);
    const teardown = await starting;

    expect(store.persistenceStatus).toEqual(degraded);
    await teardown();
  });

  it("replaces each complete value wholesale for duplicate or skipped events", async () => {
    const handlers = new Map<string, EventHandler<unknown>>();
    mocks.listen.mockImplementation(
      async (name: string, handler: EventHandler<unknown>) => {
        handlers.set(name, handler);
        return vi.fn();
      },
    );
    const { createPersistenceStore } =
      await import("./persistence-store.svelte");
    const store = createPersistenceStore();
    const teardown = await store.start();
    const degraded = {
      type: "degraded",
      diagnostic: { code: "saveWriteFailed", message: "write failed" },
    } satisfies PersistenceHealthView;
    const unavailable = {
      type: "unavailable",
      diagnostic: {
        reason: "captureUnavailable",
        message: "capture failed",
        retryable: true,
      },
    } satisfies ThumbnailActivityView;
    const saving = { type: "saving" } satisfies ExitStatusView;

    handlers.get("persistence-status-changed")?.({ payload: degraded });
    handlers.get("persistence-status-changed")?.({ payload: degraded });
    handlers.get("thumbnail-activity-changed")?.({ payload: unavailable });
    handlers.get("exit-status-changed")?.({ payload: saving });

    expect(store.persistenceStatus).toEqual(degraded);
    expect(store.thumbnailActivity).toEqual(unavailable);
    expect(store.exitStatus).toEqual(saving);
    await teardown();
  });

  it("returns one teardown that attempts all unlisteners despite one rejection", async () => {
    const unlistenPersistence = vi.fn();
    const unlistenThumbnail = vi.fn(() =>
      Promise.reject(new Error("already closed")),
    );
    const unlistenExit = vi.fn();
    mocks.listen
      .mockResolvedValueOnce(unlistenPersistence)
      .mockResolvedValueOnce(unlistenThumbnail)
      .mockResolvedValueOnce(unlistenExit);
    const { createPersistenceStore } =
      await import("./persistence-store.svelte");
    const store = createPersistenceStore();

    const teardown = await store.start();
    await expect(teardown()).resolves.toBeUndefined();
    await expect(teardown()).resolves.toBeUndefined();

    expect(unlistenPersistence).toHaveBeenCalledTimes(1);
    expect(unlistenThumbnail).toHaveBeenCalledTimes(1);
    expect(unlistenExit).toHaveBeenCalledTimes(1);
  });

  it.each([2, 3])(
    "rolls back every earlier listener when listener %i setup fails",
    async (failureCall) => {
      const unlisteners = [
        vi.fn(() => Promise.reject(new Error("cleanup failed"))),
        vi.fn(),
      ];
      let call = 0;
      mocks.listen.mockImplementation(async () => {
        call += 1;
        if (call === failureCall) throw new Error("listen failed");
        return unlisteners[call - 1] ?? vi.fn();
      });
      const { createPersistenceStore } =
        await import("./persistence-store.svelte");
      const store = createPersistenceStore();

      await expect(store.start()).rejects.toThrow("listen failed");

      for (const unlisten of unlisteners.slice(0, failureCall - 1)) {
        expect(unlisten).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("rolls back all listeners when reconciliation fails", async () => {
    const unlisteners = [vi.fn(), vi.fn(), vi.fn()];
    mocks.listen
      .mockResolvedValueOnce(unlisteners[0])
      .mockResolvedValueOnce(unlisteners[1])
      .mockResolvedValueOnce(unlisteners[2]);
    mocks.getPersistenceStatus
      .mockResolvedValueOnce({ type: "healthy" })
      .mockRejectedValueOnce(new Error("reconciliation failed"));
    const { createPersistenceStore } =
      await import("./persistence-store.svelte");
    const store = createPersistenceStore();

    await expect(store.start()).rejects.toThrow("reconciliation failed");

    for (const unlisten of unlisteners) {
      expect(unlisten).toHaveBeenCalledTimes(1);
    }
  });
});
