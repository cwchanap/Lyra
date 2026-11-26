import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import {
  assertSceneNavPointerEvents,
  assertSceneNavTabProgress,
  assertSceneNavWheelProgress,
  assertX11DisplaySafe,
  describeX11InputError,
  deliverX11PointerPair,
} from "../scripts/e2e-x11-trusted-input.mjs";
import {
  advanceDialogueUntil,
  captureMockupViewport,
  collectKagamiSummaryEvidence,
  dismissAllPendingAcquisitions,
  e2eXvfbTrustedKeysEnabled,
  elementExists,
  enabledMapDestinationIds,
  ensureMinimumWindowViewport,
  getPackagedGameState,
  jsClick,
  jumpToProductionScene,
  loadPackagedCheckpoint,
  MINIMUM_WINDOW,
  openGameMenu,
  resetE2eStorage,
  seedStoryCleared,
  sendXvfbTrustedKey,
  sendXvfbTrustedSceneNavPointer,
  startFromMenu,
  waitForPackagedGameState,
  xvfbPointerState,
} from "./helpers";
import { anchors } from "./production-anchors";
import type { E2eCheckpointId } from "$lib/e2e/checkpoints";
import {
  targetLayoutStyle,
  type TargetLayout,
} from "$lib/investigation/target-layout";
import type { GameStateView, SublocationView } from "$lib/state/types";

/**
 * The least of each axis a cropped target must keep inside the window: the
 * hotspot's minimum hit height. A target smaller than this must stay whole.
 */
const MIN_USABLE_TARGET_PX = 44;

type ShippedPlacement = {
  id: string;
  kind: "hotspot" | "character";
  layout: TargetLayout;
  style: string;
  /** Authored `status: locked`; characters carry no status and are never locked. */
  locked: boolean;
};

type Box = { left: number; top: number; right: number; bottom: number };

// --- HPA-853 chapter-2 packaged placement surface (design §4.2) ------------

/** The six HPA-853 scenes carrying the strict center gate and live HUD checks. */
const HPA853_SCENE_NUMBERS = [8, 10, 12, 14, 16, 17] as const;

/**
 * The pinned unplaced set: empty since HPA-1143's five targets shipped.
 * Any compiled target losing its layout fails loudly here.
 */
const EXPECTED_UNPLACED_TARGETS: string[] = [];

/**
 * Authored sublocation count per HPA-853 scene: every chip must be present,
 * including the 4-chip NAV of scenes 12/14.
 */
const HPA853_SUBLOCATION_COUNTS = {
  investigation_scene_8: 3,
  investigation_scene_10: 2,
  investigation_scene_12: 4,
  investigation_scene_14: 4,
  investigation_scene_16: 2,
  investigation_scene_17: 2,
} as const satisfies Record<
  `investigation_scene_${(typeof HPA853_SCENE_NUMBERS)[number]}`,
  number
>;

/** The fixed layout-ready checkpoint per HPA-853 scene (e2e_checkpoints.rs whitelist). */
const HPA853_LAYOUT_CHECKPOINTS = {
  8: "chapter-2-investigation-layout-scene-8",
  10: "chapter-2-investigation-layout-scene-10",
  12: "chapter-2-investigation-layout-scene-12",
  14: "chapter-2-investigation-layout-scene-14",
  16: "chapter-2-investigation-layout-scene-16",
  17: "chapter-2-investigation-layout-scene-17",
} as const satisfies Record<
  (typeof HPA853_SCENE_NUMBERS)[number],
  E2eCheckpointId
>;

type HudRects = {
  nav: Box | null;
  progress: Box | null;
  primaryObjective: Box | null;
  sceneLabel: Box | null;
  menu: Box | null;
};

type TargetMeasurement = {
  id: string;
  /** Production routed this placed target into the fallback list. */
  routed: boolean;
  rect: Box;
  probeVisible: boolean;
  hitIsSelfOrDescendant: boolean;
  hitDescription: string;
  /** Authored-center probe ran (authored center inside the viewport). */
  authoredCenterProbed: boolean;
  authoredHitIsSelfOrDescendant: boolean;
  authoredHitDescription: string;
};

type SublocationMeasurement = {
  viewport: { width: number; height: number };
  hudHeight: number;
  stageHeight: number;
  rowOneHeight: number;
  rowTwoHeight: number;
  hud: HudRects;
  targets: TargetMeasurement[];
  projectedLocked: Array<{ id: string; rect: Box }>;
  /** OFF-SCENE TARGETS eyebrow count; null when the panel is not rendered. */
  fallbackCount: number | null;
};

type ShippedTarget = {
  id: string;
  kind: "hotspot" | "character";
  layout: TargetLayout | null;
  locked: boolean;
};

/** Every hotspot and witness in the compiled scenes the app ships, placed or not. */
function shippedTargets(): ShippedTarget[] {
  type PlacedTarget = {
    id: string;
    layout: TargetLayout | null;
    status?: string;
  };
  type CompiledInvestigation = {
    sublocations: Array<{
      id: string;
      hotspots: PlacedTarget[];
      characters: PlacedTarget[];
    }>;
  };
  const scenesDir = path.join(
    process.cwd(),
    "src-tauri",
    "resources",
    "scenes",
  );
  const targets: ShippedTarget[] = [];
  const chapters = readdirSync(scenesDir)
    .filter((name) => name.startsWith("chapter_"))
    .toSorted();
  for (const chapter of chapters) {
    const files = readdirSync(path.join(scenesDir, chapter))
      .filter((name) => /^investigation_scene_.*\.json$/.test(name))
      .toSorted();
    for (const file of files) {
      const scene = JSON.parse(
        readFileSync(path.join(scenesDir, chapter, file), "utf8"),
      ) as CompiledInvestigation;
      const sceneId = `${chapter}/${file.replace(/\.json$/, "")}`;
      for (const sublocation of scene.sublocations) {
        const groups = [
          ["hotspot", sublocation.hotspots],
          ["character", sublocation.characters],
        ] as const;
        for (const [kind, group] of groups) {
          for (const target of group) {
            targets.push({
              id: `${sceneId}/${sublocation.id}/${target.id}`,
              kind,
              layout: target.layout,
              locked: target.status === "locked",
            });
          }
        }
      }
    }
  }
  return targets;
}

/** Every placed hotspot and witness in the compiled scenes the app ships. */
function shippedPlacements(): ShippedPlacement[] {
  return shippedTargets()
    .filter(
      (target): target is ShippedTarget & { layout: TargetLayout } =>
        target.layout !== null,
    )
    .map(({ id, kind, layout, locked }) => ({
      id,
      kind,
      layout,
      style: targetLayoutStyle(layout),
      locked,
    }));
}

/** Explore parked on investigation_scene_map_01's city map (HPA-601 §7). */
function isPendingFirstMapGate(state: GameStateView): boolean {
  return (
    state.mode.type === "explore" &&
    state.scene.kind === "investigation" &&
    state.scene.id === anchors.firstMapWrapper &&
    state.scene.currentSublocationId === null &&
    state.scene.map !== null
  );
}

/** Explore parked inside `sceneId`'s investigation surface. */
function isExploreInScene(state: GameStateView, sceneId: string): boolean {
  return (
    state.mode.type === "explore" &&
    state.scene.kind === "investigation" &&
    state.scene.id === sceneId
  );
}

function intersectsBox(a: Box, b: Box): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

/**
 * Switches through the real sublocation nav chip; a first entry plays the
 * sublocation's transition dialogue, so drain it back into Explore.
 */
async function enterSublocationThroughNav(
  sceneId: string,
  sublocation: { id: string; label: string },
): Promise<void> {
  const clicked = await browser.execute((chipLabel: string) => {
    const chip = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".explore-hud nav .chips button",
      ),
    ).find(
      (candidate) =>
        (candidate.querySelector(".label")?.textContent ?? "").trim() ===
        chipLabel,
    );
    if (!chip || chip.disabled) return false;
    chip.click();
    return true;
  }, sublocation.label);
  if (!clicked) {
    throw new Error(
      `sublocation chip ${sublocation.label} (${sublocation.id}) was missing or disabled`,
    );
  }
  await advanceDialogueUntil(async () => {
    const state = await getPackagedGameState();
    return (
      isExploreInScene(state, sceneId) &&
      state.scene.kind === "investigation" &&
      state.scene.currentSublocationId === sublocation.id
    );
  });
  await browser.waitUntil(
    () =>
      browser.execute((label: string) => {
        const chips = document.querySelector<HTMLElement>(
          ".explore-hud .chips",
        );
        const active = chips?.querySelector<HTMLElement>("button.active");
        if (
          !chips ||
          !active ||
          active.querySelector(".label")?.textContent?.trim() !== label
        )
          return false;
        const viewport = chips.getBoundingClientRect();
        const button = active.getBoundingClientRect();
        return (
          button.left >= viewport.left - 1 && button.right <= viewport.right + 1
        );
      }, sublocation.label),
    {
      timeout: 10000,
      timeoutMsg: `Active scene chip ${sublocation.id} did not scroll into view`,
    },
  );
}

/** The keyed surface re-rendered for the newly entered sublocation. */
async function waitForSceneSurface(sublocation: {
  id: string;
  label: string;
}): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (label: string) =>
          document.querySelector(".scene-label strong")?.textContent === label,
        sublocation.label,
      ),
    {
      timeout: 15000,
      interval: 100,
      timeoutMsg: `scene surface did not switch to ${sublocation.id}`,
    },
  );
}

/**
 * One packaged 800×600 measurement pass over a live HPA-853 sublocation:
 * real HUD DOM rects vs every target rect (visual occlusion), and real
 * elementFromPoint hit routing for the buttons that are actually shown.
 * Individually locked targets never render, so their authored geometry is
 * projected through the existing compiled-sidecar style contract instead of
 * inventing state that would change game semantics — those projections get
 * the HUD disjointness check but no hit-routing claim.
 */
async function expectHpa853SublocationSurface(
  sceneId: string,
  sublocation: SublocationView,
  scenePlacements: ShippedPlacement[],
  outroTotal: number,
): Promise<void> {
  const subPrefix = `chapter_2/${sceneId}/${sublocation.id}/`;
  // Every target the runtime exposes for this sublocation, placed or not.
  const runtimeTargetIds = new Set([
    ...sublocation.hotspots.map((hotspot) => hotspot.id),
    ...sublocation.characters.map((character) => character.id),
  ]);
  const placedIds = new Set([
    ...sublocation.hotspots.flatMap((hotspot) =>
      hotspot.layout ? [hotspot.id] : [],
    ),
    ...sublocation.characters.flatMap((character) =>
      character.layout ? [character.id] : [],
    ),
  ]);
  const unplacedCount =
    sublocation.hotspots.length +
    sublocation.characters.length -
    placedIds.size;
  // The sublocation's compiled placements must split exactly into the live
  // buttons (runtime-visible placed targets) and the individually locked
  // ones the runtime view filters out. Both halves are asserted against the
  // real DOM below, so the HUD-disjointness and hit-routing passes cannot
  // be vacuous: a target production stops rendering shows up as a missing
  // button instead of silently vanishing from both sets.
  const compiledSubPlacementIds = scenePlacements
    .filter((placement) => placement.id.startsWith(subPrefix))
    .map((placement) => placement.id.slice(subPrefix.length));
  const lockedStyles = scenePlacements
    .filter((placement) => placement.id.startsWith(subPrefix))
    .filter(
      (placement) =>
        !runtimeTargetIds.has(placement.id.slice(subPrefix.length)),
    )
    // Local ids only (the runtime renders local data-target-id attributes),
    // so the coverage union below compares like with like.
    .map((placement) => ({
      id: placement.id.slice(subPrefix.length),
      style: placement.style,
    }));

  // Locked-ness is pinned to the authored `status: locked`, not inferred
  // from runtime absence: an unlocked placement the runtime fails to expose
  // (e.g. scene 8's comment_fight) must fail here instead of sliding into
  // the projected-locked set and passing without a usable button.
  const unexpectedProjections = scenePlacements
    .filter((placement) => placement.id.startsWith(subPrefix))
    .filter(
      (placement) =>
        !placement.locked &&
        !runtimeTargetIds.has(placement.id.slice(subPrefix.length)),
    )
    .map((placement) => placement.id);
  expect(unexpectedProjections).toEqual([]);

  // Authored hit points derive from the compiled layout ratios — the same
  // numbers targetViewportRect consumes — measured against the real rendered
  // plane inside the page, not from each element's --x-ratio style vars, so
  // a style that loses a var cannot silently skip the authored-center probe.
  const authoredLayouts = scenePlacements
    .filter((placement) => placement.id.startsWith(subPrefix))
    .map((placement) => ({
      id: placement.id.slice(subPrefix.length),
      x: placement.layout.x,
      y: placement.layout.y,
      w: placement.layout.w,
      h: placement.layout.h,
    }));

  const measurement: SublocationMeasurement = await browser.execute(
    (
      locked: Array<{ id: string; style: string }>,
      authored: Array<{
        id: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }>,
    ): SublocationMeasurement => {
      const box = (rect: DOMRect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });
      const rectOf = (selector: string): Box | null => {
        const element = document.querySelector(selector);
        return element ? box(element.getBoundingClientRect()) : null;
      };
      const describeHit = (hit: Element | null): string =>
        hit === null
          ? "null"
          : `${hit.tagName.toLowerCase()}${
              typeof hit.className === "string" && hit.className.trim() !== ""
                ? `.${hit.className.trim().split(/\s+/).join(".")}`
                : ""
            }`;
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const stageElement = document.querySelector(".scene-stage");
      const planeElement = document.querySelector(".scene-coordinate-plane");
      if (!stageElement || !planeElement)
        throw new Error("Scene stage missing");
      const stage = stageElement.getBoundingClientRect();
      const header = document.querySelector(".scene-hud");
      if (!header) throw new Error("Scene HUD missing");
      const plane = planeElement.getBoundingClientRect();
      const clipped = (rect: DOMRect): Box => ({
        left: Math.max(rect.left, stage.left),
        top: Math.max(rect.top, stage.top),
        right: Math.min(rect.right, stage.right),
        bottom: Math.min(rect.bottom, stage.bottom),
      });
      const hud = {
        nav: rectOf(".explore-hud nav"),
        progress: rectOf(".investigation-progress"),
        primaryObjective: rectOf(".primary-objective-hud"),
        sceneLabel: rectOf(".scene-label"),
        menu: rectOf(".scene-hud [data-game-menu-trigger]"),
      };
      const rowOneHeight = Math.max(
        ...[hud.progress, hud.primaryObjective, hud.sceneLabel, hud.menu].map(
          (rect) => (rect ? rect.bottom - rect.top : 0),
        ),
      );
      const authoredById = new Map(authored.map((entry) => [entry.id, entry]));
      const targets: TargetMeasurement[] = Array.from(
        document.querySelectorAll<HTMLElement>(
          "button.hotspot-target, button.character-target",
        ),
      ).map((target) => {
        const id = target.getAttribute("data-target-id") ?? "";
        const rect = target.getBoundingClientRect();
        const visible = clipped(rect);
        const probeVisible =
          visible.right > visible.left && visible.bottom > visible.top;
        let hitIsSelfOrDescendant = false;
        let hitDescription = probeVisible
          ? "no element"
          : "outside the viewport";
        if (probeVisible) {
          const hit = document.elementFromPoint(
            (visible.left + visible.right) / 2,
            (visible.top + visible.bottom) / 2,
          );
          hitIsSelfOrDescendant = hit !== null && target.contains(hit);
          hitDescription = describeHit(hit);
        }
        const authoredLayout = authoredById.get(id);
        let authoredCenter: { x: number; y: number } | null = null;
        if (authoredLayout) {
          const cx =
            plane.left +
            (authoredLayout.x + authoredLayout.w / 2) * plane.width;
          const cy =
            plane.top +
            (authoredLayout.y + authoredLayout.h / 2) * plane.height;
          if (
            cx >= stage.left &&
            cx <= stage.right &&
            cy >= stage.top &&
            cy <= stage.bottom
          ) {
            authoredCenter = { x: cx, y: cy };
          }
        }
        const authoredCenterProbed = authoredCenter !== null;
        let authoredHitIsSelfOrDescendant = false;
        let authoredHitDescription = authoredCenterProbed
          ? "no element"
          : "authored center outside the viewport";
        if (authoredCenter !== null) {
          const hit = document.elementFromPoint(
            authoredCenter.x,
            authoredCenter.y,
          );
          authoredHitIsSelfOrDescendant = hit !== null && target.contains(hit);
          authoredHitDescription = describeHit(hit);
        }
        return {
          id,
          routed: target.hasAttribute("inert"),
          rect: visible,
          probeVisible,
          hitIsSelfOrDescendant,
          hitDescription,
          authoredCenterProbed,
          authoredHitIsSelfOrDescendant,
          authoredHitDescription,
        };
      });
      const projectedLocked: Array<{ id: string; rect: Box }> = [];
      const template = document.querySelector<HTMLElement>(
        "button.hotspot-target",
      );
      if (template) {
        const savedStyle = template.getAttribute("style");
        const savedClass = template.className;
        for (const entry of locked) {
          template.setAttribute("style", entry.style);
          template.classList.remove("compact", "compact-x", "compact-y");
          projectedLocked.push({
            id: entry.id,
            rect: clipped(template.getBoundingClientRect()),
          });
        }
        if (savedStyle === null) template.removeAttribute("style");
        else template.setAttribute("style", savedStyle);
        template.className = savedClass;
      }
      const fallbackEyebrow = document.querySelector(
        ".fallback-controls .fallback-toggle .eyebrow",
      );
      const fallbackCount =
        fallbackEyebrow === null
          ? null
          : Number((fallbackEyebrow.textContent ?? "").split("·")[1]?.trim()) ||
            0;
      return {
        viewport,
        hudHeight: header.getBoundingClientRect().height,
        stageHeight: stage.height,
        rowOneHeight,
        rowTwoHeight: hud.nav ? hud.nav.bottom - hud.nav.top : 0,
        hud,
        targets,
        projectedLocked,
        fallbackCount,
      };
    },
    lockedStyles,
    authoredLayouts,
  );

  expect(measurement.viewport).toEqual(MINIMUM_WINDOW);
  expect(measurement.hudHeight).toBeLessThanOrEqual(150);
  expect(measurement.stageHeight).toBeGreaterThanOrEqual(450);
  expect(measurement.rowOneHeight).toBeLessThanOrEqual(74);
  expect(measurement.rowTwoHeight).toBeLessThanOrEqual(54);

  // A placed target routed into fallback means the stage edge or panel band
  // ate its hit box — never acceptable for these scenes.
  const routedIds = measurement.targets
    .filter((target) => target.routed)
    .map((target) => target.id);
  expect(routedIds).toEqual([]);

  // Coverage is asserted, not assumed: the live buttons must be exactly the
  // runtime's placed targets, the projected rects exactly the locked ones
  // (which also fails when no hotspot template exists to project through),
  // and together they must account for every compiled placement in the
  // sublocation. An empty overlap/misrouting list therefore means something:
  // every placed target was actually measured, live or projected.
  const liveIds = measurement.targets.map((target) => target.id).toSorted();
  expect(liveIds).toEqual([...placedIds].toSorted());
  const projectedIds = measurement.projectedLocked
    .map((entry) => entry.id)
    .toSorted();
  expect(projectedIds).toEqual(
    lockedStyles.map((entry) => entry.id).toSorted(),
  );
  const coveredIds = new Set([...liveIds, ...projectedIds]);
  expect(compiledSubPlacementIds.filter((id) => !coveredIds.has(id))).toEqual(
    [],
  );

  // The OFF-SCENE panel must carry exactly the sidecar's unplaced targets —
  // the art-blocker accounting, not a silent zero-fallback claim.
  expect(measurement.fallbackCount ?? 0).toBe(unplacedCount);

  // HUD presence: nav and scene label always; progress when the auto outro
  // is live; the primary objective is authored-optional and may be absent.
  const missingHud: string[] = [];
  if (measurement.hud.nav === null) missingHud.push(".explore-hud nav");
  if (measurement.hud.sceneLabel === null) missingHud.push(".scene-label");
  if (measurement.hud.menu === null)
    missingHud.push("[data-game-menu-trigger]");
  if (outroTotal > 0 && measurement.hud.progress === null) {
    missingHud.push(".investigation-progress");
  }
  expect(missingHud).toEqual([]);

  // Visual occlusion is decided from each HUD element's DOM rectangle,
  // rather than treating the nav bottom as a full-width obstruction.
  const hudCandidates = [
    { name: ".explore-hud nav", rect: measurement.hud.nav },
    { name: ".investigation-progress", rect: measurement.hud.progress },
    { name: ".primary-objective-hud", rect: measurement.hud.primaryObjective },
    { name: ".scene-label", rect: measurement.hud.sceneLabel },
    { name: "[data-game-menu-trigger]", rect: measurement.hud.menu },
  ];
  const hudRects: Array<{ name: string; rect: Box }> = [];
  for (const candidate of hudCandidates) {
    if (candidate.rect !== null) {
      hudRects.push({ name: candidate.name, rect: candidate.rect });
    }
  }
  const measuredTargets: Array<{ id: string; rect: Box }> = [
    ...measurement.targets.map(({ id, rect }) => ({ id, rect })),
    ...measurement.projectedLocked,
  ];
  const overlaps: string[] = [];
  for (const target of measuredTargets) {
    for (const { name, rect } of hudRects) {
      if (intersectsBox(target.rect, rect)) {
        overlaps.push(
          `${target.id} overlaps ${name}: ${JSON.stringify(target.rect)} ∩ ${JSON.stringify(rect)}`,
        );
      }
    }
  }
  expect(overlaps).toEqual([]);

  // Every expected live button must keep a usable viewport intersection —
  // probeVisible=false on a placed target is a finding, never a skip.
  const invisibleIds = measurement.targets
    .filter((target) => !target.probeVisible)
    .map((target) => target.id);
  expect(invisibleIds).toEqual([]);

  // Hit routing only: a real visible button must receive its own center
  // click; a target not actually shown claims no routing.
  const misrouted = measurement.targets
    .filter(
      (target) =>
        !target.routed && target.probeVisible && !target.hitIsSelfOrDescendant,
    )
    .map((target) => `${target.id} was hit at ${target.hitDescription}`);
  expect(misrouted).toEqual([]);

  // Authored-center routing: the sidecar's own center must receive that
  // click too, not just the visible-rect center. Declared intentional
  // overlaps bypass collision compaction, so once a later-defined target
  // renders (e.g. the board_underlayer page revealed over the planning
  // board), same-z DOM order decides the winner at any shared point — an
  // authored center landing inside a later partner's box silently hands
  // that click to the partner.
  const authoredMisrouted = measurement.targets
    .filter(
      (target) =>
        !target.routed &&
        target.authoredCenterProbed &&
        !target.authoredHitIsSelfOrDescendant,
    )
    .map(
      (target) => `${target.id} was hit at ${target.authoredHitDescription}`,
    );
  expect(authoredMisrouted).toEqual([]);
  expect(
    measurement.targets
      .filter((target) => !target.authoredCenterProbed)
      .map((target) => target.id),
  ).toEqual([]);
}

/** Fresh setup that parks gameplay on the first map wrapper's pending map. */
async function setupAtFirstMapGate(): Promise<void> {
  await seedStoryCleared();
  await startFromMenu();
  await jumpToProductionScene(anchors.firstMapWrapper);
  await waitForPackagedGameState(
    isPendingFirstMapGate,
    30000,
    "first map wrapper did not park on the pending city map",
  );
}

/** Crossing must advance exactly once into the Rain Bell investigation. */
async function expectCrossedToRainBellInvestigation(): Promise<void> {
  await waitForPackagedGameState(
    (state) =>
      state.scene.kind === "investigation" &&
      state.scene.id === anchors.firstGateSuccessor,
    30000,
    "selecting the sole destination did not advance into the Rain Bell investigation",
  );
  const state = await getPackagedGameState();
  expect(state.mode.type).toBe("dialogue");
  expect(await elementExists(anchors.cityMapSelector)).toBe(false);
}

function assertSafeXvfbDisplay(context: Mocha.Context): void {
  if (!e2eXvfbTrustedKeysEnabled()) return;
  assertX11DisplaySafe(xvfbPointerState, () => {
    const suite = (context.currentTest ?? context.test)?.parent;
    if (!suite) process.exit(1);
    suite.bail(true);
  });
}

describe("investigation layout surface", () => {
  beforeEach(async function () {
    assertSafeXvfbDisplay(this);
    await resetE2eStorage();
  });
  afterEach(function () {
    assertSafeXvfbDisplay(this);
  });

  it("collects a placed investigation hotspot through the real player UI", async () => {
    await loadPackagedCheckpoint("chapter-1-investigation-explore");
    const hotspotSel = `button[aria-label="${anchors.hotspotEvidence.label}"]`;
    await browser.waitUntil(async () => elementExists(hotspotSel), {
      timeout: 15000,
    });
    await collectKagamiSummaryEvidence();
    const inspected = await browser.execute((selector: string) => {
      return document.querySelector(selector)?.classList.contains("inspected");
    }, hotspotSel);
    expect(inspected).toBe(true);
  });

  it("highlights a placed investigation character on hover", async () => {
    await loadPackagedCheckpoint("chapter-1-investigation-explore");
    const characterSel = `button[aria-label="${anchors.character.label}"]`;
    await browser.waitUntil(async () => elementExists(characterSel), {
      timeout: 15000,
    });

    // Production CSS raises highlight/name opacity on :hover, :focus-visible,
    // or [aria-expanded="true"]. OS-focus flake makes real hover + getComputedStyle
    // via execute unreliable (script timeouts under tauri-service window hooks).
    // Expand the character (same CSS rules as hover) and assert via JS
    // getComputedStyle to avoid findElement/elementClick focus-hook timeouts.
    await jsClick(characterSel);
    await browser.waitUntil(
      async () =>
        browser.execute((sel: string) => {
          const el = document.querySelector(sel);
          return el?.getAttribute("aria-expanded") === "true";
        }, characterSel),
      { timeout: 10000, timeoutMsg: "character did not expand" },
    );

    await browser.waitUntil(
      async () => {
        return browser.execute((sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const highlight = el.querySelector(".character-highlight");
          const name = el.querySelector(".character-name");
          if (!highlight || !name) return false;
          const ho = window.getComputedStyle(highlight).opacity;
          const no = window.getComputedStyle(name).opacity;
          return Number(ho) >= 0.99 && Number(no) >= 0.99;
        }, characterSel);
      },
      {
        timeout: 10000,
        timeoutMsg: "character highlight/name opacity not 1 when expanded",
      },
    );
  });

  it("keeps every shipped placement usable and its cue on it at 800x600 and 800x720", async () => {
    // The existing five-location checkpoint supplies actual pending controls
    // to exercise both cue variants without adding a checkpoint.
    await loadPackagedCheckpoint("chapter-2-investigation-layout-scene-4");
    const hotspotSel = "button.hotspot-target";
    const characterSel = "button.character-target";
    await browser.waitUntil(
      async () =>
        browser.execute(
          (selectors: string[]) =>
            selectors.every((selector) =>
              Array.from(document.querySelectorAll(selector)).some(
                (target) => target.querySelector(".target-pending") !== null,
              ),
            ),
          [hotspotSel, characterSel],
        ),
      {
        timeout: 15000,
        timeoutMsg: "scene 4 targets did not show their pending cues",
      },
    );
    await ensureMinimumWindowViewport();

    const placements = shippedPlacements();
    const ids = placements.map((placement) => placement.id);
    // Keep the original edge-placement examples in the corpus sweep.
    for (const id of [
      "chapter_1/investigation_scene_3/inner_entry/tall_shelf",
      "chapter_1/investigation_scene_3/front/katase",
      "chapter_1/investigation_scene_3/front/miyake_locker",
      "chapter_1/investigation_scene_9/contractor_desk/to_confront",
    ]) {
      expect(ids).toContain(id);
    }

    // Real layout in the packaged WebView: re-place one live hotspot and one
    // live witness at each shipped box through the production style
    // contract, and read back where the target and its cue land. Hotspots
    // are read both with and without the collision compaction, which only
    // drops the minimum hit size.
    const measure = async () =>
      browser.execute(
        (
          entries: ShippedPlacement[],
          hotspotSelector: string,
          characterSelector: string,
        ) => {
          const box = (rect: DOMRect) => ({
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          });
          const unfinished = (selector: string) =>
            Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
              (target) => target.querySelector(".target-pending") !== null,
            )!;
          const targets = {
            hotspot: unfinished(hotspotSelector),
            character: unfinished(characterSelector),
          };
          const saved = Object.values(targets).map((target) => ({
            target,
            style: target.getAttribute("style"),
            className: target.className,
          }));
          const compactClasses = ["compact", "compact-x", "compact-y"];
          const stage = document.querySelector(".scene-stage");
          const plane = document.querySelector(".scene-coordinate-plane");
          if (!stage || !plane) throw new Error("Scene stage or plane missing");
          const planeRect = plane.getBoundingClientRect();
          const results: Array<{
            id: string;
            target: Box;
            cue: Box;
            center: { x: number; y: number };
          }> = [];
          for (const entry of entries) {
            const target = targets[entry.kind];
            const cue = target.querySelector<HTMLElement>(".target-pending")!;
            target.setAttribute("style", entry.style);
            // The pulse scales the cue; measure its resting box.
            cue.style.animation = "none";
            const variants = entry.kind === "hotspot" ? [false, true] : [false];
            for (const compact of variants) {
              target.classList.remove(...compactClasses);
              if (compact) target.classList.add("compact");
              results.push({
                id: compact ? `${entry.id} (compact)` : entry.id,
                target: box(target.getBoundingClientRect()),
                cue: box(cue.getBoundingClientRect()),
                center: {
                  x:
                    planeRect.left +
                    (entry.layout.x + entry.layout.w / 2) * planeRect.width,
                  y:
                    planeRect.top +
                    (entry.layout.y + entry.layout.h / 2) * planeRect.height,
                },
              });
            }
            cue.style.removeProperty("animation");
          }
          for (const { target, style, className } of saved) {
            if (style === null) target.removeAttribute("style");
            else target.setAttribute("style", style);
            target.className = className;
          }
          return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            stage: box(stage.getBoundingClientRect()),
            plane: box(planeRect),
            results,
          };
        },
        placements,
        hotspotSel,
        characterSel,
      );

    const measurements = [await measure()];
    await browser.saveScreenshot(
      path.join(
        process.env.LYRA_E2E_OUTPUT_DIR ?? process.cwd(),
        "placement-800x600.png",
      ),
    );
    await captureMockupViewport({
      name: "placement-tall",
      requested: { width: 800, height: 720 },
      outputDirectory: process.env.LYRA_E2E_OUTPUT_DIR ?? process.cwd(),
    });
    measurements.push(await measure());
    await ensureMinimumWindowViewport();
    writeFileSync(
      path.join(
        process.env.LYRA_E2E_OUTPUT_DIR ?? process.cwd(),
        "placement-geometry.json",
      ),
      JSON.stringify(
        measurements.map(({ viewport, stage, plane }) => ({
          viewport,
          stage,
          plane,
        })),
        null,
        2,
      ),
    );

    expect(measurements[0].viewport).toEqual(MINIMUM_WINDOW);
    expect(measurements[0].results.length).toBeGreaterThan(placements.length);
    expect(measurements[1].viewport.height).toBeGreaterThan(
      MINIMUM_WINDOW.height,
    );
    expect(measurements[1].viewport.width * MINIMUM_WINDOW.height).not.toBe(
      measurements[1].viewport.height * MINIMUM_WINDOW.width,
    );

    // Every placed target must retain a usable stage intersection and cue.
    const unusable: string[] = [];
    const misplaced: string[] = [];
    const offstageCenters: string[] = [];
    for (const measured of measurements) {
      expect(measured.stage.bottom - measured.stage.top).toBeGreaterThanOrEqual(
        450,
      );
      expect(measured.plane.left).toBeGreaterThanOrEqual(
        measured.stage.left - 0.5,
      );
      expect(measured.plane.right).toBeLessThanOrEqual(
        measured.stage.right + 0.5,
      );
      expect(measured.plane.top).toBeGreaterThanOrEqual(
        measured.stage.top - 0.5,
      );
      expect(measured.plane.bottom).toBeLessThanOrEqual(
        measured.stage.bottom + 0.5,
      );
      for (const { id, target, cue, center } of measured.results) {
        if (
          center.x < measured.stage.left - 0.5 ||
          center.x > measured.stage.right + 0.5 ||
          center.y < measured.stage.top - 0.5 ||
          center.y > measured.stage.bottom + 0.5
        ) {
          offstageCenters.push(
            `${id} at ${measured.viewport.width}x${measured.viewport.height}: ${JSON.stringify(center)}`,
          );
        }
        const visible: Box = {
          left: Math.max(target.left, measured.stage.left),
          top: Math.max(target.top, measured.stage.top),
          right: Math.min(target.right, measured.stage.right),
          bottom: Math.min(target.bottom, measured.stage.bottom),
        };
        const needWidth = Math.min(
          target.right - target.left,
          MIN_USABLE_TARGET_PX,
        );
        const needHeight = Math.min(
          target.bottom - target.top,
          MIN_USABLE_TARGET_PX,
        );
        if (
          visible.right - visible.left < needWidth - 0.5 ||
          visible.bottom - visible.top < needHeight - 0.5
        ) {
          unusable.push(
            `${id}: only ${JSON.stringify(visible)} of ${JSON.stringify(target)} is in the window`,
          );
          continue;
        }
        const cueWidth = cue.right - cue.left;
        const cueHeight = cue.bottom - cue.top;
        if (Math.round(cueWidth) !== 12 || Math.round(cueHeight) !== 12) {
          misplaced.push(`${id}: cue is ${cueWidth}x${cueHeight}, not 12x12`);
          continue;
        }
        if (
          cue.left < visible.left ||
          cue.top < visible.top ||
          cue.right > visible.right ||
          cue.bottom > visible.bottom
        ) {
          misplaced.push(
            `${id}: cue ${JSON.stringify(cue)} outside visible target ${JSON.stringify(visible)}`,
          );
        }
      }
    }
    expect(offstageCenters).toEqual([]);
    expect(unusable).toEqual([]);
    expect(misplaced).toEqual([]);
  });

  it("Escape closes the topic popover before opening the game menu", async () => {
    await loadPackagedCheckpoint("chapter-1-investigation-with-kagami-summary");
    await dismissAllPendingAcquisitions({ cap: 1 });

    const characterSel = `button[aria-label="${anchors.character.label}"]`;
    await browser.waitUntil(async () => elementExists(characterSel), {
      timeout: 15000,
    });
    await jsClick(characterSel);

    await browser.waitUntil(
      async () => {
        return browser.execute((label: string) => {
          return !!document.querySelector(
            `[role="dialog"][aria-label="${label}"]`,
          );
        }, anchors.topicPopoverName);
      },
      { timeout: 10000, timeoutMsg: "topic popover did not open" },
    );

    await browser.keys("Escape");
    await browser.waitUntil(
      async () => {
        return browser.execute((label: string) => {
          const el = document.querySelector(
            `[role="dialog"][aria-label="${label}"]`,
          );
          return !el;
        }, anchors.topicPopoverName);
      },
      { timeout: 5000, timeoutMsg: "topic popover did not close on Escape" },
    );

    const menuOpen = await browser.execute((heading: string) => {
      return Array.from(document.querySelectorAll('[role="dialog"]')).some(
        (d) =>
          Array.from(d.querySelectorAll("h2")).some((h) =>
            (h.textContent ?? "").includes(heading),
          ),
      );
    }, anchors.gameMenu);
    expect(menuOpen).toBe(false);

    await openGameMenu();
    const menuNow = await browser.execute((heading: string) => {
      return Array.from(document.querySelectorAll('[role="dialog"]')).some(
        (d) =>
          Array.from(d.querySelectorAll("h2")).some((h) =>
            (h.textContent ?? "").includes(heading),
          ),
      );
    }, anchors.gameMenu);
    expect(menuNow).toBe(true);
  });

  it("renders the first city map and crosses it with mouse activation", async () => {
    await setupAtFirstMapGate();

    // Map background renders through the story-asset resolver. The v2 map
    // opens directly on the Kichijoji district plane (its sole legal leaf is
    // kichijoji-direct), so the rendered raster is the district's own — the
    // Tokyo overview raster appears only via 返回全景地圖.
    await browser.waitUntil(
      async () =>
        browser.execute(
          (
            selector: string,
            backgroundSelector: string,
            backgroundPath: string,
          ) => {
            const image = document.querySelector<HTMLImageElement>(
              `${selector} ${backgroundSelector}`,
            );
            return image !== null && image.src.endsWith(backgroundPath);
          },
          anchors.cityMapSelector,
          anchors.mapBackgroundSelector,
          "/assets/backgrounds/city_map/kichijoji.png",
        ),
      {
        timeout: 30000,
        interval: 100,
        timeoutMsg: "city map background did not render",
      },
    );

    // Exactly one destination enabled, and it is Rain Bell.
    expect(await enabledMapDestinationIds()).toEqual([
      anchors.firstMapDestination,
    ]);

    await ensureMinimumWindowViewport();
    const overviewRect = await browser.execute((selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      };
    }, anchors.mapOverviewSelector);
    if (overviewRect === null) {
      throw new Error("city-map overview return was not rendered");
    }
    expect(overviewRect.left).toBeGreaterThanOrEqual(0);
    expect(overviewRect.top).toBeGreaterThanOrEqual(0);
    expect(overviewRect.right).toBeLessThanOrEqual(overviewRect.innerWidth);
    expect(overviewRect.bottom).toBeLessThanOrEqual(overviewRect.innerHeight);

    // Native WDIO click (not jsClick) so pointer hit-testing detects any
    // blocking overlay or pointer-events:none on the map pin — jsClick's
    // synthetic el.click() bypasses both.
    const mapPin = await $(
      `[data-map-destination="${anchors.firstMapDestination}"]`,
    );
    await mapPin.click();
    await expectCrossedToRainBellInvestigation();
  });

  it("crosses the same first destination with Tab and Enter from fresh setup", async function () {
    if (!e2eXvfbTrustedKeysEnabled()) {
      const reason =
        "Map keyboard coverage is inconclusive: verified private-Xvfb XTEST is not opted in or unavailable.";
      console.warn(`[MapKeyboard] ${reason}`);
      if (process.env.LYRA_E2E_OUTPUT_DIR) {
        writeFileSync(
          path.join(
            process.env.LYRA_E2E_OUTPUT_DIR,
            "map-keyboard-coverage-gap.json",
          ),
          `${JSON.stringify({ coverage: "inconclusive", reason }, null, 2)}\n`,
        );
      }
      this.skip();
      return;
    }
    await setupAtFirstMapGate();
    expect(await enabledMapDestinationIds()).toEqual([
      anchors.firstMapDestination,
    ]);

    // jumpToProductionScene leaves focus on a since-unmounted menu control.
    // WebKit performs Tab traversal from the active element, so seed a real
    // starting point inside the gameplay focus order first; the acceptance
    // stays on the native path: Tab must still reach the pin, Enter activate
    // it.
    const seeded = await browser.execute((selector: string) => {
      const control = document.querySelector<HTMLButtonElement>(selector);
      if (
        !control ||
        control.disabled ||
        control.hasAttribute("data-map-destination")
      )
        return false;
      control.focus();
      return document.activeElement === control;
    }, anchors.mapOverviewSelector);
    expect(seeded).toBe(true);

    await browser.execute(() => {
      const observed = window as Window & {
        mapKeyEvents?: {
          key: string;
          trusted: boolean;
          destination: string | null;
        }[];
      };
      observed.mapKeyEvents = [];
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Tab" || event.key === "Enter") {
            observed.mapKeyEvents?.push({
              key: event.key,
              trusted: event.isTrusted,
              destination:
                (event.target as HTMLElement | null)?.getAttribute(
                  "data-map-destination",
                ) ?? null,
            });
          }
        },
        { capture: true },
      );
    });

    const deliverMapKey = async (key: "Tab" | "Enter") => {
      try {
        await sendXvfbTrustedKey(key);
      } catch (cause) {
        throw new Error(
          `[MapKeyboard] verified ${key} delivery failed; keyboard coverage is inconclusive`,
          { cause },
        );
      }
    };
    let focused = false;
    for (let attempt = 0; attempt < 7 && !focused; attempt += 1) {
      await deliverMapKey("Tab");
      for (let poll = 0; poll < 12 && !focused; poll += 1) {
        focused = await browser.execute(
          (destinationId: string) =>
            (document.activeElement as HTMLElement | null)?.getAttribute(
              "data-map-destination",
            ) === destinationId,
          anchors.firstMapDestination,
        );
        if (!focused) await browser.pause(100);
      }
    }
    if (!focused) {
      throw new Error("Tab never focused the sole city-map destination");
    }
    await deliverMapKey("Enter");
    await expectCrossedToRainBellInvestigation();
    const keys = await browser.execute(() => {
      const observed = window as Window & {
        mapKeyEvents?: {
          key: string;
          trusted: boolean;
          destination: string | null;
        }[];
      };
      return observed.mapKeyEvents ?? [];
    });
    expect(keys.some((event) => event.key === "Tab" && event.trusted)).toBe(
      true,
    );
    expect(
      keys.some(
        (event) =>
          event.key === "Enter" &&
          event.trusted &&
          event.destination === anchors.firstMapDestination,
      ),
    ).toBe(true);
  });

  // --- HPA-853 chapter-2 placement surface ---------------------------------

  it("pins the fully-placed 72-target HPA-853 inventory", () => {
    const hpa853Targets = shippedTargets().filter((target) =>
      HPA853_SCENE_NUMBERS.some((scene) =>
        target.id.startsWith(`chapter_2/investigation_scene_${scene}/`),
      ),
    );
    // Design contract: 17 sublocations carrying 59 hotspots + 13 characters.
    // Target ids have four segments (chapter/scene/sublocation/target), so
    // the sublocation key is the first three — slicing four would keep the
    // target segment and the set would just count all 72 targets.
    const sublocationIds = new Set(
      hpa853Targets.map((target) => target.id.split("/").slice(0, 3).join("/")),
    );
    expect(sublocationIds.size).toBe(17);
    expect(hpa853Targets.length).toBe(72);

    // The zero-fallback gate is armed: the unplaced set must be exactly
    // the declared pending list — now empty — so any target silently
    // losing its layout fails here.
    const unplacedIds = hpa853Targets
      .filter((target) => target.layout === null)
      .map((target) => target.id)
      .toSorted();
    expect(unplacedIds).toEqual([...EXPECTED_UNPLACED_TARGETS].toSorted());

    // The packaged all-placement sweep checks authored centers on the actual
    // stage; live sublocation probes below also reject unprobed centers.
  });

  it("physically measures a synthetic long-title and objective HUD", async () => {
    await loadPackagedCheckpoint("chapter-2-investigation-layout-scene-4");
    await ensureMinimumWindowViewport();
    const title = "雨夜證物調查室".repeat(40);
    const objective = "追查雨夜目擊者並核對所有證詞。".repeat(40);

    // Render the actual component as static test markup with the packaged CSS
    // scope; the checkpoint, backend and story remain unchanged.
    const scope = await browser.execute(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule instanceof CSSStyleRule) {
              const match = rule.selectorText.match(
                /\.primary-objective-hud\.(svelte-[\w-]+)/,
              );
              if (match) return match[1];
            }
          }
        } catch {
          // Some WebViews deny CSSOM access to unrelated stylesheets.
        }
      }
      return null;
    });
    if (!scope) throw new Error("Packaged objective CSS scope not found");
    const sourcePath = path.join(
      process.cwd(),
      "src/lib/components/PrimaryObjectiveHud.svelte",
    );
    const compiled = compile(readFileSync(sourcePath, "utf8"), {
      filename: sourcePath,
      generate: "server",
      cssHash: () => scope,
    });
    const outputDir = process.env.LYRA_E2E_OUTPUT_DIR ?? process.cwd();
    const modulePath = path.join(outputDir, `hud-fixture-${process.pid}.mjs`);
    writeFileSync(modulePath, compiled.js.code);
    let body: string;
    try {
      const component = (await import(pathToFileURL(modulePath).href)).default;
      body = render(component, {
        props: {
          compact: true,
          objective: { label: objective },
        },
      }).body;
    } finally {
      unlinkSync(modulePath);
    }

    await browser.execute(
      (fixtureTitle: string, fixtureBody: string) => {
        const location = document.querySelector<HTMLElement>(
          ".scene-label strong",
        );
        const activeChip = document.querySelector<HTMLElement>(
          ".explore-hud .chips button.active .label",
        );
        const menu = document.querySelector<HTMLElement>(
          ".explore-hud [data-game-menu-trigger]",
        );
        if (
          !location ||
          !activeChip ||
          !menu ||
          document.querySelector(".explore-hud .primary-objective-hud")
        ) {
          throw new Error("Unexpected synthetic HUD fixture host");
        }
        location.textContent = fixtureTitle;
        activeChip.textContent = fixtureTitle;
        menu.insertAdjacentHTML("beforebegin", fixtureBody);
      },
      title,
      body,
    );
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const header = document.querySelector(".scene-hud");
          const stage = document.querySelector(".scene-stage");
          return (
            !!header &&
            !!stage &&
            Math.abs(
              header.getBoundingClientRect().bottom -
                stage.getBoundingClientRect().top,
            ) < 1
          );
        }),
      { timeout: 10000, timeoutMsg: "Synthetic HUD height did not settle" },
    );
    const fixture = await browser.execute(() => {
      const location = document.querySelector<HTMLElement>(".scene-label")!;
      const objectiveRegion = document.querySelector<HTMLElement>(
        '.primary-objective-hud [aria-label="主要目標內容"]',
      )!;
      const header = document.querySelector<HTMLElement>(".scene-hud")!;
      const stage = document.querySelector<HTMLElement>(".scene-stage")!;
      const chips = document.querySelector<HTMLElement>(".explore-hud .chips")!;
      const side = document.querySelector<HTMLElement>(
        ".explore-hud .hud-side",
      )!;
      const nav = chips.closest("nav")!;
      const region = (element: HTMLElement) => ({
        text: element.textContent ?? "",
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        tabIndex: element.tabIndex,
        overflowY: getComputedStyle(element).overflowY,
      });
      return {
        provenance: "synthetic-static-svelte-component-in-packaged-hud",
        viewport: { width: innerWidth, height: innerHeight },
        header: header.getBoundingClientRect().height,
        stage: stage.getBoundingClientRect().height,
        rowOne: Math.max(
          location.getBoundingClientRect().height,
          side.getBoundingClientRect().height,
        ),
        rowTwo: nav.getBoundingClientRect().height,
        location: region(location),
        objective: region(objectiveRegion),
        chipTops: Array.from(
          chips.querySelectorAll("button"),
          (button) => button.getBoundingClientRect().top,
        ),
        chipHeights: Array.from(
          chips.querySelectorAll("button"),
          (button) => button.getBoundingClientRect().height,
        ),
        chipClientWidth: chips.clientWidth,
        chipScrollWidth: chips.scrollWidth,
      };
    });
    expect(fixture.viewport).toEqual(MINIMUM_WINDOW);
    expect(fixture.header).toBeLessThanOrEqual(150);
    expect(fixture.stage).toBeGreaterThanOrEqual(450);
    expect(fixture.rowOne).toBeLessThanOrEqual(74);
    expect(fixture.rowTwo).toBeLessThanOrEqual(54);
    expect(fixture.location.text).toContain(title);
    expect(fixture.objective.text).toBe(objective);
    for (const region of [fixture.location, fixture.objective]) {
      expect(region.tabIndex).toBe(0);
      expect(region.overflowY).toBe("auto");
      expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
    }
    expect(fixture.chipTops).toHaveLength(5);
    expect(new Set(fixture.chipTops).size).toBe(1);
    expect(fixture.chipHeights.every((height) => height >= 44)).toBe(true);
    expect(fixture.chipScrollWidth).toBeGreaterThan(fixture.chipClientWidth);
    await browser.saveScreenshot(
      path.join(outputDir, "synthetic-long-hud-top.png"),
    );
    const scrolled = await browser.execute(() => {
      const location = document.querySelector<HTMLElement>(".scene-label")!;
      const objectiveRegion = document.querySelector<HTMLElement>(
        '.primary-objective-hud [aria-label="主要目標內容"]',
      )!;
      return [location, objectiveRegion].map((element) => {
        element.focus();
        const focused = document.activeElement === element;
        element.scrollTop = element.scrollHeight;
        return {
          focused,
          top: element.scrollTop,
          reachesEnd:
            element.scrollTop + element.clientHeight >=
            element.scrollHeight - 1,
        };
      });
    });
    expect(
      scrolled.every(
        (region) => region.focused && region.top > 0 && region.reachesEnd,
      ),
    ).toBe(true);
    await browser.saveScreenshot(
      path.join(outputDir, "synthetic-long-hud-bottom.png"),
    );
    writeFileSync(
      path.join(outputDir, "synthetic-long-hud.json"),
      JSON.stringify({ ...fixture, scrolled }, null, 2),
    );
  });

  it("exercises the real five-chip scene navigation overflow", async function () {
    await loadPackagedCheckpoint("chapter-2-investigation-layout-scene-4");
    await ensureMinimumWindowViewport();
    const state = await getPackagedGameState();
    if (state.scene.kind !== "investigation") {
      throw new Error("Scene 4 checkpoint is not an investigation");
    }
    expect(state.scene.visibleSublocations).toHaveLength(5);
    const nav = await browser.execute(() => {
      const chips = document.querySelector<HTMLElement>(".explore-hud .chips")!;
      const buttons = Array.from(chips.querySelectorAll("button"));
      return {
        clientWidth: chips.clientWidth,
        scrollWidth: chips.scrollWidth,
        tops: buttons.map((button) => button.getBoundingClientRect().top),
        heights: buttons.map((button) => button.getBoundingClientRect().height),
      };
    });
    expect(nav.tops).toHaveLength(5);
    expect(new Set(nav.tops).size).toBe(1);
    expect(nav.heights.every((height) => height >= 44)).toBe(true);
    expect(nav.scrollWidth).toBeGreaterThan(nav.clientWidth);
    const outputDir = process.env.LYRA_E2E_OUTPUT_DIR ?? process.cwd();
    if (!e2eXvfbTrustedKeysEnabled()) {
      writeFileSync(
        path.join(outputDir, "scene-nav-pointer-coverage-gap.json"),
        JSON.stringify(
          {
            coverage: "inconclusive",
            reason: "Private-Xvfb XTEST was not opted in.",
          },
          null,
          2,
        ),
      );
      console.warn(
        "[SceneNav] trusted pointer coverage inconclusive: XTEST not opted in",
      );
      this.skip();
    }
    await browser.execute(() => {
      const chips = document.querySelector<HTMLElement>(".explore-hud .chips")!;
      chips.scrollLeft = 0;
      document.documentElement.dataset.hpa852Wheels = "[]";
      document.addEventListener(
        "wheel",
        (event) => {
          const root = document.documentElement;
          const events = JSON.parse(root.dataset.hpa852Wheels ?? "[]");
          events.push({
            trusted: event.isTrusted,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            targetInChips:
              event.target instanceof Node && chips.contains(event.target),
          });
          root.dataset.hpa852Wheels = JSON.stringify(events);
        },
        { capture: true },
      );
    });
    const wheelState = () =>
      browser.execute(() => {
        const chips = document.querySelector<HTMLElement>(
          ".explore-hud .chips",
        )!;
        const last = chips.querySelector<HTMLElement>("button:last-child")!;
        const bounds = chips.getBoundingClientRect();
        const lastBounds = last.getBoundingClientRect();
        return {
          position: chips.scrollLeft,
          events: JSON.parse(
            document.documentElement.dataset.hpa852Wheels ?? "[]",
          ) as Array<{
            trusted: boolean;
            deltaX: number;
            deltaY: number;
            targetInChips: boolean;
          }>,
          lastVisible:
            lastBounds.left >= bounds.left - 1 &&
            lastBounds.right <= bounds.right + 1,
        };
      });
    let pointerError = "";
    const transport: Array<
      Awaited<ReturnType<typeof sendXvfbTrustedSceneNavPointer>>
    > = [];
    let wheel = await wheelState();
    for (let attempt = 0; attempt < 8 && !wheel.lastVisible; attempt += 1) {
      const before = wheel;
      try {
        transport.push(await sendXvfbTrustedSceneNavPointer("move", "chips"));
        await deliverX11PointerPair({
          pointerState: xvfbPointerState(),
          button: "wheel",
          press: async () => {
            transport.push(
              await sendXvfbTrustedSceneNavPointer("wheel-press", "chips"),
            );
          },
          release: async () => {
            transport.push(
              await sendXvfbTrustedSceneNavPointer("wheel-release", "chips"),
            );
          },
        });
      } catch (error) {
        pointerError = describeX11InputError(error);
        writeFileSync(
          path.join(outputDir, "scene-nav-pointer-events.json"),
          JSON.stringify({ wheel, pointerError, transport }, null, 2),
        );
        assertSafeXvfbDisplay(this);
      }
      await browser
        .waitUntil(
          async () => (await wheelState()).events.length > before.events.length,
          { timeout: 2000, interval: 50 },
        )
        .catch(() => {});
      wheel = await wheelState();
      const delivered = wheel.events.slice(before.events.length);
      if (delivered.some((event) => event.trusted)) {
        await browser
          .waitUntil(
            async () => (await wheelState()).position > before.position,
            { timeout: 2000, interval: 50 },
          )
          .catch(() => {});
        wheel = await wheelState();
      }
      writeFileSync(
        path.join(outputDir, "scene-nav-pointer-events.json"),
        JSON.stringify({ wheel, pointerError, transport }, null, 2),
      );
      const trusted = assertSceneNavWheelProgress(
        delivered,
        before.position,
        wheel.position,
      );
      if (trusted && pointerError) throw new Error(pointerError);
      if (pointerError || !trusted) break;
    }
    const pointerDelivered = wheel.events.some((event) => event.trusted);
    if (pointerError && pointerDelivered) throw new Error(pointerError);
    if (pointerError || !pointerDelivered) {
      console.warn(
        `[SceneNav] pointer delivery is inconclusive: ${JSON.stringify({ pointerError, wheel })}`,
      );
      writeFileSync(
        path.join(outputDir, "scene-nav-pointer-coverage-gap.json"),
        JSON.stringify(
          { coverage: "inconclusive", pointerError, wheel, transport },
          null,
          2,
        ),
      );
      this.skip();
    } else {
      expect(wheel.lastVisible).toBe(true);
      console.log(
        `[SceneNav] trusted pointer scroll: ${JSON.stringify(wheel)}`,
      );
      await browser.saveScreenshot(
        path.join(outputDir, "scene-nav-scrolled.png"),
      );
      await browser.execute(() => {
        document.documentElement.dataset.hpa852PointerEvents = "[]";
        for (const type of ["pointerdown", "pointerup", "click"]) {
          document.addEventListener(
            type,
            (event) => {
              const root = document.documentElement;
              const last = document.querySelector<HTMLButtonElement>(
                ".explore-hud .chips button:last-child",
              );
              const chips = document.querySelector<HTMLElement>(
                ".explore-hud .chips",
              );
              const lastBounds = last?.getBoundingClientRect();
              const bounds = chips?.getBoundingClientRect();
              const events = JSON.parse(
                root.dataset.hpa852PointerEvents ?? "[]",
              );
              events.push({
                type,
                trusted: event.isTrusted,
                targetIsLast:
                  !!last &&
                  event.target instanceof Node &&
                  last.contains(event.target),
                lastVisible:
                  !!lastBounds &&
                  !!bounds &&
                  lastBounds.left >= bounds.left - 1 &&
                  lastBounds.right <= bounds.right + 1,
              });
              root.dataset.hpa852PointerEvents = JSON.stringify(events);
            },
            { capture: true },
          );
        }
      });
      let clickError = "";
      try {
        transport.push(
          await sendXvfbTrustedSceneNavPointer("move", "last-chip"),
        );
        await deliverX11PointerPair({
          pointerState: xvfbPointerState(),
          button: "click",
          press: async () => {
            transport.push(
              await sendXvfbTrustedSceneNavPointer("click-press", "last-chip"),
            );
          },
          release: async () => {
            transport.push(
              await sendXvfbTrustedSceneNavPointer(
                "click-release",
                "last-chip",
              ),
            );
          },
        });
      } catch (error) {
        clickError = describeX11InputError(error);
        writeFileSync(
          path.join(outputDir, "scene-nav-pointer-events.json"),
          JSON.stringify({ wheel, clickError, transport }, null, 2),
        );
        assertSafeXvfbDisplay(this);
      }
      const pointerEvents = await browser.execute(
        () =>
          JSON.parse(
            document.documentElement.dataset.hpa852PointerEvents ?? "[]",
          ) as Array<{
            type: string;
            trusted: boolean;
            targetIsLast: boolean;
            lastVisible: boolean;
          }>,
      );
      writeFileSync(
        path.join(outputDir, "scene-nav-pointer-events.json"),
        JSON.stringify(
          { wheel, pointerEvents, clickError, transport },
          null,
          2,
        ),
      );
      const delivered = assertSceneNavPointerEvents(pointerEvents);
      if ((delivered.down && delivered.up) || delivered.click) {
        await advanceDialogueUntil(async () => {
          const state = await getPackagedGameState();
          return (
            state.scene.kind === "investigation" &&
            state.scene.id === "investigation_scene_4" &&
            state.scene.currentSublocationId === "police_review_van" &&
            state.mode.type === "explore"
          );
        });
      }
      if (clickError && (delivered.down || delivered.up || delivered.click)) {
        throw new Error(clickError);
      }
      const measured = delivered.down && delivered.up && delivered.click;
      writeFileSync(
        path.join(
          outputDir,
          measured
            ? "scene-nav-pointer.json"
            : "scene-nav-pointer-coverage-gap.json",
        ),
        JSON.stringify(
          {
            coverage: measured ? "measured" : "inconclusive",
            wheel,
            pointerEvents,
            clickError,
            transport,
          },
          null,
          2,
        ),
      );
      if (!measured) this.skip();
    }
  });

  it("traverses and activates the last scene chip with trusted keyboard input", async function () {
    const outputDir = process.env.LYRA_E2E_OUTPUT_DIR ?? process.cwd();
    if (!e2eXvfbTrustedKeysEnabled()) {
      writeFileSync(
        path.join(outputDir, "scene-nav-keyboard-coverage-gap.json"),
        JSON.stringify(
          {
            coverage: "inconclusive",
            reason: "Private-Xvfb XTEST was not opted in.",
          },
          null,
          2,
        ),
      );
      console.warn(
        "[SceneNav] trusted keyboard coverage inconclusive: XTEST not opted in",
      );
      this.skip();
    }
    await loadPackagedCheckpoint("chapter-2-investigation-layout-scene-4");
    await ensureMinimumWindowViewport();
    await browser.execute(() => {
      const chips = document.querySelector<HTMLElement>(".explore-hud .chips")!;
      const first = chips.querySelector<HTMLButtonElement>("button")!;
      chips.scrollLeft = 0;
      first.focus();
      document.documentElement.dataset.hpa852Keys = "[]";
      document.addEventListener(
        "keydown",
        (event) => {
          const root = document.documentElement;
          const events = JSON.parse(root.dataset.hpa852Keys ?? "[]") as Array<{
            key: string;
            trusted: boolean;
            targetIndex: number;
          }>;
          const buttons = Array.from(
            document.querySelectorAll(".explore-hud .chips button"),
          );
          events.push({
            key: event.key,
            trusted: event.isTrusted,
            targetIndex: buttons.findIndex(
              (button) =>
                event.target instanceof Node && button.contains(event.target),
            ),
          });
          root.dataset.hpa852Keys = JSON.stringify(events);
        },
        { capture: true },
      );
    });
    const keyboardState = () =>
      browser.execute(() => {
        const chips = document.querySelector<HTMLElement>(
          ".explore-hud .chips",
        )!;
        const buttons = Array.from(chips.querySelectorAll("button"));
        const bounds = chips.getBoundingClientRect();
        const last = buttons[buttons.length - 1]!.getBoundingClientRect();
        return {
          activeIndex: buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          ),
          scrollLeft: chips.scrollLeft,
          lastVisible:
            last.left >= bounds.left - 1 && last.right <= bounds.right + 1,
          events: JSON.parse(
            document.documentElement.dataset.hpa852Keys ?? "[]",
          ) as Array<{
            key: string;
            trusted: boolean;
            targetIndex: number;
          }>,
        };
      });
    let keyboard = await keyboardState();
    expect(keyboard.activeIndex).toBe(0);
    let keyError = "";
    const traversal: Array<{
      step: number;
      activeIndex: number;
      scrollLeft: number;
      lastVisible: boolean;
      event: { key: string; trusted: boolean; targetIndex: number } | undefined;
    }> = [];
    for (let index = 0; index < 4; index += 1) {
      try {
        await sendXvfbTrustedKey("Tab");
      } catch (error) {
        keyError = describeX11InputError(error);
      }
      await browser
        .waitUntil(async () => (await keyboardState()).events.length > index, {
          timeout: 2000,
          interval: 50,
        })
        .catch(() => {});
      keyboard = await keyboardState();
      const event = keyboard.events[index];
      if (event?.trusted && event.key === "Tab") {
        await browser
          .waitUntil(
            async () => {
              const current = await keyboardState();
              return (
                current.activeIndex === index + 1 &&
                (index !== 3 || current.lastVisible)
              );
            },
            { timeout: 2000, interval: 50 },
          )
          .catch(() => {});
        keyboard = await keyboardState();
      }
      traversal.push({
        step: index + 1,
        activeIndex: keyboard.activeIndex,
        scrollLeft: keyboard.scrollLeft,
        lastVisible: keyboard.lastVisible,
        event,
      });
      writeFileSync(
        path.join(outputDir, "scene-nav-keyboard-events.json"),
        JSON.stringify({ keyboard, traversal, keyError }, null, 2),
      );
      const trusted = assertSceneNavTabProgress(
        event,
        index + 1,
        keyboard.activeIndex,
        keyboard.lastVisible,
      );
      if (trusted && keyError) throw new Error(keyError);
      if (keyError || !trusted) break;
    }
    const tabsDelivered =
      keyboard.events.filter((event) => event.key === "Tab" && event.trusted)
        .length === 4;
    if (!tabsDelivered || keyError) {
      console.warn(
        `[SceneNav] keyboard delivery is inconclusive: ${JSON.stringify({ keyboard, keyError })}`,
      );
      writeFileSync(
        path.join(outputDir, "scene-nav-keyboard-coverage-gap.json"),
        JSON.stringify(
          { coverage: "inconclusive", keyboard, traversal, keyError },
          null,
          2,
        ),
      );
      this.skip();
    }
    expect(keyboard.activeIndex).toBe(4);
    expect(keyboard.lastVisible).toBe(true);
    await browser.saveScreenshot(
      path.join(outputDir, "scene-nav-keyboard-focused.png"),
    );
    try {
      await sendXvfbTrustedKey("Enter");
    } catch (error) {
      keyError = describeX11InputError(error);
    }
    await browser
      .waitUntil(
        async () =>
          (
            await browser.execute(
              () =>
                JSON.parse(
                  document.documentElement.dataset.hpa852Keys ?? "[]",
                ) as Array<{ key: string }>,
            )
          ).some((event) => event.key === "Enter"),
        { timeout: 2000, interval: 50 },
      )
      .catch(() => {});
    const events = await browser.execute(
      () =>
        JSON.parse(
          document.documentElement.dataset.hpa852Keys ?? "[]",
        ) as Array<{ key: string; trusted: boolean; targetIndex: number }>,
    );
    const enterEvent = events.find(
      (event) => event.key === "Enter" && event.trusted,
    );
    const enterTrusted = !!enterEvent;
    writeFileSync(
      path.join(outputDir, "scene-nav-keyboard-events.json"),
      JSON.stringify({ keyboard, traversal, events, keyError }, null, 2),
    );
    if (enterTrusted) {
      expect(enterEvent.targetIndex).toBe(4);
      await advanceDialogueUntil(async () => {
        const state = await getPackagedGameState();
        return (
          state.scene.kind === "investigation" &&
          state.scene.currentSublocationId === "police_review_van" &&
          state.mode.type === "explore"
        );
      });
      if (keyError) throw new Error(keyError);
    }
    const measured = enterTrusted && !keyError;
    const evidence = {
      coverage: measured ? "measured" : "inconclusive",
      keyboard,
      traversal,
      events,
      keyError,
    };
    console.log("[SceneNav] keyboard evidence", JSON.stringify(evidence));
    writeFileSync(
      path.join(
        outputDir,
        measured
          ? "scene-nav-keyboard.json"
          : "scene-nav-keyboard-coverage-gap.json",
      ),
      JSON.stringify(evidence, null, 2),
    );
    if (!measured) this.skip();
  });

  for (const sceneNumber of HPA853_SCENE_NUMBERS) {
    const sceneId: `investigation_scene_${(typeof HPA853_SCENE_NUMBERS)[number]}` = `investigation_scene_${sceneNumber}`;
    it(`measures HUD rects, hit routing and the full location bar across every ${sceneId} sublocation at 800x600`, async () => {
      await loadPackagedCheckpoint(HPA853_LAYOUT_CHECKPOINTS[sceneNumber]);
      await waitForPackagedGameState(
        (state) =>
          isExploreInScene(state, sceneId) &&
          state.scene.kind === "investigation" &&
          state.scene.currentSublocationId !== null,
        30000,
        `layout-ready checkpoint for ${sceneId} did not land in Explore`,
      );
      await ensureMinimumWindowViewport();

      const state = await getPackagedGameState();
      if (
        !isExploreInScene(state, sceneId) ||
        state.scene.kind !== "investigation"
      ) {
        throw new Error(`packaged state left ${sceneId} during setup`);
      }
      const investigation = state.scene;

      // The fixture unlocks every authored chip without puzzle work; overflow
      // stays on one scrollable row instead of removing a location.
      const expectedChips = HPA853_SUBLOCATION_COUNTS[sceneId];
      expect(investigation.visibleSublocations.length).toBe(expectedChips);
      expect(
        await browser.execute(
          () =>
            document.querySelectorAll(".explore-hud nav .chips button").length,
        ),
      ).toBe(expectedChips);

      const scenePlacements = shippedPlacements().filter((placement) =>
        placement.id.startsWith(`chapter_2/${sceneId}/`),
      );
      const measuredSublocationIds: string[] = [];
      for (const sublocation of investigation.visibleSublocations) {
        if (sublocation.id !== investigation.currentSublocationId) {
          await enterSublocationThroughNav(sceneId, sublocation);
          await waitForSceneSurface(sublocation);
        }
        await expectHpa853SublocationSurface(
          sceneId,
          sublocation,
          scenePlacements,
          investigation.outroProgress?.total ?? 0,
        );
        measuredSublocationIds.push(sublocation.id);
      }
      // Every compiled sublocation in the scene was measured through the
      // live surface — 17 of 17 across the six scenes — not merely the
      // ones the runtime chose to expose. Per-sublocation coverage above
      // then accounts for every compiled placement (live button or locked
      // projection) and every unplaced target (OFF-SCENE panel + the
      // sidecar-level exact-set pin). Nothing here claims the final
      // zero-fallback gate.
      // One entry per sublocation, not per target — multi-target
      // sublocations must not duplicate the expected id.
      const compiledSublocationIds = [
        ...new Set(
          shippedTargets()
            .filter((target) => target.id.startsWith(`chapter_2/${sceneId}/`))
            .map((target) => target.id.split("/").slice(2, 3).join("/")),
        ),
      ].toSorted();
      expect(measuredSublocationIds.toSorted()).toEqual(compiledSublocationIds);
    });
  }

  // Scene 4 is the shared-header regression guard, not an HPA-853 scene:
  // its five-chip bar exercises the shared header alongside the six HPA-853
  // checkpoints.
  it("keeps existing scene 4 placements on the art under the shared stage header at 800x600", async () => {
    const sceneId = "investigation_scene_4";
    await loadPackagedCheckpoint("chapter-2-investigation-layout-scene-4");
    await waitForPackagedGameState(
      (state) =>
        isExploreInScene(state, sceneId) &&
        state.scene.kind === "investigation" &&
        state.scene.currentSublocationId !== null,
      30000,
      `layout-ready checkpoint for ${sceneId} did not land in Explore`,
    );
    await ensureMinimumWindowViewport();

    const state = await getPackagedGameState();
    if (
      !isExploreInScene(state, sceneId) ||
      state.scene.kind !== "investigation"
    ) {
      throw new Error(`packaged state left ${sceneId} during setup`);
    }
    const investigation = state.scene;

    // All five authored chips are rendered in one row by this checkpoint.
    expect(investigation.visibleSublocations.length).toBe(5);
    expect(
      await browser.execute(
        () =>
          document.querySelectorAll(".explore-hud nav .chips button").length,
      ),
    ).toBe(5);
    const chipTops = await browser.execute(() =>
      Array.from(
        document.querySelectorAll(".explore-hud nav .chips button"),
        (chip) => chip.getBoundingClientRect().top,
      ),
    );
    expect(new Set(chipTops).size).toBe(1);

    const scenePlacements = shippedPlacements().filter((placement) =>
      placement.id.startsWith(`chapter_2/${sceneId}/`),
    );
    for (const sublocation of investigation.visibleSublocations) {
      if (sublocation.id !== investigation.currentSublocationId) {
        if (sublocation.id === "police_review_van") {
          const hidden = await browser.execute(() => {
            const chips = document.querySelector<HTMLElement>(
              ".explore-hud .chips",
            )!;
            chips.scrollLeft = 0;
            const last = chips.querySelector<HTMLElement>("button:last-child")!;
            return (
              last.getBoundingClientRect().right >
              chips.getBoundingClientRect().right
            );
          });
          expect(hidden).toBe(true);
        }
        await enterSublocationThroughNav(sceneId, sublocation);
        await waitForSceneSurface(sublocation);
      }
      await expectHpa853SublocationSurface(
        sceneId,
        sublocation,
        scenePlacements,
        investigation.outroProgress?.total ?? 0,
      );
    }
  });

  // Normalized bounds of the baked heads in the original background artwork.
  const faceChecks: Array<
    [
      12 | 14,
      Array<{
        id: string;
        left: number;
        top: number;
        right: number;
        bottom: number;
      }>,
    ]
  > = [
    [
      12,
      [
        {
          id: "truck_console",
          left: 0.237,
          top: 0.17,
          right: 0.326,
          bottom: 0.404,
        },
        {
          id: "box_left_side",
          left: 0.68,
          top: 0.155,
          right: 0.73,
          bottom: 0.26,
        },
      ],
    ],
    [
      14,
      [
        {
          id: "backstage_rear",
          left: 0.744,
          top: 0.16,
          right: 0.795,
          bottom: 0.27,
        },
        {
          id: "sponsor_corridor",
          left: 0.29,
          top: 0.08,
          right: 0.345,
          bottom: 0.21,
        },
        {
          id: "disaster_center",
          left: 0.182,
          top: 0.145,
          right: 0.238,
          bottom: 0.26,
        },
      ],
    ],
  ];
  for (const [sceneNumber, faces] of faceChecks) {
    it(`keeps baked faces clear of the HUD in scene ${sceneNumber} at 800x600`, async () => {
      const sceneId = `investigation_scene_${sceneNumber}`;
      await loadPackagedCheckpoint(HPA853_LAYOUT_CHECKPOINTS[sceneNumber]);
      await waitForPackagedGameState(
        (state) =>
          isExploreInScene(state, sceneId) &&
          state.scene.kind === "investigation" &&
          state.scene.currentSublocationId !== null,
        30000,
      );
      await ensureMinimumWindowViewport();
      const state = await getPackagedGameState();
      if (state.scene.kind !== "investigation")
        throw new Error("Not investigating");
      const scene = state.scene;
      let currentSublocationId = scene.currentSublocationId;
      const chipTops = await browser.execute(() =>
        Array.from(
          document.querySelectorAll(".explore-hud nav .chips button"),
          (chip) => chip.getBoundingClientRect().top,
        ),
      );
      expect(chipTops).toHaveLength(4);
      expect(new Set(chipTops).size).toBe(1);

      for (const face of faces) {
        const sublocation = scene.visibleSublocations.find(
          (sub) => sub.id === face.id,
        );
        if (!sublocation) throw new Error(`Missing sublocation ${face.id}`);
        if (face.id !== currentSublocationId) {
          await enterSublocationThroughNav(sceneId, sublocation);
          currentSublocationId = face.id;
        }
        await waitForSceneSurface(sublocation);
        await browser.waitUntil(
          () =>
            browser.execute((id: string) => {
              const image = document.querySelector<HTMLImageElement>(
                `img.background-image[src*="/${id}.png"]`,
              );
              return !!image && image.complete && image.naturalWidth > 0;
            }, face.id),
          { timeout: 30000, timeoutMsg: `Background ${face.id} did not load` },
        );
        const measurement = await browser.execute((bounds) => {
          const image = document.querySelector<HTMLImageElement>(
            `img.background-image[src*="/${bounds.id}.png"]`,
          );
          if (!image) throw new Error(`Background ${bounds.id} missing`);
          const rect = image.getBoundingClientRect();
          const scale = Math.min(
            rect.width / image.naturalWidth,
            rect.height / image.naturalHeight,
          );
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          const left = rect.left + (rect.width - width) / 2;
          const top = rect.top + (rect.height - height) / 2;
          const faceRect = {
            left: left + bounds.left * width,
            top: top + bounds.top * height,
            right: left + bounds.right * width,
            bottom: top + bounds.bottom * height,
          };
          const hud = Array.from(
            document.querySelectorAll(
              ".explore-hud nav, .investigation-progress, .primary-objective-hud, .scene-label",
            ),
            (element) => {
              const box = element.getBoundingClientRect();
              return {
                left: box.left,
                top: box.top,
                right: box.right,
                bottom: box.bottom,
              };
            },
          );
          const panel = document.querySelector(".scene-hud");
          if (panel) {
            const background = getComputedStyle(panel).backgroundColor;
            if (
              background !== "transparent" &&
              background !== "rgba(0, 0, 0, 0)"
            ) {
              const box = panel.getBoundingClientRect();
              hud.push({
                left: box.left,
                top: box.top,
                right: box.right,
                bottom: box.bottom,
              });
            }
          }
          return {
            face: faceRect,
            image: {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            },
            hud,
          };
        }, face);
        expect(measurement.face.left).toBeGreaterThanOrEqual(
          measurement.image.left,
        );
        expect(measurement.face.top).toBeGreaterThanOrEqual(
          measurement.image.top,
        );
        expect(measurement.face.right).toBeLessThanOrEqual(
          measurement.image.right,
        );
        expect(measurement.face.bottom).toBeLessThanOrEqual(
          measurement.image.bottom,
        );
        expect(
          measurement.hud.filter((rect) =>
            intersectsBox(rect, measurement.face),
          ),
        ).toEqual([]);
      }
    });
  }

  it("keeps the revealed board_underlayer from stealing planning_board's center in studio_room", async () => {
    const sceneId = "investigation_scene_16";
    await loadPackagedCheckpoint(HPA853_LAYOUT_CHECKPOINTS[16]);
    await waitForPackagedGameState(
      (state) =>
        isExploreInScene(state, sceneId) &&
        state.scene.kind === "investigation" &&
        state.scene.currentSublocationId !== null,
      30000,
      "layout-ready checkpoint for investigation_scene_16 did not land in Explore",
    );
    await ensureMinimumWindowViewport();

    const isStudioRoom = (sub: SublocationView) => sub.id === "studio_room";
    let state = await getPackagedGameState();
    if (
      !isExploreInScene(state, sceneId) ||
      state.scene.kind !== "investigation"
    ) {
      throw new Error(
        "packaged state left investigation_scene_16 during setup",
      );
    }
    const initial = state.scene;
    const sublocation = initial.visibleSublocations.find(isStudioRoom);
    if (!sublocation) {
      throw new Error(
        "studio_room missing from scene 16's visible sublocations",
      );
    }
    if (initial.currentSublocationId !== sublocation.id) {
      await enterSublocationThroughNav(sceneId, sublocation);
      await waitForSceneSurface(sublocation);
    }

    const scenePlacements = shippedPlacements().filter((placement) =>
      placement.id.startsWith(`chapter_2/${sceneId}/`),
    );
    const outroTotal = initial.outroProgress?.total ?? 0;

    // The page beneath the printout is authored locked behind the planning
    // board: before the reveal it is projected-only and claims no routing.
    // Every strict gate still runs on this first pass.
    await expectHpa853SublocationSurface(
      sceneId,
      sublocation,
      scenePlacements,
      outroTotal,
    );

    // The reveal must be a real state change: pre-inspection the underlayer
    // is absent from both the runtime view and the live surface, so its
    // presence afterwards cannot pass vacuously.
    expect(sublocation.hotspots.map((hotspot) => hotspot.id)).not.toContain(
      "board_underlayer",
    );
    expect(
      await elementExists('button[data-target-id="board_underlayer"]'),
    ).toBe(false);

    // Reveal through the real player UI: inspect 企劃板 (planning_board),
    // drain its dialogue, then dismiss the deferred evidence acquisition.
    const boardSel = 'button[data-target-id="planning_board"]';
    await browser.waitUntil(() => elementExists(boardSel), {
      timeout: 15000,
      timeoutMsg: "planning_board button did not render in studio_room",
    });
    await jsClick(boardSel);
    // jsClick only dispatches the click while inspect_hotspot is still
    // awaiting IPC — wait for it to leave Explore before draining, else the
    // drain's predicate is already true in the pre-inspection state and it
    // returns without advancing the planning_board dialogue.
    await waitForPackagedGameState(
      (current) => current.mode.type === "dialogue",
      15000,
      "inspecting planning_board did not open its dialogue",
    );
    await advanceDialogueUntil(async () => {
      const current = await getPackagedGameState();
      return (
        isExploreInScene(current, sceneId) &&
        current.scene.kind === "investigation" &&
        current.scene.currentSublocationId === "studio_room"
      );
    });
    await dismissAllPendingAcquisitions();

    state = await getPackagedGameState();
    if (
      !isExploreInScene(state, sceneId) ||
      state.scene.kind !== "investigation"
    ) {
      throw new Error("inspecting planning_board left investigation_scene_16");
    }
    const revealed = state.scene;
    const revealedSublocation = revealed.visibleSublocations.find(isStudioRoom);
    if (!revealedSublocation) {
      throw new Error("studio_room missing after the planning_board reveal");
    }
    // The reveal is live: the runtime view now carries both pages, and one
    // inspection cannot have completed the auto outro (Explore is intact).
    const revealedIds = revealedSublocation.hotspots.map(
      (hotspot) => hotspot.id,
    );
    expect(revealedIds).toContain("planning_board");
    expect(revealedIds).toContain("board_underlayer");
    expect(revealed.outroProgress?.done ?? 0).toBeLessThan(
      revealed.outroProgress?.total ?? Number.POSITIVE_INFINITY,
    );

    // The same strict gates re-measured with both pages live at once: HUD
    // disjointness, fallback accounting, visible-center routing and the
    // authored-center routing — planning_board must keep its own center hit
    // point next to the revealed page (declared intentional overlap keeps
    // both boxes whole; same-z DOM order gives later-defined shared points
    // to board_underlayer).
    await expectHpa853SublocationSurface(
      sceneId,
      revealedSublocation,
      scenePlacements,
      outroTotal,
    );
  });
});
