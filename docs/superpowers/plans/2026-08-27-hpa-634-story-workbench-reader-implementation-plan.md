# HPA-634 Story Workbench Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first useful Lyra Story Workbench slice: an all-scene read-only Reader plus the existing investigation Stage workflow, using identifier-based Tauri commands, compiler-owned TypeScript scene contracts, and a narrow backend Analysis sanitization boundary.

**Architecture:** Keep authored Markdown/layout sidecars and the existing compiler authoritative. Rust owns manifest ID resolution, filesystem containment, Analysis public-wire sanitization, and layout-sidecar I/O; TypeScript owns Reader projection using the compiler's `JSON*Scene` types plus `deriveDialogueSegments()`. `App.svelte` owns one Workbench index, Reader state remains in memory, and no new compiler artifact/runtime story model/router/document registry is introduced.

**Tech Stack:** Tauri 2 / Rust, Svelte 5, TypeScript, Vitest, Bun workspace packages, existing scene compiler.

**Spec:** `docs/superpowers/specs/2026-08-27-hpa-634-story-workbench-reader-design.md`

## Global Constraints

- Keep `apps/layout-editor` package/path and Tauri identifier; visible product/window title becomes **Lyra Story Workbench**.
- Exactly two functional modes: Reader and Stage. No empty future tabs.
- `docs/stories_plan` becomes the one live authored story root in this PR.
- Frontend passes chapter/scene IDs only; it never builds arbitrary repository paths for IPC.
- No second story catalog/compiler artifact/database/router/docking/event bus/plugin model/source-map framework/project-wide search index.
- Do not move the full compiler scene schema into `@lyra/scene-types` and do not add a shared Rust scene-schema crate.
- Add only two dependency edges required by the selected design: existing workspace package `@lyra/scripts` to the editor frontend and existing repository crate dependency `serde_json = "1"` to the editor Rust crate.
- Remove `libc` when the generic `O_NOFOLLOW` write machinery becomes unreachable.
- Hidden Analysis accepted mappings, thresholds, scoring/progression semantics must not cross Reader IPC.
- Existing Stage geometry/evidence/layout semantics and generation fencing remain owned by `layout-store.svelte.ts` and current Stage components.
- One implementation PR only: continue on PR #75.

---

## File ownership map

### Existing files modified

- `packages/scripts/compile-scenes.ts` — canonical story source root.
- `CLAUDE.md` — current source-root guidance.
- active `.claude/skills/**` files that currently instruct writers to use `static/stories_plan` — current authoring guidance only.
- `apps/layout-editor/package.json` — add `@lyra/scripts` workspace dependency.
- `apps/layout-editor/src-tauri/Cargo.toml` — add `serde_json`; later remove `libc`.
- `apps/layout-editor/src-tauri/src/lib.rs` — Workbench index/resolver, narrow scene/layout commands, Analysis sanitizer, removal of generic commands.
- `apps/layout-editor/src/lib/layout-store.svelte.ts` — Stage ID-based load/save only.
- `apps/layout-editor/src/lib/layout-store.test.ts` — Stage IPC/generation tests.
- `apps/layout-editor/src/lib/layout-types.ts` — retain Stage-only investigation types; do not add Reader wire here.
- `apps/layout-editor/src/lib/scene-labels.ts` / `.test.ts` — add Analysis filename formatting.
- `apps/layout-editor/src/App.svelte` / `App.test.ts` — Workbench shell, project tree, selection, mode/scope/refresh orchestration.
- `apps/layout-editor/src-tauri/tauri.conf.json` — visible product/window title only; identifier remains unchanged.

### New files

- `apps/layout-editor/src/lib/workbench-types.ts` — frontend Workbench payload + Reader presentation types.
- `apps/layout-editor/src/lib/workbench-api.ts` — four thin Tauri invoke wrappers.
- `apps/layout-editor/src/lib/reader-projection.ts` — compiler-typed scene → Reader tree projection.
- `apps/layout-editor/src/lib/reader-projection.test.ts` — typed carrier-completeness/projection tests.
- `apps/layout-editor/src/lib/reader-view.ts` — pure cue/speaker/branch/search filtering helpers.
- `apps/layout-editor/src/lib/reader-view.test.ts` — filter/search tests.
- `apps/layout-editor/src/lib/ReaderView.svelte` — read-only grouped scene renderer.

---

### Task 1: Make the canonical root true and add the manifest-owned Workbench index

**Files:**
- Modify: `packages/scripts/compile-scenes.ts`
- Modify: `CLAUDE.md`
- Modify: active `.claude/skills/**` files returned by the source-root audit below when they describe current authoring behavior
- Modify: `apps/layout-editor/src-tauri/Cargo.toml`
- Modify/Test: `apps/layout-editor/src-tauri/src/lib.rs`

**Consumes:** Existing compiled `chapters.json` and `@lyra/scene-types` `ChaptersIndex` shape.

**Produces:**

```rust
fn load_workbench_index_at_root(root: &Path) -> Result<WorkbenchIndex, EditorError>;
fn resolve_manifest_scene_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<ResolvedScene, EditorError>;
```

and Tauri command:

```rust
#[tauri::command]
fn load_workbench_index() -> Result<WorkbenchIndex, EditorError>;
```

- [ ] **Step 1: Record the current dual-root references before editing**

Run:

```bash
rg -n "static/stories_plan|both.*stories_plan|two.*stories_plan" \
  packages/scripts/compile-scenes.ts CLAUDE.md .claude/skills apps/layout-editor/src-tauri/src/lib.rs
```

Expected baseline includes `packages/scripts/compile-scenes.ts`, `CLAUDE.md`, and current authoring instructions. Do not edit historical files under `docs/superpowers/**` merely because they describe the old architecture.

- [ ] **Step 2: Make the compiler entrypoint docs-only**

Change `packages/scripts/compile-scenes.ts` from two roots to:

```ts
const SOURCE_ROOTS = [resolve(REPO_ROOT, "docs/stories_plan")];
```

Update the adjacent comment so it states that `docs/stories_plan` is the canonical authored story root. Do not add a compatibility fallback.

- [ ] **Step 3: Update current repo/authoring guidance**

In `CLAUDE.md`:

- `bun run scenes:compile` describes only `docs/stories_plan`;
- Scene Pipeline step 1 says authored Markdown lives under `docs/stories_plan/`;
- remove wording about merging both source roots.

For active `.claude/skills/**` files found in Step 1, change current write/read instructions from `static/stories_plan/...` to `docs/stories_plan/...`. Preserve references that are explicitly historical examples rather than current ownership instructions.

- [ ] **Step 4: Add the explicit JSON dependency**

Change `apps/layout-editor/src-tauri/Cargo.toml` dependencies to include:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Keep `libc` for now because old generic write commands still compile until Task 4.

- [ ] **Step 5: Write failing Workbench index/resolver tests**

In `apps/layout-editor/src-tauri/src/lib.rs`, add test helpers that create a temporary root containing:

```text
apps/game/src-tauri/resources/scenes/chapters.json
docs/stories_plan/chapter_1/scene_a.md
docs/stories_plan/chapter_1/investigation_scene_b.md
docs/stories_plan/chapter_1/interrogation_scene_c.md
docs/stories_plan/chapter_1/analysis_scene_d.md
```

Use this exact chapters fixture:

```json
{
  "chapters": [
    {
      "id": "chapter_1",
      "title": "Chapter One",
      "summary": "Fixture chapter",
      "scenes": [
        {"type":"linear","file":"chapter_1/scene_a.json"},
        {"type":"investigation","file":"chapter_1/investigation_scene_b.json"},
        {"type":"interrogation","file":"chapter_1/interrogation_scene_c.json"},
        {"type":"analysis","file":"chapter_1/analysis_scene_d.json"}
      ]
    }
  ]
}
```

Add:

```rust
#[test]
fn workbench_index_preserves_manifest_order_and_docs_source_paths() {
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
fn manifest_scene_resolver_rejects_unknown_chapter_and_scene() {
    let root = temp_workbench_root();
    assert_eq!(
        resolve_manifest_scene_at_root(&root, "missing", "scene_a")
            .unwrap_err()
            .code,
        "chapterNotFound"
    );
    assert_eq!(
        resolve_manifest_scene_at_root(&root, "chapter_1", "missing")
            .unwrap_err()
            .code,
        "sceneNotFound"
    );
}

#[test]
fn workbench_index_fails_when_canonical_source_is_missing() {
    let root = temp_workbench_root();
    std::fs::remove_file(root.join("docs/stories_plan/chapter_1/scene_a.md")).unwrap();
    assert_eq!(load_workbench_index_at_root(&root).unwrap_err().code, "sourceNotFound");
}
```

- [ ] **Step 6: Run the focused Rust tests and confirm red**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml workbench_index_
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml manifest_scene_resolver_
```

Expected: compile failures because the Workbench index/resolver does not exist.

- [ ] **Step 7: Implement minimal index/resolver types**

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
    chapter_id: String,
    scene_id: String,
    scene_type: SceneType,
    compiled_path: PathBuf,
    source_path: PathBuf,
}
```

Use private `Deserialize` structs for only the fields in `chapters.json` that this command consumes. Derive scene ID from the manifest filename stem; do not scan authored directories.

Construct the source path by replacing `.json` with `.md` under `docs/stories_plan`. Canonicalize existing backend-constructed paths and assert they remain under the canonical workspace/story roots before reading.

- [ ] **Step 8: Register only the new index command**

Add `load_workbench_index` to `tauri::generate_handler!` while leaving all old commands registered. Intermediate commits remain green until Task 4 cuts every caller over.

- [ ] **Step 9: Verify compiler + Rust task**

```bash
bun run scenes:compile
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
rg -n "static/stories_plan|both.*stories_plan|two.*stories_plan" \
  packages/scripts/compile-scenes.ts CLAUDE.md .claude/skills
```

Expected:

- compile passes;
- Rust tests pass;
- no active current-authoring guidance claims two live story roots.

- [ ] **Step 10: Commit**

```bash
git add packages/scripts/compile-scenes.ts CLAUDE.md .claude/skills \
  apps/layout-editor/src-tauri/Cargo.toml apps/layout-editor/src-tauri/src/lib.rs
git commit -m "feat(editor): add canonical workbench index"
```

---

### Task 2: Add narrow ID-based scene/layout commands and sanitize Analysis at the wire

**Files:**
- Modify/Test: `apps/layout-editor/src-tauri/src/lib.rs`

**Consumes:** `resolve_manifest_scene_at_root` from Task 1.

**Produces:**

```rust
fn load_scene_bundle_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<serde_json::Value, EditorError>;

fn load_investigation_layout_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<Option<InvestigationLayoutSidecar>, EditorError>;

fn save_investigation_layout_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
    layout: &InvestigationLayoutSidecar,
) -> Result<(), EditorError>;
```

Tauri commands:

```text
load_scene_bundle(chapterId, sceneId)
load_investigation_layout(chapterId, sceneId)
save_investigation_layout(chapterId, sceneId, layout)
```

Old generic commands remain registered until Task 4.

- [ ] **Step 1: Extend the temporary fixture with compiled scenes and a layout sidecar**

Create minimal valid compiled JSON files matching each manifest entry. The Analysis fixture must contain both public and forbidden sentinel data:

```json
{
  "type":"analysis",
  "id":"analysis_scene_d",
  "title":"Analysis",
  "summary":"Fixture",
  "assetRefs":[],
  "intro":[{"kind":"line","speaker":"相馬律","text":"analysis intro","portrait":null}],
  "boards":[
    {
      "kind":"classify",
      "common":{
        "id":"board_a",
        "label":"Board A",
        "prompt":"public prompt",
        "unlock":{"fact":"secret_progression"},
        "reveals":[{"kind":"fact","id":"secret_reveal"}],
        "feedback":{
          "incomplete":"public incomplete",
          "incorrect":"public incorrect",
          "hint":"public hint",
          "incorrectSelections":[{"cards":["secret_wrong_combo"],"feedback":"secret mapped feedback"}]
        },
        "cards":[{"id":"card_a","label":"Card A","source":{"kind":"evidence","id":"evidence_a"},"summary":"public card summary"}],
        "resultDialogue":[{"kind":"line","speaker":"相馬律","text":"public result","portrait":null}]
      },
      "groups":[{"id":"group_a","label":"Group A","description":"public group description"}],
      "acceptedGroupByCard":{"card_a":"secret_group"}
    },
    {
      "kind":"order",
      "common":{
        "id":"board_b","label":"Board B","prompt":"order prompt","unlock":null,"reveals":[],
        "feedback":{"incomplete":"i","incorrect":"x","hint":null,"incorrectSelections":[]},
        "cards":[],"resultDialogue":[]
      },
      "acceptedOrder":["secret_order"],
      "fixedAnchors":[{"cardId":"secret_anchor","position":1}]
    },
    {
      "kind":"threshold",
      "common":{
        "id":"board_c","label":"Board C","prompt":"threshold prompt","unlock":null,"reveals":[],
        "feedback":{"incomplete":"i","incorrect":"x","hint":null,"incorrectSelections":[]},
        "cards":[],"resultDialogue":[]
      },
      "minimumSelected":7,
      "acceptedSelections":[["secret_selection"]]
    }
  ],
  "outro":[{"kind":"line","speaker":"相馬律","text":"analysis outro","portrait":null}]
}
```

- [ ] **Step 2: Write failing scene-bundle boundary tests**

```rust
#[test]
fn non_analysis_bundle_preserves_compiler_payload() {
    let root = temp_workbench_root();
    let value = load_scene_bundle_at_root(&root, "chapter_1", "investigation_scene_b").unwrap();
    assert_eq!(value["type"], "investigation");
    assert_eq!(value["id"], "investigation_scene_b");
}

#[test]
fn analysis_bundle_keeps_public_story_content_and_strips_hidden_semantics() {
    let root = temp_workbench_root();
    let value = load_scene_bundle_at_root(&root, "chapter_1", "analysis_scene_d").unwrap();
    let serialized = serde_json::to_string(&value).unwrap();

    for required in [
        "public prompt",
        "public incomplete",
        "public incorrect",
        "public hint",
        "public card summary",
        "public group description",
        "public result",
    ] {
        assert!(serialized.contains(required), "missing {required}");
    }

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
        "incorrectSelections",
        "secret_wrong_combo",
        "secret mapped feedback",
        "secret_progression",
        "secret_reveal",
    ] {
        assert!(!serialized.contains(forbidden), "leaked {forbidden}");
    }
}

#[test]
fn scene_bundle_rejects_compiled_id_or_type_mismatch() {
    let root = temp_workbench_root();
    overwrite_compiled_scene_field(&root, "scene_a", "id", "wrong_id");
    assert_eq!(
        load_scene_bundle_at_root(&root, "chapter_1", "scene_a").unwrap_err().code,
        "sceneManifestMismatch"
    );
}
```

- [ ] **Step 3: Write failing layout-domain tests**

```rust
#[test]
fn investigation_layout_round_trips_by_ids() {
    let root = temp_workbench_root();
    let layout = fixture_layout();
    save_investigation_layout_at_root(
        &root,
        "chapter_1",
        "investigation_scene_b",
        &layout,
    )
    .unwrap();

    assert_eq!(
        load_investigation_layout_at_root(
            &root,
            "chapter_1",
            "investigation_scene_b"
        )
        .unwrap(),
        Some(layout)
    );
}

#[test]
fn layout_commands_reject_non_investigation_scene() {
    let root = temp_workbench_root();
    assert_eq!(
        load_investigation_layout_at_root(&root, "chapter_1", "scene_a")
            .unwrap_err()
            .code,
        "stageUnsupportedSceneType"
    );
}
```

- [ ] **Step 4: Run focused tests and confirm red**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml analysis_bundle_
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml scene_bundle_
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml investigation_layout_
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml layout_commands_
```

Expected: compile failures for missing functions/commands.

- [ ] **Step 5: Implement raw non-Analysis load plus a small Analysis whitelist**

`load_scene_bundle_at_root` must:

1. resolve the manifest scene by IDs;
2. read/parse the compiled JSON as `serde_json::Value`;
3. assert compiled `id` and `type` match the manifest resolution;
4. return the value unchanged for linear/investigation/interrogation;
5. for Analysis, call `public_analysis_value(&value)` and return only the ticket-approved public shape.

Keep `public_analysis_value` local to `lib.rs`. It may use small `object_field` / `array_field` helpers, but it must whitelist the public Analysis keys rather than recursively deleting a blacklist.

The whitelist output contains only:

```text
type, id, title, summary, intro, boards, outro
board.kind
board.common.id/label/prompt/cards/feedback/resultDialogue
board.groups for classify only
feedback.incomplete/incorrect/hint
card.id/label/source/summary
group.id/label/description
```

Reject an unknown Analysis board kind with `EditorError { code: "unsupportedAnalysisBoardKind", ... }`.

- [ ] **Step 6: Implement ID-based layout resolution**

Resolve the layout sidecar only after verifying `ResolvedScene.scene_type == SceneType::Investigation`. Build the sidecar path from the resolved canonical authored `.md` path using the existing sidecar naming convention. Keep one containment assertion and ordinary I/O diagnostics; do not call the old caller-path validation helpers.

- [ ] **Step 7: Register the three commands but keep old commands temporarily**

`tauri::generate_handler!` now contains the four new Workbench commands **and** the old generic commands. This is intentionally temporary and green.

- [ ] **Step 8: Verify all editor Rust tests**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS, including the Analysis wire sentinel and layout round-trip.

- [ ] **Step 9: Commit**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs
git commit -m "feat(editor): add workbench domain commands"
```

---

### Task 3: Build the Reader projection in compiler-typed TypeScript

**Files:**
- Modify: `apps/layout-editor/package.json`
- Create: `apps/layout-editor/src/lib/workbench-types.ts`
- Create: `apps/layout-editor/src/lib/reader-projection.ts`
- Create/Test: `apps/layout-editor/src/lib/reader-projection.test.ts`

**Consumes:** Compiler contracts from `@lyra/scripts/compile-scenes/types` and `deriveDialogueSegments()` from `@lyra/scripts/compile-scenes/dialogue-segment-origins`.

**Produces:**

```ts
export function projectReaderScene(
  chapterId: string,
  sourcePath: string,
  scene: WorkbenchScenePayload,
): ReaderScene;
```

- [ ] **Step 1: Add the workspace dependency**

In `apps/layout-editor/package.json` dependencies add:

```json
"@lyra/scripts": "workspace:*"
```

Do not add a second copy of compiler scene types to `@lyra/scene-types`.

- [ ] **Step 2: Add exact Workbench/Reader frontend types**

Create `workbench-types.ts`:

```ts
import type {
  JSONAnalysisScene,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
} from "@lyra/scripts/compile-scenes/types";

export type SceneType =
  | "linear"
  | "investigation"
  | "interrogation"
  | "analysis";

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

type AnalysisBoard = JSONAnalysisScene["boards"][number];
type AnalysisCommon = AnalysisBoard["common"];
type PublicAnalysisCommon = Pick<
  AnalysisCommon,
  "id" | "label" | "prompt" | "cards" | "resultDialogue"
> & {
  feedback: Pick<AnalysisCommon["feedback"], "incomplete" | "incorrect" | "hint">;
};

type PublicClassifyBoard = {
  kind: "classify";
  common: PublicAnalysisCommon;
  groups: Extract<AnalysisBoard, { kind: "classify" }>["groups"];
};

type PublicOrderBoard = {
  kind: "order";
  common: PublicAnalysisCommon;
};

type PublicThresholdBoard = {
  kind: "threshold";
  common: PublicAnalysisCommon;
};

export type PublicAnalysisScene = Pick<
  JSONAnalysisScene,
  "type" | "id" | "title" | "summary" | "intro" | "outro"
> & {
  boards: Array<PublicClassifyBoard | PublicOrderBoard | PublicThresholdBoard>;
};

export type WorkbenchScenePayload =
  | JSONLinearScene
  | JSONInvestigationScene
  | JSONInterrogationScene
  | PublicAnalysisScene;

export type WorkbenchSceneBundle = { scene: WorkbenchScenePayload };

export type ReaderGroupKind =
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

export type ReaderFlow = "main" | "branch";

export type ReaderItem =
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

export type ReaderGroup = {
  id: string;
  kind: ReaderGroupKind;
  label: string;
  flow: ReaderFlow;
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

export type CompilerDialogueItem = JSONDialogueItem;
```

- [ ] **Step 3: Write typed fixtures before the projector**

In `reader-projection.test.ts`, import the compiler types and define fixtures with `satisfies` rather than casts.

Linear fixture:

```ts
const linearScene = {
  type: "linear",
  id: "scene_a",
  title: "Linear",
  summary: "Fixture",
  queue: [
    { kind: "line", speaker: "相馬律", text: "first", portrait: null },
    { kind: "action", text: "second" },
  ],
  assetRefs: [],
} satisfies JSONLinearScene;
```

Investigation fixture must contain one sublocation, one hotspot with inspect/re-examine, one character/topic with dialogue/re-examine, one evidence with onCollect/onReexamine, one statement with onAcquire/onReexamine, Intro/transition/Outro, and otherwise use valid empty/default fields from the compiler type. Every dialogue array uses a unique sentinel string matching its carrier ID.

Interrogation fixture must contain one inquiry phase, phase entry, one question/testimony line, `onLoop`, `loopPrompt`, `defaultChallenge`, `defaultWrong`, `wrongReply`, line `content`, `challenge`, `onCorrect`, `onWrongEvidence`, plus evidence/statement acquisition/re-examine carriers. Again every carrier gets a unique sentinel.

Public Analysis fixture is typed as `PublicAnalysisScene` and contains:

- Intro/Outro;
- classify board with one public card, one group, incomplete/incorrect/hint text and result dialogue;
- empty order/threshold public boards to exercise exhaustive kind handling.

Because all non-Analysis fixtures use `satisfies JSON*Scene`, compiler field drift must fail TypeScript before projection tests execute.

- [ ] **Step 4: Write failing projection/carrier tests**

Add:

```ts
it("preserves linear item order", () => {
  const reader = projectReaderScene(
    "chapter_1",
    "docs/stories_plan/chapter_1/scene_a.md",
    linearScene,
  );
  expect(reader.groups[0].items).toEqual([
    { kind: "line", speaker: "相馬律", text: "first" },
    { kind: "action", text: "second" },
  ]);
});
```

For investigation/interrogation, derive expected compiler segments:

```ts
const expected = deriveDialogueSegments({
  chapterId: "chapter_1",
  json: investigationScene,
}).map((segment) => readerSegmentId(segment.origin));

const reader = projectReaderScene(
  "chapter_1",
  "docs/stories_plan/chapter_1/investigation_scene_b.md",
  investigationScene,
);

expect(collectDialogueCarrierIds(reader)).toEqual(new Set(expected));
```

Also pin representative nesting:

```ts
expect(findGroup(reader, "hotspot:door:inspect")?.label).toBe("Inspect");
expect(findGroup(reader, "hotspot:door:reexamine")?.label).toBe("On Re-examine");
expect(findGroup(reader, "evidence:door_log:onCollect")?.label).toBe("On Collect");
expect(findGroup(reader, "statement:witness:onAcquire")?.label).toBe("On Acquire");
```

Interrogation labels must map existing compiler IDs without renaming IDs:

```ts
expect(findGroup(reader, "question:q1:line:l1:challenge")?.label).toBe("Press");
expect(findGroup(reader, "question:q1:line:l1:onCorrect")?.label).toBe("Correct Present");
expect(findGroup(reader, "question:q1:line:l1:onWrongEvidence")?.label).toBe("Wrong Present");
```

Analysis public-content test:

```ts
expect(collectReaderText(reader)).toContain("public card summary");
expect(collectReaderText(reader)).toContain("public group description");
expect(collectReaderText(reader)).toContain("public incomplete");
expect(collectReaderText(reader)).toContain("public incorrect");
expect(collectReaderText(reader)).toContain("public hint");
expect(collectReaderText(reader)).toContain("public result");
```

- [ ] **Step 5: Run the projection tests and confirm red**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-projection.test.ts
```

Expected: FAIL because projection functions do not exist.

- [ ] **Step 6: Implement exhaustive dialogue conversion**

In `reader-projection.ts`:

```ts
function projectDialogue(item: JSONDialogueItem): ReaderItem {
  switch (item.kind) {
    case "sceneTag":
      return { kind: "sceneTag", text: item.text };
    case "action":
      return { kind: "action", text: item.text };
    case "line":
      return { kind: "line", speaker: item.speaker, text: item.text };
    default:
      return assertNever(item);
  }
}
```

`assertNever` throws `ReaderProjectionError` at runtime for stale malformed data while preserving compile-time exhaustiveness.

- [ ] **Step 7: Reuse `deriveDialogueSegments()` through a consumable segment pool**

For full compiler scenes (linear/investigation/interrogation), call `deriveDialogueSegments({ chapterId, json: scene })` once.

Normalize existing origin variants with an exhaustive `readerSegmentId(origin)`:

```text
linearScene -> main
investigationIntro -> intro
investigationOutro -> outro
investigationInteraction -> origin.segmentId
interrogationIntro -> intro
interrogationOutro -> outro
interrogationPhase -> origin.segmentId
analysisIntro / analysisResult / analysisOutro are not used because Analysis payload is sanitized
```

Create a `SegmentPool` whose `take(id)` removes and returns one segment and whose `assertFullyConsumed()` throws `unconsumedCompilerDialogueSegment` if any non-empty segment remains.

Reader dialogue child-group IDs are the compiler segment IDs returned by `readerSegmentId`; human labels may differ.

- [ ] **Step 8: Implement scene-specific structural projection**

Use the typed scene union:

```ts
export function projectReaderScene(
  chapterId: string,
  sourcePath: string,
  scene: WorkbenchScenePayload,
): ReaderScene {
  switch (scene.type) {
    case "linear":
      return projectLinear(chapterId, sourcePath, scene);
    case "investigation":
      return projectInvestigation(chapterId, sourcePath, scene);
    case "interrogation":
      return projectInterrogation(chapterId, sourcePath, scene);
    case "analysis":
      return projectPublicAnalysis(sourcePath, scene);
    default:
      return assertNever(scene);
  }
}
```

Rules are exactly those in the design spec. Structural containers use closed `ReaderGroupKind`; dialogue carriers consume the compiler segment pool; Analysis never calls `deriveDialogueSegments()` because its frontend payload is intentionally not full compiler JSON.

- [ ] **Step 9: Run projection tests and editor type-check**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-projection.test.ts
bun run editor:check
```

Expected: PASS. A missing compiler carrier must fail either the TypeScript build or `SegmentPool.assertFullyConsumed()` test.

- [ ] **Step 10: Commit**

```bash
git add apps/layout-editor/package.json bun.lock \
  apps/layout-editor/src/lib/workbench-types.ts \
  apps/layout-editor/src/lib/reader-projection.ts \
  apps/layout-editor/src/lib/reader-projection.test.ts
git commit -m "feat(editor): add typed story reader projection"
```

---

### Task 4: Cut the frontend to domain IPC, ship the all-scene shell, then delete generic path commands

**Files:**
- Create: `apps/layout-editor/src/lib/workbench-api.ts`
- Modify/Test: `apps/layout-editor/src/lib/layout-store.svelte.ts`
- Modify/Test: `apps/layout-editor/src/lib/layout-store.test.ts`
- Modify/Test: `apps/layout-editor/src/lib/scene-labels.ts`
- Modify/Test: `apps/layout-editor/src/lib/scene-labels.test.ts`
- Modify/Test: `apps/layout-editor/src/App.svelte`
- Modify/Test: `apps/layout-editor/src/App.test.ts`
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`
- Modify: `apps/layout-editor/src-tauri/Cargo.toml`
- Modify: `apps/layout-editor/src-tauri/tauri.conf.json`

**Consumes:** Four backend commands + Workbench types from Tasks 1–3.

**Produces:** One branded all-scene Workbench shell with Stage preserved; no generic project-file commands remain.

- [ ] **Step 1: Add four thin invoke wrappers**

Create `workbench-api.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { InvestigationLayoutSidecar } from "@lyra/scene-types";
import type { WorkbenchIndex, WorkbenchSceneBundle } from "./workbench-types";

export const loadWorkbenchIndex = () =>
  invoke<WorkbenchIndex>("load_workbench_index");

export const loadSceneBundle = (chapterId: string, sceneId: string) =>
  invoke<WorkbenchSceneBundle>("load_scene_bundle", { chapterId, sceneId });

export const loadInvestigationLayout = (chapterId: string, sceneId: string) =>
  invoke<InvestigationLayoutSidecar | null>("load_investigation_layout", {
    chapterId,
    sceneId,
  });

export const saveInvestigationLayout = (
  chapterId: string,
  sceneId: string,
  layout: InvestigationLayoutSidecar,
) => invoke<void>("save_investigation_layout", { chapterId, sceneId, layout });
```

No cache/path/state logic belongs here.

- [ ] **Step 2: Write failing Stage ID-contract tests**

Update `layout-store.test.ts` so selecting an investigation scene by IDs expects:

```ts
expect(invoke).toHaveBeenCalledWith("load_scene_bundle", {
  chapterId: "chapter_1",
  sceneId: "investigation_scene_3",
});
expect(invoke).toHaveBeenCalledWith("load_investigation_layout", {
  chapterId: "chapter_1",
  sceneId: "investigation_scene_3",
});
```

Save expects:

```ts
expect(invoke).toHaveBeenCalledWith(
  "save_investigation_layout",
  expect.objectContaining({
    chapterId: "chapter_1",
    sceneId: "investigation_scene_3",
    layout: expect.any(Object),
  }),
);
```

Retain existing stale-generation tests and adapt only their call shape.

- [ ] **Step 3: Refactor Stage store without adding Workbench index ownership**

Change the Stage store entrypoint to:

```ts
loadInvestigationScene(chapterId: string, sceneId: string): Promise<void>
```

It loads `loadSceneBundle` and `loadInvestigationLayout`, rejects a non-investigation bundle, and keeps existing layout mutations/save semantics.

Delete from the store:

- `loadChapters()`;
- `editorState.chapters`;
- chapter-load generation fields that only existed for `loadChapters`.

`App.svelte`, not Stage store, becomes the single index owner in the next step of this same task.

- [ ] **Step 4: Write failing shell/index tests**

In `App.test.ts`, mock `load_workbench_index` with one scene of each type. Assert all four are rendered in exact order and that selecting a non-investigation scene does not call `load_investigation_layout` while Stage is active.

Pin visible copy:

```text
Lyra Story Workbench
Reader
Stage
```

Do not render Assets/Plan/Review controls.

- [ ] **Step 5: Fix all-four scene labels**

Change the regex in `scene-labels.ts` to:

```ts
/^(?:(investigation|interrogation|analysis)_)?scene_(.+)$/
```

Add:

```ts
expect(readableSceneLabel("chapter_1/analysis_scene_8_5.json")).toBe(
  "Analysis Scene 8.5",
);
```

- [ ] **Step 6: Build the all-scene shell directly, with no throwaway investigation filter**

`App.svelte` loads `loadWorkbenchIndex()` directly and owns:

```ts
let workbenchIndex: WorkbenchIndex | null;
let selectedChapterId: string | null;
let selectedSceneId: string | null;
let mode: "reader" | "stage";
```

The project tree lists every manifest scene in order. Stage invokes `loadInvestigationScene` only when the selected scene is `stageCapable`; otherwise show a concise truthful message such as `Stage is available for investigation scenes.`

Reader mode may show a short loading/not-yet-rendered state **inside this task only** while Task 5 wires the functional Reader. Do not expose disabled future modes.

- [ ] **Step 7: Update visible Tauri branding without renaming package/identifier**

In `apps/layout-editor/src-tauri/tauri.conf.json` change `productName` and window title to `Lyra Story Workbench`. Keep the existing identifier unchanged.

- [ ] **Step 8: Run frontend tests before deleting old backend commands**

```bash
bun run --cwd apps/layout-editor test
bun run editor:check
```

Expected: PASS with all frontend callers using only the four domain commands.

- [ ] **Step 9: Delete now-unreachable generic IPC and its dependency**

From `apps/layout-editor/src-tauri/src/lib.rs`, remove:

```text
read_project_file
write_project_file
resolve_layout_path
checked_existing_project_path
checked_project_path_from_root
ensure_layout_sidecar_write_path
ensure_path_stays_in_root
ensure_parent_dirs
reject_symlink
write_regular_file
O_NOFOLLOW-specific helpers
static/stories_plan probe/ambiguity helpers
```

Remove the old commands from `tauri::generate_handler!`.

From `apps/layout-editor/src-tauri/Cargo.toml`, remove:

```toml
libc = "0.2"
```

Keep only the straightforward containment check used by backend-constructed canonical paths.

- [ ] **Step 10: Run Rust + frontend regression checks**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run --cwd apps/layout-editor test
bun run editor:check
rg -n 'read_project_file|write_project_file|resolve_layout_path' apps/layout-editor
```

Expected: all tests pass and grep returns no live caller/command.

- [ ] **Step 11: Commit**

```bash
git add apps/layout-editor/src-tauri apps/layout-editor/src
git commit -m "feat(editor): cut workbench shell to domain IPC"
```

---

### Task 5: Ship the functional current-scene Reader, filters, source references, and Refresh

**Files:**
- Create/Test: `apps/layout-editor/src/lib/reader-view.ts`
- Create/Test: `apps/layout-editor/src/lib/reader-view.test.ts`
- Create: `apps/layout-editor/src/lib/ReaderView.svelte`
- Modify/Test: `apps/layout-editor/src/App.svelte`
- Modify/Test: `apps/layout-editor/src/App.test.ts`

**Consumes:** `projectReaderScene`, `loadSceneBundle`, selected Workbench source path.

**Produces:** Functional Reader mode for one selected scene plus five ticket filters and one refresh affordance.

- [ ] **Step 1: Write failing pure filter tests**

Define:

```ts
export type ReaderFilter = {
  showCues: boolean;
  speaker: string | null;
  showBranches: boolean;
  search: string;
};

export function filterReaderScene(
  scene: ReaderScene,
  filter: ReaderFilter,
): ReaderScene;
```

Tests must prove:

- `showCues: false` removes `sceneTag` and `action` items but leaves dialogue/notices;
- speaker filter removes nonmatching `line` items while retaining structural groups needed to understand matching content;
- `showBranches: false` removes groups whose `flow === "branch"`;
- search is case-insensitive and retains ancestors of matching descendants;
- empty groups after filtering are omitted unless they are the scene's only structural boundary.

- [ ] **Step 2: Implement `filterReaderScene` as one pure tree walk**

Do not spread filtering logic across scene-specific renderers. Normalize search with `trim().toLocaleLowerCase()` and recursively keep a group when its own label/items match or any child remains.

- [ ] **Step 3: Write failing current-scene Reader UI tests**

Mock `load_scene_bundle` and assert that selecting each current type renders known fixture text through Reader mode.

For interrogation, assert visible separate labels:

```text
Press
Correct Present
Wrong Present
Fallback
```

For Analysis, assert public card/group/feedback/result content appears and no hidden answer field is part of the frontend fixture type.

- [ ] **Step 4: Implement `ReaderView.svelte`**

Responsibilities:

- render scene boundary/type/title;
- recursively render `ReaderGroup` labels;
- render line as `speaker: text`;
- render action/sceneTag/notice with small cue labels;
- collapse/expand branch/group content locally;
- show copyable source reference for scene and meaningful groups.

Do not add scene-type-specific projection logic to the Svelte component.

- [ ] **Step 5: Wire current-scene bundle loading in `App.svelte`**

Maintain:

```ts
let currentBundle: WorkbenchSceneBundle | null;
let currentReaderScene: ReaderScene | null;
let readerLoadGeneration = 0;
const bundleCache = new Map<string, WorkbenchSceneBundle>();
```

On selection in Reader mode:

1. increment generation;
2. use cached bundle or `loadSceneBundle(chapterId, sceneId)`;
3. ignore stale responses;
4. call `projectReaderScene(chapterId, sourcePath, bundle.scene)`;
5. render the filtered result.

- [ ] **Step 6: Add the five Reader controls**

Keep state in `App.svelte` only:

```ts
let showCues = true;
let speaker: string | null = null;
let showBranches = false;
let readerScope: "scene" | "chapter" = "scene";
let search = "";
```

Task 5 implements scene scope; chapter scope UI may be selectable only once Task 6 completes in the immediately following green commit. If exposed here, keep it wired to the current scene until Task 6 only if tests mark it non-final; preferred approach is to add the scope control in Task 6 so no misleading intermediate UI ships.

- [ ] **Step 7: Add Refresh as a data-load affordance**

Implement:

```ts
async function refreshReader(): Promise<void> {
  if (!selectedChapterId || !selectedSceneId) return;
  bundleCache.delete(`${selectedChapterId}:${selectedSceneId}`);
  await loadCurrentReaderScene({ force: true });
}
```

Refresh must increment the same generation token used by selection so an older load cannot win.

No watcher, mtime display, preference persistence, or background polling is added.

- [ ] **Step 8: Pin Refresh and stale-response tests**

In `App.test.ts`:

- first scene load returns `old text`;
- Refresh triggers a second `load_scene_bundle` and renders `new text`;
- resolve the old request after the new one and assert it does not replace the refreshed view.

- [ ] **Step 9: Verify Task 5**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-view.test.ts
bun run --cwd apps/layout-editor test src/App.test.ts
bun run editor:check
```

Expected: PASS; Reader current-scene mode is now functional, so the Reader/Stage switch is truthful.

- [ ] **Step 10: Commit**

```bash
git add apps/layout-editor/src/lib/reader-view.ts \
  apps/layout-editor/src/lib/reader-view.test.ts \
  apps/layout-editor/src/lib/ReaderView.svelte \
  apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(editor): ship current-scene story reader"
```

---

### Task 6: Add whole-chapter Reader scope and close against real Chapter 1 content

**Files:**
- Modify/Test: `apps/layout-editor/src/App.svelte`
- Modify/Test: `apps/layout-editor/src/App.test.ts`
- Modify/Test only if required by failures: files already owned by Tasks 1–5
- Update: PR #75 description with verification evidence

**Consumes:** manifest-ordered Workbench index, per-scene `loadSceneBundle`, cache/Refresh, `projectReaderScene`.

**Produces:** Whole-chapter continuous reading and final HPA-634 verification.

- [ ] **Step 1: Write failing deterministic chapter-load test**

Mock a chapter with four scenes in this order:

```text
scene_a
investigation_scene_b
interrogation_scene_c
analysis_scene_d
```

Switch scope to chapter and assert:

- exactly those four scene IDs are requested;
- unlisted fixture files are never requested;
- rendered scene boundaries remain in manifest order even if promises resolve out of order.

- [ ] **Step 2: Implement chapter loading through the existing command**

Add:

```ts
async function loadChapterReader(chapterId: string, force = false): Promise<void>
```

Use the selected chapter's manifest scene array as the only source of IDs. `Promise.all` is allowed because it preserves input result order; no fifth bulk Tauri command is added.

For every scene:

1. resolve its cache key;
2. load or reuse the bundle;
3. call `projectReaderScene(chapterId, scene.sourcePath, bundle.scene)`;
4. preserve manifest order in the final `ReaderScene[]`.

Use a chapter-generation token to ignore stale chapter loads after scope/chapter/refresh changes.

- [ ] **Step 3: Wire the current-scene / whole-chapter scope control**

Add the ticket's fifth filter/control now:

```text
Current scene | Whole chapter
```

Whole chapter renders a `ReaderView` per projected scene with visible scene type/title boundaries. Scene/group collapse state remains local; do not persist it.

- [ ] **Step 4: Extend Refresh to current scope**

For scene scope, delete/reload only the selected scene key.

For chapter scope:

```ts
for (const scene of selectedChapter.scenes) {
  bundleCache.delete(`${selectedChapter.id}:${scene.id}`);
}
await loadChapterReader(selectedChapter.id, true);
```

Test that chapter Refresh reissues every manifest scene load and no unlisted draft load.

- [ ] **Step 5: Run focused editor tests**

```bash
bun run --cwd apps/layout-editor test
```

Expected: PASS for Stage, all four Reader types, filters, refresh, source references, deterministic whole chapter, and stale-load fencing.

- [ ] **Step 6: Run the required compile/build/static checks**

Run in this order:

```bash
bun run scenes:compile
bun run editor:check
bun run editor:build
bun run --cwd apps/layout-editor test
bun run test:scripts
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run lint:all
```

All commands must pass before claiming implementation complete.

- [ ] **Step 7: Verify dependency/path cleanup**

Run:

```bash
rg -n 'read_project_file|write_project_file|resolve_layout_path' apps/layout-editor
rg -n 'libc' apps/layout-editor/src-tauri/Cargo.toml apps/layout-editor/src-tauri/src
rg -n 'static/stories_plan|both.*stories_plan|two.*stories_plan' \
  packages/scripts/compile-scenes.ts CLAUDE.md .claude/skills
```

Expected:

- first grep: no generic IPC implementation/caller;
- second grep: no editor `libc` dependency/use;
- third grep: no active current-source dual-root instruction. Historical plans/specs are intentionally outside this gate.

Do **not** use a grep for `acceptedGroupByCard|acceptedOrder|...` as hidden-answer proof; the Rust Analysis wire sentinel test is the authoritative boundary check.

- [ ] **Step 8: Run the Workbench against real compiled Chapter 1**

After `bun run scenes:compile`, launch:

```bash
bun run dev:editor
```

Using actual Chapter 1 generated resources, inspect:

1. one linear scene;
2. `investigation_scene_3`;
3. `interrogation_scene_4`;
4. `analysis_scene_8_5`;
5. Whole chapter scope.

Acceptance for the smoke:

- no `ReaderProjectionError` or backend typed error;
- project tree/order follows Chapter 1 manifest;
- a known line from `investigation_scene_3` is visible;
- interrogation Press/Present branches are distinct;
- Analysis shows public card/group/feedback/result content but not accepted solution configuration;
- switching to Stage on `investigation_scene_3` loads the layout and Save Layout still succeeds;
- modify one harmless dialogue line in a local working copy, run `bun run scenes:compile` (or `bun run scenes:watch`), press Refresh, and confirm the Reader updates without restarting the Workbench; restore the source edit before committing.

Record the observed scenes and successful Refresh/Stage check in PR #75's verification section.

- [ ] **Step 9: Inspect the final diff for scope**

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected scope includes only HPA-634 Workbench/editor changes, the compiler single-root cut, active source-root guidance updates, and the two planning docs. No production game source ownership changes, Chapter 2 authoring, or future Workbench modes.

- [ ] **Step 10: Commit the final chapter Reader slice**

```bash
git add apps/layout-editor
# add only any Task 6 files changed by final fixes; do not stage generated scene resources
git commit -m "feat(editor): add continuous chapter reader"
```

If Task 6 required no code changes after the previous commit except verification, do not create an empty commit; update PR #75 with verification evidence instead.

---

## Final acceptance mapping

| HPA-634 requirement | Owning task |
| --- | --- |
| Visible Lyra Story Workbench + only Reader/Stage | Task 4/5 |
| Preserve Stage investigation workflow/save | Task 2/4/6 |
| All four manifest scene types in deterministic tree | Task 1/4 |
| ID-only IPC and generic path deletion | Task 2/4 |
| `docs/stories_plan` actual canonical root | Task 1 |
| Current-scene Reader | Task 3/5 |
| Investigation carrier completeness | Task 3 |
| Interrogation Press/Present/fallback grouping | Task 3/5 |
| Analysis public content without hidden wire data | Task 2/3 |
| Whole manifest chapter Reader | Task 6 |
| Cue/speaker/branch/scope/search controls | Task 5/6 |
| Refresh after recompilation | Task 5/6 |
| Source path + semantic anchor | Task 3/5 |
| No source-map/second Markdown parser | All tasks |
| Real Chapter 1 verification | Task 6 |
| One PR | All tasks |

## Self-review gates before execution

The executor must re-check these invariants after each task rather than deferring them to final review:

1. `@lyra/scene-types` remains narrow; full scene JSON is imported from `@lyra/scripts` only.
2. The compiler remains the single owner of dialogue-carrier enumeration; Reader consumes `deriveDialogueSegments()` rather than maintaining a second list.
3. Analysis is the only scene type whose compiled payload is sanitized at the backend because HPA-634 explicitly requires the hidden-answer IPC boundary.
4. Old generic commands remain only while a live caller needs them and are deleted in Task 4.
5. No Reader cache path exists without Refresh invalidation and generation fencing.
6. No current source-root guidance still promises a live `static/stories_plan` tree after Task 1.
7. `ReaderGroup.kind`, scene type, dialogue type, and compiler origin switches stay exhaustive.
8. No task introduces a fifth/bulk IPC command, watcher, persisted Reader settings, or future mode placeholder.
