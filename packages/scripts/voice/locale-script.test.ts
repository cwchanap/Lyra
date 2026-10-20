import { describe, expect, it } from "vitest";
import {
  localeScriptPath,
  parseLocaleScriptText,
  sceneFileForScriptName,
  serializeLocaleScript,
} from "./locale-script";
import type { LocaleScriptFile } from "./types";

const PATH = "docs/stories_plan/chapter_1/ja/scene_5.ja.yaml";

function script(overrides: Partial<LocaleScriptFile> = {}): LocaleScriptFile {
  return {
    schemaVersion: 1,
    locale: "ja",
    source: "docs/stories_plan/chapter_1/scene_5.md",
    lines: [
      { speaker: "旁白", zh: "雨停了。", ja: "雨が止んだ。" },
      {
        speaker: "早坂茜",
        expression: "concerned",
        zh: "你還好嗎？",
        ja: "",
        note: "Quiet, close to the mic.",
      },
    ],
    stale: [],
    ...overrides,
  };
}

describe("locale script paths", () => {
  it("maps an authored scene to its script and back", () => {
    expect(localeScriptPath("chapter_1", "scene_5.md", "ja")).toBe(PATH);
    expect(sceneFileForScriptName("scene_5.ja.yaml", "ja")).toBe("scene_5.md");
    expect(sceneFileForScriptName("notes.md", "ja")).toBeNull();
    expect(sceneFileForScriptName(".ja.yaml", "ja")).toBeNull();
  });
});

describe("serializeLocaleScript", () => {
  it("round-trips through the parser", () => {
    const file = script({
      stale: [{ speaker: "旁白", zh: "舊的一句。", ja: "古い一文。" }],
    });
    const parsed = parseLocaleScriptText(serializeLocaleScript(file), PATH);
    expect(parsed).toEqual({ ok: true, value: file });
  });

  it("round-trips a voice block and writes its fields in a fixed order", () => {
    const file = script({
      lines: [
        {
          speaker: "神谷澪",
          zh: "嫌疑人的態度不是證據。",
          ja: "被疑者の態度は、証拠ではありません。",
          voice: {
            generatedAt: "2026-10-25T10:00:00Z",
            ttsHash: "3f9a1c2e0b4d",
            direction: "[calm, precise]",
            clip: "ch1_kamiya_mio_0012",
          },
        },
      ],
    });
    const text = serializeLocaleScript(file);
    expect(parseLocaleScriptText(text, PATH)).toEqual({
      ok: true,
      value: file,
    });
    expect(text).toContain(
      [
        "    voice:",
        "      clip: ch1_kamiya_mio_0012",
        '      direction: "[calm, precise]"',
        "      ttsHash: 3f9a1c2e0b4d",
        "      generatedAt: 2026-10-25T10:00:00Z",
      ].join("\n"),
    );
  });

  it("writes keys in reading order and leaves out an empty stale list", () => {
    const text = serializeLocaleScript(script());
    expect(text).not.toContain("stale:");
    expect(text).toContain(
      [
        "  - speaker: 早坂茜",
        "    expression: concerned",
        "    zh: 你還好嗎？",
        '    ja: ""',
        "    note: Quiet, close to the mic.",
      ].join("\n"),
    );
  });
});

describe("parseLocaleScriptText", () => {
  function codes(text: string): string[] {
    const result = parseLocaleScriptText(text, PATH);
    return result.ok ? [] : result.diagnostics.map((d) => d.message);
  }

  const header = [
    "schemaVersion: 1",
    "locale: ja",
    "source: docs/stories_plan/chapter_1/scene_5.md",
  ].join("\n");

  it("rejects unknown fields, a missing translation and a spelled-out standard", () => {
    expect(
      codes(
        `${header}\nlines:\n  - speaker: 旁白\n    zh: 雨。\n    en: rain\n`,
      ),
    ).toEqual([
      'Unknown line field "en".',
      '`ja` must be a string (use "" when untranslated).',
    ]);
    expect(
      codes(
        `${header}\nlines:\n  - speaker: 旁白\n    expression: standard\n    zh: 雨。\n    ja: 雨。\n`,
      ),
    ).toEqual(['Omit `expression` for "standard"; it is the default.']);
  });

  it("rejects a malformed voice block", () => {
    const line = "lines:\n  - speaker: 旁白\n    zh: 雨。\n    ja: 雨。\n";
    expect(codes(`${header}\n${line}    voice: ch1_x_0001\n`)).toEqual([
      "`voice` must be a mapping.",
    ]);
    expect(
      codes(
        `${header}\n${line}    voice:\n      clip: Ch1/Bad\n      tts: ""\n      speed: 1\n`,
      ),
    ).toEqual([
      'Unknown voice field "speed".',
      "`voice.clip` must be a lowercase slug such as ch1_soma_ritsu_0001.",
      "`voice.tts` must be a non-empty string when present.",
    ]);
  });

  it("rejects a wrong schema version and malformed YAML", () => {
    expect(
      codes(
        header.replace("schemaVersion: 1", "schemaVersion: 2") +
          "\nlines: []\n",
      ),
    ).toEqual(["`schemaVersion` must be 1."]);
    const broken = parseLocaleScriptText("lines: [", PATH);
    expect(broken.ok).toBe(false);
  });
});
