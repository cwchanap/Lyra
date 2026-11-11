# HPA-854 — Save Capture Performance: Single-PR Implementation Plan

> **Design:** [HPA-854 performance specification](../specs/2026-11-11-hpa-854-save-capture-performance-design.md) · **Tracker:** [HPA-854](https://linear.app/cwchanap/issue/HPA-854/saving-loading-and-autosave-slow-to-minutes-as-the-story-progresses) · **Status:** planning only.
>
> **Delivery:** one ticket → **one PR**. This Draft PR contains the design/plan first; commit the implementation and verification in this same branch. Do not open a second implementation PR.
>
> **Baseline:** inspected `main` on 2026-11-11. The current `capture_checkpoint` already has `SceneCache`; the regression is `validate_inventory_record` repeatedly bypassing it.

## Task 1 — Pin the regression with a small failing Rust test

**File:** `apps/game/src-tauri/src/game/save/capture.rs` (existing `#[cfg(test)] mod tests`).

- [ ] Reuse `save_capture_fixture_resources()` / existing investigation scene fixtures and legitimately defined evidence + statement manifests. Seed at least two valid records from the same chapter; do **not** use invalid duplicate inventory as a performance fixture.
- [ ] Reset `navigation::reset_chapter_scene_load_count_for_test()` *immediately before capture*, then read `navigation::chapter_scene_load_count_for_test()`. Compare equivalent captures with no/one record and multiple records; assert additional records do **not** cause additional whole-chapter scene loads. Also assert the total is bounded by the chapters the capture visits.
- [ ] Demonstrate the test fails on the old `engine.packaged_acquisition_scene` per-record path (or record the pre-fix counter values), then keep it as a cheap permanent regression test. Use the existing thread-local counter, not timing sleeps or a new load instrumentation system.
- [ ] Identify existing tests for malformed inventory source, mismatched provenance and exact recapture; extend only where the cache lookup introduces an untested difference.

**Done when:** a deterministic test demonstrates the `records × chapter loads` regression, independent of workstation speed.

## Task 2 — Share the existing scene cache with inventory validation

**Primary file:** `apps/game/src-tauri/src/game/save/capture.rs`.

- [ ] Change `capture_checkpoint` from `validate_inventory(engine)?` to `validate_inventory(engine, &mut scene_cache)?`. Thread that argument through `validate_inventory` and `validate_inventory_record` for both evidence and statements.
- [ ] Keep `validate_inventory_record_against_catalog` **before** source-scene manifest lookup. Resolve the unique chapter and unique scene using the `chapter_scenes` cache already shared with `capture_location`, `capture_scene_progress_with_active`, and `capture_history`. Borrow the scene; scan its manifest for the specific record ID, preserving existing evidence/statement and Linear/Analysis behavior.
- [ ] Preserve `GameError::missing_acquisition_definition`, `duplicate_chapter_target`, `duplicate_scene_target`, and `inventory_record_definition_mismatch` as applicable. Do not turn missing or duplicate definitions into a silently accepted first match. Keep the special test-only empty-resource-root behavior if needed by existing fixtures.
- [ ] Keep `SceneCache` scoped to the current `capture_checkpoint`; do not add a cache to `GameEngine`, `ApplicationPersistence`, `CurrentDefinitions`, or `navigation.rs`. A linear in-memory scan of a loaded chapter is sufficient; don't build a second index by default.

**Expected changed files:** `capture.rs` only for runtime logic and initial tests. Change other files only if a focused confirmed regression requires it.

**Done when:** each chapter is read/deserialized at most once per capture while all inventory/provenance errors retain their meaning.

## Task 3 — Check exact persistence semantics

- [ ] Run targeted capture/restore/storage/application Rust tests, including the existing exact `build_restore_candidate` recapture equality cases, provenance rejection tests and autosave supersession tests.
- [ ] Confirm one populated inventory round-trips with the exact same `SaveSnapshot` after save and restore. Do not change the save JSON schema, recap text, source IDs, provenance, or permitted scene types.
- [ ] Confirm the cached source lookup does not alter Chapter 1 behavior or Chapter 2 data loading. No story/compiler/asset edits are part of this ticket.
- [ ] Run Rust format and Clippy against the Tauri crate. Treat warnings introduced by this PR as failures.

Suggested focused commands from repository root:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib save::capture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib save::restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib save::application
bun run rust:fmt
bun run rust:lint
```

**Done when:** the counter regression and correctness tests pass with no changed persistence contract.

## Task 4 — Verify against a late Chapter 2 workload

**Use a release build for time acceptance**; the issue's debug UAT timings are diagnostic, not a fair release benchmark.

- [ ] With Chapter 2 near its final hearing and a representative populated save archive (ideally 8 slots / ~259 total records, with a late save around 83), measure wall time for: manual save, open save list, Continue, restart, and return to title. Record the machine, build type, save count, inventory count and actual timings in this PR. Target **~1 s or less** for manual save, save-list loading and Continue; for the other two operations verify they are no longer minute-scale and document the result.
- [ ] Advance through a Chapter 2 interrogation while autosaves are enabled. Confirm an autosave **commits to disk during gameplay**, with a usable saved revision—not merely a pending UI state or an end-screen write. Compare the persisted revision/timestamp to the gameplay timeline. Confirm Continue restores that revision.
- [ ] If autosave is still starved despite fast capture, collect a small trace distinguishing `AUTOSAVE_DEBOUNCE`, thumbnail ticket readiness/supersession and capture/commit. Fix only the demonstrated independent cause inside the **existing** `ApplicationPersistence` owner, and add one deterministic `save/application/tests/autosave.rs` test. Avoid a second writer queue, separate scheduler, global timer architecture, or blanket thumbnail removal.
- [ ] Prefer one existing packaged save E2E path plus a real playthrough over a new broad E2E matrix. E.g. use the existing `apps/game` save-core E2E suite against a packaged build and measure the late-state path manually. Do not mark unrun checks as passing.

**Done when:** the issue's latency and autosave acceptance criteria have recorded release/playtest evidence. If the machine or a suitable save fixture is unavailable, mark the corresponding item unverified; do not claim completion.

## Task 5 — Review, close out and keep the same PR

- [ ] Re-read the final diff against this design; confirm it only removes repeated scene-file parsing without changing validation, save ownership, game semantics, or the story.
- [ ] Update the PR body with measured before/after load counts and timings, tests actually run, and any remaining environment-dependent uncertainty.
- [ ] Keep HPA-854 as the sole implementation tracker. Link the PR from Linear, and mark the issue complete **only when** the performance and autosave acceptance tests pass. Do not close it when the design-only Draft PR is opened.
- [ ] Mark the existing Draft PR ready only after tests and runtime verification are complete.

## Explicitly out of scope

No Chapter 2 hotspot placement (HPA-853), save-slot keyboard deletion UX (HPA-830), image assets, scene authoring, generic raw-data cache, persisted cross-session schema changes, app-wide persistence rewrite, or preemptive thumbnail/debounce refactor. Those are separate product concerns, not reasons to split HPA-854 into multiple PRs.

## Reviewer checklist

- [ ] Can multiple acquired records cause more chapter JSON reloads within one capture? **No.**
- [ ] Can invalid source/provenance or duplicate definitions pass because of caching? **No.**
- [ ] Is the performance improvement shared by manual save, list, Continue and autosave without parallel new code paths? **Yes.**
- [ ] Does at least one autosave land while Chapter 2 interrogation is still progressing? **Verified in a real run.**
- [ ] Are any unmeasured release timings honestly marked as pending? **Yes.**
