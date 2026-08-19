# Interrogation Thumbnail Capture Performance Implementation Plan

> **For agentic workers:** Use `superpowers:test-driven-development` for production changes and `superpowers:verification-before-completion` before publishing. Execute tasks in order.

**Goal:** Remove interrogation dialogue/Present hitches while preserving exact autosave state, ordinary dialogue thumbnails, and stable thumbnail milestones.

**Architecture:** Reuse `MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail` and keep one centralized mutation/revision/coordinator path. `advance_dialogue` chooses policy after mutation from incoming `QueueToken.scene_id` plus committed `SceneView`; only same-interrogation → same-interrogation progress skips capture. Keep only two new command cores: `advance_dialogue_core` and `challenge_interrogation_line_core`. Change ask/present/withdraw/resume policy literals in place. Exclude the Present scrim with the existing capture marker.

**Tech Stack:** Rust/Tauri 2, Svelte 5, TypeScript, Vitest + Testing Library, WebdriverIO packaged E2E, existing SaveCoordinator and html-to-image capture proof.

**Spec:** `docs/superpowers/specs/2026-08-17-interrogation-thumbnail-capture-performance-design.md`

## Global constraints

- Preserve engine mutations, durable revisions, queue tokens, snapshots, callbacks, and save/resume behavior.
- Reuse `AutosaveIfAdvancedWithoutThumbnail`; do not add another persistence policy.
- Keep `run_gameplay_mutation` as the single session-lock/revision/coordinator owner.
- Classify interrogation from `SceneView`, not `ModeView`.
- Suppress `advance_dialogue` capture only when incoming `QueueToken.scene_id` equals committed `SceneView::Interrogation.id`.
- Entering/leaving interrogation remains ordinary thumbnail autosave.
- Keep `complete_interrogation_phase` directly on `AutosaveIfAdvanced`.
- Keep ordinary non-interrogation dialogue capture unchanged.
- No save schema/storage/coordinator change, previous-thumbnail copy, scheduler, worker, cancellation protocol, native capture, virtualization, or global thumbnail decision.
- Prove policy with ticket/activity/state and capture-call counts, not wall-clock thresholds.
- Run the Svelte autofixer for the tray change.

---

## Expected file surface

| File | Responsibility |
| --- | --- |
| `apps/game/src-tauri/src/lib.rs` | Selector seam, two command cores, policy edits, behavioral/source-contract tests, `function_body` fix. |
| `apps/game/src-tauri/src/game/test_support.rs` | Widen two existing interrogation fixtures for crate-level tests. |
| `apps/game/src/lib/components/InterrogationEvidenceTray.svelte` | Exclude Present overlay from thumbnail serialization. |
| `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts` | Pin the capture-exclusion contract. |
| `apps/game/e2e-tauri/production-anchors.ts` | Add one stable interrogation entry-dialogue anchor. |
| `apps/game/e2e-tauri/capture-proof.e2e.ts` | Direct-start packaged regression with a falsifiable capture counter. |

No generated scene/resource file should be edited.

---

## Task 1: Add the dialogue selector seam and prove its boundaries

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

### Step 1 — Fix `function_body` before any `_core` declaration lands

The current test helper matches by prefix:

```rust
let marker = format!("fn {name}");
```

Change it first to:

```rust
let marker = format!("fn {name}(");
```

This prevents `function_body(source, "advance_dialogue")` from silently matching `advance_dialogue_core` if helper declaration order changes.

Run the existing source-contract tests immediately after this one-line change:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml every_ordinary_mutation_routes_through_the_central_autosave_policy -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_workbench_commands_pin_no_thumbnail_autosave_policy -- --nocapture
```

Expected: PASS before behavioral changes.

### Step 2 — Widen only the fixtures needed by crate-level command tests

In `game/test_support.rs`, change only visibility:

```rust
pub(crate) fn two_line_question_scene() -> InterrogationSceneJson

pub(crate) fn empty_engine_with_interrogation_scene(
    scene: InterrogationSceneJson,
    intro_queue_gen: u64,
) -> GameEngine
```

Do not expose `empty_inquiry_interrogation_scene`; the phase-completion behavioral test has been removed because it would inject its own policy rather than test real command wiring.

### Step 3 — Add two tiny local test helpers

Inside the existing `lib.rs` test module that already owns `PassiveBackend` and `mutation_app()`, add:

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

Refactor `mutation_app()` to reuse `mutation_app_with_engine(...)` only if it removes duplicate `AppState` construction; otherwise leave it alone.

### Step 4 — Add failing behavioral tests

#### Same-interrogation progress skips capture

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

#### Ordinary dialogue still captures

```rust
#[test]
fn ordinary_dialogue_advance_still_requests_thumbnail() {
    let app = mutation_app();
    let expected = live_queue_token(&app);

    let result = advance_dialogue_core(&app, expected).unwrap();

    assert!(result.thumbnail_capture.is_some());
}
```

#### Selector preserves entry/exit boundaries

Derive the fixture ID from the scene definition instead of hard-coding it:

```rust
#[test]
fn dialogue_policy_skips_only_same_interrogation_scene_progress() {
    let scene = two_line_question_scene();
    let interrogation_id = scene.id.clone();
    let interrogation = empty_engine_with_interrogation_scene(scene, 1)
        .view()
        .unwrap();

    assert!(matches!(
        dialogue_persistence_policy(&interrogation_id, &interrogation),
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
    ));

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

    assert!(matches!(
        dialogue_persistence_policy(&interrogation_id, &ordinary),
        MutationPersistencePolicy::AutosaveIfAdvanced
    ));
}
```

### Step 5 — Confirm RED

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation_dialogue_advance_autosaves_without_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml ordinary_dialogue_advance_still_requests_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_policy_skips_only_same_interrogation_scene_progress -- --nocapture
```

Expected: FAIL because selector/core do not exist yet.

### Step 6 — Refactor the current mutation body into a selector-capable form

Move the existing lock, revision comparison, coordinator notification, and result construction into:

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

Preserve the current function's exact error behavior and coordinator semantics.

### Step 7 — Implement the dialogue policy and core

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

Wire the existing Tauri command directly to the core:

```rust
#[tauri::command]
fn advance_dialogue(
    state: tauri::State<'_, AppState>,
    expected: QueueToken,
) -> Result<GameplayCommandResultView, GameError> {
    advance_dialogue_core(&state, expected)
}
```

### Step 8 — Run focused/existing mutation tests

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation_dialogue_advance_autosaves_without_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml ordinary_dialogue_advance_still_requests_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_policy_skips_only_same_interrogation_scene_progress -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml advancing_mutation_returns_wrapped_state_and_schedules_capture -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml no_thumbnail_mutation_returns_null_capture_and_keeps_activity_idle -- --nocapture
```

Expected: PASS.

### Step 9 — Commit Task 1

```bash
git add apps/game/src-tauri/src/lib.rs apps/game/src-tauri/src/game/test_support.rs
git commit -m "fix: skip thumbnails inside interrogation dialogue"
```

---

## Task 2: Suppress capture for the five transient interrogation actions

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`

### Step 1 — Add a bounded testimony helper

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

### Step 2 — Add failing behavioral proof for challenge

`challenge_interrogation_line` needs a core because this behavior should be bound at the command seam rather than inferred from source text:

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
    let before = app.session.lock().unwrap().durable_revision().unwrap();

    let result = challenge_interrogation_line_core(&app, "l_deny".into()).unwrap();

    assert!(result.thumbnail_capture.is_none());
    assert!(app.session.lock().unwrap().durable_revision().unwrap() > before);
    assert_eq!(
        app.coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}
```

Confirm RED:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml challenge_interrogation_line_autosaves_without_thumbnail -- --nocapture
```

### Step 3 — Add only the challenge core

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

Wire `challenge_interrogation_line` to it.

### Step 4 — Change the other four policy literals in place

In the existing Tauri command bodies, change only:

```rust
MutationPersistencePolicy::AutosaveIfAdvanced,
```

to:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
```

for:

- `ask_interrogation_question`;
- `present_interrogation_evidence`;
- `withdraw_interrogation`;
- `resume_interrogation_testimony`.

Do not add `*_core` wrappers for these four commands.

Leave `complete_interrogation_phase` unchanged on:

```rust
MutationPersistencePolicy::AutosaveIfAdvanced,
```

Do not add a phase-completion behavioral test that invokes `run_gameplay_mutation(... AutosaveIfAdvanced ...)` directly; that cannot detect command miswiring and duplicates the existing generic policy tests.

### Step 5 — Correct both source-contract classifications deliberately

Update `every_ordinary_mutation_routes_through_the_central_autosave_policy`:

- remove `advance_dialogue` from the fixed-policy list;
- remove ask/challenge/present/withdraw/resume;
- keep `complete_interrogation_phase`;
- require the exact ordinary literal:

```rust
MutationPersistencePolicy::AutosaveIfAdvanced,
```

- explicitly reject `AutosaveIfAdvancedWithoutThumbnail`.

Update/rename `analysis_workbench_commands_pin_no_thumbnail_autosave_policy` so it pins all direct no-thumbnail bodies, including:

- `acknowledge_acquisition_event`;
- `select_analysis_board`;
- `update_analysis_draft`;
- `submit_analysis_board`;
- `ask_interrogation_question`;
- `present_interrogation_evidence`;
- `withdraw_interrogation`;
- `resume_interrogation_testimony`;
- `challenge_interrogation_line_core`.

Require:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
```

and reject:

```rust
MutationPersistencePolicy::AutosaveIfAdvanced,
```

Pin wrapper/core wiring separately:

```rust
let advance = function_body(source, "advance_dialogue");
assert!(advance.contains("advance_dialogue_core"));

let advance_core = function_body(source, "advance_dialogue_core");
assert!(advance_core.contains("run_gameplay_mutation_selecting_policy"));
assert!(advance_core.contains("dialogue_persistence_policy"));

let challenge = function_body(source, "challenge_interrogation_line");
assert!(challenge.contains("challenge_interrogation_line_core"));
```

Because Task 1 changed `function_body` to `fn {name}(`, these lookups no longer depend on declaration order.

### Step 6 — Run focused and source-contract tests

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml challenge_interrogation_line_autosaves_without_thumbnail -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml every_ordinary_mutation_routes_through_the_central_autosave_policy -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml no_thumbnail -- --nocapture
```

Expected: PASS.

### Step 7 — Commit Task 2

```bash
git add apps/game/src-tauri/src/lib.rs
git commit -m "fix: skip thumbnails for transient interrogation actions"
```

---

## Task 3: Exclude the Present tray from thumbnail serialization

**Files:**
- Modify: `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`
- Modify: `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts`

### Step 1 — Add a failing component assertion

```ts
it("excludes the transient Present scrim from save thumbnails", () => {
  const { container } = render(InterrogationEvidenceTray, props());

  const scrim = container.querySelector(".interrogation-tray-scrim");
  expect(scrim).not.toBeNull();
  expect(scrim).toHaveAttribute("data-save-thumbnail-exclude", "");
});
```

Run RED:

```bash
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
```

### Step 2 — Mark only the outer scrim

```svelte
<div
  class="interrogation-tray-scrim"
  data-save-thumbnail-exclude=""
>
```

Do not hide/unmount the tray and do not remove `backdrop-filter`.

### Step 3 — Autofix and run GREEN

```bash
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/InterrogationEvidenceTray.svelte
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
```

Expected: PASS with no unresolved autofixer issue.

### Step 4 — Commit Task 3

```bash
git add apps/game/src/lib/components/InterrogationEvidenceTray.svelte apps/game/src/lib/components/InterrogationEvidenceTray.test.ts
git commit -m "fix: exclude interrogation tray from save capture"
```

---

## Task 4: Add a falsifiable packaged regression

**Files:**
- Modify: `apps/game/e2e-tauri/production-anchors.ts`
- Modify: `apps/game/e2e-tauri/capture-proof.e2e.ts`

**Reuse:**
- `startCaptureProofAtScene(...)`;
- `elementExists(...)`;
- `captureWrapperStatus()`;
- `autosaveSaveIds()`;
- `waitForFreshNativeAutosave(...)`;
- the existing Scene 4 ask/challenge/Present sequence;
- `saveManualSlot(...)` and `closePersistenceBrowserToGameplay()` for the same-document positive control.

### Step 1 — Add the production entry-dialogue anchor

Under `anchors.unicodeSave` add:

```ts
interrogationEntryDialogue: "他從進來就一直捏著那罐東西",
```

Keep the existing Scene 4 ID/question/challenge anchors.

### Step 2 — Add only required helper imports

From `./helpers`, import any missing members used by the new block:

```ts
advanceDialogueUntil,
clickButton,
closePersistenceBrowserToGameplay,
dismissAllPendingAcquisitions,
drainCurrentDialogue,
getPackagedGameState,
saveManualSlot,
waitForPackagedGameState,
```

`elementExists`, `startCaptureProofAtScene`, and `waitForPersistenceIdle` are already imported by the capture-proof suite.

### Step 3 — Start directly at Scene 4 and require the probe to mount

```ts
await waitForPersistenceIdle();
await resetCaptureProofStorage();
await startCaptureProofAtScene(
  anchors.unicodeSave.interrogationSceneId,
  anchors.unicodeSave.interrogationEntryDialogue,
);
await browser.waitUntil(
  async () => elementExists(anchors.captureProof.probe),
  {
    timeout: 10000,
    timeoutMsg: "packaged capture proof probe did not mount",
  },
);
await drainCurrentDialogue("interrogation");
await dismissAllPendingAcquisitions();
await waitForPersistenceIdle();
```

Do not use `jumpToProductionScene`.

The probe wait is mandatory: `captureWrapperStatus()` defaults absent attributes to zero, so reading it before mount would make a `0 === 0` assertion meaningless.

### Step 4 — Record real baselines using existing helpers

```ts
const captureBefore = await captureWrapperStatus();
const autosaveIdsBefore = autosaveSaveIds();
```

Do not re-inline `autosaveSlots().flatMap(...)`; `autosaveSaveIds()` already exists in this file.

### Step 5 — Reuse the established ask/challenge/Present sequence

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

### Step 6 — Prove transient progress kept the capture counter flat

```ts
const captureAfterInterrogation = await captureWrapperStatus();
expect(captureAfterInterrogation.calls).toBe(captureBefore.calls);
expect(captureAfterInterrogation.available).toBe(captureBefore.available);
```

No elapsed-time assertion.

### Step 7 — Prove a fresh exact Present-state autosave still landed

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

### Step 8 — Make the counter assertion falsifiable with a same-document positive control

A flat zero baseline is legitimate after the new policy, so prove the capture wrapper can still observe a required capture immediately afterward.

Use explicit manual Save while Present remains mounted:

```ts
await waitForPersistenceIdle();
await saveManualSlot(3, "訊問捕捉正向控制");

const captureAfterManualSave = await captureWrapperStatus();
expect(captureAfterManualSave.calls).toBe(
  captureAfterInterrogation.calls + 1,
);

await closePersistenceBrowserToGameplay();
```

Why manual Save is the positive control:

- it explicitly calls `prepare_save_thumbnail`;
- `settlePreparedThumbnailCapture` routes that request through the same `gameplayThumbnailCapture.capture` wrapper counted by the probe;
- existing manual-save UI already supports saving while Present remains mounted;
- the exact `+1` makes the packaged counter proof incapable of passing solely because the probe/capture instrumentation stayed at zero.

Do not assert `available + 1`; the capture may legitimately close unavailable in the packaged environment, but the capture call itself must occur exactly once.

### Step 9 — Run the packaged capture proof

```bash
bun run --cwd apps/game test:e2e:capture-proof
```

Expected:

```text
probe mounts
capture count flat through ask/testimony/challenge/Present
fresh unavailable-preview Present-state autosave lands
manual Save increments capture calls by exactly one
existing ordinary-dialogue capture proof still passes
```

### Step 10 — Commit Task 4

```bash
git add apps/game/e2e-tauri/production-anchors.ts apps/game/e2e-tauri/capture-proof.e2e.ts
git commit -m "test: prove interrogation progress skips thumbnail capture"
```

---

## Task 5: Full verification and packaged acceptance

### Step 1 — Frontend verification

```bash
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
bun run --cwd apps/game check
```

### Step 2 — Rust verification

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

### Step 3 — Repository static checks

```bash
bun run check
bun run lint
bun run format:check
```

### Step 4 — Packaged suites

```bash
bun run --cwd apps/game test:e2e:capture-proof
bun run --cwd apps/game test:e2e:gameplay
bun run --cwd apps/game test:e2e:save
```

Use existing build/suite orchestration; do not create an HPA-specific suite.

### Step 5 — Manual packaged acceptance

Verify Chapter 1 interrogation:

1. testimony advances without the repeated capture hitch;
2. challenging into Present opens without the large capture stall;
3. evidence/statement cards still render normally;
4. withdraw/resume still works;
5. Game Menu opens above Present and returns to the mounted tray;
6. manual Save from Present succeeds;
7. the saved preview shows the underlying interrogation scene rather than the Present tray;
8. completing/leaving interrogation can still create a milestone preview.

Qualitative only; no CI millisecond budget.

### Step 6 — Review final diff

Expected files only:

```text
apps/game/src-tauri/src/lib.rs
apps/game/src-tauri/src/game/test_support.rs
apps/game/src/lib/components/InterrogationEvidenceTray.svelte
apps/game/src/lib/components/InterrogationEvidenceTray.test.ts
apps/game/e2e-tauri/production-anchors.ts
apps/game/e2e-tauri/capture-proof.e2e.ts
```

No save schema/storage/coordinator, game-client, story content, dependency, generated resource, or unrelated UI change.

---

## Acceptance criteria

- [ ] `function_body` matches `fn {name}(` and cannot confuse command names with `_core` prefixes.
- [ ] `advance_dialogue` returns no thumbnail only when incoming `QueueToken.scene_id` equals committed `SceneView::Interrogation.id`.
- [ ] Entering/leaving interrogation retains ordinary thumbnail capture.
- [ ] Ordinary non-interrogation dialogue retains dynamic thumbnail capture.
- [ ] Ask, challenge, present, withdraw, and resume interrogation autosave without thumbnails.
- [ ] Only `advance_dialogue_core` and `challenge_interrogation_line_core` are added; no symmetry wrappers for ask/present/withdraw/resume.
- [ ] `complete_interrogation_phase` remains source-pinned to `AutosaveIfAdvanced` without a vacuous injected-policy behavioral test.
- [ ] Both source-contract policy lists are updated with comma-terminated exact literals.
- [ ] `.interrogation-tray-scrim` carries `data-save-thumbnail-exclude` and remains mounted/interactive.
- [ ] Packaged capture proof waits for the probe before reading counters.
- [ ] The packaged interrogation loop reaches Present without increasing capture calls.
- [ ] A fresh autosave lands with `thumbnail.type === "unavailable"`, `scene.type === "interrogation"`, and `crossExam.type === "presenting"`.
- [ ] The same packaged document then performs one manual Save and capture calls increase by exactly one.
- [ ] Existing ordinary-dialogue capture proof remains intact and passes.
- [ ] Manual Save from Present captures the underlying scene.
- [ ] No schema, storage, coordinator, dependency, global thumbnail, virtualization, or native-capture work is introduced.
