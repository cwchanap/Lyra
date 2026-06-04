import { describe, expect, it } from "vitest";
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
      {
        kind: "sceneTag",
        text: "吉祥寺街道，深夜。",
        assetCue: {
          backgroundPrompt: null,
          backgroundAssetId: null,
          bgm: null,
          bgs: null,
        },
      },
      { kind: "action", text: "相馬律收起傘。" },
      {
        kind: "line",
        speaker: "早坂茜",
        text: "你來得比我想的快。",
        expression: null,
        portrait: null,
      },
    ]);
  });

  it("attaches asset metadata to the preceding scene tag", () => {
    const source = `
# Scene 0: 接案

[場景：咖啡館外，雨夜。]
- **Background Prompt:** Rainy exterior of a small Tokyo cafe at midnight.
- **BGM:** rain_mystery_low
- **BGS:** street_rain

**早坂茜**：你來得比我想的快。
`.trim();
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queue[0]).toEqual({
      kind: "sceneTag",
      text: "咖啡館外，雨夜。",
      assetCue: {
        backgroundPrompt: "Rainy exterior of a small Tokyo cafe at midnight.",
        backgroundAssetId: null,
        bgm: { channel: "bgm", assetId: "rain_mystery_low" },
        bgs: { channel: "bgs", assetId: "street_rain" },
      },
    });
  });

  it("rejects evidence image metadata on a scene tag", () => {
    const source = `
# Scene 0: 接案

[場景：咖啡館外，雨夜。]
- **Image Prompt:** A key on transparent background.

**早坂茜**：你來得比我想的快。
`.trim();
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("assetMetadataUnknownKey");
    expect(result.error.line).toBe(4);
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

  it("preserves dialogue expression tags", () => {
    const source = `
# Scene 0: expression

**早坂茜**[concerned]：你不舒服？
`.trim();
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queue).toEqual([
      {
        kind: "line",
        speaker: "早坂茜",
        text: "你不舒服？",
        expression: "concerned",
        portrait: null,
      },
    ]);
  });

  it("rejects a linear scene with no dialogue items after the heading", () => {
    const source = `# Scene 0: empty`.trim();
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("linearSceneEmptyQueue");
  });
});
