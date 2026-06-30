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

    // The chapter accordion exposes list semantics (role="list") so screen
    // readers announce the chapter grouping as a list, matching the
    // scene-list <ul> below it.
    expect(screen.getByRole("list", { name: "章節列表" })).toBeInTheDocument();

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

  it("surfaces a load failure with a retry button that invokes onRetry", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(SceneNavigationPanel, {
      index: null,
      current: currentState(),
      loading: false,
      error: true,
      disabled: false,
      onSelect: vi.fn(),
      onRetry,
    });

    expect(screen.getByText("場景索引載入失敗。")).toBeInTheDocument();
    // The empty-state fallback must NOT win when an error is present.
    expect(screen.queryByText("沒有可用場景。")).toBeNull();

    await user.click(screen.getByRole("button", { name: "重試" }));
    expect(onRetry).toHaveBeenCalledExactlyOnceWith();
  });

  it("falls back to the first chapter when the current chapter is not in the index", () => {
    // Covers the gameComplete branch (currentChapterId = null) and the
    // `chapters.find(...)?.id ?? chapters[0]?.id` fallback: when no chapter
    // matches the current chapter id, the first chapter auto-expands.
    const gameCompleteState: GameStateView = {
      chapter: {
        id: "chapter_1",
        title: "雨夜的第一份證詞",
        summary: "案件摘要",
        index: 0,
        total: 2,
      },
      scene: {
        kind: "linear",
        id: "scene_0",
        title: "序章",
        index: 0,
        total: 1,
      },
      mode: { type: "gameComplete" },
      inventory: { evidence: [], statements: [] },
    };

    render(SceneNavigationPanel, {
      index,
      current: gameCompleteState,
      disabled: false,
      onSelect: vi.fn(),
    });

    // gameComplete → currentChapterId is null → no match → falls back to
    // chapters[0] (chapter_1), which auto-expands.
    expect(
      screen.getByRole("button", { name: /雨夜的第一份證詞/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.queryByRole("button", { name: /第二份證詞/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("disables the current scene so selecting it cannot wipe in-progress state", async () => {
    // jump_to_scene unconditionally resets inventory / scene progress, so
    // selecting the scene the player is already on is a destructive no-op.
    // The current-scene button must short-circuit onSelect (and announce as
    // disabled) to prevent the silent wipe.
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(SceneNavigationPanel, {
      index,
      current: currentState(),
      disabled: false,
      onSelect,
    });

    const currentSceneButton = screen.getByRole("button", {
      name: /咖啡館調查/,
    });
    expect(currentSceneButton).toHaveAttribute("aria-current", "true");
    expect(currentSceneButton).toHaveAttribute("aria-disabled", "true");

    await user.click(currentSceneButton);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("collapses the expanded chapter when it disappears from a reloaded index", async () => {
    // Covers the stale-expanded-chapter branch: after auto-expanding
    // chapter_2, a rerender with an index that no longer contains chapter_2
    // must reset expandedChapterId to null (no chapter expanded).
    const { rerender } = render(SceneNavigationPanel, {
      index,
      current: currentState(),
      disabled: false,
      onSelect: vi.fn(),
    });

    // Expand chapter_2 explicitly.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /第二份證詞/ }));
    expect(screen.getByRole("button", { name: /第二份證詞/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Reload the index with only chapter_1 — chapter_2 is gone, so the
    // effect must clear the expanded chapter.
    await rerender({
      index: {
        chapters: [
          {
            id: "chapter_1",
            title: "雨夜的第一份證詞",
            index: 0,
            scenes: [
              { id: "scene_0", title: "序章", type: "linear", index: 0 },
            ],
          },
        ],
      },
      current: currentState(),
      disabled: false,
      onSelect: vi.fn(),
    });

    expect(
      screen.getByRole("button", { name: /雨夜的第一份證詞/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /第二份證詞/ })).toBeNull();
  });
});
