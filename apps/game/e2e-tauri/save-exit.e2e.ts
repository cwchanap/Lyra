import {
  acknowledgeAcquisitionDomFirst,
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
  requestWindowClose,
  resetE2eStorageWithStoryClearance,
  settlePackagedCommand,
  startFromMenu,
  waitForAcquisitionOrdinal,
  waitForDialog,
  waitForNoDialog,
  waitForPackagedDisconnect,
  waitForPackagedGameState,
  waitForPersistenceIdle,
  waitForShell,
} from "./helpers";
import {
  SAVE_E2E_PHASE_NAMES,
  newestAutosaveSlot,
  readSaveE2eExpectation,
  setNextPersistenceFault,
  writeSaveE2eExpectation,
} from "./save-fixtures";
import { anchors } from "./production-anchors";
import type { ExitStatusView } from "$lib/persistence/types";

const EXIT_PHASES = [
  SAVE_E2E_PHASE_NAMES.exitCloseSeed,
  SAVE_E2E_PHASE_NAMES.exitCloseResume,
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
  acknowledgedExit?: {
    sceneId: string;
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
  try {
    if (source === "close") await requestWindowClose();
    else await requestApplicationQuit();
  } catch (error) {
    // A successful close/quit can terminate the embedded WebDriver before its
    // request returns. The following fresh-process phase proves the mutation
    // persisted; preserve non-disconnect failures as real test failures.
    if (!isPackagedDisconnectError(error)) throw error;
  }
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

async function seedQuitFromResumedGameplay(): Promise<void> {
  const inherited = readSaveE2eExpectation<ExitControl>("exit-state");
  const saved = await mutateBeforeDebounce();
  writeSaveE2eExpectation("exit-state", {
    ...inherited,
    quit: saved,
  });
  await requestAndFinish("quit");
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

async function exitAfterOrdinaryAcknowledgement(): Promise<void> {
  const inherited = readSaveE2eExpectation<ExitControl>("exit-state");
  await jumpToProductionScene(anchors.investigationSceneId);
  await drainCurrentDialogue("explore");
  await waitForPersistenceIdle();
  const hotspot = `button[aria-label="${anchors.hotspotEvidence.label}"]`;
  await browser.waitUntil(async () => elementExists(hotspot), {
    timeout: 30000,
    timeoutMsg: "acknowledged-exit hotspot did not appear",
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
    throw new Error("acknowledged-exit event is missing");
  }
  writeSaveE2eExpectation("exit-state", {
    ...inherited,
    acknowledgedExit: {
      sceneId: acquisition.scene.id,
      recordKind: current.recordKind,
      recordId: current.recordId,
    },
  } satisfies ExitControl);

  // Ordinary acknowledgement, then an ordinary quit: the exit flush must
  // persist the acknowledged revision, and the next process must resume
  // without the popup and with the record granted exactly once.
  await acknowledgeAcquisitionDomFirst(current);
  await waitForPackagedGameState(
    (state) => state.pendingAcquisition === null,
    30000,
    "acknowledged event did not clear in memory before quit",
  );
  await requestAndFinish("quit");
}

async function proveFailureCancelAndBypass(): Promise<void> {
  const inherited = readSaveE2eExpectation<ExitControl>("exit-state");
  await waitForShell();
  await continueFromTitle();
  const acknowledgedExit = inherited.acknowledgedExit;
  if (!acknowledgedExit) {
    throw new Error("acknowledged-exit expectation is missing");
  }
  const acknowledged = await getPackagedGameState();
  expect(acknowledged.scene.id).toBe(acknowledgedExit.sceneId);
  expect(acknowledged.pendingAcquisition).toBeNull();
  const acknowledgedInventory =
    acknowledgedExit.recordKind === "evidence"
      ? acknowledged.inventory.evidence
      : acknowledged.inventory.statements;
  expect(
    acknowledgedInventory.filter(
      (record) => record.id === acknowledgedExit.recordId,
    ),
  ).toHaveLength(1);

  await jumpToProductionScene("scene_2");
  await waitForPersistenceIdle();
  const documentIdentity = await currentPackagedDocumentIdentity();
  const authoritativeState = await getPackagedGameState();
  const authoritativeSlot = newestAutosaveSlot();
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
      await resetE2eStorageWithStoryClearance();
      await seedSuccessfulExit("close");
    } else if (phase === SAVE_E2E_PHASE_NAMES.exitCloseResume) {
      await resumeSuccessfulExit("close");
      await seedQuitFromResumedGameplay();
    } else if (phase === SAVE_E2E_PHASE_NAMES.exitQuitResume) {
      await resumeSuccessfulExit("quit");
      await exitAfterOrdinaryAcknowledgement();
    } else if (phase === SAVE_E2E_PHASE_NAMES.exitFailureBypass) {
      await proveFailureCancelAndBypass();
    } else if (phase === SAVE_E2E_PHASE_NAMES.exitFinalVerification) {
      await verifyBypassDidNotPersist();
    } else {
      throw new Error(`unexpected exit phase ${String(phase)}`);
    }
  });
});
