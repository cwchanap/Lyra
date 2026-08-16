# HPA-392 Save/Load Persistence, Named Saves, Thumbnails, and Continue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver exact-revision local persistence for every current Lyra runtime state, with five rotating autosaves, three Unicode-named manual saves, aspect-ratio-preserving gameplay thumbnails, disk-backed Continue, durable acquisition acknowledgement, native exit flushing, and the complete Traditional Chinese save/load UI.

> **HPA-549 supersession note:** The exclusive-acknowledgement persistence described in Tasks 9–11 (reserved writers, acknowledgement exit priority, and its failure challenges) was removed by HPA-549. Acknowledgement now commits through the ordinary autosave path, and exit flushes the current revision normally. This historical plan is retained unchanged.

**Architecture:** The scene compiler first materializes every semantic default and validates every referenced semantic asset/audio ID before producing the package content revision. A focused Rust `game/save/` subsystem owns the closed version-1 wire schema, exhaustive capture/restore, storage, discovery, thumbnail validation, migrations, and one serialized persistence coordinator. `AppState` becomes a session facade with a replacement gate, and Tauri plus the development HTTP bridge expose the same typed command/result contract. Svelte owns only presentation, bounded gameplay-root capture behind `GameplayThumbnailCapture`, and save/load workflow state; Rust remains authoritative for slots, names, revisions, pending acquisition events, failure tokens, and session transitions.

**Tech Stack:** Bun 1.3.1, TypeScript, Vitest, SvelteKit SPA, Svelte 5 runes, `html-to-image`, Rust 2021, Serde, Tauri 2.11, `atomic-write-file`, `chrono`, `sha2`, `unicode-segmentation`, `uuid`, Cargo tests, WebdriverIO Tauri E2E, GitHub Actions on Linux and macOS.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-25-hpa-129-save-load-autosave-continue-design.md` as the normative product and architecture contract. The retained HPA-129 filename is intentional; HPA-392 is the implementation issue.
- Preserve the compiler-owned `save_content_manifest.json`, `ActiveDialogueQueue`, stable segment origins, `StoryStateSnapshot`, and content-loading seams delivered by PR #27. Do not add a second canonicalizer, definition store, or package identity.
- Materialize `（沒有新發現。）` into emitted scene JSON before hashing. Runtime queue construction must not synthesize unhashed dialogue.
- Validate that every referenced semantic asset/audio ID resolves exactly once before hashing. Hash semantic IDs and authored semantic content; exclude physical files, decoded bytes, and path mappings.
- Require exact `contentRevision` equality for version 1. Do not silently reset progress, guess by label or array position, or introduce per-definition migration.
- Persist only closed, versioned, camelCase types. Concrete persisted version types reject unknown fields; tagged enum discriminators and variant fields use lower camel case.
- Keep immutable authored definitions out of snapshots. Restore every stable ID against the one exact packaged definition set before installing a candidate.
- Keep `GameStateView` engine-owned. Persistence health, thumbnail activity, exit status, save discovery, and capture tickets use separate complete payloads.
- Keep application-data paths entirely in Rust. No frontend command accepts or receives an application-data path or thumbnail object ID.
- Honor `LYRA_E2E_APP_DATA_DIR` only in an `e2e` build using the test application identifier, and reject unsafe or ambiguous paths before reading, writing, or cleanup.
- Keep all bulk JSON serialization, PNG processing, filesystem I/O, directory sync, and writer waits outside the session mutex.
- Use the global lock order: serialized writer turn, then replacement gate, then session lock. Never acquire or wait for a writer turn while holding the replacement gate or session lock; whenever both gate and session are needed, acquire the gate first.
- Make acknowledgement exclusivity fail every other gameplay-state and session-transition command fast with `persistenceOperationInProgress`, including `get_state`. The coordinator's already-running writer may finish.
- Use one monotonic thumbnail deadline per ticket: issue time plus 1,000 ms. Rendering, 500 ms autosave debounce, fonts/images, submission, and consuming-command waits all spend that same budget.
- A thumbnail failure never invalidates an authoritative save. A JSON replacement failure never masquerades as a thumbnail warning.
- New Game and Load initialize a generation-scoped flush baseline. Opening a browser or returning to title without a later durable mutation must not rotate, replace, or touch a save.
- The packaged `html-to-image` proof in Task 13 is a mandatory architecture gate. If it cannot capture the approved Lyra frame in the real packaged WebView, stop before Tasks 14–17 and return to design.
- Do not hand-edit or commit generated JSON under `apps/game/src-tauri/resources/`.
- Keep `packages/scene-types/` unchanged; the standalone save contract is not an editor scene-graph contract.
- Keep the shared save browser shared. Title Load, in-game Load, and Manual Save may configure it, but may not fork their own slot/card renderers.
- Use focused red/green tests for each task, then run the stated broader gate before committing that slice.

---

## Locked External API Decisions

- Add `html-to-image` to `apps/game` and call `toBlob(node, options)` only behind `GameplayThumbnailCapture`. Use its cloned-DOM `filter`, explicit dimensions, `canvasWidth`/`canvasHeight`, `pixelRatio: 1`, cloned-tree `style`, and font/image embedding options; never restyle the live gameplay tree.
- Send PNG submissions as a raw `Uint8Array` Tauri request body. Carry the opaque ticket in the `x-lyra-thumbnail-ticket` request header and parse it from `tauri::ipc::Request`. Return thumbnail bytes through `tauri::ipc::Response<Vec<u8>>`. The development HTTP bridge mirrors the same header/body shape.
- Add `atomic-write-file = "0.3"` behind a crate-internal `SaveFilesystem` interface. The production adapter supplies same-directory temporary creation, data sync, atomic replacement, and parent-directory sync; tests use a fault-injecting adapter to stop at each ordered write boundary.
- Add `chrono` for RFC 3339 UTC timestamps, `sha2` for thumbnail digests, `unicode-segmentation` for extended-grapheme validation, and `uuid` with `v4` plus `serde`. Parse PNG signature and IHDR directly; do not add an image decoder to authoritative storage.

## Persistence Coordinator Transition Table

Legend:

- `W`: the serialized writer turn.
- `G`: `AppState.replacement_gate`.
- `S`: `AppState.session`.
- `W → G → S` states acquisition order, not simultaneous ownership for the entire operation. A writer releases `S` before bulk I/O and reacquires `S` under `G` only for revalidation/finalization.
- Waiting for `W` or for an acknowledgement/exit intent always owns neither `G` nor `S`.

| From | Event | Locks and ordering | To | Required result |
| --- | --- | --- | --- | --- |
| `Idle` | Durable gameplay command commits revision N | Brief `S` access records revision/ticket intent; no `W` or `G` | `DebouncePending` | Start/restart the 500 ms trailing debounce with a ticket whose original 1,000 ms deadline is unchanged. |
| `DebouncePending` | Debounce expires | Take `W` with no other lock; briefly take `S` to capture an immutable N envelope; write temporaries with `W` only; take `G → S` to revalidate, release `S`, replace under `W + G`, then take `S` to finalize | `WriteInFlight`, then `Idle` or `DebouncePending` | Skip replacement if generation/intent is stale. Schedule one follow-up when a newer same-generation revision exists. |
| `DebouncePending` | Acquisition acknowledgement reserves exclusivity | Brief `S` verifies and claims the event-bound terminal thumbnail result, registers intent, cancels the not-yet-queued N autosave; wait with no locks | `AcknowledgementExclusiveQueued` | N+1 performs one target selection and one authoritative write; N can never later enter `W`. |
| `WriteInFlight` | Acquisition acknowledgement reserves exclusivity | Brief `S` registers the next-writer reservation; current writer continues; acknowledgement waits with no locks | `AcknowledgementExclusiveQueued` | Current N may replace or fail. N+1 reuses the already-selected session target and rotates no second slot. |
| `AcknowledgementExclusiveQueued` | Reserved writer becomes available | Take `W → G → S`; capture rollback, apply N+1, capture target/envelope, release `S`; write with `W + G`; take `S` to commit or roll back | `AcknowledgementExclusiveActive`, then `Idle` or `DegradedWithFailureToken` | Success removes the event durably before popup closure. Pre-envelope failure restores revision and event. Cleanup failure after JSON replacement does not undo acknowledgement. |
| `Idle` or `DebouncePending` | Manual save, in-game Load, or Return to Title asks for a flush | Reserve `W` with no `G`/`S`; then use `W → G → S` and the normal release/reacquire pattern | `FlushRequested`, then `Idle` or `DegradedWithFailureToken` | A generation baseline or already-written revision makes the flush a physical no-op. Manual save writes its manual target after the flush. |
| `WriteInFlight` | Flush requested | Record a waiter briefly under `S`; wait behind the active writer with no locks; reserve the next `W` only if its revision is still uncovered | `FlushRequested` | Coalesce with the active write when it covers the requested generation/revision. |
| Any non-exclusive state | New Game, validated Load/Continue candidate, or Return to Title is ready | Complete any required flush by obtaining `W` before other locks; then release `W` if no replacement is needed and take `G → S` for the generation swap | `SessionGenerationTransition`, then `Idle` | Candidate construction and slot discovery happen outside locks. Baseline initializes to the installed revision; loaded autosave adopts its slot, loaded manual adopts none. |
| `AcknowledgementExclusiveQueued` or `AcknowledgementExclusiveActive` | Gameplay-state or session-transition command arrives | No waiting and no additional lock acquisition | unchanged | Return `persistenceOperationInProgress`; only the coordinator's current writer is allowed to finish. |
| `Idle`, `DebouncePending`, `WriteInFlight`, or `FlushRequested` | Main-window close or user-originated application exit | Register/deduplicate intent under brief `S`; cancel pending debounce where applicable; wait for current `W` with no locks; flush using `W → G → S` | `ExitFlushRequested`, then programmatic exit or `DegradedWithFailureToken` | Keep the window/process alive until success. Exit through one AppHandle one-shot bypass only after success/no-op. |
| `AcknowledgementExclusiveQueued` or `AcknowledgementExclusiveActive` | Close/quit arrives | Register one exit waiter, then wait behind acknowledgement with no locks | `ExitFlushRequested` after acknowledgement resolves | Acknowledgement has priority; exit flush covers its committed revision or reports its failure. |
| Any persistence operation | Authoritative write/sync/replace fails | Finalize diagnostic and UUID challenge under brief `S` | `DegradedWithFailureToken` | Background mutation remains live; acknowledgement rolls back before JSON replacement; blocking workflow exposes Retry/Cancel before a separate bypass confirmation. |
| `DegradedWithFailureToken` | Matching Retry | Validate operation, generation, revision, and UUID challenge under brief `S`; obtain `W` with no locks; continue via `W → G → S` | operation-specific state | A stale, wrong-operation, or consumed token is rejected. |
| `DegradedWithFailureToken` | Cancel | Invalidate the operation challenge under brief `S` | `Idle` with degraded health retained | Cancel never performs the destructive transition or exits. A later mutation/explicit save may recover health. |
| `DegradedWithFailureToken` | Matching confirmed without-saving command | Validate and consume the challenge under `G → S`; no `W` is acquired while either lock is held | `SessionGenerationTransition`, `Idle`, or programmatic exit | Use distinct typed commands for start/load/title/acknowledgement/exit bypasses. Never accept a boolean bypass flag. |

Tests in Tasks 8–11 must exercise every row, including acknowledgement arriving during N's write, a generation transition arriving during pending work, and close/quit arriving during both debounce and acknowledgement persistence.

---

## File Map

### Compiler and cross-host identity

- Create `packages/scripts/compile-scenes/semantic-defaults.ts`.
- Create `packages/scripts/compile-scenes/semantic-defaults.test.ts`.
- Create `packages/scripts/compile-scenes/save-content-references.ts`.
- Create `packages/scripts/compile-scenes/save-content-references.test.ts`.
- Modify `packages/scripts/compile-scenes/orchestrator.ts`.
- Modify `packages/scripts/compile-scenes/save-content-manifest.test.ts`.
- Modify `packages/scripts/compile-scenes/assets/enrich.ts`.
- Modify `packages/scripts/compile-scenes/assets/enrich.test.ts`.
- Add the seven authored/config fixture files beneath `packages/scripts/__fixtures__/save_content_revision_golden/` by copying the three config plus four chapter/scene filenames used by `asset_enabled`.
- Create `packages/scripts/__fixtures__/save_content_revision_golden/expected-content-revision.txt`.
- Modify `apps/game/src-tauri/src/game/dialogue_queue.rs`.
- Modify `.github/workflows/ci.yml`.

### Rust save and application layers

- Create `apps/game/src-tauri/src/game/save/mod.rs`.
- Create `apps/game/src-tauri/src/game/save/schema.rs`.
- Create `apps/game/src-tauri/src/game/save/capture.rs`.
- Create `apps/game/src-tauri/src/game/save/restore.rs`.
- Create `apps/game/src-tauri/src/game/save/migrations.rs`.
- Create `apps/game/src-tauri/src/game/save/storage.rs`.
- Create `apps/game/src-tauri/src/game/save/coordinator.rs`.
- Create `apps/game/src-tauri/src/game/save/thumbnail.rs`.
- Create `apps/game/src-tauri/tests/fixtures/saves/v1-representative.json`.
- Modify `apps/game/src-tauri/src/game/acquisition.rs`.
- Modify `apps/game/src-tauri/src/game/command_tx.rs`.
- Modify `apps/game/src-tauri/src/game/dialogue.rs`.
- Modify `apps/game/src-tauri/src/game/dialogue_queue.rs`.
- Modify `apps/game/src-tauri/src/game/error.rs`.
- Modify `apps/game/src-tauri/src/game/loader.rs`.
- Modify `apps/game/src-tauri/src/game/mod.rs`.
- Modify `apps/game/src-tauri/src/game/navigation.rs`.
- Modify `apps/game/src-tauri/src/game/scenes/investigation.rs`.
- Modify `apps/game/src-tauri/src/game/scenes/interrogation.rs`.
- Modify `apps/game/src-tauri/src/game/scenes/mod.rs`.
- Modify `apps/game/src-tauri/src/game/state.rs`.
- Modify `apps/game/src-tauri/src/game/story/state.rs`.
- Modify `apps/game/src-tauri/src/game/test_support.rs`.
- Modify `apps/game/src-tauri/src/game/view.rs`.
- Modify `apps/game/src-tauri/src/lib.rs`.
- Modify `apps/game/src-tauri/examples/dev_engine_server.rs`.
- Modify `apps/game/src-tauri/Cargo.toml`.
- Modify `apps/game/src-tauri/Cargo.lock`.

### Frontend persistence and UI

- Create `apps/game/src/lib/persistence/types.ts`.
- Create `apps/game/src/lib/persistence/commands.ts`.
- Create `apps/game/src/lib/persistence/persistence-store.svelte.ts`.
- Create `apps/game/src/lib/persistence/persistence-store.test.ts`.
- Create `apps/game/src/lib/persistence/thumbnail-capture.ts`.
- Create `apps/game/src/lib/persistence/thumbnail-capture.test.ts`.
- Create `apps/game/src/lib/persistence/manual-name.ts`.
- Create `apps/game/src/lib/persistence/manual-name.test.ts`.
- Create `apps/game/src/lib/persistence/save-browser-controller.svelte.ts`.
- Create `apps/game/src/lib/persistence/save-browser-controller.test.ts`.
- Create `apps/game/src/lib/components/SaveBrowser.svelte`.
- Create `apps/game/src/lib/components/SaveBrowser.test.ts`.
- Create `apps/game/src/lib/components/SaveCard.svelte`.
- Create `apps/game/src/lib/components/SaveCard.test.ts`.
- Create `apps/game/src/lib/components/SaveNameDialog.svelte`.
- Create `apps/game/src/lib/components/SaveNameDialog.test.ts`.
- Create `apps/game/src/lib/components/SaveConfirmationDialog.svelte`.
- Create `apps/game/src/lib/components/SaveConfirmationDialog.test.ts`.
- Modify `apps/game/src/lib/components/AcquisitionPopup.svelte`.
- Modify `apps/game/src/lib/components/AcquisitionPopup.test.ts`.
- Modify `apps/game/src/lib/components/CrossfadeImage.svelte`.
- Modify `apps/game/src/lib/components/CrossfadeImage.test.ts`.
- Modify `apps/game/src/lib/components/GameShell.svelte`.
- Modify `apps/game/src/lib/components/GameShell.test.ts`.
- Modify `apps/game/src/lib/components/MainMenu.svelte`.
- Modify `apps/game/src/lib/components/MainMenu.test.ts`.
- Delete `apps/game/src/lib/state/acquisition-notifications.ts`.
- Delete `apps/game/src/lib/state/acquisition-notifications.test.ts`.
- Modify `apps/game/src/lib/state/acquisition-controller.svelte.ts`.
- Modify `apps/game/src/lib/state/acquisition-controller.test.ts`.
- Modify `apps/game/src/lib/state/game-client.svelte.ts`.
- Modify `apps/game/src/lib/state/game-client-source.test.ts`.
- Modify `apps/game/src/lib/state/types.ts`.
- Modify `apps/game/src/lib/test-harnesses/CrossfadeImageHarness.svelte`.
- Modify `apps/game/src/lib/test-harnesses/GameShellHarness.svelte`.
- Create `apps/game/src/lib/test-harnesses/PackagedCaptureProofProbe.svelte`.
- Modify `apps/game/src/routes/+page.svelte`.
- Modify `apps/game/src/routes/page.test.ts`.
- Modify `apps/game/src/routes/page-source.test.ts`.
- Modify `apps/game/package.json`.
- Modify `bun.lock`.

### Packaged capture and persistence E2E

- Create `apps/game/e2e-tauri/hpa-392-capture-proof.e2e.ts`.
- Create `apps/game/e2e-tauri/hpa-392-save-seed.e2e.ts`.
- Create `apps/game/e2e-tauri/hpa-392-save-resume.e2e.ts`.
- Create `apps/game/e2e-tauri/hpa-392-save-management.e2e.ts`.
- Create `apps/game/e2e-tauri/hpa-392-exit.e2e.ts`.
- Create `apps/game/e2e-tauri/hpa-392-fixtures.ts`.
- Create `apps/game/src-tauri/src/game/save/e2e_faults.rs`.
- Create `apps/game/scripts/hpa-392-e2e-paths.mjs`.
- Create `apps/game/scripts/hpa-392-e2e-paths.test.mjs`.
- Create `apps/game/scripts/run-hpa-392-e2e.mjs`.
- Modify `apps/game/e2e-tauri/helpers.ts`.
- Modify `apps/game/e2e-tauri/production-anchors.ts`.
- Modify `apps/game/scripts/build-e2e.mjs`.
- Modify `apps/game/src-tauri/tauri.conf.json` only if the packaged proof demonstrates a required CSP change; otherwise leave it byte-for-byte unchanged.
- Modify `apps/game/src-tauri/capabilities/default.json` only if the packaged proof demonstrates a required capability; raw custom-command IPC should require neither a filesystem permission nor a new path grant.
- Modify `apps/game/tsconfig.e2e.json`.
- Modify `apps/game/wdio.conf.ts`.
- Modify `apps/game/package.json`.
- Modify `.github/workflows/ci.yml`.
- Modify `.gitignore`.

---

### Task 1: Materialize semantic defaults and pin the package revision across hosts

**Files:**

- Create: `packages/scripts/compile-scenes/semantic-defaults.ts`
- Create: `packages/scripts/compile-scenes/semantic-defaults.test.ts`
- Create: `packages/scripts/compile-scenes/save-content-references.ts`
- Create: `packages/scripts/compile-scenes/save-content-references.test.ts`
- Modify: `packages/scripts/compile-scenes/orchestrator.ts`
- Modify: `packages/scripts/compile-scenes/save-content-manifest.test.ts`
- Modify: `packages/scripts/compile-scenes/assets/enrich.ts`
- Modify: `packages/scripts/compile-scenes/assets/enrich.test.ts`
- Create: `packages/scripts/__fixtures__/save_content_revision_golden/assets/config/audio.yaml`
- Create: `packages/scripts/__fixtures__/save_content_revision_golden/assets/config/characters.yaml`
- Create: `packages/scripts/__fixtures__/save_content_revision_golden/assets/config/policy.yaml`
- Create: `packages/scripts/__fixtures__/save_content_revision_golden/stories_plan/chapter_1/chapter.md`
- Create: `packages/scripts/__fixtures__/save_content_revision_golden/stories_plan/chapter_1/scene_0.md`
- Create: `packages/scripts/__fixtures__/save_content_revision_golden/stories_plan/chapter_1/investigation_scene_1.md`
- Create: `packages/scripts/__fixtures__/save_content_revision_golden/stories_plan/chapter_1/interrogation_scene_2.md`
- Create: `packages/scripts/__fixtures__/save_content_revision_golden/expected-content-revision.txt`
- Modify: `apps/game/src-tauri/src/game/dialogue_queue.rs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: parsed `SceneRecord` values with source locations, `AssetConfig`, the enriched `AssetManifest`, and existing `buildSaveContentManifest({ bundle })`.
- Produces:

```ts
export const NO_NEW_FINDINGS_DIALOGUE = [
  { kind: "action", text: "（沒有新發現。）" },
] as const;

export function materializeSemanticDefaults(
  scene: SceneRecord,
): SceneRecord;

export function validateSaveContentReferences(input: {
  scenes: readonly SceneRecord[];
  config: AssetConfig;
  manifest: AssetManifest;
}): CompileError[];
```

- Guarantees: both missing and explicitly empty re-examination blocks for hotspot, character topic, evidence, and statement become a one-action array before emitted JSON and the canonical save-content bundle are constructed.

- [ ] **Step 1: Write the four-role semantic-default tests**

For each role, cover `undefined`/missing and `[]`, assert the exact emitted action item, and assert a non-empty authored block remains byte-for-byte unchanged. Add a control proving an unrelated empty intro/testimony segment remains empty and receives no fallback.

- [ ] **Step 2: Run the focused compiler test and confirm the red state**

Run:

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/semantic-defaults.test.ts
```

Expected: FAIL because `semantic-defaults.ts` and `materializeSemanticDefaults` do not exist.

- [ ] **Step 3: Implement semantic materialization at the single compiler boundary**

Clone each `SceneRecord.ast` while preserving every `sourceFile`/`line` and walk only the closed four roles. Invoke the function in `orchestrator.ts` before asset enrichment, before scene JSON is emitted, and before `SaveContentBundleV1` is passed to `buildSaveContentManifest`. Do not mutate shared parser AST instances in place.

- [ ] **Step 4: Write reference-resolution tests before adding the audit**

Cover:

- one valid reference to every semantic image/portrait/background/audio channel;
- a missing semantic asset ID;
- a missing semantic audio ID;
- the same semantic ID declared twice;
- mutation of emitted prose, labels, descriptions, dialogue order, scene order, cues, IDs, and progression, each changing the revision;
- permutation of source/object ordering that does not affect emitted semantics, leaving the revision unchanged;
- source-location metadata, raw Markdown formatting, absolute source paths, and timestamps, each leaving the revision unchanged;
- a changed physical file/path mapping that leaves `contentRevision` unchanged;
- a changed semantic ID or semantic cue that changes `contentRevision`.

Run:

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/save-content-references.test.ts packages/scripts/compile-scenes/save-content-manifest.test.ts packages/scripts/compile-scenes/assets/enrich.test.ts
```

Expected: FAIL because unresolved/duplicate semantic references are not yet rejected at the save-content boundary.

- [ ] **Step 5: Implement exact-once semantic reference validation**

Build normalized asset/audio ID multisets from the authoritative compiler config/manifest, traverse the already-defaulted `SceneRecord` AST, and return `CompileError`s using each reference's preserved source file/line for counts other than one. Keep physical `src`, resolved public URL, file digest, and decoded bytes out of `SaveContentBundleV1`.

- [ ] **Step 6: Remove the Rust runtime fallback**

Delete `REEXAMINE_FALLBACK_TEXT`, remove the `is_reexamine_origin` exception from `DialogueSegment::new`, and update its tests so:

- an empty segment always produces `None`;
- compiler-generated fixtures resolve the explicit `（沒有新發現。）` action through the existing stable origin;
- no production Rust constant or queue-construction branch synthesizes that player-facing string.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_queue
```

Expected: PASS with the compiler-emitted item as the sole runtime source.

- [ ] **Step 7: Add the canonical cross-host fixture**

Copy the existing `asset_enabled` fixture structure, then deliberately include all three scene kinds, all four re-examination default roles, story-state references, semantic portrait/background/image IDs, and BGM/BGS/SFX IDs. Compile it through the real orchestrator in `save-content-manifest.test.ts`, write the reviewed canonical digest to `expected-content-revision.txt`, and assert exact text equality after trimming one terminal newline.

The test must also compile the same fixture after changing only physical path/file data and assert the checked-in revision remains unchanged.

Retain and rerun the PR #27 stable-origin matrix: every resumable dialogue block has one origin, unaffected siblings retain identity across hotspot/topic/phase/question/line insertion or reorder, every dialogue field maps to one derived role key, and collisions fail with source locations.

Assert the real orchestrator emits one complete versioned `save_content_manifest.json` carrying that exact revision and that the existing Chapter 1 corpus still compiles and loads it.

- [ ] **Step 8: Add a Linux/macOS golden CI matrix**

Add a small `content-revision-golden` job with `runs-on: ${{ matrix.os }}` for `ubuntu-latest` and `macos-latest`, Bun 1.3.1, frozen install, and only:

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/semantic-defaults.test.ts packages/scripts/compile-scenes/save-content-references.test.ts packages/scripts/compile-scenes/save-content-manifest.test.ts
```

The `rtk` prefix applies to local execution; GitHub Actions uses the command after that prefix because RTK is a workstation wrapper, not a CI dependency.

- [ ] **Step 9: Run the compiler slice**

Run:

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/semantic-defaults.test.ts packages/scripts/compile-scenes/save-content-references.test.ts packages/scripts/compile-scenes/save-content-manifest.test.ts packages/scripts/compile-scenes/assets/enrich.test.ts
rtk bun run scenes:compile
rtk bun run check:scripts
```

Expected: all focused tests pass, scene compilation succeeds, and scripts type-check with the checked-in revision unchanged on repeat runs.

- [ ] **Step 10: Commit the compiler identity slice**

```bash
rtk git add packages/scripts/compile-scenes/semantic-defaults.ts packages/scripts/compile-scenes/semantic-defaults.test.ts packages/scripts/compile-scenes/save-content-references.ts packages/scripts/compile-scenes/save-content-references.test.ts packages/scripts/compile-scenes/orchestrator.ts packages/scripts/compile-scenes/save-content-manifest.test.ts packages/scripts/compile-scenes/assets/enrich.ts packages/scripts/compile-scenes/assets/enrich.test.ts packages/scripts/__fixtures__/save_content_revision_golden apps/game/src-tauri/src/game/dialogue_queue.rs .github/workflows/ci.yml
rtk git commit -m "feat: pin save content identity"
```

---

### Task 2: Define the closed version-1 save wire contract

**Files:**

- Create: `apps/game/src-tauri/src/game/save/mod.rs`
- Create: `apps/game/src-tauri/src/game/save/schema.rs`
- Create: `apps/game/src-tauri/src/game/save/migrations.rs`
- Create: `apps/game/src-tauri/src/game/save/thumbnail.rs`
- Create: `apps/game/src-tauri/tests/fixtures/saves/v1-representative.json`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `apps/game/src-tauri/src/game/story/state.rs`
- Modify: `apps/game/src-tauri/Cargo.toml`
- Modify: `apps/game/src-tauri/Cargo.lock`

**Interfaces:**

- Consumes: the existing content-manifest version dispatcher, `StoryStateSnapshot`, active-dialogue snapshot types, and current runtime enum vocabulary.
- Produces the concrete disk types:

```rust
pub(crate) const SAVE_SCHEMA_VERSION: u32 = 1;
pub(crate) const MAX_THUMBNAIL_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_THUMBNAIL_WIDTH: u32 = 480;
pub(crate) const MAX_THUMBNAIL_HEIGHT: u32 = 360;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum SaveSlotRef {
    Auto { slot: u8 },
    Manual { slot: u8 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RecordKind {
    Evidence,
    Statement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AcquisitionEventStateV1 {
    pub(crate) id: String,
    pub(crate) record_kind: RecordKind,
    pub(crate) record_id: String,
    pub(crate) created_by_command_id: u64,
    pub(crate) ordinal: u32,
}

pub(crate) struct SaveEnvelopeV1 {
    pub(crate) schema_version: u32,
    pub(crate) content_revision: String,
    pub(crate) save_id: String,
    pub(crate) save_type: SaveType,
    pub(crate) slot: u8,
    pub(crate) saved_at: String,
    pub(crate) display_name: String,
    pub(crate) thumbnail: ThumbnailDescriptorV1,
    pub(crate) summary: SaveSummary,
    pub(crate) snapshot: SaveSnapshotV1,
}

pub(crate) fn parse_current_envelope(
    bytes: &[u8],
) -> Result<SaveEnvelopeV1, GameError>;

pub(crate) fn validate_manual_display_name(
    input: &str,
) -> Result<String, GameError>;

pub(crate) fn suggested_display_name(
    chapter_title: &str,
    scene_title: &str,
) -> String;

pub(crate) fn canonical_uuid_v4(input: &str) -> Result<uuid::Uuid, GameError>;
```

- `SaveSnapshotV1` contains top-level chapter/scene IDs, a closed `SceneProgressSnapshotV1`, optional `ActiveDialogueStateV1`, `LastVisualCueSnapshotV1`, `InventorySnapshotV1`, pending `AcquisitionEventStateV1` values, `StoryStateSnapshot`, `DialogueHistorySnapshotV1`, `next_queue_gen`, and `durable_revision`.
- Every concrete versioned struct uses `#[serde(rename_all = "camelCase", deny_unknown_fields)]`. Tagged enums use `#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]`; `SaveType` and `ThumbnailFormat` serialize as lower-camel unit strings.

- [ ] **Step 1: Add the dependencies and failing schema fixture test**

Add:

```toml
atomic-write-file = "0.3"
chrono = { version = "0.4", default-features = false, features = ["clock", "serde"] }
sha2 = "0.10"
unicode-segmentation = "1"
uuid = { version = "1", features = ["serde", "v4"] }

[dev-dependencies]
tempfile = "3"
```

Create one representative interrogation envelope fixture with nested lower-camel tags/fields, Unicode display name, available PNG metadata, inventory, one pending event, story state, dialogue history, `lineContentSegmentIndex`, and `crossExam: { "type": "presenting" }`.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::schema
```

Expected: FAIL because the save module and concrete v1 types do not exist.

- [ ] **Step 2: Implement the exact envelope and snapshot types**

Add all types from design §§6–8, including:

- `SaveType::{Auto, Manual}`;
- `ThumbnailDescriptorV1::{Available, Unavailable}` and `ThumbnailFormat::Png`;
- `SceneProgressSnapshotV1::{Linear, GameComplete, Investigation, Interrogation}`;
- closed investigation/interrogation override reference enums;
- `CrossExamSnapshotV1::{Idle, Playing, Presenting}` with stable question/line IDs;
- inventory entries containing only record IDs and acquisition origins;
- visual/audio snapshots containing only semantic cue state;
- dialogue history entries/counter/last token;
- acquisition event numeric fields plus redundant recomputable ID.

Derive `Clone`, `Debug`, `PartialEq`, `Eq`, `Serialize`, and `Deserialize` where the field types permit them so round-trip and rollback diagnostics can compare exact values.

Because v1 embeds existing story/queue value types, add `deny_unknown_fields` to `StoryStateSnapshot`, all four story progress snapshot structs, `AssertionOrigin`, `InventoryTarget`, and `DialogueItem`. `ActiveDialogueStateV1` and `DialogueSegmentOriginV1` already have the attribute; retain it. Do not wrap any nested value in a permissive `serde_json::Value`.

- [ ] **Step 3: Pin exact JSON and reject schema drift**

Tests must:

- serialize the representative Rust value to bytes exactly matching `v1-representative.json`;
- deserialize it back to equality;
- reject unknown top-level and nested fields;
- reject snake_case keys and PascalCase enum values;
- parse only `schemaVersion` first, dispatch version 1, reject version 2 as `unsupportedSaveSchemaVersion`, and report a deliberately missing registry link as `missingSaveSchemaMigration`;
- reject a missing version rather than treating it as version 1.

- [ ] **Step 4: Implement UUID, timestamp, slot, and descriptor validation**

Tests cover:

- canonical lowercase hyphenated UUID v4 round-trip;
- uppercase, braced, compact, non-v4, and non-UUID values rejected;
- `object_id == save_id` recomputed by identity;
- exact `sha256:<64 lowercase hex>` digest shape;
- `Auto` slots 1–5 and `Manual` slots 1–3;
- RFC 3339 UTC `saved_at`;
- nonzero PNG byte length at most 1 MiB and nonzero dimensions within 480×360.

Do not join any descriptor string to a path in this task.

- [ ] **Step 5: Implement authoritative Unicode name rules**

First reject every forbidden character in the raw input (including leading or
trailing C0/C1 controls, U+2028, and U+2029), then apply Rust
Unicode-whitespace trimming and count
`UnicodeSegmentation::graphemes`. Test:

- empty/whitespace-only input;
- 1 and 40 extended grapheme clusters accepted;
- 41 rejected, including emoji/combining-sequence boundaries;
- C0/C1 controls, U+2028, and U+2029 rejected;
- remaining Unicode and internal spacing preserved without normalization or collapsing;
- `<chapter title> · <scene title>` retained through 40 clusters;
- longer suggestions retain 39 complete clusters plus `…`.

- [ ] **Step 6: Add stable typed diagnostics**

Pin distinct `GameError` codes:

```text
saveDirectoryUnavailable
saveReadFailed
saveWriteFailed
saveSyncFailed
saveReplaceFailed
saveDiscoveryUnavailable
malformedSaveJson
saveSlotMismatch
unsupportedSaveSchemaVersion
missingSaveSchemaMigration
incompatibleContentRevision
missingSaveDefinition
invalidSaveProgress
invalidSaveCursor
invalidSaveCheckpointId
manualSaveNameEmpty
manualSaveNameTooLong
manualSaveNameForbidden
thumbnailPngMalformed
thumbnailPngTooLarge
thumbnailDimensionsOutOfBounds
staleThumbnailTicket
thumbnailTicketPurposeMismatch
acquisitionThumbnailTicketMismatch
persistenceOperationInProgress
staleManualOverwriteConfirmation
staleSaveSelection
staleSessionGeneration
persistenceBypassUnavailable
stalePersistenceFailureToken
unknownAcquisitionEvent
```

Later tasks reuse these constructors instead of creating string variants. Messages may name a typed slot but must not expose an arbitrary absolute path. Thumbnail presentation continues to use its separate closed `captureUnavailable | missing | corrupt | readFailed` reason.

- [ ] **Step 7: Run and commit the schema slice**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::schema
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::migrations
rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
```

Expected: all schema/name/migration tests pass and the representative fixture remains exact.

Commit:

```bash
rtk git add apps/game/src-tauri/Cargo.toml apps/game/src-tauri/Cargo.lock apps/game/src-tauri/src/game/error.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/schema.rs apps/game/src-tauri/src/game/story/state.rs apps/game/src-tauri/src/game/save/mod.rs apps/game/src-tauri/src/game/save/schema.rs apps/game/src-tauri/src/game/save/migrations.rs apps/game/src-tauri/src/game/save/thumbnail.rs apps/game/src-tauri/tests/fixtures/saves/v1-representative.json
rtk git commit -m "feat: define save schema v1"
```

---

### Task 3: Add durable revisions and Rust-owned acquisition events

**Files:**

- Modify: `apps/game/src-tauri/src/game/acquisition.rs`
- Modify: `apps/game/src-tauri/src/game/command_tx.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/navigation.rs`
- Modify: `apps/game/src-tauri/src/game/state.rs`
- Modify: `apps/game/src-tauri/src/game/view.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

**Interfaces:**

- Consumes: current `GameEngine::command_tx`, `EngineRollbackSnapshot`, inventory acquisition methods, and packaged evidence/statement definitions.
- Produces: rollback-tracked revision/event state and the resolved single pending-acquisition public view.

```rust
pub(super) struct AcquisitionCtx<'a> {
    pub(super) inventory: &'a mut Inventory,
    pub(super) pending_events: &'a mut Vec<AcquisitionEventStateV1>,
    pub(super) command_id: u64,
    pub(super) next_ordinal: &'a mut u32,
}

pub(super) enum CommandMutation {
    Changed,
    Unchanged,
}

pub(super) fn command_tx(
    &mut self,
    f: impl FnOnce(&mut Self, u64) -> Result<CommandMutation, GameError>,
) -> Result<GameStateView, GameError>;

pub(in crate::game) struct EngineRollbackSnapshot {
    current_chapter_idx: usize,
    current_scene_idx: usize,
    scene: SceneRuntime,
    last_visual_cue: LastVisualCue,
    inventory: Inventory,
    story_state: StoryState,
    next_queue_gen: u64,
    history: DialogueHistory,
    durable_revision: u64,
    pending_acquisition_events: Vec<AcquisitionEventStateV1>,
}
```

`AcquisitionEventStateV1` and `RecordKind` are the Task 2 wire types reused directly as live pending state; do not define an isomorphic second event struct in `acquisition.rs`.

Expose rollback capture/restore only as `pub(in crate::game)` so the save coordinator can hold the acknowledgement rollback snapshot; do not make it an IPC or public library type.

- `GameEngine` gains rollback-tracked `pending_acquisition_events: Vec<AcquisitionEventStateV1>` and `durable_revision: u64`, both initialized to empty/0.
- A successful durable command derives `command_id = durable_revision.checked_add(1)`, records events in reveal order, finalizes history, then commits `durable_revision = command_id` before building the public view.
- `GameStateView.pending_acquisition` is either `None` or the first event resolved to packaged record presentation; it remains `None` while authored dialogue is active.

- [ ] **Step 1: Write rollback and command-ID tests**

Cover:

- first successful durable command commits revision 1;
- each later successful durable command increments once;
- stale queue-token and other explicit `Unchanged` outcomes leave revision/history/events untouched;
- a failed command restores revision, inventory, pending events, and history;
- read-only `view`, discovery-equivalent reads, and test getters do not increment;
- `EngineRollbackSnapshot::capture` and `restore` explicitly destructure both new fields with no `..`.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml command_tx
```

Expected: FAIL because `GameEngine` and rollback do not own the new fields.

- [ ] **Step 2: Make the command transaction seam derive and commit IDs**

Change every production `command_tx` closure to accept the provisional derived `u64` and return explicit `CommandMutation`. Retain `rollback_scope` for nested internal atomicity, but only an outer `Changed` result may finalize history/events and commit the revision. An `Unchanged` result with any rollback-tracked difference is an internal invariant error and restores the snapshot. Add a source-contract test that every mutating public engine command routes through `command_tx`; keep read-only methods outside it.

- [ ] **Step 3: Write acquisition event tests**

Cover:

- first new record in command 7 produces `acq:7:0`;
- two records acquired by one command produce ordinal 0 and 1 in reveal order;
- reacquiring an owned record produces no event and consumes no ordinal;
- malformed stored ID is rejected when recomputed from numeric fields;
- the disk `createdByCommandId` is a JSON number, not a string;
- no `acknowledged` field exists.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml acquisition
```

Expected: FAIL because `AcquisitionCtx` still owns only inventory.

- [ ] **Step 4: Route all current acquisitions through the event-aware context**

Pass one command-local ordinal through the existing reveal/acquisition call sites. Encapsulate inventory vectors enough that production additions continue through `AcquisitionCtx`; do not add a second frontend/inventory-diff event source.

- [ ] **Step 5: Add pending-acquisition view tests**

Test that:

- active authored dialogue hides pending acquisition;
- after dialogue exhausts, exactly the earliest `(command_id, ordinal)` event appears;
- presentation is resolved from the current evidence/statement definition;
- multiple pending events are exposed one at a time;
- unknown record IDs produce a typed engine error rather than incomplete UI data.

- [ ] **Step 6: Run and commit the durable-state slice**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml command_tx
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml acquisition
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml pending_acquisition
```

Expected: all focused tests pass, including failure rollback byte equality.

Commit:

```bash
rtk git add apps/game/src-tauri/src/game/acquisition.rs apps/game/src-tauri/src/game/command_tx.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/navigation.rs apps/game/src-tauri/src/game/state.rs apps/game/src-tauri/src/game/view.rs apps/game/src-tauri/src/game/error.rs apps/game/src-tauri/src/game/test_support.rs
rtk git commit -m "feat: track durable acquisition events"
```

---

### Task 4: Capture every current runtime into `SaveSnapshotV1`

**Files:**

- Create: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/dialogue.rs`
- Modify: `apps/game/src-tauri/src/game/dialogue_queue.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/investigation.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/interrogation.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/mod.rs`
- Modify: `apps/game/src-tauri/src/game/story/state.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

**Interfaces:**

- Consumes: the closed Task 2 schema, Task 3 durable fields, current runtime states, stable dialogue origins, and `StoryState::snapshot`.
- Produces: one immutable, deterministic checkpoint plus presentation summary for the coordinator/storage layers.

```rust
pub(crate) struct CapturedCheckpointV1 {
    pub(crate) summary: SaveSummary,
    pub(crate) snapshot: SaveSnapshotV1,
}

pub(crate) fn capture_checkpoint_v1(
    engine: &GameEngine,
) -> Result<CapturedCheckpointV1, GameError>;

pub(crate) fn capture_scene_progress_v1(
    engine: &GameEngine,
) -> Result<SceneProgressSnapshotV1, GameError>;
```

- Capture is pure with respect to `GameEngine`; it sorts unordered sets into deterministic vectors and fails impossible stable states without mutating live play.
- `ActiveDialogueStateV1` remains the existing stable-origin segment/item representation. No new flattened persistence cursor is introduced.
- `capture_checkpoint_v1` begins with an exhaustive `GameEngine` destructure that classifies every field as persisted, immutable-package, derived, or rollback-only; adding an unclassified engine field must fail compilation.

- [ ] **Step 1: Write failing capture tests for all scene variants**

Build fixture engines for:

- linear with an active item and an exhausted queue;
- Game Complete using `current_chapter_idx == chapters.len()` with the final scene retained;
- investigation with incomplete intro/outro, sublocation, inspected/discussed/entered sets, overrides, inventory, and an active composite queue;
- interrogation with phase/entered/completed/broken state, Playing and Presenting cross-exam states, an active composite queue, and a testimony-line content segment boundary.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::capture
```

Expected: FAIL because `capture_checkpoint_v1` does not exist.

- [ ] **Step 2: Implement exhaustive scene-progress adapters**

Centralize runtime composite-key parsing:

```rust
fn capture_investigation_override(
    runtime_key: &str,
) -> Result<InvestigationOverrideRefV1, GameError>;

fn capture_interrogation_override(
    runtime_key: &str,
) -> Result<InterrogationOverrideRefV1, GameError>;
```

Accept only:

- `hotspot:{id}`;
- `sublocation:{id}`;
- `topic:{character_id}@{topic_id}`;
- `question:{id}`;
- `phase:{id}`.

Unknown prefixes, missing components, or separator-bearing components fail capture. Sort every runtime set by its closed snapshot key.

- [ ] **Step 3: Capture queue and interrogation coordinates exactly**

Reuse the existing queue capture adapter so `queue_gen`, `active_segment_index`, and `item_cursor` remain authoritative. Persist `line_content_segment_index: Option<usize>`, never the runtime flattened `line_content_start`. Convert Playing's line array index to a stable line ID; retain Presenting's exact question/line IDs.

Tests assert the public flattened `QueueToken` before capture equals the token reconstructed from the captured coordinates.

- [ ] **Step 4: Enforce intro-generation and stable-capture invariants**

Add `RESTORED_CONSUMED_INTRO_QUEUE_GEN: u64 = 0` alongside the existing live generation rules, but do not serialize `intro_queue_gen`. Capture rejects:

- an unplayed non-empty intro with no active intro segment;
- capture before initial priming;
- an empty active queue;
- a linear cursor left past its final item rather than the already-entered successor.

- [ ] **Step 5: Capture inventory, story, cues, history, and revisions**

Use `StoryState::snapshot`, preserve inventory acquisition order, capture defaultable semantic visual/audio cue state, reuse `DIALOGUE_HISTORY_LIMIT`, retain rendered historical transcript copy, and include `next_queue_gen`, `durable_revision`, and pending acquisition events.

History tests cover:

- exactly 50 entries accepted;
- 51 rejected;
- `last_token` from an exhausted or prior-scene queue accepted when structurally possible;
- zero/future generations, unknown packaged scene IDs, and out-of-range encoded cursors rejected;
- active-token equality checked only when both tokens name the same queue.

Composite queue fixtures additionally pin ordering across `onCollect`, `onAcquire`, result, and reveal segments. Capture active investigation outro and interrogation phase-entry queues only after their committed state/reveals are installed.

- [ ] **Step 6: Derive and validate `SaveSummary`**

Resolve chapter/scene titles and the active primary objective label from current packaged definitions. For Game Complete, require the sole top-level chapter/scene IDs to name the package's final chapter/final scene and the retained runtime scene to match.

- [ ] **Step 7: Run and commit the capture slice**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::capture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_queue
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_history
```

Expected: all current runtimes and edge cases produce deterministic snapshots without live mutation.

Commit:

```bash
rtk git add apps/game/src-tauri/src/game/save/capture.rs apps/game/src-tauri/src/game/save/mod.rs apps/game/src-tauri/src/game/save/schema.rs apps/game/src-tauri/src/game/dialogue.rs apps/game/src-tauri/src/game/dialogue_queue.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/scenes/investigation.rs apps/game/src-tauri/src/game/scenes/interrogation.rs apps/game/src-tauri/src/game/scenes/mod.rs apps/game/src-tauri/src/game/story/state.rs apps/game/src-tauri/src/game/test_support.rs
rtk git commit -m "feat: capture resumable game state"
```

---

### Task 5: Build fully validated restore candidates transactionally

**Files:**

- Create: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/dialogue.rs`
- Modify: `apps/game/src-tauri/src/game/dialogue_queue.rs`
- Modify: `apps/game/src-tauri/src/game/loader.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/investigation.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/interrogation.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/mod.rs`
- Modify: `apps/game/src-tauri/src/game/story/state.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`

**Interfaces:**

- Consumes: a parsed Task 2 envelope and the current packaged definitions/resources.
- Produces: a fully validated replacement candidate without touching the live engine.

```rust
pub(crate) struct RestoredGameCandidate {
    pub(crate) engine: GameEngine,
    pub(crate) source: SaveSlotRef,
    pub(crate) save_id: String,
    pub(crate) durable_revision: u64,
}

pub(crate) struct CurrentDefinitions {
    pub(crate) content_manifest: ContentManifest,
    pub(crate) chapters: Vec<ChapterManifest>,
    pub(crate) story_catalog: StoryCatalog,
    pub(crate) scenes_by_key: BTreeMap<(String, String), SceneJson>,
    pub(crate) semantic_asset_ids: BTreeSet<String>,
    pub(crate) semantic_audio_ids: BTreeSet<String>,
}

pub(crate) fn load_current_definitions(
    resources_dir: &Path,
) -> Result<CurrentDefinitions, GameError>;

pub(crate) fn build_restore_candidate(
    resources_dir: PathBuf,
    definitions: &CurrentDefinitions,
    envelope: SaveEnvelopeV1,
) -> Result<RestoredGameCandidate, GameError>;

pub(crate) trait ResumableStateAdapter: Sized {
    type Snapshot;

    fn capture(&self) -> Self::Snapshot;
    fn restore(
        definitions: &CurrentDefinitions,
        snapshot: Self::Snapshot,
    ) -> Result<Self, GameError>;
}
```

- Candidate construction loads/validates the current package independently and never receives a mutable live engine.
- Installation is deliberately absent from this task; Tasks 9–10 install a completed candidate under `G → S`.

- [ ] **Step 1: Write exact-revision and stable-definition failure tests**

For every failure, retain a byte-comparable original test engine and prove it remains unchanged. Cover:

- mismatched package `contentRevision`;
- missing chapter/scene;
- wrong scene kind;
- missing hotspot/sublocation/character/topic/phase/question/testimony line;
- invalid override target;
- wrong inventory record kind or missing record;
- invalid story-state reference;
- pending acquisition ID/command/ordinal mismatch, duplicate ordering key, command ID 0 or above `durable_revision`, and non-monotonic event order;
- summary chapter/scene/objective mismatch.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::restore
```

Expected: FAIL because restore candidate construction does not exist.

- [ ] **Step 2: Reconstruct linear, investigation, interrogation, and Game Complete**

Load immutable definitions from the exact current package, then construct a fresh `GameEngine`. Share the capture/restore composite-key adapter so formatting/parsing rules have one implementation. Restore Game Complete by retaining the final scene and reinstalling the existing completion sentinel.

- [ ] **Step 3: Reconstruct queues without replaying authored effects**

Use stable segment origins to resolve items; validate saved coordinates; preserve `queue_gen`; leave `next_queue_gen` exactly as saved; never call `prime_initial_queue`. When no intro is active, set runtime `intro_queue_gen` to `RESTORED_CONSUMED_INTRO_QUEUE_GEN`; when intro is active, derive it from `active_dialogue.queue_gen`.

After restoring an inactive consumed intro, install the next real queue and assert it receives the serialized `next_queue_gen` without colliding with sentinel 0.

Map:

- `line_content_segment_index: Some(i)` to that reconstructed segment's first flattened item;
- `None` to reconstructed queue length;
- no active queue to runtime `line_content_start = 0`.

Reject a non-testimony segment index or mismatch with the active queue.

- [ ] **Step 4: Restore Playing and Presenting cross-exam states**

Resolve Playing's stable line ID to exactly one current line index. Restore Presenting as Presenting and assert the resulting public view has `presenting: true` with the exact question/line, so Svelte reopens the evidence tray instead of falling back.

- [ ] **Step 5: Restore history and prevent first-view duplication**

Validate entry IDs, `next_id`, bounded length, structural historical token rules, and same-queue active-token equality. Build the first public view and assert no duplicate history entry is appended.

Advance once after restore and prove the saved queue token is accepted exactly once and becomes stale after normal advancement.

- [ ] **Step 6: Restore authoritative audio cue state**

Assert restored BGM/BGS assets restart from their beginnings, a cue carried across a scene boundary remains selected, explicit silence stays silent, and existing frontend mute/volume preferences are not part of or changed by the snapshot.

- [ ] **Step 7: Add the generic incomplete-state fixture**

Inside `restore.rs` tests, define a test-only adapter with:

- one stable definition ID;
- an incomplete enum/boolean state;
- a cursor;
- one required referenced definition;
- a public value proving exact resume.

Pass it through JSON serialization, exact package revision validation, definition lookup, candidate construction, and a test-harness swap. Do not add a production variant or erased JSON payload.

- [ ] **Step 8: Round-trip every current runtime**

For each Task 4 fixture:

1. capture;
2. serialize and parse through version dispatch;
3. construct a restore candidate;
4. recapture;
5. assert snapshot equality, summary equality, public mode equality, queue-token equality, and durable revision equality.

- [ ] **Step 9: Run and commit the restore slice**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::restore
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::capture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml generic_resumable
```

Expected: every supported state round-trips and every invalid candidate leaves the original engine untouched.

Commit:

```bash
rtk git add apps/game/src-tauri/src/game/save/restore.rs apps/game/src-tauri/src/game/save/mod.rs apps/game/src-tauri/src/game/save/capture.rs apps/game/src-tauri/src/game/save/schema.rs apps/game/src-tauri/src/game/dialogue.rs apps/game/src-tauri/src/game/dialogue_queue.rs apps/game/src-tauri/src/game/loader.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/scenes/investigation.rs apps/game/src-tauri/src/game/scenes/interrogation.rs apps/game/src-tauri/src/game/scenes/mod.rs apps/game/src-tauri/src/game/story/state.rs apps/game/src-tauri/src/game/test_support.rs apps/game/src-tauri/src/game/error.rs
rtk git commit -m "feat: restore save candidates transactionally"
```

---

### Task 6: Implement guarded app-data storage and ordered atomic replacement

**Files:**

- Create: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/thumbnail.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

**Interfaces:**

- Consumes: a validated checkpoint, an optional validated PNG candidate, a fixed slot reference, and guarded app-data root.
- Produces: an atomically authoritative envelope/sidecar result plus non-rollback cleanup diagnostics.

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum ManualSlotExpectation {
    Empty,
    Occupied {
        observation: OccupiedSlotExpectation,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OccupiedSlotExpectation {
    pub(crate) save_id: Option<String>,
    pub(crate) modified_at: Option<String>,
}

pub(crate) enum ThumbnailWrite {
    Available(ValidatedThumbnail),
    Unavailable,
}

pub(crate) struct SlotWriteRequest {
    pub(crate) reference: SaveSlotRef,
    pub(crate) envelope: SaveEnvelopeV1,
    pub(crate) thumbnail: ThumbnailWrite,
    pub(crate) expected_manual: Option<ManualSlotExpectation>,
}

pub(crate) struct SlotWriteOutcome {
    pub(crate) committed_envelope: SaveEnvelopeV1,
    pub(crate) cleanup_diagnostic: Option<GameError>,
}

pub(crate) struct PreparedSlotWrite {
    pub(crate) reference: SaveSlotRef,
    pub(crate) available_envelope: Option<SaveEnvelopeV1>,
    pub(crate) unavailable_envelope: SaveEnvelopeV1,
    pub(crate) expected_manual: Option<ManualSlotExpectation>,
    // Crate-private staged PNG/envelope handles; never serialized or exposed.
}

pub(crate) struct SaveFileMetadata {
    pub(crate) modified_at: SystemTime,
    pub(crate) byte_length: u64,
}

pub(crate) trait SaveFilesystem: Send + Sync {
    fn create_dir_all(&self, path: &Path) -> io::Result<()>;
    fn read(&self, path: &Path) -> io::Result<Vec<u8>>;
    fn read_prefix(&self, path: &Path, limit: usize) -> io::Result<Vec<u8>>;
    fn metadata(&self, path: &Path) -> io::Result<SaveFileMetadata>;
    fn list_dir(&self, path: &Path) -> io::Result<Vec<PathBuf>>;
    fn stage_atomic(
        &self,
        path: &Path,
        bytes: &[u8],
    ) -> io::Result<Box<dyn StagedAtomicWrite>>;
    fn remove_file(&self, path: &Path) -> io::Result<()>;
    fn sync_dir(&self, path: &Path) -> io::Result<()>;
}

pub(crate) trait StagedAtomicWrite: Send {
    fn install(self: Box<Self>) -> io::Result<()>;
    fn discard(self: Box<Self>) -> io::Result<()>;
}

pub(crate) const PRODUCTION_APP_IDENTIFIER: &str = "com.chanwaichan.lyra";
pub(crate) const E2E_APP_IDENTIFIER: &str = "com.chanwaichan.lyra.e2e";

pub(crate) fn resolve_save_root(
    configured_app_data: &Path,
    production_app_data: &Path,
    app_identifier: &str,
) -> Result<PathBuf, GameError>;

pub(crate) fn ensure_save_layout(
    fs: &dyn SaveFilesystem,
    root: &Path,
) -> Result<(), GameError>;

pub(crate) fn prepare_slot_write(
    fs: &dyn SaveFilesystem,
    root: &Path,
    request: SlotWriteRequest,
) -> Result<PreparedSlotWrite, GameError>;

pub(crate) fn commit_prepared_slot_write(
    fs: &dyn SaveFilesystem,
    root: &Path,
    prepared: PreparedSlotWrite,
) -> Result<SlotWriteOutcome, GameError>;

pub(crate) fn discard_prepared_slot_write(
    prepared: PreparedSlotWrite,
) -> Result<(), GameError>;
```

`prepare_slot_write` performs serialization plus temporary-file write/data-sync
only. It performs no final install, replacement, slot mutation, or sidecar
deletion. `commit_prepared_slot_write` is called only after the coordinator has
acquired/revalidated the replacement gate. This split is mandatory for normal
autosaves: long temporary-file work runs under `W` only, then final sidecar and
envelope installation runs under `W + G`.

- Production layout is fixed:

```text
<app-data>/saves/
  autosave-1.json
  autosave-2.json
  autosave-3.json
  autosave-4.json
  autosave-5.json
  manual-1.json
  manual-2.json
  manual-3.json
  thumbnails/<canonical-save-id>.png
```

- [ ] **Step 1: Write path and E2E-override refusal tests**

At Tauri setup, obtain `configured_app_data` from
`app.path().app_data_dir()` and derive `production_app_data` from
`app.path().data_dir()?.join(PRODUCTION_APP_IDENTIFIER)`; do not mistake the
E2E identifier's own app-data directory for the production comparison target.
Under ordinary builds, resolve only `<configured app data>/saves` and ignore
the environment override. Under `feature = "e2e"`, require all of:

- identifier exactly `E2E_APP_IDENTIFIER`;
- `LYRA_E2E_APP_DATA_DIR` present;
- absolute, canonicalizable path beneath `std::env::temp_dir()`;
- basename beginning `lyra-hpa-392-`;
- path unequal to temp root, the user's home, and the resolved production app-data directory.

Cover missing, relative, home, production, non-test identifier, temp root, and symlink escape refusal before any directory creation or cleanup.

After path validation succeeds, `ensure_save_layout` creates `saves/` and
`saves/thumbnails/`, then syncs their existing parent directories. A missing
layout on first launch is therefore an empty-save state, not a discovery
failure. A creation/sync/permission failure is retained as global persistence
unavailability so the title can still offer the approved Play Without Saving
flow; it must not abort the production UI process. The E2E safety failures
above remain startup-fatal before any filesystem mutation.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::storage::tests::e2e
```

Expected: FAIL because guarded save-root resolution does not exist.

- [ ] **Step 2: Implement fixed slot and sidecar paths**

Validate `SaveSlotRef` bounds and exact envelope type/slot agreement before formatting fixed filenames or performing I/O. Revalidate canonical `save_id` and descriptor identity/digest metadata. Construct a sidecar path only from a UUID returned by `canonical_uuid_v4`; never join `display_name`, summary text, request input, or an unvalidated `object_id`.

Stage both the Available and Unavailable envelope variants when a PNG candidate
exists. They share the same save ID, timestamp, summary, and snapshot; only the
thumbnail descriptor differs. This lets a final PNG-install failure select the
already-synced Unavailable envelope without performing a new bulk temporary
write while holding `G`.

- [ ] **Step 3: Write a fault-injected replacement-order test**

The fake filesystem records these named boundaries across prepare and commit:

1. new PNG temporary write and data sync during prepare;
2. Available and Unavailable envelope temporary writes and data sync during prepare;
3. new PNG final install during commit;
4. thumbnail directory sync;
5. selected envelope atomic replacement;
6. saves directory sync;
7. old sidecar deletion;
8. thumbnail directory cleanup sync.

Inject a failure before and after every boundary. Begin with an occupied slot whose envelope references an old sidecar and assert:

- any failure before envelope replacement leaves the old JSON and old sidecar authoritative;
- a sidecar write/install failure selects the already-staged `Unavailable` envelope and still attempts the authoritative JSON commit;
- a newly installed but unreferenced sidecar after JSON failure is an orphan eligible for later cleanup;
- a failure after JSON replacement never restores the old JSON;
- old-sidecar cleanup failure returns committed success plus cleanup diagnostic;
- the committed envelope can never reference the prior checkpoint's sidecar.

Also stage a write, report a stale session before commit, call
`discard_prepared_slot_write`, and prove neither slot nor final sidecar changed
and every task-owned temporary was removed or remained eligible for bounded
orphan cleanup.

- [ ] **Step 4: Implement production `AtomicWriteFile` and ordered slot writes**

Wrap `atomic_write_file::AtomicWriteFile` as the production
`StagedAtomicWrite`. `stage_atomic` creates a same-directory unique temporary
and flushes/syncs its data without committing it; `install` performs the
library's atomic replacement. Parent-directory sync remains an explicit
`SaveFilesystem::sync_dir` step. Generate `save_id` and `saved_at` before
staging. If accepted PNG preparation or installation fails, choose the
already-staged `ThumbnailDescriptorV1::Unavailable` envelope while retaining
the same new checkpoint ID/timestamp.

- [ ] **Step 5: Validate stale manual overwrite expectations**

Immediately before `commit_prepared_slot_write` replaces a manual slot, read only the selected manual slot and compare:

- `ManualSlotExpectation::Empty` against file absence;
- `Occupied { observation.save_id: Some(id) }` against the independently
  parsed current canonical ID;
- `Occupied { observation.save_id: None }` against file presence whose current
  bytes still have no safely canonicalizable save ID and whose filesystem
  modification time still matches `observation.modified_at`.

Reject changes as `staleManualOverwriteConfirmation`; do not overwrite a newly appeared or changed slot.

Tests cover a corrupt occupied manual slot with no save ID: matching mtime may
be overwritten after confirmation, while a replaced/retouched file is
rejected. The same observation matcher protects confirmed deletion.

- [ ] **Step 6: Implement JSON-first deletion**

Delete only the selected fixed JSON path. Re-read it immediately before
deletion using `OccupiedSlotExpectation`: match a supplied canonical observed
save ID, or, when the ID is absent, require that the current file still has no
safely canonicalizable save ID and its modification time is unchanged. Reject
a replaced checkpoint as `staleSaveSelection`. After
JSON removal and directory sync, delete only the canonical sidecar referenced
by that exact validated envelope, then sync the thumbnail directory. If the
JSON was corrupt or had no safely validated object ID, preserve all sidecars
for orphan cleanup rather than deriving a path from corrupt input.

- [ ] **Step 7: Run and commit the storage primitive**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::storage
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::thumbnail
```

Expected: path guards, every failure boundary, manual compare-and-replace, and deletion semantics pass.

Commit:

```bash
rtk git add apps/game/src-tauri/src/game/save/storage.rs apps/game/src-tauri/src/game/save/mod.rs apps/game/src-tauri/src/game/save/schema.rs apps/game/src-tauri/src/game/save/thumbnail.rs apps/game/src-tauri/src/game/error.rs apps/game/src-tauri/src/game/test_support.rs
rtk git commit -m "feat: add atomic save storage"
```

---

### Task 7: Add bounded discovery, rotation, Continue selection, and lazy thumbnails

**Files:**

- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/save/thumbnail.rs`
- Modify: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

**Interfaces:**

- Consumes: the eight fixed slot paths, one shared definitions context, Task 5 validators, and filesystem metadata/header reads.
- Produces: bounded save-browser views, pure rotation/Continue choices, optimistic thumbnail bytes, and writer-serialized cleanup.

```rust
pub(crate) struct SaveDiscoveryContext {
    pub(crate) resources_dir: PathBuf,
    pub(crate) definitions: Arc<CurrentDefinitions>,
}

pub(crate) fn discover_saves(
    fs: &dyn SaveFilesystem,
    root: &Path,
    context: &SaveDiscoveryContext,
) -> SaveBrowserView;

pub(crate) fn select_autosave_target(
    slots: &[SaveSlotView],
) -> Result<SaveSlotRef, GameError>;

pub(crate) fn select_continue_candidate(
    slots: &[SaveSlotView],
) -> Option<SaveSlotRef>;

pub(crate) fn read_save_thumbnail(
    fs: &dyn SaveFilesystem,
    root: &Path,
    reference: SaveSlotRef,
    observed_save_id: &str,
) -> Result<Vec<u8>, GameError>;

pub(crate) fn clean_orphaned_save_files(
    fs: &dyn SaveFilesystem,
    root: &Path,
) -> Result<(), GameError>;
```

- `SaveBrowserView` always returns five autosave and three manual positions when discovery is available; global directory/definition failure returns `discovery: unavailable` without eight fabricated invalid slots.
- Slot status is `empty`, `valid`, or `invalid`. Invalid status retains independently readable name, timestamp, summary, and thumbnail presentation metadata when safe.
- Keep raw `SystemTime` for Rust ordering. Serialize `modifiedAt` as canonical
  UTC RFC 3339 with all available subsecond precision, and round-trip that exact
  representation when checking an ID-less `OccupiedSlotExpectation`; never
  sort by the frontend string.

- [ ] **Step 1: Write discovery-budget tests**

Instrument `SaveFilesystem` counters and assert one batch performs:

- one packaged definitions load and parse before the call;
- at most eight fixed slot-file reads;
- at most eight fixed-size PNG signature/IHDR header reads;
- zero full sidecar body reads;
- zero thumbnail digest calculations or pixel decodes;
- no engine/session mutex acquisition.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::storage::tests::discovery
```

Expected: FAIL because bounded discovery and public save views do not exist.

- [ ] **Step 2: Implement per-slot validation without eager thumbnail bodies**

For each fixed slot:

1. read filesystem mtime;
2. parse minimal metadata;
3. verify type/slot and current schema;
4. validate exact package revision;
5. run the same full snapshot/reference/summary validation used by restore candidate construction;
6. for an available descriptor, read only PNG signature plus IHDR and compare dimensions.

Treat missing, malformed-header, or unreadable sidecars as presentation `unavailable`, not slot invalidity. Defer body length/digest verification to `read_save_thumbnail`.

Run one shared table of malformed IDs, dialogue coordinates, history invariants, and scene progress through both discovery and load, asserting the same pure diagnostic code/detail. Ignore storage-owned stale temporary filenames during slot discovery.

- [ ] **Step 3: Write rotation and invalid-file tests**

Prove:

- choose the lowest empty autosave slot;
- when full, choose oldest filesystem mtime;
- equal mtimes choose ascending slot number;
- invalid/corrupt/incompatible files count as occupied and participate by mtime;
- no `savedAt` value can override rotation order;
- `manual-2.json` claiming auto type or another slot is invalid.

- [ ] **Step 4: Implement strict Continue ordering**

Among all nonempty files, order by:

1. filesystem mtime descending;
2. independently valid `savedAt` descending;
3. manual before auto;
4. higher slot number.

Return the first slot even when invalid. Continue must surface that newest slot's diagnostic and never skip automatically to an older valid save.

- [ ] **Step 5: Implement optimistic, lazy thumbnail reads**

`read_save_thumbnail` must:

1. validate the typed slot;
2. reread its current envelope;
3. compare exact current `save_id` with `observed_save_id`;
4. recompute `object_id == save_id`;
5. validate the canonical path;
6. read at most 1 MiB plus one sentinel byte;
7. validate signature, IHDR, dimensions, byte length, and full SHA-256 digest;
8. return raw PNG bytes.

Map missing, digest mismatch, malformed PNG, and read failure to the closed thumbnail reason without altering save validity.

- [ ] **Step 6: Implement writer-serialized orphan cleanup**

The caller must reserve the same writer turn used by save replacement. After that reservation is acquired, rescan all eight envelopes and construct the complete validated sidecar reference set. Remove only:

- unique temporary files matching the storage module's own fixed pattern;
- final canonical PNGs unreferenced by any currently readable envelope.

Add a race test that pauses cleanup, commits a new PNG/envelope, then lets cleanup acquire its writer turn and rescan; the newly referenced sidecar must survive.

- [ ] **Step 7: Preserve corrupt sources**

Failed reads, future versions, missing migrations, revision mismatches, and restore validation failures leave their source JSON and any possible sidecar untouched. Only explicit Delete or writer-serialized orphan cleanup removes files.

- [ ] **Step 8: Run and commit discovery**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::storage
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::restore
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::thumbnail
```

Expected: all eight views, bounded reads, rotation, Continue ordering, lazy digest checks, and cleanup races pass.

Commit:

```bash
rtk git add apps/game/src-tauri/src/game/save/storage.rs apps/game/src-tauri/src/game/save/thumbnail.rs apps/game/src-tauri/src/game/save/restore.rs apps/game/src-tauri/src/game/save/schema.rs apps/game/src-tauri/src/game/save/mod.rs apps/game/src-tauri/src/game/error.rs apps/game/src-tauri/src/game/test_support.rs
rtk git commit -m "feat: discover and manage save slots"
```

---

### Task 8: Build thumbnail tickets and normal autosave coordination

**Files:**

- Create: `apps/game/src-tauri/src/game/save/coordinator.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/save/thumbnail.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/Cargo.toml`
- Modify: `apps/game/src-tauri/Cargo.lock`

**Interfaces:**

- Consumes: durable commit notifications, immutable checkpoint capture callbacks, validated storage, one monotonic clock, and capture submissions.
- Produces: bounded tickets, serialized background writes, complete health/activity views, and deterministic writer scheduling.

```rust
pub(crate) const AUTOSAVE_DEBOUNCE: Duration = Duration::from_millis(500);
pub(crate) const THUMBNAIL_CAPTURE_TIMEOUT: Duration = Duration::from_millis(1000);

pub(crate) enum ThumbnailCapturePurpose {
    Autosave {
        session_generation: u64,
        durable_revision: u64,
    },
    ManualSave {
        session_generation: u64,
        durable_revision: u64,
    },
    AcquisitionAcknowledgement {
        session_generation: u64,
        source_revision: u64,
        next_revision: u64,
        event_id: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum PreparedThumbnailPurpose {
    ManualSave,
    AcquisitionAcknowledgement {
        event_id: String,
    },
}

pub(crate) struct ThumbnailCaptureRequestView {
    pub(crate) ticket: String,
    pub(crate) timeout_ms: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum PersistenceHealthView {
    Healthy,
    Pending,
    Degraded { diagnostic: SaveDiagnosticView },
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ThumbnailActivityView {
    Idle,
    Capturing,
    Unavailable { diagnostic: ThumbnailDiagnosticView },
}

impl SaveCoordinator {
    pub(crate) fn notify_durable_commit(
        &self,
        session_generation: u64,
        durable_revision: u64,
    ) -> Option<ThumbnailCaptureRequestView>;

    pub(crate) fn prepare_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError>;

    pub(crate) fn submit_thumbnail(
        &self,
        ticket: &str,
        png: &[u8],
    ) -> Result<ThumbnailActivityView, GameError>;

    pub(crate) fn report_thumbnail_failure(
        &self,
        ticket: &str,
    ) -> Result<ThumbnailActivityView, GameError>;
}
```

`ThumbnailCapturePurpose::Autosave` is coordinator-internal and can be created
only by `notify_durable_commit`; IPC accepts only
`PreparedThumbnailPurpose::{ManualSave, AcquisitionAcknowledgement}`. Once an
engine mutation has committed, notification/scheduler trouble must never turn
that gameplay command into an apparent rollback: return the committed state
with no capture request, publish Degraded health, and let a later
mutation/explicit flush retry.

The prepared IPC enum contains only player intent (and the selected event ID
for acknowledgement). In Task 10 the application facade reads/revalidates the
session, constructs the fully bound internal `ThumbnailCapturePurpose`, and
only then calls `prepare_thumbnail`. Svelte never supplies authoritative
counters.

- Add Tokio only for synchronization/timers that integrate with Tauri's existing runtime:

```toml
tokio = { version = "1", features = ["macros", "rt", "sync", "time"] }

[dev-dependencies]
tokio = { version = "1", features = ["macros", "rt", "sync", "test-util", "time"] }
```

Merge the dev entry into Task 2's existing `[dev-dependencies]` table; do not create a duplicate Cargo table.

- [ ] **Step 1: Write fake-time ticket lifecycle tests**

With paused Tokio time, prove:

- canonical UUID v4 opaque tickets;
- one deadline exactly 1,000 ms after issue;
- serialized `timeout_ms` reports remaining time and cannot extend it;
- accepted PNG, reported failure, expiry, and supersession are terminal;
- same ticket cannot be consumed twice;
- a changed generation/revision/purpose/event rejects as stale;
- valid PNG is bounded and digested before retention;
- invalid/oversized/out-of-bounds PNG becomes a typed rejected result and cannot reach storage;
- at most one latest terminal result is retained per intent.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
```

Expected: FAIL because the coordinator and ticket registry do not exist.

- [ ] **Step 2: Implement complete thumbnail activity and persistence health states**

State changes always produce complete payloads. A timeout/capture rejection sets thumbnail activity to `Unavailable` but does not degrade persistence. A background JSON/storage failure sets persistence health to `Degraded` while retaining the committed gameplay mutation.

Expose a subscription callback interface in the coordinator; Task 10 binds it to Tauri events without coupling core tests to an AppHandle.

- [ ] **Step 3: Write debounce/coalescing tests**

With fake time:

- revision 1, 2, and 3 within 500 ms produce one capture/write for 3;
- debounce begins at commit but spends the ticket's existing deadline;
- after 500 ms only 500 ms remains for capture;
- no capture by 1,000 ms writes `Unavailable`;
- a revision committed during a write schedules exactly one follow-up for the newest revision;
- a stale session generation cannot install temporaries;
- bulk serialization/write runs while a probe gameplay lock remains responsive.
- an injected scheduler/worker failure after the engine revision commits still
  returns that committed gameplay view and publishes Degraded health rather
  than rejecting the command.

- [ ] **Step 4: Implement the serialized writer scheduler**

Use one coordinator-owned writer queue with these rules:

- one job owns `W` at a time;
- registered acknowledgement is next after the current writer and ahead of later debounce jobs;
- a superseded debounced job is removed before entering `W`;
- job waits hold no gate/session lock;
- a normal writer captures under brief `S`, calls `prepare_slot_write` under
  `W` only, then acquires `G → S` to revalidate before
  `commit_prepared_slot_write` under `W + G`;
- a stale generation/intent discards its prepared write instead of installing
  it;
- orphan cleanup uses the same queue.

Keep the scheduler behind a small test seam so fake storage can pause before temporary write, before gate acquisition, and before replacement.

- [ ] **Step 5: Implement normal autosave target behavior**

On first autosave for a generation, choose one target through Task 7 rotation and retain it as that session's current target only when replacement commits. A later ordinary autosave represents a new recovery point and selects through ring rotation; an acquisition checkpoint and its acknowledgements may pin/reuse one target as Task 9 specifies.

Record successful `(session_generation, durable_revision, slot, save_id)` separately from live revision. Never compare revision numbers across different generations.

- [ ] **Step 6: Prevent unchanged-revision retry loops**

Background failure remains degraded and records the failed generation/revision. It retries only after:

- a later durable revision;
- explicit manual save;
- explicit flush/retry action.

No unchanged background timer may continuously retry the same revision.

- [ ] **Step 7: Run and commit normal coordination**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::writer
```

Expected: fake-time deadlines, coalescing, follow-up writes, health/activity, target selection, and stale-generation protection pass.

Commit:

```bash
rtk git add apps/game/src-tauri/Cargo.toml apps/game/src-tauri/Cargo.lock apps/game/src-tauri/src/game/save/coordinator.rs apps/game/src-tauri/src/game/save/mod.rs apps/game/src-tauri/src/game/save/storage.rs apps/game/src-tauri/src/game/save/thumbnail.rs apps/game/src-tauri/src/game/save/schema.rs apps/game/src-tauri/src/game/error.rs
rtk git commit -m "feat: coordinate autosave capture"
```

---

### Task 9: Add exclusive acknowledgement, flushes, generations, and failure challenges

**Files:**

- Modify: `apps/game/src-tauri/src/game/save/coordinator.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/acquisition.rs`
- Modify: `apps/game/src-tauri/src/game/command_tx.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`

**Interfaces:**

- Consumes: Task 8 writer/ticket machinery, `AppState` lock callbacks, rollback snapshots, and Task 6/7 slot operations.
- Produces: blocking flush/acknowledgement outcomes, session-generation state, autosave-target adoption, and typed failure challenges.

```rust
pub(crate) struct AppState {
    pub(crate) session: std::sync::Mutex<AppSession>,
    pub(crate) replacement_gate: Arc<tokio::sync::Mutex<()>>,
    pub(crate) coordinator: SaveCoordinator,
    pub(crate) resources_dir: PathBuf,
    pub(crate) save_root: PathBuf,
}

pub(crate) struct AppSession {
    pub(crate) engine: Option<GameEngine>,
    pub(crate) persistence: SessionPersistence,
}

pub(crate) struct SessionPersistence {
    pub(crate) generation: u64,
    pub(crate) flush_baseline_revision: u64,
    pub(crate) written_revision: Option<u64>,
    pub(crate) autosave_target: Option<SaveSlotRef>,
    pub(crate) exclusive_intent: Option<ExclusivePersistenceIntent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct PersistenceFailureTokenView(String);

pub(crate) struct PersistenceFailureChallenge {
    token: uuid::Uuid,
    operation: PersistenceBypassOperation,
    session_generation: u64,
    discovery_generation: Option<u64>,
    durable_revision: u64,
    selected_save_id: Option<String>,
    acquisition_event_id: Option<String>,
}

pub(crate) struct FailureChallengeIdentity<'a> {
    session_generation: u64,
    discovery_generation: Option<u64>,
    durable_revision: u64,
    selected_save_id: Option<&'a str>,
    acquisition_event_id: Option<&'a str>,
}

pub(crate) struct AcknowledgementOutcome {
    pub(crate) state: GameStateView,
    pub(crate) cleanup_diagnostic: Option<SaveDiagnosticView>,
}

impl SaveCoordinator {
    pub(crate) async fn flush_session(
        &self,
        app: &AppState,
        operation: FlushOperation,
    ) -> Result<FlushOutcome, GameError>;

    pub(crate) async fn acknowledge_acquisition(
        &self,
        app: &AppState,
        event_id: String,
        ticket: String,
    ) -> Result<AcknowledgementOutcome, GameError>;

    pub(crate) fn consume_failure_token(
        &self,
        token: &PersistenceFailureTokenView,
        expected: PersistenceBypassOperation,
        current: FailureChallengeIdentity<'_>,
    ) -> Result<PersistenceFailureChallenge, GameError>;
}
```

- Fresh New Game and every installed load candidate receive a new monotonically increasing session generation. Their `flush_baseline_revision` equals the installed engine revision.
- Loaded autosave adopts its source slot as `autosave_target`; loaded manual and fresh game start with no target.
- The coordinator also owns a monotonic discovery generation. Each completed
  `list_saves`/Continue discovery attempt advances it; a new attempt
  invalidates any earlier global-discovery/Play-Without-Saving challenge
  without exposing the counter to Svelte.
- IPC exposes only the transparent UUID token string. Operation/generation/revision/save/event bindings remain in the Rust-owned `PersistenceFailureChallenge` registry and are never inspectable or forgeable as frontend fields.
- `S` is the short-held synchronous session mutex and no `MutexGuard` from it
  crosses an `.await`. `W` and `G` use Tokio synchronization/owned permits so
  waits never block an async runtime worker. Bulk serialization and filesystem
  operations run on the coordinator's blocking worker while retaining only the
  required owned `W`/`G` permits; every return to `S` happens after awaited
  blocking work completes.

- [ ] **Step 1: Write baseline/idempotent flush tests**

Prove:

- fresh New Game at revision 0 immediately returns to title with no file/timestamp/rotation change;
- loaded revision 44 with baseline 44 performs no write until revision 45;
- same-generation baseline/written revision covering the live revision makes every flush a no-op;
- a prior generation's revision 900 cannot suppress a new generation's revision 1;
- flush-only work and manual save leave `durable_revision` unchanged, while successful acknowledgement advances it exactly once;
- manual save, in-game Load, Return to Title, and acknowledgement invoke flush policy at their approved boundaries.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::flush
```

Expected: FAIL because generation-scoped baseline and blocking flush do not exist.

- [ ] **Step 2: Implement generation-scoped flush and transition registration**

Refactor the old `Mutex<Option<GameEngine>>` into the `AppState`/`AppSession` shape above without yet changing public command response types. Follow the transition table exactly. A session transition first reserves/completes any required writer work without `G`/`S`, then takes `G → S` for installation/removal. Reject generation transitions fast while acknowledgement intent is queued/active.

- [ ] **Step 3: Write acknowledgement race tests**

Exercise both normative races:

1. revision N is still debounce/capture pending when acknowledgement arrives: cancel N before `W`; apply/write N+1 once; select one slot;
2. N already owns `W`: reserve acknowledgement next, let N commit or fail, then write N+1 into the same already-selected target without a second rotation.

For both, assert:

- writer waits own neither `G` nor `S`;
- N+1 becomes final;
- no redundant N follow-up remains;
- sequential pending events refresh the same slot;
- loading an autosave adopts and refreshes that slot;
- loading a manual save allocates an autosave target;
- a failed acknowledgement refresh preserves the previous slot file.

- [ ] **Step 4: Implement acknowledgement preflight exclusivity**

Under short-lived coordinator/session access:

1. verify exact event and claim a terminal ticket result;
2. register exclusivity and reserve next `W`;
3. wait with no locks;
4. take `W → G → S`;
5. capture `EngineRollbackSnapshot`, remove the event as revision N+1, and capture the immutable envelope/target;
6. release `S`, write under `W + G`;
7. reacquire `S` to finalize or restore rollback;
8. release intent after success/failure.

While intent exists, every other gameplay state/session command returns `persistenceOperationInProgress` without waiting. A cleanup-only failure after JSON replacement returns committed state plus degraded cleanup status and never restores the event.

- [ ] **Step 5: Write failure-token tests**

Create a UUID challenge bound to exact operation, session generation, and revision. Cover:

- Retry on the matching operation;
- wrong operation, stale generation, stale revision, wrong UUID, and reused token rejected;
- a later discovery attempt invalidates an earlier global-discovery challenge;
- Cancel consumes the operation challenge and retains degraded health;
- Start Without Saving, Load Discarding Current, Return Without Saving, Continue Without Saving after acknowledgement failure, and Exit Without Saving each accept only their own typed token;
- no public command accepts `force`, `skip`, or a boolean bypass.

At this point extend the existing typed command error without adding generic
JSON context:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_token: Option<String>,
}
```

All existing constructors set `failure_token: None`; only a real coordinator
challenge attaches the transparent UUID newtype's opaque string. Retry,
Cancel, and every bypass consume
the matching registry entry before acting. A failed Retry creates a new token
rather than reactivating the consumed one.

- [ ] **Step 6: Implement acknowledgement Continue Without Saving**

After an authoritative acknowledgement write failure:

- keep the pending event/popup on ordinary failure;
- Retry prepares a fresh capture ticket;
- Cancel leaves the popup and live event unchanged;
- only `confirm_acquisition_without_saving` with a matching challenge removes the event transactionally, advances revision, marks health degraded, and permits popup closure;
- consuming that bypass deliberately schedules no capture or write for its own
  advanced revision—the player chose to continue without saving. The next
  later durable mutation schedules a normal autosave of the then-current
  revision, so it may persist the removal;
- if no later save succeeds, restart may show the event again.

- [ ] **Step 7: Run lock-order stress tests**

Use barriers/fault-injected storage to prove:

- no path requests `W` while owning `G` or `S`;
- all paths needing gate/session use `G → S`;
- New Game/Load/Return cannot deadlock a writer holding `G`;
- gameplay remains responsive during temporary-file writes;
- stale generations cannot pass final replacement revalidation.

- [ ] **Step 8: Run and commit exclusive coordination**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::flush
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::acknowledgement
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::failure_token
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::lock_order
```

Expected: every transition-table race and bypass challenge passes deterministically.

Commit:

```bash
rtk git add apps/game/src-tauri/src/game/save/coordinator.rs apps/game/src-tauri/src/game/save/storage.rs apps/game/src-tauri/src/game/save/capture.rs apps/game/src-tauri/src/game/save/schema.rs apps/game/src-tauri/src/game/acquisition.rs apps/game/src-tauri/src/game/command_tx.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/error.rs apps/game/src-tauri/src/game/test_support.rs apps/game/src-tauri/src/lib.rs
rtk git commit -m "feat: make persistence transitions durable"
```

---

### Task 10: Install the application session facade and typed Tauri/HTTP surface

**Files:**

- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/examples/dev_engine_server.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/Cargo.toml`
- Modify: `apps/game/src-tauri/Cargo.lock`

**Interfaces:**

- Consumes: `GameEngine`, Task 5 restore candidates, Task 6–9 persistence services, Tauri state/events/IPC, and the existing development HTTP router.
- Produces: the application session facade plus matching typed Tauri and HTTP command contracts.

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameplayCommandResultView {
    pub(crate) state: GameStateView,
    pub(crate) thumbnail_capture: Option<ThumbnailCaptureRequestView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualSaveResultView {
    pub(crate) saved_slot: SaveSlotView,
    pub(crate) browser: SaveBrowserView,
    pub(crate) thumbnail_activity: ThumbnailActivityView,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveBrowserOpenResultView {
    pub(crate) browser: SaveBrowserView,
    pub(crate) continue_candidate: Option<SaveSlotRef>,
    pub(crate) preflight: SaveBrowserPreflightView,
}

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SaveBrowserPreflightView {
    Ready,
    FlushFailed {
        diagnostic: SaveDiagnosticView,
        failure_token: PersistenceFailureTokenView,
    },
}

pub(crate) enum MutationPersistencePolicy {
    AutosaveIfAdvanced,
    CoordinatorManaged,
    AdvanceWithoutSaving,
}
```

`continue_candidate` is selected by the same Rust function used by
`continue_game`; Svelte never reimplements filesystem-recency/tie-break
ordering. After a failed Continue, its diagnostic action performs a fresh
`list_saves` and selects that returned candidate in the shared Load browser.

- This is the complete final command list. Task 10 registers/mirrors every
  entry except `get_exit_status`, `retry_exit`, `cancel_exit`, and
  `exit_without_saving`; Task 11 adds those four only after implementing their
  lifecycle state machine and exit-driver adapter:

```text
list_saves
get_state
get_persistence_status
get_thumbnail_activity
get_exit_status
start_game
start_game_without_saving
prepare_save_thumbnail
submit_save_thumbnail
report_save_thumbnail_failure
read_save_thumbnail
save_manual
load_save
load_save_discarding_current
continue_game
delete_save
return_to_title
return_to_title_without_saving
acknowledge_acquisition_event
confirm_acquisition_without_saving
retry_exit
cancel_exit
exit_without_saving
```

Add these alongside every existing gameplay handler; do not replace the current gameplay command list. Existing gameplay commands that mutate engine state return `GameplayCommandResultView`; read-only commands retain their existing result types.

Pin the save/session arguments:

| Command | Inputs | Output |
| --- | --- | --- |
| `list_saves` | none | `SaveBrowserOpenResultView`; title is immediately ready, active game first attempts a flush |
| `get_state` | none | bare `GameStateView` |
| status getters | none | complete health/activity/exit view |
| `start_game` | none | `GameplayCommandResultView` with no capture at revision 0 |
| `start_game_without_saving` | matching `PersistenceFailureTokenView` | `GameplayCommandResultView` |
| `prepare_save_thumbnail` | closed `PreparedThumbnailPurpose` | `ThumbnailCaptureRequestView` |
| `submit_save_thumbnail` | raw PNG body plus exact ticket header | `ThumbnailActivityView` |
| `report_save_thumbnail_failure` | `ticket` | `ThumbnailActivityView` |
| `read_save_thumbnail` | `reference`, `observedSaveId` | raw PNG response |
| `save_manual` | manual `reference`, `displayName`, `ManualSlotExpectation`, `preparedThumbnailTicket` | `ManualSaveResultView` |
| `load_save` | `reference`, `observedSaveId` | `GameplayCommandResultView` |
| `load_save_discarding_current` | the load inputs plus matching failure token | `GameplayCommandResultView` |
| `continue_game` | none; Rust rediscovers and selects newest | `GameplayCommandResultView` or newest-slot diagnostic |
| `delete_save` | `reference`, `OccupiedSlotExpectation` | fresh `SaveBrowserOpenResultView` |
| `return_to_title` | none | fresh `SaveBrowserOpenResultView` after flush/session removal |
| `return_to_title_without_saving` | matching failure token | fresh `SaveBrowserOpenResultView` |
| `acknowledge_acquisition_event` | `eventId`, `preparedThumbnailTicket` | `GameplayCommandResultView` with no post-command capture |
| `confirm_acquisition_without_saving` | `eventId`, matching failure token | `GameplayCommandResultView` |
| `retry_exit`, `cancel_exit` | matching exit failure token | complete `ExitStatusView` |
| `exit_without_saving` | matching exit failure token | unit response followed by process exit |

Frontend argument keys use lower camel case and Rust command parameters use the corresponding snake_case names at the Tauri boundary. No command accepts `force`, `skip`, a caller-provided path/object ID, or a boolean bypass.

- [ ] **Step 1: Write application-facade contract tests**

Cover:

- every existing gameplay mutation uses `AutosaveIfAdvanced`, wraps `.state`,
  and schedules capture only when durable revision advances;
- stale queue-token no-op, load/session-transition results, preflight-backed
  acknowledgement, and acknowledgement Continue Without Saving return
  `thumbnailCapture: null`;
- `CoordinatorManaged` never creates a second ticket/write and
  `AdvanceWithoutSaving` advances live revision without notifying the
  autosave scheduler for that revision;
- read-only handlers return bare views;
- a failed load/Continue candidate leaves both the live public view and coordinator session generation unchanged;
- handler source registration contains every Task 10-owned command exactly
  once and leaves the four named exit entries to Task 11;
- no handler directly locks the old `Mutex<Option<GameEngine>>`.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
```

Expected: FAIL because mutating handlers still return bare `GameStateView` and the persistence/session command set is not registered.

- [ ] **Step 2: Centralize command entry guards on the Task 9 session facade**

Add one short-lived guard that:

- returns `gameNotStarted` when appropriate;
- returns `persistenceOperationInProgress` while acknowledgement/exit exclusivity exists;
- invokes an engine mutation;
- compares durable revision;
- applies the explicit `MutationPersistencePolicy`;
- returns the wrapper.

Do not duplicate autosave notification across individual handlers. All current
ordinary gameplay handlers use `AutosaveIfAdvanced`;
`acknowledge_acquisition_event` uses `CoordinatorManaged`; and
`confirm_acquisition_without_saving` uses `AdvanceWithoutSaving`. The latter
must not accidentally turn the approved data-loss bypass into an immediate
save attempt. `AutosaveIfAdvanced` also treats a post-commit coordinator
notification failure as degraded background persistence and still returns the
new `.state`; it never reports the already-committed engine command as failed.

- [ ] **Step 3: Implement manual save and disk-backed session transitions**

- `prepare_save_thumbnail` accepts only closed Manual Save or Acquisition
  Acknowledgement intent. Under brief session access it resolves the current
  generation/revision and exact pending event/next revision into internal
  `ThumbnailCapturePurpose`; it rejects event drift and never trusts counters
  from IPC.
- During application setup, resolve and validate the app-data root, attempt
  `ensure_save_layout`, and retain production creation/permission failures as
  global discovery/persistence unavailability instead of aborting the title
  UI. An unsafe E2E override remains startup-fatal.
- `list_saves` performs the in-game browser-opening flush before discovery, but still returns the separately discovered browser, Rust-selected `continueCandidate`, plus `flushFailed` preflight when that flush fails. Retry calls it again; Manual Save never bypasses; in-game Load may show the returned browser only after the second data-loss confirmation and carries that exact token into `load_save_discarding_current`.
- `save_manual` flushes, validates name/slot/observed occupancy/ticket, captures the immutable checkpoint, writes a new checkpoint, and never adopts the manual slot. Saving the same durable revision to multiple manual slots produces distinct save IDs, timestamps, and thumbnail attempts without advancing the revision.
- `load_save` accepts the selected typed slot plus browser-observed `saveId`.
  It completes the required flush first with no `G`/`S`, then re-reads the
  selected checkpoint, verifies the observed ID, and builds the candidate
  outside `G`/`S` before installation under `G → S`. Never build a candidate
  and then let a flush replace its source slot.
- `load_save_discarding_current` validates/consumes its matching challenge
  instead of flushing, then re-reads and builds the selected candidate before
  `G → S` installation.
- `continue_game` rediscovers/selects after any required current-session flush,
  then builds exactly that newest candidate outside `G`/`S`; title use has no
  installed session to flush.
- `return_to_title` flushes, then clears engine under `G → S` and returns fresh disk discovery.
- `return_to_title_without_saving` validates its matching challenge before clearing.
- `start_game` uses normal save availability; `start_game_without_saving` requires the matching global-discovery failure challenge.
- When `start_game`, Return to Title, in-game Load, or acknowledgement first
  fails at a bypass-eligible durability boundary, its `GameError` carries only
  the opaque `failureToken`; all challenge bindings stay in Rust.
- `delete_save` uses the exact typed slot plus `OccupiedSlotExpectation`.
  Rust re-reads the fixed slot and matches a canonical save ID when available;
  otherwise it requires the file to remain unparseable and its mtime to match.
  This keeps invalid files deletable without deriving any sidecar path from
  corrupt bytes or deleting a checkpoint replaced after confirmation.

Every post-delete/return discovery recomputes `continueCandidate` and returns
`preflight: ready`; callers never retain a candidate for a slot that was just
deleted or replaced.

- [ ] **Step 4: Implement raw-byte thumbnail IPC**

For `submit_save_thumbnail`, accept the raw request body and read only `x-lyra-thumbnail-ticket`; reject missing/duplicate/invalid headers before passing bytes to the coordinator. For `read_save_thumbnail`, accept JSON typed slot plus observed save ID and return `tauri::ipc::Response::new(bytes)` with PNG content type metadata where supported.

Frontend invocation contract to pin in comments/tests:

```ts
await invoke("submit_save_thumbnail", pngBytes, {
  headers: { "x-lyra-thumbnail-ticket": ticket },
});
```

No JSON array of byte values and no filesystem URL is permitted.

- [ ] **Step 5: Emit complete status events**

Bind coordinator subscriptions to:

- `persistence-status-changed`;
- `thumbnail-activity-changed`;

Each event payload is the complete current view. `get_persistence_status` and
`get_thumbnail_activity` return the same snapshots for startup/recovery. Task
11 adds the corresponding complete exit getter/event.

- [ ] **Step 6: Mirror the wire contract in the development HTTP bridge**

Keep current JSON command routing, but make mutating responses use `GameplayCommandResultView`. Add:

- raw `POST /command/submit_save_thumbnail` with the same ticket header;
- binary response for `read_save_thumbnail`;
- byte-oriented response writing (`&[u8]`, exact `Content-Length`) rather than
  routing PNGs through the current UTF-8 `&str` writer;
- CORS preflight/response allowance for exactly `Content-Type` and
  `X-Lyra-Thumbnail-Ticket`, with duplicate/missing ticket headers rejected by
  the same closed parser as Tauri;
- identical typed error JSON/codes;
- status/save/session commands from the Tauri list.

Add example tests proving Tauri and HTTP serialize the same wrapper and save
views. Task 11 extends the same router/serialization adapter with the four exit
commands rather than adding a transport-specific lifecycle dialect.

- [ ] **Step 7: Run and commit the application surface**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml application_command_contract
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml --example dev_engine_server
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save
```

Expected: every Task 10-owned command is registered, typed wrappers match
across transports, and raw bytes never become JSON arrays. The four explicitly
deferred exit commands remain a Task 11 compile/test obligation.

Commit:

```bash
rtk git add apps/game/src-tauri/src/lib.rs apps/game/src-tauri/examples/dev_engine_server.rs apps/game/src-tauri/src/game/save/coordinator.rs apps/game/src-tauri/src/game/save/storage.rs apps/game/src-tauri/src/game/save/restore.rs apps/game/src-tauri/src/game/save/schema.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/error.rs apps/game/src-tauri/Cargo.toml apps/game/src-tauri/Cargo.lock
rtk git commit -m "feat: expose typed persistence commands"
```

---

### Task 11: Intercept native close and quit until persistence resolves

**Files:**

- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/examples/dev_engine_server.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`

**Interfaces:**

- Consumes: Tauri `WindowEvent`/`RunEvent`, Task 9 flush/failure challenges, and the application AppHandle.
- Produces: complete exit status plus deduplicated flush-before-exit behavior.

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ExitStatusView {
    Idle,
    Saving,
    Failed {
        diagnostic: SaveDiagnosticView,
        failure_token: PersistenceFailureTokenView,
    },
}

pub(crate) trait ApplicationExit: Send + Sync {
    fn exit(&self, code: i32);
}

impl SaveCoordinator {
    pub(crate) fn request_exit_flush(
        &self,
        exit: Arc<dyn ApplicationExit>,
        source: ExitRequestSource,
    );

    pub(crate) fn retry_exit(
        &self,
        exit: Arc<dyn ApplicationExit>,
        token: PersistenceFailureTokenView,
    ) -> Result<(), GameError>;

    pub(crate) fn cancel_exit(
        &self,
        token: PersistenceFailureTokenView,
    ) -> Result<ExitStatusView, GameError>;

    pub(crate) fn exit_without_saving(
        &self,
        exit: Arc<dyn ApplicationExit>,
        token: PersistenceFailureTokenView,
    ) -> Result<(), GameError>;
}
```

The Tauri adapter wraps `AppHandle::exit`; the development HTTP adapter records
the same typed exit request through an injected test/dev driver instead of
terminating the test process. The coordinator depends only on
`ApplicationExit`, keeping lifecycle state/failure-token behavior transport
identical and unit-testable.

- [ ] **Step 1: Write lifecycle state-machine tests**

Cover:

- `WindowEvent::CloseRequested` calls `prevent_close`;
- user-originated `RunEvent::ExitRequested` calls `prevent_exit`;
- repeated close/quit requests deduplicate into one `ExitFlushRequested`;
- debounce is superseded into an immediate exit flush;
- an active writer is awaited without locks;
- acknowledgement finishes before exit flush;
- successful/no-op flush sets one programmatic-exit bypass and calls `AppHandle::exit(0)`;
- failure keeps process/window alive and publishes `ExitStatusView::Failed`;
- Cancel returns Idle without exiting;
- only a matching confirmed `exit_without_saving` consumes the one-shot bypass;
- stale/wrong/reused tokens are rejected.
- Tauri and development HTTP exit commands serialize identical status/error
  payloads through their respective `ApplicationExit` adapters.

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml exit_lifecycle
```

Expected: FAIL because `run()` does not intercept close/exit events and no exit state exists.

- [ ] **Step 2: Convert `run()` to an event-aware Tauri loop**

Retain the existing builder/plugins/managed state/invoke handler, then use the Tauri run callback to handle:

- main-window `CloseRequested`;
- user `ExitRequested`;
- programmatic `ExitRequested` while the one-shot bypass is armed.

Prevent and schedule only user requests. Consume the bypass exactly once to avoid recursively scheduling another flush. Forced kill, crash, power loss, and OS termination that does not deliver these events remain outside scope.

- [ ] **Step 3: Keep the application responsive but inert**

While `ExitStatusView::Saving`:

- state/session commands return `persistenceOperationInProgress`;
- the current rendered view remains available to the frontend store;
- repeated native requests do not create additional writes;
- status events drive the overlay rather than polling `get_state`.

- [ ] **Step 4: Register the deferred exit transport surface**

Add `get_exit_status`, `retry_exit`, `cancel_exit`, and
`exit_without_saving` exactly once to both the Tauri handler and development
HTTP router. Bind `exit-status-changed` as a complete event payload and use
the same `ExitStatusView` serialization fixture in both transports.

- [ ] **Step 5: Run and commit native lifecycle**

Run:

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml exit_lifecycle
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml --example dev_engine_server
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: native lifecycle tests and the full Rust suite pass.

Commit:

```bash
rtk git add apps/game/src-tauri/src/lib.rs apps/game/src-tauri/examples/dev_engine_server.rs apps/game/src-tauri/src/game/save/coordinator.rs apps/game/src-tauri/src/game/save/schema.rs apps/game/src-tauri/src/game/error.rs
rtk git commit -m "feat: flush saves before native exit"
```

---

### Task 12: Mirror persistence types, unwrap command results, and replace inventory-diff acquisition UI

**Files:**

- Create: `apps/game/src/lib/persistence/types.ts`
- Create: `apps/game/src/lib/persistence/commands.ts`
- Create: `apps/game/src/lib/persistence/persistence-store.svelte.ts`
- Create: `apps/game/src/lib/persistence/persistence-store.test.ts`
- Create: `apps/game/src/lib/persistence/thumbnail-capture.ts`
- Modify: `apps/game/src/lib/state/types.ts`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`
- Delete: `apps/game/src/lib/state/acquisition-notifications.ts`
- Delete: `apps/game/src/lib/state/acquisition-notifications.test.ts`
- Modify: `apps/game/src/lib/state/acquisition-controller.svelte.ts`
- Modify: `apps/game/src/lib/state/acquisition-controller.test.ts`
- Modify: `apps/game/src/lib/components/AcquisitionPopup.svelte`
- Modify: `apps/game/src/lib/components/AcquisitionPopup.test.ts`

**Interfaces:**

- Consumes: Task 10 IPC responses/events, current game client dispatch seams, and Rust-provided pending acquisition state.
- Produces: exact TS mirrors, raw-byte helpers, complete stores, and an awaited Rust-event-backed popup controller.

```ts
export type GameplayCommandResultView = {
  state: GameStateView;
  thumbnailCapture: ThumbnailCaptureRequestView | null;
};

export type PersistenceFailureTokenView = string;

export type GameError = {
  code: string;
  message: string;
  failureToken?: PersistenceFailureTokenView;
};

export type GameplayThumbnailCaptureResult =
  | { type: "available"; bytes: Uint8Array }
  | { type: "unavailable"; reason: string };

export interface GameplayThumbnailCapture {
  capture(request: ThumbnailCaptureRequestView): Promise<GameplayThumbnailCaptureResult>;
}

export type AcquisitionAcknowledgementPhase =
  | { type: "idle" }
  | { type: "preparing" }
  | { type: "capturing" }
  | { type: "saving"; slow: boolean }
  | {
      type: "failed";
      diagnostic: GameError;
      failureToken: PersistenceFailureTokenView | null;
    };
```

- `persistence/types.ts` mirrors `SaveSlotRef`, `SaveBrowserOpenResultView`/preflight, all save-browser/status/diagnostic types, `PersistenceHealthView`, `ThumbnailActivityView`, `ExitStatusView`, capture purpose/ticket, and failure-token types exactly in lower-camel wire form.
- `persistence/commands.ts` is the only frontend module that knows raw thumbnail request/response transport. It also exports one structural `asGameError`/`invokePersistenceCommand` boundary that preserves `code`, `message`, and the optional opaque `failureToken`; specialized recovery flows must not reduce actionable failures to message strings.
- Move/re-export the existing frontend `GameError` alias through
  `persistence/types.ts`; do not leave a second `{ code, message }` definition
  in `state/types.ts`.

- [ ] **Step 1: Write exact TypeScript contract fixtures**

Add compile-time `satisfies` fixtures for:

- valid/invalid/empty slots;
- global discovery unavailable;
- complete health/activity/exit states;
- an opaque failure-token string with no frontend operation/generation/revision fields;
- actionable `GameError` fixtures with an optional opaque `failureToken` and no
  generic context/data bag;
- mutating command wrapper;
- pending evidence and statement acquisition presentation.

Use source-contract assertions to forbid `snake_case`, filesystem path fields, thumbnail object IDs, and boolean bypass arguments.

- [ ] **Step 2: Write failing dispatch-boundary tests**

Mock `runCommand` so both `dispatchGameCommand` and `dispatchStateCommand` receive:

```ts
{
  state: nextState,
  thumbnailCapture: { ticket: "ticket", timeoutMs: 725 },
}
```

Assert each boundary:

1. stores only `.state` in `gameState.value`;
2. runs existing audio/SFX effects against `.state`;
3. schedules capture only after Svelte applies the state;
4. never treats the wrapper as a bare `GameStateView`;
5. discards a capture result that returns after the session/revision has changed;
6. leaves read-only commands bare.

Run:

```bash
rtk bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected: FAIL because both boundaries currently call `runCommand<GameStateView>`.

- [ ] **Step 3: Implement wrapper handling in one shared helper**

Create an internal `applyGameplayCommandResult` used by both dispatch boundaries. Await `tick()` before invoking the injected `GameplayThumbnailCapture`, then submit either raw PNG bytes or terminal failure. Capture errors must be converted to `report_save_thumbnail_failure` and must not reject the already-committed gameplay dispatch.

At receipt, translate `timeoutMs` once into `performance.now() + timeoutMs` and pass that fixed local deadline through render/font/image/crossfade waits; no frontend retry or phase may reset it.

Keep gameplay SFX inventory-diff inference if it is still needed for sound; remove inventory-diff inference only as the source of acquisition popup identity/state.

Keep the current global banner behavior for ordinary gameplay commands, but
route persistence workflows through `invokePersistenceCommand` so their local
Retry/Cancel controllers receive the structured error and exact token. Add a
test proving `normalizeError` still renders `.message` without destroying the
original typed error used by the owning workflow.

- [ ] **Step 4: Implement raw-byte command helpers**

Pin:

```ts
export async function submitSaveThumbnail(
  ticket: string,
  bytes: Uint8Array,
): Promise<ThumbnailActivityView>;

export async function readSaveThumbnail(
  reference: SaveSlotRef,
  observedSaveId: string,
): Promise<Uint8Array>;
```

`submitSaveThumbnail` uses the raw body plus `x-lyra-thumbnail-ticket`. `readSaveThumbnail` accepts only slot/save ID and verifies the returned value is an `ArrayBuffer`/`Uint8Array`; no helper constructs a path or URL.

- [ ] **Step 5: Build complete event-backed stores**

On startup, call all three getters, then subscribe to:

- `persistence-status-changed`;
- `thumbnail-activity-changed`;
- `exit-status-changed`.

Replace each store value wholesale per event. Provide one teardown that unlistens all handlers. Missed/duplicate payloads must not require reducer history.

- [ ] **Step 6: Replace the acquisition controller**

Delete the module-level acquisition buffer and inventory-diff notification types. Derive the visible event from `gameState.value.pendingAcquisition`; retain only acknowledgement workflow phase and exact expected event ID locally.

The single dismiss handler must:

1. call `prepare_save_thumbnail({ type: "acquisitionAcknowledgement", eventId })`;
2. keep the popup visible and gameplay root underneath it;
3. capture/submit or report failure;
4. invoke `acknowledge_acquisition_event` exactly once with event/ticket;
5. close only after committed state no longer contains that event.

Use fake timers to assert `儲存中…` immediately and `仍在儲存，請稍候…` after 2,000 ms. Disable dismissal throughout. Log one local slow-operation warning at the threshold; do not add polling or telemetry.

- [ ] **Step 7: Implement typed Retry/Cancel/Continue Without Saving**

On write failure:

- Retry starts a fresh prepare/capture/acknowledge attempt;
- Cancel remains on the same Rust event;
- only a second confirmed `confirm_acquisition_without_saving` with its exact failure token permits local closure;
- the warning explains that the acknowledgement may reappear after restart.

- [ ] **Step 8: Handle expected transient `get_state` rejection narrowly**

When and only when:

- acquisition phase is `saving`; or
- `ExitStatusView.type === "saving"`,

swallow `persistenceOperationInProgress`, retain current state/audio, and leave the global error banner untouched. Do not retry until the owning operation becomes terminal. The same code outside those local intervals, and every other error code, remains visible.

- [ ] **Step 9: Run and commit the frontend transport slice**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/state/game-client-source.test.ts src/lib/state/acquisition-controller.test.ts src/lib/components/AcquisitionPopup.test.ts src/lib/persistence/persistence-store.test.ts
rtk bun run check
```

Expected: both dispatch seams unwrap correctly, status events replace state, and acquisition acknowledgement is Rust-event-backed and awaited.

Commit:

```bash
rtk git add apps/game/src/lib/persistence/types.ts apps/game/src/lib/persistence/commands.ts apps/game/src/lib/persistence/persistence-store.svelte.ts apps/game/src/lib/persistence/persistence-store.test.ts apps/game/src/lib/persistence/thumbnail-capture.ts apps/game/src/lib/state/types.ts apps/game/src/lib/state/game-client.svelte.ts apps/game/src/lib/state/game-client-source.test.ts apps/game/src/lib/state/acquisition-notifications.ts apps/game/src/lib/state/acquisition-notifications.test.ts apps/game/src/lib/state/acquisition-controller.svelte.ts apps/game/src/lib/state/acquisition-controller.test.ts apps/game/src/lib/components/AcquisitionPopup.svelte apps/game/src/lib/components/AcquisitionPopup.test.ts
rtk git commit -m "feat: connect persistence client state"
```

---

### Task 13: Prove gameplay-root capture in the packaged Tauri WebView

**Gate:** Complete and review this task before implementing Tasks 14–17. If the proof fails the approved visual contract, stop and revise the design behind `GameplayThumbnailCapture`; do not continue by making every thumbnail unavailable.

**Files:**

- Modify: `apps/game/package.json`
- Modify: `bun.lock`
- Modify: `apps/game/src/lib/persistence/thumbnail-capture.ts`
- Create: `apps/game/src/lib/persistence/thumbnail-capture.test.ts`
- Modify: `apps/game/src/lib/components/CrossfadeImage.svelte`
- Modify: `apps/game/src/lib/components/CrossfadeImage.test.ts`
- Modify: `apps/game/src/lib/test-harnesses/CrossfadeImageHarness.svelte`
- Create: `apps/game/src/lib/test-harnesses/PackagedCaptureProofProbe.svelte`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/routes/page-source.test.ts`
- Create: `apps/game/e2e-tauri/hpa-392-capture-proof.e2e.ts`
- Create: `apps/game/scripts/hpa-392-e2e-paths.mjs`
- Create: `apps/game/scripts/hpa-392-e2e-paths.test.mjs`
- Create: `apps/game/scripts/run-hpa-392-e2e.mjs`
- Modify: `apps/game/e2e-tauri/helpers.ts`
- Modify: `apps/game/e2e-tauri/production-anchors.ts`
- Modify: `apps/game/scripts/build-e2e.mjs`
- Modify: `apps/game/src-tauri/tauri.conf.json` only if the proof requires a narrowly justified CSP adjustment
- Modify: `apps/game/src-tauri/capabilities/default.json` only if the proof requires a narrowly justified capability
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Task 12 capture interface/tickets, the real rendered gameplay root, CrossfadeImage state, and packaged asset/font URLs.
- Produces: bounded PNG bytes and a reviewed packaged proof artifact.

```ts
export const SAVE_THUMBNAIL_MAX_WIDTH = 480;
export const SAVE_THUMBNAIL_MAX_HEIGHT = 360;

export function fitWithoutUpscaling(
  width: number,
  height: number,
): { width: number; height: number; scale: number };

export function createHtmlToImageGameplayCapture(input: {
  root: () => HTMLElement | null;
  now: () => number;
}): GameplayThumbnailCapture;
```

- Mark the gameplay capture root with `data-save-thumbnail-root`. Menus, dialogs, popups, warnings, and proof controls are siblings or descendants marked `data-save-thumbnail-exclude`.
- Crossfade layers expose cloned-tree-only decision metadata:

```text
data-save-crossfade-layer
data-save-crossfade-request
data-save-crossfade-order
data-save-crossfade-state="pending|visible|leaving"
```

`CrossfadeImage` also consumes inherited capture-only CSS custom properties
for opacity/transition with fallbacks to its live values. The live gameplay
root never defines those properties. The `html-to-image` `style` option sets
them only on the library's cloned root, while `filter` retains only the
precomputed winner; this uses the library's supported clone styling/filtering
surface and does not require mutating the live tree or an unsupported clone
callback.

- [ ] **Step 1: Add `html-to-image` and write pure sizing tests**

Use:

```ts
scale = Math.min(1, 480 / sourceWidth, 360 / sourceHeight);
width = Math.max(1, Math.round(sourceWidth * scale));
height = Math.max(1, Math.round(sourceHeight * scale));
```

Cover landscape, portrait, exact 480×360, tiny inputs, and non-integer ratios. Assert uniform scale, no crop/pad/stretch, and no upscaling.

Run:

```bash
rtk bun run --cwd apps/game test src/lib/persistence/thumbnail-capture.test.ts
```

Expected: FAIL because the `html-to-image` adapter and fitting helper do not exist.

- [ ] **Step 2: Mark the real gameplay boundary**

Place one stable `data-save-thumbnail-root` around the rendered game scene, dialogue, and gameplay HUD. Keep Escape menu, acquisition popup, save dialogs, error banners, exit overlay, and E2E proof controls outside it or filtered. Add source tests proving exactly one root and the required exclusions.

- [ ] **Step 3: Add explicit crossfade capture metadata**

Expose current request identity, load state, order, and leaving state on each image layer without changing live animation. Tests cover:

- loaded current-request layer;
- prior visible layer while current is pending;
- leaving old layer after current loads;
- rapid A→B→C requests;
- duplicate load/error events.

Pin CSS tests showing the capture-only inherited variables are absent on the
live root, preserve the live 1,500 ms transition by fallback, and force the
single filtered clone winner to opacity 1 with no transition.

- [ ] **Step 4: Implement cloned-tree normalization**

After `tick()` and within the ticket's remaining deadline:

1. wait for `document.fonts.ready`;
2. wait for only currently referenced `<img>` elements under the root to load/decode;
3. if the current requested crossfade layer remains pending, wait only the remaining ticket budget, then return unavailable;
4. in the cloned capture tree, remove leaving layers and all non-winning layers;
5. select the newest loaded, non-leaving layer matching the current request;
6. force the winner to final opacity and disable transitions/animations in the clone;
7. never substitute a stale prior layer.

Measure the rendered root once as `sourceWidth × sourceHeight`. Call `toBlob`
with:

```ts
{
  width: sourceWidth,
  height: sourceHeight,
  canvasWidth: fitted.width,
  canvasHeight: fitted.height,
  pixelRatio: 1,
  filter,
  style: captureOnlyRootStyle,
}
```

The source dimensions preserve layout; only `canvasWidth`/`canvasHeight`
uniformly scale output. Include the root-descendant filter plus the
capture-only crossfade variables and embedded fonts/images. Do not set fitted
dimensions as clone layout dimensions, and do not wait for the 1,500 ms live
transition.

- [ ] **Step 5: Unit-test timeout and capture failures**

Mock `toBlob`, `document.fonts`, image decode, and monotonic time. Cover:

- fonts/images ready within budget;
- current image pending until deadline;
- `toBlob` returns null;
- image decode rejects;
- ticket already expired;
- excluded descendants omitted;
- live DOM styles unchanged;
- returned Blob converted to PNG `Uint8Array`.

- [ ] **Step 6: Add the packaged-only proof probe**

`build-e2e.mjs` sets `VITE_LYRA_E2E_CAPTURE_PROOF=1` only for the debug E2E bundle. Under that compile-time flag, render `PackagedCaptureProofProbe.svelte`, which:

- can request/list the newest autosave through normal typed commands;
- reads its thumbnail through `read_save_thumbnail`;
- displays the returned Blob URL beside non-captured proof controls;
- exposes one closed, one-shot `force next capture unavailable` control that
  makes the injected E2E `GameplayThumbnailCapture` return the normal typed
  unavailable result before delegating to `html-to-image`;
- exposes only stable data attributes for WDIO assertions;
- revokes the Blob URL on replacement/unmount.

Production builds must tree-shake the probe and one-shot wrapper and must not
expose a general debug command bridge, arbitrary DOM mutation, or Rust storage
control.

- [ ] **Step 7: Add the guarded capture-proof launcher**

First write `node:test` cases for an absolute generated `lyra-hpa-392-` child of the OS temp directory and refusal of missing/relative/temp-root/home/production/wrong-prefix/symlink-escape paths.

Run:

```bash
rtk node --test apps/game/scripts/hpa-392-e2e-paths.test.mjs
```

Expected: FAIL because the path helper does not exist.

Implement the helper, revalidation-before-cleanup, and `run-hpa-392-e2e.mjs --capture-proof`, which launches one WDIO process with the validated path in `LYRA_E2E_APP_DATA_DIR`.

Add:

```json
{
  "test:e2e:capture-proof": "node scripts/build-e2e.mjs && node scripts/run-hpa-392-e2e.mjs --capture-proof"
}
```

Add `apps/game/e2e-artifacts/` to the root `.gitignore` before running the
packaged proof; screenshots/logs are review evidence, not source artifacts.

Run again:

```bash
rtk node --test apps/game/scripts/hpa-392-e2e-paths.test.mjs
```

Expected: PASS before any packaged process starts.

- [ ] **Step 8: Run the real packaged proof**

Drive production chapter content to frames containing:

- Lyra background assets;
- a portrait during a crossfade;
- embedded Traditional Chinese font/dialogue;
- gradients;
- clipped/overflow UI.

Trigger an autosave while the newest requested portrait is loaded but the old layer is still leaving. Display the saved PNG through the proof probe and assert:

- intrinsic dimensions are nonzero and at most 480×360;
- the gameplay-root aspect ratio is preserved;
- menu/probe/acquisition overlays are absent;
- the newest non-leaving portrait is present and the leaving layer is absent;
- dialogue glyph pixels, gradients, and clipped edges are nontransparent/present at sampled regions;
- the saved image remains the same after the live transition ends.

Run:

```bash
rtk bun run --cwd apps/game test:e2e:capture-proof
```

Expected: PASS in the packaged Tauri WebView using packaged asset URLs, an
isolated guarded app-data directory, and the real capability/CSP policy. Save
the WDIO screenshot under `apps/game/e2e-artifacts/hpa-392/` for human gate
review.

- [ ] **Step 9: Record the gate decision and commit only on success**

If no policy change is needed, assert `tauri.conf.json` and `capabilities/default.json` remain unchanged. If one is needed, keep the change to the minimum proven directive/permission and rerun the packaged proof.

Commit:

```bash
rtk git add apps/game/package.json bun.lock apps/game/src/lib/persistence/thumbnail-capture.ts apps/game/src/lib/persistence/thumbnail-capture.test.ts apps/game/src/lib/components/CrossfadeImage.svelte apps/game/src/lib/components/CrossfadeImage.test.ts apps/game/src/lib/test-harnesses/CrossfadeImageHarness.svelte apps/game/src/lib/test-harnesses/PackagedCaptureProofProbe.svelte apps/game/src/routes/+page.svelte apps/game/src/routes/page-source.test.ts apps/game/e2e-tauri/hpa-392-capture-proof.e2e.ts apps/game/e2e-tauri/helpers.ts apps/game/e2e-tauri/production-anchors.ts apps/game/scripts/build-e2e.mjs apps/game/scripts/hpa-392-e2e-paths.mjs apps/game/scripts/hpa-392-e2e-paths.test.mjs apps/game/scripts/run-hpa-392-e2e.mjs apps/game/src-tauri/tauri.conf.json apps/game/src-tauri/capabilities/default.json .gitignore
rtk git commit -m "feat: capture packaged gameplay thumbnails"
```

---

### Task 14: Build the shared save browser, cards, name prompt, and confirmations

**Files:**

- Create: `apps/game/src/lib/persistence/manual-name.ts`
- Create: `apps/game/src/lib/persistence/manual-name.test.ts`
- Create: `apps/game/src/lib/persistence/save-browser-controller.svelte.ts`
- Create: `apps/game/src/lib/persistence/save-browser-controller.test.ts`
- Create: `apps/game/src/lib/components/SaveBrowser.svelte`
- Create: `apps/game/src/lib/components/SaveBrowser.test.ts`
- Create: `apps/game/src/lib/components/SaveCard.svelte`
- Create: `apps/game/src/lib/components/SaveCard.test.ts`
- Create: `apps/game/src/lib/components/SaveNameDialog.svelte`
- Create: `apps/game/src/lib/components/SaveNameDialog.test.ts`
- Create: `apps/game/src/lib/components/SaveConfirmationDialog.svelte`
- Create: `apps/game/src/lib/components/SaveConfirmationDialog.test.ts`

**Interfaces:**

- Consumes: Task 7/10 save views and commands, Task 12 stores/raw thumbnail reads, and Task 13 proven capture behavior.
- Produces: one reusable browser/card/dialog workflow for all title and in-game modes.

```ts
export type SaveBrowserMode = "titleLoad" | "gameLoad" | "manualSave";

export type SaveBrowserController = {
  readonly mode: SaveBrowserMode;
  readonly continueCandidate: SaveSlotRef | null;
  readonly selected: SaveSlotRef | null;
  readonly layer: "browser" | "name" | "confirmation";
  select(reference: SaveSlotRef): void;
  back(): void;
  close(): void;
};

export function validateManualDisplayName(input: string):
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "tooLong" | "forbidden" };

export function suggestManualDisplayName(
  chapterTitle: string,
  sceneTitle: string,
): string;
```

- [ ] **Step 1: Mirror Rust grapheme validation**

Reject `\p{Cc}`/U+2028/U+2029 against the raw input first, including leading
and trailing occurrences. Then trim only the Unicode `White_Space` property
with a `\p{White_Space}` regular expression and use
`Intl.Segmenter("zh-Hant", { granularity: "grapheme" })`. Match Rust for 1–40
clusters, preserve accepted Unicode/internal spacing, and share Task 2's
combining-mark, emoji-sequence, and boundary-forbidden cases.

Run:

```bash
rtk bun run --cwd apps/game test src/lib/persistence/manual-name.test.ts
```

Expected: FAIL because the mirrored validator does not exist.

- [ ] **Step 2: Write SaveCard state and lazy-image tests**

Cover:

- empty, valid, and invalid slot presentation;
- independently readable invalid metadata;
- autosave/manual labels;
- chapter, scene, objective/no-objective, and localized date;
- `無法顯示預覽` for unavailable/missing/corrupt/read-failed images;
- intrinsic ratio with CSS `object-fit: contain`;
- card chrome supplies any letterboxing;
- lazy read uses slot plus observed save ID;
- stale reads cannot replace a newer card;
- every Blob URL is revoked on change/unmount;
- browser image decode failure revokes the failed URL and switches to `無法顯示預覽`;
- no filesystem URL/path construction.

- [ ] **Step 3: Implement the shared browser**

Load mode renders:

- five autosave positions;
- newest visual marker from the Rust-provided `continueCandidate`;
- helper copy `自動存檔已滿時，將自動取代最舊的存檔。`;
- three manual positions.

Manual Save mode renders only three manual positions. Global discovery loading/unavailable is a browser-level state; do not fabricate slot failures.

An incompatible or snapshot-corrupt slot renders its diagnostic before any Load action. Invalid entries remain selectable for details and confirmed deletion while their Load control stays disabled.

- [ ] **Step 4: Implement the name prompt**

An empty manual slot uses `suggestManualDisplayName` over the current Rust-provided chapter/scene titles. An occupied slot uses its independently readable currently valid name or that suggestion. Pin the same 39-graphemes-plus-`…` shortening cases as Rust. Frontend validation blocks submission, but command payload retains the untrusted input for Rust revalidation.

- [ ] **Step 5: Implement stale-safe confirmation**

Manual overwrite confirmation shows old slot metadata/thumbnail and current-game metadata and sends `OccupiedSlotExpectation` from the observed save ID plus slot `modifiedAt`; invalid occupied slots therefore remain overwriteable after confirmation. Deletion sends the same closed observation. In-game Load confirmation is required; title Load starts directly after selecting a valid slot.

- [ ] **Step 6: Implement browser layer/back focus behavior**

Controller stack:

```text
confirmation → name → browser → caller
```

Each transition records/restores the element that opened the next layer. Tests use keyboard navigation and Escape, and assert focus never falls behind a modal.

- [ ] **Step 7: Run and commit shared components**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/persistence/manual-name.test.ts src/lib/persistence/save-browser-controller.test.ts src/lib/components/SaveCard.test.ts src/lib/components/SaveBrowser.test.ts src/lib/components/SaveNameDialog.test.ts src/lib/components/SaveConfirmationDialog.test.ts
rtk bun run check
```

Expected: all modes share one slot renderer and satisfy lazy thumbnail, focus, and stale-confirmation contracts.

Commit:

```bash
rtk git add apps/game/src/lib/persistence/manual-name.ts apps/game/src/lib/persistence/manual-name.test.ts apps/game/src/lib/persistence/save-browser-controller.svelte.ts apps/game/src/lib/persistence/save-browser-controller.test.ts apps/game/src/lib/components/SaveBrowser.svelte apps/game/src/lib/components/SaveBrowser.test.ts apps/game/src/lib/components/SaveCard.svelte apps/game/src/lib/components/SaveCard.test.ts apps/game/src/lib/components/SaveNameDialog.svelte apps/game/src/lib/components/SaveNameDialog.test.ts apps/game/src/lib/components/SaveConfirmationDialog.svelte apps/game/src/lib/components/SaveConfirmationDialog.test.ts
rtk git commit -m "feat: add shared save browser"
```

---

### Task 15: Wire title, Escape menu, load reset, recovery, and canonical copy

**Files:**

- Modify: `apps/game/src/lib/components/MainMenu.svelte`
- Modify: `apps/game/src/lib/components/MainMenu.test.ts`
- Modify: `apps/game/src/lib/components/GameShell.svelte`
- Modify: `apps/game/src/lib/components/GameShell.test.ts`
- Modify: `apps/game/src/lib/test-harnesses/GameShellHarness.svelte`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/persistence/persistence-store.svelte.ts`
- Modify: `apps/game/src/lib/persistence/save-browser-controller.svelte.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/routes/page.test.ts`
- Modify: `apps/game/src/routes/page-source.test.ts`

**Interfaces:**

- Consumes: the shared Task 14 browser, Task 12 persistence/exit stores, Task 10 typed commands, and current MainMenu/GameShell focus/input contracts.
- Produces: title Continue/Load/New, in-game Save/Load/Return, post-load presentation reset, degraded recovery, and localized native-exit overlays.

**Canonical player copy:**

| Semantic action/status | Required Traditional Chinese |
| --- | --- |
| Continue | `繼續遊戲` |
| Load Game | `載入遊戲` |
| New Game | `開始新遊戲` |
| Save Game | `儲存遊戲` |
| Return to Title | `返回標題畫面` |
| Autosave / Manual Save | `自動存檔` / `手動存檔` |
| Saving / Still saving | `儲存中…` / `仍在儲存，請稍候…` |
| Preview unavailable | `無法顯示預覽` |
| Play Without Saving | `不儲存並開始遊戲` |
| Load and discard current progress | `捨棄未儲存進度並載入` |
| Continue without saving | `不儲存並繼續` |
| Exit without saving | `不儲存並結束遊戲` |
| Retry / Cancel | `重試` / `取消` |

- [ ] **Step 1: Write title discovery/enablement tests**

Assert:

- title begins with visible loading state;
- discovery available with eight empty slots disables Continue/Load;
- any nonempty valid or invalid file enables Continue/Load;
- Continue on newest invalid opens its blocking diagnostic; the diagnostic
  action performs a fresh `list_saves` and opens Load with the returned
  Rust-selected `continueCandidate`, never a frontend reimplementation of mtime
  ordering;
- global discovery unavailable disables both and shows Retry;
- New Game starts immediately when persistence is healthy, with no existing-save warning;
- New Game on global failure first blocks, then a second confirmation invokes `start_game_without_saving` with the exact token.

Run:

```bash
rtk bun run --cwd apps/game test src/lib/components/MainMenu.test.ts src/routes/page.test.ts
```

Expected: FAIL because title discovery and save actions are not wired.

- [ ] **Step 2: Add title actions and canonical accessible names**

Order the menu as Continue, Load Game, New Game, then existing remaining entries. Decorative English may remain, but tests and accessible names use the table above.

Retain the complete latest `SaveBrowserOpenResultView` at title. A failed
Continue shows the command's typed diagnostic; its Load action refreshes
discovery and selects `continueCandidate`. If the filesystem changed between
the two calls, the refreshed Rust result is authoritative and the browser
shows that current slot/diagnostic.

- [ ] **Step 3: Extend the root Escape menu**

Add Save Game, Load Game, and Return to Title. Preserve gameplay input isolation while any root/browser/name/confirmation/recovery layer is open. Escape stack is:

```text
confirmation → name → browser → root menu → gameplay
```

Closing each layer restores its opener's focus.

Save Game and Load Game first call `list_saves` while the menu isolates gameplay. Show visible loading rather than relying on elapsed time. Open either browser only after a successful/no-op preflight flush. On `flushFailed`, Manual Save offers only Retry/Cancel; in-game Load offers Retry/Cancel and then the separate confirmed browser-open path using the returned browser/token.

- [ ] **Step 4: Wire Manual Save**

Open shared browser, collect name, show overwrite confirmation when occupied, prepare/capture beneath the menu, and call `save_manual`. Keep menu/dialogs excluded without flicker. A thumbnail-unavailable outcome is still save success; authoritative save failure stays blocking.

- [ ] **Step 5: Wire in-game Load and Return to Title recovery**

In-game Load always confirms. Ordinary calls flush first in Rust. On failure:

1. show Retry/Cancel;
2. only after a second explicit confirmation call `load_save_discarding_current`.

Return to Title follows the same two-stage flow with `return_to_title_without_saving`. Cancel retains gameplay and invalidates the challenge.

On either successful Return path, clear the local `GameStateView` and all
gameplay/transient presentation state, install the returned
`SaveBrowserOpenResultView` as the title discovery snapshot, and focus
`繼續遊戲` when enabled (otherwise `開始新遊戲`). Do not immediately issue a
second discovery request.

- [ ] **Step 6: Reset frontend presentation after load**

After a successful load:

- replace the full `GameStateView`;
- close Escape/browser/name/confirmation/history layers;
- clear pending capture requests and revoke save-card Blob URLs;
- render Rust pending acquisition only after restored dialogue drains;
- reset focus to the active gameplay control;
- resynchronize background/portrait/BGM/BGS from semantic restored cues;
- keep mute/volume preferences;
- restart the exact current dialogue item's frontend animation from its beginning.

- [ ] **Step 7: Render persistence health and exit overlays**

Persistent degraded health remains visible in HUD/system menu until a later successful save/flush clears it. Thumbnail unavailable is a separate nonblocking preview warning.

During exit Saving, keep the current frame visible but inert under `儲存中…`. On Failed, show Retry/Cancel first; closing the dialog is Cancel. Expose `不儲存並結束遊戲` only through the second confirmation and exact exit token.

- [ ] **Step 8: Pin the localized contract**

Add source/render tests for every table entry, confirmations, warnings, and accessible labels. Remove stale `開始調查` where it semantically means New Game; do not use decorative English as the only accessible action name.

- [ ] **Step 9: Run and commit complete UI flows**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/components/MainMenu.test.ts src/lib/components/GameShell.test.ts src/lib/components/SaveBrowser.test.ts src/routes/page.test.ts src/routes/page-source.test.ts
rtk bun run check
```

Expected: title, in-game save/load/title, exit recovery, focus/Escape, and post-load reset pass with canonical copy.

Commit:

```bash
rtk git add apps/game/src/lib/components/MainMenu.svelte apps/game/src/lib/components/MainMenu.test.ts apps/game/src/lib/components/GameShell.svelte apps/game/src/lib/components/GameShell.test.ts apps/game/src/lib/test-harnesses/GameShellHarness.svelte apps/game/src/lib/state/game-client.svelte.ts apps/game/src/lib/persistence/persistence-store.svelte.ts apps/game/src/lib/persistence/save-browser-controller.svelte.ts apps/game/src/routes/+page.svelte apps/game/src/routes/page.test.ts apps/game/src/routes/page-source.test.ts
rtk git commit -m "feat: complete save and load flows"
```

---

### Task 16: Extend the guarded launcher into a multi-process HPA-392 E2E harness

**Files:**

- Modify: `apps/game/scripts/hpa-392-e2e-paths.mjs`
- Modify: `apps/game/scripts/hpa-392-e2e-paths.test.mjs`
- Modify: `apps/game/scripts/run-hpa-392-e2e.mjs`
- Create: `apps/game/e2e-tauri/hpa-392-fixtures.ts`
- Create: `apps/game/src-tauri/src/game/save/e2e_faults.rs`
- Modify: `apps/game/scripts/build-e2e.mjs`
- Modify: `apps/game/wdio.conf.ts`
- Modify: `apps/game/tsconfig.e2e.json`
- Modify: `apps/game/package.json`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: the Task 13 guarded launcher, built E2E binary, fixed test-owned app-data layout, and feature-gated storage fault seam.
- Produces: deterministic phased process execution and safe disk-fixture/failure controls.

```js
export function assertSafeHpa392AppDataDir(input, {
  homeDir,
  tempDir,
  productionAppDataDir,
});

export function createHpa392AppDataDir({ tempDir });
export function removeHpa392AppDataDir(path, safetyContext);
export function readHpa392SlotFiles(appDataDir);
export function corruptHpa392Slot(appDataDir, fixedSlotName);
export function removeHpa392ObservedSidecar(appDataDir, fixedSlotName);
export function buildHpa392PhasePlan({
  mode,
  ordinaryAppDataDir,
  captureProofAppDataDir,
  persistenceAppDataDir,
});
```

```rust
#[cfg(feature = "e2e")]
pub(crate) enum E2ePersistenceFaultBoundary {
    ThumbnailInstall,
    EnvelopeReplace,
    SavesDirectorySync,
    ExitFlush,
}
```

- `--ordinary` wraps the existing non-HPA WDIO suite in its own guarded
  test-owned app-data directory. Seed/resume/management/exit phases share one
  second test-owned persistence app-data directory but launch a fresh
  WDIO/Tauri process for every phase. Capture proof uses a separate test-owned
  directory so its autosave cannot pollute persistence ordering. A browser
  reload is not accepted as process-boundary proof.
- E2E fault control may fail the next named boundary only. It must not accept paths, raw shell commands, arbitrary byte writes, or remain registered in a non-E2E build.

- [ ] **Step 1: Write failing phased-runner tests**

Using `node:test`, cover:

- `--ordinary` yields only the existing non-HPA specs with one canonical
  test-owned path;
- `--capture-proof` yields only the proof spec;
- `--full` yields capture proof, seed, resume, management, and exit phases in that order;
- capture proof receives its own canonical test path and every persistence phase inherits the same second canonical test path;
- a nonzero child stops later phases but still schedules log capture and guarded cleanup;
- an unknown mode/spec or unsafe path is rejected before spawn;
- the already-implemented path refusal/cleanup cases remain green.

Run:

```bash
rtk node --test apps/game/scripts/hpa-392-e2e-paths.test.mjs
```

Expected: FAIL because the runner does not yet build a full phased execution plan.

- [ ] **Step 2: Retain the runner-owned directory lifecycle**

Use `mkdtempSync(join(tmpdir(), "lyra-hpa-392-"))` once for
`--ordinary`, once for `--capture-proof`, or twice for `--full` (one capture
proof root plus one shared persistence root). Pass the appropriate canonical
result as `LYRA_E2E_APP_DATA_DIR` to each WDIO/Tauri child. Revalidate every
root independently in `finally` before cleanup. On failure, copy
WDIO/application logs to `apps/game/e2e-artifacts/hpa-392/` before deleting
only the roots created by that invocation. Preserve the capture-proof
screenshot there on success as well so the mandatory visual gate is available
from CI.

Derive the runner's production comparison path from the platform data
directory plus the fixed `com.chanwaichan.lyra` identifier (matching Rust's
Tauri `data_dir()/PRODUCTION_APP_IDENTIFIER` rule), and unit-test the macOS,
Linux/XDG, and Windows environment mappings. Never substitute the E2E
identifier's default app-data path for this comparison.

- [ ] **Step 3: Add explicit phased WDIO execution**

`run-hpa-392-e2e.mjs`:

1. validates the already-built E2E binary;
2. for `--ordinary`, launches exactly the existing non-HPA specs with one
   guarded path, then cleans that path;
3. launches capture proof for `--capture-proof` and as the first `--full` phase;
4. stops after proof for `--capture-proof`, otherwise launches `hpa-392-save-seed.e2e.ts`;
5. waits for process exit;
6. launches `hpa-392-save-resume.e2e.ts` against the same directory;
7. launches `hpa-392-save-management.e2e.ts` multiple times with closed `LYRA_HPA392_PHASE` values around runner-owned corruption/deletion checkpoints;
8. launches `hpa-392-exit.e2e.ts` multiple times for close seed/resume, quit seed/resume, failure/bypass, and final verification;
9. propagates the first nonzero exit code after artifact capture.

Keep `maxInstances: 1`. Exclude every `hpa-392-*.e2e.ts` file from the
ordinary spec set; exact proof/phase specs run only through the orchestrator.
The raw `wdio run` command is no longer a supported app script because an E2E
build is forbidden to start without a guarded override.

- [ ] **Step 4: Add safe disk-fixture helpers**

The `.mjs` path module owns filesystem mutation so the Node phase runner can use it directly; `hpa-392-fixtures.ts` is a typed WDIO wrapper around the same functions. They may read/copy/corrupt only fixed slot files beneath the already-validated environment root and expose:

- reading eight envelope files;
- resolving a sidecar only after canonical UUID validation;
- deleting/corrupting one selected test sidecar;
- corrupting one selected slot JSON;
- checking no unknown sidecars remain;
- writing test-control expectations outside `saves/`.

Every helper rejects traversal, unexpected filenames, and absent test-root environment state.

- [ ] **Step 5: Add E2E-only fault injection**

Wrap the production filesystem adapter with a one-shot fault layer only under `feature = "e2e"`. Register a typed `e2e_set_persistence_fault` command only in the E2E invoke handler branch. It accepts one closed boundary and occurrence count 1; successful firing clears itself. Add Rust tests proving:

- non-E2E compilation exposes no command or mutable fault state;
- a fault cannot change paths or payloads;
- each boundary fails exactly once;
- stale fault configuration is cleared between app sessions.

- [ ] **Step 6: Add scripts**

In `apps/game/package.json`:

```json
{
  "test:e2e:build": "node scripts/build-e2e.mjs && bun run test:e2e:run && bun run test:e2e:hpa-392:run",
  "test:e2e:run": "node scripts/run-hpa-392-e2e.mjs --ordinary",
  "test:e2e:capture-proof": "node scripts/build-e2e.mjs && node scripts/run-hpa-392-e2e.mjs --capture-proof",
  "test:e2e:hpa-392": "node scripts/build-e2e.mjs && bun run test:e2e:hpa-392:run",
  "test:e2e:hpa-392:run": "node scripts/run-hpa-392-e2e.mjs --full"
}
```

Keep the root `test:e2e` build path. CI therefore builds once, runs the
guarded ordinary specs, then invokes the phased HPA runner. Do not rebuild the
binary between any of those process phases.

Extend the existing non-cancelled E2E artifact upload with
`apps/game/e2e-artifacts/` so proof screenshots, runner phase logs, and
failure diagnostics survive guarded temp-root cleanup.

- [ ] **Step 7: Run and commit the harness**

Run:

```bash
rtk node --test apps/game/scripts/hpa-392-e2e-paths.test.mjs
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml e2e_fault
rtk bun run --cwd apps/game check:e2e
```

Expected: unsafe paths are refused, the fault seam is E2E-only, and all phased specs type-check.

Commit:

```bash
rtk git add apps/game/scripts/hpa-392-e2e-paths.mjs apps/game/scripts/hpa-392-e2e-paths.test.mjs apps/game/scripts/run-hpa-392-e2e.mjs apps/game/scripts/build-e2e.mjs apps/game/e2e-tauri/hpa-392-fixtures.ts apps/game/wdio.conf.ts apps/game/tsconfig.e2e.json apps/game/package.json apps/game/src-tauri/src/game/save/e2e_faults.rs apps/game/src-tauri/src/game/save/mod.rs apps/game/src-tauri/src/game/save/storage.rs apps/game/src-tauri/src/game/save/coordinator.rs apps/game/src-tauri/src/lib.rs .github/workflows/ci.yml
rtk git commit -m "test: add guarded persistence e2e harness"
```

---

### Task 17: Prove save/load behavior across packaged process boundaries

**Files:**

- Create: `apps/game/e2e-tauri/hpa-392-save-seed.e2e.ts`
- Create: `apps/game/e2e-tauri/hpa-392-save-resume.e2e.ts`
- Create: `apps/game/e2e-tauri/hpa-392-save-management.e2e.ts`
- Create: `apps/game/e2e-tauri/hpa-392-exit.e2e.ts`
- Modify: `apps/game/e2e-tauri/helpers.ts`
- Modify: `apps/game/e2e-tauri/production-anchors.ts`
- Modify: `apps/game/e2e-tauri/hpa-392-fixtures.ts`
- Modify: `apps/game/scripts/run-hpa-392-e2e.mjs`

**Interfaces:**

- Consumes: Task 16 phased runner/fixtures, production accessibility anchors, and the complete packaged save/load UI.
- Produces: restart-persistent acceptance evidence for all eleven design §18.6 scenarios.

- Add helper assertions around localized accessible names, slot cards, pending acquisition popup state, save/thumbnail status, and process identity.
- Store expected checkpoint identity in runner-owned test-control data:

```ts
type ExpectedResumeCheckpoint = {
  saveId: string;
  displayName: string;
  chapterId: string;
  sceneId: string;
  queueGen: number;
  cursor: number;
  currentDialogueFingerprint: string;
};
```

The control file is an assertion aid only; the app must reconstruct exclusively from its slot JSON and packaged definitions.

- [ ] **Step 1: Seed and resume a Unicode manual save through a real restart**

Seed process:

1. start New Game;
2. stop on a stable single-segment dialogue item;
3. save manual slot 1 as `雨の証拠 🕵🏽‍♀️ é`;
4. assert card thumbnail is available;
5. record observed checkpoint/token/text;
6. Return to Title;
7. close the process.

Resume process:

1. assert title discovery came from disk;
2. invoke `繼續遊戲`;
3. assert the exact saved dialogue item, queue generation, flattened cursor, chapter/scene, and Unicode name;
4. assert current `saveId` matches the seed checkpoint.

- [ ] **Step 2: Prove composite queue coordinates**

Drive an investigation/interrogation action that installs at least two ordered dialogue segments. Save on a non-first segment and nonzero item cursor, restart, Continue, and assert exact segment/item via unchanged public token/current item. Advancing once must show the expected next authored item without replaying earlier reveals.

- [ ] **Step 3: Prove two acquisition acknowledgements exactly once**

Trigger one command that acquires two records while authored dialogue is active. Assert no popup until dialogue drains. For each Rust event:

- popup stays open through preflight capture and awaited acknowledgement;
- the event ID order is `acq:<same-command>:0`, then ordinal 1;
- acknowledgement checkpoints reuse one autosave slot;
- the saved PNG `objectId/saveId` matches each final envelope;
- no post-command capture deadlocks;
- after both succeed, Return to Title/restart and neither popup reappears.

- [ ] **Step 4: Prove incomplete investigation and interrogation restore**

For investigation, persist sublocation, inspected/discussed/entered sets, override state, active queue, inventory, and cues before completion. For interrogation, persist phase, broken/completed/entered state, testimony content segment, Playing, and Presenting tray state. Restart each and assert the exact public view plus next valid action.

- [ ] **Step 5: Prove five-slot rotation and thumbnail ownership**

Create six distinct autosave recovery points separated beyond debounce. After restart:

- exactly five autosave files/cards remain;
- they are the five newest checkpoints by filesystem mtime;
- each envelope's available descriptor has `objectId === saveId`;
- each referenced PNG exists and hashes to its descriptor;
- no deleted/replaced checkpoint sidecar remains;
- the oldest retained card is older than the other four.

- [ ] **Step 6: Prove manual overwrite semantics**

Select occupied manual slot 1:

- name prompt defaults to its prior Unicode name;
- overwrite does not occur before both name submission and confirmation;
- a stale observed ID is rejected;
- successful overwrite gets a new save ID/timestamp/thumbnail;
- old sidecar is removed;
- another manual slot remains untouched.

- [ ] **Step 7: Prove newest-invalid Continue behavior and explicit recovery**

Between process phases, corrupt the newest fixed JSON. Relaunch:

- Continue selects that file and shows its diagnostic;
- it never skips to an older valid slot;
- opening Load keeps the failed slot selected;
- an older valid save loads manually;
- corrupt source remains on disk until explicit deletion.

- [ ] **Step 8: Prove thumbnails are presentation-only**

Use Task 13's closed one-shot packaged capture-unavailable control once and
assert the authoritative save is valid/loadable with `無法顯示預覽`. In
separate restarts:

- delete a referenced sidecar;
- corrupt its body/digest while retaining a valid header.

Each card falls back deterministically, lazy read fails safely, and load/Continue compatibility remains valid.

- [ ] **Step 9: Prove delete ownership**

Delete one manual save after confirmation. Assert:

- selected JSON disappears first;
- its validated sidecar disappears;
- card becomes empty;
- all other JSON and referenced PNG files are unchanged;
- orphan cleanup leaves every still-referenced sidecar.

- [ ] **Step 10: Prove close and quit flushing**

Commit a mutation, then request main-window close before the 500 ms debounce ends. Assert the process stays alive while Saving, exits only after successful flush, relaunches, and Continues from that checkpoint.

Repeat once with user-originated application quit before debounce completes, and once while acknowledgement is active; acknowledgement completes first in the latter case, then exit flushes.

- [ ] **Step 11: Prove exit failure recovery**

Arm one `ExitFlush` fault, request close, and assert:

- window/process remains alive;
- Retry/Cancel appears;
- Cancel returns to gameplay;
- stale failure token cannot exit;
- a new failed attempt followed by second confirmation and `不儲存並結束遊戲` terminates;
- a later relaunch sees only the last authoritative checkpoint, not unsaved live progress.

- [ ] **Step 12: Run and commit packaged scenarios**

Run:

```bash
rtk bun run --cwd apps/game check:e2e
rtk bun run --cwd apps/game test:e2e:hpa-392
```

Expected: all scenarios pass against the debug packaged Tauri binary and one validated test-owned app-data directory per orchestrated run.

Commit:

```bash
rtk git add apps/game/e2e-tauri/hpa-392-save-seed.e2e.ts apps/game/e2e-tauri/hpa-392-save-resume.e2e.ts apps/game/e2e-tauri/hpa-392-save-management.e2e.ts apps/game/e2e-tauri/hpa-392-exit.e2e.ts apps/game/e2e-tauri/helpers.ts apps/game/e2e-tauri/production-anchors.ts apps/game/e2e-tauri/hpa-392-fixtures.ts apps/game/scripts/run-hpa-392-e2e.mjs
rtk git commit -m "test: cover save persistence end to end"
```

---

### Task 18: Run full gates and audit acceptance coverage

**Files:**

- Modify only files required by failures found during the gates.
- Do not update generated JSON under `apps/game/src-tauri/resources/`.

**Interfaces:**

- Consumes: all Task 1–17 outputs and design §§18–21.
- Produces: a clean, fully verified implementation commit with cross-host identity and packaged-process evidence.

- [ ] **Step 1: Run compiler identity and generation gates**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/semantic-defaults.test.ts packages/scripts/compile-scenes/save-content-references.test.ts packages/scripts/compile-scenes/save-content-manifest.test.ts packages/scripts/compile-scenes/assets/enrich.test.ts
rtk bun run scenes:compile
rtk bun run check:scripts
```

Expected: all pass; repeat compilation preserves the checked-in golden revision.

- [ ] **Step 2: Run all Rust gates**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
rtk bun run rust:fmt
rtk bun run rust:lint
```

Expected: full Rust tests pass, formatting is clean, and clippy reports zero warnings under `-D warnings`.

- [ ] **Step 3: Run frontend and workspace gates**

```bash
rtk bun run --cwd apps/game test
rtk bun run check
rtk bun run test
rtk bun run lint:all
```

Expected: focused and full Vitest suites, Svelte checks, compiler tests, formatting, ESLint, Rust format, and clippy all pass.

- [ ] **Step 4: Run E2E type and packaged gates**

```bash
rtk bun run --cwd apps/game check:e2e
rtk bun run test:e2e
```

Expected: E2E TypeScript passes, the ordinary packaged suite passes, the reviewed capture proof passes, and all process-boundary persistence scenarios pass from one build.

- [ ] **Step 5: Verify cross-host revision CI**

On the implementation PR, require both `content-revision-golden (ubuntu-latest)` and `content-revision-golden (macos-latest)` to pass from the same commit. A local macOS pass alone is not sufficient evidence for the cross-host criterion.

- [ ] **Step 6: Audit typed-command and lock-order completeness**

Check:

- every mutating gameplay handler returns `GameplayCommandResultView`;
- every read-only handler retains its bare result;
- Tauri and HTTP command lists/serialization match;
- every write/cleanup/flush/acknowledgement/exit path enters `W` before `G` before `S`;
- no writer wait occurs while holding `G`/`S`;
- every session generation initializes its own flush baseline;
- every bypass is a typed token-bound command;
- no frontend type or command contains an application-data path.

- [ ] **Step 7: Audit plan/spec coverage and unfinished markers**

Re-read design §§18–21 against the task results. Then run:

```bash
rtk rg -n 'T[B]D|T[O]DO|F[I]XME|implement l[a]ter|fill th[i]s in' apps/game packages/scripts docs/superpowers/plans/2026-07-26-hpa-392-save-load-persistence-implementation-plan.md
rtk git diff --check
rtk git status --short
```

Expected: no unfinished implementation marker in HPA-392-owned files, no whitespace errors, no generated resource JSON staged, and only intentional source/test/documentation changes remain.

- [ ] **Step 8: Commit only verification-driven fixes**

If the gates required source/test/config corrections, stage only those exact files and commit:

```bash
rtk git commit -m "fix: close save persistence verification gaps"
```

Do not create an empty commit when every gate passed without changes.

---

## Acceptance Trace

| HPA-392 acceptance outcome | Implementation tasks | Decisive proof |
| --- | --- | --- |
| Compiler-owned defaults and immutable package identity | 1 | Emitted four-role fallback tests, exact semantic reference audit, Linux/macOS golden |
| Closed v1 schema and migration dispatch | 2 | Exact-byte fixture, unknown-field rejection, future/missing-step diagnostics |
| Durable revisions and exactly-once acquisition identity | 3, 9 | Rollback equality, `acq:<command>:<ordinal>`, acknowledgement race tests |
| Round-trip every current runtime | 4, 5 | Capture→JSON→restore→recapture equality for Linear/Game Complete/Investigation/Interrogation |
| Resume single and composite dialogue exactly | 4, 5, 17 | Queue generation/cursor/item equality across process restart |
| Generic incomplete resumable fixture | 5 | Test-only adapter through package validation and transactional swap |
| Unicode names, three manual slots, stale-safe overwrite | 2, 6, 14, 17 | Grapheme tests and packaged overwrite/restart scenario |
| Five newest autosaves with aligned thumbnails | 6–9, 17 | Rotation/fault tests and six-checkpoint packaged scenario |
| Invalid newest blocks Continue, older manual recovery remains available | 7, 15, 17 | Mtime ordering unit tests and corrupt-newest process phase |
| Exact package compatibility and missing-definition rejection | 5, 7 | Shared restore/discovery validator and untouched-live-engine assertions |
| Aspect-ratio-preserving real gameplay thumbnails | 8, 12, 13 | Unit sizing/clone tests plus mandatory packaged proof |
| Thumbnail failure does not invalidate saves | 6–8, 14, 17 | Fault-injected storage, lazy-read diagnostics, packaged fallback/load |
| Atomic JSON/sidecar ownership and cleanup | 6, 7, 17 | Boundary failure matrix, orphan race, overwrite/delete disk assertions |
| Durable acknowledgement before popup closure | 3, 8, 9, 12, 17 | Exclusive writer race tests and two-record packaged scenario |
| No spurious autosave on New Game/Load | 9, 10 | Generation baseline/idempotent flush tests |
| Degraded health and explicit typed escape paths | 8–12, 15 | Complete status events, failure challenges, Retry/Cancel/bypass tests |
| Native close/quit flushes before exit | 11, 15–17 | Lifecycle unit tests and packaged close/quit/relaunch scenarios |
| Tauri/HTTP parity and no frontend paths | 10, 12 | Command-contract tests, raw byte transport, type/source audit |
| Shared localized title/in-game save UI | 14, 15 | Component/focus tests and canonical Traditional Chinese copy assertions |
| Save → title/process restart → Continue | 10, 15, 17 | Unicode seed/resume process pair |

## Completion Definition

HPA-392 is complete only when:

- every Task 18 local gate passes;
- both cross-host content-revision jobs pass on the same commit;
- the packaged capture proof is reviewed and accepted;
- the phased packaged persistence suite passes from a fresh guarded app-data directory;
- no known design §18 case is waived, replaced by an in-memory/browser-only approximation, or hidden by treating all thumbnails as unavailable.
