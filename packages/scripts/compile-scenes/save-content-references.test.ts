import { describe, expect, it } from "vitest";
import { validateSaveContentReferences } from "./save-content-references";
import type { AssetConfig } from "./assets/config";
import type { AssetManifest } from "./assets/manifest";
import type { SceneRecord } from "./validator";

const sourceFile = "chapter_1/investigation_scene_1.md";
const refs = [
  ["background", "background.chapter_1.office"],
  ["portrait", "portrait.detective.standard"],
  ["evidence", "evidence.receipt"],
  ["audio", "audio.bgm.rain"],
  ["audio", "audio.bgs.street"],
  ["audio", "audio.sfx.click"],
] as const;

function config(): AssetConfig {
  return {
    enabled: true,
    globalStylePrompt: "",
    types: {} as AssetConfig["types"],
    characters: {
      byId: new Map([
        [
          "detective",
          {
            id: "detective",
            displayNames: ["偵探"],
            portraitMode: "portrait",
            visualPrompt: null,
            referenceAssetId: null,
            expressions: new Map([
              ["standard", { id: "standard", prompt: "" }],
            ]),
          },
        ],
      ]),
      byDisplayName: new Map(),
    },
    audio: {
      bgm: new Map([["rain", { id: "rain", prompt: "", loop: true }]]),
      bgs: new Map([["street", { id: "street", prompt: "", loop: true }]]),
      sfx: new Map([["click", { id: "click", prompt: "", loop: false }]]),
    },
  };
}

function manifest(ids = refs.map(([, id]) => id)): AssetManifest {
  return {
    enabled: true,
    entries: ids.map((assetId) => ({
      assetId,
      type: assetId.startsWith("audio.")
        ? "audio"
        : assetId.startsWith("portrait.")
          ? "portrait"
          : assetId.startsWith("evidence.")
            ? "evidence"
            : "background",
      source: {},
      expectedPath: "different-physical-path",
      publicPath: "/different-public-path",
      promptParts: {
        globalStyle: "",
        typePrompt: "",
        subjectPrompt: "",
        entryPrompt: "",
      },
      finalPrompt: "",
    })),
  };
}

function scene(): SceneRecord {
  return {
    chapterId: "chapter_1",
    file: "investigation_scene_1.md",
    ast: {
      kind: "investigationScene",
      id: "investigation_scene_1",
      title: "調查",
      summary: "調查",
      summaryAuthored: false,
      intro: [],
      assetRefs: [{ type: "audio", assetId: "audio.sfx.click" }],
      sourceFile,
      line: 1,
      sublocations: [
        {
          id: "office",
          label: "辦公室",
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "室內",
          assetCue: {
            backgroundPrompt: null,
            backgroundAssetId: "background.chapter_1.office",
            bgm: { channel: "bgm", assetId: "audio.bgm.rain" },
            bgs: { channel: "bgs", assetId: "audio.bgs.street" },
          },
          transitionDialogue: [],
          sourceFile,
          line: 2,
          hotspots: [],
          characters: [
            {
              id: "detective",
              name: "偵探",
              role: "",
              bio: "",
              sourceFile,
              line: 3,
              topics: [],
            },
          ],
        },
      ],
      evidenceManifest: [
        {
          id: "receipt",
          name: "收據",
          description: "",
          details: "",
          sourceSublocationId: null,
          imageCue: { imagePrompt: null, imageAssetId: "evidence.receipt" },
          onCollect: [],
          onReexamine: [
            {
              kind: "line",
              speaker: "偵探",
              text: "查看",
              expression: "standard",
              portrait: {
                characterId: "detective",
                expression: "standard",
                assetId: "portrait.detective.standard",
              },
            },
          ],
          sourceFile,
          line: 4,
        },
      ],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
    },
  };
}

describe("validateSaveContentReferences", () => {
  it("accepts every emitted semantic background, portrait, image, and BGM/BGS/SFX reference once", () => {
    expect(
      validateSaveContentReferences({
        scenes: [scene()],
        config: config(),
        manifest: manifest(),
      }),
    ).toEqual([]);
  });

  it("reports an emitted semantic asset missing from the manifest at its source location", () => {
    const errors = validateSaveContentReferences({
      scenes: [scene()],
      config: config(),
      manifest: manifest(refs.slice(0, -1).map(([, id]) => id)),
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "saveContentReferenceMissing",
        sourceFile,
        line: 1,
      }),
    );
  });

  it("reports a missing semantic audio declaration at its source location", () => {
    const cfg = config();
    cfg.audio.bgm.clear();
    const errors = validateSaveContentReferences({
      scenes: [scene()],
      config: cfg,
      manifest: manifest(),
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "saveContentReferenceMissing",
        sourceFile,
        line: 2,
      }),
    );
  });

  it("reports a missing semantic portrait declaration at its source location", () => {
    const cfg = config();
    cfg.characters.byId.get("detective")!.expressions.delete("standard");
    const errors = validateSaveContentReferences({
      scenes: [scene()],
      config: cfg,
      manifest: manifest(),
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "saveContentReferenceMissing",
        sourceFile,
        line: 4,
      }),
    );
  });

  it("reports a semantic manifest ID declared more than once", () => {
    const errors = validateSaveContentReferences({
      scenes: [scene()],
      config: config(),
      manifest: manifest([...refs.map(([, id]) => id), "evidence.receipt"]),
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "saveContentReferenceAmbiguous",
        sourceFile,
        line: 4,
      }),
    );
  });
});
