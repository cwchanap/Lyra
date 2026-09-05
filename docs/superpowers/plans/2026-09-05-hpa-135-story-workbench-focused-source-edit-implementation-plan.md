# HPA-135 Story Workbench Focused Source Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Story Workbench's first human-controlled write path: edit one supported Reader/Assets value, review the exact authored-source diff and usage impact, apply the reviewed full document through a stale-safe fixed-domain backend, and show authoritative validation.

**Architecture:** Reuse current owners rather than rebuilding them. Reader owns dialogue/action carrier identity and traversal; compiler parsers/tokenizer own authored source discovery; YAML prompt replacement uses the existing `yaml` Document mutation pattern; Assets owns typed prompt/usage impact; Rust resolves only closed source document IDs, hash-guards the source, atomically writes reviewed `nextContent`, and executes fixed validation commands. Audio prompt edits target the owning sound plan and synchronize the catalog through a separate narrow `audio:revise-prompt` command.

**Tech Stack:** TypeScript 5.6 + Vitest, Svelte 5 + Testing Library, Tauri 2 / Rust 2021, Bun 1.3.1, `yaml` 2.9 through `@lyra/scripts`, existing compile-scenes and audio CLIs.

**Spec:** `docs/superpowers/specs/2026-09-05-hpa-135-story-workbench-focused-source-edit-design.md`

## Global Constraints

- One ticket, one PR. Continue implementation on PR #84; do not open a second implementation PR.
- Exactly seven editable kinds: Reader dialogue, Reader action, scene Background Prompt, evidence Image Prompt, character visualPrompt, character expression prompt, existing audio prompt.
- Reader/Assets remain selection and impact owners; no second scene/asset model.
- Production scene JSON and Rust game runtime schema remain unchanged.
- No arbitrary frontend path, arbitrary field editor, generic Markdown/YAML editor, queue, autosave, history, Workbench Undo, AI provider, Git automation, or media generation.
- Compiler parsers/tokenizer own scene-source syntax. Do not copy Reader carrier grammar into scripts.
- YAML replacements use `YAML.parseDocument()` + Document mutation; do not hand-render YAML scalars.
- Audio prompt source-of-truth is `docs/audio_plans/<chapter>.sound-plan.yaml`; Workbench never directly writes `static/assets/config/audio.yaml`.
- Keep normal `mergeApprovedEntriesIntoCatalog()` conflict behavior unchanged.
- Rust apply receives `nextContent`, not source ranges. No Rust UTF-16 mapper.
- Frontend never supplies a shell command. Validation commands are fixed by target kind/ref.
- Validation failure after a successful source write is **Applied, validation failed**; no fake rollback.

---

## Review Resolution

The external design review is accepted in full. The implementation must preserve these corrections:

1. Do **not** zip authored tokens against raw `deriveDialogueSegments()` array order. Reader traversal owns final carrier/item identity; investigation/interrogation outro ordering makes the raw segment array unsuitable for direct pairing.
2. Do **not** reparse Background/Image Prompt block ownership. Validate through existing scene parsers and use their AST identities; tokenizer ranges are only for exact accepted source slices.
3. Do **not** build a YAML scalar renderer. Reuse the existing `YAML.parseDocument()` / `node.set()` / `doc.toString()` writeback pattern and reject unrelated serialization churn before Apply.
4. Tokenizer ranges must refer to raw untrimmed source and expose separate editable value ranges while preserving all current normalized token semantics.
5. Rust receives reviewed `nextContent`; it does not convert JS UTF-16 ranges or perform a second source-target slice operation.
6. `ReaderView.test.ts` is a new file; process spawning receives real cwd/argv/non-zero-stop coverage; the real apply → validation path gets a live smoke; audio plan ownership is derived from typed `(channel,id)` plus exactly one concrete usage chapter.

---

## File Map

### New files

- `packages/scripts/workbench/source-edit-targets.ts` — filesystem-free scene/config/sound-plan source discovery and replacement rendering.
- `packages/scripts/workbench/source-edit-targets.test.ts` — parser reuse, source slices, YAML Document mutation tests.
- `apps/layout-editor/src/lib/focused-edit.ts` — draft, exact one-hunk diff, source-churn guard, impact model.
- `apps/layout-editor/src/lib/focused-edit.test.ts` — draft/diff/impact tests.
- `apps/layout-editor/src/lib/FocusedEditReview.svelte` — shared human review/apply surface.
- `apps/layout-editor/src/lib/FocusedEditReview.test.ts` — review-state/component tests.
- `apps/layout-editor/src/lib/ReaderView.test.ts` — Reader edit affordance component tests; this file does not exist on current main.
- `apps/layout-editor/scripts/verify-focused-edit-real-content.ts` — read-only real Chapter 1 source-target verifier.

### Modified files

- `packages/scripts/compile-scenes/tokenizer.ts`
- `packages/scripts/compile-scenes/tokenizer.test.ts`
- `packages/scripts/compile-scenes/parser-assets.ts` — shared scene-tag unit identity helper.
- `packages/scripts/compile-scenes/assets/enrich.ts` — reuse shared scene-tag unit identity.
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
- `apps/layout-editor/src/lib/asset-workspace.ts`
- `apps/layout-editor/src/lib/asset-workspace.test.ts`
- `apps/layout-editor/src/lib/ReaderView.svelte`
- `apps/layout-editor/src/lib/AssetsView.svelte`
- `apps/layout-editor/src/lib/AssetsView.test.ts`
- `apps/layout-editor/src/App.svelte`
- `apps/layout-editor/src/App.test.ts`
- `apps/layout-editor/package.json`

---

## Task 1: Extend compiler source discovery and bind Reader targets through the existing Reader walk

**Files:**
- Create: `packages/scripts/workbench/source-edit-targets.ts`
- Create/Test: `packages/scripts/workbench/source-edit-targets.test.ts`
- Modify/Test: `packages/scripts/compile-scenes/tokenizer.ts`
- Modify/Test: `packages/scripts/compile-scenes/tokenizer.test.ts`
- Modify/Test: `packages/scripts/compile-scenes/parser-assets.ts`
- Modify/Test: `packages/scripts/compile-scenes/assets/enrich.ts`
- Modify/Test: `apps/layout-editor/src/lib/workbench-types.ts`
- Modify/Test: `apps/layout-editor/src/lib/reader-projection.ts`
- Modify/Test: `apps/layout-editor/src/lib/reader-projection.test.ts`

**Interfaces:**

Scripts produce raw source identity, not Reader carrier identity:

```ts
export type SourceRange = {
  start: number;      // JavaScript UTF-16 string index
  end: number;
  startLine: number;
  endLine: number;
};

export type SceneTextSourceToken = {
  kind: "line" | "action";
  speaker: string | null;
  currentText: string;       // normalized tokenizer/parser text
  sourceRange: SourceRange;  // exact editable value in raw source
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
  sourceRange: SourceRange | null;
};

export type SceneSourceIndex = {
  textTokens: SceneTextSourceToken[];
  promptTargets: WorkbenchSourceTarget[];
  diagnostics: CompileError[];
};

export function indexSceneSourceTargets(input: {
  sceneType: "linear" | "investigation" | "interrogation" | "analysis";
  sceneId: string;
  sourcePath: string;
  source: string;
}): SceneSourceIndex;

export function indexCharacterSourceTargets(input: {
  sourcePath: string;
  source: string;
}): { targets: WorkbenchSourceTarget[]; diagnostics: CompileError[] };

export function indexAudioPlanSourceTargets(input: {
  sourcePath: string;
  source: string;
}): { targets: WorkbenchSourceTarget[]; diagnostics: CompileError[] };

export function renderSourceReplacement(input: {
  source: string;
  target: WorkbenchSourceTarget;
  replacementText: string;
}):
  | { ok: true; nextContent: string }
  | { ok: false; diagnostic: CompileError };
```

Reader owns semantic refs:

```ts
export type ReaderEditableRef = {
  carrierId: string;
  itemIndex: number;
};

export function bindReaderSourceTargets(
  reader: ReaderScene,
  sourceTokens: SceneTextSourceToken[],
): { targets: WorkbenchSourceTarget[]; diagnostics: CompileError[] };
```

### Step 1: Write RED tokenizer raw/value range tests

- [ ] Add range fields to expected token fixtures only in the new tests first so the file is RED.

Use all of these spellings:

```ts
const lf = `# Scene 1: Test

  **相馬律**[determined]：原本台詞  
  [第一行動作
    第二行動作]
`;

const crlf = "# Scene 1: Test\r\n\r\n**相馬律**：CRLF台詞\r\n";
```

Required assertions:

```ts
const line = tokenize(lf, "scene_1.md").find((t) => t.kind === "dialogue")!;
expect(lf.slice(line.range.start, line.range.end)).toBe(
  "**相馬律**[determined]：原本台詞",
);
expect(lf.slice(line.valueRange.start, line.valueRange.end)).toBe("原本台詞");

const action = tokenize(lf, "scene_1.md").find((t) => t.kind === "action")!;
expect(lf.slice(action.valueRange.start, action.valueRange.end)).toContain("第一行動作");
expect(lf.slice(action.valueRange.start, action.valueRange.end)).toContain("第二行動作");
expect(action.text).toBe("第一行動作 第二行動作");
```

Also assert CRLF token/value slices preserve the source spelling and line numbers.

- [ ] Run:

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/tokenizer.test.ts
```

Expected: FAIL because `range` / `valueRange` do not exist.

### Step 2: Implement tokenizer ranges without changing parse semantics

- [ ] Add `SourceRange` to every token as `range`.
- [ ] Add `valueRange` to `metadata`, `dialogue`, and `action` tokens.
- [ ] Track raw line-start UTF-16 offsets from the original source, not offsets from `trimmed` strings.
- [ ] For CRLF, include the exact raw source line boundaries but exclude line terminators from token/value ranges.
- [ ] For a multi-line bracket action, raw `range` spans `[` through `]`; `valueRange` spans only the interior source.
- [ ] Keep `token.text`, speaker/expression parsing, trimmed metadata values, and multi-line action newline-to-space normalization unchanged.

Existing `tokenizer.test.ts` uses whole-object `toEqual()`. Update every affected expected token with the new range fields; do not weaken the old assertions to partial matches merely to avoid fixture work.

- [ ] Run:

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/tokenizer.test.ts
bun run check:scripts
```

Expected: PASS.

### Step 3: Extract the existing scene-tag asset unit spelling once

- [ ] Add a browser-safe helper in `parser-assets.ts`:

```ts
export function sceneTagUnitId(oneBasedIndex: number): string {
  return `tag_${String(oneBasedIndex).padStart(3, "0")}`;
}
```

- [ ] Change `assets/enrich.ts` to call `sceneTagUnitId(++context.tagIndex)` instead of constructing `tag_${...}` inline.
- [ ] Add a focused scripts test proving tags 1, 2, 10 produce `tag_001`, `tag_002`, `tag_010`.

This makes enrichment and HPA-135 share the same identity owner.

### Step 4: Write RED scene source discovery tests that reuse the real parser

- [ ] Create one valid linear fixture and one valid investigation fixture. The investigation fixture must contain, in real source order:

```text
Intro line/action
Sub-location transition
Hotspot inspect
Character topic dialogue
Evidence On Collect
Outro
```

It must also contain:

- one scene tag without `Background Prompt` before a later tag with a prompt;
- one structural sublocation `Background Prompt`;
- one evidence `Image Prompt`.

- [ ] Assert `indexSceneSourceTargets()` first validates through the actual scene parser selected by `sceneType`; malformed source produces the parser diagnostic and no edit targets.
- [ ] Assert scene tags are numbered across **every** tag, including the prompt-less one:

```ts
expect(promptRefs).toContain("asset:background:tag_002");
```

- [ ] Assert structural/background/evidence refs use parsed owner identity:

```ts
expect(promptRefs).toContain("asset:background:back_corridor");
expect(promptRefs).toContain("asset:evidence:summary_copy:imagePrompt");
```

- [ ] Assert `textTokens` contain normalized line/action values plus exact raw editable `valueRange` slices, but contain no Reader carrier IDs.

### Step 5: Implement scene source discovery with parser-owned association

- [ ] Parse through the current scene parser and keep the parsed AST as the authority:

```ts
const parsed =
  sceneType === "linear"
    ? parseLinearScene(source, sourcePath, sceneId)
    : sceneType === "investigation"
      ? parseInvestigationScene(source, sourcePath, sceneId)
      : sceneType === "interrogation"
        ? parseInterrogationScene(source, sourcePath, sceneId)
        : parseAnalysisScene(source, sourcePath, sceneId);

if (!parsed.ok) {
  return { textTokens: [], promptTargets: [], diagnostics: [parsed.error] };
}
```

Do not create a second scene block parser.

- [ ] After successful parse, use AST owner IDs/lines to identify structural units/evidence entries. Use tokenizer only to slice the metadata token that the parser has already accepted.
- [ ] For scene tags, walk sceneTag tokens in source order, call shared `sceneTagUnitId(index)`, and inspect only immediately-attached metadata tokens. Increment the index whether or not the tag has a prompt.
- [ ] Emit only existing `Background Prompt` and `Image Prompt` fields. Never synthesize a missing field.
- [ ] Emit lexical `SceneTextSourceToken` rows in source order for dialogue/action only.

### Step 6: Write RED Reader binding tests for the investigation ordering bug

- [ ] Extend `workbench-types.ts` so projected line/action items can carry:

```ts
editableRef: ReaderEditableRef | null;
```

Notices and scene tags have no edit ref.

- [ ] Add a `reader-projection.test.ts` fixture whose underlying investigation source order is:

```text
intro → hotspot inspect → topic dialogue → evidence onCollect → outro
```

The compiled scene goes through normal `projectReaderScene()`.

Assert final semantic refs are exactly the Reader carriers:

```ts
expect(refs).toContain("reader:dialogue:intro:0");
expect(refs).toContain("reader:dialogue:hotspot:counter:inspect:0");
expect(refs).toContain("reader:dialogue:topic:manager:closing:dialogue:0");
expect(refs).toContain("reader:dialogue:evidence:summary_copy:onCollect:0");
expect(refs.at(-1)).toMatch(/reader:dialogue:outro:/);
```

The test must fail if source tokens are zipped against raw `deriveDialogueSegments()` array order, because that array places investigation outro before sublocations.

### Step 7: Implement Reader-owned semantic binding

- [ ] Change `carrierGroup()` to map raw compiler items with their existing `id` + `itemIndex`:

```ts
items: items.map((item, itemIndex) =>
  projectDialogue(item, { carrierId: id, itemIndex }),
)
```

- [ ] `projectDialogue()` adds `editableRef` only for `line` and `action`.
- [ ] Implement `bindReaderSourceTargets(reader, sourceTokens)` by recursively flattening the **existing Reader group tree in rendered order**, filtering to line/action items, then zipping with lexical source tokens.
- [ ] Match kind + normalized text; for dialogue also match speaker.
- [ ] Produce final refs from `editableRef`; never copy `readerSegmentId()` into scripts.
- [ ] On mismatch, return `workbenchSourceDialogueMismatch` and no guessed Reader source target.

### Step 8: Write RED character/sound-plan Document mutation tests

Character fixture must include comments, block `visualPrompt`, and a plain expression prompt. Sound-plan fixture must include two entries and comments.

- [ ] Character identity is first checked with `parseCharactersYamlText()`.
- [ ] Sound-plan identity/status is first checked with `parseSoundPlanText()`.
- [ ] For replacement, use `YAML.parseDocument()`, locate the identified map/entry, `node.set(...)`, and `doc.toString()`.

Required assertions:

```text
reparsed canonical parser succeeds
edited logical value changed
comments survive
other character/audio entries are semantically unchanged
no missing/duplicate/non-approved audio target is exposed
```

Do not implement a scalar quoting/block-style renderer.

### Step 9: Implement YAML source targets and replacement rendering

- [ ] `indexCharacterSourceTargets()` exposes only existing `visualPrompt` and existing expression prompts.
- [ ] `indexAudioPlanSourceTargets()` exposes exactly one approved/generated `(channel,id)` prompt target per matching entry.
- [ ] `renderSourceReplacement()`:
  - Markdown Reader/prompt target: `String.prototype.slice()` around the target source range to produce full `nextContent`.
  - Character/sound-plan YAML: reparse Document, re-resolve semantic target, `node.set(...)`, return `doc.toString()` as `nextContent`.
- [ ] Reject dialogue replacement containing a newline; allow multiline action; reject newlines for current one-line Markdown metadata values.

### Step 10: Run Task 1 gates

- [ ] Run:

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/tokenizer.test.ts
bunx vitest run --config vitest.scripts.config.ts packages/scripts/workbench/source-edit-targets.test.ts
bun run --cwd apps/layout-editor test src/lib/reader-projection.test.ts
bun run check:scripts
bun run test:scripts
```

Expected: PASS.

### Step 11: Commit Task 1

- [ ] Commit:

```bash
git add \
  packages/scripts/compile-scenes/tokenizer.ts \
  packages/scripts/compile-scenes/tokenizer.test.ts \
  packages/scripts/compile-scenes/parser-assets.ts \
  packages/scripts/compile-scenes/assets/enrich.ts \
  packages/scripts/workbench/source-edit-targets.ts \
  packages/scripts/workbench/source-edit-targets.test.ts \
  apps/layout-editor/src/lib/workbench-types.ts \
  apps/layout-editor/src/lib/reader-projection.ts \
  apps/layout-editor/src/lib/reader-projection.test.ts
git commit -m "feat(workbench): resolve focused source targets"
```

---

## Task 2: Add one-entry audio prompt revision inside the existing audio owner

**Files:**
- Modify/Test: `packages/scripts/audio/audio-catalog.ts`
- Modify/Test: `packages/scripts/audio/audio-catalog.test.ts`
- Modify/Test: `packages/scripts/audio/cli.ts`
- Modify/Test: `packages/scripts/audio/cli.test.ts`
- Modify: `packages/scripts/package.json`
- Modify: `package.json`

**Interfaces:**

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

### Step 1: Write RED catalog revision tests

- [ ] Add:

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

Also assert missing catalog entry is rejected.

- [ ] Keep a regression proving existing `mergeApprovedEntriesIntoCatalog()` still reports a duplicate conflict when normal `audio:apply` sees a changed prompt.

- [ ] Run:

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/audio/audio-catalog.test.ts
```

Expected: FAIL because the revision helper does not exist.

### Step 2: Implement the pure one-entry catalog revision

- [ ] Clone current catalog maps.
- [ ] Require existing `(channel,id)`.
- [ ] Replace only `prompt`.
- [ ] Preserve the existing entry's `loop` exactly.
- [ ] Do not route through normal merge semantics.

- [ ] Re-run the focused catalog test; expect PASS.

### Step 3: Write RED `revise-prompt` CLI tests

- [ ] Build a temp repo with one sound plan and matching audio catalog.
- [ ] Run:

```ts
const code = await runAudioCli(
  ["revise-prompt", planPath, "bgm", "bgm_chapter_close"],
  options,
);
expect(code).toBe(0);
```

Assert:

```text
catalog matching prompt == sound-plan prompt
loop unchanged
other catalog entries semantically unchanged
scene Markdown untouched
```

Add rejection tests for invalid channel, missing plan entry, duplicate matching plan entry, non-approved/generated entry, and missing catalog entry.

### Step 4: Implement `revise-prompt`

- [ ] Parse exactly plan path + channel + id.
- [ ] Load/validate plan through existing `parseSoundPlanText()` / `validateSoundPlan()` path.
- [ ] Require exactly one approved/generated matching entry.
- [ ] Read that already-edited plan prompt.
- [ ] Parse existing audio catalog.
- [ ] Call `reviseExistingAudioCatalogPrompt()`.
- [ ] Serialize/Prettier-format through current audio-catalog helpers.
- [ ] Write catalog only when changed.
- [ ] Never call `applyAudioCuesToMarkdown()`.

### Step 5: Add forwarding scripts

- [ ] `packages/scripts/package.json`:

```json
"audio:revise-prompt": "bun run audio/cli.ts revise-prompt"
```

- [ ] root `package.json`:

```json
"audio:revise-prompt": "bun run --cwd packages/scripts audio:revise-prompt"
```

### Step 6: Run Task 2 gates

- [ ] Run:

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/audio/audio-catalog.test.ts packages/scripts/audio/cli.test.ts
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
```

Expected: PASS.

### Step 7: Commit Task 2

- [ ] Commit:

```bash
git add packages/scripts/audio package.json packages/scripts/package.json
git commit -m "feat(audio): support focused prompt revisions"
```

---

## Task 3: Add closed source reads, hash-guarded full-document writes, and tested validation execution

**Files:**
- Modify/Test: `apps/layout-editor/src-tauri/Cargo.toml`
- Modify/Test: `apps/layout-editor/src-tauri/src/lib.rs`
- Modify: `apps/layout-editor/src/lib/workbench-types.ts`
- Modify: `apps/layout-editor/src/lib/workbench-api.ts`

**Interfaces:**

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

export type ApplyWorkbenchSourceEditRequest = {
  sourceDocumentId: SourceDocumentId;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  nextContent: string;
};

export type ApplyWorkbenchSourceEditResult = {
  sourceDocumentId: SourceDocumentId;
  sourcePath: string;
  newHash: string;
  validation: {
    ok: boolean;
    commands: string[];
    diagnostics: Array<{ stream: "stdout" | "stderr"; line: string }>;
  };
};
```

No source range crosses IPC.

### Step 1: Add wire types and frontend API wrappers

- [ ] Add the types above to `workbench-types.ts`.
- [ ] Add:

```ts
export const loadWorkbenchSourceDocument = (sourceDocumentId: SourceDocumentId) =>
  invoke<WorkbenchSourceDocument>("load_workbench_source_document", {
    sourceDocumentId,
  });

export const applyWorkbenchSourceEdit = (request: ApplyWorkbenchSourceEditRequest) =>
  invoke<ApplyWorkbenchSourceEditResult>("apply_workbench_source_edit", {
    request,
  });
```

### Step 2: Write RED Rust source resolver/hash tests

- [ ] Prefix tests `focused_source_`.
- [ ] Cover:

```rust
asset-config:characters
scene:chapter_1:scene_0
audio-plan:chapter_1
```

Also malformed `/`, `..`, unsupported prefix, unknown chapter/scene, and hash changing with source bytes.

- [ ] Add `sha2 = "0.10"` to the layout-editor Rust crate.

### Step 3: Implement fixed-domain source resolution/read

- [ ] Private enum:

```rust
enum SourceDocumentKind {
    Scene { chapter_id: String, scene_id: String },
    Characters,
    AudioPlan { chapter_id: String },
}
```

- [ ] Scene uses existing manifest/authored-source resolver.
- [ ] Characters uses fixed `static/assets/config/characters.yaml`.
- [ ] Audio plan first proves chapter membership, then constructs `docs/audio_plans/<chapter>.sound-plan.yaml` and applies root containment.
- [ ] Hash exact UTF-8 bytes to lowercase SHA-256.

- [ ] Run:

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml focused_source
```

Expected: resolver/hash tests PASS.

### Step 4: Write RED full-document apply tests

- [ ] Use temp workspace/source fixtures.
- [ ] Assert:

```text
stale expectedHash → sourceEditStale + no write
kind/ref mismatch → sourceEditSemanticRefInvalid + no write
document/kind mismatch → sourceEditKindUnsupported + no write
nextContent identical → sourceEditNoChange + no write
valid nextContent → complete file equals reviewed candidate
unrelated sibling files unchanged
```

No UTF-16 or byte-range test belongs in Rust.

### Step 5: Generalize the existing atomic writer

- [ ] Rename/refactor `write_layout_sidecar_no_follow` into a private complete-document helper accepting an already-resolved canonical path + `&str` contents.
- [ ] Keep same-directory unique temp file, `create_new`, `sync_all`, and `rename` behavior.
- [ ] Reuse the helper from layout-sidecar save and HPA-135 apply.
- [ ] Do not create a generic filesystem service or public arbitrary-path command.

Apply order:

```text
resolve document
→ read current contents
→ hash compare
→ ref/kind/document-family checks
→ no-change check
→ atomic write nextContent
→ fixed validation
```

### Step 6: Write RED validation-plan tests

- [ ] Add:

```rust
fn validation_plan(
    source: &ResolvedSourceDocument,
    kind: SourceEditKind,
    semantic_ref: &str,
) -> Result<Vec<ValidationCommand>, EditorError>;
```

Story/character target:

```text
bun run scenes:compile
```

Audio target, in order:

```text
bun run audio:revise-prompt <resolved-plan-path> <channel> <id>
bun run audio:validate <resolved-plan-path>
bun run audio:apply <resolved-plan-path> --check
bun run scenes:compile
```

`channel`/`id` come from validated semantic ref; plan path comes from resolved document, never the frontend.

### Step 7: Add a private command-execution seam and tests

- [ ] Define:

```rust
struct CommandOutcome {
    success: bool,
    stdout: String,
    stderr: String,
}

fn execute_validation_plan_with<F>(
    root: &Path,
    plan: &[ValidationCommand],
    mut run: F,
) -> ValidationResult
where
    F: FnMut(&Path, &ValidationCommand) -> CommandOutcome;
```

- [ ] Inject a fake runner in unit tests and assert:
  - exact program/argv sequence;
  - every call receives canonical workspace root;
  - first `success = false` stops subsequent commands;
  - stdout/stderr are retained in order and truncated to the last 200 lines per command.

- [ ] Add one actual process-spawn test using the repository-required Bun executable:

```rust
ValidationCommand {
    program: "bun".into(),
    args: vec![
        "-e".into(),
        "process.stdout.write(process.cwd())".into(),
    ],
}
```

Run it through the production `std::process::Command` adapter in a temp workspace and assert stdout equals that workspace path. This proves the first process-spawn boundary and `current_dir()` behavior rather than testing only the pure plan.

### Step 8: Implement production validation execution

- [ ] Build `std::process::Command` directly from program + args; no shell string.
- [ ] Set `current_dir(canonical_root)`.
- [ ] Capture output.
- [ ] Stop on first non-zero exit.
- [ ] Return `validation.ok = false`; never imply the source write rolled back.

### Step 9: Register only the two domain commands

- [ ] Register:

```text
load_workbench_source_document
apply_workbench_source_edit
```

Do not add `read_file`, `write_file`, `run_command`, or similar generic IPC.

### Step 10: Run Task 3 gates

- [ ] Run:

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml focused_source
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
```

Expected: PASS.

### Step 11: Commit Task 3

- [ ] Commit:

```bash
git add apps/layout-editor/src-tauri apps/layout-editor/src/lib/workbench-types.ts apps/layout-editor/src/lib/workbench-api.ts
git commit -m "feat(workbench): add guarded focused source writes"
```

---

## Task 4: Build the focused draft, exact diff, source-churn guard, and impact joins

**Files:**
- Create/Test: `apps/layout-editor/src/lib/focused-edit.ts`
- Create/Test: `apps/layout-editor/src/lib/focused-edit.test.ts`
- Modify/Test: `apps/layout-editor/src/lib/asset-workspace.ts`
- Modify/Test: `apps/layout-editor/src/lib/asset-workspace.test.ts`

**Interfaces:**

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
  originalText: string;
  replacementText: string;
  nextContent: string;
  impact: FocusedEditImpact;
};

export function buildFocusedEditDraft(input: {
  document: WorkbenchSourceDocument;
  target: WorkbenchSourceTarget;
  replacementText: string;
  impact: FocusedEditImpact;
}): FocusedEditDraftResult;

export function focusedEditDiff(input: {
  originalContent: string;
  nextContent: string;
  sourcePath: string;
  allowedRange: SourceRange | null;
}):
  | { ok: true; diff: string }
  | { ok: false; code: "focusedEditSourceChurn" };
```

### Step 1: Write RED draft and one-hunk diff tests

- [ ] Markdown dialogue test:

```text
--- a/docs/stories_plan/chapter_1/scene_0.md
+++ b/docs/stories_plan/chapter_1/scene_0.md
@@
-**相馬律**：舊台詞
+**相馬律**：新台詞
```

- [ ] YAML test must show actual changed scalar syntax while keeping a nearby comment and unrelated entry outside the hunk.
- [ ] Add a synthetic candidate that changes two separated regions; expect `focusedEditSourceChurn` and no Apply request.
- [ ] Add a YAML candidate whose serializer changes a line outside the selected scalar/node `allowedRange`; expect `focusedEditSourceChurn` even if the overall diff could otherwise be represented as one broad hunk.

### Step 2: Implement deterministic focused diff and locality guard

- [ ] Find changed line/character regions between `originalContent` and `nextContent`.
- [ ] Require every changed source position to remain within the selected target's local `allowedRange` (or the selected YAML node block resolved during target discovery).
- [ ] If any unrelated position changed, return `focusedEditSourceChurn`.
- [ ] Render the remaining localized edit as one unified-style hunk with up to three context lines.
- [ ] Do not parse/apply the diff later.
- [ ] `nextContent === originalContent` returns `focusedEditNoChange` before diff.

This is the guard that allows YAML Document serialization without silently accepting whole-file formatting churn.

### Step 3: Write RED impact tests

- [ ] Cover:

```text
Reader line/action → selected scene only
background used twice across two scenes → usageCount 2, shared true
evidence used once → shared false
character expression → existing assetUsageGroups data
character visualPrompt → typed manifest characterId join
audio prompt → typed channel/id + exactly one owning chapter
```

### Step 4: Implement narrow impact helpers

- [ ] Reuse `workspace.sceneUsages`, typed manifest sources, and `assetUsageGroups()`.
- [ ] Never parse asset IDs to infer source identity.

Audio ownership is explicit:

```ts
function audioEditOwner(
  workspace: AssetWorkspace,
  entry: Extract<AssetManifestEntry, { type: "audio" }>,
): { chapterId: string; channel: AudioChannel; id: string } | null
```

Rules:

1. `channel/id` come from `entry.source.channel/id`.
2. Collect all `workspace.sceneUsages` for `entry.assetId`.
3. Collect distinct usage `chapterId`s.
4. Exactly one distinct chapter → owner.
5. Zero/multiple chapters → no Edit; emit/display `focusedEditAudioPlanAmbiguous`.

Do not rely on the manifest entry's first scene `chapterId` when an audio asset is reused across chapters.

### Step 5: Implement draft construction

- [ ] Call Task 1 `renderSourceReplacement()` to get `nextContent`.
- [ ] Pass the target's source/node locality range to `focusedEditDiff()` and run churn validation immediately.
- [ ] Build draft only when the candidate changes only the selected local source block.
- [ ] Draft contains no source range or byte offsets for IPC.

### Step 6: Run Task 4 gates

- [ ] Run:

```bash
bun run --cwd apps/layout-editor test src/lib/focused-edit.test.ts src/lib/asset-workspace.test.ts
bun run editor:check
```

Expected: PASS.

### Step 7: Commit Task 4

- [ ] Commit:

```bash
git add apps/layout-editor/src/lib/focused-edit.ts apps/layout-editor/src/lib/focused-edit.test.ts apps/layout-editor/src/lib/asset-workspace.ts apps/layout-editor/src/lib/asset-workspace.test.ts
git commit -m "feat(workbench): build focused edit reviews"
```

---

## Task 5: Wire one shared review UI from Reader and Assets

**Files:**
- Create/Test: `apps/layout-editor/src/lib/FocusedEditReview.svelte`
- Create/Test: `apps/layout-editor/src/lib/FocusedEditReview.test.ts`
- Create/Test: `apps/layout-editor/src/lib/ReaderView.test.ts`
- Modify: `apps/layout-editor/src/lib/ReaderView.svelte`
- Modify/Test: `apps/layout-editor/src/lib/AssetsView.svelte`
- Modify/Test: `apps/layout-editor/src/lib/AssetsView.test.ts`
- Modify/Test: `apps/layout-editor/src/App.svelte`
- Modify/Test: `apps/layout-editor/src/App.test.ts`

### Step 1: Write RED ReaderView affordance tests

- [ ] Create `ReaderView.test.ts`; do not list it as an existing file.
- [ ] Render one Reader scene with line, action, sceneTag, and notice.
- [ ] Assert Edit appears only for line/action.
- [ ] Clicking Edit calls:

```ts
onEdit({
  semanticRef: "reader:dialogue:hotspot:counter:inspect:0",
  kind: "readerDialogue",
});
```

No source loading occurs inside ReaderView.

### Step 2: Add Reader callback

- [ ] Extend ReaderView props with one narrow `onEdit` callback.
- [ ] Use `ReaderItem.editableRef` to construct the semantic ref.
- [ ] Keep copy-source and read-only rendering otherwise unchanged.

### Step 3: Write RED Assets edit-action tests

- [ ] Scene-owned background/evidence entries show **Edit source prompt**.
- [ ] Global-file/character-owned background/evidence do not.
- [ ] Character non-null `visualPrompt` and every existing expression prompt show Edit.
- [ ] Audio Edit appears only when Task 4 resolves exactly one chapter owner.
- [ ] Ambiguous cross-chapter audio fixture shows no Edit and the ambiguity message/diagnostic.

AssetsView emits semantic selection only; it does not write source.

### Step 4: Implement Assets callbacks

- [ ] Add one `onEdit` prop.
- [ ] Reuse Task 4 owner/impact helpers.
- [ ] Do not add a second asset-source map in the component.

### Step 5: Write RED FocusedEditReview tests

- [ ] Cover:

```text
loading-source
editing replacement
exact diff visible
shared impact warning
Apply disabled on no-change/source-churn
Apply request contains SourceDocumentId + expectedHash + kind + semanticRef + nextContent only
stale error stays editable after reload path
applied-valid
applied-invalid with diagnostics
Cancel clears draft
```

No queue/history/undo control exists.

### Step 6: Implement FocusedEditReview

- [ ] Textarea/input edits logical replacement.
- [ ] Recompute draft/diff locally on replacement change.
- [ ] Apply calls `applyWorkbenchSourceEdit()` only after a valid focused draft.
- [ ] Applied-invalid copy is explicitly **Applied, validation failed**.

### Step 7: Wire App as the single owner

- [ ] `App.svelte` owns only one active edit selection/draft state.
- [ ] Selection flow:

```text
Reader/Assets semantic selection
→ resolve SourceDocumentId
→ loadWorkbenchSourceDocument
→ Task 1 target discovery/binding
→ buildFocusedEditDraft
→ FocusedEditReview
```

- [ ] On valid apply, refresh existing Reader/Assets stores/snapshots.
- [ ] On invalid validation, do not refresh generated projections as if compile succeeded.
- [ ] Plan mode remains read-only.

### Step 8: Add App integration tests

- [ ] Reader selection opens the same review surface as Assets selection.
- [ ] Source load is lazy.
- [ ] Only one edit can be active.
- [ ] HPA-136-shaped `initialReplacement` can be passed into the same draft/review constructor without a second writer.

### Step 9: Run Task 5 gates

- [ ] Run:

```bash
bun run --cwd apps/layout-editor test src/lib/ReaderView.test.ts src/lib/AssetsView.test.ts src/lib/FocusedEditReview.test.ts src/App.test.ts
bun run editor:check
```

Expected: PASS.

### Step 10: Commit Task 5

- [ ] Commit:

```bash
git add apps/layout-editor/src/lib/ReaderView.svelte apps/layout-editor/src/lib/ReaderView.test.ts apps/layout-editor/src/lib/AssetsView.svelte apps/layout-editor/src/lib/AssetsView.test.ts apps/layout-editor/src/lib/FocusedEditReview.svelte apps/layout-editor/src/lib/FocusedEditReview.test.ts apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(workbench): review and apply focused source edits"
```

---

## Task 6: Prove real Chapter 1 target discovery, the live write/validation path, and full repository gates

**Files:**
- Create: `apps/layout-editor/scripts/verify-focused-edit-real-content.ts`
- Modify: `apps/layout-editor/package.json`
- Modify: PR #84 description/checklist after evidence is available

### Step 1: Add the read-only real-content verifier

- [ ] Add script:

```json
"verify:focused-edit-real-content": "bun run scripts/verify-focused-edit-real-content.ts"
```

- [ ] The verifier loads current compiled/source Chapter 1 content and must find at least one valid target for each family:

```text
Reader dialogue
Reader action
Background Prompt
evidence Image Prompt
soma_ritsu visualPrompt
soma_ritsu standard expression prompt
one approved/generated Chapter 1 audio prompt
```

- [ ] The Reader proof must include an investigation scene and assert at least hotspot/topic/outro refs bind successfully. Do not let a linear-only scene satisfy the Reader gate.
- [ ] The verifier must be read-only.

### Step 2: Run compiler/scripts/source verifiers

- [ ] Run:

```bash
bun run scenes:compile
bun run check:scripts
bun run test:scripts
bun run --cwd apps/layout-editor verify:reader-real-content
bun run --cwd apps/layout-editor verify:asset-real-content
bun run --cwd apps/layout-editor verify:plan-real-content
bun run --cwd apps/layout-editor verify:focused-edit-real-content
```

Expected: all PASS.

### Step 3: Run layout-editor/Rust gates

- [ ] Run:

```bash
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
bun run editor:build
```

Expected: all PASS.

### Step 4: Run authoritative audio checks

- [ ] Run:

```bash
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
```

Expected: PASS.

### Step 5: Run final repo hygiene

- [ ] Run:

```bash
bun run lint:all
```

Expected: PASS.

### Step 6: Perform the live apply → validation smoke

`editor:build` proves packaging, not the new process boundary. Exercise it explicitly.

- [ ] Record clean Git status for source/config/audio-plan files.
- [ ] Start the real Workbench against the current repo.
- [ ] Choose a harmless Chapter 1 dialogue or action target.
- [ ] Change one word through the HPA-135 review UI.
- [ ] Confirm the diff shows exactly that one source change.
- [ ] Apply.
- [ ] Confirm UI reports validation success and `bun run scenes:compile` was executed by the backend path.
- [ ] Confirm generated Reader/Assets refresh reflects the edit.
- [ ] Revert the throwaway source change with Git.
- [ ] Re-run `bun run scenes:compile` and confirm clean source diff.

Do not substitute `editor:check`/`editor:build` for this acceptance proof.

### Step 7: Perform one audio prompt smoke without generating media

- [ ] Select a Chapter 1 audio prompt whose usages resolve to exactly one chapter.
- [ ] Change prompt text in the reviewed sound-plan diff.
- [ ] Apply and confirm backend runs:

```text
audio:revise-prompt
audio:validate
audio:apply --check
scenes:compile
```

- [ ] Confirm both sound plan and derived `audio.yaml` prompt reflect the temporary edit.
- [ ] Git-revert both temporary source changes; do not generate audio.
- [ ] Re-run audio validate/apply-check.

### Step 8: Self-review implementation scope before ready-for-review

- [ ] Confirm:

```text
no source ranges in apply IPC
no utf16_range_to_byte_range in Rust
no copied readerSegmentId() / Reader traversal in scripts
no custom YAML scalar renderer
no generic read/write/run-command IPC
no queue/history/undo
no Plan editing
no direct Workbench audio.yaml edit
no production scene JSON schema change
```

### Step 9: Update PR #84 and Linear evidence

- [ ] Record final command results and manual smoke evidence in PR #84.
- [ ] Keep HPA-135 as the same single PR.
- [ ] Move Linear to review only after all required gates and the live apply smoke are complete.

### Step 10: Final implementation commit / ready-for-review transition

- [ ] Commit verifier/package changes:

```bash
git add apps/layout-editor/scripts/verify-focused-edit-real-content.ts apps/layout-editor/package.json
git commit -m "test(workbench): verify focused source edits on real content"
```

Then run the complete final gate once more on the final head before marking the PR ready.

---

## Final Required Gate

Run on the final PR head:

```bash
bun run scenes:compile
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
bun run check:scripts
bun run test:scripts
bun run --cwd apps/layout-editor test
bun run --cwd apps/layout-editor verify:reader-real-content
bun run --cwd apps/layout-editor verify:asset-real-content
bun run --cwd apps/layout-editor verify:plan-real-content
bun run --cwd apps/layout-editor verify:focused-edit-real-content
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
bun run editor:build
bun run lint:all
```

Expected: every command exits 0.

## Implementation Handoff

Implementation should use **superpowers:subagent-driven-development** task-by-task on this same PR. Each task above is independently reviewable, but all six tasks belong to HPA-135 and land together in PR #84.