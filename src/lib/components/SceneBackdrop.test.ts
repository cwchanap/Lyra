import { render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import SceneBackdrop from "./SceneBackdrop.svelte";

describe("SceneBackdrop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to a background placeholder when the image fails to load", async () => {
    const { container } = render(SceneBackdrop, {
      sceneTag: "雨夜咖啡館",
      backgroundAssetId: "background.chapter_1.scene_0.load_error_component_test",
    });

    expect(container).toHaveTextContent("雨夜咖啡館");
    await waitFor(() => {
      expect(container.querySelector("img.background-image")).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/load_error_component_test.png",
      );
    });

    const image = container.querySelector("img.background-image") as HTMLImageElement;
    image.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(container.querySelector("img.background-image")).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });
});
