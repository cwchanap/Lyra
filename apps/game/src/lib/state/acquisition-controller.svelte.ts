import { acknowledgeAcquisitionEvent, gameState } from "./game-client.svelte";
import type { GameStateView, PendingAcquisitionView } from "./types";

type AcquisitionControllerDependencies = {
  gameState: { value: GameStateView | null };
  acknowledge: (eventId: string) => Promise<GameStateView | null>;
};

export type AcquisitionController = {
  readonly current: PendingAcquisitionView | null;
  readonly blocking: boolean;
  readonly busy: boolean;
  dismissCurrent: (expectedEventId: string) => Promise<void>;
  clear: () => void;
};

export function createAcquisitionController(
  dependencies: AcquisitionControllerDependencies,
): AcquisitionController {
  let busy = $state(false);
  let generation = 0;

  function current() {
    return dependencies.gameState.value?.pendingAcquisition ?? null;
  }

  async function dismissCurrent(expectedEventId: string): Promise<void> {
    if (busy || current()?.id !== expectedEventId) return;
    const attempt = ++generation;
    busy = true;
    try {
      await dependencies.acknowledge(expectedEventId);
    } finally {
      if (attempt === generation) busy = false;
    }
  }

  return {
    get current() {
      return current();
    },
    get blocking() {
      return current() !== null;
    },
    get busy() {
      return busy;
    },
    dismissCurrent,
    clear() {
      generation += 1;
      busy = false;
    },
  };
}

export const acquisitionController = createAcquisitionController({
  gameState,
  acknowledge: acknowledgeAcquisitionEvent,
});
