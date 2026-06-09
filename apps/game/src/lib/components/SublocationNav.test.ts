import { render, screen, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SublocationNav from "./SublocationNav.svelte";
import type { SublocationView } from "../state/types";

const sublocations: SublocationView[] = [
  {
    id: "coffee_shop",
    label: "喫茶店",
    sceneTag: "雨夜喫茶店",
    hotspots: [],
    characters: [],
  },
  {
    id: "alley",
    label: "小巷",
    sceneTag: "暗巷",
    hotspots: [],
    characters: [],
  },
  {
    id: "office",
    label: "事務所",
    sceneTag: "偵探事務所",
    hotspots: [],
    characters: [],
  },
];

describe("SublocationNav", () => {
  it("renders a button for each sublocation", () => {
    render(SublocationNav, {
      sublocations,
      currentId: "coffee_shop",
      onEnter: vi.fn(),
    });

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
  });

  it("marks the current sublocation as active", () => {
    render(SublocationNav, {
      sublocations,
      currentId: "alley",
      onEnter: vi.fn(),
    });

    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).not.toHaveClass("active");
    expect(buttons[1]).toHaveClass("active");
    expect(buttons[2]).not.toHaveClass("active");
  });

  it("shows zero-padded index numbers", () => {
    render(SublocationNav, {
      sublocations,
      currentId: "coffee_shop",
      onEnter: vi.fn(),
    });

    const buttons = screen.getAllByRole("button");
    expect(within(buttons[0]).getByText("01")).toBeInTheDocument();
    expect(within(buttons[1]).getByText("02")).toBeInTheDocument();
    expect(within(buttons[2]).getByText("03")).toBeInTheDocument();
  });

  it("shows active mark only for current sublocation", () => {
    render(SublocationNav, {
      sublocations,
      currentId: "coffee_shop",
      onEnter: vi.fn(),
    });

    const buttons = screen.getAllByRole("button");
    expect(within(buttons[0]).getByText("▸")).toBeInTheDocument();
    expect(within(buttons[1]).queryByText("▸")).not.toBeInTheDocument();
    expect(within(buttons[2]).queryByText("▸")).not.toBeInTheDocument();
  });

  it("calls onEnter with correct id when clicking a button", async () => {
    const user = userEvent.setup();
    const onEnter = vi.fn();

    render(SublocationNav, {
      sublocations,
      currentId: "coffee_shop",
      onEnter,
    });

    await user.click(screen.getByRole("button", { name: /小巷/ }));
    expect(onEnter).toHaveBeenCalledWith("alley");
  });

  it("disables all buttons when disabled prop is true", () => {
    render(SublocationNav, {
      sublocations,
      currentId: "coffee_shop",
      onEnter: vi.fn(),
      disabled: true,
    });

    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn).toBeDisabled();
    }
  });

  it("adds scene class when placement is scene", () => {
    const { container } = render(SublocationNav, {
      sublocations,
      currentId: "coffee_shop",
      onEnter: vi.fn(),
      placement: "scene",
    });

    expect(container.querySelector("nav")).toHaveClass("scene");
  });

  it("does not add scene class when placement is page", () => {
    const { container } = render(SublocationNav, {
      sublocations,
      currentId: "coffee_shop",
      onEnter: vi.fn(),
      placement: "page",
    });

    expect(container.querySelector("nav")).not.toHaveClass("scene");
  });

  it("renders no active button when currentId is null", () => {
    render(SublocationNav, {
      sublocations,
      currentId: null,
      onEnter: vi.fn(),
    });

    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn).not.toHaveClass("active");
    }
    expect(screen.queryByText("▸")).not.toBeInTheDocument();
  });
});
