// =============================================================================
// scripts/compile-scenes/assets/manifest.ts
//
// Builds the asset manifest: a list of entries mapping each referenced
// assetId to its expected disk path, public URL path, prompt parts, and
// type policy. Path conventions (portrait/<char>/<expr>.png, etc.) are
// centralized here and mirrored in src/lib/assets/story-assets.ts.
// =============================================================================

import type { AssetConfig } from "./config";

export type AssetManifestEntry = {
  assetId: string;
  type: "background" | "portrait" | "standee" | "evidence" | "audio";
  source: Record<string, string>;
  expectedPath: string;
  publicPath: string;
  promptParts: {
    globalStyle: string;
    typePrompt: string;
    subjectPrompt: string;
    entryPrompt: string;
  };
  finalPrompt: string;
};

export type AssetManifest = {
  enabled: boolean;
  entries: AssetManifestEntry[];
};

export function buildAssetManifest(input: {
  entries: Array<{
    assetId: string;
    type: AssetManifestEntry["type"];
    source: Record<string, string>;
    prompt: string;
    subjectPrompt?: string;
  }>;
  config: AssetConfig;
}): AssetManifest {
  return {
    enabled: input.config.enabled,
    entries: input.entries.map((entry) => {
      const policy =
        entry.type === "audio"
          ? input.config.types.audio
          : input.config.types[entry.type];
      const promptParts = {
        globalStyle: input.config.globalStylePrompt,
        typePrompt: policy.prompt,
        subjectPrompt: entry.subjectPrompt ?? "",
        entryPrompt: entry.prompt,
      };
      return {
        assetId: entry.assetId,
        type: entry.type,
        source: entry.source,
        expectedPath: expectedPath(entry.assetId, entry.type),
        publicPath: publicPath(entry.assetId, entry.type),
        promptParts,
        finalPrompt: Object.values(promptParts).filter(Boolean).join("\n\n"),
      };
    }),
  };
}

export function expectedPath(
  assetId: string,
  type: AssetManifestEntry["type"],
): string {
  return `static${publicPath(assetId, type)}`;
}

/**
 * Validates that an assetId has the expected number of dot-separated segments.
 * Throws at manifest-build time rather than emitting garbage paths.
 */
function requireSegments(
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

export function publicPath(
  assetId: string,
  type: AssetManifestEntry["type"],
): string {
  // KEEP IN SYNC with publicPathForStoryAsset() in src/lib/assets/story-assets.ts.
  // manifest.test.ts cross-checks both; update both together.
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
