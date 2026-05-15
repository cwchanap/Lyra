import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
