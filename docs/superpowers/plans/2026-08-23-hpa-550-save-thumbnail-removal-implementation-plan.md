# HPA-550 Save Thumbnail Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Lyra's dynamic save-thumbnail product and all capture-only frontend, Rust, IPC, storage-sidecar, dependency, and packaged-E2E machinery while preserving the text-rich Save / Load / Continue experience and every non-thumbnail persistence invariant.

**Architecture:** Save slots remain strict JSON snapshots written through the existing serialized persistence path. Save identity comes from existing name / timestamp / chapter / scene / objective metadata. The gameplay wire changes from `{ state, thumbnailCapture }` to bare `GameStateView` as one Rust+TypeScript contract change. The same task deletes the packaged proof for that removed protocol so no task boundary intentionally leaves the canonical E2E chain red. The save-format/storage deletion follows separately, then dead UI/E2E/dependency cleanup. HPA-521 remains a later coordinator-ownership task.

**Tech Stack:** Svelte 5, TypeScript, Tauri 2, Rust, Bun, Vitest, WebdriverIO packaged Tauri E2E.

**Spec:** `docs/superpowers/specs/2026-08-23-hpa-550-save-thumbnail-removal-design.md`

## Global Constraints

- One ticket, one PR: continue implementation on this HPA-550 branch / draft PR.
- Do not merge the planning state and open a second implementation PR.
- Complete Task 0 before runtime changes. Do not assume or pre-record its outcome.
- If the playtest shows material screenshot value, stop before Task 1 and revise HPA-550 explicitly.
- Do not add authored replacement art, a placeholder renderer, native screenshot provider, provider trait, or new capture abstraction.
- Keep `SAVE_SCHEMA_VERSION = 2`; follow HPA-540's pre-release policy with no migration/backward-compat decoder for unshipped local saves.
- Preserve atomic/staged JSON writes, overwrite expectations, stale-write guards, session generation, durable revision checks, autosave coalescing, corruption discovery, Continue selection, detached restore/exact recapture, flush/exit semantics, failure challenges, and delete ordering.
- Preserve the source-level mutation lock-discipline invariant: mutating commands must route through the centralized mutation helper and must not grab `session.lock()` directly.
- Keep every implementation task runnable at its stated boundary. In particular:
  - never change the TypeScript response shape before Rust changes with it;
  - do not leave `capture-proof` registered after its capture protocol is deleted.
- `apps/game/src-tauri/src/game/save/capture.rs` means **checkpoint/save snapshot capture**, not screenshot capture. It remains persistence-owned.
- The previous draft's “keep Rust `sha2`” instruction was wrong. After deleting `save/thumbnail.rs`, verify direct Rust uses are gone and remove the direct Cargo dependency.
- Do not implement HPA-521's coordinator ownership refactor or HPA-560's generic E2E runner redesign.
- Historical accepted docs may still describe thumbnails. Do not rewrite PR #66 history; this HPA-550 spec/plan defines the new live contract.
- Use TDD for behavior changes: narrow RED first, implement the deletion/simplification, then focused GREEN before widening verification.

---

## Task 0: Close the product-validation gate

**Runtime files:** none.

**Tracking:** HPA-550 Linear thread + this draft PR description/comment.

**Produces:** one explicit human product decision:

```text
Outcome A confirmed: remove dynamic thumbnails.
```

or a stop decision containing the concrete save-identification gap.

- [ ] **Step 1: Run the current packaged Chapter 1 build before changing thumbnails**

Use the current thumbnail-bearing runtime. Do not fake the candidate text-only UI first.

- [ ] **Step 2: Create representative saves**

Create at least three saves across different scenes / primary objectives. Give at least one manual save a meaningful display name.

- [ ] **Step 3: Exercise Continue**

Return to title and use Continue once.

- [ ] **Step 4: Exercise deliberate Load selection**

Open Load and choose a non-newest save using the visible card information, not memorized slot position alone.

- [ ] **Step 5: Reopen the in-game Save / Load browser**

Judge whether display name, timestamp, chapter, scene, recap, and active objective are enough to identify the intended saves.

- [ ] **Step 6: Record the screenshot's actual value**

Record whether screenshot content materially changed which save was selected.

- [ ] **Step 7: Branch on evidence**

If text is sufficient, record `Outcome A confirmed: remove dynamic thumbnails.` and continue.

If screenshots are materially required, stop before Task 1, record the specific ambiguity, and revise the product decision. Do not start a native-capture spike implicitly.

---

## Task 1: Make every text-save consumer independent of thumbnail metadata

**Files — modify/check:**

- Modify: `apps/game/src/lib/components/SaveCard.svelte`
- Modify: `apps/game/src/lib/components/SaveCard.test.ts`
- Check: `apps/game/src/lib/components/SaveBrowser.svelte`
- Modify: `apps/game/src/lib/components/SaveBrowser.test.ts`
- Check: `apps/game/src/lib/components/SaveConfirmationDialog.svelte`
- Modify: `apps/game/src/lib/components/SaveConfirmationDialog.test.ts`
- Modify: `apps/game/src/lib/components/MainMenu.test.ts`
- Modify: `apps/game/src/lib/components/SaveRecapDetails.test.ts`
- Modify: `apps/game/src/lib/components/SaveNameDialog.test.ts`
- Modify: `apps/game/src/lib/persistence/types.ts`
- Modify: `apps/game/src/lib/persistence/types.test.ts`
- Fix any additional **unit-test fixture only** found by the full game Vitest run if it carries the same removed metadata field.

**Interfaces:**

- Rust still sends the old save metadata shape during this task; extra JSON `thumbnail` data is ignored by TypeScript.
- Only `thumbnail` properties on `SaveMetadataView` / `ReadableSaveMetadataView` disappear here.
- Capture ticket/activity types remain until Task 2 so the existing persistence/gameplay code still compiles.

### 1A. Write the text-only UI contract first

- [ ] Remove `thumbnail` fields from valid/readable-invalid fixtures in `SaveCard.test.ts`.
- [ ] Assert a valid card still renders:
  - display name;
  - saved timestamp;
  - chapter title/recap;
  - scene title/recap;
  - active primary objective;
  - appropriate select/load/delete actions.
- [ ] Assert there is no preview `<img>`, `thumbnail-frame`, or `無法顯示預覽` placeholder.
- [ ] Keep explicit empty-slot and invalid-slot coverage.
- [ ] Update `SaveConfirmationDialog.test.ts` to prove the mounted old-slot `SaveCard` still exposes existing-save name/chapter/scene while overwrite comparison exposes current-game chapter/scene/objective.

### 1B. Remove thumbnail-only fixtures/mocks from sibling consumers

- [ ] `SaveBrowser.test.ts`: remove `unavailableThumbnail` and all thumbnail metadata fixture fields.
- [ ] `SaveNameDialog.test.ts`: remove thumbnail fields from occupied/readable-invalid slot fixtures.
- [ ] `MainMenu.test.ts`:
  - remove thumbnail fields from save fixtures;
  - delete the `readSaveThumbnail` mock/reset;
  - delete `not.toHaveBeenCalled()` assertions that are meaningless because MainMenu does not read thumbnails.
- [ ] `SaveRecapDetails.test.ts`: remove the whole `$lib/persistence/commands` mock containing only `readSaveThumbnail`; the component imports only persistence types.
- [ ] Update `types.test.ts` representative metadata to the text-only frontend shape.

### 1C. Remove SaveCard image lifecycle

- [ ] Delete `readSaveThumbnail` import/injected reader prop from `SaveCard.svelte`.
- [ ] Delete thumbnail URL/unavailable state, reactive image reads, object URL ownership/revocation, decode-failure handling, and preview rendering.
- [ ] Keep slot header, newest/selected indicators, `SaveRecapDetails`, diagnostic, and actions.
- [ ] Tighten only spacing/min-height made obviously dead by frame removal. Do not redesign SaveBrowser.

### 1D. Narrow frontend metadata only

- [ ] Remove `thumbnail` from `SaveMetadataView` and `ReadableSaveMetadataView`.
- [ ] Do **not** yet remove `ThumbnailActivityView`, `ThumbnailCaptureRequestView`, `GameplayCommandResultView`, or other live capture-wire types.

### 1E. Verify Task 1 GREEN

Run focused tests first:

```bash
bun run --cwd apps/game test -- \
  src/lib/components/SaveCard.test.ts \
  src/lib/components/SaveConfirmationDialog.test.ts \
  src/lib/components/SaveBrowser.test.ts \
  src/lib/components/SaveNameDialog.test.ts \
  src/lib/components/MainMenu.test.ts \
  src/lib/components/SaveRecapDetails.test.ts \
  src/lib/persistence/types.test.ts
```

Then run the **full game unit suite** so no thumbnail-bearing frontend fixture is deferred several tasks:

```bash
bun run --cwd apps/game test
bun run --cwd apps/game check
```

Expected: all game Vitest tests/type checks are green with the live capture protocol still otherwise intact.

- [ ] Commit this UI-only slice.

---

## Task 2: Atomically remove the capture wire **and its packaged proof**

This is the highest-risk task. It must change Rust and TypeScript together, preserve the central mutation guard, remove `capture-proof` in the same commit, correct CI routing for checkpoint capture, and end with a packaged smoke run.

### Files — Rust wire/coordinator

- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- Delete: `apps/game/src-tauri/src/game/save/coordinator/tests/ticket.rs`
- Modify affected coordinator tests under `apps/game/src-tauri/src/game/save/coordinator/tests/`

### Files — frontend wire/pipeline

- Delete: `apps/game/src/lib/persistence/thumbnail-capture.ts`
- Delete: `apps/game/src/lib/persistence/thumbnail-capture.test.ts`
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
- Modify: `apps/game/src/routes/page-source.test.ts` (capture-protocol/probe assertions now; DOM-annotation assertions remain until Task 4)

### Files — packaged capture proof

- Delete: `apps/game/e2e-tauri/capture-proof.e2e.ts`
- Delete: `apps/game/src/lib/test-harnesses/PackagedCaptureProofProbe.svelte`
- Delete: `apps/game/src/lib/test-harnesses/PackagedCaptureProofProbe.test.ts`
- Delete: `apps/game/src/lib/test-harnesses/capture-proof-settlement.ts`
- Delete: `apps/game/src/lib/test-harnesses/capture-proof-settlement.test.ts`
- Modify capture-proof-specific references as required in:
  - `apps/game/e2e-tauri/helpers.ts`
  - `apps/game/e2e-tauri/production-anchors.ts`
  - `apps/game/e2e-tauri/save-seed.e2e.ts`
  - `apps/game/e2e-tauri/analysis-beat85.e2e.ts`

### Files — suite/CI routing + agent contract

- Modify: `apps/game/package.json`
- Modify: `apps/game/scripts/e2e-suite-registry.mjs`
- Modify: `apps/game/scripts/e2e-suite-registry.test.mjs`
- Modify: `apps/game/scripts/select-e2e-suites.mjs`
- Modify: `apps/game/scripts/select-e2e-suites.test.mjs`
- Modify: `apps/game/scripts/plan-e2e-ci.test.mjs`
- Modify: `apps/game/scripts/e2e-ci-results.test.mjs`
- Modify other CI-contract fixtures only where their canonical suite/chain expectations include `capture-proof`.
- Modify: `CLAUDE.md` so the documented persistence chain no longer names `capture-proof` (AGENTS.md mirrors this content).

**Temporary storage boundary:** schema/storage still accepts `ThumbnailDescriptorV1::Unavailable` / `ThumbnailWrite::Unavailable`. New writes use that existing unavailable value until Task 3 removes the field; no capture ticket/PNG is produced.

### 2A. Lock the bare wire contract RED

- [ ] Add a Rust serialization regression for a representative successful mutating gameplay command/helper:

```rust
let value = serde_json::to_value(result).unwrap();
assert!(value.get("chapter").is_some());
assert!(value.get("scene").is_some());
assert!(value.get("state").is_none());
assert!(value.get("thumbnailCapture").is_none());
```

Use a name such as `mutating_gameplay_command_serializes_bare_game_state`.

- [ ] Update focused frontend mocks so successful mutations return `GameStateView`, not `{ state, thumbnailCapture }`.
- [ ] Assert `gameState.value` commits that direct state without any secondary thumbnail submit/failure command.
- [ ] Change the manual-save route test to expect exactly one `save_manual(reference, displayName, expectation)` save operation and no prepare/submit/failure calls.

Run and confirm RED against current code:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features mutating_gameplay_command_serializes_bare_game_state
bun run --cwd apps/game test -- \
  src/lib/state/game-client-source.test.ts \
  src/routes/page.test.ts \
  src/routes/page-source.test.ts \
  src/lib/persistence/commands.test.ts
```

### 2B. Preserve the non-thumbnail mutation guard

The current source tests split commands into ordinary-thumbnail and no-thumbnail lists. Do **not** delete `direct_no_thumbnail_commands_pin_no_thumbnail_autosave_policy` wholesale.

- [ ] Merge `every_ordinary_mutation_routes_through_the_central_autosave_policy` and `direct_no_thumbnail_commands_pin_no_thumbnail_autosave_policy` into one test named along the lines of:

```text
every_mutating_command_routes_through_the_central_autosave_policy
```

- [ ] Cover the union of the existing command lists, including:
  - `jump_to_scene`;
  - `inspect_hotspot`;
  - `interview_topic`;
  - `enter_sublocation`;
  - `reexamine_evidence`;
  - `reexamine_statement`;
  - `complete_interrogation_phase`;
  - `acknowledge_acquisition_event_core`;
  - `select_analysis_board`;
  - `update_analysis_draft`;
  - `submit_analysis_board`;
  - `ask_interrogation_question`;
  - `present_interrogation_evidence`;
  - `withdraw_interrogation`;
  - `resume_interrogation_testimony`;
  - `challenge_interrogation_line_core`.

For each, preserve/assert:

```text
contains run_gameplay_mutation
selects AutosaveIfAdvanced after policy collapse
does not contain session.lock()
```

Drop only assertions that distinguish `AutosaveIfAdvancedWithoutThumbnail`.

- [ ] Keep/adjust the separate `advance_dialogue`/`advance_dialogue_core` source assertion so removing `run_gameplay_mutation_selecting_policy` does not accidentally bypass centralized mutation handling.

### 2C. Collapse Rust autosave/capture state

- [ ] Remove `AutosaveIfAdvancedWithoutThumbnail`.
- [ ] Route commands formerly using it through ordinary `AutosaveIfAdvanced`.
- [ ] Remove `run_gameplay_mutation_selecting_policy` / `dialogue_persistence_policy` if no non-thumbnail distinction remains.
- [ ] Delete coordinator screenshot-ticket state:
  - capture timeout;
  - capture/prepared purposes;
  - capture request/activity views;
  - capture intent/ticket records/maps/deadlines;
  - capture-required flags;
  - claim/submit/failure/expiration APIs;
  - activity subscribers/publication.
- [ ] Delete `coordinator/tests/ticket.rs` and replace/remove thumbnail-only coordinator assertions while preserving autosave debounce/coalescing, flush, failure, writer ordering, generation/revision, and exit behavior.
- [ ] For the temporary schema boundary, construct the existing unavailable thumbnail write/descriptor directly; do not invent a temporary abstraction.

### 2D. Return bare `GameStateView` and simplify manual save

- [ ] Delete Rust `GameplayCommandResultView`.
- [ ] Change mutating gameplay/persistence-transition commands and relevant start/install/load helpers to return direct `GameStateView`.
- [ ] Remove `prepared_thumbnail_ticket` from manual save and make it a single command.
- [ ] Delete Tauri capture commands and event plumbing:
  - `prepare_save_thumbnail`;
  - `submit_save_thumbnail`;
  - `report_save_thumbnail_failure`;
  - `read_save_thumbnail`;
  - `get_thumbnail_activity`;
  - thumbnail ticket request header;
  - `thumbnail-activity-changed` event.
- [ ] Update command-registration/source tests to the new handler set.

### 2E. Remove TypeScript capture protocol in the same commit

- [ ] Delete `thumbnail-capture.ts` + test.
- [ ] Remove thumbnail command helpers from `commands.ts`.
- [ ] In `game-client.svelte.ts`, delete:
  - capture imports;
  - `finishThumbnailCapture`;
  - `applyGameplayCommandResult`;
  - capture deadline pinning;
  - detached capture submission;
  - prepared-capture settling.
- [ ] Consume direct `GameStateView` while preserving in-flight state, committed-state publication, presentation epoch behavior, SFX inference, and SFX error isolation.
- [ ] Remove `GameplayCommandResultView` and capture-wire TS types once all call sites are changed.
- [ ] In `+page.svelte`, make manual save one command and remove capture-proof probe mounting/environment logic.
- [ ] Remove thumbnail activity from `PersistenceStore` while preserving persistence + exit subscribe-before-reread race protection.

### 2F. Delete capture-proof now, not later

- [ ] Delete the WDIO `capture-proof.e2e.ts` spec.
- [ ] Delete `PackagedCaptureProofProbe.*`.
- [ ] Delete `capture-proof-settlement.ts` + test; its production importer is the deleted capture-proof spec.
- [ ] Remove capture-proof-only E2E helpers/anchors/source assertions.
- [ ] Remove `capture-proof` from the suite registry and persistence chain.
- [ ] Remove `test:e2e:capture-proof` / `test:e2e:capture-proof:run`.
- [ ] Remove `--suite capture-proof` from `test:e2e:save:run`.

### 2G. Fix checkpoint-capture CI routing

In `select-e2e-suites.mjs`:

- [ ] Delete the obsolete `capture` rule completely.
- [ ] Remove `apps/game/src-tauri/src/game/save/capture.rs` from `persistence.excludedPatterns`.
- [ ] Remove `capture-proof` from persistence `suiteIds`.
- [ ] Keep exit exclusions unchanged.
- [ ] Rewrite the `dialogue-capture-surface` comment/name if necessary so it no longer describes “capture-proven persistence carriers”; its broad `E2E_SUITE_IDS` behavior may remain if still justified after the canonical list shrinks.

Update selector/CI tests so a change to `save/capture.rs` selects the remaining full persistence coverage instead of smoke-only.

### 2H. Keep the agent command contract synchronized

Update `CLAUDE.md` at the same boundary as the registry change:

```text
persistence owns save-core and save-management
exit owns exit-lifecycle
```

Keep the existing wording about serial persistence phases as applicable. Do not separately edit the mirrored/symlinked AGENTS content if the repository link already points at CLAUDE.md.

### 2I. Verify Task 2 GREEN across the real boundary

Focused Rust/frontend:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run --cwd apps/game test
bun run --cwd apps/game check
```

E2E contracts/types after deleting the suite:

```bash
bun run --cwd apps/game test:e2e:ci-contracts
bun run --cwd apps/game check:e2e
```

Verify routing explicitly through the selector tests: `save/capture.rs` must resolve to the remaining persistence chain.

Then run packaged smoke **before Task 3**:

```bash
bun run --cwd apps/game test:e2e:smoke
```

This is the first real Tauri proof that the bare `GameStateView` IPC shape landed correctly. Do not call Task 2 complete on compile/mock evidence alone.

Production grep after Task 2 should show no live ticket/capture protocol:

```bash
rg 'thumbnailCapture|prepare_save_thumbnail|submit_save_thumbnail|report_save_thumbnail_failure|read_save_thumbnail|get_thumbnail_activity|thumbnail-activity-changed|VITE_LYRA_E2E_CAPTURE_PROOF' \
  apps/game/src apps/game/src-tauri/src apps/game/e2e-tauri apps/game/scripts
```

`thumbnail` may still remain in schema/storage/sidecar fixtures until Tasks 3-4.

- [ ] Commit this entire Rust+TS+capture-proof+CI-routing boundary atomically.

---

## Task 3: Remove thumbnail from the save format/storage transaction and drop direct Rust `sha2`

### Files — runtime format/storage

- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Delete: `apps/game/src-tauri/src/game/save/thumbnail.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify as required: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/save/e2e_faults.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs` if thumbnail-only PNG fixtures remain
- Modify: `apps/game/src-tauri/src/lib.rs` to stop constructing the temporary unavailable descriptor/write
- Modify affected Rust save/coordinator tests.

### Files — dependency

- Modify: `apps/game/src-tauri/Cargo.toml`
- Modify the tracked Cargo lockfile mechanically if Cargo changes it; do not hand-edit dependency graph entries.

### 3A. Write no-thumbnail schema/storage tests RED

- [ ] Current schema-2 envelope fixture omits `thumbnail`.
- [ ] Round trip proves serialized current envelope has no thumbnail field.
- [ ] Strict parser rejects an old pre-HPA-550 envelope containing the removed top-level field under the intentional pre-release policy.
- [ ] `ensure_save_layout` creates only the save root/required JSON layout and not `saves/thumbnails/`.
- [ ] Staged write test proves one JSON envelope is staged/installed with no PNG sidecar branch.
- [ ] Preserve overwrite expectation, atomic replacement, directory sync, stale write, corruption, delete, orphan JSON temp, Continue, restore, and exit tests.

Run focused Rust tests and confirm RED before implementation.

### 3B. Delete schema thumbnail types

Remove:

- byte/dimension constants;
- `ThumbnailFormat`;
- `ThumbnailDescriptorV1`;
- thumbnail availability/unavailable/diagnostic view types;
- `thumbnail` from `SaveEnvelope`;
- `thumbnail` from Rust public/readable metadata views.

Keep:

- `SAVE_SCHEMA_VERSION = 2`;
- `deny_unknown_fields`/strict parse;
- content revision validation;
- snapshot/summary validation.

### 3C. Collapse storage to JSON-only writes

- [ ] Remove `ThumbnailWrite`.
- [ ] Simplify `PreparedSlotWrite` to its JSON transaction data and existing overwrite expectation.
- [ ] Remove available/unavailable envelope variants.
- [ ] Remove sidecar stage/install/discard/read/validation branches.
- [ ] Stop creating the thumbnail directory.
- [ ] Remove sidecar canonical path/digest/reference/cleanup helpers.
- [ ] Remove thumbnail availability from readable invalid-slot metadata.
- [ ] Keep JSON temporary cleanup and directory sync.

### 3D. Delete PNG validation / thumbnail-only errors/faults

- [ ] Delete `save/thumbnail.rs` and module registration.
- [ ] Remove PNG/ticket error constructors/codes once `rg` proves no non-thumbnail call site.
- [ ] Remove `ThumbnailInstall`/`thumbnailInstall` persistence E2E fault boundary; keep envelope replacement, directory sync, exit flush, and other non-thumbnail fault points.
- [ ] Remove `png_fixture`/similar test helpers only when unused after thumbnail tests are gone.

### 3E. Verify and remove the direct Rust hash dependency

After `save/thumbnail.rs` is deleted, run:

```bash
rg 'sha2::|Sha256' apps/game/src-tauri/src
```

Expected: no Rust source use.

Then:

- [ ] Remove `sha2 = "0.10"` from `apps/game/src-tauri/Cargo.toml`.
- [ ] Let Cargo update the tracked lockfile through normal commands if resolution changes.
- [ ] Do **not** require a transitive `sha2` package to disappear from a lockfile if another dependency still owns it.

### 3F. Verify Task 3 GREEN

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features game::save
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run --cwd apps/game check
```

Run source checks:

```bash
rg 'ThumbnailDescriptorV1|ThumbnailWrite|ThumbnailInstall|saves/thumbnails|sha2::|Sha256' apps/game/src-tauri/src
```

Expected: no live production/test dependency on the deleted thumbnail storage/hash path, except historical prose outside source if any.

- [ ] Commit the JSON-only schema/storage slice.

---

## Task 4: Delete remaining dead thumbnail UI/E2E fixtures and frontend dependencies

Task 2 removed the capture protocol and dedicated packaged suite. Task 3 removed the save-format/storage sidecar. This task cleans the now-dead presentation annotations, sidecar test fixtures/phases, and frontend packages.

### Files — DOM capture annotations/source tests

Modify all live matches found by:

```bash
rg -n 'data-save-thumbnail|save-thumbnail-asset-role|save-thumbnail-layout|save-thumbnail-layer' apps/game/src
```

Known surfaces include:

- `apps/game/src/routes/+page.svelte`
- `apps/game/src/routes/page-source.test.ts`
- `apps/game/src/lib/components/GameAtmosphere.svelte`
- `apps/game/src/lib/components/SceneBackdrop.svelte`
- `apps/game/src/lib/components/GameShell.svelte`
- `apps/game/src/lib/components/DialogueBox.svelte`
- `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`
- `apps/game/src/lib/components/InterrogationSubjectArt.svelte`
- `apps/game/src/lib/components/InvestigationSceneSurface.svelte`
- any other live component returned by the grep.

Remove capture-only attributes/comments without changing actual gameplay layout, rain animation, portrait/backdrop behavior, interrogation tray behavior, or component ownership.

In `page-source.test.ts`:

- [ ] Delete the remaining save-thumbnail boundary/layout assertions.
- [ ] Remove `無法顯示預覽` from canonical player-copy expectations because that copy no longer exists.
- [ ] Keep unrelated Case File, audio, acquisition, navigation, and save/load copy assertions.

### Files — sidecar E2E fixtures/phases

- Modify: `apps/game/e2e-tauri/save-fixtures.ts`
- Modify: `apps/game/e2e-tauri/save-management.e2e.ts`
- Modify as needed: `apps/game/e2e-tauri/helpers.ts`
- Modify as needed: `apps/game/e2e-tauri/production-anchors.ts`
- Modify as needed: `apps/game/e2e-tauri/save-seed.e2e.ts`
- Modify as needed: `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- Modify: `apps/game/scripts/save-e2e-paths.mjs`
- Modify: `apps/game/scripts/save-e2e-paths.test.mjs`
- Modify suite/CI contract tests if their expected management phase counts include deleted thumbnail phases.

Delete:

- thumbnail descriptor fields from E2E envelope fixtures;
- thumbnail sidecar path/hash ownership snapshots;
- sidecar resolve/remove/corrupt/assert helpers;
- `management-missing-thumbnail`;
- `management-corrupt-thumbnail`;
- thumbnail-specific management assertions.

Keep:

- save-core seed/resume;
- JSON corrupt-slot management;
- ordinary manual save/load/delete/overwrite;
- autosave / Continue candidate behavior;
- exit-lifecycle.

Strengthen user-visible save-management assertions around display name/chapter/scene/timestamp/objective where useful instead of replacing image checks with technical hooks.

### Files — frontend dependencies

- Modify: `apps/game/package.json`
- Modify mechanically: `bun.lock`

Remove:

- `html-to-image`;
- `@fontsource-variable/noto-serif-tc`.

The package scripts for capture-proof were already removed in Task 2; do not recreate them here.

Regenerate lockfile with the repository's normal Bun install workflow. Do not hand-edit it.

### 4A. Verify Task 4 GREEN

Frontend/unit/type:

```bash
bun run --cwd apps/game test
bun run --cwd apps/game check
```

E2E contracts/types:

```bash
bun run --cwd apps/game test:e2e:ci-contracts
bun run --cwd apps/game check:e2e
```

Zero-match checks:

```bash
rg 'html-to-image|@fontsource-variable/noto-serif-tc|data-save-thumbnail|save-thumbnail-asset-role|save-thumbnail-layout|save-thumbnail-layer|thumbnail-activity-changed|prepare_save_thumbnail|submit_save_thumbnail|report_save_thumbnail_failure|read_save_thumbnail|get_thumbnail_activity' \
  apps/game --glob '!docs/**'
```

Inspect all remaining generic thumbnail matches:

```bash
rg -n 'thumbnail|Thumbnail' apps/game --glob '!docs/**'
```

Classify every hit. The intended live product architecture has no save-thumbnail concept. Do not add a compatibility shim just to make a grep quiet.

- [ ] Commit cleanup/dependency/E2E-fixture deletion.

---

## Task 5: Full verification, self-review, and tracking on the same PR

### 5A. Full frontend/unit/lint verification

```bash
bun run test
bun run check
bun run lint:all
```

### 5B. Full Rust verification

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run --cwd apps/game rust:fmt
bun run --cwd apps/game rust:lint
```

Reconfirm direct hash cleanup:

```bash
rg 'sha2::|Sha256' apps/game/src-tauri/src
```

Expected: no direct source use.

### 5C. E2E contract/type verification

```bash
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:ci-contracts
```

Verify the selector contract specifically includes checkpoint capture in persistence routing after `capture-proof` deletion.

### 5D. Packaged gameplay proof

The gameplay command response shape changed, so run:

```bash
bun run --cwd apps/game test:e2e:gameplay
```

### 5E. Remaining packaged persistence proof

Run:

```bash
bun run --cwd apps/game test:e2e:save
```

The save chain no longer includes `capture-proof`, and save-management has fewer phases because thumbnail-corruption cases are deleted. Update only the contractual counts caused by those intentional deletions.

### 5F. Scope/deletion self-review

- [ ] `git diff --stat main...HEAD` shows material net line deletion after tests are rewritten.
- [ ] No replacement image/provider/capture abstraction was added.
- [ ] `SAVE_SCHEMA_VERSION` remains 2 and no compatibility decoder/migration exists.
- [ ] The central mutation helper/no-direct-session-lock regression still covers commands formerly in the no-thumbnail list.
- [ ] `save/capture.rs` routes to persistence coverage, not a deleted/smoke-only capture rule.
- [ ] No direct Rust `sha2` dependency remains after its only source consumer is deleted.
- [ ] `CLAUDE.md` documents the new suite chain.
- [ ] HPA-521-owned writer/coordinator restructuring is not pulled in.
- [ ] HPA-560-owned generic E2E runner simplification is not pulled in.
- [ ] Save / Load / Continue remain distinguishable by text per Task 0 and packaged verification.

### 5G. Update tracking

- [ ] Update HPA-550 with the Task 0 product result and final verification evidence.
- [ ] After the deletion is actually implemented, update/comment HPA-521 so it no longer treats capture tickets, thumbnail activity, or PNG sidecars as invariants.
- [ ] Keep this same HPA-550 PR; do not open another implementation PR.
- [ ] Mark the PR ready only after Task 0, implementation, and all verification above are complete.

---

## Expected end-state architecture

```text
Gameplay mutation
  → centralized run_gameplay_mutation guard
  → GameStateView
  → durable revision advanced?
      → debounced autosave through existing serialized writer

Manual Save
  → save_manual(reference, displayName, expectation)
  → staged JSON SaveEnvelope
  → refreshed save browser

Save Browser / Continue / Confirmation
  → strict slot metadata + recap text
  → select / load / delete / overwrite

Checkpoint capture (save/capture.rs)
  → builds SaveSummary + SaveSnapshot
  → remains persistence-owned and persistence-tested
```

There is no screenshot ticket, no DOM rasterization, no screenshot font embedding, no PNG descriptor/sidecar, no thumbnail activity state, no thumbnail IPC, no capture-proof suite, and no thumbnail-only autosave policy.
