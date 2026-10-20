import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDialogueLocaleManifest } from "./locale-manifest";
import { serializeLocaleScript } from "./locale-script";
import type { EmittedLine, LocaleScriptLine } from "./types";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(resolve(tmpdir(), "lyra-locale-manifest-"));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function chapterDir(chapterId: string): string {
  return resolve(repoRoot, "docs/stories_plan", chapterId);
}

function writeScript(
  chapterId: string,
  sceneFile: string,
  lines: LocaleScriptLine[],
): void {
  const dir = resolve(chapterDir(chapterId), "ja");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, sceneFile.replace(/\.md$/, ".ja.yaml")),
    serializeLocaleScript({
      schemaVersion: 1,
      locale: "ja",
      source: `docs/stories_plan/${chapterId}/${sceneFile}`,
      lines,
      stale: [],
    }),
  );
}

function writeClip(clip: string): void {
  const dir = resolve(repoRoot, "static/assets/voice/ja");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${clip}.ogg`), "");
}

function line(
  id: string | null,
  speaker: string,
  text: string,
  expression: string | null = null,
  sourceFile: string | null = null,
): EmittedLine {
  return { id, speaker, text, expression, sourceFile };
}

function scene(sceneFile: string, lines: EmittedLine[]) {
  return { sceneFile, sceneId: sceneFile.replace(/\.md$/, ""), lines };
}

describe("buildDialogueLocaleManifest", () => {
  it("joins emitted lines with their translations by line ID", () => {
    writeScript("chapter_1", "scene_0.md", [
      { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨。" },
      {
        id: "L002",
        speaker: "相馬律",
        zh: "好。",
        ja: "ああ。",
        voice: { clip: "ch1_soma_ritsu_0001" },
      },
      // Whitespace counts as untranslated, so its existing clip never plays.
      {
        id: "L003",
        speaker: "相馬律",
        zh: "走吧。",
        ja: "  ",
        voice: { clip: "ch1_soma_ritsu_0002" },
      },
    ]);
    writeScript("chapter_1", "investigation_scene_1.md", [
      {
        id: "L004",
        speaker: "早坂茜",
        expression: "concerned",
        zh: "等等。",
        ja: "待って。",
        voice: { clip: "ch1_hayasaka_akane_0001" },
      },
    ]);
    writeClip("ch1_soma_ritsu_0001");
    writeClip("ch1_soma_ritsu_0002");

    const result = buildDialogueLocaleManifest({
      locale: "ja",
      repoRoot,
      chapters: [
        {
          chapterId: "chapter_1",
          chapterDir: chapterDir("chapter_1"),
          scenes: [
            scene("scene_0.md", [
              line("L001", "旁白", "雨。"),
              line("L002", "相馬律", "好。", "standard"),
              line("L003", "相馬律", "走吧。", "standard"),
              line("L002", "相馬律", "好。", "standard"),
            ]),
            scene("analysis_scene_1.md", [
              line(
                "L004",
                "早坂茜",
                "等等。",
                "concerned",
                "investigation_scene_1.md",
              ),
              line(null, "相馬律", "新的一句。"),
            ]),
          ],
        },
        {
          chapterId: "chapter_2",
          chapterDir: chapterDir("chapter_2"),
          scenes: [scene("scene_0.md", [line("L001", "旁白", "晴。")])],
        },
      ],
    });

    expect(result.manifest).toEqual({
      schemaVersion: 1,
      locale: "ja",
      chapters: [
        {
          id: "chapter_1",
          lines: [
            {
              speaker: "旁白",
              expression: null,
              zh: "雨。",
              text: "雨。",
              voice: null,
            },
            {
              speaker: "相馬律",
              expression: null,
              zh: "好。",
              text: "ああ。",
              voice: "voice.ja.ch1_soma_ritsu_0001",
            },
            {
              speaker: "早坂茜",
              expression: "concerned",
              zh: "等等。",
              text: "待って。",
              voice: null,
            },
          ],
        },
      ],
    });
    expect(result.warnings).toEqual([
      {
        code: "dialogueLocaleIncomplete",
        message:
          "chapter_1 ja: 2 spoken lines have no translation yet. Run `bun run voice:sync chapter_1`, then `bun run voice:validate chapter_1`.",
        sourceFile: "docs/stories_plan/chapter_1/ja",
        line: 1,
      },
      {
        code: "voiceClipMissing",
        message:
          "chapter_1 ja: 1 voice clip(s) not found (first: static/assets/voice/ja/ch1_hayasaka_akane_0001.ogg); those lines play without voice.",
        sourceFile: "docs/stories_plan/chapter_1/ja",
        line: 1,
      },
    ]);
  });

  it("keeps a translation when its line is edited, and warns that it changed", () => {
    writeScript("chapter_1", "scene_0.md", [
      { id: "L001", speaker: "旁白", zh: "雨停了。", ja: "雨が止んだ。" },
    ]);

    const result = buildDialogueLocaleManifest({
      locale: "ja",
      repoRoot,
      chapters: [
        {
          chapterId: "chapter_1",
          chapterDir: chapterDir("chapter_1"),
          scenes: [scene("scene_0.md", [line("L001", "旁白", "雨終於停了。")])],
        },
      ],
    });

    expect(result.manifest.chapters[0]?.lines).toEqual([
      {
        speaker: "旁白",
        expression: null,
        zh: "雨終於停了。",
        text: "雨が止んだ。",
        voice: null,
      },
    ]);
    expect(result.warnings.map((w) => w.code)).toEqual([
      "dialogueLocaleSourceChanged",
    ]);
  });

  it("plays the first translation of two lines that read the same", () => {
    writeScript("chapter_1", "scene_0.md", [
      { id: "L001", speaker: "相馬律", zh: "好。", ja: "よし。" },
      { id: "L002", speaker: "相馬律", zh: "好。", ja: "いいだろう。" },
    ]);

    const result = buildDialogueLocaleManifest({
      locale: "ja",
      repoRoot,
      chapters: [
        {
          chapterId: "chapter_1",
          chapterDir: chapterDir("chapter_1"),
          scenes: [
            scene("scene_0.md", [
              line("L001", "相馬律", "好。"),
              line("L002", "相馬律", "好。"),
            ]),
          ],
        },
      ],
    });

    expect(result.manifest.chapters[0]?.lines.map((l) => l.text)).toEqual([
      "よし。",
    ]);
    expect(result.warnings.map((w) => w.code)).toEqual([
      "dialogueLocaleAmbiguous",
    ]);
  });

  it("plays the clip of either of two identical lines", () => {
    writeScript("chapter_1", "scene_0.md", [
      { id: "L001", speaker: "相馬律", zh: "好。", ja: "よし。" },
    ]);
    writeScript("chapter_1", "scene_1.md", [
      {
        id: "L001",
        speaker: "相馬律",
        zh: "好。",
        ja: "よし。",
        voice: { clip: "ch1_soma_ritsu_0001" },
      },
    ]);
    writeClip("ch1_soma_ritsu_0001");

    const result = buildDialogueLocaleManifest({
      locale: "ja",
      repoRoot,
      chapters: [
        {
          chapterId: "chapter_1",
          chapterDir: chapterDir("chapter_1"),
          scenes: [
            scene("scene_0.md", [line("L001", "相馬律", "好。")]),
            scene("scene_1.md", [line("L001", "相馬律", "好。")]),
          ],
        },
      ],
    });

    expect(result.manifest.chapters[0]?.lines).toEqual([
      {
        speaker: "相馬律",
        expression: null,
        zh: "好。",
        text: "よし。",
        voice: "voice.ja.ch1_soma_ritsu_0001",
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("skips unreadable scripts and keeps the first of repeated IDs", () => {
    writeScript("chapter_1", "scene_0.md", [
      { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨。" },
      { id: "L001", speaker: "旁白", zh: "雨。", ja: "雨だ。" },
    ]);
    writeFileSync(
      resolve(chapterDir("chapter_1"), "ja/scene_2.ja.yaml"),
      "schemaVersion: 2\n",
    );

    const result = buildDialogueLocaleManifest({
      locale: "ja",
      repoRoot,
      chapters: [
        {
          chapterId: "chapter_1",
          chapterDir: chapterDir("chapter_1"),
          scenes: [scene("scene_0.md", [line("L001", "旁白", "雨。")])],
        },
      ],
    });

    expect(result.manifest.chapters[0]?.lines).toEqual([
      {
        speaker: "旁白",
        expression: null,
        zh: "雨。",
        text: "雨。",
        voice: null,
      },
    ]);
    expect(result.warnings.map((w) => [w.code, w.sourceFile])).toEqual([
      [
        "dialogueLocaleDuplicateKey",
        "docs/stories_plan/chapter_1/ja/scene_0.ja.yaml",
      ],
      [
        "dialogueLocaleScriptInvalid",
        "docs/stories_plan/chapter_1/ja/scene_2.ja.yaml",
      ],
    ]);
    expect(result.warnings[1]?.message).toBe(
      "docs/stories_plan/chapter_1/ja/scene_2.ja.yaml was skipped because it has 4 problem(s), starting with: `schemaVersion` must be 1. Run `bun run voice:validate chapter_1`.",
    );
  });
});
