# HPA-560 Tauri E2E Orchestration Collapse Implementation Plan

> **Status:** Draft implementation plan. Planning-only at this revision. Execute this plan on the **same HPA-560 branch and PR** after review.

**Spec:** `docs/superpowers/specs/2026-09-16-hpa-560-tauri-e2e-orchestration-collapse-design.md`

**Linear:** HPA-560


## Goal

Replace Lyra's custom changed-path Tauri E2E CI scheduler with the smallest useful packaged verification policy:

- every **non-draft** PR runs the existing smoke suite after expanding it with one semantic Beat 8.5 save/continue slice;
- nightly/manual/tag and explicit `ci:full-e2e` run the existing broad packaged command;
- deterministic permutations stay at Rust/frontend/compiler layers;
- existing gameplay, Analysis remainder, production journey, capture, save/recovery, and exit packaged responsibilities stay in full verification;
- delete planner/router/metrics/aggregate machinery instead of replacing it.

This ticket remains one implementation PR. Do not split planning, workflow cleanup, runner cleanup, smoke construction, or live-doc updates across multiple PRs.


## Architecture after implementation

```text
non-draft PR without ci:full-e2e
└─ normal checks
└─ Tauri E2E
   └─ run `test:e2e:smoke` (build once + expanded existing smoke)

schedule / workflow_dispatch / tag / non-draft PR with ci:full-e2e
└─ Tauri E2E
   └─ run `test:e2e:all` (build once + broad registry)
```

A plain push to `main` no longer forces packaged full E2E; normal main-push checks remain and nightly owns broad packaged confidence.

Removed concepts:

```text
changed paths
-> risk rules
-> planner JSON
-> chain partition
-> matrix jobs
-> per-chain metrics/evidence
-> aggregate analyzer
```

No replacement selector is introduced.


## Global constraints

- Keep one PR for HPA-560.
- Refresh/rebase onto current `main` before implementation; PR #89 has merged and changed production E2E anchors.
- Prefer deletion over moving code into new abstractions.
- Expand `apps/game/e2e-tauri/smoke.e2e.ts`; do **not** add `pr-smoke.e2e.ts`.
- Keep existing `test:e2e:smoke` and `test:e2e:all` command names unless implementation proves a rename materially clearer.
- Reuse existing Beat 8.5 checkpoint/save/continue helpers; do not add a new native E2E API.
- Do not add investigation acquisition or city-map hops to the universal smoke; those stay in full packaged coverage.
- Preserve dynamic thumbnail capture and its broad `capture-proof` responsibility from HPA-550.
- Preserve gameplay, production journey, Analysis remainder, representative save/recovery, and exit lifecycle packaged coverage in full verification.
- Preserve the current draft-PR heavy-job skip.
- Keep human-facing job name `Tauri E2E` for continuity, but do not treat it as branch-protection compatibility: the current ruleset has no required-status-check rule.
- Set the PR smoke timeout to **45 minutes** and the direct full timeout to **120 minutes**.
- Preserve `CARGO_TARGET_DIR=apps/game/src-tauri/target-e2e` in both packaged jobs.
- Give both packaged jobs one shared Rust-cache `shared-key` (for example `tauri-e2e-v2`) so nightly/default-branch cache warming benefits PR smoke; `Swatinem/rust-cache` defaults `add-job-id-key: true`, so `prefix-key` alone would still key each job id separately.
- Run both packaged commands under `xvfb-run -a` on Ubuntu CI; the package scripts themselves intentionally do not own Linux display setup.
- Keep smoke at one attempt; change `test:e2e:all:run` to pass `--attempts 2`.
- Do not preserve old planner JSON, suite-file, chain-id, or plan-file contracts for compatibility.
- Do not create a generalized reusable CI framework.
- Update `CLAUDE.md`; `AGENTS.md` is its symlink and updates with it.


## Task 0 — Record the current baseline without blocking implementation

### Purpose

HPA-560 requires before/after evidence. Record it in this PR, but do not hold smoke implementation behind collecting the complete sample.

Recent evidence already supports the architecture:

- scheduled 2026-09-17 workflow: ~23m wall-clock;
- scheduled 2026-09-16 workflow: ~24m27s;
- scheduled 2026-09-13 workflow: ~21m05s;
- 2026-09-17 packaged test steps: gameplay ~20m05s, persistence ~10m26s, exit ~3m41s;
- a shared setup/build from that run is roughly ~2m05s, putting a direct sequential estimate near ~36m under the observed cache state.

### Files

Modify:

- `docs/superpowers/specs/2026-09-16-hpa-560-tauri-e2e-orchestration-collapse-design.md`
- optionally the PR body with the concise baseline table

Do not change runtime/CI behavior as part of this task.

### Steps

1. Refresh from current `main` and record the base SHA.
2. Start the baseline table immediately with the already-observed scheduled data.
3. Before merge, fill the requested sample where available:
   - latest **5 comparable PR runs** where packaged E2E executed;
   - latest **3 scheduled/manual/full runs**.
4. Record:
   - median whole-workflow / packaged-E2E wall time;
   - representative setup/build/test split;
   - visible retry/flake count;
   - current planner/router/metrics/analyzer production LOC and test LOC separately;
   - current suite list and the locked post-HPA-560 owner from the design.
5. Inventory current consumers before deletion:

```bash
rg -n "select-e2e-suites|plan-e2e-ci|e2e-ci-metrics|e2e-ci-results|e2e-plan|chain-id|suite-file|plan-file|run-ownership|ci:full-e2e" .
```

Implementation Task 1 may proceed while the full 5+3 table is being completed. The evidence table must be complete before the PR is marked ready, not before code changes begin.

### Commit

If this task produces a standalone documentation checkpoint:

```bash
git add docs/superpowers/specs/2026-09-16-hpa-560-tauri-e2e-orchestration-collapse-design.md
git commit -m "docs: record HPA-560 E2E baseline"
```



## Task 1 — Expand the existing smoke with one semantic save/continue slice

### Purpose

Create the replacement packaged PR proof first while the old scheduler is still available. Do not add a third Chapter 1 journey.

### Files

Modify:

- `apps/game/e2e-tauri/smoke.e2e.ts`
- `apps/game/e2e-tauri/helpers.ts`
- `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- `apps/game/package.json` only if command wiring needs adjustment

Reference existing behavior from:

- `apps/game/e2e-tauri/smoke.e2e.ts`
- `apps/game/e2e-tauri/analysis-beat85.e2e.ts`

Do **not** copy from `investigation-layout.e2e.ts` into smoke; its acquisition and city-map coverage remains in full verification.

### Mandatory Analysis helper extraction

The smoke cannot safely reuse the Beat 8.5 interaction without extracting the existing spec-local helper path. This is required, not optional.

Move these four functions from `analysis-beat85.e2e.ts` into existing `helpers.ts` and export them:

- `analysisBoard`;
- `waitForAnalysisBoard`;
- `waitForClassifyDraft`;
- `dragAnalysisCardSynthetic`.

Parameterize `waitForAnalysisBoard` so it does not capture the spec-local `ANALYSIS_SCENE_ID`; callers pass the expected scene ID explicitly (or use the smallest equivalent parameter shape).

Keep `dragAnalysisCardSynthetic` behavior byte-for-byte equivalent apart from the move. Its synthetic `PointerEvent` transport is already the accepted packaged-WebKit interaction path; do not replace it with a W3C drag attempt or add a fallback.

Update `analysis-beat85.e2e.ts` to import these helpers. This is a reuse extraction, not a rewrite of the full Analysis spec.

### Test-first contract

Retain the existing smoke checks, then add one semantic persistence slice:

1. Launch the packaged binary on a clean test root.
2. Preserve clean-title proof.
3. Preserve typed pre-start `get_state` error proof.
4. Start Chapter 1 and prove real compiled dialogue/resources render.
5. Load existing `chapter-1-analysis-beat-85-ready`.
6. Perform **one** meaningful classify placement through `dragAnalysisCardSynthetic`.
7. Wait for the exact classify draft through `waitForClassifyDraft`.
8. Explicitly save to a manual slot.
9. Return to title.
10. Continue.
11. Assert the exact expected Analysis semantic draft survived.
12. Perform one further production Analysis interaction after resume.

### Important cuts

The smoke must **not** absorb:

- investigation hotspot acquisition;
- city-map mouse/keyboard/layout/raster checks;
- geometry-heavy Analysis assertions;
- multiple classify/order permutations;
- full Analysis completion;
- interrogation traversal;
- screenshots/mockup captures;
- corruption/recovery cases;
- thumbnail fidelity;
- exit failure modes;
- full Chapter 1 organic traversal.

Those remain in full/focused suites.

### No new native seam

Use the existing checkpoint bridge and save/continue helpers. If the smoke appears to need a new native endpoint, simplify the smoke instead.

### Package command

Keep the existing ordinary command and its fail-fast one-attempt behavior:

```bash
bun run --cwd apps/game test:e2e:smoke
```

Do not add `test:e2e:pr-smoke`.

### Verification

```bash
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:smoke
```

### Commit

```bash
git add apps/game/e2e-tauri apps/game/package.json
git commit -m "test: expand packaged smoke with semantic resume"
```


## Task 2 — Cut CI over to direct smoke/full commands while old runner flags still exist

### Purpose

Remove the workflow's dependency on planner-generated suite files **before** deleting runner support for those flags. This keeps the branch's CI contract coherent at every commit boundary.

### Files

Modify:

- `.github/workflows/ci.yml`
- `apps/game/package.json`
- `apps/game/scripts/e2e-ci-workflow.test.mjs`

### Shared packaged-job environment

Both packaged jobs must use:

```yaml
env:
  CARGO_TARGET_DIR: apps/game/src-tauri/target-e2e
```

Both use the same Rust cache contract:

```yaml
uses: Swatinem/rust-cache@v2
with:
  workspaces: apps/game/src-tauri -> target-e2e
  prefix-key: tauri-e2e-v2
  shared-key: tauri-e2e-v2
```

Do not invent separate smoke/full cache keys. `shared-key` is required, not just `prefix-key`: rust-cache defaults `add-job-id-key: true`, so without `shared-key` the two job ids would resolve different entries. The shared key lets the nightly/default-branch run warm the cache that PR branches can restore. The first run under `v2` is cold by definition, so the timeout must not assume the ~2 minute warm setup/build sample.

### PR smoke job

Replace planner + matrix + aggregate flow for ordinary PRs with one direct job:

```text
non-draft PR without ci:full-e2e
-> job display name: Tauri E2E
-> checkout/setup
-> shared E2E Rust cache
-> xvfb-run -a bun run --cwd apps/game test:e2e:smoke
-> upload normal logs/screenshots/artifacts
```

Set `timeout-minutes: 45`.

Keep the current draft skip. Non-draft documentation-only PRs still run the smoke; do not add a docs exception table.

### Full job

Use one direct broad job for:

- `schedule`;
- `workflow_dispatch`;
- tag/release push;
- **non-draft** PR carrying `ci:full-e2e`.

Shape:

```text
-> job display name: Tauri E2E
-> checkout/setup
-> shared E2E Rust cache
-> xvfb-run -a bun run --cwd apps/game test:e2e:all
-> upload normal logs/screenshots/artifacts
```

Set `timeout-minutes: 120`. The configured `--attempts 2` retry must fit inside the ceiling even on a cold cache: ~24 min cold `target-e2e` build + setup + two ~34-38 min sequential passes + artifact upload is ~100 min, so 90 was not enough headroom.

A plain push to `main` does **not** run packaged full after HPA-560.

Make the PR-smoke and PR-full predicates mutually exclusive so `ci:full-e2e` does not pay twice, and ensure the full PR predicate keeps `draft == false` so adding the label to a draft cannot resurrect heavy CI.

### Full retry contract

Update:

```json
"test:e2e:all:run": "node scripts/run-save-e2e.mjs --full --attempts 2"
```

Do **not** add `--attempts 2` to smoke. Ordinary PR smoke remains fail-fast; broad/full verification tolerates one retry.

### Surviving Node contract tests

The current `test:e2e:ci-contracts` call lives only in the planner job, so deleting that job would otherwise silently stop the direct safety tests.

In this same task, add a named step to the existing `lint-frontend` / frontend-check job, near `check:e2e`:

```bash
node --test \
  apps/game/scripts/e2e-suite-registry.test.mjs \
  apps/game/scripts/e2e-runner-lifecycle.test.mjs \
  apps/game/scripts/save-e2e-paths.test.mjs \
  apps/game/scripts/e2e-ci-workflow.test.mjs
```

Do not defer this to Task 4. The surviving contracts must never have a commit where no CI job runs them.

### Workflow policy test

Rewrite `e2e-ci-workflow.test.mjs` to lock:

- one non-draft PR smoke path;
- one full path for schedule/manual/tag/non-draft `ci:full-e2e`;
- mutual exclusion on `ci:full-e2e`;
- no main-push packaged full;
- display name `Tauri E2E`;
- smoke timeout 45;
- full timeout 120;
- shared `CARGO_TARGET_DIR`;
- shared Rust-cache `shared-key`;
- both packaged invocations wrapped in `xvfb-run -a`;
- direct package commands `test:e2e:smoke` and `test:e2e:all`;
- the explicit surviving Node-contract step in `lint-frontend`;
- no planner job;
- no matrix;
- no plan artifact;
- no metrics wrapper;
- no aggregate routing validator.

The current repository ruleset has no required-status-check rule. The display name is continuity only.

### Verification

```bash
node --test apps/game/scripts/e2e-ci-workflow.test.mjs
node --test apps/game/scripts/e2e-suite-registry.test.mjs
node --test apps/game/scripts/e2e-runner-lifecycle.test.mjs
node --test apps/game/scripts/save-e2e-paths.test.mjs
bun run check
bun run lint
bun run format:check
```

At this point the workflow uses only direct package commands, but the old runner/planner flags may still exist unused. Remove them next.

### Commit

```bash
git add .github/workflows/ci.yml apps/game/package.json apps/game/scripts/e2e-ci-workflow.test.mjs
git commit -m "ci: cut Tauri E2E to direct smoke and full paths"
```


## Task 3 — Simplify runner selection and registry after workflow cutover

### Purpose

Now that CI no longer passes planner-generated files, make the runner direct: named suites or full mode, with no chain IDs or planner metadata.

### Files

Modify as needed:

- `apps/game/scripts/run-save-e2e.mjs`
- `apps/game/scripts/e2e-suite-registry.mjs`
- `apps/game/scripts/e2e-runner-selection.mjs`
- `apps/game/scripts/e2e-runner-lifecycle.mjs`
- `apps/game/scripts/e2e-suite-registry.test.mjs`
- `apps/game/scripts/e2e-runner-lifecycle.test.mjs`
- `apps/game/scripts/save-e2e-paths.test.mjs`
- `apps/game/package.json`

### Desired public command surface

```bash
bun run --cwd apps/game test:e2e:smoke
bun run --cwd apps/game test:e2e:all
```

Focused commands such as `test:e2e:capture-proof` or `test:e2e:exit-lifecycle` may remain as debuggers.

### Runner changes

1. Keep direct `--suite <id>` and `--full`.
2. Keep `--attempts`; `test:e2e:all:run` is now its explicit `--attempts 2` caller while smoke uses the default one attempt.
3. Remove:
   - `--suite-file`;
   - `--chain-id`;
   - `--plan-file`.
4. Delete `resolveRunnerPlannerMetadata`.
5. Remove planner-shaped result fields when nothing consumes them:
   - `chainId`;
   - `riskSelectedSuites`;
   - `forcedFull`;
   - planner `reason`.
6. Keep real lifecycle guarantees:
   - test-root isolation;
   - process shutdown;
   - bounded retry;
   - readable live output;
   - guarded cleanup of runner-owned roots;
   - failure artifacts.
7. Keep `e2e-suite-registry.mjs` as the minimal phase table.
8. Delete chain-only registry APIs:
   - `E2E_CHAIN_IDS`;
   - `E2E_CHAIN_DEFINITIONS`;
   - `partitionE2eSuitesByChain`;
   - chain-only guarded-root helpers if no direct runner consumer remains.

### Tests

Retain tests for direct behavior:

- suite names resolve to valid ordered phase sequences;
- unknown/duplicate phase definitions fail closed where applicable;
- direct smoke and full selections produce expected specs;
- runner shutdown/cleanup cannot target arbitrary roots;
- one-attempt smoke/default and two-attempt full selection behave as configured;
- failure/retry results remain readable.

Delete tests whose subject is planner metadata or chain partition.

### Verification

```bash
node --test apps/game/scripts/e2e-suite-registry.test.mjs
node --test apps/game/scripts/e2e-runner-lifecycle.test.mjs
node --test apps/game/scripts/save-e2e-paths.test.mjs
bun run --cwd apps/game test:e2e:smoke
```

### Commit

```bash
git add apps/game/scripts apps/game/package.json
git commit -m "refactor: simplify packaged E2E runner selection"
```

## Task 4 — Delete the scheduler/router/metrics product

### Purpose

Once direct CI is green, remove the old CI application rather than leaving compatibility stubs.

### Strong deletion candidates

Delete after `rg` confirms no live consumer:

```text
apps/game/scripts/select-e2e-suites.mjs
apps/game/scripts/select-e2e-suites.test.mjs
apps/game/scripts/plan-e2e-ci.mjs
apps/game/scripts/plan-e2e-ci.test.mjs
apps/game/scripts/e2e-ci-metrics.mjs
apps/game/scripts/e2e-ci-metrics.test.mjs
apps/game/scripts/e2e-ci-results.mjs
apps/game/scripts/e2e-ci-results.test.mjs
apps/game/scripts/cleanup-e2e-roots.mjs
```

Keep and rewrite:

```text
apps/game/scripts/e2e-ci-workflow.test.mjs
```

Keep lifecycle cleanup:

```text
cleanupOwnedE2eRoots in e2e-runner-lifecycle.mjs
its path/ownership/lifecycle tests
```

The deleted cleanup CLI is only a thin wrapper used by the old parallel-chain post-step; it is not the cleanup safety owner.

### Package cleanup

Replace `test:e2e:ci-contracts` with a smaller direct-runner/workflow contract command, or delete the umbrella if those tests already run through another script. Do not retain a suite whose main subject is the deleted scheduler.

### Reference audit

```bash
rg -n "select-e2e-suites|plan-e2e-ci|e2e-ci-metrics|e2e-ci-results|e2e-plan|chain-id|suite-file|plan-file|run-ownership" .
```

Expected remaining references:

- historical HPA-516 / PR #83 documents may still describe the old design;
- live code and live agent guidance must not.

### Tests

Run all surviving runner/registry/path/workflow contract tests.

### Commit

```bash
git add -A apps/game/scripts apps/game/package.json .github/workflows/ci.yml
git commit -m "refactor: remove Tauri E2E scheduler machinery"
```


## Task 5 — Apply the locked suite ownership and update live agent guidance

### Purpose

Finish cleanup without reopening whether surviving packaged suites belong in full verification. That ownership is already decided by the design.

### Locked disposition

| Suite / spec family | HPA-560 action |
|---|---|
| expanded `smoke` | KEEP IN PR + FULL |
| gameplay specs | KEEP IN FULL; local focused debugger may remain |
| `analysis-beat85` remainder | KEEP IN FULL |
| `production-journey` | KEEP IN FULL |
| `capture-proof` | KEEP IN FULL |
| `save-core` | KEEP IN FULL |
| `save-management` | KEEP IN FULL |
| `exit-lifecycle` | KEEP IN FULL |

Do not add a second acquisition or city-map slice to smoke.

### E2E-only controls

Delete a checkpoint/control surface only if:

- expanded smoke does not use it;
- full verification does not use it;
- no retained focused debugger uses it;
- lower-layer tests own the actual product behavior.

Do not add replacement test-only mutation APIs.

### Live documentation

Modify `CLAUDE.md` to remove live instructions for:

- `plan-e2e-ci.mjs`;
- suite files / chain IDs / plan files;
- path-risk routing;
- per-chain metrics/evidence;
- aggregate `tauri-e2e-analysis` reproduction.

Replace them with the simple contract:

```text
test:e2e:smoke = ordinary non-draft PR packaged proof
test:e2e:all   = nightly/manual/tag/ci:full-e2e broad proof
focused test:e2e:<suite> commands = local debugging only
```

Also document that a plain main push no longer runs packaged full.

`AGENTS.md` is a symlink to `CLAUDE.md`; do not create a duplicate edit.

### Scope guard

Do not rewrite retained E2E specs merely because they leave PR CI. Only extract a helper when the expanded smoke would otherwise copy existing logic.

### Verification

- run the expanded smoke;
- run direct full or the relevant focused commands;
- grep live guidance for deleted planner/chain terms.

### Commit

```bash
git add -A apps/game/e2e-tauri apps/game/scripts apps/game/package.json CLAUDE.md
git commit -m "docs: align E2E guidance with direct smoke and full"
```

Skip unrelated spec/control deletions if no clear redundancy exists.

## Task 6 — Final verification and before/after evidence

### Purpose

Prove the simpler architecture retains confidence and actually removes maintenance cost.

### Required repository checks

Use the current repo-native commands; expected baseline includes:

```bash
bun run check
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
```

Run frontend/compiler/Rust tests that CI normally owns. At minimum, preserve the existing green unit/type surfaces rather than relying solely on packaged E2E.

### Required packaged checks

Local/manual commands:

```bash
bun run --cwd apps/game test:e2e:smoke
bun run --cwd apps/game test:e2e:all
```

Linux CI invokes the same package commands through `xvfb-run -a`; the display wrapper is environment setup, not a different suite contract.

If `test:e2e:all` is too long to run locally in the working environment, trigger the manual/full GitHub Action and use that result before marking the PR ready. Do not declare completion from the PR smoke alone.

### Ready-for-review verification transition

This PR intentionally stays draft during implementation, and all heavy PR jobs retain the draft skip. Therefore the CI graph cannot be observed while the PR is still draft.

After Tasks 1-5 and local/static verification are complete:

1. mark PR #95 **ready for review**;
2. let the ordinary non-draft `Tauri E2E` smoke run and record its wall time/artifacts;
3. add `ci:full-e2e` once to switch the PR to the full path (or use an equivalent manual dispatch that runs this branch);
4. confirm the smoke/full predicates are mutually exclusive;
5. record the full-run wall time, retry/flake behavior, cache hit state, and artifacts;
6. only then finalize the after-measurement table and close HPA-560.

Do not add `ci:full-e2e` while the PR is draft as a workaround; the full PR condition must also require `draft == false`.

### CI graph verification

On the actual ready PR confirm:

- one non-draft ordinary packaged PR smoke job named `Tauri E2E`;
- exactly one packaged build, owned by the public package command;
- `ci:full-e2e` switches to full instead of adding a duplicate smoke job;
- no packaged full on plain main push;
- no planner job;
- no dynamic chain matrix;
- no aggregate routing analyzer;
- 45-minute smoke timeout and 120-minute full timeout;
- readable live failure output;
- failure artifact upload still works.

Trigger the broad/manual path and confirm:

- full Chapter 1 production journey executes;
- capture-proof executes;
- save/recovery executes;
- exit lifecycle executes;
- one build is reused by the broad run unless the measured two-static-job fallback was explicitly required;
- both smoke/full restore/write the same `target-e2e` cache namespace;
- full uses `--attempts 2`, while smoke remains one attempt.

### Record after measurements

Add a final table to the design doc and/or PR description:

| Metric | Before | After | Notes |
|---|---:|---:|---|
| ordinary PR packaged E2E wall time | measured Task 0 median | this PR/recheck | |
| full/nightly wall time | measured Task 0 median | manual/full run | |
| scheduler/router production LOC | Task 0 | final | |
| scheduler/router test LOC | Task 0 | final | |
| custom CI jobs/concepts | plan + 3 chains + aggregate | direct smoke/full | |
| retries/flakes in observed runs | Task 0 | final runs | |

Runtime does not need to improve at any cost. The primary success criterion is materially smaller maintained CI machinery while preserving the agreed verification boundaries.

### Linear / PR closeout

Update HPA-560 with:

- final PR link;
- before/after measurements;
- concise suite ownership outcome;
- any intentional retained focused suites;
- confirmation that dynamic capture remains covered by full verification.

Do not create follow-up tickets for speculative CI architecture. Create a follow-up only for a concrete failure discovered during verification that cannot reasonably fit this PR.

### Final commit

```bash
git add docs/superpowers/specs/2026-09-16-hpa-560-tauri-e2e-orchestration-collapse-design.md
git commit -m "docs: record HPA-560 verification results"
```

---

## Expected final file shape

The exact diff should be discovered from current `main`, but a successful implementation should roughly look like this:

### Added

- no new packaged journey spec by default

### Simplified

- `.github/workflows/ci.yml`
- `apps/game/package.json`
- `apps/game/e2e-tauri/smoke.e2e.ts`
- direct E2E runner/registry/lifecycle helpers
- `apps/game/scripts/e2e-ci-workflow.test.mjs`
- `CLAUDE.md` live agent instructions

### Deleted

- changed-path selector
- planner
- custom metrics
- aggregate results/routing analyzer
- selector/planner/metrics/results-only tests
- chain partition APIs
- cleanup-e2e-roots.mjs wrapper and parallel-chain cleanup step

### Kept

- packaged binary build helper
- direct runner lifecycle/process safety
- cleanupOwnedE2eRoots and safe test-root handling
- gameplay packaged specs in full
- full Chapter 1 journey behavior
- Analysis remainder in full
- dynamic thumbnail capture proof
- representative save/recovery coverage
- exit lifecycle coverage
- useful focused local debugging commands

## Final review checklist

Before marking the PR ready, review the diff with these questions:

- Can a contributor explain PR packaged E2E without a path-to-suite map?
- Does existing `test:e2e:smoke` reproduce exactly what ordinary non-draft PR CI runs?
- Does existing `test:e2e:all` reproduce the broad verification path?
- Does `ci:full-e2e` replace rather than duplicate the PR smoke?
- Is plain main-push packaged full intentionally absent?
- Does the workflow policy test lock the new trigger shape?
- Did we accidentally delete HPA-550 capture integration coverage?
- Did gameplay, production journey, Analysis remainder, save/recovery, and exit remain in full?
- Did we leave planner/metrics/result fields behind for compatibility that no user needs?
- Did we add any new generalized abstraction or third packaged journey?
- Are before/after measurements recorded without introducing permanent telemetry?
- Are `CLAUDE.md` live instructions updated?
- Is all implementation still in this single HPA-560 PR?

If these checks pass, the ticket has achieved its intended simplification without recreating the scheduler under a new name.
