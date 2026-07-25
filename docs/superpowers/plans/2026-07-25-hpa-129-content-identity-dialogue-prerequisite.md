# HPA-129 Content Identity and Dialogue Runtime Prerequisite Plan

**Goal:** Produce the compiler-owned package revision and replace flat dialogue
queues with stable, packaged-content-backed dialogue segments without changing
player-visible dialogue behavior.

**Architecture:** The compiler hashes one canonical, explicit bundle of emitted
semantic JSON: authored-order chapters (stable ID, title, summary, and
authored-order scene objects) plus the full emitted story catalog. The generated
manifest carries only a version and that package revision. Separately, the
compiler owns stable dialogue origins for every dialogue-bearing field. Rust
uses the manifest only as an exact package compatibility gate; it reconstructs
segment items from the matching packaged scenes rather than from manifest
entries. Disk saves, autosave scheduling, Tauri commands, and UI remain in the
follow-on HPA-129 persistence work.

## Global constraints

- The authoritative persistence contract is
  `docs/superpowers/specs/2026-07-25-hpa-129-save-load-autosave-continue-design.md`.
- Hash emitted semantic values only. Never hash Markdown bytes, source
  filenames/paths, locations, formatting, timestamps, or iteration order from
  `Map`, `Set`, or Rust hash collections.
- Preserve every emitted semantic array order. Canonicalization sorts object
  keys recursively but never sorts arrays.
- The one package revision changes for every emitted semantic change, including
  prose, labels, static fields, chapter order, scene order, dialogue order,
  cues, and progression data.
- `SaveContentManifestV1` has exactly `manifestVersion: 1` and
  `contentRevision: sha256:<lowercase hex>`. It has no per-entry registry and
  no partial compatibility behavior.
- Keep `@lyra/scene-types` unchanged and never hand-edit generated resources.
- Stable segment origins are compiler/runtime-only. They use stable semantic
  IDs and closed field roles, never paths, copy, or vector indices.
- Investigation interactions use `(chapterId, sceneId, segmentId)` only;
  interrogation phase interactions also carry `phaseId`.
- Task 3 owns compiler file I/O. Task 2 stays pure. Task 4 validates only the
  minimal manifest version and revision. Task 5 resolves segment items from
  packaged scene content, never from manifest hash entries.
- Use failing-first tests, focused green tests, `bun run check:scripts`, and
  fresh final verification before commits.

## File map

### Compiler

- `packages/scripts/compile-scenes/canonical-json.ts` — one strict canonical
  JSON serializer and SHA-256 helper.
- `packages/scripts/compile-scenes/save-content-manifest.ts` — minimal
  manifest types and pure bundle hash construction.
- `packages/scripts/compile-scenes/dialogue-segment-origins.ts` — exhaustive
  emitted-dialogue enumerator and origin constructors.
- `packages/scripts/compile-scenes/orchestrator.ts` — retains emitted scenes in
  chapter manifest order, constructs the explicit bundle, and writes
  `save_content_manifest.json` with the other generated artifacts.

### Runtime

- `apps/game/src-tauri/src/game/content_manifest.rs` — Serde mirror of only the
  version/revision manifest and validation.
- `apps/game/src-tauri/src/game/dialogue_queue.rs` — segment queue, origin
  coordinates, flattening, and packaged-scene segment resolver.
- `apps/game/src-tauri/src/game/loader.rs` and scene runtimes — install segment
  queues through the shared resolver.
- `apps/game/src-tauri/src/game/save/` — later persistence capture/restore;
  active dialogue stores origins and cursors, not static dialogue items.

## Task 1 — strict canonical JSON and SHA-256 primitives

**Status:** complete before this plan revision.

`canonicalJson(value)` accepts only JSON-compatible plain values, sorts object
keys, preserves arrays, rejects non-finite/unsupported values, and retains own
`__proto__` keys. `sha256CanonicalJson(value)` emits
`sha256:<lowercase hex>`.

Tests cover nested object ordering, array ordering, invalid values, own
`__proto__`, and stable lowercase digests.

## Task 2 — stable dialogue origins and pure package manifest

**Files:**

- Create `packages/scripts/compile-scenes/dialogue-segment-origins.ts`.
- Create `packages/scripts/compile-scenes/dialogue-segment-origins.test.ts`.
- Create `packages/scripts/compile-scenes/save-content-manifest.ts`.
- Create `packages/scripts/compile-scenes/save-content-manifest.test.ts`.

**Interfaces:**

```ts
export type SaveContentManifestV1 = {
  manifestVersion: 1;
  contentRevision: `sha256:${string}`;
};

export type SaveContentBundleV1 = {
  chapters: Array<{
    id: string;
    title: string;
    summary: string;
    scenes: EmittedSceneJsonV1[];
  }>;
  storyCatalog: StoryCatalogJson;
};

export type BuildSaveContentManifestInput = {
  bundle: SaveContentBundleV1;
};

export function buildSaveContentManifest(
  input: BuildSaveContentManifestInput,
): SaveContentManifestV1;
```

`buildSaveContentManifest` is intentionally just:

```ts
{
  manifestVersion: 1,
  contentRevision: sha256CanonicalJson(input.bundle),
}
```

The explicit bundle boundary prevents source-file metadata entering the hash
while automatically including every current or future emitted scene field.
It does not parse filenames or reconstruct authored order.

Origin wire shape:

```ts
type DialogueSegmentOriginV1 =
  | { type: "linearScene"; chapterId: string; sceneId: string }
  | {
      type: "investigationIntro" | "investigationOutro";
      chapterId: string;
      sceneId: string;
    }
  | {
      type: "investigationInteraction";
      chapterId: string;
      sceneId: string;
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
```

`deriveDialogueSegments` visits all currently emitted dialogue carriers and
omits empty arrays:

| Scene | carriers |
| --- | --- |
| linear | `queue` |
| investigation | intro/outro, sublocation transition, hotspot inspect/reexamine, topic dialogue/reexamine, evidence collect/reexamine, statement acquire/reexamine |
| interrogation | intro/outro, phase entry, all question testimony roles, every testimony-line role, evidence collect/reexamine, statement acquire/reexamine |

Stable `segmentId` roles include `sublocation:<id>:transition`,
`hotspot:<id>:inspect`, `topic:<characterId>:<topicId>:dialogue`,
`evidence:<id>:onCollect`, `statement:<id>:onAcquire`,
`phase:<phaseId>:entry`, `question:<questionId>:onLoop`, and
`question:<questionId>:line:<lineId>:onCorrect` with their closed sibling
roles. Origin tests prove no source copy/index leaks and no redundant
investigation interaction field remains.

**Failing-first tests:**

- exact two-field manifest shape;
- canonical key-order determinism;
- same-kind dialogue order changes revision;
- chapter and scene reordering changes revision;
- prose and label changes revision;
- a newly added emitted scene field changes revision without an allowlist
  update;
- filename/path-only wrapper metadata does not change revision;
- exhaustive stable origins and empty-block omission.

Each manifest test protects the production regression named by its test: hash
drift to source metadata, lost authored ordering, copy-only save compatibility,
or a new emitted field silently escaping the package revision.

**Verification:**

```bash
rtk bun run test:scripts -- packages/scripts/compile-scenes/dialogue-segment-origins.test.ts packages/scripts/compile-scenes/save-content-manifest.test.ts
rtk bun run check:scripts
```

## Task 3 — emit the package manifest from the compiler

Modify the orchestrator after all scenes and the story catalog have been
emitted. While walking each authored chapter manifest, retain the exact emitted
scene values in that chapter order and build:

```ts
const bundle: SaveContentBundleV1 = {
  chapters: emittedChaptersInAuthoredOrder.map(({ id, title, summary, scenes }) => ({
    id,
    title,
    summary,
    scenes,
  })),
  storyCatalog: emittedStoryCatalog,
};
```

Pass `{ bundle }` to the pure Task 2 builder and write the minimal JSON as
`save_content_manifest.json`. Replace only that compiler-owned artifact during
the existing surgical output cleanup. Do not derive scenes from filenames in
the manifest builder and do not read generated JSON back from disk.

Tests prove end-to-end emission, stable repeat compilation, authored chapter
and scene order sensitivity, and removal/replacement of stale output.

## Task 4 — load the minimal manifest in Rust

Create `content_manifest.rs` with a Serde mirror:

```rust
struct ContentManifest {
    manifest_version: u32,
    content_revision: String,
}
```

Validate exactly version `1` and a `sha256:` prefix followed by 64 lowercase
hex characters. Load it once with the normal packaged resource loading path.
There is no typed entry lookup, no segment hash validation, and no partial
compatibility behavior. Rust tests cover malformed JSON, missing fields,
unsupported version, malformed digest, and a valid minimal artifact.

## Task 5 — shared segmented dialogue queue

Create `dialogue_queue.rs` with `DialogueSegment { origin, items }` and an
`ActiveDialogueQueue` whose active segment/item coordinates derive the existing
flattened cursor. Save capture stores origins and coordinates only.

The resolver receives matching packaged chapter/scene content and maps the
closed origin roles to the corresponding emitted dialogue arrays. It validates
chapter ID, scene ID, phase ID where applicable, and segment role; it never
consults package-manifest entries. Origin reconstruction preserves authored
composite ordering and rejects missing/empty/out-of-range targets.

Tests cover linear, investigation, and interrogation resolution; each closed
role; composite ordering; flattened token equivalence; cursor bounds; and
rejection of unknown semantic IDs.

## Task 6 — migrate existing scene runtimes

Migrate linear, investigation, and interrogation queue installation through
Task 5 while keeping the current frontend token contract and visible dialogue
sequence. Preserve transaction rollback and history deduplication. Add focused
runtime tests for normal advancement, scene tags, composite acquisition/reveal
queues, phase entry, and cross-examination line boundaries.

## Task 7 — persistence-facing capture prerequisites

Expose crate-private capture/restore adapters for active dialogue origins and
segment/item cursors. They resolve static items from matching packaged scene
content after the exact package revision gate. Do not implement save files,
autosave scheduling, Tauri commands, or UI in this prerequisite branch.

## Task 8 — release gate

Run focused compiler tests, `bun run check:scripts`, focused Rust tests, full
`cargo test --manifest-path apps/game/src-tauri/Cargo.toml`, `bun run rust:fmt`,
and `bun run rust:lint`. Confirm generated resource output is untracked and
that no editor contract changed.

## Acceptance checklist

- One canonical bundle hash covers every emitted static field and authored
  order, while source metadata cannot enter it.
- The generated manifest has exactly a version and revision.
- Static changes invalidate save compatibility as one package-wide decision.
- Every existing dialogue field has a stable origin with no copy/path/index or
  redundant investigation interaction identity.
- Runtime reconstruction uses matching packaged scene content, not manifest
  hash entries.
- No Task 3+ integration is implemented before its own approved task.
