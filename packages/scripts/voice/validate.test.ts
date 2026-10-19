import { describe, expect, it } from "vitest";
import type { ExistingScript } from "./sync";
import type { EmittedScene, LocaleScriptLine } from "./types";
import { validateChapterScripts } from "./validate";

const CHAPTER = "chapter_1";

function existing(
  sceneFile: string,
  lines: LocaleScriptLine[],
  overrides: Partial<ExistingScript["file"]> = {},
): ExistingScript {
  const base = sceneFile.replace(/\.md$/, "");
  return {
    path: `docs/stories_plan/${CHAPTER}/ja/${base}.ja.yaml`,
    sceneFile,
    file: {
      schemaVersion: 1,
      locale: "ja",
      source: `docs/stories_plan/${CHAPTER}/${sceneFile}`,
      lines,
      stale: [],
      ...overrides,
    },
  };
}

const SCENES: EmittedScene[] = [
  {
    chapterId: CHAPTER,
    sceneFile: "scene_0.md",
    sceneId: "scene_0",
    lines: [
      { speaker: "旁白", text: "雨。", expression: null },
      { speaker: "相馬律", text: "好。", expression: "standard" },
      { speaker: "相馬律", text: "走吧。", expression: null },
    ],
  },
  {
    chapterId: CHAPTER,
    sceneFile: "scene_1.md",
    sceneId: "scene_1",
    lines: [
      { speaker: "旁白", text: "雨。", expression: null },
      { speaker: "早坂茜", text: "等等。", expression: "concerned" },
    ],
  },
];

describe("validateChapterScripts", () => {
  it("passes a complete chapter", () => {
    const result = validateChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      scenes: SCENES,
      existing: [
        existing("scene_0.md", [
          { speaker: "旁白", zh: "雨。", ja: "雨。" },
          { speaker: "相馬律", zh: "好。", ja: "ああ。" },
          { speaker: "相馬律", zh: "走吧。", ja: "行こう。" },
        ]),
        existing("scene_1.md", [
          {
            speaker: "早坂茜",
            expression: "concerned",
            zh: "等等。",
            ja: "待って。",
          },
        ]),
      ],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({
      emittedLines: 5,
      uniqueLines: 4,
      translated: 4,
      missing: 0,
      untranslated: 0,
      stale: 0,
    });
  });

  it("warns on coverage gaps and errors on structural problems", () => {
    const result = validateChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      scenes: SCENES,
      existing: [
        existing(
          "scene_0.md",
          [
            { speaker: "旁白", zh: "雨。", ja: "雨。" },
            { speaker: "相馬律", zh: "好。", ja: "" },
            {
              speaker: "早坂茜",
              expression: "concerned",
              zh: "等等。",
              ja: "待って。",
            },
            { speaker: "旁白", zh: "刪掉的句子。", ja: "消えた文。" },
          ],
          { source: "docs/stories_plan/chapter_1/scene_9.md" },
        ),
        existing("scene_1.md", [{ speaker: "旁白", zh: "雨。", ja: "雨だ。" }]),
      ],
      glossary: {
        path: "docs/stories_plan/ja_glossary.yaml",
        value: {
          schemaVersion: 1,
          locale: "ja",
          styleRules: [],
          characters: [
            { zh: "旁白", ja: "ナレーション" },
            { zh: "相馬律", ja: "相馬律" },
          ],
          terms: [],
        },
      },
    });

    expect(result.diagnostics.map((d) => `${d.severity} ${d.code}`)).toEqual([
      "error localeScriptSourceMismatch",
      "warning localeScriptUntranslated",
      "warning localeScriptMisplacedEntry",
      "warning localeScriptStaleEntry",
      "error localeScriptDuplicateKey",
      "warning localeScriptMissingEntry",
      "warning localeGlossaryMissingSpeaker",
    ]);
    expect(result.summary).toEqual({
      emittedLines: 5,
      uniqueLines: 4,
      translated: 2,
      missing: 1,
      untranslated: 1,
      stale: 1,
    });
  });
});
