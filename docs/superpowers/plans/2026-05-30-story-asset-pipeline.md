# Story Asset Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved asset-aware story pipeline so Lyra can compile story asset intent into runtime asset IDs, generation manifests, and placeholder-backed UI rendering.

**Architecture:** Keep story source in Markdown, reusable asset catalogs in YAML, generated runtime data under `src-tauri/resources`, and loose v1 asset files under typed `static/assets/*` folders. The compiler parses asset intent, validates it when `assets.enabled` is true, emits logical asset IDs into scene JSON, and emits a generated asset manifest; Rust carries those IDs through state, and Svelte resolves them to `/assets/...` URLs or typed placeholders.

**Tech Stack:** Bun TypeScript compiler/tests, YAML via the `yaml` npm package, Rust serde/Tauri commands, Svelte 5 runes, Vitest component tests.

---

## File Structure

Create:

- `scripts/compile-scenes/assets/config.ts` — parse and validate `static/assets/config/*.yaml`.
- `scripts/compile-scenes/assets/config.test.ts` — unit tests for asset config loading and validation.
- `scripts/compile-scenes/assets/enrich.ts` — validate parsed scenes against asset config, attach logical asset IDs, and collect asset refs.
- `scripts/compile-scenes/assets/enrich.test.ts` — unit tests for speaker, expression, evidence, background, and audio validation.
- `scripts/compile-scenes/assets/manifest.ts` — build generated asset manifest/report data from enriched scenes and config.
- `scripts/compile-scenes/assets/manifest.test.ts` — manifest path and prompt-composition tests.
- `static/assets/config/policy.yaml` — production corpus feature switch, initially disabled.
- `static/assets/config/characters.yaml` — production starter character catalog, allowed to be empty while disabled.
- `static/assets/config/audio.yaml` — production starter audio catalog, allowed to be empty while disabled.
- `static/assets/backgrounds/.gitkeep`
- `static/assets/portraits/.gitkeep`
- `static/assets/evidence/.gitkeep`
- `static/assets/audio/.gitkeep`
- `src-tauri/resources/assets/.gitkeep`
- `src/lib/assets/story-assets.ts` — async asset resolver/cache and typed placeholder URLs.
- `src/lib/assets/story-assets.test.ts` — resolver path and placeholder tests.
- `scripts/__fixtures__/asset_enabled/stories_plan/chapter_1/*` — copied Chapter 1 fixture files with asset metadata added.
- `scripts/__fixtures__/asset_enabled/assets/config/policy.yaml`
- `scripts/__fixtures__/asset_enabled/assets/config/characters.yaml`
- `scripts/__fixtures__/asset_enabled/assets/config/audio.yaml`

Modify:

- `package.json` and `bun.lock` — add `yaml`.
- `scripts/compile-scenes.ts` — pass asset config/output roots and watch YAML config files.
- `scripts/compile-scenes/orchestrator.ts` — load asset config, enrich parsed scenes, emit asset manifest/report, and preserve generated-output cleanup boundaries.
- `scripts/compile-scenes/types.ts` — add asset cue, portrait, audio, image, and `assetRefs` fields.
- `scripts/compile-scenes/tokenizer.ts` — parse optional dialogue expression tags.
- `scripts/compile-scenes/parser-linear.ts` — allow asset metadata immediately after scene tags.
- `scripts/compile-scenes/parser-investigation.ts` — parse sub-location background/audio metadata.
- `scripts/compile-scenes/parser-interrogation.ts` — parse phase background/audio metadata.
- `scripts/compile-scenes/parser-manifest.ts` — parse evidence `Image Prompt`.
- `scripts/compile-scenes/emitter.ts` — emit enriched asset fields and `assetRefs`.
- `scripts/compile-scenes/*.test.ts` — add focused compiler/parser/emitter coverage.
- `src-tauri/tauri.conf.json` — include `resources/assets/**/*`.
- `src-tauri/src/game/schema.rs` — deserialize optional asset fields.
- `src-tauri/src/game/state.rs` — carry evidence image asset IDs into inventory.
- `src-tauri/src/game/view.rs` — expose background/audio IDs and portrait metadata.
- `src-tauri/src/game/mod.rs` — update last visual cue state while consuming scene tags, entering sub-locations, and entering interrogation phases.
- `src/lib/state/types.ts` — mirror Rust asset fields in frontend types.
- `src/lib/components/SceneBackdrop.svelte` — render resolved background images.
- `src/lib/components/DialogueBox.svelte` — render current-speaker portrait images.
- `src/lib/components/InventoryPanel.svelte` — render evidence icons.
- `.claude/skills/writing-detective-game-dialogue/SKILL.md`
- `.claude/skills/writing-investigation-scene/SKILL.md`
- `.claude/skills/writing-interrogation-scene/SKILL.md`
- `.claude/skills/writing-chapter-manifest/SKILL.md`

---

### Task 1: YAML Asset Config Loader

**Files:**
- Create: `scripts/compile-scenes/assets/config.ts`
- Create: `scripts/compile-scenes/assets/config.test.ts`
- Create: `static/assets/config/policy.yaml`
- Create: `static/assets/config/characters.yaml`
- Create: `static/assets/config/audio.yaml`
- Create: `static/assets/backgrounds/.gitkeep`
- Create: `static/assets/portraits/.gitkeep`
- Create: `static/assets/evidence/.gitkeep`
- Create: `static/assets/audio/.gitkeep`
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Add YAML dependency**

Run:

```bash
bun add yaml
```

Expected: `package.json` contains `"yaml"` in `dependencies` and `bun.lock` changes.

- [ ] **Step 2: Write failing config tests**

Create `scripts/compile-scenes/assets/config.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadAssetConfig } from "./config";

function withConfig(files: Record<string, string>, run: (root: string) => void) {
  const root = mkdtempSync(resolve(tmpdir(), "lyra-assets-config-"));
  try {
    mkdirSync(root, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(resolve(root, name), body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("loadAssetConfig", () => {
  it("loads a disabled policy without requiring populated catalogs", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(false);
      expect(result.value.characters.byId.size).toBe(0);
    });
  });

  it("loads enabled policy, characters, and audio IDs", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: true
globalStyle:
  prompt: noir rain visual novel
types:
  background:
    dimensions: [1920, 1080]
    format: png
    transparency: false
    prompt: wide background
  portrait:
    dimensions: [768, 1024]
    format: png
    transparency: true
    prompt: transparent portrait
  evidence:
    dimensions: [512, 512]
    format: png
    transparency: true
    prompt: evidence icon
  audio:
    format: ogg
    loop: true
`,
      "characters.yaml": `
characters:
  - id: hayasaka_akane
    displayNames: ["早坂茜"]
    portraitMode: portrait
    visualPrompt: attorney in dark suit
    expressions:
      standard:
        prompt: neutral
      concerned:
        prompt: worried
`,
      "audio.yaml": `
bgm:
  rain_mystery_low:
    prompt: soft tension
    loop: true
bgs:
  indoor_rain_window:
    prompt: rain against windows
    loop: true
`,
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(true);
      expect(result.value.characters.byDisplayName.get("早坂茜")?.id).toBe("hayasaka_akane");
      expect(result.value.audio.bgm.has("rain_mystery_low")).toBe(true);
      expect(result.value.audio.bgs.has("indoor_rain_window")).toBe(true);
    });
  });

  it("rejects enabled portrait characters without standard expression", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: true
globalStyle:
  prompt: style
types:
  background:
    dimensions: [1920, 1080]
    format: png
    transparency: false
    prompt: bg
  portrait:
    dimensions: [768, 1024]
    format: png
    transparency: true
    prompt: portrait
  evidence:
    dimensions: [512, 512]
    format: png
    transparency: true
    prompt: evidence
  audio:
    format: ogg
    loop: true
`,
      "characters.yaml": `
characters:
  - id: bad
    displayNames: ["壞例"]
    portraitMode: portrait
    visualPrompt: person
    expressions:
      angry:
        prompt: angry
`,
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetCharacterMissingStandardExpression")).toBe(true);
    });
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
bun test scripts/compile-scenes/assets/config.test.ts
```

Expected: FAIL because `scripts/compile-scenes/assets/config.ts` does not exist.

- [ ] **Step 4: Implement config loader**

Create `scripts/compile-scenes/assets/config.ts` with these exports and validation rules:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { CompileError } from "../types";

export type AssetTypeName = "background" | "portrait" | "evidence" | "audio";
export type ImageAssetTypeName = "background" | "portrait" | "evidence";
export type AudioChannel = "bgm" | "bgs";

export type AssetTypePolicy = {
  dimensions?: [number, number];
  format: string;
  transparency?: boolean;
  prompt: string;
  loop?: boolean;
};

export type CharacterExpressionConfig = {
  id: string;
  prompt: string;
};

export type CharacterConfig = {
  id: string;
  displayNames: string[];
  portraitMode: "portrait" | "none";
  visualPrompt: string | null;
  referenceAssetId: string | null;
  expressions: Map<string, CharacterExpressionConfig>;
};

export type AudioConfigEntry = {
  id: string;
  prompt: string;
  loop: boolean;
};

export type AssetConfig = {
  enabled: boolean;
  globalStylePrompt: string;
  types: Record<AssetTypeName, AssetTypePolicy>;
  characters: {
    byId: Map<string, CharacterConfig>;
    byDisplayName: Map<string, CharacterConfig>;
  };
  audio: {
    bgm: Map<string, AudioConfigEntry>;
    bgs: Map<string, AudioConfigEntry>;
  };
};

export type AssetConfigResult =
  | { ok: true; value: AssetConfig; warnings: CompileError[] }
  | { ok: false; errors: CompileError[] };

const EMPTY_POLICY: AssetConfig = {
  enabled: false,
  globalStylePrompt: "",
  types: {
    background: { dimensions: [1920, 1080], format: "png", transparency: false, prompt: "" },
    portrait: { dimensions: [768, 1024], format: "png", transparency: true, prompt: "" },
    evidence: { dimensions: [512, 512], format: "png", transparency: true, prompt: "" },
    audio: { format: "ogg", loop: true, prompt: "" },
  },
  characters: { byId: new Map(), byDisplayName: new Map() },
  audio: { bgm: new Map(), bgs: new Map() },
};

export function loadAssetConfig(configRoot: string): AssetConfigResult {
  const policyPath = resolve(configRoot, "policy.yaml");
  if (!existsSync(policyPath)) {
    return { ok: true, value: EMPTY_POLICY, warnings: [] };
  }

  const errors: CompileError[] = [];
  const policy = readYaml(policyPath, errors);
  const charactersYaml = readOptionalYaml(resolve(configRoot, "characters.yaml"), errors) ?? { characters: [] };
  const audioYaml = readOptionalYaml(resolve(configRoot, "audio.yaml"), errors) ?? { bgm: {}, bgs: {} };
  if (errors.length > 0) return { ok: false, errors };

  const enabled = policy?.assets?.enabled === true;
  const globalStylePrompt = text(policy?.globalStyle?.prompt);
  const types = buildTypePolicies(policy?.types, enabled, errors);
  const characters = buildCharacters(charactersYaml?.characters ?? [], enabled, errors);
  const audio = buildAudio(audioYaml, errors);

  if (enabled && !globalStylePrompt) {
    errors.push(error(policyPath, "assetPolicyMissingGlobalStyle", "assets.enabled is true but globalStyle.prompt is empty."));
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { enabled, globalStylePrompt, types, characters, audio },
    warnings: [],
  };
}

function buildTypePolicies(raw: unknown, enabled: boolean, errors: CompileError[]): Record<AssetTypeName, AssetTypePolicy> {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const out = { ...EMPTY_POLICY.types };
  for (const key of ["background", "portrait", "evidence", "audio"] as const) {
    const value = src[key] as Record<string, unknown> | undefined;
    if (!value) continue;
    out[key] = {
      dimensions: tuple(value.dimensions) ?? out[key].dimensions,
      format: text(value.format) || out[key].format,
      transparency: typeof value.transparency === "boolean" ? value.transparency : out[key].transparency,
      prompt: text(value.prompt),
      loop: typeof value.loop === "boolean" ? value.loop : out[key].loop,
    };
  }
  if (enabled) {
    for (const key of ["background", "portrait", "evidence"] as const) {
      if (!out[key].prompt) errors.push(error("policy.yaml", "assetPolicyMissingTypePrompt", `types.${key}.prompt is required when assets are enabled.`));
    }
  }
  return out;
}

function buildCharacters(raw: unknown[], enabled: boolean, errors: CompileError[]) {
  const byId = new Map<string, CharacterConfig>();
  const byDisplayName = new Map<string, CharacterConfig>();
  for (const item of raw) {
    const c = item as Record<string, unknown>;
    const id = text(c.id);
    const displayNames = Array.isArray(c.displayNames) ? c.displayNames.map(text).filter(Boolean) : [];
    const portraitMode = c.portraitMode === "none" ? "none" : "portrait";
    const expressions = new Map<string, CharacterExpressionConfig>();
    const rawExpressions = c.expressions && typeof c.expressions === "object" ? c.expressions as Record<string, unknown> : {};
    for (const [exprId, exprRaw] of Object.entries(rawExpressions)) {
      const prompt = text((exprRaw as Record<string, unknown>).prompt);
      expressions.set(exprId, { id: exprId, prompt });
    }
    const config: CharacterConfig = {
      id,
      displayNames,
      portraitMode,
      visualPrompt: text(c.visualPrompt) || null,
      referenceAssetId: text(c.referenceAssetId) || null,
      expressions,
    };
    if (!id) errors.push(error("characters.yaml", "assetCharacterMissingId", "Each character requires id."));
    if (displayNames.length === 0) errors.push(error("characters.yaml", "assetCharacterMissingDisplayNames", `Character ${id || "(missing id)"} requires displayNames.`));
    if (portraitMode === "portrait" && !expressions.has("standard")) {
      errors.push(error("characters.yaml", "assetCharacterMissingStandardExpression", `Character ${id} requires expressions.standard.`));
    }
    byId.set(id, config);
    for (const name of displayNames) {
      if (byDisplayName.has(name)) errors.push(error("characters.yaml", "assetCharacterAmbiguousDisplayName", `Display name ${name} maps to multiple characters.`));
      byDisplayName.set(name, config);
    }
  }
  if (enabled && raw.length === 0) {
    errors.push(error("characters.yaml", "assetCharactersMissing", "assets.enabled is true but characters.yaml has no characters."));
  }
  return { byId, byDisplayName };
}

function buildAudio(raw: Record<string, unknown>, errors: CompileError[]) {
  return {
    bgm: buildAudioMap(raw.bgm, "bgm", errors),
    bgs: buildAudioMap(raw.bgs, "bgs", errors),
  };
}

function buildAudioMap(raw: unknown, channel: AudioChannel, errors: CompileError[]) {
  const out = new Map<string, AudioConfigEntry>();
  const entries = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  for (const [id, value] of Object.entries(entries)) {
    if (!/^[a-z0-9_]+$/.test(id)) errors.push(error("audio.yaml", "assetAudioIdMalformed", `${channel}.${id} must be a snake_case slug.`));
    const record = value as Record<string, unknown>;
    out.set(id, { id, prompt: text(record.prompt), loop: record.loop !== false });
  }
  return out;
}

function readYaml(path: string, errors: CompileError[]) {
  try {
    return parse(readFileSync(path, "utf-8"));
  } catch (e) {
    errors.push(error(path, "assetConfigUnreadable", `${path}: ${(e as Error).message}`));
    return null;
  }
}

function readOptionalYaml(path: string, errors: CompileError[]) {
  if (!existsSync(path)) return null;
  return readYaml(path, errors);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function tuple(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const a = Number(value[0]);
  const b = Number(value[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return [a, b];
}

function error(sourceFile: string, code: string, message: string): CompileError {
  return { sourceFile, line: 1, code, message };
}
```

- [ ] **Step 5: Add production disabled starter config**

Create `static/assets/config/policy.yaml`:

```yaml
assets:
  enabled: false
```

Create `static/assets/config/characters.yaml`:

```yaml
characters: []
```

Create `static/assets/config/audio.yaml`:

```yaml
bgm: {}
bgs: {}
```

Create `.gitkeep` files in:

```text
static/assets/backgrounds/.gitkeep
static/assets/portraits/.gitkeep
static/assets/evidence/.gitkeep
static/assets/audio/.gitkeep
```

- [ ] **Step 6: Run config tests**

Run:

```bash
bun test scripts/compile-scenes/assets/config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock scripts/compile-scenes/assets/config.ts scripts/compile-scenes/assets/config.test.ts static/assets/config static/assets/backgrounds/.gitkeep static/assets/portraits/.gitkeep static/assets/evidence/.gitkeep static/assets/audio/.gitkeep
git commit -m "feat: add story asset config loader"
```

---

### Task 2: Asset-Aware Compiler Types And Tokenizer

**Files:**
- Modify: `scripts/compile-scenes/types.ts`
- Modify: `scripts/compile-scenes/tokenizer.ts`
- Modify: `scripts/compile-scenes/tokenizer.test.ts`
- Modify: `scripts/compile-scenes/parser-linear.test.ts`

- [ ] **Step 1: Add failing tokenizer tests for expression tags**

Append to `scripts/compile-scenes/tokenizer.test.ts`:

```ts
it("parses optional dialogue expression tags", () => {
  expect(tokenize("**早坂茜**[concerned]：你不舒服？", "test.md")).toEqual([
    {
      kind: "dialogue",
      speaker: "早坂茜",
      expression: "concerned",
      text: "你不舒服？",
      sourceFile: "test.md",
      line: 1,
    },
  ]);
});

it("rejects malformed expression brackets as unknown", () => {
  expect(tokenize("**早坂茜**[擔心]：你不舒服？", "test.md")[0]?.kind).toBe("unknown");
});
```

- [ ] **Step 2: Run tokenizer tests and verify failure**

Run:

```bash
bun test scripts/compile-scenes/tokenizer.test.ts
```

Expected: FAIL because dialogue tokens do not include `expression`.

- [ ] **Step 3: Extend shared asset types**

In `scripts/compile-scenes/types.ts`, add:

```ts
export type AssetRef = {
  type: "background" | "portrait" | "evidence" | "audio";
  assetId: string;
};

export type PortraitRef = {
  characterId: string;
  expression: string;
  assetId: string;
};

export type AudioCue = {
  channel: "bgm" | "bgs";
  assetId: string | null;
};

export type VisualAssetCue = {
  backgroundPrompt: string | null;
  backgroundAssetId: string | null;
  bgm: AudioCue | null;
  bgs: AudioCue | null;
};

export type EvidenceImageCue = {
  imagePrompt: string | null;
  imageAssetId: string | null;
};
```

Then update `DialogueItem`:

```ts
export type DialogueItem =
  | {
      kind: "sceneTag";
      text: string;
      assetCue?: VisualAssetCue | null;
    }
  | { kind: "action"; text: string }
  | {
      kind: "line";
      speaker: string;
      text: string;
      expression?: string | null;
      portrait?: PortraitRef | null;
    };
```

Add `assetCue: VisualAssetCue | null` to `ASTSublocation`, `ASTInquiryPhase`, and `ASTTestimonyPhase`. Add `imageCue: EvidenceImageCue` to `ASTEvidence`. Add `assetRefs: AssetRef[]` to `ASTLinearScene`, `ASTInvestigationScene`, `ASTInterrogationScene`, `JSONLinearScene`, `JSONInvestigationScene`, and `JSONInterrogationScene`.

- [ ] **Step 4: Update tokenizer dialogue regex**

In `scripts/compile-scenes/tokenizer.ts`, change the dialogue token type to include `expression: string | null`, then replace `DIALOGUE_RE` with:

```ts
const DIALOGUE_RE = /^\*\*([^*]+)\*\*(?:\[([a-z][a-z0-9_]*)\])?：(.+?)\s*$/;
```

Update the dialogue token push:

```ts
tokens.push({
  kind: "dialogue",
  speaker: dialogue[1] ?? "",
  expression: dialogue[2] ?? null,
  text: dialogue[3] ?? "",
  sourceFile,
  line,
});
```

- [ ] **Step 5: Preserve expression in parser line items**

Update every `consumeDialogueUntilHeading` implementation and `parseLinearScene` so dialogue output includes:

```ts
{
  kind: "line",
  speaker: next.speaker,
  text: next.text,
  expression: next.expression,
  portrait: null,
}
```

Existing tests expecting line items without `expression` should be updated to include `expression: null` and `portrait: null`.

- [ ] **Step 6: Run focused compiler tests**

Run:

```bash
bun test scripts/compile-scenes/tokenizer.test.ts scripts/compile-scenes/parser-linear.test.ts scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/parser-interrogation.test.ts
```

Expected: PASS after expected fixtures are updated for `expression: null` and `portrait: null`.

- [ ] **Step 7: Commit**

```bash
git add scripts/compile-scenes/types.ts scripts/compile-scenes/tokenizer.ts scripts/compile-scenes/tokenizer.test.ts scripts/compile-scenes/parser-linear.test.ts scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/parser-interrogation.test.ts scripts/compile-scenes/parser-manifest.ts
git commit -m "feat: parse story portrait expression tags"
```

---

### Task 3: Parse Visual And Evidence Asset Intent

**Files:**
- Modify: `scripts/compile-scenes/parser-linear.ts`
- Modify: `scripts/compile-scenes/parser-investigation.ts`
- Modify: `scripts/compile-scenes/parser-interrogation.ts`
- Modify: `scripts/compile-scenes/parser-manifest.ts`
- Modify: `scripts/compile-scenes/parser-linear.test.ts`
- Modify: `scripts/compile-scenes/parser-investigation.test.ts`
- Modify: `scripts/compile-scenes/parser-interrogation.test.ts`

- [ ] **Step 1: Add failing parser tests for asset metadata**

Add to `scripts/compile-scenes/parser-linear.test.ts`:

```ts
it("attaches asset metadata to the preceding scene tag", () => {
  const source = `
# Scene 0: 接案

[場景：咖啡館外，雨夜。]
- **Background Prompt:** Rainy exterior of a small Tokyo cafe at midnight.
- **BGM:** rain_mystery_low
- **BGS:** street_rain

**早坂茜**：你來得比我想的快。
`.trim();
  const result = parseLinearScene(source, "scene_0.md", "scene_0");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.queue[0]).toEqual({
    kind: "sceneTag",
    text: "咖啡館外，雨夜。",
    assetCue: {
      backgroundPrompt: "Rainy exterior of a small Tokyo cafe at midnight.",
      backgroundAssetId: null,
      bgm: { channel: "bgm", assetId: "rain_mystery_low" },
      bgs: { channel: "bgs", assetId: "street_rain" },
    },
  });
});
```

Add to `scripts/compile-scenes/parser-investigation.test.ts`:

```ts
it("parses sub-location background and audio metadata", () => {
  const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked
- **Background Prompt:** Dim detective office with rain outside.
- **BGM:** none
- **BGS:** indoor_rain_window

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Evidence Manifest

### evidence:foo {#foo}
- **Name:** Foo
- **Description:** A foo.
- **Details:** Detail.
- **Image Prompt:** Small brass key on transparent background.

#### On Collect

**A**：collected.

## Outro

**A**：done.
`.trim();
  const result = parseInvestigationScene(source, "i.md", "i");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sublocations[0]?.assetCue).toMatchObject({
    backgroundPrompt: "Dim detective office with rain outside.",
    bgm: { channel: "bgm", assetId: null },
    bgs: { channel: "bgs", assetId: "indoor_rain_window" },
  });
  expect(result.value.evidenceManifest[0]?.imageCue.imagePrompt).toBe("Small brass key on transparent background.");
});
```

Add to `scripts/compile-scenes/parser-interrogation.test.ts`:

```ts
it("parses phase background and audio metadata", () => {
  const parsed = parseInterrogationScene(
    VALID_SOURCE.replace(
      "- **Required:** true\n\n[場景：警視廳臨時詢問室",
      "- **Required:** true\n- **Background Prompt:** Harsh police interview room at night.\n- **BGM:** rain_mystery_low\n- **BGS:** none\n\n[場景：警視廳臨時詢問室",
    ),
    "chapter_1/interrogation_scene_2.md",
    "interrogation_scene_2",
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.phases[0]?.assetCue).toMatchObject({
    backgroundPrompt: "Harsh police interview room at night.",
    bgm: { channel: "bgm", assetId: "rain_mystery_low" },
    bgs: { channel: "bgs", assetId: null },
  });
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```bash
bun test scripts/compile-scenes/parser-linear.test.ts scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/parser-interrogation.test.ts
```

Expected: FAIL because parsers do not retain asset metadata.

- [ ] **Step 3: Add shared metadata helpers**

Create helper functions in `scripts/compile-scenes/parser-manifest.ts` or a new `scripts/compile-scenes/parser-assets.ts`:

```ts
import type { AudioCue, CompileError, VisualAssetCue } from "./types";

export function parseVisualAssetCue(meta: Record<string, string>): VisualAssetCue {
  return {
    backgroundPrompt: meta["Background Prompt"] ?? null,
    backgroundAssetId: null,
    bgm: parseAudioCue("bgm", meta.BGM),
    bgs: parseAudioCue("bgs", meta.BGS),
  };
}

export function parseAudioCue(channel: "bgm" | "bgs", raw: string | undefined): AudioCue | null {
  if (raw === undefined) return null;
  if (raw === "none") return { channel, assetId: null };
  return { channel, assetId: raw };
}

export function metadataWithoutAssetKeys(meta: Record<string, string>): Record<string, string> {
  const copy = { ...meta };
  delete copy["Background Prompt"];
  delete copy.BGM;
  delete copy.BGS;
  delete copy["Image Prompt"];
  return copy;
}

export function rejectUnknownAssetMetadata(
  meta: Record<string, string>,
  allowed: string[],
  sourceFile: string,
  line: number,
): CompileError | null {
  for (const key of Object.keys(meta)) {
    if (!allowed.includes(key)) {
      return { sourceFile, line, code: "assetMetadataUnknownKey", message: `Unknown asset metadata key: ${key}` };
    }
  }
  return null;
}
```

- [ ] **Step 4: Update linear parser scene-tag metadata**

In `parseLinearScene`, when encountering `sceneTag`, consume following metadata tokens only if they are immediately next and limited to `Background Prompt`, `BGM`, and `BGS`. Push one sceneTag item with `assetCue`.

Use this logic:

```ts
case "sceneTag": {
  const meta: Record<string, string> = {};
  while (tokens[i + 1]?.kind === "metadata") {
    const next = tokens[++i]!;
    if (next.kind === "metadata") meta[next.key] = next.value;
  }
  const bad = rejectUnknownAssetMetadata(meta, ["Background Prompt", "BGM", "BGS"], sourceFile, tok.line);
  if (bad) return { ok: false, error: bad };
  queue.push({ kind: "sceneTag", text: tok.text, assetCue: parseVisualAssetCue(meta) });
  break;
}
```

- [ ] **Step 5: Update investigation and interrogation parser blocks**

For sub-locations, parse `assetCue = parseVisualAssetCue(meta.value)` after status/unlock/reveals extraction.

For interrogation phases, parse the same cue inside `parseCommonPhaseMeta`, return it, and assign it to both inquiry and testimony phases.

For evidence entries, set:

```ts
imageCue: {
  imagePrompt: meta.value["Image Prompt"] ?? null,
  imageAssetId: null,
}
```

Do not require these prompts in parsers. Strictness belongs to the asset enrichment step.

- [ ] **Step 6: Run parser tests**

Run:

```bash
bun test scripts/compile-scenes/parser-linear.test.ts scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/parser-interrogation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/compile-scenes/parser-linear.ts scripts/compile-scenes/parser-investigation.ts scripts/compile-scenes/parser-interrogation.ts scripts/compile-scenes/parser-manifest.ts scripts/compile-scenes/parser-assets.ts scripts/compile-scenes/parser-linear.test.ts scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/parser-interrogation.test.ts
git commit -m "feat: parse story asset intent metadata"
```

---

### Task 4: Asset Enrichment, Manifest, And Asset-Enabled Fixture

**Files:**
- Create: `scripts/compile-scenes/assets/enrich.ts`
- Create: `scripts/compile-scenes/assets/enrich.test.ts`
- Create: `scripts/compile-scenes/assets/manifest.ts`
- Create: `scripts/compile-scenes/assets/manifest.test.ts`
- Create: `scripts/__fixtures__/asset_enabled/stories_plan/chapter_1/chapter.md`
- Create: `scripts/__fixtures__/asset_enabled/stories_plan/chapter_1/scene_0.md`
- Create: `scripts/__fixtures__/asset_enabled/stories_plan/chapter_1/investigation_scene_1.md`
- Create: `scripts/__fixtures__/asset_enabled/stories_plan/chapter_1/interrogation_scene_2.md`
- Create: `scripts/__fixtures__/asset_enabled/assets/config/policy.yaml`
- Create: `scripts/__fixtures__/asset_enabled/assets/config/characters.yaml`
- Create: `scripts/__fixtures__/asset_enabled/assets/config/audio.yaml`
- Modify: `scripts/compile-scenes/types.ts`
- Modify: `scripts/compile-scenes/emitter.ts`
- Modify: `scripts/compile-scenes/emitter.test.ts`

- [ ] **Step 1: Add failing enrichment tests**

Create `scripts/compile-scenes/assets/enrich.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { enrichScenesWithAssets } from "./enrich";
import type { AssetConfig } from "./config";
import type { SceneRecord } from "../validator";

function config(): AssetConfig {
  const character = {
    id: "hayasaka_akane",
    displayNames: ["早坂茜"],
    portraitMode: "portrait" as const,
    visualPrompt: "attorney",
    referenceAssetId: null,
    expressions: new Map([
      ["standard", { id: "standard", prompt: "neutral" }],
      ["concerned", { id: "concerned", prompt: "worried" }],
    ]),
  };
  return {
    enabled: true,
    globalStylePrompt: "noir style",
    types: {
      background: { dimensions: [1920, 1080], format: "png", transparency: false, prompt: "wide bg" },
      portrait: { dimensions: [768, 1024], format: "png", transparency: true, prompt: "portrait" },
      evidence: { dimensions: [512, 512], format: "png", transparency: true, prompt: "evidence" },
      audio: { format: "ogg", loop: true, prompt: "" },
    },
    characters: {
      byId: new Map([[character.id, character]]),
      byDisplayName: new Map([["早坂茜", character]]),
    },
    audio: {
      bgm: new Map([["rain_mystery_low", { id: "rain_mystery_low", prompt: "music", loop: true }]]),
      bgs: new Map([["street_rain", { id: "street_rain", prompt: "rain", loop: true }]]),
    },
  };
}

describe("enrichScenesWithAssets", () => {
  it("adds background, portrait, evidence, audio refs, and manifest requests", () => {
    const scenes: SceneRecord[] = [{
      chapterId: "chapter_1",
      file: "scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "接案",
        queue: [
          {
            kind: "sceneTag",
            text: "咖啡館外",
            assetCue: {
              backgroundPrompt: "Rainy Tokyo cafe exterior.",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: "rain_mystery_low" },
              bgs: { channel: "bgs", assetId: "street_rain" },
            },
          },
          { kind: "line", speaker: "早坂茜", expression: "concerned", portrait: null, text: "你不舒服？" },
        ],
        assetRefs: [],
        sourceFile: "chapter_1/scene_0.md",
        line: 1,
      },
    }];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);
    expect(result.scenes[0]?.ast.assetRefs).toContainEqual({
      type: "background",
      assetId: "background.chapter_1.scene_0.tag_001",
    });
    expect(result.scenes[0]?.ast.assetRefs).toContainEqual({
      type: "portrait",
      assetId: "portrait.hayasaka_akane.concerned",
    });
    expect(result.manifest.entries.map((e) => e.assetId)).toContain("background.chapter_1.scene_0.tag_001");
    expect(result.manifest.entries.map((e) => e.assetId)).toContain("portrait.hayasaka_akane.concerned");
  });

  it("errors for unknown speakers when assets are enabled", () => {
    const scenes: SceneRecord[] = [{
      chapterId: "chapter_1",
      file: "scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "接案",
        queue: [{ kind: "line", speaker: "不存在", expression: null, portrait: null, text: "hi" }],
        assetRefs: [],
        sourceFile: "chapter_1/scene_0.md",
        line: 1,
      },
    }];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.some((e) => e.code === "assetUnknownSpeaker")).toBe(true);
  });
});
```

- [ ] **Step 2: Run enrichment tests and verify failure**

Run:

```bash
bun test scripts/compile-scenes/assets/enrich.test.ts
```

Expected: FAIL because `enrich.ts` does not exist.

- [ ] **Step 3: Implement enrichment core**

Create `scripts/compile-scenes/assets/enrich.ts` with:

```ts
import type { AssetConfig } from "./config";
import { buildAssetManifest, type AssetManifest } from "./manifest";
import type { AssetRef, CompileError, DialogueItem } from "../types";
import type { SceneRecord } from "../validator";

export type AssetEnrichmentResult = {
  scenes: SceneRecord[];
  manifest: AssetManifest;
  warnings: CompileError[];
  errors: CompileError[];
};

export function enrichScenesWithAssets(input: {
  scenes: SceneRecord[];
  config: AssetConfig;
}): AssetEnrichmentResult {
  if (!input.config.enabled) {
    return {
      scenes: input.scenes.map((rec) => ({ ...rec, ast: { ...rec.ast, assetRefs: [] } })),
      manifest: buildAssetManifest({ entries: [], config: input.config }),
      warnings: [],
      errors: [],
    };
  }

  const errors: CompileError[] = [];
  const warnings: CompileError[] = [];
  const requests = new Map<string, AssetRequestDraft>();
  const scenes = input.scenes.map((rec) => enrichScene(rec, input.config, requests, errors));
  return {
    scenes,
    manifest: buildAssetManifest({ entries: [...requests.values()], config: input.config }),
    warnings,
    errors,
  };
}

type AssetRequestDraft = {
  assetId: string;
  type: "background" | "portrait" | "evidence" | "audio";
  source: Record<string, string>;
  prompt: string;
};

function enrichScene(
  rec: SceneRecord,
  config: AssetConfig,
  requests: Map<string, AssetRequestDraft>,
  errors: CompileError[],
): SceneRecord {
  const assetRefs: AssetRef[] = [];
  let linearTagIndex = 0;
  const addRef = (ref: AssetRef) => {
    if (!assetRefs.some((existing) => existing.type === ref.type && existing.assetId === ref.assetId)) assetRefs.push(ref);
  };

  const enrichQueue = (queue: DialogueItem[]) => queue.map((item) => {
    if (item.kind === "sceneTag") {
      linearTagIndex += 1;
      const assetId = `background.${rec.chapterId}.${rec.ast.id}.tag_${String(linearTagIndex).padStart(3, "0")}`;
      enrichVisualCue(item.assetCue ?? null, assetId, config, requests, errors, rec.ast.sourceFile, rec.ast.line);
      if (item.assetCue?.backgroundAssetId) addRef({ type: "background", assetId: item.assetCue.backgroundAssetId });
      return item;
    }
    if (item.kind === "line") return enrichLine(item, config, requests, errors, rec.ast.sourceFile, rec.ast.line, addRef);
    return item;
  });

  if (rec.ast.kind === "linearScene") {
    const ast = { ...rec.ast, queue: enrichQueue(rec.ast.queue), assetRefs };
    return { ...rec, ast };
  }
  if (rec.ast.kind === "investigationScene") {
    const sublocations = rec.ast.sublocations.map((sub) => {
      const bgId = `background.${rec.chapterId}.${rec.ast.id}.sublocation.${sub.id}`;
      enrichVisualCue(sub.assetCue, bgId, config, requests, errors, sub.sourceFile, sub.line);
      if (sub.assetCue?.backgroundAssetId) addRef({ type: "background", assetId: sub.assetCue.backgroundAssetId });
      return {
        ...sub,
        transitionDialogue: enrichQueue(sub.transitionDialogue),
        hotspots: sub.hotspots.map((h) => ({ ...h, inspectDialogue: enrichQueue(h.inspectDialogue), onReexamine: h.onReexamine ? enrichQueue(h.onReexamine) : null })),
        characters: sub.characters.map((c) => ({ ...c, topics: c.topics.map((t) => ({ ...t, topicDialogue: enrichQueue(t.topicDialogue), onReexamine: t.onReexamine ? enrichQueue(t.onReexamine) : null })) })),
      };
    });
    const evidenceManifest = rec.ast.evidenceManifest.map((e) => enrichEvidence(e, config, requests, errors, addRef));
    return { ...rec, ast: { ...rec.ast, intro: enrichQueue(rec.ast.intro), sublocations, evidenceManifest, outro: { ...rec.ast.outro, dialogue: enrichQueue(rec.ast.outro.dialogue) }, assetRefs } };
  }
  const phases = rec.ast.phases.map((phase) => {
    const bgId = `background.${rec.chapterId}.${rec.ast.id}.phase.${phase.id}`;
    enrichVisualCue(phase.assetCue, bgId, config, requests, errors, phase.sourceFile, phase.line);
    if (phase.assetCue?.backgroundAssetId) addRef({ type: "background", assetId: phase.assetCue.backgroundAssetId });
    if (phase.kind === "inquiry") {
      return { ...phase, entryDialogue: enrichQueue(phase.entryDialogue), questions: phase.questions.map((q) => ({ ...q, answerDialogue: enrichQueue(q.answerDialogue), onReask: q.onReask ? enrichQueue(q.onReask) : null })) };
    }
    return {
      ...phase,
      entryDialogue: enrichQueue(phase.entryDialogue),
      statements: phase.statements.map((s) => ({ ...s, onPress: s.onPress ? enrichQueue(s.onPress) : null, onPresent: s.onPresent ? enrichQueue(s.onPresent) : null, onWrongPresent: s.onWrongPresent ? enrichQueue(s.onWrongPresent) : null })),
      results: phase.results.map((r) => ({ ...r, dialogue: enrichQueue(r.dialogue) })),
    };
  });
  const evidenceManifest = rec.ast.evidenceManifest.map((e) => enrichEvidence(e, config, requests, errors, addRef));
  return { ...rec, ast: { ...rec.ast, intro: enrichQueue(rec.ast.intro), phases, evidenceManifest, outro: { ...rec.ast.outro, dialogue: enrichQueue(rec.ast.outro.dialogue) }, assetRefs } };
}
```

Complete the helper functions in the same file:

- `enrichLine` maps speaker and expression to `portrait`.
- `enrichVisualCue` requires `backgroundPrompt`, validates audio IDs, and sets `backgroundAssetId`.
- `enrichEvidence` requires `imageCue.imagePrompt`, sets `imageAssetId = evidence.${id}`, and requests the manifest entry.
- `putRequest` dedupes request drafts by `assetId`.
- `compileError` returns `{ sourceFile, line, code, message }`.

- [ ] **Step 4: Implement manifest builder**

Create `scripts/compile-scenes/assets/manifest.ts`:

```ts
import type { AssetConfig } from "./config";

export type AssetManifestEntry = {
  assetId: string;
  type: "background" | "portrait" | "evidence" | "audio";
  source: Record<string, string>;
  expectedPath: string;
  publicPath: string;
  policy: string;
  promptParts: {
    globalStyle: string;
    typePrompt: string;
    subjectPrompt: string;
    entryPrompt: string;
  };
  finalPrompt: string;
};

export type AssetManifest = {
  enabled: boolean;
  entries: AssetManifestEntry[];
};

export function buildAssetManifest(input: {
  entries: Array<{ assetId: string; type: AssetManifestEntry["type"]; source: Record<string, string>; prompt: string; subjectPrompt?: string }>;
  config: AssetConfig;
}): AssetManifest {
  return {
    enabled: input.config.enabled,
    entries: input.entries.map((entry) => {
      const policy = entry.type === "audio" ? input.config.types.audio : input.config.types[entry.type];
      const promptParts = {
        globalStyle: input.config.globalStylePrompt,
        typePrompt: policy.prompt,
        subjectPrompt: entry.subjectPrompt ?? "",
        entryPrompt: entry.prompt,
      };
      return {
        assetId: entry.assetId,
        type: entry.type,
        source: entry.source,
        expectedPath: expectedPath(entry.assetId, entry.type),
        publicPath: publicPath(entry.assetId, entry.type),
        policy: entry.type,
        promptParts,
        finalPrompt: Object.values(promptParts).filter(Boolean).join("\n\n"),
      };
    }),
  };
}

export function expectedPath(assetId: string, type: AssetManifestEntry["type"]): string {
  return `static${publicPath(assetId, type)}`;
}

export function publicPath(assetId: string, type: AssetManifestEntry["type"]): string {
  if (type === "portrait") {
    const [, characterId, expression] = assetId.split(".");
    return `/assets/portraits/${characterId}/${expression}.png`;
  }
  if (type === "evidence") {
    return `/assets/evidence/${assetId.replace(/^evidence\./, "")}.png`;
  }
  if (type === "audio") {
    const [, channel, id] = assetId.split(".");
    return `/assets/audio/${channel}/${id}.ogg`;
  }
  return `/assets/backgrounds/${assetId.replace(/^background\./, "").replaceAll(".", "/")}.png`;
}
```

- [ ] **Step 5: Add manifest tests**

Create `scripts/compile-scenes/assets/manifest.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { expectedPath, publicPath } from "./manifest";

describe("story asset manifest paths", () => {
  it("maps portrait asset IDs to typed static asset paths", () => {
    expect(publicPath("portrait.hayasaka_akane.concerned", "portrait")).toBe("/assets/portraits/hayasaka_akane/concerned.png");
    expect(expectedPath("portrait.hayasaka_akane.concerned", "portrait")).toBe("static/assets/portraits/hayasaka_akane/concerned.png");
  });

  it("maps background asset IDs to nested background paths", () => {
    expect(publicPath("background.chapter_1.scene_0.tag_001", "background")).toBe("/assets/backgrounds/chapter_1/scene_0/tag_001.png");
  });

  it("maps audio asset IDs by channel", () => {
    expect(publicPath("audio.bgm.rain_mystery_low", "audio")).toBe("/assets/audio/bgm/rain_mystery_low.ogg");
  });
});
```

- [ ] **Step 6: Copy current Chapter 1 into asset-enabled fixture**

Run:

```bash
mkdir -p scripts/__fixtures__/asset_enabled/stories_plan/chapter_1 scripts/__fixtures__/asset_enabled/assets/config
cp static/stories_plan/chapter_1/chapter.md scripts/__fixtures__/asset_enabled/stories_plan/chapter_1/chapter.md
cp static/stories_plan/chapter_1/scene_0.md scripts/__fixtures__/asset_enabled/stories_plan/chapter_1/scene_0.md
cp static/stories_plan/chapter_1/investigation_scene_1.md scripts/__fixtures__/asset_enabled/stories_plan/chapter_1/investigation_scene_1.md
cp static/stories_plan/chapter_1/interrogation_scene_2.md scripts/__fixtures__/asset_enabled/stories_plan/chapter_1/interrogation_scene_2.md
```

Edit the copied fixture files only. Add English `Background Prompt`, `BGM`, and `BGS` metadata to every visual unit. Add `Image Prompt` to every evidence entry in the copied fixture. Add a few expression tags such as `**早坂茜**[concerned]：...` and `**神谷澪**[stern]：...` to exercise portrait variants.

Create fixture config:

```yaml
# scripts/__fixtures__/asset_enabled/assets/config/policy.yaml
assets:
  enabled: true
globalStyle:
  prompt: Neo-noir Tokyo detective visual novel, rainy atmosphere, cinematic but grounded, no text in generated images.
types:
  background:
    dimensions: [1920, 1080]
    format: png
    transparency: false
    prompt: Wide background plate, no foreground dialogue character, no UI.
  portrait:
    dimensions: [768, 1024]
    format: png
    transparency: true
    prompt: Half-body visual novel portrait, transparent background, consistent face.
  evidence:
    dimensions: [512, 512]
    format: png
    transparency: true
    prompt: Isolated evidence icon, readable silhouette, transparent background.
  audio:
    format: ogg
    loop: true
```

```yaml
# scripts/__fixtures__/asset_enabled/assets/config/characters.yaml
characters:
  - id: soma_ritsu
    displayNames: ["相馬律"]
    portraitMode: portrait
    visualPrompt: Japanese defense attorney, tired sharp eyes, dark suit, restrained posture.
    expressions:
      standard:
        prompt: neutral analytical expression
      thinking:
        prompt: focused thinking expression
  - id: hayasaka_akane
    displayNames: ["早坂茜"]
    portraitMode: portrait
    visualPrompt: young Japanese defense attorney, practical suit, alert warm eyes.
    expressions:
      standard:
        prompt: attentive neutral expression
      concerned:
        prompt: worried expression
  - id: kamiya_mio
    displayNames: ["神谷澪"]
    portraitMode: portrait
    visualPrompt: precise Japanese prosecutor, severe composure, formal suit.
    expressions:
      standard:
        prompt: neutral controlled expression
      stern:
        prompt: stern prosecutorial expression
  - id: wakatsuki_ren
    displayNames: ["若槻蓮"]
    portraitMode: portrait
    visualPrompt: nervous young cafe worker, tired face, simple clothes.
    expressions:
      standard:
        prompt: anxious neutral expression
  - id: kuruse_toru
    displayNames: ["黑瀨徹"]
    portraitMode: portrait
    visualPrompt: middle-aged Tokyo police detective, rumpled coat, skeptical eyes.
    expressions:
      standard:
        prompt: calm skeptical expression
```

```yaml
# scripts/__fixtures__/asset_enabled/assets/config/audio.yaml
bgm:
  rain_mystery_low:
    prompt: low tension detective cue, sparse piano, quiet synth pulse
    loop: true
bgs:
  street_rain:
    prompt: steady Tokyo street rain with distant traffic
    loop: true
  indoor_rain_window:
    prompt: muffled rain against cafe windows and soft room tone
    loop: true
```

- [ ] **Step 7: Update emitter to include asset fields**

In `scripts/compile-scenes/emitter.ts`, include:

- `assetRefs` on every scene JSON.
- `assetCue` on linear sceneTag items as emitted JSON fields.
- `backgroundAssetId`, `bgm`, `bgs` on sub-locations and phases.
- `portrait` on dialogue lines.
- `imageAssetId` on evidence entries.

Keep prompt fields out of emitted scene JSON.

- [ ] **Step 8: Run asset tests**

Run:

```bash
bun test scripts/compile-scenes/assets/enrich.test.ts scripts/compile-scenes/assets/manifest.test.ts scripts/compile-scenes/emitter.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/compile-scenes/assets/enrich.ts scripts/compile-scenes/assets/enrich.test.ts scripts/compile-scenes/assets/manifest.ts scripts/compile-scenes/assets/manifest.test.ts scripts/__fixtures__/asset_enabled scripts/compile-scenes/types.ts scripts/compile-scenes/emitter.ts scripts/compile-scenes/emitter.test.ts
git commit -m "feat: enrich scenes with story asset IDs"
```

---

### Task 5: Orchestrator Asset Outputs And Reports

**Files:**
- Modify: `scripts/compile-scenes.ts`
- Modify: `scripts/compile-scenes/orchestrator.ts`
- Modify: `scripts/compile-scenes.test.ts`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/resources/assets/.gitkeep`

- [ ] **Step 1: Add failing compile tests for asset manifest output**

Append to `scripts/compile-scenes.test.ts`:

```ts
it("emits story asset manifest for an asset-enabled fixture", () => {
  const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-assets-scenes-"));
  const assetOutRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-assets-manifest-"));
  try {
    const result = compile({
      sourceRoot: "scripts/__fixtures__/asset_enabled/stories_plan",
      outputRoot: outRoot,
      assetConfigRoot: "scripts/__fixtures__/asset_enabled/assets/config",
      assetOutputRoot: assetOutRoot,
    });
    if (!result.ok) throw new Error("Compile failed:\n" + formatErrors(result.errors));
    expect(result.assetReport.enabled).toBe(true);
    expect(result.assetReport.requested.background).toBeGreaterThan(0);

    const manifest = JSON.parse(readFileSync(resolve(assetOutRoot, "manifest.json"), "utf-8"));
    expect(manifest.enabled).toBe(true);
    expect(manifest.entries.some((entry: { assetId: string }) => entry.assetId.startsWith("background."))).toBe(true);
    expect(manifest.entries.some((entry: { assetId: string }) => entry.assetId.startsWith("portrait."))).toBe(true);
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
    rmSync(assetOutRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run compile test and verify failure**

Run:

```bash
bun test scripts/compile-scenes.test.ts -t "asset-enabled fixture"
```

Expected: FAIL because `compile` does not accept asset roots or emit manifests.

- [ ] **Step 3: Extend compile options/result types**

In `scripts/compile-scenes/orchestrator.ts`, update:

```ts
export type CompileOptions = {
  sourceRoot: string;
  outputRoot: string;
  assetConfigRoot?: string;
  assetOutputRoot?: string;
};

export type AssetReport = {
  enabled: boolean;
  requested: Record<"background" | "portrait" | "evidence" | "audio", number>;
  warnings: CompileError[];
};

export type CompileResult =
  | { ok: true; chaptersCompiled: number; scenesCompiled: number; assetReport: AssetReport }
  | { ok: false; errors: CompileError[] };
```

- [ ] **Step 4: Wire config loading, enrichment, and manifest writes**

In `compile(opts)`, after parsing scenes and before validation:

```ts
const assetConfig = loadAssetConfig(opts.assetConfigRoot ?? resolve(opts.sourceRoot, "../assets/config"));
if (!assetConfig.ok) {
  errors.push(...assetConfig.errors);
}

let assetReport: AssetReport = {
  enabled: false,
  requested: { background: 0, portrait: 0, evidence: 0, audio: 0 },
  warnings: [],
};

let manifestToWrite = null;
if (assetConfig.ok) {
  const enriched = enrichScenesWithAssets({ scenes, config: assetConfig.value });
  scenes.splice(0, scenes.length, ...enriched.scenes);
  errors.push(...enriched.errors);
  assetReport = makeAssetReport(enriched.manifest, enriched.warnings);
  manifestToWrite = enriched.manifest;
}
```

After scene JSON writes, write asset outputs:

```ts
if (opts.assetOutputRoot && manifestToWrite) {
  mkdirSync(opts.assetOutputRoot, { recursive: true });
  writeFileSync(resolve(opts.assetOutputRoot, "manifest.json"), JSON.stringify(manifestToWrite, null, 2) + "\n");
  writeFileSync(resolve(opts.assetOutputRoot, "report.json"), JSON.stringify(assetReport, null, 2) + "\n");
}
```

Return `assetReport` in the success result.

- [ ] **Step 5: Update CLI roots and watch globs**

In `scripts/compile-scenes.ts`, add:

```ts
const ASSET_CONFIG_ROOT = resolve(process.cwd(), "static/assets/config");
const ASSET_OUTPUT_ROOT = resolve(process.cwd(), "src-tauri/resources/assets");
```

Pass them to `compile`. Print report after success:

```ts
if (result.assetReport.enabled) {
  const r = result.assetReport.requested;
  console.log(`[compile-scenes] Assets — backgrounds ${r.background}, portraits ${r.portrait}, evidence ${r.evidence}, audio ${r.audio}; warnings ${result.assetReport.warnings.length}.`);
}
```

Update watch to include:

```ts
chokidar.watch([`${SOURCE_ROOT}/**/*.md`, `${ASSET_CONFIG_ROOT}/**/*.yaml`], { ignoreInitial: true })
```

- [ ] **Step 6: Bundle generated asset resources**

In `src-tauri/tauri.conf.json`, update:

```json
"resources": ["resources/scenes/**/*", "resources/assets/**/*"]
```

Create `src-tauri/resources/assets/.gitkeep`.

- [ ] **Step 7: Run compile tests**

Run:

```bash
bun test scripts/compile-scenes.test.ts scripts/compile-scenes/assets
```

Expected: PASS.

- [ ] **Step 8: Run production compile**

Run:

```bash
bun run scenes:compile
```

Expected: PASS. Output should still compile live Chapter 1 because `static/assets/config/policy.yaml` has `assets.enabled: false`.

- [ ] **Step 9: Commit**

```bash
git add scripts/compile-scenes.ts scripts/compile-scenes/orchestrator.ts scripts/compile-scenes.test.ts src-tauri/tauri.conf.json src-tauri/resources/assets/.gitkeep
git commit -m "feat: emit story asset manifest"
```

---

### Task 6: Rust Schema And Game State Asset Fields

**Files:**
- Modify: `src-tauri/src/game/schema.rs`
- Modify: `src-tauri/src/game/state.rs`
- Modify: `src-tauri/src/game/view.rs`
- Modify: `src-tauri/src/game/mod.rs`

- [ ] **Step 1: Add failing serde tests**

In `src-tauri/src/game/schema.rs` tests, add:

```rust
#[test]
fn deserializes_dialogue_line_with_portrait() {
    let json = r#"{
        "kind": "line",
        "speaker": "早坂茜",
        "text": "你不舒服？",
        "portrait": {
            "characterId": "hayasaka_akane",
            "expression": "concerned",
            "assetId": "portrait.hayasaka_akane.concerned"
        }
    }"#;
    let parsed: DialogueItem = serde_json::from_str(json).unwrap();
    match parsed {
        DialogueItem::Line { portrait, .. } => {
            let portrait = portrait.unwrap();
            assert_eq!(portrait.character_id, "hayasaka_akane");
            assert_eq!(portrait.expression, "concerned");
            assert_eq!(portrait.asset_id, "portrait.hayasaka_akane.concerned");
        }
        _ => panic!("expected line"),
    }
}

#[test]
fn deserializes_scene_tag_with_asset_cue() {
    let json = r#"{
        "kind": "sceneTag",
        "text": "咖啡館外",
        "assetCue": {
            "backgroundPrompt": null,
            "backgroundAssetId": "background.chapter_1.scene_0.tag_001",
            "bgm": { "channel": "bgm", "assetId": "audio.bgm.rain_mystery_low" },
            "bgs": { "channel": "bgs", "assetId": null }
        }
    }"#;
    let parsed: DialogueItem = serde_json::from_str(json).unwrap();
    match parsed {
        DialogueItem::SceneTag { asset_cue, .. } => {
            assert_eq!(asset_cue.unwrap().background_asset_id.as_deref(), Some("background.chapter_1.scene_0.tag_001"));
        }
        _ => panic!("expected scene tag"),
    }
}
```

- [ ] **Step 2: Run Rust schema tests and verify failure**

Run:

```bash
cd src-tauri && cargo test schema::tests::deserializes_dialogue_line_with_portrait schema::tests::deserializes_scene_tag_with_asset_cue
```

Expected: FAIL because `DialogueItem` has no asset fields.

- [ ] **Step 3: Add Rust asset structs**

In `src-tauri/src/game/schema.rs`, add:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortraitRefJson {
    pub character_id: String,
    pub expression: String,
    pub asset_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCueJson {
    pub channel: AudioChannelJson,
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioChannelJson {
    Bgm,
    Bgs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualAssetCueJson {
    #[serde(default)]
    pub background_asset_id: Option<String>,
    #[serde(default)]
    pub bgm: Option<AudioCueJson>,
    #[serde(default)]
    pub bgs: Option<AudioCueJson>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRefJson {
    #[serde(rename = "type")]
    pub asset_type: String,
    pub asset_id: String,
}
```

Update `DialogueItem`:

```rust
pub enum DialogueItem {
    SceneTag {
        text: String,
        #[serde(default)]
        asset_cue: Option<VisualAssetCueJson>,
    },
    Action { text: String },
    Line {
        speaker: String,
        text: String,
        #[serde(default)]
        portrait: Option<PortraitRefJson>,
    },
}
```

Add `asset_refs: Vec<AssetRefJson>` with `#[serde(default)]` to every scene JSON struct. Add `asset_cue: Option<VisualAssetCueJson>` to `SublocationJson` and both `InterrogationPhaseJson` variants. Add `image_asset_id: Option<String>` to `EvidenceJson`.

- [ ] **Step 4: Carry evidence image IDs into inventory**

In `src-tauri/src/game/state.rs`, add `image_asset_id: Option<String>` to `EvidenceRecord` and set it in `add_evidence_from_def`:

```rust
image_asset_id: def.image_asset_id.clone(),
```

- [ ] **Step 5: Expose asset fields in view structs**

In `src-tauri/src/game/view.rs`, add:

```rust
pub background_asset_id: Option<String>,
pub bgm: Option<AudioCueView>,
pub bgs: Option<AudioCueView>,
```

to `ModeView::Dialogue`, `ModeView::Explore`, and `ModeView::Interrogation` as appropriate.

Add:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCueView {
    pub channel: String,
    pub asset_id: Option<String>,
}
```

Add `image_asset_id: Option<String>` to frontend-facing evidence records through serde.

- [ ] **Step 6: Track last visual asset cue in GameEngine**

In `src-tauri/src/game/mod.rs`, replace `last_scene_tag: Option<String>` with a struct:

```rust
#[derive(Debug, Clone, Default)]
struct LastVisualCue {
    scene_tag: Option<String>,
    background_asset_id: Option<String>,
    bgm: Option<schema::AudioCueJson>,
    bgs: Option<schema::AudioCueJson>,
}
```

Update:

- `prime_initial_queue`
- `peek_just_consumed`
- `consume_scene_tags_at_cursor`
- `advance_into_first_sublocation`
- `try_enter_current_interrogation_phase`
- `mode_view`

When a `DialogueItem::SceneTag { text, asset_cue }` is consumed, set `scene_tag` and copy cue fields into `LastVisualCue`.

When entering an investigation sub-location or interrogation phase, set `scene_tag`, `background_asset_id`, `bgm`, and `bgs` from that block's `asset_cue`.

- [ ] **Step 7: Run Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/game/schema.rs src-tauri/src/game/state.rs src-tauri/src/game/view.rs src-tauri/src/game/mod.rs
git commit -m "feat: carry story asset IDs in runtime state"
```

---

### Task 7: Frontend Asset Resolver And Rendering

**Files:**
- Create: `src/lib/assets/story-assets.ts`
- Create: `src/lib/assets/story-assets.test.ts`
- Modify: `src/lib/state/types.ts`
- Modify: `src/lib/components/SceneBackdrop.svelte`
- Modify: `src/lib/components/DialogueBox.svelte`
- Modify: `src/lib/components/DialogueBox.test.ts`
- Modify: `src/lib/components/InventoryPanel.svelte`
- Create or modify: component tests for `SceneBackdrop` and `InventoryPanel`

- [ ] **Step 1: Add resolver tests**

Create `src/lib/assets/story-assets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { publicPathForStoryAsset, placeholderForStoryAsset } from "./story-assets";

describe("story asset resolver helpers", () => {
  it("maps portrait IDs to public asset paths", () => {
    expect(publicPathForStoryAsset("portrait.hayasaka_akane.concerned", "portrait")).toBe("/assets/portraits/hayasaka_akane/concerned.png");
  });

  it("maps background IDs to nested public paths", () => {
    expect(publicPathForStoryAsset("background.chapter_1.scene_0.tag_001", "background")).toBe("/assets/backgrounds/chapter_1/scene_0/tag_001.png");
  });

  it("provides placeholders by type", () => {
    expect(placeholderForStoryAsset("background").url).toContain("data:image/svg+xml");
    expect(placeholderForStoryAsset("portrait").placeholder).toBe(true);
  });
});
```

- [ ] **Step 2: Run resolver tests and verify failure**

Run:

```bash
bunx vitest run src/lib/assets/story-assets.test.ts
```

Expected: FAIL because `story-assets.ts` does not exist.

- [ ] **Step 3: Implement frontend resolver**

Create `src/lib/assets/story-assets.ts`:

```ts
export type StoryAssetType = "background" | "portrait" | "evidence" | "audio";

export type ResolvedStoryAsset = {
  assetId: string;
  type: StoryAssetType;
  url: string;
  placeholder: boolean;
};

const cache = new Map<string, Promise<ResolvedStoryAsset>>();

export function publicPathForStoryAsset(assetId: string, type: StoryAssetType): string {
  if (type === "portrait") {
    const [, characterId, expression] = assetId.split(".");
    return `/assets/portraits/${characterId}/${expression}.png`;
  }
  if (type === "evidence") {
    return `/assets/evidence/${assetId.replace(/^evidence\./, "")}.png`;
  }
  if (type === "audio") {
    const [, channel, id] = assetId.split(".");
    return `/assets/audio/${channel}/${id}.ogg`;
  }
  return `/assets/backgrounds/${assetId.replace(/^background\./, "").replaceAll(".", "/")}.png`;
}

export function placeholderForStoryAsset(type: Exclude<StoryAssetType, "audio">): ResolvedStoryAsset {
  const color = type === "background" ? "101018" : type === "portrait" ? "181820" : "202018";
  const label = type.toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#${color}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#d8d0bf" font-family="serif" font-size="28">${label} MISSING</text></svg>`;
  return {
    assetId: `placeholder.${type}`,
    type,
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    placeholder: true,
  };
}

export function resolveStoryAsset(assetId: string | null | undefined, type: StoryAssetType): Promise<ResolvedStoryAsset | null> {
  if (!assetId) return Promise.resolve(null);
  const key = `${type}:${assetId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = resolveUncached(assetId, type);
  cache.set(key, promise);
  return promise;
}

async function resolveUncached(assetId: string, type: StoryAssetType): Promise<ResolvedStoryAsset> {
  const url = publicPathForStoryAsset(assetId, type);
  if (type === "audio") return { assetId, type, url, placeholder: false };
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (response.ok) return { assetId, type, url, placeholder: false };
  } catch {
    return { ...placeholderForStoryAsset(type), assetId };
  }
  return { ...placeholderForStoryAsset(type), assetId };
}
```

- [ ] **Step 4: Update frontend types**

In `src/lib/state/types.ts`, mirror Rust:

```ts
export type PortraitRef = {
  characterId: string;
  expression: string;
  assetId: string;
};

export type AudioCue = {
  channel: "bgm" | "bgs";
  assetId: string | null;
};

export type VisualAssetCue = {
  backgroundAssetId: string | null;
  bgm: AudioCue | null;
  bgs: AudioCue | null;
};
```

Update `DialogueItem`, `Mode`, and `EvidenceRecord` to include those optional fields.

- [ ] **Step 5: Render background asset**

Update `SceneBackdrop.svelte` props:

```ts
import { resolveStoryAsset, type ResolvedStoryAsset } from "$lib/assets/story-assets";

let {
  sceneTag,
  backgroundAssetId = null,
}: {
  sceneTag: string | null;
  backgroundAssetId?: string | null;
} = $props();

let resolved = $state<ResolvedStoryAsset | null>(null);

$effect(() => {
  let cancelled = false;
  resolveStoryAsset(backgroundAssetId, "background").then((asset) => {
    if (!cancelled) resolved = asset;
  });
  return () => {
    cancelled = true;
  };
});
```

Render an image layer when `resolved` exists:

```svelte
{#if resolved}
  <img class="background-image" src={resolved.url} alt="" aria-hidden="true" />
{/if}
```

Keep the existing scene stamp for `sceneTag`.

- [ ] **Step 6: Render dialogue portrait**

Update `DialogueBox.svelte` to resolve `current.kind === "line" ? current.portrait?.assetId : null` as a portrait. Render before `.line-grid`:

```svelte
{#if portraitAsset}
  <img class="portrait" src={portraitAsset.url} alt="" aria-hidden="true" />
{/if}
```

Style as a fixed-size transparent VN portrait layer that does not resize the dialogue button. Use `position: absolute; left: 24px; bottom: calc(100% - 8px); height: 320px; max-width: 240px; object-fit: contain; pointer-events: none;`.

- [ ] **Step 7: Render evidence icons**

Update `InventoryPanel.svelte` evidence rows to resolve and display `e.imageAssetId`. Add a small fixed `36px` thumbnail before the text entry. Missing image uses the evidence placeholder.

- [ ] **Step 8: Update page wiring**

In `src/routes/+page.svelte`, pass:

```svelte
<SceneBackdrop
  sceneTag={gameState.value.mode.sceneTag}
  backgroundAssetId={gameState.value.mode.backgroundAssetId}
/>
```

- [ ] **Step 9: Add component tests**

Update `DialogueBox.test.ts`:

```ts
it("renders a portrait image when line has portrait metadata", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  renderDialogueBox({
    kind: "line",
    speaker: "早坂茜",
    text: "你不舒服？",
    portrait: {
      characterId: "hayasaka_akane",
      expression: "concerned",
      assetId: "portrait.hayasaka_akane.concerned",
    },
  });
  expect(await screen.findByRole("img", { hidden: true })).toBeInTheDocument();
});
```

Add equivalent tests for background placeholder and evidence icon placeholder.

- [ ] **Step 10: Run frontend tests**

Run:

```bash
bunx vitest run src/lib/assets/story-assets.test.ts src/lib/components/DialogueBox.test.ts src/lib/components/ErrorBanner.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/assets/story-assets.ts src/lib/assets/story-assets.test.ts src/lib/state/types.ts src/lib/components/SceneBackdrop.svelte src/lib/components/DialogueBox.svelte src/lib/components/DialogueBox.test.ts src/lib/components/InventoryPanel.svelte src/routes/+page.svelte
git commit -m "feat: render story asset placeholders"
```

---

### Task 8: Story-Writing Skill Updates

**Files:**
- Modify: `.claude/skills/writing-detective-game-dialogue/SKILL.md`
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `.claude/skills/writing-interrogation-scene/SKILL.md`
- Modify: `.claude/skills/writing-chapter-manifest/SKILL.md`

- [ ] **Step 1: Update linear dialogue skill**

In `.claude/skills/writing-detective-game-dialogue/SKILL.md`, add a section after "Scene description requirements":

```markdown
## Asset metadata when assets are enabled

When the project asset workflow is enabled, every `[場景：...]` tag in a linear scene must be followed immediately by production metadata:

```markdown
[場景：吉祥寺雨鐘咖啡館，深夜，雨夜。]
- **Background Prompt:** Rainy midnight exterior of a small Tokyo cafe, warm interior light visible through glass, neo-noir detective visual novel background, no characters, no UI text.
- **BGM:** rain_mystery_low
- **BGS:** street_rain
```

Rules:
- `Background Prompt` is English production metadata.
- `BGM` and `BGS` use IDs from `static/assets/config/audio.yaml` or `none`.
- The first scene tag in an asset-enabled corpus must explicitly set both `BGM` and `BGS`; later tags may omit a channel to keep the previous value.
- Writers never write filesystem paths.

Dialogue may request a speaker expression with `**角色名**[expression_slug]：台詞`. Omitted expression means `standard`.
```
```

- [ ] **Step 2: Update investigation skill**

In `.claude/skills/writing-investigation-scene/SKILL.md`, add to Sub-location schema:

```markdown
- **Required when assets are enabled:** `Background Prompt`
- **Optional after first visual unit:** `BGM`, `BGS`
```

Add to Evidence Manifest entry schema:

```markdown
- **Required when assets are enabled:** `Image Prompt` — English production prompt for the evidence icon. Do not include a path.
```

- [ ] **Step 3: Update interrogation skill**

In `.claude/skills/writing-interrogation-scene/SKILL.md`, add to Phase schema:

```markdown
- **Required when assets are enabled:** `Background Prompt`
- **Optional after first visual unit:** `BGM`, `BGS`
```

Add the same Evidence `Image Prompt` rule as the investigation skill.

- [ ] **Step 4: Update chapter manifest skill**

In `.claude/skills/writing-chapter-manifest/SKILL.md`, add:

```markdown
## Asset generation scope

The scene list in `chapter.md` controls which authored scenes participate in compile-time asset generation. Draft files not listed in the manifest are ignored by the scene compiler and should not be expected to produce asset requests.
```

- [ ] **Step 5: Search for path-authoring contradictions**

Run:

```bash
rg -n "path|filesystem|Background Prompt|Image Prompt|expression_slug|assets/config" .claude/skills
```

Expected: Any references to asset paths should clearly say writers do not author paths.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/writing-detective-game-dialogue/SKILL.md .claude/skills/writing-investigation-scene/SKILL.md .claude/skills/writing-interrogation-scene/SKILL.md .claude/skills/writing-chapter-manifest/SKILL.md
git commit -m "docs: update story writing asset rules"
```

---

### Task 9: Final Verification And Release Readiness

**Files:**
- Modify only files already touched if verification exposes issues.

- [ ] **Step 1: Run targeted compiler tests**

Run:

```bash
bun test scripts/compile-scenes.test.ts scripts/compile-scenes/*.test.ts scripts/compile-scenes/assets/*.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend unit/component tests**

Run:

```bash
bun run test
```

Expected: PASS. If Playwright loader errors appear from broad Bun test discovery, switch to the repo script exactly as written here instead of `bun test`.

- [ ] **Step 3: Run Svelte type check**

Run:

```bash
bun run check
```

Expected: PASS.

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS.

- [ ] **Step 5: Run production story compile**

Run:

```bash
bun run scenes:compile
```

Expected: PASS. Live Chapter 1 compiles with assets disabled.

- [ ] **Step 6: Run build**

Run:

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 7: Inspect generated resource status**

Run:

```bash
git status --short
```

Expected: source changes are intentional. Generated `src-tauri/resources/scenes/*` may change only if schema output changed; keep them if the repo tracks generated resources, otherwise verify `.gitignore` behavior before staging.

- [ ] **Step 8: Commit verification fixes**

If any fixes were needed, commit them:

```bash
git add scripts src-tauri src static .claude package.json bun.lock
git commit -m "test: verify story asset pipeline"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - YAML catalogs and feature switch: Task 1.
  - Markdown asset metadata and portrait syntax: Tasks 2 and 3.
  - Logical asset IDs and manifest: Task 4.
  - Orchestrator outputs and Tauri resources: Task 5.
  - Runtime state and schemas: Task 6.
  - Frontend placeholders and resolver: Task 7.
  - Story-writing skill updates: Task 8.
  - Verification: Task 9.
- Type consistency:
  - `assetCue`, `portrait`, `imageAssetId`, and `assetRefs` are named consistently across TypeScript, Rust, and frontend.
  - Audio IDs are represented as `audio.bgm.<id>` and `audio.bgs.<id>` after enrichment.
  - `none` is represented as `assetId: null` on an `AudioCue`.
- Scope check:
  - No task implements AI generation, binary packing, approval state, multi-character staging, or audio playback.
