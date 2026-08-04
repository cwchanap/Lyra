import {
  acknowledgeAcquisitionDomFirst,
  advanceDialogueOnce,
  advanceDialogueUntil,
  clickButton,
  clickPersistenceBrowserButton,
  closePersistenceBrowserToGameplay,
  currentPackagedDocumentIdentity,
  dialogueFingerprint,
  dismissAllPendingAcquisitions,
  drainCurrentDialogue,
  elementExists,
  getPackagedGameState,
  invokePackagedCommand,
  jsClick,
  jumpToProductionScene,
  openTitleLoadBrowser,
  resetE2eStorageWithStoryClearance,
  returnToTitle,
  saveCardText,
  saveManualSlot,
  startFromMenu,
  waitForAcquisitionOrdinal,
  waitForButton,
  waitForNoDialog,
  waitForPackagedGameState,
  waitForPersistenceIdle,
} from "./helpers";
import {
  newestAutosaveSlot,
  waitForSaveE2eEnvelope,
  writeSaveE2eExpectation,
  type ExpectedResumeCheckpoint,
  type SeedControl,
} from "./save-fixtures";
import { anchors } from "./production-anchors";
import type { SaveBrowserOpenResultView } from "$lib/persistence/types";

describe("save seed", () => {
  it("seeds Unicode, composite, acquisition, investigation, and interrogation checkpoints", async function () {
    this.timeout(1_800_000);
    const activeSceneAuthoredSummary =
      "三宅母親正式委託相馬與早坂，兩人循程序爭取重新調查的機會，也明白今天真正要保住的是再次檢視證據的權利。";
    await resetE2eStorageWithStoryClearance();
    await browser.execute(() => {
      const diagnosticWindow = window as Window & {
        __saveE2eRuntimeErrors?: string[];
      };
      const errors: string[] = [];
      diagnosticWindow.__saveE2eRuntimeErrors = errors;
      window.addEventListener("error", (event) => {
        const stack =
          event.error instanceof Error ? (event.error.stack ?? "") : "";
        errors.push(
          [
            `error:${event.message}`,
            `${event.filename}:${event.lineno}:${event.colno}`,
            stack,
          ]
            .filter(Boolean)
            .join(" "),
        );
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason =
          event.reason instanceof Error
            ? (event.reason.stack ?? event.reason.message)
            : String(event.reason);
        errors.push(`unhandledrejection:${reason}`);
      });
    });
    const documentIdentity = await currentPackagedDocumentIdentity();
    await startFromMenu();

    await jumpToProductionScene(anchors.unicodeSave.compositeSceneId);
    await drainCurrentDialogue("explore");
    await waitForPersistenceIdle();
    const hotspot = `button[aria-label="${anchors.unicodeSave.compositeHotspot}"]`;
    try {
      await browser.waitUntil(async () => elementExists(hotspot), {
        timeout: 30000,
        timeoutMsg: "two-record production hotspot did not appear",
      });
    } catch (error) {
      const frontend = await browser.execute(() => {
        return {
          url: window.location.href,
          documentIdentity:
            document.documentElement.dataset.saveDocumentIdentity ?? null,
          titleVisible:
            document.querySelector('[aria-label="主選單"]') !== null,
          gameplayRootVisible:
            document.querySelector("[data-gameplay-root]") !== null,
          captureRootVisible:
            document.querySelector("[data-save-thumbnail-root]") !== null,
          runtimeErrors:
            (
              window as Window & {
                __saveE2eRuntimeErrors?: string[];
              }
            ).__saveE2eRuntimeErrors ?? [],
          bodyText: (document.body.textContent ?? "").trim(),
          buttons: Array.from(
            document.querySelectorAll<HTMLButtonElement>("button"),
          ).map((button) => ({
            ariaLabel: button.getAttribute("aria-label"),
            text: (button.textContent ?? "").trim(),
            disabled: button.disabled,
          })),
        };
      });
      const native = await getPackagedGameState();
      throw new Error(
        `two-record production hotspot did not appear; frontend=${JSON.stringify(frontend)}; native=${JSON.stringify(native)}`,
        { cause: error },
      );
    }
    await jsClick(hotspot);
    const interactionStart = await waitForPackagedGameState(
      (state) => state.mode.type === "dialogue",
      30000,
      "two-record command did not install authored dialogue",
    );
    expect(interactionStart.pendingAcquisition).toBeNull();

    await advanceDialogueOnce();
    const compositeState = await waitForPackagedGameState(
      (state) =>
        state.mode.type === "dialogue" && state.mode.queueToken.cursor > 0,
      15000,
      "composite queue did not advance to a nonzero flattened cursor",
    );
    if (compositeState.mode.type !== "dialogue") {
      throw new Error("composite state left dialogue unexpectedly");
    }
    expect(compositeState.mode.queueToken.cursor).toBeGreaterThan(0);

    await saveManualSlot(2, "複合佇列復原點");
    // This phase seeds authoritative restore checkpoints. Thumbnail success is
    // proved by the dedicated packaged capture phase; the persistence contract
    // deliberately allows a valid save to retain an unavailable placeholder.
    const compositeEnvelope = await waitForSaveE2eEnvelope(
      "manual-2",
      (envelope) =>
        envelope.snapshot.activeDialogue !== null &&
        envelope.snapshot.activeDialogue.itemCursor > 0,
    );
    if (compositeEnvelope.schemaVersion !== 2) {
      throw new Error("composite save was not written with schema version 2");
    }
    expect(compositeEnvelope.snapshot.scene.type).toBe("investigation");
    if (compositeEnvelope.snapshot.scene.type !== "investigation") {
      throw new Error("composite save did not persist investigation progress");
    }
    const compositeSceneSnapshot = compositeEnvelope.snapshot.scene;
    expect(compositeSceneSnapshot.currentSublocationId).not.toBeNull();
    expect(compositeSceneSnapshot.inspectedHotspotIds.length).toBeGreaterThan(
      0,
    );
    expect(compositeSceneSnapshot.enteredSublocationIds.length).toBeGreaterThan(
      0,
    );
    expect(
      compositeEnvelope.snapshot.inventory.evidence.length,
    ).toBeGreaterThan(0);
    expect(compositeEnvelope.summary.sceneSummary).toBeNull();
    if (compositeEnvelope.thumbnail.type === "available") {
      expect(compositeEnvelope.thumbnail.objectId).toBe(
        compositeEnvelope.saveId,
      );
    }
    await closePersistenceBrowserToGameplay();

    await advanceDialogueUntil(async () => {
      try {
        return (await getPackagedGameState()).pendingAcquisition?.ordinal === 0;
      } catch {
        return false;
      }
    }, 80);
    const firstAcquisition = await waitForAcquisitionOrdinal(0);
    const firstEvent = firstAcquisition.pendingAcquisition;
    expect(firstEvent?.id).toMatch(/^acq:\d+:0$/);
    await waitForButton("CONTINUE");
    expect(await elementExists('[role="dialog"]')).toBe(true);
    await acknowledgeAcquisitionDomFirst(firstEvent!);
    const secondAcquisition = await waitForAcquisitionOrdinal(1);
    const secondEvent = secondAcquisition.pendingAcquisition;
    expect(secondEvent?.id).toMatch(/^acq:\d+:1$/);
    expect(secondEvent?.createdByCommandId).toBe(
      firstEvent?.createdByCommandId,
    );
    const firstAcknowledgementAutosave = newestAutosaveSlot();
    if (!firstAcknowledgementAutosave?.envelope) {
      throw new Error("no autosave envelope exists");
    }
    await acknowledgeAcquisitionDomFirst(secondEvent!);
    await waitForPackagedGameState(
      (state) => state.pendingAcquisition === null,
      30000,
      "second acquisition acknowledgement did not complete",
    );
    await waitForNoDialog(anchors.evidenceAcquired, 90000);
    await waitForPersistenceIdle();
    const secondAcknowledgementAutosave = newestAutosaveSlot();
    if (!secondAcknowledgementAutosave?.envelope) {
      throw new Error("no autosave envelope exists");
    }
    expect(secondAcknowledgementAutosave.fixedSlotName).toBe(
      firstAcknowledgementAutosave.fixedSlotName,
    );
    expect(secondAcknowledgementAutosave.envelope.saveId).not.toBe(
      firstAcknowledgementAutosave.envelope.saveId,
    );
    const acknowledgementEnvelope = await waitForSaveE2eEnvelope(
      secondAcknowledgementAutosave.fixedSlotName,
      (envelope) =>
        envelope.saveId === secondAcknowledgementAutosave.envelope!.saveId,
    );
    if (acknowledgementEnvelope.thumbnail.type === "available") {
      expect(acknowledgementEnvelope.thumbnail.objectId).toBe(
        acknowledgementEnvelope.saveId,
      );
    }

    await jumpToProductionScene(anchors.unicodeSave.interrogationSceneId);
    await drainCurrentDialogue("interrogation");
    await dismissAllPendingAcquisitions({ forceCaptureUnavailable: true });
    await clickButton(anchors.unicodeSave.interrogationQuestion);
    const playing = await waitForPackagedGameState(
      (state) =>
        state.mode.type === "dialogue" && state.scene.kind === "interrogation",
      30000,
      "interrogation testimony did not enter Playing",
    );
    expect(playing.scene.kind).toBe("interrogation");
    await advanceDialogueUntil(async () => {
      return browser.execute((label: string) => {
        return Array.from(document.querySelectorAll("button")).some((button) =>
          (button.textContent ?? "").includes(label),
        );
      }, anchors.unicodeSave.challenge);
    }, 80);
    await clickButton(anchors.unicodeSave.challenge);
    await advanceDialogueUntil(async () => {
      try {
        const state = await getPackagedGameState();
        return (
          state.mode.type === "interrogation" &&
          state.scene.kind === "interrogation" &&
          state.scene.visiblePhases.some(
            (phase) => phase.crossExam?.presenting === true,
          )
        );
      } catch {
        return false;
      }
    }, 80);
    const presenting = await waitForPackagedGameState(
      (state) =>
        state.mode.type === "interrogation" &&
        state.scene.kind === "interrogation" &&
        state.scene.visiblePhases.some(
          (phase) => phase.crossExam?.presenting === true,
        ),
      30000,
      "interrogation did not restore to Presenting tray state",
    );
    await saveManualSlot(3, "訊問提出證據狀態");
    const interrogationEnvelope = await waitForSaveE2eEnvelope(
      "manual-3",
      (envelope) =>
        envelope.summary.sceneId === anchors.unicodeSave.interrogationSceneId,
    );
    if (interrogationEnvelope.schemaVersion !== 2) {
      throw new Error(
        "interrogation save was not written with schema version 2",
      );
    }
    expect(interrogationEnvelope.snapshot.scene.type).toBe("interrogation");
    if (interrogationEnvelope.snapshot.scene.type !== "interrogation") {
      throw new Error(
        "interrogation save did not persist interrogation progress",
      );
    }
    const interrogationSceneSnapshot = interrogationEnvelope.snapshot.scene;
    expect(interrogationSceneSnapshot.crossExam.type).toBe("presenting");
    expect(interrogationSceneSnapshot.enteredPhaseIds.length).toBeGreaterThan(
      0,
    );
    expect(interrogationEnvelope.summary.sceneSummary).toBeNull();
    await closePersistenceBrowserToGameplay();

    await jumpToProductionScene("scene_2");
    const stable = await waitForPackagedGameState(
      (state) =>
        state.mode.type === "dialogue" &&
        state.scene.id === "scene_2" &&
        state.mode.queueToken.cursor > 0,
      30000,
      "stable single-segment dialogue checkpoint did not appear",
    ).catch(async () => {
      await advanceDialogueOnce();
      return waitForPackagedGameState(
        (state) =>
          state.mode.type === "dialogue" && state.scene.id === "scene_2",
      );
    });
    if (stable.mode.type !== "dialogue") {
      throw new Error("stable checkpoint is not dialogue");
    }
    await saveManualSlot(1, anchors.unicodeSave.unicodeName);
    const unicodeEnvelope = await waitForSaveE2eEnvelope(
      "manual-1",
      (envelope) => envelope.displayName === anchors.unicodeSave.unicodeName,
    );
    expect(unicodeEnvelope.schemaVersion).toBe(2);
    if (unicodeEnvelope.schemaVersion !== 2) {
      throw new Error("new manual save was not written with schema version 2");
    }
    expect(unicodeEnvelope.summary.chapterSummary).not.toBeNull();
    expect(unicodeEnvelope.summary.sceneSummary).toBeNull();
    const checkpoint: ExpectedResumeCheckpoint = {
      saveId: unicodeEnvelope.saveId,
      displayName: unicodeEnvelope.displayName,
      chapterId: stable.chapter.id,
      sceneId: stable.scene.id,
      queueGen: stable.mode.queueToken.queueGen,
      cursor: stable.mode.queueToken.cursor,
      currentDialogueFingerprint: dialogueFingerprint(stable),
    };
    writeSaveE2eExpectation("expected-resume-checkpoint", {
      ...checkpoint,
      documentIdentity,
    });
    writeSaveE2eExpectation("management-state", {
      documentIdentity,
      checkpoint,
      composite: {
        fixedSlotName: "manual-2",
        saveId: compositeEnvelope.saveId,
        queueGen: compositeState.mode.queueToken.queueGen,
        cursor: compositeState.mode.queueToken.cursor,
        currentDialogueFingerprint: dialogueFingerprint(compositeState),
        pendingEventIds: [firstEvent!.id, secondEvent!.id],
        sceneSnapshot: compositeSceneSnapshot,
        inventorySnapshot: compositeEnvelope.snapshot.inventory,
        visualCueSnapshot: compositeEnvelope.snapshot.lastVisualCue,
      },
      interrogation: {
        fixedSlotName: "manual-3",
        saveId: interrogationEnvelope.saveId,
        phaseId:
          presenting.scene.kind === "interrogation"
            ? (presenting.scene.currentPhaseId ?? "")
            : "",
        presenting: true,
        sceneSnapshot: interrogationSceneSnapshot,
        inventorySnapshot: interrogationEnvelope.snapshot.inventory,
        visualCueSnapshot: interrogationEnvelope.snapshot.lastVisualCue,
      },
      acknowledgementAutosave: secondAcknowledgementAutosave.fixedSlotName,
    } satisfies SeedControl);
    await closePersistenceBrowserToGameplay();
    await returnToTitle();
    expect(await elementExists('[aria-label="主選單"]')).toBe(true);

    await openTitleLoadBrowser();
    const manualOneText = await saveCardText("manual", 1);
    expect(manualOneText).toContain(unicodeEnvelope.summary.chapterTitle);
    expect(manualOneText).toContain(unicodeEnvelope.summary.sceneTitle);
    for (const field of [
      unicodeEnvelope.summary.chapterSummary,
      unicodeEnvelope.summary.sceneSummary,
      unicodeEnvelope.summary.activePrimaryObjectiveLabel,
      unicodeEnvelope.summary.activePrimaryObjectiveSummary,
    ]) {
      if (field) expect(manualOneText).toContain(field);
    }
    expect(manualOneText).not.toContain(activeSceneAuthoredSummary);
    await clickPersistenceBrowserButton("返回");

    const titleDiscovery =
      await invokePackagedCommand<SaveBrowserOpenResultView>("list_saves");
    const continueReference = titleDiscovery.continueCandidate;
    if (!continueReference) {
      throw new Error("schema-v2 seed did not produce a Continue candidate");
    }
    const continueSlot = titleDiscovery.browser.slots.find(
      (slot) =>
        slot.reference.type === continueReference.type &&
        slot.reference.slot === continueReference.slot,
    );
    if (!continueSlot || continueSlot.status.type !== "valid") {
      throw new Error(
        "Continue candidate did not expose valid schema-v2 metadata",
      );
    }
    expect(continueSlot.status.metadata.schemaVersion).toBe(2);
    expect(continueSlot.status.metadata.summary.chapterSummary).not.toBeNull();
    expect(continueSlot.status.metadata.summary.sceneSummary).toBeNull();
    expect(continueSlot.status.metadata.saveId).toBe(unicodeEnvelope.saveId);
    const titleRecaps = await browser.execute(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[aria-label="繼續遊戲摘要"]'),
      ).map((region) => region.textContent ?? ""),
    );
    expect(titleRecaps).toHaveLength(1);
    expect(titleRecaps[0]).toContain(
      continueSlot.status.metadata.summary.chapterTitle,
    );
    expect(titleRecaps[0]).toContain(
      continueSlot.status.metadata.summary.sceneTitle,
    );
    for (const field of [
      continueSlot.status.metadata.summary.chapterSummary,
      continueSlot.status.metadata.summary.sceneSummary,
      continueSlot.status.metadata.summary.activePrimaryObjectiveLabel,
      continueSlot.status.metadata.summary.activePrimaryObjectiveSummary,
    ]) {
      if (field) expect(titleRecaps[0]).toContain(field);
    }
    expect(titleRecaps[0]).not.toContain(activeSceneAuthoredSummary);
  });
});
