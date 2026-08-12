# HPA-552 Chapter 1 Analysis Scene Authoring Skill Design

**Status:** Proposed — refreshed against current `main` after HPA-561, HPA-260, and HPA-261  
**Linear:** HPA-552 — Add the analysis-scene authoring skill for Chapter 1 writers  
**Scope:** Authoring-contract correction only; no compiler/runtime/frontend/save/layout-editor/content implementation

## 1. Summary

HPA-552 no longer needs to **create** an Analysis authoring skill.

HPA-561 already added `.claude/skills/writing-analysis-scene/SKILL.md`, wired `analysis_scene_<K>.md` into repo authoring/review guidance, added the production P1 threshold tutorial, and documented practice-card / exact wrong-selection / Analysis asset-cue behavior.

After that, HPA-260 and HPA-261 completed the generic Chapter 1 runtime and workbench for all three compiler-supported board kinds:

```text
classify
order
threshold
```

The existing skill and several companion guidance files still describe `classify` and `order` as parser-only / non-shippable. That is now the real HPA-552 defect.

Implement HPA-552 as a **small in-place upgrade of the existing threshold-only skill to the current three-board Chapter 1 contract**, plus narrow removal of stale threshold-only wording in five companion guidance files.

Do not add another skill, another invalid fixture, another review system, or any compiler/runtime/frontend behavior.

---

## 2. Current repository baseline

### 2.1 HPA-561 already supplied the first Analysis skill

Current `main` already contains:

- `.claude/skills/writing-analysis-scene/SKILL.md`;
- `analysis_scene_<K>.md` routing in `CLAUDE.md`;
- Analysis scene inference in `writing-chapter-manifest`;
- Analysis dispatch in `subagent-driven-story-writing`;
- Analysis discovery and semantic-review coverage in `reviewing-story-scenes`;
- qualified Analysis predicate guidance in investigation/interrogation skills;
- the production P1 tutorial `docs/stories_plan/chapter_1/analysis_scene_p1_5.md`;
- tutorial-only `practice:<id>` cards;
- threshold `### Incorrect Selection` feedback; and
- Analysis Intro / Result Dialogue / Outro asset-cue support.

HPA-552 must preserve those contracts rather than reimplement them.

### 2.2 HPA-260 made all three board kinds real runtime content

The current Rust Analysis runtime owns:

- `classify`, `order`, and `threshold` mutable drafts;
- direct compiler-normalized answer evaluation;
- qualified scene/board completion;
- story outputs exactly once;
- board availability and active-board selection;
- completed-board read-only reopening;
- stale-action fencing;
- exact save/restore; and
- answer-key-free public views.

Therefore the old sentence “runtime loader accepts threshold only” is obsolete.

### 2.3 HPA-261 made all three board kinds playable in the workbench

The current frontend exposes focused Classify, Order, and Threshold components on the Rust-owned public contract.

HPA-261 also tightened the authored Order contract:

> Non-empty `Fixed Anchors` must occupy a contiguous prefix starting at position 1.

Examples:

```text
[]                                  valid
[event_1841@1]                      valid
[event_1841@1, event_1842@2]        valid
[event_1843@3]                      invalid: analysisOrderAnchorNotPrefix
```

This rule is compiler-owned and must be taught by the authoring skill because it changes what writers may author.

### 2.4 HPA-262 and HPA-265 still own the real Beat 8.5 delivery

HPA-552 does not author production Beat 8.5 and does not prove the final packaged three-board journey.

- HPA-262 owns cross-layer integration/acceptance of the real three-board slice.
- HPA-265 owns `docs/stories_plan/chapter_1/analysis_scene_8_5.md`, replacing the current linear Beat 8.5 transition and iterating the player experience.

HPA-552 only makes the repo authoring contract accurate before that work.

---

## 3. Current drift to fix

### 3.1 `writing-analysis-scene` is now factually stale

Its useful current content should remain, including:

- header / Intro / Board / Result Dialogue / Outro grammar;
- story-only `Reveals`;
- `grant_authorization` prohibition;
- threshold provenance rules;
- tutorial-only `practice:<id>` binding;
- exact `Incorrect Selection` feedback;
- scene-tag asset cues; and
- generated-vs-authored ownership.

But it currently says:

- author only `Kind: threshold` in shippable content;
- Classify/Order are parser-only;
- do not author `Group`, `Accepted Order`, or `Fixed Anchors`.

Those statements must be removed and replaced with the real three-board contract.

### 3.2 `CLAUDE.md` is already routed, but its capability wording is stale

Current routing exists and should not be redesigned. Only replace the threshold-only claim with the current Chapter 1 board set.

### 3.3 `writing-chapter-manifest` is already routed, but its row is stale

The Analysis row already exists. Change only its capability description.

### 3.4 `subagent-driven-story-writing` already dispatches Analysis, but its brief forbids two real board kinds

Keep the existing orchestration model and Analysis dispatch. Replace its threshold-only Analysis brief with one compact board-kind-specific brief contract:

- Classify: cards + groups + `Accepted Cards`.
- Order: cards + `Accepted Order` + required `Fixed Anchors`, including contiguous-prefix rule.
- Threshold: eligible cards + provenance requirements + optional exact wrong-selection feedback.

Do not duplicate the whole Analysis skill inside the orchestrator.

### 3.5 investigation/interrogation qualified-Analysis notes still carry the old runtime limit

Both skills already know the qualified syntax and current runtime story unlock context.

Remove only the sentence that limits playable refs to threshold boards. Keep:

- fully qualified scene/board IDs;
- catalog resolution;
- positive story-state semantics;
- fact/objective preference when the narrative dependency is the conclusion rather than UI completion; and
- separate authority-event restrictions.

### 3.6 `reviewing-story-scenes` needs no HPA-552 edit

HPA-561 already completed this surface:

- `analysis_scene_*.md` discovery;
- Analysis voice/narration review;
- Analysis Intro / Result Dialogue / Outro visual-background review; and
- `writing-analysis-scene` in Related skills.

Do not touch it merely to make the HPA-552 diff look symmetrical.

---

## 4. Goals

1. Make the existing `writing-analysis-scene` skill accurately teach the current playable Chapter 1 contract.
2. Cover exactly `classify`, `order`, and `threshold`.
3. Preserve HPA-561's production tutorial exceptions without generalizing them into Case File semantics.
4. Teach the new contiguous-prefix `Fixed Anchors` rule.
5. Keep compiler fixtures as the canonical copyable examples.
6. Remove stale threshold-only wording from existing authoring/orchestration guidance.
7. Preserve the authored/generated answer-key boundary.
8. Preserve the Chapter 1 request-readiness vs institutional-authorization boundary.

---

## 5. Non-goals

- No new `.claude/skills` package or second Analysis skill.
- No compiler behavior changes.
- No Rust runtime changes.
- No Svelte workbench changes.
- No save/persistence changes.
- No layout-editor preview/provenance inspector.
- No production `analysis_scene_8_5.md` authoring.
- No HPA-262 integrated acceptance work.
- No Chapter 2 `compare` / `route` board.
- No Chapter 3+ `chain` board.
- No graph/template/plugin registry.
- No schema-to-doc generator or Markdown-fence compiler.
- No new invalid fixture solely for HPA-552.
- No changes to `reviewing-story-scenes` unless current main regresses before implementation.

---

## 6. Ownership model

### 6.1 Compiler owns syntax and semantic validity

The authoring skill explains intent and common valid forms. These remain authoritative when prose and code disagree:

- `packages/scripts/compile-scenes/parser-analysis.ts`
- `packages/scripts/compile-scenes/validator-analysis.ts`
- `packages/scripts/compile-scenes/parser-unlock.ts`
- `packages/scripts/compile-scenes/story-catalog.ts`
- `packages/scripts/compile-scenes/case-record-provenance.ts`
- `packages/scripts/compile-scenes/reachability.ts`

### 6.2 Runtime/frontend own playability, not authored truth

HPA-260/HPA-261 establish that all three Chapter 1 board kinds are playable. The skill may say they are playable, but must not duplicate runtime DTOs, mutation semantics, or frontend implementation details.

### 6.3 Source scenes own Case File records and provenance

Real case-analysis cards reference already-authored:

```text
evidence:<id>
statement:<id>
```

Source Group, Procedural Status, Proof Capabilities, representation layer, completeness/confidence, and supersession remain on those source records.

Analysis cards do not duplicate provenance.

### 6.4 P1 practice cards remain a narrow tutorial exception

`practice:<id>` is already real production behavior for the P1 onboarding tutorial. Preserve its current rules:

- immediate investigation → analysis binding;
- chapter-scoped one-to-one practice carrier ownership;
- no mixing practice and Case File cards in one threshold eligible set; and
- neutral provenance requirements for all-practice thresholds.

Do not use `practice:` in real Beat 8.5 case reasoning.

### 6.5 Writers own semantic solution intent

Authored Markdown necessarily contains semantic solution fields:

- Classify `Accepted Cards`;
- Order `Accepted Order` / `Fixed Anchors`;
- Threshold sufficiency constraints.

Compiler-normalized answer structures stay private to generated/runtime contracts. Writers never hand-edit generated JSON or expose normalized answers in public answer-key-free views.

---

## 7. Updated Analysis authoring contract

### 7.1 Common scene structure

```text
H1  # Scene N: <title>
    - **Summary:** <player recap>
H2  ## Intro
H2  ## Board: <label> {#board_id}
H3      ### Card: <label> {#card_id}
H3      ### Group: <label> {#group_id}          # classify only
H3      ### Incorrect Selection                 # threshold only, optional
H3      ### Result Dialogue
H2  ## Outro
```

Common board metadata remains:

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

### 7.2 Classify

Use when each displayed record must be assigned to exactly one authored reasoning package.

Writer owns:

- Card IDs and sources.
- One or more Group blocks.
- Group `Description`.
- Group `Accepted Cards`.

Every displayed card must be assigned exactly once across accepted groups.

The compiler owns normalized `acceptedGroupByCard`; do not teach it as an authored field.

### 7.3 Order

Use for one exact sequence.

Writer owns:

```text
Accepted Order
Fixed Anchors
```

Rules that must be explicit in the skill:

1. `Accepted Order` names every displayed card exactly once.
2. `Fixed Anchors` is required even when empty.
3. Use `Fixed Anchors: []` when no cards are pinned.
4. Non-empty entries use `<card_id>@<one-based-position>`.
5. Anchored card IDs and positions are unique and in range.
6. Every anchor agrees with `Accepted Order` at that position.
7. Non-empty anchors form a contiguous prefix beginning at position 1.

Examples:

```text
Fixed Anchors: []
Fixed Anchors: [event_1841@1]
Fixed Anchors: [event_1841@1, event_1842@2]
```

Do not author a sparse anchor such as:

```text
Fixed Anchors: [event_1843@3]
```

### 7.4 Threshold

Keep the current skill's provenance-aware threshold contract:

```text
Eligible Cards
Minimum Selected
Minimum Distinct Source Groups
Required Proof Capabilities
Allowed Procedural Statuses
Require Source Group
```

Preserve the current compiler hard limit on eligible-card materialization as a present contract, not as a future architecture recommendation.

Preserve optional exact wrong-subset feedback:

```markdown
### Incorrect Selection

- **Cards:** [card_a, card_b]
- **Feedback:** <player-facing feedback>
```

Do not turn this into a progressive hint engine.

### 7.5 Story outputs and authority

All board `Reveals` are story targets.

Beat 8.5 may assert facts and complete:

```text
prepare_narrow_lock_request
```

It does not grant:

```text
narrow_lock_export
```

`grant_authorization:<id>` remains compiler-forbidden on Analysis boards. HPA-264/hearing flow owns the institutional grant.

### 7.6 Qualified Analysis completion

All three board kinds are now valid runtime completion producers.

When another scene truly depends on Analysis completion, use fully qualified refs:

```text
analysis_scene:<chapter_id>@<scene_id> completed
analysis_board:<chapter_id>@<scene_id>@<board_id> completed
```

Prefer an emitted Fact/Objective when the narrative dependency is the earned conclusion rather than the UI event itself.

### 7.7 Dialogue and assets

Preserve HPA-561 behavior:

- Intro, Result Dialogue, and Outro are dialogue carriers.
- `[場景：...]` on those carriers may use current shared visual/audio metadata when assets are enabled.
- Board/Card/Group/Incorrect Selection metadata does not directly own background cues.
- Writers never author filesystem paths.

---

## 8. Canonical example strategy

### 8.1 Valid example — reuse unchanged

Use:

`packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`

It already exercises the complete Chapter 1 contract:

- Classify `evidence_packages`.
- Order `local_event_sequence`.
- Threshold `narrow_request_basis`.
- Qualified board unlocks.
- Real evidence/statement sources.
- Provenance/source-group/capability threshold logic.
- Story facts/objective outputs.

This matches the intended Chapter 1 Beat 8.5 reasoning structure and remains the best single canonical case-analysis example.

### 8.2 Tutorial example — reuse unchanged

Use:

`docs/stories_plan/chapter_1/analysis_scene_p1_5.md`

only for current production tutorial-specific behavior:

- `practice:<id>` cards;
- exact `Incorrect Selection` feedback; and
- authored Analysis scene-tag asset cues.

Do not use it to define real Case File provenance semantics.

### 8.3 Invalid example — reuse HPA-261 fixture

Use:

`packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/`

Its sparse anchor:

```text
Fixed Anchors: [event_1843@3]
```

is compiler-exercised and expects:

```text
analysisOrderAnchorNotPrefix
```

This already satisfies HPA-552's requirement for a compiler-exercised invalid authoring example.

Do **not** add the previously planned HPA-552 `Kind: route` fixture. The compiler already owns the closed board-kind validation, while the existing prefix-anchor fixture teaches a current writer-facing rule and costs no new test surface.

---

## 9. Repo-contract synchronization

The final implementation should modify exactly these six existing guidance files unless current main changes again:

1. `.claude/skills/writing-analysis-scene/SKILL.md`
2. `CLAUDE.md`
3. `.claude/skills/writing-chapter-manifest/SKILL.md`
4. `.claude/skills/subagent-driven-story-writing/SKILL.md`
5. `.claude/skills/writing-investigation-scene/SKILL.md`
6. `.claude/skills/writing-interrogation-scene/SKILL.md`

### Do not modify

- `.claude/skills/reviewing-story-scenes/SKILL.md` — already current.
- `packages/scripts/compile-scenes/*` — HPA-259/HPA-261 already own the compiler rules.
- `packages/scripts/__fixtures__/*` — canonical valid and invalid examples already exist.
- `apps/game/*` — HPA-260/HPA-261 already own runtime/workbench behavior.
- production Beat 8.5 content — HPA-265 owns it.

---

## 10. Validation strategy

Because HPA-552 now changes only Markdown guidance, validation should prove two things: the referenced compiler examples still pass/fail as documented, and no stale threshold-only guidance remains on the touched surfaces.

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
bun run scenes:compile
bun run check:scripts
bun run format:check
```

If the repository's Vitest pass-through syntax differs, `bun run test:scripts` is the authoritative fallback.

Also source-scan the six touched files for obsolete claims such as:

```text
threshold-board only
threshold only
parser-only
parser/compiler retain classify and order
runtime loader rejects classify/order
Do not brief a writer to author classify or order
```

The scan is a documentation guard, not a new permanent test framework.

No Rust/frontend/E2E rerun is required solely for this docs-only implementation because the three-board runtime/workbench has already been accepted by HPA-260/HPA-261. HPA-262 owns the real production integrated path.

---

## 11. Acceptance mapping

| HPA-552 criterion | Revised response |
|---|---|
| Every authoring example compiler-exercised, including invalid | Reuse existing valid three-board fixture + existing HPA-261 prefix-anchor invalid fixture; P1 production tutorial is additionally compiled by normal scene compilation |
| Writer can author without editing generated JSON | Existing skill's ownership section retained and expanded to all three kinds |
| Only three Chapter 1 families | `classify` / `order` / `threshold`; future templates remain excluded |
| Reference canonical schema rather than duplicate | Skill remains reference-first; parser/validator + fixtures win |
| `scenes:compile` and `check:scripts` pass | Explicit verification commands |
| Real Beat 8.5 conforms or skill corrected | HPA-265 remains product-content owner; HPA-262 remains integration owner |

The Linear phrase “no answer-key data in any authored or shared surface” remains too broad if interpreted literally. The implementation must preserve the corrected invariant:

> Authors declare semantic solution intent in Markdown; compiler-normalized answers stay out of public/shared answer-key-free runtime views and generated JSON is never hand-authored.

---

## 12. Final decision

Implement HPA-552 as an **in-place contract correction, not a new feature surface**.

The cheapest correct implementation is now smaller than the original plan:

- upgrade one existing threshold-only skill to the already-shipped three-board contract;
- fix stale capability wording in five existing guidance files;
- reuse the existing valid and invalid compiler fixtures; and
- stop there.

HPA-260/HPA-261 already solved runtime and UI. HPA-561 already solved Analysis discovery/review/tutorial wiring. HPA-262/HPA-265 own the next real product slice. HPA-552 should only make writers stop receiving obsolete instructions.