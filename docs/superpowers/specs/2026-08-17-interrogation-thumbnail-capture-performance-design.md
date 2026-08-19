# Interrogation Thumbnail Capture Performance Design

**Date:** 2026-08-17
**Status:** Proposed planning specification — revised against current `main`

## Goal

Remove the visible hitch while advancing testimony and opening the Present evidence tray during interrogation, without weakening autosave durability and without broadening this into the save-thumbnail product decision tracked by HPA-550.

The fix stays intentionally narrow:

- interrogation progress still autosaves through the existing coordinator;
- transient interrogation commands stop requesting dynamic thumbnail capture;
- `advance_dialogue` skips capture only when it starts and finishes in the same interrogation scene;
- entering or leaving interrogation remains an ordinary thumbnail milestone;
- ordinary non-interrogation dialogue keeps its current thumbnail behavior;
- explicit manual saves still request a thumbnail;
- the Present tray is excluded from any capture that overlaps it.

## Root cause

The current command path couples durable dialogue/interrogation mutations to a gameplay thumbnail request:

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

The capture promise is detached from `gameState.inFlight`, but DOM, SVG, image decode, font embedding, and Canvas work still execute in the WebView. Backend autosave debounce does not prevent that frontend work because the thumbnail request is issued before the debounced writer decides which revision wins.

Opening Present is the worst case. `challenge_interrogation_line` commits a state where `InterrogationEvidenceTray` is mounted before capture starts. The tray contributes a full-viewport scrim, `backdrop-filter`, large shadows, all evidence/statement cards, and evidence images. An older capture can also observe the live tray after it opens because the frontend identity guard discards a stale result after capture work; it does not cancel serialization already in progress.

The performance bug is therefore eager dynamic thumbnail capture on high-frequency interrogation mutations, amplified by capturing a heavy transient overlay.

## Reuse survey

| Need | Decision |
| --- | --- |
| No-thumbnail autosave | Reuse `MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail`. |
| Save scheduling | Reuse `notify_committed_without_thumbnail`; do not add a fourth persistence policy. |
| Mutation/revision ownership | Keep `run_gameplay_mutation` as the single lock/revision/coordinator owner. |
| Conditional dialogue policy | Add one selector-capable wrapper around that same mutation path. |
| Source-scene identity | Reuse `QueueToken.scene_id`; successful `advance_dialogue` already validates the full token against the live queue. |
| Interrogation classification | Match `SceneView::Interrogation`, not `ModeView`; testimony itself runs in `ModeView::Dialogue`. |
| Transient action proof | Add a core only where a behavioral command-boundary test needs it. |
| Capture exclusion | Reuse `data-save-thumbnail-exclude`, already consumed by the capture pipeline. |
| Regression proof | Reuse existing command-boundary ticket/activity assertions and packaged capture-call counters. |
| Packaged journey | Reuse the Scene 4 ask/challenge/Present flow and existing manual-save helper. |

## Chosen architecture

### 1. Keep one centralized mutation path

`run_gameplay_mutation` remains the single owner of:

- persistence availability guard;
- session lock;
- mutable `GameEngine` access;
- before/after durable revision comparison;
- autosave coordinator notification;
- `GameplayCommandResultView` construction.

Add a private selector-capable form rather than forking the logic:

```rust
fn run_gameplay_mutation_selecting_policy(
    state: &AppState,
    select_policy: impl FnOnce(&GameStateView) -> MutationPersistencePolicy,
    mutation: impl FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
) -> Result<GameplayCommandResultView, GameError>
```

The existing fixed-policy function delegates to that seam:

```rust
fn run_gameplay_mutation(
    state: &AppState,
    policy: MutationPersistencePolicy,
    mutation: impl FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation_selecting_policy(state, |_| policy, mutation)
}
```

Do not add another session lock, persistence owner, or general command-policy framework.

### 2. `advance_dialogue` uses source scene identity plus committed scene identity

Choosing only from the committed scene is insufficient because draining the final line of one scene can load the next scene inside the same `advance_dialogue` call.

The incoming `QueueToken` already carries the source `scene_id`. Reuse it:

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

`advance_dialogue_core` captures only that ID before moving the token into the engine command:

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

Policy matrix:

| Start | Committed result | Policy |
| --- | --- | --- |
| ordinary scene | ordinary scene | ordinary autosave + thumbnail |
| ordinary scene | interrogation scene | ordinary autosave + thumbnail — entry milestone |
| interrogation scene | same interrogation scene | autosave without thumbnail |
| interrogation scene | non-interrogation scene | ordinary autosave + thumbnail — exit milestone |

### 3. Five transient interrogation commands use the existing no-thumbnail policy

These high-frequency commands use `AutosaveIfAdvancedWithoutThumbnail`:

- `ask_interrogation_question`;
- `challenge_interrogation_line`;
- `present_interrogation_evidence`;
- `withdraw_interrogation`;
- `resume_interrogation_testimony`.

Keep a private `challenge_interrogation_line_core` because its command-boundary behavior is directly tested. For ask/present/withdraw/resume, change the policy literal in the existing Tauri command body and pin those bodies with the existing source-contract test. Do not create four wrappers merely for symmetry.

This leaves exactly two new command cores in the change:

- `advance_dialogue_core`;
- `challenge_interrogation_line_core`.

### 4. `complete_interrogation_phase` remains a thumbnail milestone

Do not suppress capture for `complete_interrogation_phase`. It remains directly wired to:

```rust
MutationPersistencePolicy::AutosaveIfAdvanced
```

The existing source-contract classification is the guard for this exact command wiring. Do not add a behavioral test that supplies `AutosaveIfAdvanced` itself; that would only retest `run_gameplay_mutation`, not the command.

Scene entry and scene exit through `advance_dialogue` remain ordinary thumbnail milestones via the source+committed scene matrix.

### 5. Exclude the Present tray from capture

Add the established marker to the outer scrim:

```svelte
<div
  class="interrogation-tray-scrim"
  data-save-thumbnail-exclude=""
>
```

Do not unmount the tray during capture and do not remove the blur as part of this fix.

This still matters after transient commands stop issuing new tickets:

- an older capture may overlap the tray opening;
- the player can manually save while Present remains mounted;
- manual saves should capture the underlying scene, not the temporary evidence picker.

### 6. Keep preview availability semantics unchanged

No-thumbnail autosave intentionally writes a valid autosave whose preview can be unavailable. Do not copy a prior sidecar, synthesize a placeholder image, or add a new fallback protocol.

This fix changes when dynamic capture is requested, not save validity or schema semantics. HPA-550 remains the later product decision about dynamic previews.

## Verification strategy

### Rust command-boundary proof

Behavioral tests are primary where they can actually bind the command behavior.

Widen only the existing fixtures required by `lib.rs` tests:

- `two_line_question_scene`;
- `empty_engine_with_interrogation_scene`.

Required behavioral assertions:

1. `advance_dialogue_core` inside an interrogation scene advances revision, returns `thumbnail_capture: None`, and leaves `ThumbnailActivityView::Idle`.
2. `advance_dialogue_core` on the existing ordinary fixture still returns a thumbnail request.
3. `dialogue_persistence_policy` preserves entry and exit milestones.
4. `challenge_interrogation_line_core` returns no thumbnail while advancing state.

The existing generic mutation tests already prove that ordinary/no-thumbnail persistence policies issue or omit tickets. Do not duplicate them with a phase-completion test that injects the policy under test.

### Source-contract proof

The current source scanner must first be made unambiguous:

```rust
let marker = format!("fn {name}(");
```

Using `fn {name}` is prefix-sensitive once names such as `advance_dialogue_core` exist.

Then update both policy classifications together:

- remove `advance_dialogue` from the fixed ordinary-policy list;
- remove ask/challenge/present/withdraw/resume from the ordinary list;
- keep `complete_interrogation_phase` in the ordinary list;
- add ask/present/withdraw/resume and `challenge_interrogation_line_core` to the exact no-thumbnail pins;
- pin `advance_dialogue` to `advance_dialogue_core`;
- pin `advance_dialogue_core` to the selector seam.

Ordinary-policy assertions must use an exact enough literal such as:

```rust
MutationPersistencePolicy::AutosaveIfAdvanced,
```

so `AutosaveIfAdvancedWithoutThumbnail` cannot satisfy them by substring.

### Component proof

`InterrogationEvidenceTray.test.ts` pins `data-save-thumbnail-exclude` on the outer scrim. Existing focus, Escape, selection, image, and Game Menu behavior remains untouched.

### Packaged proof

Use the existing capture-proof instrumentation; do not introduce a wall-clock threshold.

Start directly in production `interrogation_scene_4` through `startCaptureProofAtScene`, using:

```ts
interrogationEntryDialogue: "他從進來就一直捏著那罐東西",
```

Before reading capture counters, wait for the existing capture-proof probe to mount:

```ts
await browser.waitUntil(
  async () => elementExists(anchors.captureProof.probe),
  {
    timeout: 10000,
    timeoutMsg: "packaged capture proof probe did not mount",
  },
);
```

This is required because `captureWrapperStatus()` intentionally defaults missing probe attributes to zero.

Then reuse the Scene 4 flow:

```text
startCaptureProofAtScene(interrogation_scene_4, interrogationEntryDialogue)
  -> drain intro to interrogation mode
  -> ask 二十二點五十六分左右在哪裡
  -> advance testimony until 反駁 is available
  -> challenge
  -> advance until Present mounts
```

Use the existing `autosaveSaveIds()` helper for the persistence baseline.

Across that interrogation loop:

- capture call count must stay flat;
- capture available count must stay flat;
- a fresh native autosave must still be written;
- its thumbnail type must be `unavailable`;
- its summary must identify `interrogation_scene_4`;
- its snapshot scene must be `interrogation`;
- its cross-exam snapshot must be `presenting`.

A flat counter alone is not falsifiable when the baseline can legitimately be zero. Therefore add a same-document positive control immediately afterward:

1. wait for persistence to settle;
2. call the existing `saveManualSlot(3, ...)` helper while Present remains mounted;
3. assert the capture wrapper's `calls` increased by exactly one.

Manual Save is a useful positive control because it deliberately requests a prepared thumbnail through the same `gameplayThumbnailCapture.capture` wrapper, and the existing save flow already preserves/focuses the Present tray while saving.

The regression therefore proves:

```text
probe mounted
flat capture count through transient interrogation progress
fresh exact no-thumbnail autosave
+1 capture call for explicit manual Save
```

It cannot pass solely because the probe was absent or because all capture instrumentation stayed at zero.

## Expected implementation surface

Production behavior:

- `apps/game/src-tauri/src/lib.rs`
- `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`

Test/support surface:

- `apps/game/src-tauri/src/game/test_support.rs`
- `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts`
- `apps/game/e2e-tauri/capture-proof.e2e.ts`
- `apps/game/e2e-tauri/production-anchors.ts`

No save schema, save storage, coordinator module, frontend game-client, authored scene, asset, dependency, or generated-resource change is expected.

## Non-goals

Do not add:

- global thumbnail suppression;
- a thumbnail scheduler;
- cancellation/abort plumbing;
- a Web Worker;
- old-thumbnail copying;
- a new thumbnail sidecar policy;
- native capture;
- evidence-card virtualization;
- a tray visual redesign;
- a full-state IPC refactor;
- save schema migration;
- a wall-clock CI performance threshold.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Testimony is `ModeView::Dialogue` and accidentally keeps thumbnails | Classify from `SceneView` and prove it at the command boundary. |
| Last ordinary dialogue line entering interrogation loses its preview | Compare source `QueueToken.scene_id` with committed interrogation ID; mismatch keeps ordinary capture. |
| Last interrogation line leaving the scene loses its milestone preview | Committed non-interrogation scene selects ordinary capture. |
| Prefix-sensitive source helper inspects the wrong function | Change `function_body` marker to `fn {name}(` before adding `_core` names. |
| Source tests falsely pass because one policy name contains the other | Use comma-terminated policy literals and behavioral ticket assertions. |
| An older/manual capture sees the Present tray | Mark the scrim with the existing capture-exclusion attribute. |
| Capture-count regression passes at `0 === 0` | Wait for probe mount, prove flat transient count, then prove exactly `+1` on manual Save in the same document. |
| No-thumbnail autosave displays unavailable preview | Accept existing valid-save behavior; HPA-550 owns the product decision. |

## Acceptance criteria

- Advancing dialogue while the source token and committed state belong to the same interrogation scene returns `thumbnailCapture: null` and still schedules autosave persistence.
- Entering an interrogation via `advance_dialogue` retains ordinary thumbnail capture.
- Leaving an interrogation via `advance_dialogue` retains ordinary thumbnail capture.
- Ordinary dialogue outside interrogation retains dynamic thumbnail capture.
- Starting a question, challenging, presenting, withdrawing, and resuming interrogation do not request thumbnails.
- Completing an interrogation phase remains directly wired to ordinary thumbnail autosave.
- The Present tray is excluded from overlapping and manual-save capture.
- Rust command-boundary tests directly assert the selector and challenge ticket behavior.
- The source helper matches exact function declarations before `_core` names are added.
- Existing source-contract tests classify transient and stable commands correctly without policy substring false positives.
- Packaged capture proof waits for its probe, starts directly at `interrogation_scene_4`, reaches Present with a flat capture-call count, and observes a fresh unavailable-preview Present-state autosave.
- The same packaged document then performs one manual Save and observes capture calls increase by exactly one.
- Existing ordinary-dialogue capture proof remains unchanged and continues to pass.
- No new persistence/capture abstraction, schema change, dependency, or HPA-550 product decision is introduced.
