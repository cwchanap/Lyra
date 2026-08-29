// =============================================================================
// packages/shared/src/index.ts
//
// Shared alpha-crop helpers for the Lyra game and layout editor.
//
// Single source of truth for computing the visible (non-transparent) bounds of
// an RGBA image and turning those bounds into the CSS custom properties the
// runtime uses to crop standee/portrait sprites (--crop-left/top/width/height).
//
// Consumers:
//   - apps/game/src/lib/components/InvestigationSceneSurface.svelte
//   - apps/layout-editor/src/lib/layout-geometry.ts (re-exported for EditorCanvas)
//
// Scope guardrail: this package is intentionally narrow. Unrelated shared
// utilities belong in their own package, not here.
// =============================================================================

export type AlphaBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/**
 * Computes the bounding box of visible (non-transparent) pixels in an RGBA image.
 * Returns null if the image is fully transparent or malformed.
 */
export function alphaBoundsFromImageData(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
): AlphaBounds | null {
  const expected = imageWidth * imageHeight * 4;
  if (data.length < expected) return null;

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

/** Standard standee asset dimensions used as default crop variables. */
export const DEFAULT_ASSET_WIDTH = 1024;
export const DEFAULT_ASSET_HEIGHT = 1536;

/**
 * Converts alpha bounds into CSS custom properties for cropping sprite assets.
 * Returns a semicolon-separated string of --crop-* variables.
 */
export function cropVariablesForAlphaBounds(
  bounds: AlphaBounds,
  imageWidth = DEFAULT_ASSET_WIDTH,
  imageHeight = DEFAULT_ASSET_HEIGHT,
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
