# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and accept the real Chapter 1 Beat 8.5 three-board Analysis scene, connect its request-readiness output to the existing KAGAMI hearing's represented-authority grant, prove one core packaged Save/Continue path, and leave subjective playtest as an explicit human acceptance gate.

**Architecture:** Reuse HPA-259/260/261 Analysis, HPA-255/257 story state and reveal transactions, HPA-129 save/load, and the existing Chapter 1 hearing. Add one optional interrogation-phase `Represented Authority` definition field propagated through existing compiler/reachability/Rust contexts. Production content uses real Chapter 1 records; Event-1841..1844 remain Analysis cards backed by the one real `local_sequence_record` evidence item.

**Tech Stack:** Bun 1.3.1, TypeScript scene compiler, Markdown story authoring, Rust/Tauri `GameEngine`, Svelte Analysis workbench, current save schema, existing E2E checkpoint/save harness.

## Global Constraints

- Start implementation from latest `main`, never from the superseded HPA-262 planning branch.
- HPA-265 is the single survivor for former HPA-262/263/264/266 scope.
- Chapter 1 is the product target; no Chapter 2 content or future-template abstractions.
- Reuse existing Classify/Order/Threshold runtime/UI. No new board kind, evaluator, registry, store, or renderer.
- Reuse HPA-255 StoryState mutations. No second authorization/objective state owner.
- Reuse HPA-257 reveal transaction/idempotence. No grant ledger.
- `analysis_scene_8_5` may complete `prepare_narrow_lock_request` but must never grant `narrow_lock_export`.
- Only the existing KAGAMI hearing gate may grant `narrow_lock_export` in production.
- Do not split `local_sequence_record` into four Case File evidence items.
- Threshold v1 uses truthful source groups + proof capabilities; no artificial procedural-status gate.
- Remove the old unreferenced `scene_8_5.md` after its useful dialogue is migrated.
- No backward-compatibility/save migration for this pre-release content revision.
- Rich progressive hints are conditional on human playtest evidence and are not an implementation prerequisite.
- `.claude/skills/writing-analysis-scene/SKILL.md` on current `main` already supports Classify/Order/Threshold production Analysis; do not modify it merely to restate that contract.
- Any unexpected architecture expansion is a stop condition.

---

### Task 1: Close only the missing incomplete-draft restore proofs

**Files:**
- Modify/Test: `apps/game/src-tauri/src/game/analysis_integration_tests.rs`
- Verify existing frontend Analysis tests; no frontend edit expected.

**Interfaces:**
- Consumes: existing `detached_restore()`, `analysis_token()`, `board()`, and the Chapter-1-shaped fixture.
- Produces: one exact incomplete save/restore proof for Order and Threshold, completing the existing Classify coverage.

- [ ] **Step 1: Baseline the existing cross-board Rust acceptance**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS.

- [ ] **Step 2: Add incomplete Order restore**

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

Then continue with the existing correct full Order draft. The partial draft preserves the fixed `event_1841@1` anchor.

- [ ] **Step 3: Add incomplete Threshold restore**

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

- [ ] **Step 4: Do not add another public-wire assertion**

Existing Rust/frontend contract coverage already checks the three board variants and recursively rejects accepted-answer fields. Keep those tests as-is.

Run the focused frontend matrix only as regression evidence:

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Re-run focused Rust acceptance**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

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
- Modify: focused Rust tests/fixtures only where needed
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

Add a parser case with:

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

Run the focused parser test and confirm RED.

- [ ] **Step 2: Add AST + optional emitted JSON field**

In `ASTInquiryPhase`:

```ts
representedAuthority: string | null;
```

In `JSONInterrogationPhase`:

```ts
representedAuthority?: string;
```

Parse only on Phase metadata. Emit only when non-null:

```ts
...(phase.representedAuthority === null
  ? {}
  : { representedAuthority: phase.representedAuthority })
```

Do not emit `representedAuthority: null` on legacy content.

- [ ] **Step 3: RED — validate phase authority inheritance for every reveal carrier**

Through production-style interrogation validation, cover:

```text
ordinary phase + grant -> authorizationGrantOutsideAuthorityEvent
matching phase authority + phase reveal -> valid
matching phase authority + question reveal -> valid
matching phase authority + testimony-line On Correct reveal -> valid
wrong phase authority + grant -> authorizationGrantAuthorityMismatch
```

Do not add a second authorization validator.

- [ ] **Step 4: Propagate authority through `buildStoryRevealTargetBatches()`**

For interrogation scenes:

```text
phase.reveals                     -> phase.representedAuthority
question.reveals                  -> phase.representedAuthority
question.testimony.lines.reveals  -> phase.representedAuthority
```

Investigation stays `null`.

- [ ] **Step 5: RED/GREEN — propagate the same authority into whole-corpus reachability**

Add one mandatory `authorization:<id> granted` fixture whose producer is a matching represented-authority interrogation phase.

Before the change, the producer should still look authority-null and fail reachability. Update the interrogation node builder so phase, question, and testimony-line nodes inherit the owning phase authority.

Do not change the solver; it already knows how matching authority produces an authorization atom.

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

Extend `InterrogationPhaseJson::Inquiry` with:

```rust
#[serde(default)]
represented_authority: Option<String>,
```

First add tests proving:

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

- [ ] **Step 8: Propagate authority to every interrogation story context — grep, do not enumerate from memory**

Search `apps/game/src-tauri/src/game/mod.rs` for every `StoryRevealMaterializationContext` and classify by `StoryEventBlockKind`.

Every context whose origin is:

```text
InterrogationPhase
InquiryQuestion
TestimonyLine
```

must derive the current owning phase authority and use:

```rust
represented_authority: phase_authority.as_deref()
```

This includes both legal InquiryQuestion reveal paths:

- honest/auto-break question completion;
- question-level reveals applied after a correct contradiction line.

Investigation contexts stay `None`. Analysis board submission stays `None`.

- [ ] **Step 9: Update interrogation authoring guidance**

In `.claude/skills/writing-interrogation-scene/SKILL.md`:

- document optional Phase `Represented Authority`;
- explain that it is immutable definition context, not a grant;
- allow `grant_authorization:<id>` only under a phase whose authority exactly matches catalog `Granting Authority`;
- preserve that Investigation and Analysis cannot grant;
- replace the stale "production grants unavailable until HPA-264" paragraph with the Chapter 1 KAGAMI hearing example.

Do **not** edit `writing-analysis-scene/SKILL.md`; current `main` already documents playable Classify/Order/Threshold correctly.

- [ ] **Step 10: Run Rust tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml authorization --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add \
  packages/scripts/compile-scenes \
  apps/game/src-tauri/src/game/schema.rs \
  apps/game/src-tauri/src/game/mod.rs \
  .claude/skills/writing-interrogation-scene/SKILL.md
git commit -m "feat(story): carry represented hearing authority"
```

Review staged files before committing; include only tests actually changed.

---

### Task 3: Add the minimal production story catalog and truthful Threshold provenance

**Files:**
- Create: `docs/stories_plan/story_catalog.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_8.md`

**Interfaces:**
- Produces the four facts, one secondary objective, one authorization, and two source-group definitions consumed by Tasks 4–6.

- [ ] **Step 1: Create a parser-complete production catalog — paste this shape, do not leave ids only**

```markdown
# Story Catalog

## Facts

### Fact: 三宅已知小謊與殺人無關 {#miyake_known_lies_are_unrelated_to_murder}

- **Summary:** 三宅隱瞞的通話與蛋糕盒都有與殺人無關的理由。
- **Details:** 已取得的閉店流程、通話與蛋糕盒資料足以把已知小謊和殺人指控分開。
- **Category:** chapter_1

### Fact: 更早的外部進入存在 {#earlier_external_entry_exists}

- **Summary:** 有外部維護憑證事件早於三宅進入後場。
- **Details:** 視角重演與固定門鎖紀錄只證明更早第三者事件存在，尚未對應到具名人物。
- **Category:** chapter_1

### Fact: 合併時間不是事件時間 {#merge_time_is_not_event_time}

- **Summary:** 門鎖本機事件先後不能被摘要合併時間取代。
- **Details:** Event-1841 至 Event-1844 的本機順序與摘要顯示的合併時間是不同層次的資訊。
- **Category:** chapter_1

### Fact: 已辨識兩條獨立門鎖時序矛盾 {#two_independent_lock_contradictions_identified}

- **Summary:** 兩個獨立來源共同支持有限門鎖調取申請。
- **Details:** 後場門鎖本機順序與死者手機時間錨提供不同來源的時間／順序矛盾。
- **Category:** chapter_1

## Objectives

### Objective: 準備有限門鎖調取申請 {#prepare_narrow_lock_request}

- **Summary:** 整理足以送進審查的獨立門鎖時序矛盾。
- **Kind:** secondary
- **Sort Order:** 1

## Authorizations

### Authorization: 後場門鎖限定調出 {#narrow_lock_export}

- **Summary:** 核准調閱限定範圍的後場門鎖摘要對照片段。
- **Granting Authority:** KAGAMI 證據摘要審查會主理

## Source Groups

### Source Group: 後場門鎖程序固定資料 {#door_lock_fixed_record}

- **Summary:** 鑑識正式固定的後場門鎖本機順序與外包憑證資料。

### Source Group: 死者手機裝置資料 {#victim_phone_device}

- **Summary:** 從死者手機本體取得的通知時間與裝置側紀錄。
```

Do not add Questions, Chapter 2 definitions, or a generalized category taxonomy.

- [ ] **Step 2: Add truthful phone provenance**

On `evidence:victim_phone_notification` in `investigation_scene_7.md` add:

```markdown
- **Source Kind:** digital
- **Representation Layer:** raw
- **Source Group:** victim_phone_device
- **Source Label:** 死者手機通知紀錄
- **Proof Capabilities:** [time]
```

Leave unsupported provenance dimensions at neutral defaults.

- [ ] **Step 3: Add one shared door-lock source identity**

On both `evidence:local_sequence_record` and `evidence:external_maintenance_credential` in `investigation_scene_8.md` add:

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

Do not split the source group.

- [ ] **Step 4: Run source-level compiler tests together with Task 4 content**

The catalog may temporarily have producers not yet authored. Do not weaken validation or add fake producers just to make an intermediate commit green. Keep Task 3 changes uncommitted until Task 4 makes the production flow valid if necessary.

---

### Task 4: Author the real production `analysis_scene_8_5.md`

**Files:**
- Create: `docs/stories_plan/chapter_1/analysis_scene_8_5.md`
- Modify: `docs/stories_plan/chapter_1/chapter.md`
- Delete after migration: `docs/stories_plan/chapter_1/scene_8_5.md`
- Include Task 3 catalog/provenance files in the same commit if compilation requires their producers.

**Authoring reference:** current `.claude/skills/writing-analysis-scene/SKILL.md` plus Chapter 1 canon. Do not copy synthetic fixture dialogue.

- [ ] **Step 1: Replace the manifest entry**

Replace:

```text
scene_8_5.md
```

with:

```text
analysis_scene_8_5.md
```

Keep surrounding order unchanged.

- [ ] **Step 2: Migrate only useful atmosphere/character beats into Intro/Outro**

Intro retains:

```text
late-night police-station / vending-machine atmosphere
Soma and Hayasaka fatigue
Hayasaka forcing Soma to separate what each record actually proves
Kurose's procedural confirmation only where needed
```

Do not narrate the board solutions before the player acts.

- [ ] **Step 3: Author Classify board `evidence_packages`**

Cards:

```text
closing_routine                 -> evidence:closing_routine
cake_box                        -> evidence:cake_box
miyake_mother_call              -> evidence:miyake_mother_call_log
miyake_pov_replay               -> evidence:miyake_pov_replay
external_maintenance_credential -> evidence:external_maintenance_credential
local_sequence_record           -> evidence:local_sequence_record
victim_phone_notification       -> evidence:victim_phone_notification
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

- [ ] **Step 4: Author Order board `local_event_sequence`**

```markdown
- **Kind:** order
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed
- **Accepted Order:** [event_1841, event_1842, event_1843, event_1844]
- **Fixed Anchors:** [event_1841@1]
- **Reveals:** [assert_fact:merge_time_is_not_event_time]
```

Create four distinct cards, but every card uses:

```markdown
- **Source:** evidence:local_sequence_record
```

Their labels/summaries describe the four rows. They are not independent evidence sources.

- [ ] **Step 5: Author Threshold board `narrow_request_basis`**

```markdown
- **Kind:** threshold
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@local_event_sequence completed
- **Eligible Cards:** [lock_sequence, external_credential, phone_notification]
- **Minimum Selected:** 2
- **Minimum Distinct Source Groups:** 2
- **Required Proof Capabilities:** [time, order]
- **Allowed Procedural Statuses:** []
- **Require Source Group:** true
- **Reveals:** [assert_fact:two_independent_lock_contradictions_identified, complete_objective:prepare_narrow_lock_request]
```

Cards:

```text
lock_sequence       -> evidence:local_sequence_record
external_credential -> evidence:external_maintenance_credential
phone_notification  -> evidence:victim_phone_notification
```

Add exactly one authored same-source teaching response:

```markdown
### Incorrect Selection

- **Cards:** [lock_sequence, external_credential]
- **Feedback:** 這兩項都來自同一份後場門鎖固定資料，還缺一個獨立來源。
```

No progressive hint levels yet.

- [ ] **Step 6: Author Outro without claiming authorization**

Outro meaning:

```text
the existing story is insufficient
we have enough independent contradiction to prepare a narrow request
we still do not know the earlier entrant's identity
approved_clip is not yet available
```

- [ ] **Step 7: Delete the obsolete linear file**

```bash
git rm docs/stories_plan/chapter_1/scene_8_5.md
```

- [ ] **Step 8: Compile and run script tests**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS with one production Analysis Beat 8.5, all real card sources resolved, shared-source Order cards accepted, Threshold satisfiable, and no duplicate manifest entry.

If shared card sources expose a real compiler/runtime bug, add the smallest failing test and patch that bug. Do not split the evidence source.

- [ ] **Step 9: Commit Task 3 + Task 4 production source together if needed**

```bash
git add docs/stories_plan
git commit -m "feat(story): author Chapter 1 Beat 8.5 analysis"
```

---

### Task 5: Turn the existing hearing into concise confirmation + authority grant

**Files:**
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_10.md`
- Test through compiler + focused Rust integration.

**Decision:** keep p1–p4 order because it is part of the existing final proof order, but rewrite those beats as formal confirmation of Analysis conclusions rather than a second tutorial.

- [ ] **Step 1: Make the hearing Intro state the new role explicitly**

Add a short line such as:

```markdown
**早坂茜**：整理板已經把幾條結論分開了。今天不是重做一次，是讓審查會正式確認哪些能進紀錄。
```

Trim nearby setup if needed so this does not add repetition.

- [ ] **Step 2: Shorten p1 to formal confirmation of the small-lie conclusion**

Keep the existing contradiction id and phase order, but replace tutorial-style setup with the equivalent of:

```markdown
**神谷澪**：第一項。整理板把三宅的小謊和殺人切開了；我要確認的是，那些隱瞞是否都有別的材料對得上。
```

Keep `evidence:closing_routine` as the mechanical contradiction. `On Correct` should end with a concise institutional acceptance, not another explanation of every card.

- [ ] **Step 3: Shorten p2 to formal confirmation of the earlier-time conflict**

Keep `evidence:victim_phone_notification` as the contradiction. Replace the long re-derivation with the equivalent of:

```markdown
**神谷澪**：第二項。整理板已經指出時間衝突；現在只確認，死亡時間錨是否確實早於摘要。
```

`On Correct` records the conclusion without walking through the Classify package again.

- [ ] **Step 4: Shorten p3 to formal confirmation of the earlier-third-party/sightline conflict**

Keep `evidence:miyake_pov_replay` as the contradiction and phase order. Use the equivalent of:

```markdown
**神谷澪**：第三項。整理板已經把更早的外部進入和三宅分開；現在確認他的站位是不是確實看不到內側倉庫。
```

Do not retell the whole `earlier_third_party` group.

- [ ] **Step 5: Make the existing gate the represented authority event**

On the `gate` phase containing `q_request_clip` / `gate_hold_record` add:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

At `gate_hold_record` `On Correct` use one authored-order reveal transaction:

```markdown
  - **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

No separate grant button or API.

- [ ] **Step 6: Trim p4 so it formalizes the approved-clip interpretation instead of replaying the Order tutorial**

Keep `evidence:local_sequence_record` as the existing mechanical contradiction and preserve phase order. The copy should now say, in substance:

```text
the approved clip and local sequence are now side-by-side
the only question is whether the summary merge time was misread as event time
```

Do not re-teach Event-1841..1844 one-by-one.

- [ ] **Step 7: Leave later culprit-proof phases unchanged**

No removal/reordering of p5+ or final culprit proof.

- [ ] **Step 8: Compiler + focused grant acceptance**

```bash
bun run scenes:compile
bun run test:scripts
```

Add/extend a focused Rust integration test proving:

```text
prepare_narrow_lock_request absent -> gate grant impossible
wrong gate evidence -> no authorization, no approved_clip
correct gate line -> authorization + approved_clip in one command
replay/restore -> no duplicate authorization/evidence/acquisition effect
```

- [ ] **Step 9: Commit**

```bash
git add docs/stories_plan/chapter_1/interrogation_scene_10.md apps/game/src-tauri/src/game
git commit -m "feat(story): connect Beat 8.5 to hearing grant"
```

Include only Rust tests actually changed.

---

### Task 6: Add one Beat 8.5-ready packaged checkpoint and one Save/Continue/grant smoke

**Files:**
- Modify: `apps/game/src-tauri/src/game/e2e_checkpoints.rs`
- Create: `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- Modify: `apps/game/scripts/e2e-suite-registry.mjs`
- Modify: matching suite-registry/checkpoint contract tests as required
- Reuse existing helpers: `jumpToProductionScene`, save/title/continue helpers, packaged game-state access.
- Do **not** extend `production-journey.e2e.ts` beyond its current P1 -> first KAGAMI acquisition job.

**Interfaces:**
- Produces a test-only production-resources checkpoint `chapter-1-analysis-beat-85-ready` with the Case File inventory required by Beat 8.5 and the later hearing gate.

- [ ] **Step 1: RED — add the checkpoint id/contract test**

Add:

```rust
#[serde(rename = "chapter-1-analysis-beat-85-ready")]
AnalysisBeat85Ready,
```

Before implementing its builder, the checkpoint contract should fail/unreach.

- [ ] **Step 2: Add a test-only helper that seeds packaged evidence through the existing acquisition path**

Inside `e2e_checkpoints.rs`, add a private helper conceptually shaped as:

```rust
fn seed_evidence(
    engine: &mut GameEngine,
    chapter_id: &str,
    scene_id: &str,
    record_id: &str,
) -> Result<(), GameError> {
    let source_scene = engine.packaged_acquisition_scene(chapter_id, scene_id)?;
    let definition = match source_scene {
        SceneJson::Investigation(scene) => scene
            .evidence_manifest
            .into_iter()
            .find(|item| item.id == record_id),
        SceneJson::Interrogation(scene) => scene
            .evidence_manifest
            .into_iter()
            .find(|item| item.id == record_id),
        _ => None,
    }
    .ok_or_else(GameError::missing_acquisition_definition)?;

    let mut next_ordinal = 0;
    AcquisitionCtx {
        catalog: &engine.story_catalog,
        inventory: &mut engine.inventory,
        pending_events: &mut engine.pending_acquisition_events,
        command_id: 0,
        next_ordinal: &mut next_ordinal,
    }
    .evidence(&definition, chapter_id, scene_id)?;
    engine.pending_acquisition_events.clear();
    Ok(())
}
```

Use the exact existing error constructor/imports available at implementation time; do not create a production seed API.

Clearing the pending acquisition presentations is intentional for this E2E state seed; acquisition presentation semantics are covered elsewhere.

- [ ] **Step 3: Seed the exact records needed by Beat 8.5 and the hearing gate**

Seed:

```text
investigation_scene_3:
  closing_routine
  doorlock_summary_timetable

interrogation_scene_4:
  cake_box
  miyake_mother_call_log

investigation_scene_7:
  miyake_pov_replay
  victim_phone_notification

investigation_scene_8:
  local_sequence_record
  external_maintenance_credential
```

Then:

```rust
engine.jump_to_scene("chapter_1", "analysis_scene_8_5")?;
```

Return only when the projected scene/mode is the production Analysis scene.

- [ ] **Step 4: Register one standalone focused E2E suite rather than expanding `production-journey`**

Add one suite id:

```text
analysis-beat85
```

whose only spec is:

```text
./e2e-tauri/analysis-beat85.e2e.ts
```

Update suite-registry tests that pin allowed ids/spec ownership.

Keep `production-journey` unchanged. Do not add `analysis-beat85` to `E2E_CHAIN_DEFINITIONS.gameplay` unless the existing registry validation requires every suite to belong to a chain; it is an HPA-265 acceptance suite and may run explicitly plus as part of `--full` selection.

- [ ] **Step 5: Drive Classify and Order once using existing accessible controls**

In `analysis-beat85.e2e.ts`, load the new checkpoint, then use visible labels/aria text rather than hidden answer JSON.

Classify interaction follows the shipped UI contract:

```text
click card button with accessible name starting `選取：<card label>`
click `放入「<group label>」`
repeat for seven cards
submit board
```

Order uses the existing shipped Order controls/labels to produce `1841 -> 1842 -> 1843 -> 1844`, then submit.

Do not add generic drag/drop automation if the component already exposes button/keyboard controls.

- [ ] **Step 6: Use exactly one packaged Save -> Title -> Continue checkpoint on Threshold**

On `narrow_request_basis`, select only `lock_sequence`, then save a manual slot.

Perform:

```text
Save -> return to Title -> Continue/load that save
```

Assert native packaged state still shows:

```text
scene = analysis_scene_8_5
active board = narrow_request_basis
draft selected ids = [lock_sequence]
```

Then select `phone_notification` and submit the correct Threshold.

Do **not** repeat packaged restore for Classify or Order; Task 1 owns those exact persistence variants.

- [ ] **Step 7: Skip Scene 9 only through the existing E2E debug jump, preserving state**

After Analysis completes, use existing:

```ts
await jumpToProductionScene("interrogation_scene_10");
```

This is a test-only route skip. It must retain the facts/objective/inventory produced before the jump.

- [ ] **Step 8: Complete concise p1–p3 confirmations and the grant gate**

Use the seeded contradictions:

```text
p1 -> closing_routine
p2 -> victim_phone_notification
p3 -> miyake_pov_replay
gate -> doorlock_summary_timetable
```

After the gate correct line, assert packaged public state contains:

```text
authorization: narrow_lock_export
evidence: approved_clip
```

Do not continue through the entire remaining hearing. The grant is the packaged boundary under test.

Same-source Threshold feedback remains covered by compiler/Rust/Svelte tests, not this E2E.

Result-dialogue resume remains covered by Rust, not this E2E.

- [ ] **Step 9: Run the focused packaged suite**

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add \
  apps/game/src-tauri/src/game/e2e_checkpoints.rs \
  apps/game/e2e-tauri/analysis-beat85.e2e.ts \
  apps/game/scripts/e2e-suite-registry.mjs \
  apps/game/scripts/*e2e*test.mjs \
  apps/game/e2e-tauri/checkpoint-contract.e2e.ts
git commit -m "test(e2e): cover Chapter 1 Beat 8.5 handoff"
```

Review staged files and include only files actually required by the new checkpoint/suite.

---

## Human acceptance gate — not an agent task

After Tasks 1–6 and automated verification are green, stop and hand the production build to the user.

Ask the user to play Beat 8.5 -> hearing and evaluate:

```text
clarity of each board question
detective feel and pacing
whether p1–p4 feel like formal confirmation instead of repetition
same-source feedback comprehension
Save/Continue confidence
keyboard-only usability
whether save thumbnails materially help identify the save
```

### If no concrete misunderstanding is observed

Record in the implementation PR/Linear update:

```text
Rich contextual/progressive hints not needed for Chapter 1 first version.
```

Do not add former HPA-263 scope and do not create an empty commit.

### If one concrete misunderstanding is observed

Make one focused content iteration using, in order of preference:

```text
Prompt wording
Card/Group wording
existing Hint field
one exact Incorrect Selection
```

Only propose new runtime feedback semantics if the observed problem cannot be expressed by existing authored fields.

Re-run the affected compiler/frontend tests after the user-requested iteration.

---

### Task 7: Final automated verification and completion handoff

**Precondition:** Tasks 1–6 are green and the human acceptance gate has either approved the first version or requested changes that have since been addressed.

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

- [ ] **Step 4: Focused packaged Beat 8.5 smoke**

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

Do not require a title-to-hearing production-journey replay.

- [ ] **Step 5: Repository policy gates**

```bash
bun run test
bun run check
bun run lint:all
```

Use current repo script names if they changed; do not add wrapper scripts merely to preserve this plan's spelling.

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
no generic authority event family
no new authorization state owner
no save migration
no four fake Event evidence records
no duplicate playable scene_8_5
no unneeded progressive-hint system
production-journey.e2e.ts not expanded into a chapter runner
```

- [ ] **Step 7: Fresh product acceptance assertions**

Confirm from automated evidence + human gate:

```text
Beat 8.5 four facts established
prepare_narrow_lock_request completed
narrow_lock_export absent before hearing authority event
narrow_lock_export present after the gate exactly once
approved_clip acquired atomically with the grant
Case File shows authorization + granting authority
final proof order retained, with p1–p4 shortened to confirmation
Order and Threshold incomplete drafts restore in Rust
one real packaged Threshold draft survives Save -> Title -> Continue
```

- [ ] **Step 8: Update Linear after fresh evidence is green**

Mark HPA-265 Done. HPA-262/263/264/266 remain Duplicate and are not reopened.

HPA-265 completion releases the post-Chapter-1 hardening/product-decision and deferred Chapter 2 re-planning issues now blocked by it.

---

## Implementation stop conditions

Stop and re-review rather than widening scope if:

1. production boards require changing the Chapter 1 culprit or final proof order;
2. shared Analysis card sources reveal a deeper invariant that cannot be fixed with a narrow test/bugfix;
3. represented authority requires mutable runtime state instead of immutable phase definition data;
4. authorization cannot remain atomic through the existing reveal transaction;
5. the hearing gate cannot carry the grant while retaining the established proof order;
6. a Beat 8.5 E2E checkpoint cannot seed production records through existing test-only engine/acquisition seams without adding a production API;
7. packaged play demonstrates HPA-603/HPA-601 is a real blocker.

A stop condition does not authorize Chapter 2 abstractions or a generic redesign.
