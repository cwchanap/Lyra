import type {
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
} from "./types";
import type { DialogueSegmentOriginV1 } from "./save-content-manifest";

export type EmittedSceneRecordV1 = {
  chapterId: string;
  json: JSONLinearScene | JSONInvestigationScene | JSONInterrogationScene;
};

export type DerivedDialogueSegment = {
  origin: DialogueSegmentOriginV1;
  items: JSONDialogueItem[];
};

export function investigationInteractionOrigin(
  chapterId: string,
  sceneId: string,
  segmentId: string,
): DialogueSegmentOriginV1 {
  return {
    type: "investigationInteraction",
    chapterId,
    sceneId,
    segmentId,
  };
}

export function interrogationPhaseOrigin(
  chapterId: string,
  sceneId: string,
  phaseId: string,
  segmentId: string,
): DialogueSegmentOriginV1 {
  return {
    type: "interrogationPhase",
    chapterId,
    sceneId,
    phaseId,
    segmentId,
  };
}

export function deriveDialogueSegments(
  scene: EmittedSceneRecordV1,
): DerivedDialogueSegment[] {
  switch (scene.json.type) {
    case "linear":
      return deriveLinearSegments(scene.chapterId, scene.json);
    case "investigation":
      return deriveInvestigationSegments(scene.chapterId, scene.json);
    case "interrogation":
      return deriveInterrogationSegments(scene.chapterId, scene.json);
  }
}

function deriveLinearSegments(
  chapterId: string,
  scene: JSONLinearScene,
): DerivedDialogueSegment[] {
  return nonEmptySegments([
    {
      origin: {
        type: "linearScene",
        chapterId,
        sceneId: scene.id,
      },
      items: scene.queue,
    },
  ]);
}

function deriveInvestigationSegments(
  chapterId: string,
  scene: JSONInvestigationScene,
): DerivedDialogueSegment[] {
  const segments: DerivedDialogueSegment[] = [
    {
      origin: { type: "investigationIntro", chapterId, sceneId: scene.id },
      items: scene.intro,
    },
    {
      origin: { type: "investigationOutro", chapterId, sceneId: scene.id },
      items: scene.outro.dialogue,
    },
  ];

  for (const sublocation of scene.sublocations) {
    segments.push({
      origin: investigationInteractionOrigin(
        chapterId,
        scene.id,
        `sublocation:${sublocation.id}:transition`,
      ),
      items: sublocation.transitionDialogue,
    });
    for (const hotspot of sublocation.hotspots) {
      segments.push(
        {
          origin: investigationInteractionOrigin(
            chapterId,
            scene.id,
            `hotspot:${hotspot.id}:inspect`,
          ),
          items: hotspot.inspectDialogue,
        },
        {
          origin: investigationInteractionOrigin(
            chapterId,
            scene.id,
            `hotspot:${hotspot.id}:reexamine`,
          ),
          items: hotspot.onReexamine ?? [],
        },
      );
    }
    for (const character of sublocation.characters) {
      for (const topic of character.topics) {
        segments.push(
          {
            origin: investigationInteractionOrigin(
              chapterId,
              scene.id,
              `topic:${character.id}:${topic.id}:dialogue`,
            ),
            items: topic.topicDialogue,
          },
          {
            origin: investigationInteractionOrigin(
              chapterId,
              scene.id,
              `topic:${character.id}:${topic.id}:reexamine`,
            ),
            items: topic.onReexamine ?? [],
          },
        );
      }
    }
  }
  for (const evidence of scene.evidenceManifest) {
    segments.push(
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `evidence:${evidence.id}:onCollect`,
        ),
        items: evidence.onCollect,
      },
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `evidence:${evidence.id}:onReexamine`,
        ),
        items: evidence.onReexamine ?? [],
      },
    );
  }
  for (const statement of scene.statementManifest) {
    segments.push(
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `statement:${statement.id}:onAcquire`,
        ),
        items: statement.onAcquire,
      },
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `statement:${statement.id}:onReexamine`,
        ),
        items: statement.onReexamine ?? [],
      },
    );
  }
  return nonEmptySegments(segments);
}

function deriveInterrogationSegments(
  chapterId: string,
  scene: JSONInterrogationScene,
): DerivedDialogueSegment[] {
  const segments: DerivedDialogueSegment[] = [
    {
      origin: { type: "interrogationIntro", chapterId, sceneId: scene.id },
      items: scene.intro,
    },
    {
      origin: { type: "interrogationOutro", chapterId, sceneId: scene.id },
      items: scene.outro.dialogue,
    },
  ];

  for (const phase of scene.phases) {
    segments.push({
      origin: interrogationPhaseOrigin(
        chapterId,
        scene.id,
        phase.id,
        `phase:${phase.id}:entry`,
      ),
      items: phase.entryDialogue,
    });
    for (const question of phase.questions) {
      const testimony = question.testimony;
      for (const [role, items] of [
        ["onLoop", testimony.onLoop],
        ["loopPrompt", testimony.loopPrompt],
        ["defaultChallenge", testimony.defaultChallenge],
        ["defaultWrong", testimony.defaultWrong],
        ["wrongReply", testimony.wrongReply],
      ] as const) {
        segments.push({
          origin: interrogationPhaseOrigin(
            chapterId,
            scene.id,
            phase.id,
            `question:${question.id}:${role}`,
          ),
          items,
        });
      }
      for (const line of testimony.lines) {
        for (const [role, items] of [
          ["content", line.content],
          ["challenge", line.challenge],
          ["onCorrect", line.onCorrect],
          ["onWrongEvidence", line.onWrongEvidence],
        ] as const) {
          segments.push({
            origin: interrogationPhaseOrigin(
              chapterId,
              scene.id,
              phase.id,
              `question:${question.id}:line:${line.id}:${role}`,
            ),
            items,
          });
        }
      }
    }
  }
  for (const evidence of scene.evidenceManifest) {
    const phaseId = "inventory";
    segments.push(
      {
        origin: interrogationPhaseOrigin(
          chapterId,
          scene.id,
          phaseId,
          `evidence:${evidence.id}:onCollect`,
        ),
        items: evidence.onCollect,
      },
      {
        origin: interrogationPhaseOrigin(
          chapterId,
          scene.id,
          phaseId,
          `evidence:${evidence.id}:onReexamine`,
        ),
        items: evidence.onReexamine ?? [],
      },
    );
  }
  for (const statement of scene.statementManifest) {
    const phaseId = "inventory";
    segments.push(
      {
        origin: interrogationPhaseOrigin(
          chapterId,
          scene.id,
          phaseId,
          `statement:${statement.id}:onAcquire`,
        ),
        items: statement.onAcquire,
      },
      {
        origin: interrogationPhaseOrigin(
          chapterId,
          scene.id,
          phaseId,
          `statement:${statement.id}:onReexamine`,
        ),
        items: statement.onReexamine ?? [],
      },
    );
  }
  return nonEmptySegments(segments);
}

function nonEmptySegments(
  segments: DerivedDialogueSegment[],
): DerivedDialogueSegment[] {
  return segments.filter(({ items }) => items.length > 0);
}
