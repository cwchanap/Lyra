import { inflateSync } from "node:zlib";

/**
 * Test-only PNG decode + screenshot-region pixel metrics (HPA-831 Task 1).
 *
 * The packaged WebKitGTK/Xvfb compositor bug (evidence images painting as
 * empty black frames) is invisible to DOM/source checks: the `<img>` can
 * decode fine while the composited frame stays blank. The only objective
 * proof is decoding the WDIO screenshot PNG in the Node test process and
 * sampling the painted region. This module stays deliberately small — a
 * decoder for the PNGs WDIO emits (8/16-bit, non-interlaced), a CSS→image
 * rect mapping, and crop metrics — not an application image pipeline.
 */

export type DecodedPng = {
  width: number;
  height: number;
  /** RGBA8, row-major; length is width*height*4. */
  pixels: Uint8Array;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

type PngChunk = { type: string; data: Uint8Array };

function readChunks(data: Uint8Array): PngChunk[] {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (data[i] !== PNG_SIGNATURE[i]) {
      throw new Error(`PNG signature mismatch at byte ${i}`);
    }
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= data.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      data[offset + 4] ?? 0,
      data[offset + 5] ?? 0,
      data[offset + 6] ?? 0,
      data[offset + 7] ?? 0,
    );
    const bodyStart = offset + 8;
    if (bodyStart + length > data.length) {
      throw new Error(`PNG chunk ${type} overruns the buffer`);
    }
    chunks.push({ type, data: data.subarray(bodyStart, bodyStart + length) });
    offset = bodyStart + length + 4; // skip CRC — not verified
  }
  return chunks;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(data: Uint8Array): DecodedPng {
  const chunks = readChunks(data);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR");
  if (!ihdr) throw new Error("PNG is missing its IHDR chunk");
  const view = new DataView(
    ihdr.data.buffer,
    ihdr.data.byteOffset,
    ihdr.data.byteLength,
  );
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (width === 0 || height === 0) {
    throw new Error(`PNG has a degenerate ${width}x${height} IHDR`);
  }
  if (interlace !== 0) {
    throw new Error(
      `interlaced PNG unsupported (Adam7 flag ${interlace}); WDIO screenshots are non-interlaced`,
    );
  }
  const channels = CHANNELS[colorType ?? -1];
  if (channels === undefined) {
    throw new Error(`unsupported PNG color type ${colorType}`);
  }
  if (colorType === 3 && bitDepth !== 8) {
    throw new Error(
      `palette PNGs below 8 bits are unsupported (bit depth ${bitDepth})`,
    );
  }
  if (bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  }

  const palette = chunks.find((chunk) => chunk.type === "PLTE")?.data;
  const transparency = chunks.find((chunk) => chunk.type === "tRNS")?.data;
  if (colorType === 3 && !palette) {
    throw new Error("palette PNG is missing its PLTE chunk");
  }
  const idat = chunks
    .filter((chunk) => chunk.type === "IDAT")
    .reduce<Uint8Array>((combined, chunk) => {
      const next = new Uint8Array(combined.length + chunk.data.length);
      next.set(combined);
      next.set(chunk.data, combined.length);
      return next;
    }, new Uint8Array(0));
  if (idat.length === 0) throw new Error("PNG has no IDAT data");
  const raw = inflateSync(idat);

  const sampleBytes = bitDepth / 8;
  const bpp = channels * sampleBytes; // bytes per pixel for filtering
  const stride = width * bpp;
  const expected = height * (stride + 1);
  if (raw.length < expected) {
    throw new Error(
      `PNG image data truncated: expected ${expected} bytes, got ${raw.length}`,
    );
  }

  const unfiltered = new Uint8Array(height * stride);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = unfiltered.subarray(y * stride, (y + 1) * stride);
    row.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    if (filter === 1) {
      for (let i = bpp; i < stride; i += 1) {
        row[i] = ((row[i] ?? 0) + (row[i - bpp] ?? 0)) & 0xff;
      }
    } else if (filter === 2) {
      for (let i = 0; i < stride; i += 1) {
        row[i] = ((row[i] ?? 0) + (previous[i] ?? 0)) & 0xff;
      }
    } else if (filter === 3) {
      for (let i = 0; i < stride; i += 1) {
        const left = i >= bpp ? (row[i - bpp] ?? 0) : 0;
        row[i] = ((row[i] ?? 0) + ((left + (previous[i] ?? 0)) >> 1)) & 0xff;
      }
    } else if (filter === 4) {
      for (let i = 0; i < stride; i += 1) {
        const a = i >= bpp ? (row[i - bpp] ?? 0) : 0;
        const b = previous[i] ?? 0;
        const c = i >= bpp ? (previous[i - bpp] ?? 0) : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        row[i] = ((row[i] ?? 0) + pr) & 0xff;
      }
    } else if (filter !== 0) {
      throw new Error(`unsupported PNG row filter ${filter} at row ${y}`);
    }
    previous = row;
  }

  const pixels = new Uint8Array(width * height * 4);
  const transparentGray =
    colorType === 0 && transparency && transparency.length >= 2
      ? new DataView(
          transparency.buffer,
          transparency.byteOffset,
          transparency.byteLength,
        ).getUint16(0)
      : null;
  const transparentRgb =
    colorType === 2 && transparency && transparency.length >= 6
      ? new DataView(
          transparency.buffer,
          transparency.byteOffset,
          transparency.byteLength,
        )
      : null;

  for (let i = 0; i < width * height; i += 1) {
    const source = i * bpp;
    const target = i * 4;
    const sample = (channel: number) =>
      bitDepth === 8
        ? (unfiltered[source + channel] ?? 0)
        : (unfiltered[source + channel * 2] ?? 0);
    if (colorType === 6) {
      pixels[target] = sample(0);
      pixels[target + 1] = sample(1);
      pixels[target + 2] = sample(2);
      pixels[target + 3] = sample(3);
    } else if (colorType === 2) {
      pixels[target] = sample(0);
      pixels[target + 1] = sample(1);
      pixels[target + 2] = sample(2);
      const matchesTransparent =
        transparentRgb !== null &&
        transparentRgb.getUint16(0) ===
          (bitDepth === 8
            ? (unfiltered[source] ?? 0)
            : new DataView(
                unfiltered.buffer,
                unfiltered.byteOffset + source,
                2,
              ).getUint16(0)) &&
        transparentRgb.getUint16(2) ===
          (bitDepth === 8
            ? (unfiltered[source + 1] ?? 0)
            : new DataView(
                unfiltered.buffer,
                unfiltered.byteOffset + source + 2,
                2,
              ).getUint16(0)) &&
        transparentRgb.getUint16(4) ===
          (bitDepth === 8
            ? (unfiltered[source + 2] ?? 0)
            : new DataView(
                unfiltered.buffer,
                unfiltered.byteOffset + source + 4,
                2,
              ).getUint16(0));
      pixels[target + 3] = matchesTransparent ? 0 : 255;
    } else if (colorType === 0) {
      const gray = sample(0);
      const gray16 =
        bitDepth === 8
          ? (unfiltered[source] ?? 0)
          : new DataView(
              unfiltered.buffer,
              unfiltered.byteOffset + source,
              2,
            ).getUint16(0);
      pixels[target] = gray;
      pixels[target + 1] = gray;
      pixels[target + 2] = gray;
      pixels[target + 3] = transparentGray === gray16 ? 0 : 255;
    } else if (colorType === 4) {
      const gray = sample(0);
      pixels[target] = gray;
      pixels[target + 1] = gray;
      pixels[target + 2] = gray;
      pixels[target + 3] = sample(1);
    } else {
      const index = unfiltered[source] ?? 0;
      pixels[target] = palette?.[index * 3] ?? 0;
      pixels[target + 1] = palette?.[index * 3 + 1] ?? 0;
      pixels[target + 2] = palette?.[index * 3 + 2] ?? 0;
      pixels[target + 3] = transparency?.[index] ?? 255;
    }
  }
  return { width, height, pixels };
}

export type CssRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ImageRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Maps a CSS-space rect into screenshot-image pixels using the ACTUAL
 * screenshotSize ÷ cssViewportSize ratio — never an assumed DPR of 1 — then
 * insets the crop past borders and clamps to the image bounds.
 */
export function cssRectToImageRegion(
  rect: CssRect,
  cssViewport: { width: number; height: number },
  imageSize: { width: number; height: number },
  insetCssPx = 0,
): ImageRegion {
  const scaleX = imageSize.width / cssViewport.width;
  const scaleY = imageSize.height / cssViewport.height;
  const insetX = insetCssPx * scaleX;
  const insetY = insetCssPx * scaleY;
  const left = Math.max(0, Math.round(rect.left * scaleX + insetX));
  const top = Math.max(0, Math.round(rect.top * scaleY + insetY));
  const right = Math.min(
    imageSize.width,
    Math.round((rect.left + rect.width) * scaleX - insetX),
  );
  const bottom = Math.min(
    imageSize.height,
    Math.round((rect.top + rect.height) * scaleY - insetY),
  );
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export type RegionPixelMetrics = {
  sampledPixels: number;
  /** Pixels with alpha > 0 — a fully transparent crop cannot be painted. */
  alphaPixels: number;
  /** Quantized color buckets (8 levels per channel, like capture-proof). */
  distinctBuckets: number;
  luminanceMean: number;
  luminanceStdDev: number;
  minLuminance: number;
  maxLuminance: number;
  /** Largest single bucket's share of sampled pixels. */
  dominantBucketShare: number;
};

export function regionPixelMetrics(
  png: DecodedPng,
  region: ImageRegion,
): RegionPixelMetrics {
  const bucketCounts = new Map<number, number>();
  let alphaPixels = 0;
  let sampled = 0;
  let luminanceSum = 0;
  let luminanceSumSquares = 0;
  let minLuminance = 0;
  let maxLuminance = 0;
  const xEnd = Math.min(png.width, region.x + region.width);
  const yEnd = Math.min(png.height, region.y + region.height);
  for (let y = Math.max(0, region.y); y < yEnd; y += 1) {
    for (let x = Math.max(0, region.x); x < xEnd; x += 1) {
      const offset = (y * png.width + x) * 4;
      const r = png.pixels[offset] ?? 0;
      const g = png.pixels[offset + 1] ?? 0;
      const b = png.pixels[offset + 2] ?? 0;
      const a = png.pixels[offset + 3] ?? 0;
      sampled += 1;
      if (a > 0) alphaPixels += 1;
      const bucket = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      luminanceSum += luminance;
      luminanceSumSquares += luminance * luminance;
      if (sampled === 1 || luminance < minLuminance) minLuminance = luminance;
      if (luminance > maxLuminance) maxLuminance = luminance;
    }
  }
  const mean = sampled === 0 ? 0 : luminanceSum / sampled;
  const variance =
    sampled === 0 ? 0 : luminanceSumSquares / sampled - mean * mean;
  const dominantCount = Math.max(0, ...bucketCounts.values());
  return {
    sampledPixels: sampled,
    alphaPixels,
    distinctBuckets: bucketCounts.size,
    luminanceMean: mean,
    luminanceStdDev: Math.sqrt(Math.max(0, variance)),
    minLuminance,
    maxLuminance,
    dominantBucketShare: sampled === 0 ? 1 : dominantCount / sampled,
  };
}

/**
 * The compositor gate: a crop must contain distinguishable, non-empty,
 * non-single-color content. A painted black/empty frame fails on all of
 * these; a legitimately dark evidence image still passes because real art
 * has structure (the three chapter_1 records measure 35-50 buckets).
 */
export function expectPaintedRegion(
  metrics: RegionPixelMetrics,
  label: string,
): void {
  if (metrics.sampledPixels < 16) {
    throw new Error(
      `${label}: screenshot crop is empty or too small to verify (${metrics.sampledPixels} sampled pixels)`,
    );
  }
  if (metrics.alphaPixels === 0) {
    throw new Error(
      `${label}: screenshot crop is fully transparent — nothing was composited`,
    );
  }
  const uniform =
    metrics.distinctBuckets < 4 ||
    metrics.luminanceStdDev < 2 ||
    metrics.dominantBucketShare > 0.99;
  if (uniform) {
    throw new Error(
      `${label}: screenshot crop is single-color (distinctBuckets=${metrics.distinctBuckets}, ` +
        `luminanceStdDev=${metrics.luminanceStdDev.toFixed(2)}, ` +
        `dominantBucketShare=${metrics.dominantBucketShare.toFixed(3)}, ` +
        `luminanceMean=${metrics.luminanceMean.toFixed(1)}) — the painted region has no distinguishable content`,
    );
  }
}
