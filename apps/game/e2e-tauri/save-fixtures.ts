import {
  SAVE_E2E_PHASE_NAMES as nodePhaseNames,
  assertNoUnknownSaveE2eSidecars as assertNoUnknownSidecars,
  assertSafeSaveE2eAppDataDir,
  corruptSaveE2eObservedSidecar as corruptObservedSidecar,
  corruptSaveE2eSlot as corruptSlot,
  readSaveE2eControlExpectation as readControlExpectation,
  readSaveE2eSlotFiles as readSlotFiles,
  removeSaveE2eObservedSidecar as removeObservedSidecar,
  resolveSaveE2eObservedSidecar as resolveObservedSidecar,
  writeSaveE2eControlExpectation as writeControlExpectation,
} from "../scripts/save-e2e-paths.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const SAVE_E2E_PHASE_NAMES = nodePhaseNames;

export type SaveE2eFixedSlotName =
  | "autosave-1"
  | "autosave-2"
  | "autosave-3"
  | "autosave-4"
  | "autosave-5"
  | "manual-1"
  | "manual-2"
  | "manual-3";

export type SaveE2eSlotFile = {
  fixedSlotName: SaveE2eFixedSlotName;
  path: string;
  text: string | null;
  modifiedAtMs: number | null;
};

export type ExpectedResumeCheckpoint = {
  saveId: string;
  displayName: string;
  chapterId: string;
  sceneId: string;
  queueGen: number;
  cursor: number;
  currentDialogueFingerprint: string;
};

export type SeedControl = {
  documentIdentity: string;
  checkpoint: ExpectedResumeCheckpoint;
  composite: {
    fixedSlotName: "manual-2";
    saveId: string;
    queueGen: number;
    cursor: number;
    currentDialogueFingerprint: string;
    pendingEventIds: [string, string];
    sceneSnapshot: SaveE2eInvestigationSceneSnapshot;
    inventorySnapshot: SaveE2eInventorySnapshot;
    visualCueSnapshot: SaveE2eVisualCueSnapshot;
  };
  interrogation: {
    fixedSlotName: "manual-3";
    saveId: string;
    phaseId: string;
    presenting: boolean;
    sceneSnapshot: SaveE2eInterrogationSceneSnapshot;
    inventorySnapshot: SaveE2eInventorySnapshot;
    visualCueSnapshot: SaveE2eVisualCueSnapshot;
  };
  acknowledgementAutosave: SaveE2eFixedSlotName;
};

export type SaveE2eThumbnailDescriptor =
  | { type: "unavailable" }
  | {
      type: "available";
      objectId: string;
      width: number;
      height: number;
      sha256: string;
    };

export type SaveE2eInvestigationOverride =
  | { type: "hotspot"; id: string }
  | { type: "sublocation"; id: string }
  | { type: "topic"; characterId: string; topicId: string };

export type SaveE2eInterrogationOverride =
  | { type: "question"; id: string }
  | { type: "phase"; id: string };

export type SaveE2eInvestigationSceneSnapshot = {
  type: "investigation";
  introPlayed: boolean;
  outroPlayed: boolean;
  currentSublocationId: string | null;
  inspectedHotspotIds: string[];
  discussedTopicIds: Array<{ characterId: string; topicId: string }>;
  enteredSublocationIds: string[];
  unlockedOverrides: SaveE2eInvestigationOverride[];
};

export type SaveE2eCrossExamSnapshot =
  | { type: "idle" }
  | { type: "playing"; questionId: string; lineId: string }
  | { type: "presenting"; questionId: string; lineId: string };

export type SaveE2eInterrogationSceneSnapshot = {
  type: "interrogation";
  introPlayed: boolean;
  outroPlayed: boolean;
  currentPhaseId: string | null;
  crossExam: SaveE2eCrossExamSnapshot;
  brokenQuestionIds: string[];
  completedPhaseIds: string[];
  unlockedOverrides: SaveE2eInterrogationOverride[];
  enteredPhaseIds: string[];
  lineContentSegmentIndex: number | null;
};

export type SaveE2eSceneSnapshot =
  | { type: "linear" }
  | { type: "gameComplete" }
  | SaveE2eInvestigationSceneSnapshot
  | SaveE2eInterrogationSceneSnapshot;

/**
 * Save schema v1 inventory payload. These entries intentionally remain
 * ID-and-acquisition-origin only; immutable provenance rejoins from the exact
 * packaged content and is exposed separately by the public game-state view.
 */
export type SaveE2eInventorySnapshot = {
  evidence: Array<{
    recordId: string;
    collectedInChapterId: string;
    collectedInSceneId: string;
  }>;
  statements: Array<{
    recordId: string;
    acquiredInChapterId: string;
    acquiredInSceneId: string;
  }>;
};

export type SaveE2eVisualCueSnapshot = {
  sceneTag: string | null;
  backgroundAssetId: string | null;
  bgm: { channel: "bgm"; assetId: string | null } | null;
  bgs: { channel: "bgs"; assetId: string | null } | null;
};

type SaveE2eSaveSummaryV1 = {
  chapterId: string;
  chapterTitle: string;
  sceneId: string;
  sceneTitle: string;
  activePrimaryObjectiveId: string | null;
  activePrimaryObjectiveLabel: string | null;
};

type SaveE2eSaveSummaryV2 = SaveE2eSaveSummaryV1 & {
  chapterSummary: string | null;
  sceneSummary: string | null;
  activePrimaryObjectiveSummary: string | null;
};

type SaveE2eSaveEnvelopeBase = {
  contentRevision: string;
  saveId: string;
  saveType: "auto" | "manual";
  slot: number;
  savedAt: string;
  displayName: string;
  thumbnail: SaveE2eThumbnailDescriptor;
  snapshot: {
    chapterId: string;
    sceneId: string;
    scene: SaveE2eSceneSnapshot;
    activeDialogue: {
      activeSegmentIndex: number;
      itemCursor: number;
      queueGen: number;
    } | null;
    lastVisualCue: SaveE2eVisualCueSnapshot;
    inventory: SaveE2eInventorySnapshot;
    [key: string]: unknown;
  };
};

/** Frozen schema-v1 shape retained for migration fixtures only. */
export type SaveE2eSaveEnvelopeV1 = SaveE2eSaveEnvelopeBase & {
  schemaVersion: 1;
  summary: SaveE2eSaveSummaryV1;
};

/** Current envelope shape produced by every new manual save and autosave. */
export type SaveE2eSaveEnvelopeV2 = SaveE2eSaveEnvelopeBase & {
  schemaVersion: 2;
  summary: SaveE2eSaveSummaryV2;
};

export type SaveE2eSaveEnvelope = SaveE2eSaveEnvelopeV1 | SaveE2eSaveEnvelopeV2;

export type SaveE2eOwnershipSnapshot = {
  slots: Array<{
    fixedSlotName: SaveE2eFixedSlotName;
    modifiedAtMs: number | null;
    envelope: SaveE2eSaveEnvelope | null;
    parseError: boolean;
    sidecarPath: string | null;
    sidecarSha256: string | null;
  }>;
};

export type E2ePersistenceFaultBoundary =
  | "thumbnailInstall"
  | "envelopeReplace"
  | "savesDirectorySync"
  | "exitFlush";

export function saveE2eAppDataDir(): string {
  const root = process.env.LYRA_E2E_APP_DATA_DIR;
  if (!root) {
    throw new Error("LYRA_E2E_APP_DATA_DIR is required for save e2e fixtures.");
  }
  return assertSafeSaveE2eAppDataDir(root);
}

export function readSaveE2eSlots(): SaveE2eSlotFile[] {
  return readSlotFiles(saveE2eAppDataDir()) as SaveE2eSlotFile[];
}

export function readSaveE2eEnvelope(
  fixedSlotName: SaveE2eFixedSlotName,
): SaveE2eSaveEnvelope | null {
  const slot = readSaveE2eSlots().find(
    (candidate) => candidate.fixedSlotName === fixedSlotName,
  );
  if (!slot || slot.text === null) return null;
  return JSON.parse(slot.text) as SaveE2eSaveEnvelope;
}

export async function waitForSaveE2eEnvelope(
  fixedSlotName: SaveE2eFixedSlotName,
  predicate: (envelope: SaveE2eSaveEnvelope) => boolean = () => true,
  timeoutMs = 30000,
): Promise<SaveE2eSaveEnvelope> {
  const deadline = Date.now() + timeoutMs;
  let last: SaveE2eSaveEnvelope | null = null;
  while (Date.now() < deadline) {
    try {
      last = readSaveE2eEnvelope(fixedSlotName);
      if (last && predicate(last)) return last;
    } catch {
      // Atomic replacement can expose no parseable envelope for a short
      // interval only on a failing implementation; keep polling so the final
      // error reports the owned slot rather than a transient JSON exception.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `save e2e envelope ${fixedSlotName} did not reach the expected state; last=${JSON.stringify(last)}`,
  );
}

export function readSaveE2eOwnershipSnapshot(): SaveE2eOwnershipSnapshot {
  return {
    slots: readSaveE2eSlots().map((slot) => {
      if (slot.text === null) {
        return {
          fixedSlotName: slot.fixedSlotName,
          modifiedAtMs: null,
          envelope: null,
          parseError: false,
          sidecarPath: null,
          sidecarSha256: null,
        };
      }
      let envelope: SaveE2eSaveEnvelope;
      try {
        envelope = JSON.parse(slot.text) as SaveE2eSaveEnvelope;
      } catch {
        return {
          fixedSlotName: slot.fixedSlotName,
          modifiedAtMs: slot.modifiedAtMs,
          envelope: null,
          parseError: true,
          sidecarPath: null,
          sidecarSha256: null,
        };
      }
      let sidecarPath: string | null = null;
      let sidecarSha256: string | null = null;
      if (envelope.thumbnail.type === "available") {
        sidecarPath = resolveSaveE2eFixedSlotSidecar(slot.fixedSlotName);
        if (existsSync(sidecarPath)) {
          sidecarSha256 = `sha256:${createHash("sha256")
            .update(readFileSync(sidecarPath))
            .digest("hex")}`;
        }
      }
      return {
        fixedSlotName: slot.fixedSlotName,
        modifiedAtMs: slot.modifiedAtMs,
        envelope,
        parseError: false,
        sidecarPath,
        sidecarSha256,
      };
    }),
  };
}

export type SaveE2eOwnershipSlot = SaveE2eOwnershipSnapshot["slots"][number];

/**
 * Filter a snapshot down to autosave slots that carry a parseable envelope.
 */
export function autosaveSlots(
  snapshot: SaveE2eOwnershipSnapshot = readSaveE2eOwnershipSnapshot(),
): SaveE2eOwnershipSlot[] {
  return snapshot.slots.filter(
    (slot) =>
      slot.fixedSlotName.startsWith("autosave-") && slot.envelope !== null,
  );
}

/**
 * Select the newest autosave slot from a snapshot, ordering by filesystem
 * mtime (descending) and breaking ties with the envelope's `savedAt`
 * timestamp. Returns `undefined` when no autosave envelope exists; callers
 * are responsible for throwing with context-specific diagnostics.
 */
export function newestAutosaveSlot(
  snapshot: SaveE2eOwnershipSnapshot = readSaveE2eOwnershipSnapshot(),
): SaveE2eOwnershipSlot | undefined {
  return autosaveSlots(snapshot).toSorted((left, right) => {
    const leftMtime = left.modifiedAtMs ?? -1;
    const rightMtime = right.modifiedAtMs ?? -1;
    if (rightMtime !== leftMtime) return rightMtime - leftMtime;
    return (
      Date.parse(right.envelope!.savedAt) - Date.parse(left.envelope!.savedAt)
    );
  })[0];
}

export function corruptSaveE2eFixedSlot(
  fixedSlotName: SaveE2eFixedSlotName,
): void {
  corruptSlot(saveE2eAppDataDir(), fixedSlotName);
}

export function removeSaveE2eFixedSlotSidecar(
  fixedSlotName: SaveE2eFixedSlotName,
): void {
  removeObservedSidecar(saveE2eAppDataDir(), fixedSlotName);
}

export function resolveSaveE2eFixedSlotSidecar(
  fixedSlotName: SaveE2eFixedSlotName,
): string {
  return resolveObservedSidecar(saveE2eAppDataDir(), fixedSlotName);
}

export function corruptSaveE2eFixedSlotSidecar(
  fixedSlotName: SaveE2eFixedSlotName,
): void {
  corruptObservedSidecar(saveE2eAppDataDir(), fixedSlotName);
}

export function assertSaveE2eSidecarOwnership(): void {
  assertNoUnknownSidecars(saveE2eAppDataDir());
}

export function writeSaveE2eExpectation(
  name: "expected-resume-checkpoint" | "management-state" | "exit-state",
  value: unknown,
): void {
  writeControlExpectation(saveE2eAppDataDir(), name, value);
}

export function readSaveE2eExpectation<T>(
  name: "expected-resume-checkpoint" | "management-state" | "exit-state",
): T {
  return readControlExpectation(saveE2eAppDataDir(), name) as T;
}

export async function setNextPersistenceFault(
  boundary: E2ePersistenceFaultBoundary,
): Promise<void> {
  const result: { ok: true } | { ok: false; message: string } =
    await browser.execute(
      async (
        selectedBoundary: E2ePersistenceFaultBoundary,
      ): Promise<{ ok: true } | { ok: false; message: string }> => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__?: {
              invoke: (
                command: string,
                args: Record<string, unknown>,
              ) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__;
        if (!internals) {
          return { ok: false, message: "Tauri internals are unavailable." };
        }
        try {
          await internals.invoke("e2e_set_persistence_fault", {
            boundary: selectedBoundary,
            occurrenceCount: 1,
          });
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
      boundary,
    );
  if (!result.ok) {
    throw new Error(`Could not arm E2E persistence fault: ${result.message}`);
  }
}
