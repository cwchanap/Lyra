import path from "node:path";
import {
  advanceDialogueUntil,
  captureMockupViewport,
  clickButton,
  closePersistenceBrowserToGameplay,
  continueFromTitle,
  ensureCaseFileViewport,
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
const MOCKUP_CAPTURE_OUTPUT_DIRECTORY =
  process.env.LYRA_E2E_OUTPUT_DIR || path.join(process.cwd(), "logs");
const MOCKUP_VIEWPORT = { width: 1280, height: 720 } as const;
const INTERROGATION_STAGE_CONTROLS =
  "[data-interrogation-stage-log], [data-interrogation-case-file-objective], [data-interrogation-evidence-locker]";

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type AnalysisShellGeometry = {
  workbench: Rect;
  rail: Rect;
  workspace: Rect;
  workspaceContentCenter: number;
  frame: Rect;
  footer: Rect;
};

type AnalysisClassifyGeometry = AnalysisShellGeometry & {
  pool: Rect;
  groups: Rect;
};

type AnalysisOrderGeometry = AnalysisShellGeometry & {
  timeline: Rect;
  pending: Rect;
};

const geometry: {
  menu?: { stage: Rect; main: Rect; art: Rect; record: Rect };
  testimony?: {
    stage: Rect;
    main: Rect;
    art: Rect;
    frame: Rect;
    box: Rect;
    challenge: Rect;
  };
  present?: { stage: Rect; tray: Rect };
  analysisClassify?: AnalysisClassifyGeometry;
  analysisOrder?: AnalysisOrderGeometry;
} = {};

async function elementRect(selector: string): Promise<Rect | null> {
  return browser.execute((targetSelector: string) => {
    const element = document.querySelector<HTMLElement>(targetSelector);
    if (!element) return null;
    const { left, top, right, bottom, width, height } =
      element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  }, selector);
}

async function snapshotMenuGeometry(): Promise<void> {
  const [stage, main, art, record] = await Promise.all([
    elementRect(".interrogation-stage.active"),
    elementRect('main[data-save-thumbnail-layout="main"]'),
    elementRect("[data-interrogation-subject-art]"),
    elementRect("[data-interrogation-question-record]"),
  ]);
  if (stage && main && art && record) {
    geometry.menu = { stage, main, art, record };
  }
}

async function snapshotTestimonyGeometry(): Promise<void> {
  const [stage, main, art, frame, box, challenge] = await Promise.all([
    elementRect(".interrogation-stage.active"),
    elementRect('main[data-save-thumbnail-layout="main"]'),
    elementRect("[data-interrogation-subject-art]"),
    elementRect(".wrapper.interrogation-stage-dialogue"),
    elementRect("[data-interrogation-dialogue-frame]"),
    elementRect("button.xexam-challenge"),
  ]);
  if (stage && main && art && frame && box && challenge) {
    geometry.testimony = { stage, main, art, frame, box, challenge };
  }
}

async function refreshTestimonyArtGeometry(): Promise<void> {
  const art = await elementRect("[data-interrogation-subject-art]");
  if (art && geometry.testimony) geometry.testimony.art = art;
}

async function snapshotPresentGeometry(): Promise<void> {
  const [stage, tray] = await Promise.all([
    elementRect(".interrogation-stage.active"),
    elementRect("[data-interrogation-present-tray]"),
  ]);
  if (stage && tray) geometry.present = { stage, tray };
}

async function elementContentCenter(selector: string): Promise<number | null> {
  return browser.execute((targetSelector: string) => {
    const element = document.querySelector<HTMLElement>(targetSelector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return rect.left + element.clientLeft + element.clientWidth / 2;
  }, selector);
}

async function snapshotAnalysisClassifyGeometry(): Promise<void> {
  const [
    workbench,
    rail,
    workspace,
    workspaceContentCenter,
    frame,
    pool,
    groups,
    footer,
  ] = await Promise.all([
    elementRect(".analysis-workbench"),
    elementRect("[data-analysis-rail]"),
    elementRect("[data-analysis-workspace]"),
    elementContentCenter("[data-analysis-workspace]"),
    elementRect("[data-analysis-content-frame]"),
    elementRect(".classify-board .card-pool"),
    elementRect(".classify-board .groups"),
    elementRect(".workbench-footer"),
  ]);
  if (
    workbench &&
    rail &&
    workspace &&
    workspaceContentCenter !== null &&
    frame &&
    pool &&
    groups &&
    footer
  ) {
    geometry.analysisClassify = {
      workbench,
      rail,
      workspace,
      workspaceContentCenter,
      frame,
      pool,
      groups,
      footer,
    };
  }
}

async function snapshotAnalysisOrderGeometry(): Promise<void> {
  const [
    workbench,
    rail,
    workspace,
    workspaceContentCenter,
    frame,
    timeline,
    pending,
    footer,
  ] = await Promise.all([
    elementRect(".analysis-workbench"),
    elementRect("[data-analysis-rail]"),
    elementRect("[data-analysis-workspace]"),
    elementContentCenter("[data-analysis-workspace]"),
    elementRect("[data-analysis-content-frame]"),
    elementRect(".order-board .timeline-panel"),
    elementRect(".order-board .card-pool"),
    elementRect(".workbench-footer"),
  ]);
  if (
    workbench &&
    rail &&
    workspace &&
    workspaceContentCenter !== null &&
    frame &&
    timeline &&
    pending &&
    footer
  ) {
    geometry.analysisOrder = {
      workbench,
      rail,
      workspace,
      workspaceContentCenter,
      frame,
      timeline,
      pending,
      footer,
    };
  }
}

async function assertInterrogationBrokenProgress(): Promise<void> {
  const meter = await $("[data-interrogation-broken-progress]");
  expect(await meter.getAttribute("role")).toBe("progressbar");
  const [minimum, current, maximum] = await Promise.all([
    meter.getAttribute("aria-valuemin"),
    meter.getAttribute("aria-valuenow"),
    meter.getAttribute("aria-valuemax"),
  ]);
  expect(minimum).not.toBeNull();
  expect(minimum?.trim()).not.toBe("");
  expect(current).not.toBeNull();
  expect(current?.trim()).not.toBe("");
  expect(maximum).not.toBeNull();
  expect(maximum?.trim()).not.toBe("");
  if (
    minimum === null ||
    minimum.trim() === "" ||
    current === null ||
    current.trim() === "" ||
    maximum === null ||
    maximum.trim() === ""
  ) {
    throw new Error("Interrogation progress ARIA values are missing.");
  }
  const minValue = Number(minimum);
  const currentValue = Number(current);
  const maxValue = Number(maximum);
  expect(Number.isFinite(minValue)).toBe(true);
  expect(Number.isFinite(currentValue)).toBe(true);
  expect(Number.isFinite(maxValue)).toBe(true);
  expect(minValue).toBe(0);
  expect(maxValue).toBeGreaterThan(0);
  expect(currentValue).toBeGreaterThanOrEqual(minValue);
  expect(currentValue).toBeLessThanOrEqual(maxValue);
  expect(currentValue / maxValue).toBeGreaterThanOrEqual(0);
  expect(currentValue / maxValue).toBeLessThanOrEqual(1);
}

async function assertInterrogationMenuSemantics(): Promise<void> {
  const controls = await $$(INTERROGATION_STAGE_CONTROLS);
  expect(controls).toHaveLength(3);
  const labels = (await controls.map((control) => control.getText())).map(
    (label) => label.trim(),
  );
  expect(new Set(labels).size).toBe(3);
  expect(labels).toContain("LOG");
  expect(labels).toContain("案件檔案");
  expect(labels.some((label) => /^證物櫃 \d{2}$/.test(label))).toBe(true);
  await assertInterrogationBrokenProgress();
}

async function assertInterrogationTestimonySemantics(): Promise<void> {
  expect(await $$(INTERROGATION_STAGE_CONTROLS)).toHaveLength(0);
  const dialogueLogs = await $$('button[aria-label="開啟對話紀錄"]');
  expect(dialogueLogs).toHaveLength(1);
  const dialogueLog = dialogueLogs[0];
  if (!dialogueLog) throw new Error("DialogueBox LOG button is missing");
  expect(await dialogueLog.isDisplayed()).toBe(true);
  await assertInterrogationBrokenProgress();
}

async function assertInterrogationPresentSemantics(): Promise<void> {
  expect(await $$(INTERROGATION_STAGE_CONTROLS)).toHaveLength(0);
  const gridColumns = await browser.execute(() => {
    const grid = document.querySelector<HTMLElement>(
      "[data-interrogation-evidence-grid]",
    );
    if (!grid) return 0;
    return getComputedStyle(grid)
      .gridTemplateColumns.split(/ (?![^()]*\))/)
      .filter(Boolean).length;
  });
  expect(gridColumns).toBe(5);

  const escapeButtons = await $$("[data-interrogation-tray-escape]");
  expect(escapeButtons).toHaveLength(1);
  const escapeButton = escapeButtons[0];
  if (!escapeButton) throw new Error("Present ESC button is missing");
  expect(await escapeButton.isDisplayed()).toBe(true);

  const detailPanels = await $$("[data-interrogation-evidence-detail]");
  expect(detailPanels).toHaveLength(1);
  expect(
    await browser.execute(() => {
      const grid = document.querySelector("[data-interrogation-evidence-grid]");
      const detail = document.querySelector(
        "[data-interrogation-evidence-detail]",
      );
      return grid !== null && detail !== null && !grid.contains(detail);
    }),
  ).toBe(true);
}

async function assertAnalysisClassifySemantics(): Promise<void> {
  const ordinalChips = await $$("[data-analysis-board-position]");
  expect(ordinalChips).toHaveLength(1);
  const ordinalChip = ordinalChips[0];
  if (!ordinalChip) throw new Error("Analysis board ordinal chip is missing");
  expect(await ordinalChip.getText()).toMatch(/^Board \d+ \/ \d+$/);

  const heading = await $('[data-analysis-focus-key^="board:"]');
  expect(
    await browser.execute(() => {
      const candidate = document.querySelector<HTMLElement>(
        '[data-analysis-focus-key^="board:"]',
      );
      return candidate === null ? null : getComputedStyle(candidate).fontSize;
    }),
  ).toBe("22px");
  expect(await heading.getTagName()).toBe("h2");

  expect(
    await browser.execute(() => {
      const hint = document.querySelector('[data-analysis-focus-key="hint"]');
      return hint?.closest(".workbench-footer") !== null;
    }),
  ).toBe(true);
  expect(
    await $$(
      "[data-analysis-rail] .board-entry-kind, [data-analysis-rail] .board-entry-progress, [data-analysis-rail] .progress-row",
    ),
  ).toHaveLength(0);
  expect(
    (await $$("[data-analysis-rail] [data-analysis-board-id]")).length,
  ).toBeGreaterThan(0);
}

function edgeCenter(rect: Rect): number {
  return (rect.left + rect.right) / 2;
}

function expectEdgesAligned(left: Rect, right: Rect): void {
  for (const edge of ["left", "top", "right", "bottom"] as const) {
    expect(Math.abs(left[edge] - right[edge])).toBeLessThanOrEqual(2);
  }
}

function expectInside(inner: Rect, outer: Rect): void {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left - 1);
  expect(inner.top).toBeGreaterThanOrEqual(outer.top - 1);
  expect(inner.right).toBeLessThanOrEqual(outer.right + 1);
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 1);
}

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

// B4 selected this one synthetic PointerEvent transport for packaged WebKit.
// Keep Classify and Order on this path; there is intentionally no W3C attempt
// or runtime/test fallback.
async function dragAnalysisCardSynthetic(
  cardId: string,
  targetId: string,
): Promise<void> {
  let dispatched: boolean;
  try {
    dispatched = await browser.execute(
      (selectedCardId: string, selectedTargetId: string) => {
        const card = document.querySelector<HTMLElement>(
          `[data-analysis-card-id="${selectedCardId}"]`,
        );
        const target = document.querySelector<HTMLElement>(
          `[data-analysis-drop-target="${selectedTargetId}"]`,
        );
        if (!card || !target) return false;

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
        return true;
      },
      cardId,
      targetId,
    );
  } catch (error) {
    throw new Error(
      `analysis drag dispatch failed for ${cardId} -> ${targetId}`,
      { cause: error },
    );
  }
  if (!dispatched) {
    throw new Error(`analysis drag hooks missing for ${cardId} -> ${targetId}`);
  }
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

async function waitForClassifyDraft(
  expectedGroupByCard: Record<string, string>,
): Promise<GameStateView> {
  try {
    return await waitForPackagedGameState((state) => {
      const board = analysisBoard(state, "evidence_packages");
      if (board.kind !== "classify" || board.draft.kind !== "classify") {
        return false;
      }
      const actual = board.draft.groupByCard;
      return (
        Object.keys(actual).length ===
          Object.keys(expectedGroupByCard).length &&
        Object.entries(expectedGroupByCard).every(
          ([cardId, groupId]) => actual[cardId] === groupId,
        )
      );
    });
  } catch (error) {
    throw new Error(
      `classify draft never matched ${JSON.stringify(expectedGroupByCard)}`,
      { cause: error },
    );
  }
}

async function waitForOrderDraft(
  expectedCardIds: string[],
): Promise<GameStateView> {
  try {
    return await waitForPackagedGameState((state) => {
      const board = analysisBoard(state, "local_event_sequence");
      return (
        board.kind === "order" &&
        board.draft.kind === "order" &&
        JSON.stringify(board.draft.cardIds) === JSON.stringify(expectedCardIds)
      );
    });
  } catch (error) {
    throw new Error(
      `order draft never matched [${expectedCardIds.join(", ")}]`,
      { cause: error },
    );
  }
}

async function submitCurrentAnalysisBoard(
  boardId: string,
): Promise<GameStateView> {
  try {
    await clickButton("比對推論");
  } catch (error) {
    throw new Error(`analysis board ${boardId} submit click failed`, {
      cause: error,
    });
  }
  // Wait for a genuinely post-submit state. Accepting the pre-submit analysis
  // mode (board still open, not completed) would resolve immediately while
  // the submit IPC is still in flight. Resolve only once the submitted board
  // is marked completed or the engine has moved on to dialogue.
  return waitForPackagedGameState(
    (state) => {
      if (state.mode.type === "dialogue") return true;
      if (
        state.mode.type === "analysis" &&
        state.scene.kind === "analysis" &&
        state.scene.id === ANALYSIS_SCENE_ID &&
        state.mode.boardId === boardId
      ) {
        return analysisBoard(state, boardId).completed;
      }
      return false;
    },
    30000,
    `analysis board ${boardId} submission did not settle`,
  );
}

function expectDialogueLine(
  state: GameStateView,
  speaker: string,
  text: string,
): void {
  if (state.mode.type !== "dialogue") {
    throw new Error(`expected dialogue line from ${speaker}`);
  }
  expect(state.mode.current.kind).toBe("line");
  if (state.mode.current.kind !== "line") return;
  expect(state.mode.current.speaker).toBe(speaker);
  expect(state.mode.current.text).toBe(text);
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
  if (phaseId === "p1") {
    await snapshotTestimonyGeometry();
    await assertInterrogationTestimonySemantics();
    await captureMockupViewport({
      name: "interrogation-testimony-rebut",
      requested: MOCKUP_VIEWPORT,
      outputDirectory: MOCKUP_CAPTURE_OUTPUT_DIRECTORY,
    });
  } else if (phaseId === "p2") {
    await assertInterrogationTestimonySemantics();
    await captureMockupViewport({
      name: "interrogation-testimony-tall",
      requested: { width: 1280, height: 800 },
      outputDirectory: MOCKUP_CAPTURE_OUTPUT_DIRECTORY,
    });
  }
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
  if (phaseId === "p1") {
    await snapshotPresentGeometry();
    await assertInterrogationPresentSemantics();
    await captureMockupViewport({
      name: "interrogation-present",
      requested: MOCKUP_VIEWPORT,
      outputDirectory: MOCKUP_CAPTURE_OUTPUT_DIRECTORY,
    });
  }
  const evidence = presenting.inventory.evidence.find(
    (candidate) => candidate.id === evidenceId,
  );
  if (!evidence)
    throw new Error(`${phaseId} evidence ${evidenceId} was not seeded`);
  await clickButton(evidence.name);
  if (phaseId === "p1") {
    // The correct response changes the current speaker/expression. This is a
    // nullable observation only; the functional journey must continue even if
    // the art hook is temporarily absent during the crossfade.
    await browser.pause(100);
    await refreshTestimonyArtGeometry();
  }

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
  before(async () => {
    // This helper guarantees a CSS viewport of at least 1280×720, not exact
    // innerWidth/innerHeight values; geometry assertions stay relative.
    await ensureCaseFileViewport();
  });

  it("persists partial Analysis drafts, proves pointer ordering, and reaches p4", async function () {
    this.timeout(1_800_000);
    await resetE2eStorage();
    await loadPackagedCheckpoint("chapter-1-analysis-beat-85-ready");

    let state = await waitForAnalysisBoard("evidence_packages");
    await snapshotAnalysisClassifyGeometry();
    await assertAnalysisClassifySemantics();
    await captureMockupViewport({
      name: "analysis-classify",
      requested: MOCKUP_VIEWPORT,
      outputDirectory: MOCKUP_CAPTURE_OUTPUT_DIRECTORY,
    });
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
    const expectedClassify: Record<string, string> = {};
    const placeClassifyCard = async (cardId: string, groupId: string) => {
      if (!groups.has(groupId))
        throw new Error(`missing classify group ${groupId}`);
      await dragAnalysisCardSynthetic(cardId, `classify:group:${groupId}`);
      expectedClassify[cardId] = groupId;
      await waitForClassifyDraft(expectedClassify);
    };

    const classifyCard = (cardId: string) => {
      const card = classify.cards.find((candidate) => candidate.id === cardId);
      if (!card) throw new Error(`missing classify card ${cardId}`);
      return card;
    };

    // Exercise assign, group-to-group, drag-back to unassigned, and reassign
    // before saving only this partial authoritative draft.
    classifyCard("miyake_call");
    await placeClassifyCard("miyake_call", "miyake_small_lies");
    classifyCard("miyake_pov_replay");
    await placeClassifyCard("miyake_pov_replay", "earlier_third_party");
    await dragAnalysisCardSynthetic(
      "miyake_pov_replay",
      "classify:group:lock_chronology",
    );
    expectedClassify.miyake_pov_replay = "lock_chronology";
    await waitForClassifyDraft(expectedClassify);
    await dragAnalysisCardSynthetic("miyake_pov_replay", "classify:unassigned");
    delete expectedClassify.miyake_pov_replay;
    await waitForClassifyDraft(expectedClassify);
    await placeClassifyCard("miyake_pov_replay", "earlier_third_party");

    await saveManualSlot(1, "Beat 8.5 分類部分草稿");
    await closePersistenceBrowserToGameplay();
    await returnToTitle();
    await continueFromTitle();
    state = await waitForAnalysisBoard("evidence_packages");
    const restoredClassify = analysisBoard(state, "evidence_packages");
    if (
      restoredClassify.kind !== "classify" ||
      restoredClassify.draft.kind !== "classify"
    ) {
      throw new Error("Continue did not restore the Classify draft");
    }
    expect(restoredClassify.draft.groupByCard).toEqual(expectedClassify);

    const restoredClassifyCards = restoredClassify.cards;
    for (const card of restoredClassifyCards) {
      const groupId = cardGroupIds[card.id];
      if (!groupId) throw new Error(`missing classify mapping for ${card.id}`);
      if (expectedClassify[card.id] === groupId) continue;
      await placeClassifyCard(card.id, groupId);
    }
    expect(expectedClassify).toEqual(cardGroupIds);
    await waitForClassifyDraft(cardGroupIds);
    const classifyResult =
      await submitCurrentAnalysisBoard("evidence_packages");
    expectDialogueLine(
      classifyResult,
      "相馬律",
      "我急著找兇手時，也差點把三宅的小謊塞進同一欄。",
    );
    const completedClassify = analysisBoard(
      classifyResult,
      "evidence_packages",
    );
    expect(completedClassify.completed).toBe(true);
    if (completedClassify.draft.kind !== "classify") {
      throw new Error("completed Classify draft is not classify");
    }
    expect(completedClassify.draft.groupByCard).toEqual(cardGroupIds);
    await drainToAnalysisBoard("local_event_sequence");

    state = await waitForAnalysisBoard("local_event_sequence");
    await snapshotAnalysisOrderGeometry();
    const order = analysisBoard(state, "local_event_sequence");
    if (order.kind !== "order")
      throw new Error("local_event_sequence is not order");
    expect(order.fixedAnchors).toEqual([{ cardId: "event_1841", position: 1 }]);
    if (order.draft.kind !== "order")
      throw new Error("local_event_sequence draft is not order");
    expect(order.draft.cardIds).toEqual([]);

    // The fixed event_1841 prefix is materialized by the board and normalized
    // into the persisted draft exactly once when the first movable card is
    // placed, so the raw draft proves the pointer insertion and prefix rules.
    let expectedOrder: string[];
    await dragAnalysisCardSynthetic("event_1843", "order:end");
    expectedOrder = ["event_1841", "event_1843"];
    await waitForOrderDraft(expectedOrder);
    await dragAnalysisCardSynthetic("event_1842", "order:before:event_1843");
    expectedOrder = ["event_1841", "event_1842", "event_1843"];
    await waitForOrderDraft(expectedOrder);

    await saveManualSlot(2, "Beat 8.5 順序部分草稿");
    await closePersistenceBrowserToGameplay();
    await returnToTitle();
    await continueFromTitle();
    state = await waitForAnalysisBoard("local_event_sequence");
    const restoredOrder = analysisBoard(state, "local_event_sequence");
    if (
      restoredOrder.kind !== "order" ||
      restoredOrder.draft.kind !== "order"
    ) {
      throw new Error("Continue did not restore the Order draft");
    }
    expect(restoredOrder.fixedAnchors).toEqual([
      { cardId: "event_1841", position: 1 },
    ]);
    expect(restoredOrder.draft.cardIds).toEqual(expectedOrder);

    await dragAnalysisCardSynthetic("event_1844", "order:end");
    expectedOrder = ["event_1841", "event_1842", "event_1843", "event_1844"];
    await waitForOrderDraft(expectedOrder);
    await dragAnalysisCardSynthetic("event_1844", "order:before:event_1843");
    expectedOrder = ["event_1841", "event_1842", "event_1844", "event_1843"];
    await waitForOrderDraft(expectedOrder);
    await dragAnalysisCardSynthetic("event_1844", "order:pending");
    expectedOrder = ["event_1841", "event_1842", "event_1843"];
    await waitForOrderDraft(expectedOrder);
    await dragAnalysisCardSynthetic("event_1844", "order:end");
    expectedOrder = ["event_1841", "event_1842", "event_1843", "event_1844"];
    state = await waitForOrderDraft(expectedOrder);
    const finalOrder = analysisBoard(state, "local_event_sequence");
    if (finalOrder.kind !== "order" || finalOrder.draft.kind !== "order") {
      throw new Error("final Order draft is not order");
    }
    expect(finalOrder.fixedAnchors).toEqual([
      { cardId: "event_1841", position: 1 },
    ]);
    expect(finalOrder.draft.cardIds).toEqual(expectedOrder);

    const orderResult = await submitCurrentAnalysisBoard(
      "local_event_sequence",
    );
    expectDialogueLine(
      orderResult,
      "相馬律",
      "本機順序和摘要對不上；二十三點零七分五十秒是合併完成的時間，不是某一個人的事件時間。",
    );
    const completedOrder = analysisBoard(orderResult, "local_event_sequence");
    expect(completedOrder.completed).toBe(true);
    if (completedOrder.draft.kind !== "order") {
      throw new Error("completed Order draft is not order");
    }
    expect(completedOrder.draft.cardIds).toEqual(expectedOrder);
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
    const thresholdButton = await browser.execute((cardId: string) => {
      const card = document.querySelector<HTMLElement>(
        `[data-analysis-card-id="${cardId}"]`,
      );
      return {
        tagName: card?.tagName ?? null,
        ariaPressed: card?.getAttribute("aria-pressed") ?? null,
      };
    }, firstCard.id);
    expect(thresholdButton).toEqual({ tagName: "BUTTON", ariaPressed: "true" });

    await saveManualSlot(3, "Beat 8.5 門鎖申請草稿");
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
    const thresholdResult = await submitCurrentAnalysisBoard(
      "narrow_request_basis",
    );
    expectDialogueLine(
      thresholdResult,
      "相馬律",
      "申請寫好了。我的字開始飄了。",
    );
    const completedThreshold = analysisBoard(
      thresholdResult,
      "narrow_request_basis",
    );
    expect(completedThreshold.completed).toBe(true);
    if (completedThreshold.draft.kind !== "threshold") {
      throw new Error("completed Threshold draft is not threshold");
    }
    expect(completedThreshold.draft.selectedCardIds).toEqual([
      "lock_sequence",
      "phone_notification",
    ]);
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

    await advanceDialogueUntil(async () => {
      const next = await getPackagedGameState();
      return (
        next.scene.kind === "analysis" &&
        next.mode.type === "dialogue" &&
        next.mode.current.kind === "line" &&
        next.mode.current.text ===
          "申請準備好了；身分仍未明，核准片段也還不能取得。"
      );
    }, 160);
    state = await getPackagedGameState();
    expectDialogueLine(
      state,
      "早坂茜",
      "申請準備好了；身分仍未明，核准片段也還不能取得。",
    );
    await advanceDialogueUntil(
      async () => (await getPackagedGameState()).scene.id !== ANALYSIS_SCENE_ID,
      160,
    );

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
    await snapshotMenuGeometry();
    await assertInterrogationMenuSemantics();
    await captureMockupViewport({
      name: "interrogation-menu",
      requested: MOCKUP_VIEWPORT,
      outputDirectory: MOCKUP_CAPTURE_OUTPUT_DIRECTORY,
    });
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

  it("matches the Interrogation mockup geometry contract", async () => {
    expect(geometry.menu).toBeDefined();
    expect(geometry.testimony).toBeDefined();
    expect(geometry.present).toBeDefined();
    expect(geometry.analysisClassify).toBeDefined();
    expect(geometry.analysisOrder).toBeDefined();
    if (
      !geometry.menu ||
      !geometry.testimony ||
      !geometry.present ||
      !geometry.analysisClassify ||
      !geometry.analysisOrder
    )
      return;

    const viewport = await browser.execute(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const viewportBounds: Rect = {
      left: 0,
      top: 0,
      right: viewport.width,
      bottom: viewport.height,
      width: viewport.width,
      height: viewport.height,
    };
    const { menu, testimony, present, analysisClassify, analysisOrder } =
      geometry;

    expectEdgesAligned(menu.stage, menu.main);
    expectInside(menu.art, menu.stage);
    const intendedLeftInset = Math.min(
      120,
      Math.max(24, viewport.width * 0.08),
    );
    const observedLeftInset = menu.art.left - menu.stage.left;
    expect(observedLeftInset).toBeGreaterThanOrEqual(intendedLeftInset - 2);
    expect(observedLeftInset).toBeLessThanOrEqual(intendedLeftInset + 2);
    expect(menu.art.height / menu.stage.height).toBeGreaterThanOrEqual(0.88);
    expect(menu.art.height / menu.stage.height).toBeLessThanOrEqual(1.01);
    expect(menu.record.width).toBeLessThanOrEqual(1004);
    expect(
      Math.abs(edgeCenter(menu.record) - edgeCenter(menu.stage)),
    ).toBeLessThanOrEqual(2);
    expect(menu.stage.bottom - menu.record.bottom).toBeCloseTo(28, 0);

    expectEdgesAligned(testimony.stage, testimony.main);
    expectInside(testimony.art, testimony.stage);
    expect(testimony.frame.width).toBeLessThanOrEqual(1004);
    expect(
      Math.abs(edgeCenter(testimony.frame) - edgeCenter(testimony.stage)),
    ).toBeLessThanOrEqual(2);
    expect(testimony.box.height).toBeGreaterThanOrEqual(194);
    expect(testimony.challenge.width).toBeGreaterThanOrEqual(124);
    expect(testimony.challenge.height).toBeGreaterThanOrEqual(124);
    expect(
      Math.abs(
        testimony.stage.bottom -
          testimony.frame.bottom -
          (menu.stage.bottom - menu.record.bottom),
      ),
    ).toBeLessThanOrEqual(4);

    expect(present.tray.width).toBeLessThanOrEqual(904);
    expect(present.tray.left).toBeGreaterThanOrEqual(0);
    expect(present.tray.top).toBeGreaterThanOrEqual(0);
    expect(present.tray.right).toBeLessThanOrEqual(viewport.width);
    expect(present.tray.bottom).toBeLessThanOrEqual(viewport.height);

    for (const analysis of [analysisClassify, analysisOrder]) {
      expect(Math.abs(analysis.rail.width - 248)).toBeLessThanOrEqual(2);
      expect(analysis.frame.width).toBeLessThanOrEqual(962);
      expect(analysis.frame.left).toBeGreaterThanOrEqual(
        analysis.workspace.left - 1,
      );
      expect(analysis.frame.right).toBeLessThanOrEqual(
        analysis.workspace.right + 1,
      );
      expect(
        Math.abs(edgeCenter(analysis.frame) - analysis.workspaceContentCenter),
      ).toBeLessThanOrEqual(2);
      expectInside(analysis.workbench, viewportBounds);
      expectInside(analysis.footer, viewportBounds);
    }

    const classifyRatio =
      analysisClassify.groups.width / analysisClassify.pool.width;
    expect(classifyRatio).toBeGreaterThanOrEqual(1.35);
    expect(classifyRatio).toBeLessThanOrEqual(1.45);

    const orderRatio =
      analysisOrder.timeline.width / analysisOrder.pending.width;
    expect(orderRatio).toBeGreaterThanOrEqual(1.25);
    expect(orderRatio).toBeLessThanOrEqual(1.35);
  });
});
