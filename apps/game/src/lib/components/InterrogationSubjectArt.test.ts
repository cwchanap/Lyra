import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortraitRef } from "$lib/state/types";
import InterrogationSubjectArt from "./InterrogationSubjectArt.svelte";

const resolveStoryAssetMock = vi.hoisted(() => vi.fn());

vi.mock("$lib/assets/story-assets", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/assets/story-assets")>();
  return {
    ...actual,
    resolveStoryAsset: (...args: Parameters<typeof actual.resolveStoryAsset>) =>
      resolveStoryAssetMock(...args),
  };
});

const portrait: PortraitRef = {
  characterId: "miyake_sota",
  expression: "standard",
  assetId: "portrait.miyake_sota.standard",
};

function imageFor(container: HTMLElement): HTMLImageElement {
  const image = container.querySelector<HTMLImageElement>(
    "img.interrogation-subject-portrait",
  );
  if (!image) throw new Error("interrogation subject image not found");
  return image;
}

function setImageSize(image: HTMLImageElement, width = 4, height = 4): void {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
}

describe("InterrogationSubjectArt", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resolveStoryAssetMock.mockReset();
  });

  beforeEach(() => {
    resolveStoryAssetMock.mockImplementation(
      async (assetId: string | null | undefined, type: string) => {
        const actual = await vi.importActual<
          typeof import("$lib/assets/story-assets")
        >("$lib/assets/story-assets");
        return actual.resolveStoryAsset(assetId, type as "portrait");
      },
    );
  });

  it("renders a stable decorative portrait layer with the thumbnail contract", async () => {
    const { container } = render(InterrogationSubjectArt, { portrait });

    const wrapper = container.querySelector(
      '[data-interrogation-subject-art=""]',
    );
    expect(wrapper).toBeInTheDocument();

    const image = await waitFor(() => imageFor(container));
    expect(image).toHaveClass("portrait", "interrogation-subject-portrait");
    expect(image).toHaveAttribute("data-save-thumbnail-asset-role", "portrait");
    expect(image).toHaveAttribute("data-save-crossfade-layer", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
  });

  it("applies shared alpha crop variables once when the portrait loads", async () => {
    const alpha = new Uint8ClampedArray(4 * 4 * 4);
    alpha[(1 * 4 + 1) * 4 + 3] = 255;
    alpha[(2 * 4 + 2) * 4 + 3] = 255;
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: alpha })),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context,
    );

    const { container } = render(InterrogationSubjectArt, { portrait });
    const image = await waitFor(() => imageFor(container));
    setImageSize(image);

    await fireEvent.load(image);
    await waitFor(() => {
      expect(image.style.getPropertyValue("--crop-left")).toBe("0.25");
      expect(image.style.getPropertyValue("--crop-top")).toBe("0.25");
      expect(image.style.getPropertyValue("--crop-width")).toBe("0.5");
      expect(image.style.getPropertyValue("--crop-height")).toBe("0.5");
    });
    await fireEvent.load(image);

    expect(context.getImageData).toHaveBeenCalledOnce();
  });

  it("keeps the un-cropped image safe when alpha bounds are unavailable", async () => {
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4 * 4 * 4) })),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context,
    );

    const { container } = render(InterrogationSubjectArt, { portrait });
    const image = await waitFor(() => imageFor(container));
    setImageSize(image);

    await expect(fireEvent.load(image)).resolves.toBe(true);
    expect(image.style.getPropertyValue("--crop-height")).toBe("");
    expect(context.getImageData).toHaveBeenCalledOnce();
  });

  it("renders no image layer without a portrait ref", async () => {
    const { container } = render(InterrogationSubjectArt, {
      portrait: null,
    });

    expect(
      container.querySelector('[data-interrogation-subject-art=""]'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        container.querySelector("img.interrogation-subject-portrait"),
      ).toBeNull();
    });
  });

  it("falls back to the placeholder asset when resolution fails and keeps the error handler inert", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveStoryAssetMock.mockRejectedValue(new Error("asset unavailable"));

    const { container } = render(InterrogationSubjectArt, { portrait });
    const image = await waitFor(() => {
      const candidate = imageFor(container);
      expect(candidate.src).toContain("PORTRAIT");
      return candidate;
    });

    await expect(fireEvent.error(image)).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(image.src).toContain("PORTRAIT");
  });

  it("records no crop when the loaded image has no decoded dimensions", async () => {
    const { container } = render(InterrogationSubjectArt, { portrait });
    const image = await waitFor(() => imageFor(container));
    // jsdom reports naturalWidth/naturalHeight of 0 unless patched.

    await expect(fireEvent.load(image)).resolves.toBe(true);
    expect(image.style.getPropertyValue("--crop-height")).toBe("");
  });

  it("records no crop when a 2d context is unavailable", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    const { container } = render(InterrogationSubjectArt, { portrait });
    const image = await waitFor(() => imageFor(container));
    setImageSize(image);

    await expect(fireEvent.load(image)).resolves.toBe(true);
    expect(image.style.getPropertyValue("--crop-height")).toBe("");
  });

  it("records no crop when pixel reading throws", async () => {
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        throw new DOMException("tainted", "SecurityError");
      }),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context,
    );

    const { container } = render(InterrogationSubjectArt, { portrait });
    const image = await waitFor(() => imageFor(container));
    setImageSize(image);

    await expect(fireEvent.load(image)).resolves.toBe(true);
    expect(image.style.getPropertyValue("--crop-height")).toBe("");
  });

  it("swaps to the placeholder when the resolved asset fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(InterrogationSubjectArt, { portrait });
    const image = await waitFor(() => {
      const candidate = imageFor(container);
      expect(candidate.src).not.toContain("PORTRAIT");
      return candidate;
    });

    await expect(fireEvent.error(image)).resolves.toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(imageFor(container).src).toContain("PORTRAIT");
    });
  });
});
