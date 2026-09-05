# Selective PR E2E Routing Design

## Status

Approved design, review-amended and revalidated against `main` at `ec0425b371b987b5134bd6150de466f4ecff398f` on 2026-09-05.

This change is intentionally narrow: keep the existing packaged E2E registry, chain partitioning, runner, retry, artifacts, and full-registry triggers; only change which suites a normal pull request selects from changed paths.

## Problem

The packaged Tauri E2E system currently has two sources of avoidable pull-request latency.

First, `select-e2e-suites.mjs` fails closed for every unmatched non-documentation path. That is a good safety property for unknown game/shared-runtime changes, but it also means an unrelated `apps/layout-editor/**` change has no matching game-E2E owner and therefore forces the complete game E2E registry.

Second, several normal PR risk rules include `production-journey`. That suite intentionally plays the organic Chapter 1 route from the menu through the full chapter. The current planner comment budgets roughly 10-12 minutes for that suite alone, on top of smoke, ordinary gameplay, and analysis coverage. It is valuable integration coverage precisely because the focused suites do **not** reproduce the same route: ordinary gameplay is checkpoint-oriented, `investigation-layout.e2e.ts` crosses the first city-map gate rather than all nine, and `analysis-beat85.e2e.ts` covers the late hearing around `interrogation_scene_10` rather than the complete Chapter 1 traversal. Demoting `production-journey` is therefore an explicit pre-1.0 latency-versus-coverage tradeoff, not a claim that focused suites provide equivalent coverage.

The target is to reduce normal PR blocking time while preserving the full integration signal on deliberate full-registry runs.

## Goals

- Make `apps/layout-editor/**` explicitly outside game packaged-E2E ownership.
- Keep unmatched non-documentation paths fail-closed unless they are explicitly owned as irrelevant to game E2E.
- Remove `production-journey` from automatic risk-selected suites on ordinary pull requests.
- Preserve `production-journey` unchanged in the canonical E2E registry and gameplay chain.
- Preserve full-registry execution for E2E infrastructure changes, `ci:full-e2e`, `main`, tags, nightly schedule, and manual dispatch.
- Preserve all existing smoke, ordinary gameplay, analysis, persistence, capture, and exit suite routing otherwise.
- Treat the journey demotion as an accepted pre-1.0 coverage tradeoff; do not describe checkpointed/focused suites as equivalent substitutes for the organic route.
- Avoid CI topology changes unless the selector policy alone proves insufficient.

## Non-goals

- Do not shorten or checkpoint `production-journey`.
- Do not split `production-journey` into a new Actions matrix chain.
- Do not parallelize WDIO specs.
- Do not add a shared/prebuilt Tauri binary artifact.
- Do not change retry policy, chain timeout values, or job-level timeout values.
- Do not replace the selector with a repository dependency graph.
- Do not broadly treat every non-`apps/game` path as safe.
- Do not change `.github/workflows/ci.yml` or `apps/game/scripts/e2e-suite-registry.mjs` for this feature.

## Existing seams to reuse

| Concern | Existing seam |
|---|---|
| Changed-path ownership | `E2E_RISK_RULES` in `apps/game/scripts/select-e2e-suites.mjs` |
| Conservative unknown-path fallback | `unmatchedPaths` + `unmatched-non-documentation-path` |
| Canonical suite list | `E2E_SUITE_IDS` |
| Full-registry triggers | `forcedFullTrigger()` + CI `--force-full` |
| PR explicit override | `ci:full-e2e` label in `.github/workflows/ci.yml` |
| Chain partitioning | `partitionE2eSuitesByChain()` |
| Planner contract | `writeE2eCiPlan()` + `plan-e2e-ci.test.mjs` |
| Selector contract | `select-e2e-suites.test.mjs` |

Do not add a second ownership map or a second full-run mechanism.

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

A Layout Editor path then counts as matched, contributes no game E2E suites, and does not enter `unmatchedPaths`.

This is deliberately more conservative than changing the global unmatched-path rule. The game directly consumes workspace packages and root dependency/build inputs; an unknown path outside `apps/game/**` is not automatically irrelevant. Explicitly owning the one known unrelated app preserves the existing fail-closed behavior everywhere else.

Required behavior:

| Changed paths | Result |
|---|---|
| `apps/layout-editor/src/App.svelte` | no game E2E |
| `apps/layout-editor/src-tauri/src/lib.rs` | no game E2E |
| Layout Editor + docs | no game E2E |
| Layout Editor + `apps/game/src/lib/components/MainMenu.svelte` | `smoke` |
| unknown `infra/new-runner.nix` | full registry, unchanged |
| `.github/workflows/ci.yml` + Layout Editor | full registry, unchanged |

### 2. Demote `production-journey` from normal PR risk selection

For non-force-full path rules, remove `production-journey` while preserving every other suite currently selected for the same surface.

The intended normal-PR routing is:

| Risk rule | Suites after change |
|---|---|
| `story-and-compiler` | `smoke`, `gameplay`, `analysis-beat85` |
| `gameplay` | `smoke`, `gameplay`, `analysis-beat85` |
| `acquisition-acknowledgement` | `smoke`, `gameplay`, `save-core`, `exit-lifecycle` |
| `dialogue-capture-surface` | every current suite except `production-journey` |
| `checkpoint-bridge-surface` | unchanged: `smoke`, `gameplay` |
| `general-ui` | unchanged: `smoke` |
| persistence/capture/exit rules | unchanged |

`dialogue-capture-surface` must use an explicit suite list excluding only `production-journey`; do not remove persistence/capture/exit coverage from that cross-cutting surface.

The policy is table-wide, not sample-path-specific: every `E2E_RISK_RULES` entry with `forceFull !== true` must exclude `production-journey`. The selector contract should walk the exported rule table directly so a future risk rule cannot silently reintroduce the journey into ordinary PR selection.

#### Coverage retained and deferred

The focused suites remain useful, but they are not substitutes for the organic route:

- ordinary `gameplay` remains the checkpoint-oriented five-spec suite;
- `investigation-layout.e2e.ts` still exercises investigation UI plus the **first** city-map gate;
- Interrogation component PRs still select `analysis-beat85`, which exercises the late `interrogation_scene_10` hearing/interrogation surface;
- `capture-proof` separately exercises an `interrogation_scene_4` question/testimony/challenge/Present path for capture semantics, but that suite is not selected by the normal `story-and-compiler`, `gameplay`, or Interrogation-component routing discussed here;
- the organic traversal across all nine Chapter 1 map gates, and the route-level sequencing between those scenes, stays in `production-journey` and therefore moves to full-registry triggers.

That lost ordinary-PR route proof is accepted for the current pre-1.0 iteration phase. Re-promoting the journey later remains a small `suiteIds` policy change rather than a test rewrite.

### 3. Preserve full-registry behavior unchanged

`production-journey` remains in `E2E_SUITE_IDS`, `E2E_SUITE_DEFINITIONS`, and the `gameplay` chain. `selectE2eSuites()` already replaces risk-selected suites with the complete registry when `forcedFullReason` is non-null.

Therefore these remain full runs without workflow changes:

- E2E infrastructure paths (`forceFull: true` rule);
- unknown non-documentation paths;
- PRs carrying `ci:full-e2e`;
- `refs/heads/main`;
- tags;
- nightly `schedule`;
- `workflow_dispatch`.

The implementation PR itself modifies `select-e2e-suites.mjs`, so its own CI must still force the complete registry through the existing `e2e-infrastructure` rule. This is the intended transition proof.

### 4. Keep chain topology and timeouts unchanged

Do not modify `E2E_CHAIN_DEFINITIONS`, `CHAIN_EXECUTION`, or `.github/workflows/ci.yml`.

A normal gameplay PR will still emit the `gameplay` chain, but its suite file will contain only the selected focused suites. A full run will continue to emit the same chain with `production-journey` included.

The 25-minute gameplay-chain timeout remains a capacity ceiling for the full chain. Making timeout budgets conditional would add policy and test surface without materially improving wall-clock time.

## Acceptance contracts

### Selector

Normal PR:

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

Rule-table invariant:

```text
for every rule in E2E_RISK_RULES:
  if rule.forceFull !== true:
    production-journey ∉ rule.suiteIds
```

Full triggers:

```text
selector/infrastructure change
ci:full-e2e/manual forceFull
main
nightly
tag
workflow_dispatch
unknown non-documentation path
=> complete E2E_SUITE_IDS, including production-journey
```

### Planner

For a normal gameplay path, the emitted gameplay chain suite file must exclude `production-journey`:

```json
["smoke", "gameplay", "analysis-beat85"]
```

For forced-full routing, the gameplay chain remains:

```json
["smoke", "gameplay", "production-journey", "analysis-beat85"]
```

No new chain ID, artifact name, cache key, or timeout is introduced.

## Expected effect

Using the current planner's documented timing envelope, a normal gameplay PR should stop paying the roughly 10-12 minute full organic Chapter 1 journey and retain smoke + checkpointed gameplay + Beat 8.5 analysis/interrogation coverage. The expected blocking gameplay-chain test time moves from roughly 20-22 minutes toward roughly 9-10 minutes, subject to runner variance and setup/build time.

This intentionally means a normal story/gameplay PR no longer proves the complete nine-gate Chapter 1 route. That proof moves to E2E infrastructure changes, `ci:full-e2e`, `main`, nightly, tags, and manual dispatch.

A Layout Editor-only PR should select no packaged game E2E at all instead of conservatively forcing the full registry.

These are optimization targets, not new timing assertions in tests. CI correctness remains contract-based rather than wall-clock-test-based.

## Risks and mitigations

1. **Shared workspace changes get skipped accidentally.** Mitigation: do not relax the unmatched-path fallback globally; only add explicit Layout Editor ownership.
2. **The organic route silently disappears from CI.** Mitigation: keep `production-journey` in the canonical registry/chain, assert it remains present for forced-full/main/nightly/tag/manual paths, and assert directly that every non-force-full risk rule excludes it.
3. **The coverage tradeoff is later mistaken for focused-suite parity.** Mitigation: document the retained/deferred coverage above; normal Interrogation component PRs still pay `analysis-beat85`, while all-nine-gate route proof remains a full-registry responsibility.
4. **A cross-cutting dialogue change loses persistence coverage while removing the journey.** Mitigation: replace `E2E_SUITE_IDS` on `dialogue-capture-surface` with the explicit complete list minus only `production-journey`.
5. **The planner or workflow needs structural changes.** Mitigation: selector output already drives partial chain suite files; add planner regression coverage and leave workflow/registry untouched.
6. **The implementation PR under-tests its own selector change.** Mitigation: selector scripts are already E2E infrastructure and therefore force the complete registry on that PR.

## Verification boundary

Implementation is complete when:

- selector unit contracts pass, including the table-wide non-force-full `production-journey` invariant;
- planner contract tests prove focused vs full gameplay matrix contents;
- the complete `test:e2e:ci-contracts` suite passes;
- E2E TypeScript checks and repository lint pass;
- the implementation PR's existing CI full E2E gate passes.