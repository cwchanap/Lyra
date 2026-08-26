# HPA-536 Chapter 1 Production Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the accepted Chapter 1 build is release-ready using current Analysis/persistence contracts, record the first public Chapter 1 save/content baseline, and fix only release blockers that fresh verification actually reproduces.

**Architecture:** Verification-first closeout. Reuse existing Rust/component/packaged tests at their current owners; do not add the duplicate failed-Load regression from the first draft. Production code is not planned. The only planned repository artifacts are the release-readiness execution record plus the living HPA-540 compatibility-policy handoff.

**Tech Stack:** Rust/Tauri 2, Svelte 5, TypeScript, Vitest/Testing Library, WebdriverIO Tauri E2E, Bun.

**Spec:** `docs/superpowers/specs/2026-08-25-hpa-536-chapter-1-release-hardening-design.md`

## Global Constraints

- One HPA-536 PR; do not split this closeout into multiple PRs.
- Default production/test code delta is zero; edit code only after a fresh existing contract reproduces a release blocker.
- Reuse `lib.rs` transition-contract tests for failed selected Load preservation; do not add a weaker copy in `application/tests/commands.rs`.
- Keep post-HPA-521 `ApplicationPersistence` + one `operation_gate` ownership.
- Keep HPA-549 acquisition semantics: abnormal-crash popup replay is allowed; durable grants remain idempotent.
- Keep HPA-550 dynamic DOM-based save thumbnails and current capture/sidecar behavior.
- Do not redesign E2E suites/router/chains; HPA-560 owns that simplification.
- Do not add Chapter 2 content, future Analysis board kinds, migration/golden-save frameworks, controller support, accessibility automation, or performance harnesses.
- Primary supported Chapter 1 desktop acceptance viewport is 1280x720.
- The first public baseline is an audit/reference contract; recording it does not create a migration framework or future compatibility window.

---

## File Map

### Planned creation during execution

- `docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md`
  - one-time Chapter 1 release evidence and first-public-baseline record.

### Planned living-policy update during execution

- `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`
  - mark the HPA-536 recorded commit/schema/contentRevision tuple as the first public baseline and point future persistence work to the release-readiness record.

### Read-only evidence owners

Do not modify these unless fresh verification fails:

- `apps/game/src-tauri/src/lib.rs`
- `apps/game/src-tauri/src/game/analysis_integration_tests.rs`
- `apps/game/src-tauri/src/game/save/application/**`
- `apps/game/src-tauri/src/game/save/restore.rs`
- `apps/game/src-tauri/src/game/save/storage.rs`
- `apps/game/src/lib/components/analysis/**`
- `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- `apps/game/scripts/e2e-suite-registry.mjs`
- `apps/game/src-tauri/src/game/content_manifest.rs`

---

### Task 1: Re-verify deterministic Chapter 1 release contracts

**Files:**
- No planned source/test changes.
- Record results later in `docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md`.

**Interfaces:**
- Consumes existing Analysis, transition-contract, acquisition, save/storage/restore, thumbnail, and exit tests.
- Produces fresh command evidence only.

- [ ] **Step 1: Prove the existing failed selected-Load preservation owner**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  transition_contract_load_build_failure_keeps_public_view_and_generation_unchanged \
  -- --nocapture
```

Required evidence from the existing test:

```text
load_save_core fails with incompatibleContentRevision
session_observation before == session_observation after
session_observation covers generation + durable revision + serialized public view
```

Do not add `failed_selected_load_keeps_current_session_installed` to `application/tests/commands.rs`. The existing transition contract is stronger.

- [ ] **Step 2: Verify Analysis exact-state/result ownership**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::analysis_integration_tests -- --nocapture
```

Fresh evidence must include the existing contracts for:

- incomplete Order draft detached restore;
- incomplete Threshold draft detached restore;
- Classify round-trip in the full acceptance flow;
- completed/read-only board behavior;
- mid-result-dialogue detached restore;
- no duplicated completed-board/scene effects.

- [ ] **Step 3: Verify Analysis accessibility and semantic fallback owners**

Run:

```bash
bun run --cwd apps/game test -- \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/AnalysisCard.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
```

Use these as the primary deterministic proof for:

- accessible rail state/progress;
- focus restoration;
- read-only review;
- mounted Classify live feedback;
- Classify/Order semantic fallback controls;
- native Threshold `aria-pressed` selection.

- [ ] **Step 4: Run the complete Rust regression surface once**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

This is the authoritative deterministic closeout for current acquisition replay/idempotency, strict restore, atomic storage, stale-generation/session transitions, thumbnail state, persistence health, and exit lifecycle. Do not reconstruct deleted HPA-521 mechanism tests.

- [ ] **Step 5: Run frontend/static contract checks**

Run:

```bash
bun run --cwd apps/game test
bun run --cwd apps/game check
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:ci-contracts
```

If a command fails, preserve the failure output and fix only the concrete existing owner. Do not widen HPA-536 into a framework refactor.

- [ ] **Step 6: No empty commit**

Task 1 creates no commit when all existing contracts pass. Its outputs become evidence in Task 3.

---

### Task 2: Run focused packaged Analysis and real-desktop acceptance

**Files:**
- No E2E registry/router changes.
- Record results later in the release-readiness document.

**Interfaces:**
- Consumes the existing `analysis-beat85` packaged suite and packaged desktop app.
- Produces cross-layer and human-observation evidence.

- [ ] **Step 1: Build packaged E2E once for the focused iteration pass**

Run:

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

Do **not** run `test:e2e:gameplay` first. That command selects only suite ID `gameplay`; it is not the gameplay chain and does not include `analysis-beat85`.

The focused suite must prove its existing claims:

- real packaged resources and Tauri IPC;
- production Pointer Events listener path for Classify/Order using the intentionally selected synthetic transport;
- Threshold selection;
- partial Classify Save -> Title -> Continue;
- partial Order Save -> Title -> Continue;
- partial Threshold Save -> Title -> Continue;
- board submission and hearing handoff.

If local packaged execution cannot launch, record that limitation and use an exact CI/manual run as the evidence source instead of inventing a pass.

- [ ] **Step 2: 1280x720 normal-motion desktop pass**

On the packaged build, at 1280x720 verify:

```text
Analysis rail/header/footer remain visible
long board content scrolls inside the workspace
Classify semantic controls remain reachable
Order semantic controls remain reachable
Threshold selected state remains textual + aria-pressed
Case File opens/closes without clipping its close controls
Save UI opens/closes without clipping its close/confirm controls
closing the top layer returns focus to a usable control
Escape closes only the topmost active layer
```

Record pass/fail and any concrete blocker; do not create viewport-test infrastructure.

- [ ] **Step 3: Reduced-motion pass at the same viewport**

Enable the host reduced-motion preference, relaunch, and exercise:

```text
one Classify edit
one Order edit
one Threshold selection
one rejected submit
one completed/read-only board review
```

Required contract:

```text
No required conclusion depends on animation.
Selected/completed/rejected/read-only state remains textual/semantic.
All three board types remain operable.
```

- [ ] **Step 4: Keyboard-only Analysis pass**

Without drag:

```text
Classify: select -> 放入 -> remove/reassign
Order: Add/Up/Down/Remove
Threshold: Tab -> Space/Enter -> Submit
Completed board: navigate back to read-only review
```

Required result: all three board types can be completed/reviewed and focus is never stranded on `<body>` or an unreachable control.

- [ ] **Step 5: Short VoiceOver semantics/focus pass**

Verify:

```text
rail board names expose current/completed/locked/read-only state and progress
Threshold announces selected/unselected state
Classify assign/remove/no-op feedback is announced
rejected submit text is announced/focusable
board change focuses/announces the new board heading
```

No screen-reader automation framework is introduced.

- [ ] **Step 6: Long-session observation**

Run Chapter 1 with repeated Case File, dialogue history, Analysis, save/load, Return to Title, Continue, and audio transitions.

A blocker must be reproducible and player-visible, such as progressive input lag, multi-second transition degradation, severe save/load slowdown, or duplicated audio/presentation state. Do not add telemetry/benchmark machinery when no blocker is reproduced.

- [ ] **Step 7: No empty commit**

Task 2 records observations for Task 3. It does not create a commit unless verification exposed a concrete fix.

---

### Task 3: Record the first public baseline and close the living HPA-540 policy

**Files:**
- Create: `docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md`
- Modify: `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`

**Interfaces:**
- Consumes actual output from Tasks 1-2, current `SAVE_SCHEMA_VERSION`, generated `save_content_manifest.json`, and the tested Git commit.
- Produces a discoverable first-public baseline reference without a migration framework.

- [ ] **Step 1: Capture exact baseline identity from the branch under test**

Run from repository root:

```bash
git rev-parse HEAD
bun run scenes:compile
grep -n "SAVE_SCHEMA_VERSION" apps/game/src-tauri/src/game/save/schema.rs
find apps/game/src-tauri -name save_content_manifest.json -print -exec cat {} \;
```

For the execution record, copy the literal Git SHA, the literal current schema constant, and the literal generated `contentRevision`. Do not copy remembered values from HPA-540 or an old PR.

- [ ] **Step 2: Create the HPA-536 release-readiness execution record**

Create:

`docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md`

Use these exact sections:

```markdown
# HPA-536 Chapter 1 Release Readiness

## Baseline identity
## Compatibility policy
## Deterministic automated evidence
## Focused packaged Analysis evidence
## 1280x720 desktop observations
## Reduced-motion observation
## Keyboard-only Analysis observation
## VoiceOver observation
## Long-session observation
## Full packaged closeout
## Accepted limitations
## Release blockers / follow-ups
```

Populate every section with actual evidence already obtained. Under deterministic failed-Load evidence, name the existing `transition_contract_load_build_failure_keeps_public_view_and_generation_unchanged`; do not claim HPA-536 added a new test.

Under compatibility policy state:

```text
This recorded commit + SAVE_SCHEMA_VERSION + contentRevision tuple is the first public Chapter 1 persistence baseline.
Pre-release/development saves remain unsupported.
The baseline is an audit/reference contract, not a migration framework or compatibility-window promise.
Future support for a second shipped format requires a separate explicit product decision.
```

- [ ] **Step 3: Update HPA-540 from pending handoff to recorded baseline**

In `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`:

1. keep the current one-format/strict-parser/current-content rules;
2. make the status distinguish pre-release development saves from the recorded public Chapter 1 baseline;
3. point the first-public baseline to the HPA-536 release-readiness execution record;
4. state that the pre-release "clear stale development saves" rule does not describe that recorded released tuple;
5. remove the old requirement to create golden-save registries or a compatibility-window framework as part of this closeout;
6. retain the rule that migration machinery is only considered after another actually shipped format creates a real need.

Do not add runtime migration code, fixtures, golden-save directories, or a compatibility registry.

- [ ] **Step 4: Commit the baseline documentation**

```bash
git add \
  docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md \
  docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md
git commit -m "docs: record Chapter 1 release baseline"
```

---

### Task 4: Run one full packaged closeout and finalize the evidence record

**Files:**
- Modify: `docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md`
- No E2E orchestration changes.

**Interfaces:**
- Consumes the current complete suite registry and final HPA-536 branch state.
- Produces final release evidence and PR closeout.

- [ ] **Step 1: Run the full packaged registry exactly once at closeout**

Run:

```bash
bun run --cwd apps/game test:e2e:all
```

Do not run another full registry elsewhere in the plan. If this environment cannot execute the packaged app, record the exact CI/manual run URL/identifier that supplies the full result instead.

- [ ] **Step 2: Run final repository checks after any blocker fixes/document edits**

Run:

```bash
bun run check
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
```

If HPA-536 needed no production/test fixes, these checks still validate the final branch and documentation formatting/ownership assumptions.

- [ ] **Step 3: Finalize the release-readiness record with the real full result**

Update `## Full packaged closeout` with the exact command and observed outcome from Step 1 (or exact external evidence source). Update `## Release blockers / follow-ups` to contain only concrete unresolved items; if there are none, state that no release blocker was reproduced by the recorded verification.

Do not claim a manual or packaged pass that was not actually observed.

- [ ] **Step 4: Commit final evidence**

```bash
git add docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md
git commit -m "docs: close Chapter 1 release verification"
```

- [ ] **Step 5: Re-check scope against main**

Run:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected planned files are HPA-536 design/plan, the release-readiness record, and the HPA-540 living-policy update. Any production/test file must correspond to a concrete blocker reproduced during Tasks 1-4 and documented in the readiness record.

- [ ] **Step 6: Update tracking**

Update PR #74 and Linear HPA-536 with:

- actual deterministic/package/manual evidence;
- exact first-public baseline identity;
- any production fix that was required and why;
- accepted limitations/follow-ups;
- confirmation that HPA-560 and Chapter 2 remained out of scope.

Do not mark HPA-536 complete until the evidence record matches the final branch state.

---

## Plan self-review checklist

Before execution handoff, verify:

- [ ] no new failed-Load test is planned;
- [ ] existing `lib.rs` transition contracts are named as the owner;
- [ ] release evidence lives under `docs/superpowers/plans/`;
- [ ] HPA-540 is updated as the living baseline policy;
- [ ] focused iteration uses build once + `analysis-beat85`, not `test:e2e:gameplay`;
- [ ] full `test:e2e:all` appears exactly once;
- [ ] no HPA-560, Chapter 2, migration, accessibility, or performance framework work is included;
- [ ] production/test code remains zero by default.
