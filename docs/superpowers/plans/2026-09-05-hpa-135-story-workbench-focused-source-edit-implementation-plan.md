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
  currentText: string;
  sourceRange: SourceRange;
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
```

Reader owns semantic refs:

```ts
export type ReaderEditableRef = {
  carrierId: string;
  itemIndex: number;
};
```

### Required Task 1 behavior

- [ ] Add raw token `range` to every tokenizer token and editable `valueRange` to metadata/dialogue/action.
- [ ] Preserve indentation/CRLF source spelling in ranges while leaving normalized token semantics unchanged.
- [ ] Update all existing whole-token `tokenizer.test.ts` fixtures for new fields; add indented, CRLF, CJK, and multiline-action tests.
- [ ] Extract `sceneTagUnitId(oneBasedIndex)` and reuse it from enrichment + edit discovery; count all tags including prompt-less tags.
- [ ] Parse through the existing parser for the actual scene type before exposing any prompt target.
- [ ] Use parsed AST owner IDs/lines for structural Background Prompt/evidence Image Prompt association; tokenizer only supplies the accepted metadata value range.
- [ ] Add `ReaderEditableRef` from existing `carrierGroup()` carrier ID + item index.
- [ ] Bind lexical line/action source tokens by flattening the existing Reader group tree in rendered order, not `deriveDialogueSegments()` array order.
- [ ] Add a real-shaped investigation fixture covering intro, hotspot inspect, topic dialogue, evidence onCollect, and outro last; mismatch returns `workbenchSourceDialogueMismatch` and no guessed target.
- [ ] Character identity uses `parseCharactersYamlText()`, sound-plan identity/status uses `parseSoundPlanText()`.
- [ ] YAML mutation uses `YAML.parseDocument()` + semantic re-resolution + `node.set()` + `doc.toString()`; no custom scalar renderer.
- [ ] Mutation tests prove canonical reparsing succeeds, comments survive, unrelated semantic entries are unchanged.

### Task 1 gates

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/tokenizer.test.ts
bunx vitest run --config vitest.scripts.config.ts packages/scripts/workbench/source-edit-targets.test.ts
bun run --cwd apps/layout-editor test src/lib/reader-projection.test.ts
bun run check:scripts
bun run test:scripts
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

**Interface:**

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

### Required Task 2 behavior

- [ ] Require existing catalog entry; replace prompt only; preserve `loop` exactly.
- [ ] Keep regression proving normal `mergeApprovedEntriesIntoCatalog()` still conflicts on changed prompts.
- [ ] `revise-prompt` loads/validates the sound plan, requires exactly one approved/generated matching entry, reads that plan prompt, revises only the existing catalog prompt, serializes through existing audio catalog formatter, and never applies scene cues.
- [ ] Reject invalid channel, missing/duplicate/non-approved plan entries, and missing catalog entry.
- [ ] Add root/package forwarding scripts.

### Task 2 gates

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/audio/audio-catalog.test.ts packages/scripts/audio/cli.test.ts
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
```

---

## Task 3: Add closed source reads, hash-guarded full-document writes, and tested validation execution

**Files:**
- Modify/Test: `apps/layout-editor/src-tauri/Cargo.toml`
- Modify/Test: `apps/layout-editor/src-tauri/src/lib.rs`
- Modify: `apps/layout-editor/src/lib/workbench-types.ts`
- Modify: `apps/layout-editor/src/lib/workbench-api.ts`

**Wire contract:**

```ts
export type ApplyWorkbenchSourceEditRequest = {
  sourceDocumentId: SourceDocumentId;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  nextContent: string;
};
```

No source range crosses IPC.

### Required Task 3 behavior

- [ ] Closed resolver supports `scene:<chapter>:<scene>`, `asset-config:characters`, `audio-plan:<chapter>` only.
- [ ] Hash exact UTF-8 source bytes using SHA-256.
- [ ] Stale hash, kind/ref/document mismatch, and no-change all reject before write.
- [ ] Generalize existing same-directory temp + `create_new` + `sync_all` + rename writer and reuse it for layout sidecars plus full reviewed source documents.
- [ ] Story/character validation plan is `bun run scenes:compile`.
- [ ] Audio validation plan is `audio:revise-prompt` → `audio:validate` → `audio:apply --check` → `scenes:compile`.
- [ ] Add private `execute_validation_plan_with` fake-runner seam proving exact argv/cwd/order, bounded diagnostics, and first non-zero stop.
- [ ] Add one real `std::process::Command` test using `bun -e 'process.stdout.write(process.cwd())'` in a temp workspace to prove production cwd/spawn behavior.
- [ ] Register only `load_workbench_source_document` and `apply_workbench_source_edit`; no generic read/write/run IPC.
- [ ] No Rust UTF-16 mapper or range slicing exists.

### Task 3 gates

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml focused_source
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
```

---

## Task 4: Build the focused draft, exact diff, locality guard, and impact joins

**Files:**
- Create/Test: `apps/layout-editor/src/lib/focused-edit.ts`
- Create/Test: `apps/layout-editor/src/lib/focused-edit.test.ts`
- Modify/Test: `apps/layout-editor/src/lib/asset-workspace.ts`
- Modify/Test: `apps/layout-editor/src/lib/asset-workspace.test.ts`

### Required Task 4 behavior

- [ ] `FocusedEditDraft` stores `sourceDocumentId`, path, expected hash, semantic ref/kind, logical old/new text, full reviewed `nextContent`, and impact; no IPC range.
- [ ] Produce one unified-style focused hunk with up to three context lines and no diff dependency.
- [ ] The selected source range/YAML node block is the locality guard: if `nextContent` changes any unrelated position, return `focusedEditSourceChurn` and disable Apply.
- [ ] Reader impact = one selected scene.
- [ ] Background/evidence/character impacts reuse current `sceneUsages`, typed manifest source, expression counts, and `assetUsageGroups()`.
- [ ] Audio `(channel,id)` comes from typed manifest source. Collect concrete scene usage chapter IDs; Edit only when exactly one distinct chapter owns current usages. Zero/multiple chapters → `focusedEditAudioPlanAmbiguous`, no guessed plan.
- [ ] Build draft only after `renderSourceReplacement()` yields `nextContent` and focused locality validation succeeds.

### Task 4 gates

```bash
bun run --cwd apps/layout-editor test src/lib/focused-edit.test.ts src/lib/asset-workspace.test.ts
bun run editor:check
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

### Required Task 5 behavior

- [ ] Create `ReaderView.test.ts`; it is not an existing file.
- [ ] Reader Edit appears only for line/action and emits semantic selection; ReaderView does not load/write source.
- [ ] Assets Edit appears only for supported scene prompts, existing character prompts, and unambiguous one-chapter audio owner.
- [ ] One `FocusedEditReview` shows replacement, exact diff, impact/shared warning, Apply/Cancel, stale, applied-valid, and **Applied, validation failed** states.
- [ ] Apply request contains only `SourceDocumentId + expectedHash + kind + semanticRef + nextContent`.
- [ ] `App.svelte` owns one active edit flow; Reader and Assets share it; Plan stays read-only.
- [ ] HPA-136 can supply `initialReplacement` into the same draft/review seam without a second writer.

### Task 5 gates

```bash
bun run --cwd apps/layout-editor test src/lib/ReaderView.test.ts src/lib/AssetsView.test.ts src/lib/FocusedEditReview.test.ts src/App.test.ts
bun run editor:check
```

---

## Task 6: Prove real Chapter 1 target discovery, live write/validation, and full repository gates

**Files:**
- Create: `apps/layout-editor/scripts/verify-focused-edit-real-content.ts`
- Modify: `apps/layout-editor/package.json`
- Update: PR #84 / Linear evidence after verification

### Required Task 6 behavior

- [ ] Read-only verifier finds at least one real target for all seven families.
- [ ] Reader verifier coverage must include a real investigation and assert hotspot/topic/outro binding; a linear-only success is insufficient.
- [ ] Run compiler/scripts/layout-editor/Rust/audio/lint gates below.
- [ ] Live Workbench smoke: make a harmless Chapter 1 dialogue/action edit, inspect one focused diff, Apply, observe backend `scenes:compile`, confirm refreshed projection, Git-revert source, compile clean again. `editor:build` is not a substitute.
- [ ] Audio smoke: edit an unambiguous Chapter 1 sound-plan prompt, confirm backend runs `revise-prompt` → validate → apply-check → compile, confirm temporary sound plan + derived catalog change, then Git-revert both and revalidate. Do not generate media.
- [ ] Scope self-review confirms no source range in IPC, no Rust UTF-16 mapper, no copied Reader traversal in scripts, no custom YAML scalar renderer, no generic IPC, no queue/history/undo, no Plan edit, no direct Workbench audio.yaml write, and no runtime scene schema change.

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