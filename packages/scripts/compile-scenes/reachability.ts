import type { AnalysisDefinitionRegistry } from "./analysis-definition-registry";
import type {
  ASTChapter,
  AnalysisSceneRecord,
  CompileError,
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
import type { NormalizedAnalysisScene } from "./validator-analysis";
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
  /**
   * Durable runtime trigger identity. Distinct nodes with the same value are
   * mutually exclusive outcomes of one one-shot event; analysis may commit at
   * most one of them.
   */
  oneShotEventId: string;
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

export type ReachabilityDiagnostic = CompileError & {
  nodeKey: string;
  targetIndex: number | null;
};

export type PrimaryCandidate = string | null;

export type MustActivePrimary =
  | { kind: "uninitialized" }
  | { kind: "known"; id: PrimaryCandidate }
  | { kind: "unknown" };

type NodeAbstractState = {
  mayAtoms: Set<ReachabilityAtom>;
  mustAtoms: Set<ReachabilityAtom>;
  mayActivePrimaryIds: Set<PrimaryCandidate>;
  mustActivePrimary: MustActivePrimary;
  mayCompletedPrimaryIds: Set<string>;
  mustCompletedPrimaryIds: Set<string>;
  orderAmbiguous: boolean;
};

export type ReachabilityAnalysis = {
  producerKeysByAtom: ReadonlyMap<ReachabilityAtom, readonly string[]>;
  reachableNodeKeys: Set<string>;
  mustReachableNodeKeys: Set<string>;
  mayAtoms: Set<ReachabilityAtom>;
  mustAtoms: Set<ReachabilityAtom>;
  mayActivePrimaryIds: Set<PrimaryCandidate>;
  mustActivePrimary: MustActivePrimary;
  mayCompletedPrimaryIds: Set<string>;
  mustCompletedPrimaryIds: Set<string>;
  errors: ReachabilityDiagnostic[];
  warnings: ReachabilityDiagnostic[];
};

export function evaluateMay(
  expression: PositiveExpression<ReachabilityPredicate>,
  atoms: ReadonlySet<ReachabilityAtom>,
): boolean {
  return evaluatePositive(expression, atoms);
}

export function evaluateMust(
  expression: PositiveExpression<ReachabilityPredicate>,
  atoms: ReadonlySet<ReachabilityAtom>,
): boolean {
  return evaluatePositive(expression, atoms);
}

export function analyzeReachability(input: {
  nodes: ReachabilityNode[];
  catalog: ASTStoryCatalog;
}): ReachabilityAnalysis {
  const nodes = [...input.nodes].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  const producerKeysByAtom = buildAnalysisProducerIndex(nodes, input.catalog);
  const authorizationDefinitions = new Map(
    input.catalog.authorizations.map((definition) => [
      definition.id,
      definition,
    ]),
  );

  const exclusiveOutcome = exclusiveOutcomeSelections(nodes);
  // When the Cartesian product of one-shot alternatives exceeds SCENARIO_LIMIT,
  // the enumerator stops before assigning the remaining one-shot groups. An
  // absent selection entry means NO alternative is filtered out (see
  // solveJointScenario), so every alternative of each unassigned group would
  // execute together in the same scenario. That violates the runtime
  // one-shot mutual-exclusion contract and can publish impossible combinations
  // (e.g. a conjunction of two atoms that only distinct alternatives of the
  // same event produce). Rather than emit unsound partial reachability, fail
  // the compile: the author must reduce one-shot fan-out and recompile, at
  // which point the full fixpoint runs.
  if (exclusiveOutcome.overflowed && nodes.length > 0) {
    const overflowError: ReachabilityDiagnostic = diagnostic(
      nodes[0]!,
      "scenarioLimitExceeded",
      `Reachability scenario enumeration exceeded the limit of ${exclusiveOutcome.limit} ` +
        `joint scenarios (enumerated ${exclusiveOutcome.enumeratedCount} before stopping). ` +
        `One-shot mutual exclusion is not preserved across the unenumerated alternatives, ` +
        `so reachability results would be unsound. Reduce one-shot event fan-out (e.g. merge ` +
        `interrogation testimony-line reveals that each carry distinct one-shot events, or ` +
        `split the chapter) and recompile.`,
    );
    return {
      producerKeysByAtom,
      reachableNodeKeys: new Set(),
      mustReachableNodeKeys: new Set(),
      mayAtoms: new Set(),
      mustAtoms: new Set(),
      mayActivePrimaryIds: new Set(),
      mustActivePrimary: { kind: "uninitialized" },
      mayCompletedPrimaryIds: new Set(),
      mustCompletedPrimaryIds: new Set(),
      errors: [overflowError],
      warnings: [],
    };
  }
  const exclusiveSelections = exclusiveOutcome.selections;

  const scenarios: JointScenario[] = [];
  for (const selection of exclusiveSelections) {
    scenarios.push(
      solveJointScenario({
        nodes,
        selection,
        catalog: input.catalog,
        producerKeysByAtom,
      }),
    );
  }

  const reachableNodeKeys = new Set<string>();
  const mayAtoms = new Set<ReachabilityAtom>();
  const mayActivePrimaryIds = new Set<PrimaryCandidate>();
  const mayCompletedPrimaryIds = new Set<string>();
  for (const scenario of scenarios) {
    addAll(reachableNodeKeys, scenario.reachableNodeKeys);
    addAll(mayAtoms, scenario.mayAtoms);
    addAll(mayActivePrimaryIds, scenario.mayActivePrimaryIds);
    addAll(mayCompletedPrimaryIds, scenario.mayCompletedPrimaryIds);
  }

  const observedProducerKeysByAtom = buildObservedProducerIndex(
    nodes,
    scenarios,
  );
  const dependencyEdges = buildPositiveDependencyEdges(
    nodes,
    observedProducerKeysByAtom,
  );
  const cycleDiagnostics = positiveCycleDiagnostics(nodes, dependencyEdges);
  const cycleNodeKeys = new Set(
    stronglyConnectedComponents(nodes, dependencyEdges)
      .filter(
        (component) =>
          component.length > 1 ||
          (component.length === 1 &&
            (dependencyEdges.get(component[0]!) ?? []).includes(component[0]!)),
      )
      .flat(),
  );

  const mustNodes = mandatoryScenarioNodes(nodes);
  const mustScenarios = exclusiveSelections.map((selection) =>
    solveJointScenario({
      nodes: mustNodes,
      selection,
      catalog: input.catalog,
      producerKeysByAtom,
    }),
  );
  const mustReachableNodeKeys = intersectScenarioOutputKeys(mustScenarios);
  const mustAtoms = intersectScenarioAtoms(mustScenarios, "mustAtoms");
  const primaryObjectiveIds = new Set(
    input.catalog.objectives
      .filter((objective) => objective.kind === "primary")
      .map((objective) => objective.id),
  );
  const mustCompletedPrimaryIds = completedPrimaryIds(
    mustAtoms,
    primaryObjectiveIds,
  );
  const mustActivePrimary = mustActiveAcrossScenarios(mustNodes, mustScenarios);

  const errors = [...cycleDiagnostics];
  const warnings: ReachabilityDiagnostic[] = [];
  for (const scenario of scenarios) {
    for (const error of scenario.errors) pushDiagnostic(errors, error);
    for (const warning of scenario.warnings) pushDiagnostic(warnings, warning);
  }

  for (const node of nodes) {
    if (cycleNodeKeys.has(node.key) || node.legacyCompatibilityMode) {
      continue;
    }
    if (node.requirement === "optional") {
      if (!reachableNodeKeys.has(node.key)) {
        warnings.push(
          diagnostic(
            node,
            "optionalContentUnreachable",
            `Optional content "${node.key}" is unreachable.`,
          ),
        );
      }
      continue;
    }
    // Required node: must-reachable means guaranteed on every path.
    if (mustReachableNodeKeys.has(node.key)) continue;
    // Required node is not must-reachable — either unreachable at all, or
    // only may-reachable (some path reaches it, another does not). Check
    // whether the cause is an unguaranteed authorization grant before
    // falling back to the generic unreachable diagnostic.
    const authorizationFailure = mandatoryAuthorizationFailure({
      nodes,
      node,
      reachableNodeKeys,
      mustReachableNodeKeys,
      mustAtoms,
      authorizationDefinitions,
    });
    if (authorizationFailure !== null) {
      errors.push(authorizationFailure);
      continue;
    }
    if (!reachableNodeKeys.has(node.key)) {
      errors.push(
        diagnostic(
          node,
          "requiredContentUnreachable",
          `Required content "${node.key}" is unreachable.`,
        ),
      );
    }
    // else: may-reachable but not must-reachable for a non-authorization
    // reason — not flagged here (broader reachability redesign needed).
  }

  return {
    producerKeysByAtom,
    reachableNodeKeys,
    mustReachableNodeKeys,
    mayAtoms,
    mustAtoms,
    mayActivePrimaryIds,
    mustActivePrimary,
    mayCompletedPrimaryIds,
    mustCompletedPrimaryIds,
    errors,
    warnings,
  };
}

export function buildPositiveProducerIndex(
  nodes: readonly ReachabilityNode[],
): ReadonlyMap<ReachabilityAtom, readonly string[]> {
  const mutable = new Map<ReachabilityAtom, string[]>();
  for (const node of [...nodes].sort((left, right) =>
    left.key.localeCompare(right.key),
  )) {
    for (const atom of potentialEffectAtoms(node)) {
      const producers = mutable.get(atom) ?? [];
      if (!producers.includes(node.key)) producers.push(node.key);
      mutable.set(atom, producers);
    }
  }
  return new Map(
    [...mutable].map(([atom, producerKeys]) => [
      atom,
      producerKeys.sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

function buildAnalysisProducerIndex(
  nodes: readonly ReachabilityNode[],
  catalog: ASTStoryCatalog,
): ReadonlyMap<ReachabilityAtom, readonly string[]> {
  const mutable = new Map<string, string[]>(
    [...buildPositiveProducerIndex(nodes)].map(([atom, keys]) => [
      atom,
      [...keys],
    ]),
  );
  const primaryIds = catalog.objectives
    .filter((objective) => objective.kind === "primary")
    .map((objective) => objective.id)
    .sort((left, right) => left.localeCompare(right));
  for (const node of nodes) {
    if (
      !node.effects.some(
        (effect) =>
          effect.kind === "story" &&
          effect.target.kind === "setPrimaryObjective" &&
          effect.target.completeCurrent,
      )
    ) {
      continue;
    }
    for (const primaryId of primaryIds) {
      const atom = `objective_completed:${primaryId}`;
      const producers = mutable.get(atom) ?? [];
      if (!producers.includes(node.key)) producers.push(node.key);
      mutable.set(atom, producers);
    }
  }
  return new Map(
    [...mutable]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([atom, keys]) => [
        atom,
        keys.sort((left, right) => left.localeCompare(right)),
      ]),
  );
}

function buildObservedProducerIndex(
  nodes: readonly ReachabilityNode[],
  scenarios: readonly JointScenario[],
): ReadonlyMap<ReachabilityAtom, readonly string[]> {
  const mutable = new Map<ReachabilityAtom, string[]>(
    [...buildPositiveProducerIndex(nodes)].map(([atom, keys]) => [
      atom,
      [...keys],
    ]),
  );
  for (const scenario of scenarios) {
    for (const [nodeKey, atoms] of scenario.producedAtomsByNodeKey) {
      for (const atom of atoms) {
        const producers = mutable.get(atom) ?? [];
        if (!producers.includes(nodeKey)) producers.push(nodeKey);
        mutable.set(atom, producers);
      }
    }
  }
  return new Map(
    [...mutable]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([atom, keys]) => [
        atom,
        keys.sort((left, right) => left.localeCompare(right)),
      ]),
  );
}

function buildScenarioProducerIndex(
  scenario: JointScenario,
): ReadonlyMap<ReachabilityAtom, readonly string[]> {
  const mutable = new Map<ReachabilityAtom, string[]>();
  for (const [nodeKey, atoms] of scenario.producedAtomsByNodeKey) {
    for (const atom of atoms) {
      const producers = mutable.get(atom) ?? [];
      producers.push(nodeKey);
      mutable.set(atom, producers);
    }
  }
  return new Map(
    [...mutable]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([atom, keys]) => [
        atom,
        keys.sort((left, right) => left.localeCompare(right)),
      ]),
  );
}

function evaluatePositive(
  expression: PositiveExpression<ReachabilityPredicate>,
  atoms: ReadonlySet<ReachabilityAtom>,
): boolean {
  if (!("op" in expression)) return atoms.has(expression.atom);
  if (expression.op === "at_least") {
    let satisfied = 0;
    for (const condition of expression.conditions) {
      if (evaluatePositive(condition, atoms)) satisfied += 1;
      if (satisfied >= expression.count) return true;
    }
    return false;
  }
  if (expression.op === "and") {
    return (
      evaluatePositive(expression.left, atoms) &&
      evaluatePositive(expression.right, atoms)
    );
  }
  return (
    evaluatePositive(expression.left, atoms) ||
    evaluatePositive(expression.right, atoms)
  );
}

function buildPositiveDependencyEdges(
  nodes: readonly ReachabilityNode[],
  producerKeysByAtom: ReadonlyMap<ReachabilityAtom, readonly string[]>,
): Map<string, string[]> {
  const edges = new Map(
    nodes.map((node) => [node.key, [] as string[]] as const),
  );
  for (const consumer of nodes) {
    const prerequisites = uniquePredicates([
      ...expressionPredicates(consumer.condition),
      ...consumer.implicitPrerequisites,
    ]);
    for (const prerequisite of prerequisites) {
      for (const producerKey of producerKeysByAtom.get(prerequisite.atom) ??
        []) {
        const consumers = edges.get(producerKey);
        if (consumers === undefined || consumers.includes(consumer.key))
          continue;
        consumers.push(consumer.key);
      }
    }
  }
  for (const consumers of edges.values()) {
    consumers.sort((left, right) => left.localeCompare(right));
  }
  return edges;
}

function buildCausalDependencyEdges(
  nodes: readonly ReachabilityNode[],
  producerKeysByAtom: ReadonlyMap<ReachabilityAtom, readonly string[]>,
): Map<string, string[]> {
  const edges = buildPositiveDependencyEdges(nodes, producerKeysByAtom);
  for (const node of nodes) {
    for (const predecessorKey of node.strictPredecessorKeys) {
      const successors = edges.get(predecessorKey);
      if (successors !== undefined && !successors.includes(node.key)) {
        successors.push(node.key);
      }
    }
  }
  for (const successors of edges.values()) {
    successors.sort((left, right) => left.localeCompare(right));
  }
  return edges;
}

function positiveCycleDiagnostics(
  nodes: readonly ReachabilityNode[],
  edges: ReadonlyMap<string, readonly string[]>,
): ReachabilityDiagnostic[] {
  const nodesByKey = new Map(nodes.map((node) => [node.key, node]));
  return stronglyConnectedComponents(nodes, edges)
    .flatMap((component) => {
      const selfLoop =
        component.length === 1 &&
        (edges.get(component[0]!) ?? []).includes(component[0]!);
      if (component.length === 1 && !selfLoop) return [];
      if (
        component.every((key) => nodesByKey.get(key)!.legacyCompatibilityMode)
      ) {
        return [];
      }
      const node = nodesByKey.get(component[0]!)!;
      if (selfLoop) {
        return [
          diagnostic(
            node,
            "positiveSelfReference",
            `Positive dependency for "${node.key}" refers to an atom produced by the same node.`,
          ),
        ];
      }
      const path = stableMinimalCycle(component, edges);
      return [
        diagnostic(
          node,
          "positiveDependencyCycle",
          `Positive dependency cycle: ${path.join(" -> ")}.`,
        ),
      ];
    })
    .sort((left, right) => left.nodeKey.localeCompare(right.nodeKey));
}

function stronglyConnectedComponents(
  nodes: readonly ReachabilityNode[],
  edges: ReadonlyMap<string, readonly string[]>,
): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (key: string): void => {
    indexes.set(key, nextIndex);
    lowLinks.set(key, nextIndex);
    nextIndex += 1;
    stack.push(key);
    onStack.add(key);

    for (const consumerKey of edges.get(key) ?? []) {
      if (!indexes.has(consumerKey)) {
        visit(consumerKey);
        lowLinks.set(
          key,
          Math.min(lowLinks.get(key)!, lowLinks.get(consumerKey)!),
        );
      } else if (onStack.has(consumerKey)) {
        lowLinks.set(
          key,
          Math.min(lowLinks.get(key)!, indexes.get(consumerKey)!),
        );
      }
    }

    if (lowLinks.get(key) !== indexes.get(key)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === key) break;
    }
    component.sort((left, right) => left.localeCompare(right));
    components.push(component);
  };

  for (const node of [...nodes].sort((left, right) =>
    left.key.localeCompare(right.key),
  )) {
    if (!indexes.has(node.key)) visit(node.key);
  }
  return components.sort((left, right) => left[0]!.localeCompare(right[0]!));
}

function stableMinimalCycle(
  component: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): string[] {
  const start = component[0]!;
  const members = new Set(component);
  const queue: string[][] = [[start]];
  while (queue.length > 0) {
    const path = queue.shift()!;
    const tail = path[path.length - 1]!;
    for (const next of edges.get(tail) ?? []) {
      if (!members.has(next)) continue;
      if (next === start && path.length > 1) return [...path, start];
      if (!path.includes(next)) queue.push([...path, next]);
    }
  }
  return [...component, start];
}

/**
 * Hard cap on the number of joint scenarios the reachability analysis will
 * enumerate. The Cartesian product of one-shot-event alternatives grows as
 * 2^N (each event with 2+ mutually-exclusive outcomes doubles the space),
 * and `analyzeReachability` solves the full joint fixpoint twice (once for
 * `may` and once for `must`). Beyond this cap the cost is prohibitive and
 * almost always indicates a structural mistake (e.g. many independent
 * interrogation questions whose testimony lines each carry distinct
 * one-shot reveal events). When the cap is hit we stop expanding and fail the
 * compile with a `scenarioLimitExceeded` error. We do NOT solve the enumerated
 * subset: the unenumerated one-shot groups would have no selection entry, so
 * their alternatives would run together and violate the runtime mutual-
 * exclusion contract. The author must refactor (split the chapter, reduce
 * one-shot fan-out, or merge events) and recompile instead of waiting on an
 * exponential compile.
 */
const SCENARIO_LIMIT = 4096;

type ExclusiveOutcomeSelections = {
  selections: Array<ReadonlyMap<string, string>>;
  overflowed: boolean;
  limit: number;
  enumeratedCount: number;
};

function exclusiveOutcomeSelections(
  nodes: readonly ReachabilityNode[],
): ExclusiveOutcomeSelections {
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const members = groups.get(node.oneShotEventId) ?? [];
    members.push(node.key);
    groups.set(node.oneShotEventId, members);
  }
  const alternatives = [...groups]
    .filter(([, members]) => members.length > 1)
    .map(([eventId, members]) => ({
      eventId,
      members: members.sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
  if (alternatives.length === 0) {
    return {
      selections: [new Map()],
      overflowed: false,
      limit: SCENARIO_LIMIT,
      enumeratedCount: 1,
    };
  }

  let selections: Array<Map<string, string>> = [new Map()];
  let overflowed = false;
  for (const alternative of alternatives) {
    const nextCount = selections.length * alternative.members.length;
    if (nextCount > SCENARIO_LIMIT) {
      overflowed = true;
      break;
    }
    selections = selections.flatMap((selection) =>
      alternative.members.map((member) => {
        const next = new Map(selection);
        next.set(alternative.eventId, member);
        return next;
      }),
    );
  }
  return {
    selections,
    overflowed,
    limit: SCENARIO_LIMIT,
    enumeratedCount: selections.length,
  };
}

type JointScenario = {
  reachableNodeKeys: Set<string>;
  outputsByNodeKey: Map<string, NodeAbstractState>;
  producedAtomsByNodeKey: Map<string, Set<ReachabilityAtom>>;
  mayAtoms: Set<ReachabilityAtom>;
  mayActivePrimaryIds: Set<PrimaryCandidate>;
  mayCompletedPrimaryIds: Set<string>;
  errors: ReachabilityDiagnostic[];
  warnings: ReachabilityDiagnostic[];
};

type BatchTransfer = {
  state: NodeAbstractState | null;
  errors: ReachabilityDiagnostic[];
  warnings: ReachabilityDiagnostic[];
};

function solveJointScenario(input: {
  nodes: readonly ReachabilityNode[];
  selection: ReadonlyMap<string, string>;
  catalog: ASTStoryCatalog;
  producerKeysByAtom: ReadonlyMap<ReachabilityAtom, readonly string[]>;
}): JointScenario {
  const nodesByKey = new Map(input.nodes.map((node) => [node.key, node]));
  const authorizationDefinitions = new Map(
    input.catalog.authorizations.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const primaryObjectiveIds = new Set(
    input.catalog.objectives
      .filter((objective) => objective.kind === "primary")
      .map((objective) => objective.id),
  );
  const reachableNodeKeys = new Set<string>();
  const outputsByNodeKey = new Map<string, NodeAbstractState>();
  const producedAtomsByNodeKey = new Map<string, Set<ReachabilityAtom>>();

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of input.nodes) {
      const selected = input.selection.get(node.oneShotEventId);
      if (selected !== undefined && selected !== node.key) continue;

      const before = stateBeforeNode({
        node,
        nodes: input.nodes,
        nodesByKey,
        reachableNodeKeys,
        outputsByNodeKey,
        producedAtomsByNodeKey,
        selection: input.selection,
        producerKeysByAtom: input.producerKeysByAtom,
        primaryObjectiveIds,
        authorizationDefinitions,
      });
      const successfulNodeKeys = new Set(outputsByNodeKey.keys());
      if (!nodeMayExecute(node, successfulNodeKeys, before.mayAtoms)) continue;
      if (!reachableNodeKeys.has(node.key)) {
        reachableNodeKeys.add(node.key);
        changed = true;
      }

      const transferred = transferBatch({
        node,
        input: before,
        primaryObjectiveIds,
        authorizationDefinitions,
        diagnostics: false,
      });
      if (transferred.state === null) continue;
      const producedAtoms = producedAtomsByNodeKey.get(node.key) ?? new Set();
      const previousProducedCount = producedAtoms.size;
      addAll(
        producedAtoms,
        setDifference(transferred.state.mayAtoms, before.mayAtoms),
      );
      producedAtomsByNodeKey.set(node.key, producedAtoms);
      if (producedAtoms.size !== previousProducedCount) changed = true;
      const previous = outputsByNodeKey.get(node.key);
      const next = publishState(previous, transferred.state);
      if (previous === undefined || !statesEqual(previous, next)) {
        outputsByNodeKey.set(node.key, next);
        changed = true;
      }
    }
  }

  const errors: ReachabilityDiagnostic[] = [];
  const warnings: ReachabilityDiagnostic[] = [];
  for (const node of input.nodes) {
    if (!reachableNodeKeys.has(node.key)) continue;
    const selected = input.selection.get(node.oneShotEventId);
    if (selected !== undefined && selected !== node.key) continue;
    const before = stateBeforeNode({
      node,
      nodes: input.nodes,
      nodesByKey,
      reachableNodeKeys,
      outputsByNodeKey,
      producedAtomsByNodeKey,
      selection: input.selection,
      producerKeysByAtom: input.producerKeysByAtom,
      primaryObjectiveIds,
      authorizationDefinitions,
    });
    const transferred = transferBatch({
      node,
      input: before,
      primaryObjectiveIds,
      authorizationDefinitions,
      diagnostics: !node.legacyCompatibilityMode,
    });
    for (const error of transferred.errors) pushDiagnostic(errors, error);
    for (const warning of transferred.warnings)
      pushDiagnostic(warnings, warning);
  }

  const mayAtoms = new Set<ReachabilityAtom>();
  const mayActivePrimaryIds = new Set<PrimaryCandidate>();
  const mayCompletedPrimaryIds = new Set<string>();
  for (const state of outputsByNodeKey.values()) {
    addAll(mayAtoms, state.mayAtoms);
    addAll(mayActivePrimaryIds, state.mayActivePrimaryIds);
    addAll(mayCompletedPrimaryIds, state.mayCompletedPrimaryIds);
  }
  return {
    reachableNodeKeys,
    outputsByNodeKey,
    producedAtomsByNodeKey,
    mayAtoms,
    mayActivePrimaryIds,
    mayCompletedPrimaryIds,
    errors,
    warnings,
  };
}

function stateBeforeNode(input: {
  node: ReachabilityNode;
  nodes: readonly ReachabilityNode[];
  nodesByKey: ReadonlyMap<string, ReachabilityNode>;
  reachableNodeKeys: ReadonlySet<string>;
  outputsByNodeKey: ReadonlyMap<string, NodeAbstractState>;
  producedAtomsByNodeKey: ReadonlyMap<string, ReadonlySet<ReachabilityAtom>>;
  selection: ReadonlyMap<string, string>;
  producerKeysByAtom: ReadonlyMap<ReachabilityAtom, readonly string[]>;
  primaryObjectiveIds: ReadonlySet<string>;
  authorizationDefinitions: ReadonlyMap<
    string,
    ASTStoryCatalog["authorizations"][number]
  >;
}): NodeAbstractState {
  const entryStates: NodeAbstractState[] = [];
  for (const predecessorKey of input.node.strictPredecessorKeys) {
    const predecessor = input.outputsByNodeKey.get(predecessorKey);
    if (predecessor !== undefined) entryStates.push(predecessor);
  }

  const prerequisiteAtoms = unique(
    [
      ...expressionPredicates(input.node.condition),
      ...input.node.implicitPrerequisites,
    ].map((predicate) => predicate.atom),
  );
  for (const atom of prerequisiteAtoms) {
    for (const producerKey of input.producerKeysByAtom.get(atom) ?? []) {
      const state = input.outputsByNodeKey.get(producerKey);
      if (
        producerKey !== input.node.key &&
        input.producedAtomsByNodeKey.get(producerKey)?.has(atom) === true &&
        state !== undefined &&
        state.mayAtoms.has(atom) &&
        !entryStates.includes(state)
      ) {
        entryStates.push(state);
      }
    }
  }

  const entry =
    entryStates.length === 0
      ? initialAbstractState()
      : joinInputStates(entryStates);
  const peerKeys = unique(input.node.mayExecuteBeforeKeys)
    .filter((key) => key !== input.node.key)
    .filter((key) => input.reachableNodeKeys.has(key))
    .filter((key) => {
      const peer = input.nodesByKey.get(key);
      if (peer === undefined) return false;
      const selected = input.selection.get(peer.oneShotEventId);
      return selected === undefined || selected === peer.key;
    })
    .sort((left, right) => left.localeCompare(right));
  if (peerKeys.length === 0) {
    refineMustForSatisfiedRequirements(
      entry,
      input.node,
      input.primaryObjectiveIds,
    );
    return entry;
  }

  const contributions = new Map<string, NodeAbstractState>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const peerKey of peerKeys) {
      const peer = input.nodesByKey.get(peerKey)!;
      const peerContributions = peerKeys.flatMap((otherKey) => {
        // A strict successor cannot execute before its predecessor. Excluding
        // it here also prevents predecessor -> successor -> predecessor replay.
        if (
          otherKey === peerKey ||
          strictlyDependsOn(otherKey, peerKey, input.nodesByKey)
        ) {
          return [];
        }
        const contribution = contributions.get(otherKey);
        return contribution === undefined ? [] : [contribution];
      });
      const peerInput = applyPeerContributions(entry, peerContributions);
      const transferred = transferBatch({
        node: peer,
        input: peerInput,
        primaryObjectiveIds: input.primaryObjectiveIds,
        authorizationDefinitions: input.authorizationDefinitions,
        diagnostics: false,
      });
      if (transferred.state === null) continue;
      const computed = peerContribution(peerInput, transferred.state);
      const previous = contributions.get(peerKey);
      const next = publishPeerContribution(previous, computed);
      if (previous === undefined || !statesEqual(previous, next)) {
        contributions.set(peerKey, next);
        changed = true;
      }
    }
  }

  const before = applyPeerContributions(entry, [...contributions.values()]);
  before.orderAmbiguous ||= contributions.size > 1;
  refineMustForSatisfiedRequirements(
    before,
    input.node,
    input.primaryObjectiveIds,
  );
  synchronizeCompletionAtoms(before);
  return before;
}

function peerContribution(
  input: NodeAbstractState,
  output: NodeAbstractState,
): NodeAbstractState {
  // Store only progress caused by this one-shot member. Carrying its complete
  // input state would let another member return inherited progress to it.
  return {
    mayAtoms: setDifference(output.mayAtoms, input.mayAtoms),
    mustAtoms: new Set(),
    mayActivePrimaryIds: setsEqual(
      output.mayActivePrimaryIds,
      input.mayActivePrimaryIds,
    )
      ? new Set()
      : new Set(output.mayActivePrimaryIds),
    mustActivePrimary: { kind: "uninitialized" },
    mayCompletedPrimaryIds: setDifference(
      output.mayCompletedPrimaryIds,
      input.mayCompletedPrimaryIds,
    ),
    mustCompletedPrimaryIds: new Set(),
    orderAmbiguous: output.orderAmbiguous,
  };
}

function publishPeerContribution(
  previous: NodeAbstractState | undefined,
  computed: NodeAbstractState,
): NodeAbstractState {
  if (previous === undefined) return cloneState(computed);
  const next = cloneState(previous);
  addAll(next.mayAtoms, computed.mayAtoms);
  addAll(next.mayActivePrimaryIds, computed.mayActivePrimaryIds);
  addAll(next.mayCompletedPrimaryIds, computed.mayCompletedPrimaryIds);
  next.orderAmbiguous ||= computed.orderAmbiguous;
  return next;
}

function applyPeerContributions(
  entry: NodeAbstractState,
  contributions: readonly NodeAbstractState[],
): NodeAbstractState {
  const state = cloneState(entry);
  let primaryCanChange = false;
  for (const contribution of contributions) {
    addAll(state.mayAtoms, contribution.mayAtoms);
    addAll(state.mayCompletedPrimaryIds, contribution.mayCompletedPrimaryIds);
    if (contribution.mayActivePrimaryIds.size > 0) {
      addAll(state.mayActivePrimaryIds, contribution.mayActivePrimaryIds);
      primaryCanChange = true;
    }
    state.orderAmbiguous ||= contribution.orderAmbiguous;
  }
  if (primaryCanChange) state.mustActivePrimary = { kind: "unknown" };
  synchronizeCompletionAtoms(state);
  return state;
}

function strictlyDependsOn(
  candidateKey: string,
  predecessorKey: string,
  nodesByKey: ReadonlyMap<string, ReachabilityNode>,
  visited = new Set<string>(),
): boolean {
  const candidate = nodesByKey.get(candidateKey);
  if (candidate === undefined || visited.has(candidateKey)) return false;
  if (candidate.strictPredecessorKeys.includes(predecessorKey)) return true;
  visited.add(candidateKey);
  return candidate.strictPredecessorKeys.some((key) =>
    strictlyDependsOn(key, predecessorKey, nodesByKey, visited),
  );
}

function refineMustForSatisfiedRequirements(
  state: NodeAbstractState,
  node: ReachabilityNode,
  primaryObjectiveIds: ReadonlySet<string>,
): void {
  const requiredAtoms = [...node.implicitPrerequisites]
    .map((predicate) => predicate.atom)
    .filter((atom) => state.mayAtoms.has(atom));
  if (node.condition !== null && evaluateMay(node.condition, state.mayAtoms)) {
    // An atom is guaranteed on every currently modeled satisfying input when
    // removing it makes the complete positive expression false.
    for (const predicate of expressionPredicates(node.condition)) {
      if (!state.mayAtoms.has(predicate.atom)) continue;
      const withoutCandidate = new Set(state.mayAtoms);
      withoutCandidate.delete(predicate.atom);
      if (!evaluateMay(node.condition, withoutCandidate)) {
        requiredAtoms.push(predicate.atom);
      }
    }
  }

  for (const atom of unique(requiredAtoms)) {
    state.mustAtoms.add(atom);
    const prefix = "objective_completed:";
    if (
      atom.startsWith(prefix) &&
      primaryObjectiveIds.has(atom.slice(prefix.length))
    ) {
      state.mustCompletedPrimaryIds.add(atom.slice(prefix.length));
    }
  }
  synchronizeCompletionAtoms(state);
}

function setDifference<T>(
  values: ReadonlySet<T>,
  excluded: ReadonlySet<T>,
): Set<T> {
  return new Set([...values].filter((value) => !excluded.has(value)));
}

function transferBatch(input: {
  node: ReachabilityNode;
  input: NodeAbstractState;
  primaryObjectiveIds: ReadonlySet<string>;
  authorizationDefinitions: ReadonlyMap<
    string,
    ASTStoryCatalog["authorizations"][number]
  >;
  diagnostics: boolean;
}): BatchTransfer {
  let state = cloneState(input.input);
  const errors: ReachabilityDiagnostic[] = [];
  const warnings: ReachabilityDiagnostic[] = [];
  let batchMayFail = false;
  let batchFailureIndex: number | null = null;

  for (const effect of input.node.effects) {
    if (effect.kind === "addAtom") {
      state.mayAtoms.add(effect.atom);
      state.mustAtoms.add(effect.atom);
      continue;
    }

    const target = effect.target;
    switch (target.kind) {
      case "assertFact":
        state.mayAtoms.add(`fact_asserted:${target.factId}`);
        state.mustAtoms.add(`fact_asserted:${target.factId}`);
        break;
      case "revealQuestion":
        break;
      case "resolveQuestion": {
        const factAtom = `fact_asserted:${target.factId}`;
        if (!state.mayAtoms.has(factAtom)) {
          if (input.diagnostics) {
            errors.push(
              targetDiagnostic(
                input.node,
                effect.targetIndex,
                "storyRevealBatchAlwaysInvalid",
                `Story reveal batch for "${input.node.key}" cannot resolve question "${target.questionId}" before fact "${target.factId}" is asserted.`,
              ),
            );
          }
          return { state: null, errors, warnings };
        }
        if (!state.mustAtoms.has(factAtom)) {
          batchMayFail = true;
          batchFailureIndex ??= effect.targetIndex;
        }
        const atom = `question_resolved:${target.questionId}`;
        state.mayAtoms.add(atom);
        state.mustAtoms.add(atom);
        break;
      }
      case "revealObjective": {
        const atom = `objective_revealed:${target.objectiveId}`;
        state.mayAtoms.add(atom);
        state.mustAtoms.add(atom);
        break;
      }
      case "completeObjective": {
        const atom = `objective_completed:${target.objectiveId}`;
        state.mayAtoms.add(atom);
        state.mustAtoms.add(atom);
        break;
      }
      case "grantAuthorization": {
        const definition = input.authorizationDefinitions.get(
          target.authorizationId,
        );
        if (
          definition !== undefined &&
          definition.grantingAuthority === input.node.representedAuthority
        ) {
          const atom = `authorization_granted:${target.authorizationId}`;
          state.mayAtoms.add(atom);
          state.mustAtoms.add(atom);
        }
        break;
      }
      case "setPrimaryObjective": {
        if (
          target.nextObjectiveId !== null &&
          !input.primaryObjectiveIds.has(target.nextObjectiveId)
        ) {
          break;
        }
        const transitioned = transferPrimaryTarget(state, target);
        if (transitioned.state === null) {
          if (input.diagnostics) {
            errors.push(
              targetDiagnostic(
                input.node,
                effect.targetIndex,
                "primaryObjectiveTransitionAlwaysInvalid",
                `Primary objective transition in "${input.node.key}" is invalid for every modeled input.`,
              ),
            );
            errors.push(
              targetDiagnostic(
                input.node,
                effect.targetIndex,
                "storyRevealBatchAlwaysInvalid",
                `Story reveal batch for "${input.node.key}" has no successful modeled input.`,
              ),
            );
          }
          return { state: null, errors, warnings };
        }
        state = transitioned.state;
        batchMayFail ||= transitioned.mayFail;
        if (transitioned.mayFail) batchFailureIndex ??= effect.targetIndex;
        if (transitioned.mayFail && input.diagnostics) {
          warnings.push(
            targetDiagnostic(
              input.node,
              effect.targetIndex,
              "primaryObjectiveOrderingNotExhaustive",
              `Primary objective transition in "${input.node.key}" depends on free or branch order.`,
            ),
          );
        }
        break;
      }
    }
  }

  if (batchMayFail) {
    state.orderAmbiguous = true;
    if (input.diagnostics) {
      warnings.push(
        targetDiagnostic(
          input.node,
          batchFailureIndex ?? -1,
          "storyRevealBatchOrderDependent",
          `Story reveal batch for "${input.node.key}" succeeds for only some modeled inputs.`,
        ),
      );
    }
  }
  if (batchMayFail) {
    intersectInto(state.mustAtoms, input.input.mustAtoms);
    intersectInto(
      state.mustCompletedPrimaryIds,
      input.input.mustCompletedPrimaryIds,
    );
    state.mustActivePrimary = meetMustActive(
      input.input.mustActivePrimary,
      state.mustActivePrimary,
    );
  }
  synchronizeCompletionAtoms(state);
  return { state, errors, warnings };
}

function transferPrimaryTarget(
  input: NodeAbstractState,
  target: Extract<StoryRevealTarget, { kind: "setPrimaryObjective" }>,
): { state: NodeAbstractState | null; mayFail: boolean } {
  const state = cloneState(input);
  const next = target.nextObjectiveId;

  if (!target.completeCurrent) {
    if (next !== null && state.mustCompletedPrimaryIds.has(next)) {
      return { state: null, mayFail: false };
    }
    const mayFail = next !== null && state.mayCompletedPrimaryIds.has(next);
    if (mayFail && next !== null) removeCompletedPrimary(state, next);
    setActivePrimary(state, next);
    revealPrimary(state, next);
    state.orderAmbiguous ||= mayFail;
    return { state, mayFail };
  }

  if (
    next !== null &&
    (state.mustCompletedPrimaryIds.has(next) ||
      (state.mustActivePrimary.kind === "known" &&
        state.mustActivePrimary.id === next))
  ) {
    return { state: null, mayFail: false };
  }

  const validCurrentIds = [...state.mayActivePrimaryIds].filter(
    (candidate) => candidate !== next,
  );
  if (validCurrentIds.length === 0) {
    return { state: null, mayFail: false };
  }
  const mayFail =
    validCurrentIds.length !== state.mayActivePrimaryIds.size ||
    (next !== null && state.mayCompletedPrimaryIds.has(next));
  if (mayFail && next !== null) removeCompletedPrimary(state, next);

  for (const current of validCurrentIds) {
    if (current !== null) state.mayCompletedPrimaryIds.add(current);
  }
  if (validCurrentIds.length === 1 && validCurrentIds[0] !== null) {
    state.mustCompletedPrimaryIds.add(validCurrentIds[0]!);
  }
  setActivePrimary(state, next);
  revealPrimary(state, next);
  state.orderAmbiguous ||= mayFail;
  synchronizeCompletionAtoms(state);
  return { state, mayFail };
}

function initialAbstractState(): NodeAbstractState {
  return {
    mayAtoms: new Set(),
    mustAtoms: new Set(),
    mayActivePrimaryIds: new Set([null]),
    mustActivePrimary: { kind: "known", id: null },
    mayCompletedPrimaryIds: new Set(),
    mustCompletedPrimaryIds: new Set(),
    orderAmbiguous: false,
  };
}

function cloneState(state: NodeAbstractState): NodeAbstractState {
  return {
    mayAtoms: new Set(state.mayAtoms),
    mustAtoms: new Set(state.mustAtoms),
    mayActivePrimaryIds: new Set(state.mayActivePrimaryIds),
    mustActivePrimary: { ...state.mustActivePrimary },
    mayCompletedPrimaryIds: new Set(state.mayCompletedPrimaryIds),
    mustCompletedPrimaryIds: new Set(state.mustCompletedPrimaryIds),
    orderAmbiguous: state.orderAmbiguous,
  };
}

function joinInputStates(
  states: readonly NodeAbstractState[],
): NodeAbstractState {
  const result = cloneState(states[0] ?? initialAbstractState());
  for (const state of states.slice(1)) {
    addAll(result.mayAtoms, state.mayAtoms);
    intersectInto(result.mustAtoms, state.mustAtoms);
    addAll(result.mayActivePrimaryIds, state.mayActivePrimaryIds);
    result.mustActivePrimary = meetMustActive(
      result.mustActivePrimary,
      state.mustActivePrimary,
    );
    addAll(result.mayCompletedPrimaryIds, state.mayCompletedPrimaryIds);
    intersectInto(
      result.mustCompletedPrimaryIds,
      state.mustCompletedPrimaryIds,
    );
    result.orderAmbiguous ||= state.orderAmbiguous;
  }
  synchronizeCompletionAtoms(result);
  return result;
}

function publishState(
  previous: NodeAbstractState | undefined,
  computed: NodeAbstractState,
): NodeAbstractState {
  if (previous === undefined) return cloneState(computed);
  return joinInputStates([previous, computed]);
}

function setActivePrimary(
  state: NodeAbstractState,
  id: PrimaryCandidate,
): void {
  state.mayActivePrimaryIds = new Set([id]);
  state.mustActivePrimary = { kind: "known", id };
}

function revealPrimary(state: NodeAbstractState, id: PrimaryCandidate): void {
  if (id === null) return;
  const atom = `objective_revealed:${id}`;
  state.mayAtoms.add(atom);
  state.mustAtoms.add(atom);
}

function removeCompletedPrimary(state: NodeAbstractState, id: string): void {
  state.mayCompletedPrimaryIds.delete(id);
  state.mustCompletedPrimaryIds.delete(id);
  state.mayAtoms.delete(`objective_completed:${id}`);
  state.mustAtoms.delete(`objective_completed:${id}`);
}

function synchronizeCompletionAtoms(state: NodeAbstractState): void {
  for (const id of state.mayCompletedPrimaryIds) {
    state.mayAtoms.add(`objective_completed:${id}`);
  }
  for (const id of state.mustCompletedPrimaryIds) {
    state.mustAtoms.add(`objective_completed:${id}`);
  }
}

function completedPrimaryIds(
  atoms: ReadonlySet<string>,
  primaryObjectiveIds: ReadonlySet<string>,
): Set<string> {
  const prefix = "objective_completed:";
  return new Set(
    [...atoms].flatMap((atom) =>
      atom.startsWith(prefix) &&
      primaryObjectiveIds.has(atom.slice(prefix.length))
        ? [atom.slice(prefix.length)]
        : [],
    ),
  );
}

function meetMustActive(
  left: MustActivePrimary,
  right: MustActivePrimary,
): MustActivePrimary {
  if (left.kind === "uninitialized") return { ...right };
  if (right.kind === "uninitialized") return { ...left };
  if (left.kind === "unknown" || right.kind === "unknown") {
    return { kind: "unknown" };
  }
  return left.id === right.id ? { ...left } : { kind: "unknown" };
}

function statesEqual(
  left: NodeAbstractState,
  right: NodeAbstractState,
): boolean {
  return (
    setsEqual(left.mayAtoms, right.mayAtoms) &&
    setsEqual(left.mustAtoms, right.mustAtoms) &&
    setsEqual(left.mayActivePrimaryIds, right.mayActivePrimaryIds) &&
    mustActiveEqual(left.mustActivePrimary, right.mustActivePrimary) &&
    setsEqual(left.mayCompletedPrimaryIds, right.mayCompletedPrimaryIds) &&
    setsEqual(left.mustCompletedPrimaryIds, right.mustCompletedPrimaryIds) &&
    left.orderAmbiguous === right.orderAmbiguous
  );
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function mustActiveEqual(
  left: MustActivePrimary,
  right: MustActivePrimary,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== "known" || (right.kind === "known" && left.id === right.id))
  );
}

function intersectInto<T>(target: Set<T>, source: ReadonlySet<T>): void {
  for (const value of target) {
    if (!source.has(value)) target.delete(value);
  }
}

function mandatoryScenarioNodes(
  nodes: readonly ReachabilityNode[],
): ReachabilityNode[] {
  return nodes.filter((node) => node.requirement === "mandatory");
}

function atomsFromScenario(
  scenario: JointScenario,
  field: "mayAtoms" | "mustAtoms",
): Set<ReachabilityAtom> {
  const atoms = new Set<ReachabilityAtom>();
  for (const state of scenario.outputsByNodeKey.values()) {
    addAll(atoms, state[field]);
  }
  return atoms;
}

function intersectScenarioOutputKeys(
  scenarios: readonly JointScenario[],
): Set<string> {
  if (scenarios.length === 0) return new Set();
  const keys = new Set(scenarios[0]!.outputsByNodeKey.keys());
  for (const scenario of scenarios.slice(1)) {
    for (const key of keys) {
      if (!scenario.outputsByNodeKey.has(key)) keys.delete(key);
    }
  }
  return keys;
}

function intersectScenarioAtoms(
  scenarios: readonly JointScenario[],
  field: "mayAtoms" | "mustAtoms",
): Set<ReachabilityAtom> {
  if (scenarios.length === 0) return new Set();
  const atoms = atomsFromScenario(scenarios[0]!, field);
  for (const scenario of scenarios.slice(1)) {
    intersectInto(atoms, atomsFromScenario(scenario, field));
  }
  return atoms;
}

function mustActiveFromScenario(
  nodes: readonly ReachabilityNode[],
  scenario: JointScenario,
): MustActivePrimary {
  const successfulNodeKeys = new Set(scenario.outputsByNodeKey.keys());
  const producerKeysByAtom = buildScenarioProducerIndex(scenario);
  const causalEdges = buildCausalDependencyEdges(nodes, producerKeysByAtom);
  const outcomeNodeKeys = [...successfulNodeKeys]
    .filter(
      (key) =>
        !(causalEdges.get(key) ?? []).some((successorKey) =>
          successfulNodeKeys.has(successorKey),
        ),
    )
    .sort((left, right) => left.localeCompare(right));
  let result: MustActivePrimary = { kind: "uninitialized" };
  for (const key of outcomeNodeKeys) {
    const state = scenario.outputsByNodeKey.get(key);
    if (state !== undefined) {
      result = meetMustActive(result, state.mustActivePrimary);
    }
  }
  return result;
}

function mustActiveAcrossScenarios(
  nodes: readonly ReachabilityNode[],
  scenarios: readonly JointScenario[],
): MustActivePrimary {
  let result: MustActivePrimary = { kind: "uninitialized" };
  for (const scenario of scenarios) {
    result = meetMustActive(result, mustActiveFromScenario(nodes, scenario));
  }
  return result;
}

function targetDiagnostic(
  node: ReachabilityNode,
  targetIndex: number,
  code: string,
  message: string,
): ReachabilityDiagnostic {
  return {
    ...diagnostic(node, code, message),
    targetIndex,
  };
}

function pushDiagnostic(
  diagnostics: ReachabilityDiagnostic[],
  candidate: ReachabilityDiagnostic,
): void {
  if (
    diagnostics.some(
      (existing) =>
        existing.code === candidate.code &&
        existing.nodeKey === candidate.nodeKey &&
        existing.targetIndex === candidate.targetIndex,
    )
  ) {
    return;
  }
  diagnostics.push(candidate);
}

function nodeMayExecute(
  node: ReachabilityNode,
  reachableNodeKeys: ReadonlySet<string>,
  atoms: ReadonlySet<ReachabilityAtom>,
): boolean {
  return nodeCanExecute(node, reachableNodeKeys, atoms, evaluateMay);
}

function nodeCanExecute(
  node: ReachabilityNode,
  reachableNodeKeys: ReadonlySet<string>,
  atoms: ReadonlySet<ReachabilityAtom>,
  evaluate: typeof evaluateMay,
): boolean {
  if (node.initiallyReachable && node.strictPredecessorKeys.length === 0) {
    return true;
  }
  if (
    node.strictPredecessorKeys.some(
      (predecessorKey) => !reachableNodeKeys.has(predecessorKey),
    )
  ) {
    return false;
  }
  if (
    !node.initiallyReachable &&
    node.strictPredecessorKeys.length === 0 &&
    node.condition === null &&
    node.implicitPrerequisites.length === 0
  ) {
    return false;
  }
  if (node.condition !== null && !evaluate(node.condition, atoms)) return false;
  return node.implicitPrerequisites.every((predicate) =>
    atoms.has(predicate.atom),
  );
}

function potentialEffectAtoms(node: ReachabilityNode): ReachabilityAtom[] {
  return unique(
    node.effects.flatMap((effect) => {
      if (effect.kind === "addAtom") return [effect.atom];
      switch (effect.target.kind) {
        case "assertFact":
          return [`fact_asserted:${effect.target.factId}`];
        case "resolveQuestion":
          return [`question_resolved:${effect.target.questionId}`];
        case "revealObjective":
          return [`objective_revealed:${effect.target.objectiveId}`];
        case "completeObjective":
          return [`objective_completed:${effect.target.objectiveId}`];
        case "setPrimaryObjective":
          return effect.target.nextObjectiveId === null
            ? []
            : [`objective_revealed:${effect.target.nextObjectiveId}`];
        case "grantAuthorization":
          return [`authorization_granted:${effect.target.authorizationId}`];
        case "revealQuestion":
          return [];
      }
    }),
  );
}

/**
 * Determines whether a prerequisite atom is guaranteed despite being produced
 * only by optional nodes, by virtue of exhaustive mutually-exclusive one-shot
 * alternatives.
 *
 * The scenario enumerator selects exactly one alternative per one-shot event,
 * so when every may-reachable alternative of a multi-member one-shot group
 * produces the atom, the atom is asserted on every path regardless of which
 * alternative runs — BUT only if the one-shot event itself is guaranteed to
 * execute. An optional interrogation Question the player can skip entirely
 * has its breakthrough alternatives share the same one-shot event id, yet the
 * event may never fire. The existing node structure distinguishes this case:
 * each breakthrough has its Question-entry node as a strict predecessor, and
 * that entry is mandatory only for a required Question. So the exhaustive
 * alternative group guarantees the atom only when its shared trigger/
 * predecessor is itself must-reachable (or the alternatives are reachable
 * from the start with no predecessor, meaning the trigger is the scene entry).
 */
function prerequisiteAtomGuaranteedByExhaustiveAlternatives(input: {
  atom: ReachabilityAtom;
  producerKeys: readonly string[];
  groupsByEventId: ReadonlyMap<string, readonly string[]>;
  nodesByKey: ReadonlyMap<string, ReachabilityNode>;
  reachableNodeKeys: ReadonlySet<string>;
  mustReachableNodeKeys: ReadonlySet<string>;
}): boolean {
  const producerKeySet = new Set(input.producerKeys);
  const producerEventIds = new Set<string>();
  for (const key of input.producerKeys) {
    const node = input.nodesByKey.get(key);
    if (node) producerEventIds.add(node.oneShotEventId);
  }
  for (const eventId of producerEventIds) {
    const groupMembers = input.groupsByEventId.get(eventId) ?? [];
    if (groupMembers.length <= 1) continue;
    const mayReachableMembers = groupMembers.filter((key) =>
      input.reachableNodeKeys.has(key),
    );
    if (
      mayReachableMembers.length > 0 &&
      mayReachableMembers.every((key) => producerKeySet.has(key)) &&
      groupTriggerIsMustReachable(mayReachableMembers, input)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Determines whether the shared trigger/predecessor of a one-shot alternative
 * group is must-reachable, meaning the event is guaranteed to execute on every
 * path. Returns true when either (a) every member is initially reachable with
 * no strict predecessors — the trigger is the scene entry, which is always
 * must-reachable — or (b) the members share a common strict predecessor and
 * every shared predecessor is itself must-reachable. When members have no
 * common predecessor (or a shared predecessor that is only may-reachable), the
 * event may be skippable, so the group does not guarantee execution.
 */
function groupTriggerIsMustReachable(
  memberKeys: readonly string[],
  input: {
    nodesByKey: ReadonlyMap<string, ReachabilityNode>;
    mustReachableNodeKeys: ReadonlySet<string>;
  },
): boolean {
  const predecessorSets = memberKeys.map((key) => {
    const node = input.nodesByKey.get(key);
    return node ? node.strictPredecessorKeys : [];
  });
  const allHaveNoPredecessors = predecessorSets.every(
    (predecessors) => predecessors.length === 0,
  );
  if (allHaveNoPredecessors) {
    // Members reachable without predecessors must be initially reachable
    // (otherwise they would not be may-reachable). The trigger is the scene
    // entry, which is must-reachable on every path.
    return memberKeys.every(
      (key) => input.nodesByKey.get(key)?.initiallyReachable ?? false,
    );
  }
  // Compute the intersection of strict predecessors across all members. Only
  // a shared predecessor can serve as the group's common trigger.
  const sharedPredecessors = predecessorSets.reduce(
    (intersection, predecessors) =>
      intersection.filter((key) => predecessors.includes(key)),
  );
  if (sharedPredecessors.length === 0) return false;
  // The event is guaranteed to fire only when every shared predecessor is
  // must-reachable — otherwise the player can skip the trigger and the event
  // never executes.
  return sharedPredecessors.every((key) =>
    input.mustReachableNodeKeys.has(key),
  );
}

function mandatoryAuthorizationFailure(input: {
  node: ReachabilityNode;
  nodes: readonly ReachabilityNode[];
  reachableNodeKeys: ReadonlySet<string>;
  mustReachableNodeKeys: ReadonlySet<string>;
  mustAtoms: ReadonlySet<ReachabilityAtom>;
  authorizationDefinitions: ReadonlyMap<
    string,
    ASTStoryCatalog["authorizations"][number]
  >;
}): ReachabilityDiagnostic | null {
  const requiredAuthorizationIds = unique(
    [
      ...requiredExpressionPredicates(input.node.condition),
      ...input.node.implicitPrerequisites,
    ].flatMap((predicate) => {
      const prefix = "authorization_granted:";
      return predicate.atom.startsWith(prefix)
        ? [predicate.atom.slice(prefix.length)]
        : [];
    }),
  );
  for (const authorizationId of requiredAuthorizationIds) {
    const definition = input.authorizationDefinitions.get(authorizationId);
    if (definition === undefined) {
      return diagnostic(
        input.node,
        "mandatoryAuthorizationUnreachable",
        `Mandatory authorization "${authorizationId}" has no catalog definition.`,
      );
    }
    const producers = input.nodes.filter((candidate) =>
      candidate.effects.some(
        (effect) =>
          effect.kind === "story" &&
          effect.target.kind === "grantAuthorization" &&
          effect.target.authorizationId === authorizationId,
      ),
    );
    if (producers.length === 0) {
      return diagnostic(
        input.node,
        "mandatoryAuthorizationUnreachable",
        `Mandatory authorization "${authorizationId}" has no authored grant producer.`,
      );
    }
    const matching = producers.filter(
      (producer) =>
        producer.representedAuthority === definition.grantingAuthority,
    );
    if (matching.length === 0) {
      return diagnostic(
        input.node,
        "mandatoryAuthorizationUnreachable",
        `Grant producers for mandatory authorization "${authorizationId}" do not match required authority "${definition.grantingAuthority}".`,
      );
    }
    if (
      matching.every((producer) => !input.reachableNodeKeys.has(producer.key))
    ) {
      return diagnostic(
        input.node,
        "mandatoryAuthorizationUnreachable",
        `Mandatory authorization "${authorizationId}" has no reachable matching grant producer.`,
      );
    }
    // The grant must be guaranteed on every path, not merely may-reachable.
    // A may-reachable grant on an optional question or only one of several
    // mutually-exclusive breakthrough alternatives lets the player complete
    // the predecessor without granting the authorization, soft-locking the
    // required successor.
    const grantAtom: ReachabilityAtom = `authorization_granted:${authorizationId}`;
    if (input.mustAtoms.has(grantAtom)) continue; // guaranteed by mandatory nodes
    // Legacy grant producers predate the guarantee analysis; skip the check
    // when every matching producer is legacy to preserve backward compat.
    const nonLegacyMatching = matching.filter(
      (producer) => !producer.legacyCompatibilityMode,
    );
    if (nonLegacyMatching.length === 0) continue;
    // A grant is unguaranteed when its authored trigger is actually skippable:
    // the producer itself is optional, a required prerequisite is supplied only
    // by optional nodes, or only some mutually-exclusive alternatives grant it.
    // Do not infer skippability from global mustAtoms alone: later mandatory
    // content can be absent from the must fixed point after an earlier modeled
    // branch even when this producer's own path is structurally mandatory.
    const matchingKeys = new Set(matching.map((producer) => producer.key));
    const groupsByEventId = new Map<string, string[]>();
    for (const candidate of input.nodes) {
      const members = groupsByEventId.get(candidate.oneShotEventId) ?? [];
      members.push(candidate.key);
      groupsByEventId.set(candidate.oneShotEventId, members);
    }
    const nodesByKey = new Map(
      input.nodes.map((candidate) => [candidate.key, candidate]),
    );
    const producerKeysByAtom = buildPositiveProducerIndex(input.nodes);
    let unguaranteed = false;
    for (const producer of nonLegacyMatching) {
      if (!input.reachableNodeKeys.has(producer.key)) continue;
      const groupMembers = groupsByEventId.get(producer.oneShotEventId) ?? [
        producer.key,
      ];
      if (groupMembers.length === 1) {
        const prerequisiteAtoms = unique(
          [
            ...requiredExpressionPredicates(producer.condition),
            ...producer.implicitPrerequisites,
          ].map((predicate) => predicate.atom),
        );
        const hasOptionalStrictPredecessor =
          producer.strictPredecessorKeys.some(
            (key) => nodesByKey.get(key)?.requirement === "optional",
          );
        // A prerequisite supplied only by optional nodes is not necessarily
        // skippable: when those nodes are exhaustive mutually-exclusive
        // alternatives of one one-shot event (e.g. a required question with
        // multiple correct testimony lines) AND the event's shared trigger is
        // must-reachable, one alternative must execute, so an atom produced by
        // every alternative is guaranteed. An optional Question whose entry the
        // player can skip does not guarantee execution even when every
        // alternative asserts the prerequisite. Reuse the same exhaustiveness
        // reasoning as the "every alternative grants it" case below rather than
        // deciding guarantee solely from each producer's requirement.
        const hasUnguaranteedPrerequisiteProducer = prerequisiteAtoms.some(
          (atom) => {
            const keys = producerKeysByAtom.get(atom) ?? [];
            if (keys.length === 0) return false;
            const allOptional = keys.every(
              (key) => nodesByKey.get(key)?.requirement === "optional",
            );
            if (!allOptional) return false;
            return !prerequisiteAtomGuaranteedByExhaustiveAlternatives({
              atom,
              producerKeys: keys,
              groupsByEventId,
              nodesByKey,
              reachableNodeKeys: input.reachableNodeKeys,
              mustReachableNodeKeys: input.mustReachableNodeKeys,
            });
          },
        );
        if (
          producer.requirement === "optional" ||
          hasOptionalStrictPredecessor ||
          hasUnguaranteedPrerequisiteProducer
        ) {
          unguaranteed = true;
          break;
        }
      } else {
        // Mutually-exclusive group: unguaranteed when any may-reachable
        // alternative does not produce the grant.
        const mayReachableMembers = groupMembers.filter((key) =>
          input.reachableNodeKeys.has(key),
        );
        if (!mayReachableMembers.every((key) => matchingKeys.has(key))) {
          unguaranteed = true;
          break;
        }
      }
    }
    if (unguaranteed) {
      return diagnostic(
        input.node,
        "mandatoryAuthorizationGrantNotGuaranteed",
        `Mandatory authorization "${authorizationId}" grant is not guaranteed on every path. ` +
          `A matching grant producer is may-reachable but not must-reachable — the player can complete ` +
          `the predecessor without granting the authorization, soft-locking required content. ` +
          `Ensure every mutually-exclusive breakthrough alternative grants the authorization, ` +
          `or move the grant to a required (mandatory) path.`,
      );
    }
  }
  return null;
}

function expressionPredicates(
  expression: PositiveExpression<ReachabilityPredicate> | null,
): ReachabilityPredicate[] {
  if (expression === null) return [];
  if (!("op" in expression)) return [expression];
  if (expression.op === "at_least") {
    return uniquePredicates(
      expression.conditions.flatMap((condition) =>
        expressionPredicates(condition),
      ),
    );
  }
  return uniquePredicates([
    ...expressionPredicates(expression.left),
    ...expressionPredicates(expression.right),
  ]);
}

function diagnostic(
  node: ReachabilityNode,
  code: string,
  message: string,
): ReachabilityDiagnostic {
  return {
    code,
    message,
    sourceFile: node.sourceFile,
    line: node.line,
    nodeKey: node.key,
    targetIndex: null,
  };
}

function addAll<T>(target: Set<T>, source: ReadonlySet<T>): void {
  for (const value of source) target.add(value);
}

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

type AnalysisReachabilityRecord = AnalysisSceneRecord & {
  normalized: NormalizedAnalysisScene;
};

type ReachabilitySceneRecord = SceneRecord | AnalysisReachabilityRecord;

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
  analysisScenes?: readonly AnalysisSceneRecord[];
  normalizedAnalysisScenes?: readonly NormalizedAnalysisScene[];
}): ReachabilityNode[] {
  const normalizedByScene = new Map(
    (input.normalizedAnalysisScenes ?? []).map((scene) => [
      `${scene.chapterId}@${scene.sceneId}`,
      scene,
    ]),
  );
  const analysisScenes: AnalysisReachabilityRecord[] = (
    input.analysisScenes ?? []
  ).flatMap((scene) => {
    const normalized = normalizedByScene.get(
      `${scene.chapterId}@${scene.ast.id}`,
    );
    return normalized === undefined ? [] : [{ ...scene, normalized }];
  });
  const records = orderedSceneRecords(
    input.chapters,
    input.scenes,
    analysisScenes,
  );
  const nodes: NodeDraft[] = [];
  let previousOutroKey: string | null = null;
  let firstScene = true;

  for (const record of records) {
    const scope = sceneScope(record);
    const sceneNodes = isAnalysisReachabilityRecord(record)
      ? buildAnalysisNodes({
          record,
          scope,
          entryPredecessors:
            previousOutroKey === null ? [] : [previousOutroKey],
        })
      : buildSceneNodes({
          record,
          scope,
          entryPredecessors:
            previousOutroKey === null ? [] : [previousOutroKey],
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
  analysisScenes: AnalysisReachabilityRecord[],
): ReachabilitySceneRecord[] {
  const recordsByManifestKey = new Map(
    [...scenes, ...analysisScenes].map(
      (record) => [`${record.chapterId}/${record.file}`, record] as const,
    ),
  );
  const ordered: ReachabilitySceneRecord[] = [];
  const included = new Set<ReachabilitySceneRecord>();
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

  const unlisted = [...scenes, ...analysisScenes]
    .filter((record) => !included.has(record))
    .sort(
      (left, right) =>
        left.chapterId.localeCompare(right.chapterId) ||
        left.file.localeCompare(right.file),
    );
  ordered.push(...unlisted);
  return ordered;
}

function isAnalysisReachabilityRecord(
  record: ReachabilitySceneRecord,
): record is AnalysisReachabilityRecord {
  return record.ast.kind === "analysisScene";
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

function buildAnalysisNodes(input: {
  record: AnalysisReachabilityRecord;
  scope: SceneScope;
  entryPredecessors: string[];
}): NodeDraft[] {
  const { record, scope } = input;
  const authoredBoardsById = new Map(
    record.ast.boards.map((board) => [board.id, board] as const),
  );
  const nodes: NodeDraft[] = [];
  const boardKeys: string[] = [];
  const boardCompletionAtoms: ReachabilityAtom[] = [];

  for (const board of record.normalized.boards) {
    const authored = authoredBoardsById.get(board.common.id);
    if (authored === undefined) continue;
    const boardKey = `${scope.prefix}/board:${board.common.id}`;
    const boardCompletionAtom = analysisBoardCompletionAtom(
      scope,
      board.common.id,
    );
    boardKeys.push(boardKey);
    boardCompletionAtoms.push(boardCompletionAtom);
    nodes.push(
      node({
        key: boardKey,
        requirement: "mandatory",
        legacyCompatibilityMode: false,
        initiallyReachable: false,
        condition: normalizeAnalysisExpression(board.common.unlock),
        implicitPrerequisites: uniquePredicates(
          board.common.cards.map((card) => ({
            predicate: "atom" as const,
            atom: `${card.source.kind}:${card.source.id}`,
          })),
        ),
        effects: [
          // targetIndex -1 is a reserved slot for the board-completion atom,
          // distinct from story reveal targetIndex values (>= 0) and the scene
          // completion atom's slot (0).
          addAtomEffect(boardCompletionAtom, -1),
          ...effectsFromStoryReveals(board.common.reveals),
        ],
        strictPredecessorKeys: input.entryPredecessors,
        sourceFile: authored.sourceFile,
        line: authored.line,
      }),
    );
  }

  nodes.push(
    node({
      key: `${scope.prefix}/outro`,
      requirement: "mandatory",
      legacyCompatibilityMode: false,
      initiallyReachable: false,
      implicitPrerequisites: boardCompletionAtoms.map((atom) => ({
        predicate: "atom" as const,
        atom,
      })),
      effects: [addAtomEffect(analysisSceneCompletionAtom(scope), 0)],
      strictPredecessorKeys: boardKeys,
      sourceFile: record.ast.sourceFile,
      line: record.ast.line,
    }),
  );

  return nodes;
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

  const phaseEntryPredecessors = new Map<string, string>();
  let previousGuaranteedPhaseCompleteKey: string | null = null;
  const runtimePhaseOrder = [
    ...scene.phases.filter((phase) => phase.required),
    ...scene.phases.filter((phase) => !phase.required),
  ];
  for (const phase of runtimePhaseOrder) {
    if (previousGuaranteedPhaseCompleteKey !== null) {
      phaseEntryPredecessors.set(phase.id, previousGuaranteedPhaseCompleteKey);
    }
    // Rust may skip a statically locked phase. Only an unconditionally
    // unlocked phase is guaranteed to become current and block every later
    // phase in required-before-optional, author-preserving scheduler order.
    if (phase.status === "unlocked") {
      previousGuaranteedPhaseCompleteKey = `${scope.prefix}/phase:${phase.id}:complete`;
    }
  }

  for (const phase of scene.phases) {
    const phaseEntryKey = `${scope.prefix}/phase:${phase.id}:entry`;
    const phaseCompleteKey = `${scope.prefix}/phase:${phase.id}:complete`;
    const phaseAtom = interrogationPhaseAtom(scope, phase.id);
    const serializedEntryPredecessor = phaseEntryPredecessors.get(phase.id);

    nodes.push(
      node({
        key: phaseEntryKey,
        requirement: phase.required ? "mandatory" : "optional",
        legacyCompatibilityMode:
          expressionIsLegacy(phase.unlock) && revealsAreLegacy(phase.reveals),
        initiallyReachable: phase.status === "unlocked",
        condition: normalizeInterrogationExpression(phase.unlock, scope),
        effects: effectsFromInterrogationReveals(phase.reveals, scope),
        representedAuthority: phase.representedAuthority ?? null,
        revealedTargetKeys: inboundTargetsFromInterrogationReveals(
          phase.reveals,
        ),
        strictPredecessorKeys: [
          entryKey,
          ...(serializedEntryPredecessor === undefined
            ? []
            : [serializedEntryPredecessor]),
        ],
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
          representedAuthority: phase.representedAuthority ?? null,
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
  representedAuthority: string | null;
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
        representedAuthority: input.representedAuthority,
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
      oneShotEventId: `${scope.prefix}/question:${question.id}:breakthrough`,
      requirement:
        input.mandatory && correctLines.length === 1 ? "mandatory" : "optional",
      legacyCompatibilityMode:
        revealsAreLegacy(line.reveals) && revealsAreLegacy(question.reveals),
      initiallyReachable: false,
      representedAuthority: input.representedAuthority,
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
        | "representedAuthority"
        | "oneShotEventId"
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
    oneShotEventId: input.key,
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
  const nodesByKey = new Map<string, NodeDraft>(
    nodes.map((node) => [node.key, node]),
  );

  for (const node of nodes) {
    if (node.inboundTargetKey !== null) {
      nodesByInboundTarget.set(
        `${scenePrefix(node.key)}:${node.inboundTargetKey}`,
        node.key,
      );
    }
    for (const atom of potentialEffectAtoms(node)) {
      const producers = producersByAtom.get(atom) ?? [];
      producers.push(node.key);
      producersByAtom.set(atom, unique(producers));
    }
  }

  for (const source of nodes) {
    for (const localTarget of source.revealedTargetKeys) {
      const target = nodesByInboundTarget.get(
        `${scenePrefix(source.key)}:${localTarget}`,
      );
      if (target === undefined || target === source.key) continue;
      const targetNode = nodesByKey.get(target);
      if (targetNode === undefined || !targetNode.requiresInboundReveal)
        continue;
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

function normalizeAnalysisExpression(
  expression: NormalizedAnalysisScene["boards"][number]["common"]["unlock"],
): PositiveExpression<ReachabilityPredicate> | null {
  if (expression === null) return null;
  return normalizeExpression(expression, storyPredicateAtom);
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
  _scope: SceneScope,
): ReachabilityEffect[] {
  return reveals.flatMap((target, targetIndex) => {
    if (isStoryRevealTarget(target)) {
      return [{ kind: "story", target, targetIndex }];
    }
    switch (target.kind) {
      case "evidence":
      case "statement":
      case "practice":
        return [addAtomEffect(`${target.kind}:${target.id}`, targetIndex)];
      // Local hotspot/topic reveals only unlock those blocks at runtime; they
      // do not investigate or discuss them. Their own normalized execution
      // nodes remain the sole producers of the corresponding completion atoms
      // (investigationHotspotAtom/investigationTopicAtom). Availability is
      // modeled by inboundTargetsFromInvestigationReveals below, which wires
      // the revealer as a strict predecessor of the revealed target when that
      // target requires an inbound reveal. Emitting the completion atom here
      // would let the fixed-point analyzer satisfy downstream predicates
      // (e.g. hotspot_investigated/topic_discussed) before the player executes
      // the revealed target, hiding real deadlocks.
      case "hotspot":
      case "topic":
      case "sublocation":
        return [];
    }
  });
}

function effectsFromStoryReveals(
  reveals: StoryRevealTarget[],
): ReachabilityEffect[] {
  return reveals.map((target, targetIndex) => ({
    kind: "story" as const,
    target,
    targetIndex,
  }));
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
      // Local question/phase reveals only unlock those blocks at runtime; they
      // do not answer or complete them. Their own normalized execution nodes
      // remain the sole producers of the corresponding completion atoms
      // (interrogationQuestionAtom/interrogationPhaseAtom). Availability is
      // modeled by inboundTargetsFromInterrogationReveals below, which wires
      // the revealer as a strict predecessor of the revealed target when that
      // target requires an inbound reveal. Emitting the completion atom here
      // would let the fixed-point analyzer satisfy downstream predicates
      // (e.g. question_answered/phase_completed) before the player executes
      // the revealed target, hiding real deadlocks.
      case "question":
      case "phase":
        return [];
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
      case "practice":
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

function analysisBoardCompletionAtom(
  scope: SceneScope,
  boardId: string,
): ReachabilityAtom {
  return `analysis_board_completed:${scope.chapterId}@${scope.sceneId}@${boardId}`;
}

function analysisSceneCompletionAtom(scope: SceneScope): ReachabilityAtom {
  return `analysis_scene_completed:${scope.chapterId}@${scope.sceneId}`;
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

function sceneScope(record: {
  chapterId: string;
  ast: { id: string };
}): SceneScope {
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
