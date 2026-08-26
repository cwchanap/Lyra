# HPA-536 Chapter 1 Release Readiness

Durable evidence record for the Chapter 1 production release-hardening plan
(HPA-536). Rows start `PENDING` and are updated only with observed outcomes.

## Verification provenance

- Recorded branch (non-canonical, local working branch):
  `jack65786656/hpa-536-post-playtest-hardening-prepare-chapter-1-for-production`
- Recorded head (non-canonical, moves with the working branch):
  `7ab0daf35b1e35c1d7a1bb0e3c883de1e2bb6931`
- Canonical evidence is the command + observed outcome recorded per section
  below, not the branch/head snapshot.
- All Task-1 commits are docs-only, so the verified code state is identical to
  the recorded head.
- Deterministic evidence below was gathered with the repo-documented
  `bun run scenes:compile` resource tree present (see the Step 4 note).

## Canonical persistence baseline

The tested manifest is byte-identical to the source manifest (`cmp` passed):

- Source: `apps/game/src-tauri/resources/scenes/save_content_manifest.json`
- Tested: `apps/game/src-tauri/target-e2e/debug/resources/scenes/save_content_manifest.json`

SAVE_SCHEMA_VERSION: 2
contentRevision: sha256:2d997860ed85592ccca9940e5572bdc80faf65659069fd4c928be073809ca7d7
Verification PR: #74
Verification head: 7ab0daf35b1e35c1d7a1bb0e3c883de1e2bb6931

The `SAVE_SCHEMA_VERSION` / `contentRevision` pair is the merge-stable
compatibility identity. Verification PR/head are provenance only. HPA-540
pointer verification: PASS — `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`
points to this record under “First public release handoff — HPA-536”.

## Deterministic automated evidence

All commands run on 2026-08-25 in the worktree
`hpa-536-plan-chapter-1-production-release-harden`. Every step below passed;
the only failure observed was the first `--all-features` run against an
uncompiled local resource tree, documented in Step 4.

### Step 1 — selected-Load owner (Rust)

- `cargo test --manifest-path apps/game/src-tauri/Cargo.toml transition_contract_load_build_failure_keeps_public_view_and_generation_unchanged -- --nocapture`
- PASS — 1 passed / 0 failed
  (`tests::application_command_contract::transition_contract_load_build_failure_keeps_public_view_and_generation_unchanged`).
  Existing owner in `lib.rs` still covers: `load_save_core` rejects
  incompatible `contentRevision`; `session_observation` before == after;
  observation covers generation + durable revision + serialized public view.

### Step 2 — Analysis persistence integration (Rust)

- `cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::analysis_integration_tests -- --nocapture`
- PASS — 3 passed / 0 failed. Existing owners:
  - `detached_restore_preserves_incomplete_order_draft` — incomplete Order
    restore.
  - `detached_restore_preserves_incomplete_threshold_draft` — incomplete
    Threshold restore.
  - `analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage`
    — Classify acceptance round-trip; completed/read-only review;
    mid-result-dialogue restore; no duplicated board/scene effects.

### Step 3 — focused frontend Analysis/Escape/shell (Vitest)

- `bun run --cwd apps/game test src/lib/components/analysis/AnalysisWorkbench.test.ts src/lib/components/analysis/AnalysisCard.test.ts src/lib/components/analysis/ClassifyBoard.test.ts src/lib/components/analysis/OrderBoard.test.ts src/lib/components/analysis/ThresholdBoard.test.ts src/lib/state/escape-coordinator.test.ts src/lib/components/GameShell.test.ts`
- PASS — 7 files / 214 tests passed, 0 failed. Evidence ownership:
  Analysis ARIA/progress/focus/fallback controls → Analysis component tests;
  topmost Escape/LIFO claim routing → `escape-coordinator.test.ts`; GameShell
  overlay Escape/focus integration → `GameShell.test.ts`. (Topmost Escape
  ordering is therefore NOT repeated as a manual acceptance item.)

### Step 4 — both Rust feature surfaces

- `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`
- PASS — 975 passed / 0 failed (955 lib + 10 `content_manifest_startup` +
  9 `full_playthrough` + 1 `story_catalog_startup`).
- `cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features`
- First run: FAILED — 970 passed / 7 failed. All seven failures were
  `contentManifestLoadFailed` / `sceneLoadFailed` "No such file or directory"
  panics because the local generated resource tree was absent (only
  `.gitkeep` files present). Exact failing test names:
  - `e2e_checkpoint_command_tests::command_builds_replaces_and_returns_one_consistent_checkpoint_transaction`
  - `game::e2e_checkpoints::tests::analysis_beat85_hearing_jump_does_not_seed_approved_clip`
  - `game::e2e_checkpoints::tests::analysis_beat85_ready_checkpoint_seeds_the_packaged_analysis_board`
  - `game::e2e_checkpoints::tests::investigation_and_navigation_targets_replay_real_semantics_and_normalize_projection`
  - `game::e2e_checkpoints::tests::projection_has_the_exact_stable_normalized_wire_shape`
  - `game::e2e_checkpoints::tests::replay_limit_missing_anchor_and_unreachable_target_fail_with_distinct_diagnostics`
  - `game::e2e_checkpoints::tests::right_portrait_checkpoint_replays_to_the_real_soma_dialogue_anchor`
- Environment prerequisite applied (not a code change):
  `bun run scenes:compile` — OK, 1 chapter(s), 17 scene(s); output is the
  gitignored generated resource tree, no tracked file changed.
- Rerun after compile: PASS — 997 passed / 0 failed (977 lib + 10 + 9 + 1).

### Step 5 — frontend/static E2E contract checks

- `bun run --cwd apps/game test` — PASS: 66 files / 1115 tests passed,
  0 failed.
- `bun run --cwd apps/game check` — PASS: svelte-check found 0 errors and
  0 warnings.
- `bun run --cwd apps/game check:e2e` — PASS: `tsc --noEmit -p
  tsconfig.e2e.json` exited 0.
- `bun run --cwd apps/game test:e2e:ci-contracts` — PASS: 148 pass / 0 fail
  / 0 skipped (node --test over the e2e registry/runner/path/planner/metrics/
  results/workflow contract suites).

## Focused packaged Analysis evidence

- Run date: 2026-08-26.
- Build: `cd apps/game && node scripts/build-e2e.mjs` — PASS. Built the debug E2E binary with Cargo feature `e2e` and copied resources into `apps/game/src-tauri/target-e2e/debug/resources/` (5 scene entries).
- Run: `cd apps/game && node scripts/run-save-e2e.mjs --suite analysis-beat85` — PASS. The packaged WebKit run reported 2 passing tests in 4m 1.5s.
- Run ID: `e9927cb0-24a1-4235-9670-ef847ee2953c`.
- Result: `apps/game/e2e-artifacts/save-e2e/runs/e9927cb0-24a1-4235-9670-ef847ee2953c/run-result.json`; observed `selectedSuites: ["analysis-beat85"]`, `suite: "analysis-beat85"`, `result: "passed"`, `exitCode: 0`, and 1 attempt.
- Save → Title → Continue evidence:
  - Classify: saved `Beat 8.5 分類部分草稿`, returned to Title, then Continue restored the partial `miyake_call → miyake_small_lies` and `miyake_pov_replay → earlier_third_party` draft; the completed Classify board submitted and reached its authored result dialogue.
  - Order: saved `Beat 8.5 順序部分草稿`, returned to Title, then Continue restored the partial order `[event_1841, event_1843]` with the fixed `event_1841` prefix; the completed Order board submitted and reached its authored result dialogue.
  - Threshold: saved `Beat 8.5 門鎖申請草稿` with `selectedCardIds: ["lock_sequence"]`, returned to Title, then Continue restored that exact one-card draft; adding `phone_notification` and submitting completed Threshold.
- Hearing handoff: PASS. The packaged journey reached `interrogation_scene_10` with fact `two_independent_lock_contradictions_identified` and completed objective `prepare_narrow_lock_request`, with `approved_clip` absent before the gate. Completing p1, p2, p3, and the gate made p4 visible and produced exactly one `narrow_lock_export` authorization and exactly one `approved_clip`.

## 1280x720 packaged capture evidence

The existing `analysis-beat85` geometry test and capture helper owned the viewport request/assertions; this is not a manual-only fit claim.

- Analysis Classify capture metadata: requested `1280x720`; observed `1280x720`; device pixel ratio `2`; `strict: false`.
- The run also captured the following relative PNG/JSON pairs under `apps/game/e2e-artifacts/save-e2e/runs/e9927cb0-24a1-4235-9670-ef847ee2953c/`:
  - `outputs/attempt-1/analysisBeat85/analysis-beat85/analysis-classify-css-1280x720.png`
  - `outputs/attempt-1/analysisBeat85/analysis-beat85/analysis-classify-css-1280x720.json`
  - `outputs/attempt-1/analysisBeat85/analysis-beat85/interrogation-menu-css-1280x720.png`
  - `outputs/attempt-1/analysisBeat85/analysis-beat85/interrogation-menu-css-1280x720.json`
  - `outputs/attempt-1/analysisBeat85/analysis-beat85/interrogation-present-css-1280x720.png`
  - `outputs/attempt-1/analysisBeat85/analysis-beat85/interrogation-present-css-1280x720.json`
  - `outputs/attempt-1/analysisBeat85/analysis-beat85/interrogation-testimony-rebut-css-1280x720.png`
  - `outputs/attempt-1/analysisBeat85/analysis-beat85/interrogation-testimony-rebut-css-1280x720.json`
  - `outputs/attempt-1/analysisBeat85/analysis-beat85/interrogation-testimony-tall-css-1280x800.png`
  - `outputs/attempt-1/analysisBeat85/analysis-beat85/interrogation-testimony-tall-css-1280x800.json`
- All four 1280x720 sidecars observed `1280x720` at DPR 2; the 1280x800 sidecar observed `1280x800` at DPR 2. The geometry-contract test passed. The runner logged an initial viewport-normalization retry for the Case File and each capture, but the final observed metadata was exact and the suite remained green.

## Physical desktop observation

PENDING

## Reduced-motion observation

PENDING

## Keyboard-only Analysis observation

PENDING

## VoiceOver observation

PENDING

## Bounded long-session observation

PENDING

## Full packaged closeout

### Historical failed run (superseded by the gate-closing rerun)

- Command (run exactly once): `bun run --cwd apps/game test:e2e:all`
- Run ID: `bee3808d-1d10-4174-90f6-cef0e3b889eb`.
- Result: `apps/game/e2e-artifacts/save-e2e/runs/bee3808d-1d10-4174-90f6-cef0e3b889eb/run-result.json`.
- Outcome: **FAIL** — `result: "failed"`, `exitCode: 1`, one configured/used attempt, zero retries. `smoke`, `gameplay`, and `production-journey` passed; `analysis-beat85` failed and stopped the registry before the remaining selected persistence and exit phases.
- `analysis-beat85` failures:
  - `persists partial Analysis drafts, proves pointer ordering, and reaches p4` — `refreshed manual save browser did not appear` (`helpers.ts:907`, called from `analysis-beat85.e2e.ts:1147`).
  - `matches the Interrogation mockup geometry contract` — `expect(received).toBeDefined()` received `undefined` (`analysis-beat85.e2e.ts:1319`).

Historical repository checks for the failed invocation:

- `bun run check` — PASS: 3 successful / 3 total; svelte-check reported 0 errors and 0 warnings.
- `bun run lint:all` — PASS: ESLint, Prettier, Rust fmt, and Rust clippy all passed.

### Gate-closing full run

- Command (authorized rerun, run exactly once):
  `bun run --cwd apps/game test:e2e:all`
- Run ID: `6de0b45b-3017-47d3-a860-98b5bdd9070d`.
- Result: **PASS** — `apps/game/e2e-artifacts/save-e2e/runs/6de0b45b-3017-47d3-a860-98b5bdd9070d/run-result.json` records `result: "passed"`, `exitCode: 0`, one configured/used attempt, zero retries, and no final failed suite.
- Registry selection: `forcedFull: true`, `reason: "direct-full"`; selected suites were `smoke`, `gameplay`, `production-journey`, `analysis-beat85`, `capture-proof`, `save-core`, `save-management`, and `exit-lifecycle`.
- All selected suites passed:
  - `smoke` — PASS.
  - `gameplay` — PASS.
  - `production-journey` — PASS.
  - `analysis-beat85` — PASS.
  - `capture-proof` — PASS.
  - `save-core` — PASS (`save-seed`, `save-resume`).
  - `save-management` — PASS (`management-seed`, `management-corrupt-newest`, `management-missing-thumbnail`, `management-corrupt-thumbnail`).
  - `exit-lifecycle` — PASS (`exit-close-seed`, `exit-close-resume`, `exit-quit-resume`, `exit-failure-bypass`, `exit-final-verification`).
- All 16 phases passed in one attempt; no first-attempt failures, recovered flakes, or final failed suite.
- The invocation rebuilt the tested E2E binary and copied 5 scene entries into `apps/game/src-tauri/target-e2e/debug/resources/`.
- Baseline verification after the run: `cmp apps/game/src-tauri/resources/scenes/save_content_manifest.json apps/game/src-tauri/target-e2e/debug/resources/scenes/save_content_manifest.json` — PASS. Observed `SAVE_SCHEMA_VERSION: 2` and `contentRevision: sha256:2d997860ed85592ccca9940e5572bdc80faf65659069fd4c928be073809ca7d7`.

### Final repository checks after the green rerun

- `bun run check` — PASS: 3 successful / 3 total; svelte-check reported 0 errors and 0 warnings.
- `bun run lint:all` — PASS: ESLint, Prettier, Rust fmt, and Rust clippy all passed.

## Accepted limitations

The manual real-host acceptance sections remain `PENDING` for the human Task 3;
that outstanding work is a recorded limitation of this evidence record:
Physical desktop observation, Reduced-motion observation, Keyboard-only Analysis
observation, VoiceOver observation, and Bounded long-session observation.

## Release blockers / follow-ups

- Task 2b repair (2026-08-26): the blocker reproduced in both
  `bee3808d-1d10-4174-90f6-cef0e3b889eb` (full registry, stopped at
  `analysis-beat85`) and `7783d18b-ef5d-4598-b122-d95c78d40279` (focused).
  Both failures had the same `refreshed manual save browser did not appear`
  timeout and the dependent geometry test then saw `geometry.menu` as undefined.
  The failure artifacts' `manual-3.json` files contain the expected saved name
  and exact Threshold draft, while the WDIO logs show packaged discovery taking
  beyond the helper's 30-second refresh wait. The geometry failure was a
  downstream test-order effect: the first test aborted before collecting menu,
  testimony, and Present geometry; no separate app defect was reproduced.
- Changed owner: `apps/game/e2e-tauri/helpers.ts` (`saveManualSlot`, lines
  897-913). Fix: increase only the refreshed Save Browser condition wait from
  30,000ms to 90,000ms; no production or registry changes were made.
- Fresh verification: build plus focused run
  `3390fa4e-9024-470f-8e3e-d04920427f6c` — PASS, both tests; immediately
  followed by focused run `4af9afe9-8620-43ed-8245-7947a4e6fff2` — PASS, both
  tests. `bun run --cwd apps/game check:e2e` also passed. The authorized green
  full-registry rerun is recorded above and closes this automated packaged gate.

- The failed `bee3808d-1d10-4174-90f6-cef0e3b889eb` closeout is superseded by
  the green gate-closing run `6de0b45b-3017-47d3-a860-98b5bdd9070d`; the
  `analysis-beat85` timing blocker is resolved by the focused helper wait
  change recorded above.
- Human Task 3 must complete the five still-`PENDING` real-host observations
  before the release decision.
