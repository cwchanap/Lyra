# HPA-135 Story Workbench Focused Source Edit Design

## Status

Planning design for **HPA-135 — [Story Workbench] Edit one story or prompt source through a reviewed diff**.

One ticket, one PR. PR #84 remains the planning + implementation PR.

## Final v1 cut after reuse review

HPA-135 v1 supports four byte-stable scene-Markdown edits:

| Surface | Editable target | Canonical source |
|---|---|---|
| Reader | dialogue line | selected scene Markdown |
| Reader | single-line action/stage direction | selected scene Markdown |
| Assets | scene-owned `Background Prompt` | selected scene Markdown |
| Assets | evidence `Image Prompt` | selected scene Markdown |

Deferred from HPA-135 v1:

- character `visualPrompt`;
- character expression prompt;
- audio/sound-plan prompt.

The cut is deliberate. On the real `characters.yaml` and Chapter 1 sound plan, `YAML.parseDocument()` → `doc.toString()` can reformat unrelated source. That either trips the focused-locality guard or violates the exact reviewed-diff contract. HPA-135 therefore ships the reusable review/apply seam with byte-stable Markdown and leaves YAML prompt editing to a later HPA-639 slice with a byte-exact scalar writeback contract.

HPA-136 only needs one trustworthy reviewed mutation seam, so this scope still unblocks it.

## Review disposition

Adopted:

1. compiler owns dialogue/action source identity; no whole-scene Reader/text zipper;
2. compiler asset manifest owns prompt source identity; no Workbench `tag_NNN` counting;
3. no YAML serializer/writeback in HPA-135;
4. real-content source verification is a Task-1 hard gate;
5. multiline actions are read-only in v1;
6. validation has a fixed timeout;
7. compiled-vs-source staleness is a named state.

Deliberately retained:

- `expectedHash` remains the stale-write token. It is already the HPA-135 contract, is cheap, and avoids resending the whole original document as a version token. Add only the minimal SHA-256 helper/dependency needed by the layout-editor backend.

## Goal

```text
select supported Reader/Assets value
→ resolve compiler-owned authored source locator
→ prove current source still matches compiled projection
→ type replacement
→ review exact one-hunk diff + impact
→ Apply or Cancel
→ stale-hash + exactly-one-line guarded atomic write
→ bounded bun run scenes:compile
→ refresh Reader / Assets on success
```

Git remains history. No queue, history database, Workbench undo, source-control automation, or general editor.

# Compiler-owned Reader source identity

## Compiler-only source line

Add optional `sourceLine` to compiler `DialogueItem` variants. It must never enter `JSONDialogueItem`.

Direct dialogue/action consumers use the authored tokenizer token line.

Important repository-specific exception: interrogation fields such as `On Loop`, `Loop Prompt`, `Default Challenge`, `Default Wrong`, `Wrong Reply`, testimony content/challenge responses, etc. are metadata values that are re-tokenized by `parseDialogueFieldValue()`. The inner token starts at line 1 and is **not** the authored file line. For those items, `sourceLine` must come from the outer metadata token's line.

Therefore:

- extend shared metadata consumption to retain `key → authored line` alongside values;
- thread the exact metadata line into `parseDialogueFieldValue()`;
- set returned line/action items to that outer line;
- cover all current item-construction paths (`parser-linear`, `parser-common`, `parser-manifest`, interrogation-specific paths).

Do not assume `parser-common.ts` is the only dialogue funnel.

## Emitter strip lock

The current emitter spreads sceneTag items and returns non-line items by reference. Once compiler-only source metadata exists, explicitly construct all three `JSONDialogueItem` variants:

```text
sceneTag → kind/text/assetCue only
action   → kind/text only
line     → kind/speaker/text/portrait only
```

Emitter tests prove `sourceLine` never appears in production scene JSON.

## Shared carrier identity

Move the existing Reader carrier spelling function beside `deriveDialogueSegments()`:

```ts
export function dialogueSegmentCarrierId(
  origin: DialogueSegmentOriginV1,
): string;
```

Reader imports it instead of owning a duplicate mapping.

When `deriveDialogueSegments()` receives `sourceAst`, expose compiler-only item source lines parallel to each derived carrier's emitted items:

```ts
export type DerivedDialogueSegment = {
  origin: DialogueSegmentOriginV1;
  items: JSONDialogueItem[];
  itemSources?: Array<{ sourceFile: string; line: number } | null>;
};
```

Source-owner association uses the same semantic IDs/origin that define the carrier. It must not depend on one global source traversal or raw segment-array order.

The Workbench resolves:

```text
dialogueSegmentCarrierId(origin)
+ emitted itemIndex
+ compiler item source line
```

to:

```text
reader:dialogue:<carrierId>:<itemIndex>
reader:action:<carrierId>:<itemIndex>
```

Mismatch is carrier-local (`workbenchSourceCarrierStale`), not whole-scene disablement.

# Compiler-owned prompt source identity

## Parser prompt line

Compiler-only cue data records exact metadata line:

```ts
backgroundPromptLine?: number | null
imagePromptLine?: number | null
```

- scene-tag parsing already gathers metadata lines; pass them into `parseVisualAssetCue()`;
- shared structural metadata consumption returns values + key→line map;
- interrogation `PhaseMeta` retains that line map so phase Background Prompt gets the real metadata line;
- evidence parsing already stores metadata entry lines and binds `Image Prompt` directly;
- runtime scene JSON strips these compiler-only fields.

## Typed manifest source

Extend only scene-owned background/evidence source variants with:

```text
promptLine
authoredPrompt
```

Examples:

```ts
{ chapterId, sceneId, unitId, promptLine, authoredPrompt }
{ chapterId, sceneId, evidenceId, promptLine, authoredPrompt }
```

`unitId` is the actual enrichment identity, including any `tag_NNN`; Workbench never re-derives its counting order.

`authoredPrompt` must be literal source text. Do not use `promptParts.entryPrompt` for staleness/editing because investigation enrichment may append source-guidance text to that value.

Asset manifest source fields may grow additively. Production scene JSON/runtime schema remains unchanged.

# Source document + semantic target contract

HPA-135 v1 needs only scene documents:

```ts
export type SourceDocumentId = `scene:${string}:${string}`;
```

Backend resolves the scene through existing chapter-manifest/canonical-source containment logic. No frontend path.

Snapshot:

```ts
export type WorkbenchSourceDocument = {
  id: SourceDocumentId;
  path: string;
  content: string;
  hash: string; // lowercase SHA-256 of exact UTF-8 bytes
};
```

Supported refs only:

```text
reader:dialogue:<carrierId>:<itemIndex>
reader:action:<carrierId>:<itemIndex>
asset:background:<unitId>
asset:evidence:<evidenceId>:imagePrompt
```

Resolved source target:

```ts
export type WorkbenchSourceTarget = {
  semanticRef: string;
  kind:
    | "readerDialogue"
    | "readerAction"
    | "backgroundPrompt"
    | "evidenceImagePrompt";
  line: number;
  currentText: string;
};
```

# One-line byte-preserving renderer

Create `packages/scripts/workbench/source-edit-targets.ts` as a filesystem-free helper.

All v1 replacements reject CR/LF.

## Reader dialogue/action raw-line forms

A compiler item may come from either:

1. a direct authored dialogue/action line, or
2. one metadata wrapper whose **value** is a dialogue/action string (interrogation dialogue fields).

Renderer algorithm for the compiler-provided `line`:

1. read exactly that raw physical line;
2. tokenize it;
3. if it is direct dialogue/action, validate kind/speaker/current text;
4. otherwise, if it is one metadata token, tokenize only that metadata value and validate the inner dialogue/action;
5. replace only the logical dialogue text after `：` or action text inside `[...]`;
6. preserve outer metadata prefix when present, speaker/expression markup, brackets, indentation, trailing whitespace, and original line ending.

Never search another line for matching text.

Multiline bracket actions are not editable: if the compiler-provided source line does not contain the complete action, return `workbenchSourceMultilineActionUnsupported`.

## Prompt raw-line form

At manifest `promptLine`, require the metadata key and current value to match the expected Background/Image Prompt. Replace only the metadata value and preserve everything else on that physical line.

## Defensive locality assertion

Candidate `nextContent` must:

- have the same physical line count;
- differ on exactly one physical line;
- differ on the resolved target line only.

No YAML locality/churn framework is needed.

# Compiled-vs-source stale behavior

Two independent stale checks exist.

## Before review

Current source must still agree with the compiled artifact that produced the selection:

- Reader: kind/speaker/text for selected carrier/item agrees with the direct or metadata-wrapped value at compiler source line;
- Assets: metadata value at manifest `promptLine` equals manifest `authoredPrompt`.

Mismatch → `focusedEditCompiledSourceStale`. The author must compile/refresh. No text-search relocation or auto merge.

## On Apply

Backend rereads the source and compares `expectedHash`.

Mismatch → `sourceEditStale`, no write.

# Focused edit + diff

```ts
export type FocusedEditDraft = {
  sourceDocumentId: SourceDocumentId;
  sourcePath: string;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTarget["kind"];
  expectedLine: number;
  originalText: string;
  replacementText: string;
  nextContent: string;
  impact: FocusedEditImpact;
};
```

One draft only.

Hand-roll one unified-style hunk with up to three context lines; no diff dependency. Diff shows exact authored Markdown syntax.

Impact reuses current projections:

- dialogue/action: selected scene only;
- background/evidence: selected manifest asset ID + existing `workspace.sceneUsages` for occurrence/distinct-scene/shared warning.

Character/audio remain read-only in Assets.

# Shared review UI

`FocusedEditReview.svelte` is rendered once by `App.svelte`.

ReaderView/AssetsView emit selection only; no source I/O or private review state.

Reader line/action items may carry `ReaderEditableRef { carrierId, itemIndex }` from `carrierGroup()` so prepended notices cannot shift the compiler item index.

HPA-136 later passes an optional initial replacement into this same draft/review path; no second writer.

# Backend write boundary

Request:

```ts
export type ApplyWorkbenchSourceEditRequest = {
  sourceDocumentId: SourceDocumentId;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTarget["kind"];
  expectedLine: number;
  nextContent: string;
};
```

Backend:

```text
resolve closed scene document
→ read exact content
→ SHA-256 stale check
→ supported ref/kind check
→ same physical line count
→ exactly one changed line
→ changed line == expectedLine
→ existing same-directory atomic temp/sync/rename write
→ bounded bun run scenes:compile
```

No frontend path, source byte range, UTF-16 mapper, or shell command.

Pre-write errors:

```text
sourceDocumentUnsupported
sourceEditKindUnsupported
sourceEditSemanticRefInvalid
sourceEditStale
sourceEditNoChange
sourceEditNotFocused
sourceEditLineMismatch
sourceEditWriteFailed
```

# Bounded validation

Only:

```text
bun run scenes:compile
```

Use `std::process::Command` with explicit argv and canonical workspace cwd.

Target timeout: 120 seconds. Drain stdout/stderr while the child runs, poll for completion, kill on deadline, and return bounded diagnostics / `sourceEditValidationTimeout`.

Tests cover fake-runner argv/cwd/non-zero/timeout plus one real Bun process/cwd smoke.

A write followed by compiler failure/timeout is **Applied, validation failed**. No automatic rollback.

# Real-content hard gate

`apps/layout-editor/scripts/verify-focused-edit-real-content.ts` lands in Task 1.

It must prove against current Chapter 1:

- direct Reader dialogue source resolution;
- single-line action resolution;
- at least one interrogation metadata-wrapped Reader item source resolution;
- investigation carrier mapping without raw segment-array ordering;
- scene-owned Background Prompt from manifest `unitId + promptLine + authoredPrompt`;
- evidence Image Prompt from manifest `evidenceId + promptLine + authoredPrompt`;
- current source values match compiled Reader/manifest values.

Do not proceed to backend/UI implementation while this gate fails.

# Risks

- **Compiled resources older than source:** named `focusedEditCompiledSourceStale`; no fallback search.
- **Metadata-wrapped interrogation dialogue:** exact outer metadata line is carried by compiler; inner re-tokenized line 1 is never treated as file location.
- **Prompt identity drift:** manifest prompt line + literal authored prompt must match source before review.
- **Compiler source metadata leaks:** emitter tests lock runtime JSON shape.
- **Compile lock wait:** validation timeout prevents indefinite Apply.
- **YAML editing absent:** intentional until byte-exact scalar writeback exists.

# Required checks

```text
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

Final acceptance includes one temporary real Chapter 1 Workbench edit → Apply → automatic successful `scenes:compile` → projection refresh → Git revert → recompile.

# Acceptance criteria

- [ ] Dialogue edit works for compiler-resolved direct/metadata-wrapped single-line source.
- [ ] Single-line action edit works; multiline action is read-only.
- [ ] Scene-owned Background Prompt edit works.
- [ ] Evidence Image Prompt edit works.
- [ ] Reader identity is compiler carrier/item/source-line based, never whole-scene order/text matching.
- [ ] Prompt identity comes from typed manifest prompt source, never Workbench tag counting.
- [ ] Compiled-vs-source mismatch fails before review.
- [ ] Apply is closed scene ID + hash + supported ref/kind + exactly one expected changed line.
- [ ] Atomic write + bounded `scenes:compile` validation are automatic.
- [ ] Applied-but-invalid is explicit and not rolled back automatically.
- [ ] Runtime scene JSON is unchanged.
- [ ] Character/expression/audio YAML editing is explicitly deferred, not half-implemented.
- [ ] No queue/history/undo/general editor/arbitrary write/AI provider/Git automation.
- [ ] HPA-136 reuses the same review/apply boundary.
- [ ] Implementation lands in PR #84.
