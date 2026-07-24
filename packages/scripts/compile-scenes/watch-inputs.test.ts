import { describe, expect, it } from "vitest";
import { compileScenesWatchInputs } from "./watch-inputs";

describe("compileScenesWatchInputs", () => {
  it("observes both root catalogs alongside only the existing chapter and asset patterns", () => {
    expect(
      compileScenesWatchInputs(
        ["/repo/static/stories_plan", "/repo/docs/stories_plan"],
        "/repo/static/assets/config",
      ),
    ).toEqual([
      "/repo/static/stories_plan/story_catalog.md",
      "/repo/docs/stories_plan/story_catalog.md",
      "/repo/static/stories_plan/chapter_*/*.md",
      "/repo/docs/stories_plan/chapter_*/*.md",
      "/repo/static/stories_plan/chapter_*/*.layout.json",
      "/repo/docs/stories_plan/chapter_*/*.layout.json",
      "/repo/static/assets/config/**/*.yaml",
    ]);
  });
});
