import { describe, expect, it } from "vitest";
import {
  scenePlaneSize,
  isTargetReachable,
  targetCounterpart,
  targetViewportRect,
  visibleSpans,
  type ViewportRect,
} from "./target-layout";

// Formerly cropped edge placements from the investigation layout.
const LEDGER = { x: 0.815, y: 0.32, w: 0.105, h: 0.19 };
const CCTV = { x: 0.81, y: 0.52, w: 0.18, h: 0.2 };
const RECEIPT = { x: 0.63, y: 0.678, w: 0.075, h: 0.04 };

describe("scene plane size", () => {
  it("keeps the whole scene inside tall and wide stages", () => {
    expect(scenePlaneSize({ w: 800, h: 720 })).toEqual({ w: 800, h: 450 });
    const wide = scenePlaneSize({ w: 1920, h: 800 });
    expect(wide.w).toBeCloseTo(1422.222222);
    expect(wide.h).toBe(800);
  });

  it("fits the full 16:9 artwork at the minimum window", () => {
    const plane = scenePlaneSize({ w: 800, h: 600 });
    expect(plane).toEqual({ w: 800, h: 450 });
  });

  it("fills the minimum 800×450 stage", () => {
    expect(scenePlaneSize({ w: 800, h: 450 })).toEqual({ w: 800, h: 450 });
  });
});

describe("targetViewportRect", () => {
  it("centers the plane and places the target by ratio", () => {
    const rect = targetViewportRect(RECEIPT, { w: 800, h: 600 });
    const plane = scenePlaneSize({ w: 800, h: 600 });
    expect(rect.left).toBeCloseTo(504);
    expect(rect.top).toBeCloseTo(380.1);
    expect(rect.right - rect.left).toBeCloseTo(RECEIPT.w * plane.w);
  });

  it("expands small targets right/down to the minimum hit box", () => {
    // A tiny authored box is widened right/down by the 72×44 floor.
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

  it("keeps the ledger reachable at 800×600", () => {
    expect(isTargetReachable(LEDGER, { w: 800, h: 600 }, 72, 44)).toBe(true);
  });

  it("keeps the former offscreen ledger on art at 800×720", () => {
    expect(isTargetReachable(LEDGER, { w: 800, h: 720 }, 72, 44)).toBe(true);
  });

  it("keeps the former edge sliver CCTV on art at 800×720", () => {
    expect(isTargetReachable(CCTV, { w: 800, h: 720 }, 72, 44)).toBe(true);
  });

  it("still counts the minimum-target expansion as visible area", () => {
    // Synthetic out-of-bounds box: the clamp reaches into the stage.
    const edge = { x: -0.03, y: 0.4, w: 0.005, h: 0.05 };
    expect(isTargetReachable(edge, { w: 800, h: 720 }, 72, 44)).toBe(true);
    expect(isTargetReachable(edge, { w: 800, h: 720 }, 0, 0)).toBe(false);
  });

  it("requires full visibility from boxes smaller than the floor", () => {
    const viewport = { w: 800, h: 600 };
    // A synthetic 8px box straddles the stage edge: only 2px shows.
    const sliver = { x: 0.9975, y: 0.4, w: 0.01, h: 0.05 };
    expect(isTargetReachable(sliver, viewport, 0, 0)).toBe(false);
    const visible = { x: 0.98, y: 0.4, w: 0.01, h: 0.05 };
    expect(isTargetReachable(visible, viewport, 0, 0)).toBe(true);
  });

  it("rejects a target fully under the fallback panel band", () => {
    // Reachable on art, but the fixed panel paints over it — its
    // clicks land on the panel.
    const viewport = { w: 800, h: 600 };
    const low = { x: 0.5, y: 0.92, w: 0.08, h: 0.08 };
    expect(isTargetReachable(low, viewport, 72, 44)).toBe(true);
    const panel: ViewportRect = { left: 0, top: 480, right: 800, bottom: 600 };
    expect(isTargetReachable(low, viewport, 72, 44, panel)).toBe(false);
  });

  it("keeps a target reachable on a residual span beside the panel", () => {
    // The target sits in the pill's band with a wide residual to its left.
    const viewport = { w: 800, h: 600 };
    const wide = { x: 0.25, y: 0.92, w: 0.5, h: 0.08 };
    const pill: ViewportRect = { left: 600, top: 480, right: 800, bottom: 600 };
    expect(isTargetReachable(wide, viewport, 72, 44, pill)).toBe(true);
  });

  it("rejects a target left with only a sliver beside the panel", () => {
    // Only a 30px span peeks left of the pill — under the 44px floor.
    const viewport = { w: 800, h: 600 };
    const peek = { x: 0.75, y: 0.9, w: 0.125, h: 0.1 };
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
