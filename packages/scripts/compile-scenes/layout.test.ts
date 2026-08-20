import { describe, expect, it } from "vitest";
import {
  applyInvestigationLayout,
  detectLayoutOverlaps,
  parseInvestigationLayoutJson,
} from "./layout";
import type {
  ASTInvestigationScene,
  InvestigationLayoutSidecar,
  RectLayout,
} from "./types";

const sourceFile = "chapter_1/investigation_scene_1.layout.json";

function minimalScene(): ASTInvestigationScene {
  return {
    kind: "investigationScene",
    id: "investigation_scene_1",
    title: "Test Investigation",
    summary: "Test Investigation",
    summaryAuthored: false,
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
            evidenceSource: null,
            sceneSourcePrompt: null,
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
            assetId: "portrait.witness.standard",
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

function validBakedLayoutJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    sceneId: "investigation_scene_1",
    sublocations: {
      main_hall: {
        hotspots: {},
        characters: {
          witness: {
            kind: "baked",
            x: 0.42,
            y: 0.18,
            w: 0.2,
            h: 0.7,
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
      assetId: "portrait.witness.standard",
      x: 0.5,
      y: 0.25,
      w: 0.2,
      h: 0.7,
      anchor: "bottomCenter",
    });
  });

  it("parses a baked character interaction region", () => {
    const result = parseInvestigationLayoutJson(
      validBakedLayoutJson(),
      sourceFile,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.sublocations.main_hall?.characters.witness,
    ).toStrictEqual({
      kind: "baked",
      x: 0.42,
      y: 0.18,
      w: 0.2,
      h: 0.7,
    });
  });

  it("rejects invalid baked character geometry", () => {
    const result = parseInvestigationLayoutJson(
      validBakedLayoutJson({
        sublocations: {
          main_hall: {
            hotspots: {},
            characters: {
              witness: {
                kind: "baked",
                x: 0.42,
                y: 0.18,
                w: 0,
                h: 0.7,
              },
            },
          },
        },
      }),
      sourceFile,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((entry) => entry.code)).toContain(
      "layoutInvalidSize",
    );
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

  it("rejects sprite layout with non-bottomCenter anchor", () => {
    const result = parseInvestigationLayoutJson(
      validLayoutJson({
        sublocations: {
          main_hall: {
            hotspots: {},
            characters: {
              witness: {
                kind: "sprite",
                assetId: "portrait.witness.standard",
                x: 0.5,
                y: 0.25,
                w: 0.2,
                h: 0.7,
                anchor: "topLeft",
              },
            },
          },
        },
      }),
      sourceFile,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("layoutInvalidAnchor");
    const anchorError = result.errors.find(
      (e) => e.code === "layoutInvalidAnchor",
    );
    expect(anchorError?.message).toContain("bottomCenter");
  });

  it("rejects sprite assetIds without recognized prefix", () => {
    const result = parseInvestigationLayoutJson(
      validLayoutJson({
        sublocations: {
          main_hall: {
            hotspots: {},
            characters: {
              witness: {
                kind: "sprite",
                assetId: "noprefix_here",
                x: 0.5,
                y: 0.25,
                w: 0.2,
                h: 0.7,
                anchor: "bottomCenter",
              },
            },
          },
        },
      }),
      sourceFile,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain(
      "layoutUnrecognizedAssetId",
    );
  });

  it("rejects malformed portrait assetId with too few segments", () => {
    const result = parseInvestigationLayoutJson(
      validLayoutJson({
        sublocations: {
          main_hall: {
            hotspots: {},
            characters: {
              witness: {
                kind: "sprite",
                assetId: "portrait.invalid",
                x: 0.5,
                y: 0.25,
                w: 0.2,
                h: 0.7,
                anchor: "bottomCenter",
              },
            },
          },
        },
      }),
      sourceFile,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain(
      "layoutInvalidPortraitAssetId",
    );
    const err = result.errors.find(
      (e) => e.code === "layoutInvalidPortraitAssetId",
    );
    expect(err?.message).toContain("portrait.<characterId>.<expression>");
  });

  it("accepts well-formed portrait assetId", () => {
    const result = parseInvestigationLayoutJson(
      validLayoutJson({
        sublocations: {
          main_hall: {
            hotspots: {
              table: { kind: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
            },
            characters: {
              witness: {
                kind: "sprite",
                assetId: "portrait.hayasaka_akane.concerned",
                x: 0.5,
                y: 0.25,
                w: 0.2,
                h: 0.7,
                anchor: "bottomCenter",
              },
            },
          },
        },
      }),
      sourceFile,
    );

    expect(result.ok).toBe(true);
  });
});

describe("applyInvestigationLayout", () => {
  it("attaches hotspot and character layout to matching AST targets", () => {
    const parsed = parseInvestigationLayoutJson(validLayoutJson(), sourceFile);
    if (!parsed.ok) throw new Error("Expected valid layout fixture");

    const result = applyInvestigationLayout(minimalScene(), parsed.value);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sublocation = result.value.sublocations[0]!;
    expect(sublocation.hotspots[0]?.layout).toStrictEqual({
      kind: "rect",
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    });
    expect(sublocation.characters[0]?.layout).toStrictEqual({
      kind: "sprite",
      assetId: "portrait.witness.standard",
      x: 0.5,
      y: 0.25,
      w: 0.2,
      h: 0.7,
      anchor: "bottomCenter",
    });
  });

  it("attaches a baked character interaction region to the AST", () => {
    const parsed = parseInvestigationLayoutJson(
      validBakedLayoutJson(),
      sourceFile,
    );
    if (!parsed.ok) throw new Error("Expected valid baked layout fixture");

    const result = applyInvestigationLayout(minimalScene(), parsed.value);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sublocations[0]?.characters[0]?.layout).toStrictEqual({
      kind: "baked",
      x: 0.42,
      y: 0.18,
      w: 0.2,
      h: 0.7,
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

function rect(x: number, y: number, w: number, h: number): RectLayout {
  return { kind: "rect", x, y, w, h };
}

function layoutWithHotspots(
  hotspots: Record<string, RectLayout>,
  options: {
    sublocation?: string;
    intentionalOverlaps?: ReadonlyArray<{
      hotspots: readonly [string, string];
    }>;
  } = {},
): InvestigationLayoutSidecar {
  const sublocation = options.sublocation ?? "main_hall";
  const entry: InvestigationLayoutSidecar["sublocations"][string] = {
    hotspots,
    characters: {},
  };
  if (options.intentionalOverlaps && options.intentionalOverlaps.length > 0) {
    entry.intentionalOverlaps = options.intentionalOverlaps.map((p) => ({
      hotspots: [p.hotspots[0], p.hotspots[1]],
    }));
  }
  return {
    version: 1,
    sceneId: "investigation_scene_1",
    sublocations: {
      [sublocation]: entry,
    },
  };
}

describe("detectLayoutOverlaps", () => {
  it("returns no warnings when hotspots in a sublocation do not overlap", () => {
    const layout = layoutWithHotspots({
      a: rect(0.1, 0.1, 0.2, 0.2),
      b: rect(0.5, 0.5, 0.2, 0.2),
    });

    expect(detectLayoutOverlaps(layout, sourceFile)).toEqual([]);
  });

  it("warns once per overlapping hotspot pair within a sublocation", () => {
    // Near-identical rects: overlap is ~95% of the smaller rect → above the
    // 80% threshold.
    const layout = layoutWithHotspots({
      kagami: rect(0.25, 0.29, 0.22, 0.2),
      slips: rect(0.26, 0.29, 0.22, 0.2),
    });

    const warnings = detectLayoutOverlaps(layout, sourceFile);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("layoutHotspotOverlap");
    expect(warnings[0]?.sourceFile).toBe(sourceFile);
    expect(warnings[0]?.message).toContain("main_hall");
    expect(warnings[0]?.message).toContain("kagami");
    expect(warnings[0]?.message).toContain("slips");
  });

  it("does not warn when overlap is below the 80% threshold", () => {
    // Partial corner overlap: ~49% of the smaller rect → below threshold.
    const layout = layoutWithHotspots({
      kagami: rect(0.245916, 0.289239, 0.220529, 0.201036),
      slips: rect(0.336339, 0.273903, 0.286957, 0.182609),
    });

    expect(detectLayoutOverlaps(layout, sourceFile)).toEqual([]);
  });

  it("treats the 80% threshold as inclusive and fires exactly at the boundary", () => {
    // Two equal rects offset along x. overlapRatio = (w - dx) / w when both
    // rects share the full y-extent, so dx = w * (1 - ratio) hits an exact
    // target ratio. w = 0.2 here.
    //
    //   dx = 0.0402 -> ratio = 0.799  (just below -> no warn)
    //   dx = 0.04    -> ratio = 0.8   (exactly at threshold -> warn, `>=`)
    //   dx = 0.0398  -> ratio = 0.801 (just above -> warn)
    const w = 0.2;
    const cases: Array<{ dx: number; ratio: number; warns: boolean }> = [
      { dx: 0.0402, ratio: 0.799, warns: false },
      { dx: 0.04, ratio: 0.8, warns: true },
      { dx: 0.0398, ratio: 0.801, warns: true },
    ];
    for (const { dx, ratio, warns } of cases) {
      const layout = layoutWithHotspots({
        a: rect(0.1, 0.1, w, w),
        b: rect(0.1 + dx, 0.1, w, w),
      });
      const warnings = detectLayoutOverlaps(layout, sourceFile);
      if (warns) {
        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.code).toBe("layoutHotspotOverlap");
        expect(warnings[0]?.message).toContain(`${Math.round(ratio * 100)}%`);
      } else {
        expect(warnings).toEqual([]);
      }
    }
  });

  it("does not warn when two rects only share an edge (adjacency is allowed)", () => {
    const layout = layoutWithHotspots({
      left: rect(0.1, 0.1, 0.2, 0.2),
      // left.x + left.w === 0.3 === right.x → touching, no shared interior.
      right: rect(0.3, 0.1, 0.2, 0.2),
    });

    expect(detectLayoutOverlaps(layout, sourceFile)).toEqual([]);
  });

  it("warns when one rect is fully nested inside another", () => {
    const layout = layoutWithHotspots({
      outer: rect(0.1, 0.1, 0.6, 0.6),
      inner: rect(0.2, 0.2, 0.1, 0.1),
    });

    const warnings = detectLayoutOverlaps(layout, sourceFile);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("layoutHotspotOverlap");
  });

  it("does not compare hotspots across different sublocations", () => {
    // Same coordinates, but in different sublocations (distinct travel
    // destinations that are never on screen together) → no overlap.
    const layout: InvestigationLayoutSidecar = {
      version: 1,
      sceneId: "investigation_scene_1",
      sublocations: {
        office: {
          hotspots: { desk: rect(0.2, 0.2, 0.3, 0.3) },
          characters: {},
        },
        lobby: {
          hotspots: { door: rect(0.2, 0.2, 0.3, 0.3) },
          characters: {},
        },
      },
    };

    expect(detectLayoutOverlaps(layout, sourceFile)).toEqual([]);
  });

  it("reports each overlapping pair independently for three mutually overlapping rects", () => {
    // Near-identical rects offset by 0.01: each pair overlaps ~90-95% of the
    // smaller rect → all above the 80% threshold.
    const layout = layoutWithHotspots({
      a: rect(0.1, 0.1, 0.4, 0.4),
      b: rect(0.11, 0.11, 0.4, 0.4),
      c: rect(0.12, 0.12, 0.4, 0.4),
    });

    // C(3, 2) = 3 distinct overlapping pairs.
    expect(detectLayoutOverlaps(layout, sourceFile)).toHaveLength(3);
  });

  it("returns no warnings for an empty sublocation", () => {
    const layout = layoutWithHotspots({});

    expect(detectLayoutOverlaps(layout, sourceFile)).toEqual([]);
  });

  it("suppresses a warning for a pair listed in intentionalOverlaps", () => {
    const layout = layoutWithHotspots(
      {
        // Near-identical rects: ~95% overlap → would warn without opt-out.
        a: rect(0.1, 0.1, 0.4, 0.4),
        b: rect(0.11, 0.11, 0.4, 0.4),
      },
      { intentionalOverlaps: [{ hotspots: ["a", "b"] }] },
    );

    expect(detectLayoutOverlaps(layout, sourceFile)).toEqual([]);
  });

  it("treats intentionalOverlaps pair order as unordered", () => {
    const layout = layoutWithHotspots(
      {
        a: rect(0.1, 0.1, 0.4, 0.4),
        b: rect(0.11, 0.11, 0.4, 0.4),
      },
      { intentionalOverlaps: [{ hotspots: ["b", "a"] }] },
    );

    expect(detectLayoutOverlaps(layout, sourceFile)).toEqual([]);
  });

  it("suppresses only the listed pair, not other overlapping pairs", () => {
    const layout = layoutWithHotspots(
      {
        // Near-identical rects: each pair overlaps >80% → all would warn
        // without opt-out.
        a: rect(0.1, 0.1, 0.4, 0.4),
        b: rect(0.11, 0.11, 0.4, 0.4),
        c: rect(0.12, 0.12, 0.4, 0.4),
      },
      { intentionalOverlaps: [{ hotspots: ["a", "b"] }] },
    );

    const warnings = detectLayoutOverlaps(layout, sourceFile);

    // a↔b suppressed; a↔c and b↔c still warn.
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.code === "layoutHotspotOverlap")).toBe(true);
    const messages = warnings.map((w) => w.message).sort();
    expect(messages[0]).toContain("a");
    expect(messages[0]).toContain("c");
    expect(messages[1]).toContain("b");
    expect(messages[1]).toContain("c");
  });
});

describe("parseInvestigationLayoutJson intentionalOverlaps", () => {
  function parse(raw: string) {
    return parseInvestigationLayoutJson(raw, sourceFile);
  }

  function overlappingLayoutJson(intentionalOverlaps: unknown): string {
    return JSON.stringify({
      version: 1,
      sceneId: "investigation_scene_1",
      sublocations: {
        main_hall: {
          hotspots: {
            a: { kind: "rect", x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
            b: { kind: "rect", x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
          },
          characters: {},
          intentionalOverlaps,
        },
      },
    });
  }

  it("parses a valid intentionalOverlaps list and suppresses the warning", () => {
    const result = parse(overlappingLayoutJson([{ hotspots: ["a", "b"] }]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(detectLayoutOverlaps(result.value, sourceFile)).toEqual([]);
  });

  it("errors when intentionalOverlaps is not an array", () => {
    const result = parse(overlappingLayoutJson("nope"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.code === "layoutInvalidIntentionalOverlaps"),
    ).toBe(true);
  });

  it("errors on a malformed pair entry", () => {
    const result = parse(overlappingLayoutJson([{ hotspots: ["a"] }]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.code === "layoutInvalidIntentionalOverlaps"),
    ).toBe(true);
  });

  it("errors when an opt-out references an unknown hotspot", () => {
    const result = parse(overlappingLayoutJson([{ hotspots: ["a", "ghost"] }]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some(
        (e) => e.code === "layoutUnknownIntentionalOverlapHotspot",
      ),
    ).toBe(true);
  });

  it("errors on a self-pair", () => {
    const result = parse(overlappingLayoutJson([{ hotspots: ["a", "a"] }]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.code === "layoutInvalidIntentionalOverlaps"),
    ).toBe(true);
  });

  it("errors on a duplicate pair", () => {
    const result = parse(
      overlappingLayoutJson([
        { hotspots: ["a", "b"] },
        { hotspots: ["b", "a"] },
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.code === "layoutDuplicateIntentionalOverlap"),
    ).toBe(true);
  });
});
