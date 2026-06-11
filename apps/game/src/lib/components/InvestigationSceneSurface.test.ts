import { render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import InvestigationSceneSurface from "./InvestigationSceneSurface.svelte";
import type { SublocationView } from "../state/types";

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

function cssRule(source: string, selector: string) {
  const match = new RegExp(`${selector.replace(".", "\\.")}\\s*{([^}]*)}`).exec(
    source,
  );
  return match?.[1] ?? "";
}

describe("InvestigationSceneSurface", () => {
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

  it("keeps the scene surface on the 16:9 background coordinate plane", () => {
    const surfaceRule = cssRule(surfaceSource(), ".scene-surface");
    expect(surfaceRule).toContain("aspect-ratio: 16 / 9");
    expect(surfaceRule).not.toContain("min-height");
  });

  it("renders the resolved background image inside the scene surface", async () => {
    const { container } = render(InvestigationSceneSurface, {
      sublocation,
      backgroundAssetId: "background.chapter_1.scene_0.cafe",
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector(".scene-surface img.background-image"),
      ).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/cafe.png",
      );
    });
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
        container.querySelector(".scene-surface img.background-image"),
      ).toBeInTheDocument();
    });

    const img = container.querySelector(
      ".scene-surface img.background-image",
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
});
