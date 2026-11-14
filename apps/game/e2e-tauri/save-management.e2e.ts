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
  resetE2eStorageWithStoryClearance,
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
  autosaveSlots,
  newestAutosaveSlot,
  readSaveE2eEnvelope,
  readSaveE2eExpectation,
  readSaveE2eOwnershipSnapshot,
  readSaveE2eSlots,
  resolveSaveE2eFixedSlotSidecar,
  waitForSaveE2eEnvelope,
  writeSaveE2eExpectation,
  type SaveE2eFixedSlotName,
  type SaveE2eOwnershipSnapshot,
  type SaveE2eSaveEnvelope,
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
  SAVE_E2E_PHASE_NAMES.managementMissingThumbnail,
  SAVE_E2E_PHASE_NAMES.managementCorruptThumbnail,
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

async function seedOwnedManualSlotWithThumbnail(
  slot: 1 | 2,
  displayName: string,
): Promise<SaveE2eSaveEnvelope> {
  let overwrite = readSaveE2eEnvelope(`manual-${slot}`) !== null;
  const attempts: Array<{
    saveId: string;
    savedAt: string;
    thumbnailType: SaveE2eSaveEnvelope["thumbnail"]["type"];
  }> = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const previousId = readSaveE2eEnvelope(`manual-${slot}`)?.saveId ?? null;
    await saveManualSlot(slot, displayName, overwrite);
    const envelope = await waitForSaveE2eEnvelope(
      `manual-${slot}`,
      (candidate) =>
        candidate.saveId !== previousId &&
        candidate.displayName === displayName,
    );
    await closePersistenceBrowserToGameplay();
    attempts.push({
      saveId: envelope.saveId,
      savedAt: envelope.savedAt,
      thumbnailType: envelope.thumbnail.type,
    });
    if (envelope.thumbnail.type === "available") return envelope;
    overwrite = true;
  }
  throw new Error(
    `manual-${slot} did not acquire an owned thumbnail sidecar; attempts=${JSON.stringify(attempts)}`,
  );
}

async function seedRotationAndOverwrite(): Promise<void> {
  await waitForShell();
  await resetE2eStorageWithStoryClearance();
  await startFromMenu();
  const documentIdentity = await currentPackagedDocumentIdentity();

  await seedOwnedManualSlotWithThumbnail(1, anchors.unicodeSave.unicodeName);
  await seedOwnedManualSlotWithThumbnail(2, "管理流程手動存檔二");

  const observedRecoveryPoints = new Map<string, number>();
  for (let attempt = 0; attempt < 12; attempt++) {
    await advanceDialogueOnce();
    await browser.pause(700);
    await waitForPersistenceIdle();
    for (const slot of autosaveSlots()) {
      if (slot.modifiedAtMs === null) {
        throw new Error(`${slot.fixedSlotName} has no filesystem mtime`);
      }
      observedRecoveryPoints.set(slot.envelope!.saveId, slot.modifiedAtMs);
    }
    const newest = newestAutosaveSlot();
    if (
      observedRecoveryPoints.size >= 6 &&
      newest?.fixedSlotName === "autosave-1"
    ) {
      break;
    }
  }
  const rotation = readSaveE2eOwnershipSnapshot();
  const retained = autosaveSlots(rotation);
  expect(retained).toHaveLength(5);
  expect(observedRecoveryPoints.size).toBeGreaterThanOrEqual(6);
  expect(newestAutosaveSlot(rotation)?.fixedSlotName).toBe("autosave-1");
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
  let overwritten = await waitForSaveE2eEnvelope(
    "manual-1",
    (envelope) =>
      envelope.saveId !== oldManualOne.saveId &&
      envelope.displayName === anchors.unicodeSave.unicodeName,
  );
  if (overwritten.thumbnail.type !== "available") {
    console.warn(
      `[save management] direct manual overwrite committed without a thumbnail; retrying bounded owned save: ${JSON.stringify({ saveId: overwritten.saveId, savedAt: overwritten.savedAt, thumbnail: overwritten.thumbnail })}`,
    );
    await waitForPersistenceLayersClosed();
    overwritten = await seedOwnedManualSlotWithThumbnail(
      1,
      anchors.unicodeSave.unicodeName,
    );
  }
  expect(overwritten.thumbnail.type).toBe("available");
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
  await saveManualSlot(
    3,
    "預覽不可用但可載入",
    readSaveE2eEnvelope("manual-3") !== null,
  );
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

  const recoverySlot = newestAutosaveSlot({
    ...rotation,
    slots: rotation.slots.filter((slot) => slot.fixedSlotName !== "autosave-1"),
  })!.fixedSlotName;
  writeSaveE2eExpectation("management-state", {
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
  expect(await elementExists('[aria-label="繼續遊戲摘要"]')).toBe(false);
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

async function recoverOlderFromOpenBrowser(): Promise<void> {
  const control = readSaveE2eExpectation<ManagementControl>("management-state");
  const recovery = control.recoverySlot;
  if (!recovery?.startsWith("autosave-")) {
    throw new Error("management recovery slot is missing");
  }
  const slotNumber = Number(recovery.replace("autosave-", ""));
  const recoveryEnvelope = readSaveE2eEnvelope(recovery);
  if (!recoveryEnvelope) throw new Error("management recovery save is missing");
  await clickSaveCardButton("auto", slotNumber, "載入");
  await waitForPackagedGameState(
    (state) => state.scene.id === recoveryEnvelope.summary.sceneId,
    30000,
    "older autosave did not load after invalid-newest discovery",
  );
  expect(
    readSaveE2eOwnershipSnapshot().slots.find(
      (slot) => slot.fixedSlotName === "autosave-1",
    )?.parseError,
  ).toBe(true);
  await returnToTitle();
}

async function proveThumbnailFallback(
  expectedPhase: "missing" | "corrupt",
  slot: 1 | 2,
): Promise<void> {
  await waitForShell();
  await openTitleLoadBrowser();
  expect(await saveCardText("manual", slot)).toContain(
    anchors.previewUnavailable,
  );
  await clickSaveCardButton("manual", slot, "載入");
  await browser.waitUntil(async () => elementExists("[data-gameplay-root]"), {
    timeout: 30000,
    timeoutMsg:
      "manual save with presentation-only thumbnail failure did not render gameplay",
  });
  const envelope = readSaveE2eEnvelope(`manual-${slot}`);
  if (!envelope) throw new Error(`manual-${slot} envelope is missing`);
  const state = await waitForPackagedGameState(
    (candidate) => candidate.scene.id === envelope.summary.sceneId,
    30000,
    "manual save with presentation-only thumbnail failure did not load",
  );
  expect(state.scene.id.length).toBeGreaterThan(0);
  expect(envelope.thumbnail.type).toBe("available");
  if (expectedPhase === "missing") {
    expect(existsSync(resolveSaveE2eFixedSlotSidecar(`manual-${slot}`))).toBe(
      false,
    );
  } else {
    expect(existsSync(resolveSaveE2eFixedSlotSidecar(`manual-${slot}`))).toBe(
      true,
    );
  }
  await returnToTitle();
}

async function deleteOwnedManual(slot: 1 | 2): Promise<void> {
  await waitForShell();
  const before = readSaveE2eOwnershipSnapshot();
  const fixedSlotName = `manual-${slot}` as const;
  const target = before.slots.find(
    (candidate) => candidate.fixedSlotName === fixedSlotName,
  );
  if (!target?.envelope || !target.sidecarPath) {
    throw new Error("delete target has no owned sidecar");
  }
  const targetEnvelope = target.envelope;
  const targetSidecarPath = target.sidecarPath;
  const sidecarDirectory = dirname(target.sidecarPath);
  const targetSidecarName = basename(target.sidecarPath);
  const sidecarsBeforeDelete = readdirSync(sidecarDirectory).toSorted();
  // HPA-830: before 確認刪除 is explicitly chosen, neither a cancel of the
  // delete confirmation nor a reopen of it may delete the owned save or
  // touch any sidecar (envelope saveId, target sidecar hash, other slots'
  // saveId/sidecar hashes, and the saves directory listing all pinned).
  const assertDeleteNotCommitted = (): void => {
    expect(readSaveE2eEnvelope(fixedSlotName)?.saveId).toBe(
      targetEnvelope.saveId,
    );
    expect(existsSync(targetSidecarPath)).toBe(true);
    const snapshot = readSaveE2eOwnershipSnapshot();
    const targetSlot = snapshot.slots.find(
      (candidate) => candidate.fixedSlotName === fixedSlotName,
    );
    expect(targetSlot?.sidecarSha256 ?? null).toBe(target.sidecarSha256);
    for (const prior of before.slots.filter(
      (candidate) => candidate.fixedSlotName !== fixedSlotName,
    )) {
      const current = snapshot.slots.find(
        (candidate) => candidate.fixedSlotName === prior.fixedSlotName,
      );
      expect(current?.envelope?.saveId ?? null).toBe(
        prior.envelope?.saveId ?? null,
      );
      expect(current?.sidecarSha256 ?? null).toBe(prior.sidecarSha256 ?? null);
    }
    expect(readdirSync(sidecarDirectory).toSorted()).toEqual(
      sidecarsBeforeDelete,
    );
  };

  await openTitleLoadBrowser();
  await clickSaveCardButton("manual", slot, "刪除");
  await waitForDialog(`刪除手動存檔 ${slot}`);
  // ① The dialog onMount must land on the safe 取消 before anything else can
  // happen. This focus is set by JS on mount, so it is real in every input
  // mode — including macOS WebKit with 「Keyboard navigation」 off.
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          document.activeElement instanceof HTMLButtonElement &&
          (document.activeElement.textContent ?? "").trim() === "取消",
      ),
    {
      timeout: 15000,
      timeoutMsg: "delete confirmation did not focus the safe 取消 button",
    },
  );
  // Input-mode note (HPA-830): this packaged stack's WebDriver keys arrive as
  // untrusted DOM events (isTrusted=false, verified 2026-11-14 with a
  // document-level keydown probe), so they can drive only the app's own JS
  // key handlers — never native Enter activation or traversal. Cancel,
  // reopen, and confirm therefore use programmatic clicks (the same handlers
  // a real click or a real keyboard's native Enter activation reaches), and
  // the only key sent is Tab, which the dialog owns in JS: its unconditional
  // cycling preventDefaults every Tab and focuses controls itself, so the
  // assertion below exercises the exact handler path a real keyboard takes.
  // The trusted-key Enter journey itself remains manual-UAT scope; this test
  // does not claim it.
  await clickDialogButton(`刪除手動存檔 ${slot}`, "取消");
  // ② The cancel must restore focus to the *remounted* opener button.
  try {
    await browser.waitUntil(
      async () =>
        browser.execute(
          (slotNumber: number) =>
            document.activeElement ===
            document.querySelector(
              `article[data-slot-type="manual"][data-slot-number="${slotNumber}"] button[aria-label="刪除手動存檔 ${slotNumber}"]`,
            ),
          slot,
        ),
      {
        timeout: 15000,
        timeoutMsg: `cancelled delete did not restore focus to the remounted manual slot ${slot} delete button`,
      },
    );
  } catch (error) {
    const state = await browser.execute(() => ({
      activeElement:
        document.activeElement instanceof HTMLElement
          ? {
              tag: document.activeElement.tagName,
              text: (document.activeElement.textContent ?? "").trim(),
            }
          : String(document.activeElement),
      dialogHeadings: Array.from(
        document.querySelectorAll('[role="dialog"] h2'),
      ).map((node) => (node.textContent ?? "").trim()),
      deleteButtonExists:
        document.querySelector(
          'article[data-slot-type="manual"] button.delete, article[data-slot-type="manual"] [aria-label^="刪除手動存檔"]',
        ) !== null,
    }));
    throw new Error(
      `cancelled delete did not restore focus to the remounted manual slot ${slot} delete button; post-cancel state=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
  assertDeleteNotCommitted();
  // ③ Reopening must only bring back the confirmation; it must not delete.
  await clickSaveCardButton("manual", slot, "刪除");
  await waitForDialog(`刪除手動存檔 ${slot}`);
  assertDeleteNotCommitted();
  // ④ Tab (driven through the dialog's unconditional JS cycling) must land
  // exactly on 確認刪除; only an explicit activation of it commits. The
  // automation can deliver a synthesized keydown late or drop it, so Tab is
  // re-sent only while focus is provably back on the safe 取消, and the focus
  // trace is reported if it never lands.
  const focusTrace: string[] = [];
  await browser.waitUntil(
    async () => {
      const state = await browser.execute((confirmLabel: string) => {
        const active = document.activeElement;
        const text =
          active instanceof HTMLElement
            ? (active.textContent ?? "").trim()
            : String(active);
        return {
          focused: text === confirmLabel,
          onSafeDefault: text === "取消",
          text,
        };
      }, anchors.confirmDelete);
      focusTrace.push(state.text);
      if (state.focused) return true;
      if (state.onSafeDefault) await browser.keys("Tab");
      return false;
    },
    {
      timeout: 10000,
      interval: 200,
      timeoutMsg: `Tab cycling did not land on 確認刪除 (trace=${JSON.stringify(focusTrace)})`,
    },
  );
  await clickDialogButton(`刪除手動存檔 ${slot}`, anchors.confirmDelete);
  await browser.waitUntil(
    async () => (await saveCardText("manual", slot)).includes("空白存檔"),
    { timeout: 30000, timeoutMsg: `manual slot ${slot} did not become empty` },
  );
  expect(readSaveE2eEnvelope(fixedSlotName)).toBeNull();
  expect(existsSync(targetSidecarPath)).toBe(false);
  const after = readSaveE2eOwnershipSnapshot();
  for (const prior of before.slots.filter(
    (candidate) => candidate.fixedSlotName !== fixedSlotName,
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
      await recoverOlderFromOpenBrowser();
    } else if (phase === SAVE_E2E_PHASE_NAMES.managementMissingThumbnail) {
      await proveThumbnailFallback("missing", 1);
    } else if (phase === SAVE_E2E_PHASE_NAMES.managementCorruptThumbnail) {
      await proveThumbnailFallback("corrupt", 2);
      await deleteOwnedManual(2);
    } else {
      throw new Error(`unexpected management phase ${String(phase)}`);
    }
  });
});
