import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentRequiredError } from "../audio/elevenlabs-client";
import { compile, formatErrors } from "../compile-scenes/orchestrator";
import { runVoiceCli } from "./cli";

const FIXTURE = resolve(__dirname, "../__fixtures__/asset_enabled");
const SCRIPT = "docs/stories_plan/chapter_1/ja/scene_0.ja.yaml";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lyra-voice-cli-"));
  tempRoots.push(root);
  cpSync(join(FIXTURE, "stories_plan"), join(root, "docs/stories_plan"), {
    recursive: true,
  });
  cpSync(join(FIXTURE, "assets/config"), join(root, "static/assets/config"), {
    recursive: true,
  });
  return root;
}

async function run(repoRoot: string, args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runVoiceCli(args, {
    repoRoot,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  });
  return { code, stdout, stderr };
}

describe("voice cli", () => {
  it("rejects a missing chapter and unknown flags", async () => {
    const repoRoot = createRepoRoot();
    expect((await run(repoRoot, ["sync"])).code).toBe(2);
    expect((await run(repoRoot, ["validate", "chapter_1", "--fix"])).code).toBe(
      2,
    );
    expect((await run(repoRoot, ["translate", "chapter_1"])).code).toBe(2);
  });

  it("adds line IDs and skeletons once, then keeps translations by ID when the scene changes", async () => {
    const repoRoot = createRepoRoot();
    const scriptPath = join(repoRoot, SCRIPT);
    const scenePath = join(repoRoot, "docs/stories_plan/chapter_1/scene_0.md");

    const first = await run(repoRoot, ["sync", "chapter_1"]);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(
      "[voice] added 78 line IDs to docs/stories_plan/chapter_1/scene_0.md",
    );
    expect(first.stdout).toContain(`[voice] wrote ${SCRIPT}`);
    const scene = readFileSync(scenePath, "utf-8");
    expect(scene).toContain("**相馬律**：不說謊。 {#L001}\n");
    expect(scene).toContain(
      "**早坂茜**[concerned]：KAGAMI 門鎖時間線指向他。警察幾乎確定了。 {#L010}\n",
    );
    const skeleton = readFileSync(scriptPath, "utf-8");
    expect(skeleton).toContain(
      [
        "  - id: L010",
        "    speaker: 早坂茜",
        "    expression: concerned",
        "    zh: KAGAMI 門鎖時間線指向他。警察幾乎確定了。",
        '    ja: ""',
      ].join("\n"),
    );

    const again = await run(repoRoot, ["sync", "chapter_1"]);
    expect(
      again.stdout.some(
        (line) =>
          line.startsWith("[voice] wrote") || line.startsWith("[voice] added"),
      ),
    ).toBe(false);

    const notStrict = await run(repoRoot, ["validate", "chapter_1"]);
    expect(notStrict.code).toBe(0);
    const strict = await run(repoRoot, ["validate", "chapter_1", "--strict"]);
    expect(strict.code).toBe(2);
    expect(strict.stderr.join("\n")).toContain("localeScriptUntranslated");

    // Translate L001, then edit its text and add a line after it.
    writeFileSync(
      scriptPath,
      skeleton.replace(
        '    zh: 不說謊。\n    ja: ""',
        "    zh: 不說謊。\n    ja: 嘘をつかない。",
      ),
    );
    writeFileSync(
      scenePath,
      scene.replace(
        "**相馬律**：不說謊。 {#L001}",
        "**相馬律**：絕不說謊。 {#L001}\n\n**相馬律**：真的。",
      ),
    );

    const resync = await run(repoRoot, ["sync", "chapter_1"]);
    expect(resync.code).toBe(0);
    expect(readFileSync(scenePath, "utf-8")).toContain(
      "**相馬律**：絕不說謊。 {#L001}\n\n**相馬律**：真的。 {#L079}",
    );
    expect(resync.stdout.at(-1)).toMatch(
      /1 line IDs added, 1 entries added, .* 0 stale/,
    );
    const updated = readFileSync(scriptPath, "utf-8");
    expect(updated).toContain(
      '  - id: L001\n    speaker: 相馬律\n    zh: 不說謊。\n    ja: 嘘をつかない。\n  - id: L079\n    speaker: 相馬律\n    zh: 真的。\n    ja: ""',
    );
    const changed = await run(repoRoot, ["validate", "chapter_1", "--verbose"]);
    expect(changed.stderr.join("\n")).toContain(
      'L001 was translated from "相馬律: 不說謊。" but now reads "相馬律: 絕不說謊。"',
    );

    // Deleting the line keeps its translation as stale; its ID is not reused.
    writeFileSync(
      scenePath,
      readFileSync(scenePath, "utf-8")
        .replace("**相馬律**：絕不說謊。 {#L001}\n\n", "")
        .replace(
          "**相馬律**：真的。 {#L079}",
          "**相馬律**：真的。 {#L079}\n\n**相馬律**：好。",
        ),
    );
    const removed = await run(repoRoot, ["sync", "chapter_1"]);
    expect(removed.stdout.at(-1)).toMatch(/1 line IDs added, .* 1 stale/);
    expect(readFileSync(scenePath, "utf-8")).toContain(
      "**相馬律**：好。 {#L080}",
    );
    expect(readFileSync(scriptPath, "utf-8")).toContain(
      "stale:\n  - id: L001\n    speaker: 相馬律\n    zh: 不說謊。\n    ja: 嘘をつかない。",
    );
  });

  it("feeds synced translations and existing clips into the compiled locale manifest", async () => {
    const repoRoot = createRepoRoot();
    expect((await run(repoRoot, ["sync", "chapter_1"])).code).toBe(0);
    const scriptPath = join(repoRoot, SCRIPT);
    writeFileSync(
      scriptPath,
      readFileSync(scriptPath, "utf-8")
        .replace(
          '    zh: 不說謊。\n    ja: ""',
          "    zh: 不說謊。\n    ja: 嘘をつかない。\n    voice:\n      clip: ch1_soma_ritsu_0001",
        )
        .replace(
          '    zh: KAGAMI 門鎖時間線指向他。警察幾乎確定了。\n    ja: ""',
          "    zh: KAGAMI 門鎖時間線指向他。警察幾乎確定了。\n    ja: KAGAMIのドアロック記録は彼を指してる。\n    voice:\n      clip: ch1_hayasaka_akane_0001",
        ),
    );
    mkdirSync(join(repoRoot, "static/assets/voice/ja"), { recursive: true });
    writeFileSync(
      join(repoRoot, "static/assets/voice/ja/ch1_soma_ritsu_0001.ogg"),
      "",
    );

    const assetOutputRoot = join(repoRoot, "out/assets");
    const result = compile({
      sourceRoot: join(repoRoot, "docs/stories_plan"),
      outputRoot: join(repoRoot, "out/scenes"),
      assetConfigRoot: join(repoRoot, "static/assets/config"),
      assetOutputRoot,
      repoRoot,
    });
    if (!result.ok) throw new Error(formatErrors(result.errors));

    const manifest = JSON.parse(
      readFileSync(join(assetOutputRoot, "dialogue_locale.ja.json"), "utf-8"),
    );
    expect(manifest.chapters).toHaveLength(1);
    expect(manifest.chapters[0].lines).toEqual([
      {
        speaker: "相馬律",
        expression: null,
        zh: "不說謊。",
        text: "嘘をつかない。",
        voice: "voice.ja.ch1_soma_ritsu_0001",
      },
      {
        speaker: "早坂茜",
        expression: "concerned",
        zh: "KAGAMI 門鎖時間線指向他。警察幾乎確定了。",
        text: "KAGAMIのドアロック記録は彼を指してる。",
        voice: null,
      },
    ]);
    expect(result.localeWarnings.map((w) => w.code)).toEqual([
      "dialogueLocaleIncomplete",
      "voiceClipMissing",
    ]);
  });
});

const CAST_FILE = `schemaVersion: 1
locales:
  ja:
    model: eleven_v3
    languageTextNormalization: true
    cast:
      - characterId: soma_ritsu
        status: approved
        voiceId: somaVoice
        settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1.0 }
        seed: 1101
        expressionDirections: { standard: "[calm]" }
        auditionLines:
          - ja: 不思議だな。
          - expression: thinking
            ja: 嘘じゃない。
        candidates:
          - { name: Komi Calm, voiceId: candA }
          - { name: Yuta, voiceId: candB }
      - characterId: hayasaka_akane
        status: proposed
        voiceId: null
        settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1.0 }
        seed: 1102
        expressionDirections: { standard: "[matter-of-fact]" }
        auditionLines: []
        candidates: []
`;

type SpeakCall = { id: string; voiceId: string; body: { text: string } };

function fakeClient(calls: SpeakCall[], fail?: Error) {
  return {
    async speak(input: SpeakCall) {
      calls.push(input);
      if (fail) throw fail;
      return new TextEncoder().encode(`mp3:${input.body.text}`);
    },
  };
}

const fakeConvert = async (input: {
  inputPath: string;
  outputPath: string;
}) => {
  writeFileSync(
    input.outputPath,
    `ogg:${readFileSync(input.inputPath, "utf-8")}`,
  );
};

function castRepo(): string {
  const repoRoot = createRepoRoot();
  writeFileSync(
    join(repoRoot, "static/assets/config/voice_cast.yaml"),
    CAST_FILE,
  );
  return repoRoot;
}

async function translate(repoRoot: string): Promise<string> {
  expect((await run(repoRoot, ["sync", "chapter_1"])).code).toBe(0);
  const scriptPath = join(repoRoot, SCRIPT);
  writeFileSync(
    scriptPath,
    readFileSync(scriptPath, "utf-8")
      .replace(
        '    zh: 不說謊。\n    ja: ""',
        "    zh: 不說謊。\n    ja: 嘘をつかない。",
      )
      .replace(
        '    zh: KAGAMI 門鎖時間線指向他。警察幾乎確定了。\n    ja: ""',
        "    zh: KAGAMI 門鎖時間線指向他。警察幾乎確定了。\n    ja: KAGAMIは彼を指してる。",
      ),
  );
  return scriptPath;
}

describe("voice cli generation", () => {
  const options = (calls: SpeakCall[], fail?: Error) => ({
    client: fakeClient(calls, fail),
    convert: fakeConvert,
    now: () => new Date("2026-10-20T00:00:00.000Z"),
  });

  async function runWith(
    repoRoot: string,
    args: string[],
    extra: Partial<Parameters<typeof runVoiceCli>[1]>,
  ) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runVoiceCli(args, {
      repoRoot,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      ...extra,
    });
    return { code, stdout, stderr };
  }

  it("assigns clip IDs only to translated lines of approved roles", async () => {
    const repoRoot = castRepo();
    const scriptPath = await translate(repoRoot);
    const synced = await run(repoRoot, ["sync", "chapter_1"]);
    expect(synced.code).toBe(0);
    expect(synced.stdout.at(-1)).toMatch(/1 clip IDs assigned\.$/);
    const text = readFileSync(scriptPath, "utf-8");
    expect(text).toContain(
      "    zh: 不說謊。\n    ja: 嘘をつかない。\n    voice:\n      clip: ch1_soma_ritsu_0001",
    );
    expect(text.match(/clip:/g)).toHaveLength(1);
    expect((await run(repoRoot, ["sync", "chapter_1"])).stdout.at(-1)).toMatch(
      /0 clip IDs assigned\.$/,
    );
  });

  it("refuses to generate from scripts voice:sync would change", async () => {
    const repoRoot = castRepo();
    await translate(repoRoot);
    const calls: SpeakCall[] = [];
    const result = await runWith(
      repoRoot,
      ["generate", "chapter_1"],
      options(calls),
    );
    expect(result.code).toBe(2);
    expect(result.stderr.join("\n")).toContain("voiceScriptsOutOfDate");
    expect(calls).toHaveLength(0);
  });

  it("dry-runs, generates, skips current clips and regenerates edited ones", async () => {
    const repoRoot = castRepo();
    const scriptPath = await translate(repoRoot);
    expect((await run(repoRoot, ["sync", "chapter_1"])).code).toBe(0);
    const calls: SpeakCall[] = [];
    const clipPath = join(
      repoRoot,
      "static/assets/voice/ja/ch1_soma_ritsu_0001.ogg",
    );

    const dry = await runWith(
      repoRoot,
      ["generate", "chapter_1", "--dry-run"],
      {},
    );
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain(
      "[voice] would generate static/assets/voice/ja/ch1_soma_ritsu_0001.ogg: [calm] 嘘をつかない。",
    );
    expect(dry.stdout.join("\n")).toContain(
      "hayasaka_akane is not approved yet: 1 translated lines",
    );
    expect(dry.stdout.at(-1)).toBe(
      "[voice] chapter_1 ja: 1 clips, 14 characters (0 already current).",
    );

    const first = await runWith(
      repoRoot,
      ["generate", "chapter_1"],
      options(calls),
    );
    expect(first.code).toBe(0);
    expect(
      calls.map((call) => [call.id, call.voiceId, call.body.text]),
    ).toEqual([["ch1_soma_ritsu_0001", "somaVoice", "[calm] 嘘をつかない。"]]);
    expect(readFileSync(clipPath, "utf-8")).toBe(
      "ogg:mp3:[calm] 嘘をつかない。",
    );
    const recorded = readFileSync(scriptPath, "utf-8");
    expect(recorded).toMatch(
      /clip: ch1_soma_ritsu_0001\n {6}ttsHash: [0-9a-f]{12}\n {6}generatedAt: 2026-10-20T00:00:00.000Z/,
    );
    expect((await run(repoRoot, ["validate", "chapter_1"])).code).toBe(0);

    const again = await runWith(
      repoRoot,
      ["generate", "chapter_1"],
      options(calls),
    );
    expect(again.code).toBe(0);
    expect(again.stdout.at(-1)).toContain(
      "0 clips, 0 characters (1 already current)",
    );
    expect(calls).toHaveLength(1);

    writeFileSync(
      scriptPath,
      recorded.replace("ja: 嘘をつかない。", "ja: 嘘はつかない。"),
    );
    const edited = await runWith(
      repoRoot,
      ["generate", "chapter_1", "--only", "ch1_soma_ritsu_0001"],
      options(calls),
    );
    expect(edited.code).toBe(0);
    expect(calls.at(-1)?.body.text).toBe("[calm] 嘘はつかない。");

    const missing = await runWith(
      repoRoot,
      ["generate", "chapter_1", "--only", "ch1_nobody_0001"],
      options(calls),
    );
    expect(missing.code).toBe(2);
  });

  it("exits 3 on a billing failure and says not to retry with --force", async () => {
    const repoRoot = castRepo();
    await translate(repoRoot);
    expect((await run(repoRoot, ["sync", "chapter_1"])).code).toBe(0);
    const result = await runWith(
      repoRoot,
      ["generate", "chapter_1"],
      options(
        [],
        new PaymentRequiredError(
          "voice",
          "ch1_soma_ritsu_0001",
          402,
          "Payment Required",
        ),
      ),
    );
    expect(result.code).toBe(3);
    expect(result.stderr.join("\n")).toContain("Do not retry with --force");
    expect(
      existsSync(
        join(repoRoot, "static/assets/voice/ja/ch1_soma_ritsu_0001.ogg"),
      ),
    ).toBe(false);
  });

  it("records audition takes per candidate into the audition folder", async () => {
    const repoRoot = castRepo();
    const dry = await runWith(
      repoRoot,
      ["audition", "soma_ritsu", "--dry-run"],
      {},
    );
    expect(dry.code).toBe(0);
    expect(dry.stdout.at(-1)).toMatch(
      /^\[voice\] soma_ritsu: 4 takes, \d+ characters/,
    );

    const calls: SpeakCall[] = [];
    const result = await runWith(
      repoRoot,
      ["audition", "soma_ritsu", "--candidate", "candB"],
      options(calls),
    );
    expect(result.code).toBe(0);
    expect(calls.map((call) => [call.voiceId, call.body.text])).toEqual([
      ["candB", "[calm] 不思議だな。"],
      ["candB", "嘘じゃない。"],
    ]);
    expect(
      readFileSync(
        join(repoRoot, ".voice-auditions/soma_ritsu/yuta_candB_1.mp3"),
        "utf-8",
      ),
    ).toBe("mp3:[calm] 不思議だな。");

    const repeat = await runWith(
      repoRoot,
      ["audition", "soma_ritsu", "--candidate", "candB"],
      options(calls),
    );
    expect(repeat.stdout.at(-1)).toContain("0 takes recorded");
    expect((await runWith(repoRoot, ["audition", "nobody"], {})).code).toBe(2);
  });
});
