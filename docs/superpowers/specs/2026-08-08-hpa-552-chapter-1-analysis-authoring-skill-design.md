# HPA-552 Chapter 1 Analysis Scene Authoring Skill Design

**Status:** Proposed  
**Linear:** HPA-552 — Add the analysis-scene authoring skill for Chapter 1 writers  
**Scope:** Authoring contract and repo guidance only; no runtime, layout-editor, or Chapter 2 template work

## 1. Summary

Add one focused repo-contract skill, `.claude/skills/writing-analysis-scene/SKILL.md`, for authoring the Chapter 1 `analysis_scene_<K>.md` contract that already exists after HPA-259.

The compiler remains the source of truth for syntax, references, provenance interpretation, accepted-solution normalization, asset metadata, and reachability. The skill exists to teach writer intent and ownership, not to become a second schema specification.

The implementation stays deliberately small:

- one new Analysis authoring skill;
- one compiler-backed invalid unsupported-board fixture;
- narrow routing/story-state corrections in existing repo guidance; and
- no parser, runtime, frontend, save, layout-editor, or Chapter 2 work.

Canonical copyable examples remain compiler fixtures. No Markdown-fence test harness or generated-schema documentation layer is introduced.

## 2. Why this is actionable now

HPA-259 is merged and already provides the authored Analysis contract:

- `analysis_scene_<K>.md` manifest dispatch;
- source-located parsing;
- the closed `classify`, `order`, and `threshold` board kinds;
- evidence/statement-backed cards;
- positive story unlock expressions;
- story reveal validation;
- provenance-backed threshold validation;
- deterministic normalized accepted answers;
- qualified Analysis scene/board registration; and
- the full Chapter 1 Beat 8.5 compiler fixture under `packages/scripts/__fixtures__/analysis-chapter-1/`.

HPA-265 is the intended production consumer for the real Beat 8.5 scene. HPA-552 should land before or alongside that authoring pass so writers use the real contract instead of free-forming it.

HPA-260 is not required to document what Markdown the compiler accepts.

## 3. Current repository gaps

### 3.1 No dedicated Analysis authoring skill

`CLAUDE.md` treats `.claude/skills/*/SKILL.md` as the repo authoring contract, but Analysis is the only compiler-driven scene family without its own writing skill.

### 3.2 Chapter-manifest guidance is stale

`writing-chapter-manifest` still documents only `scene_*`, `investigation_scene_*`, and `interrogation_scene_*`, even though the compiler accepts `analysis_scene_<K>.md`.

### 3.3 Story-writing orchestration is stale

`subagent-driven-story-writing` does not yet map reasoning/workbench beats to `analysis_scene_<K>.md` or dispatch `writing-analysis-scene`.

### 3.4 Investigation/interrogation qualified-Analysis notes are stale

Both skills already show:

```text
analysis_scene:<chapter_id>@<scene_id> completed
analysis_board:<chapter_id>@<scene_id>@<board_id> completed
```

but still describe Analysis registration as synthetic-fixture-only. HPA-259 has already made qualified Analysis refs part of the production compiler contract.

The corrected guidance must preserve an important distinction:

- the compiler can resolve qualified Analysis references now;
- playable content may only depend on a completion that the runtime/content sequence can actually produce; and
- when the narrative dependency is the conclusion itself, prefer the durable Fact/Objective emitted by Analysis over coupling later prose to the workbench UI event.

Authorization remains separate: solving Analysis may prepare a request, but must not grant `narrow_lock_export`.

### 3.5 `reviewing-story-scenes` needs only a post-HPA-561 link, not a second rewrite

Current `main` still shows the old three-family review routing, but HPA-561 PR #44 already changes `reviewing-story-scenes` to:

- discover `analysis_scene_*.md`;
- include Analysis in `When to Use`;
- include Analysis files in Phase 1 scene discovery; and
- review Analysis Intro / Result Dialogue / Outro under the existing semantic axes.

Therefore HPA-552 must **not** reimplement those HPA-561 edits.

After rebasing onto post-#44 `main`, HPA-552 only needs the small link that #44 could not add before this skill existed:

- name `writing-analysis-scene` in the review skill's related/relevant format-skill guidance; and
- verify the HPA-561 Analysis discovery/axis coverage is still present.

If that baseline is unexpectedly absent after #44 lands, stop and reconcile ownership instead of copying the old review skill forward.

### 3.6 The Linear answer-key non-goal is over-broad after HPA-259

HPA-552 currently says “no answer-key data in any authored or shared surface.” Taken literally, that conflicts with HPA-259 because authors necessarily declare semantic solution intent:

- classify `Accepted Cards`;
- order `Accepted Order` and `Fixed Anchors`; and
- threshold sufficiency constraints.

The real invariant is:

> Authors declare semantic solution intent in Markdown. Compiler-normalized answer keys remain compiler/runtime-private and do not enter answer-key-free public/shared views. Writers never hand-edit generated JSON.

## 4. Goals

1. Give Chapter 1 writers one skill for `analysis_scene_<K>.md`.
2. Cover only `classify`, `order`, and `threshold`.
3. Teach author intent without cloning validator implementation details.
4. Keep cards as references to already-authored case records.
5. Explain threshold provenance/source-group/capability semantics at the level writers need.
6. Keep canonical valid and invalid examples compiler-backed.
7. Route authoring/orchestration/review guidance to the new skill without overwriting HPA-561.
8. Preserve the request-readiness vs institutional-authorization boundary.

## 5. Non-goals

- No Analysis runtime changes.
- No frontend workbench or persistence changes.
- No layout-editor preview/provenance inspector.
- No map authoring.
- No Chapter 2 `compare` / `route`.
- No Chapter 3+ `chain`.
- No freeform/plugin/template registry.
- No schema-to-doc generator.
- No compiler change merely to make the skill easier to write.
- No Analysis-local Evidence/Statement Manifest.
- No duplicate provenance model.
- No rich/progressive hint system.
- No Analysis self-grant of institutional authorization.
- No second semantic-review axis or review framework.

## 6. Selected approach: reference-first skill + compiler fixtures

The skill explains concepts, structure, workflow, and common mistakes, then points writers to compiler-exercised fixtures.

Canonical valid example:

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- companion source records: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md`
- companion story/source-group definitions: `packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md`

Canonical invalid example:

- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/`
- declares `Kind: route`;
- expected diagnostic: `analysisBoardInvalidKind`.

The invalid fixture should include one tiny valid `scene_0.md` before the invalid Analysis scene. That keeps the Chapter playable-scene count non-zero, so a manual compile reports the intended unsupported-kind failure without the incidental `chapterNoPlayableScenes` diagnostic.

This end-to-end invalid fixture is still useful even though `parser-analysis.test.ts` already unit-tests unsupported `Kind`: the HPA-552 fixture is the named writer-facing invalid example and proves manifest/orchestrator compile behavior.

### Rejected alternatives

**Full valid scene duplicated into `SKILL.md`:** rejected because it creates a drifting second copy.

**Extract-and-compile Markdown fences:** rejected because it adds a bespoke doc-test mechanism for one skill.

**Generate docs from parser metadata:** rejected as YAGNI.

## 7. Ownership model

### 7.1 Compiler owns syntax and semantic validity

Authoritative implementation surfaces remain:

- `packages/scripts/compile-scenes/parser-analysis.ts`
- `packages/scripts/compile-scenes/validator-analysis.ts`
- `packages/scripts/compile-scenes/parser-common.ts`
- `packages/scripts/compile-scenes/parser-assets.ts`
- `packages/scripts/compile-scenes/parser-unlock.ts`
- `packages/scripts/compile-scenes/story-catalog.ts`
- `packages/scripts/compile-scenes/case-record-provenance.ts`
- `packages/scripts/compile-scenes/reachability.ts`

If the skill disagrees with compiler behavior, correct the skill.

### 7.2 Investigation/interrogation own evidence and statements

Analysis cards reference already-declared:

```text
evidence:<id>
statement:<id>
```

Source-group identity, procedural status, proof capabilities, representation layer, completeness/confidence, and supersession remain metadata on the source record.

A threshold board reads that metadata through the referenced cards. Do not copy provenance onto the Analysis card or encode fake source identity in prose.

### 7.3 Analysis author owns semantic reasoning intent

The writer owns:

- scene title and Summary;
- Intro / Result Dialogue / Outro;
- board labels/prompts/feedback/static hint;
- board/card/group IDs;
- card source references;
- classify accepted-group intent;
- exact order intent;
- threshold sufficiency constraints;
- positive board prerequisites; and
- story outputs.

### 7.4 Generated/runtime output remains generated

Writers never hand-edit:

- generated scene JSON;
- generated `story_catalog.json`;
- normalized `acceptedGroupByCard`;
- normalized `acceptedSelections`;
- runtime draft/save state;
- public answer-key-free views; or
- asset filesystem paths.

## 8. New `writing-analysis-scene` contract

### 8.1 Required background

The skill delegates:

- player-facing Traditional Chinese dialogue, expressions, narration, and general scene prose to `writing-detective-game-dialogue`;
- provenance/source-group semantics to the existing investigation/interrogation record guidance.

It does not restate those manuals.

### 8.2 Structural shape

```text
H1  # Scene N: <title>
    - **Summary:** <player recap>
H2  ## Intro
H2  ## Board: <label> {#board_id}
H3      ### Card: <label> {#card_id}
H3      ### Group: <label> {#group_id}       # classify only
H3      ### Result Dialogue
H2  ## Outro
```

Writer-significant rules:

- exactly one Intro before all boards;
- one or more boards;
- exactly one Outro after all boards;
- every board has non-empty Result Dialogue;
- board IDs are scene-local;
- card/group IDs are board-local;
- cards reference existing case records; and
- board Reveals are story outputs, not local inventory acquisition.

### 8.3 Common board fields

Required:

- `Kind`
- `Prompt`
- `Reveals`
- `Incomplete Feedback`
- `Incorrect Feedback`

Optional:

- `Unlock`
- `Hint`

Closed-key parsing and diagnostics remain compiler-owned.

### 8.4 `classify`

Use when the player must decide which conclusion/package each record supports.

Each Group has:

- `Description`
- `Accepted Cards`

Every displayed card belongs to exactly one accepted group.

The writer edits `Accepted Cards`; the compiler derives the runtime `acceptedGroupByCard`.

### 8.5 `order`

Use when the player reconstructs one exact sequence.

Rules that should be explicit in the skill:

- `Accepted Order` is required and names every displayed card exactly once.
- `Fixed Anchors` is **required on every order board**.
- Use `Fixed Anchors: []` when no card is pinned.
- Non-empty entries use `<card_id>@<one-based-position>`.
- Anchor card IDs/positions must be unique, in range, and agree with `Accepted Order` at that position.

Do not invent sentinel values or omit `Fixed Anchors` when nothing is pinned.

### 8.6 `threshold`

Use when the player selects a procedurally sufficient combination of already-obtained records.

Author fields:

- `Eligible Cards`
- `Minimum Selected`
- `Minimum Distinct Source Groups`
- `Required Proof Capabilities`
- `Allowed Procedural Statuses`
- `Require Source Group`

Writer-facing semantics:

- independence counts distinct non-null source-group IDs;
- if `Require Source Group: true`, every selected record needs a source group;
- allowed procedural statuses apply per selected record;
- required proof capabilities are satisfied by the union across selected records; and
- the metadata comes from the source evidence/statement records.

Do not document the subset-materialization implementation or materialization budget as game-design rules.

### 8.7 Story progress and authority

Qualified Analysis predicates use the existing positive story-expression grammar and must be fully qualified.

Beat 8.5 may assert facts and complete:

```text
prepare_narrow_lock_request
```

It must not grant:

```text
narrow_lock_export
```

`grant_authorization:<id>` remains compiler-forbidden on Analysis boards.

### 8.8 Feedback

First-version guidance stays limited to:

- `Incomplete Feedback`;
- `Incorrect Feedback`;
- optional static `Hint`; and
- accepted `Result Dialogue`.

No progressive/contextual hint system is added.

### 8.9 Analysis asset contract

The review claim that Chapter 1 Analysis has “no authored asset fields” is not correct.

`parser-analysis.ts` routes Intro, Result Dialogue, and Outro through `consumeDialogueUntilHeading`. `parser-common.ts` allows a `[場景：…]` dialogue item to consume the current visual asset metadata, and `enrichAnalysisScene` walks all three Analysis dialogue carriers.

Therefore the skill should say exactly:

- Intro, Result Dialogue, and Outro may use `[場景：…]` followed immediately by the visual/audio metadata accepted by the current scene-tag asset contract.
- On the post-HPA-561 baseline this includes `Background Prompt`, `Background Asset ID`, `BGM`, and `BGS` where applicable.
- Analysis boards themselves do **not** have board-level background/audio metadata fields.
- Analysis has no Evidence/Statement Manifest, so it does not author evidence `Image Prompt` fields locally.
- Writers never author filesystem paths.

This matches the actual HPA-561 production Analysis scene, which already carries scene-tag background metadata in its Intro.

## 9. Canonical example strategy

### Valid

`packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md` remains the canonical three-board copyable example.

It exercises:

- classify/order/threshold;
- evidence and statement card sources;
- accepted classify groups;
- required Fixed Anchors;
- threshold independence/capabilities/procedural status;
- qualified board unlocks;
- facts/objective outputs;
- minimal feedback and hint.

### Invalid

Add `hpa_552_analysis_unsupported_board_kind` with:

1. a valid `scene_0.md` listed first;
2. an invalid `analysis_scene_1.md` with `Kind: route`; and
3. `expected-error.txt` = `analysisBoardInvalidKind`.

The existing invalid-fixture runner discovers it automatically. No new harness is added.

## 10. Repo-contract synchronization

There are six touched guidance surfaces after HPA-561, but only five are stale in the old-main sense.

### 10.1 `CLAUDE.md`

Add `analysis_scene_<K>.md` and route it to `writing-analysis-scene`.

### 10.2 `writing-chapter-manifest`

Add Analysis filename/type inference. No explicit type field.

### 10.3 `subagent-driven-story-writing`

Map reasoning/evidence-organization workbenches to `analysis_scene_<K>.md` and dispatch `writing-analysis-scene`.

Analysis briefs provide exact board/card/group IDs, source-record paths, prerequisites, story outputs, and authorization boundary. Do not copy the schema into the orchestration skill.

### 10.4 `writing-investigation-scene`

Replace only stale synthetic-only qualified-Analysis wording. Keep authorization rules intact.

### 10.5 `writing-interrogation-scene`

Apply the same focused story-state correction.

### 10.6 `reviewing-story-scenes`

Do **not** reapply #44's Analysis discovery/axis changes.

After rebasing onto post-#44 `main`:

- verify `analysis_scene_*.md` is already in description, When to Use, Phase 1 discovery, and relevant semantic axes;
- add `writing-analysis-scene` to the related/relevant format-skill list now that the skill exists; and
- leave the seven-axis model unchanged.

This is a small final link, not a second review-skill redesign.

## 11. HPA-561 sequencing

HPA-561 PR #44 edits overlapping writer/reviewer skills and already adds Analysis semantic-review support. HPA-552 implementation must start from or rebase onto post-#44 `main` before editing those files.

Do not copy old skill files over HPA-561 narration/catalog/background changes.

This is an integration sequencing rule, not a product dependency or reason to broaden HPA-552.

## 12. Validation

Run:

```bash
bun run test:scripts
bun run scenes:compile
bun run check:scripts
bun run format:check
```

Focused compiler tests may be run first, but the full `test:scripts` suite is the final authority.

No Rust/frontend/E2E/layout-editor checks are required unless implementation unexpectedly touches those layers.

## 13. Expected implementation diff

Create:

- `.claude/skills/writing-analysis-scene/SKILL.md`
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/chapter.md`
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/scene_0.md`
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/analysis_scene_1.md`
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/expected-error.txt`

Modify narrowly:

- `CLAUDE.md`
- `.claude/skills/writing-chapter-manifest/SKILL.md`
- `.claude/skills/subagent-driven-story-writing/SKILL.md`
- `.claude/skills/writing-investigation-scene/SKILL.md`
- `.claude/skills/writing-interrogation-scene/SKILL.md`
- `.claude/skills/reviewing-story-scenes/SKILL.md`

No compiler/runtime production source file should need to change.

## 14. Review resolution

Accepted:

- make `Fixed Anchors` exact: required, `[]` when none, one-based entries consistent with accepted order;
- keep the end-to-end invalid fixture but add a valid linear scene to suppress incidental `chapterNoPlayableScenes` noise;
- retain the unsupported-kind fixture despite existing unit coverage because it is the canonical writer-facing invalid example.

Accepted with adjustment:

- treat `reviewing-story-scenes` as a sixth touched guidance surface only for the final `writing-analysis-scene` link; HPA-561 #44 already owns and implements Analysis discovery/axis coverage.

Rejected after code verification:

- “Analysis has no authored asset fields.” The shared dialogue parser accepts scene-tag visual/audio metadata in Analysis Intro / Result Dialogue / Outro, and HPA-561's production Analysis scene already uses it. HPA-552 should document the supported scene-tag asset boundary, not prohibit it.

Everything else in the original design remains unchanged: compiler authority, Chapter 1-only board families, reference-first examples, case-record ownership, normalized-answer boundary, authority separation, and minimal verification surface.

## 15. Final decision

Implement HPA-552 as a small reference-first authoring contract on top of HPA-259 and the post-HPA-561 skill baseline.

The compiler already knows how Analysis works. HPA-552 only needs to make that contract reliable for writers, orchestration, and semantic review without inventing another architecture layer.