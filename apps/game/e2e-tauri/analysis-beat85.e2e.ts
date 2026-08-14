import {
  advanceDialogueUntil,
  clickButton,
  closePersistenceBrowserToGameplay,
  continueFromTitle,
  getPackagedGameState,
  jumpToProductionScene,
  loadPackagedCheckpoint,
  resetE2eStorage,
  returnToTitle,
  saveManualSlot,
  waitForPackagedGameState,
} from "./helpers";
import type { AnalysisBoardView, GameStateView } from "$lib/state/types";

const ANALYSIS_SCENE_ID = "analysis_scene_8_5";
const HEARING_SCENE_ID = "interrogation_scene_10";
const APPROVED_CLIP_ID = "approved_clip";

function analysisBoard(state: GameStateView, id: string): AnalysisBoardView {
  if (state.scene.kind !== "analysis") {
    throw new Error(`expected Analysis scene, got ${state.scene.kind}`);
  }
  const board = state.scene.visibleBoards.find(
    (candidate) => candidate.id === id,
  );
  if (!board) throw new Error(`analysis board ${id} is not visible`);
  return board;
}

async function clickAnalysisCard(
  label: string,
  boardClass: string,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (expectedLabel: string, expectedClass: string) => {
          const board = document.querySelector(expectedClass);
          return Array.from(
            board?.querySelectorAll<HTMLButtonElement>(
              "button.analysis-card:not(:disabled)",
            ) ?? [],
          ).some(
            (button) =>
              (button.querySelector("strong")?.textContent ?? "").trim() ===
              expectedLabel,
          );
        },
        label,
        boardClass,
      ),
    {
      timeout: 30000,
      interval: 100,
      timeoutMsg: `analysis card ${label} did not become clickable`,
    },
  );
  const clicked = await browser.execute(
    (expectedLabel: string, expectedClass: string) => {
      const board = document.querySelector(expectedClass);
      const button = Array.from(
        board?.querySelectorAll<HTMLButtonElement>(
          "button.analysis-card:not(:disabled)",
        ) ?? [],
      ).find(
        (candidate) =>
          (candidate.querySelector("strong")?.textContent ?? "").trim() ===
          expectedLabel,
      );
      button?.click();
      return button !== undefined;
    },
    label,
    boardClass,
  );
  if (!clicked) throw new Error(`analysis card ${label} was not clickable`);
}

async function waitForAnalysisBoard(boardId: string): Promise<GameStateView> {
  return waitForPackagedGameState(
    (state) =>
      state.scene.kind === "analysis" &&
      state.scene.id === ANALYSIS_SCENE_ID &&
      state.mode.type === "analysis" &&
      state.mode.boardId === boardId,
    30000,
    `analysis board ${boardId} did not become active`,
  );
}

async function submitCurrentAnalysisBoard(): Promise<void> {
  await clickButton("比對推論");
  await waitForPackagedGameState(
    (state) => state.mode.type === "dialogue" || state.mode.type === "analysis",
    30000,
    "analysis submission did not settle",
  );
}

async function drainToAnalysisBoard(boardId: string): Promise<GameStateView> {
  await advanceDialogueUntil(async () => {
    try {
      const state = await getPackagedGameState();
      return state.mode.type === "analysis" && state.mode.boardId === boardId;
    } catch {
      return false;
    }
  }, 120);
  return waitForAnalysisBoard(boardId);
}

async function challengePhase(
  phaseId: string,
  evidenceId: string,
  nextPhaseId: string,
): Promise<GameStateView> {
  const before = await waitForPackagedGameState(
    (state) =>
      state.scene.kind === "interrogation" &&
      state.scene.currentPhaseId === phaseId &&
      state.mode.type === "interrogation",
    30000,
    `${phaseId} did not become the active interrogation phase`,
  );
  if (before.scene.kind !== "interrogation") {
    throw new Error(`${phaseId} state was not interrogation`);
  }
  const phase = before.scene.visiblePhases.find(
    (candidate) => candidate.id === phaseId,
  );
  if (!phase) throw new Error(`phase ${phaseId} is not visible`);
  const question = phase.questions[0];
  if (!question) throw new Error(`phase ${phaseId} has no question`);

  await clickButton(question.label);
  await waitForPackagedGameState(
    (state) =>
      state.mode.type === "dialogue" && state.mode.crossExamLineId !== null,
    30000,
    `${phaseId} testimony did not start`,
  );
  await advanceDialogueUntil(
    async () =>
      browser.execute(
        () =>
          document.querySelector("button.xexam-challenge:not(:disabled)") !==
          null,
      ),
    80,
  );
  await clickButton("反駁");
  await advanceDialogueUntil(async () => {
    try {
      const state = await getPackagedGameState();
      return (
        state.mode.type === "interrogation" &&
        state.scene.kind === "interrogation" &&
        state.scene.visiblePhases.some(
          (candidate) =>
            candidate.id === phaseId && candidate.crossExam?.presenting,
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
        (candidate) =>
          candidate.id === phaseId && candidate.crossExam?.presenting,
      ),
    30000,
    `${phaseId} did not open the evidence tray`,
  );
  const evidence = presenting.inventory.evidence.find(
    (candidate) => candidate.id === evidenceId,
  );
  if (!evidence)
    throw new Error(`${phaseId} evidence ${evidenceId} was not seeded`);
  await clickButton(evidence.name);

  await advanceDialogueUntil(async () => {
    try {
      const state = await getPackagedGameState();
      return (
        state.mode.type === "interrogation" &&
        state.scene.kind === "interrogation" &&
        state.scene.visiblePhases.some(
          (candidate) => candidate.id === phaseId && candidate.canComplete,
        )
      );
    } catch {
      return false;
    }
  }, 160);
  await clickButton("完成訊問");

  await advanceDialogueUntil(async () => {
    try {
      const state = await getPackagedGameState();
      return (
        state.scene.kind === "interrogation" &&
        state.scene.currentPhaseId === nextPhaseId &&
        state.mode.type === "interrogation"
      );
    } catch {
      return false;
    }
  }, 160);
  return waitForPackagedGameState(
    (state) =>
      state.scene.kind === "interrogation" &&
      state.scene.currentPhaseId === nextPhaseId &&
      state.mode.type === "interrogation",
    30000,
    `${phaseId} did not advance to ${nextPhaseId}`,
  );
}

describe("packaged Analysis Beat 8.5 journey", () => {
  it("persists one-card Threshold draft, completes the gate, and reaches p4", async function () {
    this.timeout(1_800_000);
    await resetE2eStorage();
    await loadPackagedCheckpoint("chapter-1-analysis-beat-85-ready");

    let state = await waitForAnalysisBoard("evidence_packages");
    expect(
      state.inventory.evidence.some(
        (evidence) => evidence.id === APPROVED_CLIP_ID,
      ),
    ).toBe(false);
    const classify = analysisBoard(state, "evidence_packages");
    if (classify.kind !== "classify")
      throw new Error("evidence_packages is not classify");
    const groups = new Map(
      classify.groups.map((group) => [group.id, group.label]),
    );
    const cardGroupIds: Record<string, string> = {
      miyake_call: "miyake_small_lies",
      miyake_pov_replay: "earlier_third_party",
      external_credential_event: "earlier_third_party",
      event_1841: "lock_chronology",
      event_1842: "lock_chronology",
      event_1843: "lock_chronology",
      event_1844: "lock_chronology",
    };
    let assignedCount = 0;
    for (const card of classify.cards) {
      const groupId = cardGroupIds[card.id];
      if (!groupId) throw new Error(`missing classify mapping for ${card.id}`);
      const groupLabel = groups.get(groupId);
      if (!groupLabel) throw new Error(`missing classify group ${groupId}`);
      await clickAnalysisCard(card.label, ".classify-board");
      await clickButton(`放入「${groupLabel}」`);
      assignedCount += 1;
      await waitForPackagedGameState((next) => {
        const board = analysisBoard(next, "evidence_packages");
        return (
          board.draft.kind === "classify" &&
          Object.keys(board.draft.groupByCard).length >= assignedCount
        );
      });
    }
    await submitCurrentAnalysisBoard();
    await drainToAnalysisBoard("local_event_sequence");

    state = await waitForAnalysisBoard("local_event_sequence");
    const order = analysisBoard(state, "local_event_sequence");
    if (order.kind !== "order")
      throw new Error("local_event_sequence is not order");
    for (const card of order.cards.filter(
      (candidate) => candidate.id !== "event_1841",
    )) {
      await clickButton(`加入時間線：${card.label}`);
      await waitForPackagedGameState((next) => {
        const board = analysisBoard(next, "local_event_sequence");
        return (
          board.draft.kind === "order" && board.draft.cardIds.includes(card.id)
        );
      });
    }
    await submitCurrentAnalysisBoard();
    await drainToAnalysisBoard("narrow_request_basis");

    state = await waitForAnalysisBoard("narrow_request_basis");
    expect(
      state.inventory.evidence.some(
        (evidence) => evidence.id === APPROVED_CLIP_ID,
      ),
    ).toBe(false);
    const threshold = analysisBoard(state, "narrow_request_basis");
    if (threshold.kind !== "threshold")
      throw new Error("narrow_request_basis is not threshold");
    const firstCard = threshold.cards.find(
      (card) => card.id === "lock_sequence",
    );
    if (!firstCard) throw new Error("lock_sequence threshold card is missing");
    await clickAnalysisCard(firstCard.label, ".threshold-board");
    await waitForPackagedGameState((next) => {
      const board = analysisBoard(next, "narrow_request_basis");
      return (
        board.draft.kind === "threshold" &&
        JSON.stringify(board.draft.selectedCardIds) ===
          JSON.stringify(["lock_sequence"])
      );
    });

    await saveManualSlot(1, "Beat 8.5 門鎖申請草稿");
    await closePersistenceBrowserToGameplay();
    await returnToTitle();
    await continueFromTitle();
    state = await waitForAnalysisBoard("narrow_request_basis");
    expect(
      state.inventory.evidence.some(
        (evidence) => evidence.id === APPROVED_CLIP_ID,
      ),
    ).toBe(false);
    const restoredThreshold = analysisBoard(state, "narrow_request_basis");
    if (
      restoredThreshold.kind !== "threshold" ||
      restoredThreshold.draft.kind !== "threshold"
    ) {
      throw new Error(
        "Continue did not restore the exact one-card Threshold draft",
      );
    }
    if (
      JSON.stringify(restoredThreshold.draft.selectedCardIds) !==
      JSON.stringify(["lock_sequence"])
    ) {
      throw new Error(
        "Continue did not restore the exact one-card Threshold draft",
      );
    }

    const secondCard = restoredThreshold.cards.find(
      (card) => card.id === "phone_notification",
    );
    if (!secondCard)
      throw new Error("phone_notification threshold card is missing");
    await clickAnalysisCard(secondCard.label, ".threshold-board");
    await waitForPackagedGameState((next) => {
      const board = analysisBoard(next, "narrow_request_basis");
      return (
        board.draft.kind === "threshold" &&
        JSON.stringify(board.draft.selectedCardIds) ===
          JSON.stringify(["lock_sequence", "phone_notification"])
      );
    });
    await submitCurrentAnalysisBoard();
    state = await waitForPackagedGameState((next) => {
      const board = analysisBoard(next, "narrow_request_basis");
      return board.completed;
    });
    expect(
      state.inventory.evidence.some(
        (evidence) => evidence.id === APPROVED_CLIP_ID,
      ),
    ).toBe(false);
    expect(
      state.story.objectives.some(
        (objective) =>
          objective.id === "prepare_narrow_lock_request" && objective.completed,
      ),
    ).toBe(true);

    await jumpToProductionScene(HEARING_SCENE_ID);
    state = await waitForPackagedGameState(
      (next) =>
        next.scene.kind === "interrogation" &&
        next.scene.id === HEARING_SCENE_ID,
      30000,
      "debug jump did not reach the hearing",
    );
    expect(
      state.story.facts.some(
        (fact) => fact.id === "two_independent_lock_contradictions_identified",
      ),
    ).toBe(true);
    expect(
      state.story.objectives.some(
        (objective) =>
          objective.id === "prepare_narrow_lock_request" && objective.completed,
      ),
    ).toBe(true);
    expect(
      state.inventory.evidence.some(
        (evidence) => evidence.id === APPROVED_CLIP_ID,
      ),
    ).toBe(false);

    await advanceDialogueUntil(
      async () => (await getPackagedGameState()).mode.type === "interrogation",
      160,
    );
    await challengePhase("p1", "closing_routine", "p2");
    await challengePhase("p2", "victim_phone_notification", "p3");
    const gateReady = await challengePhase("p3", "miyake_pov_replay", "gate");
    expect(
      gateReady.inventory.evidence.filter(
        (evidence) => evidence.id === APPROVED_CLIP_ID,
      ),
    ).toHaveLength(0);
    expect(
      gateReady.story.authorizations.filter(
        (authorization) => authorization.id === "narrow_lock_export",
      ),
    ).toHaveLength(0);
    const gate = await challengePhase(
      "gate",
      "doorlock_summary_timetable",
      "p4",
    );
    expect(gate.scene.kind).toBe("interrogation");
    expect(
      gate.story.authorizations.filter(
        (authorization) => authorization.id === "narrow_lock_export",
      ),
    ).toHaveLength(1);
    expect(
      gate.inventory.evidence.filter(
        (evidence) => evidence.id === APPROVED_CLIP_ID,
      ),
    ).toHaveLength(1);
    const p4 =
      gate.scene.kind === "interrogation"
        ? gate.scene.visiblePhases.find((phase) => phase.id === "p4")
        : null;
    expect(p4).toBeDefined();
  });
});
