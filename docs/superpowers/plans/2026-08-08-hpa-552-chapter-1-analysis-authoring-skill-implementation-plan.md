# HPA-552 Chapter 1 Analysis Authoring Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing `writing-analysis-scene` contract to the shipped Chapter 1 Classify/Order/Threshold stack and remove stale threshold-only capability claims from companion guidance.

**Architecture:** The dedicated Analysis skill is the single owner of board-kind details. Five companion docs route/delegate to that skill without copying its board-kind list. Verification dogfoods the updated skill in a temporary compiler root instead of adding a permanent docs-lint system.

**Tech Stack:** Markdown repo guidance, existing TypeScript scene compiler, Bun 1.3.1.

## Global Constraints

- Start implementation from current `main`.
- Modify existing guidance only; create no new skill or fixture.
- `writing-analysis-scene` alone enumerates supported board kinds.
- Do not add Chapter 2/later board kinds or a generic template/plugin registry.
- Do not modify compiler, Rust, Svelte, save/persistence, layout-editor, production Chapter 1 content, or `reviewing-story-scenes`.
- Preserve current Threshold practice-card / `Incorrect Selection` / provenance / asset-cue behavior.
- Preserve the Analysis authorization boundary: request readiness may be completed; `narrow_lock_export` is not granted by Analysis.
- Do not use negative prose regexes as correctness gates.
- Do not use Prettier/`format:check` as acceptance evidence for `.claude`/`docs`; the repo ignores those paths.

---

## File Map

### Modify

1. `.claude/skills/writing-analysis-scene/SKILL.md`
2. `CLAUDE.md`
3. `.claude/skills/writing-chapter-manifest/SKILL.md`
4. `.claude/skills/subagent-driven-story-writing/SKILL.md`
5. `.claude/skills/writing-investigation-scene/SKILL.md`
6. `.claude/skills/writing-interrogation-scene/SKILL.md`

### Reuse unchanged

- `packages/scripts/__fixtures__/analysis-chapter-1/`
- `packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/`
- `docs/stories_plan/chapter_1/analysis_scene_p1_5.md`
- `packages/scripts/compile-scenes/parser-analysis.ts`
- `packages/scripts/compile-scenes/validator-analysis.ts`

### Explicitly do not modify

- `.claude/skills/reviewing-story-scenes/SKILL.md`
- `packages/scripts/**`
- `apps/game/**`
- `docs/stories_plan/chapter_1/**`

---

### Task 1: Upgrade the dedicated Analysis authoring skill

**Files:**
- Modify: `.claude/skills/writing-analysis-scene/SKILL.md`
- Reference: current parser/validator and existing fixtures

**Interfaces:**
- Consumes: shipped HPA-561/HPA-260/HPA-261 behavior.
- Produces: the single writer-facing owner of Analysis board-kind details.

- [ ] **Step 1: Re-check the baseline before editing**

Run:

```bash
git fetch origin
git switch main
git pull --ff-only

grep -n 'classify\|order\|threshold' \
  packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md
grep -n 'analysisOrderAnchorNotPrefix' \
  packages/scripts/compile-scenes/validator-analysis.ts
```

Expected: current `main` still has the three-board fixture and the prefix-anchor validator. If either changed, update this plan to current code before changing prose.

- [ ] **Step 2: Replace the stale threshold-only capability statement and hierarchy**

Keep the existing skill and preserve its shared Analysis structure. Make the opening contract state that Chapter 1 Analysis supports the board kinds documented by this skill, then enumerate them here — and only here:

```text
classify
order
threshold
```

The hierarchy must include:

```text
## Intro
## Board: <label> {#board_id}
### Card: <label> {#card_id}
### Group: <label> {#group_id}      # classify only
### Incorrect Selection             # threshold only, optional
### Result Dialogue
## Outro
```

Remove only the obsolete claims that Classify/Order are parser-only, runtime-rejected, or non-shippable.

- [ ] **Step 3: Add Classify and current Order authoring rules; preserve Threshold**

Add/refresh these contracts:

**Classify**

- Group metadata is `Description` + `Accepted Cards`.
- Every displayed card belongs to exactly one accepted group.
- Writers author `Accepted Cards`, never normalized `acceptedGroupByCard`.

**Order**

- `Accepted Order` contains every displayed card exactly once.
- `Fixed Anchors` is required.
- `[]` means none.
- Non-empty entries use `<card_id>@<one-based-position>`.
- Anchors are unique/in-range, agree with `Accepted Order`, and occupy contiguous positions `1..N`.
- Reference `analysisOrderAnchorNotPrefix` and the existing invalid fixture.

**Threshold**

Keep the existing fields and semantics rather than rewriting them:

- source-owned provenance/source groups/proof capabilities;
- materialization limit;
- tutorial-only `practice:<id>` immediate binding/no-mixing rules;
- optional exact `### Incorrect Selection` feedback.

- [ ] **Step 4: Refresh completion, authorization, asset, workflow, and orchestrator-handoff guidance**

Keep fully qualified Analysis completion syntax and remove threshold-specific runtime qualification.

Keep:

- Facts/Objectives preferred when later narrative logic depends on a conclusion rather than UI completion;
- `grant_authorization` forbidden on Analysis boards;
- Beat 8.5 prepares `prepare_narrow_lock_request` but does not grant `narrow_lock_export`;
- Intro / Result Dialogue / Outro as the only Analysis dialogue-carrier asset-cue locations;
- no filesystem paths.

Add one compact **orchestrator handoff** subsection so `subagent-driven-story-writing` does not need to duplicate kind-specific fields. It should tell an orchestrator to provide the writer with:

- board/card/group IDs as applicable;
- card source IDs and source-owner paths;
- authored board order/unlock chain;
- story outputs and request-vs-authorization boundary;
- source provenance expectations when Threshold uses them;
- tutorial practice-card binding details when applicable.

The dedicated skill then owns the kind-specific metadata syntax.

- [ ] **Step 5: Read the completed skill once as prose and commit**

Manually verify that:

- Classify/Order are no longer described as unsupported;
- legitimate phrases such as "Incorrect Selection is threshold only" remain intact;
- Classify, Order, Threshold, practice cards, story outputs, and asset cues do not contradict each other;
- normalized answers are not presented as writer-authored fields.

Commit:

```bash
git add .claude/skills/writing-analysis-scene/SKILL.md
git commit -m "docs: align analysis authoring with three-board runtime"
```

---

### Task 2: Make companion guidance delegate to the Analysis skill

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/skills/writing-chapter-manifest/SKILL.md`
- Modify: `.claude/skills/subagent-driven-story-writing/SKILL.md`
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `.claude/skills/writing-interrogation-scene/SKILL.md`

**Interfaces:**
- Consumes: Task 1's dedicated skill.
- Produces: routing/cross-scene guidance that cannot drift merely because the board-kind list changes later.

- [ ] **Step 1: Remove duplicated board-kind enumeration from routing docs**

In `CLAUDE.md`, keep the Analysis scene-family bullet but delegate its board contract:

```markdown
- `analysis_scene_<K>.md` - compiler-validated Analysis workbench scenes.
  Authored via `writing-analysis-scene`, which owns the supported board kinds
  and kind-specific authoring contract.
```

In `writing-chapter-manifest`, make the Analysis row equivalent to:

```markdown
| `analysis_scene_<K>.md` | Compiler-validated Analysis scene; board contract is owned by `writing-analysis-scene` |
```

Do not list the board kinds in either file.

- [ ] **Step 2: Shrink the orchestrator's Analysis brief to ownership, not schema**

Keep Analysis dispatch to `writing-analysis-scene`.

Replace the old threshold-only block with a compact rule:

- orchestrator owns IDs, source IDs/source-owner paths, authored board sequence/unlocks, story outputs, and request-vs-authorization boundary;
- writer invokes `writing-analysis-scene` for the supported board-kind list and kind-specific fields;
- practice-card binding details are provided when the scene uses practice cards;
- provenance stays on source records;
- Analysis dialogue-carrier asset cues follow the dedicated skill.

Do not duplicate Classify/Order/Threshold field lists here.

- [ ] **Step 3: Remove threshold-only capability claims from investigation/interrogation**

Preserve the existing qualified predicate examples.

Use wording equivalent to:

```text
Qualified Analysis predicates may reference any packaged Analysis board
supported by the current writing-analysis-scene/runtime contract whose full
scene/board id resolves in the compiled story catalog.
```

Keep the recommendation to prefer Fact/Objective state for semantic conclusions and keep the separate authority-event restriction unchanged.

Do not enumerate board kinds in these two skills.

- [ ] **Step 4: Read all five companion files once and commit**

Read the changed paragraphs in context. Confirm semantically that:

- none claims Analysis runtime/frontend is threshold-only;
- all board-kind detail delegates to `writing-analysis-scene`;
- the orchestrator still passes enough IDs/sources/outputs for a cold writer;
- investigation/interrogation allow qualified completion from any currently supported packaged Analysis board;
- `reviewing-story-scenes` has no diff.

Run:

```bash
git diff -- .claude/skills/reviewing-story-scenes/SKILL.md
```

Expected: empty.

Commit:

```bash
git add \
  CLAUDE.md \
  .claude/skills/writing-chapter-manifest/SKILL.md \
  .claude/skills/subagent-driven-story-writing/SKILL.md \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md

git commit -m "docs: delegate analysis board contract to dedicated skill"
```

---

### Task 3: Dogfood the authoring contract and perform final scope review

**Files:**
- Verify: the six modified guidance files.
- Temporary only: a copied compiler fixture root under `mktemp`; commit nothing from it.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: evidence that a writer can follow the updated skill, plus one cheap production compile smoke.

- [ ] **Step 1: Fresh-verifier dogfood compile, then deliberately break Order anchors**

Create a temporary corpus from the existing fixture, then remove its Analysis scene:

```bash
DOGFOOD="$(mktemp -d)"
mkdir -p "$DOGFOOD/source"
cp -R packages/scripts/__fixtures__/analysis-chapter-1/. "$DOGFOOD/source/"
rm "$DOGFOOD/source/chapter_1/analysis_scene_8_5.md"
```

Use a **fresh verifier context** if the execution environment supports one. Give it only:

- the updated `.claude/skills/writing-analysis-scene/SKILL.md` as the Analysis format guide;
- `$DOGFOOD/source/chapter_1/chapter.md`;
- the copied investigation source files and `story_catalog.md` for available IDs/provenance.

Do **not** give the verifier the canonical `analysis_scene_8_5.md`.

Have it author `$DOGFOOD/source/chapter_1/analysis_scene_8_5.md` with one valid board of each kind. For the Order board require exactly these scene-local card IDs:

```text
order_a
order_b
order_c
```

and:

```text
Accepted Order: [order_a, order_b, order_c]
Fixed Anchors: []
```

The verifier may choose any three obtainable copied evidence/statement sources for those cards and may use neutral/satisfiable Threshold requirements based on the copied provenance.

Compile the temporary corpus through the existing exported compiler seam:

```bash
DOGFOOD="$DOGFOOD" bun -e '
import { compile } from "./packages/scripts/compile-scenes/orchestrator.ts";
const root = process.env.DOGFOOD;
if (!root) process.exit(2);
const result = compile({ sourceRoot: `${root}/source`, outputRoot: `${root}/out` });
if (!result.ok) {
  console.error(result.errors.map((e) => `${e.code}: ${e.message}`).join("\n"));
  process.exit(1);
}
'
```

Expected: exit 0.

Now make only the Order anchor invalid:

```bash
perl -0pi -e 's/- \*\*Fixed Anchors:\*\* \[\]/- **Fixed Anchors:** [order_c@3]/' \
  "$DOGFOOD/source/chapter_1/analysis_scene_8_5.md"

DOGFOOD="$DOGFOOD" bun -e '
import { compile } from "./packages/scripts/compile-scenes/orchestrator.ts";
const root = process.env.DOGFOOD;
if (!root) process.exit(2);
const result = compile({ sourceRoot: `${root}/source`, outputRoot: `${root}/out-bad` });
if (result.ok || !result.errors.some((e) => e.code === "analysisOrderAnchorNotPrefix")) {
  console.error(result.ok ? "unexpected success" : result.errors.map((e) => e.code).join("\n"));
  process.exit(1);
}
'
```

Expected: exit 0 because the compile fails specifically with `analysisOrderAnchorNotPrefix`.

Delete the temporary root afterward. Commit none of it.

- [ ] **Step 2: Run one cheap production story smoke**

Run:

```bash
bun run scenes:compile
```

Expected: PASS. Treat this only as confirmation that the current authored story tree still compiles; it is not evidence that the guidance prose is correct.

- [ ] **Step 3: Final prose/scope review**

Read the six deliverables once together and verify:

```text
[ ] writing-analysis-scene is the only file that enumerates supported board kinds.
[ ] It documents Classify, Order, and Threshold accurately.
[ ] Order documents required Fixed Anchors, [] and the contiguous-prefix rule.
[ ] Threshold practice/Incorrect Selection/provenance behavior remains intact.
[ ] Companion guidance delegates board-kind details to writing-analysis-scene.
[ ] No companion file claims threshold-only Analysis support.
[ ] Investigation/interrogation accept qualified completion from any currently supported packaged Analysis board.
[ ] Analysis still cannot grant narrow_lock_export.
[ ] reviewing-story-scenes is untouched.
```

Then verify the implementation diff is limited to the six guidance files (plus these planning docs only if implementation was intentionally done on the planning branch):

```bash
git diff --name-only origin/main...HEAD
```

If a final prose repair is needed, commit only that repair. Do not create an empty final commit.

---

## Stop Conditions

Do not expand HPA-552 into:

- a docs-lint or prose-regex framework;
- a Prettier override for ignored `.claude`/`docs` files;
- a new compiler fixture;
- a schema/doc generator;
- runtime/frontend/compiler changes;
- `reviewing-story-scenes` changes already owned by HPA-561;
- production Beat 8.5 authoring; or
- future board kinds.

## Handoff

- HPA-262: integrated real three-board packaged acceptance.
- HPA-265: real Beat 8.5 authoring/iteration.
- HPA-264: hearing-granted `narrow_lock_export`.
- HPA-263: optional post-playtest feedback/hint polish.
