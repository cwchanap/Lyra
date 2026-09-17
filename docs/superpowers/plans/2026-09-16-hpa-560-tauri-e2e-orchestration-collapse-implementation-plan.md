# HPA-560 Tauri E2E Orchestration Collapse Implementation Plan

> **Status:** Draft implementation plan. Planning-only at this revision. Execute this plan on the **same HPA-560 branch and PR** after review.

**Spec:** `docs/superpowers/specs/2026-09-16-hpa-560-tauri-e2e-orchestration-collapse-design.md`

**Linear:** HPA-560

## Goal

Replace Lyra's custom changed-path Tauri E2E CI scheduler with the smallest useful packaged verification policy:

- every PR runs one short Chapter 1 packaged smoke;
- nightly/manual/release and explicit `ci:full-e2e` runs broader packaged verification;
- deterministic permutations stay at Rust/frontend/compiler layers;
- delete planner/router/metrics/aggregate machinery instead of replacing it.

This ticket remains one implementation PR. Do not split planning, workflow cleanup, runner cleanup, and smoke construction across multiple PRs.

## Architecture after implementation

```text
PR
└─ normal checks
└─ Tauri PR smoke
   ├─ build packaged E2E binary once
   └─ run one semantic Chapter 1 save/continue vertical slice

schedule / workflow_dispatch / release / ci:full-e2e
└─ Tauri full verification
   ├─ build packaged E2E binary once
   └─ run broad packaged suites directly
```

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
- Prefer deletion over moving code into new abstractions.
- Reuse existing E2E checkpoint/control commands; do not add a new native E2E API for the PR smoke.
- Preserve dynamic thumbnail capture and its broad `capture-proof` responsibility from HPA-550.
- Preserve representative save/recovery and exit lifecycle packaged coverage in full verification.
- Do not preserve old planner JSON or CLI flags for compatibility.
- Do not create a generalized reusable CI framework.
- If PR #89 or another open PR changes E2E anchors before implementation starts, rebase/refresh the file inventory first.

---

## Task 0 — Freeze the current baseline before deleting anything

### Purpose

HPA-560 requires evidence that simplification is actually worthwhile. Capture the evidence once; do not add permanent telemetry to produce it.

### Files

Modify:

- `docs/superpowers/specs/2026-09-16-hpa-560-tauri-e2e-orchestration-collapse-design.md`
- optionally the PR body with a concise baseline table

Do not change runtime/CI behavior yet.

### Steps

1. Refresh from current `main` and record the base SHA.
2. Collect the latest **5 comparable PR runs** where packaged E2E actually executed.
3. Collect the latest **3 scheduled/manual/full runs**.
4. Record:
   - median whole-workflow / packaged-E2E wall time;
   - representative setup/build/test split;
   - visible retry/flake count in the sample;
   - current planner/router/metrics/analyzer production LOC and test LOC separately;
   - current suite list and its unique integration responsibility.
5. Add a `Measured baseline` subsection to the design doc. Keep the existing 2026-09-16 planning figures as context, but replace any provisional wording with measured sample values.

Suggested LOC inventory:

```bash
wc -l \
  apps/game/scripts/select-e2e-suites.mjs \
  apps/game/scripts/plan-e2e-ci.mjs \
  apps/game/scripts/e2e-ci-metrics.mjs \
  apps/game/scripts/e2e-ci-results.mjs \
  apps/game/scripts/e2e-suite-registry.mjs

wc -l \
  apps/game/scripts/select-e2e-suites.test.mjs \
  apps/game/scripts/plan-e2e-ci.test.mjs \
  apps/game/scripts/e2e-ci-metrics.test.mjs \
  apps/game/scripts/e2e-ci-results.test.mjs \
  apps/game/scripts/e2e-ci-workflow.test.mjs \
  apps/game/scripts/e2e-suite-registry.test.mjs
```

6. Search for current consumers before subsequent deletion:

```bash
rg -n "select-e2e-suites|plan-e2e-ci|e2e-ci-metrics|e2e-ci-results|e2e-plan|chain-id|suite-file|plan-file|run-ownership|ci:full-e2e" .
```

### Stop condition

If the activation assumptions are no longer true on current `main` — for example, a product decision reintroduced a major persistence surface — update the design before touching CI. Do not silently preserve the router "just in case".

### Commit

```bash
git add docs/superpowers/specs/2026-09-16-hpa-560-tauri-e2e-orchestration-collapse-design.md
git commit -m "docs: record HPA-560 E2E baseline"
```

---

## Task 1 — Build the one representative PR smoke before removing old coverage

### Purpose

Create the replacement packaged proof first. The old CI stays available until the new smoke proves the intended semantic boundary.

### Files

Expected to add or modify:

- `apps/game/e2e-tauri/pr-smoke.e2e.ts` — preferred new explicit contract; alternatively rename/trim an existing smoke only if that produces less churn
- shared E2E helper files already used by Chapter 1 specs, only if necessary
- `apps/game/package.json`
- direct E2E runner-selection tests if the new suite name needs registration

Reference existing behavior from:

- `apps/game/e2e-tauri/smoke.e2e.ts`
- `apps/game/e2e-tauri/checkpoint-contract.e2e.ts`
- `apps/game/e2e-tauri/analysis-beat85.e2e.ts`

### Test-first contract

Write the smoke around **semantic state**, not screenshots or raw serialized JSON.

Required journey:

1. Launch the packaged binary on a clean test root.
2. Start Chapter 1 and prove real compiled dialogue/resources render.
3. Use an **existing** accepted E2E checkpoint bridge to reach a representative investigation/acquisition boundary without replaying the whole chapter.
4. Acquire/acknowledge one real Chapter 1 record through production UI.
5. Use existing checkpoint support to reach the accepted Beat 8.5 Analysis surface.
6. Perform one meaningful analysis action, such as classifying/moving one evidence record.
7. Explicitly save to a manual slot.
8. Return to title.
9. Continue from the title screen.
10. Assert the exact expected semantic state:
    - expected Chapter 1 scene/phase;
    - acquired record still present;
    - analysis classification/draft selection persisted;
    - the resumed view is actionable.
11. Perform one further production interaction after resume to prove the restored state is live rather than merely displayed.

### Important cuts

The PR smoke must **not** copy all assertions from `analysis-beat85.e2e.ts`.

Move/leave these outside the universal smoke when already protected elsewhere:

- geometry-heavy pointer assertions;
- multiple ordering permutations;
- all corruption cases;
- thumbnail fidelity;
- all exit failure modes;
- full Chapter 1 organic traversal.

### No new native seam

Before adding any E2E-only command, search the existing checkpoint/control surface. If the smoke cannot be written without a new native endpoint, simplify the smoke instead.

### Package command

Add one obvious local command:

```json
"test:e2e:pr-smoke": "..."
```

It should build once and run exactly the new PR smoke, with no planner input.

Keep `test:e2e:all` as the broad local/manual command, simplifying its internals later in Task 2.

### Verification

Run at minimum:

```bash
bun run --cwd apps/game test:e2e:pr-smoke
```

Also run the direct TypeScript/E2E typecheck already used in CI.

### Commit

```bash
git add apps/game/e2e-tauri apps/game/package.json apps/game/scripts
git commit -m "test: add Chapter 1 PR packaged smoke"
```

---

## Task 2 — Simplify runner selection to direct suites/full mode

### Purpose

Make the runner callable directly without planner-generated files, chain IDs, or generated CI metadata.

### Files

Modify as needed:

- `apps/game/scripts/run-save-e2e.mjs`
- `apps/game/scripts/e2e-suite-registry.mjs`
- `apps/game/scripts/e2e-runner-selection.mjs`
- `apps/game/scripts/e2e-suite-registry.test.mjs`
- `apps/game/scripts/e2e-runner-lifecycle.test.mjs`
- `apps/game/scripts/save-e2e-paths.test.mjs`
- `apps/game/package.json`

### Desired public command surface

CI and humans should need only:

```bash
bun run --cwd apps/game test:e2e:pr-smoke
bun run --cwd apps/game test:e2e:all
```

Focused commands such as `test:e2e:capture-proof` or `test:e2e:exit-lifecycle` may remain when they help debug a failure. They no longer imply CI ownership.

### Runner changes

1. Add/confirm direct support for a named suite such as `pr-smoke`.
2. Keep direct `--full` or equivalent broad mode.
3. Remove CI-only command inputs once the workflow no longer needs them:
   - `--suite-file`;
   - `--chain-id`;
   - `--plan-file`.
4. Keep ordinary runner lifecycle guarantees:
   - test root isolation;
   - process shutdown;
   - bounded retry if still justified by actual packaged-test behavior;
   - readable live output;
   - safe cleanup of the root the runner itself created.
5. Simplify the suite registry to the minimum needed for direct suite/phase sequencing.
6. Delete chain-partition APIs if their only consumer was dynamic CI.

### Tests

Retain tests for **real runner behavior**, not scheduler policy.

Examples worth keeping:

- suite names resolve to valid phase sequences;
- duplicate/unknown phase definitions fail closed if the minimal registry still supports them;
- runner shutdown/cleanup does not leak processes or arbitrary filesystem roots;
- direct `pr-smoke` and full selections produce the expected ordered specs.

Do not preserve tests for generated matrices or risk-rule categories.

### Verification

```bash
bun test apps/game/scripts/e2e-suite-registry.test.mjs
bun test apps/game/scripts/e2e-runner-lifecycle.test.mjs
bun test apps/game/scripts/save-e2e-paths.test.mjs
bun run --cwd apps/game test:e2e:pr-smoke
```

Use the repository's actual Bun test invocation if these script tests are wired through a package-level command rather than direct paths.

### Commit

```bash
git add apps/game/scripts apps/game/package.json
git commit -m "refactor: simplify packaged E2E runner selection"
```

---

## Task 3 — Replace dynamic CI planning with two direct workflow paths

### Purpose

Make `.github/workflows/ci.yml` describe the product policy directly.

### Files

Modify:

- `.github/workflows/ci.yml`
- `apps/game/package.json` if workflow command names need final alignment

Temporarily modify or replace workflow-contract assertions only as needed during the transition; Task 4 deletes scheduler-only contract tests.

### PR smoke job

Replace `e2e-plan` + dynamic `e2e-execution` + aggregate `e2e` for ordinary PRs with one direct job.

Expected shape:

```text
checkout
-> Bun setup
-> Tauri/Linux system dependencies
-> Rust toolchain/cache
-> install dependencies
-> build packaged E2E binary once
-> run PR smoke with live output
-> upload ordinary logs/screenshots/artifacts
```

Constraints:

- no downloaded plan artifact;
- no matrix generated from paths;
- no custom metrics initialization;
- no chain evidence manifest;
- no final aggregate analyzer;
- set a clear job timeout rather than writing a custom watchdog product.

### Full job

Add one direct broad job that runs for the repository's existing full-verification triggers:

- scheduled/nightly;
- `workflow_dispatch`;
- release/tag path already used by `ci.yml`;
- PRs with `ci:full-e2e`.

Expected shape:

```text
checkout/setup once
-> build packaged E2E binary once
-> run test:e2e:all
-> upload normal logs/screenshots/artifacts
```

Do **not** make the PR smoke and full job both run redundantly on `ci:full-e2e` unless the workflow naturally reuses the smoke as part of the full suite and the extra cost is negligible. Prefer one broad result for the escalation path.

### One-job default

Start with one broad job. Only retain two static broad jobs if measured execution proves one sequential job is impractical. If that fallback is used, document the evidence in the PR and keep the job split hard-coded and obvious; no generated matrix.

### Workflow status compatibility

If branch protection expects a specific final job/check name today, preserve that **check name** where cheap even though its implementation becomes direct. Do not preserve the old internal planner architecture just for the name.

### Verification

At minimum:

```bash
bun run check
bun run lint
bun run format:check
```

Then push the branch and inspect the actual GitHub Actions job graph. Confirm:

- ordinary PR shows one packaged E2E job;
- no `Plan Tauri E2E` job;
- no gameplay/persistence/exit matrix jobs;
- no aggregate routing validation job;
- logs identify the failing spec directly.

### Commit

```bash
git add .github/workflows/ci.yml apps/game/package.json
git commit -m "ci: collapse Tauri E2E to smoke and full paths"
```

---

## Task 4 — Delete the scheduler/router/metrics product

### Purpose

Once direct CI is green, remove the old system instead of leaving dead compatibility code behind.

### Strong deletion candidates

Delete when `rg` confirms no remaining consumer:

```text
apps/game/scripts/select-e2e-suites.mjs
apps/game/scripts/select-e2e-suites.test.mjs
apps/game/scripts/plan-e2e-ci.mjs
apps/game/scripts/plan-e2e-ci.test.mjs
apps/game/scripts/e2e-ci-metrics.mjs
apps/game/scripts/e2e-ci-metrics.test.mjs
apps/game/scripts/e2e-ci-results.mjs
apps/game/scripts/e2e-ci-results.test.mjs
apps/game/scripts/e2e-ci-workflow.test.mjs
```

Evaluate and delete if now redundant:

```text
apps/game/scripts/cleanup-e2e-roots.mjs
```

Do not delete root/path safety just to reduce LOC. If the direct runner already owns safe cleanup, delete the extra ownership-manifest layer. If a small path-safety helper is still required, keep that helper rather than an artifact protocol.

### Package cleanup

Rewrite the current `test:e2e:ci-contracts` package script into a smaller runner-focused contract command, or delete the umbrella if individual remaining tests are already run elsewhere.

The result must not have a "CI contracts" suite whose majority purpose is testing a scheduler that no longer exists.

### Reference audit

```bash
rg -n "select-e2e-suites|plan-e2e-ci|e2e-ci-metrics|e2e-ci-results|e2e-plan|chain-id|suite-file|plan-file|run-ownership" .
```

Expected result: only historical design documentation may mention the removed concepts. Do not rewrite old HPA-516 / PR #83 docs merely to make grep empty.

### Tests

Run all surviving script/runner contract tests.

### Commit

```bash
git add -A apps/game/scripts apps/game/package.json .github/workflows/ci.yml
git commit -m "refactor: remove Tauri E2E scheduler machinery"
```

---

## Task 5 — Audit focused suites and E2E-only control surfaces

### Purpose

Remove stale test surface created for product behavior that no longer exists, but do not confuse "not in PR CI" with "useless".

### Inventory

Audit current suites/specs including at least:

- `smoke`
- `gameplay`
- `production-journey`
- `analysis-beat85`
- `capture-proof`
- `save-core`
- `save-management`
- `exit-lifecycle`
- checkpoint-contract coverage

For each, record one of:

```text
KEEP IN PR SMOKE
KEEP IN FULL
KEEP AS LOCAL FOCUSED DEBUGGER
MERGE INTO ANOTHER SUITE
DELETE — LOWER LAYER OWNS BEHAVIOR
```

### Required keeps by behavior

Broad/full verification must still own:

- `production-journey` behavior;
- `capture-proof` behavior because HPA-550 retained dynamic thumbnails;
- one real save/resume behavior;
- representative corruption/recovery behavior;
- exit/quit lifecycle behavior.

The exact filenames may change, but do not delete those integration responsibilities.

### Checkpoint/control cleanup

1. Search E2E control commands and their callers.
2. Remove an E2E-only checkpoint/control command only when:
   - PR smoke no longer calls it;
   - broad verification no longer calls it;
   - no focused local suite calls it;
   - lower-layer tests prove the actual product behavior.
3. Do not introduce replacement test-only state mutation APIs.

### Scope guard

Do not turn this task into a rewrite of all existing E2E specs. HPA-560 is primarily orchestration collapse. Consolidate only obvious duplication that makes the simplified command shape clearer.

### Verification

Run focused commands for every surviving broad behavior at least once if `test:e2e:all` does not already exercise them in one invocation.

### Commit

```bash
git add -A apps/game/e2e-tauri apps/game/scripts apps/game/src-tauri apps/game/package.json
git commit -m "test: prune obsolete packaged E2E control surface"
```

Skip this commit entirely if the audit finds no safe control/spec deletion beyond Tasks 2–4.

---

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

```bash
bun run --cwd apps/game test:e2e:pr-smoke
bun run --cwd apps/game test:e2e:all
```

If `test:e2e:all` is too long to run locally in the working environment, trigger the manual/full GitHub Action and use that result before marking the PR ready. Do not declare completion from the PR smoke alone.

### CI graph verification

On the actual PR confirm:

- one ordinary packaged PR smoke job;
- one packaged build inside that job;
- no planner job;
- no dynamic chain matrix;
- no aggregate routing analyzer;
- bounded timeout;
- readable live failure output;
- failure artifact upload still works.

Trigger the broad/manual path and confirm:

- full Chapter 1 production journey executes;
- capture-proof executes;
- save/recovery executes;
- exit lifecycle executes;
- one build is reused by the broad run unless the measured two-static-job fallback was explicitly required.

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

- one explicit PR smoke spec if reusing/renaming an existing spec is less clear

### Simplified

- `.github/workflows/ci.yml`
- `apps/game/package.json`
- direct E2E runner/registry/lifecycle helpers

### Deleted

- changed-path selector
- planner
- custom metrics
- aggregate results/routing analyzer
- scheduler-only contract tests
- generated-chain cleanup/ownership machinery that has no remaining safety role

### Kept

- packaged binary build helper
- direct runner lifecycle/process safety
- safe test-root handling
- full Chapter 1 journey behavior
- dynamic thumbnail capture proof
- representative save/recovery coverage
- exit lifecycle coverage
- useful focused local debugging commands

## Final review checklist

Before marking the PR ready, review the diff with these questions:

- Can a contributor explain PR packaged E2E without a path-to-suite map?
- Does one command reproduce exactly what ordinary PR CI runs?
- Does one command reproduce the broad verification path?
- Is `ci:full-e2e` an explicit escalation, not an automatic router input?
- Did we accidentally delete HPA-550 capture integration coverage?
- Did we leave planner/metrics code behind for compatibility that no user needs?
- Did we add any new generalized abstraction to replace the deleted one?
- Are edge-case permutations owned at lower layers rather than moved into the new smoke?
- Are before/after measurements recorded without introducing permanent telemetry?
- Is all implementation still in this single HPA-560 PR?

If the answers are yes/yes/yes/yes/no/no/no/yes/yes/yes, the ticket has achieved its intended simplification.
