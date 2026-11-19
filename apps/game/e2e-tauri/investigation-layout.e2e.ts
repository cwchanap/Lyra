import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  advanceDialogueUntil,
  collectKagamiSummaryEvidence,
  dismissAllPendingAcquisitions,
  elementExists,
  enabledMapDestinationIds,
  getPackagedGameState,
  jsClick,
  jumpToProductionScene,
  loadPackagedCheckpoint,
  observedCssViewport,
  openGameMenu,
  resetE2eStorage,
  seedStoryCleared,
  startFromMenu,
  waitForPackagedGameState,
} from "./helpers";
import { anchors } from "./production-anchors";
import {
  caseFileViewportNativeSize,
  validDevicePixelRatio,
} from "$lib/e2e/case-file-viewport";
import type { E2eCheckpointId } from "$lib/e2e/checkpoints";
import {
  targetLayoutStyle,
  targetViewportRect,
  type TargetLayout,
} from "$lib/investigation/target-layout";
import type { GameStateView, SublocationView } from "$lib/state/types";

/** The game window's default and minimum size (tauri.conf.json). */
const MINIMUM_WINDOW = { width: 800, height: 600 } as const;

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
 * Targets the compiled sidecars still leave unplaced, tracked by HPA-1143
 * (https://linear.app/cwchanap/issue/HPA-1143/complete-five-chapter-2-investigation-targets-blocked-by-crop-and-hud):
 * four whose art sits outside the 800x600 cover-crop band, plus scene 8's
 * uploader_header, which is HUD-blocked — its only HUD-free strip is below
 * the 44px hit-size floor. The final zero-fallback / 72-of-72 gate
 * activates only once this list is empty; until then it pins the exact
 * pending set so completion cannot drift silently. Update — do not delete —
 * when the blockers are resolved.
 */
const ART_BLOCKED_UNPLACED_TARGETS = [
  "chapter_2/investigation_scene_12/truck_console/coffee_cans",
  "chapter_2/investigation_scene_12/box_left_side/stair_gap",
  "chapter_2/investigation_scene_14/backstage_rear/heat_pack_crate",
  "chapter_2/investigation_scene_14/seventh_floor_core/stair_door",
  "chapter_2/investigation_scene_8/leaked_clip_thread/uploader_header",
];

/**
 * Authored sublocation count per HPA-853 scene: the max location bar must
 * show every chip at once — the 4-chip NAV of scenes 12/14 included — not
 * the initial 1-chip state a fresh playthrough would give.
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

/** Center-gate tolerance for authored decimal coordinates. */
const CENTER_EPSILON = 1e-6;

type HudRects = {
  nav: Box | null;
  progress: Box | null;
  primaryObjective: Box | null;
  sceneLabel: Box | null;
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

async function ensureMinimumWindowViewport(): Promise<void> {
  const matches = (viewport: { width: number; height: number }) =>
    viewport.width === MINIMUM_WINDOW.width &&
    viewport.height === MINIMUM_WINDOW.height;
  let viewport = await observedCssViewport();
  if (matches(viewport)) return;
  const requested = caseFileViewportNativeSize(
    viewport.devicePixelRatio,
    MINIMUM_WINDOW,
  );
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await browser.setWindowSize(requested.width, requested.height);
    try {
      await browser.waitUntil(
        async () => matches((viewport = await observedCssViewport())),
        {
          timeout: 10000,
          interval: 100,
          timeoutMsg: "viewport did not settle at the 800x600 minimum window",
        },
      );
    } catch (error) {
      // Keep the retry tolerance — a slow-clamping WM may need a corrected
      // request — but hang on to the failure for the final error instead of
      // dropping it.
      lastError = error;
    }
    if (matches(viewport)) return;
    const scale = validDevicePixelRatio(viewport.devicePixelRatio);
    // Signed correction: the WM can clamp a request in either direction, so
    // overshoots must shrink as well as shortfalls grow.
    requested.width += Math.ceil(
      (MINIMUM_WINDOW.width - viewport.width) * scale,
    );
    requested.height += Math.ceil(
      (MINIMUM_WINDOW.height - viewport.height) * scale,
    );
  }
  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `viewport did not settle at the 800x600 minimum window (last observed ${viewport.width}x${viewport.height})`,
    { cause: detail === "null" ? undefined : detail },
  );
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
      };
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
      return { viewport, hud, targets, projectedLocked, fallbackCount };
    },
    lockedStyles,
    authoredLayouts,
  );

  expect(measurement.viewport).toEqual(MINIMUM_WINDOW);

  // A placed target production routed into the fallback list means the crop
  // or the panel band ate its hit box — never acceptable for these scenes.
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
  if (outroTotal > 0 && measurement.hud.progress === null) {
    missingHud.push(".investigation-progress");
  }
  expect(missingHud).toEqual([]);

  // Visual occlusion is decided from the DOM rects: PROGRESS, PRIMARY
  // OBJECTIVE and the scene label are pointer-events:none, so no hit test
  // can discover them covering a target. Not nav.bottom/600 as a full-width
  // floor — flex-wrap can move PROGRESS under the nav.
  const hudCandidates = [
    { name: ".explore-hud nav", rect: measurement.hud.nav },
    { name: ".investigation-progress", rect: measurement.hud.progress },
    { name: ".primary-objective-hud", rect: measurement.hud.primaryObjective },
    { name: ".scene-label", rect: measurement.hud.sceneLabel },
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

describe("investigation layout surface", () => {
  beforeEach(async () => {
    await resetE2eStorage();
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

  it("keeps every shipped placement usable and its pending cue on it at 800x600", async () => {
    // Scene 3's front room has both an unfinished hotspot and a witness
    // with open topics, so both cue variants are live.
    await seedStoryCleared();
    await startFromMenu();
    await jumpToProductionScene("investigation_scene_3");
    await advanceDialogueUntil(async () => {
      const state = await getPackagedGameState();
      return (
        state.mode.type === "explore" &&
        state.scene.kind === "investigation" &&
        state.scene.currentSublocationId !== null
      );
    });
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
        timeoutMsg: "scene 3 targets did not show their pending cues",
      },
    );
    await ensureMinimumWindowViewport();

    const placements = shippedPlacements();
    const ids = placements.map((placement) => placement.id);
    // Where the 800x600 clipping was found: two markers, and two targets
    // the crop once hid almost or entirely.
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
    const measured = await browser.execute(
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
        const results: Array<{ id: string; target: Box; cue: Box }> = [];
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
            });
          }
          cue.style.removeProperty("animation");
        }
        for (const { target, style, className } of saved) {
          if (style === null) target.removeAttribute("style");
          else target.setAttribute("style", style);
          target.className = className;
        }
        const stage = document.querySelector(".scene-stage");
        if (!stage) throw new Error("Scene stage missing");
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          stage: box(stage.getBoundingClientRect()),
          results,
        };
      },
      placements,
      hotspotSel,
      characterSel,
    );

    expect(measured.viewport).toEqual(MINIMUM_WINDOW);
    expect(measured.results.length).toBeGreaterThan(placements.length);

    // Every placed target is one the player may need, so the window's crop
    // must leave enough of it to click, and its cue must sit on that part.
    const unusable: string[] = [];
    const misplaced: string[] = [];
    for (const { id, target, cue } of measured.results) {
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

  it("crosses the same first destination with Tab and Enter from fresh setup", async () => {
    await setupAtFirstMapGate();
    expect(await enabledMapDestinationIds()).toEqual([
      anchors.firstMapDestination,
    ]);

    // jumpToProductionScene leaves focus on a since-unmounted menu control.
    // WebKit performs Tab traversal from the active element, so seed a real
    // starting point inside the gameplay focus order first; the acceptance
    // stays on the native path: Tab must still reach the pin, Enter activate
    // it.
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          "[data-gameplay-root] button:not(:disabled)",
        )
        ?.focus();
    });

    // Tab until the map pin itself holds focus, then activate with Enter so
    // the journey stays on the native keyboard path.
    await browser.waitUntil(
      async () => {
        await browser.keys("Tab");
        return browser.execute(
          (destinationId: string) =>
            (document.activeElement as HTMLElement | null)?.getAttribute(
              "data-map-destination",
            ) === destinationId,
          anchors.firstMapDestination,
        );
      },
      {
        timeout: 30000,
        interval: 100,
        timeoutMsg: "Tab never focused the sole city-map destination",
      },
    );
    await browser.keys("Enter");
    try {
      await waitForPackagedGameState(
        (state) =>
          state.scene.kind === "investigation" &&
          state.scene.id === anchors.firstGateSuccessor,
        5000,
        "Enter did not activate the destination",
      );
    } catch {
      // WebKit's WebDriver synthesizes key events without running default
      // actions: Tab focus traversal is special-cased (and worked above), but
      // Enter cannot produce the button's activation click. A native button
      // focused by Tab activates on Enter in real browsers; click the focused
      // pin to stand in for that default activation behavior.
      const activated = await browser.execute((destinationId: string) => {
        const element = document.activeElement as HTMLButtonElement | null;
        if (element?.getAttribute("data-map-destination") !== destinationId) {
          return false;
        }
        element.click();
        return true;
      }, anchors.firstMapDestination);
      if (!activated) {
        throw new Error("Enter lost focus of the sole destination pin");
      }
    }
    await expectCrossedToRainBellInvestigation();
  });

  // --- HPA-853 chapter-2 placement surface ---------------------------------

  it("pins the 72-target inventory (five still pending under HPA-1143) and centers every placed HPA-853 target in the 800x600 crop", () => {
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

    // The final zero-fallback gate stays clearly pending until the five
    // named HPA-1143 blockers are resolved: the unplaced set must be
    // exactly the declared pending list — no target may silently join or
    // leave that list.
    const unplacedIds = hpa853Targets
      .filter((target) => target.layout === null)
      .map((target) => target.id)
      .toSorted();
    expect(unplacedIds).toEqual([...ART_BLOCKED_UNPLACED_TARGETS].toSorted());

    // Strict center gate for the six new scenes only (design §4.2): the
    // normalized center x stays in the middle 3/4 of the cover plane, and
    // the shared CSS-cover math must land that center inside the 800x600
    // viewport. Existing chapter-1 and chapter-2 scene-4 edge placements are
    // deliberately out of scope and are not moved.
    const viewport = { w: MINIMUM_WINDOW.width, h: MINIMUM_WINDOW.height };
    const offCenter: string[] = [];
    const cropped: string[] = [];
    for (const target of hpa853Targets) {
      if (target.layout === null) continue;
      const centerX = target.layout.x + target.layout.w / 2;
      if (
        centerX < 0.125 - CENTER_EPSILON ||
        centerX > 0.875 + CENTER_EPSILON
      ) {
        offCenter.push(
          `${target.id}: center x ${centerX.toFixed(4)} outside [0.125, 0.875]`,
        );
        continue;
      }
      const rect = targetViewportRect(target.layout, viewport);
      const centerXInView = (rect.left + rect.right) / 2;
      const centerYInView = (rect.top + rect.bottom) / 2;
      if (
        centerXInView < 0 ||
        centerXInView > viewport.w ||
        centerYInView < 0 ||
        centerYInView > viewport.h
      ) {
        cropped.push(
          `${target.id}: center ${centerXInView.toFixed(1)},${centerYInView.toFixed(1)} outside ${viewport.w}x${viewport.h}`,
        );
      }
    }
    expect(offCenter).toEqual([]);
    expect(cropped).toEqual([]);
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

      // The fixture's whole point: the location bar shows every authored
      // chip at once (scenes 12/14 with 4 chips included), because the
      // fixture unlocked every sublocation without doing any puzzle work.
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
          const scale = Math.max(
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
