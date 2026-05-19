import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compile, formatErrors } from "./compile-scenes/orchestrator";

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
