import { describe, expect, it } from "vitest";
import { indexVisualUnitsFromMarkdown } from "./visual-units";

describe("visual unit indexing", () => {
  it("indexes linear scene tags as tag_001 and tag_002", () => {
    const units = indexVisualUnitsFromMarkdown(
      "scene_6.md",
      "# Scene 6\n\n[場景：街道，雨。]\n- **Background Prompt:** Rain.\n\n**相馬律**：走吧。\n\n[場景：便利店門口，雨。]\n- **Background Prompt:** Store.\n",
    );
    expect(units.map((unit) => unit.id)).toEqual(["tag_001", "tag_002"]);
    expect(units[0]).toMatchObject({ file: "scene_6.md", line: 3 });
  });

  it("indexes investigation sub-location ids", () => {
    const units = indexVisualUnitsFromMarkdown(
      "investigation_scene_3.md",
      "# Scene 3\n\n## Intro\n\n[場景：雨鐘外。]\n- **Background Prompt:** Exterior.\n\n## Sub-location: 雨鐘前場 {#front}\n- **Status:** unlocked\n- **Background Prompt:** Front room.\n\n[場景：前場。]\n",
    );
    expect(units.map((unit) => unit.id)).toEqual(["tag_001", "front"]);
    expect(units[1]).toMatchObject({ line: 8, metadataInsertLine: 10 });
  });

  it("indexes interrogation phase ids", () => {
    const units = indexVisualUnitsFromMarkdown(
      "interrogation_scene_4.md",
      "# Scene 4\n\n## Intro\n\n[場景：等待區。]\n- **Background Prompt:** Waiting.\n\n## Phase: 問題確認 {#ask_miyake}\n- **Kind:** inquiry\n- **Required:** true\n- **Background Prompt:** Room.\n",
    );
    expect(units.map((unit) => unit.id)).toEqual(["tag_001", "ask_miyake"]);
  });

  it("captures existing BGM and BGS metadata", () => {
    const units = indexVisualUnitsFromMarkdown(
      "scene_1.md",
      "# Scene 1\n\n[場景：路地。]\n- **Background Prompt:** Alley.\n- **BGM:** rain_mystery_low\n- **BGS:** street_rain\n",
    );
    expect(units[0]).toMatchObject({
      existingBgm: "rain_mystery_low",
      existingBgs: "street_rain",
      metadataInsertLine: 7,
    });
  });

  it("indexes blank-line attached metadata after scene tags", () => {
    const units = indexVisualUnitsFromMarkdown(
      "scene_2.md",
      "# Scene 2\n\n[場景：橋下，雨。]\n\n- **Background Prompt:** Bridge.\n\n- **BGM:** rain_mystery_low\n\n- **BGS:** river_rain\n\n**相馬律**：聽見了嗎？\n",
    );
    expect(units[0]).toMatchObject({
      existingBgm: "rain_mystery_low",
      existingBgs: "river_rain",
      metadataInsertLine: 10,
    });
  });

  it("indexes multi-line scene tags after the closing bracket", () => {
    const units = indexVisualUnitsFromMarkdown(
      "scene_3.md",
      "# Scene 3\n\n[場景：\n地下通道，雨聲從出口灌入。\n]\n\n- **Background Prompt:** Underpass.\n- **BGM:** tunnel_low\n\n**相馬律**：慢一點。\n",
    );
    expect(units[0]).toMatchObject({
      line: 3,
      metadataInsertLine: 9,
      existingBgm: "tunnel_low",
    });
  });

  it("indexes blank-line attached metadata after sub-location headings", () => {
    const units = indexVisualUnitsFromMarkdown(
      "investigation_scene_5.md",
      "# Scene 5\n\n## Sub-location: 雨鐘前場 {#front}\n\n- **Status:** unlocked\n\n- **Background Prompt:** Front room.\n\n- **BGS:** indoor_rain_window\n\n[場景：前場。]\n",
    );
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      id: "front",
      existingBgs: "indoor_rain_window",
      metadataInsertLine: 7,
    });
  });

  it("indexes blank-line attached metadata after phase headings", () => {
    const units = indexVisualUnitsFromMarkdown(
      "interrogation_scene_6.md",
      "# Scene 6\n\n## Phase: 問題確認 {#ask_miyake}\n\n- **Kind:** inquiry\n\n- **Required:** true\n\n- **BGM:** pressure_room\n\n[場景：取調室。]\n",
    );
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      id: "ask_miyake",
      existingBgm: "pressure_room",
      metadataInsertLine: 9,
    });
  });

  it("inserts after structural metadata when interactive headings have no visual metadata", () => {
    const units = indexVisualUnitsFromMarkdown(
      "investigation_scene_7.md",
      "# Scene 7\n\n## Sub-location: 後門 {#backdoor}\n\n- **Status:** locked\n\n- **Unlock:** evidence:keycard\n\n[場景：後門。]\n",
    );
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      id: "backdoor",
      metadataInsertLine: 8,
    });
  });

  it("does not capture empty BGM or BGS metadata values", () => {
    const units = indexVisualUnitsFromMarkdown(
      "scene_7.md",
      "# Scene 7\n\n[場景：無音室。]\n- **BGM:** \n- **BGS:** valid_rain\n\n",
    );
    expect(units[0]).toMatchObject({
      metadataInsertLine: 4,
    });
    expect(units[0]?.existingBgm).toBeUndefined();
    expect(units[0]?.existingBgs).toBeUndefined();
  });

  it("inserts after a single-line scene tag with no metadata", () => {
    const units = indexVisualUnitsFromMarkdown(
      "scene_8.md",
      "# Scene 8\n\n[場景：空房間。]\n\n**相馬律**：沒有人。\n",
    );
    expect(units[0]).toMatchObject({
      line: 3,
      metadataInsertLine: 4,
    });
  });

  it("inserts after a multi-line scene tag with no metadata", () => {
    const units = indexVisualUnitsFromMarkdown(
      "scene_9.md",
      "# Scene 9\n\n[場景：\n屋頂。\n]\n\n**相馬律**：風很大。\n",
    );
    expect(units[0]).toMatchObject({
      line: 3,
      metadataInsertLine: 6,
    });
  });
});
