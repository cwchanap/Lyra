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
  readHpa392Expectation,
  readHpa392OwnershipSnapshot,
  waitForHpa392Envelope,
  writeHpa392Expectation,
  type ExpectedResumeCheckpoint,
  type Hpa392FixedSlotName,
  type Hpa392InterrogationSceneSnapshot,
  type Hpa392InventorySnapshot,
  type Hpa392InvestigationSceneSnapshot,
  type Hpa392VisualCueSnapshot,
} from "./hpa-392-fixtures";
import { anchors } from "./production-anchors";

type SeedControl = {
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
  acknowledgedCheckpointSaveId?: string;
};

describe("HPA-392 save resume", () => {
  it("reconstructs exact queues and acknowledgement state from disk", async () => {
    const expected = readHpa392Expectation<
      ExpectedResumeCheckpoint & { documentIdentity: string }
    >("expected-resume-checkpoint");
    const control = readHpa392Expectation<SeedControl>("management-state");
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
    const manualOne = readHpa392OwnershipSnapshot().slots.find(
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
    const reserializedComposite = await waitForHpa392Envelope(
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
    await acknowledgeAcquisitionDomFirst(first.pendingAcquisition!);
    const second = await waitForAcquisitionOrdinal(1);
    expect(second.pendingAcquisition?.id).toBe(
      control.composite.pendingEventIds[1],
    );
    await acknowledgeAcquisitionDomFirst(second.pendingAcquisition!);
    await waitForPackagedGameState(
      (state) => state.pendingAcquisition === null,
      30000,
      "resumed acquisition queue did not drain exactly once",
    );

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
    expect(presentingCrossExam?.questionId).toBe(
      control.interrogation.sceneSnapshot.crossExam.type === "presenting"
        ? control.interrogation.sceneSnapshot.crossExam.questionId
        : undefined,
    );
    expect(presentingCrossExam?.lineId).toBe(
      control.interrogation.sceneSnapshot.crossExam.type === "presenting"
        ? control.interrogation.sceneSnapshot.crossExam.lineId
        : undefined,
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
    const reserializedInterrogation = await waitForHpa392Envelope(
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
    await clickButton(anchors.hpa392.withdraw);
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
    if (!newest?.envelope) throw new Error("acknowledged autosave missing");
    writeHpa392Expectation("management-state", {
      ...control,
      resumeDocumentIdentity: documentIdentity,
      acknowledgedCheckpointSaveId: newest.envelope.saveId,
    });
    expect(await elementExists('[aria-label="主選單"]')).toBe(true);
  });
});
