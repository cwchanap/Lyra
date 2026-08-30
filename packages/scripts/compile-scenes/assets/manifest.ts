// =============================================================================
// packages/scripts/compile-scenes/assets/manifest.ts
//
// Builds the asset manifest: a list of entries mapping each referenced
// assetId to its expected disk path, public URL path, prompt parts, and
// type policy. Path construction is delegated to @lyra/asset-paths.
//
// `source` is a discriminated union keyed by the parent entry's `type` —
// no separate discriminator is serialized, and emitted JSON is unchanged
// from the pre-union `Record<string, string>` shape.
// =============================================================================

import type { AssetConfig, AudioChannel } from "./config";
import { publicPathForAssetId } from "@lyra/asset-paths";

export type BackgroundManifestSource =
  | { chapterId: string; sceneId: string; unitId: string }
  | { chapterId: string; sceneId: string; characterId: string };

export type PortraitManifestSource = {
  chapterId: string;
  sceneId: string;
  characterId: string;
  expression: string;
};

export type StandeeManifestSource = {
  chapterId: string;
  sceneId: string;
  characterId: string;
};

export type EvidenceManifestSource =
  | { chapterId: string; sceneId: string; evidenceId: string }
  | { chapterId: string; sceneId: string; characterId: string };

export type AudioManifestSource = {
  chapterId: string;
  sceneId: string;
  channel: AudioChannel;
  id: string;
};

type SourceForType = {
  background: BackgroundManifestSource;
  portrait: PortraitManifestSource;
  standee: StandeeManifestSource;
  evidence: EvidenceManifestSource;
  audio: AudioManifestSource;
};

/** Correlated `{ type, source }` members, discriminated by `type` only. */
type TypedEntrySource = {
  [T in keyof SourceForType]: { type: T; source: SourceForType[T] };
}[keyof SourceForType];

/** Input for one manifest entry (see buildAssetManifest). */
export type ManifestEntryInput = {
  assetId: string;
  prompt: string;
  subjectPrompt?: string;
} & TypedEntrySource;

export type AssetManifestEntry = {
  assetId: string;
  expectedPath: string;
  publicPath: string;
  promptParts: {
    globalStyle: string;
    typePrompt: string;
    subjectPrompt: string;
    entryPrompt: string;
  };
  finalPrompt: string;
} & TypedEntrySource;

export type AssetManifest = {
  enabled: boolean;
  entries: AssetManifestEntry[];
};

export function buildAssetManifest(input: {
  entries: ManifestEntryInput[];
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
      const base = {
        expectedPath: expectedPath(entry.assetId, entry.type),
        publicPath: publicPath(entry.assetId, entry.type),
        promptParts,
        finalPrompt: Object.values(promptParts).filter(Boolean).join("\n\n"),
      };
      // Key order in these literals is the serialized JSON key order —
      // do not reshuffle without re-hashing the generated manifest.
      switch (entry.type) {
        case "background":
          return {
            assetId: entry.assetId,
            type: entry.type,
            source: entry.source,
            ...base,
          };
        case "portrait":
          return {
            assetId: entry.assetId,
            type: entry.type,
            source: entry.source,
            ...base,
          };
        case "standee":
          return {
            assetId: entry.assetId,
            type: entry.type,
            source: entry.source,
            ...base,
          };
        case "evidence":
          return {
            assetId: entry.assetId,
            type: entry.type,
            source: entry.source,
            ...base,
          };
        case "audio":
          return {
            assetId: entry.assetId,
            type: entry.type,
            source: entry.source,
            ...base,
          };
      }
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
  return publicPathForAssetId(assetId, type);
}
