/** A target's normalized box on the scene's 16:9 cover plane. */
export type TargetLayout = { x: number; y: number; w: number; h: number };

function percent(value: number) {
  return `${value * 100}%`;
}

/**
 * Inline style that places a hotspot or witness on the cover plane. The
 * unitless ratios let the target's own descendants (the pending cue) find
 * where the target sits in the viewport; a percentage there would resolve
 * against the target instead of the plane.
 */
export function targetLayoutStyle(layout: TargetLayout): string {
  return `--x: ${percent(layout.x)}; --y: ${percent(layout.y)}; --w: ${percent(layout.w)}; --h: ${percent(layout.h)}; --x-ratio: ${layout.x}; --y-ratio: ${layout.y};`;
}
