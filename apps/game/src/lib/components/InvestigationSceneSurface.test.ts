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

const { resolveStoryAssetCalls } = vi.hoisted(() => ({
  resolveStoryAssetCalls: vi.fn(),
}));

vi.mock("$lib/assets/story-assets", async (importOriginal) => {
  let actual: typeof import("$lib/assets/story-assets");
  try {
    actual = await importOriginal<typeof import("$lib/assets/story-assets")>();
  } catch (error) {
    console.error(
      "InvestigationSceneSurface.test: vi.mock setup failed to import $lib/assets/story-assets",
      error,
    );
    throw error;
  }
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
    vi.restoreAllMocks();
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
    // Unitless, so the pending cue can place the target in the viewport.
    expect(button.style.getPropertyValue("--x-ratio")).toBe("0.1");
    expect(button.style.getPropertyValue("--y-ratio")).toBe("0.2");
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
    expect(button.style.getPropertyValue("--x-ratio")).toBe("0.7");
    expect(button.style.getPropertyValue("--y-ratio")).toBe("0.1");
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
        expect(
          (
            container.querySelector(
              ".surface-shell > img.background-image",
            ) as HTMLImageElement
          ).style.getPropertyValue("--crossfade-visible-opacity"),
        ).toBe("0.62");
      });
      expect(
        container.querySelector(".scene-surface img.background-image"),
      ).not.toBeInTheDocument();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("crossfades investigation background asset changes without removing the old background first", async () => {
    const { container, rerender } = render(InvestigationSceneSurface, {
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

    await rerender({
      sublocation,
      backgroundAssetId: "background.chapter_1.scene_0.alley",
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      const images = container.querySelectorAll(
        ".surface-shell > img.background-image",
      );
      expect(images.length).toBe(2);
      expect(images[0]).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/cafe.png",
      );
      expect(images[1]).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/alley.png",
      );
    });
  });

  it("crossfades a placed character asset change inside the existing target", async () => {
    const { container, rerender } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(container.querySelector(".character-target img")).toHaveAttribute(
        "src",
        "/assets/portraits/witness/standard.png",
      );
    });

    const updatedSublocation = {
      ...sublocation,
      characters: [
        {
          ...sublocation.characters[0],
          layout: {
            ...sublocation.characters[0].layout!,
            assetId: "standee.witness.standard",
          },
        },
      ],
    } satisfies SublocationView;

    await rerender({
      sublocation: updatedSublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      const images = container.querySelectorAll(".character-target img");
      expect(images.length).toBe(2);
      expect(images[0]).toHaveAttribute(
        "src",
        "/assets/portraits/witness/standard.png",
      );
      expect(images[1]).toHaveAttribute(
        "src",
        "/assets/standees/witness/standard.png",
      );
    });
  });

  it("uses the shared crossfade image primitive for investigation images", () => {
    const source = surfaceSource();
    expect(source).toContain(
      'import CrossfadeImage from "./CrossfadeImage.svelte"',
    );
    expect(source).toContain("<CrossfadeImage");
    expect(source).toContain('imageClass="background-image"');
    expect(source).toContain('imageClass=""');
    expect(source).toContain("onImageLoad");
    expect(source).toContain("onImageError");
  });

  it("matches story scenes by fixing investigation backgrounds to the viewport", () => {
    const backgroundRule = cssRule(
      surfaceSource(),
      ".surface-shell > :global(img.background-image)",
    );
    expect(backgroundRule).toContain("position: fixed");
    expect(backgroundRule).toContain("z-index: -1");
    expect(backgroundRule).toContain("width: 100vw");
    expect(backgroundRule).toContain("height: 100vh");
  });

  it("scopes the background selector to the surface shell", () => {
    const source = surfaceSource();

    expect(source).toContain(".surface-shell > :global(img.background-image)");
    expect(source).not.toContain(":global(.background-image) {");
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

  it("keeps baked characters interactive without rendering a character image", async () => {
    const testName =
      "keeps baked characters interactive without rendering a character image";

    try {
      const user = userEvent.setup();
      const bakedSublocation = {
        ...sublocation,
        characters: [
          {
            ...sublocation.characters[0],
            layout: {
              kind: "baked",
              x: 0.34,
              y: 0.2,
              w: 0.24,
              h: 0.68,
            },
          },
        ],
      } satisfies SublocationView;

      resolveStoryAssetCalls.mockClear();
      const { container } = render(InvestigationSceneSurface, {
        sublocation: bakedSublocation,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      });

      const characterButton = screen.getByRole("button", {
        name: /詢問：目擊者/,
      });
      expect(characterButton.style.getPropertyValue("--x")).toBe("34%");
      expect(characterButton.style.getPropertyValue("--y")).toBe("20%");
      expect(characterButton.style.getPropertyValue("--w")).toBe("24%");
      expect(characterButton.style.getPropertyValue("--h")).toBe("68%");
      expect(container.querySelector(".character-target img")).toBeNull();

      // A baked character draws no sprite: the component must never ask the
      // asset resolver for a portrait or standee asset for it.
      const portraitOrStandeeAssetIds = resolveStoryAssetCalls.mock.calls
        .map(([assetId]) => assetId)
        .filter(
          (assetId) =>
            assetId?.startsWith("portrait.") || assetId?.startsWith("standee."),
        );
      expect(portraitOrStandeeAssetIds).toEqual([]);

      await user.click(characterButton);

      expect(characterButton).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByRole("button", { name: /不在場證明/ }),
      ).toBeInTheDocument();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("removes the rendered character sprite when the layout bakes into the scene", async () => {
    const testName =
      "removes the rendered character sprite when the layout bakes into the scene";

    try {
      const { container, rerender } = render(InvestigationSceneSurface, {
        sublocation,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      });

      await waitFor(() => {
        expect(
          container.querySelector(".character-target img"),
        ).toHaveAttribute("src", "/assets/portraits/witness/standard.png");
      });

      const bakedSublocation = {
        ...sublocation,
        characters: [
          {
            ...sublocation.characters[0],
            layout: { kind: "baked", x: 0.34, y: 0.2, w: 0.24, h: 0.68 },
          },
        ],
      } satisfies SublocationView;

      await rerender({
        sublocation: bakedSublocation,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      });

      await waitFor(() => {
        expect(container.querySelector(".character-target img")).toBeNull();
      });
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("shows the character name while the placed portrait is still resolving", async () => {
    const testName =
      "shows the character name while the placed portrait is still resolving";

    try {
      const storyAssets = await import("$lib/assets/story-assets");
      vi.spyOn(storyAssets, "resolveStoryAsset").mockImplementation(
        () => new Promise(() => {}),
      );

      const { container } = render(InvestigationSceneSurface, {
        sublocation,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      });

      await waitFor(() => {
        expect(
          screen.getByText("目擊者", { selector: ".portrait-loading" }),
        ).toBeInTheDocument();
      });
      expect(container.querySelector(".character-target img")).toBeNull();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("loads alpha crop variables for scene standees", () => {
    const source = surfaceSource();
    expect(source).toContain("loadCharacterCrop");
    expect(source).toContain("cropVariablesForAlphaBounds");
    expect(source).toContain("character-preview-crop");
    expect(source).toContain("loadCharacterCrop(portrait.assetId");
    expect(source).toContain("src={portrait.url}");
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

  it("marks unfinished placed targets without hover and clears the mark once done", () => {
    const { container, rerender } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    const hotspot = screen.getByRole("button", { name: "調查：桌面" });
    const character = screen.getByRole("button", { name: "詢問：目擊者" });
    expect(hotspot.querySelector(".target-pending")).not.toBeNull();
    expect(character.querySelector(".character-pending")).not.toBeNull();

    rerender({
      sublocation: {
        ...sublocation,
        hotspots: sublocation.hotspots.map((entry) => ({
          ...entry,
          inspected: true,
        })),
        characters: sublocation.characters.map((entry) => ({
          ...entry,
          topics: entry.topics.map((topic) => ({ ...topic, discussed: true })),
        })),
      },
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    expect(container.querySelector(".target-pending")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "調查：桌面" })
        .querySelector(".hotspot-check"),
    ).not.toBeNull();

    // The cue never widens a hit box, like the inspected check.
    expect(cssRule(surfaceSource(), ".target-pending")).toContain(
      "pointer-events: none",
    );
  });

  it("keeps hotspot labels on one line inside narrow targets", () => {
    expect(cssRule(surfaceSource(), ".target-label")).toContain(
      "white-space: nowrap",
    );
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

  it("drops the minimum-target clamp only where it would steal a neighbour's clicks", async () => {
    // At the 800×600 minimum window the cover plane is ~1067px wide, so the
    // scene-9 packet slices (~27px each) render far below the 72px
    // min-width clamp: each expanded button would overlap its neighbour and
    // later DOM order would win the hit-test. The collision is horizontal
    // only, so each culprit loses just its x-axis clamp — compact-x restores
    // the authored right edge. The rightmost slice's own extension reaches
    // nothing, so it keeps the clamp.
    const packets = {
      ...sublocation,
      hotspots: [
        {
          id: "workorder",
          label: "工單",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.622, y: 0.488, w: 0.026, h: 0.073 },
        },
        {
          id: "access_permission_list",
          label: "名單",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.649, y: 0.488, w: 0.025, h: 0.073 },
        },
        {
          id: "material_kit_list",
          label: "材料表",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.674, y: 0.488, w: 0.025, h: 0.073 },
        },
        {
          id: "far_target",
          label: "遠處",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.1, y: 0.2, w: 0.1, h: 0.1 },
        },
      ],
      characters: [],
    } satisfies SublocationView;

    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(InvestigationSceneSurface, {
      sublocation: packets,
      onInspect,
      onInterview: vi.fn(),
    });

    for (const label of ["工單", "名單"]) {
      expect(
        screen.getByRole("button", { name: `調查：${label}` }),
      ).toHaveClass("compact-x");
    }
    for (const label of ["材料表", "遠處"]) {
      const target = screen.getByRole("button", { name: `調查：${label}` });
      expect(target).not.toHaveClass("compact");
      expect(target).not.toHaveClass("compact-x");
      expect(target).not.toHaveClass("compact-y");
    }

    await user.click(screen.getByRole("button", { name: "調查：工單" }));
    expect(onInspect).toHaveBeenCalledWith("workorder");
    await user.click(screen.getByRole("button", { name: "調查：材料表" }));
    expect(onInspect).toHaveBeenCalledWith("material_kit_list");
  });

  it("compacts only the clamp-driven colliding axis of a culprit", () => {
    // The authored rects are disjoint on the colliding axis; only the
    // culprit's 72×44 minimum-target clamp crosses the neighbour. door's
    // authored height (12px) clamps to 44px and reaches into puddle below —
    // only the top box's vertical axis compacts. doc_left/doc_right mirror
    // it horizontally: authored x-disjoint, y-overlapping, doc_left's
    // authored width (32px) clamps to 72px — only the left box's horizontal
    // axis compacts.
    const neighbours = {
      ...sublocation,
      hotspots: [
        {
          id: "door",
          label: "防火門",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.02, y: 0.3, w: 0.08, h: 0.02 },
        },
        {
          id: "puddle",
          label: "積水",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.05, y: 0.34, w: 0.25, h: 0.2 },
        },
        {
          id: "doc_left",
          label: "左文件",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.55, y: 0.2, w: 0.03, h: 0.12 },
        },
        {
          id: "doc_right",
          label: "右文件",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.61, y: 0.2, w: 0.1, h: 0.12 },
        },
      ],
      characters: [],
    } satisfies SublocationView;

    render(InvestigationSceneSurface, {
      sublocation: neighbours,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    const door = screen.getByRole("button", { name: "調查：防火門" });
    expect(door).toHaveClass("compact-y");
    expect(door).not.toHaveClass("compact");
    expect(door).not.toHaveClass("compact-x");

    const docLeft = screen.getByRole("button", { name: "調查：左文件" });
    expect(docLeft).toHaveClass("compact-x");
    expect(docLeft).not.toHaveClass("compact");
    expect(docLeft).not.toHaveClass("compact-y");

    for (const name of ["調查：積水", "調查：右文件"]) {
      const target = screen.getByRole("button", { name });
      expect(target).not.toHaveClass("compact");
      expect(target).not.toHaveClass("compact-x");
      expect(target).not.toHaveClass("compact-y");
    }
  });

  it("keeps the minimum-target clamp on declared authored-overlapping pairs", () => {
    // Pairs whose authored rects overlap AND are declared in the sidecar's
    // intentionalOverlaps keep the clamp: their collision is authored intent.
    const nested = {
      ...sublocation,
      intentionalOverlaps: [{ hotspots: ["replay", "clock"] }],
      hotspots: [
        {
          id: "replay",
          label: "回放",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
        },
        {
          id: "clock",
          label: "時鐘",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.35, y: 0.35, w: 0.03, h: 0.05 },
        },
      ],
      characters: [],
    } satisfies SublocationView;

    render(InvestigationSceneSurface, {
      sublocation: nested,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    expect(screen.getByRole("button", { name: /調查：回放/ })).not.toHaveClass(
      "compact",
    );
    expect(screen.getByRole("button", { name: /調查：時鐘/ })).not.toHaveClass(
      "compact",
    );
  });

  it("renders compact targets at authored size without the minimum-target clamp", () => {
    // Buttons size as border-box (UA default), so only the min-size clamp
    // extends the hit edge; padding and border stay inside the box and are
    // left untouched so the focus outline keeps all four sides.
    const compactRule = cssRule(surfaceSource(), ".hotspot-target.compact");
    expect(compactRule).toContain("min-width: 0");
    expect(compactRule).toContain("min-height: 0");

    // Single-axis compact strips only that axis's clamp so the surviving
    // axis keeps its minimum-target affordance.
    const compactXRule = cssRule(surfaceSource(), ".hotspot-target.compact-x");
    expect(compactXRule).toContain("min-width: 0");
    const compactYRule = cssRule(surfaceSource(), ".hotspot-target.compact-y");
    expect(compactYRule).toContain("min-height: 0");

    // Nothing inside the button may extend the hit area either: the label
    // wrapper and the inspected badge both overflow a small compact target,
    // so neither is hit-testable.
    expect(surfaceSource()).toMatch(
      /\.hotspot-content \{[^}]*pointer-events: none/,
    );
    const checkRule = cssRule(surfaceSource(), ".hotspot-check");
    expect(checkRule).toContain("pointer-events: none");
  });

  it("compacts undeclared authored overlaps instead of enlarging the theft area", () => {
    // Same nesting geometry as the declared test, but without the
    // intentionalOverlaps declaration: the clamp must not grow the region
    // the later-defined hotspot steals beyond the authored overlap.
    const undeclared = {
      ...sublocation,
      hotspots: [
        {
          id: "replay",
          label: "回放",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
        },
        {
          id: "clock",
          label: "時鐘",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.35, y: 0.35, w: 0.03, h: 0.05 },
        },
      ],
      characters: [],
    } satisfies SublocationView;

    render(InvestigationSceneSurface, {
      sublocation: undeclared,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    expect(screen.getByRole("button", { name: /調查：回放/ })).toHaveClass(
      "compact",
    );
    expect(screen.getByRole("button", { name: /調查：時鐘/ })).toHaveClass(
      "compact",
    );
  });

  it("compacts a hotspot whose clamp steals clicks from a character", () => {
    // The sign's authored width (~32px) clamps to the 72px minimum and its
    // hit box reaches ~8px into takase's baked box; the authored rects do
    // not intersect. The character's box is authored-exact, so the sign's
    // own right-edge extension is the culprit — it compacts on x only.
    const withWitness = {
      ...sublocation,
      hotspots: [
        {
          id: "osmanthus_sign",
          label: "桂花招牌",
          description: "",
          inspected: false,
          layout: {
            kind: "rect",
            x: 0.64,
            y: 0.253472,
            w: 0.03,
            h: 0.117701,
          },
        },
        {
          id: "far_target",
          label: "遠處",
          description: "",
          inspected: false,
          layout: { kind: "rect", x: 0.1, y: 0.2, w: 0.1, h: 0.1 },
        },
      ],
      characters: [
        {
          id: "takase",
          name: "高瀬",
          role: "店員",
          bio: "",
          topics: [],
          layout: { kind: "baked", x: 0.7, y: 0.191, w: 0.11, h: 0.215 },
        },
      ],
    } satisfies SublocationView;

    render(InvestigationSceneSurface, {
      sublocation: withWitness,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    expect(screen.getByRole("button", { name: "調查：桂花招牌" })).toHaveClass(
      "compact-x",
    );
    expect(screen.getByRole("button", { name: /調查：遠處/ })).not.toHaveClass(
      "compact",
    );
  });

  it("keeps the hit-box model constants in sync with the CSS and window config", () => {
    // The JS hit-box model hand-copies the CSS minimum target and the
    // tauri.conf.json minimum window (padding/border are irrelevant: the
    // button sizes as border-box, so they stay inside the hit box). This
    // tripwire fails when either side changes without the other — including
    // the e2e window overlay, which REPLACES the base window entry and must
    // restate the minimums.
    const source = surfaceSource();
    const targetRule = cssRule(source, ".hotspot-target");

    expect(source).toContain("MIN_TARGET_PX = { w: 72, h: 44 }");
    expect(targetRule).toContain("min-width: 72px");
    expect(targetRule).toContain("min-height: 44px");

    const readWindowMins = (path: string) => {
      const config = JSON.parse(
        readFileSync(join(process.cwd(), path), "utf8"),
      ) as {
        app: { windows: Array<{ minWidth?: number; minHeight?: number }> };
      };
      const [{ minWidth, minHeight }] = config.app.windows;
      return { minWidth, minHeight };
    };
    const { minWidth, minHeight } = readWindowMins("src-tauri/tauri.conf.json");
    expect(readWindowMins("src-tauri/tauri.e2e.conf.json")).toEqual({
      minWidth,
      minHeight,
    });
    expect(source).toContain(`Math.max(${minWidth}, (16 / 9) * ${minHeight})`);
    expect(source).toContain(`Math.max(${minHeight}, (9 / 16) * ${minWidth})`);
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

      // rerender is synchronous but the $effect cleanup that releases the
      // Escape claim runs on a microtask; wait for it to drain before
      // asserting.
      await waitFor(() => {
        expect(escapeClaimed()).toBe(false);
      });
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("switches the topic popover to a different placed character on click without needing a second click", async () => {
    const testName =
      "switches the topic popover to a different placed character on click without needing a second click";

    // When the topic popover is open for character A and the player clicks
    // placed character B, the $effect cleanup for A's Escape claim must not
    // clobber the fresh `activeCharacterId = "B"` the click just set. If it
    // does, `activeCharacter` becomes null on the subsequent effect run and
    // B's popover never opens until the player clicks B again. The cleanup
    // should release the Escape claim but leave a fresh selection intact.
    try {
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

      const user = userEvent.setup();
      render(InvestigationSceneSurface, {
        sublocation: multiCharSublocation,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      });

      const witnessBtn = screen.getByRole("button", { name: /詢問：目擊者/ });
      const suspectBtn = screen.getByRole("button", { name: /詢問：嫌疑人/ });

      await user.click(witnessBtn);
      expect(screen.getByRole("dialog")).toHaveTextContent("不在場證明");
      expect(escapeClaimed()).toBe(true);

      // Clicking the second placed character should switch the popover to it
      // in a single click — the dialog stays open, now showing the suspect's
      // topic, and the Escape claim remains held.
      await user.click(suspectBtn);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toHaveTextContent("班表");
      expect(screen.queryByRole("button", { name: /不在場證明/ })).toBeNull();
      expect(escapeClaimed()).toBe(true);
      expect(witnessBtn).toHaveAttribute("aria-expanded", "false");
      expect(suspectBtn).toHaveAttribute("aria-expanded", "true");
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
      const backgrounds = container.querySelectorAll(
        ".surface-shell > img.background-image",
      );
      expect(backgrounds).toHaveLength(1);
      expect(backgrounds[0]?.getAttribute("src")).toContain(
        "data:image/svg+xml",
      );
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
      expect(img.getAttribute("style")).toContain("--crop-height:");
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

    expect(img.getAttribute("style") ?? "").not.toContain("--crop-height:");

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

    expect(img.getAttribute("style") ?? "").not.toContain("--crop-height:");

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
      expect(img.getAttribute("style")).toContain("--crop-height:");
    });

    const callsBefore = fakeContext.getImageData.mock.calls.length;
    img.dispatchEvent(new Event("load"));
    expect(fakeContext.getImageData.mock.calls.length).toBe(callsBefore);

    createElementSpy.mockRestore();
  });

  it("snapshots crop variables per crossfade layer when a placed character asset changes", async () => {
    const origCreateElement = document.createElement.bind(document);

    const firstImageData = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };
    firstImageData.data[(1 * 4 + 1) * 4 + 3] = 255;

    const secondImageData = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };
    secondImageData.data[(2 * 4 + 0) * 4 + 3] = 255;
    secondImageData.data[(3 * 4 + 0) * 4 + 3] = 255;

    const fakeContext = {
      drawImage: vi.fn(),
      getImageData: vi
        .fn()
        .mockReturnValueOnce(firstImageData)
        .mockReturnValueOnce(secondImageData),
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

    const { container, rerender } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector(".character-target img"),
      ).toBeInTheDocument();
    });

    const originalImage = container.querySelector(
      ".character-target img",
    ) as HTMLImageElement;
    Object.defineProperty(originalImage, "naturalWidth", {
      value: 4,
      configurable: true,
    });
    Object.defineProperty(originalImage, "naturalHeight", {
      value: 4,
      configurable: true,
    });
    fakeCanvas.width = 4;
    fakeCanvas.height = 4;
    originalImage.dispatchEvent(new Event("load"));

    await waitFor(() => {
      expect(originalImage.getAttribute("style")).toContain("--crop-top: 0.25");
      expect(originalImage.getAttribute("style")).toContain(
        "--crop-height: 0.25",
      );
    });

    const updatedSublocation = {
      ...sublocation,
      characters: [
        {
          ...sublocation.characters[0],
          layout: {
            ...sublocation.characters[0].layout!,
            assetId: "standee.witness.standard",
          },
        },
      ],
    } satisfies SublocationView;

    await rerender({
      sublocation: updatedSublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      const portraits = container.querySelectorAll(".character-target img");
      expect(portraits).toHaveLength(2);
      expect(portraits[0]).toHaveAttribute(
        "src",
        "/assets/portraits/witness/standard.png",
      );
      expect(portraits[1]).toHaveAttribute(
        "src",
        "/assets/standees/witness/standard.png",
      );
    });

    let portraits = container.querySelectorAll(
      ".character-target img",
    ) as NodeListOf<HTMLImageElement>;
    const outgoingImage = portraits[0] as HTMLImageElement;
    const incomingImage = portraits[1] as HTMLImageElement;

    expect(outgoingImage.getAttribute("style")).toContain("--crop-top: 0.25");
    expect(outgoingImage.getAttribute("style")).toContain(
      "--crop-height: 0.25",
    );
    expect(incomingImage.getAttribute("style") ?? "").not.toContain(
      "--crop-height:",
    );

    Object.defineProperty(incomingImage, "naturalWidth", {
      value: 4,
      configurable: true,
    });
    Object.defineProperty(incomingImage, "naturalHeight", {
      value: 4,
      configurable: true,
    });
    incomingImage.dispatchEvent(new Event("load"));

    await waitFor(() => {
      portraits = container.querySelectorAll(
        ".character-target img",
      ) as NodeListOf<HTMLImageElement>;
      expect(
        (portraits[0] as HTMLImageElement).getAttribute("style"),
      ).toContain("--crop-top: 0.25");
      expect(
        (portraits[0] as HTMLImageElement).getAttribute("style"),
      ).toContain("--crop-height: 0.25");
      expect(
        (portraits[1] as HTMLImageElement).getAttribute("style"),
      ).toContain("--crop-top: 0.5");
      expect(
        (portraits[1] as HTMLImageElement).getAttribute("style"),
      ).toContain("--crop-height: 0.5");
    });

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
      const backgrounds = container.querySelectorAll("img.background-image");
      expect(backgrounds).toHaveLength(1);
      expect(backgrounds[0]?.getAttribute("src")).toContain(
        "data:image/svg+xml",
      );
    });

    warnSpy.mockClear();
    const placeholder = container.querySelector(
      "img.background-image",
    ) as HTMLImageElement;
    placeholder.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(container.querySelectorAll("img.background-image")).toHaveLength(
        0,
      );
    });
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
      const portraits = container.querySelectorAll(".character-target img");
      expect(portraits).toHaveLength(1);
      expect(portraits[0]?.getAttribute("src")).toContain("data:image/svg+xml");
    });

    warnSpy.mockClear();
    const placeholder = container.querySelector(
      ".character-target img",
    ) as HTMLImageElement;
    placeholder.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(container.querySelectorAll(".character-target img")).toHaveLength(
        0,
      );
    });
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
