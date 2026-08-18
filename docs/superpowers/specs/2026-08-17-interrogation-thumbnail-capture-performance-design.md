# Interrogation Thumbnail Capture Performance Design

**Date:** 2026-08-17  
**Status:** Proposed planning specification — revised after implementation-plan review

## Goal

Remove the visible hitch while advancing testimony and opening the Present evidence tray during interrogation, without weakening autosave durability and without starting the broader save-thumbnail product decision tracked by HPA-550.

The fix stays intentionally narrow:

- interrogation progress still autosaves through the existing coordinator;
- transient interrogation commands stop requesting dynamic thumbnail capture;
- dialogue capture is suppressed only while an `advance_dialogue` starts and finishes in the same interrogation scene;
- entering or leaving an interrogation remains an ordinary thumbnail milestone;
- ordinary non-interrogation dialogue keeps its current thumbnail behavior;
- explicit manual saves still request a thumbnail;
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

The capture promise is detached from `gameState.inFlight`, but the expensive DOM, SVG, image decode, font embedding, and Canvas work still executes in the WebView. Backend autosave debounce does not prevent that frontend work because the thumbnail request is issued before the debounced writer decides which revision wins.

Opening Present is the worst case. `challenge_interrogation_line` commits a state where `InterrogationEvidenceTray` is mounted before capture starts. The tray contributes a full-viewport scrim, `backdrop-filter`, large shadows, all evidence/statement cards, and evidence images. A capture already in progress can also observe the live tray after it opens.

The performance bug is therefore not evidence-path resolution or interrogation engine complexity. It is eager dynamic thumbnail capture on high-frequency interrogation mutations, amplified by capturing a heavy transient overlay.

## Reuse survey

| Need | Decision |
| --- | --- |
| No-thumbnail autosave | Reuse `MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail`. |
| Save scheduling | Reuse `notify_committed_without_thumbnail`; do not add a fourth persistence policy. |
| Mutation/revision ownership | Keep `run_gameplay_mutation` as the single lock/revision/coordinator owner. |
| Conditional dialogue policy | Add one selector-capable wrapper around the same centralized mutation path. |
| Source-scene identity | Reuse `QueueToken.scene_id`; do not take a second engine snapshot merely to classify the pre-mutation scene. |
| Interrogation classification | Match `SceneView::Interrogation`, not `ModeView`; testimony itself runs in `ModeView::Dialogue`. |
| Current HTTP adapter | Route through the same small `*_core` functions while HPA-559 has not removed it. |
| Capture exclusion | Reuse `data-save-thumbnail-exclude`, already understood by the capture pipeline. |
| Regression proof | Reuse existing command-boundary thumbnail assertions and packaged capture-call counters. |
| Interrogation E2E journey | Reuse `unicodeSave` anchors and the ask/challenge/Present flow already exercised in `save-seed.e2e.ts`. |

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

The existing fixed-policy function delegates to this seam:

```rust
fn run_gameplay_mutation(
    state: &AppState,
    policy: MutationPersistencePolicy,
    mutation: impl FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation_selecting_policy(state, |_| policy, mutation)
}
```

This keeps one lock/revision/coordinator implementation and gives `advance_dialogue` the one capability it needs: choose persistence behavior from the committed state.

Do not add another session lock, a new persistence owner, or a general command-policy framework.

### 2. `advance_dialogue` uses source scene identity plus committed scene identity

Choosing only from the committed scene is insufficient. Draining the final line of one scene can load the next scene inside the same `advance_dialogue` call. A selector that merely checks whether the committed scene is interrogation would suppress the thumbnail on the transition *into* interrogation, contradicting the desired boundary.

The incoming `QueueToken` already carries the source `scene_id`, so reuse it.

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

`advance_dialogue_core` captures only the token scene ID before moving the token into the engine command:

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

This preserves the intended matrix:

| Start | Committed result | Policy |
| --- | --- | --- |
| ordinary scene | ordinary scene | ordinary autosave + thumbnail |
| ordinary scene | interrogation scene | ordinary autosave + thumbnail — entry milestone |
| interrogation scene | same interrogation scene | autosave without thumbnail |
| interrogation scene | non-interrogation scene | ordinary autosave + thumbnail — exit milestone |

This is deliberately scene-based. `ModeView::Dialogue` cannot distinguish ordinary dialogue from interrogation testimony.

### 3. Five transient interrogation commands use the existing no-thumbnail policy

The following commands represent high-frequency interrogation progress rather than useful preview milestones:

- `ask_interrogation_question`;
- `challenge_interrogation_line`;
- `present_interrogation_evidence`;
- `withdraw_interrogation`;
- `resume_interrogation_testimony`.

Each receives a small private `*_core` function using:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
```

Both current command surfaces call the same core while the development HTTP adapter still exists. This avoids duplicating policy literals and avoids inventing a source parser for an adapter HPA-559 is already scheduled to delete.

If HPA-559 lands first, implementation should simply omit the deleted adapter wiring. It must not restore the adapter for this fix.

### 4. `complete_interrogation_phase` remains a thumbnail milestone

Do not suppress capture for `complete_interrogation_phase`.

Phase completion is a stable, low-frequency transition and is a reasonable moment for a new preview. It remains:

```rust
MutationPersistencePolicy::AutosaveIfAdvanced
```

Scene entry and scene exit through `advance_dialogue` are also preserved as ordinary thumbnail milestones by the source+committed scene matrix.

### 5. Exclude the Present tray from capture

Add the established marker to the outer scrim:

```svelte
<div
  class="interrogation-tray-scrim"
  data-save-thumbnail-exclude=""
>
```

Do not unmount the tray during capture and do not remove the blur as part of this fix. The capture pipeline already knows how to omit marked subtrees.

This matters even after transient commands stop issuing new capture tickets:

- an older capture may still overlap the tray opening;
- the player can open the Game Menu and manually save while Present remains mounted;
- manual saves should capture the underlying scene, not the temporary evidence picker.

### 6. Keep preview availability semantics unchanged

No-thumbnail autosave intentionally writes a valid autosave whose preview can be unavailable. Do not copy a prior sidecar, synthesize a placeholder image, or add a new fallback protocol.

This fix changes *when dynamic capture is requested*, not the save schema or save validity rules.

HPA-550 remains the later product decision about whether dynamic thumbnails are worth retaining at all.

## Verification strategy

### Command-boundary proof is primary

Source scanning is useful only as a wiring pin. The actual policy must be proved through the existing Rust command/mutation boundary where `thumbnail_capture` and coordinator activity are observable.

Widen the existing interrogation fixtures from `pub(super)` to `pub(crate)` so the `lib.rs` tests can reuse them:

- `two_line_question_scene`;
- `empty_engine_with_interrogation_scene`.

Required behavioral assertions:

1. `advance_dialogue_core` inside an interrogation scene advances revision, returns `thumbnail_capture: None`, and leaves `ThumbnailActivityView::Idle`.
2. `advance_dialogue_core` on the existing ordinary investigation fixture still returns a thumbnail capture request.
3. The dialogue selector preserves entry and exit milestones: a source-scene mismatch with committed interrogation uses ordinary capture, and a committed non-interrogation scene uses ordinary capture.
4. `challenge_interrogation_line_core` returns no thumbnail while advancing state.
5. `complete_interrogation_phase` still returns a thumbnail request when it advances.

Keep source-contract checks only for structural wiring:

- fixed no-thumbnail cores use the comma-terminated `MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,` literal;
- `complete_interrogation_phase` remains in the ordinary fixed-policy list;
- the five transient commands are removed from that ordinary list;
- `advance_dialogue` is not classified as a fixed ordinary-policy command because it uses the selector seam.

Avoid substring checks where `AutosaveIfAdvancedWithoutThumbnail` could accidentally satisfy `AutosaveIfAdvanced`.

### Component proof

`InterrogationEvidenceTray.test.ts` pins `data-save-thumbnail-exclude` on the outer scrim. Existing focus, Escape, selection, image, and Game Menu behavior remains untouched.

### Packaged proof

Use the existing capture-proof instrumentation; do not introduce a wall-clock performance threshold.

The packaged regression starts directly in the production interrogation scene rather than calling `jumpToProductionScene` from inside the capture-proof suite. The suite already documents that the latter can starve the embedded WebDriver bridge during scene-navigation settlement.

Add one production anchor:

```ts
interrogationEntryDialogue: "他從進來就一直捏著那罐東西",
```

This is the first spoken line in `docs/stories_plan/chapter_1/interrogation_scene_4.md` and gives `startCaptureProofAtScene` a stable visible fragment.

Then reuse the established journey:

```text
startCaptureProofAtScene(interrogation_scene_4, interrogationEntryDialogue)
  -> drain intro to interrogation mode
  -> ask 二十二點五十六分左右在哪裡
  -> advance testimony until 反駁 is available
  -> challenge
  -> advance until Present mounts
```

Take a capture-call baseline after the fresh scene is ready. Across the interrogation progress loop:

- capture call count must not increase;
- a fresh native autosave must still be written;
- its thumbnail type must be `unavailable`;
- its summary must still identify `interrogation_scene_4`;
- its snapshot scene must be `interrogation`;
- its cross-exam snapshot must be `presenting`.

The existing ordinary-dialogue capture proof remains unchanged and continues proving that dynamic capture still works outside the interrogation loop.

Manual acceptance also verifies that Save from Present succeeds and the saved image shows the underlying scene rather than the Present tray.

## Source-contract cleanup

The current source-contract tests contain two classifications that must change together:

1. The Analysis/no-thumbnail policy test currently separately pins `advance_dialogue` to ordinary capture. Replace that assertion with selector/core wiring plus behavioral tests.
2. `every_ordinary_mutation_routes_through_the_central_autosave_policy` currently includes the five transient interrogation commands. Remove those five and keep `complete_interrogation_phase` in the ordinary list.

Because `AutosaveIfAdvancedWithoutThumbnail` contains `AutosaveIfAdvanced` as a substring, ordinary-policy checks must match the comma-terminated policy literal or otherwise use an exact enough assertion to avoid false positives.

No new `development_command_arm` brace-depth parser is added.

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

Those are either unnecessary for the reported hitch or belong to HPA-550/later performance work.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Testimony is `ModeView::Dialogue` and accidentally keeps thumbnails | Classify from `SceneView`, and prove it at the command boundary. |
| Last ordinary dialogue line entering interrogation loses its preview | Use `QueueToken.scene_id` plus committed interrogation scene ID; mismatch keeps ordinary capture. |
| Last interrogation line leaving the scene loses its milestone preview | Committed non-interrogation scene selects ordinary capture. |
| Source tests falsely pass because one policy name contains the other | Use exact/comma-terminated literals and behavioral ticket assertions. |
| HTTP/Tauri policy drifts before HPA-559 lands | Route both through the same small `*_core` functions. |
| HPA-559 lands first | Skip deleted HTTP wiring; never restore the adapter. |
| An older/manual capture sees the Present tray | Mark the scrim with the existing capture-exclusion attribute. |
| E2E becomes flaky from scene jumping or timing thresholds | Start directly at the production interrogation scene and assert capture-call counts/state, not milliseconds. |
| No-thumbnail autosave displays unavailable preview | Accept existing valid-save behavior; HPA-550 owns the product decision. |

## Acceptance criteria

- Advancing dialogue while the source token and committed state belong to the same interrogation scene returns `thumbnailCapture: null` and still schedules ordinary autosave persistence.
- Entering an interrogation via `advance_dialogue` retains ordinary thumbnail capture.
- Leaving an interrogation via `advance_dialogue` retains ordinary thumbnail capture.
- Ordinary dialogue outside interrogation retains dynamic thumbnail capture.
- Starting a question, challenging, presenting, withdrawing, and resuming interrogation do not request thumbnails.
- Completing an interrogation phase retains ordinary thumbnail autosave.
- The Present tray is excluded from overlapping and manual save capture.
- Rust command-boundary tests directly assert capture/no-capture behavior and coordinator activity.
- Existing source-contract tests classify the transient and stable commands correctly without substring false positives.
- No new HTTP-arm parser is introduced.
- Packaged capture proof starts directly at `interrogation_scene_4`, reaches Present without increasing capture-call count, and observes a fresh unavailable-preview autosave whose snapshot is still in Present state.
- Existing ordinary-dialogue capture proof continues to prove that dynamic capture works outside interrogation.
- Manual Save from Present succeeds and captures the underlying scene.
- No new persistence/capture abstraction, schema change, dependency, or HPA-550 product decision is introduced.
