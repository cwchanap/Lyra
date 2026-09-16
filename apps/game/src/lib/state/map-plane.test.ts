import { describe, expect, it } from "vitest";
import { initialActiveRegionId, projectMapPlane } from "./map-plane";
import type {
  InvestigationMapNodeView,
  InvestigationMapRegionView,
  InvestigationMapView,
} from "./types";

function region(id: string): InvestigationMapRegionView {
  return {
    id,
    label: `地區${id}`,
    x: 0.1,
    y: 0.2,
    backgroundAssetId: `background.city_map.${id}`,
  };
}

function node(
  sublocationId: string,
  regionId: string | null,
): InvestigationMapNodeView {
  return { sublocationId, regionId, x: 0.3, y: 0.4 };
}

describe("initialActiveRegionId", () => {
  it("returns null overview for zero legal leaves", () => {
    expect(initialActiveRegionId([])).toBeNull();
  });

  it("returns the single non-null region shared by every legal leaf", () => {
    expect(
      initialActiveRegionId([node("a", "kichijoji"), node("b", "kichijoji")]),
    ).toBe("kichijoji");
  });

  it("returns null overview for mixed regions", () => {
    expect(
      initialActiveRegionId([node("a", "kichijoji"), node("b", "shibuya")]),
    ).toBeNull();
  });

  it("returns null overview when any legal leaf is overview-direct", () => {
    expect(
      initialActiveRegionId([node("a", "kichijoji"), node("b", null)]),
    ).toBeNull();
  });
});

describe("projectMapPlane", () => {
  const map: InvestigationMapView = {
    id: "city_map.tokyo",
    backgroundAssetId: "background.city_map.tokyo",
    regions: [region("kichijoji"), region("shibuya")],
    nodes: [
      node("rain_bell_cafe", "kichijoji"),
      node("kichijoji_shopping_street", "kichijoji"),
      node("police_meeting_room", null),
    ],
  };

  it("projects the overview plane with region controls and overview-direct leaves only", () => {
    const plane = projectMapPlane(map, null);
    expect(plane.kind).toBe("overview");
    expect(plane.regionId).toBeNull();
    expect(plane.region).toBeNull();
    expect(plane.regions.map((r) => r.id)).toEqual(["kichijoji", "shibuya"]);
    expect(plane.nodes.map((n) => n.sublocationId)).toEqual([
      "police_meeting_room",
    ]);
  });

  it("projects a district plane with that region's leaves only", () => {
    const plane = projectMapPlane(map, "kichijoji");
    expect(plane.kind).toBe("district");
    expect(plane.regionId).toBe("kichijoji");
    expect(plane.region?.backgroundAssetId).toBe(
      "background.city_map.kichijoji",
    );
    // District planes carry no region controls.
    expect(plane.regions).toEqual([]);
    expect(plane.nodes.map((n) => n.sublocationId)).toEqual([
      "rain_bell_cafe",
      "kichijoji_shopping_street",
    ]);
  });

  it("falls back to the overview plane for an invalid active region", () => {
    const plane = projectMapPlane(map, "shinjuku");
    expect(plane.kind).toBe("overview");
    expect(plane.regionId).toBeNull();
    expect(plane.nodes.map((n) => n.sublocationId)).toEqual([
      "police_meeting_room",
    ]);
  });

  it("never mixes district and overview-direct coordinates", () => {
    const overview = projectMapPlane(map, null);
    const district = projectMapPlane(map, "kichijoji");

    const overviewIds = new Set(overview.nodes.map((n) => n.sublocationId));
    for (const leaf of district.nodes) {
      expect(overviewIds.has(leaf.sublocationId)).toBe(false);
    }

    // Together the two planes cover every legal leaf exactly once.
    const combined = [...overview.nodes, ...district.nodes]
      .map((n) => n.sublocationId)
      .sort();
    expect(combined).toEqual([
      "kichijoji_shopping_street",
      "police_meeting_room",
      "rain_bell_cafe",
    ]);
  });
});
