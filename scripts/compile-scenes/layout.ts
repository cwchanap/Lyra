import type {
  ASTInvestigationScene,
  CompileError,
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
    return errors.length > 0 ? { ok: false, errors } : unreachable();
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
      const parsed = parseRectLayout(rawLayout, sourceFile, "hotspot");
      errors.push(...parsed.errors);
      if (parsed.value) hotspots[hotspotId] = parsed.value;
    }

    const characters: Record<string, SpriteLayout> = {};
    for (const [characterId, rawLayout] of Object.entries(charactersRoot)) {
      const parsed = parseSpriteLayout(rawLayout, sourceFile);
      errors.push(...parsed.errors);
      if (parsed.value) characters[characterId] = parsed.value;
    }

    sublocations[sublocationId] = { hotspots, characters };
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      version: 1,
      sceneId,
      sublocations,
    },
  };
}

export function applyInvestigationLayout(
  scene: ASTInvestigationScene,
  layout: InvestigationLayoutSidecar,
): InvestigationLayoutApplyResult {
  const errors: CompileError[] = [];
  if (layout.sceneId !== scene.id) {
    errors.push(
      error(
        scene.sourceFile,
        "layoutSceneMismatch",
        `Layout sceneId "${layout.sceneId}" does not match scene "${scene.id}".`,
        scene.line,
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
          scene.sourceFile,
          "layoutUnknownSublocation",
          `Layout references unknown sublocation "${sublocationId}".`,
          scene.line,
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
            scene.sourceFile,
            "layoutUnknownHotspot",
            `Layout references unknown hotspot "${hotspotId}" in sublocation "${sublocationId}".`,
            sublocation.line,
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
            scene.sourceFile,
            "layoutUnknownCharacter",
            `Layout references unknown character "${characterId}" in sublocation "${sublocationId}".`,
            sublocation.line,
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
): { value: RectLayout | null; errors: CompileError[] } {
  const layout = asRecord(rawLayout);
  if (!layout || layout.kind !== "rect") {
    return {
      value: null,
      errors: [
        error(
          sourceFile,
          "layoutInvalidRect",
          `${targetKind} layout must use kind "rect".`,
        ),
      ],
    };
  }

  const numberErrors = validateRectNumbers(layout, sourceFile);
  if (numberErrors.length > 0) {
    return { value: null, errors: numberErrors };
  }

  const rect = {
    kind: "rect" as const,
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h,
  };
  const geometryErrors = validateGeometry(rect, sourceFile);
  return {
    value: geometryErrors.length > 0 ? null : rect,
    errors: geometryErrors,
  };
}

function parseSpriteLayout(
  rawLayout: unknown,
  sourceFile: string,
): { value: SpriteLayout | null; errors: CompileError[] } {
  const layout = asRecord(rawLayout);
  if (!layout || layout.kind !== "sprite") {
    return {
      value: null,
      errors: [
        error(
          sourceFile,
          "layoutInvalidSprite",
          'character layout must use kind "sprite".',
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
        "Sprite layout must include a non-empty assetId.",
      ),
    );
  }
  if (layout.anchor !== "bottomCenter") {
    errors.push(
      error(
        sourceFile,
        "layoutInvalidAnchor",
        'Sprite layout anchor must be "bottomCenter".',
      ),
    );
  }
  errors.push(...validateRectNumbers(layout, sourceFile));
  if (errors.length > 0) return { value: null, errors };

  const sprite = {
    kind: "sprite" as const,
    assetId,
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h,
    anchor: "bottomCenter" as const,
  };
  const geometryErrors = validateGeometry(sprite, sourceFile);
  return {
    value: geometryErrors.length > 0 ? null : sprite,
    errors: geometryErrors,
  };
}

function validateRectNumbers(
  layout: Record<string, unknown>,
  sourceFile: string,
): CompileError[] {
  const errors: CompileError[] = [];
  for (const key of ["x", "y", "w", "h"] as const) {
    if (typeof layout[key] !== "number" || !Number.isFinite(layout[key])) {
      errors.push(
        error(
          sourceFile,
          "layoutInvalidNumber",
          `Layout field "${key}" must be a finite number.`,
        ),
      );
    }
  }
  return errors;
}

function validateGeometry(
  layout: RectLayout | SpriteLayout,
  sourceFile: string,
): CompileError[] {
  const errors: CompileError[] = [];
  if (layout.w <= 0 || layout.h <= 0) {
    errors.push(
      error(
        sourceFile,
        "layoutInvalidSize",
        "Layout width and height must be greater than zero.",
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
        "Layout rectangle must stay within normalized scene bounds.",
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

function error(
  sourceFile: string,
  code: string,
  message: string,
  line = 1,
): CompileError {
  return { code, message, sourceFile, line };
}

function unreachable(): never {
  throw new Error("Unreachable layout parse state.");
}
