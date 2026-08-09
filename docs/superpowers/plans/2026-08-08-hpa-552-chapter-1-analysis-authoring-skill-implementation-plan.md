# HPA-552 Chapter 1 Analysis Scene Authoring Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compiler-aligned `writing-analysis-scene` repo skill for Chapter 1 writers, wire Analysis into existing authoring/review routing, and keep canonical examples compiler-backed.

**Architecture:** The compiler remains the schema and semantic authority. The new skill is reference-first: it teaches writer intent and points to live compiler fixtures rather than cloning schema or generated answers. Existing guidance receives only narrow Analysis routing/story-state links, and one end-to-end invalid fixture makes the `classify | order | threshold` boundary executable.

**Tech Stack:** Markdown repo skills, TypeScript scene compiler fixtures, Vitest fixture runner, Bun 1.3.1.

## Global Constraints

- Implement only the current Chapter 1 Analysis board families: `classify`, `order`, `threshold`.
- Do not add `compare`, `route`, `chain`, freeform boards, plugin registries, or template abstractions.
- Do not change runtime, frontend, save/persistence, or layout-editor code.
- Do not hand-edit generated scene JSON or `story_catalog.json`.
- Case-analysis cards reference existing case records; provenance remains on those records.
- If HPA-561 PR #44 has landed, document its already-built tutorial-only `practice:<id>` card source and threshold `Incorrect Selection` feedback as narrow existing exceptions; do not generalize them into another case-record system.
- Keep compiler-normalized answer keys out of public/shared answer-key-free surfaces; authors still declare semantic solution intent required by the compiler.
- Analysis boards may prepare Chapter 1 request readiness but must not grant `narrow_lock_export`.
- Reuse `writing-detective-game-dialogue` for dialogue/narration/assets and existing investigation/interrogation guidance for case-record provenance.
- Canonical copyable examples live in compiler fixtures, not duplicated full scenes inside the skill.
- Before editing overlapping writer/reviewer skills, use a `main` baseline containing HPA-561 PR #44. Do not overwrite #44's narration/catalog/background/review changes.
- Breaking pre-release authoring changes need no compatibility layer.

---

## File Map

### Create

- `.claude/skills/writing-analysis-scene/SKILL.md` — dedicated Chapter 1 Analysis authoring guidance.
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/chapter.md` — invalid-example manifest.
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/scene_0.md` — tiny valid playable scene so the invalid fixture produces no incidental `chapterNoPlayableScenes` error.
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/analysis_scene_1.md` — intentionally unsupported `route` board.
- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/expected-error.txt` — expected `analysisBoardInvalidKind` diagnostic.

### Modify narrowly

- `CLAUDE.md` — register `analysis_scene_<K>.md` and `writing-analysis-scene`.
- `.claude/skills/writing-chapter-manifest/SKILL.md` — add Analysis filename/type inference.
- `.claude/skills/subagent-driven-story-writing/SKILL.md` — dispatch Analysis to the new skill.
- `.claude/skills/writing-investigation-scene/SKILL.md` — remove stale synthetic-only qualified-Analysis wording.
- `.claude/skills/writing-interrogation-scene/SKILL.md` — same focused story-state correction.
- `.claude/skills/reviewing-story-scenes/SKILL.md` — on the post-#44 baseline, add only the new `writing-analysis-scene` link; preserve #44's existing Analysis discovery/axis changes.

### Reuse unchanged

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md` — canonical valid three-board case-analysis example.
- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md` — canonical case-record/provenance source example.
- `packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md` — canonical story/source-group definitions.
- `packages/scripts/compile-scenes/parser-analysis.ts` — syntax authority.
- `packages/scripts/compile-scenes/validator-analysis.ts` — semantics/normalization authority.
- `packages/scripts/compile-scenes/parser-common.ts` + `parser-assets.ts` — Analysis scene-tag asset contract.
- `packages/scripts/compile-scenes.test.ts` — existing valid fixture coverage and automatic invalid-fixture discovery.

---

### Task 1: Add the dedicated reference-first Analysis authoring skill

**Files:**
- Create: `.claude/skills/writing-analysis-scene/SKILL.md`
- Reference unchanged: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- Reference unchanged: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md`
- Reference unchanged: `packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md`
- If present after HPA-561: reference `docs/stories_plan/chapter_1/analysis_scene_p1_5.md` only for the tutorial-only `practice:` / `Incorrect Selection` extension.

**Interfaces:**
- Consumes: current post-HPA-561 compiler contract plus existing dialogue/provenance skills.
- Produces: repo-contract instructions for Chapter 1 `analysis_scene_<K>.md` authoring.

- [ ] **Step 1: Confirm the execution baseline contains HPA-561's current Analysis/review hardening**

Run:

```bash
git fetch origin
git log -1 --oneline origin/main
git diff --name-only origin/main...HEAD -- .claude/skills packages/scripts/compile-scenes/parser-analysis.ts packages/scripts/compile-scenes/parser-assets.ts
```

Inspect:

```bash
sed -n '1,220p' .claude/skills/writing-investigation-scene/SKILL.md
sed -n '1,220p' .claude/skills/writing-interrogation-scene/SKILL.md
sed -n '1,220p' .claude/skills/subagent-driven-story-writing/SKILL.md
sed -n '1,240p' .claude/skills/reviewing-story-scenes/SKILL.md
```

Verify the post-#44 baseline already includes `analysis_scene_*.md` in `reviewing-story-scenes` discovery/When-to-Use and Analysis coverage in its existing axes.

Also verify the current compiler contract before copying prose into the skill:

```bash
grep -n 'function parseCardSource' packages/scripts/compile-scenes/parser-analysis.ts
grep -n 'Incorrect Selection' packages/scripts/compile-scenes/parser-analysis.ts
grep -n 'VISUAL_ASSET_METADATA_KEYS' packages/scripts/compile-scenes/parser-assets.ts
```

Expected after #44: case-record card sources remain supported; `practice:` and threshold `Incorrect Selection` may also exist as the already-built tutorial extension; scene-tag visual metadata is supported. If the merged baseline differs materially, update this plan to the compiler before authoring the skill.

- [ ] **Step 2: Create the skill with the exact first-version contract**

Create `.claude/skills/writing-analysis-scene/SKILL.md` with the following content:

````markdown
---
name: writing-analysis-scene
description: Use when writing or extending an analysis_scene_<K>.md file under a playable Chapter 1 story root. Covers the compiler-supported classify, order, and threshold boards, case-record cards, the existing tutorial-only practice-card exception, result dialogue, feedback, story progress, and scene-tag asset cues.
---

# Writing Analysis Scenes (《東京雨證：第零證人》)

## Role

You author compiler-validated `analysis_scene_<K>.md` files. Analysis lets the
player organize already-known material into explicit reasoning steps. It does
not replace investigation or grant institutional authority.

The compiler is the syntax/semantic authority. This skill teaches author intent
and workflow; it does not duplicate every parser diagnostic or runtime field.

## Required background

Read `writing-detective-game-dialogue` first. It owns Traditional Chinese
player-facing dialogue, `**角色名**：`, `[場景：...]`, narration/expression, and
the shared scene-tag visual/audio metadata rules.

For case-record cards, read the canonical provenance section in
`writing-investigation-scene` (and the matching interrogation section for
records declared there). Source groups, procedural status, proof capabilities,
completeness/confidence, and supersession belong to the source record — never
to the Analysis card.

## When to use

Use for `analysis_scene_<K>.md`.

Use other skills for:

- `scene_<K>.md` -> `writing-detective-game-dialogue`
- `investigation_scene_<K>.md` -> `writing-investigation-scene`
- `interrogation_scene_<K>.md` -> `writing-interrogation-scene`

Chapter 1 supports exactly these board kinds:

```text
classify
order
threshold
```

Do not author `compare`, `route`, `chain`, freeform, or plugin-defined boards.

## Canonical compiler-backed examples

Use the fixtures the compiler actually executes:

- valid Chapter 1 case-analysis scene:
  `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- its case-record sources/provenance:
  `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md`
- its facts/objective/source groups:
  `packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md`
- invalid unsupported board family:
  `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/`

If the post-HPA-561 production tutorial exists, use
`docs/stories_plan/chapter_1/analysis_scene_p1_5.md` only for the narrow
`practice:` / `Incorrect Selection` tutorial exception described below. Do not
copy tutorial semantics into real case-analysis boards.

`parser-analysis.ts` and `validator-analysis.ts` win if prose and compiler
disagree.

## Authored vs generated ownership

Writers author semantic solution intent and stable IDs in Markdown, including:

- scene title + `Summary`;
- Intro / Result Dialogue / Outro;
- board label, prompt, feedback, optional Hint;
- board/card/group IDs;
- card sources;
- classify `Accepted Cards`;
- order `Accepted Order` + `Fixed Anchors`;
- threshold sufficiency constraints;
- positive prerequisites; and
- story outputs.

Writers never hand-edit generated JSON, generated `story_catalog.json`,
normalized `acceptedGroupByCard` / `acceptedSelections`, runtime save state,
answer-key-free public views, or filesystem asset paths.

## Structure

```text
H1  # Scene N: <title>
    - **Summary:** <one-sentence player recap>
H2  ## Intro
H2  ## Board: <label> {#board_id}
H3      ### Card: <label> {#card_id}
H3      ### Group: <label> {#group_id}    # classify only
H3      ### Incorrect Selection           # threshold only, optional post-HPA-561 feedback
H3      ### Result Dialogue
H2  ## Outro
```

Core rules:

- exactly one Intro before all boards;
- one or more boards;
- exactly one Outro after all boards;
- every board has non-empty Result Dialogue;
- board IDs are scene-local;
- card/group IDs are board-local; and
- Analysis has no local Evidence/Statement Manifest.

## Common board metadata

Required:

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

`Unlock` uses the existing positive story expression grammar. Qualified Analysis
completion refs always include chapter, scene, and board segments, for example:

```text
analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed
```

Prefer emitted facts/objectives when later story content depends on the earned
conclusion rather than the UI completion event.

`Reveals` is story progress; Analysis does not acquire case-record inventory
through board completion.

## Cards

For real case analysis, `Source` references an existing:

```text
evidence:<id>
statement:<id>
```

The card `Summary` is player-facing reasoning copy and does not redefine the
source record's provenance.

Every case-record card source must be obtainable before its board becomes
reachable.

### Tutorial-only practice cards

On the post-HPA-561 Chapter 1 baseline, the onboarding Analysis scene may use:

```text
practice:<id>
```

This is a tutorial-local carrier, not Case File evidence/statement data. Do not
use `practice:` in Beat 8.5 or other real case-analysis boards, do not assign
Case File provenance to it, and do not mix tutorial practice cards with Case
File cards in one threshold eligible set.

For an all-practice threshold board, keep Case File provenance requirements
neutral as required by the compiler: no source-group minimum/capability/status
requirements and `Require Source Group: false`.

## Classify

Use `classify` when the player must decide which conclusion/package each record
supports.

Each Group declares:

```text
Description
Accepted Cards
```

Every displayed card belongs to exactly one accepted group. The compiler
normalizes that authored intent into `acceptedGroupByCard`.

## Order

Use `order` for one exact sequence.

Board metadata adds:

```text
Accepted Order
Fixed Anchors
```

`Accepted Order` is required and names every displayed card exactly once.

`Fixed Anchors` is also required on every order board. Use:

```text
- **Fixed Anchors:** []
```

when nothing is pinned. Non-empty entries use:

```text
<card_id>@<one-based-position>
```

Card IDs and positions must be unique/in range and each anchor must agree with
`Accepted Order` at that position. Do not omit the field or invent a sentinel.

## Threshold

Use `threshold` when the player must select a procedurally sufficient
combination.

Board metadata adds:

```text
Eligible Cards
Minimum Selected
Minimum Distinct Source Groups
Required Proof Capabilities
Allowed Procedural Statuses
Require Source Group
```

For Case File cards:

- procedural-status restrictions apply to every selected record;
- `Require Source Group: true` requires a non-null group on every selection;
- independence counts distinct non-null Source Group IDs;
- required capabilities are satisfied by the union of selected records; and
- provenance comes from the referenced records, not the card.

If a threshold is unsatisfiable, fix source-record metadata or board intent;
do not fake provenance in card prose.

### Optional exact wrong-selection feedback

On the post-HPA-561 baseline, threshold boards may add zero or more:

```markdown
### Incorrect Selection

- **Cards:** [card_a, card_b]
- **Feedback:** 這組資料為什麼不成立的簡短玩家提示。
```

Use this only for a deliberately important exact wrong subset. It is not a
replacement for `Incorrect Feedback` and does not create a rich/progressive
hint system. The named cards must be displayed, unique, non-empty, and the set
must not equal an accepted selection.

## Story outputs and authority

For Beat 8.5, Analysis establishes facts and completes:

```text
prepare_narrow_lock_request
```

It does not grant:

```text
narrow_lock_export
```

`grant_authorization:<id>` is forbidden on Analysis boards. The hearing/authority
event owns institutional access.

## Feedback

- `Incomplete Feedback` -> structurally unfinished submit
- `Incorrect Feedback` -> complete but not accepted submit
- optional `Hint` -> static guidance
- optional threshold `Incorrect Selection` -> exact known wrong subset, only if the current compiler supports it
- `Result Dialogue` -> accepted-board payoff

Do not invent progressive hint state or a new failure taxonomy.

## Dialogue and asset cues

Intro, every Result Dialogue, and Outro use normal dialogue rules.

A `[場景：...]` inside those dialogue carriers may be followed immediately by
the visual/audio metadata accepted by the current shared scene-tag asset
contract. On the post-HPA-561 baseline this includes:

```text
Background Prompt
Background Asset ID
BGM
BGS
```

Do not put those fields directly on a Board/Card/Group. Analysis has no local
Evidence Manifest, so there is no Analysis-local evidence `Image Prompt`.
Never author filesystem paths.

## Workflow

1. Read the chapter plan and identify the reasoning step.
2. List the already-obtained case-record IDs (or the explicit tutorial-local practice IDs for the onboarding-only scene).
3. Inspect source-record provenance when threshold independence/status/capabilities matter.
4. Choose the smallest board sequence using only classify/order/threshold.
5. Choose stable board/card/group IDs.
6. Author Intro, boards, Result Dialogue, Outro, and only supported scene-tag asset cues.
7. Use positive story prerequisites/outputs; do not self-grant authority.
8. Run `bun run scenes:compile`.
9. Fix authored Markdown/catalog/provenance when the compiler rejects it. Never edit generated JSON or weaken the compiler.
10. Review each board as one clear detective question with an earned Result Dialogue.

## Self-check

- File is `analysis_scene_<K>.md` and is listed in `chapter.md`.
- Board kind is classify/order/threshold only.
- Case-analysis cards reference existing evidence/statement records; practice cards appear only in the onboarding exception.
- Every classify card has one accepted group.
- Accepted Order contains every order card exactly once.
- Fixed Anchors exists; use `[]` if none; non-empty entries are one-based and consistent.
- Threshold provenance lives on source records and is satisfiable.
- Practice and Case File cards are not mixed in one threshold eligible set.
- Card sources are obtainable before their board is reachable.
- Analysis completion predicates are positive/fully qualified where used.
- Story output IDs/source groups resolve in `story_catalog.md`.
- No `grant_authorization` in Analysis.
- Scene-tag asset metadata is attached to `[場景：...]`, not board metadata.
- Generated JSON/filesystem paths remain untouched.
- `bun run scenes:compile` passes.

## Common mistakes

| Mistake | Fix |
|---|---|
| Inventing route/compare/chain | Use the three implemented board families or change compiler in a separate feature. |
| Copying Evidence/Statement manifests into Analysis | Reference the owning case record. |
| Putting Source Group/Proof Capabilities on a Card | Edit the owning case record. |
| Using `practice:` for a real case clue | Practice is onboarding-local only; use evidence/statement for real case analysis. |
| Mixing practice + Case File threshold cards | Keep tutorial and real Case File reasoning separate. |
| Omitting Fixed Anchors because no card is pinned | Write `Fixed Anchors: []`. |
| Writing normalized `acceptedGroupByCard` / `acceptedSelections` | Those are compiler-owned runtime keys. |
| Using bare analysis board IDs | Use fully qualified Analysis completion predicates. |
| Granting `narrow_lock_export` from Analysis | Complete request readiness; hearing grants authority. |
| Putting Background Prompt/BGM/BGS directly on a board | Attach supported visual/audio metadata immediately after a `[場景：...]` in Intro/Result Dialogue/Outro. |
| Editing generated JSON to fix compile | Fix authored Markdown/catalog/provenance and recompile. |
````

- [ ] **Step 3: Verify critical statements against compiler-backed sources**

Run:

```bash
grep -F 'packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md' .claude/skills/writing-analysis-scene/SKILL.md
grep -F 'Fixed Anchors: []' .claude/skills/writing-analysis-scene/SKILL.md
grep -F 'Background Prompt' .claude/skills/writing-analysis-scene/SKILL.md
grep -F 'analysisBoardInvalidKind' packages/scripts/compile-scenes/parser-analysis.test.ts packages/scripts/compile-scenes/parser-analysis.ts || true
```

If the HPA-561 tutorial extension exists, also verify:

```bash
grep -F 'practice:' packages/scripts/compile-scenes/parser-analysis.ts
grep -F 'Incorrect Selection' packages/scripts/compile-scenes/parser-analysis.ts
grep -F 'practice:' .claude/skills/writing-analysis-scene/SKILL.md
grep -F 'Incorrect Selection' .claude/skills/writing-analysis-scene/SKILL.md
```

Expected: skill wording matches current parser/validator behavior rather than the pre-#44 plan.

- [ ] **Step 4: Format-check and commit the dedicated skill**

Run:

```bash
bunx prettier .claude/skills/writing-analysis-scene/SKILL.md --check
```

Expected: PASS.

Commit:

```bash
git add .claude/skills/writing-analysis-scene/SKILL.md
git commit -m "docs: add Chapter 1 analysis authoring skill"
```

---

### Task 2: Register Analysis in authoring, orchestration, and semantic-review routing

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/skills/writing-chapter-manifest/SKILL.md`
- Modify: `.claude/skills/subagent-driven-story-writing/SKILL.md`
- Modify narrowly after #44: `.claude/skills/reviewing-story-scenes/SKILL.md`

**Interfaces:**
- Consumes: `writing-analysis-scene` from Task 1 and HPA-561's existing review hardening.
- Produces: deterministic routing to the new skill without a second review system.

- [ ] **Step 1: Add Analysis to `CLAUDE.md`**

Add to the playable scene-family list:

```markdown
  - `analysis_scene_<K>.md` - compiler-validated Analysis workbench scenes for
    Chapter 1 reasoning boards. Authored via `writing-analysis-scene`.
```

Do not rewrite source-root or generated-resource rules.

- [ ] **Step 2: Add Analysis inference to `writing-chapter-manifest`**

Extend the scene-type table with:

```markdown
| `analysis_scene_<K>.md` | Analysis workbench (uses `writing-analysis-scene`) |
```

Keep filename-based inference; do not add a `type` field.

- [ ] **Step 3: Add Analysis dispatch to `subagent-driven-story-writing`**

Add the beat mapping:

```text
reasoning / evidence-organization workbench -> analysis_scene_<K>.md -> writing-analysis-scene
```

Add `writing-analysis-scene` to Related skills.

Add this compact brief requirement:

```markdown
- **For Analysis scenes:** exact board/card/group IDs, source IDs/owner paths,
  board kinds, positive prerequisites, story outputs, and any request-vs-
  authorization boundary. The writer invokes `writing-analysis-scene`; do not
  duplicate provenance or invent unsupported board families.
```

Do not copy Analysis field tables into the orchestration skill.

- [ ] **Step 4: Link the dedicated skill from `reviewing-story-scenes` without redoing HPA-561**

First verify #44 already left these in place:

```bash
grep -n 'analysis_scene_.*md' .claude/skills/reviewing-story-scenes/SKILL.md
grep -n 'For analysis scenes inspect Intro' .claude/skills/reviewing-story-scenes/SKILL.md || true
```

Do not rewrite those sections.

Add `writing-analysis-scene` only where the review skill lists relevant/related format skills. For example, update the final related-skills list so it includes:

```text
writing-detective-game-dialogue,
writing-investigation-scene,
writing-interrogation-scene,
writing-analysis-scene,
writing-chapter-manifest
```

Keep seven axes; Axis 6 remains investigation-only.

- [ ] **Step 5: Verify routing and commit**

Run:

```bash
grep -n 'analysis_scene_<K>' CLAUDE.md .claude/skills/writing-chapter-manifest/SKILL.md .claude/skills/subagent-driven-story-writing/SKILL.md
grep -n 'writing-analysis-scene' CLAUDE.md .claude/skills/writing-chapter-manifest/SKILL.md .claude/skills/subagent-driven-story-writing/SKILL.md .claude/skills/reviewing-story-scenes/SKILL.md
grep -n 'analysis_scene_.*md' .claude/skills/reviewing-story-scenes/SKILL.md
```

Expected: authoring/orchestration/review paths all know the Analysis family; review discovery remains the HPA-561 implementation, not a duplicate rewrite.

Commit:

```bash
git add CLAUDE.md \
  .claude/skills/writing-chapter-manifest/SKILL.md \
  .claude/skills/subagent-driven-story-writing/SKILL.md \
  .claude/skills/reviewing-story-scenes/SKILL.md
git commit -m "docs: route analysis scenes through authoring skill"
```

---

### Task 3: Correct stale qualified-Analysis story-state guidance

**Files:**
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `.claude/skills/writing-interrogation-scene/SKILL.md`

**Interfaces:**
- Consumes: HPA-259 production qualified Analysis registry and existing authorization rules.
- Produces: accurate cross-scene guidance without changing runtime semantics.

- [ ] **Step 1: Replace the stale investigation synthetic-only paragraph**

Use this replacement:

```markdown
`question:<id> resolved` is global story state, not an investigation-local
predicate. Analysis references always use every shown slug segment; a bare
scene or board ID is invalid. Qualified Analysis scenes/boards are a production
compiler contract and must resolve to manifest-owned Analysis content. Only
author a completion predicate when the playable flow can really produce that
completion; when the narrative dependency is the conclusion itself, prefer the
Fact/Objective emitted by the Analysis board instead of coupling later content
to the workbench UI event.
```

Keep existing authorization restrictions unchanged.

- [ ] **Step 2: Replace the matching interrogation paragraph**

Use:

```markdown
Analysis predicates require the fully qualified slug segments shown above and
must resolve to manifest-owned Analysis content. They are part of the
production compiler contract; only use them when the playable flow can really
produce that completion. If the interrogation depends on the reasoning result
rather than the UI event, prefer the Fact/Objective emitted by the Analysis
board. This does not change the separate authorization rule below: an
institutional grant still needs its authored authority event.
```

- [ ] **Step 3: Verify the obsolete warnings are gone and authority text remains**

Run:

```bash
! grep -n 'synthetic fixture boundary' .claude/skills/writing-investigation-scene/SKILL.md .claude/skills/writing-interrogation-scene/SKILL.md
! grep -n 'no HPA-259 analysis registry' .claude/skills/writing-investigation-scene/SKILL.md .claude/skills/writing-interrogation-scene/SKILL.md
grep -n 'grant_authorization' .claude/skills/writing-investigation-scene/SKILL.md .claude/skills/writing-interrogation-scene/SKILL.md
```

Expected: stale synthetic-only wording is gone; authority restrictions remain.

- [ ] **Step 4: Commit the focused correction**

```bash
git add .claude/skills/writing-investigation-scene/SKILL.md .claude/skills/writing-interrogation-scene/SKILL.md
git commit -m "docs: sync qualified analysis authoring guidance"
```

---

### Task 4: Add the compiler-backed invalid Analysis example

**Files:**
- Create: `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/chapter.md`
- Create: `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/scene_0.md`
- Create: `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/chapter_1/analysis_scene_1.md`
- Create: `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/expected-error.txt`
- Test unchanged: `packages/scripts/compile-scenes.test.ts`

**Interfaces:**
- Consumes: existing invalid-fixture auto-discovery and parser `analysisBoardInvalidKind`.
- Produces: a named writer-facing invalid example with one intended compiler failure.

- [ ] **Step 1: Create a manifest with one valid playable scene before the invalid Analysis scene**

`chapter_1/chapter.md`:

```markdown
# Chapter 1: HPA-552 未建置分析板

**Summary:** 驗證 Analysis 作者不能使用未建置的板型。

## Scenes

1. scene_0.md
2. analysis_scene_1.md
```

- [ ] **Step 2: Create the tiny valid linear scene**

`chapter_1/scene_0.md`:

```markdown
# Scene 0: 前置確認

- **Summary:** 相馬先確認目前只使用已建置的分析板型。

[場景：測試用資料室。]

**相馬律**：先確認現有契約，再開始整理。
```

Purpose: keep `playableSceneCount > 0` after the Analysis parse fails, avoiding incidental `chapterNoPlayableScenes` noise.

- [ ] **Step 3: Create the intentionally unsupported Analysis scene**

`chapter_1/analysis_scene_1.md`:

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

The parser must fail at `Kind: route` before cards/result/outro are required.

- [ ] **Step 4: Add expected diagnostic**

`expected-error.txt`:

```text
analysisBoardInvalidKind
```

- [ ] **Step 5: Run the existing fixture runner**

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Expected: PASS including the new fixture. If manually inspecting formatted errors, the fixture should report `analysisBoardInvalidKind` without `chapterNoPlayableScenes`.

- [ ] **Step 6: Re-run the existing complete Chapter 1 Analysis fixture test**

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts -t 'compiles the complete analysis Chapter 1 corpus through qualified progression'
```

Expected: PASS.

- [ ] **Step 7: Commit the invalid example**

```bash
git add packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind
git commit -m "test: lock Chapter 1 analysis board families"
```

---

### Task 5: Validate the authoring contract end to end

**Files:**
- Verify all Tasks 1–4.
- Do not modify generated resources.

**Interfaces:**
- Consumes: complete HPA-552 implementation.
- Produces: acceptance evidence for the implementation PR/Linear issue.

- [ ] **Step 1: Compile the authored story tree**

```bash
bun run scenes:compile
```

Expected: successful compile with no HPA-552-related error.

- [ ] **Step 2: Run complete compiler/script tests**

```bash
bun run test:scripts
```

Expected: PASS, including valid Chapter 1 Analysis and the new invalid fixture.

- [ ] **Step 3: Type-check compiler scripts**

```bash
bun run check:scripts
```

Expected: PASS.

- [ ] **Step 4: Check formatting**

```bash
bun run format:check
```

Expected: PASS.

- [ ] **Step 5: Confirm no implementation layer escaped scope**

```bash
git diff --name-only origin/main...HEAD
```

Expected touched families only:

```text
.claude/skills/
CLAUDE.md
packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/
```

No `apps/game`, compiler production `.ts`, `packages/scene-types`, layout editor, generated JSON, or Chapter 2 content.

- [ ] **Step 6: Re-audit the skill against the post-HPA-561 compiler**

Read:

```bash
cat .claude/skills/writing-analysis-scene/SKILL.md
cat packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md
cat packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md
cat packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md
```

If the production HPA-561 tutorial exists, also inspect:

```bash
cat docs/stories_plan/chapter_1/analysis_scene_p1_5.md
```

Verify:

- classify/order/threshold only;
- `Fixed Anchors` is required and `[]` is documented;
- case-record provenance stays source-owned;
- tutorial-only `practice:`/Incorrect Selection guidance matches current compiler if present;
- scene-tag assets are documented accurately;
- normalized answer keys are not authored/generated by hand;
- `grant_authorization` remains forbidden; and
- the skill does not clone the full valid fixture.

- [ ] **Step 7: Record acceptance checklist in the implementation PR**

```text
[ ] Canonical valid Analysis fixture is compiler exercised.
[ ] Canonical invalid route-board fixture is compiler exercised.
[ ] Invalid fixture has no incidental chapterNoPlayableScenes diagnostic.
[ ] Skill covers classify/order/threshold only.
[ ] Fixed Anchors is documented as required; [] is the no-anchor form.
[ ] Scene-tag asset metadata is documented at the actual supported boundary.
[ ] Case-record provenance remains source-owned.
[ ] Post-HPA-561 practice/Incorrect Selection tutorial extension is documented narrowly if present.
[ ] Generated JSON remains compiler-owned.
[ ] CLAUDE/manifest/orchestrator/reviewer route Analysis to writing-analysis-scene.
[ ] HPA-561 review discovery/axes were preserved rather than reimplemented.
[ ] Stale synthetic-only qualified-Analysis wording is removed.
[ ] Analysis cannot self-grant narrow_lock_export.
[ ] bun run scenes:compile passes.
[ ] bun run test:scripts passes.
[ ] bun run check:scripts passes.
[ ] bun run format:check passes.
```

- [ ] **Step 8: Commit only formatting repair if required**

If formatting changed files:

```bash
bun run format
git add .claude/skills CLAUDE.md packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind
git commit -m "style: format analysis authoring contract"
```

Otherwise create no empty commit.

---

## Review Resolution Applied to This Plan

Accepted:

1. `Fixed Anchors` is required; `[]` is valid when nothing is pinned; non-empty entries are one-based and must agree with Accepted Order.
2. Keep the named end-to-end invalid fixture despite existing parser unit coverage.
3. Add a valid linear scene to the invalid fixture so manual compiler output is not polluted by `chapterNoPlayableScenes`.

Accepted with adjustment:

4. `reviewing-story-scenes` is a sixth touched guidance file only for the final link to the new skill. HPA-561 #44 already adds Analysis discovery and Axis 3/5 coverage; HPA-552 must preserve those changes rather than repeat them.

Rejected after source verification:

5. “Analysis has no authored asset fields.” Analysis Intro / Result Dialogue / Outro use the shared dialogue parser, whose scene tags consume visual/audio metadata; HPA-561's real `analysis_scene_p1_5.md` already authors a Background Prompt/asset cue. The skill documents that exact scene-tag boundary and forbids board-level asset metadata instead.

Additional post-#44 drift found while validating the review:

6. HPA-561 adds tutorial-only `practice:<id>` Analysis card sources and threshold `Incorrect Selection` blocks. Because this implementation intentionally rebases onto post-#44 `main`, the skill must mention those already-built Chapter 1 exceptions narrowly rather than falsely claiming all card sources are evidence/statement. They are not new HPA-552 features and must not leak into Beat 8.5 case-analysis provenance.

Everything else remains intentionally small: no parser/runtime changes, no new board families, no doc generator, no extra invalid cases, and no second review framework.
