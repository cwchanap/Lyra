// =============================================================================
// packages/scripts/compile-scenes/parser-prompt-lines.test.ts
//
// HPA-135 Task 1.4: visual/evidence cue parsers retain the authored physical
// line of Background Prompt / Image Prompt metadata as compiler-only
// `backgroundPromptLine` / `imagePromptLine`.
// =============================================================================

import { describe, expect, it } from "vitest";
import { parseInterrogationScene } from "./parser-interrogation";
import { parseInvestigationScene } from "./parser-investigation";
import { parseLinearScene } from "./parser-linear";

function lineOf(source: string, needle: string): number {
  const index = source.split("\n").findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`needle not found in source: ${needle}`);
  return index + 1;
}

describe("Background Prompt source line capture", () => {
  it("captures the linear scene-tag prompt metadata line", () => {
    const source = [
      "# Scene 0: 接案",
      "",
      "[場景：咖啡館外，雨夜。]",
      "- **Background Prompt:** Rainy exterior of a small Tokyo cafe.",
      "- **BGM:** none",
      "- **BGS:** none",
      "",
      "**早坂茜**：你來了。",
    ].join("\n");
    const parsed = parseLinearScene(source, "scene_0.md", "scene_0");
    if (!parsed.ok) throw new Error(parsed.error.message);
    const first = parsed.value.queue[0];
    if (first?.kind !== "sceneTag") throw new Error("expected sceneTag");
    const cue = first.assetCue;
    expect(cue?.backgroundPrompt).toBe("Rainy exterior of a small Tokyo cafe.");
    expect(cue?.backgroundPromptLine).toBe(
      lineOf(source, "- **Background Prompt:**"),
    );
  });

  it("captures the investigation sublocation prompt metadata line", () => {
    const source = [
      "# Scene 1: 測試調查",
      "",
      "## Sub-location: 前廳 {#front_hall}",
      "",
      "- **Status:** unlocked",
      "- **Background Prompt:** Rainy office front hall.",
      "",
      "[場景：前廳。]",
      "",
      "**相馬律**：開始。",
      "",
      "## Outro",
      "",
      "**相馬律**：結束。",
    ].join("\n");
    const parsed = parseInvestigationScene(
      source,
      "investigation_scene_1.md",
      "investigation_scene_1",
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    const cue = parsed.value.sublocations[0]?.assetCue;
    expect(cue?.backgroundPrompt).toBe("Rainy office front hall.");
    expect(cue?.backgroundPromptLine).toBe(
      lineOf(source, "- **Background Prompt:**"),
    );
  });

  it("captures the interrogation phase prompt metadata line", () => {
    const source = [
      "# Scene 1: 測試詢問",
      "",
      "## Phase: 初步 {#phase_a}",
      "",
      "- **Kind:** inquiry",
      "- **Background Prompt:** Dark interrogation room.",
      "",
      "[場景：詢問室。]",
      "",
      "### Subject: 若槻蓮 {#wakatsuki_ren}",
      "",
      "- **Role:** 嫌疑人",
      "- **Bio:** 店員。",
      "",
      "### Question: 動線 {#route}",
      "",
      "- **Status:** unlocked",
      "",
      "#### Testimony",
      "",
      "- **On Loop:** **相馬律**：再說一次。",
      "",
      "##### Line: 說詞 {#l_claim}",
      "",
      "**若槻蓮**：我一直在店裡。",
      "",
      "## Outro",
      "",
      "**相馬律**：結束。",
    ].join("\n");
    const parsed = parseInterrogationScene(
      source,
      "interrogation_scene_1.md",
      "interrogation_scene_1",
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    const cue = parsed.value.phases[0]?.assetCue;
    expect(cue?.backgroundPrompt).toBe("Dark interrogation room.");
    expect(cue?.backgroundPromptLine).toBe(
      lineOf(source, "- **Background Prompt:**"),
    );
  });
});

describe("Image Prompt source line capture", () => {
  it("captures the evidence manifest prompt metadata line", () => {
    const source = [
      "# Scene 1: 測試調查",
      "",
      "## Sub-location: 前廳 {#front_hall}",
      "",
      "- **Status:** unlocked",
      "",
      "[場景：前廳。]",
      "",
      "**相馬律**：開始。",
      "",
      "## Evidence Manifest",
      "",
      "### evidence:receipt {#receipt}",
      "",
      "- **Name:** 收據",
      "- **Description:** 一張收據。",
      "- **Details:** 時間是 23:10。",
      "- **Image Prompt:** A cafe receipt on transparent background.",
      "",
      "#### On Collect",
      "",
      "**相馬律**：拿到收據。",
      "",
      "## Outro",
      "",
      "**相馬律**：結束。",
    ].join("\n");
    const parsed = parseInvestigationScene(
      source,
      "investigation_scene_1.md",
      "investigation_scene_1",
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    const cue = parsed.value.evidenceManifest[0]?.imageCue;
    expect(cue?.imagePrompt).toBe("A cafe receipt on transparent background.");
    expect(cue?.imagePromptLine).toBe(lineOf(source, "- **Image Prompt:**"));
  });
});
