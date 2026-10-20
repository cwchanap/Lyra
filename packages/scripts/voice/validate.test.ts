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

function line(
  id: string | null,
  speaker: string,
  text: string,
  expression: string | null = null,
): EmittedScene["lines"][number] {
  return { id, speaker, text, expression, sourceFile: null };
}

const SCENES: EmittedScene[] = [
  {
    chapterId: CHAPTER,
    sceneFile: "scene_0.md",
    sceneId: "scene_0",
    lines: [
      line("L001", "旁白", "雨。"),
      line("L002", "相馬律", "好。", "standard"),
      line("L003", "相馬律", "走吧。"),
      line("L002", "相馬律", "好。", "standard"),
    ],
  },
  {
    chapterId: CHAPTER,
    sceneFile: "scene_1.md",
    sceneId: "scene_1",
    lines: [
      line("L001", "旁白", "雨。"),
      line("L002", "早坂茜", "等等。", "concerned"),
    ],
  },
];

const COMPLETE_SCENE_1 = existing("scene_1.md", [
  { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨。" },
  {
    id: "L002",
    speaker: "早坂茜",
    expression: "concerned",
    zh: "等等。",
    ja: "待って。",
  },
]);

describe("validateChapterScripts", () => {
  it("rejects a clip shared by two lines and flags a voiced empty line", () => {
    const result = validateChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      scenes: SCENES,
      existing: [
        existing("scene_0.md", [
          { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨。" },
          {
            id: "L002",
            speaker: "相馬律",
            zh: "好。",
            ja: "ああ。",
            voice: { clip: "ch1_soma_ritsu_0001" },
          },
          {
            id: "L003",
            speaker: "相馬律",
            zh: "走吧。",
            ja: "",
            voice: { clip: "ch1_soma_ritsu_0001" },
          },
        ]),
        COMPLETE_SCENE_1,
      ],
    });

    expect(result.diagnostics.map((d) => `${d.severity} ${d.code}`)).toEqual([
      "error localeScriptDuplicateClip",
      "warning localeScriptUntranslated",
      "warning localeScriptVoiceWithoutTranslation",
    ]);
  });

  it("passes a complete chapter", () => {
    const result = validateChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      scenes: SCENES,
      existing: [
        existing("scene_0.md", [
          { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨。" },
          { id: "L002", speaker: "相馬律", zh: "好。", ja: "ああ。" },
          { id: "L003", speaker: "相馬律", zh: "走吧。", ja: "行こう。" },
        ]),
        COMPLETE_SCENE_1,
      ],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({
      emittedLines: 6,
      uniqueLines: 5,
      translated: 5,
      missing: 0,
      untranslated: 0,
      stale: 0,
      changed: 0,
      withoutId: 0,
    });
  });

  it("flags a line whose text or expression changed since it was translated", () => {
    const result = validateChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      scenes: SCENES,
      existing: [
        existing("scene_0.md", [
          { id: "L001", speaker: "旁白", zh: "小雨。", ja: "小雨。" },
          {
            id: "L002",
            speaker: "相馬律",
            expression: "tired",
            zh: "好。",
            ja: "ああ。",
          },
          { id: "L003", speaker: "相馬律", zh: "走吧。", ja: "行こう。" },
        ]),
        COMPLETE_SCENE_1,
      ],
    });

    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "localeScriptSourceChanged",
      "localeScriptSourceChanged",
    ]);
    expect(result.diagnostics[0]?.message).toContain(
      'L001 was translated from "旁白: 小雨。" but now reads "旁白: 雨。"',
    );
    expect(result.summary).toMatchObject({ translated: 5, changed: 2 });
  });

  it("warns on coverage gaps and errors on structural problems", () => {
    const result = validateChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      scenes: [
        ...SCENES,
        {
          chapterId: CHAPTER,
          sceneFile: "scene_2.md",
          sceneId: "scene_2",
          lines: [line(null, "早坂茜", "新的一句。")],
        },
      ],
      existing: [
        existing(
          "scene_0.md",
          [
            { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨。" },
            { id: "L002", speaker: "相馬律", zh: "好。", ja: "" },
            {
              id: "L009",
              speaker: "旁白",
              zh: "刪掉的句子。",
              ja: "消えた文。",
            },
          ],
          { source: "docs/stories_plan/chapter_1/scene_9.md" },
        ),
        existing("scene_1.md", [
          { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨だ。" },
          { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨。" },
        ]),
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
      "warning dialogueLineWithoutId",
      "error localeScriptSourceMismatch",
      "warning localeScriptUntranslated",
      "warning localeScriptStaleEntry",
      "error localeScriptDuplicateKey",
      "warning localeScriptMissingEntry",
      "warning localeScriptMissingEntry",
      "warning localeGlossaryMissingSpeaker",
    ]);
    expect(result.summary).toEqual({
      emittedLines: 7,
      uniqueLines: 5,
      translated: 3,
      missing: 2,
      untranslated: 1,
      stale: 1,
      changed: 0,
      withoutId: 1,
    });
  });
});
