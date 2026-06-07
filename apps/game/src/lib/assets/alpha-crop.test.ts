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
});
