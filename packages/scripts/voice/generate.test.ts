import { describe, expect, it } from "vitest";
import { stitchingNeighbours } from "./generate";
import type { LocaleScriptFile, LocaleScriptLine } from "./types";

function script(source: string, ids: string[]): LocaleScriptFile {
  const lines: LocaleScriptLine[] = ids.map((id) => ({
    id,
    speaker: "神谷澪",
    zh: id,
    ja: id,
  }));
  return { schemaVersion: 1, locale: "ja", source, lines, stale: [] };
}

describe("stitchingNeighbours", () => {
  it("gives a linear scene's lines their neighbours in script order", () => {
    const file = script("docs/stories_plan/chapter_1/scene_11_2.md", [
      "L001",
      "L002",
      "L003",
    ]);
    expect(stitchingNeighbours(file, 1)).toEqual({
      previous: file.lines[0],
      next: file.lines[2],
    });
    expect(stitchingNeighbours(file, 0)).toEqual({ next: file.lines[1] });
    expect(stitchingNeighbours(file, 2)).toEqual({ previous: file.lines[1] });
  });

  it("sends no context for branching scenes, whose file order is not play order", () => {
    // interrogation_scene_10 lists the finale L085 between L014 and the
    // first testimony question L015.
    const file = script(
      "docs/stories_plan/chapter_1/interrogation_scene_10.md",
      ["L014", "L085", "L015"],
    );
    for (const index of [0, 1, 2]) {
      expect(stitchingNeighbours(file, index)).toEqual({});
    }
    for (const source of [
      "docs/stories_plan/chapter_1/investigation_scene_p1.md",
      "docs/stories_plan/chapter_1/analysis_scene_8_5.md",
    ]) {
      expect(stitchingNeighbours(script(source, ["L001", "L002"]), 0)).toEqual(
        {},
      );
    }
  });
});
