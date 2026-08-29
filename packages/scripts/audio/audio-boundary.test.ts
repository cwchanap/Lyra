import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CHANNELS = 2;
const SAMPLE_RATE = 44_100;
const MAX_SILENCE_SECONDS = 0.1;
const MAX_SILENCE_FRAMES = SAMPLE_RATE * MAX_SILENCE_SECONDS;
const MAX_SILENCE_RMS = 10 ** (-45 / 20);
const MAX_BOUNDARY_RMS = 0.005;
const ASSETS = [
  "bgm_city_summary_motif",
  "bgm_casework_day",
  "bgm_rain_bell_daily",
  "bgm_breakthrough_pursuit",
  "bgm_chapter_close",
  "bgm_review_board_loss",
  "bgm_review_board_victory",
] as const;

describe("Chapter 1 BGM Vorbis loop boundaries", () => {
  it.each(ASSETS)(
    "keeps the decoded loop boundary click-safe without long silence for %s",
    (id) => {
      const path = resolve(
        import.meta.dirname,
        "../../..",
        "static/assets/audio/bgm",
        `${id}.ogg`,
      );
      const singleCycle = decode(path);
      const twoCycles = decode(path, true);
      expect(singleCycle.length % CHANNELS).toBe(0);
      expect(twoCycles.length).toBe(singleCycle.length * 2);
      expect(longestSilenceFrames(singleCycle)).toBeLessThan(
        MAX_SILENCE_FRAMES,
      );
      expect(longestSilenceFrames(twoCycles)).toBeLessThan(MAX_SILENCE_FRAMES);
      const cycleFrames = singleCycle.length / CHANNELS;
      const boundary = cycleFrames * CHANNELS;
      const leftJump = twoCycles[boundary]! - twoCycles[boundary - CHANNELS]!;
      const rightJump =
        twoCycles[boundary + 1]! - twoCycles[boundary - CHANNELS + 1]!;
      const boundaryRms = Math.hypot(leftJump, rightJump) / Math.SQRT2;

      expect(boundaryRms).toBeLessThan(MAX_BOUNDARY_RMS);
    },
  );
});

function longestSilenceFrames(pcm: Float32Array): number {
  let longest = 0;
  let current = 0;
  for (let index = 0; index < pcm.length; index += CHANNELS) {
    const left = pcm[index]!;
    const right = pcm[index + 1]!;
    const frameRms = Math.hypot(left, right) / Math.SQRT2;
    if (frameRms <= MAX_SILENCE_RMS) {
      current += 1;
      continue;
    }
    longest = Math.max(longest, current);
    current = 0;
  }
  return Math.max(longest, current);
}

function decode(path: string, loop = false): Float32Array {
  const process = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      ...(loop ? ["-stream_loop", "1"] : []),
      "-i",
      path,
      "-f",
      "f32le",
      "-ac",
      String(CHANNELS),
      "-ar",
      String(SAMPLE_RATE),
      "pipe:1",
    ],
    { maxBuffer: 128 * 1024 * 1024 },
  );
  if (process.error) throw process.error;
  if (process.status !== 0) {
    throw new Error(
      process.stderr?.toString() || `ffmpeg exited with ${process.status}`,
    );
  }
  if (
    !process.stdout ||
    process.stdout.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0
  ) {
    throw new Error("ffmpeg returned a partial PCM sample");
  }
  return new Float32Array(
    process.stdout.buffer,
    process.stdout.byteOffset,
    process.stdout.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}
