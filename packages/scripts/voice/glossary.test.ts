import { describe, expect, it } from "vitest";
import { glossaryPath, parseGlossaryText } from "./glossary";

const PATH = glossaryPath("ja");

const VALID = `schemaVersion: 1
locale: ja
styleRules:
  - Keep names in kanji.
characters:
  - zh: 相馬律
    ja: 相馬律
    reading: そうま りつ
    firstPerson: 俺
terms:
  - zh: 雨鐘
    ja: 雨鐘
    reading: あまがね
`;

describe("parseGlossaryText", () => {
  it("reads characters and terms", () => {
    expect(PATH).toBe("docs/stories_plan/ja_glossary.yaml");
    const result = parseGlossaryText(VALID, PATH);
    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        locale: "ja",
        styleRules: ["Keep names in kanji."],
        characters: [
          {
            zh: "相馬律",
            ja: "相馬律",
            reading: "そうま りつ",
            firstPerson: "俺",
          },
        ],
        terms: [{ zh: "雨鐘", ja: "雨鐘", reading: "あまがね" }],
      },
    });
  });

  it("rejects duplicates, unknown fields and missing translations", () => {
    const text = `${VALID}  - zh: 雨鐘
    ja: 雨鐘
  - zh: 紀錄
    gloss: record
`;
    const result = parseGlossaryText(text, PATH);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => [d.path, d.message])).toEqual([
      [`${PATH}#terms[1]`, 'Duplicate `zh` "雨鐘".'],
      [`${PATH}#terms[2]`, 'Unknown field "gloss".'],
      [`${PATH}#terms[2]`, "`ja` is required."],
    ]);
  });
});
