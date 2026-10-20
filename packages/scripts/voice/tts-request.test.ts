import { describe, expect, it } from "vitest";
import {
  buildTtsRequest,
  glossaryReader,
  supportsAudioTags,
} from "./tts-request";
import type { CastEntry, LocaleCast } from "./voice-cast";
import type { LocaleGlossary, LocaleScriptLine } from "./types";

const CAST: CastEntry = {
  characterId: "kamiya_mio",
  speakers: ["神谷澪"],
  status: "approved",
  voiceId: "voice123",
  settings: { stability: 0.4, similarityBoost: 0.8, style: 0.1, speed: 0.95 },
  seed: 1103,
  expressionDirections: { standard: "[cool]", stern: "[firmly]" },
  auditionLines: [],
  candidates: [],
};

function localeCast(model = "eleven_v3"): LocaleCast {
  return { locale: "ja", model, languageTextNormalization: true, cast: [CAST] };
}

const GLOSSARY: LocaleGlossary = {
  schemaVersion: 1,
  locale: "ja",
  styleRules: [],
  characters: [
    { zh: "相馬律", ja: "相馬律", reading: "そうま りつ" },
    { zh: "旁白", ja: "ナレーション", reading: "ナレーション" },
  ],
  terms: [
    {
      zh: "證據摘要審查會",
      ja: "証拠サマリー審査会",
      reading: "しょうこサマリーしんさかい",
    },
    { zh: "審查會", ja: "審査会", reading: "しんさかい" },
    { zh: "摘要", ja: "サマリー" },
  ],
};

const read = glossaryReader(GLOSSARY);

function line(extra: Partial<LocaleScriptLine> = {}): LocaleScriptLine {
  return {
    id: "L012",
    speaker: "神谷澪",
    zh: "中",
    ja: "相馬律は証拠サマリー審査会に来た。",
    ...extra,
  };
}

describe("glossaryReader", () => {
  it("swaps names and terms for their readings, longest first", () => {
    expect(read("相馬律は証拠サマリー審査会と審査会に来た。")).toBe(
      "そうまりつはしょうこサマリーしんさかいとしんさかいに来た。",
    );
    expect(glossaryReader(undefined)("相馬律")).toBe("相馬律");
  });
});

describe("buildTtsRequest", () => {
  it("sends the direction, readings, settings and seed for eleven_v3 without neighbouring text", () => {
    const request = buildTtsRequest({
      line: line({ expression: "stern" }),
      cast: CAST,
      localeCast: localeCast(),
      read,
      previous: line({ ja: "前。" }),
    });
    expect(request.voiceId).toBe("voice123");
    expect(request.direction).toBe("[firmly]");
    expect(request.body).toEqual({
      text: "[firmly] そうまりつはしょうこサマリーしんさかいに来た。",
      model_id: "eleven_v3",
      language_code: "ja",
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.8,
        style: 0.1,
        speed: 0.95,
      },
      seed: 1103,
      apply_language_text_normalization: true,
    });
    expect(request.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("prefers the line's own direction and tts override", () => {
    const request = buildTtsRequest({
      line: line({
        voice: { clip: "c", direction: "[whispers]", tts: "かみや。" },
      }),
      cast: CAST,
      localeCast: localeCast(),
      read,
    });
    expect(request.body.text).toBe("[whispers] かみや。");
  });

  it("adds neighbouring text on models with request stitching and drops tags on older ones", () => {
    const request = buildTtsRequest({
      line: line(),
      cast: CAST,
      localeCast: localeCast("eleven_multilingual_v2"),
      read,
      previous: line({ ja: "相馬律。" }),
      next: line({ ja: "" }),
    });
    expect(request.direction).toBeNull();
    expect(request.body.text).toBe(
      "そうまりつはしょうこサマリーしんさかいに来た。",
    );
    expect(request.body.previous_text).toBe("そうまりつ。");
    expect(request.body.next_text).toBeUndefined();
    expect(request.body.language_code).toBeUndefined();
    expect(supportsAudioTags("eleven_v4")).toBe(true);
    expect(supportsAudioTags("eleven_flash_v2_5")).toBe(false);
  });

  it("changes the hash with the performance but not with the neighbours", () => {
    const base = { line: line(), cast: CAST, localeCast: localeCast(), read };
    const hash = buildTtsRequest(base).hash;
    expect(
      buildTtsRequest({
        ...base,
        localeCast: localeCast("eleven_v4"),
        next: line({ ja: "次。" }),
      }).hash,
    ).not.toBe(hash);
    expect(buildTtsRequest({ ...base, next: line({ ja: "次。" }) }).hash).toBe(
      hash,
    );
    expect(
      buildTtsRequest({ ...base, cast: { ...CAST, seed: 2 } }).hash,
    ).not.toBe(hash);
    expect(
      buildTtsRequest({ ...base, line: line({ ja: "別。" }) }).hash,
    ).not.toBe(hash);
  });
});
