import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getExitStatus,
  getPersistenceStatus,
  getThumbnailActivity,
} from "./commands";
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
      const unlisteners: UnlistenFn[] = [];
      const versions = {
        persistence: 0,
        thumbnail: 0,
        exit: 0,
      };
      let cleanupPromise: Promise<void> | null = null;

      function cleanup(): Promise<void> {
        cleanupPromise ??= Promise.allSettled(
          unlisteners
            .splice(0)
            .map((unlisten) => Promise.resolve().then(() => unlisten())),
        ).then(() => undefined);
        return cleanupPromise;
      }

      try {
        state.persistenceStatus = await getPersistenceStatus();
        state.thumbnailActivity = await getThumbnailActivity();
        state.exitStatus = await getExitStatus();

        unlisteners.push(
          await listen<PersistenceHealthView>(
            "persistence-status-changed",
            (event) => {
              versions.persistence += 1;
              state.persistenceStatus = event.payload;
            },
          ),
        );
        unlisteners.push(
          await listen<ThumbnailActivityView>(
            "thumbnail-activity-changed",
            (event) => {
              versions.thumbnail += 1;
              state.thumbnailActivity = event.payload;
            },
          ),
        );
        unlisteners.push(
          await listen<ExitStatusView>("exit-status-changed", (event) => {
            versions.exit += 1;
            state.exitStatus = event.payload;
          }),
        );

        const persistenceVersion = versions.persistence;
        const persistenceStatus = await getPersistenceStatus();
        if (versions.persistence === persistenceVersion) {
          state.persistenceStatus = persistenceStatus;
        }

        const thumbnailVersion = versions.thumbnail;
        const thumbnailActivity = await getThumbnailActivity();
        if (versions.thumbnail === thumbnailVersion) {
          state.thumbnailActivity = thumbnailActivity;
        }

        const exitVersion = versions.exit;
        const exitStatus = await getExitStatus();
        if (versions.exit === exitVersion) {
          state.exitStatus = exitStatus;
        }

        return cleanup;
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
  };
}

export const persistenceStore = createPersistenceStore();
