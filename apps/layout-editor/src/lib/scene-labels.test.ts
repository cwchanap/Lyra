import { describe, expect, it } from "vitest";
import { readableChapterLabel, readableSceneLabel } from "./scene-labels";

describe("scene labels", () => {
  it("formats generated scene filenames for humans", () => {
    expect(readableSceneLabel("chapter_1/investigation_scene_3.json")).toBe(
      "Investigation Scene 3",
    );
    expect(readableSceneLabel("chapter_1/scene_8_5.json")).toBe("Scene 8.5");
    expect(readableSceneLabel("chapter_1/interrogation_scene_2.json")).toBe(
      "Interrogation Scene 2",
    );
  });

  it("does not match prefixes without the required underscore", () => {
    expect(readableSceneLabel("investigationscene_1.json")).toBe(
      "Investigationscene 1",
    );
  });

  it("formats chapter ids when a title is unavailable", () => {
    expect(readableChapterLabel("chapter_2", "")).toBe("Chapter 2");
    expect(readableChapterLabel("chapter_2", "Rain Witness")).toBe(
      "Rain Witness",
    );
  });
});
