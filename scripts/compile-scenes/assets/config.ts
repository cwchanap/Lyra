// =============================================================================
// scripts/compile-scenes/assets/config.ts
//
// Loads and validates the asset pipeline configuration: policy.yaml,
// characters.yaml, audio.yaml. Produces a typed AssetConfig (or collected
// errors). Asset-ID slugs are validated here; bad slugs are hard errors.
// =============================================================================

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CompileError } from "../types";

export type AssetTypeName = "background" | "portrait" | "evidence" | "audio";
export type ImageAssetTypeName = "background" | "portrait" | "evidence";
export type AudioChannel = "bgm" | "bgs";

/** Policy for image asset types (background, portrait, evidence). */
export type ImageAssetPolicy = {
  dimensions?: [number, number];
  format: string;
  transparency?: boolean;
  prompt: string;
};

/** Policy for audio asset types. No dimensions/transparency; has loop. */
export type AudioAssetPolicy = {
  format: string;
  loop?: boolean;
  prompt: string;
};

/** Per-type policies, discriminated so image-only and audio-only fields
 *  cannot cross-contaminate. */
export type AssetTypePolicies = {
  background: ImageAssetPolicy;
  portrait: ImageAssetPolicy;
  evidence: ImageAssetPolicy;
  audio: AudioAssetPolicy;
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
  types: AssetTypePolicies;
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

function defaultTypes(): AssetTypePolicies {
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
    const warnings: CompileError[] = [];
    const siblings = ["characters.yaml", "audio.yaml"].filter((f) =>
      existsSync(resolve(configRoot, f)),
    );
    if (siblings.length > 0) {
      warnings.push(
        error(
          configRoot,
          "assetPolicyMissing",
          `policy.yaml is absent but ${siblings.join(", ")} exist. Asset pipeline is disabled. If this is unintentional (typo, partial checkout), add policy.yaml.`,
        ),
      );
    }
    return { ok: true, value: emptyAssetConfig(), warnings };
  }

  const errors: CompileError[] = [];
  const warnings: CompileError[] = [];
  const policy = asRecord(readYaml(policyPath, errors), policyPath, "assetPolicyMalformed", errors);
  const charactersYaml = asRecord(readOptionalYaml(resolve(configRoot, "characters.yaml"), errors) ?? { characters: [] }, "characters.yaml", "assetCharactersFileMalformed", errors);
  const audioYaml = asRecord(readOptionalYaml(resolve(configRoot, "audio.yaml"), errors) ?? { bgm: {}, bgs: {} }, "audio.yaml", "assetAudioFileMalformed", errors);
  if (errors.length > 0) return { ok: false, errors };

  const enabled = policy?.assets?.enabled === true;
  const globalStylePrompt = textWithWarn(policy?.globalStyle?.prompt, "globalStyle.prompt", "policy.yaml", warnings);
  const types = buildTypePolicies(policy?.types, enabled, errors, warnings);
  const characters = buildCharacters(arrayOrEmpty(charactersYaml?.characters, "characters.yaml", "assetCharactersMalformed", errors), enabled, errors, warnings);
  const audio = buildAudio(audioYaml ?? {}, errors);

  if (enabled && !globalStylePrompt) {
    errors.push(error(policyPath, "assetPolicyMissingGlobalStyle", "assets.enabled is true but globalStyle.prompt is empty."));
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { enabled, globalStylePrompt, types, characters, audio },
    warnings,
  };
}

const SUPPORTED_FORMATS: Record<AssetTypeName, string> = {
  background: "png",
  portrait: "png",
  evidence: "png",
  audio: "ogg",
};

function buildTypePolicies(raw: unknown, enabled: boolean, errors: CompileError[], warnings: CompileError[]): AssetTypePolicies {
  const src = isRecord(raw) ? raw : {};
  const out = defaultTypes();
  // Image types: background, portrait, evidence
  for (const key of ["background", "portrait", "evidence"] as const) {
    const value = asOptionalRecord(src[key], "policy.yaml", "assetPolicyTypeMalformed", errors);
    if (!value) continue;
    const prev = out[key];
    out[key] = {
      dimensions: tupleWithWarn(value.dimensions, `types.${key}.dimensions`, "policy.yaml", warnings) ?? prev.dimensions,
      format: textWithWarn(value.format, `types.${key}.format`, "policy.yaml", warnings) || prev.format,
      transparency: typeof value.transparency === "boolean" ? value.transparency : prev.transparency,
      prompt: textWithWarn(value.prompt, `types.${key}.prompt`, "policy.yaml", warnings),
    };
    if (out[key].format && out[key].format !== SUPPORTED_FORMATS[key]) {
      errors.push(error("policy.yaml", "assetPolicyUnsupportedFormat", `types.${key}.format "${out[key].format}" is not supported. Only "${SUPPORTED_FORMATS[key]}" is allowed.`));
    }
  }
  // Audio type
  {
    const value = asOptionalRecord(src.audio, "policy.yaml", "assetPolicyTypeMalformed", errors);
    if (value) {
      const prev = out.audio;
      out.audio = {
        format: textWithWarn(value.format, "types.audio.format", "policy.yaml", warnings) || prev.format,
        loop: typeof value.loop === "boolean" ? value.loop : prev.loop,
        prompt: textWithWarn(value.prompt, "types.audio.prompt", "policy.yaml", warnings),
      };
      if (out.audio.format && out.audio.format !== SUPPORTED_FORMATS.audio) {
        errors.push(error("policy.yaml", "assetPolicyUnsupportedFormat", `types.audio.format "${out.audio.format}" is not supported. Only "${SUPPORTED_FORMATS.audio}" is allowed.`));
      }
    }
  }
  if (enabled) {
    for (const key of ["background", "portrait", "evidence"] as const) {
      if (!out[key].prompt) errors.push(error("policy.yaml", "assetPolicyMissingTypePrompt", `types.${key}.prompt is required when assets are enabled.`));
    }
  }
  return out;
}

function buildCharacters(raw: unknown[], enabled: boolean, errors: CompileError[], warnings: CompileError[]) {
  const byId = new Map<string, CharacterConfig>();
  const byDisplayName = new Map<string, CharacterConfig>();
  for (const item of raw) {
    const c = asRecord(item, "characters.yaml", "assetCharacterMalformed", errors);
    if (!c) continue;
    const idRaw = c.id;
    const id = textWithWarn(idRaw, "id", "characters.yaml", warnings);
    const idIsSafe = !id || SAFE_ASSET_SLUG.test(id);
    const idPresentButWrongType = idRaw !== undefined && idRaw !== null && typeof idRaw !== "string";
    const displayNames = Array.isArray(c.displayNames)
      ? c.displayNames.flatMap((v) => {
          if (typeof v !== "string") {
            warnings.push(error("characters.yaml", "assetConfigWrongType", `Field "displayNames" entry expected string, got ${typeof v}.`));
            return [];
          }
          const trimmed = v.trim();
          return trimmed ? [trimmed] : [];
        })
      : [];
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
    if (idPresentButWrongType) {
      errors.push(error("characters.yaml", "assetCharacterIdWrongType", `Character id must be a string, got ${typeof idRaw}.`));
    } else if (!id) {
      errors.push(error("characters.yaml", "assetCharacterMissingId", "Each character requires id."));
    }
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
    out.set(id, { id, prompt: text(record.prompt), loop: typeof record.loop === "boolean" ? record.loop : true });
  }
  return out;
}

function readYaml(path: string, errors: CompileError[]) {
  try {
    return Bun.YAML.parse(readFileSync(path, "utf-8"));
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

/** Like text(), but emits a warning when the value is present but not a string. */
function textWithWarn(value: unknown, fieldName: string, sourceFile: string, warnings: CompileError[]): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  warnings.push(error(sourceFile, "assetConfigWrongType", `Field "${fieldName}" expected string, got ${typeof value}.`));
  return "";
}

/** Like tuple(), but emits a warning when the value is present but malformed. */
function tupleWithWarn(value: unknown, fieldName: string, sourceFile: string, warnings: CompileError[]): [number, number] | undefined {
  if (value === undefined || value === null) return undefined;
  const result = tuple(value);
  if (result === undefined) {
    warnings.push(error(sourceFile, "assetConfigWrongType", `Field "${fieldName}" expected [number, number], got ${JSON.stringify(value)}.`));
  }
  return result;
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
