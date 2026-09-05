# Selective PR E2E Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for code changes and `superpowers:verification-before-completion` before marking the implementation PR ready.

**Goal:** Reduce ordinary pull-request packaged game E2E latency by explicitly excluding the developer-only Layout Editor from game-E2E ownership and deferring the full Chapter 1 `production-journey` to full-registry runs.

**Architecture:** Keep the existing selector → canonical suite registry → chain partition → dynamic Actions matrix architecture. Add one explicit no-suite rule for `apps/layout-editor/**`; remove only `production-journey` from non-force-full risk selection; preserve dialogue's canonical-suite relationship with `E2E_SUITE_IDS.filter(...)`; lock both negative and positive ownership invariants in selector tests. Keep registry, chain topology, workflow, retry, cache, timeout values, result analyzer, and journey implementation unchanged.

**Tech Stack:** Node.js ESM, `node:test`, existing packaged Tauri/WDIO E2E selector/planner/registry, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-selective-pr-e2e-routing-design.md`

## Global Constraints

- Implement the behavior on this same PR after planning approval; do not split selector and journey policy into separate PRs.
- Rebase onto current `main` before implementation and before final readiness review.
- Preserve `E2E_SUITE_IDS`, `E2E_SUITE_DEFINITIONS`, and `E2E_CHAIN_DEFINITIONS` unchanged.
- Preserve `.github/workflows/ci.yml` behavior unchanged; reuse the existing `ci:full-e2e` → `--force-full` path.
- Preserve `production-journey.e2e.ts` unchanged.
- Preserve `unmatched-non-documentation-path` as the fail-closed fallback for unknown non-documentation paths.
- Explicitly own only `apps/layout-editor/**` as irrelevant to packaged game E2E; do not infer irrelevance from broad repository prefixes.
- Remove `production-journey` from every non-force-full risk rule.
- Preserve every non-journey suite currently selected for the same risk surface.
- Preserve dialogue/crossfade/page-shell's existing relationship to the canonical registry with `E2E_SUITE_IDS.filter((id) => id !== "production-journey")`; do not replace it with a hand-maintained literal suite list.
- Lock both policy directions in tests: ordinary rules must exclude the journey, and every other canonical suite must remain owned by at least one ordinary rule.
- Keep the 25-minute gameplay timeout value unchanged; clarify only that its timing comment describes the full gameplay chain.
- Do not add a new chain, artifact, cache key, dependency graph, shared binary artifact, retry mode, timing assertion, planner schema field, or E2E result classification.
- A forced-full `production-journey` failure will still classify as `routing-gap`; this is an accepted policy-deferred diagnostic consequence documented in the spec, not a result-analyzer bug to fix here.
- The implementation PR must full-run because `select-e2e-suites.mjs` is already E2E infrastructure.

## File Map

**Modify behavior:**

- `apps/game/scripts/select-e2e-suites.mjs`
  - add explicit Layout Editor ownership;
  - demote `production-journey` from non-force-full rules;
  - preserve dialogue ownership through filtered `E2E_SUITE_IDS`;
  - update the dialogue ownership comment.
- `apps/game/scripts/select-e2e-suites.test.mjs`
  - Layout Editor skip contracts;
  - updated focused-routing expectations;
  - table-wide negative journey invariant;
  - positive canonical-suite ownership invariant;
  - stale test-name corrections.
- `apps/game/scripts/plan-e2e-ci.test.mjs`
  - normal gameplay matrix excludes journey;
  - forced-full matrix remains unchanged.

**Modify comments only:**

- `apps/game/scripts/plan-e2e-ci.mjs`
  - clarify that the 20-22 minute timing envelope is the **full** gameplay chain and focused PRs can emit a shorter subset under the same 25-minute ceiling.

**Intentionally unchanged:**

- `apps/game/scripts/e2e-suite-registry.mjs`
- `apps/game/scripts/e2e-ci-results.mjs`
- `apps/game/scripts/e2e-ci-results.test.mjs`
- `.github/workflows/ci.yml`
- `apps/game/e2e-tauri/production-journey.e2e.ts`

## Load-Bearing Risks

1. An empty-suite Layout Editor rule must count as a match; otherwise editor paths remain unmatched and force full.
2. Unknown non-documentation paths must remain fail-closed. Do not widen `isDocumentationPath()`.
3. The dialogue rule currently follows the whole canonical registry. The minimal intended change is “whole registry minus deferred journey,” not “freeze today's seven remaining suites forever.”
4. Removing the journey must not accidentally create an ordinary-PR ownership hole for any other current or future canonical suite.
5. Focused suites do not reproduce the organic route. The change accepts that coverage loss on ordinary PRs.
6. Forced-full journey failures will appear as `routing-gap` because `riskSelectedSuites` intentionally omits the journey. Leave that analyzer semantics unchanged.
7. A normal gameplay plan and a forced-full plan use the same `gameplay` chain ID; only the chain suite file differs.
8. The planner timeout remains sized for the full chain even when focused PRs emit a shorter chain.

---

### Task 1: Give Layout Editor explicit no-game-E2E ownership

**Files:**
- Modify: `apps/game/scripts/select-e2e-suites.test.mjs`
- Modify: `apps/game/scripts/select-e2e-suites.mjs`

**Interfaces:**

- Consumes: existing `E2E_RISK_RULES`, `freezeRule()`, rule matching, and `selectE2eSuites()` union semantics.
- Produces: one rule with `id: "layout-editor"`, `patterns: ["apps/layout-editor/**"]`, and `suiteIds: []`.
- Preserves: unknown non-documentation paths still populate `unmatchedPaths` and force the complete registry.

- [ ] **Step 1.1: Add RED Layout Editor selector contracts**

Add the following tests near the documentation/general-UI routing tests:

```js
test("treats layout-editor changes as explicitly outside game E2E ownership", () => {
  for (const changedPath of [
    "apps/layout-editor/src/App.svelte",
    "apps/layout-editor/src-tauri/src/lib.rs",
  ]) {
    const plan = selectE2eSuites({ changedPaths: [changedPath] });

    assert.deepEqual(plan.suiteIds, [], changedPath);
    assert.equal(plan.skip, true, changedPath);
    assert.equal(plan.forcedFull, false, changedPath);
    assert.deepEqual(plan.unmatchedPaths, [], changedPath);
    assert.deepEqual(
      plan.matchedRules,
      [{ id: "layout-editor", paths: [changedPath] }],
      changedPath,
    );
  }
});

test("keeps layout-editor plus documentation outside game E2E", () => {
  const plan = selectE2eSuites({
    changedPaths: [
      "docs/superpowers/specs/layout-editor-notes.md",
      "apps/layout-editor/src/App.svelte",
    ],
  });

  assert.deepEqual(plan.suiteIds, []);
  assert.equal(plan.skip, true);
  assert.equal(plan.forcedFull, false);
  assert.deepEqual(plan.unmatchedPaths, []);
  assert.deepEqual(plan.matchedRules, [
    { id: "layout-editor", paths: ["apps/layout-editor/src/App.svelte"] },
  ]);
});

test("unions layout-editor ownership with real game risk", () => {
  const plan = selectE2eSuites({
    changedPaths: [
      "apps/layout-editor/src/App.svelte",
      "apps/game/src/lib/components/MainMenu.svelte",
    ],
  });

  assert.deepEqual(plan.suiteIds, ["smoke"]);
  assert.equal(plan.forcedFull, false);
  assert.deepEqual(plan.unmatchedPaths, []);
  assert.deepEqual(plan.matchedRules, [
    { id: "general-ui", paths: ["apps/game/src/lib/components/MainMenu.svelte"] },
    { id: "layout-editor", paths: ["apps/layout-editor/src/App.svelte"] },
  ]);
});
```

The mixed test follows `selectE2eSuites()` normalized path order: `apps/game/...` sorts before `apps/layout-editor/...`.

Keep the existing `infra/new-runner.nix` unknown-path contract unchanged as the negative control.

- [ ] **Step 1.2: Run the selector test and confirm RED**

Run:

```bash
node --test apps/game/scripts/select-e2e-suites.test.mjs
```

Expected before implementation:

- each new editor path is unmatched;
- editor-containing cases force `unmatched-non-documentation-path`;
- the existing unknown-path test still passes.

- [ ] **Step 1.3: Add the minimal Layout Editor rule**

Immediately after `e2e-infrastructure`, add:

```js
freezeRule({
  id: "layout-editor",
  patterns: ["apps/layout-editor/**"],
  suiteIds: [],
}),
```

Do not change `freezeRule()`, `isDocumentationPath()`, `matchesRule()`, or the unmatched fallback.

- [ ] **Step 1.4: Run selector contracts and confirm GREEN**

Run:

```bash
node --test apps/game/scripts/select-e2e-suites.test.mjs
```

Require:

- editor-only and editor+docs skip packaged game E2E;
- editor+MainMenu selects only `smoke`;
- `infra/new-runner.nix` still forces full;
- E2E infrastructure still forces full.

- [ ] **Step 1.5: Commit the ownership boundary**

```bash
git add apps/game/scripts/select-e2e-suites.mjs \
  apps/game/scripts/select-e2e-suites.test.mjs
git commit -m "ci: exclude layout editor from game e2e routing"
```

---

### Task 2: Demote the organic journey and lock suite ownership

**Files:**
- Modify: `apps/game/scripts/select-e2e-suites.test.mjs`
- Modify: `apps/game/scripts/select-e2e-suites.mjs`

**Interfaces:**

- Consumes: exported `E2E_RISK_RULES` and canonical `E2E_SUITE_IDS`.
- Produces ordinary-PR routing:

```text
story-and-compiler       -> smoke, gameplay, analysis-beat85
gameplay                 -> smoke, gameplay, analysis-beat85
acquisition-acknowledgement
                          -> smoke, gameplay, save-core, exit-lifecycle
dialogue-capture-surface -> every canonical suite except production-journey
```

- Preserves force-full behavior: `selectE2eSuites()` still returns complete `E2E_SUITE_IDS` whenever `forcedFullReason !== null`.

- [ ] **Step 2.1: Import the rule table and canonical suite IDs in the selector test**

Replace the current selector import with:

```js
import { E2E_SUITE_IDS } from "./e2e-suite-registry.mjs";
import {
  E2E_RISK_RULES,
  selectE2eSuites,
} from "./select-e2e-suites.mjs";
```

- [ ] **Step 2.2: Change existing focused-routing expectations**

Update acquisition acknowledgement to:

```js
assert.deepEqual(plan.riskSelectedSuites, [
  "smoke",
  "gameplay",
  "save-core",
  "exit-lifecycle",
]);
```

Update gameplay, Interrogation, Analysis, story/compiler, rename-source, and compiler-entrypoint expectations to:

```js
["smoke", "gameplay", "analysis-beat85"]
```

Update dialogue/crossfade/page-shell expectations to:

```js
assert.deepEqual(plan.riskSelectedSuites, [
  "smoke",
  "gameplay",
  "analysis-beat85",
  "capture-proof",
  "save-core",
  "save-management",
  "exit-lifecycle",
]);
```

Keep all force-full expected arrays unchanged.

- [ ] **Step 2.3: Rename stale test descriptions**

Rename these descriptions exactly:

```text
routes gameplay changes through the focused and fresh-journey suites
-> routes gameplay changes through focused PR suites

routes every Interrogation component surface through gameplay coverage
-> routes every Interrogation component surface through focused interrogation coverage

treats playable story and compiler inputs as production-journey risks
-> routes playable story and compiler inputs through focused PR coverage
```

Do not change their representative paths beyond the expected suite arrays.

- [ ] **Step 2.4: Add RED table-wide negative and positive invariants**

Add:

```js
test("keeps production-journey out of every ordinary PR risk rule", () => {
  for (const rule of E2E_RISK_RULES) {
    if (rule.forceFull) continue;
    assert.equal(
      rule.suiteIds.includes("production-journey"),
      false,
      rule.id,
    );
  }
});

test("keeps every non-deferred canonical suite owned by an ordinary PR rule", () => {
  const ordinaryOwnedSuites = new Set(
    E2E_RISK_RULES.filter((rule) => !rule.forceFull).flatMap(
      (rule) => rule.suiteIds,
    ),
  );

  assert.equal(ordinaryOwnedSuites.has("production-journey"), false);
  for (const suiteId of E2E_SUITE_IDS) {
    if (suiteId === "production-journey") continue;
    assert.equal(ordinaryOwnedSuites.has(suiteId), true, suiteId);
  }
});
```

The first test identifies the exact rule that accidentally re-promotes the journey. The second prevents a canonical suite from becoming full-only by omission.

- [ ] **Step 2.5: Run the selector test and confirm RED**

Run:

```bash
node --test apps/game/scripts/select-e2e-suites.test.mjs
```

Expected before implementation:

- focused expected arrays fail because the journey is still selected;
- the negative invariant fails for `story-and-compiler`, `gameplay`, `acquisition-acknowledgement`, and `dialogue-capture-surface`;
- the positive invariant may already pass for non-journey suites and must remain green after the implementation;
- force-full tests remain green.

- [ ] **Step 2.6: Remove the journey from ordinary risk rules**

Change `story-and-compiler` to:

```js
suiteIds: ["smoke", "gameplay", "analysis-beat85"],
```

Change `gameplay` to:

```js
suiteIds: ["smoke", "gameplay", "analysis-beat85"],
```

Change `acquisition-acknowledgement` to:

```js
suiteIds: ["smoke", "gameplay", "save-core", "exit-lifecycle"],
```

Change `dialogue-capture-surface` from:

```js
suiteIds: E2E_SUITE_IDS,
```

to:

```js
suiteIds: E2E_SUITE_IDS.filter((id) => id !== "production-journey"),
```

Do not add a filtered-registry constant; this one expression is the rule's policy.

- [ ] **Step 2.7: Correct the dialogue ownership comment**

Replace:

```js
// The dialogue root and its crossfade are both capture-proven persistence
// carriers and the common progression surface for every packaged suite.
```

with:

```js
// The dialogue root and its crossfade are both capture-proven persistence
// carriers and a cross-cutting progression surface. Ordinary PR routing keeps
// canonical suite ownership here except for the policy-deferred journey.
```

This is comment-only; do not change matching semantics.

- [ ] **Step 2.8: Run selector contracts and confirm GREEN**

Run:

```bash
node --test apps/game/scripts/select-e2e-suites.test.mjs
```

Require:

- every non-force-full rule excludes `production-journey`;
- every other canonical suite is owned by at least one non-force-full rule;
- focused path contracts match the approved arrays;
- all force-full cases still include the complete registry.

- [ ] **Step 2.9: Commit the risk-table policy**

```bash
git add apps/game/scripts/select-e2e-suites.mjs \
  apps/game/scripts/select-e2e-suites.test.mjs
git commit -m "ci: reserve production journey for full e2e runs"
```

---

### Task 3: Lock the planner matrix and clarify the full-chain timing comment

**Files:**
- Modify: `apps/game/scripts/plan-e2e-ci.test.mjs`
- Modify comment only: `apps/game/scripts/plan-e2e-ci.mjs`

**Interfaces:**

- Consumes: `writeE2eCiPlan()` and existing `partitionE2eSuitesByChain()` behavior.
- Produces for a normal gameplay path: one `gameplay` chain containing `smoke`, `gameplay`, `analysis-beat85`.
- Preserves for forced full: gameplay chain still contains `smoke`, `gameplay`, `production-journey`, `analysis-beat85`.
- Preserves `timeoutMinutes: 25` in both cases.

- [ ] **Step 3.1: Add a RED planner matrix contract for a normal gameplay PR**

Add:

```js
test("normal gameplay routing omits the organic journey from the gameplay chain", () => {
  const fixture = withPlan(["apps/game/src-tauri/src/game/dialogue.rs"]);
  try {
    assert.deepEqual(fixture.plan.suiteIds, [
      "smoke",
      "gameplay",
      "analysis-beat85",
    ]);
    assert.deepEqual(fixture.plan.expectedChainIds, ["gameplay"]);
    assert.deepEqual(fixture.readJson(fixture.paths.matrixFile).include, [
      {
        chainId: "gameplay",
        suiteIds: ["smoke", "gameplay", "analysis-beat85"],
        suiteFile: "chains/gameplay-suites.json",
        cacheKey: "tauri-e2e-gameplay-v1",
        timeoutMinutes: 25,
        artifactName: "tauri-e2e-gameplay",
      },
    ]);
    assert.deepEqual(
      fixture.readJson(
        path.join(fixture.paths.chainDirectory, "gameplay-suites.json"),
      ),
      ["smoke", "gameplay", "analysis-beat85"],
    );
  } finally {
    fixture.dispose();
  }
});
```

Do not weaken the existing forced-full contract. It must still assert:

```js
[
  "smoke",
  "gameplay",
  "production-journey",
  "analysis-beat85",
]
```

- [ ] **Step 3.2: Run selector + planner contracts and confirm RED before selector implementation / GREEN after it**

Run:

```bash
node --test \
  apps/game/scripts/select-e2e-suites.test.mjs \
  apps/game/scripts/plan-e2e-ci.test.mjs
```

Before Task 2 implementation, the new planner case fails because the journey is still risk-selected. After Task 2 implementation, require all cases to pass.

- [ ] **Step 3.3: Clarify the gameplay timeout comment without changing the timeout**

Replace the gameplay comment in `plan-e2e-ci.mjs` with:

```js
// The full gameplay chain bundles smoke (~1.6m) + ordinary gameplay (~7m,
// five specs including investigation-layout at ~3m47s) + production-journey
// (~10-12m, full Chapter 1 organic route across all nine city-map gates) +
// analysis-beat85 (~1m). Focused PR matrices can omit the journey but reuse
// this same chain and ceiling. CI runner variance can add ~2m to the earlier
// phases, so 25 minutes remains the full-chain safety budget.
```

Keep:

```js
gameplay: Object.freeze({ timeoutMinutes: 25 }),
```

unchanged.

- [ ] **Step 3.4: Run the complete E2E CI contract suite**

Run:

```bash
bun run --cwd apps/game test:e2e:ci-contracts
```

Require all selector, registry, planner, runner, metrics, results, and workflow contracts to pass. `e2e-ci-results` behavior must stay unchanged; a full-run journey failure remains reportable as `routing-gap` by current semantics.

- [ ] **Step 3.5: Commit planner contract + comment clarification**

```bash
git add apps/game/scripts/plan-e2e-ci.mjs \
  apps/game/scripts/plan-e2e-ci.test.mjs
git commit -m "test: lock focused e2e planner matrix"
```

---

## Final Verification

Before marking the implementation PR ready, run from repository root:

```bash
bun install --frozen-lockfile
node --test \
  apps/game/scripts/select-e2e-suites.test.mjs \
  apps/game/scripts/plan-e2e-ci.test.mjs
bun run --cwd apps/game test:e2e:ci-contracts
bun run --cwd apps/game check:e2e
bun run lint:all
```

Then perform the real planner CLI spot-checks below.

### Layout Editor-only

```bash
tmpdir="$(mktemp -d)"
mkdir -p "$tmpdir/plan/chains"
printf '%s\n' 'apps/layout-editor/src/App.svelte' > "$tmpdir/changed.txt"
node apps/game/scripts/plan-e2e-ci.mjs \
  --changed-paths-file "$tmpdir/changed.txt" \
  --suite-file "$tmpdir/plan/e2e-suites.json" \
  --report-file "$tmpdir/plan/e2e-plan.json" \
  --matrix-file "$tmpdir/plan/e2e-matrix.json" \
  --chain-directory "$tmpdir/plan/chains" \
  --event-name pull_request
cat "$tmpdir/plan/e2e-suites.json"
cat "$tmpdir/plan/e2e-matrix.json"
```

Require:

```json
[]
```

and an empty matrix `include` array.

### Normal gameplay

```bash
rm -rf "$tmpdir/plan"
mkdir -p "$tmpdir/plan/chains"
printf '%s\n' 'apps/game/src-tauri/src/game/dialogue.rs' > "$tmpdir/changed.txt"
node apps/game/scripts/plan-e2e-ci.mjs \
  --changed-paths-file "$tmpdir/changed.txt" \
  --suite-file "$tmpdir/plan/e2e-suites.json" \
  --report-file "$tmpdir/plan/e2e-plan.json" \
  --matrix-file "$tmpdir/plan/e2e-matrix.json" \
  --chain-directory "$tmpdir/plan/chains" \
  --event-name pull_request
cat "$tmpdir/plan/chains/gameplay-suites.json"
```

Require exactly:

```json
["smoke","gameplay","analysis-beat85"]
```

### Forced full

```bash
rm -rf "$tmpdir/plan"
mkdir -p "$tmpdir/plan/chains"
node apps/game/scripts/plan-e2e-ci.mjs \
  --changed-paths-file "$tmpdir/changed.txt" \
  --suite-file "$tmpdir/plan/e2e-suites.json" \
  --report-file "$tmpdir/plan/e2e-plan.json" \
  --matrix-file "$tmpdir/plan/e2e-matrix.json" \
  --chain-directory "$tmpdir/plan/chains" \
  --event-name pull_request \
  --force-full
cat "$tmpdir/plan/chains/gameplay-suites.json"
rm -rf "$tmpdir"
```

Require exactly:

```json
["smoke","gameplay","production-journey","analysis-beat85"]
```

Push the implementation branch. Because `apps/game/scripts/select-e2e-suites.mjs` is itself covered by the force-full E2E-infrastructure rule, GitHub CI must execute the complete packaged registry on this PR. Do not add `ci:full-e2e` merely to compensate for broken selector ownership.

## Self-Review Notes

- **Reuse:** no new runtime or CI abstraction is introduced. Empty-suite ownership, skip matrices, canonical suite registry, partial chain partitioning, and force-full behavior all reuse existing seams.
- **Policy completeness:** the negative invariant prevents journey re-promotion; the positive invariant prevents other canonical suites from becoming accidentally full-only.
- **Diagnostic scope:** `e2e-ci-results.mjs` remains unchanged. A deferred journey failure can still appear as `routing-gap`; the design documents that interpretation instead of adding result-schema machinery.
- **Timing scope:** the change optimizes packaged E2E only. Other workflow jobs remain unchanged and must be measured before selecting a subsequent latency target.
- **No placeholders:** every task has exact files, exact expected arrays, exact code snippets, and exact verification commands.