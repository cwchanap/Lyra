import { describe, expect, it } from "bun:test";
import { expectedPath, publicPath } from "./manifest";

describe("story asset manifest paths", () => {
  it("maps portrait asset IDs to typed static asset paths", () => {
    expect(publicPath("portrait.hayasaka_akane.concerned", "portrait")).toBe("/assets/portraits/hayasaka_akane/concerned.png");
    expect(expectedPath("portrait.hayasaka_akane.concerned", "portrait")).toBe("static/assets/portraits/hayasaka_akane/concerned.png");
  });

  it("maps background asset IDs to nested background paths", () => {
    expect(publicPath("background.chapter_1.scene_0.tag_001", "background")).toBe("/assets/backgrounds/chapter_1/scene_0/tag_001.png");
  });

  it("maps audio asset IDs by channel", () => {
    expect(publicPath("audio.bgm.rain_mystery_low", "audio")).toBe("/assets/audio/bgm/rain_mystery_low.ogg");
  });
});
