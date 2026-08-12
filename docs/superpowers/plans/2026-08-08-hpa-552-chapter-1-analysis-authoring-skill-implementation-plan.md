# HPA-552 Chapter 1 Analysis Scene Authoring Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing threshold-only `writing-analysis-scene` guidance to the already-shipped Chapter 1 `classify` / `order` / `threshold` contract, then remove stale threshold-only claims from companion repo guidance.

**Architecture:** HPA-561 already created the Analysis skill/routing/tutorial surface; HPA-260 and HPA-261 already shipped the three-board runtime/workbench. HPA-552 is therefore a docs-only contract-correction pass: edit six existing guidance files, reuse the existing valid and invalid compiler fixtures, and make no compiler/runtime/frontend/content changes.

**Tech Stack:** Markdown repo skills/guidance, existing TypeScript compiler fixtures, Vitest, Bun 1.3.1.

## Global Constraints

- Start implementation from current `main`, not the historical planning branch baseline.
- Document exactly the current Chapter 1 board families: `classify`, `order`, `threshold`.
- Do not add `compare`, `route`, `chain`, freeform boards, plugin registries, or future template abstractions.
- Do not create a second Analysis skill; modify `.claude/skills/writing-analysis-scene/SKILL.md` in place.
- Do not modify compiler, Rust runtime, Svelte workbench, save/persistence, layout-editor, or production Beat 8.5 content.
- Do not add a new HPA-552 invalid fixture; reuse `packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/`.
- Preserve HPA-561's tutorial-only `practice:<id>` and threshold `### Incorrect Selection` guidance.
- Preserve Analysis dialogue-carrier asset-cue rules for Intro / Result Dialogue / Outro; do not invent board-level asset metadata.
- Case-analysis cards reference existing evidence/statements; their provenance remains source-owned.
- Authors declare semantic solution intent; compiler-normalized answers remain out of answer-key-free public/shared runtime views.
- Analysis boards may complete `prepare_narrow_lock_request` but must not grant `narrow_lock_export`.
- `Fixed Anchors` is required on Order boards; `[]` means none; non-empty anchors must occupy a contiguous prefix from position 1.
- `reviewing-story-scenes` is already current after HPA-561 and is not an HPA-552 edit unless a fresh baseline audit proves otherwise.

---

## File Map

### Modify

- `.claude/skills/writing-analysis-scene/SKILL.md` — expand existing threshold-only authoring contract to all three Chapter 1 board kinds.
- `CLAUDE.md` — remove threshold-only capability wording from the existing Analysis routing bullet.
- `.claude/skills/writing-chapter-manifest/SKILL.md` — remove threshold-only capability wording from the existing Analysis row.
- `.claude/skills/subagent-driven-story-writing/SKILL.md` — replace the threshold-only Analysis brief with compact Classify/Order/Threshold inputs.
- `.claude/skills/writing-investigation-scene/SKILL.md` — remove the obsolete “Analysis runtime is threshold-only” qualification from cross-scene predicate guidance.
- `.claude/skills/writing-interrogation-scene/SKILL.md` — same focused correction.

### Reuse unchanged

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md` — canonical valid three-board case-analysis example.
- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md` — canonical case-record/provenance sources.
- `packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md` — canonical story/source-group declarations.
- `docs/stories_plan/chapter_1/analysis_scene_p1_5.md` — production tutorial example for `practice:<id>`, `Incorrect Selection`, and Analysis scene-tag asset cues.
- `packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/` — canonical invalid writer example.
- `packages/scripts/compile-scenes/parser-analysis.ts` — syntax authority.
- `packages/scripts/compile-scenes/validator-analysis.ts` — semantic/normalization authority, including `analysisOrderAnchorNotPrefix`.

### Explicitly do not modify

- `.claude/skills/reviewing-story-scenes/SKILL.md`
- `packages/scripts/__fixtures__/**`
- `packages/scripts/compile-scenes/**/*.ts`
- `apps/game/**`
- `docs/stories_plan/chapter_1/analysis_scene_8_5.md`

---

### Task 1: Upgrade the existing Analysis authoring skill to all three shipped board kinds

**Files:**
- Modify: `.claude/skills/writing-analysis-scene/SKILL.md`
- Reference: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- Reference: `packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/chapter_1/analysis_scene_8_5.md`
- Reference: `docs/stories_plan/chapter_1/analysis_scene_p1_5.md`

**Interfaces:**
- Consumes: current parser/validator contract and HPA-561 tutorial/asset guidance already present in the skill.
- Produces: one accurate authoring contract for current playable Chapter 1 Analysis content.

- [ ] **Step 1: Confirm the implementation baseline contains the shipped three-board stack**

Run:

```bash
git fetch origin
git switch main
git pull --ff-only

git log -8 --oneline
grep -n 'writing-analysis-scene' CLAUDE.md
grep -n 'classify\|order\|threshold' packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md
grep -n 'analysisOrderAnchorNotPrefix' packages/scripts/compile-scenes/validator-analysis.ts
```

Expected:

- current main contains the merged HPA-260/HPA-261 work;
- the canonical valid fixture contains all three board kinds; and
- `analysisOrderAnchorNotPrefix` exists in the validator.

If the baseline has moved again, inspect current code/fixtures and correct this plan before editing prose. Do not restore an obsolete threshold-only contract merely because it appears in historical planning docs.

- [ ] **Step 2: Replace the skill's threshold-only frontmatter/role/runtime boundary**

Keep the skill name and existing file. Replace wording that says the skill is threshold-only or that Classify/Order are parser-only.

The opening contract should communicate this substance:

```markdown
---
name: writing-analysis-scene
description: Use when writing or extending an analysis_scene_<K>.md file under a playable chapter root. Covers the compiler/runtime-supported Chapter 1 classify, order, and threshold boards, including Case File cards, tutorial-only practice cards, result dialogue, story reveals, and supported scene-tag asset cues.
---

# Writing Analysis Scenes (《東京雨證：第零證人》)

## Role

You author compiler-validated `analysis_scene_<K>.md` files. Chapter 1 supports
three playable board kinds: `classify`, `order`, and `threshold`.

The compiler is the syntax and semantic authority. Rust owns correctness and
durable state; the frontend renders the answer-key-free public view. This skill
owns writer intent and valid authored forms only.
```

Remove any statement equivalent to:

```text
runtime loader accepts threshold only
classify/order are parser-only
Do not author classify/order
```

Preserve the existing explanation that Analysis consumes case records rather than declaring an Evidence/Statement Manifest.

- [ ] **Step 3: Expand the structural hierarchy and common board model**

The hierarchy section must include all currently valid H3 blocks:

```text
H1  # Scene N: <title>
    - **Summary:** <one-sentence player recap>
H2  ## Intro
H2  ## Board: <label> {#board_id}
H3      ### Card: <label> {#card_id}
H3      ### Group: <label> {#group_id}          # classify only
H3      ### Incorrect Selection                 # threshold only, optional
H3      ### Result Dialogue
H2  ## Outro
```

Keep the current common Board fields:

```text
Kind
Prompt
Reveals
Incomplete Feedback
Incorrect Feedback
Unlock          # optional
Hint            # optional
```

Do not make kind-specific metadata appear universal.

- [ ] **Step 4: Add a Classify section based on the live compiler fixture**

Document:

```markdown
## Classify board

Use `classify` when each displayed record must be assigned to exactly one
reasoning package.

Each `### Group:` has:

- `Description`
- `Accepted Cards`

Every displayed card must occur in exactly one accepted group. The writer
authors `Accepted Cards`; the compiler normalizes that intent into the hidden
runtime answer map. Do not author `acceptedGroupByCard`.
```

Point to the canonical `evidence_packages` board in:

`packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`.

Do not copy the whole scene into the skill.

- [ ] **Step 5: Add the exact current Order contract, including prefix anchors**

Document:

```markdown
## Order board

Use `order` for one exact sequence.

Required board metadata:

- `Accepted Order`
- `Fixed Anchors`

`Accepted Order` names every displayed card exactly once.

`Fixed Anchors` is required. Use `[]` when nothing is pinned. Non-empty entries
use `<card_id>@<one-based-position>`, must be unique/in range, and must agree
with `Accepted Order`.

Non-empty fixed anchors must occupy a contiguous prefix beginning at position 1:

- `[]` — valid
- `[event_1841@1]` — valid
- `[event_1841@1, event_1842@2]` — valid
- `[event_1843@3]` — invalid (`analysisOrderAnchorNotPrefix`)
```

Point writers to:

- valid: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`;
- invalid: `packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/`.

Do not invent sparse-anchor UI support; the compiler rule intentionally matches the current workbench.

- [ ] **Step 6: Preserve and retitle the existing Threshold contract rather than rewriting it**

Keep the current fields and semantics:

```text
Eligible Cards
Minimum Selected
Minimum Distinct Source Groups
Required Proof Capabilities
Allowed Procedural Statuses
Require Source Group
```

Preserve:

- current eligible-card materialization hard limit;
- Case File provenance/source-group semantics;
- all-practice neutral provenance requirements;
- practice-vs-Case-File no-mixing rule; and
- optional `### Incorrect Selection` exact wrong-subset feedback.

Make clear that `Incorrect Selection` is threshold-only and does not replace `Incorrect Feedback`.

- [ ] **Step 7: Preserve the current tutorial-only practice binding exactly**

Do not broaden `practice:<id>` into normal case-analysis data.

Retain the current chapter-scoped binding contract:

- each practice source belongs to one Analysis card/board in the chapter;
- it is revealed by the immediately preceding investigation;
- the Analysis scene immediately follows that investigation in the manifest;
- all-practice thresholds use neutral provenance requirements; and
- practice and Case File cards are not mixed in a threshold eligible set.

The P1 production tutorial remains the canonical practice example:

`docs/stories_plan/chapter_1/analysis_scene_p1_5.md`.

- [ ] **Step 8: Update story-completion language to the current runtime**

Preserve fully qualified syntax:

```text
analysis_scene:<chapter_id>@<scene_id> completed
analysis_board:<chapter_id>@<scene_id>@<board_id> completed
```

Remove any threshold-only qualifier. State that Classify, Order, and Threshold boards can all produce qualified completion when packaged and completed.

Keep the narrative recommendation:

> Prefer an emitted Fact/Objective when later content depends on the earned conclusion rather than the UI-completion event itself.

Keep `grant_authorization:<id>` forbidden on Analysis boards and keep Beat 8.5 limited to request readiness.

- [ ] **Step 9: Preserve Analysis asset-cue guidance and keep its boundary exact**

Keep the existing HPA-561 rule:

- Intro, Result Dialogue, and Outro are dialogue carriers;
- `[場景：...]` may carry current supported visual/audio metadata when assets are enabled;
- Board/Card/Group/Incorrect Selection metadata itself has no background cue;
- no filesystem paths.

Do not replace this with “Analysis has no assets”; that is false on current main.

- [ ] **Step 10: Refresh Workflow, Self-check, and Common Mistakes for all three kinds**

The final self-check must include at least:

```text
- Board Kind is classify/order/threshold only.
- Every real case card references an obtainable evidence/statement record.
- Every classify card is accepted by exactly one group.
- Every order card appears exactly once in Accepted Order.
- Fixed Anchors exists; [] means none; non-empty anchors are a contiguous prefix from 1 and agree with Accepted Order.
- Threshold provenance stays source-owned and has at least one accepted selection.
- Practice cards remain tutorial-local and obey immediate binding/no-mixing rules.
- Qualified Analysis refs are fully qualified/resolved.
- No grant_authorization from Analysis.
- Supported asset metadata appears on scene-tag dialogue carriers, not board metadata.
- Generated JSON and filesystem paths remain untouched.
```

Add/refresh Common Mistakes rows for:

- treating Classify/Order as unsupported;
- sparse Order anchors;
- authoring normalized answer keys;
- putting provenance on cards;
- using practice cards in real Beat 8.5 case analysis; and
- putting background metadata directly on a board.

- [ ] **Step 11: Source-scan the upgraded skill before commit**

Run:

```bash
grep -n 'classify\|order\|threshold' .claude/skills/writing-analysis-scene/SKILL.md
grep -n 'analysisOrderAnchorNotPrefix\|contiguous prefix' .claude/skills/writing-analysis-scene/SKILL.md
grep -n 'practice:' .claude/skills/writing-analysis-scene/SKILL.md
grep -n 'Incorrect Selection' .claude/skills/writing-analysis-scene/SKILL.md
grep -n 'Background Prompt\|Background Asset ID' .claude/skills/writing-analysis-scene/SKILL.md

! grep -Ei 'threshold[- ]only|parser[- ]only|runtime loader .*reject.*classify|do not author .*classify.*order' \
  .claude/skills/writing-analysis-scene/SKILL.md
```

Expected: the positive searches find the intended contracts and the obsolete-claim search returns no match.

- [ ] **Step 12: Format-check and commit Task 1**

Run:

```bash
bunx prettier .claude/skills/writing-analysis-scene/SKILL.md --check
```

Expected: PASS.

Commit:

```bash
git add .claude/skills/writing-analysis-scene/SKILL.md
git commit -m "docs: expand analysis authoring to three board kinds"
```

---

### Task 2: Remove stale threshold-only wording from companion guidance

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/skills/writing-chapter-manifest/SKILL.md`
- Modify: `.claude/skills/subagent-driven-story-writing/SKILL.md`
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `.claude/skills/writing-interrogation-scene/SKILL.md`

**Interfaces:**
- Consumes: upgraded `writing-analysis-scene` from Task 1.
- Produces: consistent routing and cross-scene guidance that no longer contradicts the shipped runtime/workbench.

- [ ] **Step 1: Update the existing `CLAUDE.md` Analysis bullet only**

Replace the current threshold-only capability wording with:

```markdown
  - `analysis_scene_<K>.md` - compiler-validated Analysis workbench scenes using
    the Chapter 1 `classify`, `order`, and `threshold` board kinds. Authored via
    `writing-analysis-scene`.
```

Do not restructure Project domain or add new routing concepts.

- [ ] **Step 2: Update the existing chapter-manifest Analysis row only**

Use:

```markdown
| `analysis_scene_<K>.md` | Compiler-validated Analysis workbench (`classify`, `order`, `threshold`; uses `writing-analysis-scene`) |
```

Do not add a manifest `type` field or new prefix.

- [ ] **Step 3: Replace the Analysis-specific threshold-only brief in `subagent-driven-story-writing`**

Keep the existing scene mapping and dispatch. Replace only the Analysis-specific brief block with compact kind-specific inputs equivalent to:

```markdown
- **For Analysis scenes:** the orchestrator owns exact board/card/group IDs,
  card source IDs and source-owner paths, board order/unlock chain, story
  outputs, and any request-vs-authorization boundary. For each board specify:
  - `classify`: cards, groups, each group's `Accepted Cards`;
  - `order`: cards, `Accepted Order`, and required `Fixed Anchors` (`[]` if
    none; non-empty anchors form a contiguous prefix from position 1);
  - `threshold`: eligible cards and the provenance/procedure/capability
    requirements, plus any deliberate exact `Incorrect Selection` feedback.
  The writer invokes `writing-analysis-scene`; do not duplicate provenance on
  cards or invent unsupported board families. Preserve the existing tutorial
  practice-card immediate-binding/no-mixing rules and Analysis dialogue-carrier
  asset-cue rules.
```

Do not copy all parser fields from the dedicated skill.

- [ ] **Step 4: Remove the threshold-only runtime qualifier from investigation guidance**

Keep the existing fully qualified examples and story unlock semantics.

Replace wording equivalent to:

```text
Use threshold-only runtime-valid references...
runtime loader accepts only threshold...
```

with:

```markdown
Qualified Analysis predicates may reference any packaged Chapter 1 Analysis
board (`classify`, `order`, or `threshold`) whose full scene/board id resolves in
the compiled story catalog. The runtime evaluates all three through the shared
story unlock context. Use a Fact/Objective instead when the narrative dependency
is the earned conclusion rather than completion of the workbench UI.
```

Keep the separate `grant_authorization` / authority-event warning unchanged.

- [ ] **Step 5: Apply the matching focused correction to interrogation guidance**

Use the same capability statement, preserving interrogation-specific surrounding prose and the separate authorization restriction.

Do not rewrite the interrogation skill generally.

- [ ] **Step 6: Verify no companion surface still advertises threshold-only Analysis**

Run:

```bash
grep -n 'analysis_scene_<K>\|writing-analysis-scene' \
  CLAUDE.md \
  .claude/skills/writing-chapter-manifest/SKILL.md \
  .claude/skills/subagent-driven-story-writing/SKILL.md

grep -n 'analysis_scene:\|analysis_board:' \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md

! grep -Ei 'threshold[- ]only|runtime loader .*reject.*classify|do not brief .*classify.*order|parser/compiler retain .*classify.*order' \
  CLAUDE.md \
  .claude/skills/writing-chapter-manifest/SKILL.md \
  .claude/skills/subagent-driven-story-writing/SKILL.md \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md
```

Expected: routing/ref searches succeed and obsolete-claim search returns no match.

- [ ] **Step 7: Verify `reviewing-story-scenes` remains intentionally untouched and current**

Run:

```bash
grep -n 'analysis_scene_.*md' .claude/skills/reviewing-story-scenes/SKILL.md
grep -n 'writing-analysis-scene' .claude/skills/reviewing-story-scenes/SKILL.md
git diff -- .claude/skills/reviewing-story-scenes/SKILL.md
```

Expected:

- existing Analysis discovery/reference lines are present;
- diff is empty.

- [ ] **Step 8: Format-check and commit Task 2**

Run:

```bash
bunx prettier \
  CLAUDE.md \
  .claude/skills/writing-chapter-manifest/SKILL.md \
  .claude/skills/subagent-driven-story-writing/SKILL.md \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md \
  --check
```

Expected: PASS.

Commit:

```bash
git add \
  CLAUDE.md \
  .claude/skills/writing-chapter-manifest/SKILL.md \
  .claude/skills/subagent-driven-story-writing/SKILL.md \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md

git commit -m "docs: sync three-board analysis authoring guidance"
```

---

### Task 3: Validate the docs-only contract against existing compiler fixtures

**Files:**
- Verify all six modified guidance files.
- Reuse existing compiler fixtures; create no new fixture.

**Interfaces:**
- Consumes: Task 1–2 guidance changes and already-shipped compiler/runtime contracts.
- Produces: HPA-552 acceptance evidence without duplicating HPA-262 integration work.

- [ ] **Step 1: Prove the existing valid three-board fixture still compiles**

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts -t 'compiles the complete analysis Chapter 1 corpus through qualified progression'
```

If test-name filtering differs on the installed Vitest version, run:

```bash
bun run test:scripts
```

Expected: PASS; the valid fixture still contains Classify, Order, and Threshold boards.

- [ ] **Step 2: Prove the existing invalid prefix-anchor fixture is still exercised**

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Expected: PASS including automatic invalid-fixture discovery for:

```text
analysis-order-anchor-not-prefix
```

whose expected diagnostic is:

```text
analysisOrderAnchorNotPrefix
```

Do not add a second HPA-552 invalid fixture merely to test unsupported `route`; the current invalid fixture is more directly useful to an Order writer and already satisfies the compiler-exercised-invalid-example acceptance criterion.

- [ ] **Step 3: Compile the production authored story tree**

Run:

```bash
bun run scenes:compile
```

Expected: successful compile. Generated resources remain generated/untracked.

- [ ] **Step 4: Type-check compiler/tooling contracts**

Run:

```bash
bun run check:scripts
```

Expected: PASS.

- [ ] **Step 5: Run repository formatting check**

Run:

```bash
bun run format:check
```

Expected: PASS.

If formatting fails only in touched guidance, run the repo formatter, inspect the diff, and commit only the formatter's changes to those six files.

- [ ] **Step 6: Run the final stale-contract scan across the six HPA-552 surfaces**

Run:

```bash
! grep -Ei 'threshold[- ]only|parser[- ]only|runtime loader .*reject.*classify|do not author .*classify.*order|do not brief .*classify.*order' \
  .claude/skills/writing-analysis-scene/SKILL.md \
  CLAUDE.md \
  .claude/skills/writing-chapter-manifest/SKILL.md \
  .claude/skills/subagent-driven-story-writing/SKILL.md \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md
```

Expected: exit 0 with no obsolete match.

Then confirm all three names are present in the dedicated skill:

```bash
grep -n 'classify' .claude/skills/writing-analysis-scene/SKILL.md
grep -n 'order' .claude/skills/writing-analysis-scene/SKILL.md
grep -n 'threshold' .claude/skills/writing-analysis-scene/SKILL.md
```

- [ ] **Step 7: Prove the implementation diff stayed docs-only and minimal**

Run:

```bash
git diff --name-only origin/main...HEAD
```

Expected implementation file set:

```text
.claude/skills/writing-analysis-scene/SKILL.md
.claude/skills/subagent-driven-story-writing/SKILL.md
.claude/skills/writing-chapter-manifest/SKILL.md
.claude/skills/writing-interrogation-scene/SKILL.md
.claude/skills/writing-investigation-scene/SKILL.md
CLAUDE.md
```

If implementing from a branch that also contains the approved HPA-552 design/plan docs, those two planning documents may additionally appear. No compiler fixture, TypeScript compiler source, Rust, Svelte, generated resource, or production story content should appear.

- [ ] **Step 8: Self-review against HPA-552 acceptance criteria**

Record this checklist in the implementation PR:

```text
[ ] Existing writing-analysis-scene skill now documents Classify/Order/Threshold as playable Chapter 1 content.
[ ] Canonical valid three-board fixture is referenced and compiler exercised.
[ ] Existing analysis-order-anchor-not-prefix invalid fixture is referenced and compiler exercised.
[ ] Fixed Anchors requires [] or a contiguous one-based prefix and agrees with Accepted Order.
[ ] Existing P1 practice-card / Incorrect Selection / asset-cue guidance is preserved.
[ ] Real Case File provenance remains source-owned.
[ ] Generated/normalized answers remain compiler/runtime-owned and answer-key-free public views remain untouched.
[ ] CLAUDE/chapter-manifest/orchestrator/investigation/interrogation contain no stale threshold-only Analysis claim.
[ ] reviewing-story-scenes required no HPA-552 modification.
[ ] Analysis still cannot grant narrow_lock_export.
[ ] bun run test:scripts passes.
[ ] bun run scenes:compile passes.
[ ] bun run check:scripts passes.
[ ] bun run format:check passes.
```

- [ ] **Step 9: Commit any final documentation-only repair if needed**

If Steps 1–8 required a final correction:

```bash
git add \
  .claude/skills/writing-analysis-scene/SKILL.md \
  .claude/skills/subagent-driven-story-writing/SKILL.md \
  .claude/skills/writing-chapter-manifest/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md \
  .claude/skills/writing-investigation-scene/SKILL.md \
  CLAUDE.md

git commit -m "docs: align analysis authoring contract with current main"
```

If no repair was needed, do not create an empty commit.

---

## Implementation Review Notes

### Keep HPA-552 smaller than its historical plan

Reject implementation scope that adds:

- a second Analysis authoring skill;
- a new `route` invalid fixture;
- changes to `reviewing-story-scenes` that duplicate HPA-561;
- parser/runtime/frontend behavior to make docs convenient;
- a schema/doc generator;
- a generic Analysis renderer/template registry;
- production Beat 8.5 content;
- Chapter 2/later board kinds; or
- new answer-key/public-view structures.

Those would be solving work already owned by HPA-259/HPA-260/HPA-261/HPA-262/HPA-265 or inventing future needs.

### Handoff after HPA-552

- HPA-262 proves the actual packaged three-board cross-layer path.
- HPA-265 authors and iterates the real Beat 8.5 scene against this corrected skill.
- HPA-264 owns the hearing-granted `narrow_lock_export` authority handoff.
- HPA-263 remains optional post-playtest feedback/hint polish.

If HPA-265 discovers a genuine authoring mismatch, correct the skill to the compiler/canon. Do not add compatibility syntax or preserve an obsolete HPA-552 assumption.