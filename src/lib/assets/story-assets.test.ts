import { afterEach, describe, expect, it, vi } from "vitest";
import {
  placeholderForStoryAsset,
  publicPathForStoryAsset,
  resolveStoryAsset,
} from "./story-assets";

describe("story asset resolver helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps portrait IDs to public asset paths", () => {
    expect(publicPathForStoryAsset("portrait.hayasaka_akane.concerned", "portrait")).toBe(
      "/assets/portraits/hayasaka_akane/concerned.png",
    );
  });

  it("maps background IDs to nested public paths", () => {
    expect(publicPathForStoryAsset("background.chapter_1.scene_0.tag_001", "background")).toBe(
      "/assets/backgrounds/chapter_1/scene_0/tag_001.png",
    );
  });

  it("maps evidence IDs without the evidence prefix", () => {
    expect(publicPathForStoryAsset("evidence.coffee_receipt", "evidence")).toBe(
      "/assets/evidence/coffee_receipt.png",
    );
  });

  it("maps audio IDs to channel-specific ogg paths", () => {
    expect(publicPathForStoryAsset("audio.bgm.rain_mystery_low", "audio")).toBe(
      "/assets/audio/bgm/rain_mystery_low.ogg",
    );
  });

  it("provides placeholders by image type", () => {
    expect(placeholderForStoryAsset("background").url).toContain("data:image/svg+xml");
    expect(placeholderForStoryAsset("portrait").placeholder).toBe(true);
    expect(placeholderForStoryAsset("evidence").placeholder).toBe(true);
  });

  it("returns null for nullish asset IDs", async () => {
    await expect(resolveStoryAsset(null, "background")).resolves.toBeNull();
    await expect(resolveStoryAsset(undefined, "portrait")).resolves.toBeNull();
  });

  it("uses HEAD to confirm image assets and returns the public URL when present", async () => {
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    await expect(resolveStoryAsset("background.chapter_1.scene_0.available", "background")).resolves.toMatchObject({
      url: "/assets/backgrounds/chapter_1/scene_0/available.png",
      placeholder: false,
    });
    expect(fetch).toHaveBeenCalledWith("/assets/backgrounds/chapter_1/scene_0/available.png", { method: "HEAD" });

  });

  it("falls back to an image placeholder when HEAD fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));

    await expect(resolveStoryAsset("portrait.hayasaka_akane.missing", "portrait")).resolves.toMatchObject({
      assetId: "portrait.hayasaka_akane.missing",
      placeholder: true,
    });

  });

  it("does not fetch audio assets", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(resolveStoryAsset("audio.bgs.street_rain", "audio")).resolves.toEqual({
      assetId: "audio.bgs.street_rain",
      type: "audio",
      url: "/assets/audio/bgs/street_rain.ogg",
      placeholder: false,
    });
    expect(fetch).not.toHaveBeenCalled();

  });
});
