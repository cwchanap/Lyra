import { render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import InvestigationMapView from "./InvestigationMapView.svelte";
import type { InvestigationMapView as MapView } from "../state/types";
import { cssRule } from "$lib/test-utils";

const { resolveStoryAssetCalls } = vi.hoisted(() => ({
  resolveStoryAssetCalls: vi.fn(),
}));

vi.mock("$lib/assets/story-assets", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/assets/story-assets")>();
  return {
    ...actual,
    // Wrap (not replace) so real resolution still runs for every test while
    // recording which asset IDs the component resolves.
    resolveStoryAsset: (
      assetId: Parameters<typeof actual.resolveStoryAsset>[0],
      type: Parameters<typeof actual.resolveStoryAsset>[1],
    ) => {
      resolveStoryAssetCalls(assetId, type);
      return actual.resolveStoryAsset(assetId, type);
    },
  };
});

const map: MapView = {
  id: "city_map.tokyo",
  backgroundAssetId: "background.city_map.tokyo",
  nodes: [{ sublocationId: "rain_bell_cafe", x: 0.35, y: 0.6 }],
};

const sublocations = [
  {
    id: "rain_bell_cafe",
    label: "雨鐘咖啡館",
    sceneTag: "雨鐘咖啡館",
    hotspots: [],
    characters: [],
  },
];

const summary = "調查增田圭死亡現場。";

function mapSource() {
  return readFileSync(
    join(process.cwd(), "src/lib/components/InvestigationMapView.svelte"),
    "utf8",
  );
}

function renderMap(overrides: Partial<{ disabled: boolean }> = {}) {
  return render(InvestigationMapView, {
    map,
    sublocations,
    summary,
    onTravel: vi.fn(),
    ...overrides,
  });
}

describe("InvestigationMapView", () => {
  it("renders a responsive 16:9 map plane that owns its background", async () => {
    renderMap();
    const planeRule = cssRule(mapSource(), ".map-plane");
    expect(planeRule).toContain("aspect-ratio: 16 / 9");

    // One coordinate plane: the background fills the plane box exactly, so
    // normalized pin coordinates cannot drift off the raster on resize.
    const backgroundRule = cssRule(
      mapSource(),
      ".map-plane :global(img.map-background)",
    );
    expect(backgroundRule).toContain("position: absolute");
    expect(backgroundRule).toContain("inset: 0");
    await waitFor(() => {
      const plane = document.querySelector(".map-plane");
      expect(plane?.querySelector("img.map-background")).not.toBeNull();
    });
  });

  it("resolves the city-map background through the story-asset resolver", async () => {
    const { container } = renderMap();

    await waitFor(() => {
      expect(resolveStoryAssetCalls).toHaveBeenCalledWith(
        "background.city_map.tokyo",
        "background",
      );
      expect(container.querySelector("img.map-background")).toHaveAttribute(
        "src",
        "/assets/backgrounds/city_map/tokyo.png",
      );
    });
  });

  it("renders a native destination button with an accessible name and deterministic attribute", () => {
    renderMap();

    const button = screen.getByRole("button", {
      name: "前往：雨鐘咖啡館 — 調查增田圭死亡現場。",
    });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("data-map-destination", "rain_bell_cafe");
    expect(button.style.getPropertyValue("--x")).toBe("35%");
    expect(button.style.getPropertyValue("--y")).toBe("60%");
  });

  it("invokes onTravel exactly once per activation", async () => {
    const user = userEvent.setup();
    const onTravel = vi.fn();
    render(InvestigationMapView, {
      map,
      sublocations,
      summary,
      onTravel,
    });

    await user.click(
      screen.getByRole("button", {
        name: "前往：雨鐘咖啡館 — 調查增田圭死亡現場。",
      }),
    );
    expect(onTravel).toHaveBeenCalledTimes(1);
    expect(onTravel).toHaveBeenCalledWith("rain_bell_cafe");
  });

  it("disables destinations while a gameplay command is in flight", async () => {
    const user = userEvent.setup();
    const onTravel = vi.fn();
    render(InvestigationMapView, {
      map,
      sublocations,
      summary,
      onTravel,
      disabled: true,
    });

    const button = screen.getByRole("button", {
      name: "前往：雨鐘咖啡館 — 調查增田圭死亡現場。",
    });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onTravel).not.toHaveBeenCalled();
  });

  it("renders only projected nodes in authored order as keyboard focus order", () => {
    const twoNodeMap: MapView = {
      id: "city_map.tokyo",
      backgroundAssetId: "background.city_map.tokyo",
      nodes: [
        { sublocationId: "rain_bell_cafe", x: 0.35, y: 0.6 },
        { sublocationId: "police_meeting_room", x: 0.7, y: 0.3 },
      ],
    };
    const allSublocations = [
      ...sublocations,
      {
        id: "police_meeting_room",
        label: "警署臨時會面室",
        sceneTag: "警署臨時會面室",
        hotspots: [],
        characters: [],
      },
      {
        id: "kichijoji_shopping_street",
        label: "吉祥寺商店街",
        sceneTag: "吉祥寺商店街",
        hotspots: [],
        characters: [],
      },
    ];

    render(InvestigationMapView, {
      map: twoNodeMap,
      sublocations: allSublocations,
      summary,
      onTravel: vi.fn(),
    });

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute(
      "data-map-destination",
      "rain_bell_cafe",
    );
    expect(buttons[1]).toHaveAttribute(
      "data-map-destination",
      "police_meeting_room",
    );

    // Authored DOM order is the native keyboard focus order for buttons:
    // the first destination precedes the second in document order.
    expect(
      buttons[0].compareDocumentPosition(buttons[1]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    // Unavailable topology nodes are absent: kichijoji_shopping_street is a
    // visible sublocation but is not projected onto the map.
    expect(
      screen.queryByRole("button", { name: /吉祥寺商店街/ }),
    ).not.toBeInTheDocument();
  });

  it("never presents visited or completed state", () => {
    renderMap();

    expect(document.querySelector(".visited")).not.toBeInTheDocument();
    expect(document.querySelector(".completed")).not.toBeInTheDocument();
    expect(screen.queryByText("已調查")).not.toBeInTheDocument();
    expect(mapSource()).not.toMatch(/visited|completed|已調查/);
  });
});
