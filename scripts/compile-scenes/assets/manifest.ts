// =============================================================================
// scripts/compile-scenes/assets/manifest.ts
//
// Builds the asset manifest: a list of entries mapping each referenced
// assetId to its expected disk path, public URL path, prompt parts, and
// type policy. Path construction is delegated to @lyra/asset-paths.
// =============================================================================

import type { AssetConfig } from "./config";
import { publicPathForAssetId, type AssetPathType } from "@lyra/asset-paths";

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

export function publicPath(
  assetId: string,
  type: AssetManifestEntry["type"],
): string {
  return publicPathForAssetId(assetId, type as AssetPathType);
}
