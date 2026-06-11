import type { RectLayout, SpriteLayout } from "./layout-types";

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export {
  type AlphaBounds,
  alphaBoundsFromImageData,
  cropVariablesForAlphaBounds,
  DEFAULT_ASSET_WIDTH,
  DEFAULT_ASSET_HEIGHT,
} from "@lyra/game/src/lib/assets/alpha-crop";

export const MIN_LAYOUT_SIZE = 0.025;

export function resizeLayoutFromHandle<T extends RectLayout | SpriteLayout>(
  layout: T,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): T {
  const startRight = layout.x + layout.w;
  const startBottom = layout.y + layout.h;
  let x = layout.x;
  let y = layout.y;
  let w = layout.w;
  let h = layout.h;

  if (handle.includes("e")) w = layout.w + dx;
  if (handle.includes("s")) h = layout.h + dy;
  if (handle.includes("w")) {
    x = layout.x + dx;
    w = layout.w - dx;
  }
  if (handle.includes("n")) {
    y = layout.y + dy;
    h = layout.h - dy;
  }

  if (w < MIN_LAYOUT_SIZE) {
    w = MIN_LAYOUT_SIZE;
    if (handle.includes("w")) x = startRight - MIN_LAYOUT_SIZE;
  }
  if (h < MIN_LAYOUT_SIZE) {
    h = MIN_LAYOUT_SIZE;
    if (handle.includes("n")) y = startBottom - MIN_LAYOUT_SIZE;
  }

  x = clamp(x, 0, 1 - MIN_LAYOUT_SIZE);
  y = clamp(y, 0, 1 - MIN_LAYOUT_SIZE);
  w = clamp(w, MIN_LAYOUT_SIZE, 1 - x);
  h = clamp(h, MIN_LAYOUT_SIZE, 1 - y);

  return {
    ...layout,
    x: roundLayoutValue(x),
    y: roundLayoutValue(y),
    w: roundLayoutValue(w),
    h: roundLayoutValue(h),
  };
}

export function moveLayout<T extends RectLayout | SpriteLayout>(
  layout: T,
  dx: number,
  dy: number,
): T {
  return {
    ...layout,
    x: roundLayoutValue(clamp(layout.x + dx, 0, 1 - layout.w)),
    y: roundLayoutValue(clamp(layout.y + dy, 0, 1 - layout.h)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundLayoutValue(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Clamps a raw layout box to valid normalized coordinates.
 * Handles NaN/Infinity by falling back to `min`. Used by the
 * layout store to sanitize incoming values before persisting.
 */
export function clampLayoutBox(layout: {
  x: number;
  y: number;
  w: number;
  h: number;
}): { x: number; y: number; w: number; h: number } {
  const safeClamp = (v: number, min: number, max: number) =>
    Number.isFinite(v) ? Math.min(Math.max(v, min), max) : min;

  const w = safeClamp(layout.w, MIN_LAYOUT_SIZE, 1);
  const h = safeClamp(layout.h, MIN_LAYOUT_SIZE, 1);
  return {
    x: safeClamp(layout.x, 0, 1 - w),
    y: safeClamp(layout.y, 0, 1 - h),
    w,
    h,
  };
}

export function clampRectLayout(layout: RectLayout): RectLayout {
  return { kind: "rect", ...clampLayoutBox(layout) };
}

export function clampSpriteLayout(layout: SpriteLayout): SpriteLayout {
  return {
    kind: "sprite",
    assetId: layout.assetId,
    ...clampLayoutBox(layout),
    anchor: layout.anchor,
  };
}
