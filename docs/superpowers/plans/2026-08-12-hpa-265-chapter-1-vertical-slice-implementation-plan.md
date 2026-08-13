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

- [ ] **Step 1: Baseline the existing fixture tests**

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS on `main`.

- [ ] **Step 2: Make the compiler fixture's four Order cards share one existing source**

Keep card ids, labels, summaries, accepted order, and fixed anchor unchanged. Change only the four source lines:

```markdown
### Card: 維護模式開啟 {#event_1841}
- **Source:** evidence:lock_sequence

### Card: 外包憑證開門 {#event_1842}
- **Source:** evidence:lock_sequence

### Card: 員工憑證開門 {#event_1843}
- **Source:** evidence:lock_sequence

### Card: 伺服器合併完成 {#event_1844}
- **Source:** evidence:lock_sequence
```

Do not delete the fixture's `event_1841`..`event_1844` evidence rows in this task; they may still be useful fixture inventory elsewhere. The point is only to prove card-source non-uniqueness.

- [ ] **Step 3: Mirror the same source shape in the checked-in Rust Analysis JSON fixture**

In the `local_event_sequence` board, change each card's source to:

```json
{
  "kind": "evidence",
  "id": "lock_sequence"
}
```

Leave the four card ids and `acceptedOrder` untouched. The Rust fixture source scene already owns/acquires `lock_sequence`, so no new test record is required.

- [ ] **Step 4: Run compiler and runtime acceptance**

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS.

If RED, fix only the narrow shared-source bug proven by this fixture. Do not move on to production authoring and do not split production evidence as a workaround.

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
- Consumes: existing `detached_restore()`, `analysis_token()`, `board()`, and the now-shared-source Chapter-1-shaped fixture.
- Produces: exact incomplete save/restore proofs for Order and Threshold, completing the existing Classify coverage.

- [ ] **Step 1: Add incomplete Order restore**

After Classify completion and selection of `local_event_sequence`, write:

```rust
let partial_order = AnalysisDraft::Order {
    card_ids: vec!["event_1841".into(), "event_1843".into()],
};
view = restored
    .update_analysis_draft(analysis_token(&view), partial_order.clone())
    .unwrap();
assert!(matches!(
    board(&view, "local_event_sequence"),
    AnalysisBoardView::Order { draft, .. } if draft == &partial_order
));

let order_revision = restored.durable_revision;
restored = detached_restore(&restored, &resources);
assert_eq!(restored.durable_revision, order_revision);
view = restored.view().unwrap();
assert!(matches!(
    board(&view, "local_event_sequence"),
    AnalysisBoardView::Order { draft, .. } if draft == &partial_order
));
```

The partial draft preserves the fixed `event_1841@1` anchor. Then continue with the existing correct full Order draft.

- [ ] **Step 2: Add incomplete Threshold restore**

After selecting `narrow_request_basis`, write:

```rust
let partial_threshold = AnalysisDraft::Threshold {
    selected_card_ids: BTreeSet::from(["lock_sequence".into()]),
};
view = restored
    .update_analysis_draft(analysis_token(&view), partial_threshold.clone())
    .unwrap();
assert!(matches!(
    board(&view, "narrow_request_basis"),
    AnalysisBoardView::Threshold { draft, .. } if draft == &partial_threshold
));

let threshold_revision = restored.durable_revision;
restored = detached_restore(&restored, &resources);
assert_eq!(restored.durable_revision, threshold_revision);
view = restored.view().unwrap();
assert!(matches!(
    board(&view, "narrow_request_basis"),
    AnalysisBoardView::Threshold { draft, .. } if draft == &partial_threshold
));
```

Then continue through the existing wrong/correct Threshold path.

- [ ] **Step 3: Do not add another public-wire assertion**

Existing Rust/frontend contract coverage already pins the three board variants and rejects accepted-answer fields. Re-run, do not duplicate:

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
```

Expected: PASS.

- [ ] **Step 4: Re-run focused Rust acceptance**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
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
- Test: focused parser/emitter/validator/reachability tests
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Verify: `apps/game/src-tauri/src/game/reveals.rs`
- Modify focused Rust tests/fixtures only where needed
- Modify docs: `.claude/skills/writing-interrogation-scene/SKILL.md`

**Interfaces:**
- Consumes: existing `validateStoryRevealTargets`, `ReachabilityNode.representedAuthority`, `StoryRevealMaterializationContext.represented_authority`, and `StoryState::grant_authorization`.
- Produces: one optional immutable phase definition field inherited by every story reveal in that interrogation phase.

**Authoring contract:**

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

No new scene family, command, save field, authority registry, or mutable grant state.

- [ ] **Step 1: RED — parser test for optional phase metadata**

Add a parser case:

```markdown
## Phase: 核准限定片段 {#gate}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

Expected AST:

```ts
representedAuthority: "KAGAMI 證據摘要審查會主理"
```

Retain a legacy phase with no field and expect `null`.

- [ ] **Step 2: Add AST + optional emitted JSON field**

In `ASTInquiryPhase`:

```ts
representedAuthority: string | null;
```

In `JSONInterrogationPhase`:

```ts
representedAuthority?: string;
```

Emit only when non-null:

```ts
...(phase.representedAuthority === null
  ? {}
  : { representedAuthority: phase.representedAuthority })
```

Do not emit `representedAuthority: null` on legacy content.

- [ ] **Step 3: RED — validate authority inheritance for every reveal carrier**

Through production-style interrogation validation, cover:

```text
ordinary phase + grant -> authorizationGrantOutsideAuthorityEvent
matching authority + phase reveal -> valid
matching authority + question reveal -> valid
matching authority + testimony-line On Correct reveal -> valid
wrong authority + grant -> authorizationGrantAuthorityMismatch
```

Do not add a second authorization validator.

- [ ] **Step 4: Propagate authority through compiler story-target batches**

For interrogation scenes:

```text
phase.reveals                     -> phase.representedAuthority
question.reveals                  -> phase.representedAuthority
question.testimony.lines.reveals  -> phase.representedAuthority
```

Investigation stays `null`.

- [ ] **Step 5: RED/GREEN — propagate the same authority into whole-corpus reachability**

Add one mandatory `authorization:<id> granted` fixture whose producer is a matching represented-authority interrogation phase.

Before the change, the producer is authority-null and fails reachability. Update interrogation node construction so phase, question, and testimony-line nodes inherit the owning phase authority.

Do not change the HPA-257 solver.

- [ ] **Step 6: Run TypeScript compiler tests**

```bash
bun test \
  packages/scripts/compile-scenes/parser-interrogation.test.ts \
  packages/scripts/compile-scenes/validator.test.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts \
  packages/scripts/compile-scenes/reachability.test.ts \
  packages/scripts/compile-scenes/emitter.test.ts
```

Expected: PASS.

- [ ] **Step 7: RED — Rust serde + command-path authority tests**

Extend `InterrogationPhaseJson::Inquiry`:

```rust
#[serde(default)]
represented_authority: Option<String>,
```

First prove:

```text
legacy missing field -> None
matching field -> Some("KAGAMI 證據摘要審查會主理")
```

Then add a command-path interrogation test proving:

```text
matching phase authority + grant -> authorization appears once
None + grant -> runtime/validation error
wrong authority + grant -> runtime/validation error
consumed correct-line replay -> no second durable grant
```

- [ ] **Step 8: Extract one private interrogation story-context constructor**

Do not hand-build four nearly identical `StoryRevealMaterializationContext` literals. Add one private helper in `mod.rs` that accepts the owning `InterrogationPhaseJson` and reads authority itself:

```rust
fn interrogation_story_context<'a>(
    chapter_id: &str,
    scene_id: &str,
    phase: &'a InterrogationPhaseJson,
    block_kind: StoryEventBlockKind,
    block_id: impl Into<String>,
    fact_support_by_id: &'a BTreeMap<String, reveals::FactSupport>,
) -> reveals::StoryRevealMaterializationContext<'a> {
    let InterrogationPhaseJson::Inquiry {
        represented_authority,
        ..
    } = phase;
    reveals::StoryRevealMaterializationContext {
        origin: AssertionOrigin::SceneEvent {
            chapter_id: chapter_id.into(),
            scene_id: scene_id.into(),
            block_kind,
            block_id: block_id.into(),
        },
        fact_support_by_id,
        represented_authority: represented_authority.as_deref(),
    }
}
```

Where borrow boundaries require it, clone the current immutable phase definition before taking a mutable scene borrow; do not fall back to a raw context literal.

- [ ] **Step 9: Route every interrogation story reveal through the constructor**

Grep all `StoryRevealMaterializationContext` constructions in `mod.rs`. Every context whose origin is `InterrogationPhase`, `InquiryQuestion`, or `TestimonyLine` must call `interrogation_story_context(...)` with the owning phase.

This includes both InquiryQuestion paths: honest/auto-break completion and question-level reveals after a correct contradiction.

Investigation and Analysis keep their existing authority-null contexts. After editing, grep again and assert no interrogation-origin raw context literal remains.

- [ ] **Step 10: Update interrogation authoring guidance**

In `.claude/skills/writing-interrogation-scene/SKILL.md`, document Phase `Represented Authority`, its matching-catalog requirement, and the KAGAMI hearing example. Replace the stale pre-HPA-264 production-grant restriction. Preserve that Investigation and Analysis cannot grant.

- [ ] **Step 11: Run Rust tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml authorization --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add \
  packages/scripts/compile-scenes \
  apps/game/src-tauri/src/game/schema.rs \
  apps/game/src-tauri/src/game/mod.rs \
  .claude/skills/writing-interrogation-scene/SKILL.md
git commit -m "feat(story): carry represented hearing authority"
```

---

### Task 3: Add the minimal production story catalog and truthful Threshold provenance

**Files:**
- Create: `docs/stories_plan/story_catalog.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_8.md`

**Interfaces:**
- Produces the four facts, one secondary objective, one authorization, and two source-group definitions consumed by Tasks 4–6.
- This task is independently compilable. Catalog definitions are not required to have producers merely because they exist; reachability errors apply when authored nodes require unreachable progress.

- [ ] **Step 1: Create a parser-complete production catalog**

Use exactly four Facts with parser-required `Summary`, `Details`, and `Category: chapter_1`; one secondary Objective `prepare_narrow_lock_request`; Authorization `narrow_lock_export` granted by `KAGAMI 證據摘要審查會主理`; and Source Groups `door_lock_fixed_record` / `victim_phone_device`, each with Summary.

Do not add Questions, Chapter 2 definitions, or a generalized category taxonomy.

- [ ] **Step 2: Add truthful phone provenance**

On `evidence:victim_phone_notification` add:

```markdown
- **Source Kind:** digital
- **Representation Layer:** raw
- **Source Group:** victim_phone_device
- **Source Label:** 死者手機通知紀錄
- **Proof Capabilities:** [time]
```

Leave unsupported provenance dimensions neutral.

- [ ] **Step 3: Add one shared door-lock source identity**

On both `evidence:local_sequence_record` and `evidence:external_maintenance_credential` add:

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
local_sequence_record           -> [order]
external_maintenance_credential -> [order, access]
```

- [ ] **Step 4: Compile this task independently**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS before `analysis_scene_8_5.md` exists. If a definition-without-producer is rejected, treat that as an unexpected regression; do not merge Task 3 into Task 4 merely to hide it.

- [ ] **Step 5: Commit**

```bash
git add \
  docs/stories_plan/story_catalog.md \
  docs/stories_plan/chapter_1/investigation_scene_7.md \
  docs/stories_plan/chapter_1/investigation_scene_8.md
git commit -m "feat(story): define Chapter 1 analysis progress"
```

---

### Task 4: Author the real production `analysis_scene_8_5.md`

**Files:**
- Create: `docs/stories_plan/chapter_1/analysis_scene_8_5.md`
- Modify: `docs/stories_plan/chapter_1/chapter.md`
- Delete: `docs/stories_plan/chapter_1/scene_8_5.md`
- Modify: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`

**Interfaces:**
- Consumes: Task 0 shared-source proof and Task 3 catalog/provenance.
- Produces: one canonical playable production Beat 8.5 with Classify → Order → Threshold outputs.

- [ ] **Step 1: Replace the manifest entry and migrate only useful atmosphere**

Replace `scene_8_5.md` with `analysis_scene_8_5.md`. Preserve late-night police-station/vending-machine atmosphere, partner fatigue, and only the procedural dialogue needed to frame the boards. Do not narrate solutions before interaction.

- [ ] **Step 2: Author Classify board `evidence_packages`**

Use real records:

```text
closing_routine
cake_box
miyake_mother_call_log
miyake_pov_replay
external_maintenance_credential
local_sequence_record
victim_phone_notification
```

Group into `miyake_small_lies`, `earlier_third_party`, and `lock_chronology_gap`. Reveal `miyake_known_lies_are_unrelated_to_murder` and `earlier_external_entry_exists`.

- [ ] **Step 3: Author Order board `local_event_sequence` with shared source**

Keep card ids `event_1841`..`event_1844`, accepted order 1841 → 1842 → 1843 → 1844, fixed `event_1841@1`, and set every card source to `evidence:local_sequence_record`. Reveal `merge_time_is_not_event_time`.

- [ ] **Step 4: Author Threshold board `narrow_request_basis`**

Use `local_sequence_record`, `external_maintenance_credential`, `victim_phone_notification`; require 2 selected, 2 source groups, `[time, order]`, no procedural-status restriction, and `Require Source Group: true`. Reveal `two_independent_lock_contradictions_identified` and complete `prepare_narrow_lock_request`.

Add only one explicit same-source `Incorrect Selection` for the two door-lock records.

- [ ] **Step 5: Author Outro without claiming authorization**

State only that the narrow request is prepared and identity remains unresolved. `approved_clip` is still unavailable.

- [ ] **Step 6: Delete the obsolete linear file and mark audit references historical**

```bash
git rm docs/stories_plan/chapter_1/scene_8_5.md
```

Add a short `HPA-265 supersession note` near the top of `semantic-content-reaudit.md` explaining that its `scene_8_5.md` references describe the pre-Analysis production snapshot and are not current-manifest findings.

- [ ] **Step 7: Compile and test**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add docs/stories_plan
git commit -m "feat(story): author Chapter 1 Beat 8.5 analysis"
```

---

### Task 5: Turn the existing hearing into concise confirmation + a load-bearing authority grant

**Files:**
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_10.md`
- Test through compiler + focused Rust integration.

- [ ] **Step 1: Shorten p1–p4 to formal confirmation**

Keep existing contradictions and proof order. p1 confirms the small-lie conclusion, p2 the earlier-time conflict, p3 the sightline/earlier-third-party conflict, p4 the merge-time interpretation. Do not replay full board reasoning.

- [ ] **Step 2: Make `gate` the represented authority event**

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

At `gate_hold_record` correct resolution:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

- [ ] **Step 3: Make authorization mechanically gate p4**

Use the actual Markdown grammar:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

Do not use normalized JSON syntax `authorization_granted:narrow_lock_export`.

- [ ] **Step 4: Leave p5+ unchanged**

No later culprit-proof reorder/removal.

- [ ] **Step 5: Compiler + focused grant acceptance**

```bash
bun run scenes:compile
bun run test:scripts
```

Prove in Rust that absent objective blocks the grant, wrong evidence does not grant/acquire, correct gate grants + acquires atomically, p4 becomes available only after authorization, and replay/restore does not duplicate effects.

- [ ] **Step 6: Commit**

```bash
git add docs/stories_plan/chapter_1/interrogation_scene_10.md apps/game/src-tauri/src/game
git commit -m "feat(story): connect Beat 8.5 to hearing grant"
```

---

### Task 6: Add one Beat 8.5-ready packaged checkpoint and canonical E2E ownership

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

Seed the exact real records through existing packaged definitions/`AcquisitionCtx`, clear presentation-only pending acquisitions for the checkpoint seed, jump to `analysis_scene_8_5`, and return only in Analysis mode.

- [ ] **Step 2: Register `analysis-beat85` in suite + chain canonical order**

Place it immediately after `production-journey` in `E2E_SUITE_IDS`, define one phase/spec for `./e2e-tauri/analysis-beat85.e2e.ts`, and add it to the gameplay chain in the same position. Update registry tests. Current tests assert flattened chain ownership equals `E2E_SUITE_IDS`.

- [ ] **Step 3: Add `analysis-beat85` to story/compiler risk selection**

Change the rule to select:

```js
["smoke", "gameplay", "production-journey", "analysis-beat85"]
```

Update selection tests so Chapter 1 story/compiler changes prove this suite is selected.

- [ ] **Step 4: Drive the focused packaged flow**

From the ready checkpoint: solve Classify, solve Order, create one-card Threshold draft, Save → Title → Continue once, assert exact Threshold draft, solve Threshold, debug-jump to `interrogation_scene_10` retaining state, confirm p1–p3, resolve gate, assert `narrow_lock_export`, `approved_clip`, and p4 reachability.

Do not run a second packaged restore matrix or the remaining hearing.

- [ ] **Step 5: Run tests**

```bash
bun test \
  apps/game/scripts/e2e-suite-registry.test.mjs \
  apps/game/scripts/select-e2e-suites.test.mjs
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/game/src-tauri/src/game/e2e_checkpoints.rs \
  apps/game/e2e-tauri/analysis-beat85.e2e.ts \
  apps/game/e2e-tauri/checkpoint-contract.e2e.ts \
  apps/game/scripts/e2e-suite-registry.mjs \
  apps/game/scripts/e2e-suite-registry.test.mjs \
  apps/game/scripts/select-e2e-suites.mjs \
  apps/game/scripts/select-e2e-suites.test.mjs
git commit -m "test(e2e): cover Chapter 1 Beat 8.5 handoff"
```

---

## Human acceptance gate — not an agent task

After Tasks 0–6 are green, stop for human Beat 8.5 → hearing playtest. Evaluate board clarity, detective feel/pacing, whether p1–p4 feel like confirmation, same-source feedback comprehension, Save/Continue confidence, keyboard usability, and thumbnail identification value.

If no concrete misunderstanding appears, richer hints are not needed. If one appears, prefer Prompt/Card/Group wording, existing Hint, or one exact Incorrect Selection before new runtime semantics. No empty playtest commit.

---

### Task 7: Final automated verification and completion handoff

**Precondition:** Tasks 0–6 are green and the human gate has approved or requested changes that have since been addressed.

- [ ] **Step 1: Story/compiler + frontend + Rust gates**

```bash
bun run scenes:compile
bun run test:scripts
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

- [ ] **Step 2: E2E ownership + focused Beat 8.5 smoke**

```bash
bun test \
  apps/game/scripts/e2e-suite-registry.test.mjs \
  apps/game/scripts/select-e2e-suites.test.mjs
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

- [ ] **Step 3: Repository policy gates**

```bash
bun run test
bun run check
bun run lint:all
```

- [ ] **Step 4: Final scope review**

Confirm shared-source proof happened before production authoring; no Chapter 2 files/frameworks/migrations/fake Event evidence/hint engine were added; `semantic-content-reaudit.md` marks old `scene_8_5` references historical; p4 requires `authorization:narrow_lock_export granted`; `analysis-beat85` belongs to gameplay chain + story/compiler risk selection; and `production-journey.e2e.ts` remains narrow.

- [ ] **Step 5: Product assertions**

Confirm Beat 8.5 facts/objective, grant absence before hearing, exact-once grant + approved clip, p4 authorization gating, Case File authority display, final proof order, Rust incomplete Order/Threshold restore, and one real packaged Threshold Save → Title → Continue.

- [ ] **Step 6: Update Linear only after fresh evidence is green**

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
