import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  suggestManualDisplayName,
  validateManualDisplayName,
} from "./manual-name";

// Shared grapheme-parity fixture: the same JSON file is loaded by the Rust
// test in apps/game/src-tauri/src/game/save/schema.rs. If either side's
// grapheme segmentation drifts (e.g. from a Unicode version mismatch between
// V8/ICU and unicode-segmentation), the test on the drifting side fails.
// Rust is the persistence-layer authority; TS is client-side preview only.
// Resolve the fixture relative to this test module so the path is correct
// regardless of the test runner's working directory.
const parityFixturePath = join(
  import.meta.dirname,
  "../../../src-tauri/tests/fixtures/save-name-grapheme-parity.json",
);
const parityFixture = JSON.parse(readFileSync(parityFixturePath, "utf8")) as {
  validationCases: Array<{
    id: string;
    input: string;
    expected: { ok: boolean; value?: string; reason?: string };
  }>;
  suggestionCases: Array<{
    id: string;
    chapterTitle: string;
    sceneTitle: string;
    expected?: string;
    expectedGraphemeCount?: number;
    expectedSuffix?: string;
  }>;
};

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

describe("grapheme parity fixture (shared with Rust)", () => {
  it.each(parityFixture.validationCases)(
    "validation case `$id` matches the Rust outcome",
    ({ input, expected }) => {
      if (expected.ok) {
        expect(validateManualDisplayName(input)).toEqual({
          ok: true,
          value: expected.value,
        });
      } else {
        expect(validateManualDisplayName(input)).toEqual({
          ok: false,
          reason: expected.reason,
        });
      }
    },
  );

  it.each(parityFixture.suggestionCases)(
    "suggestion case `$id` matches the Rust outcome",
    ({
      chapterTitle,
      sceneTitle,
      expected,
      expectedGraphemeCount,
      expectedSuffix,
    }) => {
      const suggestion = suggestManualDisplayName(chapterTitle, sceneTitle);
      let asserted = false;
      if (expected !== undefined) {
        expect(suggestion).toBe(expected);
        asserted = true;
      }
      if (expectedGraphemeCount !== undefined) {
        const graphemes = Array.from(
          new Intl.Segmenter("zh-Hant", { granularity: "grapheme" }).segment(
            suggestion,
          ),
          ({ segment }) => segment,
        );
        expect(graphemes).toHaveLength(expectedGraphemeCount);
        asserted = true;
      }
      if (expectedSuffix !== undefined) {
        expect(suggestion.endsWith(expectedSuffix)).toBe(true);
        asserted = true;
      }
      // Guard against a fixture case that omits every expected* field and
      // therefore runs zero assertions, passing vacuously.
      expect(asserted).toBe(true);
    },
  );
});
