import type {
  ASTInvestigationScene,
  BakedCharacterLayout,
  CharacterLayout,
  CompileError,
  IntentionalHotspotOverlap,
  InvestigationLayoutSidecar,
  RectLayout,
  SpriteLayout,
} from "./types";

export type InvestigationLayoutParseResult =
  | { ok: true; value: InvestigationLayoutSidecar }
  | { ok: false; errors: CompileError[] };

export type InvestigationLayoutApplyResult =
  | { ok: true; value: ASTInvestigationScene }
  | { ok: false; errors: CompileError[] };

type LayoutTargetKind = "hotspot" | "character";
const layoutSourceFile = Symbol("layoutSourceFile");

type LayoutSourceMetadata = {
  [layoutSourceFile]?: string;
};

export function parseInvestigationLayoutJson(
  source: string,
  sourceFile: string,
): InvestigationLayoutParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return {
      ok: false,
      errors: [
        error(
          sourceFile,
          "layoutInvalidJson",
          "Layout sidecar must be valid JSON.",
        ),
      ],
    };
  }

  const root = asRecord(raw);
  if (!root) {
    return {
      ok: false,
      errors: [
        error(
          sourceFile,
          "layoutInvalidRoot",
          "Layout sidecar root must be an object.",
        ),
      ],
    };
  }

  const errors: CompileError[] = [];
  if (root.version !== 1) {
    errors.push(
      error(
        sourceFile,
        "layoutUnsupportedVersion",
        "Layout sidecar version must be 1.",
      ),
    );
  }

  const sceneId = typeof root.sceneId === "string" ? root.sceneId.trim() : "";
  if (sceneId.length === 0) {
    errors.push(
      error(
        sourceFile,
        "layoutMissingSceneId",
        "Layout sidecar must include a non-empty sceneId.",
      ),
    );
  }

  const sublocationsRoot = asRecord(root.sublocations);
  if (!sublocationsRoot) {
    errors.push(
      error(
        sourceFile,
        "layoutMissingSublocations",
        "Layout sidecar must include a sublocations object.",
      ),
    );
    return { ok: false, errors };
  }

  const sublocations: InvestigationLayoutSidecar["sublocations"] = {};
  for (const [sublocationId, rawSublocation] of Object.entries(
    sublocationsRoot,
  )) {
    const sublocation = asRecord(rawSublocation);
    const hotspotsRoot = asRecord(sublocation?.hotspots);
    const charactersRoot = asRecord(sublocation?.characters);
    if (!sublocation || !hotspotsRoot || !charactersRoot) {
      errors.push(
        error(
          sourceFile,
          "layoutInvalidSublocation",
          `Layout sublocation "${sublocationId}" must include hotspots and characters objects.`,
        ),
      );
      continue;
    }

    const hotspots: Record<string, RectLayout> = {};
    for (const [hotspotId, rawLayout] of Object.entries(hotspotsRoot)) {
      const targetPath = `sublocations.${sublocationId}.hotspots.${hotspotId}`;
      const parsed = parseRectLayout(
        rawLayout,
        sourceFile,
        "hotspot",
        targetPath,
      );
      errors.push(...parsed.errors);
      if (parsed.value) hotspots[hotspotId] = parsed.value;
    }

    const characters: Record<string, CharacterLayout> = {};
    for (const [characterId, rawLayout] of Object.entries(charactersRoot)) {
      const targetPath = `sublocations.${sublocationId}.characters.${characterId}`;
      const parsed = parseCharacterLayout(rawLayout, sourceFile, targetPath);
      errors.push(...parsed.errors);
      if (parsed.value) characters[characterId] = parsed.value;
    }

    const intentionalOverlaps = parseIntentionalOverlaps(
      sublocation.intentionalOverlaps,
      hotspots,
      sourceFile,
      sublocationId,
      errors,
    );

    sublocations[sublocationId] = {
      hotspots,
      characters,
      ...(intentionalOverlaps.length > 0 ? { intentionalOverlaps } : {}),
    };
  }

  if (errors.length > 0) return { ok: false, errors };
  const value = {
    version: 1,
    sceneId,
    sublocations,
  } satisfies InvestigationLayoutSidecar;
  Object.defineProperty(value, layoutSourceFile, {
    value: sourceFile,
    enumerable: false,
  });
  return {
    ok: true,
    value,
  };
}

export function applyInvestigationLayout(
  scene: ASTInvestigationScene,
  layout: InvestigationLayoutSidecar,
  sourceFile?: string,
): InvestigationLayoutApplyResult {
  const errors: CompileError[] = [];
  const sidecarSourceFile =
    sourceFile ??
    (layout as InvestigationLayoutSidecar & LayoutSourceMetadata)[
      layoutSourceFile
    ] ??
    scene.sourceFile;
  if (layout.sceneId !== scene.id) {
    errors.push(
      error(
        sidecarSourceFile,
        "layoutSceneMismatch",
        `Layout sceneId "${layout.sceneId}" does not match scene "${scene.id}".`,
      ),
    );
  }

  const sceneSublocations = new Map(
    scene.sublocations.map((sublocation) => [sublocation.id, sublocation]),
  );
  for (const [sublocationId, sublocationLayout] of Object.entries(
    layout.sublocations,
  )) {
    const sublocation = sceneSublocations.get(sublocationId);
    if (!sublocation) {
      errors.push(
        error(
          sidecarSourceFile,
          "layoutUnknownSublocation",
          `Layout references unknown sublocation "${sublocationId}".`,
        ),
      );
      continue;
    }

    const hotspotIds = new Set(
      sublocation.hotspots.map((hotspot) => hotspot.id),
    );
    for (const hotspotId of Object.keys(sublocationLayout.hotspots)) {
      if (!hotspotIds.has(hotspotId)) {
        errors.push(
          error(
            sidecarSourceFile,
            "layoutUnknownHotspot",
            `Layout references unknown hotspot "${hotspotId}" in sublocation "${sublocationId}".`,
          ),
        );
      }
    }

    const characterIds = new Set(
      sublocation.characters.map((character) => character.id),
    );
    for (const characterId of Object.keys(sublocationLayout.characters)) {
      if (!characterIds.has(characterId)) {
        errors.push(
          error(
            sidecarSourceFile,
            "layoutUnknownCharacter",
            `Layout references unknown character "${characterId}" in sublocation "${sublocationId}".`,
          ),
        );
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      ...scene,
      sublocations: scene.sublocations.map((sublocation) => {
        const sublocationLayout = layout.sublocations[sublocation.id];
        return {
          ...sublocation,
          hotspots: sublocation.hotspots.map((hotspot) => ({
            ...hotspot,
            layout: sublocationLayout?.hotspots[hotspot.id] ?? null,
          })),
          characters: sublocation.characters.map((character) => ({
            ...character,
            layout: sublocationLayout?.characters[character.id] ?? null,
          })),
        };
      }),
    },
  };
}

function parseRectLayout(
  rawLayout: unknown,
  sourceFile: string,
  targetKind: LayoutTargetKind,
  targetPath: string,
): { value: RectLayout | null; errors: CompileError[] } {
  const layout = asRecord(rawLayout);
  if (!layout || layout.kind !== "rect") {
    return {
      value: null,
      errors: [
        error(
          sourceFile,
          "layoutInvalidRect",
          `${targetPath} ${targetKind} layout must use kind "rect".`,
        ),
      ],
    };
  }

  const numberErrors = validateRectNumbers(layout, sourceFile, targetPath);
  if (numberErrors.length > 0) {
    return { value: null, errors: numberErrors };
  }

  // validateRectNumbers above returned no errors, so x/y/w/h are finite
  // numbers — assert the narrowed type TS cannot track through that guard.
  const rect = {
    kind: "rect" as const,
    x: layout.x as number,
    y: layout.y as number,
    w: layout.w as number,
    h: layout.h as number,
  };
  const geometryErrors = validateGeometry(rect, sourceFile, targetPath);
  return {
    value: geometryErrors.length > 0 ? null : rect,
    errors: geometryErrors,
  };
}

function parseCharacterLayout(
  rawLayout: unknown,
  sourceFile: string,
  targetPath: string,
): { value: CharacterLayout | null; errors: CompileError[] } {
  const layout = asRecord(rawLayout);
  if (layout?.kind === "sprite") {
    return parseSpriteLayout(rawLayout, sourceFile, targetPath);
  }
  if (layout?.kind === "baked") {
    return parseBakedCharacterLayout(layout, sourceFile, targetPath);
  }
  return {
    value: null,
    errors: [
      error(
        sourceFile,
        "layoutInvalidCharacterKind",
        `${targetPath} character layout kind must be "sprite" or "baked".`,
      ),
    ],
  };
}

function parseBakedCharacterLayout(
  layout: Record<string, unknown>,
  sourceFile: string,
  targetPath: string,
): { value: BakedCharacterLayout | null; errors: CompileError[] } {
  const errors = validateRectNumbers(layout, sourceFile, targetPath);
  if (errors.length > 0) return { value: null, errors };

  const baked = {
    kind: "baked" as const,
    x: layout.x as number,
    y: layout.y as number,
    w: layout.w as number,
    h: layout.h as number,
  };
  const geometryErrors = validateGeometry(baked, sourceFile, targetPath);
  return {
    value: geometryErrors.length > 0 ? null : baked,
    errors: geometryErrors,
  };
}

function parseSpriteLayout(
  rawLayout: unknown,
  sourceFile: string,
  targetPath: string,
): { value: SpriteLayout | null; errors: CompileError[] } {
  const layout = asRecord(rawLayout);
  if (!layout || layout.kind !== "sprite") {
    return {
      value: null,
      errors: [
        error(
          sourceFile,
          "layoutInvalidSprite",
          `${targetPath} character layout must use kind "sprite".`,
        ),
      ],
    };
  }

  const errors: CompileError[] = [];
  const assetId =
    typeof layout.assetId === "string" ? layout.assetId.trim() : "";
  if (assetId.length === 0) {
    errors.push(
      error(
        sourceFile,
        "layoutMissingAssetId",
        `${targetPath}.assetId must be a non-empty string.`,
      ),
    );
  } else if (assetId.startsWith("standee.")) {
    const safeSlug = /^[a-z0-9_]+$/i;
    const parts = assetId.split(".");
    if (
      parts.length !== 3 ||
      !parts[1] ||
      !parts[2] ||
      !safeSlug.test(parts[1]) ||
      !safeSlug.test(parts[2])
    ) {
      errors.push(
        error(
          sourceFile,
          "layoutInvalidStandeeAssetId",
          `${targetPath}.assetId "${assetId}" must follow format "standee.<characterId>.<pose>" with snake_case/alphanumeric segments.`,
        ),
      );
    }
  } else if (assetId.startsWith("portrait.")) {
    const safeSlug = /^[a-z0-9_]+$/i;
    const parts = assetId.split(".");
    if (
      parts.length !== 3 ||
      !parts[1] ||
      !parts[2] ||
      !safeSlug.test(parts[1]) ||
      !safeSlug.test(parts[2])
    ) {
      errors.push(
        error(
          sourceFile,
          "layoutInvalidPortraitAssetId",
          `${targetPath}.assetId "${assetId}" must follow format "portrait.<characterId>.<expression>" with snake_case/alphanumeric segments.`,
        ),
      );
    }
  } else {
    // Only portrait, standee, evidence, and background prefixes are
    // recognized by the renderer's imageStoryAssetTypeForId.  Unrecognized
    // assetIds cause synchronous throws at runtime with no recovery path.
    const recognized = ["evidence.", "background."] as const;
    if (!recognized.some((prefix) => assetId.startsWith(prefix))) {
      errors.push(
        error(
          sourceFile,
          "layoutUnrecognizedAssetId",
          `${targetPath}.assetId "${assetId}" must start with one of: portrait., standee., evidence., background.`,
        ),
      );
    }
  }
  if (layout.anchor !== "bottomCenter") {
    errors.push(
      error(
        sourceFile,
        "layoutInvalidAnchor",
        `${targetPath}.anchor must be "bottomCenter".`,
      ),
    );
  }
  errors.push(...validateRectNumbers(layout, sourceFile, targetPath));
  if (errors.length > 0) return { value: null, errors };

  // validateRectNumbers above returned no errors, so x/y/w/h are finite
  // numbers — assert the narrowed type TS cannot track through that guard.
  const sprite = {
    kind: "sprite" as const,
    assetId,
    x: layout.x as number,
    y: layout.y as number,
    w: layout.w as number,
    h: layout.h as number,
    anchor: "bottomCenter" as const,
  };
  const geometryErrors = validateGeometry(sprite, sourceFile, targetPath);
  return {
    value: geometryErrors.length > 0 ? null : sprite,
    errors: geometryErrors,
  };
}

function validateRectNumbers(
  layout: Record<string, unknown>,
  sourceFile: string,
  targetPath: string,
): CompileError[] {
  const errors: CompileError[] = [];
  for (const key of ["x", "y", "w", "h"] as const) {
    if (typeof layout[key] !== "number" || !Number.isFinite(layout[key])) {
      errors.push(
        error(
          sourceFile,
          "layoutInvalidNumber",
          `${targetPath}.${key} must be a finite number.`,
        ),
      );
    }
  }
  return errors;
}

function validateGeometry(
  layout: RectLayout | CharacterLayout,
  sourceFile: string,
  targetPath: string,
): CompileError[] {
  const errors: CompileError[] = [];
  if (layout.w <= 0 || layout.h <= 0) {
    errors.push(
      error(
        sourceFile,
        "layoutInvalidSize",
        `${targetPath}.w and ${targetPath}.h must be greater than zero.`,
      ),
    );
  }
  if (
    layout.x < 0 ||
    layout.y < 0 ||
    layout.x + layout.w > 1 ||
    layout.y + layout.h > 1
  ) {
    errors.push(
      error(
        sourceFile,
        "layoutOutOfBounds",
        `${targetPath} must stay within normalized scene bounds.`,
      ),
    );
  }
  return errors;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Detect hotspot rects that share interior area within the same sublocation.
 *
 * Returns one non-blocking warning per pair whose overlap covers at least 80%
 * of the smaller rect's area. This is a warning rather than a hard error
 * because overlaps are occasionally intentional (e.g. a deliberate
 * layered/nested target); but when one hotspot nearly entirely covers
 * another, the later-painted hotspot silently wins every click in the shared
 * region — that is the case worth surfacing. Minor corner overlaps (below the
 * 80% threshold) are visually obvious and rarely cause silent misclicks, so
 * they are suppressed to keep the warning's signal-to-noise ratio high.
 * Hotspots in different sublocations are never on screen together, so only
 * pairs within a single sublocation are compared. Edge-adjacency (touching
 * but non-overlapping) is allowed.
 *
 * Pairs listed in a sublocation's `intentionalOverlaps` are skipped, so the
 * warning keeps signal for unintentional overlaps. The opt-out is itself
 * validated during parsing (see `parseIntentionalOverlaps`): a typo'd hotspot
 * ID in an opt-out would otherwise silently disable the check, so unknown IDs
 * are surfaced as errors instead.
 */
export function detectLayoutOverlaps(
  layout: InvestigationLayoutSidecar,
  sourceFile: string,
): CompileError[] {
  const warnings: CompileError[] = [];
  for (const [sublocationId, sublocation] of Object.entries(
    layout.sublocations,
  )) {
    const optOut = buildIntentionalOverlapSet(sublocation.intentionalOverlaps);
    const entries = Object.entries(sublocation.hotspots);
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      if (!a) continue;
      for (let k = i + 1; k < entries.length; k++) {
        const b = entries[k];
        if (!b) continue;
        if (isIntentionalOverlap(optOut, a[0], b[0])) continue;
        const ratio = overlapRatio(a[1], b[1]);
        if (ratio >= OVERLAP_WARN_THRESHOLD) {
          warnings.push(
            error(
              sourceFile,
              "layoutHotspotOverlap",
              `Hotspot rects overlap in sublocation "${sublocationId}": "${a[0]}" and "${b[0]}" share ${Math.round(ratio * 100)}% of the smaller rect's area (threshold ${Math.round(OVERLAP_WARN_THRESHOLD * 100)}%). Separate the rects, or nest deliberately; the later-defined hotspot silently wins clicks in the shared region.`,
            ),
          );
        }
      }
    }
  }
  return warnings;
}

/**
 * Parse and validate a sublocation's `intentionalOverlaps` opt-out list.
 *
 * Each entry must be `{ hotspots: [idA, idB] }` with two distinct, non-empty
 * string IDs that both exist in the sublocation's parsed `hotspots`. Unknown
 * IDs, duplicate pairs, and malformed entries are pushed as compile errors so
 * a typo cannot silently disable the overlap check. Returns the cleaned list.
 */
function parseIntentionalOverlaps(
  raw: unknown,
  hotspots: Record<string, RectLayout>,
  sourceFile: string,
  sublocationId: string,
  errors: CompileError[],
): IntentionalHotspotOverlap[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push(
      error(
        sourceFile,
        "layoutInvalidIntentionalOverlaps",
        `Layout sublocation "${sublocationId}" intentionalOverlaps must be an array of { hotspots: [idA, idB] } entries.`,
      ),
    );
    return [];
  }

  const seen = new Set<string>();
  const result: IntentionalHotspotOverlap[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const pair = record?.hotspots;
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string" ||
      pair[0].length === 0 ||
      pair[1].length === 0
    ) {
      errors.push(
        error(
          sourceFile,
          "layoutInvalidIntentionalOverlaps",
          `Layout sublocation "${sublocationId}" intentionalOverlaps entries must be { hotspots: [idA, idB] } with two non-empty string IDs.`,
        ),
      );
      continue;
    }
    const [a, b] = pair as [string, string];
    if (a === b) {
      errors.push(
        error(
          sourceFile,
          "layoutInvalidIntentionalOverlaps",
          `Layout sublocation "${sublocationId}" intentionalOverlaps pair "${a}" references the same hotspot twice; remove the self-pair.`,
        ),
      );
      continue;
    }
    for (const id of [a, b]) {
      if (!(id in hotspots)) {
        errors.push(
          error(
            sourceFile,
            "layoutUnknownIntentionalOverlapHotspot",
            `Layout sublocation "${sublocationId}" intentionalOverlaps references unknown hotspot "${id}".`,
          ),
        );
      }
    }
    // An unknown-ID pair is invalid; skip it rather than letting it fall
    // through into `result` (where it would be discarded by the parse
    // failure anyway, but a continue keeps the cleaned output honest).
    if (!(a in hotspots) || !(b in hotspots)) {
      continue;
    }
    const key = pairKey(a, b);
    if (seen.has(key)) {
      errors.push(
        error(
          sourceFile,
          "layoutDuplicateIntentionalOverlap",
          `Layout sublocation "${sublocationId}" intentionalOverlaps lists pair "${a}"/"${b}" more than once.`,
        ),
      );
      continue;
    }
    seen.add(key);
    result.push({ hotspots: [a, b] });
  }
  return result;
}

function buildIntentionalOverlapSet(
  overlaps: ReadonlyArray<IntentionalHotspotOverlap> | undefined,
): Set<string> {
  const set = new Set<string>();
  if (!overlaps) return set;
  for (const { hotspots } of overlaps) {
    set.add(pairKey(hotspots[0], hotspots[1]));
  }
  return set;
}

function isIntentionalOverlap(
  optOut: Set<string>,
  a: string,
  b: string,
): boolean {
  return optOut.has(pairKey(a, b));
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/** Warn when the overlap covers at least this fraction of the smaller rect. */
const OVERLAP_WARN_THRESHOLD = 0.8;

/**
 * Returns the overlap area as a fraction of the smaller rect's area, or 0
 * when the rects do not share interior area. Edge-adjacent rects (touching
 * but non-overlapping) return 0. The epsilon absorbs floating-point
 * accumulation from authored decimal coordinates (e.g.
 * 0.1 + 0.2 === 0.30000000000000004 in JS); real overlaps in this domain
 * are orders of magnitude larger, so they remain detected.
 */
function overlapRatio(a: RectLayout, b: RectLayout): number {
  const EPSILON = 1e-9;
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapX <= EPSILON || overlapY <= EPSILON) return 0;
  const overlapArea = overlapX * overlapY;
  const minArea = Math.min(a.w * a.h, b.w * b.h);
  if (minArea <= EPSILON) return 0;
  return overlapArea / minArea;
}

function error(
  sourceFile: string,
  code: string,
  message: string,
  line = 1,
): CompileError {
  return { code, message, sourceFile, line };
}
