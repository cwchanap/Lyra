import { describe, expect, it } from "vitest";
import { parseCityMapJson } from "./city-map";

const VALID_MAP = {
  version: 1,
  id: "tokyo",
  backgroundPrompt:
    "Stylized illustrated investigation map of modern Tokyo at night after rain.",
  locations: [
    { id: "rain_bell_cafe", label: "雨鐘咖啡館", x: 0.16, y: 0.45 },
    {
      id: "kichijoji_shopping_street",
      label: "吉祥寺商店街",
      x: 0.21,
      y: 0.34,
    },
    { id: "police_meeting_room", label: "警署臨時會面室", x: 0.29, y: 0.5 },
    {
      id: "outsourced_review_office",
      label: "外包資料審查分室",
      x: 0.34,
      y: 0.29,
    },
    { id: "soma_detective_office", label: "相馬偵探事務所", x: 0.54, y: 0.38 },
    {
      id: "kagami_review_room",
      label: "KAGAMI 證據摘要審查室",
      x: 0.72,
      y: 0.45,
    },
    { id: "shibuya", label: "澀谷", x: 0.5, y: 0.68 },
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
  it("parses the canonical tokyo topology with all seven anchors", () => {
    const result = parse(JSON.stringify(VALID_MAP, null, 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      ...VALID_MAP,
      locations: VALID_MAP.locations,
      sourceFile: "city_map.json",
    });
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

  it("rejects an unsupported version", () => {
    expectRejected(
      serialize((map) => {
        map.version = 2;
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

  it("rejects duplicate location IDs", () => {
    expectRejected(
      serialize((map) => {
        lastLocation(map).id = "rain_bell_cafe";
      }),
      "cityMapDuplicateLocationId",
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
