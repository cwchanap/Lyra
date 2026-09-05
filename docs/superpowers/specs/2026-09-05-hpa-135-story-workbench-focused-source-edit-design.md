# HPA-135 Story Workbench Focused Source Edit Design

## Status

Planning design for **HPA-135 — [Story Workbench] Edit one story or prompt source through a reviewed diff**.

One ticket, one PR. This PR is planning-only at first and is the same PR that should carry implementation after review; do not split HPA-135 into a planning PR plus an implementation PR.

## Why HPA-135 is next

The current Story Workbench sequence is ready for its first controlled write path:

- HPA-634 Reader is complete and already owns continuous scene/carrier projection.
- HPA-134 Assets is complete and already owns canonical prompt layers plus usage impact.
- HPA-273 Plan is complete and remains read-only context for the later AI slice.
- HPA-136 AI review is explicitly blocked by HPA-135 and must reuse this exact review/apply boundary.
- Chapter 2 / later-chapter implementation remains deferred by the Lyra roadmap, so starting those platform tickets instead would jump the current gate.

Therefore HPA-135 should add the smallest author-controlled source mutation seam on top of the already-shipped Workbench rather than broadening the roadmap.

## Goal

Let an author select **one supported story text or prompt value**, type one replacement, inspect an exact source diff and usage impact, explicitly apply it through a stale-safe backend boundary, then see the authoritative validation result.

The design intentionally stops before becoming a general editor:

```text
select one supported value
→ type replacement
→ review exact diff + impact
→ Apply or Cancel
→ guarded source write
→ authoritative validation
→ refresh existing Reader / Assets view
```

Git remains the durable history. The Workbench does not add a proposal database, revision timeline, autosave queue, or branch/commit machinery.

## Supported edit targets

HPA-135 supports exactly seven semantic target kinds.

| Surface | Target | Canonical source |
|---|---|---|
| Reader | one dialogue line text | selected scene Markdown |
| Reader | one action / stage-direction text | selected scene Markdown |
| Assets | one scene-owned visual unit `Background Prompt` | selected scene Markdown |
| Assets | one evidence `Image Prompt` | selected scene Markdown |
| Assets → Characters | one character `visualPrompt` | `static/assets/config/characters.yaml` |
| Assets → Characters | one character expression `prompt` | `static/assets/config/characters.yaml` |
| Assets → audio | one existing audio entry prompt | owning `docs/audio_plans/chapter_<N>.sound-plan.yaml`, then synchronized through the audio-domain workflow |

No generic `fieldName`, arbitrary YAML path, arbitrary Markdown range, or file editor exists.

### Explicit exclusions

Do not add edit affordances for:

- scene tags;
- scene/chapter titles, summaries, IDs, statuses, unlocks, reveals, evidence descriptions, statement content, or other metadata;
- BGM/BGS cue assignment;
- audio `loop`, status, evidence, provider, generated metadata, or output paths;
- Plan-mode Story Bible / chapter-plan Markdown;
- global city-map prompt JSON;
- policy/global-style/type prompts;
- arbitrary asset manifest fields;
- new audio entries;
- multiple selected values or multi-file edits.

These are not hidden generic capabilities. Unsupported selections simply have no Edit action.

## Core product contract

### One active edit

Only one `FocusedEditDraft` may be active in the Workbench at a time.

Starting another edit replaces/cancels the current un-applied draft after a local confirmation only if the UI already has unsaved replacement text. There is no proposal list or queue.

### Review before apply

Before Apply becomes available, the shared review surface shows:

1. source path;
2. semantic reference;
3. current logical value;
4. replacement logical value;
5. exact one-file source diff for the authored source;
6. affected scenes/assets/usages;
7. a shared-source warning when the edited value affects more than the selected occurrence;
8. for audio only, a note that the existing audio workflow will synchronize the matching catalog prompt as a derived effect;
9. Apply and Cancel.

The user may continue editing the replacement while the review is open. Each keystroke recomputes the local diff from the same immutable source snapshot; it does not touch disk.

### Apply semantics

Apply is an explicit button press. The backend:

1. resolves the known `sourceDocumentId` to a canonical repository-owned document;
2. rereads the document;
3. rejects a stale `expectedHash`;
4. validates that the requested semantic target kind is compatible with the document category;
5. rejects when the exact source slice no longer equals the source snapshot used to build the draft;
6. replaces only that slice;
7. writes atomically within the resolved workspace path;
8. runs the target-specific authoritative validation;
9. returns the new source hash plus validation diagnostics.

No frontend-supplied filesystem path is accepted by the write command.

## Architecture

```text
Existing Reader / Assets selection
             │
             ▼
load_workbench_source_document(sourceDocumentId)
             │  known document + content hash only
             ▼
@lyra/scripts/workbench/source-edit-targets.ts
             │  dev-only semantic target index
             ▼
focused-edit.ts
             │  FocusedEditDraft + exact source diff + impact
             ▼
FocusedEditReview.svelte
             │
             ▼
apply_workbench_source_edit
     Rust fixed-domain resolver + stale/slice guard + atomic write
             │
             ├── scene/character target → scenes:compile
             │
             └── audio target → audio prompt sync → audio:validate
                                      → audio:apply --check
                                      → scenes:compile
             ▼
validation result → refresh existing Reader / Assets snapshot
```

### Why this shape

- Reader and Assets stay the source of UI selection/impact; HPA-135 does not create another parallel scene or asset model.
- The compiler/tooling package owns authoring syntax discovery. The Workbench does not reimplement the scene Markdown grammar or YAML structure.
- Production scene JSON remains unchanged. Source edit ranges are dev-tool metadata, not game runtime data.
- Rust remains the filesystem trust boundary and never receives an arbitrary path.
- A single `FocusedEditDraft` becomes the seam HPA-136 can populate later; AI does not need a new write API.
- Audio remains owned by the durable sound-plan workflow instead of treating generated/catalog state as a normal text field.

## Source document identity

Introduce a small closed `SourceDocumentId` vocabulary.

```ts
export type SourceDocumentId =
  | `scene:${string}:${string}`
  | "asset-config:characters"
  | `audio-plan:${string}`;
```

The strings after `scene:` and `audio-plan:` are IDs, not paths.

Backend resolution rules:

### Scene document

```text
scene:<chapterId>:<sceneId>
```

Resolve through the existing compiler-generated chapter manifest path used by `load_scene_bundle_at_root()` / `resolve_manifest_scene_at_root()`.

The caller never supplies `docs/stories_plan/...` to the read or write command.

### Character config

```text
asset-config:characters
```

Resolve to the existing fixed constant:

```text
static/assets/config/characters.yaml
```

### Audio plan

```text
audio-plan:<chapterId>
```

Resolve only to the exact repository-owned pattern:

```text
docs/audio_plans/<chapterId>.sound-plan.yaml
```

`chapterId` must first be resolved from the existing chapter manifest set. A caller cannot smuggle path separators or arbitrary plan filenames through this ID.

The audio catalog is not a `SourceDocumentId` for HPA-135 because authors do not directly edit it from Assets.

## Source snapshot contract

Add one no-arbitrary-path read command:

```text
load_workbench_source_document(sourceDocumentId)
```

Frontend wire shape:

```ts
export type WorkbenchSourceDocument = {
  id: SourceDocumentId;
  path: string;
  content: string;
  hash: string;
};
```

Use SHA-256 over UTF-8 source bytes for `hash` and serialize it as lowercase hex. This is a stale-edit version token, not a security signature.

Add `sha2 = "0.10"` only to the layout-editor Rust crate; do not create a repository-wide hashing abstraction.

The source loader is lazy. Reader/Assets snapshots do not start embedding every authored Markdown/sound-plan file merely to support a possible edit.

## Semantic references

Keep `semanticRef` human-readable and closed by prefix.

```text
reader:dialogue:<carrierId>:<itemIndex>
reader:action:<carrierId>:<itemIndex>
asset:background:<unitId>
asset:evidence:<evidenceId>:imagePrompt
asset:character:<characterId>:visualPrompt
asset:character:<characterId>:expression:<expressionId>:prompt
asset:audio:<channel>:<audioId>:prompt
```

A semantic ref does not contain a path or raw byte offset.

Source ranges are separate snapshot metadata produced by the source-target index. This keeps the user-facing/reference identity stable while the guarded write can still be exact.

## Dev-only source target index

Create:

```text
packages/scripts/workbench/source-edit-targets.ts
```

This module is filesystem-free and browser-safe. It may reuse `yaml` from the scripts package but the layout editor must not add its own YAML parser or import `yaml` directly.

Public model:

```ts
export type WorkbenchSourceRange = {
  start: number;      // UTF-8/JS string offset in the loaded source snapshot
  end: number;        // exclusive
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
  sourceText: string; // exact bytes/chars at sourceRange in the snapshot
};
```

The module exposes narrow constructors rather than one generic `find(path, query)` API:

```ts
indexSceneSourceEditTargets(input)
indexCharacterSourceEditTargets(input)
indexAudioPlanSourceEditTargets(input)
```

### Scene dialogue/action indexing

Reuse the two compiler-owned seams already used by Reader:

- `tokenize()` for authored line locations/order;
- `deriveDialogueSegments()` for the exact carrier traversal and carrier IDs.

Do **not** write a second investigation/interrogation/analysis block parser.

Algorithm:

1. tokenize the loaded authored source;
2. derive Reader/compiler dialogue segments from the already-loaded compiled scene;
3. flatten compiler segments in authored traversal order, retaining `carrierId` + item index;
4. flatten authored `sceneTag` / `action` / `dialogue` tokens in source order;
5. pair them in order and assert kind + authored text/speaker match;
6. create edit targets only for paired `line` and `action` items;
7. on any carrier/token mismatch, return a source-index diagnostic and disable editing for the scene rather than guessing.

The existing strict Reader segment-completeness rule stays intact. This new check adds source-token completeness for editing only.

### Token ranges

Extend the compiler tokenizer with enough location metadata to identify the exact raw token span without changing parser semantics:

```ts
type SourceTokenRange = {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
};
```

Every token carries this range.

For a dialogue token, the editable range is only the dialogue text after the full-width colon; speaker/expression markup is outside the range.

For an action token, the editable range is the bracket contents; the surrounding `[` / `]` stay outside the range. Multi-line bracket actions may span multiple lines; the range must preserve the brackets and unrelated surrounding whitespace.

Reader replacements containing line breaks are allowed only where the existing token grammar can represent them:

- dialogue replacement: single line only;
- action replacement: may be multi-line because the tokenizer already supports multi-line bracket blocks.

The compiler remains the final authority after apply.

### Scene `Background Prompt` indexing

Use existing scene tokens plus the compiler's existing asset identity conventions; do not parse the manifest prompt string back into source.

Supported cases:

1. structural visual unit metadata (`Background Prompt`) associated with the authored unit/anchor ID used by the manifest source;
2. scene-tag visual cue metadata, where the existing asset enrichment already names units `tag_001`, `tag_002`, ... in authored scene-tag order.

The source index counts scene tags using the same 1-based, zero-padded convention and associates the following `Background Prompt` metadata token with that unit.

If a selected background manifest entry is global-file-owned or character-owned rather than `{ chapterId, sceneId, unitId }`, Assets does not offer the HPA-135 Background Prompt action.

### Evidence `Image Prompt` indexing

Find the compiler-tokenized evidence manifest block whose authored heading identifies the selected `evidenceId`, then the block's `Image Prompt` metadata token.

Only an actual authored `Image Prompt` field is editable. HPA-135 does not invent a missing prompt field or append new metadata.

### Character YAML indexing

Use `YAML.parseDocument()` from the scripts package and node ranges to locate only:

```text
characters[character.id].visualPrompt
characters[character.id].expressions[expressionId].prompt
```

The lookup is by parsed character/expression IDs, not by array index supplied by the frontend.

Preserve scalar style when replacing:

- block scalar remains a block scalar with the same chomp/fold style where practical;
- quoted scalar stays quoted;
- plain scalar stays plain when YAML-safe, otherwise the target renderer may quote only the edited scalar.

Do not stringify the whole YAML document. Only replace the selected scalar source range so comments/order/unrelated formatting remain untouched.

### Audio sound-plan indexing

Use `YAML.parseDocument()` to find exactly one `entries[]` item matching:

```text
channel + id
```

and expose only that entry's `prompt` scalar.

Reject editing when:

- no owning sound-plan entry is found;
- more than one matching entry exists in the selected plan;
- the entry is not an existing `approved` or `generated` entry;
- the selected library audio item has no concrete chapter ownership from its usage/source context.

The Workbench edits the sound plan prompt, not `static/assets/config/audio.yaml` directly.

## Focused edit model

Create:

```text
apps/layout-editor/src/lib/focused-edit.ts
```

Model:

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
  originalText: string;       // logical value
  originalSourceText: string; // exact source slice
  replacementText: string;
  replacementSourceText: string;
  impact: FocusedEditImpact;
};
```

`FocusedEditDraft` deliberately has no database ID, timestamps, author, status workflow, or proposal history.

### Replacement rendering

`workbench/source-edit-targets.ts` owns rendering the logical replacement into syntax-correct source text for its target:

```ts
renderSourceReplacement(target, replacementText)
```

`focused-edit.ts` combines that rendered source slice with the immutable source snapshot to generate the exact review diff.

This avoids making the Rust backend understand Markdown/YAML formatting rules. Rust validates target category, hash, range, and original source slice, then applies the already-reviewed exact replacement source slice.

### Diff generation

Do not add a diff dependency for one focused replacement.

Generate a deterministic one-hunk unified-style diff from:

- the original source snapshot;
- `sourceRange`;
- `replacementSourceText`;
- up to three unchanged context lines before and after the replacement.

Show exact authored syntax in the diff, including Markdown/YAML markers.

The diff is presentation only; apply uses the stored range + exact source slice guard, not a parsed diff patch.

## Impact projection

Reuse existing Reader/Assets models rather than rescanning repository files.

### Reader text/action

Impact is the selected scene only:

```text
usageCount = 1
shared = false
```

### Scene background/evidence prompt

Reuse `workspace.sceneUsages` for the selected manifest asset ID.

Show:

- total concrete usages;
- distinct affected scenes;
- selected asset ID.

If the same asset ID is referenced multiple times, `shared = true` and the review warns that regenerating that asset would affect every listed usage even though only one source prompt is edited.

### Character expression prompt

Reuse existing expression usage count + scene groups from `assetUsageGroups()`.

### Character `visualPrompt`

This value is a shared identity layer. Compute impact from manifest entries whose typed source references that `characterId`, then join those asset IDs to existing `sceneUsages`.

The review explicitly says this changes the shared character identity prompt and lists the affected portrait/standee asset IDs and scenes.

### Audio prompt

Join by typed audio source `(channel, id)`, never by parsing the asset ID string.

Show all scene usages of that audio asset and mark it shared when usage count is greater than one.

## Shared review surface

Create one component:

```text
apps/layout-editor/src/lib/FocusedEditReview.svelte
```

It is rendered once by `App.svelte`, not independently inside ReaderView and AssetsView.

ReaderView / AssetsView only emit a narrow `onEdit(request)` callback containing enough semantic selection to build a draft. App owns the one active draft and review panel/modal state.

This is the reuse seam for HPA-136: AI may later produce `replacementText` for an already-resolved target, but the review component and apply command stay unchanged.

### Review states

```text
idle
loading-source
editing
applying
applied-valid
applied-invalid
error
```

Do not create a generic state-machine library. A small discriminated union/local Svelte state is enough.

Apply is disabled when:

- replacement equals the original logical value;
- source target could not be resolved exactly;
- a source-index diagnostic exists;
- apply is already running.

## Backend guarded write

Add a single Tauri mutation command:

```text
apply_workbench_source_edit
```

Request wire shape:

```ts
export type ApplyWorkbenchSourceEditRequest = {
  sourceDocumentId: SourceDocumentId;
  expectedHash: string;
  semanticRef: string;
  kind: WorkbenchSourceTarget["kind"];
  range: { start: number; end: number };
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
  changedRange: { start: number; end: number };
  validation: {
    ok: boolean;
    commands: string[];
    diagnostics: WorkbenchValidationDiagnostic[];
  };
};
```

### Backend checks

The command must reject before writing when:

- `sourceDocumentId` is malformed or resolves to an unsupported document;
- `semanticRef` prefix is not one of the seven supported target kinds;
- target kind and semantic-ref prefix disagree;
- source-document category and target kind disagree;
- hash differs from `expectedHash`;
- range is out of bounds or not aligned to UTF-8/JS source boundaries used by the request contract;
- the current source slice differs from `originalSourceText`;
- replacement source slice is identical to original source slice.

Stable error codes:

```text
sourceDocumentUnsupported
sourceEditKindUnsupported
sourceEditSemanticRefInvalid
sourceEditStale
sourceEditRangeInvalid
sourceEditOriginalMismatch
sourceEditNoChange
sourceEditWriteFailed
sourceEditValidationFailed   // apply happened; validation did not pass
```

`sourceEditValidationFailed` must not lie about the write. The response/UI says **Applied, validation failed**, shows diagnostics, and keeps the changed source on disk for the author to fix or revert with Git.

### Atomic text write

Generalize the existing layout-editor atomic same-directory temp-file + rename helper so HPA-135 can write resolved source text without following a target symlink.

Do not build a filesystem service abstraction. One private helper that accepts an already-resolved canonical path and contents is enough.

## Authoritative validation

Validation is target-specific and fixed by the backend. The frontend never supplies a shell command.

Use `std::process::Command` with fixed executable/arguments and `current_dir(workspace_root)`; do not invoke a shell string.

### Scene / character targets

For:

- Reader dialogue;
- Reader action;
- Background Prompt;
- evidence Image Prompt;
- character visualPrompt;
- character expression prompt;

run:

```text
bun run scenes:compile
```

This is the authoritative parser/enrichment/corpus validation and regenerates the compiled/asset resources consumed by Reader/Assets.

### Audio target

The durable authored source is the chapter sound plan. The current `audio:apply` correctly rejects a changed approved/generated entry when the existing catalog prompt conflicts, so HPA-135 must add one narrow audio-owned revision seam rather than bypassing the workflow.

Extend `packages/scripts/audio/cli.ts` with:

```text
audio:revise-prompt <plan.yaml> <channel> <id>
```

and root/package scripts for the same command.

`audio:revise-prompt` must:

1. load and validate the supplied sound plan;
2. find exactly one `approved` or `generated` entry matching channel + id;
3. read the entry's prompt from the already-edited plan;
4. read and parse `static/assets/config/audio.yaml` through the existing audio catalog parser;
5. require the catalog entry to exist;
6. replace **only** that catalog entry's prompt, keeping its existing `loop` value;
7. serialize/format the catalog through the existing audio catalog owner;
8. never touch cue assignments, generated audio files, provider metadata, or other catalog entries.

After that synchronization, the Workbench validation runs:

```text
bun run audio:validate <plan.yaml>
bun run audio:apply <plan.yaml> --check
bun run scenes:compile
```

This makes the source-of-truth direction explicit:

```text
sound-plan prompt (author edit)
      ↓
audio-owned revise-prompt
      ↓
audio catalog derived sync
      ↓
normal validate/apply --check
```

Do not globally weaken `mergeApprovedEntriesIntoCatalog()` conflict behavior. Normal `audio:apply` keeps its existing safety semantics.

### Validation output

Capture bounded stdout/stderr lines for display. A simple cap (for example the last 200 lines per command) is enough; no log persistence or terminal emulator is needed.

On success, refresh the relevant existing snapshot:

- Reader edit → reload selected scene bundle;
- Assets prompt edit → refresh asset workspace after `scenes:compile`;
- character/audio edit → refresh Assets workspace;
- if the changed scene is also selected in Reader, its next normal load sees the compiled update.

No watcher is required.

## Stale-edit behavior

The expected-hash guard is mandatory.

Scenario:

1. author opens an edit at hash A;
2. file changes externally to hash B;
3. author presses Apply;
4. backend returns `sourceEditStale` without modifying the file;
5. UI offers **Reload source**;
6. reload closes the stale draft and reconstructs the target from hash B.

Do not auto-merge or rebase replacement text in v1.

The original-slice check remains mandatory even after the hash check; it catches malformed/mismatched target requests and makes tests explicit.

## Optional undo decision

**Do not implement Workbench Undo in HPA-135.**

The ticket makes undo optional. Omitting it is the smaller, safer scope because:

- Git already owns durable history;
- audio prompt edits have an intentional derived catalog synchronization step, so a one-file inverse patch would be misleading;
- a hash-guarded inverse action would add state and another write path immediately before HPA-136 needs a single simple boundary.

A user can edit again or use Git to revert. HPA-135 should first prove the controlled forward path.

## UX integration

### Reader

Reader currently renders `ReaderItem` values and knows the group/carrier being rendered. Extend the projected editable items with source selection identity only:

```ts
type ReaderEditableRef = {
  carrierId: string;
  itemIndex: number;
};
```

Only `line` and `action` items receive an Edit button.

Do not add source locations to runtime compiler JSON. `ReaderEditableRef` is a projection-only identity resolved against the lazy source target index.

### Assets — Library background/evidence

In the existing asset inspector:

- show **Edit source prompt** only for scene-owned background sources with `unitId`;
- show it for scene-owned evidence sources with `evidenceId`;
- resolve the selected scene document lazily;
- derive current raw source prompt from the source target, not from `finalPrompt` or enriched `entryPrompt`.

The current Prompt parts remain visible so the author can see global/type/subject/entry layers while editing only the allowed raw entry layer.

### Assets — Characters

Add explicit Edit actions beside:

- non-null `character.visualPrompt`;
- each existing expression prompt.

Do not create a prompt when `visualPrompt` is null in v1.

The review carries shared impact for visualPrompt and expression usage impact for expression prompt.

### Assets — Audio

Audio Library entries expose **Edit source prompt** only when HPA-135 can resolve one owning sound-plan entry.

If an audio asset is reused across scenes, the usage list remains the impact source.

The review displays:

```text
Authored source: docs/audio_plans/chapter_1.sound-plan.yaml
Derived sync: static/assets/config/audio.yaml
```

The diff itself is the sound-plan diff.

## HPA-136 seam

HPA-136 may depend only on these public HPA-135 concepts:

```ts
ResolvedFocusedEditTarget
FocusedEditDraft
openFocusedEdit(target, initialReplacement?)
```

The later AI review is allowed to provide `initialReplacement` for the already-selected target.

It is not allowed to:

- call `apply_workbench_source_edit` without opening the human review;
- invent a sourceDocumentId or range;
- write source directly;
- create another diff/apply component.

This preserves one human-controlled mutation path.

## Error and drift behavior

Source-target indexing is strict.

If a source token/YAML node cannot be matched to the selected semantic ref:

- keep Reader/Assets usable and read-only;
- show an edit-specific diagnostic;
- hide/disable Apply;
- do not fall back to text search/replace.

If the compiler/tool validation fails after a successful write:

- show **Applied, validation failed**;
- show the fixed command and bounded diagnostic output;
- leave the source change on disk;
- do not refresh compiled projections from stale generated files as though validation succeeded.

The user can fix the source through another focused edit when the target remains resolvable, or revert with Git.

## Testing strategy

### Scripts unit tests

Create focused tests for `workbench/source-edit-targets.ts`:

- dialogue line range resolves to text only, preserving speaker/expression markup;
- action range resolves inside brackets;
- multi-line action range;
- compiler carrier/source token mismatch is a diagnostic, never guessed;
- sceneTag order maps `tag_001`, `tag_002`, ... Background Prompts correctly;
- structural unit Background Prompt lookup by unit ID;
- evidence Image Prompt lookup by evidence ID;
- character visualPrompt block scalar range/style;
- character expression prompt scalar;
- audio plan prompt lookup by channel + id;
- missing/duplicate/non-approved audio entry rejected.

### Frontend pure tests

For `focused-edit.ts`:

- deterministic semantic ref → draft construction;
- no-change replacement disabled;
- one-hunk diff includes exact Markdown/YAML syntax and context;
- impact projection for one scene line;
- background/evidence shared asset usages;
- character identity prompt affects all typed character-source assets;
- expression prompt usage count;
- audio impact joins by `(channel,id)`.

### Component tests

Reader:

- line/action have Edit action;
- notices/scene tags do not;
- selecting Edit emits the expected carrier/item identity.

Assets:

- supported background/evidence rows show Edit source prompt;
- unsupported global/character-owned background does not;
- character visual/expression prompt actions show expected impact;
- audio action exists only with an owning plan target;
- shared warning is visible.

FocusedEditReview:

- current/replacement/source ref/diff shown;
- Apply disabled on no-change;
- stale error offers reload;
- applied-valid vs applied-invalid states are distinct;
- no queue/history UI exists.

### Rust tests

Test backend helpers against temporary workspace roots:

- sourceDocumentId resolves only allowed scene/config/audio-plan documents;
- path traversal in IDs rejected;
- SHA-256 hash changes when source changes;
- expected hash stale rejection causes no write;
- wrong semantic-ref kind rejected;
- out-of-range and non-boundary ranges rejected;
- original source slice mismatch rejected;
- successful one-slice write preserves all unrelated bytes;
- validation command selection is fixed by target kind;
- validation failure is reported after the source write rather than disguised as a no-op.

### Audio tests

Add tests for `audio:revise-prompt`:

- exactly one existing approved/generated plan entry syncs only its catalog prompt;
- `loop` stays unchanged;
- another catalog entry stays byte/semantic-equivalent after canonical formatting;
- missing plan entry/catalog entry rejected;
- duplicate sound-plan entry rejected;
- normal `audio:apply` duplicate-conflict behavior remains unchanged;
- `audio:apply <plan> --check` succeeds after revision sync.

### Real-content gate

Add one deterministic Chapter 1 verifier under `apps/layout-editor/scripts/` that does **read-only** target discovery on the real corpus and proves at least:

- one Reader dialogue target;
- one Reader action target;
- one scene Background Prompt;
- one evidence Image Prompt;
- `soma_ritsu` visualPrompt;
- `soma_ritsu` standard expression prompt;
- one generated Chapter 1 audio prompt from `chapter_1.sound-plan.yaml`.

The verifier must not mutate real sources. Backend write behavior is covered with temp-workspace tests.

## Required checks

Repository-wide HPA-135 completion checks:

```text
bun run scenes:compile
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
bun run editor:check
bun run editor:build
bun run test:scripts
bun run lint:all
```

The Linear ticket currently abbreviates `bun run audio:validate` without a plan path, but the existing CLI contract requires `<plan.yaml>`. The implementation/PR should use the concrete Chapter 1 plan command above rather than intentionally invoking the CLI usage error.

## Acceptance criteria

HPA-135 is complete when:

- [ ] Reader can edit one selected dialogue line through the shared reviewed-diff flow.
- [ ] Reader can edit one selected action/stage direction through the same flow.
- [ ] Assets can edit one scene-owned Background Prompt and one evidence Image Prompt through the same flow.
- [ ] Assets Characters can edit one existing character visualPrompt and one existing expression prompt.
- [ ] Assets audio can edit one existing prompt through its owning sound plan and audio-domain synchronization, never by direct catalog mutation from the UI.
- [ ] Every review shows exact authored-source diff, semantic ref, source path, and affected usages.
- [ ] Shared character/audio/asset prompts show an explicit impact warning.
- [ ] The backend accepts only known sourceDocumentId values and the seven supported semantic target kinds.
- [ ] Stale hash, mismatched original slice, invalid range, unsupported target, and malformed semantic ref fail without modifying source.
- [ ] A successful apply replaces only the reviewed source slice.
- [ ] Authoritative validation runs automatically and its success/failure is visible.
- [ ] Validation failure is represented as an applied-but-invalid state, not as a false success.
- [ ] Production scene JSON/schema is unchanged.
- [ ] No proposal queue, undo/history model, general editor, arbitrary path write, AI provider, auto commit/branch/PR, or media generation is added.
- [ ] HPA-136 can reuse `FocusedEditDraft` + `FocusedEditReview` without a second source mutation path.
- [ ] Implementation lands in this same single PR.

## Non-goals

- AI review/provider calls — HPA-136.
- Story Bible/Chapter Plan editing.
- General Markdown/YAML editor.
- Multi-file or multi-hunk authoring UI.
- Proposal/history database.
- Autosave/background mutation.
- Git commit/branch/PR automation.
- Source merge/rebase on stale edits.
- Workbench Undo.
- New assets or media generation.
- Audio cue assignment or sound-plan redesign.
- Changing the game runtime scene schema.

## Design summary

HPA-135 should be a **small write seam, not an editor platform**:

- existing Reader/Assets decide what the author selected;
- compiler/audio tooling identifies the exact authored source target;
- one local `FocusedEditDraft` renders the diff and impact;
- Rust resolves known documents, guards hash/source slice, writes one reviewed replacement, and runs fixed validation;
- audio prompt revision stays inside the sound-plan/audio ownership model;
- HPA-136 later supplies suggestions into this same human review instead of creating another mutation path.
