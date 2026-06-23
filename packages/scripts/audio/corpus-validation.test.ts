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
    chapterRoot: "docs/stories_plan/chapter_1",
    chapterSceneFiles: ["scene_0.md", "scene_1.md"],
    sceneSources: new Map([
      ["scene_0.md", scene0],
      ["scene_1.md", scene1],
    ]),
  };
}

describe("validateSoundPlanAgainstCorpus — cue file vs chapter manifest (#4b)", () => {
  it("reports nothing when every cue file resolves into the plan's chapter root", () => {
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
          file: "docs/stories_plan/chapter_1/scene_1.md",
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

  it("rejects a cross-chapter cue whose basename is in this chapter's manifest", () => {
    // Regression: a chapter_1 plan that accidentally points at chapter_2's
    // scene_0.md used to pass because only the basename was compared. apply
    // would then write BGM/BGS metadata into chapter_2's file while reporting
    // OK. The basename matches the manifest, so the path-prefix check is the
    // only thing that catches it.
    const data = twoSceneCorpus();
    const plan = minimalPlan({
      cues: [
        {
          file: "docs/stories_plan/chapter_2/scene_0.md",
          visualUnit: "tag_001",
          bgm: "none",
          bgs: "none",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    const notInManifest = diags.filter(
      (d) => d.code === "soundPlanCueFileNotInManifest",
    );
    expect(notInManifest).toHaveLength(1);
    expect(notInManifest[0]?.message).toContain("chapter_2/scene_0.md");
  });

  it("rejects a cross-root cue whose basename is in this chapter's manifest", () => {
    // chapter_1 lives under docs/stories_plan in this corpus; a cue pointing
    // at static/stories_plan/chapter_1/scene_0.md must be rejected even though
    // the basename matches, because the chapter is not actually rooted there.
    const data = twoSceneCorpus();
    const plan = minimalPlan({
      cues: [
        {
          file: "static/stories_plan/chapter_1/scene_0.md",
          visualUnit: "tag_001",
          bgm: "none",
          bgs: "none",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    const notInManifest = diags.filter(
      (d) => d.code === "soundPlanCueFileNotInManifest",
    );
    expect(notInManifest).toHaveLength(1);
  });
});

describe("validateSoundPlanAgainstCorpus — cue visualUnit vs scene visual units (#4c)", () => {
  it("reports a diagnostic when a cue targets a visual unit not present in the scene", () => {
    // Regression: a typo like `tag_999` used to pass audio:validate because the
    // cue loop only checked the file path against the manifest, not the
    // visualUnit against the scene's indexed units. The failure was deferred
    // to audio:apply, defeating validate as the review gate for durable plans.
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
          file: "docs/stories_plan/chapter_1/scene_0.md",
          visualUnit: "tag_999",
          bgm: "none",
          bgs: "none",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe("soundPlanCueVisualUnitNotFound");
    expect(diags[0]?.path).toBe("cues[1].visualUnit");
    expect(diags[0]?.message).toContain("tag_999");
    expect(diags[0]?.message).toContain("tag_001");
  });

  it("accepts a cue whose visualUnit matches an indexed unit in the scene", () => {
    const data = twoSceneCorpus();
    // Include the #4a first-visual-unit cue (tag_001 with both BGM+BGS) so the
    // only thing under test is whether tag_002 is recognized as a valid unit.
    const plan = minimalPlan({
      cues: [
        {
          file: "docs/stories_plan/chapter_1/scene_0.md",
          visualUnit: "tag_001",
          bgm: "none",
          bgs: "none",
        },
        {
          file: "docs/stories_plan/chapter_1/scene_0.md",
          visualUnit: "tag_002",
          bgm: "none",
          bgs: "none",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    expect(diags).toEqual([]);
  });

  it("does not run the visual-unit check when the cue file is not in the manifest", () => {
    // A file-not-in-manifest cue already gets soundPlanCueFileNotInManifest;
    // it must not also get a visualUnit diagnostic (the scene source is not
    // available for a non-manifest file).
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
          visualUnit: "tag_999",
          bgm: "none",
          bgs: "none",
        },
      ],
    });
    const diags = validateSoundPlanAgainstCorpus(plan, data);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe("soundPlanCueFileNotInManifest");
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

  it("surfaces a diagnostic for an unreadable scene file instead of silently skipping it", () => {
    // The chapter manifest lists scene_0.md (readable) and scene_1.md. We make
    // scene_1.md a directory: existsSync passes, but readFileSync throws
    // (EISDIR) — a deterministic, permission-independent stand-in for any
    // unreadable-scene condition (EACCES, encoding error, ...). Previously
    // this was swallowed and the #4a first-visual-unit check ran on degraded
    // data while reporting OK.
    const repoRoot = mkdtempSync(join(tmpdir(), "lyra-corpus-unreadable-"));
    const dir = join(repoRoot, "docs/stories_plan/chapter_1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "chapter.md"),
      [
        "# Chapter 1: Test",
        "**Summary:** A test chapter.",
        "## Scenes",
        "1. scene_0.md",
        "2. scene_1.md",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "scene_0.md"),
      ["[場景：開場。]", "- **Background Prompt:** Opening."].join("\n"),
    );
    // scene_1.md is a directory — exists, but cannot be read as a file.
    mkdirSync(join(dir, "scene_1.md"));

    const result = loadCorpusForPlan(minimalPlan(), {
      repoRoot,
      sourceRoots: ["docs/stories_plan"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.diagnostics.some((d) => d.code === "soundPlanSceneUnreadable"),
    ).toBe(true);
    expect(
      result.diagnostics.some((d) => d.message.includes("scene_1.md")),
    ).toBe(true);
  });
});
