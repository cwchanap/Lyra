import type { E2eCheckpointId } from "./checkpoints";
import { E2E_CHECKPOINT_APPLIED_EVENT } from "./checkpoints";
import { loadE2eCheckpointThroughClient } from "$lib/state/game-client.svelte";

export type E2eCheckpointBrowserBridge = {
  loadCheckpoint: (id: E2eCheckpointId) => Promise<void>;
};

export type E2eCheckpointBridgeHost = {
  __lyraE2e?: E2eCheckpointBrowserBridge;
};

export function installE2eCheckpointBridge(
  host: E2eCheckpointBridgeHost,
  loadCheckpoint: (id: E2eCheckpointId) => Promise<void>,
): () => void {
  const bridge = { loadCheckpoint } satisfies E2eCheckpointBrowserBridge;
  host.__lyraE2e = bridge;
  return () => {
    if (host.__lyraE2e === bridge) delete host.__lyraE2e;
  };
}

export function installPackagedE2eCheckpointBridge(
  host: E2eCheckpointBridgeHost & Window,
  publishGeneration: (generation: number) => void,
): () => void {
  let generation = 0;
  return installE2eCheckpointBridge(host, async (id) => {
    await loadE2eCheckpointThroughClient(id, generation, {
      applyProjection: (projection) => {
        host.dispatchEvent(
          new CustomEvent(E2E_CHECKPOINT_APPLIED_EVENT, {
            detail: projection,
          }),
        );
      },
      publishGeneration: (next) => {
        generation = next;
        publishGeneration(next);
      },
    });
  });
}
