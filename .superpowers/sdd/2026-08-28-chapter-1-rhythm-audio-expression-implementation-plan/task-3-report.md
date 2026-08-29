# Task 3 implementation report

## Status

Complete. The closed late-arc structural slice is implemented and all
source-level, compiler, inventory, focused-test, type-check, packaged-build,
and real packaged `analysis-beat85` gates pass. The implementer recorded a
transient pre-session `UND_ERR_INVALID_ARG`; a controller-owned retry after
confirming port 4445 was clear created a real session and passed the suite.

Implementation commit: `82dc39f8a8a07db099ea345f334b034e380c0468`

Baseline: `bfa011c134e6b0262b9cc0ad8d30f9b22c7c7d3b`

## Files

The implementation commit changes only:

- `docs/stories_plan/chapter_1/investigation_scene_7.md`
- `docs/stories_plan/chapter_1/investigation_scene_8.md`
- `docs/stories_plan/chapter_1/analysis_scene_8_5.md`
- `docs/stories_plan/chapter_1/investigation_scene_9.md`
- `docs/stories_plan/chapter_1/interrogation_scene_10.md`
- `docs/stories_plan/chapter_1/scene_11.md`
- `docs/stories_plan/chapter_1/background-variety-audit.md`
- `packages/scripts/compile-scenes.test.ts`
- `packages/scripts/__snapshots__/compile-scenes.test.ts.snap`
- `apps/game/e2e-tauri/analysis-beat85.e2e.ts`

This report is an additional file. `progress.md`,
`apps/game/src-tauri/src/game/analysis_integration_tests.rs`, and
`apps/game/e2e-tauri/production-anchors.ts` were not edited. No new expression
slugs, audio, or raster assets were added.

## Exact structural mapping

- Scene 7 keeps the production investigation IDs, evidence/reveal wiring,
  hotspots, and anchored text while tightening the authored discovery beats.
- Scene 8 keeps the phone screenshot, fixed-panel, local-sequence, telecom
  confirmation, evidence, and reveal wiring while tightening its dialogue.
- Analysis Scene 8.5 still has exactly the classify, order, and threshold
  boards. Classify now contains only `miyake_call`, `miyake_pov_replay`, and
  `external_credential_event`, with only `miyake_small_lies` and
  `earlier_third_party`. The order cards, accepted order, fixed anchor, fact
  reveal, threshold cards, and threshold rule remain unchanged. Its result
  dialogue now carries the approved existing
  `background.chapter_1.investigation_scene_8.fixed_panel` cue before the
  order board.
- Scene 9 merges the clerk's long-day and thermos beats, removes the
  `kitami_glasses` topic, and retains the slipping-glasses action motif,
  evidence, and reveals.
- Scene 10 has exactly `p1`, `gate`, `p4`, and `p5`. `q_p1`, `q_p2`, and
  `q_p3` run sequentially in `p1`; `q_p2` unlocks after `q_p1` and `q_p3`
  after `q_p2`. The gate requires `phase:p1 completed` plus
  `objective:prepare_narrow_lock_request completed`. The Outro adds the
  formal ruling boundary using the existing p5 plate.
- Scene 11 closes the USB beat before the lawful public-media bridge, includes
  the exact `2016 年青葉記憶研究所火災` preview line, shows only one unlabeled
  low-resolution corridor/fire frame, and quickly mutes it. The bridge and
  final blue-umbrella coda reuse existing `scene_11.tag_006`; no USB/private
  file and Aoba material share a frame.
- The background report now contains the exact 57-row compiler inventory,
  including the classify-to-order and ruling cues, corrected queue/phase
  paths, Scene 11 bridge/final reuse, and a `Retired hearing plates` note for
  the former p2/p3 plates.

## Review round 1 fix

The review found one descriptive drift in the analysis Scene 8.5 intro row.
The row now describes the authored Rain Bell fixed-panel backdrop and its
continuity anchors instead of a police-station vending corridor. Its cue key,
decision, and priority are unchanged; no authored scene, runtime, or test
content was changed.

- `bun run background-cues:audit --chapter chapter_1 --check-report
  docs/stories_plan/chapter_1/background-variety-audit.md`: pass; the exact
  57-cue inventory still matches the report with no missing files or stale
  rows.
- `git diff --check`: pass.

## Verification evidence

- `bun run scenes:compile`: pass; 1 chapter, 17 scenes, backgrounds 52,
  portraits 17, standees 0, evidence 30, audio 18, compiler warnings 0.
  The existing singleton `victim_phone_device` layout warning remains.
- `bun run background-cues:audit --chapter chapter_1 --check-report
  docs/stories_plan/chapter_1/background-variety-audit.md`: pass; 57 exact cue
  occurrences, no missing files, stale keys, duplicate rows, or report
  problems.
- The two named live-corpus tests were run first without `-u`: all explicit
  structural assertions passed; the sole failure was the expected snapshot
  content revision mismatch (`67112ee6...` to `c6327a19...`). The snapshot was
  then updated and inspected; the final focused compiler run passed 87/87
  tests.
- `bun run check:scripts`: pass.
- `bun run --cwd apps/game check:e2e`: pass (`tsc --noEmit -p
  tsconfig.e2e.json`).
- `node scripts/build-e2e.mjs`: pass; fresh `target-e2e/debug/lyra` built,
  resources copied, and packaged resources contained 5 scene entries.
- Required real packaged run: the implementer's first sandbox attempt hit the
  embedded-driver readiness timeout and elevated run
  `11c92358-100e-4f58-ab36-bc317f6efb99` failed before session creation with
  `UND_ERR_INVALID_ARG`. After confirming no listener remained on port 4445,
  the controller reran the already-built artifact with
  `rtk node scripts/run-save-e2e.mjs --suite analysis-beat85 --attempts 2`.
  Run `f41e06d7-1e99-4f3c-8c3c-10a7cd05876c` passed on attempt 1: 2/2 tests
  passed in 7m30.2s, covering partial-draft persistence, pointer ordering,
  threshold/objective flow through p4, and Interrogation geometry. Cleanup
  removed the guarded app-data root. `check:e2e` is not used as a substitute.
- `git diff --check`: pass.

## Concerns

No Task 3 gate remains open. The earlier WebDriver session error was transient
and occurred before gameplay; the later real packaged run passed without a
retry. No synthetic Rust fixture, production anchor, or generated resource was
changed.
