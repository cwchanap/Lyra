import { invoke } from "@tauri-apps/api/core";
import type {
  ExitStatusView,
  GameError,
  PersistenceHealthView,
  SaveSlotRef,
  ThumbnailActivityView,
} from "./types";

const thumbnailTicketHeader = "x-lyra-thumbnail-ticket";

export function asGameError(error: unknown): GameError {
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      failureToken?: unknown;
    };
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    ) {
      return typeof candidate.failureToken === "string"
        ? {
            code: candidate.code,
            message: candidate.message,
            failureToken: candidate.failureToken,
          }
        : { code: candidate.code, message: candidate.message };
    }
    if (typeof candidate.message === "string") {
      return { code: "persistenceCommandFailed", message: candidate.message };
    }
  }
  if (typeof error === "string") {
    return { code: "persistenceCommandFailed", message: error };
  }
  return {
    code: "persistenceCommandFailed",
    message: "Persistence command failed.",
  };
}

export async function invokePersistenceCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw asGameError(error);
  }
}

export function getPersistenceStatus(): Promise<PersistenceHealthView> {
  return invokePersistenceCommand("get_persistence_status");
}

export function getThumbnailActivity(): Promise<ThumbnailActivityView> {
  return invokePersistenceCommand("get_thumbnail_activity");
}

export function getExitStatus(): Promise<ExitStatusView> {
  return invokePersistenceCommand("get_exit_status");
}

export function cancelPersistenceFailure(failureToken: string): Promise<void> {
  return invokePersistenceCommand("cancel_persistence_failure", {
    failureToken,
  });
}

export function reportSaveThumbnailFailure(
  ticket: string,
): Promise<ThumbnailActivityView> {
  return invokePersistenceCommand("report_save_thumbnail_failure", { ticket });
}

export async function submitSaveThumbnail(
  ticket: string,
  bytes: Uint8Array,
): Promise<ThumbnailActivityView> {
  try {
    return await invoke<ThumbnailActivityView>("submit_save_thumbnail", bytes, {
      headers: { [thumbnailTicketHeader]: ticket },
    });
  } catch (error) {
    throw asGameError(error);
  }
}

export async function readSaveThumbnail(
  reference: SaveSlotRef,
  observedSaveId: string,
): Promise<Uint8Array> {
  try {
    const response = await invoke<ArrayBuffer | Uint8Array>(
      "read_save_thumbnail",
      { reference, observedSaveId },
    );
    if (response instanceof Uint8Array) return response;
    if (response instanceof ArrayBuffer) return new Uint8Array(response);
    throw {
      code: "thumbnailCorrupt",
      message: "Thumbnail response was not binary.",
    };
  } catch (error) {
    throw asGameError(error);
  }
}
