import type { CssRect } from "./screenshot-pixels";

/**
 * Scroll-into-view geometry for the screenshot-crop compositor proof
 * (HPA-831). Elements inside a scrollable container — the Case File
 * submenu's `.game-menu-extra` at 800x600 — are clipped by their
 * scrollport, so the crop must come from the element rect intersected
 * with the scrollport rect, and only after the post-scroll layout has
 * settled: a still-moving rect maps pixels that were never painted
 * together in one frame.
 */

export type ScrollGeometrySample = {
  rect: CssRect;
  /** Nearest y-scrollable ancestor's CSS rect, or null when the element
   * is not inside a scrollport. */
  scrollport: CssRect | null;
};

export type ScrollGeometryProbe = ScrollGeometrySample & {
  viewport: { width: number; height: number };
  devicePixelRatio: number;
};

/**
 * THE serialized WDIO page script — passed verbatim to
 * `browser.execute(probeScrollGeometryDom, selector, scrollIntoView,
 * srcFragment?)`,
 * so it must stay self-contained (parameters + DOM globals only; module
 * scope does not survive WebDriver serialization). Unit tests invoke the
 * identical function against jsdom.
 *
 * Reads the target element's rect plus its nearest y-scrollable ancestor
 * (the scrollport that clips the painted area); `scrollIntoView` scrolls
 * every clipped ancestor synchronously first, matching the pre-extraction
 * inline script byte for byte.
 *
 * When `srcFragment` is passed the target is resolved the same way
 * inspectImageElement resolves it — the matched element must be an
 * <img> whose src contains the fragment — so a crop can never measure a
 * different (e.g. stale or sibling) element than the one inspected.
 */
export function probeScrollGeometryDom(
  selector: string,
  scrollIntoView: boolean,
  srcFragment?: string | null,
): ScrollGeometryProbe | null {
  const element =
    typeof srcFragment !== "string"
      ? document.querySelector(selector)
      : (Array.from(document.querySelectorAll(selector)).find(
          (candidate) =>
            candidate instanceof HTMLImageElement &&
            (candidate.currentSrc || candidate.src).includes(srcFragment),
        ) ?? null);
  if (!element) return null;
  if (scrollIntoView) {
    element.scrollIntoView({ block: "center", inline: "nearest" });
  }
  const rectOf = (candidate: Element) => {
    const r = candidate.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    };
  };
  // The scrollport clips the element's painted area, so the crop must
  // intersect with it (not just the viewport) or it can read pixels the
  // scrollport never paints.
  let scrollport: Element | null = element.parentElement;
  while (scrollport) {
    const style = getComputedStyle(scrollport);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      scrollport.scrollHeight > scrollport.clientHeight + 1
    ) {
      break;
    }
    scrollport = scrollport.parentElement;
  }
  return {
    rect: rectOf(element),
    scrollport: scrollport ? rectOf(scrollport) : null,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    devicePixelRatio: window.devicePixelRatio,
  };
}

function cssRectEqual(a: CssRect | null, b: CssRect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

/** Two consecutive samples carry identical geometry — the only state in
 * which a screenshot crop maps painted pixels rather than a mid-scroll
 * frame. */
export function scrollGeometryEqual(
  a: ScrollGeometrySample,
  b: ScrollGeometrySample,
): boolean {
  return (
    cssRectEqual(a.rect, b.rect) && cssRectEqual(a.scrollport, b.scrollport)
  );
}

/**
 * The settle verdict the bounded wait must reach before the screenshot
 * maps pixels: stable only when the LAST two samples agree. An earlier
 * agreeing pair followed by movement is still unsettled — exhausting the
 * wait without a stable pair must fail (with the sample trail as
 * diagnostics), never crop whatever the last rectangle happened to cover.
 */
export function scrollGeometrySettled(
  samples: readonly ScrollGeometrySample[],
): boolean {
  const last = samples.length - 1;
  return last >= 1 && scrollGeometryEqual(samples[last - 1], samples[last]);
}
