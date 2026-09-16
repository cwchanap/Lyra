// =============================================================================
// packages/scripts/compile-scenes/city-map.ts
//
// Parses the single global city-map topology file (docs/stories_plan/
// city_map.json). Regional city maps cut the topology to `version: 2`: one
// shared slug namespace for regions and locations, nullable `regionId` on
// locations (null = overview-direct). No compatibility parser: v1 input is
// rejected. The topology owns only the canonical map ID, the map/region
// background prompts, and region/location IDs/labels/normalized coordinates —
// never routes, unlocks, or progress state.
// =============================================================================

import type { CompileError } from "./types";

export type ASTCityMapRegion = {
  id: string;
  label: string;
  x: number;
  y: number;
  backgroundPrompt: string;
};

export type ASTCityMapLocation = {
  id: string;
  label: string;
  regionId: string | null;
  x: number;
  y: number;
};

export type ASTCityMap = {
  version: 2;
  id: "tokyo";
  backgroundPrompt: string;
  regions: ASTCityMapRegion[];
  locations: ASTCityMapLocation[];
  sourceFile: string;
};

export type CityMapParseResult =
  | { ok: true; value: ASTCityMap }
  | { ok: false; errors: CompileError[] };

/** The only supported map ID in HPA-601. */
export const CITY_MAP_ID = "tokyo";

const SLUG_RE = /^[a-z0-9_]+$/;

export function parseCityMapJson(
  source: string,
  sourceFile: string,
): CityMapParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return {
      ok: false,
      errors: [
        error(sourceFile, "cityMapInvalidJson", "City map must be valid JSON."),
      ],
    };
  }

  const root = asRecord(raw);
  if (!root) {
    return {
      ok: false,
      errors: [
        error(
          sourceFile,
          "cityMapInvalidRoot",
          "City map root must be an object.",
        ),
      ],
    };
  }

  const errors: CompileError[] = [];
  if (root.version !== 2) {
    errors.push(
      error(
        sourceFile,
        "cityMapUnsupportedVersion",
        "City map version must be 2.",
      ),
    );
  }

  const id = typeof root.id === "string" ? root.id.trim() : "";
  if (id !== CITY_MAP_ID) {
    errors.push(
      error(
        sourceFile,
        "cityMapInvalidId",
        `City map id must be "${CITY_MAP_ID}"; got "${id}".`,
      ),
    );
  }

  const backgroundPrompt =
    typeof root.backgroundPrompt === "string"
      ? root.backgroundPrompt.trim()
      : "";
  if (backgroundPrompt.length === 0) {
    errors.push(
      error(
        sourceFile,
        "cityMapMissingBackgroundPrompt",
        "City map must include a non-empty backgroundPrompt.",
      ),
    );
  }

  // Regions and locations share ONE slug namespace: both arrays check and
  // reserve IDs in this set, so a cross-array collision fails with
  // cityMapDuplicateSlug exactly like a within-array duplicate.
  const seenIds = new Set<string>();

  const regionsRoot = root.regions;
  if (!Array.isArray(regionsRoot)) {
    errors.push(
      error(
        sourceFile,
        "cityMapMissingRegions",
        "City map must include a regions array.",
      ),
    );
  }
  const regions: ASTCityMapRegion[] = [];
  for (const [index, rawRegion] of Array.from(
    Array.isArray(regionsRoot) ? regionsRoot.entries() : [],
  )) {
    const region = asRecord(rawRegion);
    const pathLabel = `regions[${index}]`;
    if (!region) {
      errors.push(
        error(
          sourceFile,
          "cityMapInvalidRegion",
          `City map ${pathLabel} must be an object.`,
        ),
      );
      continue;
    }

    let regionValid = true;

    const regionId = typeof region.id === "string" ? region.id.trim() : "";
    if (!SLUG_RE.test(regionId)) {
      errors.push(
        error(
          sourceFile,
          "cityMapInvalidRegionId",
          `City map ${pathLabel}.id "${regionId}" must be a non-empty snake_case slug.`,
        ),
      );
      regionValid = false;
    } else if (seenIds.has(regionId)) {
      errors.push(
        error(
          sourceFile,
          "cityMapDuplicateSlug",
          `City map slug "${regionId}" (regions[${index}]) is declared more than once across regions and locations.`,
        ),
      );
      regionValid = false;
    } else {
      seenIds.add(regionId);
    }

    const label = typeof region.label === "string" ? region.label.trim() : "";
    if (label.length === 0) {
      errors.push(
        error(
          sourceFile,
          "cityMapInvalidLabel",
          `City map region "${regionId}" must include a non-empty label.`,
        ),
      );
      regionValid = false;
    }

    const regionBackgroundPrompt =
      typeof region.backgroundPrompt === "string"
        ? region.backgroundPrompt.trim()
        : "";
    if (regionBackgroundPrompt.length === 0) {
      errors.push(
        error(
          sourceFile,
          "cityMapMissingRegionBackgroundPrompt",
          `City map region "${regionId}" must include a non-empty backgroundPrompt.`,
        ),
      );
      regionValid = false;
    }

    const coordinates = parseCoordinates(region, pathLabel, errors, sourceFile);
    if (!coordinates.ok) regionValid = false;

    if (regionValid && coordinates.x !== null && coordinates.y !== null) {
      regions.push({
        id: regionId,
        label,
        x: coordinates.x,
        y: coordinates.y,
        backgroundPrompt: regionBackgroundPrompt,
      });
    }
  }

  const locationsRoot = root.locations;
  if (!Array.isArray(locationsRoot)) {
    errors.push(
      error(
        sourceFile,
        "cityMapMissingLocations",
        "City map must include a locations array.",
      ),
    );
    return { ok: false, errors };
  }

  const locations: ASTCityMapLocation[] = [];
  for (const [index, rawLocation] of locationsRoot.entries()) {
    const location = asRecord(rawLocation);
    const pathLabel = `locations[${index}]`;
    if (!location) {
      errors.push(
        error(
          sourceFile,
          "cityMapInvalidLocation",
          `City map ${pathLabel} must be an object.`,
        ),
      );
      continue;
    }

    let locationValid = true;

    const locationId =
      typeof location.id === "string" ? location.id.trim() : "";
    if (!SLUG_RE.test(locationId)) {
      errors.push(
        error(
          sourceFile,
          "cityMapInvalidLocationId",
          `City map ${pathLabel}.id "${locationId}" must be a non-empty snake_case slug.`,
        ),
      );
      locationValid = false;
    } else if (seenIds.has(locationId)) {
      errors.push(
        error(
          sourceFile,
          "cityMapDuplicateSlug",
          `City map slug "${locationId}" (locations[${index}]) is declared more than once across regions and locations.`,
        ),
      );
      locationValid = false;
    } else {
      seenIds.add(locationId);
    }

    const label =
      typeof location.label === "string" ? location.label.trim() : "";
    if (label.length === 0) {
      errors.push(
        error(
          sourceFile,
          "cityMapInvalidLabel",
          `City map location "${locationId}" must include a non-empty label.`,
        ),
      );
      locationValid = false;
    }

    let regionId: string | null = null;
    const rawRegionId = location.regionId;
    if (rawRegionId === null) {
      regionId = null;
    } else if (typeof rawRegionId === "string" && rawRegionId.length > 0) {
      regionId = rawRegionId;
    } else {
      errors.push(
        error(
          sourceFile,
          "cityMapInvalidRegionReference",
          `City map ${pathLabel}.regionId must be a region slug string or null.`,
        ),
      );
      locationValid = false;
    }

    const coordinates = parseCoordinates(
      location,
      pathLabel,
      errors,
      sourceFile,
    );
    if (!coordinates.ok) locationValid = false;

    if (locationValid && coordinates.x !== null && coordinates.y !== null) {
      locations.push({
        id: locationId,
        label,
        regionId,
        x: coordinates.x,
        y: coordinates.y,
      });
    }
  }

  // Fail closed on region references: every non-null location regionId must
  // name a declared region (checked after both arrays so order is free).
  for (const location of locations) {
    if (
      location.regionId !== null &&
      !regions.some((r) => r.id === location.regionId)
    ) {
      errors.push(
        error(
          sourceFile,
          "cityMapUnknownRegionReference",
          `City map location "${location.id}" references region "${location.regionId}", which is not declared in regions.`,
        ),
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      version: 2,
      id: CITY_MAP_ID,
      backgroundPrompt,
      regions,
      locations,
      sourceFile,
    },
  };
}

function parseCoordinates(
  entry: Record<string, unknown>,
  pathLabel: string,
  errors: CompileError[],
  sourceFile: string,
): { x: number | null; y: number | null; ok: boolean } {
  const coordinates: { x: number | null; y: number | null } = {
    x: null,
    y: null,
  };
  let ok = true;
  for (const axis of ["x", "y"] as const) {
    const value = entry[axis];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      ok = false;
      errors.push(
        error(
          sourceFile,
          "cityMapInvalidCoordinate",
          `City map ${pathLabel}.${axis} must be a finite number.`,
        ),
      );
      continue;
    }
    if (value < 0 || value > 1) {
      ok = false;
      errors.push(
        error(
          sourceFile,
          "cityMapCoordinateOutOfRange",
          `City map ${pathLabel}.${axis} must be within [0, 1]; got ${value}.`,
        ),
      );
      continue;
    }
    coordinates[axis] = value;
  }
  return { ...coordinates, ok };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function error(
  sourceFile: string,
  code: string,
  message: string,
): CompileError {
  return { code, message, sourceFile, line: 1 };
}
