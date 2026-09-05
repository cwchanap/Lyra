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

These changes directly address the review findings around investigation dialogue ordering, parser duplication, YAML writeback reuse, tokenizer raw/source ranges, Rust slicing complexity, command-dispatch coverage, missing ReaderView test ownership, live validation proof, and audio-plan joining.

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

```ts
export type SourceDocumentId =
  | `scene:${string}:${string}`
  | "asset-config:characters"
  | `audio-plan:${string}`;
```

Interpolated values are IDs, never paths.

- Scene documents resolve through the existing compiler-generated manifest and authored-source containment path.
- Characters resolve to fixed `static/assets/config/characters.yaml`.
- Audio plan IDs prove chapter membership first, then resolve to `docs/audio_plans/<chapterId>.sound-plan.yaml`.
- Reject malformed IDs, separators, traversal, unknown chapters/scenes, and unsupported prefixes.

## Source snapshot contract

```ts
export type WorkbenchSourceDocument = {
  id: SourceDocumentId;
  path: string;
  content: string;
  hash: string;
};
```

`hash` is lowercase SHA-256 over exact UTF-8 bytes. It is a stale-edit version token, not a signature. Source loading stays lazy.

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

Create `packages/scripts/workbench/source-edit-targets.ts`. It remains filesystem-free/browser-safe. Compiler tooling owns authored syntax discovery; the Workbench does not add another scene/YAML grammar.

### Tokenizer source ranges

Every token gets an exact raw-source `range`; editable metadata/dialogue/action also get a `valueRange`.

```ts
export type SourceRange = {
  start: number; // JavaScript UTF-16 string index, local TypeScript use only
  end: number;
  startLine: number;
  endLine: number;
};
```

Rules:

- ranges use untrimmed source offsets and preserve CRLF/indentation;
- dialogue value is only text after `：`;
- action value is only bracket contents;
- metadata value is only the authored value;
- current normalized token semantics do not change;
- existing whole-token tests are updated for the extra fields;
- add indentation, CRLF, CJK, and multiline-action slice tests.

### Reader dialogue/action binding

Reader owns final semantic identity. Raw `deriveDialogueSegments()` order is not suitable because investigation/interrogation put outro before body segments while Reader consumes outro last.

`carrierGroup()` adds `ReaderEditableRef { carrierId, itemIndex }` to line/action items. Source binding then:

1. tokenizes source into lexical dialogue/action slices;
2. flattens the existing Reader group tree in rendered order, skipping notices/scene tags;
3. matches kind/text/speaker;
4. emits refs from the Reader-owned carrier ID/item index;
5. returns `workbenchSourceDialogueMismatch` and no guessed targets on drift.

The mandatory regression fixture is a real-shaped investigation containing intro, hotspot inspect, topic dialogue, evidence/onCollect, and outro after the sublocations.

### Scene prompts

Prompt discovery parses the source with the existing scene parser first. Parsed AST identity owns structural unit/evidence association; tokenizer ranges only locate the metadata field already accepted by the parser.

- structural Background Prompt uses sublocation/phase ID;
- scene-tag prompt uses shared `sceneTagUnitId(index)`, extracted from the current enrichment convention;
- every scene tag increments the index, including prompt-less tags;
- evidence Image Prompt uses the parsed evidence ID/owner;
- only existing fields are editable; no field synthesis.

## YAML source mutation

Reuse the existing `YAML.parseDocument()` → locate identified entry → `node.set()` → `doc.toString()` pattern used by `packages/scripts/audio/plan-writeback.ts`.

- Character identity comes from `parseCharactersYamlText()`.
- Sound-plan identity/status comes from `parseSoundPlanText()`.
- No custom scalar renderer.
- Reparse the generated content through the canonical parser.
- Preserve comments and unrelated semantic entries.
- If serialization changes unrelated source, the focused-edit locality guard rejects the candidate rather than adding another serializer.

## Focused edit model

```ts
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

No persistent draft ID, timestamps, queue, history, or status database.

### Diff/locality guard

No diff dependency. Generate one unified-style focused hunk with up to three context lines.

The selected Markdown value range or YAML scalar/node block is the locality boundary. If `nextContent` changes anything outside that local block, return `focusedEditSourceChurn` and disable Apply. The diff is presentation-only; Rust receives reviewed `nextContent`.

## Impact projection

Reuse current Reader/Assets data:

- Reader text/action: selected scene only.
- Background/evidence: current `sceneUsages` for the selected manifest asset.
- Character expression: existing usage count + `assetUsageGroups()`.
- Character visualPrompt: typed character manifest sources joined to current scene usages.
- Audio `(channel,id)`: typed audio manifest source, never parsed from the asset ID.

Audio plan ownership uses concrete usage chapters: gather distinct `chapterId`s for the selected audio asset from `workspace.sceneUsages`; expose Edit only when exactly one chapter owns current usages. Zero/multiple chapters produce `focusedEditAudioPlanAmbiguous`, never a guessed plan.

## Backend write boundary

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

No frontend path, source range, byte offset, or shell command crosses IPC.

Backend rejects malformed/unsupported document IDs, kind/ref/document mismatches, stale hash, and no-change. It then atomically writes the full reviewed `nextContent` through a generalized version of the existing same-directory temp-file + sync + rename writer.

There is no UTF-16/UTF-8 source-range conversion in Rust.

## Authoritative validation

Story/character edits:

```text
bun run scenes:compile
```

Audio edits:

```text
bun run audio:revise-prompt <plan.yaml> <channel> <id>
bun run audio:validate <plan.yaml>
bun run audio:apply <plan.yaml> --check
bun run scenes:compile
```

`audio:revise-prompt` is a separate audio-owned command. It reads the edited approved/generated plan entry and updates only the matching existing catalog prompt while preserving loop. Normal `mergeApprovedEntriesIntoCatalog()` conflict behavior stays unchanged.

The layout-editor's first `std::process::Command` workflow gets a private injected runner seam for argv/cwd/order/non-zero-stop/bounded-output tests plus one real Bun process-spawn/cwd test. No generic command-runner IPC or service is introduced.

A successful source write is not rolled back when validation fails. UI reports **Applied, validation failed** and shows diagnostics.

## Shared review surface

`FocusedEditReview.svelte` is rendered once by `App.svelte`. ReaderView/AssetsView only emit narrow edit-selection callbacks; they do not load/write source or own separate review state.

This is the exact seam HPA-136 reuses later: AI may supply an initial replacement, but cannot bypass human review or add another writer.

## Undo decision

Do not implement Workbench Undo in HPA-135. Git owns history; audio apply can also update the derived catalog.

## Testing / acceptance locks

Must include:

- real-shaped investigation Reader binding (hotspot/topic/outro);
- raw tokenizer range edge cases;
- parser-owned prompt association and all-tag numbering;
- YAML Document mutation/reparse/comment preservation/locality guard;
- audio normal-conflict regression + focused revision path;
- `ReaderView.test.ts` as a new file;
- Rust full-document stale-guarded write;
- fake and real process-dispatch tests;
- exactly-one-chapter audio plan join;
- read-only real Chapter 1 verifier for all seven target families;
- live throwaway Workbench edit proving Apply → backend `scenes:compile`, then Git revert;
- live temporary audio-prompt edit proving revise → validate → apply-check → compile, then Git revert without media generation.

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

- [ ] Seven target families only; no generic field editor.
- [ ] Reader identity comes from existing Reader traversal, including real investigation ordering.
- [ ] Scene prompt association reuses current parsers/enrichment identity.
- [ ] YAML writeback reuses Document mutation and rejects unrelated source churn.
- [ ] Rust receives only known document ID/hash/ref/kind/full reviewed `nextContent`; no source range mapper.
- [ ] Audio edit resolves exactly one owning chapter and keeps sound-plan ownership.
- [ ] Normal audio apply conflict semantics stay unchanged.
- [ ] Validation process dispatch has argv/cwd/non-zero-stop coverage and a real spawn test.
- [ ] Applied-but-invalid is explicit; no fake rollback.
- [ ] Production scene JSON/runtime schema stays unchanged.
- [ ] No queue/history/undo, Plan editing, AI provider, auto Git, or media generation.
- [ ] HPA-136 reuses the same reviewed edit/apply boundary.
- [ ] Implementation lands in this same PR.

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
