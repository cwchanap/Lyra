import { describe, expect, it } from "bun:test";
import { tokenize } from "./tokenizer";

describe("tokenizer", () => {
  it("classifies an H1 heading without anchor", () => {
    const tokens = tokenize("# Scene 0: 接案", "test.md");
    expect(tokens).toEqual([
      {
        kind: "heading",
        level: 1,
        text: "Scene 0: 接案",
        anchorId: null,
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("classifies an H3 heading with anchor id", () => {
    const tokens = tokenize("### Hotspot: 桌子 {#table}", "test.md");
    expect(tokens).toEqual([
      {
        kind: "heading",
        level: 3,
        text: "Hotspot: 桌子",
        anchorId: "table",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("classifies a metadata line", () => {
    const tokens = tokenize("- **Status:** locked", "test.md");
    expect(tokens).toEqual([
      {
        kind: "metadata",
        key: "Status",
        value: "locked",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("classifies a metadata line whose value contains spaces", () => {
    const tokens = tokenize(
      "- **Unlock:** hotspot:foo investigated and topic:bar@baz discussed",
      "test.md",
    );
    expect(tokens).toEqual([
      {
        kind: "metadata",
        key: "Unlock",
        value: "hotspot:foo investigated and topic:bar@baz discussed",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("classifies a scene-tag bracketed line", () => {
    const tokens = tokenize("[場景：吉祥寺街道，深夜，雨夜。]", "test.md");
    expect(tokens).toEqual([
      {
        kind: "sceneTag",
        text: "吉祥寺街道，深夜，雨夜。",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("classifies a non-scene-tag bracketed line as an action", () => {
    const tokens = tokenize("[相馬律收起傘。]", "test.md");
    expect(tokens).toEqual([
      {
        kind: "action",
        text: "相馬律收起傘。",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("classifies a dialogue line with full-width colon", () => {
    const tokens = tokenize("**早坂茜**：你來得比我想的快。", "test.md");
    expect(tokens).toEqual([
      {
        kind: "dialogue",
        speaker: "早坂茜",
        expression: null,
        text: "你來得比我想的快。",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("parses optional dialogue expression tags", () => {
    expect(tokenize("**早坂茜**[concerned]：你不舒服？", "test.md")).toEqual([
      {
        kind: "dialogue",
        speaker: "早坂茜",
        expression: "concerned",
        text: "你不舒服？",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("rejects malformed expression brackets as unknown", () => {
    expect(tokenize("**早坂茜**[擔心]：你不舒服？", "test.md")[0]?.kind).toBe(
      "unknown",
    );
  });

  it("ignores blank lines", () => {
    const tokens = tokenize("\n\n", "test.md");
    expect(tokens).toEqual([]);
  });

  it("preserves line numbers across blank lines", () => {
    const tokens = tokenize("# H1\n\n**A**：hi", "test.md");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ kind: "heading", line: 1 });
    expect(tokens[1]).toMatchObject({ kind: "dialogue", line: 3 });
  });

  it("emits an unknown token for unrecognized content", () => {
    const tokens = tokenize(
      "just some random prose without any structure",
      "test.md",
    );
    expect(tokens).toEqual([
      {
        kind: "unknown",
        text: "just some random prose without any structure",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("treats a half-width colon in a dialogue line as unknown (full-width required)", () => {
    const tokens = tokenize("**早坂茜**: text", "test.md");
    expect(tokens[0]?.kind).toBe("unknown");
  });

  it("handles multi-line scene-tag bracket blocks", () => {
    const source = `[場景：吉祥寺雨鐘咖啡館，深夜。外頭下著細雨，店內燈光昏黃。
吧台後傳出咖啡機的低鳴，空氣中混著金木犀拿鐵的香氣。]`;
    const tokens = tokenize(source, "test.md");
    expect(tokens).toEqual([
      {
        kind: "sceneTag",
        text: "吉祥寺雨鐘咖啡館，深夜。外頭下著細雨，店內燈光昏黃。 吧台後傳出咖啡機的低鳴，空氣中混著金木犀拿鐵的香氣。",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("handles multi-line action bracket blocks", () => {
    const source = `[相馬律看了一眼窗外，
然後轉過身來。]`;
    const tokens = tokenize(source, "test.md");
    expect(tokens).toEqual([
      {
        kind: "action",
        text: "相馬律看了一眼窗外， 然後轉過身來。",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });
});
