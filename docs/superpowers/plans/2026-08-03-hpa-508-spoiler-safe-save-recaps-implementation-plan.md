# HPA-508 Spoiler-Safe Save Recaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Save Browser and Continue from exposing the active scene's authored summary until the captured scene state proves that scene is complete.

**Architecture:** Keep the existing schema-v2 envelope, discovery, restore, and recap UI contracts. Derive `sceneSummary` eligibility from the already-validated `SceneProgressSnapshotV1` produced during capture, so recap copy cannot disagree with the durable scene state.

**Tech Stack:** Rust 2021, Serde, Svelte 5, Vitest 4, WebdriverIO/Tauri E2E, Bun 1.3.1.

## Global Constraints

- Merge order: `HPA-508 -> HPA-540 -> HPA-260`.
- Use the current `main` names (`capture_checkpoint_v2`, `SaveSummaryV2`, `SceneProgressSnapshotV1`). HPA-540 owns their later rename.
- No schema version, migration, persisted field, recap model, discovery fallback, or UI layout change.
- `summary.sceneId` / `sceneTitle` and snapshot positioning remain the actual current checkpoint.
- Chapter-summary and active-primary-objective recap behavior remain unchanged.
- `outro_played = true` is the current investigation/interrogation completion signal; `GameComplete` is complete; valid linear checkpoints are in progress.
- HPA-508 adds no migration-specific requirement or test. Existing migration behavior remains until HPA-540 removes it.

## Current seam

Capture currently copies `CapturedLocation.scene_summary` into every new `SaveSummaryV2`, even though it has already produced a validated `SceneProgressSnapshotV1` containing the completion signal.

No downstream production change is needed:

- `SaveSummaryV2.scene_summary` is already `Option<String>`.
- `validate_save_summary` already accepts absent copy and validates authored equality only when copy is present.
- `SaveRecapDetails.svelte` already renders scene prose only when present.
- Existing migrated V1 recap prose is already absent.

Required eligibility:

| Captured scene progress | `sceneSummary` |
|---|---|
| `Linear` | `None` |
| `Investigation { outro_played: false, .. }` | `None` |
| `Interrogation { outro_played: false, .. }` | `None` |
| `Investigation { outro_played: true, .. }` | authored summary |
| `Interrogation { outro_played: true, .. }` | authored summary |
| `GameComplete` | retained final-scene summary |

---

### Task 1: Apply the capture-owned eligibility rule

**Files:**
- Modify/test: `apps/game/src-tauri/src/game/save/capture.rs`

**Produces:**

```rust
fn scene_summary_for_checkpoint(
    scene: &SceneProgressSnapshotV1,
    authored_summary: &str,
) -> Option<String>
```

- [ ] **Write the failing capture regressions**

Update existing tests rather than creating new fixtures:

- `captures_active_linear_checkpoint_as_exact_wire_value`
  - change only `"sceneSummary"` to `null`;
  - retain current IDs, titles, chapter/objective copy, dialogue, and snapshot expectations.
- `captures_investigation_progress_inventory_and_composite_queue_deterministically`
  - assert `captured.summary.scene_summary == None`.
- `captures_interrogation_playing_and_presenting_with_stable_line_ids`
  - assert both captured summaries are `None`.
- `captures_game_complete_with_the_retained_final_scene_identity`
  - assert `Some("Fixture scene summary.")`.
- Add one completed-investigation and one completed-interrogation capture case using `fixture_engine`, `jump_to_scene`, `intro_played = true`, `outro_played = true`, and no pending queue; each expects `Some("Fixture scene summary.")`.

Run and confirm the unfinished cases fail before implementation:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::capture::tests -- --nocapture
```

- [ ] **Implement the minimal snapshot-based helper**

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

Immediately after `capture_scene_progress_with_active` returns:

```rust
let scene_summary = scene_summary_for_checkpoint(&scene, &location.scene_summary);
```

Pass `scene_summary` into `SaveSummaryV2`. Do not inspect live `SceneRuntime` again or duplicate this rule in `capture_location`, storage, discovery, or restore.

- [ ] **Run the focused Rust suite green**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::capture::tests -- --nocapture
```

Expected: all six eligibility states match the table and checkpoint positioning remains unchanged.

---

### Task 2: Lock existing rendering and packaged behavior

**Files:**
- Modify: `apps/game/src/lib/components/SaveRecapDetails.test.ts`
- Modify: `apps/game/e2e-tauri/save-seed.e2e.ts`
- Do not modify unless a test exposes a defect: `SaveRecapDetails.svelte`
- Do not modify: `apps/game/src/lib/persistence/types.ts`

- [ ] **Add scene-only nullable rendering coverage**

Render `{ ...completeSummary, sceneSummary: null }` and assert:

- chapter title and chapter summary remain;
- scene title remains;
- scene summary text is absent;
- objective label and summary remain;
- exactly two `recap-summary-copy` elements render;
- no fallback prose is invented.

Run:

```bash
bun run --cwd apps/game test \
  src/lib/components/SaveRecapDetails.test.ts
```

Expected: PASS without changing the component.

- [ ] **Reuse the existing packaged save-seed flow**

Add these assertions to existing checkpoints:

```ts
expect(compositeEnvelope.summary.sceneSummary).toBeNull();
expect(interrogationEnvelope.summary.sceneSummary).toBeNull();
expect(unicodeEnvelope.summary.sceneSummary).toBeNull();
expect(continueSlot.status.metadata.summary.sceneSummary).toBeNull();
```

They already cover midpoint investigation, presenting interrogation, active linear dialogue, and title-screen Continue. Keep all current assertions for titles, chapter/objective copy, cursor, save identity, discovery, and restore. Do not create a new E2E suite or navigation flow.

Type-check:

```bash
bun run --cwd apps/game check:e2e
```

---

## Final verification

Run once after integration:

```bash
git diff --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run check
bun run --cwd apps/game check:e2e
bun run test
bun run lint:all
bun run --cwd apps/game test:e2e:save
```

If packaged E2E is unavailable, record the exact missing prerequisite and do not claim it passed.

Search for stale active-scene expectations:

```bash
rg -n \
  'sceneSummary\).*not\.toBeNull|scene_summary:\s*Some\(location\.scene_summary\)|"sceneSummary":\s*"The detective arrives' \
  apps/game/src-tauri/src/game/save apps/game/src/lib apps/game/e2e-tauri
```

No active linear or unfinished investigation/interrogation test may require non-null scene prose.

## Review and handoff

One focused implementation commit is sufficient; keep tests and behavior together.

The implementation PR must state:

- HPA-508 owns only completion-aware recap eligibility.
- HPA-540 may remove the unshipped V1 path and rename current save/capture types after rebasing these assertions.
- HPA-540 must preserve the `scene_summary_for_checkpoint` behavior.
- No HPA-508 test makes V1-to-V2 migration a lasting compatibility requirement.
