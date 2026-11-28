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

/**
 * Whether the crop geometry is bound to the EXACT DOM node the source proof
 * inspected. The source script stores that node in a page-owned pin registry
 * (`__lyraImageEvidencePins`, key = a per-inspection token); the probe
 * resolves the token and requires the same live, connected node, still the
 * selector's only match with the exact pinned URL, and inside the crop
 * target. A same-URL replacement node has no pin, so it can never stand in.
 */
export type ImageBinding =
  | { status: "unbound" }
  | { status: "missing"; pin: string }
  | { status: "detached"; pin: string }
  | { status: "stale"; pin: string }
  | { status: "ambiguous"; count: number }
  | { status: "outside-target"; src: string }
  | { status: "bound"; src: string; pin: string };

export type ScrollGeometryProbe = ScrollGeometrySample & {
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  imageBinding: ImageBinding;
};

/**
 * THE serialized WDIO page script — passed verbatim to
 * `browser.execute(probeScrollGeometryDom, selector, scrollIntoView,
 * imageSelector?, expectedImageSrc?, pin?)`,
 * so it must stay self-contained (parameters + DOM globals only; module
 * scope does not survive WebDriver serialization). Unit tests invoke the
 * identical function against jsdom.
 *
 * Reads the target element's rect plus its nearest y-scrollable ancestor
 * (the scrollport that clips the painted area); `scrollIntoView` scrolls
 * every clipped ancestor synchronously first.
 *
 * When `imageSelector`/`expectedImageSrc`/`pin` are passed the probe binds
 * the geometry to the page-pinned node: the token must still resolve to the
 * same live element, that element must be the ONLY selector match carrying
 * the exact expected URL, and it must be (or live inside) the crop target.
 * A stale sibling, a same-URL replacement or a duplicated match is reported
 * as such, never guessed at.
 */
export function probeScrollGeometryDom(
  selector: string,
  scrollIntoView: boolean,
  imageSelector?: string | null,
  expectedImageSrc?: string | null,
  pin?: string | null,
): ScrollGeometryProbe | null {
  const first = document.querySelector(selector);
  if (!first) return null;

  let element: Element = first;
  let imageBinding: ImageBinding = { status: "unbound" };
  if (
    typeof imageSelector === "string" &&
    typeof expectedImageSrc === "string" &&
    typeof pin === "string"
  ) {
    const registry = (
      globalThis as typeof globalThis & {
        __lyraImageEvidencePins?: Record<string, Element | undefined>;
      }
    ).__lyraImageEvidencePins;
    const pinned = registry?.[pin];
    const selectorMatches = Array.from(
      document.querySelectorAll(imageSelector),
    ).filter(
      (candidate): candidate is HTMLImageElement =>
        candidate instanceof HTMLImageElement &&
        (candidate.currentSrc || candidate.src) === expectedImageSrc,
    );
    if (!(pinned instanceof HTMLImageElement)) {
      imageBinding = { status: "missing", pin };
    } else if (!pinned.isConnected) {
      imageBinding = { status: "detached", pin };
    } else if ((pinned.currentSrc || pinned.src) !== expectedImageSrc) {
      imageBinding = { status: "stale", pin };
    } else if (selectorMatches.length > 1) {
      imageBinding = { status: "ambiguous", count: selectorMatches.length };
    } else if (selectorMatches[0] !== pinned) {
      // The selector/URL now resolves to a different node than the pin.
      imageBinding = { status: "stale", pin };
    } else if (first instanceof HTMLImageElement) {
      // Image-selector crop: measure the pinned node, never a same-selector
      // sibling that happens to come first in the DOM.
      element = pinned;
      imageBinding = { status: "bound", src: expectedImageSrc, pin };
    } else {
      const targetMatches = document.querySelectorAll(selector).length;
      if (targetMatches > 1) {
        imageBinding = { status: "ambiguous", count: targetMatches };
      } else if (!first.contains(pinned)) {
        imageBinding = { status: "outside-target", src: expectedImageSrc };
      } else {
        imageBinding = { status: "bound", src: expectedImageSrc, pin };
      }
    }
  }

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
    imageBinding,
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
