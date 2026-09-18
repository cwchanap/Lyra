# HPA-560 Tauri E2E Orchestration Collapse Design

> **Status:** Draft / planning-only. This document defines the implementation contract for HPA-560. Implementation should continue on the **same pull request** after review; do not merge a docs-only PR and open a second implementation PR.

**Linear:** HPA-560 — `[Post-Chapter 1] Collapse Tauri E2E orchestration to one PR smoke and manual/nightly full verification`


## Summary

Lyra has reached the point where the Tauri E2E scheduler costs more maintenance than it returns for a hobby project.

The current CI owns a custom changed-path risk router, checked-in suite ownership, generated chain matrices, three parallel chain jobs, custom timing metrics, chain evidence manifests, guarded ownership cleanup, and a final aggregate routing/result analyzer. That machinery was useful while Chapter 1 persistence behavior was still changing rapidly, but the product and save architecture have now stabilized enough to collapse it.

HPA-560 should therefore be a **deletion-first CI simplification**, not another optimization layer.

The target shape is deliberately small:

```text
Non-draft pull request
  -> normal compiler/unit/type/Rust checks
  -> one expanded existing packaged smoke

Nightly / workflow_dispatch / tag / explicit ci:full-e2e
  -> one packaged full verification command
  -> production journey + gameplay + analysis remainder + capture proof + save/recovery + exit lifecycle
```

The existing `smoke.e2e.ts` becomes the universal PR contract; HPA-560 does **not** add a third Chapter 1 packaged journey. There is no changed-path E2E selector in the target architecture, no generated matrix, and no replacement scheduler.

A normal push to `main` intentionally stops forcing packaged full E2E after HPA-560. Main-push compiler/unit/type/Rust checks remain; broad packaged verification is owned by nightly/manual/tag or explicit `ci:full-e2e`. This is an intentional cost/simplicity cut, not an accidental trigger loss.

## Why HPA-560 is actionable now

The activation gate in the Linear issue is effectively satisfied:

| Gate | Current state | Design consequence |
|---|---|---|
| Chapter 1 first version accepted | HPA-266 was deduplicated into completed HPA-265 | We can choose a representative Chapter 1 smoke instead of testing an unstable feature set. |
| Acquisition simplification settled | HPA-549 completed | No reason to preserve routing complexity for an undecided acquisition transaction. |
| Save thumbnail decision settled | HPA-550 completed | Dynamic thumbnails remain. `capture-proof` therefore remains meaningful in broad/full verification. |
| Persistence coordinator settled | HPA-521 completed | The E2E system no longer needs to mirror a rapidly changing persistence ownership model. |
| Runtime evidence exists | Recent PR and scheduled CI runs are available | We can measure before deleting rather than guessing. |

The key point is that HPA-560 must respect the final HPA-550 decision. This ticket does **not** delete dynamic thumbnail capture merely because it is expensive. It removes scheduler/orchestration complexity while retaining the packaged capture proof in full verification.


## Current-state evidence

The current data is already sufficient to choose the architecture. Task 0 still records the ticket's requested before/after sample, but it is an evidence-completion task rather than an implementation gate.

### Baseline measurements (Task 0)

Recorded before any HPA-560 implementation change, from a branch rebased onto `main` at `7b95b005` (branch head `30a50a44`). Data comes from `gh run list` / `gh run view` against `cwchanap/Lyra`. Whole-workflow wall time is the run's created→updated span; chain columns are the full `Tauri E2E execution (<chain>)` job wall times (setup + packaged build + test steps), not the packaged-test step alone.

Latest 5 comparable PR runs (non-draft `pull_request` runs whose packaged chain jobs executed):

| Run | PR branch | Date | Whole workflow | gameplay | persistence | exit |
|---|---|---|---:|---:|---:|---:|
| 35254301792 | `design/regional-anime-city-maps` (#89) | 2026-09-17 | 21m40s | 20m13s | 10m52s | 5m52s |
| 35187921141 | `design/regional-anime-city-maps` (#89) | 2026-09-17 | 21m16s | 20m33s | 12m50s | 5m17s |
| 35175527557 | `design/regional-anime-city-maps` (#89) | 2026-09-17 | 24m14s | 22m59s | 11m20s | 5m39s |
| 34711769462 | `…/hpa-136-story-workbench-add-context-aware-ai-review-mvp` | 2026-09-12 | 24m48s | 24m14s | 11m33s | 6m08s |
| 34677795432 | `…/hpa-136-story-workbench-add-context-aware-ai-review-mvp` | 2026-09-12 | 18m09s | 17m26s | 12m44s | 5m47s |

Sample medians: whole workflow **21m40s**; chain jobs **gameplay 20m33s / persistence 11m33s / exit 5m47s**. Sample skew: only five qualifying PR runs exist in the recent window, and three come from PR #89, which is now merged into `main` and changed packaged Chapter 1 city-map anchors, so it is the closest recent analog to current main-state PR CI; the two `hpa-136` runs are the latest additional distinct-branch qualifying runs.

Latest 3 scheduled runs, plus the 2026-09-13 run recorded earlier:

| Run | Date | Whole workflow | gameplay | persistence | exit |
|---|---|---:|---:|---:|---:|
| 35205101535 | 2026-09-17 | 23m00s | 22m15s | 12m30s | 5m46s |
| 35078549930 | 2026-09-16 | 24m27s | 23m35s | 13m06s | 6m15s |
| 34952376625 | 2026-09-15 | 20m59s | 20m12s | 12m02s | 6m09s |
| 34749664097 | 2026-09-13 | 21m05s | 18m50s | 12m59s | 5m50s |

The median whole-workflow wall time of the latest three scheduled runs is **~23m00s**, consistent with the roughly-23-minute median of the earlier three-run set. PR and scheduled wall times sit in the same band today; the router does not currently make scheduled runs meaningfully cheaper than PR runs.

Setup/build/test split: chain job wall time ≈ packaged-test step + ~2m of setup/build/teardown (2026-09-17 scheduled: gameplay job 22m15s vs its ~20m05s packaged-test step). The representative split and the ~36-minute sequential direct-full estimate are in “Packaged-chain evidence” below.

Retry/flake: **0 workflow-level retries or flakes visible** in the nine sampled runs — every run concluded success on its first attempt with no re-run attempts visible. Failing same-branch runs in the window (e.g. `hpa-136` on 2026-09-11/12) were followed by new pushes, not re-runs. The runner-internal `--attempts 2` suite retry is not observable at job level for passing runs.

Current machinery LOC, production and test counted separately:

| Surface | Production LOC | Test LOC |
|---|---:|---:|
| `select-e2e-suites.mjs` (changed-path risk router) | 262 | 485 |
| `plan-e2e-ci.mjs` (planner / generated matrix) | 151 | 241 |
| `e2e-ci-metrics.mjs` (custom timing metrics) | 164 | 100 |
| `e2e-ci-results.mjs` (aggregate result analyzer) | 1,195 | 2,465 |
| `cleanup-e2e-roots.mjs` (chain cleanup CLI) | 21 | — |
| chain-only APIs in `e2e-suite-registry.mjs` (`E2E_CHAIN_IDS`, `E2E_CHAIN_DEFINITIONS`, `partitionE2eSuitesByChain`) | ~40 of 358 (estimate) | not separable |
| **Total** | **~1,833** | **3,291** |

Current suite list: `e2e-suite-registry.mjs` defines eight canonical suites — `smoke`, `gameplay`, `production-journey`, `analysis-beat85`, `capture-proof`, `save-core`, `save-management`, `exit-lifecycle` (16 phases) — partitioned today into the `gameplay` / `persistence` / `exit` chains. The locked post-HPA-560 disposition keeps every suite in full verification, with the expanded `smoke` additionally owning the PR path (see the disposition table under “Lower-layer ownership after the collapse”).

Consumer inventory, from `rg -n "select-e2e-suites|plan-e2e-ci|e2e-ci-metrics|e2e-ci-results|e2e-plan|chain-id|suite-file|plan-file|run-ownership|ci:full-e2e" . --hidden` (**140 matches across 18 live files**, excluding historical `docs/superpowers/` material that this document supersedes). Without `--hidden` the same pattern yields 108 matches across 17 files on this baseline: rg skips hidden directories by default and `.github` is hidden, which is why the Task 0 draft's verbatim listing missed `ci.yml` (its "cause unknown" note suspected a global ignore config; the actual cause is this rg default):

- `.github/workflows/ci.yml` — the primary production consumer (32 matches, included by the `--hidden` recount and verified directly): the `e2e-plan` job invokes `plan-e2e-ci.mjs` and emits the plan/suite/matrix/chain artifacts, `e2e-execution` runs the generated chain matrix and calls `e2e-ci-metrics.mjs`, and the workflow owns the `ci:full-e2e` label path.
- production scripts (8): `run-save-e2e.mjs`, `e2e-runner-lifecycle.mjs`, `e2e-runner-selection.mjs`, `cleanup-e2e-roots.mjs`, `e2e-ci-results.mjs`, `plan-e2e-ci.mjs`, `select-e2e-suites.mjs`, `e2e-ci-metrics.mjs`;
- scheduler/router/workflow contract tests (7): `e2e-ci-workflow.test.mjs` (30 matches), `e2e-ci-results.test.mjs` (19), `e2e-suite-registry.test.mjs` (17), `select-e2e-suites.test.mjs` (7), `plan-e2e-ci.test.mjs` (5), `e2e-runner-lifecycle.test.mjs` (3), `e2e-ci-metrics.test.mjs` (1);
- `apps/game/package.json` (script delegation) and `CLAUDE.md` (live agent guidance, 7 matches).

### Packaged-chain evidence

On the 2026-09-17 scheduled run:

| Existing chain | Test step | Observation |
|---|---:|---|
| gameplay | ~20m05s | Includes smoke, gameplay specs, production journey, and Analysis Beat 8.5. |
| persistence | ~10m26s | Includes capture proof and save/recovery phases. |
| exit | ~3m41s | Exit lifecycle phases. |

The same run's gameplay setup through packaged build was roughly **2m05s**. If those three test steps were executed sequentially behind one shared setup/build under the same cache conditions, the rough direct-full wall time is about **36 minutes**. Comparable 2026-09-16 and 2026-09-13 evidence lands around **38 minutes** and **33 minutes** respectively.

That supports one direct full job. Because the direct runner may still allow a bounded retry, and cache misses can widen setup/build time, the full job gets a **90-minute timeout**. The timeout is safety headroom, not a claim that normal runs should approach 90 minutes.

### Existing smoke and semantic-save reuse

The repository already has the pieces HPA-560 needs:

- `smoke.e2e.ts` proves clean title state, typed `get_state` IPC, New Game, and real packaged dialogue.
- `analysis-beat85.e2e.ts` already proves a packaged Beat 8.5 checkpoint, a real Analysis mutation, Save -> title -> Continue, exact semantic draft restoration, and further live interaction.
- `investigation-layout.e2e.ts` owns real investigation hotspot acquisition and the Chapter 1 city-map packaged interactions.
- `production-journey.e2e.ts` owns the organic Chapter 1 route and all authored map gates.
- `save-resume.e2e.ts` owns exact persistence permutations including pending-map restore.

HPA-560 should reuse those responsibilities instead of copying slices of each into a new `pr-smoke.e2e.ts`.

### Maintenance surface

The current workflow has all of the following as first-class CI concepts:

- `select-e2e-suites.mjs` and a changed-path risk table;
- `plan-e2e-ci.mjs` and generated suite/chain files;
- a canonical registry with chain partitioning;
- three dynamic execution chains (`gameplay`, `persistence`, `exit`);
- custom metrics via `e2e-ci-metrics.mjs`;
- per-chain evidence artifacts;
- custom aggregate validation via `e2e-ci-results.mjs`;
- scheduler/router/workflow contract tests whose product is the CI machinery itself.

PR #83 deliberately optimized this system without changing its architecture. HPA-560 is the later cleanup ticket that should now remove the architecture rather than add another selector rule.

## Design principles

1. **One understandable PR proof.** A developer should be able to answer "what packaged behavior does every PR prove?" without reading a risk table.
2. **Lower layers own permutations.** Rust, frontend, and compiler tests should own deterministic edge cases; packaged E2E should prove a small number of real-binary integration journeys.
3. **Broad verification still exists.** Simplifying PR CI must not mean deleting release confidence.
4. **Deletion over abstraction.** Do not replace the current router with a simpler router framework, test manifest DSL, reusable action, or plugin architecture.
5. **One ticket, one PR.** This draft PR becomes the implementation PR after planning approval.
6. **No backward-compatibility ceremony.** Lyra is pre-public-release; obsolete suite names, planner JSON, and internal CI contracts may be removed directly.

## Options considered

### Option A — keep risk routing and trim more suites

Keep the current selector/planner/matrix architecture but continue adjusting ownership rules and suite lists.

**Why not:** This improves runtime while retaining the maintenance problem HPA-560 exists to remove. Every new feature still needs an answer to "which rule owns this path?" and every E2E infrastructure change still exercises the planner product.

### Option B — one PR smoke plus one broad verification path

Every PR runs the same small packaged smoke. Full verification runs on schedule/manual/release and can be requested explicitly on a PR.

**Selected.** It has the smallest policy surface while preserving a real binary/IPC/save integration proof.

### Option C — remove packaged E2E from PRs entirely

Rely only on unit/type/Rust/compiler tests and run packaged E2E manually.

**Why not:** Lyra still benefits from proving that the packaged Tauri binary launches, loads real compiled resources, crosses frontend/native IPC, persists state, and can resume it. One short packaged proof earns its cost.


## Target CI contract

### Pull requests

Every **non-draft / ready-for-review** pull request runs:

- existing compiler/content checks;
- existing frontend unit/type/build checks;
- existing Rust checks/tests;
- exactly one packaged Tauri smoke job.

Draft PRs keep the repository's current heavy-job skip. This matters because HPA-560 itself is intentionally developed as one draft planning+implementation PR; intermediate planning and implementation pushes should not pay for packaged CI.

The smoke is **not** selected by changed paths. A non-draft documentation-only PR may still pay the short smoke; simplicity is preferred over maintaining another exception table.

If a PR carries `ci:full-e2e`, run the broad path instead of redundantly running both smoke and full.

### Broad verification

One direct broad verification path runs for:

- `schedule` / nightly;
- `workflow_dispatch`;
- tag/release verification already covered by the workflow;
- a PR explicitly labeled `ci:full-e2e`.

A plain push to `main` no longer forces packaged full E2E. That current behavior came from the selector's `refs/heads/main` forced-full rule; deleting it is part of the simplification.

The broad path runs the existing `test:e2e:all` command after the runner/registry are simplified.

It must retain representative coverage for:

- expanded `smoke`;
- gameplay packaged specs;
- full Chapter 1 `production-journey`;
- the geometry/pointer/full-flow remainder of `analysis-beat85`;
- dynamic-thumbnail `capture-proof` retained by HPA-550;
- semantic save/resume;
- representative corrupted/missing save recovery;
- exit/quit lifecycle and failure-bypass behavior.

This is a behavior contract, not a promise that every suite filename survives forever.


## PR smoke contract

Do **not** add `pr-smoke.e2e.ts`. Expand the existing `smoke.e2e.ts` and keep `test:e2e:smoke` as the one local reproduction command for ordinary PR CI.

The intended smoke is:

```text
launch packaged app on a clean root
-> prove clean title + typed get_state IPC
-> New Game -> prove real compiled Chapter 1 dialogue/resources render
-> load existing chapter-1-analysis-beat-85-ready checkpoint
-> perform one meaningful classify placement
-> explicit Save
-> return to title
-> Continue
-> assert exact semantic Analysis draft restored
-> perform one further production interaction
```

The implementation should extract/reuse the smallest existing Analysis helper(s) needed from `analysis-beat85.e2e.ts`; it should not duplicate its geometry, pointer-ordering, full-board completion, interrogation, or screenshot assertions.

Do not add an investigation/acquisition or city-map hop to the universal smoke. Those are already real packaged responsibilities in `investigation-layout.e2e.ts`, `production-journey.e2e.ts`, and `save-resume.e2e.ts`, which remain in full verification.

### Why checkpoints are acceptable here

The goal is packaged integration, not replaying 2.5-3 hours of Chapter 1 on every PR. Existing deterministic checkpoint support is already part of the accepted Chapter 1 testing surface. HPA-560 may reuse the existing Beat 8.5 checkpoint to keep the smoke short.

The ticket may delete E2E-only checkpoint controls only if no surviving smoke/full/local focused suite uses them and lower-layer tests own the corresponding behavior. It must not add a new checkpoint command.

### What the smoke must prove

At minimum:

- the packaged binary launches;
- clean title/New Game behavior still works;
- compiled Chapter 1 resources are available;
- frontend/native command transport works;
- one real Analysis gameplay mutation is persisted through the save path;
- returning to title and Continue works;
- restored state matches semantic gameplay state, not merely a screenshot or scene label;
- restored state accepts another production interaction.

### What the smoke should not prove

Do not put these permutations into the universal PR smoke:

- investigation hotspot acquisition;
- city-map mouse/keyboard/layout/raster behavior;
- every corruption/recovery case;
- all save-browser presentation variants;
- every checkpoint bridge;
- the full production journey;
- thumbnail capture visual fidelity;
- all exit failure modes;
- geometry/pointer-layout permutations from the full Analysis journey.


## Lower-layer ownership after the collapse

| Concern | Primary owner after HPA-560 |
|---|---|
| save schema, storage, atomic write, restore permutations | Rust tests |
| save-card/modal/error/presentation permutations | frontend tests |
| scene compilation, content definitions, reachability | compiler/content tests |
| packaged binary boot, real resources, IPC, one semantic Analysis save/continue | expanded `smoke` on PR + full |
| investigation hotspot + city-map packaged behavior | gameplay specs in full |
| organic/full Chapter 1 journey and all map gates | `production-journey` in full |
| Analysis geometry/pointer/full completion | `analysis-beat85` remainder in full |
| dynamic thumbnail integration | `capture-proof` in full |
| corruption/recovery integration | save-core/save-management in full |
| exit/quit lifecycle integration | exit-lifecycle in full |

The suite disposition is locked before implementation:

| Suite / spec family | After HPA-560 |
|---|---|
| `smoke` (expanded) | **PR + full** |
| `gameplay` specs (`app`, `case-file`, `checkpoint-contract`, `investigation-layout`, `scene-navigation-gate`) | **KEEP IN FULL**; focused local command may remain |
| `analysis-beat85` remainder | **KEEP IN FULL** |
| `production-journey` | **KEEP IN FULL** |
| `capture-proof` | **KEEP IN FULL** |
| `save-core` | **KEEP IN FULL** |
| `save-management` | **KEEP IN FULL** |
| `exit-lifecycle` | **KEEP IN FULL** |

Task-level cleanup may merge an obvious duplicate helper, but HPA-560 does not defer suite ownership to an open-ended audit.

## Explicit PR escalation instead of automatic routing

When a PR changes a boundary that cannot be proven convincingly by the universal smoke plus lower-layer tests, the developer has two simple options:

1. run the existing focused packaged command locally and record the result in the PR; or
2. add the existing `ci:full-e2e` label so CI runs the broad packaged verification.

Do not add an automatic "focused suite selector" after deleting the current selector. That would recreate HPA-516 under a new name.


## Runner and registry design

### Keep

Keep the reusable direct-runner value:

- build the Tauri E2E binary;
- start/stop the packaged application safely;
- run a named suite/phase sequence;
- bounded retry if current packaged-test evidence still justifies it;
- isolate temporary save roots;
- clean owned roots safely;
- expose normal logs/artifacts on failure.

Keep `e2e-suite-registry.mjs` only as the minimal ordered suite/phase table required by direct `--suite` and `--full` execution.

### Simplify

The public command surface remains the existing simple shape:

```text
bun run --cwd apps/game test:e2e:smoke
bun run --cwd apps/game test:e2e:all
```

Focused commands such as `test:e2e:capture-proof` may remain for local debugging.

The direct runner accepts only direct selection/lifecycle inputs such as `--suite`, `--full`, and `--attempts`. The ordinary smoke uses the default one attempt; `test:e2e:all:run` passes `--attempts 2`. Remove:

- `--suite-file`;
- `--chain-id`;
- `--plan-file`;
- `resolveRunnerPlannerMetadata`;
- planner-shaped `chainId`, `riskSelectedSuites`, `forcedFull`, and planner-reason fields from direct run-result metadata when they have no remaining diagnostic consumer.

The registry deletes `E2E_CHAIN_DEFINITIONS`, `E2E_CHAIN_IDS`, `partitionE2eSuitesByChain`, and other APIs whose only purpose is generated CI chains.

### Delete

Delete when direct CI no longer references them:

- changed-path risk rules;
- selector and ownership audit;
- planner and generated matrix schema;
- chain partition logic;
- custom timing metrics collection;
- custom aggregate routing/result analyzer;
- chain evidence manifests whose purpose is aggregate validation;
- selector/planner/metrics/results tests whose product disappears;
- the `cleanup-e2e-roots.mjs` CLI and workflow post-step.

Do **not** delete `cleanupOwnedE2eRoots` or its runner-lifecycle safety tests. The CLI is only a thin parallel-chain recovery wrapper; the direct runner already owns guarded cleanup.



## Workflow shape

The target `.github/workflows/ci.yml` should read like ordinary CI rather than a CI application.

Both packaged jobs use the same Rust build/cache contract:

- `CARGO_TARGET_DIR=apps/game/src-tauri/target-e2e`;
- one shared `Swatinem/rust-cache` `prefix-key`, e.g. `tauri-e2e-v2`;
- `workspaces: apps/game/src-tauri -> target-e2e`.

Using one key lets scheduled runs on the default branch warm the same E2E Cargo cache that PR jobs can restore. The first run under the new key is still cold, so timeout budgets must tolerate a cold packaged build.

Use two mutually exclusive job IDs, both with the human-facing job name **`Tauri E2E`** for continuity:

```yaml
jobs:
  # existing normal checks remain

  tauri-e2e-pr-smoke:
    name: Tauri E2E
    if: pull_request && !draft && !ci:full-e2e
    timeout-minutes: 45
    env:
      CARGO_TARGET_DIR: apps/game/src-tauri/target-e2e
    steps:
      - checkout/setup
      - shared rust-cache prefix-key: tauri-e2e-v2
      - run: xvfb-run -a bun run --cwd apps/game test:e2e:smoke
      - upload ordinary logs/screenshots

  tauri-e2e-full:
    name: Tauri E2E
    if: schedule || workflow_dispatch || tag || (pull_request && !draft && ci:full-e2e)
    timeout-minutes: 90
    env:
      CARGO_TARGET_DIR: apps/game/src-tauri/target-e2e
    steps:
      - checkout/setup
      - shared rust-cache prefix-key: tauri-e2e-v2
      - run: xvfb-run -a bun run --cwd apps/game test:e2e:all
      - upload ordinary logs/screenshots
```

The package scripts remain the local reproduction commands. On Linux GitHub runners, CI wraps them with `xvfb-run -a` because packaged WebKitGTK needs a display; this wrapper is environment setup, not a different test contract.

The exact GitHub expression should reuse existing event/label semantics rather than introduce another trigger helper.

The current repository ruleset does **not** require a status check named `Tauri E2E`; keeping that display name is a low-cost continuity choice, not a branch-protection compatibility requirement.

### Surviving Node contract tests

Deleting `e2e-plan` would otherwise delete the only CI caller of the runner/registry/path/workflow Node contract tests. Preserve them explicitly.

Add a named step to the existing `lint-frontend` / frontend-check job, next to `check:e2e`, that runs exactly the surviving files:

```bash
node --test \
  apps/game/scripts/e2e-suite-registry.test.mjs \
  apps/game/scripts/e2e-runner-lifecycle.test.mjs \
  apps/game/scripts/save-e2e-paths.test.mjs \
  apps/game/scripts/e2e-ci-workflow.test.mjs
```

Do not rely on Turbo/Vitest to discover these `node:test` files; it does not.

Rewrite `e2e-ci-workflow.test.mjs` instead of deleting it. The slim policy test should lock:

- the non-draft PR smoke path;
- the broad schedule/manual/tag/`ci:full-e2e` path;
- mutual exclusion so `ci:full-e2e` does not run both jobs;
- the intentional absence of a main-push packaged-full trigger;
- job display name `Tauri E2E`;
- smoke timeout **45** and full timeout **90**;
- shared `CARGO_TARGET_DIR` and shared Rust cache prefix;
- `xvfb-run -a` around both packaged package commands;
- the surviving Node-contract step in the frontend-check job;
- no planner, generated matrix, plan artifact, metrics wrapper, or aggregate analyzer.


## One full job vs multiple static jobs

The design commits to **one full job with one build**.

Recent scheduled evidence estimates direct sequential full execution around 33-38 minutes with the observed warm-cache state. The repository also records that a cold `target-e2e` setup/build can consume roughly 24 minutes before tests. Therefore:

- PR smoke timeout: **45 minutes**;
- full timeout: **90 minutes**;
- both jobs use the same `CARGO_TARGET_DIR` and Rust-cache prefix.

The expanded PR smoke keeps the runner default of **one attempt** so an ordinary PR flake is visible immediately.

The broad command explicitly keeps bounded retry:

```text
test:e2e:all:run -> run-save-e2e.mjs --full --attempts 2
```

This makes the full-job retry policy an actual caller contract rather than a dormant CLI flag, and it explains why the 90-minute ceiling includes retry headroom.

Only if an actual direct-full run still proves materially unreliable may this PR use at most two hard-coded static full jobs. That fallback must be justified in the PR and must not restore generated matrices or path routing.

## Diagnostics after deleting custom metrics/analyzer

The simplified system relies on standard signals first:

- GitHub job duration;
- step duration;
- streamed WDIO output;
- normal screenshots/log files from failing specs;
- workflow attempt/retry history.

We do not need a bespoke JSON metrics format merely to know whether the packaged test passed or how long a GitHub step took.

The direct runner should still identify the named phase/spec that failed and preserve enough logs/screenshots to reproduce it locally.


## Measurement contract

HPA-560 still records the requested before/after evidence, but measurement does **not** block construction of the expanded smoke.

Before merge, record:

- median wall time across a small comparable sample of recent ordinary PR E2E runs;
- median wall time across recent scheduled/full runs;
- setup/build/test split from representative jobs;
- visible retry/flake count in that sample;
- production and test LOC for selector/planner/metrics/analyzer/chain-only surfaces;
- final suite ownership.

Use the latest 5 comparable PR runs and latest 3 scheduled/manual/full runs when available. The already-recorded recent schedule evidence is enough to start implementation; fill the complete table in the same PR before marking ready. The current-state sample is recorded in “Baseline measurements (Task 0)” under Current-state evidence.

After implementation, capture the same measurements from the simplified PR smoke plus one full/manual run. No monitoring service or history database is added.

## After-implementation measurements

Recorded after implementation Tasks 1-5 on this branch (rebased base `30a50a44`), before the PR is marked ready.

### Machinery LOC (before → after)

| Surface | Production LOC | Test LOC |
|---|---:|---:|
| `select-e2e-suites.mjs` (changed-path risk router) | **0** (was 262) | **0** (was 485) |
| `plan-e2e-ci.mjs` (planner / generated matrix) | **0** (was 151) | **0** (was 241) |
| `e2e-ci-metrics.mjs` (custom timing metrics) | **0** (was 164) | **0** (was 100) |
| `e2e-ci-results.mjs` (aggregate result analyzer) | **0** (was 1,195) | **0** (was 2,465) |
| `cleanup-e2e-roots.mjs` (chain cleanup CLI) | **0** (was 21) | — (was —) |
| chain-only APIs in `e2e-suite-registry.mjs` | **0** (was ~40) | — |
| `run-save-e2e.mjs` (direct CLI) | 154 | — |
| `e2e-runner-selection.mjs` (direct `--suite`/`--full` selection) | 24 | — |
| `e2e-runner-lifecycle.mjs` (packaged process safety) | 612 | 491 |
| `e2e-suite-registry.mjs` (minimal ordered suite table) | 318 | 183 |
| `save-e2e-paths.test.mjs` (unchanged) | — | 674 |
| `e2e-ci-workflow.test.mjs` (rewritten workflow policy test) | — | 236 |
| **Removed machinery total** | **~1,833 → 0** | **3,291 → 0** |
| **Surviving direct-runner/registry/test total** | **1,108** | **1,584** |

Custom CI jobs/concepts: plan job + 3 dynamic chains + aggregate analyzer → **2 static jobs** (direct `test:e2e:smoke` / `test:e2e:all` under one `Tauri E2E` display name, mutually exclusive on `ci:full-e2e`).

### Local verification results

All run locally on this branch (macOS), in order:

| Check | Result | Duration |
|---|---|---|
| `bun run check` | PASS (3/3 turbo tasks, 2 cached) | ~6s |
| `bun run lint` | PASS | ~14s |
| `bun run format:check` | PASS | ~9s |
| `bun run rust:fmt` | PASS | ~1s |
| `bun run rust:lint` | PASS (uncached) | ~1m11s |
| `bun run --cwd apps/game test:e2e:ci-contracts` | PASS (59 tests across the 4 surviving files) | ~0.2s |
| `bun run --cwd apps/game test:e2e:smoke` (packaged) | PASS (4 specs, incl. semantic save/continue) | ~63s wall including the E2E binary build; packaged spec itself 15.3s |
| `bun run --cwd apps/game test:e2e:all` | not run locally | intentionally substituted by the GitHub full run per the plan; controller records it after PR-ready |

### Pending CI observation

| Metric | After |
|---|---|
| ordinary PR packaged E2E wall time | [pending CI observation — filled after PR-ready smoke and full runs] |
| full/nightly wall time | [pending CI observation — filled after PR-ready smoke and full runs] |
| retries/flakes in observed runs | [pending CI observation — filled after PR-ready smoke and full runs] |

### Final file shape (confirmed against `git diff --stat 30a50a44..HEAD`)

Net diff: 23 files, +626/−6,087 lines.

- **Added:** nothing new — no new packaged journey spec, no new scripts, no new abstractions.
- **Simplified:** `.github/workflows/ci.yml`, `apps/game/package.json`, `apps/game/e2e-tauri/smoke.e2e.ts` (expanded with the semantic save/continue slice), `apps/game/e2e-tauri/helpers.ts` + `analysis-beat85.e2e.ts` (shared Analysis helper extraction), direct runner/registry/lifecycle helpers (`run-save-e2e.mjs`, `e2e-runner-selection.mjs`, `e2e-runner-lifecycle.mjs`, `e2e-suite-registry.mjs`) and their surviving tests, `e2e-ci-workflow.test.mjs` (rewritten as the slim workflow policy test), `CLAUDE.md` live agent guidance, this design doc.
- **Deleted:** changed-path selector (`select-e2e-suites.mjs` + test), planner (`plan-e2e-ci.mjs` + test), custom metrics (`e2e-ci-metrics.mjs` + test), aggregate results analyzer (`e2e-ci-results.mjs` + test), `cleanup-e2e-roots.mjs` wrapper, chain partition APIs in the registry.
- **Kept:** packaged binary build helper (`build-e2e.mjs`), direct runner lifecycle/process safety, `cleanupOwnedE2eRoots` and safe test-root handling, gameplay packaged specs in full, full Chapter 1 `production-journey`, `analysis-beat85` remainder, dynamic thumbnail `capture-proof`, representative save/recovery coverage, exit lifecycle coverage, focused local debugging commands, `save-e2e-paths.test.mjs` unchanged.


## File-level scope

### Expected to modify

- `.github/workflows/ci.yml`
- `apps/game/package.json`
- `apps/game/e2e-tauri/smoke.e2e.ts`
- the smallest reusable Analysis helper location if needed to avoid copying logic
- `apps/game/scripts/run-save-e2e.mjs`
- `apps/game/scripts/e2e-suite-registry.mjs`
- `apps/game/scripts/e2e-runner-selection.mjs`
- `apps/game/scripts/e2e-runner-lifecycle.mjs` if planner-shaped result metadata is removed there
- direct runner/lifecycle/path tests that still protect real behavior
- `apps/game/scripts/e2e-ci-workflow.test.mjs`, rewritten as a small direct-workflow policy test
- `CLAUDE.md` (and therefore `AGENTS.md`, which is a symlink) so live agent instructions stop teaching planner/chain reproduction

### Strong deletion candidates

- `apps/game/scripts/select-e2e-suites.mjs`
- `apps/game/scripts/select-e2e-suites.test.mjs`
- `apps/game/scripts/plan-e2e-ci.mjs`
- `apps/game/scripts/plan-e2e-ci.test.mjs`
- `apps/game/scripts/e2e-ci-metrics.mjs`
- `apps/game/scripts/e2e-ci-metrics.test.mjs`
- `apps/game/scripts/e2e-ci-results.mjs`
- `apps/game/scripts/e2e-ci-results.test.mjs`
- `apps/game/scripts/cleanup-e2e-roots.mjs`

Keep `e2e-ci-workflow.test.mjs`; rewrite it around the simpler policy.

Historical HPA-516 / PR #83 design documents are not live contracts and are not rewritten.


## Migration sequence

1. Refresh/rebase the HPA-560 branch onto current `main` so PR #89 city-map anchors are part of the implementation baseline.
2. Begin the requested before-measurement table; do not block implementation on completing the full sample.
3. Expand existing `smoke.e2e.ts` using the Beat 8.5 semantic save/continue seam, including the required shared Analysis helper extraction.
4. Cut the workflow to direct smoke/full commands, shared cache/CARGO target, Xvfb, and an explicit surviving Node-contract step while the old runner flags still exist.
5. Simplify direct runner/registry inputs and remove planner-shaped metadata now that the workflow no longer passes them; add `--attempts 2` to full only.
6. Delete selector/planner/metrics/results/chain machinery and the cleanup CLI after references are gone.
7. Update `CLAUDE.md` live E2E guidance.
8. Mark the PR ready for review so the non-draft smoke can run; observe it, then exercise the broad path once via `ci:full-e2e` (or an equivalent branch-capable manual dispatch), record after-measurements, and only then close verification.

Coverage ownership is decided before deletion; implementation does not wait for an open-ended suite audit.


## Risks and mitigations

### Risk: deleting the selector removes automatic fail-safe-to-full behavior for unknown source paths

Today, an unmatched non-documentation source path forces the complete packaged registry. After HPA-560, an ordinary PR touching an unrecognized source path gets only the universal smoke unless the developer explicitly escalates.

**Mitigation:** Accept this as a deliberate pre-release solo-project tradeoff. Use `ci:full-e2e` for uncertain cross-boundary PRs, keep focused local packaged commands for targeted debugging, and rely on nightly full verification as the backstop. Document the loss plainly rather than implying the new policy preserves the selector's unknown-path safety net.

### Risk: the PR smoke becomes another miniature production journey

**Mitigation:** Expand the existing smoke rather than adding a new spec. After New Game, jump directly to the existing Beat 8.5 checkpoint, persist one classify mutation, Continue, and prove one further live interaction. Do not add investigation acquisition or city-map hops.

### Risk: removing routing causes every non-draft PR to pay packaged setup

**Mitigation:** Use the shared E2E Rust cache and accept the fixed smoke cost in exchange for deleting the scheduler. Keep the draft skip so planning/in-progress draft pushes do not pay it. Revisit only with real evidence after the simplified system lands.

### Risk: cold E2E builds exceed the short PR budget

**Mitigation:** Preserve `CARGO_TARGET_DIR=apps/game/src-tauri/target-e2e`, use one shared Rust-cache prefix for smoke/full, and set the smoke job to 45 minutes. The cache improves the normal case; the timeout still tolerates the first cold run.

### Risk: broad verification becomes too slow sequentially

**Mitigation:** Use one direct full job with a 90-minute ceiling. Warm-cache evidence estimates the direct sequential path around 33-38 minutes; the extra headroom covers cold cache and one bounded full-run retry. Only an observed direct-full reliability problem may justify two static jobs. Never restore dynamic chain planning.

### Risk: surviving runner/path/workflow contract tests silently stop running

**Mitigation:** Move their CI invocation into the existing frontend-check job before deleting `e2e-plan`. Keep exactly the surviving registry/lifecycle/path/workflow `node --test` files.

### Risk: useful focused suites disappear with their CI ownership

**Mitigation:** CI ownership and local-debugging value are separate. Keep focused commands when they help reproduce failures; delete only those with no unique responsibility.

### Risk: HPA-550 coverage is accidentally removed

**Mitigation:** `capture-proof` is explicitly part of the broad verification contract because the final product retained dynamic thumbnails.

### Risk: hidden dependency on planner JSON or ownership manifests

**Mitigation:** Search all repository references before deleting files/flags. Cut workflow consumers before removing runner flags, then make direct command tests green before deleting old planner contracts.

## Non-goals

- No new test framework.
- No reusable GitHub Action abstraction.
- No generalized test scheduler.
- No cross-platform E2E expansion.
- No product/runtime save redesign.
- No thumbnail product redesign.
- No attempt to make every focused suite run on every PR.
- No historical rewrite of HPA-516 / PR #83 design documents.
- No compatibility layer for obsolete planner JSON, suite ownership rules, or internal CI flags.

## Acceptance criteria mapping

| Linear acceptance criterion | HPA-560 design response |
|---|---|
| before/after runtime, flake, LOC recorded | One-time measurement task in this PR; no permanent telemetry subsystem. |
| every PR runs one understandable packaged smoke | Every non-draft PR runs the expanded existing smoke directly. |
| extra PR E2E justified by concrete boundary | Local focused command or explicit `ci:full-e2e`; no automatic risk map. |
| nightly/manual/release keeps recovery/lifecycle | Broad full command retains representative save/recovery/capture/exit coverage. |
| deterministic permutations remain lower-layer | Explicit ownership table above. |
| planner/router/metrics/ownership materially reduced | Delete them rather than redesign them. |
| removed features own no stale E2E surfaces | Final audit after current product decisions; HPA-550 capture remains because feature remains. |
| one local PR smoke + one broad command | Existing `test:e2e:smoke` and `test:e2e:all`. |
| diagnostics remain sufficient | Direct logs, named phases, screenshots/artifacts; no aggregate analyzer. |
| no replacement CI framework | Explicit design constraint. |

## Definition of done

HPA-560 is done when a developer can understand Lyra's packaged E2E policy from two sentences:

> Every non-draft PR proves one short real Tauri Chapter 1 Analysis save/continue vertical slice through the expanded existing smoke.  
> Nightly/manual/tag (or an explicit `ci:full-e2e` label) runs the broader packaged verification.

If explaining the result still requires a path ownership table, generated matrix, chain manifest, or custom result classifier, the simplification is not finished.
