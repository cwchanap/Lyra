import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseCityMapJson } from "./city-map";
import { compile } from "./orchestrator";

const VALID_MAP = {
  version: 2,
  id: "tokyo",
  backgroundPrompt:
    "Stylized illustrated investigation map of modern Tokyo at night after rain.",
  regions: [
    {
      id: "kichijoji",
      label: "吉祥寺",
      x: 0.09,
      y: 0.42,
      backgroundPrompt: "Stylized illustrated Kichijoji district at night.",
    },
    {
      id: "shibuya",
      label: "澀谷",
      x: 0.324,
      y: 0.588,
      backgroundPrompt: "Stylized illustrated Shibuya district at night.",
    },
    {
      id: "ginza_minato",
      label: "銀座・港區",
      x: 0.688,
      y: 0.556,
      backgroundPrompt:
        "Stylized illustrated Ginza and Minato waterfront at night.",
    },
  ],
  locations: [
    {
      id: "rain_bell_cafe",
      label: "雨鐘咖啡館",
      regionId: "kichijoji",
      x: 0.37,
      y: 0.72,
    },
    {
      id: "kichijoji_shopping_street",
      label: "吉祥寺商店街",
      regionId: "kichijoji",
      x: 0.672,
      y: 0.514,
    },
    {
      id: "police_meeting_room",
      label: "警署臨時會面室",
      regionId: null,
      x: 0.29,
      y: 0.5,
    },
    {
      id: "outsourced_review_office",
      label: "外包資料審查分室",
      regionId: null,
      x: 0.34,
      y: 0.29,
    },
    {
      id: "soma_detective_office",
      label: "相馬偵探事務所",
      regionId: null,
      x: 0.54,
      y: 0.38,
    },
    {
      id: "kagami_review_room",
      label: "KAGAMI 證據摘要審查室",
      regionId: null,
      x: 0.72,
      y: 0.45,
    },
  ],
};

/** Serialize a (possibly mutated) topology object the way an author would. */
function serialize(mutate: (map: Record<string, unknown>) => void): string {
  const map = structuredClone(VALID_MAP) as unknown as Record<string, unknown>;
  mutate(map);
  return JSON.stringify(map, null, 2);
}

function parse(source: string) {
  return parseCityMapJson(source, "city_map.json");
}

function expectRejected(source: string, code: string) {
  const result = parse(source);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(
    result.errors.some((error) => error.code === code),
    `expected ${code}, got: ${result.errors.map((e) => e.code).join(", ")}`,
  ).toBe(true);
}

describe("parseCityMapJson", () => {
  it("parses the v2 topology with regions, nullable regionId, and six anchors", () => {
    const result = parse(JSON.stringify(VALID_MAP, null, 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      ...VALID_MAP,
      sourceFile: "city_map.json",
    });
    // The old reserved `shibuya` location is gone; the region owns the slug.
    expect(result.value.locations.map((l) => l.id)).not.toContain("shibuya");
    expect(result.value.locations).toHaveLength(6);
  });

  it("legalizes unused future regions in global topology", () => {
    const result = parse(JSON.stringify(VALID_MAP, null, 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // shibuya + ginza_minato have no production locations yet — legal (§9).
    expect(result.value.regions.map((r) => r.id)).toEqual([
      "kichijoji",
      "shibuya",
      "ginza_minato",
    ]);
  });

  it("rejects invalid JSON", () => {
    const result = parse("{not json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("cityMapInvalidJson");
    expect(result.errors[0]?.sourceFile).toBe("city_map.json");
  });

  it("rejects a non-object root", () => {
    const result = parse("[1, 2, 3]");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("cityMapInvalidRoot");
  });

  it("rejects the v1 topology (hard cutover, no compatibility parser)", () => {
    expectRejected(
      serialize((map) => {
        map.version = 1;
      }),
      "cityMapUnsupportedVersion",
    );
  });

  it("rejects a wrong map ID", () => {
    expectRejected(
      serialize((map) => {
        map.id = "osaka";
      }),
      "cityMapInvalidId",
    );
  });

  it("rejects a blank background prompt", () => {
    expectRejected(
      serialize((map) => {
        map.backgroundPrompt = "   ";
      }),
      "cityMapMissingBackgroundPrompt",
    );
  });

  it("rejects a missing regions array", () => {
    expectRejected(
      serialize((map) => {
        delete map.regions;
      }),
      "cityMapMissingRegions",
    );
  });

  it("rejects a region whose id equals the root map id", () => {
    // `background.city_map.tokyo` is the overview raster's assetId; a region
    // with the same slug would collide with it and silently lose its own art
    // to manifest dedup.
    expectRejected(
      serialize((map) => {
        lastRegion(map).id = "tokyo";
      }),
      "cityMapReservedRegionId",
    );
  });

  it("rejects a non-slug region ID", () => {
    expectRejected(
      serialize((map) => {
        lastRegion(map).id = "Shibuya Station";
      }),
      "cityMapInvalidRegionId",
    );
  });

  it("rejects a blank region label", () => {
    expectRejected(
      serialize((map) => {
        lastRegion(map).label = "  ";
      }),
      "cityMapInvalidLabel",
    );
  });

  it("rejects a region without a background prompt", () => {
    expectRejected(
      serialize((map) => {
        lastRegion(map).backgroundPrompt = "";
      }),
      "cityMapMissingRegionBackgroundPrompt",
    );
  });

  it("rejects out-of-range region coordinates", () => {
    expectRejected(
      serialize((map) => {
        lastRegion(map).y = 1.5;
      }),
      "cityMapCoordinateOutOfRange",
    );
  });

  it("rejects non-number region coordinates", () => {
    expectRejected(
      serialize((map) => {
        lastRegion(map).x = "0.5";
      }),
      "cityMapInvalidCoordinate",
    );
  });

  it("rejects duplicate slugs across the shared region/location namespace", () => {
    // region id colliding with a location id
    expectRejected(
      serialize((map) => {
        lastLocation(map).id = "shibuya";
      }),
      "cityMapDuplicateSlug",
    );
    // two regions with the same id
    expectRejected(
      serialize((map) => {
        const regions = map.regions as Record<string, unknown>[];
        regions.push({ ...structuredClone(regions[0]) });
      }),
      "cityMapDuplicateSlug",
    );
    // two locations with the same id
    expectRejected(
      serialize((map) => {
        lastLocation(map).id = "rain_bell_cafe";
      }),
      "cityMapDuplicateSlug",
    );
  });

  it("rejects a blank location ID", () => {
    expectRejected(
      serialize((map) => {
        lastLocation(map).id = "";
      }),
      "cityMapInvalidLocationId",
    );
  });

  it("rejects a non-slug location ID", () => {
    expectRejected(
      serialize((map) => {
        lastLocation(map).id = "Shibuya Station";
      }),
      "cityMapInvalidLocationId",
    );
  });

  it("rejects a blank location label", () => {
    expectRejected(
      serialize((map) => {
        lastLocation(map).label = "  ";
      }),
      "cityMapInvalidLabel",
    );
  });

  it("rejects an unknown region reference", () => {
    expectRejected(
      serialize((map) => {
        lastLocation(map).regionId = "ghost_district";
      }),
      "cityMapUnknownRegionReference",
    );
  });

  it("rejects a non-string regionId", () => {
    expectRejected(
      serialize((map) => {
        lastLocation(map).regionId = 42;
      }),
      "cityMapInvalidRegionReference",
    );
  });

  it("rejects non-number coordinates", () => {
    expectRejected(
      serialize((map) => {
        lastLocation(map).x = "0.5";
      }),
      "cityMapInvalidCoordinate",
    );
  });

  it("rejects non-finite coordinates", () => {
    expectRejected(
      serialize((map) => {
        lastLocation(map).x = null;
      }),
      "cityMapInvalidCoordinate",
    );
  });

  it("rejects coordinates below the [0,1] range", () => {
    expectRejected(
      serialize((map) => {
        lastLocation(map).x = -0.1;
      }),
      "cityMapCoordinateOutOfRange",
    );
  });

  it("rejects coordinates above the [0,1] range", () => {
    expectRejected(
      serialize((map) => {
        lastLocation(map).x = 1.5;
      }),
      "cityMapCoordinateOutOfRange",
    );
  });
});

function lastLocation(map: Record<string, unknown>): Record<string, unknown> {
  const locations = map.locations as Record<string, unknown>[];
  const last = locations.at(-1);
  if (!last) throw new Error("fixture must keep at least one location");
  return last;
}

function lastRegion(map: Record<string, unknown>): Record<string, unknown> {
  const regions = map.regions as Record<string, unknown>[];
  const last = regions.at(-1);
  if (!last) throw new Error("fixture must keep at least one region");
  return last;
}

// =============================================================================
// Compile integration — v2 city_map.json fixture end-to-end.
// =============================================================================

const FIXTURE_ROOT = resolve("packages/scripts/__fixtures__/city_map_v2");
const SOURCE_ROOT = join(FIXTURE_ROOT, "stories_plan");
const ASSETS_ENABLED_CONFIG = join(FIXTURE_ROOT, "assets/config");
// A config root without policy.yaml (and without siblings) disables the asset
// pipeline — the established assets-off compile path.
const ASSETS_DISABLED_CONFIG = join(FIXTURE_ROOT, "assets/config-absent");

const tempOutputRoots: string[] = [];
afterAll(() => {
  for (const dir of tempOutputRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function compileFixture(assetConfigRoot: string) {
  const outputRoot = mkdtempSync(join(tmpdir(), "lyra-city-map-v2-"));
  tempOutputRoots.push(outputRoot);
  return {
    result: compile({
      sourceRoot: SOURCE_ROOT,
      outputRoot,
      assetConfigRoot,
      repoRoot: FIXTURE_ROOT,
    }),
    outputRoot,
  };
}

function emittedMap(outputRoot: string): unknown {
  return JSON.parse(
    readFileSync(
      join(outputRoot, "chapter_1/investigation_scene_1.json"),
      "utf8",
    ),
  ).map;
}

describe("compile with the v2 city_map.json fixture", () => {
  it("emits only regions referenced by the scene's nodes, with node regionIds", () => {
    const { result, outputRoot } = compileFixture(ASSETS_ENABLED_CONFIG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The unused `shibuya` region must not leak into the scene wire.
    expect(emittedMap(outputRoot)).toEqual({
      id: "tokyo",
      backgroundAssetId: "background.city_map.tokyo",
      regions: [
        {
          id: "kichijoji",
          label: "吉祥寺",
          x: 0.09,
          y: 0.42,
          backgroundAssetId: "background.city_map.kichijoji",
        },
      ],
      nodes: [
        {
          sublocationId: "rain_bell_cafe",
          regionId: "kichijoji",
          x: 0.37,
          y: 0.72,
        },
        {
          sublocationId: "police_meeting_room",
          regionId: null,
          x: 0.29,
          y: 0.5,
        },
      ],
    });
  });

  it("keeps topology/navigation metadata but nulls asset ids when assets are disabled", () => {
    const { result, outputRoot } = compileFixture(ASSETS_DISABLED_CONFIG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(emittedMap(outputRoot)).toEqual({
      id: "tokyo",
      backgroundAssetId: null,
      regions: [
        {
          id: "kichijoji",
          label: "吉祥寺",
          x: 0.09,
          y: 0.42,
          backgroundAssetId: null,
        },
      ],
      nodes: [
        {
          sublocationId: "rain_bell_cafe",
          regionId: "kichijoji",
          x: 0.37,
          y: 0.72,
        },
        {
          sublocationId: "police_meeting_room",
          regionId: null,
          x: 0.29,
          y: 0.5,
        },
      ],
    });
  });
});
