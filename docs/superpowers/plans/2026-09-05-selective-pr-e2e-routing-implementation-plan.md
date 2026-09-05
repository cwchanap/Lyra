# Selective PR E2E Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` inside implementation slices and `superpowers:verification-before-completion` before marking the implementation PR ready.

**Goal:** Reduce normal pull-request packaged game E2E latency by exempting the developer-only Layout Editor from game E2E ownership and reserving the full Chapter 1 `production-journey` for full-registry runs.

**Architecture:** Keep the existing selector → canonical suite registry → chain partition → dynamic Actions matrix architecture. Add one explicit no-suite ownership rule for `apps/layout-editor/**`, then remove only `production-journey` from non-force-full risk rules. The canonical registry, gameplay chain, planner topology, workflow, retry behavior, and full-run triggers stay unchanged.

**Tech Stack:** Node.js ESM, `node:test`, existing packaged Tauri/WDIO E2E planner and registry, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-selective-pr-e2e-routing-design.md`

## Global Constraints

- Implement this as one PR; do not split selector and journey policy into separate PRs.
- Rebase onto current `main` before implementation and before final readiness review.
- Preserve `E2E_SUITE_IDS`, `E2E_SUITE_DEFINITIONS`, and `E2E_CHAIN_DEFINITIONS` unchanged.
- Preserve `.github/workflows/ci.yml` unchanged; reuse the existing `ci:full-e2e` → `--force-full` path.
- Preserve `production-journey.e2e.ts` unchanged.
- Preserve `unmatched-non-documentation-path` as a full-registry fallback for unknown non-documentation paths.
- Explicitly own only `apps/layout-editor/**` as irrelevant to game packaged E2E; do not infer irrelevance from broad repository prefixes.
- Remove `production-journey` from every normal-PR risk rule that currently selects it, including the cross-cutting `dialogue-capture-surface` rule.
- Preserve every non-`production-journey` suite currently selected by each risk rule.
- Lock journey demotion at the exported rule-table level; do not rely only on a sample of changed paths.
- Do not describe checkpointed/focused suites as equivalent substitutes for the organic Chapter 1 route. This is an explicit pre-1.0 latency-versus-coverage tradeoff.
- Keep the 25-minute gameplay chain budget unchanged; it remains the full-chain capacity ceiling.
- Do not add a new chain, artifact, cache key, dependency graph, shared binary artifact, retry mode, or timing assertion.
- The implementation PR must remain subject to the existing complete-registry E2E gate because changing `select-e2e-suites.mjs` is E2E infrastructure.

## File Map

**Modify:**

- `apps/game/scripts/select-e2e-suites.mjs` — path ownership and normal-PR risk-to-suite policy.
- `apps/game/scripts/select-e2e-suites.test.mjs` — selector contract for Layout Editor ownership, focused PR routing, the table-wide no-journey invariant, unknown-path fail-closed behavior, and full-registry triggers.
- `apps/game/scripts/plan-e2e-ci.test.mjs` — dynamic matrix contract proving normal gameplay excludes the organic journey while forced-full keeps it.

**Intentionally unchanged:**

- `apps/game/scripts/e2e-suite-registry.mjs` — `production-journey` stays canonical and stays in the gameplay chain.
- `apps/game/scripts/plan-e2e-ci.mjs` — existing partitioning already accepts a partial set of suites in a chain.
- `.github/workflows/ci.yml` — existing label/event force-full behavior is sufficient.
- `apps/game/e2e-tauri/production-journey.e2e.ts` — retain the organic route exactly as integration coverage.

## Load-Bearing Risks

1. An explicit irrelevant-app rule must count as a selector match even though it contributes zero suites; otherwise Layout Editor paths still fall into `unmatchedPaths` and force full.
2. `dialogue-capture-surface` currently uses `E2E_SUITE_IDS`; replacing it must remove only `production-journey`, not persistence/capture/exit coverage.
3. A normal gameplay planner result and a forced-full planner result use the same `gameplay` chain ID. The suite file contents, not the chain topology, are the contract that changes.
4. Unknown non-documentation paths must remain conservative full runs. Do not solve the Layout Editor problem by weakening the global unmatched fallback.
5. `selectE2eSuites()` sorts changed paths before processing them, so tests asserting `matchedRules` order must follow normalized path order rather than input order.
6. Focused suites do not reproduce the organic journey. Ordinary gameplay is checkpoint-oriented; `investigation-layout` crosses only the first map gate; `analysis-beat85` covers the late `interrogation_scene_10` hearing. `capture-proof` separately exercises an `interrogation_scene_4` challenge/Present path, but it is not selected by normal story/gameplay/Interrogation-component routing. The all-nine-gate traversal remains a full-registry responsibility.
7. The implementation PR itself must full-run because selector scripts are E2E infrastructure; do not add a special exemption for this change.

---

### Task 1: Give Layout Editor explicit no-game-E2E ownership

**Files:**
- Modify: `apps/game/scripts/select-e2e-suites.test.mjs`
- Modify: `apps/game/scripts/select-e2e-suites.mjs`

**Interfaces:**

- Consumes: existing `E2E_RISK_RULES`, `matchesRule()`, `selectE2eSuites()` and the rule-union semantics.
- Produces: one rule with ID `layout-editor` whose matched paths are recorded but whose `suiteIds` is empty.
- Preserves: `unmatchedPaths` and `forcedFullReason === "unmatched-non-documentation-path"` for every genuinely unknown non-documentation path.

- [ ] **Step 1.1: Add RED selector tests for Layout Editor ownership**

Add these tests next to the current documentation/general-UI routing tests:

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

test("keeps layout-editor plus documentation changes outside game E2E", () => {
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

test("unions layout-editor ownership with real game risk without forcing full", () => {
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

The last assertion deliberately follows normalized changed-path order: `apps/game/...` sorts before `apps/layout-editor/...`.

Do not modify the existing unknown-path test; it is the negative control proving the global conservative fallback remains intact.

- [ ] **Step 1.2: Run the selector test and confirm RED**

Run:

```bash
node --test apps/game/scripts/select-e2e-suites.test.mjs
```

Expected before implementation:

- the new Layout Editor cases fail because the editor path is unmatched;
- `forcedFullReason` becomes `unmatched-non-documentation-path` whenever an editor path is present;
- the existing unknown `infra/new-runner.nix` case still passes.

- [ ] **Step 1.3: Add the minimal Layout Editor ownership rule**

In `E2E_RISK_RULES`, immediately after the force-full `e2e-infrastructure` rule, add:

```js
freezeRule({
  id: "layout-editor",
  patterns: ["apps/layout-editor/**"],
  suiteIds: [],
}),
```

Do not change `isDocumentationPath()`, the unmatched fallback, `freezeRule()`, or matching semantics. An empty suite list is already valid because `freezeRule()` and the selector union operate on arrays without requiring at least one suite per rule.

- [ ] **Step 1.4: Run selector tests and confirm GREEN**

Run:

```bash
node --test apps/game/scripts/select-e2e-suites.test.mjs
```

Require:

- Layout Editor-only and Layout Editor + docs return `skip: true`, `forcedFull: false`, and no unmatched paths;
- Layout Editor + Main Menu selects only `smoke`;
- the existing unknown non-documentation path still selects the complete registry with `forcedFullReason === "unmatched-non-documentation-path"`;
- the existing E2E-infrastructure force-full test remains green.

- [ ] **Step 1.5: Commit the ownership boundary**

```bash
git add apps/game/scripts/select-e2e-suites.mjs \
  apps/game/scripts/select-e2e-suites.test.mjs
git commit -m "ci: exclude layout editor from game e2e routing"
```

---

### Task 2: Reserve `production-journey` for full-registry execution

**Files:**
- Modify: `apps/game/scripts/select-e2e-suites.test.mjs`
- Modify: `apps/game/scripts/plan-e2e-ci.test.mjs`
- Modify: `apps/game/scripts/select-e2e-suites.mjs`

**Interfaces:**

- Consumes: existing exported `E2E_RISK_RULES` and `writeE2eCiPlan()` chain partitioning.
- Produces for ordinary PR risk selection:

```text
story-and-compiler       -> smoke, gameplay, analysis-beat85
gameplay                 -> smoke, gameplay, analysis-beat85
acquisition-acknowledgement
                          -> smoke, gameplay, save-core, exit-lifecycle
dialogue-capture-surface -> smoke, gameplay, analysis-beat85,
                            capture-proof, save-core, save-management,
                            exit-lifecycle
```

- Produces a table-wide invariant: every risk rule with `forceFull !== true` excludes `production-journey` from `suiteIds`.
- Preserves for any forced-full selection: the complete canonical `E2E_SUITE_IDS`, including `production-journey`.
- Preserves chain identity: focused and full selections both use `chainId: "gameplay"`; only `suiteIds` differ.
- Does **not** promise coverage parity with `production-journey`: normal story/gameplay/Interrogation-component PRs intentionally stop proving the all-nine-gate organic route.

- [ ] **Step 2.1: Change selector expectations and lock the rule-table invariant**

Change the test import to expose the existing rule table:

```js
import {
  E2E_RISK_RULES,
  selectE2eSuites,
} from "./select-e2e-suites.mjs";
```

Update the existing exact-array assertions as follows.

Acquisition acknowledgement:

```js
assert.deepEqual(plan.riskSelectedSuites, [
  "smoke",
  "gameplay",
  "save-core",
  "exit-lifecycle",
]);
```

Gameplay, Interrogation, Analysis, story/compiler, rename-source, and compiler-entrypoint cases:

```js
["smoke", "gameplay", "analysis-beat85"]
```

Dialogue/crossfade/page-shell cases:

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

Rename stale test descriptions so they no longer encode the removed journey or overstate which focused suite owns interrogation coverage:

```text
routes gameplay changes through the focused and fresh-journey suites
-> routes gameplay changes through focused PR suites

routes every Interrogation component surface through gameplay coverage
-> routes every Interrogation component surface through focused interrogation coverage

treats playable story and compiler inputs as production-journey risks
-> routes playable story and compiler inputs through focused PR coverage
```

Keep the existing path contracts; they prove the intended suites for representative surfaces. Add a separate structural invariant that walks every non-force-full rule rather than sampling paths:

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
```

This is deliberately stronger than a four-path sample: any future `E2E_RISK_RULES` entry is covered automatically. Keep the existing force-full tests unchanged: E2E infrastructure, manual override, main, nightly, tag, and manual dispatch must still expect the complete registry including `production-journey`.

- [ ] **Step 2.2: Add a RED planner matrix contract for a normal gameplay PR**

In `plan-e2e-ci.test.mjs`, add:

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

Do not weaken the existing `forced full routing emits every chain` test. Its gameplay matrix must continue to assert:

```js
[
  "smoke",
  "gameplay",
  "production-journey",
  "analysis-beat85",
]
```

- [ ] **Step 2.3: Run selector + planner contracts and confirm RED**

Run:

```bash
node --test \
  apps/game/scripts/select-e2e-suites.test.mjs \
  apps/game/scripts/plan-e2e-ci.test.mjs
```

Expected before the selector implementation:

- focused selector assertions fail because current risk rules still include `production-journey`;
- the new table-wide invariant fails for `story-and-compiler`, `gameplay`, `acquisition-acknowledgement`, and `dialogue-capture-surface`;
- the new normal gameplay planner matrix test fails for the same reason;
- full-registry assertions remain green.

- [ ] **Step 2.4: Remove only `production-journey` from normal risk rules**

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

Replace `dialogue-capture-surface`'s `suiteIds: E2E_SUITE_IDS` with the explicit list:

```js
suiteIds: [
  "smoke",
  "gameplay",
  "analysis-beat85",
  "capture-proof",
  "save-core",
  "save-management",
  "exit-lifecycle",
],
```

Do not introduce a new filtered-registry constant. The explicit dialogue list is intentionally reviewable and prevents a future canonical-suite addition from silently becoming a normal-PR requirement for this cross-cutting surface.

Do not modify the force-full `e2e-infrastructure` rule: it must continue using the complete `E2E_SUITE_IDS`.

- [ ] **Step 2.5: Run focused contracts and confirm GREEN**

Run:

```bash
node --test \
  apps/game/scripts/select-e2e-suites.test.mjs \
  apps/game/scripts/plan-e2e-ci.test.mjs
```

Require:

- the table-wide invariant proves every non-force-full rule excludes `production-journey`;
- normal gameplay/story/compiler routes omit `production-journey`;
- acquisition and dialogue surfaces preserve their non-journey lifecycle suites;
- renamed test descriptions accurately describe focused coverage without claiming fresh-journey or gameplay-only interrogation ownership;
- the planner emits one gameplay chain with `smoke`, `gameplay`, `analysis-beat85` for a normal gameplay path;
- manual/full scenarios still include `production-journey`.

- [ ] **Step 2.6: Run the complete E2E CI contract suite**

Run:

```bash
bun run --cwd apps/game test:e2e:ci-contracts
```

Require all registry, runner lifecycle, path selection, planner, metrics, result-validation, and workflow contract tests to pass. Do not update unrelated expectations merely to make this command green; investigate any failure against the spec's unchanged registry/workflow constraints.

- [ ] **Step 2.7: Commit the focused PR routing policy**

```bash
git add apps/game/scripts/select-e2e-suites.mjs \
  apps/game/scripts/select-e2e-suites.test.mjs \
  apps/game/scripts/plan-e2e-ci.test.mjs
git commit -m "ci: reserve production journey for full e2e runs"
```

---

## Final Verification

Before marking the implementation PR ready, run these commands from repository root:

```bash
bun install --frozen-lockfile
node --test \
  apps/game/scripts/select-e2e-suites.test.mjs \
  apps/game/scripts/plan-e2e-ci.test.mjs
bun run --cwd apps/game test:e2e:ci-contracts
bun run --cwd apps/game check:e2e
bun run lint:all
```

Then perform three planner spot-checks using the real CLI contract.

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

Require suite file `[]` and matrix `{ "include": [] }`.

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

Push the implementation branch and require GitHub CI to run the complete registry because `apps/game/scripts/select-e2e-suites.mjs` is covered by the force-full `e2e-infrastructure` rule. The PR is ready only after that full packaged E2E execution passes; do not add `ci:full-e2e` solely to compensate for broken selector ownership on the implementation PR.

## Self-Review Notes

- **Spec coverage:** Layout Editor-only, Layout Editor + docs, and Layout Editor + game union behavior are Task 1; journey demotion, focused-suite preservation, stale test-name cleanup, and the table-wide no-journey invariant are Task 2; full-registry retention is covered by existing selector/planner controls plus final CI verification. The documented coverage boundary explicitly distinguishes checkpointed/late-hearing proof from the organic nine-gate route. No workflow, registry, retry, runner, or production journey implementation work is required.
- **Placeholder scan:** The plan contains exact file paths, exact expected arrays, exact new test bodies, exact selector edits, and exact verification commands; there are no deferred implementation decisions.
- **Interface consistency:** `layout-editor`, `production-journey`, canonical suite IDs, chain ID `gameplay`, cache key `tauri-e2e-gameplay-v1`, artifact `tauri-e2e-gameplay`, and timeout `25` match current `main` contracts.