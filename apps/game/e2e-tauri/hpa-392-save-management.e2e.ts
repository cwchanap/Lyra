import {
  advanceDialogueOnce,
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
  HPA392_PHASE_NAMES,
  assertHpa392SidecarOwnership,
  readHpa392Envelope,
  readHpa392Expectation,
  readHpa392OwnershipSnapshot,
  readHpa392Slots,
  resolveHpa392FixedSlotSidecar,
  waitForHpa392Envelope,
  writeHpa392Expectation,
  type Hpa392FixedSlotName,
  type Hpa392OwnershipSnapshot,
} from "./hpa-392-fixtures";
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
  HPA392_PHASE_NAMES.managementSeed,
  HPA392_PHASE_NAMES.managementCorruptNewest,
  HPA392_PHASE_NAMES.managementRecoverOlder,
  HPA392_PHASE_NAMES.managementMissingThumbnail,
  HPA392_PHASE_NAMES.managementRestoreThumbnail,
  HPA392_PHASE_NAMES.managementCorruptThumbnail,
  HPA392_PHASE_NAMES.managementDelete,
] as const;

type ManagementControl = {
  seedDocumentIdentity?: string;
  rotation?: Hpa392OwnershipSnapshot;
  rotationSaveIds?: string[];
  recoverySlot?: Hpa392FixedSlotName;
  manualOneSaveId?: string;
  manualOneSidecar?: string;
  [key: string]: unknown;
};

function autosaves(snapshot = readHpa392OwnershipSnapshot()) {
  return snapshot.slots.filter(
    (slot) =>
      slot.fixedSlotName.startsWith("autosave-") && slot.envelope !== null,
  );
}

function newestAutosave(snapshot = readHpa392OwnershipSnapshot()) {
  return autosaves(snapshot).toSorted(
    (left, right) =>
      Date.parse(right.envelope!.savedAt) - Date.parse(left.envelope!.savedAt),
  )[0];
}

async function seedRotationAndOverwrite(): Promise<void> {
  const inherited =
    readHpa392Expectation<Record<string, unknown>>("management-state");
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
  const rotation = readHpa392OwnershipSnapshot();
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
  assertHpa392SidecarOwnership();

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
  const oldManualOne = readHpa392Envelope("manual-1");
  const untouchedManualTwo = readHpa392Envelope("manual-2");
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
    { timeout: 30000 },
  );
  await clickButton("選擇手動存檔 1");
  await waitForDialog(anchors.nameSave);
  const defaultName = await browser.execute(
    () => document.querySelector<HTMLInputElement>("#manual-save-name")?.value,
  );
  expect(defaultName).toBe(anchors.hpa392.unicodeName);
  expect(readHpa392Envelope("manual-1")?.saveId).toBe(oldManualOne.saveId);
  await clickDialogButton(anchors.nameSave, anchors.continueName);
  await waitForDialog("覆寫手動存檔 1");
  expect(readHpa392Envelope("manual-1")?.saveId).toBe(oldManualOne.saveId);
  await clickDialogButton("覆寫手動存檔 1", anchors.confirmOverwrite);
  const overwritten = await waitForHpa392Envelope(
    "manual-1",
    (envelope) =>
      envelope.saveId !== oldManualOne.saveId &&
      envelope.displayName === anchors.hpa392.unicodeName &&
      envelope.thumbnail.type === "available",
  );
  expect(overwritten.savedAt).not.toBe(oldManualOne.savedAt);
  expect(readHpa392Envelope("manual-1")?.saveId).toBe(overwritten.saveId);
  expect(readHpa392Envelope("manual-2")?.saveId).toBe(
    untouchedManualTwo.saveId,
  );
  expect(existsSync(resolveHpa392FixedSlotSidecar("manual-1"))).toBe(true);
  assertHpa392SidecarOwnership();
  await waitForPersistenceLayersClosed();

  const captureUnavailableControl = anchors.captureProof.forceUnavailable;
  expect(await elementExists(captureUnavailableControl)).toBe(true);
  await jsClick(captureUnavailableControl);
  await saveManualSlot(3, "預覽不可用但可載入", true);
  const unavailable = await waitForHpa392Envelope(
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
  writeHpa392Expectation("management-state", {
    ...inherited,
    seedDocumentIdentity: documentIdentity,
    rotation,
    rotationSaveIds: [...observedRecoveryPoints.keys()],
    recoverySlot,
    manualOneSaveId: overwritten.saveId,
    manualOneSidecar: resolveHpa392FixedSlotSidecar("manual-1"),
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
      displayName: anchors.hpa392.unicodeName,
      expectation: staleExpectation,
      preparedThumbnailTicket: staleTicket.ticket,
    },
  );
  expect(staleResult.ok).toBe(false);
  if (staleResult.ok) {
    throw new Error("stale manual overwrite unexpectedly succeeded");
  }
  expect(staleResult.error.code).toBe("staleManualOverwriteConfirmation");
  expect(readHpa392Envelope("manual-1")?.saveId).toBe(overwritten.saveId);
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
  const control = readHpa392Expectation<ManagementControl>("management-state");
  await waitForShell();
  const identity = await currentPackagedDocumentIdentity();
  expect(identity).not.toBe(control.seedDocumentIdentity);
  expect(
    readHpa392OwnershipSnapshot().slots.find(
      (slot) => slot.fixedSlotName === "autosave-1",
    )?.parseError,
  ).toBe(true);
  await clickButton(anchors.continueGame);
  await waitForDialog("無法繼續遊戲");
  expect(await elementExists("[data-gameplay-root]")).toBe(false);
  await clickButton(anchors.loadGame);
  await browser.waitUntil(
    async () => elementExists('[aria-label="存檔瀏覽器"]'),
    { timeout: 30000 },
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
    readHpa392Slots().find((slot) => slot.fixedSlotName === "autosave-1")?.text,
  ).toBe('{"broken":');
}

async function recoverOlder(): Promise<void> {
  const control = readHpa392Expectation<ManagementControl>("management-state");
  const recovery = control.recoverySlot;
  if (!recovery?.startsWith("autosave-")) {
    throw new Error("management recovery slot is missing");
  }
  const slotNumber = Number(recovery.replace("autosave-", ""));
  await waitForShell();
  await loadTitleSlot("auto", slotNumber);
  expect((await getPackagedGameState()).scene.id.length).toBeGreaterThan(0);
  expect(
    readHpa392OwnershipSnapshot().slots.find(
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
  const envelope = readHpa392Envelope("manual-1");
  expect(envelope?.thumbnail.type).toBe("available");
  if (expectedPhase === "missing") {
    expect(existsSync(resolveHpa392FixedSlotSidecar("manual-1"))).toBe(false);
  } else {
    expect(existsSync(resolveHpa392FixedSlotSidecar("manual-1"))).toBe(true);
  }
  await returnToTitle();
}

async function restoreThumbnail(): Promise<void> {
  await waitForShell();
  await loadTitleSlot("manual", 1);
  const oldId = readHpa392Envelope("manual-1")?.saveId;
  await saveManualSlot(1, anchors.hpa392.unicodeName, true);
  const restored = await waitForHpa392Envelope(
    "manual-1",
    (envelope) =>
      envelope.saveId !== oldId && envelope.thumbnail.type === "available",
  );
  expect(existsSync(resolveHpa392FixedSlotSidecar("manual-1"))).toBe(true);
  expect(restored.thumbnail.type).toBe("available");
  await closePersistenceBrowserToGameplay();
  await returnToTitle();
}

async function deleteOwnedManual(): Promise<void> {
  await waitForShell();
  const before = readHpa392OwnershipSnapshot();
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
  expect(readHpa392Envelope("manual-1")).toBeNull();
  expect(existsSync(target.sidecarPath)).toBe(false);
  const after = readHpa392OwnershipSnapshot();
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

describe("HPA-392 save management", () => {
  it("proves the closed management phase", async () => {
    const phase = process.env.LYRA_HPA392_PHASE;
    expect(MANAGEMENT_PHASES).toContain(phase);
    if (phase === HPA392_PHASE_NAMES.managementSeed) {
      await seedRotationAndOverwrite();
    } else if (phase === HPA392_PHASE_NAMES.managementCorruptNewest) {
      await proveCorruptNewest();
    } else if (phase === HPA392_PHASE_NAMES.managementRecoverOlder) {
      await recoverOlder();
    } else if (phase === HPA392_PHASE_NAMES.managementMissingThumbnail) {
      await proveThumbnailFallback("missing");
    } else if (phase === HPA392_PHASE_NAMES.managementRestoreThumbnail) {
      await restoreThumbnail();
    } else if (phase === HPA392_PHASE_NAMES.managementCorruptThumbnail) {
      await proveThumbnailFallback("corrupt");
    } else if (phase === HPA392_PHASE_NAMES.managementDelete) {
      await deleteOwnedManual();
    } else {
      throw new Error(`unexpected management phase ${String(phase)}`);
    }
  });
});
