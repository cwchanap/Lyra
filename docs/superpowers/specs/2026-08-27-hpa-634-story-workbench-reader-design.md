# HPA-634 Story Workbench Reader Design

## Status

Planning design for Linear HPA-634: **Ship the workbench shell and continuous story Reader**.

This is the first implementation slice under HPA-639. It stays one implementation PR: the planning commits and later implementation continue on the same HPA-634 branch/PR.

## Goal

Turn the existing `apps/layout-editor` developer tool into the first useful **Lyra Story Workbench** slice without creating a second story model:

- keep the existing investigation layout workflow as **Stage**;
- add a read-only **Reader** for every currently compiled scene type;
- navigate all manifest-listed scenes in chapter order;
- read one scene or a whole chapter without advancing the game;
- show canonical authored source references;
- replace arbitrary frontend file-path IPC with four narrow domain commands;
- keep authored Markdown and layout sidecars authoritative.

No Assets, Plan, source editing, or AI workflow ships in this ticket.

## Current baseline and reuse survey

Current `main` already contains most of the Stage mechanics we need:

- `apps/layout-editor/src/App.svelte` renders the developer shell and filters `chapters.json` down to investigation scenes.
- `apps/layout-editor/src/lib/layout-store.svelte.ts` owns investigation scene/layout state and Save Layout.
- `TargetList`, `EvidenceAssignmentPanel`, and `EditorCanvas` already own the existing Stage sublocation/layout workflow.
- `@lyra/scene-types` already shares only the byte-identical chapter index/layout subset. It deliberately does **not** expose the full runtime scene schema.
- the compiler already emits deterministic chapter ordering and all four scene kinds: `linear`, `investigation`, `interrogation`, and `analysis`.
- authored Chapter 1 scene sources already use stable semantic IDs such as `{#q_whereabouts}`, `{#miyake_backroom_reason}`, and `{#evidence_packages}`.
- `docs/stories_plan` is the live authored story root. `static/stories_plan` does not exist on current `main`; the editor backend is the remaining dual-root compatibility owner.

The current backend is intentionally broader than HPA-634 needs:

```text
read_project_file(path)
write_project_file(path, contents)
resolve_layout_path(scene_path)
```

That forces Svelte to construct repository-relative paths and therefore keeps generic traversal/symlink/TOCTOU machinery alive. HPA-634 replaces this with identifiers and deletes the unreachable generic path API rather than wrapping it in a new repository/service layer.

## Approaches considered

### A. Backend-owned safe Workbench bundle + frontend presentation — selected

Rust resolves chapter/scene IDs, reads existing compiler output, and projects it into a writer-safe Reader model. Investigation scenes additionally expose the existing Stage scene payload. Svelte renders and filters this model.

Why select it:

- the frontend stops constructing paths;
- Analysis hidden answer keys never cross IPC;
- no compiler output or runtime ownership changes;
- no complete scene schema has to be moved into `@lyra/scene-types`;
- Reader grouping can be tested independently of the game runtime.

### B. Send raw compiled JSON to Svelte and project there — rejected

This is smaller at first, but raw Analysis JSON contains `acceptedGroupByCard`, `acceptedOrder`, `acceptedSelections`, threshold/scoring data, and other correctness fields. Sending those fields to Reader solely for rendering violates the HPA-634 hidden-answer boundary.

### C. Add a second writer-facing compiler manifest — rejected

A dedicated compiler output could be clean eventually, but HPA-634 does not need a second checked/generated catalog. It would widen compiler ownership and create another artifact to keep synchronized before Reader value is proven.

## Architecture

```text
docs/stories_plan/**/*.md                 authoritative story source
        │
        ├── scene compiler
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

The backend remains stateless. Every domain command resolves against the current compiled `chapters.json`; no database, document registry, repository object, DI container, or cache service is introduced.

## Domain IPC contract

Exact Rust/TypeScript naming may follow local serde conventions, but the contract is:

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
- `chapter_id + scene_id` must resolve to one manifest-listed entry;
- `load_investigation_layout` and `save_investigation_layout` reject non-investigation scenes;
- `save_investigation_layout` writes only the `.layout.json` sibling of the canonical `docs/stories_plan` source;
- no command accepts an arbitrary read/write path;
- one straightforward root-containment assertion remains after the backend constructs a path;
- normal not-found/parse/write diagnostics remain typed;
- dual-root probing, arbitrary path traversal handling, custom no-follow writes, symlink walking, and generic parent-directory creation are deleted because callers can no longer choose paths.

The layout sidecar parent directory already exists because the authored scene source exists, so `fs::write` is sufficient after domain resolution and containment checking.

## Workbench index

`load_workbench_index()` reads the existing compiled `chapters.json` and preserves its array order exactly.

For each manifest-listed scene it derives:

- scene ID from the compiled file stem;
- scene type from the chapter index;
- canonical authored source path by mapping the compiled relative scene path to `docs/stories_plan/<same-relative-name>.md`;
- `stageCapable = true` only for investigation scenes.

The command verifies the compiled scene and canonical authored source exist. It does not scan unlisted Markdown files, inspect future assets/plans, or create another catalog.

The frontend may continue using the existing `readableChapterLabel` / `readableSceneLabel` presentation helpers. The index does not read every scene merely to duplicate display titles.

## Writer-safe Reader model

Reader must never receive raw Analysis correctness data. The backend therefore projects compiled JSON to a deliberately small generic model:

```ts
type ReaderScene = {
  id: string;
  type: SceneType;
  title: string;
  sourcePath: string;
  groups: ReaderGroup[];
};

type ReaderGroup = {
  id: string;
  kind: string;
  label: string;
  flow: "main" | "branch";
  sourceAnchor: string | null;
  items: ReaderItem[];
  children: ReaderGroup[];
};

type ReaderItem =
  | {
      kind: "dialogue";
      dialogue:
        | { kind: "sceneTag"; text: string }
        | { kind: "action"; text: string }
        | { kind: "line"; speaker: string; text: string };
    }
  | {
      kind: "notice";
      noticeKind: "reveal" | "evidence" | "statement" | "contradiction" | "prompt";
      text: string;
    };
```

Reader items deliberately omit portraits, asset IDs, audio, unlock expressions, runtime state, and other fields not consumed by HPA-634. HPA-134 will own asset/prompt inspection later.

### Linear projection

- one `Main flow` group containing `queue` in compiler order;
- scene tags/actions remain cue rows and may be hidden by the Reader cue filter.

### Investigation projection

- Intro and Outro are main-flow groups;
- each sublocation is a labelled branch group rather than a claimed canonical play sequence;
- transition dialogue stays under its sublocation;
- hotspots are child branch groups with inspect/re-examine dialogue and reveal notices;
- characters contain topic child groups with topic/re-examine dialogue and reveal notices;
- evidence/statement manifests may expose author-facing acquisition/re-examine dialogue as labelled branch groups;
- no runtime unlock evaluation occurs.

### Interrogation projection

- Intro and Outro are main flow;
- phases/questions/testimony lines remain in parser-owned array order;
- each testimony line keeps its statement content visible as the line group;
- Press/Challenge, correct Present, wrong-evidence Present, and testimony fallback replies are separate labelled child branches;
- contradiction IDs may appear as author-facing notices because these branches are authored editorial material, not hidden Analysis solution state;
- the Reader never invents one fake sequence through mutually exclusive branches.

### Analysis projection

Reader receives only:

- Intro;
- each board's public `kind`, `label`, `prompt`, and `resultDialogue`;
- Outro.

It does **not** receive or serialize:

- `acceptedGroupByCard`;
- `acceptedOrder`;
- `acceptedSelections`;
- fixed anchors used for correctness;
- minimum-selection thresholds;
- scoring/eligibility correctness rules;
- hidden accepted mappings of any future Analysis board.

A Rust regression serializes the resulting Reader model and proves those field names/values are absent.

## Source references

Every `ReaderScene` exposes its canonical `docs/stories_plan/...md` path.

Where the authored scene already has a stable semantic ID, `ReaderGroup.sourceAnchor` reuses that ID:

- investigation sublocation/hotspot/topic IDs;
- interrogation phase/question/testimony-line IDs;
- analysis board IDs.

The UI displays/copies:

```text
docs/stories_plan/chapter_1/interrogation_scene_4.md#q_backroom
docs/stories_plan/chapter_1/analysis_scene_8_5.md#evidence_packages
```

Intro/Outro and groups without an explicit authored ID show only the path plus a human label. Exact line navigation and a source-map framework are not introduced. Opening an external editor is deferred; copyable canonical references satisfy HPA-634 without platform-specific launch behavior.

## Workbench shell and selection

`App.svelte` remains the composition root.

The visible shell becomes:

```text
Lyra Story Workbench
[Reader] [Stage]

Chapter 1
  linear scene
  investigation scene
  analysis scene
  ...
```

Rules:

- only Reader and Stage modes exist;
- the scene tree always lists every manifest-listed scene type in deterministic chapter order;
- selection is by `{chapterId, sceneId}`, never by path;
- switching Reader/Stage keeps the same selected scene when possible;
- Stage on an investigation scene loads the existing scene/layout workflow;
- Stage on a non-investigation scene shows a small truthful empty state: Stage layout editing is available only for investigation scenes;
- Save Layout appears only for a loaded investigation layout;
- no router, docking layout, command palette, resizable IDE panes, or placeholder modes.

The package path and identifier stay `apps/layout-editor` / `com.lyra.layout-editor`. Only user-visible branding and window/product title change to **Lyra Story Workbench**.

## Reader controls

Reader owns only in-memory review controls:

1. **Content:** dialogue only / dialogue + actions & scene tags.
2. **Speaker:** all speakers / one speaker derived from the currently loaded content.
3. **Branches:** main flow / expanded branches.
4. **Scope:** current scene / whole chapter.
5. **Search:** case-insensitive substring search over currently loaded Reader text.

No preference persistence is added.

Behavior:

- speaker filtering affects dialogue lines; group headings remain as context;
- when cues are enabled, actions/scene tags remain visible even under a speaker filter;
- main-flow mode keeps branch group headers available but collapsed;
- expanded mode exposes authored optional/fallback branches in their group hierarchy;
- search hides groups with no matching descendant/item while retaining ancestor context and reports a simple match count;
- whole-chapter mode concatenates only the selected chapter's manifest-listed scenes in index order, with scene boundaries/type labels visible;
- whole-chapter loading reuses `load_scene_bundle` for each listed scene. Chapter 1's local-file scale does not justify a fifth bulk IPC command or a persistent cache service.

A small in-memory frontend map may memoize bundles during the app session so switching scope/mode does not repeatedly read the same local scene.

## Stage preservation

Stage should change ownership only where HPA-634 requires it:

- `layout-store.svelte.ts` keeps mutable layout state and `setHotspotLayout` / `setCharacterLayout`;
- `loadInvestigationScene` changes from `scenePath` to `(chapterId, sceneId)` and gets its scene from `load_scene_bundle`;
- layout loading/saving uses the domain commands;
- `TargetList`, `EvidenceAssignmentPanel`, `EditorCanvas`, layout geometry, and current sidecar semantics remain intact;
- no production game changes and no new source write path are introduced.

## Error and loading behavior

Keep it simple:

- one shell-level error for index/scene load failure;
- Reader shows a loading state while current/chapter bundles load;
- Stage keeps its existing layout error behavior;
- changing selection invalidates stale async results with the existing generation-counter pattern;
- a failed whole-chapter scene load identifies the failing scene and leaves already-loaded cache entries reusable; it does not silently omit a manifest scene.

No retry framework, toast system for reads, background watcher, or file-system subscription is added.

## Testing strategy

### Rust backend

Use current temp-workspace tests and add focused domain fixtures for:

- deterministic `chapters.json` ordering;
- canonical `docs/stories_plan` source resolution;
- unknown chapter/scene rejection;
- investigation-only layout read/write;
- removal of the `static/stories_plan` ambiguity path;
- writer-safe projection for one linear, investigation, interrogation, and analysis fixture;
- interrogation branch grouping;
- Analysis projection serialization proving hidden answer/threshold fields do not cross IPC.

Delete tests whose only subject is arbitrary caller paths, dangling symlinks, or generic write-path rejection once those APIs are removed. Keep one root-containment test on backend-constructed paths.

### Frontend

Add focused Vitest/component coverage for:

- shell branding and Reader/Stage modes only;
- deterministic all-scene tree rendering;
- Stage investigation selection and Save Layout preservation;
- truthful non-investigation Stage empty state;
- Reader fixtures for all four current scene types;
- investigation branch grouping;
- interrogation Press/correct/incorrect grouping;
- analysis Reader fixture containing no hidden solution fields;
- dialogue/cue toggle;
- speaker filter;
- branch expansion;
- current-scene/whole-chapter scope;
- local text search;
- canonical source-reference display/copy string construction.

No new packaged E2E framework is needed. The existing required HPA-634 gates are sufficient:

```bash
bun run scenes:compile
bun run --cwd apps/layout-editor test
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
- a second Markdown parser;
- a second story/catalog database;
- a generic document registry;
- a source-map system;
- whole-project search;
- Reader annotations/bookmarks/preferences;
- a router, docking framework, event bus, or plugin model;
- Chapter 2 map/board authoring abstractions;
- production game runtime/schema/state changes;
- compatibility behavior for the nonexistent `static/stories_plan` tree.

## Acceptance mapping

HPA-634 is complete when one PR proves:

- visible branding is Lyra Story Workbench;
- only functional Reader and Stage modes exist;
- all manifest scene types appear in deterministic chapter order;
- every current scene type renders in Reader without game progression;
- investigation/interrogation alternatives stay grouped rather than flattened;
- whole-chapter Reader follows manifest order;
- all five small Reader controls work in memory;
- canonical source references are copyable;
- frontend IPC uses chapter/scene identifiers only;
- `docs/stories_plan` is the sole story source root;
- generic arbitrary-path machinery is deleted;
- existing investigation Stage editing/Save Layout remains functional;
- Analysis hidden answers never reach Reader;
- no production game ownership or new authored-source write path changes.
