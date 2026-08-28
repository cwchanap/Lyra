# HPA-634 Story Workbench Reader Design

## Status

Planning design for Linear HPA-634: **Ship the workbench shell and continuous story Reader**.

This is the first implementation slice under HPA-639. Planning and implementation stay in one HPA-634 branch/PR.

## Goal

Turn `apps/layout-editor` into the first useful **Lyra Story Workbench** slice without creating a new editor platform:

- preserve the existing investigation layout workflow as **Stage**;
- add a read-only **Reader** for every manifest-listed scene type;
- navigate by chapter/scene identifiers, never frontend-built repository paths;
- make `docs/stories_plan` the actual repository-wide canonical authored story root;
- reuse the compiler's emitted TypeScript contracts and existing dialogue-carrier traversal;
- keep hidden Analysis correctness/progression data out of Reader IPC;
- keep all Reader state local to the current session.

No Assets/Plan/Review placeholders, source editing, AI review, router, docking system, generic document model, second catalog, or production-game ownership change belongs here.

## Current baseline

Current `main` already contains most of the seams HPA-634 should extend:

- `apps/layout-editor/src/App.svelte` is the composition root and currently lists investigation scenes only.
- `layout-store.svelte.ts` owns investigation Stage state, Save Layout, and request-generation fencing.
- `TargetList`, `EvidenceAssignmentPanel`, and `EditorCanvas` own Stage interaction.
- `@lyra/scene-types` intentionally owns only the byte-identical compiler/editor subset such as `ChaptersIndex` and layout-sidecar types; it does **not** own full scene JSON.
- `packages/scripts/compile-scenes/types.ts` is already the public TypeScript contract for the compiler's emitted `JSONLinearScene`, `JSONInvestigationScene`, `JSONInterrogationScene`, and `JSONAnalysisScene` shapes.
- `packages/scripts/compile-scenes/dialogue-segment-origins.ts` already walks every current dialogue carrier and assigns stable semantic segment IDs.
- compiled resources are the Reader read model; authored Markdown remains authoritative.
- the layout-editor Rust shell currently exposes generic `read_project_file`, `write_project_file`, and `resolve_layout_path` commands, which is why it still carries arbitrary-path/symlink/TOCTOU machinery.
- the compiler entrypoint currently still accepts both `static/stories_plan` and `docs/stories_plan`, even though the live story tree is under `docs/stories_plan`.

## Review disposition

### Adopted: TypeScript owns Reader projection

The previous design put the Reader tree projection in Rust over `serde_json::Value`. That was the wrong ownership boundary because the compiler output shape is already typed in TypeScript and the compiler already has tested carrier traversal.

The revised design keeps Rust responsible only for:

- workspace/root resolution;
- manifest ID lookup;
- compiled-file I/O;
- narrow Analysis sanitization required by HPA-634's hidden-answer boundary;
- investigation layout-sidecar load/save;
- one root-containment assertion.

TypeScript owns:

- typed scene projection;
- Reader tree construction;
- exhaustive scene/dialogue/board switches;
- Reader filters/search;
- human labels and semantic source references.

### Adopted: reuse compiler carrier IDs

Reader dialogue-group IDs use the spelling already emitted by `deriveDialogueSegments()` instead of inventing aliases such as `:press` or `:collect`.

Examples:

```text
sublocation:<id>:transition
hotspot:<id>:inspect
hotspot:<id>:reexamine
topic:<characterId>:<topicId>:dialogue
topic:<characterId>:<topicId>:reexamine
evidence:<id>:onCollect
evidence:<id>:onReexamine
statement:<id>:onAcquire
statement:<id>:onReexamine
phase:<id>:entry
question:<id>:onLoop
question:<id>:loopPrompt
question:<id>:defaultChallenge
question:<id>:defaultWrong
question:<id>:wrongReply
question:<id>:line:<lineId>:content
question:<id>:line:<lineId>:challenge
question:<id>:line:<lineId>:onCorrect
question:<id>:line:<lineId>:onWrongEvidence
```

The Reader adds only structural container IDs that the compiler walker does not need, for example `sublocation:<id>`, `hotspot:<id>`, `phase:<id>`, `question:<id>`, `board:<id>`, `card:<id>`, and `group:<id>`.

A projection test compares the non-empty dialogue carriers consumed by Reader against `deriveDialogueSegments()` for the same typed scene. A compiler-side carrier addition therefore cannot silently disappear from Reader.

### Adopted: refresh is required for the writer loop

`dev:tauri` compiles once at launch, while writers may subsequently run `scenes:watch` or recompile manually. A session cache without invalidation would make Reader visibly stale.

Reader therefore gets one narrow **Refresh** affordance. It is not a persisted preference or new navigation mode: it clears loaded bundle data for the current Reader scope and reloads it through the same ID-based commands. Existing request-generation fencing prevents stale responses from winning.

### Retained: hidden Analysis data is an IPC boundary

The review suggestion to send raw Analysis JSON to Svelte is rejected because it conflicts with the HPA-634 requirement that Reader **must not receive** hidden Analysis answer keys, accepted mappings, thresholds, scoring rules, or runtime progression semantics solely for rendering.

This is a product contract, not an adversary/security claim.

Rust therefore performs a very small Analysis sanitizer before returning `load_scene_bundle`:

Include only the public story-review shape required by this ticket:

- scene `id`, `type`, `title`, `summary`, Intro, Outro;
- board `kind`, `id`, `label`, `prompt`;
- public cards: `id`, `label`, `summary`, source reference;
- classify groups: `id`, `label`, `description`;
- generic `incomplete`, `incorrect`, and optional `hint` copy;
- board Result Dialogue.

Do not send:

- `acceptedGroupByCard`;
- `acceptedOrder`;
- `acceptedSelections`;
- `incorrectSelections` selection mappings;
- `fixedAnchors`;
- `minimumSelected`;
- Analysis `unlock` / `reveals`;
- draft/completion/availability/evaluation/progression state.

One backend sentinel test is retained because it directly proves this acceptance boundary. The previous repo-wide grep gate is removed as redundant.

### Adopted: make the single-root claim true

HPA-634 says `docs/stories_plan` is the canonical authored root unless a current live exception is proven. No live `static/stories_plan` tree exists, but the compiler and current repo guidance still advertise a dual-root merge.

This PR therefore removes `static/stories_plan` from the compiler's `SOURCE_ROOTS` and updates active authoring/agent guidance that still describes it as a live source root. Historical design/implementation documents are not rewritten.

After this change, source paths can be constructed deterministically as:

```text
docs/stories_plan/<chapterId>/<compiled-stem>.md
```

The backend verifies that path exists and remains under the canonical story root when constructing the Workbench index. It does not silently display a nonexistent source path.

### Adopted: dependency and task-shape corrections

- `serde_json = "1"` is added explicitly to the editor Rust crate because manifest parsing and Analysis sanitization require it. This is already an existing repository dependency, not a new technology choice.
- `libc` is removed once `O_NOFOLLOW` generic-write machinery is deleted.
- `ReaderGroup.kind` is a closed TypeScript union, not `string`.
- generic commands may remain registered for intermediate green commits; they are deleted only after every caller has cut over.
- no temporary investigation-only Workbench filter is introduced and then deleted in the next task.

## Selected architecture

```text
docs/stories_plan/**/*.md
        │
        ├── existing compiler
        ▼
apps/game/src-tauri/resources/scenes/
        │
        │  chapters.json + typed compiled scene JSON
        ▼
layout-editor Tauri domain commands
        │
        ├── ID resolution / containment
        ├── raw compiled JSON for linear/investigation/interrogation
        └── public-only sanitized JSON for analysis
        ▼
workbench-api.ts
        │
        ▼
reader-projection.ts
        │  imports compiler JSON types
        │  reuses deriveDialogueSegments()
        ▼
ReaderScene tree
        │
        ├── ReaderView + local filters/search
        └── Stage keeps existing investigation geometry/layout ownership
```

The backend remains stateless. There is no database, service/repository abstraction, file watcher, document registry, second compiler artifact, or shared Rust scene-schema crate.

## Why `@lyra/scripts` is the right reuse boundary

`packages/scripts/compile-scenes/types.ts` explicitly defines the compiler's emitted JSON contract. Moving the four full scene types into `@lyra/scene-types` would contradict that package's deliberately narrow ownership and widen a shared runtime/editor package solely for this developer tool.

Instead `apps/layout-editor` adds a workspace dependency on `@lyra/scripts` and imports only:

```ts
import type {
  JSONAnalysisScene,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
} from "@lyra/scripts/compile-scenes/types";

import { deriveDialogueSegments } from "@lyra/scripts/compile-scenes/dialogue-segment-origins";
```

The imported runtime walker has no need to parse Markdown; when called without `sourceAst`, it derives stable carrier origins from emitted JSON. Its optional AST `sourceFile/line` data is **not** available to Reader because the AST is not emitted and HPA-634 forbids reparsing Markdown. Exact line navigation remains out of scope.

## Domain IPC

The public command surface is exactly four commands:

```text
load_workbench_index()
load_scene_bundle(chapterId, sceneId)
load_investigation_layout(chapterId, sceneId)
save_investigation_layout(chapterId, sceneId, layout)
```

### Workbench index

```ts
type SceneType = "linear" | "investigation" | "interrogation" | "analysis";

type WorkbenchIndex = {
  chapters: Array<{
    id: string;
    title: string;
    summary: string;
    scenes: Array<{
      id: string;
      type: SceneType;
      sourcePath: string;
      stageCapable: boolean;
    }>;
  }>;
};
```

The index is built from the existing compiled `chapters.json` in manifest order. It does not scan Markdown directories and does not list unmanifested drafts.

### Scene bundle

For linear/investigation/interrogation scenes, `load_scene_bundle` returns the compiler-emitted scene JSON unchanged after validating manifest ID/type consistency.

For Analysis, the backend returns the sanitized public shape above.

Frontend types model this as:

```ts
type WorkbenchScenePayload =
  | JSONLinearScene
  | JSONInvestigationScene
  | JSONInterrogationScene
  | PublicAnalysisScene;

type WorkbenchSceneBundle = {
  scene: WorkbenchScenePayload;
};
```

`PublicAnalysisScene` is derived with `Pick`/indexed access from the compiler's `JSONAnalysisScene` public fields where practical, so public field renames remain TypeScript-visible. It intentionally cannot be assignable to full `JSONAnalysisScene` because hidden fields are absent.

Stage accepts only a bundle whose `scene.type === "investigation"`.

## Reader model

Reader is frontend-only presentation state.

```ts
type ReaderGroupKind =
  | "intro"
  | "outro"
  | "sublocation"
  | "hotspot"
  | "topic"
  | "evidence"
  | "statement"
  | "phase"
  | "question"
  | "line"
  | "branch"
  | "board"
  | "card"
  | "group"
  | "result";

type ReaderFlow = "main" | "branch";

type ReaderScene = {
  id: string;
  type: SceneType;
  title: string;
  sourcePath: string;
  groups: ReaderGroup[];
};

type ReaderGroup = {
  id: string;
  kind: ReaderGroupKind;
  label: string;
  flow: ReaderFlow;
  sourceAnchor: string | null;
  items: ReaderItem[];
  children: ReaderGroup[];
};

type ReaderItem =
  | { kind: "sceneTag"; text: string }
  | { kind: "action"; text: string }
  | { kind: "line"; speaker: string; text: string }
  | {
      kind: "notice";
      noticeKind:
        | "reveal"
        | "evidence"
        | "statement"
        | "contradiction"
        | "prompt"
        | "card"
        | "group"
        | "feedback";
      text: string;
    };
```

Portraits, asset IDs, audio cues, unlock expressions, and runtime state are not copied into Reader items. HPA-134 owns asset/prompt inspection later.

## Typed projection rules

`reader-projection.ts` uses exhaustive switches with `assertNever()` runtime fallbacks for stale/corrupt generated data.

### Linear

- one main group containing compiler queue order;
- dialogue item order preserved exactly.

### Investigation

- Intro / Outro are main flow;
- sublocation is a structural group;
- transition dialogue uses `sublocation:<id>:transition`;
- hotspot inspect/re-examine use the compiler's segment IDs;
- topic dialogue/re-examine use the compiler's segment IDs;
- evidence onCollect/onReexamine and statement onAcquire/onReexamine use the compiler's segment IDs;
- public reveal/evidence/statement notices are added beside their authored interaction group;
- optional/re-examine/acquisition branches are branch flow, not flattened into a fake canonical play path.

### Interrogation

- Intro / Outro are main flow;
- phase and question are structural containers;
- phase entry uses `phase:<id>:entry`;
- testimony line content is grouped under the line container;
- `challenge` is labelled **Press**;
- `onCorrect` is labelled **Correct Present**;
- `onWrongEvidence` is labelled **Wrong Present**;
- question-level `onLoop`, `loopPrompt`, `defaultChallenge`, `defaultWrong`, and `wrongReply` stay as distinct labelled branch groups;
- contradiction/evidence/statement notices are public presentation metadata;
- inventory acquisition/re-examine carriers use the compiler's existing IDs.

### Analysis

- Intro / Outro;
- board structural groups;
- prompt notice;
- card child groups with public label/summary/source;
- classify group child groups with public label/description;
- generic incomplete/incorrect/hint feedback notices;
- Result Dialogue child group;
- no accepted solution, threshold, fixed-anchor, selection-mapping, unlock/reveal, or runtime-state data exists in the frontend payload.

## Carrier completeness contract

For linear/investigation/interrogation typed fixtures, tests call `deriveDialogueSegments({ chapterId, json: scene })` and collect its non-empty dialogue origin IDs.

The Reader projector tracks every consumed compiler segment. Projection fails if a non-empty compiler-derived segment remains unconsumed.

This gives two protections:

1. compiler union changes fail TypeScript exhaustiveness/type checking;
2. compiler carrier additions fail Reader projection tests/runtime instead of silently disappearing.

Analysis is tested separately because its frontend payload is intentionally sanitized and is not a full `JSONAnalysisScene`.

## Reader controls

Reader keeps only the ticket's review controls plus the operational Refresh affordance:

- dialogue only / dialogue + cues;
- all speakers / one speaker;
- main flow / expanded branches;
- current scene / whole chapter;
- local text search;
- Refresh loaded content.

No preference persistence, bookmarks, annotations, project-wide index, or watcher is added.

`filterReaderScene()` remains a pure function for cue/speaker/branch/search filtering. Refresh is data loading, not a filter.

## Loading and refresh

- `App.svelte` owns the single `WorkbenchIndex`.
- selected/current-scene bundle state is local to the Workbench shell.
- whole-chapter loading requests each manifest scene through the existing `load_scene_bundle` command in deterministic order; no fifth bulk command is added.
- a small session `Map` may avoid duplicate loads while navigating, but Refresh clears the current scene or current chapter entries before reloading.
- request-generation tokens prevent older async results from replacing newer selection/refresh results.

## Source references

Every scene shows its canonical source path from `WorkbenchIndex`.

Meaningful Reader groups show a copyable semantic reference such as:

```text
docs/stories_plan/chapter_1/investigation_scene_3.md#door
```

Use authored semantic IDs where they map to headings: sublocation/hotspot/topic/evidence/statement/phase/question/line/board/card/group.

Compiler `deriveDialogueSegments()` can carry AST line metadata only when a source AST is supplied. The editor receives compiled JSON only, and it must not parse Markdown again, so line-number navigation is not part of this ticket.

## Stage preservation

Stage continues to own only investigation layout editing:

- selecting an investigation scene loads its compiled scene bundle and layout sidecar by IDs;
- generation counters remain;
- canvas geometry/evidence assignment logic remains in the existing store/components;
- Save Layout calls `save_investigation_layout(chapterId, sceneId, layout)`;
- selecting Stage on a non-investigation scene shows a truthful non-editable state and does not issue a layout load.

## Error handling

Backend returns typed `EditorError { code, message }` for:

- workspace/root failure;
- chapter not found;
- scene not found;
- manifest/type mismatch;
- canonical source path missing/outside root;
- compiled JSON I/O/parse failure;
- invalid Analysis payload during sanitization;
- investigation-layout command used for a non-investigation scene;
- layout JSON I/O/parse/write failure.

Frontend projection has a small `ReaderProjectionError` for stale/corrupt payload variants that escape the compiler contract. It is not a second validation framework.

## Canonical-root migration

Implementation changes live ownership, not history:

- `packages/scripts/compile-scenes.ts` becomes docs-only.
- `CLAUDE.md` current Commands/Scene Pipeline sections become docs-only.
- active `.claude/skills/**` instructions that tell writers to use `static/stories_plan` are updated to `docs/stories_plan` where they describe current authoring behavior.
- historical specs/plans are left unchanged.
- an `rg` closeout checks active code/current guidance for remaining dual-root ownership claims.

## Test strategy

### Rust

- index preserves manifest chapter/scene order;
- canonical source paths resolve under `docs/stories_plan`;
- unknown chapter/scene fail;
- manifest scene type mismatch fails;
- `load_scene_bundle` returns non-Analysis payload and sanitizes Analysis payload;
- Analysis sentinel test proves hidden keys and values never serialize over Reader IPC;
- investigation layout load/save round-trip;
- layout command rejects non-investigation scene;
- root-containment assertion rejects escaped constructed paths.

### TypeScript projection

Typed fixtures use `satisfies JSONLinearScene`, `satisfies JSONInvestigationScene`, and `satisfies JSONInterrogationScene` so field drift is a type error.

Tests pin:

- linear dialogue order;
- investigation hierarchy and every non-empty compiler-derived carrier consumed;
- interrogation phase/question/line hierarchy and every non-empty compiler-derived carrier consumed;
- public Analysis board/card/classify-group/feedback/result structure;
- exhaustive unknown-kind fallback for malformed runtime payloads;
- closed source references and group IDs.

### Svelte / store

- all four scene types list in manifest order;
- Stage remains functional for investigation scenes;
- non-investigation Stage state is truthful;
- Reader/Stage mode switch is only shown once Reader is functional;
- cue/speaker/branch/search filters;
- current-scene / whole-chapter scope;
- Refresh invalidates and reloads current scope;
- source path/reference copy UI;
- stale async responses cannot replace newer selection/refresh results.

### Real-content closeout

After `bun run scenes:compile`, run the Workbench against the real Chapter 1 generated graph and inspect at least:

- one linear scene;
- `investigation_scene_3`;
- `interrogation_scene_4`;
- `analysis_scene_8_5`;
- whole-chapter Reader.

Confirm no projection error, manifest order is preserved, a known Chapter 1 dialogue line appears, Analysis public board text appears, and Stage still opens/saves an investigation layout. Record this smoke result in PR #75.

## Required verification

```bash
bun run scenes:compile
bun run editor:check
bun run editor:build
bun run --cwd apps/layout-editor test
bun run test:scripts
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run lint:all
```

Then perform the real-content closeout above.

## Non-goals

- no Assets / Plan / Review placeholders;
- no asset/prompt inspection;
- no Story Bible visualization;
- no source/dialogue/prompt editing;
- no AI provider/review queue;
- no package/directory rename;
- no generic document store, event bus, router, docking framework, plugin model, source-map framework, watcher, or project-wide search index;
- no second compiler artifact/catalog;
- no full scene-schema move into `@lyra/scene-types`;
- no shared Rust scene-schema crate;
- no production game changes.
