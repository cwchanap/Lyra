import { afterEach, describe, expect, it, vi } from "vitest";
import type { Options } from "html-to-image/lib/types";
import * as thumbnailCaptureModule from "./thumbnail-capture";

const mocks = vi.hoisted(() => ({
  toBlob: vi.fn(),
  toSvg: vi.fn(),
}));

vi.mock("html-to-image", () => ({
  toBlob: mocks.toBlob,
  toSvg: mocks.toSvg,
}));

import {
  createPackagedCaptureProofCapture,
  createHtmlToImageGameplayCapture,
  drawLoadedSvgPasses,
  fitWithoutUpscaling,
  normalizeGameplayCaptureSvg,
  pinThumbnailCaptureDeadline,
  rasterizeSvgToPngBlob,
  thumbnailCaptureDeadline,
  WEBKIT_SVG_DRAW_INTERVAL_MS,
  WEBKIT_SVG_DRAW_PASSES,
  waitForAnimationFrameOrTimeout,
} from "./thumbnail-capture";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.toBlob.mockReset();
  mocks.toSvg.mockReset();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "fonts");
});

describe("thumbnail capture deadline", () => {
  it("pins timeoutMs once at receipt", () => {
    const request = { ticket: "ticket-1", timeoutMs: 725 };

    pinThumbnailCaptureDeadline(request, 100);

    expect(thumbnailCaptureDeadline(request)).toBe(825);
  });

  it("pins an unregistered request on first observation without resetting it", () => {
    const request = { ticket: "ticket-2", timeoutMs: 725 };
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(999);

    expect(thumbnailCaptureDeadline(request)).toBe(825);
    expect(thumbnailCaptureDeadline(request)).toBe(825);
  });

  it("never extends or shortens an already pinned request", () => {
    const request = { ticket: "ticket-3", timeoutMs: 725 };

    pinThumbnailCaptureDeadline(request, 100);
    pinThumbnailCaptureDeadline(request, 10_000);
    expect(thumbnailCaptureDeadline(request)).toBe(825);

    pinThumbnailCaptureDeadline(request, -10_000);
    expect(thumbnailCaptureDeadline(request)).toBe(825);
  });
});

describe("gameplay capture SVG layout normalization", () => {
  it("reanchors fixed gameplay images inside the capture viewport without changing unrelated layers", () => {
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width: 800px; height: 600px;">
            <div class="shell" style="position: relative;">
              <div
                class="atmosphere"
                data-save-thumbnail-layout="atmosphere"
                style="position: fixed; z-index: 0;"
              >
                <div
                  class="wash"
                  data-save-thumbnail-atmosphere-wash=""
                  style="opacity: 1;"
                ></div>
              </div>
              <main data-save-thumbnail-layout="main" style="position: relative; z-index: 2;">
                <div data-save-thumbnail-layout="backdrop" style="position: relative;">
                  <img
                    class="background-image"
                    src="data:image/png;base64,background"
                    style="position: fixed; inset: 0; z-index: -1;"
                  />
                </div>
                <div class="portrait-shell">
                  <img
                    class="portrait"
                    src="data:image/png;base64,portrait"
                    style="position: fixed; right: 0; bottom: 0; z-index: 20;"
                  />
                </div>
                <button style="position: fixed; z-index: 30;">advance</button>
              </main>
            </div>
          </div>
        </foreignObject>
      </svg>
    `;
    const normalized = normalizeGameplayCaptureSvg(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,
    );
    const document = new DOMParser().parseFromString(
      decodeURIComponent(normalized.split(",", 2)[1] ?? ""),
      "image/svg+xml",
    );
    const captureRoot = document.querySelector("foreignObject > *");
    const atmosphere = document.querySelector(".atmosphere");
    const atmosphereWash = document.querySelector(".wash");
    const main = document.querySelector('[data-save-thumbnail-layout="main"]');
    const backdrop = document.querySelector(
      '[data-save-thumbnail-layout="backdrop"]',
    );
    const background = document.querySelector("img.background-image");
    const portrait = document.querySelector("img.portrait");
    const button = document.querySelector("button");

    expect((captureRoot as HTMLElement).style.position).toBe("relative");
    expect((atmosphere as HTMLElement).style.position).toBe("absolute");
    expect((atmosphere as HTMLElement).style.zIndex).toBe("0");
    expect((atmosphereWash as HTMLElement).style.opacity).toBe("0.45");
    expect((main as HTMLElement).style.position).toBe("static");
    expect((backdrop as HTMLElement).style.position).toBe("static");
    expect((background as HTMLElement).style.position).toBe("absolute");
    expect((background as HTMLElement).style.zIndex).toBe("1");
    expect(background?.getAttribute("src")).toBe(
      "data:image/png;base64,background",
    );
    expect((portrait as HTMLElement).style.position).toBe("absolute");
    expect((portrait as HTMLElement).style.zIndex).toBe("20");
    expect(portrait?.getAttribute("src")).toBe(
      "data:image/png;base64,portrait",
    );
    expect((button as HTMLElement).style.position).toBe("fixed");
    expect((button as HTMLElement).style.zIndex).toBe("30");
  });

  it("rejects malformed SVG data instead of silently capturing a partial frame", () => {
    expect(() =>
      normalizeGameplayCaptureSvg(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg>")}`,
      ),
    ).toThrow("Gameplay capture SVG could not be parsed");
  });

  it("uses three bounded data-URL draw passes for the two authored image layers", () => {
    expect(WEBKIT_SVG_DRAW_PASSES).toBe(3);
    expect(WEBKIT_SVG_DRAW_INTERVAL_MS).toBe(100);
  });

  it("splits one normalized clone into under-portrait and dialogue-overlay SVG layers", () => {
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml">
            <div class="atmosphere">wash</div>
            <header>case hud</header>
            <main>
              <div class="scene-ui">scene stamp</div>
              <div
                class="dialogue-over"
                data-save-thumbnail-layer="over-portrait"
              >dialogue</div>
            </main>
          </div>
        </foreignObject>
      </svg>
    `;
    const normalized = normalizeGameplayCaptureSvg(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,
    );
    const split = (
      thumbnailCaptureModule as unknown as {
        splitGameplayCaptureSvgLayers?: (svgUrl: string) => {
          underPortraitSvgUrl: string;
          overPortraitSvgUrl: string;
        };
      }
    ).splitGameplayCaptureSvgLayers?.(normalized);
    const markup = (value: string | undefined) =>
      value ? decodeURIComponent(value.split(",", 2)[1] ?? "") : "";

    expect(markup(split?.underPortraitSvgUrl)).toContain("atmosphere");
    expect(markup(split?.underPortraitSvgUrl)).toContain("case hud");
    expect(markup(split?.underPortraitSvgUrl)).not.toContain("dialogue-over");
    expect(markup(split?.overPortraitSvgUrl)).toContain("dialogue-over");
    expect(markup(split?.overPortraitSvgUrl)).not.toContain("atmosphere");
    expect(markup(split?.overPortraitSvgUrl)).not.toContain("case hud");
    expect(markup(split?.overPortraitSvgUrl)).not.toContain("scene-ui");
  });
});

describe("gameplay capture SVG repeated draw workaround", () => {
  it("draws immediately, then twice more at the bounded interval", async () => {
    vi.useFakeTimers();
    const drawPass = vi.fn();
    const pending = drawLoadedSvgPasses(
      drawPass,
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, WEBKIT_SVG_DRAW_INTERVAL_MS);
        }),
    );

    expect(drawPass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(WEBKIT_SVG_DRAW_INTERVAL_MS - 1);
    expect(drawPass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(drawPass).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(WEBKIT_SVG_DRAW_INTERVAL_MS);
    await pending;

    expect(drawPass).toHaveBeenCalledTimes(WEBKIT_SVG_DRAW_PASSES);
  });
});

describe("direct gameplay asset composition geometry", () => {
  const geometry = thumbnailCaptureModule as unknown as {
    coverSourceRect?: (
      sourceWidth: number,
      sourceHeight: number,
      destinationWidth: number,
      destinationHeight: number,
    ) => { x: number; y: number; width: number; height: number };
    containDestinationRect?: (
      sourceWidth: number,
      sourceHeight: number,
      bounds: { x: number; y: number; width: number; height: number },
    ) => { x: number; y: number; width: number; height: number };
    mapBoundsToCanvas?: (
      bounds: { x: number; y: number; width: number; height: number },
      rootBounds: { x: number; y: number; width: number; height: number },
      canvasWidth: number,
      canvasHeight: number,
    ) => { x: number; y: number; width: number; height: number };
  };

  it("center-crops a wide background to a square cover destination", () => {
    expect(geometry.coverSourceRect?.(1_600, 900, 400, 400)).toEqual({
      x: 350,
      y: 0,
      width: 900,
      height: 900,
    });
  });

  it("centers a portrait inside its destination bounds without cropping", () => {
    expect(
      geometry.containDestinationRect?.(800, 1_200, {
        x: 0,
        y: 0,
        width: 300,
        height: 300,
      }),
    ).toEqual({
      x: 50,
      y: 0,
      width: 200,
      height: 300,
    });
  });

  it("maps live viewport bounds into fitted thumbnail coordinates", () => {
    expect(
      geometry.mapBoundsToCanvas?.(
        { x: 300, y: 200, width: 200, height: 300 },
        { x: 100, y: 50, width: 800, height: 600 },
        480,
        360,
      ),
    ).toEqual({
      x: 120,
      y: 90,
      width: 120,
      height: 180,
    });
  });
});

describe("direct gameplay asset draw order", () => {
  it("clears once and preserves background, under-UI, portrait, over-UI stacking", () => {
    const background = document.createElement("img");
    const portrait = document.createElement("img");
    const underUi = document.createElement("img");
    const overUi = document.createElement("img");
    const events: Array<string> = [];
    const contextState = {
      globalAlpha: 1,
      clearRect: () => events.push("clear"),
      drawImage(image: CanvasImageSource) {
        const label =
          image === background
            ? "background"
            : image === portrait
              ? "portrait"
              : image === underUi
                ? "under-ui"
                : "over-ui";
        events.push(`${label}:${contextState.globalAlpha}`);
      },
    };
    const context = contextState as unknown as CanvasRenderingContext2D;
    const drawComposite = (
      thumbnailCaptureModule as unknown as {
        drawGameplayLayeredCompositePass?: (
          context: CanvasRenderingContext2D,
          underUi: CanvasImageSource,
          overUi: CanvasImageSource,
          assets: Array<{
            image: HTMLImageElement;
            opacity: number;
            role: "background" | "portrait";
            source: { x: number; y: number; width: number; height: number };
            destination: {
              x: number;
              y: number;
              width: number;
              height: number;
            };
          }>,
          width: number,
          height: number,
        ) => void;
      }
    ).drawGameplayLayeredCompositePass;

    drawComposite?.(
      context,
      underUi,
      overUi,
      [
        {
          image: portrait,
          opacity: 1,
          role: "portrait",
          source: { x: 0, y: 0, width: 768, height: 1_024 },
          destination: { x: 276, y: 68, width: 204, height: 273 },
        },
        {
          image: background,
          opacity: 0.52,
          role: "background",
          source: { x: 200, y: 0, width: 1_520, height: 1_080 },
          destination: { x: 0, y: 0, width: 480, height: 341 },
        },
      ],
      480,
      341,
    );

    expect(events).toEqual([
      "clear",
      "background:0.52",
      "under-ui:1",
      "portrait:1",
      "over-ui:1",
    ]);
  });
});

describe("fitWithoutUpscaling", () => {
  it.each([
    {
      label: "landscape",
      source: [800, 600] as const,
      expected: { width: 480, height: 360, scale: 0.6 },
    },
    {
      label: "portrait",
      source: [600, 800] as const,
      expected: { width: 270, height: 360, scale: 0.45 },
    },
    {
      label: "exact bounds",
      source: [480, 360] as const,
      expected: { width: 480, height: 360, scale: 1 },
    },
    {
      label: "tiny input",
      source: [12, 7] as const,
      expected: { width: 12, height: 7, scale: 1 },
    },
    {
      label: "non-integer ratio",
      source: [997, 313] as const,
      expected: {
        width: 480,
        height: 151,
        scale: 480 / 997,
      },
    },
  ])(
    "fits $label uniformly without crop, padding, stretch, or upscaling",
    ({ source, expected }) => {
      const result = fitWithoutUpscaling(source[0], source[1]);

      expect(result).toEqual(expected);
      expect(result.scale).toBeLessThanOrEqual(1);
      expect(result.width).toBeLessThanOrEqual(480);
      expect(result.height).toBeLessThanOrEqual(360);
      expect(result.width).toBe(
        Math.max(1, Math.round(source[0] * result.scale)),
      );
      expect(result.height).toBe(
        Math.max(1, Math.round(source[1] * result.scale)),
      );
    },
  );
});

describe("WebKit-compatible SVG rasterization", () => {
  it("invokes the default animation-frame scheduler with window as receiver", async () => {
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(function (
        this: Window,
        callback: FrameRequestCallback,
      ) {
        if (this !== window) {
          throw new TypeError("Illegal invocation");
        }
        callback(0);
        return 7;
      });

    await expect(waitForAnimationFrameOrTimeout()).resolves.toBe("frame");
    expect(requestFrame).toHaveBeenCalledOnce();
  });

  it("falls back to a bounded timer when requestAnimationFrame is throttled", async () => {
    vi.useFakeTimers();
    const cancelFrame = vi.fn();
    const pending = waitForAnimationFrameOrTimeout(
      {
        requestFrame: vi.fn(() => 42),
        cancelFrame,
      },
      50,
    );

    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toBe("timeout");
    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("draws direct assets between split UI layers without awaiting a stuck decode", async () => {
    const underUi = document.createElement("img");
    const overUi = document.createElement("img");
    const background = document.createElement("img");
    const portrait = document.createElement("img");
    const decode = vi.fn(() => new Promise<void>(() => {}));
    for (const image of [underUi, overUi]) {
      Object.defineProperty(image, "decode", {
        configurable: true,
        value: decode,
      });
    }
    const uiImages = [underUi, overUi];
    const createImage = vi.fn(() => {
      const image = uiImages.shift();
      if (!image) throw new Error("unexpected UI image request");
      queueMicrotask(() => image.onload?.(new Event("load")));
      return image;
    });
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(context);
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], {
      type: "image/png",
    });
    vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(png));
    const settleDelay = vi.fn().mockResolvedValue(undefined);
    const settleFrame = vi.fn().mockResolvedValue("frame" as const);

    const rasterizeWithAssets = rasterizeSvgToPngBlob as unknown as (
      svgUrls: {
        underPortraitSvgUrl: string;
        overPortraitSvgUrl: string;
      },
      options: Options,
      environment: {
        createImage: () => HTMLImageElement;
        createCanvas: () => HTMLCanvasElement;
        settleDelay: () => Promise<void>;
        settleFrame: () => Promise<"frame" | "timeout">;
      },
      assets: Array<{
        image: HTMLImageElement;
        opacity: number;
        role: "background" | "portrait";
        source: { x: number; y: number; width: number; height: number };
        destination: { x: number; y: number; width: number; height: number };
      }>,
    ) => Promise<Blob | null>;
    const result = await rasterizeWithAssets(
      {
        underPortraitSvgUrl: "data:image/svg+xml,under",
        overPortraitSvgUrl: "data:image/svg+xml,over",
      },
      {
        width: 800,
        height: 600,
        canvasWidth: 480,
        canvasHeight: 360,
        pixelRatio: 1,
        type: "image/png",
      },
      {
        createImage,
        createCanvas: () => canvas,
        settleDelay,
        settleFrame,
      },
      [
        {
          image: background,
          opacity: 0.52,
          role: "background",
          source: { x: 200, y: 0, width: 1_520, height: 1_080 },
          destination: { x: 0, y: 0, width: 480, height: 360 },
        },
        {
          image: portrait,
          opacity: 1,
          role: "portrait",
          source: { x: 0, y: 0, width: 768, height: 1_024 },
          destination: { x: 276, y: 68, width: 204, height: 273 },
        },
      ],
    );

    expect(result).toBe(png);
    expect(createImage).toHaveBeenCalledTimes(2);
    expect(underUi.src).toContain("data:image/svg+xml,under");
    expect(overUi.src).toContain("data:image/svg+xml,over");
    for (const image of [underUi, overUi]) {
      expect(image.getAttribute("crossorigin")).toBeNull();
      expect(image.decoding).toBe("sync");
      expect(image.loading).toBe("eager");
    }
    expect(settleDelay).toHaveBeenCalledTimes(2);
    expect(settleFrame).toHaveBeenCalledOnce();
    expect(decode).not.toHaveBeenCalled();
    expect(canvas.width).toBe(480);
    expect(canvas.height).toBe(360);
    expect(context.clearRect).toHaveBeenCalledTimes(3);
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 480, 360);
    expect(context.drawImage).toHaveBeenCalledTimes(12);
    expect(
      (context.drawImage as ReturnType<typeof vi.fn>).mock.calls.map(
        ([drawn]) => drawn,
      ),
    ).toEqual([
      background,
      underUi,
      portrait,
      overUi,
      background,
      underUi,
      portrait,
      overUi,
      background,
      underUi,
      portrait,
      overUi,
    ]);
    expect(context.drawImage).toHaveBeenLastCalledWith(overUi, 0, 0, 480, 360);
  });

  it("rejects when the capture canvas has no 2D context", async () => {
    const uiImages = [
      document.createElement("img"),
      document.createElement("img"),
    ];
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(null);

    await expect(
      rasterizeSvgToPngBlob(
        {
          underPortraitSvgUrl: "data:image/svg+xml,under",
          overPortraitSvgUrl: "data:image/svg+xml,over",
        },
        {
          width: 800,
          height: 600,
          canvasWidth: 480,
          canvasHeight: 360,
          pixelRatio: 1,
          type: "image/png",
        },
        {
          createImage: () => {
            const image = uiImages.shift();
            if (!image) throw new Error("unexpected UI image request");
            queueMicrotask(() => image.onload?.(new Event("load")));
            return image;
          },
          createCanvas: () => canvas,
          settleDelay: vi.fn().mockResolvedValue(undefined),
          settleFrame: vi.fn().mockResolvedValue("frame"),
        },
      ),
    ).rejects.toThrow("canvas is unavailable");
  });
});

function captureRoot(width = 800, height = 600): HTMLDivElement {
  const root = document.createElement("div");
  root.setAttribute("data-save-thumbnail-root", "");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  document.body.append(root);
  return root;
}

function loadedImage(
  attributes: Record<string, string> = {},
): HTMLImageElement {
  const image = document.createElement("img");
  image.src = "/asset.png";
  for (const [name, value] of Object.entries(attributes)) {
    image.setAttribute(name, value);
  }
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 64 },
    naturalHeight: { configurable: true, value: 64 },
    decode: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
  });
  return image;
}

function installFontsReady(ready: Promise<unknown> = Promise.resolve()): void {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready },
  });
}

describe("html-to-image gameplay capture", () => {
  it("waits for fonts and images, filters the cloned tree, and returns fitted PNG bytes", async () => {
    const root = captureRoot();
    const ordinary = loadedImage();
    const leaving = loadedImage({
      "data-save-crossfade-layer": "",
      "data-save-crossfade-request": "2",
      "data-save-crossfade-order": "1",
      "data-save-crossfade-state": "leaving",
    });
    const winner = loadedImage({
      "data-save-crossfade-layer": "",
      "data-save-crossfade-request": "2",
      "data-save-crossfade-order": "2",
      "data-save-crossfade-state": "visible",
    });
    const excluded = document.createElement("aside");
    excluded.setAttribute("data-save-thumbnail-exclude", "");
    const excludedChild = document.createElement("span");
    const excludedText = document.createTextNode("excluded");
    excluded.append(excludedChild, excludedText);
    const ordinaryText = document.createTextNode("ordinary");
    const fragment = document.createDocumentFragment();
    fragment.append(document.createTextNode("fragment"));
    const decorativeCanvas = document.createElement("canvas");
    decorativeCanvas.setAttribute("data-save-thumbnail-exclude", "");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const svgText = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    const svgTextNode = document.createTextNode("svg");
    svgText.append(svgTextNode);
    svg.append(svgText);
    root.append(
      ordinary,
      leaving,
      winner,
      excluded,
      ordinaryText,
      decorativeCanvas,
      svg,
    );

    let resolveFonts!: () => void;
    installFontsReady(
      new Promise<void>((resolve) => {
        resolveFonts = resolve;
      }),
    );
    mocks.toBlob.mockResolvedValue(
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
    );
    const request = { ticket: "capture-1", timeoutMs: 725 };
    pinThumbnailCaptureDeadline(request, 100);
    const capture = createHtmlToImageGameplayCapture({
      root: () => root,
      now: () => 100,
    });

    const pending = capture.capture(request);
    await Promise.resolve();
    expect(mocks.toBlob).not.toHaveBeenCalled();
    resolveFonts();
    const result = await pending;

    expect(result).toEqual({
      type: "available",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    expect(ordinary.decode).toHaveBeenCalledOnce();
    expect(leaving.decode).toHaveBeenCalledOnce();
    expect(winner.decode).toHaveBeenCalledOnce();
    expect(mocks.toBlob).toHaveBeenCalledOnce();

    const [capturedRoot, options] = mocks.toBlob.mock.calls[0] as [
      HTMLElement,
      Options,
    ];
    expect(capturedRoot).toBe(root);
    expect(options).toMatchObject({
      width: 800,
      height: 600,
      canvasWidth: 480,
      canvasHeight: 360,
      pixelRatio: 1,
      skipFonts: false,
    });
    expect(options.filter?.(ordinary)).toBe(true);
    expect(options.filter?.(excluded)).toBe(false);
    expect(options.filter?.(excludedChild)).toBe(false);
    expect(options.filter?.(leaving)).toBe(false);
    expect(options.filter?.(winner)).toBe(true);
    expect(options.filter?.(decorativeCanvas)).toBe(false);
    const filterNode = options.filter as unknown as (node: Node) => boolean;
    expect(filterNode(ordinaryText)).toBe(true);
    expect(filterNode(fragment)).toBe(true);
    expect(filterNode(svg)).toBe(true);
    expect(filterNode(svgText)).toBe(true);
    expect(filterNode(svgTextNode)).toBe(true);
    expect(filterNode(excludedText)).toBe(false);
    expect(options.style).toMatchObject({
      "--save-crossfade-opacity": "1",
      "--save-crossfade-transition": "none",
    });
    expect(root.style.getPropertyValue("--save-crossfade-opacity")).toBe("");
    expect(root.style.getPropertyValue("--save-crossfade-transition")).toBe("");
    expect(winner.style.opacity).toBe("");
    expect(winner.style.transition).toBe("");
  });

  it("excludes marked winner assets from the UI SVG and passes mapped layers to the renderer", async () => {
    const root = captureRoot();
    const backgroundGroup = document.createElement("div");
    const background = loadedImage({
      "data-save-crossfade-layer": "",
      "data-save-crossfade-request": "1",
      "data-save-crossfade-order": "1",
      "data-save-crossfade-state": "visible",
      "data-save-thumbnail-asset-role": "background",
    });
    Object.defineProperties(background, {
      naturalWidth: { configurable: true, value: 1_600 },
      naturalHeight: { configurable: true, value: 900 },
    });
    background.style.opacity = "0";
    background.style.setProperty("--crossfade-visible-opacity", "0.52");
    vi.spyOn(background, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      right: 800,
      bottom: 600,
      left: 0,
      toJSON: () => ({}),
    });
    backgroundGroup.append(background);

    const portraitGroup = document.createElement("div");
    const portrait = loadedImage({
      "data-save-crossfade-layer": "",
      "data-save-crossfade-request": "2",
      "data-save-crossfade-order": "2",
      "data-save-crossfade-state": "visible",
      "data-save-thumbnail-asset-role": "portrait",
    });
    Object.defineProperties(portrait, {
      naturalWidth: { configurable: true, value: 800 },
      naturalHeight: { configurable: true, value: 1_200 },
    });
    portrait.style.opacity = "0";
    portrait.style.setProperty("--crossfade-visible-opacity", "1");
    vi.spyOn(portrait, "getBoundingClientRect").mockReturnValue({
      x: 500,
      y: 0,
      width: 200,
      height: 300,
      top: 0,
      right: 700,
      bottom: 300,
      left: 500,
      toJSON: () => ({}),
    });
    portraitGroup.append(portrait);
    root.append(backgroundGroup, portraitGroup);
    installFontsReady();

    const png = new Blob([new Uint8Array([137, 80, 78, 71])], {
      type: "image/png",
    });
    const renderToBlob = vi.fn(async (..._args: unknown[]) => png);
    const request = { ticket: "capture-direct-assets", timeoutMs: 725 };
    pinThumbnailCaptureDeadline(request, 0);
    const capture = createHtmlToImageGameplayCapture({
      root: () => root,
      now: () => 0,
      renderToBlob,
    });

    await expect(capture.capture(request)).resolves.toMatchObject({
      type: "available",
    });

    const [, options, assets] = renderToBlob.mock.calls[0] ?? [];
    expect((options as Options).filter?.(background)).toBe(false);
    expect((options as Options).filter?.(portrait)).toBe(false);
    expect(assets).toEqual([
      {
        image: background,
        opacity: 0.52,
        role: "background",
        source: { x: 200, y: 0, width: 1_200, height: 900 },
        destination: { x: 0, y: 0, width: 480, height: 360 },
      },
      {
        image: portrait,
        opacity: 1,
        role: "portrait",
        source: { x: 0, y: 0, width: 800, height: 1_200 },
        destination: { x: 300, y: 0, width: 120, height: 180 },
      },
    ]);
  });

  it("returns unavailable when the current crossfade request stays pending until the fixed deadline", async () => {
    vi.useFakeTimers();
    const root = captureRoot();
    root.append(
      loadedImage({
        "data-save-crossfade-layer": "",
        "data-save-crossfade-request": "3",
        "data-save-crossfade-order": "3",
        "data-save-crossfade-state": "pending",
      }),
    );
    installFontsReady();
    const request = { ticket: "capture-pending", timeoutMs: 50 };
    pinThumbnailCaptureDeadline(request, 0);
    const capture = createHtmlToImageGameplayCapture({
      root: () => root,
      now: () => 0,
    });

    const pending = capture.capture(request);
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toEqual({
      type: "unavailable",
      reason: "crossfadeDeadlineExpired",
    });
    expect(mocks.toBlob).not.toHaveBeenCalled();
  });

  it("does not start a phase when the one pinned ticket deadline has expired", async () => {
    const root = captureRoot();
    root.append(loadedImage());
    installFontsReady();
    const request = { ticket: "capture-expired", timeoutMs: 25 };
    pinThumbnailCaptureDeadline(request, 100);
    const capture = createHtmlToImageGameplayCapture({
      root: () => root,
      now: () => 126,
    });

    await expect(capture.capture(request)).resolves.toMatchObject({
      type: "unavailable",
    });
    expect(mocks.toBlob).not.toHaveBeenCalled();
  });

  it("returns unavailable when a currently referenced image cannot decode", async () => {
    const root = captureRoot();
    const image = loadedImage();
    Object.defineProperty(image, "decode", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("decode failed")),
    });
    root.append(image);
    installFontsReady();
    const request = { ticket: "capture-decode", timeoutMs: 725 };
    pinThumbnailCaptureDeadline(request, 0);
    const capture = createHtmlToImageGameplayCapture({
      root: () => root,
      now: () => 0,
    });

    await expect(capture.capture(request)).resolves.toMatchObject({
      type: "unavailable",
    });
    expect(mocks.toBlob).not.toHaveBeenCalled();
  });

  it("returns unavailable when html-to-image cannot produce a blob", async () => {
    const root = captureRoot();
    root.append(loadedImage());
    installFontsReady();
    mocks.toBlob.mockResolvedValue(null);
    const request = { ticket: "capture-null", timeoutMs: 725 };
    pinThumbnailCaptureDeadline(request, 0);
    const capture = createHtmlToImageGameplayCapture({
      root: () => root,
      now: () => 0,
    });

    await expect(capture.capture(request)).resolves.toMatchObject({
      type: "unavailable",
    });
  });

  it("bounds html-to-image itself by the same fixed ticket deadline", async () => {
    vi.useFakeTimers();
    const root = captureRoot();
    root.append(loadedImage());
    installFontsReady();
    mocks.toBlob.mockReturnValue(new Promise(() => {}));
    const request = { ticket: "capture-to-blob-timeout", timeoutMs: 75 };
    pinThumbnailCaptureDeadline(request, 0);
    const capture = createHtmlToImageGameplayCapture({
      root: () => root,
      now: () => 0,
    });

    const pending = capture.capture(request);
    await vi.advanceTimersByTimeAsync(75);

    await expect(pending).resolves.toEqual({
      type: "unavailable",
      reason: "renderDeadlineExpired",
    });
    expect(mocks.toBlob).toHaveBeenCalledOnce();
  });

  it("reports a closed render failure code without leaking exception text", async () => {
    const root = captureRoot();
    root.append(loadedImage());
    installFontsReady();
    const onRenderDiagnostic = vi.fn();
    mocks.toBlob.mockRejectedValue(
      new Error("/Users/private/project failed with secret state"),
    );
    const request = { ticket: "capture-render-failure", timeoutMs: 725 };
    pinThumbnailCaptureDeadline(request, 0);
    const capture = createHtmlToImageGameplayCapture({
      root: () => root,
      now: () => 0,
      onRenderDiagnostic,
    });

    await expect(capture.capture(request)).resolves.toEqual({
      type: "unavailable",
      reason: "renderFailed",
    });
    expect(onRenderDiagnostic).toHaveBeenCalledExactlyOnceWith("genericOther");
    expect(JSON.stringify(onRenderDiagnostic.mock.calls)).not.toContain(
      "/Users/private/project",
    );
    expect(JSON.stringify(onRenderDiagnostic.mock.calls)).not.toContain(
      "secret state",
    );
  });

  it.each([
    {
      label: "a WebKit-style image error event",
      error: new Event("error"),
      expected: "errorEvent",
    },
    {
      label: "a security DOMException",
      error: new DOMException("private details", "SecurityError"),
      expected: "domExceptionSecurity",
    },
  ])(
    "classifies $label into a vetted closed code",
    async ({ error, expected }) => {
      const root = captureRoot();
      root.append(loadedImage());
      installFontsReady();
      const onRenderDiagnostic = vi.fn();
      mocks.toBlob.mockRejectedValue(error);
      const request = { ticket: `capture-${expected}`, timeoutMs: 725 };
      pinThumbnailCaptureDeadline(request, 0);
      const capture = createHtmlToImageGameplayCapture({
        root: () => root,
        now: () => 0,
        onRenderDiagnostic,
      });

      await expect(capture.capture(request)).resolves.toEqual({
        type: "unavailable",
        reason: "renderFailed",
      });
      expect(onRenderDiagnostic).toHaveBeenCalledExactlyOnceWith(expected);
      expect(JSON.stringify(onRenderDiagnostic.mock.calls)).not.toContain(
        "private details",
      );
    },
  );

  it.each([
    {
      message: 'Resource "https://example.invalid/a.png" not found',
      expected: "resourceLoad",
    },
    {
      message: "Provided element is not within a Document",
      expected: "fontEmbed",
    },
    {
      message: "Failed to serialize SVG through XMLSerializer",
      expected: "svgSerialize",
    },
    {
      message: "The source image could not be decoded",
      expected: "foreignObjectLoad",
    },
    {
      message: "drawImage received invalid image data",
      expected: "canvasDraw",
    },
    {
      message: "Canvas toBlob failed",
      expected: "canvasBlob",
    },
    {
      message: "Unsupported CSS rule",
      expected: "unsupportedCss",
    },
    {
      message: "t.closest is not a function",
      expected: "filterNodeType",
    },
  ])(
    "maps an allowlisted render message to $expected",
    async ({ message, expected }) => {
      const root = captureRoot();
      root.append(loadedImage());
      installFontsReady();
      const onRenderDiagnostic = vi.fn();
      mocks.toBlob.mockRejectedValue(new Error(message));
      const request = { ticket: `capture-${expected}`, timeoutMs: 725 };
      pinThumbnailCaptureDeadline(request, 0);
      const capture = createHtmlToImageGameplayCapture({
        root: () => root,
        now: () => 0,
        onRenderDiagnostic,
      });

      await capture.capture(request);

      expect(onRenderDiagnostic).toHaveBeenCalledExactlyOnceWith(expected);
      expect(JSON.stringify(onRenderDiagnostic.mock.calls)).not.toContain(
        "example.invalid",
      );
    },
  );

  it("keeps arbitrary URL and path text in genericOther", async () => {
    const root = captureRoot();
    root.append(loadedImage());
    installFontsReady();
    const onRenderDiagnostic = vi.fn();
    mocks.toBlob.mockRejectedValue(
      new Error(
        "https://secret.example/font/resource.png at /Users/private/canvas",
      ),
    );
    const request = { ticket: "capture-generic-other", timeoutMs: 725 };
    pinThumbnailCaptureDeadline(request, 0);
    const capture = createHtmlToImageGameplayCapture({
      root: () => root,
      now: () => 0,
      onRenderDiagnostic,
    });

    await capture.capture(request);

    expect(onRenderDiagnostic).toHaveBeenCalledExactlyOnceWith("genericOther");
    expect(JSON.stringify(onRenderDiagnostic.mock.calls)).not.toContain(
      "secret.example",
    );
    expect(JSON.stringify(onRenderDiagnostic.mock.calls)).not.toContain(
      "/Users/private",
    );
  });
});

describe("packaged capture proof wrapper", () => {
  it("stores only the closed render diagnostic code", () => {
    const delegate = {
      capture: vi.fn(),
    };
    const proof = createPackagedCaptureProofCapture(
      delegate,
      () => "errorEvent",
    );

    expect(proof.status()).toMatchObject({
      lastRenderDiagnostic: "errorEvent",
    });
    expect(JSON.stringify(proof.status())).not.toContain("message");
    expect(JSON.stringify(proof.status())).not.toContain("path");
  });

  it("counts every capture call and successful result while exposing the most recent outcome", async () => {
    const delegate = {
      capture: vi
        .fn()
        .mockResolvedValueOnce({
          type: "unavailable" as const,
          reason: "renderDeadlineExpired",
        })
        .mockResolvedValueOnce({
          type: "available" as const,
          bytes: new Uint8Array([1, 2, 3]),
        }),
    };
    const proof = createPackagedCaptureProofCapture(delegate);
    const request = { ticket: "proof-status", timeoutMs: 725 };

    expect(proof.status()).toEqual({
      calls: 0,
      available: 0,
      lastClosedReason: "",
      lastRenderDiagnostic: "",
    });

    await proof.capture.capture(request);
    expect(proof.status()).toEqual({
      calls: 1,
      available: 0,
      lastClosedReason: "renderDeadlineExpired",
      lastRenderDiagnostic: "",
    });

    await proof.capture.capture(request);
    expect(proof.status()).toEqual({
      calls: 2,
      available: 1,
      lastClosedReason: "",
      lastRenderDiagnostic: "",
    });

    proof.forceNextUnavailable();
    await proof.capture.capture(request);
    expect(proof.status()).toEqual({
      calls: 3,
      available: 1,
      lastClosedReason: "forcedUnavailable",
      lastRenderDiagnostic: "",
    });
  });

  it("forces exactly the next attempt unavailable and then delegates normally", async () => {
    const delegate = {
      capture: vi.fn().mockResolvedValue({
        type: "available" as const,
        bytes: new Uint8Array([1, 2, 3]),
      }),
    };
    const proof = createPackagedCaptureProofCapture(delegate);
    const request = { ticket: "proof-ticket", timeoutMs: 725 };

    proof.forceNextUnavailable();
    await expect(proof.capture.capture(request)).resolves.toEqual({
      type: "unavailable",
      reason: "Forced unavailable by the packaged capture proof.",
    });
    expect(delegate.capture).not.toHaveBeenCalled();

    await expect(proof.capture.capture(request)).resolves.toEqual({
      type: "available",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(delegate.capture).toHaveBeenCalledOnce();
  });

  it("clears the latest sanitized unavailable reason after a successful capture", async () => {
    const delegate = {
      capture: vi
        .fn()
        .mockResolvedValueOnce({
          type: "unavailable" as const,
          reason: "renderDeadlineExpired",
        })
        .mockResolvedValueOnce({
          type: "available" as const,
          bytes: new Uint8Array([1, 2, 3]),
        }),
    };
    const proof = createPackagedCaptureProofCapture(delegate);
    const request = { ticket: "proof-diagnostic", timeoutMs: 725 };

    await proof.capture.capture(request);
    expect(proof.lastUnavailableReason()).toBe("renderDeadlineExpired");

    await proof.capture.capture(request);
    expect(proof.lastUnavailableReason()).toBe("");
  });

  it("preserves a real adapter phase code through proof delegation", async () => {
    vi.useFakeTimers();
    const root = captureRoot();
    root.append(
      loadedImage({
        "data-save-crossfade-layer": "",
        "data-save-crossfade-request": "3",
        "data-save-crossfade-order": "3",
        "data-save-crossfade-state": "pending",
      }),
    );
    installFontsReady();
    const adapter = createHtmlToImageGameplayCapture({
      root: () => root,
      now: () => 0,
    });
    const proof = createPackagedCaptureProofCapture(adapter);
    const request = { ticket: "proof-real-adapter", timeoutMs: 50 };
    pinThumbnailCaptureDeadline(request, 0);

    const pending = proof.capture.capture(request);
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toEqual({
      type: "unavailable",
      reason: "crossfadeDeadlineExpired",
    });
    expect(proof.lastUnavailableReason()).toBe("crossfadeDeadlineExpired");
  });
});
