// =============================================================================
// packages/asset-paths/src/index.ts
//
// Shared asset path construction for the Lyra asset pipeline.
//
// Single source of truth for converting typed assetIds (e.g.
// "portrait.hayasaka_akane.concerned") to their public URL paths
// ("/assets/portraits/hayasaka_akane/concerned.png").
//
// Consumers:
//   - packages/scripts/compile-scenes/assets/manifest.ts  (build-time manifest)
//   - apps/game/src/lib/assets/story-assets.ts   (runtime resolver)
//   - apps/layout-editor/src/lib/editor-assets.ts (editor preview)
// =============================================================================

/** Asset type names recognised by the path construction logic. */
export type AssetPathType =
  | "background"
  | "portrait"
  | "standee"
  | "evidence"
  | "audio";

/**
 * Validates that an assetId has the expected number of dot-separated segments.
 * Returns the segments or throws with a descriptive error for malformed IDs.
 */
export function requireSegments(
  assetId: string,
  type: string,
  expected: number,
  exact = false,
): string[] {
  const segments = assetId.split(".");
  const mismatch = exact
    ? segments.length !== expected
    : segments.length < expected;
  if (mismatch) {
    const qualifier = exact ? "exactly" : "at least";
    throw new Error(
      `Invalid ${type} assetId "${assetId}": expected ${qualifier} ${expected} dot-separated segments, got ${segments.length}.`,
    );
  }
  return segments;
}

/**
 * Maps a typed assetId to its public URL path.
 *
 * Convention (mirrored in all consumers — do NOT duplicate this logic):
 *   portrait.<charId>.<expr>  → /assets/portraits/<charId>/<expr>.png
 *   standee.<charId>.<pose>   → /assets/standees/<charId>/<pose>.png
 *   evidence.<id>             → /assets/evidence/<id>.png
 *   audio.<channel>.<id>      → /assets/audio/<channel>/<id>.ogg
 *   background.<...>          → /assets/backgrounds/<...>.png  (dots → /)
 */
export function publicPathForAssetId(
  assetId: string,
  type: AssetPathType,
): string {
  if (type === "portrait") {
    const [, characterId, expression] = requireSegments(
      assetId,
      "portrait",
      3,
      true,
    );
    return `/assets/portraits/${characterId}/${expression}.png`;
  }
  if (type === "standee") {
    const [, characterId, pose] = requireSegments(assetId, "standee", 3, true);
    return `/assets/standees/${characterId}/${pose}.png`;
  }
  if (type === "evidence") {
    return `/assets/evidence/${assetId.replace(/^evidence\./, "")}.png`;
  }
  if (type === "audio") {
    const [, channel, id] = requireSegments(assetId, "audio", 3, true);
    return `/assets/audio/${channel}/${id}.ogg`;
  }
  return `/assets/backgrounds/${assetId.replace(/^background\./, "").replaceAll(".", "/")}.png`;
}
