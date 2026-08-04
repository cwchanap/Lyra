# HPA-508 Spoiler-Safe Save Recaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Save Browser and Continue from exposing authored scene outcomes at every resumable checkpoint.

**Architecture:** Keep the existing schema-v2, discovery, restore, and recap UI contracts. Derive `sceneSummary` from the already-validated captured `SceneProgressSnapshotV1`: only `GameComplete` receives authored final-scene prose; every resumable linear, investigation, or interrogation state receives `None`.

**Tech Stack:** Rust 2021, Serde, Svelte 5, Vitest 4, WebdriverIO/Tauri E2E, Bun 1.3.1.

## Constraints

- Merge order: `HPA-508 -> HPA-540 -> HPA-260`; use current `main` type names and let HPA-540 rename them later.
- No schema, migration, persisted completion field, discovery fallback, recap model, authored-content, or UI layout change.
- Preserve current checkpoint IDs/titles, chapter recap, objective recap, save discovery, and restore behavior.

## Current seam

`outro_played` is set when a non-empty outro queue is installed. That state remains resumable while the player is reading the outro, and the engine advances the scene in the same command that drains the queue. It is therefore not a completed-scene signal.

The current contracts already support the required absence:

- `SaveSummaryV2.scene_summary` is `Option<String>`.
- `validate_save_summary` accepts absent copy.
- `SaveRecapDetails.svelte` renders scene prose only when present.

Required rule:

| Captured progress | `sceneSummary` |
|---|---|
| `Linear` | `None` |
| `Investigation { .. }`, including an active outro | `None` |
| `Interrogation { .. }`, including an active outro | `None` |
| `GameComplete` | retained final-scene summary |

A future requirement to show a completed non-final scene needs a real completed-scene recap model or signal and is outside HPA-508.

---

### Task 1: Apply the capture-owned rule

**Files:**
- Modify/test: `apps/game/src-tauri/src/game/save/capture.rs`

**Produces:**

```rust
fn scene_summary_for_checkpoint(
    scene: &SceneProgressSnapshotV1,
    authored_summary: &str,
) -> Option<String>
```

- [ ] **Add failing regression assertions to existing capture tests**

Update existing tests without adding fixtures:

- `captures_active_linear_checkpoint_as_exact_wire_value`: expect `"sceneSummary": null`.
- `captures_investigation_progress_inventory_and_composite_queue_deterministically`: expect `None`.
- `captures_interrogation_playing_and_presenting_with_stable_line_ids`: expect `None` for both captures.
- `captures_an_investigation_outro_only_after_its_commit`: keep the active outro queue, capture after `outro_played = true`, and expect `None`.
- `captures_game_complete_with_the_retained_final_scene_identity`: expect `Some("Fixture scene summary.")`.

Run and confirm the resumable cases fail before implementation:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::capture::tests -- --nocapture
```

- [ ] **Implement the exhaustive minimal helper**

```rust
fn scene_summary_for_checkpoint(
    scene: &SceneProgressSnapshotV1,
    authored_summary: &str,
) -> Option<String> {
    match scene {
        SceneProgressSnapshotV1::GameComplete => Some(authored_summary.to_owned()),
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

Pass that value to `SaveSummaryV2`. Do not duplicate this rule in `capture_location`, storage, discovery, or restore.

- [ ] **Run the focused Rust suite green**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::capture::tests -- --nocapture
```

---

### Task 2: Prove nullable rendering and packaged UI behavior

**Files:**
- Modify: `apps/game/src/lib/components/SaveRecapDetails.test.ts`
- Modify: `apps/game/e2e-tauri/save-seed.e2e.ts`
- Do not modify unless a test exposes a defect: `SaveRecapDetails.svelte`

- [ ] **Add scene-only nullable component coverage**

Render `{ ...completeSummary, sceneSummary: null }` and assert that chapter/title/objective content remains, the authored scene-summary text is absent, exactly two summary-copy elements render, and no fallback prose is invented.

Run:

```bash
bun run --cwd apps/game test \
  src/lib/components/SaveRecapDetails.test.ts
```

Expected: PASS without a production component change.

- [ ] **Update the existing packaged save-seed assertions**

Add null assertions for the existing midpoint checkpoints:

```ts
expect(compositeEnvelope.summary.sceneSummary).toBeNull();
expect(interrogationEnvelope.summary.sceneSummary).toBeNull();
```

Replace the current non-null assertions for the active linear save and Continue candidate:

```ts
expect(unicodeEnvelope.summary.sceneSummary).toBeNull();
expect(continueSlot.status.metadata.summary.sceneSummary).toBeNull();
```

Define the authored `scene_2` summary as a test constant and add explicit UI proof:

```ts
expect(manualOneText).not.toContain(activeSceneAuthoredSummary);
expect(titleRecaps[0]).not.toContain(activeSceneAuthoredSummary);
```

Keep existing title, chapter-summary, objective, identity, cursor, discovery, and restore assertions. The existing conditional loops may continue to render present fields, but these negative assertions must prove the hidden scene copy is absent from both Save Browser and Continue.

Type-check:

```bash
bun run --cwd apps/game check:e2e
```

Do not add a new E2E suite or navigation flow.

---

## Final verification

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run --cwd apps/game check:e2e
bun run lint:all
bun run --cwd apps/game test:e2e:save
```

The targeted component test runs in Task 2. If packaged E2E is unavailable, record the exact missing prerequisite and do not claim it passed.

## HPA-540 handoff

HPA-540 may remove the unshipped V1 path and rename current save/capture types after rebasing these observable tests. It must preserve the rule: authored scene prose is absent for every resumable checkpoint and present only for `GameComplete`.
