# HPA-634 Story Workbench Reader Design

## Status

Planning design for Linear HPA-634: **Ship the workbench shell and continuous story Reader**.

This is the first implementation slice under HPA-639. Planning and implementation stay in one HPA-634 PR. The current PR is planning-only until implementation starts.

## Goal

Turn the existing `apps/layout-editor` developer tool into the first useful **Lyra Story Workbench** slice without creating a second story model:

- keep the existing investigation layout workflow as **Stage**;
- add a read-only **Reader** for every currently compiled scene type;
- navigate all manifest-listed scenes in chapter order;
- read one scene or a whole chapter without advancing through the game;
- show canonical authored source references;
- replace arbitrary frontend file-path IPC with narrow domain commands;
- keep authored Markdown and layout sidecars authoritative.

No Assets, Plan, source editing, or AI workflow ships in this ticket.

## Current baseline and reuse survey

Current `main` already contains the useful owners:

- `apps/layout-editor/src/App.svelte` is the current composition root and filters `chapters.json` down to investigation scenes.
- `apps/layout-editor/src/lib/layout-store.svelte.ts` owns investigation scene/layout mutable state, current async generation fencing, and Save Layout.
- `TargetList`, `EvidenceAssignmentPanel`, and `EditorCanvas` own the existing Stage interaction.
- `@lyra/scene-types` owns the byte-identical `ChaptersIndex` / layout-sidecar subset and deliberately does **not** own the complete compiled scene schema.
- the compiler already emits deterministic chapter order and all four scene kinds: `linear`, `investigation`, `interrogation`, and `analysis`.
- `docs/stories_plan` is the live authored source root. The editor backend is the remaining owner of the obsolete `static/stories_plan` fallback.
- the compiler output already carries the author dialogue needed by Reader: investigation hotspot/topic re-examine dialogue, evidence collect/re-examine dialogue, statement acquire/re-examine dialogue, interrogation phase entry dialogue, testimony branches, and Analysis board text.
- the production Analysis player view demonstrates the existing security boundary: public cards/groups/hints and some player presentation metadata can be projected while `acceptedGroupByCard`, `acceptedOrder`, and `acceptedSelections` remain absent.

The current backend API is broader than HPA-634 needs:

```text
read_project_file(path)
write_project_file(path, contents)
resolve_layout_path(scene_path)
```

That forces Svelte to construct repository-relative paths and keeps generic caller-path traversal, dual-root ambiguity, and symlink/no-follow write machinery alive. HPA-634 replaces it with identifiers and deletes the unreachable generic API instead of wrapping it in a repository/service layer.

## Review disposition

The external review is adopted with one deliberate boundary correction.

### Adopted

- Analysis Reader must include enough **public authored board content** to review the scene, not just prompt/result dialogue.
- Task 2 must assert the Reader tree shape, not only `serialized.contains(...)` strings.
- every current compiled dialogue carrier must have an explicit Reader projection rule.
- unknown dialogue/phase/board kinds fail loudly with typed errors rather than being silently skipped.
- Reader TypeScript dialogue wire types must exactly mirror the new Rust Reader wire, rather than reusing the wider Stage `DialogueItem` type.
- Task 3 deletes the old chapter-index state from `layout-store.svelte.ts`; `App.svelte` becomes the only Workbench index owner.
- Task 4 extends `readableSceneLabel` and its tests for `analysis_scene_*` IDs.

### Deliberately not adopted

The review proposed exposing `fixedAnchors`, `minimumSelected`, and the exact card sets behind `incorrectSelections` because the player runtime can expose some of that data. HPA-634 has a different boundary: it is a **story Reader**, not a second Analysis runtime/debugger.

The Reader therefore includes:

- board kind / label / prompt;
- public cards (id, label, summary, source reference);
- classify group id / label / description;
- generic incomplete / incorrect / hint copy;
- public result dialogue.

The Reader still excludes:

- `acceptedGroupByCard`;
- `acceptedOrder`;
- `acceptedSelections`;
- `incorrectSelections[].cards` and its selection-specific mapping;
- `fixedAnchors`;
- `minimumSelected`;
- availability/draft/completion/evaluation state;
- Analysis board `unlock` / `reveals` progression semantics.

This keeps the Reader useful for story review without cloning puzzle correctness or threshold/scoring semantics into the Workbench.

## Approaches considered

### A. Backend-owned safe Workbench bundle + frontend presentation — selected

Rust resolves chapter/scene IDs, reads existing compiler output, and projects it into a writer-safe Reader model. Investigation scenes additionally expose the existing Stage scene payload. Svelte renders and filters the Reader tree.

Why:

- the frontend stops constructing repository paths;
- Analysis accepted answers and scoring semantics never cross Reader IPC;
- no compiler artifact or production game owner changes;
- no complete scene schema moves into `@lyra/scene-types`;
- all scene families can share one `ReaderGroup` renderer and one filtering path.

### B. Send raw compiled JSON to Svelte and project there — rejected

Raw Analysis JSON contains hidden accepted maps and other puzzle configuration. Sending it solely so Reader can select a few public fields makes the browser wire larger and violates the hidden-answer boundary.

### C. Add a second writer-facing compiler manifest — rejected

A new artifact would add another catalog and compiler ownership before Reader value is proven. Existing `chapters.json` plus current scene JSON are sufficient.

## Architecture

```text
docs/stories_plan/**/*.md                 authoritative story source
        │
        ├── existing scene compiler
        ▼
apps/game/src-tauri/resources/scenes/     existing compiled read model
        │
        ▼
layout-editor Tauri domain commands
        │  resolve ids + project writer-safe scene content
        ▼
WorkbenchIndex + WorkbenchSceneBundle
        │
        ├── Reader: read-only groups + local filters/search
        └── Stage: existing investigation scene + layout sidecar workflow
```

The backend stays stateless. Every command resolves against the current compiled `chapters.json`. No database, document registry, repository object, DI container, background watcher, or cache service is added.

## Domain IPC contract

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

type WorkbenchSceneBundle = {
  reader: ReaderScene;
  investigationScene: InvestigationSceneJson | null;
};
```

Commands:

```text
load_workbench_index()
load_scene_bundle(chapter_id, scene_id)
load_investigation_layout(chapter_id, scene_id)
save_investigation_layout(chapter_id, scene_id, layout)
```

Rules:

- callers never supply repository-relative paths;
- `chapter_id + scene_id` must resolve to exactly one manifest-listed scene;
- `load_investigation_layout` / `save_investigation_layout` reject non-investigation scenes;
- backend constructs the canonical `docs/stories_plan/...` source/layout path;
- Save writes only the `.layout.json` sibling of that canonical source;
- no command accepts an arbitrary read/write path;
- one straightforward containment assertion remains on backend-constructed paths;
- normal not-found/parse/write diagnostics stay typed;
- dual-root probing and caller-controlled traversal/symlink/TOCTOU machinery are deleted once unreachable.

## Workbench index ownership

`load_workbench_index()` reads the existing compiled `chapters.json` and preserves its array order exactly.

For each manifest-listed scene it derives only:

- scene ID from the compiled filename stem;
- scene type from the chapter index;
- canonical authored source path under `docs/stories_plan`;
- `stageCapable = true` only for investigation scenes.

The index does not scan unlisted Markdown, future assets/plans, or source-map metadata.

`App.svelte` is the **only frontend owner** of `WorkbenchIndex`. As part of the domain-IPC cutover:

- delete `loadChapters()` from `layout-store.svelte.ts`;
- delete `editorState.chapters`;
- delete the old `read_project_file(chapters.json)` tests;
- Stage store owns only the selected investigation scene/layout and its ID pair.

This prevents parallel old/new chapter indexes after generic file IPC is removed.

## Writer-safe Reader wire model

The Reader uses its own closed dialogue type; it does not reuse Stage's wider `DialogueItem` type.

```ts
type ReaderDialogue =
  | { kind: "sceneTag"; text: string }
  | { kind: "action"; text: string }
  | { kind: "line"; speaker: string; text: string };

type ReaderNoticeKind =
  | "reveal"
  | "evidence"
  | "statement"
  | "contradiction"
  | "prompt"
  | "card"
  | "group"
  | "feedback";

type ReaderItem =
  | { kind: "dialogue"; dialogue: ReaderDialogue }
  | { kind: "notice"; noticeKind: ReaderNoticeKind; text: string };

type ReaderGroup = {
  id: string;
  kind: string;
  label: string;
  flow: "main" | "branch";
  sourceAnchor: string | null;
  items: ReaderItem[];
  children: ReaderGroup[];
};

type ReaderScene = {
  id: string;
  type: SceneType;
  title: string;
  sourcePath: string;
  groups: ReaderGroup[];
};
```

Reader deliberately omits portraits, asset IDs, audio, geometry, unlock expressions, mutable runtime state, and other fields not consumed by HPA-634. HPA-134 owns asset/prompt/audio inspection later.

## Projection rules

Projection is selective and explicit. It reads compiled JSON through local `serde_json::Value` pickers; it does not import the game schema or rebuild a second `SceneJson` family.

Any unknown `DialogueItem.kind`, interrogation phase kind, or Analysis board kind returns a typed editor error. A new compiler variant must not disappear silently from Writer Reader output.

### Linear

- one `Main flow` group;
- preserve `queue` item order exactly;
- line/action/sceneTag map to `ReaderDialogue`.

### Investigation

Main-flow groups:

- Intro;
- Outro.

Branch hierarchy:

- each sublocation (transition dialogue + reveal notices);
- each hotspot:
  - inspect dialogue;
  - `On Re-examine` child when present;
  - public reveal notices;
- each character/topic:
  - topic dialogue;
  - `On Re-examine` child when present;
  - public reveal notices;
- each evidence manifest entry:
  - labelled evidence group;
  - `On Collect` child;
  - `On Re-examine` child when present;
- each statement manifest entry:
  - labelled statement group;
  - `On Acquire` child;
  - `On Re-examine` child when present.

These groups are editorial branches. Reader does not evaluate unlock expressions or claim a canonical investigation play order.

### Interrogation

Main-flow groups:

- Intro;
- Outro.

Branch hierarchy:

- phase group;
- phase `Entry Dialogue`;
- question group;
- testimony line group containing the line content;
- line children:
  - `Press` from `challenge`;
  - `Correct Present` from `onCorrect`;
  - `Wrong Present` from `onWrongEvidence`;
  - contradiction notice when present;
- testimony-level `Fallback` child containing labelled subgroups for:
  - On Loop;
  - Loop Prompt;
  - Default Press;
  - Default Wrong Present;
  - Wrong Reply;
- evidence manifest `On Collect` / `On Re-examine` groups;
- statement manifest `On Acquire` / `On Re-examine` groups.

Reader preserves parser-owned array order but never flattens mutually exclusive testimony branches into a fake sequence.

### Analysis

Reader exposes the public authored review surface of each board:

- board kind / label;
- prompt notice;
- each card as a `card` notice containing id/label/summary/source reference;
- classify group id/label/description as `group` notices;
- generic `Incomplete`, `Incorrect`, and optional `Hint` as `feedback` notices;
- Result Dialogue;
- scene Intro / Outro.

Reader does **not** serialize puzzle correctness/progression fields listed in the review disposition above. In particular, a Rust sentinel regression must prove hidden values do not cross IPC even while public card/group/feedback text is present.

## Source references

Every scene exposes its canonical `docs/stories_plan/...md` path.

Where compiler/public IDs correspond to authored semantic anchors, reuse them:

- investigation sublocation/hotspot/topic/evidence/statement IDs;
- interrogation phase/question/testimony-line/evidence/statement IDs;
- analysis board/card/group IDs when the corresponding authored block has an ID.

UI displays/copies, for example:

```text
docs/stories_plan/chapter_1/interrogation_scene_4.md#q_backroom
docs/stories_plan/chapter_1/analysis_scene_8_5.md#evidence_packages
```

Intro/Outro and blocks without authored anchors show the path and human label only. Exact line navigation/source maps are not added. External-editor launch is deferred; copyable canonical references satisfy HPA-634.

## Workbench shell and labels

`App.svelte` remains the composition root.

Final visible shell:

```text
Lyra Story Workbench
[Reader] [Stage]

Chapter 1
  Scene P0          linear
  Investigation…   investigation
  Analysis Scene 8.5 analysis
  ...
```

Rules:

- only functional Reader and Stage modes exist;
- scene tree always lists every manifest-listed scene type in order;
- selection uses `{chapterId, sceneId}`, never path;
- switching modes preserves selected IDs;
- Stage on investigation loads existing scene/layout workflow;
- Stage on non-investigation shows a truthful limitation message;
- Save Layout only appears for loaded investigation layout;
- no router/docking/command palette/placeholder mode.

`readableSceneLabel` is reused and extended to recognize the `analysis_` prefix so `analysis_scene_8_5` renders as `Analysis Scene 8.5`. Its unit test adds the analysis case in the same Workbench-shell task.

Package path/identifier remain `apps/layout-editor` / `com.lyra.layout-editor`. Product/window title becomes **Lyra Story Workbench**.

## Reader controls

Reader owns only session-memory review controls:

1. **Content:** dialogue only / dialogue + actions & scene tags.
2. **Speaker:** all speakers / one speaker derived from loaded Reader content.
3. **Branches:** main flow / expanded branches.
4. **Scope:** current scene / whole chapter.
5. **Search:** case-insensitive substring search over currently loaded Reader content.

No persisted preferences, annotations, bookmarks, saved filters, or whole-project index.

Behavior:

- speaker filter affects dialogue lines; contextual group headings remain;
- actions/scene tags are controlled by cue mode, not speaker filter;
- main-flow mode keeps branch headings discoverable but does not expand branch contents;
- expanded mode exposes authored branches;
- search retains ancestor context for matching descendants and reports a simple match count;
- whole-chapter mode concatenates only manifest-listed scenes in manifest order with scene boundaries/type labels;
- chapter loading reuses `load_scene_bundle` per scene and a session-local `Map`; no fifth bulk command/cache service.

## Stage preservation

Stage changes only the ownership required by HPA-634:

- `layout-store.svelte.ts` keeps mutable layout state and `setHotspotLayout` / `setCharacterLayout`;
- it no longer owns chapters/index state;
- `loadInvestigationScene(chapterId, sceneId)` gets the scene from `load_scene_bundle` and sidecar from `load_investigation_layout`;
- Save calls `save_investigation_layout(chapterId, sceneId, layout)`;
- `TargetList`, `EvidenceAssignmentPanel`, `EditorCanvas`, geometry, and sidecar semantics stay unchanged.

## Error/loading behavior

Keep it small:

- one shell-level error for index/Reader scene load failure;
- Reader loading state for current/chapter requests;
- Stage keeps existing layout error behavior;
- current generation-counter pattern protects stale selection loads;
- chapter loading names the exact failing manifest scene and does not silently omit it;
- cached successful bundles remain reusable after another scene fails;
- unsupported compiled variants are typed errors, not omissions.

No retry framework, read toast system, file watcher, or background subscription.

## Testing strategy

### Rust backend

Use temp-workspace fixtures to prove:

- deterministic `chapters.json` ordering;
- canonical `docs/stories_plan` resolution;
- unknown chapter/scene rejection;
- investigation-only layout read/write;
- one backend-constructed root-containment check;
- no `static/stories_plan` ambiguity behavior;
- exact Reader tree shape for linear, investigation, interrogation, analysis;
- investigation hotspot/topic + evidence/statement dialogue children;
- interrogation Entry / Press / Correct Present / Wrong Present / Fallback hierarchy;
- Analysis public card/group/feedback/result content is present;
- Analysis accepted maps/order/selections, fixed anchors, thresholds, selection-specific correctness mapping are absent;
- unknown dialogue/phase/board kinds return typed errors.

Delete tests whose only subject is arbitrary caller paths, dangling symlinks, or generic write-path rejection after those commands are removed.

### Frontend

Focused coverage for:

- branding and only functional modes;
- all-scene deterministic tree;
- `analysis_scene_8_5` readable label;
- Stage investigation selection and Save Layout preservation;
- non-investigation Stage empty state;
- Reader fixtures for all four scene types;
- investigation re-examine/acquisition groups;
- interrogation branch hierarchy;
- Analysis public board text without correctness fields;
- cue/speaker/branch/search controls;
- current-scene/whole-chapter scope + cache/order/failure behavior;
- source-reference construction/display/copy;
- no old `loadChapters` / generic path IPC calls.

No new packaged E2E framework is introduced. Required gates:

```bash
bun run scenes:compile
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
bun run editor:build
bun run test:scripts
bun run lint:all
```

## Scope / non-goals

HPA-634 does not add:

- Assets, Plan, Review, or AI tabs;
- asset/prompt/audio inspection;
- Story Bible visualization;
- story/prompt editing;
- second Markdown parser;
- second story/catalog database;
- generic document registry;
- source-map system;
- project-wide search;
- Reader annotations/bookmarks/preferences;
- router/docking/event bus/plugin framework;
- Chapter 2 map/board authoring abstractions;
- production game runtime/schema/state changes;
- compatibility behavior for nonexistent `static/stories_plan`;
- Analysis debugging/runtime evaluation UI.

## Acceptance mapping

HPA-634 is complete when one PR proves:

- visible branding is Lyra Story Workbench;
- only functional Reader/Stage modes exist;
- all manifest scene types appear in deterministic order;
- every current scene type renders in Reader without game progression;
- all current authored dialogue carriers covered by this design appear in labelled groups;
- investigation/interrogation alternatives stay grouped;
- Analysis public story-review content is readable without accepted/scoring semantics crossing IPC;
- whole-chapter Reader follows manifest order;
- all five Reader controls are in memory;
- canonical source refs are copyable;
- App is the only Workbench index owner and old `loadChapters` is gone;
- frontend IPC uses IDs only;
- `docs/stories_plan` is the sole authored story root;
- generic arbitrary-path machinery is deleted;
- existing Stage edit/save workflow remains functional;
- analysis scene labels render correctly;
- no production game ownership or new authored-source write path changes.
