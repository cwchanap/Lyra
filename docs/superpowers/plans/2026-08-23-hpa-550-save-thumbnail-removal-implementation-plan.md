# HPA-550 Save Thumbnail Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Lyra's dynamic save-thumbnail product and all capture-only frontend, Rust, IPC, storage-sidecar, and packaged-E2E machinery while preserving the existing text-rich Save / Load / Continue experience and all durable save semantics.

**Architecture:** Save slots remain strict JSON snapshots written through the existing serialized persistence path. Save cards identify slots using existing name / timestamp / chapter / scene / objective metadata. Gameplay commands return `GameStateView` directly because there is no post-commit capture ticket. This task deletes thumbnail branches in place and deliberately leaves the broader HPA-521 coordinator ownership refactor for its own ticket.

**Tech Stack:** Svelte 5, TypeScript, Tauri 2, Rust, Bun, Vitest, WebdriverIO packaged Tauri E2E.

**Spec:** `docs/superpowers/specs/2026-08-23-hpa-550-save-thumbnail-removal-design.md`

## Global Constraints

- One ticket, one PR: continue implementation on the same HPA-550 branch / draft PR that contains this plan.
- Do not merge the planning state and open a second implementation PR.
- Complete Task 0 before runtime changes. If the playtest shows material screenshot value, stop and revise the product decision instead of implementing Outcome A.
- Keep `SAVE_SCHEMA_VERSION = 2` and follow HPA-540's pre-release policy: no migration and no backward compatibility for unshipped local saves.
- Do not add a static-image registry, placeholder renderer, native screenshot provider, or capture abstraction.
- Do not implement HPA-521's coordinator ownership refactor or HPA-560's broader E2E simplification.
- Preserve atomic JSON writes, stale-write guards, session / durable-revision checks, autosave coalescing, overwrite expectations, corruption discovery, detached restore, exact recapture, flush / exit semantics, and delete ordering.
- Use TDD for behavior changes: make the narrowest affected test fail first, implement the deletion/simplification, then rerun the focused test before moving on.
- Historical docs may still describe thumbnails. Do not rewrite old accepted design/history documents; new HPA-550 docs supersede the live runtime contract.

---

## Task 0: Close the product-validation gate

**Files:**
- No runtime files.
- Record the result in the HPA-550 Linear thread and the existing draft PR description/comment.

- [ ] Build/run the current packaged Chapter 1 version before changing thumbnail behavior.
- [ ] Create at least three distinct saves across different scenes / primary objectives; give at least one manual save a meaningful display name.
- [ ] Return to title and use Continue once.
- [ ] Open Load and deliberately select a non-newest save using the current save-card information.
- [ ] Reopen the in-game Save / Load browser and verify whether name, timestamp, chapter, scene, recap, and active objective are enough to distinguish the saves.
- [ ] Record whether the screenshot materially changed save selection.
- [ ] If text metadata is sufficient, record `Outcome A confirmed: remove dynamic thumbnails` and continue.
- [ ] If screenshot content is materially required, stop this plan before Task 1. Update HPA-550 with the observed gap; do not implement a native-capture spike implicitly in this PR.

Expected gate result for this plan: Outcome A.

---

## Task 1: Make SaveCard text-only and remove thumbnail fields from frontend views

**Files:**
- Modify: `apps/game/src/lib/components/SaveCard.svelte`
- Modify: `apps/game/src/lib/components/SaveCard.test.ts`
- Modify: `apps/game/src/lib/persistence/types.ts`
- Modify: `apps/game/src/lib/persistence/types.test.ts`
- Check callers: `apps/game/src/lib/components/SaveBrowser.svelte`

### 1A. Write the text-only card contract first

- [ ] Update the valid-slot fixture in `SaveCard.test.ts` so metadata contains no `thumbnail` field.
- [ ] Add/adjust a test asserting a valid save renders:
  - display name;
  - saved time / recap details;
  - chapter title;
  - scene title;
  - active primary objective;
  - normal select/load/delete actions.
- [ ] Add/adjust the test to assert no `thumbnail-frame`, `<img>`, `無法顯示預覽`, or thumbnail reader behavior exists.
- [ ] Keep an empty-slot test proving `空白存檔` is still unambiguous.
- [ ] Keep an invalid-slot test proving readable safe metadata plus the diagnostic still renders without image state.
- [ ] Run the focused test and confirm it fails against the current image-based component:

```bash
bun run --cwd apps/game test -- src/lib/components/SaveCard.test.ts
```

### 1B. Remove the card image lifecycle

- [ ] Delete the `readSaveThumbnail` import and injectable `readThumbnail` prop.
- [ ] Delete `thumbnailUrl`, `thumbnailUnavailable`, object-URL ownership/revocation, the reactive thumbnail read, and decode-failure handling.
- [ ] Remove the thumbnail frame from the card template for valid, invalid, and empty slots.
- [ ] Keep the existing slot header, `SaveRecapDetails`, diagnostic, selection state, newest marker, and actions.
- [ ] Tighten only the spacing/min-height that becomes obviously redundant after removing the frame; do not redesign the save browser.

### 1C. Delete thumbnail view types

- [ ] Remove from `types.ts`:
  - `ThumbnailUnavailableReason`;
  - `ThumbnailAvailabilityView`;
  - `ThumbnailDiagnosticView`;
  - `ThumbnailActivityView`;
  - `ThumbnailCaptureRequestView`;
  - `GameplayThumbnailCaptureResult`;
  - `GameplayThumbnailCapture`.
- [ ] Remove `thumbnail` from `SaveMetadataView` and `ReadableSaveMetadataView`.
- [ ] Remove `thumbnailActivity` from `ManualSaveResultView`.
- [ ] Leave `SaveSummaryView`, slot references/statuses, persistence health, exit status, and overwrite expectation types unchanged.
- [ ] Update `types.test.ts` fixtures to the no-thumbnail metadata shape.

### 1D. Verify Task 1

- [ ] Run:

```bash
bun run --cwd apps/game test -- \
  src/lib/components/SaveCard.test.ts \
  src/lib/persistence/types.test.ts
bun run --cwd apps/game check
```

- [ ] Confirm `SaveBrowser.svelte` still compiles without new image props or replacement imagery.
- [ ] Commit the focused frontend-card change.

---

## Task 2: Remove the frontend capture protocol and thumbnail activity channel

**Files:**
- Delete: `apps/game/src/lib/persistence/thumbnail-capture.ts`
- Delete: `apps/game/src/lib/persistence/thumbnail-capture.test.ts`
- Delete: `apps/game/src/lib/test-harnesses/PackagedCaptureProofProbe.svelte`
- Delete: `apps/game/src/lib/test-harnesses/PackagedCaptureProofProbe.test.ts`
- Modify: `apps/game/src/lib/persistence/commands.ts`
- Modify: `apps/game/src/lib/persistence/commands.test.ts`
- Modify: `apps/game/src/lib/persistence/persistence-store.svelte.ts`
- Modify: `apps/game/src/lib/persistence/persistence-store.test.ts`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/routes/page.test.ts`
- Modify: `apps/game/src/routes/page-source.test.ts`
- Modify capture-only markup/comments in:
  - `apps/game/src/lib/components/GameAtmosphere.svelte`
  - `apps/game/src/lib/components/SceneBackdrop.svelte`
  - `apps/game/src/lib/components/GameShell.svelte`
  - `apps/game/src/lib/components/DialogueBox.svelte`
  - `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`

### 2A. Lock direct gameplay-command responses

- [ ] Update `game-client-source.test.ts` / route tests so mocked mutating gameplay commands return `GameStateView` directly, not `{ state, thumbnailCapture }`.
- [ ] Add/adjust a test proving a successful mutating command commits the returned state without invoking any secondary capture command.
- [ ] Update the manual-save route test so the expected call sequence contains `save_manual` directly and does **not** contain `prepare_save_thumbnail`, thumbnail submit, or thumbnail failure reporting.
- [ ] Run the focused tests and confirm they fail against the current wrapper/handshake.

### 2B. Simplify command helpers and state application

- [ ] Remove from `commands.ts`:
  - `thumbnailTicketHeader`;
  - `getThumbnailActivity`;
  - `reportSaveThumbnailFailure`;
  - `submitSaveThumbnail`;
  - `readSaveThumbnail`.
- [ ] In `game-client.svelte.ts`, delete:
  - thumbnail capture imports;
  - `finishThumbnailCapture`;
  - `applyGameplayCommandResult`;
  - capture deadline pinning;
  - detached capture submission;
  - `settlePreparedThumbnailCapture`.
- [ ] Change gameplay command dispatch and persistence transitions to consume `GameStateView` directly.
- [ ] Remove `GameplayCommandResultView` once the Rust/TS call sites no longer need it.
- [ ] Remove `MUTATING_GAMEPLAY_COMMANDS` if its only remaining consumer was the test harness's capture-wrapper simulation.
- [ ] Preserve audio event inference after the state is committed; do not change the SFX error-isolation contract.

### 2C. Simplify manual save

- [ ] In `+page.svelte`, replace the prepare → settle → save sequence with one `save_manual` call using only:
  - `reference`;
  - `displayName`;
  - `expectation`.
- [ ] Stop passing `preparedThumbnailTicket`.
- [ ] Stop applying `result.thumbnailActivity`.
- [ ] Preserve the existing in-flight guard, error dialog behavior, browser close, game-menu close, and post-save focus restoration.

### 2D. Remove thumbnail activity from the persistence store

- [ ] Delete thumbnail state/getter/replacement from `PersistenceStore`.
- [ ] Delete initial `getThumbnailActivity()` reads.
- [ ] Delete the `thumbnail-activity-changed` listener and its version counter.
- [ ] Keep the subscribe-before-reread race protection for persistence and exit status.
- [ ] Update the store tests to expect only persistence + exit channels.

### 2E. Delete capture-only UI hooks

- [ ] Remove `PackagedCaptureProofProbe` imports/rendering and capture-proof status/functions from `+page.svelte`.
- [ ] Remove `data-save-thumbnail-*` attributes and comments whose only purpose is DOM capture filtering/layout from the listed components.
- [ ] Do not change the actual gameplay presentation, rain animation, dialogue content, evidence tray behavior, or component ownership.

### 2F. Verify Task 2

- [ ] Run:

```bash
bun run --cwd apps/game test -- \
  src/lib/persistence/commands.test.ts \
  src/lib/persistence/persistence-store.test.ts \
  src/lib/state/game-client-source.test.ts \
  src/routes/page.test.ts \
  src/routes/page-source.test.ts
bun run --cwd apps/game check
```

- [ ] Run a production-surface grep; current runtime code should no longer own capture terms:

```bash
rg 'thumbnailCapture|prepare_save_thumbnail|submit_save_thumbnail|report_save_thumbnail_failure|read_save_thumbnail|thumbnail-activity-changed|data-save-thumbnail' \
  apps/game/src apps/game/src-tauri/src
```

Historical docs are not part of this zero-match requirement.

---

## Task 3: Remove thumbnail data from the Rust save schema and storage transaction

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Delete: `apps/game/src-tauri/src/game/save/thumbnail.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify as required by compile errors: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify thumbnail-owned tests/fixtures under `apps/game/src-tauri/src/game/save/`
- Check/remove thumbnail-only test helpers in `apps/game/src-tauri/src/game/test_support.rs` or the actual current helper module if `png_fixture` is still present.

### 3A. Write the no-thumbnail schema/storage tests first

- [ ] Update the representative current envelope fixture to omit `thumbnail` while keeping `schemaVersion: 2`.
- [ ] Add/adjust a round-trip test proving the current envelope has no thumbnail field.
- [ ] Add a strict-parser test proving a pre-HPA-550 envelope containing the old top-level `thumbnail` field is rejected as an unsupported current shape. This documents the intentional pre-release break rather than adding a migration.
- [ ] Add/adjust storage tests proving `ensure_save_layout` requires only the save root and does not create `saves/thumbnails/`.
- [ ] Add/adjust a staged-write test proving one envelope JSON is staged/installed for a save with no PNG sidecar branch.
- [ ] Preserve tests for overwrite expectation, atomic replacement, directory sync, stale saves, corruption, delete, and orphan JSON temporaries.
- [ ] Run the focused Rust tests and confirm the old schema/storage implementation fails them.

### 3B. Delete thumbnail schema types

- [ ] In `schema.rs`, remove:
  - thumbnail byte/dimension constants;
  - `ThumbnailFormat`;
  - `ThumbnailDescriptorV1`;
  - `ThumbnailAvailabilityView`;
  - `ThumbnailUnavailableReason`;
  - `ThumbnailDiagnosticView`;
  - `thumbnail` from `SaveMetadataView`;
  - `thumbnail` from `ReadableSaveMetadataView`;
  - `thumbnail` from `SaveEnvelope`.
- [ ] Keep `SAVE_SCHEMA_VERSION: u32 = 2` unchanged.
- [ ] Keep strict parsing / `deny_unknown_fields`, content revision, summary validation, and snapshot validation unchanged.

### 3C. Collapse storage to one staged envelope

- [ ] Remove `ThumbnailWrite` from `SlotWriteRequest`.
- [ ] Simplify `PreparedSlotWrite` to the one current envelope plus one staged JSON write and the existing manual overwrite expectation.
- [ ] Remove available-vs-unavailable envelope construction.
- [ ] Remove sidecar staging / install / discard branches.
- [ ] Stop creating the `thumbnails` directory in `ensure_save_layout`.
- [ ] Remove `thumbnail_availability`, descriptor probing, PNG header reads, and thumbnail fields from readable invalid metadata.
- [ ] Remove canonical thumbnail path / temporary-file / referenced-sidecar cleanup helpers.
- [ ] Keep save-slot JSON temporary cleanup and directory sync behavior.
- [ ] When overwriting/deleting, remove only save-owned JSON artifacts; there is no sidecar ownership to maintain.

### 3D. Delete PNG validation and thumbnail errors

- [ ] Delete `save/thumbnail.rs` and remove `pub(crate) mod thumbnail` from `save/mod.rs`.
- [ ] Remove `GameError` constructors/codes used only by thumbnail PNG/ticket handling after Task 4 proves no remaining call site.
- [ ] Remove `png_fixture` and other thumbnail-only test helpers if `rg` shows no non-thumbnail consumer.
- [ ] Do **not** remove `sha2` from Rust dependencies; it is used by non-thumbnail content hashing.

### 3E. Verify Task 3

- [ ] Run focused save tests, then the Rust suite:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features game::save
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

---

## Task 4: Delete capture tickets from SaveCoordinator and the Tauri IPC boundary

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- Delete: `apps/game/src-tauri/src/game/save/coordinator/tests/ticket.rs`
- Modify affected coordinator tests, especially:
  - `apps/game/src-tauri/src/game/save/coordinator/tests/unit.rs`
  - `apps/game/src-tauri/src/game/save/coordinator/tests/storage_integration.rs`
  - `apps/game/src-tauri/src/game/save/coordinator/tests/e2e_replacement.rs`
  - other current coordinator test modules found by `rg 'thumbnail|capture' apps/game/src-tauri/src/game/save/coordinator`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/src/game/save/e2e_faults.rs`

### 4A. Lock autosave/manual-save behavior without capture

- [ ] Rewrite the coordinator tests so a committed durable mutation schedules the normal debounced autosave without issuing a capture ticket.
- [ ] Preserve a test that a newer durable revision supersedes/coalesces an older pending debounced autosave by revision/session identity, not by screenshot ticket.
- [ ] Preserve blocking-flush tests proving exit/load/title transitions wait for the required durable write.
- [ ] Preserve manual-save tests for overwrite expectation and serialized writer ordering with no prepared thumbnail ticket.
- [ ] Preserve retry/failure-challenge tests for save writes; delete assertions whose only state is `thumbnail_capture_required` or thumbnail activity.
- [ ] Run focused coordinator tests and observe failures against the current capture-aware state machine.

### 4B. Remove capture-only coordinator state

- [ ] Delete:
  - `THUMBNAIL_CAPTURE_TIMEOUT`;
  - `ThumbnailCapturePurpose`;
  - `PreparedThumbnailPurpose`;
  - `ThumbnailCaptureRequestView`;
  - `ThumbnailActivityView`;
  - `CaptureTerminalResult`;
  - `CaptureIntent`;
  - ticket records / maps / deadline state;
  - capture-required flags;
  - thumbnail activity subscribers;
  - prepare / submit / failure / claim / expiration code.
- [ ] Delete `coordinator/tests/ticket.rs` and its module declaration.
- [ ] Simplify autosave job/capture/register/write structs so they carry only durable checkpoint/write identity required by persistence.
- [ ] Keep the writer queue and task scheduler when still required for serialized save/delete/cleanup work; do not refactor ownership beyond removing thumbnail fields.

### 4C. Collapse persistence policy variants

- [ ] In `src-tauri/src/lib.rs`, remove `AutosaveIfAdvancedWithoutThumbnail`.
- [ ] Keep one `AutosaveIfAdvanced` path plus `CoordinatorManaged` where coordinator-owned transitions already require it.
- [ ] Remove `run_gameplay_mutation_selecting_policy` if it becomes unnecessary after the two autosave variants collapse; use the simplest existing helper shape.
- [ ] Ensure interrogation actions now use the ordinary autosave path. The PR #66 no-thumbnail special case disappears because **all** saves are no-thumbnail.

### 4D. Return `GameStateView` directly

- [ ] Delete the Rust gameplay response wrapper containing `thumbnail_capture`.
- [ ] Change mutating gameplay commands and persistence transitions to return `GameStateView` directly.
- [ ] Change install/start/load helpers to return direct state.
- [ ] Update command tests / serialization expectations accordingly.

### 4E. Remove thumbnail IPC and event plumbing

- [ ] Delete Tauri commands:
  - `prepare_save_thumbnail`;
  - `submit_save_thumbnail`;
  - `report_save_thumbnail_failure`;
  - `read_save_thumbnail`;
  - `get_thumbnail_activity`.
- [ ] Remove the thumbnail ticket request header.
- [ ] Remove `thumbnail-activity-changed` emitter/subscriber plumbing.
- [ ] Remove `ThumbnailInstall` / `thumbnailInstall` from E2E persistence fault boundaries; keep envelope replacement, saves-directory sync, exit flush, and other non-thumbnail faults.

### 4F. Verify Task 4

- [ ] Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run --cwd apps/game check
```

- [ ] Confirm no Rust production code matches:

```bash
rg 'Thumbnail|thumbnail_capture|thumbnailCapture|prepare_save_thumbnail|submit_save_thumbnail|report_save_thumbnail_failure|read_save_thumbnail|get_thumbnail_activity' \
  apps/game/src-tauri/src
```

Allow only historical docs outside `src`.

---

## Task 5: Remove capture-owned packaged E2E surface and sidecar fixtures

**Files:**
- Delete: `apps/game/e2e-tauri/capture-proof.e2e.ts`
- Modify: `apps/game/e2e-tauri/save-fixtures.ts`
- Modify: `apps/game/e2e-tauri/save-management.e2e.ts`
- Modify as capture-only references require:
  - `apps/game/e2e-tauri/helpers.ts`
  - `apps/game/e2e-tauri/production-anchors.ts`
  - `apps/game/e2e-tauri/save-seed.e2e.ts`
  - `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- Modify: `apps/game/scripts/e2e-suite-registry.mjs`
- Modify: `apps/game/scripts/save-e2e-paths.mjs`
- Modify affected script contract tests:
  - `apps/game/scripts/e2e-suite-registry.test.mjs`
  - `apps/game/scripts/save-e2e-paths.test.mjs`
  - `apps/game/scripts/select-e2e-suites.test.mjs`
  - `apps/game/scripts/plan-e2e-ci.test.mjs`
  - other current CI-contract tests whose expected suite/phase counts include capture proof.

### 5A. Change E2E contracts first

- [ ] Update suite-registry tests so `capture-proof` is no longer a suite ID or persistence-chain member.
- [ ] Update save-management phase tests so missing/corrupt-thumbnail phases no longer exist.
- [ ] Update save-path tests so sidecar resolution/removal/corruption/ownership APIs no longer exist.
- [ ] Update fixture type tests so `SaveE2eSaveEnvelope` has no thumbnail descriptor.
- [ ] Run `test:e2e:ci-contracts` and confirm current code fails the new expectations.

### 5B. Delete capture-proof and sidecar ownership

- [ ] Delete `capture-proof.e2e.ts`.
- [ ] Remove `capture-proof` suite/phase/root selection and capture-only environment from the registry/runner.
- [ ] Remove `management-missing-thumbnail` and `management-corrupt-thumbnail` phases and their before-actions.
- [ ] Remove sidecar path/hash from ownership snapshots.
- [ ] Remove sidecar helper exports/imports from `save-fixtures.ts` and `save-e2e-paths.mjs`.
- [ ] Remove capture-proof helpers/anchors/probe checks from gameplay E2E files.
- [ ] Keep save-core seed/resume, corrupt-slot management, ordinary overwrite/delete, and exit-lifecycle phases.

### 5C. Preserve useful user behavior assertions

- [ ] In `save-management.e2e.ts`, keep/strengthen assertions that save slots are distinguishable by visible text (display name / chapter / scene / timestamp or objective as appropriate) rather than replacing removed image assertions with another technical hook.
- [ ] Keep corruption handling scoped to JSON save corruption.
- [ ] Keep manual save, load, delete, continue-candidate, and overwrite coverage.

### 5D. Verify Task 5

- [ ] Run:

```bash
bun run --cwd apps/game test:e2e:ci-contracts
bun run --cwd apps/game check:e2e
```

- [ ] Do not perform HPA-560's broader suite/runner redesign; this task only deletes thumbnail-owned E2E surface.

---

## Task 6: Remove capture-only dependencies/scripts and finish the single PR

**Files:**
- Modify: `apps/game/package.json`
- Modify mechanically: `bun.lock`
- Modify any CI/config file only when an existing capture-proof suite name is now dangling.
- Keep HPA-550 design/plan docs in this PR.

### 6A. Remove frontend capture dependencies

- [ ] Remove from `apps/game/package.json`:
  - `html-to-image`;
  - `@fontsource-variable/noto-serif-tc`.
- [ ] Remove `test:e2e:capture-proof` and `test:e2e:capture-proof:run` scripts.
- [ ] Remove `--suite capture-proof` from the save-chain script; keep the remaining persistence suites.
- [ ] Regenerate the lockfile with Bun from the repository root using the project's normal install workflow; do not hand-edit `bun.lock`.
- [ ] Verify Fontsource/html-to-image are gone from the live dependency graph.

### 6B. Run focused zero-match checks

- [ ] Run:

```bash
rg 'html-to-image|@fontsource-variable/noto-serif-tc|data-save-thumbnail|thumbnail-activity-changed|prepare_save_thumbnail|submit_save_thumbnail|report_save_thumbnail_failure|read_save_thumbnail|get_thumbnail_activity' \
  apps/game --glob '!docs/**'
```

Expected: no live runtime/test-harness dependency on the deleted capture protocol. If old prose fixtures intentionally contain a string, inspect it rather than introducing a compatibility shim.

- [ ] Inspect remaining `thumbnail` matches:

```bash
rg -n 'thumbnail|Thumbnail' apps/game --glob '!docs/**'
```

Classify every remaining hit. The desired end state is no product/runtime thumbnail concept; historical screenshots or unrelated generic UI uses must be justified individually.

### 6C. Full validation

- [ ] Run frontend/unit/type/lint validation:

```bash
bun run test
bun run check
bun run lint:all
```

- [ ] Run Rust validation:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run --cwd apps/game rust:fmt
bun run --cwd apps/game rust:lint
```

- [ ] Run E2E type/contracts:

```bash
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:ci-contracts
```

- [ ] Because the gameplay command wire shape changes, run the packaged gameplay chain:

```bash
bun run --cwd apps/game test:e2e:gameplay
```

- [ ] Run the remaining packaged persistence chain:

```bash
bun run --cwd apps/game test:e2e:save
```

The exact phase count will be lower because capture-proof and two thumbnail-corruption management phases are deliberately deleted; update only contractual expected counts that correspond to those deleted phases.

### 6D. Self-review for scope and deletion value

- [ ] Review `git diff --stat main...HEAD`. HPA-550 should show material net line deletion after tests are rewritten; if the change grows substantially, look for a retained/reinvented capture abstraction.
- [ ] Confirm no authored-image/static-placeholder/native-capture replacement was added.
- [ ] Confirm `SAVE_SCHEMA_VERSION` is still `2` and no migration decoder was added.
- [ ] Confirm HPA-521-owned writer/coordinator restructuring was not pulled into this ticket.
- [ ] Confirm HPA-560-owned generic E2E runner simplification was not pulled into this ticket.
- [ ] Confirm Save / Load / Continue still expose enough text context to select the intended save.

### 6E. Update tracking on the same PR

- [ ] Update HPA-550 with the confirmed product outcome and validation evidence.
- [ ] Update HPA-521's tracking text/comment so it no longer treats capture tickets, thumbnail activity, or PNG sidecars as invariants to preserve.
- [ ] Keep the existing HPA-550 draft PR; add the implementation commits to it rather than opening another PR.
- [ ] Mark the PR ready only after the validation gate, implementation, and full verification above are complete.

---

## Expected end-state deletion map

The implementation is complete when the live architecture can be described without a thumbnail concept:

```text
Gameplay mutation
  → GameStateView
  → durable revision advanced?
      → debounced autosave through existing serialized writer

Manual Save
  → save_manual(reference, displayName, expectation)
  → staged JSON envelope
  → refreshed save browser

Save Browser
  → strict slot metadata + recap text
  → select / load / delete
```

There should be no screenshot ticket, no DOM rasterization, no font embedding for screenshots, no PNG descriptor/sidecar, no thumbnail activity state, no thumbnail IPC, and no packaged capture-proof suite.
