import type { RevealTarget } from "@lyra/scene-types";
import type {
  CompileError,
  InterrogationLocalRevealTarget,
  InterrogationRevealTarget,
  InvestigationRevealTarget,
  StoryRevealTarget,
} from "./types";

const SLUG_RE = /^[a-z0-9_]+$/;

export type RevealFamily = "investigation" | "interrogation";

export type ParseRevealsListInput<TFamily extends RevealFamily = RevealFamily> =
  {
    family: TFamily;
    raw: string;
    sourceFile: string;
    line: number;
  };

type TargetForFamily<TFamily extends RevealFamily> =
  TFamily extends "investigation"
    ? InvestigationRevealTarget
    : InterrogationRevealTarget;

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CompileError };

type StorySyntaxState = {
  seenTargets: Set<string>;
  resolverByQuestion: Map<string, string>;
  primaryTransition: StoryRevealTarget | null;
};

export function parseRevealsList<TFamily extends RevealFamily>(
  input: ParseRevealsListInput<TFamily>,
): ParseResult<TargetForFamily<TFamily>[]> {
  const list = /^\[(.*)\]\s*$/.exec(input.raw.trim());
  if (!list) return malformedList(input);

  const items = (list[1] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const targets: Array<InvestigationRevealTarget | InterrogationRevealTarget> =
    [];
  const storySyntax: StorySyntaxState = {
    seenTargets: new Set(),
    resolverByQuestion: new Map(),
    primaryTransition: null,
  };

  for (const item of items) {
    const storyTarget = parseStoryRevealTarget(item, input);
    if (!storyTarget.ok) return storyTarget;
    if (storyTarget.value !== null) {
      const syntaxCheck = validateStoryTarget(
        storyTarget.value,
        storySyntax,
        input,
      );
      if (!syntaxCheck.ok) return syntaxCheck;
      targets.push(storyTarget.value);
      continue;
    }

    const localTarget =
      input.family === "investigation"
        ? parseInvestigationLocalRevealTarget(item, input)
        : parseInterrogationLocalRevealTarget(item, input);
    if (!localTarget.ok) return localTarget;
    targets.push(localTarget.value);
  }

  return {
    ok: true,
    value: targets as TargetForFamily<TFamily>[],
  };
}

function malformedList(input: ParseRevealsListInput): ParseResult<never> {
  if (input.family === "investigation") {
    return fail(
      input,
      "revealsMalformed",
      `Reveals value must be a [list]. Got: ${input.raw}`,
    );
  }
  return fail(
    input,
    "interrogationRevealUnknownTarget",
    `Reveals value must be a [list]. Got: ${input.raw}`,
  );
}

function parseInvestigationLocalRevealTarget(
  raw: string,
  input: ParseRevealsListInput,
): ParseResult<RevealTarget> {
  const prefix = /^(evidence|statement|hotspot|sublocation|topic):(.+)$/.exec(
    raw,
  );
  if (!prefix) {
    return fail(
      input,
      "revealUnknownPrefix",
      `Unknown reveal target prefix: ${raw}`,
    );
  }
  const kind = prefix[1] as RevealTarget["kind"];
  const tail = prefix[2] ?? "";
  if (kind === "topic") {
    const topic = /^([a-z0-9_]+)@([a-z0-9_]+)$/.exec(tail);
    if (!topic) {
      return fail(
        input,
        "revealTopicMalformed",
        `Topic reveal must be topic:<char>@<topic>. Got: ${raw}`,
      );
    }
    return {
      ok: true,
      value: {
        kind: "topic",
        characterId: topic[1] ?? "",
        topicId: topic[2] ?? "",
      },
    };
  }
  if (!SLUG_RE.test(tail)) {
    return fail(
      input,
      "revealIdMalformed",
      `Reveal id must be snake_case slug: ${raw}`,
    );
  }
  return { ok: true, value: { kind, id: tail } };
}

function parseInterrogationLocalRevealTarget(
  raw: string,
  input: ParseRevealsListInput,
): ParseResult<InterrogationLocalRevealTarget> {
  const target = /^(evidence|statement|question|phase):([a-z0-9_]+)$/.exec(raw);
  if (!target) {
    return fail(
      input,
      "interrogationRevealUnknownTarget",
      `Unknown interrogation reveal target: ${raw}`,
    );
  }
  return {
    ok: true,
    value: {
      kind: target[1] as InterrogationLocalRevealTarget["kind"],
      id: target[2] ?? "",
    },
  };
}

function parseStoryRevealTarget(
  raw: string,
  input: ParseRevealsListInput,
): ParseResult<StoryRevealTarget | null> {
  if (raw.startsWith("assert_fact:")) {
    return parseStorySlugTarget(raw, "assert_fact:", "assertFact", input);
  }
  if (raw.startsWith("reveal_question:")) {
    return parseStorySlugTarget(
      raw,
      "reveal_question:",
      "revealQuestion",
      input,
    );
  }
  if (raw.startsWith("resolve_question:")) {
    const target = /^resolve_question:([a-z0-9_]+)@([a-z0-9_]+)$/.exec(raw);
    if (!target) return malformedStoryTarget(raw, input);
    return {
      ok: true,
      value: {
        kind: "resolveQuestion",
        questionId: target[1] ?? "",
        factId: target[2] ?? "",
      },
    };
  }
  if (raw.startsWith("reveal_objective:")) {
    return parseStorySlugTarget(
      raw,
      "reveal_objective:",
      "revealObjective",
      input,
    );
  }
  if (raw.startsWith("complete_objective:")) {
    return parseStorySlugTarget(
      raw,
      "complete_objective:",
      "completeObjective",
      input,
    );
  }
  if (raw.startsWith("set_primary_objective:")) {
    return parsePrimaryTransition(raw, input);
  }
  if (raw.startsWith("grant_authorization:")) {
    return parseStorySlugTarget(
      raw,
      "grant_authorization:",
      "grantAuthorization",
      input,
    );
  }
  return { ok: true, value: null };
}

function parseStorySlugTarget(
  raw: string,
  prefix: string,
  kind:
    | "assertFact"
    | "revealQuestion"
    | "revealObjective"
    | "completeObjective"
    | "grantAuthorization",
  input: ParseRevealsListInput,
): ParseResult<StoryRevealTarget> {
  const id = raw.slice(prefix.length);
  if (!SLUG_RE.test(id)) return malformedStoryTarget(raw, input);
  switch (kind) {
    case "assertFact":
      return { ok: true, value: { kind, factId: id } };
    case "revealQuestion":
      return { ok: true, value: { kind, questionId: id } };
    case "revealObjective":
    case "completeObjective":
      return { ok: true, value: { kind, objectiveId: id } };
    case "grantAuthorization":
      return { ok: true, value: { kind, authorizationId: id } };
  }
}

function parsePrimaryTransition(
  raw: string,
  input: ParseRevealsListInput,
): ParseResult<StoryRevealTarget> {
  const parts = raw.split(";");
  const nextObjectiveIdSource = parts[0]
    ?.slice("set_primary_objective:".length)
    .trim();
  const modifier = parts[1]?.trim();
  if (
    parts.length > 2 ||
    (parts.length === 2 && modifier !== "complete_current")
  ) {
    return fail(
      input,
      "storyRevealMalformedModifier",
      "set_primary_objective only accepts the optional `; complete_current` modifier. Got: " +
        raw,
    );
  }
  if (
    !nextObjectiveIdSource ||
    (nextObjectiveIdSource !== "null" && !SLUG_RE.test(nextObjectiveIdSource))
  ) {
    return malformedStoryTarget(raw, input);
  }
  return {
    ok: true,
    value: {
      kind: "setPrimaryObjective",
      nextObjectiveId:
        nextObjectiveIdSource === "null" ? null : nextObjectiveIdSource,
      completeCurrent: modifier === "complete_current",
    },
  };
}

function malformedStoryTarget(
  raw: string,
  input: ParseRevealsListInput,
): ParseResult<never> {
  return fail(
    input,
    "storyRevealMalformedTarget",
    `Malformed story reveal target: ${raw}`,
  );
}

function validateStoryTarget(
  target: StoryRevealTarget,
  state: StorySyntaxState,
  input: ParseRevealsListInput,
): ParseResult<void> {
  const key = storyTargetKey(target);
  if (state.seenTargets.has(key)) {
    return fail(
      input,
      "duplicateStoryRevealTarget",
      `Duplicate story reveal target: ${key}`,
    );
  }
  if (target.kind === "resolveQuestion") {
    const previousFactId = state.resolverByQuestion.get(target.questionId);
    if (previousFactId !== undefined && previousFactId !== target.factId) {
      return fail(
        input,
        "conflictingQuestionResolution",
        `Question ${target.questionId} resolves to both ${previousFactId} and ${target.factId}.`,
      );
    }
    state.resolverByQuestion.set(target.questionId, target.factId);
  }
  if (target.kind === "setPrimaryObjective") {
    if (state.primaryTransition !== null) {
      return fail(
        input,
        "multiplePrimaryTransitions",
        "Reveal list contains multiple set_primary_objective targets.",
      );
    }
    state.primaryTransition = target;
  }
  state.seenTargets.add(key);
  return { ok: true, value: undefined };
}

function storyTargetKey(target: StoryRevealTarget): string {
  switch (target.kind) {
    case "assertFact":
      return `${target.kind}:${target.factId}`;
    case "revealQuestion":
      return `${target.kind}:${target.questionId}`;
    case "resolveQuestion":
      return `${target.kind}:${target.questionId}@${target.factId}`;
    case "revealObjective":
    case "completeObjective":
      return `${target.kind}:${target.objectiveId}`;
    case "setPrimaryObjective":
      return `${target.kind}:${target.nextObjectiveId ?? "null"}:${target.completeCurrent}`;
    case "grantAuthorization":
      return `${target.kind}:${target.authorizationId}`;
  }
}

function fail(
  input: ParseRevealsListInput,
  code: string,
  message: string,
): ParseResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      sourceFile: input.sourceFile,
      line: input.line,
    },
  };
}
