import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

type PagePins = Record<string, Element | undefined>;

const PIN = "pin-probe-test";

function registerPin(node: Element, pin = PIN): void {
  const registry = ((
    globalThis as typeof globalThis & { __lyraImageEvidencePins?: PagePins }
  ).__lyraImageEvidencePins ??= {});
  registry[pin] = node;
}

describe("probeScrollGeometryDom — the actual serialized WDIO page script", () => {
  const expectedSrc = (assetPath: string) =>
    new URL(assetPath, document.baseURI).href;

  beforeEach(() => {
    delete (
      globalThis as typeof globalThis & { __lyraImageEvidencePins?: PagePins }
    ).__lyraImageEvidencePins;
  });

  afterEach(() => {
    delete (
      globalThis as typeof globalThis & { __lyraImageEvidencePins?: PagePins }
    ).__lyraImageEvidencePins;
  });

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
    expect(probe?.imageBinding).toEqual({ status: "unbound" });
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

  it("binds a container crop target to the exact pinned image node inside it", () => {
    // The acquisition popup crops `.visual` (a wrapper) but must prove the
    // geometry belongs to the <img> the source proof decoded.
    document.body.innerHTML = `
      <div class="acquisition-card">
        <div class="visual"><img class="evidence-image" src="/assets/evidence/cctv.png"></div>
      </div>
    `;
    const visual = document.querySelector(".acquisition-card .visual");
    const image = document.querySelector(".evidence-image");
    if (!visual || !image) throw new Error("fixture missing nodes");
    registerPin(image);
    setRect(visual, { left: 20, top: 30, width: 240, height: 180 });
    setRect(image, { left: 60, top: 60, width: 100, height: 80 });
    const src = expectedSrc("/assets/evidence/cctv.png");
    const probe = probeScrollGeometryDom(
      ".acquisition-card .visual",
      false,
      "img.evidence-image",
      src,
      PIN,
    );
    expect(probe?.rect).toEqual({ left: 20, top: 30, width: 240, height: 180 });
    // The pinned image's own rect is reported separately: the crop must prove
    // the image, not the wrapper that happens to contain it.
    expect(probe?.imageRect).toEqual({
      left: 60,
      top: 60,
      width: 100,
      height: 80,
    });
    expect(probe?.imageBinding).toEqual({ status: "bound", src, pin: PIN });
  });

  it("measures the pinned node, not a same-selector stale sibling that comes first", () => {
    document.body.innerHTML = `
      <img class="record-image" src="/assets/evidence/stale.png">
      <img class="record-image" src="/assets/evidence/expected.png">
    `;
    const stale = document.querySelector(".record-image");
    const expected = document.querySelectorAll(".record-image")[1];
    if (!stale || !expected) throw new Error("fixture missing images");
    registerPin(expected);
    setRect(stale, { left: 0, top: 0, width: 10, height: 10 });
    setRect(expected, { left: 10, top: 20, width: 300, height: 200 });
    const src = expectedSrc("/assets/evidence/expected.png");
    const probe = probeScrollGeometryDom(
      ".record-image",
      false,
      ".record-image",
      src,
      PIN,
    );
    expect(probe?.rect).toEqual({ left: 10, top: 20, width: 300, height: 200 });
    expect(probe?.imageRect).toEqual({
      left: 10,
      top: 20,
      width: 300,
      height: 200,
    });
    expect(probe?.imageBinding).toEqual({ status: "bound", src, pin: PIN });
  });

  it("reports detached when the pinned node is replaced by an equal-URL node", () => {
    // The same-URL replacement has the same URL and even the same rect, but
    // it is a different DOM node with no pin — it can never stand in.
    document.body.innerHTML = `<img class="record-image" src="/assets/evidence/expected.png">`;
    const ready = document.querySelector(".record-image");
    if (!ready) throw new Error("fixture missing image");
    registerPin(ready);
    setRect(ready, { left: 10, top: 20, width: 300, height: 200 });
    ready.remove();
    const replacement = document.createElement("img");
    replacement.className = "record-image";
    replacement.src = "/assets/evidence/expected.png";
    document.body.appendChild(replacement);
    setRect(replacement, { left: 10, top: 20, width: 300, height: 200 });
    const probe = probeScrollGeometryDom(
      ".record-image",
      false,
      ".record-image",
      expectedSrc("/assets/evidence/expected.png"),
      PIN,
    );
    expect(probe?.imageRect).toBeNull();
    expect(probe?.imageBinding).toEqual({ status: "detached", pin: PIN });
  });

  it("reports stale when the pinned node stops matching the image selector", () => {
    document.body.innerHTML = `
      <div class="visual"><img class="evidence-image" src="/assets/evidence/cctv.png"></div>
    `;
    const image = document.querySelector(".evidence-image");
    if (!image) throw new Error("fixture missing image");
    registerPin(image);
    image.className = "no-longer-the-evidence-image";
    const probe = probeScrollGeometryDom(
      ".visual",
      false,
      "img.evidence-image",
      expectedSrc("/assets/evidence/cctv.png"),
      PIN,
    );
    expect(probe?.imageRect).toBeNull();
    expect(probe?.imageBinding).toEqual({ status: "stale", pin: PIN });
  });

  it("reports missing when the pin token is unknown to the page registry", () => {
    document.body.innerHTML = `<img class="record-image" src="/assets/evidence/expected.png">`;
    const probe = probeScrollGeometryDom(
      ".record-image",
      false,
      ".record-image",
      expectedSrc("/assets/evidence/expected.png"),
      PIN,
    );
    expect(probe?.imageRect).toBeNull();
    expect(probe?.imageBinding).toEqual({ status: "missing", pin: PIN });
  });

  it("reports stale for a pinned path-suffix impostor (never a lookalike pass)", () => {
    document.body.innerHTML = `
      <img class="record-image" src="/assets/evidence/expected.png.backup">
    `;
    const image = document.querySelector(".record-image");
    if (!image) throw new Error("fixture missing image");
    registerPin(image);
    setRect(image, { left: 10, top: 20, width: 300, height: 200 });
    const probe = probeScrollGeometryDom(
      ".record-image",
      false,
      ".record-image",
      expectedSrc("/assets/evidence/expected.png"),
      PIN,
    );
    expect(probe?.imageRect).toBeNull();
    expect(probe?.imageBinding).toEqual({ status: "stale", pin: PIN });
  });

  it("reports ambiguous when two nodes carry the exact same URL", () => {
    document.body.innerHTML = `
      <img class="record-image" src="/assets/evidence/expected.png">
      <img class="record-image" src="/assets/evidence/expected.png">
    `;
    const first = document.querySelector(".record-image");
    if (!first) throw new Error("fixture missing image");
    registerPin(first);
    const probe = probeScrollGeometryDom(
      ".record-image",
      false,
      ".record-image",
      expectedSrc("/assets/evidence/expected.png"),
      PIN,
    );
    expect(probe?.imageRect).toBeNull();
    expect(probe?.imageBinding).toEqual({ status: "ambiguous", count: 2 });
  });

  it("reports ambiguous when several crop-container selectors match", () => {
    document.body.innerHTML = `
      <div class="visual"></div>
      <div class="visual"><img class="evidence-image" src="/assets/evidence/cctv.png"></div>
    `;
    const image = document.querySelector(".evidence-image");
    if (!image) throw new Error("fixture missing image");
    registerPin(image);
    const probe = probeScrollGeometryDom(
      ".visual",
      false,
      "img.evidence-image",
      expectedSrc("/assets/evidence/cctv.png"),
      PIN,
    );
    expect(probe?.imageRect).toBeNull();
    expect(probe?.imageBinding).toEqual({ status: "ambiguous", count: 2 });
  });

  it("reports outside-target when the pinned image is not inside the crop target", () => {
    document.body.innerHTML = `
      <div class="visual"><img class="other-image" src="/assets/evidence/other.png"></div>
      <img class="evidence-image" src="/assets/evidence/cctv.png">
    `;
    const visual = document.querySelector(".visual");
    const image = document.querySelector(".evidence-image");
    if (!visual || !image) throw new Error("fixture missing nodes");
    registerPin(image);
    setRect(visual, { left: 20, top: 30, width: 240, height: 180 });
    const src = expectedSrc("/assets/evidence/cctv.png");
    const probe = probeScrollGeometryDom(
      ".visual",
      false,
      "img.evidence-image",
      src,
      PIN,
    );
    expect(probe?.imageBinding).toEqual({ status: "outside-target", src });
  });

  it("stays unbound when WebDriver round-trips omitted identity params as null", () => {
    // WebDriver serializes browser.execute(fn, sel, false, undefined,
    // undefined, undefined) as [sel, false, null, null, null]; only callers
    // that bind a crop to an inspected node pass the extra arguments.
    document.body.innerHTML = `
      <div class="acquisition-card">
        <div class="visual"><img class="evidence-image" src="/assets/evidence/cctv.png"></div>
      </div>
    `;
    const visual = document.querySelector(".acquisition-card .visual");
    if (!visual) throw new Error("fixture missing visual wrapper");
    setRect(visual, { left: 20, top: 30, width: 240, height: 180 });
    const [selector, scrollIntoView, imageSelector, expectedImageSrc, pin] =
      JSON.parse(
        JSON.stringify([
          ".acquisition-card .visual",
          false,
          undefined,
          undefined,
          undefined,
        ]),
      ) as [string, boolean, string | null, string | null, string | null];
    expect(pin).toBeNull();
    const probe = probeScrollGeometryDom(
      selector,
      scrollIntoView,
      imageSelector,
      expectedImageSrc,
      pin,
    );
    expect(probe?.rect).toEqual({ left: 20, top: 30, width: 240, height: 180 });
    expect(probe?.imageBinding).toEqual({ status: "unbound" });
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
