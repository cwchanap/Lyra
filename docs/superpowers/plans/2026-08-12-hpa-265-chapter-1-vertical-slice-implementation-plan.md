# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and accept the real Chapter 1 Beat 8.5 Classify → Order → Threshold scene, connect its request-readiness output to the existing KAGAMI hearing authorization, prove one packaged Save/Continue/grant path, and stop for human playtest acceptance.

**Architecture:** Reuse HPA-259/260/261 Analysis, HPA-255/257 story state and reveal transactions, HPA-129 save/load, and the existing Chapter 1 hearing. Add one optional interrogation-phase `Represented Authority` definition field and one private Rust context constructor that carries it through every interrogation story reveal. Production content uses real Chapter 1 records; Event-1841..1844 remain four Analysis-card identities backed by the single real `local_sequence_record` evidence item.

**Tech Stack:** Bun 1.3.1, TypeScript scene compiler, Markdown story authoring, Rust/Tauri `GameEngine`, Svelte Analysis workbench, current save schema, existing packaged E2E checkpoint/save harness.

## Global Constraints

- Start implementation from latest `main`, never from a planning branch.
- HPA-265 is the single survivor for former HPA-262/263/264/266 scope.
- Chapter 1 is the product target; no Chapter 2 content or future-template abstractions.
- Reuse existing Classify/Order/Threshold runtime/UI. No new board kind, evaluator, registry, store, or renderer.
- Reuse HPA-255 `StoryState` mutations. No second authorization/objective state owner.
- Reuse HPA-257 reveal transaction/idempotence. No grant ledger.
- `analysis_scene_8_5` may complete `prepare_narrow_lock_request` but must never grant `narrow_lock_export`.
- Only the existing KAGAMI hearing gate may grant `narrow_lock_export` in production.
- `narrow_lock_export` must have a real production consumer: p4 requires `authorization:narrow_lock_export granted`.
- Do not split `local_sequence_record` into four Case File evidence items.
- Threshold v1 uses truthful source groups + proof capabilities; no artificial procedural-status gate.
- Remove the old `scene_8_5.md` only after useful dialogue is migrated, and mark its semantic re-audit references as historical.
- No backward-compatibility/save migration for this pre-release content revision.
- Rich progressive hints are conditional on human playtest evidence and are not an implementation prerequisite.
- `.claude/skills/writing-analysis-scene/SKILL.md` already supports production Classify/Order/Threshold; do not edit it merely to restate that contract.
- Any unexpected architecture expansion is a stop condition.

---

### Task 0: Prove shared Order-card sources before touching production content

**Files:**
- Modify/Test: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- Modify/Test: `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`
- Verify: `apps/game/src-tauri/src/game/analysis_integration_tests.rs`

**Interfaces:**
- Consumes: existing compiler fixture `evidence:lock_sequence` and existing Rust fixture catalog/source scene.
- Produces: an early compiler + runtime proof that distinct Analysis card ids may intentionally share one Case File source.

This is the only material production-content assumption not already exercised by the checked-in fixture. Prove it before authoring Chinese production dialogue or editing real provenance.

- [ ] **Step 1: Baseline fixture tests**

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS on `main`.

- [ ] **Step 2: Make all four compiler-fixture Order cards share `evidence:lock_sequence`**

Keep card ids, labels, summaries, accepted order, and fixed anchor unchanged. Change only the four card source lines to:

```markdown
- **Source:** evidence:lock_sequence
```

Do not delete the fixture's `event_1841`..`event_1844` evidence rows; this task proves card-source non-uniqueness only.

- [ ] **Step 3: Mirror the same source shape in the checked-in Rust JSON fixture**

For `event_1841`..`event_1844`, use:

```json
{"kind":"evidence","id":"lock_sequence"}
```

Leave card ids and `acceptedOrder` unchanged. The existing fixture source scene already acquires `lock_sequence`.

- [ ] **Step 4: Run compiler + runtime acceptance**

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS.

If RED, fix only the narrow shared-source bug proven by this fixture. Do not start production authoring and do not split production evidence as a workaround.

- [ ] **Step 5: Commit**

```bash
git add \
  packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md \
  apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json
git commit -m "test(analysis): prove shared card source support"
```

---

### Task 1: Close only the missing incomplete-draft restore proofs

**Files:**
- Modify/Test: `apps/game/src-tauri/src/game/analysis_integration_tests.rs`
- Verify existing frontend Analysis tests; no frontend edit expected.

**Interfaces:**
- Consumes: existing `detached_restore()`, `analysis_token()`, `board()`, and the now-shared-source fixture.
- Produces: exact incomplete save/restore proofs for Order and Threshold.

- [ ] **Step 1: Add incomplete Order restore**

Use:

```rust
AnalysisDraft::Order {
    card_ids: vec!["event_1841".into(), "event_1843".into()],
}
```

Assert exact equality before and after `detached_restore()`, then continue with the correct full order. The partial draft preserves fixed `event_1841@1`.

- [ ] **Step 2: Add incomplete Threshold restore**

Use:

```rust
AnalysisDraft::Threshold {
    selected_card_ids: BTreeSet::from(["lock_sequence".into()]),
}
```

Assert exact equality before and after `detached_restore()`, then continue through the existing wrong/correct Threshold path.

- [ ] **Step 3: Do not add another public-wire assertion**

Re-run existing frontend coverage only:

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
```

- [ ] **Step 4: Re-run focused Rust acceptance and commit**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
git add apps/game/src-tauri/src/game/analysis_integration_tests.rs
git commit -m "test(game): cover remaining Analysis draft restores"
```

---

### Task 2: Add represented authority end-to-end through the existing interrogation path

**Files:**
- Modify: `packages/scripts/compile-scenes/types.ts`
- Modify: `packages/scripts/compile-scenes/parser-interrogation.ts`
- Modify: `packages/scripts/compile-scenes/emitter.ts`
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/reachability.ts`
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Verify: `apps/game/src-tauri/src/game/reveals.rs`
- Modify: `.claude/skills/writing-interrogation-scene/SKILL.md`
- Test: focused compiler + Rust tests.

**Authoring contract:**

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

No new scene family, command, save field, authority registry, or mutable grant state.

- [ ] **Step 1: RED — parser/AST test**

Add optional Phase metadata, parse to:

```ts
representedAuthority: "KAGAMI 證據摘要審查會主理"
```

Legacy absence parses as `null`.

- [ ] **Step 2: Add AST + optional emitted JSON**

```ts
representedAuthority: string | null;   // AST
representedAuthority?: string;         // JSON
```

Emit only when non-null; do not serialize `null` into legacy content.

- [ ] **Step 3: RED — compiler authority tests**

Cover ordinary-phase grant rejection, matching phase/question/line grant acceptance, mismatch rejection, and testimony-line inheritance. Reuse `validateStoryRevealTargets()`; no second validator.

- [ ] **Step 4: Propagate authority through story-target batches + reachability nodes**

Phase, Question, and TestimonyLine reveal nodes inherit the owning Phase authority. Investigation stays `null`. Add a mandatory `authorization:<id> granted` reachability fixture to prove a matching producer satisfies the gate.

- [ ] **Step 5: Run focused TypeScript tests**

```bash
bun test \
  packages/scripts/compile-scenes/parser-interrogation.test.ts \
  packages/scripts/compile-scenes/validator.test.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts \
  packages/scripts/compile-scenes/reachability.test.ts \
  packages/scripts/compile-scenes/emitter.test.ts
```

- [ ] **Step 6: RED — Rust serde + grant command tests**

Add:

```rust
#[serde(default)]
represented_authority: Option<String>,
```

Prove legacy `None`, matching `Some`, matching grant success, absent/wrong authority failure, and one-shot replay idempotence.

- [ ] **Step 7: Add one private `interrogation_story_context(...)` constructor**

It accepts the owning immutable `InterrogationPhaseJson`, reads `represented_authority` itself, and constructs `StoryRevealMaterializationContext`. Where borrow boundaries require it, clone the immutable current Phase definition before mutating scene state.

Do not leave four hand-threaded context literals.

- [ ] **Step 8: Route every interrogation story reveal through the constructor**

Grep all raw `StoryRevealMaterializationContext` constructions. Interrogation origins `InterrogationPhase`, `InquiryQuestion`, and `TestimonyLine` must use the helper, including both InquiryQuestion paths: auto-break and post-correct-line. Investigation/Analysis stay authority-null.

After editing, grep again and ensure no interrogation-origin raw literal remains.

- [ ] **Step 9: Update interrogation authoring guidance**

Document `Represented Authority`, exact authority matching, and the KAGAMI example. Replace the stale pre-HPA-264 restriction. Do not edit the already-current Analysis skill.

- [ ] **Step 10: Run Rust tests and commit**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml authorization --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
git add packages/scripts/compile-scenes apps/game/src-tauri/src/game/schema.rs apps/game/src-tauri/src/game/mod.rs .claude/skills/writing-interrogation-scene/SKILL.md
git commit -m "feat(story): carry represented hearing authority"
```

---

### Task 3: Add the minimal production story catalog and truthful Threshold provenance

**Files:**
- Create: `docs/stories_plan/story_catalog.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_8.md`

**Important:** this task remains independently compilable. Current reachability errors are about authored nodes with unsatisfied prerequisites; merely defining Fact/Objective/Authorization entries does not require a producer.

- [ ] **Step 1: Author parser-complete catalog**

Add exactly four Facts with `Summary`, `Details`, `Category: chapter_1`; secondary Objective `prepare_narrow_lock_request`; Authorization `narrow_lock_export` granted by `KAGAMI 證據摘要審查會主理`; Source Groups `door_lock_fixed_record` and `victim_phone_device`, each with Summary.

- [ ] **Step 2: Add phone provenance**

`victim_phone_notification`: digital/raw, source group `victim_phone_device`, source label `死者手機通知紀錄`, proof `[time]`; leave unsupported dimensions neutral.

- [ ] **Step 3: Add shared door-lock provenance**

Both `local_sequence_record` and `external_maintenance_credential`: digital/raw, exhibit, complete, corroborated, source group `door_lock_fixed_record`, label `後場門鎖程序固定紀錄`; capabilities `[order]` and `[order, access]` respectively.

- [ ] **Step 4: Prove independent compile and commit**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS before `analysis_scene_8_5.md` exists. If a definition-without-producer is unexpectedly rejected, investigate that regression; do not merge Task 3 into Task 4 to conceal it.

```bash
git add docs/stories_plan/story_catalog.md docs/stories_plan/chapter_1/investigation_scene_7.md docs/stories_plan/chapter_1/investigation_scene_8.md
git commit -m "feat(story): define Chapter 1 analysis progress"
```

---

### Task 4: Author the real production `analysis_scene_8_5.md`

**Files:**
- Create: `docs/stories_plan/chapter_1/analysis_scene_8_5.md`
- Modify: `docs/stories_plan/chapter_1/chapter.md`
- Delete: `docs/stories_plan/chapter_1/scene_8_5.md`
- Modify: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`

- [ ] **Step 1: Replace manifest entry and migrate useful atmosphere**

Keep late-night police-station/vending-machine atmosphere and partner fatigue. Do not narrate board solutions before interaction.

- [ ] **Step 2: Author `evidence_packages` Classify**

Use real records `closing_routine`, `cake_box`, `miyake_mother_call_log`, `miyake_pov_replay`, `external_maintenance_credential`, `local_sequence_record`, `victim_phone_notification`; group into `miyake_small_lies`, `earlier_third_party`, `lock_chronology_gap`; reveal the first two facts.

- [ ] **Step 3: Author `local_event_sequence` Order using proven shared source**

Keep card ids Event-1841..1844, accepted order 1841 → 1842 → 1843 → 1844, fixed 1841@1; every card sources `evidence:local_sequence_record`; reveal `merge_time_is_not_event_time`.

- [ ] **Step 4: Author `narrow_request_basis` Threshold**

Use `local_sequence_record`, `external_maintenance_credential`, `victim_phone_notification`; require 2 selected, 2 source groups, `[time, order]`, no procedural-status restriction, source group required. Reveal `two_independent_lock_contradictions_identified` and complete `prepare_narrow_lock_request`. Add exactly one same-source Incorrect Selection for the two door-lock records.

- [ ] **Step 5: Outro + delete old linear file + audit note**

Outro says request prepared, identity unresolved, clip still unavailable. Delete `scene_8_5.md`. Add a short top-level supersession note to `semantic-content-reaudit.md` that its `scene_8_5.md` references are historical pre-HPA-265 findings; keep historical findings intact.

- [ ] **Step 6: Compile/test and commit**

```bash
bun run scenes:compile
bun run test:scripts
git add docs/stories_plan
git commit -m "feat(story): author Chapter 1 Beat 8.5 analysis"
```

---

### Task 5: Turn the existing hearing into concise confirmation + load-bearing authorization

**Files:**
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_10.md`
- Test through compiler + focused Rust integration.

- [ ] **Step 1: Shorten p1–p4 to formal confirmation**

Keep existing contradictions and proof order; stop re-teaching full board reasoning. p5+ stays unchanged.

- [ ] **Step 2: Make `gate` the represented authority event**

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

At `gate_hold_record`:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

- [ ] **Step 3: Make authorization mechanically gate p4**

Use actual authoring syntax:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

Do not use normalized JSON spelling `authorization_granted:narrow_lock_export`.

- [ ] **Step 4: Compiler + Rust grant acceptance**

```bash
bun run scenes:compile
bun run test:scripts
```

Prove: objective absent → grant impossible; wrong evidence → no grant/clip; correct gate → grant + clip atomically; p4 unavailable before authorization and reachable after; replay/restore no duplicate effects.

- [ ] **Step 5: Commit**

```bash
git add docs/stories_plan/chapter_1/interrogation_scene_10.md apps/game/src-tauri/src/game
git commit -m "feat(story): connect Beat 8.5 to hearing grant"
```

---

### Task 6: Add focused Beat 8.5 packaged smoke with canonical CI ownership

**Files:**
- Modify: `apps/game/src-tauri/src/game/e2e_checkpoints.rs`
- Create: `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- Modify: `apps/game/scripts/e2e-suite-registry.mjs`
- Modify: `apps/game/scripts/e2e-suite-registry.test.mjs`
- Modify: `apps/game/scripts/select-e2e-suites.mjs`
- Modify: `apps/game/scripts/select-e2e-suites.test.mjs`
- Modify checkpoint contract tests as needed.

Do not expand `production-journey.e2e.ts`.

- [ ] **Step 1: Add `chapter-1-analysis-beat-85-ready` checkpoint**

Seed exact real records through existing packaged definitions/`AcquisitionCtx`, clear presentation-only pending events for this test seed, jump to `analysis_scene_8_5`, and expose Analysis mode. No production seed API.

- [ ] **Step 2: Register suite in canonical list + gameplay chain**

Add `analysis-beat85` immediately after `production-journey` in `E2E_SUITE_IDS`, define only `./e2e-tauri/analysis-beat85.e2e.ts`, and add it to the gameplay chain in the same position. Update registry tests; current invariants require flattened chain ownership to equal all suite ids.

- [ ] **Step 3: Add suite to story/compiler risk rule**

Use:

```js
["smoke", "gameplay", "production-journey", "analysis-beat85"]
```

Update selection tests so Chapter 1 story/compiler changes select the new suite.

- [ ] **Step 4: Drive one focused packaged flow**

Ready checkpoint → solve Classify → solve Order → one-card Threshold draft → Save → Title → Continue once → assert exact Threshold draft → solve Threshold → debug jump to `interrogation_scene_10` preserving state → p1-p3 confirmation → gate resolution → assert `narrow_lock_export`, `approved_clip`, and p4 reachability. Do not continue through the remaining hearing.

- [ ] **Step 5: Run and commit**

```bash
bun test apps/game/scripts/e2e-suite-registry.test.mjs apps/game/scripts/select-e2e-suites.test.mjs
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
git add apps/game/src-tauri/src/game/e2e_checkpoints.rs apps/game/e2e-tauri/analysis-beat85.e2e.ts apps/game/e2e-tauri/checkpoint-contract.e2e.ts apps/game/scripts/e2e-suite-registry.mjs apps/game/scripts/e2e-suite-registry.test.mjs apps/game/scripts/select-e2e-suites.mjs apps/game/scripts/select-e2e-suites.test.mjs
git commit -m "test(e2e): cover Chapter 1 Beat 8.5 handoff"
```

---

## Human acceptance gate — not an agent task

After Tasks 0–6 are green, stop for human Beat 8.5 → hearing playtest. Evaluate board clarity, detective feel/pacing, whether p1–p4 feel like confirmation, same-source feedback, Save/Continue confidence, keyboard usability, and thumbnail identification value.

If no concrete misunderstanding appears, richer hints are not needed. If one appears, prefer Prompt/Card/Group wording, existing Hint, or one exact Incorrect Selection before new runtime semantics. No empty playtest commit.

---

### Task 7: Final automated verification and completion handoff

- [ ] **Step 1: Story/compiler/frontend/Rust gates**

```bash
bun run scenes:compile
bun run test:scripts
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts src/lib/components/analysis/AnalysisWorkbench.test.ts src/lib/components/analysis/ClassifyBoard.test.ts src/lib/components/analysis/OrderBoard.test.ts src/lib/components/analysis/ThresholdBoard.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

- [ ] **Step 2: E2E ownership + Beat 8.5 smoke**

```bash
bun test apps/game/scripts/e2e-suite-registry.test.mjs apps/game/scripts/select-e2e-suites.test.mjs
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

- [ ] **Step 3: Repository gates**

```bash
bun run test
bun run check
bun run lint:all
```

- [ ] **Step 4: Scope/product assertions**

Confirm shared-source proof preceded production authoring; no Chapter 2/framework/migration/fake Event evidence/hint engine; semantic re-audit marks old linear references historical; p4 requires authorization; `analysis-beat85` is in gameplay chain + story/compiler risk rule; `production-journey.e2e.ts` stays narrow; four facts/objective established; grant absent before hearing; grant + clip exact once; p4 gated; Case File authority shown; proof order retained; Rust Order/Threshold restores green; one packaged Threshold Save → Title → Continue green.

- [ ] **Step 5: Update Linear only after fresh evidence is green**

Mark HPA-265 Done. HPA-262/263/264/266 remain Duplicate.

---

## Implementation stop conditions

Stop and re-review rather than widening scope if:

1. Task 0 proves shared Analysis-card sources require a deeper model change than a narrow compiler/runtime bugfix;
2. production boards require changing the Chapter 1 culprit or final proof order;
3. represented authority requires mutable runtime state instead of immutable phase definition data;
4. authorization cannot remain atomic through the existing reveal transaction;
5. p4 cannot be gated by the existing authorization predicate without breaking the hearing flow;
6. the Beat 8.5 E2E checkpoint cannot seed production records through existing test-only seams without a production API;
7. packaged play demonstrates HPA-603/HPA-601 is a real blocker.

A stop condition does not authorize Chapter 2 abstractions or a generic redesign.
