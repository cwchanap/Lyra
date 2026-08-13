import { describe, expect, expectTypeOf, it } from "vitest";
import {
  coordinateE2eCheckpointLoad,
  E2E_CHECKPOINT_IDS,
  checkpointGenerationAfter,
  type E2eCheckpointId,
} from "./checkpoints";

type ExpectedCheckpointId =
  | "chapter-1-right-portrait-dialogue"
  | "chapter-1-investigation-explore"
  | "chapter-1-investigation-with-kagami-summary"
  | "chapter-1-scene-navigation-locked"
  | "chapter-1-scene-navigation-eligible"
  | "chapter-1-analysis-beat-85-ready";

describe("packaged E2E checkpoint contract", () => {
  it("exposes exactly the Rust checkpoint wire IDs", () => {
    expect(E2E_CHECKPOINT_IDS).toEqual([
      "chapter-1-right-portrait-dialogue",
      "chapter-1-investigation-explore",
      "chapter-1-investigation-with-kagami-summary",
      "chapter-1-scene-navigation-locked",
      "chapter-1-scene-navigation-eligible",
      "chapter-1-analysis-beat-85-ready",
    ]);
    expectTypeOf<E2eCheckpointId>().toEqualTypeOf<ExpectedCheckpointId>();
  });

  it("rejects a checkpoint generation that cannot advance the rendered marker", () => {
    expect(checkpointGenerationAfter(8, 9)).toBe(9);
    expect(() => checkpointGenerationAfter(8, 8)).toThrow(
      "Checkpoint generation 8 did not advance past 8.",
    );
    expect(() => checkpointGenerationAfter(8, 7)).toThrow(
      "Checkpoint generation 7 did not advance past 8.",
    );
  });

  it("publishes the generation only after client state and projection effects settle", async () => {
    const order: string[] = [];
    const state = { identity: "checkpoint-state" };
    const projection = { sceneNavigationEligible: true };

    const result = await coordinateE2eCheckpointLoad(
      "chapter-1-scene-navigation-eligible",
      11,
      {
        load: async (id) => {
          order.push(`load:${id}`);
          return { generation: 12, state, projection };
        },
        applyState: async (next) => {
          expect(next).toBe(state);
          order.push("apply-state");
        },
        applyProjection: (next) => {
          expect(next).toBe(projection);
          order.push("apply-projection");
        },
        settleProjection: async () => {
          order.push("settle-projection");
        },
        publishGeneration: (generation) => {
          expect(generation).toBe(12);
          order.push("publish-generation");
        },
      },
    );

    expect(result).toEqual({ generation: 12, state, projection });
    expect(order).toEqual([
      "load:chapter-1-scene-navigation-eligible",
      "apply-state",
      "apply-projection",
      "settle-projection",
      "publish-generation",
    ]);
  });
});
