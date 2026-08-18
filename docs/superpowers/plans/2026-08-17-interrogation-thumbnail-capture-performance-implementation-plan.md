# Interrogation Thumbnail Capture Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove interrogation dialogue/Present hitches by keeping exact autosave state while suppressing dynamic thumbnail capture only for transient interrogation progress and excluding the Present tray from overlapping/manual captures.

**Architecture:** Reuse `AutosaveIfAdvancedWithoutThumbnail` and keep one centralized mutation/revision/coordinator path. `advance_dialogue` selects persistence after the mutation using the incoming `QueueToken.scene_id` plus the committed `SceneView`: only same-interrogation → same-interrogation progress skips capture, while ordinary dialogue and interrogation entry/exit keep thumbnails. Five transient interrogation commands use small shared `*_core` helpers; the Present scrim reuses the existing capture-exclusion marker.

**Tech Stack:** Rust/Tauri 2, Svelte 5 runes, TypeScript, Vitest + Testing Library, WebdriverIO packaged E2E, existing SaveCoordinator and html-to-image capture proof.

**Spec:** `docs/superpowers/specs/2026-08-17-interrogation-thumbnail-capture-performance-design.md`

## Global Constraints

- Preserve all engine mutations, durable revisions, queue tokens, save snapshots, callbacks, and save/resume behavior.
- Reuse `MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail`; do not add another persistence policy.
- Keep `run_gameplay_mutation` as the single session-lock, revision, and coordinator owner.
- Classify interrogation from `SceneView`, never from `ModeView`; testimony runs as `ModeView::Dialogue`.
- Suppress `advance_dialogue` capture only when its source `QueueToken.scene_id` matches the committed interrogation scene ID.
- Entering and leaving interrogation remain ordinary thumbnail milestones.
- Keep `complete_interrogation_phase` on `MutationPersistencePolicy::AutosaveIfAdvanced`.
- Keep ordinary non-interrogation dialogue thumbnail capture unchanged.
- No save schema/storage/coordinator change, prior-thumbnail copying, capture scheduler, worker, cancellation protocol, native capture, virtualization, or global thumbnail decision.
- Keep the development HTTP adapter in parity only while it exists. If HPA-559 removes it first, omit adapter-specific edits rather than restoring the adapter.
- Prove performance policy with capture-call/state assertions, not wall-clock thresholds.
- Run the Svelte autofixer for `InterrogationEvidenceTray.svelte` if it changes.

---

## File Structure

| File | Responsibility in this change |
| --- | --- |
| `apps/game/src-tauri/src/lib.rs` | Central selector-capable mutation seam, shared command cores, behavioral policy tests, source-contract cleanup. |
| `apps/game/src-tauri/src/game/test_support.rs` | Expose existing interrogation fixtures to crate-level `lib.rs` tests. |
| `apps/game/src/lib/components/InterrogationEvidenceTray.svelte` | Mark transient Present overlay as excluded from thumbnail capture. |
| `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts` | Pin the capture-exclusion marker without changing tray interaction behavior. |
| `apps/game/e2e-tauri/production-anchors.ts` | Add one stable production interrogation entry-dialogue fragment. |
| `apps/game/e2e-tauri/capture-proof.e2e.ts` | Direct-start packaged regression proving no capture calls during interrogation progress while autosave still advances. |

No generated scene/resource file should be edited. The production entry text remains authored in `docs/stories_plan/chapter_1/interrogation_scene_4.md`; the E2E anchor only references it.

---

### Task 1: Make `advance_dialogue` choose thumbnail policy from source + committed scene

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

**Interfaces:**
- Consumes: existing `QueueToken.scene_id`, committed `GameStateView.scene`, existing `MutationPersistencePolicy`.
- Produces:
  - `run_gameplay_mutation_selecting_policy(state, select_policy, mutation)` — centralized mutation path with post-mutation policy selection.
  - existing `run_gameplay_mutation` remains the fixed-policy wrapper.
  - `dialogue_persistence_policy(source_scene_id, committed)` — same-interrogation progress only.
  - `advance_dialogue_core(state, expected)` — shared command core.

- [ ] **Step 1: Widen only the existing interrogation fixtures needed by crate-level tests**

In `test_support.rs`, change these two existing helpers from `pub(super)` to `pub(crate)`:

```rust
pub(crate) fn two_line_question_scene() -> InterrogationSceneJson

pub(crate) fn empty_engine_with_interrogation_scene(
    scene: InterrogationSceneJson,
    intro_queue_gen: u64,
) -> GameEngine
```

Do not create a second interrogation fixture or duplicate scene JSON.

- [ ] **Step 2: Add failing behavioral tests next to the existing mutation thumbnail tests**

Import the two widened helpers into the existing `lib.rs` test module. Add a focused module such as `interrogation_thumbnail_policy` and reuse the same `AppState`/`SaveCoordinator` construction pattern already used by `mutation_app()`.

The first test must drive the real command core while testimony is inside `SceneView::Interrogation`:

```rust
#[test]
fn interrogation_dialogue_advance_autosaves_without_thumbnail() {
    let engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
    let app = mutation_app_with_engine(engine);

    // Enter the existing question/testimony through the engine/core setup used
    // by interrogation tests, then read the live QueueToken from ModeView::Dialogue.
    let expected = live_queue_token(&app);
    let before = app.session.lock().unwrap().durable_revision();

    let result = advance_dialogue_core(&app, expected).unwrap();

    assert!(result.thumbnail_capture.is_none());
    assert!(app.session.lock().unwrap().durable_revision() > before);
    assert_eq!(
        app.coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}
```

Use existing fixture/setup helpers where available rather than literally adding `mutation_app_with_engine` / `live_queue_token` if an equivalent local helper already exists. The test requirement is the observable behavior: real `advance_dialogue_core`, real revision change, null ticket, idle thumbnail activity.

Add the ordinary-dialogue counterpart using the existing `mutation_app()` investigation intro:

```rust
#[test]
fn ordinary_dialogue_advance_still_requests_thumbnail() {
    let app = mutation_app();
    let expected = live_queue_token(&app);

    let result = advance_dialogue_core(&app, expected).unwrap();

    assert!(result.thumbnail_capture.is_some());
}
```

Add a small selector matrix test so entry/exit behavior cannot drift:

```rust
#[test]
fn dialogue_policy_skips_only_same_interrogation_scene_progress() {
    let interrogation = empty_engine_with_interrogation_scene(
        two_line_question_scene(),
        1,
    )
    .view()
    .unwrap();

    assert!(matches!(
        dialogue_persistence_policy("interrogation_scene_1", &interrogation),
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
    ));

    // A different source id represents a transition *into* the committed
    // interrogation scene and must retain the milestone thumbnail.
    assert!(matches!(
        dialogue_persistence_policy("previous_scene", &interrogation),
        MutationPersistencePolicy::AutosaveIfAdvanced
    ));

    let ordinary = mutation_app().session.lock().unwrap().engine
        .as_ref().unwrap().view().unwrap();
    assert!(matches!(
        dialogue_persistence_policy("interrogation_scene_1", &ordinary),
        MutationPersistencePolicy::AutosaveIfAdvanced
    ));
}
```

The third assertion represents leaving interrogation / committing any non-interrogation scene.

- [ ] **Step 3: Run the focused Rust tests and confirm RED**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation_thumbnail_policy -- --nocapture
```

Expected: FAIL because `advance_dialogue_core`, `dialogue_persistence_policy`, and the selector-capable mutation seam do not yet exist.

- [ ] **Step 4: Add the selector-capable form without forking mutation ownership**

Refactor the current function so the lock/revision/coordinator body exists once:

```rust
fn run_gameplay_mutation_selecting_policy(
    state: &AppState,
    select_policy: impl FnOnce(&GameStateView) -> MutationPersistencePolicy,
    mutation: impl FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    let (committed, session_generation, before_revision, after_revision) = {
        let mut session = state.session.lock().map_err(|_| unavailable_error())?;
        session.ensure_persistence_available()?;
        let session_generation = session.persistence.generation;
        let engine = session
            .engine
            .as_mut()
            .ok_or_else(GameError::game_not_started)?;
        let before_revision = engine.durable_revision();
        let committed = mutation(engine)?;
        let after_revision = engine.durable_revision();
        (
            committed,
            session_generation,
            before_revision,
            after_revision,
        )
    };

    if after_revision > before_revision {
        let policy = select_policy(&committed);
        // Preserve the existing notification match exactly once here.
        // AutosaveIfAdvanced -> notify_committed
        // AutosaveIfAdvancedWithoutThumbnail -> notify_committed_without_thumbnail
        // CoordinatorManaged -> existing early-return behavior
    }

    Ok(GameplayCommandResultView {
        state: committed,
        thumbnail_capture: None,
    })
}

fn run_gameplay_mutation(
    state: &AppState,
    policy: MutationPersistencePolicy,
    mutation: impl FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation_selecting_policy(state, |_| policy, mutation)
}
```

Move the current notification code rather than reimplementing it twice.

- [ ] **Step 5: Implement the exact dialogue selector**

```rust
fn dialogue_persistence_policy(
    source_scene_id: &str,
    committed: &GameStateView,
) -> MutationPersistencePolicy {
    match &committed.scene {
        SceneView::Interrogation { id, .. } if id == source_scene_id => {
            MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
        }
        _ => MutationPersistencePolicy::AutosaveIfAdvanced,
    }
}
```

This intentionally uses the token's source scene identity. Do **not** inspect `ModeView` and do **not** base the decision only on the committed scene kind.

- [ ] **Step 6: Add and wire one shared `advance_dialogue_core`**

```rust
fn advance_dialogue_core(
    state: &AppState,
    expected: QueueToken,
) -> Result<GameplayCommandResultView, GameError> {
    let source_scene_id = expected.scene_id.clone();
    run_gameplay_mutation_selecting_policy(
        state,
        move |committed| dialogue_persistence_policy(&source_scene_id, committed),
        |engine| engine.advance_dialogue(expected),
    )
}
```

The Tauri command becomes:

```rust
#[tauri::command]
fn advance_dialogue(
    state: tauri::State<'_, AppState>,
    expected: QueueToken,
) -> Result<GameplayCommandResultView, GameError> {
    advance_dialogue_core(&state, expected)
}
```

While the development adapter exists, its `"advance_dialogue"` arm parses the same `QueueToken` and calls `advance_dialogue_core(state, args.expected)` instead of carrying a second policy literal.

If HPA-559 has already removed that adapter when implementation starts, do not recreate it.

- [ ] **Step 7: Run focused tests and confirm GREEN**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation_thumbnail_policy -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml advancing_mutation_returns_wrapped_state_and_schedules_capture -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml no_thumbnail_mutation_returns_null_capture_and_keeps_activity_idle -- --nocapture
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add apps/game/src-tauri/src/lib.rs apps/game/src-tauri/src/game/test_support.rs
git commit -m "fix: skip thumbnails inside interrogation dialogue"
```

---

### Task 2: Route the five transient interrogation commands through shared no-thumbnail cores

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`

**Interfaces:**
- Produces private cores:
  - `ask_interrogation_question_core`
  - `challenge_interrogation_line_core`
  - `present_interrogation_evidence_core`
  - `withdraw_interrogation_core`
  - `resume_interrogation_testimony_core`
- Each calls `run_gameplay_mutation(... AutosaveIfAdvancedWithoutThumbnail ...)`.
- `complete_interrogation_phase` remains ordinary.

- [ ] **Step 1: Add failing command-boundary assertions for a transient command and the stable milestone**

Use the existing interrogation fixture and `AppState` pattern. Drive the engine into a challengeable testimony line, then prove challenge does not request capture:

```rust
#[test]
fn challenge_interrogation_line_autosaves_without_thumbnail() {
    let app = interrogation_mutation_app();
    advance_fixture_to_challengeable_line(&app);

    let result = challenge_interrogation_line_core(&app, "l_deny".into()).unwrap();

    assert!(result.thumbnail_capture.is_none());
    assert_eq!(
        app.coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}
```

Add the stable milestone counterpart:

```rust
#[test]
fn complete_interrogation_phase_keeps_thumbnail_capture() {
    let app = completed_interrogation_phase_app();

    let result = complete_interrogation_phase_core_or_existing_boundary(&app).unwrap();

    assert!(result.thumbnail_capture.is_some());
}
```

Do not create a new public API solely for the test. If `complete_interrogation_phase` has no private core, call the nearest existing internal boundary or keep the source pin plus a `run_gameplay_mutation(... AutosaveIfAdvanced ...)` behavioral test on the completed fixture.

- [ ] **Step 2: Run the focused tests and confirm RED**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml challenge_interrogation_line_autosaves_without_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml complete_interrogation_phase_keeps_thumbnail_capture -- --nocapture
```

Expected: first test FAIL because the core/policy is not wired; stable milestone remains the expected ordinary behavior.

- [ ] **Step 3: Add the five small no-thumbnail cores**

Use the same shape as the existing acknowledgement core. Example:

```rust
fn challenge_interrogation_line_core(
    state: &AppState,
    line_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        state,
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
        |engine| engine.challenge_interrogation_line(&line_id),
    )
}
```

Apply the identical ownership pattern to ask/present/withdraw/resume. Keep argument types matching the current Tauri command exactly; do not introduce a generic interrogation-command abstraction.

Both Tauri and the current development adapter call the corresponding core while that adapter exists.

Leave `complete_interrogation_phase` on:

```rust
MutationPersistencePolicy::AutosaveIfAdvanced
```

- [ ] **Step 4: Correct both existing source-contract classifications**

In `every_ordinary_mutation_routes_through_the_central_autosave_policy`:

- remove `ask_interrogation_question`;
- remove `challenge_interrogation_line`;
- remove `present_interrogation_evidence`;
- remove `withdraw_interrogation`;
- remove `resume_interrogation_testimony`;
- keep `complete_interrogation_phase`;
- do not list `advance_dialogue` as a fixed-policy command because it now uses a selector.

Make the ordinary assertion exact enough that no-thumbnail does not pass by substring:

```rust
assert!(body.contains("MutationPersistencePolicy::AutosaveIfAdvanced,"));
assert!(!body.contains("AutosaveIfAdvancedWithoutThumbnail"));
```

Update the no-thumbnail source pin to inspect the five new `*_core` bodies and require:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
```

Remove the old assertion that `advance_dialogue` must contain a fixed ordinary policy. Replace it with a structural pin that the Tauri command calls `advance_dialogue_core`; behavioral tests from Task 1 are the authority.

Do **not** add a `development_command_arm` brace parser. If the HTTP adapter still exists, a simple source assertion that its arm calls the shared core is sufficient; otherwise omit it.

- [ ] **Step 5: Run focused and source-contract tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation_thumbnail_policy -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml ordinary_mutation -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml no_thumbnail_autosave_policy -- --nocapture
```

If the exact existing test filters differ, run the containing `lib.rs` test module instead of renaming production tests merely to fit these commands.

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/game/src-tauri/src/lib.rs
git commit -m "fix: skip thumbnails for transient interrogation actions"
```

---

### Task 3: Exclude the Present tray from thumbnail serialization

**Files:**
- Modify: `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`
- Modify: `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts`

**Interfaces:**
- Reuse capture contract: any subtree carrying `data-save-thumbnail-exclude` is omitted by `thumbnail-capture.ts`.
- Preserve tray mount lifetime, blur, focus trap, Escape claim, image loading, Game Menu behavior, and callbacks.

- [ ] **Step 1: Add a failing component assertion**

In the existing tray test suite:

```ts
it("excludes the transient Present scrim from save thumbnails", () => {
  const { container } = render(InterrogationEvidenceTray, props());

  const scrim = container.querySelector(".interrogation-tray-scrim");
  expect(scrim).not.toBeNull();
  expect(scrim).toHaveAttribute("data-save-thumbnail-exclude", "");
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
```

Expected: FAIL because the scrim does not yet carry the marker.

- [ ] **Step 3: Add the established exclusion marker to the outer scrim**

```svelte
<div
  class="interrogation-tray-scrim"
  data-save-thumbnail-exclude=""
>
```

Do not hide/unmount the tray and do not remove `backdrop-filter` as part of this task.

- [ ] **Step 4: Autofix and rerun the component test**

```bash
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/InterrogationEvidenceTray.svelte
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
```

Expected: autofixer has no unresolved issue; test PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/game/src/lib/components/InterrogationEvidenceTray.svelte apps/game/src/lib/components/InterrogationEvidenceTray.test.ts
git commit -m "fix: exclude interrogation tray from save capture"
```

---

### Task 4: Add a direct-start packaged regression for interrogation capture activity

**Files:**
- Modify: `apps/game/e2e-tauri/production-anchors.ts`
- Modify: `apps/game/e2e-tauri/capture-proof.e2e.ts`

**Interfaces:**
- Reuse `startCaptureProofAtScene(sceneId, expectedDialogueText)`.
- Reuse `captureWrapperStatus()` and `waitForFreshNativeAutosave()` already local to `capture-proof.e2e.ts`.
- Reuse the ask/challenge/Present journey from `save-seed.e2e.ts`.
- Do not use `jumpToProductionScene` in the capture-proof regression.

- [ ] **Step 1: Add the stable interrogation entry dialogue anchor**

Under `anchors.unicodeSave`, add the existing first spoken line from `docs/stories_plan/chapter_1/interrogation_scene_4.md`:

```ts
interrogationEntryDialogue: "他從進來就一直捏著那罐東西",
```

Keep the existing:

```ts
interrogationSceneId: "interrogation_scene_4",
interrogationQuestion: "二十二點五十六分左右在哪裡",
challenge: "反駁",
withdraw: "收回",
```

No new selector is needed.

- [ ] **Step 2: Add the packaged regression after the existing ordinary capture proof**

Start from a fresh document directly at the interrogation scene:

```ts
await waitForPersistenceIdle();
await resetCaptureProofStorage();
await startCaptureProofAtScene(
  anchors.unicodeSave.interrogationSceneId,
  anchors.unicodeSave.interrogationEntryDialogue,
);
```

Do not call `jumpToProductionScene`; the existing suite already documents that it can starve the embedded WebDriver bridge while scene navigation settles.

- [ ] **Step 3: Establish the capture baseline and enter interrogation gameplay**

After the direct scene is stable:

```ts
await drainCurrentDialogue("interrogation");
await dismissAllPendingAcquisitions();
await waitForPersistenceIdle();

const captureBefore = await captureWrapperStatus();
const autosaveIdsBefore = autosaveSaveIds();
```

If `autosaveSaveIds` is not currently imported by this file, reuse the existing import/source already used by its ordinary capture proof rather than adding another filesystem helper.

- [ ] **Step 4: Reuse the established ask/challenge/Present flow**

Mirror the proven sequence from `save-seed.e2e.ts`:

```ts
await clickButton(anchors.unicodeSave.interrogationQuestion);
await waitForPackagedGameState(
  (state) =>
    state.mode.type === "dialogue" &&
    state.scene.kind === "interrogation",
  30000,
  "interrogation testimony did not enter Playing",
);

await advanceDialogueUntil(async () => {
  return browser.execute((label: string) => {
    return Array.from(document.querySelectorAll("button")).some((button) =>
      (button.textContent ?? "").includes(label),
    );
  }, anchors.unicodeSave.challenge);
}, 80);

await clickButton(anchors.unicodeSave.challenge);
await advanceDialogueUntil(async () => {
  const state = await getPackagedGameState();
  return (
    state.mode.type === "interrogation" &&
    state.scene.kind === "interrogation" &&
    state.scene.visiblePhases.some(
      (phase) => phase.crossExam?.presenting === true,
    )
  );
}, 80);
```

Reuse existing helpers/imports from `save-seed.e2e.ts`; do not create a second E2E interrogation driver abstraction.

- [ ] **Step 5: Assert no dynamic capture occurred during the interrogation loop**

```ts
const captureAfter = await captureWrapperStatus();
expect(captureAfter.calls).toBe(captureBefore.calls);
expect(captureAfter.available).toBe(captureBefore.available);
```

This is the deterministic regression. Do not add an elapsed-milliseconds assertion.

- [ ] **Step 6: Assert autosave still advanced with exact Present state**

Wait for a fresh native autosave relative to `autosaveIdsBefore`:

```ts
const autosave = await waitForFreshNativeAutosave(
  autosaveIdsBefore,
  "interrogation no-thumbnail progress",
);
expect(autosave.thumbnailType).toBe("unavailable");
```

Then read the corresponding envelope and assert the same durable state shape already proved by `save-seed.e2e.ts`:

```ts
expect(envelope.summary.sceneId).toBe(
  anchors.unicodeSave.interrogationSceneId,
);
expect(envelope.snapshot.scene.type).toBe("interrogation");
if (envelope.snapshot.scene.type !== "interrogation") {
  throw new Error("interrogation autosave did not persist interrogation state");
}
expect(envelope.snapshot.scene.crossExam.type).toBe("presenting");
expect(envelope.snapshot.scene.enteredPhaseIds.length).toBeGreaterThan(0);
```

The fresh autosave is the proof that removing thumbnail capture did not remove durability.

- [ ] **Step 7: Keep the ordinary-dialogue capture proof unchanged**

Do not weaken or rewrite the existing `scene_2` capture proof. It remains the positive control that ordinary gameplay still performs dynamic thumbnail capture, font embedding, and image rasterization.

- [ ] **Step 8: Run the capture-proof suite**

```bash
bun run --cwd apps/game test:e2e:capture-proof
```

Expected: PASS; ordinary dialogue capture still increases the counter, while the direct-start interrogation loop does not.

- [ ] **Step 9: Commit Task 4**

```bash
git add apps/game/e2e-tauri/production-anchors.ts apps/game/e2e-tauri/capture-proof.e2e.ts
git commit -m "test: prove interrogation progress skips thumbnail capture"
```

---

### Task 5: Full verification and manual packaged acceptance

**Files:**
- No new production files expected.
- Modify only prior task files if verification exposes a defect directly related to this fix.

**Interfaces:**
- Verifies the complete contract: save durability preserved, transient interrogation capture suppressed, entry/exit/stable milestones preserved, Present overlay excluded, ordinary capture unaffected.

- [ ] **Step 1: Run focused frontend tests**

```bash
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 2: Run Rust formatting, tests, and lint**

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Expected: PASS.

- [ ] **Step 3: Run repository-level static verification**

```bash
bun run check
bun run lint
bun run format:check
```

Expected: PASS.

- [ ] **Step 4: Run packaged suites covering both sides of the boundary**

```bash
bun run --cwd apps/game test:e2e:capture-proof
bun run --cwd apps/game test:e2e:gameplay
bun run --cwd apps/game test:e2e:save-core:run
```

If `save-core:run` requires the E2E build artifact produced by the preceding suite in the local workflow, use the repository's normal build+suite command instead; do not invent a new suite.

Expected: PASS.

- [ ] **Step 5: Perform one manual packaged acceptance pass**

Use the production Chapter 1 interrogation flow and verify:

1. advancing testimony feels responsive and does not exhibit the prior repeated capture hitch;
2. pressing/challenging into Present opens the tray without the large capture stall;
3. evidence and statements still render normally;
4. withdrawing/resuming still works;
5. Game Menu can open above Present and return to the still-mounted tray;
6. manual Save from Present succeeds;
7. the resulting save preview shows the underlying interrogation scene, not the Present tray;
8. leaving interrogation / completing the phase still allows a fresh milestone preview.

This manual pass is qualitative acceptance only. Do not encode a millisecond budget into CI.

- [ ] **Step 6: Review the final diff against scope**

Expected intended files only:

```text
apps/game/src-tauri/src/lib.rs
apps/game/src-tauri/src/game/test_support.rs
apps/game/src/lib/components/InterrogationEvidenceTray.svelte
apps/game/src/lib/components/InterrogationEvidenceTray.test.ts
apps/game/e2e-tauri/production-anchors.ts
apps/game/e2e-tauri/capture-proof.e2e.ts
```

No save schema/storage/coordinator, game-client, story content, dependency, generated resource, or unrelated UI file should change.

- [ ] **Step 7: Commit any verification-only correction if needed**

Normally no extra commit is required. If the Svelte autofixer or verification uncovered an in-scope correction:

```bash
git add <only-the-intended-files>
git commit -m "chore: finalize interrogation performance fix"
```

Do not commit E2E artifacts, generated scenes, local saves, or unrelated formatting.

---

## Acceptance Criteria

- [ ] `advance_dialogue` returns no thumbnail only when the incoming `QueueToken.scene_id` and committed `SceneView::Interrogation.id` are the same scene.
- [ ] Entering interrogation via the last dialogue advance of a prior scene retains ordinary thumbnail capture.
- [ ] Leaving interrogation via dialogue completion retains ordinary thumbnail capture.
- [ ] Ordinary non-interrogation dialogue retains dynamic thumbnail capture.
- [ ] `ask_interrogation_question`, `challenge_interrogation_line`, `present_interrogation_evidence`, `withdraw_interrogation`, and `resume_interrogation_testimony` autosave without thumbnails.
- [ ] `complete_interrogation_phase` retains ordinary thumbnail autosave.
- [ ] Rust command-boundary tests assert tickets, revision movement, and thumbnail activity directly.
- [ ] Existing source-contract lists are updated together and cannot confuse `AutosaveIfAdvancedWithoutThumbnail` with `AutosaveIfAdvanced` by substring.
- [ ] No new development-command brace parser is introduced.
- [ ] Both current command surfaces share the same small cores while the development adapter exists; HPA-559 deletion is not reversed.
- [ ] `.interrogation-tray-scrim` carries `data-save-thumbnail-exclude` and remains mounted/interactive.
- [ ] Packaged capture proof starts directly at `interrogation_scene_4`; it does not use `jumpToProductionScene` for this regression.
- [ ] The packaged interrogation loop reaches Present without increasing the capture-call counter.
- [ ] A fresh autosave still lands with `thumbnail.type === "unavailable"`, `scene.type === "interrogation"`, and `crossExam.type === "presenting"`.
- [ ] Existing ordinary-dialogue capture proof remains a positive control and still passes.
- [ ] Manual Save from Present succeeds and captures the underlying scene.
- [ ] No schema, storage, coordinator, dependency, global thumbnail, virtualization, or native-capture work is introduced.
