import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { AudioPreferences } from "$lib/audio/audio-preferences";
import AudioSettings from "./AudioSettings.svelte";

const preferences: AudioPreferences = {
  muted: false,
  bgmVolume: 0.55,
  bgsVolume: 0.45,
  sfxVolume: 0.7,
  voiceVolume: 0.9,
  voiceEnabled: true,
};

describe("AudioSettings", () => {
  it("renders mute and channel sliders", () => {
    render(AudioSettings, {
      preferences,
      onUpdate: vi.fn(),
    });

    const toggle = screen.getByRole("button", {
      name: "目前聲音開啟，按下可靜音",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("聲音開啟")).toBeInTheDocument();
    expect(screen.getByLabelText("BGM")).toHaveValue("55");
    expect(screen.getByLabelText("BGS")).toHaveValue("45");
    expect(screen.getByLabelText("SFX")).toHaveValue("70");
    expect(screen.getByText("55")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByLabelText("VOICE")).toHaveValue("90");
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "目前角色語音開啟，按下可關閉" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("updates the voice volume and toggles voices", async () => {
    const onUpdate = vi.fn();

    render(AudioSettings, { preferences, onUpdate });

    await fireEvent.input(screen.getByLabelText("VOICE"), {
      target: { value: "40" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "目前角色語音開啟，按下可關閉" }),
    );

    expect(onUpdate).toHaveBeenCalledWith({ voiceVolume: 0.4 });
    expect(onUpdate).toHaveBeenCalledWith({ voiceEnabled: false });
  });

  it("shows voices as off", () => {
    render(AudioSettings, {
      preferences: { ...preferences, voiceEnabled: false },
      onUpdate: vi.fn(),
    });

    expect(
      screen.getByRole("button", { name: "目前角色語音關閉，按下可開啟" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("語音關閉")).toBeInTheDocument();
  });

  it("updates mute", async () => {
    const onUpdate = vi.fn();

    render(AudioSettings, { preferences, onUpdate });

    await fireEvent.click(
      screen.getByRole("button", {
        name: "目前聲音開啟，按下可靜音",
      }),
    );
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

    const button = screen.getByRole("button", {
      name: "目前已靜音，按下可開啟聲音",
    });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("MUTED")).toBeInTheDocument();
    expect(screen.getByText("已靜音")).toBeInTheDocument();
  });
});
