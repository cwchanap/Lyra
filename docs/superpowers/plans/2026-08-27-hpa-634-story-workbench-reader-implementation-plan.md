# HPA-634 Story Workbench Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first useful Lyra Story Workbench slice: an all-scene Reader plus the existing investigation Stage workflow, backed by identifier-based Tauri commands and writer-safe compiled-scene projections.

**Architecture:** Keep authored Markdown/layout sidecars and the existing scene compiler authoritative. The layout-editor Tauri backend resolves chapter/scene IDs against compiled `chapters.json`, projects only writer-safe Reader fields, and owns canonical source/layout paths; the Svelte app renders a small Reader/Stage shell and keeps Reader filters entirely in memory. No new compiler artifact, runtime story model, router, document registry, or compatibility layer is introduced.

**Tech Stack:** Tauri 2 / Rust / serde + serde_json, Svelte 5, TypeScript, Vitest + Testing Library, existing `@lyra/scene-types`, existing scene compiler.

**Spec:** `docs/superpowers/specs/2026-08-27-hpa-634-story-workbench-reader-design.md`

## Global Constraints

- HPA-634 lands as one PR. Tasks below are commit/review boundaries inside that PR, not separate PRs.
- Keep the package/path `apps/layout-editor` and Tauri identifier `com.lyra.layout-editor`; visible product/window branding becomes `Lyra Story Workbench`.
- The final product exposes only two functional modes: `Reader` and `Stage`. A mode is added only in the task that makes it functional.
- `docs/stories_plan` is the sole authored story root for this implementation; do not keep `static/stories_plan` fallback behavior.
- Frontend Tauri calls use chapter/scene/domain identifiers only. No arbitrary repository path is accepted by a production command.
- Reader uses existing compiled scene JSON. Do not parse authored Markdown in Svelte or add another compiler output.
- Reader must never receive Analysis accepted mappings, accepted order/selections, minimum thresholds, fixed correctness anchors, scoring/eligibility rules, or runtime progression semantics solely for rendering.
- Stage remains the only writer in this ticket and may write only the existing investigation `.layout.json` sidecar for the selected manifest-listed investigation scene.
- Do not modify production game ownership/schema/runtime behavior.
- No backward-compatibility path for the nonexistent `static/stories_plan` tree or old generic editor IPC.
- No new dependencies; current repository dependencies cover the implementation.

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
  - become the Workbench composition root: index load, selected `{chapterId, sceneId}`, Reader/Stage mode once Reader is functional, session-local scene-bundle cache, and component composition.
- Modify `apps/layout-editor/src-tauri/tauri.conf.json`
  - visible product/window title only.

### Tests

- Modify `apps/layout-editor/src/App.test.ts`
- Create `apps/layout-editor/src/lib/WorkbenchSceneTree.test.ts`
- Create `apps/layout-editor/src/lib/StageView.test.ts`
- Create `apps/layout-editor/src/lib/ReaderView.test.ts`
- Create `apps/layout-editor/src/lib/reader-view.test.ts`
- Modify `apps/layout-editor/src/lib/layout-store.test.ts`
- Keep existing `EditorCanvas`, `EvidenceAssignmentPanel`, geometry, and evidence-assignment tests unchanged unless moving Stage composition requires import/setup updates only.

---

### Task 1: Add the backend Workbench index and manifest-owned scene resolver

**Files:**
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`

**Interfaces:**
- Produces Rust serializable types `SceneType`, `WorkbenchIndex`, `WorkbenchChapterEntry`, `WorkbenchSceneEntry` and internal `ResolvedScene`.
- Produces:

```rust
fn load_workbench_index_at_root(root: &Path) -> Result<WorkbenchIndex, EditorError>;
fn resolve_manifest_scene_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<ResolvedScene, EditorError>;
```

- Tauri command: `load_workbench_index()`.
- Later tasks consume `ResolvedScene.scene_id`, `scene_type`, `compiled_path`, and `source_path`.

- [ ] **Step 1: Write the manifest-order/source-resolution tests**

Add `temp_workbench_root()` in the existing Rust test module. It creates the required `docs/stories_plan` and compiled scene directories, then writes this `chapters.json`:

```json
{
  "chapters": [
    {
      "id": "chapter_1",
      "title": "Chapter One",
      "summary": "One",
      "scenes": [
        {"type": "linear", "file": "chapter_1/scene_a.json"},
        {"type": "investigation", "file": "chapter_1/investigation_scene_b.json"},
        {"type": "interrogation", "file": "chapter_1/interrogation_scene_c.json"},
        {"type": "analysis", "file": "chapter_1/analysis_scene_d.json"}
      ]
    }
  ]
}
```

Create corresponding empty source `.md` files and compiled JSON files. Add:

```rust
#[test]
fn workbench_index_preserves_manifest_order_and_uses_docs_story_sources() {
    let root = temp_workbench_root();
    let index = load_workbench_index_at_root(&root).unwrap();
    let scenes = &index.chapters[0].scenes;

    assert_eq!(index.chapters[0].id, "chapter_1");
    assert_eq!(
        scenes.iter().map(|scene| scene.id.as_str()).collect::<Vec<_>>(),
        vec![
            "scene_a",
            "investigation_scene_b",
            "interrogation_scene_c",
            "analysis_scene_d",
        ]
    );
    assert_eq!(scenes[0].scene_type, SceneType::Linear);
    assert_eq!(
        scenes[0].source_path,
        "docs/stories_plan/chapter_1/scene_a.md"
    );
    assert!(!scenes[0].stage_capable);
    assert!(scenes[1].stage_capable);
}

#[test]
fn resolve_manifest_scene_rejects_unknown_chapter() {
    let root = temp_workbench_root();
    let error = resolve_manifest_scene_at_root(&root, "chapter_missing", "scene_a")
        .unwrap_err();
    assert_eq!(error.code, "chapterNotFound");
}

#[test]
fn resolve_manifest_scene_rejects_unknown_scene() {
    let root = temp_workbench_root();
    let error = resolve_manifest_scene_at_root(&root, "chapter_1", "scene_missing")
        .unwrap_err();
    assert_eq!(error.code, "sceneNotFound");
}
```

- [ ] **Step 2: Run the focused tests and verify red**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml workbench_index_preserves_manifest_order_and_uses_docs_story_sources
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml resolve_manifest_scene_rejects
```

Expected: compile failures for missing Workbench index/resolver types/functions.

- [ ] **Step 3: Implement the minimal index/resolver structs**

Add:

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

#[derive(Debug)]
struct ResolvedScene {
    scene_id: String,
    scene_type: SceneType,
    compiled_path: PathBuf,
    source_path: PathBuf,
}
```

Use private deserialization structs mirroring only `chapters.json`:

```rust
#[derive(Deserialize)]
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

Map `chapter_1/scene_a.json` to `docs/stories_plan/chapter_1/scene_a.md`. Canonicalize backend-constructed existing paths and assert they remain below the canonical workspace root before reading them.

- [ ] **Step 4: Add and register `load_workbench_index`**

```rust
#[tauri::command]
fn load_workbench_index() -> Result<WorkbenchIndex, EditorError> {
    let root = workspace_root()?;
    load_workbench_index_at_root(&root)
}
```

Keep old commands registered only until Task 3 performs the frontend cutover.

- [ ] **Step 5: Run all backend tests**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs
git commit -m "feat(editor): add manifest-owned workbench index"
```

---

### Task 2: Project compiled scenes into a writer-safe Reader bundle

**Files:**
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Task 1 resolver.
- Produces Reader wire structs and:

```rust
fn load_scene_bundle_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<WorkbenchSceneBundle, EditorError>;
```

- Tauri command: `load_scene_bundle(chapter_id, scene_id)`.
- `WorkbenchSceneBundle.investigation_scene: Option<serde_json::Value>` is populated only for investigation scenes.

- [ ] **Step 1: Write exact compiled fixtures for each current scene type**

Replace the Task 1 compiled files with these valid minimal public shapes.

Linear:

```json
{
  "type":"linear",
  "id":"scene_a",
  "title":"Linear",
  "summary":"",
  "queue":[
    {"kind":"line","speaker":"相馬律","text":"linear line","portrait":null},
    {"kind":"action","text":"linear action"}
  ],
  "assetRefs":[]
}
```

Investigation:

```json
{
  "type":"investigation",
  "id":"investigation_scene_b",
  "title":"Investigation",
  "summary":"",
  "intro":[{"kind":"line","speaker":"早坂茜","text":"investigation intro","portrait":null}],
  "assetRefs":[],
  "sublocations":[{
    "id":"cafe",
    "label":"Cafe",
    "status":"unlocked",
    "unlock":null,
    "reveals":[],
    "sceneTag":"cafe",
    "backgroundAssetId":null,
    "bgm":null,
    "bgs":null,
    "transitionDialogue":[],
    "hotspots":[{
      "id":"door",
      "label":"Door",
      "description":"",
      "status":"unlocked",
      "unlock":null,
      "reveals":[{"kind":"evidence","id":"door_log"}],
      "evidenceSource":null,
      "sceneSourcePrompt":null,
      "inspectDialogue":[{"kind":"line","speaker":"相馬律","text":"inspect door","portrait":null}],
      "onReexamine":null,
      "layout":null
    }],
    "characters":[{
      "id":"miyake",
      "name":"三宅蒼太",
      "role":"店員",
      "bio":"",
      "layout":null,
      "topics":[{
        "id":"shift",
        "label":"Shift",
        "status":"unlocked",
        "unlock":null,
        "reveals":[],
        "topicDialogue":[{"kind":"line","speaker":"三宅蒼太","text":"topic line","portrait":null}],
        "onReexamine":null
      }]
    }]
  }],
  "evidenceManifest":[],
  "statementManifest":[],
  "outro":{"unlock":"auto","dialogue":[]}
}
```

Interrogation:

```json
{
  "type":"interrogation",
  "id":"interrogation_scene_c",
  "title":"Interrogation",
  "summary":"",
  "intro":[{"kind":"line","speaker":"相馬律","text":"interrogation intro","portrait":null}],
  "assetRefs":[],
  "phases":[{
    "kind":"inquiry",
    "id":"ask_miyake",
    "label":"Ask Miyake",
    "subject":{"id":"miyake","name":"三宅蒼太","role":"店員","bio":"","portrait":null},
    "required":true,
    "status":"unlocked",
    "representedAuthority":null,
    "unlock":null,
    "reveals":[],
    "sceneTag":"police",
    "backgroundAssetId":null,
    "bgm":null,
    "bgs":null,
    "entryDialogue":[],
    "complete":"auto",
    "questions":[{
      "id":"q_backroom",
      "label":"Backroom",
      "status":"unlocked",
      "required":true,
      "unlock":null,
      "reveals":[],
      "testimony":{
        "onLoop":[],
        "loopPrompt":[],
        "defaultChallenge":[{"kind":"line","speaker":"相馬律","text":"fallback press","portrait":null}],
        "defaultWrong":[{"kind":"line","speaker":"三宅蒼太","text":"fallback wrong","portrait":null}],
        "wrongReply":[{"kind":"line","speaker":"相馬律","text":"fallback reply","portrait":null}],
        "lines":[{
          "id":"miyake_backroom_reason",
          "label":"Backroom reason",
          "content":[{"kind":"line","speaker":"三宅蒼太","text":"testimony line","portrait":null}],
          "contradiction":{"kind":"evidence","id":"cctv"},
          "challenge":[{"kind":"line","speaker":"相馬律","text":"press branch","portrait":null}],
          "onCorrect":[{"kind":"line","speaker":"三宅蒼太","text":"correct present branch","portrait":null}],
          "onWrongEvidence":[{"kind":"line","speaker":"三宅蒼太","text":"wrong present branch","portrait":null}],
          "reveals":[]
        }]
      }
    }]
  }],
  "evidenceManifest":[],
  "statementManifest":[],
  "outro":{"unlock":"auto","dialogue":[]}
}
```

Analysis with three board kinds and deliberate hidden sentinel values:

```json
{
  "type":"analysis",
  "id":"analysis_scene_d",
  "title":"Analysis",
  "summary":"",
  "assetRefs":[],
  "intro":[{"kind":"line","speaker":"相馬律","text":"analysis intro","portrait":null}],
  "boards":[
    {
      "kind":"classify",
      "common":{"id":"classify_board","label":"Classify","prompt":"public classify prompt","unlock":null,"reveals":[],"feedback":{"incomplete":"","incorrect":"","hint":null,"incorrectSelections":[]},"cards":[],"resultDialogue":[{"kind":"line","speaker":"相馬律","text":"public classify result","portrait":null}]},
      "groups":[],
      "acceptedGroupByCard":{"secret_card":"secret_group"}
    },
    {
      "kind":"order",
      "common":{"id":"order_board","label":"Order","prompt":"public order prompt","unlock":null,"reveals":[],"feedback":{"incomplete":"","incorrect":"","hint":null,"incorrectSelections":[]},"cards":[],"resultDialogue":[{"kind":"line","speaker":"相馬律","text":"public order result","portrait":null}]},
      "acceptedOrder":["secret_order"],
      "fixedAnchors":[{"cardId":"secret_anchor","position":1}]
    },
    {
      "kind":"threshold",
      "common":{"id":"threshold_board","label":"Threshold","prompt":"public threshold prompt","unlock":null,"reveals":[],"feedback":{"incomplete":"","incorrect":"","hint":null,"incorrectSelections":[]},"cards":[],"resultDialogue":[{"kind":"line","speaker":"相馬律","text":"public threshold result","portrait":null}]},
      "minimumSelected":7,
      "acceptedSelections":[["secret_selection"]]
    }
  ],
  "outro":[{"kind":"line","speaker":"早坂茜","text":"analysis outro","portrait":null}]
}
```

- [ ] **Step 2: Write concrete projection assertions**

Add:

```rust
#[test]
fn linear_reader_preserves_dialogue_and_action_order() {
    let root = temp_workbench_root();
    let bundle = load_scene_bundle_at_root(&root, "chapter_1", "scene_a").unwrap();
    let json = serde_json::to_value(bundle.reader).unwrap();

    assert_eq!(json["groups"][0]["items"][0]["dialogue"]["text"], "linear line");
    assert_eq!(json["groups"][0]["items"][1]["dialogue"]["text"], "linear action");
}

#[test]
fn investigation_reader_groups_sublocation_hotspot_topic_and_reveal() {
    let root = temp_workbench_root();
    let bundle = load_scene_bundle_at_root(&root, "chapter_1", "investigation_scene_b").unwrap();
    let json = serde_json::to_value(bundle.reader).unwrap();
    let serialized = json.to_string();

    assert!(serialized.contains("Cafe"));
    assert!(serialized.contains("Door"));
    assert!(serialized.contains("Shift"));
    assert!(serialized.contains("door_log"));
    assert!(serialized.contains("inspect door"));
    assert!(serialized.contains("topic line"));
}

#[test]
fn interrogation_reader_keeps_press_correct_wrong_and_fallback_branches_separate() {
    let root = temp_workbench_root();
    let bundle = load_scene_bundle_at_root(&root, "chapter_1", "interrogation_scene_c").unwrap();
    let serialized = serde_json::to_string(&bundle.reader).unwrap();

    assert!(serialized.contains("Press"));
    assert!(serialized.contains("Correct Present"));
    assert!(serialized.contains("Wrong Present"));
    assert!(serialized.contains("Fallback"));
    assert!(serialized.contains("press branch"));
    assert!(serialized.contains("correct present branch"));
    assert!(serialized.contains("wrong present branch"));
    assert!(serialized.contains("fallback press"));
}

#[test]
fn analysis_reader_exposes_public_dialogue_without_hidden_answers() {
    let root = temp_workbench_root();
    let bundle = load_scene_bundle_at_root(&root, "chapter_1", "analysis_scene_d").unwrap();
    let serialized = serde_json::to_string(&bundle.reader).unwrap();

    assert!(serialized.contains("public classify prompt"));
    assert!(serialized.contains("public classify result"));
    assert!(serialized.contains("public order result"));
    assert!(serialized.contains("public threshold result"));
    assert!(serialized.contains("analysis outro"));
    for forbidden in [
        "acceptedGroupByCard",
        "secret_group",
        "acceptedOrder",
        "secret_order",
        "fixedAnchors",
        "secret_anchor",
        "minimumSelected",
        "acceptedSelections",
        "secret_selection",
    ] {
        assert!(!serialized.contains(forbidden), "leaked {forbidden}");
    }
}
```

Use exact child labels `Press`, `Correct Present`, `Wrong Present`, and `Fallback` in the projection so UI/tests share one vocabulary.

- [ ] **Step 3: Run projection tests and verify red**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml reader_
```

Expected: compile failures for missing Reader model/projection functions.

- [ ] **Step 4: Add the writer-safe Reader wire structs**

Add `WorkbenchSceneBundle`, `ReaderScene`, `ReaderGroup`, `ReaderFlow`, `ReaderItem`, `ReaderDialogue`, and `ReaderNoticeKind` as `Serialize` types. `ReaderDialogue` has only scene-tag text, action text, or line speaker/text. `ReaderNoticeKind` has only `Reveal`, `Evidence`, `Statement`, `Contradiction`, and `Prompt`.

Use this exact shape:

```rust
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
#[serde(tag = "kind", rename_all = "camelCase")]
enum ReaderDialogue {
    SceneTag { text: String },
    Action { text: String },
    Line { speaker: String, text: String },
}
```

- [ ] **Step 5: Implement selective JSON projection**

Read compiled files as `serde_json::Value`. Add small helpers:

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

Rules:

- Linear: one main-flow group containing `queue`.
- Investigation: Intro/Outro main groups; each sublocation branch contains transition dialogue, hotspot branches, character/topic branches, and public reveal notices.
- Interrogation: Intro/Outro main groups; preserve phase/question/line array order; line content stays on the testimony-line group; line `challenge` becomes `Press`, `onCorrect` becomes `Correct Present`, `onWrongEvidence` becomes `Wrong Present`; testimony `defaultChallenge`, `defaultWrong`, `wrongReply`, `loopPrompt`, and `onLoop` are grouped below `Fallback` with their authored labels. Do not flatten mutually exclusive branches.
- Analysis: inspect only `kind`, `common.id`, `common.label`, `common.prompt`, and `common.resultDialogue`; Intro and Outro are also public. Do not read any other board correctness field into Reader structs.
- Source anchors reuse public authored IDs for investigation sublocations/hotspots/topics, interrogation phases/questions/testimony lines, and analysis board IDs.

- [ ] **Step 6: Implement and register `load_scene_bundle`**

Use the Task 1 resolver, assert compiled JSON `type` and `id` match the manifest resolution, project the Reader by `SceneType`, and populate the Stage scene only for investigations.

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

- [ ] **Step 7: Run all backend tests**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS; the sentinel Analysis test is the hard boundary check.

- [ ] **Step 8: Commit**

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
- Frontend API:

```ts
loadWorkbenchIndex(): Promise<WorkbenchIndex>;
loadSceneBundle(chapterId: string, sceneId: string): Promise<WorkbenchSceneBundle>;
loadInvestigationLayout(chapterId: string, sceneId: string): Promise<InvestigationLayoutSidecar | null>;
saveInvestigationLayout(chapterId: string, sceneId: string, layout: InvestigationLayoutSidecar): Promise<void>;
```

- Stage store:

```ts
loadInvestigationScene(chapterId: string, sceneId: string): Promise<void>;
saveLayout(): Promise<void>;
```

- Final backend command set: `load_workbench_index`, `load_scene_bundle`, `load_investigation_layout`, `save_investigation_layout`.

- [ ] **Step 1: Write failing Stage command-contract tests**

Mock `@tauri-apps/api/core`. Pin:

```ts
await loadInvestigationScene("chapter_1", "investigation_scene_1");

expect(invoke).toHaveBeenCalledWith("load_scene_bundle", {
  chapterId: "chapter_1",
  sceneId: "investigation_scene_1",
});
expect(invoke).toHaveBeenCalledWith("load_investigation_layout", {
  chapterId: "chapter_1",
  sceneId: "investigation_scene_1",
});
expect(invoke).not.toHaveBeenCalledWith(
  "read_project_file",
  expect.anything(),
);
```

After seeding `editorState` via the load result, pin save:

```ts
await saveLayout();
expect(invoke).toHaveBeenCalledWith("save_investigation_layout", {
  chapterId: "chapter_1",
  sceneId: "investigation_scene_1",
  layout: expect.objectContaining({ sceneId: "investigation_scene_1" }),
});
```

- [ ] **Step 2: Run Stage store tests and verify red**

```bash
bun run --cwd apps/layout-editor test src/lib/layout-store.test.ts
```

Expected: FAIL because the current store still accepts paths and invokes generic commands.

- [ ] **Step 3: Add Workbench wire types and thin frontend API**

Create `workbench-types.ts`:

```ts
import type { DialogueItem, InvestigationSceneJson } from "./layout-types";

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
  | { kind: "notice"; noticeKind: "reveal" | "evidence" | "statement" | "contradiction" | "prompt"; text: string };
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

Create `workbench-api.ts` as exactly four thin `invoke` wrappers. It owns no state, cache, path composition, or presentation logic.

- [ ] **Step 4: Write exact backend layout tests**

Add:

```rust
#[test]
fn investigation_layout_round_trips_for_manifest_investigation_scene() {
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
fn investigation_layout_rejects_non_investigation_scene() {
    let root = temp_workbench_root();
    let error = save_investigation_layout_at_root(
        &root,
        "chapter_1",
        "scene_a",
        serde_json::json!({"version":1,"sceneId":"scene_a","sublocations":{}}),
    )
    .unwrap_err();
    assert_eq!(error.code, "sceneTypeMismatch");
}
```

Add one containment regression that calls the internal canonical layout-path resolver for `investigation_scene_b` and asserts the returned canonical parent starts with the canonical temp root.

- [ ] **Step 5: Run backend layout tests and verify red**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml investigation_layout_
```

Expected: compile failures for missing domain helpers.

- [ ] **Step 6: Implement the two layout domain commands**

Internal signatures:

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

Resolve the manifest scene first, require `SceneType::Investigation`, use `ResolvedScene.source_path.with_extension("layout.json")`, require `layout["sceneId"] == scene_id`, serialize pretty JSON with one trailing newline, and write with `fs::write`. Return `Ok(None)` only when the canonical sidecar does not exist.

- [ ] **Step 7: Refactor Stage store to IDs**

Replace `scenePath/layoutPath` with `chapterId/sceneId`. `loadInvestigationScene` loads the bundle and layout via `workbench-api.ts`; if layout is `null`, preserve the current default sidecar `{ version: 1, sceneId, sublocations: {} }`. Keep generation counters and geometry mutation functions unchanged.

- [ ] **Step 8: Delete old generic IPC in the same cutover**

Remove the production commands/types/helpers used only by arbitrary paths:

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
dual-root find_source_scene_path_at_root
```

Remove `OpenOptions`, `Write`, Unix `O_NOFOLLOW`, and symlink-only test imports when no longer used. Delete tests whose only contract was caller-controlled path escape/symlink behavior. Keep the backend-constructed containment regression from Step 4.

Register only the four domain commands.

- [ ] **Step 9: Run Stage/backend tests and deletion grep**

```bash
bun run --cwd apps/layout-editor test src/lib/layout-store.test.ts
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
rg 'read_project_file|write_project_file|resolve_layout_path' apps/layout-editor/src apps/layout-editor/src-tauri/src
```

Expected: tests PASS; grep has no production command/call matches. Negative test strings are acceptable.

- [ ] **Step 10: Commit**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs apps/layout-editor/src/lib/workbench-types.ts apps/layout-editor/src/lib/workbench-api.ts apps/layout-editor/src/lib/layout-store.svelte.ts apps/layout-editor/src/lib/layout-store.test.ts
git commit -m "refactor(editor): replace project paths with workbench commands"
```

---

### Task 4: Build the branded all-scene Workbench shell while preserving Stage

**Files:**
- Create: `apps/layout-editor/src/lib/WorkbenchSceneTree.svelte`
- Create: `apps/layout-editor/src/lib/WorkbenchSceneTree.test.ts`
- Create: `apps/layout-editor/src/lib/StageView.svelte`
- Create: `apps/layout-editor/src/lib/StageView.test.ts`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`
- Modify: `apps/layout-editor/src-tauri/tauri.conf.json`

**Interfaces:**

```ts
// WorkbenchSceneTree
{
  index: WorkbenchIndex;
  selectedChapterId: string | null;
  selectedSceneId: string | null;
  onSelect: (chapterId: string, sceneId: string) => void;
}

// StageView
{
  chapterId: string | null;
  sceneId: string | null;
  sceneType: SceneType | null;
}
```

This task does **not** expose a Reader mode yet. It delivers a functional branded Workbench shell with all-scene navigation and the existing Stage surface; Task 5 adds the Reader/Stage switch at the same time Reader becomes functional.

- [ ] **Step 1: Write all-scene tree tests**

Render a fixture whose manifest order is `scene_0`, `investigation_1`, `interrogation_2`, `analysis_3`. Assert all four scene buttons appear in that order. Click `analysis_3` and assert:

```ts
expect(onSelect).toHaveBeenCalledWith("chapter_1", "analysis_3");
```

- [ ] **Step 2: Write Stage preservation tests**

Pin:

1. investigation selection calls `loadInvestigationScene("chapter_1", "investigation_1")` and renders current Stage metadata/Save Layout once store data is present;
2. analysis selection renders `Stage layout editing is available for investigation scenes.` and never calls Stage load/save;
3. Save click calls `saveLayout()` and renders `Layout saved` status text.

- [ ] **Step 3: Rewrite `App.test.ts` for the branded shell**

Assert:

- heading `Lyra Story Workbench`;
- `loadWorkbenchIndex()` runs once;
- all-scene tree is rendered without filtering to investigations;
- selection passes IDs to `StageView`;
- no `Assets`, `Plan`, `Review`, or `AI` mode control is rendered.

Do not assert Reader controls in this task because Reader is not exposed until Task 5.

- [ ] **Step 4: Run shell/Stage tests and verify red**

```bash
bun run --cwd apps/layout-editor test src/App.test.ts src/lib/WorkbenchSceneTree.test.ts src/lib/StageView.test.ts
```

Expected: component/behavior failures.

- [ ] **Step 5: Implement `WorkbenchSceneTree`**

Use simple chapter `<details>` sections. Reuse `readableChapterLabel` / `readableSceneLabel`, render a small `scene.type` badge, select by `{chapterId, sceneId}`, and never use a repository path as the selection key.

- [ ] **Step 6: Move existing Stage detail UI to `StageView`**

Move selected sublocation state/effect, scene metadata, Save Layout/toast, `TargetList`, `EvidenceAssignmentPanel`, and `EditorCanvas` from `App.svelte`. Preserve store mutation functions and existing canvas/evidence behavior.

For non-investigation scene types, render only the truthful Stage limitation message and do not call `loadInvestigationScene`.

- [ ] **Step 7: Reduce `App.svelte` to the Workbench composition root**

On first index load, select the first manifest scene. Own only index loading and selected IDs in this task:

```ts
let selectedChapterId = $state<string | null>(null);
let selectedSceneId = $state<string | null>(null);
```

Render `WorkbenchSceneTree` + `StageView`. No router or URL state.

- [ ] **Step 8: Update visible Tauri branding**

Set product/window title to `Lyra Story Workbench`; keep `identifier: "com.lyra.layout-editor"` unchanged.

- [ ] **Step 9: Run the full editor suite**

```bash
bun run --cwd apps/layout-editor test
```

Expected: PASS, including existing canvas/layout/evidence tests.

- [ ] **Step 10: Commit**

```bash
git add apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts apps/layout-editor/src/lib/WorkbenchSceneTree.svelte apps/layout-editor/src/lib/WorkbenchSceneTree.test.ts apps/layout-editor/src/lib/StageView.svelte apps/layout-editor/src/lib/StageView.test.ts apps/layout-editor/src-tauri/tauri.conf.json
git commit -m "feat(editor): add Story Workbench shell and Stage view"
```

---

### Task 5: Add functional Reader mode, current-scene rendering, source references, and four local filters

**Files:**
- Create: `apps/layout-editor/src/lib/reader-view.ts`
- Create: `apps/layout-editor/src/lib/reader-view.test.ts`
- Create: `apps/layout-editor/src/lib/ReaderView.svelte`
- Create: `apps/layout-editor/src/lib/ReaderView.test.ts`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`

**Interfaces:**

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

`ReaderView` initially receives one scene plus `loading/error`; Task 6 adds scope control/whole-chapter array behavior.

- [ ] **Step 1: Write pure filter/source-reference tests**

Use one nested fixture with main lines by `相馬律` / `早坂茜`, an action, and a branch with `三宅蒼太` plus anchor `q_backroom`.

Assert:

```ts
expect(sourceReference(scene, branch)).toBe(
  "docs/stories_plan/chapter_1/interrogation_scene_4.md#q_backroom",
);
```

Then assert:

- `dialogue` cue mode removes action/scene-tag items but keeps line items;
- speaker `相馬律` removes other line speakers but retains ancestor group headings; cue rows remain controlled only by cue mode;
- `main` branch mode retains branch headers but removes their branch items/children;
- `expanded` exposes branch items;
- search is case-insensitive substring matching across visible dialogue/notice text and group labels and preserves matching ancestor hierarchy;
- match count counts matching leaf items plus directly matching group labels once each;
- `collectSpeakers` returns first-appearance order without duplicates.

- [ ] **Step 2: Run pure tests and verify red**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-view.test.ts
```

Expected: module/function-not-found failures.

- [ ] **Step 3: Implement pure immutable Reader transforms**

Do not mutate backend bundles. Clone only retained groups/items. Do not add a search index or persistence layer.

- [ ] **Step 4: Write `ReaderView` rendering fixtures for all four scene types**

Use writer-safe `ReaderScene` fixtures, not raw compiler JSON:

- linear contains main scene tag/action/dialogue;
- investigation contains `Sublocation` → `Hotspot` and `Topic` child groups plus a `reveal` notice;
- interrogation contains a testimony line with separate child groups labelled `Press`, `Correct Present`, `Wrong Present`, `Fallback`;
- analysis contains Intro, a `Board` group with prompt notice + public result dialogue, and Outro, and its fixture object contains none of the hidden correctness key names.

Assert scene type labels and literal source references are visible.

- [ ] **Step 5: Write Reader control tests**

Using Testing Library/user-event, assert UI can:

- toggle `Dialogue only` / `Dialogue + cues`;
- choose `All speakers` or one speaker;
- toggle `Main flow` / `Expanded branches`;
- type local search and see filtered hierarchy + match count;
- change these controls without invoking Tauri or persistence APIs.

- [ ] **Step 6: Run Reader tests and verify red**

```bash
bun run --cwd apps/layout-editor test src/lib/ReaderView.test.ts src/lib/reader-view.test.ts
```

Expected: component/module failures.

- [ ] **Step 7: Implement `ReaderView.svelte`**

Use semantic `<article>` per scene and nested `<section>/<details>` groups. Render line speaker/text, cue rows, notice rows, type label, source path, and source refs. Keep literal refs visible; copy button calls `navigator.clipboard.writeText(reference)` only when available.

- [ ] **Step 8: Add Reader/Stage switch only now that both are functional**

In `App.svelte` add:

```ts
type WorkbenchMode = "reader" | "stage";
let mode = $state<WorkbenchMode>("reader");
const sceneBundles = new Map<string, WorkbenchSceneBundle>();
```

Add exactly two mode controls: `Reader`, `Stage`. Preserve selected IDs across switches.

For selected Reader scene, reuse cache or call `loadSceneBundle(chapterId, sceneId)`, guarded by a generation counter. Pass the resulting one `ReaderScene` to `ReaderView`.

Update `App.test.ts` to assert exactly these two functional mode controls and no future modes.

- [ ] **Step 9: Run Reader/App/full editor tests**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-view.test.ts src/lib/ReaderView.test.ts src/App.test.ts
bun run --cwd apps/layout-editor test
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/layout-editor/src/lib/reader-view.ts apps/layout-editor/src/lib/reader-view.test.ts apps/layout-editor/src/lib/ReaderView.svelte apps/layout-editor/src/lib/ReaderView.test.ts apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(editor): add writer-focused scene Reader"
```

---

### Task 6: Add whole-chapter scope and perform HPA-634 verification

**Files:**
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`
- Modify: `apps/layout-editor/src/lib/ReaderView.svelte`
- Modify: `apps/layout-editor/src/lib/ReaderView.test.ts`
- Modify backend/planning files only if execution reveals a factual bug; do not widen the API/scope.

**Interfaces:**
- Reuse the Task 5 in-memory `Map<string, WorkbenchSceneBundle>` and existing `loadSceneBundle` command; do not add a bulk backend command.
- `ReaderView` final props:

```ts
{
  scenes: ReaderScene[];
  scope: "scene" | "chapter";
  onScopeChange: (scope: "scene" | "chapter") => void;
  loading: boolean;
  error: string | null;
}
```

- [ ] **Step 1: Write whole-chapter order/cache/failure tests**

In `App.test.ts`, mock a chapter whose manifest scene order is deliberately non-alphabetic. Switch scope to `Whole chapter` and assert `loadSceneBundle` calls follow the manifest array exactly once per uncached scene. Switch scene → chapter again and assert cache reuse prevents duplicate calls.

For a rejected third scene, assert the UI names `chapterId/sceneId` and does not label/render a partial chapter as successfully loaded.

- [ ] **Step 2: Run App test and verify red**

```bash
bun run --cwd apps/layout-editor test src/App.test.ts
```

Expected: FAIL because chapter scope is not implemented.

- [ ] **Step 3: Implement chapter loading through existing scene command**

When scope changes to chapter:

1. read selected chapter `scenes` from `WorkbenchIndex`;
2. in manifest order, reuse cache or await `loadSceneBundle(chapter.id, scene.id)`;
3. after every await, check a chapter-load generation before changing visible state;
4. collect `bundle.reader` in manifest order;
5. on one failure, render `Failed to load <chapterId>/<sceneId>: <normalized error>` and retain the previous valid Reader display until a later successful request.

Do not add background prefetch, a persistent cache, worker, or `load_chapter_bundle` command.

- [ ] **Step 4: Add the fifth Reader control and visible scene boundaries**

`ReaderView` adds `Current scene` / `Whole chapter`. In chapter scope, render a chapter-reading header and one independently collapsible `<article>` boundary per scene; each keeps its scene type label and internal branch hierarchy.

Add tests that scene order is unchanged and type labels remain visible.

- [ ] **Step 5: Run all editor/backend tests**

```bash
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Run authoritative content/type/build checks**

```bash
bun run scenes:compile
bun run editor:check
bun run editor:build
bun run test:scripts
```

Expected: all PASS.

- [ ] **Step 7: Run lint/format/Rust checks**

```bash
bun run lint:all
```

Expected: PASS.

- [ ] **Step 8: Run deletion/scope greps**

```bash
rg 'read_project_file|write_project_file|resolve_layout_path' apps/layout-editor/src apps/layout-editor/src-tauri/src
rg 'static/stories_plan' apps/layout-editor/src apps/layout-editor/src-tauri/src
rg 'acceptedGroupByCard|acceptedOrder|acceptedSelections|minimumSelected|fixedAnchors' apps/layout-editor/src
rg 'Assets|Plan|Review|AI' apps/layout-editor/src/App.svelte apps/layout-editor/src/lib/WorkbenchSceneTree.svelte
```

Expected:

- no production generic IPC matches;
- no production layout-editor dual-root matches;
- no hidden Analysis correctness field in frontend production code;
- no future-mode control in the Workbench shell. Negative test strings are allowed in test files.

- [ ] **Step 9: Review final diff and whitespace**

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
git diff --check main...HEAD
```

Verify production changes stay inside `apps/layout-editor`; planning docs stay under `docs/superpowers`; no `apps/game` production schema/runtime file is changed; `git diff --check` has no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/layout-editor docs/superpowers/specs/2026-08-27-hpa-634-story-workbench-reader-design.md docs/superpowers/plans/2026-08-27-hpa-634-story-workbench-reader-implementation-plan.md
git commit -m "feat(editor): complete continuous chapter Reader"
```

---

## Final Acceptance Checklist

- [ ] `Lyra Story Workbench` is visible app/window branding; `apps/layout-editor` and `com.lyra.layout-editor` remain unchanged.
- [ ] Only functional Reader and Stage modes exist.
- [ ] Scene tree lists every manifest-listed linear/investigation/interrogation/analysis scene in compiler order.
- [ ] Reader renders all four scene types without game progression UI.
- [ ] Investigation/interrogation alternatives remain grouped rather than flattened.
- [ ] Whole-chapter mode renders only manifest-listed scenes and preserves order/boundaries.
- [ ] Dialogue/cue, speaker, branch, scene/chapter, and local search controls are in-memory only.
- [ ] Canonical `docs/stories_plan/...md[#anchor]` references are visible/copyable.
- [ ] Frontend production IPC passes IDs only; generic project-path IPC is gone.
- [ ] `static/stories_plan` is not part of layout-editor source resolution.
- [ ] Existing investigation Stage geometry/evidence/layout saving behavior remains green.
- [ ] Analysis accepted answers/threshold correctness fields do not cross Reader IPC or appear in frontend production code.
- [ ] No production game ownership/schema/runtime file changes.
- [ ] `bun run scenes:compile` passes.
- [ ] `bun run --cwd apps/layout-editor test` passes.
- [ ] `cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml` passes.
- [ ] `bun run editor:check` passes.
- [ ] `bun run editor:build` passes.
- [ ] `bun run test:scripts` passes.
- [ ] `bun run lint:all` passes.
