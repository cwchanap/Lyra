import { describe, expect, it } from "vitest";
import {
  suggestManualDisplayName,
  validateManualDisplayName,
} from "./manual-name";

describe("validateManualDisplayName", () => {
  it.each([
    ["", "empty"],
    [" \u3000 ", "empty"],
    ["a\u0000", "forbidden"],
    ["a\u0085", "forbidden"],
    ["\u2028雨", "forbidden"],
    ["雨\u2029", "forbidden"],
    [" \t雨", "forbidden"],
  ] as const)("classifies %j with the Rust-parity reason", (input, reason) => {
    expect(validateManualDisplayName(input)).toEqual({ ok: false, reason });
  });

  it("trims only Unicode White_Space while preserving accepted content", () => {
    expect(validateManualDisplayName("\u00a0雨  夜\u3000")).toEqual({
      ok: true,
      value: "雨  夜",
    });
    expect(validateManualDisplayName("ＡＢＣ e\u0301")).toEqual({
      ok: true,
      value: "ＡＢＣ e\u0301",
    });
  });

  it("counts combining marks and emoji sequences as whole graphemes", () => {
    const combiningBoundary = "e\u0301".repeat(40);
    const emojiBoundary = "👩🏽‍💻".repeat(40);

    expect(validateManualDisplayName(combiningBoundary)).toEqual({
      ok: true,
      value: combiningBoundary,
    });
    expect(validateManualDisplayName(emojiBoundary)).toEqual({
      ok: true,
      value: emojiBoundary,
    });
    expect(validateManualDisplayName(`${emojiBoundary}雨`)).toEqual({
      ok: false,
      reason: "tooLong",
    });
  });
});

describe("suggestManualDisplayName", () => {
  it("joins short chapter and scene titles without changing their content", () => {
    expect(suggestManualDisplayName("第一章", "雨夜")).toBe("第一章 · 雨夜");
  });

  it("shortens long suggestions to 39 whole graphemes plus an ellipsis", () => {
    const suggestion = suggestManualDisplayName(
      "👩🏽‍💻".repeat(30),
      "雨".repeat(30),
    );
    const graphemes = Array.from(
      new Intl.Segmenter("zh-Hant", { granularity: "grapheme" }).segment(
        suggestion,
      ),
      ({ segment }) => segment,
    );

    expect(graphemes).toHaveLength(40);
    expect(graphemes.at(-1)).toBe("…");
    expect(graphemes.slice(0, 30).join("")).toBe("👩🏽‍💻".repeat(30));
  });
});
