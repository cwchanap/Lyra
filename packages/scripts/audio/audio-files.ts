import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SoundPlanChannel } from "./types";

export type AudioConvertInput = { inputPath: string; outputPath: string };
export type AudioConverter = (input: AudioConvertInput) => Promise<void>;

export async function writeGeneratedAudioFile(input: {
  repoRoot: string;
  channel: SoundPlanChannel;
  id: string;
  providerBytes: Uint8Array;
  convert?: AudioConverter;
}): Promise<{ rawPath: string; outputPath: string }> {
  const rawPath = resolve(
    input.repoRoot,
    "packages/scripts/.audio-cache",
    input.channel,
    `${input.id}.mp3`,
  );
  const outputPath = resolve(
    input.repoRoot,
    "static/assets/audio",
    input.channel,
    `${input.id}.ogg`,
  );

  mkdirSync(dirname(rawPath), { recursive: true });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(rawPath, input.providerBytes);
  await (input.convert ?? convertWithFfmpeg)({
    inputPath: rawPath,
    outputPath,
  });

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
