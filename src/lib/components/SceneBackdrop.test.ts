import { render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import SceneBackdrop from "./SceneBackdrop.svelte";

describe("SceneBackdrop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a background placeholder when the background image is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));

    const { container } = render(SceneBackdrop, {
      sceneTag: "雨夜咖啡館",
      backgroundAssetId: "background.chapter_1.scene_0.missing_component_test",
    });

    expect(container).toHaveTextContent("雨夜咖啡館");
    await waitFor(() => {
      expect(container.querySelector("img.background-image")).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });
});
