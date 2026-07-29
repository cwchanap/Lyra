import { toBlob, toSvg } from "html-to-image";
import "@fontsource-variable/noto-serif-tc/wght.css";
import type {
  GameplayThumbnailCapture,
  ThumbnailCaptureRequestView,
} from "./types";

export const SAVE_THUMBNAIL_MAX_WIDTH = 480;
export const SAVE_THUMBNAIL_MAX_HEIGHT = 360;

const packagedCaptureProofEnabled =
  import.meta.env.VITE_LYRA_E2E_CAPTURE_PROOF === "1";
let lastPackagedRenderDiagnostic: CaptureRenderDiagnosticCode | "" = "";
let lastPackagedFontEmbedDiagnostic: ThumbnailFontEmbedDiagnostic = {
  selectedChunkCount: 0,
  embeddedZhHantCodePointCount: 0,
  cssBytes: 0,
};

const fixedDeadlines = new WeakMap<ThumbnailCaptureRequestView, number>();
type HtmlToImageOptions = NonNullable<Parameters<typeof toBlob>[1]>;
const THUMBNAIL_EMBEDDED_FONT_FAMILY = "Lyra Thumbnail Zh-Hant";
const THUMBNAIL_FONT_SOURCE_FAMILY = "Noto Serif TC Variable";

export type ThumbnailFontFaceSource = Readonly<{
  sourceUrl: string;
  unicodeRange: string;
  fontStyle: string;
  fontWeight: string;
}>;

export type ThumbnailFontEmbedDiagnostic = Readonly<{
  selectedChunkCount: number;
  embeddedZhHantCodePointCount: number;
  cssBytes: number;
}>;

export type ThumbnailFontEmbedResult = ThumbnailFontEmbedDiagnostic &
  Readonly<{
    css: string;
  }>;

export function fitWithoutUpscaling(
  width: number,
  height: number,
): { width: number; height: number; scale: number } {
  const scale = Math.min(
    1,
    SAVE_THUMBNAIL_MAX_WIDTH / width,
    SAVE_THUMBNAIL_MAX_HEIGHT / height,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function isZhHantCaptureCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x303f) ||
    (codePoint >= 0x3100 && codePoint <= 0x312f) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
  );
}

function unicodeRangeTokenBounds(
  token: string,
): readonly [number, number] | null {
  const match = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(token.trim());
  if (!match) return null;
  const startToken = match[1];
  if (!startToken) return null;
  const start = Number.parseInt(startToken.replaceAll("?", "0"), 16);
  const end = match[2]
    ? Number.parseInt(match[2], 16)
    : Number.parseInt(startToken.replaceAll("?", "F"), 16);
  return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : null;
}

function unicodeRangeContains(
  unicodeRange: string,
  codePoint: number,
): boolean {
  return unicodeRange.split(",").some((token) => {
    const bounds = unicodeRangeTokenBounds(token);
    return bounds !== null && codePoint >= bounds[0] && codePoint <= bounds[1];
  });
}

function zhHantCodePoints(text: string): number[] {
  return Array.from(
    new Set(
      Array.from(text)
        .map((character) => character.codePointAt(0))
        .filter(
          (codePoint): codePoint is number =>
            codePoint !== undefined && isZhHantCaptureCodePoint(codePoint),
        ),
    ),
  );
}

function thumbnailFontFaces(document: Document): ThumbnailFontFaceSource[] {
  const faces: ThumbnailFontFaceSource[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin runtime styles (the live Google font stylesheet) are
      // intentionally ignored. The dedicated Fontsource sheet is same-origin.
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const style = (rule as CSSFontFaceRule).style;
      if (
        style.getPropertyValue("font-family").trim().replaceAll(/["']/g, "") !==
        THUMBNAIL_FONT_SOURCE_FAMILY
      ) {
        continue;
      }
      const source = style.getPropertyValue("src");
      const sourceMatch = /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(source);
      const unicodeRange = style.getPropertyValue("unicode-range").trim();
      if (!sourceMatch?.[1] || !unicodeRange) continue;
      faces.push({
        sourceUrl: sourceMatch[1],
        unicodeRange,
        fontStyle: style.getPropertyValue("font-style").trim() || "normal",
        fontWeight: style.getPropertyValue("font-weight").trim() || "200 900",
      });
    }
  }
  return faces;
}

async function loadFontDataUrl(sourceUrl: string): Promise<string> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error("Failed to load embedded thumbnail font.");
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        const result = reader.result;
        if (typeof result === "string") resolve(result);
        else reject(new Error("Failed to encode embedded thumbnail font."));
      },
      { once: true },
    );
    reader.addEventListener(
      "error",
      () => reject(new Error("Failed to encode embedded thumbnail font.")),
      { once: true },
    );
    reader.readAsDataURL(blob);
  });
}

export function createThumbnailFontEmbedder(input: {
  fontFaces: (document: Document) => readonly ThumbnailFontFaceSource[];
  loadFontDataUrl: (sourceUrl: string) => Promise<string>;
}): (root: HTMLElement) => Promise<ThumbnailFontEmbedResult> {
  const dataUrlCache = new Map<string, Promise<string>>();
  const cachedDataUrl = (sourceUrl: string): Promise<string> => {
    const existing = dataUrlCache.get(sourceUrl);
    if (existing) return existing;
    const pending = input.loadFontDataUrl(sourceUrl).catch((error) => {
      dataUrlCache.delete(sourceUrl);
      throw error;
    });
    dataUrlCache.set(sourceUrl, pending);
    return pending;
  };

  return async (root) => {
    const codePoints = zhHantCodePoints(root.textContent ?? "");
    if (codePoints.length === 0) {
      return {
        css: "",
        selectedChunkCount: 0,
        embeddedZhHantCodePointCount: 0,
        cssBytes: 0,
      };
    }

    const selectedFaces = input
      .fontFaces(root.ownerDocument)
      .filter((face) =>
        codePoints.some((codePoint) =>
          unicodeRangeContains(face.unicodeRange, codePoint),
        ),
      );
    const embeddedCodePoints = codePoints.filter((codePoint) =>
      selectedFaces.some((face) =>
        unicodeRangeContains(face.unicodeRange, codePoint),
      ),
    );
    if (embeddedCodePoints.length !== codePoints.length) {
      throw new Error("Embedded thumbnail font does not cover captured text.");
    }

    const rules = await Promise.all(
      selectedFaces.map(async (face) => {
        const dataUrl = await cachedDataUrl(face.sourceUrl);
        return [
          `@font-face { font-family: "${THUMBNAIL_EMBEDDED_FONT_FAMILY}"; font-style: ${face.fontStyle}; font-weight: ${face.fontWeight};`,
          `src: url("${dataUrl}") format("woff2"); unicode-range: ${face.unicodeRange}; }`,
        ].join(" ");
      }),
    );
    const css = rules.join("\n");
    return {
      css,
      selectedChunkCount: selectedFaces.length,
      embeddedZhHantCodePointCount: embeddedCodePoints.length,
      cssBytes: new TextEncoder().encode(css).byteLength,
    };
  };
}

const embedThumbnailFont = createThumbnailFontEmbedder({
  fontFaces: thumbnailFontFaces,
  loadFontDataUrl,
});

export type CaptureRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type GameplayCaptureAssetLayer = Readonly<{
  image: HTMLImageElement;
  opacity: number;
  role: "background" | "portrait";
  source: CaptureRect;
  destination: CaptureRect;
}>;

export type GameplayCaptureSvgLayers = Readonly<{
  underPortraitSvgUrl: string;
  overPortraitSvgUrl: string;
}>;

export function coverSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth: number,
  destinationHeight: number,
): CaptureRect {
  const scale = Math.max(
    destinationWidth / sourceWidth,
    destinationHeight / sourceHeight,
  );
  const width = destinationWidth / scale;
  const height = destinationHeight / scale;
  return {
    x: (sourceWidth - width) / 2,
    y: (sourceHeight - height) / 2,
    width,
    height,
  };
}

export function containDestinationRect(
  sourceWidth: number,
  sourceHeight: number,
  bounds: CaptureRect,
): CaptureRect {
  const scale = Math.min(
    bounds.width / sourceWidth,
    bounds.height / sourceHeight,
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}

export function mapBoundsToCanvas(
  bounds: CaptureRect,
  rootBounds: CaptureRect,
  canvasWidth: number,
  canvasHeight: number,
): CaptureRect {
  const scaleX = canvasWidth / rootBounds.width;
  const scaleY = canvasHeight / rootBounds.height;
  return {
    x: (bounds.x - rootBounds.x) * scaleX,
    y: (bounds.y - rootBounds.y) * scaleY,
    width: bounds.width * scaleX,
    height: bounds.height * scaleY,
  };
}

export function drawGameplayLayeredCompositePass(
  context: CanvasRenderingContext2D,
  underPortraitUi: CanvasImageSource,
  overPortraitUi: CanvasImageSource,
  assets: readonly GameplayCaptureAssetLayer[],
  width: number,
  height: number,
  backgroundColor?: string,
): void {
  context.clearRect(0, 0, width, height);
  if (backgroundColor) {
    context.globalAlpha = 1;
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, width, height);
  }
  const drawAsset = (asset: GameplayCaptureAssetLayer) => {
    context.globalAlpha = asset.opacity;
    context.drawImage(
      asset.image,
      asset.source.x,
      asset.source.y,
      asset.source.width,
      asset.source.height,
      asset.destination.x,
      asset.destination.y,
      asset.destination.width,
      asset.destination.height,
    );
  };
  for (const asset of assets.filter((asset) => asset.role === "background")) {
    drawAsset(asset);
  }
  context.globalAlpha = 1;
  context.drawImage(underPortraitUi, 0, 0, width, height);
  for (const asset of assets.filter((asset) => asset.role === "portrait")) {
    drawAsset(asset);
  }
  context.globalAlpha = 1;
  context.drawImage(overPortraitUi, 0, 0, width, height);
}

type SvgRasterizerEnvironment = Readonly<{
  createImage: () => HTMLImageElement;
  createCanvas: () => HTMLCanvasElement;
  settleDelay: () => Promise<void>;
  settleFrame: () => Promise<"frame" | "timeout">;
}>;

export const WEBKIT_SVG_DRAW_PASSES = 3;
export const WEBKIT_SVG_DRAW_INTERVAL_MS = 100;
const WEBKIT_FRAME_FALLBACK_MS = 50;

export function waitForAnimationFrameOrTimeout(
  scheduler: Readonly<{
    requestFrame: (callback: FrameRequestCallback) => number;
    cancelFrame: (handle: number) => void;
  }> = {
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  },
  timeoutMs = WEBKIT_FRAME_FALLBACK_MS,
): Promise<"frame" | "timeout"> {
  return new Promise((resolve) => {
    let settled = false;
    let frameHandle = 0;
    const timer = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        scheduler.cancelFrame(frameHandle);
        resolve("timeout");
      },
      Math.max(0, timeoutMs),
    );
    frameHandle = scheduler.requestFrame(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve("frame");
    });
  });
}

async function waitBetweenSvgDrawPasses(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, WEBKIT_SVG_DRAW_INTERVAL_MS);
  });
}

export async function drawLoadedSvgPasses(
  drawPass: () => void,
  waitBetweenPasses: () => Promise<void>,
  passCount = WEBKIT_SVG_DRAW_PASSES,
): Promise<void> {
  for (let pass = 0; pass < Math.max(1, passCount); pass += 1) {
    if (pass > 0) await waitBetweenPasses();
    drawPass();
  }
}

function loadSvgImage(
  svgUrl: string,
  createImage: () => HTMLImageElement,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = createImage();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = (error) => {
      cleanup();
      reject(error);
    };
    image.decoding = "sync";
    image.loading = "eager";
    image.src = svgUrl;
  });
}

const SVG_DATA_URL_PREFIX = "data:image/svg+xml;charset=utf-8,";

/**
 * html-to-image serializes each descendant's computed style before wrapping
 * the clone in an SVG foreignObject. Packaged WebKit does not reliably paint
 * fixed-position image descendants there (and a negative-z image can fall
 * behind the foreignObject entirely), even though the same clone's ordinary
 * DOM and gradient layers paint correctly.
 *
 * Re-anchor only the explicitly marked gameplay artwork inside the serialized
 * capture viewport. This edits the detached SVG clone, never the live gameplay
 * DOM, and leaves fixed UI such as the dialogue box untouched.
 */
export function normalizeGameplayCaptureSvg(svgUrl: string): string {
  if (!svgUrl.startsWith(SVG_DATA_URL_PREFIX)) {
    throw new Error("Gameplay capture SVG has an unsupported data URL.");
  }
  const encoded = svgUrl.slice(SVG_DATA_URL_PREFIX.length);
  let markup: string;
  try {
    markup = decodeURIComponent(encoded);
  } catch {
    throw new Error("Gameplay capture SVG could not be decoded.");
  }
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (
    parsed.documentElement.localName === "parsererror" ||
    parsed.querySelector("parsererror")
  ) {
    throw new Error("Gameplay capture SVG could not be parsed.");
  }

  const captureRoot = parsed.querySelector("foreignObject > *");
  if (!(captureRoot instanceof Element)) {
    throw new Error("Gameplay capture SVG has no foreignObject root.");
  }
  const styleOf = (element: Element) =>
    (element as Element & { style: CSSStyleDeclaration }).style;

  for (const element of [captureRoot, ...captureRoot.querySelectorAll("*")]) {
    const style = styleOf(element);
    const fontFamily = style.fontFamily.trim();
    if (
      fontFamily &&
      !fontFamily.includes(`"${THUMBNAIL_EMBEDDED_FONT_FAMILY}"`)
    ) {
      style.fontFamily = `"${THUMBNAIL_EMBEDDED_FONT_FAMILY}", ${fontFamily}`;
    }
  }
  styleOf(captureRoot).position = "relative";
  for (const layout of parsed.querySelectorAll(
    '[data-save-thumbnail-layout="main"], [data-save-thumbnail-layout="backdrop"]',
  )) {
    styleOf(layout).position = "static";
  }
  for (const atmosphere of parsed.querySelectorAll(
    '[data-save-thumbnail-layout="atmosphere"]',
  )) {
    styleOf(atmosphere).position = "absolute";
    styleOf(atmosphere).zIndex = "0";
  }
  for (const wash of parsed.querySelectorAll(
    "[data-save-thumbnail-atmosphere-wash]",
  )) {
    styleOf(wash).opacity = "0.45";
  }
  for (const background of parsed.querySelectorAll("img.background-image")) {
    styleOf(background).position = "absolute";
    styleOf(background).zIndex = "1";
  }
  for (const portrait of parsed.querySelectorAll("img.portrait")) {
    styleOf(portrait).position = "absolute";
    styleOf(portrait).zIndex = "20";
  }

  const normalizedMarkup = new XMLSerializer().serializeToString(
    parsed.documentElement,
  );
  return `${SVG_DATA_URL_PREFIX}${encodeURIComponent(normalizedMarkup)}`;
}

function parseGameplayCaptureSvg(svgUrl: string): XMLDocument {
  if (!svgUrl.startsWith(SVG_DATA_URL_PREFIX)) {
    throw new Error("Gameplay capture SVG has an unsupported data URL.");
  }
  let markup: string;
  try {
    markup = decodeURIComponent(svgUrl.slice(SVG_DATA_URL_PREFIX.length));
  } catch {
    throw new Error("Gameplay capture SVG could not be decoded.");
  }
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (
    parsed.documentElement.localName === "parsererror" ||
    parsed.querySelector("parsererror")
  ) {
    throw new Error("Gameplay capture SVG could not be parsed.");
  }
  return parsed;
}

function serializeGameplayCaptureSvg(document: XMLDocument): string {
  return `${SVG_DATA_URL_PREFIX}${encodeURIComponent(
    new XMLSerializer().serializeToString(document.documentElement),
  )}`;
}

export function splitGameplayCaptureSvgLayers(svgUrl: string): {
  underPortraitSvgUrl: string;
  overPortraitSvgUrl: string;
} {
  const under = parseGameplayCaptureSvg(svgUrl);
  for (const overlay of under.querySelectorAll(
    '[data-save-thumbnail-layer="over-portrait"]',
  )) {
    overlay.remove();
  }

  const over = parseGameplayCaptureSvg(svgUrl);
  const captureRoot = over.querySelector("foreignObject > *");
  if (!(captureRoot instanceof Element)) {
    throw new Error("Gameplay capture SVG has no foreignObject root.");
  }
  const overlays = Array.from(
    captureRoot.querySelectorAll('[data-save-thumbnail-layer="over-portrait"]'),
  );
  for (const element of Array.from(
    captureRoot.querySelectorAll("*"),
  ).reverse()) {
    const retained = overlays.some(
      (overlay) =>
        element === overlay ||
        element.contains(overlay) ||
        overlay.contains(element),
    );
    if (!retained) element.remove();
  }

  return {
    underPortraitSvgUrl: serializeGameplayCaptureSvg(under),
    overPortraitSvgUrl: serializeGameplayCaptureSvg(over),
  };
}

export async function rasterizeSvgToPngBlob(
  svgLayers: GameplayCaptureSvgLayers,
  options: HtmlToImageOptions,
  environment: SvgRasterizerEnvironment = {
    createImage: () => new Image(),
    createCanvas: () => document.createElement("canvas"),
    settleDelay: waitBetweenSvgDrawPasses,
    settleFrame: waitForAnimationFrameOrTimeout,
  },
  assets: readonly GameplayCaptureAssetLayer[] = [],
): Promise<Blob | null> {
  const [underPortraitUi, overPortraitUi] = await Promise.all([
    loadSvgImage(svgLayers.underPortraitSvgUrl, environment.createImage),
    loadSvgImage(svgLayers.overPortraitSvgUrl, environment.createImage),
  ]);
  // html-to-image 1.11.13 awaits image.decode() after onload. That promise can
  // remain pending in packaged WebKit, so never await it. WebKit can also paint
  // nested SVG images only on a later canvas draw; repeat the full draw once
  // per authored image plus a final pass inside the capture budget.
  await environment.settleFrame();

  const width =
    options.canvasWidth ?? options.width ?? underPortraitUi.naturalWidth;
  const height =
    options.canvasHeight ?? options.height ?? underPortraitUi.naturalHeight;
  const ratio = options.pixelRatio ?? window.devicePixelRatio ?? 1;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(ratio) ||
    width <= 0 ||
    height <= 0 ||
    ratio <= 0
  ) {
    throw new Error("Gameplay capture raster dimensions are unavailable.");
  }

  const canvas = environment.createCanvas();
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.style.width = `${width}`;
  canvas.style.height = `${height}`;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Gameplay capture canvas is unavailable.");
  }
  await drawLoadedSvgPasses(() => {
    drawGameplayLayeredCompositePass(
      context,
      underPortraitUi,
      overPortraitUi,
      assets,
      canvas.width,
      canvas.height,
      options.backgroundColor,
    );
  }, environment.settleDelay);

  return new Promise((resolve) => {
    canvas.toBlob(resolve, options.type ?? "image/png", options.quality ?? 1);
  });
}

async function renderGameplayNodeToPngBlob(
  root: HTMLElement,
  options: HtmlToImageOptions,
  assets: readonly GameplayCaptureAssetLayer[],
): Promise<Blob | null> {
  const serializedSvgUrl = await toSvg(root, options);
  const svgUrl = normalizeGameplayCaptureSvg(serializedSvgUrl);
  const svgLayers = splitGameplayCaptureSvgLayers(svgUrl);
  return rasterizeSvgToPngBlob(
    svgLayers,
    options,
    {
      createImage: () => new Image(),
      createCanvas: () => document.createElement("canvas"),
      settleDelay: waitBetweenSvgDrawPasses,
      settleFrame: waitForAnimationFrameOrTimeout,
    },
    assets,
  );
}

export function pinThumbnailCaptureDeadline(
  request: ThumbnailCaptureRequestView,
  now = performance.now(),
): ThumbnailCaptureRequestView {
  if (!fixedDeadlines.has(request)) {
    fixedDeadlines.set(request, now + Math.max(0, request.timeoutMs));
  }
  return request;
}

export function thumbnailCaptureDeadline(
  request: ThumbnailCaptureRequestView,
  now = performance.now(),
): number {
  const existing = fixedDeadlines.get(request);
  if (existing !== undefined) return existing;
  const deadline = now + Math.max(0, request.timeoutMs);
  fixedDeadlines.set(request, deadline);
  return deadline;
}

class CaptureDeadlineExpired extends Error {}

type CapturePhase =
  | "captureRoot"
  | "fonts"
  | "images"
  | "crossfade"
  | "render"
  | "blobRead";

export type CaptureRenderDiagnosticCode =
  | "domExceptionAbort"
  | "domExceptionData"
  | "domExceptionEncoding"
  | "domExceptionInvalidState"
  | "domExceptionNetwork"
  | "domExceptionNotSupported"
  | "domExceptionOperation"
  | "domExceptionSecurity"
  | "domExceptionOther"
  | "errorEvent"
  | "otherEvent"
  | "resourceLoad"
  | "fontEmbed"
  | "svgSerialize"
  | "foreignObjectLoad"
  | "canvasDraw"
  | "canvasBlob"
  | "unsupportedCss"
  | "filterNodeType"
  | "genericOther"
  | "unknownThrownValue";

function genericRenderDiagnosticCode(
  message: string,
): CaptureRenderDiagnosticCode {
  const normalized = message.trim().toLowerCase();
  if (
    /^resource ".+" not found$/.test(normalized) ||
    normalized.startsWith("failed to fetch resource:") ||
    normalized.includes("failed to fetch resource ")
  ) {
    return "resourceLoad";
  }
  if (
    normalized === "provided element is not within a document" ||
    /failed to (?:load|embed) (?:a )?font/.test(normalized)
  ) {
    return "fontEmbed";
  }
  if (
    normalized.includes("xmlserializer") ||
    (normalized.includes("serializ") && normalized.includes("svg"))
  ) {
    return "svgSerialize";
  }
  if (normalized.includes("source image") && normalized.includes("decod")) {
    return "foreignObjectLoad";
  }
  if (
    normalized.includes("image failed to load") ||
    normalized.includes("failed to load image") ||
    normalized.includes("could not decode image")
  ) {
    return "foreignObjectLoad";
  }
  if (
    normalized.includes("drawimage") ||
    normalized.includes("draw image") ||
    normalized.includes("invalid image data")
  ) {
    return "canvasDraw";
  }
  if (
    normalized.includes("canvas toblob") ||
    normalized.includes("canvas blob") ||
    normalized.includes("canvas.toblob")
  ) {
    return "canvasBlob";
  }
  if (
    normalized.includes("unsupported css") ||
    normalized.includes("cssrule") ||
    (normalized.includes("stylesheet") &&
      (normalized.includes("failed") || normalized.includes("cannot read")))
  ) {
    return "unsupportedCss";
  }
  if (/\.(?:closest|hasattribute) is not a function/.test(normalized)) {
    return "filterNodeType";
  }
  return "genericOther";
}

function captureRenderDiagnosticCode(
  error: unknown,
): CaptureRenderDiagnosticCode {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    switch (error.name) {
      case "AbortError":
        return "domExceptionAbort";
      case "DataError":
        return "domExceptionData";
      case "EncodingError":
        return "domExceptionEncoding";
      case "InvalidStateError":
        return "domExceptionInvalidState";
      case "NetworkError":
        return "domExceptionNetwork";
      case "NotSupportedError":
        return "domExceptionNotSupported";
      case "OperationError":
        return "domExceptionOperation";
      case "SecurityError":
        return "domExceptionSecurity";
      default:
        return "domExceptionOther";
    }
  }
  if (typeof Event !== "undefined" && error instanceof Event) {
    return error.type === "error" ? "errorEvent" : "otherEvent";
  }
  return error instanceof Error
    ? genericRenderDiagnosticCode(error.message)
    : "unknownThrownValue";
}

function captureUnavailableReason(phase: CapturePhase, error: unknown): string {
  return `${phase}${
    error instanceof CaptureDeadlineExpired ? "DeadlineExpired" : "Failed"
  }`;
}

const captureOnlyRootStyle = {
  "--save-crossfade-opacity": "1",
  "--save-crossfade-transition": "none",
  animation: "none",
  transition: "none",
} as Partial<CSSStyleDeclaration>;

const THUMBNAIL_ASSET_ROLE_ATTRIBUTE = "data-save-thumbnail-asset-role";

function excludedFromCapture(node: Node, root: HTMLElement): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  const boundary = element?.closest("[data-save-thumbnail-exclude]");
  return boundary ? root.contains(boundary) : false;
}

function currentCrossfadeLayers(root: HTMLElement): {
  pending: boolean;
  valid: boolean;
  winners: Set<Element>;
} {
  const groups = new Map<Element, Element[]>();
  for (const layer of root.querySelectorAll("[data-save-crossfade-layer]")) {
    const parent = layer.parentElement;
    if (!parent) continue;
    const group = groups.get(parent);
    if (group) group.push(layer);
    else groups.set(parent, [layer]);
  }

  let pending = false;
  let valid = true;
  const winners = new Set<Element>();
  for (const layers of groups.values()) {
    const current = layers.filter(
      (layer) =>
        layer.getAttribute("data-save-crossfade-order") ===
        layer.getAttribute("data-save-crossfade-request"),
    );
    if (
      current.length === 0 &&
      layers.every(
        (layer) =>
          layer.getAttribute("data-save-crossfade-state") === "leaving",
      )
    ) {
      continue;
    }
    if (
      current.some(
        (layer) =>
          layer.getAttribute("data-save-crossfade-state") === "pending",
      )
    ) {
      pending = true;
      continue;
    }
    const winner = current.find(
      (layer) => layer.getAttribute("data-save-crossfade-state") === "visible",
    );
    if (winner) winners.add(winner);
    else valid = false;
  }
  return { pending, valid, winners };
}

async function withinDeadline<T>(
  work: Promise<T>,
  deadline: number,
  now: () => number,
): Promise<T> {
  const remaining = deadline - now();
  if (remaining <= 0) throw new CaptureDeadlineExpired();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new CaptureDeadlineExpired()),
          Math.max(0, Math.ceil(remaining)),
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitForImage(
  image: HTMLImageElement,
  deadline: number,
  now: () => number,
): Promise<void> {
  if (!image.complete) {
    let cleanup = () => {};
    const loaded = new Promise<void>((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Image failed to load."));
      };
      cleanup = () => {
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
      };
      image.addEventListener("load", onLoad, { once: true });
      image.addEventListener("error", onError, { once: true });
    });
    try {
      await withinDeadline(loaded, deadline, now);
    } finally {
      cleanup();
    }
  }

  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("Image has no decoded dimensions.");
  }
  if (typeof image.decode === "function") {
    await withinDeadline(image.decode(), deadline, now);
  }
}

async function waitForCurrentCrossfades(
  root: HTMLElement,
  deadline: number,
  now: () => number,
): Promise<Set<Element>> {
  let state = currentCrossfadeLayers(root);
  if (state.pending) {
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const observer = new MutationObserver(() => {
      if (!currentCrossfadeLayers(root).pending) resolveSettled();
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-save-crossfade-state"],
      childList: true,
      subtree: true,
    });
    try {
      await withinDeadline(settled, deadline, now);
    } finally {
      observer.disconnect();
    }
    state = currentCrossfadeLayers(root);
  }
  if (state.pending || !state.valid) {
    throw new Error("Current crossfade image is unavailable.");
  }
  return state.winners;
}

function gameplayCaptureOptions(
  root: HTMLElement,
  sourceWidth: number,
  sourceHeight: number,
  winners: Set<Element>,
  fontEmbedCss: string,
): HtmlToImageOptions {
  const fitted = fitWithoutUpscaling(sourceWidth, sourceHeight);
  return {
    width: sourceWidth,
    height: sourceHeight,
    canvasWidth: fitted.width,
    canvasHeight: fitted.height,
    pixelRatio: 1,
    skipFonts: true,
    fontEmbedCSS: fontEmbedCss,
    type: "image/png",
    style: captureOnlyRootStyle,
    filter: (node) => {
      if (excludedFromCapture(node, root)) return false;
      if (
        node instanceof Element &&
        node.hasAttribute(THUMBNAIL_ASSET_ROLE_ATTRIBUTE)
      ) {
        return false;
      }
      if (
        node instanceof Element &&
        node.hasAttribute("data-save-crossfade-layer")
      ) {
        return winners.has(node);
      }
      return true;
    },
  };
}

function gameplayCaptureAssetLayers(
  root: HTMLElement,
  winners: Set<Element>,
  sourceWidth: number,
  sourceHeight: number,
): GameplayCaptureAssetLayer[] {
  const fitted = fitWithoutUpscaling(sourceWidth, sourceHeight);
  const rootRect = root.getBoundingClientRect();
  const rootBounds = {
    x: rootRect.x,
    y: rootRect.y,
    width: rootRect.width,
    height: rootRect.height,
  };
  const assets: GameplayCaptureAssetLayer[] = [];
  for (const winner of winners) {
    if (!(winner instanceof HTMLImageElement)) continue;
    const role = winner.getAttribute(THUMBNAIL_ASSET_ROLE_ATTRIBUTE);
    if (role !== "background" && role !== "portrait") continue;
    const imageRect = winner.getBoundingClientRect();
    const mappedBounds = mapBoundsToCanvas(
      {
        x: imageRect.x,
        y: imageRect.y,
        width: imageRect.width,
        height: imageRect.height,
      },
      rootBounds,
      fitted.width,
      fitted.height,
    );
    const targetOpacity = Number.parseFloat(
      getComputedStyle(winner).getPropertyValue("--crossfade-visible-opacity"),
    );
    const opacity = Math.max(
      0,
      Math.min(
        1,
        Number.isFinite(targetOpacity)
          ? targetOpacity
          : role === "background"
            ? 0.52
            : 1,
      ),
    );
    assets.push({
      image: winner,
      opacity,
      role,
      source:
        role === "background"
          ? coverSourceRect(
              winner.naturalWidth,
              winner.naturalHeight,
              mappedBounds.width,
              mappedBounds.height,
            )
          : {
              x: 0,
              y: 0,
              width: winner.naturalWidth,
              height: winner.naturalHeight,
            },
      destination:
        role === "background"
          ? mappedBounds
          : containDestinationRect(
              winner.naturalWidth,
              winner.naturalHeight,
              mappedBounds,
            ),
    });
  }
  return assets.sort(
    (left, right) =>
      (left.role === "background" ? 0 : 1) -
      (right.role === "background" ? 0 : 1),
  );
}

export function createHtmlToImageGameplayCapture(input: {
  root: () => HTMLElement | null;
  now: () => number;
  onRenderDiagnostic?: (code: CaptureRenderDiagnosticCode) => void;
  onFontEmbedDiagnostic?: (diagnostic: ThumbnailFontEmbedDiagnostic) => void;
  embedFontForCapture?: (
    root: HTMLElement,
  ) => Promise<ThumbnailFontEmbedResult>;
  renderToBlob?: (
    root: HTMLElement,
    options: HtmlToImageOptions,
    assets: readonly GameplayCaptureAssetLayer[],
  ) => Promise<Blob | null>;
}): GameplayThumbnailCapture {
  return {
    async capture(request) {
      const deadline = thumbnailCaptureDeadline(request, input.now());
      let phase: CapturePhase = "captureRoot";
      try {
        const root = input.root();
        if (!root) throw new Error("Gameplay capture root is unavailable.");
        const rect = root.getBoundingClientRect();
        if (
          !Number.isFinite(rect.width) ||
          !Number.isFinite(rect.height) ||
          rect.width <= 0 ||
          rect.height <= 0
        ) {
          throw new Error("Gameplay capture root has invalid dimensions.");
        }
        const sourceWidth = Math.round(rect.width);
        const sourceHeight = Math.round(rect.height);

        const fontsReady =
          "fonts" in document
            ? document.fonts.ready.then(() => undefined)
            : Promise.resolve();
        phase = "fonts";
        await withinDeadline(fontsReady, deadline, input.now);
        const fontEmbed = await withinDeadline(
          (input.embedFontForCapture ?? embedThumbnailFont)(root),
          deadline,
          input.now,
        );
        input.onFontEmbedDiagnostic?.({
          selectedChunkCount: fontEmbed.selectedChunkCount,
          embeddedZhHantCodePointCount: fontEmbed.embeddedZhHantCodePointCount,
          cssBytes: fontEmbed.cssBytes,
        });

        phase = "images";
        const images = Array.from(root.querySelectorAll("img")).filter(
          (image) => !excludedFromCapture(image, root),
        );
        await withinDeadline(
          Promise.all(
            images.map((image) => waitForImage(image, deadline, input.now)),
          ).then(() => undefined),
          deadline,
          input.now,
        );

        phase = "crossfade";
        const winners = await waitForCurrentCrossfades(
          root,
          deadline,
          input.now,
        );
        phase = "render";
        const baseRenderOptions = gameplayCaptureOptions(
          root,
          sourceWidth,
          sourceHeight,
          winners,
          fontEmbed.css,
        );
        const renderOptions = curatedCaptureOptions(baseRenderOptions);
        const assetLayers = gameplayCaptureAssetLayers(
          root,
          winners,
          sourceWidth,
          sourceHeight,
        );
        const renderPromise = input.renderToBlob
          ? input.renderToBlob(root, renderOptions, assetLayers)
          : toBlob(root, renderOptions);
        const blob = await withinDeadline(renderPromise, deadline, input.now);
        if (!blob) throw new Error("Gameplay capture produced no PNG.");
        phase = "blobRead";
        const bytes = await withinDeadline(
          blob.arrayBuffer(),
          deadline,
          input.now,
        );
        return {
          type: "available",
          bytes: new Uint8Array(bytes),
        };
      } catch (error) {
        if (phase === "render" && !(error instanceof CaptureDeadlineExpired)) {
          const diagnostic = captureRenderDiagnosticCode(error);
          input.onRenderDiagnostic?.(diagnostic);
        }
        return {
          type: "unavailable",
          reason: captureUnavailableReason(phase, error),
        };
      }
    },
  };
}

export type PackagedCaptureProofStatus = Readonly<{
  calls: number;
  available: number;
  lastClosedReason: string;
  lastRenderDiagnostic: CaptureRenderDiagnosticCode | "";
  embeddedFontCssBytes: number;
  embeddedFontChunkCount: number;
  embeddedZhHantCodePointCount: number;
}>;

export function createPackagedCaptureProofCapture(
  delegate: GameplayThumbnailCapture,
  renderDiagnostic: () => CaptureRenderDiagnosticCode | "" = () => "",
  fontEmbedDiagnostic: () => ThumbnailFontEmbedDiagnostic = () => ({
    selectedChunkCount: 0,
    embeddedZhHantCodePointCount: 0,
    cssBytes: 0,
  }),
): {
  capture: GameplayThumbnailCapture;
  forceNextUnavailable: () => void;
  lastUnavailableReason: () => string;
  status: () => PackagedCaptureProofStatus;
} {
  let forceNext = false;
  let lastUnavailableReason = "";
  let calls = 0;
  let available = 0;
  return {
    capture: {
      async capture(request) {
        calls += 1;
        if (forceNext) {
          forceNext = false;
          lastUnavailableReason = "forcedUnavailable";
          return {
            type: "unavailable",
            reason: "Forced unavailable by the packaged capture proof.",
          };
        }
        const result = await delegate.capture(request);
        if (result.type === "unavailable") {
          lastUnavailableReason = result.reason;
        } else {
          available += 1;
          lastUnavailableReason = "";
        }
        return result;
      },
    },
    forceNextUnavailable() {
      forceNext = true;
    },
    lastUnavailableReason() {
      return lastUnavailableReason;
    },
    status() {
      const font = fontEmbedDiagnostic();
      return {
        calls,
        available,
        lastClosedReason: lastUnavailableReason,
        lastRenderDiagnostic: renderDiagnostic(),
        embeddedFontCssBytes: font.cssBytes,
        embeddedFontChunkCount: font.selectedChunkCount,
        embeddedZhHantCodePointCount: font.embeddedZhHantCodePointCount,
      };
    },
  };
}

const GAMEPLAY_CAPTURE_CURATED_STYLE_PROPERTIES = [
  "display",
  "position",
  "inset",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "flex",
  "flex-flow",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "align-content",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "order",
  "gap",
  "row-gap",
  "column-gap",
  "grid",
  "grid-template",
  "grid-template-rows",
  "grid-template-columns",
  "grid-template-areas",
  "grid-auto-flow",
  "grid-auto-rows",
  "grid-auto-columns",
  "grid-row",
  "grid-row-start",
  "grid-row-end",
  "grid-column",
  "grid-column-start",
  "grid-column-end",
  "place-content",
  "place-items",
  "place-self",
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "aspect-ratio",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "overflow",
  "overflow-x",
  "overflow-y",
  "clip",
  "clip-path",
  "transform",
  "transform-origin",
  "transform-style",
  "opacity",
  "background",
  "background-color",
  "background-image",
  "background-position",
  "background-size",
  "background-repeat",
  "background-clip",
  "background-origin",
  "background-attachment",
  "background-blend-mode",
  "border",
  "border-width",
  "border-style",
  "border-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "outline",
  "outline-width",
  "outline-style",
  "outline-color",
  "box-shadow",
  "color",
  "font",
  "font-family",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "font-feature-settings",
  "font-kerning",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "text-decoration-color",
  "text-decoration-line",
  "text-decoration-style",
  "text-indent",
  "text-overflow",
  "text-shadow",
  "text-transform",
  "white-space",
  "word-break",
  "word-wrap",
  "overflow-wrap",
  "object-fit",
  "object-position",
  "filter",
  "backdrop-filter",
  "visibility",
  "vertical-align",
  "isolation",
  "mix-blend-mode",
  "table-layout",
  "border-collapse",
  "border-spacing",
  "list-style",
  "list-style-position",
  "list-style-type",
  "content",
  "--save-crossfade-opacity",
  "--save-crossfade-transition",
];

function curatedCaptureOptions(
  options: HtmlToImageOptions,
): HtmlToImageOptions {
  return {
    ...options,
    includeStyleProperties: [...GAMEPLAY_CAPTURE_CURATED_STYLE_PROPERTIES],
  };
}

const htmlToImageGameplayCapture = createHtmlToImageGameplayCapture({
  root: () =>
    typeof document === "undefined"
      ? null
      : document.querySelector<HTMLElement>("[data-save-thumbnail-root]"),
  now: () => performance.now(),
  renderToBlob: renderGameplayNodeToPngBlob,
  ...(packagedCaptureProofEnabled
    ? {
        onRenderDiagnostic: (code: CaptureRenderDiagnosticCode) => {
          lastPackagedRenderDiagnostic = code;
        },
        onFontEmbedDiagnostic: (diagnostic: ThumbnailFontEmbedDiagnostic) => {
          lastPackagedFontEmbedDiagnostic = diagnostic;
        },
      }
    : {}),
});

const packagedCaptureProof = packagedCaptureProofEnabled
  ? createPackagedCaptureProofCapture(
      htmlToImageGameplayCapture,
      () => lastPackagedRenderDiagnostic,
      () => lastPackagedFontEmbedDiagnostic,
    )
  : null;

export const gameplayThumbnailCapture =
  packagedCaptureProof?.capture ?? htmlToImageGameplayCapture;

export function forceNextPackagedCaptureUnavailable(): void {
  packagedCaptureProof?.forceNextUnavailable();
}

export function packagedCaptureUnavailableReason(): string {
  return packagedCaptureProof?.lastUnavailableReason() ?? "";
}

export function packagedCaptureProofStatus(): PackagedCaptureProofStatus {
  return (
    packagedCaptureProof?.status() ?? {
      calls: 0,
      available: 0,
      lastClosedReason: "",
      lastRenderDiagnostic: "",
      embeddedFontCssBytes: 0,
      embeddedFontChunkCount: 0,
      embeddedZhHantCodePointCount: 0,
    }
  );
}
