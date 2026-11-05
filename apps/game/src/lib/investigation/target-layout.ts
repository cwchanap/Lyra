/** A target's normalized box on the scene's 16:9 cover plane. */
export type TargetLayout = { x: number; y: number; w: number; h: number };

/** A CSS viewport size in px. */
export type ViewportSize = { w: number; h: number };

/** An axis-aligned rect in viewport px. */
export type ViewportRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function percent(value: number) {
  return `${value * 100}%`;
}

/**
 * Cover-plane size in px for a viewport. Mirrors the component's
 * --scene-cover-width/--scene-cover-height vars exactly: the plane is the
 * smallest 16:9 box that covers the viewport, so it overhangs on one axis
 * whenever the window is not 16:9.
 */
export function coverPlaneSize(viewport: ViewportSize): ViewportSize {
  return {
    w: Math.max(viewport.w, (16 / 9) * viewport.h),
    h: Math.max(viewport.h, (9 / 16) * viewport.w),
  };
}

/**
 * A target's hit box in viewport px: the authored box on the centered cover
 * plane, expanded right/down to at least `minW`×`minH` px (the .hotspot-target
 * 72×44 minimum-target clamp; characters pass 0 to keep the authored box).
 */
export function targetViewportRect(
  layout: TargetLayout,
  viewport: ViewportSize,
  minW = 0,
  minH = 0,
): ViewportRect {
  const plane = coverPlaneSize(viewport);
  const left = layout.x * plane.w - (plane.w - viewport.w) / 2;
  const top = layout.y * plane.h - (plane.h - viewport.h) / 2;
  return {
    left,
    top,
    right: left + Math.max(layout.w * plane.w, minW),
    bottom: top + Math.max(layout.h * plane.h, minH),
  };
}

/**
 * Smallest viewport span (px, per axis) a hit box must show to count as
 * reachable. A sliver of the painted edge — e.g. the ~3px a tall window
 * leaves of a cropped target — is technically clickable but effectively
 * undiscoverable, so the target routes to the fallback list instead.
 * Boxes narrower/shorter than the floor need their full extent visible.
 */
export const MIN_VISIBLE_SPAN_PX = 24;

export function isTargetReachable(
  layout: TargetLayout,
  viewport: ViewportSize,
  minW = 0,
  minH = 0,
): boolean {
  const rect = targetViewportRect(layout, viewport, minW, minH);
  const visibleW = Math.min(rect.right, viewport.w) - Math.max(rect.left, 0);
  const visibleH = Math.min(rect.bottom, viewport.h) - Math.max(rect.top, 0);
  return (
    visibleW >= Math.min(MIN_VISIBLE_SPAN_PX, rect.right - rect.left) &&
    visibleH >= Math.min(MIN_VISIBLE_SPAN_PX, rect.bottom - rect.top)
  );
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
