# Selective PR E2E Routing Design

## Status

Approved design, review-amended and revalidated against `main` at `ec0425b371b987b5134bd6150de466f4ecff398f` on 2026-09-05.

This change is intentionally narrow: keep the existing packaged E2E registry, chain partitioning, runner, retry, artifacts, and full-registry triggers; only change which suites an ordinary pull request selects from changed paths.

## Problem

The packaged Tauri E2E system currently has two avoidable sources of pull-request latency.

First, `select-e2e-suites.mjs` fails closed for every unmatched non-documentation path. That is a useful safety property for unknown game/shared-runtime changes, but it also means an unrelated `apps/layout-editor/**` change has no matching game-E2E owner and therefore forces the complete packaged game E2E registry.

Second, several ordinary-PR risk rules include `production-journey`. That suite intentionally plays the organic Chapter 1 route from the menu through the complete chapter. The current planner timing comment budgets roughly 10-12 minutes for that suite alone, on top of smoke, checkpoint-oriented gameplay, and Beat 8.5 coverage.

The focused suites are not equivalent substitutes for the organic journey:

- ordinary `gameplay` is checkpoint-oriented;
- `investigation-layout.e2e.ts` exercises investigation UI and the first city-map gate, not all nine;
- `analysis-beat85.e2e.ts` exercises the late `interrogation_scene_10` hearing/interrogation surface;
- `capture-proof.e2e.ts` separately exercises an `interrogation_scene_4` question/testimony/challenge/Present path for capture semantics, but that suite is not selected by normal story/gameplay/Interrogation-component routing;
- the all-nine-gate Chapter 1 traversal and route-level sequencing remain unique responsibilities of `production-journey`.

Demoting the journey is therefore an explicit pre-1.0 latency-versus-coverage tradeoff, not a claim of focused-suite parity.

## Goals

- Make `apps/layout-editor/**` explicitly outside packaged game-E2E ownership.
- Keep unmatched non-documentation paths fail-closed unless they are explicitly owned as irrelevant to game E2E.
- Remove `production-journey` from automatic risk-selected suites on ordinary pull requests.
- Preserve `production-journey` unchanged in the canonical E2E registry and gameplay chain.
- Preserve full-registry execution for E2E infrastructure changes, `ci:full-e2e`, `main`, tags, nightly schedule, and manual dispatch.
- Preserve every non-journey suite currently selected for each risk surface.
- Keep ordinary-PR suite ownership structurally complete: every canonical suite except the explicitly deferred journey must still be selected by at least one non-force-full risk rule.
- Keep timing as an optimization target, not a CI assertion.

## Non-goals

- Do not shorten or checkpoint `production-journey`.
- Do not split it into a new Actions matrix chain.
- Do not parallelize WDIO specs.
- Do not add a shared/prebuilt Tauri binary artifact.
- Do not change retry policy, chain timeout values, or job-level timeout values.
- Do not replace the selector with a repository dependency graph.
- Do not broadly treat every non-`apps/game` path as safe.
- Do not change `E2E_SUITE_IDS`, `E2E_SUITE_DEFINITIONS`, or `E2E_CHAIN_DEFINITIONS`.
- Do not add a new result-analysis classification for the deferred journey in this change.

## Existing seams to reuse

| Concern | Existing seam |
|---|---|
| Changed-path ownership | `E2E_RISK_RULES` in `apps/game/scripts/select-e2e-suites.mjs` |
| Conservative unknown fallback | `unmatchedPaths` + `unmatched-non-documentation-path` |
| Canonical suite list | `E2E_SUITE_IDS` |
| Full-registry triggers | `forcedFullTrigger()` + CI `--force-full` |
| PR explicit override | `ci:full-e2e` label in `.github/workflows/ci.yml` |
| Chain partitioning | `partitionE2eSuitesByChain()` |
| Planner contract | `writeE2eCiPlan()` + `plan-e2e-ci.test.mjs` |
| Routing audit | `e2e-ci-results.mjs` uses `planner.riskSelectedSuites` on forced-full failures |

No new abstraction is required.

## Design

### 1. Give Layout Editor an explicit no-game-E2E owner

Add one rule to `E2E_RISK_RULES`:

```js
freezeRule({
  id: "layout-editor",
  patterns: ["apps/layout-editor/**"],
  suiteIds: [],
}),
```

A Layout Editor path then counts as matched, contributes no packaged game E2E suites, and does not enter `unmatchedPaths`.

This is deliberately more conservative than changing the global unmatched-path rule. The game consumes workspace packages and root dependency/build inputs. `packages/shared/**`, `packages/asset-paths/**`, `bun.lock`, and other unknown non-documentation paths therefore remain conservative full-registry triggers unless they already have a specific rule.

Required behavior:

| Changed paths | Result |
|---|---|
| `apps/layout-editor/src/App.svelte` | no packaged game E2E |
| `apps/layout-editor/src-tauri/src/lib.rs` | no packaged game E2E |
| Layout Editor + docs | no packaged game E2E |
| Layout Editor + `apps/game/src/lib/components/MainMenu.svelte` | `smoke` |
| unknown `infra/new-runner.nix` | full registry |
| `.github/workflows/ci.yml` + Layout Editor | full registry |

### 2. Demote `production-journey` from ordinary-PR risk selection

For non-force-full risk rules, remove `production-journey` while preserving every other suite currently selected for the same surface.

The intended ordinary-PR routing is:

| Risk rule | Suites after change |
|---|---|
| `story-and-compiler` | `smoke`, `gameplay`, `analysis-beat85` |
| `gameplay` | `smoke`, `gameplay`, `analysis-beat85` |
| `acquisition-acknowledgement` | `smoke`, `gameplay`, `save-core`, `exit-lifecycle` |
| `dialogue-capture-surface` | all canonical suites except `production-journey` |
| `checkpoint-bridge-surface` | unchanged: `smoke`, `gameplay` |
| `general-ui` | unchanged: `smoke` |
| persistence/capture/exit rules | unchanged |

For `dialogue-capture-surface`, preserve the existing canonical-registry relationship while excluding only the deferred journey:

```js
suiteIds: E2E_SUITE_IDS.filter((id) => id !== "production-journey"),
```

This is the smallest behavioral delta from the current `suiteIds: E2E_SUITE_IDS`: future canonical suites continue to inherit the existing cross-cutting dialogue ownership unless deliberately excluded by policy.

### 3. Lock both sides of ordinary-PR ownership

The selector tests must validate the rule table itself, not only representative paths.

Negative invariant:

```text
for every rule in E2E_RISK_RULES:
  if rule.forceFull !== true:
    production-journey ∉ rule.suiteIds
```

Positive invariant:

```text
union suites from every non-force-full E2E_RISK_RULES entry
contains every E2E_SUITE_IDS member except production-journey
```

This prevents two opposite regressions:

- a future risk rule silently re-promotes the deferred journey;
- a future canonical suite accidentally has no ordinary-PR risk owner at all.

The journey is the one explicit exception. A future full-only canonical suite must therefore make that policy exception explicit rather than becoming unowned silently.

### 4. Preserve full-registry behavior unchanged

`production-journey` remains in `E2E_SUITE_IDS`, `E2E_SUITE_DEFINITIONS`, and the `gameplay` chain. `selectE2eSuites()` already replaces risk-selected suites with the complete registry when `forcedFullReason` is non-null.

These remain full-registry runs:

- E2E infrastructure paths;
- unknown non-documentation paths;
- PRs carrying `ci:full-e2e`;
- `refs/heads/main`;
- tags;
- nightly `schedule`;
- `workflow_dispatch`.

The implementation PR itself changes `select-e2e-suites.mjs`, so its own CI must still run the complete registry through the existing `e2e-infrastructure` rule.

### 5. Keep chain topology and timeout behavior unchanged

Do not modify `E2E_CHAIN_DEFINITIONS`, `CHAIN_EXECUTION` values, cache keys, artifacts, or `.github/workflows/ci.yml` behavior.

A normal gameplay PR still emits the `gameplay` chain, but its suite file contains only selected focused suites. A full run emits the same chain with `production-journey` included.

The gameplay timeout stays at 25 minutes because it remains the capacity ceiling for the full gameplay chain. The comment above that timeout should be clarified to say the 20-22 minute envelope describes the **full** gameplay chain; focused PR matrices can omit the journey while using the same ceiling.

The selector comment above `dialogue-capture-surface` should likewise be updated so it no longer implies ordinary PRs route every canonical suite after the journey is deliberately deferred.

These are comment-only changes; no planner or workflow behavior changes.

### 6. Accept the routing-audit diagnostic consequence

`e2e-ci-results.mjs` classifies a forced-full terminal failure as:

- `covered-by-risk-selection` when the failing suite is present in `planner.riskSelectedSuites`;
- `routing-gap` otherwise.

After this policy change, a forced-full `production-journey` failure will intentionally classify as `routing-gap`, because the suite is deliberately absent from ordinary risk selection.

That is an expected diagnostic consequence for this one deferred suite. It does not change CI pass/fail behavior and does not justify expanding this selector-focused task with a new analyzer classification or planner schema field.

Interpretation after this change:

```text
routing-gap + suite == production-journey
=> may be expected policy deferral; inspect whether the failure argues for re-promoting the journey

routing-gap + any other suite
=> continue treating as evidence of possible under-selection
```

If this distinction becomes noisy in practice, a later task can add an explicit policy-deferred classification backed by plan-time data. Do not hardcode a historical rule-table interpretation into result analysis in this task.

## Acceptance contracts

### Selector examples

```text
layout editor only
=> []

main menu only
=> [smoke]

gameplay/story/compiler
=> [smoke, gameplay, analysis-beat85]

acquisition acknowledgement
=> [smoke, gameplay, save-core, exit-lifecycle]

dialogue root/crossfade/page shell
=> [smoke, gameplay, analysis-beat85, capture-proof, save-core, save-management, exit-lifecycle]
```

### Rule-table invariants

```text
production-journey appears in no non-force-full risk rule

every other canonical suite appears in at least one non-force-full risk rule
```

### Full triggers

```text
selector/infrastructure change
manual forceFull / ci:full-e2e
main
nightly
tag
workflow_dispatch
unknown non-documentation path
=> complete E2E_SUITE_IDS, including production-journey
```

### Planner

Normal gameplay path:

```json
["smoke", "gameplay", "analysis-beat85"]
```

Forced-full gameplay chain:

```json
["smoke", "gameplay", "production-journey", "analysis-beat85"]
```

No new chain ID, artifact, cache key, timeout, result schema, or classification is introduced.

## Expected effect

Using the current documented timing envelope, a normal gameplay PR stops paying the roughly 10-12 minute organic journey and retains smoke + checkpointed gameplay + Beat 8.5 coverage. The gameplay test portion therefore moves from roughly 20-22 minutes toward roughly 9-10 minutes, subject to setup/build and runner variance.

A Layout Editor-only PR selects no packaged game E2E instead of forcing the complete packaged registry.

This does **not** make the rest of CI selective. Existing frontend lint/build, Rust checks, frontend/Rust unit tests, golden/content checks, and other workflow jobs still run according to the current workflow. After this change, measure the actual job critical path before choosing the next CI optimization target; do not assume packaged E2E remains the long pole or that any particular lint job becomes the new one without timing evidence.

These are optimization targets, not new timing assertions.

## Risks and mitigations

1. **Shared workspace changes get skipped accidentally.** Keep the unmatched-path fallback unchanged and add only explicit Layout Editor ownership.
2. **The journey silently returns to ordinary PRs.** Assert every non-force-full rule excludes it.
3. **A new canonical suite becomes full-only accidentally.** Assert every canonical suite except the journey is owned by at least one non-force-full rule.
4. **Dialogue changes lose unrelated existing lifecycle coverage.** Use `E2E_SUITE_IDS.filter(...)` so the rule preserves canonical coverage except the single deferred suite.
5. **The coverage tradeoff is mistaken for parity.** Document exactly which focused surfaces remain and keep the organic route on full triggers.
6. **`routing-gap` is misread for a deferred journey failure.** Document that `production-journey` is an intentional policy-deferred exception; leave analyzer semantics unchanged.
7. **Timing comments become stale.** Update comments in the two already-touched planner/selector files without changing behavior.
8. **The implementation PR under-tests its own policy.** Selector changes already force the complete registry on that PR.

## Verification boundary

Implementation is complete when:

- selector contracts pass, including both table-wide ownership invariants;
- planner contracts prove focused vs forced-full gameplay matrix contents;
- `bun run --cwd apps/game test:e2e:ci-contracts` passes;
- E2E TypeScript checks and repository lint pass;
- the implementation PR's existing CI full E2E gate passes;
- no behavioral changes exist outside the selector policy.