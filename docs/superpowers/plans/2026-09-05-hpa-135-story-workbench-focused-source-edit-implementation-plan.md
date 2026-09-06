# HPA-135 Story Workbench Focused Source Edit Implementation Plan

> Continue implementation on PR #84. Use `superpowers:test-driven-development` while implementing and `superpowers:verification-before-completion` before removing Draft.

**Goal:** ship the first safe Workbench write seam for four scene-Markdown targets: dialogue, single-line action, scene-owned Background Prompt, and evidence Image Prompt.

**Architecture:** compiler parsing/enrichment owns authored source identity; Workbench renders exactly one physical-line value mutation + one-hunk diff; Rust resolves only a closed scene document, SHA-guards it, enforces exactly one expected changed line, atomically writes reviewed `nextContent`, and runs bounded `scenes:compile` validation.

**Deferred:** character visualPrompt, character expression prompt, audio/sound-plan prompt. Do not add YAML writeback code to HPA-135.

**Spec:** `docs/superpowers/specs/2026-09-05-hpa-135-story-workbench-focused-source-edit-design.md`

## Locks

- One ticket / one PR: #84.
- Four kinds only: `readerDialogue`, `readerAction`, `backgroundPrompt`, `evidenceImagePrompt`.
- Character/audio stay readable, not editable.
- Multiline actions stay read-only.
- Production scene JSON stays unchanged.
- No tokenizer-wide source ranges, YAML serializer, audio CLI, Rust UTF-16 mapper, arbitrary path/write/command API, queue/history/undo/AI/Git automation.
- Keep `expectedHash` as the stale token; one minimal SHA-256 helper only.
- Applied source + failed/timeout validation = **Applied, validation failed**, no rollback.

---

# Task 1 — Compiler-owned source identity + real Chapter 1 hard gate

Do not start backend/UI wiring while this task's real-content verifier is red.

## 1.1 Dialogue/action source line at parse time

### RED

Add focused parser tests for source-line capture across all real construction styles:

- [ ] linear direct dialogue + action;
- [ ] investigation intro/hotspot/topic/evidence/outro dialogue/action;
- [ ] evidence/statement manifest dialogue consumer;
- [ ] interrogation ordinary direct dialogue;
- [ ] interrogation metadata-wrapped dialogue/action (`On Loop`, `Loop Prompt`, `Default Challenge`, `Default Wrong`, `Wrong Reply`, testimony line fields as applicable);
- [ ] analysis dialogue.

The interrogation test must prove the source line is the **outer metadata token's authored file line**, not line 1 from `parseDialogueFieldValue()` re-tokenizing the metadata value.

### GREEN

- [ ] Add optional compiler-only `sourceLine?: number` to `DialogueItem` variants.
- [ ] Direct dialogue/action parser paths set it from the authored tokenizer token.
- [ ] Extend shared metadata consumption to return key→line metadata alongside values.
- [ ] Thread exact metadata line into `parseDialogueFieldValue()` and set every returned inner dialogue/action item to that outer line.
- [ ] Keep current parsing/normalization semantics unchanged.
- [ ] Do not assume `parser-common.ts` is the only funnel; cover `parser-linear`, `parser-common`, `parser-manifest`, and interrogation-specific creation.

## 1.2 Explicit emitter strip

### RED

- [ ] `emitter.test.ts` fixtures include compiler-only `sourceLine` on sceneTag/action/line and assert emitted JSON contains none of it.

### GREEN

- [ ] Explicitly construct all `JSONDialogueItem` variants in `emitDialogueItem()`.
- [ ] Remove sceneTag spread / non-line by-reference behavior that would leak future compiler-only fields.

## 1.3 One carrier identity owner + per-item source lines

### RED

Add `dialogue-segment-origins` / Reader regressions for:

```text
linear main
investigation intro
hotspot:<id>:inspect
topic:<character>:<topic>:dialogue
evidence:<id>:onCollect
investigation outro
interrogation phase/testimony branches
analysis carriers
```

Investigation test must fail if implementation depends on raw `deriveDialogueSegments()` array order.

### GREEN

- [ ] Move current Reader carrier spelling to scripts:

```ts
export function dialogueSegmentCarrierId(origin: DialogueSegmentOriginV1): string;
```

- [ ] Reader imports it; delete local duplicate mapping.
- [ ] When `deriveDialogueSegments()` receives `sourceAst`, expose `itemSources[]` parallel to emitted items.
- [ ] Associate source owners by the same semantic IDs/origins as the carrier; do not globally flatten source/Reader trees.
- [ ] Source resolver joins within one carrier by emitted item index.
- [ ] Carrier mismatch emits `workbenchSourceCarrierStale` only for that carrier.

## 1.4 Exact prompt line/value in typed asset manifest

### RED

- [ ] scene-tag Background Prompt manifest source has actual enrichment `unitId`, `promptLine`, literal `authoredPrompt`;
- [ ] structural investigation Background Prompt same;
- [ ] interrogation phase Background Prompt same;
- [ ] evidence Image Prompt has `evidenceId`, `promptLine`, literal `authoredPrompt`;
- [ ] investigation regression proves `source.authoredPrompt` stays literal while `promptParts.entryPrompt` may contain guidance suffix;
- [ ] runtime emitter test proves prompt-line compiler metadata never enters scene JSON.

### GREEN

- [ ] Add compiler-only `backgroundPromptLine` / `imagePromptLine` to cue data.
- [ ] Shared `consumeMetadata()` returns values + key→line map without changing existing value semantics.
- [ ] SceneTag parsers pass existing metadata line maps to `parseVisualAssetCue()`.
- [ ] Investigation structural parser passes retained lines.
- [ ] Interrogation `PhaseMeta` retains metadata lines and passes them to `parseVisualAssetCue()`.
- [ ] Evidence parser binds `Image Prompt` line from existing manifest metadata entry.
- [ ] Enrichment adds `promptLine + authoredPrompt` to scene-owned typed background/evidence manifest source variants.
- [ ] Workbench never counts/reconstructs `tag_NNN`; it consumes actual `unitId` from manifest.

## 1.5 Single-line source target/renderer

Create:

- `packages/scripts/workbench/source-edit-targets.ts`
- `packages/scripts/workbench/source-edit-targets.test.ts`

Interface:

```ts
export type WorkbenchSourceTargetKind =
  | "readerDialogue"
  | "readerAction"
  | "backgroundPrompt"
  | "evidenceImagePrompt";

export type WorkbenchSourceTarget = {
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  line: number;
  currentText: string;
};

export function renderSceneSourceReplacement(input: {
  source: string;
  target: WorkbenchSourceTarget;
  replacementText: string;
}):
  | { ok: true; nextContent: string }
  | { ok: false; diagnostic: CompileError };
```

### RED cases

Direct lines:

- [ ] dialogue changes only text after `：`, preserving speaker/expression/indent/trailing whitespace/EOL;
- [ ] single-line action changes only bracket contents;
- [ ] multiline action → `workbenchSourceMultilineActionUnsupported`.

Metadata-wrapped Reader items:

```text
- **On Loop:** **人物**：原文
- **Default Challenge:** [原動作]
```

- [ ] outer metadata prefix stays byte-identical;
- [ ] tokenize outer line → metadata; tokenize metadata value → expected dialogue/action;
- [ ] replace only inner logical dialogue/action value;
- [ ] wrong metadata value/current text → stale diagnostic, no search elsewhere.

Prompt lines:

- [ ] `Background Prompt` changes only metadata value at compiler line;
- [ ] `Image Prompt` changes only metadata value at compiler line.

All:

- [ ] reject CR/LF replacement;
- [ ] wrong line syntax/current value rejects;
- [ ] candidate has identical physical line count and exactly one changed line.

### GREEN

Renderer reads only compiler-provided physical line. It may accept:

1. direct dialogue/action token;
2. one metadata token whose value re-tokenizes to dialogue/action;
3. expected Background/Image metadata token.

Never scan another line for matching text. No tokenizer-wide `range` fields.

## 1.6 Real-content verifier now, not Task 4

Create `apps/layout-editor/scripts/verify-focused-edit-real-content.ts` and package script.

It must prove current Chapter 1 has working source identity for:

- [ ] direct Reader dialogue;
- [ ] single-line action;
- [ ] at least one **metadata-wrapped interrogation** Reader dialogue/action target;
- [ ] investigation carrier mapping without raw segment ordering;
- [ ] scene-owned Background Prompt from manifest `unitId + promptLine + authoredPrompt`;
- [ ] evidence Image Prompt from manifest `evidenceId + promptLine + authoredPrompt`;
- [ ] all sampled source values equal compiled Reader/manifest values.

### Task 1 gates

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/workbench/source-edit-targets.test.ts
bun run check:scripts
bun run test:scripts
bun run --cwd apps/layout-editor verify:focused-edit-real-content
```

**HARD STOP:** no Task 2/3/4 implementation while this verifier fails.

---

# Task 2 — Focused draft/diff/impact + stable Reader edit refs

## 2.1 Reader edit ref

- [ ] Add `ReaderEditableRef { carrierId, itemIndex }` only to projected line/action items.
- [ ] Populate inside `carrierGroup()` before any notice decoration can shift display indexes.
- [ ] Reader projection tests cover investigation + interrogation branch refs.

## 2.2 Source resolve + compiled/source stale

Create `focused-edit.ts` / tests.

```ts
export type FocusedEditDraft = {
  sourceDocumentId: SourceDocumentId;
  sourcePath: string;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  expectedLine: number;
  originalText: string;
  replacementText: string;
  nextContent: string;
  impact: FocusedEditImpact;
};
```

- [ ] Reader selection resolves carrier/item source line from compiler data.
- [ ] Direct or metadata-wrapped source logical value must match compiled selected kind/speaker/text.
- [ ] Asset selection metadata value at manifest `promptLine` must equal `authoredPrompt`.
- [ ] Mismatch → `focusedEditCompiledSourceStale`; no draft/Apply.
- [ ] same replacement → `focusedEditNoChange`.

## 2.3 Diff/locality

- [ ] Hand-roll one unified-style hunk + up to 3 context lines; no dependency.
- [ ] Exact source syntax in diff.
- [ ] Assert same physical line count, exactly one changed line, changed line == `expectedLine`.

## 2.4 Impact reuse

- [ ] dialogue/action: selected scene only.
- [ ] background/evidence: selected typed manifest asset + existing `workspace.sceneUsages` for asset ID/scenes/count/shared.
- [ ] no repository scan or generic impact framework.
- [ ] no character/audio edit impact work.

### Task 2 gates

```bash
bun run --cwd apps/layout-editor test src/lib/reader-projection.test.ts src/lib/focused-edit.test.ts src/lib/asset-workspace.test.ts
bun run editor:check
bun run --cwd apps/layout-editor verify:focused-edit-real-content
```

---

# Task 3 — Closed SHA-guarded one-line backend write + bounded validation

## 3.1 Wire contract

HPA-135 v1 document identity:

```ts
export type SourceDocumentId = `scene:${string}:${string}`;
```

Read:

```ts
export type WorkbenchSourceDocument = {
  id: SourceDocumentId;
  path: string;
  content: string;
  hash: string;
};
```

Apply:

```ts
export type ApplyWorkbenchSourceEditRequest = {
  sourceDocumentId: SourceDocumentId;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  expectedLine: number;
  nextContent: string;
};
```

Only:

```text
load_workbench_source_document
apply_workbench_source_edit
```

## 3.2 Scene resolver + SHA

### RED

- [ ] known manifest scene resolves canonical Markdown;
- [ ] malformed/traversal/unknown scene rejects;
- [ ] SHA changes when exact source bytes change.

### GREEN

- [ ] reuse existing manifest/canonical source containment helpers;
- [ ] `sha2` only in layout-editor Rust crate;
- [ ] lowercase SHA-256 of exact UTF-8 source; no hash service abstraction.

## 3.3 Focused document guard + atomic write

### RED pre-write rejections

```text
stale expectedHash
unsupported ref/kind
no change
line count change
>1 changed physical line
changed line != expectedLine
```

Valid write preserves every other physical line byte-for-byte.

### GREEN

```text
resolve
→ read
→ hash
→ ref/kind validation
→ one-expected-line document check
→ atomic write
→ validation
```

- [ ] Generalize current same-directory temp + `create_new` + `sync_all` + rename writer for an already-resolved text path.
- [ ] Reuse it for layout sidecars and Workbench source.
- [ ] No UTF-16/source-range logic.

## 3.4 Bounded `scenes:compile`

Only validation:

```text
bun run scenes:compile
```

### Tests

- [ ] injected runner: exact executable/argv/cwd;
- [ ] first non-zero stop;
- [ ] bounded stdout/stderr;
- [ ] timeout result;
- [ ] one real Bun process/cwd test in temp workspace.

### Production

- [ ] `std::process::Command`, explicit args, canonical workspace cwd;
- [ ] target timeout 120 seconds;
- [ ] concurrently drain stdout/stderr while child runs;
- [ ] poll completion and kill on deadline;
- [ ] timeout returns `sourceEditValidationTimeout` diagnostics.

After atomic write, non-zero/timeout → `validation.ok = false`, source remains written.

### Task 3 gates

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml focused_source
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
```

---

# Task 4 — Shared review UI + full/live acceptance

## 4.1 Reader/Assets affordances

### Reader

- [ ] Create `ReaderView.test.ts` (new file).
- [ ] Edit for resolved dialogue + resolved single-line action only.
- [ ] Metadata-wrapped interrogation item can still open the same edit flow when compiler source resolver supports it.
- [ ] Multiline action no Edit.
- [ ] Reader emits selection only; no source I/O.

### Assets

- [ ] Edit only scene-owned Background Prompt + evidence Image Prompt with manifest source data.
- [ ] character visualPrompt/expression/audio rows remain read-only.
- [ ] global/character-owned background/evidence remain non-editable.
- [ ] Assets emits selection only; no writes.

## 4.2 One review surface

Create `FocusedEditReview.svelte` once from `App.svelte`.

States:

```text
idle
loading-source
editing
applying
applied-valid
applied-invalid
error
```

Review shows path/ref/current/replacement/exact diff/impact/Apply/Cancel and stale/validation diagnostics.

`App.svelte` owns one active draft. HPA-136 reuse seam:

```ts
openFocusedEdit(selection, initialReplacement?)
```

No second writer.

## 4.3 Component/app tests

```bash
bun run --cwd apps/layout-editor test \
  src/lib/ReaderView.test.ts \
  src/lib/AssetsView.test.ts \
  src/lib/FocusedEditReview.test.ts \
  src/App.test.ts
```

Cover:

- [ ] supported/deferred affordances;
- [ ] direct + metadata-wrapped Reader edit opening;
- [ ] shared review path;
- [ ] compiled-source stale;
- [ ] backend stale hash;
- [ ] applied-valid/applied-invalid/timeout;
- [ ] apply request has only scene ID/hash/ref/kind/expectedLine/nextContent;
- [ ] success refreshes Reader/Assets; failed validation does not pretend fresh projections.

## 4.4 Full gates

```bash
bun run scenes:compile
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

No audio gates: HPA-135 changes no audio source/workflow code.

## 4.5 Live throwaway smoke

Before marking PR #84 ready:

1. use real Story Workbench on a Chapter 1 supported target;
2. make harmless temporary text replacement;
3. confirm diff shows exactly one authored Markdown line;
4. Apply;
5. confirm automatic `scenes:compile` returns valid;
6. confirm Reader/Assets refresh;
7. Git revert temporary source;
8. rerun `scenes:compile` to restore generated resources;
9. confirm final PR diff contains no smoke content.

This — not `editor:build` — proves Apply → compiler validation.

---

# Completion locks

- [ ] Four Markdown target families work through one shared review/apply seam.
- [ ] Task-1 real Chapter 1 source identity verifier passed before downstream implementation.
- [ ] Direct + metadata-wrapped Reader source locations are compiler-owned and exact.
- [ ] Background/evidence source identity comes from manifest `unit/evidence + promptLine + authoredPrompt`.
- [ ] No Workbench tag counting / whole-scene text zipper / tokenizer range plumbing.
- [ ] Multiline action is read-only.
- [ ] Compiled/source stale is named and loud.
- [ ] Backend SHA-guards + enforces one expected changed line.
- [ ] Validation is bounded with visible diagnostics.
- [ ] Applied-but-invalid has no fake rollback.
- [ ] Compiler source metadata does not leak into runtime scene JSON.
- [ ] Character/expression/audio YAML edit support is absent, not half-built.
- [ ] No queue/history/general editor/arbitrary write/AI/Git automation.
- [ ] HPA-136 can reuse `FocusedEditReview` + apply boundary.
- [ ] Full gates + live smoke recorded before Draft removal.
