import { render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
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
});
