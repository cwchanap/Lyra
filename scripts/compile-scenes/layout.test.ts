import { describe, expect, it } from "vitest";
import {
  applyInvestigationLayout,
  parseInvestigationLayoutJson,
} from "./layout";
import type { ASTInvestigationScene } from "./types";

const sourceFile = "chapter_1/investigation_scene_1.layout.json";

function minimalScene(): ASTInvestigationScene {
  return {
    kind: "investigationScene",
    id: "investigation_scene_1",
    title: "Test Investigation",
    intro: [],
    sublocations: [
      {
        id: "main_hall",
        label: "Main Hall",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "場景：Main Hall",
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "table",
            label: "Table",
            description: "A table.",
            status: "unlocked",
            unlock: null,
            reveals: [],
            inspectDialogue: [],
            onReexamine: null,
            sourceFile: "investigation_scene_1.md",
            line: 10,
          },
        ],
        characters: [
          {
            id: "witness",
            name: "Witness",
            role: "Witness",
            bio: "A witness.",
            topics: [],
            sourceFile: "investigation_scene_1.md",
            line: 20,
          },
        ],
        sourceFile: "investigation_scene_1.md",
        line: 5,
      },
    ],
    evidenceManifest: [],
    statementManifest: [],
    outro: { unlock: "auto", dialogue: [] },
    assetRefs: [],
    sourceFile: "investigation_scene_1.md",
    line: 1,
  };
}

function validLayoutJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    sceneId: "investigation_scene_1",
    sublocations: {
      main_hall: {
        hotspots: {
          table: { kind: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
        },
        characters: {
          witness: {
            kind: "sprite",
            assetId: "witness_standard",
            x: 0.5,
            y: 0.25,
            w: 0.2,
            h: 0.7,
            anchor: "bottomCenter",
          },
        },
      },
    },
    ...overrides,
  });
}

describe("parseInvestigationLayoutJson", () => {
  it("parses a valid layout sidecar with sublocation hotspots and characters", () => {
    const result = parseInvestigationLayoutJson(validLayoutJson(), sourceFile);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(1);
    expect(result.value.sceneId).toBe("investigation_scene_1");
    expect(result.value.sublocations.main_hall?.hotspots.table).toStrictEqual({
      kind: "rect",
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    });
    expect(
      result.value.sublocations.main_hall?.characters.witness,
    ).toStrictEqual({
      kind: "sprite",
      assetId: "witness_standard",
      x: 0.5,
      y: 0.25,
      w: 0.2,
      h: 0.7,
      anchor: "bottomCenter",
    });
  });

  it("rejects non-finite coordinates", () => {
    const result = parseInvestigationLayoutJson(
      `{
        "version": 1,
        "sceneId": "investigation_scene_1",
        "sublocations": {
          "main_hall": {
            "hotspots": {
              "table": { "kind": "rect", "x": 1e999, "y": 0.2, "w": 0.3, "h": 0.4 }
            },
            "characters": {}
          }
        }
      }`,
      sourceFile,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("layoutInvalidNumber");
    expect(
      result.errors.find((e) => e.code === "layoutInvalidNumber")?.message,
    ).toContain("sublocations.main_hall.hotspots.table.x");
  });

  it("rejects zero-size rectangles", () => {
    const result = parseInvestigationLayoutJson(
      validLayoutJson({
        sublocations: {
          main_hall: {
            hotspots: {
              table: { kind: "rect", x: 0.1, y: 0.2, w: 0, h: 0.4 },
            },
            characters: {},
          },
        },
      }),
      sourceFile,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("layoutInvalidSize");
  });
});

describe("applyInvestigationLayout", () => {
  it("attaches hotspot and character layout to matching AST targets", () => {
    const parsed = parseInvestigationLayoutJson(validLayoutJson(), sourceFile);
    if (!parsed.ok) throw new Error("Expected valid layout fixture");

    const result = applyInvestigationLayout(minimalScene(), parsed.value);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sublocation = result.value.sublocations[0];
    expect(sublocation.hotspots[0]?.layout).toStrictEqual({
      kind: "rect",
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    });
    expect(sublocation.characters[0]?.layout).toStrictEqual({
      kind: "sprite",
      assetId: "witness_standard",
      x: 0.5,
      y: 0.25,
      w: 0.2,
      h: 0.7,
      anchor: "bottomCenter",
    });
  });

  it("rejects unknown hotspots", () => {
    const parsed = parseInvestigationLayoutJson(
      validLayoutJson({
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
      }),
      sourceFile,
    );
    if (!parsed.ok) throw new Error("Expected valid layout fixture");

    const result = applyInvestigationLayout(minimalScene(), parsed.value);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const unknownHotspot = result.errors.find(
      (e) => e.code === "layoutUnknownHotspot",
    );
    expect(unknownHotspot).toBeDefined();
    expect(unknownHotspot?.sourceFile).toBe(sourceFile);
  });
});
