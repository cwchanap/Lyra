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
- p4 requires `authorization:narrow_lock_export granted`; the authorization must be load-bearing, not decorative.
- Do not split `local_sequence_record` into four Case File evidence items.
- Threshold v1 uses truthful source groups + proof capabilities; no artificial procedural-status gate.
- Remove old `scene_8_5.md` only after useful dialogue migration, and mark its semantic re-audit references historical.
- No backward-compatibility/save migration for this pre-release content revision.
- Rich progressive hints remain conditional on human playtest evidence.
- Any unexpected architecture expansion is a stop condition.

---

### Task 0: Prove shared Order-card sources before production content

**Files:**
- Modify/Test: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- Modify/Test: `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`
- Verify: `apps/game/src-tauri/src/game/analysis_integration_tests.rs`

**Interfaces:**
- Consumes: existing fixture `evidence:lock_sequence`.
- Produces: early compiler + runtime proof that distinct Analysis card ids may share one Case File source.

- [ ] **Step 1: Baseline**

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS.

- [ ] **Step 2: Change the four compiler-fixture Order cards to one source**

Keep card ids, labels, summaries, accepted order, and fixed anchor. Change `event_1841`..`event_1844` card sources to:

```markdown
- **Source:** evidence:lock_sequence
```

Do not delete the four fixture evidence rows; this task proves card-source non-uniqueness only.

- [ ] **Step 3: Mirror the same shape in Rust fixture JSON**

Each Order card source becomes:

```json
{"kind":"evidence","id":"lock_sequence"}
```

The existing fixture source scene already acquires `lock_sequence`.

- [ ] **Step 4: Verify and commit**

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
git add packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json
git commit -m "test(analysis): prove shared card source support"
```

Expected: PASS. If RED, fix only the narrow shared-source bug before production authoring; do not split production evidence as a workaround.

---

### Task 1: Close only missing incomplete-draft restore proofs

**Files:** `apps/game/src-tauri/src/game/analysis_integration_tests.rs`

- [ ] **Step 1: Add incomplete Order restore**

Use `AnalysisDraft::Order { card_ids: vec!["event_1841".into(), "event_1843".into()] }`, assert exact equality before and after `detached_restore()`, then continue the correct order.

- [ ] **Step 2: Add incomplete Threshold restore**

Use `AnalysisDraft::Threshold { selected_card_ids: BTreeSet::from(["lock_sequence".into()]) }`, assert exact equality before/after `detached_restore()`, then continue existing wrong/correct flow.

- [ ] **Step 3: Re-run existing contract/UI tests; add no new wire assertion**

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

- [ ] **Step 4: Commit**

```bash
git add apps/game/src-tauri/src/game/analysis_integration_tests.rs
git commit -m "test(game): cover remaining Analysis draft restores"
```

---

### Task 2: Add represented authority through the existing interrogation path

**Files:**
- `packages/scripts/compile-scenes/types.ts`
- `packages/scripts/compile-scenes/parser-interrogation.ts`
- `packages/scripts/compile-scenes/emitter.ts`
- `packages/scripts/compile-scenes/validator.ts`
- `packages/scripts/compile-scenes/reachability.ts`
- `apps/game/src-tauri/src/game/schema.rs`
- `apps/game/src-tauri/src/game/mod.rs`
- `.claude/skills/writing-interrogation-scene/SKILL.md`
- focused tests.

**Authoring contract:**

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

- [ ] **Step 1: RED — parser/AST test**

Parse Phase authority to `representedAuthority: string | null`; legacy absence is `null`.

- [ ] **Step 2: Add optional emitted JSON field**

Use `representedAuthority?: string`; emit only when non-null.

- [ ] **Step 3: RED — compiler validation + reachability tests**

Prove ordinary grant rejection, matching Phase/Question/Line grant acceptance, mismatch rejection, and a mandatory `authorization:<id> granted` gate satisfied by a matching represented-authority producer. Reuse current HPA-257 validation/solver.

- [ ] **Step 4: Add Rust schema field + command tests**

```rust
#[serde(default)]
represented_authority: Option<String>,
```

Prove legacy `None`, matching `Some`, matching grant success, missing/mismatched authority failure, and one-shot replay idempotence.

- [ ] **Step 5: Add one private `interrogation_story_context(...)` constructor**

The helper accepts the owning immutable `InterrogationPhaseJson` and reads its `represented_authority` itself. It constructs `StoryRevealMaterializationContext`, including assertion origin and fact support. Where borrow boundaries require it, clone the immutable Phase definition before mutating scene state.

- [ ] **Step 6: Route every interrogation context through the helper**

Grep all raw `StoryRevealMaterializationContext` constructions. Interrogation origins `InterrogationPhase`, `InquiryQuestion`, and `TestimonyLine` must use the helper, including both InquiryQuestion paths: auto-break and post-correct-line. Investigation/Analysis remain authority-null. Grep again after edits; no interrogation-origin raw literal remains.

- [ ] **Step 7: Update authoring guidance**

Document Phase authority, exact catalog matching, and the KAGAMI hearing example; replace stale pre-HPA-264 grant restriction. Do not edit the already-current Analysis skill.

- [ ] **Step 8: Verify and commit**

```bash
bun test packages/scripts/compile-scenes/parser-interrogation.test.ts packages/scripts/compile-scenes/validator.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes/emitter.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml authorization --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
git add packages/scripts/compile-scenes apps/game/src-tauri/src/game/schema.rs apps/game/src-tauri/src/game/mod.rs .claude/skills/writing-interrogation-scene/SKILL.md
git commit -m "feat(story): carry represented hearing authority"
```

---

### Task 3: Add minimal production catalog + truthful Threshold provenance

**Files:**
- Create `docs/stories_plan/story_catalog.md`
- Modify `investigation_scene_7.md`
- Modify `investigation_scene_8.md`

**Boundary:** this task is independently compilable. Catalog definitions do not need producers merely because they exist; reachability errors apply when authored nodes require unreachable progress.

- [ ] **Step 1: Add parser-complete catalog**

Four Facts with Summary/Details/`Category: chapter_1`; secondary Objective `prepare_narrow_lock_request`; Authorization `narrow_lock_export` granted by `KAGAMI 證據摘要審查會主理`; Source Groups `door_lock_fixed_record` and `victim_phone_device`, each with Summary.

- [ ] **Step 2: Add truthful provenance**

```text
victim_phone_notification -> victim_phone_device, [time]
local_sequence_record -> door_lock_fixed_record, [order]
external_maintenance_credential -> door_lock_fixed_record, [order, access]
```

Door-lock records remain one source group.

- [ ] **Step 3: Prove independent compile and commit**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS before `analysis_scene_8_5.md` exists. If a definition-without-producer is rejected, investigate the regression; do not merge Task 3 into Task 4 merely to hide it.

```bash
git add docs/stories_plan/story_catalog.md docs/stories_plan/chapter_1/investigation_scene_7.md docs/stories_plan/chapter_1/investigation_scene_8.md
git commit -m "feat(story): define Chapter 1 analysis progress"
```

---

### Task 4: Author real production `analysis_scene_8_5.md`

**Files:**
- Create `analysis_scene_8_5.md`
- Modify `chapter.md`
- Delete `scene_8_5.md`
- Modify `semantic-content-reaudit.md`

- [ ] **Step 1: Replace manifest entry and migrate useful atmosphere**

Keep late-night/vending-machine/fatigue beats; do not narrate solutions before interaction.

- [ ] **Step 2: Author Classify `evidence_packages`**

Use real records `closing_routine`, `cake_box`, `miyake_mother_call_log`, `miyake_pov_replay`, `external_maintenance_credential`, `local_sequence_record`, `victim_phone_notification`; group into small lies / earlier third party / lock chronology; output first two facts.

- [ ] **Step 3: Author Order `local_event_sequence`**

Event-1841 → Event-1844, fixed 1841@1, every card source `evidence:local_sequence_record`, output `merge_time_is_not_event_time`.

- [ ] **Step 4: Author Threshold `narrow_request_basis`**

Use the three provenance records; require 2 selected / 2 source groups / `[time, order]` / no procedural-status restriction / source group required. Output final fact + complete request objective. Add one same-source Incorrect Selection only.

- [ ] **Step 5: Outro, delete old file, preserve audit history**

Outro: request prepared, identity unresolved, clip unavailable. Delete `scene_8_5.md`. Add a short supersession note near top of `semantic-content-reaudit.md` marking its old linear-scene references as historical pre-HPA-265 findings; do not rewrite the audit.

- [ ] **Step 6: Compile/test and commit**

```bash
bun run scenes:compile
bun run test:scripts
git add docs/stories_plan
git commit -m "feat(story): author Chapter 1 Beat 8.5 analysis"
```

---

### Task 5: Hearing confirmation + load-bearing authorization

**Files:** `interrogation_scene_10.md` + focused Rust test.

- [ ] **Step 1: Shorten p1–p4 to formal confirmation**

Keep existing contradictions/proof order; p5+ stays unchanged.

- [ ] **Step 2: Make `gate` represented authority event**

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

Correct gate:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

- [ ] **Step 3: Gate p4 on actual authorization grammar**

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

Do not author normalized JSON spelling `authorization_granted:narrow_lock_export`.

- [ ] **Step 4: Verify**

```bash
bun run scenes:compile
bun run test:scripts
```

Rust acceptance proves objective absent → grant impossible; wrong evidence → no grant/clip; correct gate → grant+clip atomic; p4 unavailable before authorization and reachable after; replay/restore no duplicate effects.

- [ ] **Step 5: Commit**

```bash
git add docs/stories_plan/chapter_1/interrogation_scene_10.md apps/game/src-tauri/src/game
git commit -m "feat(story): connect Beat 8.5 to hearing grant"
```

---

### Task 6: Focused packaged Beat 8.5 smoke + canonical CI ownership

**Files:**
- `e2e_checkpoints.rs`
- new `analysis-beat85.e2e.ts`
- E2E suite registry + tests
- E2E risk selector + tests
- checkpoint contract tests.

Do not expand `production-journey.e2e.ts`.

- [ ] **Step 1: Add `chapter-1-analysis-beat-85-ready` checkpoint**

Seed required real records through existing packaged definitions/`AcquisitionCtx`, clear presentation-only pending events for the test seed, jump to `analysis_scene_8_5`, expose Analysis mode. No production seed API.

- [ ] **Step 2: Add `analysis-beat85` to canonical suite order and gameplay chain**

Place immediately after `production-journey` in `E2E_SUITE_IDS`, define only `analysis-beat85.e2e.ts`, and add to gameplay chain same position. Update registry tests; flattened chain ownership must equal all suite ids.

- [ ] **Step 3: Add to story/compiler risk rule**

```js
["smoke", "gameplay", "production-journey", "analysis-beat85"]
```

Update selector tests so Chapter 1 story/compiler changes select it.

- [ ] **Step 4: Drive one packaged path**

Ready checkpoint → solve Classify → solve Order → one-card Threshold draft → Save → Title → Continue once → exact draft → solve Threshold → debug jump to hearing preserving state → p1-p3 → gate → assert authorization + approved clip + p4 reachability. Stop there.

- [ ] **Step 5: Verify and commit**

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

After Tasks 0–6 are green, stop for human Beat 8.5 → hearing playtest. Evaluate board clarity, detective feel/pacing, p1–p4 repetition, same-source feedback, Save/Continue confidence, keyboard usability, and thumbnail value. If no concrete misunderstanding appears, richer hints are not needed. If one appears, prefer authored wording/existing Hint/one exact Incorrect Selection before runtime semantics. No empty playtest commit.

---

### Task 7: Final verification and completion handoff

- [ ] **Step 1: Story/compiler/frontend/Rust**

```bash
bun run scenes:compile
bun run test:scripts
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts src/lib/components/analysis/AnalysisWorkbench.test.ts src/lib/components/analysis/ClassifyBoard.test.ts src/lib/components/analysis/OrderBoard.test.ts src/lib/components/analysis/ThresholdBoard.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

- [ ] **Step 2: E2E ownership + focused suite**

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

- [ ] **Step 4: Final assertions**

Confirm shared-source proof before production authoring; no Chapter 2/framework/migration/fake Event evidence/hint engine; audit note present; p4 requires authorization; E2E suite belongs to gameplay chain + story/compiler rule; production-journey stays narrow; four facts/objective established; grant absent before hearing; grant+clip exact once; p4 gated; Case File authority shown; proof order retained; Rust Order/Threshold restores green; one packaged Threshold Save → Title → Continue green.

- [ ] **Step 5: Update Linear after fresh evidence**

Mark HPA-265 Done. HPA-262/263/264/266 remain Duplicate.

---

## Stop conditions

Stop and re-review if shared-source proof requires a deeper model change, production boards change culprit/proof order, represented authority needs mutable state, authorization cannot stay atomic, p4 cannot use existing authorization predicate, E2E checkpoint needs a production API, or HPA-603/HPA-601 proves blocking. No stop condition authorizes Chapter 2 abstractions or a generic redesign.
