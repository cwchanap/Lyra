# HPA-552 Chapter 1 Analysis Scene Authoring Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compiler-aligned `writing-analysis-scene` repo skill for Chapter 1 writers, wire the fourth scene type into existing authoring guidance, and keep every canonical example compiler-backed.

**Architecture:** The compiler remains the schema and semantic authority. The new skill is reference-first: it teaches writer intent and points to the existing three-board Chapter 1 fixture rather than cloning the schema or generated answers. Existing repo guidance receives only narrow Analysis dispatch/story-state corrections, and one invalid fixture makes the `classify | order | threshold` scope boundary executable.

**Tech Stack:** Markdown repo skills, TypeScript scene compiler fixtures, Vitest fixture runner, Bun 1.3.1.

## Global Constraints

- Implement only Chapter 1 `classify`, `order`, and `threshold` authoring.
- Do not add `compare`, `route`, `chain`, freeform boards, plugin registries, or template abstractions.
- Do not change runtime, frontend, save/persistence, or layout-editor code.
- Do not hand-edit generated scene JSON or `story_catalog.json`.
- Do not create an Analysis-local evidence/statement manifest; cards reference existing case records.
- Keep compiler-normalized answer keys out of public/shared answer-key-free surfaces; authors still declare the semantic solution fields required by merged HPA-259.
- Analysis boards may prepare Chapter 1 request readiness but must not `grant_authorization:narrow_lock_export`.
- Reuse `writing-detective-game-dialogue` for dialogue rules and `writing-investigation-scene` / `writing-interrogation-scene` for case-record provenance ownership; do not duplicate those manuals.
- Canonical copyable examples live in compiler fixtures, not duplicated full Markdown scenes inside the skill.
- Before editing overlapping writer skills, use a `main` baseline containing HPA-561 PR #44's skill hardening. If #44 has not merged when implementation starts, do not author against the old overlapping files and then overwrite #44; rebase once #44 lands before performing Tasks 2–3.
- Breaking pre-release authoring changes need no compatibility layer.

---

## File Map

### Create

- `.claude/skills/writing-analysis-scene/SKILL.md` — dedicated Chapter 1 Analysis authoring guidance.
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/chapter.md` — manifest for the canonical invalid example.
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/analysis_scene_1.md` — intentionally unsupported `route` board.
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/expected-error.txt` — expected `analysisBoardInvalidKind` diagnostic.

### Modify

- `CLAUDE.md` — register `analysis_scene_<K>.md` and `writing-analysis-scene` in the repo authoring map.
- `.claude/skills/writing-chapter-manifest/SKILL.md` — add Analysis filename/type inference.
- `.claude/skills/subagent-driven-story-writing/SKILL.md` — dispatch Analysis scene files to the new skill and include Analysis-specific brief inputs.
- `.claude/skills/writing-investigation-scene/SKILL.md` — remove stale “Analysis refs are synthetic-only” wording without broadening authorization rules.
- `.claude/skills/writing-interrogation-scene/SKILL.md` — same focused story-state correction.

### Reuse unchanged

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md` — canonical valid example covering all three board families.
- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md` — canonical card-source/provenance example.
- `packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md` — canonical facts/objective/source-group definitions.
- `packages/scripts/compile-scenes/parser-analysis.ts` — syntax authority.
- `packages/scripts/compile-scenes/validator-analysis.ts` — semantic/normalization authority.
- `packages/scripts/compile-scenes.test.ts` — already compiles the valid Chapter 1 fixture and automatically discovers invalid fixtures.

---

### Task 1: Add the dedicated reference-first Analysis authoring skill

**Files:**
- Create: `.claude/skills/writing-analysis-scene/SKILL.md`
- Reference unchanged: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- Reference unchanged: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md`
- Reference unchanged: `packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md`

**Interfaces:**
- Consumes: HPA-259 parser/validator contract and existing dialogue/provenance skills.
- Produces: repo-contract instructions for any agent authoring `analysis_scene_<K>.md` in Chapter 1.

- [ ] **Step 1: Confirm the execution baseline contains HPA-561's current skill hardening**

Run:

```bash
git fetch origin
git log -1 --oneline origin/main
git diff --name-only origin/main...HEAD -- .claude/skills
```

Then inspect the current versions of:

```bash
sed -n '1,220p' .claude/skills/writing-investigation-scene/SKILL.md
sed -n '1,220p' .claude/skills/writing-interrogation-scene/SKILL.md
sed -n '1,220p' .claude/skills/subagent-driven-story-writing/SKILL.md
```

Expected: the branch includes HPA-561's latest narration/catalog/background guidance before Tasks 2–3 edit overlapping files. Do not copy an older whole skill over a newer one.

- [ ] **Step 2: Create the new skill with the exact first-version ownership contract**

Create `.claude/skills/writing-analysis-scene/SKILL.md` with this content:

````markdown
---
name: writing-analysis-scene
description: Use when writing or extending an analysis_scene_<K>.md file under a playable chapter root for the Chapter 1 Analysis workbench. Covers only the compiler-supported classify, order, and threshold boards; cards reference already-authored evidence/statements and boards produce story progress.
---

# Writing Analysis Scenes (《東京雨證：第零證人》)

## Role

You author compiler-validated `analysis_scene_<K>.md` files. An Analysis scene
lets the player reorganize **already obtained** case records into explicit
reasoning steps. It does not acquire new evidence, replace an investigation,
or grant institutional authority.

The compiler is the syntax and semantic authority. This skill explains author
intent and workflow; it deliberately does not copy every parser diagnostic or
runtime wire field.

## Required background

Read `writing-detective-game-dialogue` first. It owns Traditional Chinese
player-facing dialogue, `**角色名**：`, `[場景：...]`, narration/expression, and
asset-prompt conventions.

When a card depends on case-record provenance, read the canonical provenance
section in `writing-investigation-scene` (and the matching interrogation
section for records declared there). Source groups, procedural status, proof
capabilities, completeness/confidence, and supersession belong to the source
Evidence/Statement record — never to the Analysis card.

## When to use

Use for:

```text
analysis_scene_<K>.md
```

Do not use for:

- `scene_<K>.md` — use `writing-detective-game-dialogue`;
- `investigation_scene_<K>.md` — use `writing-investigation-scene`;
- `interrogation_scene_<K>.md` — use `writing-interrogation-scene`.

Chapter 1 supports exactly these Analysis board kinds:

```text
classify
order
threshold
```

Do not author `compare`, `route`, `chain`, freeform, or plugin-defined boards.
If future content needs another family, change the compiler contract first.

## Canonical compiler-backed examples

Do not copy a second full example from this skill. Use the fixtures that the
compiler suite actually executes:

- Complete valid Chapter 1 scene:
  `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- The evidence/statement records and provenance used by its cards:
  `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md`
- Its facts, objective, and source-group declarations:
  `packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md`
- Canonical invalid unsupported-family example:
  `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/`

These fixture paths are the copyable examples. `parser-analysis.ts` and
`validator-analysis.ts` remain authoritative when this skill and code disagree.

## Authored vs generated ownership

Writers author semantic intent and stable IDs in Markdown:

- scene title + `Summary`;
- Intro / Result Dialogue / Outro;
- board label, prompt, feedback, optional static hint;
- board/card/group IDs;
- card source references;
- classify `Accepted Cards`;
- order `Accepted Order` and `Fixed Anchors`;
- threshold sufficiency constraints;
- positive board prerequisites; and
- story reveal outputs.

Writers never hand-edit:

- generated scene JSON;
- generated `story_catalog.json`;
- compiler-normalized `acceptedGroupByCard`;
- compiler-normalized `acceptedSelections`;
- runtime draft/save state;
- answer-key-free public workbench views; or
- filesystem asset paths.

Authors necessarily declare **solution intent** in Markdown. The compiler turns
that intent into hidden runtime answer keys. Do not move those normalized keys
into shared/public types just to make authoring easier.

## Structural hierarchy

```text
H1  # Scene N: <title>
    - **Summary:** <one-sentence player recap>
H2  ## Intro
H2  ## Board: <label> {#board_id}
H3      ### Card: <label> {#card_id}
H3      ### Group: <label> {#group_id}    # classify only
H3      ### Result Dialogue
H2  ## Outro
```

Rules that matter while writing:

- exactly one `## Intro` before every board;
- one or more boards;
- exactly one `## Outro` after every board;
- every board has one non-empty `### Result Dialogue`;
- board IDs are scene-local;
- card/group IDs are board-local;
- cards reference existing global evidence/statement IDs; and
- Analysis scenes do not declare Evidence or Statement Manifest blocks.

## Common board metadata

Every board uses:

```text
Kind
Prompt
Reveals
Incomplete Feedback
Incorrect Feedback
```

Optional:

```text
Unlock
Hint
```

`Unlock` uses the existing positive story expression grammar. Use a qualified
Analysis completion predicate only when that completion genuinely precedes and
can drive this board, for example:

```text
analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed
```

Do not use a bare scene/board ID. Prefer facts/objectives instead when the
narrative dependency is the conclusion itself rather than completion of a UI
board.

`Reveals` contains story progress only. Analysis does not acquire local
Evidence/Statements through its board result.

## Cards

A Card has:

```text
Source
Summary
```

`Source` is exactly one existing:

```text
evidence:<id>
statement:<id>
```

The card `Summary` is player-facing reasoning copy. It does not redefine the
source record's provenance.

Before adding a card, verify that its evidence/statement is guaranteed
obtainable before the board becomes reachable. The compiler's fixed-point
reachability check is the final authority.

## Classify board

Use `classify` when the player must answer:

> Which conclusion/package does each displayed record actually support?

Add one or more `### Group:` blocks. Each Group has:

```text
Description
Accepted Cards
```

Each displayed card must belong to exactly one accepted group. Do not invent
optional or unassigned cards in Chapter 1.

The writer authors `Accepted Cards`; the compiler normalizes that intent into
its hidden `acceptedGroupByCard` runtime key.

## Order board

Use `order` when the player must reconstruct one exact sequence.

Board metadata adds:

```text
Accepted Order
Fixed Anchors
```

`Accepted Order` names every displayed card exactly once.

`Fixed Anchors` uses:

```text
<card_id>@<one-based-position>
```

An empty fixed-anchor list is allowed only when the parser contract accepts the
authored list shape; do not invent another sentinel spelling. A fixed anchor
must agree with the accepted order.

The writer authors the exact reasoning sequence. The runtime receives the
compiler-validated normalized order.

## Threshold board

Use `threshold` when the player must answer:

> Which combination of already-obtained records is procedurally sufficient?

Board metadata adds:

```text
Eligible Cards
Minimum Selected
Minimum Distinct Source Groups
Required Proof Capabilities
Allowed Procedural Statuses
Require Source Group
```

Important semantics:

- `Eligible Cards` names the displayed cards that may participate in an accepted selection.
- every selected record must satisfy the authored procedural-status restriction;
- when `Require Source Group: true`, every selected record needs a non-null source group;
- independence counts distinct non-null source-group IDs;
- required proof capabilities are covered by the **union** of selected records' capabilities; and
- provenance comes from the referenced evidence/statement records, not from the card.

If a threshold is unsatisfiable, fix the source-record metadata or the board
intent. Never encode a fake source group in card prose to get around the
validator.

The compiler materializes accepted selections. Writers never author or edit
that normalized list.

## Source groups and proof capabilities

When threshold reasoning needs independence, inspect the source records before
writing the board.

`Source Group` is source identity, not a display label. Two records from the
same underlying source remain the same source even if their names differ.
Missing source group means independence is unknown; it does not create a new
independent source automatically.

`Proof Capabilities` are positive capabilities of the source record. Current
canonical values and ordering live in `writing-investigation-scene` and the
compiler. Do not infer capabilities from `Details`, `Summary`, or proximity.

If the Analysis design exposes a provenance problem, edit the owning
investigation/interrogation record and its catalog source-group declaration;
do not duplicate provenance metadata in `analysis_scene_<K>.md`.

## Story outputs and the Chapter 1 authority boundary

Analysis boards may assert/resolve supported story progress through `Reveals`.
The compiler validates those targets through `story_catalog.md`.

For Chapter 1 Beat 8.5, the workbench establishes facts and completes:

```text
prepare_narrow_lock_request
```

It does **not** grant:

```text
narrow_lock_export
```

`grant_authorization:<id>` is forbidden on Analysis boards. Institutional
access is granted by the authored hearing/authority event, not by solving the
workbench.

Treat a `Reveals` list as authored ordered story progress. Do not rely on
replaying a completed board to dispatch the same outputs again.

## Feedback and result dialogue

Keep first-version feedback small:

- `Incomplete Feedback` — the submitted draft is structurally unfinished;
- `Incorrect Feedback` — the draft is complete but not accepted;
- optional `Hint` — static answer-key-free presentation copy;
- `Result Dialogue` — accepted-board payoff and transition reasoning.

Do not invent progressive hint state, contextual failure taxonomies, or
per-reason threshold feedback in Chapter 1. Those are separate playtest-driven
work.

## Dialogue and assets

Intro, every Result Dialogue, and Outro use the normal
`writing-detective-game-dialogue` rules.

Writers author semantic visual/audio intent only where the current scene asset
contract supports it. Never write asset filesystem paths. Generated `assetRefs`
and runtime resource paths belong to the compiler.

## Workflow

1. Read the chapter construction plan and identify the reasoning step the Analysis scene replaces.
2. List the existing evidence/statement IDs the player has already obtained.
3. Inspect those records' provenance when a threshold board depends on source independence, procedural status, or proof capabilities.
4. Decide the smallest board sequence using only `classify`, `order`, and `threshold`.
5. Choose stable board/card/group IDs before writing dialogue.
6. Author Intro, boards, Result Dialogue, and Outro in manifest order.
7. Use positive story prerequisites and story outputs; do not self-grant authorization.
8. Run `bun run scenes:compile`.
9. Fix the authored scene/source records when the compiler reports unresolved IDs, impossible thresholds, incomplete solutions, or unreachable content. Do not edit generated JSON or weaken the compiler to accept the draft.
10. Review the player-facing reasoning: every board should ask one clear question and its Result Dialogue should state the earned conclusion without re-teaching the entire workbench.

## Self-check before returning

- Is the file named `analysis_scene_<K>.md` and listed in `chapter.md`?
- Did I use only `classify`, `order`, or `threshold`?
- Does every card reference an already-authored evidence/statement record?
- Does every classify card have exactly one accepted group?
- Does the accepted order include every displayed order card exactly once?
- Are fixed anchors one-based and consistent with that order?
- For threshold, do source groups/procedural status/capabilities live on the source records rather than the cards?
- Can every card source be obtained before its board becomes reachable?
- Are board prerequisites positive and fully qualified where Analysis completion is referenced?
- Are every Fact/Objective output and source-group ID declared in `story_catalog.md`?
- Did I avoid `grant_authorization` in Analysis?
- Are Intro/Result Dialogue/Outro valid Traditional Chinese dialogue under the base dialogue skill?
- Did I leave generated JSON and filesystem paths untouched?
- Does `bun run scenes:compile` pass?

## Common mistakes

| Mistake | Fix |
|---|---|
| Inventing a fourth board kind because the story plan says “route” or “compare” | Reshape Chapter 1 reasoning into the three implemented families or change the compiler in a separate reviewed feature first. |
| Copying Evidence/Statement manifests into the Analysis scene | Keep records in their owning investigation/interrogation scene; Analysis cards reference them. |
| Putting `Source Group` or `Proof Capabilities` on a Card | Edit the source record's provenance metadata. |
| Treating two differently named records as independent sources | Independence is `Source Group` identity, not display name. |
| Writing `acceptedGroupByCard` or `acceptedSelections` | Those are compiler-normalized hidden runtime keys, not authored Markdown fields. |
| Using a bare `analysis_board:<id>` unlock | Use the fully qualified `analysis_board:<chapter>@<scene>@<board> completed` form. |
| Granting `narrow_lock_export` from Beat 8.5 | Complete request readiness only; the hearing owns the authorization grant. |
| Fixing a compiler error by editing generated scene JSON | Fix authored Markdown/catalog/provenance and rerun `bun run scenes:compile`. |
| Duplicating the full parser schema in this skill | Point to the canonical fixture and compiler; keep this skill focused on author intent. |
````

- [ ] **Step 3: Verify the skill names only compiler-backed canonical examples**

Run:

```bash
grep -F 'packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md' .claude/skills/writing-analysis-scene/SKILL.md
grep -F 'packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md' .claude/skills/writing-analysis-scene/SKILL.md
grep -F 'packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md' .claude/skills/writing-analysis-scene/SKILL.md
grep -F 'packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/' .claude/skills/writing-analysis-scene/SKILL.md
```

Expected: all four commands print exactly the intended reference lines.

- [ ] **Step 4: Format-check the new Markdown before touching other skills**

Run:

```bash
bunx prettier .claude/skills/writing-analysis-scene/SKILL.md --check
```

Expected: PASS.

- [ ] **Step 5: Commit the dedicated skill**

```bash
git add .claude/skills/writing-analysis-scene/SKILL.md
git commit -m "docs: add Chapter 1 analysis authoring skill"
```

---

### Task 2: Register Analysis in the repo authoring and orchestration maps

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/skills/writing-chapter-manifest/SKILL.md`
- Modify: `.claude/skills/subagent-driven-story-writing/SKILL.md`

**Interfaces:**
- Consumes: `writing-analysis-scene` from Task 1.
- Produces: deterministic routing from repo guidance/manifest/orchestrator to the new skill.

- [ ] **Step 1: Add Analysis to the `CLAUDE.md` playable scene-family list**

In the `Project domain` section, add this bullet immediately after the interrogation scene bullet:

```markdown
  - `analysis_scene_<K>.md` - compiler-validated Analysis workbench scenes that
    reorganize already-obtained case records through Chapter 1 `classify`,
    `order`, and `threshold` boards. Authored via `writing-analysis-scene`.
```

Do not change the source-root, generated-resource, or planning-document rules.

- [ ] **Step 2: Add Analysis scene-type inference to `writing-chapter-manifest`**

Extend the Scene-type inference table with:

```markdown
| `analysis_scene_<K>.md` | Analysis workbench (uses `writing-analysis-scene`) |
```

Then add Analysis to the parser-validation wording so it no longer implies only the old three prefixes exist.

The surrounding contract must still say the manifest only contains filenames and infers scene type from prefixes; do not add an explicit `type` field.

- [ ] **Step 3: Add Analysis dispatch to `subagent-driven-story-writing`**

Update the `When to Use` / beat mapping so the orchestrator recognizes:

```text
reasoning / evidence-organization workbench -> analysis_scene_<K>.md -> writing-analysis-scene
```

Add `writing-analysis-scene` to Related skills.

In the writing-subagent brief contract, add one compact Analysis-specific bullet:

```markdown
- **For Analysis scenes: exact board/card/group IDs, card source IDs, board kinds,
  positive prerequisites, story outputs, and any request-vs-authorization
  boundary.** The orchestrator owns cross-file IDs and source-record paths;
  the writer invokes `writing-analysis-scene` and does not invent provenance
  copies or unsupported board families.
```

Do not duplicate the board field tables from the dedicated skill.

- [ ] **Step 4: Verify the routing text is complete and unique**

Run:

```bash
grep -n 'analysis_scene_<K>' CLAUDE.md .claude/skills/writing-chapter-manifest/SKILL.md .claude/skills/subagent-driven-story-writing/SKILL.md
grep -n 'writing-analysis-scene' CLAUDE.md .claude/skills/writing-chapter-manifest/SKILL.md .claude/skills/subagent-driven-story-writing/SKILL.md
```

Expected: every authoring map names both the Analysis filename family and the dedicated skill; there is no second Analysis authoring skill name.

- [ ] **Step 5: Commit the routing updates**

```bash
git add CLAUDE.md .claude/skills/writing-chapter-manifest/SKILL.md .claude/skills/subagent-driven-story-writing/SKILL.md
git commit -m "docs: route analysis scenes through authoring skill"
```

---

### Task 3: Correct stale qualified-Analysis guidance without widening authority semantics

**Files:**
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `.claude/skills/writing-interrogation-scene/SKILL.md`

**Interfaces:**
- Consumes: HPA-259 production qualified Analysis registry and the HPA-264 authorization boundary.
- Produces: accurate cross-scene story-state guidance for existing interactive scene writers.

- [ ] **Step 1: Replace the stale investigation synthetic-only warning**

Find the paragraph after the qualified Analysis predicate list that currently says the syntax is fixed but packaged production content lacks HPA-259 Analysis registration/completion and is synthetic-fixture-only.

Replace it with:

```markdown
`question:<id> resolved` is global story state, not an investigation-local
predicate. Analysis references always use every shown slug segment; a bare
scene or board ID is invalid. Qualified Analysis scenes/boards are now a
production compiler contract and must resolve to manifest-owned Analysis
content. Only author a completion predicate when the playable flow can really
produce that completion; when the narrative dependency is the conclusion
itself, prefer the Fact/Objective emitted by the Analysis board instead of
coupling later content to the workbench UI event.
```

Keep the separate `authorization:<id> granted` / HPA-264 warning unchanged.

- [ ] **Step 2: Replace the matching stale interrogation warning**

Replace the corresponding paragraph in `writing-interrogation-scene` with:

```markdown
Analysis predicates require the fully qualified slug segments shown above and
must resolve to manifest-owned Analysis content. They are part of the
production compiler contract; only use them when the playable flow can really
produce that completion. If the interrogation depends on the reasoning result
rather than the UI event, prefer the Fact/Objective emitted by the Analysis
board. This does not change the separate authorization rule below: an
institutional grant still needs its authored authority event.
```

Keep `grant_authorization` restrictions and contradiction-guarantee guidance unchanged.

- [ ] **Step 3: Prove the obsolete synthetic-only wording is gone**

Run:

```bash
! grep -n 'synthetic fixture boundary' .claude/skills/writing-investigation-scene/SKILL.md .claude/skills/writing-interrogation-scene/SKILL.md
! grep -n 'no HPA-259 analysis registry' .claude/skills/writing-investigation-scene/SKILL.md .claude/skills/writing-interrogation-scene/SKILL.md
grep -n 'grant_authorization' .claude/skills/writing-investigation-scene/SKILL.md .claude/skills/writing-interrogation-scene/SKILL.md
```

Expected: the first two checks succeed with no matches; the last still shows the existing authority restrictions.

- [ ] **Step 4: Commit only the focused cross-scene wording correction**

```bash
git add .claude/skills/writing-investigation-scene/SKILL.md .claude/skills/writing-interrogation-scene/SKILL.md
git commit -m "docs: sync qualified analysis authoring guidance"
```

---

### Task 4: Add the compiler-backed invalid Analysis authoring example

**Files:**
- Create: `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/chapter.md`
- Create: `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/analysis_scene_1.md`
- Create: `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/expected-error.txt`
- Test unchanged: `packages/scripts/compile-scenes.test.ts`

**Interfaces:**
- Consumes: existing automatic invalid-fixture discovery in `compile-scenes.test.ts`.
- Produces: executable proof that HPA-552 does not document or permit an unbuilt `route` family.

- [ ] **Step 1: Create the minimal invalid chapter manifest**

Create `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/chapter.md`:

```markdown
# Chapter 1: HPA-552 未建置分析板

**Summary:** 驗證 Analysis 作者不能使用未建置的板型。

## Scenes

1. analysis_scene_1.md
```

- [ ] **Step 2: Create the intentionally unsupported Analysis board**

Create `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/analysis_scene_1.md`:

```markdown
# Scene 1: 未建置路線板

- **Summary:** 這個場景刻意使用 Chapter 1 未支援的 Analysis 板型。

## Intro

**相馬律**：先確認這個推理板是否屬於目前的作者契約。

## Board: 路線重建 {#route_board}

- **Kind:** route
- **Prompt:** 把路線節點連起來。
- **Reveals:** []
- **Incomplete Feedback:** 路線還沒有完成。
- **Incorrect Feedback:** 這條路線不正確。
```

The parser must fail on `Kind: route` before this intentionally minimal file needs cards/result/outro.

- [ ] **Step 3: Declare the exact expected compiler diagnostic**

Create `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/expected-error.txt`:

```text
analysisBoardInvalidKind
```

- [ ] **Step 4: Run the existing fixture runner and observe the new case passing**

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Expected: PASS, including:

```text
fixture "hpa_552_analysis_unsupported_board_kind" produces the expected error
```

There is intentionally no new fixture harness or doc-snippet compiler.

- [ ] **Step 5: Re-run the existing complete Chapter 1 Analysis fixture test**

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts -t 'compiles the complete analysis Chapter 1 corpus through qualified progression'
```

Expected: PASS with the existing `evidence_packages`, `local_event_sequence`, and `narrow_request_basis` boards.

- [ ] **Step 6: Commit the invalid example**

```bash
git add packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind
git commit -m "test: lock Chapter 1 analysis board families"
```

---

### Task 5: Validate the authoring contract end to end

**Files:**
- Verify all files from Tasks 1–4.
- Do not modify generated `apps/game/src-tauri/resources/scenes/*.json`.

**Interfaces:**
- Consumes: complete HPA-552 implementation.
- Produces: acceptance evidence for Linear/PR review.

- [ ] **Step 1: Compile the real authored story tree**

Run:

```bash
bun run scenes:compile
```

Expected: successful compile with no HPA-552-related warnings/errors. Generated resource JSON remains untracked/ignored.

- [ ] **Step 2: Run the complete compiler/script test suite**

Run:

```bash
bun run test:scripts
```

Expected: PASS, including both the existing complete valid Analysis fixture and the new invalid fixture.

- [ ] **Step 3: Type-check compiler scripts**

Run:

```bash
bun run check:scripts
```

Expected: PASS.

- [ ] **Step 4: Check formatting for all touched Markdown/fixture files**

Run:

```bash
bun run format:check
```

Expected: PASS.

- [ ] **Step 5: Confirm no unsupported implementation layers were touched**

Run:

```bash
git diff --name-only origin/main...HEAD
```

Expected file families only:

```text
.claude/skills/
CLAUDE.md
packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/
```

No `apps/game`, `packages/scene-types`, compiler production `.ts`, layout-editor, generated JSON, or Chapter 2 content changes.

- [ ] **Step 6: Inspect the canonical valid example against the new skill one final time**

Read:

```bash
sed -n '1,260p' .claude/skills/writing-analysis-scene/SKILL.md
cat packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md
cat packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md
cat packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md
```

Verify specifically:

- every board field the skill tells writers to use exists in the fixture/parser;
- the skill does not claim Analysis owns Evidence/Statement manifests;
- threshold provenance is sourced from the referenced records;
- `grant_authorization` remains forbidden for Analysis; and
- there is no copied full second valid scene inside the skill.

- [ ] **Step 7: Self-review against HPA-552 acceptance criteria**

Record this checklist in the implementation PR description:

```text
[ ] Canonical valid Analysis example is compiler exercised.
[ ] Canonical invalid unsupported-board example is compiler exercised.
[ ] Skill covers classify/order/threshold only.
[ ] Skill points to canonical compiler/provenance ownership instead of duplicating it.
[ ] Generated JSON remains compiler-owned.
[ ] Manifest/orchestrator/repo guidance routes Analysis to writing-analysis-scene.
[ ] Stale synthetic-only qualified-Analysis wording is removed.
[ ] Analysis cannot self-grant narrow_lock_export.
[ ] bun run scenes:compile passes.
[ ] bun run test:scripts passes.
[ ] bun run check:scripts passes.
[ ] bun run format:check passes.
```

- [ ] **Step 8: Commit any formatting-only repair, if one was required**

If `bun run format:check` required formatting changes:

```bash
bun run format
git add .claude/skills CLAUDE.md packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind
git commit -m "style: format analysis authoring contract"
```

If no formatting repair was needed, do not create an empty commit.

---

## Implementation Review Notes

### Keep HPA-552 small

A reviewer should push back on any implementation that adds:

- parser changes to support a skill example;
- a schema/doc generator;
- an Analysis plugin registry;
- Chapter 2/later board families;
- duplicate provenance metadata on Analysis cards;
- Analysis-local inventory manifests;
- runtime/public answer keys; or
- a new authorization path.

Those are evidence that the authoring skill is driving architecture rather than documenting the already-approved architecture.

### Expected follow-on

HPA-265 should consume this skill when replacing the real Beat 8.5 transition with `docs/stories_plan/chapter_1/analysis_scene_8_5.md`. If the production authoring pass exposes a real mismatch between the skill and the merged compiler, correct HPA-552 guidance to the compiler/canon rather than adding compatibility syntax.

Rich feedback/hints remain HPA-263. Layout/editor work remains the later editor scope.