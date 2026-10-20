import { buildTtsRequest, type TtsRequest } from "./tts-request";
import { AUDITION_DIR } from "./voice-files";
import type { CastCandidate, LocaleCast } from "./voice-cast";

export type AuditionTake = {
  candidate: CastCandidate;
  /** 1-based audition line number. */
  lineNumber: number;
  /** Repo-relative mp3 path under the gitignored audition folder. */
  path: string;
  request: TtsRequest;
};

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** `.voice-auditions/kamiya_mio/kasane_ioLsi3BGjCKHDhF2fNod_2.mp3` */
export function auditionPath(
  characterId: string,
  candidate: CastCandidate,
  lineNumber: number,
): string {
  const name = slug(candidate.name) || "voice";
  return `${AUDITION_DIR}/${characterId}/${name}_${candidate.voiceId}_${lineNumber}.mp3`;
}

/**
 * One take per candidate voice and audition line, using the role's settings,
 * seed and expression directions so auditions sound like the real run.
 */
export function planAuditions(input: {
  localeCast: LocaleCast;
  characterId: string;
  candidateVoiceId?: string | undefined;
  read: (text: string) => string;
}): { ok: true; takes: AuditionTake[] } | { ok: false; message: string } {
  const cast = input.localeCast.cast.find(
    (entry) => entry.characterId === input.characterId,
  );
  if (!cast) {
    return {
      ok: false,
      message: `${input.characterId} has no ${input.localeCast.locale} cast entry in voice_cast.yaml.`,
    };
  }
  const candidates =
    input.candidateVoiceId === undefined
      ? cast.candidates
      : [
          cast.candidates.find((c) => c.voiceId === input.candidateVoiceId) ?? {
            name: "candidate",
            voiceId: input.candidateVoiceId,
          },
        ];
  if (candidates.length === 0) {
    return { ok: false, message: `${input.characterId} lists no candidates.` };
  }
  if (cast.auditionLines.length === 0) {
    return {
      ok: false,
      message: `${input.characterId} lists no auditionLines.`,
    };
  }
  const takes: AuditionTake[] = [];
  for (const candidate of candidates) {
    cast.auditionLines.forEach((audition, index) => {
      const speaker = cast.speakers[0] ?? cast.characterId;
      takes.push({
        candidate,
        lineNumber: index + 1,
        path: auditionPath(cast.characterId, candidate, index + 1),
        request: buildTtsRequest({
          line: {
            id: `L${String(index + 1).padStart(3, "0")}`,
            speaker,
            zh: "",
            ja: audition.ja,
            ...(audition.expression === undefined
              ? {}
              : { expression: audition.expression }),
          },
          cast: { ...cast, voiceId: candidate.voiceId },
          localeCast: input.localeCast,
          read: input.read,
        }),
      });
    });
  }
  return { ok: true, takes };
}
