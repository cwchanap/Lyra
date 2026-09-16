import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
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
  nodes: [{ sublocationId: "rain_bell_cafe", regionId: null, x: 0.35, y: 0.6 }],
  regions: [],
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

const extendedSublocations = [
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

const summary = "調查增田圭死亡現場。";

const cafeLabel = "前往：雨鐘咖啡館 — 調查增田圭死亡現場。";
const policeLabel = "前往：警署臨時會面室 — 調查增田圭死亡現場。";

const kichijojiRegion = {
  id: "kichijoji",
  label: "吉祥寺",
  x: 0.09,
  y: 0.42,
  backgroundAssetId: "background.city_map.kichijoji",
};

const multiRegionMap: MapView = {
  id: "city_map.tokyo",
  backgroundAssetId: "background.city_map.tokyo",
  regions: [
    kichijojiRegion,
    {
      id: "shibuya",
      label: "澀谷",
      x: 0.324,
      y: 0.588,
      backgroundAssetId: "background.city_map.shibuya",
    },
  ],
  nodes: [
    { sublocationId: "rain_bell_cafe", regionId: "kichijoji", x: 0.2, y: 0.5 },
    { sublocationId: "police_meeting_room", regionId: null, x: 0.7, y: 0.3 },
  ],
};

function mapSource() {
  return readFileSync(
    join(process.cwd(), "src/lib/components/InvestigationMapView.svelte"),
    "utf8",
  );
}

/**
 * jsdom never fires real image load events, so the raster-load gate must be
 * opened by hand. Fires load on every map-background img: CrossfadeImage
 * ignores the event for leaving/stale layers and forwards the current one.
 */
async function loadMapBackground() {
  await waitFor(() => {
    expect(document.querySelector("img.map-background")).not.toBeNull();
  });
  for (const image of document.querySelectorAll("img.map-background")) {
    await fireEvent.load(image as HTMLImageElement);
  }
}

async function renderMap(
  overrides: Partial<{
    map: MapView;
    sublocations: typeof sublocations | typeof extendedSublocations;
    disabled: boolean;
    onTravel: (id: string) => void;
  }> = {},
) {
  const result = render(InvestigationMapView, {
    map,
    sublocations,
    summary,
    onTravel: vi.fn(),
    ...overrides,
  });
  await loadMapBackground();
  return result;
}

describe("InvestigationMapView", () => {
  it("renders a responsive 16:9 map plane that owns its background", async () => {
    render(InvestigationMapView, {
      map,
      sublocations,
      summary,
      onTravel: vi.fn(),
    });
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
    const { container } = render(InvestigationMapView, {
      map,
      sublocations,
      summary,
      onTravel: vi.fn(),
    });

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

  it("renders a native destination button with an accessible name and deterministic attribute", async () => {
    await renderMap();

    const button = screen.getByRole("button", { name: cafeLabel });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("data-map-destination", "rain_bell_cafe");
    expect(button.style.getPropertyValue("--x")).toBe("35%");
    expect(button.style.getPropertyValue("--y")).toBe("60%");
  });

  it("invokes onTravel exactly once per activation", async () => {
    const user = userEvent.setup();
    const onTravel = vi.fn();
    await renderMap({ onTravel });

    await user.click(screen.getByRole("button", { name: cafeLabel }));
    expect(onTravel).toHaveBeenCalledTimes(1);
    expect(onTravel).toHaveBeenCalledWith("rain_bell_cafe");
  });

  it("disables destinations while a gameplay command is in flight", async () => {
    const user = userEvent.setup();
    const onTravel = vi.fn();
    await renderMap({ onTravel, disabled: true });

    const button = screen.getByRole("button", { name: cafeLabel });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onTravel).not.toHaveBeenCalled();
  });

  it("renders only projected nodes in authored order as keyboard focus order", async () => {
    const twoNodeMap: MapView = {
      id: "city_map.tokyo",
      backgroundAssetId: "background.city_map.tokyo",
      nodes: [
        { sublocationId: "rain_bell_cafe", regionId: null, x: 0.35, y: 0.6 },
        {
          sublocationId: "police_meeting_room",
          regionId: null,
          x: 0.7,
          y: 0.3,
        },
      ],
      regions: [],
    };
    await renderMap({ map: twoNodeMap, sublocations: extendedSublocations });

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

  it("never presents visited or completed state", async () => {
    await renderMap();

    expect(document.querySelector(".visited")).not.toBeInTheDocument();
    expect(document.querySelector(".completed")).not.toBeInTheDocument();
    expect(screen.queryByText("已調查")).not.toBeInTheDocument();
    expect(mapSource()).not.toMatch(/visited|completed|已調查/);
  });

  it("switches planes with region controls and the overview return control without any gameplay travel", async () => {
    const user = userEvent.setup();
    const onTravel = vi.fn();
    await renderMap({
      map: multiRegionMap,
      sublocations: extendedSublocations,
      onTravel,
    });

    // Overview plane: overview-direct leaf plus projected region controls;
    // the district leaf waits for its region.
    const police = screen.getByRole("button", { name: policeLabel });
    expect(police).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: cafeLabel }),
    ).not.toBeInTheDocument();
    const regionControl = screen.getByRole("button", {
      name: "檢視吉祥寺地圖",
    });
    expect(regionControl).toHaveAttribute("data-map-region", "kichijoji");

    await user.click(regionControl);
    // Region switching is presentation-only: no gameplay command, and markers
    // wait for the district raster to load before showing district leaves.
    expect(onTravel).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: cafeLabel }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: policeLabel }),
    ).not.toBeInTheDocument();

    await loadMapBackground();
    expect(screen.getByRole("button", { name: cafeLabel })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: policeLabel }),
    ).not.toBeInTheDocument();
    // District planes carry no region controls, only the return control.
    expect(
      screen.queryByRole("button", { name: "檢視吉祥寺地圖" }),
    ).not.toBeInTheDocument();
    const returnControl = screen.getByRole("button", {
      name: "返回全景地圖",
    });
    expect(returnControl).toHaveAttribute("data-map-overview");

    await user.click(returnControl);
    expect(onTravel).not.toHaveBeenCalled();

    await loadMapBackground();
    expect(
      screen.getByRole("button", { name: policeLabel }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: cafeLabel }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "檢視吉祥寺地圖" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "返回全景地圖" }),
    ).not.toBeInTheDocument();
  });

  it("gates markers until the returned-to plane's own raster settles in rapid A→B→A (final raster and markers both A)", async () => {
    const user = userEvent.setup();
    const onTravel = vi.fn();
    await renderMap({
      map: multiRegionMap,
      sublocations: extendedSublocations,
      onTravel,
    });

    // A settled: overview raster loaded, overview markers visible.
    expect(
      screen.getByRole("button", { name: policeLabel }),
    ).toBeInTheDocument();

    // → B: enter the district and DO NOT settle its raster.
    await user.click(screen.getByRole("button", { name: "檢視吉祥寺地圖" }));
    expect(
      screen.queryByRole("button", { name: policeLabel }),
    ).not.toBeInTheDocument();

    // → A before B settles: the stale overview load confirmation must not
    // reopen markers over the still-pending re-requested overview raster.
    await user.click(screen.getByRole("button", { name: "返回全景地圖" }));
    expect(onTravel).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: policeLabel }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "檢視吉祥寺地圖" }),
    ).not.toBeInTheDocument();

    // The re-requested overview raster settles: markers return on A.
    await loadMapBackground();
    expect(
      screen.getByRole("button", { name: policeLabel }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "檢視吉祥寺地圖" }),
    ).toBeInTheDocument();
  });

  it("opens a single-region map directly on its district plane", async () => {
    const singleRegionMap: MapView = {
      id: "city_map.tokyo",
      backgroundAssetId: "background.city_map.kichijoji",
      regions: [kichijojiRegion],
      nodes: [
        {
          sublocationId: "rain_bell_cafe",
          regionId: "kichijoji",
          x: 0.2,
          y: 0.5,
        },
      ],
    };
    await renderMap({ map: singleRegionMap });

    expect(resolveStoryAssetCalls).toHaveBeenCalledWith(
      "background.city_map.kichijoji",
      "background",
    );
    expect(screen.getByRole("button", { name: cafeLabel })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "檢視吉祥寺地圖" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "返回全景地圖" }),
    ).toBeInTheDocument();
  });

  it("opens markers on background error so the active plane stays navigable", async () => {
    const user = userEvent.setup();
    const onTravel = vi.fn();
    const singleRegionMap: MapView = {
      id: "city_map.tokyo",
      backgroundAssetId: "background.city_map.kichijoji",
      regions: [kichijojiRegion],
      nodes: [
        {
          sublocationId: "rain_bell_cafe",
          regionId: "kichijoji",
          x: 0.2,
          y: 0.5,
        },
      ],
    };
    render(InvestigationMapView, {
      map: singleRegionMap,
      sublocations,
      summary,
      onTravel,
    });

    await waitFor(() => {
      expect(document.querySelector("img.map-background")).not.toBeNull();
    });
    await fireEvent.error(
      document.querySelector("img.map-background") as HTMLImageElement,
    );

    // The failed raster opens its plane's controls immediately.
    const pin = screen.getByRole("button", { name: cafeLabel });
    expect(pin).toBeEnabled();

    // The placeholder fallback still renders and the leaf still travels.
    await waitFor(() => {
      const images = Array.from(
        document.querySelectorAll("img.map-background"),
      );
      expect(
        images.some((image) =>
          (image.getAttribute("src") ?? "").startsWith("data:image/svg"),
        ),
      ).toBe(true);
    });
    await user.click(pin);
    expect(onTravel).toHaveBeenCalledTimes(1);
    expect(onTravel).toHaveBeenCalledWith("rain_bell_cafe");
  });

  it("renders plane controls immediately when the plane has no background raster", () => {
    const nullRasterMap: MapView = {
      id: "city_map.tokyo",
      backgroundAssetId: null,
      regions: [kichijojiRegion],
      nodes: [
        {
          sublocationId: "police_meeting_room",
          regionId: null,
          x: 0.7,
          y: 0.3,
        },
        {
          sublocationId: "rain_bell_cafe",
          regionId: "kichijoji",
          x: 0.2,
          y: 0.5,
        },
      ],
    };
    render(InvestigationMapView, {
      map: nullRasterMap,
      sublocations: extendedSublocations,
      summary,
      onTravel: vi.fn(),
    });

    // No load event has fired: raster-less planes bypass the load gate.
    expect(
      screen.getByRole("button", { name: policeLabel }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "檢視吉祥寺地圖" }),
    ).toBeInTheDocument();
  });

  it("keeps pin labels visible and 44px targets at narrow widths with one destination list", async () => {
    await renderMap();

    // lyra-mobile-breakpoint: labels must never be hidden below 720px again.
    expect(mapSource()).not.toContain("display: none");
    expect(cssRule(mapSource(), ".map-pin")).toContain("min-height: 44px");

    // One navigation surface: every button is a map control and there is no
    // secondary textual destination list.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute(
      "data-map-destination",
      "rain_bell_cafe",
    );
    expect(document.querySelector("ul, ol, [role='list']")).toBeNull();
  });
});
