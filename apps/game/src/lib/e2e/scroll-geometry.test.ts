import { describe, expect, it } from "vitest";
import {
  probeScrollGeometryDom,
  scrollGeometryEqual,
  scrollGeometrySettled,
  type ScrollGeometrySample,
} from "./scroll-geometry";

/**
 * These tests run the very function `browser.execute` serializes into the
 * packaged WebKitGTK page (probeScrollGeometryDom) — not a mirrored
 * helper — plus the Node-side settle decisions (scrollGeometryEqual,
 * scrollGeometrySettled) the bounded scroll-into-view wait applies to its
 * output.
 */

// jsdom has no layout: getBoundingClientRect returns zeros and
// scrollIntoView is unimplemented. Feed rects through the prototype and
// stub scrollIntoView — standard jsdom practice (see focus-probe.test.ts).
const RECTS = new WeakMap<Element, Partial<DOMRect>>();
const SCROLLED: Element[] = [];
const ZERO_RECT = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
} as DOMRect;
Element.prototype.getBoundingClientRect = function (this: Element) {
  return { ...ZERO_RECT, ...RECTS.get(this) } as DOMRect;
};
Element.prototype.scrollIntoView = function (this: Element) {
  SCROLLED.push(this);
};

function setRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  RECTS.set(element, {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
  });
}

const sample = (
  rect: { left: number; top: number; width: number; height: number },
  scrollport: ScrollGeometrySample["scrollport"] = null,
): ScrollGeometrySample => ({
  rect: { ...rect },
  scrollport: scrollport === null ? null : { ...scrollport },
});

describe("probeScrollGeometryDom — the actual serialized WDIO page script", () => {
  it("returns null when the selector matches nothing", () => {
    document.body.innerHTML = `<div class="other"></div>`;
    expect(probeScrollGeometryDom(".missing", false)).toBeNull();
  });

  it("reports the element rect, null scrollport, viewport, and dpr", () => {
    document.body.innerHTML = `<img class="record-image">`;
    const image = document.querySelector(".record-image");
    if (!image) throw new Error("fixture missing image");
    setRect(image, { left: 10, top: 20, width: 300, height: 200 });
    const probe = probeScrollGeometryDom(".record-image", false);
    expect(probe?.rect).toEqual({ left: 10, top: 20, width: 300, height: 200 });
    expect(probe?.scrollport).toBeNull();
    expect(probe?.viewport.width).toBe(window.innerWidth);
    expect(probe?.devicePixelRatio).toBe(window.devicePixelRatio);
    expect(SCROLLED).toHaveLength(0);
  });

  it("reports the nearest y-scrollable ancestor as the scrollport", () => {
    document.body.innerHTML = `
      <div class="game-menu-extra"><img class="record-image"></div>
    `;
    const scroller = document.querySelector(".game-menu-extra");
    const image = document.querySelector(".record-image");
    if (!scroller || !image) throw new Error("fixture missing nodes");
    // jsdom reports 0 for scroll metrics: make the ancestor genuinely
    // scrollable so the probe's overflowY + overflow detection selects it.
    (scroller as HTMLElement).style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollHeight", { value: 500 });
    Object.defineProperty(scroller, "clientHeight", { value: 100 });
    setRect(scroller, { left: 0, top: 50, width: 800, height: 500 });
    setRect(image, { left: 10, top: 400, width: 300, height: 200 });
    const probe = probeScrollGeometryDom(".record-image", true);
    expect(SCROLLED).toContain(image);
    expect(probe?.scrollport).toEqual({
      left: 0,
      top: 50,
      width: 800,
      height: 500,
    });
  });

  it("skips an overflowY:auto ancestor that does not actually overflow", () => {
    document.body.innerHTML = `
      <div class="game-menu-extra"><img class="record-image"></div>
    `;
    const scroller = document.querySelector(".game-menu-extra");
    if (!scroller) throw new Error("fixture missing scroller");
    (scroller as HTMLElement).style.overflowY = "auto";
    // scrollHeight <= clientHeight + 1: styled scrollable but not
    // overflowing, so it does not clip and is not the scrollport.
    Object.defineProperty(scroller, "scrollHeight", { value: 100 });
    Object.defineProperty(scroller, "clientHeight", { value: 100 });
    expect(
      probeScrollGeometryDom(".record-image", false)?.scrollport,
    ).toBeNull();
  });
});

describe("scrollGeometryEqual", () => {
  const a = sample({ left: 10, top: 20, width: 300, height: 200 });

  it("is true for identical rect and scrollport", () => {
    expect(scrollGeometryEqual(a, sample(a.rect))).toBe(true);
  });

  it("is false when the rect moved", () => {
    expect(
      scrollGeometryEqual(a, sample({ ...a.rect, top: a.rect.top + 1 })),
    ).toBe(false);
  });

  it("is false when the scrollport changed or appeared", () => {
    const port = { left: 0, top: 50, width: 800, height: 500 };
    expect(scrollGeometryEqual(sample(a.rect, port), sample(a.rect))).toBe(
      false,
    );
    expect(
      scrollGeometryEqual(
        sample(a.rect, port),
        sample(a.rect, { ...port, height: port.height + 1 }),
      ),
    ).toBe(false);
  });
});

describe("scrollGeometrySettled — the bounded wait's verdict", () => {
  const a = sample({ left: 0, top: 0, width: 300, height: 200 });
  const b = sample({ left: 0, top: 40, width: 300, height: 200 });
  const c = sample({ left: 0, top: 80, width: 300, height: 200 });

  it("is unsettled with fewer than two samples", () => {
    expect(scrollGeometrySettled([])).toBe(false);
    expect(scrollGeometrySettled([a])).toBe(false);
  });

  it("settles once the last two samples agree", () => {
    expect(scrollGeometrySettled([a, a])).toBe(true);
    expect(scrollGeometrySettled([a, b, b])).toBe(true);
  });

  it("is unsettled when the element moved after an earlier agreeing pair", () => {
    expect(scrollGeometrySettled([a, a, b])).toBe(false);
  });

  it("reports the never-stabilizes case: six changing samples stay unsettled", () => {
    // The review finding: exhausting the bounded wait used to crop the
    // last rectangle anyway — a still-moving rect is not a usable anchor.
    const moving = Array.from({ length: 6 }, (_, i) =>
      sample({ left: 0, top: i * 40, width: 300, height: 200 }),
    );
    expect(scrollGeometrySettled(moving)).toBe(false);
    // …and a late settle within the same window still passes.
    expect(scrollGeometrySettled([...moving, c, c])).toBe(true);
  });
});
