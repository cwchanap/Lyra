import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditBackgroundCues,
  backgroundCueAuditShouldFail,
  checkBackgroundAuditCoverage,
  type BackgroundCueAuditItem,
  type BackgroundCueAuditResult,
} from "./background-cues-audit";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

type FixtureInput = {
  chapters: unknown;
  assetManifest: unknown;
  scenes?: Record<string, unknown>;
  files?: Array<{ path: string; contents?: string }>;
};

function createFixture(input: FixtureInput): { repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "lyra-background-cues-audit-"));
  tempRoots.push(repoRoot);

  const scenesRoot = join(repoRoot, "apps/game/src-tauri/resources/scenes");
  const assetsRoot = join(repoRoot, "apps/game/src-tauri/resources/assets");
  writeJson(join(scenesRoot, "chapters.json"), input.chapters);
  writeJson(join(assetsRoot, "manifest.json"), input.assetManifest);

  for (const [sceneFile, scene] of Object.entries(input.scenes ?? {})) {
    const scenePath = join(scenesRoot, sceneFile);
    mkdirSync(dirname(scenePath), { recursive: true });
    writeFileSync(
      scenePath,
      typeof scene === "string" ? scene : JSON.stringify(scene, null, 2),
    );
  }

  for (const file of input.files ?? []) {
    const filePath = join(repoRoot, file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.contents ?? "fixture");
  }

  return { repoRoot };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
}

function chapterManifest(
  scenes: Array<{ type: string; file: string }>,
): Record<string, unknown> {
  return {
    chapters: [
      {
        id: "chapter_1",
        title: "Fixture chapter",
        summary: "Fixture chapter for the background-cue audit.",
        scenes,
      },
    ],
  };
}

function assetManifest(
  entries: Array<{ assetId: string; type: string; expectedPath: string }>,
): Record<string, unknown> {
  return { enabled: true, entries };
}

function cue(backgroundAssetId: string | null): Record<string, unknown> {
  return {
    kind: "sceneTag",
    text: "Fixture visual cue.",
    assetCue: { backgroundAssetId },
  };
}

describe("auditBackgroundCues", () => {
  it("preserves repeated background cue occurrences that reuse an asset ID", () => {
    const { repoRoot } = createFixture({
      chapters: chapterManifest([
        { type: "linear", file: "chapter_1/scene_1.json" },
      ]),
      assetManifest: assetManifest([
        {
          assetId: "background.shared",
          type: "background",
          expectedPath: "static/assets/backgrounds/shared.png",
        },
      ]),
      scenes: {
        "chapter_1/scene_1.json": {
          type: "linear",
          queue: [cue("background.shared"), cue("background.shared")],
        },
      },
      files: [{ path: "static/assets/backgrounds/shared.png" }],
    });

    const result = auditBackgroundCues({ repoRoot, chapterId: "chapter_1" });

    expect(result.problems).toEqual([]);
    expect(result.items).toMatchObject([
      {
        cueKey: "chapter_1/scene_1.json::/queue/0/assetCue/backgroundAssetId",
        sceneFile: "chapter_1/scene_1.json",
        sceneType: "linear",
        cuePath: "/queue/0/assetCue/backgroundAssetId",
        backgroundAssetId: "background.shared",
        expectedPath: "static/assets/backgrounds/shared.png",
        fileMissing: false,
      },
      {
        cueKey: "chapter_1/scene_1.json::/queue/1/assetCue/backgroundAssetId",
        sceneFile: "chapter_1/scene_1.json",
        sceneType: "linear",
        cuePath: "/queue/1/assetCue/backgroundAssetId",
        backgroundAssetId: "background.shared",
        expectedPath: "static/assets/backgrounds/shared.png",
        fileMissing: false,
      },
    ]);
  });

  it("retains a null background cue occurrence without inventing a missing file", () => {
    const { repoRoot } = createFixture({
      chapters: chapterManifest([
        { type: "linear", file: "chapter_1/scene_1.json" },
      ]),
      assetManifest: assetManifest([]),
      scenes: {
        "chapter_1/scene_1.json": {
          type: "linear",
          queue: [cue(null)],
        },
      },
    });

    const result = auditBackgroundCues({ repoRoot, chapterId: "chapter_1" });

    expect(result.problems).toEqual([]);
    expect(result.items).toEqual([
      {
        cueKey: "chapter_1/scene_1.json::/queue/0/assetCue/backgroundAssetId",
        sceneFile: "chapter_1/scene_1.json",
        sceneType: "linear",
        cuePath: "/queue/0/assetCue/backgroundAssetId",
        backgroundAssetId: null,
        expectedPath: null,
        fileMissing: false,
      },
    ]);
  });

  it("includes manifest-listed analysis intro result and outro cue carriers", () => {
    const { repoRoot } = createFixture({
      chapters: chapterManifest([
        { type: "analysis", file: "chapter_1/analysis_scene_3.json" },
      ]),
      assetManifest: assetManifest([
        {
          assetId: "background.analysis_intro",
          type: "background",
          expectedPath: "static/assets/backgrounds/analysis-intro.png",
        },
        {
          assetId: "background.analysis_result",
          type: "background",
          expectedPath: "static/assets/backgrounds/analysis-result.png",
        },
        {
          assetId: "background.analysis_outro",
          type: "background",
          expectedPath: "static/assets/backgrounds/analysis-outro.png",
        },
      ]),
      scenes: {
        "chapter_1/analysis_scene_3.json": {
          type: "analysis",
          intro: [cue("background.analysis_intro")],
          boards: [
            {
              common: {
                resultDialogue: [cue("background.analysis_result")],
              },
            },
          ],
          outro: [cue("background.analysis_outro")],
        },
      },
    });

    const result = auditBackgroundCues({ repoRoot, chapterId: "chapter_1" });

    expect(result.problems).toEqual([]);
    expect(result.items.map((item) => item.cuePath)).toEqual([
      "/intro/0/assetCue/backgroundAssetId",
      "/boards/0/common/resultDialogue/0/assetCue/backgroundAssetId",
      "/outro/0/assetCue/backgroundAssetId",
    ]);
    expect(result.items.every((item) => item.sceneType === "analysis")).toBe(
      true,
    );
  });

  it("marks a compiler-manifest background path missing on disk", () => {
    const { repoRoot } = createFixture({
      chapters: chapterManifest([
        { type: "linear", file: "chapter_1/scene_1.json" },
      ]),
      assetManifest: assetManifest([
        {
          assetId: "background.not_on_disk",
          type: "background",
          expectedPath: "static/assets/backgrounds/not-on-disk.png",
        },
      ]),
      scenes: {
        "chapter_1/scene_1.json": {
          type: "linear",
          queue: [cue("background.not_on_disk")],
        },
      },
    });

    const result = auditBackgroundCues({ repoRoot, chapterId: "chapter_1" });

    expect(result.problems).toEqual([]);
    expect(result.items[0]).toMatchObject({
      expectedPath: "static/assets/backgrounds/not-on-disk.png",
      fileMissing: true,
    });
  });

  it("reports malformed and missing compiled inputs instead of silently skipping them", () => {
    const { repoRoot } = createFixture({
      chapters: chapterManifest([
        { type: "linear", file: "chapter_1/good.json" },
        { type: "linear", file: "chapter_1/missing.json" },
        { type: "linear", file: "chapter_1/malformed.json" },
      ]),
      assetManifest: "{ malformed asset manifest",
      scenes: {
        "chapter_1/good.json": {
          type: "linear",
          queue: [cue("background.unlisted")],
        },
        "chapter_1/malformed.json": "{ malformed scene",
      },
    });

    const result = auditBackgroundCues({ repoRoot, chapterId: "chapter_1" });

    expect(result.items).toMatchObject([
      {
        sceneFile: "chapter_1/good.json",
        backgroundAssetId: "background.unlisted",
        expectedPath: null,
        fileMissing: false,
      },
    ]);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "assetManifestParseError" }),
        expect.objectContaining({
          kind: "sceneReadError",
          inputPath: "chapter_1/missing.json",
        }),
        expect.objectContaining({
          kind: "sceneParseError",
          inputPath: "chapter_1/malformed.json",
        }),
        expect.objectContaining({
          kind: "backgroundAssetMissingFromManifest",
          inputPath: "chapter_1/good.json",
        }),
      ]),
    );
  });
});

function auditItem(cueKey: string): BackgroundCueAuditItem {
  const [sceneFile, cuePath] = cueKey.split("::");
  if (!sceneFile || !cuePath) {
    throw new Error(`Fixture cue key must contain a scene and path: ${cueKey}`);
  }
  return {
    cueKey,
    sceneFile,
    sceneType: "linear",
    cuePath,
    backgroundAssetId: "background.fixture",
    expectedPath: "static/assets/backgrounds/fixture.png",
    fileMissing: false,
  };
}

function auditResult(cueKeys: string[]): BackgroundCueAuditResult {
  return { items: cueKeys.map(auditItem), problems: [] };
}

function cueDecisions(rows: string[][]): string {
  return [
    "## Cue decisions",
    "",
    "| Cue key | Decision | Priority |",
    "| --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

describe("checkBackgroundAuditCoverage", () => {
  const cueOne = "chapter_1/scene_1.json::/queue/0/assetCue/backgroundAssetId";
  const cueTwo = "chapter_1/scene_1.json::/queue/1/assetCue/backgroundAssetId";

  it("fails the audit gate when any cue file is missing", () => {
    const result = auditResult([cueOne]);
    result.items[0]!.fileMissing = true;

    expect(backgroundCueAuditShouldFail(result)).toBe(true);
  });

  it("accepts an exactly covered report with supported decisions and priorities", () => {
    const errors = checkBackgroundAuditCoverage(
      auditResult([cueOne, cueTwo]),
      cueDecisions([
        [cueOne, "keep", "A"],
        [cueTwo, "prompt-adjust", "B"],
      ]),
    );

    expect(errors).toEqual([]);
  });

  it("reports every coverage and decision-field error class", () => {
    const cueMissing =
      "chapter_1/scene_1.json::/queue/2/assetCue/backgroundAssetId";
    const cueBlankDecision =
      "chapter_1/scene_1.json::/queue/3/assetCue/backgroundAssetId";
    const cueUnsupportedDecision =
      "chapter_1/scene_1.json::/queue/4/assetCue/backgroundAssetId";
    const cueBlankPriority =
      "chapter_1/scene_1.json::/queue/5/assetCue/backgroundAssetId";
    const cueUnsupportedPriority =
      "chapter_1/scene_1.json::/queue/6/assetCue/backgroundAssetId";
    const staleCue =
      "chapter_1/stale.json::/queue/0/assetCue/backgroundAssetId";

    const errors = checkBackgroundAuditCoverage(
      auditResult([
        cueOne,
        cueTwo,
        cueMissing,
        cueBlankDecision,
        cueUnsupportedDecision,
        cueBlankPriority,
        cueUnsupportedPriority,
      ]),
      cueDecisions([
        [cueOne, "keep", "A"],
        [cueOne, "keep", "A"],
        [cueTwo, "regenerate", "A"],
        [cueBlankDecision, "", "A"],
        [cueUnsupportedDecision, "replace", "A"],
        [cueBlankPriority, "add-variant", ""],
        [cueUnsupportedPriority, "keep", "C"],
        [staleCue, "keep", "B"],
      ]),
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        `Missing cue key in report: ${cueMissing}`,
        `Stale cue key in report: ${staleCue}`,
        `Duplicate cue key in report: ${cueOne}`,
        `Blank Decision for cue key: ${cueBlankDecision}`,
        `Unsupported Decision "replace" for cue key: ${cueUnsupportedDecision}`,
        `Blank Priority for cue key: ${cueBlankPriority}`,
        `Unsupported Priority "C" for cue key: ${cueUnsupportedPriority}`,
      ]),
    );
  });

  it("reports a missing Cue decisions table instead of treating the report as covered", () => {
    const errors = checkBackgroundAuditCoverage(
      auditResult([cueOne]),
      "# Background variety audit\n\nNo decisions have been recorded yet.\n",
    );

    expect(errors).toEqual(["Missing ## Cue decisions section."]);
  });
});
