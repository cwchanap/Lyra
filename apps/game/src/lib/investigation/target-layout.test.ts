import { describe, expect, it } from "vitest";
import {
  coverPlaneSize,
  isTargetReachable,
  targetViewportRect,
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

  it("keeps partially cropped targets reachable while ≥24px shows", () => {
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
    // shows, and 5 < min(24, 10.7) — unreachable.
    const sliver = { x: 0.87, y: 0.4, w: 0.01, h: 0.05 };
    expect(isTargetReachable(sliver, viewport, 0, 0)).toBe(false);
    // The same box fully inside the viewport shows its whole 10.7px.
    const visible = { x: 0.85, y: 0.4, w: 0.01, h: 0.05 };
    expect(isTargetReachable(visible, viewport, 0, 0)).toBe(true);
  });
});
