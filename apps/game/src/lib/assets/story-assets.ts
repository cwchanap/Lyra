import { publicPathForAssetId } from "@lyra/asset-paths";

export type StoryAssetType =
  | "background"
  | "portrait"
  | "standee"
  | "evidence"
  | "audio";

export type ResolvedStoryAsset = {
  assetId: string;
  type: StoryAssetType;
  url: string;
  placeholder: boolean;
};

const cache = new Map<string, Promise<ResolvedStoryAsset>>();

export function publicPathForStoryAsset(
  assetId: string,
  type: StoryAssetType,
): string {
  return publicPathForAssetId(assetId, type);
}

export function placeholderForStoryAsset(
  type: Exclude<StoryAssetType, "audio">,
): ResolvedStoryAsset {
  const color =
    type === "background"
      ? "101018"
      : type === "portrait"
        ? "181820"
        : type === "standee"
          ? "161f24"
          : "202018";
  const label = type.toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#${color}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#d8d0bf" font-family="serif" font-size="28">${label} MISSING</text></svg>`;
  return {
    assetId: `placeholder.${type}`,
    type,
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    placeholder: true,
  };
}

export function placeholderForMissingStoryAsset(
  assetId: string,
  type: Exclude<StoryAssetType, "audio">,
): ResolvedStoryAsset {
  return { ...placeholderForStoryAsset(type), assetId };
}

export function resolveStoryAsset(
  assetId: string | null | undefined,
  type: StoryAssetType,
): Promise<ResolvedStoryAsset | null> {
  if (!assetId) return Promise.resolve(null);
  const key = `${type}:${assetId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = resolveUncached(assetId, type).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  return promise;
}

export function imageStoryAssetTypeForId(
  assetId: string,
): Exclude<StoryAssetType, "audio"> {
  if (assetId.startsWith("portrait.")) return "portrait";
  if (assetId.startsWith("standee.")) return "standee";
  if (assetId.startsWith("evidence.")) return "evidence";
  if (assetId.startsWith("background.")) return "background";
  throw new Error(
    `Unknown image asset type prefix in "${assetId}": expected one of portrait, standee, evidence, background.`,
  );
}

/**
 * Resolves an asset to its public URL. This is **path-construction-only** —
 * it does NOT verify the file exists on disk. Existence is checked lazily
 * by the browser (<img onerror>), which triggers the placeholder fallback
 * in the component's error handler.
 */
async function resolveUncached(
  assetId: string,
  type: StoryAssetType,
): Promise<ResolvedStoryAsset> {
  const url = publicPathForStoryAsset(assetId, type);
  return { assetId, type, url, placeholder: false };
}
