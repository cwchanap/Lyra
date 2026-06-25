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
import YAML from "yaml";
import {
  loadDotEnv,
  PAYMENT_REQUIRED_EXIT_CODE,
  planGeneration,
  runGenerateCommand,
} from "./generate";
import type { AudioConverter } from "./audio-files";
import type { SoundPlanChannel, SoundPlanStatus } from "./types";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("audio generation planning", () => {
  it("plans approved missing entries in dry-run mode", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: false,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.toGenerate).toHaveLength(1);
    const target = result.toGenerate[0]!;
    expect(target.entry.id).toBe("rain_street_light");
    expect(target.outputPath).toBe(
      "static/assets/audio/bgs/rain_street_light.ogg",
    );
  });

  it("requires an API key for non-dry-run generation", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: false,
      force: false,
    });

    expect(result.toGenerate).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "audioGenerateMissingApiKey",
      }),
    );
  });

  it("does not require an API key when all eligible outputs already exist", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);
    writeFile(
      repoRoot,
      "static/assets/audio/bgs/rain_street_light.ogg",
      "already generated",
    );

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: false,
      force: false,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.toGenerate).toEqual([]);
  });

  it("skips existing outputs unless forced", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);
    writeFile(
      repoRoot,
      "static/assets/audio/bgs/rain_street_light.ogg",
      "already generated",
    );

    const skipped = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: false,
    });
    const forced = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: true,
    });

    expect(skipped.diagnostics).toEqual([]);
    expect(skipped.toGenerate).toEqual([]);
    expect(forced.diagnostics).toEqual([]);
    expect(forced.toGenerate.map((target) => target.entry.id)).toEqual([
      "rain_street_light",
    ]);
  });

  it("plans only approved and generated entries", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({ id: "approved_rain", channel: "bgs", status: "approved" }),
      soundEntry({ id: "generated_rain", channel: "bgs", status: "generated" }),
      soundEntry({ id: "proposed_rain", channel: "bgs", status: "proposed" }),
      soundEntry({ id: "rejected_rain", channel: "bgs", status: "rejected" }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: false,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.toGenerate.map((target) => target.entry.id)).toEqual([
      "approved_rain",
      "generated_rain",
    ]);
  });

  it("filters planned generation by entry id", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({ id: "first_rain", channel: "bgs", status: "approved" }),
      soundEntry({ id: "second_rain", channel: "bgs", status: "approved" }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: false,
      only: "second_rain",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.toGenerate.map((target) => target.outputPath)).toEqual([
      "static/assets/audio/bgs/second_rain.ogg",
    ]);
  });

  it("reports an unknown --only target before API key enforcement", () => {
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: false,
      force: false,
      only: "typo",
    });

    expect(result.toGenerate).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "audioGenerateOnlyNotFound",
        path: "--only",
        message: expect.stringContaining("typo"),
      }),
    ]);
  });

  it("reports --only targeting a non-approved entry instead of silently doing nothing", () => {
    // An id that EXISTS but is proposed/rejected currently passes the
    // existence check, gets filtered by status, leaves nothing to generate,
    // and exits 0 with no output. That is a silent-success trap — the user
    // believes the command succeeded while nothing happened.
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "proposed",
      }),
    ]);

    const result = planGeneration({
      repoRoot,
      planPath,
      dryRun: true,
      force: false,
      only: "rain_street_light",
    });

    expect(result.toGenerate).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "audioGenerateOnlyNotApproved",
        path: "--only",
        message: expect.stringContaining("rain_street_light"),
      }),
    ]);
  });
});

describe("runGenerateCommand 402 handling", () => {
  const origKey = process.env["ELEVENLABS_API_KEY"];
  const fetchMock = vi.fn();

  afterEach(() => {
    if (origKey === undefined) delete process.env["ELEVENLABS_API_KEY"];
    else process.env["ELEVENLABS_API_KEY"] = origKey;
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("returns the payment-required exit code and top-up guidance on 402", async () => {
    process.env["ELEVENLABS_API_KEY"] = "test-key";
    // Stub the global fetch the ElevenLabs client falls back to when no
    // fetch is injected.
    fetchMock.mockResolvedValue(
      new Response("payment required", {
        status: 402,
        statusText: "Payment Required",
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof globalThis.fetch);

    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);
    const stderr: string[] = [];
    const stdout: string[] = [];

    const code = await runGenerateCommand([planPath], {
      repoRoot,
      cwd: repoRoot,
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
    });

    expect(code).toBe(PAYMENT_REQUIRED_EXIT_CODE);
    // The provider call must have been attempted (otherwise the 402 path is
    // not what produced this exit code).
    expect(fetchMock).toHaveBeenCalled();
    expect(stderr.some((m) => /402 Payment Required/.test(m))).toBe(true);
    expect(stderr.some((m) => /Do not retry with --force/.test(m))).toBe(true);
    // No successful-write line should have been logged.
    expect(stdout).toEqual([]);
  });

  it("treats a 401 quota_exceeded response as payment-required (exit 3), not a generic failure", async () => {
    // ElevenLabs documents quota exhaustion as 401 with a quota_exceeded body.
    // The documented exit-3 contract must hold for this case — the most common
    // real-world billing failure — not just for a literal 402.
    process.env["ELEVENLABS_API_KEY"] = "test-key";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "quota_exceeded" }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof globalThis.fetch);

    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);
    const stderr: string[] = [];

    const code = await runGenerateCommand([planPath], {
      repoRoot,
      cwd: repoRoot,
      stderr: (m) => stderr.push(m),
    });

    expect(code).toBe(PAYMENT_REQUIRED_EXIT_CODE);
    expect(fetchMock).toHaveBeenCalled();
    expect(stderr.some((m) => /quota_exceeded/.test(m))).toBe(true);
    expect(stderr.some((m) => /Do not retry with --force/.test(m))).toBe(true);
  });

  it("returns the generic failure exit code on a non-402 provider error", async () => {
    process.env["ELEVENLABS_API_KEY"] = "test-key";
    fetchMock.mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        statusText: "Too Many Requests",
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof globalThis.fetch);

    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);
    const stderr: string[] = [];

    const code = await runGenerateCommand([planPath], {
      repoRoot,
      cwd: repoRoot,
      stderr: (m) => stderr.push(m),
    });

    // A 429 is NOT a billing failure — it must not use the payment-required
    // exit code, and it must not print the do-not-retry-with-force guidance.
    expect(code).not.toBe(PAYMENT_REQUIRED_EXIT_CODE);
    expect(code).toBe(1);
    expect(stderr.some((m) => /Do not retry with --force/.test(m))).toBe(false);
  });
});

describe("runGenerateCommand write-back consistency", () => {
  const origKey = process.env["ELEVENLABS_API_KEY"];
  const fetchMock = vi.fn();

  afterEach(() => {
    if (origKey === undefined) delete process.env["ELEVENLABS_API_KEY"];
    else process.env["ELEVENLABS_API_KEY"] = origKey;
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("reports a distinct orphaned-output message when plan write-back fails after the ogg is written", async () => {
    // Mirrors the real failure mode: the .ogg transcode succeeds and the file
    // is renamed into place, but the per-entry metadata write-back throws
    // (disk full, plan deleted out from under us, permission flip, ...). The
    // command must not report a generic "failed to generate" that hides the
    // fact the output exists and the plan still says "approved" — combined
    // with the skip-on-exists gate, that would silently strand the entry.
    process.env["ELEVENLABS_API_KEY"] = "test-key";
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        statusText: "OK",
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof globalThis.fetch);

    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);

    // The converter writes valid ogg bytes AND deletes the plan file as a
    // side effect, so the subsequent applyGenerationMetadataToPlan read throws
    // after the output is already on disk.
    const sabotageConvert: AudioConverter = async ({ outputPath }) => {
      writeFileSync(outputPath, new Uint8Array([9, 8, 7, 6]));
      rmSync(planPath, { force: true });
    };

    const stderr: string[] = [];
    const code = await runGenerateCommand([planPath], {
      repoRoot,
      cwd: repoRoot,
      stderr: (m) => stderr.push(m),
      convert: sabotageConvert,
    });

    // Still a failure.
    expect(code).toBe(1);
    // But the message must distinguish the orphaned-output case and steer the
    // user toward reconciliation — not the generic "failed to generate" line.
    expect(stderr.some((m) => /output was written/i.test(m))).toBe(true);
    expect(stderr.some((m) => /plan write-back failed/i.test(m))).toBe(true);
    expect(stderr.some((m) => /--force/.test(m))).toBe(true);
    expect(stderr.some((m) => /failed to generate/i.test(m))).toBe(false);

    // The ogg really is on disk (the orphan), even though the command failed.
    expect(
      existsSync(
        join(repoRoot, "static/assets/audio/bgs/rain_street_light.ogg"),
      ),
    ).toBe(true);
  });
});

describe("runGenerateCommand happy path", () => {
  const origKey = process.env["ELEVENLABS_API_KEY"];
  const fetchMock = vi.fn();

  afterEach(() => {
    if (origKey === undefined) delete process.env["ELEVENLABS_API_KEY"];
    else process.env["ELEVENLABS_API_KEY"] = origKey;
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("writes the converted ogg, writes back generation metadata, and exits 0", async () => {
    process.env["ELEVENLABS_API_KEY"] = "test-key";
    const providerBytes = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValue(
      new Response(providerBytes, { status: 200, statusText: "OK" }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof globalThis.fetch);

    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);

    // Inject a fake converter so the test does not depend on a real ffmpeg
    // binary. Writes deterministic bytes to whatever output path it is given.
    const fakeConvert: AudioConverter = async ({ outputPath }) => {
      writeFileSync(outputPath, new Uint8Array([9, 8, 7, 6]));
    };

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runGenerateCommand([planPath], {
      repoRoot,
      cwd: repoRoot,
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
      convert: fakeConvert,
    });

    // Exit 0 and the success line was logged.
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(
      stdout.some((m) =>
        /wrote static\/assets\/audio\/bgs\/rain_street_light\.ogg/.test(m),
      ),
    ).toBe(true);
    expect(stdout.some((m) => /updated plan/.test(m))).toBe(true);

    // The converted ogg exists on disk with the bytes the converter wrote.
    const oggPath = join(
      repoRoot,
      "static/assets/audio/bgs/rain_street_light.ogg",
    );
    expect(readFileSync(oggPath)).toEqual(Buffer.from([9, 8, 7, 6]));

    // The plan was updated: status approved -> generated, provenance present.
    const updated = YAML.parse(readFileSync(planPath, "utf-8")) as {
      entries: Array<{
        id: string;
        status: string;
        promptHash?: string;
        outputPath?: string;
        provider?: string;
      }>;
    };
    const entry = updated.entries.find((e) => e.id === "rain_street_light");
    expect(entry?.status).toBe("generated");
    expect(entry?.provider).toBe("elevenlabs");
    expect(typeof entry?.promptHash).toBe("string");
    expect(entry?.promptHash).toHaveLength(12);
    expect(entry?.outputPath).toBe(
      "static/assets/audio/bgs/rain_street_light.ogg",
    );

    // No leftover tmp file in the output directory.
    const oggDir = dirname(oggPath);
    const leftovers = readdirSync(oggDir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("reuses cached provider mp3 bytes without another provider request", async () => {
    process.env["ELEVENLABS_API_KEY"] = "test-key";
    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);
    const cachedProviderBytes = new Uint8Array([5, 6, 7, 8]);
    writeFile(
      repoRoot,
      "packages/scripts/.audio-cache/bgs/rain_street_light.mp3",
      Buffer.from(cachedProviderBytes),
    );

    const fakeConvert: AudioConverter = async ({ inputPath, outputPath }) => {
      expect(readFileSync(inputPath)).toEqual(Buffer.from(cachedProviderBytes));
      writeFileSync(outputPath, new Uint8Array([9, 8, 7, 6]));
    };

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runGenerateCommand([planPath], {
      repoRoot,
      cwd: repoRoot,
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
      convert: fakeConvert,
    });

    expect(code).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderr).toEqual([]);
    expect(stdout.some((m) => /reusing cached mp3/.test(m))).toBe(true);
    expect(
      readFileSync(
        join(repoRoot, "static/assets/audio/bgs/rain_street_light.ogg"),
      ),
    ).toEqual(Buffer.from([9, 8, 7, 6]));

    const updated = YAML.parse(readFileSync(planPath, "utf-8")) as {
      entries: Array<{ id: string; status: string; outputPath?: string }>;
    };
    const entry = updated.entries.find((e) => e.id === "rain_street_light");
    expect(entry?.status).toBe("generated");
    expect(entry?.outputPath).toBe(
      "static/assets/audio/bgs/rain_street_light.ogg",
    );
  });

  it("prunes stale cache entries after a successful full run", async () => {
    process.env["ELEVENLABS_API_KEY"] = "test-key";
    const providerBytes = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValue(
      new Response(providerBytes, { status: 200, statusText: "OK" }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof globalThis.fetch);

    const repoRoot = createRepoRoot();
    const planPath = writePlan(repoRoot, [
      soundEntry({
        id: "rain_street_light",
        channel: "bgs",
        status: "approved",
      }),
    ]);

    // Seed the cache: the real entry plus an orphan from a removed plan id.
    const cacheDir = join(repoRoot, "packages/scripts/.audio-cache");
    mkdirSync(join(cacheDir, "bgs"), { recursive: true });
    writeFileSync(join(cacheDir, "bgs/rain_street_light.mp3"), "real");
    writeFileSync(join(cacheDir, "bgs/orphan.mp3"), "stale");

    const fakeConvert: AudioConverter = async ({ outputPath }) => {
      writeFileSync(outputPath, new Uint8Array([9, 8, 7, 6]));
    };

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runGenerateCommand([planPath], {
      repoRoot,
      cwd: repoRoot,
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
      convert: fakeConvert,
    });

    expect(code).toBe(0);
    // Stale cache file was pruned.
    expect(existsSync(join(cacheDir, "bgs/orphan.mp3"))).toBe(false);
    // Real entry's cache file was preserved.
    expect(existsSync(join(cacheDir, "bgs/rain_street_light.mp3"))).toBe(true);
    // Prune was reported on stdout.
    expect(stdout.some((m) => /pruned stale cache/.test(m))).toBe(true);
    expect(stdout.some((m) => /orphan/.test(m))).toBe(true);
  });
});

function createRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lyra-audio-generate-"));
  tempRoots.push(root);
  return root;
}

function writePlan(repoRoot: string, entries: string[]): string {
  const planPath = join(repoRoot, "docs/audio_plans/missing.sound-plan.yaml");
  writeFile(
    repoRoot,
    "docs/audio_plans/missing.sound-plan.yaml",
    `schemaVersion: 1
chapterId: chapter_1
sources:
  - docs/stories_plan/chapter_1/scene_0.md
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries:
${entries.join("")}cues: []
rejected: []
`,
  );
  return planPath;
}

function soundEntry(input: {
  id: string;
  channel: SoundPlanChannel;
  status: SoundPlanStatus;
}): string {
  return `  - id: ${input.id}
    channel: ${input.channel}
    status: ${input.status}
    loop: true
    intendedDurationSeconds: 30
    prompt: "Steady light Tokyo street rain."
    reuseRationale: "Exterior rain pool."
    evidence:
      - file: docs/stories_plan/chapter_1/scene_0.md
        line: 3
        note: "rainy street"
`;
}

function writeFile(
  repoRoot: string,
  path: string,
  text: string | NodeJS.ArrayBufferView,
): void {
  const fullPath = join(repoRoot, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, text);
}

describe("loadDotEnv", () => {
  it("loads keys from .env into process.env", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lyra-dotenv-"));
    tempRoots.push(repoRoot);
    writeFileSync(
      join(repoRoot, ".env"),
      "TEST_DOTENV_KEY=hello\n# comment\nBLANK=\n",
    );

    const before = process.env["TEST_DOTENV_KEY"];
    delete process.env["TEST_DOTENV_KEY"];
    delete process.env["BLANK"];
    loadDotEnv(repoRoot);
    expect(process.env["TEST_DOTENV_KEY"]).toBe("hello");
    expect(process.env["BLANK"]).toBe("");

    // Restore.
    if (before !== undefined) process.env["TEST_DOTENV_KEY"] = before;
    else delete process.env["TEST_DOTENV_KEY"];
    delete process.env["BLANK"];
  });

  it("does not override existing environment variables", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lyra-dotenv-"));
    tempRoots.push(repoRoot);
    writeFileSync(join(repoRoot, ".env"), "TEST_DOTENV_OVERRIDE=fromfile\n");

    process.env["TEST_DOTENV_OVERRIDE"] = "fromenv";
    loadDotEnv(repoRoot);
    expect(process.env["TEST_DOTENV_OVERRIDE"]).toBe("fromenv");
    delete process.env["TEST_DOTENV_OVERRIDE"];
  });

  it("strips surrounding quotes", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lyra-dotenv-"));
    tempRoots.push(repoRoot);
    writeFileSync(
      join(repoRoot, ".env"),
      "TEST_DOTENV_QUOTED=\"quoted value\"\nTEST_DOTENV_SINGLE='single'\n",
    );

    delete process.env["TEST_DOTENV_QUOTED"];
    delete process.env["TEST_DOTENV_SINGLE"];
    loadDotEnv(repoRoot);
    expect(process.env["TEST_DOTENV_QUOTED"]).toBe("quoted value");
    expect(process.env["TEST_DOTENV_SINGLE"]).toBe("single");
    delete process.env["TEST_DOTENV_QUOTED"];
    delete process.env["TEST_DOTENV_SINGLE"];
  });

  it("is a no-op when .env does not exist", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lyra-dotenv-"));
    tempRoots.push(repoRoot);
    loadDotEnv(repoRoot); // should not throw
  });
});
