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
 * Smallest viewport span (px, per axis) a hit box must keep clear to count
 * as reachable. Matches the project's own usability floor — the packaged
 * E2E contract (MIN_USABLE_TARGET_PX in investigation-layout.e2e.ts) and
 * the hotspot's minimum hit height are both 44px: a target showing less is
 * effectively undiscoverable and routes to the fallback list instead.
 * Boxes narrower/shorter than the floor need their full extent visible.
 */
export const MIN_VISIBLE_SPAN_PX = 44;

/**
 * The parts of `rect` inside `viewport` and clear of `occluded`, as up to
 * four axis-aligned residuals. `occluded` is the fixed fallback panel's
 * painted rect: a target must keep its usable span outside the panel that
 * covers it, not just inside the window, so plain viewport intersection
 * alone can't decide reachability.
 */
export function visibleSpans(
  rect: ViewportRect,
  viewport: ViewportSize,
  occluded: ViewportRect | null = null,
): ViewportRect[] {
  const visible: ViewportRect = {
    left: Math.max(rect.left, 0),
    top: Math.max(rect.top, 0),
    right: Math.min(rect.right, viewport.w),
    bottom: Math.min(rect.bottom, viewport.h),
  };
  if (visible.right <= visible.left || visible.bottom <= visible.top) {
    return [];
  }
  if (!occluded) return [visible];
  const spans: ViewportRect[] = [];
  if (occluded.top > visible.top) {
    spans.push({
      left: visible.left,
      top: visible.top,
      right: visible.right,
      bottom: Math.min(occluded.top, visible.bottom),
    });
  }
  if (occluded.bottom < visible.bottom) {
    spans.push({
      left: visible.left,
      top: Math.max(occluded.bottom, visible.top),
      right: visible.right,
      bottom: visible.bottom,
    });
  }
  const bandTop = Math.max(visible.top, occluded.top);
  const bandBottom = Math.min(visible.bottom, occluded.bottom);
  if (bandBottom > bandTop) {
    if (occluded.left > visible.left) {
      spans.push({
        left: visible.left,
        top: bandTop,
        right: Math.min(occluded.left, visible.right),
        bottom: bandBottom,
      });
    }
    if (occluded.right < visible.right) {
      spans.push({
        left: Math.max(occluded.right, visible.left),
        top: bandTop,
        right: visible.right,
        bottom: bandBottom,
      });
    }
  }
  return spans.filter(
    (span) => span.right > span.left && span.bottom > span.top,
  );
}

export function isTargetReachable(
  layout: TargetLayout,
  viewport: ViewportSize,
  minW = 0,
  minH = 0,
  occluded: ViewportRect | null = null,
): boolean {
  const rect = targetViewportRect(layout, viewport, minW, minH);
  const needW = Math.min(MIN_VISIBLE_SPAN_PX, rect.right - rect.left);
  const needH = Math.min(MIN_VISIBLE_SPAN_PX, rect.bottom - rect.top);
  return visibleSpans(rect, viewport, occluded).some(
    (span) =>
      span.right - span.left >= needW && span.bottom - span.top >= needH,
  );
}

/**
 * The interactive copy a target's focus can move to when routing rerenders
 * it: the same `data-target-id` among plane buttons (skipped while they
 * carry `inert`) or its fallback-panel entry. A witness block resolves to
 * its first topic button.
 */
export function targetCounterpart(
  root: ParentNode,
  targetId: string,
): HTMLElement | null {
  const host = root.querySelector<HTMLElement>(
    `[data-target-id="${CSS.escape(targetId)}"]:not([inert])`,
  );
  if (!host) return null;
  if (host instanceof HTMLButtonElement) return host;
  return host.querySelector("button");
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
