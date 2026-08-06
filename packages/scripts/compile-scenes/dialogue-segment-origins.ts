import type {
  ASTAnalysisScene,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  CompileError,
  JSONAnalysisScene,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
} from "./types";
import type { DialogueSegmentOriginV1 } from "./save-content-manifest";

/**
 * Synthetic phaseId used to namespace dialogue segments that belong to the
 * evidence/statement manifest (onCollect, onReexamine, onAcquire) rather than
 * to any writer-authored interrogation phase. Reserved by the validator —
 * writers must not declare a phase with this id.
 */
export const INVENTORY_PHASE_ID = "inventory";

export type EmittedSceneRecordV1 = {
  chapterId: string;
  json:
    | JSONLinearScene
    | JSONInvestigationScene
    | JSONInterrogationScene
    | JSONAnalysisScene;
  sourceAst?:
    | ASTLinearScene
    | ASTInvestigationScene
    | ASTInterrogationScene
    | ASTAnalysisScene;
};

export type DerivedDialogueSegment = {
  origin: DialogueSegmentOriginV1;
  items: JSONDialogueItem[];
  source?: {
    sourceFile: string;
    line: number;
  };
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
      return deriveLinearSegments(
        scene.chapterId,
        scene.json,
        scene.sourceAst?.kind === "linearScene" ? scene.sourceAst : undefined,
      );
    case "investigation":
      return deriveInvestigationSegments(
        scene.chapterId,
        scene.json,
        scene.sourceAst?.kind === "investigationScene"
          ? scene.sourceAst
          : undefined,
      );
    case "interrogation":
      return deriveInterrogationSegments(
        scene.chapterId,
        scene.json,
        scene.sourceAst?.kind === "interrogationScene"
          ? scene.sourceAst
          : undefined,
      );
    case "analysis":
      return deriveAnalysisSegments(
        scene.chapterId,
        scene.json,
        scene.sourceAst?.kind === "analysisScene" ? scene.sourceAst : undefined,
      );
  }
}

function deriveAnalysisSegments(
  chapterId: string,
  scene: JSONAnalysisScene,
  sourceAst?: ASTAnalysisScene,
): DerivedDialogueSegment[] {
  const authoredBoardsById = sourceAst
    ? new Map(sourceAst.boards.map((board) => [board.id, board] as const))
    : null;
  const segments: DerivedDialogueSegment[] = [
    {
      origin: { type: "analysisIntro", chapterId, sceneId: scene.id },
      items: scene.intro,
      ...sourceFields(sourceAst),
    },
    ...scene.boards.map((board) => ({
      origin: {
        type: "analysisResult" as const,
        chapterId,
        sceneId: scene.id,
        boardId: board.common.id,
      },
      items: board.common.resultDialogue,
      ...sourceFields(authoredBoardsById?.get(board.common.id)),
    })),
    {
      origin: { type: "analysisOutro", chapterId, sceneId: scene.id },
      items: scene.outro,
      ...sourceFields(sourceAst),
    },
  ];
  return nonEmptySegments(segments);
}

function deriveLinearSegments(
  chapterId: string,
  scene: JSONLinearScene,
  sourceAst?: ASTLinearScene,
): DerivedDialogueSegment[] {
  return nonEmptySegments([
    {
      origin: {
        type: "linearScene",
        chapterId,
        sceneId: scene.id,
      },
      items: scene.queue,
      ...sourceFields(sourceAst),
    },
  ]);
}

function deriveInvestigationSegments(
  chapterId: string,
  scene: JSONInvestigationScene,
  sourceAst?: ASTInvestigationScene,
): DerivedDialogueSegment[] {
  const segments: DerivedDialogueSegment[] = [
    {
      origin: { type: "investigationIntro", chapterId, sceneId: scene.id },
      items: scene.intro,
      ...sourceFields(sourceAst),
    },
    {
      origin: { type: "investigationOutro", chapterId, sceneId: scene.id },
      items: scene.outro.dialogue,
      ...sourceFields(sourceAst),
    },
  ];

  for (const [sublocationIndex, sublocation] of scene.sublocations.entries()) {
    const sourceSublocation = sourceAst?.sublocations[sublocationIndex];
    segments.push({
      origin: investigationInteractionOrigin(
        chapterId,
        scene.id,
        `sublocation:${sublocation.id}:transition`,
      ),
      items: sublocation.transitionDialogue,
      ...sourceFields(sourceSublocation),
    });
    for (const [hotspotIndex, hotspot] of sublocation.hotspots.entries()) {
      const sourceHotspot = sourceSublocation?.hotspots[hotspotIndex];
      segments.push(
        {
          origin: investigationInteractionOrigin(
            chapterId,
            scene.id,
            `hotspot:${hotspot.id}:inspect`,
          ),
          items: hotspot.inspectDialogue,
          ...sourceFields(sourceHotspot),
        },
        {
          origin: investigationInteractionOrigin(
            chapterId,
            scene.id,
            `hotspot:${hotspot.id}:reexamine`,
          ),
          items: hotspot.onReexamine ?? [],
          ...sourceFields(sourceHotspot),
        },
      );
    }
    for (const [
      characterIndex,
      character,
    ] of sublocation.characters.entries()) {
      const sourceCharacter = sourceSublocation?.characters[characterIndex];
      for (const [topicIndex, topic] of character.topics.entries()) {
        const sourceTopic = sourceCharacter?.topics[topicIndex];
        segments.push(
          {
            origin: investigationInteractionOrigin(
              chapterId,
              scene.id,
              `topic:${character.id}:${topic.id}:dialogue`,
            ),
            items: topic.topicDialogue,
            ...sourceFields(sourceTopic),
          },
          {
            origin: investigationInteractionOrigin(
              chapterId,
              scene.id,
              `topic:${character.id}:${topic.id}:reexamine`,
            ),
            items: topic.onReexamine ?? [],
            ...sourceFields(sourceTopic),
          },
        );
      }
    }
  }
  for (const [evidenceIndex, evidence] of scene.evidenceManifest.entries()) {
    const sourceEvidence = sourceAst?.evidenceManifest[evidenceIndex];
    segments.push(
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `evidence:${evidence.id}:onCollect`,
        ),
        items: evidence.onCollect,
        ...sourceFields(sourceEvidence),
      },
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `evidence:${evidence.id}:onReexamine`,
        ),
        items: evidence.onReexamine ?? [],
        ...sourceFields(sourceEvidence),
      },
    );
  }
  for (const [statementIndex, statement] of scene.statementManifest.entries()) {
    const sourceStatement = sourceAst?.statementManifest[statementIndex];
    segments.push(
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `statement:${statement.id}:onAcquire`,
        ),
        items: statement.onAcquire,
        ...sourceFields(sourceStatement),
      },
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `statement:${statement.id}:onReexamine`,
        ),
        items: statement.onReexamine ?? [],
        ...sourceFields(sourceStatement),
      },
    );
  }
  return nonEmptySegments(segments);
}

function deriveInterrogationSegments(
  chapterId: string,
  scene: JSONInterrogationScene,
  sourceAst?: ASTInterrogationScene,
): DerivedDialogueSegment[] {
  const segments: DerivedDialogueSegment[] = [
    {
      origin: { type: "interrogationIntro", chapterId, sceneId: scene.id },
      items: scene.intro,
      ...sourceFields(sourceAst),
    },
    {
      origin: { type: "interrogationOutro", chapterId, sceneId: scene.id },
      items: scene.outro.dialogue,
      ...sourceFields(sourceAst),
    },
  ];

  for (const [phaseIndex, phase] of scene.phases.entries()) {
    const sourcePhase = sourceAst?.phases[phaseIndex];
    segments.push({
      origin: interrogationPhaseOrigin(
        chapterId,
        scene.id,
        phase.id,
        `phase:${phase.id}:entry`,
      ),
      items: phase.entryDialogue,
      ...sourceFields(sourcePhase),
    });
    for (const [questionIndex, question] of phase.questions.entries()) {
      const sourceQuestion = sourcePhase?.questions[questionIndex];
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
          ...sourceFields(sourceQuestion?.testimony),
        });
      }
      for (const [lineIndex, line] of testimony.lines.entries()) {
        const sourceLine = sourceQuestion?.testimony.lines[lineIndex];
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
            ...sourceFields(sourceLine),
          });
        }
      }
    }
  }
  for (const [evidenceIndex, evidence] of scene.evidenceManifest.entries()) {
    const sourceEvidence = sourceAst?.evidenceManifest[evidenceIndex];
    const phaseId = INVENTORY_PHASE_ID;
    segments.push(
      {
        origin: interrogationPhaseOrigin(
          chapterId,
          scene.id,
          phaseId,
          `evidence:${evidence.id}:onCollect`,
        ),
        items: evidence.onCollect,
        ...sourceFields(sourceEvidence),
      },
      {
        origin: interrogationPhaseOrigin(
          chapterId,
          scene.id,
          phaseId,
          `evidence:${evidence.id}:onReexamine`,
        ),
        items: evidence.onReexamine ?? [],
        ...sourceFields(sourceEvidence),
      },
    );
  }
  for (const [statementIndex, statement] of scene.statementManifest.entries()) {
    const sourceStatement = sourceAst?.statementManifest[statementIndex];
    const phaseId = INVENTORY_PHASE_ID;
    segments.push(
      {
        origin: interrogationPhaseOrigin(
          chapterId,
          scene.id,
          phaseId,
          `statement:${statement.id}:onAcquire`,
        ),
        items: statement.onAcquire,
        ...sourceFields(sourceStatement),
      },
      {
        origin: interrogationPhaseOrigin(
          chapterId,
          scene.id,
          phaseId,
          `statement:${statement.id}:onReexamine`,
        ),
        items: statement.onReexamine ?? [],
        ...sourceFields(sourceStatement),
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

function sourceFields(
  source: { sourceFile: string; line: number } | undefined,
): Pick<DerivedDialogueSegment, "source"> | Record<string, never> {
  return source
    ? { source: { sourceFile: source.sourceFile, line: source.line } }
    : {};
}

export function validateDerivedDialogueOriginCollisions(
  scenes: EmittedSceneRecordV1[],
): CompileError[] {
  const firstByOrigin = new Map<string, DerivedDialogueSegment>();
  const errors: CompileError[] = [];

  for (const scene of scenes) {
    for (const segment of deriveDialogueSegments(scene)) {
      if (!segment.source) continue;
      const originKey = JSON.stringify(segment.origin);
      const first = firstByOrigin.get(originKey);
      if (!first) {
        firstByOrigin.set(originKey, segment);
        continue;
      }
      if (!first.source) continue;

      errors.push({
        code: "derivedDialogueOriginCollision",
        message:
          `Internal contract error: derived dialogue origin ${originKey} collides between ` +
          `${first.source.sourceFile}:${first.source.line} and ` +
          `${segment.source.sourceFile}:${segment.source.line}.`,
        sourceFile: segment.source.sourceFile,
        line: segment.source.line,
      });
    }
  }

  return errors;
}
