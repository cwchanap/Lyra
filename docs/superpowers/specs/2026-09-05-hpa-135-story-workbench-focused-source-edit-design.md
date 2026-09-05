# HPA-135 Story Workbench Focused Source Edit Design

## Status

Planning design for **HPA-135 — [Story Workbench] Edit one story or prompt source through a reviewed diff**.

One ticket, one PR. This PR starts planning-only and is the same PR that should carry implementation after review. Do not split HPA-135 into separate planning and implementation PRs.

## Why HPA-135 is next

The current Story Workbench has completed its read-only foundation:

- HPA-634 Reader is done and owns continuous scene/carrier projection.
- HPA-134 Assets is done and owns canonical prompt layers and usage impact.
- HPA-273 Plan is done and remains read-only context for the later AI slice.
- HPA-136 AI review is explicitly blocked by HPA-135 and must reuse this exact reviewed edit/apply boundary.
- Chapter 2 / later-chapter implementation remains deferred by the Lyra roadmap.

HPA-135 is therefore the smallest next step: add one controlled human-authored write seam without broadening Story Workbench into a general editor.

## Goal

Let an author select **one supported story text or prompt value**, type one replacement, inspect the exact authored-source diff plus usage impact, explicitly apply it through a stale-safe backend boundary, and see authoritative validation.

```text
select one supported value
→ type replacement
→ review exact diff + impact
→ Apply or Cancel
→ guarded source write
→ authoritative validation
→ refresh the existing Reader / Assets projection
```

Git remains durable history. HPA-135 adds no proposal database, revision timeline, autosave queue, branch/commit automation, or Workbench-owned undo history.

## Supported edit targets

HPA-135 supports exactly seven semantic target kinds.

| Surface | Target | Canonical authored source |
|---|---|---|
| Reader | one dialogue line text | selected scene Markdown |
| Reader | one action / stage-direction text | selected scene Markdown |
| Assets | one scene-owned visual unit `Background Prompt` | selected scene Markdown |
| Assets | one evidence `Image Prompt` | selected scene Markdown |
| Assets → Characters | one existing character `visualPrompt` | `static/assets/config/characters.yaml` |
| Assets → Characters | one existing character expression `prompt` | `static/assets/config/characters.yaml` |
| Assets → Audio | one existing audio prompt | owning `docs/audio_plans/chapter_<N>.sound-plan.yaml` |

### Explicit exclusions

Do not add edit affordances for:

- scene tags;
- scene/chapter titles, summaries, IDs, statuses, unlocks, reveals, evidence descriptions, statement content, or arbitrary metadata;
- BGM/BGS cue assignment;
- audio `loop`, status, evidence, provider, generated metadata, output path, or new entries;
- Plan-mode Story Bible / chapter-plan Markdown;
- global city-map prompt JSON;
- global style/type policy prompts;
- arbitrary asset-manifest fields;
- multiple selected values or multi-file edits.

Unsupported selections simply have no Edit action. There is no hidden generic field/path editor underneath.

## Product contract

### One active edit

Only one `FocusedEditDraft` exists at a time. There is no proposal queue/history.

### Review before apply

Before Apply is enabled, one shared review surface shows:

1. authored source path;
2. semantic reference;
3. current logical value;
4. replacement logical value;
5. exact one-file source diff;
6. affected scenes/assets/usages;
7. an explicit shared-source warning when applicable;
8. for audio, the owning sound plan plus derived catalog synchronization note;
9. Apply and Cancel.

Changing the replacement only recomputes the local draft/diff. It does not touch disk.

### Apply semantics

On Apply, the backend:

1. resolves a known `sourceDocumentId` to a canonical repository-owned document;
2. rereads the source;
3. rejects a stale `expectedHash`;
4. validates source-document category, target kind, and semantic-ref family;
5. converts the reviewed frontend range from UTF-16 code-unit offsets to Rust byte offsets;
6. rejects a range that is not an exact Unicode scalar boundary in the current source;
7. rejects if the exact current source slice differs from `originalSourceText`;
8. replaces only that slice;
9. writes atomically inside the resolved workspace path;
10. runs fixed target-specific authoritative validation;
11. returns the new hash plus validation result.

No frontend-supplied filesystem path or shell command is accepted.

## Architecture

```text
Existing Reader / Assets selection
             │
             ▼
load_workbench_source_document(sourceDocumentId)
             │ known document + SHA-256 source snapshot
             ▼
@lyra/scripts/workbench/source-edit-targets.ts
             │ dev-only semantic target index
             ▼
focused-edit.ts
             │ one FocusedEditDraft + exact diff + impact
             ▼
FocusedEditReview.svelte
             │ explicit human Apply
             ▼
apply_workbench_source_edit
     Rust fixed-domain resolver + stale/range/slice guard + atomic write
             │
             ├── scene/character target → scenes:compile
             │
             └── audio target → audio-owned prompt sync
                                      → audio:validate
                                      → audio:apply --check
                                      → scenes:compile
             ▼
validation result → refresh existing Reader / Assets projection
```

### Why this shape

- Reader and Assets remain selection/impact owners; HPA-135 does not create a parallel scene or asset model.
- Compiler/tooling owns authored syntax discovery. The Workbench does not implement a second scene Markdown or YAML grammar.
- Production scene JSON stays unchanged; edit location metadata is dev-tool-only.
- Rust remains the filesystem trust boundary.
- One `FocusedEditDraft` is also the later HPA-136 handoff seam.
- Audio remains owned by the durable sound-plan workflow instead of treating generated/catalog state as an arbitrary text field.

## Source document identity

Use a closed `SourceDocumentId` vocabulary:

```ts
export type SourceDocumentId =
  | `scene:${string}:${string}`
  | "asset-config:characters"
  | `audio-plan:${string}`;
```

The interpolated values are IDs, never paths.

### Scene document

```text
scene:<chapterId>:<sceneId>
```

Resolve through the existing compiler-generated chapter manifest and the same canonical authored-scene resolver used by `load_scene_bundle_at_root()`.

### Character config

```text
asset-config:characters
```

Resolve to the existing fixed path:

```text
static/assets/config/characters.yaml
```

### Audio plan

```text
audio-plan:<chapterId>
```

Resolve only after proving `<chapterId>` exists in the current manifest, then construct:

```text
docs/audio_plans/<chapterId>.sound-plan.yaml
```

Reject separators/traversal/malformed IDs. The audio catalog is intentionally not a Workbench source document for this ticket.

## Source snapshot contract

Add one no-arbitrary-path Tauri read command:

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

`hash` is lowercase SHA-256 over exact UTF-8 source bytes. It is a stale-edit version token, not a security signature.

Add `sha2 = "0.10"` only to the layout-editor Rust crate. Source loading stays lazy; Reader/Assets snapshots do not embed all authored Markdown/sound-plan text.

## Semantic references

Semantic refs are human-readable, closed by prefix, and never contain paths or source offsets:

```text
reader:dialogue:<carrierId>:<itemIndex>
reader:action:<carrierId>:<itemIndex>
asset:background:<unitId>
asset:evidence:<evidenceId>:imagePrompt
asset:character:<characterId>:visualPrompt
asset:character:<characterId>:expression:<expressionId>:prompt
asset:audio:<channel>:<audioId>:prompt
```

## Dev-only source target index

Create:

```text
packages/scripts/workbench/source-edit-targets.ts
```

It is filesystem-free and browser-safe. It can reuse the scripts package's `yaml` dependency; the layout editor must not add/directly own a separate YAML parser.

Public model:

```ts
export type WorkbenchSourceRange = {
  // JavaScript String.prototype.slice() semantics: UTF-16 code-unit offsets.
  start: number;
  end: number;
  startLine: number;
  endLine: number;
};

export type WorkbenchSourceTarget = {
  semanticRef: string;
  kind:
    | "readerDialogue"
    | "readerAction"
    | "backgroundPrompt"
    | "evidenceImagePrompt"
    | "characterVisualPrompt"
    | "characterExpressionPrompt"
    | "audioPrompt";
  currentText: string;
  sourceRange: WorkbenchSourceRange;
  sourceText: string;
};
```

The range contract is deliberately UTF-16 because it is produced and consumed by JavaScript string indices. Rust must explicitly translate those offsets by walking Unicode scalar values and accumulating `char::len_utf16()`. Never use these numbers directly as Rust UTF-8 byte indices. Add CJK and emoji tests so this cannot regress.

Expose narrow entrypoints:

```ts
indexSceneSourceEditTargets(input)
indexCharacterSourceEditTargets(input)
indexAudioPlanSourceEditTargets(input)
renderSourceReplacement(target, replacementText)
```

Do not expose a generic `find(path, field)` API.

### Scene dialogue/action indexing

Reuse both existing compiler-owned seams:

- `tokenize()` for authored line/source positions;
- `deriveDialogueSegments()` for exact Reader/compiler carrier traversal and IDs.

Do not write another investigation/interrogation/analysis block parser.

Algorithm:

1. tokenize the loaded authored scene source;
2. derive Reader/compiler dialogue segments from the already-loaded compiled scene;
3. flatten compiler segments in authored traversal order with `carrierId` + item index;
4. flatten authored sceneTag/action/dialogue tokens in source order;
5. pair in order and assert kind + authored text/speaker match;
6. emit targets only for paired `line` and `action` items;
7. if completeness/matching fails, emit an edit-specific diagnostic and disable scene text editing rather than guessing.

Extend tokenizer tokens with raw token start/end offsets and end line without changing parser semantics.

For dialogue, the target range is only text after the full-width colon; speaker/expression markup stays outside the range. Dialogue replacement is single-line only.

For action, the target range is bracket contents; `[` / `]` stay outside. Multi-line action replacement is allowed because the existing tokenizer already supports multi-line bracket actions.

The compiler remains final authority after apply.

### Scene `Background Prompt` indexing

Use existing scene tokens and compiler asset identity conventions, never reverse-parse `finalPrompt`.

Supported scene-owned sources:

- structural visual unit metadata with its authored unit/anchor ID;
- scene-tag visual metadata, using the existing enrichment convention `tag_001`, `tag_002`, ... in authored scene-tag order.

Associate only an existing authored `Background Prompt` metadata value.

Do not show HPA-135 Background Prompt editing for global-file-owned or character-owned background manifest entries.

### Evidence `Image Prompt` indexing

Find the compiler-tokenized evidence manifest heading for the selected `evidenceId`, then that block's existing `Image Prompt` metadata value. Do not synthesize a missing field.

### Character YAML indexing

Use `YAML.parseDocument()` and YAML node ranges to find only:

```text
characters[character.id].visualPrompt
characters[character.id].expressions[expressionId].prompt
```

Lookup is by parsed IDs, not frontend array positions.

Only replace the selected scalar source span. Preserve unrelated comments/order/formatting. Preserve the selected scalar style where practical: block scalar stays block-style; quoted scalar stays quoted; plain scalar stays plain when YAML-safe, otherwise quote only the edited scalar.

Do not stringify the whole YAML document.

### Audio sound-plan indexing

Use `YAML.parseDocument()` to find exactly one `entries[]` item matching `(channel,id)` and expose only its prompt scalar.

Reject editing when:

- no owning sound-plan entry exists;
- more than one matching entry exists;
- the entry is not an existing `approved` or `generated` entry;
- an owning chapter plan cannot be resolved from typed audio source/usage context.

Workbench edits the sound-plan prompt, not `static/assets/config/audio.yaml` directly.

## Focused edit model

Create:

```text
apps/layout-editor/src/lib/focused-edit.ts
```

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
  kind: WorkbenchSourceTarget["kind"];
  sourceRange: WorkbenchSourceRange;
  originalText: string;
  originalSourceText: string;
  replacementText: string;
  replacementSourceText: string;
  impact: FocusedEditImpact;
};
```

There is no draft database ID, author/status workflow, timestamps, or history.

`renderSourceReplacement(target, replacementText)` is owned by the scripts source-target module, so Rust does not need to understand Markdown/YAML rendering. Rust applies exactly the already-reviewed replacement source slice after all guards pass.

### Diff generation

Do not add a diff dependency for one focused edit.

Generate a deterministic unified-style single hunk from the immutable source snapshot, target range, and replacement source text, with up to three unchanged context lines on either side.

Show exact authored syntax. The diff is presentation-only; apply uses range + exact source-slice guards, never a diff parser.

## Impact projection

Reuse existing Reader/Assets data instead of rescanning the repository.

### Reader text/action

Selected scene only:

```text
usageCount = 1
shared = false
```

### Scene background/evidence prompt

Reuse `workspace.sceneUsages` for the selected manifest asset ID. Show total occurrences, distinct scenes, and asset ID. Mark `shared` when the same generated asset is reused by multiple occurrences.

### Character expression prompt

Reuse existing expression usage counts and `assetUsageGroups()` scene grouping.

### Character `visualPrompt`

This is a shared identity layer. Collect typed manifest entries whose `source.characterId` matches, then join those asset IDs to existing `sceneUsages`. Show affected portrait/standee asset IDs and scenes.

### Audio prompt

Join by typed audio source `(channel,id)`, never by parsing the asset ID string. Show all current scene usages and shared warning as applicable.

## Shared review surface

Create:

```text
apps/layout-editor/src/lib/FocusedEditReview.svelte
```

Render it once from `App.svelte`. ReaderView and AssetsView emit only a narrow edit-selection callback; they do not own source loading/writing or parallel review state.

This becomes the HPA-136 reuse seam: AI can later supply an initial replacement for an already-resolved target, but it cannot bypass this human review or create another write command.

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

## Backend guarded write

Add one Tauri mutation command:

```text
apply_workbench_source_edit
```

Request:

```ts
export type ApplyWorkbenchSourceEditRequest = {
  sourceDocumentId: SourceDocumentId;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTarget["kind"];
  range: { start: number; end: number }; // UTF-16 code-unit offsets
  originalSourceText: string;
  replacementSourceText: string;
};
```

Response:

```ts
export type WorkbenchValidationDiagnostic = {
  stream: "stdout" | "stderr";
  line: string;
};

export type ApplyWorkbenchSourceEditResult = {
  sourceDocumentId: SourceDocumentId;
  sourcePath: string;
  newHash: string;
  changedRange: { start: number; end: number }; // new UTF-16 range
  validation: {
    ok: boolean;
    commands: string[];
    diagnostics: WorkbenchValidationDiagnostic[];
  };
};
```

### Range conversion

Add a private Rust helper conceptually equivalent to:

```rust
fn utf16_range_to_byte_range(source: &str, start: usize, end: usize) -> Result<Range<usize>, EditorError>
```

Walk `source.char_indices()`, accumulate each char's `len_utf16()`, and map only exact code-unit boundaries to byte offsets. Reject ranges that split a surrogate pair/code point, are reversed, or exceed source length.

Tests must include:

- Japanese text before/inside the edit range;
- an emoji before the edit target (two UTF-16 code units, four UTF-8 bytes);
- an invalid midpoint inside the emoji UTF-16 pair.

### Backend checks

Reject before writing when:

- `sourceDocumentId` is malformed/unsupported;
- semantic-ref prefix is not one of the seven families;
- target kind and semantic-ref prefix disagree;
- document category and target kind disagree;
- hash differs from `expectedHash`;
- range is invalid under the UTF-16 contract;
- current source slice differs from `originalSourceText`;
- replacement source slice is identical.

Stable errors:

```text
sourceDocumentUnsupported
sourceEditKindUnsupported
sourceEditSemanticRefInvalid
sourceEditStale
sourceEditRangeInvalid
sourceEditOriginalMismatch
sourceEditNoChange
sourceEditWriteFailed
sourceEditValidationFailed
```

`sourceEditValidationFailed` must not imply rollback. UI says **Applied, validation failed**, shows diagnostics, and leaves changed source on disk for another edit or Git revert.

### Atomic source write

Generalize the existing same-directory temp-file + rename helper narrowly so it can write an already-resolved canonical source path without following a target symlink. Reuse it for layout sidecars and HPA-135; do not create a generic filesystem service.

## Authoritative validation

Frontend never supplies a command. Rust selects a fixed command sequence and invokes `std::process::Command` with `current_dir(workspace_root)`; no shell string is evaluated.

### Scene / character targets

For Reader dialogue/action, Background Prompt, evidence Image Prompt, character visualPrompt, and character expression prompt:

```text
bun run scenes:compile
```

This is the authoritative parser/enrichment/corpus validator and refreshes generated resources consumed by Reader/Assets.

### Audio target

Current `audio:apply` intentionally rejects an approved/generated entry whose prompt conflicts with an existing catalog entry. Do not weaken that guard.

Add one narrow audio-owned command:

```text
audio:revise-prompt <plan.yaml> <channel> <id>
```

It must:

1. load and validate the sound plan;
2. find exactly one existing `approved`/`generated` entry matching `(channel,id)`;
3. read its already-edited prompt;
4. parse `static/assets/config/audio.yaml` through existing audio-catalog ownership;
5. require the catalog entry to exist;
6. replace only that catalog prompt and preserve `loop`;
7. serialize/format via existing audio-catalog helpers;
8. never touch cue assignments, media files, provider metadata, or other entries.

Then backend validation runs:

```text
bun run audio:revise-prompt <plan.yaml> <channel> <id>
bun run audio:validate <plan.yaml>
bun run audio:apply <plan.yaml> --check
bun run scenes:compile
```

Source-of-truth direction:

```text
sound-plan prompt (authored edit)
      ↓
audio-owned revise-prompt
      ↓
audio catalog derived synchronization
      ↓
normal validate/apply --check
```

Capture bounded stdout/stderr (last 200 lines per command is sufficient). No terminal emulator/log database.

## Stale-edit behavior

Expected-hash guard is mandatory:

```text
open edit at hash A
→ external change produces hash B
→ Apply
→ sourceEditStale, no write
→ Reload source
→ discard stale draft and resolve target again from B
```

Do not auto-merge/rebase replacement text in v1. Keep the exact original-slice check even after the hash guard.

## Undo decision

**Do not implement Workbench Undo in HPA-135.**

The ticket makes undo optional. Git already owns durable history, and audio prompt edits deliberately synchronize a derived catalog source after applying the sound-plan edit. A one-file inverse patch would be misleading and would add state immediately before HPA-136 needs one simple forward mutation boundary.

## UX integration

### Reader

Preserve projection-only edit identity on line/action items:

```ts
export type ReaderEditableRef = {
  carrierId: string;
  itemIndex: number;
};
```

Only line/action items show Edit. No source spans enter runtime JSON.

### Assets — Library background/evidence

In the existing inspector:

- scene-owned background source with `unitId` → **Edit source prompt**;
- scene-owned evidence source with `evidenceId` → **Edit source prompt**;
- global/character-owned background/evidence source → no HPA-135 edit action.

Resolve raw current prompt lazily from the source target. Do not edit `finalPrompt` or enriched manifest text.

### Assets — Characters

Add Edit beside existing non-null `visualPrompt` and each existing expression prompt. Do not create a missing visualPrompt in v1.

### Assets — Audio

Show Edit only when one owning sound-plan entry can be resolved. Review shows:

```text
Authored source: docs/audio_plans/chapter_1.sound-plan.yaml
Derived sync: static/assets/config/audio.yaml
```

The reviewed diff is the sound-plan diff.

## HPA-136 seam

HPA-136 may reuse only the resolved target + focused draft/review flow, conceptually:

```ts
openFocusedEdit(target, initialReplacement?)
```

AI is not allowed to invent a source path/range or call `apply_workbench_source_edit` without the human review.

## Error/drift behavior

Source target indexing is strict. If source tokens/YAML nodes cannot be matched exactly:

- Reader/Assets remain readable;
- show an edit-specific diagnostic;
- hide/disable Apply;
- never fall back to text search-and-replace.

If validation fails after a successful write:

- show **Applied, validation failed**;
- show fixed command + bounded diagnostics;
- leave changed source on disk;
- do not refresh stale generated projections as if compile succeeded.

## Testing strategy

### Scripts

`source-edit-targets.test.ts` covers:

- dialogue text-only range while preserving speaker/expression markup;
- action range and multi-line action;
- strict carrier/source-token mismatch diagnostic;
- `tag_001`, `tag_002` Background Prompt identity;
- structural unit Background Prompt;
- evidence Image Prompt by evidence ID;
- character visualPrompt block scalar;
- character expression scalar;
- audio prompt by `(channel,id)`;
- missing/duplicate/non-approved audio target rejection;
- replacement rendering rules.

Tokenizer tests prove raw source ranges and continue to pass parser regressions.

### Frontend pure/component tests

Cover:

- draft construction + exact one-hunk diff;
- no-change rejection;
- Reader selected-scene impact;
- background/evidence shared usages;
- character identity/expression impact;
- typed audio impact;
- Reader Edit only on line/action;
- Assets Edit only on supported prompt sources;
- shared warnings;
- review editing/applying/applied-valid/applied-invalid/stale states;
- one shared review path with no queue/history/undo.

### Rust

Temporary-workspace tests cover:

- allowed SourceDocumentId resolution;
- path/traversal rejection;
- SHA-256 changes;
- stale hash no write;
- ref/kind/document mismatch;
- original-slice mismatch;
- UTF-16 → UTF-8 range conversion with Japanese + emoji;
- invalid surrogate-pair midpoint rejection;
- one-slice write preserving unrelated bytes;
- fixed validation dispatch;
- applied-but-invalid validation result.

### Audio

Cover:

- one approved/generated sound-plan entry updates only matching catalog prompt;
- `loop` unchanged;
- unrelated catalog entry semantically unchanged after canonical formatting;
- missing/duplicate/non-approved plan entry rejection;
- missing catalog entry rejection;
- normal `audio:apply` duplicate conflict unchanged;
- `audio:apply <plan> --check` succeeds after revision synchronization.

### Real Chapter 1 read-only gate

Add `apps/layout-editor/scripts/verify-focused-edit-real-content.ts` using repository-owned read/index helpers. It must discover at least one real target from each family:

- Reader dialogue;
- Reader action;
- Background Prompt;
- evidence Image Prompt;
- `soma_ritsu` visualPrompt;
- `soma_ritsu` standard expression prompt;
- one existing generated Chapter 1 audio prompt.

The verifier is read-only. Backend mutation behavior stays in temp-workspace tests.

## Required checks

```text
bun run scenes:compile
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
bun run editor:check
bun run editor:build
bun run test:scripts
bun run lint:all
```

The Linear ticket abbreviates `bun run audio:validate`, but the current CLI requires `<plan.yaml>`. Use the concrete Chapter 1 command above.

## Acceptance criteria

- [ ] Reader edits one selected dialogue line through the shared reviewed-diff flow.
- [ ] Reader edits one selected action/stage direction through the same flow.
- [ ] Assets edits one supported scene-owned Background Prompt and one evidence Image Prompt.
- [ ] Assets Characters edits one existing visualPrompt and one existing expression prompt.
- [ ] Assets audio edits one existing prompt through its owning sound plan and audio-domain synchronization, never direct UI catalog mutation.
- [ ] Every review shows exact authored-source diff, semantic ref, path, and affected usage impact.
- [ ] Shared character/audio/asset prompts show explicit impact warning.
- [ ] Backend accepts only known SourceDocumentId values and the seven supported target families.
- [ ] UTF-16 source offsets are explicitly converted/validated before Rust byte slicing; Japanese/emoji tests pass.
- [ ] Stale hash, original-slice mismatch, invalid range, unsupported target, and malformed semantic ref fail without source mutation.
- [ ] Successful apply replaces only the reviewed source slice.
- [ ] Authoritative validation runs automatically and success/failure is visible.
- [ ] Validation failure is represented as applied-but-invalid, not false success/no-op.
- [ ] Production scene JSON/schema is unchanged.
- [ ] No proposal queue, undo/history model, general editor, arbitrary path write, AI provider, auto commit/branch/PR, or media generation is added.
- [ ] HPA-136 can reuse the same focused review/apply boundary with no second mutation path.
- [ ] Implementation lands in this same single PR.

## Non-goals

- AI review/provider calls — HPA-136.
- Story Bible/Chapter Plan editing.
- General Markdown/YAML editor.
- Multi-file/multi-hunk authoring UI.
- Proposal/history database.
- Autosave/background mutation.
- Git commit/branch/PR automation.
- Source merge/rebase on stale edits.
- Workbench Undo.
- New assets/media generation.
- Audio cue assignment or sound-plan redesign.
- Game runtime scene schema changes.

## Design summary

HPA-135 is a **small write seam, not an editor platform**:

- Reader/Assets identify what the author selected;
- compiler/audio tooling resolves the exact authored source target;
- one local `FocusedEditDraft` renders exact diff + impact;
- Rust resolves known documents, converts/guards source ranges, writes one reviewed replacement, and runs fixed validation;
- audio prompt revision stays under sound-plan/audio ownership;
- HPA-136 later supplies suggestions into the same human review rather than creating another source mutation path.
