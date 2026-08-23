# HPA-550 Save Thumbnail Removal Design

**Status:** Provisional product recommendation for the single HPA-550 PR. Outcome A is not confirmed until the validation gate below is completed. If the gate confirms the recommendation, implementation continues on this same branch/PR.

**Issue:** HPA-550 — [Post-Chapter 1 product decision] Remove save thumbnails or prove native capture value

## 1. Provisional recommendation

The lowest-cost candidate is **Outcome A: remove dynamic save thumbnails entirely**.

This is a recommendation to validate, not a pre-decided playtest result.

If confirmed, Save / Load / Continue becomes text-first and uses the information Lyra already owns independently of the image:

- slot type and number;
- manual display name when present;
- saved timestamp;
- chapter title and optional recap;
- scene title and optional recap;
- active primary objective and optional recap;
- validity / corruption diagnostics;
- newest-save marker.

Do **not** replace the screenshot with another image subsystem. HPA-550 does not add authored chapter art, static placeholders, native screenshots, a provider trait, renderer-specific capture hooks, or another fallback capture path.

`SaveRecapDetails` already renders stable story context. The candidate design therefore deletes the preview frame rather than replacing one decorative subsystem with another.

## 2. Product-validation gate

HPA-550 asked for at least one real Save / Load / Continue playtest before finalizing the product decision. HPA-265 explicitly skipped its optional human playtest, so this document does not claim that requirement has already happened.

Before runtime implementation begins on this same PR, perform one short packaged Chapter 1 playtest:

1. create at least three saves at visibly different scenes / objectives, including one manual save with a useful name;
2. return to title and use Continue;
3. open Load and deliberately choose a non-newest save using the card information;
4. reopen the in-game Save / Load browser and distinguish the saves using name / timestamp / chapter / scene / objective / recap;
5. record whether screenshot content materially changed which save was chosen.

**Proceed with Outcome A** only when the text metadata is sufficient to select the intended save and the screenshot is decorative or merely reassuring.

**Stop implementation** if the player materially depends on the screenshot to distinguish saves. Record the concrete ambiguity and revise HPA-550 explicitly. Do not silently turn this PR into a native-capture spike.

Current evidence makes Outcome A worth testing first: the save UI already exposes rich text identity, while PR #66 demonstrates real product and maintenance cost from DOM capture. That evidence does not replace the gate.

## 3. Why deletion is the right candidate

The current thumbnail is non-authoritative but crosses almost every persistence layer:

- frontend DOM → SVG / PNG conversion through `html-to-image`;
- capture-only Traditional Chinese font embedding through `@fontsource-variable/noto-serif-tc`;
- gameplay mutation wrappers returning capture tickets;
- manual-save prepare / settle / submit handshake;
- coordinator ticket purposes, deadlines, supersession, terminal states, and thumbnail activity;
- PNG validation and digesting;
- save-envelope thumbnail descriptors and PNG sidecars;
- save discovery that validates descriptors / sidecars;
- capture-specific E2E fault injection;
- a dedicated packaged `capture-proof` suite;
- capture-specific CI routing;
- gameplay DOM annotations used only to normalize screenshot capture.

PR #66 had to introduce `AutosaveIfAdvancedWithoutThumbnail` and presentation-specific capture exceptions to avoid interrogation hitches. The screenshot therefore imposes feature-specific cost even though restore correctness does not depend on it.

Restore authority remains the strict save envelope, snapshot, content revision, current packaged definitions, serialized persistence writer, overwrite expectations, and generation/revision guards. Removing thumbnails does not weaken those contracts.

## 4. Product contract after removal

### 4.1 Save cards

A valid occupied slot remains identifiable without an image:

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

An empty slot remains explicit:

```text
[手動存檔 3]
空白存檔
[選擇]
```

An invalid slot keeps any independently readable safe metadata plus its existing diagnostic. It does not attempt image recovery.

`SaveConfirmationDialog` mounts `SaveCard` for overwrite / delete / load confirmation, so it inherits the same text-only identity contract. `MainMenu` Continue recap, `SaveBrowser`, and `SaveNameDialog` also consume the same metadata shape and must not retain thumbnail-only fixtures or mocks.

### 4.2 Public frontend metadata

Remove thumbnail availability from `SaveMetadataView` and `ReadableSaveMetadataView`. No replacement field is added.

During the first UI-only implementation slice, standalone capture/activity types may remain because the live Rust wire still needs them. They disappear in the atomic Rust+TypeScript wire slice. This avoids a compile-broken intermediate state.

### 4.3 Gameplay-command wire

The existing `GameplayCommandResultView { state, thumbnailCapture }` wrapper exists only to hand post-commit capture work to the frontend. With capture gone, mutating gameplay and persistence-transition commands return `GameStateView` directly.

This is one **atomic cross-language contract change**. Rust command return types and TypeScript consumers change in the same task and same implementation commit. The frontend must never expect bare `GameStateView` while Rust still sends `{ state, thumbnailCapture }`.

A serialization regression must prove a representative mutating command serializes the state object directly, with top-level `chapter` / `scene` and no `state` wrapper or `thumbnailCapture` key.

### 4.4 Central mutation guard remains an invariant

Thumbnail removal must not weaken the source-level lock-discipline guard.

Today `direct_no_thumbnail_commands_pin_no_thumbnail_autosave_policy` checks two different contracts at once:

1. commands select the no-thumbnail policy; and
2. commands still route through `run_gameplay_mutation` and do not call `session.lock()` directly.

Only the first contract is obsolete.

When the autosave variants collapse, merge the ordinary/no-thumbnail source tests into one `every_mutating_command_routes_through_the_central_autosave_policy` coverage set. Preserve for every listed command:

- `run_gameplay_mutation` routing;
- ordinary `AutosaveIfAdvanced` selection after the collapse;
- no direct `session.lock()`.

Do not delete the whole old test merely because its thumbnail-policy assertions become invalid.

### 4.5 Autosave policy

After removal there is one ordinary durable-mutation autosave policy plus coordinator-owned transitions:

```text
AutosaveIfAdvanced
CoordinatorManaged
```

`AutosaveIfAdvancedWithoutThumbnail` disappears. `run_gameplay_mutation_selecting_policy` and `dialogue_persistence_policy` may also disappear if their only remaining distinction is thumbnail capture.

### 4.6 Manual save

Manual save becomes one command:

```text
save_manual(reference, displayName, expectation)
```

There is no preceding `prepare_save_thumbnail`, no prepared ticket, no submit/failure reporting, and no thumbnail activity result.

## 5. Save format and storage

Remove the `thumbnail` field from `SaveEnvelope` rather than preserving `thumbnail: unavailable` forever.

Also remove:

- `ThumbnailDescriptorV1`;
- `ThumbnailFormat`;
- thumbnail byte/dimension constants;
- thumbnail availability / diagnostic views;
- descriptor validation;
- PNG digest and dimensions;
- `ThumbnailWrite`;
- `saves/thumbnails/`;
- sidecar staging / install / discard;
- sidecar ownership scanning and cleanup;
- thumbnail state from readable invalid metadata.

Keep `SAVE_SCHEMA_VERSION = 2` and the strict current parser. This is intentionally a pre-release breaking shape change under HPA-540: old local development envelopes containing the removed top-level field may fail `deny_unknown_fields`. Do not add a migration decoder or schema bump solely to preserve an unshipped preview field.

Preserve:

- staged / atomic JSON writes;
- overwrite expectations and stale-write rejection;
- directory sync;
- corruption discovery;
- save-owned JSON temporary cleanup;
- autosave target selection;
- Continue candidate selection;
- detached restore / exact recapture;
- session-generation and durable-revision guards;
- flush / exit semantics;
- delete ordering.

`PreparedSlotWrite` may remain as the JSON transaction boundary. HPA-550 does not implement HPA-521's coordinator ownership refactor.

## 6. Rust hashing dependency

The previous HPA-550 draft incorrectly said Rust `sha2` had non-thumbnail consumers. Current code does not support that statement.

`content_manifest.rs` validates the textual `sha256:` prefix and 64 lowercase hex characters; it does not hash content at runtime. The live Rust `sha2::` / `Sha256` use is in `save/thumbnail.rs`.

Therefore, after deleting `save/thumbnail.rs`:

1. run `rg 'sha2::|Sha256' apps/game/src-tauri/src`;
2. if it is clean, remove the direct `sha2 = "0.10"` dependency from `apps/game/src-tauri/Cargo.toml`;
3. let Cargo update the tracked lockfile mechanically if dependency resolution changes.

The requirement is to remove Lyra's now-unused **direct dependency**. Do not hand-edit the lockfile or assume a transitive `sha2` package must disappear if another dependency still uses it.

## 7. Coordinator deletion boundary

Delete capture-specific coordinator concepts:

- capture timeout;
- capture/prepared purposes;
- capture request/activity views;
- capture intent/ticket records;
- supersession maps and deadlines;
- capture-required flags;
- claim / submit / failure / expiration APIs;
- thumbnail activity publication.

Keep the serialized writer queue and task scheduler where still required, autosave coalescing, failure challenges, blocking flushes, generation/revision guards, exit exclusivity, and delete ordering.

At the end of the atomic wire task, new saves may temporarily use the existing `ThumbnailDescriptorV1::Unavailable` / `ThumbnailWrite::Unavailable` solely because Task 3 has not removed the envelope/storage field yet. This is a short-lived compatibility seam inside the same PR, not a new abstraction.

## 8. Frontend capture deletion

Delete the live capture protocol together with the atomic wire change:

- `thumbnail-capture.ts` and its unit tests;
- `finishThumbnailCapture` / `applyGameplayCommandResult` / prepared-capture settling;
- capture deadlines and detached submission;
- thumbnail command helpers;
- thumbnail activity store state/listener;
- manual-save prepare/settle path;
- capture-only packaged probe/settlement helpers.

Keep gameplay presentation and audio semantics unchanged.

DOM annotations such as `data-save-thumbnail-*` can be removed in the later cleanup task after the wire/pipeline is already gone. They are dead markup at that point and do not justify keeping the capture code alive.

## 9. Packaged E2E and CI routing

### 9.1 Delete capture-proof at the same boundary as the protocol

The dedicated packaged `capture-proof` suite tests the protocol being deleted. Keeping it for later would knowingly make the persistence chain red after the wire change.

Therefore the atomic wire task also deletes:

- `e2e-tauri/capture-proof.e2e.ts`;
- `PackagedCaptureProofProbe.svelte` and its test;
- `capture-proof-settlement.ts` and its test;
- `capture-proof` registry / chain membership;
- `test:e2e:capture-proof*` scripts;
- `--suite capture-proof` from the save-chain script;
- capture-proof-specific anchors/helpers/source assertions.

Run packaged `test:e2e:smoke` at that task boundary so the new IPC response shape is proven in a real Tauri build before moving on.

### 9.2 Fix checkpoint-capture routing

`apps/game/src-tauri/src/game/save/capture.rs` is checkpoint/save-snapshot capture, not screenshot capture. It has no thumbnail responsibility and should remain persistence-owned.

The current `select-e2e-suites.mjs` has a `capture` rule that routes this file to only `smoke` + `capture-proof`, while the persistence rule explicitly excludes it. Deleting `capture-proof` without fixing that rule would reduce checkpoint changes to smoke-only coverage.

When the suite is removed:

- delete the obsolete `capture` risk rule;
- remove `save/capture.rs` from `persistence.excludedPatterns`;
- keep thumbnail-capture frontend paths out because that frontend file is deleted;
- update selector/CI-contract tests including `select-e2e-suites.test.mjs`, `plan-e2e-ci.test.mjs`, and `e2e-ci-results.test.mjs`;
- rewrite the stale `dialogue-capture-surface` comment so it describes the remaining broad gameplay/persistence risk rather than “capture-proven” behavior.

After this change, checkpoint capture modifications select the full remaining persistence chain.

### 9.3 Remaining persistence coverage

After HPA-550, persistence packaged coverage remains focused on user behavior:

```text
save-core
save-management
exit-lifecycle
```

Delete thumbnail-only management phases such as missing/corrupt thumbnail and sidecar ownership helpers. Keep JSON corruption, manual save/load/delete/overwrite, autosave/Continue, and exit-lifecycle behavior.

`CLAUDE.md` (and therefore the mirrored `AGENTS.md` content) must be updated when the suite registry changes so the documented CI chain no longer names `capture-proof`.

## 10. Frontend dependencies

Remove capture-only frontend dependencies after the live capture code is gone:

- `html-to-image`;
- `@fontsource-variable/noto-serif-tc`.

The Fontsource package is safe to remove because the game UI's ordinary `Noto Serif TC` is provided separately; this package is imported by the screenshot pipeline.

Regenerate `bun.lock` with Bun. Do not hand-edit lockfile entries.

## 11. Test strategy

### UI slice

Run the **full game Vitest suite**, not only SaveCard tests. Several other component tests currently carry thumbnail metadata or mocks:

- `MainMenu.test.ts`;
- `SaveRecapDetails.test.ts`;
- `SaveBrowser.test.ts`;
- `SaveNameDialog.test.ts`;
- `SaveConfirmationDialog.test.ts`;
- `SaveCard.test.ts`;
- persistence type fixtures.

Remove dead `readSaveThumbnail` mocks/assertions from components that never read thumbnails themselves rather than leaving vacuous tests.

### Atomic wire slice

Require all of:

- Rust serialization regression for bare `GameStateView`;
- merged source-level central-mutation/lock-discipline regression;
- focused game-client/route unit tests;
- full game unit suite;
- Rust tests;
- E2E selector/CI contract tests;
- E2E type check;
- packaged `test:e2e:smoke`.

### Storage slice

Keep schema/storage/coordinator durability tests and add/adjust:

- schema-2 envelope without `thumbnail`;
- strict rejection of the old top-level field;
- save layout creates no thumbnail directory;
- one staged JSON write with no PNG branch;
- no direct Rust `sha2` use before deleting the dependency.

### Final cleanup/full verification

Run gameplay + remaining save chains after all thumbnail-specific fixtures/DOM/dependencies are gone.

## 12. HPA-521 / HPA-560 boundary

HPA-550 may delete thumbnail branches from the coordinator but must not use that deletion to implement HPA-521's broader ownership refactor.

HPA-560's generic E2E architecture cleanup is also out of scope. HPA-550 changes only routing and suite contracts necessary because `capture-proof` and thumbnail phases cease to exist.

The intended sequence remains:

```text
HPA-549 → HPA-550 → HPA-521 → HPA-536
```

After HPA-550 is implemented, HPA-521 should no longer treat capture tickets, thumbnail activity, or PNG sidecars as invariants.

## 13. Single-PR boundary

HPA-550 uses one PR.

Current draft phase contains design/plan only. If Task 0 confirms Outcome A, implementation commits are added to **this same PR and branch**. Do not merge a planning-only PR and open a second implementation PR.

If Task 0 rejects Outcome A, keep the PR draft and revise the product decision explicitly before any native-capture work.

## 14. Non-goals

- No replacement screenshot/image system.
- No native screenshot spike unless Task 0 rejects Outcome A.
- No save-browser redesign beyond removing dead image space and any playtest-proven spacing correction.
- No save-slot count changes.
- No recap-authority/spoiler-policy change.
- No HPA-521 coordinator ownership refactor.
- No HPA-560 generic E2E runner redesign.
- No migration framework or compatibility decoder for pre-release local saves.
- No unrelated security/hardening expansion.
- No rewrite of historical PR #66 design documents.

## 15. Acceptance criteria

- [ ] The packaged Save / Load / Continue gate is recorded and either confirms Outcome A or stops implementation.
- [ ] Save cards, Continue recap, confirmation, browser, and naming surfaces remain understandable with text only.
- [ ] No public save metadata view contains thumbnail state.
- [ ] Mutating gameplay/persistence commands return bare `GameStateView` atomically across Rust+TypeScript.
- [ ] The central `run_gameplay_mutation` / no-direct-`session.lock()` guard remains enforced for commands formerly covered by the no-thumbnail test.
- [ ] Manual save is one command with no capture prepare/submit handshake.
- [ ] `AutosaveIfAdvancedWithoutThumbnail` and thumbnail-only policy selection disappear.
- [ ] Capture tickets/activity/deadlines, DOM rasterization, packaged probe/settlement, and capture-proof suite are removed.
- [ ] `save/capture.rs` routes to the remaining persistence chain rather than smoke-only.
- [ ] Save envelopes/storage layout contain no thumbnail descriptor/PNG sidecar contract; schema version remains 2 with no migration.
- [ ] `save/thumbnail.rs` is deleted and the direct Rust `sha2` dependency is removed after a clean-use grep.
- [ ] Thumbnail-only E2E sidecar/corruption/fault helpers are removed while JSON persistence coverage remains.
- [ ] `html-to-image` and capture-only Fontsource are removed.
- [ ] `CLAUDE.md` no longer documents `capture-proof` as a persistence chain member.
- [ ] Full unit/type/lint/Rust checks plus packaged gameplay and remaining save chains pass before the PR is marked ready.
- [ ] Final diff shows material net deletion and introduces no replacement capture abstraction.
