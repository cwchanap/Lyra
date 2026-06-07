import { describe, expect, it } from "vitest";
import {
  alphaBoundsFromImageData,
  cropVariablesForAlphaBounds,
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
});
