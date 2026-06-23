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
import type { SoundPlanChannel } from "./types";

export type AudioConvertInput = { inputPath: string; outputPath: string };
export type AudioConverter = (input: AudioConvertInput) => Promise<void>;

/** Base directory (repo-relative) for generated `.ogg` audio. */
const AUDIO_OUTPUT_DIR = "static/assets/audio";

/** Base directory (repo-relative) for cached provider `.mp3` bytes. */
const AUDIO_CACHE_DIR = "packages/scripts/.audio-cache";

/**
 * Repo-relative path of the generated `.ogg` for a channel/id pair.
 *
 * Single source of truth for the output path — both `writeGeneratedAudioFile`
 * (on-disk write target) and `planGeneration` (skip gate, dry-run reporting,
 * plan-metadata write-back) resolve through this helper so the two sites can
 * never silently drift.
 */
export function audioOutputRelativePath(
  channel: SoundPlanChannel,
  id: string,
): string {
  return `${AUDIO_OUTPUT_DIR}/${channel}/${id}.ogg`;
}

/**
 * Repo-relative path of the cached provider `.mp3` for a channel/id pair.
 *
 * Cache files are regenerable: they are written by {@link writeGeneratedAudioFile}
 * during generation and can be safely deleted — the next generation run will
 * re-fetch from ElevenLabs and re-write them. Stale entries (ids removed from
 * the plan) are pruned automatically by {@link pruneAudioCache} after a
 * successful full generation run.
 */
export function audioCacheRelativePath(
  channel: SoundPlanChannel,
  id: string,
): string {
  return `${AUDIO_CACHE_DIR}/${channel}/${id}.mp3`;
}

/** The three audio channels that own cache sub-directories. */
const CACHE_CHANNELS = ["bgm", "bgs", "sfx"] as const;

/**
 * Delete cached `.mp3` files whose `channel/id` is not in `validKeys`.
 *
 * Called after a successful, non-`--only`, non-`--dry-run` generation run to
 * prevent stale entries (removed or renamed plan ids) from accumulating in
 * `packages/scripts/.audio-cache/` indefinitely. Non-`.mp3` files are left
 * untouched.
 *
 * @returns Repo-relative paths of the files that were deleted, for reporting.
 */
export function pruneAudioCache(
  repoRoot: string,
  validKeys: Set<string>,
): string[] {
  const cacheDir = resolve(repoRoot, AUDIO_CACHE_DIR);
  if (!existsSync(cacheDir)) return [];

  const pruned: string[] = [];
  for (const channel of CACHE_CHANNELS) {
    const channelDir = resolve(cacheDir, channel);
    if (!existsSync(channelDir)) continue;
    for (const file of readdirSync(channelDir)) {
      if (!file.endsWith(".mp3")) continue;
      const id = file.slice(0, -4); // strip ".mp3"
      const key = `${channel}/${id}`;
      if (!validKeys.has(key)) {
        rmSync(resolve(channelDir, file), { force: true });
        pruned.push(`${AUDIO_CACHE_DIR}/${channel}/${file}`);
      }
    }
  }
  return pruned;
}

/**
 * Write provider bytes to the mp3 cache, transcode to OGG, and return both
 * paths.
 *
 * The transcode target is a sibling `.tmp` staging path — never the final
 * `.ogg`. After the converter returns, the staging file is size-checked
 * (rejecting zero-byte outputs that mirror an interrupted ffmpeg) and
 * atomically rename(2)'d into place. On any failure (converter throw,
 * zero-byte output) the staging file is removed so the `existsSync`-based
 * skip gate in `planGeneration` cannot mistake a partial transcode for a
 * completed asset and silently ship it.
 */
export async function writeGeneratedAudioFile(input: {
  repoRoot: string;
  channel: SoundPlanChannel;
  id: string;
  providerBytes: Uint8Array;
  convert?: AudioConverter;
}): Promise<{ rawPath: string; outputPath: string }> {
  const rawPath = resolve(
    input.repoRoot,
    audioCacheRelativePath(input.channel, input.id),
  );
  const outputPath = resolve(
    input.repoRoot,
    audioOutputRelativePath(input.channel, input.id),
  );
  const stagingPath = `${outputPath}.tmp`;

  mkdirSync(dirname(rawPath), { recursive: true });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(rawPath, input.providerBytes);

  try {
    await (input.convert ?? convertWithFfmpeg)({
      inputPath: rawPath,
      outputPath: stagingPath,
    });
    const size = statSync(stagingPath).size;
    if (size === 0) {
      throw new Error(
        `ffmpeg produced 0-byte output for ${input.channel}/${input.id}`,
      );
    }
    renameSync(stagingPath, outputPath);
  } catch (error) {
    // Remove any partial/staging output so a later run's existsSync gate
    // cannot treat a failed transcode as a completed asset.
    rmSync(stagingPath, { force: true });
    throw error;
  }

  return { rawPath, outputPath };
}

export async function convertWithFfmpeg(
  input: AudioConvertInput,
): Promise<void> {
  const process = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i",
      input.inputPath,
      "-vn",
      "-c:a",
      "libvorbis",
      input.outputPath,
    ],
    {
      stdout: "ignore",
      stderr: "pipe",
    },
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
