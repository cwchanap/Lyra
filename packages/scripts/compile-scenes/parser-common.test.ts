import { describe, expect, it } from "vitest";
import {
  consumeDialogueUntilHeading,
  consumeMetadata,
  describeToken,
  parseFailure,
} from "./parser-common";
import { tokenize, type Token } from "./tokenizer";

function cursorFor(source: string, sourceFile: string) {
  const tokens = tokenize(source, sourceFile);
  let index = 0;

  return {
    sourceFile,
    peek(): Token | undefined {
      return tokens[index];
    },
    next(): Token | undefined {
      return tokens[index++];
    },
  };
}

describe("parser-common", () => {
  it("consumes consecutive metadata without taking the following dialogue", () => {
    const cur = cursorFor(
      [
        "- **Kind:** inquiry",
        "- **Status:** unlocked",
        "**相馬律**：先確認現場。",
      ].join("\n"),
      "metadata.md",
    );

    expect(consumeMetadata(cur)).toEqual({
      ok: true,
      value: { Kind: "inquiry", Status: "unlocked" },
    });
    expect(cur.peek()).toMatchObject({
      kind: "dialogue",
      line: 3,
      text: "先確認現場。",
    });
  });

  it("keeps scene-tag asset cues and stops dialogue at any heading", () => {
    const cur = cursorFor(
      [
        "[場景：雨中的走廊。]",
        "- **Background Prompt:** Rainy hallway with reflected neon.",
        "- **BGM:** none",
        "**相馬律**：先確認現場。",
        "#### Next block",
      ].join("\n"),
      "dialogue.md",
    );

    expect(consumeDialogueUntilHeading(cur, 2)).toEqual({
      ok: true,
      value: [
        {
          kind: "sceneTag",
          text: "雨中的走廊。",
          assetCue: {
            backgroundPrompt: "Rainy hallway with reflected neon.",
            backgroundAssetId: null,
            bgm: { channel: "bgm", assetId: null },
            bgs: null,
          },
        },
        {
          kind: "line",
          speaker: "相馬律",
          text: "先確認現場。",
          expression: null,
          portrait: null,
        },
      ],
    });
    expect(cur.peek()).toMatchObject({
      kind: "heading",
      level: 4,
      line: 5,
      text: "Next block",
    });
  });

  it("reports stray dialogue metadata with its authored source line", () => {
    const result = consumeDialogueUntilHeading(
      cursorFor("- **Status:** unlocked", "dialogue.md"),
      2,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "strayMetadataInDialogueBody",
        message: "Stray metadata in dialogue body: Status.",
        sourceFile: "dialogue.md",
        line: 1,
      },
    });
  });

  it("describes tokens and constructs source-aware parse failures", () => {
    const heading = tokenize("### Evidence Manifest", "token.md")[0]!;

    expect(describeToken(heading)).toBe('H3 "Evidence Manifest"');
    expect(
      parseFailure("scene.md", 17, "sceneUnexpectedToken", "Unexpected token."),
    ).toEqual({
      ok: false,
      error: {
        code: "sceneUnexpectedToken",
        message: "Unexpected token.",
        sourceFile: "scene.md",
        line: 17,
      },
    });
  });
});
