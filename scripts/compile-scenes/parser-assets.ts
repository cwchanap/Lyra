// =============================================================================
// scripts/compile-scenes/parser-assets.ts
//
// Parses asset-related metadata blocks from scene markdown: visual asset
// cues (background prompt, BGM, BGS), evidence image prompts, and audio
// cues. Validates cue structure and normalizes raw markdown values into
// typed AST nodes consumed by the enrich layer.
// =============================================================================

import type { AudioCue, CompileError, VisualAssetCue } from "./types";

const RESERVED_ASSET_METADATA_KEYS = ["Background Prompt", "BGM", "BGS", "Image Prompt"];

export const VISUAL_ASSET_METADATA_KEYS = ["Background Prompt", "BGM", "BGS"];
export const EVIDENCE_IMAGE_METADATA_KEYS = ["Image Prompt"];

export function parseVisualAssetCue(meta: Record<string, string>): VisualAssetCue {
  return {
    backgroundPrompt: meta["Background Prompt"] ?? null,
    backgroundAssetId: null,
    bgm: parseAudioCue("bgm", meta.BGM),
    bgs: parseAudioCue("bgs", meta.BGS),
  };
}

export function parseAudioCue(channel: "bgm" | "bgs", raw: string | undefined): AudioCue | null {
  if (raw === undefined) return null;
  if (raw === "none") return { channel, assetId: null };
  return { channel, assetId: raw };
}

export function metadataWithoutAssetKeys(meta: Record<string, string>): Record<string, string> {
  const copy = { ...meta };
  delete copy["Background Prompt"];
  delete copy.BGM;
  delete copy.BGS;
  delete copy["Image Prompt"];
  return copy;
}

export function rejectUnknownAssetMetadata(
  meta: Record<string, string>,
  allowed: string[],
  sourceFile: string,
  line: number,
  metadataLines: Record<string, number> = {},
): CompileError | null {
  for (const key of Object.keys(meta)) {
    if (!allowed.includes(key)) {
      return {
        sourceFile,
        line: metadataLines[key] ?? line,
        code: "assetMetadataUnknownKey",
        message: `Unknown asset metadata key: ${key}`,
      };
    }
  }
  return null;
}

export function rejectReservedAssetMetadata(
  meta: Record<string, string>,
  allowedReservedKeys: string[],
  sourceFile: string,
  line: number,
  metadataLines: Record<string, number> = {},
): CompileError | null {
  for (const key of Object.keys(meta)) {
    if (RESERVED_ASSET_METADATA_KEYS.includes(key) && !allowedReservedKeys.includes(key)) {
      return {
        sourceFile,
        line: metadataLines[key] ?? line,
        code: "assetMetadataUnknownKey",
        message: `Unknown asset metadata key: ${key}`,
      };
    }
  }
  return null;
}
