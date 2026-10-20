import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("writes skeletons once, then keeps translations when the scene changes", async () => {
    const repoRoot = createRepoRoot();
    const scriptPath = join(repoRoot, SCRIPT);

    const first = await run(repoRoot, ["sync", "chapter_1"]);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(`[voice] wrote ${SCRIPT}`);
    const skeleton = readFileSync(scriptPath, "utf-8");
    expect(skeleton).toContain(
      [
        "  - speaker: 早坂茜",
        "    expression: concerned",
        "    zh: KAGAMI 門鎖時間線指向他。警察幾乎確定了。",
        '    ja: ""',
      ].join("\n"),
    );

    const again = await run(repoRoot, ["sync", "chapter_1"]);
    expect(again.stdout.some((line) => line.startsWith("[voice] wrote"))).toBe(
      false,
    );

    const notStrict = await run(repoRoot, ["validate", "chapter_1"]);
    expect(notStrict.code).toBe(0);
    const strict = await run(repoRoot, ["validate", "chapter_1", "--strict"]);
    expect(strict.code).toBe(2);
    expect(strict.stderr.join("\n")).toContain("localeScriptUntranslated");

    writeFileSync(
      scriptPath,
      skeleton.replace(
        '    zh: 不說謊。\n    ja: ""',
        "    zh: 不說謊。\n    ja: 嘘をつかない。",
      ),
    );
    const scenePath = join(repoRoot, "docs/stories_plan/chapter_1/scene_0.md");
    writeFileSync(
      scenePath,
      readFileSync(scenePath, "utf-8").replace(
        "**相馬律**：不說謊。",
        "**相馬律**：絕不說謊。",
      ),
    );

    const resync = await run(repoRoot, ["sync", "chapter_1"]);
    expect(resync.code).toBe(0);
    expect(resync.stdout.at(-1)).toMatch(/1 added, .* 1 stale/);
    const updated = readFileSync(scriptPath, "utf-8");
    expect(updated).toContain('    zh: 絕不說謊。\n    ja: ""');
    expect(updated).toContain(
      "stale:\n  - speaker: 相馬律\n    zh: 不說謊。\n    ja: 嘘をつかない。",
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
