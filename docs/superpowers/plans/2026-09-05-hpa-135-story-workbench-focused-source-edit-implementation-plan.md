# HPA-135 Story Workbench Focused Source Edit Implementation Plan

> **Implementation mode:** continue on PR #84. Use `superpowers:test-driven-development` for implementation and `superpowers:verification-before-completion` before changing Draft/ready state.

**Goal:** ship the first safe Story Workbench write seam for four byte-stable scene-Markdown targets: dialogue, single-line action, scene-owned Background Prompt, and evidence Image Prompt.

**Architecture:** compiler parsing/enrichment owns authored source identity; Workbench renders one exact single-line source mutation and one-hunk diff; Rust resolves only a closed scene document, hash-guards it, enforces one expected changed line, atomically writes the reviewed full document, and runs bounded `scenes:compile` validation.

**Deliberately deferred:** character visualPrompt, character expression prompt, and audio/sound-plan prompt editing. Real YAML round-trips are not focused/byte-local enough for HPA-135.

**Spec:** `docs/superpowers/specs/2026-09-05-hpa-135-story-workbench-focused-source-edit-design.md`

## Global constraints

- One ticket, one PR: implementation stays on PR #84.
- Exactly four editable kinds in HPA-135:
  - `readerDialogue`
  - `readerAction`
  - `backgroundPrompt`
  - `evidenceImagePrompt`
- Character/audio rows remain readable in Assets but have no HPA-135 Edit action.
- No arbitrary path, generic field editor, generic Markdown/YAML editor, queue, autosave, history, Workbench undo, AI provider, Git automation, or media generation.
- Production scene JSON/runtime schema stays unchanged.
- No tokenizer-wide raw range fields and no Rust UTF-16 mapper.
- Multiline actions are read-only in v1.
- `expectedHash` remains the stale-write token; do not replace it with a generic hashing abstraction.
- Validation failure/timeout after a successful write is **Applied, validation failed**; no automatic rollback.

---

## File map

### New

- `packages/scripts/workbench/source-edit-targets.ts`
- `packages/scripts/workbench/source-edit-targets.test.ts`
- `apps/layout-editor/src/lib/focused-edit.ts`
- `apps/layout-editor/src/lib/focused-edit.test.ts`
- `apps/layout-editor/src/lib/FocusedEditReview.svelte`
- `apps/layout-editor/src/lib/FocusedEditReview.test.ts`
- `apps/layout-editor/src/lib/ReaderView.test.ts`
- `apps/layout-editor/scripts/verify-focused-edit-real-content.ts`

### Expected modifications

Compiler/source identity:

- `packages/scripts/compile-scenes/types.ts`
- `packages/scripts/compile-scenes/parser-common.ts`
- `packages/scripts/compile-scenes/parser-linear.ts`
- `packages/scripts/compile-scenes/parser-manifest.ts`
- `packages/scripts/compile-scenes/parser-interrogation.ts`
- `packages/scripts/compile-scenes/parser-assets.ts`
- `packages/scripts/compile-scenes/dialogue-segment-origins.ts`
- `packages/scripts/compile-scenes/emitter.ts`
- `packages/scripts/compile-scenes/assets/manifest.ts`
- `packages/scripts/compile-scenes/assets/enrich.ts`
- focused tests adjacent to those owners

Workbench frontend:

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

Backend:

- `apps/layout-editor/src-tauri/Cargo.toml`
- `apps/layout-editor/src-tauri/src/lib.rs`

No audio workflow/catalog files are modified by HPA-135.

---

# Task 1 — Put exact authored identity in the compiler and prove it on real Chapter 1 content

This is the prerequisite task. Do not start backend/UI implementation until the real-content verifier passes.

## 1A. Dialogue/action item source line

### RED tests

- [ ] Add parser tests proving every parsed dialogue/action item carries its authored `sourceLine`.
- [ ] Cover at least:
  - linear dialogue + action;
  - investigation intro/hotspot/topic/evidence/outro dialogue;
  - interrogation testimony/branch dialogue;
  - analysis dialogue.
- [ ] Include evidence/statement manifest dialogue so the test catches the fact that `parser-manifest.ts` has its own dialogue consumer.

Do not assume `parser-common.ts` is the only item-construction path.

### Implementation

- [ ] Add optional compiler-only `sourceLine?: number` to `DialogueItem` variants in `types.ts`.
- [ ] Set it from the tokenizer token in every current line/action construction path:
  - `parser-linear.ts`;
  - `parser-common.ts`;
  - `parser-manifest.ts`;
  - interrogation-specific dialogue consumer(s).
- [ ] Keep parsing semantics unchanged.

### Emitter lock

- [ ] Add RED emitter tests proving `sourceLine` never appears in emitted `JSONDialogueItem`.
- [ ] Replace the current sceneTag spread / non-line by-reference emission with explicit JSON construction for all three variants.

Expected invariant:

```text
AST/compiler data may carry sourceLine
runtime scene JSON never carries sourceLine
```

## 1B. Share carrier identity with the compiler owner

### RED tests

- [ ] Add/extend `dialogue-segment-origins` tests for carrier spelling across linear, investigation, interrogation, and analysis.
- [ ] Add an investigation regression where source/Reader semantics cover:

```text
intro
hotspot:<id>:inspect
topic:<character>:<topic>:dialogue
evidence:<id>:onCollect
outro
```

The test must not depend on the raw array position of `deriveDialogueSegments()`.

### Implementation

- [ ] Move the current Reader carrier spelling function into `dialogue-segment-origins.ts`:

```ts
export function dialogueSegmentCarrierId(
  origin: DialogueSegmentOriginV1,
): string;
```

- [ ] `reader-projection.ts` imports it; remove its local duplicate mapping.
- [ ] When `deriveDialogueSegments()` receives `sourceAst`, expose compiler item source lines parallel to the segment's emitted items.
- [ ] Resolve source owners by the same semantic IDs/origins used for the segment; do not use one global flatten/order zipper.
- [ ] Source mismatch is carrier-local. One stale carrier must not disable unrelated carriers.

Target identity becomes:

```text
dialogueSegmentCarrierId(origin) + emitted itemIndex + sourceLine
```

## 1C. Put prompt authored line/value into the existing asset manifest

### RED tests

- [ ] Scene-tag Background Prompt: manifest source contains actual enrichment `unitId`, exact prompt metadata line, and literal authored prompt.
- [ ] Structural investigation/phase Background Prompt: same contract.
- [ ] Evidence Image Prompt: manifest source contains evidence ID, exact prompt line, and literal authored prompt.
- [ ] Add a regression proving investigation `promptParts.entryPrompt` may contain guidance suffix while `source.authoredPrompt` remains only the literal authored value.
- [ ] Add emitter/runtime regression proving compiler-only prompt line metadata is absent from scene JSON.

### Implementation

- [ ] Extend compiler-only cue data:

```ts
backgroundPromptLine?: number | null
imagePromptLine?: number | null
```

- [ ] `consumeMetadata()` retains a key→line map in addition to values; existing callers can continue using values.
- [ ] Pass scene-tag `metadataLines` into `parseVisualAssetCue()`.
- [ ] Structural parsers pass retained metadata lines into `parseVisualAssetCue()`.
- [ ] Evidence parser binds `Image Prompt` from its existing `ManifestMetadata` line.
- [ ] Extend scene-owned background/evidence manifest source variants with:

```text
promptLine
authoredPrompt
```

- [ ] `enrichVisualCue()` / evidence enrichment forward the actual parser-owned line/value into the manifest source.
- [ ] Workbench never derives/counts `tag_NNN`; it consumes the actual `unitId` emitted by enrichment.

## 1D. Single-line source-target helper

Create `packages/scripts/workbench/source-edit-targets.ts`.

### Interface

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

### RED tests

- [ ] Dialogue changes only text after `：`; speaker/expression/indent/trailing whitespace/EOL are unchanged.
- [ ] Action changes only bracket content when `[` and `]` are on the same source line.
- [ ] Multiline action returns `workbenchSourceMultilineActionUnsupported` and no candidate document.
- [ ] Background Prompt changes only the metadata value on `promptLine`.
- [ ] Image Prompt changes only the metadata value on `promptLine`.
- [ ] All four reject replacement containing CR/LF.
- [ ] Wrong line syntax or current logical value returns stale/mismatch diagnostic; never text-search elsewhere.
- [ ] Candidate document has identical line count and exactly one changed line.

### Implementation

- [ ] Read the compiler-provided line from the exact source text.
- [ ] Validate that one raw line tokenizes/parses as the expected target/current value.
- [ ] Perform one line-local value splice only.
- [ ] Do not add tokenizer-wide `range`/`valueRange` fields.

## 1E. Real Chapter 1 gate — move this here

Create `apps/layout-editor/scripts/verify-focused-edit-real-content.ts` now.

It must read current generated resources + authored source and prove:

- [ ] one dialogue target resolves by carrier/item to the expected source line;
- [ ] one single-line action target resolves;
- [ ] an investigation hotspot/topic/outro mapping resolves without raw segment-order assumptions;
- [ ] one scene-owned Background Prompt resolves from manifest `unitId + promptLine + authoredPrompt`;
- [ ] one evidence Image Prompt resolves from manifest `evidenceId + promptLine + authoredPrompt`;
- [ ] source logical values equal the compiled Reader/manifest values.

Add package script:

```text
verify:focused-edit-real-content
```

### Task 1 gates

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/workbench/source-edit-targets.test.ts
bun run check:scripts
bun run test:scripts
bun run --cwd apps/layout-editor verify:focused-edit-real-content
```

**Hard stop:** do not proceed if the real-content verifier fails.

---

# Task 2 — Build the focused draft/diff/impact model and edit selection

## 2A. Reader selection identity

`ReaderItem` line/action items need the compiler item index even when notices are prepended to the displayed group.

- [ ] Add `ReaderEditableRef { carrierId, itemIndex }` only to projected line/action items.
- [ ] Populate it inside `carrierGroup()` before any notice decoration changes rendered item indexes.
- [ ] Scene tags/notices have no edit ref.
- [ ] Reader projection tests prove investigation carrier/item refs remain stable.

## 2B. Focused draft and compiled-vs-source stale check

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

- [ ] On open, resolve current source target using compiler-owned identity.
- [ ] Reader selection: current source kind/speaker/text must still match compiled selected item.
- [ ] Asset selection: metadata value at manifest `promptLine` must still equal manifest `authoredPrompt`.
- [ ] Mismatch returns `focusedEditCompiledSourceStale`; no draft/Apply.
- [ ] Equal replacement returns `focusedEditNoChange`.

## 2C. Exact one-hunk diff

- [ ] Hand-roll one unified-style hunk with up to three context lines; no diff dependency.
- [ ] Assert current→candidate line count is unchanged.
- [ ] Assert exactly one line differs and it equals `expectedLine`.
- [ ] Diff shows exact authored source syntax, not only logical text.

## 2D. Impact reuse

- [ ] Dialogue/action: selected scene only (`usageCount = 1`, `shared = false`).
- [ ] Background/evidence: use the selected typed manifest entry + existing `workspace.sceneUsages`; show affected scene IDs, asset ID, count, shared flag.
- [ ] No new repository scan or generic impact framework.
- [ ] Character/audio impact display remains current read-only behavior; no edit impact code is needed for those families.

### Task 2 gates

```bash
bun run --cwd apps/layout-editor test src/lib/reader-projection.test.ts src/lib/focused-edit.test.ts src/lib/asset-workspace.test.ts
bun run editor:check
bun run --cwd apps/layout-editor verify:focused-edit-real-content
```

---

# Task 3 — Add the closed, stale-safe, one-line backend write + bounded validation

## 3A. Wire types

HPA-135 v1 document identity is scene-only:

```ts
export type SourceDocumentId = `scene:${string}:${string}`;
```

Read result:

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

Only two IPC commands:

```text
load_workbench_source_document
apply_workbench_source_edit
```

No generic file or command API.

## 3B. Closed resolver + hash

### RED Rust tests

- [ ] valid manifest-backed scene resolves to canonical authored Markdown;
- [ ] malformed/traversal/unknown scene IDs reject;
- [ ] SHA-256 changes when source bytes change.

### Implementation

- [ ] Reuse current manifest/canonical scene resolver and workspace containment helpers.
- [ ] Add `sha2` only to the layout-editor Rust crate.
- [ ] Hash exact UTF-8 source bytes; no hashing service/abstraction.

## 3C. Focused full-document guard

### RED tests

Assert no write for:

```text
stale expectedHash
unsupported semantic ref/kind
no change
line count change
more than one changed line
changed line != expectedLine
```

Valid request changes exactly the expected line and preserves every other byte.

### Implementation

Apply order:

```text
resolve
→ read
→ hash compare
→ semantic ref/kind family check
→ focused one-line document diff check
→ atomic write
→ validation
```

Generalize the existing `write_layout_sidecar_no_follow` implementation into a narrow already-resolved-path atomic text writer; keep temp file in same directory, `create_new`, `sync_all`, rename, best-effort cleanup.

No UTF-16/range mapper exists.

## 3D. Bounded `scenes:compile` runner

The only validation plan is:

```text
bun run scenes:compile
```

### Test seam

- [ ] Pure/injected runner test proves exact executable/argv/cwd.
- [ ] First non-zero stops validation.
- [ ] Stdout/stderr returned to UI is bounded.
- [ ] Timeout result is represented distinctly.
- [ ] One real process test runs a tiny Bun command from a temp workspace and proves cwd/spawn behavior.

### Production runner

- [ ] Use `std::process::Command`, never a shell string.
- [ ] Fixed timeout target: 120 seconds.
- [ ] Drain child stdout/stderr while running so pipe buffers cannot deadlock the child.
- [ ] Poll child completion; kill on deadline and return `sourceEditValidationTimeout` diagnostics.

A write followed by non-zero/timeout returns an apply result with `validation.ok = false`; the source remains written.

### Task 3 gates

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml focused_source
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
```

---

# Task 4 — Wire one shared review UI and prove the live path

## 4A. Reader/Assets affordances

### Reader

- [ ] Create `apps/layout-editor/src/lib/ReaderView.test.ts` — it does not exist on main.
- [ ] Edit appears only on dialogue and single-line action targets that resolve successfully.
- [ ] Multiline action has no Edit affordance.
- [ ] Reader emits semantic selection only; no source I/O in `ReaderView.svelte`.

### Assets

- [ ] Edit appears only for scene-owned Background Prompt and evidence Image Prompt with compiler-owned source identity.
- [ ] Character visualPrompt, expression prompt, and audio remain read-only in HPA-135.
- [ ] Global/character-owned background/evidence sources remain non-editable.
- [ ] Assets emits semantic selection only; no source writes in `AssetsView.svelte`.

## 4B. Shared review

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

No state-machine framework.

Review shows:

- source path;
- semantic ref;
- current/replacement text;
- exact one-hunk Markdown diff;
- usage impact/shared warning;
- Apply/Cancel;
- compiled-source stale, external stale-hash, validation failure/timeout diagnostics.

`App.svelte` owns the one active draft. Reader and Assets share exactly the same apply command/review component.

HPA-136 reuse seam:

```ts
openFocusedEdit(selection, initialReplacement?)
```

AI never receives a second writer.

## 4C. Component/app tests

```bash
bun run --cwd apps/layout-editor test \
  src/lib/ReaderView.test.ts \
  src/lib/AssetsView.test.ts \
  src/lib/FocusedEditReview.test.ts \
  src/App.test.ts
```

Cover:

- [ ] Reader/Assets supported/unsupported affordances;
- [ ] shared review path;
- [ ] stale compiled source;
- [ ] stale backend hash;
- [ ] applying/applied-valid/applied-invalid;
- [ ] exact request contains scene document ID/hash/ref/kind/expectedLine/nextContent only;
- [ ] successful validation refreshes current Reader/Assets data;
- [ ] failed validation does not pretend projections refreshed successfully.

## 4D. Full gates

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

Do not run audio validation/apply gates: HPA-135 no longer changes audio code or audio sources.

## 4E. Live throwaway acceptance smoke

Before marking PR #84 ready:

1. launch/use the real Story Workbench;
2. select a real Chapter 1 dialogue or action target;
3. make a harmless temporary replacement;
4. confirm reviewed diff shows exactly one authored Markdown line;
5. Apply;
6. confirm backend automatically runs `bun run scenes:compile` and reports valid;
7. confirm Reader/Assets refresh;
8. revert the temporary source edit with Git;
9. rerun `bun run scenes:compile` so generated resources return to repository state;
10. confirm `git diff --check` / final PR diff contains no smoke content.

This live smoke — not `editor:build` — is the acceptance proof for Apply → compiler validation.

---

# Completion locks

HPA-135 is not complete until all are true:

- [ ] Four Markdown edit families work through one reviewed seam.
- [ ] Real Chapter 1 source identity gate passes before UI/backend completion.
- [ ] Dialogue/action identity is compiler carrier/item/line based, not whole-scene text/order matching.
- [ ] Background/evidence identity comes from typed manifest `unit/evidence + promptLine + authoredPrompt`, not tag counting.
- [ ] Multiline actions are explicitly read-only.
- [ ] Compiled-vs-source mismatch is a named loud state.
- [ ] Backend hash-guards and enforces exactly one expected changed line.
- [ ] Validation is bounded and diagnostics are visible.
- [ ] Applied-but-invalid has no fake rollback.
- [ ] Compiler-only source metadata does not leak into production scene JSON.
- [ ] Character/expression/audio YAML edit support is absent, not half-implemented.
- [ ] No queue/history/general editor/arbitrary write/AI/Git automation was introduced.
- [ ] HPA-136 can reuse the same `FocusedEditReview` + apply boundary.
- [ ] Full gates + live smoke are recorded before Draft is removed.
