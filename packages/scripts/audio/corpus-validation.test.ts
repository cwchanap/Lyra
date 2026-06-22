import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOURCE_ROOTS,
  loadCorpusForPlan,
  validateSoundPlanAgainstCorpus,
  type CorpusData,
} from "./corpus-validation";
import type { SoundPlan, SoundPlanCue } from "./types";

function minimalPlan(overrides: { cues?: SoundPlanCue[] } = {}): SoundPlan {
  return {
    schemaVersion: 1,
    chapterId: "chapter_1",
    sources: [],
    catalogSnapshot: { bgm: [], bgs: [], sfx: [] },
    entries: [],
    cues: overrides.cues ?? [],
    rejected: [],
  };
}

/** A two-scene corpus where scene_0 has two visual units (tag_001, tag_002). */
function twoSceneCorpus(): CorpusData {
  const scene0 = [
    "[場景：第一個畫面，開場靜默。]",
    "- **Background Prompt:** Opening silence.",
    "- **BGM:** none",
    "- **BGS:** none",
    "",
    "[場景：第二個畫面，走廊。]",
    "- **Background Prompt:** Corridor.",
    "- **BGS:** bgs_institutional_corridor",
  ].join("\n");
  const scene1 = ["[場景：辦公室。]", "- **Background Prompt:** Office."].join(
    "\n",
  );
  return {
    chapterSceneFiles: ["scene_0.md", "scene_1.md"],
    sceneSources: new Map([
      ["scene_0.md", scene0],
      ["scene_1.md", scene1],
    ]),
  };
}

describe("validateSoundPlanAgainstCorpus — cue file vs chapter manifest (#4b)", () => {
  it("reports nothing when every cue file basename is in the chapter manifest", () => {
    const data = twoSceneCorpus();
    const plan = minimalPlan({
      cues: [
        {
          file: "docs/stories_plan/chapter_1/scene_0.md",
          visualUnit: "tag_001",
          bgm: "none",
          bgs: "none",
        },
        {
          file: "static/stories_plan/chapter_1/scene_1.md",
          visualUnit: "tag_001",
          bgm: "none",
          bgs: "none",
        },
      ],
    });
    expect(validateSoundPlanAgainstCorpus(plan, data)).toEqual([]);
  });

  it("reports a diagnostic when a cue targets a file not in the chapter manifest", () => {
    const data = twoSceneCorpus();
    const plan = minimalPlan({
      cues: [
        {
          file: "docs/stories_plan/chapter_1/scene_0.md",
          visualUnit: "tag_001",
          bgm: "none",
          bgs: "none",
        },
        {
          file: "docs/stories_plan/chapter_1/ghost_scene.md",
          visualUnit: "tag_001",
          bgm: "none",
          bgs: "none",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe("soundPlanCueFileNotInManifest");
    expect(diags[0]?.message).toContain("ghost_scene.md");
  });
});

describe("validateSoundPlanAgainstCorpus — first visual unit BGM+BGS (#4a)", () => {
  it("reports a diagnostic when the corpus-first visual unit has no cue at all", () => {
    const data = twoSceneCorpus();
    // Plan skips tag_001 entirely and starts at tag_002.
    const plan = minimalPlan({
      cues: [
        {
          file: "docs/stories_plan/chapter_1/scene_0.md",
          visualUnit: "tag_002",
          bgs: "bgs_institutional_corridor",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    expect(
      diags.some((d) => d.code === "soundPlanFirstVisualUnitMissingCue"),
    ).toBe(true);
  });

  it("reports a diagnostic when the first-visual-unit cue omits BGM", () => {
    const data = twoSceneCorpus();
    const plan = minimalPlan({
      cues: [
        {
          file: "docs/stories_plan/chapter_1/scene_0.md",
          visualUnit: "tag_001",
          bgs: "none",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    expect(
      diags.some((d) => d.code === "soundPlanFirstVisualUnitMissingChannel"),
    ).toBe(true);
    expect(diags.some((d) => d.message.includes("BGM"))).toBe(true);
  });

  it("reports a diagnostic when the first-visual-unit cue omits BGS", () => {
    const data = twoSceneCorpus();
    const plan = minimalPlan({
      cues: [
        {
          file: "docs/stories_plan/chapter_1/scene_0.md",
          visualUnit: "tag_001",
          bgm: "none",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    expect(
      diags.some((d) => d.code === "soundPlanFirstVisualUnitMissingChannel"),
    ).toBe(true);
    expect(diags.some((d) => d.message.includes("BGS"))).toBe(true);
  });

  it("accepts the first-visual-unit cue when both BGM and BGS are explicit (none allowed)", () => {
    const data = twoSceneCorpus();
    const plan = minimalPlan({
      cues: [
        {
          file: "docs/stories_plan/chapter_1/scene_0.md",
          visualUnit: "tag_001",
          bgm: "none",
          bgs: "none",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    expect(
      diags.filter(
        (d) =>
          d.code === "soundPlanFirstVisualUnitMissingCue" ||
          d.code === "soundPlanFirstVisualUnitMissingChannel",
      ),
    ).toEqual([]);
  });

  it("uses corpus order, not plan.cues order, to find the first visual unit", () => {
    const data = twoSceneCorpus();
    // Cue for scene_1 appears first in the array, but scene_0/tag_001 is the
    // corpus-first visual unit and must still be satisfied.
    const plan = minimalPlan({
      cues: [
        {
          file: "docs/stories_plan/chapter_1/scene_1.md",
          visualUnit: "tag_001",
          bgm: "none",
          bgs: "none",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    expect(
      diags.some((d) => d.code === "soundPlanFirstVisualUnitMissingCue"),
    ).toBe(true);
  });
});

describe("loadCorpusForPlan — disk loader", () => {
  function writeChapter(repoRoot: string): void {
    const dir = join(repoRoot, "docs/stories_plan/chapter_1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "chapter.md"),
      [
        "# Chapter 1: Test",
        "**Summary:** A test chapter.",
        "## Scenes",
        "1. scene_0.md",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "scene_0.md"),
      ["[場景：開場。]", "- **Background Prompt:** Opening."].join("\n"),
    );
  }

  it("loads the chapter manifest and scene sources from disk", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lyra-corpus-load-"));
    writeChapter(repoRoot);
    const result = loadCorpusForPlan(minimalPlan(), {
      repoRoot,
      sourceRoots: ["docs/stories_plan"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.chapterSceneFiles).toEqual(["scene_0.md"]);
    expect(result.data.sceneSources.has("scene_0.md")).toBe(true);
  });

  it("reports a diagnostic when the chapter directory is not found under any root", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lyra-corpus-missing-"));
    const result = loadCorpusForPlan(minimalPlan(), {
      repoRoot,
      sourceRoots: DEFAULT_SOURCE_ROOTS,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.diagnostics.some((d) => d.code === "soundPlanChapterDirNotFound"),
    ).toBe(true);
  });

  it("reports a diagnostic when chapter.md is missing inside the chapter directory", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lyra-corpus-nomanifest-"));
    mkdirSync(join(repoRoot, "docs/stories_plan/chapter_1"), {
      recursive: true,
    });
    const result = loadCorpusForPlan(minimalPlan(), {
      repoRoot,
      sourceRoots: ["docs/stories_plan"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.diagnostics.some(
        (d) => d.code === "soundPlanChapterManifestMissing",
      ),
    ).toBe(true);
  });
});
