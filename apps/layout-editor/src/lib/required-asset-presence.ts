// =============================================================================
// apps/layout-editor/src/lib/required-asset-presence.ts
//
// Narrow presence check for asset rasters that a feature step requires to
// resolve to a real file. The compiler records a missing asset file as a
// non-blocking `assetFileMissing` warning in `report.warnings`, and the
// Assets-workbench join-based projection only proves a scene usage resolves to
// a manifest entry (or an explicit unresolved diagnostic) — neither proves the
// manifest entry's `expectedPath` points at a file that physically exists. So
// deleting a required raster would still let `verify:asset-real-content` pass.
//
// Keep this list narrow: only asset IDs a feature step explicitly requires to
// resolve to a real file. Do not make every historical missing asset fatal.
// =============================================================================

import type { AssetManifest } from "@lyra/scripts/compile-scenes/assets/manifest";

/**
 * Asset IDs whose raster file must physically exist for the current slice.
 *
 * HPA-601 Step 5.7 requires the Tokyo city-map background to resolve to a real
 * file, so its presence is asserted in CI by `verify-asset-real-content`.
 */
export const REQUIRED_REAL_FILE_ASSET_IDS = [
  "background.city_map.tokyo",
] as const;

export type MissingRequiredAssetReason = "noManifestEntry" | "fileMissing";

export interface MissingRequiredAsset {
  assetId: string;
  /** Manifest `expectedPath` for `fileMissing`; empty for `noManifestEntry`. */
  expectedPath: string;
  reason: MissingRequiredAssetReason;
}

/**
 * Returns the required assets that are not backed by a real file under
 * `static/assets`. `existingAssetPaths` must be repo-root-relative (the same
 * shape `expectedPath` uses and that the verifier collects from disk).
 */
export function findMissingRequiredAssets(
  manifest: AssetManifest,
  existingAssetPaths: readonly string[],
  requiredAssetIds: readonly string[] = REQUIRED_REAL_FILE_ASSET_IDS,
): MissingRequiredAsset[] {
  const present = new Set(existingAssetPaths);
  const missing: MissingRequiredAsset[] = [];
  for (const assetId of requiredAssetIds) {
    const entry = manifest.entries.find((e) => e.assetId === assetId);
    if (!entry) {
      missing.push({ assetId, expectedPath: "", reason: "noManifestEntry" });
      continue;
    }
    if (!present.has(entry.expectedPath)) {
      missing.push({
        assetId,
        expectedPath: entry.expectedPath,
        reason: "fileMissing",
      });
    }
  }
  return missing;
}

export function formatMissingRequiredAssets(
  missing: readonly MissingRequiredAsset[],
): string[] {
  return missing.map((m) =>
    m.reason === "noManifestEntry"
      ? `${m.assetId} (no manifest entry)`
      : `${m.assetId} -> ${m.expectedPath} (file not found under static/assets)`,
  );
}
