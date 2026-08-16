# HPA-549 Acquisition Acknowledgement Simplification Design

## Status

Planning specification for HPA-549 against current `main` after HPA-603.

This is a pre-release simplification. Lyra has no released save format. The accepted product tradeoff is:

> Acquisition and acknowledgement both use ordinary autosave durability. A crash may lose any mutation that has not reached disk yet. HPA-549 does not strengthen acquisition durability. Once a durable save already contains an acquired record plus its pending popup, replaying that popup after a later crash must never grant the record or story effects a second time.

HPA-621 remains blocked pending the replacement Analysis UX. HPA-549 is the next actionable task because it is independent of that UX work and directly blocks HPA-536 Chapter 1 production hardening and HPA-560's later E2E simplification.

## Decision summary

Delete the dedicated durable acquisition-acknowledgement transaction.

The resulting lifecycle is deliberately small:

```text
Acquire record command
  -> inventory/story/pending event/revision commit atomically in GameEngine
  -> ordinary autosave

Dismiss popup command
  -> acknowledge the canonical presented event
  -> revision commit through GameEngine::command_tx
  -> ordinary autosave without thumbnail
```

The UI waits for the acknowledgement gameplay mutation, not for a second disk transaction.

Two crash windows must be distinguished:

1. **Crash before the acquisition autosave commits:** the acquisition itself may be lost, exactly as on current `main`. HPA-549 does not change this ordinary-autosave behavior.
2. **Crash after a durable save already contains the acquisition, but before a later acknowledgement autosave commits:** the same popup may replay. That replay is harmless because acknowledgement never re-runs acquisition or story reveals.

## Reuse survey

| Need | Decision |
| --- | --- |
| Engine acknowledgement command | Extend the existing `GameEngine::command_tx` / `CommandMutation` seam. |
| Presented-event identity | Extract the existing `(created_by_command_id, ordinal)` ordering from `pending_acquisition_view` into one helper; do not use `Vec::first()`. |
| Tauri mutation routing | Reuse `run_gameplay_mutation(..., AutosaveIfAdvancedWithoutThumbnail, ...)`, the same no-thumbnail autosave policy already used by Analysis mutations. |
| Development HTTP routing | Reuse the existing development dispatch table and call the same acknowledgement core as Tauri. Do not remove the HTTP fallback in HPA-549. |
| Autosave after dismiss | Reuse `notify_committed_without_thumbnail` and existing stale-write guards. No acknowledgement writer is needed. |
| Frontend command | Reuse `dispatchStateCommand` and its existing in-flight, `gameState.error`, and `GameplayCommandResultView` application behavior. |
| Popup error region | Reuse the existing `failure-message` / `role="alert"` presentation rather than inventing another error surface. |
| Frontend controller | Keep and shrink `acquisition-controller.svelte.ts`; retain `current`, `blocking`, `busy`, `dismissCurrent`, and `clear`. |
| `refreshGameState` | Delete it. Current `main` has no production caller; only source tests reference it. Do not preserve dead acknowledgement-refresh structure. |
| Coordinator acknowledgement protocol | Delete it. There is no equivalent product to retain or replace. |
| Writer-queue coverage | Preserve generic serialization/debounce invariants by re-hosting tests on surviving ordinary/manual writer classes; delete acknowledgement-priority-only assertions. |
| Crash-replay proof | Require a real save-file write -> real restore round-trip, not an in-memory clone. |

## Current problem

Acquiring a record and dismissing its popup are currently treated as two different persistence products.

The acquisition itself is already an ordinary gameplay command transaction:

- inventory mutation is atomic in the engine command;
- story effects are atomic in the engine command;
- pending acquisition events are created in that transaction;
- durable revision advances once;
- command rollback restores those fields together on command failure;
- disk durability is still ordinary debounced autosave.

Popup dismissal, however, currently owns a second protocol with:

- `ThumbnailCapturePurpose::AcquisitionAcknowledgement`;
- `PreparedThumbnailPurpose::AcquisitionAcknowledgement`;
- source/next-revision/event ticket binding;
- acknowledgement thumbnail preflight and capture;
- `ExclusivePersistenceIntent::AcquisitionAcknowledgement`;
- acknowledgement rollback guards;
- special writer/flush ownership;
- acknowledgement-specific failure-token retry/cancel/continue-without-saving paths;
- four acknowledgement-specific Tauri/frontend operations;
- a multi-phase frontend acknowledgement state machine;
- dedicated coordinator and exit-race coverage.

That machinery guarantees popup dismissal is durably persisted before the popup disappears. HPA-549 explicitly gives up that stronger acknowledgement guarantee during active development.

## Product contract after HPA-549

### Acquisition remains an ordinary atomic gameplay command

The command that acquires a record is unchanged in principle:

1. run through `GameEngine::command_tx`;
2. add the record at most once;
3. apply story effects at most once;
4. append pending acquisition event(s);
5. advance durable revision once;
6. schedule ordinary autosave.

If the acquiring command itself fails, rollback restores inventory, story state, pending events, dialogue/history, and revision together.

This does **not** mean the acquisition is crash-durable before autosave reaches disk. A forced termination during the ordinary autosave window can lose the entire unsaved acquisition, just like any other unsaved gameplay mutation on current `main`.

### Acknowledgement becomes an ordinary gameplay mutation

Dismissing the popup performs one engine command:

1. identify the same event that `pending_acquisition_view` would present;
2. if the requested ID matches that event, remove only that event and advance the revision once;
3. if no event is pending, return `CommandMutation::Unchanged`;
4. if the requested ID is not present anywhere in the pending queue, treat it as stale/duplicate and return `CommandMutation::Unchanged`;
5. if the requested ID names a different event that is still pending behind the presented event, return `GameError::unknown_acquisition_event()` rather than silently doing nothing;
6. route successful/no-op results through `AutosaveIfAdvancedWithoutThumbnail`;
7. return the accepted in-memory state immediately; do not wait for an autosave receipt.

No acknowledgement ledger is added.

### Why later-pending mismatch is an error

A stale duplicate is expected in an idempotent API: the requested ID is no longer in the queue.

A request for a different event that is **still in the queue** is different. It means the client and engine disagree about which popup is on screen. Silently returning `Unchanged` would leave a working-looking Continue button with no diagnostic.

Therefore:

```text
queue empty                         -> Unchanged
requested ID absent from queue      -> Unchanged (stale/duplicate)
requested ID == canonical presented -> Changed
requested ID is another queued item -> unknownAcquisitionEvent
```

The error already exists in the acquisition domain and is surfaced through the shared game-client error path.

## Canonical presented-event identity

### Do not use vector insertion order

`pending_acquisition_view` already defines presentation order by the minimum key:

```text
(created_by_command_id, ordinal)
```

That is the canonical acknowledgement identity too.

The implementation must not use `pending_acquisition_events.first()`. Existing tests already prove the vector may be physically stored in a different order while the visible popup is the earliest durable event.

Example:

```text
stored vec: [acq:7:1, acq:7:0]
presented popup: acq:7:0
```

Continue sends the visible popup ID. Therefore the engine command must acknowledge `acq:7:0`, not the vector's first element.

### One helper, two consumers

Extract one small domain helper:

```rust
pub(in crate::game) fn presented_event_index(
    events: &[AcquisitionEventStateV1],
) -> Option<usize> {
    events
        .iter()
        .enumerate()
        .min_by_key(|(_, event)| (event.created_by_command_id, event.ordinal))
        .map(|(index, _)| index)
}
```

Use it from both:

- `GameEngine::pending_acquisition_view`;
- `GameEngine::acknowledge_acquisition_event`.

The acknowledgement command removes by that index only on exact presented-ID match. It must never search and remove an arbitrary later item.

## Chosen architecture

### 1. Engine command through `command_tx`

Add one public engine command in `game/acquisition.rs`:

```rust
pub fn acknowledge_acquisition_event(
    &mut self,
    event_id: &str,
) -> Result<GameStateView, GameError>
```

It runs through `command_tx` and implements the four-way result above:

- no queue -> `Unchanged`;
- stale/duplicate ID absent from queue -> `Unchanged`;
- exact canonical presented ID -> remove + `Changed`;
- another still-pending ID -> `unknown_acquisition_event`.

It mutates only `pending_acquisition_events`. It never re-runs acquisition or story reveals.

### 2. Tauri and development HTTP share the same ordinary core

Keep the public command name `acknowledge_acquisition_event`, but remove the prepared-thumbnail-ticket argument.

Create one core function in `lib.rs`:

```rust
fn acknowledge_acquisition_event_core(
    state: &AppState,
    event_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        state,
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
        |engine| engine.acknowledge_acquisition_event(&event_id),
    )
}
```

Both surfaces call that core:

- the Tauri command;
- `dispatch_development_command_with_exit` / the existing development HTTP command table.

Do not preserve separate HTTP acknowledgement semantics and do not remove the HTTP fallback in this ticket; HPA-559 owns transport deletion.

### 3. Extend the existing no-thumbnail source-contract scanner

Current `lib.rs` source-contract tests still assert acknowledgement is `CoordinatorManaged` and enumerate all three recovery commands. HPA-549 updates those tests in the same change as command routing.

Use the existing Analysis-style no-thumbnail policy scanner:

- include `acknowledge_acquisition_event` alongside the Analysis commands;
- require `run_gameplay_mutation` + `AutosaveIfAdvancedWithoutThumbnail`;
- remove the old `CoordinatorManaged` acknowledgement assertion;
- remove source assertions and handler entries for `confirm_acquisition_without_saving`, `retry_acquisition_acknowledgement`, and `cancel_acquisition_failure`;
- remove those three development HTTP branches.

No new scanner is needed.

### 4. Treat the frontend as one atomic refactor

The controller, popup, and `+page.svelte` are one dependency edge. Do not split them into commits that leave Svelte props/types inconsistent.

The final controller surface is:

```ts
export type AcquisitionController = {
  readonly current: PendingAcquisitionView | null;
  readonly blocking: boolean;
  readonly busy: boolean;
  dismissCurrent: (expectedEventId: string) => Promise<void>;
  clear: () => void;
};
```

`size` is deleted. `PendingAcquisitionView` is a single visible event and `size` has no production caller; `current ? 1 : 0` is dead surface.

The popup keeps:

- modal/blocking behavior;
- current visual treatment;
- one Continue button;
- focus trap/restoration;
- shared `gameState.error` inside the dialog.

It deletes:

- acknowledgement phases;
- Retry/Cancel/Continue-without-saving controls;
- acknowledgement thumbnail capture workflow.

The controller keeps a local `busy` flag plus generation fence. `busy` is a UI affordance while the global `gameState.inFlight` guard remains authoritative; the generation fence still prevents an old promise's `finally` from clearing a newer busy state after `clear()`.

### 5. Delete dead `refreshGameState`

Current `main` has no production call site for `refreshGameState`; it is referenced only by `game-client-source.test.ts`.

HPA-549 should delete:

- the exported `refreshGameState` function;
- its acknowledgement/exit special-case structure;
- source tests whose only purpose is keeping that unused function alive.

Do not replace it with a compatibility overload or a smaller dead helper. If a new production caller appears before implementation, re-review that change rather than preserving dead code pre-emptively.

### 6. Delete the coordinator acknowledgement product

Delete acknowledgement-only persistence concepts, including:

- `ThumbnailCapturePurpose::AcquisitionAcknowledgement`;
- `PreparedThumbnailPurpose::AcquisitionAcknowledgement`;
- acknowledgement outcome/write/request identity structs;
- `CaptureIntent::AcquisitionAcknowledgement`;
- acknowledgement-specific writer class/priority queue;
- acknowledgement rollback and intent guards;
- `FlushOperation::AcquisitionAcknowledgement` when now unused;
- `PersistenceBypassOperation::ContinueWithoutSaving` and acquisition-event failure-challenge identity where unused;
- coordinator acknowledge/retry/cancel/confirm-without-saving methods;
- acknowledgement-specific tests whose only subject is the deleted protocol.

`ExclusivePersistenceIntent` currently has only `AcquisitionAcknowledgement`; delete the enum entirely rather than leaving a zero-variant abstraction.

Keep all general persistence behavior:

- ordinary autosave;
- manual save and its thumbnail capture;
- save discovery/load/delete;
- persistence health;
- exit flush;
- session replacement;
- pending acquisition events in snapshots.

HPA-521 still owns broader SaveCoordinator collapse.

## Writer-queue test preservation

Deleting acknowledgement priority must not accidentally delete generic writer-queue coverage.

`writer.rs` currently uses `reserve_acknowledgement_writer` as a convenient blocking/priority vehicle for several broader invariants. Re-host the surviving invariants on ordinary/manual writer classes:

- one writer runs at a time;
- a queued writer does not start before the current writer completes;
- a newer debounced write supersedes the older queued debounced write before writer turn.

Delete the acknowledgement-specific priority assertion itself. There is no longer an acknowledgement-priority queue to preserve.

Also update the current scheduler-rejection assertion so it no longer expects an `acknowledgements` deque after that deque is removed.

`unit.rs` contains acknowledgement-only tests/imports for exclusive intent, acquisition-event failure identity, and `reserve_acknowledgement_writer`; remove those while retaining general manual/delete writer and failure-token coverage.

`lock_order.rs::queued_exclusive_intent_rejects_session_transitions_without_waiting` should be deleted, not re-hosted: once `ExclusivePersistenceIntent` is removed, there is no surviving generic "queued exclusive work" invariant. Preserve the unrelated replacement-gate/session lock-order tests.

Audit the other current acknowledgement references explicitly (`ticket.rs`, `exit_lifecycle.rs`, `e2e_replacement.rs`, `flush.rs`, `failure_token.rs`) and keep any test whose subject survives independently of acknowledgement.

## Exit lifecycle impact

The packaged exit suite currently proves "quit while acknowledgement owns exclusive persistence". That proof belongs to the product being deleted.

Replace it with ordinary behavior:

1. dismiss the popup through the new gameplay command;
2. pending event disappears in memory;
3. request application quit normally;
4. exit flush persists the current revision;
5. restart/Continue;
6. assert the record exists once and the popup is absent because exit flush completed.

Delete:

- the `wait_for_active_acknowledgement` argument/poll loop from the E2E quit command;
- `requestApplicationQuitWhenAcknowledging` when unused;
- the old exclusive-ack race semantics.

This is ordinary exit-flush coverage after an ordinary mutation, not a replacement race protocol.

## Failure behavior

### Engine/client identity disagreement

If the client requests a different event that is still pending behind the canonical presented event:

- engine returns `unknownAcquisitionEvent`;
- no pending event is removed;
- revision does not advance;
- popup remains open;
- shared `gameState.error` appears in the modal.

### Stale or duplicate acknowledgement

If the requested ID is absent from the pending queue:

- return `Unchanged`;
- no revision bump;
- no new ledger or diagnostic is required.

### Autosave failure after accepted acknowledgement

Once the in-memory acknowledgement succeeds:

- popup closes;
- ordinary persistence health owns any later write failure;
- acknowledgement is not rolled back merely because ordinary autosave fails;
- a later crash may replay the popup from an older successful save.

## Required proof strategy

### Engine/domain tests

Add focused acknowledgement tests:

1. canonical presented event is removed and revision increments once;
2. second event becomes presented after first acknowledgement;
3. stale/duplicate ID absent from queue is a no-op with no revision bump;
4. requested ID for a different still-pending event returns `unknownAcquisitionEvent` and cannot skip the presented event;
5. empty queue is a no-op;
6. inverted vector `[acq:7:1, acq:7:0]` still presents and acknowledges `acq:7:0` first.

The inverted-order case is mandatory because it catches `Vec::first()`.

### Tauri/application tests

Pin `acknowledge_acquisition_event` to `AutosaveIfAdvancedWithoutThumbnail` using the existing no-thumbnail source-contract/application pattern.

Prove:

- returned `thumbnailCapture` is null;
- no thumbnail activity is started;
- duplicate acknowledgement does not advance revision;
- later-pending mismatch surfaces the typed error through the ordinary command path.

### Required real-file crash-replay test

The replay guarantee must cross serialization and restore. An in-memory clone does not count.

Use `apps/game/src-tauri/src/game/save/coordinator/tests/storage_integration.rs` as the required integration home, extending its existing real `ProductionSaveFilesystem` write coverage. The test must:

1. build a valid fixture engine/state with an acquired record exactly once, story output, and pending acquisition event;
2. capture that pre-acknowledgement state into a real save envelope;
3. write it through the real save storage path (`prepare_slot_write`/`commit_prepared_slot_write` or the equivalent existing writer seam) to a temp save file;
4. acknowledge the live in-memory event and prove current state clears the popup without changing record/story counts;
5. read the previously written file back through the real save reader;
6. restore through `build_restore_candidate` using matching fixture definitions/resources;
7. assert the durable acquisition record/story output survived exactly once and the pending popup reappears;
8. acknowledge the restored popup again and prove record/story counts remain single.

This models "durable acquisition, unsaved acknowledgement, crash" precisely. Do not replace steps 3/5/6 with cloning a `GameEngine` or `SaveSnapshot`.

### Frontend tests

The merged frontend task proves:

- Continue dispatches once;
- `busy` prevents double dispatch;
- success advances/closes the authoritative popup;
- typed command failure leaves it visible and exposes shared error text;
- retry is pressing Continue again;
- modal focus/restore and Escape behavior remain intact;
- no acknowledgement thumbnail capture occurs;
- no `size` or `refreshGameState` dead surface remains.

### Packaged save-resume proof

Reuse `save-resume.e2e.ts` and the existing `acknowledgeAcquisitionDomFirst` helper.

Prove:

1. durable save already contains acquired record(s) and pending event(s);
2. restored queue drains in canonical order;
3. ordinary autosave persists the acknowledgement state;
4. reload shows each record exactly once and no acknowledged popup.

Do not add acknowledgement-phase polling or process-kill E2E.

### Packaged exit proof

Reuse `save-exit.e2e.ts`, but retarget it from exclusive acknowledgement to:

```text
acknowledge normally
-> ordinary application quit
-> exit flush
-> restart
-> record exactly once
-> no pending popup
```

## Documentation policy

The existing HPA-129/HPA-392 documents describe the old stronger acknowledgement guarantee. Do not rewrite their historical implementation narrative.

Add a concise supersession note that says:

- HPA-549 removes the second durable acknowledgement transaction;
- acknowledgement now uses ordinary autosave;
- if a durable save already contains the acquisition, a crash before acknowledgement autosave can replay the popup safely;
- HPA-549 does not make unsaved acquisition itself crash-durable.

## Expected implementation file map

### Core / persistence

- `apps/game/src-tauri/src/game/acquisition.rs`
- `apps/game/src-tauri/src/game/mod.rs`
- `apps/game/src-tauri/src/lib.rs`
- `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- `apps/game/src-tauri/src/game/save/coordinator/tests/mod.rs`
- `apps/game/src-tauri/src/game/save/coordinator/tests/writer.rs`
- `apps/game/src-tauri/src/game/save/coordinator/tests/unit.rs`
- `apps/game/src-tauri/src/game/save/coordinator/tests/ticket.rs`
- `apps/game/src-tauri/src/game/save/coordinator/tests/lock_order.rs`
- `apps/game/src-tauri/src/game/save/coordinator/tests/exit_lifecycle.rs`
- `apps/game/src-tauri/src/game/save/coordinator/tests/e2e_replacement.rs`
- `apps/game/src-tauri/src/game/save/coordinator/tests/flush.rs`
- `apps/game/src-tauri/src/game/save/coordinator/tests/failure_token.rs`
- `apps/game/src-tauri/src/game/save/coordinator/tests/storage_integration.rs`
- delete `apps/game/src-tauri/src/game/save/coordinator/tests/acknowledgement.rs`

### Frontend

- `apps/game/src/lib/persistence/types.ts`
- `apps/game/src/lib/persistence/commands.ts`
- `apps/game/src/lib/state/game-client.svelte.ts`
- `apps/game/src/lib/state/game-client-source.test.ts`
- `apps/game/src/lib/state/acquisition-controller.svelte.ts`
- `apps/game/src/lib/state/acquisition-controller.test.ts`
- `apps/game/src/lib/components/AcquisitionPopup.svelte`
- `apps/game/src/lib/components/AcquisitionPopup.test.ts`
- `apps/game/src/routes/+page.svelte`
- `apps/game/src/routes/page.test.ts`
- `apps/game/src/routes/page-source.test.ts`

### Packaged verification

- `apps/game/e2e-tauri/save-resume.e2e.ts`
- `apps/game/e2e-tauri/save-exit.e2e.ts`
- `apps/game/e2e-tauri/save-seed.e2e.ts`
- `apps/game/e2e-tauri/helpers.ts`

### Documentation

- `docs/superpowers/specs/2026-07-25-hpa-129-save-load-autosave-continue-design.md`
- `docs/superpowers/plans/2026-07-26-hpa-392-save-load-persistence-implementation-plan.md` only for a concise supersession note where old wording otherwise looks current.

## Non-goals

- No save schema/version change or migration.
- No acknowledged-event ledger.
- No new persistence policy, writer queue, recovery token, or transaction abstraction.
- No manual-save thumbnail redesign; HPA-550 remains separate.
- No full SaveCoordinator collapse; HPA-521 remains separate.
- No E2E suite/risk-routing redesign; HPA-560 remains separate.
- No HTTP transport removal; HPA-559 remains separate.
- No Analysis UX work.
- No process-kill fault framework.

## Acceptance summary

HPA-549 is complete when the architecture can be described as:

> Acquisition and acknowledgement are ordinary GameEngine mutations saved by normal autosave. Acknowledgement removes only the canonical presented event, stale duplicates are harmless, client/engine queue disagreement is a typed error, and no second acknowledgement persistence product remains.

A crash may lose any mutation that ordinary autosave has not yet persisted. If a durable save already contains the acquisition, replaying its pending popup must never double-grant that acquisition.