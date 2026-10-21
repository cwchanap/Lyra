import { describe, expect, it } from "vitest";
import { stitchingNeighbours } from "./generate";
import type {
  EmittedLine,
  EmittedScene,
  LocaleScriptFile,
  LocaleScriptLine,
} from "./types";

function entry(id: string): LocaleScriptLine {
  return { id, speaker: "神谷澪", zh: id, ja: id };
}

function script(sceneFile: string, ids: string[]) {
  const file: LocaleScriptFile = {
    schemaVersion: 1,
    locale: "ja",
    source: `docs/stories_plan/chapter_1/${sceneFile}`,
    lines: ids.map(entry),
    stale: [],
  };
  return { sceneFile, file };
}

function emitted(id: string, segment?: number): EmittedLine {
  return {
    speaker: "神谷澪",
    text: id,
    expression: null,
    id,
    sourceFile: null,
    ...(segment === undefined ? {} : { segment }),
  };
}

function scene(sceneFile: string, lines: EmittedLine[]): EmittedScene {
  return { chapterId: "chapter_1", sceneFile, sceneId: sceneFile, lines };
}

describe("stitchingNeighbours", () => {
  it("takes neighbours from the dialogue queue the player hears, not from script order", () => {
    // interrogation_scene_10 lists the finale L085 between L014 and the
    // first testimony question L015, which the player hears right after L014.
    const file = "interrogation_scene_10.md";
    const scripts = [script(file, ["L014", "L085", "L015"])];
    const [l014, l085, l015] = scripts[0]!.file.lines;
    const neighbours = stitchingNeighbours(
      [
        scene(file, [
          emitted("L014", 0),
          emitted("L015", 0),
          emitted("L085", 4),
        ]),
      ],
      scripts,
    );
    expect(neighbours.get(`${file}#L014`)).toEqual({ next: l015 });
    expect(neighbours.get(`${file}#L015`)).toEqual({ previous: l014 });
    expect(neighbours.get(`${file}#L085`)).toEqual({});
    expect(l085).toBeDefined();
  });

  it("keeps only the neighbours every place a line is emitted agrees on", () => {
    const file = "investigation_scene_p1.md";
    const scripts = [script(file, ["L001", "L002", "L003", "L004"])];
    const [l001, , , l004] = scripts[0]!.file.lines;
    const neighbours = stitchingNeighbours(
      [
        scene(file, [
          emitted("L001", 0),
          emitted("L002", 0),
          emitted("L004", 0),
          emitted("L003", 1),
          emitted("L002", 1),
          emitted("L004", 1),
        ]),
      ],
      scripts,
    );
    expect(neighbours.get(`${file}#L002`)).toEqual({ next: l004 });
    expect(neighbours.get(`${file}#L001`)?.previous).toBeUndefined();
    expect(l001).toBeDefined();
  });

  it("sends no context for lines without a known queue", () => {
    const file = "scene_0.md";
    const scripts = [script(file, ["L001", "L002"])];
    const neighbours = stitchingNeighbours(
      [scene(file, [emitted("L001"), emitted("L002")])],
      scripts,
    );
    expect(neighbours.get(`${file}#L001`)).toEqual({});
    expect(neighbours.get(`${file}#L002`)).toEqual({});
  });
});
