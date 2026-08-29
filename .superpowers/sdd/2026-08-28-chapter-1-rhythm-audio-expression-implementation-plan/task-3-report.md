# Task 3 implementation report

## Status

BLOCKED for the required real packaged `analysis-beat85` evidence. The closed
late-arc structural slice is implemented and all source-level, compiler,
inventory, focused-test, type-check, and packaged-build gates pass. The
packaged runner cannot create a WebDriver session on this host after the
normal sandbox attempt and elevated retry path; no substitute evidence is
claimed.

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
- Required real packaged run:
  `node scripts/run-save-e2e.mjs --suite analysis-beat85` first hit the
  sandbox's embedded-driver readiness timeout on port 4445. Elevated retries
  reached the runner but failed session creation with
  `UND_ERR_INVALID_ARG` on `POST http://127.0.0.1:4445/session`; the normal
  two-attempt retry failed identically on both attempts (run
  `11c92358-100e-4f58-ab36-bc317f6efb99`). Guarded app-data roots were cleaned
  after each run. `check:e2e` is not used as a substitute.
- `git diff --check`: pass.

## Concerns

The packaged analysis journey remains unverified solely because the local
embedded WebDriver cannot create a session after the normal escalation and
retry path. The fresh packaged binary does build, and the failure occurs
before the suite can execute any gameplay assertion. No synthetic Rust
fixture, production anchor, generated resource, or progress ledger was
changed.
