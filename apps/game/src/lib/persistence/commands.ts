import { invoke } from "@tauri-apps/api/core";
import type {
  ExitStatusView,
  GameError,
  GameplayCommandResultView,
  PersistenceHealthView,
  SaveSlotRef,
  ThumbnailActivityView,
  ThumbnailCapturePurposeView,
  ThumbnailCaptureRequestView,
} from "./types";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const developmentHttpBase = "http://127.0.0.1:1421";
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

function assertDevelopmentFallback(): void {
  if (!import.meta.env.DEV) {
    throw new Error(
      "Tauri runtime unavailable; HTTP fallback is disabled in production builds.",
    );
  }
}

function throwHttpError(
  command: string,
  response: Response,
  text: string,
): never {
  try {
    throw JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(text || `${command} failed (${response.status})`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function developmentJson<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  assertDevelopmentFallback();
  const response = await fetch(`${developmentHttpBase}/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throwHttpError(command, response, text);
  }
  return JSON.parse(text) as T;
}

export async function invokePersistenceCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return isTauri
      ? await invoke<T>(command, args)
      : await developmentJson<T>(command, args);
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

export function prepareSaveThumbnail(
  purpose: ThumbnailCapturePurposeView,
): Promise<ThumbnailCaptureRequestView> {
  return invokePersistenceCommand("prepare_save_thumbnail", { purpose });
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
    if (isTauri) {
      return await invoke<ThumbnailActivityView>(
        "submit_save_thumbnail",
        bytes,
        { headers: { [thumbnailTicketHeader]: ticket } },
      );
    }
    assertDevelopmentFallback();
    const response = await fetch(
      `${developmentHttpBase}/submit_save_thumbnail`,
      {
        method: "POST",
        headers: { [thumbnailTicketHeader]: ticket },
        body: bytes,
      },
    );
    const body = await response.text();
    if (!response.ok) {
      throwHttpError("submit_save_thumbnail", response, body);
    }
    return JSON.parse(body) as ThumbnailActivityView;
  } catch (error) {
    throw asGameError(error);
  }
}

export async function readSaveThumbnail(
  reference: SaveSlotRef,
  observedSaveId: string,
): Promise<Uint8Array> {
  try {
    const response = isTauri
      ? await invoke<ArrayBuffer | Uint8Array>("read_save_thumbnail", {
          reference,
          observedSaveId,
        })
      : await readDevelopmentThumbnail(reference, observedSaveId);
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

async function readDevelopmentThumbnail(
  reference: SaveSlotRef,
  observedSaveId: string,
): Promise<ArrayBuffer> {
  assertDevelopmentFallback();
  const response = await fetch(`${developmentHttpBase}/read_save_thumbnail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference, observedSaveId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throwHttpError("read_save_thumbnail", response, text);
  }
  return response.arrayBuffer();
}

export function acknowledgeAcquisitionEvent(
  eventId: string,
  preparedThumbnailTicket: string,
): Promise<GameplayCommandResultView> {
  return invokePersistenceCommand("acknowledge_acquisition_event", {
    eventId,
    preparedThumbnailTicket,
  });
}

export function confirmAcquisitionWithoutSaving(
  eventId: string,
  failureToken: string,
): Promise<GameplayCommandResultView> {
  return invokePersistenceCommand("confirm_acquisition_without_saving", {
    eventId,
    failureToken,
  });
}

export function retryAcquisitionAcknowledgement(
  eventId: string,
  failureToken: string,
): Promise<ThumbnailCaptureRequestView> {
  return invokePersistenceCommand("retry_acquisition_acknowledgement", {
    eventId,
    failureToken,
  });
}

export function cancelAcquisitionFailure(
  eventId: string,
  failureToken: string,
): Promise<GameplayCommandResultView> {
  return invokePersistenceCommand("cancel_acquisition_failure", {
    eventId,
    failureToken,
  });
}
