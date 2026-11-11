# HPA-854 — Save/Load Performance: Reuse the Capture Scene Cache

> **Status:** design-only Draft PR (no runtime fix in this commit). **Issue:** [HPA-854](https://linear.app/cwchanap/issue/HPA-854/saving-loading-and-autosave-slow-to-minutes-as-the-story-progresses). **Baseline:** `main` inspected on 2026-11-11.

## Problem and player impact

The 2026-11-11 packaged Chapter 1–2 playtest reported manual save taking ~115 s, Continue ~105 s, save-list loading several minutes, and delayed/missing autosaves late in Chapter 2. The debug build amplifies elapsed times, but the measured repeated work is independent of build configuration. Eight slots had 259 collected records in total; a late Chapter 2 checkpoint held 83.

The relevant path is:

```text
list_saves -> discover_saves -> discover_slot -> build_restore_candidate
  -> capture_checkpoint -> validate_inventory
  -> validate_inventory_record (for each evidence/statement)
  -> GameEngine::packaged_acquisition_scene
  -> find_scene_json_by_id -> load_chapter_scene_jsons
  -> re-read and deserialize every scene in the chapter
```

Manual save, autosave, save-browser opening, and Continue all exercise the same capture/recapture validation in different places. In particular, `build_restore_candidate` intentionally recaptures a detached restored game and compares the exact snapshot; **do not remove that correctness boundary for speed**.

`apps/game/src-tauri/src/game/save/capture.rs` already creates one `SceneCache = HashMap<String, Vec<SceneJson>>` in `capture_checkpoint`, and uses `chapter_scenes` to load each chapter lazily for location, scene progress, and dialogue-history validation. Inventory validation alone bypasses it and calls `packaged_acquisition_scene` afresh **per record**. The navigation helper's comment correctly assumes infrequent *user-driven scene jumps*, not hundreds of save validations.

## Design decision

**Reuse the existing capture-local `SceneCache` for inventory validation. No new cache owner, persistence layer, save format, or application-wide index.**

1. Pass `&mut SceneCache` from `capture_checkpoint` to `validate_inventory`, then to `validate_inventory_record`. Retain the existing order: validate the record's catalog identity/provenance first, then verify that its source scene manifest contains the evidence/statement ID.
2. Resolve the unique chapter from `engine.chapters` and read its scenes through the existing `chapter_scenes(engine, chapter, cache)`. Search the already-parsed `Vec<SceneJson>` **by reference** for the specified scene ID; check its `evidence_manifest` or `statement_manifest` as before. At the Chapter 2 scale (33 scenes), an in-memory scan per record is cheaper and simpler than building another index. Do not clone a whole `SceneJson` for each record.
3. Preserve the currently enforced error cases: missing/duplicate chapter IDs, missing/duplicate scene IDs, a matching Linear/Analysis scene (not an acquisition origin), missing manifest entry, and catalog/provenance mismatch. Return existing typed `GameError` variants; do not accept a record that previously failed capture. Preserve the `#[cfg(test)]` empty-resource-dir fallback used by `GameEngine::packaged_acquisition_scene` if it is exercised by synthetic test fixtures.
4. Keep the cache **per `capture_checkpoint` call**. It is discarded afterward and cannot become stale across content changes, session transitions, or chapter navigation. Do not share `ApplicationPersistence::discovery.definitions` with `GameEngine` just to save a few reads; those have deliberately separate responsibilities.

The expected work changes from chapter file parsing per `record` to chapter file parsing per **distinct chapter required by one capture**. `capture_history` and current scene validation continue using that same cache. Save discovery may still validate each slot separately; that is acceptable for eight slots unless release profiling demonstrates another bottleneck.

## Constraints and non-goals

- Preserve `SaveSnapshot` JSON bytes/semantics, content revision, exact restore recapture equality, per-record provenance, scene-type checks, and all corruption rejection behavior. No migration or backward-compatibility work.
- Preserve one `ApplicationPersistence` and its existing `operation_gate`; no extra task scheduler, persistence repository, global memoization, or background preload.
- Do not optimize `navigation::find_scene_json_by_id` for player-driven jumps, nor change scene compiler output or authored Chapter 1/2 content.
- Do not change thumbnail capture, autosave debounce, retry/health rules, or save UI **without a post-cache-fix reproduction identifying an independent problem**. `staleThumbnailTicket` warnings can reflect intentional supersession; the metric that matters is actual durable autosave progress.
- No story edits, art, audio, or new assets.

## Evidence and validation contract

**Deterministic regression:** Reuse the existing `CHAPTER_SCENE_LOAD_COUNT` test counter in `navigation.rs`. A `capture_checkpoint` of a fixture with multiple valid inventory records from one chapter must not increase chapter-file loads per additional record; the counter stays bounded by the distinct chapters touched by the capture. Compare empty vs multi-record capture using equivalent fixture state. The old per-record implementation should fail this assertion.

**Correctness regression:** Existing inventory rejection tests (invalid source, invalid provenance, unsupported scene kind) and exact save restore/recapture tests must remain green. Add only a small focused test if a duplicate/missing-origin edge is not already covered; do not create a new mock scene-loading framework.

**Release/playtest acceptance:** In a release build, use a late Chapter 2 state comparable to the report (roughly 74 evidence, 9 statements and populated save slots). Record elapsed time for manual save, open save list, Continue, restart/return-to-title; manual save, save-list and Continue should each take about **one second or less** on the measured machine. Verify completed save contents restore exactly, and that an autosave actually lands *during* ordinary continuous interrogation play, rather than only after reaching the end screen. Log timestamps and revisions so visual feedback is not mistaken for write completion.

If the chapter-load counter is fixed but timings remain high, profile the next real hot path first. If fast captures still leave a genuine autosave gap during continuous play, inspect the existing 500 ms trailing debounce and thumbnail supersession in `save/application/autosave.rs` and address the **smallest independently reproduced scheduling problem in this same ticket/PR**, with one focused deterministic test. Do not preemptively redesign autosave to solve a hypothetical second issue.

## Review and delivery boundary

**One Linear issue, one PR.** This Draft PR first records the design and implementation plan; implementation, regression tests, measured release verification, and any design correction discovered during review go into the **same** PR before marking ready. The PR is not a claim that the performance defect is fixed yet.
