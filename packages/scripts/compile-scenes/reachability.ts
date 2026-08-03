import type { AnalysisDefinitionRegistry } from "./analysis-definition-registry";
import type {
  ASTChapter,
  ASTInquiryQuestion,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTStoryCatalog,
  InterrogationRevealTarget,
  InvestigationRevealTarget,
  PositiveExpression,
  StoryPredicate,
  StoryRevealTarget,
} from "./types";
import {
  isStoryPredicate,
  isStoryRevealTarget,
  type SceneRecord,
} from "./validator";

export type ReachabilityAtom = string;

export type ReachabilityPredicate = {
  predicate: "atom";
  atom: ReachabilityAtom;
};

export type ReachabilityEffect =
  | {
      kind: "addAtom";
      atom: ReachabilityAtom;
      targetIndex: number;
    }
  | {
      kind: "story";
      target: StoryRevealTarget;
      targetIndex: number;
    };

export type ReachabilityNode = {
  key: string;
  requirement: "mandatory" | "optional";
  legacyCompatibilityMode: boolean;
  initiallyReachable: boolean;
  condition: PositiveExpression<ReachabilityPredicate> | null;
  implicitPrerequisites: ReachabilityPredicate[];
  effects: ReachabilityEffect[];
  representedAuthority: string | null;
  strictPredecessorKeys: string[];
  mayExecuteBeforeKeys: string[];
  freeOrderRegionId: string | null;
  sourceFile: string;
  line: number;
};

type SceneScope = {
  chapterId: string;
  sceneId: string;
  prefix: string;
};

type NodeDraft = ReachabilityNode & {
  inboundTargetKey: string | null;
  revealedTargetKeys: string[];
  requiresInboundReveal: boolean;
};

/**
 * Converts the family-specific scene ASTs into one deterministic, finite node
 * model. Catalog and analysis definitions remain validation inputs rather than
 * seeds: merely defining story state or analysis content never makes progress
 * reachable.
 */
export function buildReachabilityNodes(input: {
  chapters: ASTChapter[];
  scenes: SceneRecord[];
  catalog: ASTStoryCatalog;
  analysisRegistry: AnalysisDefinitionRegistry;
}): ReachabilityNode[] {
  const records = orderedSceneRecords(input.chapters, input.scenes);
  const nodes: NodeDraft[] = [];
  let previousOutroKey: string | null = null;
  let firstScene = true;

  for (const record of records) {
    const scope = sceneScope(record);
    const sceneNodes = buildSceneNodes({
      record,
      scope,
      entryPredecessors: previousOutroKey === null ? [] : [previousOutroKey],
      firstScene,
    });
    nodes.push(...sceneNodes);
    previousOutroKey = `${scope.prefix}/outro`;
    firstScene = false;
  }

  addEffectAndRevealPredecessors(nodes);
  addMayBeforeRelations(nodes);

  return nodes.map(
    ({
      inboundTargetKey: _inboundTargetKey,
      revealedTargetKeys: _revealedTargetKeys,
      requiresInboundReveal: _requiresInboundReveal,
      ...node
    }) => node,
  );
}

function orderedSceneRecords(
  chapters: ASTChapter[],
  scenes: SceneRecord[],
): SceneRecord[] {
  const recordsByManifestKey = new Map(
    scenes.map(
      (record) => [`${record.chapterId}/${record.file}`, record] as const,
    ),
  );
  const ordered: SceneRecord[] = [];
  const included = new Set<SceneRecord>();
  const orderedChapters = [...chapters].sort(
    (left, right) =>
      left.number - right.number || left.dirName.localeCompare(right.dirName),
  );

  for (const chapter of orderedChapters) {
    for (const file of chapter.sceneFiles) {
      const record = recordsByManifestKey.get(`${chapter.dirName}/${file}`);
      if (!record || included.has(record)) continue;
      included.add(record);
      ordered.push(record);
    }
  }

  const unlisted = scenes
    .filter((record) => !included.has(record))
    .sort(
      (left, right) =>
        left.chapterId.localeCompare(right.chapterId) ||
        left.file.localeCompare(right.file),
    );
  ordered.push(...unlisted);
  return ordered;
}

function buildSceneNodes(input: {
  record: SceneRecord;
  scope: SceneScope;
  entryPredecessors: string[];
  firstScene: boolean;
}): NodeDraft[] {
  const { record, scope } = input;
  if (record.ast.kind === "linearScene") {
    return [
      node({
        key: `${scope.prefix}/entry`,
        requirement: "mandatory",
        legacyCompatibilityMode: true,
        initiallyReachable: input.firstScene,
        strictPredecessorKeys: input.entryPredecessors,
        sourceFile: record.ast.sourceFile,
        line: record.ast.line,
      }),
      node({
        key: `${scope.prefix}/outro`,
        requirement: "mandatory",
        legacyCompatibilityMode: true,
        initiallyReachable: false,
        strictPredecessorKeys: [`${scope.prefix}/entry`],
        sourceFile: record.ast.sourceFile,
        line: record.ast.line,
      }),
    ];
  }
  if (record.ast.kind === "investigationScene") {
    return buildInvestigationNodes({
      scene: record.ast,
      scope,
      entryPredecessors: input.entryPredecessors,
      firstScene: input.firstScene,
    });
  }
  return buildInterrogationNodes({
    scene: record.ast,
    scope,
    entryPredecessors: input.entryPredecessors,
    firstScene: input.firstScene,
  });
}

function buildInvestigationNodes(input: {
  scene: ASTInvestigationScene;
  scope: SceneScope;
  entryPredecessors: string[];
  firstScene: boolean;
}): NodeDraft[] {
  const { scene, scope } = input;
  const nodes: NodeDraft[] = [];
  const entryKey = `${scope.prefix}/entry`;
  const entrySublocation = scene.sublocations.find(
    (sublocation) => sublocation.status === "unlocked",
  );
  const mandatoryAtoms = investigationMandatoryAtoms(scene, scope);
  const entryReveals = entrySublocation?.reveals ?? [];

  nodes.push(
    node({
      key: entryKey,
      requirement: "mandatory",
      legacyCompatibilityMode: revealsAreLegacy(entryReveals),
      initiallyReachable: input.firstScene,
      effects: effectsFromInvestigationReveals(entryReveals, scope),
      revealedTargetKeys: inboundTargetsFromInvestigationReveals(entryReveals),
      strictPredecessorKeys: input.entryPredecessors,
      inboundTargetKey: entrySublocation
        ? `sublocation:${entrySublocation.id}`
        : null,
      requiresInboundReveal: false,
      sourceFile: entrySublocation?.sourceFile ?? scene.sourceFile,
      line: entrySublocation?.line ?? scene.line,
    }),
  );

  for (const sublocation of scene.sublocations) {
    const isEntrySublocation = sublocation === entrySublocation;
    const regionId = `${scope.prefix}/${sublocation.id}`;
    const sublocationKey = isEntrySublocation
      ? entryKey
      : `${scope.prefix}/sublocation:${sublocation.id}`;
    const childKeys = [
      ...sublocation.hotspots.map(
        (hotspot) => `${scope.prefix}/hotspot:${hotspot.id}`,
      ),
      ...sublocation.characters.flatMap((character) =>
        character.topics.map(
          (topic) => `${scope.prefix}/topic:${character.id}@${topic.id}`,
        ),
      ),
    ];
    const hasMandatoryChild = childKeys.some((key) => {
      const atom = nodeCompletionAtom(key, scope);
      return atom !== null && mandatoryAtoms.has(atom);
    });

    if (!isEntrySublocation) {
      nodes.push(
        node({
          key: sublocationKey,
          requirement: hasMandatoryChild ? "mandatory" : "optional",
          legacyCompatibilityMode:
            expressionIsLegacy(sublocation.unlock) &&
            revealsAreLegacy(sublocation.reveals),
          initiallyReachable: sublocation.status === "unlocked",
          condition: normalizeInvestigationExpression(
            sublocation.unlock,
            scope,
          ),
          effects: effectsFromInvestigationReveals(sublocation.reveals, scope),
          revealedTargetKeys: inboundTargetsFromInvestigationReveals(
            sublocation.reveals,
          ),
          strictPredecessorKeys: [entryKey],
          inboundTargetKey: `sublocation:${sublocation.id}`,
          requiresInboundReveal: sublocation.status === "locked",
          sourceFile: sublocation.sourceFile,
          line: sublocation.line,
        }),
      );
    }

    for (const hotspot of sublocation.hotspots) {
      const key = `${scope.prefix}/hotspot:${hotspot.id}`;
      const completionAtom = investigationHotspotAtom(scope, hotspot.id);
      nodes.push(
        node({
          key,
          requirement: mandatoryAtoms.has(completionAtom)
            ? "mandatory"
            : "optional",
          legacyCompatibilityMode:
            expressionIsLegacy(hotspot.unlock) &&
            revealsAreLegacy(hotspot.reveals),
          initiallyReachable: hotspot.status === "unlocked",
          condition: normalizeInvestigationExpression(hotspot.unlock, scope),
          effects: [
            addAtomEffect(completionAtom, -1),
            ...effectsFromInvestigationReveals(hotspot.reveals, scope),
          ],
          revealedTargetKeys: inboundTargetsFromInvestigationReveals(
            hotspot.reveals,
          ),
          strictPredecessorKeys: [sublocationKey],
          freeOrderRegionId: regionId,
          inboundTargetKey: `hotspot:${hotspot.id}`,
          requiresInboundReveal: hotspot.status === "locked",
          sourceFile: hotspot.sourceFile,
          line: hotspot.line,
        }),
      );
    }

    for (const character of sublocation.characters) {
      for (const topic of character.topics) {
        const key = `${scope.prefix}/topic:${character.id}@${topic.id}`;
        const completionAtom = investigationTopicAtom(
          scope,
          character.id,
          topic.id,
        );
        nodes.push(
          node({
            key,
            requirement: mandatoryAtoms.has(completionAtom)
              ? "mandatory"
              : "optional",
            legacyCompatibilityMode:
              expressionIsLegacy(topic.unlock) &&
              revealsAreLegacy(topic.reveals),
            initiallyReachable: topic.status === "unlocked",
            condition: normalizeInvestigationExpression(topic.unlock, scope),
            effects: [
              addAtomEffect(completionAtom, -1),
              ...effectsFromInvestigationReveals(topic.reveals, scope),
            ],
            revealedTargetKeys: inboundTargetsFromInvestigationReveals(
              topic.reveals,
            ),
            strictPredecessorKeys: [sublocationKey],
            freeOrderRegionId: regionId,
            inboundTargetKey: `topic:${character.id}@${topic.id}`,
            requiresInboundReveal: topic.status === "locked",
            sourceFile: topic.sourceFile,
            line: topic.line,
          }),
        );
      }
    }
  }

  const outroCondition =
    scene.outro.unlock === "auto"
      ? null
      : normalizeInvestigationExpression(scene.outro.unlock, scope);
  nodes.push(
    node({
      key: `${scope.prefix}/outro`,
      requirement: "mandatory",
      legacyCompatibilityMode:
        scene.outro.unlock === "auto" || expressionIsLegacy(scene.outro.unlock),
      initiallyReachable: false,
      condition: outroCondition,
      implicitPrerequisites:
        scene.outro.unlock === "auto"
          ? [...mandatoryAtoms].map((atom) => ({
              predicate: "atom" as const,
              atom,
            }))
          : [],
      strictPredecessorKeys: [entryKey],
      sourceFile: scene.sourceFile,
      line: scene.line,
    }),
  );

  return nodes;
}

function buildInterrogationNodes(input: {
  scene: ASTInterrogationScene;
  scope: SceneScope;
  entryPredecessors: string[];
  firstScene: boolean;
}): NodeDraft[] {
  const { scene, scope } = input;
  const nodes: NodeDraft[] = [];
  const entryKey = `${scope.prefix}/entry`;
  nodes.push(
    node({
      key: entryKey,
      requirement: "mandatory",
      legacyCompatibilityMode: true,
      initiallyReachable: input.firstScene,
      strictPredecessorKeys: input.entryPredecessors,
      sourceFile: scene.sourceFile,
      line: scene.line,
    }),
  );

  for (const phase of scene.phases) {
    const phaseEntryKey = `${scope.prefix}/phase:${phase.id}:entry`;
    const phaseCompleteKey = `${scope.prefix}/phase:${phase.id}:complete`;
    const phaseAtom = interrogationPhaseAtom(scope, phase.id);

    nodes.push(
      node({
        key: phaseEntryKey,
        requirement: phase.required ? "mandatory" : "optional",
        legacyCompatibilityMode:
          expressionIsLegacy(phase.unlock) && revealsAreLegacy(phase.reveals),
        initiallyReachable: phase.status === "unlocked",
        condition: normalizeInterrogationExpression(phase.unlock, scope),
        effects: effectsFromInterrogationReveals(phase.reveals, scope),
        revealedTargetKeys: inboundTargetsFromInterrogationReveals(
          phase.reveals,
        ),
        strictPredecessorKeys: [entryKey],
        inboundTargetKey: `phase:${phase.id}`,
        requiresInboundReveal: phase.status === "locked",
        sourceFile: phase.sourceFile,
        line: phase.line,
      }),
    );

    for (const question of phase.questions) {
      const questionEntryKey = `${scope.prefix}/question:${question.id}:entry`;
      nodes.push(
        node({
          key: questionEntryKey,
          requirement:
            phase.required && question.required ? "mandatory" : "optional",
          legacyCompatibilityMode: expressionIsLegacy(question.unlock),
          initiallyReachable: question.status === "unlocked",
          condition: normalizeInterrogationExpression(question.unlock, scope),
          strictPredecessorKeys: [phaseEntryKey],
          freeOrderRegionId: `${scope.prefix}/phase:${phase.id}`,
          inboundTargetKey: `question:${question.id}`,
          requiresInboundReveal: question.status === "locked",
          sourceFile: question.sourceFile,
          line: question.line,
        }),
      );
      nodes.push(
        ...buildQuestionBreakthroughNodes({
          question,
          scope,
          questionEntryKey,
          mandatory: phase.required && question.required,
        }),
      );
    }

    const completionCondition =
      phase.complete === "auto"
        ? null
        : normalizeInterrogationExpression(phase.complete, scope);
    nodes.push(
      node({
        key: phaseCompleteKey,
        requirement: phase.required ? "mandatory" : "optional",
        legacyCompatibilityMode:
          phase.complete === "auto" || expressionIsLegacy(phase.complete),
        initiallyReachable: false,
        condition: completionCondition,
        implicitPrerequisites:
          phase.complete === "auto"
            ? phase.questions
                .filter((question) => question.required)
                .map((question) => ({
                  predicate: "atom" as const,
                  atom: interrogationQuestionAtom(scope, question.id),
                }))
            : [],
        effects: [addAtomEffect(phaseAtom, 0)],
        strictPredecessorKeys: [phaseEntryKey],
        sourceFile: phase.sourceFile,
        line: phase.line,
      }),
    );
  }

  const outroCondition =
    scene.outro.unlock === "auto"
      ? null
      : normalizeInterrogationExpression(scene.outro.unlock, scope);
  nodes.push(
    node({
      key: `${scope.prefix}/outro`,
      requirement: "mandatory",
      legacyCompatibilityMode:
        scene.outro.unlock === "auto" || expressionIsLegacy(scene.outro.unlock),
      initiallyReachable: false,
      condition: outroCondition,
      implicitPrerequisites:
        scene.outro.unlock === "auto"
          ? scene.phases
              .filter((phase) => phase.required)
              .map((phase) => ({
                predicate: "atom" as const,
                atom: interrogationPhaseAtom(scope, phase.id),
              }))
          : [],
      strictPredecessorKeys: [entryKey],
      sourceFile: scene.sourceFile,
      line: scene.line,
    }),
  );

  return nodes;
}

function buildQuestionBreakthroughNodes(input: {
  question: ASTInquiryQuestion;
  scope: SceneScope;
  questionEntryKey: string;
  mandatory: boolean;
}): NodeDraft[] {
  const { question, scope, questionEntryKey } = input;
  const questionAtom = interrogationQuestionAtom(scope, question.id);
  const correctLines = question.testimony.lines.filter(
    (line) => line.contradiction !== null && line.onCorrect !== null,
  );

  if (correctLines.length === 0) {
    return [
      node({
        key: `${scope.prefix}/question:${question.id}:breakthrough`,
        requirement: input.mandatory ? "mandatory" : "optional",
        legacyCompatibilityMode: revealsAreLegacy(question.reveals),
        initiallyReachable: false,
        effects: [
          ...effectsFromInterrogationReveals(question.reveals, scope),
          addAtomEffect(questionAtom, question.reveals.length),
        ],
        revealedTargetKeys: inboundTargetsFromInterrogationReveals(
          question.reveals,
        ),
        strictPredecessorKeys: [questionEntryKey],
        sourceFile: question.sourceFile,
        line: question.line,
      }),
    ];
  }

  return correctLines.map((line) => {
    const contradiction = line.contradiction!;
    const combinedTargetCount = line.reveals.length + question.reveals.length;
    return node({
      key: `${scope.prefix}/question:${question.id}:line:${line.id}:breakthrough`,
      requirement:
        input.mandatory && correctLines.length === 1 ? "mandatory" : "optional",
      legacyCompatibilityMode:
        revealsAreLegacy(line.reveals) && revealsAreLegacy(question.reveals),
      initiallyReachable: false,
      implicitPrerequisites: [
        {
          predicate: "atom",
          atom: `${contradiction.kind}:${contradiction.id}`,
        },
      ],
      effects: [
        ...effectsFromInterrogationReveals(line.reveals, scope),
        ...effectsFromInterrogationReveals(
          question.reveals,
          scope,
          line.reveals.length,
        ),
        addAtomEffect(questionAtom, combinedTargetCount),
      ],
      revealedTargetKeys: [
        ...inboundTargetsFromInterrogationReveals(line.reveals),
        ...inboundTargetsFromInterrogationReveals(question.reveals),
      ],
      strictPredecessorKeys: [questionEntryKey],
      sourceFile: line.sourceFile,
      line: line.line,
    });
  });
}

function node(
  input: Pick<
    NodeDraft,
    | "key"
    | "requirement"
    | "legacyCompatibilityMode"
    | "initiallyReachable"
    | "sourceFile"
    | "line"
  > &
    Partial<
      Pick<
        NodeDraft,
        | "condition"
        | "implicitPrerequisites"
        | "effects"
        | "strictPredecessorKeys"
        | "freeOrderRegionId"
        | "inboundTargetKey"
        | "revealedTargetKeys"
        | "requiresInboundReveal"
      >
    >,
): NodeDraft {
  return {
    condition: null,
    implicitPrerequisites: [],
    effects: [],
    representedAuthority: null,
    mayExecuteBeforeKeys: [],
    freeOrderRegionId: null,
    inboundTargetKey: null,
    revealedTargetKeys: [],
    requiresInboundReveal: false,
    ...input,
    strictPredecessorKeys: unique(input.strictPredecessorKeys ?? []),
  };
}

function addEffectAndRevealPredecessors(nodes: NodeDraft[]): void {
  const producersByAtom = new Map<string, string[]>();
  const nodesByInboundTarget = new Map<string, string>();

  for (const node of nodes) {
    if (node.inboundTargetKey !== null) {
      nodesByInboundTarget.set(
        `${scenePrefix(node.key)}:${node.inboundTargetKey}`,
        node.key,
      );
    }
    for (const effect of node.effects) {
      if (effect.kind !== "addAtom") continue;
      const producers = producersByAtom.get(effect.atom) ?? [];
      producers.push(node.key);
      producersByAtom.set(effect.atom, unique(producers));
    }
  }

  for (const source of nodes) {
    for (const localTarget of source.revealedTargetKeys) {
      const target = nodesByInboundTarget.get(
        `${scenePrefix(source.key)}:${localTarget}`,
      );
      if (target === undefined || target === source.key) continue;
      const targetNode = nodes.find((candidate) => candidate.key === target)!;
      if (!targetNode.requiresInboundReveal) continue;
      targetNode.strictPredecessorKeys = unique([
        ...targetNode.strictPredecessorKeys,
        source.key,
      ]);
    }
  }

  for (const target of nodes) {
    const prerequisites = [
      ...requiredExpressionPredicates(target.condition),
      ...target.implicitPrerequisites,
    ];
    for (const prerequisite of prerequisites) {
      const producers = producersByAtom.get(prerequisite.atom) ?? [];
      if (producers.length !== 1) continue;
      target.strictPredecessorKeys = unique([
        ...target.strictPredecessorKeys,
        producers[0]!,
      ]);
    }
  }
}

function addMayBeforeRelations(nodes: NodeDraft[]): void {
  const byRegion = new Map<string, NodeDraft[]>();
  for (const node of nodes) {
    if (node.freeOrderRegionId === null) continue;
    const members = byRegion.get(node.freeOrderRegionId) ?? [];
    members.push(node);
    byRegion.set(node.freeOrderRegionId, members);
  }

  const nodesByKey = new Map(nodes.map((node) => [node.key, node]));
  for (const members of byRegion.values()) {
    for (const node of members) {
      node.mayExecuteBeforeKeys = members
        .filter(
          (candidate) =>
            candidate !== node &&
            !dependsTransitivelyOn(candidate, node.key, nodesByKey, new Set()),
        )
        .map((candidate) => candidate.key);
    }
  }
}

function dependsTransitivelyOn(
  node: NodeDraft,
  predecessorKey: string,
  nodesByKey: ReadonlyMap<string, NodeDraft>,
  visited: Set<string>,
): boolean {
  if (node.strictPredecessorKeys.includes(predecessorKey)) return true;
  if (visited.has(node.key)) return false;
  visited.add(node.key);
  return node.strictPredecessorKeys.some((key) => {
    const predecessor = nodesByKey.get(key);
    return (
      predecessor !== undefined &&
      dependsTransitivelyOn(predecessor, predecessorKey, nodesByKey, visited)
    );
  });
}

function investigationMandatoryAtoms(
  scene: ASTInvestigationScene,
  scope: SceneScope,
): Set<string> {
  if (scene.outro.unlock === "auto") {
    return new Set([
      ...scene.sublocations.flatMap((sublocation) =>
        sublocation.hotspots.map((hotspot) =>
          investigationHotspotAtom(scope, hotspot.id),
        ),
      ),
      ...scene.sublocations.flatMap((sublocation) =>
        sublocation.characters.flatMap((character) =>
          character.topics.map((topic) =>
            investigationTopicAtom(scope, character.id, topic.id),
          ),
        ),
      ),
    ]);
  }
  return new Set(
    requiredExpressionPredicates(
      normalizeInvestigationExpression(scene.outro.unlock, scope),
    ).map((predicate) => predicate.atom),
  );
}

function normalizeInvestigationExpression(
  expression: ASTInvestigationScene["sublocations"][number]["unlock"],
  scope: SceneScope,
): PositiveExpression<ReachabilityPredicate> | null {
  if (expression === null) return null;
  return normalizeExpression(expression, (predicate) =>
    investigationPredicateAtom(predicate, scope),
  );
}

function normalizeInterrogationExpression(
  expression:
    | ASTInterrogationScene["phases"][number]["unlock"]
    | Exclude<ASTInterrogationScene["phases"][number]["complete"], "auto">,
  scope: SceneScope,
): PositiveExpression<ReachabilityPredicate> | null {
  if (expression === null) return null;
  return normalizeExpression(expression, (predicate) =>
    interrogationPredicateAtom(predicate, scope),
  );
}

function normalizeExpression<P extends object>(
  expression: PositiveExpression<P>,
  atomForPredicate: (predicate: P) => ReachabilityAtom,
): PositiveExpression<ReachabilityPredicate> {
  if ("op" in expression) {
    if (expression.op === "at_least") {
      return {
        op: "at_least",
        count: expression.count,
        conditions: expression.conditions.map((condition) =>
          normalizeExpression(condition, atomForPredicate),
        ),
      };
    }
    return {
      op: expression.op,
      left: normalizeExpression(expression.left, atomForPredicate),
      right: normalizeExpression(expression.right, atomForPredicate),
    };
  }
  return { predicate: "atom", atom: atomForPredicate(expression) };
}

function investigationPredicateAtom(
  predicate: Parameters<typeof isStoryPredicate>[0],
  scope: SceneScope,
): ReachabilityAtom {
  if (isStoryPredicate(predicate)) return storyPredicateAtom(predicate);
  switch (predicate.predicate) {
    case "evidence_collected":
      return `evidence:${predicate.id}`;
    case "statement_acquired":
      return `statement:${predicate.id}`;
    case "hotspot_investigated":
      return investigationHotspotAtom(scope, predicate.id);
    case "topic_discussed":
      return investigationTopicAtom(
        scope,
        predicate.characterId,
        predicate.topicId,
      );
    case "question_answered":
      return interrogationQuestionAtom(scope, predicate.id);
    case "phase_completed":
      return interrogationPhaseAtom(scope, predicate.id);
  }
}

function interrogationPredicateAtom(
  predicate: Parameters<typeof isStoryPredicate>[0],
  scope: SceneScope,
): ReachabilityAtom {
  return investigationPredicateAtom(predicate, scope);
}

function storyPredicateAtom(predicate: StoryPredicate): ReachabilityAtom {
  switch (predicate.predicate) {
    case "fact_asserted":
      return `fact_asserted:${predicate.id}`;
    case "question_resolved":
      return `question_resolved:${predicate.id}`;
    case "objective_completed":
      return `objective_completed:${predicate.id}`;
    case "authorization_granted":
      return `authorization_granted:${predicate.id}`;
    case "analysis_scene_completed":
      return `analysis_scene_completed:${predicate.chapterId}@${predicate.sceneId}`;
    case "analysis_board_completed":
      return `analysis_board_completed:${predicate.chapterId}@${predicate.sceneId}@${predicate.boardId}`;
  }
}

function effectsFromInvestigationReveals(
  reveals: InvestigationRevealTarget[],
  scope: SceneScope,
): ReachabilityEffect[] {
  return reveals.flatMap((target, targetIndex) => {
    if (isStoryRevealTarget(target)) {
      return [{ kind: "story", target, targetIndex }];
    }
    switch (target.kind) {
      case "evidence":
      case "statement":
        return [addAtomEffect(`${target.kind}:${target.id}`, targetIndex)];
      case "hotspot":
        return [
          addAtomEffect(
            investigationHotspotAtom(scope, target.id),
            targetIndex,
          ),
        ];
      case "topic":
        return [
          addAtomEffect(
            investigationTopicAtom(scope, target.characterId, target.topicId),
            targetIndex,
          ),
        ];
      case "sublocation":
        return [];
    }
  });
}

function effectsFromInterrogationReveals(
  reveals: InterrogationRevealTarget[],
  scope: SceneScope,
  targetIndexOffset = 0,
): ReachabilityEffect[] {
  return reveals.flatMap((target, targetIndex) => {
    const normalizedTargetIndex = targetIndex + targetIndexOffset;
    if (isStoryRevealTarget(target)) {
      return [{ kind: "story", target, targetIndex: normalizedTargetIndex }];
    }
    switch (target.kind) {
      case "evidence":
      case "statement":
        return [
          addAtomEffect(`${target.kind}:${target.id}`, normalizedTargetIndex),
        ];
      case "question":
        return [
          addAtomEffect(
            interrogationQuestionAtom(scope, target.id),
            normalizedTargetIndex,
          ),
        ];
      case "phase":
        return [
          addAtomEffect(
            interrogationPhaseAtom(scope, target.id),
            normalizedTargetIndex,
          ),
        ];
    }
  });
}

function inboundTargetsFromInvestigationReveals(
  reveals: InvestigationRevealTarget[],
): string[] {
  return reveals.flatMap((target) => {
    if (isStoryRevealTarget(target)) return [];
    switch (target.kind) {
      case "hotspot":
        return [`hotspot:${target.id}`];
      case "topic":
        return [`topic:${target.characterId}@${target.topicId}`];
      case "sublocation":
        return [`sublocation:${target.id}`];
      case "evidence":
      case "statement":
        return [];
    }
  });
}

function inboundTargetsFromInterrogationReveals(
  reveals: InterrogationRevealTarget[],
): string[] {
  return reveals.flatMap((target) => {
    if (isStoryRevealTarget(target)) return [];
    switch (target.kind) {
      case "question":
        return [`question:${target.id}`];
      case "phase":
        return [`phase:${target.id}`];
      case "evidence":
      case "statement":
        return [];
    }
  });
}

function addAtomEffect(
  atom: ReachabilityAtom,
  targetIndex: number,
): ReachabilityEffect {
  return { kind: "addAtom", atom, targetIndex };
}

function requiredExpressionPredicates(
  expression: PositiveExpression<ReachabilityPredicate> | null,
): ReachabilityPredicate[] {
  if (expression === null) return [];
  if (!("op" in expression)) return [expression];
  if (expression.op === "at_least") {
    const requiredChildCount =
      expression.conditions.length - expression.count + 1;
    const occurrences = new Map<string, number>();
    for (const condition of expression.conditions) {
      for (const predicate of requiredExpressionPredicates(condition)) {
        occurrences.set(
          predicate.atom,
          (occurrences.get(predicate.atom) ?? 0) + 1,
        );
      }
    }
    return [...occurrences].flatMap(([atom, occurrenceCount]) =>
      occurrenceCount >= requiredChildCount
        ? [{ predicate: "atom" as const, atom }]
        : [],
    );
  }
  if (expression.op === "and") {
    return uniquePredicates([
      ...requiredExpressionPredicates(expression.left),
      ...requiredExpressionPredicates(expression.right),
    ]);
  }
  const left = requiredExpressionPredicates(expression.left);
  const rightAtoms = new Set(
    requiredExpressionPredicates(expression.right).map(
      (predicate) => predicate.atom,
    ),
  );
  return left.filter((predicate) => rightAtoms.has(predicate.atom));
}

function expressionIsLegacy(
  expression: PositiveExpression<Parameters<typeof isStoryPredicate>[0]> | null,
): boolean {
  if (expression === null) return true;
  if ("op" in expression) {
    if (expression.op === "at_least") return false;
    return (
      expressionIsLegacy(expression.left) &&
      expressionIsLegacy(expression.right)
    );
  }
  return !isStoryPredicate(expression);
}

function revealsAreLegacy(
  reveals: Array<InvestigationRevealTarget | InterrogationRevealTarget>,
): boolean {
  return reveals.every((target) => !isStoryRevealTarget(target));
}

function investigationHotspotAtom(
  scope: SceneScope,
  id: string,
): ReachabilityAtom {
  return `hotspot:${scope.chapterId}@${scope.sceneId}@${id}`;
}

function investigationTopicAtom(
  scope: SceneScope,
  characterId: string,
  topicId: string,
): ReachabilityAtom {
  return `topic:${scope.chapterId}@${scope.sceneId}@${characterId}@${topicId}`;
}

function interrogationQuestionAtom(
  scope: SceneScope,
  id: string,
): ReachabilityAtom {
  return `question_answered:${scope.chapterId}@${scope.sceneId}@${id}`;
}

function interrogationPhaseAtom(
  scope: SceneScope,
  id: string,
): ReachabilityAtom {
  return `phase_completed:${scope.chapterId}@${scope.sceneId}@${id}`;
}

function nodeCompletionAtom(
  key: string,
  scope: SceneScope,
): ReachabilityAtom | null {
  const suffix = key.slice(scope.prefix.length + 1);
  if (suffix.startsWith("hotspot:")) {
    return investigationHotspotAtom(scope, suffix.slice("hotspot:".length));
  }
  if (suffix.startsWith("topic:")) {
    const [characterId, topicId] = suffix.slice("topic:".length).split("@");
    if (characterId !== undefined && topicId !== undefined) {
      return investigationTopicAtom(scope, characterId, topicId);
    }
  }
  return null;
}

function sceneScope(record: SceneRecord): SceneScope {
  return {
    chapterId: record.chapterId,
    sceneId: record.ast.id,
    prefix: `${record.chapterId}/${record.ast.id}`,
  };
}

function scenePrefix(nodeKey: string): string {
  return nodeKey.split("/").slice(0, 2).join("/");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniquePredicates(
  predicates: ReachabilityPredicate[],
): ReachabilityPredicate[] {
  const atoms = new Set<string>();
  return predicates.filter((predicate) => {
    if (atoms.has(predicate.atom)) return false;
    atoms.add(predicate.atom);
    return true;
  });
}
