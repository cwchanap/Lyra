# Interrogation Thumbnail Capture Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove interrogation dialogue/Present hitches while preserving exact autosave state, ordinary dialogue thumbnails, and stable interrogation milestone thumbnails.

**Architecture:** Reuse `MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail` and keep one centralized mutation/revision/coordinator path. `advance_dialogue` chooses its persistence policy after the mutation using the incoming `QueueToken.scene_id` plus the committed `SceneView`: only same-interrogation → same-interrogation progress skips capture; entry, exit, and ordinary dialogue keep capture. Five transient interrogation commands use small shared `*_core` helpers, and the Present scrim reuses the existing capture-exclusion marker.

**Tech Stack:** Rust/Tauri 2, Svelte 5 runes, TypeScript, Vitest + Testing Library, WebdriverIO packaged E2E, existing SaveCoordinator and html-to-image capture proof.

**Spec:** `docs/superpowers/specs/2026-08-17-interrogation-thumbnail-capture-performance-design.md`

## Global Constraints

- Preserve all engine mutations, durable revisions, queue tokens, snapshots, callbacks, and save/resume behavior.
- Reuse `AutosaveIfAdvancedWithoutThumbnail`; do not add another persistence policy.
- Keep `run_gameplay_mutation` as the single session-lock, revision, and coordinator owner.
- Classify interrogation from `SceneView`, never `ModeView`; testimony itself runs as `ModeView::Dialogue`.
- Suppress `advance_dialogue` capture only when the source `QueueToken.scene_id` equals the committed `SceneView::Interrogation.id`.
- Entering and leaving interrogation remain ordinary thumbnail milestones.
- Keep `complete_interrogation_phase` on `MutationPersistencePolicy::AutosaveIfAdvanced`.
- Keep ordinary non-interrogation dialogue thumbnail capture unchanged.
- No save schema/storage/coordinator change, prior-thumbnail copy, capture scheduler, worker, cancellation protocol, native capture, virtualization, or global thumbnail decision.
- Keep the development HTTP adapter in parity only while it exists. If HPA-559 removes it first, omit adapter-specific edits rather than restoring it.
- Prove policy with capture tickets/activity/state, not wall-clock thresholds.
- Run the Svelte autofixer for the changed tray component.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/game/src-tauri/src/lib.rs` | Selector-capable centralized mutation seam, shared command cores, behavioral policy tests, source-contract cleanup. |
| `apps/game/src-tauri/src/game/test_support.rs` | Expose existing interrogation fixtures to crate-level `lib.rs` tests. |
| `apps/game/src/lib/components/InterrogationEvidenceTray.svelte` | Exclude the transient Present overlay from thumbnail serialization. |
| `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts` | Pin capture exclusion without changing interaction behavior. |
| `apps/game/e2e-tauri/production-anchors.ts` | Add one stable production interrogation entry-dialogue fragment. |
| `apps/game/e2e-tauri/capture-proof.e2e.ts` | Direct-start packaged regression proving no capture calls during interrogation progress while autosave still advances. |

No generated scene/resource file should be edited.

---

### Task 1: Make `advance_dialogue` skip capture only inside the same interrogation scene

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

**Interfaces:**
- Consumes: existing `QueueToken.scene_id`, committed `GameStateView.scene`, existing `MutationPersistencePolicy`.
- Produces:
  - `run_gameplay_mutation_selecting_policy(state, select_policy, mutation)`.
  - existing `run_gameplay_mutation` as a fixed-policy wrapper.
  - `dialogue_persistence_policy(source_scene_id, committed)`.
  - `advance_dialogue_core(state, expected)`.

- [ ] **Step 1: Widen the existing test fixtures needed by crate-level command tests**

In `test_support.rs`, change only visibility:

```rust
pub(crate) fn two_line_question_scene() -> InterrogationSceneJson

pub(crate) fn empty_inquiry_interrogation_scene() -> InterrogationSceneJson

pub(crate) fn empty_engine_with_interrogation_scene(
    scene: InterrogationSceneJson,
    intro_queue_gen: u64,
) -> GameEngine
```

`two_line_question_scene` supplies testimony. `empty_inquiry_interrogation_scene` supplies a required phase with no questions, useful for the stable completion assertion in Task 2. Do not duplicate these scene definitions.

- [ ] **Step 2: Extract two tiny local test helpers from existing test setup**

Inside the existing `lib.rs` test module that already defines `PassiveBackend` and `mutation_app()`, add:

```rust
fn mutation_app_with_engine(engine: GameEngine) -> AppState {
    AppState {
        session: Arc::new(Mutex::new(AppSession::installed(engine, 7, None))),
        replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator: SaveCoordinator::with_backend(Arc::new(PassiveBackend)),
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    }
}

fn live_queue_token(app: &AppState) -> QueueToken {
    let session = app.session.lock().unwrap();
    let view = session.engine.as_ref().unwrap().view().unwrap();
    let ModeView::Dialogue { queue_token, .. } = view.mode else {
        panic!("fixture must expose dialogue");
    };
    queue_token
}
```

Refactor the existing `mutation_app()` to call `mutation_app_with_engine(...)` if that removes duplicate `AppState` construction; do not otherwise restructure the test module.

- [ ] **Step 3: Add failing behavioral tests for same-scene interrogation and ordinary dialogue**

Add a focused `interrogation_thumbnail_policy` test module or clearly named tests beside the existing mutation ticket tests.

For interrogation, use the real engine command to enter testimony *before* installing the engine into `AppState`, so this test does not depend on Task 2's future command core:

```rust
#[test]
fn interrogation_dialogue_advance_autosaves_without_thumbnail() {
    let mut engine = empty_engine_with_interrogation_scene(
        two_line_question_scene(),
        1,
    );
    engine.ask_interrogation_question("alibi").unwrap();
    let app = mutation_app_with_engine(engine);
    let expected = live_queue_token(&app);
    let before = app.session.lock().unwrap().durable_revision().unwrap();

    let result = advance_dialogue_core(&app, expected).unwrap();

    assert!(result.thumbnail_capture.is_none());
    assert!(app.session.lock().unwrap().durable_revision().unwrap() > before);
    assert_eq!(
        app.coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}
```

For the positive control, use the existing `mutation_app()` investigation intro:

```rust
#[test]
fn ordinary_dialogue_advance_still_requests_thumbnail() {
    let app = mutation_app();
    let expected = live_queue_token(&app);

    let result = advance_dialogue_core(&app, expected).unwrap();

    assert!(result.thumbnail_capture.is_some());
}
```

- [ ] **Step 4: Add a failing selector matrix test for entry and exit boundaries**

Use real engine views rather than adding another scene fixture:

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

    // Different source id + committed interrogation = entering interrogation.
    assert!(matches!(
        dialogue_persistence_policy("previous_scene", &interrogation),
        MutationPersistencePolicy::AutosaveIfAdvanced
    ));

    let ordinary_app = mutation_app();
    let ordinary = ordinary_app
        .session
        .lock()
        .unwrap()
        .engine
        .as_ref()
        .unwrap()
        .view()
        .unwrap();

    // Committed non-interrogation = ordinary dialogue or leaving interrogation.
    assert!(matches!(
        dialogue_persistence_policy("interrogation_scene_1", &ordinary),
        MutationPersistencePolicy::AutosaveIfAdvanced
    ));
}
```

- [ ] **Step 5: Run the focused tests and confirm RED**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation_dialogue_advance_autosaves_without_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml ordinary_dialogue_advance_still_requests_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_policy_skips_only_same_interrogation_scene_progress -- --nocapture
```

Expected: FAIL because the selector/core do not exist yet.

- [ ] **Step 6: Refactor the current mutation function into one selector-capable body**

Move the existing lock, revision comparison, coordinator notification match, and wrapper construction into:

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
        let notification = match select_policy(&committed) {
            MutationPersistencePolicy::AutosaveIfAdvanced => state
                .coordinator
                .notify_committed(committed, session_generation, after_revision),
            MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail => state
                .coordinator
                .notify_committed_without_thumbnail(
                    committed,
                    session_generation,
                    after_revision,
                ),
            MutationPersistencePolicy::CoordinatorManaged => {
                return Ok(GameplayCommandResultView {
                    state: committed,
                    thumbnail_capture: None,
                });
            }
        };
        return Ok(GameplayCommandResultView {
            state: notification.committed,
            thumbnail_capture: notification.thumbnail_capture,
        });
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

The final implementation should preserve the current code's exact error behavior. This step is a refactor of ownership, not a new coordinator path.

- [ ] **Step 7: Implement the exact dialogue policy**

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

Do not inspect `ModeView` and do not use committed scene kind alone.

- [ ] **Step 8: Add and wire one shared `advance_dialogue_core`**

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

The Tauri command calls the core:

```rust
#[tauri::command]
fn advance_dialogue(
    state: tauri::State<'_, AppState>,
    expected: QueueToken,
) -> Result<GameplayCommandResultView, GameError> {
    advance_dialogue_core(&state, expected)
}
```

While the development adapter exists, its `"advance_dialogue"` arm parses `QueueToken` and calls `advance_dialogue_core(state, args.expected)`. If HPA-559 has already deleted that arm, do not recreate it.

- [ ] **Step 9: Run focused and existing mutation tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation_dialogue_advance_autosaves_without_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml ordinary_dialogue_advance_still_requests_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_policy_skips_only_same_interrogation_scene_progress -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml advancing_mutation_returns_wrapped_state_and_schedules_capture -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml no_thumbnail_mutation_returns_null_capture_and_keeps_activity_idle -- --nocapture
```

Expected: PASS.

- [ ] **Step 10: Commit Task 1**

```bash
git add apps/game/src-tauri/src/lib.rs apps/game/src-tauri/src/game/test_support.rs
git commit -m "fix: skip thumbnails inside interrogation dialogue"
```

---

### Task 2: Route five transient interrogation actions through no-thumbnail cores

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`

**Interfaces:**
- Produces private cores:
  - `ask_interrogation_question_core`
  - `challenge_interrogation_line_core`
  - `present_interrogation_evidence_core`
  - `withdraw_interrogation_core`
  - `resume_interrogation_testimony_core`
- Each uses `AutosaveIfAdvancedWithoutThumbnail`.
- `complete_interrogation_phase` remains fixed to ordinary `AutosaveIfAdvanced`.

- [ ] **Step 1: Add a bounded test helper that advances the existing testimony fixture to `l_deny`**

This helper operates on a `GameEngine` before it is installed into `AppState`; it reuses the real queue and stops as soon as the current challenge target is `l_deny`:

```rust
fn advance_engine_to_line(engine: &mut GameEngine, expected_line_id: &str) {
    for _ in 0..8 {
        let view = engine.view().unwrap();
        if matches!(
            &view.mode,
            ModeView::Dialogue {
                cross_exam_line_id: Some(line_id),
                ..
            } if line_id == expected_line_id
        ) {
            return;
        }
        let ModeView::Dialogue { queue_token, .. } = view.mode else {
            panic!("testimony left dialogue before reaching {expected_line_id}");
        };
        engine.advance_dialogue(queue_token).unwrap();
    }
    panic!("testimony never reached {expected_line_id}");
}
```

- [ ] **Step 2: Add failing behavioral proof for challenge**

```rust
#[test]
fn challenge_interrogation_line_autosaves_without_thumbnail() {
    let mut engine = empty_engine_with_interrogation_scene(
        two_line_question_scene(),
        1,
    );
    engine.ask_interrogation_question("alibi").unwrap();
    advance_engine_to_line(&mut engine, "l_deny");
    let app = mutation_app_with_engine(engine);

    let result = challenge_interrogation_line_core(&app, "l_deny".into()).unwrap();

    assert!(result.thumbnail_capture.is_none());
    assert_eq!(
        app.coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}
```

- [ ] **Step 3: Add behavioral proof that phase completion is still an ordinary capture**

Use the existing empty inquiry scene, which has a required auto-completable phase with no questions. Drain its entry dialogue before installing the engine into `AppState`:

```rust
fn drain_engine_dialogue(engine: &mut GameEngine) {
    for _ in 0..8 {
        let view = engine.view().unwrap();
        let ModeView::Dialogue { queue_token, .. } = view.mode else {
            return;
        };
        engine.advance_dialogue(queue_token).unwrap();
    }
    panic!("fixture dialogue did not drain");
}

#[test]
fn complete_interrogation_phase_keeps_thumbnail_capture() {
    let mut engine = empty_engine_with_interrogation_scene(
        empty_inquiry_interrogation_scene(),
        1,
    );
    drain_engine_dialogue(&mut engine);
    let app = mutation_app_with_engine(engine);

    let result = run_gameplay_mutation(
        &app,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        GameEngine::complete_interrogation_phase,
    )
    .unwrap();

    assert!(result.thumbnail_capture.is_some());
}
```

The exact command wiring is pinned separately by the source-contract test in Step 6; this behavioral assertion proves the stable phase-completion mutation still produces an ordinary ticket.

- [ ] **Step 4: Run both tests and confirm RED for challenge**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml challenge_interrogation_line_autosaves_without_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml complete_interrogation_phase_keeps_thumbnail_capture -- --nocapture
```

Expected: challenge FAIL because its core/policy is not wired; phase completion demonstrates the preserved ordinary-policy baseline.

- [ ] **Step 5: Add the five small no-thumbnail cores**

Follow the existing acknowledgement-core pattern. Example:

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

Implement the same direct shape for ask/present/withdraw/resume, preserving their current argument types. Do not introduce a generic interrogation-command abstraction.

Both Tauri and the current development adapter call each shared core while that adapter exists. If HPA-559 has removed the adapter, only wire the surviving Tauri commands.

Leave `complete_interrogation_phase` exactly on:

```rust
MutationPersistencePolicy::AutosaveIfAdvanced
```

- [ ] **Step 6: Correct both existing source-contract classifications**

In `every_ordinary_mutation_routes_through_the_central_autosave_policy`:

- remove `ask_interrogation_question`;
- remove `challenge_interrogation_line`;
- remove `present_interrogation_evidence`;
- remove `withdraw_interrogation`;
- remove `resume_interrogation_testimony`;
- remove `advance_dialogue` from the fixed-policy list because it now selects dynamically;
- keep `complete_interrogation_phase`.

Use an exact enough ordinary-policy assertion:

```rust
assert!(body.contains("MutationPersistencePolicy::AutosaveIfAdvanced,"));
assert!(!body.contains("AutosaveIfAdvancedWithoutThumbnail"));
```

Update the no-thumbnail source pin to inspect the five new `*_core` bodies and require:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
```

Replace the old fixed-policy `advance_dialogue` assertion with:

```rust
let advance = function_body(source, "advance_dialogue");
assert!(advance.contains("advance_dialogue_core"));
```

If the development adapter remains, use a simple `contains("advance_dialogue_core")` / core-name assertion on `dispatch_development_command_with_exit`; do **not** add a brace-depth `development_command_arm` parser.

- [ ] **Step 7: Run focused and source-contract tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml challenge_interrogation_line_autosaves_without_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml complete_interrogation_phase_keeps_thumbnail_capture -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml every_ordinary_mutation_routes_through_the_central_autosave_policy -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_workbench_commands_pin_no_thumbnail_autosave_policy -- --nocapture
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

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
- Reuse `data-save-thumbnail-exclude`, already consumed by the capture pipeline.
- Preserve mount lifetime, blur, focus trap, Escape claim, images, Game Menu behavior, and callbacks.

- [ ] **Step 1: Add a failing component assertion**

```ts
it("excludes the transient Present scrim from save thumbnails", () => {
  const { container } = render(InterrogationEvidenceTray, props());

  const scrim = container.querySelector(".interrogation-tray-scrim");
  expect(scrim).not.toBeNull();
  expect(scrim).toHaveAttribute("data-save-thumbnail-exclude", "");
});
```

- [ ] **Step 2: Run RED**

```bash
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
```

Expected: FAIL because the marker is absent.

- [ ] **Step 3: Mark the outer scrim**

```svelte
<div
  class="interrogation-tray-scrim"
  data-save-thumbnail-exclude=""
>
```

Do not hide/unmount the tray and do not remove `backdrop-filter` in this change.

- [ ] **Step 4: Autofix and run GREEN**

```bash
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/InterrogationEvidenceTray.svelte
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
```

Expected: PASS with no unresolved autofixer issue.

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
- Reuse `captureWrapperStatus()` and `waitForFreshNativeAutosave()` already in `capture-proof.e2e.ts`.
- Reuse the ask/challenge/Present journey from `save-seed.e2e.ts`.
- Do not use `jumpToProductionScene` in this regression.

- [ ] **Step 1: Add the production entry-dialogue anchor**

`docs/stories_plan/chapter_1/interrogation_scene_4.md` starts with the spoken line below. Add it under `anchors.unicodeSave`:

```ts
interrogationEntryDialogue: "他從進來就一直捏著那罐東西",
```

Keep the existing `interrogationSceneId`, `interrogationQuestion`, `challenge`, and `withdraw` anchors.

- [ ] **Step 2: Add imports already used by the proven save-seed journey**

From `./helpers`, add only the helpers this new block uses and that are not already imported:

```ts
advanceDialogueUntil,
clickButton,
dismissAllPendingAcquisitions,
drainCurrentDialogue,
getPackagedGameState,
waitForPackagedGameState,
```

Reuse existing `autosaveSlots` / `newestAutosaveSlot` imports from `./save-fixtures`; do not add a second filesystem reader.

- [ ] **Step 3: Start directly at the production interrogation scene**

```ts
await waitForPersistenceIdle();
await resetCaptureProofStorage();
await startCaptureProofAtScene(
  anchors.unicodeSave.interrogationSceneId,
  anchors.unicodeSave.interrogationEntryDialogue,
);
await drainCurrentDialogue("interrogation");
await dismissAllPendingAcquisitions();
await waitForPersistenceIdle();
```

Do not call `jumpToProductionScene`; the existing suite explicitly avoids that path because embedded-WebDriver scene navigation can starve the same bridge needed to settle the command.

- [ ] **Step 4: Record capture and autosave baselines**

```ts
const captureBefore = await captureWrapperStatus();
const autosaveIdsBefore = autosaveSlots().flatMap((slot) =>
  slot.envelope === null ? [] : [slot.envelope.saveId],
);
```

Use this local expression rather than creating another exported helper.

- [ ] **Step 5: Reuse the established ask/challenge/Present sequence**

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

- [ ] **Step 6: Prove the interrogation loop issued no dynamic capture**

```ts
const captureAfter = await captureWrapperStatus();
expect(captureAfter.calls).toBe(captureBefore.calls);
expect(captureAfter.available).toBe(captureBefore.available);
```

Do not add an elapsed-time assertion.

- [ ] **Step 7: Prove a fresh autosave still persisted exact Present state**

```ts
const fresh = await waitForFreshNativeAutosave(
  autosaveIdsBefore,
  "interrogation no-thumbnail progress",
);
expect(fresh.thumbnailType).toBe("unavailable");

const newest = newestAutosaveSlot();
if (!newest?.envelope || newest.envelope.saveId !== fresh.saveId) {
  throw new Error("fresh interrogation autosave is not the newest autosave");
}
const envelope = newest.envelope;

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

This is the durability proof: capture count stays flat, but a new exact recovery point lands.

- [ ] **Step 8: Leave the ordinary-dialogue capture proof untouched and run the suite**

```bash
bun run --cwd apps/game test:e2e:capture-proof
```

Expected: PASS. The existing ordinary `scene_2` section remains the positive control for dynamic capture.

- [ ] **Step 9: Commit Task 4**

```bash
git add apps/game/e2e-tauri/production-anchors.ts apps/game/e2e-tauri/capture-proof.e2e.ts
git commit -m "test: prove interrogation progress skips thumbnail capture"
```

---

### Task 5: Full verification and manual packaged acceptance

**Files:**
- No new files expected.

**Interfaces:**
- Verifies durability, transient suppression, entry/exit/stable milestones, tray exclusion, and ordinary capture.

- [ ] **Step 1: Run frontend verification**

```bash
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 2: Run Rust verification**

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Expected: PASS.

- [ ] **Step 3: Run repository static checks**

```bash
bun run check
bun run lint
bun run format:check
```

Expected: PASS.

- [ ] **Step 4: Run packaged suites covering both sides of the policy boundary**

```bash
bun run --cwd apps/game test:e2e:capture-proof
bun run --cwd apps/game test:e2e:gameplay
bun run --cwd apps/game test:e2e:save
```

Expected: PASS. Use the repository's existing suite/build orchestration; do not add an HPA-specific E2E suite.

- [ ] **Step 5: Perform one manual packaged acceptance pass**

Verify the production Chapter 1 interrogation flow:

1. testimony advances without the prior repeated capture hitch;
2. challenging into Present opens without the large capture stall;
3. evidence/statement cards still render normally;
4. withdraw/resume still works;
5. Game Menu opens above Present and returns to the still-mounted tray;
6. manual Save from Present succeeds;
7. the saved preview shows the underlying interrogation scene, not the Present tray;
8. completing/leaving interrogation can still create a fresh milestone preview.

This is qualitative acceptance only. Do not encode a millisecond budget in CI.

- [ ] **Step 6: Review the final diff against the intended surface**

Expected files:

```text
apps/game/src-tauri/src/lib.rs
apps/game/src-tauri/src/game/test_support.rs
apps/game/src/lib/components/InterrogationEvidenceTray.svelte
apps/game/src/lib/components/InterrogationEvidenceTray.test.ts
apps/game/e2e-tauri/production-anchors.ts
apps/game/e2e-tauri/capture-proof.e2e.ts
```

No save schema/storage/coordinator, game-client, story content, dependency, generated resource, or unrelated UI file should change.

- [ ] **Step 7: Commit only an in-scope verification correction if one was required**

```bash
git add <only-the-intended-files>
git commit -m "chore: finalize interrogation performance fix"
```

Skip this commit when verification made no source change. Never commit E2E artifacts, generated scenes, or local saves.

---

## Acceptance Criteria

- [ ] `advance_dialogue` returns no thumbnail only when incoming `QueueToken.scene_id` equals committed `SceneView::Interrogation.id`.
- [ ] Entering interrogation retains ordinary thumbnail capture.
- [ ] Leaving interrogation retains ordinary thumbnail capture.
- [ ] Ordinary non-interrogation dialogue retains dynamic thumbnail capture.
- [ ] Ask, challenge, present, withdraw, and resume interrogation autosave without thumbnails.
- [ ] `complete_interrogation_phase` retains ordinary thumbnail autosave.
- [ ] Rust behavioral tests assert ticket/no-ticket behavior, revision movement, and thumbnail activity directly.
- [ ] Source-contract lists are updated together and cannot confuse the two policy names by substring.
- [ ] No new development-command parser is introduced.
- [ ] Current Tauri/development surfaces share cores while the adapter exists; HPA-559 deletion is never reversed.
- [ ] `.interrogation-tray-scrim` carries `data-save-thumbnail-exclude` and remains mounted/interactive.
- [ ] Packaged capture proof starts directly at `interrogation_scene_4`, not through `jumpToProductionScene`.
- [ ] The packaged interrogation loop reaches Present without increasing capture-call count.
- [ ] A fresh autosave lands with `thumbnail.type === "unavailable"`, `scene.type === "interrogation"`, and `crossExam.type === "presenting"`.
- [ ] Existing ordinary-dialogue capture proof remains the positive control and still passes.
- [ ] Manual Save from Present succeeds and captures the underlying scene.
- [ ] No schema, storage, coordinator, dependency, global thumbnail, virtualization, or native-capture work is introduced.
