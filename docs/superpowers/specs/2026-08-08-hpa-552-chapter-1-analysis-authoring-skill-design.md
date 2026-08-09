# HPA-552 Chapter 1 Analysis Scene Authoring Skill Design

**Status:** Proposed  
**Linear:** HPA-552 — Add the analysis-scene authoring skill for Chapter 1 writers  
**Scope:** Authoring contract and repo guidance only; no runtime, layout-editor, or Chapter 2 template work

## 1. Summary

Add one focused repo-contract skill, `.claude/skills/writing-analysis-scene/SKILL.md`, for authoring the Chapter 1 `analysis_scene_<K>.md` format that already exists after HPA-259.

The skill must not become a second schema specification. The compiler remains the source of truth for syntax, references, provenance interpretation, hidden-answer normalization, and reachability. The skill should instead tell a writer:

1. which existing contracts to read;
2. how to shape a Chapter 1 analysis scene around `classify`, `order`, and `threshold` boards;
3. where cards get their semantics from;
4. which stable IDs the writer owns;
5. which outputs are legal;
6. which files are generated and therefore never hand-edited; and
7. which compiler-backed fixtures are the canonical valid and invalid examples.

This is deliberately a small documentation/fixture change. It introduces no new parser abstraction, no generated documentation system, no new runtime type, and no speculative template family.

## 2. Why this is actionable now

HPA-259 is merged and is the authoritative compiler contract for Analysis scenes. It already provides:

- `analysis_scene_<K>.md` manifest dispatch;
- source-located Analysis parsing;
- the three closed Chapter 1 board kinds: `classify`, `order`, and `threshold`;
- evidence/statement-backed cards;
- story-only positive unlock expressions;
- story reveal validation;
- compiler-owned provenance interpretation;
- deterministic hidden-answer normalization;
- qualified Analysis scene/board registration in `story_catalog.json`; and
- the complete Chapter 1 Beat 8.5 compiler fixture at `packages/scripts/__fixtures__/analysis-chapter-1/`.

HPA-265 is the first real production consumer. It needs a repo-contract skill before or alongside the Beat 8.5 authoring pass so the real scene is governed by the compiler contract rather than documenting whatever free-form content happened to be written first.

HPA-260 runtime work is not a prerequisite for documenting the authored contract. The skill describes what the compiler accepts, not how Rust stores a mutable workbench draft.

## 3. Current repository gaps

### 3.1 No dedicated Analysis authoring skill

`CLAUDE.md` says active writer instructions under `.claude/skills/*/SKILL.md` are part of the repo contract and scene content must use the relevant skill. Today the repository lists dedicated guidance for:

- linear dialogue;
- investigation scenes;
- interrogation scenes; and
- chapter manifests.

Analysis is now a fourth compiler-driven scene type but is not represented in that authoring map.

### 3.2 Chapter-manifest guidance is stale

`.claude/skills/writing-chapter-manifest/SKILL.md` currently documents only:

- `scene_<K>.md`;
- `investigation_scene_<K>.md`; and
- `interrogation_scene_<K>.md`.

The compiler already accepts `analysis_scene_<K>.md`, so the skill can incorrectly tell a writer that a valid Analysis scene prefix is unknown.

### 3.3 Story-writing orchestration is stale

`.claude/skills/subagent-driven-story-writing/SKILL.md` currently maps beat types to only the three older scene families and does not dispatch `writing-analysis-scene` for `analysis_scene_<K>.md`.

That creates exactly the free-forming risk HPA-552 exists to remove.

### 3.4 Investigation/interrogation Analysis-reference notes are stale

Both existing interactive-scene skills already list qualified Analysis predicates such as:

```text
analysis_scene:<chapter_id>@<scene_id> completed
analysis_board:<chapter_id>@<scene_id>@<board_id> completed
```

but still describe Analysis registration as a synthetic-fixture-only future contract. HPA-259 has already made qualified Analysis registration a production compiler contract.

The replacement wording must stay precise:

- the compiler can validate qualified Analysis refs now;
- authors still need a runtime/content path that can actually produce the referenced completion before using that predicate in playable flow;
- HPA-260 owns that mutable runtime completion behavior; and
- durable facts/objectives remain preferable when the story semantics are about a conclusion rather than merely “this UI board was completed.”

The separate authorization restriction is still valid: HPA-552 must not make Analysis boards self-grant `narrow_lock_export`, and it must not silently weaken the HPA-264 hearing-authority boundary.

### 3.5 One Linear non-goal is stale after HPA-259

HPA-552 currently says “no answer-key data in any authored or shared surface.” Taken literally, that conflicts with the merged HPA-259 Markdown contract, where authors necessarily declare solution intent through fields such as:

- `Accepted Cards` on classify groups;
- `Accepted Order` and `Fixed Anchors` on order boards; and
- threshold constraints that the compiler materializes into accepted selections.

The invariant that still makes sense and matches the code is:

> Authors declare semantic solution intent in Markdown; compiler-normalized answer keys remain compiler/runtime-private and never appear in public/shared answer-key-free views. Writers never hand-edit generated JSON.

HPA-552 should document this boundary rather than inventing a second format that hides required authored solution intent.

## 4. Goals

1. Give Chapter 1 writers a single skill for `analysis_scene_<K>.md`.
2. Cover only the three board families HPA-259 actually implements for Chapter 1.
3. Teach board intent and ownership without duplicating validator rules line-for-line.
4. Make cards reference already-authored evidence/statements rather than inventing Analysis-local case records.
5. Explain source groups, procedural status, and proof capabilities at the authoring-concept level because threshold acceptance depends on them.
6. Make the valid and invalid examples compiler-backed fixtures instead of copied prose that can drift.
7. Remove stale repo guidance that would cause writers/orchestrators to skip the Analysis skill or reject valid Analysis filenames.
8. Preserve HPA-264's separation between “request readiness” and “institutional authorization.”

## 5. Non-goals

- No Analysis runtime changes.
- No frontend workbench or save/persistence work.
- No layout-editor preview or provenance inspector.
- No map authoring.
- No Chapter 2 `compare` or `route` boards.
- No Chapter 3+ `chain` board.
- No freeform board/plugin/template registry.
- No generated-schema-to-skill documentation pipeline.
- No compiler behavior change merely to make documentation easier.
- No Analysis-local Evidence/Statement Manifest.
- No new provenance model; reuse the existing case-record provenance contract.
- No rich/progressive hint system; the first version only documents the existing optional static `Hint`.
- No self-grant of Chapter 1 institutional authorization from an Analysis board.

## 6. Approaches considered

### Approach A — Reference-first skill with compiler fixtures — selected

The skill explains concepts, structure, workflow, and common mistakes, then names the compiler-backed fixture files as its canonical examples.

Canonical valid example:

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- companion source records: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md`
- companion story definitions/source groups: `packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md`

Canonical invalid example:

- a new focused invalid fixture under `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/` showing that an unbuilt `route` board fails with `analysisBoardInvalidKind`.

**Why select it:**

- minimal duplication;
- the examples cannot silently diverge from what the compiler actually accepts;
- writers can copy a complete real three-board shape when needed;
- the invalid example teaches the most important HPA-552 scope boundary; and
- the existing fixture runner already exercises every invalid fixture with `expected-error.txt`.

### Approach B — Embed full valid/invalid scenes inside `SKILL.md`

This is more self-contained for the writer, but creates a second copy of the exact same Markdown contract. Keeping embedded examples synchronized would require either discipline or a bespoke test that extracts Markdown fences and recompiles them.

**Rejected:** more duplication and test machinery for no product value.

### Approach C — Generate the skill/schema reference from parser metadata

This could theoretically eliminate documentation drift, but would require a schema description model or parser metadata layer that does not exist today.

**Rejected:** classic YAGNI. The repo has three Chapter 1 board kinds and one current writer consumer, not a documentation-generation platform problem.

## 7. Ownership model

### 7.1 Compiler owns syntax and semantic validity

The implementation must continue to treat these files as authoritative code contracts:

- `packages/scripts/compile-scenes/parser-analysis.ts`
- `packages/scripts/compile-scenes/validator-analysis.ts`
- `packages/scripts/compile-scenes/parser-unlock.ts`
- `packages/scripts/compile-scenes/story-catalog.ts`
- `packages/scripts/compile-scenes/case-record-provenance.ts`
- `packages/scripts/compile-scenes/reachability.ts`

The new skill may summarize the contract, but when a detail conflicts, the compiler wins and the skill must be corrected.

### 7.2 Investigation/interrogation author the case records

Analysis cards do not define evidence or statements. Each `Card` points to an already-declared:

```text
evidence:<id>
statement:<id>
```

The record's immutable provenance metadata lives with that source record, not on the Analysis card.

The canonical provenance concepts remain owned by `writing-investigation-scene` / `writing-interrogation-scene` and the compiler:

- source group identity;
- procedural status;
- proof capabilities;
- representation layer;
- completeness/confidence; and
- supersession.

The Analysis skill should explain only what an Analysis writer needs to know:

> A threshold board evaluates the metadata of the records referenced by its cards. If independence or capabilities matter, fix/author the source record metadata at the record owner; never copy provenance onto the card or encode it in prose and expect the compiler to infer it.

### 7.3 Analysis author owns semantic reasoning intent

The Analysis writer owns:

- scene title and player recap;
- Intro/Result Dialogue/Outro dialogue;
- board labels, prompts, feedback, and optional hint;
- scene-local board/card/group IDs;
- which existing evidence/statements become cards;
- classify group intent via `Accepted Cards`;
- exact order intent via `Accepted Order` / `Fixed Anchors`;
- threshold selection constraints;
- positive board prerequisites; and
- story reveal outputs.

### 7.4 Generated/runtime output stays generated

Writers never author or edit:

- `apps/game/src-tauri/resources/scenes/*.json`;
- generated `story_catalog.json`;
- normalized `acceptedGroupByCard`;
- normalized `acceptedSelections`;
- runtime save state;
- public workbench views; or
- filesystem asset paths.

Run `bun run scenes:compile` to regenerate compiler-owned resources.

## 8. New skill contract

### 8.1 Frontmatter and dispatch

Create:

` .claude/skills/writing-analysis-scene/SKILL.md`

with a narrow trigger description for `analysis_scene_<K>.md` under the playable story roots.

Required background:

1. `writing-detective-game-dialogue` for Traditional Chinese dialogue, `**角色名**：`, `[場景：...]`, expression/narration, and scene prose conventions.
2. `writing-investigation-scene` only for the canonical case-record provenance/source-group semantics when a card references an evidence/statement record.

Do not restate those skills' full dialogue/provenance manuals.

### 8.2 Structural shape

The skill should summarize the current HPA-259 hierarchy rather than carry a second full fixture:

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

Rules to surface because they change how writers work:

- exactly one Intro and Outro;
- one or more mandatory boards;
- card/group IDs are board-local; board IDs are scene-local;
- cards only reference evidence/statements;
- every board has Result Dialogue;
- later boards may use fully qualified positive Analysis completion predicates;
- all board `Reveals` are story outputs, not local evidence acquisition; and
- `grant_authorization` is forbidden on Analysis boards.

### 8.3 Common board fields

The skill should list, without re-implementing validator prose:

- `Kind`
- `Prompt`
- optional `Unlock`
- `Reveals`
- `Incomplete Feedback`
- `Incorrect Feedback`
- optional `Hint`

The compiler owns closed-key validation and diagnostics.

### 8.4 `classify`

Authoring question:

> Which conclusion/package does each displayed record actually support?

Author intent:

- define one or more `Group` blocks;
- each group has `Description` and `Accepted Cards`;
- every displayed card must belong to exactly one accepted group.

Do not explain or expose compiler-normalized `acceptedGroupByCard` as something the writer edits.

### 8.5 `order`

Authoring question:

> What exact sequence should the player reconstruct?

Author intent:

- `Accepted Order` names every displayed card exactly once;
- `Fixed Anchors` uses `<card_id>@<one-based-position>` when the presentation needs a pre-pinned anchor.

Do not create optional/missing-card semantics in the skill; they do not exist in Chapter 1.

### 8.6 `threshold`

Authoring question:

> Which combinations of already-obtained records are procedurally sufficient to support a conclusion/request?

Author fields:

- `Eligible Cards`
- `Minimum Selected`
- `Minimum Distinct Source Groups`
- `Required Proof Capabilities`
- `Allowed Procedural Statuses`
- `Require Source Group`

The skill must explain the cross-record semantics that a writer needs:

- source-group independence counts distinct non-null source-group IDs;
- when `Require Source Group: true`, every selected record needs a source group;
- procedural-status restrictions are per selected record;
- proof-capability requirements are satisfied by the union of selected records' capabilities; and
- a card's record metadata is read from the original evidence/statement definition.

Do not copy the subset-materialization algorithm or the current `MAX_THRESHOLD_ELIGIBLE_CARDS` implementation detail into the skill as a design recommendation. If the author exceeds the compiler's current budget, the compiler diagnostic is the authority.

### 8.7 Story progress

The skill should point to the existing positive story expression grammar rather than clone it.

For Chapter 1, examples of intended semantics are:

- board 2 unlocks after board 1 completion;
- board 3 unlocks after board 2 completion;
- solved boards assert facts and finally complete `prepare_narrow_lock_request`.

The key boundary is:

> Beat 8.5 prepares a justified request. It does not grant `narrow_lock_export`.

An Analysis `Reveals` list may use supported story reveal targets such as facts/objectives, but `grant_authorization:<id>` is compiler-forbidden for Analysis boards.

### 8.8 Feedback

First-version skill guidance is intentionally small:

- `Incomplete Feedback`: structurally unfinished submission;
- `Incorrect Feedback`: complete but not accepted submission;
- optional `Hint`: static author copy;
- `Result Dialogue`: accepted-board payoff.

Do not document contextual failure taxonomies or progressive hint state from HPA-263.

## 9. Canonical example strategy

### 9.1 Valid example

The skill names the existing complete fixture as the canonical valid example:

`packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`

That one file already exercises:

- Intro/Outro;
- classify;
- order;
- threshold;
- cards backed by evidence and statement records;
- classify accepted groups;
- fixed order/anchor;
- source-group independence;
- capability coverage;
- procedural-status filtering;
- qualified board unlocks;
- facts/objective outputs;
- minimal feedback; and
- optional hint.

Its companion source records and catalog make the semantics inspectable instead of hiding them in a synthetic one-file example.

### 9.2 Invalid example

Add:

`packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/`

with a minimal manifest-owned `analysis_scene_1.md` that declares:

```text
Kind: route
```

and `expected-error.txt` containing:

```text
analysisBoardInvalidKind
```

The repository's existing invalid-fixture loop automatically compiles every directory under `packages/scripts/__fixtures__/invalid/` and asserts the expected error. No new fixture harness is needed.

### 9.3 No duplicated full example in the skill

The skill may contain small syntax forms or hierarchy diagrams, but must clearly designate only the fixture files as canonical copyable examples. Do not paste a second full Beat 8.5 scene into the skill.

This satisfies the acceptance criterion that authoring examples are exercised by the compiler without building a Markdown-fence extraction framework.

## 10. Repo-contract synchronization

### 10.1 `CLAUDE.md`

Add `analysis_scene_<K>.md` to the playable scene-family list and point it at `writing-analysis-scene`.

No architecture rewrite is needed.

### 10.2 `writing-chapter-manifest`

Add:

```text
analysis_scene_<K>.md | Analysis workbench scene | writing-analysis-scene
```

and remove wording that implies only the older three prefixes are valid.

### 10.3 `subagent-driven-story-writing`

Extend beat-to-file mapping and related-skill list:

- reasoning/analysis workbench -> `analysis_scene_<K>.md`;
- first action for that writer -> `writing-analysis-scene`;
- orchestrator still owns IDs/cross-file prerequisites.

For Analysis briefs, the orchestrator must provide:

- exact card source IDs;
- source-record owner paths;
- expected board IDs/kinds;
- story outputs/prerequisites; and
- explicit authorization boundary when relevant.

Do not copy the entire Analysis schema into the orchestration skill.

### 10.4 Investigation/interrogation story-state notes

Replace only the stale HPA-259 “synthetic-only registration” warning.

New guidance:

- qualified Analysis predicates are part of the production compiler contract;
- they must resolve to a manifest-owned Analysis scene/board;
- author only predicates that the target runtime/content sequence can actually satisfy;
- HPA-260 owns mutable Analysis completion production; and
- prefer fact/objective predicates when the narrative dependency is on a conclusion rather than the UI board itself.

Keep current authority-event restrictions intact.

## 11. Interaction with HPA-561 / PR #44

HPA-561 is currently modifying several of the same existing skill files, including:

- `writing-investigation-scene`;
- `writing-interrogation-scene`;
- `subagent-driven-story-writing`; and
- the base dialogue/review skills.

HPA-561 explicitly leaves ownership of the dedicated Analysis authoring skill to HPA-552.

To avoid competing edits:

1. this HPA-552 planning PR stays documentation-only;
2. before implementation, start from the newest `main` after PR #44 lands, or rebase once immediately before editing the overlapping skills;
3. do not overwrite HPA-561's narration/catalog/background guidance; and
4. keep HPA-552 edits to overlapping skills narrowly focused on Analysis dispatch/story-state wording.

This is an integration sequencing concern, not a reason to expand HPA-552 or make HPA-561 a hard product dependency.

## 12. Validation strategy

Implementation validation should be limited to the surfaces this ticket changes.

### Compiler-backed example checks

- existing `analysis-chapter-1` fixture remains green;
- new unsupported-board-kind invalid fixture is discovered automatically and returns `analysisBoardInvalidKind`.

### Repo checks

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
bun run scenes:compile
bun run check:scripts
bun run format:check
```

If the selected Vitest CLI filtering syntax differs in the execution environment, running `bun run test:scripts` in full is the authoritative fallback.

No Rust, frontend, E2E, or layout-editor checks are required solely for these documentation/fixture changes unless the implementation unexpectedly touches those layers.

## 13. Acceptance mapping

| HPA-552 acceptance criterion | Design response |
|---|---|
| Every authoring example is compiler exercised, including invalid | Canonical examples are compiler fixtures; existing valid Chapter 1 fixture + new invalid unsupported-kind fixture |
| Writer can author valid Analysis without editing generated JSON | Skill documents authored/generated ownership and compile workflow |
| Only three Chapter 1 board families | Closed `classify` / `order` / `threshold`; invalid `route` fixture makes the boundary executable |
| Reference canonical schema/generated rules rather than duplicate | Skill points to parser/validator/provenance ownership and tested fixture; no copied full schema implementation |
| `scenes:compile` and `check:scripts` pass | Explicit verification commands |
| HPA-265 real scene conforms or skill is corrected | HPA-265 is the production consumer; no speculative Chapter 2 abstractions |

## 14. Expected implementation diff

Create:

- `.claude/skills/writing-analysis-scene/SKILL.md`
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/chapter.md`
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/analysis_scene_1.md`
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/expected-error.txt`

Modify narrowly:

- `CLAUDE.md`
- `.claude/skills/writing-chapter-manifest/SKILL.md`
- `.claude/skills/subagent-driven-story-writing/SKILL.md`
- `.claude/skills/writing-investigation-scene/SKILL.md`
- `.claude/skills/writing-interrogation-scene/SKILL.md`

No compiler/runtime production source file should need to change.

## 15. Final decision

Implement HPA-552 as a **small reference-first authoring contract** on top of HPA-259.

The compiler already knows how Analysis works. The missing product is a reliable way for writers and writing agents to use that contract without free-forming it. The cheapest maintainable solution is therefore not another abstraction layer; it is one focused skill, compiler-backed examples, and a handful of stale repo guidance corrections.