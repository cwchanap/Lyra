# HPA-552 Chapter 1 Analysis Authoring Guidance Design

**Status:** Proposed  
**Linear:** HPA-552 — Upgrade the analysis-scene authoring skill for Chapter 1 writers  
**Scope:** Documentation contract correction only

## 1. Summary

HPA-552 no longer creates an Analysis authoring skill. Current `main` already has `.claude/skills/writing-analysis-scene/SKILL.md` from HPA-561, but that skill still describes the old threshold-only playable surface.

HPA-260 and HPA-261 have since shipped the runtime and workbench for all three Chapter 1 board kinds:

- `classify`;
- `order`;
- `threshold`.

HPA-552 therefore does one small thing: **make the existing writer guidance match the shipped Analysis stack**.

The compiler remains the source of truth. This ticket changes no parser, validator, Rust runtime, Svelte UI, save format, production story content, or layout editor.

## 2. Current drift

The dedicated Analysis skill and several companion docs still say or imply that only threshold boards are shippable. That is stale after HPA-260/HPA-261.

The correction must also include HPA-261's current Order invariant:

> `Fixed Anchors` is required. `[]` means no anchors. A non-empty anchor list must form a contiguous one-based prefix and agree with `Accepted Order`.

The existing compiler diagnostic is `analysisOrderAnchorNotPrefix`.

## 3. Design principles

### 3.1 One owner enumerates board kinds

Only `writing-analysis-scene` should enumerate and explain the supported Analysis board kinds.

Companion guidance should delegate to that skill instead of copying `classify / order / threshold`. This prevents the same six-file drift when a later ticket deliberately adds another board family.

Examples:

- `CLAUDE.md`: route `analysis_scene_<K>.md` to `writing-analysis-scene`; do not restate its board-kind list.
- `writing-chapter-manifest`: identify Analysis as a compiler-validated scene family and delegate its board contract to `writing-analysis-scene`.
- `subagent-driven-story-writing`: require the Analysis writer to invoke `writing-analysis-scene`; pass IDs, sources, unlocks, and outputs, while the dedicated skill owns kind-specific fields.
- investigation/interrogation guidance: say qualified Analysis predicates may target any packaged board supported by the current Analysis authoring/runtime contract; do not name the list again.

### 3.2 Compiler remains authoritative

The skill explains author intent and ownership. It does not duplicate every parser diagnostic.

Authoritative implementation sources remain:

- `packages/scripts/compile-scenes/parser-analysis.ts`;
- `packages/scripts/compile-scenes/validator-analysis.ts`;
- current compiler fixtures.

When prose and compiler disagree, fix the prose.

### 3.3 Reference-first examples

Do not copy full canonical scenes into the skill.

Reuse:

- valid three-board case-analysis fixture: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`;
- invalid Order anchor-prefix fixture: `packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/`;
- P1 production tutorial: `docs/stories_plan/chapter_1/analysis_scene_p1_5.md`.

No HPA-552 `Kind: route` fixture is needed.

## 4. Dedicated skill contract

### 4.1 Shared Analysis structure

The skill documents:

- one Intro;
- one or more Boards;
- Cards;
- kind-specific blocks/metadata;
- one Result Dialogue per Board;
- one Outro;
- optional positive `Unlock`;
- story-only `Reveals`;
- supported scene-tag asset cues on dialogue carriers.

Analysis still defines no local Evidence/Statement Manifest.

### 4.2 Classify

Writers author:

- Groups;
- each Group's `Description`;
- each Group's `Accepted Cards`.

Every displayed card belongs to exactly one accepted group.

The writer does **not** author compiler-normalized `acceptedGroupByCard`.

### 4.3 Order

Writers author:

- `Accepted Order` containing every displayed card exactly once;
- required `Fixed Anchors`.

Valid examples:

```text
[]
[event_1841@1]
[event_1841@1, event_1842@2]
```

Invalid:

```text
[event_1843@3]
```

Non-empty anchors must be unique, in range, agree with `Accepted Order`, and occupy positions `1..N` with no gap.

### 4.4 Threshold

Preserve the existing source-owned provenance model:

- `Eligible Cards`;
- `Minimum Selected`;
- `Minimum Distinct Source Groups`;
- `Required Proof Capabilities`;
- `Allowed Procedural Statuses`;
- `Require Source Group`.

The referenced evidence/statement owns provenance; the Analysis card does not duplicate it.

Preserve the HPA-561 tutorial exceptions:

- tutorial-only `practice:<id>` cards;
- practice immediate-binding/no-mixing rules;
- optional threshold `### Incorrect Selection` exact wrong-subset feedback.

Do not generalize practice cards into real Case File reasoning.

### 4.5 Story outputs and authorization

Qualified predicates remain:

```text
analysis_scene:<chapter_id>@<scene_id> completed
analysis_board:<chapter_id>@<scene_id>@<board_id> completed
```

Any packaged board supported by the current Analysis authoring/runtime contract may produce completion.

Prefer Facts/Objectives when later story logic depends on the earned conclusion rather than UI completion.

Beat 8.5 may complete:

```text
prepare_narrow_lock_request
```

It must not grant:

```text
narrow_lock_export
```

`grant_authorization:<id>` remains forbidden on Analysis boards. HPA-264 owns the hearing-granted authority transition.

### 4.6 Asset boundary

Intro, Result Dialogue, and Outro are dialogue carriers and may use the shared `[場景：...]` asset metadata contract when assets are enabled.

Board/Card/Group/Incorrect Selection metadata does not own a background cue.

Writers never author filesystem paths.

## 5. File scope

Modify exactly:

1. `.claude/skills/writing-analysis-scene/SKILL.md`
2. `CLAUDE.md`
3. `.claude/skills/writing-chapter-manifest/SKILL.md`
4. `.claude/skills/subagent-driven-story-writing/SKILL.md`
5. `.claude/skills/writing-investigation-scene/SKILL.md`
6. `.claude/skills/writing-interrogation-scene/SKILL.md`

Do not modify `reviewing-story-scenes`; HPA-561 already made it Analysis-aware.

Do not modify compiler fixtures or production story content.

## 6. Verification strategy

### 6.1 Do not use negative prose regexes

A regex such as `threshold[- ]only` is unsafe:

- correct prose legitimately contains phrases such as "Incorrect Selection — threshold only";
- stale prose such as "threshold-board only" can evade the pattern.

Review prose semantically instead.

### 6.2 Do not claim ignored Prettier gates

The repository `.prettierignore` ignores both `.claude` and `docs`, so HPA-552 does not use Prettier/`format:check` as evidence for these deliverables.

### 6.3 Dogfood the skill

The meaningful authoring check is a temporary compile exercise:

1. copy the surrounding `analysis-chapter-1` fixture corpus to a temporary root;
2. remove its canonical `analysis_scene_8_5.md`;
3. have a fresh verifier author a replacement three-board scene using the **updated skill as the format guide**, while reading only the copied source-record/catalog inputs needed for IDs;
4. compile the temporary corpus through the exported `compile()` seam;
5. change a valid Order `Fixed Anchors: []` to a sparse third-position anchor and confirm `analysisOrderAnchorNotPrefix`.

Nothing from this dogfood fixture is committed.

`bun run scenes:compile` remains one cheap production smoke, not proof that the docs are correct.

### 6.4 Final prose review

Read the six changed files once as prose and verify:

- only `writing-analysis-scene` owns the board-kind enumeration;
- the dedicated skill covers all three current board kinds;
- no companion file claims threshold-only runtime support;
- companion files delegate board-kind details to `writing-analysis-scene`;
- investigation/interrogation no longer reject valid Classify/Order completion refs;
- `reviewing-story-scenes` stayed untouched.

## 7. Non-goals

- No new Analysis skill.
- No new compiler fixture.
- No parser/validator behavior change.
- No Rust/Svelte/save work.
- No production Beat 8.5 authoring.
- No Chapter 2/later board family.
- No graph/template/plugin registry.
- No schema-to-doc generator.
- No docs-lint framework.
- No Prettier override solely for ignored skills/docs.

## 8. Acceptance

HPA-552 is complete when:

- `writing-analysis-scene` accurately documents the current Classify, Order, and Threshold authoring contracts;
- the Order prefix-anchor rule is explicit;
- existing Threshold/practice/Incorrect Selection/asset guidance remains intact;
- the five companion files delegate board-kind authority to `writing-analysis-scene` and contain no stale threshold-only capability claim;
- a fresh temporary three-board scene authored from the skill compiles;
- changing its Order anchors to a sparse position produces `analysisOrderAnchorNotPrefix`;
- `bun run scenes:compile` still passes;
- the implementation diff contains only the six intended guidance files; and
- Analysis still cannot grant `narrow_lock_export`.

## 9. Handoff

- HPA-262 owns integrated real three-board packaged acceptance.
- HPA-265 owns the real Chapter 1 Beat 8.5 authored scene and iteration.
- HPA-264 owns hearing-granted `narrow_lock_export`.
- HPA-263 remains optional post-playtest feedback/hint polish.
