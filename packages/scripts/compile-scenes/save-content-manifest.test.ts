import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSaveContentManifest,
  type BuildSaveContentManifestInput,
  type SaveContentBundleV1,
} from "./save-content-manifest";
import { emitLinearScene } from "./emitter";
import { compile } from "./orchestrator";
import type {
  AssetRef,
  ASTLinearScene,
  JSONDialogueItem,
  JSONLinearScene,
} from "./types";

const line = (text: string): JSONDialogueItem => ({
  kind: "line",
  speaker: "detective",
  text,
  expression: null,
  portrait: null,
});

const linear = (id: string, title: string, queue: JSONDialogueItem[]) => ({
  type: "linear" as const,
  id,
  title,
  queue,
  assetRefs: [],
});

function bundle(
  chapters: SaveContentBundleV1["chapters"],
): SaveContentBundleV1 {
  return {
    chapters,
    storyCatalog: {
      schemaVersion: 1,
      facts: [],
      questions: [],
      objectives: [],
      authorizations: [],
      evidenceIndex: [],
      statementsIndex: [],
    },
  };
}

function chapter(id: string, title: string, scenes: JSONLinearScene[]) {
  return { id, title, summary: `${title} summary`, scenes };
}

function manifest(input: BuildSaveContentManifestInput) {
  return buildSaveContentManifest(input);
}

describe("buildSaveContentManifest", () => {
  it("has the exact minimal manifest shape", () => {
    expect(
      manifest({
        bundle: bundle([
          chapter("chapter_1", "Chapter 1", [
            linear("scene_0", "Opening", [line("A")]),
          ]),
        ]),
      }),
    ).toEqual({
      manifestVersion: 1,
      contentRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it("is deterministic for semantically identical object-key ordering", () => {
    const left = bundle([
      chapter("chapter_1", "Chapter 1", [
        linear("scene_0", "Opening", [line("A")]),
      ]),
    ]);
    const right: SaveContentBundleV1 = {
      storyCatalog: {
        statementsIndex: [],
        evidenceIndex: [],
        authorizations: [],
        objectives: [],
        questions: [],
        facts: [],
        schemaVersion: 1,
      },
      chapters: [
        {
          scenes: [
            {
              assetRefs: [],
              queue: [
                {
                  portrait: null,
                  expression: null,
                  text: "A",
                  speaker: "detective",
                  kind: "line",
                },
              ],
              title: "Opening",
              id: "scene_0",
              type: "linear",
            },
          ],
          summary: "Chapter 1 summary",
          title: "Chapter 1",
          id: "chapter_1",
        },
      ],
    };

    expect(manifest({ bundle: right }).contentRevision).toBe(
      manifest({ bundle: left }).contentRevision,
    );
  });

  it("changes for same-kind dialogue order and prose or label edits", () => {
    const baseline = bundle([
      chapter("chapter_1", "Chapter 1", [
        linear("scene_0", "Opening", [line("A"), line("B")]),
      ]),
    ]);
    const reordered = structuredClone(baseline);
    (reordered.chapters[0]!.scenes[0]! as JSONLinearScene).queue.reverse();
    const edited = structuredClone(baseline);
    edited.chapters[0]!.title = "Corrected title";
    (edited.chapters[0]!.scenes[0]! as JSONLinearScene).queue[0]!.text =
      "Corrected copy";

    const baselineRevision = manifest({ bundle: baseline }).contentRevision;
    expect(manifest({ bundle: reordered }).contentRevision).not.toBe(
      baselineRevision,
    );
    expect(manifest({ bundle: edited }).contentRevision).not.toBe(
      baselineRevision,
    );
  });

  it("changes for chapter or scene reordering", () => {
    const baseline = bundle([
      chapter("chapter_1", "Chapter 1", [
        linear("scene_0", "Opening", [line("A")]),
        linear("scene_1", "Second", [line("B")]),
      ]),
      chapter("chapter_2", "Chapter 2", [
        linear("scene_2", "Third", [line("C")]),
      ]),
    ]);
    const reorderedScenes = structuredClone(baseline);
    reorderedScenes.chapters[0]!.scenes.reverse();
    const reorderedChapters = structuredClone(baseline);
    reorderedChapters.chapters.reverse();

    const baselineRevision = manifest({ bundle: baseline }).contentRevision;
    expect(manifest({ bundle: reorderedScenes }).contentRevision).not.toBe(
      baselineRevision,
    );
    expect(manifest({ bundle: reorderedChapters }).contentRevision).not.toBe(
      baselineRevision,
    );
  });

  it("changes for emitted description, cue, ID, label, and progression edits", () => {
    const baseline = bundle([
      chapter("chapter_1", "Chapter 1", [
        linear("scene_0", "Opening", [
          {
            kind: "sceneTag",
            text: "Rainy street",
            assetCue: {
              backgroundAssetId: "background.chapter_1.street",
              bgm: { channel: "bgm", assetId: "audio.bgm.rain" },
              bgs: null,
            },
          },
          line("A"),
        ]),
      ]),
    ]);
    const descriptionEdited = structuredClone(
      baseline,
    ) as SaveContentBundleV1 & {
      chapters: Array<{ scenes: Array<{ description?: string }> }>;
    };
    descriptionEdited.chapters[0]!.scenes[0]!.description =
      "Corrected description";
    const cueEdited = structuredClone(baseline);
    const cue = (cueEdited.chapters[0]!.scenes[0] as JSONLinearScene).queue[0]!;
    if (cue.kind !== "sceneTag" || !cue.assetCue)
      throw new Error("expected cue");
    cue.assetCue.bgm = { channel: "bgm", assetId: "audio.bgm.wind" };
    const idEdited = structuredClone(baseline);
    idEdited.chapters[0]!.scenes[0]!.id = "scene_renamed";
    const progressionEdited = structuredClone(baseline);
    progressionEdited.storyCatalog.objectives.push({
      id: "find_truth",
      label: "Find the truth",
      summary: "Progress the investigation.",
      kind: "primary",
      sortOrder: 1,
    });

    const baselineRevision = manifest({ bundle: baseline }).contentRevision;
    for (const edited of [
      descriptionEdited as SaveContentBundleV1,
      cueEdited,
      idEdited,
      progressionEdited,
    ]) {
      expect(manifest({ bundle: edited }).contentRevision).not.toBe(
        baselineRevision,
      );
    }

    const labelledBaseline = structuredClone(baseline);
    labelledBaseline.storyCatalog.objectives.push({
      id: "find_truth",
      label: "Find the truth",
      summary: "Progress the investigation.",
      kind: "primary",
      sortOrder: 1,
    });
    const labelEdited = structuredClone(labelledBaseline);
    labelEdited.storyCatalog.objectives[0]!.label = "Find the real truth";
    expect(manifest({ bundle: labelEdited }).contentRevision).not.toBe(
      manifest({ bundle: labelledBaseline }).contentRevision,
    );
  });

  it("includes newly emitted static fields without an allowlist update", () => {
    const baseline = bundle([
      chapter("chapter_1", "Chapter 1", [
        linear("scene_0", "Opening", [line("A")]),
      ]),
    ]);
    const withNewField = structuredClone(baseline);
    Object.assign(withNewField.chapters[0]!.scenes[0]!, {
      futureStaticField: "new emitted semantic value",
    });

    expect(manifest({ bundle: withNewField }).contentRevision).not.toBe(
      manifest({ bundle: baseline }).contentRevision,
    );
  });

  it("ignores source locations, raw Markdown, absolute paths, and timestamps", () => {
    const semanticBundle = bundle([
      chapter("chapter_1", "Chapter 1", [
        linear("scene_0", "Opening", [line("A")]),
      ]),
    ]);
    const fromFirstPath = {
      bundle: semanticBundle,
      sourcePath: "/one/source/chapter_1/scene_0.md",
      rawMarkdown: "# Scene\n\n**Detective**：A",
      sourceLocation: {
        sourceFile: "/one/source/chapter_1/scene_0.md",
        line: 1,
      },
      compiledAt: "2026-07-26T00:00:00.000Z",
    } as BuildSaveContentManifestInput & {
      sourcePath: string;
      rawMarkdown: string;
      sourceLocation: { sourceFile: string; line: number };
      compiledAt: string;
    };
    const fromSecondPath = {
      bundle: semanticBundle,
      sourcePath: "/another/source/chapter_1/scene_0.md",
      rawMarkdown: "# Scene\n\n[旁白：A]",
      sourceLocation: {
        sourceFile: "/another/source/chapter_1/scene_0.md",
        line: 99,
      },
      compiledAt: "2099-01-01T00:00:00.000Z",
    } as typeof fromFirstPath;

    expect(manifest(fromSecondPath).contentRevision).toBe(
      manifest(fromFirstPath).contentRevision,
    );
  });

  it("normalizes unordered emitted asset refs before package hashing", () => {
    const audio = {
      type: "audio",
      assetId: "audio.bgs.rain",
    } satisfies AssetRef;
    const background = {
      type: "background",
      assetId: "background.chapter_1.street",
    } satisfies AssetRef;
    const portrait = {
      type: "portrait",
      assetId: "portrait.detective.standard",
    } satisfies AssetRef;
    const emit = (assetRefs: AssetRef[]) =>
      emitLinearScene({
        kind: "linearScene",
        id: "scene_0",
        title: "Opening",
        queue: [],
        assetRefs,
        sourceFile: "chapter_1/scene_0.md",
        line: 1,
      } satisfies ASTLinearScene);
    const first = emit([portrait, audio, background]);
    const second = emit([background, portrait, audio]);
    const changed = emit([
      background,
      portrait,
      { type: "audio", assetId: "audio.bgs.wind" },
    ]);

    expect(first.assetRefs).toEqual([audio, background, portrait]);
    expect(second.assetRefs).toEqual(first.assetRefs);
    const firstRevision = manifest({
      bundle: bundle([chapter("chapter_1", "Chapter 1", [first])]),
    }).contentRevision;
    expect(
      manifest({
        bundle: bundle([chapter("chapter_1", "Chapter 1", [second])]),
      }).contentRevision,
    ).toBe(firstRevision);
    expect(
      manifest({
        bundle: bundle([chapter("chapter_1", "Chapter 1", [changed])]),
      }).contentRevision,
    ).not.toBe(firstRevision);
  });

  it("emits the reviewed cross-host content revision with compiler-owned re-examination defaults", () => {
    const fixtureRoot = resolve(
      "packages/scripts/__fixtures__/save_content_revision_golden",
    );
    const outputRoot = mkdtempSync(join(tmpdir(), "lyra-content-revision-"));
    const result = compile({
      sourceRoot: join(fixtureRoot, "stories_plan"),
      assetConfigRoot: join(fixtureRoot, "assets/config"),
      outputRoot,
      assetOutputRoot: join(outputRoot, "assets"),
      repoRoot: fixtureRoot,
    });
    expect(result.ok).toBe(true);
    const expected = readFileSync(
      join(fixtureRoot, "expected-content-revision.txt"),
      "utf8",
    ).trimEnd();
    const manifest = JSON.parse(
      readFileSync(join(outputRoot, "save_content_manifest.json"), "utf8"),
    ) as { manifestVersion: number; contentRevision: string };
    expect(manifest).toEqual({ manifestVersion: 1, contentRevision: expected });
    const investigation = JSON.parse(
      readFileSync(
        join(outputRoot, "chapter_1/investigation_scene_1.json"),
        "utf8",
      ),
    ) as {
      sublocations: Array<{
        hotspots: Array<{ onReexamine: unknown }>;
        characters: Array<{ topics: Array<{ onReexamine: unknown }> }>;
      }>;
      evidenceManifest: Array<{ onReexamine: unknown }>;
      statementManifest: Array<{ onReexamine: unknown }>;
    };
    const fallback = [{ kind: "action", text: "（沒有新發現。）" }];
    expect(investigation.sublocations[0]!.hotspots[0]!.onReexamine).toEqual(
      fallback,
    );
    expect(
      investigation.sublocations[0]!.characters[0]!.topics[0]!.onReexamine,
    ).toEqual(fallback);
    expect(investigation.evidenceManifest[0]!.onReexamine).toEqual(fallback);
    expect(investigation.statementManifest[0]!.onReexamine).toEqual(fallback);

    const physicalRoot = mkdtempSync(join(tmpdir(), "lyra-physical-assets-"));
    const physicalFile = join(physicalRoot, "static/assets/audio/bgm/rain.ogg");
    mkdirSync(resolve(physicalFile, ".."), { recursive: true });
    writeFileSync(physicalFile, "first physical bytes");
    const physicalOutputOne = mkdtempSync(
      join(tmpdir(), "lyra-content-revision-"),
    );
    const firstPhysical = compile({
      sourceRoot: join(fixtureRoot, "stories_plan"),
      assetConfigRoot: join(fixtureRoot, "assets/config"),
      outputRoot: physicalOutputOne,
      assetOutputRoot: join(physicalOutputOne, "assets"),
      repoRoot: physicalRoot,
    });
    expect(firstPhysical.ok).toBe(true);
    writeFileSync(physicalFile, "different physical bytes and mapping root");
    const physicalOutputTwo = mkdtempSync(
      join(tmpdir(), "lyra-content-revision-"),
    );
    const secondPhysical = compile({
      sourceRoot: join(fixtureRoot, "stories_plan"),
      assetConfigRoot: join(fixtureRoot, "assets/config"),
      outputRoot: physicalOutputTwo,
      assetOutputRoot: join(physicalOutputTwo, "assets"),
      repoRoot: physicalRoot,
    });
    expect(secondPhysical.ok).toBe(true);
    for (const output of [physicalOutputOne, physicalOutputTwo]) {
      expect(
        (
          JSON.parse(
            readFileSync(join(output, "save_content_manifest.json"), "utf8"),
          ) as { contentRevision: string }
        ).contentRevision,
      ).toBe(expected);
    }
  });
});
