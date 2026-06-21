# Audio Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a plan-first Lyra audio workflow in `packages/scripts`, migrate the existing scene compiler into that package, validate reusable `BGM`/`BGS`/`SFX` catalog entries, apply approved `BGM`/`BGS` cues to scene markdown, and generate approved `.ogg` files through ElevenLabs on explicit command.

**Architecture:** First move the current root `scripts/` tree into a dedicated workspace package so all repo automation lives in one package. Then add focused audio modules for sound-plan validation, audio catalog updates, markdown cue application, and ElevenLabs generation. `scenes:compile` remains offline and deterministic; paid generation is isolated behind `audio:generate`.

**Tech Stack:** Bun workspace package, TypeScript, Vitest, YAML, existing `@lyra/asset-paths`, repo-local `.claude/skills`, ElevenLabs REST API (`POST /v1/music` for BGM and `POST /v1/sound-generation` for BGS/SFX), `.ogg` files under `static/assets/audio/**`.

---

## File Structure

Create or modify these files:

- Modify: `package.json` — delegate root automation scripts to `packages/scripts`.
- Modify: `apps/game/package.json` — call root/package scene compile commands without direct root `scripts/` paths.
- Modify: `apps/layout-editor/package.json` — keep editor Tauri dev flow calling root `scenes:compile`.
- Modify: `vitest.scripts.config.ts` — point script tests at `packages/scripts/**/*.test.ts`.
- Modify: `tsconfig.scripts.json` — include `packages/scripts/**/*.ts`.
- Modify: `packages/asset-paths/src/index.ts` — validate audio channels and support `sfx` explicitly.
- Modify: `apps/game/src/lib/assets/story-assets.test.ts` — cover `audio.sfx.<id>` URL mapping.
- Move: `scripts/**` -> `packages/scripts/**` — entire current root scripts tree.
- Create: `packages/scripts/package.json` — package-local commands and workspace dependencies.
- Create: `packages/scripts/audio/types.ts` — shared audio-plan, catalog, and generation types.
- Create: `packages/scripts/audio/sound-plan.ts` — parse and validate durable sound plans.
- Create: `packages/scripts/audio/sound-plan.test.ts` — schema and reference validation.
- Create: `packages/scripts/audio/audio-catalog.ts` — read, merge, and write `static/assets/config/audio.yaml`.
- Create: `packages/scripts/audio/audio-catalog.test.ts` — catalog merge and duplicate diagnostics.
- Create: `packages/scripts/audio/visual-units.ts` — locate chapter visual units in manifest-listed markdown files.
- Create: `packages/scripts/audio/visual-units.test.ts` — linear, investigation, and interrogation visual unit indexing.
- Create: `packages/scripts/audio/apply.ts` — apply approved catalog entries and `BGM`/`BGS` cues.
- Create: `packages/scripts/audio/apply.test.ts` — deterministic source edits and `--check` drift behavior.
- Create: `packages/scripts/audio/elevenlabs-client.ts` — provider calls with injectable `fetch`.
- Create: `packages/scripts/audio/elevenlabs-client.test.ts` — request-shape tests without network.
- Create: `packages/scripts/audio/audio-files.ts` — raw provider file staging and MP3-to-OGG conversion.
- Create: `packages/scripts/audio/audio-files.test.ts` — converter invocation and final `.ogg` path tests.
- Create: `packages/scripts/audio/generate.ts` — dry-run and generation orchestration.
- Create: `packages/scripts/audio/generate.test.ts` — dry-run, missing key, existing output, and force behavior.
- Create: `packages/scripts/audio/cli.ts` — `audio:validate`, `audio:apply`, and `audio:generate` command dispatch.
- Create: `.claude/skills/designing-lyra-sound-assets/SKILL.md` — plan-first sound-design agent instructions.
- Create: `docs/audio_plans/.gitkeep` — durable sound-plan directory.
- Modify: `.gitignore` — ignore generated audio temp/cache files if a repo-local cache directory is used.
- Modify docs and skills with direct root `scripts/` references only when they describe current commands or fixture paths used by active agents.

## Task 1: Migrate Root Scripts Into `packages/scripts`

**Files:**
- Create: `packages/scripts/package.json`
- Move: `scripts/**` -> `packages/scripts/**`
- Modify: `package.json`
- Modify: `apps/game/package.json`
- Modify: `apps/layout-editor/package.json`
- Modify: `vitest.scripts.config.ts`
- Modify: `tsconfig.scripts.json`

- [ ] **Step 1: Move the tree**

Run:

```bash
mkdir -p packages/scripts
git mv scripts/compile-scenes.ts packages/scripts/compile-scenes.ts
git mv scripts/compile-scenes packages/scripts/compile-scenes
git mv scripts/__fixtures__ packages/scripts/__fixtures__
git mv scripts/__snapshots__ packages/scripts/__snapshots__
git mv scripts/compile-scenes.test.ts packages/scripts/compile-scenes.test.ts
git mv scripts/monorepo-layout.test.ts packages/scripts/monorepo-layout.test.ts
git mv scripts/validate-docs-scenes.ts packages/scripts/validate-docs-scenes.ts
rmdir scripts
```

Expected: `git status --short` shows moved files under `packages/scripts/` and no root `scripts/` directory remains.

- [ ] **Step 2: Add package metadata**

Create `packages/scripts/package.json`:

```json
{
  "name": "@lyra/scripts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "compile-scenes": "bun run compile-scenes.ts",
    "evidence-sources:audit": "bun run compile-scenes/evidence-sources-audit.ts",
    "validate-docs-scenes": "bun run validate-docs-scenes.ts"
  },
  "dependencies": {
    "@lyra/asset-paths": "workspace:*",
    "chokidar": "^5.0.0",
    "yaml": "^2.9.0"
  },
  "devDependencies": {
    "bun-types": "^1.3.14",
    "vitest": "^4.1.6"
  }
}
```

- [ ] **Step 3: Update root commands**

Modify root `package.json` scripts to use the package:

```json
{
  "scripts": {
    "scenes:compile": "bun run --cwd packages/scripts compile-scenes",
    "scenes:watch": "bun run --cwd packages/scripts compile-scenes --watch",
    "evidence-sources:audit": "bun run --cwd packages/scripts evidence-sources:audit",
    "test:scripts": "vitest run --config vitest.scripts.config.ts"
  }
}
```

Keep all unrelated root scripts unchanged.

- [ ] **Step 4: Update app commands**

Modify `apps/game/package.json`:

```json
{
  "scripts": {
    "scenes:compile": "bun run --cwd ../.. scenes:compile",
    "scenes:watch": "bun run --cwd ../.. scenes:watch"
  }
}
```

Keep `dev:tauri` as:

```json
"dev:tauri": "bun run scenes:compile && tauri dev -c src-tauri/tauri.dev.conf.json"
```

No change is required in `apps/layout-editor/package.json` if it already calls `bun run --cwd ../.. scenes:compile`.

- [ ] **Step 5: Update TypeScript and Vitest config**

Modify `vitest.scripts.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/scripts/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.worktrees/**",
      "**/dist/**",
      "**/build/**",
    ],
  },
});
```

Modify `tsconfig.scripts.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": [
    "packages/scripts/**/*.ts",
    "packages/asset-paths/src/**/*.ts"
  ]
}
```

- [ ] **Step 6: Update moved fixture path literals**

Run:

```bash
rg -n '"scripts/__fixtures__|scripts/__snapshots__|scripts/compile-scenes|scripts/validate-docs-scenes' packages/scripts
```

Replace path literals inside moved tests from `scripts/...` to `packages/scripts/...`. Keep comments accurate by changing header comments such as `// scripts/compile-scenes.ts` to `// packages/scripts/compile-scenes.ts`.

- [ ] **Step 7: Run migration tests**

Run:

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes.test.ts
bun run scenes:compile
bun run test:scripts
```

Expected:

- focused compile-scene tests pass;
- scene compilation succeeds and writes generated resources;
- script test suite passes with no root `scripts/` paths required.

- [ ] **Step 8: Commit package migration**

Run:

```bash
git add package.json apps/game/package.json apps/layout-editor/package.json vitest.scripts.config.ts tsconfig.scripts.json packages/scripts
git add -u scripts
git commit -m "chore(scripts): move automation into workspace package"
```

## Task 2: Extend Audio Channel Support For `sfx`

**Files:**
- Modify: `packages/asset-paths/src/index.ts`
- Modify: `apps/game/src/lib/assets/story-assets.test.ts`
- Modify: `packages/scripts/compile-scenes/assets/config.ts`
- Modify: `packages/scripts/compile-scenes/assets/config.test.ts`
- Modify: `packages/scripts/compile-scenes/assets/manifest.test.ts`

- [ ] **Step 1: Add failing path tests for SFX**

Add to `apps/game/src/lib/assets/story-assets.test.ts` near the existing audio test:

```ts
it("maps SFX audio IDs to channel-specific ogg paths", () => {
  expect(publicPathForStoryAsset("audio.sfx.plastic_bag_crinkle", "audio")).toBe(
    "/assets/audio/sfx/plastic_bag_crinkle.ogg",
  );
});
```

Add to `packages/scripts/compile-scenes/assets/manifest.test.ts` near the audio path cases:

```ts
it("maps SFX asset IDs to static audio paths", () => {
  expect(publicPath("audio.sfx.plastic_bag_crinkle", "audio")).toBe(
    "/assets/audio/sfx/plastic_bag_crinkle.ogg",
  );
  expect(expectedPath("audio.sfx.plastic_bag_crinkle", "audio")).toBe(
    "static/assets/audio/sfx/plastic_bag_crinkle.ogg",
  );
});
```

- [ ] **Step 2: Run tests to verify current behavior**

Run:

```bash
bunx vitest run apps/game/src/lib/assets/story-assets.test.ts packages/scripts/compile-scenes/assets/manifest.test.ts
```

Expected: current path construction may already pass; if it passes, keep the tests as regression coverage before adding channel validation.

- [ ] **Step 3: Validate audio channel segments**

Modify `packages/asset-paths/src/index.ts`:

```ts
const AUDIO_CHANNELS = new Set(["bgm", "bgs", "sfx"]);

function requireAudioChannel(channel: string, assetId: string): string {
  if (!AUDIO_CHANNELS.has(channel)) {
    throw new Error(
      `Invalid audio assetId "${assetId}": expected channel bgm, bgs, or sfx, got "${channel}".`,
    );
  }
  return channel;
}
```

Then update the audio branch:

```ts
if (type === "audio") {
  const [, channel, id] = requireSegments(assetId, "audio", 3, true);
  return `/assets/audio/${requireAudioChannel(channel, assetId)}/${id}.ogg`;
}
```

- [ ] **Step 4: Extend compiler audio config maps**

Modify `packages/scripts/compile-scenes/assets/config.ts`:

```ts
export type AudioChannel = "bgm" | "bgs" | "sfx";
```

Change the `AssetConfig` audio shape to:

```ts
audio: {
  bgm: Map<string, AudioConfigEntry>;
  bgs: Map<string, AudioConfigEntry>;
  sfx: Map<string, AudioConfigEntry>;
};
```

Update the default config and YAML load fallback:

```ts
audio: { bgm: new Map(), bgs: new Map(), sfx: new Map() },
```

```ts
bgm: {},
bgs: {},
sfx: {},
```

Update `buildAudio`:

```ts
function buildAudio(raw: Record<string, unknown>, errors: CompileError[]) {
  return {
    bgm: buildAudioMap(raw.bgm, "bgm", errors),
    bgs: buildAudioMap(raw.bgs, "bgs", errors),
    sfx: buildAudioMap(raw.sfx, "sfx", errors),
  };
}
```

Do not add scene markdown parsing for SFX.

- [ ] **Step 5: Add config tests for SFX**

In `packages/scripts/compile-scenes/assets/config.test.ts`, extend the fixture YAML in the "loads enabled policy, characters, and audio IDs" test:

```yaml
sfx:
  plastic_bag_crinkle:
    prompt: short plastic bag crinkle
    loop: false
```

Assert:

```ts
expect(result.value.audio.sfx.has("plastic_bag_crinkle")).toBe(true);
expect(result.value.audio.sfx.get("plastic_bag_crinkle")?.loop).toBe(false);
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
bunx vitest run packages/scripts/compile-scenes/assets/config.test.ts packages/scripts/compile-scenes/assets/manifest.test.ts apps/game/src/lib/assets/story-assets.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit SFX catalog/path support**

Run:

```bash
git add packages/asset-paths/src/index.ts apps/game/src/lib/assets/story-assets.test.ts packages/scripts/compile-scenes/assets/config.ts packages/scripts/compile-scenes/assets/config.test.ts packages/scripts/compile-scenes/assets/manifest.test.ts
git commit -m "feat(audio): support sfx asset catalog entries"
```

## Task 3: Add Sound Plan Schema And Validation

**Files:**
- Create: `packages/scripts/audio/types.ts`
- Create: `packages/scripts/audio/sound-plan.ts`
- Create: `packages/scripts/audio/sound-plan.test.ts`
- Create: `docs/audio_plans/.gitkeep`

- [ ] **Step 1: Write sound-plan validation tests**

Create `packages/scripts/audio/sound-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSoundPlanText, validateSoundPlan } from "./sound-plan";

const validPlan = `
schemaVersion: 1
chapterId: chapter_1
sources:
  - docs/stories_plan/chapter_1/scene_6.md
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries:
  - id: rain_street_light
    channel: bgs
    status: approved
    loop: true
    intendedDurationSeconds: 30
    prompt: Steady light Tokyo street rain, no thunder, loopable.
    reuseRationale: Covers exterior rainy street scenes.
    evidence:
      - file: docs/stories_plan/chapter_1/scene_6.md
        line: 3
        note: rainy shopping street under an awning
cues:
  - file: docs/stories_plan/chapter_1/scene_6.md
    visualUnit: tag_001
    bgs: rain_street_light
rejected:
  - file: docs/stories_plan/chapter_1/investigation_scene_3.md
    line: 26
    sound: coin tray click
    reason: incidental texture, not persistent or emphasized
`;

describe("sound plan validation", () => {
  it("parses a valid plan", () => {
    const parsed = parseSoundPlanText(validPlan, "plan.yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entries[0]?.id).toBe("rain_street_light");
    expect(validateSoundPlan(parsed.value)).toEqual([]);
  });

  it("rejects duplicate entry ids", () => {
    const parsed = parseSoundPlanText(
      validPlan.replace(
        "rejected:",
        `  - id: rain_street_light
    channel: bgs
    status: approved
    loop: true
    intendedDurationSeconds: 20
    prompt: Duplicate rain.
    reuseRationale: Duplicate.
    evidence:
      - file: docs/stories_plan/chapter_1/scene_6.md
        line: 3
        note: duplicate
rejected:`,
      ),
      "plan.yaml",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateSoundPlan(parsed.value)).toContainEqual(
      expect.objectContaining({ code: "soundPlanDuplicateId" }),
    );
  });

  it("rejects cue references to unapproved entries", () => {
    const parsed = parseSoundPlanText(
      validPlan.replace("status: approved", "status: proposed"),
      "plan.yaml",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateSoundPlan(parsed.value)).toContainEqual(
      expect.objectContaining({ code: "soundPlanCueUnapprovedEntry" }),
    );
  });

  it("rejects sfx cue fields in v1", () => {
    const parsed = parseSoundPlanText(
      validPlan.replace("bgs: rain_street_light", "sfx: plastic_bag_crinkle"),
      "plan.yaml",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateSoundPlan(parsed.value)).toContainEqual(
      expect.objectContaining({ code: "soundPlanSfxCueUnsupported" }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bunx vitest run packages/scripts/audio/sound-plan.test.ts
```

Expected: FAIL because `packages/scripts/audio/sound-plan.ts` does not exist.

- [ ] **Step 3: Add shared audio types**

Create `packages/scripts/audio/types.ts`:

```ts
export type SoundPlanChannel = "bgm" | "bgs" | "sfx";
export type SoundPlanStatus = "proposed" | "approved" | "generated" | "rejected";

export type SoundPlanEvidence = {
  file: string;
  line: number;
  note: string;
};

export type SoundPlanEntry = {
  id: string;
  channel: SoundPlanChannel;
  status: SoundPlanStatus;
  loop: boolean;
  intendedDurationSeconds: number;
  prompt: string;
  reuseRationale: string;
  evidence: SoundPlanEvidence[];
  provider?: string;
  endpoint?: string;
  promptHash?: string;
  generatedAt?: string;
  durationSeconds?: number;
  outputPath?: string;
  forced?: boolean;
  normalizationNotes?: string;
};

export type SoundPlanCue = {
  file: string;
  visualUnit: string;
  bgm?: string | "none";
  bgs?: string | "none";
  sfx?: string;
};

export type RejectedSound = {
  file: string;
  line: number;
  sound: string;
  reason: string;
};

export type SoundPlan = {
  schemaVersion: 1;
  chapterId: string;
  sources: string[];
  catalogSnapshot: {
    bgm: string[];
    bgs: string[];
    sfx: string[];
  };
  entries: SoundPlanEntry[];
  cues: SoundPlanCue[];
  rejected: RejectedSound[];
};

export type SoundPlanDiagnostic = {
  code: string;
  message: string;
  path: string;
};
```

- [ ] **Step 4: Implement parser and validator**

Create `packages/scripts/audio/sound-plan.ts`:

```ts
import YAML from "yaml";
import type {
  SoundPlan,
  SoundPlanChannel,
  SoundPlanDiagnostic,
  SoundPlanEntry,
  SoundPlanStatus,
} from "./types";

const CHANNELS = new Set<SoundPlanChannel>(["bgm", "bgs", "sfx"]);
const STATUSES = new Set<SoundPlanStatus>([
  "proposed",
  "approved",
  "generated",
  "rejected",
]);
const ID_RE = /^[a-z0-9_]+$/;

export type ParseSoundPlanResult =
  | { ok: true; value: SoundPlan }
  | { ok: false; diagnostics: SoundPlanDiagnostic[] };

export function parseSoundPlanText(
  text: string,
  path: string,
): ParseSoundPlanResult {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "soundPlanYamlInvalid",
          path,
          message: `${path}: ${(error as Error).message}`,
        },
      ],
    };
  }
  const diagnostics: SoundPlanDiagnostic[] = [];
  const plan = coercePlan(raw, path, diagnostics);
  if (!plan) return { ok: false, diagnostics };
  return { ok: true, value: plan };
}

export function validateSoundPlan(plan: SoundPlan): SoundPlanDiagnostic[] {
  const diagnostics: SoundPlanDiagnostic[] = [];
  const ids = new Map<string, SoundPlanEntry>();

  for (const [index, entry] of plan.entries.entries()) {
    const path = `entries[${index}]`;
    if (!ID_RE.test(entry.id)) {
      diagnostics.push({
        code: "soundPlanIdInvalid",
        path: `${path}.id`,
        message: `Sound ID "${entry.id}" must be snake_case.`,
      });
    }
    if (ids.has(entry.id)) {
      diagnostics.push({
        code: "soundPlanDuplicateId",
        path,
        message: `Duplicate sound ID "${entry.id}".`,
      });
    }
    ids.set(entry.id, entry);
    if (entry.prompt.trim() === "") {
      diagnostics.push({
        code: "soundPlanPromptMissing",
        path: `${path}.prompt`,
        message: `Sound "${entry.id}" must define a prompt.`,
      });
    }
    if (!Number.isFinite(entry.intendedDurationSeconds) || entry.intendedDurationSeconds <= 0) {
      diagnostics.push({
        code: "soundPlanDurationInvalid",
        path: `${path}.intendedDurationSeconds`,
        message: `Sound "${entry.id}" must define a positive duration.`,
      });
    }
    if (entry.evidence.length === 0 && entry.status !== "rejected") {
      diagnostics.push({
        code: "soundPlanEvidenceMissing",
        path: `${path}.evidence`,
        message: `Sound "${entry.id}" must cite at least one scene source.`,
      });
    }
  }

  for (const [index, cue] of plan.cues.entries()) {
    const path = `cues[${index}]`;
    for (const channel of ["bgm", "bgs"] as const) {
      const id = cue[channel];
      if (!id || id === "none") continue;
      const entry = ids.get(id);
      if (!entry) {
        diagnostics.push({
          code: "soundPlanCueUnknownEntry",
          path: `${path}.${channel}`,
          message: `Cue references unknown ${channel} entry "${id}".`,
        });
        continue;
      }
      if (entry.channel !== channel) {
        diagnostics.push({
          code: "soundPlanCueChannelMismatch",
          path: `${path}.${channel}`,
          message: `Cue ${channel} references ${entry.channel} entry "${id}".`,
        });
      }
      if (entry.status !== "approved" && entry.status !== "generated") {
        diagnostics.push({
          code: "soundPlanCueUnapprovedEntry",
          path: `${path}.${channel}`,
          message: `Cue references "${id}" before it is approved.`,
        });
      }
    }
    if (cue.sfx) {
      diagnostics.push({
        code: "soundPlanSfxCueUnsupported",
        path: `${path}.sfx`,
        message: "SFX cues are not supported in scene markdown in v1.",
      });
    }
  }

  return diagnostics;
}

function coercePlan(
  raw: unknown,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlan | null {
  if (!isRecord(raw)) {
    diagnostics.push({
      code: "soundPlanRootInvalid",
      path,
      message: "Sound plan root must be a YAML object.",
    });
    return null;
  }
  const entries = array(raw.entries).map((entry) => coerceEntry(entry));
  if (entries.some((entry) => entry === null)) {
    diagnostics.push({
      code: "soundPlanEntryInvalid",
      path: "entries",
      message: "Every sound plan entry must be an object with required fields.",
    });
    return null;
  }
  return {
    schemaVersion: raw.schemaVersion === 1 ? 1 : 1,
    chapterId: text(raw.chapterId),
    sources: array(raw.sources).map(text),
    catalogSnapshot: {
      bgm: array(isRecord(raw.catalogSnapshot) ? raw.catalogSnapshot.bgm : []).map(text),
      bgs: array(isRecord(raw.catalogSnapshot) ? raw.catalogSnapshot.bgs : []).map(text),
      sfx: array(isRecord(raw.catalogSnapshot) ? raw.catalogSnapshot.sfx : []).map(text),
    },
    entries: entries as SoundPlanEntry[],
    cues: array(raw.cues).map((cue) => {
      const record = isRecord(cue) ? cue : {};
      return {
        file: text(record.file),
        visualUnit: text(record.visualUnit),
        bgm: optionalText(record.bgm) as string | "none" | undefined,
        bgs: optionalText(record.bgs) as string | "none" | undefined,
        sfx: optionalText(record.sfx),
      };
    }),
    rejected: array(raw.rejected).map((item) => {
      const record = isRecord(item) ? item : {};
      return {
        file: text(record.file),
        line: number(record.line),
        sound: text(record.sound),
        reason: text(record.reason),
      };
    }),
  };
}

function coerceEntry(raw: unknown): SoundPlanEntry | null {
  if (!isRecord(raw)) return null;
  const channel = text(raw.channel) as SoundPlanChannel;
  const status = text(raw.status) as SoundPlanStatus;
  if (!CHANNELS.has(channel) || !STATUSES.has(status)) return null;
  return {
    id: text(raw.id),
    channel,
    status,
    loop: bool(raw.loop),
    intendedDurationSeconds: number(raw.intendedDurationSeconds),
    prompt: text(raw.prompt),
    reuseRationale: text(raw.reuseRationale),
    evidence: array(raw.evidence).map((item) => {
      const record = isRecord(item) ? item : {};
      return {
        file: text(record.file),
        line: number(record.line),
        note: text(record.note),
      };
    }),
    provider: optionalText(raw.provider),
    endpoint: optionalText(raw.endpoint),
    promptHash: optionalText(raw.promptHash),
    generatedAt: optionalText(raw.generatedAt),
    durationSeconds:
      raw.durationSeconds === undefined ? undefined : number(raw.durationSeconds),
    outputPath: optionalText(raw.outputPath),
    forced: raw.forced === undefined ? undefined : bool(raw.forced),
    normalizationNotes: optionalText(raw.normalizationNotes),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function bool(value: unknown): boolean {
  return value === true;
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}
```

- [ ] **Step 5: Add durable plan directory**

Run:

```bash
mkdir -p docs/audio_plans
touch docs/audio_plans/.gitkeep
```

- [ ] **Step 6: Run focused test**

Run:

```bash
bunx vitest run packages/scripts/audio/sound-plan.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit sound-plan schema**

Run:

```bash
git add packages/scripts/audio/types.ts packages/scripts/audio/sound-plan.ts packages/scripts/audio/sound-plan.test.ts docs/audio_plans/.gitkeep
git commit -m "feat(audio): validate durable sound plans"
```

## Task 4: Add Audio Catalog Merge Support

**Files:**
- Create: `packages/scripts/audio/audio-catalog.ts`
- Create: `packages/scripts/audio/audio-catalog.test.ts`

- [ ] **Step 1: Write catalog merge tests**

Create `packages/scripts/audio/audio-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeApprovedEntriesIntoCatalog, parseAudioCatalogText } from "./audio-catalog";
import type { SoundPlanEntry } from "./types";

const approvedBgs: SoundPlanEntry = {
  id: "rain_street_light",
  channel: "bgs",
  status: "approved",
  loop: true,
  intendedDurationSeconds: 30,
  prompt: "Steady light Tokyo street rain.",
  reuseRationale: "Exterior rain pool.",
  evidence: [
    {
      file: "docs/stories_plan/chapter_1/scene_6.md",
      line: 3,
      note: "rainy street",
    },
  ],
};

describe("audio catalog", () => {
  it("parses empty current catalog", () => {
    const parsed = parseAudioCatalogText("bgm: {}\nbgs: {}\n", "audio.yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sfx).toEqual({});
  });

  it("merges approved entries into channel maps", () => {
    const parsed = parseAudioCatalogText("bgm: {}\nbgs: {}\nsfx: {}\n", "audio.yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = mergeApprovedEntriesIntoCatalog(parsed.value, [approvedBgs]);
    expect(result.diagnostics).toEqual([]);
    expect(result.catalog.bgs.rain_street_light).toEqual({
      prompt: "Steady light Tokyo street rain.",
      loop: true,
    });
  });

  it("rejects incompatible duplicate entries", () => {
    const parsed = parseAudioCatalogText(
      "bgm: {}\nbgs:\n  rain_street_light:\n    prompt: Different rain.\n    loop: true\nsfx: {}\n",
      "audio.yaml",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = mergeApprovedEntriesIntoCatalog(parsed.value, [approvedBgs]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "audioCatalogDuplicateConflict" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bunx vitest run packages/scripts/audio/audio-catalog.test.ts
```

Expected: FAIL because `audio-catalog.ts` does not exist.

- [ ] **Step 3: Implement catalog parser and merge**

Create `packages/scripts/audio/audio-catalog.ts`:

```ts
import YAML from "yaml";
import type { SoundPlanDiagnostic, SoundPlanEntry } from "./types";

export type AudioCatalogEntry = {
  prompt: string;
  loop: boolean;
};

export type AudioCatalog = {
  bgm: Record<string, AudioCatalogEntry>;
  bgs: Record<string, AudioCatalogEntry>;
  sfx: Record<string, AudioCatalogEntry>;
};

export type ParseAudioCatalogResult =
  | { ok: true; value: AudioCatalog }
  | { ok: false; diagnostics: SoundPlanDiagnostic[] };

export function parseAudioCatalogText(
  text: string,
  path: string,
): ParseAudioCatalogResult {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "audioCatalogYamlInvalid",
          path,
          message: `${path}: ${(error as Error).message}`,
        },
      ],
    };
  }
  const record = isRecord(raw) ? raw : {};
  return {
    ok: true,
    value: {
      bgm: coerceMap(record.bgm),
      bgs: coerceMap(record.bgs),
      sfx: coerceMap(record.sfx),
    },
  };
}

export function serializeAudioCatalog(catalog: AudioCatalog): string {
  return YAML.stringify({
    bgm: catalog.bgm,
    bgs: catalog.bgs,
    sfx: catalog.sfx,
  });
}

export function mergeApprovedEntriesIntoCatalog(
  catalog: AudioCatalog,
  entries: SoundPlanEntry[],
): { catalog: AudioCatalog; diagnostics: SoundPlanDiagnostic[] } {
  const next: AudioCatalog = {
    bgm: { ...catalog.bgm },
    bgs: { ...catalog.bgs },
    sfx: { ...catalog.sfx },
  };
  const diagnostics: SoundPlanDiagnostic[] = [];
  for (const entry of entries) {
    if (entry.status !== "approved" && entry.status !== "generated") continue;
    const target = next[entry.channel];
    const current = target[entry.id];
    const incoming = { prompt: entry.prompt, loop: entry.loop };
    if (current) {
      if (current.prompt !== incoming.prompt || current.loop !== incoming.loop) {
        diagnostics.push({
          code: "audioCatalogDuplicateConflict",
          path: `${entry.channel}.${entry.id}`,
          message: `Catalog entry ${entry.channel}.${entry.id} already exists with different prompt or loop.`,
        });
      }
      continue;
    }
    target[entry.id] = incoming;
  }
  return { catalog: next, diagnostics };
}

function coerceMap(raw: unknown): Record<string, AudioCatalogEntry> {
  if (!isRecord(raw)) return {};
  const out: Record<string, AudioCatalogEntry> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    out[id] = {
      prompt: typeof value.prompt === "string" ? value.prompt : "",
      loop: typeof value.loop === "boolean" ? value.loop : true,
    };
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run catalog tests**

Run:

```bash
bunx vitest run packages/scripts/audio/audio-catalog.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit catalog merge**

Run:

```bash
git add packages/scripts/audio/audio-catalog.ts packages/scripts/audio/audio-catalog.test.ts
git commit -m "feat(audio): merge approved sounds into catalog"
```

## Task 5: Index Chapter Visual Units

**Files:**
- Create: `packages/scripts/audio/visual-units.ts`
- Create: `packages/scripts/audio/visual-units.test.ts`

- [ ] **Step 1: Write visual-unit tests**

Create `packages/scripts/audio/visual-units.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { indexVisualUnitsFromMarkdown } from "./visual-units";

describe("visual unit indexing", () => {
  it("indexes linear scene tags as tag_001 and tag_002", () => {
    const units = indexVisualUnitsFromMarkdown(
      "scene_6.md",
      "# Scene 6\n\n[場景：街道，雨。]\n- **Background Prompt:** Rain.\n\n**相馬律**：走吧。\n\n[場景：便利店門口，雨。]\n- **Background Prompt:** Store.\n",
    );
    expect(units.map((unit) => unit.id)).toEqual(["tag_001", "tag_002"]);
    expect(units[0]).toMatchObject({ file: "scene_6.md", line: 3 });
  });

  it("indexes investigation sub-location ids", () => {
    const units = indexVisualUnitsFromMarkdown(
      "investigation_scene_3.md",
      "# Scene 3\n\n## Intro\n\n[場景：雨鐘外。]\n- **Background Prompt:** Exterior.\n\n## Sub-location: 雨鐘前場 {#front}\n- **Status:** unlocked\n- **Background Prompt:** Front room.\n\n[場景：前場。]\n",
    );
    expect(units.map((unit) => unit.id)).toEqual(["tag_001", "front"]);
    expect(units[1]).toMatchObject({ line: 8, metadataInsertLine: 10 });
  });

  it("indexes interrogation phase ids", () => {
    const units = indexVisualUnitsFromMarkdown(
      "interrogation_scene_4.md",
      "# Scene 4\n\n## Intro\n\n[場景：等待區。]\n- **Background Prompt:** Waiting.\n\n## Phase: 問題確認 {#ask_miyake}\n- **Kind:** inquiry\n- **Required:** true\n- **Background Prompt:** Room.\n",
    );
    expect(units.map((unit) => unit.id)).toEqual(["tag_001", "ask_miyake"]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bunx vitest run packages/scripts/audio/visual-units.test.ts
```

Expected: FAIL because `visual-units.ts` does not exist.

- [ ] **Step 3: Implement visual-unit indexing**

Create `packages/scripts/audio/visual-units.ts`:

```ts
export type VisualUnitIndex = {
  id: string;
  file: string;
  line: number;
  metadataInsertLine: number;
  existingBgm?: string;
  existingBgs?: string;
};

const SCENE_TAG_RE = /^\[場景：/;
const BLOCK_ID_RE = /\{#([a-zA-Z0-9_-]+)\}\s*$/;

export function indexVisualUnitsFromMarkdown(
  file: string,
  source: string,
): VisualUnitIndex[] {
  const lines = source.split(/\r?\n/);
  const units: VisualUnitIndex[] = [];
  let tagCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (SCENE_TAG_RE.test(line.trim())) {
      tagCount += 1;
      const metadata = scanMetadata(lines, i + 1);
      units.push({
        id: `tag_${String(tagCount).padStart(3, "0")}`,
        file,
        line: i + 1,
        metadataInsertLine: metadata.insertLine,
        existingBgm: metadata.bgm,
        existingBgs: metadata.bgs,
      });
      continue;
    }
    if (line.startsWith("## Sub-location:") || line.startsWith("## Phase:")) {
      const id = BLOCK_ID_RE.exec(line)?.[1];
      if (!id) continue;
      const metadata = scanMetadata(lines, i + 1);
      units.push({
        id,
        file,
        line: i + 1,
        metadataInsertLine: metadata.insertLine,
        existingBgm: metadata.bgm,
        existingBgs: metadata.bgs,
      });
    }
  }
  return dedupeIntroTagsForInteractiveFiles(file, units);
}

function scanMetadata(lines: string[], startIndex: number) {
  let insertLine = startIndex + 1;
  let bgm: string | undefined;
  let bgs: string | undefined;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.startsWith("- **")) break;
    insertLine = i + 2;
    const bgmMatch = /^- \*\*BGM:\*\*\s*(.+?)\s*$/.exec(line);
    const bgsMatch = /^- \*\*BGS:\*\*\s*(.+?)\s*$/.exec(line);
    if (bgmMatch) bgm = bgmMatch[1];
    if (bgsMatch) bgs = bgsMatch[1];
  }
  return { insertLine, bgm, bgs };
}

function dedupeIntroTagsForInteractiveFiles(
  file: string,
  units: VisualUnitIndex[],
): VisualUnitIndex[] {
  if (
    file.includes("investigation_scene_") ||
    file.includes("interrogation_scene_")
  ) {
    return units;
  }
  return units;
}
```

- [ ] **Step 4: Run visual-unit tests**

Run:

```bash
bunx vitest run packages/scripts/audio/visual-units.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit visual-unit index**

Run:

```bash
git add packages/scripts/audio/visual-units.ts packages/scripts/audio/visual-units.test.ts
git commit -m "feat(audio): index markdown visual units"
```

## Task 6: Apply Approved Catalog Entries And BGM/BGS Cues

**Files:**
- Create: `packages/scripts/audio/apply.ts`
- Create: `packages/scripts/audio/apply.test.ts`

- [ ] **Step 1: Write apply tests**

Create `packages/scripts/audio/apply.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyAudioCuesToMarkdown } from "./apply";

describe("audio apply", () => {
  it("inserts BGM and BGS after existing background prompt", () => {
    const source = "# Scene 6\n\n[場景：街道，雨。]\n- **Background Prompt:** Rain street.\n\n**相馬律**：走吧。\n";
    const result = applyAudioCuesToMarkdown("scene_6.md", source, [
      {
        file: "scene_6.md",
        visualUnit: "tag_001",
        bgm: "low_tension",
        bgs: "rain_street_light",
      },
    ]);
    expect(result.changed).toBe(true);
    expect(result.source).toContain(
      "- **Background Prompt:** Rain street.\n- **BGM:** low_tension\n- **BGS:** rain_street_light",
    );
  });

  it("updates existing BGM and preserves BGS", () => {
    const source = "# Scene 0\n\n[場景：黑底。]\n- **Background Prompt:** Black UI.\n- **BGM:** none\n- **BGS:** none\n";
    const result = applyAudioCuesToMarkdown("scene_0.md", source, [
      {
        file: "scene_0.md",
        visualUnit: "tag_001",
        bgm: "low_tension",
      },
    ]);
    expect(result.source).toContain("- **BGM:** low_tension\n- **BGS:** none");
  });

  it("reports unknown visual units", () => {
    const result = applyAudioCuesToMarkdown("scene_6.md", "# Scene 6\n", [
      {
        file: "scene_6.md",
        visualUnit: "tag_001",
        bgs: "rain_street_light",
      },
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "audioApplyUnknownVisualUnit" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bunx vitest run packages/scripts/audio/apply.test.ts
```

Expected: FAIL because `apply.ts` does not exist.

- [ ] **Step 3: Implement markdown cue application**

Create `packages/scripts/audio/apply.ts`:

```ts
import type { SoundPlanCue, SoundPlanDiagnostic } from "./types";
import { indexVisualUnitsFromMarkdown } from "./visual-units";

export type ApplyMarkdownResult = {
  source: string;
  changed: boolean;
  diagnostics: SoundPlanDiagnostic[];
};

export function applyAudioCuesToMarkdown(
  file: string,
  source: string,
  cues: SoundPlanCue[],
): ApplyMarkdownResult {
  const relevant = cues.filter((cue) => cue.file === file);
  if (relevant.length === 0) {
    return { source, changed: false, diagnostics: [] };
  }
  const diagnostics: SoundPlanDiagnostic[] = [];
  const units = new Map(
    indexVisualUnitsFromMarkdown(file, source).map((unit) => [unit.id, unit]),
  );
  let lines = source.split(/\r?\n/);
  let changed = false;
  const sorted = [...relevant].sort((a, b) => {
    const unitA = units.get(a.visualUnit);
    const unitB = units.get(b.visualUnit);
    return (unitB?.metadataInsertLine ?? 0) - (unitA?.metadataInsertLine ?? 0);
  });
  for (const cue of sorted) {
    const unit = units.get(cue.visualUnit);
    if (!unit) {
      diagnostics.push({
        code: "audioApplyUnknownVisualUnit",
        path: `${file}:${cue.visualUnit}`,
        message: `Audio cue targets unknown visual unit "${cue.visualUnit}" in ${file}.`,
      });
      continue;
    }
    const before = lines.join("\n");
    lines = applyCueAtUnit(lines, unit.metadataInsertLine, cue);
    const after = lines.join("\n");
    changed = changed || before !== after;
  }
  return { source: lines.join("\n"), changed, diagnostics };
}

function applyCueAtUnit(
  lines: string[],
  insertLineOneBased: number,
  cue: SoundPlanCue,
): string[] {
  const out = [...lines];
  const start = Math.max(0, insertLineOneBased - 1);
  const metadataStart = findMetadataStart(out, start);
  const metadataEnd = findMetadataEnd(out, metadataStart);
  const block = out.slice(metadataStart, metadataEnd);
  const nextBlock = setMetadataValue(block, "BGM", cue.bgm);
  const finalBlock = setMetadataValue(nextBlock, "BGS", cue.bgs);
  out.splice(metadataStart, metadataEnd - metadataStart, ...finalBlock);
  return out;
}

function findMetadataStart(lines: string[], preferred: number): number {
  let i = preferred;
  while (i > 0 && lines[i - 1]?.startsWith("- **")) i -= 1;
  return i;
}

function findMetadataEnd(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length && (lines[i] ?? "").startsWith("- **")) i += 1;
  return i;
}

function setMetadataValue(
  block: string[],
  key: "BGM" | "BGS",
  value: string | undefined,
): string[] {
  if (value === undefined) return block;
  const line = `- **${key}:** ${value}`;
  const index = block.findIndex((item) => item.startsWith(`- **${key}:**`));
  if (index >= 0) {
    const copy = [...block];
    copy[index] = line;
    return copy;
  }
  const backgroundIndex = block.findIndex((item) =>
    item.startsWith("- **Background Prompt:**"),
  );
  const insertAt = backgroundIndex >= 0 ? backgroundIndex + 1 : block.length;
  const copy = [...block];
  copy.splice(insertAt, 0, line);
  return copy;
}
```

- [ ] **Step 4: Run apply tests**

Run:

```bash
bunx vitest run packages/scripts/audio/apply.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit markdown cue application**

Run:

```bash
git add packages/scripts/audio/apply.ts packages/scripts/audio/apply.test.ts
git commit -m "feat(audio): apply approved cues to markdown"
```

## Task 7: Add Audio CLI Commands

**Files:**
- Create: `packages/scripts/audio/cli.ts`
- Modify: `packages/scripts/package.json`
- Modify: `package.json`

- [ ] **Step 1: Add command scripts**

Modify `packages/scripts/package.json`:

```json
{
  "scripts": {
    "audio:validate": "bun run audio/cli.ts validate",
    "audio:apply": "bun run audio/cli.ts apply",
    "audio:generate": "bun run audio/cli.ts generate"
  }
}
```

Merge these keys with the existing package scripts from Task 1.

Modify root `package.json`:

```json
{
  "scripts": {
    "audio:validate": "bun run --cwd packages/scripts audio:validate",
    "audio:apply": "bun run --cwd packages/scripts audio:apply",
    "audio:generate": "bun run --cwd packages/scripts audio:generate"
  }
}
```

- [ ] **Step 2: Implement validate/apply dispatch**

Create `packages/scripts/audio/cli.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSoundPlanText, validateSoundPlan } from "./sound-plan";
import {
  mergeApprovedEntriesIntoCatalog,
  parseAudioCatalogText,
  serializeAudioCatalog,
} from "./audio-catalog";
import { applyAudioCuesToMarkdown } from "./apply";

const [, , command, ...args] = process.argv;

if (command === "validate") {
  const planPath = requireArg(args[0], "Usage: audio:validate <plan.yaml>");
  const plan = loadPlan(planPath);
  const diagnostics = validateSoundPlan(plan);
  exitWithDiagnostics(diagnostics);
  console.log(`[audio] ${planPath} OK`);
} else if (command === "apply") {
  const check = args.includes("--check");
  const planPath = requireArg(
    args.find((arg) => !arg.startsWith("--")),
    "Usage: audio:apply <plan.yaml> [--check]",
  );
  const plan = loadPlan(planPath);
  const diagnostics = validateSoundPlan(plan);
  exitWithDiagnostics(diagnostics);

  const catalogPath = resolve(process.cwd(), "static/assets/config/audio.yaml");
  const catalogText = readFileSync(catalogPath, "utf-8");
  const parsedCatalog = parseAudioCatalogText(catalogText, catalogPath);
  if (!parsedCatalog.ok) exitWithDiagnostics(parsedCatalog.diagnostics);
  const merged = mergeApprovedEntriesIntoCatalog(
    parsedCatalog.value,
    plan.entries,
  );
  exitWithDiagnostics(merged.diagnostics);
  const nextCatalogText = serializeAudioCatalog(merged.catalog);
  let changed = nextCatalogText !== catalogText;
  if (!check && changed) writeFileSync(catalogPath, nextCatalogText);

  const cuesByFile = new Map<string, typeof plan.cues>();
  for (const cue of plan.cues) {
    cuesByFile.set(cue.file, [...(cuesByFile.get(cue.file) ?? []), cue]);
  }
  for (const [file, cues] of cuesByFile) {
    const fullPath = resolve(process.cwd(), file);
    const source = readFileSync(fullPath, "utf-8");
    const result = applyAudioCuesToMarkdown(file, source, cues);
    exitWithDiagnostics(result.diagnostics);
    changed = changed || result.changed;
    if (!check && result.changed) writeFileSync(fullPath, result.source);
  }
  if (check && changed) {
    console.error("[audio] approved plan is not applied");
    process.exit(2);
  }
  console.log(check ? "[audio] apply check OK" : "[audio] apply OK");
} else if (command === "generate") {
  const { runGenerateCommand } = await import("./generate");
  await runGenerateCommand(args);
} else {
  console.error("Usage: audio/cli.ts <validate|apply|generate> ...");
  process.exit(2);
}

function loadPlan(planPath: string) {
  const fullPath = resolve(process.cwd(), planPath);
  const parsed = parseSoundPlanText(readFileSync(fullPath, "utf-8"), planPath);
  if (!parsed.ok) exitWithDiagnostics(parsed.diagnostics);
  return parsed.value;
}

function requireArg(value: string | undefined, message: string): string {
  if (!value) {
    console.error(message);
    process.exit(2);
  }
  return value;
}

function exitWithDiagnostics(diagnostics: Array<{ code: string; message: string }>): never | void {
  if (diagnostics.length === 0) return;
  for (const diagnostic of diagnostics) {
    console.error(`[${diagnostic.code}] ${diagnostic.message}`);
  }
  process.exit(2);
}
```

- [ ] **Step 3: Add a minimal sample validation run**

Run:

```bash
bun run audio:validate docs/audio_plans/missing.sound-plan.yaml
```

Expected: FAIL with a file-read error because no plan exists yet. This confirms command routing reaches the package. Do not commit a sample plan for this step.

- [ ] **Step 4: Commit CLI validation/apply commands**

Run:

```bash
git add package.json packages/scripts/package.json packages/scripts/audio/cli.ts
git commit -m "feat(audio): add plan validate and apply commands"
```

## Task 8: Add ElevenLabs Generation Command

**Files:**
- Create: `packages/scripts/audio/elevenlabs-client.ts`
- Create: `packages/scripts/audio/elevenlabs-client.test.ts`
- Create: `packages/scripts/audio/audio-files.ts`
- Create: `packages/scripts/audio/audio-files.test.ts`
- Create: `packages/scripts/audio/generate.ts`
- Create: `packages/scripts/audio/generate.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write provider request tests**

Create `packages/scripts/audio/elevenlabs-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createElevenLabsClient } from "./elevenlabs-client";

describe("ElevenLabs client", () => {
  it("posts BGM requests to the music endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createElevenLabsClient({
      apiKey: "test-key",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(new Uint8Array([1, 2, 3]));
      },
    });
    const audio = await client.generate({
      id: "low_tension",
      channel: "bgm",
      prompt: "Sparse instrumental detective cue.",
      loop: true,
      intendedDurationSeconds: 12,
      forceInstrumental: true,
    });
    expect(audio.byteLength).toBe(3);
    expect(calls[0]?.url).toContain("/v1/music");
    expect(calls[0]?.init.headers).toMatchObject({ "xi-api-key": "test-key" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      prompt: "Sparse instrumental detective cue.",
      music_length_ms: 12000,
      force_instrumental: true,
    });
  });

  it("posts BGS and SFX requests to the sound-generation endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createElevenLabsClient({
      apiKey: "test-key",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(new Uint8Array([4, 5, 6]));
      },
    });
    await client.generate({
      id: "rain_street_light",
      channel: "bgs",
      prompt: "Loopable rain.",
      loop: true,
      intendedDurationSeconds: 30,
    });
    expect(calls[0]?.url).toContain("/v1/sound-generation");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      text: "Loopable rain.",
      loop: true,
      duration_seconds: 30,
      model_id: "eleven_text_to_sound_v2",
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bunx vitest run packages/scripts/audio/elevenlabs-client.test.ts
```

Expected: FAIL because `elevenlabs-client.ts` does not exist.

- [ ] **Step 3: Implement provider client**

Create `packages/scripts/audio/elevenlabs-client.ts`:

```ts
import type { SoundPlanChannel } from "./types";

export type ElevenLabsGenerateRequest = {
  id: string;
  channel: SoundPlanChannel;
  prompt: string;
  loop: boolean;
  intendedDurationSeconds: number;
  forceInstrumental?: boolean;
};

export type ElevenLabsClient = {
  generate(request: ElevenLabsGenerateRequest): Promise<Uint8Array>;
};

export function createElevenLabsClient(input: {
  apiKey: string;
  fetch?: typeof fetch;
}): ElevenLabsClient {
  const fetchImpl = input.fetch ?? fetch;
  return {
    async generate(request) {
      const isMusic = request.channel === "bgm";
      const url = isMusic
        ? "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128"
        : "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128";
      const body = isMusic
        ? {
            prompt: request.prompt,
            music_length_ms: Math.round(request.intendedDurationSeconds * 1000),
            force_instrumental: request.forceInstrumental ?? true,
          }
        : {
            text: request.prompt,
            loop: request.loop,
            duration_seconds: request.intendedDurationSeconds,
            prompt_influence: 0.3,
            model_id: "eleven_text_to_sound_v2",
          };
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": input.apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `ElevenLabs ${request.channel} generation failed for ${request.id}: ${response.status} ${response.statusText}`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
```

This matches the official docs checked during planning:

- `POST https://api.elevenlabs.io/v1/music`
- `POST https://api.elevenlabs.io/v1/sound-generation`

- [ ] **Step 4: Write generate dry-run tests**

Create `packages/scripts/audio/audio-files.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeGeneratedAudioFile } from "./audio-files";

describe("audio file writing", () => {
  it("stages provider bytes and writes converted ogg output", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "lyra-audio-files-"));
    const calls: Array<{ inputPath: string; outputPath: string }> = [];
    await writeGeneratedAudioFile({
      repoRoot: root,
      channel: "bgs",
      id: "rain_street_light",
      providerBytes: new Uint8Array([1, 2, 3]),
      convert: async ({ inputPath, outputPath }) => {
        calls.push({ inputPath, outputPath });
        writeFileSync(outputPath, new Uint8Array([4, 5, 6]));
      },
    });
    const outputPath = resolve(
      root,
      "static/assets/audio/bgs/rain_street_light.ogg",
    );
    expect(calls[0]?.inputPath).toContain("packages/scripts/.audio-cache");
    expect(calls[0]?.outputPath).toBe(outputPath);
    expect([...readFileSync(outputPath)]).toEqual([4, 5, 6]);
  });

  it("creates parent directories for final output", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "lyra-audio-files-"));
    await writeGeneratedAudioFile({
      repoRoot: root,
      channel: "sfx",
      id: "plastic_bag_crinkle",
      providerBytes: new Uint8Array([1]),
      convert: async ({ outputPath }) => {
        writeFileSync(outputPath, new Uint8Array([7]));
      },
    });
    expect(
      existsSync(resolve(root, "static/assets/audio/sfx/plastic_bag_crinkle.ogg")),
    ).toBe(true);
  });
});
```

Create `packages/scripts/audio/generate.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planGeneration } from "./generate";

describe("audio generation planning", () => {
  it("lists approved missing outputs in dry-run mode", () => {
    const root = mkdtempSync(resolve(tmpdir(), "lyra-audio-generate-"));
    const planPath = resolve(root, "chapter_1.sound-plan.yaml");
    writeFileSync(
      planPath,
      `schemaVersion: 1
chapterId: chapter_1
sources: []
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries:
  - id: rain_street_light
    channel: bgs
    status: approved
    loop: true
    intendedDurationSeconds: 30
    prompt: Loopable rain.
    reuseRationale: Rain pool.
    evidence:
      - file: docs/stories_plan/chapter_1/scene_6.md
        line: 3
        note: rain
cues: []
rejected: []
`,
    );
    const result = planGeneration({
      repoRoot: root,
      planPath,
      dryRun: true,
      force: false,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.toGenerate[0]?.outputPath).toBe(
      "static/assets/audio/bgs/rain_street_light.ogg",
    );
  });

  it("rejects generation without ELEVENLABS_API_KEY when not dry-run", () => {
    const root = mkdtempSync(resolve(tmpdir(), "lyra-audio-generate-"));
    const planPath = resolve(root, "empty.sound-plan.yaml");
    writeFileSync(
      planPath,
      `schemaVersion: 1
chapterId: chapter_1
sources: []
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries: []
cues: []
rejected: []
`,
    );
    const result = planGeneration({
      repoRoot: root,
      planPath,
      dryRun: false,
      force: false,
      apiKey: "",
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "audioGenerateMissingApiKey" }),
    );
  });
});
```

- [ ] **Step 5: Implement audio file staging and conversion**

Create `packages/scripts/audio/audio-files.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SoundPlanChannel } from "./types";

export type AudioConvertInput = {
  inputPath: string;
  outputPath: string;
};

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
  await (input.convert ?? convertWithFfmpeg)({ inputPath: rawPath, outputPath });
  return { rawPath, outputPath };
}

export async function convertWithFfmpeg({
  inputPath,
  outputPath,
}: AudioConvertInput): Promise<void> {
  const proc = Bun.spawn(
    ["ffmpeg", "-y", "-i", inputPath, "-vn", "-c:a", "libvorbis", outputPath],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg failed converting ${inputPath}: ${stderr}`);
  }
}
```

This makes `ffmpeg` a runtime prerequisite only for real generation. Unit tests inject `convert`, so normal tests do not require `ffmpeg`.

- [ ] **Step 6: Implement generation planner and command**

Create `packages/scripts/audio/generate.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseSoundPlanText, validateSoundPlan } from "./sound-plan";
import { createElevenLabsClient } from "./elevenlabs-client";
import { writeGeneratedAudioFile } from "./audio-files";
import type { SoundPlanDiagnostic, SoundPlanEntry } from "./types";

export type GenerationTarget = {
  entry: SoundPlanEntry;
  outputPath: string;
};

export function planGeneration(input: {
  repoRoot: string;
  planPath: string;
  dryRun: boolean;
  force: boolean;
  only?: string;
  apiKey?: string;
}): { diagnostics: SoundPlanDiagnostic[]; toGenerate: GenerationTarget[] } {
  const parsed = parseSoundPlanText(
    readFileSync(input.planPath, "utf-8"),
    input.planPath,
  );
  if (!parsed.ok) return { diagnostics: parsed.diagnostics, toGenerate: [] };
  const diagnostics = validateSoundPlan(parsed.value);
  if (!input.dryRun && !input.apiKey) {
    diagnostics.push({
      code: "audioGenerateMissingApiKey",
      path: "ELEVENLABS_API_KEY",
      message: "ELEVENLABS_API_KEY is required unless --dry-run is used.",
    });
  }
  const toGenerate = parsed.value.entries
    .filter((entry) => entry.status === "approved" || entry.status === "generated")
    .filter((entry) => !input.only || entry.id === input.only)
    .map((entry) => ({
      entry,
      outputPath: `static/assets/audio/${entry.channel}/${entry.id}.ogg`,
    }))
    .filter(
      (target) =>
        input.force || !existsSync(resolve(input.repoRoot, target.outputPath)),
    );
  return { diagnostics, toGenerate };
}

export async function runGenerateCommand(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const onlyIndex = args.indexOf("--only");
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;
  const planPath = args.find((arg) => !arg.startsWith("--") && arg !== only);
  if (!planPath) {
    console.error("Usage: audio:generate <plan.yaml> [--dry-run] [--only <id>] [--force]");
    process.exit(2);
  }
  const repoRoot = process.cwd();
  const planned = planGeneration({
    repoRoot,
    planPath: resolve(repoRoot, planPath),
    dryRun,
    force,
    only,
    apiKey: process.env.ELEVENLABS_API_KEY,
  });
  if (planned.diagnostics.length > 0) {
    for (const diagnostic of planned.diagnostics) {
      console.error(`[${diagnostic.code}] ${diagnostic.message}`);
    }
    process.exit(2);
  }
  if (dryRun) {
    for (const target of planned.toGenerate) {
      console.log(`[audio] would generate ${target.outputPath}`);
    }
    return;
  }
  const client = createElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY ?? "",
  });
  for (const target of planned.toGenerate) {
    const bytes = await client.generate({
      id: target.entry.id,
      channel: target.entry.channel,
      prompt: target.entry.prompt,
      loop: target.entry.loop,
      intendedDurationSeconds: target.entry.intendedDurationSeconds,
    });
    await writeGeneratedAudioFile({
      repoRoot,
      channel: target.entry.channel,
      id: target.entry.id,
      providerBytes: bytes,
    });
    console.log(
      `[audio] wrote ${target.outputPath} (${hashBytes(bytes).slice(0, 12)})`,
    );
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
```

- [ ] **Step 7: Ignore the package audio cache**

Add this to `.gitignore`:

```gitignore
packages/scripts/.audio-cache/
```

- [ ] **Step 8: Run generation tests**

Run:

```bash
bunx vitest run packages/scripts/audio/elevenlabs-client.test.ts packages/scripts/audio/audio-files.test.ts packages/scripts/audio/generate.test.ts
bun run audio:generate docs/audio_plans/missing.sound-plan.yaml --dry-run
```

Expected:

- provider tests pass with mocked fetch;
- generation planner tests pass;
- dry-run command reaches the CLI and fails only because the plan file is missing.

- [ ] **Step 9: Commit generation command**

Run:

```bash
git add packages/scripts/audio/elevenlabs-client.ts packages/scripts/audio/elevenlabs-client.test.ts packages/scripts/audio/audio-files.ts packages/scripts/audio/audio-files.test.ts packages/scripts/audio/generate.ts packages/scripts/audio/generate.test.ts .gitignore
git commit -m "feat(audio): add elevenlabs generation command"
```

## Task 9: Add Lyra Sound-Design Skill

**Files:**
- Create: `.claude/skills/designing-lyra-sound-assets/SKILL.md`

- [ ] **Step 1: Create the skill**

Create `.claude/skills/designing-lyra-sound-assets/SKILL.md`:

```markdown
---
name: designing-lyra-sound-assets
description: Use when designing Chapter-level BGM, BGS, or SFX plans for Lyra story markdown before audio catalog updates or ElevenLabs generation.
---

# Designing Lyra Sound Assets

## Purpose

Create or update durable sound plans for Lyra chapters. This skill is plan-first:
it decides what sounds should exist, what existing sounds can be reused, and
where approved `BGM` / `BGS` cues should apply. It never calls ElevenLabs and it
does not edit scene markdown directly.

## Inputs To Read

For one chapter:

- `docs/stories_plan/chapter_<N>/chapter.md`
- every scene file listed in that manifest
- `static/assets/config/audio.yaml`
- existing files under `static/assets/audio/**`
- `docs/audio_plans/chapter_<N>.sound-plan.yaml` if it already exists

## Output

Write or update:

```text
docs/audio_plans/chapter_<N>.sound-plan.yaml
```

The plan must include:

- `schemaVersion: 1`
- `chapterId`
- `sources`
- `catalogSnapshot`
- `entries`
- `cues`
- `rejected`

Every proposed entry needs:

- snake_case `id`
- `channel`: `bgm`, `bgs`, or `sfx`
- `status`: usually `proposed`; use `approved` only if the user explicitly approved
- `loop`
- `intendedDurationSeconds`
- English generation `prompt`
- `reuseRationale`
- scene evidence with file and line number

## Sound Rules

- `BGM` is sparse and chapter-palette-driven.
- `BGM` changes only at major story beats.
- `BGS` is a location or mood pool.
- `BGS` changes only when the acoustic environment meaningfully changes.
- `SFX` is only for brief actions that are narratively emphasized, repeated, or
  useful as player feedback.
- Stage directions are evidence, not automatic sound requests.
- Prefer existing `audio.yaml` entries and existing files before proposing new
  generation.
- List rejected incidental sounds so later agents do not re-propose them.

## Boundaries

- Do not run `audio:generate`.
- Do not call ElevenLabs.
- Do not edit scene markdown.
- Do not add `SFX` cues to scene markdown in v1.
- Writers author sound intent and prompts, never filesystem paths.

## Verification

After writing a plan, run:

```bash
bun run audio:validate docs/audio_plans/chapter_<N>.sound-plan.yaml
```

Report validation results and any entries that still need human approval.
```

- [ ] **Step 2: Validate skill markdown formatting**

Run:

```bash
prettier --check .claude/skills/designing-lyra-sound-assets/SKILL.md
```

Expected: PASS or a clear formatting diff. If Prettier reports a diff, run:

```bash
prettier --write .claude/skills/designing-lyra-sound-assets/SKILL.md
```

- [ ] **Step 3: Commit sound-design skill**

Run:

```bash
git add .claude/skills/designing-lyra-sound-assets/SKILL.md
git commit -m "docs(audio): add sound design skill"
```

## Task 10: Update Active Docs And Verify End-to-End

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md` through the existing symlink behavior
- Modify: `.claude/skills/generating-lyra-image-assets/SKILL.md` only if it references old compiler fixture paths
- Modify: `.claude/skills/reviewing-story-scenes/SKILL.md` only if it references old compiler resource paths or script paths inaccurately
- Modify: docs/specs or plans only when they describe active commands rather than historical implementation

- [ ] **Step 1: Find stale active references**

Run:

```bash
rg -n "scripts/|packages/scripts|audio:validate|audio:apply|audio:generate|designing-lyra-sound-assets" CLAUDE.md AGENTS.md .claude docs/superpowers/specs/2026-06-21-audio-workflow-design.md
```

Expected: active guidance should mention `packages/scripts` for implementation paths and root commands for user-facing commands. Historical specs may keep old paths when they describe old designs.

- [ ] **Step 2: Update `CLAUDE.md` command guidance**

In `CLAUDE.md`, update the scene pipeline and commands sections so they say:

```markdown
- `bun run scenes:compile` - one-shot compile through `@lyra/scripts`.
- `bun run scenes:watch` - watch authored scene Markdown and asset YAML through `@lyra/scripts`.
- `bun run audio:validate <plan>` - validate a durable sound plan.
- `bun run audio:apply <plan> [--check]` - apply approved BGM/BGS cues and catalog entries without network access.
- `bun run audio:generate <plan> [--dry-run] [--only <id>] [--force]` - explicitly generate approved audio through ElevenLabs.
```

Also update compiler unit-test fixture guidance from `scripts/__fixtures__/` to `packages/scripts/__fixtures__/`.

- [ ] **Step 3: Run full verification**

Run:

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/audio/sound-plan.test.ts packages/scripts/audio/audio-catalog.test.ts packages/scripts/audio/visual-units.test.ts packages/scripts/audio/apply.test.ts packages/scripts/audio/elevenlabs-client.test.ts packages/scripts/audio/generate.test.ts
bun run test:scripts
bun run scenes:compile
bun run audio:generate docs/audio_plans/missing.sound-plan.yaml --dry-run
```

Expected:

- focused audio tests pass;
- script test suite passes;
- scene compilation succeeds;
- dry-run generation reaches the CLI and fails with a missing plan file, not with missing package wiring.

- [ ] **Step 4: Confirm no root script call sites remain**

Run:

```bash
rg -n "bun run scripts/|scripts/compile-scenes|scripts/__fixtures__|scripts/__snapshots__" package.json apps packages .claude CLAUDE.md AGENTS.md docs
```

Expected: no hits in active commands, active skills, app packages, or package source. Historical specs and old plans may still reference old paths if they describe past work; do not rewrite historical plans just to remove old path strings.

- [ ] **Step 5: Commit docs and final verification fixes**

Run:

```bash
git add CLAUDE.md AGENTS.md .claude packages/scripts package.json apps/game/package.json apps/layout-editor/package.json vitest.scripts.config.ts tsconfig.scripts.json packages/asset-paths/src/index.ts apps/game/src/lib/assets/story-assets.test.ts docs/audio_plans .gitignore
git commit -m "docs(audio): document scripts package audio workflow"
```

If there are no doc changes after verification, skip the commit and record that the working tree is clean.

## Final Verification Checklist

- [ ] `git status --short` shows only intentional generated files or is clean.
- [ ] `bun run test:scripts` passes.
- [ ] `bun run scenes:compile` passes.
- [ ] `bun run audio:validate <real plan>` works once a real plan exists.
- [ ] `bun run audio:apply <real plan> --check` reports drift or OK deterministically once a real plan exists.
- [ ] `bun run audio:generate <real plan> --dry-run` lists approved missing outputs without network access once a real plan exists.
- [ ] `rg -n "scripts/" package.json apps packages .claude CLAUDE.md AGENTS.md` has no stale active root-script references.

## Implementation Notes

- Do not generate paid audio during normal implementation or tests.
- Do not add runtime audio playback in this plan.
- Do not write SFX cues into scene markdown.
- Do not hand-edit generated JSON under `apps/game/src-tauri/resources/**`.
- Verify ElevenLabs docs again immediately before a live generation run; current planning references are:
  - `https://elevenlabs.io/docs/api-reference/music/compose`
  - `https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert`
