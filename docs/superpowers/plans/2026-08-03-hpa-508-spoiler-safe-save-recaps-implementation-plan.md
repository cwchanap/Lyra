# HPA-508 Spoiler-Safe Save Recaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Save Browser and Continue from exposing the active scene's authored summary until the captured scene state proves that scene is complete.

**Architecture:** Keep the existing schema-v2 envelope, recap component, discovery flow, and restore rules. Derive `sceneSummary` eligibility from the already-validated `SceneProgressSnapshotV1` produced during capture: active linear scenes and unfinished investigation/interrogation scenes persist `None`; completed investigation/interrogation and `GameComplete` persist the authored scene summary.

**Tech Stack:** Rust 2021, Serde, existing save capture/restore subsystem, Svelte 5, Vitest 4, WebdriverIO/Tauri packaged E2E, Bun 1.3.1.

## Global Constraints

- Required merge order: `HPA-508 -> HPA-540 -> HPA-260`.
- Implement against the current `main` names (`capture_checkpoint_v2`, `SaveSummaryV2`, `SceneProgressSnapshotV1`). HPA-540 owns their later unversioned rename.
- Do not add `SaveEnvelopeV3`, `SaveSnapshotV2`, a migration, a new persisted completion field, or a second recap model.
- Do not change save positioning: `summary.sceneId` / `sceneTitle` and `snapshot.chapterId` / `sceneId` remain the actual current checkpoint.
- Do not change chapter-summary or active-primary-objective recap behavior.
- Do not reconstruct absent recap prose during discovery.
- Do not edit authored Chapter 1 summaries, generated scene JSON, save schema types, storage, restore, or Save Browser layout unless a failing test demonstrates an existing contract defect.
- `outroPlayed: true` is the current persisted completion signal for investigation/interrogation. `GameComplete` is complete. A valid linear checkpoint is always in progress.
- Keep existing migration behavior until HPA-540 removes the unshipped compatibility path; HPA-508 must not add migration-specific requirements or tests.

---

## Current seam and no-change proof

The current capture flow always copies `CapturedLocation.scene_summary` into `SaveSummaryV2.scene_summary`, even though capture has already produced a validated `SceneProgressSnapshotV1` containing the required completion signal.

Existing downstream contracts already support the desired absence:

- `SaveSummaryV2.scene_summary` is `Option<String>`.
- `validate_save_summary` accepts `None` and only validates authored equality when copy is present.
- `SaveRecapDetails.svelte` renders scene prose only when `summary.sceneSummary` is non-null.
- Existing migrated V1 summaries already use `None` for the added prose fields.

Therefore the production behavior change belongs in `capture.rs`; frontend work is regression coverage only.

---

### Task 1: Make captured scene-summary copy completion-aware

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Test: inline `game::save::capture::tests`

**Interfaces:**
- Consumes: validated `SceneProgressSnapshotV1` returned by `capture_scene_progress_with_active`.
- Produces: `scene_summary_for_checkpoint(scene: &SceneProgressSnapshotV1, authored_summary: &str) -> Option<String>`.
- Leaves unchanged: `CapturedLocation`, `SaveSummaryV2`, `validate_save_summary`, restore positioning, and schema version.

- [ ] **Step 1: Turn the existing active-linear wire test into a failing spoiler regression**

In `captures_active_linear_checkpoint_as_exact_wire_value`, change only the expected scene recap field:

```rust
"sceneSummary": null,
```

Keep `sceneId`, `sceneTitle`, chapter copy, objective copy, active dialogue, and snapshot expectations unchanged.

- [ ] **Step 2: Add failing assertions to the existing unfinished investigation and interrogation capture tests**

In `captures_investigation_progress_inventory_and_composite_queue_deterministically`:

```rust
assert_eq!(captured.summary.scene_summary, None);
```

In `captures_interrogation_playing_and_presenting_with_stable_line_ids`:

```rust
assert_eq!(playing.summary.scene_summary, None);
assert_eq!(presenting.summary.scene_summary, None);
```

These tests prove that midpoint state, including an active composite queue or evidence-presentation state, cannot expose later authored outcomes.

- [ ] **Step 3: Add failing positive coverage for completed checkpoints**

Extend `captures_game_complete_with_the_retained_final_scene_identity`:

```rust
assert_eq!(
    captured.summary.scene_summary.as_deref(),
    Some("Fixture scene summary.")
);
```

Add focused capture tests for an investigation and interrogation with their current runtime state's `intro_played = true`, `outro_played = true`, and no pending queue. Each must assert:

```rust
assert_eq!(
    capture_checkpoint_v2(&engine)
        .unwrap()
        .summary
        .scene_summary
        .as_deref(),
    Some("Fixture scene summary.")
);
```

Use the existing `fixture_engine`, `jump_to_scene`, and fixture summaries; do not add a new test fixture or completion abstraction.

- [ ] **Step 4: Run the focused Rust tests and verify the new negative cases fail**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::capture::tests -- --nocapture
```

Expected before implementation: the active-linear, unfinished-investigation, and unfinished-interrogation summary assertions fail because capture currently persists authored scene prose.

- [ ] **Step 5: Implement the minimal snapshot-owned eligibility helper**

Add beside the capture helpers:

```rust
fn scene_summary_for_checkpoint(
    scene: &SceneProgressSnapshotV1,
    authored_summary: &str,
) -> Option<String> {
    match scene {
        SceneProgressSnapshotV1::GameComplete
        | SceneProgressSnapshotV1::Investigation {
            outro_played: true,
            ..
        }
        | SceneProgressSnapshotV1::Interrogation {
            outro_played: true,
            ..
        } => Some(authored_summary.to_owned()),
        SceneProgressSnapshotV1::Linear
        | SceneProgressSnapshotV1::Investigation { .. }
        | SceneProgressSnapshotV1::Interrogation { .. } => None,
    }
}
```

After `capture_scene_progress_with_active` returns, derive copy from that captured value before moving it into the snapshot:

```rust
let scene_summary = scene_summary_for_checkpoint(&scene, &location.scene_summary);
```

Use it in `SaveSummaryV2`:

```rust
scene_summary,
```

Do not inspect live `SceneRuntime` a second time and do not duplicate the completion rules in `capture_location` or discovery.

- [ ] **Step 6: Run focused Rust tests and verify all capture states pass**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::capture::tests -- --nocapture
```

Expected: PASS. The exact-wire test retains titles/current position, unfinished scenes emit `None`, and completed/game-complete states emit the authored fixture summary.

---

### Task 2: Lock the existing UI and packaged behavior without adding new surfaces

**Files:**
- Modify: `apps/game/src/lib/components/SaveRecapDetails.test.ts`
- Modify: `apps/game/e2e-tauri/save-seed.e2e.ts`
- Do not modify unless a test fails: `apps/game/src/lib/components/SaveRecapDetails.svelte`
- Do not modify: `apps/game/src/lib/persistence/types.ts`

**Interfaces:**
- Consumes: nullable `SaveSummaryView.sceneSummary` already emitted by Rust.
- Produces: regression proof that titles and other eligible copy remain visible while unfinished-scene prose is absent.

- [ ] **Step 1: Add a focused component regression for scene-only suppression**

Add a test that renders:

```ts
const unfinishedSceneSummary: SaveSummaryView = {
  ...completeSummary,
  sceneSummary: null,
};
```

Assert:

```ts
expect(screen.getByText(/第一章.*雨中的證言/)).toBeInTheDocument();
expect(screen.getByText("相馬律接下雨夜中的第一宗委託。"))
  .toBeInTheDocument();
expect(screen.getByText("律師事務所")).toBeInTheDocument();
expect(screen.queryByText("早坂帶來一份程序不明的調查摘要。"))
  .not.toBeInTheDocument();
expect(screen.getByText("詢問目擊者")).toBeInTheDocument();
expect(screen.getByText("釐清目擊者在雨夜看見的人影。"))
  .toBeInTheDocument();
expect(screen.getAllByTestId("recap-summary-copy")).toHaveLength(2);
```

Do not add fallback text or a component prop for completion.

- [ ] **Step 2: Run the focused component test**

Run:

```bash
bun run --cwd apps/game test \
  src/lib/components/SaveRecapDetails.test.ts
```

Expected: PASS without changing `SaveRecapDetails.svelte`, proving the existing nullable rendering contract already supports HPA-508.

- [ ] **Step 3: Update existing packaged save-seed assertions**

The existing packaged flow already creates all three unfinished scene families. Add:

```ts
expect(compositeEnvelope.summary.sceneSummary).toBeNull();
expect(interrogationEnvelope.summary.sceneSummary).toBeNull();
expect(unicodeEnvelope.summary.sceneSummary).toBeNull();
```

The first is a midpoint investigation, the second is an interrogation in presenting state, and the third is an active linear dialogue checkpoint.

Change the title-screen Continue assertion from non-null to:

```ts
expect(
  continueSlot.status.metadata.summary.sceneSummary,
).toBeNull();
```

Keep all existing assertions for chapter/scene titles, chapter summary, objective copy, save/load identity, cursor, and Continue selection. Existing conditional rendering loops should simply skip the null scene summary.

Do not create a new E2E suite or a second production navigation flow.

- [ ] **Step 4: Type-check the packaged test contract**

Run:

```bash
bun run --cwd apps/game check:e2e
```

Expected: PASS.

---

## Final verification gate

Run once after both tasks are integrated:

```bash
git diff --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run --cwd apps/game test \
  src/lib/components/SaveRecapDetails.test.ts
bun run check
bun run --cwd apps/game check:e2e
bun run test
bun run lint:all
bun run --cwd apps/game test:e2e:save
```

If packaged E2E cannot run in the execution environment, record the exact missing prerequisite and do not claim it passed.

## Completion search

Before review, run:

```bash
rg -n \
  'sceneSummary\).*not\.toBeNull|scene_summary:\s*Some\(location\.scene_summary\)|"sceneSummary":\s*"The detective arrives' \
  apps/game/src-tauri/src/game/save \
  apps/game/src/lib \
  apps/game/e2e-tauri
```

Classify every match. No active linear or unfinished investigation/interrogation test may require non-null scene prose.

## Review boundary

One focused implementation commit is sufficient; keep tests and behavior together. Do not split this small bug fix into schema, backend, frontend, or E2E architecture commits.

## HPA-540 handoff

The implementation PR must state:

- HPA-508 owns only completion-aware recap eligibility.
- HPA-540 may remove the unshipped V1 migration path and rename the current save/capture types after rebasing these tests.
- HPA-540 must preserve `scene_summary_for_checkpoint` behavior when it renames `SceneProgressSnapshotV1` and `capture_checkpoint_v2`.
- No HPA-508 test should make V1-to-V2 migration a lasting compatibility requirement.
