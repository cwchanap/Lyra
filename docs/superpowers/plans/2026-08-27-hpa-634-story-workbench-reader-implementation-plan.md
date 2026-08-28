# HPA-634 Story Workbench Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first useful Lyra Story Workbench slice: a continuous all-scene Reader plus the existing investigation Stage workflow, backed by identifier-based Tauri commands and a writer-safe compiled-scene projection.

**Architecture:** Authored Markdown/layout sidecars and the existing scene compiler remain authoritative. The layout-editor Tauri backend resolves chapter/scene IDs against compiled `chapters.json`, constructs canonical source/layout paths, and projects compiled scenes into a closed writer-facing Reader tree. `App.svelte` owns the Workbench index/selection/cache; the Stage store owns only mutable investigation scene/layout state. No new compiler artifact, game schema dependency, router, document registry, or compatibility layer is introduced.

**Tech Stack:** Tauri 2, Rust, serde/serde_json, Svelte 5, TypeScript, Vitest + Testing Library, existing `@lyra/scene-types`, existing scene compiler.

**Spec:** `docs/superpowers/specs/2026-08-27-hpa-634-story-workbench-reader-design.md`

## Global Constraints

- HPA-634 lands as one PR. Tasks are green commit/review boundaries inside that PR, never separate PRs.
- Keep `apps/layout-editor` and Tauri identifier `com.lyra.layout-editor`; visible product/window branding becomes `Lyra Story Workbench`.
- Final functional modes are exactly Reader and Stage. Do not add future-mode placeholders.
- `docs/stories_plan` is the only authored story root for the editor. Delete `static/stories_plan` fallback behavior.
- Frontend production IPC passes chapter/scene/domain identifiers only; no caller-controlled repository path command survives.
- Reader uses existing compiled scene JSON. Do not parse Markdown again or generate another catalog.
- Reader never receives Analysis accepted maps/order/selections, selection-specific scoring maps, fixed correctness anchors, minimum thresholds, runtime drafts/completion, or Analysis progression rules.
- Reader does include public authored Analysis cards, classify groups, generic feedback copy, prompts, and result dialogue.
- Stage remains the only writer and may write only the existing investigation `.layout.json` sidecar.
- `App.svelte` is the only frontend owner of `WorkbenchIndex`; delete `loadChapters()` and `editorState.chapters` during the IPC cutover.
- Unknown compiled dialogue/phase/Analysis-board variants are typed errors, not silent omissions.
- Do not modify production game runtime/schema/state.
- Do not add dependencies.

---

## Target file ownership

### Backend

Modify `apps/layout-editor/src-tauri/src/lib.rs` only. It will own:

- workspace root lookup;
- manifest scene resolution;
- canonical `docs/stories_plan` source/layout paths;
- Workbench index;
- writer-safe Reader projection;
- four domain Tauri commands;
- focused Rust tests.

After Task 3 it no longer owns generic project-file reads/writes or dual-root probing.

### Frontend domain

Create:

- `apps/layout-editor/src/lib/workbench-types.ts` — exact Reader/Workbench wire types;
- `apps/layout-editor/src/lib/workbench-api.ts` — four thin `invoke` wrappers;
- `apps/layout-editor/src/lib/reader-view.ts` — pure Reader filter/search/reference functions.

Modify:

- `apps/layout-editor/src/lib/layout-store.svelte.ts` — Stage scene/layout only, ID-based;
- `apps/layout-editor/src/lib/scene-labels.ts` — add Analysis label support.

### UI

Create:

- `WorkbenchSceneTree.svelte`;
- `StageView.svelte`;
- `ReaderView.svelte`.

Modify `App.svelte` into the Workbench composition root.

### Tests

Create/modify focused tests next to each owner. Existing `EditorCanvas`, evidence-assignment, and geometry tests remain as regression owners for Stage behavior.

---

## Reader wire vocabulary

Rust and TypeScript must match exactly.

```ts
export type SceneType = "linear" | "investigation" | "interrogation" | "analysis";

export type ReaderDialogue =
  | { kind: "sceneTag"; text: string }
  | { kind: "action"; text: string }
  | { kind: "line"; speaker: string; text: string };

export type ReaderNoticeKind =
  | "reveal"
  | "evidence"
  | "statement"
  | "contradiction"
  | "prompt"
  | "card"
  | "group"
  | "feedback";

export type ReaderItem =
  | { kind: "dialogue"; dialogue: ReaderDialogue }
  | { kind: "notice"; noticeKind: ReaderNoticeKind; text: string };

export type ReaderGroup = {
  id: string;
  kind: string;
  label: string;
  flow: "main" | "branch";
  sourceAnchor: string | null;
  items: ReaderItem[];
  children: ReaderGroup[];
};

export type ReaderScene = {
  id: string;
  type: SceneType;
  title: string;
  sourcePath: string;
  groups: ReaderGroup[];
};
```

Do not import/reuse Stage `DialogueItem` for Reader; Stage permits portrait data while Reader wire does not.

---

### Task 1: Add the manifest-owned Workbench index and scene resolver

**Files:**
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`

**Produces:**

```rust
fn load_workbench_index_at_root(root: &Path) -> Result<WorkbenchIndex, EditorError>;
fn resolve_manifest_scene_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<ResolvedScene, EditorError>;
```

Tauri command: `load_workbench_index`.

- [ ] **Step 1: Add deterministic manifest fixtures and failing resolver tests**

Add `temp_workbench_root()` that creates:

```text
docs/stories_plan/chapter_1/{scene_a,investigation_scene_b,interrogation_scene_c,analysis_scene_d}.md
apps/game/src-tauri/resources/scenes/chapters.json
apps/game/src-tauri/resources/scenes/chapter_1/{scene_a,investigation_scene_b,interrogation_scene_c,analysis_scene_d}.json
```

Write this index:

```json
{
  "chapters": [{
    "id": "chapter_1",
    "title": "Chapter One",
    "summary": "One",
    "scenes": [
      {"type":"linear","file":"chapter_1/scene_a.json"},
      {"type":"investigation","file":"chapter_1/investigation_scene_b.json"},
      {"type":"interrogation","file":"chapter_1/interrogation_scene_c.json"},
      {"type":"analysis","file":"chapter_1/analysis_scene_d.json"}
    ]
  }]
}
```

Add tests:

```rust
#[test]
fn workbench_index_preserves_manifest_order_and_source_paths() {
    let root = temp_workbench_root();
    let index = load_workbench_index_at_root(&root).unwrap();
    let scenes = &index.chapters[0].scenes;

    assert_eq!(
        scenes.iter().map(|scene| scene.id.as_str()).collect::<Vec<_>>(),
        vec!["scene_a", "investigation_scene_b", "interrogation_scene_c", "analysis_scene_d"]
    );
    assert_eq!(scenes[0].scene_type, SceneType::Linear);
    assert_eq!(scenes[0].source_path, "docs/stories_plan/chapter_1/scene_a.md");
    assert!(!scenes[0].stage_capable);
    assert!(scenes[1].stage_capable);
}

#[test]
fn manifest_scene_resolver_rejects_unknown_chapter() {
    let root = temp_workbench_root();
    let error = resolve_manifest_scene_at_root(&root, "missing", "scene_a").unwrap_err();
    assert_eq!(error.code, "chapterNotFound");
}

#[test]
fn manifest_scene_resolver_rejects_unknown_scene() {
    let root = temp_workbench_root();
    let error = resolve_manifest_scene_at_root(&root, "chapter_1", "missing").unwrap_err();
    assert_eq!(error.code, "sceneNotFound");
}
```

- [ ] **Step 2: Run focused tests and confirm red**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml workbench_index_preserves_manifest_order_and_source_paths
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml manifest_scene_resolver_rejects
```

Expected: compile failures because Workbench resolver types/functions do not exist.

- [ ] **Step 3: Implement the minimal index types**

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
struct WorkbenchIndex { chapters: Vec<WorkbenchChapterEntry> }

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

Use private deserialization structs mirroring only `chapters.json`. Resolve source by replacing the compiled relative `.json` extension with `.md` under exactly `docs/stories_plan`.

Canonicalize backend-constructed existing paths and assert they stay below the canonical workspace root before reading.

- [ ] **Step 4: Add/register `load_workbench_index`**

```rust
#[tauri::command]
fn load_workbench_index() -> Result<WorkbenchIndex, EditorError> {
    let root = workspace_root()?;
    load_workbench_index_at_root(&root)
}
```

Keep old commands temporarily registered until Task 3 atomically cuts over current frontend callers.

- [ ] **Step 5: Run all layout-editor Rust tests**

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

### Task 2: Project every current story carrier into a writer-safe Reader tree

**Files:**
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`

**Consumes:** Task 1 resolver.

**Produces:** `WorkbenchSceneBundle`, `ReaderScene`, `ReaderGroup`, `ReaderItem`, `ReaderDialogue`, and `load_scene_bundle`.

#### Fixed group IDs for testability

Use deterministic group IDs:

```text
intro
outro
sublocation:<id>
hotspot:<id>
hotspot:<id>:reexamine
topic:<characterId>:<topicId>
topic:<characterId>:<topicId>:reexamine
evidence:<id>
evidence:<id>:collect
evidence:<id>:reexamine
statement:<id>
statement:<id>:acquire
statement:<id>:reexamine
phase:<id>
phase:<id>:entry
question:<id>
line:<id>
line:<id>:press
line:<id>:correct-present
line:<id>:wrong-present
question:<id>:fallback
board:<id>
card:<id>
group:<id>
board:<id>:result
```

- [ ] **Step 1: Replace the Task 1 empty compiled files with complete minimal fixtures**

Use the current compiler JSON keys. The fixtures must include all dialogue carriers the projection promises.

Investigation fixture additions beyond Intro:

```json
{
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
    "transitionDialogue":[{"kind":"action","text":"enter cafe"}],
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
      "onReexamine":[{"kind":"line","speaker":"相馬律","text":"door again","portrait":null}],
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
        "onReexamine":[{"kind":"line","speaker":"三宅蒼太","text":"topic again","portrait":null}]
      }]
    }]
  }],
  "evidenceManifest":[{
    "id":"door_log","name":"Door Log","description":"","details":"","imageAssetId":null,"sourceSublocationId":"cafe",
    "provenance":{"sourceKind":"digital","representationLayer":"raw","proceduralStatus":"lead","completeness":"complete","confidence":"unverified","sourceGroupId":null,"sourceLabel":null,"proofCapabilities":[],"supersedesRecordId":null},
    "onCollect":[{"kind":"line","speaker":"相馬律","text":"collect door log","portrait":null}],
    "onReexamine":[{"kind":"line","speaker":"相馬律","text":"door log again","portrait":null}]
  }],
  "statementManifest":[{
    "id":"miyake_statement","speaker":"三宅蒼太","content":"statement text",
    "provenance":{"sourceKind":"testimony","representationLayer":"none","proceduralStatus":"lead","completeness":"complete","confidence":"unverified","sourceGroupId":null,"sourceLabel":null,"proofCapabilities":[],"supersedesRecordId":null},
    "onAcquire":[{"kind":"line","speaker":"相馬律","text":"acquire statement","portrait":null}],
    "onReexamine":[{"kind":"line","speaker":"相馬律","text":"statement again","portrait":null}]
  }]
}
```

Interrogation fixture must include:

- phase `entryDialogue` text `phase entry`;
- one testimony line `testimony line`;
- contradiction `evidence:cctv`;
- `challenge` text `press branch`;
- `onCorrect` text `correct present branch`;
- `onWrongEvidence` text `wrong present branch`;
- testimony `onLoop`, `loopPrompt`, `defaultChallenge`, `defaultWrong`, `wrongReply` with unique sentinel text;
- one evidence manifest with collect/re-examine dialogue;
- one statement manifest with acquire/re-examine dialogue.

Analysis fixture must contain three board kinds. At least the classify board contains:

```json
{
  "kind":"classify",
  "common":{
    "id":"classify_board",
    "label":"Classify",
    "prompt":"public classify prompt",
    "unlock":null,
    "reveals":[],
    "feedback":{
      "incomplete":"public incomplete",
      "incorrect":"public incorrect",
      "hint":"public hint",
      "incorrectSelections":[{"cards":["secret_wrong_combo"],"feedback":"selection-specific secret mapping"}]
    },
    "cards":[{
      "id":"public_card","label":"Public Card","source":{"kind":"evidence","id":"door_log"},"summary":"public card summary"
    }],
    "resultDialogue":[{"kind":"line","speaker":"相馬律","text":"public classify result","portrait":null}]
  },
  "groups":[{"id":"public_group","label":"Public Group","description":"public group description"}],
  "acceptedGroupByCard":{"public_card":"secret_group_mapping"}
}
```

Order board adds hidden sentinels `acceptedOrder:["secret_order"]`, `fixedAnchors:[{"cardId":"secret_anchor","position":1}]`; Threshold adds `minimumSelected:7`, `acceptedSelections:[["secret_selection"]]`.

- [ ] **Step 2: Add structural projection tests, not substring-only tests**

Add a test helper:

```rust
fn child<'a>(group: &'a ReaderGroup, id: &str) -> &'a ReaderGroup {
    group.children.iter().find(|candidate| candidate.id == id).unwrap()
}

fn group<'a>(scene: &'a ReaderScene, id: &str) -> &'a ReaderGroup {
    scene.groups.iter().find(|candidate| candidate.id == id).unwrap()
}
```

Pin investigation structure:

```rust
#[test]
fn investigation_reader_preserves_nested_story_carriers() {
    let root = temp_workbench_root();
    let bundle = load_scene_bundle_at_root(&root, "chapter_1", "investigation_scene_b").unwrap();
    let cafe = group(&bundle.reader, "sublocation:cafe");
    let door = child(cafe, "hotspot:door");
    let topic = child(cafe, "topic:miyake:shift");
    let evidence = group(&bundle.reader, "evidence:door_log");
    let statement = group(&bundle.reader, "statement:miyake_statement");

    assert_eq!(door.source_anchor.as_deref(), Some("door"));
    assert_eq!(child(door, "hotspot:door:reexamine").label, "On Re-examine");
    assert_eq!(child(topic, "topic:miyake:shift:reexamine").label, "On Re-examine");
    assert_eq!(child(evidence, "evidence:door_log:collect").label, "On Collect");
    assert_eq!(child(evidence, "evidence:door_log:reexamine").label, "On Re-examine");
    assert_eq!(child(statement, "statement:miyake_statement:acquire").label, "On Acquire");
    assert_eq!(child(statement, "statement:miyake_statement:reexamine").label, "On Re-examine");
}
```

Pin interrogation structure:

```rust
#[test]
fn interrogation_reader_keeps_entry_and_present_branches_separate() {
    let root = temp_workbench_root();
    let bundle = load_scene_bundle_at_root(&root, "chapter_1", "interrogation_scene_c").unwrap();
    let phase = group(&bundle.reader, "phase:ask_miyake");
    let question = child(phase, "question:q_backroom");
    let line = child(question, "line:miyake_backroom_reason");

    assert_eq!(child(phase, "phase:ask_miyake:entry").label, "Entry Dialogue");
    assert_eq!(child(line, "line:miyake_backroom_reason:press").label, "Press");
    assert_eq!(child(line, "line:miyake_backroom_reason:correct-present").label, "Correct Present");
    assert_eq!(child(line, "line:miyake_backroom_reason:wrong-present").label, "Wrong Present");
    assert_eq!(child(question, "question:q_backroom:fallback").label, "Fallback");
}
```

Pin Analysis public structure and secret absence:

```rust
#[test]
fn analysis_reader_keeps_public_story_content_without_correctness_semantics() {
    let root = temp_workbench_root();
    let bundle = load_scene_bundle_at_root(&root, "chapter_1", "analysis_scene_d").unwrap();
    let board = group(&bundle.reader, "board:classify_board");
    let card = child(board, "card:public_card");
    let classify_group = child(board, "group:public_group");
    let serialized = serde_json::to_string(&bundle.reader).unwrap();

    assert_eq!(card.source_anchor.as_deref(), Some("public_card"));
    assert!(serde_json::to_string(card).unwrap().contains("public card summary"));
    assert_eq!(classify_group.source_anchor.as_deref(), Some("public_group"));
    assert!(serialized.contains("public group description"));
    assert!(serialized.contains("public incomplete"));
    assert!(serialized.contains("public incorrect"));
    assert!(serialized.contains("public hint"));
    assert!(serialized.contains("public classify result"));

    for forbidden in [
        "acceptedGroupByCard",
        "secret_group_mapping",
        "acceptedOrder",
        "secret_order",
        "fixedAnchors",
        "secret_anchor",
        "minimumSelected",
        "acceptedSelections",
        "secret_selection",
        "secret_wrong_combo",
        "selection-specific secret mapping",
    ] {
        assert!(!serialized.contains(forbidden), "leaked {forbidden}");
    }
}
```

Also keep a linear order test that asserts the first two items are the line then action by indexing the actual `ReaderItem` variants.

- [ ] **Step 3: Add failing unsupported-kind tests**

Create three malformed fixture variants from `serde_json::Value`:

```rust
#[test]
fn reader_rejects_unknown_dialogue_kind() {
    let root = temp_workbench_root();
    overwrite_scene_queue_kind(&root, "scene_a", "video");
    let error = load_scene_bundle_at_root(&root, "chapter_1", "scene_a").unwrap_err();
    assert_eq!(error.code, "unsupportedDialogueKind");
}

#[test]
fn reader_rejects_unknown_interrogation_phase_kind() {
    let root = temp_workbench_root();
    overwrite_phase_kind(&root, "interrogation_scene_c", "testimony");
    let error = load_scene_bundle_at_root(&root, "chapter_1", "interrogation_scene_c").unwrap_err();
    assert_eq!(error.code, "unsupportedInterrogationPhaseKind");
}

#[test]
fn reader_rejects_unknown_analysis_board_kind() {
    let root = temp_workbench_root();
    overwrite_board_kind(&root, "analysis_scene_d", "chain");
    let error = load_scene_bundle_at_root(&root, "chapter_1", "analysis_scene_d").unwrap_err();
    assert_eq!(error.code, "unsupportedAnalysisBoardKind");
}
```

The overwrite helpers load JSON from the known fixture path, mutate exactly that discriminator, and write the JSON back. They are test-only helpers.

- [ ] **Step 4: Run Reader backend tests and confirm red**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml reader_
```

Expected: compile failures for missing Reader model/projection.

- [ ] **Step 5: Add the closed Reader Rust structs**

Mirror the fixed TypeScript vocabulary. Do not serialize portraits/assets/unlock expressions.

`ReaderNoticeKind` variants are `Reveal`, `Evidence`, `Statement`, `Contradiction`, `Prompt`, `Card`, `Group`, `Feedback` with camelCase serialization.

- [ ] **Step 6: Implement selective projectors with loud discriminator errors**

Add:

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

Projection rules:

- Dialogue kind must be exactly `sceneTag`, `action`, or `line`; otherwise `unsupportedDialogueKind`.
- Investigation projects Intro, Outro, sublocation transition, hotspot inspect/re-examine, topic dialogue/re-examine, evidence collect/re-examine, statement acquire/re-examine, and public reveal notices.
- Interrogation phase kind must be exactly `inquiry`; otherwise `unsupportedInterrogationPhaseKind`.
- Interrogation projects Intro/Outro, phase entry dialogue, questions/line content, line Press/Correct Present/Wrong Present, contradiction notice, testimony fallback carriers, evidence collect/re-examine, statement acquire/re-examine.
- Analysis board kind must be exactly classify/order/threshold; otherwise `unsupportedAnalysisBoardKind`.
- Analysis reads only public story-review fields: `common.id/label/prompt/cards/feedback.incomplete/feedback.incorrect/feedback.hint/resultDialogue`; classify additionally reads public `groups.id/label/description`.
- Analysis must not read/serialize `incorrectSelections`, accepted maps/order/selections, fixed anchors, minimum selection, unlock/reveals, or runtime evaluation state.
- Analysis card/group are child `ReaderGroup`s so their authored IDs can be `sourceAnchor`s.

- [ ] **Step 7: Add/register `load_scene_bundle`**

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

Assert the compiled scene's `id` and `type` match the manifest resolution. Populate `investigation_scene` only for investigation scenes.

- [ ] **Step 8: Run all backend tests**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS, including structural carrier tests, public Analysis assertions, secret sentinels, and unsupported-kind errors.

- [ ] **Step 9: Commit**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs
git commit -m "feat(editor): project writer-safe scene bundles"
```

---

### Task 3: Atomically move current Stage/index callers to domain IPC and delete generic file commands

**Files:**
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`
- Create: `apps/layout-editor/src/lib/workbench-types.ts`
- Create: `apps/layout-editor/src/lib/workbench-api.ts`
- Modify: `apps/layout-editor/src/lib/layout-store.svelte.ts`
- Modify: `apps/layout-editor/src/lib/layout-store.test.ts`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`

This task includes the minimal `App.svelte` index cutover so deleting `loadChapters` never leaves an intermediate broken commit. Task 4 performs the visual shell extraction afterward.

**Frontend API:**

```ts
loadWorkbenchIndex(): Promise<WorkbenchIndex>;
loadSceneBundle(chapterId: string, sceneId: string): Promise<WorkbenchSceneBundle>;
loadInvestigationLayout(chapterId: string, sceneId: string): Promise<InvestigationLayoutSidecar | null>;
saveInvestigationLayout(chapterId: string, sceneId: string, layout: InvestigationLayoutSidecar): Promise<void>;
```

- [ ] **Step 1: Add exact Reader/Workbench TypeScript wire types**

Create `workbench-types.ts` using the Reader vocabulary at the top of this plan. Define `WorkbenchIndex` and `WorkbenchSceneBundle`.

Do **not** import `DialogueItem` from `layout-types.ts`. Only `InvestigationSceneJson` is imported for the Stage payload.

- [ ] **Step 2: Add four thin frontend invoke wrappers**

Create `workbench-api.ts`:

```ts
export const loadWorkbenchIndex = () => invoke<WorkbenchIndex>("load_workbench_index");
export const loadSceneBundle = (chapterId: string, sceneId: string) =>
  invoke<WorkbenchSceneBundle>("load_scene_bundle", { chapterId, sceneId });
export const loadInvestigationLayout = (chapterId: string, sceneId: string) =>
  invoke<InvestigationLayoutSidecar | null>("load_investigation_layout", { chapterId, sceneId });
export const saveInvestigationLayout = (
  chapterId: string,
  sceneId: string,
  layout: InvestigationLayoutSidecar,
) => invoke<void>("save_investigation_layout", { chapterId, sceneId, layout });
```

No state/cache/path logic lives here.

- [ ] **Step 3: Write failing Stage ID-contract tests**

In `layout-store.test.ts`, pin `loadInvestigationScene("chapter_1", "investigation_scene_1")` calls `load_scene_bundle` and `load_investigation_layout` with IDs. Pin `saveLayout()` calls `save_investigation_layout` with the selected IDs/layout.

Delete/replace tests that only prove `loadChapters()` calls `read_project_file`.

Add one negative source assertion to ensure the store no longer contains `loadChapters` or `chapters:` state after the implementation step.

- [ ] **Step 4: Write failing backend layout-domain tests**

```rust
#[test]
fn investigation_layout_round_trips_for_manifest_scene() {
    let root = temp_workbench_root();
    let layout = serde_json::json!({"version":1,"sceneId":"investigation_scene_b","sublocations":{}});

    save_investigation_layout_at_root(&root, "chapter_1", "investigation_scene_b", layout.clone()).unwrap();
    assert_eq!(
        load_investigation_layout_at_root(&root, "chapter_1", "investigation_scene_b").unwrap().unwrap(),
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
    ).unwrap_err();
    assert_eq!(error.code, "sceneTypeMismatch");
}
```

Add one `resolved_layout_path_stays_under_workspace_root` test on the backend-constructed canonical path.

- [ ] **Step 5: Run focused tests and confirm red**

```bash
bun run --cwd apps/layout-editor test src/lib/layout-store.test.ts
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml investigation_layout_
```

Expected: ID/domain assertions fail because current generic commands remain.

- [ ] **Step 6: Implement investigation layout domain commands**

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

Resolve manifest scene first, require investigation, derive `.layout.json` from canonical source, validate `layout.sceneId`, pretty-serialize + trailing newline, and write with `fs::write`. Missing sidecar returns `Ok(None)`.

Register `load_investigation_layout` and `save_investigation_layout`.

- [ ] **Step 7: Refactor Stage store and remove its chapter ownership**

`editorState` becomes only:

```ts
{
  scene: InvestigationSceneJson | null;
  layout: InvestigationLayoutSidecar | null;
  chapterId: string | null;
  sceneId: string | null;
  error: string | null;
}
```

Delete:

```text
editorState.chapters
loadChapters()
loadChaptersGeneration
scenePath
layoutPath
```

`loadInvestigationScene(chapterId, sceneId)` uses `loadSceneBundle` + `loadInvestigationLayout`; null sidecar creates `{version:1, sceneId, sublocations:{}}`. Keep existing scene-load generation fence and geometry mutation functions.

- [ ] **Step 8: Move the current `App.svelte` chapter read to local WorkbenchIndex ownership**

Before Task 4 changes the layout, make the existing App green against the new API:

```ts
let workbenchIndex = $state<WorkbenchIndex | null>(null);
let indexError = $state<string | null>(null);
```

On first effect call `loadWorkbenchIndex()`. Derive the current investigation-only list from `workbenchIndex` for this intermediate green commit, and call `loadInvestigationScene(chapter.id, scene.id)` instead of passing a generated resource path.

Update `App.test.ts` to mock `loadWorkbenchIndex`, not `loadChapters`, and assert current selection uses IDs.

Task 4 will replace this temporary investigation-only rendering with the all-scene `WorkbenchSceneTree`; this step is not a compatibility API and introduces no duplicate index owner.

- [ ] **Step 9: Delete generic backend commands and path machinery**

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
dual-root source probing
```

Remove `OpenOptions`, `Write`, Unix `O_NOFOLLOW`, symlink-only imports/tests that become unreachable. `tauri::generate_handler!` now lists only the four domain commands.

- [ ] **Step 10: Run frontend/backend tests and grep old ownership**

```bash
bun run --cwd apps/layout-editor test src/lib/layout-store.test.ts src/App.test.ts
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
rg 'read_project_file|write_project_file|resolve_layout_path|loadChapters|editorState\.chapters' apps/layout-editor/src apps/layout-editor/src-tauri/src
```

Expected: tests PASS; no production matches for old commands/index ownership.

- [ ] **Step 11: Commit**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs apps/layout-editor/src/lib/workbench-types.ts apps/layout-editor/src/lib/workbench-api.ts apps/layout-editor/src/lib/layout-store.svelte.ts apps/layout-editor/src/lib/layout-store.test.ts apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "refactor(editor): cut workbench over to domain IPC"
```

---

### Task 4: Ship the branded all-scene shell, correct scene labels, and preserved Stage view

**Files:**
- Modify: `apps/layout-editor/src/lib/scene-labels.ts`
- Modify: `apps/layout-editor/src/lib/scene-labels.test.ts`
- Create: `apps/layout-editor/src/lib/WorkbenchSceneTree.svelte`
- Create: `apps/layout-editor/src/lib/WorkbenchSceneTree.test.ts`
- Create: `apps/layout-editor/src/lib/StageView.svelte`
- Create: `apps/layout-editor/src/lib/StageView.test.ts`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`
- Modify: `apps/layout-editor/src-tauri/tauri.conf.json`

No Reader mode is exposed until Task 5 makes it functional.

- [ ] **Step 1: Add the failing Analysis label regression**

In `scene-labels.test.ts`:

```ts
expect(readableSceneLabel("chapter_1/analysis_scene_8_5.json")).toBe(
  "Analysis Scene 8.5",
);
```

- [ ] **Step 2: Run the label test and confirm red**

```bash
bun run --cwd apps/layout-editor test src/lib/scene-labels.test.ts
```

Expected: current helper returns `Analysis Scene 8 5`.

- [ ] **Step 3: Extend the existing prefix regex, nothing else**

Change:

```ts
/^(?:(investigation|interrogation)_)?scene_(.+)$/
```

to:

```ts
/^(?:(investigation|interrogation|analysis)_)?scene_(.+)$/
```

Run `scene-labels.test.ts` again; expect PASS.

- [ ] **Step 4: Write failing all-scene tree tests**

Use index order:

```text
scene_0
investigation_scene_1
interrogation_scene_2
analysis_scene_8_5
```

Assert buttons appear in that DOM order, with readable labels, and clicking Analysis calls:

```ts
expect(onSelect).toHaveBeenCalledWith("chapter_1", "analysis_scene_8_5");
```

- [ ] **Step 5: Write failing StageView preservation tests**

Pin:

- investigation selection calls `loadInvestigationScene(chapterId, sceneId)`;
- loaded Stage still renders current metadata, `TargetList`, `EvidenceAssignmentPanel`, `EditorCanvas`, Save Layout;
- Save calls `saveLayout()` and shows `Layout saved`;
- non-investigation scene renders `Stage layout editing is available for investigation scenes.` and does not load/save Stage.

- [ ] **Step 6: Write the shell App test**

Assert:

- `Lyra Story Workbench` heading;
- `loadWorkbenchIndex` once;
- all-scene tree, not investigation-only filtering;
- selected IDs pass to `StageView`;
- no Assets/Plan/Review/AI mode controls.

- [ ] **Step 7: Run shell tests and confirm red**

```bash
bun run --cwd apps/layout-editor test src/App.test.ts src/lib/WorkbenchSceneTree.test.ts src/lib/StageView.test.ts
```

Expected: component/shell failures.

- [ ] **Step 8: Implement `WorkbenchSceneTree`**

Use simple chapter `<details>` sections, `readableChapterLabel` / fixed `readableSceneLabel`, type badge, and `{chapterId,sceneId}` selection. Never reconstruct repo paths.

- [ ] **Step 9: Extract existing Stage UI into `StageView`**

Move current sublocation state/effect, scene metadata, Save Layout/toast, `TargetList`, `EvidenceAssignmentPanel`, and `EditorCanvas`. Preserve geometry/state mutations.

- [ ] **Step 10: Reduce App to index + selection + Stage composition**

Select first manifest scene after index load. Render `WorkbenchSceneTree` + `StageView`. Do not add a Reader button yet.

- [ ] **Step 11: Update visible Tauri branding**

Change `productName` and window `title` to `Lyra Story Workbench`; keep identifier unchanged.

- [ ] **Step 12: Run full editor tests and commit**

```bash
bun run --cwd apps/layout-editor test
```

Expected: PASS.

```bash
git add apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts apps/layout-editor/src/lib/scene-labels.ts apps/layout-editor/src/lib/scene-labels.test.ts apps/layout-editor/src/lib/WorkbenchSceneTree.svelte apps/layout-editor/src/lib/WorkbenchSceneTree.test.ts apps/layout-editor/src/lib/StageView.svelte apps/layout-editor/src/lib/StageView.test.ts apps/layout-editor/src-tauri/tauri.conf.json
git commit -m "feat(editor): add Story Workbench shell and Stage view"
```

---

### Task 5: Add functional current-scene Reader and four local review filters

**Files:**
- Create: `apps/layout-editor/src/lib/reader-view.ts`
- Create: `apps/layout-editor/src/lib/reader-view.test.ts`
- Create: `apps/layout-editor/src/lib/ReaderView.svelte`
- Create: `apps/layout-editor/src/lib/ReaderView.test.ts`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`

**Pure interfaces:**

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

- [ ] **Step 1: Write failing pure filter/reference tests**

Use a nested Reader fixture with main lines by 相馬律/早坂茜, one action, branch line by 三宅蒼太, and source anchor `q_backroom`.

Pin:

```ts
expect(sourceReference(scene, branch)).toBe(
  "docs/stories_plan/chapter_1/interrogation_scene_4.md#q_backroom",
);
```

Pin:

- dialogue-only removes sceneTag/action, keeps lines;
- speaker filter removes other speakers' lines but retains ancestor headings;
- cues remain governed only by cue mode;
- main mode retains branch header but no branch items/children;
- expanded exposes branches;
- search is case-insensitive and retains ancestors;
- match count counts matching leaf items plus directly matching group labels once;
- speakers are first-appearance ordered/deduplicated.

- [ ] **Step 2: Run pure test and confirm red**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-view.test.ts
```

Expected: missing module/functions.

- [ ] **Step 3: Implement pure immutable transforms**

Do not mutate cached backend bundles and do not add a search index.

- [ ] **Step 4: Write failing ReaderView fixtures for all four scene types**

Writer-safe fixtures must prove rendering of:

- linear main dialogue + cue;
- investigation nested hotspot/topic/evidence/statement groups, including re-examine/acquire/collect labels;
- interrogation Entry Dialogue + Press/Correct Present/Wrong Present/Fallback;
- Analysis board with Prompt, Card, Group, Incomplete/Incorrect/Hint, Result Dialogue and no hidden correctness property names.

Assert scene type label and literal canonical source reference are visible.

- [ ] **Step 5: Write the four control interaction tests**

Using user-event:

- Dialogue only / Dialogue + cues;
- All speakers / one speaker;
- Main flow / Expanded branches;
- search input + match count.

Assert these controls invoke no Tauri/persistence call.

- [ ] **Step 6: Run Reader tests and confirm red**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-view.test.ts src/lib/ReaderView.test.ts
```

- [ ] **Step 7: Implement ReaderView with one generic tree renderer**

Use semantic `<article>` per scene and nested `<section>/<details>` per group. Render `ReaderItem` generically; do not add scene-family-specific Svelte renderers.

Display source refs literally. Copy button may call `navigator.clipboard.writeText` when available; visible text remains the fallback.

- [ ] **Step 8: Add Reader/Stage mode switch only now**

In App:

```ts
type WorkbenchMode = "reader" | "stage";
let mode = $state<WorkbenchMode>("reader");
const sceneBundles = new Map<string, WorkbenchSceneBundle>();
```

Expose exactly `Reader` and `Stage`. Preserve selected IDs between modes.

For Reader, cache by `${chapterId}:${sceneId}`, call `loadSceneBundle` only on miss, and use a generation counter so a slower old selection cannot replace the current scene.

Update App test to prove exactly two mode controls and current-scene Reader load/cache behavior.

- [ ] **Step 9: Run focused + full editor suite**

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

### Task 6: Add whole-chapter scope and close HPA-634

**Files:**
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`
- Modify: `apps/layout-editor/src/lib/ReaderView.svelte`
- Modify: `apps/layout-editor/src/lib/ReaderView.test.ts`
- Modify planning/backend files only if execution uncovers a factual defect; do not expand scope.

**Final ReaderView props:**

```ts
{
  scenes: ReaderScene[];
  scope: "scene" | "chapter";
  onScopeChange: (scope: "scene" | "chapter") => void;
  loading: boolean;
  error: string | null;
}
```

- [ ] **Step 1: Write failing whole-chapter order/cache/failure tests**

Mock a chapter in non-alphabetic manifest order. Switch Reader scope to Whole chapter and assert `loadSceneBundle` is called exactly once for each uncached manifest scene in array order.

Switch scene → chapter a second time and assert cache reuse produces no duplicate calls.

Make the third scene reject; assert error names `chapterId/sceneId` and UI does not present a truncated chapter as successful.

- [ ] **Step 2: Run App test and confirm red**

```bash
bun run --cwd apps/layout-editor test src/App.test.ts
```

- [ ] **Step 3: Implement chapter loading using the existing scene command**

For selected chapter:

1. iterate `WorkbenchIndex` scenes in manifest order;
2. reuse cache or await `loadSceneBundle`;
3. after each await, verify chapter-load generation;
4. collect ReaderScene in manifest order;
5. on failure render `Failed to load <chapterId>/<sceneId>: <message>` and keep the previous valid display until a successful request.

Do not add `load_chapter_bundle`, background prefetch, worker, or persistent cache.

- [ ] **Step 4: Add the fifth Reader control and scene boundaries**

ReaderView exposes Current scene / Whole chapter. In chapter scope, keep one collapsible `<article>` boundary per scene with its type/source label; preserve internal group hierarchy.

Add test proving passed scene order is unchanged in rendered articles.

- [ ] **Step 5: Run all editor and backend tests**

```bash
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Run authoritative compile/type/build checks**

```bash
bun run scenes:compile
bun run editor:check
bun run editor:build
bun run test:scripts
```

Expected: all PASS.

- [ ] **Step 7: Run repository lint/format/Rust gates**

```bash
bun run lint:all
```

Expected: PASS.

- [ ] **Step 8: Run scope/deletion greps**

```bash
rg 'read_project_file|write_project_file|resolve_layout_path|loadChapters|editorState\.chapters' apps/layout-editor/src apps/layout-editor/src-tauri/src
rg 'static/stories_plan' apps/layout-editor/src apps/layout-editor/src-tauri/src
rg 'acceptedGroupByCard|acceptedOrder|acceptedSelections|minimumSelected|fixedAnchors|incorrectSelections' apps/layout-editor/src
rg 'Assets|Plan|Review|AI' apps/layout-editor/src/App.svelte apps/layout-editor/src/lib/WorkbenchSceneTree.svelte
```

Expected:

- no production generic IPC/old chapter-owner matches;
- no production dual story-root match;
- no hidden Analysis correctness/config property names in frontend production Reader code;
- no future mode controls.

Rust backend tests may deliberately contain hidden-field sentinel strings.

- [ ] **Step 9: Inspect final diff**

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
git diff --check main...HEAD
```

Verify production changes are limited to `apps/layout-editor`; no `apps/game` runtime/schema changes; planning docs remain under `docs/superpowers`; whitespace check passes.

- [ ] **Step 10: Commit closeout**

```bash
git add apps/layout-editor docs/superpowers/specs/2026-08-27-hpa-634-story-workbench-reader-design.md docs/superpowers/plans/2026-08-27-hpa-634-story-workbench-reader-implementation-plan.md
git commit -m "feat(editor): complete continuous chapter Reader"
```

---

## Final Acceptance Checklist

- [ ] visible branding is Lyra Story Workbench; package path/identifier unchanged;
- [ ] only functional Reader and Stage modes exist;
- [ ] App owns the single Workbench index; old `loadChapters/editorState.chapters` are gone;
- [ ] scene tree lists every manifest scene type in deterministic order;
- [ ] `analysis_scene_8_5` renders as `Analysis Scene 8.5`;
- [ ] Reader renders all four scene types without game progression UI;
- [ ] every current investigation/interrogation dialogue carrier named in the spec has an explicit labelled Reader group;
- [ ] unknown dialogue/phase/board variants fail with typed errors;
- [ ] Analysis cards/groups/generic feedback/prompt/result are readable;
- [ ] Analysis accepted maps/order/selections, fixed anchors, thresholds, selection-specific correctness mapping do not cross Reader IPC;
- [ ] investigation/interrogation alternative branches are not flattened;
- [ ] whole-chapter mode renders only manifest scenes in order with boundaries;
- [ ] cue, speaker, branch, scope, search controls are session-memory only;
- [ ] canonical source refs are visible/copyable;
- [ ] frontend IPC uses IDs only and generic project-file commands are gone;
- [ ] `docs/stories_plan` is the sole source root;
- [ ] existing Stage geometry/evidence/layout save behavior remains green;
- [ ] no production game runtime/schema/state changes;
- [ ] `bun run scenes:compile` passes;
- [ ] `bun run --cwd apps/layout-editor test` passes;
- [ ] `cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml` passes;
- [ ] `bun run editor:check` passes;
- [ ] `bun run editor:build` passes;
- [ ] `bun run test:scripts` passes;
- [ ] `bun run lint:all` passes.
