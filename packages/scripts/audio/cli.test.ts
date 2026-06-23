import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAudioCli } from "./cli";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("audio cli", () => {
  it("routes generate to the command parser without exiting the process", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await runAudioCli(["generate"]);

      expect(code).toBe(2);
      expect(errorSpy).toHaveBeenCalledWith(
        "[audioCliMissingArg] Usage: audio:generate <plan.yaml> [--dry-run] [--only <id>] [--force]",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("prints diagnostic paths", async () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(
      repoRoot,
      "invalid.sound-plan.yaml",
      minimalPlan().replace("chapterId: chapter_1", "chapterId: 7"),
    );
    const stderr: string[] = [];

    const code = await runAudioCli(["validate", planPath], {
      repoRoot,
      cwd: repoRoot,
      stderr: (message) => stderr.push(message),
    });

    expect(code).toBe(2);
    expect(stderr).toContain(
      "[soundPlanChapterIdInvalid] chapterId: chapterId must be a string, got 7.",
    );
  });

  it("rejects unknown flags and extra positional args", async () => {
    const repoRoot = createRepoRoot();
    const stderr: string[] = [];

    const code = await runAudioCli(
      ["apply", "--force", "plan.yaml", "extra.yaml"],
      {
        repoRoot,
        cwd: repoRoot,
        stderr: (message) => stderr.push(message),
      },
    );

    expect(code).toBe(2);
    expect(stderr).toContain(
      '[audioCliUnknownFlag] --force: Unknown flag "--force". Usage: audio:apply <plan.yaml> [--check]',
    );
    expect(stderr).toContain(
      '[audioCliUnexpectedArg] extra.yaml: Unexpected argument "extra.yaml". Usage: audio:apply <plan.yaml> [--check]',
    );
  });

  it("rejects cue file paths outside authored story roots", async () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(
      repoRoot,
      "bad-paths.sound-plan.yaml",
      planWithCueFiles([
        "/tmp/outside.md",
        "docs/stories_plan/../escape.md",
        "README.md",
      ]),
    );
    const stderr: string[] = [];

    const code = await runAudioCli(["apply", planPath, "--check"], {
      repoRoot,
      cwd: repoRoot,
      stderr: (message) => stderr.push(message),
    });

    expect(code).toBe(2);
    expect(stderr).toContainEqual(
      expect.stringContaining("[audioApplyCueFileAbsolute] cues[0].file:"),
    );
    expect(stderr).toContainEqual(
      expect.stringContaining("[audioApplyCueFileTraversal] cues[1].file:"),
    );
    expect(stderr).toContainEqual(
      expect.stringContaining(
        "[audioApplyCueFileOutsideStoryRoot] cues[2].file:",
      ),
    );
  });

  it("does not write the catalog when corpus validation catches a bad visual unit", async () => {
    // The unknown-visual-unit failure used to surface at cue-application time
    // (audioApplyUnknownVisualUnit), after the catalog had been read and
    // merged. Corpus validation now catches it earlier
    // (soundPlanCueVisualUnitNotFound), before the catalog is touched, so the
    // catalog-on-failure guarantee still holds — and holds earlier.
    const repoRoot = createRepoRoot();
    writeChapterManifest(repoRoot);
    writeScene(
      repoRoot,
      "docs/stories_plan/chapter_1/scene_0.md",
      sceneSource(),
    );
    const catalogPath = join(repoRoot, "static/assets/config/audio.yaml");
    const originalCatalog = readFileSync(catalogPath, "utf-8");
    const planPath = writePlan(
      repoRoot,
      "unknown-unit.sound-plan.yaml",
      // First cue (tag_001) is #4a-compliant; second cue (tag_999) targets an
      // unknown visual unit so corpus validation fails before cue application.
      planWithExtraCue("docs/stories_plan/chapter_1/scene_0.md"),
    );
    const stderr: string[] = [];

    const code = await runAudioCli(["apply", planPath], {
      repoRoot,
      cwd: repoRoot,
      stderr: (message) => stderr.push(message),
    });

    expect(code).toBe(2);
    expect(stderr).toContainEqual(
      expect.stringContaining("[soundPlanCueVisualUnitNotFound]"),
    );
    expect(readFileSync(catalogPath, "utf-8")).toBe(originalCatalog);
  });

  it("reports drift paths in check mode without writing", async () => {
    const repoRoot = createRepoRoot();
    writeChapterManifest(repoRoot);
    const scenePath = "docs/stories_plan/chapter_1/scene_0.md";
    writeScene(repoRoot, scenePath, sceneSource());
    const catalogPath = join(repoRoot, "static/assets/config/audio.yaml");
    const originalCatalog = readFileSync(catalogPath, "utf-8");
    const originalScene = readFileSync(join(repoRoot, scenePath), "utf-8");
    const planPath = writePlan(
      repoRoot,
      "valid.sound-plan.yaml",
      planWithCue(scenePath),
    );
    const stderr: string[] = [];

    const code = await runAudioCli(["apply", planPath, "--check"], {
      repoRoot,
      cwd: repoRoot,
      stderr: (message) => stderr.push(message),
    });

    expect(code).toBe(2);
    expect(stderr).toContain("[audio] approved plan is not applied");
    expect(stderr).toContain(
      "[audio] changed: static/assets/config/audio.yaml",
    );
    expect(stderr).toContain(`[audio] changed: ${scenePath}`);
    expect(readFileSync(catalogPath, "utf-8")).toBe(originalCatalog);
    expect(readFileSync(join(repoRoot, scenePath), "utf-8")).toBe(
      originalScene,
    );
  });

  it("merges cues whose file paths are equivalent but spelled differently", async () => {
    // Regression: groupCuesByFile used the raw cue.file as the map key, so
    // `docs/stories_plan/chapter_1/scene_0.md` and
    // `./docs/stories_plan/chapter_1/scene_0.md` formed two groups. Both
    // resolved to the same fullPath, the original file was read twice, each
    // group applied independently, and the second write clobbered the first —
    // silently dropping the first group's cues. After normalization the two
    // collapse into one group and both cues land in the same write.
    const repoRoot = createRepoRoot();
    writeChapterManifest(repoRoot);
    const scenePath = "docs/stories_plan/chapter_1/scene_0.md";
    writeScene(repoRoot, scenePath, twoUnitSceneSource());
    const planPath = writePlan(
      repoRoot,
      "dual-spelling.sound-plan.yaml",
      planWithTwoCueSpellings(),
    );
    const stderr: string[] = [];

    const code = await runAudioCli(["apply", planPath], {
      repoRoot,
      cwd: repoRoot,
      stderr: (message) => stderr.push(message),
    });

    expect(code).toBe(0);
    const applied = readFileSync(join(repoRoot, scenePath), "utf-8");
    // tag_001 gets bgs_alpha (from the non-prefixed spelling);
    // tag_002 gets bgs_beta (from the ./-prefixed spelling). Both must survive.
    expect(applied).toContain("- **BGS:** bgs_alpha");
    expect(applied).toContain("- **BGS:** bgs_beta");
  });
});

function createRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lyra-audio-cli-"));
  tempRoots.push(root);
  mkdirSync(join(root, "static/assets/config"), { recursive: true });
  writeFileSync(
    join(root, "static/assets/config/audio.yaml"),
    "bgm: {}\nbgs: {}\nsfx: {}\n",
  );
  return root;
}

function writePlan(repoRoot: string, name: string, text: string): string {
  const path = join(repoRoot, name);
  writeFileSync(path, text);
  return path;
}

function writeScene(repoRoot: string, file: string, text: string): void {
  const path = join(repoRoot, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/**
 * Writes a minimal chapter.md manifest listing `scene_0.md` so corpus
 * validation (#4) has a manifest to check cues against.
 */
function writeChapterManifest(repoRoot: string): void {
  writeScene(
    repoRoot,
    "docs/stories_plan/chapter_1/chapter.md",
    [
      "# Chapter 1: Test",
      "**Summary:** A test chapter.",
      "## Scenes",
      "1. scene_0.md",
    ].join("\n") + "\n",
  );
}

function minimalPlan(): string {
  return `schemaVersion: 1
chapterId: chapter_1
sources: []
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries: []
cues: []
rejected: []
`;
}

function planWithCue(file: string, visualUnit = "tag_001"): string {
  return `schemaVersion: 1
chapterId: chapter_1
sources:
  - ${file}
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries:
  - id: rain_street_light
    channel: bgs
    status: approved
    loop: true
    intendedDurationSeconds: 30
    prompt: Steady light Tokyo street rain.
    reuseRationale: Exterior rain pool.
    evidence:
      - file: ${file}
        line: 3
        note: rainy street
cues:
  - file: ${file}
    visualUnit: ${visualUnit}
    bgm: none
    bgs: rain_street_light
rejected: []
`;
}

/**
 * A plan whose first cue (#4a-compliant: both BGM and BGS explicit) coexists
 * with an extra cue targeting an unknown visual unit, so callers can exercise
 * failure paths that run after corpus validation passes.
 */
function planWithExtraCue(
  file: string,
  firstUnit = "tag_001",
  extraUnit = "tag_999",
): string {
  const base = planWithCue(file, firstUnit);
  const extraCue = `  - file: ${file}
    visualUnit: ${extraUnit}
    bgm: none
    bgs: rain_street_light`;
  return base.replace(
    /cues:\n([\s\S]*?)rejected: \[\]\n/,
    `cues:\n$1${extraCue}\nrejected: []\n`,
  );
}

function planWithCueFiles(files: string[]): string {
  const cues = files
    .map(
      (file) => `  - file: ${JSON.stringify(file)}
    visualUnit: tag_001
    bgs: rain_street_light`,
    )
    .join("\n");
  return `${planWithCue(
    files[0] ?? "docs/stories_plan/chapter_1/scene_0.md",
  ).replace(
    /cues:\n(?:.|\n)*?rejected: \[\]\n/,
    `cues:\n${cues}\nrejected: []\n`,
  )}`;
}

function sceneSource(): string {
  return `# Scene 0

[場景：街道，雨。]
- **Background Prompt:** Rain street.

**相馬律**：走吧。
`;
}

/** A scene with two visual units (tag_001, tag_002) for multi-cue apply tests. */
function twoUnitSceneSource(): string {
  return `# Scene 0

[場景：街道，雨。]
- **Background Prompt:** Rain street.

**相馬律**：走吧。

[場景：店內，暖光。]
- **Background Prompt:** Shop interior.

**相馬律**：進來吧。
`;
}

/**
 * A plan with two cues targeting the same scene file via two equivalent path
 * spellings (one bare, one `./`-prefixed), each setting a distinct BGS on a
 * distinct visual unit. Both entries are approved so apply proceeds to write.
 */
function planWithTwoCueSpellings(): string {
  return `schemaVersion: 1
chapterId: chapter_1
sources:
  - docs/stories_plan/chapter_1/scene_0.md
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries:
  - id: bgs_alpha
    channel: bgs
    status: approved
    loop: true
    intendedDurationSeconds: 30
    prompt: Alpha bed.
    reuseRationale: Alpha pool.
    evidence:
      - file: docs/stories_plan/chapter_1/scene_0.md
        line: 3
        note: alpha scene
  - id: bgs_beta
    channel: bgs
    status: approved
    loop: true
    intendedDurationSeconds: 30
    prompt: Beta bed.
    reuseRationale: Beta pool.
    evidence:
      - file: docs/stories_plan/chapter_1/scene_0.md
        line: 8
        note: beta scene
cues:
  - file: docs/stories_plan/chapter_1/scene_0.md
    visualUnit: tag_001
    bgm: none
    bgs: bgs_alpha
  - file: ./docs/stories_plan/chapter_1/scene_0.md
    visualUnit: tag_002
    bgs: bgs_beta
rejected: []
`;
}
