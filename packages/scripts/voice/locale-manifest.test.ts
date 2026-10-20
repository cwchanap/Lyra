import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDialogueLocaleManifest } from "./locale-manifest";
import { serializeLocaleScript } from "./locale-script";
import type { LocaleScriptLine } from "./types";

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

describe("buildDialogueLocaleManifest", () => {
  it("joins emitted lines with their translations and existing clips", () => {
    writeScript("chapter_1", "scene_0.md", [
      { speaker: "旁白", zh: "雨。", ja: "雨。" },
      {
        speaker: "相馬律",
        zh: "好。",
        ja: "ああ。",
        voice: { clip: "ch1_soma_ritsu_0001" },
      },
      {
        speaker: "早坂茜",
        expression: "concerned",
        zh: "等等。",
        ja: "待って。",
        voice: { clip: "ch1_hayasaka_akane_0001" },
      },
      // Whitespace counts as untranslated, so its existing clip never plays.
      {
        speaker: "相馬律",
        zh: "走吧。",
        ja: "  ",
        voice: { clip: "ch1_soma_ritsu_0002" },
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
            {
              sceneFile: "scene_0.md",
              lines: [
                { speaker: "旁白", text: "雨。", expression: null },
                { speaker: "相馬律", text: "好。", expression: "standard" },
                { speaker: "相馬律", text: "走吧。", expression: "standard" },
              ],
            },
            {
              sceneFile: "scene_1.md",
              lines: [
                { speaker: "相馬律", text: "好。", expression: null },
                { speaker: "早坂茜", text: "等等。", expression: "concerned" },
              ],
            },
          ],
        },
        {
          chapterId: "chapter_2",
          chapterDir: chapterDir("chapter_2"),
          scenes: [
            {
              sceneFile: "scene_0.md",
              lines: [{ speaker: "旁白", text: "晴。", expression: null }],
            },
          ],
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
          "chapter_1 ja: 1 of 4 spoken lines have no translation yet. Run `bun run voice:sync chapter_1`, then `bun run voice:validate chapter_1`.",
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

  it("skips unreadable scripts and keeps the first of repeated keys", () => {
    writeScript("chapter_1", "scene_0.md", [
      { speaker: "旁白", zh: "雨。", ja: "雨。" },
    ]);
    writeScript("chapter_1", "scene_1.md", [
      { speaker: "旁白", zh: "雨。", ja: "雨だ。" },
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
          scenes: [
            {
              sceneFile: "scene_0.md",
              lines: [{ speaker: "旁白", text: "雨。", expression: null }],
            },
          ],
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
        "docs/stories_plan/chapter_1/ja/scene_1.ja.yaml",
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
