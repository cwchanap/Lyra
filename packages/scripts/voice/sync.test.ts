import { describe, expect, it } from "vitest";
import { syncChapterScripts, type ExistingScript } from "./sync";
import type { EmittedScene, LocaleScriptFile, LocaleScriptLine } from "./types";

const CHAPTER = "chapter_1";

function scene(sceneFile: string, lines: EmittedScene["lines"]): EmittedScene {
  return {
    chapterId: CHAPTER,
    sceneFile,
    sceneId: sceneFile.replace(/\.md$/, ""),
    lines,
  };
}

function existing(
  sceneFile: string,
  lines: LocaleScriptLine[],
  stale: LocaleScriptLine[] = [],
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
      stale,
    },
  };
}

function written(
  result: ReturnType<typeof syncChapterScripts>,
  sceneFile: string,
): LocaleScriptFile | undefined {
  if (!result.ok) throw new Error("sync failed");
  const base = sceneFile.replace(/\.md$/, "");
  return result.writes.get(`docs/stories_plan/${CHAPTER}/ja/${base}.ja.yaml`);
}

describe("syncChapterScripts", () => {
  it("lists each unique line once, in the first scene that emits it", () => {
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [],
      scenes: [
        scene("scene_0.md", [
          { speaker: "旁白", text: "雨。", expression: null },
          { speaker: "相馬律", text: "好。", expression: "standard" },
          { speaker: "相馬律", text: "好。", expression: null },
        ]),
        scene("scene_1.md", [
          { speaker: "相馬律", text: "好。", expression: "standard" },
          { speaker: "相馬律", text: "好。", expression: "tired" },
        ]),
      ],
    });

    expect(written(result, "scene_0.md")?.lines).toEqual([
      { speaker: "旁白", zh: "雨。", ja: "" },
      { speaker: "相馬律", zh: "好。", ja: "" },
    ]);
    expect(written(result, "scene_1.md")?.lines).toEqual([
      { speaker: "相馬律", expression: "tired", zh: "好。", ja: "" },
    ]);
    expect(result.ok && result.report).toEqual({
      added: 3,
      kept: 0,
      staled: 0,
      droppedUntranslated: 0,
    });
  });

  it("moves a translation with its line and keeps orphaned translations as stale", () => {
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [
        existing("scene_0.md", [
          { speaker: "旁白", zh: "雨。", ja: "雨。", note: "Flat." },
          { speaker: "旁白", zh: "舊句。", ja: "古い文。" },
          { speaker: "旁白", zh: "草稿。", ja: "" },
        ]),
      ],
      scenes: [
        scene("scene_0.md", [
          { speaker: "旁白", text: "新句。", expression: null },
        ]),
        scene("scene_1.md", [
          { speaker: "旁白", text: "雨。", expression: null },
        ]),
      ],
    });

    expect(written(result, "scene_0.md")).toMatchObject({
      lines: [{ speaker: "旁白", zh: "新句。", ja: "" }],
      stale: [{ speaker: "旁白", zh: "舊句。", ja: "古い文。" }],
    });
    expect(written(result, "scene_1.md")?.lines).toEqual([
      { speaker: "旁白", zh: "雨。", ja: "雨。", note: "Flat." },
    ]);
    expect(result.ok && result.report).toEqual({
      added: 1,
      kept: 1,
      staled: 1,
      droppedUntranslated: 1,
    });
  });

  it("deletes a script whose scene no longer has anything to hold", () => {
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [
        existing("scene_9.md", [{ speaker: "旁白", zh: "雨。", ja: "" }]),
      ],
      scenes: [
        scene("scene_0.md", [
          { speaker: "旁白", text: "晴。", expression: null },
        ]),
      ],
    });

    expect(result.ok && result.deletes).toEqual([
      "docs/stories_plan/chapter_1/ja/scene_9.ja.yaml",
    ]);
  });

  it("refuses to pick between two entries for the same line", () => {
    const line = { speaker: "旁白", zh: "雨。", ja: "雨。" };
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [
        existing("scene_0.md", [line]),
        existing("scene_1.md", [], [{ ...line, ja: "雨だ。" }]),
      ],
      scenes: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "localeScriptDuplicateKey",
    ]);
  });
});
