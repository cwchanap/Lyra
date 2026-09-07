import type {
  ASTAnalysisScene,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  CompileError,
  DialogueItem,
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

/**
 * Structural subset of an emitted Analysis scene that dialogue-segment
 * derivation reads. The full compiler JSON satisfies it, and so does the
 * layout editor's sanitized public Analysis view (which keeps intro/outro/
 * resultDialogue verbatim while stripping private board data), so both reuse
 * the same authored-source join. Never a parallel identity system: the
 * carriers and item sources are the compiler's own.
 */
export type AnalysisDialogueSceneSource = {
  type: "analysis";
  id: string;
  intro: JSONDialogueItem[];
  outro: JSONDialogueItem[];
  boards: ReadonlyArray<{
    common: { id: string; resultDialogue: JSONDialogueItem[] };
  }>;
};

export type EmittedSceneRecordV1 = {
  chapterId: string;
  json:
    | JSONLinearScene
    | JSONInvestigationScene
    | JSONInterrogationScene
    | AnalysisDialogueSceneSource;
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
  /**
   * Compiler-only per-item authored source lines (HPA-135), parallel to
   * `items` by emitted index. Present only when the scene was derived with
   * `sourceAst`. Each entry is one of:
   *   - `{ sourceFile, line }`: the item resolves to an authored source line.
   *   - `{ stale: true }`: an authored counterpart exists with a source line
   *     but the emitted text no longer matches it (recompile to refresh), OR
   *     the carrier is not a compiler-synthesized default family and the
   *     authored field is absent while emitted items remain (the author
   *     removed the field without recompiling — recompile to refresh).
   *   - `null`: the item is compiler-synthesized — no authored counterpart
   *     exists, so it will never be editable. Only the re-examination
   *     `onReexamine` carriers materialize a canonical default when unauthored,
   *     so only they tag absent source items as `null`.
   * Absent (`undefined`) only when no source document was supplied at all;
   * `resolveDialogueItemSource` treats that as stale (refresh the source).
   */
  itemSources?: Array<
    { sourceFile: string; line: number } | { stale: true } | null
  >;
};

/**
 * Single owner of the Reader carrier spelling (HPA-135). The Reader
 * projection imports this instead of keeping a duplicate mapping.
 */
export function dialogueSegmentCarrierId(
  origin: DialogueSegmentOriginV1,
): string {
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
  }
}

export type DialogueItemSourceResolution =
  | { ok: true; sourceFile: string; line: number }
  | { ok: false; reason: "synthesized"; error: CompileError }
  | { ok: false; reason: "stale"; error: CompileError };

/**
 * Resolves one emitted item's authored source location. The join is
 * carrier-local (by carrier id) plus per-item (by emitted index); any
 * mismatch resolves to `workbenchSourceCarrierStale` for that carrier only —
 * never whole-scene disablement, never text-search relocation.
 *
 * The failure `reason` distinguishes the two non-editable cases so callers
 * can report the right diagnostic without inspecting rendered text:
 *   - `"synthesized"`: no authored counterpart exists (compiler-synthesized
 *     default); recompiling will not make it editable.
 *   - `"stale"`: an authored counterpart exists but the emitted text no
 *     longer matches it, or no source document was supplied; recompiling
 *     or refreshing the source may resolve it.
 */
export function resolveDialogueItemSource(
  segments: readonly DerivedDialogueSegment[],
  carrierId: string,
  itemIndex: number,
): DialogueItemSourceResolution {
  const segment = segments.find(
    (candidate) => dialogueSegmentCarrierId(candidate.origin) === carrierId,
  );
  const source = segment?.itemSources?.[itemIndex];
  if (source && "sourceFile" in source) {
    return { ok: true, sourceFile: source.sourceFile, line: source.line };
  }
  // `null` = compiler-synthesized (no authored counterpart); `undefined` =
  // no source document supplied or index out of range, both stale.
  const synthesized = source === null;
  return {
    ok: false,
    reason: synthesized ? "synthesized" : "stale",
    error: {
      code: synthesized
        ? "workbenchSourceItemSynthesized"
        : "workbenchSourceCarrierStale",
      message: synthesized
        ? `Dialogue carrier "${carrierId}" item ${itemIndex} is compiler-synthesized and has no authored source line to edit.`
        : segment
          ? `Dialogue carrier "${carrierId}" item ${itemIndex} does not match the compiled source; run \`bun run scenes:compile\` to refresh.`
          : `Dialogue carrier "${carrierId}" has no compiled source identity; run \`bun run scenes:compile\` to refresh.`,
      sourceFile: segment?.source?.sourceFile ?? "",
      line: segment?.source?.line ?? itemIndex + 1,
    },
  };
}

function emittedMatchesSource(
  item: JSONDialogueItem,
  ast: DialogueItem,
): boolean {
  if (item.kind === "line" && ast.kind === "line") {
    return item.speaker === ast.speaker && item.text === ast.text;
  }
  if (
    (item.kind === "action" || item.kind === "sceneTag") &&
    ast.kind === item.kind
  ) {
    return item.text === ast.text;
  }
  return false;
}

function itemSourceFields(
  owner: { sourceFile: string } | undefined,
  items: readonly JSONDialogueItem[],
  sourceItems: readonly DialogueItem[] | null | undefined,
  // Only carriers whose unauthored state the compiler materializes into a
  // canonical default (the re-examination `onReexamine` fallbacks) may tag
  // absent source items as `null` (synthesized — never editable). Every other
  // optional carrier (`loopPrompt`, `defaultChallenge`, `defaultWrong`,
  // `wrongReply`, and the optional testimony-line branches `challenge` /
  // `onCorrect` / `onWrongEvidence`) emits `[]` when unauthored, so emitted
  // items with no authored counterpart mean the compiled JSON is stale (the
  // author removed the field without recompiling), not synthesized — tag
  // those `{ stale: true }` so the editor reports `workbenchSourceCarrierStale`
  // (recompile to refresh) instead of permanently non-editable.
  synthesizesDefault = false,
): Pick<DerivedDialogueSegment, "itemSources"> | Record<string, never> {
  // No source document at all: leave itemSources absent so resolution
  // reports stale (refresh the source) rather than synthesized.
  if (!owner) return {};
  // Source document exists but this carrier has no authored items. For the
  // re-examination carriers the compiler synthesizes a canonical default, so
  // every emitted item is synthesized (null — never editable). For every
  // other carrier, unauthored means the field was removed after compiling;
  // any emitted items are stale (recompile to refresh), not synthesized.
  if (!sourceItems) {
    return {
      itemSources: items.map(() =>
        synthesizesDefault ? null : { stale: true },
      ),
    };
  }
  return {
    itemSources: items.map((item, index) => {
      const ast = sourceItems[index];
      if (!ast || ast.sourceLine === undefined) return null;
      if (!emittedMatchesSource(item, ast)) return { stale: true };
      return { sourceFile: owner.sourceFile, line: ast.sourceLine };
    }),
  };
}

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
  scene: AnalysisDialogueSceneSource,
  sourceAst?: ASTAnalysisScene,
): DerivedDialogueSegment[] {
  // Source owners join by semantic board id — never by array position.
  const authoredBoardsById = sourceAst
    ? new Map(sourceAst.boards.map((board) => [board.id, board] as const))
    : null;
  const segments: DerivedDialogueSegment[] = [
    {
      origin: { type: "analysisIntro", chapterId, sceneId: scene.id },
      items: scene.intro,
      ...sourceFields(sourceAst),
      ...itemSourceFields(sourceAst, scene.intro, sourceAst?.intro),
    },
    ...scene.boards.map((board) => {
      const authored = authoredBoardsById?.get(board.common.id);
      return {
        origin: {
          type: "analysisResult" as const,
          chapterId,
          sceneId: scene.id,
          boardId: board.common.id,
        },
        items: board.common.resultDialogue,
        ...sourceFields(authored),
        ...itemSourceFields(
          authored,
          board.common.resultDialogue,
          authored?.resultDialogue,
        ),
      };
    }),
    {
      origin: { type: "analysisOutro", chapterId, sceneId: scene.id },
      items: scene.outro,
      ...sourceFields(sourceAst),
      ...itemSourceFields(sourceAst, scene.outro, sourceAst?.outro),
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
      ...itemSourceFields(sourceAst, scene.queue, sourceAst?.queue),
    },
  ]);
}

function deriveInvestigationSegments(
  chapterId: string,
  scene: JSONInvestigationScene,
  sourceAst?: ASTInvestigationScene,
): DerivedDialogueSegment[] {
  // Source owners join by the same semantic ids that define the carriers —
  // never by raw segment/scene array order.
  const subById = sourceAst
    ? new Map(sourceAst.sublocations.map((sub) => [sub.id, sub] as const))
    : null;
  const evidenceById = sourceAst
    ? new Map(sourceAst.evidenceManifest.map((e) => [e.id, e] as const))
    : null;
  const statementById = sourceAst
    ? new Map(sourceAst.statementManifest.map((s) => [s.id, s] as const))
    : null;

  const segments: DerivedDialogueSegment[] = [
    {
      origin: { type: "investigationIntro", chapterId, sceneId: scene.id },
      items: scene.intro,
      ...sourceFields(sourceAst),
      ...itemSourceFields(sourceAst, scene.intro, sourceAst?.intro),
    },
    {
      origin: { type: "investigationOutro", chapterId, sceneId: scene.id },
      items: scene.outro.dialogue,
      ...sourceFields(sourceAst),
      ...itemSourceFields(
        sourceAst,
        scene.outro.dialogue,
        sourceAst?.outro.dialogue,
      ),
    },
  ];

  for (const sublocation of scene.sublocations) {
    const sourceSublocation = subById?.get(sublocation.id);
    const hotspotsById = sourceSublocation
      ? new Map(
          sourceSublocation.hotspots.map(
            (hotspot) => [hotspot.id, hotspot] as const,
          ),
        )
      : null;
    const charactersById = sourceSublocation
      ? new Map(
          sourceSublocation.characters.map(
            (character) => [character.id, character] as const,
          ),
        )
      : null;
    segments.push({
      origin: investigationInteractionOrigin(
        chapterId,
        scene.id,
        `sublocation:${sublocation.id}:transition`,
      ),
      items: sublocation.transitionDialogue,
      ...sourceFields(sourceSublocation),
      ...itemSourceFields(
        sourceSublocation,
        sublocation.transitionDialogue,
        sourceSublocation?.transitionDialogue,
      ),
    });
    for (const hotspot of sublocation.hotspots) {
      const sourceHotspot = hotspotsById?.get(hotspot.id);
      segments.push(
        {
          origin: investigationInteractionOrigin(
            chapterId,
            scene.id,
            `hotspot:${hotspot.id}:inspect`,
          ),
          items: hotspot.inspectDialogue,
          ...sourceFields(sourceHotspot),
          ...itemSourceFields(
            sourceHotspot,
            hotspot.inspectDialogue,
            sourceHotspot?.inspectDialogue,
          ),
        },
        {
          origin: investigationInteractionOrigin(
            chapterId,
            scene.id,
            `hotspot:${hotspot.id}:reexamine`,
          ),
          items: hotspot.onReexamine ?? [],
          ...sourceFields(sourceHotspot),
          ...itemSourceFields(
            sourceHotspot,
            hotspot.onReexamine ?? [],
            sourceHotspot?.onReexamine,
            true,
          ),
        },
      );
    }
    for (const character of sublocation.characters) {
      const sourceCharacter = charactersById?.get(character.id);
      for (const topic of character.topics) {
        const sourceTopic = sourceCharacter?.topics.find(
          (candidate) => candidate.id === topic.id,
        );
        segments.push(
          {
            origin: investigationInteractionOrigin(
              chapterId,
              scene.id,
              `topic:${character.id}:${topic.id}:dialogue`,
            ),
            items: topic.topicDialogue,
            ...sourceFields(sourceTopic),
            ...itemSourceFields(
              sourceTopic,
              topic.topicDialogue,
              sourceTopic?.topicDialogue,
            ),
          },
          {
            origin: investigationInteractionOrigin(
              chapterId,
              scene.id,
              `topic:${character.id}:${topic.id}:reexamine`,
            ),
            items: topic.onReexamine ?? [],
            ...sourceFields(sourceTopic),
            ...itemSourceFields(
              sourceTopic,
              topic.onReexamine ?? [],
              sourceTopic?.onReexamine,
              true,
            ),
          },
        );
      }
    }
  }
  for (const evidence of scene.evidenceManifest) {
    const sourceEvidence = evidenceById?.get(evidence.id);
    segments.push(
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `evidence:${evidence.id}:onCollect`,
        ),
        items: evidence.onCollect,
        ...sourceFields(sourceEvidence),
        ...itemSourceFields(
          sourceEvidence,
          evidence.onCollect,
          sourceEvidence?.onCollect,
        ),
      },
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `evidence:${evidence.id}:onReexamine`,
        ),
        items: evidence.onReexamine ?? [],
        ...sourceFields(sourceEvidence),
        ...itemSourceFields(
          sourceEvidence,
          evidence.onReexamine ?? [],
          sourceEvidence?.onReexamine,
          true,
        ),
      },
    );
  }
  for (const statement of scene.statementManifest) {
    const sourceStatement = statementById?.get(statement.id);
    segments.push(
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `statement:${statement.id}:onAcquire`,
        ),
        items: statement.onAcquire,
        ...sourceFields(sourceStatement),
        ...itemSourceFields(
          sourceStatement,
          statement.onAcquire,
          sourceStatement?.onAcquire,
        ),
      },
      {
        origin: investigationInteractionOrigin(
          chapterId,
          scene.id,
          `statement:${statement.id}:onReexamine`,
        ),
        items: statement.onReexamine ?? [],
        ...sourceFields(sourceStatement),
        ...itemSourceFields(
          sourceStatement,
          statement.onReexamine ?? [],
          sourceStatement?.onReexamine,
          true,
        ),
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
  // Source owners join by semantic phase/question/line ids — never by array
  // position.
  const phaseById = sourceAst
    ? new Map(sourceAst.phases.map((phase) => [phase.id, phase] as const))
    : null;
  const evidenceById = sourceAst
    ? new Map(sourceAst.evidenceManifest.map((e) => [e.id, e] as const))
    : null;
  const statementById = sourceAst
    ? new Map(sourceAst.statementManifest.map((s) => [s.id, s] as const))
    : null;

  const segments: DerivedDialogueSegment[] = [
    {
      origin: { type: "interrogationIntro", chapterId, sceneId: scene.id },
      items: scene.intro,
      ...sourceFields(sourceAst),
      ...itemSourceFields(sourceAst, scene.intro, sourceAst?.intro),
    },
    {
      origin: { type: "interrogationOutro", chapterId, sceneId: scene.id },
      items: scene.outro.dialogue,
      ...sourceFields(sourceAst),
      ...itemSourceFields(
        sourceAst,
        scene.outro.dialogue,
        sourceAst?.outro.dialogue,
      ),
    },
  ];

  for (const phase of scene.phases) {
    const sourcePhase = phaseById?.get(phase.id);
    const questionsById = sourcePhase
      ? new Map(sourcePhase.questions.map((q) => [q.id, q] as const))
      : null;
    segments.push({
      origin: interrogationPhaseOrigin(
        chapterId,
        scene.id,
        phase.id,
        `phase:${phase.id}:entry`,
      ),
      items: phase.entryDialogue,
      ...sourceFields(sourcePhase),
      ...itemSourceFields(
        sourcePhase,
        phase.entryDialogue,
        sourcePhase?.entryDialogue,
      ),
    });
    for (const question of phase.questions) {
      const sourceQuestion = questionsById?.get(question.id);
      const sourceTestimony = sourceQuestion?.testimony;
      const testimony = question.testimony;
      for (const [role, items, sourceItems] of [
        ["onLoop", testimony.onLoop, sourceTestimony?.onLoop],
        ["loopPrompt", testimony.loopPrompt, sourceTestimony?.loopPrompt],
        [
          "defaultChallenge",
          testimony.defaultChallenge,
          sourceTestimony?.defaultChallenge,
        ],
        ["defaultWrong", testimony.defaultWrong, sourceTestimony?.defaultWrong],
        ["wrongReply", testimony.wrongReply, sourceTestimony?.wrongReply],
      ] as const) {
        segments.push({
          origin: interrogationPhaseOrigin(
            chapterId,
            scene.id,
            phase.id,
            `question:${question.id}:${role}`,
          ),
          items,
          ...sourceFields(sourceTestimony),
          ...itemSourceFields(sourceTestimony, items, sourceItems),
        });
      }
      const linesById = sourceTestimony
        ? new Map(sourceTestimony.lines.map((line) => [line.id, line] as const))
        : null;
      for (const line of testimony.lines) {
        const sourceLine = linesById?.get(line.id);
        for (const [role, items, sourceItems] of [
          ["content", line.content, sourceLine?.content],
          ["challenge", line.challenge, sourceLine?.challenge],
          ["onCorrect", line.onCorrect, sourceLine?.onCorrect],
          [
            "onWrongEvidence",
            line.onWrongEvidence,
            sourceLine?.onWrongEvidence,
          ],
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
            ...itemSourceFields(sourceLine, items, sourceItems),
          });
        }
      }
    }
  }
  for (const evidence of scene.evidenceManifest) {
    const sourceEvidence = evidenceById?.get(evidence.id);
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
        ...itemSourceFields(
          sourceEvidence,
          evidence.onCollect,
          sourceEvidence?.onCollect,
        ),
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
        ...itemSourceFields(
          sourceEvidence,
          evidence.onReexamine ?? [],
          sourceEvidence?.onReexamine,
          true,
        ),
      },
    );
  }
  for (const statement of scene.statementManifest) {
    const sourceStatement = statementById?.get(statement.id);
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
        ...itemSourceFields(
          sourceStatement,
          statement.onAcquire,
          sourceStatement?.onAcquire,
        ),
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
        ...itemSourceFields(
          sourceStatement,
          statement.onReexamine ?? [],
          sourceStatement?.onReexamine,
          true,
        ),
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
