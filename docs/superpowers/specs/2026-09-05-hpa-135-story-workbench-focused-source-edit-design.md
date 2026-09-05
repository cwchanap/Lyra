# HPA-135 Story Workbench Focused Source Edit Design

## Status

Planning design for **HPA-135 — [Story Workbench] Edit one story or prompt source through a reviewed diff**.

One ticket, one PR. This PR starts planning-only and carries implementation after review. Do not split HPA-135 into separate planning and implementation PRs.

## Why HPA-135 is next

The Story Workbench read-only foundation is complete:

- HPA-634 Reader owns continuous scene/carrier projection.
- HPA-134 Assets owns canonical prompt layers and usage impact.
- HPA-273 Plan owns read-only Story Bible / reveal context.
- HPA-136 AI review is blocked by HPA-135 and must reuse this exact reviewed edit/apply boundary.
- Chapter 2 / later-chapter platform work remains deferred.

HPA-135 is therefore the smallest next step: add one controlled human-authored write seam without turning the Workbench into an editor platform.

## Review disposition

The product cut remains unchanged. The implementation shape is revised to reuse current owners more directly:

1. **Reader owns dialogue/action identity and traversal.** Do not flatten `deriveDialogueSegments()` in scripts order. Investigation and interrogation segment arrays place outro before their body segments, while Reader consumes outro last.
2. **Existing scene parsers own prompt association.** Source indexing validates through the real scene parser first, then uses parser-owned AST identity plus tokenizer ranges only to slice the already-validated metadata token.
3. **YAML writes use the existing `yaml` Document mutation pattern.** Do not build a second scalar renderer around YAML node ranges.
4. **Tokenizer ranges describe raw source, not normalized token text.** Add separate editable value ranges for dialogue/action/metadata while preserving parser semantics.
5. **Rust writes the reviewed `nextContent`.** No Rust UTF-16 walker and no source range in IPC. The closed document ID + expected SHA-256 guard protects against stale writes; frontend tests prove the reviewed edit changes only the intended source target.
6. **Validation process execution gets a real test seam.** The first `std::process::Command` use in the layout editor must have argv/cwd/non-zero-stop coverage.
7. **Audio plan ownership is explicit.** `(channel,id)` comes from the typed manifest source; the owning chapter comes from current concrete usage and must resolve to exactly one chapter for v1.

This removes more machinery than it adds and keeps the HPA-135 product scope intact.

## Goal

Let an author select **one supported story text or prompt value**, type one replacement, inspect the exact authored-source diff plus usage impact, explicitly apply it through a stale-safe backend boundary, and see authoritative validation.

```text
select one supported value
→ type replacement
→ review exact diff + impact
→ Apply or Cancel
→ stale-safe known-document write
→ authoritative validation
→ refresh existing Reader / Assets projection
```

Git remains durable history. HPA-135 adds no proposal database, revision timeline, autosave queue, branch/commit automation, or Workbench-owned undo history.

## Supported edit targets

Exactly seven semantic target kinds are editable.

| Surface | Target | Canonical authored source |
|---|---|---|
| Reader | one dialogue line text | selected scene Markdown |
| Reader | one action / stage-direction text | selected scene Markdown |
| Assets | one scene-owned visual unit `Background Prompt` | selected scene Markdown |
| Assets | one evidence `Image Prompt` | selected scene Markdown |
| Assets → Characters | one existing character `visualPrompt` | `static/assets/config/characters.yaml` |
| Assets → Characters | one existing character expression `prompt` | `static/assets/config/characters.yaml` |
| Assets → Audio | one existing audio prompt | owning `docs/audio_plans/chapter_<N>.sound-plan.yaml` |

Do not add edit affordances for titles, summaries, IDs, statuses, unlocks, reveals, evidence descriptions, statement content, BGM/BGS assignment, audio loop/status/provider metadata, Plan-mode documents, city-map JSON, global style/type prompts, arbitrary manifest fields, or missing fields.

Unsupported selections simply have no Edit action. There is no generic field/path editor underneath.

## Product contract

### One active edit

Only one `FocusedEditDraft` exists at a time. No queue, history, autosave, or multi-edit batching.

### Review before apply

Before Apply is enabled, one shared review surface shows:

1. authored source path;
2. semantic reference;
3. current logical value;
4. replacement logical value;
5. exact one-file source diff;
6. affected scenes/assets/usages;
7. shared-source warning when applicable;
8. for audio, owning sound plan plus derived catalog synchronization note;
9. Apply and Cancel.

Changing the replacement recomputes `nextContent` and the diff locally. It does not write.

### Apply semantics

On Apply, the backend:

1. resolves a closed `sourceDocumentId` to a canonical repository-owned file;
2. rereads the current source;
3. rejects a stale `expectedHash`;
4. validates source-document category, target kind, and semantic-ref family;
5. rejects `nextContent` when it is byte-for-byte identical to current content;
6. atomically writes the reviewed `nextContent` to the already-resolved path;
7. runs the fixed target-specific authoritative validation;
8. returns the new hash plus validation result.

There is no frontend-supplied filesystem path or shell command.

The backend deliberately does **not** reimplement Markdown/YAML target slicing. The frontend source-target tests prove `nextContent` is the one focused mutation shown in the reviewed diff. This matches the existing layout-editor write style: domain IDs resolve a file, then the backend writes a fully serialized document.

## Architecture

```text
Reader / Assets selection
        │
        ├── Reader traversal owns carrierId + itemIndex
        └── Assets owns typed prompt source + usage impact
        │
        ▼
load_workbench_source_document(SourceDocumentId)
        │ known source + SHA-256
        ▼
@lyra/scripts/workbench/source-edit-targets.ts
        │ compiler-owned source discovery / YAML Document mutation
        │
        ├── scene lexical line/action slices ──┐
        │                                      │
        └── prompt semantic targets            │
                                               ▼
                                  Reader binds lexical slices
                                  to its existing traversal refs
                                               │
                                               ▼
focused-edit.ts → one FocusedEditDraft + nextContent + exact diff + impact
                                               │
                                               ▼
FocusedEditReview.svelte → explicit human Apply
                                               │
                                               ▼
apply_workbench_source_edit
Rust: known doc + hash guard + atomic full-document write + fixed validation
        │
        ├── story/character → scenes:compile
        │
        └── audio → audio:revise-prompt
                    → audio:validate
                    → audio:apply --check
                    → scenes:compile
```

Production scene JSON stays unchanged.

## Source document identity

Use a closed vocabulary:

```ts
export type SourceDocumentId =
  | `scene:${string}:${string}`
  | "asset-config:characters"
  | `audio-plan:${string}`;
```

The interpolated values are IDs, never paths.

### Scene documents

`scene:<chapterId>:<sceneId>` resolves through the existing compiler-generated chapter manifest and authored-scene containment path used by the Workbench scene loader.

### Character config

`asset-config:characters` resolves to the fixed path:

```text
static/assets/config/characters.yaml
```

### Audio plan

`audio-plan:<chapterId>` resolves only after proving the chapter exists, then maps to:

```text
docs/audio_plans/<chapterId>.sound-plan.yaml
```

Reject malformed IDs, separators, traversal, unknown chapters/scenes, and unsupported prefixes.

## Source snapshot contract

Add one fixed-domain read command:

```text
load_workbench_source_document(sourceDocumentId)
```

Frontend shape:

```ts
export type WorkbenchSourceDocument = {
  id: SourceDocumentId;
  path: string;
  content: string;
  hash: string;
};
```

`hash` is lowercase SHA-256 over exact UTF-8 bytes. It is a stale-edit version token, not a signature.

Source loading stays lazy. Reader/Assets snapshots do not embed every source document.

## Semantic references

```text
reader:dialogue:<carrierId>:<itemIndex>
reader:action:<carrierId>:<itemIndex>
asset:background:<unitId>
asset:evidence:<evidenceId>:imagePrompt
asset:character:<characterId>:visualPrompt
asset:character:<characterId>:expression:<expressionId>:prompt
asset:audio:<channel>:<audioId>:prompt
```

Refs are human-readable domain identity only. They never contain paths or offsets.

## Compiler-owned source discovery

Create:

```text
packages/scripts/workbench/source-edit-targets.ts
```

It stays filesystem-free and browser-safe. Compiler/tooling owns authored syntax discovery; the layout editor does not implement another Markdown or YAML grammar.

### Tokenizer ranges

Extend current tokenizer tokens with **raw source ranges** without changing normalized parser values.

```ts
export type SourceRange = {
  start: number;     // JavaScript UTF-16 string index
  end: number;
  startLine: number;
  endLine: number;
};
```

Every token gets `range`, covering the exact raw token text in the original source, including indentation and CRLF spelling.

Editable token kinds additionally expose an exact logical-value range:

```ts
valueRange: SourceRange
```

For HPA-135:

- dialogue `valueRange` is only text after `：`;
- action `valueRange` is only bracket contents;
- metadata `valueRange` is only the metadata value.

Tokenizer normalization remains exactly as today: trimmed lines stay normalized, multi-line action token text still normalizes internal newlines to spaces, and parser behavior does not change.

Existing whole-token tests must be updated because adding range fields changes `toEqual()` results. Add explicit indentation, CRLF, CJK, and multi-line action slice tests.

### Reader dialogue/action binding

**Reader, not scripts segment-array order, owns semantic identity.**

Current `deriveInvestigationSegments()` and `deriveInterrogationSegments()` construct intro + outro before body segments, while Reader consumes intro → body → inventory → outro. Therefore HPA-135 must not zip `deriveDialogueSegments()` array order directly to source tokens.

`carrierGroup()` already owns the exact `carrierId` and compiler item index. Extend projected line/action items with:

```ts
export type ReaderEditableRef = {
  carrierId: string;
  itemIndex: number;
};
```

Then:

1. scripts tokenizes source and exposes only lexical dialogue/action source slices in source order;
2. Reader flattens its existing projected groups in the same display/authored order and skips notices/scene tags;
3. bind line/action items to lexical source slices in order;
4. require kind + normalized text + speaker (for dialogue) to match;
5. produce final `reader:<kind>:<carrierId>:<itemIndex>` source targets;
6. on mismatch, disable Reader editing for the scene and surface `workbenchSourceDialogueMismatch`.

Do not copy `readerSegmentId()` or create a second scene traversal in scripts.

Required fixture: one investigation scene covering at least intro, `hotspot:<id>:inspect`, `topic:<character>:<topic>:dialogue`, evidence/on-collect where present, and outro after sublocations. This is the regression that prevents the original array-order bug.

### Scene prompt association

Prompt indexing must reuse parser ownership rather than reconstruct block grammar.

For a selected source:

1. parse it through the existing parser for its actual scene type;
2. if parsing fails, expose no edit target;
3. use the validated AST owner identity/line plus tokenizer ranges to select the metadata token the parser already accepted;
4. only slice that token's `valueRange`.

#### `Background Prompt`

- Structural units use parser-owned sublocation / interrogation phase IDs.
- Scene-tag units use one shared browser-safe helper `sceneTagUnitId(index)` extracted from the current enrichment convention; enrichment and HPA-135 both call it.
- Count **every** scene tag in authored order, including tags without a prompt.
- Only existing authored `Background Prompt` metadata is editable.

No reverse parsing of `finalPrompt`, generated asset IDs, or manifest prose.

#### Evidence `Image Prompt`

The existing evidence parser owns `evidence:<id>` heading/anchor validation and binds `Image Prompt` into the evidence entry. HPA-135 uses that parsed evidence ID/owner line, then slices the accepted `Image Prompt` metadata token. It does not independently parse evidence block headings.

## YAML source mutation

Do not hand-roll block scalar / quoting / chomping rendering.

Use the same `YAML.parseDocument()` → locate identified map/entry → `node.set(...)` → `doc.toString()` pattern already used by `packages/scripts/audio/plan-writeback.ts`.

### Characters

Identity/normalization still comes from `parseCharactersYamlText()`.

Editable paths are only:

```text
character <id> → visualPrompt
character <id> → expressions.<expressionId>.prompt
```

Use the Document API only after the canonical parser confirms the character/expression identity exists.

### Sound plan

Identity/status comes from `parseSoundPlanText()`.

Editable path is exactly one `entries[]` map matching `(channel,id)` with status `approved` or `generated`. Use Document mutation to set only its `prompt`.

### Serialization contract

`renderSourceReplacement()` returns the full candidate `nextContent`, not a hand-rendered scalar slice.

Tests must prove:

- the mutated document reparses with the existing canonical parser;
- comments survive;
- unrelated entries remain semantically unchanged;
- the resulting diff is one localized focused change rather than whole-file formatting churn.

If Document serialization produces broad unrelated churn, HPA-135 fails the focused-edit contract; do not silently add a second YAML serializer.

## Source-target public model

```ts
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
  sourceRange: SourceRange | null; // local source/diff context only; not IPC
};

export type RenderSourceReplacementResult =
  | { ok: true; nextContent: string }
  | { ok: false; diagnostic: CompileError };
```

Markdown targets use tokenizer `valueRange`. YAML targets may retain the selected YAML node range only as a localization hint for diff/churn checking; mutation still happens through `node.set(...)` + `doc.toString()`. Rust never consumes any source range.

## Focused edit model

Create `apps/layout-editor/src/lib/focused-edit.ts`.

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
```

No draft database ID, timestamps, history, status workflow, or persistent queue.

### Diff generation

No diff dependency.

Generate a deterministic unified-style **single focused hunk** from `document.content` and `draft.nextContent`, with up to three unchanged context lines.

The selected target's source range/owner block is the locality guard. All changed lines must stay within that target's local source block (for YAML, the selected scalar/node block); otherwise return `focusedEditSourceChurn` and disable Apply. This catches accidental full-document YAML reformatting before Rust sees the candidate document without building a second YAML renderer.

The diff is presentation-only; Rust receives the already-reviewed `nextContent`.

## Impact projection

Reuse existing Reader/Assets data.

### Reader text/action

Selected scene only: `usageCount = 1`, `shared = false`.

### Background / evidence prompt

Reuse `workspace.sceneUsages` for the selected manifest asset ID. Show total occurrences, distinct scenes, and shared usage.

### Character expression

Reuse existing expression usage count and `assetUsageGroups()`.

### Character `visualPrompt`

Collect typed manifest entries whose source character ID matches, then join those asset IDs to existing scene usages.

### Audio prompt and owning plan

- `(channel,id)` comes from the selected typed audio manifest source; never parse the asset ID string.
- derive distinct chapter IDs from concrete `workspace.sceneUsages` for the selected audio asset;
- v1 exposes Edit only when usages resolve to **exactly one chapter**;
- load `audio-plan:<thatChapterId>` and require exactly one matching approved/generated sound-plan entry;
- if zero or multiple chapter owners exist, hide Edit and surface `focusedEditAudioPlanAmbiguous` rather than guessing.

This makes the sound-plan join explicit and prevents a shared future audio asset from silently editing the wrong chapter plan.

## Shared review surface

Create `FocusedEditReview.svelte` and render it once from `App.svelte`.

ReaderView and AssetsView emit only narrow edit-selection callbacks. They do not load/write source or own parallel review state.

Minimal states:

```text
idle
loading-source
editing
applying
applied-valid
applied-invalid
error
```

Do not introduce a generic state-machine framework.

This is the HPA-136 reuse seam: AI may later supply an initial replacement for a resolved target, but it cannot bypass human review or create another source write command.

## Backend write boundary

Add one mutation command:

```text
apply_workbench_source_edit
```

Request:

```ts
export type ApplyWorkbenchSourceEditRequest = {
  sourceDocumentId: SourceDocumentId;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTargetKind;
  nextContent: string;
};
```

No path, source range, byte offset, or shell command crosses IPC.

Response:

```ts
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

### Backend checks

Reject before writing when:

- document ID is malformed/unsupported;
- semantic-ref prefix is not one of the seven families;
- kind/ref family disagree;
- document category/kind disagree;
- source hash differs from `expectedHash`;
- `nextContent` equals current content.

Stable errors:

```text
sourceDocumentUnsupported
sourceEditKindUnsupported
sourceEditSemanticRefInvalid
sourceEditStale
sourceEditNoChange
sourceEditWriteFailed
```

No UTF-16/UTF-8 conversion exists in Rust.

### Atomic write reuse

Generalize the existing same-directory temp-file + rename helper so it accepts an already-resolved canonical path and complete contents. Reuse it for layout sidecars and HPA-135. Do not create a generic filesystem service.

## Authoritative validation

Frontend never supplies a command. Rust selects a fixed `ValidationCommand` sequence and executes without a shell string.

### Story / character target

```text
bun run scenes:compile
```

### Audio target

Do not weaken normal `mergeApprovedEntriesIntoCatalog()` conflict behavior.

Add a separate audio-owned command:

```text
audio:revise-prompt <plan.yaml> <channel> <id>
```

It reads the already-edited sound-plan prompt and updates only the matching existing catalog prompt while preserving `loop`.

Backend sequence:

```text
bun run audio:revise-prompt <plan.yaml> <channel> <id>
bun run audio:validate <plan.yaml>
bun run audio:apply <plan.yaml> --check
bun run scenes:compile
```

`channel`/`id` come from validated semantic ref; plan path comes from the resolved `SourceDocumentId`.

### Process execution test seam

This crate currently has no `std::process::Command` workflow. Keep the seam private and small:

```rust
fn execute_validation_plan_with<F>(
    root: &Path,
    plan: &[ValidationCommand],
    run: F,
) -> ValidationResult
where
    F: FnMut(&Path, &ValidationCommand) -> CommandOutcome;
```

Production adapter builds `std::process::Command`, sets `current_dir(root)`, and captures stdout/stderr. Tests inject outcomes to prove:

- exact executable/argv;
- canonical workspace cwd;
- commands execute in order;
- first non-zero result stops later commands;
- diagnostics are bounded.

No public command-runner abstraction is added.

## Validation failure semantics

A successful source write is not rolled back when validation fails.

UI says **Applied, validation failed**, shows diagnostics, and leaves source on disk for another edit or Git revert. Do not refresh generated Reader/Assets projection as if compile succeeded.

## Audio prompt revision owner

`audio:revise-prompt` is a separate command because normal `audio:apply` correctly treats a changed approved/generated prompt as a conflict.

The revision command:

1. loads/validates the sound plan;
2. requires exactly one approved/generated `(channel,id)` entry;
3. reads its prompt;
4. parses the existing catalog;
5. requires the catalog entry to exist;
6. updates only its prompt, preserving `loop`;
7. serializes/formats through existing audio-catalog helpers;
8. never changes cues, media files, provider metadata, or other entries.

Source direction:

```text
sound plan prompt
→ audio:revise-prompt
→ derived audio.yaml prompt synchronization
→ normal validate + apply --check
```

## UX integration

### Reader

Only line/action items show Edit. `ReaderEditableRef` comes from the existing `carrierGroup()` walk; no source span enters runtime JSON.

### Assets — background/evidence

Scene-owned source with `unitId` or `evidenceId` can Edit its authored prompt. Global/character-owned sources do not gain this action.

### Assets — Characters

Add Edit beside existing non-null `visualPrompt` and each existing expression prompt. Do not create missing fields.

### Assets — Audio

Edit appears only after the typed `(channel,id)` + exactly-one-owning-chapter join succeeds. Review shows both authored sound plan and derived catalog sync.

## Stale behavior

```text
open at hash A
→ external edit creates hash B
→ Apply
→ sourceEditStale, no write
→ reload source and resolve target again
```

No automatic merge/rebase in v1.

## Undo decision

Do not implement Workbench Undo in HPA-135. Git already owns history, and audio edits may synchronize the derived catalog after apply.

## Testing strategy

### Scripts / parser ownership

Cover:

- tokenizer raw ranges for LF/CRLF, indentation, CJK, and multi-line actions;
- dialogue/action editable `valueRange` while normalized token text remains unchanged;
- existing whole-token tokenizer fixtures updated for range fields;
- scene source validated by the actual scene parser before prompt target extraction;
- `sceneTagUnitId()` shared by enrichment + edit indexing and counts tags without prompts;
- structural Background Prompt via parsed unit identity;
- evidence Image Prompt via parsed evidence identity;
- character visual/expression prompt via canonical character parser + YAML Document mutation;
- sound-plan prompt via canonical sound-plan parser + YAML Document mutation;
- comments/unrelated semantics preserved;
- broad YAML formatting churn rejected by focused diff construction.

### Reader binding

Cover a real-shaped investigation fixture with intro, hotspot inspect, topic dialogue, evidence/on-collect and outro after sublocations. Assert final refs are owned by Reader carrier IDs/item indexes and no `deriveDialogueSegments()` array-order zipper exists.

### Frontend

Cover draft/diff/no-change, impact joins, Reader/Assets edit affordances, shared warnings, one shared review surface, stale state, applied-valid, and applied-invalid.

Create `apps/layout-editor/src/lib/ReaderView.test.ts`; it does not exist on current main.

### Rust

Temporary-workspace tests cover closed document resolution, traversal rejection, SHA change, stale hash/no write, kind/ref/document mismatch, no-change, atomic complete-document write, validation dispatch, command execution seam, and applied-but-invalid result.

### Audio

Cover one-entry prompt sync, loop unchanged, missing/duplicate/non-approved plan entries, missing catalog entry, unchanged normal apply conflict behavior, and successful `audio:apply <plan> --check` after revision.

### Real Chapter 1 read-only verifier

`verify-focused-edit-real-content.ts` must discover at least one real target from each of the seven families and must include an investigation Reader binding. It remains read-only.

### Live apply smoke

Typecheck/build do not prove the write/validation process boundary. Before marking the PR ready, make one throwaway Chapter 1 source edit through the real Workbench, observe automatic `scenes:compile`, then revert the source with Git. Do not treat `editor:build` as evidence for this path.

## Required checks

```text
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

## Acceptance criteria

- [ ] Reader edits one dialogue line and one action through the same reviewed-diff flow.
- [ ] Real investigation Reader items bind to source using Reader traversal identity, including hotspot/topic/outro ordering.
- [ ] Assets edits supported scene Background Prompt and evidence Image Prompt using parser-owned source association.
- [ ] Characters edits existing visualPrompt/expression prompt using YAML Document mutation.
- [ ] Audio edits one existing prompt through exactly one owning sound plan and audio-domain synchronization.
- [ ] Every review shows exact authored-source diff, semantic ref, path, and impact.
- [ ] Candidate YAML mutation cannot Apply when serialization causes unrelated source churn.
- [ ] Backend accepts only known SourceDocumentId values and seven target families.
- [ ] Backend stale guard uses SHA-256 and writes reviewed `nextContent`; no Rust UTF-16 mapper exists.
- [ ] Validation command execution has argv/cwd/non-zero-stop tests.
- [ ] Successful write followed by failed validation is shown as applied-but-invalid.
- [ ] Production scene JSON/schema is unchanged.
- [ ] No queue, undo/history, generic editor, arbitrary path write, AI provider, auto Git workflow, or media generation is added.
- [ ] HPA-136 can reuse the same focused review/apply boundary.
- [ ] Implementation lands in this same PR.

## Design summary

HPA-135 remains a **small write seam, not an editor platform**:

- Reader owns dialogue/action semantic identity;
- compiler parsers/tokenizer own authored source discovery;
- Assets owns prompt identity and impact;
- YAML uses the existing Document mutation approach;
- one local draft owns `nextContent` + exact diff;
- Rust resolves a closed document, hash-guards it, atomically writes the reviewed full content, and runs fixed validation;
- audio revision stays under sound-plan/audio ownership;
- HPA-136 later supplies suggestions into the same human review path.