# HPA-560 Tauri E2E Orchestration Collapse Design

> **Status:** Draft / planning-only. This document defines the implementation contract for HPA-560. Implementation should continue on the **same pull request** after review; do not merge a docs-only PR and open a second implementation PR.

**Linear:** HPA-560 — `[Post-Chapter 1] Collapse Tauri E2E orchestration to one PR smoke and manual/nightly full verification`

## Summary

Lyra has reached the point where the Tauri E2E scheduler costs more maintenance than it returns for a hobby project.

The current CI owns a custom changed-path risk router, checked-in suite ownership, generated chain matrices, three parallel chain jobs, custom timing metrics, chain evidence manifests, guarded ownership cleanup, and a final aggregate routing/result analyzer. That machinery was useful while Chapter 1 persistence behavior was still changing rapidly, but the product and save architecture have now stabilized enough to collapse it.

HPA-560 should therefore be a **deletion-first CI simplification**, not another optimization layer.

The target shape is deliberately small:

```text
Pull request
  -> normal compiler/unit/type/Rust checks
  -> one packaged Tauri PR smoke

Nightly / workflow_dispatch / release / explicit ci:full-e2e
  -> one packaged full verification command
  -> production journey + capture proof + save/recovery + exit lifecycle
```

There is no changed-path E2E selector in the target architecture. There is no generated matrix. There is no replacement scheduler.

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

The figures below are a planning baseline from current GitHub Actions runs. They are not the ticket's final median measurement; implementation Task 0 must record a comparable sample before changing CI.

### Recent whole-workflow wall time

- Scheduled run on 2026-09-16: roughly **24m 27s** wall time.
- Recent PR #89 run: roughly **21m 16s** wall time.

### Scheduled gameplay chain

The latest scheduled gameplay chain was roughly **23m 31s** end to end.

Approximate test portions:

| Phase | Approximate time | Observation |
|---|---:|---|
| packaged build after setup | ~1m | Not the dominant cost once cache/setup is complete. |
| `smoke` | ~1m 40s | Small enough for a PR-oriented proof. |
| `gameplay` | ~5m | Useful focused coverage but too large to be the universal PR contract. |
| `production-journey` | ~12m 40s | Dominates the chain; it belongs in broad verification, not every ordinary PR. |
| `analysis-beat85` | ~2m | Already proves a useful Chapter 1 semantic save/continue boundary. |

### Scheduled persistence chain

The latest scheduled persistence chain was roughly **13m** end to end.

Notable phases:

- `capture-proof`: ~2m 40s spec execution.
- `save-seed`: ~1m 40s.
- `save-resume`: ~1m 52s.
- save-management recovery/corruption phases: individually short after seed setup.

This is useful release/nightly coverage, but it does not justify rebuilding and running a separate persistence chain on every PR.

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

Every pull request runs:

- existing compiler/content checks;
- existing frontend unit/type/build checks;
- existing Rust checks/tests;
- exactly one packaged Tauri PR smoke job.

The PR smoke is **not** selected by changed paths. Documentation-only PRs may still run it; simplicity is preferred over maintaining another exception table. If later evidence shows this is materially wasteful, that is a separate decision, not a reason to preserve HPA-516 routing.

The PR smoke should have a bounded timeout and stream normal WDIO/Tauri output directly into the job log. No custom metrics wrapper is needed.

### Broad verification

A single broad verification path runs for:

- `schedule` / nightly;
- `workflow_dispatch`;
- release/tag verification already covered by the repository workflow policy;
- a PR explicitly labeled `ci:full-e2e`.

The broad path runs the existing packaged full command after the runner is simplified.

It must retain representative coverage for:

- full Chapter 1 `production-journey`;
- dynamic-thumbnail `capture-proof` retained by HPA-550;
- semantic save/resume;
- representative corrupted/missing save recovery;
- exit/quit lifecycle and failure-bypass behavior;
- Chapter 1 analysis state whose persistence semantics are not better proven elsewhere.

This is not a promise that every current suite filename survives. It is a behavior contract.

## PR smoke contract

The PR smoke should reuse existing accepted Chapter 1 test seams, especially the useful semantic save/continue work already present around Beat 8.5. It should **not** create a new native checkpoint protocol.

The intended journey is:

```text
launch packaged app
-> enter Chapter 1 and prove real dialogue/resources render
-> use an existing accepted E2E checkpoint seam to reach a representative investigation/acquisition boundary
-> acquire or acknowledge one real Chapter 1 record through production UI
-> reach the Beat 8.5 analysis surface using existing checkpoint support
-> perform one meaningful analysis interaction
-> explicit Save
-> return to title
-> Continue
-> assert exact semantic state survived
-> perform one more interaction to prove the restored state is live
```

### Why checkpoints are acceptable here

The goal is packaged integration, not replaying 2.5–3 hours of Chapter 1 on every PR. Existing deterministic checkpoint support is already part of the accepted Chapter 1 testing surface. HPA-560 may reuse it to keep one smoke short.

The ticket should delete E2E-only checkpoint controls **only if** the final PR smoke and broad verification no longer call them and lower-layer tests own their behavior. It must not add a new checkpoint command just to make the new smoke convenient.

### What the smoke must prove

At minimum:

- the packaged binary launches;
- compiled Chapter 1 resources are available;
- frontend/native command transport works;
- one gameplay mutation is persisted through the real save path;
- returning to title and Continue works;
- restored state matches semantic gameplay state, not merely a screenshot or scene label.

### What the smoke should not prove

Do not put these permutations into the universal PR smoke:

- every corruption/recovery case;
- all save-browser presentation variants;
- every checkpoint bridge;
- the full production journey;
- thumbnail capture visual fidelity;
- all exit failure modes;
- broad geometry/pointer-layout assertions that component tests can own.

## Lower-layer ownership after the collapse

| Concern | Primary owner after HPA-560 |
|---|---|
| save schema, storage, atomic write, restore permutations | Rust tests |
| save-card/modal/error/presentation permutations | frontend tests |
| scene compilation, content definitions, reachability | compiler/content tests |
| packaged binary boot, real resources, IPC, one semantic save/continue | PR smoke |
| organic/full Chapter 1 journey | nightly/manual/release full E2E |
| dynamic thumbnail integration | full `capture-proof` |
| corruption/recovery integration | full E2E representative cases |
| exit/quit lifecycle integration | full E2E |

A focused packaged suite may remain as a **local debugging command** when useful. Remaining local commands do not need changed-path CI ownership.

## Explicit PR escalation instead of automatic routing

When a PR changes a boundary that cannot be proven convincingly by the universal smoke plus lower-layer tests, the developer has two simple options:

1. run the existing focused packaged command locally and record the result in the PR; or
2. add the existing `ci:full-e2e` label so CI runs the broad packaged verification.

Do not add an automatic "focused suite selector" after deleting the current selector. That would recreate HPA-516 under a new name.

## Runner and registry design

### Keep

The reusable value in the current system is the ability to:

- build the Tauri E2E binary;
- start/stop the packaged application safely;
- run a named suite/phase sequence;
- retry a genuinely flaky packaged test when the current runner policy requires it;
- isolate temporary save roots;
- expose normal logs/artifacts on failure.

Keep those pieces where they are already simple and well tested.

### Simplify

The canonical registry may remain only if it is the smallest place to map a broad suite to its ordered phases. It no longer needs to model dynamic CI chains or partition selected suites into matrices.

The runner should expose a small command surface such as:

```text
bun run test:e2e:pr-smoke
bun run test:e2e:all
```

Internally, the direct runner may support a named suite for local debugging, but CI no longer passes planner-generated `--suite-file`, `--chain-id`, or `--plan-file` contracts.

### Delete

Delete when no longer referenced:

- changed-path risk rules;
- selector and ownership audit;
- planner and generated matrix schema;
- chain partition logic used only by CI orchestration;
- custom timing metrics collection;
- custom aggregate routing/result analyzer;
- chain evidence manifests whose purpose is aggregate validation;
- scheduler/router tests whose only product behavior disappears;
- guarded cleanup machinery that exists only to coordinate independent chain jobs, if ordinary runner lifecycle cleanup already owns the required safety.

## Workflow shape

The target `.github/workflows/ci.yml` should read like ordinary CI rather than a CI application.

Conceptually:

```yaml
jobs:
  # existing normal checks remain

  tauri-e2e-pr-smoke:
    if: pull_request
    steps:
      - checkout
      - install toolchain/dependencies
      - build packaged E2E binary once
      - run PR smoke
      - upload normal logs/screenshots on failure/always as appropriate

  tauri-e2e-full:
    if: schedule || workflow_dispatch || tag/release || pull_request has ci:full-e2e
    steps:
      - checkout
      - install toolchain/dependencies
      - build packaged E2E binary once
      - run full packaged verification
      - upload normal logs/screenshots
```

The exact GitHub Actions expression should reuse current repository event/label semantics rather than invent a new trigger system.

## One full job vs multiple static jobs

The default design is **one full job with one build**.

This may increase broad-verification wall clock compared with the current three parallel chains, but broad verification is infrequent and the architecture becomes much smaller. It also avoids paying three independent runner setup/build costs.

If implementation evidence shows one sequential broad job exceeds a practical GitHub Actions timeout or becomes materially unreliable, the fallback is at most **two obvious static jobs** with no planner or generated matrix. That fallback must be justified by measured evidence in this PR; it is not the default implementation.

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

HPA-560 explicitly requires before/after evidence. Do not turn that requirement into permanent telemetry.

Before behavior changes, record in this document or the PR description:

- median wall time across a small comparable sample of recent ordinary PR E2E runs;
- median wall time across recent scheduled/full runs;
- setup/build/test split from representative jobs;
- visible retry/flake count in that sample;
- production and test LOC for selector/planner/metrics/analyzer/registry orchestration files;
- which current suites still have a unique integration responsibility.

Recommended sample size is intentionally small and auditable:

- latest 5 comparable PR runs where packaged E2E actually executed;
- latest 3 scheduled/manual/full runs.

After implementation, capture the same measurements from this PR plus a full/manual run. No monitoring service or history database is added.

## File-level scope

### Expected to modify

- `.github/workflows/ci.yml`
- `apps/game/package.json`
- `apps/game/scripts/run-save-e2e.mjs`
- `apps/game/scripts/e2e-suite-registry.mjs` if a minimal registry still earns its keep
- `apps/game/scripts/e2e-runner-selection.mjs` if needed for the direct command shape
- direct runner/lifecycle/path tests that still protect real behavior
- Chapter 1 packaged E2E spec(s) used to form the new PR smoke

### Strong deletion candidates

- `apps/game/scripts/select-e2e-suites.mjs`
- `apps/game/scripts/select-e2e-suites.test.mjs`
- `apps/game/scripts/plan-e2e-ci.mjs`
- `apps/game/scripts/plan-e2e-ci.test.mjs`
- `apps/game/scripts/e2e-ci-metrics.mjs`
- `apps/game/scripts/e2e-ci-metrics.test.mjs`
- `apps/game/scripts/e2e-ci-results.mjs`
- `apps/game/scripts/e2e-ci-results.test.mjs`
- `apps/game/scripts/e2e-ci-workflow.test.mjs`
- `apps/game/scripts/cleanup-e2e-roots.mjs` only if the direct runner lifecycle already safely cleans its own roots

The implementation must search current `main` before deletion because PR #89 and other work can move E2E anchors while this draft is reviewed.

## Migration sequence

1. Measure current behavior and freeze the baseline in the PR.
2. Create the new PR smoke using existing test controls.
3. Add direct local commands for PR smoke and full verification.
4. Change CI to call those commands directly.
5. Delete selector/planner/metrics/aggregate machinery after nothing references it.
6. Audit focused suites/checkpoints; keep local/debugging value, delete only clearly redundant surfaces.
7. Run the PR smoke and full verification from the simplified architecture.
8. Record after measurements and remaining coverage ownership before marking the PR ready.

This ordering ensures that coverage is replaced before orchestration is removed.

## Risks and mitigations

### Risk: the PR smoke becomes another miniature production journey

**Mitigation:** Use existing checkpoints between representative boundaries. Keep one semantic interaction per important layer rather than replaying the chapter organically.

### Risk: removing routing causes every PR to pay unnecessary packaged setup

**Mitigation:** Accept the small fixed cost in exchange for deleting the scheduler. Revisit only with real evidence after the simplified system lands.

### Risk: broad verification becomes too slow sequentially

**Mitigation:** Measure. Only if a real timeout/reliability problem appears may the implementation keep two static full jobs. Never restore dynamic chain planning.

### Risk: useful focused suites disappear with their CI ownership

**Mitigation:** CI ownership and local-debugging value are separate. Keep focused commands when they help reproduce failures; delete only those with no unique responsibility.

### Risk: HPA-550 coverage is accidentally removed

**Mitigation:** `capture-proof` is explicitly part of the broad verification contract because the final product retained dynamic thumbnails.

### Risk: hidden dependency on planner JSON or ownership manifests

**Mitigation:** Search all repository references before deleting files/flags. Make direct command tests green before deleting the old contract tests.

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
| every PR runs one understandable packaged smoke | Fixed direct PR smoke job. |
| extra PR E2E justified by concrete boundary | Local focused command or explicit `ci:full-e2e`; no automatic risk map. |
| nightly/manual/release keeps recovery/lifecycle | Broad full command retains representative save/recovery/capture/exit coverage. |
| deterministic permutations remain lower-layer | Explicit ownership table above. |
| planner/router/metrics/ownership materially reduced | Delete them rather than redesign them. |
| removed features own no stale E2E surfaces | Final audit after current product decisions; HPA-550 capture remains because feature remains. |
| one local PR smoke + one broad command | `test:e2e:pr-smoke` and `test:e2e:all`. |
| diagnostics remain sufficient | Direct logs, named phases, screenshots/artifacts; no aggregate analyzer. |
| no replacement CI framework | Explicit design constraint. |

## Definition of done

HPA-560 is done when a developer can understand Lyra's packaged E2E policy from two sentences:

> Every PR proves one short real Tauri Chapter 1 save/continue vertical slice.  
> Nightly/manual/release (or an explicit `ci:full-e2e` label) runs the broader packaged verification.

If explaining the result still requires a path ownership table, generated matrix, chain manifest, or custom result classifier, the simplification is not finished.
