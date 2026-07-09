import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import SceneBackdrop from "./SceneBackdrop.svelte";

describe("SceneBackdrop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the background image when backgroundAssetId is provided", async () => {
    const { container } = render(SceneBackdrop, {
      sceneTag: null,
      backgroundAssetId: "background.chapter_1.scene_0.render_test",
    });

    await waitFor(() => {
      const img = container.querySelector(
        "img.background-image",
      ) as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.getAttribute("src")).toBe(
        "/assets/backgrounds/chapter_1/scene_0/render_test.png",
      );
      expect(img.style.getPropertyValue("--crossfade-visible-opacity")).toBe(
        "0.52",
      );
    });
  });

  it("places the background image in a lower layer with negative z-index", async () => {
    // Scoped CSS is not injected into jsdom's document.styleSheets, so we
    // verify the source Svelte file directly to prevent accidental regression
    // of the z-index back to a positive value (which causes the backdrop to
    // paint over the game UI).
    const source = readFileSync(
      resolve(import.meta.dirname!, "SceneBackdrop.svelte"),
      "utf-8",
    );
    const match = source.match(
      /(?::global\()?\.background-image\)?\s*\{[^}]*z-index:\s*(-?\d+)/s,
    );
    expect(match).toBeTruthy();
    expect(parseInt(match![1], 10)).toBeLessThan(0);
  });

  it("falls back to a background placeholder when the image fails to load", async () => {
    const { container } = render(SceneBackdrop, {
      sceneTag: "雨夜咖啡館",
      backgroundAssetId:
        "background.chapter_1.scene_0.load_error_component_test",
    });

    expect(container).toHaveTextContent("雨夜咖啡館");
    await waitFor(() => {
      expect(container.querySelector("img.background-image")).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/load_error_component_test.png",
      );
    });

    const image = container.querySelector(
      "img.background-image",
    ) as HTMLImageElement;
    image.dispatchEvent(new Event("error"));

    await waitFor(() => {
      const images = container.querySelectorAll("img.background-image");
      expect(images).toHaveLength(2);
      expect(images[1]).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });

    const placeholder = container.querySelectorAll(
      "img.background-image",
    )[1] as HTMLImageElement;
    placeholder.dispatchEvent(new Event("load"));

    await waitFor(() => {
      const images = container.querySelectorAll("img.background-image");
      expect(images[1]).toHaveClass("visible");
      expect(images[0]).toHaveClass("leaving");
    });
  });

  it("crossfades between background asset changes without removing the old image first", async () => {
    const { container, rerender } = render(SceneBackdrop, {
      sceneTag: null,
      backgroundAssetId: "background.chapter_1.scene_0.old",
    });

    await waitFor(() => {
      expect(container.querySelector("img.background-image")).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/old.png",
      );
    });

    await rerender({
      sceneTag: null,
      backgroundAssetId: "background.chapter_1.scene_0.new",
    });

    await waitFor(() => {
      const images = container.querySelectorAll("img.background-image");
      expect(images.length).toBe(2);
      expect(images[0]).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/old.png",
      );
      expect(images[1]).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/new.png",
      );
    });
  });

  it("uses the shared crossfade image primitive for backdrop rendering", () => {
    const source = readFileSync(
      resolve(import.meta.dirname!, "SceneBackdrop.svelte"),
      "utf-8",
    );
    expect(source).toContain(
      'import CrossfadeImage from "./CrossfadeImage.svelte"',
    );
    expect(source).toContain("<CrossfadeImage");
    expect(source).toContain('imageClass="background-image"');
  });

  it("scopes the backdrop background selector to the component-owned surface", () => {
    const source = readFileSync(
      resolve(import.meta.dirname!, "SceneBackdrop.svelte"),
      "utf-8",
    );

    expect(source).toContain(".backdrop :global(img.background-image)");
    expect(source).not.toContain(":global(.background-image) {");
  });
});
