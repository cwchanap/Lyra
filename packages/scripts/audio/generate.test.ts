import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planGeneration } from "./generate";
import type { SoundPlanChannel, SoundPlanStatus } from "./types";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("audio generation planning", () => {
  it("plans approved missing entries in dry-run mode", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: false,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.toGenerate).toHaveLength(1);
    expect(result.toGenerate[0].entry.id).toBe("rain_street_light");
    expect(result.toGenerate[0].outputPath).toBe(
      "static/assets/audio/bgs/rain_street_light.ogg",
    );
  });

  it("requires an API key for non-dry-run generation", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: false,
      force: false,
    });

    expect(result.toGenerate).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "audioGenerateMissingApiKey",
      }),
    );
  });

  it("does not require an API key when all eligible outputs already exist", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);
    writeFile(
      repoRoot,
      "static/assets/audio/bgs/rain_street_light.ogg",
      "already generated",
    );

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: false,
      force: false,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.toGenerate).toEqual([]);
  });

  it("skips existing outputs unless forced", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);
    writeFile(
      repoRoot,
      "static/assets/audio/bgs/rain_street_light.ogg",
      "already generated",
    );

    const skipped = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: false,
    });
    const forced = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: true,
    });

    expect(skipped.diagnostics).toEqual([]);
    expect(skipped.toGenerate).toEqual([]);
    expect(forced.diagnostics).toEqual([]);
    expect(forced.toGenerate.map((target) => target.entry.id)).toEqual([
      "rain_street_light",
    ]);
  });

  it("plans only approved and generated entries", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({ id: "approved_rain", channel: "bgs", status: "approved" }),
      soundEntry({ id: "generated_rain", channel: "bgs", status: "generated" }),
      soundEntry({ id: "proposed_rain", channel: "bgs", status: "proposed" }),
      soundEntry({ id: "rejected_rain", channel: "bgs", status: "rejected" }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: false,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.toGenerate.map((target) => target.entry.id)).toEqual([
      "approved_rain",
      "generated_rain",
    ]);
  });

  it("filters planned generation by entry id", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({ id: "first_rain", channel: "bgs", status: "approved" }),
      soundEntry({ id: "second_rain", channel: "bgs", status: "approved" }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: false,
      only: "second_rain",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.toGenerate.map((target) => target.outputPath)).toEqual([
      "static/assets/audio/bgs/second_rain.ogg",
    ]);
  });

  it("reports an unknown --only target before API key enforcement", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: false,
      force: false,
      only: "typo",
    });

    expect(result.toGenerate).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "audioGenerateOnlyNotFound",
        path: "--only",
        message: expect.stringContaining("typo"),
      }),
    ]);
  });
});

function createRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lyra-audio-generate-"));
  tempRoots.push(root);
  return root;
}

function writePlan(repoRoot: string, entries: string[]): string {
  const planPath = join(repoRoot, "docs/audio_plans/missing.sound-plan.yaml");
  writeFile(
    repoRoot,
    "docs/audio_plans/missing.sound-plan.yaml",
    `schemaVersion: 1
chapterId: chapter_1
sources:
  - docs/stories_plan/chapter_1/scene_0.md
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries:
${entries.join("")}cues: []
rejected: []
`,
  );
  return planPath;
}

function soundEntry(input: {
  id: string;
  channel: SoundPlanChannel;
  status: SoundPlanStatus;
}): string {
  return `  - id: ${input.id}
    channel: ${input.channel}
    status: ${input.status}
    loop: true
    intendedDurationSeconds: 30
    prompt: "Steady light Tokyo street rain."
    reuseRationale: "Exterior rain pool."
    evidence:
      - file: docs/stories_plan/chapter_1/scene_0.md
        line: 3
        note: "rainy street"
`;
}

function writeFile(repoRoot: string, path: string, text: string): void {
  const fullPath = join(repoRoot, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, text);
}
