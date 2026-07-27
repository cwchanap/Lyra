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
  it("bootstraps complete getter snapshots before subscribing to named events", async () => {
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
    ]);
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

    expect(unlistenPersistence).toHaveBeenCalledTimes(1);
    expect(unlistenThumbnail).toHaveBeenCalledTimes(1);
    expect(unlistenExit).toHaveBeenCalledTimes(1);
  });
});
