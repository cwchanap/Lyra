# HPA-634 Story Workbench Reader Design

## Status

Planning design for Linear HPA-634: **Ship the workbench shell and continuous story Reader**.

This is the first implementation slice under HPA-639. Planning and implementation stay in one HPA-634 PR; the current state remains planning-only.

## Goal

Turn the existing `apps/layout-editor` developer tool into the first useful **Lyra Story Workbench** slice without creating a second story model:

- preserve investigation layout authoring as **Stage**;
- add a read-only **Reader** for linear / investigation / interrogation / analysis;
- navigate manifest-listed scenes in deterministic chapter order;
- read one scene or a whole chapter without advancing the game;
- show canonical authored source references;
- replace arbitrary-path frontend IPC with narrow domain commands;
- keep authored Markdown/layout sidecars authoritative.

No Assets, Plan, source editing, or AI workflow ships here.

## Baseline and reuse

Current `main` already has the owners HPA-634 should extend:

- `apps/layout-editor/src/App.svelte` is the composition root but currently lists only investigation scenes.
- `layout-store.svelte.ts` owns investigation scene/layout state, Save Layout, and generation fencing.
- `TargetList`, `EvidenceAssignmentPanel`, and `EditorCanvas` own Stage interaction.
- `@lyra/scene-types` owns the byte-identical `ChaptersIndex` / layout-sidecar subset and intentionally does not own the full compiled scene schema.
- the compiler already emits ordered `linear`, `investigation`, `interrogation`, and `analysis` scene JSON.
- current compiler JSON already contains investigation re-examine/acquisition dialogue, interrogation entry/testimony/fallback dialogue, and Analysis board text.
- `docs/stories_plan` is the live authored root; the layout-editor backend is the remaining `static/stories_plan` fallback owner.
- the production Analysis view proves accepted maps can stay off the wire while public board presentation content is projected.

The backend today exposes:

```text
read_project_file(path)
write_project_file(path, contents)
resolve_layout_path(scene_path)
```

That makes Svelte construct repository paths and keeps caller-path traversal, dual-root ambiguity, and symlink/no-follow write machinery alive. HPA-634 replaces this with identifiers and deletes the now-unreachable generic machinery instead of wrapping it in a new repository/service abstraction.

## Review disposition

### Adopted

- Analysis Reader must include public authored board material, not only prompt/result dialogue.
- Task 2 must pin Reader tree structure, not pass on `serialized.contains(...)` alone.
- all current compiled dialogue carriers get explicit projection rules.
- unknown dialogue/phase/board variants produce typed errors rather than silently disappearing.
- Reader TypeScript dialogue types exactly mirror Reader Rust types instead of reusing wider Stage `DialogueItem`.
- App becomes the sole Workbench index owner; `loadChapters()` / `editorState.chapters` are deleted during IPC cutover.
- `readableSceneLabel` gains an `analysis_` arm and regression test.

### Partially adopted: Analysis visibility boundary

The Reader is for writer story review, not a second Analysis debugger/runtime view.

Include:

- board kind / label / prompt;
- public cards: id / label / summary / source reference;
- classify groups: id / label / description;
- generic Incomplete / Incorrect / Hint copy;
- Result Dialogue;
- Intro / Outro.

Exclude:

- `acceptedGroupByCard`;
- `acceptedOrder`;
- `acceptedSelections`;
- `incorrectSelections[].cards` and selection-specific feedback mapping;
- `fixedAnchors`;
- `minimumSelected`;
- draft/completion/availability/evaluation state;
- Analysis `unlock` / `reveals` progression rules.

Some excluded fields are player-visible in the production runtime. That does not make them necessary for a story Reader, and HPA-634 explicitly avoids importing threshold/scoring/runtime correctness semantics solely to render text.

## Selected architecture

### Backend-owned writer-safe bundle

```text
docs/stories_plan/**/*.md                  authoritative story source
        │
        ├── existing compiler
        ▼
apps/game/src-tauri/resources/scenes/      existing compiled read model
        │
        ▼
layout-editor Tauri domain commands
        │  ID resolution + safe projection
        ▼
WorkbenchIndex + WorkbenchSceneBundle
        │
        ├── Reader: generic read-only tree + local filters
        └── Stage: existing investigation scene + layout sidecar
```

The backend stays stateless. No database, document registry, DI container, cache service, file watcher, or second compiler artifact.

### Rejected alternatives

**Raw compiled JSON to Svelte:** rejected because Analysis correctness data would cross Reader IPC only to be discarded in the browser.

**Second writer manifest/compiler artifact:** rejected because current index/scene JSON are sufficient and another catalog creates synchronization ownership.

**Move full scene schema into `@lyra/scene-types` or game crate:** rejected because the shared package deliberately stays narrower and the Workbench only needs a writer projection.

## Domain IPC

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

- frontend callers never supply repository-relative paths;
- IDs must resolve to exactly one manifest scene;
- layout commands reject non-investigation scenes;
- backend constructs canonical `docs/stories_plan/...` paths;
- save writes only the canonical `.layout.json` sibling;
- keep one containment assertion on backend-constructed paths plus normal typed I/O errors;
- delete dual-root/caller-path traversal/symlink/TOCTOU machinery after the cutover.

## Workbench index ownership

`load_workbench_index()` reads existing compiled `chapters.json` and preserves array order.

For each manifest scene it derives only:

- scene ID from compiled filename stem;
- scene type;
- canonical `docs/stories_plan/...md` source path;
- `stageCapable` for investigation only.

It does not scan unlisted drafts or future asset/plan files.

`App.svelte` is the only frontend index owner. During domain-IPC cutover delete:

- `loadChapters()`;
- `loadChaptersGeneration`;
- `editorState.chapters`;
- old chapter-index `read_project_file` tests.

Stage store then owns only selected investigation scene/layout + `{chapterId, sceneId}`.

## Closed Reader wire model

Reader does not reuse Stage `DialogueItem` because Stage permits portrait data not present on the Reader wire.

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

No portraits, asset IDs, audio, geometry, unlock expressions, runtime state, or puzzle-evaluation data are carried. HPA-134 later owns asset/prompt/audio inspection.

## Projection policy

Projection reads compiled JSON through local `serde_json::Value` pickers. It does not import the game schema or create a second `SceneJson` family.

Unknown `DialogueItem.kind`, interrogation phase kind, or Analysis board kind is a typed error. New compiler variants must not silently disappear from Writer Reader output.

### Linear

One Main Flow group preserving `queue` item order exactly.

### Investigation

Main groups:

- Intro;
- Outro.

Branch groups:

- sublocation: transition dialogue + reveal notices;
- hotspot: inspect dialogue, public reveal notices, optional `On Re-examine` child;
- character/topic: topic dialogue, reveal notices, optional `On Re-examine` child;
- evidence manifest: labelled evidence group with `On Collect` and optional `On Re-examine` children;
- statement manifest: labelled statement group with `On Acquire` and optional `On Re-examine` children.

No unlock evaluation or fake canonical investigation order.

### Interrogation

Main groups:

- Intro;
- Outro.

Branch groups:

- phase;
- `Entry Dialogue`;
- question;
- testimony line content;
- `Press` from `challenge`;
- `Correct Present` from `onCorrect`;
- `Wrong Present` from `onWrongEvidence`;
- contradiction notice;
- testimony-level `Fallback` containing labelled On Loop / Loop Prompt / Default Press / Default Wrong Present / Wrong Reply groups;
- evidence `On Collect` / `On Re-examine`;
- statement `On Acquire` / `On Re-examine`.

Parser array order is preserved, but mutually exclusive branches stay grouped.

### Analysis

Each Board is a `ReaderGroup` anchored to board ID.

Board items:

- Prompt notice;
- generic Incomplete / Incorrect / Hint feedback notices.

Board children:

- each Card is a child `ReaderGroup` anchored to card ID; its `card` notices show label, summary, and source reference;
- each classify Group is a child `ReaderGroup` anchored to group ID; its `group` notice shows description;
- Result Dialogue is a child group containing public dialogue.

Order/Threshold boards still show public cards/feedback/result but do not expose fixed anchors, minimum threshold, accepted selections/order, or other correctness/progression configuration.

A Rust sentinel test must prove public card/group/feedback/result text is present while all excluded secret/config values are absent.

## Source references

Every ReaderScene exposes canonical `docs/stories_plan/...md`.

Reuse public IDs as semantic anchors for meaningful authored groups:

- investigation sublocation/hotspot/topic/evidence/statement;
- interrogation phase/question/testimony line/evidence/statement;
- Analysis board/card/classify group.

Examples:

```text
docs/stories_plan/chapter_1/interrogation_scene_4.md#q_backroom
docs/stories_plan/chapter_1/analysis_scene_8_5.md#evidence_packages
```

Intro/Outro and other unanchored groups show path + label only. No line source-map framework. External-editor launch is deferred; literal copyable reference is sufficient.

## Workbench shell

Final shell:

```text
Lyra Story Workbench
[Reader] [Stage]

Chapter 1
  Scene P0
  Investigation Scene 1
  Interrogation Scene 4
  Analysis Scene 8.5
```

Rules:

- only functional Reader/Stage modes;
- every manifest-listed type appears in deterministic order;
- selection uses IDs, never path;
- mode switch preserves selection;
- Stage loads only investigation scenes;
- non-investigation Stage shows a truthful limitation state;
- Save Layout only for loaded investigation layout;
- no router/docking/command palette/placeholder tabs.

Extend `readableSceneLabel` prefix regex from investigation/interrogation to investigation/interrogation/analysis so `analysis_scene_8_5` becomes `Analysis Scene 8.5`.

Package path and identifier remain unchanged; visible product/window title becomes Lyra Story Workbench.

## Reader controls

Session-memory only:

1. Dialogue only / Dialogue + actions & scene tags.
2. All speakers / one speaker.
3. Main flow / Expanded branches.
4. Current scene / Whole chapter.
5. Case-insensitive text search over loaded Reader content.

Behavior:

- speaker filters line dialogue only;
- cue visibility is independent of speaker filter;
- collapsed mode leaves branch headings discoverable but hides their content;
- search retains ancestor context and reports match count;
- chapter mode uses manifest order and visible scene boundaries;
- chapter loads through existing `load_scene_bundle` per scene, reusing a session-local Map.

No preference persistence, annotation, bookmark, project search index, fifth bulk command, or cache service.

## Stage preservation

- `layout-store.svelte.ts` keeps mutable layout, generation fencing, `setHotspotLayout`, `setCharacterLayout`;
- it loses chapters/path ownership;
- `loadInvestigationScene(chapterId, sceneId)` uses scene bundle + layout domain command;
- Save uses domain IDs/layout;
- TargetList/EvidenceAssignmentPanel/EditorCanvas/geometry/sidecar semantics remain current.

## Error behavior

- shell error for index/Reader load failure;
- Reader loading state for current/chapter load;
- Stage keeps existing layout error behavior;
- generation counters reject stale selection/chapter responses;
- chapter failure names exact manifest scene and never silently omits it;
- cached successful bundles remain reusable;
- unsupported compiled variants fail typed.

No retry framework, read toasts, watcher, or background subscription.

## Testing

### Rust

Prove:

- manifest ordering and docs source paths;
- unknown IDs;
- investigation-only layout round trip;
- one backend-constructed containment check;
- no static root ambiguity;
- structural Reader tree for all four types;
- investigation inspect/re-examine + evidence/statement acquire/collect branches;
- interrogation entry/Press/Correct/Wrong/Fallback structure;
- Analysis public card/group/feedback/result presence;
- Analysis accepted/scoring/config fields absent;
- unsupported dialogue/phase/board typed errors.

Delete tests whose only subject is caller-controlled arbitrary paths once those commands disappear.

### Frontend

Prove:

- branding and only functional modes;
- deterministic all-scene tree;
- Analysis readable label;
- Stage load/save preservation and non-investigation state;
- Reader fixtures for four types and current authored carriers;
- Analysis public content with no hidden field names;
- cue/speaker/branch/search filters;
- scene/chapter scope, order/cache/failure;
- source refs;
- no old loadChapters/generic path calls.

Required gates:

```bash
bun run scenes:compile
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
bun run editor:build
bun run test:scripts
bun run lint:all
```

## Non-goals

- Assets / Plan / Review / AI modes;
- asset/prompt/audio inspection;
- Story Bible visualization;
- source editing;
- second parser/catalog/database;
- source maps;
- project-wide search;
- annotations/bookmarks/preferences;
- router/docking/event bus/plugin framework;
- Chapter 2 authoring abstractions;
- production game changes;
- `static/stories_plan` compatibility;
- Analysis debugger/runtime evaluation UI.

## Acceptance

One PR must prove:

- Lyra Story Workbench visible branding;
- only Reader/Stage functional modes;
- App is the single Workbench index owner;
- all manifest scene types navigate in order;
- Analysis labels format correctly;
- all four scene types read without game UI;
- current investigation/interrogation dialogue carriers are represented;
- branches stay grouped;
- Analysis story-review content is useful without accepted/scoring semantics crossing IPC;
- whole chapter follows manifest order;
- five Reader controls stay local;
- canonical source refs are copyable;
- frontend uses ID domain IPC only;
- docs root is singular and generic path machinery is deleted;
- existing Stage editing/saving remains functional;
- unknown variants fail loud;
- no production game/new source-write ownership changes.
