import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  acknowledgeAcquisitionDomFirst,
  acquisitionCompositorReceipts,
  advanceDialogueUntil,
  assertInspectedImage,
  assertScreenshotRegionPainted,
  assertSafeXvfbDisplay,
  captureImageFailureDiagnostics,
  clickButton,
  clickSoleMapDestination,
  closePersistenceBrowserToGameplay,
  collectKagamiSummaryEvidence,
  completeP1PracticeTutorial,
  drainDialogueFast,
  e2eXvfbTrustedKeysEnabled,
  elementExists,
  enabledMapDestinationIds,
  ensureCaseFileViewport,
  ensureMinimumWindowViewport,
  forgetStoryCleared,
  formatImageInspection,
  getPackagedGameState,
  inspectImageElement,
  jsClickButtonContaining,
  jumpToProductionChapterScene,
  jumpToProductionScene,
  lastVisibleDialogueText,
  loadTitleSlot,
  MINIMUM_WINDOW,
  observedCssViewport,
  openGameMenu,
  releaseImageElementPin,
  resetE2eStorage,
  returnToTitle,
  saveManualSlot,
  seedStoryCleared,
  sendXvfbTrustedKey,
  setAcquisitionCompositorGate,
  startFromMenu,
  waitForButton,
  waitForNoDialog,
  waitForPackagedGameState,
} from "./helpers";
import { publicPathForAssetId } from "@lyra/asset-paths";
import {
  anchors,
  DIALOGUE_DRAIN_CAP,
  EXPECTED_FOCUS_CONTROL_SELECTOR,
  STORY_CLEARED_STORAGE_KEY,
} from "./production-anchors";
import {
  type EvidenceTraySearchState,
  evidenceTraySearchExactQueryRendered,
  evidenceTraySearchFilterApplied,
  evidenceTraySearchProbeObserved,
} from "../src/lib/e2e/evidence-tray-search-verify";
import {
  checkPortraitCapture,
  type PortraitCaptureExpectation,
  type RenderedPortraitSnapshot,
} from "../src/lib/e2e/portrait-capture-gate";
import { missingCompositorReceipts } from "../src/lib/e2e/acquisition-compositor-gate";
import {
  runCaseFileRecordGate,
  runImageEvidenceProof,
  withImageFailureEvidence,
} from "../src/lib/e2e/image-evidence-proof";
import {
  drainEnterToMap,
  renderedItemSurface,
} from "../src/lib/e2e/journey-enter-drain";
import {
  checkFocusOwner,
  checkTrustedEnterDelivery,
  evidenceArtifactLanded,
  focusOutlineViolations,
  focusProbeEvidenceMissing,
  installFocusTrajectoryScript,
  installKeyDeliveryRecorderScript,
  probeFocusStateDom,
  probeKeyboardFocusTargetDom,
  readFocusTrajectoryScript,
  readKeyDeliveryEventsScript,
  type FocusOwnerRequirement,
  type FocusProbeSnapshot,
} from "../src/lib/e2e/focus-probe";
import {
  filterPresentableRecords,
  presentableRecords,
} from "$lib/interrogation/presentation";
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

/**
 * Screenshots are PR artifacts: CI uploads all of apps/game/e2e-artifacts/.
 * The runner hands each phase+attempt a run-scoped LYRA_E2E_OUTPUT_DIR
 * (runs/<runId>/outputs/attempt-N/<root>/<phase>, still under
 * e2e-artifacts) — a flat attempt-N directory would collide across separate
 * runner invocations and overwrite the previous run's evidence. Manual
 * runs without the runner keep the original directory name.
 */
const EVIDENCE_TRAY_SCREENSHOT_DIR =
  process.env.LYRA_E2E_OUTPUT_DIR ??
  path.join(
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
  firstRowTitles: Array<{
    text: string;
    rect: BoxRect;
    tileRect: BoxRect;
    /** True when the title's scroll box exceeds its client box — the line
     * clamp/ellipsis signature a clean getBoundingClientRect cannot show. */
    clipped: boolean;
  }>;
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
  `input[aria-label="${anchors.evidenceTray.searchLabel}"]`;

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
 * The compact tray pins its height, so filtering must not move or resize
 * it: every side of the current tray rect stays within tolerance of the
 * unfiltered reference. Applied to the primary search AND the single-result
 * probe.
 */
function expectTrayStable(current: BoxRect, reference: BoxRect): void {
  expect(Math.abs(current.top - reference.top)).toBeLessThanOrEqual(
    RECT_TOLERANCE_PX,
  );
  expect(Math.abs(current.left - reference.left)).toBeLessThanOrEqual(
    RECT_TOLERANCE_PX,
  );
  expect(Math.abs(current.width - reference.width)).toBeLessThanOrEqual(
    RECT_TOLERANCE_PX,
  );
  expect(Math.abs(current.height - reference.height)).toBeLessThanOrEqual(
    RECT_TOLERANCE_PX,
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
    (
      target: string,
      searchSelector: string,
      sel: typeof anchors.evidenceTray,
    ): EvidenceTraySnapshot => {
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
      const tray = document.querySelector<HTMLElement>(sel.root);
      const grid = document.querySelector<HTMLElement>(sel.grid);
      const tiles = Array.from(
        document.querySelectorAll<HTMLButtonElement>(sel.tile),
      );
      const strongOf = (tile: HTMLButtonElement): string =>
        (tile.querySelector(sel.tileTitle)?.textContent ?? "").trim();
      const targetMatches = tiles.filter((tile) => strongOf(tile) === target);
      const targetBox = targetMatches[0]?.getBoundingClientRect();
      const firstTile = tiles.length > 0 ? tiles[0] : null;
      const firstVisual = firstTile?.querySelector(sel.visual);
      // First ROW, not just the first tile: a longer title in any other
      // column can clip or overlap without the first tile ever showing it.
      const firstRowTop = firstTile?.getBoundingClientRect().top ?? null;
      const firstRowTolerancePx = 2;
      const strongEntryOf = (tile: HTMLButtonElement) => {
        const strong = tile.querySelector(sel.tileTitle);
        if (!strong) return null;
        return {
          text: (strong.textContent ?? "").trim(),
          rect: boxRect(strong.getBoundingClientRect()),
          tileRect: boxRect(tile.getBoundingClientRect()),
          clipped:
            strong.scrollWidth > strong.clientWidth + firstRowTolerancePx ||
            strong.scrollHeight > strong.clientHeight + firstRowTolerancePx,
        };
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
                (
                  entry,
                ): entry is NonNullable<ReturnType<typeof strongEntryOf>> =>
                  entry !== null,
              );
      const header = tray?.querySelector(sel.header) ?? null;
      const eyebrow = header?.querySelector(sel.eyebrow) ?? null;
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
        lineRecord: rectOf(tray?.querySelector(sel.lineRecord) ?? null),
        grid: rectOf(grid),
        gridClientWidth: grid?.clientWidth ?? 0,
        gridScrollWidth: grid?.scrollWidth ?? 0,
        gridScrollTop: grid?.scrollTop ?? 0,
        detail: rectOf(tray?.querySelector(sel.detail) ?? null),
        footer: rectOf(tray?.querySelector(sel.footer) ?? null),
        withdrawButton: rectOf(tray?.querySelector(sel.withdraw) ?? null),
        firstRowTitles,
        firstTileVisualHeight: firstVisual
          ? firstVisual.getBoundingClientRect().height
          : null,
        tileCount: tiles.length,
        countText: (
          tray?.querySelector(sel.countText)?.textContent ?? ""
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
    anchors.evidenceTray,
  );
}

/**
 * The 800x600 compact-tray geometry assertions (HPA-705 task 4): every
 * section present, visible and inside the viewport/tray, the five rows never
 * mutually overlapping, the compact media query provably active (48px
 * thumbnails, hidden eyebrow), header allowed to wrap without horizontal
 * squeeze-out and with its own controls (heading/progress, search input,
 * count, ESC) contained, non-overlapping and measured on exactly ONE natural
 * flex line, grid not clipping horizontally,
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
  const grid = requireRect(snapshot.grid, "grid");
  const rows: Array<[string, BoxRect]> = [
    ["header", header],
    ["line record", requireRect(snapshot.lineRecord, "line record")],
    ["grid", grid],
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
  // The natural header row count is NOT asserted: any count passes as long
  // as the items stay contained and pairwise non-overlapping (above); wrap
  // capability itself is proven by probeEvidenceTrayHeaderWrap.
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
  // neighbour while the first tile stays clean. Each title must sit inside
  // ITS OWN tile — within-grid alone still permits a title bleeding into a
  // neighbour — and its scroll box must not exceed its client box, the
  // signature of a line clamp hiding text behind a clean rect.
  const firstRowTitles = snapshot.firstRowTitles;
  if (firstRowTitles.length === 0) {
    throw fail("first-row tile titles missing");
  }
  for (const entry of firstRowTitles) {
    if (entry.text === "") {
      throw fail("first-row tile title is empty");
    }
    if (entry.rect.width <= 0 || entry.rect.height <= 0) {
      throw fail(`first-row title "${entry.text}" has an empty rect`);
    }
    expectRectWithin(entry.rect, entry.tileRect);
    // Within-tile alone still permits a title hanging below the grid's
    // visible edge — the scrollable grid clips it while every per-tile
    // check passes.
    expectRectWithin(entry.rect, grid);
    if (entry.clipped) {
      throw fail(`first-row title "${entry.text}" is clipped`);
    }
  }
}

/** Result of the in-page header wrap-capability probe. */
type EvidenceTrayHeaderWrapProbe = {
  naturalRows: number;
  clampedRows: number;
  clampedScrollWidth: number;
  clampedClientWidth: number;
  clampedHeader: BoxRect | null;
  clampedChildren: Array<{ label: string; rect: BoxRect }>;
  restoredRows: number;
};

/**
 * The required flex-wrap behaviour is proven as a CAPABILITY: clamp the
 * header's inline max-width below its measured single-line requirement —
 * the sum of item widths plus column gaps, NOT the laid-out left/right span
 * (justify-content: space-between spreads items across the full row). The
 * flex line must then break into ≥2
 * measured rows without overflowing. One atomic browser.execute clamps,
 * measures, removes the inline style and re-measures, so the style can never
 * leak into the rest of the journey — even if an assertion on the returned
 * data fails afterwards.
 */
async function probeEvidenceTrayHeaderWrap(): Promise<EvidenceTrayHeaderWrapProbe | null> {
  return browser.execute((sel: typeof anchors.evidenceTray) => {
    const header = document.querySelector<HTMLElement>(
      `${sel.root} ${sel.header}`,
    );
    if (!header) return null;
    const visibleChildren = () =>
      Array.from(header.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          getComputedStyle(child).display !== "none",
      );
    const rowCount = (children: HTMLElement[]): number => {
      const rows: number[] = [];
      for (const child of children) {
        const rect = child.getBoundingClientRect();
        const center = (rect.top + rect.bottom) / 2;
        if (!rows.some((seen) => Math.abs(seen - center) <= 2)) {
          rows.push(center);
        }
      }
      return rows.length;
    };
    const rectOf = (element: Element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const labelOf = (child: HTMLElement): string =>
      child.tagName.toLowerCase() +
      (child.classList.length > 0 ? `.${String(child.classList[0])}` : "");
    const children = visibleChildren();
    const naturalRows = rowCount(children);
    const columnGap = parseFloat(getComputedStyle(header).columnGap) || 0;
    const requiredSingleLineWidth =
      children.reduce(
        (sum, child) => sum + child.getBoundingClientRect().width,
        0,
      ) +
      columnGap * Math.max(0, children.length - 1);
    header.style.maxWidth = `${Math.max(requiredSingleLineWidth - 24, 0)}px`;
    void header.offsetHeight; // force the clamped reflow before measuring
    const clampedChildren = visibleChildren().map((child) => ({
      label: labelOf(child),
      rect: rectOf(child),
    }));
    const clamped = {
      naturalRows,
      clampedRows: rowCount(visibleChildren()),
      clampedScrollWidth: header.scrollWidth,
      clampedClientWidth: header.clientWidth,
      clampedHeader: rectOf(header),
      clampedChildren,
    };
    header.style.maxWidth = "";
    void header.offsetHeight; // force the restored reflow before measuring
    return { ...clamped, restoredRows: rowCount(visibleChildren()) };
  }, anchors.evidenceTray);
}

/**
 * Asserts the wrap-capability probe: clamped below its single-line
 * requirement, the header breaks into at least two measured flex rows
 * WITHOUT horizontal squeeze-out, its items stay contained and pairwise
 * non-overlapping on every line, and removing the clamp restores the
 * original natural row count.
 */
function expectEvidenceTrayHeaderWraps(
  probe: EvidenceTrayHeaderWrapProbe,
  label: string,
): void {
  const fail = (message: string): Error =>
    new Error(`evidence tray 800x600 wrap probe (${label}): ${message}`);

  expect(probe.clampedRows).toBeGreaterThanOrEqual(2);
  expect(probe.clampedScrollWidth).toBeLessThanOrEqual(
    probe.clampedClientWidth + RECT_TOLERANCE_PX,
  );
  const clampedHeader = requireRect(probe.clampedHeader, "clamped header");
  if (probe.clampedChildren.length === 0) {
    throw fail("clamped header has no measurable visible children");
  }
  for (const { label: childName, rect: childRect } of probe.clampedChildren) {
    if (childRect.width <= 0 || childRect.height <= 0) {
      throw fail(`clamped header child ${childName} has an empty rect`);
    }
    expectRectWithin(childRect, clampedHeader);
  }
  for (let i = 0; i < probe.clampedChildren.length; i += 1) {
    for (let j = i + 1; j < probe.clampedChildren.length; j += 1) {
      const a = probe.clampedChildren[i];
      const b = probe.clampedChildren[j];
      if (rectsOverlap(a.rect, b.rect)) {
        throw fail(`clamped header child ${a.label} overlaps ${b.label}`);
      }
    }
  }
  expect(probe.restoredRows).toBe(probe.naturalRows);
}

/** The number of record tiles currently rendered in the open tray. */
async function evidenceTrayTileCount(): Promise<number> {
  return browser.execute(
    (tileSelector: string) =>
      document.querySelectorAll<HTMLButtonElement>(tileSelector).length,
    anchors.evidenceTray.tile,
  );
}

/**
 * In-page snapshot of the open tray's search state, fed to the pure
 * verification helpers in `src/lib/e2e/evidence-tray-search-verify.ts`:
 * input value, trimmed record-count text, rendered tile count, and whether
 * a tile whose full title equals `name` is rendered. `null` = the search
 * input is missing (tray not open); every helper then rejects.
 */
async function readEvidenceTraySearchState(
  name: string,
): Promise<EvidenceTraySearchState | null> {
  return browser.execute(
    (
      searchSelector: string,
      target: string,
      sel: typeof anchors.evidenceTray,
    ): EvidenceTraySearchState | null => {
      const input = document.querySelector<HTMLInputElement>(searchSelector);
      const countText = (
        document.querySelector(`${sel.root} ${sel.countText}`)?.textContent ??
        ""
      ).trim();
      const tiles = Array.from(
        document.querySelectorAll<HTMLButtonElement>(sel.tile),
      );
      return {
        value: input?.value ?? null,
        countText,
        tileCount: tiles.length,
        titles: tiles.map((tile) =>
          (tile.querySelector(sel.tileTitle)?.textContent ?? "").trim(),
        ),
        targetRendered: tiles.some(
          (candidate) =>
            (
              candidate.querySelector(sel.tileTitle)?.textContent ?? ""
            ).trim() === target,
        ),
      };
    },
    evidenceTraySearchSelector(),
    name,
    anchors.evidenceTray,
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
 * Probe suffixes for the fallback's liveness proof: NFKC-stable symbols that
 * match no record field. Each probe attempt must EMPTY the grid to count as
 * observed (evidenceTraySearchProbeObserved), so an accidentally matching
 * suffix is rejected and the next one tried — never silently accepted.
 */
const EVIDENCE_TRAY_PROBE_SUFFIXES = ["☂", "♪"];

/**
 * Types `query` into the open tray's search input and verifies the Svelte
 * filter really applied before crediting the transport.
 *
 * WebDriver `setValue` — real key events through tauri-plugin-wdio/WebKit —
 * is tried first under STRICT verification (evidenceTraySearchFilterApplied):
 * the COMPLETE value, a record-count text that has LEFT the pre-search
 * baseline, and the exact full-title tile. The tile alone proves nothing (it
 * already exists in the unfiltered tray), and neither does an unchanged
 * count — the unfiltered baseline is itself an "顯示 N / N" text, which is
 * exactly what a no-op setValue (value filled, Svelte input event dropped)
 * looks like.
 *
 * A query that matches EVERY record legitimately returns the count to the
 * baseline, where the DOM alone cannot distinguish it from a dropped update.
 * The fallback therefore proves liveness FIRST: via the repo-standard
 * `input.value` + `input` event dispatch, a probe value (query + a no-match
 * suffix) must move the count and empty the grid; only then is the exact
 * query accepted (evidenceTraySearchExactQueryRendered) — its count may
 * lawfully sit back on the baseline, because the probe transition proved the
 * binding processes this input's events. If even the synthetic events cannot
 * move the count, the search binding is broken and the helper fails loudly
 * instead of crediting a dead transport. The chosen transport is logged so
 * CJK input reliability stays traceable.
 */
async function typeEvidenceTrayQuery(
  query: string,
): Promise<EvidenceTraySearchTransport> {
  const selector = evidenceTraySearchSelector();
  const baselineCountText = await browser.execute(
    (countSelector: string) =>
      (document.querySelector(countSelector)?.textContent ?? "").trim(),
    `${anchors.evidenceTray.root} ${anchors.evidenceTray.countText}`,
  );
  // The tile set the COMPLETE query must render: the same pure filter the
  // tray binds, over the live inventory. Without it, a trailing keystroke
  // the browser applied but whose input event never reached Svelte would
  // pass verification under a prefix-filtered grid.
  const trayState = await getPackagedGameState();
  const expectedTitles = filterPresentableRecords(
    presentableRecords(trayState.inventory),
    query,
  ).map((record) => record.shortName.trim());
  const filterApplied = async () =>
    evidenceTraySearchFilterApplied(
      await readEvidenceTraySearchState(query),
      query,
      baselineCountText,
      expectedTitles,
    );

  let transport: EvidenceTraySearchTransport = "setValue";
  try {
    const input = await browser.$(selector);
    await input.setValue(query);
    await browser.waitUntil(filterApplied, {
      timeout: 5000,
      interval: 100,
      timeoutMsg:
        "evidence tray search via setValue did not update the record list",
    });
  } catch {
    transport = "valueAndInputEvent";
    const syntheticSet = (value: string) =>
      browser.execute(
        (inputSelector: string, next: string) => {
          const input = document.querySelector<HTMLInputElement>(inputSelector);
          if (!input) return false;
          input.value = next;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        },
        selector,
        value,
      );
    let probeApplied = false;
    for (const suffix of EVIDENCE_TRAY_PROBE_SUFFIXES) {
      const probeValue = query + suffix;
      if (!(await syntheticSet(probeValue))) {
        throw new Error("evidence tray search input is missing");
      }
      try {
        await browser.waitUntil(
          async () =>
            evidenceTraySearchProbeObserved(
              await readEvidenceTraySearchState(query),
              probeValue,
              baselineCountText,
            ),
          { timeout: 2000, interval: 100 },
        );
        probeApplied = true;
        break;
      } catch {
        // No liveness proof for this suffix (dead binding, or the suffix
        // matched records — probeObserved rejects both). Try the next one.
      }
    }
    if (!probeApplied) {
      throw new Error(
        "evidence tray search binding did not respond to synthetic input events; suspected WebKit input failure left no working fallback",
      );
    }
    if (!(await syntheticSet(query))) {
      throw new Error("evidence tray search input is missing");
    }
    await browser.waitUntil(
      async () =>
        evidenceTraySearchExactQueryRendered(
          await readEvidenceTraySearchState(query),
          query,
          expectedTitles,
        ),
      {
        timeout: 5000,
        interval: 100,
        timeoutMsg:
          "evidence tray search did not render the exact query result after the liveness probe",
      },
    );
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
  /** Fresh post-probe geometry so the lone result gets the same
   * containment/stability assertions as the primary search path. */
  grid: BoxRect;
  tray: BoxRect;
};

/**
 * Applies each pre-filtered candidate title through the tray's own
 * input-event path and snapshots the lone result's geometry (tile, grid,
 * tray) after the query settles. Candidates arrive already filtered by the
 * spec to titles whose full query isolates exactly one record across the
 * tray's searchable fields, so the first candidate normally wins — the
 * retry loop only absorbs DOM-level surprises. Probe queries go through
 * the tray's own input-event path: the real CJK setValue verification
 * already happened on the primary search, and probes only need
 * deterministic filter results for the 1-result geometry proof.
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
    const lone = await browser.execute((sel: typeof anchors.evidenceTray) => {
      const boxRect = (box: DOMRect) => ({
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      });
      const grid = document.querySelector<HTMLElement>(sel.grid);
      const tray = document.querySelector<HTMLElement>(sel.root);
      const tile = document.querySelector<HTMLButtonElement>(sel.tile);
      const strong = tile?.querySelector(sel.tileTitle);
      if (!grid || !tray || !tile || !strong) return null;
      const tileBox = tile.getBoundingClientRect();
      return {
        strong: (strong.textContent ?? "").trim(),
        rect: boxRect(tileBox),
        height: tileBox.height,
        grid: boxRect(grid.getBoundingClientRect()),
        tray: boxRect(tray.getBoundingClientRect()),
      };
    }, anchors.evidenceTray);
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
  // Everything from the 800x600 resize onward runs under a viewport-restore
  // guarantee: a resize that throws after changing the window, a failed
  // setup step or a failed assertion must not leave the window at 800x600
  // for the rest of this browser session — later journey legs do not reset
  // it. When the gate itself throws, its exception propagates through the
  // finally and the restore error is only logged; when the gate passes,
  // a restore failure becomes the reported error.
  let restoreError: unknown;
  try {
    await ensureMinimumWindowViewport();
    const viewport = await observedCssViewport();
    expect(viewport.width).toBe(800); // the compact gate, NOT the 1280x720 case-file viewport
    expect(viewport.height).toBe(600);
    mkdirSync(EVIDENCE_TRAY_SCREENSHOT_DIR, { recursive: true });
    await runEvidenceTrayGeometryChecks(recordName, viewport);
  } finally {
    try {
      await ensureCaseFileViewport();
    } catch (error) {
      restoreError = error;
      console.error(
        "[EvidenceTrayGate] case-file viewport restore failed:",
        error,
      );
    }
  }
  if (restoreError !== undefined) throw restoreError;
  evidenceTrayGeometryGateDone = true;
}

/** The gate's checks, run inside runEvidenceTrayGeometryGate's restore
 * guarantee after the window has already shrunk to 800x600. */
async function runEvidenceTrayGeometryChecks(
  recordName: string,
  viewport: { width: number; height: number },
): Promise<void> {
  // Single-result probe candidates must come from the UNFILTERED board:
  // after the primary search only the (few) matching titles remain. Every
  // rendered title is considered — not a positional prefix — and only
  // titles whose full query provably isolates one record across the
  // tray's searchable fields (the same filter the tray binds) are kept,
  // so the probe verifies a deterministic candidate instead of burning
  // timeouts on guesses. Each candidate remembers its own unfiltered
  // tile height for the later like-for-like no-stretch comparison.
  const gateTrayState = await getPackagedGameState();
  const gateTrayRecords = presentableRecords(gateTrayState.inventory);
  const probeCandidates = (
    await browser.execute(
      (sel: typeof anchors.evidenceTray) =>
        Array.from(document.querySelectorAll<HTMLButtonElement>(sel.tile)).map(
          (tile) => ({
            title: tile.querySelector(sel.tileTitle)?.textContent?.trim() ?? "",
            unfilteredHeight: tile.getBoundingClientRect().height,
          }),
        ),
      anchors.evidenceTray,
    )
  ).filter(
    (candidate) =>
      candidate.title !== "" &&
      filterPresentableRecords(gateTrayRecords, candidate.title).length === 1,
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

  // Wrap capability (review round 2): the natural compact header is not
  // required to stay on one line (a fully contained multi-row header also
  // satisfies the brief), so the explicit wrap requirement is proven by
  // clamping the header's inline width in-page: it must break into ≥2 flex
  // rows without overflowing, then restore its original row count. No
  // window resize, no production layout change, no style leakage (atomic
  // single execute).
  const wrapProbe = await probeEvidenceTrayHeaderWrap();
  if (!wrapProbe) {
    throw new Error("evidence tray 800x600 wrap probe: tray header not found");
  }
  expectEvidenceTrayHeaderWraps(
    wrapProbe,
    `initial tray (${initial.tileCount} records)`,
  );
  console.log(
    `[EvidenceTrayGate] header wrap probe: natural ${wrapProbe.naturalRows} rows, clamped ${wrapProbe.clampedRows} rows`,
  );

  // Real-name search at 800x600: the hit stays on the first visible page and
  // keeps its natural height — the row must not stretch to the grid track
  // when only a few results remain (align-content: start).
  const searchTransport = await typeEvidenceTrayQuery(recordName);
  const filtered = await measureEvidenceTray(recordName);
  expect(filtered.searchValue).toBe(recordName);
  expect(filtered.tileCount).toBeGreaterThanOrEqual(1);
  expect(filtered.tileCount).toBeLessThan(initial.tileCount);
  expectEvidenceTrayCompactGeometry(filtered, `search "${recordName}"`);

  // Stable centered tray (final-review fix): filtering shrinks the grid
  // contents, and a content-sized centered tray would shrink and re-center
  // with it (measured header top y≈60 → y≈130 before the fix), dragging the
  // search input out from under the typing/IME focus. The compact tray pins
  // its height, so the whole rect — and the header with it — must stay put.
  const initialTray = requireRect(initial.tray, "initial tray");
  const filteredTray = requireRect(
    filtered.tray,
    `search "${recordName}" tray`,
  );
  expectTrayStable(filteredTray, initialTray);
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
    // The compact tray keeps its pinned height at 800x600 and align-content:
    // start leaves the leftover grid space empty, so "not stretched" is
    // exactly the natural-height bound asserted above; the lone result also
    // keeps its first-page placement (clickRecordTile).
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
    // The lone result gets the primary path's containment and stable-tray
    // guarantees too — a probe tile outside the grid, or a tray that moved
    // when the board collapsed to one tile, must not pass.
    expectRectWithin(probe.rect, probe.grid);
    expectTrayStable(probe.tray, initialTray);
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
        headerRows: {
          natural: wrapProbe.naturalRows,
          clamped: wrapProbe.clampedRows,
        },
        singleResult,
        tileHeight: { unfiltered: unfilteredHeight, filtered: target.height },
        trayRect: { unfiltered: initialTray, filtered: filteredTray },
        screenshots,
      },
      null,
      2,
    )}\n`,
  );

  // Clear the probe search before the journey's own presentation continues.
  await clearEvidenceTrayQuery(initial.tileCount);

  console.log(
    `[EvidenceTrayGate] 800x600 geometry passed (${initial.tileCount} records; hit ${filtered.tileCount}); PNG=${initialScreenshot},${hitScreenshot}; JSON=${metadataPath}`,
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
      const found = await browser.execute(
        (name: string, sel: typeof anchors.evidenceTray) => {
          const tile = Array.from(
            document.querySelectorAll<HTMLButtonElement>(sel.tile),
          ).find(
            (candidate) =>
              !candidate.disabled &&
              (
                candidate.querySelector(sel.tileTitle)?.textContent ?? ""
              ).trim() === name,
          );
          return tile !== undefined;
        },
        recordName,
        anchors.evidenceTray,
      );
      return found;
    },
    {
      timeout: 15000,
      interval: 100,
      timeoutMsg: `enabled record tile ${recordName} did not appear in the searched tray`,
    },
  );
  const located = await browser.execute(
    (name: string, sel: typeof anchors.evidenceTray) => {
      const grid = document.querySelector<HTMLElement>(sel.grid);
      const tile = Array.from(
        document.querySelectorAll<HTMLButtonElement>(sel.tile),
      ).find(
        (candidate) =>
          !candidate.disabled &&
          (candidate.querySelector(sel.tileTitle)?.textContent ?? "").trim() ===
            name,
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
    },
    recordName,
    anchors.evidenceTray,
  );
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
  const clicked = await browser.execute(
    (name: string, sel: typeof anchors.evidenceTray) => {
      const tile = Array.from(
        document.querySelectorAll<HTMLButtonElement>(sel.tile),
      ).find(
        (candidate) =>
          !candidate.disabled &&
          (candidate.querySelector(sel.tileTitle)?.textContent ?? "").trim() ===
            name,
      );
      if (!tile) return false;
      tile.click();
      return true;
    },
    recordName,
    anchors.evidenceTray,
  );
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

/**
 * Task 5 representative screenshots, captured only on the scenes the organic
 * route already visits: same-run packed WebView images for the acceptance
 * record. These are evidence captures, not per-scene checkpoints; a screenshot
 * is never an assertion.
 */
const REPRESENTATIVE_SCENE_ARTIFACT_DIR =
  process.env.LYRA_E2E_OUTPUT_DIR ??
  path.join(
    process.cwd(),
    "e2e-artifacts",
    "save-e2e",
    "hpa852-representative-scenes",
  );

const representativeSceneIds = new Set([
  "chapter_1/investigation_scene_7",
  "chapter_1/investigation_scene_8",
  "chapter_1/investigation_scene_9",
  "chapter_2/investigation_scene_4",
  "chapter_1/interrogation_scene_4",
  "chapter_2/interrogation_scene_6",
  "chapter_1/interrogation_scene_10",
  "chapter_2/interrogation_scene_19",
]);

const capturedRepresentativeScenes = new Set<string>();

async function captureRepresentativeScene(
  state: GameStateView,
  details: Record<string, unknown> = {},
): Promise<void> {
  const key = `${state.chapter.id}/${state.scene.id}`;
  if (
    !representativeSceneIds.has(key) ||
    capturedRepresentativeScenes.has(key)
  ) {
    return;
  }
  capturedRepresentativeScenes.add(key);
  mkdirSync(REPRESENTATIVE_SCENE_ARTIFACT_DIR, { recursive: true });
  // Best-effort settle for art/portrait decode: a slow image must not turn a
  // representative capture into a route failure.
  try {
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const background = document.querySelector<HTMLImageElement>(
            "img.background-image.visible",
          );
          const portrait = document.querySelector<HTMLImageElement>(
            "img.interrogation-subject-portrait",
          );
          const backgroundReady =
            !background || (background.complete && background.naturalWidth > 0);
          const portraitReady =
            !portrait || (portrait.complete && portrait.naturalWidth > 0);
          return backgroundReady && portraitReady;
        }),
      { timeout: 5000, interval: 100 },
    );
  } catch {
    // Keep the capture even if an optional image is still decoding.
  }
  const slug = key.replace(/\//g, "-");
  const screenshotPath = path.join(
    REPRESENTATIVE_SCENE_ARTIFACT_DIR,
    `scene-${slug}.png`,
  );
  await browser.saveScreenshot(screenshotPath);
  const page = await browser.execute(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const chips = document.querySelector(".explore-hud .chips");
    return {
      viewport: { width: innerWidth, height: innerHeight },
      sceneTag: (
        document.querySelector(".stamp .label") ??
        document.querySelector(".scene-label strong")
      )?.textContent?.trim(),
      stage: rect(".scene-stage"),
      chips: chips
        ? {
            count: chips.querySelectorAll("button").length,
            tops: Array.from(
              chips.querySelectorAll("button"),
              (button) => button.getBoundingClientRect().top,
            ),
            clientWidth: chips.clientWidth,
            scrollWidth: chips.scrollWidth,
          }
        : null,
      subject: document
        .querySelector(".subject-record h2")
        ?.textContent?.trim(),
      dialogue: document.querySelector(".box")?.textContent?.trim(),
    };
  });
  writeFileSync(
    screenshotPath.replace(/\.png$/, ".json"),
    `${JSON.stringify(
      { scene: key, mode: state.mode.type, ...details, ...page },
      null,
      2,
    )}\n`,
  );
  console.log(`[Task5] representative screenshot: ${screenshotPath}`);
}

/**
 * Fix-round compact hearing evidence: captured from the organic production
 * route at the real 800x600 minimum, then the usual case-file viewport is
 * restored for the rest of the journey. No checkpoint or fixture is added.
 */
const compactEvidence = {
  kamiya: false,
  saegusa: false,
  saegusaScans: 0,
};

type CompactInterrogationEvidence = {
  viewport: { width: number; height: number };
  subject: string | null;
  stage: ArtifactRect | null;
  leftStack: ArtifactRect | null;
  toolbar: ArtifactRect | null;
  subjectArt: ArtifactRect | null;
  questionRecord: ArtifactRect | null;
  dialogueFrame: ArtifactRect | null;
  portrait: {
    rect: ArtifactRect | null;
    complete: boolean;
    naturalWidth: number;
    naturalHeight: number;
    src: string | null;
  } | null;
  dialogue: string | null;
};

type PortraitGateSnapshot = {
  stage: boolean;
  portrait: RenderedPortraitSnapshot | null;
  dialogueText: string | null;
};

/**
 * Waits until the actual visible crossfade portrait decodes to the expected
 * character asset and, for a spoken line, the authored dialogue text is
 * already rendered. A merely decoded / wrong character / placeholder portrait
 * is rejected before the screenshot is taken.
 */
async function waitForExpectedPortrait(
  expectation: PortraitCaptureExpectation,
): Promise<PortraitGateSnapshot> {
  const deadline = Date.now() + 15000;
  let last: PortraitGateSnapshot | null = null;
  let lastReason = "stage/visible portrait is missing";
  while (Date.now() < deadline) {
    last = (await browser.execute(() => {
      const stage =
        document.querySelector(".interrogation-stage.active") !== null;
      const portrait = document.querySelector<HTMLImageElement>(
        'img.interrogation-subject-portrait[data-save-crossfade-state="visible"]',
      );
      return {
        stage,
        portrait: portrait
          ? {
              src: portrait.getAttribute("src"),
              complete: portrait.complete,
              naturalWidth: portrait.naturalWidth,
              naturalHeight: portrait.naturalHeight,
            }
          : null,
        dialogueText: document.querySelector(".box")?.textContent ?? null,
      };
    })) as PortraitGateSnapshot;
    if (last.stage && last.portrait) {
      const check = checkPortraitCapture(
        expectation,
        last.portrait,
        last.dialogueText,
      );
      if (check.ok) return last;
      lastReason = check.reason;
    }
    await browser.pause(100);
  }
  throw new Error(
    `${expectation.label}: rendered portrait/dialogue gate did not match: ${lastReason}; last=${JSON.stringify(last)}`,
  );
}

async function captureCompactInterrogationEvidence(
  label: string,
  state: GameStateView,
  expectation: PortraitCaptureExpectation,
  details: Record<string, unknown> = {},
): Promise<CompactInterrogationEvidence> {
  mkdirSync(REPRESENTATIVE_SCENE_ARTIFACT_DIR, { recursive: true });
  const viewport = await observedCssViewport();
  expect({ width: viewport.width, height: viewport.height }).toEqual({
    width: 800,
    height: 600,
  });
  const gate = await waitForExpectedPortrait(expectation);
  await browser.pause(100);
  const screenshotPath = path.join(
    REPRESENTATIVE_SCENE_ARTIFACT_DIR,
    `${label}-800x600.png`,
  );
  await browser.saveScreenshot(screenshotPath);
  const evidence = (await browser.execute(() => {
    const rect = (selector: string): ArtifactRect | null => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const portrait = document.querySelector<HTMLImageElement>(
      'img.interrogation-subject-portrait[data-save-crossfade-state="visible"]',
    );
    const box = portrait?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      subject:
        document.querySelector(".subject-record h2")?.textContent?.trim() ??
        null,
      stage: rect(".interrogation-stage.active"),
      leftStack: rect(".stage-left-stack"),
      toolbar: rect(".interrogation-menu-toolbar"),
      subjectArt: rect("[data-interrogation-subject-art]"),
      questionRecord: rect("[data-interrogation-question-record]"),
      dialogueFrame: rect("[data-interrogation-dialogue-frame]"),
      portrait:
        portrait && box
          ? {
              rect: {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
              },
              complete: portrait.complete,
              naturalWidth: portrait.naturalWidth,
              naturalHeight: portrait.naturalHeight,
              src: portrait.getAttribute("src"),
            }
          : null,
      dialogue: document.querySelector(".box")?.textContent?.trim() ?? null,
    };
  })) as CompactInterrogationEvidence;
  expect(evidence.viewport).toEqual({ width: 800, height: 600 });
  writeFileSync(
    screenshotPath.replace(/\.png$/, ".json"),
    `${JSON.stringify(
      {
        scene: `${state.chapter.id}/${state.scene.id}`,
        mode: state.mode.type,
        portraitGate: {
          expectation,
          rendered: gate.portrait,
          dialogueText: gate.dialogueText,
        },
        ...details,
        ...evidence,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`[Task5] compact interrogation evidence: ${screenshotPath}`);
  return evidence;
}

async function captureCompactKamiyaHearing(
  state: GameStateView,
  phase: {
    id: string;
    subject: {
      name: string;
      role: string;
      portrait: { characterId: string; assetId: string } | null;
    };
  },
): Promise<void> {
  if (compactEvidence.kamiya) return;
  if (
    state.chapter.id !== "chapter_2" ||
    state.scene.id !== "interrogation_scene_6" ||
    !phase.subject.name.includes("神谷")
  ) {
    return;
  }
  const portrait = phase.subject.portrait;
  if (!portrait) {
    throw new Error("Kamiya hearing phase has no authored subject portrait");
  }
  const expectation: PortraitCaptureExpectation = {
    label: "hearing-kamiya-ch2-inv6",
    characterId: portrait.characterId,
    assetPath: publicPathForAssetId(portrait.assetId, "portrait"),
  };
  try {
    await ensureMinimumWindowViewport();
    const evidence = await captureCompactInterrogationEvidence(
      "hearing-kamiya-ch2-inv6",
      state,
      expectation,
      {
        phase: phase.id,
        subjectName: phase.subject.name,
        subjectRole: phase.subject.role,
      },
    );
    expect(evidence.subject).toContain("神谷");
    expect(evidence.portrait?.complete).toBe(true);
    compactEvidence.kamiya = true;
  } finally {
    await ensureCaseFileViewport();
  }
}

async function captureCompactSaegusaSpeaking(
  state: GameStateView,
): Promise<boolean> {
  if (compactEvidence.saegusa) return false;
  if (
    state.chapter.id !== "chapter_2" ||
    state.scene.id !== "interrogation_scene_19" ||
    state.mode.type !== "dialogue"
  ) {
    return false;
  }
  const current = state.mode.current;
  if (current.kind !== "line") return false;
  const portrait = current.portrait;
  if (!portrait || portrait.characterId !== "saegusa_yuma") return false;
  const expectation: PortraitCaptureExpectation = {
    label: "speaking-saegusa-ch2-inv19",
    characterId: portrait.characterId,
    assetPath: publicPathForAssetId(portrait.assetId, "portrait"),
    speaker: current.speaker,
    text: current.text,
  };
  try {
    await ensureMinimumWindowViewport();
    const evidence = await captureCompactInterrogationEvidence(
      "speaking-saegusa-ch2-inv19",
      state,
      expectation,
      {
        speaker: current.speaker,
        lineText: current.text,
        portraitAssetId: portrait.assetId,
        portraitCharacterId: portrait.characterId,
      },
    );
    expect(evidence.portrait).not.toBeNull();
    expect(evidence.portrait?.complete).toBe(true);
    expect(evidence.portrait?.naturalWidth).toBeGreaterThan(0);
    compactEvidence.saegusa = true;
  } finally {
    await ensureCaseFileViewport();
  }
  return compactEvidence.saegusa;
}

/**
 * Walks the Ch2 inv19 dialogue one authored item at a time until the current
 * line is spoken by Saegusa, so the compact capture is his actual portrait,
 * not the Kamiya hearing subject. Stops on mode/cross-exam/pending changes
 * and lets the main drain handle them; bounded by the scan counter.
 */
async function scanForSaegusaLine(
  stop: (state: GameStateView) => boolean,
): Promise<void> {
  if (compactEvidence.saegusa || compactEvidence.saegusaScans >= 3) return;
  compactEvidence.saegusaScans += 1;
  await advanceDialogueUntil(async () => {
    const next = await getPackagedGameState();
    return (
      next.mode.type !== "dialogue" ||
      next.scene.id !== "interrogation_scene_19" ||
      next.mode.crossExamLineId !== null ||
      next.pendingAcquisition !== null ||
      (next.mode.type === "dialogue" &&
        next.mode.current.kind === "line" &&
        next.mode.current.portrait?.characterId === "saegusa_yuma") ||
      stop(next)
    );
  }, 200);
  const next = await getPackagedGameState();
  await captureCompactSaegusaSpeaking(next);
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
  await captureRepresentativeScene(state, {
    sublocation: scene.currentSublocationId,
    sublocations: scene.visibleSublocations.map((item) => item.id),
  });
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
  await captureRepresentativeScene(state, {
    phase: phase.id,
    subject: phase.subject.name,
    role: phase.subject.role,
    questions: phase.questions.length,
  });
  await captureCompactKamiyaHearing(state, phase);
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
        if (
          state.chapter.id === "chapter_2" &&
          state.scene.id === "interrogation_scene_19" &&
          !compactEvidence.saegusa &&
          state.mode.crossExamLineId === null
        ) {
          if (await captureCompactSaegusaSpeaking(state)) continue;
          if (compactEvidence.saegusaScans < 3) {
            await scanForSaegusaLine(stop);
            continue;
          }
        }
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

// --- HPA-831 Task 1: evidence-image compositor + topic-focus regression ----
//
// Two regression proofs run inside THIS organic journey at the real 800x600
// minimum window (never the larger Case File viewport):
//
//   C. inv1 commission topic -> outro -> scene_2 -> first map, driven by real
//      WebDriver element clicks (the embedded WebDriver runs el.click() then
//      el.focus(), moving DOM focus), a WebDriver-Tab-established
//      .advance-button focus, and browser.keys("Enter") advances through
//      the app's real keydown path — never synthetic el.click() — with
//      focus/outline probes at scene_2's first/middle/last lines and the map.
//   B+D. inv3's three evidence acquisitions get the gated screenshot-crop
//      compositor proof (via setAcquisitionCompositorGate, scoped by
//      recordId with receipts required before the leg may continue), then
//      the Case File reopens 閉店監視器截圖 and 三宅打卡紀錄 for the same
//      crop on img.case-file-record-image — all before crossing map_02.

/** Screenshots + metrics JSON for this run (LYRA_E2E_OUTPUT_DIR under the
 * runner; a stable e2e-artifacts path for manual runs). */
const HPA831_ARTIFACT_DIR =
  process.env.LYRA_E2E_OUTPUT_DIR ??
  path.join(process.cwd(), "e2e-artifacts", "save-e2e", "hpa831-focus-images");

/** The two records HPA-831 reports as empty black frames (authored
 * coupling lives in production-anchors). */
const hpa831CaseFileTargets = anchors.hpa831CaseFileRecords;

/** Scoped compositor expectations: recordId -> the authored imageAssetId
 * its popup must carry (the two affected records plus the doorlock
 * comparison). Keyed by recordId so a null or wrong asset id fails loudly
 * instead of silently skipping the screenshot proof. */
const HPA831_GATED_RECORDS = new Map<string, string>([
  ...hpa831CaseFileTargets.map(
    (target) => [target.id, target.assetId] as const,
  ),
  [
    anchors.doorlockComparisonRecord.id,
    anchors.doorlockComparisonRecord.assetId,
  ],
]);

/** Surfaces a focused element may legitimately live in during the
 * commission -> map segment: `body` and `[data-gameplay-root]` by EXACT
 * identity only (they are ancestors of everything — an ancestor match
 * admits any element, the wrong-owner signature this gate exists to
 * catch), plus the narrow interactive controls in
 * EXPECTED_FOCUS_CONTROL_SELECTOR (shared with focus-owner.ts tests).
 * The probe snapshot element/snapshot types and the serialized page
 * script itself live in src/lib/e2e/focus-probe.ts so vitest exercises the
 * identical function WebDriver serializes. */

type FocusProbe = FocusProbeSnapshot & {
  label: string;
  screenshotPath: string;
  /** Per-artifact write outcome: true only when the write succeeded AND
   * produced a nonempty file. Record-only and stall probes may carry
   * false; a checkpoint that passes its owner/outline gate requires both
   * artifacts before it can be credited (round-4 review). */
  evidence: { screenshot: boolean; diagnostics: boolean };
};

/**
 * One whole-document focus snapshot: whoever document.activeElement is
 * (including a [data-gameplay-root] restored by an earlier acquisition
 * popup), every element painting a computed outline, each owner's
 * focus-visible state, bounding rect, and whether the rect crosses the
 * character portrait region — plus an 800x600 evidence screenshot.
 */
async function captureFocusProbe(
  label: string,
  diagnostics?: Record<string, unknown>,
): Promise<FocusProbe> {
  // The serialized page script lives in src/lib/e2e/focus-probe.ts so the
  // identical function WebDriver serializes is exercised by vitest; the
  // authored selectors/attributes come from production-anchors.
  const probe = await browser.execute(
    probeFocusStateDom,
    EXPECTED_FOCUS_CONTROL_SELECTOR,
    anchors.portraitImageSelector,
    anchors.gameplayRootAttribute,
  );
  const screenshotPath = path.join(HPA831_ARTIFACT_DIR, `focus-${label}.png`);
  const diagnosticsPath = screenshotPath.replace(/\.png$/, ".json");
  // Evidence writes are best-effort: a wedged session or gone window must
  // not let the capture error mask the probe result or the failure the
  // caller was about to report (the stall hooks especially). The landed/
  // nonempty outcome is still recorded so a PASSING checkpoint can be
  // held to the strict artifact contract — only best-effort contexts
  // (record-only, stall captures) ignore it.
  let screenshotSaved = false;
  try {
    await browser.saveScreenshot(screenshotPath);
    screenshotSaved = evidenceArtifactLanded(screenshotPath);
  } catch (error) {
    console.error(
      `[FocusProbe] ${label}: screenshot capture failed — continuing without it:`,
      error,
    );
  }
  let diagnosticsSaved = false;
  try {
    writeFileSync(
      diagnosticsPath,
      `${JSON.stringify(
        {
          label,
          ...(diagnostics !== undefined ? { diagnostics } : {}),
          ...probe,
        },
        null,
        2,
      )}\n`,
    );
    diagnosticsSaved = evidenceArtifactLanded(diagnosticsPath);
  } catch (error) {
    console.error(
      `[FocusProbe] ${label}: diagnostics write failed — continuing without it:`,
      error,
    );
  }
  if (diagnostics !== undefined) {
    console.log(
      `[FocusProbe] ${label} diagnostics: ${JSON.stringify(diagnostics)}`,
    );
  }
  const outlinedSummary =
    probe.outlinedElements
      .map(
        (o) =>
          `${o.descriptor}{${o.outlineStyle} ${o.outlineWidth} ${o.outlineColor},active:${o.isActiveElement},fv:${o.focusVisible},portraitCover:${o.portraitCoverFraction.toFixed(2)}}`,
      )
      .join(" | ") || "none";
  console.log(
    `[FocusProbe] ${label}: active=${probe.activeElement?.descriptor ?? "null"} fv=${probe.activeElement?.focusVisible} root=${probe.gameplayRoot?.isActiveElement === true ? "focused" : "not-focused"} portraits=${probe.portraitRegionCount} outlined=${outlinedSummary}`,
  );
  return {
    label,
    ...probe,
    screenshotPath,
    evidence: { screenshot: screenshotSaved, diagnostics: diagnosticsSaved },
  };
}

/**
 * Prohibited outline states (HPA-831 Task 1 C), asserted at every probe —
 * including the required scene_2 first/middle/last and map hooks:
 *   (a) a painted outline on ANY element that is not document.activeElement
 *       — the stale/misplaced frame;
 *   (b) a painted outline on [data-gameplay-root] itself — the long-lived
 *       container is never a legitimate ring owner: the reported bug is a
 *       root-sized frame, and a focused root may NOT paint one, so the
 *       "focused root with a visible outline" regression case is covered
 *       here (and exercised directly by the focus-probe unit regression);
 *   (c) an oversized outline covering a character portrait — the
 *       root-spanning frame over the character visuals. Portraits are
 *       fixed to the viewport edges behind the UI, so the bar is >25% of
 *       a portrait rect covered, not mere edge intersection.
 * A legitimate control ring on the focused element (small, covering at
 * most a sliver of a portrait edge, not the root) still passes;
 * :focus-visible stays diagnostic because WebKitGTK may paint :focus
 * rings without keyboard modality.
 */
function expectNoStaleFocusRing(probe: FocusProbe): void {
  const violations = focusOutlineViolations(probe);
  if (violations.length > 0) {
    throw new Error(
      `focus probe "${probe.label}": prohibited outline state on ` +
        JSON.stringify(
          violations.map((entry) => ({
            descriptor: entry.descriptor,
            isActiveElement: entry.isActiveElement,
            isGameplayRoot: entry.isGameplayRoot,
            focusVisible: entry.focusVisible,
            outline: `${entry.outlineStyle} ${entry.outlineWidth} ${entry.outlineColor}`,
            portraitCoverFraction: entry.portraitCoverFraction,
            rect: entry.rect,
            crossesPortraitRegion: entry.crossesPortraitRegion,
          })),
        ) +
        ` — screenshot ${probe.screenshotPath}`,
    );
  }
}

/**
 * Per-hook owner/modality gate (round-3 finding): each probe declares the
 * owner contract its hook expects via FocusOwnerRequirement and, at hooks
 * reached through trusted Enter advances while a stable control still
 * holds focus, requireKeyboardModality — the observed owner must itself
 * match :focus-visible or keyboard focus state is unestablished. The
 * parked-map hook is the documented exception: its control legitimately
 * unmounts with the dialogue, so it enforces the owner contract and
 * verifies trusted Enter delivery instead (see finishIfMapParked).
 * checkFocusOwner distinguishes inconclusive outcomes
 * (owner/modality cannot be established) from violations (a definite
 * unexpected owner — the wrong-owner bug signature); both fail the hook,
 * but only the latter is reported as a regression.
 */
function expectAllowedFocusOwner(
  probe: FocusProbe,
  requirement: FocusOwnerRequirement,
): void {
  const check = checkFocusOwner(
    probe.activeElement,
    requirement,
    EXPECTED_FOCUS_CONTROL_SELECTOR,
  );
  if (check.ok) return;
  const owner = probe.activeElement;
  const detail =
    owner === null
      ? "null"
      : JSON.stringify({
          descriptor: owner.descriptor,
          tag: owner.tag,
          focusVisible: owner.focusVisible,
          rect: owner.rect,
        });
  throw new Error(
    `focus probe "${probe.label}": ${check.reason} ` +
      `(owner ${detail}${check.inconclusive ? " — inconclusive" : ""}; ` +
      `screenshot ${probe.screenshotPath})`,
  );
}

/**
 * Records each keydown the page actually receives (key + DOM isTrusted +
 * target tag) on window.__hpa831KeyEvents. WebDriver key actions are spec'd
 * to produce trusted input; synthetic dispatchEvent would arrive untrusted,
 * and an embedded transport that injects untrusted DOM events (the macOS
 * fallback documented in helpers.ts) is caught the same way.
 * The serialized page script lives in src/lib/e2e/focus-probe.ts so vitest
 * exercises the identical function WebDriver serializes.
 */
async function installKeyDeliveryProbe(): Promise<void> {
  await browser.execute(installKeyDeliveryRecorderScript);
}

/**
 * Objective trusted-delivery gate: every Enter the test sent must have
 * reached the page as a trusted keydown. Fewer recorded Enters means the
 * transport dropped input; any untrusted event means the delivery is not
 * real keyboard modality — either way the keyboard coverage is
 * inconclusive and the journey must NOT pass on queue progress alone.
 * The recorded events are always written to focus-key-delivery.json
 * first so a failed gate keeps its evidence.
 */
async function verifyTrustedEnterDelivery(sentEnters: number): Promise<void> {
  const events = await browser.execute(readKeyDeliveryEventsScript);
  writeFileSync(
    path.join(HPA831_ARTIFACT_DIR, "focus-key-delivery.json"),
    `${JSON.stringify({ sentEnters, events }, null, 2)}\n`,
  );
  const check = checkTrustedEnterDelivery(events, sentEnters);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  console.log(
    `[FocusProbe] trusted key delivery verified: ${check.receivedEnters}/${sentEnters} Enter keydowns, all isTrusted=true`,
  );
}

/**
 * HPA-831 Task 1 C: the reported commission -> scene_2 -> map transition.
 * The interview and topic transitions use real WebDriver element clicks
 * (the embedded driver's click_element runs el.click() then el.focus() —
 * a real DOM focus move the probes can verify); the keyboard half —
 * Tab focus-establish and the Enter drain — requires the opt-in XTEST
 * trusted-keys transport, because the embedded keys channel delivers
 * only synthetic untrusted keydowns that never move DOM focus. Without
 * the opt-in the segment records the coverage gap and drains the
 * transition through the pre-segment click path so the rest of the
 * organic Chapter 1 route still runs.
 * Focus probes run before the clicks, after each click, at scene_2's
 * first/middle/last line, and on the parked map; every probe saves an
 * 800x600 screenshot, asserts no painted outline sits on an invalid
 * owner, and enforces the hook's expected owner contract — the scene_2
 * hooks additionally require :focus-visible keyboard modality, while the
 * map hook observes the legitimate unmount fallback (the focused
 * .advance-button unmounts with the DialogueBox, dropping focus to body
 * with no ring) under the any-expected owner contract and instead gates
 * map acceptance on verified trusted Enter delivery.
 * Because the topic control's unmount drops focus to the browser fallback
 * and DialogueBox deliberately advances on Enter from that fallback
 * without auto-focusing its advance button, the drain first establishes a
 * positive keyboard-modality owner: XTEST Tab input onto the stable
 * .advance-button, verified before any Enter is sent. If the transport
 * cannot move real DOM focus, the modality is unestablished, or Enter
 * cannot advance dialogue, this fails as inconclusive rather than
 * reporting a false Green.
 */
async function runCommissionScene2FocusSegment(): Promise<void> {
  const probeAndAssert = async (
    label: string,
    requirement: FocusOwnerRequirement,
    diagnostics?: Record<string, unknown>,
  ): Promise<FocusProbe> => {
    const probe = await captureFocusProbe(label, diagnostics);
    expectNoStaleFocusRing(probe);
    expectAllowedFocusOwner(probe, requirement);
    // Round-4 review: a checkpoint that passes its owner/outline gate is
    // credited ONLY when its required evidence actually landed — a
    // swallowed write failure must not let the scene entry,
    // first/middle/last, or map checkpoints count as covered. Best-effort
    // probes (record-only pre-commission, stall captures) never reach
    // this check.
    const missingEvidence = focusProbeEvidenceMissing(probe.evidence);
    if (missingEvidence.length > 0) {
      throw new Error(
        `focus probe "${label}" passed its owner/outline checks but the ` +
          `required evidence did not land (${missingEvidence.join(" + ")} ` +
          `missing or empty under ${HPA831_ARTIFACT_DIR}) — the checkpoint ` +
          `cannot be credited; focus coverage is inconclusive`,
      );
    }
    return probe;
  };

  // Whichever element holds focus entering the transition is recorded —
  // [data-gameplay-root] may legitimately hold the popup-restored focus.
  // Record-only: the ambient explore owner (e.g. a hotspot button) is not
  // yet inside this segment's expected-surface set.
  await captureFocusProbe("pre-commission");

  // WebDriver element click: the embedded WebDriver's click_element runs
  // el.click() then el.focus(), so real DOM focus must land on the control.
  const interviewSelector = `button[aria-label="${anchors.character.label}"]`;
  await browser.waitUntil(async () => elementExists(interviewSelector), {
    timeout: 90000,
    interval: 100,
    timeoutMsg: `${interviewSelector} did not appear`,
  });
  const interviewButton = await browser.$(interviewSelector);
  await interviewButton.click();
  // Coverage gate: without a real focus move the outline probes are
  // inconclusive — fail rather than counting "no ring" as Green.
  await browser.waitUntil(
    async () =>
      browser.execute((sel: string) => {
        const element = document.querySelector(sel);
        return element !== null && document.activeElement === element;
      }, interviewSelector),
    {
      timeout: 5000,
      interval: 100,
      timeoutMsg:
        "WebDriver element click did not move DOM focus to the interview button — focus/keyboard coverage is inconclusive",
    },
  );
  await probeAndAssert("interview-click", { owner: "control" });

  const popoverSelector = `[aria-label="${anchors.topicPopoverName}"]`;
  await browser.waitUntil(async () => elementExists(popoverSelector), {
    timeout: 15000,
    interval: 100,
    timeoutMsg: `${popoverSelector} did not appear`,
  });
  // CSS-only lookup plus a text filter: the embedded WebKitGTK WebDriver is
  // not guaranteed to support xpath locators.
  const topicCandidates = await browser.$$(
    `${popoverSelector} ${anchors.topicActionButtonSelector}`,
  );
  let topicButton: WebdriverIO.Element | null = null;
  for (const candidate of topicCandidates) {
    if ((await candidate.getText()).includes(anchors.firstTopic)) {
      topicButton = candidate;
      break;
    }
  }
  if (!topicButton) {
    throw new Error(
      `topic button ${anchors.firstTopic} not found in ${popoverSelector}`,
    );
  }
  // Focus-capture across activation (round-3 finding): the WebDriver
  // click's real focus move lands on the topic control inside the same
  // driver call, then successful activation transitions into dialogue and
  // unmounts ExploreView — taking the control, and its focus state, with
  // it. A post-hoc "is it focused" check can never observe that, so a
  // capture-phase recorder proves the focusin landed during activation;
  // afterwards the post-transition owner (the unmount fallback) is probed.
  const trajectoryInstalled = await browser.execute(
    installFocusTrajectoryScript,
    popoverSelector,
    anchors.topicActionButtonSelector,
    anchors.firstTopic,
  );
  if (!trajectoryInstalled.installed) {
    throw new Error(
      `topic button ${anchors.firstTopic} not mounted when installing the focus trajectory — coverage is inconclusive`,
    );
  }
  await topicButton.click();
  await browser.waitUntil(
    async () =>
      browser.execute(
        (popoverSel: string) => document.querySelector(popoverSel) === null,
        popoverSelector,
      ),
    {
      timeout: 15000,
      interval: 100,
      timeoutMsg: `${popoverSelector} did not close after the topic was activated`,
    },
  );
  const trajectory = await browser.execute(readFocusTrajectoryScript);
  if (
    trajectory === null ||
    !(trajectory.sawExpectedFocusIn || trajectory.wasAlreadyFocused)
  ) {
    throw new Error(
      `the WebDriver click never moved DOM focus to the topic control ` +
        `(trajectory: ${JSON.stringify(trajectory)}) — focus/keyboard ` +
        `coverage is inconclusive`,
    );
  }
  // Post-transition owner: the clicked control is unmounted by design, so
  // the expected owner is the unmount fallback (body/root) or whatever the
  // app legitimately restores — enforced by the any-expected gate.
  await probeAndAssert("topic-click", { owner: "any-expected" });

  // HPA-831 scoped transport selection: the embedded WebDriver keys
  // channel delivers only synthetic DOM KeyboardEvents on Linux (run
  // c0da417f: six Tabs never moved focus off body and every keydown
  // arrives isTrusted=false), so the keyboard half of this segment —
  // the establish-focus Tabs and the Enter drain — can only be proven
  // through the opt-in XTEST path (LYRA_E2E_XVFB_TRUSTED_KEYS=1 on the
  // xvfb-run runner): real keys delivered only after the
  // private-display, app-process, window-ownership, and per-key focus
  // checks all pass. OS-global keys are never sent implicitly.
  const xvfbTrustedKeys = e2eXvfbTrustedKeysEnabled();
  console.log(
    `[FocusProbe] segment key transport: ${
      xvfbTrustedKeys
        ? "trusted XTEST via verified private xvfb-run display (LYRA_E2E_XVFB_TRUSTED_KEYS=1)"
        : "none — WebDriver synthetic keys cannot move DOM focus or deliver trusted keydowns"
    }`,
  );

  if (!xvfbTrustedKeys) {
    // Coverage gap, recorded: the click probes above still stand (the
    // WebDriver click's el.focus() is a real DOM focus move), but every
    // keyboard assertion below requires the trusted transport — without
    // it the drain could only end inconclusive and the rest of the
    // organic Chapter 1 route would never run. Fall back to the
    // pre-segment click/drain path so the journey keeps covering the
    // route everywhere the opt-in is absent (local runs, macOS).
    writeFileSync(
      path.join(HPA831_ARTIFACT_DIR, "focus-coverage-gap.json"),
      `${JSON.stringify(
        {
          segment: "commission -> scene_2 -> map",
          keyboardTransport: null,
          fallbackTransport:
            "scripted HTMLElement.click() via advanceDialogueUntil " +
            "(browser.execute DOM click — no pointer events, no focus " +
            "move, unlike the driver's click_element path) — no " +
            "keyboard input is sent on this branch",
          reason:
            "LYRA_E2E_XVFB_TRUSTED_KEYS is not enabled — the trusted " +
            "XTEST transport is unavailable, so the keyboard-modality " +
            "drain (Tab focus establish, Enter advances, scene_2 " +
            "first/middle/last and map-pending hooks, trusted-delivery " +
            "gate) was skipped; the click-transition probes above still " +
            "ran",
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      "[FocusProbe] no trusted key transport — keyboard-modality coverage is inconclusive by construction; draining the transition via the scripted DOM-click path (focus-coverage-gap.json)",
    );
    await advanceDialogueUntil(
      () => elementExists(anchors.cityMapSelector),
      DIALOGUE_DRAIN_CAP,
    );
    return;
  }

  // Enter-drain inv1's outro into scene_2 and the first map wrapper. The
  // probes split scene_2 into first/middle/last line by queue cursor; the
  // map probe fires when the pending city map parks. The keydown probe +
  // per-Enter counter prove trusted key delivery before the parked map is
  // accepted.
  await installKeyDeliveryProbe();

  // Positive keyboard-modality control (final-review finding): the
  // topic-click probe recorded whichever unmount-fallback owner the
  // activation left — DialogueBox deliberately advances on Enter from
  // that fallback without auto-focusing its advance button, so a trusted
  // Enter could reach scene_2 with no keyboard-modality owner and fail
  // the required hooks. Establish one before any Enter: Tab input onto
  // .advance-button, the stable Tab-reachable control whose own trusted
  // Enter activation advances the same dialogue. A transport that cannot
  // land real DOM focus on it leaves keyboard coverage unestablished:
  // inconclusive, never green.
  const advanceFocusSelector = anchors.advanceButtonSelector;
  await browser.waitUntil(async () => elementExists(advanceFocusSelector), {
    timeout: 15000,
    interval: 100,
    timeoutMsg:
      "the dialogue advance control did not mount after the commission topic — keyboard focus cannot be established",
  });
  let lastFocusOwner: string | null = null;
  const probeAdvanceFocus = async (): Promise<boolean> => {
    const focusTarget = await browser.execute(
      probeKeyboardFocusTargetDom,
      advanceFocusSelector,
    );
    lastFocusOwner = focusTarget.descriptor;
    return focusTarget.onTarget;
  };
  // Also the post-popup repair path: an acknowledged acquisition restores
  // focus to its own target (off the advance control).
  const establishAdvanceFocus = async (): Promise<void> => {
    let advanceFocusLanded = await probeAdvanceFocus();
    let osFocusChecked = false;
    for (let attempt = 0; attempt < 7 && !advanceFocusLanded; attempt += 1) {
      await sendXvfbTrustedKey("Tab");
      // document.hasFocus() is only meaningful once X input focus sits
      // on the verified window — the windowfocus --sync inside the first
      // XTEST delivery establishes it, so the check belongs after that
      // delivery, never before any key is sent.
      if (!osFocusChecked) {
        osFocusChecked = true;
        if (!(await browser.execute(() => document.hasFocus()))) {
          throw new Error(
            "document.hasFocus() stayed false after the first verified XTEST delivery — keyboard input still cannot reach the app; focus/keyboard coverage is inconclusive",
          );
        }
      }
      // Focus moves on the driver's own cadence — poll briefly so a fast
      // transport does not stack Tabs before the owner settles.
      for (let poll = 0; poll < 12 && !advanceFocusLanded; poll += 1) {
        advanceFocusLanded = await probeAdvanceFocus();
        if (!advanceFocusLanded) await browser.pause(100);
      }
    }
    if (!advanceFocusLanded) {
      let stalledShot = `${path.join(
        HPA831_ARTIFACT_DIR,
        "focus-advance-focus-missing.png",
      )} (capture failed)`;
      try {
        stalledShot = (await captureFocusProbe("advance-focus-missing"))
          .screenshotPath;
      } catch (error) {
        console.error(
          "[FocusProbe] advance-focus-missing capture failed — throwing the original reason:",
          error,
        );
      }
      throw new Error(
        `the XTEST Tab transport did not move DOM focus to the dialogue ` +
          `advance control after 7 Tabs (last owner: ` +
          `${lastFocusOwner ?? "null"}) — the positive keyboard-modality ` +
          `control cannot be established, so focus/keyboard coverage is ` +
          `inconclusive (screenshot ${stalledShot})`,
      );
    }
  };
  await establishAdvanceFocus();
  await probeAndAssert("advance-focus", {
    owner: "control",
    requireKeyboardModality: true,
  });

  const FOCUS_DRAIN_CAP = 160;
  // The drain orchestration lives in src/lib/e2e/journey-enter-drain.ts so
  // vitest exercises the identical sequencing WebDriver drives: a retry
  // Enter fires only on PROVEN "unchanged" state after the first Enter's
  // keydown is recorded as delivered AND the settled-channel re-read
  // still matches (a reveal-only first
  // Enter), an unobservable post-Enter state fails inconclusively without
  // another key, and scene_2's first credited item must be its proven
  // authored queue entry — never a later item reached through an
  // observation gap. The parked map is accepted only after every sent
  // Enter is verified to have arrived as a trusted keydown.
  await drainEnterToMap({
    sceneId: "scene_2",
    cap: FOCUS_DRAIN_CAP,
    transportName: "XTEST",
    hooks: {
      readState: () => getPackagedGameState(),
      pause: (ms) => browser.pause(ms),
      waitUntil: (condition, options) => browser.waitUntil(condition, options),
      sendEnter: () => sendXvfbTrustedKey("Enter"),
      // The packaged command channel's settle signal: .advance-button
      // carries aria-disabled mirroring gameState.inFlight (+page.svelte
      // DialogueBox wiring). Cleared/unmounted means every dispatched
      // command has finished applying, so a subsequent get_state re-read
      // cannot be a stale pre-commit snapshot.
      commandSettled: () =>
        browser
          .waitUntil(
            async () => {
              const control = await $(anchors.advanceButtonSelector);
              if (!(await control.isExisting())) return true;
              return (await control.getAttribute("aria-disabled")) !== "true";
            },
            {
              timeout: 5000,
              interval: 100,
              timeoutMsg:
                "the dialogue advance control stayed aria-disabled — the packaged command channel never settled",
            },
          )
          .then(() => true)
          .catch(() => false),
      // Enter keydowns the delivery probe has recorded so far. The
      // drain's retry gate requires every sent Enter to have provably
      // reached the page BEFORE settlement or a re-read is trusted:
      // an idle DOM resolves commandSettled while a delayed keydown is
      // still in transit, and a retry must never stack behind it and
      // double-advance.
      receivedEnters: async () =>
        (await browser.execute(readKeyDeliveryEventsScript)).filter(
          (event) => event.key === "Enter",
        ).length,
      // A checkpoint must screenshot the item the packaged state reports.
      // DialogueBox reveals the item's full text in its per-kind surface;
      // an exact match means the DOM caught up with the state read.
      renderedItemSettled: (current) =>
        browser
          .waitUntil(
            async () => {
              const surface = renderedItemSurface(
                current,
                anchors.dialogueItemSurfaceSelectors,
              );
              const element = await $(surface.selector);
              if (!(await element.isExisting())) return false;
              if (surface.text === null) return true;
              return (await element.getText()).trim() === surface.text;
            },
            {
              timeout: 8000,
              interval: 100,
              timeoutMsg:
                "the rendered dialogue line never matched the packaged state's current item",
            },
          )
          .then(() => true)
          .catch(() => false),
      // The popup's CONTINUE is auto-focused on mount, so the segment's
      // real Enter dismisses it — never the shared helper's synthetic
      // click, which this segment forbids. The popup's own focus restore
      // then lands off .advance-button, so re-establish it or the later
      // requireKeyboardModality hooks would fail inconclusive.
      acknowledgeAcquisition: async (current, sendEnter) => {
        await browser.waitUntil(
          async () =>
            browser.execute((continueLabel: string) => {
              const active = document.activeElement;
              return (
                active instanceof HTMLButtonElement &&
                !active.disabled &&
                (active.textContent ?? "").includes(continueLabel)
              );
            }, anchors.acquisitionContinueLabel),
          {
            timeout: 15000,
            interval: 100,
            timeoutMsg: `acquisition ${current.id} (${current.recordId}) popup never focused its CONTINUE control — the segment Enter cannot acknowledge it`,
          },
        );
        await sendEnter();
        await waitForPackagedGameState(
          (next) => next.pendingAcquisition?.id !== current.id,
          30000,
          `acquisition ${current.id} (${current.recordId}) did not dismiss after the segment Enter`,
        );
        await establishAdvanceFocus();
      },
      mapMounted: () => elementExists(anchors.cityMapSelector),
      probeHook: async (label, requirement, diagnostics) => {
        await probeAndAssert(label, requirement, diagnostics);
      },
      verifyKeyDelivery: verifyTrustedEnterDelivery,
      captureStallProbe: async (label) => {
        try {
          const probe = await captureFocusProbe(label);
          return {
            activeElementDescriptor: probe.activeElement?.descriptor ?? null,
            screenshotPath: probe.screenshotPath,
          };
        } catch (error) {
          // A capture failure (gone window, wedged session) must not
          // replace the stall error the drain is about to throw.
          console.error(
            `[FocusProbe] stall capture ${label} failed — preserving the original failure:`,
            error,
          );
          return {
            activeElementDescriptor: null,
            screenshotPath: `${path.join(HPA831_ARTIFACT_DIR, `focus-${label}.png`)} (capture failed)`,
          };
        }
      },
    },
  });
}

/**
 * HPA-831 Task 1 D: after the inv3 acquisitions are organically acquired and
 * before the next map gate is crossed, open 遊戲選單 -> 案件檔案 -> 證物 and
 * re-open the two affected records; each `img.case-file-record-image` gets
 * the source decode/canvas proof and the screenshot-crop compositor proof.
 * The menu then closes and the pending-map state must still hold.
 */
async function verifyHpa831CaseFileRecords(gate: MapGate): Promise<void> {
  const state = await waitForPackagedGameState(
    (candidate) => isPendingMapGate(candidate, gate.wrapper),
    30000,
    `${gate.wrapper} did not park on its pending city map before the Case File gate`,
  );
  // The record/assetId gate shares the failure-evidence contract via
  // src/lib/e2e/image-evidence-proof.ts (review-fix-3): a missing record or
  // a wrong/null assetId must attempt the required 800x600 evidence —
  // a raw viewport screenshot (the record's image is not mounted yet) plus
  // structured diagnostics — while the window is still up, then rethrow
  // the original error even when capture itself fails.
  await runCaseFileRecordGate({
    targets: hpa831CaseFileTargets,
    gateWrapper: gate.wrapper,
    findRecord: (target) =>
      state.inventory.evidence.find((candidate) => candidate.id === target.id),
    captureFailure: async ({ target, error }) => {
      await captureImageFailureDiagnostics({
        label: `Case File ${target.id} (${target.name})`,
        selector: anchors.caseFileRecordImageSelector,
        screenshotPath: path.join(
          HPA831_ARTIFACT_DIR,
          `case-file-${target.id}-failure.png`,
        ),
        error,
        diagnostics: {
          recordId: target.id,
          assetId: target.assetId,
          stage: "inventory-gate",
        },
      });
    },
  });
  // Menu/section navigation shares the failure-evidence contract
  // (review-fix-4): a failed menu open, 案件檔案 entry, or 證物 tab click
  // throws while the 800x600 window is still up — capture the raw viewport
  // frame + structured diagnostics, then rethrow the original error.
  // Per-record failures keep their own record-specific captures below, so
  // nothing is captured twice.
  await withImageFailureEvidence(
    async () => {
      await openGameMenu();
      await jsClickButtonContaining(anchors.caseFileMenuEntry);
      await jsClickButtonContaining(anchors.caseFileEvidenceTab);
    },
    (error) =>
      captureImageFailureDiagnostics({
        label: `Case File menu navigation at ${gate.wrapper}`,
        selector: anchors.caseFileRecordImageSelector,
        screenshotPath: path.join(
          HPA831_ARTIFACT_DIR,
          "case-file-navigation-failure.png",
        ),
        error,
        diagnostics: {
          stage: "menu-navigation",
          gateWrapper: gate.wrapper,
        },
      }),
  );
  for (const target of hpa831CaseFileTargets) {
    const expectedPath = publicPathForAssetId(target.assetId, "evidence");
    const label = `Case File ${target.id} (${target.name})`;
    // The shared proof sequencing lives in
    // src/lib/e2e/image-evidence-proof.ts so vitest exercises the identical
    // orchestration: mount/source/identity failures capture the required
    // 800x600 failure evidence (viewport screenshot + diagnostics JSON)
    // BEFORE the outer finally restores the window, and the original error
    // is rethrown even when capture itself fails.
    await runImageEvidenceProof({
      prepare: () => jsClickButtonContaining(target.name),
      inspect: () =>
        inspectImageElement({
          selector: anchors.caseFileRecordImageSelector,
          expectedPath,
          label,
        }),
      report: ({ mountWaitMs, inspection }) =>
        console.log(
          `[CaseFileImage] ${target.id} ` +
            formatImageInspection(label, mountWaitMs, inspection),
        ),
      assert: ({ inspection }) => assertInspectedImage(inspection, label),
      // The 800x600 Case File stacks rail/list/detail inside the
      // .game-menu-extra scrollport: scroll the record image into view, wait
      // for stable geometry, and crop image-rect ∩ scrollport ∩ viewport —
      // sampling the raw DOM rect could read pixels the scrollport clips or
      // unrelated menu furniture (review: image-only painted region).
      provePainted: async (inspection) => {
        await assertScreenshotRegionPainted({
          selector: anchors.caseFileRecordImageSelector,
          imageSelector: anchors.caseFileRecordImageSelector,
          expectedImageSrc: inspection.sourceUrl,
          pin: inspection.pin,
          label,
          screenshotPath: path.join(
            HPA831_ARTIFACT_DIR,
            `case-file-${target.id}.png`,
          ),
          insetCssPx: 1,
          scrollIntoView: true,
        });
      },
      // Release the page-owned node pin on every path.
      releaseInspection: ({ pin }) => releaseImageElementPin(pin),
      captureFailure: ({ error, inspection }) =>
        captureImageFailureDiagnostics({
          label,
          selector: anchors.caseFileRecordImageSelector,
          screenshotPath: path.join(
            HPA831_ARTIFACT_DIR,
            `case-file-${target.id}-failure.png`,
          ),
          error,
          diagnostics: {
            recordId: target.id,
            assetId: target.assetId,
            inspection,
          },
        }),
    });
  }
  // 繼續調查 exists only on GameShell's main-menu branch; while the Case
  // File submenu is open the only navigation is 返回選單 — go back first,
  // then resume, or the journey can never leave the submenu. Same
  // failure-evidence contract as the open navigation above: a failed
  // close or a lost map park captures the viewport frame + diagnostics,
  // then rethrows (review-fix-4).
  await withImageFailureEvidence(
    async () => {
      await jsClickButtonContaining(anchors.submenuBackButton);
      await clickButton(anchors.continueInvestigation);
      await waitForNoDialog(anchors.gameMenu);
      await waitForPackagedGameState(
        (candidate) => isPendingMapGate(candidate, gate.wrapper),
        30000,
        `${gate.wrapper} did not stay parked on its pending city map after Case File closed`,
      );
    },
    (error) =>
      captureImageFailureDiagnostics({
        label: `Case File menu close at ${gate.wrapper}`,
        selector: anchors.caseFileRecordImageSelector,
        screenshotPath: path.join(
          HPA831_ARTIFACT_DIR,
          "case-file-close-failure.png",
        ),
        error,
        diagnostics: {
          stage: "menu-close",
          gateWrapper: gate.wrapper,
        },
      }),
  );
  console.log(
    `[HPA831Gate] Case File reopened ${hpa831CaseFileTargets.map((t) => t.id).join(", ")}; menu closed, organic journey continues`,
  );
}

/**
 * The inv3 evidence/Case-File gate (plan E): shrink to the exact 800x600
 * minimum window, arm the recordId-scoped compositor gate so the three
 * affected/comparison popups each get a screenshot-crop proof while
 * visible, drain the authored inv3 route to its pending map, require a
 * successful crop receipt for every scoped record, run the organic Case
 * File re-open proof, and restore the Case File viewport in `finally`
 * even on failure.
 */
async function runInv3EvidenceAndCaseFileGate(
  gate: MapGate,
  crossedWrappers: string[],
): Promise<void> {
  console.log(
    `[HPA831Gate] shrinking to 800x600 for inv3 acquisitions + Case File at ${gate.wrapper}`,
  );
  let restoreError: unknown;
  try {
    // The viewport arm itself can fail before the gate dir exists
    // (review-fix-4): capture honest evidence of whatever the real frame is
    // — no 800x600 claim — plus diagnostics, then rethrow the original
    // error.
    await withImageFailureEvidence(
      async () => {
        await ensureMinimumWindowViewport();
        const viewport = await observedCssViewport();
        expect(viewport.width).toBe(800);
        expect(viewport.height).toBe(600);
      },
      (error) =>
        captureImageFailureDiagnostics({
          label: `inv3 gate viewport arm at ${gate.wrapper}`,
          selector: anchors.acquisitionEvidenceImageSelector,
          screenshotPath: path.join(
            HPA831_ARTIFACT_DIR,
            "inv3-viewport-arm-failure.png",
          ),
          error,
          diagnostics: {
            stage: "viewport-arm",
            gateWrapper: gate.wrapper,
          },
        }),
    );
    mkdirSync(HPA831_ARTIFACT_DIR, { recursive: true });
    setAcquisitionCompositorGate({
      expectedAssetIds: HPA831_GATED_RECORDS,
      outputDirectory: HPA831_ARTIFACT_DIR,
    });
    await drainOrganicRoute(
      (state) => isPendingMapGate(state, gate.wrapper),
      `${gate.wrapper} pending city map`,
    );
    // Popup coverage cannot silently disappear: every record the gate
    // scoped must hold a successful compositor-crop receipt — a popup
    // that reported a null/wrong asset id already failed inside the
    // acknowledgement, and a popup that never appeared leaves no
    // receipt, so inv3 cannot leave green on partial coverage.
    let receipts: ReadonlyMap<string, string> = new Map();
    let missing: string[] = [];
    // A missing receipt is required failure evidence too (review-fix-4):
    // capture the viewport frame + diagnostics naming the uncovered
    // records and the actual receipts, then rethrow — a failure can never
    // be minted into a receipt.
    await withImageFailureEvidence(
      async () => {
        receipts = acquisitionCompositorReceipts();
        missing = missingCompositorReceipts(HPA831_GATED_RECORDS, receipts);
        if (missing.length > 0) {
          throw new Error(
            `${gate.wrapper}: no compositor-crop proof for ${missing.join(", ")} ` +
              `— each gated record's popup must report its authored ` +
              `imageAssetId and pass the screenshot crop before inv3 may ` +
              `continue (receipts: ${JSON.stringify(Object.fromEntries(receipts))})`,
          );
        }
      },
      (error) =>
        captureImageFailureDiagnostics({
          label: `compositor receipts missing at ${gate.wrapper}`,
          selector: anchors.acquisitionEvidenceImageSelector,
          screenshotPath: path.join(
            HPA831_ARTIFACT_DIR,
            "acquisition-missing-receipts-failure.png",
          ),
          error,
          diagnostics: {
            stage: "compositor-receipts",
            gateWrapper: gate.wrapper,
            missing,
            receipts: Object.fromEntries(receipts),
          },
        }),
    );
    await verifyHpa831CaseFileRecords(gate);
  } finally {
    setAcquisitionCompositorGate(null);
    try {
      await ensureCaseFileViewport();
    } catch (error) {
      restoreError = error;
      console.error("[HPA831Gate] case-file viewport restore failed:", error);
    }
  }
  if (restoreError !== undefined) throw restoreError;
  await crossGate(gate, crossedWrappers);
}

// --- Task 5 shipped complete -> title acceptance ---------------------------
//
// The last gates leg already reaches the real gameComplete state. These
// captures and assertions extend that endpoint: no fabricated ending, no
// checkpoint, no injected state. Clicks stay the ordinary WebDriver/DOM path
// (isTrusted=false); no OS input is sent here.

const TASK5_TITLE_ARTIFACT_DIR =
  process.env.LYRA_E2E_OUTPUT_DIR ??
  path.join(
    process.cwd(),
    "e2e-artifacts",
    "save-e2e",
    "hpa852-title-acceptance",
  );

type ArtifactRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TitleScreenMeasurement = {
  label: string;
  viewport: { width: number; height: number };
  scrollTop: number;
  documentScrollTop: number;
  windowScrollY: number;
  expectedCard: string;
  continueCard: {
    found: boolean;
    enabled: boolean;
    isActive: boolean;
    rect: ArtifactRect | null;
  } | null;
  activeElement: {
    tag: string;
    label: string | null;
    text: string;
    isEnabledCard: boolean;
  } | null;
  logo: ArtifactRect | null;
  deck: ArtifactRect | null;
  quitInitial: {
    found: boolean;
    disabled: boolean;
    rect: ArtifactRect;
    fullyVisible: boolean;
  } | null;
};

type TitleFocusState = {
  scrollTop: number;
  documentScrollTop: number;
  windowScrollY: number;
  activeLabel: string | null;
  activeText: string;
  quitFocused: boolean;
  quitRect: ArtifactRect | null;
  quitFullyVisible: boolean;
  quitHit: boolean;
};

type TitleArrowMeasurement = {
  label: string;
  synthetic: string;
  initial: TitleFocusState;
  presses: number;
  final: TitleFocusState;
};

/** Serialized DOM reader; must not capture outer-scope values. */
function readTitleFocusState(): TitleFocusState {
  const menu = document.querySelector<HTMLElement>(".lyra-menu");
  const active = document.activeElement;
  const quit = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => (button.textContent ?? "").includes("結束偵查"));
  const quitBox = quit?.getBoundingClientRect();
  const hit =
    quit && quitBox
      ? document.elementFromPoint(
          quitBox.left + quitBox.width / 2,
          quitBox.top + quitBox.height / 2,
        )
      : null;
  return {
    scrollTop: menu?.scrollTop ?? 0,
    documentScrollTop:
      document.scrollingElement?.scrollTop ?? document.body.scrollTop,
    windowScrollY: window.scrollY,
    activeLabel:
      active instanceof HTMLElement ? active.getAttribute("aria-label") : null,
    activeText:
      active instanceof HTMLElement
        ? (active.textContent ?? "").trim().slice(0, 120)
        : "",
    quitFocused:
      active instanceof HTMLElement &&
      (active.textContent ?? "").includes("結束偵查"),
    quitRect: quitBox
      ? {
          x: quitBox.x,
          y: quitBox.y,
          width: quitBox.width,
          height: quitBox.height,
        }
      : null,
    quitFullyVisible:
      quitBox !== undefined &&
      quitBox.top >= -0.5 &&
      quitBox.bottom <= window.innerHeight + 0.5,
    quitHit: quit !== undefined && hit !== null && quit.contains(hit),
  };
}

/** Waits for the saved-profile title to focus the shipped Continue card. */
async function waitForTitleContinueFocus(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((label: string) => {
        const card = document.querySelector<HTMLButtonElement>(
          `button[aria-label="${label}"]`,
        );
        return (
          card !== null && !card.disabled && document.activeElement === card
        );
      }, anchors.continueGame),
    {
      timeout: 20000,
      interval: 100,
      timeoutMsg: `title autofocus did not land on the enabled ${anchors.continueGame} card`,
    },
  );
}

/** Measures the untouched top-of-title state; never moves the scrollbar. */
async function captureTitleScreen(
  label: string,
): Promise<TitleScreenMeasurement> {
  mkdirSync(TASK5_TITLE_ARTIFACT_DIR, { recursive: true });
  const screenshotPath = path.join(TASK5_TITLE_ARTIFACT_DIR, `${label}.png`);
  await browser.saveScreenshot(screenshotPath);
  const measurement = (await browser.execute(
    (args: { label: string; expectedCard: string }) => {
      const rect = (element: Element | null): ArtifactRect | null => {
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      };
      const menu = document.querySelector<HTMLElement>(".lyra-menu");
      const active = document.activeElement;
      const expected = document.querySelector<HTMLButtonElement>(
        `button[aria-label="${args.expectedCard}"]`,
      );
      const quit = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => (button.textContent ?? "").includes("結束偵查"));
      const quitBox = quit?.getBoundingClientRect();
      return {
        label: args.label,
        viewport: { width: innerWidth, height: innerHeight },
        scrollTop: menu?.scrollTop ?? 0,
        documentScrollTop:
          document.scrollingElement?.scrollTop ?? document.body.scrollTop,
        windowScrollY: window.scrollY,
        expectedCard: args.expectedCard,
        continueCard: expected
          ? {
              found: true,
              enabled: !expected.disabled,
              isActive: document.activeElement === expected,
              rect: rect(expected),
            }
          : null,
        activeElement:
          active instanceof HTMLElement
            ? {
                tag: active.tagName.toLowerCase(),
                label: active.getAttribute("aria-label"),
                text: (active.textContent ?? "").trim().slice(0, 120),
                isEnabledCard: active.matches(
                  ".lyra-menu .card:not(:disabled)",
                ),
              }
            : null,
        logo: rect(document.querySelector(".title-block")),
        deck: rect(document.querySelector(".deck")),
        quitInitial:
          quit && quitBox
            ? {
                found: true,
                disabled: quit.disabled,
                rect: {
                  x: quitBox.x,
                  y: quitBox.y,
                  width: quitBox.width,
                  height: quitBox.height,
                },
                fullyVisible:
                  quitBox.top >= -0.5 &&
                  quitBox.bottom <= window.innerHeight + 0.5,
              }
            : null,
      };
    },
    { label, expectedCard: anchors.continueGame },
  )) as TitleScreenMeasurement;
  writeFileSync(
    screenshotPath.replace(/\.png$/, ".json"),
    `${JSON.stringify(measurement, null, 2)}\n`,
  );
  console.log(
    `[Task5] ${label}: viewport=${measurement.viewport.width}x${measurement.viewport.height} scrollTop=${measurement.scrollTop} active=${measurement.activeElement?.label ?? "none"} logo=${JSON.stringify(measurement.logo)}`,
  );
  return measurement;
}

/** The saved-profile title contract at the 800x600 minimum window. */
function expectTitleAtTop(
  measurement: TitleScreenMeasurement,
  label: string,
): void {
  expect(measurement.viewport).toEqual({ width: 800, height: 600 });
  expect(measurement.scrollTop).toBe(0);
  expect(measurement.documentScrollTop).toBe(0);
  expect(measurement.windowScrollY).toBe(0);
  expect(measurement.expectedCard).toBe(anchors.continueGame);
  const continueCard = measurement.continueCard;
  if (!continueCard)
    throw new Error(`${label}: ${anchors.continueGame} card is missing`);
  expect(continueCard.enabled).toBe(true);
  expect(continueCard.isActive).toBe(true);
  expect(measurement.activeElement?.label).toBe(anchors.continueGame);
  expect(measurement.activeElement?.isEnabledCard).toBe(true);
  const logo = measurement.logo;
  if (!logo) throw new Error(`${label}: title logo block is missing`);
  expect(logo.width).toBeGreaterThan(0);
  expect(logo.height).toBeGreaterThan(0);
  expect(logo.y).toBeGreaterThanOrEqual(-0.5);
  expect(logo.y + logo.height).toBeLessThanOrEqual(600.5);
  expect(measurement.deck).not.toBeNull();
  // QUIT must exist and be enabled at the untouched top; the shipped Arrow
  // handler below is what has to reveal and focus it.
  const quit = measurement.quitInitial;
  if (!quit) throw new Error(`${label}: QUIT (結束偵查) is missing`);
  expect(quit.disabled).toBe(false);
}

/**
 * Exercises the shipped MainMenu ArrowDown handler with synthetic
 * KeyboardEvents. This is not native Tab/wheel/XTest proof: it verifies the
 * real window listener, card cycling, focus and focus-scroll behavior.
 */
async function exerciseTitleArrowNavigation(
  label: string,
): Promise<TitleArrowMeasurement> {
  const initial = (await browser.execute(
    readTitleFocusState,
  )) as TitleFocusState;
  if (initial.activeLabel !== anchors.continueGame) {
    throw new Error(
      `${label}: Arrow navigation must start from ${anchors.continueGame}, found ${String(initial.activeLabel)}`,
    );
  }
  let presses = 0;
  let quitFocused = false;
  let lastActive = initial.activeText;
  while (!quitFocused && presses < 12) {
    const pressed = (await browser.execute(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
      const active = document.activeElement;
      return {
        activeLabel:
          active instanceof HTMLElement
            ? active.getAttribute("aria-label")
            : null,
        activeText:
          active instanceof HTMLElement
            ? (active.textContent ?? "").trim().slice(0, 120)
            : "",
        quitFocused:
          active instanceof HTMLElement &&
          (active.textContent ?? "").includes("結束偵查"),
      };
    })) as {
      activeLabel: string | null;
      activeText: string;
      quitFocused: boolean;
    };
    presses += 1;
    quitFocused = pressed.quitFocused;
    lastActive = pressed.activeText;
  }
  if (!quitFocused) {
    throw new Error(
      `${label}: synthetic ArrowDown did not focus QUIT after ${presses} presses (active ${JSON.stringify(lastActive)})`,
    );
  }
  await browser.pause(100);
  const final = (await browser.execute(readTitleFocusState)) as TitleFocusState;
  const screenshotPath = path.join(
    TASK5_TITLE_ARTIFACT_DIR,
    `${label}-quit-focused.png`,
  );
  await browser.saveScreenshot(screenshotPath);
  const measurement: TitleArrowMeasurement = {
    label,
    synthetic:
      "synthetic KeyboardEvent ArrowDown through the shipped MainMenu window handler (not native Tab/wheel/XTest)",
    initial,
    presses,
    final,
  };
  writeFileSync(
    screenshotPath.replace(/\.png$/, ".json"),
    `${JSON.stringify(measurement, null, 2)}\n`,
  );
  console.log(
    `[Task5] ${label} ArrowDown: presses=${presses} quit=${final.quitFocused} scrollTop=${final.scrollTop} rect=${JSON.stringify(final.quitRect)}`,
  );
  return measurement;
}

function expectTitleQuitReached(
  arrow: TitleArrowMeasurement,
  label: string,
): void {
  expect(arrow.initial.activeLabel).toBe(anchors.continueGame);
  expect(arrow.presses).toBeGreaterThan(0);
  expect(arrow.presses).toBeLessThanOrEqual(12);
  expect(arrow.final.quitFocused).toBe(true);
  expect(arrow.final.quitFullyVisible).toBe(true);
  expect(arrow.final.quitHit).toBe(true);
  const quit = arrow.final.quitRect;
  if (!quit) throw new Error(`${label}: QUIT rect is missing after ArrowDown`);
  expect(quit.y).toBeGreaterThanOrEqual(-0.5);
  expect(quit.y + quit.height).toBeLessThanOrEqual(600.5);
  expect(arrow.final.documentScrollTop).toBe(0);
  if (!arrow.initial.quitFullyVisible) {
    expect(arrow.final.scrollTop).toBeGreaterThan(arrow.initial.scrollTop);
    expect(arrow.final.scrollTop).toBeGreaterThan(0);
  }
}

type CompleteEndCardMeasurement = {
  viewport: { width: number; height: number };
  complete: ArtifactRect | null;
  cta: ArtifactRect | null;
  ctaText: string;
  ctaDisabled: boolean;
  ctaHit: boolean;
};

/** Captures the shipped end card and proves its CTA is on-screen. */
async function captureCompleteEndCard(): Promise<CompleteEndCardMeasurement> {
  mkdirSync(TASK5_TITLE_ARTIFACT_DIR, { recursive: true });
  const screenshotPath = path.join(
    TASK5_TITLE_ARTIFACT_DIR,
    "complete-end-card-800x600.png",
  );
  await browser.saveScreenshot(screenshotPath);
  const measurement = await browser.execute(() => {
    const rect = (element: Element | null): ArtifactRect | null => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const cta = document.querySelector<HTMLButtonElement>(
      '[data-focus-target="return-to-title"]',
    );
    const ctaBox = cta?.getBoundingClientRect();
    const hit =
      cta && ctaBox
        ? document.elementFromPoint(
            ctaBox.left + ctaBox.width / 2,
            ctaBox.top + ctaBox.height / 2,
          )
        : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      complete: rect(document.querySelector(".complete")),
      cta: rect(cta),
      ctaText: (cta?.textContent ?? "").trim(),
      ctaDisabled: cta?.disabled ?? true,
      ctaHit: cta !== null && hit !== null && cta.contains(hit),
    };
  });
  writeFileSync(
    screenshotPath.replace(/\.png$/, ".json"),
    `${JSON.stringify(measurement, null, 2)}\n`,
  );
  console.log(
    `[Task5] complete end card: viewport=${measurement.viewport.width}x${measurement.viewport.height} cta=${JSON.stringify(measurement.cta)}`,
  );
  return measurement;
}

/** Waits for the CTA's real persistence-backed return to install the title. */
async function waitForTitleScreenAfterReturn(): Promise<void> {
  await browser.pause(500);
  await browser.waitUntil(
    async () =>
      browser.execute(
        (titleSelector: string, rootAttribute: string) =>
          document.querySelector(titleSelector) !== null &&
          document.querySelector(`[${rootAttribute}]`) === null,
        `[aria-label="${anchors.mainMenu}"]`,
        anchors.gameplayRootAttribute,
      ),
    {
      timeout: 90000,
      interval: 500,
      timeoutMsg: "return-to-title did not install the title screen",
    },
  );
}

describe("fresh production journey", () => {
  afterEach(function () {
    assertSafeXvfbDisplay(this, true);
  });
  // WDIO's testFnWrapper snapshots each runnable's _timeout before the test
  // body runs (see wdio.conf.ts), so an in-body this.timeout() can never
  // raise the armed cap — a bigger budget must be declared at registration
  // via .timeout() chained on it(). Both organic Chapter 1 legs register 30
  // minutes (their in-body calls restate the same budget): the first carries
  // the HPA-831 focus segment plus the gated inv3 acquisition and Case File
  // compositor proofs and consumed the shared 20-minute cap reaching scene_5
  // in run 4b96c4ac; the second covers the five remaining Chapter 1 gates
  // into the Chapter 2 opening and hit the same cap at scene_11_2's last
  // drain step in runs 8cf2ad54 and 4928e51a. Every other leg keeps 20
  // minutes.
  it("plays the organic Chapter 1 route from the menu to its second-half city-map gate", async function () {
    this.timeout(1_800_000);
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
    // HPA-831 Task 1 C: the reported commission -> outro -> scene_2 -> map
    // transition runs at the real 800x600 minimum window with WebDriver
    // element clicks and Enter advances (real DOM focus + the app's real
    // keydown path, never synthetic clicks). Focus probes at scene_2's
    // first/middle/last lines and the parked map assert no painted outline
    // sits on an invalid owner; every probe saves an evidence screenshot.
    // The finally guarantees the normal viewport returns for the rest of
    // the journey even when a probe fails.
    let focusRestoreError: unknown;
    try {
      await ensureMinimumWindowViewport();
      const focusViewport = await observedCssViewport();
      expect(focusViewport.width).toBe(800);
      expect(focusViewport.height).toBe(600);
      mkdirSync(HPA831_ARTIFACT_DIR, { recursive: true });
      await runCommissionScene2FocusSegment();
    } finally {
      try {
        await ensureCaseFileViewport();
      } catch (error) {
        focusRestoreError = error;
        console.error(
          "[ProductionJourney] case-file viewport restore after the focus segment failed:",
          error,
        );
      }
    }
    if (focusRestoreError !== undefined) throw focusRestoreError;
    // The outro chain parks on the first map wrapper's pending city map;
    // predicate-first ordering keeps the drain from clicking the
    // destination pin — crossGate owns that step.
    await waitForPackagedGameState(
      (state) => isPendingMapGate(state, anchors.firstMapWrapper),
      30000,
      `${anchors.firstMapWrapper} did not park on its pending city map after the focus segment`,
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
      // HPA-831 Task 1 B+D: inv3 is crossed by the map_02 gate, so that
      // leg runs the gated 800x600 evidence-image compositor proofs and
      // the organic Case File re-open of the two affected records before
      // the gate is crossed.
      if (gate.wrapper === anchors.mapGates[1].wrapper) {
        await runInv3EvidenceAndCaseFileGate(gate, crossedWrappers);
        continue;
      }
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
  }).timeout(1_800_000);

  it("plays Chapter 1 from its second-half city-map gate into Chapter 2", async function () {
    this.timeout(1_800_000);
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
  }).timeout(1_800_000);

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
    // Fix-round visual evidence must have actually been captured from the
    // named characters, not merely reached their scenes.
    expect(compactEvidence.kamiya).toBe(true);
    expect(compactEvidence.saegusa).toBe(true);
    // HPA-705: the 800x600 tray gate must have actually executed at the
    // final hearing's ≥74-record tray — a shorter inventory must fail here,
    // never silently skip the geometry proof.
    expect(evidenceTrayGeometryGateDone).toBe(true);

    // Task 5 (HPA-852): extend this real shipped endpoint through the new
    // complete-card CTA into the title. No ending or checkpoint is fabricated;
    // the click is the ordinary WebDriver/DOM path, not trusted OS input.
    await ensureMinimumWindowViewport();
    const endCard = await captureCompleteEndCard();
    expect(endCard.viewport).toEqual(MINIMUM_WINDOW);
    if (!endCard.cta) throw new Error("complete-card CTA is missing");
    expect(endCard.ctaText).toContain(anchors.returnToTitle);
    expect(endCard.ctaDisabled).toBe(false);
    expect(endCard.cta.x).toBeGreaterThanOrEqual(-0.5);
    expect(endCard.cta.y).toBeGreaterThanOrEqual(-0.5);
    expect(endCard.cta.x + endCard.cta.width).toBeLessThanOrEqual(800.5);
    expect(endCard.cta.y + endCard.cta.height).toBeLessThanOrEqual(600.5);
    expect(endCard.ctaHit).toBe(true);
    await clickButton(anchors.returnToTitle);
    await waitForTitleScreenAfterReturn();
    await waitForTitleContinueFocus();
    // The review requires the 1.5-second MainMenu timer window to close
    // without moving the untouched top position before measuring.
    await browser.pause(1700);
    const returnTitle = await captureTitleScreen("title-return-800x600");
    expectTitleAtTop(returnTitle, "return title");
    const returnArrow = await exerciseTitleArrowNavigation(
      "title-return-800x600",
    );
    expectTitleQuitReached(returnArrow, "return title");
    // The title now shows the returned-to-title discovery snapshot and the
    // auto-clear was already asserted above; no fresh session is started here.
  });

  it("keeps the fresh title autofocus at the top with QUIT reachable at 800x600", async function () {
    this.timeout(120_000);
    await resetE2eStorage();
    await ensureMinimumWindowViewport();
    await waitForTitleContinueFocus();
    await browser.pause(1700);
    const title = await captureTitleScreen("title-fresh-800x600");
    expectTitleAtTop(title, "fresh title");
    const arrow = await exerciseTitleArrowNavigation("title-fresh-800x600");
    expectTitleQuitReached(arrow, "fresh title");
    // Leave the usual larger viewport for whatever runs after this spec;
    // the 800x600 title evidence above is already captured.
    await ensureCaseFileViewport();
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
