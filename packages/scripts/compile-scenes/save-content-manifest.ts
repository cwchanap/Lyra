import { canonicalJson, sha256CanonicalJson } from "./canonical-json";
import { deriveDialogueSegments } from "./dialogue-segment-origins";
import type {
  JSONChaptersIndex,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
  StoryCatalogJson,
} from "./types";

export type SceneKindV1 = "linear" | "investigation" | "interrogation";
export type RecordKindV1 = "evidence" | "statement";

export type DialogueSegmentOriginV1 =
  | { type: "linearScene"; chapterId: string; sceneId: string }
  | {
      type: "investigationIntro" | "investigationOutro";
      chapterId: string;
      sceneId: string;
    }
  | {
      type: "investigationInteraction";
      chapterId: string;
      sceneId: string;
      interactionId: string;
      segmentId: string;
    }
  | {
      type: "interrogationIntro" | "interrogationOutro";
      chapterId: string;
      sceneId: string;
    }
  | {
      type: "interrogationPhase";
      chapterId: string;
      sceneId: string;
      phaseId: string;
      segmentId: string;
    };

export type DefinitionRefV1 =
  | {
      type: "scene";
      chapterId: string;
      sceneId: string;
      sceneKind: SceneKindV1;
    }
  | { type: "dialogueSegment"; origin: DialogueSegmentOriginV1 }
  | { type: "inventoryRecord"; recordKind: RecordKindV1; recordId: string }
  | { type: "fact" | "question" | "objective" | "authorization"; id: string };

export type DefinitionManifestEntryV1 = {
  reference: DefinitionRefV1;
  structuralHash: `sha256:${string}`;
  contentHash: `sha256:${string}`;
};

export type SaveContentManifestV1 = {
  manifestVersion: 1;
  contentRevision: `sha256:${string}`;
  definitions: DefinitionManifestEntryV1[];
};

export type EmittedSceneJsonV1 =
  | JSONLinearScene
  | JSONInvestigationScene
  | JSONInterrogationScene;

export type EmittedSceneRecordV1<
  T extends EmittedSceneJsonV1 = EmittedSceneJsonV1,
> = { chapterId: string; file: string; json: T };

export type BuildSaveContentManifestInput = {
  chapters: JSONChaptersIndex;
  scenes: EmittedSceneRecordV1[];
  storyCatalog: StoryCatalogJson;
};

export function definitionRefKey(reference: DefinitionRefV1): string {
  return canonicalJson(reference);
}

export function buildSaveContentManifest(
  input: BuildSaveContentManifestInput,
): SaveContentManifestV1 {
  const definitions: DefinitionManifestEntryV1[] = [];
  for (const scene of input.scenes) {
    const reference: DefinitionRefV1 = {
      type: "scene",
      chapterId: scene.chapterId,
      sceneId: scene.json.id,
      sceneKind: scene.json.type,
    };
    definitions.push(
      entry(reference, sceneStructural(scene), sceneContent(scene, reference)),
    );
    for (const segment of deriveDialogueSegments(scene)) {
      const segmentReference: DefinitionRefV1 = {
        type: "dialogueSegment",
        origin: segment.origin,
      };
      definitions.push(
        entry(
          segmentReference,
          {
            reference: segmentReference,
            items: segment.items.map(dialogueItemStructural),
          },
          {
            reference: segmentReference,
            items: segment.items.map(dialogueItemContent),
          },
        ),
      );
    }
    if (scene.json.type !== "linear") {
      definitions.push(...inventoryEntries(scene.json));
    }
  }
  for (const fact of input.storyCatalog.facts) {
    const reference: DefinitionRefV1 = { type: "fact", id: fact.id };
    definitions.push(
      entry(
        reference,
        { reference, category: fact.category },
        {
          reference,
          label: fact.label,
          summary: fact.summary,
          details: fact.details,
        },
      ),
    );
  }
  for (const question of input.storyCatalog.questions) {
    const reference: DefinitionRefV1 = { type: "question", id: question.id };
    definitions.push(
      entry(
        reference,
        { reference, resolvedByFactIds: question.resolvedByFactIds },
        { reference, label: question.label, summary: question.summary },
      ),
    );
  }
  for (const objective of input.storyCatalog.objectives) {
    const reference: DefinitionRefV1 = { type: "objective", id: objective.id };
    definitions.push(
      entry(
        reference,
        { reference, kind: objective.kind, sortOrder: objective.sortOrder },
        { reference, label: objective.label, summary: objective.summary },
      ),
    );
  }
  for (const authorization of input.storyCatalog.authorizations) {
    const reference: DefinitionRefV1 = {
      type: "authorization",
      id: authorization.id,
    };
    definitions.push(
      entry(
        reference,
        { reference },
        {
          reference,
          label: authorization.label,
          summary: authorization.summary,
          grantingAuthority: authorization.grantingAuthority,
        },
      ),
    );
  }

  return finalizeManifest(definitions);
}

export function finalizeManifest(
  definitions: DefinitionManifestEntryV1[],
): SaveContentManifestV1 {
  const seen = new Set<string>();
  const sorted = [...definitions].sort((left, right) =>
    definitionRefKey(left.reference).localeCompare(
      definitionRefKey(right.reference),
    ),
  );
  for (const definition of sorted) {
    const key = definitionRefKey(definition.reference);
    if (seen.has(key)) {
      throw new Error(`duplicate save-content definition reference: ${key}`);
    }
    seen.add(key);
  }
  return {
    manifestVersion: 1,
    contentRevision: sha256CanonicalJson({
      manifestVersion: 1,
      definitions: sorted,
    }),
    definitions: sorted,
  };
}

function entry(
  reference: DefinitionRefV1,
  structural: unknown,
  content: unknown,
): DefinitionManifestEntryV1 {
  return {
    reference,
    structuralHash: sha256CanonicalJson(structural),
    contentHash: sha256CanonicalJson(content),
  };
}

function inventoryEntries(
  scene: JSONInvestigationScene | JSONInterrogationScene,
): DefinitionManifestEntryV1[] {
  return [
    ...scene.evidenceManifest.map((record) => {
      const reference: DefinitionRefV1 = {
        type: "inventoryRecord",
        recordKind: "evidence",
        recordId: record.id,
      };
      return entry(
        reference,
        {
          reference,
          imageAssetId: record.imageAssetId,
          sourceSublocationId:
            "sourceSublocationId" in record ? record.sourceSublocationId : null,
          onCollect: record.onCollect.map(dialogueItemStructural),
          onReexamine: record.onReexamine?.map(dialogueItemStructural) ?? null,
        },
        {
          reference,
          name: record.name,
          description: record.description,
          details: record.details,
          onCollect: record.onCollect.map(dialogueItemContent),
          onReexamine: record.onReexamine?.map(dialogueItemContent) ?? null,
        },
      );
    }),
    ...scene.statementManifest.map((record) => {
      const reference: DefinitionRefV1 = {
        type: "inventoryRecord",
        recordKind: "statement",
        recordId: record.id,
      };
      return entry(
        reference,
        {
          reference,
          onAcquire: record.onAcquire.map(dialogueItemStructural),
          onReexamine: record.onReexamine?.map(dialogueItemStructural) ?? null,
        },
        {
          reference,
          speaker: record.speaker,
          content: record.content,
          onAcquire: record.onAcquire.map(dialogueItemContent),
          onReexamine: record.onReexamine?.map(dialogueItemContent) ?? null,
        },
      );
    }),
  ];
}

function sceneStructural(scene: EmittedSceneRecordV1): unknown {
  const reference = {
    type: "scene" as const,
    chapterId: scene.chapterId,
    sceneId: scene.json.id,
    sceneKind: scene.json.type,
  };
  switch (scene.json.type) {
    case "linear":
      return {
        reference,
        assetRefs: scene.json.assetRefs,
        queue: scene.json.queue.map(dialogueItemStructural),
      };
    case "investigation":
      return {
        reference,
        assetRefs: scene.json.assetRefs,
        intro: scene.json.intro.map(dialogueItemStructural),
        sublocations: scene.json.sublocations.map((sublocation) => ({
          id: sublocation.id,
          status: sublocation.status,
          unlock: sublocation.unlock,
          reveals: sublocation.reveals,
          backgroundAssetId: sublocation.backgroundAssetId,
          bgm: sublocation.bgm,
          bgs: sublocation.bgs,
          transitionDialogue: sublocation.transitionDialogue.map(
            dialogueItemStructural,
          ),
          hotspots: sublocation.hotspots.map((hotspot) => ({
            id: hotspot.id,
            status: hotspot.status,
            unlock: hotspot.unlock,
            reveals: hotspot.reveals,
            evidenceSource: hotspot.evidenceSource,
            inspectDialogue: hotspot.inspectDialogue.map(
              dialogueItemStructural,
            ),
            onReexamine:
              hotspot.onReexamine?.map(dialogueItemStructural) ?? null,
          })),
          characters: sublocation.characters.map((character) => ({
            id: character.id,
            role: character.role,
            topics: character.topics.map((topic) => ({
              id: topic.id,
              status: topic.status,
              unlock: topic.unlock,
              reveals: topic.reveals,
              topicDialogue: topic.topicDialogue.map(dialogueItemStructural),
              onReexamine:
                topic.onReexamine?.map(dialogueItemStructural) ?? null,
            })),
          })),
        })),
        evidenceManifest: scene.json.evidenceManifest.map((record) => ({
          id: record.id,
          imageAssetId: record.imageAssetId,
          sourceSublocationId: record.sourceSublocationId,
          onCollect: record.onCollect.map(dialogueItemStructural),
          onReexamine: record.onReexamine?.map(dialogueItemStructural) ?? null,
        })),
        statementManifest: scene.json.statementManifest.map((record) => ({
          id: record.id,
          onAcquire: record.onAcquire.map(dialogueItemStructural),
          onReexamine: record.onReexamine?.map(dialogueItemStructural) ?? null,
        })),
        outro: {
          unlock: scene.json.outro.unlock,
          dialogue: scene.json.outro.dialogue.map(dialogueItemStructural),
        },
      };
    case "interrogation":
      return {
        reference,
        assetRefs: scene.json.assetRefs,
        intro: scene.json.intro.map(dialogueItemStructural),
        phases: scene.json.phases.map((phase) => ({
          kind: phase.kind,
          id: phase.id,
          required: phase.required,
          status: phase.status,
          unlock: phase.unlock,
          reveals: phase.reveals,
          backgroundAssetId: phase.backgroundAssetId,
          bgm: phase.bgm,
          bgs: phase.bgs,
          entryDialogue: phase.entryDialogue.map(dialogueItemStructural),
          complete: phase.complete,
          questions: phase.questions.map((question) => ({
            id: question.id,
            required: question.required,
            status: question.status,
            unlock: question.unlock,
            reveals: question.reveals,
            testimony: {
              onLoop: question.testimony.onLoop.map(dialogueItemStructural),
              loopPrompt: question.testimony.loopPrompt.map(
                dialogueItemStructural,
              ),
              defaultChallenge: question.testimony.defaultChallenge.map(
                dialogueItemStructural,
              ),
              defaultWrong: question.testimony.defaultWrong.map(
                dialogueItemStructural,
              ),
              wrongReply: question.testimony.wrongReply.map(
                dialogueItemStructural,
              ),
              lines: question.testimony.lines.map((line) => ({
                id: line.id,
                contradiction: line.contradiction,
                content: line.content.map(dialogueItemStructural),
                challenge: line.challenge.map(dialogueItemStructural),
                onCorrect: line.onCorrect.map(dialogueItemStructural),
                onWrongEvidence: line.onWrongEvidence.map(
                  dialogueItemStructural,
                ),
                reveals: line.reveals,
              })),
            },
          })),
        })),
        evidenceManifest: scene.json.evidenceManifest.map((record) => ({
          id: record.id,
          imageAssetId: record.imageAssetId,
          onCollect: record.onCollect.map(dialogueItemStructural),
          onReexamine: record.onReexamine?.map(dialogueItemStructural) ?? null,
        })),
        statementManifest: scene.json.statementManifest.map((record) => ({
          id: record.id,
          onAcquire: record.onAcquire.map(dialogueItemStructural),
          onReexamine: record.onReexamine?.map(dialogueItemStructural) ?? null,
        })),
        outro: {
          unlock: scene.json.outro.unlock,
          dialogue: scene.json.outro.dialogue.map(dialogueItemStructural),
        },
      };
  }
}

function sceneContent(
  scene: EmittedSceneRecordV1,
  reference: DefinitionRefV1,
): unknown {
  switch (scene.json.type) {
    case "linear":
      return {
        reference,
        title: scene.json.title,
        queue: scene.json.queue.map(dialogueItemContent),
      };
    case "investigation":
      return {
        reference,
        title: scene.json.title,
        intro: scene.json.intro.map(dialogueItemContent),
        sublocations: scene.json.sublocations.map((sublocation) => ({
          label: sublocation.label,
          sceneTag: sublocation.sceneTag,
          transitionDialogue:
            sublocation.transitionDialogue.map(dialogueItemContent),
          hotspots: sublocation.hotspots.map((hotspot) => ({
            label: hotspot.label,
            description: hotspot.description,
            sceneSourcePrompt: hotspot.sceneSourcePrompt,
            inspectDialogue: hotspot.inspectDialogue.map(dialogueItemContent),
            onReexamine: hotspot.onReexamine?.map(dialogueItemContent) ?? null,
          })),
          characters: sublocation.characters.map((character) => ({
            name: character.name,
            role: character.role,
            bio: character.bio,
            topics: character.topics.map((topic) => ({
              label: topic.label,
              topicDialogue: topic.topicDialogue.map(dialogueItemContent),
              onReexamine: topic.onReexamine?.map(dialogueItemContent) ?? null,
            })),
          })),
        })),
        evidenceManifest: scene.json.evidenceManifest.map((record) => ({
          name: record.name,
          description: record.description,
          details: record.details,
          onCollect: record.onCollect.map(dialogueItemContent),
          onReexamine: record.onReexamine?.map(dialogueItemContent) ?? null,
        })),
        statementManifest: scene.json.statementManifest.map((record) => ({
          speaker: record.speaker,
          content: record.content,
          onAcquire: record.onAcquire.map(dialogueItemContent),
          onReexamine: record.onReexamine?.map(dialogueItemContent) ?? null,
        })),
        outro: scene.json.outro.dialogue.map(dialogueItemContent),
      };
    case "interrogation":
      return {
        reference,
        title: scene.json.title,
        intro: scene.json.intro.map(dialogueItemContent),
        phases: scene.json.phases.map((phase) => ({
          label: phase.label,
          sceneTag: phase.sceneTag,
          subject: phase.subject,
          entryDialogue: phase.entryDialogue.map(dialogueItemContent),
          questions: phase.questions.map((question) => ({
            label: question.label,
            testimony: testimonyContent(question.testimony),
          })),
        })),
        evidenceManifest: scene.json.evidenceManifest.map((record) => ({
          name: record.name,
          description: record.description,
          details: record.details,
          onCollect: record.onCollect.map(dialogueItemContent),
          onReexamine: record.onReexamine?.map(dialogueItemContent) ?? null,
        })),
        statementManifest: scene.json.statementManifest.map((record) => ({
          speaker: record.speaker,
          content: record.content,
          onAcquire: record.onAcquire.map(dialogueItemContent),
          onReexamine: record.onReexamine?.map(dialogueItemContent) ?? null,
        })),
        outro: scene.json.outro.dialogue.map(dialogueItemContent),
      };
  }
}

function testimonyContent(
  testimony: JSONInterrogationScene["phases"][number]["questions"][number]["testimony"],
): unknown {
  return {
    onLoop: testimony.onLoop.map(dialogueItemContent),
    loopPrompt: testimony.loopPrompt.map(dialogueItemContent),
    defaultChallenge: testimony.defaultChallenge.map(dialogueItemContent),
    defaultWrong: testimony.defaultWrong.map(dialogueItemContent),
    wrongReply: testimony.wrongReply.map(dialogueItemContent),
    lines: testimony.lines.map((line) => ({
      label: line.label,
      content: line.content.map(dialogueItemContent),
      challenge: line.challenge.map(dialogueItemContent),
      onCorrect: line.onCorrect.map(dialogueItemContent),
      onWrongEvidence: line.onWrongEvidence.map(dialogueItemContent),
    })),
  };
}

function dialogueItemStructural(item: JSONDialogueItem): unknown {
  switch (item.kind) {
    case "sceneTag":
      return { kind: item.kind, assetCue: item.assetCue ?? null };
    case "action":
      return { kind: item.kind };
    case "line":
      return {
        kind: item.kind,
        speaker: item.speaker,
        expression: item.expression,
        portrait: item.portrait,
      };
  }
}

function dialogueItemContent(item: JSONDialogueItem): unknown {
  switch (item.kind) {
    case "sceneTag":
    case "action":
      return { kind: item.kind, text: item.text };
    case "line":
      return { kind: item.kind, speaker: item.speaker, text: item.text };
  }
}
