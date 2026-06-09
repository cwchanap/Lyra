import { render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ExploreView from "./ExploreView.svelte";
import type { SceneView, SublocationView } from "../state/types";

const sublocation: SublocationView = {
  id: "coffee_shop",
  label: "喫茶店",
  sceneTag: "雨夜喫茶店",
  hotspots: [
    {
      id: "table",
      label: "桌面",
      description: "濕掉的收據壓在杯底。",
      inspected: false,
      layout: { kind: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
    },
  ],
  characters: [],
};

function investigationScene(
  currentId: string | null = "coffee_shop",
): SceneView & { kind: "investigation" } {
  return {
    kind: "investigation",
    id: "inv_scene",
    title: "調査開始",
    index: 0,
    total: 1,
    currentSublocationId: currentId,
    visibleSublocations: currentId ? [sublocation] : [],
  };
}

describe("ExploreView", () => {
  it("renders InvestigationSceneSurface when investigation scene has a current sublocation", async () => {
    render(ExploreView, {
      scene: investigationScene(),
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /調查：桌面/ }),
      ).toBeInTheDocument();
    });
  });

  it("renders muted message when investigation has no current sublocation", () => {
    render(ExploreView, {
      scene: {
        kind: "investigation",
        id: "inv_scene",
        title: "調査開始",
        index: 0,
        total: 1,
        currentSublocationId: null,
        visibleSublocations: [sublocation],
      },
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
    });

    expect(screen.getByText("尚未進入任何地點。")).toBeInTheDocument();
  });

  it("renders nothing for a non-investigation scene", () => {
    const { container } = render(ExploreView, {
      scene: {
        kind: "linear",
        id: "intro",
        title: "序章",
        index: 0,
        total: 1,
      },
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
    });

    expect(container.querySelector("button")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("尚未進入");
  });

  it("passes disabled prop to surface and nav", async () => {
    render(ExploreView, {
      scene: investigationScene(),
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
      disabled: true,
    });

    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      for (const btn of buttons) {
        expect(btn).toBeDisabled();
      }
    });
  });

  it("wires onInspect through to InvestigationSceneSurface", async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();

    render(ExploreView, {
      scene: investigationScene(),
      onInspect,
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /調查：桌面/ }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /調查：桌面/ }));
    expect(onInspect).toHaveBeenCalledWith("table");
  });

  it("renders SublocationNav with scene placement", async () => {
    render(ExploreView, {
      scene: investigationScene(),
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.getByText("地點 · LOCATIONS")).toBeInTheDocument();
    });
  });
});
