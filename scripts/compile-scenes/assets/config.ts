import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { CompileError } from "../types";

export type AssetTypeName = "background" | "portrait" | "evidence" | "audio";
export type ImageAssetTypeName = "background" | "portrait" | "evidence";
export type AudioChannel = "bgm" | "bgs";

export type AssetTypePolicy = {
  dimensions?: [number, number];
  format: string;
  transparency?: boolean;
  prompt: string;
  loop?: boolean;
};

export type CharacterExpressionConfig = {
  id: string;
  prompt: string;
};

export type CharacterConfig = {
  id: string;
  displayNames: string[];
  portraitMode: "portrait" | "none";
  visualPrompt: string | null;
  referenceAssetId: string | null;
  expressions: Map<string, CharacterExpressionConfig>;
};

export type AudioConfigEntry = {
  id: string;
  prompt: string;
  loop: boolean;
};

export type AssetConfig = {
  enabled: boolean;
  globalStylePrompt: string;
  types: Record<AssetTypeName, AssetTypePolicy>;
  characters: {
    byId: Map<string, CharacterConfig>;
    byDisplayName: Map<string, CharacterConfig>;
  };
  audio: {
    bgm: Map<string, AudioConfigEntry>;
    bgs: Map<string, AudioConfigEntry>;
  };
};

export type AssetConfigResult =
  | { ok: true; value: AssetConfig; warnings: CompileError[] }
  | { ok: false; errors: CompileError[] };

const SAFE_ASSET_SLUG = /^[a-z0-9_]+$/;

function defaultTypes(): Record<AssetTypeName, AssetTypePolicy> {
  return {
    background: { dimensions: [1920, 1080], format: "png", transparency: false, prompt: "" },
    portrait: { dimensions: [768, 1024], format: "png", transparency: true, prompt: "" },
    evidence: { dimensions: [512, 512], format: "png", transparency: true, prompt: "" },
    audio: { format: "ogg", loop: true, prompt: "" },
  };
}

function emptyAssetConfig(): AssetConfig {
  return {
    enabled: false,
    globalStylePrompt: "",
    types: defaultTypes(),
    characters: { byId: new Map(), byDisplayName: new Map() },
    audio: { bgm: new Map(), bgs: new Map() },
  };
}

export function loadAssetConfig(configRoot: string): AssetConfigResult {
  const policyPath = resolve(configRoot, "policy.yaml");
  if (!existsSync(policyPath)) {
    return { ok: true, value: emptyAssetConfig(), warnings: [] };
  }

  const errors: CompileError[] = [];
  const policy = asRecord(readYaml(policyPath, errors), policyPath, "assetPolicyMalformed", errors);
  const charactersYaml = asRecord(readOptionalYaml(resolve(configRoot, "characters.yaml"), errors) ?? { characters: [] }, "characters.yaml", "assetCharactersFileMalformed", errors);
  const audioYaml = asRecord(readOptionalYaml(resolve(configRoot, "audio.yaml"), errors) ?? { bgm: {}, bgs: {} }, "audio.yaml", "assetAudioFileMalformed", errors);
  if (errors.length > 0) return { ok: false, errors };

  const enabled = policy?.assets?.enabled === true;
  const globalStylePrompt = text(policy?.globalStyle?.prompt);
  const types = buildTypePolicies(policy?.types, enabled, errors);
  const characters = buildCharacters(arrayOrEmpty(charactersYaml?.characters, "characters.yaml", "assetCharactersMalformed", errors), enabled, errors);
  const audio = buildAudio(audioYaml ?? {}, errors);

  if (enabled && !globalStylePrompt) {
    errors.push(error(policyPath, "assetPolicyMissingGlobalStyle", "assets.enabled is true but globalStyle.prompt is empty."));
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { enabled, globalStylePrompt, types, characters, audio },
    warnings: [],
  };
}

function buildTypePolicies(raw: unknown, enabled: boolean, errors: CompileError[]): Record<AssetTypeName, AssetTypePolicy> {
  const src = isRecord(raw) ? raw : {};
  const out = defaultTypes();
  for (const key of ["background", "portrait", "evidence", "audio"] as const) {
    const value = asOptionalRecord(src[key], "policy.yaml", "assetPolicyTypeMalformed", errors);
    if (!value) continue;
    out[key] = {
      dimensions: tuple(value.dimensions) ?? out[key].dimensions,
      format: text(value.format) || out[key].format,
      transparency: typeof value.transparency === "boolean" ? value.transparency : out[key].transparency,
      prompt: text(value.prompt),
      loop: typeof value.loop === "boolean" ? value.loop : out[key].loop,
    };
  }
  if (enabled) {
    for (const key of ["background", "portrait", "evidence"] as const) {
      if (!out[key].prompt) errors.push(error("policy.yaml", "assetPolicyMissingTypePrompt", `types.${key}.prompt is required when assets are enabled.`));
    }
  }
  return out;
}

function buildCharacters(raw: unknown[], enabled: boolean, errors: CompileError[]) {
  const byId = new Map<string, CharacterConfig>();
  const byDisplayName = new Map<string, CharacterConfig>();
  for (const item of raw) {
    const c = asRecord(item, "characters.yaml", "assetCharacterMalformed", errors);
    if (!c) continue;
    const id = text(c.id);
    const idIsSafe = !id || SAFE_ASSET_SLUG.test(id);
    const displayNames = Array.isArray(c.displayNames) ? c.displayNames.map(text).filter(Boolean) : [];
    const portraitMode = c.portraitMode === "none" ? "none" : "portrait";
    const expressions = new Map<string, CharacterExpressionConfig>();
    const rawExpressions = asOptionalRecord(c.expressions, "characters.yaml", "assetCharacterExpressionsMalformed", errors) ?? {};
    for (const [exprId, exprRaw] of Object.entries(rawExpressions)) {
      const exprIdIsSafe = SAFE_ASSET_SLUG.test(exprId);
      if (!exprIdIsSafe) {
        errors.push(error("characters.yaml", "assetCharacterExpressionIdMalformed", `Character ${id || "(missing id)"} expression ${exprId} must be a snake_case slug.`));
      }
      const expr = asRecord(exprRaw, "characters.yaml", "assetCharacterExpressionMalformed", errors);
      if (!expr) continue;
      const prompt = text(expr.prompt);
      if (exprIdIsSafe) expressions.set(exprId, { id: exprId, prompt });
    }
    const config: CharacterConfig = {
      id,
      displayNames,
      portraitMode,
      visualPrompt: text(c.visualPrompt) || null,
      referenceAssetId: text(c.referenceAssetId) || null,
      expressions,
    };
    if (!id) errors.push(error("characters.yaml", "assetCharacterMissingId", "Each character requires id."));
    if (id && !idIsSafe) {
      errors.push(error("characters.yaml", "assetCharacterIdMalformed", `Character id ${id} must be a snake_case slug.`));
    }
    if (displayNames.length === 0) errors.push(error("characters.yaml", "assetCharacterMissingDisplayNames", `Character ${id || "(missing id)"} requires displayNames.`));
    if (id && byId.has(id)) {
      errors.push(error("characters.yaml", "assetCharacterDuplicateId", `Character id ${id} is defined multiple times.`));
    }
    if (enabled && portraitMode === "portrait" && !expressions.has("standard")) {
      errors.push(error("characters.yaml", "assetCharacterMissingStandardExpression", `Character ${id} requires expressions.standard.`));
    }
    if (id && idIsSafe && !byId.has(id)) byId.set(id, config);
    for (const name of displayNames) {
      if (byDisplayName.has(name)) errors.push(error("characters.yaml", "assetCharacterAmbiguousDisplayName", `Display name ${name} maps to multiple characters.`));
      byDisplayName.set(name, config);
    }
  }
  if (enabled && raw.length === 0) {
    errors.push(error("characters.yaml", "assetCharactersMissing", "assets.enabled is true but characters.yaml has no characters."));
  }
  return { byId, byDisplayName };
}

function buildAudio(raw: Record<string, unknown>, errors: CompileError[]) {
  return {
    bgm: buildAudioMap(raw.bgm, "bgm", errors),
    bgs: buildAudioMap(raw.bgs, "bgs", errors),
  };
}

function buildAudioMap(raw: unknown, channel: AudioChannel, errors: CompileError[]) {
  const out = new Map<string, AudioConfigEntry>();
  const entries = asOptionalRecord(raw, "audio.yaml", "assetAudioChannelMalformed", errors) ?? {};
  for (const [id, value] of Object.entries(entries)) {
    if (!/^[a-z0-9_]+$/.test(id)) errors.push(error("audio.yaml", "assetAudioIdMalformed", `${channel}.${id} must be a snake_case slug.`));
    const record = asRecord(value, "audio.yaml", "assetAudioEntryMalformed", errors);
    if (!record) continue;
    out.set(id, { id, prompt: text(record.prompt), loop: record.loop !== false });
  }
  return out;
}

function readYaml(path: string, errors: CompileError[]) {
  try {
    return parse(readFileSync(path, "utf-8"));
  } catch (e) {
    errors.push(error(path, "assetConfigUnreadable", `${path}: ${(e as Error).message}`));
    return null;
  }
}

function readOptionalYaml(path: string, errors: CompileError[]) {
  if (!existsSync(path)) return null;
  return readYaml(path, errors);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown, sourceFile: string, code: string, errors: CompileError[]): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  errors.push(error(sourceFile, code, `${sourceFile} contains an invalid object shape.`));
  return null;
}

function asOptionalRecord(value: unknown, sourceFile: string, code: string, errors: CompileError[]): Record<string, unknown> | null {
  if (value === undefined) return null;
  return asRecord(value, sourceFile, code, errors);
}

function arrayOrEmpty(value: unknown, sourceFile: string, code: string, errors: CompileError[]): unknown[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  errors.push(error(sourceFile, code, `${sourceFile} contains an invalid array shape.`));
  return [];
}

function tuple(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const a = Number(value[0]);
  const b = Number(value[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return [a, b];
}

function error(sourceFile: string, code: string, message: string): CompileError {
  return { sourceFile, line: 1, code, message };
}
