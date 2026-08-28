# HPA-634 Story Workbench Reader Design

## Status

Planning design for Linear HPA-634: **Ship the workbench shell and continuous story Reader**.

This is the first implementation slice under HPA-639. Planning and implementation stay in one HPA-634 branch/PR.

## Goal

Turn `apps/layout-editor` into the first useful **Lyra Story Workbench** slice without creating a new editor platform:

- preserve the existing investigation layout workflow as **Stage**;
- add a read-only **Reader** for every manifest-listed scene type;
- navigate by chapter/scene identifiers, never frontend-built repository paths;
- make `docs/stories_plan` the actual canonical authored story root for all current live tool defaults;
- reuse the compiler's emitted TypeScript contracts and existing dialogue-carrier traversal;
- keep hidden Analysis answers, thresholds, and progression semantics out of Reader IPC;
- keep all Reader state local to the current session;
- provide one explicit Refresh action so recompilation can be reflected without restarting the Workbench.

No Assets/Plan/Review placeholders, source editing, AI review, router, docking system, generic document model, second catalog, watcher, or production-game ownership change belongs here.

## Current baseline

Current `main` already contains most of the seams HPA-634 should extend:

- `apps/layout-editor/src/App.svelte` is the composition root and currently lists investigation scenes only.
- `layout-store.svelte.ts` owns investigation Stage state, Save Layout, and request-generation fencing.
- `TargetList`, `EvidenceAssignmentPanel`, and `EditorCanvas` own Stage interaction.
- `@lyra/scene-types` intentionally owns only the byte-identical compiler/editor subset such as `ChaptersIndex` and layout-sidecar types; it does **not** own full scene JSON.
- `packages/scripts/compile-scenes/types.ts` is already the public TypeScript contract for emitted `JSONLinearScene`, `JSONInvestigationScene`, `JSONInterrogationScene`, and `JSONAnalysisScene` shapes.
- `packages/scripts/compile-scenes/dialogue-segment-origins.ts` already walks every current dialogue carrier and assigns stable semantic segment IDs.
- compiled resources are the Reader read model; authored Markdown remains authoritative.
- the layout-editor Rust shell currently exposes generic `read_project_file`, `write_project_file`, and `resolve_layout_path` commands, which is why it still carries arbitrary-path/symlink/TOCTOU machinery.
- several current tools still advertise `static/stories_plan` plus `docs/stories_plan` as live defaults even though the live story tree is under `docs/stories_plan`.
- the production game already demonstrates one useful Analysis distinction: accepted answer maps are kept off its player view while public order constraints such as fixed anchors remain visible.

## Review disposition

### Adopted: TypeScript owns Reader projection

The earlier design put the Reader tree projection in Rust over `serde_json::Value`. That was the wrong ownership boundary because the compiler output shape is already typed in TypeScript and the compiler already has tested carrier traversal.

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
- exhaustive scene/dialogue switches;
- Reader filters/search;
- human labels and semantic source references;
- non-dialogue Reader notices such as reveals and contradictions.

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

A projection test compares the non-empty dialogue carriers consumed by Reader against `deriveDialogueSegments()` for the same typed scene. A compiler-side dialogue-carrier addition therefore cannot silently disappear from Reader.

That completeness contract does **not** cover non-dialogue presentation. Separate typed assertions therefore pin reveal/evidence/statement notices and interrogation contradiction notices.

### Adopted: Refresh is required for the writer loop

`dev:tauri` compiles once at launch, while writers may subsequently run `scenes:watch` or recompile manually. A session cache without invalidation would make Reader visibly stale.

Reader therefore gets one narrow **Refresh** affordance. It is not a persisted preference or new navigation mode: it clears loaded bundle data for the current Reader scope and reloads it through the same ID-based commands. Existing request-generation fencing prevents stale responses from winning.

### Retained: hidden Analysis data is an IPC product boundary

HPA-634 explicitly says Reader must not receive or evaluate hidden Analysis answer keys, accepted mappings, thresholds, scoring rules, or runtime progression semantics solely to render content.

This is a product contract, not an adversary/security claim.

The Workbench sanitizer follows the game's established answer-key split where compatible with that ticket, but the ticket is intentionally stricter than the player runtime for threshold/progression fields.

#### Analysis fields included in Reader IPC

- scene `id`, `type`, `title`, `summary`, Intro, Outro;
- board `kind` plus common `id`, `label`, `prompt`;
- public cards: `id`, `label`, `summary`, source reference;
- classify groups: `id`, `label`, `description`;
- generic `incomplete`, `incorrect`, and optional `hint` copy;
- order-board `fixedAnchors` because they are authored, player-visible fixed constraints rather than accepted answers or thresholds;
- board Result Dialogue.

#### Analysis fields excluded from Reader IPC

- `acceptedGroupByCard`;
- `acceptedOrder`;
- `acceptedSelections`;
- `incorrectSelections` card-set mappings and their selection-specific feedback;
- `minimumSelected` because HPA-634 explicitly excludes Analysis thresholds;
- Analysis `unlock` / `reveals` because those are runtime progression semantics and HPA-634 explicitly excludes those semantics from Reader IPC;
- draft/completion/availability/read-only/evaluation/selected-card runtime state.

The production game exposing `minimumSelected` does not override HPA-634's narrower Workbench acceptance contract. Conversely, the previous Workbench plan was unnecessarily strict about `fixedAnchors`; those now remain public.

One backend sentinel test proves both sides of the whitelist: required public fields, including `fixedAnchors`, serialize; forbidden answer/threshold/progression fields and sentinel values do not.

### Adopted: make the canonical-root claim true across current live defaults

HPA-634 says `docs/stories_plan` is the canonical authored root unless a current live exception is proven. No live `static/stories_plan` tree exists, but current live defaults still exist in more than the compiler CLI.

This PR changes every current default owner found by the source-root audit:

- `packages/scripts/compile-scenes.ts` `SOURCE_ROOTS`;
- `packages/scripts/compile-scenes/evidence-sources-audit.ts` `DEFAULT_SOURCE_ROOTS`;
- `packages/scripts/audio/corpus-validation.ts` `DEFAULT_SOURCE_ROOTS`;
- `packages/scripts/audio/cli.ts` `STORY_ROOTS`;
- `apps/game/src/lib/audio/sfx-events.test.ts` `AUTHORED_ROOTS`;
- the layout-editor dual-root source probe, deleted when generic path IPC is removed;
- `CLAUDE.md` and active `.claude/skills/**` current-authoring instructions.

The generic compiler orchestrator remains able to accept caller-supplied source-root arrays for compiler fixtures/tests. HPA-634 changes **live defaults**, not the compiler's reusable multi-root test API.

Historical `docs/superpowers/**` plans/specs remain unchanged.

After this migration, Workbench source paths can be constructed deterministically as:

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
- the implementation sequence does not expose Reader/Stage mode selection until Reader loading/rendering is functional in the same green commit.

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
        │  adds typed non-dialogue notices
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

The imported walker has no need to parse Markdown; when called without `sourceAst`, it derives stable carrier origins from emitted JSON. Its optional AST `sourceFile/line` data is **not** available to Reader because the AST is not emitted and HPA-634 forbids reparsing Markdown. Exact line navigation remains out of scope.

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

`PublicAnalysisScene` is derived with `Pick`/indexed access from the compiler's `JSONAnalysisScene` public fields where practical. Its order-board branch includes `fixedAnchors`; its threshold branch deliberately does not include `minimumSelected`.

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
        | "feedback"
        | "constraint";
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
- hotspot/topic/sublocation `reveals` are rendered as typed public notices, including evidence/statement/story reveal descriptions appropriate for writer review;
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
- each testimony line's `contradiction` is rendered as a typed contradiction notice when non-null;
- phase/question/line public reveal targets and inventory evidence/statement metadata are rendered as public notices where present;
- inventory acquisition/re-examine carriers use the compiler's existing IDs.

### Analysis

- Intro / Outro;
- board structural groups;
- prompt notice;
- card child groups with public label/summary/source;
- classify group child groups with public label/description;
- generic incomplete/incorrect/hint feedback notices;
- order-board fixed anchors as public constraint notices;
- Result Dialogue child group;
- no accepted solution, threshold, selection-mapping, unlock/reveal progression, or runtime-state data exists in the frontend payload.

## Carrier and notice completeness contracts

For linear/investigation/interrogation typed fixtures, tests call `deriveDialogueSegments({ chapterId, json: scene })` and collect its non-empty dialogue origin IDs.

The Reader projector tracks every consumed compiler dialogue segment. Projection fails if a non-empty compiler-derived dialogue segment remains unconsumed.

Non-dialogue presentation is pinned separately because `deriveDialogueSegments()` intentionally does not enumerate it:

- investigation fixture contains at least one non-empty `reveals` target and asserts a corresponding Reader notice;
- interrogation fixture contains at least one non-null testimony `contradiction` and asserts a corresponding Reader notice;
- representative evidence/statement reveal notices are asserted where fixture data contains them;
- Analysis order fixture contains a fixed anchor and asserts a public constraint notice.

This gives three protections:

1. compiler union changes fail TypeScript exhaustiveness/type checking;
2. compiler dialogue-carrier additions fail the SegmentPool completeness contract;
3. required non-dialogue writer presentation has explicit fixture assertions rather than relying on the dialogue walker.

Analysis is tested separately because its frontend payload is intentionally sanitized and is not the full compiler `JSONAnalysisScene` contract at runtime.

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
docs/stories_plan/chapter_1/investigation_scene_3.md#counter_admin_records
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

Implementation changes live ownership, not history.

Current live defaults become docs-only in:

```text
packages/scripts/compile-scenes.ts
packages/scripts/compile-scenes/evidence-sources-audit.ts
packages/scripts/audio/corpus-validation.ts
packages/scripts/audio/cli.ts
apps/game/src/lib/audio/sfx-events.test.ts
apps/layout-editor/src-tauri/src/lib.rs   # old dual-root probe deleted during IPC cutover
CLAUDE.md
.claude/skills/**                         # current authoring instructions only
```

The generic `compile(...)` / orchestrator APIs continue accepting caller-supplied root arrays for fixtures and tests. Historical specs/plans are left unchanged.

A closeout grep covers `packages/scripts`, `apps`, `CLAUDE.md`, and active `.claude/skills`, with explicit exclusions only for historical documentation and fixtures that deliberately exercise caller-supplied alternate roots.

## Test strategy

### Rust

- index preserves manifest chapter/scene order;
- canonical source paths resolve under `docs/stories_plan`;
- unknown chapter/scene fail;
- manifest scene type mismatch fails;
- `load_scene_bundle` returns non-Analysis payload and sanitizes Analysis payload;
- Analysis sentinel test proves public prompt/card/group/feedback/result and `fixedAnchors` serialize while answer keys, threshold, selection mappings, unlock/reveals, and runtime fields do not;
- investigation layout load/save round-trip;
- layout command rejects non-investigation scene;
- root-containment assertion rejects escaped constructed paths.

### TypeScript projection

Typed fixtures use `satisfies JSONLinearScene`, `satisfies JSONInvestigationScene`, and `satisfies JSONInterrogationScene` so field drift is a type error.

Tests pin:

- linear dialogue order;
- investigation hierarchy and every non-empty compiler-derived dialogue carrier consumed;
- investigation reveal notice from a real typed `reveals` target;
- interrogation phase/question/line hierarchy and every non-empty compiler-derived dialogue carrier consumed;
- interrogation contradiction notice from a non-null typed contradiction;
- public Analysis board/card/classify-group/feedback/fixed-anchor/result structure;
- exhaustive unknown-kind fallback for malformed runtime payloads;
- closed source references and group IDs.

### Svelte / store

- all four scene types list in manifest order;
- Stage remains functional for investigation scenes;
- non-investigation Stage state is truthful;
- Reader/Stage mode switch is introduced only in the same green change that makes Reader functional;
- cue/speaker/branch/search filters;
- current-scene / whole-chapter scope;
- Refresh invalidates and reloads current scope;
- source path/reference copy UI;
- stale async responses cannot replace newer selection/refresh results.

### Real compiled-content automated gate

After `bun run scenes:compile`, an explicit Workbench verification script loads the generated Chapter 1 manifest/resources and exercises `projectReaderScene` against:

- one manifest-listed linear scene;
- `investigation_scene_3`;
- `interrogation_scene_4`;
- `analysis_scene_8_5`.

The projector's SegmentPool completeness check must pass for the full typed dialogue scenes. The script also asserts representative real non-dialogue output: an investigation reveal notice and an interrogation contradiction notice when those authored fields are present. For raw Analysis input, the projection is exercised as a structural superset while the Rust real-payload sanitizer test remains the authoritative IPC boundary proof.

This automated gate is separate from the UI smoke so a carrier/notice drift cannot be hidden by a manual happy-path inspection.

### Real-content UI closeout

Launch the Workbench against the compiled Chapter 1 graph and inspect:

- one linear scene;
- `investigation_scene_3`;
- `interrogation_scene_4`;
- `analysis_scene_8_5`;
- whole-chapter Reader.

Confirm no projection error, manifest order is preserved, known Chapter 1 dialogue/notices appear, public Analysis text appears, Stage still opens/saves an investigation layout, and Refresh reflects a harmless recompile without restarting the Workbench.

## Required verification

```bash
bun run scenes:compile
bun run editor:check
bun run editor:build
bun run --cwd apps/layout-editor test
bun run --cwd apps/layout-editor verify:reader-real-content
bun run test:scripts
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run lint:all
```

Then perform the real-content UI closeout above.

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
- no production game runtime ownership change.