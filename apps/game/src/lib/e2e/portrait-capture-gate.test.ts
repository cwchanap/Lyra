import { describe, expect, it } from "vitest";
import {
  checkPortraitCapture,
  normalizeCapturePath,
  normalizeCaptureText,
  type PortraitCaptureExpectation,
  type RenderedPortraitSnapshot,
} from "./portrait-capture-gate";

const expected: PortraitCaptureExpectation = {
  label: "speaking-saegusa-ch2-inv19",
  characterId: "saegusa_yuma",
  assetPath: "/assets/portraits/saegusa_yuma/irritated.png",
  speaker: "三枝悠真",
  text: "倒扣了還不行？我又沒有開台。",
};

const rendered: RenderedPortraitSnapshot = {
  src: "tauri://localhost/assets/portraits/saegusa_yuma/irritated.png",
  complete: true,
  naturalWidth: 768,
  naturalHeight: 1024,
};

const dialogue =
  "證言 · TESTIMONY 發言 · LINE 三枝悠真 倒扣了還不行？我又沒有開台。";

describe("portrait capture gate", () => {
  it("accepts the expected decoded portrait and authored dialogue", () => {
    expect(checkPortraitCapture(expected, rendered, dialogue)).toEqual({
      ok: true,
    });
  });

  it("rejects a different rendered character portrait", () => {
    const wrong = {
      ...rendered,
      src: "tauri://localhost/assets/portraits/kamiya_mio/standard.png",
    };
    const result = checkPortraitCapture(expected, wrong, dialogue);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("saegusa_yuma");
      expect(result.reason).toContain("kamiya_mio");
    }
  });

  it("rejects a correct portrait before the authored line is rendered", () => {
    const result = checkPortraitCapture(expected, rendered, "證言 · TESTIMONY");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("authored dialogue text");
    }
  });

  it("rejects an undecoded or placeholder portrait", () => {
    const unloaded = { ...rendered, complete: false, naturalWidth: 0 };
    expect(checkPortraitCapture(expected, unloaded, dialogue).ok).toBe(false);
    const placeholder = {
      ...rendered,
      src: "tauri://localhost/assets/placeholders/missing.png",
    };
    expect(checkPortraitCapture(expected, placeholder, dialogue).ok).toBe(
      false,
    );
  });

  it("normalizes query strings and whitespace", () => {
    expect(normalizeCapturePath(`${rendered.src}?v=1`)).toBe(
      "/assets/portraits/saegusa_yuma/irritated.png",
    );
    expect(normalizeCaptureText(" 三枝悠真\n倒扣了 ")).toBe("三枝悠真 倒扣了");
  });
});
