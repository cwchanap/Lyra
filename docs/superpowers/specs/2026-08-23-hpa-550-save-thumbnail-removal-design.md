# HPA-550 Save Thumbnail Removal Design

**Status:** Proposed product decision for the single HPA-550 PR. The PR begins as design/plan-only and should receive the implementation on the same branch after the validation gate below passes.

**Issue:** HPA-550 — [Post-Chapter 1 product decision] Remove save thumbnails or prove native capture value

## 1. Decision

Default to **Outcome A: remove dynamic save thumbnails entirely**.

The resulting Save / Load / Continue experience is text-first:

- slot type and number;
- manual display name when present;
- saved timestamp;
- chapter title and optional recap;
- scene title and optional recap;
- active primary objective and optional recap;
- validity / corruption diagnostics and the existing newest-save marker.

Do **not** replace the dynamic screenshot with another image system. In particular, this ticket does not add:

- authored chapter-image lookup;
- generated placeholders;
- native screenshots;
- a screenshot provider abstraction;
- renderer-specific capture hooks;
- a fallback capture pipeline.

`SaveRecapDetails` already renders enough stable story context for a player to identify a save without an image. The simplest product is therefore to remove the preview frame from occupied and invalid save cards instead of replacing one decorative subsystem with another.

## 2. Remaining product-validation gate

HPA-550 asked for at least one real Save / Load / Continue playtest before finalizing the product decision. HPA-265 explicitly skipped the optional human playtest, so this document does not claim that requirement has already happened.

Before runtime implementation begins on this same PR, perform one short Chapter 1 packaged playtest:

1. create at least three saves at visibly different scenes / objectives, including one manual save with a useful name;
2. return to title and use Continue;
3. open Load and choose a non-newest save;
4. reopen the in-game save browser and distinguish the saves using the existing chapter / scene / objective / timestamp / name metadata;
5. record whether the image materially changed which save the player chose.

**Proceed with this design** when the text metadata is sufficient to select the intended save and the thumbnail is only decorative / reassuring.

**Stop implementation** if the player materially depends on the screenshot to distinguish saves. Do not silently switch this PR to a native-capture implementation. Update HPA-550 with the observed value and make the next design decision explicitly; a native Tauri capture spike would then be justified before choosing Outcome B.

The expected result is Outcome A because the current save card already presents chapter, scene, objective, timestamp, slot type, and display name independently of the image, while PR #66 demonstrates real feature cost from DOM capture.

## 3. Why this is the next useful simplification

The current capture subsystem spans every layer of persistence for a non-authoritative preview:

- the frontend performs DOM → SVG / PNG conversion with `html-to-image`;
- Traditional Chinese capture adds Fontsource discovery, unicode-range filtering, font fetching, data-URL embedding, and packaged-render diagnostics;
- gameplay mutations return capture tickets with deadlines and frontend submission work;
- manual save has a separate prepare / settle / submit handshake;
- Rust owns ticket purposes, deadlines, supersession, terminal results, PNG validation, sidecar ownership, thumbnail activity state, and capture-specific persistence branches;
- Save discovery validates thumbnail descriptors and sidecars;
- packaged E2E has a dedicated capture-proof suite plus missing/corrupt-thumbnail management phases;
- gameplay DOM carries capture-only annotations and exclusions;
- package dependencies and CI surface exist only for capture.

PR #66 had to introduce a no-thumbnail mutation policy and capture exclusions to avoid interrogation hitches. That is exactly the kind of feature-specific tax HPA-550 was intended to evaluate.

The image is not restore authority. Restore correctness already comes from the strict save envelope, snapshot, packaged definitions, content revision, and serialized writer path. Removing the thumbnail therefore deletes complexity without weakening game-state durability.

## 4. Product contract after removal

### 4.1 Save card

Occupied valid save:

```text
[手動存檔 2]                       [最新]
雨鐘案・審查前
手動存檔              2026年8月23日 上午11:42
章節  第一章 雨鐘咖啡館殺人事件
      …optional chapter recap…
場景  第一次證據審查會
      …optional scene recap…
主要目標  找出摘要時間線的矛盾

[選擇] [載入]                         [刪除]
```

Empty save:

```text
[手動存檔 3]
空白存檔
[選擇]
```

Invalid save keeps the readable safe metadata that the current parser can independently validate, plus the existing diagnostic. It does not attempt to render or recover an image.

### 4.2 No thumbnail state in public views

Remove thumbnail availability from `SaveMetadataView` and `ReadableSaveMetadataView`. A missing / corrupt / unreadable PNG can no longer make an otherwise valid save look degraded because there is no PNG object to own.

Remove `ThumbnailActivityView`. Persistence status has only persistence health and exit status.

### 4.3 Gameplay command wire contract

The `GameplayCommandResultView { state, thumbnailCapture }` wrapper exists to hand a capture ticket to the frontend after a committed mutation. With capture gone, mutating gameplay and persistence-transition commands return `GameStateView` directly.

There is one autosave policy for ordinary durable mutations:

```text
AutosaveIfAdvanced
CoordinatorManaged
```

The temporary `AutosaveIfAdvancedWithoutThumbnail` distinction introduced by PR #66 disappears because every autosave is naturally thumbnail-free.

### 4.4 Manual save wire contract

Manual save becomes one command:

```text
save_manual(reference, displayName, expectation)
```

There is no preceding `prepare_save_thumbnail`, no ticket, and no `preparedThumbnailTicket` argument.

`ManualSaveResultView` contains the saved slot and refreshed browser view only. It no longer returns thumbnail activity.

## 5. Save format decision

Remove the `thumbnail` field from the current `SaveEnvelope` rather than leaving `thumbnail: unavailable` forever.

Also remove:

- `ThumbnailDescriptorV1`;
- `ThumbnailFormat`;
- thumbnail size constants;
- thumbnail availability / diagnostic views;
- thumbnail descriptor validation;
- sidecar object identity / digest data.

Keep:

- `SAVE_SCHEMA_VERSION: u32 = 2`;
- the strict current parser;
- exact `contentRevision` gating;
- all existing snapshot / summary validation;
- the current pre-release development-save policy from HPA-540.

This is intentionally a pre-release breaking format change without a migration. Existing local development saves that contain the removed `thumbnail` field may become invalid under strict parsing. Developers clear their development `saves/` directory when needed. Do not bump the schema solely to preserve an unshipped capture field and do not add a compatibility decoder.

## 6. Storage design

The save write still uses the existing serialized / staged persistence owner. HPA-550 removes thumbnail branching; it does **not** implement HPA-521.

Current shape, simplified conceptually:

```text
checkpoint
  → current SaveEnvelope
  → stage slot JSON
  → validate overwrite expectation
  → install slot JSON
  → sync save directory
  → publish write health
```

Remove from `storage.rs`:

- the `saves/thumbnails/` directory;
- `ThumbnailWrite`;
- available-vs-unavailable envelope variants;
- staged thumbnail sidecars;
- thumbnail PNG temporary-file ownership;
- referenced-sidecar scanning;
- thumbnail availability inspection during discovery;
- thumbnail fields in readable invalid-slot metadata;
- sidecar deletion on overwrite/delete/orphan cleanup.

Preserve:

- atomic staged JSON writes;
- overwrite expectations and stale-write rejection;
- root / directory synchronization;
- corruption discovery;
- orphan cleanup for save-owned JSON temporary files;
- autosave target selection;
- continue candidate selection;
- detached restore / exact recapture behavior;
- cleanup diagnostics that are still relevant to save JSON ownership.

`PreparedSlotWrite` may remain as the storage transaction boundary if it still carries the staged JSON write. This ticket should simplify that type in place rather than reorganizing the whole coordinator or writer queue.

## 7. Coordinator design

Delete all capture-specific coordinator concepts:

- `THUMBNAIL_CAPTURE_TIMEOUT`;
- `ThumbnailCapturePurpose` / `PreparedThumbnailPurpose`;
- `ThumbnailCaptureRequestView`;
- `CaptureIntent`;
- ticket records and supersession maps;
- capture terminal results;
- capture deadlines;
- capture-required flags on pending autosaves / retry state;
- thumbnail activity subscribers;
- capture claim / submit / failure APIs;
- thumbnail availability carried through autosave write wrappers.

Autosave timing becomes simpler:

```text
committed durable mutation
  → debounce latest durable revision
  → capture current checkpoint
  → enqueue the existing serialized write
```

A blocking flush waits for the durable write, not for a screenshot deadline.

Preserve the current writer queue, session-generation guards, durable-revision guards, autosave coalescing, failure challenges, flush semantics, delete ordering, and exit handling. Those are persistence behavior, not thumbnail behavior.

## 8. Frontend design

Delete `apps/game/src/lib/persistence/thumbnail-capture.ts` and its tests.

Delete capture-specific command helpers:

- `getThumbnailActivity`;
- `reportSaveThumbnailFailure`;
- `submitSaveThumbnail`;
- `readSaveThumbnail`.

Simplify `game-client.svelte.ts`:

- consume `GameStateView` directly from mutating commands;
- remove `finishThumbnailCapture`, `applyGameplayCommandResult`, deadline pinning, detached capture submission, and prepared-capture settling;
- remove `MUTATING_GAMEPLAY_COMMANDS` if its only remaining purpose is teaching the test harness to wrap responses for thumbnail capture.

Simplify `+page.svelte` manual save to the one `save_manual` call.

Simplify `persistence-store.svelte.ts` to persistence health + exit status only. Delete the thumbnail-activity initial query, listener, version counter, state, and replacement method.

Remove capture-only DOM attributes / comments from gameplay components. Do not otherwise restyle or restructure those components.

## 9. Dependencies

Remove frontend dependencies that become unused:

- `html-to-image`;
- `@fontsource-variable/noto-serif-tc`.

Regenerate `bun.lock` through Bun rather than editing lockfile entries by hand.

Do **not** remove Rust `sha2`; it is also used outside thumbnails (for example content-manifest hashing).

## 10. E2E and test design

Delete the dedicated packaged capture proof rather than preserving it as an empty suite:

- remove `capture-proof` from suite IDs and the persistence chain;
- delete `e2e-tauri/capture-proof.e2e.ts`;
- delete `PackagedCaptureProofProbe.svelte` and its test;
- remove capture-proof environment / anchors / helpers;
- remove `test:e2e:capture-proof*` scripts.

Delete thumbnail-specific save-management phases:

- `management-missing-thumbnail`;
- `management-corrupt-thumbnail`.

Delete sidecar test helpers and the `thumbnailInstall` E2E fault boundary.

Keep the persistence E2E chain focused on user-visible save behavior:

```text
save-core
save-management
exit-lifecycle
```

Keep the gameplay chain because the gameplay command response contract changes from a wrapper to `GameStateView`.

Rewrite `SaveCard` component coverage around the text-only contract:

- valid slot exposes name, timestamp, chapter, scene, objective, and actions;
- empty slot is clearly empty;
- invalid slot exposes diagnostic and any safe readable metadata;
- no thumbnail reader is invoked because no thumbnail reader exists.

Storage / coordinator tests should continue proving durable write, stale-generation, coalescing, flush, overwrite, delete, corruption, and exit behavior after capture state is removed.

## 11. HPA-521 boundary

HPA-550 is allowed to delete thumbnail branches from `SaveCoordinator`, but it must not use that deletion as an excuse to implement HPA-521's full ownership refactor.

After HPA-550:

- HPA-521 must treat capture tickets, thumbnail activity, PNG sidecars, and capture deadlines as already gone;
- HPA-521 may then collapse the remaining save orchestration around one serialized owner;
- HPA-550 does not split coordinator files, introduce a new persistence abstraction, or redesign the writer queue.

This keeps the intended order:

```text
HPA-549 → HPA-550 → HPA-521 → HPA-536
```

## 12. Single-PR boundary

HPA-550 uses one PR.

Current draft phase:

- this design spec;
- the implementation plan;
- no runtime change yet.

After the product-validation gate passes, implementation commits are added to **this same PR and branch**. Do not merge a planning-only PR and open a second HPA-550 implementation PR.

If the gate fails, keep the PR draft and revise the decision explicitly before any native-capture work.

## 13. Non-goals

- No native screenshot spike unless the validation gate rejects Outcome A.
- No authored screenshot / chapter-art registry.
- No save-browser redesign beyond removing the image frame and tightening text layout as needed.
- No HPA-521 coordinator ownership refactor.
- No HPA-560 E2E architecture cleanup beyond deleting capture-owned suite surface.
- No migration framework or backwards compatibility for pre-release local saves.
- No save-slot count changes.
- No changes to recap authority or spoiler rules.
- No changes to autosave durability semantics.
- No security / hardening expansion unrelated to the deleted thumbnail path.

## 14. Acceptance criteria

- [ ] The short Chapter 1 Save / Load / Continue validation is recorded and does not show material dependence on dynamic screenshots; otherwise implementation stops for a new decision.
- [ ] Save cards remain understandable using name / time / chapter / scene / objective text without an image frame.
- [ ] Save envelopes, metadata views, storage layout, and invalid-slot readable metadata contain no thumbnail contract.
- [ ] Existing pre-release saves are not migrated; `SAVE_SCHEMA_VERSION` remains `2` under the accepted HPA-540 policy.
- [ ] Gameplay and persistence transition commands return `GameStateView` directly; no capture-ticket wrapper remains.
- [ ] Manual save is a single save command with no thumbnail prepare / submit handshake.
- [ ] Autosaves debounce and persist durable revisions without screenshot deadlines or capture-required branches.
- [ ] Capture-specific Rust coordinator state, PNG validation, sidecar ownership, IPC commands, frontend capture code, status events, and DOM annotations are removed.
- [ ] `html-to-image` and the capture-only Fontsource dependency are removed.
- [ ] The capture-proof E2E suite, thumbnail-sidecar corruption phases, and thumbnail E2E fault boundary are removed rather than replaced.
- [ ] Existing save-core, save-management, exit-lifecycle, gameplay, frontend, and Rust persistence regressions pass after updating only thumbnail-owned assertions.
- [ ] The final diff has material net line reduction; no intermediate screenshot abstraction is introduced.
- [ ] HPA-521 no longer needs to preserve thumbnail-specific machinery.
