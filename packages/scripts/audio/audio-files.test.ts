import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeGeneratedAudioFile } from "./audio-files";
import type { AudioConvertInput } from "./audio-files";

const tempRoots: string[] = [];

afterEach(() => {
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
    expect(convertInput).toEqual({
      inputPath: result.rawPath,
      outputPath: result.outputPath,
    });
    expect(readFileSync(result.outputPath)).toEqual(Buffer.from([9, 8, 7]));
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
});

function createRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lyra-audio-files-"));
  tempRoots.push(root);
  return root;
}
