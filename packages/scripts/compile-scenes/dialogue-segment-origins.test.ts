import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emitInterrogationScene, emitInvestigationScene } from "./emitter";
import { deriveDialogueSegments } from "./dialogue-segment-origins";
import { parseInterrogationScene } from "./parser-interrogation";
import { parseInvestigationScene } from "./parser-investigation";

function investigation() {
  const path =
    "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md";
  const parsed = parseInvestigationScene(
    readFileSync(resolve(path), "utf8"),
    path,
    "investigation_scene_1",
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return emitInvestigationScene(parsed.value);
}

function interrogation() {
  const path =
    "packages/scripts/__fixtures__/valid_interrogation/chapter_1/interrogation_scene_1.md";
  const parsed = parseInterrogationScene(
    readFileSync(resolve(path), "utf8"),
    path,
    "interrogation_scene_1",
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return emitInterrogationScene(parsed.value);
}

describe("deriveDialogueSegments", () => {
  it("derives stable semantic origins without vector indices or copy", () => {
    const origins = deriveDialogueSegments({
      chapterId: "chapter_1",
      file: "interrogation_scene_1.md",
      json: interrogation(),
    }).map(({ origin }) => origin);

    expect(origins).toContainEqual({
      type: "interrogationPhase",
      chapterId: "chapter_1",
      sceneId: "interrogation_scene_1",
      phaseId: "wakatsuki_inquiry",
      segmentId: "question:entered_storage:line:l_cleaning:onCorrect",
    });
    expect(JSON.stringify(origins)).not.toContain("Original copy");
  });

  it("omits empty emitted dialogue blocks", () => {
    const scene = investigation();
    scene.intro = [];
    scene.outro.dialogue = [];
    scene.sublocations[0]!.transitionDialogue = [];

    expect(
      deriveDialogueSegments({
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        json: scene,
      }).map(({ origin }) => origin),
    ).not.toContainEqual({
      type: "investigationIntro",
      chapterId: "chapter_1",
      sceneId: "investigation_scene_1",
    });
  });
});
