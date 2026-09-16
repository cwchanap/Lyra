import type {
  InvestigationMapNodeView,
  InvestigationMapRegionView,
  InvestigationMapView,
} from "./types";

/** One pending-map plane: the overview, or a single district. */
export type MapPlane = {
  kind: "overview" | "district";
  regionId: string | null;
  /** Region anchor controls to render (overview only; empty on a district). */
  regions: InvestigationMapRegionView[];
  /** The district's own region view (district only; null on the overview). */
  region: InvestigationMapRegionView | null;
  /** Legal leaves positioned on this plane. */
  nodes: InvestigationMapNodeView[];
};

/**
 * The plane a pending map opens on: the single district when every legal leaf
 * shares one non-null region, the overview otherwise (zero leaves, mixed
 * regions, or any overview-direct leaf).
 */
export function initialActiveRegionId(
  nodes: InvestigationMapNodeView[],
): string | null {
  const first = nodes[0]?.regionId;
  if (first == null) return null;
  return nodes.every((node) => node.regionId === first) ? first : null;
}

/**
 * Project the pending map onto one plane. Overview-direct (`regionId == null`)
 * leaves and district leaves never share a plane, so their coordinates never
 * mix. An inactive/unknown region id falls back to the overview plane.
 */
export function projectMapPlane(
  map: InvestigationMapView,
  activeRegionId: string | null,
): MapPlane {
  const region =
    activeRegionId == null
      ? null
      : (map.regions.find((candidate) => candidate.id === activeRegionId) ??
        null);

  if (!region) {
    return {
      kind: "overview",
      regionId: null,
      regions: map.regions,
      region: null,
      nodes: map.nodes.filter((node) => node.regionId === null),
    };
  }

  return {
    kind: "district",
    regionId: region.id,
    regions: [],
    region,
    nodes: map.nodes.filter((node) => node.regionId === region.id),
  };
}
