import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  cssRectToImageRegion,
  decodePng,
  expectPaintedRegion,
  regionPixelMetrics,
  type DecodedPng,
} from "./screenshot-pixels";

/** Minimal PNG encoder for fixtures: 8-bit rows, filter byte per row. */
function fixturePng(options: {
  width: number;
  height: number;
  colorType: 0 | 2 | 3 | 4 | 6;
  /** Per-row bytes WITHOUT the filter byte; row length must equal
   * channels*width (bit depth 8). */
  rows: Uint8Array[];
  /** Filter byte per row (default 0). */
  filters?: number[];
  palette?: Uint8Array;
  transparency?: Uint8Array;
  bitDepth?: 8 | 16;
  interlace?: 0 | 1;
}): Uint8Array {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[options.colorType];
  const bitDepth = options.bitDepth ?? 8;
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out; // CRC left as zeroes — the decoder does not verify CRCs.
  };
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, options.width);
  ihdrView.setUint32(4, options.height);
  ihdr[8] = bitDepth;
  ihdr[9] = options.colorType;
  ihdr[12] = options.interlace ?? 0;
  const raw = new Uint8Array(
    options.rows.reduce((sum, row) => sum + 1 + row.length, 0),
  );
  let offset = 0;
  options.rows.forEach((row, index) => {
    if (row.length !== options.width * channels * (bitDepth / 8)) {
      throw new Error(`fixture row ${index} has wrong length ${row.length}`);
    }
    raw[offset] = options.filters?.[index] ?? 0;
    raw.set(row, offset + 1);
    offset += 1 + row.length;
  });
  const parts: Uint8Array[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
  ];
  if (options.palette) parts.push(chunk("PLTE", options.palette));
  if (options.transparency) parts.push(chunk("tRNS", options.transparency));
  parts.push(chunk("IDAT", new Uint8Array(deflateSync(raw))));
  parts.push(chunk("IEND", new Uint8Array(0)));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    png.set(part, cursor);
    cursor += part.length;
  }
  return png;
}

/** Straight RGBA pixels → PNG rows (filter 0). */
function rgbaPng(
  width: number,
  height: number,
  pixels: number[][],
): Uint8Array {
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(width * 4);
    for (let x = 0; x < width; x += 1) row.set(pixels[y * width + x], x * 4);
    rows.push(row);
  }
  return fixturePng({ width, height, colorType: 6, rows });
}

describe("decodePng", () => {
  it("decodes an 8-bit RGBA image to exact RGBA pixels", () => {
    const png = rgbaPng(2, 2, [
      [10, 20, 30, 255],
      [40, 50, 60, 128],
      [70, 80, 90, 0],
      [200, 210, 220, 64],
    ]);
    const decoded = decodePng(png);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(Array.from(decoded.pixels)).toEqual([
      10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0, 200, 210, 220, 64,
    ]);
  });

  it("decodes an 8-bit RGB image with opaque alpha", () => {
    const png = fixturePng({
      width: 1,
      height: 1,
      colorType: 2,
      rows: [new Uint8Array([9, 99, 199])],
    });
    const decoded = decodePng(png);
    expect(Array.from(decoded.pixels)).toEqual([9, 99, 199, 255]);
  });

  it("applies the Sub filter when reconstructing rows", () => {
    // Filter 1 (Sub): stored byte = raw - left. First pixel stored raw.
    const png = fixturePng({
      width: 2,
      height: 1,
      colorType: 6,
      filters: [1],
      rows: [new Uint8Array([10, 20, 30, 255, 5, 5, 5, 0])],
    });
    const decoded = decodePng(png);
    expect(Array.from(decoded.pixels)).toEqual([
      10, 20, 30, 255, 15, 25, 35, 255,
    ]);
  });

  it("decodes a palette image with tRNS alpha", () => {
    const png = fixturePng({
      width: 2,
      height: 1,
      colorType: 3,
      rows: [new Uint8Array([0, 1])],
      palette: new Uint8Array([255, 0, 0, 0, 255, 0]),
      transparency: new Uint8Array([255, 128]),
    });
    const decoded = decodePng(png);
    expect(Array.from(decoded.pixels)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 128,
    ]);
  });

  it("reduces 16-bit samples to their high byte", () => {
    const png = fixturePng({
      width: 1,
      height: 1,
      colorType: 2,
      bitDepth: 16,
      rows: [new Uint8Array([0xaa, 0x11, 0xbb, 0x22, 0xcc, 0x33])],
    });
    const decoded = decodePng(png);
    expect(Array.from(decoded.pixels)).toEqual([0xaa, 0xbb, 0xcc, 255]);
  });

  it("rejects non-PNG bytes with the signature named", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(
      /PNG signature/,
    );
  });

  it("rejects interlaced PNGs", () => {
    const png = rgbaPng(1, 1, [[1, 2, 3, 255]]);
    // Flip the interlace byte in IHDR (offset: 8 sig + 8 len/type + 12).
    png[8 + 8 + 12] = 1;
    expect(() => decodePng(png)).toThrow(/interlace/i);
  });

  it("decodes a real production evidence PNG", () => {
    const real = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../../static/assets/evidence/cctv_screenshot.png",
      ),
    );
    const decoded = decodePng(real);
    expect(decoded.width).toBe(512);
    expect(decoded.height).toBe(512);
    const metrics = regionPixelMetrics(decoded, {
      x: 0,
      y: 0,
      width: 512,
      height: 512,
    });
    expect(metrics.distinctBuckets).toBeGreaterThanOrEqual(10);
    expect(metrics.luminanceStdDev).toBeGreaterThan(2);
  });
});

describe("cssRectToImageRegion", () => {
  it("scales CSS coordinates by screenshotSize/viewportSize, not a fixed DPR", () => {
    const region = cssRectToImageRegion(
      { left: 100, top: 50, width: 200, height: 100 },
      { width: 800, height: 600 },
      { width: 1600, height: 1200 },
    );
    expect(region).toEqual({ x: 200, y: 100, width: 400, height: 200 });
  });

  it("insets the crop past borders before scaling", () => {
    const region = cssRectToImageRegion(
      { left: 100, top: 50, width: 200, height: 100 },
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      2,
    );
    expect(region).toEqual({ x: 102, y: 52, width: 196, height: 96 });
  });

  it("clamps a partially offscreen rect to the image bounds", () => {
    const region = cssRectToImageRegion(
      { left: -20, top: 10, width: 100, height: 50 },
      { width: 800, height: 600 },
      { width: 800, height: 600 },
    );
    expect(region).toEqual({ x: 0, y: 10, width: 80, height: 50 });
  });
});

function syntheticPng(luminances: number[]): DecodedPng {
  const side = Math.ceil(Math.sqrt(luminances.length));
  const pixels = new Uint8Array(side * side * 4);
  luminances.forEach((lum, index) => {
    pixels[index * 4] = lum;
    pixels[index * 4 + 1] = lum;
    pixels[index * 4 + 2] = lum;
    pixels[index * 4 + 3] = 255;
  });
  return { width: side, height: side, pixels };
}

describe("regionPixelMetrics + expectPaintedRegion", () => {
  it("reports a uniform region as one bucket with zero spread", () => {
    const png = syntheticPng(Array(64).fill(12));
    const metrics = regionPixelMetrics(png, {
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
    expect(metrics.sampledPixels).toBe(64);
    expect(metrics.distinctBuckets).toBe(1);
    expect(metrics.luminanceStdDev).toBe(0);
    expect(() => expectPaintedRegion(metrics, "probe")).toThrow(/probe/);
  });

  it("passes a region with distinguishable non-single-color content", () => {
    const values: number[] = [];
    for (let i = 0; i < 64; i += 1) values.push((i * 37) % 256);
    const png = syntheticPng(values);
    const metrics = regionPixelMetrics(png, {
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
    expect(metrics.distinctBuckets).toBeGreaterThanOrEqual(4);
    expect(metrics.luminanceStdDev).toBeGreaterThan(2);
    expect(() => expectPaintedRegion(metrics, "probe")).not.toThrow();
  });

  it("rejects a degenerate empty region", () => {
    const png = syntheticPng(Array(64).fill(80));
    const metrics = regionPixelMetrics(png, {
      x: 0,
      y: 0,
      width: 2,
      height: 2,
    });
    expect(() => expectPaintedRegion(metrics, "crop")).toThrow(/empty|small/i);
  });
});
