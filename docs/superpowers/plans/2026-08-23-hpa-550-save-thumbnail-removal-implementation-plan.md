# HPA-550 Save Thumbnail Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Lyra's dynamic save-thumbnail product and all capture-only frontend, Rust, IPC, storage-sidecar, and packaged-E2E machinery while preserving the existing text-rich Save / Load / Continue experience and all durable save semantics.

**Architecture:** Save slots remain strict JSON snapshots written through the existing serialized persistence path. Save cards identify slots using existing name / timestamp / chapter / scene / objective metadata. The gameplay-command wire changes from `{ state, thumbnailCapture }` to bare `GameStateView` as one Rust+TypeScript contract change, never as two separately runnable commits. Thumbnail deletion stays local and deliberately leaves the broader HPA-521 coordinator ownership refactor for its own ticket.

**Tech Stack:** Svelte 5, TypeScript, Tauri 2, Rust, Bun, Vitest, WebdriverIO packaged Tauri E2E.

**Spec:** `docs/superpowers/specs/2026-08-23-hpa-550-save-thumbnail-removal-design.md`

## Global Constraints

- One ticket, one PR: continue implementation on the same HPA-550 branch / draft PR that contains this plan.
- Do not merge the planning state and open a second implementation PR.
- Complete Task 0 before runtime changes. If the playtest shows material screenshot value, stop and revise the product decision instead of implementing Outcome A.
- Do not pre-record or assume the Task 0 outcome.
- Keep `SAVE_SCHEMA_VERSION = 2` and follow HPA-540's pre-release policy: no migration and no backward compatibility for unshipped local saves.
- Do not add a static-image registry, placeholder renderer, native screenshot provider, or capture abstraction.
- Do not implement HPA-521's coordinator ownership refactor or HPA-560's broader E2E simplification.
- Preserve atomic JSON writes, stale-write guards, session / durable-revision checks, autosave coalescing, overwrite expectations, corruption discovery, detached restore, exact recapture, flush / exit semantics, and delete ordering.
- Keep every implementation task compileable/runnable at its stated verification boundary. In particular, never teach the frontend to expect a bare `GameStateView` before Rust returns one.
- Use TDD for behavior changes: make the narrowest affected test fail first, implement the deletion/simplification, then rerun the focused test before moving on.
- Historical docs may still describe thumbnails. Do not rewrite old accepted design/history documents; new HPA-550 docs supersede the live runtime contract.

---

## Task 0: Close the product-validation gate

**Files:**
- No runtime files.
- Record the result in the HPA-550 Linear thread and the existing draft PR description/comment.

**Produces:** An explicit human product decision: either `Outcome A confirmed: remove dynamic thumbnails` or a stop decision with the observed save-identification gap.

- [ ] **Step 1: Run the current packaged build before changing thumbnail behavior**

Use the current `main`/planning branch runtime, not a hypothetical text-only mock.

- [ ] **Step 2: Create representative saves**

Create at least three distinct saves across different scenes / primary objectives and give at least one manual save a meaningful display name.

- [ ] **Step 3: Exercise Continue**

Return to title and use Continue once so the test includes the primary resume path.

- [ ] **Step 4: Exercise deliberate Load selection**

Open Load and deliberately choose a non-newest save. Use the actual card information rather than memorizing slot number alone.

- [ ] **Step 5: Reopen the in-game Save / Load browser**

Judge whether display name, timestamp, chapter, scene, recap, and active objective are sufficient to distinguish the intended save.

- [ ] **Step 6: Record the thumbnail's actual product value**

Record whether screenshot content materially changed which save was chosen.

- [ ] **Step 7: Branch on the evidence**

If text metadata is sufficient, record exactly:

```text
Outcome A confirmed: remove dynamic thumbnails.
```

Then continue to Task 1.

If screenshot content is materially required, stop before Task 1 and record the concrete ambiguity (for example, which two saves could not be distinguished). Do not start native capture or another image system implicitly.

---

## Task 1: Make every SaveCard consumer text-only

**Files:**
- Modify: `apps/game/src/lib/components/SaveCard.svelte`
- Modify: `apps/game/src/lib/components/SaveCard.test.ts`
- Check: `apps/game/src/lib/components/SaveBrowser.svelte`
- Check: `apps/game/src/lib/components/SaveConfirmationDialog.svelte`
- Modify: `apps/game/src/lib/components/SaveConfirmationDialog.test.ts`
- Modify: `apps/game/src/lib/persistence/types.ts`
- Modify: `apps/game/src/lib/persistence/types.test.ts`

**Interfaces:**
- Consumes: current Rust save-browser JSON; it may still contain an extra `thumbnail` field during this task.
- Produces: TypeScript save metadata and all mounted SaveCard surfaces that require no thumbnail field or image read to identify a save.
- Temporary boundary: capture ticket/activity types remain until Task 2 because `persistence-store` and gameplay capture still compile against them.

### 1A. Write the text-only card tests first

- [ ] **Step 1: Remove thumbnail metadata from the SaveCard fixtures**

Update valid and readable-invalid fixtures in `SaveCard.test.ts` so `metadata` contains no `thumbnail` field.

- [ ] **Step 2: Lock valid save identity**

Assert the valid card renders:

- display name;
- saved timestamp through `SaveRecapDetails`;
- chapter title;
- scene title;
- active primary objective;
- select/load/delete actions.

Also assert the card has no `thumbnail-frame`, preview `<img>`, or `無法顯示預覽` copy.

- [ ] **Step 3: Keep empty/invalid identity tests**

Keep an empty-slot assertion for `空白存檔`. Keep an invalid-slot assertion that safe readable metadata plus the diagnostic renders without image state.

- [ ] **Step 4: Lock the second SaveCard mount**

Update `SaveConfirmationDialog.test.ts` fixtures to omit thumbnail metadata. In the overwrite test, assert the embedded existing-save card still exposes at least:

```text
舊的雨夜
第一章
律師事務所
```

and that the current-game comparison still exposes:

```text
第二章
證物保管室
比對證物
```

This proves the confirmation flow remains understandable after the image frame disappears.

- [ ] **Step 5: Run the focused tests and verify RED**

```bash
bun run --cwd apps/game test -- \
  src/lib/components/SaveCard.test.ts \
  src/lib/components/SaveConfirmationDialog.test.ts
```

Expected: current thumbnail-bearing component/fixtures fail the new text-only contract.

### 1B. Remove the SaveCard image lifecycle

- [ ] **Step 6: Delete image loading from SaveCard**

Remove:

- `readSaveThumbnail` import;
- injectable `readThumbnail` prop;
- `thumbnailUrl` / `thumbnailUnavailable` state;
- object URL ownership/revocation;
- reactive thumbnail reads;
- decode-failure handling;
- thumbnail frame / `<img>` / preview placeholders.

Keep the existing header, `SaveRecapDetails`, diagnostic, selected/newest state, and action buttons.

- [ ] **Step 7: Tighten only obvious dead spacing**

Remove spacing/min-height that existed solely for the preview frame. Do not redesign `SaveBrowser` grids unless Task 0 showed a concrete layout problem.

### 1C. Narrow the frontend save metadata contract

- [ ] **Step 8: Remove metadata fields only**

From `SaveMetadataView` and `ReadableSaveMetadataView`, remove the `thumbnail` property.

Do **not** yet delete `ThumbnailActivityView`, `ThumbnailCaptureRequestView`, or other capture-wire types used by the still-live Task 2 surfaces. Rust may still serialize an extra thumbnail field in save metadata; TypeScript ignores it because there is no runtime exact-object validator on this view.

- [ ] **Step 9: Update type fixtures**

Update `types.test.ts` representative save metadata to the no-thumbnail frontend view.

- [ ] **Step 10: Verify Task 1 GREEN**

```bash
bun run --cwd apps/game test -- \
  src/lib/components/SaveCard.test.ts \
  src/lib/components/SaveConfirmationDialog.test.ts \
  src/lib/persistence/types.test.ts
bun run --cwd apps/game check
```

Expected: PASS, with `SaveBrowser.svelte` and `SaveConfirmationDialog.svelte` compiling without replacement image props.

- [ ] **Step 11: Commit**

```bash
git add apps/game/src/lib/components/SaveCard.svelte \
  apps/game/src/lib/components/SaveCard.test.ts \
  apps/game/src/lib/components/SaveConfirmationDialog.test.ts \
  apps/game/src/lib/persistence/types.ts \
  apps/game/src/lib/persistence/types.test.ts
git commit -m "refactor(save): make save identity text-only"
```

---

## Task 2: Change the capture wire atomically across Rust and TypeScript

**Files:**
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- Modify affected coordinator tests under `apps/game/src-tauri/src/game/save/coordinator/tests/`
- Modify: `apps/game/src/lib/persistence/commands.ts`
- Modify: `apps/game/src/lib/persistence/commands.test.ts`
- Modify: `apps/game/src/lib/persistence/persistence-store.svelte.ts`
- Modify: `apps/game/src/lib/persistence/persistence-store.test.ts`
- Modify: `apps/game/src/lib/persistence/types.ts`
- Modify: `apps/game/src/lib/persistence/types.test.ts`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/routes/page.test.ts`
- Modify: `apps/game/src/routes/page-source.test.ts`

**Interfaces:**
- Consumes: Task 1 text-only save UI; current save schema/storage still accepts `ThumbnailDescriptorV1::Unavailable` / `ThumbnailWrite::Unavailable`.
- Produces: bare `GameStateView` gameplay/persistence command responses, one-call manual save, no capture tickets/commands/activity channel, and one ordinary autosave policy.
- Temporary boundary: save envelopes may still contain `thumbnail: { type: "unavailable" }` until Task 3. No PNG capture or ticket exists after this task.

### 2A. Write one cross-language wire contract before implementation

- [ ] **Step 1: Add a Rust serialization regression test**

In `src-tauri/src/lib.rs` tests, exercise a representative successful mutating gameplay command/helper and serialize its returned value with `serde_json::to_value`.

Assert the serialized JSON is the `GameStateView` object itself:

```rust
let value = serde_json::to_value(result).unwrap();
assert!(value.get("chapter").is_some());
assert!(value.get("scene").is_some());
assert!(value.get("state").is_none());
assert!(value.get("thumbnailCapture").is_none());
```

Name the test around the contract, e.g. `mutating_gameplay_command_serializes_bare_game_state`.

- [ ] **Step 2: Change frontend mocks to the same shape**

Update focused `game-client-source.test.ts` / `page.test.ts` fixtures so mutating commands return `GameStateView`, not `{ state, thumbnailCapture }`.

Add a game-client assertion that the returned state becomes `gameState.value` without a secondary thumbnail submit/failure command.

- [ ] **Step 3: Lock one-call manual save**

Update the route test so a successful manual save invokes only:

```text
save_manual(reference, displayName, expectation)
```

for the save operation. Assert there is no `prepare_save_thumbnail`, `submit_save_thumbnail`, or `report_save_thumbnail_failure` call.

- [ ] **Step 4: Run the contract tests and verify RED**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features mutating_gameplay_command_serializes_bare_game_state
bun run --cwd apps/game test -- \
  src/lib/persistence/commands.test.ts \
  src/lib/state/game-client-source.test.ts \
  src/routes/page.test.ts \
  src/routes/page-source.test.ts
```

Expected: current Rust wrapper and frontend handshake fail the new contract.

### 2B. Remove capture tickets while keeping the old envelope temporarily writable

- [ ] **Step 5: Collapse autosave policy semantics**

In `src-tauri/src/lib.rs` remove `AutosaveIfAdvancedWithoutThumbnail`. Keep `AutosaveIfAdvanced` and `CoordinatorManaged` only.

Interrogation actions that PR #66 routed through the no-thumbnail variant now use ordinary autosave; the semantic distinction no longer exists.

Remove `run_gameplay_mutation_selecting_policy` if it has no remaining reason to exist after policy collapse.

- [ ] **Step 6: Remove coordinator capture-ticket state**

Delete capture-ticket concepts required only to wait for screenshots:

- `THUMBNAIL_CAPTURE_TIMEOUT`;
- `ThumbnailCapturePurpose` / `PreparedThumbnailPurpose`;
- `ThumbnailCaptureRequestView`;
- ticket records/maps/supersession/deadlines;
- capture result claiming/submission/failure/expiry;
- capture-required flags;
- thumbnail activity subscribers/state.

Keep the writer queue, task scheduler, session/durable revision guards, autosave debounce, failure challenges, flush semantics, delete ordering, and exit handling.

Until Task 3 removes the schema field, make autosave/manual save construct the existing storage request with `ThumbnailWrite::Unavailable`; do not create a new abstraction for this temporary value.

- [ ] **Step 7: Make gameplay commands return `GameStateView` directly**

Delete the Rust `GameplayCommandResultView` wrapper and change mutating gameplay commands, install/start/load helpers, and persistence transitions to return the committed `GameStateView` directly.

Do this in the same commit as the frontend consumer change below.

- [ ] **Step 8: Make manual save one command**

Delete the prepared-thumbnail argument from `save_manual`. It captures the checkpoint and writes through the existing serialized save path with the temporary unavailable descriptor.

Delete Tauri capture commands and wire owned solely by the ticket protocol:

- `prepare_save_thumbnail`;
- `submit_save_thumbnail`;
- `report_save_thumbnail_failure`;
- `read_save_thumbnail`;
- `get_thumbnail_activity`;
- thumbnail ticket request header;
- `thumbnail-activity-changed` event plumbing.

### 2C. Change the TypeScript side in the same task

- [ ] **Step 9: Simplify persistence command helpers**

Delete from `commands.ts`:

- `thumbnailTicketHeader`;
- `getThumbnailActivity`;
- `reportSaveThumbnailFailure`;
- `submitSaveThumbnail`;
- `readSaveThumbnail`.

- [ ] **Step 10: Consume bare state in game-client**

Delete `finishThumbnailCapture`, `applyGameplayCommandResult`, deadline pinning, detached capture submission, and `settlePreparedThumbnailCapture`.

Make gameplay dispatch and persistence transitions invoke/consume `GameStateView` directly while preserving:

- `gameState.inFlight` behavior;
- committed-state publication;
- SFX inference after a successful state change;
- SFX error isolation;
- presentation epoch resets for load/continue where currently required.

Remove `GameplayCommandResultView` and capture-wire types after all Rust/TS consumers in this task are changed.

- [ ] **Step 11: Simplify the manual-save route**

Replace prepare → settle → `save_manual` with one `save_manual` call containing only `reference`, `displayName`, and `expectation`.

Preserve the current error recovery, browser/menu close, and post-save focus restoration, including the Present-tray focus target.

- [ ] **Step 12: Remove thumbnail activity from persistence-store**

Delete:

- `thumbnailActivity` state/getter/replacement;
- initial `getThumbnailActivity()` query;
- `thumbnail-activity-changed` listener;
- thumbnail version counter.

Keep the subscribe-before-reread race protection for persistence health and exit status.

### 2D. Verify the merged wire contract before touching E2E capture proof

- [ ] **Step 13: Run Rust and focused frontend tests GREEN**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run --cwd apps/game test -- \
  src/lib/persistence/commands.test.ts \
  src/lib/persistence/persistence-store.test.ts \
  src/lib/persistence/types.test.ts \
  src/lib/state/game-client-source.test.ts \
  src/routes/page.test.ts \
  src/routes/page-source.test.ts
bun run --cwd apps/game check
```

Expected: PASS. The Rust serialization test is the local proof that frontend mocks match the actual command JSON shape; packaged gameplay remains Task 5's integration proof.

- [ ] **Step 14: Check the live wire is gone**

```bash
rg 'GameplayCommandResultView|thumbnailCapture|prepare_save_thumbnail|submit_save_thumbnail|report_save_thumbnail_failure|read_save_thumbnail|get_thumbnail_activity|thumbnail-activity-changed|AutosaveIfAdvancedWithoutThumbnail' \
  apps/game/src apps/game/src-tauri/src
```

Expected: no live command/ticket/activity matches. `thumbnail-capture.ts` and capture-proof test harness may still exist temporarily as Task 4 deletion targets, but production dispatch must no longer import/use them.

- [ ] **Step 15: Commit Rust and TypeScript together**

```bash
git add apps/game/src-tauri/src/lib.rs \
  apps/game/src-tauri/src/game/save/coordinator \
  apps/game/src/lib/persistence \
  apps/game/src/lib/state/game-client.svelte.ts \
  apps/game/src/lib/state/game-client-source.test.ts \
  apps/game/src/routes/+page.svelte \
  apps/game/src/routes/page.test.ts \
  apps/game/src/routes/page-source.test.ts
git commit -m "refactor(save): remove thumbnail capture wire"
```

---

## Task 3: Remove the unavailable-thumbnail remainder from schema, storage, and coordinator

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Delete: `apps/game/src-tauri/src/game/save/thumbnail.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify as compile errors require: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/save/e2e_faults.rs`
- Modify affected coordinator/storage tests, especially `storage_integration.rs`, `unit.rs`, `e2e_replacement.rs`, and any module found by the thumbnail grep.
- Delete `apps/game/src-tauri/src/game/save/coordinator/tests/ticket.rs` if Task 2 did not already make it empty/unnecessary.
- Check/remove thumbnail-only test helpers such as `png_fixture` if no non-thumbnail consumer remains.

**Interfaces:**
- Consumes: Task 2 runtime with no capture tickets; new saves currently use the old `Unavailable` envelope branch only as a temporary schema bridge.
- Produces: a strict schema-2 JSON save with no thumbnail field, no PNG sidecar ownership, and no thumbnail-specific Rust persistence concepts.

### 3A. Write no-thumbnail schema/storage tests first

- [ ] **Step 1: Update current envelope fixtures**

Remove `thumbnail` while retaining `schemaVersion: 2`.

- [ ] **Step 2: Lock strict round trip**

Add/adjust a round-trip test proving the serialized current envelope has no `thumbnail` key.

- [ ] **Step 3: Lock the intentional pre-release break**

Add a strict-parser test passing a schema-2 envelope with the former top-level `thumbnail` field. Assert parsing fails because `deny_unknown_fields` rejects the unshipped old shape. Do not add a migration.

- [ ] **Step 4: Lock one-file save layout**

Add/adjust storage tests proving `ensure_save_layout` creates/uses the save root without `saves/thumbnails/`, and a staged write installs one JSON envelope with no PNG sidecar.

Preserve overwrite expectation, atomic replacement, directory sync, stale-write, corruption, delete, and orphan-JSON-temporary tests.

- [ ] **Step 5: Run focused Rust tests RED**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features game::save
```

Expected: current schema/storage still owns the unavailable thumbnail branch and fails the new assertions.

### 3B. Delete schema and PNG sidecar concepts

- [ ] **Step 6: Delete thumbnail schema fields/types**

Remove from Rust schema:

- thumbnail byte/dimension constants;
- `ThumbnailFormat`;
- `ThumbnailDescriptorV1`;
- `ThumbnailAvailabilityView`;
- `ThumbnailUnavailableReason`;
- `ThumbnailDiagnosticView`;
- `thumbnail` from `SaveMetadataView`;
- `thumbnail` from `ReadableSaveMetadataView`;
- `thumbnail` from `SaveEnvelope`.

Keep `SAVE_SCHEMA_VERSION = 2`, strict parsing, content revision, summary validation, and snapshot validation unchanged.

- [ ] **Step 7: Collapse storage to one staged JSON envelope**

Remove:

- `ThumbnailWrite` from `SlotWriteRequest`;
- available/unavailable envelope variants;
- staged PNG writes;
- thumbnail directory creation;
- thumbnail availability probing;
- PNG-header reads;
- thumbnail fields from readable invalid metadata;
- canonical thumbnail path/temp/reference cleanup;
- sidecar overwrite/delete/orphan cleanup.

Keep `PreparedSlotWrite` if it remains useful as the staged JSON transaction boundary; do not restructure the writer architecture.

- [ ] **Step 8: Delete PNG validation/error surface**

Delete `save/thumbnail.rs` and its module export. Remove thumbnail PNG/ticket error constructors after `rg` proves no remaining Rust caller.

Keep `sha2`; it is used by non-thumbnail content hashing.

- [ ] **Step 9: Remove thumbnail-only fault/test remainder**

Remove `ThumbnailInstall` / `thumbnailInstall` from the E2E persistence fault enum and any Rust test fixture that exists only for PNG sidecars.

### 3C. Verify Task 3 GREEN

- [ ] **Step 10: Run Rust tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features game::save
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

- [ ] **Step 11: Run Rust zero-match classification**

```bash
rg -n 'thumbnail|Thumbnail' apps/game/src-tauri/src
```

Expected: no product thumbnail concept remains. Inspect any unrelated textual match individually rather than adding a compatibility shim.

- [ ] **Step 12: Commit**

```bash
git add apps/game/src-tauri/src/game/save \
  apps/game/src-tauri/src/game/error.rs
git commit -m "refactor(save): remove thumbnail sidecars"
```

---

## Task 4: Delete capture-owned frontend/E2E/dependency surface

**Files:**
- Delete: `apps/game/src/lib/persistence/thumbnail-capture.ts`
- Delete: `apps/game/src/lib/persistence/thumbnail-capture.test.ts`
- Delete: `apps/game/src/lib/test-harnesses/PackagedCaptureProofProbe.svelte`
- Delete: `apps/game/src/lib/test-harnesses/PackagedCaptureProofProbe.test.ts`
- Delete: `apps/game/e2e-tauri/capture-proof.e2e.ts`
- Modify: `apps/game/e2e-tauri/save-fixtures.ts`
- Modify: `apps/game/e2e-tauri/save-management.e2e.ts`
- Modify capture-only references in `helpers.ts`, `production-anchors.ts`, `save-seed.e2e.ts`, `analysis-beat85.e2e.ts` as found by grep.
- Modify: `apps/game/scripts/e2e-suite-registry.mjs`
- Modify: `apps/game/scripts/save-e2e-paths.mjs`
- Modify affected E2E registry/path/CI contract tests.
- Modify capture-only DOM markup/comments in:
  - `apps/game/src/lib/components/GameAtmosphere.svelte`
  - `apps/game/src/lib/components/SceneBackdrop.svelte`
  - `apps/game/src/lib/components/GameShell.svelte`
  - `apps/game/src/lib/components/DialogueBox.svelte`
  - `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`
- Modify: `apps/game/package.json`
- Modify mechanically: `bun.lock`

**Interfaces:**
- Consumes: runtime/schema with no thumbnail behavior.
- Produces: no capture-proof suite, sidecar fixture APIs, DOM capture annotations, html-to-image/Fontsource dependencies, or capture-only package scripts.

### 4A. Change E2E contracts first

- [ ] **Step 1: Update suite registry expectations**

Remove `capture-proof` from suite IDs and the persistence chain.

- [ ] **Step 2: Remove thumbnail management phases**

Delete expectations for:

- `management-missing-thumbnail`;
- `management-corrupt-thumbnail`.

Keep JSON corrupt-slot management coverage.

- [ ] **Step 3: Remove sidecar fixture contracts**

Update save path/fixture tests so there is no sidecar resolution/removal/corruption/ownership API and `SaveE2eSaveEnvelope` has no thumbnail descriptor.

- [ ] **Step 4: Run E2E contract tests RED**

```bash
bun run --cwd apps/game test:e2e:ci-contracts
```

Expected: current registry/path implementation still exposes capture/sidecar concepts.

### 4B. Delete capture-proof and preserve user-facing save verification

- [ ] **Step 5: Delete capture proof**

Delete the capture-proof E2E spec, probe component/tests, capture-specific anchors/helpers, and capture-only frontend module/tests.

- [ ] **Step 6: Simplify save management fixtures**

Remove sidecar path/hash from ownership snapshots and remove sidecar before-actions/helpers from `save-fixtures.ts` and `save-e2e-paths.mjs`.

- [ ] **Step 7: Strengthen text identity coverage**

In `save-management.e2e.ts`, assert the relevant occupied save cards expose enough visible text to distinguish them using display name / chapter / scene / timestamp or objective, as appropriate to the existing fixture.

Do not add another technical marker as a replacement for the removed image assertion.

### 4C. Remove capture-only UI hooks and dependencies

- [ ] **Step 8: Remove DOM capture annotations/comments**

Delete `data-save-thumbnail-*` attributes and comments whose only owner was DOM capture. Preserve actual rain animation, scene presentation, dialogue, interrogation tray behavior, and layout.

- [ ] **Step 9: Remove package scripts/dependencies**

Remove from `apps/game/package.json`:

- `html-to-image`;
- `@fontsource-variable/noto-serif-tc`;
- `test:e2e:capture-proof`;
- `test:e2e:capture-proof:run`;
- `--suite capture-proof` from the save-chain script.

Regenerate `bun.lock` through the repository's normal Bun install workflow; do not hand-edit it.

### 4D. Verify Task 4 GREEN

- [ ] **Step 10: Run frontend/unit/type contracts**

```bash
bun run --cwd apps/game test
bun run --cwd apps/game check
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:ci-contracts
```

- [ ] **Step 11: Run live capture zero-match checks**

```bash
rg 'html-to-image|@fontsource-variable/noto-serif-tc|data-save-thumbnail|thumbnail-activity-changed|prepare_save_thumbnail|submit_save_thumbnail|report_save_thumbnail_failure|read_save_thumbnail|get_thumbnail_activity' \
  apps/game --glob '!docs/**'
rg -n 'thumbnail|Thumbnail' apps/game --glob '!docs/**'
```

Expected: no product/runtime thumbnail concept. Classify any unrelated match explicitly.

- [ ] **Step 12: Commit**

```bash
git add apps/game/e2e-tauri \
  apps/game/scripts \
  apps/game/src/lib/components \
  apps/game/src/lib/persistence \
  apps/game/src/lib/test-harnesses \
  apps/game/package.json bun.lock
git commit -m "test(save): remove thumbnail capture coverage"
```

---

## Task 5: Run packaged integration, full verification, and close tracking

**Files:**
- No new feature files expected.
- Modify only existing tests/docs if fresh verification exposes a real HPA-550 regression.
- Update HPA-550 and HPA-521 tracking after the implementation is proven.

**Consumes:** Tasks 0-4.

**Produces:** Verified single-PR HPA-550 implementation and downstream tracking that no longer treats thumbnail machinery as an invariant.

### 5A. Prove the real Tauri/gameplay wire

- [ ] **Step 1: Run packaged gameplay**

```bash
bun run --cwd apps/game test:e2e:gameplay
```

This is the integration proof for the Task 2 `GameStateView` wire change. It runs after the capture-proof suite has been deleted, so no obsolete screenshot assertion can mask/fail the new product contract.

- [ ] **Step 2: Run the remaining packaged save chain**

```bash
bun run --cwd apps/game test:e2e:save
```

Expected suite ownership is the remaining save-core / save-management / exit-lifecycle chain; phase counts may decrease only by the deliberately deleted capture-proof and two thumbnail-corruption phases.

### 5B. Run the full repository verification

- [ ] **Step 3: Run frontend/unit/type/lint**

```bash
bun run test
bun run check
bun run lint:all
```

- [ ] **Step 4: Run Rust verification**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run --cwd apps/game rust:fmt
bun run --cwd apps/game rust:lint
```

- [ ] **Step 5: Re-run E2E type/contracts**

```bash
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:ci-contracts
```

### 5C. Self-review deletion value and scope

- [ ] **Step 6: Inspect diff size**

```bash
git diff --stat main...HEAD
```

The implementation should have material net line deletion. If it grows substantially, inspect for a retained/reinvented capture abstraction.

- [ ] **Step 7: Check product/architecture invariants**

Confirm:

- no authored/static/native capture replacement was added;
- `SAVE_SCHEMA_VERSION` remains `2`;
- no migration/compatibility decoder was added;
- no HPA-521 writer/coordinator ownership redesign was pulled in;
- no HPA-560 generic E2E runner redesign was pulled in;
- historical PR #66 thumbnail docs were not rewritten;
- Save / Load / Continue expose enough text context to select the intended save.

### 5D. Update tracking on this same PR

- [ ] **Step 8: Record final HPA-550 evidence**

Update the Linear issue/PR with:

- Task 0 product decision;
- final verification commands/results;
- net deletion summary;
- final save-card text identity behavior.

- [ ] **Step 9: Update HPA-521 after deletion is real**

Only now update HPA-521 so it treats capture tickets, thumbnail activity, PNG sidecars, and capture deadlines as already deleted. Do not update HPA-521 merely from the plan.

- [ ] **Step 10: Keep one PR**

Mark the existing HPA-550 PR ready only after all above verification passes. Do not open a second implementation PR.

---

## Expected final architecture if Task 0 confirms Outcome A

```text
Gameplay mutation
  → GameStateView
  → durable revision advanced?
      → debounced autosave through existing serialized writer

Manual Save
  → save_manual(reference, displayName, expectation)
  → staged JSON envelope
  → refreshed save browser

Save Browser / Confirmation
  → strict slot metadata + recap text
  → select / load / delete / overwrite confirmation
```

There is no screenshot ticket, DOM rasterization, screenshot font embedding, PNG descriptor/sidecar, thumbnail activity state, thumbnail IPC, or packaged capture-proof suite.
