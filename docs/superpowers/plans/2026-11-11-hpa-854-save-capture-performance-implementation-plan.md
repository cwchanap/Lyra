# HPA-854 — Save Capture Performance: Single-PR Implementation Plan

> **Design:** [HPA-854 performance design](../specs/2026-11-11-hpa-854-save-capture-performance-design.md) · **Tracker:** [HPA-854](https://linear.app/cwchanap/issue/HPA-854/saving-loading-and-autosave-slow-to-minutes-as-the-story-progresses) · **Status:** implementation and Rust correctness verification complete (tasks 1–3); release-build performance and normal-play autosave acceptance (task 4) **waived** by reviewer decision — debug-only functional and timing evidence accepted as sufficient.
>
> **Delivery:** **one issue → one PR (#132)**. Planning, implementation, tests and verification are commits in this same PR; Task 4 acceptance waived, so the PR may be marked ready without release measurements. Do not open a second PR for HPA-854.
>
> **Review:** [2026-11-11 design review](https://github.com/cwchanap/Lyra/pull/132#pullrequestreview-5866688218). All five findings accepted after source inspection; no blanket persistence rewrite.

## Review dispositions

| Review finding | Decision and plan change |
| --- | --- |
| Existing `GameEngine.story_locations` already holds every packaged scene | **Accept.** Reuse `story_locations.resolve_scene_json`, not capture-local `SceneCache`, for inventory manifest lookups. No `validate_inventory` signature change. |
| `packaged_acquisition_scene` and its empty-resource test fallback become dead code | **Accept.** Delete the method after updating its two test callers. Correct incomplete hand-built fixture indexes if they are used with inventory; do not retain test-only production fallbacks. |
| `capture_history` still loads all chapters per capture | **Accept as a documented residual.** Inventory causes zero loads, but `packaged_scene_cursor_exclusive` can load all 60 existing scenes (≈2 MB) per capture, once per occupied save slot on discovery. Profile that first if release latency still fails. Do not preemptively expand this PR. |
| Focused filters omit storage and cross-module equality tests | **Accept.** Run the full Tauri crate `cargo test` as the final Rust correctness gate. |
| Release late-game archive source unspecified | **Accept.** Use a verified matching-`contentRevision` copy of the UAT `.e2e`/`.dev` save archive into an isolated release test profile, or regenerate the late-state archive; never overwrite player data. |

## Task 1 — Reproduce zero-load invariant with one failing Rust test

**File:** `apps/game/src-tauri/src/game/save/capture.rs` (existing `#[cfg(test)] mod tests`).

- [x] Use `provenance_save_fixture_resources()` and `GameEngine::new_started`. Acquire at least two distinct valid records (`chain_lead`, `chain_exhibit`, or equivalent) from an indexed Investigation scene using the existing manifest and `inventory.add_evidence_from_def`. This tests real catalog/source validation, not fake IDs or a duplicate inventory.
- [x] **After** engine initialization and record seeding, call `navigation::reset_chapter_scene_load_count_for_test()`. Call `validate_inventory(&engine)` directly, then assert `chapter_scene_load_count_for_test() == 0`. This isolates inventory validation from `capture_location` / history; it fails with the old per-record `packaged_acquisition_scene` path.
- [x] Record the pre-fix load counter (or demonstrate the red test), then retain the regression with no timing sleeps or new instrumentation.
- [x] Keep existing invalid-source and provenance-mismatch capture tests. Inspect any ad-hoc test engine whose `story_locations` does not include its declared scenes; fix the fixture **only if the new borrow path exposes that discrepancy**.

**Done when:** the test fails on current code, then proves inventory validation performs **zero** chapter loads after the fix, regardless of record count.

## Task 2 — Switch to the existing indexed source lookup

**Change only the small lookup boundary:**

- [x] `apps/game/src-tauri/src/game/story_location.rs`: change `resolve_scene_json` to return `Result<&SceneJson, GameError>`. Keep `story_location_missing` at the index API boundary; return the borrowed scene, without cloning every source scene.
- [x] `apps/game/src-tauri/src/game/save/capture.rs`: retain `validate_inventory(engine)` and `validate_inventory_record` signatures. Keep `validate_inventory_record_against_catalog` **first**, then use:
  
  ```rust
  let scene = engine
      .story_locations
      .resolve_scene_json(chapter_id, scene_id)
      .map_err(|_| GameError::missing_acquisition_definition())?;
  ```

  Match `SceneJson::Investigation` / `Interrogation` to the proper record manifest as before. Unsupported types or missing entries still return `inventory_record_definition_mismatch`.
- [x] `apps/game/src-tauri/src/game/mod.rs`: resolve the borrowed scene directly at the existing pending-acquisition caller (`packaged_acquisition_scene`) and return a reference; the old `RefCell` memo of the resolved scene was removed as redundant once the lookup became a borrowed `BTreeMap` hit. Delete the separate `GameEngine::packaged_acquisition_scene` disk-reading method and its `#[cfg(test)]` empty-resource-dir fallback after removing its last consumers. Keep `navigation::find_scene_json_by_id` for navigation jumps.
- [x] Update only the two direct tests which call the removed method: `capture.rs` provenance test and `save/restore.rs` provenance round-trip test. Use `story_locations.resolve_scene_json`. Check for any other call sites before deletion.
- [x] If an existing hand-built fixture has a partial index (`test_support.rs` has a two-ref/one-index example), include the missing scene in that **fixture** only when required by the affected test; don't add a global fallback or retain file reparsing.
- [x] Preserve the existing constructor-time duplicate chapter/scene rejection. For capture, missing origin maps to `missing_acquisition_definition`, while incorrect source type/manifest and catalog mismatch still fail with their existing errors.
- [x] When removing `packaged_acquisition_scene`, update the stale test comment in `save/capture.rs` near line 1321: it currently says invalid Linear/Analysis origins are rejected before `packaged_acquisition_scene` returns one. Keep its defensive-exhaustiveness explanation, but refer to `story_locations.resolve_scene_json` and the existing scene-loading validation instead. Do not leave a reference to the deleted helper.

**Expected runtime files:** `capture.rs`, `story_location.rs`, `mod.rs`. `restore.rs` changes only its test caller; `test_support.rs` only if a fixture needs correction.

**Done when:** capture inventory validation uses the existing index, performs no disk chapter loads, and does not weaken the manifest/provenance rules.

## Task 3 — Exact persistence correctness, including cross-module tests

- [x] Run the new zero-load test, existing capture invalid-origin and provenance tests, and `story_location.rs` pending-acquisition zero-load test.
- [x] Confirm `build_restore_candidate` still recaptures and demands exact `SaveSnapshot` equality; do not bypass it. Cover a save containing multiple acquired records and verify its round-trip.
- [x] Run focused tests during development, **then the full crate `cargo test`**, not only `save::capture` / `save::restore` / `save::application`. The full run includes `save::storage` / `discover_slot` and:
  - `case_record_integration_tests.rs` capture–restore cases,
  - `case_file_integration_tests.rs` capture–restore cases,
  - `navigation.rs` recapture equality tests.
- [x] Run Rust formatting and Clippy; no save schema, chapter content, or resource-generation change.

Suggested commands (repository root):

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib save::capture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib save::restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib save::application
# Required final Rust correctness gate, beyond the focused filters:
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run rust:fmt
bun run rust:lint
```

**Done when:** all Rust tests pass, including source/provenance rejections and exact restore equality, and the diff has no new save model or state owner.

## Task 4 — Release-build late-game acceptance on desktop

> **Waived** by reviewer decision (2026-11-13): the debug-only functional and timing evidence already recorded in the PR is accepted in place of genuine-release measurements. The unchecked boxes below are left as a record of what was skipped; none gate this PR.

**Source the workload deliberately.** The default release identifier is `com.chanwaichan.lyra`; `tauri.e2e.conf.json` uses `com.chanwaichan.lyra.e2e` and `tauri.dev.conf.json` uses `com.chanwaichan.lyra.dev`. Their save archives are not automatically shared.

- [ ] Prefer the existing Chapter 2 UAT archive, if available. Inspect `contentRevision` from its saves and the newly emitted `content_manifest`. If equal, **copy** the UAT archive into an isolated/backed-up release test profile. Do not overwrite the ordinary release player archive. Record source path, destination/profile, build identity and revision in the PR.
- [ ] If the original UAT saves are missing or the emitted-scene revision is different, replay/regenerate a representative late Chapter 2 state instead of trying to import incompatible saves. Do not make backward compatibility changes.
- [ ] Use a **release** build on macOS and Windows as available (no manual Android/Linux acceptance). Aim for the reported late-game load (≈74 evidence + 9 statements, about 8 save slots with ≈259 records). Record machine/OS, build type, slot and record counts, and observed wall times:
  - Manual save, opening save list, Continue: each about **1 s or less** on the measured machine.
  - Restart and return to title: no minute-scale hangs; record their actual durations.
  - Save contents and provenance survive Continue unchanged.
- [ ] Continue ordinary Chapter 2 interrogation with autosave enabled; check a save actually **commits to disk before the hearing ends**, and Continue restores a revision from during play. Record timestamps/revisions, not just UI activity.
- [ ] If latency still fails, profile the **two separate remaining chapter-load paths** before changing autosave policy:
  - `capture_history` → `packaged_scene_cursor_exclusive` → capture-local `chapter_scenes`: with a history token, this can parse every chapter once per capture, and save discovery repeats that work per occupied slot.
  - `validate_packaged_dialogue_candidate` → `GameEngine::restore_active_dialogue_queue` (`dialogue_queue.rs`): when `active_dialogue` is present, its own `loaded_chapters` map may parse the active chapter separately from the capture-local `SceneCache`. A capture with both active dialogue and history may therefore load the active chapter twice and the other chapters once, *even after inventory validation is fixed*.
  - Record chapter-load counter/timings for each path before making any follow-up optimization; do not add shared cache plumbing or touch debounce/thumbnails speculatively.
- [ ] If captures are fast but autosave still does not commit during normal play, inspect the existing 500 ms trailing debounce, thumbnail-ticket supersession and write gate. Fix only an independently reproduced scheduling problem within `ApplicationPersistence`, with one targeted deterministic `save/application/tests/autosave.rs` regression. No new queue/scheduler or blanket thumbnail removal.
- [ ] Prefer the existing packaged save-core E2E path and one representative real late-state playthrough to a new E2E matrix. Record what ran and what remains unverified.

**Done when:** ~~measured release performance and mid-interrogation autosave satisfy HPA-854, or remaining unverified acceptance is stated explicitly without closing the issue~~ — **waived**; debug-only evidence accepted, unverified acceptance stated explicitly in the PR.

## Task 5 — One-PR review and closeout

- [ ] Review source diff: `story_locations` reused, no new cache, no validation bypass, no scene/asset changes.
- [ ] Update PR body with pre/post chapter-load counts, actual Rust/Clippy test outputs, release timings, archive provenance and autosave result. Mark unrun tests unverified.
- [x] Keep **HPA-854** as sole tracker, leave the PR Draft until implementation and verification are ready — Task 4 acceptance waived, so the PR was marked ready — and complete Linear after merge.
- [ ] Handle subsequent review feedback in this **same** PR.

## Out of scope

No HPA-853 hotspot layout changes, HPA-830 save-slot keyboard UX, new visuals/SFX, story scripts, global scene memoization, new persistence service, save schema/migration, navigation rewrites, or speculative thumbnail/debounce redesign.

## Reviewer checklist

- [x] Does `validate_inventory` invoke `load_chapter_scene_jsons`? **No.** Counter asserts zero.
- [x] Is the `story_locations` lookup borrowed everywhere, with no scene clone on the pending-acquisition path? **Yes.**
- [x] Are missing source, wrong record kind, bad provenance and corrupted snapshots still rejected? **Yes, proven by full Rust tests.**
- [ ] Does opening the save list avoid repeated per-record chapter deserialization? **Yes; per-slot history parsing remains a separate measured risk.** (Release-mode confirmation waived.)
- [ ] Does a real autosave land during Chapter 2 interrogation? ~~**Confirm with test evidence before calling done.**~~ **Waived** — debug-only autosave observation accepted.
- [ ] Are release archive source, content revision, and observed timings documented? ~~**Yes before merging.**~~ **Waived** — debug-only timings documented instead.
