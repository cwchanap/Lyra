import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approvedCastBySpeaker,
  parseVoiceCastText,
  VOICE_CAST_PATH,
} from "./voice-cast";

const CHARACTERS = `characters:
  - id: soma_ritsu
    displayNames: ["相馬律"]
    expressions:
      standard: { prompt: calm }
      shaken: { prompt: shaken }
  - id: kamiya_mio
    displayNames: ["神谷澪"]
    expressions:
      standard: { prompt: cool }
`;

function cast(entries: string): string {
  return `schemaVersion: 1
locales:
  ja:
    model: eleven_v3
    languageTextNormalization: true
    cast:
${entries}`;
}

const SOMA = `      - characterId: soma_ritsu
        status: approved
        voiceId: G4sNoJjgWjyp9nhj1Bhj
        settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1.0 }
        seed: 1101
        expressionDirections: { standard: "[calm]", shaken: "[unsettled]" }
        auditionLines:
          - ja: 不思議だな。
          - expression: shaken
            ja: 嘘じゃない。
        candidates:
          - { name: komi, voiceId: G4sNoJjgWjyp9nhj1Bhj }
`;

const KAMIYA = `      - characterId: kamiya_mio
        status: proposed
        voiceId: null
        settings: { stability: 0.4, similarityBoost: 0.8, style: 0.1, speed: 0.95 }
        seed: 1103
        expressionDirections: { standard: "[cool]" }
        auditionLines: []
        candidates: []
`;

describe("parseVoiceCastText", () => {
  it("reads the cast and maps approved roles to their speaker names", () => {
    const result = parseVoiceCastText(
      cast(SOMA + KAMIYA),
      VOICE_CAST_PATH,
      CHARACTERS,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const ja = result.value.locales.get("ja");
    expect(ja?.model).toBe("eleven_v3");
    expect(ja?.languageTextNormalization).toBe(true);
    expect(
      ja?.cast.map((entry) => [entry.characterId, entry.speakers]),
    ).toEqual([
      ["soma_ritsu", ["相馬律"]],
      ["kamiya_mio", ["神谷澪"]],
    ]);
    expect(ja?.cast[0]?.auditionLines).toEqual([
      { ja: "不思議だな。" },
      { expression: "shaken", ja: "嘘じゃない。" },
    ]);
    const approved = approvedCastBySpeaker(ja);
    expect([...approved.keys()]).toEqual(["相馬律"]);
  });

  it("rejects an approved role without a voice, unknown characters and expressions, and bad settings", () => {
    const result = parseVoiceCastText(
      cast(
        SOMA.replace("voiceId: G4sNoJjgWjyp9nhj1Bhj\n", "voiceId: null\n")
          .replace('shaken: "[unsettled]"', 'angry: "[angry]"')
          .replace("speed: 1.0", "speed: 2") +
          KAMIYA.replace("kamiya_mio", "nobody"),
      ),
      VOICE_CAST_PATH,
      CHARACTERS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const messages = result.diagnostics.map((d) => d.message).join("\n");
    expect(messages).toContain(
      "An `approved` entry needs the picked `voiceId`.",
    );
    expect(messages).toContain(
      "`expressionDirections.angry` is not an expression",
    );
    expect(messages).toContain(
      "`settings.speed` must be a number from 0.7 to 1.2.",
    );
    expect(messages).toContain("`characterId` must name a character");
  });

  it("rejects a role cast twice and unknown fields", () => {
    const result = parseVoiceCastText(
      cast(SOMA + SOMA.replace("seed: 1101", "seed: 1101\n        mood: grim")),
      VOICE_CAST_PATH,
      CHARACTERS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const messages = result.diagnostics.map((d) => d.message);
    expect(messages).toContain('Unknown field "mood".');
  });

  it("accepts the committed cast file", () => {
    const repoRoot = resolve(__dirname, "../../..");
    const result = parseVoiceCastText(
      readFileSync(resolve(repoRoot, VOICE_CAST_PATH), "utf-8"),
      VOICE_CAST_PATH,
      readFileSync(
        resolve(repoRoot, "static/assets/config/characters.yaml"),
        "utf-8",
      ),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const ja = result.value.locales.get("ja");
    expect(ja?.cast.map((entry) => entry.characterId)).toEqual([
      "soma_ritsu",
      "hayasaka_akane",
      "kamiya_mio",
      "kurose_toru",
    ]);
    for (const entry of ja?.cast ?? []) {
      expect(entry.candidates.length).toBeGreaterThan(0);
      expect(entry.auditionLines.length).toBe(3);
    }
  });
});
