import type { RectLayout, SpriteLayout } from "./layout-types";

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export type AlphaBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const MIN_SIZE = 0.025;

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

  if (w < MIN_SIZE) {
    w = MIN_SIZE;
    if (handle.includes("w")) x = startRight - MIN_SIZE;
  }
  if (h < MIN_SIZE) {
    h = MIN_SIZE;
    if (handle.includes("n")) y = startBottom - MIN_SIZE;
  }

  x = clamp(x, 0, 1 - MIN_SIZE);
  y = clamp(y, 0, 1 - MIN_SIZE);
  w = clamp(w, MIN_SIZE, 1 - x);
  h = clamp(h, MIN_SIZE, 1 - y);

  return {
    ...layout,
    x: roundLayoutValue(x),
    y: roundLayoutValue(y),
    w: roundLayoutValue(w),
    h: roundLayoutValue(h),
  };
}

export function alphaBoundsFromImageData(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
): AlphaBounds | null {
  let left = imageWidth;
  let top = imageHeight;
  let right = 0;
  let bottom = 0;

  for (let y = 0; y < imageHeight; y += 1) {
    for (let x = 0; x < imageWidth; x += 1) {
      const alpha = data[(y * imageWidth + x) * 4 + 3] ?? 0;
      if (alpha <= 0) continue;

      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }

  if (right <= left || bottom <= top) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function cropVariablesForAlphaBounds(
  bounds: AlphaBounds,
  imageWidth = 1024,
  imageHeight = 1536,
): string {
  return (
    [
      `--crop-left: ${bounds.left / imageWidth}`,
      `--crop-top: ${bounds.top / imageHeight}`,
      `--crop-width: ${bounds.width / imageWidth}`,
      `--crop-height: ${bounds.height / imageHeight}`,
    ].join("; ") + ";"
  );
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
