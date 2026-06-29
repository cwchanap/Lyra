export const STORY_CLEARED_STORAGE_KEY = "lyra.storyClearedOnce.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

let storageUnavailableWarned = false;
let loadFailureWarned = false;
let saveFailureWarned = false;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.name || error.message;
  return String(error);
}

export function browserStoryClearanceStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (error) {
    if (!storageUnavailableWarned) {
      storageUnavailableWarned = true;
      console.warn(
        `[StoryClearance] localStorage unavailable (${describeError(error)}); scene navigation unlock will not persist across relaunch`,
      );
    }
    return null;
  }
}

export function loadStoryClearedOnce(
  storage: StorageLike | null = browserStoryClearanceStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(STORY_CLEARED_STORAGE_KEY) === "true";
  } catch (error) {
    if (!loadFailureWarned) {
      loadFailureWarned = true;
      console.warn(
        `[StoryClearance] stored story-clearance flag could not be read (${describeError(error)}); scene navigation remains locked`,
      );
    }
    return false;
  }
}

export function saveStoryClearedOnce(
  storage: StorageLike | null = browserStoryClearanceStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORY_CLEARED_STORAGE_KEY, "true");
    return true;
  } catch (error) {
    if (!saveFailureWarned) {
      saveFailureWarned = true;
      console.warn(
        `[StoryClearance] story-clearance flag could not be saved (${describeError(error)}); scene navigation unlock will not persist across relaunch`,
      );
    }
    return false;
  }
}

/**
 * Reset the module-scoped warn-once latches. Intended only for tests so each
 * case can exercise the warning paths independently without being affected by
 * prior executions (the warn-once flags persist for the lifetime of the
 * module instance). Has no effect in production.
 */
export function __resetStoryClearanceWarningLatches(): void {
  storageUnavailableWarned = false;
  loadFailureWarned = false;
  saveFailureWarned = false;
}
