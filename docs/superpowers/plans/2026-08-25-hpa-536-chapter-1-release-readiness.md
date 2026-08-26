# HPA-536 Chapter 1 Release Readiness

Durable evidence record for the Chapter 1 production release-hardening plan
(HPA-536). Rows start `PENDING` and are updated only with observed outcomes.

## Verification provenance

- Recorded branch (non-canonical, local working branch):
  `jack65786656/hpa-536-post-playtest-hardening-prepare-chapter-1-for-production`
- Recorded head (non-canonical, moves with the working branch):
  `366bff67110f3146c16c3e1f73b1c7f81da6e749`
- Canonical evidence is the command + observed outcome recorded per section
  below, not the branch/head snapshot.
- All Task-1 commits are docs-only, so the verified code state is identical to
  the recorded head.
- Deterministic evidence below was gathered with the repo-documented
  `bun run scenes:compile` resource tree present (see the Step 4 note).

## Canonical persistence baseline

PENDING — to be filled by Task 4 (`SAVE_SCHEMA_VERSION` / `contentRevision`
read from the tested full-build resources; deliberately not recorded here yet).

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

PENDING

## 1280x720 packaged capture evidence

PENDING

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

PENDING

## Accepted limitations

PENDING

## Release blockers / follow-ups

PENDING
