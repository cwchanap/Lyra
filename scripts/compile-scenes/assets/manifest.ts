import type { AssetConfig } from "./config";

export type AssetManifestEntry = {
  assetId: string;
  type: "background" | "portrait" | "evidence" | "audio";
  source: Record<string, string>;
  expectedPath: string;
  publicPath: string;
  policy: string;
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
  entries: Array<{ assetId: string; type: AssetManifestEntry["type"]; source: Record<string, string>; prompt: string; subjectPrompt?: string }>;
  config: AssetConfig;
}): AssetManifest {
  return {
    enabled: input.config.enabled,
    entries: input.entries.map((entry) => {
      const policy = entry.type === "audio" ? input.config.types.audio : input.config.types[entry.type];
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
        policy: entry.type,
        promptParts,
        finalPrompt: Object.values(promptParts).filter(Boolean).join("\n\n"),
      };
    }),
  };
}

export function expectedPath(assetId: string, type: AssetManifestEntry["type"]): string {
  return `static${publicPath(assetId, type)}`;
}

export function publicPath(assetId: string, type: AssetManifestEntry["type"]): string {
  if (type === "portrait") {
    const [, characterId, expression] = assetId.split(".");
    return `/assets/portraits/${characterId}/${expression}.png`;
  }
  if (type === "evidence") {
    return `/assets/evidence/${assetId.replace(/^evidence\./, "")}.png`;
  }
  if (type === "audio") {
    const [, channel, id] = assetId.split(".");
    return `/assets/audio/${channel}/${id}.ogg`;
  }
  return `/assets/backgrounds/${assetId.replace(/^background\./, "").replaceAll(".", "/")}.png`;
}
