# HPA-135 Story Workbench Focused Source Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Story Workbench's first human-controlled source write path: edit one supported Reader/Assets value, review its exact authored-source diff and impact, apply it through a stale-safe fixed-domain backend, and show authoritative validation.

**Architecture:** Keep Reader/Assets as the selection and impact owners. Add a filesystem-free `@lyra/scripts` source-target index that maps the seven supported semantic refs to exact authored source ranges without changing runtime scene JSON; one `FocusedEditDraft` and one `FocusedEditReview` own review UX; Rust resolves only known source documents, guards hash/range/original slice, performs one atomic write, and runs fixed validation. Audio prompt edits target the durable chapter sound plan and use a new narrow audio-owned revision command to synchronize only the matching catalog prompt.

**Tech Stack:** TypeScript 5.6 + Vitest, Svelte 5 runes + Testing Library, Tauri 2 / Rust 2021, `yaml` 2.9 through `@lyra/scripts`, Bun 1.3.1, existing compile-scenes and audio CLIs.

**Spec:** `docs/superpowers/specs/2026-09-05-hpa-135-story-workbench-focused-source-edit-design.md`

## Global Constraints

- One ticket, one PR: continue implementation on this same HPA-135 PR; do not open a second implementation PR.
- Exactly seven editable semantic kinds: Reader dialogue, Reader action, scene Background Prompt, evidence Image Prompt, character visualPrompt, character expression prompt, existing audio prompt.
- No arbitrary frontend path, arbitrary field, generic Markdown/YAML editor, proposal queue, autosave, history model, Workbench Undo, AI provider, or Git automation.
- Do not add source spans/authoring metadata to production scene JSON or the Rust game runtime schema.
- Compiler/tooling owns authored syntax discovery; the layout editor must not add a second Markdown/YAML grammar.
- Audio prompt edits target `docs/audio_plans/<chapterId>.sound-plan.yaml`; the UI must never directly write `static/assets/config/audio.yaml`.
- Keep normal `audio:apply` duplicate/conflict semantics unchanged; HPA-135 adds a separate one-entry audio prompt revision seam.
- Validation commands are backend-selected and fixed; the frontend never supplies a shell command.
- A validation failure after a successful source write is **Applied, validation failed**, not a false no-op/success.
- Skip optional Workbench Undo for HPA-135.

---

## File map

### New files

- `packages/scripts/workbench/source-edit-targets.ts` — filesystem-free semantic source target index + replacement rendering for scene/config/sound-plan sources.
- `packages/scripts/workbench/source-edit-targets.test.ts` — source range / semantic ref / formatting tests.
- `apps/layout-editor/src/lib/focused-edit.ts` — `FocusedEditDraft`, one-hunk diff generation, impact projection, and draft construction.
- `apps/layout-editor/src/lib/focused-edit.test.ts` — pure diff/impact/draft tests.
- `apps/layout-editor/src/lib/FocusedEditReview.svelte` — one shared human review/apply surface.
- `apps/layout-editor/src/lib/FocusedEditReview.test.ts` — review state/UI tests.
- `apps/layout-editor/scripts/verify-focused-edit-real-content.ts` — read-only Chapter 1 target-discovery gate.

### Modified files

- `packages/scripts/compile-scenes/tokenizer.ts` — add exact source offsets/end lines to compiler-owned tokens.
- `packages/scripts/compile-scenes/tokenizer.test.ts` if present; otherwise add tokenizer range cases to the nearest tokenizer/parser unit test file without creating duplicate coverage files.
- `packages/scripts/audio/audio-catalog.ts` — pure one-entry prompt replacement helper used by the audio owner.
- `packages/scripts/audio/audio-catalog.test.ts` — one-entry replacement invariants.
- `packages/scripts/audio/cli.ts` — add `revise-prompt` command.
- `packages/scripts/audio/cli.test.ts` — CLI success/rejection/check tests.
- `packages/scripts/package.json` — add `audio:revise-prompt`.
- root `package.json` — add `audio:revise-prompt` forwarding script.
- `apps/layout-editor/src-tauri/Cargo.toml` — add `sha2 = "0.10"` locally.
- `apps/layout-editor/src-tauri/src/lib.rs` — known source-document resolver/read, hash, guarded atomic source edit, target validation dispatch, bounded command output, Tauri registration, Rust tests.
- `apps/layout-editor/src/lib/workbench-types.ts` — source document/edit request/result types and Reader editable ref.
- `apps/layout-editor/src/lib/workbench-api.ts` — read/apply wrappers.
- `apps/layout-editor/src/lib/reader-projection.ts` — preserve carrier/item edit identity on Reader line/action projections only.
- `apps/layout-editor/src/lib/reader-projection.test.ts` — editable identity tests.
- `apps/layout-editor/src/lib/ReaderView.svelte` — line/action Edit buttons + callback.
- `apps/layout-editor/src/lib/ReaderView.test.ts` — Reader edit affordance tests.
- `apps/layout-editor/src/lib/asset-workspace.ts` — prompt edit selection helpers and shared impact joins using existing typed manifest/usage data.
- `apps/layout-editor/src/lib/asset-workspace.test.ts` — character/audio/background/evidence edit-selection/impact tests.
- `apps/layout-editor/src/lib/AssetsView.svelte` — supported prompt Edit actions + callback.
- `apps/layout-editor/src/lib/AssetsView.test.ts` — Assets affordance and warning tests.
- `apps/layout-editor/src/App.svelte` — one active focused edit + shared review surface wiring only.
- `apps/layout-editor/src/App.test.ts` — Reader/Assets handoff and refresh integration.
- `apps/layout-editor/package.json` — add read-only real-content verifier script if local scripts are owned here.

---

### Task 1: Build compiler-owned semantic source target indexing

**Files:**
- Create: `packages/scripts/workbench/source-edit-targets.ts`
- Create/Test: `packages/scripts/workbench/source-edit-targets.test.ts`
- Modify: `packages/scripts/compile-scenes/tokenizer.ts`
- Test: existing tokenizer/parser tests as appropriate

**Interfaces:**
- Consumes: existing `tokenize()`, `deriveDialogueSegments()`, compiled `WorkbenchScenePayload`-compatible scene JSON, scripts-owned `yaml` package.
- Produces:

```ts
export type WorkbenchSourceRange = {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
};

export type WorkbenchSourceTargetKind =
  | "readerDialogue"
  | "readerAction"
  | "backgroundPrompt"
  | "evidenceImagePrompt"
  | "characterVisualPrompt"
  | "characterExpressionPrompt"
  | "audioPrompt";

export type WorkbenchSourceTarget = {
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  currentText: string;
  sourceRange: WorkbenchSourceRange;
  sourceText: string;
};

export function indexSceneSourceEditTargets(input: {
  chapterId: string;
  sceneId: string;
  sourcePath: string;
  source: string;
  scene: WorkbenchScenePayload;
}): { targets: WorkbenchSourceTarget[]; diagnostics: CompileError[] };

export function indexCharacterSourceEditTargets(input: {
  sourcePath: string;
  source: string;
}): { targets: WorkbenchSourceTarget[]; diagnostics: CompileError[] };

export function indexAudioPlanSourceEditTargets(input: {
  sourcePath: string;
  source: string;
}): { targets: WorkbenchSourceTarget[]; diagnostics: CompileError[] };

export function renderSourceReplacement(
  target: WorkbenchSourceTarget,
  replacementText: string,
): { ok: true; sourceText: string } | { ok: false; diagnostic: CompileError };
```

- [ ] **Step 1: Write failing tokenizer range tests**

Cover single-line dialogue, single-line action, and multi-line bracket action. The assertions must prove offsets slice the original source exactly.

```ts
const source = `# Scene 1: Test

**相馬律**[determined]：原本台詞
[第一行動作
第二行動作]
`;
const tokens = tokenize(source, "scene_1.md");
const line = tokens.find((token) => token.kind === "dialogue")!;
const action = tokens.find((token) => token.kind === "action")!;

expect(source.slice(line.range.start, line.range.end)).toBe(
  "**相馬律**[determined]：原本台詞",
);
expect(source.slice(action.range.start, action.range.end)).toBe(
  "[第一行動作\n第二行動作]",
);
expect(action.range.startLine).toBe(4);
expect(action.range.endLine).toBe(5);
```

- [ ] **Step 2: Run the focused tokenizer test and verify RED**

Run the exact Vitest file/test name used in Step 1, for example:

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/tokenizer.test.ts
```

Expected: FAIL because tokens do not yet expose `range`.

- [ ] **Step 3: Add source offsets/end lines to tokenizer tokens**

Add one shared token range shape and include it on every token variant:

```ts
export type SourceTokenRange = {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
};
```

Track each raw line's start offset while splitting source. For multi-line bracket blocks, `end` must include the closing `]` and `endLine` must be the closing-line number. Do not change token text normalization or parser behavior.

- [ ] **Step 4: Run tokenizer/parser regressions and verify GREEN**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/tokenizer
```

If the repository-wide test script does not forward file args, run the exact Vitest config/file command from Step 2 plus the parser tests touched by type changes.

Expected: PASS; emitted/parsed scene semantics unchanged.

- [ ] **Step 5: Write failing scene source-index tests**

Create fixtures in the test string covering:

```ts
expect(byRef.get("reader:dialogue:main:0")?.currentText).toBe("原本台詞");
expect(byRef.get("reader:action:main:1")?.currentText).toBe("走到門邊");
expect(byRef.get("asset:background:tag_001")?.currentText).toBe(
  "rainy detective office",
);
expect(byRef.get("asset:evidence:summary_copy:imagePrompt")?.currentText).toBe(
  "sealed document folder",
);
```

Also construct one mismatch where the compiled dialogue order/text does not match the source tokens and assert a stable `workbenchSourceDialogueMismatch` diagnostic with **no guessed line/action targets**.

- [ ] **Step 6: Implement `indexSceneSourceEditTargets()` minimally**

Use `deriveDialogueSegments()` for carrier identity and `tokenize()` for authored source positions. Pair authored dialogue-bearing tokens and compiler-derived items in order, asserting kind/text/speaker equality before emitting only line/action targets.

For prompt metadata:

- count scene tags in authored order as `tag_001`, `tag_002`, ... and associate immediately-following `Background Prompt` metadata;
- associate structural `Background Prompt` metadata with the authored heading anchor/unit ID;
- associate `Image Prompt` with the enclosing `evidence:<id>` manifest heading;
- emit no generic metadata target.

- [ ] **Step 7: Write failing character/audio YAML target tests**

Use block and plain scalar examples:

```ts
const characters = `characters:
  - id: soma_ritsu
    visualPrompt: >
      first line
      second line
    expressions:
      standard:
        prompt: calm focused expression
`;
```

Assert exact `sourceText` ranges for `visualPrompt` and `standard.prompt`, and verify replacement rendering changes only the scalar source span.

For sound plan, include two entries and assert exactly one target for a matching `generated` entry. Add rejection coverage for missing, duplicate, and non-`approved`/`generated` entries.

- [ ] **Step 8: Implement YAML target indexing/replacement rendering**

Use `YAML.parseDocument()` and node ranges. Locate semantic owners by parsed IDs/channel, not frontend array indexes.

Preserve only the edited scalar style. Do not stringify the complete source document. For block scalars, retain the existing block scalar header/chomping style and indentation when rendering the replacement.

- [ ] **Step 9: Add replacement-rule tests**

Cover:

- dialogue newline rejected with `workbenchSourceReplacementInvalid`;
- action multiline allowed and brackets preserved;
- Markdown metadata newline rejected;
- character block scalar remains block scalar;
- expression plain scalar remains valid YAML/quotes only that scalar when needed.

- [ ] **Step 10: Run the complete source-target test set**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/workbench/source-edit-targets.test.ts
bun run test:scripts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

```bash
git add packages/scripts/compile-scenes/tokenizer.ts packages/scripts/workbench/source-edit-targets.ts packages/scripts/workbench/source-edit-targets.test.ts packages/scripts/compile-scenes/*tokenizer*test*.ts
git commit -m "feat(workbench): index focused source edit targets"
```

---

### Task 2: Add one-entry audio prompt revision to the existing audio owner

**Files:**
- Modify/Test: `packages/scripts/audio/audio-catalog.ts`
- Modify/Test: `packages/scripts/audio/audio-catalog.test.ts`
- Modify/Test: `packages/scripts/audio/cli.ts`
- Modify/Test: `packages/scripts/audio/cli.test.ts`
- Modify: `packages/scripts/package.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `parseSoundPlanText()`, `validateSoundPlan()`, `parseAudioCatalogText()`, `formatAudioCatalogYaml()`, `serializeAudioCatalog()`.
- Produces:

```ts
export function reviseExistingAudioCatalogPrompt(input: {
  catalog: AudioCatalog;
  channel: keyof AudioCatalog;
  id: string;
  prompt: string;
}): { catalog: AudioCatalog; diagnostics: SoundPlanDiagnostic[] };
```

CLI:

```text
audio:revise-prompt <plan.yaml> <bgm|bgs|sfx> <id>
```

- [ ] **Step 1: Write failing pure catalog revision tests**

```ts
const result = reviseExistingAudioCatalogPrompt({
  catalog,
  channel: "bgm",
  id: "bgm_chapter_close",
  prompt: "revised prompt",
});
expect(result.diagnostics).toEqual([]);
expect(result.catalog.bgm.bgm_chapter_close).toEqual({
  prompt: "revised prompt",
  loop: true,
});
expect(result.catalog.bgs).toEqual(catalog.bgs);
```

Add missing-entry rejection and an assertion that `mergeApprovedEntriesIntoCatalog()` still reports its existing duplicate conflict when given a changed already-existing entry.

- [ ] **Step 2: Run the focused audio-catalog tests and verify RED**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/audio/audio-catalog.test.ts
```

Expected: FAIL because the revision helper does not exist.

- [ ] **Step 3: Implement the pure one-entry helper**

Clone the existing catalog maps, reject a missing `(channel,id)`, update only `prompt`, and carry the existing `loop` value verbatim. Do not route this helper through normal merge semantics.

- [ ] **Step 4: Run audio-catalog tests and verify GREEN**

Use the command from Step 2. Expected: PASS.

- [ ] **Step 5: Write failing `audio:revise-prompt` CLI tests**

Use a temp repo with:

- one sound plan whose entry is `status: generated`;
- matching existing catalog entry;
- a different catalog entry that must remain unchanged.

Run:

```ts
const code = await runAudioCli([
  "revise-prompt",
  planPath,
  "bgm",
  "bgm_chapter_close",
], options);
expect(code).toBe(0);
```

Assert the catalog prompt equals the sound-plan prompt and cue/source Markdown files are untouched.

Add RED cases for wrong channel, missing plan entry, duplicate matching plan entry, non-approved/generated entry, and missing catalog entry.

- [ ] **Step 6: Implement the CLI subcommand**

`revise-prompt` must:

1. parse exactly three positional arguments;
2. load/validate the plan using existing helpers;
3. find exactly one matching `approved`/`generated` entry;
4. parse the existing audio catalog;
5. call `reviseExistingAudioCatalogPrompt()`;
6. serialize + Prettier-format with existing functions;
7. write only the catalog when text changed;
8. print `[audio] prompt revision OK: <channel>.<id>`.

It must not call `applyAudioCuesToMarkdown()`.

- [ ] **Step 7: Add package/root forwarding scripts**

`packages/scripts/package.json`:

```json
"audio:revise-prompt": "bun run audio/cli.ts revise-prompt"
```

Root `package.json`:

```json
"audio:revise-prompt": "bun run --cwd packages/scripts audio:revise-prompt"
```

- [ ] **Step 8: Prove the normal audio safety contract remains intact**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/audio/audio-catalog.test.ts packages/scripts/audio/cli.test.ts
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
```

Expected: PASS on unmodified mainline content.

- [ ] **Step 9: Commit Task 2**

```bash
git add packages/scripts/audio package.json packages/scripts/package.json
git commit -m "feat(audio): support focused prompt revisions"
```

---

### Task 3: Add known source-document reads and stale-safe backend apply/validation

**Files:**
- Modify/Test: `apps/layout-editor/src-tauri/Cargo.toml`
- Modify/Test: `apps/layout-editor/src-tauri/src/lib.rs`
- Modify: `apps/layout-editor/src/lib/workbench-types.ts`
- Modify: `apps/layout-editor/src/lib/workbench-api.ts`

**Interfaces:**
- Consumes: `SourceDocumentId`, source range/source slice produced by Task 1, `audio:revise-prompt` from Task 2.
- Produces frontend APIs:

```ts
export const loadWorkbenchSourceDocument = (sourceDocumentId: SourceDocumentId) =>
  invoke<WorkbenchSourceDocument>("load_workbench_source_document", {
    sourceDocumentId,
  });

export const applyWorkbenchSourceEdit = (
  request: ApplyWorkbenchSourceEditRequest,
) =>
  invoke<ApplyWorkbenchSourceEditResult>("apply_workbench_source_edit", {
    request,
  });
```

- [ ] **Step 1: Add wire types before implementation**

In `workbench-types.ts`, add the closed IDs/kinds/request/result from the design spec. Do not add generic path fields to the request.

```ts
export type SourceDocumentId =
  | `scene:${string}:${string}`
  | "asset-config:characters"
  | `audio-plan:${string}`;
```

`WorkbenchSourceDocument` includes `id`, repo-relative `path`, `content`, and SHA-256 `hash`.

- [ ] **Step 2: Write failing Rust source-document resolver tests**

Cover:

```rust
assert_eq!(
    resolve_source_document_at_root(&root, "asset-config:characters")?.relative_path,
    "static/assets/config/characters.yaml"
);
```

Also test one real temp-manifest-backed `scene:chapter_1:scene_0`, one `audio-plan:chapter_1`, malformed IDs containing `/` or `..`, unknown chapter/scene, and unsupported prefixes.

- [ ] **Step 3: Add SHA-256 dependency and implement read resolver**

`Cargo.toml`:

```toml
sha2 = "0.10"
```

In Rust, keep one private enum:

```rust
enum SourceDocumentKind {
    Scene { chapter_id: String, scene_id: String },
    Characters,
    AudioPlan { chapter_id: String },
}
```

Resolve scenes through existing manifest/canonical source helpers; characters through the fixed constant; audio plans only after chapter ID membership is proven by `load_manifest_chapters()`.

Hash exact UTF-8 source bytes with SHA-256.

- [ ] **Step 4: Run Rust tests for source reads**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml source_document
```

Expected: PASS.

- [ ] **Step 5: Write failing guarded-apply Rust tests**

Build a temp source and assert:

- stale hash returns `sourceEditStale` and bytes are unchanged;
- wrong semantic-ref prefix vs kind returns `sourceEditSemanticRefInvalid`;
- scene document + character target returns `sourceEditKindUnsupported`;
- out-of-range/invalid UTF-8 boundary returns `sourceEditRangeInvalid`;
- wrong original slice returns `sourceEditOriginalMismatch`;
- identical replacement returns `sourceEditNoChange`;
- a valid replacement modifies only `[start..end]`.

Use a request like:

```rust
ApplyWorkbenchSourceEditRequest {
    source_document_id: "scene:chapter_1:scene_0".into(),
    expected_hash,
    semantic_ref: "reader:dialogue:main:0".into(),
    kind: SourceEditKind::ReaderDialogue,
    range: SourceEditRange { start, end },
    original_source_text: "原本台詞".into(),
    replacement_source_text: "修正版台詞".into(),
}
```

- [ ] **Step 6: Generalize the existing atomic writer and implement guarded write**

Refactor the current same-directory temp-file + `rename` helper into a private text writer whose caller already owns canonical containment checks. Reuse it for layout sidecars and focused source edits; do not introduce a filesystem service layer.

Apply order must be exactly:

```text
resolve → read → hash → kind/ref check → range check → original slice check
→ construct next source → atomic write → validate
```

- [ ] **Step 7: Write failing validation-dispatch tests**

Extract a pure command-plan function so tests do not need to spawn Bun:

```rust
fn validation_plan(
    source: &ResolvedSourceDocument,
    kind: SourceEditKind,
    semantic_ref: &str,
) -> Result<Vec<ValidationCommand>, EditorError>;
```

Assert scene/character kinds produce only `bun run scenes:compile`.

Assert audio prompt produces, in order:

```text
bun run audio:revise-prompt <plan> <channel> <id>
bun run audio:validate <plan>
bun run audio:apply <plan> --check
bun run scenes:compile
```

The audio channel/id must come from the validated semantic ref, never a caller-supplied shell fragment.

- [ ] **Step 8: Implement fixed validation execution**

Use `std::process::Command`, `current_dir(canonical_root)`, and explicit args. Capture stdout/stderr and keep at most the last 200 lines per command.

Stop subsequent commands after the first non-zero exit and return `validation.ok = false` with the command/diagnostics. Do not roll back ordinary scene/character source edits.

For audio, `audio:revise-prompt` is the derived synchronization action and runs first after the sound-plan source write.

- [ ] **Step 9: Add Tauri commands + frontend wrappers**

Register exactly:

```text
load_workbench_source_document
apply_workbench_source_edit
```

No generic `read_file`, `write_file`, or `run_command` command is added.

- [ ] **Step 10: Run backend/frontend type gates**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
```

Expected: PASS.

- [ ] **Step 11: Commit Task 3**

```bash
git add apps/layout-editor/src-tauri apps/layout-editor/src/lib/workbench-types.ts apps/layout-editor/src/lib/workbench-api.ts
git commit -m "feat(workbench): add guarded focused source writes"
```

---

### Task 4: Build the reusable FocusedEdit draft, diff, and impact model

**Files:**
- Create/Test: `apps/layout-editor/src/lib/focused-edit.ts`
- Create/Test: `apps/layout-editor/src/lib/focused-edit.test.ts`
- Modify/Test: `apps/layout-editor/src/lib/asset-workspace.ts`
- Modify/Test: `apps/layout-editor/src/lib/asset-workspace.test.ts`

**Interfaces:**
- Consumes: source snapshots and `WorkbenchSourceTarget` from Task 1; typed manifest/`sceneUsages` from existing Assets.
- Produces:

```ts
export type FocusedEditImpact = {
  affectedScenes: Array<{ chapterId: string; sceneId: string }>;
  affectedAssetIds: string[];
  usageCount: number;
  shared: boolean;
  note: string | null;
};

export type FocusedEditDraft = {
  sourceDocumentId: SourceDocumentId;
  sourcePath: string;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  sourceRange: WorkbenchSourceRange;
  originalText: string;
  originalSourceText: string;
  replacementText: string;
  replacementSourceText: string;
  impact: FocusedEditImpact;
};

export function focusedEditDiff(
  source: string,
  draft: FocusedEditDraft,
): string;
```

- [ ] **Step 1: Write failing one-hunk diff tests**

Use a Markdown source with three context lines before/after. Assert output contains:

```text
--- a/docs/stories_plan/chapter_1/scene_0.md
+++ b/docs/stories_plan/chapter_1/scene_0.md
@@
-**相馬律**：舊台詞
+**相馬律**：新台詞
```

For YAML, assert the diff shows the actual block/plain scalar syntax, not only logical prompt text.

- [ ] **Step 2: Implement deterministic focused diff generation**

No new dependency. Split the immutable source into lines, map the stored range to its changed lines, include up to three unchanged context lines, and prefix the exact source path.

The diff is display-only; do not parse/apply it later.

- [ ] **Step 3: Write failing impact tests against `AssetWorkspace` fixtures**

Cover:

- one background used twice across two scenes → `usageCount: 2`, `shared: true`;
- evidence used once → `shared: false`;
- character expression uses existing `assetUsageGroups()` result;
- character visualPrompt gathers every typed manifest entry with matching `source.characterId` and joins those asset IDs to scene usages;
- audio uses typed `entry.source.channel/id`, never asset ID string parsing.

- [ ] **Step 4: Add narrow impact helpers to `asset-workspace.ts`**

Keep existing projections unchanged. Add only selection-time helpers, for example:

```ts
export function assetPromptImpact(
  workspace: AssetWorkspace,
  assetId: string,
): FocusedEditImpact;

export function characterVisualPromptImpact(
  workspace: AssetWorkspace,
  characterId: string,
): FocusedEditImpact;

export function audioPromptImpact(
  workspace: AssetWorkspace,
  channel: "bgm" | "bgs" | "sfx",
  id: string,
): FocusedEditImpact;
```

If sharing the `FocusedEditImpact` type here creates a circular import, keep raw impact facts in `asset-workspace.ts` and adapt them in `focused-edit.ts`; do not create a generic impact framework.

- [ ] **Step 5: Write failing draft construction/replacement tests**

Assert a draft copies `expectedHash`, semantic ref, exact original source slice, and receives rendered replacement source from Task 1.

No-change logical replacement must return a local `focusedEditNoChange` diagnostic and never produce an apply request.

- [ ] **Step 6: Implement draft construction**

Provide a small function:

```ts
export function buildFocusedEditDraft(input: {
  document: WorkbenchSourceDocument;
  target: WorkbenchSourceTarget;
  replacementText: string;
  impact: FocusedEditImpact;
}): FocusedEditDraftResult;
```

It calls `renderSourceReplacement()`, copies immutable snapshot identity, and does no I/O.

- [ ] **Step 7: Run pure model tests**

```bash
bunx vitest run --config apps/layout-editor/vitest.config.ts apps/layout-editor/src/lib/focused-edit.test.ts apps/layout-editor/src/lib/asset-workspace.test.ts
```

Use the repository's actual layout-editor Vitest config path if different. Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/layout-editor/src/lib/focused-edit.ts apps/layout-editor/src/lib/focused-edit.test.ts apps/layout-editor/src/lib/asset-workspace.ts apps/layout-editor/src/lib/asset-workspace.test.ts
git commit -m "feat(workbench): model reviewed focused edits"
```

---

### Task 5: Wire one shared review UI into Reader and Assets

**Files:**
- Create/Test: `apps/layout-editor/src/lib/FocusedEditReview.svelte`
- Create/Test: `apps/layout-editor/src/lib/FocusedEditReview.test.ts`
- Modify/Test: `apps/layout-editor/src/lib/reader-projection.ts`
- Modify/Test: `apps/layout-editor/src/lib/reader-projection.test.ts`
- Modify/Test: `apps/layout-editor/src/lib/ReaderView.svelte`
- Modify/Test: `apps/layout-editor/src/lib/ReaderView.test.ts`
- Modify/Test: `apps/layout-editor/src/lib/AssetsView.svelte`
- Modify/Test: `apps/layout-editor/src/lib/AssetsView.test.ts`
- Modify/Test: `apps/layout-editor/src/App.svelte`
- Modify/Test: `apps/layout-editor/src/App.test.ts`

**Interfaces:**
- Consumes: `loadWorkbenchSourceDocument()`, Task 1 source target index, Task 4 draft/impact functions, `applyWorkbenchSourceEdit()`.
- Produces one authoring seam:

```ts
export type FocusedEditSelection =
  | {
      surface: "reader";
      sourceDocumentId: SourceDocumentId;
      semanticRef: string;
    }
  | {
      surface: "asset";
      sourceDocumentId: SourceDocumentId;
      semanticRef: string;
      assetId: string | null;
    };
```

HPA-136 later opens the same resolved edit with an optional replacement; no AI-specific mutation callback is introduced here.

- [ ] **Step 1: Write failing Reader projection identity tests**

Given one group with line/action/sceneTag, assert only line/action carry editable identity:

```ts
expect(line.editRef).toEqual({ carrierId: "main", itemIndex: 0 });
expect(action.editRef).toEqual({ carrierId: "main", itemIndex: 1 });
expect(sceneTag.editRef).toBeUndefined();
```

- [ ] **Step 2: Preserve carrier/item identity in Reader projection**

Add `ReaderEditableRef` only to projected line/action Reader items. Change `carrierGroup()` to pass its existing `id` + array index into `projectDialogue()`; do not alter `deriveDialogueSegments()`, carrier IDs, or runtime JSON.

- [ ] **Step 3: Write failing ReaderView edit-button test**

Render a Reader scene and assert:

- Edit line button exists;
- Edit action button exists;
- scene tag/notice have no Edit button;
- callback receives exact carrier/item semantic identity.

- [ ] **Step 4: Implement ReaderView edit callbacks**

Add one prop:

```ts
onEdit?: (selection: ReaderEditSelection) => void;
```

Use compact Edit buttons beside eligible items. Reader remains readable with no callback; do not add inline textareas inside ReaderView.

- [ ] **Step 5: Write failing Assets affordance tests**

Cover:

- scene-owned background `{chapterId,sceneId,unitId}` shows Edit source prompt;
- global/character-owned background does not;
- evidence `{evidenceId}` shows Edit source prompt;
- character non-null visualPrompt and each expression prompt show Edit;
- `visualPrompt: null` does not create an Add/Edit action;
- audio with resolvable chapter plan shows Edit source prompt;
- shared impact warning is passed to review data.

- [ ] **Step 6: Implement Assets edit callbacks without another editor state**

Add `onEdit` prop to `AssetsView`. Reuse its current selected entry, manifest source, character rows, scene usage rows, and existing chapter/scene selection.

The callback identifies the semantic target only. AssetsView must not load/write source itself.

- [ ] **Step 7: Write failing FocusedEditReview component tests**

Render states for:

```text
editing
applying
applied-valid
applied-invalid
stale/error
```

Assert current/replacement/source path/semantic ref/diff/impact are visible; Apply disabled for no-change/applying; stale error exposes Reload Source; Cancel closes the draft; there is no proposal list/history/undo.

- [ ] **Step 8: Implement `FocusedEditReview.svelte`**

Use one textarea/input for logical replacement, a `<pre>` for exact diff, impact list, validation results, Apply/Cancel/Reload actions.

Do not add a generic modal framework if the app does not already have one; a fixed review panel/dialog local to `App.svelte` is enough.

- [ ] **Step 9: Write failing App handoff tests**

Mock `workbench-api` and prove:

1. Reader Edit → App loads `scene:<chapter>:<scene>` source → resolves semantic target → opens one shared review.
2. Assets character Edit → App loads `asset-config:characters` → resolves target → same review.
3. Apply sends exact `expectedHash`, semantic ref, range, original source slice, reviewed replacement source slice.
4. stale result triggers reload path and no local fake apply.
5. successful Reader edit reloads scene bundle.
6. successful Assets edit refreshes Assets snapshot.
7. validation failure remains visible as applied-invalid and does not pretend generated projection refreshed successfully.

- [ ] **Step 10: Implement one active focused-edit state in App**

Keep state local and narrow, for example:

```ts
type FocusedEditState =
  | { status: "idle" }
  | { status: "loading-source"; selection: FocusedEditSelection }
  | { status: "editing"; document: WorkbenchSourceDocument; target: WorkbenchSourceTarget; draft: FocusedEditDraft }
  | { status: "applying"; draft: FocusedEditDraft }
  | { status: "applied-valid"; result: ApplyWorkbenchSourceEditResult }
  | { status: "applied-invalid"; result: ApplyWorkbenchSourceEditResult }
  | { status: "error"; message: string; stale: boolean };
```

Do not introduce a generic Workbench store/state machine.

- [ ] **Step 11: Add the HPA-136 handoff seam**

Export a small resolver/open function from the focused-edit module or App-owned helper that can accept an optional initial replacement for an already-resolved semantic target.

The public contract must still require the human review component before `applyWorkbenchSourceEdit()` is called.

- [ ] **Step 12: Run UI/projection tests**

```bash
bun run editor:check
bun run --cwd apps/layout-editor test
```

If the app package uses Turbo-only test entrypoints, run the equivalent existing layout-editor test command plus the focused Vitest files.

Expected: PASS.

- [ ] **Step 13: Commit Task 5**

```bash
git add apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts apps/layout-editor/src/lib/FocusedEditReview.svelte apps/layout-editor/src/lib/FocusedEditReview.test.ts apps/layout-editor/src/lib/ReaderView.svelte apps/layout-editor/src/lib/ReaderView.test.ts apps/layout-editor/src/lib/AssetsView.svelte apps/layout-editor/src/lib/AssetsView.test.ts apps/layout-editor/src/lib/reader-projection.ts apps/layout-editor/src/lib/reader-projection.test.ts apps/layout-editor/src/lib/workbench-types.ts
git commit -m "feat(workbench): review and apply focused source edits"
```

---

### Task 6: Add real Chapter 1 discovery coverage and run the full HPA-135 gate

**Files:**
- Create: `apps/layout-editor/scripts/verify-focused-edit-real-content.ts`
- Modify: `apps/layout-editor/package.json`
- Modify tests/docs only if final verification exposes an actual issue; do not add speculative infrastructure.

**Interfaces:**
- Consumes all HPA-135 read-only target indexing/projection APIs.
- Produces one deterministic read-only verification script; it never invokes apply/write.

- [ ] **Step 1: Write the real-content verifier**

The script loads/compiles the existing Chapter 1 corpus using repository-owned helpers and asserts all seven target families resolve from real content without mutation:

```ts
assert(findTarget("reader:dialogue:"), "missing Reader dialogue edit target");
assert(findTarget("reader:action:"), "missing Reader action edit target");
assert(findTarget("asset:background:"), "missing Background Prompt target");
assert(
  findTarget("asset:evidence:")?.semanticRef.endsWith(":imagePrompt"),
  "missing evidence Image Prompt target",
);
assert(characterTargets.some((t) => t.semanticRef === "asset:character:soma_ritsu:visualPrompt"));
assert(
  characterTargets.some(
    (t) =>
      t.semanticRef ===
      "asset:character:soma_ritsu:expression:standard:prompt",
  ),
);
assert(
  audioTargets.some(
    (t) => t.semanticRef.startsWith("asset:audio:") && t.kind === "audioPrompt",
  ),
);
```

Hash/check the relevant source files before and after the script or simply ensure the script has no write imports/calls; do not exercise real source mutation in this gate.

- [ ] **Step 2: Add a package script**

Example:

```json
"verify:focused-edit-real-content": "bun run scripts/verify-focused-edit-real-content.ts"
```

- [ ] **Step 3: Run the real-content gate**

```bash
bun run scenes:compile
bun run --cwd apps/layout-editor verify:focused-edit-real-content
```

Expected: PASS and logs identifying one real target for each supported family.

- [ ] **Step 4: Run audio ownership gates with concrete plan path**

```bash
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
```

Expected: PASS.

- [ ] **Step 5: Run the complete automated suite**

```bash
bun run editor:check
bun run editor:build
bun run test:scripts
bun run lint:all
```

Expected: PASS.

- [ ] **Step 6: Perform one temp-workspace/manual Workbench smoke without touching Chapter 1 source**

Use a throwaway git worktree or fixture workspace, not the main checkout. Exercise:

```text
Reader line Edit
→ type replacement
→ inspect exact Markdown diff
→ Apply
→ compile validation visible
```

Then exercise one character prompt and one audio prompt in the throwaway workspace. Confirm audio review names the sound-plan authored source and derived `audio.yaml` synchronization.

Do not regenerate media or call a network provider.

- [ ] **Step 7: Self-review against the design acceptance list**

Check each item explicitly:

```text
7 target kinds only
one active draft
exact diff before apply
no frontend path write
hash + original slice stale guards
fixed validation dispatch
shared impact warnings
audio sound-plan ownership
production JSON unchanged
no undo/history/queue/AI/general editor
HPA-136 can reuse same review/apply seam
```

Remove any accidental generic abstraction or unsupported edit button discovered during review.

- [ ] **Step 8: Commit final verifier/cleanup**

```bash
git add apps/layout-editor/scripts/verify-focused-edit-real-content.ts apps/layout-editor/package.json
git commit -m "test(workbench): verify focused edits on chapter 1"
```

---

## Plan self-review

### Spec coverage

- Reader dialogue/action: Tasks 1 and 5.
- Background/evidence prompt: Tasks 1, 4, and 5.
- Character visual/expression prompt: Tasks 1, 4, and 5.
- Audio prompt through owner: Tasks 1, 2, 3, and 5.
- Exact diff/review: Tasks 4 and 5.
- SourceDocumentId/no arbitrary path: Task 3.
- expectedHash/original slice/range stale guard: Task 3.
- Authoritative validation: Tasks 2 and 3.
- Shared usage impact: Task 4.
- No queue/history/undo/general editor: global constraints + Task 5 review.
- HPA-136 reuse seam: Task 5.
- Real Chapter 1 proof: Task 6.

### Scope pressure check

The plan deliberately does **not** add:

- source editing to Plan mode;
- production source-location fields;
- a generic source registry service;
- a general-purpose diff library;
- a general-purpose command runner;
- source merge/rebase;
- Workbench history or undo;
- audio cue/source-plan redesign;
- AI/provider work.

The only new cross-cutting seam is the exact one HPA-135/HPA-136 need: a resolved semantic source target → reviewed `FocusedEditDraft` → guarded apply.

### Type consistency check

The implementation should use the same names throughout all tasks:

```text
SourceDocumentId
WorkbenchSourceDocument
WorkbenchSourceRange
WorkbenchSourceTargetKind
WorkbenchSourceTarget
FocusedEditImpact
FocusedEditDraft
ApplyWorkbenchSourceEditRequest
ApplyWorkbenchSourceEditResult
FocusedEditReview
```

Do not rename one layer to proposal/change/patch while another still uses focused edit; that would create a second conceptual model for the same one-edit flow.

## Execution handoff

Implementation remains on this same HPA-135 branch/PR.

Recommended execution mode: **subagent-driven development** task-by-task, with review after each task and the full Task 6 gate before marking the PR ready for review.
