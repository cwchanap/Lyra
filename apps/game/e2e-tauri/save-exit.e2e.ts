import {
  advanceDialogueUntil,
  advanceDialogueOnce,
  assertSaveE2ePhase,
  clickButton,
  continueFromTitle,
  currentPackagedDocumentIdentity,
  dialogueFingerprint,
  drainCurrentDialogue,
  elementExists,
  getPackagedGameState,
  isPackagedDisconnectError,
  invokePackagedCommand,
  jsClick,
  jumpToProductionScene,
  requestApplicationQuit,
  requestApplicationQuitWhenAcknowledging,
  requestWindowClose,
  settlePackagedCommand,
  startAcquisitionAcknowledgement,
  startFromMenu,
  waitForAcquisitionOrdinal,
  waitForDialog,
  waitForExitSavingDomWhileAlive,
  waitForExitSavingWhileAlive,
  waitForNoDialog,
  waitForPackagedDisconnect,
  waitForPackagedGameState,
  waitForPersistenceIdle,
  waitForShell,
} from "./helpers";
import {
  SAVE_E2E_PHASE_NAMES,
  readSaveE2eExpectation,
  readSaveE2eOwnershipSnapshot,
  setNextPersistenceFault,
  writeSaveE2eExpectation,
} from "./save-fixtures";
import { anchors } from "./production-anchors";
import type { ExitStatusView } from "$lib/persistence/types";

const EXIT_PHASES = [
  SAVE_E2E_PHASE_NAMES.exitCloseSeed,
  SAVE_E2E_PHASE_NAMES.exitCloseResume,
  SAVE_E2E_PHASE_NAMES.exitQuitSeed,
  SAVE_E2E_PHASE_NAMES.exitQuitResume,
  SAVE_E2E_PHASE_NAMES.exitFailureBypass,
  SAVE_E2E_PHASE_NAMES.exitFinalVerification,
] as const;

type ExitCheckpoint = {
  documentIdentity: string;
  sceneId: string;
  queueGen: number;
  cursor: number;
  currentDialogueFingerprint: string;
};

type ExitControl = {
  close?: ExitCheckpoint;
  quit?: ExitCheckpoint;
  activeAcknowledgementExit?: {
    documentIdentity: string;
    sceneId: string;
    acquisitionId: string;
    recordKind: "evidence" | "statement";
    recordId: string;
  };
  authoritativeBeforeBypass?: ExitCheckpoint & { saveId: string };
  unsavedBypassed?: ExitCheckpoint;
  staleFailureToken?: string;
};

function checkpoint(
  documentIdentity: string,
  state: Awaited<ReturnType<typeof getPackagedGameState>>,
): ExitCheckpoint {
  if (state.mode.type !== "dialogue") {
    throw new Error("exit checkpoint must be active dialogue");
  }
  return {
    documentIdentity,
    sceneId: state.scene.id,
    queueGen: state.mode.queueToken.queueGen,
    cursor: state.mode.queueToken.cursor,
    currentDialogueFingerprint: dialogueFingerprint(state),
  };
}

async function mutateBeforeDebounce(): Promise<ExitCheckpoint> {
  const documentIdentity = await currentPackagedDocumentIdentity();
  const before = await getPackagedGameState();
  if (before.mode.type !== "dialogue") {
    throw new Error("exit mutation requires dialogue");
  }
  const previousCursor = before.mode.queueToken.cursor;
  await advanceDialogueOnce();
  const mutated = await waitForPackagedGameState(
    (state) =>
      state.mode.type === "dialogue" &&
      state.mode.queueToken.cursor > previousCursor,
    15000,
    "exit mutation did not commit before the native request",
  );
  return checkpoint(documentIdentity, mutated);
}

async function requestAndFinish(source: "close" | "quit"): Promise<void> {
  if (source === "close") await requestWindowClose();
  else await requestApplicationQuit();
  await waitForExitSavingWhileAlive();
  await waitForPackagedDisconnect();
}

async function seedSuccessfulExit(source: "close" | "quit"): Promise<void> {
  const inherited = (() => {
    try {
      return readSaveE2eExpectation<ExitControl>("exit-state");
    } catch {
      return {};
    }
  })();
  await waitForShell();
  if (source === "close") await startFromMenu();
  else await continueFromTitle();
  const saved = await mutateBeforeDebounce();
  writeSaveE2eExpectation("exit-state", {
    ...inherited,
    [source]: saved,
  });
  await requestAndFinish(source);
}

async function resumeSuccessfulExit(source: "close" | "quit"): Promise<void> {
  const control = readSaveE2eExpectation<ExitControl>("exit-state");
  const expected = control[source];
  if (!expected) throw new Error(`${source} checkpoint expectation is missing`);
  await waitForShell();
  const documentIdentity = await currentPackagedDocumentIdentity();
  expect(documentIdentity).not.toBe(expected.documentIdentity);
  await continueFromTitle();
  const state = await getPackagedGameState();
  expect(state.scene.id).toBe(expected.sceneId);
  expect(state.mode.type).toBe("dialogue");
  if (state.mode.type !== "dialogue") {
    throw new Error(`${source} checkpoint did not resume in dialogue`);
  }
  expect(state.mode.queueToken.queueGen).toBe(expected.queueGen);
  expect(state.mode.queueToken.cursor).toBe(expected.cursor);
  expect(dialogueFingerprint(state)).toBe(expected.currentDialogueFingerprint);
}

async function exitDuringActiveAcknowledgement(): Promise<void> {
  const inherited = readSaveE2eExpectation<ExitControl>("exit-state");
  const documentIdentity = await currentPackagedDocumentIdentity();
  await jumpToProductionScene(anchors.investigationSceneId);
  await drainCurrentDialogue("explore");
  await waitForPersistenceIdle();
  const hotspot = `button[aria-label="${anchors.hotspotEvidence.label}"]`;
  await browser.waitUntil(async () => elementExists(hotspot), {
    timeout: 30000,
    timeoutMsg: "active-acknowledgement exit hotspot did not appear",
  });
  await jsClick(hotspot);
  await advanceDialogueUntil(async () => {
    try {
      return (await getPackagedGameState()).pendingAcquisition !== null;
    } catch {
      return false;
    }
  }, 80);
  const acquisition = await waitForAcquisitionOrdinal(0);
  const current = acquisition.pendingAcquisition;
  if (!current) {
    throw new Error("active-acknowledgement exit event is missing");
  }
  writeSaveE2eExpectation("exit-state", {
    ...inherited,
    activeAcknowledgementExit: {
      documentIdentity,
      sceneId: acquisition.scene.id,
      acquisitionId: current.id,
      recordKind: current.recordKind,
      recordId: current.recordId,
    },
  } satisfies ExitControl);

  await requestApplicationQuitWhenAcknowledging();
  await startAcquisitionAcknowledgement(current);
  await waitForExitSavingDomWhileAlive();
  await waitForPackagedDisconnect();
}

async function proveFailureCancelAndBypass(): Promise<void> {
  const inherited = readSaveE2eExpectation<ExitControl>("exit-state");
  await waitForShell();
  await continueFromTitle();
  const activeAcknowledgement = inherited.activeAcknowledgementExit;
  if (!activeAcknowledgement) {
    throw new Error("active-acknowledgement exit expectation is missing");
  }
  const acknowledged = await getPackagedGameState();
  expect(acknowledged.scene.id).toBe(activeAcknowledgement.sceneId);
  expect(acknowledged.pendingAcquisition).toBeNull();
  const acknowledgedInventory =
    activeAcknowledgement.recordKind === "evidence"
      ? acknowledged.inventory.evidence
      : acknowledged.inventory.statements;
  expect(
    acknowledgedInventory.some(
      (record) => record.id === activeAcknowledgement.recordId,
    ),
  ).toBe(true);

  await jumpToProductionScene("scene_2");
  await waitForPersistenceIdle();
  const documentIdentity = await currentPackagedDocumentIdentity();
  const authoritativeState = await getPackagedGameState();
  const authoritativeSlot = readSaveE2eOwnershipSnapshot()
    .slots.filter(
      (slot) =>
        slot.fixedSlotName.startsWith("autosave-") && slot.envelope !== null,
    )
    .toSorted(
      (left, right) =>
        Date.parse(right.envelope!.savedAt) -
        Date.parse(left.envelope!.savedAt),
    )[0];
  if (!authoritativeSlot?.envelope) {
    throw new Error("authoritative pre-bypass autosave is missing");
  }
  const authoritative = {
    ...checkpoint(documentIdentity, authoritativeState),
    saveId: authoritativeSlot.envelope.saveId,
  };
  const unsaved = await mutateBeforeDebounce();

  await setNextPersistenceFault("exitFlush");
  await requestWindowClose();
  await waitForDialog("無法結束遊戲", 30000);
  const failed = await invokePackagedCommand<ExitStatusView>("get_exit_status");
  expect(failed.type).toBe("failed");
  if (failed.type !== "failed") throw new Error("exit fault did not fire");
  const staleToken = failed.failureToken;
  await clickButton("取消");
  await waitForNoDialog("無法結束遊戲");
  expect(dialogueFingerprint(await getPackagedGameState())).toBe(
    unsaved.currentDialogueFingerprint,
  );

  const staleRejection = await settlePackagedCommand<void>(
    "exit_without_saving",
    { failureToken: staleToken },
  );
  expect(staleRejection.ok).toBe(false);
  if (staleRejection.ok) {
    throw new Error("stale-token exit_without_saving unexpectedly succeeded");
  }
  expect(staleRejection.error.code).toBe("stalePersistenceFailureToken");

  await setNextPersistenceFault("exitFlush");
  await requestWindowClose();
  await waitForDialog("無法結束遊戲", 30000);
  await clickButton("不儲存並結束遊戲");
  await waitForDialog("確認不儲存並結束遊戲");
  writeSaveE2eExpectation("exit-state", {
    ...inherited,
    authoritativeBeforeBypass: authoritative,
    unsavedBypassed: unsaved,
    staleFailureToken: staleToken,
  });
  try {
    await clickButton("不儲存並結束遊戲");
  } catch (error) {
    if (!isPackagedDisconnectError(error)) throw error;
  }
  await waitForPackagedDisconnect();
}

async function verifyBypassDidNotPersist(): Promise<void> {
  const control = readSaveE2eExpectation<ExitControl>("exit-state");
  const expected = control.authoritativeBeforeBypass;
  const bypassed = control.unsavedBypassed;
  if (!expected || !bypassed) {
    throw new Error("exit bypass verification expectations are missing");
  }
  await waitForShell();
  await continueFromTitle();
  const state = await getPackagedGameState();
  expect(state.scene.id).toBe(expected.sceneId);
  expect(state.mode.type).toBe("dialogue");
  if (state.mode.type !== "dialogue") {
    throw new Error("final exit verification did not resume dialogue");
  }
  expect(state.mode.queueToken.queueGen).toBe(expected.queueGen);
  expect(state.mode.queueToken.cursor).toBe(expected.cursor);
  expect(dialogueFingerprint(state)).toBe(expected.currentDialogueFingerprint);
  expect(dialogueFingerprint(state)).not.toBe(
    bypassed.currentDialogueFingerprint,
  );
}

describe("save exit lifecycle", () => {
  it("proves the closed exit phase", async () => {
    const phase = assertSaveE2ePhase(EXIT_PHASES);
    if (phase === SAVE_E2E_PHASE_NAMES.exitCloseSeed) {
      await seedSuccessfulExit("close");
    } else if (phase === SAVE_E2E_PHASE_NAMES.exitCloseResume) {
      await resumeSuccessfulExit("close");
    } else if (phase === SAVE_E2E_PHASE_NAMES.exitQuitSeed) {
      await seedSuccessfulExit("quit");
    } else if (phase === SAVE_E2E_PHASE_NAMES.exitQuitResume) {
      await resumeSuccessfulExit("quit");
      await exitDuringActiveAcknowledgement();
    } else if (phase === SAVE_E2E_PHASE_NAMES.exitFailureBypass) {
      await proveFailureCancelAndBypass();
    } else if (phase === SAVE_E2E_PHASE_NAMES.exitFinalVerification) {
      await verifyBypassDidNotPersist();
    } else {
      throw new Error(`unexpected exit phase ${String(phase)}`);
    }
  });
});
