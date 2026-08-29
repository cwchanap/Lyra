# HPA-634 Story Workbench Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first useful Lyra Story Workbench slice: an all-scene read-only Reader plus the existing investigation Stage workflow, using identifier-based Tauri commands, compiler-owned TypeScript scene contracts, and a narrow backend Analysis sanitization boundary.

**Architecture:** Authored Markdown/layout sidecars and the existing scene compiler remain authoritative. Rust owns manifest ID resolution, filesystem containment, Analysis public-wire sanitization, and layout-sidecar I/O; TypeScript owns Reader projection using the compiler's `JSON*Scene` types plus `deriveDialogueSegments()`, with explicit typed tests for non-dialogue notices. `App.svelte` owns one Workbench index, Reader state remains in memory, and no new compiler artifact/runtime story model/router/document registry is introduced.

**Tech Stack:** Tauri 2 / Rust, Svelte 5, TypeScript, Vitest, Bun workspace packages, existing scene compiler.

**Spec:** `docs/superpowers/specs/2026-08-27-hpa-634-story-workbench-reader-design.md`

## Global Constraints

- Keep `apps/layout-editor` package/path and Tauri identifier; visible product/window title becomes **Lyra Story Workbench**.
- Exactly two functional modes in the finished PR: Reader and Stage. Never expose a Reader control in an intermediate commit before Reader is functional.
- `docs/stories_plan` becomes the one live authored-story default across current tools in this PR.
- Keep generic compiler/orchestrator APIs able to accept caller-supplied root arrays for fixtures/tests; only live defaults become docs-only.
- Frontend passes chapter/scene IDs only; it never builds arbitrary repository paths for IPC.
- No second story catalog/compiler artifact/database/router/docking/event bus/plugin model/source-map framework/project-wide search index.
- Do not move the full compiler scene schema into `@lyra/scene-types` and do not add a shared Rust scene-schema crate.
- Add only two dependency edges required by the design: workspace `@lyra/scripts` to the editor frontend and repository-existing `serde_json = "1"` to the editor Rust crate.
- Remove `libc` when generic `O_NOFOLLOW` write machinery becomes unreachable.
- Hidden Analysis accepted mappings, thresholds, scoring/progression semantics must not cross Reader IPC.
- Public Analysis order `fixedAnchors` may cross Reader IPC; `minimumSelected`, accepted maps, selection mappings, unlock/reveals, and runtime state may not.
- Existing Stage geometry/evidence/layout semantics and generation fencing remain owned by `layout-store.svelte.ts` and current Stage components.
- One implementation PR only: continue on PR #75.

---

## File ownership map

### Existing files modified

- `packages/scripts/compile-scenes.ts` — live compiler CLI source-root default.
- `packages/scripts/compile-scenes/evidence-sources-audit.ts` — evidence-audit source-root default.
- `packages/scripts/audio/corpus-validation.ts` — audio corpus source-root default.
- `packages/scripts/audio/corpus-validation.test.ts` — default-root regression.
- `packages/scripts/audio/cli.ts` — audio apply/validate source-root default.
- `packages/scripts/audio/cli.test.ts` — CLI source-path regressions if current expectations reference the dual-root default.
- `apps/game/src/lib/audio/sfx-events.test.ts` — authored-content test helper root.
- `CLAUDE.md` — current source-root guidance.
- active `.claude/skills/**` files that describe current `static/stories_plan` authoring — current guidance only.
- `apps/layout-editor/package.json` — add `@lyra/scripts` and `verify:reader-real-content` script.
- `apps/layout-editor/src-tauri/Cargo.toml` — add `serde_json`; later remove `libc`.
- `apps/layout-editor/src-tauri/src/lib.rs` — Workbench index/resolver, domain scene/layout commands, Analysis sanitizer, removal of generic commands.
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
- `apps/layout-editor/src/lib/reader-projection.test.ts` — typed carrier + non-dialogue notice projection tests.
- `apps/layout-editor/src/lib/reader-view.ts` — pure cue/speaker/branch/search filtering helpers.
- `apps/layout-editor/src/lib/reader-view.test.ts` — filter/search tests.
- `apps/layout-editor/src/lib/ReaderView.svelte` — read-only grouped scene renderer.
- `apps/layout-editor/scripts/verify-reader-real-content.ts` — compile-then-project Chapter 1 integration gate.

---

## Task 1: Make current live story-root defaults docs-only and add the manifest-owned Workbench index

**Files:**
- Modify: `packages/scripts/compile-scenes.ts`
- Modify: `packages/scripts/compile-scenes/evidence-sources-audit.ts`
- Modify: `packages/scripts/audio/corpus-validation.ts`
- Modify/Test: `packages/scripts/audio/corpus-validation.test.ts`
- Modify: `packages/scripts/audio/cli.ts`
- Modify/Test if current assertions mention the old live default: `packages/scripts/audio/cli.test.ts`
- Modify: `apps/game/src/lib/audio/sfx-events.test.ts`
- Modify: `CLAUDE.md`
- Modify: active `.claude/skills/**` current-authoring instructions found by the audit below
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

### Steps

- [ ] **Step 1: Record every current live dual-root owner before editing**

Run:

```bash
rg -n 'static/stories_plan|docs/stories_plan' \
  packages/scripts/compile-scenes.ts \
  packages/scripts/compile-scenes/evidence-sources-audit.ts \
  packages/scripts/audio/corpus-validation.ts \
  packages/scripts/audio/cli.ts \
  apps/game/src/lib/audio/sfx-events.test.ts \
  apps/layout-editor/src-tauri/src/lib.rs \
  CLAUDE.md .claude/skills
```

Expected baseline includes:

```text
packages/scripts/compile-scenes.ts                      SOURCE_ROOTS
packages/scripts/compile-scenes/evidence-sources-audit.ts DEFAULT_SOURCE_ROOTS
packages/scripts/audio/corpus-validation.ts             DEFAULT_SOURCE_ROOTS
packages/scripts/audio/cli.ts                           STORY_ROOTS
apps/game/src/lib/audio/sfx-events.test.ts              AUTHORED_ROOTS
apps/layout-editor/src-tauri/src/lib.rs                 old dual-root source probe
CLAUDE.md / active authoring skills                     current dual-root guidance
```

Do not edit historical `docs/superpowers/**` documents. Do not remove caller-supplied multi-root support from `compile(...)`/orchestrator tests.

- [ ] **Step 2: Write default-root regressions before changing live defaults**

In `packages/scripts/audio/corpus-validation.test.ts`, add:

```ts
it("defaults authored corpus loading to docs/stories_plan only", () => {
  expect(DEFAULT_SOURCE_ROOTS).toEqual(["docs/stories_plan"]);
});
```

In `packages/scripts/compile-scenes/evidence-sources-audit.test.ts`, import/export the default constant if necessary and pin:

```ts
expect(DEFAULT_SOURCE_ROOTS).toEqual(["docs/stories_plan"]);
```

If `DEFAULT_SOURCE_ROOTS` is currently private in the evidence audit, export only that constant; do not expose a broader audit configuration API.

Run:

```bash
bun run test:scripts -- -t "docs/stories_plan only"
```

Expected: FAIL because current defaults still include `static/stories_plan`.

- [ ] **Step 3: Change every current live default to docs-only**

Use these exact defaults:

```ts
// packages/scripts/compile-scenes.ts
const SOURCE_ROOTS = [resolve(REPO_ROOT, "docs/stories_plan")];

// packages/scripts/compile-scenes/evidence-sources-audit.ts
export const DEFAULT_SOURCE_ROOTS = ["docs/stories_plan"] as const;

// packages/scripts/audio/corpus-validation.ts
export const DEFAULT_SOURCE_ROOTS = ["docs/stories_plan"] as const;

// packages/scripts/audio/cli.ts
const STORY_ROOTS = ["docs/stories_plan/"] as const;

// apps/game/src/lib/audio/sfx-events.test.ts
const AUTHORED_ROOTS = ["docs/stories_plan"];
```

Update adjacent comments so none claim current compiler/audio/audit/SFX behavior merges both roots.

Do **not** change generic APIs that accept an explicit `sourceRoots`/`sourceRoot` argument. Fixture tests may continue to create alternate roots intentionally.

- [ ] **Step 4: Update current repo/authoring guidance**

In `CLAUDE.md`:

- `bun run scenes:compile` describes only `docs/stories_plan`;
- Scene Pipeline step 1 says authored Markdown lives under `docs/stories_plan/`;
- remove wording about current live two-root merge.

For active `.claude/skills/**` files found in Step 1, change current write/read instructions from `static/stories_plan/...` to `docs/stories_plan/...`. Preserve explicitly historical examples.

`.agents/skills` is a symlink to `.claude/skills`; do not duplicate edits through the symlink.

- [ ] **Step 5: Add the explicit editor JSON dependency**

Change `apps/layout-editor/src-tauri/Cargo.toml` to include:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Keep `libc` for now because old generic write commands still compile until Task 4.

- [ ] **Step 6: Write failing Workbench index/resolver tests**

In `apps/layout-editor/src-tauri/src/lib.rs`, add a temporary-root helper containing:

```text
apps/game/src-tauri/resources/scenes/chapters.json
docs/stories_plan/chapter_1/scene_a.md
docs/stories_plan/chapter_1/investigation_scene_b.md
docs/stories_plan/chapter_1/interrogation_scene_c.md
docs/stories_plan/chapter_1/analysis_scene_d.md
```

Use this chapters fixture:

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
        resolve_manifest_scene_at_root(&root, "missing", "scene_a").unwrap_err().code,
        "chapterNotFound"
    );
    assert_eq!(
        resolve_manifest_scene_at_root(&root, "chapter_1", "missing").unwrap_err().code,
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

- [ ] **Step 7: Run focused tests and confirm red**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml workbench_index_
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml manifest_scene_resolver_
```

Expected: compile failures because Workbench resolver types/functions do not exist.

- [ ] **Step 8: Implement the minimal manifest-owned index/resolver**

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

Use private `Deserialize` structs for only the fields consumed from `chapters.json`. Derive scene ID from the manifest filename stem; do not scan authored directories.

Construct source path by replacing `.json` with `.md` under exactly `docs/stories_plan`. Canonicalize existing backend-constructed paths and assert they remain under the canonical workspace/story roots before reading.

- [ ] **Step 9: Register only `load_workbench_index`**

Add `load_workbench_index` to `tauri::generate_handler!` while leaving old generic commands registered. Intermediate commits remain green until Task 4 cuts callers over.

- [ ] **Step 10: Verify Task 1 live defaults explicitly**

Run:

```bash
bun run scenes:compile
bun run test:scripts
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
rg -n 'static/stories_plan' \
  packages/scripts/compile-scenes.ts \
  packages/scripts/compile-scenes/evidence-sources-audit.ts \
  packages/scripts/audio/corpus-validation.ts \
  packages/scripts/audio/cli.ts \
  apps/game/src/lib/audio/sfx-events.test.ts \
  CLAUDE.md .claude/skills
```

Expected:

- compile/tests pass;
- the explicit live-default/current-guidance grep returns no `static/stories_plan` hit;
- `apps/layout-editor/src-tauri/src/lib.rs` is intentionally not in this Task 1 zero-hit gate because its old generic dual-root probe remains temporarily registered until Task 4. Task 6 verifies that final owner is gone.

- [ ] **Step 11: Commit**

```bash
git add packages/scripts/compile-scenes.ts \
  packages/scripts/compile-scenes/evidence-sources-audit.ts \
  packages/scripts/compile-scenes/evidence-sources-audit.test.ts \
  packages/scripts/audio/corpus-validation.ts \
  packages/scripts/audio/corpus-validation.test.ts \
  packages/scripts/audio/cli.ts packages/scripts/audio/cli.test.ts \
  apps/game/src/lib/audio/sfx-events.test.ts \
  CLAUDE.md .claude/skills \
  apps/layout-editor/src-tauri/Cargo.toml apps/layout-editor/src-tauri/src/lib.rs
git commit -m "feat(editor): establish canonical story root and index"
```

If `cli.test.ts` has no changed expectation after the implementation, do not stage it.

---

## Task 2: Add ID-based scene/layout commands and sanitize Analysis at the wire

**Files:**
- Modify/Test: `apps/layout-editor/src-tauri/src/lib.rs`

**Consumes:** `resolve_manifest_scene_at_root` from Task 1.

**Produces:**

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchSceneBundle {
    scene: serde_json::Value,
}

fn load_scene_bundle_at_root(
    root: &Path,
    chapter_id: &str,
    scene_id: &str,
) -> Result<WorkbenchSceneBundle, EditorError>;

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

### Steps

- [ ] **Step 1: Extend the temporary fixture with compiled scenes and layout sidecar**

Create minimal compiled JSON files matching each manifest entry. The Analysis fixture contains public and forbidden sentinel data. Use these board fragments:

```json
{
  "kind":"classify",
  "common":{
    "id":"board_a",
    "label":"Board A",
    "prompt":"public prompt",
    "unlock":{"predicate":"fact_asserted","id":"secret_progression"},
    "reveals":[{"kind":"assertFact","factId":"secret_reveal"}],
    "feedback":{
      "incomplete":"public incomplete",
      "incorrect":"public incorrect",
      "hint":"public hint",
      "incorrectSelections":[{"cards":["card_a"],"feedback":"secret mapped feedback"}]
    },
    "cards":[{
      "id":"card_a",
      "label":"Card A",
      "source":{"kind":"evidence","id":"evidence_a"},
      "summary":"public card summary"
    }],
    "resultDialogue":[{"kind":"line","speaker":"相馬律","text":"public result","portrait":null}]
  },
  "groups":[{"id":"group_a","label":"Group A","description":"public group description"}],
  "acceptedGroupByCard":{"card_a":"secret_group"}
}
```

Order board:

```json
{
  "kind":"order",
  "common":{
    "id":"board_b","label":"Board B","prompt":"order prompt","unlock":null,"reveals":[],
    "feedback":{"incomplete":"order incomplete","incorrect":"order incorrect","hint":null,"incorrectSelections":[]},
    "cards":[{"id":"anchor_card","label":"Anchor Card","source":{"kind":"evidence","id":"evidence_b"},"summary":"anchor summary"}],
    "resultDialogue":[]
  },
  "acceptedOrder":["secret_order"],
  "fixedAnchors":[{"cardId":"anchor_card","position":1}]
}
```

Threshold board:

```json
{
  "kind":"threshold",
  "common":{
    "id":"board_c","label":"Board C","prompt":"threshold prompt","unlock":null,"reveals":[],
    "feedback":{"incomplete":"threshold incomplete","incorrect":"threshold incorrect","hint":null,"incorrectSelections":[]},
    "cards":[],"resultDialogue":[]
  },
  "minimumSelected":7,
  "acceptedSelections":[["secret_selection"]]
}
```

- [ ] **Step 2: Write failing scene-bundle boundary tests**

```rust
#[test]
fn non_analysis_bundle_preserves_compiler_payload() {
    let root = temp_workbench_root();
    let bundle = load_scene_bundle_at_root(&root, "chapter_1", "investigation_scene_b").unwrap();
    assert_eq!(bundle.scene["type"], "investigation");
    assert_eq!(bundle.scene["id"], "investigation_scene_b");
}

#[test]
fn analysis_bundle_keeps_public_writer_fields_and_strips_forbidden_semantics() {
    let root = temp_workbench_root();
    let bundle = load_scene_bundle_at_root(&root, "chapter_1", "analysis_scene_d").unwrap();
    let serialized = serde_json::to_string(&bundle).unwrap();

    for required in [
        "public prompt",
        "public incomplete",
        "public incorrect",
        "public hint",
        "public card summary",
        "public group description",
        "public result",
        "fixedAnchors",
        "anchor_card",
    ] {
        assert!(serialized.contains(required), "missing public field/value {required}");
    }

    for forbidden in [
        "acceptedGroupByCard",
        "secret_group",
        "acceptedOrder",
        "secret_order",
        "minimumSelected",
        "acceptedSelections",
        "secret_selection",
        "incorrectSelections",
        "secret mapped feedback",
        "secret_progression",
        "secret_reveal",
    ] {
        assert!(!serialized.contains(forbidden), "leaked forbidden field/value {forbidden}");
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

- [ ] **Step 5: Implement raw non-Analysis load plus a narrow Analysis whitelist**

`load_scene_bundle_at_root` must:

1. resolve manifest scene by IDs;
2. read/parse compiled JSON as `serde_json::Value`;
3. assert compiled `id` and `type` match manifest resolution;
4. keep value unchanged for linear/investigation/interrogation;
5. for Analysis, call `public_analysis_value(&value)` and return only the public value.

Keep `public_analysis_value` local to `lib.rs`. It may use small `object_field` / `array_field` helpers, but it must whitelist fields rather than recursively deleting a blacklist.

Whitelist:

```text
type, id, title, summary, intro, boards, outro
board.kind
board.common.id/label/prompt/cards/feedback/resultDialogue
board.groups for classify only
board.fixedAnchors for order only
feedback.incomplete/incorrect/hint
card.id/label/source/summary
group.id/label/description
fixedAnchor.cardId/position
```

Do **not** copy:

```text
acceptedGroupByCard
acceptedOrder
acceptedSelections
incorrectSelections
minimumSelected
board.common.unlock
board.common.reveals
runtime available/completed/readOnly/draft/selected-card fields
```

Reject unknown Analysis board kind with `EditorError { code: "unsupportedAnalysisBoardKind", ... }`.

- [ ] **Step 6: Implement ID-based layout resolution**

Resolve layout sidecar only after verifying `ResolvedScene.scene_type == SceneType::Investigation`. Build sidecar path from the resolved canonical authored `.md` path using the existing sidecar naming convention. Keep one containment assertion and ordinary I/O diagnostics; do not call old caller-path validation helpers.

- [ ] **Step 7: Register the three commands but keep old commands temporarily**

`tauri::generate_handler!` now contains all four Workbench commands plus the old generic commands. This is intentionally temporary and green.

- [ ] **Step 8: Verify all editor Rust tests**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

Expected: PASS, including public `fixedAnchors`, hidden threshold/progression sentinels, and layout round-trip.

- [ ] **Step 9: Commit**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs
git commit -m "feat(editor): add workbench domain commands"
```

---

## Task 3: Build Reader projection in compiler-typed TypeScript and pin non-dialogue notices

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

### Steps

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
  fixedAnchors: Extract<AnalysisBoard, { kind: "order" }>["fixedAnchors"];
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
        | "feedback"
        | "constraint";
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

- [ ] **Step 3: Write typed fixtures including non-dialogue presentation**

In `reader-projection.test.ts`, import compiler types and define fixtures with `satisfies`, not casts.

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

Investigation fixture requirements:

- one sublocation;
- one hotspot with `inspectDialogue`, `onReexamine`, and this reveal:

```ts
reveals: [{ kind: "evidence", id: "door_log" }],
```

- one character/topic with dialogue/re-examine;
- one evidence with onCollect/onReexamine;
- one statement with onAcquire/onReexamine;
- Intro/transition/Outro;
- each dialogue array has a unique sentinel string matching its compiler carrier ID.

Interrogation fixture requirements:

- one inquiry phase and phase entry;
- one question with all question-level fallback carriers;
- one testimony line with content/challenge/onCorrect/onWrongEvidence;
- the line has this non-null contradiction:

```ts
contradiction: { kind: "evidence", id: "cctv" },
```

- one evidence and one statement manifest with acquisition/re-examine carriers;
- each dialogue carrier has a unique sentinel.

Public Analysis fixture requirements:

- Intro/Outro;
- classify board with one public card/group and feedback/result;
- order board with:

```ts
fixedAnchors: [{ cardId: "anchor_card", position: 1 }],
```

- threshold board without `minimumSelected` because the Workbench payload intentionally excludes it.

- [ ] **Step 4: Write failing dialogue-carrier completeness tests**

For investigation/interrogation:

```ts
const expected = deriveDialogueSegments({
  chapterId: "chapter_1",
  json: investigationScene,
})
  // Mirror the SegmentPool non-empty contract: empty compiler segments never
  // become reader carrier groups, so collectDialogueCarrierIds(reader) omits
  // them. Filter them out before comparing or the expected set is a superset.
  .filter((segment) => segment.items.length > 0)
  .map((segment) => readerSegmentId(segment.origin));

const reader = projectReaderScene(
  "chapter_1",
  "docs/stories_plan/chapter_1/investigation_scene_b.md",
  investigationScene,
);

expect(collectDialogueCarrierIds(reader)).toEqual(new Set(expected));
```

Pin representative compiler-owned IDs:

```ts
expect(findGroup(reader, "hotspot:door:inspect")?.label).toBe("Inspect");
expect(findGroup(reader, "hotspot:door:reexamine")?.label).toBe("On Re-examine");
expect(findGroup(reader, "evidence:door_log:onCollect")?.label).toBe("On Collect");
expect(findGroup(reader, "statement:witness:onAcquire")?.label).toBe("On Acquire");
```

Interrogation labels may be humanized, IDs may not be renamed:

```ts
expect(findGroup(reader, "question:q1:line:l1:challenge")?.label).toBe("Press");
expect(findGroup(reader, "question:q1:line:l1:onCorrect")?.label).toBe("Correct Present");
expect(findGroup(reader, "question:q1:line:l1:onWrongEvidence")?.label).toBe("Wrong Present");
```

- [ ] **Step 5: Write failing non-dialogue notice tests**

Investigation reveal assertion:

```ts
const hotspot = findGroup(investigationReader, "hotspot:door");
expect(hotspot?.items).toContainEqual({
  kind: "notice",
  noticeKind: "evidence",
  text: "Reveals evidence: door_log",
});
```

Interrogation contradiction assertion:

```ts
const line = findGroup(interrogationReader, "line:l1");
expect(line?.items).toContainEqual({
  kind: "notice",
  noticeKind: "contradiction",
  text: "Contradiction: evidence:cctv",
});
```

Analysis fixed-anchor assertion:

```ts
const orderBoard = findGroup(analysisReader, "board:order_board");
expect(orderBoard?.items).toContainEqual({
  kind: "notice",
  noticeKind: "constraint",
  text: "Fixed card anchor_card at position 1",
});
```

Also assert public Analysis card/group/generic feedback/result text appears.

- [ ] **Step 6: Run projection tests and confirm red**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-projection.test.ts
```

Expected: FAIL because projection functions do not exist.

- [ ] **Step 7: Implement exhaustive dialogue conversion**

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

`assertNever` throws `ReaderProjectionError` for stale malformed runtime data while preserving compile-time exhaustiveness.

- [ ] **Step 8: Reuse `deriveDialogueSegments()` through a consumable SegmentPool**

For full compiler scenes (linear/investigation/interrogation), call `deriveDialogueSegments({ chapterId, json: scene })` once.

Normalize origin variants with exhaustive `readerSegmentId(origin)`:

```text
linearScene -> main
investigationIntro -> intro
investigationOutro -> outro
investigationInteraction -> origin.segmentId
interrogationIntro -> intro
interrogationOutro -> outro
interrogationPhase -> origin.segmentId
analysisIntro -> intro
analysisResult -> board:<boardId>:result
analysisOutro -> outro
```

Create `SegmentPool.take(id)` and `SegmentPool.assertFullyConsumed()`. `assertFullyConsumed()` throws `unconsumedCompilerDialogueSegment` when a non-empty compiler segment remains.

- [ ] **Step 9: Implement typed non-dialogue notice helpers**

Use exhaustive helpers for current reveal/target unions. Required stable copy:

```ts
function inventoryTargetText(target: { kind: "evidence" | "statement"; id: string }) {
  return `${target.kind}:${target.id}`;
}
```

Investigation `RevealTarget` examples:

```text
evidence -> Reveals evidence: <id>
statement -> Reveals statement: <id>
practice -> Reveals practice: <id>
topic -> Reveals topic: <characterId>/<topicId>
hotspot -> Reveals hotspot: <id>
sublocation -> Reveals sublocation: <id>
```

Story reveal variants are rendered with concise writer-facing labels using their IDs, without evaluating them. Interrogation line contradiction uses exactly `Contradiction: <kind>:<id>`.

Do not add Analysis unlock/reveal helpers because those fields never cross Workbench IPC.

- [ ] **Step 10: Implement scene-specific structural projection**

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

Structural containers use closed `ReaderGroupKind`; dialogue groups consume the compiler SegmentPool; non-dialogue notices are projected explicitly from typed fields. Analysis order fixed anchors become `constraint` notices.

- [ ] **Step 11: Run projection tests and editor type-check**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-projection.test.ts
bun run editor:check
```

Expected: PASS. Missing dialogue carrier fails SegmentPool; missing reveal/contradiction/fixed-anchor presentation fails explicit notice assertions.

- [ ] **Step 12: Commit**

```bash
git add apps/layout-editor/package.json bun.lock \
  apps/layout-editor/src/lib/workbench-types.ts \
  apps/layout-editor/src/lib/reader-projection.ts \
  apps/layout-editor/src/lib/reader-projection.test.ts
git commit -m "feat(editor): add typed story reader projection"
```

---

## Task 4: Cut Stage/index to domain IPC, ship the branded all-scene shell, then delete generic path commands

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

**Produces:** One branded all-scene project tree with preserved Stage workflow. Reader projection code exists from Task 3 but no Reader mode/control is exposed until Task 5 makes it functional.

### Steps

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

Save expects `save_investigation_layout` with selected IDs and current layout. Retain existing stale-generation tests and adapt only their call shape.

- [ ] **Step 3: Refactor Stage store without Workbench index ownership**

Change Stage entrypoint to:

```ts
loadInvestigationScene(chapterId: string, sceneId: string): Promise<void>
```

It loads `loadSceneBundle` + `loadInvestigationLayout`, rejects non-investigation bundle, and keeps existing mutations/save semantics.

Delete from Stage store:

```text
loadChapters()
editorState.chapters
chapter-load generation fields used only by loadChapters
```

- [ ] **Step 4: Write failing all-scene shell/index tests**

In `App.test.ts`, mock one scene of each type. Assert exact manifest order and that selecting a non-investigation scene in Stage does not call layout load.

Pin this intermediate UI truthfully:

```text
Lyra Story Workbench
Stage
Stage is available for investigation scenes only.
```

Do **not** render a Reader button yet.

- [ ] **Step 5: Extend scene-label helper for Analysis**

Change:

```ts
/^(?:(investigation|interrogation)_)?scene_(.+)$/
```

to:

```ts
/^(?:(investigation|interrogation|analysis)_)?scene_(.+)$/
```

Add:

```ts
expect(readableSceneLabel("chapter_1/analysis_scene_8_5.json")).toBe(
  "Analysis Scene 8.5",
);
```

- [ ] **Step 6: Implement all-scene Stage shell and Workbench index ownership**

`App.svelte` loads `loadWorkbenchIndex()` directly, owns selected chapter/scene IDs, lists all manifest scenes, and calls Stage store only when selected scene is investigation.

Keep `TargetList`, `EvidenceAssignmentPanel`, `EditorCanvas`, sublocation controls, and Save Layout behavior unchanged under Stage.

- [ ] **Step 7: Update visible branding only**

Change heading/window/product display to **Lyra Story Workbench**. Keep package directory and Tauri identifier unchanged.

- [ ] **Step 8: Run frontend/store tests before deleting old commands**

```bash
bun run --cwd apps/layout-editor test src/lib/layout-store.test.ts
bun run --cwd apps/layout-editor test src/lib/scene-labels.test.ts
bun run --cwd apps/layout-editor test src/App.test.ts
bun run editor:check
```

Expected: PASS with no frontend caller of generic file IPC.

- [ ] **Step 9: Delete now-unreachable generic path machinery and `libc`**

Delete backend commands:

```text
read_project_file
write_project_file
resolve_layout_path
```

Delete helper machinery used only by caller-supplied paths, including dual-root probing, arbitrary write-path validation, symlink rejection, `O_NOFOLLOW`, and TOCTOU-specific write helpers. Keep one containment assertion for backend-constructed canonical paths plus ordinary I/O errors.

Remove:

```toml
libc = "0.2"
```

from editor `Cargo.toml` once no source uses it.

- [ ] **Step 10: Run Rust/front-end regression after deletion**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run --cwd apps/layout-editor test
bun run editor:check
rg -n 'read_project_file|write_project_file|resolve_layout_path|static/stories_plan' \
  apps/layout-editor
rg -n 'libc' apps/layout-editor/src-tauri/Cargo.toml apps/layout-editor/src-tauri/src
```

Expected: all tests pass; greps return no old generic IPC, old editor dual-root probe, or editor `libc` use.

- [ ] **Step 11: Commit**

```bash
git add apps/layout-editor
git commit -m "feat(editor): cut workbench shell to domain IPC"
```

---

## Task 5: Add functional current-scene Reader, mode switch, filters, source references, and Refresh

**Files:**
- Create/Test: `apps/layout-editor/src/lib/reader-view.ts`
- Create/Test: `apps/layout-editor/src/lib/reader-view.test.ts`
- Create: `apps/layout-editor/src/lib/ReaderView.svelte`
- Modify/Test: `apps/layout-editor/src/App.svelte`
- Modify/Test: `apps/layout-editor/src/App.test.ts`

**Consumes:** `projectReaderScene`, `loadSceneBundle`, selected Workbench source path.

**Produces:** Functional Reader/Stage mode switch for one selected scene, four Reader filters, and Refresh. Whole-chapter scope is Task 6.

### Steps

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

Tests prove:

- `showCues: false` removes sceneTag/action but leaves dialogue/notices;
- speaker filter removes nonmatching lines while retaining ancestors;
- `showBranches: false` removes `flow === "branch"` groups;
- search is case-insensitive and retains ancestors of matching descendants;
- empty groups are omitted unless they are the only scene boundary needed for context.

- [ ] **Step 2: Implement `filterReaderScene` as one pure tree walk**

Normalize search with `trim().toLocaleLowerCase()`. Do not spread filters across scene-specific renderers.

- [ ] **Step 3: Write failing current-scene Reader UI tests**

Mock `load_scene_bundle` and assert selecting each scene type renders known fixture text through Reader.

Pin that Reader and Stage controls appear **together only in this task**, when current-scene Reader is functional.

Interrogation labels:

```text
Press
Correct Present
Wrong Present
Fallback
```

Analysis UI includes public card/group/feedback/fixed-anchor/result content and does not receive threshold/accepted/progression fields in its fixture type.

- [ ] **Step 4: Implement `ReaderView.svelte`**

Responsibilities:

- render scene boundary/type/title;
- recursively render `ReaderGroup` labels;
- render line as `speaker: text`;
- render actions/tags/notices with small cue labels;
- collapse/expand branch/group content locally;
- show copyable source reference for scene and meaningful groups.

No scene-specific projection logic belongs in Svelte.

- [ ] **Step 5: Add real Reader/Stage mode switch and current-scene loading atomically**

`App.svelte` adds:

```ts
let mode: "reader" | "stage" = "reader";
let currentBundle: WorkbenchSceneBundle | null = null;
let currentReaderScene: ReaderScene | null = null;
let readerLoadGeneration = 0;
const bundleCache = new Map<string, WorkbenchSceneBundle>();
```

On selection in Reader mode:

1. increment generation;
2. use cached bundle or `loadSceneBundle`;
3. ignore stale response;
4. call `projectReaderScene(chapterId, sourcePath, bundle.scene)`;
5. render filtered tree.

On Stage, preserve Task 4 behavior and load layout only for investigation scenes.

- [ ] **Step 6: Add the four current-scene Reader filters**

State stays in `App.svelte`:

```ts
let showCues = true;
let speaker: string | null = null;
let showBranches = false;
let search = "";
```

Controls:

```text
Dialogue only | Dialogue + cues
All speakers | <one speaker>
Main flow | Expanded branches
Search loaded Reader text
```

Do not add current-scene/whole-chapter scope control until Task 6.

- [ ] **Step 7: Add Refresh**

```ts
async function refreshReader(): Promise<void> {
  if (!selectedChapterId) return;
  try {
    if (readerScope === "chapter") {
      const chapter = selectedChapter;
      if (!chapter) return;
      for (const scene of chapter.scenes) {
        bundleCache.delete(`${chapter.id}:${scene.id}`);
      }
      await loadChapterReader(chapter.id, true);
      return;
    }
    if (!selectedSceneId) return;
    bundleCache.delete(`${selectedChapterId}:${selectedSceneId}`);
    await loadCurrentReaderScene();
  } catch (error) {
    // Defensive: the underlying loaders already catch IPC / ReaderProjectionError
    // failures and write the typed Workbench error state, so this should not
    // normally throw. Guard anyway so a rejected promise never propagates to the
    // Refresh button's onclick caller.
    readerError = normalizeError(error);
  }
}
```

`refreshReader`, `loadCurrentReaderScene`, and `loadChapterReader` each use a try-catch path rather than propagating failures to their caller. Rejected IPC (`loadSceneBundle`) and `ReaderProjectionError` failures are caught, written to the typed Workbench error state (`readerError` / `chapterReaderError`), and the affected reader result is cleared to `null`. The generation token is still checked inside each catch so a stale response cannot overwrite a newer load's state. Refresh uses the same generation token so older loads cannot win. No watcher, mtime display, persistence, or polling.

- [ ] **Step 8: Pin Refresh/stale-response tests**

In `App.test.ts`:

- first load resolves `old text`;
- Refresh triggers second load and renders `new text`;
- old request resolves after new request;
- `new text` remains rendered.

- [ ] **Step 9: Verify Task 5**

```bash
bun run --cwd apps/layout-editor test src/lib/reader-view.test.ts
bun run --cwd apps/layout-editor test src/App.test.ts
bun run editor:check
```

Expected: PASS; current-scene Reader and Reader/Stage switch are both truthful and functional.

- [ ] **Step 10: Commit**

```bash
git add apps/layout-editor/src/lib/reader-view.ts \
  apps/layout-editor/src/lib/reader-view.test.ts \
  apps/layout-editor/src/lib/ReaderView.svelte \
  apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(editor): ship current-scene story reader"
```

---

## Task 6: Add whole-chapter scope and close against real compiled Chapter 1 content

**Files:**
- Modify/Test: `apps/layout-editor/src/App.svelte`
- Modify/Test: `apps/layout-editor/src/App.test.ts`
- Modify: `apps/layout-editor/package.json`
- Create: `apps/layout-editor/scripts/verify-reader-real-content.ts`
- Modify/Test only when a concrete failing verification points back to a Task 1–5 owner
- Update: PR #75 description with verification evidence

**Consumes:** manifest-ordered Workbench index, per-scene `loadSceneBundle`, cache/Refresh, `projectReaderScene`.

**Produces:** Whole-chapter continuous reading plus automated and UI real-content verification.

### Steps

- [ ] **Step 1: Write failing deterministic chapter-load test**

Mock chapter order:

```text
scene_a
investigation_scene_b
interrogation_scene_c
analysis_scene_d
```

Switch scope to chapter and assert:

- exactly those IDs requested;
- unlisted fixture file never requested;
- rendered boundaries remain manifest-ordered even when promises resolve out of order.

- [ ] **Step 2: Implement chapter loading through existing command**

```ts
async function loadChapterReader(chapterId: string, force = false): Promise<void>
```

Use selected chapter manifest as only ID source. `Promise.all` may be used because result order follows input order. No fifth bulk command.

For each scene:

1. cache key;
2. load/reuse bundle;
3. `projectReaderScene(chapterId, scene.sourcePath, bundle.scene)`;
4. preserve manifest order.

Use chapter-generation token to ignore stale chapter loads.

- [ ] **Step 3: Add functional scope control**

```text
Current scene | Whole chapter
```

Whole chapter renders one `ReaderView` per projected scene with visible scene type/title boundaries. Collapse state is local and not persisted.

- [ ] **Step 4: Extend Refresh to current scope**

Scene scope deletes/reloads selected key.

Chapter scope:

```ts
for (const scene of selectedChapter.scenes) {
  bundleCache.delete(`${selectedChapter.id}:${scene.id}`);
}
await loadChapterReader(selectedChapter.id, true);
```

Test chapter Refresh reissues every manifest scene load and no unlisted draft load.

- [ ] **Step 5: Add explicit real-content verification script**

Add package script:

```json
"verify:reader-real-content": "bun run scripts/verify-reader-real-content.ts"
```

Create `apps/layout-editor/scripts/verify-reader-real-content.ts` with this shape:

```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChaptersIndex } from "@lyra/scene-types";
import { projectReaderScene } from "../src/lib/reader-projection";
import type { ReaderGroup, ReaderItem, WorkbenchScenePayload } from "../src/lib/workbench-types";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const resourcesRoot = resolve(repoRoot, "apps/game/src-tauri/resources/scenes");
const chapters = JSON.parse(
  readFileSync(resolve(resourcesRoot, "chapters.json"), "utf8"),
) as ChaptersIndex;
const chapter = chapters.chapters.find(({ id }) => id === "chapter_1");
if (!chapter) throw new Error("chapter_1 missing from compiled manifest");

const stems = chapter.scenes.map(({ file }) => file.replace(/^.*\//, "").replace(/\.json$/, ""));
const linearIndex = chapter.scenes.findIndex(({ type }) => type === "linear");
const requiredIndexes = [
  linearIndex,
  stems.indexOf("investigation_scene_3"),
  stems.indexOf("interrogation_scene_4"),
  stems.indexOf("analysis_scene_8_5"),
];
if (requiredIndexes.some((index) => index < 0)) {
  throw new Error("required Chapter 1 Reader verification scene missing from manifest");
}

const readers = requiredIndexes.map((index) => {
  const entry = chapter.scenes[index]!;
  const compiled = JSON.parse(
    readFileSync(resolve(resourcesRoot, entry.file), "utf8"),
  ) as WorkbenchScenePayload;
  const sourcePath = `docs/stories_plan/${entry.file.replace(/\.json$/, ".md")}`;
  return projectReaderScene(chapter.id, sourcePath, compiled);
});

function items(groups: ReaderGroup[]): ReaderItem[] {
  return groups.flatMap((group) => [...group.items, ...items(group.children)]);
}

const investigationItems = items(readers[1]!.groups);
if (!investigationItems.some((item) => item.kind === "notice" && item.noticeKind === "evidence")) {
  throw new Error("investigation_scene_3 projected no evidence/reveal notice");
}

const interrogationItems = items(readers[2]!.groups);
if (!interrogationItems.some((item) => item.kind === "notice" && item.noticeKind === "contradiction")) {
  throw new Error("interrogation_scene_4 projected no contradiction notice");
}

for (const reader of readers) {
  if (reader.groups.length === 0) throw new Error(`${reader.id} projected an empty Reader`);
}
```

This script intentionally feeds raw compiled Analysis only as a **test-time structural superset** to exercise `projectPublicAnalysis`; production Workbench IPC still passes Rust-sanitized `PublicAnalysisScene`. The Rust real-payload sentinel remains authoritative for hidden-field exclusion.

`projectReaderScene`'s SegmentPool must call `assertFullyConsumed()` internally before returning each full compiler scene, so this script automatically fails on real dialogue-carrier drift.

- [ ] **Step 6: Run focused editor tests**

```bash
bun run --cwd apps/layout-editor test
```

Expected: PASS for Stage, all four Reader types, filters, Refresh, source references, deterministic whole chapter, and stale-load fencing.

- [ ] **Step 7: Run compile then automated real-content projector gate**

```bash
bun run scenes:compile
bun run --cwd apps/layout-editor verify:reader-real-content
```

Expected: PASS for one real linear scene plus `investigation_scene_3`, `interrogation_scene_4`, and `analysis_scene_8_5`; SegmentPool leaves no unconsumed dialogue carrier; real investigation reveal/evidence notice and interrogation contradiction notice are present.

- [ ] **Step 8: Run complete required checks**

```bash
bun run editor:check
bun run editor:build
bun run --cwd apps/layout-editor test
bun run test:scripts
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run lint:all
```

All must pass before claiming implementation complete.

- [ ] **Step 9: Verify final path/dependency cleanup against actual live owners**

Run:

```bash
rg -n 'read_project_file|write_project_file|resolve_layout_path' apps/layout-editor
rg -n 'libc' apps/layout-editor/src-tauri/Cargo.toml apps/layout-editor/src-tauri/src
rg -n 'static/stories_plan' \
  packages/scripts/compile-scenes.ts \
  packages/scripts/compile-scenes/evidence-sources-audit.ts \
  packages/scripts/audio/corpus-validation.ts \
  packages/scripts/audio/cli.ts \
  apps/game/src/lib/audio/sfx-events.test.ts \
  apps/layout-editor/src-tauri/src/lib.rs \
  CLAUDE.md .claude/skills
```

Expected:

- no generic editor IPC implementation/caller;
- no editor `libc` dependency/use;
- no `static/stories_plan` in any current live-default owner/current guidance named above.

Do not use a broad repository zero-hit requirement: historical docs and compiler fixtures may deliberately mention alternate roots. Do not use grep as hidden-Analysis proof; the Rust whitelist test is authoritative.

- [ ] **Step 10: Run Workbench UI smoke against real compiled Chapter 1**

Launch:

```bash
bun run dev:editor
```

Inspect:

1. one linear scene;
2. `investigation_scene_3`;
3. `interrogation_scene_4`;
4. `analysis_scene_8_5`;
5. whole-chapter Reader.

Acceptance:

- no `ReaderProjectionError` or backend typed error;
- project tree follows manifest order;
- known investigation dialogue and reveal/evidence notice visible;
- interrogation Press/Present branches and contradiction notice visible;
- Analysis shows public card/group/feedback/fixed-anchor/result content but no accepted solution, threshold, or progression configuration;
- Stage on `investigation_scene_3` loads layout and Save Layout succeeds;
- make one harmless local dialogue edit, run `bun run scenes:compile` or `bun run scenes:watch`, press Refresh, and confirm new text appears without restarting; restore source edit before committing.

Record observed scenes and successful Refresh/Stage checks in PR #75.

- [ ] **Step 11: Inspect final diff for scope**

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected scope contains HPA-634 Workbench/editor implementation, current live-root default/guidance changes, and the two planning docs. No Chapter 2 authoring or future Workbench mode.

The one `apps/game` source-path change expected by Task 1 is the existing SFX authored-content **test helper only**, not production game runtime ownership.

- [ ] **Step 12: Commit final chapter Reader slice**

```bash
git add apps/layout-editor
# stage only concrete Task 6 implementation files; generated scene resources remain ignored
git commit -m "feat(editor): add continuous chapter reader"
```

If no Task 6 code changed after earlier commits except verification evidence, do not create an empty commit; update PR #75 instead.

---

## Final acceptance mapping

| HPA-634 requirement | Owning task |
| --- | --- |
| Visible Lyra Story Workbench + only functional Reader/Stage | Task 4 branding, Task 5 mode switch |
| Preserve Stage investigation workflow/save | Tasks 2, 4, 6 |
| All four manifest scene types in deterministic tree | Tasks 1, 4 |
| ID-only IPC and generic path deletion | Tasks 2, 4 |
| `docs/stories_plan` actual live canonical default | Tasks 1, 4, 6 |
| Current-scene Reader | Tasks 3, 5 |
| Investigation dialogue carrier completeness | Task 3 |
| Investigation reveal/evidence notices | Tasks 3, 6 |
| Interrogation Press/Present/fallback grouping | Tasks 3, 5 |
| Interrogation contradiction notices | Tasks 3, 6 |
| Analysis public content + fixed anchors without hidden threshold/progression wire data | Tasks 2, 3 |
| Whole manifest chapter Reader | Task 6 |
| Cue/speaker/branch/scope/search controls | Tasks 5, 6 |
| Refresh after recompilation | Tasks 5, 6 |
| Source path + semantic anchor | Tasks 3, 5 |
| No source-map/second Markdown parser | All tasks |
| Automated real Chapter 1 projection | Task 6 |
| Real Chapter 1 UI/Stage/Refresh verification | Task 6 |
| One PR | All tasks |

## Self-review gates before execution

The executor must re-check these invariants after each task:

1. `@lyra/scene-types` remains narrow; full scene JSON is imported from `@lyra/scripts` only.
2. Compiler remains the single owner of dialogue-carrier enumeration; Reader consumes `deriveDialogueSegments()` rather than maintaining a second dialogue list.
3. Non-dialogue notices are independently typed/tested because `deriveDialogueSegments()` does not cover them.
4. Analysis is the only scene type sanitized at backend because HPA-634 requires the hidden-answer/threshold/progression IPC boundary.
5. Analysis public order `fixedAnchors` remain visible; `minimumSelected`, accepted maps/selections, incorrect-selection mappings, unlock/reveals, and runtime state remain absent.
6. Old generic commands remain only while a live caller needs them and are deleted in Task 4.
7. No Reader cache path exists without Refresh invalidation and generation fencing.
8. Every current live source-root default named in Task 1 is docs-only; generic caller-supplied compiler fixture roots remain supported.
9. `ReaderGroup.kind`, scene type, dialogue type, reveal-target handling, and compiler origin switches stay exhaustive.
10. No task introduces a fifth/bulk IPC command, watcher, persisted Reader settings, future mode placeholder, or intermediate nonfunctional Reader control.
11. Rust `WorkbenchSceneBundle { scene }` and TypeScript `WorkbenchSceneBundle = { scene: WorkbenchScenePayload }` remain shape-compatible.
12. Task 6 automated real-content projection and UI smoke both pass before completion is claimed.