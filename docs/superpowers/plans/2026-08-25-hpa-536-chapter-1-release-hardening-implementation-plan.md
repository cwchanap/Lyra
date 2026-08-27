# HPA-536 Chapter 1 Production Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Evidence must be written to the readiness record before a task/subagent returns.

**Goal:** Prove the accepted Chapter 1 build is release-ready using current owners, preserve evidence as it is produced, record the first public save/content baseline, and fix only blockers that fresh verification actually reproduces.

**Architecture:** Verification-first closeout. No production/test code is planned. Existing Rust/component/E2E owners are authoritative; the readiness document is the durable execution log. HPA-540 owns the compatibility policy.

**Tech Stack:** Rust/Tauri 2, Svelte 5, TypeScript, Vitest/Testing Library, WebdriverIO Tauri E2E, Bun.

**Spec:** `docs/superpowers/specs/2026-08-25-hpa-536-chapter-1-release-hardening-design.md`

## Global constraints

- One HPA-536 PR.
- Default production/test-code delta is zero.
- Reuse existing failed-Load transition contracts; do not add the weaker `commands.rs` copy proposed in the first draft.
- Keep post-HPA-521 `ApplicationPersistence` + one `operation_gate` ownership.
- Keep HPA-549 acquisition replay/idempotency semantics.
- Keep HPA-550 dynamic DOM thumbnail behavior.
- HPA-560 E2E restructuring and Chapter 2/P3 remain out of scope.
- No controller certification, migration/golden-save framework, accessibility harness, or performance harness.
- 1280x720 is the primary Chapter 1 desktop acceptance viewport.
- Do not defer evidence transcription to a later task. Append observed results before the current task ends.

## Planned repository files

Create during execution:

- `docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md`

Already updated by this planning branch and treated as the living policy:

- `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`

Read-only unless verification exposes a blocker:

- `apps/game/src-tauri/src/lib.rs`
- `apps/game/src-tauri/src/game/analysis_integration_tests.rs`
- `apps/game/src-tauri/src/game/save/**`
- `apps/game/src/lib/components/analysis/**`
- `apps/game/src/lib/state/escape-coordinator.test.ts`
- `apps/game/src/lib/components/GameShell.test.ts`
- `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- `apps/game/scripts/e2e-suite-registry.mjs`
- `apps/game/scripts/run-save-e2e.mjs`
- `apps/game/src-tauri/src/game/save/schema.rs`

---

## Task 1: Create the durable record and run deterministic contracts

**Files:**
- Create/update: `docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md`
- No source/test changes unless Task 2b is triggered.

### Step 0: Create the readiness skeleton before running expensive checks

Create the record with these sections:

```markdown
# HPA-536 Chapter 1 Release Readiness

## Verification provenance
## Canonical persistence baseline
## Deterministic automated evidence
## Focused packaged Analysis evidence
## 1280x720 packaged capture evidence
## Physical desktop observation
## Reduced-motion observation
## Keyboard-only Analysis observation
## VoiceOver observation
## Bounded long-session observation
## Full packaged closeout
## Accepted limitations
## Release blockers / follow-ups
```

Rules:

- initial evidence rows use `PENDING`, never speculative `PASS`;
- record command/test names and concise observed outcomes, not terminal dumps;
- write the current branch/head under **Verification provenance**, explicitly marked non-canonical;
- do not fill `SAVE_SCHEMA_VERSION` / `contentRevision` until Task 4 reads them from the tested full-build resources.

Commit the skeleton immediately:

```bash
git add docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md
git commit -m "docs: start Chapter 1 release evidence record"
```

### Step 1: Re-run the existing failed selected-Load owner

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  transition_contract_load_build_failure_keeps_public_view_and_generation_unchanged \
  -- --nocapture
```

Required contract already owned by `lib.rs`:

```text
load_save_core rejects incompatible contentRevision
session_observation before == after
observation covers generation + durable revision + serialized public view
```

Do not add a second regression when this passes.

### Step 2: Re-run Analysis persistence integration

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::analysis_integration_tests -- --nocapture
```

Record the existing owners for:

- incomplete Order restore;
- incomplete Threshold restore;
- Classify acceptance round-trip;
- completed/read-only review;
- mid-result-dialogue restore;
- no duplicated board/scene effects.

### Step 3: Re-run focused frontend semantics, Escape, and shell integration

Use the repository-documented Vitest form; do not insert an extra `--` separator:

```bash
bun run --cwd apps/game test \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/AnalysisCard.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts \
  src/lib/state/escape-coordinator.test.ts \
  src/lib/components/GameShell.test.ts
```

Evidence ownership:

- Analysis ARIA/progress/focus/fallback controls -> Analysis component tests;
- topmost Escape/LIFO claim routing -> `escape-coordinator.test.ts`;
- GameShell overlay Escape/focus integration -> `GameShell.test.ts`.

Do not repeat topmost Escape ordering as a manual acceptance item later.

### Step 4: Run both Rust feature surfaces

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Keep both commands. Tests behind the `e2e` feature make the all-features surface materially different from plain `cargo test`.

### Step 5: Run frontend/static E2E contract checks

```bash
bun run --cwd apps/game test
bun run --cwd apps/game check
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:ci-contracts
```

### Step 6: Append evidence and commit before leaving Task 1

Update `## Deterministic automated evidence` with every command, result, and any exact failing test name.

```bash
git add docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md
git commit -m "docs: record deterministic Chapter 1 release evidence"
```

If any verification failed, enter Task 2b before proceeding to acceptance.

---

## Task 2: Run focused packaged Analysis and retain its artifacts

**Files:**
- Update: release-readiness record only unless Task 2b is triggered.
- Do not edit E2E registry/router code.

### Step 1: Build once and run only the existing `analysis-beat85` suite

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

Do not run `test:e2e:gameplay`; it is a separate leaf suite, not a prerequisite or chain alias for `analysis-beat85`.

### Step 2: Identify the run directory produced by this invocation

The existing runner writes:

```text
apps/game/e2e-artifacts/save-e2e/runs/<run-id>/run-result.json
apps/game/e2e-artifacts/save-e2e/runs/<run-id>/outputs/...
```

Immediately after the run, identify the newly created `<run-id>` directory and inspect its `run-result.json`. Confirm that it names the `analysis-beat85` selection before citing it.

The runner already assigns an attempt-specific output directory and injects it as `LYRA_E2E_OUTPUT_DIR`; do not add a second caller-managed output mechanism.

### Step 3: Record packaged and 1280x720 capture evidence

Record:

- exact `<run-id>`;
- relative path to `run-result.json`;
- suite outcome;
- relative PNG/JSON capture filenames produced under that run;
- observed/requested viewport metadata for the 1280x720 Analysis capture;
- packaged Save -> Title -> Continue evidence for Classify, Order, Threshold;
- hearing handoff result.

`analysis-beat85` already owns the 1280x720 request and geometry assertions. Do not describe viewport fit as a purely manual contract.

If local packaged execution cannot launch, write `BLOCKED` and cite the exact CI/manual packaged run that replaces it. Never infer a packaged pass from unit tests.

### Step 4: Commit the focused packaged evidence

```bash
git add docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md
git commit -m "docs: record focused packaged Analysis evidence"
```

If this run exposes a blocker, execute Task 2b before manual acceptance.

---

## Task 2b: Conditional blocker repair

**Trigger:** any Task 1/2/3/4 check reproduces a release blocker.

Skip this task entirely when verification remains green.

### Step 1: Reproduce at the smallest existing owner

Use the release ownership matrix in the design document to identify the current owner. Re-run the smallest failing test/suite until the failure is reproducible.

### Step 2: Add a failing regression only if the current owner does not already fail

Rules:

- put the regression beside the existing owner, not in a new framework;
- assert the player-visible invariant that failed;
- do not duplicate a stronger existing test merely to create HPA-536-specific coverage.

### Step 3: Make the smallest fix

No refactor is pre-authorized. Change only the production owner needed for the reproduced blocker.

### Step 4: Re-verify both layers

Run:

1. the focused owner/regression;
2. the higher-level suite/check that originally exposed the problem.

Then re-run any directly affected static/type surface.

### Step 5: Hard stop on framework-scale work

If the required repair needs any of the following, do not widen HPA-536:

```text
E2E registry/router redesign
broad persistence architecture change
new accessibility/performance framework
Chapter 2/future Analysis abstractions
migration/version-routing infrastructure
```

Record the blocker/accepted limitation and create a focused follow-up instead.

### Step 6: Persist the repair evidence

Append reproduction, changed owner, regression (if any), fix, and fresh verification to the readiness record and commit code + evidence together.

---

## Task 3: Run bounded real-host acceptance

**Files:**
- Update: release-readiness record.
- No test framework changes.

Automated ownership has already covered geometry, semantic Escape ordering, and most keyboard semantics. This task covers real OS/window/screen-reader behavior only.

**Owner deferral:** The design permits all five real-host observations to be deferred by an owner decision recorded in the readiness record before closeout. The 2026-08-26 deferral in `docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md` is that recorded decision: all five remain `PENDING` until after HPA-536 closes. When that recorded deferral stands, skip Steps 1–6 and leave Task 3; do not invent PASS outcomes or treat this task as an unconditional execution gate.

If the owner later executes the observations instead of deferring, follow Steps 1–6 and commit the evidence.

### Step 1: Physical 1280x720 packaged-window spot check

Use the packaged binary at a 1280x720 CSS target and confirm only native-host observations that the packaged screenshot/geometry assertions cannot settle:

```text
no visible native-window clipping beyond the recorded packaged capture
Case File controls remain physically reachable
Save UI controls remain physically reachable
closing an overlay returns focus to a usable game control
```

Do not re-test topmost Escape ordering manually; Task 1 owns it deterministically.

### Step 2: Host reduced-motion pass

Enable the host reduced-motion preference, relaunch, and exercise:

```text
one Classify edit
one Order edit
one Threshold selection
one rejected submit
one completed/read-only board review
```

Record whether selected/completed/rejected/read-only state remains understandable and all board types remain operable without required motion.

### Step 3: Keyboard-only Analysis pass

Without pointer drag:

```text
Classify: select -> 放入 -> remove/reassign
Order: Add/Up/Down/Remove
Threshold: Tab -> Space/Enter -> Submit
completed board: navigate back to read-only review
```

Record any stranded focus or unreachable operation.

### Step 4: Short VoiceOver pass

Verify:

```text
rail board names expose state/progress
Threshold announces selected/unselected state
Classify assign/remove/no-op feedback is announced
rejected submit is announced/focusable
board change focuses/announces the next board heading
```

This remains a manual release observation, not screen-reader automation work.

### Step 5: Bounded long-session observation

Anchor the session on the packaged production-journey path, then perform **five integration cycles** in the same session. Each cycle includes:

```text
open/close Case File
open/close dialogue history
enter/revisit Analysis
manual Save or Load
Return to Title
Continue
confirm one active audio/presentation state
```

Record:

- approximate elapsed observation window;
- five cycles completed or the exact cycle that failed;
- any reproducible progressive lag, multi-second transition degradation, severe save/load slowdown, duplicated audio, or duplicated presentation state.

A valid negative result is phrased as an observation, e.g. `no progressive degradation noticed during ~N minutes / five cycles`; do not invent a benchmark threshold.

### Step 6: Commit real-host evidence before leaving Task 3

```bash
git add docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md
git commit -m "docs: record Chapter 1 desktop acceptance"
```

If a blocker is found, return to Task 2b.

---

## Task 4: Run one full packaged closeout and freeze the baseline

**Files:**
- Update: release-readiness record.
- Verify HPA-540 still points to that record.

### Step 1: Run the full packaged registry exactly once as the green closeout

```bash
bun run --cwd apps/game test:e2e:all
```

This command already rebuilds the E2E binary before running the full registry. The "exactly once" constraint applies to the final green closeout run only: there must be exactly one full `test:e2e:all` invocation whose `run-result.json` records the gate-closing PASS. It does not forbid the Task 2b higher-level suite/check rerun (Task 2b step 2) needed to confirm a blocker repair — that rerun is explicitly allowed and is distinct from the closeout run.

Record both:

- the failed full (or higher-level) run that exposed the blocker, including its run-id / `run-result.json`; and
- the final gate-closing green full invocation's run-id / `run-result.json` (or the exact CI/manual run if local execution is unavailable).

### Step 2: Read the baseline from the resources actually used by that tested binary

Do **not** run `bun run scenes:compile` again after Step 1. `build-e2e.mjs` already compiled resources through Tauri's `beforeBuildCommand` and copied them into the tested E2E binary layout.

Use only these paths:

```bash
SOURCE_MANIFEST=apps/game/src-tauri/resources/scenes/save_content_manifest.json
TESTED_MANIFEST=apps/game/src-tauri/target-e2e/debug/resources/scenes/save_content_manifest.json

cmp "$SOURCE_MANIFEST" "$TESTED_MANIFEST"
grep -n "SAVE_SCHEMA_VERSION" apps/game/src-tauri/src/game/save/schema.rs
cat "$TESTED_MANIFEST"
git rev-parse HEAD
```

Required result:

- `cmp` succeeds;
- record the literal current `SAVE_SCHEMA_VERSION`;
- record the literal `contentRevision` from `TESTED_MANIFEST`;
- record the branch/head as **verification provenance**, not as the canonical compatibility identity.

Do not use `find ... -name save_content_manifest.json`; fixture and stale target copies must never be candidates for the public baseline.

### Step 3: Finalize canonical persistence identity

Under `## Canonical persistence baseline`, record:

```text
SAVE_SCHEMA_VERSION: <literal value>
contentRevision: <literal value from TESTED_MANIFEST>
```

This pair is the merge-stable compatibility identity referenced by HPA-540. Recording it at closeout/merge does not activate the compatibility promise; that happens when the pair is distributed as the first public Chapter 1 build.

Also record:

```text
Verification PR: #74
Verification head: <git rev-parse HEAD>
```

These Git values are provenance only. The branch head may differ from the landed `main` commit after squash/rebase.

### Step 4: Run final repository checks using root-owned scripts

```bash
bun run check
bun run lint:all
```

`lint:all` is the repository-owned composition of ESLint, Prettier check, Rust fmt, and Rust clippy. Do not duplicate those component commands in this plan.

### Step 5: Finalize and commit the evidence record

Update:

- full packaged result/run artifact;
- final checks;
- canonical schema/contentRevision pair;
- accepted limitations;
- concrete blockers/follow-ups only.

```bash
git add docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md
git commit -m "docs: close Chapter 1 release verification"
```

### Step 6: Re-check scope

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected planned implementation delta is the readiness record plus the already-planned HPA-540 policy update. Any source/test file must map to a blocker documented through Task 2b.

Update PR #74 and Linear HPA-536 with the final evidence summary. Do not mark the issue complete until the PR is ready to land.

---

## Task 5: Post-merge source-provenance closeout

**Trigger:** PR #74 has merged.

This task makes **no repository file change** and does not create another PR or tag. It records source provenance only. It does not activate the HPA-540 compatibility promise.

### Step 1: Resolve the landed main SHA from PR #74

Confirm the PR is merged and capture its resulting `main` commit SHA. Because the repository may squash/rebase, do not assume the pre-merge branch head is the landed commit.

### Step 2: Record the landed SHA in tracking

Update the HPA-536 Linear closeout and PR conversation with:

```text
Canonical persistence baseline: SAVE_SCHEMA_VERSION + contentRevision from the readiness record
Landed main SHA: <merged PR result>
Verification head: <pre-merge tested head>
```

The landed SHA is source provenance; it does not replace schema/contentRevision as the compatibility identity, and it does not activate the compatibility promise.

### Step 3: Complete HPA-536

Close HPA-536 only after the tracked landed SHA points to the merged release-closeout source and no release blocker remains unresolved.

---

## Plan self-review checklist

Before execution handoff, confirm:

- [ ] readiness record is created before verification and committed after each phase;
- [ ] no duplicate failed-Load regression is planned;
- [ ] both plain and all-features Rust suites remain;
- [ ] Vitest focused command follows repository syntax without extra `--`;
- [ ] Escape coordinator and GameShell are named deterministic owners;
- [ ] manual Escape ordering was removed;
- [ ] focused packaged run reuses runner-owned `run-result.json`/output directories;
- [ ] conditional blocker repair has an explicit hard stop for framework-scale work;
- [ ] long-session observation is bounded to five integration cycles;
- [ ] Task 3 has an explicit owner-deferral escape hatch matching the design/readiness record;
- [ ] full `test:e2e:all` green closeout appears exactly once (Task 2b higher-level rerun allowed, distinct from the closeout);
- [ ] baseline reads the pinned tested-binary manifest and does not recompile afterward;
- [ ] canonical baseline is `SAVE_SCHEMA_VERSION + contentRevision`, not a branch SHA;
- [ ] HPA-540 activation is first public distribution of that pair, not merge;
- [ ] final checks are `bun run check` + `bun run lint:all`;
- [ ] post-merge SHA closeout changes tracking only, preserving one ticket -> one PR.
