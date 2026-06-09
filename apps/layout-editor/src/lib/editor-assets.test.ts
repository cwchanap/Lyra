import { describe, expect, it } from "vitest";
import { publicPathForEditorAsset } from "./editor-assets";

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
      /expected at least 3/,
    );
  });

  it("throws for malformed standee assetIds with too few segments", () => {
    expect(() => publicPathForEditorAsset("standee", "standee")).toThrow(
      /expected at least 3/,
    );
  });
});
