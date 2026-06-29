import { cleanup, render, screen, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameStateView, SceneNavigationIndex } from "$lib/state/types";
import SceneNavigationPanel from "./SceneNavigationPanel.svelte";

const index: SceneNavigationIndex = {
  chapters: [
    {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      index: 0,
      scenes: [
        { id: "scene_0", title: "序章", type: "linear", index: 0 },
        {
          id: "investigation_scene_1",
          title: "咖啡館調查",
          type: "investigation",
          index: 1,
        },
      ],
    },
    {
      id: "chapter_2",
      title: "第二份證詞",
      index: 1,
      scenes: [
        {
          id: "interrogation_scene_0",
          title: "詢問",
          type: "interrogation",
          index: 0,
        },
      ],
    },
  ],
};

function currentState(): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      summary: "案件摘要",
      index: 0,
      total: 2,
    },
    scene: {
      kind: "investigation",
      id: "investigation_scene_1",
      title: "咖啡館調查",
      index: 1,
      total: 2,
      currentSublocationId: "main",
      visibleSublocations: [],
    },
    mode: {
      type: "explore",
      sublocationId: "main",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
  };
}

describe("SceneNavigationPanel", () => {
  afterEach(cleanup);

  it("expands the current chapter and marks the current scene", () => {
    render(SceneNavigationPanel, {
      index,
      current: currentState(),
      disabled: false,
      onSelect: vi.fn(),
    });

    expect(
      screen.getByRole("button", { name: /雨夜的第一份證詞/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /序章/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /咖啡館調查/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.queryByRole("button", { name: /詢問/ })).toBeNull();
  });

  it("expands chapters one at a time and emits selected chapter and scene ids", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(SceneNavigationPanel, {
      index,
      current: currentState(),
      disabled: false,
      onSelect,
    });

    await user.click(screen.getByRole("button", { name: /第二份證詞/ }));
    expect(screen.getByRole("button", { name: /第二份證詞/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /雨夜的第一份證詞/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /咖啡館調查/ })).toBeNull();

    const sceneList = screen.getByRole("list", { name: "第二份證詞 場景列表" });
    await user.click(within(sceneList).getByRole("button", { name: /詢問/ }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(
      "chapter_2",
      "interrogation_scene_0",
    );
  });

  it("collapses an expanded chapter", async () => {
    const user = userEvent.setup();
    render(SceneNavigationPanel, {
      index,
      current: currentState(),
      disabled: false,
      onSelect: vi.fn(),
    });

    const currentChapter = screen.getByRole("button", {
      name: /雨夜的第一份證詞/,
    });
    await user.click(currentChapter);

    expect(currentChapter).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /序章/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /咖啡館調查/ })).toBeNull();
  });

  it("shows loading and empty states", async () => {
    const { rerender } = render(SceneNavigationPanel, {
      index: null,
      current: currentState(),
      loading: true,
      disabled: false,
      onSelect: vi.fn(),
    });
    expect(screen.getByText("場景索引載入中...")).toBeInTheDocument();

    await rerender({
      index: { chapters: [] },
      current: currentState(),
      loading: false,
      disabled: false,
      onSelect: vi.fn(),
    });
    expect(screen.getByText("沒有可用場景。")).toBeInTheDocument();
  });
});
