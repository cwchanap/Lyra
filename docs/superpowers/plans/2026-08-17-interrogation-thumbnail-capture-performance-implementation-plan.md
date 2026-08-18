# Interrogation Thumbnail Capture Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for each production slice and `superpowers:verification-before-completion` before publishing. Execute tasks in order; each checkbox is an explicit implementation step.

**Goal:** Remove interrogation dialogue/Present hitches by keeping exact autosave state while suppressing dynamic thumbnail capture for transient interrogation commands and excluding the Present tray from overlapping/manual captures.

**Architecture:** Reuse the existing no-thumbnail autosave policy. Keep `run_gameplay_mutation` as the single mutation/revision/coordinator owner, add one private post-mutation policy selector for global `advance_dialogue`, route Tauri and the current development adapter through one core, and reuse `data-save-thumbnail-exclude` for the tray. Ordinary dialogue and stable interrogation milestones keep dynamic thumbnail capture.

**Tech Stack:** Rust/Tauri 2, Svelte 5 runes, TypeScript, Vitest + Testing Library, WebdriverIO packaged E2E, existing save coordinator and html-to-image capture proof.

**Design:** `docs/superpowers/specs/2026-08-17-interrogation-thumbnail-capture-performance-design.md`

## Global constraints

- Preserve every engine mutation, durable revision, queue token, snapshot, callback, and save-resume behavior.
- Do not switch all `advance_dialogue` calls globally to no-thumbnail. The conditional applies only while the committed scene is interrogation.
- Keep `complete_interrogation_phase` on ordinary thumbnail autosave.
- Do not add a replacement thumbnail, old-sidecar copy, capture scheduler, cancellation protocol, worker, or timing benchmark.
- Do not modify save schema/storage/coordinator behavior or HPA-550's product decision.
- Keep the current development HTTP adapter in parity while it exists. If HPA-559 removes it first, delete the adapter-specific plan steps rather than restoring the adapter.
- Keep all existing packaged selectors and production content unchanged.
- Run the Svelte autofixer for the edited tray component.

---

## File map

| File | Responsibility in this change |
| --- | --- |
| `apps/game/src-tauri/src/lib.rs` | Central policy selector, `advance_dialogue_core`, transient interrogation policy routing, and Rust/source-contract tests. |
| `apps/game/src/lib/components/InterrogationEvidenceTray.svelte` | Capture exclusion on the transient Present subtree. |
| `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts` | Capture-exclusion contract plus existing tray behavior regression. |
| `apps/game/e2e-tauri/capture-proof.e2e.ts` | Packaged proof that interrogation commands persist without starting capture. |

### Task 1: Add a post-mutation policy selector without forking mutation behavior

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`

**Purpose:** Make `advance_dialogue` choose no-thumbnail only when its committed state remains in an interrogation scene, while every existing constant-policy caller continues using the current API.

- [ ] **Step 1: Add failing policy-selection tests**

In the existing `#[cfg(test)] mod tests` source-contract area, add two focused tests.

First, pin the helper shape so the normal mutation path still delegates to one implementation:

```rust
#[test]
fn advance_dialogue_selects_policy_from_committed_scene() {
    let source = include_str!("lib.rs");
    let core = function_body(source, "advance_dialogue_core");

    assert!(core.contains("run_gameplay_mutation_selecting_policy"));
    assert!(core.contains("dialogue_persistence_policy"));
    assert!(!core.contains("MutationPersistencePolicy::AutosaveIfAdvanced,"));

    let selector = function_body(source, "dialogue_persistence_policy");
    assert!(selector.contains("SceneView::Interrogation"));
    assert!(selector.contains(
        "MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail",
    ));
    assert!(selector.contains("MutationPersistencePolicy::AutosaveIfAdvanced"));
}
```

Second, pin adapter reuse while the development router exists:

```rust
#[test]
fn advance_dialogue_surfaces_share_the_same_core() {
    let source = include_str!("lib.rs");
    let tauri = function_body(source, "advance_dialogue");
    assert!(tauri.contains("advance_dialogue_core"));

    let development = development_command_arm(source, "advance_dialogue");
    assert!(development.contains("advance_dialogue_core"));
}
```

Add a small test-only `development_command_arm` scanner beside the existing `function_body` helper only if no equivalent scanner already exists. It should stop at the next top-level development command arm and must not become production code.

If HPA-559 implementation has already deleted the development router, omit the second test and scanner; test the surviving core/Tauri path only.

- [ ] **Step 2: Run the focused tests and confirm RED**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  advance_dialogue_selects_policy_from_committed_scene
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  advance_dialogue_surfaces_share_the_same_core
```

Expected: FAIL because `advance_dialogue_core`, `dialogue_persistence_policy`, and the selecting mutation helper do not exist.

- [ ] **Step 3: Extract the selecting mutation implementation**

Refactor the current `run_gameplay_mutation` body into a private selector variant. Keep the existing function signature for every constant-policy caller:

```rust
fn run_gameplay_mutation(
    state: &AppState,
    policy: MutationPersistencePolicy,
    mutation: impl FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation_selecting_policy(state, move |_| policy, mutation)
}

fn run_gameplay_mutation_selecting_policy(
    state: &AppState,
    select_policy: impl FnOnce(&GameStateView) -> MutationPersistencePolicy,
    mutation: impl FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    // Move the existing lock, revision comparison, mutation, coordinator
    // notification, and return logic here unchanged.
}
```

Inside the advanced-revision branch, resolve the policy before moving `committed` into the coordinator:

```rust
let policy = select_policy(&committed);
let notification = match policy {
    // existing match arms unchanged
};
```

Do not add a second session lock, a second revision comparison, or command-specific persistence code.

- [ ] **Step 4: Add the interrogation-aware selector and shared core**

Import `SceneView` from the existing game view exports if it is not already in scope, then add:

```rust
fn dialogue_persistence_policy(
    committed: &GameStateView,
) -> MutationPersistencePolicy {
    match &committed.scene {
        SceneView::Interrogation { .. } => {
            MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
        }
        _ => MutationPersistencePolicy::AutosaveIfAdvanced,
    }
}

fn advance_dialogue_core(
    state: &AppState,
    expected: QueueToken,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation_selecting_policy(
        state,
        dialogue_persistence_policy,
        |engine| engine.advance_dialogue(expected),
    )
}
```

Call `advance_dialogue_core` from:

- the Tauri `advance_dialogue` command;
- the `"advance_dialogue"` development router arm on current `main`.

- [ ] **Step 5: Run focused and surrounding Rust tests**

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  advance_dialogue_selects_policy_from_committed_scene
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  advance_dialogue_surfaces_share_the_same_core
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  task_11_commands_are_registered_once_with_the_existing_application_surface
```

Expected: PASS; command registration remains unchanged.

- [ ] **Step 6: Commit the policy-selection seam**

```bash
git add apps/game/src-tauri/src/lib.rs
git commit -m "refactor(game): select dialogue autosave policy after mutation"
```

### Task 2: Route transient interrogation commands through no-thumbnail autosave

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`

**Purpose:** Suppress capture tickets for the repeatable interrogation loop while retaining exact autosave state.

- [ ] **Step 1: Replace the stale source-contract assertion with a failing interrogation policy contract**

The current `analysis_workbench_commands_pin_no_thumbnail_autosave_policy` test explicitly asserts ordinary `advance_dialogue`. Keep its Analysis/acquisition coverage, but move interrogation behavior into a dedicated test:

```rust
#[test]
fn interrogation_transient_commands_pin_no_thumbnail_policy() {
    let source = include_str!("lib.rs");
    for command in [
        "ask_interrogation_question",
        "challenge_interrogation_line",
        "present_interrogation_evidence",
        "withdraw_interrogation",
        "resume_interrogation_testimony",
    ] {
        let tauri = function_body(source, command);
        assert!(tauri.contains("run_gameplay_mutation"),
            "{command} bypasses the centralized mutation path");
        assert!(tauri.contains(
            "MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail",
        ), "{command} must persist without requesting a thumbnail");
        assert!(!tauri.contains(
            "MutationPersistencePolicy::AutosaveIfAdvanced,",
        ), "{command} still requests a thumbnail");

        let development = development_command_arm(source, command);
        assert!(development.contains(
            "MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail",
        ), "development {command} drifted from Tauri");
    }

    let complete = function_body(source, "complete_interrogation_phase");
    assert!(complete.contains("MutationPersistencePolicy::AutosaveIfAdvanced"));
    assert!(!complete.contains("AutosaveIfAdvancedWithoutThumbnail"));
}
```

If HPA-559 has removed the router, omit the development-arm assertions.

Update the old Analysis test so it no longer asserts a fixed ordinary policy for `advance_dialogue`; Task 1 now owns that conditional contract.

- [ ] **Step 2: Run the new test and confirm RED**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  interrogation_transient_commands_pin_no_thumbnail_policy
```

Expected: FAIL because the five commands still use `AutosaveIfAdvanced`.

- [ ] **Step 3: Change both current command surfaces**

For each command below, replace only the policy argument in both the Tauri function and current development router arm:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
```

Commands:

- `ask_interrogation_question`;
- `challenge_interrogation_line`;
- `present_interrogation_evidence`;
- `withdraw_interrogation`;
- `resume_interrogation_testimony`.

Do not change:

- `complete_interrogation_phase`;
- engine method arguments;
- return types;
- command registration;
- `advance_dialogue_core` from Task 1.

- [ ] **Step 4: Run focused Rust verification**

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  interrogation_transient_commands_pin_no_thumbnail_policy
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_workbench_commands_pin_no_thumbnail_autosave_policy
```

Expected: PASS.

- [ ] **Step 5: Commit the command-policy change**

```bash
git add apps/game/src-tauri/src/lib.rs
git commit -m "fix(game): skip thumbnails for interrogation interactions"
```

### Task 3: Exclude the Present tray from thumbnail capture

**Files:**
- Modify: `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`
- Modify: `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts`

**Purpose:** Prevent an older overlapping capture or a manual save from cloning the expensive transient tray.

- [ ] **Step 1: Add the failing component contract**

Add a focused test to the existing tray suite:

```ts
it("excludes the transient Present tray from save thumbnail capture", () => {
  const { container } = render(InterrogationEvidenceTray, props());

  expect(
    container.querySelector(".interrogation-tray-scrim"),
  ).toHaveAttribute("data-save-thumbnail-exclude", "");
});
```

Do not mock the capture implementation. This test pins the existing shared filter contract at the component boundary.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
bun run --cwd apps/game test \
  src/lib/components/InterrogationEvidenceTray.test.ts
```

Expected: the new assertion FAILS because the scrim has no exclusion attribute.

- [ ] **Step 3: Mark the scrim subtree**

Change only the existing root element:

```svelte
<div
  class="interrogation-tray-scrim"
  data-save-thumbnail-exclude=""
>
```

Do not alter mounting, focus trap, Escape ownership, image loading, blur, layout, or z-index.

- [ ] **Step 4: Autofix and rerun the complete tray suite**

```bash
npx @sveltejs/mcp svelte-autofixer \
  apps/game/src/lib/components/InterrogationEvidenceTray.svelte
bun run --cwd apps/game test \
  src/lib/components/InterrogationEvidenceTray.test.ts
```

Expected: autofixer reports no unresolved issue and the full existing tray suite passes.

- [ ] **Step 5: Commit the capture exclusion**

```bash
git add \
  apps/game/src/lib/components/InterrogationEvidenceTray.svelte \
  apps/game/src/lib/components/InterrogationEvidenceTray.test.ts
git commit -m "fix(game-ui): exclude the Present tray from thumbnails"
```

### Task 4: Add a packaged no-capture + autosave regression

**Files:**
- Modify: `apps/game/e2e-tauri/capture-proof.e2e.ts`

**Purpose:** Prove the exact production outcome without a flaky wall-clock benchmark: interrogation commands no longer invoke capture, while a fresh autosave still reaches disk.

- [ ] **Step 1: Add imports for the existing interrogation journey helpers**

Reuse helpers already used by `save-seed.e2e.ts`, including as needed:

```ts
advanceDialogueUntil,
clickButton,
dismissAllPendingAcquisitions,
drainCurrentDialogue,
jumpToProductionScene,
waitForPackagedGameState,
```

Use existing anchors:

- `anchors.unicodeSave.interrogationSceneId`;
- `anchors.unicodeSave.interrogationQuestion`;
- `anchors.unicodeSave.challenge`.

Do not add production selectors.

- [ ] **Step 2: Add the failing packaged test**

Add a second test inside `describe("packaged gameplay thumbnail proof", ...)`:

```ts
it("autosaves interrogation progress without starting thumbnail capture", async function () {
  this.timeout(300_000);

  await resetCaptureProofStorage();
  await startCaptureProofAtScene(
    anchors.captureProof.sceneId,
    anchors.captureProof.sceneEntryDialogue,
  );
  await jumpToProductionScene(anchors.unicodeSave.interrogationSceneId);
  await drainCurrentDialogue("interrogation");
  await dismissAllPendingAcquisitions();
  await waitForPersistenceIdle();

  const baseline = await captureWrapperStatus();
  const priorSaveIds = autosaveSaveIds();

  await clickButton(anchors.unicodeSave.interrogationQuestion);
  await waitForPackagedGameState(
    (state) =>
      state.scene.kind === "interrogation" && state.mode.type === "dialogue",
    30_000,
    "interrogation question did not enter dialogue",
  );

  await advanceDialogueUntil(async () =>
    browser.execute((label: string) =>
      Array.from(document.querySelectorAll("button")).some((button) =>
        (button.textContent ?? "").includes(label),
      ), anchors.unicodeSave.challenge),
  80);
  await clickButton(anchors.unicodeSave.challenge);

  await advanceDialogueUntil(async () => {
    const state = await getPackagedGameState();
    return state.scene.kind === "interrogation" &&
      state.scene.visiblePhases.some(
        (phase) => phase.crossExam?.presenting === true,
      );
  }, 80);

  await waitForPersistenceIdle();
  const after = await captureWrapperStatus();
  expect(after.calls).toBe(baseline.calls);

  const autosave = await waitForFreshNativeAutosave(
    priorSaveIds,
    "interrogation no-thumbnail autosave",
  );
  expect(autosave.thumbnailType).toBe("unavailable");

  const trayExcluded = await browser.execute(() =>
    document
      .querySelector(".interrogation-tray-scrim")
      ?.hasAttribute("data-save-thumbnail-exclude") ?? false,
  );
  expect(trayExcluded).toBe(true);
});
```

Adapt only syntax needed by the existing helper signatures. Keep the proof semantic:

- baseline is taken after scene-entry capture has settled;
- at least one dialogue advance and the challenge/Present transition occur;
- capture calls remain unchanged;
- a new autosave exists and is restorable data even though its preview is unavailable.

Before the production changes, expected failure is either an increased call count or an available autosave thumbnail.

- [ ] **Step 3: Run the focused packaged suite and confirm RED/GREEN around implementation**

Build once, then run only capture proof:

```bash
node apps/game/scripts/build-e2e.mjs
node apps/game/scripts/run-save-e2e.mjs --suite capture-proof
```

Expected after Tasks 1–3: PASS. The original ordinary-dialogue capture proof must still pass, demonstrating that the fix did not globally disable dynamic captures.

- [ ] **Step 4: Commit the packaged regression**

```bash
git add apps/game/e2e-tauri/capture-proof.e2e.ts
git commit -m "test(e2e): prove interrogation autosaves skip capture"
```

### Task 5: Full verification and manual acceptance

**Files:**
- No new files expected.

- [ ] **Step 1: Run all Rust tests under both feature sets**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Expected: PASS.

- [ ] **Step 2: Run frontend checks and tests**

```bash
bun run check
bun run test
bun run lint:all
```

Expected: PASS with no formatting, lint, Svelte, TypeScript, Rust format, or Clippy failures.

- [ ] **Step 3: Run the relevant packaged chains**

Reuse the existing build from Task 4 when still current:

```bash
node apps/game/scripts/run-save-e2e.mjs \
  --suite capture-proof \
  --suite gameplay \
  --suite save-core
```

Expected: PASS. Do not add a new suite or timing threshold.

- [ ] **Step 4: Perform the packaged visual/interaction acceptance**

From a production interrogation scene:

1. Advance at least five testimony/result dialogue lines.
2. Open Present, close it with 收回, then open it again.
3. Confirm no visible click hitch attributable to a capture pass.
4. Open the tray's Game Menu and create a manual save.
5. Open the Save Browser and confirm the manual save succeeds.
6. Confirm its thumbnail shows the underlying interrogation scene rather than the Present tray.
7. Enter an ordinary non-interrogation dialogue and confirm the existing capture-proof path still records a dynamic thumbnail.

Record observations in the implementation PR description; do not create a permanent profiling subsystem.

- [ ] **Step 5: Inspect scope and diff hygiene**

```bash
git diff --check
git status --short
git diff --stat origin/main...HEAD
```

Expected production/test files only:

```text
apps/game/src-tauri/src/lib.rs
apps/game/src/lib/components/InterrogationEvidenceTray.svelte
apps/game/src/lib/components/InterrogationEvidenceTray.test.ts
apps/game/e2e-tauri/capture-proof.e2e.ts
```

No save schema, coordinator, storage, story resource, generated JSON, dependency, or selector change.

- [ ] **Step 6: Final commit only if verification caused legitimate tracked changes**

Normally no extra commit is needed. If an autofixer changed an intended file after the task commits:

```bash
git add <intended-files>
git commit -m "chore: finalize interrogation performance fix"
```

Do not commit build output, E2E artifacts, local saves, or unrelated formatting.

## Acceptance criteria

- [ ] Advancing dialogue while the committed scene remains interrogation returns `thumbnailCapture: null` and still schedules ordinary autosave persistence.
- [ ] Ordinary non-interrogation `advance_dialogue` retains dynamic thumbnail capture.
- [ ] Starting a question, challenging, presenting, withdrawing, and resuming interrogation do not request thumbnails.
- [ ] Completing an interrogation phase retains ordinary thumbnail autosave.
- [ ] The Present tray is excluded from overlapping and manual save capture.
- [ ] A packaged interrogation journey advances and reaches Present without increasing the capture-call counter.
- [ ] The same journey writes a fresh autosave with exact interrogation state and an unavailable preview.
- [ ] Manual Save from Present still succeeds and captures the underlying scene.
- [ ] Existing ordinary-dialogue capture proof, gameplay, save-core, unit, lint, and check suites pass.
- [ ] No new persistence/capture abstraction, schema change, dependency, or broad thumbnail decision is introduced.
