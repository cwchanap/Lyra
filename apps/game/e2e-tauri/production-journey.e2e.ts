import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  acknowledgeAcquisitionDomFirst,
  advanceDialogueUntil,
  clickButton,
  clickSoleMapDestination,
  closePersistenceBrowserToGameplay,
  collectKagamiSummaryEvidence,
  completeP1PracticeTutorial,
  drainDialogueFast,
  elementExists,
  enabledMapDestinationIds,
  ensureCaseFileViewport,
  ensureMinimumWindowViewport,
  forgetStoryCleared,
  getPackagedGameState,
  jumpToProductionChapterScene,
  jumpToProductionScene,
  lastVisibleDialogueText,
  loadTitleSlot,
  observedCssViewport,
  openGameMenu,
  resetE2eStorage,
  returnToTitle,
  saveManualSlot,
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
import type {
  CharacterView,
  GameStateView,
  HotspotView,
  TopicView,
} from "$lib/state/types";

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

/** Opens the game menu, reports whether it offers Scene Select, and closes it. */
async function gameMenuOffersSceneSelect(): Promise<boolean> {
  await openGameMenu();
  const offered = await browser.execute(
    (heading: string, label: string) => {
      const menu = Array.from(
        document.querySelectorAll('[role="dialog"]'),
      ).find((dialog) =>
        Array.from(dialog.querySelectorAll("h2")).some((title) =>
          (title.textContent ?? "").includes(heading),
        ),
      );
      if (!menu) return null;
      return Array.from(menu.querySelectorAll("button")).some((button) =>
        (button.textContent ?? "").includes(label),
      );
    },
    anchors.gameMenu,
    anchors.sceneSelect,
  );
  if (offered === null) throw new Error("game menu dialog is not open");
  await clickButton(anchors.continueInvestigation);
  return offered;
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
type MapGate = {
  readonly wrapper: string;
  readonly destination: string;
  readonly next: string;
};

async function crossGate(
  gate: MapGate,
  crossedWrappers: string[],
): Promise<void> {
  await waitForPackagedGameState(
    (state) => isPendingMapGate(state, gate.wrapper),
    30000,
    `${gate.wrapper} did not park on its pending city map`,
  );
  expect(await enabledMapDestinationIds()).toEqual([gate.destination]);
  crossedWrappers.push(gate.wrapper);
  console.log(
    `[ProductionJourney] crossing gate ${gate.wrapper} -> ${gate.next} (destination ${gate.destination})`,
  );
  await advanceDialogueUntil(
    async () => (await getPackagedGameState()).scene.id === gate.next,
    DIALOGUE_DRAIN_CAP,
  );
  await expectCrossedToSuccessor(gate.next);
  console.log(
    `[ProductionJourney] crossed gate ${gate.wrapper} (${crossedWrappers.length} this run)`,
  );
}

type ChapterMapGate = MapGate & { readonly chapter: string };

type ChapterGateLeg = {
  readonly gates: readonly ChapterMapGate[];
  /** The next leg's first gate, where this leg stops; none on the last leg. */
  readonly stopGate: ChapterMapGate | undefined;
};

/**
 * Chapter 2's map gates split into one leg per gates test, at each wrapper in
 * `anchors.chapter2LegStartWrappers`; every leg is non-empty.
 */
function chapter2GateLegs(): readonly ChapterGateLeg[] {
  const gates: readonly ChapterMapGate[] = anchors.chapter2MapGates;
  const splits = anchors.chapter2LegStartWrappers.map((wrapper) =>
    gates.findIndex((gate) => gate.wrapper === wrapper),
  );
  splits.forEach((split, i) => {
    const previous = i === 0 ? 0 : splits[i - 1];
    if (split < 1 || previous === undefined || split <= previous) {
      throw new Error(
        `chapter2LegStartWrappers must name Chapter 2 map gates after the first, in authored order (got ${anchors.chapter2LegStartWrappers.join(", ")})`,
      );
    }
  });
  const bounds = [0, ...splits, gates.length];
  return bounds.slice(0, -1).map((start, i) => {
    const end = bounds[i + 1] ?? gates.length;
    return { gates: gates.slice(start, end), stopGate: gates[end] };
  });
}

/**
 * Chapter 1's map gates split at `anchors.chapter1SecondHalfWrapper`: the
 * first test crosses `firstHalf`, the second starts at `secondHalf[0]`.
 */
function chapter1Halves(): {
  readonly firstHalf: readonly MapGate[];
  readonly secondHalf: readonly MapGate[];
} {
  const gates: readonly MapGate[] = anchors.mapGates;
  const split = gates.findIndex(
    (gate) => gate.wrapper === anchors.chapter1SecondHalfWrapper,
  );
  if (split < 1) {
    throw new Error(
      `chapter1SecondHalfWrapper must name a Chapter 1 map gate after the first (got ${anchors.chapter1SecondHalfWrapper})`,
    );
  }
  return { firstHalf: gates.slice(0, split), secondHalf: gates.slice(split) };
}

/** Drains to each later gate of `leg` and crosses it, after its first. */
async function crossLaterGates(
  leg: ChapterGateLeg,
  crossedWrappers: string[],
): Promise<void> {
  for (const gate of leg.gates.slice(1)) {
    await drainOrganicRoute(
      (state) =>
        state.chapter.id === gate.chapter &&
        isPendingMapGate(state, gate.wrapper),
      `${gate.chapter}/${gate.wrapper} pending city map`,
    );
    await crossGate(gate, crossedWrappers);
  }
}

/**
 * The Scene Select seed is only a way in. Saves the pending city map, forgets
 * the seeded clear, and resumes from the save with replay locked again, so the
 * rest of the test plays as a fresh, uncleared profile. Saves outlive each
 * test's storage reset, so every caller takes its own slot.
 */
async function resumeUnclearedFromSave(
  atGate: (state: GameStateView) => boolean,
  gateLabel: string,
  slot: 1 | 2 | 3,
  slotName: string,
): Promise<void> {
  await waitForPackagedGameState(
    atGate,
    30000,
    `${gateLabel} did not park on its pending city map`,
  );
  await saveManualSlot(slot, slotName);
  await closePersistenceBrowserToGameplay();
  await returnToTitle();
  await forgetStoryCleared();
  await loadTitleSlot("manual", slot);
  await waitForPackagedGameState(
    atGate,
    30000,
    `manual load did not restore ${gateLabel}'s pending city map`,
  );
  expect(await gameMenuOffersSceneSelect()).toBe(false);
}

/**
 * Stops a non-final leg where the next test starts: the next leg's first gate
 * pending, so the gates tests together play every authored Chapter 2 scene
 * after the opening.
 */
async function stopAtNextLeg(
  leg: ChapterGateLeg,
  crossedWrappers: readonly string[],
): Promise<void> {
  const { stopGate } = leg;
  if (!stopGate) {
    throw new Error("the last Chapter 2 gates leg has no next leg to stop at");
  }
  await drainOrganicRoute(
    (state) =>
      state.chapter.id === stopGate.chapter &&
      isPendingMapGate(state, stopGate.wrapper),
    `${stopGate.chapter}/${stopGate.wrapper} pending city map`,
  );
  expect(await enabledMapDestinationIds()).toEqual([stopGate.destination]);
  expect(crossedWrappers).toEqual(leg.gates.map((gate) => gate.wrapper));
}

/**
 * Authored cross-examination routes: the correct contradicting evidence for
 * every required question on the normal Chapter 1 and 2 routes (content coupling
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
  interrogation_scene_6: [
    {
      phaseId: "p_observation",
      questionId: "q_crowd",
      evidenceId: "togawa_video_position_check",
    },
    {
      phaseId: "p_observation",
      questionId: "q_0014",
      evidenceId: "platform_archive_rule",
    },
    {
      phaseId: "p_observation",
      questionId: "q_phone",
      evidenceId: "mashiro_phone_dock",
    },
  ],
  interrogation_scene_10: [
    {
      phaseId: "p1",
      questionId: "q_p1",
      evidenceId: "miyake_mother_call_confirmation",
    },
    {
      phaseId: "p1",
      questionId: "q_p2",
      evidenceId: "victim_phone_notification",
    },
    { phaseId: "p1", questionId: "q_p3", evidenceId: "floor_water_drying_map" },
    {
      phaseId: "gate",
      questionId: "q_request_clip",
      evidenceId: "doorlock_summary_timetable",
    },
    { phaseId: "p4", questionId: "q_p4", evidenceId: "approved_clip" },
    { phaseId: "p5", questionId: "q_p5", evidenceId: "kitami_external_access" },
    {
      phaseId: "p5",
      questionId: "q_p6",
      evidenceId: "kitami_data_theft_record",
    },
  ],
  interrogation_scene_19: [
    {
      phaseId: "p1",
      questionId: "q_p1_crowd",
      evidenceId: "plaza_sightline_map",
    },
    {
      phaseId: "p2",
      questionId: "q_p2_phones",
      evidenceId: "togawa_video_position_check",
    },
    {
      phaseId: "p2",
      questionId: "q_p2_side",
      evidenceId: "silhouette_side_view_check",
    },
    {
      phaseId: "p3",
      questionId: "q_p3_composite",
      evidenceId: "program_composite_label",
    },
    {
      phaseId: "p3",
      questionId: "q_p3_raw",
      evidenceId: "raw_buffer_rule",
    },
    {
      phaseId: "p4",
      questionId: "q_p4_first_report",
      evidenceId: "incident_comms_log",
    },
    {
      phaseId: "p4",
      questionId: "q_p4_channel",
      evidenceId: "process_channel_roster",
    },
    {
      phaseId: "p5",
      questionId: "q_p5_audio",
      evidenceId: "sponsor_audio_routing",
    },
    {
      phaseId: "p5",
      questionId: "q_p5_watch",
      evidenceId: "mashiro_watch_ping",
    },
    {
      phaseId: "p6",
      questionId: "q_p6_route",
      evidenceId: "venue_logistics_board",
    },
    {
      phaseId: "p6",
      questionId: "q_p6_door",
      evidenceId: "m03_door_log",
    },
    {
      phaseId: "p6",
      questionId: "q_p6_elevator",
      evidenceId: "service_elevator_b_log",
    },
    {
      phaseId: "p7",
      questionId: "q_p7_saegusa",
      evidenceId: "saegusa_access_check",
    },
    {
      phaseId: "p7",
      questionId: "q_p7_entry",
      evidenceId: "sr2307_submission_record",
    },
    {
      phaseId: "p7",
      questionId: "q_p7_motive",
      evidenceId: "mashiro_exit_message",
    },
  ],
};

/**
 * Authored 出示紀錄 routes: the record that opens each Present topic on the
 * normal route, keyed by scene then topic (content coupling points, like
 * interrogationChallenges).
 */
const investigationPresents: Record<string, Record<string, string>> = {
  investigation_scene_9: { draft_slip: "masuda_whistleblower_draft" },
  investigation_scene_10: { that_comment: "rider_deleted_comment" },
  investigation_scene_12: { side_view: "alley_side_view_check" },
  investigation_scene_14: { match_the_records: "service_elevator_b_log" },
};

/**
 * The record to show for a pending Present topic, or null while the player
 * does not hold it yet. A Present topic with no authored route is an error.
 */
function heldPresentRecord(
  state: GameStateView,
  topic: TopicView,
): { name: string } | null {
  const evidenceId = investigationPresents[state.scene.id]?.[topic.id];
  if (!evidenceId) {
    throw new Error(
      `no authored 出示紀錄 route for ${state.scene.id}/${topic.id}`,
    );
  }
  return (
    state.inventory.evidence.find((candidate) => candidate.id === evidenceId) ??
    null
  );
}

/** A topic the drain can act on now: plain and undiscussed, or a Present topic whose record is held. */
function actionableTopic(
  state: GameStateView,
  character: CharacterView,
): TopicView | undefined {
  return character.topics.find(
    (topic) =>
      !topic.discussed &&
      (!topic.requiresPresent || heldPresentRecord(state, topic) !== null),
  );
}

// --- HPA-705 evidence tray: searched SHOW/PRESENT route + 800x600 gate ----

/** Chapter 2's final hearing — the only tray carrying the full inventory. */
const FINAL_HEARING_SCENE_ID = "interrogation_scene_19";

/**
 * The 2026-11-11 packaged UAT measured ~74 records at the final hearing's
 * tray (HPA-705 design §1); at that size the board needed ~29 screens of
 * scrolling at 800x600, which is exactly what search + compact CSS fix.
 */
const FINAL_HEARING_MIN_RECORDS = 74;

/** Screenshots are PR artifacts: CI uploads all of apps/game/e2e-artifacts/. */
const EVIDENCE_TRAY_SCREENSHOT_DIR = path.join(
  process.cwd(),
  "e2e-artifacts",
  "save-e2e",
  "evidence-tray-800x600",
);

type BoxRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** One DOM snapshot of the open SHOW/PRESENT tray (HPA-705 800x600 gate). */
type EvidenceTraySnapshot = {
  viewport: { width: number; height: number };
  tray: BoxRect | null;
  header: BoxRect | null;
  headerFlexWrap: string;
  headerClientWidth: number;
  headerScrollWidth: number;
  /** Every visible flex item of the header, with a debug label. */
  headerChildren: Array<{ label: string; rect: BoxRect }>;
  eyebrowDisplay: string | null;
  lineRecord: BoxRect | null;
  grid: BoxRect | null;
  gridClientWidth: number;
  gridScrollWidth: number;
  gridScrollTop: number;
  detail: BoxRect | null;
  footer: BoxRect | null;
  withdrawButton: BoxRect | null;
  firstRowTitles: Array<{ text: string; rect: BoxRect }>;
  firstTileVisualHeight: number | null;
  tileCount: number;
  countText: string;
  searchValue: string;
  targetTile: { strong: string; rect: BoxRect; height: number } | null;
};

/**
 * Set once the 800x600 gate has actually executed; the final Chapter 2 leg
 * asserts it, so a shorter inventory fails loudly instead of silently
 * skipping the geometry proof.
 */
let evidenceTrayGeometryGateDone = false;

const evidenceTraySearchSelector = (): string =>
  `input[aria-label="${anchors.evidenceTraySearch}"]`;

const RECT_TOLERANCE_PX = 0.5;

function requireRect(rect: BoxRect | null, label: string): BoxRect {
  if (!rect) {
    throw new Error(`evidence tray 800x600 gate: ${label} rect missing`);
  }
  return rect;
}

function expectRectWithin(inner: BoxRect, outer: BoxRect): void {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left - RECT_TOLERANCE_PX);
  expect(inner.top).toBeGreaterThanOrEqual(outer.top - RECT_TOLERANCE_PX);
  expect(inner.right).toBeLessThanOrEqual(outer.right + RECT_TOLERANCE_PX);
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + RECT_TOLERANCE_PX);
}

function rectsOverlap(a: BoxRect, b: BoxRect): boolean {
  return (
    a.left < b.right - RECT_TOLERANCE_PX &&
    b.left < a.right - RECT_TOLERANCE_PX &&
    a.top < b.bottom - RECT_TOLERANCE_PX &&
    b.top < a.bottom - RECT_TOLERANCE_PX
  );
}

/**
 * Reads one DOM snapshot of the open tray: viewport, per-section rects,
 * compact-CSS markers, and the rect and height of the first tile whose FULL
 * record title matches `targetName` exactly.
 */
async function measureEvidenceTray(
  targetName: string,
): Promise<EvidenceTraySnapshot> {
  return browser.execute(
    (target: string, searchSelector: string): EvidenceTraySnapshot => {
      const boxRect = (box: DOMRect): BoxRect => ({
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      });
      const rectOf = (element: Element | null): BoxRect | null =>
        element ? boxRect(element.getBoundingClientRect()) : null;
      const tray = document.querySelector<HTMLElement>(
        "[data-interrogation-present-tray]",
      );
      const grid = document.querySelector<HTMLElement>(
        "[data-interrogation-evidence-grid]",
      );
      const tiles = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button.record-tile"),
      );
      const strongOf = (tile: HTMLButtonElement): string =>
        (tile.querySelector(".record-copy strong")?.textContent ?? "").trim();
      const targetMatches = tiles.filter((tile) => strongOf(tile) === target);
      const targetBox = targetMatches[0]?.getBoundingClientRect();
      const firstTile = tiles.length > 0 ? tiles[0] : null;
      const firstVisual = firstTile?.querySelector(".record-visual");
      // First ROW, not just the first tile: a longer title in any other
      // column can clip or overlap without the first tile ever showing it.
      const firstRowTop = firstTile?.getBoundingClientRect().top ?? null;
      const firstRowTolerancePx = 2;
      const strongEntryOf = (tile: HTMLButtonElement) => {
        const strong = tile.querySelector(".record-copy strong");
        return strong
          ? {
              text: (strong.textContent ?? "").trim(),
              rect: boxRect(strong.getBoundingClientRect()),
            }
          : null;
      };
      const firstRowTitles =
        firstRowTop === null
          ? []
          : tiles
              .filter(
                (tile) =>
                  Math.abs(tile.getBoundingClientRect().top - firstRowTop) <=
                  firstRowTolerancePx,
              )
              .map(strongEntryOf)
              .filter(
                (entry): entry is { text: string; rect: BoxRect } =>
                  entry !== null,
              );
      const header = tray?.querySelector("header") ?? null;
      const eyebrow = header?.querySelector(".eyebrow") ?? null;
      const searchInput =
        document.querySelector<HTMLInputElement>(searchSelector);
      // The header's own flex items: heading/progress copy, search input,
      // record count and the ESC button. Mutual overlap between these is
      // what a wrapped-but-squeezed header hides from the row-level checks.
      const headerChildren = header
        ? Array.from(header.children)
            .filter(
              (child): child is HTMLElement =>
                child instanceof HTMLElement &&
                getComputedStyle(child).display !== "none",
            )
            .map((child) => ({
              label:
                child.tagName.toLowerCase() +
                (child.classList.length > 0
                  ? `.${String(child.classList[0])}`
                  : ""),
              rect: boxRect(child.getBoundingClientRect()),
            }))
        : [];
      return {
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        tray: rectOf(tray),
        header: rectOf(header),
        headerFlexWrap: header ? getComputedStyle(header).flexWrap : "",
        headerClientWidth: header?.clientWidth ?? 0,
        headerScrollWidth: header?.scrollWidth ?? 0,
        headerChildren,
        eyebrowDisplay: eyebrow ? getComputedStyle(eyebrow).display : null,
        lineRecord: rectOf(
          tray?.querySelector("blockquote.line-record") ?? null,
        ),
        grid: rectOf(grid),
        gridClientWidth: grid?.clientWidth ?? 0,
        gridScrollWidth: grid?.scrollWidth ?? 0,
        gridScrollTop: grid?.scrollTop ?? 0,
        detail: rectOf(tray?.querySelector(".record-detail") ?? null),
        footer: rectOf(tray?.querySelector("footer") ?? null),
        withdrawButton: rectOf(tray?.querySelector("button.withdraw") ?? null),
        firstRowTitles,
        firstTileVisualHeight: firstVisual
          ? firstVisual.getBoundingClientRect().height
          : null,
        tileCount: tiles.length,
        countText: (
          tray?.querySelector(".record-count")?.textContent ?? ""
        ).trim(),
        searchValue: searchInput?.value ?? "",
        targetTile:
          targetMatches[0] && targetBox
            ? {
                strong: strongOf(targetMatches[0]),
                rect: boxRect(targetBox),
                height: targetBox.height,
              }
            : null,
      };
    },
    targetName,
    evidenceTraySearchSelector(),
  );
}

/**
 * The 800x600 compact-tray geometry assertions (HPA-705 task 4): every
 * section present, visible and inside the viewport/tray, the five rows never
 * mutually overlapping, the compact media query provably active (48px
 * thumbnails, hidden eyebrow), header allowed to wrap without horizontal
 * squeeze-out and with its own controls (heading/progress, search input,
 * count, ESC) contained and non-overlapping, grid not clipping horizontally,
 * every first-row title fully visible, and the grid scrolled to its top.
 */
function expectEvidenceTrayCompactGeometry(
  snapshot: EvidenceTraySnapshot,
  label: string,
): void {
  const fail = (message: string): Error =>
    new Error(`evidence tray 800x600 gate (${label}): ${message}`);

  expect(snapshot.viewport.width).toBe(800);
  expect(snapshot.viewport.height).toBe(600);

  const tray = requireRect(snapshot.tray, "tray");
  const header = requireRect(snapshot.header, "header");
  const footer = requireRect(snapshot.footer, "footer");
  // Top-level tray rows must never cover each other. Controls that live
  // INSIDE a row (search input + ESC in the header, 收回 in the footer) are
  // nested children, not overlapping siblings — a child always sits inside
  // its parent's rect — so they are checked against their own row instead.
  const rows: Array<[string, BoxRect]> = [
    ["header", header],
    ["line record", requireRect(snapshot.lineRecord, "line record")],
    ["grid", requireRect(snapshot.grid, "grid")],
    ["detail", requireRect(snapshot.detail, "detail")],
    ["footer", footer],
  ];
  const nested: Array<[string, BoxRect, BoxRect]> = [
    [
      "withdraw button",
      requireRect(snapshot.withdrawButton, "withdraw button"),
      footer,
    ],
  ];
  const viewportRect: BoxRect = {
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
  };
  if (tray.width <= 0 || tray.height <= 0) throw fail("tray has an empty rect");
  expectRectWithin(tray, viewportRect);
  for (const [name, rect] of [...rows, ...nested]) {
    if (rect.width <= 0 || rect.height <= 0) {
      throw fail(`${name} has an empty rect`);
    }
    expectRectWithin(rect, viewportRect);
    expectRectWithin(rect, tray);
  }
  for (const [, rect, parent] of nested) {
    expectRectWithin(rect, parent);
  }
  // Header controls are row-contained by the loop above, but that says
  // nothing about THEMSELVES: search input and ESC may overlap each other —
  // or the heading, progress or count — while staying inside the header and
  // passing every row assertion. In the wrapped PRESENT layout,
  // flex-wrap: wrap proves a CSS declaration, not a laid-out header, so the
  // header's own visible flex items are measured: each must be non-empty,
  // contained in the header, and pairwise non-overlapping.
  const headerChildren = snapshot.headerChildren;
  if (headerChildren.length === 0) {
    throw fail("header has no measurable visible children");
  }
  for (const { label: childName, rect: childRect } of headerChildren) {
    if (childRect.width <= 0 || childRect.height <= 0) {
      throw fail(`header child ${childName} has an empty rect`);
    }
    expectRectWithin(childRect, header);
  }
  for (let i = 0; i < headerChildren.length; i += 1) {
    for (let j = i + 1; j < headerChildren.length; j += 1) {
      const a = headerChildren[i];
      const b = headerChildren[j];
      if (rectsOverlap(a.rect, b.rect)) {
        throw fail(`header child ${a.label} overlaps header child ${b.label}`);
      }
    }
  }
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const [aName, aRect] = rows[i];
      const [bName, bRect] = rows[j];
      if (rectsOverlap(aRect, bRect)) {
        throw fail(`${aName} overlaps ${bName}`);
      }
    }
  }

  // Compact media query proofs: hidden eyebrow (style) and compact
  // thumbnails (geometry), not just a small window with the regular layout.
  // The 48px budget renders 48-50px depending on box-sizing vs the 1px
  // border; the regular layout renders 106-108px.
  expect(snapshot.eyebrowDisplay).toBe("none");
  const visual = snapshot.firstTileVisualHeight;
  if (visual === null || visual < 46 || visual > 56) {
    throw fail(
      `compact ~48px thumbnails not active (first tile visual ${String(visual)}px)`,
    );
  }
  // The header may wrap (flex-wrap: wrap) but must never squeeze out.
  expect(snapshot.headerFlexWrap).toBe("wrap");
  expect(snapshot.headerScrollWidth).toBeLessThanOrEqual(
    snapshot.headerClientWidth + RECT_TOLERANCE_PX,
  );
  expect(snapshot.gridScrollWidth).toBeLessThanOrEqual(
    snapshot.gridClientWidth + RECT_TOLERANCE_PX,
  );
  expect(snapshot.gridScrollTop).toBe(0);

  // Every FIRST-ROW title, not just the first tile's: a longer title in
  // any other column can clip, extend below the visible grid, or overlap a
  // neighbour while the first tile stays clean.
  const firstRowTitles = snapshot.firstRowTitles;
  if (firstRowTitles.length === 0) {
    throw fail("first-row tile titles missing");
  }
  const gridRect = requireRect(snapshot.grid, "grid");
  for (const entry of firstRowTitles) {
    if (entry.text === "") {
      throw fail("first-row tile title is empty");
    }
    if (entry.rect.width <= 0 || entry.rect.height <= 0) {
      throw fail(`first-row title "${entry.text}" has an empty rect`);
    }
    expectRectWithin(entry.rect, gridRect);
  }
}

/** The number of record tiles currently rendered in the open tray. */
async function evidenceTrayTileCount(): Promise<number> {
  return browser.execute(
    () =>
      document.querySelectorAll<HTMLButtonElement>("button.record-tile").length,
  );
}

/**
 * Observable proof that the tray's Svelte search applied to the COMPLETE
 * `query`: the input holds the full value (partial CJK key sequences fail
 * here), the record-count text left its pre-search value (a no-op setValue
 * on the already-matching unfiltered tray can never do that), and the exact
 * full-title tile renders.
 */
async function evidenceTrayFilterApplied(
  query: string,
  baselineCountText: string,
): Promise<boolean> {
  return browser.execute(
    (searchSelector: string, name: string, baseline: string) => {
      const input = document.querySelector<HTMLInputElement>(searchSelector);
      if (!input || input.value !== name) return false;
      const countText = (
        document.querySelector(
          "[data-interrogation-present-tray] .record-count",
        )?.textContent ?? ""
      ).trim();
      if (countText === "" || countText === baseline) return false;
      return Array.from(
        document.querySelectorAll<HTMLButtonElement>("button.record-tile"),
      ).some(
        (candidate) =>
          (
            candidate.querySelector(".record-copy strong")?.textContent ?? ""
          ).trim() === name,
      );
    },
    evidenceTraySearchSelector(),
    query,
    baselineCountText,
  );
}

/** Waits for the open tray's search input (SHOW or PRESENT mount). */
async function waitForEvidenceTraySearch(): Promise<void> {
  await browser.waitUntil(() => elementExists(evidenceTraySearchSelector()), {
    timeout: 30000,
    interval: 100,
    timeoutMsg: "evidence tray search input did not appear",
  });
}

type EvidenceTraySearchTransport = "setValue" | "valueAndInputEvent";

/**
 * Types `query` into the open tray's search input and verifies the Svelte
 * filter really applied before crediting the transport: the COMPLETE input
 * value plus an observable filter update (count text changed from the
 * pre-search baseline AND the exact full-title tile rendered) — the tile
 * alone proves nothing because it already exists in the unfiltered tray, so
 * a no-op setValue, a dropped Svelte input update, or a partially delivered
 * CJK key sequence can never pass. WebDriver `setValue` — real key events
 * through tauri-plugin-wdio/WebKit — is tried first; only when it fails to
 * update the component does this helper fall back to the repo-standard
 * `input.value` + `input` event dispatch. The chosen transport is logged so
 * CJK input reliability stays traceable.
 */
async function typeEvidenceTrayQuery(
  query: string,
): Promise<EvidenceTraySearchTransport> {
  const selector = evidenceTraySearchSelector();
  const baselineCountText = await browser.execute(() =>
    (
      document.querySelector("[data-interrogation-present-tray] .record-count")
        ?.textContent ?? ""
    ).trim(),
  );
  const waitUntilApplied = (transport: EvidenceTraySearchTransport) =>
    browser.waitUntil(
      () => evidenceTrayFilterApplied(query, baselineCountText),
      {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `evidence tray search via ${transport} did not update the record list`,
      },
    );

  let transport: EvidenceTraySearchTransport = "setValue";
  try {
    const input = await browser.$(selector);
    await input.setValue(query);
    await waitUntilApplied("setValue");
  } catch {
    transport = "valueAndInputEvent";
    const value = await browser.execute(
      (inputSelector: string, name: string) => {
        const input = document.querySelector<HTMLInputElement>(inputSelector);
        if (!input) return null;
        input.value = name;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return input.value;
      },
      selector,
      query,
    );
    if (value !== query) {
      throw new Error("evidence tray search input is missing");
    }
    await waitUntilApplied("valueAndInputEvent");
  }
  console.log(`[EvidenceTray] searched "${query}" via ${transport}`);
  return transport;
}

/** Resets the tray search to the unfiltered list (Svelte input-event path). */
async function clearEvidenceTrayQuery(unfilteredCount: number): Promise<void> {
  const selector = evidenceTraySearchSelector();
  const cleared = await browser.execute((inputSelector: string) => {
    const input = document.querySelector<HTMLInputElement>(inputSelector);
    if (!input) return false;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.value === "";
  }, selector);
  if (!cleared) throw new Error("evidence tray search input is missing");
  await browser.waitUntil(
    async () => (await evidenceTrayTileCount()) === unfilteredCount,
    {
      timeout: 5000,
      interval: 100,
      timeoutMsg: "cleared search did not restore the unfiltered record list",
    },
  );
}

type EvidenceTraySingleResultProbe = {
  query: string;
  /** The probe tile's own height while the tray was still unfiltered. */
  unfilteredHeight: number;
  strong: string;
  rect: BoxRect;
  height: number;
};

/**
 * Hunts for a rendered full title whose search isolates exactly one tile
 * (bounded candidate list, collected while the tray is unfiltered, each
 * carrying its own unfiltered tile height so the no-stretch bound compares
 * the probe against ITSELF — never against an unrelated journey record).
 * Probe queries go through the tray's own input-event path: the real CJK
 * setValue verification already happened on the primary search, and probes
 * only need deterministic filter results for the 1-result geometry proof.
 */
async function probeSingleResultSearch(
  candidates: Array<{ title: string; unfilteredHeight: number }>,
): Promise<EvidenceTraySingleResultProbe | null> {
  const selector = evidenceTraySearchSelector();
  for (const candidate of candidates) {
    await browser.execute(
      (inputSelector: string, value: string) => {
        const input = document.querySelector<HTMLInputElement>(inputSelector);
        if (!input) return;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      selector,
      candidate.title,
    );
    try {
      await browser.waitUntil(
        async () => (await evidenceTrayTileCount()) === 1,
        { timeout: 1500, interval: 100 },
      );
    } catch {
      // This title also matches other records' hidden fields — try the next.
      continue;
    }
    const lone = await browser.execute(() => {
      const grid = document.querySelector<HTMLElement>(
        "[data-interrogation-evidence-grid]",
      );
      const tile =
        document.querySelector<HTMLButtonElement>("button.record-tile");
      const strong = tile?.querySelector(".record-copy strong");
      if (!grid || !tile || !strong) return null;
      const tileBox = tile.getBoundingClientRect();
      return {
        strong: (strong.textContent ?? "").trim(),
        rect: {
          left: tileBox.left,
          top: tileBox.top,
          right: tileBox.right,
          bottom: tileBox.bottom,
          width: tileBox.width,
          height: tileBox.height,
        },
        height: tileBox.height,
      };
    });
    if (lone) {
      return {
        query: candidate.title,
        unfilteredHeight: candidate.unfilteredHeight,
        ...lone,
      };
    }
  }
  return null;
}

/**
 * HPA-705 task 4: the one-shot 800x600 geometry gate. At the final hearing's
 * first ≥74-record tray it shrinks to the game's real 800x600 minimum
 * window, asserts the compact tray geometry, searches a real record name to
 * prove the hit stays on the first visible page without stretching the row,
 * saves initial + hit screenshots, then restores the larger viewport purely
 * as test isolation for the rest of the journey (there is no analysis step
 * after the final hearing).
 */
async function runEvidenceTrayGeometryGate(recordName: string): Promise<void> {
  console.log(
    `[EvidenceTrayGate] first ≥${FINAL_HEARING_MIN_RECORDS}-record tray in ${FINAL_HEARING_SCENE_ID}; shrinking to the 800x600 minimum window`,
  );
  await ensureMinimumWindowViewport();
  const viewport = await observedCssViewport();
  expect(viewport.width).toBe(800); // the compact gate, NOT the 1280x720 case-file viewport
  expect(viewport.height).toBe(600);
  mkdirSync(EVIDENCE_TRAY_SCREENSHOT_DIR, { recursive: true });

  // Single-result probe candidates must come from the UNFILTERED board:
  // after the primary search only the (few) matching titles remain. Each
  // candidate remembers its own unfiltered tile height for the later
  // like-for-like no-stretch comparison.
  const probeCandidates = await browser.execute(() =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>("button.record-tile"),
    )
      .slice(0, 12)
      .map((tile) => ({
        title:
          tile.querySelector(".record-copy strong")?.textContent?.trim() ?? "",
        unfilteredHeight: tile.getBoundingClientRect().height,
      }))
      .filter((candidate) => candidate.title !== ""),
  );

  // Unfiltered tray at 800x600: the full ≥74-record board.
  const initial = await measureEvidenceTray(recordName);
  expect(initial.tileCount).toBeGreaterThanOrEqual(FINAL_HEARING_MIN_RECORDS);
  expect(initial.searchValue).toBe("");
  expectEvidenceTrayCompactGeometry(initial, "initial tray");
  const initialScreenshot = path.join(
    EVIDENCE_TRAY_SCREENSHOT_DIR,
    "evidence-tray-800x600-initial.png",
  );
  await browser.saveScreenshot(initialScreenshot);

  // Real-name search at 800x600: the hit stays on the first visible page and
  // keeps its natural height — the row must not stretch to the grid track
  // when only a few results remain (align-content: start).
  const searchTransport = await typeEvidenceTrayQuery(recordName);
  const filtered = await measureEvidenceTray(recordName);
  expect(filtered.searchValue).toBe(recordName);
  expect(filtered.tileCount).toBeGreaterThanOrEqual(1);
  expect(filtered.tileCount).toBeLessThan(initial.tileCount);
  expectEvidenceTrayCompactGeometry(filtered, `search "${recordName}"`);
  const grid = requireRect(filtered.grid, "grid");
  const target = filtered.targetTile;
  if (!target) {
    throw new Error(`search hit tile ${recordName} not found in the tray`);
  }
  expect(target.strong).toBe(recordName);
  expectRectWithin(target.rect, grid);
  const unfilteredHeight = initial.targetTile?.height;
  if (unfilteredHeight === undefined) {
    throw new Error(`record ${recordName} missing from the unfiltered tray`);
  }
  // No vertical inflation: the searched hit must not grow versus its
  // unfiltered reference (CSS-grid row stretch would inflate it far past
  // +2px). It may legitimately be SHORTER: the unfiltered 5-column grid
  // shows a scrollbar, narrowing every column, so titles wrap to one more
  // line there than in the scrollbar-free filtered state (measured 131 vs
  // 113px at 800x600).
  expect(target.height).toBeLessThanOrEqual(unfilteredHeight + 2);
  const hitScreenshot = path.join(
    EVIDENCE_TRAY_SCREENSHOT_DIR,
    "evidence-tray-800x600-search-hit.png",
  );
  await browser.saveScreenshot(hitScreenshot);

  // The lone result must keep its natural height and leave the rest of the
  // grid empty — CSS Grid's default stretch would pull a single row across
  // the whole scrollable area. A search can legitimately match several
  // records via hidden fields (description/details/sourceTag), so when the
  // journey search is not itself a 1-result search, probe rendered full
  // titles until one isolates a tile — the 1-result case must provably run,
  // never silently skip.
  const screenshots = [initialScreenshot, hitScreenshot];
  let singleResult: { query: string; height: number };
  if (filtered.tileCount === 1) {
    // The tray is content-sized at 800x600 (the 1fr grid track collapses),
    // so "not stretched" is exactly the natural-height bound asserted above;
    // the lone result also keeps its first-page placement (clickRecordTile).
    singleResult = { query: recordName, height: target.height };
  } else {
    const probe = await probeSingleResultSearch(probeCandidates);
    if (!probe) {
      throw new Error(
        "no rendered record title isolates exactly one search result at 800x600",
      );
    }
    expect(probe.strong).toBe(probe.query);
    // Like-for-like: the probe tile against ITS OWN unfiltered height — the
    // journey record's height belongs to a different title.
    expect(probe.height).toBeLessThanOrEqual(probe.unfilteredHeight + 2);
    singleResult = { query: probe.query, height: probe.height };
    const probeScreenshot = path.join(
      EVIDENCE_TRAY_SCREENSHOT_DIR,
      "evidence-tray-800x600-single-result.png",
    );
    await browser.saveScreenshot(probeScreenshot);
    screenshots.push(probeScreenshot);
  }
  const metadataPath = path.join(
    EVIDENCE_TRAY_SCREENSHOT_DIR,
    "evidence-tray-800x600.json",
  );
  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        scene: FINAL_HEARING_SCENE_ID,
        viewport,
        tileCount: {
          unfiltered: initial.tileCount,
          filtered: filtered.tileCount,
        },
        countText: {
          unfiltered: initial.countText,
          filtered: filtered.countText,
        },
        searchTarget: recordName,
        searchTransport,
        singleResult,
        tileHeight: { unfiltered: unfilteredHeight, filtered: target.height },
        screenshots,
      },
      null,
      2,
    )}\n`,
  );

  // Clear the probe search before the journey's own presentation continues.
  await clearEvidenceTrayQuery(initial.tileCount);

  await ensureCaseFileViewport();
  evidenceTrayGeometryGateDone = true;
  console.log(
    `[EvidenceTrayGate] 800x600 geometry passed (${initial.tileCount} records; hit ${filtered.tileCount}); viewport restored; PNG=${initialScreenshot},${hitScreenshot}; JSON=${metadataPath}`,
  );
}

/**
 * Searches the open SHOW/PRESENT tray for `recordName`, then clicks the
 * first enabled tile whose FULL record title (`button.record-tile .record-copy
 * strong`) matches exactly — never the whole tile text, so a source column
 * that merely contains the name can never win. Asserts the card sits on the
 * grid's first visible page (scrollTop 0, fully visible) before clicking.
 * One searched route serves both the SHOW and PRESENT trays.
 */
async function clickRecordTile(recordName: string): Promise<void> {
  await waitForEvidenceTraySearch();
  if (!evidenceTrayGeometryGateDone) {
    const state = await getPackagedGameState();
    const totalRecords = await evidenceTrayTileCount();
    if (
      state.scene.id === FINAL_HEARING_SCENE_ID &&
      totalRecords >= FINAL_HEARING_MIN_RECORDS
    ) {
      await runEvidenceTrayGeometryGate(recordName);
    }
  }
  await typeEvidenceTrayQuery(recordName);
  await browser.waitUntil(
    async () => {
      const found = await browser.execute((name: string) => {
        const tile = Array.from(
          document.querySelectorAll<HTMLButtonElement>("button.record-tile"),
        ).find(
          (candidate) =>
            !candidate.disabled &&
            (
              candidate.querySelector(".record-copy strong")?.textContent ?? ""
            ).trim() === name,
        );
        return tile !== undefined;
      }, recordName);
      return found;
    },
    {
      timeout: 15000,
      interval: 100,
      timeoutMsg: `enabled record tile ${recordName} did not appear in the searched tray`,
    },
  );
  const located = await browser.execute((name: string) => {
    const grid = document.querySelector<HTMLElement>(
      "[data-interrogation-evidence-grid]",
    );
    const tile = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button.record-tile"),
    ).find(
      (candidate) =>
        !candidate.disabled &&
        (
          candidate.querySelector(".record-copy strong")?.textContent ?? ""
        ).trim() === name,
    );
    if (!grid || !tile) return null;
    const gridBox = grid.getBoundingClientRect();
    const tileBox = tile.getBoundingClientRect();
    return {
      scrollTop: grid.scrollTop,
      grid: {
        left: gridBox.left,
        top: gridBox.top,
        right: gridBox.right,
        bottom: gridBox.bottom,
      },
      tile: {
        left: tileBox.left,
        top: tileBox.top,
        right: tileBox.right,
        bottom: tileBox.bottom,
      },
    };
  }, recordName);
  if (!located) {
    throw new Error(`record tile ${recordName} was not clickable`);
  }
  // The searched hit must be on the grid's first visible page: fully visible
  // with no scrolling (HPA-705 acceptance).
  expect(located.scrollTop).toBe(0);
  expect(located.tile.top).toBeGreaterThanOrEqual(
    located.grid.top - RECT_TOLERANCE_PX,
  );
  expect(located.tile.bottom).toBeLessThanOrEqual(
    located.grid.bottom + RECT_TOLERANCE_PX,
  );
  expect(located.tile.left).toBeGreaterThanOrEqual(
    located.grid.left - RECT_TOLERANCE_PX,
  );
  expect(located.tile.right).toBeLessThanOrEqual(
    located.grid.right + RECT_TOLERANCE_PX,
  );
  const clicked = await browser.execute((name: string) => {
    const tile = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button.record-tile"),
    ).find(
      (candidate) =>
        !candidate.disabled &&
        (
          candidate.querySelector(".record-copy strong")?.textContent ?? ""
        ).trim() === name,
    );
    if (!tile) return false;
    tile.click();
    return true;
  }, recordName);
  if (!clicked) {
    throw new Error(`record tile ${recordName} was not clickable`);
  }
}

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
  analysis_scene_13: {
    sightline_board: {
      kind: "classify",
      groupByCard: {
        crowd_on_plaza: "watched_the_wall",
        togawa_phone: "watched_the_wall",
        control_monitors: "watched_a_feed",
        platform_viewers: "watched_a_feed",
        saegusa_at_home: "watched_a_feed",
        rider_in_alley: "saw_the_box",
      },
    },
    footage_board: {
      kind: "classify",
      groupByCard: {
        composite_label: "program_feed",
        audio_routing: "program_feed",
        archive_rule: "program_feed",
        phone_dock: "stayed_in_box",
        silhouette_board: "stayed_in_box",
        raw_buffer: "raw_fragments",
        leaked_clip: "raw_fragments",
      },
    },
  },
  analysis_scene_15: {
    route_board: {
      kind: "order",
      cardIds: [
        "safety_spot",
        "logistics_board",
        "m03_door",
        "watch_ping",
        "elevator_b",
        "floor_traces",
      ],
    },
    return_board: {
      kind: "classify",
      groupByCard: {
        passcode_window: "closed_after_expiry",
        m03_after: "closed_after_expiry",
        elevator_after: "closed_after_expiry",
        fire_door: "still_open",
        logistics_exit: "still_open",
      },
    },
  },
  analysis_scene_18: {
    people_board: {
      kind: "classify",
      groupByCard: {
        sr2307_sender: "entry_and_control",
        process_channel: "entry_and_control",
        first_report: "entry_and_control",
        revenue_table: "wanted_to_leave",
        exit_message: "wanted_to_leave",
        accountant: "cannot_take_back",
        scheduled_statement: "cannot_take_back",
        saegusa_window: "saegusa_cannot_reach",
        saegusa_no_key: "saegusa_cannot_reach",
      },
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
  const character = current.characters.find(
    (candidate) => actionableTopic(state, candidate) !== undefined,
  );
  if (character) {
    const topic = actionableTopic(state, character);
    if (!topic) throw new Error("unreachable topic state");
    // Placed witnesses open a topic popover; layout-less witnesses render
    // their topic buttons directly in the 未放置證人 fallback list.
    if (character.layout !== null) {
      await clickButton(`詢問：${character.name}`);
    }
    if (topic.requiresPresent) {
      // A Present topic stays hidden until its record is shown.
      const record = heldPresentRecord(state, topic);
      if (!record) throw new Error("unreachable present state");
      await clickButton("出示紀錄");
      await waitForButton(record.name);
      await clickRecordTile(record.name);
      return;
    }
    await clickButton(topic.label);
    return;
  }
  // Current sublocation exhausted — travel to the next one with content.
  const next = scene.visibleSublocations.find((candidate) => {
    if (candidate.id === scene.currentSublocationId) return false;
    return (
      candidate.hotspots.some((h) => !h.inspected) ||
      candidate.characters.some((c) => actionableTopic(state, c) !== undefined)
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
  await clickRecordTile(evidence.name);
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
  let lastLoggedScene = "";
  for (let step = 0; step < ORGANIC_ROUTE_CAP; step += 1) {
    const state = await getPackagedGameState();
    if (stop(state)) return;
    // Surface drain progress in CI: log scene transitions and every 25 steps
    // so a timeout shows exactly where the route stalled instead of a silent
    // 15-minute gap. console.log reaches the WDIO job log (see [CaseFileE2E]
    // viewport log).
    const sceneTag = `${state.scene.id}/${state.mode.type}`;
    if (sceneTag !== lastLoggedScene) {
      console.log(
        `[ProductionJourney] drain step ${step}: ${sceneTag} (-> ${stopLabel})`,
      );
      lastLoggedScene = sceneTag;
    } else if (step % 25 === 0 && step > 0) {
      console.log(
        `[ProductionJourney] drain step ${step}: still ${sceneTag} (-> ${stopLabel})`,
      );
    }
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
        // drainDialogueFast uses DOM-only checks per advance (no IPC
        // round-trip) and only calls the predicate at mode transitions or
        // cross-exam entry, cutting per-advance overhead from ~5
        // browser.execute calls to ~1. Linear stretches can run past one
        // call's cap with no mode change (Chapter 2 opens with four linear
        // scenes), so a full cap returns here and the next iteration
        // re-checks the stop; ORGANIC_ROUTE_CAP still bounds the drain.
        await drainDialogueFast(
          async () => {
            const next = await getPackagedGameState();
            return (
              next.mode.type !== "dialogue" ||
              next.mode.crossExamLineId !== null ||
              stop(next)
            );
          },
          120,
          { throwOnCap: false },
        );
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
  it("plays the organic Chapter 1 route from the menu to its second-half city-map gate", async function () {
    this.timeout(1_200_000);
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
    console.log("[ProductionJourney] started from menu, draining P1 tutorial");

    const hotspot = `button[aria-label="${anchors.hotspotEvidence.label}"]`;
    await completeP1PracticeTutorial();
    await advanceDialogueUntil(
      () => elementExists(hotspot),
      DIALOGUE_DRAIN_CAP,
    );
    await waitForButton(anchors.hotspotEvidence.label, 90000);
    await collectKagamiSummaryEvidence();
    console.log("[ProductionJourney] collected kagami summary evidence");

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

    // The organic Chapter 1 route crosses each gate in authored order up to
    // the second half's gate; the next test plays on from there, because
    // one test for the whole chapter no longer fits the per-test WDIO
    // timeout (wdio.conf.ts).
    const { firstHalf, secondHalf } = chapter1Halves();
    const [stopGate] = secondHalf;
    if (!stopGate) throw new Error("Chapter 1 has no second-half gate");
    const crossedWrappers: string[] = [];
    await crossGate(anchors.mapGates[0], crossedWrappers);
    for (const gate of firstHalf.slice(1)) {
      await drainOrganicRoute(
        (state) => isPendingMapGate(state, gate.wrapper),
        `${gate.wrapper} pending city map`,
      );
      await crossGate(gate, crossedWrappers);
    }
    await drainOrganicRoute(
      (state) =>
        state.chapter.id === "chapter_1" &&
        isPendingMapGate(state, stopGate.wrapper),
      `chapter_1/${stopGate.wrapper} pending city map`,
    );
    expect(await enabledMapDestinationIds()).toEqual([stopGate.destination]);
    expect(crossedWrappers).toEqual(firstHalf.map((gate) => gate.wrapper));
  });

  it("plays Chapter 1 from its second-half city-map gate into Chapter 2", async function () {
    this.timeout(1_200_000);
    await resetE2eStorage();
    // Scene Select is production replay, unlocked by a story clear; seed it
    // so the run can start at the second half's travel wrapper. Scene Select
    // carries the skipped scenes' records, so the jump starts with what the
    // first half collected.
    await seedStoryCleared();
    await ensureCaseFileViewport();
    await startFromMenu();
    const { secondHalf } = chapter1Halves();
    const [startGate] = secondHalf;
    if (!startGate) throw new Error("Chapter 1 has no second-half gate");
    await jumpToProductionChapterScene("chapter_1", startGate.wrapper);
    await resumeUnclearedFromSave(
      (state) =>
        state.chapter.id === "chapter_1" &&
        isPendingMapGate(state, startGate.wrapper),
      `chapter_1/${startGate.wrapper}`,
      2,
      "第一章地圖存檔",
    );

    const crossedWrappers: string[] = [];
    await crossGate(startGate, crossedWrappers);
    for (const gate of secondHalf.slice(1)) {
      await drainOrganicRoute(
        (state) => isPendingMapGate(state, gate.wrapper),
        `${gate.wrapper} pending city map`,
      );
      await crossGate(gate, crossedWrappers);
    }

    // Past the final gate (scene_11_2), the route drains out of Chapter 1
    // into the authored Chapter 2 opening, which leaves the uncleared
    // profile uncleared. Chapter 2 plays in its own tests below (the
    // opening, then the gates legs).
    await drainOrganicRoute(
      (state) => state.chapter.id === "chapter_2",
      "Chapter 2 opening",
    );
    const cleared = await browser.execute(
      (key: string) => window.localStorage.getItem(key),
      STORY_CLEARED_STORAGE_KEY,
    );
    expect(cleared).toBeNull();

    // With the first half, all nine gates, in order, no extras (spec §11
    // Draft-exit evidence).
    expect(crossedWrappers).toEqual(secondHalf.map((gate) => gate.wrapper));
  });

  it("plays the Chapter 2 opening from scene_0 to its first city-map gate", async function () {
    this.timeout(1_200_000);
    await resetE2eStorage();
    // Scene Select is production replay, unlocked by a story clear; seed it
    // so the run can start at Chapter 2's first scene.
    await seedStoryCleared();
    await ensureCaseFileViewport();
    await startFromMenu();
    const opening = anchors.chapter2Opening;
    await jumpToProductionChapterScene(opening.chapter, opening.scene);

    // Beats 0-3 are four linear scenes in a row, longer than one
    // drainDialogueFast cap, so the drain must carry on past each cap until
    // scene_3 hands off to the first travel wrapper.
    const [firstGate] = anchors.chapter2MapGates;
    await drainOrganicRoute(
      (state) =>
        state.chapter.id === firstGate.chapter &&
        isPendingMapGate(state, firstGate.wrapper),
      `${firstGate.chapter}/${firstGate.wrapper} pending city map`,
    );
    expect((await getPackagedGameState()).chapter.id).toBe(firstGate.chapter);
    expect(await enabledMapDestinationIds()).toEqual([firstGate.destination]);
  });

  // One test per Chapter 2 gates leg before the last
  // (anchors.chapter2LegStartWrappers); the last leg's test below also proves
  // the story-cleared ending. Scene Select carries the skipped scenes' records,
  // so each jump starts its leg with what the earlier legs collected.
  for (const [index, leg] of chapter2GateLegs().slice(0, -1).entries()) {
    const [startGate] = leg.gates;
    const { stopGate } = leg;
    if (!startGate || !stopGate) {
      throw new Error(`Chapter 2 gates leg ${index} has no start or stop gate`);
    }
    it(`plays Chapter 2 from ${startGate.wrapper} to ${stopGate.wrapper}`, async function () {
      this.timeout(1_200_000);
      await resetE2eStorage();
      // Scene Select is production replay, unlocked by a story clear; seed it
      // so the run can start at this leg's travel wrapper.
      await seedStoryCleared();
      await ensureCaseFileViewport();
      await startFromMenu();
      await jumpToProductionChapterScene(startGate.chapter, startGate.wrapper);

      // Chapter 2's wrapper ids repeat Chapter 1's, so each stop also matches
      // the chapter.
      const crossedWrappers: string[] = [];
      await crossGate(startGate, crossedWrappers);
      await crossLaterGates(leg, crossedWrappers);
      await stopAtNextLeg(leg, crossedWrappers);
    });
  }

  it("plays Chapter 2 from its last gates leg to the story-cleared end card", async function () {
    this.timeout(1_200_000);
    await resetE2eStorage();
    // Scene Select is production replay, unlocked by a story clear; seed it
    // so the run can start at the last leg's travel wrapper.
    await seedStoryCleared();
    await ensureCaseFileViewport();
    await startFromMenu();
    const legs = chapter2GateLegs();
    const leg = legs[legs.length - 1];
    const startGate = leg?.gates[0];
    if (!leg || !startGate) throw new Error("Chapter 2 has no last gates leg");
    await jumpToProductionChapterScene(startGate.chapter, startGate.wrapper);

    // To prove finishing Chapter 2 clears a fresh profile's story, play this
    // leg from a save with the seeded clear forgotten.
    await resumeUnclearedFromSave(
      (state) =>
        state.chapter.id === startGate.chapter &&
        isPendingMapGate(state, startGate.wrapper),
      `${startGate.chapter}/${startGate.wrapper}`,
      1,
      "第二章地圖存檔",
    );

    const crossedWrappers: string[] = [];
    await crossGate(startGate, crossedWrappers);
    await crossLaterGates(leg, crossedWrappers);

    // Chapter 2 is complete (no `**Status:** in-progress`), so exhausting it
    // clears the story: the 案件結案 end card renders, not 未完待續, and the
    // forgotten clear is written back.
    await drainOrganicRoute(
      (state) => state.mode.type === "gameComplete",
      "end of Chapter 2",
    );
    const finalState = await getPackagedGameState();
    expect(finalState.chapter.id).toBe("chapter_2");
    expect(finalState.mode).toEqual({
      type: "gameComplete",
      storyCleared: true,
    });
    expect(await elementExists(".complete")).toBe(true);
    expect(await elementExists(".complete.continued")).toBe(false);
    const cleared = await browser.execute(
      (key: string) => window.localStorage.getItem(key),
      STORY_CLEARED_STORAGE_KEY,
    );
    expect(cleared).toBe("true");
    expect(crossedWrappers).toEqual(leg.gates.map((gate) => gate.wrapper));
    // HPA-705: the 800x600 tray gate must have actually executed at the
    // final hearing's ≥74-record tray — a shorter inventory must fail here,
    // never silently skip the geometry proof.
    expect(evidenceTrayGeometryGateDone).toBe(true);
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
