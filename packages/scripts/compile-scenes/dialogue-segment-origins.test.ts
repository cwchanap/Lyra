import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emitInterrogationScene, emitInvestigationScene } from "./emitter";
import { deriveDialogueSegments } from "./dialogue-segment-origins";
import { parseInterrogationScene } from "./parser-interrogation";
import { parseInvestigationScene } from "./parser-investigation";

function investigationAst() {
  const path =
    "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md";
  const parsed = parseInvestigationScene(
    readFileSync(resolve(path), "utf8"),
    path,
    "investigation_scene_1",
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function investigation() {
  return emitInvestigationScene(investigationAst());
}

function interrogationAst() {
  const path =
    "packages/scripts/__fixtures__/valid_interrogation/chapter_1/interrogation_scene_1.md";
  const parsed = parseInterrogationScene(
    readFileSync(resolve(path), "utf8"),
    path,
    "interrogation_scene_1",
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function interrogation() {
  return emitInterrogationScene(interrogationAst());
}

function interrogationWithEveryCarrier() {
  const ast = interrogationAst();
  ast.phases[0]!.entryDialogue = [
    { kind: "action", text: "Exhaustive phase entry." },
  ];
  ast.phases[0]!.questions[0]!.testimony.defaultChallenge = [
    { kind: "action", text: "Exhaustive default challenge." },
  ];
  ast.phases[0]!.questions[0]!.testimony.defaultWrong = [
    { kind: "action", text: "Exhaustive default wrong." },
  ];
  ast.evidenceManifest[0]!.onReexamine = [
    { kind: "action", text: "Exhaustive evidence re-examination." },
  ];
  ast.statementManifest[0]!.onReexamine = [
    { kind: "action", text: "Exhaustive statement re-examination." },
  ];
  return emitInterrogationScene(ast);
}

describe("deriveDialogueSegments", () => {
  it("enumerates every current emitted dialogue carrier with a stable semantic origin", () => {
    expect(
      deriveDialogueSegments({
        chapterId: "chapter_1",
        json: {
          type: "linear",
          id: "scene_0",
          title: "Opening",
          queue: [{ kind: "action", text: "Linear carrier." }],
          assetRefs: [],
        },
      }).map(({ origin }) => origin),
    ).toEqual([
      {
        type: "linearScene",
        chapterId: "chapter_1",
        sceneId: "scene_0",
      },
    ]);

    expect(
      deriveDialogueSegments({
        chapterId: "chapter_1",
        json: investigation(),
      }).map(({ origin }) => origin),
    ).toEqual([
      {
        type: "investigationIntro",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
      },
      {
        type: "investigationOutro",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "sublocation:main_hall:transition",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "hotspot:table:inspect",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "hotspot:table:reexamine",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "hotspot:window:inspect",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "topic:witness:timeline:dialogue",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "topic:witness:timeline:reexamine",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "topic:witness:motive:dialogue",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "sublocation:back_room:transition",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "hotspot:cabinet:inspect",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "evidence:coffee:onCollect",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "evidence:coffee:onReexamine",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "evidence:locked_box:onCollect",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "statement:witness_alibi:onAcquire",
      },
      {
        type: "investigationInteraction",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        segmentId: "statement:witness_alibi:onReexamine",
      },
    ]);

    expect(
      deriveDialogueSegments({
        chapterId: "chapter_1",
        json: interrogationWithEveryCarrier(),
      }).map(({ origin }) => origin),
    ).toEqual([
      {
        type: "interrogationIntro",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
      },
      {
        type: "interrogationOutro",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "phase:wakatsuki_inquiry:entry",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:entered_storage:onLoop",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:entered_storage:loopPrompt",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:entered_storage:defaultChallenge",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:entered_storage:defaultWrong",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:entered_storage:wrongReply",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:entered_storage:line:l_beans:content",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:entered_storage:line:l_cleaning:content",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:entered_storage:line:l_cleaning:challenge",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:entered_storage:line:l_cleaning:onCorrect",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:entered_storage:line:l_cleaning:onWrongEvidence",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:beans_follow_up:onLoop",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "wakatsuki_inquiry",
        segmentId: "question:beans_follow_up:line:l_follow:content",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "inventory",
        segmentId: "evidence:coffee_machine_cleaning_log:onCollect",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "inventory",
        segmentId: "evidence:coffee_machine_cleaning_log:onReexamine",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "inventory",
        segmentId: "statement:wakatsuki_entered_for_beans:onAcquire",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "inventory",
        segmentId: "statement:wakatsuki_entered_for_beans:onReexamine",
      },
      {
        type: "interrogationPhase",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_1",
        phaseId: "inventory",
        segmentId: "statement:kagami_timeline_inconsistent:onAcquire",
      },
    ]);
  });

  it("keeps existing origins stable when semantic siblings are inserted or reordered", () => {
    const baseline = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: investigation(),
    }).map(({ origin }) => origin);
    const edited = investigation();
    const inserted = structuredClone(edited.sublocations[0]!.hotspots[0]!);
    inserted.id = "shelf";
    inserted.inspectDialogue = [
      { kind: "action", text: "Inspect the inserted shelf." },
    ];
    edited.sublocations[0]!.hotspots.unshift(inserted);
    edited.sublocations.reverse();

    const after = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: edited,
    }).map(({ origin }) => origin);

    expect(after).toEqual(expect.arrayContaining(baseline));
  });

  it("uses the inventory phase id for both authored inventory phases and synthetic carriers", () => {
    const ast = interrogationAst();
    ast.phases[0]!.id = "inventory";
    ast.phases[0]!.entryDialogue = [
      { kind: "action", text: "Authored inventory phase entry." },
    ];
    const origins = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: emitInterrogationScene(ast),
    }).map(({ origin }) => origin);

    expect(origins).toContainEqual({
      type: "interrogationPhase",
      chapterId: "chapter_1",
      sceneId: "interrogation_scene_1",
      phaseId: "inventory",
      segmentId: "phase:inventory:entry",
    });
    expect(origins).toContainEqual({
      type: "interrogationPhase",
      chapterId: "chapter_1",
      sceneId: "interrogation_scene_1",
      phaseId: "inventory",
      segmentId: "question:entered_storage:onLoop",
    });
    expect(origins).toContainEqual({
      type: "interrogationPhase",
      chapterId: "chapter_1",
      sceneId: "interrogation_scene_1",
      phaseId: "inventory",
      segmentId: "evidence:coffee_machine_cleaning_log:onCollect",
    });
  });

  it("derives stable semantic origins without vector indices or copy", () => {
    const origins = deriveDialogueSegments({
      chapterId: "chapter_1",
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

  it("uses only the semantic segment id for investigation interactions", () => {
    const origins = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: investigation(),
    }).map(({ origin }) => origin);

    const interaction = origins.find(
      (origin) => origin.type === "investigationInteraction",
    );
    expect(interaction).toBeDefined();
    expect(interaction).not.toHaveProperty("interactionId");
  });

  it("omits empty emitted dialogue blocks", () => {
    const scene = investigation();
    scene.intro = [];
    scene.outro.dialogue = [];
    scene.sublocations[0]!.transitionDialogue = [];

    expect(
      deriveDialogueSegments({
        chapterId: "chapter_1",
        json: scene,
      }).map(({ origin }) => origin),
    ).not.toContainEqual({
      type: "investigationIntro",
      chapterId: "chapter_1",
      sceneId: "investigation_scene_1",
    });
  });
});
