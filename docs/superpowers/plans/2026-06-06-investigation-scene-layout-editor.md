# Investigation Scene Layout Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sidecar-authored investigation scene layouts, render placed
hotspots/people directly on the game scene, and build a separate developer
Tauri editor app for drag-and-resize layout authoring.

**Architecture:** Keep the game production bundle clean: the game consumes only
compiled scene/layout JSON and contains no editor commands. Layout sidecars live
beside authored investigation Markdown, the compiler validates and merges them
into runtime scene JSON, and a separate `apps/layout-editor` Tauri app owns
sidecar file writes.

**Tech Stack:** Bun TypeScript scene compiler and Vitest tests, Rust serde/Tauri
runtime, Svelte 5 frontend components, Playwright browser-safe E2E, separate
Tauri 2/Svelte editor app.

---

## Scope Check

This spec covers three connected surfaces: compiler/runtime contract, game UI,
and a developer editor app. They are not independent enough to split into
separate specs because the editor cannot be useful without the sidecar schema
and the game cannot render placed targets without compiler/runtime support. The
plan still phases them so Task 1-5 produce a working game-side vertical slice
before Task 6-8 add the separate editor app.

## File Structure

Create:

- `scripts/compile-scenes/layout.ts` — parse, validate, normalize, and merge
  `*.layout.json` sidecars into investigation ASTs.
- `scripts/compile-scenes/layout.test.ts` — focused sidecar validation and merge
  coverage.
- `src/lib/components/InvestigationSceneSurface.svelte` — renders background
  plate, placed hotspots, placed characters, and unplaced fallback controls.
- `src/lib/components/InvestigationSceneSurface.test.ts` — component tests for
  normalized coordinate mapping and interaction dispatch.
- `e2e/investigation-layout.spec.ts` — browser-safe smoke for clicking a placed
  hotspot through the visual scene surface.
- `apps/layout-editor/package.json` — developer-only editor package scripts.
- `apps/layout-editor/index.html`
- `apps/layout-editor/vite.config.ts`
- `apps/layout-editor/svelte.config.js`
- `apps/layout-editor/tsconfig.json`
- `apps/layout-editor/src/main.ts`
- `apps/layout-editor/src/App.svelte`
- `apps/layout-editor/src/lib/layout-types.ts`
- `apps/layout-editor/src/lib/layout-store.svelte.ts`
- `apps/layout-editor/src/lib/EditorCanvas.svelte`
- `apps/layout-editor/src/lib/TargetList.svelte`
- `apps/layout-editor/src-tauri/Cargo.toml`
- `apps/layout-editor/src-tauri/tauri.conf.json`
- `apps/layout-editor/src-tauri/capabilities/default.json`
- `apps/layout-editor/src-tauri/src/main.rs`
- `apps/layout-editor/src-tauri/src/lib.rs`

Modify:

- `scripts/compile-scenes/orchestrator.ts` — read optional sidecars before
  validation/enrichment and pass sidecar errors through normal compile errors.
- `scripts/compile-scenes/types.ts` — add layout types to AST/JSON
  investigation targets.
- `scripts/compile-scenes/emitter.ts` — emit layout fields on investigation
  hotspots and characters.
- `scripts/compile-scenes/emitter.test.ts` — assert emitted layout shape.
- `scripts/__fixtures__/valid/chapter_1/investigation_scene_1.layout.json` —
  fixture sidecar for the existing valid investigation scene.
- `src-tauri/src/game/schema.rs` — deserialize compiled layout data.
- `src-tauri/src/game/view.rs` — serialize layout data in public view types.
- `src-tauri/src/game/mod.rs` — include layout fields in `SceneView`.
- `src/lib/state/types.ts` — mirror layout fields in frontend types.
- `src/lib/components/ExploreView.svelte` — replace text-first layout with the
  new scene surface while preserving fallbacks.
- `src/lib/assets/story-assets.ts` — expose a small synchronous path helper for
  editor and runtime reuse if needed.
- `package.json` — add root scripts for editor development without bundling it
  into the game.
- `.gitignore` — ignore editor build/target outputs if they are not already
  covered.

---

### Task 1: Layout Sidecar Parser And Validator

**Files:**

- Create: `scripts/compile-scenes/layout.ts`
- Create: `scripts/compile-scenes/layout.test.ts`
- Modify: `scripts/compile-scenes/types.ts`

- [ ] **Step 1: Add failing sidecar parser tests**

Create `scripts/compile-scenes/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ASTInvestigationScene } from "./types";
import {
  applyInvestigationLayout,
  parseInvestigationLayoutJson,
} from "./layout";

function scene(): ASTInvestigationScene {
  return {
    kind: "investigationScene",
    id: "investigation_scene_1",
    title: "測試調查場景",
    sourceFile: "chapter_1/investigation_scene_1.md",
    line: 1,
    intro: [],
    assetRefs: [],
    evidenceManifest: [],
    statementManifest: [],
    outro: { unlock: "auto", dialogue: [] },
    sublocations: [
      {
        id: "main_hall",
        label: "主廳",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "測試主廳，明亮。",
        assetCue: {
          backgroundPrompt: "Bright detective test hall.",
          backgroundAssetId: "background.chapter_1.investigation_scene_1.sublocation.main_hall",
          bgm: null,
          bgs: null,
        },
        transitionDialogue: [],
        sourceFile: "chapter_1/investigation_scene_1.md",
        line: 10,
        hotspots: [
          {
            id: "table",
            label: "桌面",
            description: "桌上有一只杯子。",
            status: "unlocked",
            unlock: null,
            reveals: [],
            inspectDialogue: [],
            onReexamine: null,
            sourceFile: "chapter_1/investigation_scene_1.md",
            line: 16,
          },
        ],
        characters: [
          {
            id: "witness",
            name: "目擊者",
            role: "店員",
            bio: "緊張的店員。",
            topics: [],
            sourceFile: "chapter_1/investigation_scene_1.md",
            line: 24,
          },
        ],
      },
    ],
  };
}

describe("parseInvestigationLayoutJson", () => {
  it("parses a valid scene layout sidecar", () => {
    const result = parseInvestigationLayoutJson(
      JSON.stringify({
        version: 1,
        sceneId: "investigation_scene_1",
        sublocations: {
          main_hall: {
            hotspots: {
              table: { kind: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
            },
            characters: {
              witness: {
                kind: "sprite",
                assetId: "portrait.witness.standard",
                x: 0.65,
                y: 0.15,
                w: 0.2,
                h: 0.75,
                anchor: "bottomCenter",
              },
            },
          },
        },
      }),
      "chapter_1/investigation_scene_1.layout.json",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sceneId).toBe("investigation_scene_1");
    expect(result.value.sublocations.main_hall.hotspots.table.x).toBe(0.1);
  });

  it("rejects non-finite coordinates", () => {
    const result = parseInvestigationLayoutJson(
      `{
        "version": 1,
        "sceneId": "investigation_scene_1",
        "sublocations": {
          "main_hall": {
            "hotspots": {
              "table": { "kind": "rect", "x": null, "y": 0.2, "w": 0.3, "h": 0.2 }
            },
            "characters": {}
          }
        }
      }`,
      "chapter_1/investigation_scene_1.layout.json",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("layoutInvalidNumber");
  });

  it("rejects zero-size rectangles", () => {
    const result = parseInvestigationLayoutJson(
      JSON.stringify({
        version: 1,
        sceneId: "investigation_scene_1",
        sublocations: {
          main_hall: {
            hotspots: {
              table: { kind: "rect", x: 0.1, y: 0.2, w: 0, h: 0.2 },
            },
            characters: {},
          },
        },
      }),
      "chapter_1/investigation_scene_1.layout.json",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("layoutInvalidSize");
  });
});

describe("applyInvestigationLayout", () => {
  it("attaches hotspot and character layout to matching targets", () => {
    const parsed = parseInvestigationLayoutJson(
      JSON.stringify({
        version: 1,
        sceneId: "investigation_scene_1",
        sublocations: {
          main_hall: {
            hotspots: {
              table: { kind: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
            },
            characters: {
              witness: {
                kind: "sprite",
                assetId: "portrait.witness.standard",
                x: 0.65,
                y: 0.15,
                w: 0.2,
                h: 0.75,
                anchor: "bottomCenter",
              },
            },
          },
        },
      }),
      "chapter_1/investigation_scene_1.layout.json",
    );
    if (!parsed.ok) throw new Error("test layout should parse");

    const result = applyInvestigationLayout(scene(), parsed.value);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sublocations[0]?.hotspots[0]?.layout).toEqual({
      kind: "rect",
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.2,
    });
    expect(result.value.sublocations[0]?.characters[0]?.layout).toEqual({
      kind: "sprite",
      assetId: "portrait.witness.standard",
      x: 0.65,
      y: 0.15,
      w: 0.2,
      h: 0.75,
      anchor: "bottomCenter",
    });
  });

  it("rejects layout for unknown targets", () => {
    const parsed = parseInvestigationLayoutJson(
      JSON.stringify({
        version: 1,
        sceneId: "investigation_scene_1",
        sublocations: {
          main_hall: {
            hotspots: {
              missing_hotspot: {
                kind: "rect",
                x: 0.1,
                y: 0.2,
                w: 0.3,
                h: 0.2,
              },
            },
            characters: {},
          },
        },
      }),
      "chapter_1/investigation_scene_1.layout.json",
    );
    if (!parsed.ok) throw new Error("test layout should parse");

    const result = applyInvestigationLayout(scene(), parsed.value);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("layoutUnknownHotspot");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bun run test scripts/compile-scenes/layout.test.ts
```

Expected: FAIL because `scripts/compile-scenes/layout.ts` does not exist.

- [ ] **Step 3: Add layout types**

Modify `scripts/compile-scenes/types.ts` shared atoms section:

```ts
export type RectLayout = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SpriteLayout = {
  kind: "sprite";
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: "bottomCenter";
};

export type InvestigationLayoutSidecar = {
  version: 1;
  sceneId: string;
  sublocations: Record<
    string,
    {
      hotspots: Record<string, RectLayout>;
      characters: Record<string, SpriteLayout>;
    }
  >;
};
```

Add optional layout fields to existing AST types:

```ts
export type ASTHotspot = Located<{
  id: string;
  label: string;
  description: string;
  status: "locked" | "unlocked";
  unlock: UnlockExpr | null;
  reveals: RevealTarget[];
  inspectDialogue: DialogueItem[];
  onReexamine: DialogueItem[] | null;
  layout?: RectLayout | null;
}>;

export type ASTCharacter = Located<{
  id: string;
  name: string;
  role: string;
  bio: string;
  topics: ASTTopic[];
  layout?: SpriteLayout | null;
}>;
```

Add JSON-facing types near the `JSON*` section:

```ts
export type JSONHotspotLayout = RectLayout;
export type JSONCharacterLayout = SpriteLayout;
```

- [ ] **Step 4: Implement the layout parser and merger**

Create `scripts/compile-scenes/layout.ts`:

```ts
import type {
  ASTInvestigationScene,
  CompileError,
  InvestigationLayoutSidecar,
  RectLayout,
  SpriteLayout,
} from "./types";

type ParseResult =
  | { ok: true; value: InvestigationLayoutSidecar }
  | { ok: false; errors: CompileError[] };

type MergeResult =
  | { ok: true; value: ASTInvestigationScene }
  | { ok: false; errors: CompileError[] };

export function parseInvestigationLayoutJson(
  source: string,
  sourceFile: string,
): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          code: "layoutInvalidJson",
          message: `${sourceFile}: ${(error as Error).message}`,
          sourceFile,
          line: 1,
        },
      ],
    };
  }

  const errors: CompileError[] = [];
  const obj = asRecord(raw);
  if (!obj) {
    return {
      ok: false,
      errors: [
        {
          code: "layoutInvalidRoot",
          message: "Layout sidecar root must be an object.",
          sourceFile,
          line: 1,
        },
      ],
    };
  }

  if (obj.version !== 1) {
    errors.push({
      code: "layoutUnsupportedVersion",
      message: "Layout sidecar version must be 1.",
      sourceFile,
      line: 1,
    });
  }
  if (typeof obj.sceneId !== "string" || obj.sceneId.length === 0) {
    errors.push({
      code: "layoutMissingSceneId",
      message: "Layout sidecar must include a non-empty sceneId.",
      sourceFile,
      line: 1,
    });
  }

  const sublocationsRaw = asRecord(obj.sublocations);
  if (!sublocationsRaw) {
    errors.push({
      code: "layoutMissingSublocations",
      message: "Layout sidecar must include a sublocations object.",
      sourceFile,
      line: 1,
    });
  }

  const sublocations: InvestigationLayoutSidecar["sublocations"] = {};
  if (sublocationsRaw) {
    for (const [sublocationId, subRaw] of Object.entries(sublocationsRaw)) {
      const sub = asRecord(subRaw);
      if (!sub) {
        errors.push(error(sourceFile, "layoutInvalidSublocation", `Sublocation "${sublocationId}" layout must be an object.`));
        continue;
      }
      const hotspotsRaw = asRecord(sub.hotspots) ?? {};
      const charactersRaw = asRecord(sub.characters) ?? {};
      const hotspots: Record<string, RectLayout> = {};
      const characters: Record<string, SpriteLayout> = {};

      for (const [hotspotId, layoutRaw] of Object.entries(hotspotsRaw)) {
        const parsed = parseRect(layoutRaw, sourceFile, `hotspot "${hotspotId}"`);
        if (parsed.ok) hotspots[hotspotId] = parsed.value;
        else errors.push(...parsed.errors);
      }
      for (const [characterId, layoutRaw] of Object.entries(charactersRaw)) {
        const parsed = parseSprite(
          layoutRaw,
          sourceFile,
          `character "${characterId}"`,
        );
        if (parsed.ok) characters[characterId] = parsed.value;
        else errors.push(...parsed.errors);
      }

      sublocations[sublocationId] = { hotspots, characters };
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      version: 1,
      sceneId: obj.sceneId as string,
      sublocations,
    },
  };
}

export function applyInvestigationLayout(
  scene: ASTInvestigationScene,
  layout: InvestigationLayoutSidecar,
): MergeResult {
  const errors: CompileError[] = [];
  if (layout.sceneId !== scene.id) {
    errors.push({
      code: "layoutSceneMismatch",
      message: `Layout sceneId "${layout.sceneId}" does not match scene "${scene.id}".`,
      sourceFile: scene.sourceFile,
      line: scene.line,
    });
  }

  const subById = new Map(scene.sublocations.map((s) => [s.id, s]));
  for (const [sublocationId, subLayout] of Object.entries(layout.sublocations)) {
    const sub = subById.get(sublocationId);
    if (!sub) {
      errors.push({
        code: "layoutUnknownSublocation",
        message: `Layout references unknown sublocation "${sublocationId}".`,
        sourceFile: scene.sourceFile,
        line: scene.line,
      });
      continue;
    }

    const hotspotIds = new Set(sub.hotspots.map((h) => h.id));
    for (const hotspotId of Object.keys(subLayout.hotspots)) {
      if (!hotspotIds.has(hotspotId)) {
        errors.push({
          code: "layoutUnknownHotspot",
          message: `Layout references unknown hotspot "${hotspotId}" in sublocation "${sublocationId}".`,
          sourceFile: sub.sourceFile,
          line: sub.line,
        });
      }
    }

    const characterIds = new Set(sub.characters.map((c) => c.id));
    for (const characterId of Object.keys(subLayout.characters)) {
      if (!characterIds.has(characterId)) {
        errors.push({
          code: "layoutUnknownCharacter",
          message: `Layout references unknown character "${characterId}" in sublocation "${sublocationId}".`,
          sourceFile: sub.sourceFile,
          line: sub.line,
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      ...scene,
      sublocations: scene.sublocations.map((sub) => {
        const subLayout = layout.sublocations[sub.id];
        return {
          ...sub,
          hotspots: sub.hotspots.map((hotspot) => ({
            ...hotspot,
            layout: subLayout?.hotspots[hotspot.id] ?? null,
          })),
          characters: sub.characters.map((character) => ({
            ...character,
            layout: subLayout?.characters[character.id] ?? null,
          })),
        };
      }),
    },
  };
}

function parseRect(
  raw: unknown,
  sourceFile: string,
  label: string,
): { ok: true; value: RectLayout } | { ok: false; errors: CompileError[] } {
  const obj = asRecord(raw);
  if (!obj || obj.kind !== "rect") {
    return {
      ok: false,
      errors: [error(sourceFile, "layoutInvalidRect", `${label} must be a rect layout.`)],
    };
  }
  const numbers = parseBox(obj, sourceFile, label);
  if (!numbers.ok) return numbers;
  return { ok: true, value: { kind: "rect", ...numbers.value } };
}

function parseSprite(
  raw: unknown,
  sourceFile: string,
  label: string,
): { ok: true; value: SpriteLayout } | { ok: false; errors: CompileError[] } {
  const obj = asRecord(raw);
  if (!obj || obj.kind !== "sprite") {
    return {
      ok: false,
      errors: [
        error(sourceFile, "layoutInvalidSprite", `${label} must be a sprite layout.`),
      ],
    };
  }
  if (typeof obj.assetId !== "string" || obj.assetId.length === 0) {
    return {
      ok: false,
      errors: [
        error(sourceFile, "layoutMissingAssetId", `${label} must include an assetId.`),
      ],
    };
  }
  if (obj.anchor !== "bottomCenter") {
    return {
      ok: false,
      errors: [
        error(sourceFile, "layoutInvalidAnchor", `${label} anchor must be "bottomCenter".`),
      ],
    };
  }
  const numbers = parseBox(obj, sourceFile, label);
  if (!numbers.ok) return numbers;
  return {
    ok: true,
    value: {
      kind: "sprite",
      assetId: obj.assetId,
      anchor: "bottomCenter",
      ...numbers.value,
    },
  };
}

function parseBox(
  obj: Record<string, unknown>,
  sourceFile: string,
  label: string,
):
  | { ok: true; value: { x: number; y: number; w: number; h: number } }
  | { ok: false; errors: CompileError[] } {
  const values = {
    x: obj.x,
    y: obj.y,
    w: obj.w,
    h: obj.h,
  };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return {
        ok: false,
        errors: [
          error(sourceFile, "layoutInvalidNumber", `${label} field "${key}" must be a finite number.`),
        ],
      };
    }
  }
  const box = values as { x: number; y: number; w: number; h: number };
  if (box.w <= 0 || box.h <= 0) {
    return {
      ok: false,
      errors: [
        error(sourceFile, "layoutInvalidSize", `${label} width and height must be greater than 0.`),
      ],
    };
  }
  if (box.x < 0 || box.y < 0 || box.x + box.w > 1 || box.y + box.h > 1) {
    return {
      ok: false,
      errors: [
        error(sourceFile, "layoutOutOfBounds", `${label} must remain within the normalized background plate.`),
      ],
    };
  }
  return { ok: true, value: box };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function error(
  sourceFile: string,
  code: string,
  message: string,
): CompileError {
  return { code, message, sourceFile, line: 1 };
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
bun run test scripts/compile-scenes/layout.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add scripts/compile-scenes/types.ts scripts/compile-scenes/layout.ts scripts/compile-scenes/layout.test.ts
git commit -m "feat: add investigation layout sidecar parser"
```

Expected: commit succeeds.

---

### Task 2: Compiler Sidecar Discovery And JSON Emission

**Files:**

- Modify: `scripts/compile-scenes/orchestrator.ts`
- Modify: `scripts/compile-scenes/emitter.ts`
- Modify: `scripts/compile-scenes/emitter.test.ts`
- Create: `scripts/__fixtures__/valid/chapter_1/investigation_scene_1.layout.json`
- Modify: `scripts/__snapshots__/compile-scenes.test.ts.snap`

- [ ] **Step 1: Add a valid fixture sidecar**

Create `scripts/__fixtures__/valid/chapter_1/investigation_scene_1.layout.json`:

```json
{
  "version": 1,
  "sceneId": "investigation_scene_1",
  "sublocations": {
    "main_hall": {
      "hotspots": {
        "table": { "kind": "rect", "x": 0.18, "y": 0.52, "w": 0.16, "h": 0.12 },
        "cabinet": { "kind": "rect", "x": 0.67, "y": 0.32, "w": 0.12, "h": 0.28 }
      },
      "characters": {
        "witness": {
          "kind": "sprite",
          "assetId": "portrait.witness.standard",
          "x": 0.72,
          "y": 0.18,
          "w": 0.16,
          "h": 0.72,
          "anchor": "bottomCenter"
        }
      }
    },
    "back_room": {
      "hotspots": {
        "safe": { "kind": "rect", "x": 0.42, "y": 0.35, "w": 0.14, "h": 0.2 }
      },
      "characters": {}
    }
  }
}
```

- [ ] **Step 2: Add failing emitter coverage**

Modify the investigation emitter test in `scripts/compile-scenes/emitter.test.ts`
so one hotspot and one character include layout:

```ts
layout: { kind: "rect", x: 0.18, y: 0.52, w: 0.16, h: 0.12 },
```

and:

```ts
layout: {
  kind: "sprite",
  assetId: "portrait.witness.standard",
  x: 0.72,
  y: 0.18,
  w: 0.16,
  h: 0.72,
  anchor: "bottomCenter",
},
```

Assert emitted JSON includes:

```ts
expect(json.sublocations[0]?.hotspots[0]?.layout).toEqual({
  kind: "rect",
  x: 0.18,
  y: 0.52,
  w: 0.16,
  h: 0.12,
});
expect(json.sublocations[0]?.characters[0]?.layout).toEqual({
  kind: "sprite",
  assetId: "portrait.witness.standard",
  x: 0.72,
  y: 0.18,
  w: 0.16,
  h: 0.72,
  anchor: "bottomCenter",
});
```

- [ ] **Step 3: Run emitter test and verify failure**

Run:

```bash
bun run test scripts/compile-scenes/emitter.test.ts
```

Expected: FAIL because `emitInvestigationScene` drops layout fields.

- [ ] **Step 4: Emit layout fields**

Modify `scripts/compile-scenes/emitter.ts` inside `emitInvestigationScene`:

```ts
hotspots: sub.hotspots.map((h) => ({
  id: h.id,
  label: h.label,
  description: h.description,
  status: h.status,
  unlock: h.unlock,
  reveals: h.reveals,
  layout: h.layout ?? null,
  inspectDialogue: emitDialogueItems(h.inspectDialogue),
  onReexamine: emitNullableDialogueItems(h.onReexamine),
})),
characters: sub.characters.map((c) => ({
  id: c.id,
  name: c.name,
  role: c.role,
  bio: c.bio,
  layout: c.layout ?? null,
  topics: c.topics.map((t) => ({
    id: t.id,
    label: t.label,
    status: t.status,
    unlock: t.unlock,
    reveals: t.reveals,
    topicDialogue: emitDialogueItems(t.topicDialogue),
    onReexamine: emitNullableDialogueItems(t.onReexamine),
  })),
})),
```

- [ ] **Step 5: Wire sidecar discovery into orchestrator**

Modify imports in `scripts/compile-scenes/orchestrator.ts`:

```ts
import {
  applyInvestigationLayout,
  parseInvestigationLayoutJson,
} from "./layout";
```

In the `file.startsWith("investigation_scene_")` branch, replace the successful
push with sidecar loading:

```ts
} else if (file.startsWith("investigation_scene_")) {
  const parsed = parseInvestigationScene(source, sourceFileTag, sceneId);
  if (!parsed.ok) {
    errors.push(parsed.error);
    failedParseFiles.add(sourceFileTag);
  } else {
    const layoutPath = resolve(
      chapterDir,
      file.replace(/\.md$/, ".layout.json"),
    );
    let investigationAst = parsed.value;
    if (existsSync(layoutPath)) {
      const layoutSource = readFileSync(layoutPath, "utf-8");
      const layout = parseInvestigationLayoutJson(
        layoutSource,
        `${dirName}/${file.replace(/\.md$/, ".layout.json")}`,
      );
      if (!layout.ok) {
        errors.push(...layout.errors);
      } else {
        const merged = applyInvestigationLayout(investigationAst, layout.value);
        if (!merged.ok) errors.push(...merged.errors);
        else investigationAst = merged.value;
      }
    }
    scenes.push({ chapterId: dirName, file, ast: investigationAst });
  }
```

- [ ] **Step 6: Run compiler tests and update snapshots**

Run:

```bash
bun run test scripts/compile-scenes.test.ts scripts/compile-scenes/emitter.test.ts scripts/compile-scenes/layout.test.ts
```

Expected: snapshot test fails because the valid fixture now emits layout.

Run:

```bash
bunx vitest run scripts/compile-scenes.test.ts -u
```

Expected: snapshot updates include `layout` fields on fixture hotspots and
characters.

- [ ] **Step 7: Run the full frontend/unit suite**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add scripts/compile-scenes/orchestrator.ts scripts/compile-scenes/emitter.ts scripts/compile-scenes/emitter.test.ts scripts/compile-scenes/layout.test.ts scripts/__fixtures__/valid/chapter_1/investigation_scene_1.layout.json scripts/__snapshots__/compile-scenes.test.ts.snap
git commit -m "feat: merge investigation layout sidecars"
```

Expected: commit succeeds.

---

### Task 3: Rust Runtime Schema And View Contract

**Files:**

- Modify: `src-tauri/src/game/schema.rs`
- Modify: `src-tauri/src/game/view.rs`
- Modify: `src-tauri/src/game/mod.rs`

- [ ] **Step 1: Add failing Rust serde tests**

Modify `src-tauri/src/game/schema.rs` test module with:

```rust
#[test]
fn deserializes_hotspot_layout() {
    let json = r#"{
        "id": "table",
        "label": "桌面",
        "description": "桌上有一只杯子。",
        "status": "unlocked",
        "unlock": null,
        "reveals": [],
        "layout": { "kind": "rect", "x": 0.18, "y": 0.52, "w": 0.16, "h": 0.12 },
        "inspectDialogue": []
    }"#;
    let parsed: HotspotJson = serde_json::from_str(json).unwrap();
    assert_eq!(parsed.layout.unwrap().x, 0.18);
}

#[test]
fn deserializes_character_layout() {
    let json = r#"{
        "id": "witness",
        "name": "目擊者",
        "role": "店員",
        "bio": "緊張的店員。",
        "layout": {
            "kind": "sprite",
            "assetId": "portrait.witness.standard",
            "x": 0.72,
            "y": 0.18,
            "w": 0.16,
            "h": 0.72,
            "anchor": "bottomCenter"
        },
        "topics": []
    }"#;
    let parsed: CharacterJson = serde_json::from_str(json).unwrap();
    assert_eq!(parsed.layout.unwrap().asset_id, "portrait.witness.standard");
}
```

- [ ] **Step 2: Run Rust schema tests and verify failure**

Run:

```bash
cd src-tauri && cargo test schema::tests::deserializes_hotspot_layout schema::tests::deserializes_character_layout
```

Expected: FAIL because `layout` fields and types do not exist.

- [ ] **Step 3: Add Rust layout schema and view types**

Modify `src-tauri/src/game/schema.rs` after `AssetRefJson`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HotspotLayoutJson {
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CharacterLayoutJson {
    Sprite {
        asset_id: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        anchor: CharacterLayoutAnchorJson,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CharacterLayoutAnchorJson {
    BottomCenter,
}
```

Modify `HotspotJson` and `CharacterJson`:

```rust
#[serde(default)]
pub layout: Option<HotspotLayoutJson>,
```

and:

```rust
#[serde(default)]
pub layout: Option<CharacterLayoutJson>,
```

Modify `src-tauri/src/game/view.rs` imports:

```rust
use crate::game::schema::{
    AudioChannelJson, CharacterLayoutJson, DialogueItem, HotspotLayoutJson,
};
```

Modify view structs:

```rust
pub struct HotspotView {
    pub id: String,
    pub label: String,
    pub description: String,
    pub inspected: bool,
    pub layout: Option<HotspotLayoutJson>,
}

pub struct CharacterView {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bio: String,
    pub layout: Option<CharacterLayoutJson>,
    pub topics: Vec<TopicView>,
}
```

- [ ] **Step 4: Pass layout through scene view**

Modify `src-tauri/src/game/mod.rs` in `scene_view()` investigation mapping:

```rust
.map(|h| HotspotView {
    id: h.id.clone(),
    label: h.label.clone(),
    description: h.description.clone(),
    inspected: inv.inspected_hotspots.contains(&h.id),
    layout: h.layout.clone(),
})
```

and:

```rust
.map(|c| CharacterView {
    id: c.id.clone(),
    name: c.name.clone(),
    role: c.role.clone(),
    bio: c.bio.clone(),
    layout: c.layout.clone(),
    topics: c
        .topics
        .iter()
        .filter(|t| {
            inv.is_block_unlocked(
                &format!("topic:{}@{}", c.id, t.id),
                t.status,
                t.unlock.as_ref(),
                &ctx,
            )
        })
        .map(|t| TopicView {
            id: t.id.clone(),
            label: t.label.clone(),
            discussed: inv
                .discussed_topics
                .contains(&(c.id.clone(), t.id.clone())),
        })
        .collect(),
})
```

- [ ] **Step 5: Run Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src-tauri/src/game/schema.rs src-tauri/src/game/view.rs src-tauri/src/game/mod.rs
git commit -m "feat: expose investigation layout in runtime view"
```

Expected: commit succeeds.

---

### Task 4: Frontend Scene Surface With Text Fallback

**Files:**

- Modify: `src/lib/state/types.ts`
- Create: `src/lib/components/InvestigationSceneSurface.svelte`
- Create: `src/lib/components/InvestigationSceneSurface.test.ts`
- Modify: `src/lib/components/ExploreView.svelte`

- [ ] **Step 1: Add frontend layout types**

Modify `src/lib/state/types.ts`:

```ts
export type HotspotLayout =
  | {
      kind: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
    };

export type CharacterLayout =
  | {
      kind: "sprite";
      assetId: string;
      x: number;
      y: number;
      w: number;
      h: number;
      anchor: "bottomCenter";
    };

export type HotspotView = {
  id: string;
  label: string;
  description: string;
  inspected: boolean;
  layout: HotspotLayout | null;
};

export type CharacterView = {
  id: string;
  name: string;
  role: string;
  bio: string;
  layout: CharacterLayout | null;
  topics: TopicView[];
};
```

- [ ] **Step 2: Write failing component tests**

Create `src/lib/components/InvestigationSceneSurface.test.ts`:

```ts
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import InvestigationSceneSurface from "./InvestigationSceneSurface.svelte";
import type { SublocationView } from "$lib/state/types";

function sublocation(): SublocationView {
  return {
    id: "main_hall",
    label: "主廳",
    sceneTag: "測試主廳，明亮。",
    hotspots: [
      {
        id: "table",
        label: "桌面",
        description: "桌上有一只杯子。",
        inspected: false,
        layout: { kind: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
      },
      {
        id: "cabinet",
        label: "櫃子",
        description: "尚未放置。",
        inspected: false,
        layout: null,
      },
    ],
    characters: [
      {
        id: "witness",
        name: "目擊者",
        role: "店員",
        bio: "緊張的店員。",
        layout: {
          kind: "sprite",
          assetId: "portrait.witness.standard",
          x: 0.7,
          y: 0.1,
          w: 0.18,
          h: 0.8,
          anchor: "bottomCenter",
        },
        topics: [{ id: "alibi", label: "不在場證明", discussed: false }],
      },
    ],
  };
}

describe("InvestigationSceneSurface", () => {
  it("renders placed hotspot buttons with normalized CSS properties", () => {
    render(InvestigationSceneSurface, {
      props: {
        sublocation: sublocation(),
        disabled: false,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      },
    });

    const hotspot = screen.getByRole("button", { name: /調查：桌面/ });
    expect(hotspot).toHaveStyle("--x: 10%");
    expect(hotspot).toHaveStyle("--y: 20%");
    expect(hotspot).toHaveStyle("--w: 30%");
    expect(hotspot).toHaveStyle("--h: 20%");
  });

  it("dispatches inspect for placed hotspots", async () => {
    const onInspect = vi.fn();
    render(InvestigationSceneSurface, {
      props: {
        sublocation: sublocation(),
        disabled: false,
        onInspect,
        onInterview: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: /調查：桌面/ }));
    expect(onInspect).toHaveBeenCalledWith("table");
  });

  it("opens a topic picker for placed characters", async () => {
    const onInterview = vi.fn();
    render(InvestigationSceneSurface, {
      props: {
        sublocation: sublocation(),
        disabled: false,
        onInspect: vi.fn(),
        onInterview,
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: /詢問：目擊者/ }));
    await fireEvent.click(screen.getByRole("button", { name: "不在場證明" }));
    expect(onInterview).toHaveBeenCalledWith("witness", "alibi");
  });

  it("keeps unplaced targets in fallback controls", () => {
    render(InvestigationSceneSurface, {
      props: {
        sublocation: sublocation(),
        disabled: false,
        onInspect: vi.fn(),
        onInterview: vi.fn(),
      },
    });

    expect(screen.getByRole("button", { name: /未放置：櫃子/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run component test and verify failure**

Run:

```bash
bun run test src/lib/components/InvestigationSceneSurface.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 4: Implement the scene surface component**

Create `src/lib/components/InvestigationSceneSurface.svelte`:

```svelte
<script lang="ts">
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import type { CharacterView, SublocationView } from "$lib/state/types";

  let {
    sublocation,
    onInspect,
    onInterview,
    disabled = false,
  }: {
    sublocation: SublocationView;
    onInspect: (id: string) => void;
    onInterview: (characterId: string, topicId: string) => void;
    disabled?: boolean;
  } = $props();

  let activeCharacterId = $state<string | null>(null);
  let portraitAssets = $state<Record<string, ResolvedStoryAsset | null>>({});

  const placedHotspots = $derived(
    sublocation.hotspots.filter((hotspot) => hotspot.layout),
  );
  const unplacedHotspots = $derived(
    sublocation.hotspots.filter((hotspot) => !hotspot.layout),
  );
  const placedCharacters = $derived(
    sublocation.characters.filter((character) => character.layout),
  );
  const unplacedCharacters = $derived(
    sublocation.characters.filter((character) => !character.layout),
  );
  const activeCharacter = $derived(
    sublocation.characters.find((character) => character.id === activeCharacterId) ??
      null,
  );

  $effect(() => {
    let cancelled = false;
    const ids = placedCharacters
      .map((character) => character.layout?.assetId)
      .filter((id): id is string => Boolean(id));
    for (const assetId of ids) {
      resolveStoryAsset(assetId, "portrait").then((asset) => {
        if (!cancelled) {
          portraitAssets = { ...portraitAssets, [assetId]: asset };
        }
      });
    }
    return () => {
      cancelled = true;
    };
  });

  function percent(value: number) {
    return `${value * 100}%`;
  }

  function boxStyle(layout: { x: number; y: number; w: number; h: number }) {
    return `--x: ${percent(layout.x)}; --y: ${percent(layout.y)}; --w: ${percent(layout.w)}; --h: ${percent(layout.h)};`;
  }

  function handlePortraitError(character: CharacterView) {
    const assetId = character.layout?.assetId;
    if (!assetId) return;
    portraitAssets = {
      ...portraitAssets,
      [assetId]: placeholderForMissingStoryAsset(assetId, "portrait"),
    };
  }
</script>

<section class="surface" aria-label={`${sublocation.label}調查畫面`}>
  {#each placedHotspots as hotspot (hotspot.id)}
    {@const layout = hotspot.layout}
    {#if layout}
      <button
        class="hotspot"
        class:done={hotspot.inspected}
        style={boxStyle(layout)}
        type="button"
        aria-label={`調查：${hotspot.label}`}
        {disabled}
        onclick={() => onInspect(hotspot.id)}
      >
        <span>{hotspot.label}</span>
      </button>
    {/if}
  {/each}

  {#each placedCharacters as character (character.id)}
    {@const layout = character.layout}
    {@const asset = layout ? portraitAssets[layout.assetId] : null}
    {#if layout}
      <button
        class="character"
        style={boxStyle(layout)}
        type="button"
        aria-label={`詢問：${character.name}`}
        {disabled}
        onclick={() =>
          (activeCharacterId =
            activeCharacterId === character.id ? null : character.id)}
      >
        {#if asset}
          <img
            src={asset.url}
            alt=""
            aria-hidden="true"
            onerror={() => handlePortraitError(character)}
          />
        {:else}
          <span>{character.name}</span>
        {/if}
      </button>
    {/if}
  {/each}

  {#if activeCharacter}
    <div class="topic-popover" role="dialog" aria-label={`${activeCharacter.name}詢問項目`}>
      <strong>{activeCharacter.name}</strong>
      {#each activeCharacter.topics as topic (topic.id)}
        <button
          type="button"
          class:done={topic.discussed}
          {disabled}
          onclick={() => onInterview(activeCharacter.id, topic.id)}
        >
          {topic.label}
        </button>
      {/each}
    </div>
  {/if}
</section>

{#if unplacedHotspots.length > 0 || unplacedCharacters.length > 0}
  <section class="fallback" aria-label="未放置調查目標">
    {#each unplacedHotspots as hotspot (hotspot.id)}
      <button type="button" {disabled} onclick={() => onInspect(hotspot.id)}>
        未放置：{hotspot.label}
      </button>
    {/each}
    {#each unplacedCharacters as character (character.id)}
      {#each character.topics as topic (topic.id)}
        <button
          type="button"
          {disabled}
          onclick={() => onInterview(character.id, topic.id)}
        >
          未放置：{character.name} / {topic.label}
        </button>
      {/each}
    {/each}
  </section>
{/if}

<style>
  .surface {
    position: relative;
    min-height: min(62vh, 760px);
    margin: 0 clamp(20px, 3vw, 40px) 16px;
  }

  .hotspot,
  .character {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: var(--w);
    height: var(--h);
    border: 1px solid rgba(95, 225, 214, 0.42);
    background: rgba(95, 225, 214, 0.08);
    color: var(--bone);
    cursor: pointer;
    font: inherit;
  }

  .hotspot:hover:not(:disabled),
  .hotspot:focus-visible:not(:disabled),
  .character:hover:not(:disabled),
  .character:focus-visible:not(:disabled) {
    border-color: var(--cyan);
    background: rgba(95, 225, 214, 0.16);
  }

  .hotspot.done {
    opacity: 0.62;
  }

  .character {
    border-color: transparent;
    background: transparent;
  }

  .character img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: bottom center;
    filter: drop-shadow(0 16px 24px rgba(0, 0, 0, 0.48));
  }

  .topic-popover,
  .fallback {
    display: flex;
    gap: 8px;
    padding: 12px;
    background: rgba(20, 20, 31, 0.92);
    border: 1px solid var(--rule-strong);
  }

  .topic-popover {
    position: absolute;
    right: 24px;
    bottom: 24px;
    z-index: 5;
    flex-direction: column;
    min-width: 220px;
  }

  .fallback {
    margin: 0 clamp(20px, 3vw, 40px) 140px;
    flex-wrap: wrap;
  }

  button:disabled {
    cursor: wait;
    opacity: 0.55;
  }
</style>
```

- [ ] **Step 5: Wire ExploreView to use the scene surface**

Modify `src/lib/components/ExploreView.svelte` imports:

```svelte
import InvestigationSceneSurface from "./InvestigationSceneSurface.svelte";
```

Replace `HotspotGrid` and `CharacterList` rendering with:

```svelte
<InvestigationSceneSurface
  sublocation={currentSub}
  {onInspect}
  {onInterview}
  {disabled}
/>
```

Keep `SublocationNav` unchanged.

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
bun run test src/lib/components/InvestigationSceneSurface.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run type check**

Run:

```bash
bun run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/lib/state/types.ts src/lib/components/InvestigationSceneSurface.svelte src/lib/components/InvestigationSceneSurface.test.ts src/lib/components/ExploreView.svelte
git commit -m "feat: render investigation targets on scene surface"
```

Expected: commit succeeds.

---

### Task 5: Browser-Safe Smoke Coverage

**Files:**

- Create: `e2e/investigation-layout.spec.ts`

- [ ] **Step 1: Add a browser-safe smoke test**

Create `e2e/investigation-layout.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("placed investigation hotspot is clickable through scene surface", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Game|開始|新遊戲/ }).click();

  const hotspot = page.getByRole("button", { name: /調查：桌面/ });
  await expect(hotspot).toBeVisible();
  await hotspot.click();

  await expect(page.getByRole("button", { name: "推進對話" })).toBeVisible();
});
```

- [ ] **Step 2: Run E2E and adjust selector text if needed**

Run:

```bash
bun run test:e2e e2e/investigation-layout.spec.ts
```

Expected: PASS. If the main menu button text differs, inspect
`src/lib/components/MainMenu.svelte`, update only the button selector, and rerun
the same command.

- [ ] **Step 3: Run compile and checks**

Run:

```bash
bun run scenes:compile
bun run test
bun run check
```

Expected: all commands PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add e2e/investigation-layout.spec.ts
git commit -m "test: cover investigation scene surface click"
```

Expected: commit succeeds.

---

### Task 6: Separate Layout Editor Tauri App Scaffold

**Files:**

- Create: `apps/layout-editor/package.json`
- Create: `apps/layout-editor/index.html`
- Create: `apps/layout-editor/vite.config.ts`
- Create: `apps/layout-editor/svelte.config.js`
- Create: `apps/layout-editor/tsconfig.json`
- Create: `apps/layout-editor/src/main.ts`
- Create: `apps/layout-editor/src/App.svelte`
- Create: `apps/layout-editor/src-tauri/Cargo.toml`
- Create: `apps/layout-editor/src-tauri/tauri.conf.json`
- Create: `apps/layout-editor/src-tauri/capabilities/default.json`
- Create: `apps/layout-editor/src-tauri/src/main.rs`
- Create: `apps/layout-editor/src-tauri/src/lib.rs`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add root scripts**

Modify root `package.json` scripts:

```json
"editor:dev": "bun --cwd apps/layout-editor run tauri dev",
"editor:build": "bun --cwd apps/layout-editor run tauri build",
"editor:check": "bun --cwd apps/layout-editor run check"
```

- [ ] **Step 2: Add editor package manifest**

Create `apps/layout-editor/package.json`:

```json
{
  "name": "@lyra/layout-editor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev --host 127.0.0.1",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "@tauri-apps/plugin-fs": "^2",
    "svelte": "^5.0.0",
    "vite": "^6.0.3"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "@tauri-apps/cli": "^2",
    "svelte-check": "^4.0.0",
    "typescript": "~5.6.2"
  }
}
```

- [ ] **Step 3: Add editor frontend config**

Create `apps/layout-editor/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lyra Layout Editor</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Create `apps/layout-editor/vite.config.ts`:

```ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
  },
});
```

Create `apps/layout-editor/svelte.config.js`:

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
```

Create `apps/layout-editor/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["svelte"],
    "moduleResolution": "bundler"
  },
  "include": ["src/**/*.ts", "src/**/*.svelte"]
}
```

Create `apps/layout-editor/src/main.ts`:

```ts
import App from "./App.svelte";

const app = new App({
  target: document.getElementById("app")!,
});

export default app;
```

Create `apps/layout-editor/src/App.svelte`:

```svelte
<script lang="ts">
  const title = "Lyra Layout Editor";
</script>

<main>
  <h1>{title}</h1>
  <p>Select a compiled investigation scene to begin placing hotspots and people.</p>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #101018;
    color: #d8d0bf;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
  }

  main {
    padding: 24px;
  }
</style>
```

- [ ] **Step 4: Add editor Tauri config and Rust shell**

Create `apps/layout-editor/src-tauri/Cargo.toml`:

```toml
[package]
name = "lyra-layout-editor"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Create `apps/layout-editor/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Lyra Layout Editor",
  "version": "0.1.0",
  "identifier": "com.lyra.layout-editor",
  "build": {
    "beforeDevCommand": "bun run dev",
    "beforeBuildCommand": "bun run build",
    "devUrl": "http://127.0.0.1:1430",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Lyra Layout Editor",
        "width": 1440,
        "height": 920
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": []
  }
}
```

Create `apps/layout-editor/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default permissions for Lyra Layout Editor",
  "windows": ["main"],
  "permissions": ["core:default", "dialog:default", "fs:default"]
}
```

Create `apps/layout-editor/src-tauri/src/main.rs`:

```rust
fn main() {
    lyra_layout_editor_lib::run();
}
```

Create `apps/layout-editor/src-tauri/src/lib.rs`:

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Lyra Layout Editor");
}
```

- [ ] **Step 5: Ignore editor output**

Modify `.gitignore`:

```gitignore
apps/layout-editor/dist/
apps/layout-editor/src-tauri/target/
```

- [ ] **Step 6: Install editor dependencies**

Run:

```bash
bun install
```

Expected: lockfile updates for editor package dependencies.

- [ ] **Step 7: Run editor checks**

Run:

```bash
bun run editor:check
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add package.json bun.lock .gitignore apps/layout-editor
git commit -m "feat: scaffold separate layout editor app"
```

Expected: commit succeeds.

---

### Task 7: Editor Scene Loading And Sidecar Save Commands

**Files:**

- Create: `apps/layout-editor/src/lib/layout-types.ts`
- Create: `apps/layout-editor/src/lib/layout-store.svelte.ts`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`

- [ ] **Step 1: Add editor data types**

Create `apps/layout-editor/src/lib/layout-types.ts`:

```ts
export type SceneIndex = {
  chapters: Array<{
    id: string;
    title: string;
    summary: string;
    scenes: Array<{ type: "linear" | "investigation" | "interrogation"; file: string }>;
  }>;
};

export type InvestigationSceneJson = {
  type: "investigation";
  id: string;
  title: string;
  sublocations: Array<{
    id: string;
    label: string;
    sceneTag: string;
    backgroundAssetId: string | null;
    hotspots: Array<{ id: string; label: string; description: string }>;
    characters: Array<{
      id: string;
      name: string;
      role: string;
      bio: string;
      topics: Array<{ id: string; label: string }>;
    }>;
  }>;
};

export type RectLayout = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SpriteLayout = {
  kind: "sprite";
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: "bottomCenter";
};

export type InvestigationLayoutSidecar = {
  version: 1;
  sceneId: string;
  sublocations: Record<
    string,
    {
      hotspots: Record<string, RectLayout>;
      characters: Record<string, SpriteLayout>;
    }
  >;
};
```

- [ ] **Step 2: Add Tauri commands for project file IO**

Modify `apps/layout-editor/src-tauri/src/lib.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFile {
    path: String,
    contents: String,
}

#[tauri::command]
fn read_project_file(path: String) -> Result<ProjectFile, String> {
    let path_buf = checked_project_path(&path)?;
    let contents = fs::read_to_string(&path_buf)
        .map_err(|error| format!("failed to read {}: {error}", path_buf.display()))?;
    Ok(ProjectFile {
        path,
        contents,
    })
}

#[tauri::command]
fn write_project_file(path: String, contents: String) -> Result<(), String> {
    let path_buf = checked_project_path(&path)?;
    fs::write(&path_buf, contents)
        .map_err(|error| format!("failed to write {}: {error}", path_buf.display()))
}

fn checked_project_path(path: &str) -> Result<PathBuf, String> {
    let root = workspace_root()?;
    let joined = root.join(path);
    let normalized = joined
        .components()
        .collect::<PathBuf>();
    if !normalized.starts_with(&root) {
        return Err("path escapes project root".into());
    }
    Ok(normalized)
}

fn workspace_root() -> Result<PathBuf, String> {
    let mut dir = std::env::current_dir()
        .map_err(|error| format!("failed to resolve current dir: {error}"))?;
    loop {
        if dir.join("docs/stories_plan").is_dir()
            && dir.join("src-tauri/resources/scenes").is_dir()
        {
            return Ok(dir);
        }
        if !dir.pop() {
            return Err("failed to locate Lyra workspace root".into());
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_project_file,
            write_project_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lyra Layout Editor");
}
```

- [ ] **Step 3: Add editor store**

Create `apps/layout-editor/src/lib/layout-store.svelte.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type {
  InvestigationLayoutSidecar,
  InvestigationSceneJson,
  SceneIndex,
} from "./layout-types";

type ProjectFile = { path: string; contents: string };

export const editorState = $state<{
  chapters: SceneIndex | null;
  scene: InvestigationSceneJson | null;
  layout: InvestigationLayoutSidecar | null;
  scenePath: string | null;
  layoutPath: string | null;
  error: string | null;
}>({
  chapters: null,
  scene: null,
  layout: null,
  scenePath: null,
  layoutPath: null,
  error: null,
});

export async function loadChapters() {
  editorState.error = null;
  try {
    const file = await invoke<ProjectFile>("read_project_file", {
      path: "src-tauri/resources/scenes/chapters.json",
    });
    editorState.chapters = JSON.parse(file.contents) as SceneIndex;
  } catch (error) {
    editorState.error = normalizeError(error);
  }
}

export async function loadInvestigationScene(scenePath: string) {
  editorState.error = null;
  const layoutPath = scenePath.replace(/\.json$/, ".layout.json").replace(
    "src-tauri/resources/scenes/",
    "docs/stories_plan/",
  );
  try {
    const sceneFile = await invoke<ProjectFile>("read_project_file", {
      path: scenePath,
    });
    editorState.scene = JSON.parse(sceneFile.contents) as InvestigationSceneJson;
    editorState.scenePath = scenePath;
    editorState.layoutPath = layoutPath;
    try {
      const layoutFile = await invoke<ProjectFile>("read_project_file", {
        path: layoutPath,
      });
      editorState.layout = JSON.parse(layoutFile.contents) as InvestigationLayoutSidecar;
    } catch {
      editorState.layout = {
        version: 1,
        sceneId: editorState.scene.id,
        sublocations: {},
      };
    }
  } catch (error) {
    editorState.error = normalizeError(error);
  }
}

export async function saveLayout() {
  if (!editorState.layoutPath || !editorState.layout) return;
  editorState.error = null;
  try {
    await invoke("write_project_file", {
      path: editorState.layoutPath,
      contents: `${JSON.stringify(editorState.layout, null, 2)}\n`,
    });
  } catch (error) {
    editorState.error = normalizeError(error);
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Editor command failed.";
}
```

- [ ] **Step 4: Wire initial editor app loading**

Modify `apps/layout-editor/src/App.svelte`:

```svelte
<script lang="ts">
  import {
    editorState,
    loadChapters,
    loadInvestigationScene,
    saveLayout,
  } from "./lib/layout-store.svelte";

  $effect(() => {
    loadChapters();
  });

  const investigationScenes = $derived(
    editorState.chapters?.chapters.flatMap((chapter) =>
      chapter.scenes
        .filter((scene) => scene.type === "investigation")
        .map((scene) => ({
          chapterId: chapter.id,
          file: scene.file,
          path: `src-tauri/resources/scenes/${scene.file}`,
        })),
    ) ?? [],
  );
</script>

<main>
  <aside>
    <h1>Lyra Layout Editor</h1>
    {#if editorState.error}
      <p class="error">{editorState.error}</p>
    {/if}
    {#each investigationScenes as scene (scene.path)}
      <button type="button" onclick={() => loadInvestigationScene(scene.path)}>
        {scene.chapterId} / {scene.file}
      </button>
    {/each}
  </aside>

  <section>
    {#if editorState.scene}
      <header>
        <h2>{editorState.scene.title}</h2>
        <button type="button" onclick={saveLayout}>Save Layout</button>
      </header>
      <p>{editorState.scene.sublocations.length} sublocations loaded.</p>
    {:else}
      <p>Select an investigation scene.</p>
    {/if}
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #101018;
    color: #d8d0bf;
    font-family: system-ui, sans-serif;
  }

  main {
    display: grid;
    grid-template-columns: 320px 1fr;
    min-height: 100vh;
  }

  aside {
    border-right: 1px solid rgba(216, 208, 191, 0.18);
    padding: 18px;
  }

  section {
    padding: 18px;
  }

  button {
    display: block;
    width: 100%;
    margin-bottom: 8px;
    padding: 8px 10px;
    color: inherit;
    background: #1d1d2b;
    border: 1px solid rgba(216, 208, 191, 0.18);
    text-align: left;
  }

  .error {
    color: #ff7a90;
  }
</style>
```

- [ ] **Step 5: Run editor check**

Run:

```bash
bun run editor:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/layout-editor
git commit -m "feat: load and save layout sidecars in editor"
```

Expected: commit succeeds.

---

### Task 8: Editor Drag Canvas

**Files:**

- Create: `apps/layout-editor/src/lib/EditorCanvas.svelte`
- Create: `apps/layout-editor/src/lib/TargetList.svelte`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/lib/layout-store.svelte.ts`

- [ ] **Step 1: Add layout mutation helpers**

Modify `apps/layout-editor/src/lib/layout-store.svelte.ts`:

```ts
import type { RectLayout, SpriteLayout } from "./layout-types";

export function setHotspotLayout(
  sublocationId: string,
  hotspotId: string,
  layout: RectLayout,
) {
  if (!editorState.layout) return;
  const sub = editorState.layout.sublocations[sublocationId] ?? {
    hotspots: {},
    characters: {},
  };
  editorState.layout = {
    ...editorState.layout,
    sublocations: {
      ...editorState.layout.sublocations,
      [sublocationId]: {
        ...sub,
        hotspots: { ...sub.hotspots, [hotspotId]: clampRect(layout) },
      },
    },
  };
}

export function setCharacterLayout(
  sublocationId: string,
  characterId: string,
  layout: SpriteLayout,
) {
  if (!editorState.layout) return;
  const sub = editorState.layout.sublocations[sublocationId] ?? {
    hotspots: {},
    characters: {},
  };
  editorState.layout = {
    ...editorState.layout,
    sublocations: {
      ...editorState.layout.sublocations,
      [sublocationId]: {
        ...sub,
        characters: { ...sub.characters, [characterId]: clampSprite(layout) },
      },
    },
  };
}

function clampRect(layout: RectLayout): RectLayout {
  const w = Math.min(Math.max(layout.w, 0.02), 1);
  const h = Math.min(Math.max(layout.h, 0.02), 1);
  return {
    ...layout,
    w,
    h,
    x: Math.min(Math.max(layout.x, 0), 1 - w),
    y: Math.min(Math.max(layout.y, 0), 1 - h),
  };
}

function clampSprite(layout: SpriteLayout): SpriteLayout {
  const rect = clampRect({
    kind: "rect",
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h,
  });
  return {
    ...layout,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
  };
}
```

- [ ] **Step 2: Add target list component**

Create `apps/layout-editor/src/lib/TargetList.svelte`:

```svelte
<script lang="ts">
  import type { InvestigationSceneJson } from "./layout-types";

  let {
    scene,
    currentSublocationId,
    onSelectSublocation,
  }: {
    scene: InvestigationSceneJson;
    currentSublocationId: string | null;
    onSelectSublocation: (id: string) => void;
  } = $props();
</script>

<section class="targets">
  <h2>Sublocations</h2>
  {#each scene.sublocations as sublocation (sublocation.id)}
    <button
      type="button"
      class:active={sublocation.id === currentSublocationId}
      onclick={() => onSelectSublocation(sublocation.id)}
    >
      {sublocation.label}
    </button>
  {/each}
</section>

<style>
  .targets {
    margin-top: 18px;
  }

  button.active {
    border-color: #5fe1d6;
  }
</style>
```

- [ ] **Step 3: Add editor canvas component with pointer drag and resize**

Create `apps/layout-editor/src/lib/EditorCanvas.svelte`:

```svelte
<script lang="ts">
  import type {
    InvestigationLayoutSidecar,
    InvestigationSceneJson,
    RectLayout,
    SpriteLayout,
  } from "./layout-types";

  let {
    scene,
    layout,
    sublocationId,
    onHotspotLayoutChange,
    onCharacterLayoutChange,
  }: {
    scene: InvestigationSceneJson;
    layout: InvestigationLayoutSidecar;
    sublocationId: string;
    onHotspotLayoutChange: (
      sublocationId: string,
      hotspotId: string,
      layout: RectLayout,
    ) => void;
    onCharacterLayoutChange: (
      sublocationId: string,
      characterId: string,
      layout: SpriteLayout,
    ) => void;
  } = $props();

  type DragTarget =
    | { type: "hotspot"; id: string; mode: "move" | "resize"; start: RectLayout; pointerX: number; pointerY: number; plate: DOMRect }
    | { type: "character"; id: string; mode: "move" | "resize"; start: SpriteLayout; pointerX: number; pointerY: number; plate: DOMRect };

  let drag = $state<DragTarget | null>(null);

  const sublocation = $derived(
    scene.sublocations.find((sub) => sub.id === sublocationId) ?? null,
  );
  const subLayout = $derived(layout.sublocations[sublocationId]);

  function styleFor(rect: RectLayout) {
    return `--x:${rect.x * 100}%;--y:${rect.y * 100}%;--w:${rect.w * 100}%;--h:${rect.h * 100}%;`;
  }

  function ensureHotspot(hotspotId: string): RectLayout {
    return (
      subLayout?.hotspots[hotspotId] ?? {
        kind: "rect",
        x: 0.4,
        y: 0.4,
        w: 0.12,
        h: 0.1,
      }
    );
  }

  function ensureCharacter(characterId: string): SpriteLayout {
    return (
      subLayout?.characters[characterId] ?? {
        kind: "sprite",
        assetId: `portrait.${characterId}.standard`,
        x: 0.66,
        y: 0.14,
        w: 0.18,
        h: 0.76,
        anchor: "bottomCenter",
      }
    );
  }

  function beginHotspotDrag(
    event: PointerEvent,
    hotspotId: string,
    mode: "move" | "resize",
  ) {
    const plate = (event.currentTarget as HTMLElement)
      .closest(".plate")
      ?.getBoundingClientRect();
    if (!plate) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      type: "hotspot",
      id: hotspotId,
      mode,
      start: ensureHotspot(hotspotId),
      pointerX: event.clientX,
      pointerY: event.clientY,
      plate,
    };
  }

  function beginCharacterDrag(
    event: PointerEvent,
    characterId: string,
    mode: "move" | "resize",
  ) {
    const plate = (event.currentTarget as HTMLElement)
      .closest(".plate")
      ?.getBoundingClientRect();
    if (!plate) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      type: "character",
      id: characterId,
      mode,
      start: ensureCharacter(characterId),
      pointerX: event.clientX,
      pointerY: event.clientY,
      plate,
    };
  }

  function updateDrag(event: PointerEvent) {
    if (!drag) return;
    const dx = (event.clientX - drag.pointerX) / drag.plate.width;
    const dy = (event.clientY - drag.pointerY) / drag.plate.height;
    if (drag.type === "hotspot") {
      const next =
        drag.mode === "move"
          ? { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy }
          : { ...drag.start, w: drag.start.w + dx, h: drag.start.h + dy };
      onHotspotLayoutChange(sublocationId, drag.id, next);
    } else {
      const next =
        drag.mode === "move"
          ? { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy }
          : { ...drag.start, w: drag.start.w + dx, h: drag.start.h + dy };
      onCharacterLayoutChange(sublocationId, drag.id, next);
    }
  }

  function endDrag() {
    drag = null;
  }

  function nudgeHotspot(hotspotId: string, dx: number, dy: number) {
    const current = ensureHotspot(hotspotId);
    onHotspotLayoutChange(sublocationId, hotspotId, {
      ...current,
      x: current.x + dx,
      y: current.y + dy,
    });
  }

  function nudgeCharacter(characterId: string, dx: number, dy: number) {
    const current = ensureCharacter(characterId);
    onCharacterLayoutChange(sublocationId, characterId, {
      ...current,
      x: current.x + dx,
      y: current.y + dy,
    });
  }
</script>

{#if sublocation}
  <section class="canvas">
    <div
      class="plate"
      onpointermove={updateDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
    >
      {#each sublocation.hotspots as hotspot (hotspot.id)}
        {@const rect = ensureHotspot(hotspot.id)}
        <div class="hotspot" style={styleFor(rect)} role="group" aria-label={hotspot.label}>
          <span>{hotspot.label}</span>
          <button
            class="drag-area"
            type="button"
            aria-label={`Move hotspot ${hotspot.label}`}
            onpointerdown={(event) => beginHotspotDrag(event, hotspot.id, "move")}
          />
          <button
            class="resize-handle"
            type="button"
            aria-label={`Resize hotspot ${hotspot.label}`}
            onpointerdown={(event) => beginHotspotDrag(event, hotspot.id, "resize")}
          />
          <span class="tools">
            <button type="button" onclick={() => nudgeHotspot(hotspot.id, -0.01, 0)}>Left</button>
            <button type="button" onclick={() => nudgeHotspot(hotspot.id, 0.01, 0)}>Right</button>
            <button type="button" onclick={() => nudgeHotspot(hotspot.id, 0, -0.01)}>Up</button>
            <button type="button" onclick={() => nudgeHotspot(hotspot.id, 0, 0.01)}>Down</button>
          </span>
        </div>
      {/each}

      {#each sublocation.characters as character (character.id)}
        {@const sprite = ensureCharacter(character.id)}
        <div class="character" style={styleFor(sprite)} role="group" aria-label={character.name}>
          <span>{character.name}</span>
          <button
            class="drag-area"
            type="button"
            aria-label={`Move character ${character.name}`}
            onpointerdown={(event) => beginCharacterDrag(event, character.id, "move")}
          />
          <button
            class="resize-handle"
            type="button"
            aria-label={`Resize character ${character.name}`}
            onpointerdown={(event) => beginCharacterDrag(event, character.id, "resize")}
          />
          <span class="tools">
            <button type="button" onclick={() => nudgeCharacter(character.id, -0.01, 0)}>Left</button>
            <button type="button" onclick={() => nudgeCharacter(character.id, 0.01, 0)}>Right</button>
            <button type="button" onclick={() => nudgeCharacter(character.id, 0, -0.01)}>Up</button>
            <button type="button" onclick={() => nudgeCharacter(character.id, 0, 0.01)}>Down</button>
          </span>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .canvas {
    display: grid;
    place-items: center;
    min-height: 720px;
  }

  .plate {
    position: relative;
    width: min(100%, 1280px);
    aspect-ratio: 16 / 9;
    background: #181820;
    border: 1px solid rgba(216, 208, 191, 0.24);
  }

  .hotspot,
  .character {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: var(--w);
    height: var(--h);
    border: 1px solid #5fe1d6;
    background: rgba(95, 225, 214, 0.16);
    color: #d8d0bf;
  }

  .character {
    border-color: #d4143a;
    background: rgba(212, 20, 58, 0.14);
  }

  .drag-area {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: move;
  }

  .resize-handle {
    position: absolute;
    right: -6px;
    bottom: -6px;
    width: 14px;
    height: 14px;
    border: 1px solid #d8d0bf;
    background: #101018;
    cursor: nwse-resize;
    z-index: 2;
  }

  .tools {
    position: absolute;
    left: 0;
    top: 100%;
    display: flex;
    gap: 4px;
  }

  .tools button {
    width: auto;
    font-size: 11px;
  }
</style>
```

- [ ] **Step 4: Wire editor components into App**

Modify `apps/layout-editor/src/App.svelte` imports:

```svelte
import EditorCanvas from "./lib/EditorCanvas.svelte";
import TargetList from "./lib/TargetList.svelte";
import {
  setCharacterLayout,
  setHotspotLayout,
} from "./lib/layout-store.svelte";
```

Add state:

```svelte
let currentSublocationId = $state<string | null>(null);

$effect(() => {
  if (editorState.scene && !currentSublocationId) {
    currentSublocationId = editorState.scene.sublocations[0]?.id ?? null;
  }
});
```

Render target list and canvas:

```svelte
{#if editorState.scene}
  <TargetList
    scene={editorState.scene}
    {currentSublocationId}
    onSelectSublocation={(id) => (currentSublocationId = id)}
  />
{/if}
```

and in the main section:

```svelte
{#if editorState.scene && editorState.layout && currentSublocationId}
  <EditorCanvas
    scene={editorState.scene}
    layout={editorState.layout}
    sublocationId={currentSublocationId}
    onHotspotLayoutChange={setHotspotLayout}
    onCharacterLayoutChange={setCharacterLayout}
  />
{/if}
```

- [ ] **Step 5: Run editor check**

Run:

```bash
bun run editor:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/layout-editor/src
git commit -m "feat: add layout editor canvas"
```

Expected: commit succeeds.

---

### Task 9: Final Verification

**Files:**

- No new files. This task verifies the complete branch.

- [ ] **Step 1: Compile scenes**

Run:

```bash
bun run scenes:compile
```

Expected: PASS with compiled scenes and asset report.

- [ ] **Step 2: Run unit/component tests**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run Svelte checks**

Run:

```bash
bun run check
bun run editor:check
```

Expected: both commands PASS.

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS.

- [ ] **Step 5: Run browser-safe layout smoke**

Run:

```bash
bun run test:e2e e2e/investigation-layout.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Confirm game build does not include editor app**

Run:

```bash
bun run build
```

Expected: PASS. Confirm `build/` contains the game app only and no
`apps/layout-editor` files.

- [ ] **Step 7: Commit verification-only fixes if any**

If any verification command required a code fix, commit the fix with the files
changed by that fix:

```bash
git status --short
git add <fixed-files>
git commit -m "fix: stabilize investigation layout integration"
```

Expected: no uncommitted changes remain after the final commit.

---

## Self-Review Notes

- Spec coverage: sidecar schema, compiler merge, Rust view, Svelte scene
  surface, text fallback, separate editor app, editor file writes, and final
  verification are all mapped to tasks.
- Scope control: Phaser is excluded, production game editor bundling is
  excluded, and monorepo migration is not required for the first pass.
- Type consistency: `RectLayout`, `SpriteLayout`, `layout`, `assetId`,
  `bottomCenter`, `HotspotView.layout`, and `CharacterView.layout` are the same
  names across compiler, Rust, frontend, and editor tasks.
