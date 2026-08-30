// =============================================================================
// packages/scripts/compile-scenes/assets/config.ts
//
// Loads and validates the asset pipeline configuration: policy.yaml,
// characters.yaml, audio.yaml. Produces a typed AssetConfig (or collected
// errors). Asset-ID slugs are validated here; bad slugs are hard errors.
// =============================================================================

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import type { CompileError } from "../types";
import {
  asOptionalRecord,
  asRecord,
  compileError as error,
  emptyAudioMaps,
  isRecord,
  parseAudioYamlText,
  parseCharactersYamlText,
  SAFE_ASSET_SLUG,
  textWithWarn,
  type AudioConfigEntry,
  type CharacterConfig,
  type ParsedAudioCatalog,
  type ParsedCharacterCatalog,
  type ParsedCharacterEntry,
} from "./config-catalog";

export type {
  AudioChannel,
  AudioConfigEntry,
  CharacterConfig,
  CharacterExpressionConfig,
} from "./config-catalog";

export type AssetTypeName =
  | "background"
  | "portrait"
  | "standee"
  | "evidence"
  | "audio";
export type ImageAssetTypeName =
  | "background"
  | "portrait"
  | "standee"
  | "evidence";

/** Policy for image asset types (background, portrait, evidence). */
export type ImageAssetPolicy = {
  dimensions?: [number, number] | undefined;
  format: string;
  transparency?: boolean | undefined;
  prompt: string;
};

/** Policy for audio asset types. No dimensions/transparency; has loop. */
export type AudioAssetPolicy = {
  format: string;
  loop?: boolean | undefined;
  prompt: string;
};

/** Per-type policies, discriminated so image-only and audio-only fields
 *  cannot cross-contaminate. */
export type AssetTypePolicies = {
  background: ImageAssetPolicy;
  portrait: ImageAssetPolicy;
  standee: ImageAssetPolicy;
  evidence: ImageAssetPolicy;
  audio: AudioAssetPolicy;
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
    sfx: Map<string, AudioConfigEntry>;
  };
};

export type AssetConfigResult =
  | { ok: true; value: AssetConfig; warnings: CompileError[] }
  | { ok: false; errors: CompileError[] };

function defaultTypes(): AssetTypePolicies {
  return {
    background: {
      dimensions: [1920, 1080],
      format: "png",
      transparency: false,
      prompt: "",
    },
    portrait: {
      dimensions: [768, 1024],
      format: "png",
      transparency: true,
      prompt: "",
    },
    standee: {
      dimensions: [1024, 1536],
      format: "png",
      transparency: true,
      prompt: "",
    },
    evidence: {
      dimensions: [512, 512],
      format: "png",
      transparency: true,
      prompt: "",
    },
    audio: { format: "ogg", loop: true, prompt: "" },
  };
}

function emptyAssetConfig(): AssetConfig {
  return {
    enabled: false,
    globalStylePrompt: "",
    types: defaultTypes(),
    characters: { byId: new Map(), byDisplayName: new Map() },
    audio: { bgm: new Map(), bgs: new Map(), sfx: new Map() },
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
  const policy = asRecord(
    readYaml(policyPath, errors),
    policyPath,
    "assetPolicyMalformed",
    errors,
  );
  const charactersCatalog = readCharactersCatalog(configRoot);
  const audioCatalog = readAudioCatalog(configRoot);
  if (!charactersCatalog.ok || !audioCatalog.ok) {
    if (!charactersCatalog.ok) errors.push(...charactersCatalog.errors);
    if (!audioCatalog.ok) errors.push(...audioCatalog.errors);
    return { ok: false, errors };
  }
  if (errors.length > 0) return { ok: false, errors };

  // Narrow policy sub-objects through isRecord rather than optional-chaining
  // on `Record<string, unknown>` (which leaves the accessed property as
  // `{}`/unknown and trips TS2339 under strict indexing).
  const policyAssets = policy?.assets;
  const enabled = isRecord(policyAssets) && policyAssets.enabled === true;
  const policyGlobalStyle = policy?.globalStyle;
  const globalStylePrompt = textWithWarn(
    isRecord(policyGlobalStyle) ? policyGlobalStyle.prompt : undefined,
    "globalStyle.prompt",
    "policy.yaml",
    warnings,
  );
  const types = buildTypePolicies(policy?.types, enabled, errors, warnings);
  const characters = buildCharacters(
    charactersCatalog,
    enabled,
    errors,
    warnings,
  );
  const audio = adoptAudioCatalog(audioCatalog, errors, warnings);

  if (enabled && !globalStylePrompt) {
    errors.push(
      error(
        policyPath,
        "assetPolicyMissingGlobalStyle",
        "assets.enabled is true but globalStyle.prompt is empty.",
      ),
    );
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
  standee: "png",
  evidence: "png",
  audio: "ogg",
};

function buildTypePolicies(
  raw: unknown,
  enabled: boolean,
  errors: CompileError[],
  warnings: CompileError[],
): AssetTypePolicies {
  const src = isRecord(raw) ? raw : {};
  const out = defaultTypes();
  // Image types: background, portrait, standee, evidence
  for (const key of [
    "background",
    "portrait",
    "standee",
    "evidence",
  ] as const) {
    const value = asOptionalRecord(
      src[key],
      "policy.yaml",
      "assetPolicyTypeMalformed",
      errors,
    );
    if (!value) continue;
    const prev = out[key];
    const transparency =
      typeof value.transparency === "boolean"
        ? value.transparency
        : "transparency" in value
          ? (warnings.push(
              error(
                "policy.yaml",
                "assetConfigWrongType",
                `Field "types.${key}.transparency" expected boolean, got ${typeof value.transparency}.`,
              ),
            ),
            prev.transparency)
          : prev.transparency;
    out[key] = {
      dimensions:
        tupleWithWarn(
          value.dimensions,
          `types.${key}.dimensions`,
          "policy.yaml",
          warnings,
        ) ?? prev.dimensions,
      format:
        textWithWarn(
          value.format,
          `types.${key}.format`,
          "policy.yaml",
          warnings,
        ) || prev.format,
      transparency,
      prompt: textWithWarn(
        value.prompt,
        `types.${key}.prompt`,
        "policy.yaml",
        warnings,
      ),
    };
    if (out[key].format && out[key].format !== SUPPORTED_FORMATS[key]) {
      errors.push(
        error(
          "policy.yaml",
          "assetPolicyUnsupportedFormat",
          `types.${key}.format "${out[key].format}" is not supported. Only "${SUPPORTED_FORMATS[key]}" is allowed.`,
        ),
      );
    }
  }
  // Audio type
  {
    const value = asOptionalRecord(
      src.audio,
      "policy.yaml",
      "assetPolicyTypeMalformed",
      errors,
    );
    if (value) {
      const prev = out.audio;
      const loop =
        typeof value.loop === "boolean"
          ? value.loop
          : "loop" in value
            ? (warnings.push(
                error(
                  "policy.yaml",
                  "assetConfigWrongType",
                  `Field "types.audio.loop" expected boolean, got ${typeof value.loop}.`,
                ),
              ),
              prev.loop)
            : prev.loop;
      out.audio = {
        format:
          textWithWarn(
            value.format,
            "types.audio.format",
            "policy.yaml",
            warnings,
          ) || prev.format,
        loop,
        prompt: textWithWarn(
          value.prompt,
          "types.audio.prompt",
          "policy.yaml",
          warnings,
        ),
      };
      if (out.audio.format && out.audio.format !== SUPPORTED_FORMATS.audio) {
        errors.push(
          error(
            "policy.yaml",
            "assetPolicyUnsupportedFormat",
            `types.audio.format "${out.audio.format}" is not supported. Only "${SUPPORTED_FORMATS.audio}" is allowed.`,
          ),
        );
      }
    }
  }
  if (enabled) {
    for (const key of [
      "background",
      "portrait",
      "standee",
      "evidence",
    ] as const) {
      if (!out[key].prompt)
        errors.push(
          error(
            "policy.yaml",
            "assetPolicyMissingTypePrompt",
            `types.${key}.prompt is required when assets are enabled.`,
          ),
        );
    }
  }
  return out;
}

/**
 * Reads characters.yaml through the shared pure parser. Filesystem I/O stays
 * here; a missing file normalizes to an empty catalog exactly like the
 * previous inline `{ characters: [] }` default, and an unreadable file
 * (permission/EMFILE/EISDIR) yields the same `assetConfigUnreadable` failure
 * shape the parser produces for parse failures — never a raw throw.
 */
function readCharactersCatalog(configRoot: string): ParsedCharacterCatalog {
  const path = resolve(configRoot, "characters.yaml");
  if (!existsSync(path)) {
    return { ok: true, characters: [], errors: [], warnings: [] };
  }
  try {
    return parseCharactersYamlText(readFileSync(path, "utf-8"), path);
  } catch (e) {
    return {
      ok: false,
      errors: [
        error(
          path,
          "assetConfigUnreadable",
          `${path}: ${(e as Error).message}`,
        ),
      ],
    };
  }
}

/** See readCharactersCatalog(); missing audio.yaml normalizes to empty maps. */
function readAudioCatalog(configRoot: string): ParsedAudioCatalog {
  const path = resolve(configRoot, "audio.yaml");
  if (!existsSync(path)) {
    return { ok: true, audio: emptyAudioMaps(), errors: [], warnings: [] };
  }
  try {
    return parseAudioYamlText(readFileSync(path, "utf-8"), path);
  } catch (e) {
    return {
      ok: false,
      errors: [
        error(
          path,
          "assetConfigUnreadable",
          `${path}: ${(e as Error).message}`,
        ),
      ],
    };
  }
}

function toCharacterConfig(entry: ParsedCharacterEntry): CharacterConfig {
  const {
    id,
    displayNames,
    portraitMode,
    visualPrompt,
    referenceAssetId,
    expressions,
  } = entry;
  return {
    id,
    displayNames,
    portraitMode,
    visualPrompt,
    referenceAssetId,
    expressions,
  };
}

/**
 * Compiler-only validity policy over the shared parser's normalized output:
 * id wrong type / missing / slug, missing displayNames, duplicate ids,
 * required `standard` expression (enabled), ambiguous display names, and the
 * enabled non-empty-characters requirement.
 */
function buildCharacters(
  catalog: Extract<ParsedCharacterCatalog, { ok: true }>,
  enabled: boolean,
  errors: CompileError[],
  warnings: CompileError[],
) {
  const byId = new Map<string, CharacterConfig>();
  const byDisplayName = new Map<string, CharacterConfig>();
  errors.push(...catalog.errors);
  warnings.push(...catalog.warnings);
  for (const entry of catalog.characters) {
    errors.push(...entry.errors);
    warnings.push(...entry.warnings);
    const { id, displayNames, portraitMode, expressions } = entry;
    if (!entry.malformed) {
      if (entry.idWrongTypeKind !== null) {
        errors.push(
          error(
            "characters.yaml",
            "assetCharacterIdWrongType",
            `Character id must be a string, got ${entry.idWrongTypeKind}.`,
          ),
        );
      } else if (!id) {
        errors.push(
          error(
            "characters.yaml",
            "assetCharacterMissingId",
            "Each character requires id.",
          ),
        );
      }
      if (id && !SAFE_ASSET_SLUG.test(id)) {
        errors.push(
          error(
            "characters.yaml",
            "assetCharacterIdMalformed",
            `Character id ${id} must be a snake_case slug.`,
          ),
        );
      }
      if (displayNames.length === 0)
        errors.push(
          error(
            "characters.yaml",
            "assetCharacterMissingDisplayNames",
            `Character ${id || "(missing id)"} requires displayNames.`,
          ),
        );
      if (id && byId.has(id)) {
        errors.push(
          error(
            "characters.yaml",
            "assetCharacterDuplicateId",
            `Character id ${id} is defined multiple times.`,
          ),
        );
      }
      if (
        enabled &&
        portraitMode === "portrait" &&
        !expressions.has("standard")
      ) {
        errors.push(
          error(
            "characters.yaml",
            "assetCharacterMissingStandardExpression",
            `Character ${id} requires expressions.standard.`,
          ),
        );
      }
    }
    if (id && SAFE_ASSET_SLUG.test(id) && !byId.has(id)) {
      byId.set(id, toCharacterConfig(entry));
    }
    for (const name of displayNames) {
      if (byDisplayName.has(name))
        errors.push(
          error(
            "characters.yaml",
            "assetCharacterAmbiguousDisplayName",
            `Display name ${name} maps to multiple characters.`,
          ),
        );
      byDisplayName.set(name, toCharacterConfig(entry));
    }
  }
  if (enabled && catalog.characters.length === 0) {
    errors.push(
      error(
        "characters.yaml",
        "assetCharactersMissing",
        "assets.enabled is true but characters.yaml has no characters.",
      ),
    );
  }
  return { byId, byDisplayName };
}

function adoptAudioCatalog(
  catalog: Extract<ParsedAudioCatalog, { ok: true }>,
  errors: CompileError[],
  warnings: CompileError[],
): AssetConfig["audio"] {
  errors.push(...catalog.errors);
  warnings.push(...catalog.warnings);
  return catalog.audio;
}

function readYaml(path: string, errors: CompileError[]) {
  try {
    return YAML.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    errors.push(
      error(path, "assetConfigUnreadable", `${path}: ${(e as Error).message}`),
    );
    return null;
  }
}

/** Like tuple(), but emits a warning when the value is present but malformed. */
function tupleWithWarn(
  value: unknown,
  fieldName: string,
  sourceFile: string,
  warnings: CompileError[],
): [number, number] | undefined {
  if (value === undefined || value === null) return undefined;
  const result = tuple(value);
  if (result === undefined) {
    warnings.push(
      error(
        sourceFile,
        "assetConfigWrongType",
        `Field "${fieldName}" expected [number, number], got ${JSON.stringify(value)}.`,
      ),
    );
  }
  return result;
}

function tuple(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const a = Number(value[0]);
  const b = Number(value[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return undefined;
  if (a <= 0 || b <= 0) return undefined;
  return [a, b];
}
