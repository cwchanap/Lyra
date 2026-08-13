# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and accept the real Chapter 1 Beat 8.5 three-board Analysis scene, connect its request-readiness output to the existing KAGAMI hearing's represented-authority grant, prove core save/resume in the packaged game, and iterate only on playtest-proven friction.

**Architecture:** Reuse HPA-259/260/261 Analysis, HPA-255/257 story state, HPA-129 save/load, and the existing Chapter 1 hearing. Add only one optional interrogation-phase `Represented Authority` definition field, propagated through existing compiler reachability and Rust reveal contexts. Production content uses real Chapter 1 Case File records; Event-1841..1844 remain four Analysis cards backed by the single existing `local_sequence_record` evidence item.

**Tech Stack:** Bun 1.3.1, TypeScript scene compiler, Markdown story authoring, Rust/Tauri `GameEngine`, Svelte Analysis workbench, current save schema, current packaged Tauri E2E harness.

## Global Constraints

- Start implementation from latest `main`, never from the superseded HPA-262 planning branch.
- HPA-265 is the single survivor for former HPA-262/263/264/266 scope.
- Chapter 1 is the product target; do not add Chapter 2 content or future template abstractions.
- Reuse existing Classify/Order/Threshold runtime/UI. No new board kind, evaluator, registry, store, or renderer.
- Reuse HPA-255 StoryState mutations. Do not add a second authorization/objective state owner.
- Reuse HPA-257 reveal transaction/idempotence. Do not add a grant ledger.
- `analysis_scene_8_5` may prepare `prepare_narrow_lock_request` but must never grant `narrow_lock_export`.
- Only the existing KAGAMI hearing gate may grant `narrow_lock_export` in production.
- Do not split `local_sequence_record` into four Case File evidence items; Event-1841..1844 are Analysis card identities sharing one evidence source.
- Do not add procedural-status restrictions to the Threshold board merely because the compiler supports them; use source groups + truthful proof capabilities as the first-version rule.
- Delete the old unreferenced `scene_8_5.md` after its useful dialogue is migrated.
- No backward-compatibility or save migration for this pre-release content revision.
- Rich progressive hints are conditional on playtest evidence and are not a completion prerequisite.
- Any unexpected architecture expansion is a stop condition, not permission to silently widen scope.

---

### Task 1: Close the remaining Analysis platform acceptance gaps

**Files:**
- Modify/Test: `apps/game/src-tauri/src/game/analysis_integration_tests.rs`
- Verify: `apps/game/src/lib/analysis/analysis-boundary.test.ts`
- Verify: `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- Verify: `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`
- Verify: `apps/game/src/lib/components/analysis/OrderBoard.test.ts`
- Verify: `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`

**Purpose:** absorb the useful former HPA-262 work without making it a separate delivery gate.

- [ ] **Step 1: Baseline the existing Chapter-1-shaped Rust acceptance**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS on current `main`.

- [ ] **Step 2: Add one compact producer-side public-wire assertion**

In `analysis_integration_tests.rs`, add a local helper that serializes `engine.view()` and checks only frontend-contract fields for all three visible boards:

```text
scene.kind == analysis
actionToken uses camelCase
visibleBoards contains classify / order / threshold
Classify -> groups + classify draft
Order -> fixedAnchors + order draft
Threshold -> minimumSelected + selectedCardIds + threshold draft
cards -> source.kind + available + sourceLabel/sourceSummary
feedback -> incomplete | incorrect only
acceptedGroupByCard / acceptedOrder / acceptedSelections absent everywhere
```

Use the existing recursive `assert_no_answer_keys()` helper. Do not introduce JSON Schema/codegen.

- [ ] **Step 3: Add exact incomplete Order restore**

After Classify completion and selecting `local_event_sequence`, save this valid incomplete draft:

```rust
AnalysisDraft::Order {
    card_ids: vec!["event_1841".into(), "event_1843".into()],
}
```

It preserves the fixed first anchor but is incomplete. Run the existing `detached_restore()` helper and assert the exact draft survives before proceeding with the correct full order.

- [ ] **Step 4: Add exact incomplete Threshold restore**

After Order completion and selecting `narrow_request_basis`, save:

```rust
AnalysisDraft::Threshold {
    selected_card_ids: BTreeSet::from(["lock_sequence".into()]),
}
```

Detach/restore and assert exact equality before continuing through the existing wrong/correct Threshold path.

- [ ] **Step 5: Run focused Rust acceptance again**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS. If the new assertions expose a real runtime/wire bug, create a focused failing test and patch only that bug before proceeding.

- [ ] **Step 6: Re-run existing frontend acceptance instead of duplicating it**

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
```

Expected: PASS. Add frontend tests only if a concrete HPA-265 acceptance row is actually missing.

- [ ] **Step 7: Commit**

```bash
git add apps/game/src-tauri/src/game/analysis_integration_tests.rs
git commit -m "test(game): close Analysis acceptance gaps"
```

If no frontend files changed, do not include them.

---

### Task 2: Add the narrow interrogation-phase represented-authority compiler contract

**Files:**
- Modify: `packages/scripts/compile-scenes/types.ts`
- Modify: `packages/scripts/compile-scenes/parser-interrogation.ts`
- Modify: `packages/scripts/compile-scenes/emitter.ts`
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/reachability.ts`
- Test: existing focused parser/emitter/validator/reachability test files
- Modify docs: `.claude/skills/writing-interrogation-scene/SKILL.md`

**Contract:** one optional Phase metadata field:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

No new scene kind, event bus, authority registry, or runtime command.

- [ ] **Step 1: RED — add parser test for the new Phase field**

Add a focused parser test with an Inquiry Phase containing:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

Expected parsed AST:

```ts
representedAuthority: "KAGAMI 證據摘要審查會主理"
```

Also retain a legacy case with no field and expect `null` in the AST.

Run the focused parser test and confirm RED before implementation.

- [ ] **Step 2: Add the AST field**

In `ASTInquiryPhase`:

```ts
representedAuthority: string | null;
```

Parse `Represented Authority` as optional non-empty Phase metadata. Do not allow it on Question or Line blocks.

- [ ] **Step 3: Preserve legacy emitted JSON shape**

In `JSONInterrogationPhase`, use an optional wire member:

```ts
representedAuthority?: string;
```

In `emitter.ts`, emit it only when non-null:

```ts
...(phase.representedAuthority === null
  ? {}
  : { representedAuthority: phase.representedAuthority })
```

Do not emit `representedAuthority: null` into every legacy interrogation phase.

- [ ] **Step 4: RED — add story-target authority validation fixtures**

Extend existing compiler tests to cover:

1. `grant_authorization` in an ordinary phase with no represented authority -> existing `authorizationGrantOutsideAuthorityEvent` error;
2. phase authority exactly matching catalog `Granting Authority` -> no authority validation error;
3. mismatch -> `authorizationGrantAuthorityMismatch`;
4. grant nested in a testimony Line's `On Correct -> Reveals` inherits its owning phase authority.

Do not add a second authorization validator; exercise `validateStoryRevealTargets()` through production-style scene validation.

- [ ] **Step 5: Propagate authority in `buildStoryRevealTargetBatches()`**

Change the internal batch helper to accept a represented authority.

For interrogation scenes:

```text
phase reveals             -> phase.representedAuthority
question reveals          -> phase.representedAuthority
question testimony lines  -> phase.representedAuthority
```

Investigation batches remain `null`.

- [ ] **Step 6: RED/GREEN — teach whole-corpus reachability the same authority**

Add a focused reachability test where a mandatory `authorization:<id> granted` gate has a matching grant producer in a represented-authority interrogation phase.

Expected before implementation: the grant producer is still treated as authority `null`, causing mandatory authorization unreachable/mismatch.

Update interrogation reachability node construction so phase, question, and testimony-line nodes inherit the owning phase's `representedAuthority`.

Do not change the HPA-257 solver; it already knows how to materialize authorization atoms only for matching authority nodes.

- [ ] **Step 7: Update emitter/parser/validator tests**

Run:

```bash
bun test \
  packages/scripts/compile-scenes/parser-interrogation.test.ts \
  packages/scripts/compile-scenes/validator.test.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts \
  packages/scripts/compile-scenes/reachability.test.ts \
  packages/scripts/compile-scenes/emitter.test.ts
```

Expected: PASS.

- [ ] **Step 8: Update interrogation authoring guidance narrowly**

In `.claude/skills/writing-interrogation-scene/SKILL.md`:

- document optional Phase `Represented Authority`;
- explain that it is immutable definition context, not a grant by itself;
- allow `grant_authorization:<id>` only under a phase whose represented authority exactly matches the catalog authorization;
- preserve the rule that Investigation and Analysis cannot grant institutional authority;
- use the Chapter 1 KAGAMI hearing as the concrete production example.

Remove/replace the old text that said production grants are impossible until HPA-264.

- [ ] **Step 9: Commit**

```bash
git add \
  packages/scripts/compile-scenes/types.ts \
  packages/scripts/compile-scenes/parser-interrogation.ts \
  packages/scripts/compile-scenes/emitter.ts \
  packages/scripts/compile-scenes/validator.ts \
  packages/scripts/compile-scenes/reachability.ts \
  packages/scripts/compile-scenes/*.test.ts \
  .claude/skills/writing-interrogation-scene/SKILL.md
git commit -m "feat(story): add represented hearing authority context"
```

Review staged files before committing so unrelated script tests are not accidentally included.

---

### Task 3: Propagate represented authority through the existing Rust interrogation reveal path

**Files:**
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Verify/possibly test: `apps/game/src-tauri/src/game/reveals.rs`
- Modify focused Rust test fixtures only where enum struct literals require the new field

**Ownership:** `reveals.rs::apply_story_reveal()` already checks represented authority and delegates the mutation to `StoryState`; preserve that implementation.

- [ ] **Step 1: RED — add serde coverage for optional `representedAuthority`**

Add/extend a focused schema/loader test proving:

- a legacy Inquiry phase without the field deserializes to `None`;
- `"representedAuthority":"KAGAMI 證據摘要審查會主理"` deserializes to `Some(...)`.

- [ ] **Step 2: Add the Rust immutable definition field**

Extend `InterrogationPhaseJson::Inquiry`:

```rust
#[serde(default)]
represented_authority: Option<String>,
```

Do not add it to save snapshots.

Update hand-built phase fixtures/constructors with `represented_authority: None` only where Rust requires the new enum field.

- [ ] **Step 3: RED — prove a matching line grant succeeds and mismatch fails**

Use existing story catalog/reveal helpers to add a focused interrogation test where a testimony-line reveal grants an authorization.

Assertions:

```text
matching phase represented authority -> authorization appears exactly once
None -> validation/runtime error
wrong authority -> validation/runtime error
replaying consumed correct line does not create a second durable effect
```

Prefer integration at the GameEngine command path rather than a new standalone authority subsystem test.

- [ ] **Step 4: Propagate phase authority at every interrogation reveal context**

In `mod.rs`, replace hard-coded `represented_authority: None` only for interrogation contexts:

1. phase-entry story context;
2. question-reveal context when a question is answered/broken;
3. testimony-line `On Correct` story context.

Resolve the current phase definition before constructing each context and use:

```rust
represented_authority: phase_authority.as_deref()
```

Investigation contexts stay `None`; Analysis submission contexts stay `None`.

- [ ] **Step 5: Run focused and full Rust tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml authorization --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/game/src-tauri/src/game
git commit -m "feat(game): honor represented hearing authority"
```

Confirm no save-schema migration was introduced.

---

### Task 4: Create the production Chapter 1 story catalog and truthful Threshold provenance

**Files:**
- Create: `docs/stories_plan/story_catalog.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_8.md`

- [ ] **Step 1: Author the minimal production story catalog**

Create `docs/stories_plan/story_catalog.md` with exactly the first-version global definitions needed here.

#### Facts

```text
miyake_known_lies_are_unrelated_to_murder
earlier_external_entry_exists
merge_time_is_not_event_time
two_independent_lock_contradictions_identified
```

#### Objective

```markdown
### Objective: 準備有限門鎖調取申請 {#prepare_narrow_lock_request}

- **Summary:** 整理足以送進審查的獨立門鎖時序矛盾。
- **Kind:** secondary
- **Sort Order:** 1
```

#### Authorization

```markdown
### Authorization: 後場門鎖限定調出 {#narrow_lock_export}

- **Summary:** 核准調閱限定範圍的後場門鎖摘要對照片段。
- **Granting Authority:** KAGAMI 證據摘要審查會主理
```

#### Source groups

```text
door_lock_fixed_record
victim_phone_device
```

Do not add speculative Chapter 2 definitions.

- [ ] **Step 2: Add truthful phone provenance**

On `evidence:victim_phone_notification` in `investigation_scene_7.md`, add only:

```markdown
- **Source Kind:** digital
- **Representation Layer:** raw
- **Source Group:** victim_phone_device
- **Source Label:** 死者手機通知紀錄
- **Proof Capabilities:** [time]
```

Keep other provenance fields at neutral defaults unless existing story text explicitly supports stronger claims.

- [ ] **Step 3: Add the shared door-lock source identity**

On both `evidence:local_sequence_record` and `evidence:external_maintenance_credential` in `investigation_scene_8.md`, add:

```markdown
- **Source Kind:** digital
- **Representation Layer:** raw
- **Procedural Status:** exhibit
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** door_lock_fixed_record
- **Source Label:** 後場門鎖程序固定紀錄
```

Capabilities:

```text
local_sequence_record              -> [order]
external_maintenance_credential    -> [order, access]
```

The shared source group is required; do not separate them merely to make the Threshold easier.

- [ ] **Step 4: Compile before adding the Analysis scene**

```bash
bun run scenes:compile
```

Expected at this intermediate point: existing Chapter 1 should still compile with the new catalog/provenance. If catalog reachability complains about definitions with no producer yet, keep this task and Task 5 in the same working sequence rather than weakening validation; do not add fake producers.

- [ ] **Step 5: Commit once the catalog/provenance source is valid together with Task 5 content**

If the compiler correctly requires the soon-to-be-authored producers, defer the commit until Task 5. Otherwise a standalone commit is acceptable:

```bash
git add docs/stories_plan/story_catalog.md \
  docs/stories_plan/chapter_1/investigation_scene_7.md \
  docs/stories_plan/chapter_1/investigation_scene_8.md
git commit -m "feat(story): define Chapter 1 analysis progress"
```

---

### Task 5: Author the real production `analysis_scene_8_5.md`

**Files:**
- Create: `docs/stories_plan/chapter_1/analysis_scene_8_5.md`
- Modify: `docs/stories_plan/chapter_1/chapter.md`
- Delete after migration: `docs/stories_plan/chapter_1/scene_8_5.md`

**Authoring reference:** `.claude/skills/writing-analysis-scene/SKILL.md` and the existing Chapter 1 prose/canon. Do not copy fixture prose as production dialogue.

- [ ] **Step 1: Replace the manifest entry**

In `chapter.md`, replace:

```text
scene_8_5.md
```

with:

```text
analysis_scene_8_5.md
```

Keep the surrounding scene order unchanged.

- [ ] **Step 2: Migrate the useful linear transition beats into Analysis Intro/Outro**

Preserve the existing late-night police-station/vending-machine atmosphere and character beats that slow the rhythm before structured reasoning.

The Intro should establish:

- fatigue / late-night pacing;
- Hayasaka forcing Soma to separate evidence instead of filling gaps;
- the current known conclusions without solving the boards for the player;
- Kurose's procedural confirmation where still narratively needed.

Do not repeat the old linear scene verbatim before the player does the same reasoning interactively.

- [ ] **Step 3: Author Board 1 `evidence_packages`**

Use these Analysis cards and real sources:

```text
closing_routine                -> evidence:closing_routine
cake_box                       -> evidence:cake_box
miyake_mother_call             -> evidence:miyake_mother_call_log
miyake_pov_replay              -> evidence:miyake_pov_replay
external_maintenance_credential -> evidence:external_maintenance_credential
local_sequence_record          -> evidence:local_sequence_record
victim_phone_notification      -> evidence:victim_phone_notification
```

Groups:

```text
miyake_small_lies:
  closing_routine, cake_box, miyake_mother_call

earlier_third_party:
  miyake_pov_replay, external_maintenance_credential

lock_chronology_gap:
  local_sequence_record, victim_phone_notification
```

Reveals:

```markdown
- **Reveals:** [assert_fact:miyake_known_lies_are_unrelated_to_murder, assert_fact:earlier_external_entry_exists]
```

Keep result dialogue short; it should state the conclusion, not replay every card.

- [ ] **Step 4: Author Board 2 `local_event_sequence`**

Unlock:

```markdown
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed
```

Four distinct Analysis cards all use:

```markdown
- **Source:** evidence:local_sequence_record
```

Cards/accepted order:

```text
event_1841 -> event_1842 -> event_1843 -> event_1844
```

Use:

```markdown
- **Accepted Order:** [event_1841, event_1842, event_1843, event_1844]
- **Fixed Anchors:** [event_1841@1]
- **Reveals:** [assert_fact:merge_time_is_not_event_time]
```

Card summaries should describe their row meaning without pretending they are four independent Case File sources.

- [ ] **Step 5: Author Board 3 `narrow_request_basis`**

Unlock:

```markdown
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@local_event_sequence completed
```

Cards:

```text
lock_sequence        -> evidence:local_sequence_record
external_credential  -> evidence:external_maintenance_credential
phone_notification   -> evidence:victim_phone_notification
```

Rules:

```markdown
- **Eligible Cards:** [lock_sequence, external_credential, phone_notification]
- **Minimum Selected:** 2
- **Minimum Distinct Source Groups:** 2
- **Required Proof Capabilities:** [time, order]
- **Allowed Procedural Statuses:** []
- **Require Source Group:** true
- **Reveals:** [assert_fact:two_independent_lock_contradictions_identified, complete_objective:prepare_narrow_lock_request]
```

Add one explicit same-source wrong selection:

```markdown
### Incorrect Selection

- **Cards:** [lock_sequence, external_credential]
- **Feedback:** 這兩項都來自同一份後場門鎖固定資料，還缺一個獨立來源。
```

Do not add progressive hint levels yet.

- [ ] **Step 6: Author the Outro**

The Outro should preserve the existing transition goal:

```text
we have proved the existing story is insufficient
we have prepared a narrow request
we still have not identified the earlier entrant
next investigation must fill the identity gap
```

It must not claim the approved clip is already available.

- [ ] **Step 7: Delete the obsolete linear file**

After all useful dialogue is represented in the new scene:

```bash
git rm docs/stories_plan/chapter_1/scene_8_5.md
```

- [ ] **Step 8: Compile RED/GREEN until real production content is valid**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected final result: PASS with the real production Analysis scene registered, all real record sources resolved, threshold satisfiable, no answer leakage, and no duplicate Beat 8.5 manifest entry.

If multiple cards referencing `local_sequence_record` exposes a genuine bug, add the smallest focused compiler/runtime/UI test and fix that bug; do not split the evidence as a workaround.

- [ ] **Step 9: Commit**

```bash
git add docs/stories_plan
git commit -m "feat(story): author Chapter 1 Beat 8.5 analysis"
```

---

### Task 6: Connect the existing hearing gate to `prepare_narrow_lock_request` and `narrow_lock_export`

**Files:**
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_10.md`
- Test through compiler/Rust production content

- [ ] **Step 1: Add represented authority to the existing gate phase**

On the phase containing `q_request_clip` / `gate_hold_record`, add:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

Do not add it to unrelated phases.

- [ ] **Step 2: Gate the authorization phase on the prepared request**

Change its unlock from the local-only predecessor to:

```markdown
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

Keep it locked until both requirements are true.

- [ ] **Step 3: Make the existing correct answer perform the real authority event**

At `gate_hold_record` `On Correct`, replace the current evidence-only reveal with authored-order effects:

```markdown
  - **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

This is one existing testimony-line one-shot command. Do not add a separate grant button or API.

- [ ] **Step 4: Trim duplicate explanation in `p4` only where needed**

Keep the final proof order and exact approved-clip reveal. The hearing should now use the already-established Analysis conclusion rather than re-explaining the full Order board.

Do not rewrite later culprit proof phases.

- [ ] **Step 5: Compiler tests**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected:

```text
- `narrow_lock_export` has a reachable matching authority producer
- the gate's objective predicate resolves
- the Analysis scene has no grant target
- approved_clip remains reachable only through the hearing correct line
```

- [ ] **Step 6: Rust acceptance for atomic/idempotent grant**

Add or extend a focused integration test against compiled/fixture hearing semantics:

```text
objective absent -> gate unavailable / grant impossible
objective complete + wrong evidence -> no grant, no approved_clip
correct line -> authorization + approved_clip appear
repeat/replay -> no duplicate grant/evidence/acquisition effects
save/restore after grant -> authority and evidence remain
```

Reuse current transaction/save helpers.

- [ ] **Step 7: Commit**

```bash
git add docs/stories_plan/chapter_1/interrogation_scene_10.md apps/game/src-tauri/src/game
git commit -m "feat(story): connect Beat 8.5 to hearing grant"
```

Only include Rust tests actually added for this task.

---

### Task 7: Extend one packaged production journey through Beat 8.5 save/resume and hearing grant

**Files:**
- Modify the existing packaged production-journey E2E/checkpoint file(s), not a new parallel suite unless the current harness structurally requires one.
- Reuse existing save/title/continue helpers.

- [ ] **Step 1: Build current production package**

```bash
cd apps/game
node scripts/build-e2e.mjs
```

- [ ] **Step 2: Extend the existing journey to the real Analysis scene**

The packaged journey must use production resources and IPC.

Prove at least:

1. enter `analysis_scene_8_5`;
2. leave a representative partial Classify draft;
3. Save -> Title -> Continue -> exact same Classify draft;
4. solve Classify;
5. create/save/resume a representative incomplete Order draft;
6. solve Order;
7. select `lock_sequence + external_credential` and observe same-source failure with draft preserved;
8. save/resume a one-card Threshold draft;
9. solve Threshold;
10. resume once during final Analysis result/outro queue if the existing E2E helper can express the point cheaply;
11. reach the hearing gate;
12. correct grant produces `narrow_lock_export` and `approved_clip`;
13. continue into the existing post-grant proof phase.

Use deterministic checkpoints/helpers already owned by the current suite. Do not create screenshot-diff or timing infrastructure.

- [ ] **Step 3: Keyboard-only Beat 8.5 smoke**

Reuse existing workbench keyboard support to complete one packaged Beat 8.5 pass, or if the packaged harness cannot cheaply drive a second full run, keep board-level keyboard coverage in existing Svelte tests and manually verify the production scene during Task 8. Do not duplicate a full E2E solely for keyboard parity.

- [ ] **Step 4: Run the journey**

```bash
node scripts/run-save-e2e.mjs --suite production-journey
cd ../..
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/game/e2e-tauri apps/game/scripts
git commit -m "test(e2e): cover Chapter 1 Analysis handoff"
```

Stage only files the existing E2E harness actually required.

---

### Task 8: Run the internal first-version playtest and make one evidence-driven iteration

**Files:**
- Modify production story/UI only if the playtest identifies a concrete issue.
- Record the playtest result in the implementation PR description or a concise repository note only if the project normally retains playtest notes; do not add telemetry infrastructure.

- [ ] **Step 1: Manual production playtest**

Play Chapter 1 through the new Beat 8.5 and hearing, focusing on:

```text
clarity of each board question
card/group naming
time spent on each board
transition pacing from investigation -> analysis -> investigation/hearing
same-source feedback comprehension
whether hearing feels repetitive
Save -> Title -> Continue identification and confidence
keyboard-only usability for Beat 8.5
whether save thumbnails materially help identify this state
```

- [ ] **Step 2: Decide whether rich hints are needed**

If no recurring confusion is observed:

```text
Record: richer contextual/progressive hints not needed for Chapter 1 first version.
```

Do not implement former HPA-263 scope.

If one concrete misunderstanding is observed, use the smallest existing authoring surface:

- board `Hint`, or
- one exact `Incorrect Selection`, or
- clearer Prompt/Card/Group wording.

Only add new runtime feedback semantics if a specific observed problem cannot be expressed by existing fields.

- [ ] **Step 3: Make at most one focused iteration pass before re-testing**

Re-run:

```bash
bun run scenes:compile
bun run --cwd apps/game test src/lib/components/analysis
```

and manually replay the affected beat.

- [ ] **Step 4: Commit only actual playtest-driven changes**

Example:

```bash
git add <affected files>
git commit -m "fix(story): clarify Chapter 1 analysis reasoning"
```

If no change is needed, make no empty commit.

---

### Task 9: Full verification and Chapter 1 first-version acceptance

- [ ] **Step 1: Story/compiler gates**

```bash
bun run scenes:compile
bun run test:scripts
```

- [ ] **Step 2: Focused frontend Analysis gates**

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
```

- [ ] **Step 3: Full Rust**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

- [ ] **Step 4: Packaged production journey**

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite production-journey
cd ../..
```

- [ ] **Step 5: Repository policy gates**

```bash
bun run test
bun run check
bun run lint:all
```

Use current repo scripts if names have changed by implementation time; do not add wrapper scripts merely to preserve this plan's command spelling.

- [ ] **Step 6: Final scope review**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Confirm:

```text
no Chapter 2 files
no second Analysis framework
no new authorization state owner
no save migration
no four fake Event evidence records
no duplicate playable scene_8_5
no unneeded progressive-hint system
```

- [ ] **Step 7: Fresh product acceptance assertions**

Manually verify the final production build satisfies:

```text
Beat 8.5 four facts established
prepare_narrow_lock_request completed
narrow_lock_export absent before hearing authority event
narrow_lock_export present exactly once afterward
approved_clip obtained only after grant
Case File shows authorization + granting authority
Chapter 1 proof order continues intact
Classify/Order/Threshold incomplete drafts restore through Save -> Title -> Continue
one result-dialogue resume does not replay durable effects
```

- [ ] **Step 8: Update Linear only after fresh evidence is green**

Mark HPA-265 Done. The former HPA-262/263/264/266 issues remain Duplicate and should not be reopened separately.

HPA-265 completion releases the post-Chapter-1 hardening/product-decision and deferred Chapter 2 re-planning issues that now depend on it.

---

## Implementation stop conditions

Stop and re-review rather than widening scope if:

1. production boards require changing the Chapter 1 culprit or final proof order;
2. the compiler disallows shared card sources for a reason deeper than a missing narrow test;
3. represented authority needs mutable runtime state rather than immutable phase definition data;
4. authorization cannot be made atomic through the existing reveal command transaction;
5. the existing hearing gate cannot carry the grant without duplicating or removing a major proof beat;
6. packaged play demonstrates HPA-603/HPA-601 is a real blocking path.

A stop condition does not authorize Chapter 2 abstractions or a generic redesign.
