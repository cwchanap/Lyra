import { describe, expect, it } from "vitest";
import {
  alphaBoundsFromImageData,
  cropVariablesForAlphaBounds,
} from "./alpha-crop";

describe("alpha crop helpers", () => {
  it("finds visible alpha bounds in transparent asset pixels", () => {
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
      cropVariablesForAlphaBounds(
        {
          left: 256,
          top: 128,
          right: 768,
          bottom: 1408,
          width: 512,
          height: 1280,
        },
        1024,
        1536,
      ),
    ).toBe(
      "--crop-left: 0.25; --crop-top: 0.08333333333333333; --crop-width: 0.5; --crop-height: 0.8333333333333334;",
    );
  });

  it("returns null for a fully transparent image", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    expect(alphaBoundsFromImageData(pixels, 4, 4)).toBeNull();
  });

  it("finds bounds for a single non-transparent pixel", () => {
    const pixels = new Uint8ClampedArray(4 * 3 * 4);
    pixels[(1 * 3 + 2) * 4 + 3] = 128;

    expect(alphaBoundsFromImageData(pixels, 3, 4)).toEqual({
      left: 2,
      top: 1,
      right: 3,
      bottom: 2,
      width: 1,
      height: 1,
    });
  });

  it("treats low alpha values as visible", () => {
    const pixels = new Uint8ClampedArray(4);
    pixels[3] = 1;

    expect(alphaBoundsFromImageData(pixels, 1, 1)).toEqual({
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
      width: 1,
      height: 1,
    });
  });

  it("returns null when data buffer is smaller than expected dimensions", () => {
    const pixels = new Uint8ClampedArray(4); // only 1 pixel worth of data
    expect(alphaBoundsFromImageData(pixels, 4, 4)).toBeNull();
  });

  it("returns crop variables at full extent when bounds equal image dimensions", () => {
    expect(
      cropVariablesForAlphaBounds(
        { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
        100,
        100,
      ),
    ).toBe("--crop-left: 0; --crop-top: 0; --crop-width: 1; --crop-height: 1;");
  });
});
