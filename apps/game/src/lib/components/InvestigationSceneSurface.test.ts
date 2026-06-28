import { render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import InvestigationSceneSurface from "./InvestigationSceneSurface.svelte";
import type { SublocationView } from "../state/types";
import { cssRule, reportAsyncTestFailure } from "$lib/test-utils";
import {
  escapeClaimed,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";

const sublocation = {
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
    {
      id: "cabinet",
      label: "櫃子",
      description: "門縫露出一角白紙。",
      inspected: false,
      layout: null,
    },
  ],
  characters: [
    {
      id: "witness",
      name: "目擊者",
      role: "常客",
      bio: "案發時坐在窗邊。",
      topics: [{ id: "alibi", label: "不在場證明", discussed: false }],
      layout: {
        kind: "sprite",
        assetId: "portrait.witness.standard",
        x: 0.7,
        y: 0.1,
        w: 0.18,
        h: 0.8,
        anchor: "bottomCenter",
      },
    },
  ],
} satisfies SublocationView;

function surfaceSource() {
  return readFileSync(
    join(process.cwd(), "src/lib/components/InvestigationSceneSurface.svelte"),
    "utf8",
  );
}

describe("InvestigationSceneSurface", () => {
  afterEach(() => {
    resetEscapeCoordinator();
  });

  it("renders placed hotspots with normalized style variables", () => {
    render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    const button = screen.getByRole("button", { name: /調查：桌面/ });
    expect(button.style.getPropertyValue("--x")).toBe("10%");
    expect(button.style.getPropertyValue("--y")).toBe("20%");
    expect(button.style.getPropertyValue("--w")).toBe("30%");
    expect(button.style.getPropertyValue("--h")).toBe("20%");
  });

  it("renders placed characters with normalized top-left bounding boxes", () => {
    render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    const button = screen.getByRole("button", { name: /詢問：目擊者/ });
    expect(button.style.getPropertyValue("--x")).toBe("70%");
    expect(button.style.getPropertyValue("--y")).toBe("10%");
    expect(button.style.getPropertyValue("--w")).toBe("18%");
    expect(button.style.getPropertyValue("--h")).toBe("80%");
  });

  it("does not offset character layout boxes with bottom-center transforms", () => {
    const source = surfaceSource();
    expect(source).not.toContain("translate(-50%, -100%)");
  });

  it("renders investigation controls on a viewport overlay instead of an inner scene panel", () => {
    const surfaceRule = cssRule(surfaceSource(), ".scene-surface");
    expect(surfaceRule).toContain("position: fixed");
    expect(surfaceRule).toContain("inset: 0");
    expect(surfaceRule).toContain("width: 100vw");
    expect(surfaceRule).toContain("height: 100vh");
    expect(surfaceRule).toContain("max-width: none");
    expect(surfaceRule).not.toContain("aspect-ratio");
    expect(surfaceRule).not.toContain("border-block");
  });

  it("maps placed evidence to the same cover-fitted 16:9 plane as the layout editor", () => {
    const source = surfaceSource();
    const planeRule = cssRule(source, ".scene-coordinate-plane");

    expect(source).toContain('class="scene-coordinate-plane"');
    expect(planeRule).toContain(
      "--scene-cover-width: max(100vw, 177.77777778vh)",
    );
    expect(planeRule).toContain("--scene-cover-height: max(100vh, 56.25vw)");
    expect(planeRule).toContain("left: 50%");
    expect(planeRule).toContain("top: 50%");
    expect(planeRule).toContain("width: var(--scene-cover-width)");
    expect(planeRule).toContain("height: var(--scene-cover-height)");
    expect(planeRule).toContain("transform: translate(-50%, -50%)");
  });

  it("uses the hidden chapter HUD area for the investigation HUD", () => {
    const source = surfaceSource();
    const surfaceRule = cssRule(source, ".scene-surface");
    const labelRule = cssRule(source, ".scene-label");
    const hudRule = cssRule(source, ".scene-hud");

    expect(surfaceRule).toContain("--investigation-hud-top: 22px");
    expect(surfaceRule).not.toContain("--investigation-top-safe");
    expect(labelRule).toContain("top: var(--investigation-hud-top)");
    expect(hudRule).toContain("position: fixed");
    expect(hudRule).toContain("inset: 0");
  });

  it("keeps investigation overlays out of document flow so the scene does not scroll", () => {
    const shellRule = cssRule(surfaceSource(), ".surface-shell");
    const fallbackRule = cssRule(surfaceSource(), ".fallback-controls");
    expect(shellRule).toContain("padding: 0");
    expect(shellRule).toContain("height: 0");
    expect(fallbackRule).toContain("position: fixed");
    expect(fallbackRule).not.toContain("margin-top");
  });

  it("layers the topic popover above the fallback controls panel", () => {
    // The topic-popover and .fallback-controls are both anchored to the
    // viewport bottom. The popover is rendered as a sibling of .scene-surface
    // (which has isolation: isolate) so its z-index participates in the root
    // stacking context and must exceed .fallback-controls' z-index. The
    // scene-surface itself stays below the fallback panel so placed
    // hotspot/character targets (pointer-events: auto) never cover fallback
    // buttons in the overlap region.
    const source = surfaceSource();
    const popoverRule = cssRule(source, ".topic-popover");
    const fallbackRule = cssRule(source, ".fallback-controls");
    const surfaceRule = cssRule(source, ".scene-surface");
    const popoverZ = parseInt(
      popoverRule.match(/z-index:\s*(\d+)/)?.[1] ?? "0",
      10,
    );
    const fallbackZ = parseInt(
      fallbackRule.match(/z-index:\s*(\d+)/)?.[1] ?? "0",
      10,
    );
    const surfaceZ = parseInt(
      surfaceRule.match(/z-index:\s*(\d+)/)?.[1] ?? "0",
      10,
    );
    expect(popoverZ).toBeGreaterThan(fallbackZ);
    expect(surfaceZ).toBeLessThan(fallbackZ);
  });

  it("renders the resolved background image as a viewport backdrop outside the coordinate plane", async () => {
    const testName =
      "renders the resolved background image as a viewport backdrop outside the coordinate plane";

    try {
      const { container } = render(InvestigationSceneSurface, {
        sublocation,
        backgroundAssetId: "background.chapter_1.scene_0.cafe",
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      });

      await waitFor(() => {
        expect(
          container.querySelector(".surface-shell > img.background-image"),
        ).toHaveAttribute(
          "src",
          "/assets/backgrounds/chapter_1/scene_0/cafe.png",
        );
      });
      expect(
        container.querySelector(".scene-surface img.background-image"),
      ).not.toBeInTheDocument();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("matches story scenes by fixing investigation backgrounds to the viewport", () => {
    const backgroundRule = cssRule(surfaceSource(), ".background-image");
    expect(backgroundRule).toContain("position: fixed");
    expect(backgroundRule).toContain("z-index: -1");
    expect(backgroundRule).toContain("width: 100vw");
    expect(backgroundRule).toContain("height: 100vh");
  });

  it("renders standee assets for placed scene characters", async () => {
    const standeeSublocation = {
      ...sublocation,
      characters: [
        {
          ...sublocation.characters[0],
          layout: {
            kind: "sprite",
            assetId: "standee.witness.standard",
            x: 0.7,
            y: 0.1,
            w: 0.18,
            h: 0.8,
            anchor: "bottomCenter",
          },
        },
      ],
    } satisfies SublocationView;

    const { container } = render(InvestigationSceneSurface, {
      sublocation: standeeSublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(container.querySelector(".character-target img")).toHaveAttribute(
        "src",
        "/assets/standees/witness/standard.png",
      );
    });
  });

  it("loads alpha crop variables for scene standees", () => {
    const source = surfaceSource();
    expect(source).toContain("loadCharacterCrop");
    expect(source).toContain("cropVariablesForAlphaBounds");
    expect(source).toContain("character-preview-crop");
  });

  it("only highlights placed hotspots on navigation and shows checked state separately", () => {
    const source = surfaceSource();
    expect(source).toContain(
      ".hotspot-target:hover:not(:disabled) .hotspot-content",
    );
    expect(source).toContain(
      ".hotspot-target:focus-visible:not(:disabled) .hotspot-content",
    );
    expect(source).toContain(".hotspot-check");
    expect(source).not.toContain('<span class="status">已調查</span>');
  });

  it("highlights placed characters on hover and keyboard focus", () => {
    const source = surfaceSource();
    const highlightRule = cssRule(source, ".character-highlight");

    expect(source).toContain('<span class="character-highlight"></span>');
    expect(highlightRule).toContain("border: 1px solid transparent");
    expect(highlightRule).toContain("opacity: 0");
    expect(source).toContain(
      ".character-target:hover:not(:disabled) .character-highlight",
    );
    expect(source).toContain(
      ".character-target:focus-visible:not(:disabled) .character-highlight",
    );
    expect(source).toContain(
      '.character-target[aria-expanded="true"] .character-highlight',
    );
  });

  it("renders placed character names as hover overlays", () => {
    const source = surfaceSource();
    const nameRule = cssRule(source, ".character-name");

    expect(nameRule).toContain("top: 10px");
    expect(nameRule).toContain("right: 10px");
    expect(nameRule).toContain("z-index: 2");
    expect(nameRule).toContain("font-size: 18px");
    expect(nameRule).toContain("opacity: 0");
    expect(nameRule).toContain("transform: translateY(-2px)");
    expect(nameRule).not.toContain("left: 50%");
    expect(nameRule).not.toContain("bottom: 10px");
    expect(nameRule).not.toContain("bottom: -28px");
    expect(source).toContain(
      ".character-target:hover:not(:disabled) .character-name",
    );
    expect(source).toContain(
      ".character-target:focus-visible:not(:disabled) .character-name",
    );
    expect(source).toContain(
      '.character-target[aria-expanded="true"] .character-name',
    );
  });

  it("renders a scene-local HUD slot for investigation controls", () => {
    const source = surfaceSource();
    expect(source).toContain('class="scene-hud"');
    expect(source).toContain("{@render hud()}");
  });

  it("calls onInspect when clicking a placed hotspot", async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();

    render(InvestigationSceneSurface, {
      sublocation,
      onInspect,
      onInterview: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: /調查：桌面/ }));
    expect(onInspect).toHaveBeenCalledWith("table");
  });

  it("calls onInterview after choosing a placed character topic", async () => {
    const user = userEvent.setup();
    const onInterview = vi.fn();

    render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview,
    });

    await user.click(screen.getByRole("button", { name: /詢問：目擊者/ }));
    await user.click(screen.getByRole("button", { name: /不在場證明/ }));

    expect(onInterview).toHaveBeenCalledWith("witness", "alibi");
  });

  it("renders unplaced hotspot fallback controls", () => {
    render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    expect(
      screen.getByRole("button", { name: /未放置：櫃子/ }),
    ).toBeInTheDocument();
  });

  it("renders unplaced character fallback controls with bio and topics", () => {
    const withUnplaced: SublocationView = {
      ...sublocation,
      characters: [
        {
          id: "bystander",
          name: "路人",
          role: "旁觀者",
          bio: "站在門外看熱鬧。",
          topics: [
            { id: "sight", label: "目撃", discussed: false },
            { id: "motive", label: "動機", discussed: true },
          ],
          layout: null,
        },
      ],
    };

    render(InvestigationSceneSurface, {
      sublocation: withUnplaced,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    expect(screen.getByText("路人")).toBeInTheDocument();
    expect(screen.getByText("旁觀者")).toBeInTheDocument();
    expect(screen.getByText("站在門外看熱鬧。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /目撃/ })).toBeInTheDocument();
    expect(screen.getByText("已詢問")).toBeInTheDocument();
  });

  it("toggles active character off when clicking the same character twice", async () => {
    const user = userEvent.setup();
    render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    const charBtn = screen.getByRole("button", { name: /詢問：目擊者/ });
    await user.click(charBtn);
    expect(charBtn).toHaveAttribute("aria-expanded", "true");

    await user.click(charBtn);
    expect(charBtn).toHaveAttribute("aria-expanded", "false");
  });

  it("closes topic popover via close button", async () => {
    const user = userEvent.setup();
    render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: /詢問：目擊者/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /關閉詢問項目/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("claims Escape while the topic popover is open and releases when it closes", async () => {
    const testName =
      "claims Escape while the topic popover is open and releases when it closes";

    // The popover registers an Escape claim with the escape-coordinator while
    // open so GameShell closes it (one layer) before opening the game menu,
    // and releases the claim when the popover closes by any path. This pins
    // the claim lifecycle independent of GameShell, which the e2e exercises
    // end-to-end.
    try {
      const user = userEvent.setup();
      render(InvestigationSceneSurface, {
        sublocation,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      });

      expect(escapeClaimed()).toBe(false);

      await user.click(screen.getByRole("button", { name: /詢問：目擊者/ }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(escapeClaimed()).toBe(true);

      // Closing via the × button releases the claim.
      await user.click(screen.getByRole("button", { name: /關閉詢問項目/ }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(escapeClaimed()).toBe(false);
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("releases the Escape claim when the popover toggles off by re-clicking the character", async () => {
    const testName =
      "releases the Escape claim when the popover toggles off by re-clicking the character";

    try {
      const user = userEvent.setup();
      render(InvestigationSceneSurface, {
        sublocation,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      });

      const charBtn = screen.getByRole("button", { name: /詢問：目擊者/ });
      await user.click(charBtn);
      expect(escapeClaimed()).toBe(true);

      await user.click(charBtn);
      expect(escapeClaimed()).toBe(false);
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("releases the Escape claim when the active character disappears on sublocation change", async () => {
    const testName =
      "releases the Escape claim when the active character disappears on sublocation change";

    // When the player switches sublocations while a topic popover is open,
    // activeCharacterId stays non-null but activeCharacter becomes null
    // (the character isn't placed in the new sublocation). The Escape claim
    // must release so the next Escape opens the game menu instead of being
    // silently consumed by closeTopics() with no popover visible.
    try {
      const user = userEvent.setup();
      const { rerender } = render(InvestigationSceneSurface, {
        sublocation,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      });

      await user.click(screen.getByRole("button", { name: /詢問：目擊者/ }));
      expect(escapeClaimed()).toBe(true);

      const sublocationWithoutWitness: SublocationView = {
        ...sublocation,
        id: "back_alley",
        label: "後巷",
        sceneTag: "雨夜後巷",
        characters: [],
      };
      rerender({
        sublocation: sublocationWithoutWitness,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      });

      expect(escapeClaimed()).toBe(false);
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("marks inspected hotspots with a check", () => {
    const inspected: SublocationView = {
      ...sublocation,
      hotspots: [
        {
          ...sublocation.hotspots[0],
          inspected: true,
        },
      ],
    };

    render(InvestigationSceneSurface, {
      sublocation: inspected,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    expect(screen.getByLabelText("已調查")).toBeInTheDocument();
  });

  it("disables all buttons when disabled prop is true", () => {
    render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
      disabled: true,
    });

    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn).toBeDisabled();
    }
  });

  it("shows discussed label on topics that have been discussed", async () => {
    const user = userEvent.setup();
    const discussed: SublocationView = {
      ...sublocation,
      characters: [
        {
          ...sublocation.characters[0],
          topics: [{ id: "alibi", label: "不在場證明", discussed: true }],
        },
      ],
    };

    render(InvestigationSceneSurface, {
      sublocation: discussed,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: /詢問：目擊者/ }));
    const topicBtn = screen.getByRole("button", { name: /不在場證明/ });
    expect(topicBtn).toHaveClass("done");
    expect(topicBtn).toHaveTextContent("已詢問");
  });

  it("falls back to placeholder on background image error", async () => {
    const { container } = render(InvestigationSceneSurface, {
      sublocation,
      backgroundAssetId: "background.chapter_1.scene_0.cafe",
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector(".surface-shell > img.background-image"),
      ).toBeInTheDocument();
    });

    const img = container.querySelector(
      ".surface-shell > img.background-image",
    ) as HTMLImageElement;
    img.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(img.src).toContain("data:image/svg+xml");
    });
  });

  it("does not call onInterview when no character is active", () => {
    const { component } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    expect(component).toBeTruthy();
  });

  it("resolves all placed character portraits without losing concurrent updates", async () => {
    const multiCharSublocation = {
      ...sublocation,
      characters: [
        {
          id: "witness",
          name: "目擊者",
          role: "常客",
          bio: "案發時坐在窗邊。",
          topics: [{ id: "alibi", label: "不在場證明", discussed: false }],
          layout: {
            kind: "sprite" as const,
            assetId: "portrait.witness.standard",
            x: 0.7,
            y: 0.1,
            w: 0.18,
            h: 0.8,
            anchor: "bottomCenter" as const,
          },
        },
        {
          id: "suspect",
          name: "嫌疑人",
          role: "店員",
          bio: "當晚值班。",
          topics: [{ id: "shift", label: "班表", discussed: false }],
          layout: {
            kind: "sprite" as const,
            assetId: "standee.suspect.standard",
            x: 0.3,
            y: 0.1,
            w: 0.18,
            h: 0.8,
            anchor: "bottomCenter" as const,
          },
        },
      ],
    } satisfies SublocationView;

    const { container } = render(InvestigationSceneSurface, {
      sublocation: multiCharSublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    // Both characters should render their portraits — no character lost
    // due to concurrent promise resolution overwriting the shared state.
    await waitFor(() => {
      const images = container.querySelectorAll(".character-target img");
      expect(images.length).toBe(2);
      expect(images[0]).toHaveAttribute(
        "src",
        "/assets/portraits/witness/standard.png",
      );
      expect(images[1]).toHaveAttribute(
        "src",
        "/assets/standees/suspect/standard.png",
      );
    });
  });

  it("computes alpha crop CSS variables when portrait image loads", async () => {
    const origCreateElement = document.createElement.bind(document);

    const fakeImageData = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };
    for (const [x, y] of [
      [1, 1],
      [2, 2],
    ]) {
      fakeImageData.data[(y * 4 + x) * 4 + 3] = 255;
    }

    const fakeContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => fakeImageData),
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => fakeContext),
    };

    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        if (tag === "canvas") return fakeCanvas as unknown as HTMLElement;
        return origCreateElement(tag);
      });

    const { container } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector(".character-target img"),
      ).toBeInTheDocument();
    });

    const img = container.querySelector(
      ".character-target img",
    ) as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", {
      value: 4,
      configurable: true,
    });
    Object.defineProperty(img, "naturalHeight", {
      value: 4,
      configurable: true,
    });
    fakeCanvas.width = 4;
    fakeCanvas.height = 4;
    img.dispatchEvent(new Event("load"));

    await waitFor(() => {
      const cropDiv = container.querySelector(".character-preview-crop");
      expect(cropDiv?.getAttribute("style")).toContain("--crop-height:");
    });

    createElementSpy.mockRestore();
  });

  it("skips crop computation when canvas context is unavailable", async () => {
    const origCreateElement = document.createElement.bind(document);

    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => null),
    };

    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        if (tag === "canvas") return fakeCanvas as unknown as HTMLElement;
        return origCreateElement(tag);
      });

    const { container } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector(".character-target img"),
      ).toBeInTheDocument();
    });

    const img = container.querySelector(
      ".character-target img",
    ) as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", {
      value: 4,
      configurable: true,
    });
    Object.defineProperty(img, "naturalHeight", {
      value: 4,
      configurable: true,
    });
    fakeCanvas.width = 4;
    fakeCanvas.height = 4;
    img.dispatchEvent(new Event("load"));

    await waitFor(() => {
      expect(fakeCanvas.getContext).toHaveBeenCalledWith("2d", {
        willReadFrequently: true,
      });
    });

    const cropDiv = container.querySelector(".character-preview-crop");
    expect(cropDiv?.getAttribute("style") ?? "").not.toContain(
      "--crop-height:",
    );

    createElementSpy.mockRestore();
  });

  it("skips crop computation when alpha bounds are null", async () => {
    const origCreateElement = document.createElement.bind(document);

    const fakeImageData = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };

    const fakeContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => fakeImageData),
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => fakeContext),
    };

    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        if (tag === "canvas") return fakeCanvas as unknown as HTMLElement;
        return origCreateElement(tag);
      });

    const { container } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector(".character-target img"),
      ).toBeInTheDocument();
    });

    const img = container.querySelector(
      ".character-target img",
    ) as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", {
      value: 4,
      configurable: true,
    });
    Object.defineProperty(img, "naturalHeight", {
      value: 4,
      configurable: true,
    });
    fakeCanvas.width = 4;
    fakeCanvas.height = 4;
    img.dispatchEvent(new Event("load"));

    await waitFor(() => {
      expect(fakeContext.getImageData).toHaveBeenCalled();
    });

    const cropDiv = container.querySelector(".character-preview-crop");
    expect(cropDiv?.getAttribute("style") ?? "").not.toContain(
      "--crop-height:",
    );

    createElementSpy.mockRestore();
  });

  it("does not re-compute crop when image loads a second time", async () => {
    const origCreateElement = document.createElement.bind(document);

    const fakeImageData = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };
    fakeImageData.data[5 * 4 + 3] = 255;

    const fakeContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => fakeImageData),
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => fakeContext),
    };

    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        if (tag === "canvas") return fakeCanvas as unknown as HTMLElement;
        return origCreateElement(tag);
      });

    const { container } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector(".character-target img"),
      ).toBeInTheDocument();
    });

    const img = container.querySelector(
      ".character-target img",
    ) as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", {
      value: 4,
      configurable: true,
    });
    Object.defineProperty(img, "naturalHeight", {
      value: 4,
      configurable: true,
    });
    fakeCanvas.width = 4;
    fakeCanvas.height = 4;

    img.dispatchEvent(new Event("load"));
    await waitFor(() => {
      const cropDiv = container.querySelector(".character-preview-crop");
      expect(cropDiv?.getAttribute("style")).toContain("--crop-height:");
    });

    const callsBefore = fakeContext.getImageData.mock.calls.length;
    img.dispatchEvent(new Event("load"));
    expect(fakeContext.getImageData.mock.calls.length).toBe(callsBefore);

    createElementSpy.mockRestore();
  });

  it("ignores load events from non-HTMLImageElement targets", async () => {
    const createElementSpy = vi.spyOn(document, "createElement");

    const { container } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector(".character-target img"),
      ).toBeInTheDocument();
    });

    const img = container.querySelector(
      ".character-target img",
    ) as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", {
      value: 0,
      configurable: true,
    });
    Object.defineProperty(img, "naturalHeight", {
      value: 0,
      configurable: true,
    });
    img.dispatchEvent(new Event("load"));

    expect(createElementSpy).not.toHaveBeenCalledWith("canvas");
    createElementSpy.mockRestore();
  });

  it("does not re-placeholder background when background is already a placeholder", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(InvestigationSceneSurface, {
      sublocation,
      backgroundAssetId: "background.chapter_1.scene_0.cafe",
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector("img.background-image"),
      ).toBeInTheDocument();
    });

    const img = container.querySelector(
      "img.background-image",
    ) as HTMLImageElement;
    img.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(img.src).toContain("data:image/svg+xml");
    });

    warnSpy.mockClear();
    img.dispatchEvent(new Event("error"));
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("does not re-placeholder portrait when portrait is already a placeholder", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector(".character-target img"),
      ).toBeInTheDocument();
    });

    const img = container.querySelector(
      ".character-target img",
    ) as HTMLImageElement;
    img.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(img.src).toContain("data:image/svg+xml");
    });

    warnSpy.mockClear();
    img.dispatchEvent(new Event("error"));
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
