# HPA-135 Story Workbench Focused Source Edit Design

## Status

Planning design for **HPA-135 — [Story Workbench] Edit one story or prompt source through a reviewed diff**.

One ticket, one PR. PR #84 remains the planning + implementation PR.

## Decision after reuse review

HPA-135 v1 is intentionally narrowed to the four edit targets whose canonical source is scene Markdown:

| Surface | Editable target | Canonical source |
|---|---|---|
| Reader | one dialogue line | selected scene Markdown |
| Reader | one single-line action/stage direction | selected scene Markdown |
| Assets | one scene-owned `Background Prompt` | selected scene Markdown |
| Assets | one evidence `Image Prompt` | selected scene Markdown |

The following YAML-backed targets are **deferred from HPA-135 v1**:

- character `visualPrompt`;
- character expression prompt;
- audio prompt / sound-plan prompt.

This is a correctness and scope decision, not a product rejection. The current `yaml` Document writeback pattern is not byte-local on the real character and Chapter 1 sound-plan files: a focused scalar change can reformat unrelated inline sequences or folded scalars. A Workbench edit that rewrites unrelated source violates the core reviewed-diff contract. HPA-135 therefore ships the reusable review/apply seam first and leaves YAML prompt editing to a later HPA-639 slice that can define a byte-exact writeback contract.

HPA-136 remains unblocked by this cut: it needs one safe reviewed mutation seam, not every possible prompt family.

## Review disposition

### Adopted

1. **Compiler owns dialogue/action source identity.** Do not reconstruct identity by flattening Reader and matching whole-file `kind/text/speaker` order.
2. **Compiler asset manifest owns scene-prompt source identity.** Do not reconstruct `tag_NNN` numbering in the Workbench.
3. **No YAML serializer/writeback in v1.** Character/audio editing is deferred rather than weakening focused-diff locality.
4. **Real-content verification moves to the first compiler/source-identity task.** Later UI/backend work must not depend on an unproven mapping.
5. **Multiline actions are read-only in v1.** The authored corpus currently uses single-line actions and the tokenizer normalizes multiline action text, so round-tripping them would add machinery with no current product value.
6. **Validation execution is bounded.** `scenes:compile` cannot leave Apply apparently hung forever behind the compile lock.
7. **Compiled-vs-source staleness is explicit.** A source file newer/different from the compiled Reader/asset manifest must fail loudly before a draft is applied.

### Deliberately kept

`expectedHash` stays in the write contract. It is already the HPA-135 ticket contract, avoids resending the entire original document as a stale token, and requires only a tiny SHA-256 helper in the layout-editor backend. Do not build a generic hashing subsystem around it.

## Goal

Let an author select one supported Reader/Assets value, edit exactly one authored Markdown line value, inspect the exact source diff and usage impact, explicitly apply it through a stale-safe fixed-domain backend, and see authoritative compiler validation.

```text
select supported Reader/Assets value
→ resolve compiler-owned authored line
→ verify compiled projection still matches source
→ type replacement
→ review exact one-hunk diff + impact
→ Apply or Cancel
→ stale-hash + focused-line guarded atomic write
→ bun run scenes:compile
→ refresh Reader / Assets on success
```

Git remains durable history. No proposal queue, history model, Workbench undo, source-control automation, or general editor is added.

## Source identity: compiler first, no text heuristics

### Dialogue/action authored line

`DialogueItem` is compiler-only AST data before emission. Add an optional authored line field:

```ts
export type DialogueItem =
  | { kind: "sceneTag"; text: string; assetCue?: VisualAssetCue | null; sourceLine?: number }
  | { kind: "action"; text: string; sourceLine?: number }
  | {
      kind: "line";
      speaker: string;
      text: string;
      expression?: string | null;
      portrait?: PortraitRef | null;
      sourceLine?: number;
    };
```

Every parser path that creates dialogue/action items from a tokenizer token must set `sourceLine = token.line`. This includes the current linear parser, shared parser-common dialogue consumer, manifest dialogue consumer, and interrogation-specific consumer; do not assume parser-common is the only construction path.

`emitter.ts` must explicitly construct every `JSONDialogueItem` variant and strip `sourceLine`. The current non-line by-reference return / sceneTag spread is not sufficient once compiler-only source metadata exists. Production scene JSON remains unchanged.

### Carrier identity

Move the existing `readerSegmentId()` mapping to a scripts-owned helper beside `deriveDialogueSegments()`:

```ts
export function dialogueSegmentCarrierId(origin: DialogueSegmentOriginV1): string;
```

Reader imports this helper instead of owning a duplicate carrier spelling map.

When `deriveDialogueSegments()` receives `sourceAst`, extend each derived segment with compiler-only item source lines parallel to its emitted items. Source owner lookup must use the same semantic IDs/origin construction as the segment itself; do not depend on one global authored traversal order.

Conceptually:

```ts
export type DerivedDialogueSegment = {
  origin: DialogueSegmentOriginV1;
  items: JSONDialogueItem[];
  itemSources?: Array<{ sourceFile: string; line: number } | null>;
};
```

The Workbench source resolver joins **within one carrier**:

```text
carrierId from dialogueSegmentCarrierId(origin)
+ emitted itemIndex
+ compiler item source line
→ reader:dialogue:<carrierId>:<itemIndex>
  or reader:action:<carrierId>:<itemIndex>
```

A mismatch disables only that carrier's edit targets and emits `workbenchSourceCarrierStale`; it does not disable every edit in the scene.

This fixes the original investigation/interrogation outro ordering bug without creating a second Reader walk.

## Scene prompt authored line in the asset manifest

The Workbench already consumes the typed asset manifest. Extend that existing compiler-owned source identity rather than rediscovering prompt ownership.

### Parser metadata line

Compiler-only cue data records the exact authored prompt line:

```ts
export type VisualAssetCue = {
  backgroundPrompt: string | null;
  backgroundPromptLine?: number | null;
  ...
};

export type EvidenceImageCue = {
  imagePrompt: string | null;
  imagePromptLine?: number | null;
  ...
};
```

- scene-tag parsing already collects metadata line numbers; pass the `Background Prompt` line into `parseVisualAssetCue()`;
- shared structural metadata consumption retains metadata line numbers in addition to values;
- evidence manifest parsing already retains each metadata entry's line, so bind `Image Prompt` directly;
- emitter/runtime JSON strips these compiler-only fields.

### Manifest source

For scene-owned editable prompt entries, add exact authoring data to the typed manifest source:

```ts
{ chapterId, sceneId, unitId, promptLine, authoredPrompt }
{ chapterId, sceneId, evidenceId, promptLine, authoredPrompt }
```

Character/global background/evidence source variants remain unchanged and are not editable in HPA-135.

`unitId` remains whatever enrichment actually assigned, including `tag_NNN`; the Workbench never counts scene tags itself.

`authoredPrompt` is required because `promptParts.entryPrompt` is not always the literal authored value. Investigation background enrichment may append source-guidance text to the authored prompt before building the manifest entry.

The asset manifest may gain these additive development/source fields; production scene JSON/runtime schema does not change.

## Source document identity

HPA-135 v1 needs only scene documents:

```ts
export type SourceDocumentId = `scene:${string}:${string}`;
```

The backend resolves the scene through the existing chapter manifest + canonical authored-source containment logic. The frontend never supplies a path.

Future YAML prompt work may extend this closed union later; do not pre-add unused character/audio document IDs now.

## Source snapshot

```ts
export type WorkbenchSourceDocument = {
  id: SourceDocumentId;
  path: string;
  content: string;
  hash: string;
};
```

`hash` is lowercase SHA-256 over exact UTF-8 bytes and is only a stale-edit token.

## Supported semantic refs

```text
reader:dialogue:<carrierId>:<itemIndex>
reader:action:<carrierId>:<itemIndex>
asset:background:<unitId>
asset:evidence:<evidenceId>:imagePrompt
```

No character/audio/YAML semantic refs are accepted by the HPA-135 backend.

## Byte-preserving single-line source replacement

Create a filesystem-free helper in `packages/scripts/workbench/source-edit-targets.ts`.

A resolved target contains:

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

Replacement rules:

- all four v1 replacements reject `\n` / `\r`;
- dialogue changes only the text after the full-width `：`, preserving speaker, expression markup, indentation, trailing whitespace, and line ending;
- action is editable only when the entire bracket action opens/closes on the same authored line; only bracket contents change;
- Background/Image Prompt changes only the metadata value on the compiler-provided prompt line;
- use the existing tokenizer/parser to validate the selected raw line shape/current logical value before replacing it; do not add whole-file tokenizer ranges;
- output is full `nextContent`, built by replacing exactly one source line value.

Defensive tests assert that `nextContent` has the same line count and differs from the snapshot on exactly the expected line.

## Compiled-vs-source stale state

There are two independent stale checks.

### Before review

The current authored source target must match the compiled projection that produced the selection:

- Reader: compiled kind/speaker/text for the selected carrier/item must match the source item resolved at the compiler-owned line;
- Assets: manifest `authoredPrompt` must match the metadata value at `promptLine`.

If not, return:

```text
focusedEditCompiledSourceStale
```

UI tells the author to run/let the Workbench run `scenes:compile` and refresh before editing. Never guess a new target by searching for matching text elsewhere.

### On Apply

The backend rereads the source and compares `expectedHash`. A changed source returns `sourceEditStale` with no write.

## Focused edit model

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

One draft only; no queue/history/persistence.

### Diff

Hand-roll one unified-style hunk with up to three context lines. No diff dependency.

Because the renderer itself is single-line and byte-preserving, there is no YAML locality/churn framework. A pure assertion rejects any candidate whose line count changes or whose diff touches a line other than `expectedLine`.

## Impact projection

Reuse existing projections:

- dialogue/action: selected scene only, `usageCount = 1`, `shared = false`;
- Background Prompt/evidence Image Prompt: reuse the selected manifest asset ID plus `workspace.sceneUsages` to show occurrences/distinct scenes and shared warning.

Character/audio impact remains visible in Assets as read-only information; HPA-135 simply does not show Edit for those rows.

## Shared review UI

`FocusedEditReview.svelte` is rendered once from `App.svelte`.

ReaderView and AssetsView emit only a narrow edit selection. They do not own source loading/writing or separate review state.

Reader projection may carry `ReaderEditableRef { carrierId, itemIndex }` on line/action items so notices prepended to a group cannot shift the compiler item index.

HPA-136 later supplies an initial replacement into the same draft/review flow; it does not get a second writer.

## Backend write boundary

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

Backend order:

```text
resolve closed scene document
→ read exact content
→ SHA-256 stale check
→ ref/kind validation
→ verify nextContent is same line count + exactly one changed line
→ verify changed line == expectedLine
→ atomic same-directory temp + sync + rename
→ bun run scenes:compile
```

No frontend path, byte offset, UTF-16 range, or shell command is accepted.

Stable pre-write errors include:

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

## Validation execution

The only HPA-135 validation command is:

```text
bun run scenes:compile
```

Use `std::process::Command` with explicit executable/args and canonical workspace cwd; no shell string.

The command runner has a fixed validation timeout (target: 120 seconds). It must drain stdout/stderr while the child runs, kill the child on timeout, and return a bounded diagnostic result such as `sourceEditValidationTimeout`. This prevents Apply from waiting indefinitely behind a live compile lock.

Tests cover:

- exact argv/cwd;
- bounded stdout/stderr;
- first non-zero stop;
- timeout path through the injected runner seam;
- one real Bun spawn/cwd test.

After a successful source write, validation failure/timeout is **Applied, validation failed**. Do not roll the source back automatically.

## Real-content gate comes first

`apps/layout-editor/scripts/verify-focused-edit-real-content.ts` is part of the compiler/source-identity task, not the final task.

It is read-only and must prove against current Chapter 1 content:

- a Reader dialogue target resolves by carrier/item to its compiler-owned authored line;
- a Reader single-line action target resolves likewise;
- an investigation carrier resolves correctly without depending on raw segment array order;
- one scene-owned Background Prompt resolves from manifest `promptLine/authoredPrompt`;
- one evidence Image Prompt resolves from manifest `promptLine/authoredPrompt`;
- current source values match compiled Reader/manifest values.

Implementation does not proceed to backend/UI wiring while this gate fails.

## Risks

### Compiled source is older than Markdown

Handled by `focusedEditCompiledSourceStale`; no text search fallback.

### Asset source line metadata drifts

The manifest line + authored prompt are verified against the loaded source before a draft exists. Mismatch is stale, not a guessed relocation.

### Compiler-only source metadata leaks to runtime JSON

Emitter tests explicitly assert `sourceLine`, `backgroundPromptLine`, and `imagePromptLine` are absent from emitted scene JSON.

### Compile validation blocks

Validation has a fixed timeout and reports failure rather than leaving Apply indefinitely pending.

### YAML prompt editing is incomplete

Intentional. HPA-135 v1 establishes the mutation seam with byte-stable Markdown. Character/audio prompt editing is deferred until a byte-exact YAML scalar writeback contract exists.

## Required checks

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

Final acceptance also includes one throwaway Chapter 1 Workbench edit through the real Apply path, successful backend `scenes:compile`, projection refresh, and Git revert.

## Acceptance criteria

- [ ] Reader can review/apply one dialogue line edit.
- [ ] Reader can review/apply one single-line action edit; multiline action has no Edit affordance.
- [ ] Assets can review/apply one scene-owned Background Prompt edit.
- [ ] Assets can review/apply one evidence Image Prompt edit.
- [ ] Dialogue/action source identity comes from compiler item line + shared carrier identity, never whole-scene text/order matching.
- [ ] Prompt source identity comes from compiler asset manifest line + authored prompt, never Workbench tag counting.
- [ ] Compiled-vs-source mismatch fails loudly before review.
- [ ] Apply targets only a closed scene `SourceDocumentId`, stale SHA, supported semantic ref/kind, and exactly one expected line.
- [ ] Successful write is atomic and immediately runs bounded `scenes:compile` validation.
- [ ] Validation failure/timeout is applied-but-invalid, not false rollback.
- [ ] Production scene JSON/runtime schema is unchanged.
- [ ] Character/expression/audio YAML prompt edits are explicitly deferred; no fake support remains in v1.
- [ ] No queue/history/undo, general editor, arbitrary path, AI provider, Git automation, or media generation.
- [ ] HPA-136 can reuse the same focused review/apply boundary.
- [ ] Implementation lands in PR #84.

## Non-goals

- Character `visualPrompt` editing in HPA-135 v1.
- Character expression prompt editing in HPA-135 v1.
- Audio/sound-plan prompt editing in HPA-135 v1.
- General Markdown/YAML editing.
- Story Bible / Chapter Plan editing.
- Multi-file/multi-hunk editing.
- Proposal/history database or Workbench undo.
- Source merge/rebase on stale edits.
- AI provider calls — HPA-136.
- Git commit/branch/PR automation.
- Asset/media generation.
- Game runtime scene schema changes.
