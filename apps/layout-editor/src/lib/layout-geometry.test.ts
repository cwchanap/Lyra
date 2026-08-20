import { describe, expect, it } from "vitest";
import {
  clampCharacterLayout,
  clampLayoutBox,
  clampRectLayout,
  clampSpriteLayout,
  MIN_LAYOUT_SIZE,
  resizeLayoutFromHandle,
} from "./layout-geometry";
import type { CharacterLayout, SpriteLayout } from "./layout-types";

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

  describe("clampCharacterLayout", () => {
    it("preserves a baked layout without adding sprite fields", () => {
      const baked = {
        kind: "baked",
        x: 0.8,
        y: 0.75,
        w: 0.4,
        h: 0.5,
      } satisfies CharacterLayout;

      expect(clampCharacterLayout(baked)).toStrictEqual({
        kind: "baked",
        x: 0.6,
        y: 0.5,
        w: 0.4,
        h: 0.5,
      });
    });
  });
});
