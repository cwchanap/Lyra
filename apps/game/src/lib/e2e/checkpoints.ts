import type { GameStateView } from "$lib/state/types";

/** Dispatched on the window when a checkpoint projection is applied. */
export const E2E_CHECKPOINT_APPLIED_EVENT = "lyra:e2e-checkpoint-applied";

export const E2E_CHECKPOINT_IDS = [
  "chapter-1-right-portrait-dialogue",
  "chapter-1-investigation-explore",
  "chapter-1-investigation-with-kagami-summary",
  "chapter-1-scene-navigation-locked",
  "chapter-1-scene-navigation-eligible",
] as const;

export type E2eCheckpointId = (typeof E2E_CHECKPOINT_IDS)[number];

export type E2eCheckpointProjection = {
  chapterId: string;
  sceneId: string;
  mode: "dialogue" | "explore" | "interrogation" | "gameComplete";
  dialogue: {
    kind: "sceneTag" | "action" | "line";
    speaker: string | null;
    text: string;
    portraitCharacterId: string | null;
    portraitExpression: string | null;
    portraitAssetId: string | null;
  } | null;
  sublocationId: string | null;
  evidenceIds: string[];
  statementIds: string[];
  objectives: Array<{
    id: string;
    completed: boolean;
    activePrimary: boolean;
  }>;
  authorizationIds: string[];
  pendingAcquisition: {
    recordKind: "evidence" | "statement";
    recordId: string;
  } | null;
  sceneNavigationEligible: boolean;
  durableRevision: number;
};

export type E2eLoadCheckpointResult = {
  generation: number;
  state: GameStateView;
  projection: E2eCheckpointProjection;
};

export function checkpointGenerationAfter(
  previous: number,
  next: number,
): number {
  if (next <= previous) {
    throw new Error(
      `Checkpoint generation ${next} did not advance past ${previous}.`,
    );
  }
  return next;
}

type CoordinatedCheckpointResult<State, Projection> = {
  generation: number;
  state: State;
  projection: Projection;
};

export async function coordinateE2eCheckpointLoad<State, Projection>(
  id: E2eCheckpointId,
  previousGeneration: number,
  dependencies: {
    load: (
      selectedId: E2eCheckpointId,
    ) => Promise<CoordinatedCheckpointResult<State, Projection>>;
    applyState: (state: State) => Promise<void>;
    applyProjection: (projection: Projection) => void;
    settleProjection: () => Promise<void>;
    publishGeneration: (generation: number) => void;
  },
): Promise<CoordinatedCheckpointResult<State, Projection>> {
  const result = await dependencies.load(id);
  const generation = checkpointGenerationAfter(
    previousGeneration,
    result.generation,
  );
  await dependencies.applyState(result.state);
  dependencies.applyProjection(result.projection);
  await dependencies.settleProjection();
  dependencies.publishGeneration(generation);
  return result;
}
