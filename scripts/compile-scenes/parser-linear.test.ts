import { describe, expect, it } from "bun:test";
import { parseLinearScene } from "./parser-linear";

describe("parseLinearScene", () => {
  it("parses a minimal linear scene", () => {
    const source = `
# Scene 0: 接案

[場景：吉祥寺街道，深夜。]

[相馬律收起傘。]

**早坂茜**：你來得比我想的快。
`.trim();
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("scene_0");
    expect(result.value.title).toBe("接案");
    expect(result.value.queue).toEqual([
      { kind: "sceneTag", text: "吉祥寺街道，深夜。" },
      { kind: "action", text: "相馬律收起傘。" },
      { kind: "line", speaker: "早坂茜", text: "你來得比我想的快。" },
    ]);
  });

  it("rejects a linear scene containing an H2 heading", () => {
    const source = `
# Scene 0: foo

## NotAllowed

**A**：hi
`.trim();
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("linearSceneHasHeadings");
  });

  it("rejects a linear scene missing the H1 title", () => {
    const source = `**A**：hi`;
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("linearSceneMissingTitle");
  });

  it("preserves source order in the queue", () => {
    const source = `
# Scene 0: order

**A**：one
[action one]
**B**：two
[場景：tag]
**A**：three
`.trim();
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queue.map((q) => q.kind)).toEqual([
      "line",
      "action",
      "line",
      "sceneTag",
      "line",
    ]);
  });
});
