import { describe, expect, it } from "vitest";
import appSource from "./App.svelte?raw";

describe("layout editor app shell", () => {
  it("groups investigation scenes by collapsible chapter sections", () => {
    expect(appSource).toContain("<details");
    expect(appSource).toContain("<summary");
    expect(appSource).toContain("readableChapterLabel");
  });

  it("uses readable scene descriptions instead of generated json paths", () => {
    expect(appSource).toContain("readableSceneLabel");
    expect(appSource).not.toContain("<dd>{editorState.layoutPath}</dd>");
    expect(appSource).not.toContain("<strong>{scene.file}</strong>");
  });

  it("nests sublocations under the selected scene entry", () => {
    expect(appSource).toContain(
      "scene.path === editorState.scenePath && editorState.scene",
    );
    expect(appSource).toContain('class="scene-sublocations"');
    expect(appSource).not.toContain(
      "{#if editorState.scene}\n      <TargetList",
    );
  });

  it("mounts evidence hotspot assignment controls in the scene detail view", () => {
    expect(appSource).toContain("EvidenceAssignmentPanel");
    expect(appSource).toContain("assignEvidenceToHotspot");
  });
});
