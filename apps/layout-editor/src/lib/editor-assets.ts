export type EditorAssetType =
  | "background"
  | "portrait"
  | "standee"
  | "evidence";

/**
 * Validates that an assetId has the expected number of dot-separated segments.
 * Returns the segments or throws with a descriptive error for malformed IDs.
 */
function requireSegments(
  assetId: string,
  type: string,
  expected: number,
): string[] {
  const segments = assetId.split(".");
  if (segments.length < expected) {
    throw new Error(
      `Invalid ${type} assetId "${assetId}": expected at least ${expected} dot-separated segments, got ${segments.length}.`,
    );
  }
  return segments;
}

// KEEP IN SYNC with publicPathForStoryAsset in
// apps/game/src/lib/assets/story-assets.ts.
// Changes to path construction here must be mirrored there.
export function publicPathForEditorAsset(
  assetId: string,
  type: EditorAssetType,
): string {
  if (type === "portrait") {
    const [, characterId, expression] = requireSegments(assetId, "portrait", 3);
    return `/assets/portraits/${characterId}/${expression}.png`;
  }

  if (type === "standee") {
    const [, characterId, pose] = requireSegments(assetId, "standee", 3);
    return `/assets/standees/${characterId}/${pose}.png`;
  }

  if (type === "evidence") {
    return `/assets/evidence/${assetId.replace(/^evidence\./, "")}.png`;
  }

  return `/assets/backgrounds/${assetId
    .replace(/^background\./, "")
    .replaceAll(".", "/")}.png`;
}
