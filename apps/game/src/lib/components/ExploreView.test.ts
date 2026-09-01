import { render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { createRawSnippet } from "svelte";
import { describe, expect, it, vi } from "vitest";
import ExploreView from "./ExploreView.svelte";
import type {
  InvestigationMapView,
  SceneView,
  SublocationView,
} from "../state/types";

const cityMap: InvestigationMapView = {
  id: "city_map.tokyo",
  backgroundAssetId: "background.city_map.tokyo",
  nodes: [{ sublocationId: "coffee_shop", x: 0.5, y: 0.5 }],
};

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
  map: InvestigationMapView | null = null,
): SceneView & { kind: "investigation" } {
  return {
    kind: "investigation",
    id: "inv_scene",
    title: "調査開始",
    summary: "調查增田圭死亡現場。",
    index: 0,
    total: 1,
    currentSublocationId: currentId,
    map,
    visibleSublocations: [sublocation],
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
      scene: investigationScene(null),
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
    });

    expect(screen.getByText("尚未進入任何地點。")).toBeInTheDocument();
  });

  it("renders the city map when the scene is mapped and no sublocation is entered", () => {
    render(ExploreView, {
      scene: investigationScene(null, cityMap),
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
    });

    expect(
      screen.getByRole("button", {
        name: /前往：喫茶店 — 調查增田圭死亡現場。/,
      }),
    ).toHaveAttribute("data-map-destination", "coffee_shop");
    expect(screen.queryByText("尚未進入任何地點。")).not.toBeInTheDocument();
  });

  it("never renders SublocationNav for a mapped scene, even after entering", () => {
    render(ExploreView, {
      scene: investigationScene("coffee_shop", cityMap),
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
    });

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("地點 · LOCATIONS")).not.toBeInTheDocument();
  });

  it("renders the city map without SublocationNav while pending destination selection", () => {
    render(ExploreView, {
      scene: investigationScene(null, cityMap),
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
    });

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("renders InvestigationSceneSurface with SublocationNav for a mapless entered scene", () => {
    render(ExploreView, {
      scene: investigationScene("coffee_shop"),
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
    });

    expect(
      screen.getByRole("navigation", { name: "地點導航" }),
    ).toBeInTheDocument();
  });

  it("renders nothing for a non-investigation scene", () => {
    const { container } = render(ExploreView, {
      scene: {
        kind: "linear",
        id: "intro",
        title: "序章",
        summary: "",
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

  it("renders a supplied HUD once beside the existing sublocation navigation", async () => {
    const hud = createRawSnippet(() => ({
      render: () => '<p data-testid="primary-objective-hud">追查雨夜目擊者</p>',
    }));

    render(ExploreView, {
      scene: investigationScene(),
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
      hud,
    });

    await waitFor(() => {
      const sceneHud = document.querySelector(".scene-hud");
      const navigation = screen.getByRole("navigation", {
        name: "地點導航",
      });
      const objectiveHud = screen.getByTestId("primary-objective-hud");

      expect(sceneHud).toContainElement(navigation);
      expect(sceneHud).toContainElement(objectiveHud);
      expect(screen.getAllByTestId("primary-objective-hud")).toHaveLength(1);
      expect(
        navigation.compareDocumentPosition(objectiveHud) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
    });
  });

  it("anchors the navigator and objective in a shared container instead of pinning each at the same top offset", async () => {
    // Regression guard for the exploration HUD overlap: the navigator and
    // the primary objective must share one positioned container (`.explore-hud`,
    // laid out as a wrapping flex row) so they can never independently pin the
    // same `top` and collide. With many locations the navigator wraps taller;
    // the objective flows after it instead of overlapping. jsdom does not
    // compute stylesheet layout, so this asserts the DOM contract the CSS
    // depends on: both HUDs share a single `.explore-hud` host, in order.
    const manySublocations: SublocationView[] = Array.from(
      { length: 8 },
      (_, index) => ({
        id: `loc_${index}`,
        label: `地點 ${index + 1}`,
        sceneTag: `場景 ${index + 1}`,
        hotspots: [],
        characters: [],
      }),
    );
    const scene: SceneView & { kind: "investigation" } = {
      kind: "investigation",
      id: "inv_scene",
      title: "調査開始",
      summary: "",
      index: 0,
      total: 1,
      currentSublocationId: "loc_0",
      map: null,
      visibleSublocations: manySublocations,
    };
    const hud = createRawSnippet(() => ({
      render: () =>
        '<section class="primary-objective-hud"><p>追查雨夜目擊者</p></section>',
    }));

    render(ExploreView, {
      scene,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      onEnterSublocation: vi.fn(),
      hud,
    });

    await waitFor(() => {
      expect(
        screen.getByRole("navigation", { name: "地點導航" }),
      ).toBeInTheDocument();
    });

    const navigation = screen.getByRole("navigation", { name: "地點導航" });
    const objectiveHud = document.querySelector(
      ".primary-objective-hud",
    ) as HTMLElement | null;
    expect(objectiveHud).not.toBeNull();

    // Both HUDs resolve to the SAME `.explore-hud` ancestor — the single
    // positioned host — rather than each anchoring itself independently.
    const navHost = navigation.closest(".explore-hud");
    const objectiveHost = objectiveHud!.closest(".explore-hud");
    expect(navHost).not.toBeNull();
    expect(navHost).toBe(objectiveHost);
    expect(navHost!.parentElement).toBe(document.querySelector(".scene-hud"));

    // The objective follows the navigator in document order; when the wrapped
    // navigator grows tall the objective flows after it instead of overlapping.
    expect(
      navigation.compareDocumentPosition(objectiveHud!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    // The navigator keeps its scene styling and its wrapping chip row, so a
    // long location list grows the navigator height (which the shared host
    // accounts for).
    expect(navigation).toHaveClass("scene");
    expect(navigation.querySelector(".chips")).not.toBeNull();
  });
});
