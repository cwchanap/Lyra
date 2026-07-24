import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
import type { SceneRecord } from "./compile-scenes/validator";

const VALID_STORY_CATALOG = `# Story Catalog

## Facts

### Fact: The visitor signed in {#visitor_signed_in}
- **Summary:** The visitor signed the register.
- **Details:** The register contains a timestamped signature.
- **Category:** timeline

## Questions

### Question: Who was the visitor? {#visitor_identity}
- **Summary:** Identify the visitor.
- **Resolved By:** [fact:visitor_signed_in]

## Objectives

### Objective: Check the register {#check_register}
- **Summary:** Inspect the register.
- **Kind:** primary
- **Sort Order:** 1

## Authorizations

### Authorization: Archive access {#archive_access}
- **Summary:** Permission to inspect the archive.
- **Granting Authority:** Metropolitan Police
`;

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
  it("emits the exact empty version-1 artifact when no catalog is authored", () => {
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
        schemaVersion: 1,
        facts: [],
        questions: [],
        objectives: [],
        authorizations: [],
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

  it("leaves a pre-existing catalog artifact unchanged on validation failure", () => {
    const catalogRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-invalid-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-invalid-out-"),
    );
    const sentinel = '{"sentinel":"keep exactly"}\n';
    try {
      writeFileSync(
        resolve(catalogRoot, "story_catalog.md"),
        `# Story Catalog

## Facts

### Fact: The visitor signed in {#visitor_signed_in}
- **Summary:** The visitor signed the register.
- **Details:** The register contains a timestamped signature.
- **Category:** timeline

### Fact: Duplicate visitor fact {#visitor_signed_in}
- **Summary:** Duplicate.
- **Details:** Duplicate details.
- **Category:** timeline
`,
      );
      writeFileSync(resolve(outRoot, "story_catalog.json"), sentinel);

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
      ).toBe(1);
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
