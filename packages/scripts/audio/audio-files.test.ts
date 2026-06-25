import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  audioCacheRelativePath,
  audioOutputRelativePath,
  convertWithFfmpeg,
  pruneAudioCache,
  writeGeneratedAudioFile,
} from "./audio-files";
import type { AudioConvertInput } from "./audio-files";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("generated audio files", () => {
  it("stages provider bytes and writes converted OGG output", async () => {
    const repoRoot = createRepoRoot();
    const providerBytes = new Uint8Array([1, 2, 3]);
    let convertInput: AudioConvertInput | undefined;

    const result = await writeGeneratedAudioFile({
      repoRoot,
      channel: "bgs",
      id: "rain_street_light",
      providerBytes,
      convert: async (input) => {
        convertInput = input;
        expect(readFileSync(input.inputPath)).toEqual(
          Buffer.from(providerBytes),
        );
        writeFileSync(input.outputPath, new Uint8Array([9, 8, 7]));
      },
    });

    expect(result.rawPath).toBe(
      join(repoRoot, "packages/scripts/.audio-cache/bgs/rain_street_light.mp3"),
    );
    expect(result.outputPath).toBe(
      join(repoRoot, "static/assets/audio/bgs/rain_street_light.ogg"),
    );
    // Convert receives the mp3 input and a `.tmp` staging path — never the
    // final `.ogg`. writeGeneratedAudioFile atomically renames the staging
    // file into place after a non-zero-size check.
    expect(convertInput?.inputPath).toBe(result.rawPath);
    expect(convertInput?.outputPath).toBe(`${result.outputPath}.tmp`);
    expect(readFileSync(result.outputPath)).toEqual(Buffer.from([9, 8, 7]));
    // No staging file left behind after a successful rename.
    expect(
      readdirSync(dirname(result.outputPath)).filter((f) => f.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("creates parent directories for fresh SFX outputs", async () => {
    const repoRoot = createRepoRoot();

    const result = await writeGeneratedAudioFile({
      repoRoot,
      channel: "sfx",
      id: "door_chime",
      providerBytes: new Uint8Array([4, 5]),
      convert: async ({ outputPath }) => {
        writeFileSync(outputPath, new Uint8Array([6]));
      },
    });

    expect(result.rawPath).toBe(
      join(repoRoot, "packages/scripts/.audio-cache/sfx/door_chime.mp3"),
    );
    expect(result.outputPath).toBe(
      join(repoRoot, "static/assets/audio/sfx/door_chime.ogg"),
    );
    expect(readFileSync(result.outputPath)).toEqual(Buffer.from([6]));
  });

  it("rejects a zero-byte convert output and leaves no ogg at the final path", async () => {
    const repoRoot = createRepoRoot();
    const finalPath = join(
      repoRoot,
      "static/assets/audio/bgs/rain_street_light.ogg",
    );

    // Converter reports success but writes nothing — mirrors an interrupted or
    // truncated ffmpeg transcode. Must not be treated as a completed asset.
    await expect(
      writeGeneratedAudioFile({
        repoRoot,
        channel: "bgs",
        id: "rain_street_light",
        providerBytes: new Uint8Array([1, 2, 3]),
        convert: async ({ outputPath }) => {
          writeFileSync(outputPath, new Uint8Array([]));
        },
      }),
    ).rejects.toThrow(/0-byte|empty/i);

    // No partial/corrupt ogg may remain for the skip-on-exists gate to find.
    expect(existsSync(finalPath)).toBe(false);
    // And no leftover .tmp staging file in the output directory.
    const leftovers = readdirSync(dirname(finalPath)).filter((f) =>
      f.endsWith(".tmp"),
    );
    expect(leftovers).toEqual([]);
  });

  it("cleans up the staging tmp and leaves no final ogg when convert throws", async () => {
    const repoRoot = createRepoRoot();
    const finalPath = join(
      repoRoot,
      "static/assets/audio/bgs/rain_street_light.ogg",
    );

    await expect(
      writeGeneratedAudioFile({
        repoRoot,
        channel: "bgs",
        id: "rain_street_light",
        providerBytes: new Uint8Array([1, 2, 3]),
        convert: async ({ outputPath }) => {
          // ffmpeg-style partial output before failure.
          writeFileSync(outputPath, new Uint8Array([9]));
          throw new Error("ffmpeg failed: invalid input");
        },
      }),
    ).rejects.toThrow(/ffmpeg failed/i);

    expect(existsSync(finalPath)).toBe(false);
    const leftovers = readdirSync(dirname(finalPath)).filter((f) =>
      f.endsWith(".tmp"),
    );
    expect(leftovers).toEqual([]);
  });
});

describe("convertWithFfmpeg", () => {
  it("forces an OGG container for .ogg.tmp staging outputs", async () => {
    const spawn = vi.fn((_args: string[]) => ({
      exited: Promise.resolve(0),
      stderr: new Response("").body,
    }));
    vi.stubGlobal("Bun", { spawn });

    await convertWithFfmpeg({
      inputPath: "/tmp/input.mp3",
      outputPath: "/tmp/output.ogg.tmp",
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[0]).toEqual([
      "ffmpeg",
      "-y",
      "-i",
      "/tmp/input.mp3",
      "-vn",
      "-c:a",
      "libvorbis",
      "-f",
      "ogg",
      "/tmp/output.ogg.tmp",
    ]);
  });
});

function createRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lyra-audio-files-"));
  tempRoots.push(root);
  return root;
}

describe("audioOutputRelativePath", () => {
  it("produces the repo-relative .ogg path for a channel/id pair", () => {
    expect(audioOutputRelativePath("bgs", "rain_street_light")).toBe(
      "static/assets/audio/bgs/rain_street_light.ogg",
    );
    expect(audioOutputRelativePath("bgm", "chapter_1_theme")).toBe(
      "static/assets/audio/bgm/chapter_1_theme.ogg",
    );
    expect(audioOutputRelativePath("sfx", "door_chime")).toBe(
      "static/assets/audio/sfx/door_chime.ogg",
    );
  });
});

describe("audioCacheRelativePath", () => {
  it("produces the repo-relative .mp3 cache path for a channel/id pair", () => {
    expect(audioCacheRelativePath("bgs", "rain_street_light")).toBe(
      "packages/scripts/.audio-cache/bgs/rain_street_light.mp3",
    );
    expect(audioCacheRelativePath("sfx", "door_chime")).toBe(
      "packages/scripts/.audio-cache/sfx/door_chime.mp3",
    );
  });
});

describe("pruneAudioCache", () => {
  it("removes cache files whose channel/id is not in the valid set", () => {
    const repoRoot = createRepoRoot();
    const cacheDir = join(repoRoot, "packages/scripts/.audio-cache");
    // Valid entries (in the plan)
    mkdirSync(join(cacheDir, "bgs"), { recursive: true });
    writeFileSync(join(cacheDir, "bgs/keep_me.mp3"), "data");
    writeFileSync(join(cacheDir, "bgs/also_keep.mp3"), "data");
    // Stale entries (removed from the plan)
    writeFileSync(join(cacheDir, "bgs/orphan.mp3"), "data");
    mkdirSync(join(cacheDir, "sfx"), { recursive: true });
    writeFileSync(join(cacheDir, "sfx/old_sound.mp3"), "data");

    const pruned = pruneAudioCache(
      repoRoot,
      new Set(["bgs/keep_me", "bgs/also_keep"]),
    );

    expect(pruned).toHaveLength(2);
    expect(pruned).toContain("packages/scripts/.audio-cache/bgs/orphan.mp3");
    expect(pruned).toContain("packages/scripts/.audio-cache/sfx/old_sound.mp3");
    expect(existsSync(join(cacheDir, "bgs/keep_me.mp3"))).toBe(true);
    expect(existsSync(join(cacheDir, "bgs/also_keep.mp3"))).toBe(true);
    expect(existsSync(join(cacheDir, "bgs/orphan.mp3"))).toBe(false);
    expect(existsSync(join(cacheDir, "sfx/old_sound.mp3"))).toBe(false);
  });

  it("returns an empty array when the cache directory does not exist", () => {
    const repoRoot = createRepoRoot();
    const pruned = pruneAudioCache(repoRoot, new Set(["bgs/anything"]));
    expect(pruned).toEqual([]);
  });

  it("keeps non-mp3 files untouched", () => {
    const repoRoot = createRepoRoot();
    const cacheDir = join(repoRoot, "packages/scripts/.audio-cache");
    mkdirSync(join(cacheDir, "bgs"), { recursive: true });
    writeFileSync(join(cacheDir, "bgs/README.txt"), "info");
    writeFileSync(join(cacheDir, "bgs/gone.mp3"), "data");

    pruneAudioCache(repoRoot, new Set());

    expect(existsSync(join(cacheDir, "bgs/README.txt"))).toBe(true);
    expect(existsSync(join(cacheDir, "bgs/gone.mp3"))).toBe(false);
  });
});
