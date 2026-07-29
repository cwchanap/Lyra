import {
  acknowledgeAcquisitionDomFirst,
  advanceDialogueOnce,
  advanceDialogueUntil,
  clickButton,
  closePersistenceBrowserToGameplay,
  currentPackagedDocumentIdentity,
  dialogueFingerprint,
  dismissAllPendingAcquisitions,
  drainCurrentDialogue,
  elementExists,
  getPackagedGameState,
  jsClick,
  jumpToProductionScene,
  resetE2eStorageWithStoryClearance,
  returnToTitle,
  saveManualSlot,
  startFromMenu,
  waitForAcquisitionOrdinal,
  waitForButton,
  waitForNoDialog,
  waitForPackagedGameState,
  waitForPersistenceIdle,
} from "./helpers";
import {
  readHpa392OwnershipSnapshot,
  waitForHpa392Envelope,
  writeHpa392Expectation,
  type ExpectedResumeCheckpoint,
  type Hpa392FixedSlotName,
  type SeedControl,
} from "./hpa-392-fixtures";
import { anchors } from "./production-anchors";

function newestAutosave(): {
  fixedSlotName: Hpa392FixedSlotName;
  saveId: string;
} {
  const newest = readHpa392OwnershipSnapshot()
    .slots.filter(
      (slot) =>
        slot.fixedSlotName.startsWith("autosave-") && slot.envelope !== null,
    )
    .toSorted(
      (left, right) =>
        Date.parse(right.envelope!.savedAt) -
        Date.parse(left.envelope!.savedAt),
    )[0];
  if (!newest?.envelope) throw new Error("no autosave envelope exists");
  return {
    fixedSlotName: newest.fixedSlotName,
    saveId: newest.envelope.saveId,
  };
}

describe("HPA-392 save seed", () => {
  it("seeds Unicode, composite, acquisition, investigation, and interrogation checkpoints", async function () {
    this.timeout(1_800_000);
    await resetE2eStorageWithStoryClearance();
    await browser.execute(() => {
      const diagnosticWindow = window as Window & {
        __hpa392RuntimeErrors?: string[];
      };
      const errors: string[] = [];
      diagnosticWindow.__hpa392RuntimeErrors = errors;
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

    await jumpToProductionScene(anchors.hpa392.compositeSceneId);
    await drainCurrentDialogue("explore");
    await waitForPersistenceIdle();
    const hotspot = `button[aria-label="${anchors.hpa392.compositeHotspot}"]`;
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
            document.documentElement.dataset.hpa392DocumentIdentity ?? null,
          titleVisible:
            document.querySelector('[aria-label="主選單"]') !== null,
          gameplayRootVisible:
            document.querySelector("[data-gameplay-root]") !== null,
          captureRootVisible:
            document.querySelector("[data-save-thumbnail-root]") !== null,
          runtimeErrors:
            (
              window as Window & {
                __hpa392RuntimeErrors?: string[];
              }
            ).__hpa392RuntimeErrors ?? [],
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
    const compositeEnvelope = await waitForHpa392Envelope(
      "manual-2",
      (envelope) =>
        envelope.thumbnail.type === "available" &&
        envelope.snapshot.activeDialogue !== null &&
        envelope.snapshot.activeDialogue.itemCursor > 0,
    );
    expect(compositeEnvelope.thumbnail.type).toBe("available");
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
    const firstAcknowledgementAutosave = newestAutosave();
    await acknowledgeAcquisitionDomFirst(secondEvent!);
    await waitForPackagedGameState(
      (state) => state.pendingAcquisition === null,
      30000,
      "second acquisition acknowledgement did not complete",
    );
    await waitForNoDialog(anchors.evidenceAcquired, 90000);
    await waitForPersistenceIdle();
    const secondAcknowledgementAutosave = newestAutosave();
    expect(secondAcknowledgementAutosave.fixedSlotName).toBe(
      firstAcknowledgementAutosave.fixedSlotName,
    );
    expect(secondAcknowledgementAutosave.saveId).not.toBe(
      firstAcknowledgementAutosave.saveId,
    );
    const acknowledgementEnvelope = await waitForHpa392Envelope(
      secondAcknowledgementAutosave.fixedSlotName,
      (envelope) =>
        envelope.saveId === secondAcknowledgementAutosave.saveId &&
        envelope.thumbnail.type === "available",
    );
    if (acknowledgementEnvelope.thumbnail.type === "available") {
      expect(acknowledgementEnvelope.thumbnail.objectId).toBe(
        acknowledgementEnvelope.saveId,
      );
    }

    await jumpToProductionScene(anchors.hpa392.interrogationSceneId);
    await drainCurrentDialogue("interrogation");
    await dismissAllPendingAcquisitions({ forceCaptureUnavailable: true });
    await clickButton(anchors.hpa392.interrogationQuestion);
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
      }, anchors.hpa392.challenge);
    }, 80);
    await clickButton(anchors.hpa392.challenge);
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
    const interrogationEnvelope = await waitForHpa392Envelope(
      "manual-3",
      (envelope) =>
        envelope.summary.sceneId === anchors.hpa392.interrogationSceneId &&
        envelope.thumbnail.type === "available",
    );
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
    await saveManualSlot(1, anchors.hpa392.unicodeName);
    const unicodeEnvelope = await waitForHpa392Envelope(
      "manual-1",
      (envelope) =>
        envelope.displayName === anchors.hpa392.unicodeName &&
        envelope.thumbnail.type === "available",
    );
    const checkpoint: ExpectedResumeCheckpoint = {
      saveId: unicodeEnvelope.saveId,
      displayName: unicodeEnvelope.displayName,
      chapterId: stable.chapter.id,
      sceneId: stable.scene.id,
      queueGen: stable.mode.queueToken.queueGen,
      cursor: stable.mode.queueToken.cursor,
      currentDialogueFingerprint: dialogueFingerprint(stable),
    };
    writeHpa392Expectation("expected-resume-checkpoint", {
      ...checkpoint,
      documentIdentity,
    });
    writeHpa392Expectation("management-state", {
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
  });
});
