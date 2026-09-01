// =============================================================================
// packages/scripts/compile-scenes/city-map.ts
//
// Parses the single global city-map topology file (docs/stories_plan/
// city_map.json). HPA-601 supports exactly one map ID ("tokyo"); `version: 1`
// is a parse guard in the same style as investigation layout sidecars, not a
// versioning policy. The topology owns only the canonical map ID, the
// map-level background prompt, and location IDs/labels/normalized
// coordinates — never routes, unlocks, or progress state.
// =============================================================================

import type { CompileError } from "./types";

export type ASTCityMapLocation = {
  id: string;
  label: string;
  x: number;
  y: number;
};

export type ASTCityMap = {
  version: 1;
  id: "tokyo";
  backgroundPrompt: string;
  locations: ASTCityMapLocation[];
  sourceFile: string;
};

export type CityMapParseResult =
  | { ok: true; value: ASTCityMap }
  | { ok: false; errors: CompileError[] };

/** The only supported map ID in HPA-601. */
export const CITY_MAP_ID = "tokyo";

const LOCATION_ID_RE = /^[a-z0-9_]+$/;

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
  if (root.version !== 1) {
    errors.push(
      error(
        sourceFile,
        "cityMapUnsupportedVersion",
        "City map version must be 1.",
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

  const seenIds = new Set<string>();
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
    if (!LOCATION_ID_RE.test(locationId)) {
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
          "cityMapDuplicateLocationId",
          `City map location "${locationId}" is declared more than once.`,
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

    const coordinates: { x: number | null; y: number | null } = {
      x: null,
      y: null,
    };
    for (const axis of ["x", "y"] as const) {
      const value = location[axis];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(
          error(
            sourceFile,
            "cityMapInvalidCoordinate",
            `City map ${pathLabel}.${axis} must be a finite number.`,
          ),
        );
        locationValid = false;
        continue;
      }
      if (value < 0 || value > 1) {
        errors.push(
          error(
            sourceFile,
            "cityMapCoordinateOutOfRange",
            `City map ${pathLabel}.${axis} must be within [0, 1]; got ${value}.`,
          ),
        );
        locationValid = false;
        continue;
      }
      coordinates[axis] = value;
    }

    if (locationValid && coordinates.x !== null && coordinates.y !== null) {
      locations.push({
        id: locationId,
        label,
        x: coordinates.x,
        y: coordinates.y,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      version: 1,
      id: CITY_MAP_ID,
      backgroundPrompt,
      locations,
      sourceFile,
    },
  };
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
