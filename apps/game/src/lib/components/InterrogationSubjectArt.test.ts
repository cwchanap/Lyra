import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
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

  it("skips the resolved assignment when the portrait changes before resolution settles", async () => {
    // When the portrait prop changes before resolveStoryAsset settles, the
    // $effect cleanup sets cancelled=true. The .then callback must skip the
    // `resolved = asset` assignment for the stale asset.
    const firstPromiseControllers: {
      resolve: (asset: {
        url: string;
        placeholder: boolean;
        assetId: string;
      }) => void;
    }[] = [];
    resolveStoryAssetMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          firstPromiseControllers.push({ resolve });
        }),
    );

    const otherPortrait: PortraitRef = {
      characterId: "soma_ritsu",
      expression: "focused",
      assetId: "portrait.soma_ritsu.focused",
    };

    const { container, rerender } = render(InterrogationSubjectArt, {
      portrait,
    });

    // Wait for the $effect to run and call resolveStoryAsset, capturing
    // the first promise's resolve function.
    await waitFor(() => expect(resolveStoryAssetMock).toHaveBeenCalledOnce());
    expect(firstPromiseControllers).toHaveLength(1);

    // Switch to a different portrait before the first resolve settles.
    rerender({ portrait: otherPortrait });
    // Flush Svelte effects so the $effect cleanup sets cancelled=true.
    await tick();

    // Now resolve the stale (first) promise. The cancelled guard must skip
    // the assignment, so no image for the first portrait appears.
    firstPromiseControllers[0].resolve({
      url: "/stale-asset.png",
      placeholder: false,
      assetId: "portrait.miyake_sota.standard",
    });

    await waitFor(() => {
      const image = container.querySelector(
        "img.interrogation-subject-portrait",
      ) as HTMLImageElement | null;
      // The stale asset URL must not appear; the component should either
      // have no image or show the second portrait's resolved/placeholder.
      expect(image?.src ?? "").not.toContain("/stale-asset.png");
    });
  });

  it("skips the placeholder assignment when the portrait changes before rejection settles", async () => {
    // When the portrait prop changes before resolveStoryAsset rejects, the
    // $effect cleanup sets cancelled=true. The .catch callback must skip the
    // placeholder assignment for the stale asset.
    const firstPromiseControllers: {
      reject: (error: Error) => void;
    }[] = [];
    resolveStoryAssetMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          firstPromiseControllers.push({ reject });
        }),
    );

    const otherPortrait: PortraitRef = {
      characterId: "soma_ritsu",
      expression: "focused",
      assetId: "portrait.soma_ritsu.focused",
    };

    const { container, rerender } = render(InterrogationSubjectArt, {
      portrait,
    });

    // Wait for the $effect to run and call resolveStoryAsset, capturing
    // the first promise's reject function.
    await waitFor(() => expect(resolveStoryAssetMock).toHaveBeenCalledOnce());
    expect(firstPromiseControllers).toHaveLength(1);

    // Switch to a different portrait before the first rejection settles.
    rerender({ portrait: otherPortrait });
    // Flush Svelte effects so the $effect cleanup sets cancelled=true.
    await tick();

    // Now reject the stale (first) promise. The cancelled guard must skip
    // the placeholder assignment, so no PORTRAIT placeholder for the first
    // asset appears.
    firstPromiseControllers[0].reject(new Error("stale asset unavailable"));

    await waitFor(() => {
      const images = container.querySelectorAll(
        "img.interrogation-subject-portrait",
      ) as NodeListOf<HTMLImageElement>;
      // No image should show the first portrait's placeholder asset ID.
      for (const img of images) {
        expect(img.src).not.toContain("miyake_sota");
      }
    });
  });

  it("skips crop recalculation when the same asset reloads after a portrait swap", async () => {
    // After a portrait loads and its crop is cached, switching away and back
    // creates a new CrossfadeImage layer for the same asset. When it loads
    // again, handleImageLoad finds the cached crop and returns early.
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4 * 4 * 4) })),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context,
    );

    const otherPortrait: PortraitRef = {
      characterId: "soma_ritsu",
      expression: "focused",
      assetId: "portrait.soma_ritsu.focused",
    };

    const { container, rerender } = render(InterrogationSubjectArt, {
      portrait,
    });
    const firstImage = await waitFor(() => imageFor(container));
    setImageSize(firstImage);

    // Load the first portrait — this caches the crop.
    await fireEvent.load(firstImage);
    await waitFor(() => {
      expect(context.getImageData).toHaveBeenCalledOnce();
    });

    // Switch to a different portrait.
    rerender({ portrait: otherPortrait });
    // Wait for the other portrait's image to appear.
    await waitFor(() => {
      const img = imageFor(container);
      expect(img.src).toContain("soma_ritsu");
    });

    // Switch back to the first portrait.
    rerender({ portrait });
    // Wait for the first portrait's image to reappear.
    const backImage = await waitFor(() => {
      const img = imageFor(container);
      expect(img.src).toContain("miyake_sota");
      return img;
    });
    setImageSize(backImage);

    // Fire load on the reappeared image. handleImageLoad should find the
    // cached crop and return early — getImageData must NOT be called again.
    await fireEvent.load(backImage);
    expect(context.getImageData).toHaveBeenCalledOnce();
  });
});
