import {
  acknowledgeAcquisitionDomFirst,
  advanceDialogueOnce,
  advanceDialogueUntil,
  clickButton,
  closePersistenceBrowserToGameplay,
  continueFromTitle,
  currentPackagedDocumentIdentity,
  dialogueFingerprint,
  elementExists,
  getPackagedGameState,
  loadTitleSlot,
  returnToTitle,
  saveManualSlot,
  waitForAcquisitionOrdinal,
  waitForButton,
  waitForPackagedGameState,
  waitForShell,
} from "./helpers";
import {
  newestAutosaveSlot,
  readSaveE2eExpectation,
  readSaveE2eOwnershipSnapshot,
  waitForSaveE2eEnvelope,
  writeSaveE2eExpectation,
  type ExpectedResumeCheckpoint,
  type SeedControl,
} from "./save-fixtures";
import { anchors } from "./production-anchors";

type ResumeSeedControl = SeedControl & {
  acknowledgedCheckpointSaveId?: string;
  resumeDocumentIdentity?: string;
};

describe("save resume", () => {
  it("reconstructs exact queues and acknowledgement state from disk", async () => {
    const expected = readSaveE2eExpectation<
      ExpectedResumeCheckpoint & { documentIdentity: string }
    >("expected-resume-checkpoint");
    const control =
      readSaveE2eExpectation<ResumeSeedControl>("management-state");
    await waitForShell();
    const documentIdentity = await currentPackagedDocumentIdentity();
    expect(documentIdentity).not.toBe(expected.documentIdentity);

    await continueFromTitle();
    const resumed = await getPackagedGameState();
    expect(resumed.chapter.id).toBe(expected.chapterId);
    expect(resumed.scene.id).toBe(expected.sceneId);
    expect(resumed.mode.type).toBe("dialogue");
    if (resumed.mode.type !== "dialogue") {
      throw new Error("Unicode checkpoint did not resume in dialogue");
    }
    expect(resumed.mode.queueToken.queueGen).toBe(expected.queueGen);
    expect(resumed.mode.queueToken.cursor).toBe(expected.cursor);
    expect(dialogueFingerprint(resumed)).toBe(
      expected.currentDialogueFingerprint,
    );
    const manualOne = readSaveE2eOwnershipSnapshot().slots.find(
      (slot) => slot.fixedSlotName === "manual-1",
    )?.envelope;
    expect(manualOne?.saveId).toBe(expected.saveId);
    expect(manualOne?.displayName).toBe(expected.displayName);

    await returnToTitle();
    await loadTitleSlot("manual", 2);
    const composite = await getPackagedGameState();
    expect(composite.mode.type).toBe("dialogue");
    if (composite.mode.type !== "dialogue") {
      throw new Error("composite checkpoint did not resume in dialogue");
    }
    expect(composite.mode.queueToken.queueGen).toBe(control.composite.queueGen);
    expect(composite.mode.queueToken.cursor).toBe(control.composite.cursor);
    expect(dialogueFingerprint(composite)).toBe(
      control.composite.currentDialogueFingerprint,
    );
    expect(composite.scene.kind).toBe("investigation");
    if (composite.scene.kind !== "investigation") {
      throw new Error("composite checkpoint did not restore investigation");
    }
    expect(composite.scene.currentSublocationId).toBe(
      control.composite.sceneSnapshot.currentSublocationId,
    );
    const restoredInspected = composite.scene.visibleSublocations
      .flatMap((sublocation) => sublocation.hotspots)
      .filter((hotspot) => hotspot.inspected)
      .map((hotspot) => hotspot.id)
      .toSorted();
    expect(restoredInspected).toEqual(
      control.composite.sceneSnapshot.inspectedHotspotIds.toSorted(),
    );
    const restoredDiscussed = composite.scene.visibleSublocations
      .flatMap((sublocation) => sublocation.characters)
      .flatMap((character) =>
        character.topics
          .filter((topic) => topic.discussed)
          .map((topic) => ({
            characterId: character.id,
            topicId: topic.id,
          })),
      )
      .toSorted((left, right) =>
        `${left.characterId}:${left.topicId}`.localeCompare(
          `${right.characterId}:${right.topicId}`,
        ),
      );
    expect(restoredDiscussed).toEqual(
      control.composite.sceneSnapshot.discussedTopicIds.toSorted(
        (left, right) =>
          `${left.characterId}:${left.topicId}`.localeCompare(
            `${right.characterId}:${right.topicId}`,
          ),
      ),
    );
    expect(
      composite.inventory.evidence.map((record) => record.id).toSorted(),
    ).toEqual(
      control.composite.inventorySnapshot.evidence
        .map((record) => record.recordId)
        .toSorted(),
    );
    expect(
      composite.inventory.statements.map((record) => record.id).toSorted(),
    ).toEqual(
      control.composite.inventorySnapshot.statements
        .map((record) => record.recordId)
        .toSorted(),
    );

    await saveManualSlot(2, "複合佇列復原點", true);
    const reserializedComposite = await waitForSaveE2eEnvelope(
      "manual-2",
      (envelope) => envelope.saveId !== control.composite.saveId,
    );
    expect(reserializedComposite.snapshot.scene).toEqual(
      control.composite.sceneSnapshot,
    );
    expect(reserializedComposite.snapshot.inventory).toEqual(
      control.composite.inventorySnapshot,
    );
    expect(reserializedComposite.snapshot.lastVisualCue).toEqual(
      control.composite.visualCueSnapshot,
    );
    await closePersistenceBrowserToGameplay();
    const previousFingerprint = dialogueFingerprint(composite);
    await advanceDialogueOnce();
    const afterOne = await waitForPackagedGameState(
      (state) =>
        state.mode.type === "dialogue" &&
        state.mode.queueToken.cursor > control.composite.cursor,
      15000,
      "composite resume did not advance to the next authored item",
    );
    expect(dialogueFingerprint(afterOne)).not.toBe(previousFingerprint);

    await advanceDialogueUntil(async () => {
      try {
        return (await getPackagedGameState()).pendingAcquisition?.ordinal === 0;
      } catch {
        return false;
      }
    }, 80);
    const first = await waitForAcquisitionOrdinal(0);
    expect(first.pendingAcquisition?.id).toBe(
      control.composite.pendingEventIds[0],
    );
    await waitForButton("CONTINUE");
    // Capture the expected acquired records before any acknowledgement so the
    // persisted-state replay check below can prove each exists exactly once.
    const expectedRecords: Array<{
      kind: "evidence" | "statement";
      id: string;
    }> = [
      {
        kind: first.pendingAcquisition!.recordKind,
        id: first.pendingAcquisition!.recordId,
      },
    ];
    await acknowledgeAcquisitionDomFirst(first.pendingAcquisition!);
    const second = await waitForAcquisitionOrdinal(1);
    expect(second.pendingAcquisition?.id).toBe(
      control.composite.pendingEventIds[1],
    );
    expectedRecords.push({
      kind: second.pendingAcquisition!.recordKind,
      id: second.pendingAcquisition!.recordId,
    });
    await acknowledgeAcquisitionDomFirst(second.pendingAcquisition!);
    await waitForPackagedGameState(
      (state) => state.pendingAcquisition === null,
      30000,
      "resumed acquisition queue did not drain exactly once",
    );

    // The acknowledgement must persist through the ordinary autosave path
    // with no pending acquisition event in the snapshot.
    const acknowledgedAutosaveSaveId = await (async (): Promise<string> => {
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const newest = newestAutosaveSlot();
        if (newest?.envelope) {
          const snapshot = newest.envelope.snapshot as {
            pendingAcquisitionEvents?: unknown[];
          };
          if ((snapshot.pendingAcquisitionEvents ?? []).length === 0) {
            return newest.envelope.saveId;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(
        "ordinary autosave without a pending acquisition event did not appear",
      );
    })();

    // Continue that persisted state: the popup must not replay, every expected
    // record must exist exactly once, and gameplay must remain resumable.
    await returnToTitle();
    await continueFromTitle();
    const replayed = await getPackagedGameState();
    expect(replayed.pendingAcquisition).toBeNull();
    for (const expected of expectedRecords) {
      const records =
        expected.kind === "evidence"
          ? replayed.inventory.evidence
          : replayed.inventory.statements;
      expect(
        records.filter((record) => record.id === expected.id),
      ).toHaveLength(1);
    }
    expect(replayed.scene.kind).toBe("investigation");
    if (replayed.scene.kind === "investigation") {
      expect(replayed.scene.currentSublocationId).toBe(
        control.composite.sceneSnapshot.currentSublocationId,
      );
      expect(replayed.scene.visibleSublocations.length).toBeGreaterThan(0);
    }
    expect(
      replayed.mode.type === "explore" || replayed.mode.type === "dialogue",
    ).toBe(true);

    await returnToTitle();
    await loadTitleSlot("manual", 3);
    const presenting = await getPackagedGameState();
    expect(presenting.mode.type).toBe("interrogation");
    expect(presenting.scene.kind).toBe("interrogation");
    if (presenting.scene.kind !== "interrogation") {
      throw new Error("interrogation checkpoint did not restore its scene");
    }
    expect(presenting.scene.currentPhaseId).toBe(control.interrogation.phaseId);
    const presentingPhaseId = presenting.scene.currentPhaseId;
    const presentingCrossExam = presenting.scene.visiblePhases.find(
      (phase) => phase.id === presentingPhaseId,
    )?.crossExam;
    if (control.interrogation.sceneSnapshot.crossExam.type !== "presenting") {
      throw new Error(
        "expected control cross-exam snapshot to be in presenting state",
      );
    }
    expect(presentingCrossExam?.questionId).toBe(
      control.interrogation.sceneSnapshot.crossExam.questionId,
    );
    expect(presentingCrossExam?.lineId).toBe(
      control.interrogation.sceneSnapshot.crossExam.lineId,
    );
    const restoredBrokenQuestions = presenting.scene.visiblePhases
      .flatMap((phase) => phase.questions)
      .filter((question) => question.broken)
      .map((question) => question.id)
      .toSorted();
    expect(restoredBrokenQuestions).toEqual(
      control.interrogation.sceneSnapshot.brokenQuestionIds.toSorted(),
    );
    expect(
      presenting.scene.visiblePhases.some(
        (phase) => phase.crossExam?.presenting === true,
      ),
    ).toBe(true);
    expect(
      presenting.inventory.evidence.map((record) => record.id).toSorted(),
    ).toEqual(
      control.interrogation.inventorySnapshot.evidence
        .map((record) => record.recordId)
        .toSorted(),
    );
    expect(
      presenting.inventory.statements.map((record) => record.id).toSorted(),
    ).toEqual(
      control.interrogation.inventorySnapshot.statements
        .map((record) => record.recordId)
        .toSorted(),
    );
    await saveManualSlot(3, "訊問提出證據狀態", true);
    const reserializedInterrogation = await waitForSaveE2eEnvelope(
      "manual-3",
      (envelope) => envelope.saveId !== control.interrogation.saveId,
    );
    expect(reserializedInterrogation.snapshot.scene).toEqual(
      control.interrogation.sceneSnapshot,
    );
    expect(reserializedInterrogation.snapshot.inventory).toEqual(
      control.interrogation.inventorySnapshot,
    );
    expect(reserializedInterrogation.snapshot.lastVisualCue).toEqual(
      control.interrogation.visualCueSnapshot,
    );
    await closePersistenceBrowserToGameplay();
    await clickButton(anchors.unicodeSave.withdraw);
    const resumedPlaying = await waitForPackagedGameState(
      (state) =>
        state.mode.type === "dialogue" && state.scene.kind === "interrogation",
      15000,
      "restored Presenting tray did not accept Withdraw",
    );
    if (resumedPlaying.scene.kind !== "interrogation") {
      throw new Error("Withdraw did not return to interrogation Playing");
    }
    const resumedPlayingPhaseId = resumedPlaying.scene.currentPhaseId;
    const playingCrossExam = resumedPlaying.scene.visiblePhases.find(
      (phase) => phase.id === resumedPlayingPhaseId,
    )?.crossExam;
    expect(playingCrossExam?.presenting).toBe(false);
    expect(playingCrossExam?.questionId).toBe(presentingCrossExam?.questionId);
    expect(playingCrossExam?.lineId).toBe(presentingCrossExam?.lineId);

    await returnToTitle();
    writeSaveE2eExpectation("management-state", {
      ...control,
      resumeDocumentIdentity: documentIdentity,
      acknowledgedCheckpointSaveId: acknowledgedAutosaveSaveId,
    });
    expect(await elementExists('[aria-label="主選單"]')).toBe(true);
  });
});
