# HPA-854 — Save/Load Performance: Reuse the Engine-Held Story Location Index

> **Status:** design-only Draft PR (runtime fix and verification pending). **Issue:** [HPA-854](https://linear.app/cwchanap/issue/HPA-854/saving-loading-and-autosave-slow-to-minutes-as-the-story-progresses). **Baseline:** `main` inspected 2026-11-11. **Review:** [PR #132 design review](https://github.com/cwchanap/Lyra/pull/132#pullrequestreview-5866688218), accepted with scope corrections.

## Problem and player impact

The 2026-11-11 packaged Chapter 1–2 playtest reported manual save taking ~115 s, Continue ~105 s, save-list loading several minutes, and delayed/missing autosaves late in Chapter 2. The debug build amplifies elapsed times, but the repeated work is structurally present in release. Eight slots held 259 records in total; a late Chapter 2 checkpoint held 83.

The current slow path is:

```text
list_saves -> discover_saves -> discover_slot -> build_restore_candidate
  -> capture_checkpoint -> validate_inventory
  -> validate_inventory_record (for each evidence/statement)
  -> GameEngine::packaged_acquisition_scene
  -> find_scene_json_by_id -> load_chapter_scene_jsons
  -> re-read and deserialize the whole chapter for each record
```

Manual save, autosave, save-list opening, and Continue all involve checkpoint capture/recapture. `build_restore_candidate` intentionally recaptures the detached candidate and compares the **exact** snapshot: that check must remain.

## Design decision (revised after review)

**Use the existing `GameEngine.story_locations` index for acquired-record manifest validation. Do not thread the capture-local `SceneCache` into `validate_inventory`.**

`StoryLocationIndex` already stores packaged `SceneJson` values under `(chapter_id, scene_id)` in a `BTreeMap`:

- New games build the index once from packaged scene files (`story_location.rs`).
- Restores build it from already-loaded `CurrentDefinitions.scenes_by_key` (`restore.rs`), not new disk reads.
- The pending-acquisition view already uses `story_locations.resolve_scene_json` instead of re-reading the chapter, with a regression test (`cold_pending_acquisition_view_does_not_load_scene_files`).
- The index is immutable package data for a running engine; it is not a second state owner or a cache to invalidate at each save.

Minimal implementation:

1. In `capture.rs`, keep `validate_inventory(engine)` and `validate_inventory_record` signatures. Validate the existing catalog identity/provenance **first**. Then call `engine.story_locations.resolve_scene_json(chapter_id, scene_id)`, mapping a miss to `GameError::missing_acquisition_definition()`. Borrow the scene and retain the existing `Investigation` / `Interrogation` evidence/statement manifest match, with `inventory_record_definition_mismatch` for missing entries or unsupported scene kinds.
2. In `story_location.rs`, make `resolve_scene_json` return `Result<&SceneJson, GameError>` rather than cloning an entire scene per lookup. Its existing pending-acquisition caller (`mod.rs::cached_packaged_acquisition_scene`) clones the borrowed scene **once at that caller** because its `RefCell` and return value still own an instance. Capture validation requires no clone.
3. Delete `GameEngine::packaged_acquisition_scene` from `mod.rs` after migrating the two direct test callers in `capture.rs` and `restore.rs` to the indexed lookup. Delete its test-only empty-resource-root fallback; it is not reached from checkpoint capture because current-scene capture already requires packaged scene loading before inventory validation. Do **not** delete `find_scene_json_by_id`: scene jumps still use it.
4. Preserve source/provenance checking and the authored scene manifests as the authority. The index avoids repeated disk parsing; it does not relax validation or invent any new evidence.

### Error boundaries and fixture caveat

- Duplicate chapter IDs are rejected at manifest/engine loading; duplicate scene IDs are rejected while building the location index (and during restore definitions loading). They therefore cannot silently appear as ambiguous inventory origins in a valid engine. The old `duplicate*Target` errors need not be reintroduced into a per-record lookup.
- Missing origin: map `story_location_missing` to the existing `missing_acquisition_definition` error at the save capture boundary.
- A matching Linear/Analysis scene or missing evidence/statement manifest entry still fails with `inventory_record_definition_mismatch` after the catalog validation.
- A few hand-built test engines have **incomplete** `story_locations` relative to their declared `chapters` (e.g. the two-ref/one-index test fixture in `test_support.rs`). If one such fixture tries to capture a record from an unindexed scene, correct the fixture to represent a valid engine rather than adding a production fallback or weakening the lookup.
- Do not remove the exact `SaveSnapshot` recapture equality check on restore.

### Actual cost model and next candidate

**Inventory validation causes zero chapter JSON file loads**, regardless of the number of records. However, `capture_checkpoint` still maintains its own per-call `SceneCache` for current-scene and dialogue-history validation. When the history token is present, `packaged_scene_cursor_exclusive` walks **all chapters** and loads/parses each chapter once *per capture*, even though `story_locations` is already in memory. On the reviewed two-chapter content this is approximately 60 scene files / 2 MB per capture, and save discovery recaptures separately for every occupied slot.

Keep that work as-is in the first fix; it is a **distinct, measured follow-up candidate** if the release save list still misses the latency target. Profile `packaged_scene_cursor_exclusive` / `chapter_scenes` before considering autosave debounce or thumbnails to explain slow save-list loading. Avoid expanding into a blanket capture refactor without measurements.

## Constraints and non-goals

- Preserve `SaveSnapshot` format/semantics, content revision checks, original provenance, exact restore recapture equality, scene-type checks, and corruption rejection behavior. No save migration or backward-compatibility work.
- Keep one `ApplicationPersistence` and its existing `operation_gate`. No global scene cache, new persistence owner, new save index, or cross-module rewrite.
- Preserve existing player-driven `navigation::find_scene_json_by_id` semantics.
- Do not change thumbnails, trailing autosave debounce, retry/health rules, or UI **unless** a remaining independent failure is reproduced after the hot-path fix. Superseded `staleThumbnailTicket` warnings are not themselves proof of a failed durable autosave.
- No story, asset, SFX, voice, or localization changes.

## Evidence and validation contract

**Deterministic regression:** In `capture.rs` tests, construct a real `GameEngine::new_started` fixture with at least two **valid distinct inventory records from the same chapter**. After engine creation, reset the existing `navigation::CHAPTER_SCENE_LOAD_COUNT` counter. Call `validate_inventory(&engine)` directly and assert **zero chapter scene loads**. This fails on the current per-record loading path and succeeds after indexed lookup. Also retain a successful full checkpoint capture/restore path.

**Correctness regression:** Run existing invalid-origin, mismatched-provenance, scene-kind, and exact snapshot recapture tests. Fix incomplete test fixture indexes if exposed by the new invariant; do not add synthetic fallbacks. Focused Rust filters are helpful during development, but the final gate is the **full Tauri crate `cargo test`**, including `save::storage` discovery and cross-module integration tests.

**Release/playtest acceptance:** On a macOS or Windows release build, use a late Chapter 2 state comparable to the report (~74 evidence, 9 statements, 8 save slots / ~259 records total). Measure manual save, open save list and Continue (target ~1 s or less on the measured machine), and verify restart/return-to-title are no longer minute-scale. Confirm that an autosave commits *while normal Chapter 2 interrogation continues*, then Continue restores that revision.

**Archive provenance:** The release app identifier is `com.chanwaichan.lyra`; debug/E2E archives may live under `com.chanwaichan.lyra.dev` or `com.chanwaichan.lyra.e2e`. Prefer a **copy of the existing UAT save archive into an isolated/backup-protected release test profile**, after verifying the saved `contentRevision` matches the rebuilt emitted-scene revision. Do not overwrite an existing player archive. If revision differs or the UAT archive is unavailable, replay/regenerate the late-state archive before claiming release timing acceptance; record which approach was used.

If persistence still stalls after index reuse, measure the next hot path first. If autosave fails during normal-paced play despite fast capture, trace the existing debounce/thumbnail/supersession path and make only the smallest proven change in this same PR, with one focused test.

## Review and delivery boundary

**One Linear issue, one PR.** This Draft PR contains design/plan revisions; runtime implementation, tests, release measurements, and follow-up review happen in **this same PR**. The PR is not yet a gameplay fix. Keep HPA-854 open until its performance and autosave acceptance criteria are verified.
