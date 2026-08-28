# HPA-634 Story Workbench Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first useful Lyra Story Workbench slice: an all-scene Reader plus the existing investigation Stage workflow, backed by identifier-based Tauri commands and writer-safe compiled-scene projections.

**Architecture:** Keep authored Markdown/layout sidecars and the existing scene compiler authoritative. The layout-editor Tauri backend resolves chapter/scene IDs against compiled `chapters.json`, projects only writer-safe Reader fields, and owns canonical source/layout paths; the Svelte app renders a small Reader/Stage shell and keeps Reader filters entirely in memory. No new compiler artifact, runtime story model, router, document registry, or compatibility layer is introduced.

**Tech Stack:** Tauri 2 / Rust / serde + serde_json, Svelte 5, TypeScript, Vitest + Testing Library, existing `@lyra/scene-types`, existing scene compiler.

**Spec:** `docs/superpowers/specs/2026-08-27-hpa-634-story-workbench-reader-design.md`

## Global Constraints

- HPA-634 lands as one PR. Tasks below are commit/review boundaries inside that PR, not separate PRs.
- Keep the package/path `apps/layout-editor` and Tauri identifier `com.lyra.layout-editor`; visible product/window branding becomes `Lyra Story Workbench`.
- The only functional modes in this ticket are `Reader` and `Stage`; do not add placeholder modes.
- `docs/stories_plan` is the sole authored story root for this implementation; do not keep `static/stories_plan` fallback behavior.
- Frontend Tauri calls use chapter/scene/domain identifiers only. No arbitrary repository path is accepted by a production command.
- Reader uses existing compiled scene JSON. Do not parse authored Markdown in Svelte or add another compiler output.
- Reader must never receive Analysis accepted mappings, accepted order/selections, minimum thresholds, fixed correctness anchors, scoring/eligibility rules, or runtime progression semantics solely for rendering.
- Stage remains the only writer in this ticket and may write only the existing investigation `.layout.json` sidecar for the selected manifest-listed investigation scene.
- Do not modify production game ownership/schema/runtime behavior.
- No backward-compatibility path for the nonexistent `static/stories_plan` tree or old generic editor IPC.
- No new dependencies unless a current repository dependency is demonstrably insufficient; the planned implementation needs none.

---

## File Structure

### Backend ownership

- Modify `apps/layout-editor/src-tauri/src/lib.rs`
  - own workspace resolution, compiled chapter lookup, canonical source/layout resolution, writer-safe Reader projection, and the four domain Tauri commands;
  - delete `read_project_file`, `write_project_file`, `resolve_layout_path`, dual-root probing, and arbitrary-path/symlink write machinery after the frontend cutover in Task 3;
  - keep domain tests colocated in the existing `#[cfg(test)]` module.

### Frontend domain model

- Create `apps/layout-editor/src/lib/workbench-types.ts`
  - local Workbench/Reader wire types only;
  - reuse `InvestigationSceneJson` and `InvestigationLayoutSidecar` from current editor types instead of duplicating Stage data.
- Create `apps/layout-editor/src/lib/workbench-api.ts`
  - the only frontend Tauri invocation boundary for HPA-634 domain commands.
- Modify `apps/layout-editor/src/lib/layout-store.svelte.ts`
  - keep mutable Stage layout state/geometry operations;
  - replace path-based load/save calls with `chapterId + sceneId` domain calls.

### UI ownership

- Create `apps/layout-editor/src/lib/WorkbenchSceneTree.svelte`
  - render all manifest-listed chapters/scenes and selection by IDs.
- Create `apps/layout-editor/src/lib/StageView.svelte`
  - move the existing Stage scene metadata, Save Layout, evidence panel, target list, and canvas into one focused component without changing behavior.
- Create `apps/layout-editor/src/lib/ReaderView.svelte`
  - render current-scene/whole-chapter Reader groups plus the five in-memory controls.
- Create `apps/layout-editor/src/lib/reader-view.ts`
  - pure speaker extraction, cue/speaker/branch/search filtering, source-reference construction, and match counting.
- Modify `apps/layout-editor/src/App.svelte`
  - become the Workbench composition root: index load, selected `{chapterId, sceneId}`, Reader/Stage mode, session-local scene-bundle cache, and component composition.
- Modify `apps/layout-editor/src-tauri/tauri.conf.json`
  - visible product/window title only.

### Tests

- Modify `apps/layout-editor/src/App.test.ts`
  - replace layout-editor-only raw-source assertions with Workbench shell/navigation behavior.
- Create `apps/layout-editor/src/lib/WorkbenchSceneTree.test.ts`
- Create `apps/layout-editor/src/lib/StageView.test.ts`
- Create `apps/layout-editor/src/lib/ReaderView.test.ts`
- Create `apps/layout-editor/src/lib/reader-view.test.ts`
- Modify `apps/layout-editor/src/lib/layout-store.test.ts`
  - pin the identifier-based Stage load/save command contract.
- Keep existing `EditorCanvas`, `EvidenceAssignmentPanel`, geometry, and evidence-assignment tests unchanged unless the move into `StageView` requires import/setup updates only.

---

### Task 1: Add the backend Workbench index and manifest-owned scene resolver

**Files:**
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`

**Interfaces:**
- Produces Rust serializable types:
  - `SceneType`
  - `WorkbenchIndex`
  - `WorkbenchChapterEntry`
  - `WorkbenchSceneEntry`
  - internal `ResolvedScene`
- Produces functions:
  - `fn load_workbench_index_at_root(root: &Path) -> Result<WorkbenchIndex, EditorError>`
  - `fn resolve_manifest_scene_at_root(root: &Path, chapter_id: &str, scene_id: &str) -> Result<ResolvedScene, EditorError>`
  - Tauri command `fn load_workbench_index() -> Result<WorkbenchIndex, EditorError>`
- Later tasks consume `ResolvedScene.compiled_path`, `ResolvedScene.source_path`, `ResolvedScene.scene_type`, and `ResolvedScene.scene_id`.

- [ ] **Step 1: Replace arbitrary-path resolver tests with a manifest-owned index fixture test**

In the existing Rust test module, add a small temp-workspace fixture that writes:

```text
apps/game/src-tauri/resources/scenes/chapters.json
docs/stories_plan/chapter_1/scene_a.md
docs/stories_plan/chapter_1/investigation_scene_b.md
apps/game/src-tauri/resources/scenes/chapter_1/scene_a.json
apps/game/src-tauri/resources/scenes/chapter_1/investigation_scene_b.json
```

with this deterministic index:

```json
{
  "chapters": [
    {
      "id": "chapter_1",
      "title": "Chapter One",
      "summary": "One",
      "scenes": [
        {"type": "linear", "file": "chapter_1/scene_a.json"},
        {"type": "investigation", "file": "chapter_1/investigation_scene_b.json"}
      ]
    }
  ]
}
```

Add:

```rust
#[test]
fn workbench_index_preserves_manifest_order_and_uses_docs_story_sources() {
    let root = temp_workbench_root();

    let index = load_workbench_index_at_root(&root).unwrap();

    assert_eq!(index.chapters[0].id, "chapter_1");
    assert_eq!(index.chapters[0].scenes[0].id, "scene_a");
    assert_eq!(index.chapters[0].scenes[0].scene_type, SceneType::Linear);
    assert_eq!(
        index.chapters[0].scenes[0].source_path,
        "docs/stories_plan/chapter_1/scene_a.md"
    );
    assert!(!index.chapters[0].scenes[0].stage_capable);
    assert_eq!(index.chapters[0].scenes[1].id, "investigation_scene_b");
    assert!(index.chapters[0].scenes[1].stage_capable);
}
```

Also add separate tests that `resolve_manifest_scene_at_root` returns `sceneNotFound` for an unknown scene and `chapterNotFound` for an unknown chapter.

- [ ] **Step 2: Run the focused Rust tests and verify the new API is red**

Run:

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml workbench_index_preserves_manifest_order_and_uses_docs_story_sources
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml resolve_manifest_scene
```

Expected: compile/test failure because `WorkbenchIndex`, `SceneType`, and resolver functions do not exist yet.

- [ ] **Step 3: Add the minimal index/resolver structs and helpers**

Add serde types in `lib.rs` near `EditorError`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SceneType {
    Linear,
    Investigation,
    Interrogation,
    Analysis,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchIndex {
    chapters: Vec<WorkbenchChapterEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchChapterEntry {
    id: String,
    title: String,
    summary: String,
    scenes: Vec<WorkbenchSceneEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchSceneEntry {
    id: String,
    #[serde(rename = "type")]
    scene_type: SceneType,
    source_path: String,
    stage_capable: bool,
}

struct ResolvedScene {
    chapter_id: String,
    scene_id: String,
    scene_type: SceneType,
    compiled_path: PathBuf,
    source_path: PathBuf,
}
```

Use a private deserialization type mirroring only `chapters.json`:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompiledChapterIndex {
    chapters: Vec<CompiledChapterEntry>,
}

#[derive(Deserialize)]
struct CompiledChapterEntry {
    id: String,
    title: String,
    summary: String,
    scenes: Vec<CompiledSceneEntry>,
}

#[derive(Deserialize)]
struct CompiledSceneEntry {
    #[serde(rename = "type")]
    scene_type: SceneType,
    file: String,
}
```

Resolve only entries found in this index. Derive `scene_id` from the compiled file stem and map the compiled relative path to exactly:

```rust
let source_relative = Path::new(&scene.file).with_extension("md");
let source_path = root.join("docs/stories_plan").join(source_relative);
```

Before returning a path, canonicalize the existing file and assert it starts with the canonical workspace root. Do not inspect caller-supplied path components because callers supply only IDs.

- [ ] **Step 4: Add the Tauri `load_workbench_index` command without removing old commands yet**

Add:

```rust
#[tauri::command]
fn load_workbench_index() -> Result<WorkbenchIndex, EditorError> {
    let root = workspace_root()?;
    load_workbench_index_at_root(&root)
}
```

Register it in `tauri::generate_handler!` while keeping current commands temporarily until Task 3 performs the atomic frontend cutover.

- [ ] **Step 5: Run all backend tests**

Run:

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS, including the new deterministic-order/source tests and all still-relevant existing backend tests.

- [ ] **Step 6: Commit the index/resolver seam**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs
git commit -m "feat(editor): add manifest-owned workbench index"
```

---

### Task 2: Project compiled scenes into a writer-safe Reader bundle

**Files:**
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `resolve_manifest_scene_at_root` from Task 1.
- Produces:
  - `ReaderScene`
  - `ReaderGroup`
  - `ReaderItem`
  - `ReaderDialogue`
  - `WorkbenchSceneBundle`
  - `fn load_scene_bundle_at_root(root: &Path, chapter_id: &str, scene_id: &str) -> Result<WorkbenchSceneBundle, EditorError>`
  - Tauri command `fn load_scene_bundle(chapter_id: String, scene_id: String) -> Result<WorkbenchSceneBundle, EditorError>`
- `WorkbenchSceneBundle.investigation_scene` is `Option<serde_json::Value>` and is populated only for investigation scenes; Stage's existing TypeScript type remains authoritative on the frontend.

- [ ] **Step 1: Add four failing projection tests, one per current scene type**

Extend `temp_workbench_root()` with minimal compiled fixtures:

```json
{"type":"linear","id":"scene_a","title":"Linear","summary":"","queue":[{"kind":"line","speaker":"相馬律","text":"line"},{"kind":"action","text":"action"}],"assetRefs":[]}
```

```json
{"type":"investigation","id":"investigation_scene_b","title":"Investigation","summary":"","intro":[{"kind":"line","speaker":"早坂茜","text":"intro"}],"assetRefs":[],"sublocations":[{"id":"cafe","label":"Cafe","status":"unlocked","unlock":null,"reveals":[],"sceneTag":"cafe","backgroundAssetId":null,"bgm":null,"bgs":null,"transitionDialogue":[],"hotspots":[{"id":"door","label":"Door","description":"","status":"unlocked","unlock":null,"reveals":[{"kind":"evidence","id":"door_log"}],"evidenceSource":null,"sceneSourcePrompt":null,"inspectDialogue":[{"kind":"line","speaker":"相馬律","text":"inspect"}],"onReexamine":null,"layout":null}],"characters":[]}],"evidenceManifest":[],"statementManifest":[],"outro":{"unlock":"auto","dialogue":[]}}
```

Add equivalently small interrogation and analysis JSON fixtures using the current compiler output shapes. The analysis fixture must deliberately contain sentinel secrets:

```json
{
  "acceptedGroupByCard":{"secret_card":"secret_group"},
  "acceptedOrder":["secret_order"],
  "fixedAnchors":[{"cardId":"secret_anchor","position":1}],
  "minimumSelected":7,
  "acceptedSelections":[["secret_selection"]]
}
```

across representative board kinds.

Tests:

```rust
#[test]
fn linear_reader_preserves_dialogue_and_action_order() { /* assert main flow items */ }

#[test]
fn investigation_reader_groups_sublocation_hotspot_and_reveal() { /* assert cafe -> door hierarchy */ }

#[test]
fn interrogation_reader_keeps_press_correct_and_wrong_branches_separate() { /* assert child labels/kinds */ }

#[test]
fn analysis_reader_exposes_public_dialogue_without_hidden_answers() {
    let root = temp_workbench_root();
    let bundle = load_scene_bundle_at_root(&root, "chapter_1", "analysis_scene_c").unwrap();
    let json = serde_json::to_string(&bundle.reader).unwrap();

    assert!(json.contains("public result"));
    assert!(!json.contains("acceptedGroupByCard"));
    assert!(!json.contains("secret_group"));
    assert!(!json.contains("acceptedOrder"));
    assert!(!json.contains("secret_order"));
    assert!(!json.contains("acceptedSelections"));
    assert!(!json.contains("secret_selection"));
    assert!(!json.contains("minimumSelected"));
    assert!(!json.contains("secret_anchor"));
}
```

- [ ] **Step 2: Run focused projection tests and confirm they fail**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml reader_
```

Expected: compile failures for missing Reader model/projection functions.

- [ ] **Step 3: Add the writer-safe Reader wire structs**

Add:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchSceneBundle {
    reader: ReaderScene,
    investigation_scene: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReaderScene {
    id: String,
    #[serde(rename = "type")]
    scene_type: SceneType,
    title: String,
    source_path: String,
    groups: Vec<ReaderGroup>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReaderGroup {
    id: String,
    kind: String,
    label: String,
    flow: ReaderFlow,
    source_anchor: Option<String>,
    items: Vec<ReaderItem>,
    children: Vec<ReaderGroup>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum ReaderFlow {
    Main,
    Branch,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ReaderItem {
    Dialogue { dialogue: ReaderDialogue },
    Notice { notice_kind: ReaderNoticeKind, text: String },
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ReaderDialogue {
    SceneTag { text: String },
    Action { text: String },
    Line { speaker: String, text: String },
}
```

`ReaderNoticeKind` has only `Reveal`, `Evidence`, `Statement`, `Contradiction`, `Prompt`.

- [ ] **Step 4: Implement selective JSON projection helpers**

Read the compiled scene as `serde_json::Value`; never serialize the raw value into `ReaderScene`. Add small helpers with one responsibility:

```rust
fn required_str<'a>(value: &'a Value, field: &str) -> Result<&'a str, EditorError>;
fn array_field<'a>(value: &'a Value, field: &str) -> Result<&'a [Value], EditorError>;
fn project_dialogue(items: &[Value]) -> Result<Vec<ReaderItem>, EditorError>;
fn project_reveals(items: &[Value]) -> Vec<ReaderItem>;
fn project_linear(value: &Value) -> Result<Vec<ReaderGroup>, EditorError>;
fn project_investigation(value: &Value) -> Result<Vec<ReaderGroup>, EditorError>;
fn project_interrogation(value: &Value) -> Result<Vec<ReaderGroup>, EditorError>;
fn project_analysis(value: &Value) -> Result<Vec<ReaderGroup>, EditorError>;
```

Only read explicitly allowed fields. For Analysis boards, inspect only:

```text
kind
common.id
common.label
common.prompt
common.resultDialogue
```

and ignore the rest of the board object.

For source anchors, copy authored semantic IDs already represented by public IDs:

- investigation sublocation/hotspot/topic IDs;
- interrogation phase/question/testimony-line IDs;
- analysis board `common.id`.

Do not infer line numbers or parse Markdown.

- [ ] **Step 5: Implement `load_scene_bundle_at_root` and the Tauri command**

Use the Task 1 resolver, assert compiled JSON's `type` and `id` match the manifest resolution, project Reader groups by `SceneType`, and populate `investigation_scene` only when `SceneType::Investigation`.

```rust
#[tauri::command]
fn load_scene_bundle(
    chapter_id: String,
    scene_id: String,
) -> Result<WorkbenchSceneBundle, EditorError> {
    let root = workspace_root()?;
    load_scene_bundle_at_root(&root, &chapter_id, &scene_id)
}
```

Register this command alongside the old commands temporarily.

- [ ] **Step 6: Run all backend tests and inspect the serialized Analysis projection**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS. In particular, the hidden-answer sentinel test proves the forbidden fields/values never cross the Reader wire model.

- [ ] **Step 7: Commit the safe scene bundle**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs
git commit -m "feat(editor): project writer-safe scene bundles"
```

---

### Task 3: Cut Stage over to domain layout commands and delete generic project-file IPC

**Files:**
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`
- Create: `apps/layout-editor/src/lib/workbench-types.ts`
- Create: `apps/layout-editor/src/lib/workbench-api.ts`
- Modify: `apps/layout-editor/src/lib/layout-store.svelte.ts`
- Modify: `apps/layout-editor/src/lib/layout-store.test.ts`

**Interfaces:**
- Consumes: `WorkbenchIndex` / `WorkbenchSceneBundle` backend commands from Tasks 1-2.
- Produces frontend functions:

```ts
export function loadWorkbenchIndex(): Promise<WorkbenchIndex>;
export function loadSceneBundle(chapterId: string, sceneId: string): Promise<WorkbenchSceneBundle>;
export function loadInvestigationLayout(chapterId: string, sceneId: string): Promise<InvestigationLayoutSidecar | null>;
export function saveInvestigationLayout(chapterId: string, sceneId: string, layout: InvestigationLayoutSidecar): Promise<void>;
```

- Refactors Stage store API to:

```ts
export async function loadInvestigationScene(chapterId: string, sceneId: string): Promise<void>;
export async function saveLayout(): Promise<void>;
```

- Production backend command set after this task contains only:
  - `load_workbench_index`
  - `load_scene_bundle`
  - `load_investigation_layout`
  - `save_investigation_layout`

- [ ] **Step 1: Write frontend command-contract tests before changing the store**

In `layout-store.test.ts`, mock `@tauri-apps/api/core` and add assertions that:

```ts
await loadInvestigationScene("chapter_1", "investigation_scene_1");
```

invokes:

```ts
expect(invoke).toHaveBeenCalledWith("load_scene_bundle", {
  chapterId: "chapter_1",
  sceneId: "investigation_scene_1",
});
expect(invoke).toHaveBeenCalledWith("load_investigation_layout", {
  chapterId: "chapter_1",
  sceneId: "investigation_scene_1",
});
```

and never calls `read_project_file` or `resolve_layout_path`.

Pin save behavior:

```ts
await saveLayout();
expect(invoke).toHaveBeenCalledWith("save_investigation_layout", {
  chapterId: "chapter_1",
  sceneId: "investigation_scene_1",
  layout: expect.objectContaining({ sceneId: "investigation_scene_1" }),
});
```

- [ ] **Step 2: Run the focused frontend test and verify it is red**

```bash
bun run --cwd apps/layout-editor test src/lib/layout-store.test.ts
```

Expected: FAIL because the store still accepts a scene path and invokes generic commands.

- [ ] **Step 3: Add local Workbench wire types and the single frontend invoke boundary**

Create `workbench-types.ts` with exact local types from the spec:

```ts
import type { InvestigationSceneJson, DialogueItem } from "./layout-types";

export type SceneType = "linear" | "investigation" | "interrogation" | "analysis";

export type WorkbenchIndex = {
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

export type ReaderGroup = {
  id: string;
  kind: string;
  label: string;
  flow: "main" | "branch";
  sourceAnchor: string | null;
  items: ReaderItem[];
  children: ReaderGroup[];
};

export type ReaderItem =
  | { kind: "dialogue"; dialogue: DialogueItem }
  | {
      kind: "notice";
      noticeKind: "reveal" | "evidence" | "statement" | "contradiction" | "prompt";
      text: string;
    };

export type ReaderScene = {
  id: string;
  type: SceneType;
  title: string;
  sourcePath: string;
  groups: ReaderGroup[];
};

export type WorkbenchSceneBundle = {
  reader: ReaderScene;
  investigationScene: InvestigationSceneJson | null;
};
```

Create `workbench-api.ts` as four thin `invoke` calls only. Do not put state, caching, path composition, or presentation logic in this file.

- [ ] **Step 4: Add backend investigation-layout domain tests**

In Rust tests, add:

```rust
#[test]
fn investigation_layout_round_trips_only_for_manifest_investigation_scene() {
    let root = temp_workbench_root();
    let layout = serde_json::json!({
        "version": 1,
        "sceneId": "investigation_scene_b",
        "sublocations": {}
    });

    save_investigation_layout_at_root(
        &root,
        "chapter_1",
        "investigation_scene_b",
        layout.clone(),
    )
    .unwrap();

    assert_eq!(
        load_investigation_layout_at_root(&root, "chapter_1", "investigation_scene_b")
            .unwrap()
            .unwrap(),
        layout
    );
}

#[test]
fn investigation_layout_rejects_non_investigation_scene() { /* expect sceneTypeMismatch */ }
```

Also retain exactly one backend-constructed-path containment regression by making the fixture root canonical and asserting the resolved `.layout.json` path stays below it.

- [ ] **Step 5: Run the new backend layout tests and verify they fail**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml investigation_layout_
```

Expected: compile failure because the new helpers/commands do not exist.

- [ ] **Step 6: Implement the two layout domain commands**

Add internal helpers:

```rust
fn load_investigation_layout_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<Option<Value>, EditorError>;

fn save_investigation_layout_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
    layout: Value,
) -> Result<(), EditorError>;
```

Resolve the manifest scene first and require `SceneType::Investigation`. Build the layout path from `ResolvedScene.source_path.with_extension("layout.json")`. On save, require `layout["sceneId"] == scene_id`, serialize with `serde_json::to_string_pretty`, append one newline, and call `fs::write` on the backend-owned path.

Commands:

```rust
#[tauri::command]
fn load_investigation_layout(
    chapter_id: String,
    scene_id: String,
) -> Result<Option<Value>, EditorError>;

#[tauri::command]
fn save_investigation_layout(
    chapter_id: String,
    scene_id: String,
    layout: Value,
) -> Result<(), EditorError>;
```

- [ ] **Step 7: Refactor `layout-store.svelte.ts` to identifiers**

Store the selected Stage identity:

```ts
chapterId: string | null;
sceneId: string | null;
```

Remove `scenePath` and `layoutPath`. `loadInvestigationScene` calls `loadSceneBundle` and rejects a bundle whose `investigationScene` is `null`; then loads the sidecar. If the domain command returns `null`, create the same current default:

```ts
{
  version: 1,
  sceneId,
  sublocations: {},
}
```

`saveLayout` delegates to `saveInvestigationLayout(editorState.chapterId, editorState.sceneId, editorState.layout)`.

Keep existing generation counters and `setHotspotLayout` / `setCharacterLayout` unchanged.

- [ ] **Step 8: Delete the generic backend IPC and its now-unreachable machinery in the same cutover**

Remove:

```text
ProjectFile
read_project_file
write_project_file
resolve_layout_path
checked_project_path_from_root
checked_existing_project_path
ensure_layout_sidecar_write_path
ensure_parent_dirs
reject_symlink
write_regular_file
find_source_scene_path_at_root dual-root probing
```

and the `OpenOptions`, `Write`, Unix `O_NOFOLLOW`, symlink test imports they solely required.

Delete tests whose only contract was arbitrary caller path escaping/symlink handling. Do not replace them with equivalent generic-path tests; the caller no longer chooses a path.

`tauri::generate_handler!` must now list only the four HPA-634 domain commands.

- [ ] **Step 9: Run focused frontend and all backend tests**

```bash
bun run --cwd apps/layout-editor test src/lib/layout-store.test.ts
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS. Grep must show no production frontend/backend invocation or command definition for old generic IPC:

```bash
rg 'read_project_file|write_project_file|resolve_layout_path' apps/layout-editor/src apps/layout-editor/src-tauri/src
```

Expected: no production matches; test descriptions may mention old names only in negative assertions.

- [ ] **Step 10: Commit the domain-IPC cutover**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs apps/layout-editor/src/lib/workbench-types.ts apps/layout-editor/src/lib/workbench-api.ts apps/layout-editor/src/lib/layout-store.svelte.ts apps/layout-editor/src/lib/layout-store.test.ts
git commit -m "refactor(editor): replace project paths with workbench commands"
```

---

### Task 4: Build the Workbench shell, all-scene tree, Stage view, and branding

**Files:**
- Create: `apps/layout-editor/src/lib/WorkbenchSceneTree.svelte`
- Create: `apps/layout-editor/src/lib/WorkbenchSceneTree.test.ts`
- Create: `apps/layout-editor/src/lib/StageView.svelte`
- Create: `apps/layout-editor/src/lib/StageView.test.ts`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`
- Modify: `apps/layout-editor/src-tauri/tauri.conf.json`

**Interfaces:**
- `WorkbenchSceneTree` props:

```ts
{
  index: WorkbenchIndex;
  selectedChapterId: string | null;
  selectedSceneId: string | null;
  onSelect: (chapterId: string, sceneId: string) => void;
}
```

- `StageView` props:

```ts
{
  chapterId: string | null;
  sceneId: string | null;
  sceneType: SceneType | null;
}
```

`StageView` calls existing Stage store functions/components; it does not own Workbench index/Reader state.

- [ ] **Step 1: Write a rendered scene-tree test covering all four scene types and order**

Use a fixture index containing:

```text
scene_0            linear
investigation_1    investigation
interrogation_2    interrogation
analysis_3         analysis
```

Render `WorkbenchSceneTree`, assert all four labels/buttons appear in array order, and click `analysis_3` to assert:

```ts
expect(onSelect).toHaveBeenCalledWith("chapter_1", "analysis_3");
```

- [ ] **Step 2: Write Stage behavior tests before moving the existing UI**

`StageView.test.ts` must pin both states:

1. investigation selection calls `loadInvestigationScene("chapter_1", "investigation_1")` and renders the existing Save Layout / Stage content once loaded;
2. analysis selection renders `Stage layout editing is available for investigation scenes.` and does not call Stage load/save.

Keep the existing Save Layout success behavior under Stage by asserting a Save click calls the mocked `saveLayout()` and produces `Layout saved` status text.

- [ ] **Step 3: Rewrite `App.test.ts` around Workbench behavior**

Replace the old raw-source-only product assertions with rendered/mocked behavior that proves:

- heading `Lyra Story Workbench`;
- exactly two mode buttons: `Reader` and `Stage`;
- no `Assets`, `Plan`, `Review`, or `AI` mode button;
- index loads once;
- the selected scene identity remains the same when switching Reader → Stage;
- all-scene navigation is supplied by `WorkbenchSceneTree` rather than filtered investigation-only data.

- [ ] **Step 4: Run the three component tests and verify they fail**

```bash
bun run --cwd apps/layout-editor test src/App.test.ts src/lib/WorkbenchSceneTree.test.ts src/lib/StageView.test.ts
```

Expected: failures because the Workbench components/modes do not exist.

- [ ] **Step 5: Implement `WorkbenchSceneTree` as a simple chapter `<details>` tree**

Reuse `readableChapterLabel` and `readableSceneLabel`. Render a small type badge from `scene.type`; do not derive or display repository paths as scene labels.

Scene key/selection uses:

```ts
`${chapter.id}:${scene.id}`
```

not a path.

- [ ] **Step 6: Move the existing Stage detail workflow into `StageView` without semantic changes**

Move the current:

- selected sublocation state/effect;
- scene metadata;
- Save Layout control/toast;
- `TargetList`;
- `EvidenceAssignmentPanel`;
- `EditorCanvas`;

from `App.svelte` into `StageView.svelte`.

The only ownership change is that `StageView` receives IDs/type and calls the Task 3 store. Preserve existing layout mutation functions and UI behavior byte-for-behavior where practical.

- [ ] **Step 7: Make `App.svelte` the small composition root**

On mount, call `loadWorkbenchIndex()` and select the first manifest-listed scene when no selection exists. Own:

```ts
type WorkbenchMode = "reader" | "stage";
let mode = $state<WorkbenchMode>("reader");
let selectedChapterId = $state<string | null>(null);
let selectedSceneId = $state<string | null>(null);
```

Compose the sidebar tree plus:

```svelte
{#if mode === "reader"}
  <!-- Reader placeholder until Task 5; selected identity remains live -->
{:else}
  <StageView ... />
{/if}
```

Do not introduce routing or URL state.

- [ ] **Step 8: Update visible Tauri branding only**

In `apps/layout-editor/src-tauri/tauri.conf.json` change:

```json
"productName": "Lyra Story Workbench"
```

and window:

```json
"title": "Lyra Story Workbench"
```

Keep:

```json
"identifier": "com.lyra.layout-editor"
```

unchanged.

- [ ] **Step 9: Run shell/Stage tests plus current editor suite**

```bash
bun run --cwd apps/layout-editor test src/App.test.ts src/lib/WorkbenchSceneTree.test.ts src/lib/StageView.test.ts
bun run --cwd apps/layout-editor test
```

Expected: PASS, including existing canvas/layout/evidence tests.

- [ ] **Step 10: Commit the functional shell/Stage move**

```bash
git add apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts apps/layout-editor/src/lib/WorkbenchSceneTree.svelte apps/layout-editor/src/lib/WorkbenchSceneTree.test.ts apps/layout-editor/src/lib/StageView.svelte apps/layout-editor/src/lib/StageView.test.ts apps/layout-editor/src-tauri/tauri.conf.json
git commit -m "feat(editor): add Story Workbench shell and Stage mode"
```

---

### Task 5: Add the current-scene Reader, branch grouping, source references, and four local controls

**Files:**
- Create: `apps/layout-editor/src/lib/reader-view.ts`
- Create: `apps/layout-editor/src/lib/reader-view.test.ts`
- Create: `apps/layout-editor/src/lib/ReaderView.svelte`
- Create: `apps/layout-editor/src/lib/ReaderView.test.ts`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`

**Interfaces:**
- Pure helper types/functions in `reader-view.ts`:

```ts
export type ReaderCueMode = "dialogue" | "dialogueAndCues";
export type ReaderBranchMode = "main" | "expanded";

export function collectSpeakers(scenes: readonly ReaderScene[]): string[];
export function sourceReference(scene: ReaderScene, group?: ReaderGroup): string;
export function filterReaderScene(
  scene: ReaderScene,
  options: {
    cueMode: ReaderCueMode;
    speaker: string | null;
    branchMode: ReaderBranchMode;
    query: string;
  },
): { scene: ReaderScene; matchCount: number };
```

- `ReaderView` props:

```ts
{
  scenes: ReaderScene[];
  scope: "scene" | "chapter";
  onScopeChange: (scope: "scene" | "chapter") => void;
  loading: boolean;
  error: string | null;
}
```

`ReaderView` owns the other four in-memory filters because they are purely presentation state.

- [ ] **Step 1: Write pure helper tests for source refs, speaker/cue filtering, branch expansion, and search**

Use a nested fixture containing:

- main dialogue by `相馬律` and `早坂茜`;
- an action cue;
- a branch group with one `三宅蒼太` line;
- a semantic anchor `q_backroom`.

Pin:

```ts
expect(sourceReference(scene, branch)).toBe(
  "docs/stories_plan/chapter_1/interrogation_scene_4.md#q_backroom",
);
```

Pin cue filtering so dialogue-only removes `action`/`sceneTag` but keeps lines. Pin speaker filtering so a `speaker: "相馬律"` filter keeps contextual group headings but removes other speakers' line items. Pin main branch mode so branch groups remain represented but their child items/groups are not expanded. Pin expanded mode so branch content is searchable/renderable.

Search is case-insensitive substring matching across visible dialogue/notice text and group labels. An ancestor group is retained when a descendant matches.

- [ ] **Step 2: Run pure tests and verify they fail**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-view.test.ts
```

Expected: module/function-not-found failures.

- [ ] **Step 3: Implement `reader-view.ts` as pure immutable transforms**

Do not mutate backend bundles. Clone only groups/items needed for the filtered view. Match count counts matching leaf items plus directly matching group labels once each; document that behavior in the test names rather than adding a second search-index structure.

`collectSpeakers` returns first-appearance order with duplicates removed.

- [ ] **Step 4: Write `ReaderView` rendering tests for all four scene projections**

Use writer-safe Reader fixtures, not raw compiler fixtures:

- linear: scene tag/action/dialogue order;
- investigation: `Sublocation` → `Hotspot`/`Topic` groups and reveal notice;
- interrogation: line plus separate `Press`, `Correct Present`, `Wrong Present`, and `Fallback` child branches;
- analysis: Intro, board prompt, public result dialogue, Outro; the fixture object must not contain hidden-answer keys.

Also test source-reference copy text is displayed in each scene/group header and type labels are visible.

- [ ] **Step 5: Write Reader control interaction tests**

Using Testing Library/user-event:

- toggle `Dialogue only` ↔ `Dialogue + cues`;
- choose one speaker from an `All speakers` control;
- toggle `Main flow` ↔ `Expanded branches`;
- type search text and assert only matching hierarchy remains plus match count;
- assert changing controls does not call any Tauri API or persistence function.

- [ ] **Step 6: Run Reader component tests and verify they fail**

```bash
bun run --cwd apps/layout-editor test src/lib/ReaderView.test.ts
```

Expected: component-not-found failure.

- [ ] **Step 7: Implement `ReaderView.svelte`**

Use semantic HTML:

- `<article>` per scene;
- scene type badge and source path in `<header>`;
- nested `<section>` / `<details>` for Reader groups;
- dialogue rows with speaker `<strong>` and text;
- cue rows visually distinct but plain text;
- notice rows labelled by notice kind;
- source reference displayed with a native button that calls `navigator.clipboard.writeText(reference)` only if available; always keep the literal reference visible so copy support is an enhancement, not a dependency.

Use existing project styling conventions; add no component library.

- [ ] **Step 8: Load/render the selected current scene from `App.svelte`**

Add a session-local bundle cache:

```ts
const sceneBundles = new Map<string, WorkbenchSceneBundle>();
```

Key with `${chapterId}:${sceneId}`. Add a generation counter so a slower prior selection cannot overwrite the current Reader state.

On Reader selection:

1. reuse cached bundle if present;
2. otherwise call `loadSceneBundle(chapterId, sceneId)`;
3. cache success;
4. pass `[bundle.reader]` to `ReaderView` with `scope="scene"` initially.

Do not preload the chapter yet; Task 6 owns chapter scope.

- [ ] **Step 9: Run focused Reader + App tests and the full editor suite**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-view.test.ts src/lib/ReaderView.test.ts src/App.test.ts
bun run --cwd apps/layout-editor test
```

Expected: PASS.

- [ ] **Step 10: Commit current-scene Reader**

```bash
git add apps/layout-editor/src/lib/reader-view.ts apps/layout-editor/src/lib/reader-view.test.ts apps/layout-editor/src/lib/ReaderView.svelte apps/layout-editor/src/lib/ReaderView.test.ts apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(editor): add writer-focused scene Reader"
```

---

### Task 6: Add whole-chapter Reader scope, close scope leaks, and run HPA-634 verification

**Files:**
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`
- Modify: `apps/layout-editor/src/lib/ReaderView.svelte`
- Modify: `apps/layout-editor/src/lib/ReaderView.test.ts`
- Modify: `apps/layout-editor/src-tauri/src/lib.rs` only if verification exposes a domain/projection bug; do not broaden the API.
- Modify: `docs/superpowers/specs/2026-08-27-hpa-634-story-workbench-reader-design.md` only for factual implementation deviations discovered during execution.
- Modify: `docs/superpowers/plans/2026-08-27-hpa-634-story-workbench-reader-implementation-plan.md` only to mark completed checkboxes/evidence when the execution workflow uses the plan as its ledger.

**Interfaces:**
- Consumes: existing session-local `Map<string, WorkbenchSceneBundle>` and `loadSceneBundle` only.
- Produces no new backend command.
- `App.svelte` supplies `ReaderView.scenes` as:
  - `[currentReaderScene]` for scene scope;
  - all selected chapter manifest scenes, in index order, for chapter scope.

- [ ] **Step 1: Add a failing whole-chapter ordering/cache test in `App.test.ts`**

Mock an index with four scene types in a non-alphabetic manifest order. Switch Reader scope to `Whole chapter` and assert `loadSceneBundle` is called once per manifest scene in that exact order.

Then switch back to scene scope and to whole chapter again; assert already loaded scenes are reused and there are no duplicate API calls.

Add a failure case where the third scene rejects. Assert the UI names that scene and does not render a silently truncated chapter as complete.

- [ ] **Step 2: Run the focused App test and verify it fails**

```bash
bun run --cwd apps/layout-editor test src/App.test.ts
```

Expected: FAIL because only current-scene loading exists.

- [ ] **Step 3: Implement whole-chapter loading with the existing bundle command**

When Reader requests chapter scope:

1. read the selected chapter's `scenes` from `WorkbenchIndex`;
2. for each scene in array order, reuse cache or await `loadSceneBundle(chapter.id, scene.id)`;
3. after every await, check the Reader/chapter load generation before mutating visible state;
4. collect `bundle.reader` in manifest order;
5. if any scene fails, set a message such as `Failed to load chapter_1/interrogation_scene_4: <normalized error>` and keep the previous valid Reader display until the next successful request.

Do not add `load_chapter_bundle`, background prefetch, persistent cache, or worker machinery.

- [ ] **Step 4: Make scene boundaries/type labels explicit in chapter scope**

`ReaderView` already renders one `<article>` per scene. In chapter scope, add a chapter-reading header and ensure each article remains independently collapsible at the scene boundary without altering branch hierarchy inside it.

Pin in `ReaderView.test.ts` that manifest order is preserved exactly and every scene type badge remains visible.

- [ ] **Step 5: Run all editor and backend tests**

```bash
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Run the ticket's authoritative content/type/build checks**

```bash
bun run scenes:compile
bun run editor:check
bun run editor:build
bun run test:scripts
```

Expected: all PASS. `editor:build` must build the Tauri app with the new visible product name without changing the package identifier.

- [ ] **Step 7: Run repository lint/format/Rust checks**

```bash
bun run lint:all
```

Expected: PASS.

- [ ] **Step 8: Perform deletion/scope greps**

Run:

```bash
rg 'read_project_file|write_project_file|resolve_layout_path' apps/layout-editor/src apps/layout-editor/src-tauri/src
rg 'static/stories_plan' apps/layout-editor/src apps/layout-editor/src-tauri/src
rg 'acceptedGroupByCard|acceptedOrder|acceptedSelections|minimumSelected' apps/layout-editor/src
rg 'Assets|Plan|Review|AI' apps/layout-editor/src/App.svelte apps/layout-editor/src/lib/WorkbenchSceneTree.svelte
```

Expected:

- no production generic IPC command/call remains;
- no layout-editor production dual story root remains;
- no Analysis hidden-answer field appears in frontend Reader production code;
- no placeholder Workbench modes were added. Test fixtures/negative assertions may contain these strings deliberately.

- [ ] **Step 9: Review final diff against HPA-634 acceptance criteria**

Confirm the branch changes only the Story Workbench/backend/domain tests and the two HPA-634 planning documents. Specifically verify there is no production game code/schema change and no source-writing command beyond investigation layout sidecars.

Use:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
git diff --check main...HEAD
```

Expected: `git diff --check` reports no whitespace errors.

- [ ] **Step 10: Commit whole-chapter/closeout changes**

```bash
git add apps/layout-editor docs/superpowers/specs/2026-08-27-hpa-634-story-workbench-reader-design.md docs/superpowers/plans/2026-08-27-hpa-634-story-workbench-reader-implementation-plan.md
git commit -m "feat(editor): complete continuous chapter Reader"
```

---

## Final Acceptance Checklist

- [ ] `Lyra Story Workbench` is the visible app/window branding; `apps/layout-editor` and `com.lyra.layout-editor` remain unchanged.
- [ ] Only Reader and Stage modes exist.
- [ ] The scene tree lists every manifest-listed linear/investigation/interrogation/analysis scene in compiler order.
- [ ] Reader renders all four scene types without using game progression UI.
- [ ] Investigation and interrogation branches remain explicitly grouped instead of being flattened into a fake canonical order.
- [ ] Whole-chapter mode renders only manifest-listed scenes and preserves order/boundaries.
- [ ] Dialogue/cue, speaker, branch, scene/chapter, and local text-search controls are in-memory only.
- [ ] Canonical `docs/stories_plan/...md[#anchor]` references are visible/copyable.
- [ ] Frontend production IPC passes IDs only; generic repository paths are gone.
- [ ] `static/stories_plan` is not part of the layout-editor source resolution path.
- [ ] Existing investigation Stage geometry/evidence/layout saving behavior remains green.
- [ ] Analysis accepted answers/threshold correctness fields do not cross Reader IPC or appear in frontend production code.
- [ ] No production game ownership/schema/runtime file changed.
- [ ] `bun run scenes:compile` passes.
- [ ] `bun run --cwd apps/layout-editor test` passes.
- [ ] `cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml` passes.
- [ ] `bun run editor:check` passes.
- [ ] `bun run editor:build` passes.
- [ ] `bun run test:scripts` passes.
- [ ] `bun run lint:all` passes.
