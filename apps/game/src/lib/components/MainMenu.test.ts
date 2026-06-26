import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import MainMenu from "./MainMenu.svelte";

describe("MainMenu", () => {
  afterEach(() => {
    cleanup();
    mocks.updateAudioPreferences.mockClear();
  });

  it("renders the audio settings panel bound to runtime preferences", () => {
    render(MainMenu, { onNewGame: vi.fn(), onExit: vi.fn() });

    expect(
      screen.getByRole("region", { name: "音訊設定" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("BGM")).toBeInTheDocument();
  });

  it("routes a mute toggle through the runtime preference updater", async () => {
    render(MainMenu, { onNewGame: vi.fn(), onExit: vi.fn() });

    const toggle = screen.getByRole("button", { name: /音訊/ });
    toggle.click();

    expect(mocks.updateAudioPreferences).toHaveBeenCalledWith({
      muted: true,
    });
  });
});
