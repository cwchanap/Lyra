import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameStateView } from "$lib/state/types";

const mocks = vi.hoisted(() => ({
  audioPreferences: {
    muted: false,
    bgmVolume: 0.5,
    bgsVolume: 0.5,
    sfxVolume: 0.5,
  },
  updateAudioPreferences: vi.fn(),
}));

vi.mock("$lib/audio/gameplay-audio-runtime.svelte", () => ({
  audioPreferences: mocks.audioPreferences,
  updateAudioPreferences: mocks.updateAudioPreferences,
}));

import GameShellHarness from "./GameShellHarness.svelte";

function state(): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      summary: "案件摘要",
      index: 0,
      total: 3,
    },
    scene: { kind: "linear", id: "scene_1", title: "", index: 0, total: 1 },
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

describe("GameShell", () => {
  afterEach(() => {
    cleanup();
    mocks.updateAudioPreferences.mockClear();
  });

  it("renders the chapter header and scoped children", () => {
    render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

    expect(screen.getByText("雨夜的第一份證詞")).toBeInTheDocument();
    expect(screen.getByText("案件摘要")).toBeInTheDocument();
    expect(screen.getByText("FILE", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("scoped child")).toBeInTheDocument();
  });

  it("renders the AudioSettings panel bound to runtime preferences", () => {
    render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

    expect(
      screen.getByRole("region", { name: "音訊設定" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("BGM")).toBeInTheDocument();
  });

  it("invokes onReset when the close-case button is clicked", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(GameShellHarness, { gameState: state(), onReset });

    await user.click(screen.getByRole("button", { name: /結束/ }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
