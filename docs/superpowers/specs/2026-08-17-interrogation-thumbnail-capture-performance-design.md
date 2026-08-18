# Interrogation Thumbnail Capture Performance Design

**Date:** 2026-08-17  
**Status:** Proposed planning specification

## Goal

Remove the visible hitch while advancing dialogue and opening the Present evidence tray during interrogation, without weakening autosave durability or starting the broader save-thumbnail product decision tracked by HPA-550.

The fix should be intentionally narrow:

- interrogation progress still autosaves through the existing coordinator;
- transient interrogation commands stop requesting dynamic thumbnail capture;
- ordinary non-interrogation dialogue keeps its current thumbnail behavior;
- explicit manual saves still capture a thumbnail;
- the Present tray is excluded from any capture that overlaps it.

## Root cause

The current command path couples every durable dialogue/interrogation mutation to a gameplay thumbnail request:

```text
interrogation command
  -> run_gameplay_mutation(... AutosaveIfAdvanced ...)
  -> coordinator issues thumbnail ticket
  -> frontend commits the new GameStateView
  -> Svelte tick
  -> html-to-image scans the gameplay root
  -> fonts/images/crossfades settle
  -> DOM -> SVG -> Canvas -> PNG
  -> thumbnail is submitted to Tauri
```

The capture promise is detached from `gameState.inFlight`, but the expensive DOM, SVG, image decode, and Canvas work still executes in the WebView. The backend's autosave debounce does not prevent that frontend work because the thumbnail request is issued before the debounced writer decides which revision wins.

Opening Present is the worst case. `challenge_interrogation_line` commits a state where `InterrogationEvidenceTray` is mounted before the capture starts. The tray currently contributes:

- a full-viewport scrim;
- `backdrop-filter: blur(7px)`;
- large shadows and layered gradients;
- every acquired evidence and statement card;
- every evidence image plus description/details.

A capture already in progress can also observe the tray after it opens because capture reads the live gameplay root. The tray therefore needs an explicit capture exclusion even after new interrogation commands stop issuing tickets.

## Reuse survey

| Need | Decision |
| --- | --- |
| Persist an interaction without requesting a thumbnail | Reuse `MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail`. Analysis and acquisition acknowledgement already use it. |
| Choose a different policy only for interrogation dialogue | Add one private post-mutation policy selector around the existing `run_gameplay_mutation` implementation. Do not fork mutation, revision, or coordinator logic. |
| Keep Tauri and the current development HTTP adapter consistent | Route both `advance_dialogue` surfaces through one `advance_dialogue_core`. Update both copies of the interrogation-specific command policy while the HTTP adapter still exists. |
| Exclude a transient overlay from capture | Reuse the existing `data-save-thumbnail-exclude` filter contract. |
| Prove capture work did not start | Reuse `PackagedCaptureProofProbe` and its capture-call counter. Do not add timing thresholds or a profiler framework. |
| Preserve autosave persistence | Reuse the existing no-thumbnail autosave debounce/write path and existing save-resume E2E fixtures. |

## Decision summary

### 1. Interrogation-only dialogue policy

`advance_dialogue` is a global command, so it must not be changed globally merely to fix the reported interrogation flow.

Add a small policy-resolving mutation seam:

```rust
fn run_gameplay_mutation_selecting_policy(
    state: &AppState,
    select_policy: impl FnOnce(&GameStateView) -> MutationPersistencePolicy,
    mutation: impl FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
) -> Result<GameplayCommandResultView, GameError>
```

The existing `run_gameplay_mutation(state, policy, mutation)` remains the ordinary entry point and delegates with a constant selector. `advance_dialogue_core` uses the selector after the engine has committed the new state:

```rust
fn dialogue_persistence_policy(
    committed: &GameStateView,
) -> MutationPersistencePolicy {
    if matches!(committed.scene, SceneView::Interrogation { .. }) {
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
    } else {
        MutationPersistencePolicy::AutosaveIfAdvanced
    }
}
```

Selecting from the committed state gives the desired boundary behavior:

- another testimony/result line inside the interrogation scene: autosave without thumbnail;
- the advance that leaves the interrogation scene: ordinary autosave with a thumbnail;
- ordinary linear/investigation dialogue elsewhere: unchanged ordinary thumbnail autosave.

The selector runs after mutation but before the committed state is moved into the coordinator notification. Revision comparison, session generation, locking, error behavior, and returned state remain centralized.

### 2. Interrogation command policy matrix

| Command | Policy after this change | Reason |
| --- | --- | --- |
| `advance_dialogue` | Conditional: no thumbnail while committed scene is interrogation; ordinary elsewhere | This is the high-frequency navigation path and must not globally change unrelated dialogue. |
| `ask_interrogation_question` | `AutosaveIfAdvancedWithoutThumbnail` | Starts a repeatable testimony loop; state still persists. |
| `challenge_interrogation_line` | `AutosaveIfAdvancedWithoutThumbnail` | Opening Present must not launch capture against the newly mounted tray. |
| `present_interrogation_evidence` | `AutosaveIfAdvancedWithoutThumbnail` | Retry/correct-answer loops remain responsive; state and acquisitions still autosave. |
| `withdraw_interrogation` | `AutosaveIfAdvancedWithoutThumbnail` | Repeatedly leaving testimony is transient navigation. |
| `resume_interrogation_testimony` | `AutosaveIfAdvancedWithoutThumbnail` | Closing Present is transient navigation. |
| `complete_interrogation_phase` | Keep `AutosaveIfAdvanced` | A phase completion is a stable milestone and is not a high-frequency tray/dialogue interaction. |

No engine command, schema, queue token, save snapshot, or frontend callback changes.

### 3. Exclude the Present tray from capture

Mark the existing scrim root:

```svelte
<div
  class="interrogation-tray-scrim"
  data-save-thumbnail-exclude=""
>
```

This has two purposes:

1. a capture from an earlier stable command that is still settling cannot serialize the expensive tray subtree after it opens;
2. a manual save opened from the tray's Game Menu captures the underlying interrogation scene rather than a temporary record picker.

Do not hide or unmount the tray for one frame. The existing capture filter already drops excluded subtrees from the detached clone, so no focus, Escape, or Present-state behavior changes.

### 4. Autosave thumbnail tradeoff

No-thumbnail autosaves still write the exact accepted gameplay state and revision. They intentionally store `ThumbnailDescriptorV1::Unavailable`; the existing save UI already supports the preview-unavailable fallback.

During an active interrogation loop, the newest autosave may therefore show the fallback preview. This is accepted because:

- chapter, scene, objective, timestamp, and save metadata remain available;
- manual saves still request dynamic thumbnails;
- the stable command that exits the interrogation scene can request a fresh autosave thumbnail;
- preserving/copying an old thumbnail would require new sidecar semantics and is outside this performance fix;
- HPA-550 remains the product-level decision about whether dynamic previews should survive at all.

This slice does not activate or resolve HPA-550.

## Tauri and development adapter parity

Current `main` still contains both:

```text
Svelte -> Tauri invoke -> command function
Svelte DEV fallback -> development string router -> same engine mutation
```

Until HPA-559 is implemented, both command surfaces must choose the same policy.

- Extract `advance_dialogue_core(&AppState, QueueToken)` so the conditional selector is written once.
- Call that core from the Tauri command and current development command branch.
- Change the remaining interrogation-specific policy literals in both surfaces.

If HPA-559 implementation lands first, omit assertions and edits for the deleted development router. Do not recreate it for parity; retain the same core/Tauri behavior.

## Packaged proof strategy

Do not create a duration assertion such as "tray opens under 100 ms". WebDriver, CI, WebKit, asset caches, and host load make that result noisy.

Instead extend the existing capture-proof suite with a structural regression:

1. enter a production interrogation scene;
2. wait for any scene-entry capture to settle and record `data-capture-proof-calls`;
3. start a question and advance testimony inside the interrogation scene;
4. challenge a line and reach Present;
5. assert capture-call count did not increase;
6. assert a fresh autosave envelope was still written with the advanced interrogation snapshot and an unavailable thumbnail;
7. assert the mounted Present scrim carries `data-save-thumbnail-exclude`.

The existing capture-proof transition in ordinary dialogue remains unchanged and continues proving the dynamic capture pipeline itself works.

## Scope

### In scope

- Conditional persistence policy selection for `advance_dialogue`.
- No-thumbnail policy for the five interrogation-specific transient commands.
- Tauri/development-adapter parity on current `main`.
- Capture exclusion on `InterrogationEvidenceTray`.
- Focused Rust source/behavior contracts, component coverage, and one packaged capture-call regression.
- Documentation of the autosave-preview tradeoff.

### Out of scope

- Removing dynamic thumbnails globally.
- Native window/WebView capture.
- Preserving or copying a previous thumbnail into a new save ID.
- A new capture scheduler, debounce, cancellation token, worker, or queue.
- Changing the 500 ms autosave debounce or 1 s capture deadline.
- Virtualizing evidence cards.
- Preloading or resizing evidence images.
- Removing the tray blur or redesigning its visuals before measurement after this fix.
- Save schema, storage compatibility, coordinator-wide refactors, or migration work.
- New performance telemetry or a general benchmark harness.
- Chapter 2 or authored story changes.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Ordinary dialogue thumbnails accidentally disappear | Policy is selected from the committed scene; packaged capture proof continues to use ordinary dialogue. |
| Final interrogation transition never refreshes a thumbnail | Selecting from committed state restores ordinary policy when the command leaves the interrogation scene; phase completion also remains ordinary. |
| Autosave stops persisting exact interrogation progress | Reuse the existing no-thumbnail autosave path; packaged proof waits for a fresh envelope and checks the snapshot. |
| Manual save captures the Present overlay | Add `data-save-thumbnail-exclude` to the scrim and assert the contract in component and packaged tests. |
| Policy logic forks mutation locking or revision handling | Add only a policy selector wrapper around the existing centralized mutation implementation. |
| Development HTTP and Tauri behavior drift before HPA-559 | Use one `advance_dialogue_core`; source-contract tests cover both remaining surfaces. |
| The fix expands into HPA-550 | Explicitly accept unavailable autosave previews in this flow and add no replacement thumbnail mechanism. |
| CSS remains somewhat expensive after capture removal | Re-profile manually after implementation; only then consider blur/card rendering as a separate evidence-backed change. |

## Expected implementation surface

| File | Change |
| --- | --- |
| `apps/game/src-tauri/src/lib.rs` | Add the policy selector/core, retarget transient interrogation commands, and update focused tests/source contracts. |
| `apps/game/src/lib/components/InterrogationEvidenceTray.svelte` | Mark the transient tray subtree as excluded from save capture. |
| `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts` | Pin the capture-exclusion attribute. |
| `apps/game/e2e-tauri/capture-proof.e2e.ts` | Prove interrogation interaction commands do not start capture but still produce a fresh autosave. |

No change is expected in:

- `apps/game/src/lib/persistence/thumbnail-capture.ts`;
- save schema/storage/coordinator modules;
- story resources or compiler output;
- existing production selectors.

## Verification

Focused:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  interrogation_transient_commands_pin_no_thumbnail_policy
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  advance_dialogue_selects_policy_from_committed_scene
bun run --cwd apps/game test \
  src/lib/components/InterrogationEvidenceTray.test.ts
```

Full static/unit:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run check
bun run test
bun run lint:all
```

Packaged:

```bash
node apps/game/scripts/build-e2e.mjs
node apps/game/scripts/run-save-e2e.mjs \
  --suite capture-proof \
  --suite gameplay \
  --suite save-core
```

Manual acceptance in a packaged build:

- advance several testimony/result lines without a click hitch;
- open and close Present repeatedly;
- verify manual Save from the Present Game Menu still succeeds;
- verify the resulting thumbnail shows the underlying interrogation scene, not the evidence tray;
- verify ordinary non-interrogation dialogue still produces dynamic autosave thumbnails.
