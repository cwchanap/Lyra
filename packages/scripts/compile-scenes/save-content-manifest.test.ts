import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emitInvestigationScene } from "./emitter";
import { parseInvestigationScene } from "./parser-investigation";
import {
  buildSaveContentManifest,
  definitionRefKey,
  type DefinitionManifestEntryV1,
  type DefinitionRefV1,
  type EmittedSceneRecordV1,
  type SaveContentManifestV1,
} from "./save-content-manifest";
import type {
  JSONDialogueItem,
  JSONInvestigationScene,
  JSONLinearScene,
} from "./types";

const line = (text: string, speaker = "detective"): JSONDialogueItem => ({
  kind: "line",
  speaker,
  text,
  expression: null,
  portrait: null,
});

const linear = (
  queue: JSONDialogueItem[],
): EmittedSceneRecordV1<JSONLinearScene> => ({
  chapterId: "chapter_1",
  file: "scene_0.md",
  json: {
    type: "linear",
    id: "scene_0",
    title: "Opening",
    queue,
    assetRefs: [],
  },
});

function investigation(): JSONInvestigationScene {
  const path =
    "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md";
  const parsed = parseInvestigationScene(
    readFileSync(resolve(path), "utf8"),
    path,
    "investigation_scene_1",
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return emitInvestigationScene(parsed.value);
}

function manifestFor(scenes: EmittedSceneRecordV1[]): SaveContentManifestV1 {
  return buildSaveContentManifest({
    chapters: {
      chapters: [
        {
          id: "chapter_1",
          title: "Chapter 1",
          summary: "Summary",
          scenes: scenes.map(({ file, json }) => ({
            type: json.type,
            file: `chapter_1/${file.replace(/\\.md$/, ".json")}`,
          })),
        },
      ],
    },
    scenes,
    storyCatalog: {
      schemaVersion: 1,
      facts: [],
      questions: [],
      objectives: [],
      authorizations: [],
      evidenceIndex: [],
      statementsIndex: [],
    },
  });
}

function entry(
  manifest: SaveContentManifestV1,
  reference: DefinitionRefV1,
): DefinitionManifestEntryV1 {
  const key = definitionRefKey(reference);
  const found = manifest.definitions.find(
    (candidate) => definitionRefKey(candidate.reference) === key,
  );
  if (!found) throw new Error(`missing test entry ${key}`);
  return found;
}

describe("buildSaveContentManifest", () => {
  it("keeps prose changes structurally compatible", () => {
    const before = linear([line("Original copy")]);
    const after = linear([line("Corrected copy")]);

    const beforeManifest = manifestFor([before]);
    const afterManifest = manifestFor([after]);
    const beforeScene = entry(beforeManifest, {
      type: "scene",
      chapterId: "chapter_1",
      sceneId: "scene_0",
      sceneKind: "linear",
    });
    const afterScene = entry(afterManifest, beforeScene.reference);

    expect(afterScene.structuralHash).toBe(beforeScene.structuralHash);
    expect(afterScene.contentHash).not.toBe(beforeScene.contentHash);
    expect(afterManifest.contentRevision).not.toBe(
      beforeManifest.contentRevision,
    );
  });

  it("changes structure for speaker, cue, order, and progression edits", () => {
    const baseline = entry(manifestFor([linear([line("A"), line("B")])]), {
      type: "scene",
      chapterId: "chapter_1",
      sceneId: "scene_0",
      sceneKind: "linear",
    });
    const speakerEdit = entry(
      manifestFor([linear([line("A", "other"), line("B")])]),
      baseline.reference,
    );
    const orderEdit = entry(
      manifestFor([linear([{ kind: "action", text: "B" }, line("A")])]),
      baseline.reference,
    );
    const cueEdit = entry(
      manifestFor([
        linear([
          {
            kind: "sceneTag",
            text: "same copy",
            assetCue: {
              backgroundAssetId: "background.changed",
              bgm: null,
              bgs: null,
            },
          },
          line("B"),
        ]),
      ]),
      baseline.reference,
    );

    expect(speakerEdit.structuralHash).not.toBe(baseline.structuralHash);
    expect(orderEdit.structuralHash).not.toBe(baseline.structuralHash);
    expect(cueEdit.structuralHash).not.toBe(baseline.structuralHash);

    const beforeInvestigation = investigation();
    const afterInvestigation = structuredClone(beforeInvestigation);
    afterInvestigation.sublocations[0]!.hotspots[0]!.reveals = [
      { kind: "evidence", id: "changed_record" },
    ];
    const beforeEntry = entry(
      manifestFor([
        {
          chapterId: "chapter_1",
          file: "investigation_scene_1.md",
          json: beforeInvestigation,
        },
      ]),
      {
        type: "scene",
        chapterId: "chapter_1",
        sceneId: "investigation_scene_1",
        sceneKind: "investigation",
      },
    );
    const afterEntry = entry(
      manifestFor([
        {
          chapterId: "chapter_1",
          file: "investigation_scene_1.md",
          json: afterInvestigation,
        },
      ]),
      beforeEntry.reference,
    );
    expect(afterEntry.structuralHash).not.toBe(beforeEntry.structuralHash);
  });

  it("rejects duplicate typed references", () => {
    expect(() =>
      manifestFor([linear([line("First")]), linear([line("Duplicate ID")])]),
    ).toThrow("duplicate save-content definition reference");
  });
});
