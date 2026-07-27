# Task 12 implementation report

## Scope

Task 12 connects the Task 10 persistence transport to the frontend without
implementing the save browser or the packaged HTML-to-image capture proof. It
adds exact lower-camel TypeScript mirrors, one structured persistence error
boundary, raw thumbnail transport helpers, complete event-backed persistence
stores, gameplay-command wrapper handling, and a Rust-authoritative acquisition
acknowledgement controller.

The obsolete inventory-diff acquisition queue and its tests were deleted. The
popup now derives its identity and presentation from
`GameStateView.pendingAcquisition`, while local state is limited to the active
acknowledgement workflow phase and exact expected event ID.

## Files

Created:

- `apps/game/src/lib/persistence/types.ts`
- `apps/game/src/lib/persistence/types.test.ts`
- `apps/game/src/lib/persistence/commands.ts`
- `apps/game/src/lib/persistence/commands.test.ts`
- `apps/game/src/lib/persistence/persistence-store.svelte.ts`
- `apps/game/src/lib/persistence/persistence-store.test.ts`
- `apps/game/src/lib/persistence/thumbnail-capture.ts`
- `apps/game/src/lib/persistence/thumbnail-capture.test.ts`

Modified for Task 12 behavior:

- `apps/game/src/lib/state/types.ts`
- `apps/game/src/lib/state/game-client.svelte.ts`
- `apps/game/src/lib/state/game-client-source.test.ts`
- `apps/game/src/lib/state/acquisition-controller.svelte.ts`
- `apps/game/src/lib/state/acquisition-controller.test.ts`
- `apps/game/src/lib/components/AcquisitionPopup.svelte`
- `apps/game/src/lib/components/AcquisitionPopup.test.ts`
- `apps/game/src/routes/+page.svelte`
- `apps/game/src/routes/page.test.ts`

Deleted as obsolete:

- `apps/game/src/lib/state/acquisition-notifications.ts`
- `apps/game/src/lib/state/acquisition-notifications.test.ts`

Extra fixture-only migrations required by the new exact, required
`GameStateView.pendingAcquisition` field:

- `apps/game/src/lib/audio/sfx-events.test.ts`
- `apps/game/src/lib/components/GameShell.test.ts`
- `apps/game/src/lib/components/SceneNavigationPanel.test.ts`

The `+page.svelte` change is required integration wiring: it passes the
controller phase and Retry/Cancel/Continue Without Saving actions into the
existing popup boundary and removes the deleted frontend queue teardown. It
does not add Task 13 capture behavior or Task 14 save-browser UI.

## Wire contracts and structured errors

- `persistence/types.ts` mirrors the Rust save-slot reference, save type,
  summary, valid/invalid/empty slot, discovery, browser/open preflight,
  persistence health, thumbnail activity, exit status, thumbnail purpose and
  ticket, expectations, manual-save result, gameplay-command wrapper, and
  acquisition acknowledgement phase in lower-camel wire form.
- `PendingAcquisitionView` mirrors the Rust-provided presentation fields:
  `id`, `recordKind`, `recordId`, `title`, `description`, `details`,
  `imageAssetId`, `createdByCommandId`, and `ordinal`.
- There is one frontend `GameError` definition. `state/types.ts` re-exports it
  from `persistence/types.ts`; it preserves `code`, `message`, and the optional
  opaque `failureToken` without a generic data/context bag.
- `asGameError` is the single structural normalization boundary for
  persistence workflows. Local Retry/Cancel controllers retain the structured
  error and exact token. Ordinary gameplay still renders `.message` in the
  global banner without changing the owning structured diagnostic.
- Source-contract tests reject snake-case fields, filesystem/path construction,
  thumbnail object IDs, operation/generation/revision fields inside the opaque
  token, and boolean acknowledgement bypass arguments.

## Command wrappers and thumbnail transport

- Both state-mutating dispatch seams consume
  `GameplayCommandResultView`, commit only `.state`, and run existing SFX
  inference against `.state`.
- One `applyGameplayCommandResult` helper owns the wrapper boundary.
- A capture request is pinned at receipt, the new state is committed, Svelte
  `tick()` is awaited, and capture starts only if the committed state identity
  is still current.
- Capture results that return after the state identity changes are discarded.
- Capture exceptions are converted to
  `report_save_thumbnail_failure`; reporting/submission errors are logged and
  do not reject an already-committed gameplay command.
- Read-only commands remain bare. `list_scenes` and `get_state` are not wrapped.
- `commands.ts` is the only frontend module that knows raw thumbnail transport.
  Tauri submission sends the `Uint8Array` body with
  `x-lyra-thumbnail-ticket`; the development HTTP fallback has the same raw
  body/header shape. Thumbnail reads accept only slot reference plus observed
  save ID and validate `ArrayBuffer`/`Uint8Array` responses.

### Fixed deadline

`timeoutMs` is translated to an absolute `performance.now()` deadline once at
request receipt. A `WeakMap` carries that fixed deadline through later render,
font, image, and crossfade work without serializing a new wire field. The
deadline accessor also pins an unregistered request on first observation, so
even a future consumer cannot reset the timeout by reading it repeatedly.

Two dedicated tests prove explicit receipt pinning and first-observation
pinning without deadline reset.

## Event-backed persistence store

Startup performs the three getters in order:

1. `get_persistence_status`
2. `get_thumbnail_activity`
3. `get_exit_status`

It then subscribes to:

- `persistence-status-changed`
- `thumbnail-activity-changed`
- `exit-status-changed`

Each complete event payload replaces its store value wholesale. Teardown
attempts every unlisten handler even when one handler rejects, so no reducer
history or partial-event reconstruction is required.

## Rust-authoritative acquisition acknowledgement

- The controller's visible item is exactly
  `gameState.value?.pendingAcquisition`; there is no frontend queue or
  inventory-diff identity inference.
- The acknowledgement chain is:
  `prepare_save_thumbnail({ type: "acquisitionAcknowledgement", eventId })`,
  deadline pin, Svelte tick, capture submit or terminal failure report, then
  exactly one `acknowledge_acquisition_event(eventId, ticket)`.
- The popup remains visible and the gameplay root remains inert until the
  committed Rust state no longer contains the expected event.
- Dismissal is disabled during preparing, capturing, and saving. At exactly
  2,000 ms the controller publishes `{ type: "saving", slow: true }` and logs
  one local warning. A regression also proves that a timer which expires while
  prepare is pending remains slow through later capture/save phases.
- Retry starts a fresh prepare/capture/acknowledge attempt.
- Cancel returns to idle while retaining the same Rust event.
- Continue Without Saving requires two user actions and sends the exact opaque
  token to `confirm_acquisition_without_saving`. Its warning explains that the
  acknowledgement may reappear after restart.
- Stale event IDs and stale tokens do not issue persistence work.
- The retained popup suite still covers evidence/statement rendering,
  placeholder and image-error fallback, Tab trapping, pointer/Space/Escape
  behavior, backdrop behavior, all focus-restoration paths, reduced motion, and
  bounded overflow.

## Narrow `get_state` suppression

`refreshGameState` suppresses only
`persistenceOperationInProgress` while the local acquisition phase is exactly
`saving` or the exit status is exactly `saving`. That path retains the current
state and leaves any existing global banner untouched. It does not poll or
retry.

The same busy code outside those intervals, and every other error code inside
them, remains visible. A successful read accepts the bare `GameStateView`.

## TDD evidence

Contract and transport:

```text
types contract fixtures
  RED: persistence wire module/contracts absent
  GREEN: 3/3

commands transport
  RED: four raw/typed transport cases failed against not-implemented bodies
  GREEN: 6/6

persistence store
  RED: module absent, then 3/3 failed against not-implemented startup
  GREEN: 3/3
```

Gameplay and acquisition:

```text
gameplay command wrapper boundary
  RED: mutating dispatches treated the wrapper as GameStateView
  GREEN: 8/8 wrapper/capture/read-only/error cases

get_state exclusivity
  RED: 5/5 failed because refreshGameState did not exist
  GREEN: 5/5

acquisition controller
  RED: 8/8 failed against the queue-backed controller
  GREEN: 8/8

slow state across delayed prepare
  RED: expected { type: "saving", slow: true }, received slow: false
  GREEN: controller 9/9

acquisition popup
  RED: 8/8 new persistence-phase cases failed against the old notification API
  GREEN: merged retained/new suite 19/19

deadline first observation
  RED: second read returned 1724 instead of the fixed 825
  GREEN: 2/2
```

Obsolete inventory-diff acquisition cases were removed with their production
source and replaced by controller tests over the authoritative Rust pending
event. No test was left skipped.

## Source-contract and final gates

Source-contract results:

- lower-camel fixtures: pass
- valid/invalid/empty slot and global discovery-unavailable fixtures: pass
- complete health/activity/exit fixtures: pass
- opaque token and no generic data bag: pass
- wrapped mutating response and bare read-only response: pass
- pending evidence and statement presentation: pass
- no snake-case/path/object-ID/boolean-bypass surface: pass
- raw `Uint8Array` body and exact ticket header: pass
- binary read validation and typed malformed-response error: pass

Final verification:

```text
Focused Task 12 and page integration:
  8 files passed
  88 tests passed
  0 failed
  0 skipped

Full game Vitest:
  33 files passed
  498 tests passed
  0 failed
  0 skipped

rtk bun run check:
  svelte-check found 0 errors and 0 warnings

Scoped Prettier:
  All matched files use Prettier code style

Scoped ESLint:
  pass, no diagnostics

rtk git diff --cached --check:
  pass
```

The jsdom full-suite output still prints its existing non-failing
`HTMLCanvasElement.getContext` and `HTMLMediaElement` not-implemented notices.

## Documentation lookup fallback

The Context7 documentation lookup for the installed Tauri API could not
authenticate because the connector OAuth token had expired. Rather than rely
on memory, the implementation verified the exact installed declaration in
`node_modules/@tauri-apps/api/core.d.ts`: `invoke<T>` accepts a command, a
record or raw binary args including `Uint8Array`, and options with headers.
Transport tests pin the resulting raw-body/header call.

## Deferred risks and boundaries

- `gameplayThumbnailCapture` intentionally returns terminal unavailable until
  Task 13 proves `html-to-image` against the real packaged Tauri WebView,
  gameplay root, fonts, assets, and crossfades. No browser-only substitute was
  introduced.
- The mandatory packaged capture architecture gate and real Tauri smoke test
  remain Task 13 work.
- Save-browser, Continue, manual save/load/delete UI, exit overlay, and related
  focus/accessibility flows remain Tasks 14 and later.
- The complete persistence store is implemented and tested but is not mounted
  into future save-browser/exit UI before those consumers exist.
- Task 12 does not broaden retry behavior: capture terminal reporting is
  non-fatal to committed gameplay, while structured persistence failures stay
  with their owning controller.

## Commit

`f42ccfb feat: connect persistence client state` (amended to include this
report).
