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

This helper is intentionally local to `mod.rs`, like `interrogation_segment()`. It is not a new subsystem abstraction.

- [ ] **Step 9: Route every interrogation story reveal through the constructor**

Grep all `StoryRevealMaterializationContext` constructions in `mod.rs`. Every context whose origin is:

```text
InterrogationPhase
InquiryQuestion
TestimonyLine
```

must call `interrogation_story_context(...)` with the owning phase.

This includes both InquiryQuestion paths:

- honest/auto-break question completion;
- question-level reveals after a correct contradiction line.

Investigation contexts remain raw/authority-null. Analysis board submission remains authority-null.

After editing, grep again and assert there is no interrogation-origin raw context literal left.

- [ ] **Step 10: Update interrogation authoring guidance**

In `.claude/skills/writing-interrogation-scene/SKILL.md`:

- document optional Phase `Represented Authority`;
- explain that it is immutable definition context, not a grant;
- allow `grant_authorization:<id>` only under a phase whose authority exactly matches catalog `Granting Authority`;
- preserve that Investigation and Analysis cannot grant;
- replace the stale "production grants unavailable until HPA-264" paragraph with the Chapter 1 KAGAMI hearing example.

Do **not** edit `writing-analysis-scene/SKILL.md`.

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

Review staged files and include only tests actually changed.

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

- [ ] **Step 4: Compile this task independently**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS **before** `analysis_scene_8_5.md` exists. Unused catalog definitions do not need fake producers.

If this step fails because a definition-without-producer is rejected, treat that as an unexpected regression against the current HPA-257 reachability model and investigate it. Do not merge Task 3 into Task 4 merely to hide the failure.

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

**Authoring reference:** current `.claude/skills/writing-analysis-scene/SKILL.md` plus Chapter 1 canon. Do not copy synthetic fixture dialogue.

- [ ] **Step 1: Replace the manifest entry**

Replace `scene_8_5.md` with `analysis_scene_8_5.md` and keep surrounding order unchanged.

- [ ] **Step 2: Migrate only useful atmosphere/character beats into Intro/Outro**

Intro retains:

```text
late-night police-station / vending-machine atmosphere
Soma and Hayasaka fatigue
Hayasaka forcing Soma to separate what each record actually proves
Kurose procedural confirmation only where needed
```

Do not narrate board solutions before the player acts.

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

- [ ] **Step 4: Author Order board `local_event_sequence` using the already-proven shared source**

```markdown
- **Kind:** order
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed
- **Accepted Order:** [event_1841, event_1842, event_1843, event_1844]
- **Fixed Anchors:** [event_1841@1]
- **Reveals:** [assert_fact:merge_time_is_not_event_time]
```

Create four distinct cards. Every card uses:

```markdown
- **Source:** evidence:local_sequence_record
```

Their labels/summaries describe the four rows. They are reasoning units, not four independent Case File records.

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

Add exactly one same-source response:

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
the narrow request is prepared
the earlier entrant's identity remains unresolved
approved_clip is not yet available
```

- [ ] **Step 7: Delete the obsolete linear file**

```bash
git rm docs/stories_plan/chapter_1/scene_8_5.md
```

- [ ] **Step 8: Mark the old semantic re-audit references as historical**

Near the top of `semantic-content-reaudit.md`, add a concise supersession note rather than rewriting the historical audit:

```markdown
## HPA-265 supersession note

This re-audit captured the pre-Analysis Chapter 1 manifest. HPA-265 later replaces
`scene_8_5.md` with `analysis_scene_8_5.md`; references below to the deleted
linear file are historical findings against that earlier production snapshot,
not the current manifest.
```

Keep the historical findings themselves intact.

- [ ] **Step 9: Compile and run script tests**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS with one production Analysis Beat 8.5, all real card sources resolved, Threshold satisfiable, and no duplicate manifest entry.

Shared-source support was already proven in Task 0. If it fails here, treat it as a production-specific difference, not an invitation to split the evidence.

- [ ] **Step 10: Commit**

```bash
git add docs/stories_plan
git commit -m "feat(story): author Chapter 1 Beat 8.5 analysis"
```

---

### Task 5: Turn the existing hearing into concise confirmation + a load-bearing authority grant

**Files:**
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_10.md`
- Test through compiler + focused Rust integration.

**Decision:** keep p1–p4 order because it is part of the established final proof order, but rewrite those beats as formal confirmation of Analysis conclusions rather than a second tutorial.

- [ ] **Step 1: Make the hearing Intro state the new role explicitly**

Use a short line such as:

```markdown
**早坂茜**：整理板已經把幾條結論分開了。今天不是重做一次，是讓審查會正式確認哪些能進紀錄。
```

Trim nearby setup if needed so this does not add repetition.

- [ ] **Step 2: Shorten p1–p3 to formal confirmation**

Keep their existing contradiction ids and order:

```text
p1 -> evidence:closing_routine
p2 -> evidence:victim_phone_notification
p3 -> evidence:miyake_pov_replay
```

Each phase should state the conclusion already organized in Analysis, ask only for the institutional confirmation, and end with concise acceptance. Do not replay all Classify cards.

- [ ] **Step 3: Make `gate` the represented authority event**

On the existing `gate` phase:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

At `gate_hold_record` `On Correct` use one authored-order reveal transaction:

```markdown
  - **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

No separate grant button or API.

- [ ] **Step 4: Make the authorization mechanically gate p4**

Change p4 from:

```markdown
- **Unlock:** phase:gate completed
```

to the actual authoring grammar:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

Do **not** author `authorization_granted:narrow_lock_export`; that is the normalized JSON predicate name, not Markdown syntax.

This one line makes the authority path load-bearing in production: the matching grant producer must remain reachable or the compiler can reject the mandatory p4 path.

- [ ] **Step 5: Shorten p4 to formal interpretation**

Keep `evidence:local_sequence_record` as its contradiction. The copy should now say only:

```text
the approved clip and local sequence are side-by-side
the remaining question is whether summary merge time was misread as event time
```

Do not re-teach Event-1841..1844 row-by-row.

- [ ] **Step 6: Leave later culprit-proof phases unchanged**

No removal/reordering of p5+ or final culprit proof.

- [ ] **Step 7: Compiler + focused grant acceptance**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected compiler evidence:

```text
prepare_narrow_lock_request is a reachable prerequisite of gate
gate is a matching represented-authority grant producer
p4 requires authorization:narrow_lock_export granted
approved_clip remains acquired only through gate_hold_record correct resolution
```

Add/extend a focused Rust integration test proving:

```text
objective absent -> gate grant impossible
wrong gate evidence -> no authorization, no approved_clip
correct gate line -> authorization + approved_clip in one command
p4 becomes available only after the grant
replay/restore -> no duplicate authorization/evidence/acquisition effect
```

- [ ] **Step 8: Commit**

```bash
git add docs/stories_plan/chapter_1/interrogation_scene_10.md apps/game/src-tauri/src/game
git commit -m "feat(story): connect Beat 8.5 to hearing grant"
```

Include only Rust tests actually changed.

---

### Task 6: Add one Beat 8.5-ready packaged checkpoint and wire it into existing E2E ownership

**Files:**
- Modify: `apps/game/src-tauri/src/game/e2e_checkpoints.rs`
- Create: `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- Modify: `apps/game/scripts/e2e-suite-registry.mjs`
- Modify: `apps/game/scripts/e2e-suite-registry.test.mjs`
- Modify: `apps/game/scripts/select-e2e-suites.mjs`
- Modify: matching selection/checkpoint tests
- Reuse existing helpers: `jumpToProductionScene`, save/title/continue helpers, packaged game-state access.
- Do **not** extend `production-journey.e2e.ts` beyond its current P1 → first KAGAMI acquisition job.

**Interfaces:**
- Produces a test-only production-resources checkpoint `chapter-1-analysis-beat-85-ready` and one owned CI suite `analysis-beat85`.

- [ ] **Step 1: RED — add the checkpoint id/contract test**

Add:

```rust
#[serde(rename = "chapter-1-analysis-beat-85-ready")]
AnalysisBeat85Ready,
```

Before implementing its builder, the checkpoint contract should fail/unreach.

- [ ] **Step 2: Add a test-only packaged evidence seeder**

Inside `e2e_checkpoints.rs`, add a private helper that resolves the real packaged scene/record and routes acquisition through the existing `AcquisitionCtx`. Its shape should remain test-only:

```rust
fn seed_evidence(
    engine: &mut GameEngine,
    chapter_id: &str,
    scene_id: &str,
    record_id: &str,
) -> Result<(), GameError> {
    // resolve the packaged definition
    // call AcquisitionCtx::evidence(...)
    // clear presentation-only pending acquisition events for this checkpoint seed
    Ok(())
}
```

Use existing error constructors/imports at implementation time. Do not add a production seed API.

- [ ] **Step 3: Seed the exact records needed by Beat 8.5 and the hearing gate**

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

Return only when the projection is the production Analysis scene.

- [ ] **Step 4: Register `analysis-beat85` in the canonical suite list and gameplay chain**

The registry requires every suite to belong to exactly one chain in canonical order. Add:

```js
export const E2E_SUITE_IDS = Object.freeze([
  "smoke",
  "gameplay",
  "production-journey",
  "analysis-beat85",
  "capture-proof",
  "save-core",
  "save-management",
  "exit-lifecycle",
]);
```

Add the suite definition:

```js
Object.freeze({
  id: "analysis-beat85",
  phases: Object.freeze([
    phase("analysis-beat85", "analysis-beat85", "analysisBeat85", [
      "./e2e-tauri/analysis-beat85.e2e.ts",
    ]),
  ]),
}),
```

Update the gameplay chain to:

```js
suiteIds: Object.freeze([
  "smoke",
  "gameplay",
  "production-journey",
  "analysis-beat85",
]),
```

Update pinned registry tests in the same commit. Do not leave this suite chain-less; current tests assert flattened chain ownership equals `E2E_SUITE_IDS`.

- [ ] **Step 5: Make story/compiler changes select the new suite**

In the `story-and-compiler` risk rule, use:

```js
suiteIds: ["smoke", "gameplay", "production-journey", "analysis-beat85"],
```

Update `select-e2e-suites` tests to prove a Chapter 1 story or compiler change selects `analysis-beat85` in canonical order.

The new suite must not exist only under `--full`; it protects the content being changed by HPA-265.

- [ ] **Step 6: Drive Classify and Order once using shipped accessible controls**

In `analysis-beat85.e2e.ts`, load the checkpoint and use visible labels/aria text rather than hidden answer JSON.

Classify follows the shipped control contract:

```text
select card
click `放入「<group label>」`
repeat
submit
```

Order uses existing buttons/keyboard controls to produce `1841 → 1842 → 1843 → 1844`, then submit. Do not add drag/drop infrastructure.

- [ ] **Step 7: Use exactly one packaged Save → Title → Continue on Threshold**

On `narrow_request_basis`, select only `lock_sequence`, save a manual slot, then:

```text
Save -> Title -> Continue/load that save
```

Assert packaged native state still shows:

```text
scene = analysis_scene_8_5
active board = narrow_request_basis
draft selected ids = [lock_sequence]
```

Then select `phone_notification` and submit correctly.

Do not repeat packaged restore for Classify or Order; Task 1 owns those variants.

- [ ] **Step 8: Skip Scene 9 only through the existing E2E debug jump, preserving state**

After Analysis completes:

```ts
await jumpToProductionScene("interrogation_scene_10");
```

This test-only route skip must retain facts/objective/inventory produced before the jump.

- [ ] **Step 9: Complete p1–p3 confirmations and the grant gate**

Use:

```text
p1 -> closing_routine
p2 -> victim_phone_notification
p3 -> miyake_pov_replay
gate -> doorlock_summary_timetable
```

After gate resolution assert:

```text
authorization: narrow_lock_export
evidence: approved_clip
p4 visible/reachable
```

Do not continue through the rest of the hearing.

Same-source Threshold feedback remains in focused compiler/Rust/Svelte tests. Result-dialogue resume remains in Rust.

- [ ] **Step 10: Run registry/selection tests and focused packaged suite**

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

- [ ] **Step 11: Commit**

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

After Tasks 0–6 and automated verification are green, stop and hand the production build to the user.

Evaluate:

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

Make one focused content iteration using, in order:

```text
Prompt wording
Card/Group wording
existing Hint field
one exact Incorrect Selection
```

Only propose new runtime feedback semantics if the observed problem cannot be expressed by existing authored fields.

---

### Task 7: Final automated verification and completion handoff

**Precondition:** Tasks 0–6 are green and the human gate has approved the first version or requested changes that have since been addressed.

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

- [ ] **Step 4: E2E ownership + focused Beat 8.5 smoke**

```bash
bun test \
  apps/game/scripts/e2e-suite-registry.test.mjs \
  apps/game/scripts/select-e2e-suites.test.mjs
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

Do not require a title-to-hearing `production-journey` replay.

- [ ] **Step 5: Repository policy gates**

```bash
bun run test
bun run check
bun run lint:all
```

Use current repo script names if they changed; do not add wrappers merely to preserve this plan's spelling.

- [ ] **Step 6: Final scope review**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Confirm:

```text
shared-source support proved before production authoring
no Chapter 2 files
no second Analysis framework
no generic authority event family
no new authorization state owner
no save migration
no four fake Event evidence records
no duplicate playable scene_8_5
semantic-content-reaudit marks deleted scene_8_5 references historical
p4 requires authorization:narrow_lock_export granted
analysis-beat85 belongs to gameplay chain and story/compiler risk selection
production-journey.e2e.ts is not expanded into a chapter runner
no unneeded progressive-hint system
```

- [ ] **Step 7: Fresh product acceptance assertions**

Confirm from automated evidence + human gate:

```text
Beat 8.5 four facts established
prepare_narrow_lock_request completed
narrow_lock_export absent before hearing authority event
narrow_lock_export present after gate exactly once
p4 unavailable without authorization and available after grant
approved_clip acquired atomically with the grant
Case File shows authorization + granting authority
final proof order retained, with p1–p4 shortened to confirmation
Order and Threshold incomplete drafts restore in Rust
one real packaged Threshold draft survives Save -> Title -> Continue
```

- [ ] **Step 8: Update Linear after fresh evidence is green**

Mark HPA-265 Done. HPA-262/263/264/266 remain Duplicate and are not reopened.

---

## Implementation stop conditions

Stop and re-review rather than widening scope if:

1. Task 0 proves shared Analysis-card sources require a deeper model change than a narrow compiler/runtime bugfix;
2. production boards require changing the Chapter 1 culprit or final proof order;
3. represented authority requires mutable runtime state instead of immutable phase definition data;
4. authorization cannot remain atomic through the existing reveal transaction;
5. p4 cannot be gated by the existing authorization predicate without breaking the established hearing flow;
6. the Beat 8.5 E2E checkpoint cannot seed production records through existing test-only engine/acquisition seams without adding a production API;
7. packaged play demonstrates HPA-603/HPA-601 is a real blocker.

A stop condition does not authorize Chapter 2 abstractions or a generic redesign.
