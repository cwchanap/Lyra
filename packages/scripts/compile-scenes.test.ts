import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compile, formatErrors } from "./compile-scenes/orchestrator";
import { enrichScenesWithAssets } from "./compile-scenes/assets/enrich";
import type { AssetConfig } from "./compile-scenes/assets/config";
import { parseChapter } from "./compile-scenes/parser-chapter";
import { parseInterrogationScene } from "./compile-scenes/parser-interrogation";
import { parseInvestigationScene } from "./compile-scenes/parser-investigation";
import { parseLinearScene } from "./compile-scenes/parser-linear";
import { buildSaveContentManifest } from "./compile-scenes/save-content-manifest";
import type { SceneRecord } from "./compile-scenes/validator";

const VALID_STORY_CATALOG = readFileSync(
  resolve("packages/scripts/__fixtures__/story_catalog/valid/story_catalog.md"),
  "utf-8",
).replace(/\n## Source Groups[\s\S]*$/, "");

const SINGLETON_SOURCE_GROUP_CATALOG = `# Story Catalog

## Source Groups

### Source Group: Program export {#program_export}
- **Summary:** Records derived from the same program export.
`;

const NEUTRAL_CASE_RECORD_PROVENANCE = {
  sourceKind: "unspecified",
  representationLayer: "none",
  proceduralStatus: "unspecified",
  completeness: "unspecified",
  confidence: "unspecified",
  sourceGroupId: null,
  sourceLabel: null,
  proofCapabilities: [],
  supersedesRecordId: null,
};

function annotateCoffeeWithSourceGroup(sourceRoot: string): void {
  const scenePath = resolve(sourceRoot, "chapter_1/investigation_scene_1.md");
  const original = readFileSync(scenePath, "utf-8");
  writeFileSync(
    scenePath,
    original.replace(
      "- **Source Sublocation:** main_hall",
      `- **Source Sublocation:** main_hall
- **Source Kind:** digital
- **Representation Layer:** summary
- **Procedural Status:** reacquired
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** program_export
- **Source Label:** Main hall program export
- **Proof Capabilities:** [procedure, time]`,
    ),
  );
}

describe("production Chapter 1 authoring", () => {
  it("gives every manifested scene an authored player recap", () => {
    const chapterDir = "docs/stories_plan/chapter_1";
    const chapterFile = `${chapterDir}/chapter.md`;
    const chapter = parseChapter(
      readFileSync(chapterFile, "utf-8"),
      "chapter_1/chapter.md",
      "chapter_1",
    );
    if (!chapter.ok) throw new Error(formatErrors([chapter.error]));

    const missingSummaryFiles = chapter.value.sceneFiles.filter((sceneFile) => {
      const sourceFile = `chapter_1/${sceneFile}`;
      const source = readFileSync(resolve(chapterDir, sceneFile), "utf-8");
      const id = sceneFile.replace(/\.md$/, "");
      const parsed = sceneFile.startsWith("investigation_scene_")
        ? parseInvestigationScene(source, sourceFile, id)
        : sceneFile.startsWith("interrogation_scene_")
          ? parseInterrogationScene(source, sourceFile, id)
          : parseLinearScene(source, sourceFile, id);
      if (!parsed.ok) throw new Error(formatErrors([parsed.error]));
      return !parsed.value.summaryAuthored;
    });

    expect(
      missingSummaryFiles,
      `Chapter 1 scenes missing authored player recap copy: ${missingSummaryFiles.join(", ")}`,
    ).toEqual([]);
  });
});

describe("compile (end-to-end against valid fixture)", () => {
  it("compiles the valid fixture without errors and emits expected files", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-"));
    try {
      const result = compile({
        sourceRoot: "packages/scripts/__fixtures__/valid",
        outputRoot: outRoot,
      });
      if (!result.ok) {
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      }
      expect(result.chaptersCompiled).toBe(1);
      expect(result.scenesCompiled).toBe(2);

      const idx = JSON.parse(
        readFileSync(resolve(outRoot, "chapters.json"), "utf-8"),
      );
      expect(idx.chapters).toHaveLength(1);
      expect(idx.chapters[0].id).toBe("chapter_1");
      expect(idx.chapters[0].scenes).toEqual([
        { type: "linear", file: "chapter_1/scene_0.json" },
        { type: "investigation", file: "chapter_1/investigation_scene_1.json" },
      ]);

      const linear = JSON.parse(
        readFileSync(resolve(outRoot, "chapter_1/scene_0.json"), "utf-8"),
      );
      expect(linear.type).toBe("linear");
      expect(linear.queue.length).toBeGreaterThan(0);

      const investigation = JSON.parse(
        readFileSync(
          resolve(outRoot, "chapter_1/investigation_scene_1.json"),
          "utf-8",
        ),
      );
      expect(investigation.type).toBe("investigation");
      expect(investigation.sublocations).toHaveLength(2);
      expect(investigation.outro.unlock).not.toBe("auto");
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("fails with noChaptersFound when source root has no chapter directories", () => {
    const emptyDir = mkdtempSync(resolve(tmpdir(), "scene-compile-empty-"));
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-empty-out-"));
    try {
      const result = compile({ sourceRoot: emptyDir, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe("noChaptersFound");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("compiles interrogation scenes into the chapter output", () => {
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-interrogation-"),
    );
    const readJson = (path: string) =>
      JSON.parse(readFileSync(resolve(outRoot, path), "utf-8"));
    try {
      const result = compile({
        sourceRoot: "packages/scripts/__fixtures__/valid_interrogation",
        outputRoot: outRoot,
      });
      if (!result.ok) {
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      }

      expect(readJson("chapters.json").chapters[0].scenes[1]).toEqual({
        type: "interrogation",
        file: "chapter_1/interrogation_scene_1.json",
      });
      const interrogation = readJson("chapter_1/interrogation_scene_1.json");
      expect(interrogation.type).toBe("interrogation");
      expect(
        interrogation.phases.map((phase: { kind: string }) => phase.kind),
      ).toEqual(["inquiry"]);
      expect(
        interrogation.phases[0].questions.map(
          (question: { id: string }) => question.id,
        ),
      ).toEqual(["entered_storage", "beans_follow_up"]);
      const enteredStorage = interrogation.phases[0].questions[0];
      expect(
        enteredStorage.testimony.lines.map((line: { id: string }) => line.id),
      ).toEqual(["l_beans", "l_cleaning"]);
      const cleaningLine = enteredStorage.testimony.lines[1];
      expect(cleaningLine.contradiction).toEqual({
        kind: "evidence",
        id: "coffee_machine_cleaning_log",
      });
      expect(cleaningLine.challenge.length).toBeGreaterThan(0);
      expect(cleaningLine.onCorrect.length).toBeGreaterThan(0);
      expect(cleaningLine.onWrongEvidence.length).toBeGreaterThan(0);
      expect(cleaningLine.reveals).toContainEqual({
        kind: "statement",
        id: "kagami_timeline_inconsistent",
      });
      expect(enteredStorage.testimony.loopPrompt.length).toBeGreaterThan(0);
      expect(enteredStorage.testimony.wrongReply.length).toBeGreaterThan(0);
      const beansFollowUp = interrogation.phases[0].questions[1];
      expect(beansFollowUp.testimony.loopPrompt).toEqual([]);
      expect(beansFollowUp.testimony.wrongReply).toEqual([]);
      expect(
        interrogation.evidenceManifest.map((e: { id: string }) => e.id),
      ).toEqual(["coffee_machine_cleaning_log"]);
      expect(
        interrogation.statementManifest.map((s: { id: string }) => s.id),
      ).toEqual([
        "wakatsuki_entered_for_beans",
        "kagami_timeline_inconsistent",
      ]);
      expect(interrogation.outro).toMatchObject({ unlock: "auto" });
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("emits story asset manifest for an asset-enabled fixture", () => {
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-assets-scenes-"),
    );
    const assetOutRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-assets-manifest-"),
    );
    try {
      const result = compile({
        sourceRoot: "packages/scripts/__fixtures__/asset_enabled/stories_plan",
        outputRoot: outRoot,
        assetConfigRoot:
          "packages/scripts/__fixtures__/asset_enabled/assets/config",
        assetOutputRoot: assetOutRoot,
      });
      if (!result.ok)
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      expect(result.assetReport.enabled).toBe(true);
      expect(result.assetReport.requested.background).toBeGreaterThan(0);

      const manifest = JSON.parse(
        readFileSync(resolve(assetOutRoot, "manifest.json"), "utf-8"),
      );
      const report = JSON.parse(
        readFileSync(resolve(assetOutRoot, "report.json"), "utf-8"),
      );
      expect(manifest.enabled).toBe(true);
      expect(
        manifest.entries.some((entry: { assetId: string }) =>
          entry.assetId.startsWith("background."),
        ),
      ).toBe(true);
      expect(
        manifest.entries.some((entry: { assetId: string }) =>
          entry.assetId.startsWith("portrait."),
        ),
      ).toBe(true);
      expect(report).toEqual(result.assetReport);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
      rmSync(assetOutRoot, { recursive: true, force: true });
    }
  });
});

describe("snapshot: valid fixture JSON output", () => {
  let outRoot: string;
  let chaptersJson: unknown;
  let linearJson: unknown;
  let investigationJson: unknown;

  beforeAll(() => {
    outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-snap-"));
    const result = compile({
      sourceRoot: "packages/scripts/__fixtures__/valid",
      outputRoot: outRoot,
    });
    if (!result.ok) throw new Error(formatErrors(result.errors));
    chaptersJson = JSON.parse(
      readFileSync(resolve(outRoot, "chapters.json"), "utf-8"),
    );
    linearJson = JSON.parse(
      readFileSync(resolve(outRoot, "chapter_1/scene_0.json"), "utf-8"),
    );
    investigationJson = JSON.parse(
      readFileSync(
        resolve(outRoot, "chapter_1/investigation_scene_1.json"),
        "utf-8",
      ),
    );
  });

  afterAll(() => {
    rmSync(outRoot, { recursive: true, force: true });
  });

  it("matches the chapters.json snapshot", () => {
    expect(chaptersJson).toMatchSnapshot();
  });
  it("matches the linear scene snapshot", () => {
    expect(linearJson).toMatchSnapshot();
  });
  it("matches the investigation scene snapshot", () => {
    expect(investigationJson).toMatchSnapshot();
  });
});

describe("invalid fixtures: each one fails with a specific error code", () => {
  const INVALID_ROOT = "packages/scripts/__fixtures__/invalid";
  const fixtures = readdirSync(INVALID_ROOT).filter((d) =>
    statSync(resolve(INVALID_ROOT, d)).isDirectory(),
  );

  for (const name of fixtures) {
    it(`fixture "${name}" produces the expected error`, () => {
      const sourceRoot = resolve(INVALID_ROOT, name);
      const expectedFile = resolve(sourceRoot, "expected-error.txt");
      if (!existsSync(expectedFile)) {
        throw new Error(`Fixture ${name} is missing expected-error.txt`);
      }
      const expectedSubstring = readFileSync(expectedFile, "utf-8").trim();
      const outRoot = mkdtempSync(
        resolve(tmpdir(), `scene-compile-bad-${name}-`),
      );
      try {
        const result = compile({ sourceRoot, outputRoot: outRoot });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        const matched = result.errors.some(
          (e) =>
            e.code === expectedSubstring ||
            e.message.includes(expectedSubstring),
        );
        if (!matched) {
          throw new Error(
            `Fixture "${name}" did not produce expected error "${expectedSubstring}". Got:\n` +
              formatErrors(result.errors),
          );
        }
      } finally {
        rmSync(outRoot, { recursive: true, force: true });
      }
    });
  }
});

describe("compile parse failure handling", () => {
  it("does not report a manifest missing-file error for a scene that failed to parse", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-parse-fail-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-parse-fail-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot, { recursive: true });
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Parse Fail\n\n**Summary:** s\n\n## Scenes\n1. scene_0.md\n",
      );
      writeFileSync(
        resolve(chapterRoot, "scene_0.md"),
        "this is not a valid linear scene\n",
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(
        result.errors.some((e) => e.code === "linearSceneMissingTitle"),
      ).toBe(true);
      expect(
        result.errors.some((e) => e.code === "chapterManifestMissingFile"),
      ).toBe(false);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("reports invalid investigation layout sidecars and prevents output", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-bad-layout-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-bad-layout-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot, { recursive: true });
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Bad Layout\n\n**Summary:** s\n\n## Scenes\n1. investigation_scene_1.md\n",
      );
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.md"),
        readFileSync(
          "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md",
          "utf-8",
        ),
      );
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.layout.json"),
        JSON.stringify(
          {
            version: 1,
            sceneId: "investigation_scene_1",
            sublocations: {
              main_hall: {
                hotspots: {
                  missing_table: {
                    kind: "rect",
                    x: 0.1,
                    y: 0.2,
                    w: 0.3,
                    h: 0.4,
                  },
                },
                characters: {},
              },
            },
          },
          null,
          2,
        ),
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });

      expect(result.ok).toBe(false);
      expect(existsSync(resolve(outRoot, "chapters.json"))).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "layoutUnknownHotspot",
          sourceFile: "chapter_1/investigation_scene_1.layout.json",
        }),
      );
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

describe("asset enrichment: first visual cue audio validation", () => {
  const enabledConfig: AssetConfig = {
    enabled: true,
    globalStylePrompt: "anime style",
    types: {
      background: {
        dimensions: [1920, 1080],
        format: "png",
        transparency: false,
        prompt: "",
      },
      portrait: {
        dimensions: [768, 1024],
        format: "png",
        transparency: true,
        prompt: "",
      },
      evidence: {
        dimensions: [512, 512],
        format: "png",
        transparency: true,
        prompt: "",
      },
      standee: {
        dimensions: [1024, 1024],
        format: "png",
        transparency: true,
        prompt: "",
      },
      audio: { format: "ogg", loop: true, prompt: "" },
    },
    characters: { byId: new Map(), byDisplayName: new Map() },
    audio: {
      bgm: new Map([["rain", { id: "rain", prompt: "rain", loop: true }]]),
      bgs: new Map([["wind", { id: "wind", prompt: "wind", loop: true }]]),
      sfx: new Map(),
    },
  };

  it("errors when first scene tag omits BGM", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
        summary: "Test",
        summaryAuthored: false,
        sourceFile: "scene_0.md",
        line: 1,
        queue: [
          {
            kind: "sceneTag",
            text: "Test Scene",
            assetCue: {
              backgroundPrompt: "a dark room",
              backgroundAssetId: null,
              bgm: null, // omitted — should error on first cue
              bgs: { channel: "bgs", assetId: "wind" },
            },
          },
        ],
        assetRefs: [],
      },
    };
    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: enabledConfig,
    });
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgm"),
    ).toBe(true);
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgs"),
    ).toBe(false);
  });

  it("errors when first scene tag omits BGS", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
        summary: "Test",
        summaryAuthored: false,
        sourceFile: "scene_0.md",
        line: 1,
        queue: [
          {
            kind: "sceneTag",
            text: "Test Scene",
            assetCue: {
              backgroundPrompt: "a dark room",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: "rain" },
              bgs: null, // omitted — should error on first cue
            },
          },
        ],
        assetRefs: [],
      },
    };
    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: enabledConfig,
    });
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgs"),
    ).toBe(true);
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgm"),
    ).toBe(false);
  });

  it("does not error when first scene tag sets BGM and BGS to none", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
        summary: "Test",
        summaryAuthored: false,
        sourceFile: "scene_0.md",
        line: 1,
        queue: [
          {
            kind: "sceneTag",
            text: "Test Scene",
            assetCue: {
              backgroundPrompt: "a dark room",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: null }, // explicit none — valid
              bgs: { channel: "bgs", assetId: null }, // explicit none — valid
            },
          },
        ],
        assetRefs: [],
      },
    };
    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: enabledConfig,
    });
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgm"),
    ).toBe(false);
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgs"),
    ).toBe(false);
  });

  it("does not error when non-first scene tag omits BGM", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
        summary: "Test",
        summaryAuthored: false,
        sourceFile: "scene_0.md",
        line: 1,
        queue: [
          {
            kind: "sceneTag",
            text: "First Scene",
            assetCue: {
              backgroundPrompt: "a dark room",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: "rain" },
              bgs: { channel: "bgs", assetId: "wind" },
            },
          },
          {
            kind: "sceneTag",
            text: "Second Scene",
            assetCue: {
              backgroundPrompt: "a light room",
              backgroundAssetId: null,
              bgm: null, // omitted on non-first — valid
              bgs: null,
            },
          },
        ],
        assetRefs: [],
      },
    };
    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: enabledConfig,
    });
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgm"),
    ).toBe(false);
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgs"),
    ).toBe(false);
  });
});

describe("compile (multiple source roots)", () => {
  it("merges chapters across roots and skips a non-existent root", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-multi-"));
    const missingRoot = resolve(tmpdir(), "scene-compile-definitely-missing");
    rmSync(missingRoot, { recursive: true, force: true });
    try {
      const result = compile({
        sourceRoot: ["packages/scripts/__fixtures__/valid", missingRoot],
        outputRoot: outRoot,
      });
      if (!result.ok) {
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      }
      expect(result.chaptersCompiled).toBe(1);
      expect(result.scenesCompiled).toBe(2);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("errors with duplicateChapter when the same chapter appears in two roots", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-dup-"));
    try {
      const result = compile({
        sourceRoot: [
          "packages/scripts/__fixtures__/valid",
          "packages/scripts/__fixtures__/valid",
        ],
        outputRoot: outRoot,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "duplicateChapter")).toBe(
        true,
      );
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

describe("compile (global story catalog)", () => {
  it("rejects colliding derived dialogue origins with both carrier locations", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-origin-collision-source-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-origin-collision-out-"),
    );
    try {
      cpSync("packages/scripts/__fixtures__/valid", sourceRoot, {
        recursive: true,
      });
      const scenePath = resolve(
        sourceRoot,
        "chapter_1/investigation_scene_1.md",
      );
      const original = readFileSync(scenePath, "utf8");
      const duplicateCarrier = [
        "### Character: 第二證人 {#witness}",
        "",
        "- **Role:** 證人",
        "- **Bio:** 在另一個地點重複同一個話題。",
        "",
        "#### Topic: 重複的案發時間 {#timeline}",
        "",
        "- **Status:** unlocked",
        "",
        "**證人**：這是第二個衝突的話題。",
        "",
      ].join("\n");
      writeFileSync(
        scenePath,
        original.replace(
          "## Evidence Manifest",
          `${duplicateCarrier}\n## Evidence Manifest`,
        ),
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const collision = result.errors.find(
        (error) => error.code === "derivedDialogueOriginCollision",
      );
      expect(collision).toMatchObject({
        sourceFile: "chapter_1/investigation_scene_1.md",
        line: 87,
      });
      expect(collision?.message).toContain(
        "chapter_1/investigation_scene_1.md:45",
      );
      expect(collision?.message).toContain(
        "chapter_1/investigation_scene_1.md:87",
      );
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("emits a stable manifest for emitted chapter and scene order", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-save-content-source-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-save-content-out-"),
    );
    const linearScene = readFileSync(
      "packages/scripts/__fixtures__/valid/chapter_1/scene_0.md",
      "utf-8",
    );
    const readJson = (path: string) =>
      JSON.parse(readFileSync(resolve(outRoot, path), "utf-8"));
    const readManifest = () => readJson("save_content_manifest.json");
    try {
      const firstChapter = resolve(sourceRoot, "chapter_1");
      const secondChapter = resolve(sourceRoot, "chapter_2");
      mkdirSync(firstChapter);
      mkdirSync(secondChapter);
      writeFileSync(
        resolve(firstChapter, "chapter.md"),
        "# Chapter 1: First authored chapter\n\n**Summary:** First summary.\n\n## Scenes\n1. scene_first.md\n2. scene_second.md\n",
      );
      writeFileSync(resolve(firstChapter, "scene_first.md"), linearScene);
      writeFileSync(resolve(firstChapter, "scene_second.md"), linearScene);
      writeFileSync(
        resolve(secondChapter, "chapter.md"),
        "# Chapter 2: Second authored chapter\n\n**Summary:** Second summary.\n\n## Scenes\n1. scene_third.md\n",
      );
      writeFileSync(resolve(secondChapter, "scene_third.md"), linearScene);

      const first = compile({ sourceRoot, outputRoot: outRoot });
      if (!first.ok) throw new Error(formatErrors(first.errors));

      const chapterOne = {
        id: "chapter_1",
        title: "First authored chapter",
        summary: "First summary.",
        scenes: [
          readJson("chapter_1/scene_first.json"),
          readJson("chapter_1/scene_second.json"),
        ],
      };
      const chapterTwo = {
        id: "chapter_2",
        title: "Second authored chapter",
        summary: "Second summary.",
        scenes: [readJson("chapter_2/scene_third.json")],
      };
      const storyCatalog = readJson("story_catalog.json");
      const emitted = readManifest();

      // Regression: hashing chapters or scene filenames in a different order
      // would silently invalidate existing saves for unchanged authored content.
      expect(emitted).toEqual(
        buildSaveContentManifest({
          bundle: {
            chapters: [chapterOne, chapterTwo],
            storyCatalog,
          },
        }),
      );
      expect(emitted).not.toEqual(
        buildSaveContentManifest({
          bundle: {
            chapters: [chapterTwo, chapterOne],
            storyCatalog,
          },
        }),
      );
      expect(emitted).not.toEqual(
        buildSaveContentManifest({
          bundle: {
            chapters: [
              { ...chapterOne, scenes: [...chapterOne.scenes].reverse() },
              chapterTwo,
            ],
            storyCatalog,
          },
        }),
      );
      expect(Object.keys(emitted).sort()).toEqual([
        "contentRevision",
        "manifestVersion",
      ]);

      const firstManifestText = readFileSync(
        resolve(outRoot, "save_content_manifest.json"),
        "utf-8",
      );
      const second = compile({ sourceRoot, outputRoot: outRoot });
      if (!second.ok) throw new Error(formatErrors(second.errors));
      expect(
        readFileSync(resolve(outRoot, "save_content_manifest.json"), "utf-8"),
      ).toBe(firstManifestText);

      writeFileSync(
        resolve(firstChapter, "chapter.md"),
        "# Chapter 1: First authored chapter\n\n**Summary:** First summary.\n\n## Scenes\n1. scene_second.md\n2. scene_first.md\n",
      );
      const reordered = compile({ sourceRoot, outputRoot: outRoot });
      if (!reordered.ok) throw new Error(formatErrors(reordered.errors));
      expect(readManifest().contentRevision).not.toBe(emitted.contentRevision);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("emits the exact empty version-2 artifact when no catalog is authored", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-empty-catalog-source-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-empty-catalog-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot);
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Empty Catalog\n\n**Summary:** No records.\n\n## Scenes\n1. scene_0.md\n",
      );
      writeFileSync(
        resolve(chapterRoot, "scene_0.md"),
        readFileSync(
          "packages/scripts/__fixtures__/valid/chapter_1/scene_0.md",
          "utf-8",
        ),
      );

      const result = compile({
        sourceRoot,
        outputRoot: outRoot,
      });
      if (!result.ok) throw new Error(formatErrors(result.errors));

      expect(
        JSON.parse(
          readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
        ),
      ).toEqual({
        schemaVersion: 2,
        facts: [],
        questions: [],
        objectives: [],
        authorizations: [],
        sourceGroups: [],
        evidenceIndex: [],
        statementsIndex: [],
      });
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it.each(["first", "second"] as const)(
    "compiles one catalog discovered in the %s configured root",
    (position) => {
      const catalogRoot = mkdtempSync(
        resolve(tmpdir(), `scene-compile-catalog-${position}-`),
      );
      const outRoot = mkdtempSync(
        resolve(tmpdir(), `scene-compile-catalog-${position}-out-`),
      );
      try {
        writeFileSync(
          resolve(catalogRoot, "story_catalog.md"),
          VALID_STORY_CATALOG,
        );
        const fixtureRoot = "packages/scripts/__fixtures__/valid";
        const sourceRoot =
          position === "first"
            ? [catalogRoot, fixtureRoot]
            : [fixtureRoot, catalogRoot];

        const result = compile({ sourceRoot, outputRoot: outRoot });
        if (!result.ok) throw new Error(formatErrors(result.errors));

        const emitted = JSON.parse(
          readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
        );
        expect(emitted.facts).toContainEqual(
          expect.objectContaining({ id: "visitor_signed_in" }),
        );
        expect(emitted.questions[0]?.resolvedByFactIds).toEqual([
          "visitor_signed_in",
        ]);
        expect(emitted.sourceGroups).toEqual([]);
      } finally {
        rmSync(catalogRoot, { recursive: true, force: true });
        rmSync(outRoot, { recursive: true, force: true });
      }
    },
  );

  it("rejects two catalogs at the second path and writes no catalog artifact", () => {
    const firstRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-duplicate-first-"),
    );
    const secondRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-duplicate-second-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-duplicate-out-"),
    );
    try {
      writeFileSync(
        resolve(firstRoot, "story_catalog.md"),
        VALID_STORY_CATALOG,
      );
      writeFileSync(
        resolve(secondRoot, "story_catalog.md"),
        VALID_STORY_CATALOG,
      );

      const result = compile({
        sourceRoot: [
          firstRoot,
          secondRoot,
          "packages/scripts/__fixtures__/valid",
        ],
        outputRoot: outRoot,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "duplicateStoryCatalog",
          sourceFile: resolve(secondRoot, "story_catalog.md"),
        }),
      );
      expect(existsSync(resolve(outRoot, "story_catalog.json"))).toBe(false);
    } finally {
      rmSync(firstRoot, { recursive: true, force: true });
      rmSync(secondRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("reports an unreadable discovered catalog", () => {
    const catalogRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-unreadable-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-unreadable-out-"),
    );
    const catalogPath = resolve(catalogRoot, "story_catalog.md");
    try {
      mkdirSync(catalogPath);

      const result = compile({
        sourceRoot: ["packages/scripts/__fixtures__/valid", catalogRoot],
        outputRoot: outRoot,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "storyCatalogUnreadable",
          sourceFile: catalogPath,
        }),
      );
    } finally {
      rmSync(catalogRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("leaves pre-existing catalog and save manifest artifacts unchanged on validation failure", () => {
    const catalogRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-invalid-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-invalid-out-"),
    );
    const sentinel = '{"sentinel":"keep exactly"}\n';
    const manifestSentinel = '{"save":"keep exactly"}\n';
    try {
      writeFileSync(
        resolve(catalogRoot, "story_catalog.md"),
        readFileSync(
          "packages/scripts/__fixtures__/story_catalog/invalid_duplicate_fact/story_catalog.md",
          "utf-8",
        ),
      );
      writeFileSync(resolve(outRoot, "story_catalog.json"), sentinel);
      writeFileSync(
        resolve(outRoot, "save_content_manifest.json"),
        manifestSentinel,
      );

      const result = compile({
        sourceRoot: ["packages/scripts/__fixtures__/valid", catalogRoot],
        outputRoot: outRoot,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "duplicateGlobalDefinitionId" }),
      );
      expect(
        readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
      ).toBe(sentinel);
      expect(
        readFileSync(resolve(outRoot, "save_content_manifest.json"), "utf-8"),
      ).toBe(manifestSentinel);
    } finally {
      rmSync(catalogRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("replaces only compiler-owned scene outputs on successful compilation", () => {
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-surgical-out-"),
    );
    try {
      writeFileSync(resolve(outRoot, "chapters.json"), "old chapters\n");
      writeFileSync(resolve(outRoot, "story_catalog.json"), "old catalog\n");
      writeFileSync(
        resolve(outRoot, "save_content_manifest.json"),
        "old save content manifest\n",
      );
      mkdirSync(resolve(outRoot, "chapter_99"));
      writeFileSync(
        resolve(outRoot, "chapter_99/stale.json"),
        "stale chapter\n",
      );
      writeFileSync(resolve(outRoot, "keep.txt"), "keep file\n");
      mkdirSync(resolve(outRoot, "future_data"));
      writeFileSync(
        resolve(outRoot, "future_data/keep.json"),
        "keep directory\n",
      );

      const result = compile({
        sourceRoot: "packages/scripts/__fixtures__/valid",
        outputRoot: outRoot,
      });
      if (!result.ok) throw new Error(formatErrors(result.errors));

      expect(readdirSync(outRoot).sort()).toEqual([
        "chapter_1",
        "chapters.json",
        "future_data",
        "keep.txt",
        "save_content_manifest.json",
        "story_catalog.json",
      ]);
      expect(readFileSync(resolve(outRoot, "keep.txt"), "utf-8")).toBe(
        "keep file\n",
      );
      expect(
        readFileSync(resolve(outRoot, "future_data/keep.json"), "utf-8"),
      ).toBe("keep directory\n");
      expect(existsSync(resolve(outRoot, "chapter_99"))).toBe(false);
      expect(
        JSON.parse(
          readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
        ).schemaVersion,
      ).toBe(2);
      expect(
        JSON.parse(
          readFileSync(resolve(outRoot, "save_content_manifest.json"), "utf-8"),
        ),
      ).toMatchObject({
        manifestVersion: 1,
        contentRevision: expect.any(String),
      });
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "an undeclared record source group",
      expectedCode: "caseRecordSourceGroupUnknown",
      arrange(sourceRoot: string) {
        annotateCoffeeWithSourceGroup(sourceRoot);
      },
    },
    {
      label: "an unused catalog source group",
      expectedCode: "caseRecordSourceGroupUnused",
      arrange(sourceRoot: string) {
        writeFileSync(
          resolve(sourceRoot, "story_catalog.md"),
          SINGLETON_SOURCE_GROUP_CATALOG,
        );
      },
    },
  ])(
    "rejects $label before replacing any compiler-owned output",
    ({ expectedCode, arrange }) => {
      const sourceRoot = mkdtempSync(
        resolve(tmpdir(), "scene-compile-source-group-invalid-source-"),
      );
      const outRoot = mkdtempSync(
        resolve(tmpdir(), "scene-compile-source-group-invalid-out-"),
      );
      const sentinel = "preserve sentinel\n";
      try {
        cpSync("packages/scripts/__fixtures__/valid", sourceRoot, {
          recursive: true,
        });
        arrange(sourceRoot);
        for (const file of [
          "chapters.json",
          "story_catalog.json",
          "save_content_manifest.json",
        ]) {
          writeFileSync(resolve(outRoot, file), sentinel);
        }
        mkdirSync(resolve(outRoot, "chapter_1"));
        writeFileSync(resolve(outRoot, "chapter_1/sentinel.json"), sentinel);

        const result = compile({ sourceRoot, outputRoot: outRoot });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors).toContainEqual(
          expect.objectContaining({ code: expectedCode }),
        );
        for (const file of [
          "chapters.json",
          "story_catalog.json",
          "save_content_manifest.json",
          "chapter_1/sentinel.json",
        ]) {
          expect(readFileSync(resolve(outRoot, file), "utf-8")).toBe(sentinel);
        }
      } finally {
        rmSync(sourceRoot, { recursive: true, force: true });
        rmSync(outRoot, { recursive: true, force: true });
      }
    },
  );

  it("returns singleton warnings and emits structurally equal scene/catalog provenance from one corpus", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-source-group-success-source-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-source-group-success-out-"),
    );
    try {
      cpSync("packages/scripts/__fixtures__/valid", sourceRoot, {
        recursive: true,
      });
      annotateCoffeeWithSourceGroup(sourceRoot);
      writeFileSync(
        resolve(sourceRoot, "story_catalog.md"),
        SINGLETON_SOURCE_GROUP_CATALOG,
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });

      if (!result.ok) throw new Error(formatErrors(result.errors));
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: "singletonSourceGroup",
          sourceFile: resolve(sourceRoot, "story_catalog.md"),
        }),
      );
      const scene = JSON.parse(
        readFileSync(
          resolve(outRoot, "chapter_1/investigation_scene_1.json"),
          "utf-8",
        ),
      );
      const catalog = JSON.parse(
        readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
      );
      const sceneRecord = scene.evidenceManifest.find(
        ({ id }: { id: string }) => id === "coffee",
      );
      const catalogRecord = catalog.evidenceIndex.find(
        ({ id }: { id: string }) => id === "coffee",
      );
      assert.deepStrictEqual(sceneRecord.provenance, catalogRecord.provenance);
      expect(catalog.sourceGroups).toEqual([
        {
          id: "program_export",
          label: "Program export",
          summary: "Records derived from the same program export.",
          members: [{ kind: "evidence", id: "coffee" }],
        },
      ]);
      expect(catalogRecord.provenance.proofCapabilities).toEqual([
        "time",
        "procedure",
      ]);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

describe("compile (tracked production corpus compatibility)", () => {
  it("emits neutral provenance and no source groups without story migration", () => {
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-live-provenance-"),
    );
    try {
      const repoRoot = resolve(".");
      const result = compile({
        sourceRoot: [
          resolve(repoRoot, "static/stories_plan"),
          resolve(repoRoot, "docs/stories_plan"),
        ],
        outputRoot: outRoot,
        assetConfigRoot: resolve(repoRoot, "static/assets/config"),
        assetOutputRoot: resolve(outRoot, "assets"),
        repoRoot,
      });
      if (!result.ok) {
        throw new Error(
          "Live corpus compile failed:\n" + formatErrors(result.errors),
        );
      }

      const chapters = JSON.parse(
        readFileSync(resolve(outRoot, "chapters.json"), "utf-8"),
      ) as {
        chapters: Array<{
          scenes: Array<{ type: string; file: string }>;
        }>;
      };
      const sceneRecords: Array<{
        kind: "evidence" | "statement";
        id: string;
        provenance: unknown;
      }> = [];
      for (const chapter of chapters.chapters) {
        for (const descriptor of chapter.scenes) {
          if (
            descriptor.type !== "investigation" &&
            descriptor.type !== "interrogation"
          ) {
            continue;
          }
          const scene = JSON.parse(
            readFileSync(resolve(outRoot, descriptor.file), "utf-8"),
          ) as {
            evidenceManifest: Array<{ id: string; provenance: unknown }>;
            statementManifest: Array<{ id: string; provenance: unknown }>;
          };
          sceneRecords.push(
            ...scene.evidenceManifest.map(({ id, provenance }) => ({
              kind: "evidence" as const,
              id,
              provenance,
            })),
            ...scene.statementManifest.map(({ id, provenance }) => ({
              kind: "statement" as const,
              id,
              provenance,
            })),
          );
        }
      }

      const catalog = JSON.parse(
        readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
      ) as {
        sourceGroups: unknown[];
        evidenceIndex: Array<{ id: string; provenance: unknown }>;
        statementsIndex: Array<{ id: string; provenance: unknown }>;
      };
      const catalogRecords = [
        ...catalog.evidenceIndex.map(({ id, provenance }) => ({
          kind: "evidence" as const,
          id,
          provenance,
        })),
        ...catalog.statementsIndex.map(({ id, provenance }) => ({
          kind: "statement" as const,
          id,
          provenance,
        })),
      ];

      expect(sceneRecords.length).toBeGreaterThan(0);
      expect(
        sceneRecords.map(({ kind, id }) => `${kind}:${id}`).sort(),
      ).toEqual(catalogRecords.map(({ kind, id }) => `${kind}:${id}`).sort());
      for (const record of [...sceneRecords, ...catalogRecords]) {
        expect(record.provenance).toEqual(NEUTRAL_CASE_RECORD_PROVENANCE);
      }
      expect(catalog.sourceGroups).toEqual([]);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

describe("compile (layout warning wiring)", () => {
  // End-to-end test for the orchestrator's non-blocking warning path:
  // a .layout.json sidecar with overlapping hotspot rects must produce a
  // successful compile (warnings are non-blocking) with layoutHotspotOverlap
  // entries in result.warnings. This verifies the full wiring from sidecar
  // parsing → detectLayoutOverlaps → CompileResult.warnings that the CLI
  // (compile-scenes.ts runOnce) prints via console.warn.
  it("returns ok with layoutHotspotOverlap warnings for overlapping hotspot rects", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-overlap-warn-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-overlap-warn-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot, { recursive: true });
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Overlap Warn\n\n**Summary:** s\n\n## Scenes\n1. investigation_scene_1.md\n",
      );
      // Reuse the valid fixture's investigation scene — it has hotspots
      // `table` and `window` in sublocation `main_hall`.
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.md"),
        readFileSync(
          "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md",
          "utf-8",
        ),
      );
      // Sidecar with near-identical overlapping `table` and `window` rects
      // (>80% overlap of the smaller rect) and NO intentionalOverlaps opt-out
      // → should trigger layoutHotspotOverlap.
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.layout.json"),
        JSON.stringify(
          {
            version: 1,
            sceneId: "investigation_scene_1",
            sublocations: {
              main_hall: {
                hotspots: {
                  table: { kind: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
                  window: { kind: "rect", x: 0.11, y: 0.11, w: 0.3, h: 0.3 },
                },
                characters: {},
              },
              back_room: {
                hotspots: {
                  cabinet: { kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
                },
                characters: {},
              },
            },
          },
          null,
          2,
        ),
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });

      // Warnings are non-blocking — compile must still succeed.
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The orchestrator must have wired detectLayoutOverlaps output into
      // CompileResult.warnings (the array the CLI prints).
      expect(result.warnings.length).toBeGreaterThan(0);
      const overlapWarnings = result.warnings.filter(
        (w) => w.code === "layoutHotspotOverlap",
      );
      expect(overlapWarnings.length).toBe(1);
      expect(overlapWarnings[0]!.sourceFile).toBe(
        "chapter_1/investigation_scene_1.layout.json",
      );
      expect(overlapWarnings[0]!.message).toContain("table");
      expect(overlapWarnings[0]!.message).toContain("window");
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("returns ok with no warnings when intentionalOverlaps suppresses the overlap", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-overlap-suppressed-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-overlap-suppressed-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot, { recursive: true });
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Overlap Suppressed\n\n**Summary:** s\n\n## Scenes\n1. investigation_scene_1.md\n",
      );
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.md"),
        readFileSync(
          "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md",
          "utf-8",
        ),
      );
      // Same near-identical overlapping rects (>80%), but with
      // intentionalOverlaps opt-out → no warning should be emitted.
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.layout.json"),
        JSON.stringify(
          {
            version: 1,
            sceneId: "investigation_scene_1",
            sublocations: {
              main_hall: {
                hotspots: {
                  table: { kind: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
                  window: { kind: "rect", x: 0.11, y: 0.11, w: 0.3, h: 0.3 },
                },
                characters: {},
                intentionalOverlaps: [{ hotspots: ["table", "window"] }],
              },
              back_room: {
                hotspots: {
                  cabinet: { kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
                },
                characters: {},
              },
            },
          },
          null,
          2,
        ),
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});
