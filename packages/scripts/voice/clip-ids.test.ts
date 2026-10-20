import { describe, expect, it } from "vitest";
import { assignClipIds, clipPrefix } from "./clip-ids";
import type { CastEntry } from "./voice-cast";
import type { LocaleScriptFile, LocaleScriptLine } from "./types";

const SOMA: CastEntry = {
  characterId: "soma_ritsu",
  speakers: ["相馬律"],
  status: "approved",
  voiceId: "abc",
  settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1 },
  seed: 1,
  expressionDirections: {},
  auditionLines: [],
  candidates: [],
};

function file(
  lines: LocaleScriptLine[],
  stale: LocaleScriptLine[] = [],
): LocaleScriptFile {
  return { schemaVersion: 1, locale: "ja", source: "x", lines, stale };
}

describe("assignClipIds", () => {
  it("numbers translated lines of approved roles in chapter order", () => {
    const files = [
      file([
        { speaker: "相馬律", zh: "一", ja: "一" },
        { speaker: "早坂茜", zh: "二", ja: "二" },
        { speaker: "相馬律", zh: "三", ja: "" },
      ]),
      file([{ speaker: "相馬律", zh: "四", ja: "四" }]),
    ];
    const assigned = assignClipIds({
      chapterId: "chapter_1",
      files,
      castBySpeaker: new Map([["相馬律", SOMA]]),
      existingClipFiles: [],
    });
    expect(assigned).toBe(2);
    expect(
      files.flatMap((f) => f.lines.map((l) => l.voice?.clip ?? null)),
    ).toEqual(["ch1_soma_ritsu_0001", null, null, "ch1_soma_ritsu_0002"]);
  });

  it("keeps existing clips and never reuses a number from a stale entry or a file", () => {
    const files = [
      file(
        [
          {
            speaker: "相馬律",
            zh: "一",
            ja: "一",
            voice: { clip: "ch1_soma_ritsu_0002" },
          },
          { speaker: "相馬律", zh: "二", ja: "二" },
        ],
        [
          {
            speaker: "相馬律",
            zh: "舊",
            ja: "旧",
            voice: { clip: "ch1_soma_ritsu_0005" },
          },
        ],
      ),
    ];
    assignClipIds({
      chapterId: "chapter_1",
      files,
      castBySpeaker: new Map([["相馬律", SOMA]]),
      existingClipFiles: ["ch1_soma_ritsu_0007", "ch2_soma_ritsu_0009"],
    });
    expect(files[0]?.lines.map((l) => l.voice?.clip)).toEqual([
      "ch1_soma_ritsu_0002",
      "ch1_soma_ritsu_0008",
    ]);
  });

  it("builds the chapter prefix", () => {
    expect(clipPrefix("chapter_12", "kamiya_mio")).toBe("ch12_kamiya_mio_");
    expect(() => clipPrefix("prologue", "kamiya_mio")).toThrow();
  });
});
