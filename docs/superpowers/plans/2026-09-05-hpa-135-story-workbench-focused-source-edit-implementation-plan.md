# HPA-135 Story Workbench Focused Source Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Story Workbench's first human-controlled source write path: edit one supported Reader/Assets value, review its exact authored-source diff and impact, apply it through a stale-safe fixed-domain backend, and show authoritative validation.

**Architecture:** Reader/Assets stay selection and impact owners. A filesystem-free `@lyra/scripts` source-target index maps the seven supported semantic refs to exact authored source ranges without changing runtime scene JSON; one `FocusedEditDraft` and one `FocusedEditReview` own review UX; Rust resolves only known source documents, converts UTF-16 source offsets to safe UTF-8 byte ranges, guards hash/range/original slice, performs one atomic write, and runs fixed validation. Audio prompt edits target the durable chapter sound plan and use a narrow audio-owned revision command to synchronize only the matching catalog prompt.

**Tech Stack:** TypeScript 5.6 + Vitest, Svelte 5 + Testing Library, Tauri 2 / Rust 2021, `yaml` 2.9 through `@lyra/scripts`, Bun 1.3.1, existing compile-scenes and audio CLIs.

**Spec:** `docs/superpowers/specs/2026-09-05-hpa-135-story-workbench-focused-source-edit-design.md`

## Global Constraints

- One ticket, one PR: implement on this same HPA-135 PR.
- Exactly seven editable kinds: Reader dialogue, Reader action, scene Background Prompt, evidence Image Prompt, character visualPrompt, character expression prompt, existing audio prompt.
- No arbitrary frontend path/field, general Markdown/YAML editor, proposal queue, autosave, history model, Workbench Undo, AI provider, or Git automation.
- Do not add authoring ranges/metadata to production scene JSON or the game runtime schema.
- Compiler/tooling owns authored syntax discovery; the layout editor must not create a second scene/YAML grammar.
- `WorkbenchSourceRange.start/end` are JavaScript UTF-16 code-unit offsets. Rust must convert them before slicing UTF-8 strings.
- Audio prompt edits target `docs/audio_plans/<chapterId>.sound-plan.yaml`; Workbench never directly writes `static/assets/config/audio.yaml`.
- Keep normal `audio:apply` duplicate/conflict behavior unchanged.
- Backend chooses validation commands; frontend never supplies a shell command.
- A failed validator after a successful write is **Applied, validation failed**; do not imply rollback.

---

## File Map

### Create

- `packages/scripts/workbench/source-edit-targets.ts`
- `packages/scripts/workbench/source-edit-targets.test.ts`
- `apps/layout-editor/src/lib/focused-edit.ts`
- `apps/layout-editor/src/lib/focused-edit.test.ts`
- `apps/layout-editor/src/lib/FocusedEditReview.svelte`
- `apps/layout-editor/src/lib/FocusedEditReview.test.ts`
- `apps/layout-editor/scripts/verify-focused-edit-real-content.ts`

### Modify

- `packages/scripts/compile-scenes/tokenizer.ts`
- `packages/scripts/compile-scenes/tokenizer.test.ts`
- `packages/scripts/audio/audio-catalog.ts`
- `packages/scripts/audio/audio-catalog.test.ts`
- `packages/scripts/audio/cli.ts`
- `packages/scripts/audio/cli.test.ts`
- `packages/scripts/package.json`
- `package.json`
- `apps/layout-editor/src-tauri/Cargo.toml`
- `apps/layout-editor/src-tauri/src/lib.rs`
- `apps/layout-editor/src/lib/workbench-types.ts`
- `apps/layout-editor/src/lib/workbench-api.ts`
- `apps/layout-editor/src/lib/reader-projection.ts`
- `apps/layout-editor/src/lib/reader-projection.test.ts`
- `apps/layout-editor/src/lib/ReaderView.svelte`
- `apps/layout-editor/src/lib/ReaderView.test.ts`
- `apps/layout-editor/src/lib/asset-workspace.ts`
- `apps/layout-editor/src/lib/asset-workspace.test.ts`
- `apps/layout-editor/src/lib/AssetsView.svelte`
- `apps/layout-editor/src/lib/AssetsView.test.ts`
- `apps/layout-editor/src/App.svelte`
- `apps/layout-editor/src/App.test.ts`
- `apps/layout-editor/package.json`

---

### Task 1: Build compiler-owned semantic source target indexing

**Files:**
- Create: `packages/scripts/workbench/source-edit-targets.ts`
- Create/Test: `packages/scripts/workbench/source-edit-targets.test.ts`
- Modify: `packages/scripts/compile-scenes/tokenizer.ts`
- Test: `packages/scripts/compile-scenes/tokenizer.test.ts`

**Interfaces:**
- Consumes: existing `tokenize()`, `deriveDialogueSegments()`, compiled scene payloads, scripts-owned `yaml`.
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

- [ ] **Step 1: Add RED tokenizer range tests**

Add cases proving every token can retain its exact raw source span, including a multi-line action.

```ts
it("tracks exact UTF-16 source ranges", () => {
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
});
```

- [ ] **Step 2: Run the tokenizer test and verify RED**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/tokenizer.test.ts
```

Expected: FAIL because tokens do not expose `range`.

- [ ] **Step 3: Add tokenizer source ranges without changing parser semantics**

Add:

```ts
export type SourceTokenRange = {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
};
```

`start/end` must be JavaScript string indices (UTF-16 code units), so `source.slice(start, end)` returns the exact raw token. Track line-start offsets while tokenizing; multi-line bracket actions include the closing `]` and closing line.

Do not change normalized token text, heading/metadata parsing, or dialogue/action grammar.

- [ ] **Step 4: Run tokenizer tests and verify GREEN**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/tokenizer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add RED scene target-index tests**

Create a small compiled-scene fixture and authored Markdown that contains a line, action, scene-tag Background Prompt, structural Background Prompt, and evidence Image Prompt.

Assert exact semantic refs:

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

Add a mismatch fixture where compiled dialogue and authored tokens differ. It must return `workbenchSourceDialogueMismatch` and emit no guessed Reader edit targets.

- [ ] **Step 6: Implement scene indexing by reusing tokenizer + Reader carrier traversal**

Implementation rules:

```text
tokenize authored source
+ deriveDialogueSegments compiled scene
→ flatten both in authored traversal order
→ require matching sceneTag/action/line kinds and text/speaker
→ emit only line/action edit targets
```

For line targets, range only the dialogue text after `：`; speaker/expression markup stays untouched.

For action targets, range only bracket contents; `[` and `]` stay untouched.

For prompts:

- count scene tags with the existing enrichment convention `tag_001`, `tag_002`, ...;
- map existing `Background Prompt` metadata to scene-tag or structural unit identity;
- map an existing evidence `Image Prompt` to its enclosing `evidence:<id>` block;
- emit no generic metadata target.

- [ ] **Step 7: Add RED YAML source-target tests**

Characters fixture:

```ts
const source = `characters:
  - id: soma_ritsu
    visualPrompt: >
      first line
      second line
    expressions:
      standard:
        prompt: calm focused expression
`;
```

Assert:

```ts
expect(byRef.get("asset:character:soma_ritsu:visualPrompt")?.currentText).toContain(
  "first line",
);
expect(
  byRef.get("asset:character:soma_ritsu:expression:standard:prompt")?.currentText,
).toBe("calm focused expression");
```

Sound-plan fixture must have two entries and resolve exactly one `asset:audio:<channel>:<id>:prompt` target for an existing `generated` entry. Add missing, duplicate, and non-`approved`/`generated` rejection tests.

- [ ] **Step 8: Implement character/audio YAML indexing with node ranges**

Use `YAML.parseDocument()` and locate owners by parsed character/expression ID or `(channel,id)`. Replace only the selected scalar span.

Do not stringify the full YAML document. Preserve block-vs-quoted-vs-plain scalar style for the selected scalar; quote only the selected scalar when a replacement cannot remain a safe plain scalar.

- [ ] **Step 9: Add replacement rendering tests**

Cover:

```text
dialogue newline → workbenchSourceReplacementInvalid
action multiline → allowed, brackets preserved
Background/Image Prompt newline → rejected for current Markdown metadata grammar
character block scalar → remains block scalar
expression/audio scalar → remains valid YAML
```

- [ ] **Step 10: Run Task 1 test gates**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/workbench/source-edit-targets.test.ts
bun run test:scripts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

```bash
git add packages/scripts/compile-scenes/tokenizer.ts packages/scripts/compile-scenes/tokenizer.test.ts packages/scripts/workbench/source-edit-targets.ts packages/scripts/workbench/source-edit-targets.test.ts
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

- [ ] **Step 1: Add RED catalog revision tests**

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

Add missing-entry rejection. Keep a regression proving `mergeApprovedEntriesIntoCatalog()` still reports its existing duplicate conflict when a normal approved/generated plan attempts to change an existing catalog prompt.

- [ ] **Step 2: Run the catalog test and verify RED**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/audio/audio-catalog.test.ts
```

Expected: FAIL because the revision helper does not exist.

- [ ] **Step 3: Implement the pure one-entry catalog helper**

Clone the catalog maps, require `(channel,id)` to exist, replace only `prompt`, and preserve that entry's exact `loop` boolean. Do not route this helper through normal merge semantics.

- [ ] **Step 4: Run the catalog test and verify GREEN**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/audio/audio-catalog.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add RED `audio:revise-prompt` CLI tests**

Use a temp repo with a generated sound-plan entry and matching catalog entry:

```ts
const code = await runAudioCli(
  ["revise-prompt", planPath, "bgm", "bgm_chapter_close"],
  options,
);
expect(code).toBe(0);
```

Assert:

```text
matching catalog prompt == sound-plan prompt
matching catalog loop unchanged
other catalog entries unchanged after canonical formatting
scene Markdown untouched
```

Add rejection tests for invalid channel, missing plan entry, duplicate matching plan entry, non-approved/generated entry, and missing catalog entry.

- [ ] **Step 6: Implement `revise-prompt`**

The command must:

1. parse exactly plan path + channel + id;
2. load/validate plan with existing helpers;
3. require exactly one matching `approved`/`generated` entry;
4. read that entry's already-edited prompt;
5. parse existing audio catalog;
6. call `reviseExistingAudioCatalogPrompt()`;
7. serialize + Prettier-format via existing functions;
8. write the catalog only when changed;
9. print `[audio] prompt revision OK: <channel>.<id>`.

It must never call `applyAudioCuesToMarkdown()`.

- [ ] **Step 7: Add forwarding scripts**

`packages/scripts/package.json`:

```json
"audio:revise-prompt": "bun run audio/cli.ts revise-prompt"
```

Root `package.json`:

```json
"audio:revise-prompt": "bun run --cwd packages/scripts audio:revise-prompt"
```

- [ ] **Step 8: Run Task 2 gates**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/audio/audio-catalog.test.ts packages/scripts/audio/cli.test.ts
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add packages/scripts/audio package.json packages/scripts/package.json
git commit -m "feat(audio): support focused prompt revisions"
```

---

### Task 3: Add known source reads and guarded backend apply/validation

**Files:**
- Modify/Test: `apps/layout-editor/src-tauri/Cargo.toml`
- Modify/Test: `apps/layout-editor/src-tauri/src/lib.rs`
- Modify: `apps/layout-editor/src/lib/workbench-types.ts`
- Modify: `apps/layout-editor/src/lib/workbench-api.ts`

**Interfaces:**
- Consumes: Task 1 UTF-16 source ranges, Task 2 `audio:revise-prompt`.
- Produces:

```ts
export type SourceDocumentId =
  | `scene:${string}:${string}`
  | "asset-config:characters"
  | `audio-plan:${string}`;

export type WorkbenchSourceDocument = {
  id: SourceDocumentId;
  path: string;
  content: string;
  hash: string;
};

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

- [ ] **Step 1: Add wire types**

Add source document, source range, edit request/result, and validation diagnostic types to `workbench-types.ts`. Request range is explicitly UTF-16:

```ts
export type ApplyWorkbenchSourceEditRequest = {
  sourceDocumentId: SourceDocumentId;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  range: { start: number; end: number };
  originalSourceText: string;
  replacementSourceText: string;
};
```

Do not put an arbitrary path or command in this request.

- [ ] **Step 2: Add RED Rust source resolver/hash tests**

Name these tests with `focused_source_` prefix so the task can run them directly.

Cover:

```rust
assert_eq!(
    resolve_source_document_at_root(&root, "asset-config:characters")?.relative_path,
    "static/assets/config/characters.yaml"
);
```

Also cover one manifest-backed `scene:chapter_1:scene_0`, one `audio-plan:chapter_1`, malformed IDs with `/` or `..`, unknown chapter/scene, unsupported prefixes, and SHA-256 changing when source changes.

- [ ] **Step 3: Add SHA-256 dependency and implement fixed-domain source reads**

`apps/layout-editor/src-tauri/Cargo.toml`:

```toml
sha2 = "0.10"
```

Use one private enum:

```rust
enum SourceDocumentKind {
    Scene { chapter_id: String, scene_id: String },
    Characters,
    AudioPlan { chapter_id: String },
}
```

Resolve scenes through existing manifest/canonical source helpers; characters through fixed config constant; audio plan only after proving chapter membership with `load_manifest_chapters()`.

Hash exact UTF-8 source bytes and return lowercase hex.

- [ ] **Step 4: Run source resolver/hash tests and verify GREEN**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml focused_source
```

Expected: PASS for resolver/hash tests added so far.

- [ ] **Step 5: Add RED UTF-16 range conversion tests**

Add a private helper contract:

```rust
fn utf16_range_to_byte_range(
    source: &str,
    start: usize,
    end: usize,
) -> Result<std::ops::Range<usize>, EditorError>
```

Tests must prove CJK/emoji correctness:

```rust
let source = "前🙂後台詞";
// "前" = 1 UTF-16 unit, 🙂 = 2, "後" = 1.
let range = utf16_range_to_byte_range(source, 4, 6).unwrap();
assert_eq!(&source[range], "台詞");
assert!(utf16_range_to_byte_range(source, 2, 6).is_err()); // midpoint of 🙂 pair
```

- [ ] **Step 6: Implement exact UTF-16 → UTF-8 range conversion**

Walk `source.char_indices()`, accumulating `ch.len_utf16()`. Map only exact accumulated boundaries to byte offsets. Reject reversed/out-of-bounds ranges and any requested boundary inside a multi-unit scalar.

Never use request `start/end` directly as Rust byte indices.

- [ ] **Step 7: Add RED guarded-apply tests**

Use temp source files and requests like:

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

Assert:

```text
stale hash → sourceEditStale + no write
wrong ref/kind → sourceEditSemanticRefInvalid + no write
wrong document/kind → sourceEditKindUnsupported + no write
bad UTF-16 range → sourceEditRangeInvalid + no write
wrong original slice → sourceEditOriginalMismatch + no write
same replacement → sourceEditNoChange + no write
valid replacement → exactly one slice changes
```

- [ ] **Step 8: Generalize the existing atomic writer and implement guarded write**

Refactor the existing same-directory temp-file + rename implementation into one private helper that accepts an already-resolved canonical path and text. Reuse it for layout sidecars and HPA-135.

Apply order is fixed:

```text
resolve → read → hash → ref/kind/document check
→ UTF-16 range conversion → original slice check
→ build next source → atomic write → validation
```

Do not add a generic filesystem service.

- [ ] **Step 9: Add RED fixed validation-dispatch tests**

Extract a pure command-plan helper:

```rust
fn validation_plan(
    source: &ResolvedSourceDocument,
    kind: SourceEditKind,
    semantic_ref: &str,
) -> Result<Vec<ValidationCommand>, EditorError>;
```

Scene/character kinds must produce:

```text
bun run scenes:compile
```

Audio prompt must produce, in order:

```text
bun run audio:revise-prompt <plan> <channel> <id>
bun run audio:validate <plan>
bun run audio:apply <plan> --check
bun run scenes:compile
```

Channel/id come from validated semantic ref, not caller-supplied arguments.

- [ ] **Step 10: Implement validation execution**

Use `std::process::Command` with explicit executable/args and `current_dir(canonical_root)`. No shell string.

Capture stdout/stderr and retain at most the last 200 lines per command. Stop after the first non-zero command. Return `validation.ok = false` and diagnostics without pretending the already-written source was rolled back.

- [ ] **Step 11: Register exactly two Tauri commands and frontend wrappers**

```text
load_workbench_source_document
apply_workbench_source_edit
```

Do not add generic `read_file`, `write_file`, or `run_command` commands.

- [ ] **Step 12: Run Task 3 gates**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml focused_source
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
```

Expected: PASS.

- [ ] **Step 13: Commit Task 3**

```bash
git add apps/layout-editor/src-tauri apps/layout-editor/src/lib/workbench-types.ts apps/layout-editor/src/lib/workbench-api.ts
git commit -m "feat(workbench): add guarded focused source writes"
```

---

### Task 4: Build FocusedEdit draft, diff, and impact projection

**Files:**
- Create/Test: `apps/layout-editor/src/lib/focused-edit.ts`
- Create/Test: `apps/layout-editor/src/lib/focused-edit.test.ts`
- Modify/Test: `apps/layout-editor/src/lib/asset-workspace.ts`
- Modify/Test: `apps/layout-editor/src/lib/asset-workspace.test.ts`

**Interfaces:**
- Consumes: `WorkbenchSourceDocument`, Task 1 `WorkbenchSourceTarget`, existing typed manifest/`sceneUsages`.
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

export function buildFocusedEditDraft(input: {
  document: WorkbenchSourceDocument;
  target: WorkbenchSourceTarget;
  replacementText: string;
  impact: FocusedEditImpact;
}): FocusedEditDraftResult;

export function focusedEditDiff(
  source: string,
  draft: FocusedEditDraft,
): string;
```

- [ ] **Step 1: Add RED exact diff tests**

Use a source whose target is after Japanese text so UTF-16 ranges are exercised naturally.

Assert:

```text
--- a/docs/stories_plan/chapter_1/scene_0.md
+++ b/docs/stories_plan/chapter_1/scene_0.md
@@
-**相馬律**：舊台詞
+**相馬律**：新台詞
```

YAML test must show the actual scalar syntax, not only logical prompt text.

- [ ] **Step 2: Implement deterministic one-hunk diff generation**

No new dependency. Use the immutable source + UTF-16 range + replacement source slice, preserving exact syntax and up to three unchanged context lines before/after.

Do not parse/apply this diff later.

- [ ] **Step 3: Add RED impact tests**

Fixtures must cover:

```text
background used twice across two scenes → usageCount 2, shared true
evidence used once → shared false
character expression → existing assetUsageGroups scene/usage data
character visualPrompt → every typed manifest source with matching characterId
audio prompt → typed source.channel/id join, no asset ID parsing
```

- [ ] **Step 4: Implement narrow impact helpers in `asset-workspace.ts`**

Add only selection-time helpers required by HPA-135. Reuse `sceneUsages`, typed manifest source, and `assetUsageGroups()`.

If `focused-edit.ts` importing `asset-workspace.ts` would form a circular dependency, return a small raw impact facts object from `asset-workspace.ts` and adapt it in `focused-edit.ts`. Do not build a generic impact framework.

- [ ] **Step 5: Add RED draft construction/no-change tests**

Assert draft copies:

```text
expectedHash
semanticRef
UTF-16 sourceRange
exact originalSourceText
rendered replacementSourceText
impact
```

A replacement equal to `target.currentText` returns `focusedEditNoChange` and cannot produce an apply request.

- [ ] **Step 6: Implement draft construction using Task 1 renderer**

`buildFocusedEditDraft()` calls `renderSourceReplacement()` and performs no I/O.

- [ ] **Step 7: Run Task 4 tests**

```bash
bun run --cwd apps/layout-editor test
```

Expected: PASS.

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
- Consumes: Task 3 source APIs, Task 1 target index, Task 4 draft/impact functions.
- Produces one `FocusedEditSelection` handoff and one shared human review/apply path.

- [ ] **Step 1: Add RED Reader projection identity tests**

Only line/action carry edit identity:

```ts
expect(line.editRef).toEqual({ carrierId: "main", itemIndex: 0 });
expect(action.editRef).toEqual({ carrierId: "main", itemIndex: 1 });
expect(sceneTag.editRef).toBeUndefined();
```

- [ ] **Step 2: Preserve carrier/item identity in Reader projection**

Add:

```ts
export type ReaderEditableRef = {
  carrierId: string;
  itemIndex: number;
};
```

Pass the existing carrier ID + item index through `projectDialogue()` only for projected line/action items. Do not modify runtime JSON or carrier derivation.

- [ ] **Step 3: Add RED ReaderView edit tests**

Assert:

```text
line → Edit button
action → Edit button
sceneTag/notice → no Edit button
callback → exact carrierId/itemIndex
```

- [ ] **Step 4: Implement ReaderView edit callback**

Add one optional prop:

```ts
onEdit?: (selection: ReaderEditSelection) => void;
```

Reader stays readable without the callback. Do not add inline source textareas inside ReaderView.

- [ ] **Step 5: Add RED Assets edit-affordance tests**

Assert:

```text
scene-owned background with unitId → Edit source prompt
scene-owned evidence with evidenceId → Edit source prompt
global/character-owned background → no HPA-135 prompt edit
character non-null visualPrompt → Edit
character expression prompt → Edit
visualPrompt null → no Add/Edit action
resolvable audio sound-plan prompt → Edit source prompt
shared prompt → impact warning shown in review data
```

- [ ] **Step 6: Implement Assets edit callback using existing typed source/usage data**

Add one `onEdit` prop. AssetsView identifies the semantic target and affected asset context only; it does not read/write source itself.

- [ ] **Step 7: Add RED FocusedEditReview tests**

Render each state:

```text
editing
applying
applied-valid
applied-invalid
stale/error
```

Assert source path, semantic ref, current/replacement, exact diff, usage impact, shared warning, Apply/Cancel, Reload Source on stale, validation output, and no queue/history/undo controls.

- [ ] **Step 8: Implement `FocusedEditReview.svelte`**

Use one replacement textarea/input, `<pre>` exact diff, impact summary, validation result, and Apply/Cancel/Reload actions. Use local component/App styling; do not create a generic modal framework.

- [ ] **Step 9: Add RED App integration tests**

Mock `workbench-api` and prove:

```text
Reader Edit
→ load scene source document
→ resolve semantic target
→ open shared review

Character Edit
→ load asset-config:characters
→ resolve semantic target
→ same review

Apply
→ sends expectedHash + semanticRef + kind + UTF-16 range
  + originalSourceText + reviewed replacementSourceText
```

Also cover:

```text
sourceEditStale → Reload Source path, no local fake apply
successful Reader edit → reload selected scene bundle
successful Assets edit → refresh asset workspace
validation failure → applied-invalid remains visible; no false generated refresh
```

- [ ] **Step 10: Implement one active focused-edit state in App**

Use a small discriminated union:

```ts
type FocusedEditState =
  | { status: "idle" }
  | { status: "loading-source"; selection: FocusedEditSelection }
  | {
      status: "editing";
      document: WorkbenchSourceDocument;
      target: WorkbenchSourceTarget;
      draft: FocusedEditDraft;
    }
  | { status: "applying"; draft: FocusedEditDraft }
  | { status: "applied-valid"; result: ApplyWorkbenchSourceEditResult }
  | { status: "applied-invalid"; result: ApplyWorkbenchSourceEditResult }
  | { status: "error"; message: string; stale: boolean };
```

Do not add a generic Workbench state machine/store.

- [ ] **Step 11: Expose the HPA-136 reuse seam**

Expose one resolved-target opening function with optional initial replacement:

```ts
openFocusedEdit(target, initialReplacement?)
```

It must still land in `FocusedEditReview` before any call to `applyWorkbenchSourceEdit()`.

- [ ] **Step 12: Run Task 5 gates**

```bash
bun run --cwd apps/layout-editor test
bun run editor:check
```

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

**Interfaces:**
- Consumes all HPA-135 read-only target indexing/projection APIs.
- Produces one deterministic read-only real-content gate; it never invokes apply/write.

- [ ] **Step 1: Implement the real-content verifier**

Load current Chapter 1 source/projections through repository-owned helpers and assert at least one target from every supported family:

```ts
assert(findTarget("reader:dialogue:"), "missing Reader dialogue edit target");
assert(findTarget("reader:action:"), "missing Reader action edit target");
assert(findTarget("asset:background:"), "missing Background Prompt target");
assert(
  findTarget("asset:evidence:")?.semanticRef.endsWith(":imagePrompt"),
  "missing evidence Image Prompt target",
);
assert(
  characterTargets.some(
    (target) => target.semanticRef === "asset:character:soma_ritsu:visualPrompt",
  ),
);
assert(
  characterTargets.some(
    (target) =>
      target.semanticRef ===
      "asset:character:soma_ritsu:expression:standard:prompt",
  ),
);
assert(
  audioTargets.some(
    (target) => target.semanticRef.startsWith("asset:audio:") && target.kind === "audioPrompt",
  ),
);
```

The script imports no write/apply API and does not mutate authored files.

- [ ] **Step 2: Add the package verifier script**

`apps/layout-editor/package.json`:

```json
"verify:focused-edit-real-content": "bun run scripts/verify-focused-edit-real-content.ts"
```

- [ ] **Step 3: Run real-content discovery**

```bash
bun run scenes:compile
bun run --cwd apps/layout-editor verify:focused-edit-real-content
```

Expected: PASS and log one real target for all seven families.

- [ ] **Step 4: Run concrete audio ownership gates**

```bash
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
```

Expected: PASS.

- [ ] **Step 5: Run the complete repository gate**

```bash
bun run editor:check
bun run editor:build
bun run test:scripts
bun run lint:all
```

Expected: PASS.

- [ ] **Step 6: Run mutation smoke only in a throwaway worktree/fixture workspace**

Do not touch canonical Chapter 1 source in the main checkout.

Smoke sequence:

```text
Reader line Edit
→ replacement
→ inspect exact Markdown diff
→ Apply
→ compile validation visible
```

Then exercise one character prompt and one audio prompt in the throwaway workspace. Confirm audio review names the sound-plan authored source and derived `audio.yaml` synchronization. Do not regenerate media or call a network provider.

- [ ] **Step 7: Self-review against the spec**

Verify all of these are true before marking the PR ready:

```text
exactly 7 target kinds
one active draft
exact authored-source diff before apply
no frontend arbitrary-path write
UTF-16 range contract + CJK/emoji Rust tests
hash + original-slice stale guards
fixed validation dispatch
shared impact warnings
audio sound-plan ownership
production JSON unchanged
no undo/history/queue/AI/general editor
HPA-136 reuses the same review/apply seam
```

Delete any accidental generic abstraction or unsupported edit affordance discovered by this review.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/layout-editor/scripts/verify-focused-edit-real-content.ts apps/layout-editor/package.json
git commit -m "test(workbench): verify focused edits on chapter 1"
```

---

## Plan Self-Review

### Spec coverage

- Reader dialogue/action → Tasks 1 and 5.
- Background/evidence prompt → Tasks 1, 4, and 5.
- Character visual/expression prompt → Tasks 1, 4, and 5.
- Audio prompt through sound-plan owner → Tasks 1, 2, 3, and 5.
- Exact diff/review → Tasks 4 and 5.
- Known SourceDocumentId/no arbitrary path → Task 3.
- UTF-16 range conversion + Japanese/emoji correctness → Task 3.
- Expected hash/original slice/range stale guard → Task 3.
- Authoritative validation → Tasks 2 and 3.
- Shared usage impact → Task 4.
- No queue/history/undo/general editor → global constraints + Task 5 review.
- HPA-136 reuse seam → Task 5.
- Real Chapter 1 proof → Task 6.

### Scope pressure check

This plan intentionally does not add:

- Plan-mode source editing;
- production source-location fields;
- generic source registry/filesystem service;
- diff dependency;
- generic command runner;
- source merge/rebase;
- Workbench history/undo;
- audio cue/source-plan redesign;
- AI/provider work.

The only cross-cutting seam is the one HPA-135/HPA-136 actually need:

```text
resolved semantic source target
→ reviewed FocusedEditDraft
→ guarded apply
```

### Type consistency

Use these names consistently:

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

Do not introduce parallel `proposal`, `change`, or `patch` workflow models for the same single-edit flow.

## Execution Handoff

Implementation remains on this same HPA-135 branch/PR.

Recommended execution mode: **subagent-driven development**, one task at a time with review between tasks, then the full Task 6 gate before marking the draft PR ready for review.
