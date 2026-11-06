import { describe, expect, it } from "vitest";
import {
  coverPlaneSize,
  isTargetReachable,
  targetCounterpart,
  targetViewportRect,
  visibleSpans,
  type ViewportRect,
} from "./target-layout";

// The ledger hotspot from investigation_scene_p1.layout.json — the case that
// motivated reachability routing: at a tall 800×720 window it is fully
// offscreen despite having an authored placement.
const LEDGER = { x: 0.815, y: 0.32, w: 0.105, h: 0.19 };
const CCTV = { x: 0.81, y: 0.52, w: 0.18, h: 0.2 };
const RECEIPT = { x: 0.63, y: 0.678, w: 0.075, h: 0.04 };

describe("coverPlaneSize", () => {
  it("matches the CSS cover vars at the minimum window", () => {
    // --scene-cover-width: max(100vw, 177.77777778vh) etc.
    const plane = coverPlaneSize({ w: 800, h: 600 });
    expect(plane.w).toBeCloseTo((16 / 9) * 600);
    expect(plane.h).toBe(600);
  });

  it("overhangs horizontally on taller windows", () => {
    const plane = coverPlaneSize({ w: 800, h: 720 });
    expect(plane.w).toBeCloseTo(1280);
    expect(plane.h).toBe(720);
  });

  it("overhangs vertically on wider windows", () => {
    const plane = coverPlaneSize({ w: 1920, h: 800 });
    expect(plane.w).toBe(1920);
    expect(plane.h).toBeCloseTo(1080);
  });
});

describe("targetViewportRect", () => {
  it("centers the plane and places the target by ratio", () => {
    const rect = targetViewportRect(RECEIPT, { w: 800, h: 600 });
    const plane = coverPlaneSize({ w: 800, h: 600 });
    const offset = (plane.w - 800) / 2;
    expect(rect.left).toBeCloseTo(RECEIPT.x * plane.w - offset);
    expect(rect.right - rect.left).toBeCloseTo(RECEIPT.w * plane.w);
  });

  it("expands small targets right/down to the minimum hit box", () => {
    // ~21px authored at 800×600 — the 72×44 floor widens it right/down.
    const tiny = { x: 0.4, y: 0.4, w: 0.02, h: 0.02 };
    const rect = targetViewportRect(tiny, { w: 800, h: 600 }, 72, 44);
    expect(rect.right - rect.left).toBe(72);
    expect(rect.bottom - rect.top).toBe(44);
  });
});

describe("isTargetReachable", () => {
  it("accepts fully visible targets at the minimum window", () => {
    expect(isTargetReachable(RECEIPT, { w: 800, h: 600 }, 72, 44)).toBe(true);
  });

  it("keeps partially cropped targets reachable while ≥44px shows", () => {
    // At 800×600 the ledger shows ~64px of its width: cropped but usable.
    expect(isTargetReachable(LEDGER, { w: 800, h: 600 }, 72, 44)).toBe(true);
  });

  it("rejects a fully offscreen target at 800×720", () => {
    expect(isTargetReachable(LEDGER, { w: 800, h: 720 }, 72, 44)).toBe(false);
  });

  it("rejects a target leaving only an undiscoverable sliver", () => {
    // At 800×720 the cctv box keeps ~3px of its left edge onscreen.
    expect(isTargetReachable(CCTV, { w: 800, h: 720 }, 72, 44)).toBe(false);
  });

  it("still counts the minimum-target expansion as visible area", () => {
    // A tiny authored box clipped off the left edge has its painted rect
    // fully offscreen, but the 72px min-target expansion pokes back into
    // the viewport — so without the expansion it is unreachable.
    const edge = { x: 0.18, y: 0.4, w: 0.005, h: 0.05 };
    expect(isTargetReachable(edge, { w: 800, h: 720 }, 72, 44)).toBe(true);
    expect(isTargetReachable(edge, { w: 800, h: 720 }, 0, 0)).toBe(false);
  });

  it("requires full visibility from boxes smaller than the floor", () => {
    const viewport = { w: 800, h: 600 };
    // 10.7px-wide box straddling the right crop line at 800×600: only ~5px
    // shows, and 5 < min(44, 10.7) — unreachable.
    const sliver = { x: 0.87, y: 0.4, w: 0.01, h: 0.05 };
    expect(isTargetReachable(sliver, viewport, 0, 0)).toBe(false);
    // The same box fully inside the viewport shows its whole 10.7px.
    const visible = { x: 0.85, y: 0.4, w: 0.01, h: 0.05 };
    expect(isTargetReachable(visible, viewport, 0, 0)).toBe(true);
  });

  it("rejects a target fully under the fallback panel band", () => {
    // Reachable by crop alone, but the fixed panel paints over it — its
    // clicks land on the panel.
    const viewport = { w: 800, h: 600 };
    const low = { x: 0.5, y: 0.85, w: 0.08, h: 0.08 };
    expect(isTargetReachable(low, viewport, 72, 44)).toBe(true);
    const panel: ViewportRect = { left: 0, top: 480, right: 800, bottom: 600 };
    expect(isTargetReachable(low, viewport, 72, 44, panel)).toBe(false);
  });

  it("keeps a target reachable on a residual span beside the panel", () => {
    // Viewport rect [200,500]–[700,580]: fully inside the pill's vertical
    // band, but a 400×80 span survives to the pill's left.
    const viewport = { w: 800, h: 600 };
    const wide = { x: 0.3125, y: 0.8333, w: 0.4688, h: 0.1333 };
    const pill: ViewportRect = { left: 600, top: 480, right: 800, bottom: 600 };
    expect(isTargetReachable(wide, viewport, 72, 44, pill)).toBe(true);
  });

  it("rejects a target left with only a sliver beside the panel", () => {
    // Viewport rect [600,510]–[700,558]: only a 30×48 span peeks left of
    // the pill — under the 44px floor.
    const viewport = { w: 800, h: 600 };
    const peek = { x: 0.6875, y: 0.85, w: 0.09375, h: 0.08 };
    const pill: ViewportRect = { left: 630, top: 480, right: 800, bottom: 600 };
    expect(isTargetReachable(peek, viewport, 0, 0, pill)).toBe(false);
  });
});

describe("visibleSpans", () => {
  const viewport = { w: 800, h: 600 };

  it("returns the viewport-clipped rect without an occluder", () => {
    expect(
      visibleSpans({ left: -50, top: 100, right: 300, bottom: 400 }, viewport),
    ).toEqual([{ left: 0, top: 100, right: 300, bottom: 400 }]);
  });

  it("returns nothing for a fully offscreen rect", () => {
    expect(
      visibleSpans({ left: -200, top: 0, right: -10, bottom: 100 }, viewport),
    ).toEqual([]);
  });

  it("splits a bottom band occluder into a top residual", () => {
    const panel: ViewportRect = { left: 0, top: 400, right: 800, bottom: 600 };
    expect(
      visibleSpans(
        { left: 100, top: 300, right: 400, bottom: 500 },
        viewport,
        panel,
      ),
    ).toEqual([{ left: 100, top: 300, right: 400, bottom: 400 }]);
  });

  it("splits a corner occluder into top and left residuals", () => {
    const pill: ViewportRect = { left: 300, top: 400, right: 800, bottom: 600 };
    expect(
      visibleSpans(
        { left: 100, top: 300, right: 500, bottom: 500 },
        viewport,
        pill,
      ),
    ).toEqual([
      { left: 100, top: 300, right: 500, bottom: 400 },
      { left: 100, top: 400, right: 300, bottom: 500 },
    ]);
  });

  it("returns nothing when the occluder covers the visible rect", () => {
    const panel: ViewportRect = { left: 0, top: 0, right: 800, bottom: 600 };
    expect(
      visibleSpans(
        { left: 100, top: 100, right: 200, bottom: 200 },
        viewport,
        panel,
      ),
    ).toEqual([]);
  });
});

describe("targetCounterpart", () => {
  it("returns the fallback button matching the target id", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-target-id="ledger" inert></button>
      <div class="fallback-controls">
        <button data-target-id="ledger">帳本</button>
      </div>`;
    const match = targetCounterpart(root, "ledger");
    expect(match).toHaveTextContent("帳本");
  });

  it("skips the inert plane copy", () => {
    const root = document.createElement("div");
    root.innerHTML = `<button data-target-id="ledger" inert></button>`;
    expect(targetCounterpart(root, "ledger")).toBeNull();
  });

  it("resolves a witness block to its first topic button", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-target-id="witness">
        <strong>目擊者</strong>
        <button>不在場證明</button>
        <button>動機</button>
      </div>`;
    const match = targetCounterpart(root, "witness");
    expect(match).toHaveTextContent("不在場證明");
  });
});
