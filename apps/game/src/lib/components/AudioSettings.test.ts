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
    expect(screen.getByText("55")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
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

  it("updates the BGM and SFX channel volumes", async () => {
    const onUpdate = vi.fn();

    render(AudioSettings, { preferences, onUpdate });

    await fireEvent.input(screen.getByLabelText("BGM"), {
      target: { value: "80" },
    });
    await fireEvent.input(screen.getByLabelText("SFX"), {
      target: { value: "10" },
    });

    expect(onUpdate).toHaveBeenCalledWith({ bgmVolume: 0.8 });
    expect(onUpdate).toHaveBeenCalledWith({ sfxVolume: 0.1 });
  });

  it("toggles the mute label and aria state when muted", () => {
    render(AudioSettings, {
      preferences: { ...preferences, muted: true },
      onUpdate: vi.fn(),
    });

    const button = screen.getByRole("button", { name: /靜音/ });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("aria-label", "音訊取消靜音");
    expect(screen.getByText("OFF")).toBeInTheDocument();
  });
});
