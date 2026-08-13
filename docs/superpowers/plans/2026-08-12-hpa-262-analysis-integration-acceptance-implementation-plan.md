# HPA-262 Analysis Integration Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close HPA-262 by proving the already-shipped Classify, Order, and Threshold platform contracts integrate correctly across Rust public views, exact save/restore, the existing Svelte workbench, and the current packaged Analysis route.

**Architecture:** Treat HPA-262 as an acceptance-only layer over HPA-259/260/261. Extend the existing Chapter-1-shaped Rust integration test with the two missing incomplete-draft restore checkpoints and one concise public-wire assertion; reuse existing frontend board/workbench tests and the existing packaged P1 journey. Do not author production Beat 8.5 or add another runtime/UI abstraction.

**Tech Stack:** Rust, serde/serde_json, Bun 1.3.1, Vitest/Svelte Testing Library, existing Tauri packaged E2E harness, existing Analysis compiler fixture.

## Global Constraints

- Start implementation from latest `main`.
- Do not modify `docs/stories_plan/chapter_1/**`; HPA-265 owns the real production `analysis_scene_8_5.md` and content iteration.
- Do not modify the Analysis compiler/schema unless a fresh acceptance test exposes a concrete compiler defect.
- Do not create a new Analysis evaluator, provenance solver, store, renderer, registry, or board kind.
- Reuse `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/` as the Chapter-1-shaped platform acceptance corpus.
- Reuse `apps/game/src-tauri/src/game/analysis_integration_tests.rs` as the Rust lifecycle/save acceptance owner.
- Reuse the existing HPA-261 frontend tests instead of adding a second Svelte fixture family.
- Reuse the existing packaged `production-journey`; do not build a test-only Tauri resource-switching system to package the synthetic three-board fixture.
- HPA-262 must not grant `narrow_lock_export`; HPA-264 owns hearing-granted authorization.
- No backward-compatibility or save-migration machinery: this is still pre-release and the current save schema is the only supported development contract.
- Any production-code change requires a newly observed failing acceptance test. If all added acceptance tests pass on current code, HPA-262 may ship as tests/documentation only.

---

### Task 1: Pin the complete Rust public Analysis wire for all three board kinds

**Files:**
- Modify/Test: `apps/game/src-tauri/src/game/analysis_integration_tests.rs`

**Interfaces:**
- Consumes: existing `analysis_fixture_resources()`, `GameEngine::view()`, `serde_json::to_value`, and the compiled `evidence_packages`, `local_event_sequence`, `narrow_request_basis` fixture boards.
- Produces: one compact acceptance assertion proving the Rust producer emits the camelCase Classify/Order/Threshold public union expected by `apps/game/src/lib/state/types.ts`.

- [ ] **Step 1: Run the existing Rust Analysis acceptance test as the baseline**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS on current `main`. This establishes that HPA-262 is closing coverage/integration gaps rather than repairing a known runtime failure.

- [ ] **Step 2: Add a helper that asserts the producer-side public JSON contract**

Add beside the existing `assert_no_answer_keys()` helper:

```rust
fn assert_three_board_public_wire(view: &GameStateView) {
    let value = serde_json::to_value(view).unwrap();
    let scene = &value["scene"];

    assert_eq!(scene["kind"], "analysis");
    assert!(scene["actionToken"]["sceneId"].is_string());
    assert!(scene["actionToken"]["durableRevision"].is_number());
    assert!(scene["availableBoardIds"].is_array());

    let boards = scene["visibleBoards"]
        .as_array()
        .expect("Analysis visibleBoards must serialize as an array");
    assert_eq!(boards.len(), 3);

    let by_id = boards
        .iter()
        .map(|board| {
            (
                board["id"].as_str().expect("board id must be a string"),
                board,
            )
        })
        .collect::<BTreeMap<_, _>>();

    let classify = by_id["evidence_packages"];
    assert_eq!(classify["kind"], "classify");
    assert!(classify["groups"].is_array());
    assert_eq!(classify["draft"]["kind"], "classify");
    assert!(classify["draft"]["groupByCard"].is_object());

    let order = by_id["local_event_sequence"];
    assert_eq!(order["kind"], "order");
    assert!(order["fixedAnchors"].is_array());
    assert_eq!(order["draft"]["kind"], "order");
    assert!(order["draft"]["cardIds"].is_array());

    let threshold = by_id["narrow_request_basis"];
    assert_eq!(threshold["kind"], "threshold");
    assert_eq!(threshold["minimumSelected"], 2);
    assert!(threshold["selectedCardIds"].is_array());
    assert_eq!(threshold["draft"]["kind"], "threshold");
    assert!(threshold["draft"]["selectedCardIds"].is_array());

    for board in boards {
        assert!(board["available"].is_boolean());
        assert!(board["completed"].is_boolean());
        assert!(board["readOnly"].is_boolean());
        let cards = board["cards"]
            .as_array()
            .expect("Analysis board cards must serialize as an array");
        for card in cards {
            assert!(card["id"].is_string());
            assert!(card["source"]["kind"].is_string());
            assert!(card["available"].is_boolean());
            assert!(card.get("sourceLabel").is_some());
            assert!(card.get("sourceSummary").is_some());
        }
    }

    assert_no_answer_keys(&value);
}
```

The exact helper may use a small local lookup loop instead of a `BTreeMap` if imports make that clearer; do not create a reusable JSON-schema utility.

- [ ] **Step 3: Invoke the helper after the Analysis intro is drained**

In `analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage()`, after:

```rust
let mut view = engine.view().unwrap();
assert!(matches!(view.mode, ModeView::Analysis { .. }));
```

add:

```rust
assert_three_board_public_wire(&view);
```

This point is ideal because all three authored board variants are already present in `visibleBoards`, even though only the first board is currently available.

- [ ] **Step 4: Run the focused test**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS. If it fails because Rust's serialized field/kind shape disagrees with `apps/game/src/lib/state/types.ts`, stop and make the smallest producer/consumer correction under a new failing test before continuing. Do not paper over a real mismatch in the assertion.

- [ ] **Step 5: Commit the producer-side acceptance pin**

```bash
git add apps/game/src-tauri/src/game/analysis_integration_tests.rs
git commit -m "test(game): pin Analysis public wire contract"
```

---

### Task 2: Prove exact incomplete Order and Threshold save/resume

**Files:**
- Modify/Test: `apps/game/src-tauri/src/game/analysis_integration_tests.rs`

**Interfaces:**
- Consumes: existing `detached_restore()`, `analysis_token()`, `board()`, and the current save capture/restore implementation.
- Produces: one representative exact incomplete-draft restore proof for each of the two board kinds not already covered by the current partial-Classify checkpoint.

- [ ] **Step 1: Add an incomplete Order checkpoint before the existing complete Order submission**

After the test selects `local_event_sequence`, add:

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

let order_partial_revision = restored.durable_revision;
restored = detached_restore(&restored, &resources);
assert_eq!(restored.durable_revision, order_partial_revision);
view = restored.view().unwrap();
assert!(matches!(
    board(&view, "local_event_sequence"),
    AnalysisBoardView::Order { draft, .. } if draft == &partial_order
));
```

Then continue with the existing correct full Order draft. The partial draft deliberately keeps `event_1841` at fixed anchor position 1 while remaining incomplete.

- [ ] **Step 2: Run the focused test**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS. `detached_restore()` already asserts exact snapshot recapture, so do not add a second byte-comparison mechanism.

- [ ] **Step 3: Add an incomplete Threshold checkpoint before the existing wrong submission**

After selecting `narrow_request_basis`, add:

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

let threshold_partial_revision = restored.durable_revision;
restored = detached_restore(&restored, &resources);
assert_eq!(restored.durable_revision, threshold_partial_revision);
view = restored.view().unwrap();
assert!(matches!(
    board(&view, "narrow_request_basis"),
    AnalysisBoardView::Threshold { draft, .. } if draft == &partial_threshold
));
```

Then continue through the existing incorrect two-card submission and correct submission.

- [ ] **Step 4: Re-run the focused test**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS with Classify, Order, and Threshold each having one exact incomplete save/restore checkpoint.

- [ ] **Step 5: Check that no production runtime code was needed**

```bash
git diff --name-only HEAD~1..HEAD
git status --short
```

If a current-format restore bug is exposed, write a focused failing test for that exact bug and patch the smallest save/runtime file. Otherwise keep HPA-262 test-only.

- [ ] **Step 6: Commit the save/resume acceptance coverage**

```bash
git add apps/game/src-tauri/src/game/analysis_integration_tests.rs
git commit -m "test(game): cover all Analysis draft restores"
```

---

### Task 3: Re-run the existing frontend three-board interaction contract

**Files:**
- Verify: `apps/game/src/lib/analysis/analysis-boundary.test.ts`
- Verify: `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- Verify: `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`
- Verify: `apps/game/src/lib/components/analysis/OrderBoard.test.ts`
- Verify: `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`
- No frontend production edits expected.

**Interfaces:**
- Consumes: current typed `SceneView`, `AnalysisBoardView`, `AnalysisDraft`, HPA-261 Chapter-1-shaped frontend fixtures.
- Produces: acceptance evidence that the consumer side still understands and interacts with all three board variants using pointer/keyboard controls.

- [ ] **Step 1: Run the focused frontend matrix**

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
```

Expected: all selected files PASS.

- [ ] **Step 2: Review the existing tests against the HPA-262 acceptance matrix**

Confirm the matrix already contains evidence for:

```text
Classify  -> card/group interaction + unavailable/read-only handling
Order     -> ordering + fixed anchors + keyboard/pointer behavior
Threshold -> selection + keyboard/pointer behavior + provenance presentation
Workbench -> board navigation + authoritative action-token command flow
Boundary  -> all three public board kinds + no answer-key fields
```

Do not add duplicate tests merely to make HPA-262 own lines that HPA-261 already owns.

- [ ] **Step 3: Only if a matrix row is genuinely absent, add the smallest focused test to the existing owner file**

For example, if Order lacks keyboard/pointer parity, add one test to `OrderBoard.test.ts`; do not add an `HPA262.test.ts` aggregate file.

Run the same focused matrix after any such addition.

- [ ] **Step 4: Commit only if Task 3 required a real test addition**

```bash
git add apps/game/src/lib/analysis apps/game/src/lib/components/analysis
git commit -m "test(game-ui): close Analysis interaction acceptance gap"
```

If no frontend gap exists, make no commit for this task.

---

### Task 4: Run packaged regression and close the HPA-262 gate

**Files:**
- Verify only unless a fresh failure exposes a defect.

**Interfaces:**
- Consumes: real Chapter 1 P1 Threshold Analysis tutorial, Tauri commands, Rust runtime, Svelte workbench, existing packaged save/E2E harness.
- Produces: final HPA-262 acceptance evidence and handoff to HPA-264/HPA-265.

- [ ] **Step 1: Compile production story and compiler fixtures**

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS. HPA-262 does not change production story content.

- [ ] **Step 2: Run the complete Rust Analysis acceptance file**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_integration_tests --all-features -- --nocapture
```

If Cargo's substring filtering does not select the module as intended, run the full crate test instead:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Expected: PASS.

- [ ] **Step 3: Build the packaged game and run the existing production journey**

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite production-journey
cd ../..
```

Expected: the real Chapter 1 P1 Analysis tutorial completes through the current production path. This is a route/regression smoke; do not interpret it as production three-board Beat 8.5 authoring.

- [ ] **Step 4: Run final repository gates**

```bash
bun run test
bun run check
bun run lint:all
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Expected: all commands PASS.

- [ ] **Step 5: Review the final diff against scope**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected implementation diff by default:

```text
apps/game/src-tauri/src/game/analysis_integration_tests.rs
```

Planning documents may be present if the implementation is performed on top of this planning branch, but the recommended implementation branch should start fresh from `main` and use this plan as reference.

Unexpected production story/compiler/UI changes are a stop condition unless backed by a fresh failing HPA-262 acceptance test.

- [ ] **Step 6: Update the implementation PR description with the acceptance ownership boundary**

State explicitly:

```text
HPA-262 certifies the Chapter-1-shaped platform contract.
HPA-264 owns hearing-granted narrow_lock_export.
HPA-265 owns real production analysis_scene_8_5 authoring and iteration.
```

Also list the reuse evidence from HPA-259/260/261 so reviewers do not ask this PR to duplicate those implementations.

- [ ] **Step 7: After the implementation PR is accepted, update Linear**

- mark HPA-262 Done;
- preserve HPA-264 and HPA-265 as separate next work;
- do not mark HPA-265 done merely because the fixture uses Beat 8.5 names;
- retain HPA-603/HPA-601 as follow-up correctness work unless separately reprioritized.

---

## Self-review checklist

Before publishing implementation:

- HPA-262 adds no new product abstraction.
- Every new assertion maps to a concrete acceptance criterion not already strongly covered.
- Classify/Order/Threshold each have exact incomplete current-format restore evidence.
- Rust producer JSON and TypeScript consumer union agree on the three board variants.
- Existing frontend pointer/keyboard tests remain the interaction authority.
- Existing packaged P1 journey remains the only packaged Analysis smoke.
- Production `scene_8_5.md` is untouched.
- `narrow_lock_export` remains ungranted by Analysis.
- No Chapter 2 work appears in the diff.
