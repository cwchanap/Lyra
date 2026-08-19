import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortraitRef } from "$lib/state/types";
import InterrogationSubjectArt from "./InterrogationSubjectArt.svelte";

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
});
