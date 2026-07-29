import {
  advanceDialogueOnce,
  assertSaveE2ePhase,
  clickButton,
  clickDialogButton,
  clickPersistenceBrowserButton,
  clickSaveCardButton,
  closePersistenceBrowserToGameplay,
  currentPackagedDocumentIdentity,
  elementExists,
  getPackagedGameState,
  invokePackagedCommand,
  jsClick,
  loadTitleSlot,
  openGameMenu,
  openTitleLoadBrowser,
  returnToTitle,
  saveCardText,
  saveManualSlot,
  settlePackagedCommand,
  startFromMenu,
  waitForDialog,
  waitForPackagedGameState,
  waitForPersistenceLayersClosed,
  waitForPersistenceIdle,
  waitForShell,
} from "./helpers";
import {
  SAVE_E2E_PHASE_NAMES,
  assertSaveE2eSidecarOwnership,
  readSaveE2eEnvelope,
  readSaveE2eExpectation,
  readSaveE2eOwnershipSnapshot,
  readSaveE2eSlots,
  resolveSaveE2eFixedSlotSidecar,
  waitForSaveE2eEnvelope,
  writeSaveE2eExpectation,
  type SaveE2eFixedSlotName,
  type SaveE2eOwnershipSnapshot,
} from "./save-fixtures";
import { anchors } from "./production-anchors";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import type {
  ManualSaveResultView,
  PersistenceHealthView,
  SaveBrowserOpenResultView,
  ThumbnailCaptureRequestView,
} from "$lib/persistence/types";

const MANAGEMENT_PHASES = [
  SAVE_E2E_PHASE_NAMES.managementSeed,
  SAVE_E2E_PHASE_NAMES.managementCorruptNewest,
  SAVE_E2E_PHASE_NAMES.managementRecoverOlder,
  SAVE_E2E_PHASE_NAMES.managementMissingThumbnail,
  SAVE_E2E_PHASE_NAMES.managementRestoreThumbnail,
  SAVE_E2E_PHASE_NAMES.managementCorruptThumbnail,
  SAVE_E2E_PHASE_NAMES.managementDelete,
] as const;

type ManagementControl = {
  seedDocumentIdentity?: string;
  rotation?: SaveE2eOwnershipSnapshot;
  rotationSaveIds?: string[];
  recoverySlot?: SaveE2eFixedSlotName;
  manualOneSaveId?: string;
  manualOneSidecar?: string;
  [key: string]: unknown;
};

function autosaves(snapshot = readSaveE2eOwnershipSnapshot()) {
  return snapshot.slots.filter(
    (slot) =>
      slot.fixedSlotName.startsWith("autosave-") && slot.envelope !== null,
  );
}

function newestAutosave(snapshot = readSaveE2eOwnershipSnapshot()) {
  return autosaves(snapshot).toSorted(
    (left, right) =>
      Date.parse(right.envelope!.savedAt) - Date.parse(left.envelope!.savedAt),
  )[0];
}

async function seedRotationAndOverwrite(): Promise<void> {
  const inherited =
    readSaveE2eExpectation<Record<string, unknown>>("management-state");
  await waitForShell();
  await startFromMenu();
  const documentIdentity = await currentPackagedDocumentIdentity();

  const observedRecoveryPoints = new Map<string, number>();
  for (let attempt = 0; attempt < 12; attempt++) {
    await advanceDialogueOnce();
    await browser.pause(700);
    await waitForPersistenceIdle();
    for (const slot of autosaves()) {
      if (slot.modifiedAtMs === null) {
        throw new Error(`${slot.fixedSlotName} has no filesystem mtime`);
      }
      observedRecoveryPoints.set(slot.envelope!.saveId, slot.modifiedAtMs);
    }
    const newest = newestAutosave();
    if (
      observedRecoveryPoints.size >= 6 &&
      newest?.fixedSlotName === "autosave-1"
    ) {
      break;
    }
  }
  const rotation = readSaveE2eOwnershipSnapshot();
  const retained = autosaves(rotation);
  expect(retained).toHaveLength(5);
  expect(observedRecoveryPoints.size).toBeGreaterThanOrEqual(6);
  expect(newestAutosave(rotation)?.fixedSlotName).toBe("autosave-1");
  const expectedRetainedIds = [...observedRecoveryPoints.entries()]
    .toSorted((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([saveId]) => saveId);
  const actualRetainedIds = retained
    .toSorted(
      (left, right) => (right.modifiedAtMs ?? 0) - (left.modifiedAtMs ?? 0),
    )
    .map((slot) => slot.envelope!.saveId);
  expect(actualRetainedIds).toEqual(expectedRetainedIds);
  const orderedByMtime = retained.toSorted(
    (left, right) => (left.modifiedAtMs ?? 0) - (right.modifiedAtMs ?? 0),
  );
  for (const newer of orderedByMtime.slice(1)) {
    expect(orderedByMtime[0]!.modifiedAtMs).toBeLessThan(newer.modifiedAtMs!);
  }
  for (const slot of retained) {
    expect(slot.envelope!.thumbnail.type).toBe("available");
    if (slot.envelope!.thumbnail.type === "available") {
      expect(slot.envelope!.thumbnail.objectId).toBe(slot.envelope!.saveId);
      expect(slot.sidecarSha256).toBe(slot.envelope!.thumbnail.sha256);
    }
  }
  assertSaveE2eSidecarOwnership();

  await returnToTitle();
  await openTitleLoadBrowser();
  const validAutosaveCards = await browser.execute(() => {
    return Array.from(
      document.querySelectorAll('article[data-slot-type="auto"]'),
    ).filter((card) => !(card.textContent ?? "").includes("空白存檔")).length;
  });
  expect(validAutosaveCards).toBe(5);
  await clickPersistenceBrowserButton("返回");

  await loadTitleSlot("manual", 1);
  const oldManualOne = readSaveE2eEnvelope("manual-1");
  const untouchedManualTwo = readSaveE2eEnvelope("manual-2");
  if (!oldManualOne || !untouchedManualTwo) {
    throw new Error("manual overwrite seed slots are missing");
  }
  const observedBrowser =
    await invokePackagedCommand<SaveBrowserOpenResultView>("list_saves");
  const observedManualOne = observedBrowser.browser.slots.find(
    (slot) => slot.reference.type === "manual" && slot.reference.slot === 1,
  );
  if (
    !observedManualOne ||
    observedManualOne.status.type !== "valid" ||
    observedManualOne.modifiedAt === null
  ) {
    throw new Error("manual slot 1 has no valid stale-selection observation");
  }
  const staleExpectation = {
    type: "occupied" as const,
    observation: {
      saveId: observedManualOne.status.metadata.saveId,
      modifiedAt: observedManualOne.modifiedAt,
    },
  };
  expect(staleExpectation.observation.saveId).toBe(oldManualOne.saveId);
  await openGameMenu();
  await clickButton(anchors.saveGame);
  await browser.waitUntil(
    async () => elementExists('[aria-label="存檔瀏覽器"]'),
    {
      timeout: 30000,
      timeoutMsg: "save browser (存檔瀏覽器) did not open for manual overwrite",
    },
  );
  await clickButton("選擇手動存檔 1");
  await waitForDialog(anchors.nameSave);
  const defaultName = await browser.execute(
    () => document.querySelector<HTMLInputElement>("#manual-save-name")?.value,
  );
  expect(defaultName).toBe(anchors.unicodeSave.unicodeName);
  expect(readSaveE2eEnvelope("manual-1")?.saveId).toBe(oldManualOne.saveId);
  await clickDialogButton(anchors.nameSave, anchors.continueName);
  await waitForDialog("覆寫手動存檔 1");
  expect(readSaveE2eEnvelope("manual-1")?.saveId).toBe(oldManualOne.saveId);
  await clickDialogButton("覆寫手動存檔 1", anchors.confirmOverwrite);
  const overwritten = await waitForSaveE2eEnvelope(
    "manual-1",
    (envelope) =>
      envelope.saveId !== oldManualOne.saveId &&
      envelope.displayName === anchors.unicodeSave.unicodeName &&
      envelope.thumbnail.type === "available",
  );
  expect(overwritten.savedAt).not.toBe(oldManualOne.savedAt);
  expect(readSaveE2eEnvelope("manual-1")?.saveId).toBe(overwritten.saveId);
  expect(readSaveE2eEnvelope("manual-2")?.saveId).toBe(
    untouchedManualTwo.saveId,
  );
  expect(existsSync(resolveSaveE2eFixedSlotSidecar("manual-1"))).toBe(true);
  assertSaveE2eSidecarOwnership();
  await waitForPersistenceLayersClosed();

  const captureUnavailableControl = anchors.captureProof.forceUnavailable;
  expect(await elementExists(captureUnavailableControl)).toBe(true);
  await jsClick(captureUnavailableControl);
  await saveManualSlot(3, "預覽不可用但可載入", true);
  const unavailable = await waitForSaveE2eEnvelope(
    "manual-3",
    (envelope) =>
      envelope.displayName === "預覽不可用但可載入" &&
      envelope.thumbnail.type === "unavailable",
  );
  expect(unavailable.thumbnail.type).toBe("unavailable");
  expect(await saveCardText("manual", 3)).toContain(anchors.previewUnavailable);
  await closePersistenceBrowserToGameplay();
  await returnToTitle();
  await loadTitleSlot("manual", 3);
  expect((await getPackagedGameState()).scene.id).toBe(
    unavailable.summary.sceneId,
  );

  const recoverySlot = autosaves(rotation)
    .filter((slot) => slot.fixedSlotName !== "autosave-1")
    .toSorted(
      (left, right) =>
        Date.parse(right.envelope!.savedAt) -
        Date.parse(left.envelope!.savedAt),
    )[0]!.fixedSlotName;
  writeSaveE2eExpectation("management-state", {
    ...inherited,
    seedDocumentIdentity: documentIdentity,
    rotation,
    rotationSaveIds: [...observedRecoveryPoints.keys()],
    recoverySlot,
    manualOneSaveId: overwritten.saveId,
    manualOneSidecar: resolveSaveE2eFixedSlotSidecar("manual-1"),
  } satisfies ManagementControl);

  // Keep the expected concurrency rejection terminal: the coordinator
  // deliberately exposes it as degraded health, so a fresh process owns the
  // next recovery phase.
  const staleTicket = await invokePackagedCommand<ThumbnailCaptureRequestView>(
    "prepare_save_thumbnail",
    { purpose: { type: "manualSave" } },
  );
  await invokePackagedCommand<void>("report_save_thumbnail_failure", {
    ticket: staleTicket.ticket,
  });
  const staleResult = await settlePackagedCommand<ManualSaveResultView>(
    "save_manual",
    {
      reference: { type: "manual", slot: 1 },
      displayName: anchors.unicodeSave.unicodeName,
      expectation: staleExpectation,
      preparedThumbnailTicket: staleTicket.ticket,
    },
  );
  expect(staleResult.ok).toBe(false);
  if (staleResult.ok) {
    throw new Error("stale manual overwrite unexpectedly succeeded");
  }
  expect(staleResult.error.code).toBe("staleManualOverwriteConfirmation");
  expect(readSaveE2eEnvelope("manual-1")?.saveId).toBe(overwritten.saveId);
  const degraded = await invokePackagedCommand<PersistenceHealthView>(
    "get_persistence_status",
  );
  expect(degraded).toEqual({
    type: "degraded",
    diagnostic: {
      code: "staleManualOverwriteConfirmation",
      message: "Manual overwrite confirmation is stale.",
    },
  });
}

async function proveCorruptNewest(): Promise<void> {
  const control = readSaveE2eExpectation<ManagementControl>("management-state");
  await waitForShell();
  const identity = await currentPackagedDocumentIdentity();
  expect(identity).not.toBe(control.seedDocumentIdentity);
  expect(
    readSaveE2eOwnershipSnapshot().slots.find(
      (slot) => slot.fixedSlotName === "autosave-1",
    )?.parseError,
  ).toBe(true);
  await clickButton(anchors.continueGame);
  await waitForDialog("無法繼續遊戲");
  expect(await elementExists("[data-gameplay-root]")).toBe(false);
  await clickButton(anchors.loadGame);
  await browser.waitUntil(
    async () => elementExists('[aria-label="存檔瀏覽器"]'),
    {
      timeout: 30000,
      timeoutMsg: "save browser (存檔瀏覽器) did not open after corrupt newest",
    },
  );
  const selectedInvalid = await browser.execute(() => {
    const card = document.querySelector(
      'article[data-slot-type="auto"][data-slot-number="1"]',
    );
    return (
      !!card?.classList.contains("selected") &&
      !!card.querySelector('[role="alert"]')
    );
  });
  expect(selectedInvalid).toBe(true);
  expect(
    readSaveE2eSlots().find((slot) => slot.fixedSlotName === "autosave-1")
      ?.text,
  ).toBe('{"broken":');
}

async function recoverOlder(): Promise<void> {
  const control = readSaveE2eExpectation<ManagementControl>("management-state");
  const recovery = control.recoverySlot;
  if (!recovery?.startsWith("autosave-")) {
    throw new Error("management recovery slot is missing");
  }
  const slotNumber = Number(recovery.replace("autosave-", ""));
  await waitForShell();
  await loadTitleSlot("auto", slotNumber);
  expect((await getPackagedGameState()).scene.id.length).toBeGreaterThan(0);
  expect(
    readSaveE2eOwnershipSnapshot().slots.find(
      (slot) => slot.fixedSlotName === "autosave-1",
    )?.parseError,
  ).toBe(true);
  await returnToTitle();
}

async function proveThumbnailFallback(
  expectedPhase: "missing" | "corrupt",
): Promise<void> {
  await waitForShell();
  await openTitleLoadBrowser();
  expect(await saveCardText("manual", 1)).toContain(anchors.previewUnavailable);
  await clickSaveCardButton("manual", 1, "載入");
  const state = await waitForPackagedGameState(
    () => true,
    30000,
    "manual save with presentation-only thumbnail failure did not load",
  );
  expect(state.scene.id.length).toBeGreaterThan(0);
  const envelope = readSaveE2eEnvelope("manual-1");
  expect(envelope?.thumbnail.type).toBe("available");
  if (expectedPhase === "missing") {
    expect(existsSync(resolveSaveE2eFixedSlotSidecar("manual-1"))).toBe(false);
  } else {
    expect(existsSync(resolveSaveE2eFixedSlotSidecar("manual-1"))).toBe(true);
  }
  await returnToTitle();
}

async function restoreThumbnail(): Promise<void> {
  await waitForShell();
  await loadTitleSlot("manual", 1);
  let previousId = readSaveE2eEnvelope("manual-1")?.saveId;
  if (!previousId)
    throw new Error("thumbnail restoration source save is missing");

  let restored: ReturnType<typeof readSaveE2eEnvelope> = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await saveManualSlot(1, anchors.unicodeSave.unicodeName, true);
    const overwritten = await waitForSaveE2eEnvelope(
      "manual-1",
      (envelope) => envelope.saveId !== previousId,
    );
    if (overwritten.thumbnail.type === "available") {
      restored = overwritten;
      break;
    }
    previousId = overwritten.saveId;
    await closePersistenceBrowserToGameplay();
  }

  if (!restored) {
    const diagnostic = await browser.execute((probe: string) => {
      const element = document.querySelector(probe);
      return {
        reason:
          element?.getAttribute("data-capture-proof-last-closed-reason") ??
          null,
        renderDiagnostic:
          element?.getAttribute("data-capture-proof-last-render-diagnostic") ??
          null,
        calls: Number(element?.getAttribute("data-capture-proof-calls") ?? "0"),
        available: Number(
          element?.getAttribute("data-capture-proof-available") ?? "0",
        ),
      };
    }, anchors.captureProof.probe);
    throw new Error(
      `manual-1 thumbnail remained unavailable after 3 overwrites: ${JSON.stringify(diagnostic)}`,
    );
  }

  expect(existsSync(resolveSaveE2eFixedSlotSidecar("manual-1"))).toBe(true);
  expect(restored.thumbnail.type).toBe("available");
  await closePersistenceBrowserToGameplay();
  await returnToTitle();
}

async function deleteOwnedManual(): Promise<void> {
  await waitForShell();
  const before = readSaveE2eOwnershipSnapshot();
  const target = before.slots.find((slot) => slot.fixedSlotName === "manual-1");
  if (!target?.envelope || !target.sidecarPath) {
    throw new Error("delete target has no owned sidecar");
  }
  const sidecarDirectory = dirname(target.sidecarPath);
  const targetSidecarName = basename(target.sidecarPath);
  const sidecarsBeforeDelete = readdirSync(sidecarDirectory).toSorted();
  await openTitleLoadBrowser();
  await clickSaveCardButton("manual", 1, "刪除");
  await waitForDialog("刪除手動存檔 1");
  await clickButton(anchors.confirmDelete);
  await browser.waitUntil(
    async () => (await saveCardText("manual", 1)).includes("空白存檔"),
    { timeout: 30000, timeoutMsg: "manual slot 1 did not become empty" },
  );
  expect(readSaveE2eEnvelope("manual-1")).toBeNull();
  expect(existsSync(target.sidecarPath)).toBe(false);
  const after = readSaveE2eOwnershipSnapshot();
  for (const prior of before.slots.filter(
    (slot) => slot.fixedSlotName !== "manual-1",
  )) {
    const current = after.slots.find(
      (slot) => slot.fixedSlotName === prior.fixedSlotName,
    );
    expect(current?.envelope?.saveId ?? null).toBe(
      prior.envelope?.saveId ?? null,
    );
    expect(current?.sidecarSha256 ?? null).toBe(prior.sidecarSha256 ?? null);
  }
  expect(readdirSync(sidecarDirectory).toSorted()).toEqual(
    sidecarsBeforeDelete.filter((name) => name !== targetSidecarName),
  );
}

describe("save management", () => {
  it("proves the closed management phase", async () => {
    const phase = assertSaveE2ePhase(MANAGEMENT_PHASES);
    if (phase === SAVE_E2E_PHASE_NAMES.managementSeed) {
      await seedRotationAndOverwrite();
    } else if (phase === SAVE_E2E_PHASE_NAMES.managementCorruptNewest) {
      await proveCorruptNewest();
    } else if (phase === SAVE_E2E_PHASE_NAMES.managementRecoverOlder) {
      await recoverOlder();
    } else if (phase === SAVE_E2E_PHASE_NAMES.managementMissingThumbnail) {
      await proveThumbnailFallback("missing");
    } else if (phase === SAVE_E2E_PHASE_NAMES.managementRestoreThumbnail) {
      await restoreThumbnail();
    } else if (phase === SAVE_E2E_PHASE_NAMES.managementCorruptThumbnail) {
      await proveThumbnailFallback("corrupt");
    } else if (phase === SAVE_E2E_PHASE_NAMES.managementDelete) {
      await deleteOwnedManual();
    } else {
      throw new Error(`unexpected management phase ${String(phase)}`);
    }
  });
});
