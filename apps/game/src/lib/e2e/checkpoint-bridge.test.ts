import { describe, expect, it } from "vitest";
import {
  installE2eCheckpointBridge,
  type E2eCheckpointBridgeHost,
} from "./checkpoint-bridge.svelte";

describe("packaged checkpoint browser bridge", () => {
  it("exposes the typed loader only for the bridge lifetime", async () => {
    const host: E2eCheckpointBridgeHost = {};
    const loaded: string[] = [];
    const dispose = installE2eCheckpointBridge(host, async (id) => {
      loaded.push(id);
    });

    expect(host.__lyraE2e).toBeDefined();
    await host.__lyraE2e!.loadCheckpoint("chapter-1-investigation-explore");
    expect(loaded).toEqual(["chapter-1-investigation-explore"]);

    dispose();
    expect(host.__lyraE2e).toBeUndefined();
  });
});
