import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
});
