import {
  HPA392_PHASE_NAMES as nodePhaseNames,
  assertNoUnknownHpa392Sidecars as assertNoUnknownSidecars,
  assertSafeHpa392AppDataDir,
  corruptHpa392ObservedSidecar as corruptObservedSidecar,
  corruptHpa392Slot as corruptSlot,
  readHpa392ControlExpectation as readControlExpectation,
  readHpa392SlotFiles as readSlotFiles,
  removeHpa392ObservedSidecar as removeObservedSidecar,
  resolveHpa392ObservedSidecar as resolveObservedSidecar,
  writeHpa392ControlExpectation as writeControlExpectation,
} from "../scripts/hpa-392-e2e-paths.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const HPA392_PHASE_NAMES = nodePhaseNames;

export type Hpa392FixedSlotName =
  | "autosave-1"
  | "autosave-2"
  | "autosave-3"
  | "autosave-4"
  | "autosave-5"
  | "manual-1"
  | "manual-2"
  | "manual-3";

export type Hpa392SlotFile = {
  fixedSlotName: Hpa392FixedSlotName;
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
    sceneSnapshot: Hpa392InvestigationSceneSnapshot;
    inventorySnapshot: Hpa392InventorySnapshot;
    visualCueSnapshot: Hpa392VisualCueSnapshot;
  };
  interrogation: {
    fixedSlotName: "manual-3";
    saveId: string;
    phaseId: string;
    presenting: boolean;
    sceneSnapshot: Hpa392InterrogationSceneSnapshot;
    inventorySnapshot: Hpa392InventorySnapshot;
    visualCueSnapshot: Hpa392VisualCueSnapshot;
  };
  acknowledgementAutosave: Hpa392FixedSlotName;
};

export type Hpa392ThumbnailDescriptor =
  | { type: "unavailable" }
  | {
      type: "available";
      objectId: string;
      width: number;
      height: number;
      sha256: string;
    };

export type Hpa392InvestigationOverride =
  | { type: "hotspot"; id: string }
  | { type: "sublocation"; id: string }
  | { type: "topic"; characterId: string; topicId: string };

export type Hpa392InterrogationOverride =
  | { type: "question"; id: string }
  | { type: "phase"; id: string };

export type Hpa392InvestigationSceneSnapshot = {
  type: "investigation";
  introPlayed: boolean;
  outroPlayed: boolean;
  currentSublocationId: string | null;
  inspectedHotspotIds: string[];
  discussedTopicIds: Array<{ characterId: string; topicId: string }>;
  enteredSublocationIds: string[];
  unlockedOverrides: Hpa392InvestigationOverride[];
};

export type Hpa392CrossExamSnapshot =
  | { type: "idle" }
  | { type: "playing"; questionId: string; lineId: string }
  | { type: "presenting"; questionId: string; lineId: string };

export type Hpa392InterrogationSceneSnapshot = {
  type: "interrogation";
  introPlayed: boolean;
  outroPlayed: boolean;
  currentPhaseId: string | null;
  crossExam: Hpa392CrossExamSnapshot;
  brokenQuestionIds: string[];
  completedPhaseIds: string[];
  unlockedOverrides: Hpa392InterrogationOverride[];
  enteredPhaseIds: string[];
  lineContentSegmentIndex: number | null;
};

export type Hpa392SceneSnapshot =
  | { type: "linear" }
  | { type: "gameComplete" }
  | Hpa392InvestigationSceneSnapshot
  | Hpa392InterrogationSceneSnapshot;

export type Hpa392InventorySnapshot = {
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

export type Hpa392VisualCueSnapshot = {
  sceneTag: string | null;
  backgroundAssetId: string | null;
  bgm: { channel: "bgm"; assetId: string | null } | null;
  bgs: { channel: "bgs"; assetId: string | null } | null;
};

export type Hpa392SaveEnvelope = {
  schemaVersion: number;
  contentRevision: string;
  saveId: string;
  saveType: "auto" | "manual";
  slot: number;
  savedAt: string;
  displayName: string;
  thumbnail: Hpa392ThumbnailDescriptor;
  summary: {
    chapterId: string;
    chapterTitle: string;
    sceneId: string;
    sceneTitle: string;
    activePrimaryObjectiveId: string | null;
    activePrimaryObjectiveLabel: string | null;
  };
  snapshot: {
    chapterId: string;
    sceneId: string;
    scene: Hpa392SceneSnapshot;
    activeDialogue: {
      activeSegmentIndex: number;
      itemCursor: number;
      queueGen: number;
    } | null;
    lastVisualCue: Hpa392VisualCueSnapshot;
    inventory: Hpa392InventorySnapshot;
    [key: string]: unknown;
  };
};

export type Hpa392OwnershipSnapshot = {
  slots: Array<{
    fixedSlotName: Hpa392FixedSlotName;
    modifiedAtMs: number | null;
    envelope: Hpa392SaveEnvelope | null;
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

export function hpa392AppDataDir(): string {
  const root = process.env.LYRA_E2E_APP_DATA_DIR;
  if (!root) {
    throw new Error("LYRA_E2E_APP_DATA_DIR is required for HPA-392 fixtures.");
  }
  return assertSafeHpa392AppDataDir(root);
}

export function readHpa392Slots(): Hpa392SlotFile[] {
  return readSlotFiles(hpa392AppDataDir()) as Hpa392SlotFile[];
}

export function readHpa392Envelope(
  fixedSlotName: Hpa392FixedSlotName,
): Hpa392SaveEnvelope | null {
  const slot = readHpa392Slots().find(
    (candidate) => candidate.fixedSlotName === fixedSlotName,
  );
  if (!slot || slot.text === null) return null;
  return JSON.parse(slot.text) as Hpa392SaveEnvelope;
}

export async function waitForHpa392Envelope(
  fixedSlotName: Hpa392FixedSlotName,
  predicate: (envelope: Hpa392SaveEnvelope) => boolean = () => true,
  timeoutMs = 30000,
): Promise<Hpa392SaveEnvelope> {
  const deadline = Date.now() + timeoutMs;
  let last: Hpa392SaveEnvelope | null = null;
  while (Date.now() < deadline) {
    try {
      last = readHpa392Envelope(fixedSlotName);
      if (last && predicate(last)) return last;
    } catch {
      // Atomic replacement can expose no parseable envelope for a short
      // interval only on a failing implementation; keep polling so the final
      // error reports the owned slot rather than a transient JSON exception.
    }
    await browser.pause(100);
  }
  throw new Error(
    `HPA-392 envelope ${fixedSlotName} did not reach the expected state; last=${JSON.stringify(last)}`,
  );
}

export function readHpa392OwnershipSnapshot(): Hpa392OwnershipSnapshot {
  return {
    slots: readHpa392Slots().map((slot) => {
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
      let envelope: Hpa392SaveEnvelope;
      try {
        envelope = JSON.parse(slot.text) as Hpa392SaveEnvelope;
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
        sidecarPath = resolveHpa392FixedSlotSidecar(slot.fixedSlotName);
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

export function corruptHpa392FixedSlot(
  fixedSlotName: Hpa392FixedSlotName,
): void {
  corruptSlot(hpa392AppDataDir(), fixedSlotName);
}

export function removeHpa392FixedSlotSidecar(
  fixedSlotName: Hpa392FixedSlotName,
): void {
  removeObservedSidecar(hpa392AppDataDir(), fixedSlotName);
}

export function resolveHpa392FixedSlotSidecar(
  fixedSlotName: Hpa392FixedSlotName,
): string {
  return resolveObservedSidecar(hpa392AppDataDir(), fixedSlotName);
}

export function corruptHpa392FixedSlotSidecar(
  fixedSlotName: Hpa392FixedSlotName,
): void {
  corruptObservedSidecar(hpa392AppDataDir(), fixedSlotName);
}

export function assertHpa392SidecarOwnership(): void {
  assertNoUnknownSidecars(hpa392AppDataDir());
}

export function writeHpa392Expectation(
  name: "expected-resume-checkpoint" | "management-state" | "exit-state",
  value: unknown,
): void {
  writeControlExpectation(hpa392AppDataDir(), name, value);
}

export function readHpa392Expectation<T>(
  name: "expected-resume-checkpoint" | "management-state" | "exit-state",
): T {
  return readControlExpectation(hpa392AppDataDir(), name) as T;
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
