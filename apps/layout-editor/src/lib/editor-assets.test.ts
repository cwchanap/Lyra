import { describe, expect, it } from "vitest";
import { publicPathForEditorAsset } from "./editor-assets";

// Cross-check: these cases MUST produce the same output as
// publicPathForStoryAsset() in apps/game/src/lib/assets/story-assets.ts.
// If you change either function, update both and keep both test suites passing.
const CROSS_CHECK_CASES: Array<{
  assetId: string;
  type: "background" | "portrait" | "standee" | "evidence";
  expected: string;
}> = [
  {
    assetId: "portrait.hayasaka_akane.concerned",
    type: "portrait",
    expected: "/assets/portraits/hayasaka_akane/concerned.png",
  },
  {
    assetId: "standee.hayasaka_akane.standard",
    type: "standee",
    expected: "/assets/standees/hayasaka_akane/standard.png",
  },
  {
    assetId: "background.chapter_1.scene_0.tag_001",
    type: "background",
    expected: "/assets/backgrounds/chapter_1/scene_0/tag_001.png",
  },
  {
    assetId: "evidence.coffee_receipt",
    type: "evidence",
    expected: "/assets/evidence/coffee_receipt.png",
  },
];

describe("publicPathForEditorAsset", () => {
  it("maps Lyra background, portrait, evidence, and standee asset IDs to static asset URLs", () => {
    expect(
      publicPathForEditorAsset(
        "background.chapter_1.investigation_scene_1.main_hall",
        "background",
      ),
    ).toBe("/assets/backgrounds/chapter_1/investigation_scene_1/main_hall.png");

    expect(
      publicPathForEditorAsset("portrait.witness.standard", "portrait"),
    ).toBe("/assets/portraits/witness/standard.png");

    expect(
      publicPathForEditorAsset("evidence.coffee_receipt", "evidence"),
    ).toBe("/assets/evidence/coffee_receipt.png");

    expect(
      publicPathForEditorAsset("standee.witness.standard", "standee"),
    ).toBe("/assets/standees/witness/standard.png");
  });

  it("throws for malformed portrait assetIds with too few segments", () => {
    expect(() => publicPathForEditorAsset("portrait-only", "portrait")).toThrow(
      /expected exactly 3/,
    );
  });

  it("throws for malformed standee assetIds with too few segments", () => {
    expect(() => publicPathForEditorAsset("standee", "standee")).toThrow(
      /expected exactly 3/,
    );
  });

  it("throws for portrait assetIds with too many segments", () => {
    expect(() =>
      publicPathForEditorAsset("portrait.witness.standard.extra", "portrait"),
    ).toThrow(/expected exactly 3/);
  });

  it("throws for standee assetIds with too many segments", () => {
    expect(() =>
      publicPathForEditorAsset("standee.witness.standard.extra", "standee"),
    ).toThrow(/expected exactly 3/);
  });

  it("cross-check: produces identical paths to publicPathForStoryAsset for shared types", () => {
    for (const { assetId, type, expected } of CROSS_CHECK_CASES) {
      expect(publicPathForEditorAsset(assetId, type)).toBe(expected);
    }
  });
});
