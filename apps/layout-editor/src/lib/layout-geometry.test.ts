import { describe, expect, it } from "vitest";
import {
  alphaBoundsFromImageData,
  clampLayoutBox,
  clampRectLayout,
  clampSpriteLayout,
  cropVariablesForAlphaBounds,
  MIN_LAYOUT_SIZE,
  resizeLayoutFromHandle,
} from "./layout-geometry";
import type { SpriteLayout } from "./layout-types";

const sprite = {
  kind: "sprite",
  assetId: "standee.witness.standard",
  x: 0.4,
  y: 0.2,
  w: 0.2,
  h: 0.5,
  anchor: "bottomCenter",
} satisfies SpriteLayout;

describe("layout geometry", () => {
  it("resizes boxes from the west edge while keeping the east edge fixed", () => {
    expect(resizeLayoutFromHandle(sprite, "w", -0.05, 0)).toMatchObject({
      x: 0.35,
      w: 0.25,
    });
  });

  it("resizes boxes from a corner on both axes", () => {
    expect(resizeLayoutFromHandle(sprite, "se", 0.04, 0.03)).toMatchObject({
      x: 0.4,
      y: 0.2,
      w: 0.24,
      h: 0.53,
    });
  });

  it("finds visible alpha bounds in transparent standee pixels", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]) {
      pixels[(y * 4 + x) * 4 + 3] = 255;
    }

    expect(alphaBoundsFromImageData(pixels, 4, 4)).toEqual({
      left: 1,
      top: 1,
      right: 3,
      bottom: 3,
      width: 2,
      height: 2,
    });
  });

  it("converts alpha bounds into CSS crop variables", () => {
    expect(
      cropVariablesForAlphaBounds({
        left: 256,
        top: 128,
        right: 768,
        bottom: 1408,
        width: 512,
        height: 1280,
      }),
    ).toBe(
      "--crop-left: 0.25; --crop-top: 0.08333333333333333; --crop-width: 0.5; --crop-height: 0.8333333333333334;",
    );
  });

  describe("clampLayoutBox", () => {
    it("clamps out-of-bounds coordinates into [0,1] range", () => {
      const result = clampLayoutBox({ x: -0.1, y: 1.2, w: 0.5, h: 0.5 });
      expect(result.x).toBe(0);
      expect(result.y).toBe(0.5);
      expect(result.w).toBe(0.5);
      expect(result.h).toBe(0.5);
    });

    it("enforces MIN_LAYOUT_SIZE floor on width and height", () => {
      const result = clampLayoutBox({ x: 0, y: 0, w: 0, h: 0 });
      expect(result.w).toBe(MIN_LAYOUT_SIZE);
      expect(result.h).toBe(MIN_LAYOUT_SIZE);
    });

    it("adjusts position when box extends past right edge", () => {
      const result = clampLayoutBox({ x: 0.98, y: 0, w: 0.5, h: 0.1 });
      expect(result.w).toBe(0.5);
      expect(result.x).toBe(0.5);
    });

    it("replaces NaN with the minimum value", () => {
      const result = clampLayoutBox({
        x: NaN,
        y: NaN,
        w: NaN,
        h: NaN,
      });
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      expect(result.w).toBe(MIN_LAYOUT_SIZE);
      expect(result.h).toBe(MIN_LAYOUT_SIZE);
    });

    it("replaces Infinity with the maximum value", () => {
      const result = clampLayoutBox({
        x: Infinity,
        y: -Infinity,
        w: Infinity,
        h: -Infinity,
      });
      expect(result.x).toBeLessThanOrEqual(1);
      expect(result.y).toBe(0);
      expect(result.w).toBeLessThanOrEqual(1);
      expect(result.h).toBe(MIN_LAYOUT_SIZE);
    });

    it("passes valid coordinates through unchanged", () => {
      const result = clampLayoutBox({ x: 0.2, y: 0.3, w: 0.4, h: 0.5 });
      expect(result).toEqual({ x: 0.2, y: 0.3, w: 0.4, h: 0.5 });
    });
  });

  describe("clampRectLayout", () => {
    it("preserves kind and clamps coordinates", () => {
      const result = clampRectLayout({
        kind: "rect",
        x: -0.5,
        y: 0,
        w: 0.1,
        h: 0.1,
      });
      expect(result.kind).toBe("rect");
      expect(result.x).toBe(0);
    });
  });

  describe("clampSpriteLayout", () => {
    it("preserves kind, assetId, and anchor while clamping", () => {
      const result = clampSpriteLayout({
        kind: "sprite",
        assetId: "standee.witness.standard",
        x: 2,
        y: -1,
        w: 0.01,
        h: 0.01,
        anchor: "bottomCenter",
      });
      expect(result.kind).toBe("sprite");
      expect(result.assetId).toBe("standee.witness.standard");
      expect(result.anchor).toBe("bottomCenter");
      expect(result.w).toBe(MIN_LAYOUT_SIZE);
      expect(result.h).toBe(MIN_LAYOUT_SIZE);
    });
  });
});
