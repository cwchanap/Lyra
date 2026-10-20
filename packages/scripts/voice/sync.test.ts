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

function emitted(
  id: string | null,
  speaker: string,
  text: string,
  expression: string | null = null,
  sourceFile: string | null = null,
): EmittedScene["lines"][number] {
  return { id, speaker, text, expression, sourceFile };
}

const REPORT = {
  added: 0,
  kept: 0,
  staled: 0,
  droppedUntranslated: 0,
  withoutId: 0,
};

describe("syncChapterScripts", () => {
  it("lists each line ID once, in the script of the file the line is written in", () => {
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [],
      scenes: [
        scene("scene_0.md", [
          emitted("L001", "旁白", "雨。"),
          emitted("L002", "相馬律", "好。", "standard"),
          emitted("L002", "相馬律", "好。", "standard"),
          emitted("L003", "相馬律", "好。", "tired"),
          emitted(null, "旁白", "新的一句。"),
        ]),
        scene("analysis_scene_1.md", [
          emitted("L004", "相馬律", "對。", null, "investigation_scene_1.md"),
        ]),
      ],
    });

    expect(written(result, "scene_0.md")?.lines).toEqual([
      { id: "L001", speaker: "旁白", zh: "雨。", ja: "" },
      { id: "L002", speaker: "相馬律", zh: "好。", ja: "" },
      {
        id: "L003",
        speaker: "相馬律",
        expression: "tired",
        zh: "好。",
        ja: "",
      },
    ]);
    expect(written(result, "investigation_scene_1.md")?.lines).toEqual([
      { id: "L004", speaker: "相馬律", zh: "對。", ja: "" },
    ]);
    expect(written(result, "analysis_scene_1.md")).toBeUndefined();
    expect(result.ok && result.report).toEqual({
      ...REPORT,
      added: 4,
      withoutId: 1,
    });
  });

  it("keeps an entry exactly as it is when its line's text changes", () => {
    const translated: LocaleScriptLine = {
      id: "L001",
      speaker: "旁白",
      zh: "雨停了。",
      ja: "雨が止んだ。",
      note: "Flat.",
    };
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [existing("scene_0.md", [translated])],
      scenes: [
        scene("scene_0.md", [
          emitted("L002", "旁白", "風起了。"),
          emitted("L001", "旁白", "雨終於停了。"),
        ]),
      ],
    });

    expect(written(result, "scene_0.md")?.lines).toEqual([
      { id: "L002", speaker: "旁白", zh: "風起了。", ja: "" },
      translated,
    ]);
    expect(result.ok && result.report).toEqual({
      ...REPORT,
      added: 1,
      kept: 1,
    });
  });

  it("keeps the entries of a repeated line apart", () => {
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [
        existing("scene_0.md", [
          { id: "L001", speaker: "相馬律", zh: "好。", ja: "よし。" },
          { id: "L002", speaker: "相馬律", zh: "好。", ja: "いいだろう。" },
        ]),
      ],
      scenes: [
        scene("scene_0.md", [
          emitted("L001", "相馬律", "好。"),
          emitted("L002", "相馬律", "好。"),
        ]),
      ],
    });

    expect(written(result, "scene_0.md")?.lines.map((l) => l.ja)).toEqual([
      "よし。",
      "いいだろう。",
    ]);
  });

  it("keeps a voiced or translated orphan as stale and drops an empty one", () => {
    const voiced: LocaleScriptLine = {
      id: "L002",
      speaker: "相馬律",
      zh: "好。",
      ja: "",
      voice: { clip: "ch1_soma_ritsu_0001" },
    };
    const translated: LocaleScriptLine = {
      id: "L003",
      speaker: "旁白",
      zh: "舊句。",
      ja: "古い文。",
    };
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [
        existing("scene_0.md", [
          { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨。" },
          voiced,
          translated,
          { id: "L004", speaker: "旁白", zh: "草稿。", ja: "" },
        ]),
      ],
      scenes: [scene("scene_0.md", [emitted("L001", "旁白", "雨。")])],
    });

    expect(written(result, "scene_0.md")).toMatchObject({
      lines: [{ id: "L001", speaker: "旁白", zh: "雨。", ja: "雨。" }],
      stale: [voiced, translated],
    });
    expect(result.ok && result.report).toEqual({
      ...REPORT,
      kept: 1,
      staled: 2,
      droppedUntranslated: 1,
    });
  });

  it("brings a stale entry back when its line ID returns", () => {
    const old: LocaleScriptLine = {
      id: "L005",
      speaker: "旁白",
      zh: "雨。",
      ja: "雨。",
    };
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [existing("scene_0.md", [], [old])],
      scenes: [scene("scene_0.md", [emitted("L005", "旁白", "雨。")])],
    });

    expect(written(result, "scene_0.md")).toEqual(
      expect.objectContaining({ lines: [old], stale: [] }),
    );
  });

  it("deletes a script whose scene no longer has anything to hold", () => {
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [
        existing("scene_9.md", [
          { id: "L001", speaker: "旁白", zh: "雨。", ja: "" },
        ]),
      ],
      scenes: [scene("scene_0.md", [emitted("L001", "旁白", "晴。")])],
    });

    expect(result.ok && result.deletes).toEqual([
      "docs/stories_plan/chapter_1/ja/scene_9.ja.yaml",
    ]);
  });

  it("refuses to pick between two entries for the same line ID", () => {
    const line = { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨。" };
    const result = syncChapterScripts({
      chapterId: CHAPTER,
      locale: "ja",
      existing: [existing("scene_0.md", [line], [{ ...line, ja: "雨だ。" }])],
      scenes: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "localeScriptDuplicateKey",
    ]);
  });
});
