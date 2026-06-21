import { describe, expect, it } from "vitest";
import {
  mergeApprovedEntriesIntoCatalog,
  parseAudioCatalogText,
  serializeAudioCatalog,
} from "./audio-catalog";
import type { SoundPlanEntry } from "./types";

const approvedBgs: SoundPlanEntry = {
  id: "rain_street_light",
  channel: "bgs",
  status: "approved",
  loop: true,
  intendedDurationSeconds: 30,
  prompt: "Steady light Tokyo street rain.",
  reuseRationale: "Exterior rain pool.",
  evidence: [
    {
      file: "docs/stories_plan/chapter_1/scene_6.md",
      line: 3,
      note: "rainy street",
    },
  ],
};

function expectParseDiagnostic(
  text: string,
  code: string,
  path?: string,
): { code: string; message: string; path: string } {
  const parsed = parseAudioCatalogText(text, "audio.yaml");
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("Expected parse diagnostics.");
  const diagnostic = parsed.diagnostics.find(
    (item) => item.code === code && (path === undefined || item.path === path),
  );
  expect(diagnostic).toEqual(
    expect.objectContaining({
      code,
      ...(path === undefined ? {} : { path }),
    }),
  );
  if (!diagnostic) throw new Error(`Expected ${code} diagnostic.`);
  return diagnostic;
}

describe("audio catalog", () => {
  it("parses empty current catalog", () => {
    const parsed = parseAudioCatalogText("bgm: {}\nbgs: {}\n", "audio.yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sfx).toEqual({});
  });

  it("returns diagnostics for invalid yaml", () => {
    expectParseDiagnostic("bgm: [", "audioCatalogYamlInvalid", "audio.yaml");
  });

  it("rejects non-object roots", () => {
    expectParseDiagnostic(
      "- not a catalog",
      "audioCatalogRootInvalid",
      "audio.yaml",
    );
  });

  it("rejects unsupported top-level keys", () => {
    expectParseDiagnostic(
      "bgm: {}\nbgs: {}\nsfx: {}\nvoice: {}\n",
      "audioCatalogTopLevelKeyUnsupported",
      "voice",
    );
  });

  it("rejects non-object channel maps when present", () => {
    expectParseDiagnostic(
      "bgm: []\nbgs: {}\nsfx: {}\n",
      "audioCatalogChannelInvalid",
      "bgm",
    );
  });

  it("rejects malformed entry objects", () => {
    expectParseDiagnostic(
      "bgm:\n  quiet_piano: []\nbgs: {}\nsfx: {}\n",
      "audioCatalogEntryInvalid",
      "bgm.quiet_piano",
    );
  });

  it("rejects wrong prompt and loop field types", () => {
    const promptDiagnostic = expectParseDiagnostic(
      "bgm:\n  quiet_piano:\n    prompt: 7\n    loop: true\nbgs: {}\nsfx: {}\n",
      "audioCatalogPromptInvalid",
      "bgm.quiet_piano.prompt",
    );
    expect(promptDiagnostic.message).toContain("prompt");

    const loopDiagnostic = expectParseDiagnostic(
      "bgm:\n  quiet_piano:\n    prompt: Sparse piano.\n    loop: yes\nbgs: {}\nsfx: {}\n",
      "audioCatalogLoopInvalid",
      "bgm.quiet_piano.loop",
    );
    expect(loopDiagnostic.message).toContain("loop");
  });

  it("rejects invalid entry ids", () => {
    expectParseDiagnostic(
      "bgm:\n  Quiet-Piano:\n    prompt: Sparse piano.\n    loop: true\nbgs: {}\nsfx: {}\n",
      "audioCatalogIdInvalid",
      "bgm.Quiet-Piano",
    );
  });

  it("serializes all catalog channels", () => {
    const text = serializeAudioCatalog({
      bgm: {
        quiet_piano: {
          prompt: "Sparse piano.",
          loop: true,
        },
      },
      bgs: {},
      sfx: {
        door_chime: {
          prompt: "Small shop door chime.",
          loop: false,
        },
      },
    });

    const parsed = parseAudioCatalogText(text, "audio.yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.bgm.quiet_piano).toEqual({
      prompt: "Sparse piano.",
      loop: true,
    });
    expect(parsed.value.bgs).toEqual({});
    expect(parsed.value.sfx.door_chime).toEqual({
      prompt: "Small shop door chime.",
      loop: false,
    });
  });

  it("serializes catalog ids in stable sorted order", () => {
    const text = serializeAudioCatalog({
      bgm: {
        zeta_theme: { prompt: "Zeta.", loop: true },
        alpha_theme: { prompt: "Alpha.", loop: true },
      },
      bgs: {},
      sfx: {
        window_tap: { prompt: "Tap.", loop: false },
        door_chime: { prompt: "Chime.", loop: false },
      },
    });

    expect(text.indexOf("alpha_theme")).toBeLessThan(
      text.indexOf("zeta_theme"),
    );
    expect(text.indexOf("door_chime")).toBeLessThan(text.indexOf("window_tap"));
  });

  it("merges approved entries into channel maps", () => {
    const parsed = parseAudioCatalogText(
      "bgm: {}\nbgs: {}\nsfx: {}\n",
      "audio.yaml",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = mergeApprovedEntriesIntoCatalog(parsed.value, [approvedBgs]);
    expect(result.diagnostics).toEqual([]);
    expect(result.catalog.bgs.rain_street_light).toEqual({
      prompt: "Steady light Tokyo street rain.",
      loop: true,
    });
  });

  it("merges generated entries and skips proposed entries", () => {
    const parsed = parseAudioCatalogText(
      "bgm: {}\nbgs: {}\nsfx: {}\n",
      "audio.yaml",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const generated: SoundPlanEntry = {
      ...approvedBgs,
      id: "train_arrival_chime",
      channel: "sfx",
      status: "generated",
      loop: false,
      prompt: "Short train arrival chime.",
    };
    const proposed: SoundPlanEntry = {
      ...approvedBgs,
      id: "unapproved_station_pad",
      channel: "bgm",
      status: "proposed",
      prompt: "Low unresolved station pad.",
    };

    const result = mergeApprovedEntriesIntoCatalog(parsed.value, [
      generated,
      proposed,
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.catalog.sfx.train_arrival_chime).toEqual({
      prompt: "Short train arrival chime.",
      loop: false,
    });
    expect(result.catalog.bgm.unapproved_station_pad).toBeUndefined();
  });

  it("accepts identical duplicate entries", () => {
    const parsed = parseAudioCatalogText(
      "bgm: {}\nbgs:\n  rain_street_light:\n    prompt: Steady light Tokyo street rain.\n    loop: true\nsfx: {}\n",
      "audio.yaml",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = mergeApprovedEntriesIntoCatalog(parsed.value, [approvedBgs]);
    expect(result.diagnostics).toEqual([]);
    expect(result.catalog.bgs.rain_street_light).toEqual({
      prompt: "Steady light Tokyo street rain.",
      loop: true,
    });
  });

  it("rejects incompatible duplicate entries", () => {
    const parsed = parseAudioCatalogText(
      "bgm: {}\nbgs:\n  rain_street_light:\n    prompt: Different rain.\n    loop: false\nsfx: {}\n",
      "audio.yaml",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = mergeApprovedEntriesIntoCatalog(parsed.value, [approvedBgs]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "audioCatalogDuplicateConflict",
        path: "entries[0].bgs.rain_street_light",
        message: expect.stringContaining("prompt differs"),
      }),
    );
    expect(result.diagnostics[0]?.message).toContain("loop differs");
    expect(result.diagnostics[0]?.message).toContain(
      'existing "Different rain."',
    );
    expect(result.diagnostics[0]?.message).toContain("incoming true");
  });

  it("clones existing catalog entries before merging", () => {
    const parsed = parseAudioCatalogText(
      "bgm: {}\nbgs:\n  station_ambience:\n    prompt: Existing station ambience.\n    loop: true\nsfx: {}\n",
      "audio.yaml",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = mergeApprovedEntriesIntoCatalog(parsed.value, [approvedBgs]);
    result.catalog.bgs.station_ambience.prompt = "Mutated prompt.";

    expect(parsed.value.bgs.station_ambience).toEqual({
      prompt: "Existing station ambience.",
      loop: true,
    });
    expect(result.catalog.bgs.rain_street_light).toEqual(
      expect.objectContaining({
        prompt: "Steady light Tokyo street rain.",
      }),
    );
  });
});
