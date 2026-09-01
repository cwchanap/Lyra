import {
  deriveDialogueSegments,
  type DerivedDialogueSegment,
} from "@lyra/scripts/compile-scenes/dialogue-segment-origins";
import type { DialogueSegmentOriginV1 } from "@lyra/scripts/compile-scenes/save-content-manifest";
import type {
  InterrogationRevealTarget,
  InventoryTarget,
  InvestigationRevealTarget,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
  StoryRevealTarget,
} from "@lyra/scripts/compile-scenes/types";
import type {
  PublicAnalysisScene,
  ReaderFlow,
  ReaderGroup,
  ReaderGroupKind,
  ReaderItem,
  ReaderPresentationFact,
  ReaderScene,
  WorkbenchScenePayload,
} from "./workbench-types";

export class ReaderProjectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = "ReaderProjectionError";
  }
}

function assertNever(value: never): never {
  throw new ReaderProjectionError(
    "unhandledRuntimeVariant",
    `Unhandled runtime value: ${JSON.stringify(value)}`,
  );
}

// ----- Dialogue conversion ---------------------------------------------------

export function projectDialogue(item: JSONDialogueItem): ReaderItem {
  switch (item.kind) {
    case "sceneTag":
      return { kind: "sceneTag", text: item.text };
    case "action":
      return { kind: "action", text: item.text };
    case "line":
      return { kind: "line", speaker: item.speaker, text: item.text };
    default:
      return assertNever(item);
  }
}

// ----- Compiler segment normalization ------------------------------------------

export function readerSegmentId(origin: DialogueSegmentOriginV1): string {
  switch (origin.type) {
    case "linearScene":
      return "main";
    case "investigationIntro":
    case "interrogationIntro":
    case "analysisIntro":
      return "intro";
    case "investigationOutro":
    case "interrogationOutro":
    case "analysisOutro":
      return "outro";
    case "investigationInteraction":
    case "interrogationPhase":
      return origin.segmentId;
    case "analysisResult":
      return `board:${origin.boardId}:result`;
    default:
      return assertNever(origin);
  }
}

/**
 * Consumable view over `deriveDialogueSegments()`: projection must `take()`
 * every non-empty compiler segment exactly once, with the compiler's own
 * carrier spelling, or `assertFullyConsumed()` / `take()` throw.
 */
class SegmentPool {
  readonly #segments = new Map<string, DerivedDialogueSegment>();

  constructor(segments: DerivedDialogueSegment[]) {
    for (const segment of segments) {
      this.#segments.set(readerSegmentId(segment.origin), segment);
    }
  }

  take(id: string): JSONDialogueItem[] {
    const segment = this.#segments.get(id);
    if (!segment) {
      throw new ReaderProjectionError(
        "unknownCompilerDialogueCarrier",
        `No compiler dialogue segment exists for carrier "${id}".`,
      );
    }
    this.#segments.delete(id);
    return segment.items;
  }

  assertFullyConsumed(): void {
    const [firstUnconsumed] = this.#segments.keys();
    if (firstUnconsumed !== undefined) {
      throw new ReaderProjectionError(
        "unconsumedCompilerDialogueSegment",
        `Compiler dialogue segment "${firstUnconsumed}" was not projected into the reader tree.`,
      );
    }
  }
}

// ----- Group helpers -----------------------------------------------------------

function carrierGroup(
  presentation: ReaderPresentationFact[],
  id: string,
  kind: ReaderGroupKind,
  label: string,
  items: JSONDialogueItem[],
  flow: ReaderFlow = "main",
): ReaderGroup | null {
  // Mirror the compiler walker: empty carriers never become reader groups.
  if (items.length === 0) return null;
  // Collect presentation from the raw compiler items before projectDialogue()
  // strips it for Reader display. Facts carry the carrier ID and the index of
  // the item inside this carrier's item array.
  items.forEach((item, itemIndex) => {
    if (item.kind === "sceneTag" && item.assetCue) {
      presentation.push({
        kind: "dialogueAssetCue",
        carrierId: id,
        itemIndex,
        cue: item.assetCue,
      });
    } else if (item.kind === "line" && item.portrait) {
      presentation.push({
        kind: "dialoguePortrait",
        carrierId: id,
        itemIndex,
        portrait: item.portrait,
      });
    }
  });
  return {
    id,
    kind,
    label,
    flow,
    sourceAnchor: null,
    items: items.map(projectDialogue),
    children: [],
  };
}

function pooledCarrierGroup(
  presentation: ReaderPresentationFact[],
  pool: SegmentPool,
  id: string,
  kind: ReaderGroupKind,
  label: string,
  items: JSONDialogueItem[],
  flow: ReaderFlow = "main",
): ReaderGroup | null {
  if (items.length === 0) return null;
  return carrierGroup(presentation, id, kind, label, pool.take(id), flow);
}

function structuralGroup(
  id: string,
  kind: ReaderGroupKind,
  label: string,
  semanticId: string,
  items: ReaderItem[] = [],
  children: ReaderGroup[] = [],
): ReaderGroup {
  return {
    id,
    kind,
    label,
    flow: "main",
    sourceAnchor: `#${semanticId}`,
    items,
    children,
  };
}

function pushGroup(groups: ReaderGroup[], group: ReaderGroup | null): void {
  if (group) groups.push(group);
}

function withPrependedNotices(
  group: ReaderGroup | null,
  notices: ReaderItem[],
): ReaderGroup | null {
  if (group === null || notices.length === 0) return group;
  return { ...group, items: [...notices, ...group.items] };
}

// ----- Non-dialogue notice helpers ----------------------------------------------

function inventoryTargetText(target: {
  kind: "evidence" | "statement";
  id: string;
}) {
  return `${target.kind}:${target.id}`;
}

function storyRevealText(target: StoryRevealTarget): string {
  switch (target.kind) {
    case "assertFact":
      return `Asserts fact: ${target.factId}`;
    case "revealQuestion":
      return `Reveals question: ${target.questionId}`;
    case "resolveQuestion":
      return `Resolves question: ${target.questionId} by fact: ${target.factId}`;
    case "revealObjective":
      return `Reveals objective: ${target.objectiveId}`;
    case "completeObjective":
      return `Completes objective: ${target.objectiveId}`;
    case "setPrimaryObjective":
      return `Sets primary objective: ${target.nextObjectiveId ?? "none"}${
        target.completeCurrent ? " after completing current" : ""
      }`;
    case "grantAuthorization":
      return `Grants authorization: ${target.authorizationId}`;
    default:
      return assertNever(target);
  }
}

function investigationRevealText(target: InvestigationRevealTarget): string {
  switch (target.kind) {
    case "evidence":
      return `Reveals evidence: ${target.id}`;
    case "statement":
      return `Reveals statement: ${target.id}`;
    case "practice":
      return `Reveals practice: ${target.id}`;
    case "topic":
      return `Reveals topic: ${target.characterId}/${target.topicId}`;
    case "hotspot":
      return `Reveals hotspot: ${target.id}`;
    case "sublocation":
      return `Reveals sublocation: ${target.id}`;
    default:
      return storyRevealText(target);
  }
}

function interrogationRevealText(target: InterrogationRevealTarget): string {
  switch (target.kind) {
    case "evidence":
      return `Reveals evidence: ${target.id}`;
    case "statement":
      return `Reveals statement: ${target.id}`;
    case "question":
      return `Reveals question: ${target.id}`;
    case "phase":
      return `Reveals phase: ${target.id}`;
    default:
      return storyRevealText(target);
  }
}

function revealNoticeKind(
  target: InvestigationRevealTarget | InterrogationRevealTarget,
): "evidence" | "statement" | "reveal" {
  return target.kind === "evidence" || target.kind === "statement"
    ? target.kind
    : "reveal";
}

function investigationRevealNotice(
  target: InvestigationRevealTarget,
): ReaderItem {
  return {
    kind: "notice",
    noticeKind: revealNoticeKind(target),
    text: investigationRevealText(target),
  };
}

function interrogationRevealNotice(
  target: InterrogationRevealTarget,
): ReaderItem {
  return {
    kind: "notice",
    noticeKind: revealNoticeKind(target),
    text: interrogationRevealText(target),
  };
}

function contradictionNotice(contradiction: InventoryTarget): ReaderItem {
  return {
    kind: "notice",
    noticeKind: "contradiction",
    text: `Contradiction: ${inventoryTargetText(contradiction)}`,
  };
}

function fixedAnchorNotice(anchor: {
  cardId: string;
  position: number;
}): ReaderItem {
  return {
    kind: "notice",
    noticeKind: "constraint",
    text: `Fixed card ${anchor.cardId} at position ${anchor.position}`,
  };
}

// ----- Scene projection ---------------------------------------------------

export function projectReaderScene(
  chapterId: string,
  sourcePath: string,
  scene: WorkbenchScenePayload,
): ReaderScene {
  switch (scene.type) {
    case "linear":
      return projectLinear(chapterId, sourcePath, scene);
    case "investigation":
      return projectInvestigation(chapterId, sourcePath, scene);
    case "interrogation":
      return projectInterrogation(chapterId, sourcePath, scene);
    case "analysis":
      return projectPublicAnalysis(sourcePath, scene);
    default:
      return assertNever(scene);
  }
}

function projectLinear(
  chapterId: string,
  sourcePath: string,
  scene: JSONLinearScene,
): ReaderScene {
  const pool = new SegmentPool(
    deriveDialogueSegments({ chapterId, json: scene }),
  );
  const groups: ReaderGroup[] = [];
  const presentation: ReaderPresentationFact[] = [];
  pushGroup(
    groups,
    pooledCarrierGroup(presentation, pool, "main", "line", "Main", scene.queue),
  );
  pool.assertFullyConsumed();
  return {
    id: scene.id,
    type: "linear",
    title: scene.title,
    sourcePath,
    groups,
    presentation,
  };
}

function evidenceMetadataNotices(evidence: {
  name: string;
  description: string;
}): ReaderItem[] {
  return [
    {
      kind: "notice",
      noticeKind: "evidence",
      text: `Evidence: ${evidence.name}`,
    },
    {
      kind: "notice",
      noticeKind: "evidence",
      text: `Description: ${evidence.description}`,
    },
  ];
}

function statementMetadataNotices(statement: {
  speaker: string;
  content: string;
}): ReaderItem[] {
  return [
    {
      kind: "notice",
      noticeKind: "statement",
      text: `Statement — ${statement.speaker}: ${statement.content}`,
    },
  ];
}

function appendInventoryCarrierGroups(
  presentation: ReaderPresentationFact[],
  pool: SegmentPool,
  groups: ReaderGroup[],
  evidenceManifest: Array<{
    id: string;
    name: string;
    description: string;
    imageAssetId: string | null;
    onCollect: JSONDialogueItem[];
    onReexamine: JSONDialogueItem[] | null;
  }>,
  statementManifest: Array<{
    id: string;
    speaker: string;
    content: string;
    onAcquire: JSONDialogueItem[];
    onReexamine: JSONDialogueItem[] | null;
  }>,
  withMetadata: boolean,
): void {
  for (const evidence of evidenceManifest) {
    if (evidence.imageAssetId !== null) {
      presentation.push({
        kind: "evidenceImage",
        carrierId: `evidence:${evidence.id}`,
        imageAssetId: evidence.imageAssetId,
      });
    }
    const notices = withMetadata ? evidenceMetadataNotices(evidence) : [];
    pushGroup(
      groups,
      withPrependedNotices(
        pooledCarrierGroup(
          presentation,
          pool,
          `evidence:${evidence.id}:onCollect`,
          "evidence",
          "On Collect",
          evidence.onCollect,
          "branch",
        ),
        notices,
      ),
    );
    pushGroup(
      groups,
      withPrependedNotices(
        pooledCarrierGroup(
          presentation,
          pool,
          `evidence:${evidence.id}:onReexamine`,
          "evidence",
          "On Re-examine",
          evidence.onReexamine ?? [],
          "branch",
        ),
        notices,
      ),
    );
  }
  for (const statement of statementManifest) {
    const notices = withMetadata ? statementMetadataNotices(statement) : [];
    pushGroup(
      groups,
      withPrependedNotices(
        pooledCarrierGroup(
          presentation,
          pool,
          `statement:${statement.id}:onAcquire`,
          "statement",
          "On Acquire",
          statement.onAcquire,
          "branch",
        ),
        notices,
      ),
    );
    pushGroup(
      groups,
      withPrependedNotices(
        pooledCarrierGroup(
          presentation,
          pool,
          `statement:${statement.id}:onReexamine`,
          "statement",
          "On Re-examine",
          statement.onReexamine ?? [],
          "branch",
        ),
        notices,
      ),
    );
  }
}

function projectInvestigation(
  chapterId: string,
  sourcePath: string,
  scene: JSONInvestigationScene,
): ReaderScene {
  const pool = new SegmentPool(
    deriveDialogueSegments({ chapterId, json: scene }),
  );
  const groups: ReaderGroup[] = [];
  const presentation: ReaderPresentationFact[] = [];
  pushGroup(
    groups,
    pooledCarrierGroup(
      presentation,
      pool,
      "intro",
      "intro",
      "Intro",
      scene.intro,
    ),
  );
  if (scene.map !== null) {
    // Global map surface: one structural fact at the existing traversal,
    // before sublocation cues. No map reader group exists, so Assets falls
    // back to the carrier ID for its label.
    presentation.push({
      kind: "structuralVisualCue",
      carrierId: `map:${scene.map.id}`,
      backgroundAssetId: scene.map.backgroundAssetId,
      bgm: null,
      bgs: null,
    });
  }
  for (const sublocation of scene.sublocations) {
    const children: ReaderGroup[] = [];
    // Structural visual cue at the existing sublocation traversal site.
    presentation.push({
      kind: "structuralVisualCue",
      carrierId: `sublocation:${sublocation.id}`,
      backgroundAssetId: sublocation.backgroundAssetId,
      bgm: sublocation.bgm,
      bgs: sublocation.bgs,
    });
    pushGroup(
      children,
      pooledCarrierGroup(
        presentation,
        pool,
        `sublocation:${sublocation.id}:transition`,
        "sublocation",
        "Transition",
        sublocation.transitionDialogue,
      ),
    );
    for (const hotspot of sublocation.hotspots) {
      const hotspotChildren: ReaderGroup[] = [];
      pushGroup(
        hotspotChildren,
        pooledCarrierGroup(
          presentation,
          pool,
          `hotspot:${hotspot.id}:inspect`,
          "hotspot",
          "Inspect",
          hotspot.inspectDialogue,
        ),
      );
      pushGroup(
        hotspotChildren,
        pooledCarrierGroup(
          presentation,
          pool,
          `hotspot:${hotspot.id}:reexamine`,
          "hotspot",
          "On Re-examine",
          hotspot.onReexamine ?? [],
          "branch",
        ),
      );
      children.push(
        structuralGroup(
          `hotspot:${hotspot.id}`,
          "hotspot",
          hotspot.label,
          hotspot.id,
          hotspot.reveals.map(investigationRevealNotice),
          hotspotChildren,
        ),
      );
    }
    for (const character of sublocation.characters) {
      // Sprite layouts carry a raw asset ID at the existing character site;
      // baked layouts are non-asset-bearing. Asset kind resolves via the
      // manifest join downstream.
      if (character.layout?.kind === "sprite") {
        presentation.push({
          kind: "sprite",
          carrierId: `character:${character.id}`,
          characterId: character.id,
          assetId: character.layout.assetId,
        });
      }
      for (const topic of character.topics) {
        const topicChildren: ReaderGroup[] = [];
        pushGroup(
          topicChildren,
          pooledCarrierGroup(
            presentation,
            pool,
            `topic:${character.id}:${topic.id}:dialogue`,
            "topic",
            "Dialogue",
            topic.topicDialogue,
          ),
        );
        pushGroup(
          topicChildren,
          pooledCarrierGroup(
            presentation,
            pool,
            `topic:${character.id}:${topic.id}:reexamine`,
            "topic",
            "On Re-examine",
            topic.onReexamine ?? [],
            "branch",
          ),
        );
        children.push(
          structuralGroup(
            `topic:${character.id}:${topic.id}`,
            "topic",
            topic.label,
            topic.id,
            topic.reveals.map(investigationRevealNotice),
            topicChildren,
          ),
        );
      }
    }
    groups.push(
      structuralGroup(
        `sublocation:${sublocation.id}`,
        "sublocation",
        sublocation.label,
        sublocation.id,
        sublocation.reveals.map(investigationRevealNotice),
        children,
      ),
    );
  }
  appendInventoryCarrierGroups(
    presentation,
    pool,
    groups,
    scene.evidenceManifest,
    scene.statementManifest,
    false,
  );
  pushGroup(
    groups,
    pooledCarrierGroup(
      presentation,
      pool,
      "outro",
      "outro",
      "Outro",
      scene.outro.dialogue,
    ),
  );
  pool.assertFullyConsumed();
  return {
    id: scene.id,
    type: "investigation",
    title: scene.title,
    sourcePath,
    groups,
    presentation,
  };
}

function projectInterrogation(
  chapterId: string,
  sourcePath: string,
  scene: JSONInterrogationScene,
): ReaderScene {
  const pool = new SegmentPool(
    deriveDialogueSegments({ chapterId, json: scene }),
  );
  const groups: ReaderGroup[] = [];
  const presentation: ReaderPresentationFact[] = [];
  pushGroup(
    groups,
    pooledCarrierGroup(
      presentation,
      pool,
      "intro",
      "intro",
      "Intro",
      scene.intro,
    ),
  );
  for (const phase of scene.phases) {
    const phaseChildren: ReaderGroup[] = [];
    // Structural visual cue + subject portrait at the existing phase site.
    presentation.push({
      kind: "structuralVisualCue",
      carrierId: `phase:${phase.id}`,
      backgroundAssetId: phase.backgroundAssetId,
      bgm: phase.bgm,
      bgs: phase.bgs,
    });
    if (phase.subject.portrait !== null) {
      presentation.push({
        kind: "subjectPortrait",
        carrierId: `phase:${phase.id}`,
        portrait: phase.subject.portrait,
      });
    }
    pushGroup(
      phaseChildren,
      pooledCarrierGroup(
        presentation,
        pool,
        `phase:${phase.id}:entry`,
        "phase",
        "Entry",
        phase.entryDialogue,
      ),
    );
    for (const question of phase.questions) {
      const questionChildren: ReaderGroup[] = [];
      const testimony = question.testimony;
      pushGroup(
        questionChildren,
        pooledCarrierGroup(
          presentation,
          pool,
          `question:${question.id}:onLoop`,
          "question",
          "On Loop",
          testimony.onLoop,
          "branch",
        ),
      );
      pushGroup(
        questionChildren,
        pooledCarrierGroup(
          presentation,
          pool,
          `question:${question.id}:loopPrompt`,
          "question",
          "Loop Prompt",
          testimony.loopPrompt,
          "branch",
        ),
      );
      pushGroup(
        questionChildren,
        pooledCarrierGroup(
          presentation,
          pool,
          `question:${question.id}:defaultChallenge`,
          "question",
          "Default Press",
          testimony.defaultChallenge,
          "branch",
        ),
      );
      pushGroup(
        questionChildren,
        pooledCarrierGroup(
          presentation,
          pool,
          `question:${question.id}:defaultWrong`,
          "question",
          "Default Wrong",
          testimony.defaultWrong,
          "branch",
        ),
      );
      pushGroup(
        questionChildren,
        pooledCarrierGroup(
          presentation,
          pool,
          `question:${question.id}:wrongReply`,
          "question",
          "Wrong Reply",
          testimony.wrongReply,
          "branch",
        ),
      );
      for (const testimonyLine of testimony.lines) {
        const lineChildren: ReaderGroup[] = [];
        pushGroup(
          lineChildren,
          pooledCarrierGroup(
            presentation,
            pool,
            `question:${question.id}:line:${testimonyLine.id}:content`,
            "line",
            "Content",
            testimonyLine.content,
          ),
        );
        pushGroup(
          lineChildren,
          pooledCarrierGroup(
            presentation,
            pool,
            `question:${question.id}:line:${testimonyLine.id}:challenge`,
            "line",
            "Press",
            testimonyLine.challenge,
            "branch",
          ),
        );
        pushGroup(
          lineChildren,
          pooledCarrierGroup(
            presentation,
            pool,
            `question:${question.id}:line:${testimonyLine.id}:onCorrect`,
            "line",
            "Correct Present",
            testimonyLine.onCorrect,
            "branch",
          ),
        );
        pushGroup(
          lineChildren,
          pooledCarrierGroup(
            presentation,
            pool,
            `question:${question.id}:line:${testimonyLine.id}:onWrongEvidence`,
            "line",
            "Wrong Present",
            testimonyLine.onWrongEvidence,
            "branch",
          ),
        );
        const lineItems = testimonyLine.reveals.map(interrogationRevealNotice);
        if (testimonyLine.contradiction) {
          lineItems.push(contradictionNotice(testimonyLine.contradiction));
        }
        questionChildren.push(
          structuralGroup(
            `line:${testimonyLine.id}`,
            "line",
            testimonyLine.label,
            testimonyLine.id,
            lineItems,
            lineChildren,
          ),
        );
      }
      phaseChildren.push(
        structuralGroup(
          `question:${question.id}`,
          "question",
          question.label,
          question.id,
          question.reveals.map(interrogationRevealNotice),
          questionChildren,
        ),
      );
    }
    groups.push(
      structuralGroup(
        `phase:${phase.id}`,
        "phase",
        phase.label,
        phase.id,
        phase.reveals.map(interrogationRevealNotice),
        phaseChildren,
      ),
    );
  }
  appendInventoryCarrierGroups(
    presentation,
    pool,
    groups,
    scene.evidenceManifest,
    scene.statementManifest,
    true,
  );
  pushGroup(
    groups,
    pooledCarrierGroup(
      presentation,
      pool,
      "outro",
      "outro",
      "Outro",
      scene.outro.dialogue,
    ),
  );
  pool.assertFullyConsumed();
  return {
    id: scene.id,
    type: "interrogation",
    title: scene.title,
    sourcePath,
    groups,
    presentation,
  };
}

function projectPublicAnalysis(
  sourcePath: string,
  scene: PublicAnalysisScene,
): ReaderScene {
  const groups: ReaderGroup[] = [];
  // Public Analysis exposes a sanitized scene: presentation comes only from
  // the public intro/result/outro dialogue — never from private board data.
  const presentation: ReaderPresentationFact[] = [];
  pushGroup(
    groups,
    carrierGroup(presentation, "intro", "intro", "Intro", scene.intro),
  );
  for (const board of scene.boards) {
    const boardItems: ReaderItem[] = [
      { kind: "notice", noticeKind: "prompt", text: board.common.prompt },
      {
        kind: "notice",
        noticeKind: "feedback",
        text: board.common.feedback.incomplete,
      },
      {
        kind: "notice",
        noticeKind: "feedback",
        text: board.common.feedback.incorrect,
      },
    ];
    if (board.common.feedback.hint !== null) {
      boardItems.push({
        kind: "notice",
        noticeKind: "feedback",
        text: board.common.feedback.hint,
      });
    }
    if ("fixedAnchors" in board) {
      boardItems.push(...board.fixedAnchors.map(fixedAnchorNotice));
    }
    const children: ReaderGroup[] = [];
    if ("groups" in board) {
      for (const group of board.groups) {
        children.push(
          structuralGroup(`group:${group.id}`, "group", group.label, group.id, [
            { kind: "notice", noticeKind: "group", text: group.description },
          ]),
        );
      }
    }
    for (const card of board.common.cards) {
      children.push(
        structuralGroup(`card:${card.id}`, "card", card.label, card.id, [
          {
            kind: "notice",
            noticeKind: "card",
            text: `Source: ${card.source.kind}:${card.source.id}`,
          },
          { kind: "notice", noticeKind: "card", text: card.summary },
        ]),
      );
    }
    pushGroup(
      children,
      carrierGroup(
        presentation,
        `board:${board.common.id}:result`,
        "result",
        "Result",
        board.common.resultDialogue,
      ),
    );
    groups.push(
      structuralGroup(
        `board:${board.common.id}`,
        "board",
        board.common.label,
        board.common.id,
        boardItems,
        children,
      ),
    );
  }
  pushGroup(
    groups,
    carrierGroup(presentation, "outro", "outro", "Outro", scene.outro),
  );
  return {
    id: scene.id,
    type: "analysis",
    title: scene.title,
    sourcePath,
    groups,
    presentation,
  };
}
