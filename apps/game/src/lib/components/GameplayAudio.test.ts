import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mode } from "$lib/state/types";

const mocks = vi.hoisted(() => ({
  syncGameplayAudioMode: vi.fn(),
  disposeGameplayAudio: vi.fn(),
  retryLockedGameplayAudio: vi.fn(),
}));

vi.mock("$lib/audio/gameplay-audio-runtime.svelte", () => ({
  syncGameplayAudioMode: mocks.syncGameplayAudioMode,
  disposeGameplayAudio: mocks.disposeGameplayAudio,
  retryLockedGameplayAudio: mocks.retryLockedGameplayAudio,
}));

import GameplayAudio from "./GameplayAudio.svelte";

const exploreMode: Mode = {
  type: "explore",
  sublocationId: "main",
  backgroundAssetId: null,
  bgm: { channel: "bgm", assetId: "audio.bgm.review" },
  bgs: { channel: "bgs", assetId: "audio.bgs.rain" },
};

describe("GameplayAudio", () => {
  afterEach(() => {
    cleanup();
    mocks.syncGameplayAudioMode.mockClear();
    mocks.disposeGameplayAudio.mockClear();
    mocks.retryLockedGameplayAudio.mockClear();
  });

  it("syncs the initial mode to the audio runtime on mount", () => {
    render(GameplayAudio, { mode: exploreMode });
    expect(mocks.syncGameplayAudioMode).toHaveBeenCalledWith(exploreMode);
  });

  it("disposes the audio runtime when unmounted", () => {
    render(GameplayAudio, { mode: exploreMode });
    cleanup();
    expect(mocks.disposeGameplayAudio).toHaveBeenCalledTimes(1);
  });

  it("re-syncs when the mode prop changes", async () => {
    const { rerender } = render(GameplayAudio, { mode: exploreMode });

    const gameComplete: Mode = { type: "gameComplete" };
    await rerender({ mode: gameComplete });

    expect(mocks.syncGameplayAudioMode).toHaveBeenCalledWith(gameComplete);
  });

  it("retries locked audio on the first player gesture", async () => {
    render(GameplayAudio, { mode: exploreMode });
    expect(mocks.retryLockedGameplayAudio).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pointerdown"));

    expect(mocks.retryLockedGameplayAudio).toHaveBeenCalledTimes(1);

    // The listener arms once per mount: a second gesture does not retry again.
    window.dispatchEvent(new Event("pointerdown"));
    expect(mocks.retryLockedGameplayAudio).toHaveBeenCalledTimes(1);
  });
});
