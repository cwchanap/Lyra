import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compile, formatErrors } from "./compile-scenes/orchestrator";
import { enrichScenesWithAssets } from "./compile-scenes/assets/enrich";
import type { AssetConfig } from "./compile-scenes/assets/config";
import type { SceneRecord } from "./compile-scenes/validator";

describe("compile (end-to-end against valid fixture)", () => {
  it("compiles the valid fixture without errors and emits expected files", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-"));
    try {
      const result = compile({
        sourceRoot: "scripts/__fixtures__/valid",
        outputRoot: outRoot,
      });
      if (!result.ok) {
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      }
      expect(result.chaptersCompiled).toBe(1);
      expect(result.scenesCompiled).toBe(2);

      const idx = JSON.parse(readFileSync(resolve(outRoot, "chapters.json"), "utf-8"));
      expect(idx.chapters).toHaveLength(1);
      expect(idx.chapters[0].id).toBe("chapter_1");
      expect(idx.chapters[0].scenes).toEqual([
        { type: "linear", file: "chapter_1/scene_0.json" },
        { type: "investigation", file: "chapter_1/investigation_scene_1.json" },
      ]);

      const linear = JSON.parse(readFileSync(resolve(outRoot, "chapter_1/scene_0.json"), "utf-8"));
      expect(linear.type).toBe("linear");
      expect(linear.queue.length).toBeGreaterThan(0);

      const investigation = JSON.parse(
        readFileSync(resolve(outRoot, "chapter_1/investigation_scene_1.json"), "utf-8"),
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
      expect(result.errors[0].code).toBe("noChaptersFound");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("compiles interrogation scenes into the chapter output", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-interrogation-"));
    const readJson = (path: string) => JSON.parse(readFileSync(resolve(outRoot, path), "utf-8"));
    try {
      const result = compile({
        sourceRoot: "scripts/__fixtures__/valid_interrogation",
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
      expect(interrogation.phases.map((phase: { kind: string }) => phase.kind)).toEqual(["inquiry", "testimony"]);
      expect(interrogation.phases[0].questions[0].id).toBe("entered_storage");
      expect(interrogation.phases[1].statements[0].contradiction).toEqual({
        kind: "evidence",
        id: "coffee_machine_cleaning_log",
      });
      expect(interrogation.phases[1].results[0].reveals).toContainEqual({
        kind: "statement",
        id: "kagami_timeline_inconsistent",
      });
      expect(interrogation.evidenceManifest.map((e: { id: string }) => e.id)).toEqual([
        "coffee_machine_cleaning_log",
      ]);
      expect(interrogation.statementManifest.map((s: { id: string }) => s.id)).toEqual([
        "wakatsuki_entered_for_beans",
        "kagami_timeline_inconsistent",
      ]);
      expect(interrogation.outro).toMatchObject({ unlock: "auto" });
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("emits story asset manifest for an asset-enabled fixture", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-assets-scenes-"));
    const assetOutRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-assets-manifest-"));
    try {
      const result = compile({
        sourceRoot: "scripts/__fixtures__/asset_enabled/stories_plan",
        outputRoot: outRoot,
        assetConfigRoot: "scripts/__fixtures__/asset_enabled/assets/config",
        assetOutputRoot: assetOutRoot,
      });
      if (!result.ok) throw new Error("Compile failed:\n" + formatErrors(result.errors));
      expect(result.assetReport.enabled).toBe(true);
      expect(result.assetReport.requested.background).toBeGreaterThan(0);

      const manifest = JSON.parse(readFileSync(resolve(assetOutRoot, "manifest.json"), "utf-8"));
      const report = JSON.parse(readFileSync(resolve(assetOutRoot, "report.json"), "utf-8"));
      expect(manifest.enabled).toBe(true);
      expect(manifest.entries.some((entry: { assetId: string }) => entry.assetId.startsWith("background."))).toBe(true);
      expect(manifest.entries.some((entry: { assetId: string }) => entry.assetId.startsWith("portrait."))).toBe(true);
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
      sourceRoot: "scripts/__fixtures__/valid",
      outputRoot: outRoot,
    });
    if (!result.ok) throw new Error(formatErrors(result.errors));
    chaptersJson = JSON.parse(readFileSync(resolve(outRoot, "chapters.json"), "utf-8"));
    linearJson = JSON.parse(readFileSync(resolve(outRoot, "chapter_1/scene_0.json"), "utf-8"));
    investigationJson = JSON.parse(readFileSync(resolve(outRoot, "chapter_1/investigation_scene_1.json"), "utf-8"));
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
  const INVALID_ROOT = "scripts/__fixtures__/invalid";
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
      const outRoot = mkdtempSync(resolve(tmpdir(), `scene-compile-bad-${name}-`));
      try {
        const result = compile({ sourceRoot, outputRoot: outRoot });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        const matched = result.errors.some(
          (e) => e.code === expectedSubstring || e.message.includes(expectedSubstring),
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
    const sourceRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-parse-fail-"));
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-parse-fail-out-"));
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot, { recursive: true });
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Parse Fail\n\n**Summary:** s\n\n## Scenes\n1. scene_0.md\n",
      );
      writeFileSync(resolve(chapterRoot, "scene_0.md"), "this is not a valid linear scene\n");

      const result = compile({ sourceRoot, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.errors.some((e) => e.code === "linearSceneMissingTitle")).toBe(true);
      expect(result.errors.some((e) => e.code === "chapterManifestMissingFile")).toBe(false);
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
      background: { dimensions: [1920, 1080], format: "png", transparency: false, prompt: "" },
      portrait: { dimensions: [768, 1024], format: "png", transparency: true, prompt: "" },
      evidence: { dimensions: [512, 512], format: "png", transparency: true, prompt: "" },
      audio: { format: "ogg", loop: true, prompt: "" },
    },
    characters: { byId: new Map(), byDisplayName: new Map() },
    audio: {
      bgm: new Map([["rain", { id: "rain", prompt: "rain", loop: true }]]),
      bgs: new Map([["wind", { id: "wind", prompt: "wind", loop: true }]]),
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
    const result = enrichScenesWithAssets({ scenes: [scene], config: enabledConfig });
    expect(result.errors.some((e) => e.code === "assetFirstCueMissingBgm")).toBe(true);
    expect(result.errors.some((e) => e.code === "assetFirstCueMissingBgs")).toBe(false);
  });

  it("errors when first scene tag omits BGS", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
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
    const result = enrichScenesWithAssets({ scenes: [scene], config: enabledConfig });
    expect(result.errors.some((e) => e.code === "assetFirstCueMissingBgs")).toBe(true);
    expect(result.errors.some((e) => e.code === "assetFirstCueMissingBgm")).toBe(false);
  });

  it("does not error when first scene tag sets BGM and BGS to none", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
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
    const result = enrichScenesWithAssets({ scenes: [scene], config: enabledConfig });
    expect(result.errors.some((e) => e.code === "assetFirstCueMissingBgm")).toBe(false);
    expect(result.errors.some((e) => e.code === "assetFirstCueMissingBgs")).toBe(false);
  });

  it("does not error when non-first scene tag omits BGM", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
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
    const result = enrichScenesWithAssets({ scenes: [scene], config: enabledConfig });
    expect(result.errors.some((e) => e.code === "assetFirstCueMissingBgm")).toBe(false);
    expect(result.errors.some((e) => e.code === "assetFirstCueMissingBgs")).toBe(false);
  });
});
