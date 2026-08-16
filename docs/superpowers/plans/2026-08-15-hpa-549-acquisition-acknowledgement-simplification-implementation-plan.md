# HPA-549 Acquisition Acknowledgement Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Implement task-by-task with the RED/GREEN checks below.

**Goal:** Remove Lyra's dedicated acquisition-acknowledgement persistence transaction so popup dismissal becomes an ordinary `GameEngine` mutation saved by normal autosave.

**Architecture:** Acquisition remains an ordinary atomic engine command with ordinary autosave durability. Acknowledgement uses the same canonical pending-event identity as `pending_acquisition_view`, routes through `AutosaveIfAdvancedWithoutThumbnail`, and never owns a second thumbnail/writer/failure-token product. The frontend refactor is one atomic task so Svelte props/types remain green. The coordinator deletion preserves only generic writer/persistence invariants. The crash-replay proof must cross a real save-file write and real restore path.

**Tech Stack:** Rust/Tauri 2, Svelte 5, TypeScript, Vitest/Testing Library, existing SaveCoordinator/autosave pipeline, WebdriverIO packaged Tauri E2E.

## Global constraints

- Acquisition still runs through `GameEngine::command_tx` and atomically changes inventory/story/pending events/revision **in memory**.
- HPA-549 does not strengthen acquisition crash durability. A crash before ordinary acquisition autosave commits may lose that unsaved acquisition, unchanged from current `main`.
- Acknowledgement removes the same event `pending_acquisition_view` presents, using canonical `(created_by_command_id, ordinal)` order.
- Queue-empty acknowledgement is a no-op.
- Requested ID absent from the pending queue is a stale/duplicate no-op.
- Requested ID that names a different still-pending event is `GameError::unknown_acquisition_event()`; do not silently no-op a live client/engine disagreement.
- Acknowledgement reuses `MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail`; add no new persistence policy.
- Acknowledgement may disappear from the UI before its autosave is durable. If an older durable save already contains the acquisition, a later crash may replay only the popup.
- Replayed acknowledgement must never re-run acquisition or double-grant records/story effects.
- Remove acknowledgement thumbnail preparation/capture/tickets, exclusive intent, failure tokens, recovery commands, writer priority/reservation, rollback guard, and phase machine.
- Keep `pending_acquisition_events` in snapshots. No save schema/version change or migration.
- Keep manual-save thumbnail behavior unchanged; HPA-550 owns that decision.
- Keep ordinary autosave, save browser/load/delete, exit flush, persistence health, and general recovery behavior.
- Delete dead `refreshGameState`; current `main` has no production caller.
- Delete controller `size`; it has no production caller and a visible acquisition is a single event.
- Do not collapse the full SaveCoordinator (HPA-521), remove HTTP transport (HPA-559), redesign E2E routing (HPA-560), or touch Analysis UX (HPA-621).
- Do not add an acknowledgement ledger, retry queue, recovery token, replacement transaction, process-kill E2E, or new store.

---

## File map

### Domain / Tauri

- `apps/game/src-tauri/src/game/acquisition.rs`
- `apps/game/src-tauri/src/game/mod.rs`
- `apps/game/src-tauri/src/lib.rs`

### Coordinator

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

### Historical docs

- `docs/superpowers/specs/2026-07-25-hpa-129-save-load-autosave-continue-design.md`
- `docs/superpowers/plans/2026-07-26-hpa-392-save-load-persistence-implementation-plan.md` only if a concise supersession note is needed.

---

## Task 1: Share canonical presentation identity and add the engine acknowledgement command

**Files:**
- Modify: `apps/game/src-tauri/src/game/acquisition.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Test: existing acquisition / `command_tx` tests

### Interfaces

Add:

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

Add:

```rust
pub fn acknowledge_acquisition_event(
    &mut self,
    event_id: &str,
) -> Result<GameStateView, GameError>
```

### Step 1: Write RED tests

Add focused tests for:

1. `acknowledging_presented_event_removes_only_it_and_advances_revision`
   - canonical A is presented;
   - acknowledge A;
   - B remains;
   - revision increments exactly once.
2. `duplicate_acknowledgement_is_idempotent`
   - after A is gone, request A again;
   - ID is absent from queue;
   - no error, no revision bump.
3. `later_pending_event_is_identity_error`
   - A is presented and B is still pending;
   - request B;
   - assert `unknownAcquisitionEvent`;
   - queue/revision unchanged.
4. `empty_queue_acknowledgement_is_noop`.
5. **Mandatory inverted-vector regression**
   - physically store `[acq:7:1, acq:7:0]`;
   - `pending_acquisition_view` presents `acq:7:0`;
   - acknowledging `acq:7:0` removes only that event;
   - revision increments once.
6. stale ID not present anywhere in a non-empty queue is still a no-op.

The inverted-vector test must fail if implementation uses `Vec::first()`.

### Step 2: Run RED

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::acquisition::tests --all-features
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  pending_acquisition --all-features
```

### Step 3: Implement the shared helper

- Replace `pending_acquisition_view`'s inline `iter().min_by_key(...)` with `acquisition::presented_event_index(...)`.
- Do not normalize/sort the vector on load.

### Step 4: Implement acknowledgement through `command_tx`

Inside the transaction:

```text
presented_event_index == None
  -> Unchanged

requested ID == presented ID
  -> remove(presented_index), Changed

requested ID exists elsewhere in pending_acquisition_events
  -> Err(GameError::unknown_acquisition_event())

requested ID absent from queue
  -> Unchanged
```

Do not search/remove a later matching event and do not add an acknowledged-ID ledger.

### Step 5: Run GREEN

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::acquisition::tests --all-features
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::command_tx::tests --all-features
```

### Step 6: Commit

```bash
git add apps/game/src-tauri/src/game/acquisition.rs \
  apps/game/src-tauri/src/game/mod.rs
git commit -m "feat(game): make acquisition acknowledgement canonical"
```

---

## Task 2: Route Tauri and development HTTP through ordinary no-thumbnail autosave

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`
- Test: existing `lib.rs` application/source-contract tests

### Final core

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

Tauri and development HTTP both call this core and accept only `eventId`.

### Step 1: Write RED application tests

Using an `AppState` fixture with pending events, prove:

- matching presented ID clears it;
- returned `thumbnail_capture` is `None`;
- thumbnail activity stays idle;
- duplicate/stale ID does not advance revision;
- later still-pending ID returns `unknownAcquisitionEvent` and leaves state unchanged.

### Step 2: Update existing source-contract tests explicitly

In `every_ordinary_mutation_routes_through_the_central_autosave_policy`:

- delete old acknowledgement `CoordinatorManaged` assertions;
- delete assertions for `confirm_acquisition_without_saving`, `retry_acquisition_acknowledgement`, `cancel_acquisition_failure`.

Extend/rename the existing Analysis no-thumbnail scanner instead of creating another scanner. Include:

- `acknowledge_acquisition_event`;
- `select_analysis_board`;
- `update_analysis_draft`;
- `submit_analysis_board`.

For each require:

- `run_gameplay_mutation`;
- `MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail`;
- no direct `session.lock()`.

In the handler registration test:

- keep `acknowledge_acquisition_event` exactly once;
- remove the three acknowledgement recovery commands.

### Step 3: Run RED

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  acknowledge_acquisition_event --all-features
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_workbench_commands_pin_no_thumbnail_autosave_policy --all-features
```

### Step 4: Replace the Tauri acknowledgement command

- Add `acknowledge_acquisition_event_core`.
- Tauri command accepts only `event_id` and calls the core.
- Do not wait for an autosave receipt.

### Step 5: Update development HTTP dispatch in the same change

In the existing dispatch table:

- parse only `event_id` for `acknowledge_acquisition_event`;
- call `acknowledge_acquisition_event_core(state, args.event_id)`;
- remove the coordinator acknowledgement call and `CoordinatorManaged` finish path;
- delete branches for:
  - `confirm_acquisition_without_saving`;
  - `retry_acquisition_acknowledgement`;
  - `cancel_acquisition_failure`.

This updates the fallback contract without removing the fallback itself.

### Step 6: Remove the three recovery Tauri commands

Delete their core/thin command functions, `generate_handler!` entries, and now-unused imports. Keep general persistence failure/exit recovery commands.

### Step 7: Run GREEN

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  acknowledge_acquisition_event --all-features
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  task_11_commands_are_registered_once_with_the_existing_application_surface --all-features
cargo check --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

### Step 8: Commit

```bash
git add apps/game/src-tauri/src/lib.rs
git commit -m "refactor(save): autosave acquisition acknowledgements normally"
```

---

## Task 3: Refactor the complete frontend acknowledgement dependency edge in one commit

**Why one task:** `acquisition-controller.svelte.ts`, `AcquisitionPopup.svelte`, and `+page.svelte` share one prop/type boundary. Splitting them leaves a deliberately uncompilable Svelte tree. Do not add compatibility shims merely to make an intermediate task pass.

**Files:**
- Modify: `apps/game/src/lib/persistence/types.ts`
- Modify: `apps/game/src/lib/persistence/commands.ts`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`
- Modify: `apps/game/src/lib/state/acquisition-controller.svelte.ts`
- Modify: `apps/game/src/lib/state/acquisition-controller.test.ts`
- Modify: `apps/game/src/lib/components/AcquisitionPopup.svelte`
- Modify: `apps/game/src/lib/components/AcquisitionPopup.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/routes/page.test.ts`
- Modify: `apps/game/src/routes/page-source.test.ts`

### Final controller contract

```ts
export type AcquisitionController = {
  readonly current: PendingAcquisitionView | null;
  readonly blocking: boolean;
  readonly busy: boolean;
  dismissCurrent: (expectedEventId: string) => Promise<void>;
  clear: () => void;
};
```

No `size`. No phase machine.

Dependency:

```ts
type AcquisitionControllerDependencies = {
  gameState: { value: GameStateView | null };
  acknowledge: (eventId: string) => Promise<GameStateView | null>;
};
```

### Step 1: Write RED controller/component/page tests together

Controller tests:

- `current`/`blocking` derive from authoritative `gameState.value.pendingAcquisition`;
- dismiss calls acknowledgement once;
- unresolved promise sets `busy` and prevents duplicate dispatch;
- success depends on authoritative applied state, not a local queue;
- command failure leaves current event visible, clears `busy`, and permits another Continue;
- `clear()` invalidates an older in-flight generation so its late `finally` cannot clear a newer busy state;
- no `size`, phase, retry/cancel/bypass API remains.

Popup/page tests:

- modal semantics/focus trap/restore remain;
- one Continue button;
- `busy` disables Continue and shows one concise processing label;
- shared error renders inside the dialog with `role="alert"`;
- pressing Continue after an error retries the same `onContinue`;
- no Retry/Cancel/without-saving controls;
- pending acquisition still blocks gameplay/menu actions;
- page rewires to `busy`/`error`/`onContinue` in the same task.

### Step 2: Run RED focused tests

```bash
bun run --cwd apps/game test \
  src/lib/state/acquisition-controller.test.ts \
  src/lib/components/AcquisitionPopup.test.ts \
  src/routes/page.test.ts \
  src/routes/page-source.test.ts
```

### Step 3: Remove acknowledgement-specific persistence wire types/functions

In `persistence/types.ts`:

- remove `acquisitionAcknowledgement` from `ThumbnailCapturePurposeView` (or simplify to the remaining manual-save shape);
- delete `AcquisitionAcknowledgementPhase`.

In `persistence/commands.ts`, remove:

- old persistence-layer `acknowledgeAcquisitionEvent(eventId, preparedThumbnailTicket)`;
- `confirmAcquisitionWithoutSaving`;
- `retryAcquisitionAcknowledgement`;
- `cancelAcquisitionFailure`.

Keep manual thumbnail prepare/submit/report/read behavior.

### Step 4: Reuse `dispatchStateCommand`

In `game-client.svelte.ts`:

- add `acknowledge_acquisition_event` to the wrapped-result command set used by the test harness;
- export:

```ts
export function acknowledgeAcquisitionEvent(
  eventId: string,
): Promise<GameStateView | null> {
  return dispatchStateCommand("acknowledge_acquisition_event", { eventId });
}
```

Do not route through gameplay SFX inference.

### Step 5: Delete dead `refreshGameState`

Current `main` has no production caller. Delete:

- the exported `refreshGameState` function;
- its acknowledgement/exit refresh special casing;
- `game-client-source.test.ts` cases whose only subject is that function.

Do not replace it with a compatibility overload or reduced dead helper.

### Step 6: Shrink the controller

Keep a `busy` flag and generation fence:

```ts
export function createAcquisitionController(
  dependencies: AcquisitionControllerDependencies,
): AcquisitionController {
  let busy = $state(false);
  let generation = 0;

  function current() {
    return dependencies.gameState.value?.pendingAcquisition ?? null;
  }

  async function dismissCurrent(expectedEventId: string): Promise<void> {
    if (busy || current()?.id !== expectedEventId) return;
    const attempt = ++generation;
    busy = true;
    try {
      await dependencies.acknowledge(expectedEventId);
    } finally {
      if (attempt === generation) busy = false;
    }
  }

  return {
    get current() { return current(); },
    get blocking() { return current() !== null; },
    get busy() { return busy; },
    dismissCurrent,
    clear() {
      generation += 1;
      busy = false;
    },
  };
}
```

No `size` and no local diagnostics.

### Step 7: Simplify `AcquisitionPopup.svelte`

Keep existing visual layout, asset loading, focus trap, Escape claim, and focus restoration.

Replace old phase/failure-token UI with:

- `busy: boolean`;
- `error?: string | null`;
- one Continue button;
- existing failure-message styling/`role="alert"` for shared error text.

Delete retry/cancel/continue-without-saving handlers and controls.

### Step 8: Rewire `+page.svelte` in this same task

Use:

```svelte
<AcquisitionPopup
  notification={acquisitionController.current}
  busy={acquisitionController.busy}
  error={gameState.error}
  returnFocusTo={acquisitionReturnFocus}
  fallbackFocusTarget={gameplayRoot}
  onContinue={acquisitionController.dismissCurrent}
/>
```

Remove old phase/retry/cancel/bypass props/handlers.

Preserve:

- `gameplayInteractionBlocked = acquisitionController.blocking || ...`;
- return-focus capture;
- `acquisitionController.clear()` on session/title replacement.

### Step 9: Run the only frontend green gate

```bash
bun run --cwd apps/game test \
  src/lib/state/acquisition-controller.test.ts \
  src/lib/components/AcquisitionPopup.test.ts \
  src/lib/state/game-client-source.test.ts \
  src/routes/page.test.ts \
  src/routes/page-source.test.ts
bun run --cwd apps/game check
```

Do not commit until `svelte-check` is green with controller, popup, and page migrated together.

### Step 10: Commit

```bash
git add apps/game/src/lib/persistence/types.ts \
  apps/game/src/lib/persistence/commands.ts \
  apps/game/src/lib/state/game-client.svelte.ts \
  apps/game/src/lib/state/game-client-source.test.ts \
  apps/game/src/lib/state/acquisition-controller.svelte.ts \
  apps/game/src/lib/state/acquisition-controller.test.ts \
  apps/game/src/lib/components/AcquisitionPopup.svelte \
  apps/game/src/lib/components/AcquisitionPopup.test.ts \
  apps/game/src/routes/+page.svelte \
  apps/game/src/routes/page.test.ts \
  apps/game/src/routes/page-source.test.ts
git commit -m "refactor(game-ui): simplify acquisition acknowledgement"
```

---

## Task 4: Delete acknowledgement coordinator machinery without losing generic persistence coverage

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator/tests/mod.rs`
- Delete: `apps/game/src-tauri/src/game/save/coordinator/tests/acknowledgement.rs`
- Modify as needed:
  - `writer.rs`
  - `unit.rs`
  - `ticket.rs`
  - `lock_order.rs`
  - `exit_lifecycle.rs`
  - `e2e_replacement.rs`
  - `flush.rs`
  - `failure_token.rs`
- Modify: `apps/game/src-tauri/src/lib.rs` for the E2E quit command/import cleanup

### Step 1: Record the exact deletion inventory

```bash
rg -n \
  "AcquisitionAcknowledgement|AcknowledgementOutcome|ExclusivePersistenceIntent|ContinueWithoutSaving|reserve_acknowledgement_writer|retry_acquisition_acknowledgement|confirm_acquisition_without_saving|cancel_acquisition_failure|prepared_thumbnail_ticket|wait_for_active_acknowledgement" \
  apps/game/src-tauri/src/game/save/coordinator \
  apps/game/src-tauri/src/lib.rs \
  apps/game/src/lib \
  apps/game/e2e-tauri
```

Record in implementation notes/PR body, not a repo file.

### Step 2: Classify tests before deleting production symbols

#### `writer.rs`: preserve generic queue invariants

The current acknowledgement writer is used as a convenient test vehicle. Re-host these surviving behaviors on ordinary/manual writer classes before removing the acknowledgement class/priority deque:

- one writer runs at a time;
- queued writer starts only after current writer completes;
- newer debounced write removes/supersedes an older queued debounced write before writer turn.

Do **not** preserve "acknowledgement is reserved next" priority; that policy is intentionally deleted.

Also update scheduler-rejection assertions so they do not refer to an `acknowledgements` deque after the queue collapses to surviving ordinary work.

#### `unit.rs`: delete acknowledgement-only cases, preserve generic cases

Remove tests/imports whose only subject is:

- `ExclusivePersistenceIntent::AcquisitionAcknowledgement`;
- acquisition-event-specific failure challenge identity that becomes unused;
- `reserve_acknowledgement_writer`.

Keep general manual/delete writer, ordinary failure-token, autosave, discovery, and exit tests.

#### `lock_order.rs`: explicit decision

Delete `queued_exclusive_intent_rejects_session_transitions_without_waiting`. It is not a generic invariant after HPA-549 because `ExclusivePersistenceIntent` has no surviving variant.

Keep unrelated replacement gate/session lock-order tests.

#### Other files

Audit `ticket.rs`, `exit_lifecycle.rs`, `e2e_replacement.rs`, `flush.rs`, and `failure_token.rs` reference-by-reference:

- delete acknowledgement-product assertions;
- retain or re-express any invariant that survives independently on ordinary/manual/autosave/exit paths.

### Step 3: Delete the dedicated acknowledgement test module

- Delete `tests/acknowledgement.rs`.
- Remove its `mod acknowledgement;` registration.
- If helper fixtures from that file are still genuinely useful to surviving tests, move only the minimum generic fixture; do not preserve acknowledgement protocol helpers.

### Step 4: Delete acknowledgement thumbnail/exclusive concepts

Remove:

- `ThumbnailCapturePurpose::AcquisitionAcknowledgement`;
- `PreparedThumbnailPurpose::AcquisitionAcknowledgement`;
- `CaptureIntent::AcquisitionAcknowledgement`;
- source/next-revision/event ticket branches;
- acknowledgement outcome/write/request structs;
- `FlushOperation::AcquisitionAcknowledgement` when unused;
- acknowledgement begin/end methods and rollback/intent guards;
- `ExclusivePersistenceIntent` entirely.

Do not change manual-save ticket validation.

### Step 5: Delete acknowledgement writer/failure machinery

Remove:

- acknowledgement writer class/priority deque/reservation;
- coordinator acknowledge/retry/cancel/confirm-without-saving methods;
- acknowledgement rollback logic;
- `PersistenceBypassOperation::ContinueWithoutSaving` when unused;
- acquisition-event-specific failure identity fields/branches when unused.

The writer queue may simplify to one surviving ordinary queue. Do not invent a replacement priority abstraction.

### Step 6: Remove the native E2E exclusive-ack quit gate

In `e2e_request_application_quit`:

- remove `wait_for_active_acknowledgement` parameter;
- delete the 30-second poll loop;
- remove `ExclusivePersistenceIntent` import;
- keep the command as the ordinary packaged way to trigger the application exit lifecycle.

TypeScript helper/call-site updates happen in Task 5.

### Step 7: Run full Rust gates

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
```

### Step 8: Audit removed symbols

```bash
rg -n \
  "AcquisitionAcknowledgement|AcknowledgementOutcome|ExclusivePersistenceIntent|ContinueWithoutSaving|reserve_acknowledgement_writer|retry_acquisition_acknowledgement|confirm_acquisition_without_saving|cancel_acquisition_failure|wait_for_active_acknowledgement" \
  apps/game/src-tauri/src \
  apps/game/src/lib
```

Expected: zero live production hits for acknowledgement-only protocol symbols.

`preparedThumbnailTicket` may remain for manual save; do not delete legitimate manual-save behavior to satisfy a broad grep.

### Step 9: Commit

```bash
git add -A apps/game/src-tauri/src/game/save/coordinator \
  apps/game/src-tauri/src/lib.rs
git commit -m "refactor(save): remove acquisition acknowledgement transaction"
```

---

## Task 5: Prove real-file replay, ordinary packaged save/exit, and document the weaker guarantee

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/coordinator/tests/storage_integration.rs`
- Modify: `apps/game/e2e-tauri/save-resume.e2e.ts`
- Modify: `apps/game/e2e-tauri/save-exit.e2e.ts`
- Modify: `apps/game/e2e-tauri/save-seed.e2e.ts`
- Modify: `apps/game/e2e-tauri/helpers.ts`
- Modify: `docs/superpowers/specs/2026-07-25-hpa-129-save-load-autosave-continue-design.md`
- Modify if needed: `docs/superpowers/plans/2026-07-26-hpa-392-save-load-persistence-implementation-plan.md`

### Required behavior A: real save-file replay window

This test is mandatory and must cross serialization. An in-memory `GameEngine`/snapshot clone does not satisfy it.

Put the test in `coordinator/tests/storage_integration.rs`, extending its existing real `ProductionSaveFilesystem` write coverage.

Required flow:

1. Build valid fixture resources/definitions and an engine state containing:
   - an acquired record exactly once;
   - a simple story output if practical;
   - the pending acquisition event.
2. Capture the **pre-acknowledgement** checkpoint/envelope.
3. Write it to a temp save through the real save storage writer (`prepare_slot_write` -> `commit_prepared_slot_write`, or the equivalent existing production writer seam already used by this test module).
4. Acknowledge the live in-memory event through `GameEngine::acknowledge_acquisition_event` and assert:
   - pending event cleared;
   - record/story counts unchanged.
5. Read the file back through the real save reader.
6. Restore through `build_restore_candidate` using matching current definitions/resources.
7. Assert the restored engine has:
   - the record exactly once;
   - story output exactly once when included;
   - the pending acquisition event again.
8. Acknowledge the restored popup again and assert:
   - pending event clears;
   - record/story counts remain single.

This proves the intended contract precisely:

```text
durable acquisition
-> unsaved acknowledgement
-> process loss
-> real file restore
-> popup replay
-> no duplicate acquisition
```

It does **not** claim an acquisition that never reached disk survives a crash.

### Step 1: Run the required Rust integration proof

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  storage_integration --all-features
```

Also run the exact new test name once implemented.

### Required behavior B: packaged save-resume

Reuse the existing composite acquisition queue in `save-resume.e2e.ts`:

- capture expected acquired record IDs before acknowledgement;
- keep sequential first/second pending-event assertions;
- use `acknowledgeAcquisitionDomFirst` with no acknowledgement-phase polling;
- after queue drains, wait for ordinary autosave whose snapshot has no pending event;
- return to title and Continue/load that persisted state;
- assert `pendingAcquisition === null`;
- assert every expected record exists exactly once;
- assert gameplay remains resumable.

### Required behavior C: packaged exit after ordinary acknowledgement

Retarget the old exclusive race in `save-exit.e2e.ts` to:

```text
pending popup visible
-> acknowledgeAcquisitionDomFirst(current)
-> pending event gone in memory
-> requestApplicationQuit()
-> exit flush persists current revision
-> packaged process exits
-> restart + Continue
-> record exists exactly once
-> pending popup absent
```

Delete the old `requestApplicationQuitWhenAcknowledging()` flow.

### Step 2: Simplify packaged helpers

In `helpers.ts`:

- `requestApplicationQuit()` invokes `e2e_request_application_quit` with no acknowledgement-wait argument;
- delete `requestApplicationQuitWhenAcknowledging()` when unused;
- keep `startAcquisitionAcknowledgement`, `waitForAcquisitionDomSettlement`, and `acknowledgeAcquisitionDomFirst` if still useful;
- remove `forceCaptureUnavailable` from `dismissAllPendingAcquisitions`;
- remove the acknowledgement-only `jsClick(anchors.captureProof.forceUnavailable)` branch.

In `save-seed.e2e.ts`:

- replace `dismissAllPendingAcquisitions({ forceCaptureUnavailable: true })` with ordinary `dismissAllPendingAcquisitions()`;
- do not disturb the separate packaged thumbnail proof.

### Step 3: Correct historical supersession wording

Append to HPA-129 design:

```markdown
### HPA-549 active-development supersession

The original acknowledgement design required popup dismissal to be durably saved before the popup disappeared. HPA-549 removes that second durable transaction and uses ordinary autosave for acknowledgement.

HPA-549 does not strengthen ordinary acquisition durability: a crash may lose an acquisition that has not yet been autosaved, unchanged from current behavior. If a durable save already contains the acquired record and its pending popup, a later crash before acknowledgement autosave commits may replay that popup; acknowledging it again must never re-grant the record or story outputs.
```

If HPA-392 prominently describes the old exactly-once dismissal guarantee as current, add only a short supersession note. Do not rewrite historical plan narrative.

### Step 4: Run focused packaged save-core proof

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite save-core
```

### Step 5: Run final repository gates

From repo root:

```bash
bun run test
bun run check
bun run lint:all
```

Then run the persistence-focused packaged matrix:

```bash
bun run --cwd apps/game test:e2e:save
```

The matrix must include the retargeted ordinary exit path; no exclusive-ack wait may remain.

### Step 6: Final deletion/scope audit

```bash
rg -n \
  "AcquisitionAcknowledgementPhase|AcquisitionAcknowledgement|ExclusivePersistenceIntent|retryAcquisitionAcknowledgement|cancelAcquisitionFailure|confirmAcquisitionWithoutSaving|retry_acquisition_acknowledgement|cancel_acquisition_failure|confirm_acquisition_without_saving|requestApplicationQuitWhenAcknowledging|waitForActiveAcknowledgement|forceCaptureUnavailable|reserve_acknowledgement_writer" \
  apps/game/src-tauri/src apps/game/src/lib apps/game/e2e-tauri
```

Expected: no live acknowledgement-only protocol/exit-gate/capture-option/writer-priority references.

Also audit:

```bash
rg -n "acknowledge_acquisition_event" \
  apps/game/src-tauri/src apps/game/src/lib apps/game/e2e-tauri
rg -n "refreshGameState|readonly size: number|acquisitionController\.size" \
  apps/game/src/lib apps/game/src/routes
```

Expected:

- acknowledgement appears only on the ordinary engine/Tauri/HTTP/frontend path plus tests/helpers;
- dead refresh/size surface is absent.

Review:

```bash
git diff --stat main...HEAD
git diff --check main...HEAD
```

Confirm:

- net deletion in acknowledgement persistence/controller machinery;
- no save schema/version change;
- no new persistence/recovery abstraction;
- generic writer serialization/debounce coverage remains;
- no HPA-550/HPA-521/HPA-559/HPA-560/HPA-621 scope creep.

### Step 7: Commit

```bash
git add apps/game/src-tauri/src/game/save/coordinator/tests/storage_integration.rs \
  apps/game/e2e-tauri/save-resume.e2e.ts \
  apps/game/e2e-tauri/save-exit.e2e.ts \
  apps/game/e2e-tauri/save-seed.e2e.ts \
  apps/game/e2e-tauri/helpers.ts \
  docs/superpowers/specs/2026-07-25-hpa-129-save-load-autosave-continue-design.md \
  docs/superpowers/plans/2026-07-26-hpa-392-save-load-persistence-implementation-plan.md
git commit -m "test(save): prove ordinary acquisition acknowledgement replay"
```

Omit HPA-392 from `git add` if no note was required.

---

## Expected end state

```text
Acquire record command
  -> inventory/story/pending event/revision commit atomically in memory
  -> normal autosave

Dismiss popup command
  -> find canonical presented event by (command id, ordinal)
  -> exact presented ID: remove + revision
  -> stale/absent ID: no-op
  -> different still-pending ID: typed error
  -> normal autosave without thumbnail
```

There is no second acknowledgement persistence product.

Crash semantics remain ordinary:

- unsaved acquisition may be lost;
- if acquisition is already durable but acknowledgement is not, the popup may replay;
- replay never double-grants acquisition/story effects.

Normal exit after acknowledgement uses ordinary exit flush to persist the current revision.

## Stop conditions

Stop and re-review before broadening scope if implementation appears to require:

- save schema/version changes or migrations;
- acknowledged-event ledger;
- new persistence policy/writer queue/recovery token;
- retaining acknowledgement failure tokens solely for old UX behavior;
- manual-save thumbnail redesign;
- full SaveCoordinator refactor;
- Chapter 1 Analysis UX changes;
- new packaged E2E suite or process-kill fault framework;
- HTTP dev server/fallback removal.

Those belong to separate tickets.