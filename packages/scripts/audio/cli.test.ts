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
  it("routes generate to the Task 8 stub without exiting the process", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await runAudioCli(["generate"]);

      expect(code).toBe(2);
      expect(errorSpy).toHaveBeenCalledWith(
        "[audio] audio:generate is not implemented until Task 8.",
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

  it("does not write the catalog when later cue application fails", async () => {
    const repoRoot = createRepoRoot();
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
      planWithCue("docs/stories_plan/chapter_1/scene_0.md", "tag_999"),
    );
    const stderr: string[] = [];

    const code = await runAudioCli(["apply", planPath], {
      repoRoot,
      cwd: repoRoot,
      stderr: (message) => stderr.push(message),
    });

    expect(code).toBe(2);
    expect(stderr).toContainEqual(
      expect.stringContaining("[audioApplyUnknownVisualUnit]"),
    );
    expect(readFileSync(catalogPath, "utf-8")).toBe(originalCatalog);
  });

  it("reports drift paths in check mode without writing", async () => {
    const repoRoot = createRepoRoot();
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
    bgs: rain_street_light
rejected: []
`;
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
