import {
  acknowledgeAcquisitionDomFirst,
  advanceDialogueUntil,
  clickButton,
  clickSoleMapDestination,
  collectKagamiSummaryEvidence,
  completeP1PracticeTutorial,
  elementExists,
  enabledMapDestinationIds,
  ensureCaseFileViewport,
  getPackagedGameState,
  jumpToProductionScene,
  lastVisibleDialogueText,
  resetE2eStorage,
  seedStoryCleared,
  startFromMenu,
  waitForButton,
  waitForPackagedGameState,
} from "./helpers";
import {
  anchors,
  DIALOGUE_DRAIN_CAP,
  STORY_CLEARED_STORAGE_KEY,
} from "./production-anchors";
import type { GameStateView, HotspotView } from "$lib/state/types";

/** Explore parked on a mapped wrapper's city map (HPA-601 §7 pending map). */
function isPendingMapGate(state: GameStateView, wrapper: string): boolean {
  return (
    state.mode.type === "explore" &&
    state.scene.kind === "investigation" &&
    state.scene.id === wrapper &&
    state.scene.currentSublocationId === null &&
    state.scene.map !== null
  );
}

/**
 * A gate must advance exactly once: the successor scene is active with its
 * entry queue playing, and the city map is gone (no lingering Explore).
 */
async function expectCrossedToSuccessor(nextSceneId: string): Promise<void> {
  // Gate successors span all three scene kinds (linear, investigation,
  // interrogation); only the id is common, so assert on it alone.
  await waitForPackagedGameState(
    (state) => state.scene.id === nextSceneId,
    30000,
    `city-map gate did not advance into ${nextSceneId}`,
  );
  const state = await getPackagedGameState();
  expect(state.mode.type).toBe("dialogue");
  expect(await elementExists(anchors.cityMapSelector)).toBe(false);
}

/**
 * Spec §11: cross one map gate through the normal route. The wrapper must be
 * parked on its pending map exposing exactly its authored sole destination;
 * the generic map-aware drain then owns the crossing click.
 */
async function crossGate(
  gate: (typeof anchors.mapGates)[number],
  crossedWrappers: string[],
): Promise<void> {
  await waitForPackagedGameState(
    (state) => isPendingMapGate(state, gate.wrapper),
    30000,
    `${gate.wrapper} did not park on its pending city map`,
  );
  expect(await enabledMapDestinationIds()).toEqual([gate.destination]);
  crossedWrappers.push(gate.wrapper);
  await advanceDialogueUntil(
    async () => (await getPackagedGameState()).scene.id === gate.next,
    DIALOGUE_DRAIN_CAP,
  );
  await expectCrossedToSuccessor(gate.next);
}

/**
 * Authored cross-examination routes: the correct contradicting evidence for
 * every required question on the normal Chapter 1 route (content coupling
 * points, like the anchors tables; wrapper IDs stay in anchors.mapGates).
 */
const interrogationChallenges: Record<
  string,
  Array<{ phaseId: string; questionId: string; evidenceId: string }>
> = {
  interrogation_scene_4: [
    {
      phaseId: "ask_miyake",
      questionId: "q_whereabouts",
      evidenceId: "closing_routine",
    },
    {
      phaseId: "ask_miyake",
      questionId: "q_backroom",
      evidenceId: "cctv_screenshot",
    },
  ],
  interrogation_scene_10: [
    { phaseId: "p1", questionId: "q_p1", evidenceId: "closing_routine" },
    {
      phaseId: "p1",
      questionId: "q_p2",
      evidenceId: "victim_phone_notification",
    },
    { phaseId: "p1", questionId: "q_p3", evidenceId: "miyake_pov_replay" },
    {
      phaseId: "gate",
      questionId: "q_request_clip",
      evidenceId: "doorlock_summary_timetable",
    },
    { phaseId: "p4", questionId: "q_p4", evidenceId: "approved_clip" },
    {
      phaseId: "p5",
      questionId: "q_p5",
      evidenceId: "temp_maintenance_workorder",
    },
  ],
};

/**
 * Authored solutions for the Analysis boards on the normal route
 * (analysis_scene_p1_5 is solved by completeP1PracticeTutorial).
 */
type AnalysisSolution =
  | { kind: "classify"; groupByCard: Record<string, string> }
  | { kind: "order"; cardIds: string[] }
  | { kind: "threshold"; cardIds: string[] };

const analysisSolutions: Record<string, Record<string, AnalysisSolution>> = {
  analysis_scene_8_5: {
    evidence_packages: {
      kind: "classify",
      groupByCard: {
        miyake_call: "miyake_small_lies",
        miyake_pov_replay: "earlier_third_party",
        external_credential_event: "earlier_third_party",
      },
    },
    local_event_sequence: {
      kind: "order",
      cardIds: ["event_1841", "event_1842", "event_1843", "event_1844"],
    },
    narrow_request_basis: {
      kind: "threshold",
      cardIds: ["lock_sequence", "phone_notification"],
    },
  },
};

/** Placed hotspots render as placed targets; layout-less ones fall back. */
function hotspotButtonLabel(hotspot: HotspotView): string {
  return `${hotspot.layout === null ? "未放置" : "調查"}：${hotspot.label}`;
}

async function clickSublocationChip(label: string): Promise<void> {
  // Scoped to the nav: a sublocation label can be a substring of a hotspot
  // label (e.g. 質問北見 / 前往質問北見), and clickButton is document-wide.
  const clicked = await browser.execute((chipLabel: string) => {
    const chip = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[aria-label="地點導航"] button',
      ),
    ).find(
      (candidate) =>
        !candidate.disabled &&
        (candidate.textContent ?? "").includes(chipLabel),
    );
    if (!chip) return false;
    chip.click();
    return true;
  }, label);
  if (!clicked) {
    throw new Error(`sublocation chip ${label} was not clickable`);
  }
}

/** One exploration interaction: inspect, interview, or travel. */
async function exploreStep(state: GameStateView): Promise<void> {
  const { scene, mode } = state;
  if (scene.kind !== "investigation" || mode.type !== "explore") {
    throw new Error("explore step invoked outside an exploration");
  }
  if (scene.map !== null && scene.currentSublocationId === null) {
    throw new Error(
      "organic drain reached a pending city map without its gate stop",
    );
  }
  const current = scene.visibleSublocations.find(
    (candidate) => candidate.id === scene.currentSublocationId,
  );
  if (!current) {
    throw new Error(
      `sublocation ${String(scene.currentSublocationId)} is not visible`,
    );
  }

  const hotspot = current.hotspots.find((candidate) => !candidate.inspected);
  if (hotspot) {
    await clickButton(hotspotButtonLabel(hotspot));
    return;
  }
  const character = current.characters.find((candidate) =>
    candidate.topics.some((topic) => !topic.discussed),
  );
  if (character) {
    const topic = character.topics.find((candidate) => !candidate.discussed);
    if (!topic) throw new Error("unreachable topic state");
    // Placed witnesses open a topic popover; layout-less witnesses render
    // their topic buttons directly in the 未放置證人 fallback list.
    if (character.layout !== null) {
      await clickButton(`詢問：${character.name}`);
    }
    await clickButton(topic.label);
    return;
  }
  // Current sublocation exhausted — travel to the next one with content.
  const next = scene.visibleSublocations.find((candidate) => {
    if (candidate.id === scene.currentSublocationId) return false;
    return (
      candidate.hotspots.some((h) => !h.inspected) ||
      candidate.characters.some((c) => c.topics.some((t) => !t.discussed))
    );
  });
  if (next) {
    await clickSublocationChip(next.label);
    return;
  }
  throw new Error(
    `${scene.id} has no pending exploration content but the route did not advance`,
  );
}

async function presentChallengeEvidence(
  state: GameStateView,
  questionId: string,
): Promise<void> {
  const challenge = (interrogationChallenges[state.scene.id] ?? []).find(
    (entry) => entry.questionId === questionId,
  );
  if (!challenge) {
    throw new Error(`no authored route for cross-exam ${questionId}`);
  }
  const evidence = state.inventory.evidence.find(
    (candidate) => candidate.id === challenge.evidenceId,
  );
  if (!evidence) {
    throw new Error(
      `evidence ${challenge.evidenceId} is not in the inventory for ${questionId}`,
    );
  }
  const presented = await browser.execute((recordName: string) => {
    const tile = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button.record-tile"),
    ).find(
      (candidate) =>
        !candidate.disabled &&
        (candidate.textContent ?? "").includes(recordName),
    );
    if (!tile) return false;
    tile.click();
    return true;
  }, evidence.name);
  if (!presented) {
    throw new Error(`record tile ${evidence.name} was not clickable`);
  }
}

/** One interrogation interaction: challenge, present, or complete. */
async function interrogationStep(state: GameStateView): Promise<void> {
  const { scene, mode } = state;
  if (scene.kind !== "interrogation" || mode.type !== "interrogation") {
    throw new Error("interrogation step invoked outside an interrogation");
  }
  const phase = scene.visiblePhases.find(
    (candidate) => candidate.id === mode.phaseId,
  );
  if (!phase) {
    throw new Error(`phase ${mode.phaseId} is not visible`);
  }
  if (phase.crossExam?.presenting) {
    await presentChallengeEvidence(state, phase.crossExam.questionId);
    return;
  }
  const pending = (interrogationChallenges[scene.id] ?? []).find(
    (challenge) => {
      if (challenge.phaseId !== phase.id) return false;
      const question = phase.questions.find(
        (candidate) => candidate.id === challenge.questionId,
      );
      return question !== undefined && !question.broken;
    },
  );
  if (pending) {
    const question = phase.questions.find(
      (candidate) => candidate.id === pending.questionId,
    );
    if (!question) {
      throw new Error(
        `question ${pending.questionId} is not visible in ${phase.id}`,
      );
    }
    await clickButton(question.label);
    return;
  }
  if (phase.canComplete) {
    await clickButton("完成訊問");
    return;
  }
  throw new Error(
    `${scene.id}/${phase.id} has no pending authored challenge and cannot complete`,
  );
}

// B4 selected this one synthetic PointerEvent transport for packaged WebKit
// (shared with analysis-beat85): board placement listens to pointer events,
// not clicks, and resolves the destination via elementsFromPoint.
async function dragAnalysisCard(
  cardId: string,
  targetId: string,
): Promise<void> {
  const result = await browser.execute(
    (
      selectedCardId: string,
      selectedTargetId: string,
    ): {
      dispatched: boolean;
      cardFound: boolean;
      targetFound: boolean;
      cardDisabled: boolean;
      moveHit: string | null;
      upHit: string | null;
      targetStack: string[];
    } => {
      const card = document.querySelector<HTMLElement>(
        `[data-analysis-card-id="${selectedCardId}"]`,
      );
      const target = document.querySelector<HTMLElement>(
        `[data-analysis-drop-target="${selectedTargetId}"]`,
      );
      if (!card || !target) {
        return {
          dispatched: false,
          cardFound: card !== null,
          targetFound: target !== null,
          cardDisabled: false,
          moveHit: null,
          upHit: null,
          targetStack: [],
        };
      }

      // Keep the synthetic destination inside the viewport so the production
      // elementsFromPoint() resolver sees the same target on every board.
      target.scrollIntoView({ block: "center", inline: "center" });

      const center = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      };
      const source = center(card);
      const destination = center(target);
      const pointerId = 621;
      const dispatch = (type: string, init: PointerEventInit) =>
        card.dispatchEvent(new PointerEvent(type, init));

      dispatch("pointerdown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: source.x,
        clientY: source.y,
      });
      dispatch("pointermove", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: -1,
        buttons: 1,
        clientX: destination.x,
        clientY: destination.y,
      });
      const moveHit =
        document
          .elementsFromPoint?.(destination.x, destination.y)
          ?.map((element) => element.closest("[data-analysis-drop-target]"))
          .find(Boolean)?.textContent ?? null;
      dispatch("pointerup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: destination.x,
        clientY: destination.y,
      });
      const stack = document
        .elementsFromPoint?.(destination.x, destination.y)
        ?.slice(0, 4)
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}${
              element.className && typeof element.className === "string"
                ? `.${element.className.split(" ").join(".")}`
                : ""
            }`,
        );
      return {
        dispatched: true,
        cardFound: true,
        targetFound: true,
        cardDisabled: card instanceof HTMLButtonElement ? card.disabled : false,
        moveHit: (moveHit ?? "").trim().slice(0, 60) || null,
        upHit:
          document
            .elementsFromPoint?.(destination.x, destination.y)
            ?.map((element) => element.closest("[data-analysis-drop-target]"))
            .find(Boolean)
            ?.getAttribute("data-analysis-drop-target") ?? null,
        targetStack: stack ?? [],
      };
    },
    cardId,
    targetId,
  );
  if (!result.dispatched || !result.cardFound || !result.targetFound) {
    throw new Error(
      `analysis drag hooks missing for ${cardId} -> ${targetId}: ${JSON.stringify(result)}`,
    );
  }
  if (result.upHit !== targetId) {
    throw new Error(
      `analysis drag for ${cardId} -> ${targetId} did not resolve the drop target: ${JSON.stringify(result)}`,
    );
  }
}

/**
 * Semantic draft match: classify/threshold records serialize from the engine
 * in arbitrary key/click order, so compare entry-wise; order boards compare
 * exactly.
 */
function analysisDraftIs(
  state: GameStateView,
  boardId: string,
  expected: AnalysisSolution,
): boolean {
  if (state.scene.kind !== "analysis") return false;
  const draft = state.scene.visibleBoards.find(
    (candidate) => candidate.id === boardId,
  )?.draft;
  if (draft === undefined || draft.kind !== expected.kind) return false;
  if (draft.kind === "classify" && expected.kind === "classify") {
    const expectedEntries = Object.entries(expected.groupByCard);
    return (
      Object.keys(draft.groupByCard).length === expectedEntries.length &&
      expectedEntries.every(
        ([cardId, groupId]) => draft.groupByCard[cardId] === groupId,
      )
    );
  }
  if (draft.kind === "order" && expected.kind === "order") {
    return JSON.stringify(draft.cardIds) === JSON.stringify(expected.cardIds);
  }
  if (draft.kind === "threshold" && expected.kind === "threshold") {
    return (
      draft.selectedCardIds.length === expected.cardIds.length &&
      expected.cardIds.every((cardId) => draft.selectedCardIds.includes(cardId))
    );
  }
  return false;
}

/** One analysis interaction: place the next pending card, or submit. */
async function analysisStep(state: GameStateView): Promise<void> {
  const { scene, mode } = state;
  if (scene.kind !== "analysis" || mode.type !== "analysis") {
    throw new Error("analysis step invoked outside an analysis scene");
  }
  const board = scene.visibleBoards.find(
    (candidate) => candidate.id === mode.boardId,
  );
  if (!board) {
    throw new Error(`analysis board ${mode.boardId} is not visible`);
  }
  const solution = analysisSolutions[scene.id]?.[board.id];
  if (!solution) {
    throw new Error(`no authored solution for ${scene.id}/${board.id}`);
  }

  if (solution.kind === "classify") {
    if (board.kind !== "classify" || board.draft.kind !== "classify") {
      throw new Error(`${board.id} is not an editable classify board`);
    }
    for (const [cardId, groupId] of Object.entries(solution.groupByCard)) {
      if (board.draft.groupByCard[cardId] === groupId) continue;
      await dragAnalysisCard(cardId, `classify:group:${groupId}`);
      await waitForPackagedGameState(
        (next) => {
          if (next.scene.kind !== "analysis") return false;
          const draft = next.scene.visibleBoards.find(
            (candidate) => candidate.id === board.id,
          )?.draft;
          return (
            draft?.kind === "classify" && draft.groupByCard[cardId] === groupId
          );
        },
        30000,
        `classify card ${cardId} did not land in ${groupId}`,
      );
    }
  } else if (solution.kind === "order") {
    if (board.kind !== "order" || board.draft.kind !== "order") {
      throw new Error(`${board.id} is not an editable order board`);
    }
    const fixed = new Set(board.fixedAnchors.map((anchor) => anchor.cardId));
    const movable = solution.cardIds.filter((cardId) => !fixed.has(cardId));
    const expectedPrefix = solution.cardIds.filter((cardId) =>
      fixed.has(cardId),
    );
    for (const cardId of movable) {
      await dragAnalysisCard(cardId, "order:end");
      expectedPrefix.push(cardId);
      await waitForPackagedGameState(
        (next) =>
          analysisDraftIs(next, board.id, {
            kind: "order",
            cardIds: [...expectedPrefix],
          }),
        30000,
        `order draft did not become ${JSON.stringify(expectedPrefix)}`,
      );
    }
  } else {
    if (board.kind !== "threshold" || board.draft.kind !== "threshold") {
      throw new Error(`${board.id} is not an editable threshold board`);
    }
    for (const cardId of solution.cardIds) {
      if (board.draft.selectedCardIds.includes(cardId)) continue;
      const card = board.cards.find((candidate) => candidate.id === cardId);
      if (!card) throw new Error(`threshold card ${cardId} is missing`);
      await clickButton(card.label);
      await waitForPackagedGameState(
        (next) => {
          if (next.scene.kind !== "analysis") return false;
          const draft = next.scene.visibleBoards.find(
            (candidate) => candidate.id === board.id,
          )?.draft;
          return (
            draft?.kind === "threshold" &&
            draft.selectedCardIds.includes(cardId)
          );
        },
        30000,
        `threshold card ${cardId} was not selected`,
      );
    }
  }

  // Submit only against the fully verified draft: a partial submission would
  // bounce off with incorrect feedback instead of advancing.
  await waitForPackagedGameState(
    (next) => analysisDraftIs(next, board.id, solution),
    30000,
    `${board.id} draft never matched its authored solution`,
  );
  await clickButton("比對推論");
}

/**
 * Drain the normal route with one authored interaction per step until `stop`.
 * The dialogue path reuses the battle-tested map-aware drain; explore,
 * interrogation, and analysis scenes dispatch on their authored controls.
 */
const ORGANIC_ROUTE_CAP = 400;

async function drainOrganicRoute(
  stop: (state: GameStateView) => boolean,
  stopLabel: string,
): Promise<void> {
  for (let step = 0; step < ORGANIC_ROUTE_CAP; step += 1) {
    const state = await getPackagedGameState();
    if (stop(state)) return;
    if (state.pendingAcquisition) {
      // Evidence popups overlay the scene; plain and JS clicks punch through,
      // but pointer-simulated drops (analysis boards) hit-test through the
      // overlay, so each card must be acknowledged before other interactions.
      await acknowledgeAcquisitionDomFirst(state.pendingAcquisition);
      continue;
    }
    switch (state.mode.type) {
      case "dialogue":
        if (state.mode.crossExamLineId !== null) {
          // Unbroken testimony is on stage: the inline 反駁 control is the
          // only way forward; plain advancing would loop the testimony.
          await waitForButton("反駁", 90000);
          await clickButton("反駁");
          break;
        }
        await advanceDialogueUntil(async () => {
          const next = await getPackagedGameState();
          return (
            next.mode.type !== "dialogue" ||
            next.mode.crossExamLineId !== null ||
            stop(next)
          );
        }, 120);
        break;
      case "explore":
        await exploreStep(state);
        break;
      case "interrogation":
        await interrogationStep(state);
        break;
      case "analysis":
        await analysisStep(state);
        break;
      case "gameComplete":
        throw new Error(
          `organic route reached chapter completion before ${stopLabel}`,
        );
    }
  }
  throw new Error(
    `organic route exceeded ${ORGANIC_ROUTE_CAP} steps waiting for ${stopLabel}`,
  );
}

describe("fresh production journey", () => {
  it("plays the organic Chapter 1 route from the menu across all nine city-map gates to chapter completion", async function () {
    this.timeout(2_400_000);
    await resetE2eStorage();
    // The 800×600 packaged default window squeezes the analysis workbench;
    // the synthetic pointer transport (like analysis-beat85) is proven at a
    // ≥1280×720 CSS viewport where drop targets resolve under elementsFromPoint.
    await ensureCaseFileViewport();
    expect(await elementExists(`[aria-label="${anchors.mainMenu}"]`)).toBe(
      true,
    );

    await startFromMenu();
    expect(await lastVisibleDialogueText()).not.toBe("");

    const hotspot = `button[aria-label="${anchors.hotspotEvidence.label}"]`;
    await completeP1PracticeTutorial();
    await advanceDialogueUntil(
      () => elementExists(hotspot),
      DIALOGUE_DRAIN_CAP,
    );
    await waitForButton(anchors.hotspotEvidence.label, 90000);
    await collectKagamiSummaryEvidence();

    expect(await elementExists(hotspot)).toBe(true);
    expect(
      await browser.execute(
        (selector: string) =>
          document.querySelector(selector)?.classList.contains("inspected"),
        hotspot,
      ),
    ).toBe(true);

    // Finish investigation_scene_1's remaining plain hotspots, then discuss
    // the commission topic. The authored outro unlock is "kagami_summary
    // collected + commission discussed", and the evidence is already in the
    // inventory, so the interview exhausts into the scene outro, scene_2, and
    // the first map wrapper's pending map in one automatic chain.
    for (const label of anchors.firstInvestigationHotspots) {
      await waitForButton(label, 90000);
      await clickButton(label);
      // Drain until the hotspot itself reports inspected: at click time the
      // explore surface is still mounted, so character-button presence is not
      // a race-free transition signal.
      await advanceDialogueUntil(
        () =>
          browser.execute((name: string) => {
            const button = Array.from(
              document.querySelectorAll<HTMLButtonElement>("button"),
            ).find(
              (candidate) => candidate.getAttribute("aria-label") === name,
            );
            return (
              button?.classList.contains("inspected") === true ||
              button?.classList.contains("done") === true
            );
          }, label),
        40,
      );
    }
    await waitForButton(anchors.character.label, 90000);
    await clickButton(anchors.character.label);
    await clickButton(anchors.firstTopic);
    // The outro chains automatically; the city map renders once the pending
    // map parks. Predicate-first ordering keeps the drain from clicking the
    // destination pin — crossGate owns that step.
    await advanceDialogueUntil(
      () => elementExists(anchors.cityMapSelector),
      DIALOGUE_DRAIN_CAP,
    );

    // The organic Chapter 1 route crosses every gate in authored order.
    const crossedWrappers: string[] = [];
    await crossGate(anchors.mapGates[0], crossedWrappers);
    for (const gate of anchors.mapGates.slice(1)) {
      await drainOrganicRoute(
        (state) => isPendingMapGate(state, gate.wrapper),
        `${gate.wrapper} pending city map`,
      );
      await crossGate(gate, crossedWrappers);
    }

    // Past the final gate (scene_11_2), the route drains into chapter end.
    await drainOrganicRoute(
      (state) => state.mode.type === "gameComplete",
      "chapter completion",
    );
    expect(await elementExists(".complete")).toBe(true);
    const cleared = await browser.execute(
      (key: string) => window.localStorage.getItem(key),
      STORY_CLEARED_STORAGE_KEY,
    );
    expect(cleared).toBe("true");

    // All nine gates, in order, no extras (spec §11 Draft-exit evidence).
    expect(crossedWrappers).toEqual(
      anchors.mapGates.map((gate) => gate.wrapper),
    );
  });

  it("keeps the drain deterministic when several destinations are enabled", async () => {
    // Guard the pure seam directly: the DOM drain must fail rather than guess.
    // clickSoleMapDestination only reads enabled pins, so a synthetic two-pin
    // DOM proves the deterministic error surfaces through the drain path.
    await resetE2eStorage();
    await seedStoryCleared();
    await startFromMenu();
    await jumpToProductionScene(anchors.firstMapWrapper);
    await waitForPackagedGameState(
      (state) => isPendingMapGate(state, anchors.firstMapWrapper),
      30000,
      "first map wrapper did not park on the pending city map",
    );
    await browser.execute((sectionSelector: string) => {
      const section = document.querySelector(sectionSelector);
      const original = section?.querySelector<HTMLButtonElement>(
        "[data-map-destination]",
      );
      if (!original) throw new Error("map destination pin is missing");
      const clone = original.cloneNode(true) as HTMLButtonElement;
      clone.setAttribute("data-map-destination", "e2e_second_pin");
      section?.querySelector(".map-plane")?.appendChild(clone);
    }, anchors.cityMapSelector);
    await expect(clickSoleMapDestination()).rejects.toThrow(
      /expected at most one enabled map destination.*e2e_second_pin/s,
    );
  });
});
