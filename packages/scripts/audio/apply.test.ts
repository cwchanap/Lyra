import { describe, expect, it } from "vitest";
import { applyAudioCuesToMarkdown } from "./apply";

describe("audio apply", () => {
  it("inserts BGM and BGS after existing background prompt", () => {
    const source =
      "# Scene 6\n\n[場景：街道，雨。]\n- **Background Prompt:** Rain street.\n\n**相馬律**：走吧。\n";
    const result = applyAudioCuesToMarkdown("scene_6.md", source, [
      {
        file: "scene_6.md",
        visualUnit: "tag_001",
        bgm: "low_tension",
        bgs: "rain_street_light",
      },
    ]);
    expect(result.changed).toBe(true);
    expect(result.source).toContain(
      "- **Background Prompt:** Rain street.\n- **BGM:** low_tension\n- **BGS:** rain_street_light",
    );
  });

  it("updates existing BGM and preserves BGS", () => {
    const source =
      "# Scene 0\n\n[場景：黑底。]\n- **Background Prompt:** Black UI.\n- **BGM:** none\n- **BGS:** none\n";
    const result = applyAudioCuesToMarkdown("scene_0.md", source, [
      {
        file: "scene_0.md",
        visualUnit: "tag_001",
        bgm: "low_tension",
      },
    ]);
    expect(result.source).toContain("- **BGM:** low_tension\n- **BGS:** none");
  });

  it("reports unknown visual units", () => {
    const result = applyAudioCuesToMarkdown(
      "scene_6.md",
      "# Scene 6\n\n[場景：街道，雨。]\n",
      [
        {
          file: "scene_6.md",
          visualUnit: "tag_999",
          bgs: "rain_street_light",
        },
      ],
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "audioApplyUnknownVisualUnit",
        path: "scene_6.md:cues[0]:tag_999",
        message: expect.stringContaining("Known visual units: tag_001"),
      }),
    );
  });

  it("preserves CRLF for no-op relevant cues", () => {
    const source =
      "# Scene 6\r\n\r\n[場景：街道，雨。]\r\n- **Background Prompt:** Rain street.\r\n- **BGM:** low_tension\r\n- **BGS:** rain_street_light\r\n";
    const result = applyAudioCuesToMarkdown("scene_6.md", source, [
      {
        file: "scene_6.md",
        visualUnit: "tag_001",
        bgm: "low_tension",
        bgs: "rain_street_light",
      },
    ]);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });

  it("preserves CRLF when inserting metadata", () => {
    const source =
      "# Scene 6\r\n\r\n[場景：街道，雨。]\r\n- **Background Prompt:** Rain street.\r\n\r\n**相馬律**：走吧。\r\n";
    const result = applyAudioCuesToMarkdown("scene_6.md", source, [
      {
        file: "scene_6.md",
        visualUnit: "tag_001",
        bgm: "low_tension",
      },
    ]);
    expect(result.changed).toBe(true);
    expect(result.source).toContain(
      "- **Background Prompt:** Rain street.\r\n- **BGM:** low_tension",
    );
    expect(result.source).not.toContain(
      "- **Background Prompt:** Rain street.\n- **BGM:** low_tension",
    );
  });

  it("updates interactive visual metadata tails while preserving structural metadata", () => {
    const source =
      "# Scene 3\n\n## Sub-location: 雨鐘前場 {#front}\n- **Status:** unlocked\n- **Background Prompt:** Front room.\n- **BGS:** none\n\n[場景：前場。]\n";
    const result = applyAudioCuesToMarkdown(
      "investigation_scene_3.md",
      source,
      [
        {
          file: "investigation_scene_3.md",
          visualUnit: "front",
          bgm: "low_tension",
          bgs: "indoor_rain_window",
        },
      ],
    );
    expect(result.source).toContain(
      "- **Status:** unlocked\n- **Background Prompt:** Front room.\n- **BGM:** low_tension\n- **BGS:** indoor_rain_window",
    );
  });

  it("does not duplicate BGM or BGS in blank-line metadata blocks", () => {
    const source =
      "# Scene 2\n\n[場景：橋下，雨。]\n\n- **Background Prompt:** Bridge.\n\n- **BGM:** old_tension\n\n- **BGS:** old_rain\n\n**相馬律**：聽見了嗎？\n";
    const result = applyAudioCuesToMarkdown("scene_2.md", source, [
      {
        file: "scene_2.md",
        visualUnit: "tag_001",
        bgm: "low_tension",
        bgs: "rain_street_light",
      },
    ]);
    const bgmLines = result.source.match(/^- \*\*BGM:\*\*/gm) ?? [];
    const bgsLines = result.source.match(/^- \*\*BGS:\*\*/gm) ?? [];
    expect(bgmLines).toHaveLength(1);
    expect(bgsLines).toHaveLength(1);
    expect(result.source).toContain("- **BGM:** low_tension");
    expect(result.source).toContain("- **BGS:** rain_street_light");
  });

  it("inserts after multi-line scene tags and attached background prompts", () => {
    const source =
      "# Scene 3\n\n[場景：\n地下通道，雨聲從出口灌入。\n]\n- **Background Prompt:** Underpass.\n\n**相馬律**：慢一點。\n";
    const result = applyAudioCuesToMarkdown("scene_3.md", source, [
      {
        file: "scene_3.md",
        visualUnit: "tag_001",
        bgm: "tunnel_low",
        bgs: "tunnel_rain",
      },
    ]);
    const tagCloseIndex = result.source.indexOf("]\n");
    expect(result.source.slice(0, tagCloseIndex)).not.toContain("- **BGM:**");
    expect(result.source).toContain(
      "]\n- **Background Prompt:** Underpass.\n- **BGM:** tunnel_low\n- **BGS:** tunnel_rain",
    );
  });

  it("applies multiple cues without shifting later insertion points", () => {
    const source =
      "# Scene 8\n\n[場景：走廊。]\n- **Background Prompt:** Corridor.\n\n**相馬律**：等等。\n\n[場景：門口。]\n- **Background Prompt:** Door.\n\n**相馬律**：到了。\n";
    const result = applyAudioCuesToMarkdown("scene_8.md", source, [
      {
        file: "scene_8.md",
        visualUnit: "tag_001",
        bgm: "corridor_tension",
      },
      {
        file: "scene_8.md",
        visualUnit: "tag_002",
        bgs: "door_rain",
      },
    ]);
    expect(result.source).toContain(
      "- **Background Prompt:** Corridor.\n- **BGM:** corridor_tension",
    );
    expect(result.source).toContain(
      "- **Background Prompt:** Door.\n- **BGS:** door_rain",
    );
  });

  it("is idempotent when applied twice", () => {
    const source =
      "# Scene 9\n\n[場景：地下鐵月台。]\n- **Background Prompt:** Platform.\n\n**相馬律**：聽見列車了。\n";
    const cues = [
      {
        file: "scene_9.md",
        visualUnit: "tag_001",
        bgm: "platform_tension",
        bgs: "station_rain",
      },
    ];
    const first = applyAudioCuesToMarkdown("scene_9.md", source, cues);
    const second = applyAudioCuesToMarkdown("scene_9.md", first.source, cues);
    expect(second.changed).toBe(false);
    expect(second.source).toBe(first.source);
    expect(second.source.match(/^- \*\*BGM:\*\*/gm) ?? []).toHaveLength(1);
    expect(second.source.match(/^- \*\*BGS:\*\*/gm) ?? []).toHaveLength(1);
  });

  it("merges duplicate visual unit cues deterministically with later values winning", () => {
    const source =
      "# Scene 10\n\n[場景：車站出口。]\n- **Background Prompt:** Station exit.\n- **BGS:** old_rain\n";
    const result = applyAudioCuesToMarkdown("scene_10.md", source, [
      {
        file: "scene_10.md",
        visualUnit: "tag_001",
        bgm: "first_tension",
        bgs: "first_rain",
      },
      {
        file: "scene_10.md",
        visualUnit: "tag_001",
        bgm: "final_tension",
      },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.source).toContain(
      "- **Background Prompt:** Station exit.\n- **BGM:** final_tension\n- **BGS:** first_rain",
    );
    expect(result.source).not.toContain("first_tension");
  });

  it("ignores cues for another file without marking changed", () => {
    const source =
      "# Scene 11\n\n[場景：資料室。]\n- **Background Prompt:** Archive room.\n";
    const result = applyAudioCuesToMarkdown("scene_11.md", source, [
      {
        file: "scene_12.md",
        visualUnit: "tag_001",
        bgm: "archive_tension",
      },
    ]);
    expect(result).toEqual({ source, changed: false, diagnostics: [] });
  });
});
