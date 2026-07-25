# HPA-129 Content Identity and Dialogue Runtime Prerequisite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the compiler-owned save-content manifest and replace Lyra's
three flat dialogue queues with one stable, definition-backed segmented runtime
without changing player-visible dialogue behavior.

**Architecture:** The TypeScript compiler projects emitted semantic JSON into
separate structural and content hash inputs, writes one
`save_content_manifest.json`, and owns every stable dialogue origin. Rust loads
that manifest into typed definition references, resolves hashes when installing
dialogue segments, and derives the existing flattened `QueueToken.cursor` from
segment/item coordinates. Disk saves, autosave scheduling, Tauri save commands,
and save UI remain in the follow-on HPA-129 persistence plan.

**Tech Stack:** Bun 1.3.1, TypeScript 5.6, Vitest 4, Node `crypto`, Rust 2021,
Serde/serde_json, Cargo tests.

## Global Constraints

- Treat
  `docs/superpowers/specs/2026-07-25-hpa-129-save-load-autosave-continue-design.md`
  as the authoritative contract, especially §§5, 8, 18.1, and 19.
- The live HPA-129 issue's generic “definition hash” wording is refined by the
  focused design: structural hashes gate compatibility; content hashes are
  diagnostic only.
- Hash only emitted semantic JSON. Never hash Markdown bytes, source locations,
  absolute paths, timestamps, compiler `Map`/`Set` iteration, or Rust
  `HashMap` iteration.
- Structural hashes include IDs, kinds, semantic order/counts, speakers,
  expressions, portraits, visual/audio cues, unlock/reveal/progression graphs,
  and every field that changes cursor or restore meaning.
- Content hashes include dialogue prose, labels, descriptions, details,
  summaries, record display names/content, and equivalent non-structural copy.
- Emit `save_content_manifest.json` on every successful compile, including
  minimal fixtures. It is generated output and must not be hand-edited under
  `apps/game/src-tauri/resources/scenes/`.
- Keep `@lyra/scene-types` unchanged. The manifest is compiler/runtime-only and
  the layout editor must not consume it.
- Stable origins come from semantic IDs plus one closed role mapping. They
  never depend on vector indices, labels, prose, or source paths.
- Preserve the public `QueueToken` contract exactly:
  `cursor = sum(previous segment lengths) + active item cursor`.
- Empty authored blocks do not become runtime segments.
- Keep `EngineRollbackSnapshot` separate from future persistent snapshots and
  classify new immutable/runtime fields through exhaustive destructuring.
- Preserve all current dialogue, history, reveal, acquisition ordering,
  challenge-boundary, scene-tag, visual-cue, and audio-cue behavior.
- Do not add save files, autosave/manual slots, migrations, persistence
  coordinator state, Tauri save commands, or save/load Svelte UI in this plan.
- Use failing-first focused tests, make one task-sized commit after each green
  task, and run the final gates in Task 8 before handoff.

---

## Planned File Map

### Compiler

- Create `packages/scripts/compile-scenes/canonical-json.ts` — strict canonical
  JSON serialization and SHA-256 helpers.
- Create `packages/scripts/compile-scenes/canonical-json.test.ts` — primitive
  determinism and invalid-input coverage.
- Create `packages/scripts/compile-scenes/dialogue-segment-origins.ts` — closed,
  exhaustive mapping from emitted dialogue-bearing fields to typed origins.
- Create `packages/scripts/compile-scenes/dialogue-segment-origins.test.ts` —
  origin stability, completeness, and collision coverage.
- Create `packages/scripts/compile-scenes/save-content-manifest.ts` — manifest
  wire types, structural/content projections, entry sorting, collision checks,
  and bundle revision.
- Create `packages/scripts/compile-scenes/save-content-manifest.test.ts` —
  structural/content boundary and deterministic manifest coverage.
- Modify `packages/scripts/compile-scenes/orchestrator.ts` — emit each scene
  once, build the manifest from emitted values, surgically replace the old
  manifest, and write the new artifact.
- Modify `packages/scripts/compile-scenes.test.ts` — end-to-end artifact,
  repeatability, and stale-output coverage.

### Rust runtime

- Create `apps/game/src-tauri/src/game/content_manifest.rs` — Serde mirror,
  validation, typed lookup index, and manifest-origin constructors.
- Create `apps/game/src-tauri/src/game/dialogue_queue.rs` — shared
  `DialogueSegment`, `ActiveDialogueQueue`, coordinates, and flattening.
- Modify `apps/game/src-tauri/src/game/error.rs` — typed content-manifest and
  dialogue-origin diagnostics.
- Modify `apps/game/src-tauri/src/game/mod.rs` — own the immutable content
  manifest and route current/advance/token logic through the shared queue.
- Modify `apps/game/src-tauri/src/game/command_tx.rs` — classify the manifest as
  immutable and keep dialogue/counter fields rollback-tracked.
- Modify `apps/game/src-tauri/src/game/loader.rs` — retain current scene
  validation while passing chapter/scene identity into runtime construction.
- Modify `apps/game/src-tauri/src/game/navigation.rs` — construct stable linear,
  intro, outro, and phase-entry segment origins.
- Modify `apps/game/src-tauri/src/game/dialogue.rs` — install and advance
  segmented queues while preserving history and scene-tag semantics.
- Modify `apps/game/src-tauri/src/game/reveals.rs` — return ordered segment
  drafts instead of flattening the trigger body and acquisition blocks.
- Modify `apps/game/src-tauri/src/game/scenes/linear.rs` — use the shared active
  queue for the single linear segment.
- Modify `apps/game/src-tauri/src/game/scenes/investigation.rs` — replace
  `DialogueQueue` with `ActiveDialogueQueue`.
- Modify `apps/game/src-tauri/src/game/scenes/interrogation.rs` — replace
  `DialogueQueue`, use a segment/item challenge boundary, and preserve
  cross-exam behavior.
- Modify `apps/game/src-tauri/src/game/scenes/mod.rs` — expose shared active
  queue accessors for all scene variants.
- Modify `apps/game/src-tauri/src/game/test_support.rs` and Rust fixture
  manifests — construct engines with deterministic content manifests.
- Modify `apps/game/src-tauri/tests/full_playthrough.rs` and
  `apps/game/src-tauri/tests/story_catalog_startup.rs` — prove packaged-style
  startup and current playthrough behavior through the new required artifact.

---

### Task 1: Add strict canonical JSON and SHA-256 primitives

**Files:**

- Create: `packages/scripts/compile-scenes/canonical-json.ts`
- Create: `packages/scripts/compile-scenes/canonical-json.test.ts`

**Interfaces:**

- Produces:
  `canonicalJson(value: unknown): string`
- Produces:
  `sha256CanonicalJson(value: unknown): \`sha256:${string}\``
- Consumed by: Task 2 manifest projection and Task 3 bundle revision.

- [ ] **Step 1: Write the failing canonicalization tests**

```ts
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256CanonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
  it("sorts object keys recursively and preserves semantic array order", () => {
    const left = { z: [{ b: 2, a: 1 }], a: true };
    const right = { a: true, z: [{ a: 1, b: 2 }] };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalJson({ items: ["a", "b"] })).not.toBe(
      canonicalJson({ items: ["b", "a"] }),
    );
  });

  it.each([
    { value: Number.NaN, message: "non-finite number" },
    { value: Number.POSITIVE_INFINITY, message: "non-finite number" },
    { value: { missing: undefined }, message: "undefined" },
    { value: 1n, message: "bigint" },
    { value: new Map(), message: "plain JSON object" },
  ])("rejects $message", ({ value, message }) => {
    expect(() => canonicalJson(value)).toThrow(message);
  });

  it("returns a stable lowercase SHA-256 tag", () => {
    const hash = sha256CanonicalJson({ b: 2, a: 1 });
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hash).toBe(sha256CanonicalJson({ a: 1, b: 2 }));
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run:

```bash
rtk bun run test:scripts -- packages/scripts/compile-scenes/canonical-json.test.ts
```

Expected: FAIL because `./canonical-json` does not exist.

- [ ] **Step 3: Implement strict canonicalization**

```ts
import { createHash } from "node:crypto";

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function normalize(value: unknown, path: string): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path}: non-finite number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalize(item, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(`${path}: expected a plain JSON object`);
    }
    const result: Record<string, CanonicalJsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) {
        throw new TypeError(`${path}.${key}: undefined is not canonical JSON`);
      }
      result[key] = normalize(child, `${path}.${key}`);
    }
    return result;
  }
  throw new TypeError(`${path}: unsupported ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, "$"));
}

export function sha256CanonicalJson(
  value: unknown,
): `sha256:${string}` {
  const digest = createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}
```

- [ ] **Step 4: Run focused tests and script type-checking**

Run:

```bash
rtk bun run test:scripts -- packages/scripts/compile-scenes/canonical-json.test.ts
rtk bun run check:scripts
```

Expected: the focused test passes and `check:scripts` exits 0.

- [ ] **Step 5: Commit the canonicalization primitive**

```bash
rtk git add packages/scripts/compile-scenes/canonical-json.ts packages/scripts/compile-scenes/canonical-json.test.ts
rtk git commit -m "feat: add canonical scene hashing primitive"
```

---

### Task 2: Define stable dialogue origins and build the content manifest

**Files:**

- Create: `packages/scripts/compile-scenes/dialogue-segment-origins.ts`
- Create: `packages/scripts/compile-scenes/dialogue-segment-origins.test.ts`
- Create: `packages/scripts/compile-scenes/save-content-manifest.ts`
- Create: `packages/scripts/compile-scenes/save-content-manifest.test.ts`

**Interfaces:**

- Consumes: `sha256CanonicalJson` from Task 1.
- Produces:
  `DialogueSegmentOriginV1`
- Produces:
  `DefinitionRefV1`
- Produces:
  `deriveDialogueSegments(scene): DerivedDialogueSegment[]`
- Produces:
  `buildSaveContentManifest(input): SaveContentManifestV1`
- Produces:
  `definitionRefKey(reference): string`
- Consumed by: Task 3 compiler orchestration and Task 4 Rust Serde mirror.

- [ ] **Step 1: Add failing tests for the hash boundary and stable origins**

Define small typed helpers in the new tests:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { emitInterrogationScene, emitInvestigationScene } from "./emitter";
import { parseInterrogationScene } from "./parser-interrogation";
import { parseInvestigationScene } from "./parser-investigation";
import { deriveDialogueSegments } from "./dialogue-segment-origins";
import {
  buildSaveContentManifest,
  definitionRefKey,
  type DefinitionManifestEntryV1,
  type DefinitionRefV1,
  type EmittedSceneRecordV1,
  type SaveContentManifestV1,
} from "./save-content-manifest";
import type {
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
} from "./types";

const line = (
  text: string,
  speaker = "detective",
): JSONDialogueItem => ({
  kind: "line",
  speaker,
  text,
  expression: null,
  portrait: null,
});

const linear = (
  queue: JSONDialogueItem[],
): EmittedSceneRecordV1<JSONLinearScene> => ({
  chapterId: "chapter_1",
  file: "scene_0.md",
  json: {
    type: "linear",
    id: "scene_0",
    title: "Opening",
    queue,
    assetRefs: [],
  },
});

function investigation(): JSONInvestigationScene {
  const path =
    "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md";
  const parsed = parseInvestigationScene(
    readFileSync(resolve(path), "utf8"),
    path,
    "investigation_scene_1",
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return emitInvestigationScene(parsed.value);
}

function interrogation(): JSONInterrogationScene {
  const path =
    "packages/scripts/__fixtures__/valid_interrogation/chapter_1/interrogation_scene_1.md";
  const parsed = parseInterrogationScene(
    readFileSync(resolve(path), "utf8"),
    path,
    "interrogation_scene_1",
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return emitInterrogationScene(parsed.value);
}

function manifestFor(
  scenes: EmittedSceneRecordV1[],
): SaveContentManifestV1 {
  return buildSaveContentManifest({
    chapters: {
      chapters: [{
        id: "chapter_1",
        title: "Chapter 1",
        summary: "Summary",
        scenes: scenes.map(({ file, json }) => ({
          type: json.type,
          file: `chapter_1/${file.replace(/\.md$/, ".json")}`,
        })),
      }],
    },
    scenes,
    storyCatalog: {
      schemaVersion: 1,
      facts: [],
      questions: [],
      objectives: [],
      authorizations: [],
      evidenceIndex: [],
      statementsIndex: [],
    },
  });
}

function entry(
  manifest: SaveContentManifestV1,
  reference: DefinitionRefV1,
): DefinitionManifestEntryV1 {
  const key = definitionRefKey(reference);
  const found = manifest.definitions.find(
    (candidate) => definitionRefKey(candidate.reference) === key,
  );
  if (!found) throw new Error(`missing test entry ${key}`);
  return found;
}
```

Assert these exact rules:

```ts
it("keeps prose changes structurally compatible", () => {
  const before = linear([line("Original copy")]);
  const after = linear([line("Corrected copy")]);

  const beforeManifest = manifestFor([before]);
  const afterManifest = manifestFor([after]);
  const beforeScene = entry(beforeManifest, {
    type: "scene",
    chapterId: "chapter_1",
    sceneId: "scene_0",
    sceneKind: "linear",
  });
  const afterScene = entry(afterManifest, beforeScene.reference);

  expect(afterScene.structuralHash).toBe(beforeScene.structuralHash);
  expect(afterScene.contentHash).not.toBe(beforeScene.contentHash);
  expect(afterManifest.contentRevision).not.toBe(
    beforeManifest.contentRevision,
  );
});

it("changes structure for speaker, cue, order, and progression edits", () => {
  const baseline = entry(
    manifestFor([linear([line("A"), line("B")])]),
    {
      type: "scene",
      chapterId: "chapter_1",
      sceneId: "scene_0",
      sceneKind: "linear",
    },
  );
  const speakerEdit = entry(
    manifestFor([linear([line("A", "other"), line("B")])]),
    baseline.reference,
  );
  const orderEdit = entry(
    manifestFor([linear([line("B"), line("A")])]),
    baseline.reference,
  );
  const cueEdit = entry(
    manifestFor([linear([{
      kind: "sceneTag",
      text: "same copy",
      assetCue: {
        backgroundAssetId: "background.changed",
        bgm: null,
        bgs: null,
      },
    }, line("B")])]),
    baseline.reference,
  );

  expect(speakerEdit.structuralHash).not.toBe(baseline.structuralHash);
  expect(orderEdit.structuralHash).not.toBe(baseline.structuralHash);
  expect(cueEdit.structuralHash).not.toBe(baseline.structuralHash);

  const beforeInvestigation = investigation();
  const afterInvestigation = structuredClone(beforeInvestigation);
  afterInvestigation.sublocations[0]!.hotspots[0]!.reveals = [
    { kind: "evidence", id: "changed_record" },
  ];
  const beforeEntry = entry(
    manifestFor([{
      chapterId: "chapter_1",
      file: "investigation_scene_1.md",
      json: beforeInvestigation,
    }]),
    {
      type: "scene",
      chapterId: "chapter_1",
      sceneId: "investigation_scene_1",
      sceneKind: "investigation",
    },
  );
  const afterEntry = entry(
    manifestFor([{
      chapterId: "chapter_1",
      file: "investigation_scene_1.md",
      json: afterInvestigation,
    }]),
    beforeEntry.reference,
  );
  expect(afterEntry.structuralHash).not.toBe(beforeEntry.structuralHash);
});

it("derives stable semantic origins without vector indices or copy", () => {
  const origins = deriveDialogueSegments({
    chapterId: "chapter_1",
    file: "interrogation_scene_1.md",
    json: interrogation(),
  }).map(
    ({ origin }) => origin,
  );
  expect(origins).toContainEqual({
    type: "interrogationPhase",
    chapterId: "chapter_1",
    sceneId: "interrogation_scene_1",
    phaseId: "press",
    segmentId: "question:alibi:line:l_deny:onCorrect",
  });
  expect(JSON.stringify(origins)).not.toContain("Original copy");
});

it("rejects duplicate typed references", () => {
  expect(() => manifestFor([
    linear([line("First")]),
    linear([line("Duplicate ID")]),
  ])).toThrow(
    "duplicate save-content definition reference",
  );
});
```

- [ ] **Step 2: Run the two focused files and verify they fail**

Run:

```bash
rtk bun run test:scripts -- packages/scripts/compile-scenes/dialogue-segment-origins.test.ts packages/scripts/compile-scenes/save-content-manifest.test.ts
```

Expected: FAIL because the two modules and exported types do not exist.

- [ ] **Step 3: Add the closed wire types**

Add compiler/runtime-only types to `save-content-manifest.ts`; do not export
them from `@lyra/scene-types`:

```ts
export type SceneKindV1 = "linear" | "investigation" | "interrogation";
export type RecordKindV1 = "evidence" | "statement";

export type DialogueSegmentOriginV1 =
  | {
      type: "linearScene";
      chapterId: string;
      sceneId: string;
    }
  | {
      type: "investigationIntro" | "investigationOutro";
      chapterId: string;
      sceneId: string;
    }
  | {
      type: "investigationInteraction";
      chapterId: string;
      sceneId: string;
      interactionId: string;
      segmentId: string;
    }
  | {
      type: "interrogationIntro" | "interrogationOutro";
      chapterId: string;
      sceneId: string;
    }
  | {
      type: "interrogationPhase";
      chapterId: string;
      sceneId: string;
      phaseId: string;
      segmentId: string;
    };

export type DefinitionRefV1 =
  | {
      type: "scene";
      chapterId: string;
      sceneId: string;
      sceneKind: SceneKindV1;
    }
  | { type: "dialogueSegment"; origin: DialogueSegmentOriginV1 }
  | { type: "inventoryRecord"; recordKind: RecordKindV1; recordId: string }
  | { type: "fact" | "question" | "objective" | "authorization"; id: string };

export type DefinitionManifestEntryV1 = {
  reference: DefinitionRefV1;
  structuralHash: `sha256:${string}`;
  contentHash: `sha256:${string}`;
};

export type SaveContentManifestV1 = {
  manifestVersion: 1;
  contentRevision: `sha256:${string}`;
  definitions: DefinitionManifestEntryV1[];
};

export type EmittedSceneJsonV1 =
  | JSONLinearScene
  | JSONInvestigationScene
  | JSONInterrogationScene;

export type EmittedSceneRecordV1<
  T extends EmittedSceneJsonV1 = EmittedSceneJsonV1,
> = {
  chapterId: string;
  file: string;
  json: T;
};

export type BuildSaveContentManifestInput = {
  chapters: JSONChaptersIndex;
  scenes: EmittedSceneRecordV1[];
  storyCatalog: StoryCatalogJson;
};
```

- [ ] **Step 4: Implement one exhaustive origin enumerator**

`deriveDialogueSegments` must visit every emitted dialogue-bearing field below
and omit blocks whose emitted item array is empty:

| Scene | Field | `segmentId` |
| --- | --- | --- |
| linear | `queue` | origin variant `linearScene` |
| investigation | `intro` / `outro.dialogue` | dedicated intro/outro variants |
| investigation | sublocation transition | `sublocation:<id>:transition` |
| investigation | hotspot inspect/reexamine | `hotspot:<id>:inspect`, `hotspot:<id>:reexamine` |
| investigation | topic dialogue/reexamine | `topic:<characterId>:<topicId>:dialogue`, `topic:<characterId>:<topicId>:reexamine` |
| investigation | evidence collect/reexamine | `evidence:<id>:onCollect`, `evidence:<id>:onReexamine` |
| investigation | statement acquire/reexamine | `statement:<id>:onAcquire`, `statement:<id>:onReexamine` |
| interrogation | `intro` / `outro.dialogue` | dedicated intro/outro variants |
| interrogation | phase entry | `phase:<phaseId>:entry` |
| interrogation | question testimony blocks | `question:<questionId>:onLoop`, `loopPrompt`, `defaultChallenge`, `defaultWrong`, `wrongReply` |
| interrogation | testimony line blocks | `question:<questionId>:line:<lineId>:content`, `challenge`, `onCorrect`, `onWrongEvidence` |
| interrogation | evidence collect/reexamine | `evidence:<id>:onCollect`, `evidence:<id>:onReexamine` |
| interrogation | statement acquire/reexamine | `statement:<id>:onAcquire`, `statement:<id>:onReexamine` |

Use closed helpers rather than feature-local string formatting:

```ts
export function investigationInteractionOrigin(
  chapterId: string,
  sceneId: string,
  interactionId: string,
  segmentId: string,
): DialogueSegmentOriginV1 {
  return {
    type: "investigationInteraction",
    chapterId,
    sceneId,
    interactionId,
    segmentId,
  };
}

export function interrogationPhaseOrigin(
  chapterId: string,
  sceneId: string,
  phaseId: string,
  segmentId: string,
): DialogueSegmentOriginV1 {
  return {
    type: "interrogationPhase",
    chapterId,
    sceneId,
    phaseId,
    segmentId,
  };
}
```

The enumerator returns:

```ts
export type DerivedDialogueSegment = {
  origin: DialogueSegmentOriginV1;
  items: JSONDialogueItem[];
};
```

- [ ] **Step 5: Implement structural/content projections and manifest assembly**

Implement explicit projectors for scenes, dialogue items, inventory records,
and global catalog definitions. The dialogue item projector is the critical
boundary:

```ts
function dialogueItemStructural(item: JSONDialogueItem): unknown {
  switch (item.kind) {
    case "sceneTag":
      return {
        kind: item.kind,
        assetCue: item.assetCue,
      };
    case "action":
      return { kind: item.kind };
    case "line":
      return {
        kind: item.kind,
        speaker: item.speaker,
        expression: item.expression,
        portrait: item.portrait,
      };
  }
}

function dialogueItemContent(item: JSONDialogueItem): unknown {
  switch (item.kind) {
    case "sceneTag":
    case "action":
      return { kind: item.kind, text: item.text };
    case "line":
      return {
        kind: item.kind,
        speaker: item.speaker,
        text: item.text,
      };
  }
}
```

For scene structures, retain IDs, statuses, unlock expressions, reveal targets,
contradictions, required/kind flags, semantic array order, and the structural
projection of every dialogue array. Exclude labels and display copy from the
structural projection. For content projections, retain the typed reference and
all labels, names, descriptions, details, summaries, statement content, and
dialogue content projections.

Assemble and sort with canonical typed-reference keys:

```ts
export function definitionRefKey(reference: DefinitionRefV1): string {
  return canonicalJson(reference);
}

function entry(
  reference: DefinitionRefV1,
  structural: unknown,
  content: unknown,
): DefinitionManifestEntryV1 {
  return {
    reference,
    structuralHash: sha256CanonicalJson(structural),
    contentHash: sha256CanonicalJson(content),
  };
}

export function finalizeManifest(
  definitions: DefinitionManifestEntryV1[],
): SaveContentManifestV1 {
  const seen = new Set<string>();
  const sorted = [...definitions].sort((left, right) =>
    definitionRefKey(left.reference).localeCompare(
      definitionRefKey(right.reference),
    ),
  );
  for (const definition of sorted) {
    const key = definitionRefKey(definition.reference);
    if (seen.has(key)) {
      throw new Error(`duplicate save-content definition reference: ${key}`);
    }
    seen.add(key);
  }
  return {
    manifestVersion: 1,
    contentRevision: sha256CanonicalJson({
      manifestVersion: 1,
      definitions: sorted,
    }),
    definitions: sorted,
  };
}
```

- [ ] **Step 6: Run focused tests and script type-checking**

Run:

```bash
rtk bun run test:scripts -- packages/scripts/compile-scenes/dialogue-segment-origins.test.ts packages/scripts/compile-scenes/save-content-manifest.test.ts
rtk bun run check:scripts
```

Expected: all focused cases pass and `check:scripts` exits 0.

- [ ] **Step 7: Commit manifest construction**

```bash
rtk git add packages/scripts/compile-scenes/dialogue-segment-origins.ts packages/scripts/compile-scenes/dialogue-segment-origins.test.ts packages/scripts/compile-scenes/save-content-manifest.ts packages/scripts/compile-scenes/save-content-manifest.test.ts
rtk git commit -m "feat: derive stable save content identities"
```

---

### Task 3: Emit `save_content_manifest.json` from the compiler

**Files:**

- Modify: `packages/scripts/compile-scenes/orchestrator.ts:358-410`
- Modify: `packages/scripts/compile-scenes.test.ts`

**Interfaces:**

- Consumes: `buildSaveContentManifest` from Task 2.
- Produces: `<outputRoot>/save_content_manifest.json`.
- Preserves: current scene, `chapters.json`, `story_catalog.json`, asset
  manifest, report, warning, and compile-result contracts.
- Consumed by: Task 4 Rust loader and all packaged builds.

- [ ] **Step 1: Extend the end-to-end compiler test first**

Import `definitionRefKey` from `./compile-scenes/save-content-manifest`. In the
valid-fixture test, assert:

```ts
const contentManifest = JSON.parse(
  readFileSync(resolve(outRoot, "save_content_manifest.json"), "utf8"),
);
expect(contentManifest).toMatchObject({
  manifestVersion: 1,
  contentRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
});
expect(contentManifest.definitions).toEqual(
  [...contentManifest.definitions].sort((left, right) =>
    definitionRefKey(left.reference).localeCompare(
      definitionRefKey(right.reference),
    ),
  ),
);
expect(contentManifest.definitions).toContainEqual(
  expect.objectContaining({
    reference: {
      type: "dialogueSegment",
      origin: {
        type: "linearScene",
        chapterId: "chapter_1",
        sceneId: "scene_0",
      },
    },
  }),
);
```

Add a second test that compiles the same fixture into two temporary output
roots and compares `save_content_manifest.json` byte-for-byte. Add a stale-file
test that pre-writes an old manifest, forces compile failure, and verifies the
old file is preserved; a later successful compile must replace it.

- [ ] **Step 2: Run the focused end-to-end compiler test and verify failure**

Run:

```bash
rtk bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Expected: FAIL because the compiler does not emit
`save_content_manifest.json`.

- [ ] **Step 3: Emit semantic JSON once and build the manifest before writes**

Refactor the current final block so the same emitted objects feed both disk
JSON and hashes:

```ts
const emittedScenes = scenes.map((record) => ({
  chapterId: record.chapterId,
  file: record.file,
  json:
    record.ast.kind === "linearScene"
      ? emitLinearScene(record.ast)
      : record.ast.kind === "investigationScene"
        ? emitInvestigationScene(record.ast)
        : emitInterrogationScene(record.ast),
}));
const chaptersJson = emitChaptersIndex(chapters);
const storyCatalogJson = emitStoryCatalog(storyCatalog, scenes);
const saveContentManifest = buildSaveContentManifest({
  chapters: chaptersJson,
  scenes: emittedScenes,
  storyCatalog: storyCatalogJson,
});
```

Build all four values after validation succeeds but before deleting old
generated outputs. If manifest construction throws, convert it to one
compiler-internal `CompileError` and return without altering the existing
resource tree.

- [ ] **Step 4: Add surgical replacement and write**

Extend the owned-output list:

```ts
const oldSaveContentManifest = resolve(
  opts.outputRoot,
  "save_content_manifest.json",
);
if (existsSync(oldSaveContentManifest)) {
  rmSync(oldSaveContentManifest, { force: true });
}
```

Write the already-built values:

```ts
writeFileSync(
  resolve(opts.outputRoot, "save_content_manifest.json"),
  `${JSON.stringify(saveContentManifest, null, 2)}\n`,
);
```

Update the surgical-delete comment to name all three root JSON artifacts.

- [ ] **Step 5: Run compiler verification**

Run:

```bash
rtk bun run test:scripts -- packages/scripts/compile-scenes.test.ts packages/scripts/compile-scenes/save-content-manifest.test.ts packages/scripts/compile-scenes/dialogue-segment-origins.test.ts
rtk bun run scenes:compile
rtk bun run check:scripts
```

Expected: focused tests pass, live Chapter 1 compilation emits the manifest,
and script type-checking exits 0. Generated resource JSON remains ignored.

- [ ] **Step 6: Commit compiler orchestration**

```bash
rtk git add packages/scripts/compile-scenes/orchestrator.ts packages/scripts/compile-scenes.test.ts
rtk git commit -m "feat: emit save content manifest"
```

---

### Task 4: Load and validate the typed manifest in Rust

**Files:**

- Create: `apps/game/src-tauri/src/game/content_manifest.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`

**Interfaces:**

- Consumes: Task 2's exact camelCase manifest wire.
- Produces:
  `ContentManifest::load(resources_dir: &Path) -> Result<Self, GameError>`
- Produces:
  `ContentManifest::hashes(&DefinitionRefV1) -> Result<&DefinitionHashes, GameError>`
- Produces: `ContentManifest::content_revision() -> &str` for the follow-on
  save envelope without exposing mutable manifest state.
- Produces: Rust `DialogueSegmentOriginV1` constructors matching Task 2.
- Consumed by: Tasks 6–7 queue installation and the follow-on persistence
  plan's compatibility validation.

- [ ] **Step 1: Write failing Rust loader tests**

Use the same process-unique `TestDir`/`Drop` pattern already present in
`story/catalog.rs`, plus:

```rust
fn load_fixture(source: &str) -> Result<ContentManifest, GameError> {
    let dir = TestDir::new("content-manifest");
    std::fs::write(dir.path().join("save_content_manifest.json"), source)
        .unwrap();
    ContentManifest::load(dir.path())
}
```

Cover:

```rust
#[test]
fn loads_version_one_and_indexes_typed_references() {
    let manifest = load_fixture(r#"{
      "manifestVersion": 1,
      "contentRevision": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "definitions": [{
        "reference": {
          "type": "dialogueSegment",
          "origin": {
            "type": "linearScene",
            "chapterId": "chapter_1",
            "sceneId": "scene_0"
          }
        },
        "structuralHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "contentHash": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      }]
    }"#).unwrap();

    assert_eq!(
        manifest.hashes(&DefinitionRefV1::DialogueSegment {
            origin: DialogueSegmentOriginV1::LinearScene {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_0".into(),
            },
        }).unwrap().structural_hash,
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
}
```

Also reject missing file, malformed JSON, unsupported `manifestVersion`,
duplicate typed references, malformed hash prefix/length/hex, and a missing
lookup with distinct typed error codes.

- [ ] **Step 2: Run the focused Rust test and verify failure**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml content_manifest
```

Expected: FAIL because `game::content_manifest` does not exist.

- [ ] **Step 3: Add the Serde mirror and lookup index**

Use typed enums; never use a composite definition-key string:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::game) enum SceneKindV1 {
    Linear,
    Investigation,
    Interrogation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::game) enum RecordKindV1 {
    Evidence,
    Statement,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(in crate::game) enum DialogueSegmentOriginV1 {
    LinearScene {
        chapter_id: String,
        scene_id: String,
    },
    InvestigationIntro {
        chapter_id: String,
        scene_id: String,
    },
    InvestigationOutro {
        chapter_id: String,
        scene_id: String,
    },
    InvestigationInteraction {
        chapter_id: String,
        scene_id: String,
        interaction_id: String,
        segment_id: String,
    },
    InterrogationIntro {
        chapter_id: String,
        scene_id: String,
    },
    InterrogationOutro {
        chapter_id: String,
        scene_id: String,
    },
    InterrogationPhase {
        chapter_id: String,
        scene_id: String,
        phase_id: String,
        segment_id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(in crate::game) enum DefinitionRefV1 {
    Scene {
        chapter_id: String,
        scene_id: String,
        scene_kind: SceneKindV1,
    },
    DialogueSegment {
        origin: DialogueSegmentOriginV1,
    },
    InventoryRecord {
        record_kind: RecordKindV1,
        record_id: String,
    },
    Fact { id: String },
    Question { id: String },
    Objective { id: String },
    Authorization { id: String },
}

#[derive(Clone, Debug)]
pub(in crate::game) struct DefinitionHashes {
    pub structural_hash: String,
    pub content_hash: String,
}

pub(in crate::game) struct ContentManifest {
    content_revision: String,
    definitions: HashMap<DefinitionRefV1, DefinitionHashes>,
}

impl ContentManifest {
    pub(in crate::game) fn content_revision(&self) -> &str {
        &self.content_revision
    }
}
```

Deserialize through a minimal version envelope first, then the V1 document.
Validate every hash with a dependency-free helper:

```rust
fn valid_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit()
            && !byte.is_ascii_uppercase())
}
```

- [ ] **Step 4: Add closed Rust origin constructors**

Centralize role strings so gameplay code cannot hand-roll them:

```rust
impl DialogueSegmentOriginV1 {
    pub(in crate::game) fn hotspot(
        chapter_id: &str,
        scene_id: &str,
        hotspot_id: &str,
        role: HotspotDialogueRole,
    ) -> Self {
        Self::InvestigationInteraction {
            chapter_id: chapter_id.into(),
            scene_id: scene_id.into(),
            interaction_id: hotspot_id.into(),
            segment_id: format!("hotspot:{hotspot_id}:{}", role.as_str()),
        }
    }
}

pub(in crate::game) enum HotspotDialogueRole {
    Inspect,
    Reexamine,
}

impl HotspotDialogueRole {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Inspect => "inspect",
            Self::Reexamine => "reexamine",
        }
    }
}
```

Add equivalent closed constructors/enums for sublocation transition, topic
dialogue/reexamine, interrogation phase entry, question testimony blocks, and
testimony-line blocks. Define these two acquisition families explicitly for
both scene kinds:

```rust
pub(in crate::game) enum EvidenceDialogueRole {
    OnCollect,
    OnReexamine,
}

pub(in crate::game) enum StatementDialogueRole {
    OnAcquire,
    OnReexamine,
}

DialogueSegmentOriginV1::investigation_evidence(
    chapter_id,
    scene_id,
    evidence_id,
    EvidenceDialogueRole::OnCollect,
);
DialogueSegmentOriginV1::investigation_statement(
    chapter_id,
    scene_id,
    statement_id,
    StatementDialogueRole::OnAcquire,
);
DialogueSegmentOriginV1::interrogation_evidence(
    chapter_id,
    scene_id,
    phase_id,
    evidence_id,
    EvidenceDialogueRole::OnCollect,
);
DialogueSegmentOriginV1::interrogation_statement(
    chapter_id,
    scene_id,
    phase_id,
    statement_id,
    StatementDialogueRole::OnAcquire,
);
```

The investigation constructors emit `InvestigationInteraction`; the
interrogation constructors emit `InterrogationPhase`. Each constructor owns
the exact `evidence:<id>:<role>` or `statement:<id>:<role>` spelling. Tests
must compare every constructor's serialized origin against the Task 2 fixture
manifest.

- [ ] **Step 5: Run focused tests and Rust formatting**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml content_manifest
rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
```

Expected: focused tests pass and formatting exits 0.

- [ ] **Step 6: Commit the Rust manifest contract**

```bash
rtk git add apps/game/src-tauri/src/game/content_manifest.rs apps/game/src-tauri/src/game/error.rs apps/game/src-tauri/src/game/mod.rs
rtk git commit -m "feat: load typed save content manifest"
```

---

### Task 5: Add the shared segmented queue primitive

**Files:**

- Create: `apps/game/src-tauri/src/game/dialogue_queue.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`

**Interfaces:**

- Consumes: `DialogueSegmentOriginV1` and `DefinitionHashes` from Task 4.
- Produces: `DialoguePosition { segment_index, item_cursor }`.
- Produces:
  `DialogueSegment { origin, structural_hash, content_hash, items }`.
- Produces:
  `ActiveDialogueQueue::new`, `current`, `position`, `flattened_cursor`,
  `queue_remaining`, `is_at_or_after`, `advance`, and `just_consumed`.
- Consumed by: Task 6 scene integration and future save capture/restore.

- [ ] **Step 1: Write failing queue-unit tests**

```rust
fn line(text: &str) -> DialogueItem {
    DialogueItem::Line {
        speaker: "A".into(),
        text: text.into(),
        portrait: None,
    }
}

fn segment(id: &str, items: Vec<DialogueItem>) -> DialogueSegment {
    DialogueSegment {
        origin: DialogueSegmentOriginV1::InvestigationInteraction {
            chapter_id: "chapter_1".into(),
            scene_id: "investigation_scene_1".into(),
            interaction_id: "hotspot".into(),
            segment_id: id.into(),
        },
        structural_hash:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        content_hash:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into(),
        items,
    }
}

#[test]
fn advances_across_segments_and_preserves_flattened_cursor() {
    let mut queue = ActiveDialogueQueue::new(
        vec![
            segment("first", vec![line("a"), line("b")]),
            segment("second", vec![line("c")]),
        ],
        41,
    ).unwrap().unwrap();

    assert_eq!(queue.position(), DialoguePosition {
        segment_index: 0,
        item_cursor: 0,
    });
    assert_eq!(queue.flattened_cursor(), 0);
    assert_eq!(queue.queue_remaining(), 2);

    assert_eq!(queue.advance().unwrap().consumed, line("a"));
    assert_eq!(queue.flattened_cursor(), 1);
    assert_eq!(queue.advance().unwrap().consumed, line("b"));
    assert_eq!(queue.position(), DialoguePosition {
        segment_index: 1,
        item_cursor: 0,
    });
    assert_eq!(queue.flattened_cursor(), 2);
}

#[test]
fn omits_empty_segments_but_rejects_overflow_and_invalid_coordinates() {
    assert!(ActiveDialogueQueue::new(vec![segment("empty", vec![])], 1)
        .unwrap()
        .is_none());
    assert!(ActiveDialogueQueue::from_position(
        vec![segment("one", vec![line("a")])],
        DialoguePosition { segment_index: 2, item_cursor: 0 },
        1,
    ).is_err());
}
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_queue
```

Expected: FAIL because `dialogue_queue.rs` does not exist.

- [ ] **Step 3: Implement queue data and coordinate methods**

```rust
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub(in crate::game) struct DialoguePosition {
    pub segment_index: usize,
    pub item_cursor: usize,
}

#[derive(Clone, Debug)]
pub(in crate::game) struct DialogueSegment {
    pub origin: DialogueSegmentOriginV1,
    pub structural_hash: String,
    pub content_hash: String,
    pub items: Vec<DialogueItem>,
}

#[derive(Clone, Debug)]
pub(in crate::game) struct ActiveDialogueQueue {
    segments: Vec<DialogueSegment>,
    segment_offsets: Vec<usize>,
    total_items: usize,
    position: DialoguePosition,
    queue_gen: u64,
    last_consumed: Option<DialogueItem>,
}

pub(in crate::game) struct DialogueAdvance {
    pub consumed: DialogueItem,
    pub exhausted: bool,
}
```

`new` filters empty segments before setting `{0, 0}` and returns `Ok(None)` if
none remain. While constructing `segment_offsets`, it uses checked addition and
returns `GameError` on total-length overflow. `flattened_cursor` then returns
`segment_offsets[position.segment_index] + position.item_cursor` without a
fallible public-view path. `is_at_or_after(boundary)` uses the derived
lexicographic `(segment_index, item_cursor)` ordering. `advance` clones the
current item, increments within the current segment, moves to the next segment
when needed, and reports exhaustion only after the last item. `from_position`
validates both indices before constructing the queue.

- [ ] **Step 4: Add segment-draft resolution**

```rust
pub(in crate::game) struct DialogueSegmentDraft {
    pub origin: DialogueSegmentOriginV1,
    pub items: Vec<DialogueItem>,
}

impl DialogueSegmentDraft {
    pub fn resolve(
        self,
        manifest: &ContentManifest,
    ) -> Result<Option<DialogueSegment>, GameError> {
        if self.items.is_empty() {
            return Ok(None);
        }
        let hashes = manifest.hashes(&DefinitionRefV1::DialogueSegment {
            origin: self.origin.clone(),
        })?;
        Ok(Some(DialogueSegment {
            origin: self.origin,
            structural_hash: hashes.structural_hash.clone(),
            content_hash: hashes.content_hash.clone(),
            items: self.items,
        }))
    }
}
```

- [ ] **Step 5: Run focused tests and Rust checks**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_queue
rtk cargo check --manifest-path apps/game/src-tauri/Cargo.toml
rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
```

Expected: queue tests pass, Cargo check exits 0, and formatting is clean.

- [ ] **Step 6: Commit the queue primitive**

```bash
rtk git add apps/game/src-tauri/src/game/dialogue_queue.rs apps/game/src-tauri/src/game/mod.rs
rtk git commit -m "feat: add segmented dialogue queue"
```

---

### Task 6: Migrate all scene runtimes and single-block installers

**Files:**

- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/command_tx.rs`
- Modify: `apps/game/src-tauri/src/game/dialogue.rs`
- Modify: `apps/game/src-tauri/src/game/loader.rs`
- Modify: `apps/game/src-tauri/src/game/navigation.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/mod.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/linear.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/investigation.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/interrogation.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`
- Modify: `apps/game/src-tauri/tests/fixtures/scenes/save_content_manifest.json`
- Modify:
  `apps/game/src-tauri/tests/fixtures/full_scenes/save_content_manifest.json`
- Modify: `apps/game/src-tauri/tests/story_catalog_startup.rs`

**Interfaces:**

- Consumes: Tasks 4–5 manifest and queue.
- Produces: one active queue accessor across `SceneRuntime`.
- Produces:
  `GameEngine::install_dialogue_segments(Vec<DialogueSegmentDraft>, Option<DialoguePosition>)`.
- Preserves: every existing public `QueueToken`, `ModeView::Dialogue`,
  history, cue, phase-boundary, and command return type.
- Consumed by: Task 7 composite queue producers and the persistence plan.

- [ ] **Step 1: Add regression tests before changing scene fields**

Add engine tests that record the full public sequence of:

```rust
fn public_dialogue_frame(engine: &GameEngine) -> (QueueToken, DialogueItem, usize) {
    match engine.view().mode {
        ModeView::Dialogue {
            queue_token,
            current,
            queue_remaining,
            ..
        } => (queue_token, current, queue_remaining),
        other => panic!("expected dialogue, got {other:?}"),
    }
}
```

Cover linear dialogue, investigation intro/outro, sublocation transition,
hotspot inspect, topic dialogue, interrogation intro/outro, phase entry,
question loop, and testimony line content. For each case, assert the same
flattened cursor progression and history last-token deduplication that the
current flat queue produces.

- [ ] **Step 2: Run focused Rust tests and capture the green baseline**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::dialogue
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::scenes
```

Expected: current baseline tests pass before the refactor.

- [ ] **Step 3: Make the content manifest immutable engine state**

Load in `GameEngine::new_started` after the story catalog and before the first
scene:

```rust
let content_manifest = ContentManifest::load(&resources_dir)?;
```

Add `content_manifest: ContentManifest` to `GameEngine`. In
`EngineRollbackSnapshot::capture`, bind it as immutable:

```rust
let GameEngine {
    resources_dir: _,
    chapters: _,
    story_catalog: _,
    content_manifest: _,
    story_state,
    // every rollback-tracked field remains named below
} = engine;
```

Update both Rust fixture manifests with deterministic typed entries for every
fixture scene/segment/global definition, using valid test hashes and references
that match the compiler contract tests. In
`story_catalog_startup.rs`, keep story-catalog loading before manifest loading
so the existing missing-catalog diagnostic remains authoritative; add a second
case where the catalog exists but the content manifest is missing.

- [ ] **Step 4: Replace three queue shapes with one shared accessor**

Use:

```rust
impl SceneRuntime {
    pub(in crate::game) fn active_dialogue(
        &self,
    ) -> Option<&ActiveDialogueQueue> {
        match self {
            Self::Linear(scene) => scene.active_dialogue.as_ref(),
            Self::Investigation(scene) => scene.active_dialogue.as_ref(),
            Self::Interrogation(scene) => scene.active_dialogue.as_ref(),
        }
    }

    pub(in crate::game) fn active_dialogue_mut(
        &mut self,
    ) -> Option<&mut ActiveDialogueQueue> {
        match self {
            Self::Linear(scene) => scene.active_dialogue.as_mut(),
            Self::Investigation(scene) => scene.active_dialogue.as_mut(),
            Self::Interrogation(scene) => scene.active_dialogue.as_mut(),
        }
    }
}
```

Rename investigation/interrogation `pending_queue` to `active_dialogue`.
Replace linear `queue/cursor/queue_gen` with
`active_dialogue: Option<ActiveDialogueQueue>`. Replace interrogation's flat
`line_content_start: usize` with
`line_content_boundary: Option<DialoguePosition>`. The inline challenge guard
uses `queue.is_at_or_after(boundary)`; set the boundary to the first item of the
testimony-line content segment so challenge availability remains identical at
every visible item.

- [ ] **Step 5: Centralize installation and public token derivation**

```rust
pub(super) fn install_dialogue_segments(
    &mut self,
    drafts: Vec<DialogueSegmentDraft>,
    line_content_boundary: Option<DialoguePosition>,
) -> Result<(), GameError> {
    let resolved = drafts
        .into_iter()
        .map(|draft| draft.resolve(&self.content_manifest))
        .collect::<Result<Vec<_>, _>>()?;
    let segments = resolved.into_iter().flatten().collect::<Vec<_>>();
    if segments.is_empty() {
        return self.on_queue_exhausted();
    }
    let queue_gen = self.alloc_queue_gen();
    let queue = ActiveDialogueQueue::new(segments, queue_gen)?
        .expect("resolved non-empty dialogue segments produce a queue");
    self.scene.set_active_dialogue(Some(queue));
    self.scene.set_line_content_boundary(line_content_boundary);
    self.consume_scene_tags_at_cursor();
    Ok(())
}
```

Have `current_dialogue_item`, `peek_just_consumed`,
`consume_scene_tags_at_cursor`, `advance_dialogue`, `mode_view`, and
`current_queue_token` use the shared queue methods. Build the public token with:

```rust
QueueToken {
    scene_id: self.current_scene_id().to_string(),
    queue_gen: queue.queue_gen(),
    cursor: queue.flattened_cursor(),
}
```

- [ ] **Step 6: Install typed origins for single authored blocks**

Migrate these producers first:

- linear body;
- investigation/interrogation intro and outro;
- investigation sublocation transition;
- hotspot inspect/reexamine body;
- topic dialogue/reexamine body;
- interrogation phase entry;
- testimony `onLoop`, `loopPrompt`, line `content`, `challenge`,
  `onCorrect`, `onWrongEvidence`, `defaultChallenge`, `defaultWrong`, and
  `wrongReply`;
- inventory record reexamine blocks.

Every call passes one `DialogueSegmentDraft` with a Task 4 constructor. Do not
concatenate two authored blocks at a call site.

- [ ] **Step 7: Run focused and full Rust tests**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::dialogue
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::scenes
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story_catalog_startup
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
```

Expected: all Rust tests pass and formatting is clean.

- [ ] **Step 8: Commit shared queue integration**

```bash
rtk git add apps/game/src-tauri/src/game apps/game/src-tauri/tests
rtk git commit -m "refactor: use segmented dialogue runtime"
```

---

### Task 7: Preserve composite acquisition/reveal segment boundaries

**Files:**

- Modify: `apps/game/src-tauri/src/game/reveals.rs`
- Modify: `apps/game/src-tauri/src/game/acquisition.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/dialogue.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`
- Modify: `apps/game/src-tauri/tests/full_playthrough.rs`

**Interfaces:**

- Consumes: `DialogueSegmentDraft` and origin constructors from Tasks 4–6.
- Produces: ordered `Vec<DialogueSegmentDraft>` from reveal/acquisition
  composition.
- Preserves: inventory mutation/reveal order and one public flattened token.
- Establishes: exact composite segment/item coordinates for future save
  capture.

- [ ] **Step 1: Write failing composite-order tests**

Build a command that emits:

1. hotspot result body;
2. evidence `onCollect`;
3. statement `onAcquire`.

Assert:

```rust
let queue = engine.scene.active_dialogue().unwrap();
assert_eq!(
    queue.segment_origins(),
    &[
        DialogueSegmentOriginV1::hotspot(
            "chapter_1",
            "investigation_scene_1",
            "hotspot_a",
            HotspotDialogueRole::Inspect,
        ),
        DialogueSegmentOriginV1::investigation_evidence(
            "chapter_1",
            "investigation_scene_1",
            "evidence_a",
            EvidenceDialogueRole::OnCollect,
        ),
        DialogueSegmentOriginV1::investigation_statement(
            "chapter_1",
            "investigation_scene_1",
            "statement_a",
            StatementDialogueRole::OnAcquire,
        ),
    ],
);
assert_eq!(queue.flattened_cursor(), 0);
```

Advance to the first item of each segment and assert both its
`DialoguePosition` and flattened public cursor. Add a rollback test proving a
failed command commits neither inventory changes nor a partial segmented queue.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml composite
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml reveal
```

Expected: at least the new composite-origin assertion fails because reveal
composition still returns one flat item vector.

- [ ] **Step 3: Return ordered segment drafts from reveal composition**

Replace flat return values with:

```rust
pub(in crate::game) struct RevealDialogue {
    pub segments: Vec<DialogueSegmentDraft>,
}

impl RevealDialogue {
    pub fn push(
        &mut self,
        origin: DialogueSegmentOriginV1,
        items: Vec<DialogueItem>,
    ) {
        if !items.is_empty() {
            self.segments.push(DialogueSegmentDraft { origin, items });
        }
    }
}
```

`apply_reveals_and_build_queue` and interrogation equivalents accept the
semantic parent identity needed for origin construction. They push each
authored block at the exact point where the current implementation appends its
items. Inventory/reveal mutations stay in their current order; only queue
representation changes.

- [ ] **Step 4: Route composite drafts through one installation**

Feature commands construct the result/body segment first, extend with the
reveal/acquisition segments, then call `install_dialogue_segments` once. Never
install a segment early and append later; one committed command must publish
one complete queue and one queue generation.

- [ ] **Step 5: Verify public and internal order**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml composite
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml reveal
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml full_playthrough
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: composite coordinates, public flattened tokens, rollback, full
playthrough, and all Rust tests pass.

- [ ] **Step 6: Commit composite segmentation**

```bash
rtk git add apps/game/src-tauri/src/game/reveals.rs apps/game/src-tauri/src/game/acquisition.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/dialogue.rs apps/game/src-tauri/src/game/test_support.rs apps/game/src-tauri/tests/full_playthrough.rs
rtk git commit -m "refactor: retain composite dialogue segment identity"
```

---

### Task 8: Run the prerequisite release gate

**Files:**

- Verify only; fix failures in the task-owned files above.

**Interfaces:**

- Produces: a green, independently reviewable prerequisite branch.
- Handoff to: the follow-on HPA-129 persistence/storage/UI/E2E implementation
  plan, written against the landed manifest and segmented runtime.

- [ ] **Step 1: Compile live authored content**

Run:

```bash
rtk bun run scenes:compile
```

Expected: successful compile with generated
`save_content_manifest.json`; generated JSON remains ignored by Git.

- [ ] **Step 2: Run compiler tests and strict script checking**

Run:

```bash
rtk bun run test:scripts
rtk bun run check:scripts
```

Expected: all script tests pass and strict TypeScript checking exits 0.

- [ ] **Step 3: Run the complete Rust suite and lint**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
rtk bun run rust:lint
```

Expected: all Rust tests pass and Clippy reports no warnings.

- [ ] **Step 4: Run cross-workspace frontend and repository checks**

Although this prerequisite intentionally changes no Svelte contract, run:

```bash
rtk bun run check
rtk bun run test
rtk bun run lint:all
```

Expected: Svelte/TypeScript checks, both test runners, formatting, and linting
all pass.

- [ ] **Step 5: Verify generated and source-tree hygiene**

Run:

```bash
rtk git diff --check
rtk git status --short
```

Expected: no whitespace errors; only intentional source/test changes are
tracked, with no generated resource JSON, build output, E2E reports, or local
settings staged.

- [ ] **Step 6: Record the verified prerequisite**

If Task 8 required source fixes, commit them with:

```bash
rtk git add packages/scripts apps/game/src-tauri
rtk git commit -m "test: close HPA-129 prerequisite verification"
```

If no files changed, do not create an empty commit. Record the exact command
results in the implementation handoff and request a focused whole-branch review
before writing the disk-persistence plan.
