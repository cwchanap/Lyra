import type {
  ExitStatusView,
  PersistenceHealthView,
  ThumbnailActivityView,
} from "./types";

export type PersistenceStore = {
  readonly persistenceStatus: PersistenceHealthView;
  readonly thumbnailActivity: ThumbnailActivityView;
  readonly exitStatus: ExitStatusView;
  start: () => Promise<() => Promise<void>>;
};

export function createPersistenceStore(): PersistenceStore {
  const state = $state<{
    persistenceStatus: PersistenceHealthView;
    thumbnailActivity: ThumbnailActivityView;
    exitStatus: ExitStatusView;
  }>({
    persistenceStatus: { type: "healthy" },
    thumbnailActivity: { type: "idle" },
    exitStatus: { type: "idle" },
  });

  return {
    get persistenceStatus() {
      return state.persistenceStatus;
    },
    get thumbnailActivity() {
      return state.thumbnailActivity;
    },
    get exitStatus() {
      return state.exitStatus;
    },
    async start() {
      state.persistenceStatus = await getPersistenceStatus();
      state.thumbnailActivity = await getThumbnailActivity();
      state.exitStatus = await getExitStatus();

      const unlisteners: UnlistenFn[] = [];
      unlisteners.push(
        await listen<PersistenceHealthView>(
          "persistence-status-changed",
          (event) => {
            state.persistenceStatus = event.payload;
          },
        ),
      );
      unlisteners.push(
        await listen<ThumbnailActivityView>(
          "thumbnail-activity-changed",
          (event) => {
            state.thumbnailActivity = event.payload;
          },
        ),
      );
      unlisteners.push(
        await listen<ExitStatusView>("exit-status-changed", (event) => {
          state.exitStatus = event.payload;
        }),
      );

      return async () => {
        await Promise.allSettled(
          unlisteners.map((unlisten) =>
            Promise.resolve().then(() => unlisten()),
          ),
        );
      };
    },
  };
}

export const persistenceStore = createPersistenceStore();
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getExitStatus,
  getPersistenceStatus,
  getThumbnailActivity,
} from "./commands";
