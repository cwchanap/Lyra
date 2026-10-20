import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { AudioConverter, AudioConvertInput } from "../audio/audio-files";

/** `static/assets/voice/ja`, where the game loads clips from. */
export function voiceOutputDir(locale: string): string {
  return `static/assets/voice/${locale}`;
}

export function voiceOutputPath(locale: string, clip: string): string {
  return `${voiceOutputDir(locale)}/${clip}.ogg`;
}

/**
 * Provider mp3s, keyed by clip and input hash so a cached take is reused only
 * for the exact same request. Gitignored and safe to delete.
 */
export function voiceCachePath(
  locale: string,
  clip: string,
  hash: string,
): string {
  return `packages/scripts/.voice-cache/${locale}/${clip}.${hash}.mp3`;
}

/** Audition takes for listening; gitignored, never committed. */
export const AUDITION_DIR = ".voice-auditions";

/** Clip IDs that already have an `.ogg` under the locale's voice directory. */
export function listVoiceClipFiles(repoRoot: string, locale: string): string[] {
  const dir = resolve(repoRoot, voiceOutputDir(locale));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ogg"))
    .map((name) => name.slice(0, -4));
}

/**
 * Writes the provider mp3 to the cache, post-processes it into the clip's
 * `.ogg` through a staging file, and renames it into place only when the
 * output is non-empty, so a failed run never leaves a partial clip behind.
 */
export async function writeVoiceClip(input: {
  repoRoot: string;
  locale: string;
  clip: string;
  hash: string;
  providerBytes: Uint8Array;
  convert?: AudioConverter | undefined;
}): Promise<{ cachePath: string; outputPath: string }> {
  const cachePath = voiceCachePath(input.locale, input.clip, input.hash);
  const outputPath = voiceOutputPath(input.locale, input.clip);
  const fullCache = resolve(input.repoRoot, cachePath);
  const fullOutput = resolve(input.repoRoot, outputPath);
  const staging = `${fullOutput}.tmp`;
  mkdirSync(dirname(fullCache), { recursive: true });
  mkdirSync(dirname(fullOutput), { recursive: true });
  writeFileSync(fullCache, input.providerBytes);
  try {
    await (input.convert ?? convertVoiceWithFfmpeg)({
      inputPath: fullCache,
      outputPath: staging,
    });
    if (statSync(staging).size === 0) {
      throw new Error(`ffmpeg produced 0-byte output for ${input.clip}`);
    }
    renameSync(staging, fullOutput);
  } catch (error) {
    rmSync(staging, { force: true });
    throw error;
  }
  return { cachePath, outputPath };
}

/**
 * Trims leading and trailing silence (the second trim runs on the reversed
 * signal), normalizes loudness to -18 LUFS integrated, and writes mono
 * 44.1 kHz Ogg Vorbis.
 */
export const VOICE_FILTER = [
  "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05",
  "areverse",
  "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15",
  "areverse",
  "loudnorm=I=-18:TP=-1.5:LRA=11",
].join(",");

export async function convertVoiceWithFfmpeg(
  input: AudioConvertInput,
): Promise<void> {
  const process = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i",
      input.inputPath,
      "-vn",
      "-af",
      VOICE_FILTER,
      "-ac",
      "1",
      "-ar",
      "44100",
      "-c:a",
      "libvorbis",
      "-q:a",
      "4",
      "-f",
      "ogg",
      input.outputPath,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    const detail = stderr.trim();
    throw new Error(
      `ffmpeg failed converting ${input.inputPath} to ${input.outputPath}: exit ${exitCode}${detail ? `\n${detail}` : ""}`,
    );
  }
}
