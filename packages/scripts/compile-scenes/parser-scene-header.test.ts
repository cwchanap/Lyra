import { describe, expect, it } from "vitest";
import { parseSceneHeader } from "./parser-scene-header";
import { tokenize } from "./tokenizer";

const missingTitle = {
  code: "testSceneMissingTitle",
  message: "Scene must start with a title.",
};

function parseHeader(source: string) {
  return parseSceneHeader(
    tokenize(source.trim(), "scene.md"),
    "scene.md",
    missingTitle,
  );
}

describe("parseSceneHeader", () => {
  it("parses one immediate authored Summary", () => {
    const result = parseHeader(`
# Scene 7: 雨水留下的時間

- **Summary:** 相馬重新回到雨鐘後場，開始懷疑摘要時間不是事件時間。
`);

    expect(result).toEqual({
      ok: true,
      value: {
        title: "雨水留下的時間",
        summary: "相馬重新回到雨鐘後場，開始懷疑摘要時間不是事件時間。",
        summaryAuthored: true,
        nextTokenIndex: 2,
        line: 1,
      },
    });
  });

  it("falls back to the title when no Summary is authored", () => {
    const result = parseHeader(`# Scene 7: 雨水留下的時間`);

    expect(result).toEqual({
      ok: true,
      value: {
        title: "雨水留下的時間",
        summary: "雨水留下的時間",
        summaryAuthored: false,
        nextTokenIndex: 1,
        line: 1,
      },
    });
  });

  it("rejects a dash-less Summary", () => {
    const result = parseHeader(`
# Scene 7: title
**Summary:** malformed
`);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "sceneSummaryMalformedSyntax", line: 2 },
    });
  });

  it("rejects a blank Summary", () => {
    const result = parseHeader(`
# Scene 7: title
- **Summary:**
`);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "sceneSummaryBlank", line: 2 },
    });
  });

  it("rejects a second Summary at its source line", () => {
    const result = parseHeader(`
# Scene 7: title
- **Summary:** first
- **Summary:** second
`);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "sceneSummaryDuplicate", line: 3 },
    });
  });

  it.each([
    ["dialogue", "**A**：too late"],
    ["scene tag", "[場景：too late]"],
    ["H2", "## Intro"],
  ])("rejects a Summary after %s", (_kind, preceding) => {
    const result = parseHeader(`
# Scene 7: title
${preceding}
- **Summary:** too late
`);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "sceneSummaryMisplaced", line: 3 },
    });
  });
});
