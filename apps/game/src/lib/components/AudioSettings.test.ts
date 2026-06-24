import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { AudioPreferences } from "$lib/audio/audio-preferences";
import AudioSettings from "./AudioSettings.svelte";

const preferences: AudioPreferences = {
  muted: false,
  bgmVolume: 0.55,
  bgsVolume: 0.45,
  sfxVolume: 0.7,
};

describe("AudioSettings", () => {
  it("renders mute and channel sliders", () => {
    render(AudioSettings, {
      preferences,
      onUpdate: vi.fn(),
    });

    expect(screen.getByRole("button", { name: /音訊/ })).toBeInTheDocument();
    expect(screen.getByLabelText("BGM")).toHaveValue("55");
    expect(screen.getByLabelText("BGS")).toHaveValue("45");
    expect(screen.getByLabelText("SFX")).toHaveValue("70");
  });

  it("updates mute", async () => {
    const onUpdate = vi.fn();

    render(AudioSettings, { preferences, onUpdate });

    await fireEvent.click(screen.getByRole("button", { name: /音訊/ }));
    expect(onUpdate).toHaveBeenCalledWith({ muted: true });
  });

  it("updates a channel volume", async () => {
    const onUpdate = vi.fn();

    render(AudioSettings, { preferences, onUpdate });

    await fireEvent.input(screen.getByLabelText("BGS"), {
      target: { value: "25" },
    });
    expect(onUpdate).toHaveBeenCalledWith({ bgsVolume: 0.25 });
  });
});
